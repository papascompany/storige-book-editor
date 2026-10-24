/**
 * product-profile.ts — 상품별 편집 모드 프로파일 (P1, 2026-10-17)
 *
 * 템플릿셋 `product_profile`(JSON, NULL 허용) 한 속성으로 상품의 편집 방식을 선언한다.
 * 편집기·API·admin 은 `resolveProductProfile()` 결과가 null 이면 기존(legacy) 경로를 그대로 쓰고,
 * 값이 있을 때만 `if (profile)` 가드 안에서 동작을 바꾼다. `EditorMode`·`TemplateSetType`·
 * `PdfOutputMode` 등 기존 enum 은 건드리지 않는다(설계: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §2).
 *
 * P1 범위: kind 'sheet' | 'calendar', output 'single-pdf'. photo-print·sheet-map 은 P2 에서 additive 로 확장.
 * P2-d(2026-10-19): kind 'photo-print' + `photoPrint` 블록(설계 §2.2) + 세션 `metadata.items`(PhotoItem, §3) 추가.
 *
 * 캘린더 상품(오너 확정 2026-10-17): 탁상 4종·벽걸이 1단·2단 모두
 *   캔버스 = 표지(coverCanvases) + 12개월 × canvasesPerMonth + 에필로그(epilogueCanvases)
 *   = 1 + 24 + 1 = 26 (13장 양면), PDF 는 캔버스 순서 그대로 26쪽 단일 파일(홀수=앞면·짝수=뒷면).
 */

// ─── 기본 어휘 ────────────────────────────────────────────────────────────

export const PRODUCT_PROFILE_VERSION = 1 as const;

export type ProductKind = 'sheet' | 'calendar' | 'photo-print';
export type ProductPagesKind = 'fixed' | 'range';
export type ProductPageStep = 1 | 2 | 4;
export type ProductPageLabelRule = 'default' | 'month' | 'sheet' | 'photo';
export type ProductSheetFaces = 1 | 2;
export type ProductCanvasLayout = 'canvas-per-sheet' | 'canvas-pair';
export type ProductSheetBinding = 'none' | 'top-ring' | 'center-punch';
export type ProductSheetPairing = 'same-sheet' | 'offset-next';
export type ProductBackRotation = 0 | 180;
export type ProductDuplexFlip = 'short-edge' | 'long-edge';
/**
 * 출력 모드 — 'single-pdf'(P1, 편집기 산출 그대로) | 'sheet-map'(P2, API 가 `buildSheetMap` 으로
 * 시트 앞/뒤 매핑을 만들어 worker `sheet-map` 잡으로 분리·회전, 설계 §6.2~6.4).
 */
export type ProductOutputMode = 'single-pdf' | 'sheet-map';
/** sheet-map 산출 파일 구성 — per-sheet(시트당 PDF 1개) | merged-duplex(앞·뒤 교대 1파일) */
export type ProductOutputSheetFiles = 'per-sheet' | 'merged-duplex';
export type ProductPostProcessColorRule = 'any' | 'spot-only';
export type CalendarLayout = 'desk' | 'wall-1' | 'wall-2';
export type CalendarWeekStart = 0 | 1;
/**
 * 연달력(그리드 variant 'year', 설계 C8, v1.26) 기간 기준 — 'calendar-year' 기준 연도 1~12월 / 'start-span' 시작연월부터.
 * 정책에 값이 없으면 기본 규칙(`resolveCalendarYearSpan`): 시작연월이 1월이면 'calendar-year', 아니면 'start-span'.
 */
export type CalendarYearSpan = 'calendar-year' | 'start-span';

export const PRODUCT_KINDS: readonly ProductKind[] = ['sheet', 'calendar', 'photo-print'];
export const PRODUCT_PAGE_LABEL_RULES: readonly ProductPageLabelRule[] = ['default', 'month', 'sheet', 'photo'];
export const PRODUCT_CANVAS_LAYOUTS: readonly ProductCanvasLayout[] = ['canvas-per-sheet', 'canvas-pair'];
export const PRODUCT_SHEET_BINDINGS: readonly ProductSheetBinding[] = ['none', 'top-ring', 'center-punch'];
export const PRODUCT_SHEET_PAIRINGS: readonly ProductSheetPairing[] = ['same-sheet', 'offset-next'];
export const PRODUCT_DUPLEX_FLIPS: readonly ProductDuplexFlip[] = ['short-edge', 'long-edge'];
export const PRODUCT_OUTPUT_MODES: readonly ProductOutputMode[] = ['single-pdf', 'sheet-map'];
export const PRODUCT_OUTPUT_SHEET_FILES: readonly ProductOutputSheetFiles[] = ['per-sheet', 'merged-duplex'];
export const CALENDAR_LAYOUTS: readonly CalendarLayout[] = ['desk', 'wall-1', 'wall-2'];
export const CALENDAR_YEAR_SPANS: readonly CalendarYearSpan[] = ['calendar-year', 'start-span'];
/**
 * 기본 규칙의 기준값(오너 답 Q1, 2026-10-24): 기본은 기준 연도 1~12월. 고객이 시작연월을 1월이 아닌 달로 바꾸면
 * 그 달부터의 기간('start-span')으로 바뀐다. 정책 `yearPolicy.span` 을 명시하면 그 값이 그대로 쓰인다.
 */
export const DEFAULT_CALENDAR_YEAR_SPAN: CalendarYearSpan = 'calendar-year';
/** 연달력 한 개가 담는 개월 수. 연도 이동(yearDelta) 1 = 이 개월 수만큼 이동. 16·24·26개월 상품 확장 시에도 연달력 단위는 이 값 */
export const CALENDAR_YEAR_MONTH_COUNT = 12;
/** 연도 이동 허용 절대값 상한(검증용) */
export const CALENDAR_YEAR_DELTA_LIMIT = 2;

// ─── 사진인화 어휘(P2-d, 설계 §2.2) ─────────────────────────────────────────

/** 인화(chemical, 미니랩 단면) | 인쇄(digital, 양면 디지털 인쇄) */
export type PhotoPrintProcess = 'chemical' | 'digital';
/** 구성 — ① 사진별 자유 뒷면 | ② 사진별 고정 뒷면(backTemplateId) | ③ 카드형(앞/뒤 한 쌍) */
export type PhotoPrintComposition = 'per-photo-free-back' | 'per-photo-fixed-back' | 'sheet-cards';
/** 무테 | 유테(사진틀 창을 borderInsetMm 만큼 축소 — 용지 여백 아님, §13-3) */
export type PhotoBorder = 'none' | 'white';
/** 페이퍼풀(용지 가득, cover·잘림) | 이미지풀(사진 전체, contain·여백) — §13-3 */
export type PhotoFit = 'paper-full' | 'image-full';
export type PhotoFinish = 'matte' | 'glossy';

export const PHOTO_PRINT_PROCESSES: readonly PhotoPrintProcess[] = ['chemical', 'digital'];
export const PHOTO_PRINT_COMPOSITIONS: readonly PhotoPrintComposition[] = ['per-photo-free-back', 'per-photo-fixed-back', 'sheet-cards'];
export const PHOTO_BORDERS: readonly PhotoBorder[] = ['none', 'white'];
export const PHOTO_FITS: readonly PhotoFit[] = ['paper-full', 'image-full'];
export const PHOTO_FINISHES: readonly PhotoFinish[] = ['matte', 'glossy'];
/** 유테 시 사진틀 창 축소 기본값(mm). 프로파일 `options.borderInsetMm` 로 덮어쓴다. */
export const DEFAULT_PHOTO_BORDER_INSET_MM = 2;
/** P2 는 1세션 1사이즈(§13-6) — sizes 배열 길이 고정 */
export const PHOTO_PRINT_SIZES_PER_PROFILE = 1;

