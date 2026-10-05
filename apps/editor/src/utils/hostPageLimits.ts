/**
 * 호스트(상품) 지정 내지 쪽수 범위·증감 단위 — 순수 헬퍼 (R-196 host page limits (2026-09-29)).
 *
 * 파트너(bookmoa 등)가 상품별 관리자 설정 쪽수(예: 16~300p)를 `/embed?pageCountMin=&pageCountMax=&pageStep=`
 * (snake `page_count_min`·`page_count_max`·`page_step`) 또는 EditorConfig.options 로 전달한다.
 * 유효한 값은 템플릿셋 pageCountRange / pageStep 보다 우선한다. 미전달·무효값이면 모든 결과가
 * 종전 인라인 식과 byte-identical 이다(아래 identity 불변식 — 단위 테스트로 고정).
 *
 * 이 모듈은 스토어·fabric·contentPdfGuide 에 의존하지 않는다(단위 테스트 대상).
 *
 * 규약 요약:
 *  - 값은 물리 내지 쪽수. pageCountMin/Max = 정수 1~500, pageStep = 정수 1~500(0부터 센 N의 배수).
 *  - pageStep 1 = **배수 제약 없음**(템플릿셋 pageStep 을 무시 — 2026-09-29 오너 채택, bookmoa R-205).
 *  - 미전달·''·공백 → 경고 없이 부재. 그 외 무효값 → console.warn('[hostPageLimits] …') 후 무시.
 *  - 키별 사다리: options(props/URL) → metadata.orderOptions → 템플릿셋.
 *  - min > max: 같은 계층이면 둘 다 폐기, 계층이 다르면 orderOptions 쪽만 폐기.
 *  - pageStep 은 min 이 배수가 아니거나 범위 안에 배수가 없으면 폐기(템플릿 단위 적용).
 *  - 제본 최소/최대 쪽수는 키별로 대체: 호스트 pageCountMin 이 있으면 제본 최소, pageCountMax 가 있으면
 *    제본 최대를 적용하지 않는다(W5 — hostPageLimitSides·bindingPageBounds). 보내지 않은 쪽은 제본 값 유지.
 */
import { BINDING_CONSTRAINTS, type BindingType } from '@storige/types'
import { normalizePageStep } from './pageStep'

/** 호스트 쪽수 상한(물리 페이지). bookmoa 최대 상품(500p) 기준. */
export const HOST_PAGE_LIMIT_MAX = 500

/**
 * 펼침면(2-up) 내지 세트의 용량 상한(물리 페이지) = UNDERLAY_MAX_PAGES(200) × 2.
 * contentPdfGuide 는 스토어·canvas-core 를 끌어오므로 로컬 상수로 두고 테스트로 동치를 고정한다.
 * 이 값 이하이면 펼침면 복원 분기의 200장 절사에 도달하지 않는다.
 */
export const SPREAD_INNER_HOST_MAX = 400

export interface HostPageLimits {
  /** 호스트 최소 내지 쪽수(물리 페이지) */
  pageCountMin?: number
  /** 호스트 최대 내지 쪽수(물리 페이지) */
  pageCountMax?: number
  /** 호스트 내지 쪽수 배수 단위(0부터 센 N의 배수, ≥ 2). 1 = 배수 제약 없음(템플릿셋 단위 무시) */
  pageStep?: number
}

const WARN_PREFIX = '[hostPageLimits]'

type Coerced = { kind: 'absent' } | { kind: 'valid'; value: number } | { kind: 'invalid' }

const ABSENT: Coerced = { kind: 'absent' }
const INVALID: Coerced = { kind: 'invalid' }

/**
 * 정수 강제 변환. 문자열은 trim 후 /^\d+$/ 만(소수·지수·16진·부호 거부), 숫자는 Number.isInteger.
 * undefined/null/''/공백 = 부재.
 */
function coerceInteger(raw: unknown): Coerced {
  if (raw === undefined || raw === null) return ABSENT
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return ABSENT
    if (!/^\d+$/.test(trimmed)) return INVALID
    return { kind: 'valid', value: Number(trimmed) }
  }
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? { kind: 'valid', value: raw } : INVALID
  }
  return INVALID
}

