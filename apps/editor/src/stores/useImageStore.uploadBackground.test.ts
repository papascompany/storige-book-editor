import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

/**
 * B11-b (2026-10-25): 배경 업로드(upload(..., SelectionType.background)) 래스터 원본은 프로파일 세트에서 storage 업로드 URL.
 *  - 프로파일 세트(캘린더·사진인화 등): uploadFilePublic → 절대 URL 로 core.imageFromURL(crossOrigin anonymous), fileToImage 미호출.
 *    배경은 자동편집 입력이 아니므로 uploadedPhotoMeta·uploaded 에 등록하지 않는다(종전과 같음).
 *  - 업로드 실패·URL 로드 실패: 종전 core.fileToImage(data URL) 폴백.
 *  - 프로파일 NULL 세트: core.fileToImage(canvas, file, imagePlugin) 한 번만 — 업로드·URL 로드 없음(바이트 동일).
 *  - 범위: background 타입의 래스터만. 다른 타입(image)·SVG 는 종전 경로.
 */
const uploadFilePublic = vi.fn()
const uploadFile = vi.fn()
const fileToImage = vi.fn()
const imageFromURL = vi.fn()
const fileToURL = vi.fn()
const loadSVGFromURL = vi.fn()
const selectFiles = vi.fn()

vi.mock('@/api', () => ({
  storageApi: {
    uploadFilePublic: (...args: unknown[]) => uploadFilePublic(...args),
    uploadFile: (...args: unknown[]) => uploadFile(...args),
  },
}))
vi.mock('@/utils/photoAutofill', () => ({ parsePhotoExif: vi.fn().mockResolvedValue({}) }))
vi.mock('@storige/canvas-core', () => ({
  core: {
    fileToImage: (...args: unknown[]) => fileToImage(...args),
    imageFromURL: (...args: unknown[]) => imageFromURL(...args),
    fileToURL: (...args: unknown[]) => fileToURL(...args),
    loadSVGFromURL: (...args: unknown[]) => loadSVGFromURL(...args),
  },
  ImageProcessingPlugin: class {},
  selectFiles: (...args: unknown[]) => selectFiles(...args),
  SelectionType: { image: 'image', background: 'background', frame: 'frame', shape: 'shape' },
}))

import { SelectionType } from '@storige/canvas-core'
import { useImageStore } from './useImageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const calendarProfile: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'desk',
    monthCount: 12,
    coverCanvases: 1,
    canvasesPerMonth: 2,
    epilogueCanvases: 1,
    allowedRange: { from: '2027-01', to: '2027-12' },
    weekStart: 0,
    show: { holidays: true, lunar: false, solarTerms: false },
    dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
}

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_digital',
  pages: { kind: 'range', min: 2, max: 40, step: 2, labelRule: 'photo' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'digital',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['matte'], brightnessFix: false, dateOverlay: true, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 10, maxMb: 25 },
  },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
}

interface Props { [k: string]: unknown }

function fakeImage(id: string): Props {
  const img: Props = {
    id,
    width: 200,
    height: 100,
    set(p: Props) { Object.assign(img, p) },
    scale: vi.fn(),
  }
  return img
}

function fakeCanvas() {
  const workspace: Props = {
    id: 'workspace',
    width: 100,
    height: 100,
    scaleX: 1,
    scaleY: 1,
    left: 50,
    top: 50,
    getCenterPoint: () => ({ x: 50, y: 50 }),
  }
  const objects: Props[] = [workspace]
  return {
    getObjects: () => objects,
    add: vi.fn((o: Props) => { objects.push(o) }),
    remove: vi.fn(),
    setActiveObject: vi.fn(),
  }
}

const plugin = {} as never
const file = new File([new Uint8Array([1, 2, 3])], 'bg.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })
const svgFile = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'bg.svg', { type: 'image/svg+xml' })

async function uploadBackground(canvas: ReturnType<typeof fakeCanvas>, type: string = SelectionType.background) {
  return useImageStore.getState().upload(canvas as never, plugin, type as never, 'image/*')
}

beforeEach(() => {
  for (const m of [uploadFilePublic, uploadFile, fileToImage, imageFromURL, fileToURL, loadSVGFromURL, selectFiles]) m.mockReset()
  selectFiles.mockResolvedValue([file])
  useImageStore.setState({ uploading: false, uploaded: [], uploadedPhotoMeta: [], uploadedPhotoIdByUrl: {} })
  useSettingsStore.getState().setProductProfile(null)
})

