/**
 * 호스트(주문) 지정 책등 폭 — 순수 헬퍼 (R-195, 2026-09-28).
 *
 * 파트너(bookmoa)가 주문의 책등 폭을 `/embed?spineWidthMm=`(snake `spine_width_mm`) 또는
 * EditorConfig.options.spineWidthMm 으로 전달한다. 종전 편집기는 이 값을 무시하고 spineApi 로
 * 책등을 계산했다. 이 모듈은 스토어·캔버스에 의존하지 않는 판정만 모은다(단위 테스트 대상).
 *
 * 규약 요약:
 *  - 파라미터: 유한수 ≥ 0 만 수용('0' → 0). '', NaN, 음수 → undefined(비어있지 않은 무효값은 경고).
 *  - S5 정규화: paperType/bindingType 은 trim 후 '' 또는 '-' → undefined.
 *  - 재편집 사다리: options/URL → metadata.orderOptions.spineWidthMm → metadata.appliedSpine
 *    (source==='host' 일 때만).
 *  - hostFixed = !(paperType && bindingType && hostSpine > 0) — 고정이면 편집 중 재계산 스킵.
 */
import { roundMm01 } from '@storige/types'

/** metadata.appliedSpine.source — 완료 시점 표지에 쓰인 책등 폭의 출처 */
export type AppliedSpineSource = 'host' | 'formula' | 'template'

export interface AppliedSpineSnapshot {
  spineWidthMm: number
  source: AppliedSpineSource
}

/**
 * S5: 용지/제본 코드 정규화. trim 후 '' 또는 '-'(호스트의 "미지정" 표기) → undefined.
 * 문자열이 아니면 undefined.
 */
export function normalizeSpineCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === '-') return undefined
  return trimmed
}

/**
 * 0 을 허용하는 숫자 판정(유한수 ≥ 0). 숫자 문자열도 수용(공백만/빈 문자열은 거부).
 * 기존 asPositiveNumber 는 0 을 거부하므로 책등 폭에는 쓰지 않는다.
 */
export function asNonNegativeNumber(value: unknown): number | undefined {
  let n: number
  if (typeof value === 'number') {
    n = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    n = Number(trimmed)
  } else {
    return undefined
  }
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * `spineWidthMm` URL 파라미터 파싱. 미전달/빈 문자열은 조용히 undefined,
 * 비어있지 않은 무효값(NaN·음수·'-' 등)은 경고 후 undefined.
 */
export function parseSpineWidthMmParam(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined
  if (raw.trim() === '') return undefined
  const parsed = asNonNegativeNumber(raw)
  if (parsed === undefined) {
    console.warn(`[hostSpine] spineWidthMm 파라미터 무시 — 유한수 ≥ 0 이 아님: "${raw}"`)
  }
  return parsed
}

export interface SpineOptionInputs {
  paperType?: unknown
  bindingType?: unknown
  spineWidthMm?: unknown
}

export interface EffectiveSpineOptions {
  paperType?: string
  bindingType?: string
  /** 호스트 지정 책등 폭(mm). undefined = 미전달 → 기존 수식 경로 */
  spineWidthMm?: number
}

/**
 * 재편집 책등 옵션 사다리 (embed.tsx 에서 추출 — 순수 함수).
 *
 * - paperType/bindingType: options(URL/props) → metadata.orderOptions → metadata.spine(B38 스냅샷).
 *   각 단계 S5 정규화('-'·빈값은 미지정 취급 → 다음 단계로 폴백).
 * - spineWidthMm: options(URL/props) → metadata.orderOptions.spineWidthMm(≥0) →
 *   metadata.appliedSpine.spineWidthMm (source==='host' 일 때만 — formula/template 값은
 *   호스트 지정이 아니므로 사다리에 올리지 않는다).
 */
export function resolveEffectiveSpineOptions(
  options: SpineOptionInputs | undefined,
  sessionMetadata: unknown,
): EffectiveSpineOptions {
  const meta = isRecord(sessionMetadata) ? sessionMetadata : {}
  const orderOptions = isRecord(meta.orderOptions) ? meta.orderOptions : {}
  const spineSnapshot = isRecord(meta.spine) ? meta.spine : {}
  const appliedSpine = isRecord(meta.appliedSpine) ? meta.appliedSpine : {}

  const paperType =
    normalizeSpineCode(options?.paperType) ??
    normalizeSpineCode(orderOptions.paperType) ??
    normalizeSpineCode(spineSnapshot.paperType)
  const bindingType =
    normalizeSpineCode(options?.bindingType) ??
    normalizeSpineCode(orderOptions.bindingType) ??
    normalizeSpineCode(spineSnapshot.bindingType)
  const spineWidthMm =
    asNonNegativeNumber(options?.spineWidthMm) ??
    asNonNegativeNumber(orderOptions.spineWidthMm) ??
    (appliedSpine.source === 'host' ? asNonNegativeNumber(appliedSpine.spineWidthMm) : undefined)

  return {
    ...(paperType !== undefined ? { paperType } : {}),
    ...(bindingType !== undefined ? { bindingType } : {}),
    ...(spineWidthMm !== undefined ? { spineWidthMm } : {}),
  }
}

/**
 * 호스트 책등 고정 여부. 용지·제본이 모두 있고 호스트 값이 > 0 이면 수식으로 재계산 가능(비고정),
 * 그 외(코드 누락 또는 0mm)는 호스트 값 고정 — 편집 중 페이지 증감에도 재계산하지 않는다.
 */
export function isHostSpineFixed(input: {
  paperType?: string | null
  bindingType?: string | null
  hostSpineWidthMm: number
}): boolean {
  return !(
    normalizeSpineCode(input.paperType) &&
    normalizeSpineCode(input.bindingType) &&
    input.hostSpineWidthMm > 0
  )
}

/**
 * 호스트 책등 적용 시점의 편집기 동작 판정 (spineCalculator 스프레드 경로 전용).
 *  - 'apply-host'  : API 없이 호스트 값을 적용(초기 로드, 또는 비고정 모드에서 기준 페이지 수 복귀)
 *  - 'skip'        : 고정 모드 편집 중 트리거 — 값 유지, API 호출 없음
 *  - 'formula'     : 기존 API 재계산 경로 그대로
 *  - 'no-host'     : 호스트 값 없음 → 기존 경로 그대로
 */
export type HostSpineDecision = 'apply-host' | 'skip' | 'formula' | 'no-host'

export function decideHostSpineAction(input: {
  hostSpineWidthMm: number | null | undefined
  hostFixed: boolean | undefined
  initial: boolean
  /** 호스트 값을 적용했던 시점의 내지 인쇄 페이지 수(비고정 모드 기준선). 미적용이면 null */
  baselinePageCount: number | null | undefined
  currentPageCount: number
}): HostSpineDecision {
  if (typeof input.hostSpineWidthMm !== 'number' || !Number.isFinite(input.hostSpineWidthMm)) {
    return 'no-host'
  }
  if (input.initial) return 'apply-host'
  if (input.hostFixed) return 'skip'
  // 비고정: 호스트 값은 "주문 페이지 수" 기준값이다. 초기화 중 시드 루프의 지연 트리거처럼
  // 페이지 수가 기준선과 같으면 API 로 덮어쓰지 않고 호스트 값을 유지(재적용 — 동일 폭이면 no-op).
  if (
    typeof input.baselinePageCount === 'number' &&
    input.baselinePageCount === input.currentPageCount
  ) {
    return 'apply-host'
  }
  return 'formula'
}

/**
 * 완료 시점 appliedSpine.source 판정.
 * flat-spread(책등 고정 템플릿)는 항상 'template'. 그 외는 마지막으로 적용된 출처,
 * 적용 기록이 없으면(계산 실패·스킵 등) 템플릿 값 그대로이므로 'template'.
 */
export function resolveAppliedSpineSource(input: {
  conversionMode?: string | null
  lastAppliedSource?: 'host' | 'formula' | null
}): AppliedSpineSource {
  if (input.conversionMode === 'flat-spread') return 'template'
  return input.lastAppliedSource ?? 'template'
}

/**
 * 스프레드 책(표지 포함, regionScope!=='inner')의 현재 적용 책등 폭(mm, 0.1 반올림).
 * 비스프레드·내지 전용 펼침면·spec 부재·비정상 값이면 undefined.
 */
export function getAppliedSpineWidthMm(
  isSpreadMode: boolean,
  spreadConfig: { regionScope?: string; spec?: { spineWidthMm?: number } } | null | undefined,
): number | undefined {
  if (!isSpreadMode || !spreadConfig || spreadConfig.regionScope === 'inner') return undefined
  const w = spreadConfig.spec?.spineWidthMm
  if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) return undefined
  return roundMm01(w)
}

