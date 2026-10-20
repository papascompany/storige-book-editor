import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { mmToPxDisplay, type PhotoPrintCanvasOptions } from '@storige/canvas-core'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'
import {
  applyPhotoPrintForCanvas,
  applyPhotoPrintItem,
  rehydratePhotoPrint,
  resolvePhotoItemIndexForCanvas,
  resolvePhotoPrintBleedPx,
  resolvePhotoPrintCanvasOptions,
} from './photoPrintRehydrate'

/**
 * P2-d 사진인화 (2026-10-19): 항목 → PhotoPrintPlugin 옵션 매핑(§13-3)과 캔버스↔항목 매핑(digital 2i/2i+1).
 */
const digitalProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital_free',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['matte', 'glossy'], brightnessFix: true, dateOverlay: true, grayscale: true, borderInsetMm: 3 },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 10, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

type OptsFn = (opts: PhotoPrintCanvasOptions) => Promise<number>

function wire(n: number) {
  const plugins = Array.from({ length: n }, () => ({
    apply: vi.fn<OptsFn>(async () => 1),
    rehydrate: vi.fn<OptsFn>(async () => 2),
  }))
  const allCanvas = Array.from({ length: n }, (_, i) => ({ id: `c${i}` }))
  const allEditors = plugins.map((p) => ({ getPlugin: (name: string) => (name === 'PhotoPrintPlugin' ? p : undefined) }))
  useAppStore.setState({ allCanvas, allEditors } as never)
  return { plugins, allCanvas, allEditors }
}

beforeEach(() => {
  useAppStore.setState({ allCanvas: [], allEditors: [] } as never)
  useSettingsStore.getState().setProductProfile(null)
  useSettingsStore.getState().setPrintMarkConfig(null)
  usePhotoPrintStore.getState().reset()
})

describe('resolvePhotoPrintCanvasOptions / resolvePhotoItemIndexForCanvas', () => {
  it('paper-full→cover·none→0, image-full→contain·white→borderInsetMm(3), mmToPx 는 workspace 와 같은 화면 px', () => {
    const photo = digitalProfile.photoPrint!
    const base = { index: 0, canvasIndex: 0, sizeCode: '4x6', copies: 1, finish: 'matte' as const, brightnessFix: false, lowRes: false }
    const a = resolvePhotoPrintCanvasOptions(photo, { ...base, border: 'none', fit: 'paper-full', dateOverlay: false, grayscale: false })
    expect(a).toMatchObject({ fitMode: 'cover', frameInsetMm: 0, dateOverlay: false, grayscale: false })
    const b = resolvePhotoPrintCanvasOptions(photo, { ...base, border: 'white', fit: 'image-full', dateOverlay: true, grayscale: true })
    expect(b).toMatchObject({ fitMode: 'contain', frameInsetMm: 3, dateOverlay: true, grayscale: true })
    expect(b.mmToPx(10)).toBe(mmToPxDisplay(10))
    // D3: bleedPx 는 생략 시 0, 전달하면 그대로
    expect(a.bleedPx).toBe(0)
    expect(resolvePhotoPrintCanvasOptions(photo, { ...base, border: 'none', fit: 'paper-full', dateOverlay: false, grayscale: false }, 17.7).bleedPx).toBe(17.7)
    // borderInsetMm 생략 → 기본 2
    const noInset = { ...photo, options: { ...photo.options, borderInsetMm: undefined } }
    expect(resolvePhotoPrintCanvasOptions(noInset, { ...base, border: 'white', fit: 'paper-full', dateOverlay: false, grayscale: false }).frameInsetMm).toBe(2)
  })

  it('digital: 캔버스 0/1 → 항목 0, 2/3 → 항목 1; chemical: i → i; 음수 → -1', () => {
    expect(resolvePhotoItemIndexForCanvas({ process: 'digital' }, 0)).toBe(0)
    expect(resolvePhotoItemIndexForCanvas({ process: 'digital' }, 1)).toBe(0)
    expect(resolvePhotoItemIndexForCanvas({ process: 'digital' }, 3)).toBe(1)
    expect(resolvePhotoItemIndexForCanvas({ process: 'chemical' }, 3)).toBe(3)
    expect(resolvePhotoItemIndexForCanvas({ process: 'digital' }, -1)).toBe(-1)
  })
})