describe('upload — 배경(B11-b)', () => {
  it('프로파일 NULL 세트: core.fileToImage(canvas, file, imagePlugin) 한 번만 — 업로드·URL 로드 없음', async () => {
    const canvas = fakeCanvas()
    const img = fakeImage('legacy-bg')
    fileToImage.mockResolvedValue(img)

    const item = await uploadBackground(canvas)
    expect(item).toBe(img)
    expect(fileToImage).toHaveBeenCalledTimes(1)
    expect(fileToImage.mock.calls[0]).toEqual([canvas, file, plugin])
    expect(fileToImage.mock.calls[0][0]).toBe(canvas)
    expect(fileToImage.mock.calls[0][1]).toBe(file)
    expect(fileToImage.mock.calls[0][2]).toBe(plugin)
    expect(uploadFilePublic).not.toHaveBeenCalled()
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(img.extensionType).toBe('background')
  })

  it.each([
    ['캘린더', calendarProfile],
    ['사진인화', photoProfile],
  ])('%s 프로파일 세트: storage 업로드 → 절대 URL 로 imageFromURL(crossOrigin anonymous), fileToImage 미호출·사진 메타 미등록', async (_label, profile) => {
    useSettingsStore.getState().setProductProfile(profile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/bg.jpg', id: 'file-bg' })
    const img = fakeImage('url-bg')
    imageFromURL.mockResolvedValue(img)
    const canvas = fakeCanvas()

    const item = await uploadBackground(canvas)
    expect(item).toBe(img)
    expect(uploadFilePublic).toHaveBeenCalledTimes(1)
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(fileToImage).not.toHaveBeenCalled()
    expect(imageFromURL).toHaveBeenCalledTimes(1)
    const [url, opts] = imageFromURL.mock.calls[0] as [string, { crossOrigin?: string }]
    expect(url).toMatch(/^https?:\/\/.+\/storage\/uploads\/bg\.jpg$/)
    expect(opts).toEqual({ crossOrigin: 'anonymous' })
    expect(img.extensionType).toBe('background')
    expect(canvas.add).toHaveBeenCalledWith(img)
    const s = useImageStore.getState()
    expect(s.uploadedPhotoMeta).toEqual([])
    expect(s.uploaded).toEqual([])
  })

  it('프로파일 세트 업로드 실패: data URL 폴백 — 편집을 막지 않는다', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockRejectedValue(new Error('503'))
    const img = fakeImage('fallback-bg')
    fileToImage.mockResolvedValue(img)
    const canvas = fakeCanvas()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const item = await uploadBackground(canvas)
    warn.mockRestore()
    expect(item).toBe(img)
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(fileToImage).toHaveBeenCalledTimes(1)
    expect(fileToImage.mock.calls[0]).toEqual([canvas, file, plugin])
    expect(img.extensionType).toBe('background')
  })

  it('프로파일 세트 업로드 응답에 url 없음: data URL 폴백', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockResolvedValue({ success: false })
    const img = fakeImage('fallback-bg2')
    fileToImage.mockResolvedValue(img)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const item = await uploadBackground(fakeCanvas())
    warn.mockRestore()
    expect(item).toBe(img)
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(fileToImage).toHaveBeenCalledTimes(1)
  })

  it('프로파일 세트 업로드는 됐지만 URL 이미지 로드 실패: data URL 폴백', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/bg2.jpg', id: 'file-bg2' })
    imageFromURL.mockRejectedValue(new Error('이미지 로드 실패'))
    const img = fakeImage('fallback-bg3')
    fileToImage.mockResolvedValue(img)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const item = await uploadBackground(fakeCanvas())
    warn.mockRestore()
    expect(item).toBe(img)
    expect(imageFromURL).toHaveBeenCalledTimes(1)
    expect(fileToImage).toHaveBeenCalledTimes(1)
  })

  it('범위: 프로파일 세트라도 배경이 아닌 타입(image)은 종전 core.fileToImage', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/bg.jpg', id: 'file-bg' })
    const img = fakeImage('plain-image')
    fileToImage.mockResolvedValue(img)

    const item = await uploadBackground(fakeCanvas(), SelectionType.image)
    expect(item).toBe(img)
    expect(fileToImage).toHaveBeenCalledTimes(1)
    expect(imageFromURL).not.toHaveBeenCalled()
  })

  it('범위: 프로파일 세트의 SVG 배경은 종전 loadSVGFromURL 경로 — 업로드·URL 로드 없음', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    selectFiles.mockResolvedValue([svgFile])
    fileToURL.mockResolvedValue('data:image/svg+xml;base64,AAAA')
    const svg = fakeImage('svg-bg')
    loadSVGFromURL.mockResolvedValue(svg)

    const item = await uploadBackground(fakeCanvas())
    expect(item).toBe(svg)
    expect(loadSVGFromURL).toHaveBeenCalledWith('data:image/svg+xml;base64,AAAA')
    expect(uploadFilePublic).not.toHaveBeenCalled()
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(fileToImage).not.toHaveBeenCalled()
  })
})
