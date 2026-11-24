// removeObjectsWithUpdate — 순차 removeWithUpdate 와 같은 결과를 내는지 실 fabric(5.5.2, node-canvas)에서 고정한다.
//
// 고정하는 계약:
//  (1) 회전·배율·뒤집기가 있는 그룹에서 텍스트 여러 개를 빼면, 빠진 객체·남은 그룹·남은 자식의 좌표가
//      하나씩 removeWithUpdate 한 결과와 같다(부동소수 오차 1e-6 이내).
//  (2) 빠진 객체는 group 참조가 없고, 그룹 _objects 에 남은 자식만 있다.
//  (3) 뺄 객체가 없으면 그룹을 건드리지 않는다.
import { describe, it, expect } from 'vitest'
import { fabric } from 'fabric'
import { removeObjectsWithUpdate } from './groupRemove'

type Built = { group: fabric.Group; texts: fabric.Text[]; rect: fabric.Rect }

function build(): Built {
  const texts = [
    new fabric.Text('가', { left: 10, top: 20, fontSize: 30, angle: 15 }),
    new fabric.Text('나다', { left: 120, top: 40, fontSize: 24, scaleX: 1.5 }),
    new fabric.Text('라', { left: 60, top: 160, fontSize: 40, flipX: true }),
  ]
  const rect = new fabric.Rect({ left: 0, top: 0, width: 300, height: 220, fill: '#eee' })
  const group = new fabric.Group([rect, ...texts], {
    left: 50,
    top: 70,
    angle: 30,
    scaleX: 1.2,
    scaleY: 0.8,
    flipY: true,
  })
  return { group, texts, rect }
}

const KEYS = ['left', 'top', 'width', 'height', 'scaleX', 'scaleY', 'angle', 'skewX', 'skewY', 'flipX', 'flipY'] as const

function snapshot(o: fabric.Object): Record<string, number | boolean | undefined> {
  const out: Record<string, number | boolean | undefined> = {}
  for (const k of KEYS) out[k] = o[k]
  return out
}

function expectSame(a: fabric.Object, b: fabric.Object): void {
  const sa = snapshot(a)
  const sb = snapshot(b)
  for (const k of KEYS) {
    const va = sa[k]
    const vb = sb[k]
    if (typeof va === 'number' && typeof vb === 'number') expect(va, k).toBeCloseTo(vb, 6)
    else expect(va, k).toBe(vb)
  }
}

describe('removeObjectsWithUpdate', () => {
  it('(1)(2) 순차 removeWithUpdate 와 좌표가 같고, 빠진 객체는 group 참조가 없다', () => {
    const seq = build()
    for (const t of seq.texts) seq.group.removeWithUpdate(t)

    const batch = build()
    removeObjectsWithUpdate(batch.group, batch.texts)

    expectSame(batch.group, seq.group)
    expectSame(batch.rect, seq.rect)
    batch.texts.forEach((t, i) => {
      expectSame(t, seq.texts[i])
      expect(t.group).toBeUndefined()
    })
    expect(batch.group.getObjects()).toEqual([batch.rect])
    expect(batch.rect.group).toBe(batch.group)
    expect(batch.group.dirty).toBe(true)
  })

  it('(1) 일부만 빼도 같다', () => {
    const seq = build()
    seq.group.removeWithUpdate(seq.texts[2])
    seq.group.removeWithUpdate(seq.texts[0])

    const batch = build()
    removeObjectsWithUpdate(batch.group, [batch.texts[2], batch.texts[0]])

    expectSame(batch.group, seq.group)
    expectSame(batch.rect, seq.rect)
    expectSame(batch.texts[1], seq.texts[1])
    expectSame(batch.texts[0], seq.texts[0])
    expectSame(batch.texts[2], seq.texts[2])
    expect(batch.group.getObjects()).toEqual([batch.rect, batch.texts[1]])
  })

  it('(3) 뺄 객체가 없으면 그룹 변환과 자식이 그대로다', () => {
    const { group, texts, rect } = build()
    const before = snapshot(group)
    removeObjectsWithUpdate(group, [])
    expect(snapshot(group)).toEqual(before)
    expect(group.getObjects()).toEqual([rect, ...texts])
  })
})
