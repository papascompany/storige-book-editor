/**
 * URL 이미지 로드 결과 판정 — imageFromURL(canvas.ts core 네임스페이스·factory.ts) 공용.
 *
 * fabric 5 의 Image.fromURL 은 로드에 실패해도 콜백을 `(new fabric.Image(null), true)` 로 부른다.
 * 첫 인자가 항상 객체라 `!img` 검사로는 실패를 잡지 못하고, 0×0 이미지가 성공처럼 넘어가
 * 호출처의 배율 계산(대상 크기 / img.width)이 Infinity 가 된다.
 */

const MAX_URL_SUMMARY_LENGTH = 80

/**
 * 오류 메시지용 URL 요약. 쿼리스트링·해시(서명 토큰이 실릴 수 있음)를 버리고 앞부분만 남긴다.
 * data URL 은 본문 없이 `data:<mime>` 만 남긴다.
 */
export function summarizeImageUrl(url: unknown): string {
  if (typeof url !== 'string' || url.length === 0) return '(빈 URL)'
  if (url.startsWith('data:')) {
    const end = url.search(/[;,]/)
    const head = end > 0 ? url.slice(0, end) : url
    return head.length > MAX_URL_SUMMARY_LENGTH ? `${head.slice(0, MAX_URL_SUMMARY_LENGTH)}…` : head
  }
  const cut = url.search(/[?#]/)
  const base = cut >= 0 ? url.slice(0, cut) : url
  return base.length > MAX_URL_SUMMARY_LENGTH ? `${base.slice(0, MAX_URL_SUMMARY_LENGTH)}…` : base
}

/**
 * fromURL 콜백 결과가 실패인지 판정한다.
 * - img 없음, isError=true, 또는 width/height 가 0 이하(빈 요소)면 실패.
 * 실패면 reject 할 Error 를, 성공이면 null 을 돌려준다.
 */
export function imageLoadFailure(
  img: { width?: number; height?: number } | null | undefined,
  isError: boolean | undefined,
  url: unknown,
): Error | null {
  const ok = !!img && isError !== true && (img.width ?? 0) > 0 && (img.height ?? 0) > 0
  if (ok) return null
  return new Error(`이미지 로드 실패: ${summarizeImageUrl(url)}`)
}
