/**
 * sheet-map.ts — ProductProfile `output.mode='sheet-map'` 상품의 시트 앞/뒤 매핑(P2-a, 2026-10-18, 순수 함수).
 *
 * 설계: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §6.3. 편집기 산출 단일 PDF(캔버스 순서, 0-base)를
 * 물리 시트 `SheetSpec[]` 로 바꾼다. 매핑은 API 단독 권위이며 편집기·세션 metadata 가 보낸 값은 쓰지 않는다 —
 * 입력은 프로파일(템플릿셋 선언)과 서버가 산출한 pageCount(`resolveSessionPageCount`)뿐이다.
 *
 * 규칙(§6.3 그대로):
 *   - canvas-per-sheet            : sheets[i] = { front: i, back: null }
 *   - canvas-pair + same-sheet    : 표지(protectedIndices 선행 구간)는 { front: 표지, back: null } 로 단면 선행,
 *                                   나머지는 (2m, 2m+1) 짝 → { front: 2m, back: 2m+1(rotate: backRotation) }.
 *                                   후행 protected 구간(에필로그)도 같은 이유로 단면 후행.
 *   - canvas-pair + offset-next   : 표지(인덱스 0, protected 필수) 뒤에 첫 상단을 붙인다 —
 *                                   sheets[0] = { front: 표지, back: 상1 }, sheets[k] = { front: 하k, back: 상k+1 },
 *                                   짝이 남지 않으면 마지막 back: null.
 *   - binding 'center-punch' 는 same-sheet 만(`PAIRING_NOT_ALLOWED`), 'top-ring'·'none' 은 둘 다 허용.
 *   - opts.postProcessPages > 0 : 업로드 결합 PDF 의 마지막 n 쪽은 앞/뒤 짝에서 제외하고
 *                                   { role: 'post-process', back: null } 단면 시트로 뒤에 분리한다.
 *   - 결과 검증: 모든 page 가 0..pageCount-1 안에서 정확히 1회(`assertSheetMapCoversPages`).
 *
 * 프로파일 전체 검증(validateProductProfile)은 호출부의 resolveProductProfile 책임이다. 여기서는 매핑에
 * 쓰는 필드만 본다 — 예: 벽걸이 (나) 25캔버스(표지 1 + 12×2, 에필로그 없음)는 types 의 "faces=2 → count 짝수"
 * 규칙에 걸리지만 offset-next 매핑 자체는 성립하므로(§3) 이 함수는 pageCount 로만 판단한다.
 */
import type { ProductProfile, SheetFaceRef, SheetSpec } from '@storige/types';

export type SheetMapErrorCode =
  | 'INVALID_PROFILE'
  | 'INVALID_PAGE_COUNT'
  | 'PAGE_COUNT_MISMATCH'
  | 'PAIRING_NOT_ALLOWED'
  | 'INVALID_POST_PROCESS';

export class SheetMapError extends Error {
  constructor(
    public readonly code: SheetMapErrorCode,
    message: string,
  ) {
    super(`[sheet-map] ${code}: ${message}`);
    this.name = 'SheetMapError';
  }
}

