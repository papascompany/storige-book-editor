// 에셋/썸네일 URL 정규화 헬퍼 (트랙 EDITOR P0-B)
//
// 백엔드(library 에셋·editor_contents·세션 썸네일)는 `/storage/...` 같은 **상대 경로**를
// 반환한다. 이 경로를 그대로 <img src> 나 fabric loadSVGFromURL/imageFromURL 에 넘기면
// Vercel editor origin(editor.papascompany.co.kr) 기준으로 해석돼 404 가 난다.
// VITE_API_BASE_URL(= API origin, 기본 http://localhost:4000/api)을 prefix 해
// 절대 경로로 만든다 (apiClient base 와 동일한 경로 규칙).
//
// 절대 URL(http/https), data: URL, blob: URL 은 그대로 통과시킨다.
// (기존 HistoryPanel.resolveThumbnailUrl 로직을 승격·일원화.)

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api'

/**
 * 상대 스토리지 경로를 API origin 기준 절대 URL 로 변환한다.
 * - falsy → null
 * - 절대 URL(http/https) / data: / blob: → 원본 그대로
 * - 그 외(상대 경로, 예: `/storage/files/...`) → `${API_BASE_URL}${url}`
 */
export function resolveAssetUrl(
  url: string | null | undefined
): string | null {
  if (!url) return null
  // 절대 URL / 인라인 데이터 / 오브젝트 URL 은 변형하지 않는다.
  if (/^(https?:)?\/\//i.test(url)) return url
  if (/^(data|blob):/i.test(url)) return url
  // /storage/files/thumbnails/abc.jpg → {API_BASE_URL}/storage/files/thumbnails/abc.jpg
  const base = API_BASE_URL.replace(/\/$/, '')
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`
}
