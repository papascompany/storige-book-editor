import { execFile } from 'child_process';
import { promisify } from 'util';
import { Logger } from '@nestjs/common';
import { VALIDATION_CONFIG } from '../config/validation.config';
import {
  FontDetectionResult,
  FontInfo,
  ImageResolutionResult,
  ImageInfo,
} from '../dto/validation-result.dto';

const execFileAsync = promisify(execFile);
const logger = new Logger('PopplerPreflight');

/**
 * R2 (프리플라이트 정밀화, 2026-08-10) — poppler-utils 기반 폰트·이미지 해상도 검출.
 *
 * 배경: 기존 detectFonts/detectImageResolutionFromPdf(ghostscript.ts)는 latin1 정규식
 * 바이너리 스캔이라 ①압축 오브젝트 스트림(ObjStm) PDF 에서 미탐(폰트는 안전기본값
 * hasUnembeddedFonts:false 방향 = 미임베드 폰트가 경고 없이 통과), ②이미지 해상도는
 * "이미지가 페이지 전체를 채운다" 가정(transform matrix 미파싱)이라 부정확했다.
 *
 * poppler 는 PDF 를 정식 파싱한다:
 *  - `pdffonts`      : 폰트별 임베드(emb)/서브셋(sub) 여부 — ObjStm 포함 전수.
 *  - `pdfimages -list`: 이미지별 **실배치 해상도**(x-ppi/y-ppi — CTM 반영) 목록.
 *
 * 통합 규약(파리티 안전):
 *  - 반환 형태는 기존 FontDetectionResult / ImageResolutionResult 그대로 —
 *    applyDetectionWarnings(임의 변경 금지)는 손대지 않는다.
 *  - 실패(미설치·타임아웃·암호화·파싱불능)는 **null** 반환 → 콜러가 기존 정규식
 *    검출로 폴백한다. poppler 도입으로 기존보다 나빠지는 경로는 없다.
 *  - poppler-utils 는 워커 컨테이너에 기설치(트랙 B-(d), docker/worker/Dockerfile).
 *
 * 실행 규약은 pdf-metadata-qpdf.ts 와 동형: execFile + env 경로 주입 + 타임아웃.
 * 목록 출력만 받으므로(이미지 데이터 추출 없음) 2GB 파일에서도 상수 메모리다.
 */

const PDFFONTS_PATH = process.env.PDFFONTS_PATH || 'pdffonts';
const PDFIMAGES_PATH = process.env.PDFIMAGES_PATH || 'pdfimages';

/**
 * 자식 프로세스 타임아웃. 목록 명령은 페이지 트리 순회뿐이라 대형 파일도 수 초
 * 수준이지만, 손상/초대형(2GB) 파일을 고려해 여유를 둔다. 초과 시 null 폴백.
 */
const POPPLER_TIMEOUT_MS = Number(process.env.POPPLER_TIMEOUT_MS || 60_000);

/** 목록 stdout 은 폰트/이미지 수에 비례(행 단위) — 수만 행이어도 수 MB 수준. */
const POPPLER_MAX_BUFFER = 64 * 1024 * 1024; // 64MB

// ============================================================
// 가용성 체크 (컨테이너=기설치 / 로컬 dev=미설치 가능 → 1회 판별 후 캐시)
// ============================================================

let availabilityCache: Promise<boolean> | null = null;

export function isPopplerPreflightAvailable(): Promise<boolean> {
  if (!availabilityCache) {
    availabilityCache = (async () => {
      try {
        // poppler 계열은 `-v` 로 버전을 stderr 에 출력하고 정상 종료한다.
        await execFileAsync(PDFFONTS_PATH, ['-v'], { timeout: 10_000 });
        return true;
      } catch (err: any) {
        // 일부 배포판은 -v 에 비 0 종료 — stderr 버전 문자열이 있으면 가용으로 판정.
        if (/pdffonts version/i.test(String(err?.stderr ?? ''))) return true;
        logger.warn(
          `pdffonts unavailable (${err?.code ?? err?.message}) — 정규식 검출 폴백 유지`,
        );
        return false;
      }
    })();
  }
  return availabilityCache;
}

/** 테스트 전용: 가용성 캐시 초기화. */
export function __resetPopplerAvailabilityCache(): void {
  availabilityCache = null;
}

// ============================================================
// pdffonts — 폰트 임베드 검출
// ============================================================

/**
 * poppler 폰트 타입 명칭(공백 포함) — 행 우측 파싱 후 남는 head 에서 접미 매칭.
 * 긴 것부터 매칭해야 'Type 1' 이 'CID Type 0C (OT)' 를 가로채지 않는다.
 */
