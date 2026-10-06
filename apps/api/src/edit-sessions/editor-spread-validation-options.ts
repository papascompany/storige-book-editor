/**
 * bookmoa R-195(2026-09-28) — 편집기 스프레드 책 완료 세션의 검증 잡 orderOptions 보정.
 *
 * 배경: 세션 완료 검증 잡은 레거시 metadata(size/pages/binding/bleed/paperThickness)만 읽는데
 * `/embed` 는 이 키들을 채우지 않는다(운영 08-01 이후 세션 36건 중 0건) → 편집기 산출 표지는
 * 항상 binding=perfect·pages=1·책등 없음으로 검증되어 표지 크기 검사가 통째로 생략됐다.
 *
 * 이 모듈은 편집기가 완료 시 기록한 값만으로 보정값을 만든다(추론 금지):
 *  - metadata.orderOptions.bindingType : 주문 제본(파트너 전달값)
 *  - metadata.spreadContentPageCount / metadata.spine.pageCount : 실제 내지 페이지 수
 *  - metadata.spread.spec             : 표지에 실제 적용된 판형·책등·날개
 *  - metadata.coverOutput             : 실제 생성한 표지 PDF 페이지 크기·도련(편집기 기록)
 *  - metadata.appliedSpine / spine    : 책등 출처(호스트 고정 vs 공식) · 공식 입력값
 *
 * 안전 원칙 — 오탐 SPINE_SIZE_MISMATCH 는 세션 표지 검증 잡을 FAILED 로 만들고, 잡의 사이트가
 * 웹훅 v2 를 설정했으면 validation.failed 웹훅이 나간다(이 잡은 callbackUrl 없이 생성 —
 * WorkerJobsService.validationCallbackDue). 세션 상태는 바뀌지 않고 session.* 도 발신하지 않는다
 * (v1.10, isSessionStatusSyncJob 표지 없음). 그래서 표지 보정은 "편집기가 기록한 출력 크기 =
 * 워커 기대식" 이 성립할 때만 적용하고, 성립하지 않거나 근거가 없으면 null 을 돌려 현행 동작을 유지한다.
 *  - 양장 싸바리 전개 출력(coverOutput.layout='hardcover-wrap'): 기록 판형 = 템플릿셋 판형,
 *    표지 면 = 판형+8, 출력 크기 = 싸바리 전개식(hardcoverCoverSpreadFromSpine)이 모두 성립할 때만
 *    binding=hardcover 로 연결. 템플릿셋 판형이 주어지지 않으면 제외
 *  - 그 밖의 양장(layout 없음): 편집기 표지 기하와 싸바리 전개식의 정합 근거가 없으므로 제외
 *  - coverOutput 없음(구 편집기 빌드·PDF 미생성 경로) → 제외
 *  - 기대식 불일치(caseBind printSize 출력 등) → 제외
 */
import { HARDCOVER_COVER_EXTRA_MM, hardcoverCoverSpreadFromSpine } from '@storige/types';

export type EditorValidationBinding = 'perfect' | 'saddle' | 'spring' | 'spiral' | 'hardcover';

export interface EditorSpreadContentOverrides {
  binding?: EditorValidationBinding;
  pages?: number;
}

export interface EditorSpreadCoverOverrides {
  binding?: EditorValidationBinding;
  size: { width: number; height: number };
  spineWidthMm: number;
  wingEnabled: boolean;
  wingWidthMm: number;
  bleed: number;
  expectedOrientation: 'portrait' | 'landscape';
  /** 공식 출처일 때만 — 서버 injectServerSpine 이 같은 공식으로 재계산(호스트 고정값은 덮지 않음) */
  paperType?: string;
  pages?: number;
}

export type EditorSpreadCoverSkipReason =
  | 'HARDCOVER_GEOMETRY_UNVERIFIED'
  | 'NO_COVER_OUTPUT'
  | 'INVALID_SPEC'
  | 'GEOMETRY_INCONSISTENT'
  /** 싸바리 전개 출력인데 주문 제본이 양장이 아님(로그 전용) */
  | 'BINDING_LAYOUT_CONFLICT';

