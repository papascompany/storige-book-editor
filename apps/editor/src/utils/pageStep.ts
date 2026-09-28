/**
 * S8 (2026-09-28): 템플릿셋 내지 페이지 증감 단위(pageStep) 순수 헬퍼.
 *
 * - templateSet.pageStep = N(>=1 정수): 물리 내지 페이지 수가 N 의 배수여야 한다(예: 2 = 짝수만).
 *   null/1/비정상 값 = 제약 없음 → 기존 1장 단위 동작 그대로(byte-identical).
 * - 캔버스 1장이 담는 물리 페이지 수(pagesPerCanvas: 낱장=1, 펼침면=2)를 반영해
 *   "몇 장의 캔버스를 한 번에 추가/삭제해야 배수가 되는가"를 계산한다.
 * - 이 모듈은 스토어/fabric 의존 0 (단위 테스트 대상). 스토어 결선은 useEditorStore, 완료 차단은
 *   EditorHeader(UI 편집완료)·embed complete()(프로그래매틱)에서 한다.
 */

/** templateSet.pageStep 원시값 → 유효 단위(>=2 정수) 또는 null(제약 없음). */
export function normalizePageStep(raw: unknown): number | null {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 2) return null
  return n
}

/**
 * 현재 물리 페이지 수(physical)에서 캔버스를 k장(각 per 페이지) 추가/삭제했을 때
 * step 배수가 되는 가장 작은 k(>=1). step 범위 안에서 해가 없으면(예: per=2, step=3, 홀수 현재값)
 * lcm(step, per)/per 장 — 배수 잔여를 바꾸지 않는 최소 단위로 폴백("가능한 경우에만" 정렬).
 */
function smallestAligningCanvasCount(physical: number, step: number, per: number, dir: 1 | -1): number {
  for (let k = 1; k <= step; k++) {
    const next = physical + dir * k * per
    if (((next % step) + step) % step === 0) return k
  }
  return lcm(step, per) / per
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

/** 한 번의 '추가'로 생성할 캔버스 수. step=null → 1(기존 동작). */
export function pageAddCanvasCount(physical: number, step: number | null, per: number): number {
  if (!step) return 1
  return smallestAligningCanvasCount(physical, step, per > 0 ? per : 1, 1)
}

/** 한 번의 '삭제'로 제거할 캔버스 수. step=null → 1(기존 동작). */
export function pageDeleteCanvasCount(physical: number, step: number | null, per: number): number {
  if (!step) return 1
  return smallestAligningCanvasCount(physical, step, per > 0 ? per : 1, -1)
}

export interface PageStepViolation {
  /** 현재 물리 내지 페이지 수 */
  current: number
  /** 요구 단위 */
  step: number
  /** 올림 배수 (추가로 맞출 때 목표) */
  nextValid: number
  /** 내림 배수 (삭제로 맞출 때 목표, 0 이하이면 step) */
  prevValid: number
}

/** 물리 페이지 수가 step 배수가 아니면 위반 정보, 맞거나 제약 없음/측정 불가(0)면 null. */
export function getPageStepViolation(physical: number, step: number | null): PageStepViolation | null {
  if (!step || !Number.isFinite(physical) || physical <= 0) return null
  const rem = physical % step
  if (rem === 0) return null
  const prev = physical - rem
  return {
    current: physical,
    step,
    nextValid: physical + (step - rem),
    prevValid: prev > 0 ? prev : step,
  }
}

/** 고객 노출 한국어 안내 (배너·완료 차단 토스트·프로그래매틱 complete 에러 공통). */
export function pageStepViolationMessage(v: PageStepViolation): string {
  const fix =
    v.prevValid < v.current
      ? `${v.nextValid}페이지로 추가하거나 ${v.prevValid}페이지로 줄여 주세요.`
      : `${v.nextValid}페이지로 추가해 주세요.`
  return `내지는 ${v.step}페이지 단위로만 주문할 수 있습니다. 현재 ${v.current}페이지 — ${fix}`
}

/**
 * 완료 payload 의 pageCount 와 같은 기준의 물리 내지 페이지 수 (embed computeLivePageCount 와 동일 산식,
 * 단 0 은 폴백하지 않고 0 = 측정 불가로 돌려준다 — 가드가 빈 세션을 막지 않도록).
 * - 내지 전용 펼침면(regionScope='inner'): 캔버스 × 2
 * - 표지+내지 스프레드: (캔버스 − 표지 1) × pagesPerCanvas (캔버스 1장 = 표지 단독이면 0).
 *   표지+내지펼침면 세트는 pagesPerCanvas=2(2026-09-28, 책등 산식과 같은 기준), 낱장 내지는 1.
 * - 그 외(단일 모드): 캔버스 수
 */
export function livePhysicalPageCount(input: {
  canvasCount: number
  isSpreadMode: boolean
  regionScope?: string | null
  /** 스프레드 세션의 내지 캔버스 1장당 쪽수(useEditorStore.pagesPerCanvas). 기본 1 */
  pagesPerCanvas?: number
}): number {
  const count = Number.isFinite(input.canvasCount) && input.canvasCount > 0 ? Math.floor(input.canvasCount) : 0
  if (input.regionScope === 'inner') return count * 2
  if (!input.isSpreadMode) return count
  if (count <= 1) return 0
  return (count - 1) * spreadInnerPerCanvas(input.pagesPerCanvas)
}

function spreadInnerPerCanvas(raw: number | undefined): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1
}