const PDFFONTS_TYPES = [
  'CID Type 0C (OT)',
  'CID TrueType (OT)',
  'CID Type 0C',
  'CID TrueType',
  'CID Type 0',
  'Type 1C (OT)',
  'TrueType (OT)',
  'Type 1C',
  'TrueType',
  'Type 1',
  'Type 3',
  'unknown',
].sort((a, b) => b.length - a.length);

/**
 * `pdffonts` 표 출력을 FontDetectionResult 로 파싱한다(순수 — 테스트 대상).
 *
 * 행 형식(공백 정렬 표):
 *   name                type          encoding      emb sub uni object ID
 *   ABCDEF+NanumGothic  CID TrueType  Identity-H    yes yes yes     12  0
 *
 * name/type 이 공백을 포함할 수 있으므로 **우측 고정 열**(emb sub uni id gen)을
 * 정규식으로 떼고, head 에서 encoding(단일 토큰)·type(알려진 명칭 접미 매칭)·name 을
 * 역순으로 복원한다.
 */
export function parsePdffontsOutput(stdout: string): FontDetectionResult {
  const fonts: FontInfo[] = [];
  const unembedded = new Set<string>();

  const lines = stdout.split('\n');
  // 헤더/구분선을 지나 데이터 행만 — 구분선(---)은 '-' 로만 구성.
  let inBody = false;
  for (const line of lines) {
    if (!inBody) {
      if (/^-{10,}/.test(line.trim())) inBody = true;
      continue;
    }
    if (!line.trim()) continue;

    // 우측 고정 열: emb sub uni objectId gen
    const tail = line.match(
      /^(.*?)\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+(\d+)\s+(\d+)\s*$/,
    );
    if (!tail) continue; // 형식 불일치 행은 건너뜀(버전별 부가 행 방어)

    const head = tail[1].trimEnd();
    const embedded = tail[2] === 'yes';
    const subFlag = tail[3] === 'yes';

    // head = name + type + encoding. encoding 은 단일 토큰(마지막 공백 뒤).
    const encIdx = head.lastIndexOf(' ');
    if (encIdx <= 0) continue;
    const encoding = head.slice(encIdx + 1);
    const nameAndType = head.slice(0, encIdx).trimEnd();

    // type 은 알려진 poppler 명칭의 접미 매칭(긴 것 우선).
    const matchedType = PDFFONTS_TYPES.find(
      (t) => nameAndType === t || nameAndType.endsWith(` ${t}`),
    );
    const type = matchedType ?? 'unknown';
    const name = matchedType
      ? nameAndType.slice(0, nameAndType.length - matchedType.length).trimEnd() ||
        '[none]'
      : nameAndType;

    const subset = subFlag || /^[A-Z]{6}\+/.test(name);

    fonts.push({ name, type, embedded, subset, encoding });
    // Type 3 은 글리프가 콘텐츠 스트림에 내장된 자체완결 폰트 — pdffonts 가 emb=no 로
    // 보고해도 '폰트 파일 누락' 사고와 무관하므로 미임베드 경고 대상에서 제외한다.
    if (!embedded && type !== 'Type 3') {
      unembedded.add(name);
    }
  }

  const unembeddedFonts = Array.from(unembedded);
  return {
    fontCount: fonts.length,
    fonts,
    hasUnembeddedFonts: unembeddedFonts.length > 0,
    unembeddedFonts,
    // 기존 검출(ghostscript.ts:1188·streaming-pdf-scan.ts:554)과 동일 시맨틱:
    // 폰트 0건이어도 미임베드가 없으면 true. 파리티 유지(형태+의미).
    allFontsEmbedded: unembeddedFonts.length === 0,
  };
}

/**
 * pdffonts 실행 → FontDetectionResult. 실패 시 null(콜러가 정규식 폴백).
 */
export async function detectFontsPoppler(
  filePath: string,
): Promise<FontDetectionResult | null> {
  if (!(await isPopplerPreflightAvailable())) return null;
  try {
    const { stdout } = await execFileAsync(PDFFONTS_PATH, ['--', filePath], {
      timeout: POPPLER_TIMEOUT_MS,
      maxBuffer: POPPLER_MAX_BUFFER,
    });
    const result = parsePdffontsOutput(stdout);
    logger.debug(
      `pdffonts: ${result.fontCount} fonts, unembedded=${result.unembeddedFonts.length}`,
    );
    return result;
  } catch (err: any) {
    logger.warn(
      `pdffonts failed for '${filePath}' (${err?.code ?? err?.message}) — 정규식 폴백`,
    );
    return null;
  }
}

// ============================================================
// pdfimages -list — 이미지 실배치 해상도 검출
// ============================================================

