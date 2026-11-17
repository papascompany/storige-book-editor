/**
 * 저장된 canvasData 에 남아 있는 책등 가이드·치수 라벨 잔재를 걸러낸다.
 *
 * SpreadPlugin 의 가이드는 화면 전용(excludeFromExport)이라 저장되지 않지만, 예전에 저장된
 * 데이터에는 일반 객체로 들어가 있는 것이 있다. 그대로 불러오면 사용자 객체로 취급돼
 * 재단선 이탈 집계에 잡히고 출력에도 실린다. 가이드는 SpreadPlugin 이 다시 그리므로
 * 불러오기 전에 빼는 것이 맞다.
 *
 * 오탐을 피하려고 실제 저장 데이터에서 확인된 형상만 고른다(top-level 객체만 본다).
 *  - meta.system 이 'spreadGuide' / 'dimensionLabel' 인 객체
 *  - id 가 'spread-guide-' 로 시작하는 line
 *  - 문구가 '203.2mm' 꼴인 text 로, id 가 없거나 템플릿 id 채우기가 붙인 id('tplobj-')인 것.
 *    사용자가 넣는 글은 i-text/textbox 라 이 유형(text)에 해당하지 않는다.
 *
 * 걸러낼 것이 없으면 입력을 그대로 돌려준다.
 */

const DIMENSION_LABEL_TEXT = /^\d+(\.\d+)?mm$/u
const GUIDE_SYSTEM_MARKERS = new Set(['spreadGuide', 'dimensionLabel'])
const FILLED_TEMPLATE_ID_PREFIX = 'tplobj-'

type SerializedObject = {
  id?: unknown
  type?: unknown
  text?: unknown
  meta?: unknown
}

export function isSpreadGuideResidue(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false
  const o = obj as SerializedObject
  const meta = o.meta
  const system =
    meta && typeof meta === 'object' ? (meta as { system?: unknown }).system : undefined
  if (typeof system === 'string' && GUIDE_SYSTEM_MARKERS.has(system)) return true

  const id = typeof o.id === 'string' ? o.id : undefined
  if (o.type === 'line' && id !== undefined && id.startsWith('spread-guide-')) return true

  if (
    o.type === 'text' &&
    typeof o.text === 'string' &&
    DIMENSION_LABEL_TEXT.test(o.text) &&
    (id === undefined || id.startsWith(FILLED_TEMPLATE_ID_PREFIX))
  ) {
    return true
  }
  return false
}

export function stripSpreadGuideResidue<T>(input: T): T {
  if (!input || typeof input !== 'object') return input
  const objects = (input as { objects?: unknown }).objects
  if (!Array.isArray(objects)) return input
  const kept = objects.filter((obj) => !isSpreadGuideResidue(obj))
  if (kept.length === objects.length) return input
  return { ...(input as object), objects: kept } as T
}
