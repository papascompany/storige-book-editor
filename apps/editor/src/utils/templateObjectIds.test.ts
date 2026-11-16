// withTemplateObjectIds — 서버에서 받은 템플릿의 id 없는 객체에 정해진 id 를 채운다.
import { describe, it, expect } from 'vitest'
import { withTemplateObjectIds } from './templateObjectIds'

type Plain = Record<string, unknown>
const objectsOf = (t: { canvasData?: unknown }) => (t.canvasData as { objects: Plain[] }).objects

describe('withTemplateObjectIds', () => {
  it('id 없는 객체에만 id 를 채우고, 같은 템플릿이면 다시 받아도 같은 id 다', () => {
    const make = () => ({
      id: 'tpl-1',
      name: '템플릿',
      canvasData: { version: '5.3.0', objects: [{ id: 'workspace' }, { type: 'textbox', text: '가' }, { type: 'rect', id: 'keep' }] },
    })
    const input = make()
    const snapshot = JSON.stringify(input)
    const a = withTemplateObjectIds(input)
    const b = withTemplateObjectIds(make())

    expect(JSON.stringify(input)).toBe(snapshot)
    expect(a.name).toBe('템플릿')
    expect((a.canvasData as Plain).version).toBe('5.3.0')
    expect(objectsOf(a).map((o) => o.id)).toEqual(['workspace', expect.stringMatching(/^tplobj-[0-9a-f]{8}-1$/), 'keep'])
    expect(objectsOf(a)[1].text).toBe('가')
    expect(objectsOf(b).map((o) => o.id)).toEqual(objectsOf(a).map((o) => o.id))
  })

  it('템플릿이 다르면 같은 순번이어도 id 가 다르다', () => {
    const one = (id: string) => withTemplateObjectIds({ id, canvasData: { objects: [{ type: 'textbox' }] } })
    expect(objectsOf(one('tpl-1'))[0].id).not.toBe(objectsOf(one('tpl-2'))[0].id)
  })

  it('채울 것이 없거나 모양이 다른 템플릿은 그대로 돌려준다', () => {
    const full = { id: 'tpl-1', canvasData: { objects: [{ id: 'a' }] } }
    expect(withTemplateObjectIds(full)).toBe(full)
    const noData = { id: 'tpl-1', canvasData: null }
    expect(withTemplateObjectIds(noData)).toBe(noData)
    const asString = { id: 'tpl-1', canvasData: '{"objects":[{}]}' }
    expect(withTemplateObjectIds(asString)).toBe(asString)
    const noId = { canvasData: { objects: [{ type: 'rect' }] } }
    expect(withTemplateObjectIds(noId)).toBe(noId)
  })

  it('캔버스가 여러 장인 템플릿은 장마다 겹치지 않는 id 를 채운다', () => {
    const out = withTemplateObjectIds({ id: 'tpl-1', canvasData: [{ objects: [{ type: 'rect' }] }, { objects: [{ type: 'rect' }] }] })
    const [first, second] = out.canvasData as Array<{ objects: Plain[] }>
    expect(first.objects[0].id).toMatch(/^tplobj-[0-9a-f]{8}-0$/)
    expect(second.objects[0].id).toMatch(/^tplobj-[0-9a-f]{8}-0$/)
    expect(first.objects[0].id).not.toBe(second.objects[0].id)
  })
})