/**
 * pageStep 산정 기준(세션 형태). 완료 가드(livePhysicalPageCount)와 추가/삭제 단위 계산이
 * **같은 산식**을 쓰도록 스토어에 적재한다 — 둘이 다르면 단위 이동으로 배수에 영영 도달하지 못해
 * 완료가 영구 차단될 수 있다(S8 리뷰: 펼침면 내지 TemplateType.SPREAD 를 0장으로 셌던 결함).
 */
export interface PageStepBasis {
  isSpreadMode: boolean
  regionScope: string | null
}

export const DEFAULT_PAGE_STEP_BASIS: PageStepBasis = { isSpreadMode: false, regionScope: null }

/**
 * 캔버스 수 → { 가드 기준 물리 페이지 수, 캔버스 1장 추가/삭제 시 증감 페이지 수 }.
 * - 내지 전용 펼침면(regionScope='inner'): 캔버스 1장 = 2p
 * - 표지+내지 스프레드: 캔버스 1장 = pagesPerCanvas(내지펼침면 2 · 낱장 1)
 * - 단일 모드: 캔버스 1장 = 1p (완료 payload pageCount 산식과 동일)
 */
export function pageStepMetric(
  canvasCount: number,
  basis: PageStepBasis,
  pagesPerCanvas: number = 1,
): { physical: number; perCanvas: number } {
  return {
    physical: livePhysicalPageCount({ canvasCount, isSpreadMode: basis.isSpreadMode, regionScope: basis.regionScope, pagesPerCanvas }),
    perCanvas: basis.regionScope === 'inner' ? 2 : basis.isSpreadMode ? spreadInnerPerCanvas(pagesPerCanvas) : 1,
  }
}

/**
 * 단위 삭제 대상 인덱스(대상 + 인접 연속 구간, 뒤쪽 우선 → 부족하면 앞쪽).
 * removable 이 false 인 칸을 만나면 그 방향은 중단. unit 을 채우지 못하면 [] (삭제 불가).
 */
export function adjacentDeleteIndices(
  length: number,
  targetIdx: number,
  unit: number,
  removable: (idx: number) => boolean = () => true,
): number[] {
  if (targetIdx < 0 || targetIdx >= length || !removable(targetIdx)) return []
  const group = [targetIdx]
  for (let i = targetIdx + 1; group.length < unit && i < length && removable(i); i++) group.push(i)
  for (let i = targetIdx - 1; group.length < unit && i >= 0 && removable(i); i--) group.push(i)
  return group.length === unit ? group : []
}