// ─── 프로파일 구조 ─────────────────────────────────────────────────────────

export interface ProductPagesPolicy {
  kind: ProductPagesKind;
  /** kind='fixed' — 캔버스 수(고정). 편집기는 추가/삭제 버튼을 숨긴다. */
  count?: number;
  /** kind='range' — 캔버스 수 범위 */
  min?: number;
  max?: number;
  /** 증감 단위(templateSet.pageStep 과 같은 의미, 상품별 데이터) */
  step?: ProductPageStep;
  /** 삭제 금지 캔버스 인덱스(표지 등). fixed 에서는 참고용. */
  protectedIndices?: number[];
  /** 페이지 라벨 규칙 — 'month' 는 calendar 프로파일 필요 */
  labelRule: ProductPageLabelRule;
}

export interface ProductSheetPolicy {
  /** 시트 면 수 — 1 단면 / 2 양면 */
  faces: ProductSheetFaces;
  /** faces=1 → 'canvas-per-sheet', faces=2 → 'canvas-pair'(캔버스 [앞, 뒤] 교대) */
  canvasLayout: ProductCanvasLayout;
  binding: ProductSheetBinding;
  /** canvas-pair 전용. 시트 k 의 앞/뒤에 어떤 캔버스가 가는지(설계 §6.3). P1 산출(단일 PDF)에는 영향 없음. */
  pairing?: ProductSheetPairing;
  /** 0 = 뒷면 회전은 RIP 책임(현행 유지) */
  backRotation: ProductBackRotation;
  /** 매니페스트 지시용(산출 무영향) */
  duplexFlip: ProductDuplexFlip;
}

/** 후가공 파일 정책 — 편집기가 만들지 않는다(업로드). */
export interface ProductPostProcessPolicy {
  pages: number;
  source: 'upload';
  colorRule: ProductPostProcessColorRule;
  allowTransparency: boolean;
}

export interface CalendarDisplayOptions {
  holidays: boolean;
  lunar: boolean;
  solarTerms: boolean;
  /**
   * 임시공휴일·선거일(데이터 `temporary: true`, 공표분) 표시 여부(2026-10-17 오너 결정).
   * 기본 false = 법정 공휴일(규정상 공휴일 + 대체공휴일)만 휴일로 표시. 키 없음(기존 저장분)은 false 와 같다.
   */
  temporaryHolidays?: boolean;
  /**
   * 연달력(그리드 variant 'year') 연도 제목 표시(v1.26, 오너 답 Q3). 생략 = true(표시).
   * 템플릿 그리드 `style.showTitle=false` 면 이 값과 무관하게 제목이 없다(제목 자리가 없는 디자인).
   */
  yearTitle?: boolean;
}

export interface CalendarMonthRange {
  /** 'YYYY-MM' */
  from: string;
  /** 'YYYY-MM' */
  to: string;
}

/** 고객 연도 선택 허용 폭 — 시작연도 기준 상대 연도(정수) */
export interface CalendarYearSelectRange {
  minDelta: number;
  maxDelta: number;
}

/**
 * 연달력(그리드 variant 'year', 설계 C8, D2 2026-10-24) 정책(v1.26 additive).
 * 블록 생략 = 기본 규칙(`resolveCalendarYearSpan`)·고객 연도 선택 없음(그리드 extension.yearDelta 그대로).
 */
export interface CalendarYearPolicy {
  /** 'calendar-year' = 기준 연도 1~12월 고정 / 'start-span' = 시작연월부터. 생략 = 기본 규칙(1월 시작이면 calendar-year, 아니면 start-span) */
  span?: CalendarYearSpan;
  /** 생략 = 고객이 연도를 바꿀 수 없음 */
  select?: CalendarYearSelectRange;
}

export interface CalendarProfile {
  layout: CalendarLayout;
  monthCount: 12;
  /** 맨 앞 캔버스 수(표지). 0 허용. */
  coverCanvases: number;
  /** 월마다 캔버스 수 — 1 (월1면) / 2 (앞·뒤 또는 상단·하단) */
  canvasesPerMonth: 1 | 2;
  /** 맨 뒤 캔버스 수(에필로그). 0 허용. */
  epilogueCanvases: number;
  /** canvasesPerMonth=2 일 때 면 라벨. 미지정 시 layout 기본값(desk/wall-1 '앞면·뒷면', wall-2 '상단·하단'). */
  faceLabels?: [string, string];
  /** 시작연월 허용 범위(날짜 데이터 범위 안이어야 함) */
  allowedRange: CalendarMonthRange;
  weekStart: CalendarWeekStart;
  /** 기본 표기 옵션(세션에서 사용자가 바꿀 수 있음) */
  show: CalendarDisplayOptions;
  /** 날짜 데이터 버전(CALENDAR_DATA_VERSIONS 키). 세션은 이 값을 고정 저장한다. */
  dataVersion: string;
  /** 연달력 정책(v1.26 additive). 생략 = 기본 규칙·고객 연도 선택 없음 */
  yearPolicy?: CalendarYearPolicy;
}

export interface PhotoPrintSize {
  /** 사이즈 코드(호스트·매니페스트 식별용, 예: '4x6'). 영숫자·'_'·'-' 1~32자 */
  code: string;
  widthMm: number;
  heightMm: number;
  /** 저해상 경고 기준(ImageDpiWarningPlugin) — 미달 시 items[].lowRes=true, 완료 차단 없음 */
  minDpi: number;
}

/** 옵션 허용 어휘. 배열은 비어 있지 않아야 하며 첫 원소가 세션 기본값이다. */
export interface PhotoPrintOptionsPolicy {
  border: PhotoBorder[];
  fit: PhotoFit[];
  finish: PhotoFinish[];
  /** 밝기 보정 제공 여부(통과만 — 편집기 미리보기 미적용) */
  brightnessFix: boolean;
  /** 촬영일 표기 제공 여부(편집기 소비 — 'date-overlay' 텍스트) */
  dateOverlay: boolean;
  /** 흑백 제공 여부(편집기 소비 — Grayscale 필터) */
  grayscale: boolean;
  /** 유테 시 사진틀 창 축소 mm(기본 DEFAULT_PHOTO_BORDER_INSET_MM=2) */
  borderInsetMm?: number;
}

export interface PhotoPrintCopiesPolicy {
  min: number;
  max: number;
}

export interface PhotoPrintUploadPolicy {
  maxPhotos: number;
  maxMb: number;
}

/**
 * 사진인화 프로파일(kind='photo-print' 전용). 옵션 소비 경계(§2.2 고정): 편집기 소비 = border·fit·dateOverlay·grayscale,
 * 통과만 = finish·brightnessFix·copies(세션 metadata.items — 가격·제작은 호스트/인쇄 책임).
 */
export interface PhotoPrintProfile {
  process: PhotoPrintProcess;
  composition: PhotoPrintComposition;
  /** P2 는 정확히 1개(§13-6). items[].sizeCode 는 sizes[0].code 로 고정. */
  sizes: PhotoPrintSize[];
  options: PhotoPrintOptionsPolicy;
  copies: PhotoPrintCopiesPolicy;
  /** composition='per-photo-fixed-back' 필수 — 뒷면 고정 템플릿 id */
  backTemplateId?: string;
  upload: PhotoPrintUploadPolicy;
}