describe('rehydratePhotoPrint / applyPhotoPrintItem / applyPhotoPrintForCanvas', () => {
  it('프로파일 NULL: 플러그인 호출 없이 0', async () => {
    const { plugins, allCanvas, allEditors } = wire(2)
    expect(await rehydratePhotoPrint(allEditors[0] as never, allCanvas[0] as never, 0)).toBe(0)
    expect(await applyPhotoPrintItem(0)).toBe(0)
    expect(await applyPhotoPrintForCanvas(allCanvas[0] as never)).toBe(0)
    expect(plugins[0].rehydrate).not.toHaveBeenCalled()
    expect(plugins[0].apply).not.toHaveBeenCalled()
  })

  it('digital 4캔버스: 캔버스 3 은 항목 1 옵션으로 rehydrate, 항목 1 apply 는 캔버스 2·3 에, 캔버스 객체로도 apply', async () => {
    const { plugins, allCanvas, allEditors } = wire(4)
    useSettingsStore.getState().setProductProfile(digitalProfile)
    usePhotoPrintStore.getState().setFromProfile(digitalProfile)
    usePhotoPrintStore.getState().syncWithCanvasCount(4)
    usePhotoPrintStore.getState().setItemOption(1, { fit: 'image-full', border: 'white', grayscale: true })

    expect(await rehydratePhotoPrint(allEditors[3] as never, allCanvas[3] as never, 3)).toBe(2)
    expect(plugins[3].rehydrate).toHaveBeenCalledTimes(1)
    expect(plugins[3].rehydrate.mock.calls[0][0]).toMatchObject({ fitMode: 'contain', frameInsetMm: 3, grayscale: true, dateOverlay: false })
    expect(plugins[3].apply).not.toHaveBeenCalled()

    expect(await applyPhotoPrintItem(1)).toBe(2)
    expect(plugins[2].apply).toHaveBeenCalledTimes(1)
    expect(plugins[3].apply).toHaveBeenCalledTimes(1)
    expect(plugins[0].apply).not.toHaveBeenCalled()
    expect(plugins[2].apply.mock.calls[0][0]).toMatchObject({ fitMode: 'contain', frameInsetMm: 3 })

    expect(await applyPhotoPrintForCanvas(allCanvas[0] as never)).toBe(1)
    expect(plugins[0].apply.mock.calls[0][0]).toMatchObject({ fitMode: 'cover', frameInsetMm: 0, grayscale: false })
    // allCanvas 에 없는 캔버스 → 0
    expect(await applyPhotoPrintForCanvas({ id: 'ghost' } as never)).toBe(0)
  })

  it('항목이 아직 비어 있어도 캔버스 수로 동기화한 뒤 적용한다(복원 경로 — 세션 items 없음)', async () => {
    const { plugins, allCanvas, allEditors } = wire(2)
    useSettingsStore.getState().setProductProfile(digitalProfile)
    usePhotoPrintStore.getState().setFromProfile(digitalProfile)
    expect(usePhotoPrintStore.getState().items).toEqual([])
    expect(await rehydratePhotoPrint(allEditors[1] as never, allCanvas[1] as never, 1)).toBe(2)
    expect(plugins[1].rehydrate).toHaveBeenCalledTimes(1)
    expect(usePhotoPrintStore.getState().items).toHaveLength(1)
  })

  it('플러그인 미등록·에디터 없음 → 0, 플러그인 예외는 warn 후 0', async () => {
    useSettingsStore.getState().setProductProfile(digitalProfile)
    usePhotoPrintStore.getState().setFromProfile(digitalProfile)
    const allCanvas = [{ id: 'c0' }, { id: 'c1' }]
    const boom = { apply: vi.fn(async () => { throw new Error('x') }), rehydrate: vi.fn(async () => { throw new Error('x') }) }
    const allEditors = [{ getPlugin: () => undefined }, { getPlugin: () => boom }]
    useAppStore.setState({ allCanvas, allEditors } as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await rehydratePhotoPrint(allEditors[0] as never, allCanvas[0] as never, 0)).toBe(0)
    expect(await rehydratePhotoPrint(undefined, allCanvas[0] as never, 0)).toBe(0)
    expect(await rehydratePhotoPrint(allEditors[1] as never, allCanvas[1] as never, 1)).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('D3 — bleedPx: 템플릿셋 재단선 설정(printMarkConfig) → 플러그인 옵션', () => {
  it('resolvePhotoPrintBleedPx: cropMarkEnabled && bleedMm>0 → mmToPxDisplay(bleedMm); off·0·음수·비유한·null → 0', () => {
    expect(resolvePhotoPrintBleedPx({ bleedMm: 3, cropMarkEnabled: true })).toBe(mmToPxDisplay(3))
    expect(resolvePhotoPrintBleedPx({ bleedMm: 3, cropMarkEnabled: false })).toBe(0)
    expect(resolvePhotoPrintBleedPx({ bleedMm: 0, cropMarkEnabled: true })).toBe(0)
    expect(resolvePhotoPrintBleedPx({ bleedMm: -1, cropMarkEnabled: true })).toBe(0)
    expect(resolvePhotoPrintBleedPx({ bleedMm: Number.NaN, cropMarkEnabled: true })).toBe(0)
    expect(resolvePhotoPrintBleedPx(null)).toBe(0)
    expect(resolvePhotoPrintBleedPx(undefined)).toBe(0)
  })

  it('apply/rehydrate 호출 전부가 settings.printMarkConfig 의 bleedPx 를 전달한다(디지털 도련 3mm → 17.7px, chemical 재단선 off → 0)', async () => {
    const { plugins, allCanvas, allEditors } = wire(2)
    useSettingsStore.getState().setProductProfile(digitalProfile)
    usePhotoPrintStore.getState().setFromProfile(digitalProfile)
    useSettingsStore.getState().setPrintMarkConfig({ bleedMm: 3, cropMarkEnabled: true })

    expect(await rehydratePhotoPrint(allEditors[0] as never, allCanvas[0] as never, 0)).toBe(2)
    expect(plugins[0].rehydrate.mock.calls[0][0].bleedPx).toBe(mmToPxDisplay(3))
    expect(await applyPhotoPrintItem(0)).toBe(2)
    expect(plugins[0].apply.mock.calls[0][0].bleedPx).toBe(mmToPxDisplay(3))
    expect(plugins[1].apply.mock.calls[0][0].bleedPx).toBe(mmToPxDisplay(3))
    expect(await applyPhotoPrintForCanvas(allCanvas[1] as never)).toBe(1)
    expect(plugins[1].apply.mock.calls[1][0].bleedPx).toBe(mmToPxDisplay(3))

    useSettingsStore.getState().setPrintMarkConfig({ bleedMm: 3, cropMarkEnabled: false })
    await applyPhotoPrintForCanvas(allCanvas[0] as never)
    expect(plugins[0].apply.mock.calls[1][0].bleedPx).toBe(0)
    useSettingsStore.getState().setPrintMarkConfig(null)
    await rehydratePhotoPrint(allEditors[1] as never, allCanvas[1] as never, 1)
    expect(plugins[1].rehydrate.mock.calls[0][0].bleedPx).toBe(0)
  })
})
