// core.loadFromJSON — 세션 복원 입력에서 책등 가이드 잔재를 빼고 fabric 에 넘기는지 고정.
import { describe, it, expect } from 'vitest'
import { core } from './canvas'

function fakeCanvas() {
  const calls: unknown[] = []
  const canvas = {
    loadFromJSON(input: unknown, cb: () => void) {
      calls.push(input)
      cb()
    },
    getObjects: () => [],
    renderAll() {},
  }
  return { canvas, calls }
}

describe('core.loadFromJSON — 책등 가이드 잔재', () => {
  it('객체·문자열 입력 모두에서 잔재를 뺀 데이터를 넘긴다', async () => {
    const data = {
      objects: [
        { type: 'rect', id: 'workspace' },
        { type: 'line', id: 'spread-guide-0' },
        { type: 'text', text: '301.0mm' },
        { type: 'i-text', id: 't1', text: '제목' },
      ],
    }
    for (const input of [data, JSON.stringify(data)]) {
      const { canvas, calls } = fakeCanvas()
      await core.loadFromJSON(canvas as any, input)
      const passed = calls[0] as { objects: Array<{ id?: string }> }
      expect(passed.objects.map((o) => o.id)).toEqual(['workspace', 't1'])
    }
    expect(data.objects).toHaveLength(4) // 호출자의 데이터는 바꾸지 않는다
  })
})