/** 서버 템플릿셋 판형(templateSet.width/height, mm) */
export interface EditorSpreadTemplateTrim {
  widthMm: number;
  heightMm: number;
}

/** 편집기가 싸바리 전개 표지를 출력했을 때 coverOutput.layout 에 기록하는 값 */
export const HARDCOVER_WRAP_COVER_LAYOUT = 'hardcover-wrap';

export interface EditorSpreadValidationOverrides {
  content: EditorSpreadContentOverrides;
  cover: EditorSpreadCoverOverrides | null;
  coverSkipReason?: EditorSpreadCoverSkipReason;
  /** GEOMETRY_INCONSISTENT 진단용(로그) */
  coverGeometry?: { expectedWidthMm: number; expectedHeightMm: number; outputWidthMm: number; outputHeightMm: number };
}

/** 편집기 기록 출력 크기와 워커 기대식의 허용 차(mm) — 편집기 0.1mm 반올림 흡수 */
export const COVER_GEOMETRY_EPSILON_MM = 0.5;

const VALIDATION_BINDINGS: readonly EditorValidationBinding[] = [
  'perfect',
  'saddle',
  'spring',
  'spiral',
  'hardcover',
];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const n = finiteNumber(value);
  return n !== undefined && n >= 1 && Number.isInteger(n) ? n : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed !== '-' ? trimmed : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function positiveNumber(value: unknown): number | undefined {
  const n = finiteNumber(value);
  return n !== undefined && n > 0 ? n : undefined;
}

/**
 * 공식 출처일 때만 공식 입력을 싣는다 → 서버가 같은 v2 공식으로 재계산해 대조.
 * 호스트 고정(appliedSpine.source='host')·템플릿 고정은 paperType 을 싣지 않아 서버가 덮지 않는다.
 */
function formulaSpineInputs(
  metadata: UnknownRecord,
  spineSnapshot: UnknownRecord | undefined,
): { paperType: string; pages: number } | Record<string, never> {
  const appliedSource = asRecord(metadata.appliedSpine)?.source;
  const formulaPaperType = nonEmptyString(spineSnapshot?.paperType);
  const formulaPages = positiveInt(spineSnapshot?.pageCount);
  return appliedSource === 'formula' && formulaPaperType && formulaPages !== undefined
    ? { paperType: formulaPaperType, pages: formulaPages }
    : {};
}

/**
 * 싸바리 전개 표지(coverOutput.layout='hardcover-wrap') 판정. 워커 양장 기대식
 * (hardcoverCoverSpreadFromSpine(판형, 책등))과 편집기 기록 출력이 맞을 때만 표지를 연결한다.
 * 판형은 서버 템플릿셋 값을 쓰며, 워커에 넘기는 size 와 여기서 대조한 판형이 같다.
 */
