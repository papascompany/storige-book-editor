/**
 * S9 (2026-09-28) — editor.pricingChange 책등 확정값 재발신 판단(순수 함수).
 *
 * 페이지 증감 → pricingChange 발신(300ms debounce)과 책등 재계산(spineCalculator, 300ms
 * debounce + API 왕복)은 서로 독립적으로 끝난다. 재계산이 발신보다 늦게 끝나면 이미 나간
 * payload.spineWidthMm 은 직전 값이므로, 재계산 완료 후 적용 책등 폭이 달라졌을 때만 같은
 * payload 를 1회 더 발신한다.
 */

/** 직전 pricingChange 발신 상태 */
export interface PricingEmitState {
  /**
   * 재발신 대기 여부 — 페이지 증감(또는 재초기화)으로 발신할 때 true, 재발신 1회 후 false.
   * 페이지 변경 1건당 추가 발신을 최대 1회로 제한한다.
   */
  armed: boolean
  /** 직전 발신 payload 의 spineWidthMm (미포함이면 undefined) */
  spineWidthMm: number | undefined
}

/**
 * 책등 재계산 완료 후 pricingChange 를 다시 보낼지 판단한다.
 *  - 직전 발신이 없거나(null) 이미 재발신했으면(armed=false) 보내지 않는다.
 *  - 현재 적용 책등 폭이 없으면(비-스프레드·내지 전용 세션 등) 보내지 않는다.
 *  - 직전 발신 값과 같으면 중복이므로 보내지 않는다.
 */
export function shouldReemitPricing(
  prevEmitted: PricingEmitState | null,
  currentSpineWidthMm: number | undefined,
): boolean {
  if (!prevEmitted || !prevEmitted.armed) return false
  if (currentSpineWidthMm === undefined) return false
  return currentSpineWidthMm !== prevEmitted.spineWidthMm
}