export interface ProductOutputPolicy {
  mode: ProductOutputMode;
  /** mode='sheet-map' 전용. 생략 = 'per-sheet'. single-pdf 에서는 지정 금지. */
  sheetFiles?: ProductOutputSheetFiles;
}

export interface ProductProfile {
  version: typeof PRODUCT_PROFILE_VERSION;
  kind: ProductKind;
  /** 보조 라벨(자유 코드, 예: 'calendar_desk_large'). 분류·운영 식별용 — 동작 분기 금지. */
  editorType: string;
  pages: ProductPagesPolicy;
  sheet: ProductSheetPolicy;
  postProcess?: ProductPostProcessPolicy;
  calendar?: CalendarProfile;
  /** kind='photo-print' 전용(P2-d) */
  photoPrint?: PhotoPrintProfile;
  output: ProductOutputPolicy;
}

// ─── 날짜 데이터 버전 레지스트리 ───────────────────────────────────────────

export interface CalendarDataVersionInfo {
  range: CalendarMonthRange;
  /** 출처·검증 메모(사람용) */
  note: string;
}

/**
 * 편집기(canvas-core 정적 데이터)와 API·admin 검증이 공유하는 버전 → 범위 표.
 * 데이터 파일을 갱신하면 여기에 새 버전을 추가하고 기존 항목은 남긴다(세션 재현성).
 */
export const CALENDAR_DATA_VERSIONS: Readonly<Record<string, CalendarDataVersionInfo>> = {
  'kr-2025-2035-v1': {
    range: { from: '2025-01', to: '2035-12' },
    note: '한국 공휴일·대체공휴일·24절기·음력 환산표 2025~2035 (정적 내장, 오너 승인 릴리스)',
  },
};

export const DEFAULT_CALENDAR_DATA_VERSION = 'kr-2025-2035-v1';

// ─── 세션 메타(edit_sessions.metadata.calendar) ───────────────────────────

export interface CalendarAnniversaryStyle {
  fontFamily?: string;
  fontSize?: number;
  fill?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right';
}

export interface CalendarAnniversary {
  id: string;
  /** 'YYYY-MM-DD'. lunar=true 면 음력 날짜(윤달은 isLeapMonth). */
  date: string;
  lunar: boolean;
  isLeapMonth?: boolean;
  text: string;
  style?: CalendarAnniversaryStyle;
}

/** 고객이 고른 표지·에필로그 연달력 연도 이동(시작연도 기준 상대값 — 시작연월을 바꿔도 상대값 유지, 오너 답 Q4) */
export interface CalendarYearDeltas {
  cover?: number;
  epilogue?: number;
}

export interface CalendarSessionMeta {
  startYear: number;
  /** 1~12 */
  startMonth: number;
  show: CalendarDisplayOptions;
  anniversaries: CalendarAnniversary[];
  dataVersion: string;
  /** v1.26 additive. 프로파일 yearPolicy.select 가 있는 세트에서만 편집기가 기록. 생략 = 템플릿 값(extension.yearDelta) */
  yearDeltas?: CalendarYearDeltas;
}

// ─── 세션 메타(edit_sessions.metadata.items) — 사진인화 항목 ─────────────────

/**
 * 사진 1장(= 주문 항목 1건)의 선택값. 편집기가 저장·완료 시 완전형으로 기록하고,
 * `editor.complete`/deliverables `items` 와 sheet-map `sheets[].copies` 의 원천이 된다(§3, 계약 v1.25).
 */
export interface PhotoItem {
  /** 항목 순번(0부터) */
  index: number;
  /** 앞면 캔버스 인덱스 — resolvePhotoItemCanvasIndex 와 같은 값 */
  canvasIndex: number;
  /** 업로드 레코드·외부 사진 id(있으면) */
  sourcePhotoId?: string;
  /** sizes[0].code 고정(P2) */
  sizeCode: string;
  copies: number;
  border: PhotoBorder;
  fit: PhotoFit;
  finish: PhotoFinish;
  brightnessFix: boolean;
  dateOverlay: boolean;
  grayscale: boolean;
  /** minDpi 미달 경고(완료 차단 없음 — 호스트 판단) */
  lowRes: boolean;
}

/** 런처 `items` 입력(부분형). 편집기가 readPhotoItems 로 정제해 완전형으로 덮어쓴다. */
export type PhotoItemInput = Partial<Omit<PhotoItem, 'index' | 'canvasIndex' | 'lowRes'>>;

/** `editor.complete` additive `product` 키 */
export interface ProductCompleteSummary {
  kind: ProductKind;
  editorType: string;
  canvasCount: number;
  sheetCount: number;
  faces: ProductSheetFaces;
}

// ─── 판정 ──────────────────────────────────────────────────────────────────

export interface ProductProfileSource {
  productProfile?: ProductProfile | null;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown, min = Number.NEGATIVE_INFINITY): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min;
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function oneOf<T>(v: unknown, set: readonly T[]): v is T {
  return (set as readonly unknown[]).includes(v);
}

