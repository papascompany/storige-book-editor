import { describe, it, expect, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore, parseOrderTotalCopies } from '@/stores/usePhotoPrintStore'
import {
  emptyPhotoPrintSlotsMessage,
  findEmptyPhotoPrintSlots,
  getPhotoPrintCompleteBlockMessage,
  photoPrintCopiesTotal,
  totalCopiesMismatchMessage,
} from './photoPrintCompleteGuard'

/**
 * 사진인화 빈 칸 완료 가드: 빈 사진틀이 있는 사진 칸 번호(앞뒷면 stride 반영), 비사진인화·관리자 무간섭.
 */
const profileOf = (process: 'chemical' | 'digital'): ProductProfile => ({
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process,
    composition: 'per-photo-free-back',
    sizes: [{ code: 'mini', widthMm: 54, heightMm: 86, minDpi: 250 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 200, maxMb: 25 },
  },
  output: { mode: 'single-pdf' },
})

let seq = 0
interface FakeCanvas { getObjects: () => unknown[] }
function page(filled: boolean | null): FakeCanvas {
  const id = `fr${++seq}`
  if (filled === null) return { getObjects: () => [{ id: `t${seq}`, extensionType: 'text' }] } // 뒷면 — 틀 없음
  const frame = { id, extensionType: 'frame', width: 100, height: 160 }
  const objs: unknown[] = [frame]
  if (filled) objs.push({ extensionType: 'fillImage', parentLayerId: id })
  return { getObjects: () => objs }
}

beforeEach(() => {
  usePhotoPrintStore.getState().reset()
  useSettingsStore.getState().setProductProfile(null)
  useAppStore.setState({ allCanvas: [], canvas: null })
})

describe('findEmptyPhotoPrintSlots', () => {
  it('chemical(앞면만): 빈 틀이 있는 칸 번호', () => {
    const canvases = [page(true), page(false), page(true), page(false)]
    expect(findEmptyPhotoPrintSlots(canvases as never, profileOf('chemical'))).toEqual([2, 4])
  })

  it('digital(앞+뒤): 캔버스 2장이 한 칸 — 뒷면은 판정하지 않음', () => {
    const canvases = [page(true), page(null), page(false), page(null)]
    expect(findEmptyPhotoPrintSlots(canvases as never, profileOf('digital'))).toEqual([2])
  })

  it('모두 채워지면 빈 배열', () => {
    expect(findEmptyPhotoPrintSlots([page(true), page(true)] as never, profileOf('chemical'))).toEqual([])
  })

  it('비사진인화(프로파일 NULL)는 빈 틀이 있어도 빈 배열', () => {
    expect(findEmptyPhotoPrintSlots([page(false)] as never, null)).toEqual([])
  })
})

describe('emptyPhotoPrintSlotsMessage', () => {
  it('5개까지 번호를 보이고 나머지는 개수로', () => {
    expect(emptyPhotoPrintSlotsMessage([1, 3])).toBe('사진이 없는 칸이 2개 있습니다(1, 3번째). 사진을 넣거나 빈 칸을 삭제한 뒤 완료해 주세요.')
    expect(emptyPhotoPrintSlotsMessage([1, 2, 3, 4, 5, 6, 7])).toContain('(1, 2, 3, 4, 5번째 외 2개)')
  })
})

describe('getPhotoPrintCompleteBlockMessage', () => {
  it('사진인화 + 빈 칸이면 메시지', () => {
    useSettingsStore.getState().setProductProfile(profileOf('chemical'))
    useAppStore.setState({ allCanvas: [page(true), page(false)] as never })
    expect(getPhotoPrintCompleteBlockMessage()).toContain('사진이 없는 칸이 1개')
  })

  it('관리자(editMode)는 통과', () => {
    useSettingsStore.getState().setProductProfile(profileOf('chemical'))
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    useAppStore.setState({ allCanvas: [page(false)] as never })
    expect(getPhotoPrintCompleteBlockMessage()).toBeNull()
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
  })

  it('비사진인화는 통과', () => {
    useAppStore.setState({ allCanvas: [page(false)] as never })
    expect(getPhotoPrintCompleteBlockMessage()).toBeNull()
  })
})

describe('주문 총 매수(orderOptions.totalCopies, v1.35)', () => {
  const setup = (copies: number[], ordered: unknown) => {
    useSettingsStore.getState().setProductProfile(profileOf('chemical'))
    usePhotoPrintStore.getState().setFromProfile(profileOf('chemical'))
    usePhotoPrintStore.getState().restore(copies.map((c) => ({ copies: c })))
    usePhotoPrintStore.getState().setOrderTotalCopies(ordered)
    useAppStore.setState({ allCanvas: copies.map(() => page(true)) as never })
  }

  it('합계 = 주문 매수면 통과', () => {
    setup([3, 3, 4], 10)
    expect(getPhotoPrintCompleteBlockMessage()).toBeNull()
  })

  it('합계가 많으면 줄이라는 메시지', () => {
    setup([3, 3, 4, 2], 10)
    expect(getPhotoPrintCompleteBlockMessage()).toBe(totalCopiesMismatchMessage(12, 10))
    expect(totalCopiesMismatchMessage(12, 10)).toContain('2매를 줄여')
  })

  it('합계가 적으면 더하라는 메시지', () => {
    setup([1, 1, 1], 10)
    expect(getPhotoPrintCompleteBlockMessage()).toContain('7매를 더해')
  })

  it('주문 매수가 없으면(null·잘못된 값) 매수 검사 없음', () => {
    setup([1, 1], undefined)
    expect(getPhotoPrintCompleteBlockMessage()).toBeNull()
    setup([1, 1], 0)
    expect(getPhotoPrintCompleteBlockMessage()).toBeNull()
  })

  it('빈 칸이 매수보다 먼저 판정된다', () => {
    setup([5, 5], 3)
    useAppStore.setState({ allCanvas: [page(true), page(false)] as never })
    expect(getPhotoPrintCompleteBlockMessage()).toContain('사진이 없는 칸')
  })

  it('photoPrintCopiesTotal', () => {
    expect(photoPrintCopiesTotal([{ copies: 2 }, { copies: 5 }])).toBe(7)
    expect(photoPrintCopiesTotal([])).toBe(0)
  })
})

describe('parseOrderTotalCopies', () => {
  it('1 이상 정수·정수형 문자열만 받는다', () => {
    expect(parseOrderTotalCopies(10)).toBe(10)
    expect(parseOrderTotalCopies(' 12 ')).toBe(12)
    for (const bad of [0, -1, 1.5, '1.5', 'abc', '', null, undefined, {}, NaN]) expect(parseOrderTotalCopies(bad)).toBeNull()
  })
})
