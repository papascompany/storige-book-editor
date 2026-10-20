// @vitest-environment happy-dom
//
// P2-d 사진인화 (2026-10-19, editor-flow-5 / tests-5 / security-3): '사진 자동편집'(autofill) 경로.
//  (1) autofillPhotosIntoFrames 가 1틀 이상 채우면 그 뒤 applyAllPhotoPrint() 를 호출한다(흑백·촬영일·유테 창 재적용) —
//      채운 틀이 0 이면 호출하지 않는다. 프로파일 NULL 세트는 applyAllPhotoPrint 자체가 즉시 0(여기서는 호출 여부만 고정).
//  (2) checkPhotoPrintPhotoCount(입력 사진 수) 가 false 면 자동배치를 시작하지 않는다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

const spies = vi.hoisted(() => ({
  autofill: vi.fn(),
  applyAll: vi.fn(async () => 1),
  checkCount: vi.fn(() => true),
  order: [] as string[],
}))

vi.mock('@/utils/photoPlacement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPlacement')>()
  return {
    ...actual,
    hasEmptyFrame: () => true,
    autofillPhotosIntoFrames: (...a: unknown[]) => {
      spies.order.push('autofill')
      return spies.autofill(...(a as []))
    },
  }
})
vi.mock('@/utils/photoAutofill', () => ({ enrichPhotosWithExif: async (photos: unknown[]) => photos, parsePhotoExif: async () => ({}) }))
vi.mock('@/utils/photoPrintRehydrateAll', () => ({
  applyAllPhotoPrint: (...a: unknown[]) => {
    spies.order.push('applyAll')
    return spies.applyAll(...(a as []))
  },
}))
vi.mock('@/utils/photoPrintUpload', () => ({
  checkPhotoPrintPhotoCount: (...a: unknown[]) => spies.checkCount(...(a as [])),
  checkPhotoPrintUploadLimit: () => true,
}))
vi.mock('@/stores/useToastStore', () => ({ showToast: vi.fn() }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => false }))

import AppImage from './AppImage'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useExternalPhotosStore } from '@/stores/useExternalPhotosStore'

function wire() {
  const canvas = { id: 'c0', on: vi.fn(), off: vi.fn(), getObjects: () => [], requestRenderAll: vi.fn(), setActiveObject: vi.fn() }
  act(() => {
    useAppStore.setState({
      canvas,
      allCanvas: [canvas],
      getPlugin: (name: string) => (name === 'ImageProcessingPlugin' ? {} : undefined),
      tapMenu: vi.fn(),
    } as never)
    useImageStore.setState({ uploaded: [], uploadedPhotoMeta: [], upload: vi.fn() } as never)
    useExternalPhotosStore.getState().setPhotos([
      { url: 'https://cdn/a.jpg', id: 'a', name: 'a.jpg' },
      { url: 'https://cdn/b.jpg', id: 'b', name: 'b.jpg' },
    ] as never)
  })
  render(<AppImage />)
  return canvas
}

async function clickAutofill() {
  await act(async () => {
    fireEvent.click(screen.getByText('사진 자동편집'))
    await new Promise((r) => setTimeout(r, 0))
  })
}

beforeEach(() => {
  spies.order.length = 0
  spies.autofill.mockReset()
  spies.applyAll.mockClear()
  spies.checkCount.mockReset().mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ canvas: null, allCanvas: [] } as never)
    useExternalPhotosStore.getState().reset()
  })
})

describe('AppImage — 자동편집 뒤 PhotoPrintPlugin.apply (editor-flow-5 / tests-5)', () => {
  it('2틀 채움 → autofill 완료 뒤 applyAllPhotoPrint() 1회(순서: autofill → applyAll), 수량 한도는 입력 사진 수(2)로 판정', async () => {
    spies.autofill.mockResolvedValue({ filledCount: 2, remainingFrames: 0, remainingPhotos: 0, lowResWarnings: [] })
    wire()
    await clickAutofill()
    expect(spies.checkCount).toHaveBeenCalledWith(2)
    expect(spies.autofill).toHaveBeenCalledTimes(1)
    expect(spies.applyAll).toHaveBeenCalledTimes(1)
    expect(spies.order).toEqual(['autofill', 'applyAll'])
  })

  it('채운 틀 0 → applyAllPhotoPrint 미호출', async () => {
    spies.autofill.mockResolvedValue({ filledCount: 0, remainingFrames: 0, remainingPhotos: 2, lowResWarnings: [] })
    wire()
    await clickAutofill()
    expect(spies.autofill).toHaveBeenCalledTimes(1)
    expect(spies.applyAll).not.toHaveBeenCalled()
  })

  it('security-3: checkPhotoPrintPhotoCount 가 false 면 자동배치·apply 모두 시작하지 않는다', async () => {
    spies.checkCount.mockReturnValue(false)
    wire()
    await clickAutofill()
    expect(spies.autofill).not.toHaveBeenCalled()
    expect(spies.applyAll).not.toHaveBeenCalled()
  })
})
