// @vitest-environment happy-dom
//
// '사진 자동편집'은 이미 문서에 배치된 사진을 후보에서 뺀다.
//  - 배치된 사진은 배치 엔진에 넘기지 않고, 결과 안내에 제외한 장수를 적는다.
//  - 모든 사진이 이미 배치돼 있으면 배치를 시작하지 않고 안내만 한다.
//  - 내 업로드를 직접 배치하면 캔버스에는 data URL 로 올라가므로 그 주소로도 찾는다.
//  - 사진인화 수량 한도는 종전대로 전체 입력 사진 수로 판정한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

const spies = vi.hoisted(() => ({
  autofill: vi.fn(),
  checkCount: vi.fn(() => true),
  toast: vi.fn(),
}))

vi.mock('@/utils/photoPlacement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/photoPlacement')>()
  return {
    ...actual,
    hasEmptyFrame: () => true,
    autofillPhotosIntoFrames: (...a: unknown[]) => spies.autofill(...(a as [])),
  }
})
vi.mock('@/utils/photoAutofill', () => ({ enrichPhotosWithExif: async (photos: unknown[]) => photos, parsePhotoExif: async () => ({}) }))
vi.mock('@/utils/photoPrintRehydrateAll', () => ({ applyAllPhotoPrint: async () => 0 }))
vi.mock('@/utils/photoPrintUpload', () => ({
  checkPhotoPrintPhotoCount: (...a: unknown[]) => spies.checkCount(...(a as [])),
  checkPhotoPrintUploadLimit: () => true,
}))
vi.mock('@/stores/useToastStore', () => ({ showToast: (...a: unknown[]) => spies.toast(...(a as [])) }))
vi.mock('@/hooks/useIsCoarsePointer', () => ({ useIsCoarsePointer: () => false }))

import AppImage from './AppImage'
import { useAppStore } from '@/stores/useAppStore'
import { useImageStore } from '@/stores/useImageStore'
import { useExternalPhotosStore } from '@/stores/useExternalPhotosStore'

const A = 'https://cdn/a.jpg'
const B = 'https://cdn/b.jpg'
const placedImage = (src: string) => ({ type: 'image', getSrc: () => src })

function wire(opts: {
  placed: unknown[]
  external?: string[]
  uploaded?: Array<{ src: string; storageUrl: string }>
}) {
  const canvas = {
    id: 'c0',
    on: vi.fn(),
    off: vi.fn(),
    getObjects: () => opts.placed,
    requestRenderAll: vi.fn(),
    setActiveObject: vi.fn(),
  }
  act(() => {
    useAppStore.setState({
      canvas,
      allCanvas: [canvas],
      getPlugin: (name: string) => (name === 'ImageProcessingPlugin' ? {} : undefined),
      tapMenu: vi.fn(),
    } as never)
    useImageStore.setState({
      uploaded: (opts.uploaded ?? []).map((u) => ({ getSrc: () => u.src, storagePhotoUrl: u.storageUrl })),
      uploadedPhotoMeta: (opts.uploaded ?? []).map((u) => ({ url: u.storageUrl })),
      upload: vi.fn(),
    } as never)
    useExternalPhotosStore.getState().setPhotos((opts.external ?? []).map((url) => ({ url, id: url, name: url })) as never)
  })
  render(<AppImage />)
}

async function clickAutofill() {
  await act(async () => {
    fireEvent.click(screen.getByText('사진 자동편집'))
    await new Promise((r) => setTimeout(r, 0))
  })
}

const passedUrls = () => (spies.autofill.mock.calls[0][1] as Array<{ url: string }>).map((p) => p.url)
const toastTexts = () => spies.toast.mock.calls.map((c) => String(c[0]))

beforeEach(() => {
  spies.autofill.mockReset().mockResolvedValue({
    filledCount: 1,
    remainingFrames: 0,
    remainingPhotos: 0,
    failedPhotos: 0,
    lowResWarnings: [],
  })
  spies.checkCount.mockReset().mockReturnValue(true)
  spies.toast.mockReset()
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ canvas: null, allCanvas: [] } as never)
    useImageStore.setState({ uploaded: [], uploadedPhotoMeta: [] } as never)
    useExternalPhotosStore.getState().reset()
  })
})

describe('AppImage — 자동편집은 이미 배치된 사진을 뺀다', () => {
  it('배치된 사진은 엔진에 넘기지 않고 제외한 장수를 안내한다(수량 한도는 전체 사진 수)', async () => {
    wire({ placed: [placedImage(A)], external: [A, B] })
    await clickAutofill()

    expect(spies.checkCount).toHaveBeenCalledWith(2)
    expect(spies.autofill).toHaveBeenCalledTimes(1)
    expect(passedUrls()).toEqual([B])
    expect(toastTexts().some((t) => t.includes('이미 넣은 사진 1장 제외'))).toBe(true)
  })

  it('모든 사진이 이미 배치돼 있으면 배치를 시작하지 않고 안내만 한다', async () => {
    wire({ placed: [placedImage(A), placedImage(B)], external: [A, B] })
    await clickAutofill()

    expect(spies.autofill).not.toHaveBeenCalled()
    expect(toastTexts()).toContain('모든 사진이 이미 배치되어 있습니다.')
  })

  it('직접 배치해 data URL 로 올라간 내 업로드 사진도 뺀다', async () => {
    const dataUrl = 'data:image/png;base64,AAAA'
    wire({
      placed: [placedImage(dataUrl)],
      uploaded: [
        { src: dataUrl, storageUrl: 'https://store/u1.png' },
        { src: 'data:image/png;base64,BBBB', storageUrl: 'https://store/u2.png' },
      ],
    })
    await clickAutofill()

    expect(passedUrls()).toEqual(['https://store/u2.png'])
  })

  it('배치된 사진이 없으면 전체를 넘기고 제외 안내는 없다', async () => {
    wire({ placed: [], external: [A, B] })
    await clickAutofill()

    expect(passedUrls()).toEqual([A, B])
    expect(toastTexts().some((t) => t.includes('제외'))).toBe(false)
  })
})