function compareMonth(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 프로파일 JSON(unknown) 검증 — 오류 메시지 배열(빈 배열 = 유효).
 * API DTO custom validator·admin JSON 섹션·편집기가 같은 함수를 쓴다.
 */
export function validateProductProfile(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) return ['프로파일은 객체여야 합니다'];
  const p = input;

  if (p.version !== PRODUCT_PROFILE_VERSION) errors.push(`version 은 ${PRODUCT_PROFILE_VERSION} 이어야 합니다`);
  if (!oneOf(p.kind, PRODUCT_KINDS)) errors.push(`kind 는 ${PRODUCT_KINDS.join('|')} 중 하나여야 합니다`);
  if (typeof p.editorType !== 'string' || !/^[a-z0-9_]{1,64}$/.test(p.editorType)) {
    errors.push('editorType 은 소문자·숫자·밑줄 1~64자여야 합니다');
  }

  // pages
  const pages = p.pages;
  if (!isRecord(pages)) {
    errors.push('pages 가 필요합니다');
  } else {
    if (pages.kind === 'fixed') {
      if (!isInt(pages.count, 1)) errors.push('pages.count 는 1 이상 정수여야 합니다');
    } else if (pages.kind === 'range') {
      if (!isInt(pages.min, 1) || !isInt(pages.max, 1) || (pages.min as number) > (pages.max as number)) {
        errors.push('pages.min/max 는 1 이상 정수이고 min<=max 여야 합니다');
      }
    } else {
      errors.push("pages.kind 는 'fixed'|'range' 여야 합니다");
    }
    if (pages.step !== undefined && !oneOf(pages.step, [1, 2, 4] as const)) errors.push('pages.step 은 1|2|4 여야 합니다');
    if (pages.protectedIndices !== undefined) {
      const pi = pages.protectedIndices;
      if (!Array.isArray(pi) || !pi.every((i) => isInt(i, 0)) || new Set(pi).size !== pi.length) {
        errors.push('pages.protectedIndices 는 중복 없는 0 이상 정수 배열이어야 합니다');
      } else if (pages.kind === 'fixed' && isInt(pages.count, 1) && pi.some((i) => (i as number) >= (pages.count as number))) {
        errors.push('pages.protectedIndices 는 pages.count 미만이어야 합니다');
      }
    }
    if (!oneOf(pages.labelRule, PRODUCT_PAGE_LABEL_RULES)) {
      errors.push(`pages.labelRule 은 ${PRODUCT_PAGE_LABEL_RULES.join('|')} 중 하나여야 합니다`);
    }
  }

  // sheet
  const sheet = p.sheet;
  if (!isRecord(sheet)) {
    errors.push('sheet 가 필요합니다');
  } else {
    if (!oneOf(sheet.faces, [1, 2] as const)) errors.push('sheet.faces 는 1|2 여야 합니다');
    if (!oneOf(sheet.canvasLayout, PRODUCT_CANVAS_LAYOUTS)) {
      errors.push(`sheet.canvasLayout 은 ${PRODUCT_CANVAS_LAYOUTS.join('|')} 중 하나여야 합니다`);
    } else if (sheet.faces === 1 && sheet.canvasLayout !== 'canvas-per-sheet') {
      errors.push("sheet.faces=1 이면 canvasLayout 은 'canvas-per-sheet' 여야 합니다");
    } else if (sheet.faces === 2 && sheet.canvasLayout !== 'canvas-pair') {
      errors.push("sheet.faces=2 이면 canvasLayout 은 'canvas-pair' 여야 합니다");
    }
    if (!oneOf(sheet.binding, PRODUCT_SHEET_BINDINGS)) {
      errors.push(`sheet.binding 은 ${PRODUCT_SHEET_BINDINGS.join('|')} 중 하나여야 합니다`);
    }
    if (sheet.canvasLayout === 'canvas-pair') {
      if (!oneOf(sheet.pairing, PRODUCT_SHEET_PAIRINGS)) {
        errors.push(`canvas-pair 는 sheet.pairing(${PRODUCT_SHEET_PAIRINGS.join('|')}) 이 필요합니다`);
      } else if (sheet.binding === 'center-punch' && sheet.pairing !== 'same-sheet') {
        errors.push("sheet.binding='center-punch' 는 pairing 'same-sheet' 만 허용합니다");
      }
    } else if (sheet.pairing !== undefined) {
      errors.push('sheet.pairing 은 canvas-pair 에서만 지정합니다');
    }
    if (!oneOf(sheet.backRotation, [0, 180] as const)) errors.push('sheet.backRotation 은 0|180 이어야 합니다');
    if (!oneOf(sheet.duplexFlip, PRODUCT_DUPLEX_FLIPS)) {
      errors.push(`sheet.duplexFlip 은 ${PRODUCT_DUPLEX_FLIPS.join('|')} 중 하나여야 합니다`);
    }
    if (sheet.faces === 2 && isRecord(pages) && pages.kind === 'fixed' && isInt(pages.count, 1) && pages.count % 2 !== 0) {
      errors.push('sheet.faces=2 이면 pages.count 는 짝수여야 합니다');
    }
  }

  // postProcess
  if (p.postProcess !== undefined) {
    const pp = p.postProcess;
    if (!isRecord(pp)) {
      errors.push('postProcess 는 객체여야 합니다');
    } else {
      if (!isInt(pp.pages, 1)) errors.push('postProcess.pages 는 1 이상 정수여야 합니다');
      if (pp.source !== 'upload') errors.push("postProcess.source 는 'upload' 여야 합니다");
      if (!oneOf(pp.colorRule, ['any', 'spot-only'] as const)) errors.push("postProcess.colorRule 은 'any'|'spot-only' 여야 합니다");
      if (!isBool(pp.allowTransparency)) errors.push('postProcess.allowTransparency 는 boolean 이어야 합니다');
    }
  }

  // calendar
  const cal = p.calendar;
  if (p.kind === 'calendar') {
    if (!isRecord(cal)) {
      errors.push("kind='calendar' 는 calendar 프로파일이 필요합니다");
    } else {
      if (!oneOf(cal.layout, CALENDAR_LAYOUTS)) errors.push(`calendar.layout 은 ${CALENDAR_LAYOUTS.join('|')} 중 하나여야 합니다`);
      if (cal.monthCount !== 12) errors.push('calendar.monthCount 는 12 여야 합니다');
      if (!isInt(cal.coverCanvases, 0)) errors.push('calendar.coverCanvases 는 0 이상 정수여야 합니다');
      if (!oneOf(cal.canvasesPerMonth, [1, 2] as const)) errors.push('calendar.canvasesPerMonth 는 1|2 여야 합니다');
      if (!isInt(cal.epilogueCanvases, 0)) errors.push('calendar.epilogueCanvases 는 0 이상 정수여야 합니다');
      if (cal.faceLabels !== undefined) {
        const fl = cal.faceLabels;
        if (!Array.isArray(fl) || fl.length !== 2 || !fl.every((s) => typeof s === 'string' && s.trim().length > 0)) {
          errors.push('calendar.faceLabels 는 비어 있지 않은 문자열 2개 배열이어야 합니다');
        }
      }
      const range = cal.allowedRange;
      if (!isRecord(range) || typeof range.from !== 'string' || typeof range.to !== 'string'
        || !MONTH_RE.test(range.from) || !MONTH_RE.test(range.to)) {
        errors.push("calendar.allowedRange.from/to 는 'YYYY-MM' 형식이어야 합니다");
      } else if (compareMonth(range.from, range.to) > 0) {
        errors.push('calendar.allowedRange.from 은 to 이전이거나 같아야 합니다');
      } else if (typeof cal.dataVersion === 'string' && CALENDAR_DATA_VERSIONS[cal.dataVersion]) {
        // 시작연월 + 12개월 전체가 데이터 범위 안이어야 한다.
        const data = CALENDAR_DATA_VERSIONS[cal.dataVersion].range;
        const lastMonth = addMonthsToKey(range.to, 11);
        if (compareMonth(range.from, data.from) < 0 || compareMonth(lastMonth, data.to) > 0) {
          errors.push(`calendar.allowedRange(시작연월+11개월)는 데이터 범위 ${data.from}~${data.to} 안이어야 합니다`);
        }
      }
      if (!oneOf(cal.weekStart, [0, 1] as const)) errors.push('calendar.weekStart 는 0|1 이어야 합니다');
      const show = cal.show;
      if (!isRecord(show) || !isBool(show.holidays) || !isBool(show.lunar) || !isBool(show.solarTerms)) {
        errors.push('calendar.show.holidays/lunar/solarTerms 는 boolean 이어야 합니다');
      } else if (show.temporaryHolidays !== undefined && !isBool(show.temporaryHolidays)) {
        errors.push('calendar.show.temporaryHolidays 는 생략하거나 boolean 이어야 합니다');
      }
      if (typeof cal.dataVersion !== 'string' || !CALENDAR_DATA_VERSIONS[cal.dataVersion]) {
        errors.push(`calendar.dataVersion 은 ${Object.keys(CALENDAR_DATA_VERSIONS).join('|')} 중 하나여야 합니다`);
      }
      // pages 정합: fixed + count = cover + 12 × perMonth + epilogue, labelRule 'month'
      if (isRecord(pages)) {
        if (pages.kind !== 'fixed') errors.push("calendar 프로파일은 pages.kind='fixed' 여야 합니다");
        if (pages.labelRule !== 'month') errors.push("calendar 프로파일은 pages.labelRule='month' 여야 합니다");
        if (isInt(cal.coverCanvases, 0) && oneOf(cal.canvasesPerMonth, [1, 2] as const) && isInt(cal.epilogueCanvases, 0)
          && pages.kind === 'fixed' && isInt(pages.count, 1)) {
          const expected = cal.coverCanvases + 12 * cal.canvasesPerMonth + cal.epilogueCanvases;
          if (pages.count !== expected) {
            errors.push(`pages.count(${pages.count})는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = ${expected} 여야 합니다`);
          }
        }
      }
      // v1.26 연달력 — 기존 메시지 순서를 바꾸지 않도록 calendar 블록 맨 끝에서 검사한다(키 생략 = 검사·메시지 0).
      if (isRecord(show) && show.yearTitle !== undefined && !isBool(show.yearTitle)) {
        errors.push('calendar.show.yearTitle 은 생략하거나 boolean 이어야 합니다');
      }
      if (cal.yearPolicy !== undefined) validateCalendarYearPolicy(cal.yearPolicy, range, cal.dataVersion, errors);
    }
  } else if (cal !== undefined) {
    errors.push("calendar 프로파일은 kind='calendar' 에서만 지정합니다");
  } else if (isRecord(pages) && pages.labelRule === 'month') {
    errors.push("pages.labelRule='month' 는 kind='calendar' 에서만 쓸 수 있습니다");
  }

  // output
  const out = p.output;
  if (!isRecord(out) || !oneOf(out.mode, PRODUCT_OUTPUT_MODES)) {
    // 문구는 P1 계약(테스트 고정) 유지. 허용값은 PRODUCT_OUTPUT_MODES('single-pdf' | 'sheet-map').
    errors.push("output.mode 는 'single-pdf' 또는 'sheet-map' 여야 합니다");
  } else {
    if (out.sheetFiles !== undefined) {
      if (!oneOf(out.sheetFiles, PRODUCT_OUTPUT_SHEET_FILES)) {
        errors.push(`output.sheetFiles 는 ${PRODUCT_OUTPUT_SHEET_FILES.join('|')} 중 하나여야 합니다`);
      } else if (out.mode !== 'sheet-map') {
        errors.push("output.sheetFiles 는 output.mode='sheet-map' 에서만 지정합니다");
      }
    }
    // sheet-map 결합 규칙(설계 §6.3): canvas-per-sheet 또는 faces=2 + canvas-pair 만 시트 매핑이 정의된다.
    // center-punch ↔ same-sheet 제한은 위 sheet 절에서 출력 모드와 무관하게 검사한다. calendar kind 는 허용(벽걸이 (나)).
    if (out.mode === 'sheet-map' && isRecord(sheet)) {
      const perSheet = sheet.canvasLayout === 'canvas-per-sheet';
      const pair = sheet.faces === 2 && sheet.canvasLayout === 'canvas-pair';
      if (!perSheet && !pair) {
        errors.push("output.mode='sheet-map' 은 sheet.canvasLayout 'canvas-per-sheet' 또는 faces=2 + 'canvas-pair' 에서만 허용합니다");
      }
    }
  }

  // photoPrint (P2-d) — 기존 kind 의 메시지 순서를 바꾸지 않도록 마지막에 검사한다.
  const photo = p.photoPrint;
  if (p.kind === 'photo-print') {
    if (!isRecord(photo)) {
      errors.push("kind='photo-print' 는 photoPrint 프로파일이 필요합니다");
    } else {
      validatePhotoPrintBlock(photo, pages, sheet, out, errors);
    }
  } else if (photo !== undefined) {
    errors.push("photoPrint 프로파일은 kind='photo-print' 에서만 지정합니다");
  } else if (isRecord(pages) && pages.labelRule === 'photo') {
    errors.push("pages.labelRule='photo' 는 kind='photo-print' 에서만 쓸 수 있습니다");
  }

  return errors;
}