export interface BuildSheetMapOptions {
  /**
   * 업로드 결합 PDF 에 포함된 후가공면 쪽수(마지막 n 쪽). 편집기 세션에는 후가공면이 없으므로 기본 0.
   * 프로파일 `postProcess.pages` 를 자동으로 쓰지 않는다 — 결합 여부는 호출부(파일 출처)가 안다.
   */
  postProcessPages?: number;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/** 0 부터 이어지는 protected 구간 길이(표지 수) */
function leadingRunLength(sorted: readonly number[]): number {
  let n = 0;
  while (n < sorted.length && sorted[n] === n) n += 1;
  return n;
}

/** pageCount-1 까지 이어지는 protected 구간 길이(에필로그 수) */
function trailingRunLength(sorted: readonly number[], pageCount: number): number {
  let n = 0;
  while (n < sorted.length && sorted[sorted.length - 1 - n] === pageCount - 1 - n) n += 1;
  return n;
}

/**
 * protectedIndices 를 표지(선행)·에필로그(후행) 구간으로 나눈다. 인쇄 페이지 범위 밖 값은 무시하고,
 * 선행·후행 어느 구간에도 속하지 않는(중간) protected 는 매핑 의미가 정의되지 않아 INVALID_PROFILE.
 */
function splitProtected(profile: ProductProfile, printPages: number): { leading: number; trailing: number } {
  const raw = profile.pages.protectedIndices ?? [];
  const sorted = Array.from(new Set(raw.filter((i) => isNonNegativeInt(i) && i < printPages))).sort((a, b) => a - b);
  if (sorted.length === 0) return { leading: 0, trailing: 0 };
  let leading = leadingRunLength(sorted);
  let trailing = trailingRunLength(sorted, printPages);
  if (leading + trailing > sorted.length) {
    // 전부 protected(선행·후행 구간이 겹침) — 선행으로 본다.
    leading = sorted.length;
    trailing = 0;
  }
  if (leading + trailing !== sorted.length) {
    throw new SheetMapError(
      'INVALID_PROFILE',
      `pages.protectedIndices(${sorted.join(',')})에 선행·후행 구간 밖(중간) 인덱스가 있어 시트 매핑을 정의할 수 없습니다`,
    );
  }
  return { leading, trailing };
}

/** 결과 불변식 — 모든 page 가 0..pageCount-1 안에서 정확히 1회. 위반 시 PAGE_COUNT_MISMATCH. */
export function assertSheetMapCoversPages(sheets: readonly SheetSpec[], pageCount: number): void {
  const seen = new Set<number>();
  const visit = (ref: SheetFaceRef | null, where: string): void => {
    if (ref === null) return;
    if (!isNonNegativeInt(ref.page) || ref.page >= pageCount) {
      throw new SheetMapError('PAGE_COUNT_MISMATCH', `${where} page=${ref.page} 가 0..${pageCount - 1} 범위 밖입니다`);
    }
    if (seen.has(ref.page)) {
      throw new SheetMapError('PAGE_COUNT_MISMATCH', `${where} page=${ref.page} 가 중복 참조됩니다`);
    }
    seen.add(ref.page);
  };
  sheets.forEach((s, i) => {
    if (s.index !== i) throw new SheetMapError('PAGE_COUNT_MISMATCH', `sheets[${i}].index=${s.index} 가 순번과 다릅니다`);
    visit(s.front, `sheets[${i}].front`);
    visit(s.back, `sheets[${i}].back`);
  });
  if (seen.size !== pageCount) {
    throw new SheetMapError('PAGE_COUNT_MISMATCH', `시트가 참조한 페이지 수 ${seen.size} ≠ pageCount ${pageCount}`);
  }
}

export function buildSheetMap(profile: ProductProfile, pageCount: number, opts: BuildSheetMapOptions = {}): SheetSpec[] {
  // ── 입력 검증 ───────────────────────────────────────────────────────────
  if (profile.output?.mode !== 'sheet-map') {
    throw new SheetMapError('INVALID_PROFILE', `output.mode='${String(profile.output?.mode)}' 는 시트 매핑 대상이 아닙니다(sheet-map 만)`);
  }
  if (!isNonNegativeInt(pageCount) || pageCount < 1) {
    throw new SheetMapError('INVALID_PAGE_COUNT', `pageCount=${String(pageCount)} 는 1 이상 정수여야 합니다`);
  }
  const postProcessPages = opts.postProcessPages ?? 0;
  if (!isNonNegativeInt(postProcessPages)) {
    throw new SheetMapError('INVALID_POST_PROCESS', `postProcessPages=${String(postProcessPages)} 는 0 이상 정수여야 합니다`);
  }
  if (postProcessPages >= pageCount) {
    throw new SheetMapError('INVALID_POST_PROCESS', `postProcessPages=${postProcessPages} 는 pageCount=${pageCount} 보다 작아야 합니다(인쇄면 1쪽 이상)`);
  }
  const printPages = pageCount - postProcessPages;

  const { sheet, pages } = profile;
  if (pages.kind === 'fixed' && pages.count !== printPages) {
    throw new SheetMapError('PAGE_COUNT_MISMATCH', `pages.count=${String(pages.count)} 인데 인쇄 페이지 수가 ${printPages} 입니다`);
  }
  if (pages.kind === 'range' && ((pages.min !== undefined && printPages < pages.min) || (pages.max !== undefined && printPages > pages.max))) {
    throw new SheetMapError('PAGE_COUNT_MISMATCH', `인쇄 페이지 수 ${printPages} 가 pages.min/max(${String(pages.min)}~${String(pages.max)}) 밖입니다`);
  }

  const sheets: SheetSpec[] = [];
  const push = (front: SheetFaceRef, back: SheetFaceRef | null, extra: Pick<SheetSpec, 'role'> = {}): void => {
    sheets.push({ index: sheets.length, front, back, ...extra });
  };

  // ── 매핑 ────────────────────────────────────────────────────────────────
  if (sheet.canvasLayout === 'canvas-per-sheet') {
    for (let i = 0; i < printPages; i += 1) push({ page: i }, null);
  } else if (sheet.canvasLayout === 'canvas-pair' && sheet.faces === 2) {
    const rotate = sheet.backRotation;
    const backOf = (page: number): SheetFaceRef => ({ page, rotate });
    const pairing = sheet.pairing;
    if (pairing !== 'same-sheet' && pairing !== 'offset-next') {
      throw new SheetMapError('INVALID_PROFILE', `canvas-pair 는 sheet.pairing(same-sheet|offset-next) 이 필요합니다(현재 ${String(pairing)})`);
    }
    if (sheet.binding === 'center-punch' && pairing !== 'same-sheet') {
      throw new SheetMapError('PAIRING_NOT_ALLOWED', `binding='center-punch' 는 pairing 'same-sheet' 만 허용합니다(현재 ${pairing})`);
    }
    const { leading, trailing } = splitProtected(profile, printPages);

    if (pairing === 'same-sheet') {
      // 표지 단면 선행 → (2m, 2m+1) 짝 → 에필로그 단면 후행
      const pairEnd = printPages - trailing;
      const pairCount = pairEnd - leading;
      if (pairCount < 0 || pairCount % 2 !== 0) {
        throw new SheetMapError(
          'PAGE_COUNT_MISMATCH',
          `same-sheet 짝 대상 ${pairCount}쪽(인쇄 ${printPages} − 표지 ${leading} − 에필로그 ${trailing})이 짝수가 아닙니다`,
        );
      }
      for (let i = 0; i < leading; i += 1) push({ page: i }, null);
      for (let p = leading; p < pairEnd; p += 2) push({ page: p }, backOf(p + 1));
      for (let p = pairEnd; p < printPages; p += 1) push({ page: p }, null);
    } else {
      // offset-next: 표지(0) 뒤에 상1 → 이후 (하k, 상k+1) → 마지막 짝이 없으면 back null
      if (leading !== 1) {
        throw new SheetMapError(
          'INVALID_PROFILE',
          `pairing='offset-next' 는 pages.protectedIndices 선행 표지 1장(인덱스 0)이 필요합니다(현재 ${leading}장)`,
        );
      }
      if (printPages < 2) {
        throw new SheetMapError('PAGE_COUNT_MISMATCH', `offset-next 는 표지 뒤에 붙일 페이지가 필요합니다(인쇄 ${printPages}쪽)`);
      }
      push({ page: 0 }, backOf(1));
      for (let p = 2; p < printPages; p += 2) {
        push({ page: p }, p + 1 < printPages ? backOf(p + 1) : null);
      }
    }
  } else {
    throw new SheetMapError(
      'INVALID_PROFILE',
      `sheet.faces=${String(sheet.faces)} / canvasLayout='${String(sheet.canvasLayout)}' 조합은 시트 매핑이 정의되지 않습니다`,
    );
  }

  // ── 후가공면 분리 ───────────────────────────────────────────────────────
  for (let p = printPages; p < pageCount; p += 1) push({ page: p }, null, { role: 'post-process' });

  assertSheetMapCoversPages(sheets, pageCount);
  return sheets;
}
