import { TemplatePlugin } from '@storige/canvas-core'

/**
 * 서버에서 받은 템플릿의 canvasData 에서 id 가 없는 top-level 객체에 id 를 채운 사본을 돌려준다.
 * id 는 템플릿 id 와 객체 순번으로 정해져 언제 받아도 같다(TemplatePlugin.fillTemplateObjectIds).
 * id 가 없는 템플릿 객체는 페이지 템플릿을 바꿀 때 템플릿 유래인지 가려낼 수 없어 옛 요소가 남고,
 * 고객이 고친 문구를 새 템플릿으로 옮길 짝도 찾을 수 없다.
 * canvasData 가 객체({ objects })이거나 그 배열일 때만 채운다. 그 밖의 모양과 채울 것이 없는 템플릿은 그대로 돌려준다.
 */
export function withTemplateObjectIds<T extends { id?: unknown; canvasData?: unknown }>(template: T): T {
  if (!template || typeof template !== 'object') return template
  const templateId = template.id
  if (typeof templateId !== 'string' || !templateId) return template
  const canvasData = fillCanvasData(templateId, template.canvasData)
  return canvasData === template.canvasData ? template : { ...template, canvasData }
}

function fillCanvasData(templateId: string, canvasData: unknown): unknown {
  if (Array.isArray(canvasData)) {
    // 캔버스가 여러 장인 템플릿 — 장마다 순번이 겹치지 않게 장 번호를 붙인다
    let changed = false
    const out = canvasData.map((one, index) => {
      const next = fillOne(index === 0 ? templateId : `${templateId}#${index}`, one)
      if (next !== one) changed = true
      return next
    })
    return changed ? out : canvasData
  }
  return fillOne(templateId, canvasData)
}

function fillOne(templateId: string, canvasData: unknown): unknown {
  if (!canvasData || typeof canvasData !== 'object') return canvasData
  const objects = (canvasData as { objects?: unknown }).objects
  if (!Array.isArray(objects)) return canvasData
  const filled = TemplatePlugin.fillTemplateObjectIds(templateId, objects)
  return filled === objects ? canvasData : { ...canvasData, objects: filled }
}
