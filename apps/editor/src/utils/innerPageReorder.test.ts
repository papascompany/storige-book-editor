import { describe, it, expect } from 'vitest'
import {
  computeInnerReorder,
  permuteContentPdfPageOrder,
  syncCanvasContainerOrder,
} from './innerPageReorder'

function bookPages(innerCount: number) {
  return [
    { index: 0, isCover: true },
    ...Array.from({ length: innerCount }, (_, i) => ({
      index: i + 1,
      isCover: false,
    })),
  ]
}

describe('computeInnerReorder', () => {
  it('내지 두 장을 맞바꾼다 — 표지(0)는 고정', () => {
    const items = bookPages(3)
    // 내지 1(idx=1) 을 내지 3(idx=3) 뒤로
    expect(computeInnerReorder(items, 1, 3, false)).toEqual([0, 2, 3, 1])
  })

  it('target 앞에 삽입한다', () => {
    const items = bookPages(3)
    // 내지 3(idx=3) 을 내지 1(idx=1) 앞
    expect(computeInnerReorder(items, 3, 1, true)).toEqual([0, 3, 1, 2])
  })

  it('같은 자리로 떨어지면 no-op (null)', () => {
    const items = bookPages(3)
    expect(computeInnerReorder(items, 2, 2, true)).toBeNull()
    expect(computeInnerReorder(items, 1, 2, true)).toBeNull()
  })

  it('표지를 source/target 으로 받으면 null', () => {
    const items = bookPages(2)
    expect(computeInnerReorder(items, 0, 1, true)).toBeNull()
    expect(computeInnerReorder(items, 1, 0, false)).toBeNull()
  })

  it('내지 전용 펼침면(표지 없음)은 전 페이지가 이동한다', () => {
    const items = [
      { index: 0, isCover: false },
      { index: 1, isCover: false },
      { index: 2, isCover: false },
    ]
    expect(computeInnerReorder(items, 0, 2, false)).toEqual([1, 2, 0])
  })
})

describe('permuteContentPdfPageOrder', () => {
  it('identity 에서 내지 순열을 원본 PDF 인덱스로 옮긴다', () => {
    // [cover, p1, p2, p3] → [cover, p3, p1, p2]
    expect(permuteContentPdfPageOrder(undefined, [0, 3, 1, 2], 1)).toEqual([2, 0, 1])
  })

  it('누적 재정렬 — 현재 매핑 위에서 한 번 더 섞는다', () => {
    const afterFirst = permuteContentPdfPageOrder(undefined, [0, 3, 1, 2], 1)
    expect(afterFirst).toEqual([2, 0, 1])
    // 현재 화면의 첫 두 내지(옛 p3, 옛 p1)를 맞바꾼다
    expect(permuteContentPdfPageOrder(afterFirst, [0, 2, 1, 3], 1)).toEqual([0, 2, 1])
  })

  it('내지 전용 펼침면은 innerStart=0', () => {
    expect(permuteContentPdfPageOrder(undefined, [2, 0, 1], 0)).toEqual([2, 0, 1])
  })
})

describe('syncCanvasContainerOrder', () => {
  it('wrapperEl 을 새 배열 순서로 parent 에 다시 붙인다', () => {
    const appended: string[] = []
    const parent = {
      appendChild: (el: HTMLElement) => {
        appended.push(el.id)
        return el
      },
    }
    const make = (id: string) => ({ wrapperEl: { id } as HTMLElement })
    syncCanvasContainerOrder(parent, [make('c2'), make('c0'), make('c1')])
    expect(appended).toEqual(['c2', 'c0', 'c1'])
  })

  it('parent 없거나 wrapper 없으면 조용히 건너뛴다', () => {
    expect(() => syncCanvasContainerOrder(null, [{ wrapperEl: null }])).not.toThrow()
  })
})
