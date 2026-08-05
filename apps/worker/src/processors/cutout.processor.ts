import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import {
  CUTOUT_QUEUE_NAME,
  CUTOUT_JOB_NAME,
  CUTOUT_MAX_LONG_EDGE,
  computeInferenceCap,
  CutoutJobData,
  CutoutJobResult,
} from '@storige/types';
import { RembgService } from '../services/rembg.service';
import { JobStatusService, JobStatusPayload } from '../services/job-status.service';
import { isApiMarker, downloadViaApi } from '../services/api-file-download';
import { assertSafeDownloadUrl } from '../utils/url-safety';
import { captureJobException } from '../sentry/sentry.init';
import { DomainError, ErrorCodes } from '../common/errors';

/**
 * 배경제거(컷아웃) 서버 오프로드 프로세서 (2026-08-05, D-6a=B·D-6b②·D-12a=C).
 *
 * 큐 `image-cutout` / 잡 `remove-background` / 동시성 1.
 * 추론 자체는 rembg 사이드카(RembgService)가 HTTP 로 수행하고, 이 프로세서는
 * 입력 로드 → 픽셀 캡 다운스케일 → 사이드카 호출 → 결과 PNG 저장 → 상태 보고만 한다.
 *
 * ⚠️ 기능 플래그 `CUTOUT_ENABLED` 기본 false(미설정=꺼짐). 켜야만 동작한다.
 */

/** 완료 마커 겸 결과 캐시. 멱등 재실행 시 재추론 없이 이 파일로 복원한다. */
const META_FILENAME = 'result.json';

/** 입력 바이트 상한 기본값(30MB) — 편집기 업로드 가드와 같은 급의 폭주 방지선 */
const DEFAULT_MAX_INPUT_BYTES = 30 * 1024 * 1024;

/**
 * 입력 **픽셀** 상한 기본값(40MP).
 *
 * 바이트 상한만으로는 부족하다 — 단색 대형 이미지는 압축이 잘 돼 수백 KB 로 30MB 캡을
 * 통과하면서 디코드 시점에 수백 MB 를 요구한다(16383² = 268MP 가 sharp 기본 상한).
 * 이 워커는 PDF 검증/변환/합성을 함께 돌리므로, 컷아웃 한 건의 디코드가 인쇄 잡을
 * 동반 실패시키지 않도록 픽셀 예산을 명시한다. 40MP ≈ 8000×5000 로 인쇄 원본에 충분하다.
 */
const DEFAULT_MAX_INPUT_PIXELS = 40_000_000;

/** 사이드카에 넘길 수 있는 실제 이미지 포맷 — DB MIME 라벨이 아니라 **바이트**로 판정한다 */
const ALLOWED_INPUT_FORMATS = new Set(['png', 'jpeg', 'jpg', 'webp']);

/** 잡 산출 경로에 그대로 들어가므로 형식을 강제한다(경로 조작 차단) */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 플래그 진리값 해석 — API(assertCutoutEnabled)와 **같은 술어**를 써야 한다.
 * 한쪽만 '1' 을 받아들이면 "라우트는 열렸는데 워커는 전건 FAILED" 라는 추적 어려운 상태가 된다.
 */
