/**
 * 방향(가로/세로) 불일치 가드레일 (2026-07-09)
 *
 * 호스트(bookmoa 등)가 임베드에 넘긴 주문 규격(width/height mm)의 방향과, 실제 로드된
 * templateSet 규격의 방향이 어긋나는 상황을 표면화하기 위한 순수 판정 로직.
 *
 * 대표 사고: 고객이 "가로형"을 선택 → 호스트가 가로 치수(W↔H 스왑)를 전달했는데, 가로
 * templateSet 이 배선되지 않아(storigeTemplateSetIdLandscape 누락) **세로 templateSet 으로
 * 폴백** → 편집기가 조용히 세로 캔버스로 열림. 이 유틸은 그 불일치를 감지만 하며(비차단),
 * 호출측이 경고/텔레메트리로 노출한다.
 *
 * 오탐 방지: size 미전달(방향 신호 없음)·정사각(방향 모호)·무효 입력은 불일치로 보지 않는다.
 */

export type Orientation = 'portrait' | 'landscape' | 'square'

export interface OrientationSize {
  width?: number | null
  height?: number | null
}

export interface OrientationMismatch {
  /** 호스트가 넘긴 주문 규격의 방향 */
  requested: 'portrait' | 'landscape'
  /** 실제 로드된 templateSet 규격의 방향 */
  template: 'portrait' | 'landscape'
  requestedSize: { width: number; height: number }
  templateSize: { width: number; height: number }
}

/**
 * 규격의 방향 분류.
 * - width > height → 'landscape'
 * - height > width → 'portrait'
 * - |width - height| ≤ toleranceMm → 'square'(방향 모호)
 * - 비수치/음수/0 등 무효 입력 → null
 *
 * @param toleranceMm 정사각 근처(판형 오차)에서 방향 노이즈를 막는 여유값(mm, 기본 1)
 */
export function classifyOrientation(
  width?: number | null,
  height?: number | null,
  toleranceMm = 1,
): Orientation | null {
  if (typeof width !== 'number' || typeof height !== 'number') return null
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width <= 0 || height <= 0) return null
  if (Math.abs(width - height) <= toleranceMm) return 'square'
  return width > height ? 'landscape' : 'portrait'
}

/**
 * 주문 규격(requested)과 templateSet 규격(template)의 방향이 **명확히** 어긋나면
 * 불일치 정보를 반환, 아니면 null.
 *
 * 다음 경우는 모두 null(불일치 아님 — 오탐 방지):
 * - 둘 중 하나라도 size 미전달/무효
 * - 둘 중 하나라도 정사각(방향 모호)
 * - 방향이 같음
 *
 * book/spread 모드에서 templateSet.width/height 는 **단일 페이지** 치수이고, 호스트가 넘기는
 * 주문 규격도 단일 페이지(재단) 치수이므로 동일 기준으로 비교된다(스프레드 총 폭 아님).
 */
export function detectOrientationMismatch(
  requestedSize: OrientationSize | null | undefined,
  templateSize: OrientationSize | null | undefined,
  toleranceMm = 1,
): OrientationMismatch | null {
  if (!requestedSize || !templateSize) return null

  const requested = classifyOrientation(requestedSize.width, requestedSize.height, toleranceMm)
  const template = classifyOrientation(templateSize.width, templateSize.height, toleranceMm)

  if (!requested || !template) return null
  if (requested === 'square' || template === 'square') return null
  if (requested === template) return null

  return {
    requested,
    template,
    requestedSize: { width: requestedSize.width as number, height: requestedSize.height as number },
    templateSize: { width: templateSize.width as number, height: templateSize.height as number },
  }
}
