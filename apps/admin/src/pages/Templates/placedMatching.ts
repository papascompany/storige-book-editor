// 배치(placed) 이미지 동반 업로드 — 업로드 파일 분류 + 매칭 ✓/✗ 요약 (순수 함수, 단위테스트 대상).
//
// 매칭 의미론은 변환기(@storige/indesign-import placedImages.mjs buildImageLookup)와 동일:
// 파일명 NFC 정규화 후 정확 매칭 → 소문자 폴백(대소문자 무시). 여기서는 표시용 요약만
// 산출하며, 실제 치환은 변환기(applyPlacedImages)가 수행한다 — packages 는 수정하지 않는다.

export type UploadKind = 'idml' | 'psd' | 'zip' | 'image' | 'unsupported-image' | 'other';

// 변환기 extractDesignPackage 의 PACKAGE_IMAGE_MIME 과 동일한 확장자 집합(브라우저 디코드 가능).
// TIFF/EPS/PDF/AI 등은 'unsupported-image' — zip 경유 시 변환기가 skipped 로 보고하는 형식과
// 동일 집합(psd 제외 — admin 에서는 PSD 본체 변환 형식)으로, 개별 드롭에서도 같은
// 'JPG/PNG 로 변환해 다시 업로드' 안내를 준다.
const COMPANION_IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
};

// 인쇄 입고에서 흔한 이미지 형식이지만 브라우저가 디코드할 수 없는 확장자 —
// 변환기 extractDesignPackage 의 skipped 정규식(tif|tiff|eps|pdf|psd|ai|wmf|pict)에서 psd 만 제외.
const UNSUPPORTED_IMAGE_EXTS = new Set(['tif', 'tiff', 'eps', 'pdf', 'ai', 'wmf', 'pict']);

const extOf = (name: string): string => {
  const base = name.split('/').pop() || name;
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.slice(idx + 1).toLowerCase() : '';
};

/** 업로드 파일명 → 처리 분기(idml/psd/zip/동반 이미지/디코드 불가 이미지/미지원) */
export const classifyUploadName = (name: string): UploadKind => {
  const ext = extOf(name);
  if (ext === 'idml') return 'idml';
  if (ext === 'psd') return 'psd';
  if (ext === 'zip') return 'zip';
  if (COMPANION_IMAGE_MIME[ext]) return 'image';
  if (UNSUPPORTED_IMAGE_EXTS.has(ext)) return 'unsupported-image';
  return 'other';
};

/** 동반 이미지 확장자의 MIME (지원 외 형식이면 null) */
export const companionMimeFor = (name: string): string | null =>
  COMPANION_IMAGE_MIME[extOf(name)] ?? null;

/**
 * FileReader.readAsDataURL 이 file.type 미상으로 만든 비식별 헤더
 * (data:application/octet-stream;base64, / data:;base64,)를 확장자 기반 MIME 으로 교정.
 * 이미 올바른 image/* 헤더면 그대로 반환(멱등) — <img> 디코드 실패 방지용.
 */
export const fixDataUrlMime = (name: string, dataUrl: string): string => {
  const mime = companionMimeFor(name);
  if (!mime) return dataUrl;
  return dataUrl.replace(
    /^data:(?:application\/octet-stream)?;?base64,/,
    `data:${mime};base64,`
  );
};

/** parseIdml 결과 doc.items 에서 placed 링크 파일명 수집 — 프레임당 1개(같은 링크 중복 허용) */
export const collectPlacedLinkNames = (items: unknown[]): string[] => {
  const out: string[] = [];
  for (const it of items) {
    const name = (it as { placed?: { linkFileName?: string | null } } | null)?.placed
      ?.linkFileName;
    if (typeof name === 'string' && name) out.push(name);
  }
  return out;
};

/** applyPlacedImages 의 placedApplied.failed 항목 형태 */
export interface PlacedFailLike {
  fileName?: string | null;
  reason: string;
}