/**
 * 완료 metadata.appliedSpine 스냅샷. getAppliedSpineWidthMm 이 undefined 면 null(기록 안 함).
 */
export function buildAppliedSpineSnapshot(input: {
  isSpreadMode: boolean
  spreadConfig:
    | { regionScope?: string; conversionMode?: string; spec?: { spineWidthMm?: number } }
    | null
    | undefined
  lastAppliedSource?: 'host' | 'formula' | null
}): AppliedSpineSnapshot | null {
  const spineWidthMm = getAppliedSpineWidthMm(input.isSpreadMode, input.spreadConfig)
  if (spineWidthMm === undefined) return null
  return {
    spineWidthMm,
    source: resolveAppliedSpineSource({
      conversionMode: input.spreadConfig?.conversionMode ?? null,
      lastAppliedSource: input.lastAppliedSource ?? null,
    }),
  }
}

/**
 * 책등 폭 0 적용 가능 여부 판정용: 책등 영역 소속 객체(regionRef==='spine', 시스템·flat 책등
 * 아트워크 제외)가 있는가.
 *
 * 배경: canvas-core SpreadPlugin.repositionObjects 는 regionRef==='spine' 객체를 새 레이아웃의
 * spine 영역으로 재배치하는데, 폭 0 이면 computeLayout 이 spine 영역을 만들지 않아
 * `newLayout.regions.find(spine)!` 가 undefined → SpineResizeStrategy.apply 에서 TypeError.
 * 예외는 workspace 크기 변경 **이후**에 나므로 캔버스가 반쯤 바뀐 채 남는다. 편집기는
 * canvas-core 를 고치지 않고 이 경우 0mm 적용을 차단한다(호출측 보고).
 */
export function hasSpineRegionObjects(
  objects: ReadonlyArray<{ meta?: { system?: unknown; regionRef?: unknown; flatArtwork?: unknown } }>,
): boolean {
  return objects.some(
    (o) => !o.meta?.system && o.meta?.regionRef === 'spine' && o.meta?.flatArtwork !== 'spine',
  )
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
