/**
 * 템플릿셋 「규격」 카드의 표시용 순수 헬퍼 — 미리보기 수치·도련 토글 저장 매핑·구성 요약.
 *
 * DOM/antd/react 의존 없음. 재단·유효 도련·작업 크기·표지 스프레드 cutSizeMm 은 모두
 * `@storige/types` 의 `resolvePrintGeometry` 결과를 그대로 쓴다(여기서 다시 계산하지 않는다).
 *
 * 저장 원칙: 이 모듈은 저장 필드를 만들지 않는다. 도련 토글을 사용자가 바꿀 때만
 * `bleedFieldsForToggle` 결과를 폼에 넣고, 기존 세트를 열고 그대로 저장하면 값이 바뀌지 않는다.
 */
import {
  assemblePrintTemplates,
  classifyPrintTemplate,
  printKindLabel,
  resolvePrintGeometry,
  type PrintGeometry,
  type PrintGeometrySize,
  type ProductProfile,
  type Template,
} from '@storige/types';

/** 도련 입력 단위(mm) */
export const BLEED_STEP_MM = 0.5;
/** 도련 입력 범위(mm) */
export const BLEED_MIN_MM = 0;
export const BLEED_MAX_MM = 5;
/** 「있음」으로 바꿀 때 기억해 둔 값이 없으면 쓰는 도련(mm) — 폼 기본값과 같다. */
export const DEFAULT_BLEED_ON_MM = 3;
/** 도련 없음 세트의 편집 완료 검증 허용오차(mm) — 세트 허용오차는 도련 있음일 때만 전달된다. */
export const LEGACY_SIZE_TOLERANCE_MM = 1;