function deriveHardcoverWrapCover(
  metadata: UnknownRecord,
  spec: UnknownRecord,
  coverOutput: UnknownRecord,
  content: EditorSpreadContentOverrides,
  orderBinding: EditorValidationBinding | undefined,
  spineSnapshot: UnknownRecord | undefined,
  templateTrimMm: EditorSpreadTemplateTrim | null | undefined,
): EditorSpreadValidationOverrides {
  if (orderBinding !== undefined && orderBinding !== 'hardcover') {
    return { content, cover: null, coverSkipReason: 'BINDING_LAYOUT_CONFLICT' };
  }

  const coverWidthMm = positiveNumber(spec.coverWidthMm);
  const coverHeightMm = positiveNumber(spec.coverHeightMm);
  const spineWidthMm = finiteNumber(spec.spineWidthMm);
  const rawWingWidthMm = finiteNumber(spec.wingWidthMm) ?? 0;
  if (
    coverWidthMm === undefined ||
    coverHeightMm === undefined ||
    spineWidthMm === undefined ||
    spineWidthMm < 0 ||
    rawWingWidthMm < 0 ||
    (spec.wingEnabled === true && rawWingWidthMm > 0)
  ) {
    return { content, cover: null, coverSkipReason: 'INVALID_SPEC' };
  }

  const outputWidthMm = positiveNumber(coverOutput.widthMm);
  const outputHeightMm = positiveNumber(coverOutput.heightMm);
  const recordedTrimWidthMm = positiveNumber(coverOutput.trimWidthMm);
  const recordedTrimHeightMm = positiveNumber(coverOutput.trimHeightMm);
  const wrapMm = positiveNumber(coverOutput.wrapMm);
  const trimWidthMm = positiveNumber(templateTrimMm?.widthMm);
  const trimHeightMm = positiveNumber(templateTrimMm?.heightMm);
  if (
    outputWidthMm === undefined ||
    outputHeightMm === undefined ||
    recordedTrimWidthMm === undefined ||
    recordedTrimHeightMm === undefined ||
    wrapMm === undefined ||
    trimWidthMm === undefined ||
    trimHeightMm === undefined ||
    Math.abs(recordedTrimWidthMm - trimWidthMm) > COVER_GEOMETRY_EPSILON_MM ||
    Math.abs(recordedTrimHeightMm - trimHeightMm) > COVER_GEOMETRY_EPSILON_MM
  ) {
    return { content, cover: null, coverSkipReason: 'GEOMETRY_INCONSISTENT' };
  }

  if (
    Math.abs(coverWidthMm - (trimWidthMm + HARDCOVER_COVER_EXTRA_MM)) > COVER_GEOMETRY_EPSILON_MM ||
    Math.abs(coverHeightMm - (trimHeightMm + HARDCOVER_COVER_EXTRA_MM)) > COVER_GEOMETRY_EPSILON_MM
  ) {
    return { content, cover: null, coverSkipReason: 'GEOMETRY_INCONSISTENT' };
  }

  // 워커 validateSpine(양장) 기대식과 동일: (W+8)×2 + 책등 + 40 / (H+8) + 40
  const expected = hardcoverCoverSpreadFromSpine({
    widthMm: trimWidthMm,
    heightMm: trimHeightMm,
    spineMm: spineWidthMm,
  });
  const expectedWidthMm = round2(expected.totalWMm);
  const expectedHeightMm = round2(expected.totalHMm);
  if (
    Math.abs(expectedWidthMm - outputWidthMm) > COVER_GEOMETRY_EPSILON_MM ||
    Math.abs(expectedHeightMm - outputHeightMm) > COVER_GEOMETRY_EPSILON_MM
  ) {
    return {
      content,
      cover: null,
      coverSkipReason: 'GEOMETRY_INCONSISTENT',
      coverGeometry: { expectedWidthMm, expectedHeightMm, outputWidthMm, outputHeightMm },
    };
  }

  // 공식 입력은 주문 제본이 양장일 때만 — 미전달이면 서버 재계산이 양장 공식으로 이뤄진다는 근거가 없다.
  const formulaInputs =
    orderBinding === 'hardcover' ? formulaSpineInputs(metadata, spineSnapshot) : {};

  return {
    content,
    cover: {
      binding: 'hardcover',
      size: { width: trimWidthMm, height: trimHeightMm },
      spineWidthMm,
      wingEnabled: false,
      wingWidthMm: 0,
      bleed: 0,
      expectedOrientation: outputWidthMm > outputHeightMm ? 'landscape' : 'portrait',
      ...formulaInputs,
    },
  };
}

/**
 * 주문 제본값 정규화 — 워커 허용 5종만 인정(대소문자·공백 무시). 그 밖('-'·한글·미전달)은
 * undefined → 호출측이 기존 값(metadata.binding ?? 'perfect')을 유지한다.
 */
export function normalizeOrderBinding(raw: unknown): EditorValidationBinding | undefined {
  const value = nonEmptyString(raw)?.toLowerCase();
  return VALIDATION_BINDINGS.find((b) => b === value);
}