/** pageCountMin / pageCountMax: 정수 1..HOST_PAGE_LIMIT_MAX */
function coerceCountLimit(raw: unknown): Coerced {
  const c = coerceInteger(raw)
  if (c.kind !== 'valid') return c
  return c.value >= 1 && c.value <= HOST_PAGE_LIMIT_MAX ? c : INVALID
}

/**
 * pageStep: 1 = 배수 제약 없음(유효값 — 템플릿셋 단위를 무시하도록 전달), 그 외 normalizePageStep(≥2 정수)
 * && ≤ HOST_PAGE_LIMIT_MAX. (종전 bb626de 는 1 을 부재로 버렸다 — 2026-09-29 오너 채택으로 의미 부여)
 */
function coercePageStep(raw: unknown): Coerced {
  const c = coerceInteger(raw)
  if (c.kind !== 'valid') return c
  if (c.value === 1) return c
  return normalizePageStep(c.value) !== null && c.value <= HOST_PAGE_LIMIT_MAX ? c : INVALID
}

/**
 * `pageCountMin` / `pageCountMax` URL 파라미터 파싱. 미전달·빈 문자열·공백은 조용히 undefined,
 * 비어있지 않은 무효값('0'·'-1'·'16.5'·'1e2'·'0x10'·'abc'·'501')은 경고 후 undefined.
 */
export function parsePageCountLimitParam(
  raw: string | null | undefined,
  key: 'pageCountMin' | 'pageCountMax',
): number | undefined {
  const c = coerceCountLimit(raw)
  if (c.kind === 'invalid') {
    console.warn(`${WARN_PREFIX} ${key} 파라미터 무시 — 정수 1~${HOST_PAGE_LIMIT_MAX} 가 아님: "${String(raw)}"`)
    return undefined
  }
  return c.kind === 'valid' ? c.value : undefined
}

/**
 * `pageStep` URL 파라미터 파싱. 미전달·빈 문자열·공백은 조용히 undefined, '1' 은 1(배수 제약 없음),
 * 비어있지 않은 무효값('0'·'2.5'·'1e1'·'0x4'·'x'·'501')은 경고 후 undefined.
 */
export function parsePageStepParam(raw: string | null | undefined): number | undefined {
  const c = coercePageStep(raw)
  if (c.kind === 'invalid') {
    console.warn(`${WARN_PREFIX} pageStep 파라미터 무시 — 정수 1~${HOST_PAGE_LIMIT_MAX} 가 아님: "${String(raw)}"`)
    return undefined
  }
  return c.kind === 'valid' ? c.value : undefined
}

/** 값이 채택된 계층: 1 = options(props/URL), 2 = metadata.orderOptions */
type Tier = 1 | 2

interface Resolved {
  value: number
  tier: Tier
}

/**
 * 호스트 쪽수 한도 사다리 (키별 독립 해석).
 *
 * - 1순위 options(props/URL — EmbedView 가 URL 을 options 로 매핑하므로 같은 계층).
 *   비어있지 않은 무효값은 경고 후 다음 계층으로.
 * - 2순위 sessionMetadata.orderOptions(재편집 전용). 무효값은 조용히 건너뜀.
 * - 이후 쌍/정렬/실현가능성 규칙을 호스트 값에만 적용한다.
 * - 세션 생성 기록은 resolveHostPageLimits(options, undefined) — 부재면 {} 라 메타데이터 불변.
 */
