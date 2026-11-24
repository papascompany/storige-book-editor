import { describe, it, expect, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { emptyPhotoPrintSlotsMessage, findEmptyPhotoPrintSlots, getPhotoPrintEmptyBlockMessage } from './photoPrintCompleteGuard'

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

describe('getPhotoPrintEmptyBlockMessage', () => {
  it('사진인화 + 빈 칸이면 메시지', () => {
    useSettingsStore.getState().setProductProfile(profileOf('chemical'))
    useAppStore.setState({ allCanvas: [page(true), page(false)] as never })
    expect(getPhotoPrintEmptyBlockMessage()).toContain('사진이 없는 칸이 1개')
  })

  it('관리자(editMode)는 통과', () => {
    useSettingsStore.getState().setProductProfile(profileOf('chemical'))
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    useAppStore.setState({ allCanvas: [page(false)] as never })
    expect(getPhotoPrintEmptyBlockMessage()).toBeNull()
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
  })

  it('비사진인화는 통과', () => {
    useAppStore.setState({ allCanvas: [page(false)] as never })
    expect(getPhotoPrintEmptyBlockMessage()).toBeNull()
  })
})