/**
 * calendar.yearPolicy(v1.26). 데이터 범위 검사: 허용 시작연월 전체(allowedRange)·허용 연도 폭(select) 전체의
 * 연달력 기간이 날짜 데이터 범위 안이어야 한다(기간은 시작연월에 대해 단조 증가 — 양 끝만 보면 된다).
 */
function validateCalendarYearPolicy(policy: unknown, range: unknown, dataVersion: unknown, errors: string[]): void {
  if (!isRecord(policy)) {
    errors.push('calendar.yearPolicy 는 객체여야 합니다');
    return;
  }
  const spanOk = policy.span === undefined || oneOf(policy.span, CALENDAR_YEAR_SPANS);
  if (!spanOk) errors.push(`calendar.yearPolicy.span 은 생략하거나 ${CALENDAR_YEAR_SPANS.join('|')} 중 하나여야 합니다`);
  const select = policy.select;
  if (select === undefined) return;
  if (!isRecord(select)) {
    errors.push('calendar.yearPolicy.select 는 객체여야 합니다');
    return;
  }
  const lim = CALENDAR_YEAR_DELTA_LIMIT;
  const inLimit = (v: unknown): v is number => isInt(v, -lim) && v <= lim;
  if (!inLimit(select.minDelta) || !inLimit(select.maxDelta)) {
    errors.push(`calendar.yearPolicy.select.minDelta/maxDelta 는 -${lim}~${lim} 정수여야 합니다`);
    return;
  }
  if (select.minDelta > select.maxDelta) {
    errors.push('calendar.yearPolicy.select.minDelta 는 maxDelta 이하여야 합니다');
    return;
  }
  if (!spanOk || !isRecord(range) || typeof range.from !== 'string' || typeof range.to !== 'string') return;
  const from = parseMonthKey(range.from);
  const to = parseMonthKey(range.to);
  if (!from || !to || compareMonth(range.from, range.to) > 0) return;
  if (typeof dataVersion !== 'string' || !CALENDAR_DATA_VERSIONS[dataVersion]) return;
  const data = CALENDAR_DATA_VERSIONS[dataVersion].range;
  const span = policy.span as CalendarYearSpan | undefined;
  const a = formatMonthKey(resolveCalendarYearStart(span, from, select.minDelta));
  const b = formatMonthKey(addMonths(resolveCalendarYearStart(span, to, select.maxDelta), CALENDAR_YEAR_MONTH_COUNT - 1));
  if (compareMonth(a, data.from) < 0 || compareMonth(b, data.to) > 0) {
    errors.push(`calendar.yearPolicy.select 연달력 범위(${a}~${b})는 데이터 범위 ${data.from}~${data.to} 안이어야 합니다`);
  }
}

const PHOTO_SIZE_CODE_RE = /^[A-Za-z0-9_-]{1,32}$/;

function isFiniteNumber(v: unknown, min = Number.NEGATIVE_INFINITY): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= min;
}

function isVocabList<T>(v: unknown, vocab: readonly T[]): v is T[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => oneOf(x, vocab)) && new Set(v).size === v.length;
}

/**
 * photoPrint 블록 + 결합 규칙(계약 결정 3):
 *   chemical ⇒ sheet.faces 1(+canvas-per-sheet) + composition 'per-photo-free-back' + output 'single-pdf'
 *   digital  ⇒ sheet.faces 2(+canvas-pair) + pairing 'same-sheet' + pages.step 2 + pages.min/max 짝수
 *   'per-photo-fixed-back' ⇒ backTemplateId 필수 · pages.kind 는 'range' 만. backRotation 은 강제하지 않는다(오너 결정 0).
 */
