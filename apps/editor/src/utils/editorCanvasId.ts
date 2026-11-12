/**
 * 편집기가 새로 추가한 페이지는 서버 템플릿이 없어 `templateId` 자리에 캔버스 id(`canvas` + 숫자)를 쓴다
 * (useAppStore 의 페이지 추가 경로). 이런 id 로 템플릿 상세를 조회하면 항상 404 라, 조회 전에 걸러낸다.
 * 템플릿 id 는 UUID 가 아닌 것(시드 템플릿 등)도 있으므로 UUID 여부가 아니라 캔버스 id 형식만 본다.
 */
const EDITOR_CANVAS_ID = /^canvas\d+$/

export function isEditorCanvasId(id: string | null | undefined): boolean {
  return typeof id === 'string' && EDITOR_CANVAS_ID.test(id)
}
