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
 * 안전 원칙 — 오탐 SPINE_SIZE_MISMATCH 는 세션을 failed 로 뒤집고 파트너에게 session.failed
 * 웹훅을 보낸다. 그래서 표지 보정은 "편집기가 기록한 출력 크기 = 워커 기대식" 이 성립할 때만
 * 적용하고, 성립하지 않거나 근거가 없으면 null 을 돌려 현행 동작을 유지한다.
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