function isFlagOn(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/** DomainError 면 그 코드를, 아니면 undefined(=API 가 코드 없이 저장) */
function errorCodeOf(e: Error): string | undefined {
  return e instanceof DomainError ? e.code : undefined;
}

@Processor(CUTOUT_QUEUE_NAME)
export class CutoutProcessor {
  private readonly logger = new Logger(CutoutProcessor.name);
  // WK-4 — 상태 업데이트 재시도 공유 서비스 (DI 대신 직접 생성 — 기존 프로세서 규약 동일)
  private readonly jobStatusService = new JobStatusService();
  private readonly storagePath = process.env.STORAGE_PATH || '/app/storage';
  private readonly cutoutsDir = 'cutouts';
  /** 기본 false — 미설정/오타는 전부 '꺼짐'으로 해석한다(API 와 동일 술어) */
  private readonly enabled = isFlagOn(process.env.CUTOUT_ENABLED);
  private readonly maxInputBytes =
    Number(process.env.CUTOUT_MAX_INPUT_BYTES) || DEFAULT_MAX_INPUT_BYTES;
  private readonly maxInputPixels =
    Number(process.env.CUTOUT_MAX_INPUT_PIXELS) || DEFAULT_MAX_INPUT_PIXELS;

  constructor(private readonly rembgService: RembgService) {}

  @Process({ name: CUTOUT_JOB_NAME, concurrency: 1 })
  async handleCutout(job: Job<CutoutJobData>): Promise<CutoutJobResult> {
    const { jobId } = job.data;
    this.logger.log(`Processing cutout job ${jobId}`);

    try {
      await this.updateJobStatus(jobId, 'PROCESSING');

      if (!this.enabled) {
        throw new DomainError(
          ErrorCodes.CUTOUT_DISABLED,
          '배경제거(컷아웃) 서버 처리가 비활성화되어 있습니다 — CUTOUT_ENABLED 미설정',
        );
      }

      // jobId 는 출력 경로에 그대로 들어간다 — 형식을 강제해 경로 조작 여지를 없앤다.
      if (!UUID_PATTERN.test(jobId)) {
        throw new DomainError(
          ErrorCodes.INVALID_OUTPUT_OPTIONS,
          `잡 ID 형식이 올바르지 않습니다: ${JSON.stringify(jobId).slice(0, 80)}`,
        );
      }

      const outDir = path.join(this.storagePath, this.cutoutsDir, jobId);

      // ── 멱등 가드 (P0-5 lockDuration 10분 초과 시 stalled 재실행이 살아 있다) ──
      // 이미 결과 PNG 가 있으면 절대 재추론하지 않는다. 추론은 이 잡에서 가장 비싼 단계다.
      const reused = await this.reuseExisting(outDir, job.data);
      if (reused) {
        await this.updateJobStatus(jobId, 'COMPLETED', { result: reused });
        this.logger.log(`Cutout job ${jobId} reused existing result: ${reused.cutoutUrl}`);
        return reused;
      }

      const bytes = await this.loadBytes(job.data.fileUrl);
      if (bytes.length > this.maxInputBytes) {
        throw new DomainError(
          ErrorCodes.CUTOUT_INPUT_TOO_LARGE,
          `입력 이미지가 너무 큽니다: ${bytes.length} bytes > 상한 ${this.maxInputBytes} bytes`,
        );
      }

      const { width: sourceWidth, height: sourceHeight } = await this.readDimensions(bytes);

      // D-6b② 픽셀 캡 — 장변 상한 초과분만 비율 유지 축소. 캡 값은 @storige/types 단일 진실.
      const maxLongEdge =
        job.data.maxLongEdge && job.data.maxLongEdge > 0
          ? job.data.maxLongEdge
          : CUTOUT_MAX_LONG_EDGE;
      const cap = computeInferenceCap(sourceWidth, sourceHeight, maxLongEdge);

      let inferenceInput = bytes;
      if (cap.engaged) {
        // fit:'fill' — computeInferenceCap 이 이미 비율을 유지한 정수 치수를 주므로
        // 그 치수를 그대로 강제해 결과 PNG 치수가 계약값과 어긋나지 않게 한다.
        inferenceInput = await sharp(bytes, this.sharpOptions())
          .resize(cap.targetWidth, cap.targetHeight, { fit: 'fill' })
          .png()
          .toBuffer();
        this.logger.log(
          `cutout[${jobId}]: 픽셀 캡 발동 ${sourceWidth}x${sourceHeight} → ${cap.targetWidth}x${cap.targetHeight} (장변 상한 ${maxLongEdge})`,
        );
      }

      const { png, model } = await this.rembgService.removeBackground(
        inferenceInput,
        job.data.model,
      );

      await fs.mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, `${uuidv4()}.png`);
      // tmp → rename 으로 부분 기록 파일이 멱등 가드에 잡히지 않게 한다.
      const tmpPath = `${outPath}.tmp`;
      await fs.writeFile(tmpPath, png);
      await fs.rename(tmpPath, outPath);

      const result: CutoutJobResult = {
        cutoutUrl: this.toStorageUrl(outPath),
        inputWidth: cap.targetWidth,
        inputHeight: cap.targetHeight,
        sourceWidth,
        sourceHeight,
        capEngaged: cap.engaged,
        model,
        // processedAt 은 워커가 stamp (DB는 UTC) — 편집기 불일치 비교용
        processedAt: new Date().toISOString(),
      };
      await fs.writeFile(path.join(outDir, META_FILENAME), JSON.stringify(result), 'utf8');

      await this.updateJobStatus(jobId, 'COMPLETED', { result });
      this.logger.log(`Cutout job ${jobId} completed: ${result.cutoutUrl} (model=${model})`);

      return result;
    } catch (error) {
      const err = toError(error);
      this.logger.error(`Cutout job ${jobId} error: ${err.message}`, err.stack);

      captureJobException(err, {
        jobId,
        jobType: 'cutout',
        queueName: CUTOUT_QUEUE_NAME,
        fileUrl: job.data.fileUrl,
      });

      // errorCode 를 함께 보낸다 — 편집기가 한국어 메시지를 정규식으로 파싱하지 않고
      // 재시도 가부(사이드카 일시 장애 vs 입력 문제)를 판정할 수 있어야 한다.
      await this.updateJobStatus(jobId, 'FAILED', null, err.message, errorCodeOf(err));
      throw err;
    }
  }

  /**
   * 멱등 재실행 복원 — 이미 산출된 결과가 있으면 재추론 없이 그대로 돌려준다.
   *
   * 1) `result.json`(완료 마커)이 유효하고 참조 PNG 가 실존 → 그대로 재사용(입력 로드조차 안 함).
   * 2) PNG 만 있고 마커가 소실(PNG 기록과 마커 기록 사이 크래시) → **추론은 생략**하고
   *    출력 PNG 헤더 + 원본 헤더에서 치수만 복원한다(둘 다 헤더 파싱이라 저렴).
   */
  private async reuseExisting(
    outDir: string,
    data: CutoutJobData,
  ): Promise<CutoutJobResult | null> {
    const existingPng = await this.findExistingPng(outDir);
    if (!existingPng) return null;

    const meta = await this.readMeta(outDir);
    if (meta && meta.cutoutUrl === this.toStorageUrl(existingPng)) {
      return meta;
    }

    this.logger.warn(
      `cutout[${data.jobId}]: 결과 PNG 는 있으나 ${META_FILENAME} 이 없거나 어긋납니다 — 재추론 없이 치수만 복원`,
    );
    const outMeta = await sharp(await fs.readFile(existingPng), this.sharpOptions()).metadata();
    const srcMeta = await this.readDimensions(await this.loadBytes(data.fileUrl));
    const maxLongEdge =
      data.maxLongEdge && data.maxLongEdge > 0 ? data.maxLongEdge : CUTOUT_MAX_LONG_EDGE;
    const cap = computeInferenceCap(srcMeta.width, srcMeta.height, maxLongEdge);
    // 산출 시각은 '복원한 지금'이 아니라 PNG 의 mtime 이 사실에 가깝다.
    const producedAt = await fs
      .stat(existingPng)
      .then((s) => s.mtime.toISOString())
      .catch(() => new Date().toISOString());

    return {
      cutoutUrl: this.toStorageUrl(existingPng),
      inputWidth: outMeta.width ?? cap.targetWidth,
      inputHeight: outMeta.height ?? cap.targetHeight,
      sourceWidth: srcMeta.width,
      sourceHeight: srcMeta.height,
      capEngaged: cap.engaged,
      // ⚠️ 마커가 없으면 **어떤 모델로 만든 산출물인지 알 수 없다.** 현재 env 기본값을
      // 적어 넣으면 라이선스 감사 추적(D-12b)이 거짓이 된다 — 모르는 것은 모른다고 남긴다.
      model: 'unknown',
      processedAt: producedAt,
    };
  }

  /** 잡 출력 디렉터리의 결과 PNG 절대경로(가장 먼저 발견된 것). 없으면 null. */
  private async findExistingPng(outDir: string): Promise<string | null> {
    let entries: string[];
    try {
      entries = await fs.readdir(outDir);
    } catch {
      return null; // 디렉터리 자체가 없음 = 첫 실행
    }
    const png = entries.filter((name) => name.toLowerCase().endsWith('.png')).sort()[0];
    return png ? path.join(outDir, png) : null;
  }

  /** 완료 마커 읽기. 없거나 깨졌으면 null(호출자가 치수 복원 경로로 폴백). */
  private async readMeta(outDir: string): Promise<CutoutJobResult | null> {
    try {
      const raw = await fs.readFile(path.join(outDir, META_FILENAME), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as CutoutJobResult).cutoutUrl === 'string'
      ) {
        // 마커는 이 프로세서가 직접 쓴 파일이라 형태 계약을 신뢰한다(cutoutUrl 만 최소 검증).
        return parsed as CutoutJobResult;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * **디코드** 경로용 sharp 옵션 — 픽셀 예산을 backstop 으로 명시(기본 268MP 는 이 워커엔 과하다).
   * 아래 readDimensions 가 먼저 분류된 에러로 걸러내므로 여기까지 오는 일은 없어야 하지만,
   * 새 경로가 추가돼도 예산이 새지 않도록 방어선을 남긴다.
   */
  private sharpOptions(): { limitInputPixels: number; sequentialRead: true } {
    return { limitInputPixels: this.maxInputPixels, sequentialRead: true };
  }

  /**
   * 이미지 헤더에서 치수·포맷 추출 후 예산·포맷 검증.
   *
   * ⚠️ 여기가 **실효 포맷 방어선**이다. API 의 MIME 화이트리스트는 업로드 시 클라이언트가
   * 선언한 DB 라벨(multer mimetype / presign contentType)만 보므로 위조가 가능하다.
   * 바이트에서 판정한 포맷이 아니면 사이드카로 넘기지 않는다.
   */
  private async readDimensions(bytes: Buffer): Promise<{ width: number; height: number }> {
    // ⚠️ 헤더 판독에는 픽셀 제한을 걸지 않는다(limitInputPixels:false).
    //    제한을 걸면 sharp 가 분류되지 않은 자체 에러("Input image exceeds pixel limit")를
    //    먼저 던져, 아래의 errorCode 분류(CUTOUT_INPUT_TOO_LARGE)와 사용자 안내 문구가 죽는다.
    //    metadata() 는 헤더만 파싱하므로 큰 이미지라도 디코드 비용이 들지 않는다.
    const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) {
      throw new DomainError(
        ErrorCodes.CUTOUT_UNSUPPORTED_FORMAT,
        '이미지 치수를 읽을 수 없습니다 — 지원하지 않는 형식이거나 손상된 파일입니다',
      );
    }
    if (!meta.format || !ALLOWED_INPUT_FORMATS.has(meta.format)) {
      throw new DomainError(
        ErrorCodes.CUTOUT_UNSUPPORTED_FORMAT,
        `지원하지 않는 이미지 형식입니다: ${meta.format ?? 'unknown'} (허용: png/jpeg/webp)`,
      );
    }
    // 디코드 전에 픽셀 예산을 판정한다 — 바이트 상한을 통과하는 대형 저압축 이미지 차단.
    const pixels = meta.width * meta.height;
    if (pixels > this.maxInputPixels) {
      throw new DomainError(
        ErrorCodes.CUTOUT_INPUT_TOO_LARGE,
        `입력 이미지 픽셀 수가 너무 큽니다: ${meta.width}x${meta.height}(${pixels}px) > 상한 ${this.maxInputPixels}px`,
      );
    }
    return { width: meta.width, height: meta.height };
  }

  /**
   * 절대 경로(/app/storage/...) → nginx 서빙 가능한 상대 URL(/storage/...).
   * (pdf-page-renderer.service 의 toStorageUrl 과 동일 규약)
   */
  private toStorageUrl(absPath: string): string {
    const base = this.storagePath.replace(/\/$/, '');
    if (absPath === base) return '/storage';
    if (absPath.startsWith(base + '/')) {
      return '/storage/' + absPath.substring(base.length + 1);
    }
    return absPath;
  }

  /**
   * 입력 이미지 바이트 로드 — 'api://' 마커, '/storage/...', 로컬 경로, HTTP URL 지원.
   * (pdf-page-renderer.service 의 loadBytes 와 동일 규약 + 입력 상한 선검사)
   */
  private async loadBytes(url: string): Promise<Buffer> {
    // API가 s3(R2) backend 파일에 넘기는 마커 → API 다운로드 라우트로 위임 (local/s3 라우팅)
    if (isApiMarker(url)) {
      return Buffer.from(await downloadViaApi(url));
    }
    if (url.startsWith('/storage/') || url.startsWith('storage/')) {
      const storageBase = process.env.WORKER_STORAGE_PATH || '../api';
      const filePath = url.startsWith('/storage/')
        ? `${storageBase}${url}`
        : `${storageBase}/${url}`;
      return this.readFileWithCap(filePath);
    }
    if (url.startsWith('/') || url.startsWith('./')) {
      return this.readFileWithCap(url);
    }
    // SSRF 가드(P0-1 M1): 내부망 페치 + 리다이렉트 우회 차단.
    await assertSafeDownloadUrl(url);
    const res = await axios.get<ArrayBuffer | Buffer>(url, {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      timeout: 60_000,
      // 상한 초과분은 아예 받지 않는다(버퍼에 다 담고 재는 것보다 안전).
      maxContentLength: this.maxInputBytes,
    });
    return Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
  }

  /** 로컬 파일은 stat 으로 먼저 재고 상한 초과면 읽지 않는다(메모리 폭주 방지). */
  private async readFileWithCap(filePath: string): Promise<Buffer> {
    const stat = await fs.stat(filePath);
    if (stat.size > this.maxInputBytes) {
      throw new Error(
        `입력 이미지가 너무 큽니다: ${stat.size} bytes > 상한 ${this.maxInputBytes} bytes`,
      );
    }
    return fs.readFile(filePath);
  }

  /**
   * WK-4 공유 JobStatusService(재시도 5회·최대 30s 백오프) 사용.
   * ⚠️ 페이로드 필드는 API UpdateJobStatusDto 에 있는 것만 — 없는 필드는 전역
   *    ValidationPipe 가 400 으로 거부해 상태 업데이트 자체가 실패한다.
   */
  private async updateJobStatus(
    jobId: string,
    status: string,
    result?: { result: CutoutJobResult } | null,
    errorMessage?: string,
    errorCode?: string,
  ): Promise<void> {
    const payload: JobStatusPayload = { status };
    if (result) {
      payload.result = result.result;
    }
    if (errorMessage) {
      payload.errorMessage = errorMessage;
    }
    if (errorCode) {
      payload.errorCode = errorCode;
    }

    await this.jobStatusService.updateJobStatusWithRetry(jobId, payload, {
      jobType: 'cutout',
      queueName: CUTOUT_QUEUE_NAME,
    });
  }
}