export interface PlacedMatchRow {
  /** 표시용 파일명(NFC, 첫 등장 표기 유지) */
  fileName: string;
  /** 같은 링크를 참조하는 placed 프레임 수 (unused 행은 0) */
  frames: number;
  /** matched=복원됨 ✓ / failed=플레이스홀더 유지 ✗ / unused=업로드했지만 IDML 미참조 */
  status: 'matched' | 'failed' | 'unused';
  reason?: string;
}

// 변환기와 동일한 비교 정규화: NFC + 소문자(대소문자 무시)
const norm = (s: string): string => s.normalize('NFC').toLowerCase();

/** 변환기 failed.reason → 관리자용 한국어 설명 */
export const humanizePlacedFailReason = (reason: string, isSkippedFormat: boolean): string => {
  if (reason === 'not-provided') {
    return isSkippedFormat
      ? '브라우저에서 디코드할 수 없는 형식(TIF/EPS/PDF 등) — JPG/PNG 로 변환해 다시 업로드하세요'
      : '같은 파일명의 이미지가 업로드되지 않았습니다';
  }
  if (reason.startsWith('bake-failed')) return '이미지 디코드/크롭에 실패했습니다';
  if (reason === 'rotated-inner-transform')
    return '프레임 내부 회전 배치 — 복원 미지원(플레이스홀더 유지)';
  if (reason === 'non-rect-frame') return '비사각 프레임 배치 — 복원 미지원(플레이스홀더 유지)';
  if (reason === 'no-overlap') return '이미지가 프레임 밖에 있어 보이는 영역이 없습니다';
  return `복원 미지원(${reason})`;
};

/**
 * placed 링크 파일명별 매칭 ✓/✗ 요약 행 생성.
 *
 * - linkNames: IDML 의 placed 링크 파일명(프레임당 1개) — 같은 링크 다중 프레임은 frames 로 집계.
 * - failed: 변환기 placedApplied.failed — 여기 없는 링크는 전부 복원 성공(matched).
 *   (applyPlacedImages 는 모든 placed 프레임을 matched/failed 중 하나로 분류한다.)
 * - providedNames: 동반 업로드 파일명 — 어떤 링크와도 안 맞으면 unused 행(파일명 오타 진단용).
 * - skipped: zip 에서 변환 불가 형식으로 건너뛴 파일명 — not-provided 사유 메시지를 구체화.
 */
export const buildPlacedMatchRows = (params: {
  linkNames: string[];
  failed: PlacedFailLike[];
  providedNames: string[];
  skipped?: string[];
}): PlacedMatchRow[] => {
  const { linkNames, failed, providedNames, skipped = [] } = params;

  // 링크명 그룹핑(NFC·대소문자 무시) — 표시는 첫 등장 표기 유지
  const groups = new Map<string, { display: string; frames: number }>();
  for (const n of linkNames) {
    if (!n) continue;
    const k = norm(n);
    const g = groups.get(k);
    if (g) g.frames += 1;
    else groups.set(k, { display: n.normalize('NFC'), frames: 1 });
  }

  const failedReason = new Map<string, string>();
  for (const f of failed) {
    if (!f.fileName) continue;
    const k = norm(f.fileName);
    if (!failedReason.has(k)) failedReason.set(k, f.reason);
  }
  const skippedSet = new Set(skipped.map(norm));

  const rows: PlacedMatchRow[] = [];
  for (const [k, g] of groups) {
    const reason = failedReason.get(k);
    if (reason !== undefined) {
      rows.push({
        fileName: g.display,
        frames: g.frames,
        status: 'failed',
        reason: humanizePlacedFailReason(reason, skippedSet.has(k)),
      });
    } else {
      rows.push({ fileName: g.display, frames: g.frames, status: 'matched' });
    }
  }

  // 업로드했지만 어떤 placed 링크와도 매칭되지 않은 이미지(파일명 확인 유도)
  const seenProvided = new Set<string>();
  for (const p of providedNames) {
    const k = norm(p);
    if (groups.has(k) || seenProvided.has(k)) continue;
    seenProvided.add(k);
    rows.push({
      fileName: p.normalize('NFC'),
      frames: 0,
      status: 'unused',
      reason: 'IDML 에서 참조되지 않는 파일입니다 (링크 파일명과 일치하는지 확인)',
    });
  }
  return rows;
};