/**
 * 편집기 스프레드 책 완료 세션의 검증 잡 보정값. 스프레드 스냅샷(metadata.spread.spec)이
 * 없으면 null(비스프레드·구 세션 = 현행 그대로).
 *
 * @param templateTrimMm 세션 템플릿셋 판형. 싸바리 전개 표지 판정에만 쓰며, 없으면 그 표지는
 *   GEOMETRY_INCONSISTENT 로 연결을 생략한다. 싸바리 전개가 아닌 세션의 결과에는 영향이 없다.
 */
export function deriveEditorSpreadValidationOverrides(
  metadataInput: unknown,
  templateTrimMm?: EditorSpreadTemplateTrim | null,
): EditorSpreadValidationOverrides | null {
  const metadata = asRecord(metadataInput);
  const spread = asRecord(metadata?.spread);
  const spec = asRecord(spread?.spec);
  if (!metadata || !spec) return null;

  const orderBinding = normalizeOrderBinding(asRecord(metadata.orderOptions)?.bindingType);
  const spineSnapshot = asRecord(metadata.spine);
  const innerPages =
    positiveInt(metadata.spreadContentPageCount) ?? positiveInt(spineSnapshot?.pageCount);

  // 내지: 양장은 레거시 폴백 규칙이 없어(perfect 의 4배수가 사라짐) 약화되므로 현행(perfect 계열) 유지.
  const content: EditorSpreadContentOverrides = {
    ...(orderBinding && orderBinding !== 'hardcover' ? { binding: orderBinding } : {}),
    ...(innerPages !== undefined ? { pages: innerPages } : {}),
  };

  const coverOutput = asRecord(metadata.coverOutput);
  if (coverOutput?.layout === HARDCOVER_WRAP_COVER_LAYOUT) {
    return deriveHardcoverWrapCover(
      metadata,
      spec,
      coverOutput,
      content,
      orderBinding,
      spineSnapshot,
      templateTrimMm,
    );
  }

  if (orderBinding === 'hardcover') {
    return { content, cover: null, coverSkipReason: 'HARDCOVER_GEOMETRY_UNVERIFIED' };
  }

  const outputWidthMm = finiteNumber(coverOutput?.widthMm);
  const outputHeightMm = finiteNumber(coverOutput?.heightMm);
  const bleedMm = finiteNumber(coverOutput?.bleedMm);
  if (
    outputWidthMm === undefined ||
    outputHeightMm === undefined ||
    bleedMm === undefined ||
    outputWidthMm <= 0 ||
    outputHeightMm <= 0 ||
    bleedMm < 0
  ) {
    return { content, cover: null, coverSkipReason: 'NO_COVER_OUTPUT' };
  }

  const coverWidthMm = finiteNumber(spec.coverWidthMm);
  const coverHeightMm = finiteNumber(spec.coverHeightMm);
  const spineWidthMm = finiteNumber(spec.spineWidthMm);
  const rawWingWidthMm = finiteNumber(spec.wingWidthMm) ?? 0;
  if (
    coverWidthMm === undefined ||
    coverHeightMm === undefined ||
    spineWidthMm === undefined ||
    coverWidthMm <= 0 ||
    coverHeightMm <= 0 ||
    spineWidthMm < 0 ||
    rawWingWidthMm < 0
  ) {
    return { content, cover: null, coverSkipReason: 'INVALID_SPEC' };
  }

  const wingEnabled = spec.wingEnabled === true && rawWingWidthMm > 0;
  const wingWidthMm = wingEnabled ? rawWingWidthMm : 0;

  // 워커 validateSpine(비양장) 기대식과 동일: 2W + 책등 + 날개×2 + 도련×2 / H + 도련×2
  const expectedWidthMm = round2(coverWidthMm * 2 + spineWidthMm + wingWidthMm * 2 + bleedMm * 2);
  const expectedHeightMm = round2(coverHeightMm + bleedMm * 2);
  if (
    Math.abs(expectedWidthMm - outputWidthMm) > COVER_GEOMETRY_EPSILON_MM ||
    Math.abs(expectedHeightMm - outputHeightMm) > COVER_GEOMETRY_EPSILON_MM
  ) {
    return {
      content,
      cover: null,
      coverSkipReason: 'GEOMETRY_INCONSISTENT',
      coverGeometry: { expectedWidthMm, expectedHeightMm, outputWidthMm, outputHeightMm },
    };
  }

  const formulaInputs = formulaSpineInputs(metadata, spineSnapshot);

  return {
    content,
    cover: {
      ...(orderBinding ? { binding: orderBinding } : {}),
      size: { width: coverWidthMm, height: coverHeightMm },
      spineWidthMm,
      wingEnabled,
      wingWidthMm,
      bleed: bleedMm,
      expectedOrientation: outputWidthMm > outputHeightMm ? 'landscape' : 'portrait',
      ...formulaInputs,
    },
  };
}

