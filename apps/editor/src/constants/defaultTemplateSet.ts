/**
 * 편집기 기본 진입(URL 파라미터 없이 / 진입) 시 자동 로드되는 샘플 템플릿셋.
 *
 * 데이터:
 *   apps/api/migrations/20260508_seed_sample_template_set.sql
 *   - sample-spread-cover-8x8 (표지 스프레드, 8×8 inch)
 *   - sample-page-8x8 (내지, 8×8 inch)
 *   - sample-8x8-book-24p (책모드 템플릿셋, 표지 1 + 내지 24)
 *
 * 동작:
 *   EditorView 가 productId/contentId/templateSetId/editMode 어느 것도 받지 않은 경우
 *   이 templateSetId 로 강제 진입한다. (사용자가 표지부터 순서대로 편집할 수 있는
 *   기본 샘플)
 *
 * 환경변수 override:
 *   VITE_DEFAULT_TEMPLATE_SET_ID 가 설정되어 있으면 그 ID 를 우선 사용.
 *   배포별로 다른 샘플로 교체하고 싶을 때 .env 만 변경하면 됨.
 */
export const SAMPLE_TEMPLATE_SET_ID = 'sample-8x8-book-24p'

/**
 * env override 가 있으면 그것을, 없으면 SAMPLE_TEMPLATE_SET_ID 를 반환.
 * 빈 문자열 / 'none' / 'disabled' 으로 설정하면 디폴트 샘플 로드를 비활성화한다.
 */
export function getDefaultTemplateSetId(): string | null {
  const envValue = import.meta.env.VITE_DEFAULT_TEMPLATE_SET_ID
  if (typeof envValue === 'string') {
    const trimmed = envValue.trim()
    if (trimmed === '' || trimmed === 'none' || trimmed === 'disabled') {
      return null
    }
    return trimmed
  }
  return SAMPLE_TEMPLATE_SET_ID
}
