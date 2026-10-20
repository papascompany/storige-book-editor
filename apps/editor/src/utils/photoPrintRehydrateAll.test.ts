import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

const applyPhotoPrintCanvas = vi.fn(async () => 0)
const applyPhotoPrintForCanvas = vi.fn(async () => 0)
vi.mock('@/utils/photoPrintRehydrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPrintRehydrate')>()
  return {
    ...actual,
    applyPhotoPrintCanvas: (...a: unknown[]) => applyPhotoPrintCanvas(...(a as [])),
    applyPhotoPrintForCanvas: (...a: unknown[]) => applyPhotoPrintForCanvas(...(a as [])),
  }
})

import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'
import { calendarSessionMetadataFields } from './calendarRehydrateAll'
import {
  applyAllPhotoPrint,
  bindPhotoPrintCanvasEvents,
  photoPrintResultFields,
  photoPrintSessionMetadataFields,
  restorePhotoPrintSessionItems,
  syncPhotoPrintItemsWithCanvases,
} from './photoPrintRehydrateAll'

/**
 * P2-d 사진인화 (2026-10-19): 세션 메타 동봉/복원 배선 — 사진인화 세트가 아니면 전부 {}·false·0(payload 키 집합 불변).
 */
const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_free',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true },
    copies: { min: 1, max: 5 },
    upload: { maxPhotos: 10, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

const calendarProfile: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk',
  pages: { kind: 'fixed', count: 26, labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
    allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0,
    show: { holidays: true, lunar: false, solarTerms: false }, dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
}

function wire(profile: ProductProfile | null, canvasCount: number) {
  useSettingsStore.getState().setProductProfile(profile)
  useCalendarStore.getState().setFromProfile(profile)
  usePhotoPrintStore.getState().setFromProfile(profile)
  const allCanvas = Array.from({ length: canvasCount }, (_, i) => ({ id: `c${i}` }))
  const allEditors = allCanvas.map(() => ({ getPlugin: () => undefined }))
  useAppStore.setState({ allCanvas, allEditors } as never)
}

beforeEach(() => {
  applyPhotoPrintCanvas.mockReset()
  applyPhotoPrintCanvas.mockResolvedValue(0)
  applyPhotoPrintForCanvas.mockReset()
  applyPhotoPrintForCanvas.mockResolvedValue(0)
  useSaveStore.setState({ isDirty: false } as never)
  wire(null, 0)
})

describe('photoPrintSessionMetadataFields / photoPrintResultFields', () => {
  it('NULL 프로파일: {} (키 없음)', () => {
    wire(null, 3)
    expect(photoPrintSessionMetadataFields()).toEqual({})
    expect(photoPrintResultFields(3)).toEqual({})
    expect(syncPhotoPrintItemsWithCanvases()).toEqual([])
  })

  it('캘린더 프로파일: 사진인화 필드는 {}, 캘린더 필드만 동봉(두 헬퍼가 서로 간섭하지 않음)', () => {
    wire(calendarProfile, 26)
    expect(photoPrintSessionMetadataFields()).toEqual({})
    expect(photoPrintResultFields(26)).toEqual({})
    expect(calendarSessionMetadataFields().metadata).toMatchObject({ productProfile: calendarProfile })
    expect(calendarSessionMetadataFields().metadata).not.toHaveProperty('items')
  })

  it('사진인화 6캔버스: metadata { productProfile, items×3 }(캔버스 수 동기화), result { items×3 }, 캘린더 필드는 {}', () => {
    wire(photoProfile, 6)
    const fields = photoPrintSessionMetadataFields()
    expect(fields.metadata?.productProfile).toBe(photoProfile)
    expect(fields.metadata?.items).toHaveLength(3)
    expect(fields.metadata?.items.map((i) => i.canvasIndex)).toEqual([0, 2, 4])
    expect(Object.keys(fields.metadata ?? {})).toEqual(['productProfile', 'items'])
    expect(calendarSessionMetadataFields()).toEqual({})
    // 완료 시점 canvasCount 로 재동기화
    expect(photoPrintResultFields(4).items).toHaveLength(2)
    expect(photoPrintResultFields(6).items).toHaveLength(3)
  })
})

describe('restorePhotoPrintSessionItems', () => {
  it('사진인화 세트: metadata.items(PhotoItemInput 부분형)를 정제해 시드 → true', () => {
    wire(photoProfile, 4)
    expect(restorePhotoPrintSessionItems({ items: [{ copies: 3 }, { fit: 'image-full', grayscale: true, copies: 99 }] })).toBe(true)
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ index: 0, canvasIndex: 0, copies: 3 })
    expect(items[1]).toMatchObject({ index: 1, canvasIndex: 2, fit: 'image-full', grayscale: true, copies: 5 })
  })

  it('NULL/캘린더 세트·items 없음·객체 아님 → false, 스토어 불변', () => {
    wire(null, 2)
    expect(restorePhotoPrintSessionItems({ items: [{ copies: 2 }] })).toBe(false)
    wire(calendarProfile, 2)
    expect(restorePhotoPrintSessionItems({ items: [{ copies: 2 }] })).toBe(false)
    wire(photoProfile, 2)
    expect(restorePhotoPrintSessionItems({ calendar: {} })).toBe(false)
    expect(restorePhotoPrintSessionItems(null)).toBe(false)
    expect(restorePhotoPrintSessionItems('x')).toBe(false)
    expect(usePhotoPrintStore.getState().items).toEqual([])
  })
})

