// @vitest-environment happy-dom
//
// P2-d 사진인화 (2026-10-19): PhotoPrintPanel — 항목 목록(매수 ±·테두리·맞춤·마감·촬영일·흑백·밝기보정)·전체 적용.
//  (1) 프로파일 options 가 허용하지 않는 값은 노출하지 않는다(어휘 1개 → select 생략, 플래그 false → 체크박스 생략)
//  (2) 옵션 변경 → 스토어 반영 + applyPhotoPrintItem(index) + dirty 마킹
//  (3) 전체 적용 → 현재 항목의 공유 옵션을 모든 항목에 + applyAllPhotoPrint
//  (4) 사진인화 세트가 아니면 안내 문구만
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import type { ProductProfile } from '@storige/types'

const applyPhotoPrintItem = vi.fn(async () => 1)
const applyAllPhotoPrint = vi.fn(async () => 2)
vi.mock('@/utils/photoPrintRehydrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPrintRehydrate')>()
  return { ...actual, applyPhotoPrintItem: (...a: unknown[]) => applyPhotoPrintItem(...(a as [])) }
})
vi.mock('@/utils/photoPrintRehydrateAll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPrintRehydrateAll')>()
  return { ...actual, applyAllPhotoPrint: () => applyAllPhotoPrint() }
})

import PhotoPrintPanel, { APPLY_ALL_LABEL, LOW_RES_BADGE_LABEL, pickSharedOptions } from './PhotoPrintPanel'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'

function profile(options: NonNullable<ProductProfile['photoPrint']>['options']): ProductProfile {
  return {
    version: 1,
    kind: 'photo-print',
    editorType: 'photo_digital_free',
    pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    photoPrint: {
      process: 'digital',
      composition: 'per-photo-free-back',
      sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
      options,
      copies: { min: 1, max: 3 },
      upload: { maxPhotos: 10, maxMb: 25 },
    },
    output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
  }
}

const FULL_OPTIONS: NonNullable<ProductProfile['photoPrint']>['options'] = {
  border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true,
}
const MINIMAL_OPTIONS: NonNullable<ProductProfile['photoPrint']>['options'] = {
  border: ['none'], fit: ['paper-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false,
}

function wire(p: ProductProfile | null, canvasCount: number, currentCanvas = 0) {
  const allCanvas = Array.from({ length: canvasCount }, (_, i) => ({ id: `c${i}` }))
  const setPage = vi.fn()
  act(() => {
    useAppStore.setState({ allCanvas, canvas: allCanvas[currentCanvas] ?? null, setPage } as never)
    useSettingsStore.getState().setProductProfile(p)
    usePhotoPrintStore.getState().setFromProfile(p)
    useSaveStore.setState({ isDirty: false } as never)
  })
  render(<PhotoPrintPanel />)
  return { setPage }
}

beforeEach(() => {
  applyPhotoPrintItem.mockClear()
  applyAllPhotoPrint.mockClear()
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ allCanvas: [], canvas: null } as never)
    useSettingsStore.getState().setProductProfile(null)
    usePhotoPrintStore.getState().reset()
  })
})

