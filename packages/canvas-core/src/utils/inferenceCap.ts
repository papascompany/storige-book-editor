/**
 * D-6b② (2026-08-05 오너 승인): 배경제거 추론 입력 픽셀 캡 — 장변 상한.
 *
 * imgly 는 내부 1024px 로 추론하고 마스크를 "입력 해상도"로 업스케일하므로,
 * 12MP 원본을 그대로 넣으면 피크 500~800MB(모바일 크래시 위험). 장변 2560
 * 사전 다운스케일은 추론 품질에 영향이 없고(내부 1024 고정) 결과 해상도만
 * 인쇄에 충분한 수준으로 제한한다. 워커 오프로드(D-6a=B) 전환 후에도
 * 업로드/전송량 상한으로 동일하게 유효하다.
 *
 * fabric/jsdom 무의존 순수 모듈 — 테스트가 네이티브 canvas 바인딩을 끌지
 * 않도록 플러그인에서 분리(curveText 전례).
 */

export const CUTOUT_MAX_LONG_EDGE = 2560

export interface InferenceCapResult {
  targetWidth: number
  targetHeight: number
  engaged: boolean
}

/**
 * 픽셀 캡 계산(순수 함수) — 장변이 maxLongEdge 를 넘으면 비율 유지 축소 치수 반환.
 * engaged=false 면 캡 미적용(원본 그대로 사용해야 함).
 */
export function computeInferenceCap(
  width: number,
  height: number,
  maxLongEdge: number = CUTOUT_MAX_LONG_EDGE
): InferenceCapResult {
  const w = Math.max(1, Math.floor(width))
  const h = Math.max(1, Math.floor(height))
  const longEdge = Math.max(w, h)
  if (longEdge <= maxLongEdge) {
    return { targetWidth: w, targetHeight: h, engaged: false }
  }
  const ratio = maxLongEdge / longEdge
  return {
    targetWidth: Math.max(1, Math.round(w * ratio)),
    targetHeight: Math.max(1, Math.round(h * ratio)),
    engaged: true
  }
}