/* ──────────────────────────────────────────────────────────────────────────────────────────────
 * N-API-3b(2026-10-06) — 편집 완료 content 검증 잡의 쪽 단위(pageMultiple·중철 pageCountMax) 주입.
 *  - 편집기 실효 물리 쪽 단위 S 는 hostPageLimits.ts resolveStorePageLimits 미러: 호스트
 *    orderOptions.pageStep(1 = 무제약) → 템플릿셋 pageStep. 생성 시점 기록값만 읽는다.
 *  - content.pdf 1쪽 = 물리 k쪽(펼침면 2, 낱장 1) → PDF 단위 pageMultiple = Mphys / gcd(Mphys, k).
 *  - 중철은 lcm(S,4) 바닥값 + 상한(호스트 pageCountMax ?? 64)/k. 제본 판정은 주문값
 *    (normalizeOrderBinding) OR 최종 binding — R-195(EDITOR_SPREAD_VALIDATION_MAPPING)와 독립.
 *  - 데이터 주도 키는 bookmoa 확정 매핑(docs/PDF_VALIDATION_GUIDE.md:291)과 같은 worker 경로를 탄다.
 *  - 오너 결정 D1(a): page_step NULL + 낱장은 null(레거시 그대로). D3: pageCountMin·비중철 Max 미주입.
 * ────────────────────────────────────────────────────────────────────────────────────────────── */

/** 내지 펼침면 판정 결과(resolveInnerSpreadContentSizeMm 의 kind) */
export type EditorContentLayoutKind = 'inner-spread' | 'none' | 'unknown';

export type EditorContentPageRulesSource =
  | 'host'
  | 'host-none'
  | 'template'
  | 'legacy-2up'
  | 'saddle-floor';

export interface EditorContentPageRulesInput {
  metadata: unknown;
  contentFileId: string | null | undefined;
  templatePageStep: unknown;
  layout: EditorContentLayoutKind;
  /** 최종 contentOrderOptions.binding — worker 레거시 경로가 실제로 판정했을 값 */
  legacyBinding: string | undefined;
}

export interface EditorContentPageRules {
  /** content PDF 쪽 단위 배수(1 이어도 싣는다 — 레거시 폴백 해제 목적) */
  pageMultiple: number;
  /** 중철일 때만 — PDF 쪽 단위 상한 */
  pageCountMax?: number;
  /** 편집기 실효 물리 쪽 단위 S(null = 단위 없음) */
  physicalStep: number | null;
  /** content PDF 1쪽에 담긴 물리 쪽 수 k */
  pagesPerPdfPage: 1 | 2;
  source: EditorContentPageRulesSource;
}

/** SADDLE 레거시 상한(물리 쪽) — 호스트 pageCountMax 가 없을 때 */
const SADDLE_DEFAULT_MAX_PAGES = 64;
/** 편집기 호스트 쪽수 한도 상한과 같다(apps/editor/src/utils/hostPageLimits.ts HOST_PAGE_LIMIT_MAX) — 그보다 큰 쪽 단위는 무효. */
const PAGE_STEP_MAX = 500;
const SADDLE_PAGE_MULTIPLE = 4;