describe('PhotoPrintPanel', () => {
  it('사진인화 세트가 아니면 안내 문구만', () => {
    wire(null, 2)
    expect(screen.getByText('사진인화 상품이 아닙니다.')).toBeTruthy()
    expect(screen.queryByLabelText('사진 항목 목록')).toBeNull()
  })

  it('4캔버스(digital) → 항목 2건 동기화, 현재 캔버스 2 → "현재 사진 2"', () => {
    wire(profile(FULL_OPTIONS), 4, 2)
    expect(usePhotoPrintStore.getState().items).toHaveLength(2)
    expect(screen.getByTestId('photo-item-0')).toBeTruthy()
    expect(screen.getByTestId('photo-item-1')).toBeTruthy()
    expect(screen.getByText('총 2장 · 현재 사진 2')).toBeTruthy()
  })

  it('전체 허용 옵션: 테두리/맞춤/마감 select + 촬영일/흑백/밝기보정 체크박스 노출; 최소 옵션: 전부 생략', () => {
    wire(profile(FULL_OPTIONS), 2)
    expect(screen.getByLabelText('사진 1 테두리')).toBeTruthy()
    expect(screen.getByLabelText('사진 1 맞춤')).toBeTruthy()
    expect(screen.getByLabelText('사진 1 마감')).toBeTruthy()
    expect(screen.getByLabelText('사진 1 촬영일')).toBeTruthy()
    expect(screen.getByLabelText('사진 1 흑백')).toBeTruthy()
    expect(screen.getByLabelText('사진 1 밝기 보정')).toBeTruthy()
    cleanup()
    wire(profile(MINIMAL_OPTIONS), 2)
    expect(screen.queryByLabelText('사진 1 테두리')).toBeNull()
    expect(screen.queryByLabelText('사진 1 맞춤')).toBeNull()
    expect(screen.queryByLabelText('사진 1 마감')).toBeNull()
    expect(screen.queryByLabelText('사진 1 촬영일')).toBeNull()
    expect(screen.queryByLabelText('사진 1 흑백')).toBeNull()
    expect(screen.queryByLabelText('사진 1 밝기 보정')).toBeNull()
    // 매수는 항상 노출
    expect(screen.getByLabelText('사진 1 매수 증가')).toBeTruthy()
  })

  it('흑백 토글·맞춤 변경 → 스토어 반영 + applyPhotoPrintItem(index) + dirty', async () => {
    wire(profile(FULL_OPTIONS), 4)
    await act(async () => {
      fireEvent.click(screen.getByLabelText('사진 2 흑백'))
    })
    expect(usePhotoPrintStore.getState().items[1].grayscale).toBe(true)
    expect(usePhotoPrintStore.getState().items[0].grayscale).toBe(false)
    expect(applyPhotoPrintItem).toHaveBeenCalledWith(1)
    expect(useSaveStore.getState().isDirty).toBe(true)
    await act(async () => {
      fireEvent.change(screen.getByLabelText('사진 1 맞춤'), { target: { value: 'image-full' } })
    })
    expect(usePhotoPrintStore.getState().items[0].fit).toBe('image-full')
    expect(applyPhotoPrintItem).toHaveBeenLastCalledWith(0)
  })

  it('매수 ±: min 에서 − 비활성, max(3) 에서 + 비활성, 변경은 applyPhotoPrintItem 호출(통과만이라도 저장 dirty)', async () => {
    wire(profile(FULL_OPTIONS), 2)
    const minus = screen.getByLabelText('사진 1 매수 감소') as HTMLButtonElement
    const plus = screen.getByLabelText('사진 1 매수 증가') as HTMLButtonElement
    expect(minus.disabled).toBe(true)
    await act(async () => { fireEvent.click(plus) })
    await act(async () => { fireEvent.click(plus) })
    expect(screen.getByTestId('photo-copies-0').textContent).toBe('3매')
    expect((screen.getByLabelText('사진 1 매수 증가') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('사진 1 매수 감소') as HTMLButtonElement).disabled).toBe(false)
    expect(applyPhotoPrintItem).toHaveBeenCalledTimes(2)
    expect(useSaveStore.getState().isDirty).toBe(true)
  })

  it('전체 적용: 현재 항목(캔버스 2 → 사진 2)의 공유 옵션을 전부에 복사(copies 제외) + applyAllPhotoPrint', async () => {
    wire(profile(FULL_OPTIONS), 6, 2)
    act(() => {
      usePhotoPrintStore.getState().setItemOption(1, { border: 'white', grayscale: true, copies: 3 })
    })
    await act(async () => {
      fireEvent.click(screen.getByText(APPLY_ALL_LABEL))
    })
    const items = usePhotoPrintStore.getState().items
    expect(items).toHaveLength(3)
    for (const it of items) expect(it).toMatchObject({ border: 'white', grayscale: true })
    expect(items.map((i) => i.copies)).toEqual([1, 3, 1])
    expect(applyAllPhotoPrint).toHaveBeenCalledTimes(1)
  })

  it('항목 1건이면 전체 적용 비활성; "사진 N 보기" 는 앞면 캔버스로 이동', () => {
    const { setPage } = wire(profile(FULL_OPTIONS), 2)
    expect((screen.getByText(APPLY_ALL_LABEL) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    const w = wire(profile(FULL_OPTIONS), 4)
    fireEvent.click(screen.getByLabelText('사진 2 보기'))
    expect(w.setPage).toHaveBeenCalledWith(2)
    expect(setPage).not.toHaveBeenCalled()
  })

  it("contract-1: items[].lowRes 가 true 인 항목에만 '저해상도' 배지(minDpi 안내), 다른 항목·기본값은 배지 없음", () => {
    wire(profile(FULL_OPTIONS), 4)
    expect(screen.queryByTestId('photo-lowres-0')).toBeNull()
    expect(screen.queryByTestId('photo-lowres-1')).toBeNull()
    act(() => {
      usePhotoPrintStore.getState().setItemMeta(1, { lowRes: true })
    })
    const badge = screen.getByTestId('photo-lowres-1')
    expect(badge.textContent).toBe(LOW_RES_BADGE_LABEL)
    expect(badge.getAttribute('title')).toContain('200dpi')
    expect(screen.queryByTestId('photo-lowres-0')).toBeNull()
    act(() => {
      usePhotoPrintStore.getState().setItemMeta(1, { lowRes: false })
    })
    expect(screen.queryByTestId('photo-lowres-1')).toBeNull()
  })

  it('pickSharedOptions 는 copies/index/canvasIndex 를 제외한다', () => {
    expect(
      pickSharedOptions({
        index: 3, canvasIndex: 6, sizeCode: '4x6', copies: 5, border: 'white', fit: 'image-full', finish: 'glossy',
        brightnessFix: true, dateOverlay: true, grayscale: false, lowRes: false,
      }),
    ).toEqual({ border: 'white', fit: 'image-full', finish: 'glossy', brightnessFix: true, dateOverlay: true, grayscale: false })
  })
})
