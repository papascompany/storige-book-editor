/**
 * product-profile.ts — 상품별 편집 모드 프로파일 (P1, 2026-10-17)
 *
 * 템플릿셋 `product_profile`(JSON, NULL 허용) 한 속성으로 상품의 편집 방식을 선언한다.
 * 편집기·API·admin 은 `resolveProductProfile()` 결과가 null 이면 기존(legacy) 경로를 그대로 쓰고,
 * 값이 있을 때만 `if (profile)` 가드 안에서 동작을 바꾼다. `EditorMode`·`TemplateSetType`·
 * `PdfOutputMode` 등 기존 enum 은 건드리지 않는다(설계: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §2).
 *
 * P1 범위: kind 'sheet' | 'calendar', output 'single-pdf'. photo-print·sheet-map 은 P2 에서 additive 로 확장.
 *
 * 캘린더 상품(오너 확정 2026-10-17): 탁상 4종·벽걸이 1단·2단 모두
 *   캔버스 = 표지(coverCanvases) + 12개월 × canvasesPerMonth + 에필로그(epilogueCanvases)
 *   = 1 + 24 + 1 = 26 (13장 양면), PDF 는 캔버스 순서 그대로 26쪽 단일 파일(홀수=앞면·짝수=뒷면).
 */

// ─── 기본 어휘 ────────────────────────────────────────────────────────────

export const PRODUCT_PROFILE_VERSION = 1 as const;

export type ProductKind = 'sheet' | 'calendar';
export type ProductPagesKind = 'fixed' | 'range';
export type ProductPageStep = 1 | 2 | 4;
export type ProductPageLabelRule = 'default' | 'month' | 'sheet';
export type ProductSheetFaces = 1 | 2;
export type ProductCanvasLayout = 'canvas-per-sheet' | 'canvas-pair';
export type ProductSheetBinding = 'none' | 'top-ring' | 'center-punch';
export type ProductSheetPairing = 'same-sheet' | 'offset-next';
export type ProductBackRotation = 0 | 180;
export type ProductDuplexFlip = 'short-edge' | 'long-edge';
export type ProductOutputMode = 'single-pdf';
export type ProductPostProcessColorRule = 'any' | 'spot-only';
export type CalendarLayout = 'desk' | 'wall-1' | 'wall-2';
export type CalendarWeekStart = 0 | 1;

export const PRODUCT_KINDS: readonly ProductKind[] = ['sheet', 'calendar'];
export const PRODUCT_PAGE_LABEL_RULES: readonly ProductPageLabelRule[] = ['default', 'month', 'sheet'];
export const PRODUCT_CANVAS_LAYOUTS: readonly ProductCanvasLayout[] = ['canvas-per-sheet', 'canvas-pair'];
export const PRODUCT_SHEET_BINDINGS: readonly ProductSheetBinding[] = ['none', 'top-ring', 'center-punch'];
export const PRODUCT_SHEET_PAIRINGS: readonly ProductSheetPairing[] = ['same-sheet', 'offset-next'];
export const PRODUCT_DUPLEX_FLIPS: readonly ProductDuplexFlip[] = ['short-edge', 'long-edge'];
export const CALENDAR_LAYOUTS: readonly CalendarLayout[] = ['desk', 'wall-1', 'wall-2'];

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
}

export interface CalendarMonthRange {
  /** 'YYYY-MM' */
  from: string;
  /** 'YYYY-MM' */
  to: string;
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
}

export interface ProductOutputPolicy {
  mode: ProductOutputMode;
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

export interface CalendarSessionMeta {
  startYear: number;
  /** 1~12 */
  startMonth: number;
  show: CalendarDisplayOptions;
  anniversaries: CalendarAnniversary[];
  dataVersion: string;
}

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
    }
  } else if (cal !== undefined) {
    errors.push("calendar 프로파일은 kind='calendar' 에서만 지정합니다");
  } else if (isRecord(pages) && pages.labelRule === 'month') {
    errors.push("pages.labelRule='month' 는 kind='calendar' 에서만 쓸 수 있습니다");
  }

  // output
  const out = p.output;
  if (!isRecord(out) || out.mode !== 'single-pdf') errors.push("output.mode 는 'single-pdf' 여야 합니다(P1)");

  return errors;
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
