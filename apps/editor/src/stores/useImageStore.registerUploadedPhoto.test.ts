import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * '내 업로드' → 자동편집 입력 등록 회귀 잠금 (2026-08-09).
 *
 * 종전 결함: `storageApi.uploadFile`(= `/storage/upload`, JWT+@Roles)을 쳐서 비로그인 고객은
 * 매 업로드마다 401 → uploadedPhotoMeta 가 항상 비었고, 자동편집(배지/EXIF)이 '내 업로드'
 * 사진을 전혀 보지 못했다. fire-and-forget 이라 편집 자체는 멀쩡해 증상이 콘솔에만 남았다.
 *
 * 잠그는 불변식:
 *  - 게스트 통로(`storageApi.uploadFilePublic`)로만 올린다.
 *  - meta.url 은 **절대 URL** — ExternalPhoto.url 과 같은 자리(fillImage src)에 쓰인다.
 *  - 업로드 실패는 조용히 스킵(undefined) — 편집 흐름을 막지 않는다.
 */

const uploadFilePublic = vi.fn()
const uploadFile = vi.fn()

vi.mock('@/api', () => ({
  storageApi: {
    uploadFilePublic: (...args: unknown[]) => uploadFilePublic(...args),
    uploadFile: (...args: unknown[]) => uploadFile(...args),
  },
}))

vi.mock('@/utils/photoAutofill', () => ({
  parsePhotoExif: vi.fn(async () => ({
    takenAt: '2026-07-01T10:00:00.000Z',
    gps: { lat: 37.5, lng: 127.0 },
  })),
}))

// 캔버스 런타임은 이 경로와 무관 — 모듈 로드만 성립시킨다.
vi.mock('@storige/canvas-core', () => ({
  core: {},
  ImageProcessingPlugin: class {},
  selectFiles: vi.fn(),
  SelectionType: { Image: 'image' },
}))

vi.mock('@/utils/resolveAssetUrl', () => ({
  resolveAssetUrl: (u?: string | null) =>
    !u ? null : /^https?:\/\//i.test(u) ? u : `https://api.example.com/api${u}`,
}))

import { useImageStore } from './useImageStore'

const file = () => new File(['x'], 'photo.jpg', { type: 'image/jpeg' })

beforeEach(() => {
  uploadFilePublic.mockReset()
  uploadFile.mockReset()
  useImageStore.setState({ uploadedPhotoMeta: [] })
})

describe('useImageStore.registerUploadedPhoto', () => {
  it('게스트 통로로 올리고 절대 URL 로 메타를 등록한다 — JWT 라우트는 치지 않는다', async () => {
    uploadFilePublic.mockResolvedValueOnce({ id: 'db-1', url: '/storage/uploads/a.jpg' })

    const meta = await useImageStore.getState().registerUploadedPhoto(file())

    // ⚠️ uploadFile(= /storage/upload)로 되돌리면 게스트 401 재발.
    expect(uploadFile).not.toHaveBeenCalled()
    expect(uploadFilePublic).toHaveBeenCalledTimes(1)
    expect(meta?.url).toBe('https://api.example.com/api/storage/uploads/a.jpg')
    expect(useImageStore.getState().uploadedPhotoMeta).toHaveLength(1)
  })

  it('EXIF 는 원본 File 에서 파싱해 메타에 싣는다', async () => {
    uploadFilePublic.mockResolvedValueOnce({ id: 'db-1', url: '/storage/uploads/a.jpg' })

    const meta = await useImageStore.getState().registerUploadedPhoto(file())

    expect(meta?.takenAt).toBe('2026-07-01T10:00:00.000Z')
    expect(meta?.gps).toEqual({ lat: 37.5, lng: 127.0 })
    expect(meta?.exifParsed).toBe(true)
  })

  it('업로드가 401 등으로 실패하면 조용히 스킵한다 — 편집 흐름을 막지 않는다', async () => {
    uploadFilePublic.mockRejectedValueOnce(
      Object.assign(new Error('Unauthorized'), { response: { status: 401 } }),
    )

    await expect(
      useImageStore.getState().registerUploadedPhoto(file()),
    ).resolves.toBeUndefined()
    expect(useImageStore.getState().uploadedPhotoMeta).toEqual([])
  })

  it('응답에 url 이 없으면 등록하지 않는다', async () => {
    uploadFilePublic.mockResolvedValueOnce({ id: 'db-1' })

    await expect(
      useImageStore.getState().registerUploadedPhoto(file()),
    ).resolves.toBeUndefined()
    expect(useImageStore.getState().uploadedPhotoMeta).toEqual([])
  })

  it('같은 URL 은 중복 등록하지 않는다', async () => {
    uploadFilePublic.mockResolvedValue({ id: 'db-1', url: '/storage/uploads/a.jpg' })

    await useImageStore.getState().registerUploadedPhoto(file())
    await useImageStore.getState().registerUploadedPhoto(file())

    expect(useImageStore.getState().uploadedPhotoMeta).toHaveLength(1)
  })
})