function validatePhotoPrintBlock(
  photo: Record<string, unknown>,
  pages: unknown,
  sheet: unknown,
  out: unknown,
  errors: string[],
): void {
  const process = photo.process;
  if (!oneOf(process, PHOTO_PRINT_PROCESSES)) {
    errors.push(`photoPrint.process 는 ${PHOTO_PRINT_PROCESSES.join('|')} 중 하나여야 합니다`);
  }
  const composition = photo.composition;
  if (!oneOf(composition, PHOTO_PRINT_COMPOSITIONS)) {
    errors.push(`photoPrint.composition 은 ${PHOTO_PRINT_COMPOSITIONS.join('|')} 중 하나여야 합니다`);
  }

  const sizes = photo.sizes;
  if (!Array.isArray(sizes) || sizes.length !== PHOTO_PRINT_SIZES_PER_PROFILE) {
    errors.push(`photoPrint.sizes 는 정확히 ${PHOTO_PRINT_SIZES_PER_PROFILE}개여야 합니다(P2: 1세션 1사이즈)`);
  } else {
    sizes.forEach((size, i) => {
      if (!isRecord(size)) {
        errors.push(`photoPrint.sizes[${i}] 는 객체여야 합니다`);
        return;
      }
      if (typeof size.code !== 'string' || !PHOTO_SIZE_CODE_RE.test(size.code)) {
        errors.push(`photoPrint.sizes[${i}].code 는 영숫자·'_'·'-' 1~32자여야 합니다`);
      }
      if (!isFiniteNumber(size.widthMm) || size.widthMm <= 0 || !isFiniteNumber(size.heightMm) || size.heightMm <= 0) {
        errors.push(`photoPrint.sizes[${i}].widthMm/heightMm 는 0보다 큰 숫자여야 합니다`);
      }
      if (!isInt(size.minDpi, 1)) errors.push(`photoPrint.sizes[${i}].minDpi 는 1 이상 정수여야 합니다`);
    });
  }

  const options = photo.options;
  if (!isRecord(options)) {
    errors.push('photoPrint.options 가 필요합니다');
  } else {
    if (!isVocabList(options.border, PHOTO_BORDERS)) {
      errors.push(`photoPrint.options.border 는 ${PHOTO_BORDERS.join('|')} 의 중복 없는 비어 있지 않은 배열이어야 합니다`);
    }
    if (!isVocabList(options.fit, PHOTO_FITS)) {
      errors.push(`photoPrint.options.fit 은 ${PHOTO_FITS.join('|')} 의 중복 없는 비어 있지 않은 배열이어야 합니다`);
    }
    if (!isVocabList(options.finish, PHOTO_FINISHES)) {
      errors.push(`photoPrint.options.finish 는 ${PHOTO_FINISHES.join('|')} 의 중복 없는 비어 있지 않은 배열이어야 합니다`);
    }
    if (!isBool(options.brightnessFix) || !isBool(options.dateOverlay) || !isBool(options.grayscale)) {
      errors.push('photoPrint.options.brightnessFix/dateOverlay/grayscale 는 boolean 이어야 합니다');
    }
    if (options.borderInsetMm !== undefined && !isFiniteNumber(options.borderInsetMm, 0)) {
      errors.push('photoPrint.options.borderInsetMm 는 생략하거나 0 이상 숫자여야 합니다');
    }
  }

  const copies = photo.copies;
  if (!isRecord(copies) || !isInt(copies.min, 1) || !isInt(copies.max, 1) || copies.min > copies.max) {
    errors.push('photoPrint.copies.min/max 는 1 이상 정수이고 min<=max 여야 합니다');
  }

  if (photo.backTemplateId !== undefined && (typeof photo.backTemplateId !== 'string' || photo.backTemplateId.trim().length === 0)) {
    errors.push('photoPrint.backTemplateId 는 생략하거나 비어 있지 않은 문자열이어야 합니다');
  } else if (composition === 'per-photo-fixed-back' && photo.backTemplateId === undefined) {
    errors.push("photoPrint.composition='per-photo-fixed-back' 은 backTemplateId 가 필요합니다");
  }

  const upload = photo.upload;
  if (!isRecord(upload) || !isInt(upload.maxPhotos, 1) || !isFiniteNumber(upload.maxMb) || upload.maxMb <= 0) {
    errors.push('photoPrint.upload.maxPhotos 는 1 이상 정수, maxMb 는 0보다 큰 숫자여야 합니다');
  }

  // pages 결합: range 만(사진 수는 사용자가 정한다). protectedIndices 는 금지 — 선행 보호 캔버스가 있으면
  // same-sheet 매핑(digital)이 앞·뒤 짝을 어긋나게 하고(PAGE_COUNT_MISMATCH 또는 조용한 단면 분리) 사진 번호 체계와도 어긋난다.
  if (isRecord(pages)) {
    if (pages.kind !== 'range') {
      errors.push("photo-print 프로파일은 pages.kind='range' 여야 합니다");
    }
    if (Array.isArray(pages.protectedIndices) && pages.protectedIndices.length > 0) {
      errors.push('photo-print 프로파일은 pages.protectedIndices 를 지정할 수 없습니다');
    }
  }

  // process 결합(faces 가 올바를 때만 — canvasLayout 정합은 sheet 절이 이미 검사한다)
  if (process === 'chemical') {
    if (isRecord(sheet) && oneOf(sheet.faces, [1, 2] as const) && sheet.faces !== 1) {
      errors.push("photoPrint.process='chemical' 은 sheet.faces=1(canvas-per-sheet) 이어야 합니다");
    }
    if (oneOf(composition, PHOTO_PRINT_COMPOSITIONS) && composition !== 'per-photo-free-back') {
      errors.push("photoPrint.process='chemical' 은 composition 'per-photo-free-back' 만 허용합니다");
    }
    if (isRecord(out) && oneOf(out.mode, PRODUCT_OUTPUT_MODES) && out.mode !== 'single-pdf') {
      errors.push("photoPrint.process='chemical' 은 output.mode='single-pdf' 여야 합니다");
    }
  } else if (process === 'digital') {
    if (isRecord(sheet)) {
      if (oneOf(sheet.faces, [1, 2] as const) && sheet.faces !== 2) {
        errors.push("photoPrint.process='digital' 은 sheet.faces=2(canvas-pair) 이어야 합니다");
      } else if (sheet.canvasLayout === 'canvas-pair' && oneOf(sheet.pairing, PRODUCT_SHEET_PAIRINGS) && sheet.pairing !== 'same-sheet') {
        errors.push("photoPrint.process='digital' 은 sheet.pairing 'same-sheet' 만 허용합니다");
      }
    }
    if (isRecord(pages) && pages.kind === 'range') {
      if (pages.step !== 2) errors.push("photoPrint.process='digital' 은 pages.step=2 여야 합니다");
      if ((isInt(pages.min, 1) && pages.min % 2 !== 0) || (isInt(pages.max, 1) && pages.max % 2 !== 0)) {
        errors.push("photoPrint.process='digital' 은 pages.min/max 가 짝수여야 합니다");
      }
    }
  }
}

/**
 * 템플릿셋(또는 세션 스냅샷) → 프로파일. NULL/미정의 → null(legacy 경로).
 * 버전 불일치·검증 실패도 null 로 떨어뜨리고 경고만 남긴다(기존 세트 바이트 동일 보장).
 */
export function resolveProductProfile(
  source: ProductProfileSource | null | undefined,
  warn: (message: string) => void = (m) => console.warn(m),
): ProductProfile | null {
  const raw = source?.productProfile;
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw) || raw.version !== PRODUCT_PROFILE_VERSION) {
    warn(`[product-profile] 지원하지 않는 version(${isRecord(raw) ? String(raw.version) : typeof raw}) — legacy 경로로 동작`);
    return null;
  }
  const errors = validateProductProfile(raw);
  if (errors.length > 0) {
    warn(`[product-profile] 검증 실패 — legacy 경로로 동작: ${errors.join('; ')}`);
    return null;
  }
  return raw as unknown as ProductProfile;
}

// ─── 캘린더 캔버스 매핑(순수 함수) ─────────────────────────────────────────

export type CalendarCanvasRole = 'cover' | 'month' | 'epilogue';