export function resolveHostPageLimits(
  options: { pageCountMin?: unknown; pageCountMax?: unknown; pageStep?: unknown } | undefined,
  sessionMetadata: unknown,
): HostPageLimits {
  const meta = isRecord(sessionMetadata) ? sessionMetadata : {}
  const orderOptions = isRecord(meta.orderOptions) ? meta.orderOptions : {}

  const pick = (
    key: 'pageCountMin' | 'pageCountMax' | 'pageStep',
    coerce: (raw: unknown) => Coerced,
  ): Resolved | undefined => {
    const fromOptions = coerce(options?.[key])
    if (fromOptions.kind === 'valid') return { value: fromOptions.value, tier: 1 }
    if (fromOptions.kind === 'invalid') {
      console.warn(`${WARN_PREFIX} options.${key} 무시 — 유효 범위 밖: ${String(options?.[key])}`)
    }
    const fromMeta = coerce(orderOptions[key])
    if (fromMeta.kind === 'valid') return { value: fromMeta.value, tier: 2 }
    return undefined
  }

  let min = pick('pageCountMin', coerceCountLimit)
  let max = pick('pageCountMax', coerceCountLimit)
  let step = pick('pageStep', coercePageStep)

  // 규칙 5: 쌍 검사
  if (min && max && min.value > max.value) {
    if (min.tier === max.tier) {
      console.warn(
        `${WARN_PREFIX} pageCountMin ${min.value} > pageCountMax ${max.value} — 둘 다 무시(템플릿셋 범위 적용)`,
      )
      min = undefined
      max = undefined
    } else if (min.tier === 2) {
      console.warn(
        `${WARN_PREFIX} 세션 기록 pageCountMin ${min.value} > 전달 pageCountMax ${max.value} — 세션 기록 최소값 무시`,
      )
      min = undefined
    } else {
      console.warn(
        `${WARN_PREFIX} 전달 pageCountMin ${min.value} > 세션 기록 pageCountMax ${max.value} — 세션 기록 최대값 무시`,
      )
      max = undefined
    }
  }

  // 규칙 6: 기준 정렬 — 편집기 단위는 0부터 센 배수라 min 이 배수가 아니면 완료가 막힐 수 있다.
  if (step && min && min.value % step.value !== 0) {
    console.warn(
      `${WARN_PREFIX} pageCountMin ${min.value} 이 pageStep ${step.value} 의 배수가 아님 — pageStep 무시(템플릿셋 단위 적용)`,
    )
    step = undefined
  }

  // 규칙 7: 실현 가능성 — 범위 안에 배수가 없으면 단위 폐기
  if (step && max && Math.floor(max.value / step.value) * step.value < (min?.value ?? 1)) {
    console.warn(
      `${WARN_PREFIX} [${min?.value ?? 1}, ${max.value}] 안에 pageStep ${step.value} 의 배수가 없음 — pageStep 무시`,
    )
    step = undefined
  }

  return {
    ...(min ? { pageCountMin: min.value } : {}),
    ...(max ? { pageCountMax: max.value } : {}),
    ...(step ? { pageStep: step.value } : {}),
  }
}

/** 호스트 최소/최대 쪽수 중 하나라도 있는가(pageStep 단독은 범위 한도가 아님). */
export function hasHostPageCountLimit(l: HostPageLimits | undefined): boolean {
  return typeof l?.pageCountMin === 'number' || typeof l?.pageCountMax === 'number'
}

/** 호스트 쪽수 범위를 보낸 쪽(키별). pageStep 단독은 어느 쪽도 아니다. */
export interface HostPageLimitSides {
  min: boolean
  max: boolean
}

/** 해석된 호스트 한도에서 보낸 쪽을 키별로 판정한다(검증된 키만 남으므로 typeof 로 충분). */
export function hostPageLimitSides(l?: HostPageLimits): HostPageLimitSides {
  return {
    min: typeof l?.pageCountMin === 'number',
    max: typeof l?.pageCountMax === 'number',
  }
}

/**
 * 적용할 제본 최소/최대 쪽수(물리 페이지). 제본 한도 판정의 단일 진입점.
 *
 * - bindingType 없음(null/undefined) → {} (제약 없음).
 * - sides.min = true(호스트 pageCountMin 보냄) → 제본 최소(무선 32) 미적용.
 * - sides.max = true(호스트 pageCountMax 보냄) → 제본 최대(중철 64) 미적용.
 * - sides 미전달 = 둘 다 false(제본 값 그대로).
 */
export function bindingPageBounds(
  bindingType: BindingType | null | undefined,
  sides?: HostPageLimitSides,
): { minPages?: number; maxPages?: number } {
  if (!bindingType) return {}
  const c = BINDING_CONSTRAINTS[bindingType]
  if (!c) return {}
  const out: { minPages?: number; maxPages?: number } = {}
  if (typeof c.minPages === 'number' && !sides?.min) out.minPages = c.minPages
  if (typeof c.maxPages === 'number' && !sides?.max) out.maxPages = c.maxPages
  return out
}

