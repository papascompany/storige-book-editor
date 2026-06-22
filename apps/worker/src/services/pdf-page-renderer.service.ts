import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import { pdfToImage } from '../utils/ghostscript';
import { isApiMarker, downloadViaApi } from './api-file-download';
import { VALIDATION_CONFIG } from '../config/validation.config';
import { downloadToTempFile } from '../utils/stream-download';
import { assertSafeDownloadUrl } from '../utils/url-safety';
import { extractPdfMetadataQpdf } from '../utils/pdf-metadata-qpdf';

export interface RenderPagesResult {
  /** 페이지 순서대로의 이미지 상대 URL ('/storage/...') */
  pageImageUrls: string[];
  /** 실제 래스터한 페이지 수(상한 적용 후) */
  pageCount: number;
  /** 사용 해상도(dpi) */
  resolution: number;
  /** 원본 PDF 총 페이지 수(상한 적용 전) */
  sourcePageCount: number;
  /** 상한으로 잘렸는지 */
  truncated: boolean;
}

/**
 * 내지 PDF 표시전용 가이드 래스터화 서비스 (2026-06-07).
 *
 * 첨부 내지 PDF 각 페이지를 PNG 이미지로 변환해 `/storage/content-pdf-guides/<jobId>/`에 저장.
 * 편집기는 underlay 모드에서 이 이미지들을 `excludeFromExport:true` 잠금 가이드 배경으로 표시.
 * ⚠️ 표시 전용 — 최종 인쇄엔 미반영(워커 content.pdf 는 첨부 원본 그대로 방출).
 *
 * 화면 표시 목적이라 저해상도(기본 110dpi)로 메모리/시간 절약. 페이지 상한으로 폭주 방지.
 */
@Injectable()
export class PdfPageRendererService {
  private readonly logger = new Logger(PdfPageRendererService.name);
  private readonly storagePath = process.env.STORAGE_PATH || '/app/storage';
  private readonly guidesDir = 'content-pdf-guides';
  /** 가이드 화면표시용 해상도(dpi). 저해상도로 충분 — 메모리/렌더시간 절약. */
  private readonly dpi = Number(process.env.CONTENT_PDF_GUIDE_DPI) || 110;
  /** N페이지 메모리/시간 가드 상한. 초과분은 잘라내고 truncated=true. */
  private readonly maxPages = Number(process.env.CONTENT_PDF_GUIDE_MAX_PAGES) || 200;

  /**
   * 절대 경로(/app/storage/...) → nginx 서빙 가능한 상대 URL(/storage/...).
   * (pdf-converter.service 의 toStorageUrl 과 동일 규약)
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
   * 입력 PDF 바이트 로드 — '/storage/...'(API fileUrl), 절대/상대 경로, HTTP URL 모두 지원.
   * (pdf-converter.service 의 downloadFile 과 동일 규약)
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
      return fs.readFile(filePath);
    }
    if (url.startsWith('/') || url.startsWith('./')) {
      return fs.readFile(url);
    }
    // SSRF 가드(P0-1 M1): 내부망 페치 + 리다이렉트 우회 차단.
    await assertSafeDownloadUrl(url);
    // EH-004: timeout 으로 무응답 URL 의 render-pdf-pages 잡 무한대기(큐 적체) 방지.
    const res = await axios.get(url, { responseType: 'arraybuffer', maxRedirects: 0, timeout: 60000 });
    return Buffer.from(res.data);
  }

  /**
   * 내지 PDF 를 페이지 이미지로 래스터화.
   * @param fileUrl  내지 PDF 경로/URL (API 가 fileId → filePath 로 해석해 전달)
   * @param jobId    워커잡 ID (출력 디렉토리 네임스페이스)
   * @param pageCount 알려진 페이지 수(있으면 우선; 없으면 pdf-lib 로 추출)
   */
  async renderPages(
    fileUrl: string,
    jobId: string,
    pageCount?: number,
  ): Promise<RenderPagesResult> {
    // 트랙 B-(f): ON 이면 스트림 다운로드(상수메모리) + qpdf 페이지수. OFF 면 기존 전체버퍼+pdf-lib.
    const lightweight = VALIDATION_CONFIG.LIGHTWEIGHT_SYNTHESIS;

    // GS 입력용 임시 PDF 디렉토리(ON/OFF 공통)
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cpg-'));
    // ON 경로 다운로드 핸들(임시면 삭제, 로컬원본이면 no-op). finally 에서 정리.
    let lwCleanup: (() => Promise<void>) | null = null;

    try {
      let inputPath: string;
      let sourcePageCount = pageCount ?? 0;

      if (lightweight) {
        const dl = await downloadToTempFile(fileUrl);
        lwCleanup = dl.cleanup;
        inputPath = dl.path; // GS 입력으로 다운로드 파일을 그대로 사용(메모리 비경유)
        if (!sourcePageCount || sourcePageCount < 1) {
          sourcePageCount = (await extractPdfMetadataQpdf(inputPath)).pageCount;
        }
      } else {
        const bytes = await this.loadBytes(fileUrl);
        if (!sourcePageCount || sourcePageCount < 1) {
          const doc = await PDFDocument.load(bytes, { updateMetadata: false });
          sourcePageCount = doc.getPageCount();
        }
        inputPath = path.join(tmpDir, 'input.pdf');
        await fs.writeFile(inputPath, bytes);
      }

      let renderCount = sourcePageCount;
      let truncated = false;
      if (renderCount > this.maxPages) {
        this.logger.warn(
          `content-pdf-guide[${jobId}]: pageCount ${renderCount} > 상한 ${this.maxPages} — 상한까지만 래스터`,
        );
        renderCount = this.maxPages;
        truncated = true;
      }

      const outDir = path.join(this.storagePath, this.guidesDir, jobId);
      await fs.mkdir(outDir, { recursive: true });

      const pageImageUrls: string[] = [];
      for (let p = 1; p <= renderCount; p++) {
        const outPath = path.join(outDir, `page_${p}.png`);
        // pdfToImage 는 페이지당 30s 타임아웃(WK-3, GS_RASTER_TIMEOUT_MS) + 페이지 상한으로 폭주 방지.
        await pdfToImage(inputPath, outPath, {
          page: p,
          resolution: this.dpi,
          format: 'png',
        });
        pageImageUrls.push(this.toStorageUrl(outPath));
      }
      this.logger.log(
        `content-pdf-guide[${jobId}]: ${pageImageUrls.length}/${sourcePageCount}p @${this.dpi}dpi`,
      );

      return {
        pageImageUrls,
        pageCount: renderCount,
        resolution: this.dpi,
        sourcePageCount,
        truncated,
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (lwCleanup) await lwCleanup().catch(() => {});
    }
  }
}