export interface CalendarCanvasSlot {
  role: CalendarCanvasRole;
  /** role='month' — 시작연월 기준 상대 월(0~11) */
  monthOffset?: number;
  /** role='month' & canvasesPerMonth=2 — 0 첫 면 / 1 둘째 면 */
  face?: 0 | 1;
  /** role='cover'|'epilogue' — 그 역할 안에서의 순번(0부터) */
  ordinal?: number;
}

export function resolveCalendarCanvasCount(cal: Pick<CalendarProfile, 'coverCanvases' | 'canvasesPerMonth' | 'epilogueCanvases'>): number {
  return cal.coverCanvases + 12 * cal.canvasesPerMonth + cal.epilogueCanvases;
}

/** 캔버스 인덱스 → 역할. 범위 밖이면 null. */
export function resolveCalendarCanvasSlot(
  cal: Pick<CalendarProfile, 'coverCanvases' | 'canvasesPerMonth' | 'epilogueCanvases'>,
  canvasIndex: number,
): CalendarCanvasSlot | null {
  if (!Number.isInteger(canvasIndex) || canvasIndex < 0) return null;
  if (canvasIndex < cal.coverCanvases) return { role: 'cover', ordinal: canvasIndex };
  const monthStart = cal.coverCanvases;
  const monthEnd = monthStart + 12 * cal.canvasesPerMonth; // exclusive
  if (canvasIndex < monthEnd) {
    const rel = canvasIndex - monthStart;
    const monthOffset = Math.floor(rel / cal.canvasesPerMonth);
    const face = (rel % cal.canvasesPerMonth) as 0 | 1;
    return cal.canvasesPerMonth === 2 ? { role: 'month', monthOffset, face } : { role: 'month', monthOffset };
  }
  const epi = canvasIndex - monthEnd;
  if (epi < cal.epilogueCanvases) return { role: 'epilogue', ordinal: epi };
  return null;
}

export interface YearMonth {
  year: number;
  /** 1~12 */
  month: number;
}

export function addMonths(start: YearMonth, offset: number): YearMonth {
  const idx = start.year * 12 + (start.month - 1) + offset;
  return { year: Math.floor(idx / 12), month: (idx % 12 + 12) % 12 + 1 };
}

export function parseMonthKey(key: string): YearMonth | null {
  if (!MONTH_RE.test(key)) return null;
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) };
}

export function formatMonthKey(ym: YearMonth): string {
  return `${String(ym.year).padStart(4, '0')}-${String(ym.month).padStart(2, '0')}`;
}

/**
 * 연달력 기간 기준 결정(오너 답 Q1, 2026-10-24). 정책 값이 있으면 그 값, 없으면 기본 규칙:
 * 시작연월이 1월이면 DEFAULT_CALENDAR_YEAR_SPAN('calendar-year' = 기준 연도 1~12월), 1월이 아니면 'start-span'(선택한 월부터).
 */
export function resolveCalendarYearSpan(span: CalendarYearSpan | undefined, start: YearMonth): CalendarYearSpan {
  if (span !== undefined) return span;
  return start.month === 1 ? DEFAULT_CALENDAR_YEAR_SPAN : 'start-span';
}

/**
 * 연달력 첫 달. 기간 기준은 `resolveCalendarYearSpan(span, start)`.
 * calendar-year → {start.year + d, 1}, start-span → addMonths(start, CALENDAR_YEAR_MONTH_COUNT·d). d 가 정수가 아니면 0.
 */
export function resolveCalendarYearStart(span: CalendarYearSpan | undefined, start: YearMonth, yearDelta: number): YearMonth {
  const d = Number.isInteger(yearDelta) ? yearDelta : 0;
  if (resolveCalendarYearSpan(span, start) === 'calendar-year') return { year: start.year + d, month: 1 };
  return addMonths(start, CALENDAR_YEAR_MONTH_COUNT * d);
}

/** 고객 선택값이 정책 허용 폭 안인지(정책·select 없으면 false, 비정수 false). T3b 판독·패널 클램프용 */
export function isCalendarYearDeltaAllowed(policy: CalendarYearPolicy | undefined, delta: unknown): delta is number {
  const select = policy?.select;
  if (!select || !isInt(delta)) return false;
  return delta >= select.minDelta && delta <= select.maxDelta;
}

function addMonthsToKey(key: string, offset: number): string {
  const ym = parseMonthKey(key);
  return ym ? formatMonthKey(addMonths(ym, offset)) : key;
}

export const DEFAULT_CALENDAR_FACE_LABELS: Readonly<Record<CalendarLayout, [string, string]>> = {
  desk: ['앞면', '뒷면'],
  'wall-1': ['앞면', '뒷면'],
  'wall-2': ['상단', '하단'],
};

export function resolveCalendarFaceLabels(cal: Pick<CalendarProfile, 'layout' | 'faceLabels'>): [string, string] {
  return cal.faceLabels ?? DEFAULT_CALENDAR_FACE_LABELS[cal.layout] ?? ['앞면', '뒷면'];
}

/**
 * 페이지 라벨: "표지" / "2027년 1월 앞면" / "2027년 1월" / "에필로그".
 * 표지·에필로그가 2장 이상이면 "표지 2" 처럼 순번을 붙인다.
 */
export function formatCalendarPageLabel(
  cal: Pick<CalendarProfile, 'layout' | 'faceLabels' | 'coverCanvases' | 'canvasesPerMonth' | 'epilogueCanvases'>,
  start: YearMonth,
  canvasIndex: number,
): string | null {
  const slot = resolveCalendarCanvasSlot(cal, canvasIndex);
  if (!slot) return null;
  if (slot.role === 'cover') return cal.coverCanvases > 1 ? `표지 ${(slot.ordinal ?? 0) + 1}` : '표지';
  if (slot.role === 'epilogue') return cal.epilogueCanvases > 1 ? `에필로그 ${(slot.ordinal ?? 0) + 1}` : '에필로그';
  const ym = addMonths(start, slot.monthOffset ?? 0);
  const base = `${ym.year}년 ${ym.month}월`;
  if (slot.face === undefined) return base;
  return `${base} ${resolveCalendarFaceLabels(cal)[slot.face]}`;
}

/** 시작연월이 allowedRange 안인지 */
export function isStartMonthAllowed(cal: Pick<CalendarProfile, 'allowedRange'>, start: YearMonth): boolean {
  const key = formatMonthKey(start);
  return compareMonth(key, cal.allowedRange.from) >= 0 && compareMonth(key, cal.allowedRange.to) <= 0;
}

// ─── 사진인화 항목 매핑(순수 함수, P2-d) ─────────────────────────────────────

/** 항목 1건이 차지하는 캔버스 수 — chemical 1(앞면만) / digital 2([앞, 뒤]) */
function photoCanvasStride(profile: Pick<ProductProfile, 'sheet' | 'photoPrint'>): 1 | 2 {
  if (profile.photoPrint) return profile.photoPrint.process === 'digital' ? 2 : 1;
  return profile.sheet.canvasLayout === 'canvas-pair' ? 2 : 1;
}

/**
 * 항목 순번 → 앞면 캔버스 인덱스(계약 결정 4): chemical i→i, digital(①②③ 공통) i→2i(뒷면은 2i+1).
 * itemIndex 가 0 이상 정수가 아니면 -1.
 */
export function resolvePhotoItemCanvasIndex(profile: Pick<ProductProfile, 'sheet' | 'photoPrint'>, itemIndex: number): number {
  if (!isInt(itemIndex, 0)) return -1;
  return itemIndex * photoCanvasStride(profile);
}