/** 도련 토글 변경 시 폼에 넣을 값 — 「없음」= false + 0, 「있음」= true + 값. */
export interface BleedToggleFields {
  cropMarkEnabled: boolean;
  bleedMm: number;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 사용자가 도련 토글을 바꿨을 때의 저장 매핑.
 * - 「없음」(next=false) → cropMarkEnabled false + bleedMm 0
 * - 「있음」(next=true)  → cropMarkEnabled true + 값(현재 값 > 0 이면 그대로, 아니면 기억해 둔 값, 그것도 없으면 3)
 */
export function bleedFieldsForToggle(
  next: boolean,
  currentBleedMm: unknown,
  rememberedBleedMm?: unknown,
): BleedToggleFields {
  if (!next) {
    return { cropMarkEnabled: false, bleedMm: 0 };
  }
  const bleedMm =
    positiveNumber(currentBleedMm) ?? positiveNumber(rememberedBleedMm) ?? DEFAULT_BLEED_ON_MM;
  return { cropMarkEnabled: true, bleedMm };
}

/** 입력 범위·단위를 벗어난 값인지(기존 저장값 안내용 — 저장은 막지 않는다). */
export function isBleedOutOfInputRange(bleedMm: unknown): boolean {
  if (typeof bleedMm !== 'number' || !Number.isFinite(bleedMm)) return false;
  if (bleedMm < BLEED_MIN_MM || bleedMm > BLEED_MAX_MM) return true;
  return Math.abs(bleedMm / BLEED_STEP_MM - Math.round(bleedMm / BLEED_STEP_MM)) > 1e-9;
}

/** 규격 카드 입력 — 폼 값(로드 직후에는 저장값 그대로). */
export interface SpecFormValues {
  width?: number | null;
  height?: number | null;
  bleedMm?: number | null;
  cropMarkEnabled?: boolean | null;
  sizeToleranceMm?: number | null;
}

/** 표지 스프레드 cutSizeMm 표시 — 값의 출처까지 함께 보여 준다. */
export type CoverCutSizeSource =
  /** 도련 있음 — 편집기가 세트 도련 × 2 로 덮어쓴다 */
  | 'set'
  /** 도련 없음 — 표지 템플릿에 저장된 spec.cutSizeMm 이 우선 */
  | 'template'
  /** 도련 없음 — 표지 템플릿에 저장값이 없어 기본값(양변 2) */
  | 'default'
  /** 도련 없음 — 연결된 표지 템플릿을 아직 알 수 없음(템플릿 값이 있으면 그 값이 우선) */
  | 'unknown';

export interface CoverCutSizePreview {
  /** 양변 합(mm) */
  totalMm: number;
  /** 변당(mm) = 양변 합 / 2 */
  perEdgeMm: number;
  source: CoverCutSizeSource;
}

export interface PrintGeometryPreview {
  /** resolvePrintGeometry 결과 그대로 */
  geometry: PrintGeometry;
  /** 저장 필드 bleedMm(유효 도련과 다를 수 있다 — 도련 없음이면 유효 도련은 0) */
  storedBleedMm: number;
  /** 도련 없음인데 저장값이 0 보다 큼 — 「저장값 유지」 안내 대상 */
  storedBleedKept: boolean;
  /** 완료 PDF 페이지 크기 = 작업 크기 */
  pdfPageMm: PrintGeometrySize;
  /** 도련 있음일 때만 TrimBox(= 재단) */
  pdfTrimBoxMm: PrintGeometrySize | null;
  /** 편집 완료 검증에서 통과하는 크기(재단, 도련 있음이면 작업 크기도) */
  validationSizesMm: PrintGeometrySize[];
  validationToleranceMm: number;
  /** 허용오차 출처 — 세트 입력값(도련 있음) | 기본값(도련 없음) */
  validationToleranceSource: 'set' | 'legacy';
  /**
   * 유효 도련 0 이고 상품 프로파일이 없는 세트 — 편집 완료 검증의 기본 도련이 3mm 라
   * 사방 3mm 포함 크기도 통과하고, 재단 크기 PDF 에는 도련 권장 경고가 붙는다.
   * 프로파일 세트는 기본 도련이 0 이라 해당하지 않는다.
   */
  legacyBleedCompat: boolean;
  /** 표지 스프레드가 있는 세트(또는 표지 템플릿을 아직 알 수 없는 책모드 세트)만 */
  coverCutSize: CoverCutSizePreview | null;
}

/** 표지 스프레드 판단에 필요한 템플릿 최소형 */
export type CoverTemplateLike = Pick<Template, 'type' | 'spreadConfig'>;

/**
 * 규격 미리보기 수치. 재단 W/H 가 양수가 아니면 null(입력 전).
 * @param coverTemplate 세트의 기본 표지(assemblePrintTemplates().coverDefault). 모르면 null.
 * @param showCoverWithoutTemplate 표지 템플릿이 없어도 표지 cutSizeMm 을 안내할지
 *   (책모드인데 연결 템플릿 상세를 아직 알 수 없을 때만 true — 표지 없는 세트는 cutSizeMm 을 쓰지 않는다)
 * @param hasProductProfile 상품 프로파일 세트 여부(검증 기본 도련 안내 판단용)
 */
export function buildPrintGeometryPreview(
  values: SpecFormValues,
  coverTemplate: CoverTemplateLike | null,
  showCoverWithoutTemplate: boolean,
  hasProductProfile = false,
): PrintGeometryPreview | null {
  const width = positiveNumber(values.width);
  const height = positiveNumber(values.height);
  if (width === null || height === null) return null;

  const storedBleedMm = typeof values.bleedMm === 'number' ? values.bleedMm : 0;
  const geometry = resolvePrintGeometry({
    width,
    height,
    bleedMm: values.bleedMm,
    cropMarkEnabled: values.cropMarkEnabled,
  });

  const toleranceSource: 'set' | 'legacy' = values.cropMarkEnabled === true ? 'set' : 'legacy';
  const validationToleranceMm =
    toleranceSource === 'set'
      ? typeof values.sizeToleranceMm === 'number'
        ? values.sizeToleranceMm
        : 0.2
      : LEGACY_SIZE_TOLERANCE_MM;

  const validationSizesMm: PrintGeometrySize[] = [geometry.trimMm];
  if (geometry.cropMarks) validationSizesMm.push(geometry.workMm);

  return {
    geometry,
    storedBleedMm,
    storedBleedKept: values.cropMarkEnabled !== true && storedBleedMm > 0,
    pdfPageMm: geometry.workMm,
    pdfTrimBoxMm: geometry.cropMarks ? geometry.trimMm : null,
    validationSizesMm,
    validationToleranceMm,
    validationToleranceSource: toleranceSource,
    legacyBleedCompat: !geometry.cropMarks && !hasProductProfile,
    coverCutSize: resolveCoverCutSize(geometry, coverTemplate, showCoverWithoutTemplate),
  };
}

/**
 * 표지 스프레드 cutSizeMm(양변 합) — 편집기와 같은 우선순위.
 * 도련 있음: 세트 값(resolvePrintGeometry) / 도련 없음: 표지 템플릿 spec.cutSizeMm || 함수 기본값.
 */
function resolveCoverCutSize(
  geometry: PrintGeometry,
  coverTemplate: CoverTemplateLike | null,
  showCoverWithoutTemplate: boolean,
): CoverCutSizePreview | null {
  if (!coverTemplate && !showCoverWithoutTemplate) return null;
  let totalMm = geometry.coverSpreadCutSizeMm;
  let source: CoverCutSizeSource;
  if (geometry.cropMarks) {
    source = 'set';
  } else if (!coverTemplate) {
    source = 'unknown';
  } else {
    const stored = positiveNumber(coverTemplate.spreadConfig?.spec?.cutSizeMm);
    if (stored !== null) {
      totalMm = stored;
      source = 'template';
    } else {
      source = 'default';
    }
  }
  return { totalMm, perEdgeMm: totalMm / 2, source };
}

/** 세트의 기본 표지 템플릿 — 편집기와 같은 규칙(assemblePrintTemplates().coverDefault). */
export function findCoverTemplate<T extends Template>(templates: readonly (T | undefined)[]): T | null {
  const known = templates.filter((t): t is T => !!t);
  return assemblePrintTemplates(known).coverDefault;
}

/** 치수 표기 — 부동소수 잔재 없이 소수 2자리까지. 예: '212 × 152 mm' */
export function formatMmSize(size: PrintGeometrySize): string {
  return `${roundMm(size.w)} × ${roundMm(size.h)} mm`;
}

export function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

// ===== 구성 요약 · 페이지 규칙 (표시만, 저장 필드 없음) =====

export interface CompositionSummaryInput {
  productProfile: ProductProfile | null;
  templates: readonly (Template | undefined)[];
  useEndpaper?: boolean;
  endpaperFrontCount?: number | null;
  endpaperBackCount?: number | null;
  canAddPage?: boolean;
  pageCountMin?: number | null;
  pageCountMax?: number | null;
  pageStep?: number | null;
}

export interface SummaryItem {
  label: string;
  value: string;
}

export interface CompositionSummary {
  /** 'profile' = 상품 프로파일 세트(페이지 규칙 읽기 전용) */
  source: 'profile' | 'book';
  items: SummaryItem[];
  /** 페이지 규칙 한 줄 */
  pageRule: string;
}

const PRODUCT_KIND_LABELS: Record<ProductProfile['kind'], string> = {
  sheet: '낱장',
  calendar: '캘린더',
  'photo-print': '사진인화',
};

function profilePageRule(profile: ProductProfile): string {
  const { pages } = profile;
  if (pages.kind === 'fixed' && typeof pages.count === 'number') {
    return `상품 프로파일에서 관리 (${pages.count}쪽 고정)`;
  }
  const range =
    typeof pages.min === 'number' && typeof pages.max === 'number' ? `${pages.min}~${pages.max}쪽` : '범위';
  const step = pages.step ? `, 증감 ${pages.step}` : '';
  return `상품 프로파일에서 관리 (${range}${step})`;
}

/** 규격 카드의 구성 요약·페이지 규칙. 프로파일 세트는 프로파일 값, 그 밖은 책자 구성을 보여 준다. */
export function buildCompositionSummary(input: CompositionSummaryInput): CompositionSummary {
  const { productProfile } = input;
  if (productProfile) {
    const items: SummaryItem[] = [{ label: '상품', value: PRODUCT_KIND_LABELS[productProfile.kind] }];
    const cal = productProfile.calendar;
    if (productProfile.kind === 'calendar' && cal) {
      const months = cal.monthCount * cal.canvasesPerMonth;
      items.push(
        { label: '표지', value: `${cal.coverCanvases}` },
        { label: '월', value: `${months} (${cal.monthCount}개월 × ${cal.canvasesPerMonth}면)` },
        { label: '에필로그', value: `${cal.epilogueCanvases}` },
      );
    }
    return { source: 'profile', items, pageRule: profilePageRule(productProfile) };
  }

  const known = input.templates.filter((t): t is Template => !!t);
  const assembled = assemblePrintTemplates(known);
  const cover = assembled.coverDefault;
  const coverKind = cover ? classifyPrintTemplate(cover) : null;
  let spine = '-';
  if (coverKind === 'cover-split') spine = '자동 (내지 수에 따라)';
  else if (coverKind === 'cover-fixed') {
    const w = cover?.spreadConfig?.spec?.spineWidthMm;
    spine = typeof w === 'number' ? `고정 ${roundMm(w)}mm` : '고정';
  }
  const endpaper = input.useEndpaper
    ? `앞 ${input.endpaperFrontCount ?? 0} · 뒤 ${input.endpaperBackCount ?? 0}`
    : '없음';
  const inner =
    assembled.innerUnit === 'none'
      ? '없음'
      : `${assembled.innerUnit === 'spread' ? '내지펼침면' : '내지낱장'} ${assembled.innerSeeds.length}장`;

  const items: SummaryItem[] = [
    { label: '표지', value: coverKind ? printKindLabel(coverKind) : '없음' },
    { label: '책등', value: spine },
    { label: '면지', value: endpaper },
    { label: '내지', value: inner },
  ];

  let pageRule: string;
  if (input.canAddPage) {
    const range =
      typeof input.pageCountMin === 'number' && typeof input.pageCountMax === 'number'
        ? `${input.pageCountMin}~${input.pageCountMax}쪽`
        : '범위 미입력';
    const step = typeof input.pageStep === 'number' ? `, 증감 ${input.pageStep}` : '';
    pageRule = `${range}${step}`;
  } else {
    pageRule = '내지 추가 불가';
  }
  return { source: 'book', items, pageRule };
}