/** 숫자 문자열을 숫자로(편집기 normalizePageStep 과 같은 입력 해석) */
function numericLike(raw: unknown): unknown {
  return typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
}

/** 편집기 normalizePageStep 미러 — 2 이상 정수만 단위, 그 밖은 null */
function normStep(raw: unknown): number | null {
  const n = numericLike(raw);
  return typeof n === 'number' && Number.isInteger(n) && n >= 2 && n <= PAGE_STEP_MAX ? n : null;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/**
 * 편집 완료 content 검증 잡에 실을 쪽 규칙. 근거가 없거나 게이트에 걸리면 null(키 미주입 = 현행 그대로).
 * env 킬스위치(EDITOR_CONTENT_PAGE_RULES)는 호출부에서 판정한다.
 */
export function deriveEditorContentPageRules(
  input: EditorContentPageRulesInput,
): EditorContentPageRules | null {
  // 0) 게이트 — 편집기 스프레드 경로 산출물만
  const metadata = asRecord(input.metadata);
  const spec = asRecord(asRecord(metadata?.spread)?.spec);
  if (!metadata || !spec) return null;
  if (positiveInt(metadata.spreadContentPageCount) === undefined) return null;
  const contentFileId = nonEmptyString(input.contentFileId);
  if (contentFileId === undefined || metadata.editorOutputContentFileId !== contentFileId) {
    return null;
  }
  let k: 1 | 2;
  if (input.layout === 'inner-spread') k = 2;
  else if (input.layout === 'none') k = 1;
  else return null;

  // 1) 제본 판정(R-195 독립)
  const orderOptions = asRecord(metadata.orderOptions);
  const orderBinding = normalizeOrderBinding(orderOptions?.bindingType);
  const isSaddle = orderBinding === 'saddle' || input.legacyBinding === 'saddle';

  // 2) 실효 물리 단위 S
  const hostRaw = orderOptions?.pageStep;
  let physicalStep: number | null;
  let stepSource: 'host' | 'host-none' | 'template' | null;
  if (numericLike(hostRaw) === 1) {
    physicalStep = 1;
    stepSource = 'host-none';
  } else {
    const hostStep = normStep(hostRaw);
    const templateStep = normStep(input.templatePageStep);
    physicalStep = hostStep ?? templateStep;
    stepSource = hostStep !== null ? 'host' : templateStep !== null ? 'template' : null;
  }

  // 3) 물리 배수 Mphys · 상한 MaxPhys
  let mPhys: number;
  let maxPhys: number | undefined;
  let source: EditorContentPageRulesSource;
  if (isSaddle) {
    mPhys = lcm(physicalStep ?? 1, SADDLE_PAGE_MULTIPLE);
    maxPhys = positiveInt(orderOptions?.pageCountMax) ?? SADDLE_DEFAULT_MAX_PAGES;
    source = 'saddle-floor';
  } else if (physicalStep !== null && stepSource !== null) {
    mPhys = physicalStep;
    source = stepSource;
  } else if (k === 2) {
    // D2(a): 레거시(perfect 4배수 · 그 밖 무검사)를 물리 단위로 해석
    mPhys = input.legacyBinding === 'perfect' ? 4 : 1;
    source = 'legacy-2up';
  } else {
    // D1(a): 단위 근거 없는 낱장 = 레거시 그대로
    return null;
  }

  // 4) PDF 쪽 단위 환산(물리 쪽수 = PDF 쪽수 × k)
  const pageMultiple = mPhys / gcd(mPhys, k);
  // 상한이 PDF 쪽 단위보다 작아도(예: 펼침면 k=2 에 max 1) 상한 검사를 남긴다 — 0 이면 worker 가 상한을 보지 않는다.
  const pageCountMax = maxPhys !== undefined ? Math.max(1, Math.floor(maxPhys / k)) : undefined;
  return {
    pageMultiple,
    ...(pageCountMax !== undefined && pageCountMax >= 1 ? { pageCountMax } : {}),
    physicalStep,
    pagesPerPdfPage: k,
    source,
  };
}