/**
 * 유효 쪽수 범위 = 템플릿셋 범위 위에 호스트 min/max 를 덮어쓴 값.
 *
 * - 호스트 min/max 가 없으면 **입력 참조 그대로** 반환(identity — capacityMax 도 미적용).
 * - 빠진 쪽은 템플릿 값, 그것도 없으면 1 / 100.
 * - 한쪽만 준 값이 템플릿 반대쪽과 모순되면 빠진 쪽을 500 / 1 로 넓힌다([min,min] 고정 금지).
 * - capacityMax(펼침면 내지 400) 초과 시 경고 후 낮춘다.
 */
export function mergePageCountRange(
  templateRange: number[] | null | undefined,
  limits: HostPageLimits | undefined,
  capacityMax?: number,
): number[] | null | undefined {
  if (!hasHostPageCountLimit(limits)) return templateRange
  const hostMin = limits?.pageCountMin
  const hostMax = limits?.pageCountMax
  const hasTemplate = Array.isArray(templateRange) && templateRange.length > 0
  const tMin = hasTemplate ? Math.min(...templateRange) : undefined
  const tMax = hasTemplate ? Math.max(...templateRange) : undefined

  let min = hostMin ?? tMin ?? 1
  let max = hostMax ?? tMax ?? 100
  if (min > max) {
    if (hostMin !== undefined && hostMax === undefined) {
      max = HOST_PAGE_LIMIT_MAX
    } else if (hostMax !== undefined && hostMin === undefined) {
      min = 1
    }
  }
  if (typeof capacityMax === 'number' && max > capacityMax) {
    console.warn(
      `${WARN_PREFIX} 최대 ${max}p > 펼침면 내지 용량 상한 ${capacityMax}p — ${capacityMax}p 로 낮춤`,
    )
    max = capacityMax
    min = Math.min(min, max)
  }
  return [Math.min(min, max), Math.max(min, max)]
}

/**
 * 호스트 pageCount 시드 보정.
 *
 * - 호스트 min/max 없음: 종전 인라인 클램프와 동일([Math.min(...range), Math.max(...range)], 빈 범위면 그대로).
 * - 호스트 min/max + 재진입(restoredInnerCount > 0): max(requested, 복원 내지 수), 범위 클램프 없음
 *   — 저장된 쪽수를 그대로 복원(URL pageCount 가 더 작아도 절단 없음).
 * - 그 외: 병합 범위로 클램프.
 * adjusted/bound 는 로더가 종전 경고 문구를 그대로 내도록 돌려준다. 템플릿 내지수 하한은 로더에 그대로 둔다.
 */
export function resolveSeedPageCount(input: {
  requested: number
  templateRange: number[] | null | undefined
  limits?: HostPageLimits
  restoredInnerCount?: number
}): { count: number; adjusted: 'min' | 'max' | 'restore' | null; bound?: number } {
  const { requested, templateRange, limits, restoredInnerCount } = input
  if (hasHostPageCountLimit(limits)) {
    if (
      typeof restoredInnerCount === 'number' &&
      Number.isFinite(restoredInnerCount) &&
      restoredInnerCount > 0
    ) {
      // 요청값은 실효 상한으로만 클램프한다(잘못된 큰 pageCount 로 캔버스 폭주 방지).
      // 하한은 걸지 않고(재진입에서 빈 페이지를 덧붙이지 않음), 저장된 페이지 수는 절대
      // 줄이지 않는다(복원 절단 금지 — R2 원칙).
      const range = mergePageCountRange(templateRange, limits) || []
      const effMax = range.length > 0 ? Math.max(...range) : undefined
      const cappedRequested = effMax !== undefined && requested > effMax ? effMax : requested
      if (restoredInnerCount > cappedRequested) {
        return { count: restoredInnerCount, adjusted: 'restore', bound: restoredInnerCount }
      }
      return cappedRequested !== requested
        ? { count: cappedRequested, adjusted: 'max', bound: cappedRequested }
        : { count: requested, adjusted: null }
    }
    return clampToRange(requested, mergePageCountRange(templateRange, limits) || [])
  }
  return clampToRange(requested, templateRange || [])
}