describe('applyAllPhotoPrint', () => {
  it('NULL 프로파일: 호출 없이 0, dirty 불변', async () => {
    wire(null, 3)
    expect(await applyAllPhotoPrint()).toBe(0)
    expect(applyPhotoPrintCanvas).not.toHaveBeenCalled()
    expect(useSaveStore.getState().isDirty).toBe(false)
  })

  it('사진인화 세트: 모든 캔버스에 순서대로 apply, 1개 이상 처리하면 dirty 마킹', async () => {
    wire(photoProfile, 4)
    applyPhotoPrintCanvas.mockResolvedValue(1)
    expect(await applyAllPhotoPrint()).toBe(4)
    expect(applyPhotoPrintCanvas).toHaveBeenCalledTimes(4)
    expect(applyPhotoPrintCanvas.mock.calls.map((c) => (c as unknown[])[2])).toEqual([0, 1, 2, 3])
    expect(useSaveStore.getState().isDirty).toBe(true)
  })

  it('처리 0건이면 dirty 마킹하지 않는다', async () => {
    wire(photoProfile, 2)
    expect(await applyAllPhotoPrint()).toBe(0)
    expect(useSaveStore.getState().isDirty).toBe(false)
  })

  it('markDirty:false(신규 세션 기본값 적용): 처리해도 dirty 마킹하지 않는다', async () => {
    wire(photoProfile, 2)
    applyPhotoPrintCanvas.mockResolvedValue(1)
    expect(await applyAllPhotoPrint({ markDirty: false })).toBe(2)
    expect(useSaveStore.getState().isDirty).toBe(false)
    expect(await applyAllPhotoPrint({ markDirty: true })).toBe(2)
    expect(useSaveStore.getState().isDirty).toBe(true)
  })
})

describe('bindPhotoPrintCanvasEvents (D5 / serialization-6 — undo/redo·사진 삭제 뒤 apply)', () => {
  type Handler = (e?: { target?: { extensionType?: string } }) => void
  function eventCanvas(id: string) {
    const handlers: Record<string, Handler[]> = {}
    return {
      id,
      historyProcessing: false,
      on: vi.fn((ev: string, h: Handler) => { (handlers[ev] ??= []).push(h) }),
      off: vi.fn((ev: string, h: Handler) => { handlers[ev] = (handlers[ev] ?? []).filter((x) => x !== h) }),
      fire: (ev: string, e?: { target?: { extensionType?: string } }) => { for (const h of handlers[ev] ?? []) h(e) },
      count: (ev: string) => (handlers[ev] ?? []).length,
    }
  }
  const tick = () => new Promise((r) => setTimeout(r, 1))

  it('history:undo / history:redo → 다음 틱에 applyPhotoPrintForCanvas(canvas) 1회(같은 틱의 중복은 coalesce)', async () => {
    const a = eventCanvas('a')
    const b = eventCanvas('b')
    const off = bindPhotoPrintCanvasEvents([a, b] as never)
    expect(a.count('history:undo')).toBe(1)
    expect(a.count('history:redo')).toBe(1)
    expect(a.count('object:removed')).toBe(1)
    a.fire('history:undo')
    a.fire('history:undo')
    b.fire('history:redo')
    expect(applyPhotoPrintForCanvas).not.toHaveBeenCalled()
    await tick()
    expect(applyPhotoPrintForCanvas).toHaveBeenCalledTimes(2)
    expect(applyPhotoPrintForCanvas).toHaveBeenCalledWith(a)
    expect(applyPhotoPrintForCanvas).toHaveBeenCalledWith(b)
    off()
  })

  it('object:removed 는 채운 사진(extensionType fillImage)만, history 로드 중(historyProcessing)·다른 객체는 무시', async () => {
    const a = eventCanvas('a')
    const off = bindPhotoPrintCanvasEvents([a] as never)
    a.fire('object:removed', { target: { extensionType: 'frame' } })
    a.fire('object:removed', {})
    a.historyProcessing = true
    a.fire('object:removed', { target: { extensionType: 'fillImage' } })
    await tick()
    expect(applyPhotoPrintForCanvas).not.toHaveBeenCalled()
    a.historyProcessing = false
    a.fire('object:removed', { target: { extensionType: 'fillImage' } })
    await tick()
    expect(applyPhotoPrintForCanvas).toHaveBeenCalledTimes(1)
    expect(applyPhotoPrintForCanvas).toHaveBeenCalledWith(a)
    off()
  })

  it('해제 함수: 리스너 전부 제거 + 대기 중 타이머 취소(해제 뒤 apply 없음); on 이 없는 캔버스는 건너뛴다', async () => {
    const a = eventCanvas('a')
    const off = bindPhotoPrintCanvasEvents([a, { id: 'broken' }] as never)
    a.fire('history:undo')
    off()
    expect(a.count('history:undo')).toBe(0)
    expect(a.count('history:redo')).toBe(0)
    expect(a.count('object:removed')).toBe(0)
    await tick()
    expect(applyPhotoPrintForCanvas).not.toHaveBeenCalled()
    a.fire('history:undo')
    await tick()
    expect(applyPhotoPrintForCanvas).not.toHaveBeenCalled()
  })
})