/** 캔버스 수 → 항목 수: chemical N / digital ceil(N/2) (summarizeProductProfile 의 sheetCount 와 같은 산식) */
export function resolvePhotoItemCount(profile: Pick<ProductProfile, 'sheet' | 'photoPrint'>, canvasCount: number): number {
  if (!isInt(canvasCount, 1)) return 0;
  return Math.ceil(canvasCount / photoCanvasStride(profile));
}

/** 페이지 라벨: chemical '사진 3' / digital '사진 3 앞'·'사진 3 뒤'. photoPrint 가 없거나 인덱스가 범위 밖이면 null. */
export function formatPhotoPageLabel(profile: Pick<ProductProfile, 'sheet' | 'photoPrint'>, canvasIndex: number): string | null {
  if (!profile.photoPrint || !isInt(canvasIndex, 0)) return null;
  const stride = photoCanvasStride(profile);
  const ordinal = Math.floor(canvasIndex / stride) + 1;
  if (stride === 1) return `사진 ${ordinal}`;
  return `사진 ${ordinal} ${canvasIndex % 2 === 0 ? '앞' : '뒤'}`;
}

/** fit 어휘 → 프레임 fitMode(§13-3): 페이퍼풀 cover / 이미지풀 contain */
export function resolvePhotoFitMode(fit: PhotoFit): 'cover' | 'contain' {
  return fit === 'image-full' ? 'contain' : 'cover';
}

/** border 어휘 → 프레임 frameInsetMm(§13-3): 유테 = options.borderInsetMm(기본 2) / 무테 = 0 */
export function resolvePhotoFrameInsetMm(photo: Pick<PhotoPrintProfile, 'options'>, border: PhotoBorder): number {
  if (border !== 'white') return 0;
  const inset = photo.options.borderInsetMm;
  return typeof inset === 'number' && Number.isFinite(inset) && inset >= 0 ? inset : DEFAULT_PHOTO_BORDER_INSET_MM;
}

function pickPhotoVocab<T extends string>(value: unknown, vocab: readonly T[], allowed: readonly T[] | undefined): T {
  const pool = allowed && allowed.length > 0 ? allowed : vocab;
  return oneOf(value, vocab) && pool.includes(value) ? value : pool[0];
}

function pickPhotoFlag(value: unknown, enabled: boolean | undefined): boolean {
  if (enabled === false) return false;
  return value === true;
}

/** `readPhotoItems` 가 profile·opts 모두 없을 때 받아들이는 항목 수 상한 */
export const DEFAULT_PHOTO_ITEMS_LIMIT = 1000;

export interface ReadPhotoItemsOptions {
  /** 받아들일 항목 수 상한(0 이상 정수). 생략 시 profile.upload.maxPhotos, 그것도 없으면 DEFAULT_PHOTO_ITEMS_LIMIT. */
  maxItems?: number;
}

const COPIES_INT_STRING_RE = /^\d+$/;

/** copies 입력 → 1 이상 정수(숫자 또는 정수형 문자열 "3"), 그 밖의 불량은 null */
function readCopiesInput(raw: unknown): number | null {
  if (isInt(raw, 1)) return raw;
  if (typeof raw === 'string' && COPIES_INT_STRING_RE.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n) && n >= 1) return n;
  }
  return null;
}

/**
 * 세션 `metadata.items`(자유형) / 런처 `items`(PhotoItemInput) → 정제된 PhotoItem[].
 * - 배열이 아니면 []. 객체가 아닌 원소는 생략(불량 항목). `index` 는 출력 순번(0부터)으로 재부여한다.
 * - 항목 수 상한: `opts.maxItems`(0 이상 정수) → 없으면 `profile.upload.maxPhotos` → 없으면 DEFAULT_PHOTO_ITEMS_LIMIT.
 *   상한을 넘는 입력은 조용히 버린다(불량 항목은 세지 않는다).
 * - `copies` 는 1 이상 정수 또는 정수형 문자열("3")을 숫자로 받아들이고, 그 밖의 불량(0·소수·"abc")은 조용히 하한(copies.min / 1)으로 둔다.
 * - profile 이 있으면 권위 있는 정제: `canvasIndex` 는 resolvePhotoItemCanvasIndex 로 재계산, `sizeCode` 는 sizes[0].code,
 *   `copies` 는 [copies.min, copies.max] 로 클램프, 어휘는 허용 목록 안이 아니면 첫 허용값, 미제공 옵션 플래그는 false 로 고정.
 * - profile 이 없으면 형식만 정제: canvasIndex 는 입력값(0 이상 정수) 또는 순번, sizeCode 는 문자열(없으면 ''), copies 는 1 이상 정수(없으면 1).
 * - `sourcePhotoId` 는 비어 있지 않은 문자열일 때만 키를 남긴다(직렬화 안정).
 */
export function readPhotoItems(input: unknown, profile?: PhotoPrintProfile, opts?: ReadPhotoItemsOptions): PhotoItem[] {
  if (!Array.isArray(input)) return [];
  const stride: 1 | 2 = profile?.process === 'digital' ? 2 : 1;
  const copiesMin = profile ? profile.copies.min : 1;
  const copiesMax = profile ? profile.copies.max : Number.MAX_SAFE_INTEGER;
  const fixedSizeCode = profile?.sizes[0]?.code;
  const limit = isInt(opts?.maxItems, 0)
    ? opts.maxItems
    : (isInt(profile?.upload.maxPhotos, 0) ? profile.upload.maxPhotos : DEFAULT_PHOTO_ITEMS_LIMIT);
  const items: PhotoItem[] = [];
  for (const raw of input) {
    if (items.length >= limit) break;
    if (!isRecord(raw)) continue;
    const index = items.length;
    const canvasIndex = profile ? index * stride : (isInt(raw.canvasIndex, 0) ? raw.canvasIndex : index);
    const sizeCode = fixedSizeCode !== undefined ? fixedSizeCode : (typeof raw.sizeCode === 'string' ? raw.sizeCode : '');
    const requested = readCopiesInput(raw.copies) ?? copiesMin;
    const copies = Math.min(copiesMax, Math.max(copiesMin, requested));
    const item: PhotoItem = {
      index,
      canvasIndex,
      sizeCode,
      copies,
      border: pickPhotoVocab(raw.border, PHOTO_BORDERS, profile?.options.border),
      fit: pickPhotoVocab(raw.fit, PHOTO_FITS, profile?.options.fit),
      finish: pickPhotoVocab(raw.finish, PHOTO_FINISHES, profile?.options.finish),
      brightnessFix: pickPhotoFlag(raw.brightnessFix, profile?.options.brightnessFix),
      dateOverlay: pickPhotoFlag(raw.dateOverlay, profile?.options.dateOverlay),
      grayscale: pickPhotoFlag(raw.grayscale, profile?.options.grayscale),
      lowRes: raw.lowRes === true,
    };
    if (typeof raw.sourcePhotoId === 'string' && raw.sourcePhotoId.length > 0) item.sourcePhotoId = raw.sourcePhotoId;
    items.push(item);
  }
  return items;
}

/** `editor.complete` `product` 키 */
export function summarizeProductProfile(profile: ProductProfile, canvasCount: number): ProductCompleteSummary {
  const faces = profile.sheet.faces;
  return {
    kind: profile.kind,
    editorType: profile.editorType,
    canvasCount,
    sheetCount: faces === 2 ? Math.ceil(canvasCount / 2) : canvasCount,
    faces,
  };
}
