import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

/**
 * P2-d D12 (2026-10-21): 사진인화 틀 채움 원본은 storage 업로드 URL — base64 data URL 을 canvasData 에 넣지 않는다.
 *  - 사진인화 세트: registerUploadedPhoto(uploadFilePublic + 원본 File EXIF) → core.imageFromURL(절대 URL, crossOrigin anonymous),
 *    takenAt 은 등록 메타에서, uploadedPhotoIdByUrl 에 파일 id(sourcePhotoId 원천) 기록.
 *  - 업로드 실패·URL 로드 실패: 종전 core.fileToImage(data URL) 폴백 + EXIF 는 원본 File 에서 — 편집을 막지 않는다.
 *  - 프로파일 NULL 세트: core.fileToImage 만(업로드·EXIF 호출 없음, 바이트 동일).
 * B11 (2026-10-25): 게이트는 사진인화 전용이 아니라 상품 프로파일이 있는 세트 전체 — 캘린더 세트도 업로드 URL 경로.
 */
const uploadFilePublic = vi.fn()
const uploadFile = vi.fn()
const fileToImage = vi.fn()
const imageFromURL = vi.fn()
const parsePhotoExif = vi.fn()

vi.mock('@/api', () => ({
  storageApi: {
    uploadFilePublic: (...args: unknown[]) => uploadFilePublic(...args),
    uploadFile: (...args: unknown[]) => uploadFile(...args),
  },
}))
vi.mock('@/utils/photoAutofill', () => ({ parsePhotoExif: (...args: unknown[]) => parsePhotoExif(...args) }))
vi.mock('@storige/canvas-core', () => ({
  core: {
    fileToImage: (...args: unknown[]) => fileToImage(...args),
    imageFromURL: (...args: unknown[]) => imageFromURL(...args),
  },
  ImageProcessingPlugin: class {},
  selectFiles: vi.fn(),
  SelectionType: { Image: 'image' },
}))

import { useImageStore } from './useImageStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

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

const canvas = {} as never
const plugin = {} as never
const file = new File([new Uint8Array([1, 2, 3])], 'p01.jpg', { type: 'image/jpeg', lastModified: 1_700_000_000_000 })

beforeEach(() => {
  uploadFilePublic.mockReset()
  uploadFile.mockReset()
  fileToImage.mockReset()
  imageFromURL.mockReset()
  parsePhotoExif.mockReset()
  parsePhotoExif.mockResolvedValue({ takenAt: '2026-04-02T05:01:00.000Z' })
  useImageStore.setState({ uploadedPhotoMeta: [], uploadedPhotoIdByUrl: {} })
  useSettingsStore.getState().setProductProfile(null)
})

describe('resolveFrameFillImage (D12)', () => {
  it('프로파일 NULL 세트: 종전 core.fileToImage 만 — 업로드·EXIF 미호출', async () => {
    const img = { id: 'legacy' }
    fileToImage.mockResolvedValue(img)
    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    expect(r).toEqual({ image: img, uploaded: false })
    expect(fileToImage).toHaveBeenCalledWith(canvas, file, plugin)
    expect(uploadFilePublic).not.toHaveBeenCalled()
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(parsePhotoExif).not.toHaveBeenCalled()
  })

  it('사진인화 세트: storage 업로드 → 절대 URL 로 imageFromURL(crossOrigin anonymous), takenAt·파일 id 기록, fileToImage 미호출', async () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/p01.jpg', id: 'file-1' })
    const img = { id: 'from-url' }
    imageFromURL.mockResolvedValue(img)

    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    expect(r).toEqual({ image: img, takenAt: '2026-04-02T05:01:00.000Z', uploaded: true })
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(fileToImage).not.toHaveBeenCalled()
    expect(imageFromURL).toHaveBeenCalledTimes(1)
    const [url, opts] = imageFromURL.mock.calls[0] as [string, { crossOrigin?: string }]
    expect(url).toMatch(/^https?:\/\/.+\/storage\/uploads\/p01\.jpg$/)
    expect(opts).toEqual({ crossOrigin: 'anonymous' })
    const s = useImageStore.getState()
    expect(s.uploadedPhotoMeta.map((m) => [m.url, m.takenAt])).toEqual([[url, '2026-04-02T05:01:00.000Z']])
    expect(s.uploadedPhotoIdByUrl).toEqual({ [url]: 'file-1' })
  })

  it('업로드 실패: data URL 폴백 + 원본 File EXIF — 편집을 막지 않는다', async () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    uploadFilePublic.mockRejectedValue(new Error('401'))
    const img = { id: 'fallback' }
    fileToImage.mockResolvedValue(img)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    warn.mockRestore()
    expect(r).toEqual({ image: img, takenAt: '2026-04-02T05:01:00.000Z', uploaded: false })
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(fileToImage).toHaveBeenCalledWith(canvas, file, plugin)
  })

  it('업로드는 됐지만 URL 이미지 로드 실패: data URL 폴백', async () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/p02.jpg', id: 'file-2' })
    imageFromURL.mockRejectedValue(new Error('이미지 로드 실패'))
    const img = { id: 'fallback2' }
    fileToImage.mockResolvedValue(img)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    warn.mockRestore()
    expect(r).toMatchObject({ image: img, uploaded: false })
    expect(fileToImage).toHaveBeenCalledTimes(1)
  })

  it('B11 캘린더 프로파일 세트: storage 업로드 → 절대 URL 로 imageFromURL(crossOrigin anonymous), fileToImage 미호출', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockResolvedValue({ success: true, url: '/storage/uploads/c01.jpg', id: 'file-c1' })
    const img = { id: 'cal-from-url' }
    imageFromURL.mockResolvedValue(img)

    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    expect(r).toEqual({ image: img, takenAt: '2026-04-02T05:01:00.000Z', uploaded: true })
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(fileToImage).not.toHaveBeenCalled()
    expect(imageFromURL).toHaveBeenCalledTimes(1)
    const [url, opts] = imageFromURL.mock.calls[0] as [string, { crossOrigin?: string }]
    expect(url).toMatch(/^https?:\/\/.+\/storage\/uploads\/c01\.jpg$/)
    expect(opts).toEqual({ crossOrigin: 'anonymous' })
    expect(useImageStore.getState().uploadedPhotoIdByUrl).toEqual({ [url]: 'file-c1' })
  })

  it('B11 캘린더 프로파일 세트 업로드 실패: data URL 폴백 — 편집을 막지 않는다', async () => {
    useSettingsStore.getState().setProductProfile(calendarProfile)
    uploadFilePublic.mockResolvedValue({ success: false })
    const img = { id: 'cal-fallback' }
    fileToImage.mockResolvedValue(img)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)
    warn.mockRestore()
    expect(r).toMatchObject({ image: img, uploaded: false })
    expect(uploadFilePublic).toHaveBeenCalledWith(file)
    expect(imageFromURL).not.toHaveBeenCalled()
    expect(fileToImage).toHaveBeenCalledWith(canvas, file, plugin)
  })

  it('fileToImage 가 undefined 면 undefined(기존 "no image selected" 분기)', async () => {
    fileToImage.mockResolvedValue(undefined)
    expect(await useImageStore.getState().resolveFrameFillImage(canvas, file, plugin)).toBeUndefined()
  })
})