/** 종전 인라인 클램프 그대로: min 미만 → min, 이후 max 초과 → max. */
function clampToRange(
  requested: number,
  range: number[],
): { count: number; adjusted: 'min' | 'max' | null; bound?: number } {
  let result: { count: number; adjusted: 'min' | 'max' | null; bound?: number } = {
    count: requested,
    adjusted: null,
  }
  if (range.length > 0) {
    const minPages = Math.min(...range)
    const maxPages = Math.max(...range)
    if (result.count < minPages) result = { count: minPages, adjusted: 'min', bound: minPages }
    if (result.count > maxPages) result = { count: maxPages, adjusted: 'max', bound: maxPages }
  }
  return result
}

/**
 * 스토어(useEditorStore) 쪽수 한도 필드.
 *
 * - 호스트 값 없음: { pageCountRange: templateRange ?? [], pageStep: normalizePageStep(template),
 *   padToPageStep: templatePadToPageStep === true } — 종전 식과 동일(참조 포함).
 * - pageStep = (ignoreHostStep ? 없음 : 호스트 단위) ?? 템플릿 단위.
 * - 호스트 pageStep 1 = 배수 제약 없음 → pageStep null(템플릿 단위 무시). 제약이 없으므로 캔버스 산정
 *   기준과 무관해 ignoreHostStep 이어도 적용한다.
 * - 유효 호스트 단위(1 포함)가 템플릿 단위와 다르면 padToPageStep=false (서버 채움은 템플릿 단위 기준).
 */
export function resolveStorePageLimits(input: {
  templateRange: number[] | null | undefined
  templatePageStep: unknown
  templatePadToPageStep: unknown
  limits?: HostPageLimits
  capacityMax?: number
  ignoreHostStep?: boolean
}): { pageCountRange: number[]; pageStep: number | null; padToPageStep: boolean } {
  const templateStep = normalizePageStep(input.templatePageStep)
  const templatePad = input.templatePadToPageStep === true
  const hostNoConstraint = input.limits?.pageStep === 1
  const hostStep = input.ignoreHostStep || hostNoConstraint ? null : normalizePageStep(input.limits?.pageStep)
  const overridesTemplate = hostNoConstraint ? templateStep !== null : hostStep !== null && hostStep !== templateStep
  return {
    pageCountRange: mergePageCountRange(input.templateRange, input.limits, input.capacityMax) ?? [],
    pageStep: hostNoConstraint ? null : hostStep ?? templateStep,
    padToPageStep: overridesTemplate ? false : templatePad,
  }
}

/**
 * SidePanel '페이지' 섹션 한도(settings.page.min/max — 전체 캔버스 수 단위).
 *
 * effMin = max(range[0] || 1, bindMin), effMax = min(range[last] || 100, bindMax) — 스토어 게이트와 같은 식.
 * bindMin/bindMax 는 bindingPageBounds 결과 — 호스트 범위를 보낸 쪽은 제본 값이 빠져 undefined 다.
 * 물리 페이지 → 캔버스: anchor + ceil(effMin/per) .. anchor + floor(effMax/per) (max ≥ min 보장).
 * anchor = 내지가 아닌 캔버스 수(단일: 표지 등 비내지 템플릿 수, 스프레드: 표지 1 / 내지 전용 0).
 */
export function settingsPageBounds(input: {
  range: number[]
  per: number
  anchorCanvases: number
  bindMin?: number
  bindMax?: number
}): { min: number; max: number } {
  const { range, anchorCanvases } = input
  const per = input.per > 0 ? input.per : 1
  const effMin = Math.max(range[0] || 1, input.bindMin ?? 0)
  const effMax = Math.min(range[range.length - 1] || 100, input.bindMax ?? Infinity)
  const min = anchorCanvases + Math.ceil(effMin / per)
  const max = Math.max(anchorCanvases + Math.floor(effMax / per), min)
  return { min, max }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