/**
 * `pdfimages -list` 표 출력을 ImageResolutionResult 로 파싱한다(순수 — 테스트 대상).
 *
 * 행 형식(공백 정렬 표, 16열):
 *   page num  type width height color comp bpc enc interp object ID x-ppi y-ppi size ratio
 *      1   0 image  1250   1667 rgb      3   8 jpeg  no        10  0   150   150  156K 2.6%
 *
 * 파싱은 앞 5열(page num type width height)+뒤 4열(x-ppi y-ppi size ratio)만 사용 —
 * 중간 열(object ID 가 '[inline]' 인 인라인 이미지 등)의 변형에 견고하다.
 *
 * 집계 대상은 type=image 만: smask/mask/stencil 은 1-bit/알파 보조 채널이라 컬러
 * 이미지 해상도 경고(150DPI 게이트)에 섞으면 오탐이 난다(GWG 도 1-bit 는 별도 축).
 * 같은 이미지 객체가 여러 번 배치되면 배치별 행이 나오므로 '최악 배치'가 자연 반영된다.
 */
export function parsePdfimagesListOutput(
  stdout: string,
  minDpi: number = VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
): ImageResolutionResult {
  const images: ImageInfo[] = [];
  const lowResImages: ImageInfo[] = [];

  const lines = stdout.split('\n');
  let inBody = false;
  for (const line of lines) {
    if (!inBody) {
      if (/^-{10,}/.test(line.trim())) inBody = true;
      continue;
    }
    if (!line.trim()) continue;

    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 9) continue;

    const [pageTok, , typeTok, widthTok, heightTok] = tokens;
    // 뒤 4열: x-ppi y-ppi size ratio
    const xPpiTok = tokens[tokens.length - 4];
    const yPpiTok = tokens[tokens.length - 3];

    if (!/^\d+$/.test(pageTok)) continue;
    if (typeTok !== 'image') continue;

    const pixelWidth = parseInt(widthTok, 10);
    const pixelHeight = parseInt(heightTok, 10);
    const effectiveDpiX = Number(xPpiTok);
    const effectiveDpiY = Number(yPpiTok);

    if (!(pixelWidth > 0) || !(pixelHeight > 0)) continue;
    // 'inf'(0 크기 배치)·0·음수 ppi 는 해상도 판정 불능 — 오탐 방지 위해 제외.
    if (
      !Number.isFinite(effectiveDpiX) ||
      !Number.isFinite(effectiveDpiY) ||
      effectiveDpiX <= 0 ||
      effectiveDpiY <= 0
    ) {
      continue;
    }

    const minEffectiveDpi = Math.min(effectiveDpiX, effectiveDpiY);
    const imageInfo: ImageInfo = {
      index: images.length + 1,
      pixelWidth,
      pixelHeight,
      // 실배치 크기 = 픽셀 / 실배치 DPI (기존 '페이지 전체' 가정을 실측으로 대체).
      displayWidthMm: Math.round(((pixelWidth * 25.4) / effectiveDpiX) * 10) / 10,
      displayHeightMm:
        Math.round(((pixelHeight * 25.4) / effectiveDpiY) * 10) / 10,
      effectiveDpiX: Math.round(effectiveDpiX),
      effectiveDpiY: Math.round(effectiveDpiY),
      minEffectiveDpi: Math.round(minEffectiveDpi),
    };

    images.push(imageInfo);
    if (imageInfo.minEffectiveDpi < minDpi) {
      lowResImages.push(imageInfo);
    }
  }

  const imageCount = images.length;
  return {
    imageCount,
    hasLowResolution: lowResImages.length > 0,
    minResolution:
      imageCount > 0 ? Math.min(...images.map((i) => i.minEffectiveDpi)) : 0,
    avgResolution:
      imageCount > 0
        ? Math.round(
            images.reduce((s, i) => s + i.minEffectiveDpi, 0) / imageCount,
          )
        : 0,
    lowResImages,
    images,
  };
}

/**
 * pdfimages -list 실행 → ImageResolutionResult. 실패 시 null(콜러가 정규식 폴백).
 */
export async function detectImageResolutionPoppler(
  filePath: string,
  minDpi: number = VALIDATION_CONFIG.MIN_ACCEPTABLE_DPI,
): Promise<ImageResolutionResult | null> {
  if (!(await isPopplerPreflightAvailable())) return null;
  try {
    const { stdout } = await execFileAsync(
      PDFIMAGES_PATH,
      ['-list', '--', filePath],
      { timeout: POPPLER_TIMEOUT_MS, maxBuffer: POPPLER_MAX_BUFFER },
    );
    const result = parsePdfimagesListOutput(stdout, minDpi);
    logger.debug(
      `pdfimages -list: ${result.imageCount} images, min=${result.minResolution}DPI, lowRes=${result.lowResImages.length}`,
    );
    return result;
  } catch (err: any) {
    logger.warn(
      `pdfimages -list failed for '${filePath}' (${err?.code ?? err?.message}) — 정규식 폴백`,
    );
    return null;
  }
}
