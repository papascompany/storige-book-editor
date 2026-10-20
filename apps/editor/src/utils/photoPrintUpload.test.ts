import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

const showToast = vi.fn()
vi.mock('@/stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

import { useSettingsStore } from '@/stores/useSettingsStore'
import { checkPhotoPrintPhotoCount, checkPhotoPrintUploadLimit, photoCountLimitMessage, photoSizeLimitMessage } from './photoPrintUpload'

/**
 * P2-d 사진인화 (2026-10-19): 업로드 한도 — maxPhotos(현재 수 + 선택 수)·maxMb(파일 size) 거부, 프로파일 NULL 은 no-op.
 */
const MB = 1024 * 1024

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'chemical',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none'], fit: ['paper-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: false, grayscale: false },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 10, maxMb: 25 },
  },
  output: { mode: 'single-pdf' },
}

function fileOf(bytes: number, name = 'p.jpg'): File {
  const f = new File([''], name, { type: 'image/jpeg' })
  Object.defineProperty(f, 'size', { value: bytes })
  return f
}

beforeEach(() => {
  showToast.mockReset()
  useSettingsStore.getState().setProductProfile(null)
})

describe('checkPhotoPrintUploadLimit', () => {
  it('프로파일 NULL: 어떤 파일·수량이든 true, 토스트 없음', () => {
    expect(checkPhotoPrintUploadLimit([fileOf(500 * MB)], 999)).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('maxPhotos: 현재 9장 + 2장 선택 → 거부 + 토스트, 현재 9장 + 1장 → 허용', () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    expect(checkPhotoPrintUploadLimit([fileOf(1 * MB), fileOf(1 * MB)], 9)).toBe(false)
    expect(showToast).toHaveBeenCalledWith(photoCountLimitMessage(10, 9), 'error', 5000)
    showToast.mockReset()
    expect(checkPhotoPrintUploadLimit([fileOf(1 * MB)], 9)).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('maxMb: 25MB 초과 파일이 하나라도 있으면 거부 + 토스트(크기 표기), 25MB 정확히는 허용', () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    expect(checkPhotoPrintUploadLimit([fileOf(1 * MB), fileOf(30 * MB)], 0)).toBe(false)
    expect(showToast).toHaveBeenCalledWith(photoSizeLimitMessage(25, '30.0'), 'error', 5000)
    showToast.mockReset()
    expect(checkPhotoPrintUploadLimit([fileOf(25 * MB)], 0)).toBe(true)
  })

  it('빈 목록·null 은 true, 음수/비유한 현재 수는 0 으로 취급', () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    expect(checkPhotoPrintUploadLimit([], 100)).toBe(true)
    expect(checkPhotoPrintUploadLimit(null, 100)).toBe(true)
    expect(checkPhotoPrintUploadLimit([fileOf(1)], -5)).toBe(true)
    expect(checkPhotoPrintUploadLimit([fileOf(1)], Number.NaN)).toBe(true)
  })
})

describe('checkPhotoPrintPhotoCount (security-3 — 자동배치 입력 수량)', () => {
  it('프로파일 NULL: 어떤 수량이든 true', () => {
    expect(checkPhotoPrintPhotoCount(999)).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it('maxPhotos 10: 11장 → 거부 + 토스트(현재 11장), 10장·0장·NaN → 허용', () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    expect(checkPhotoPrintPhotoCount(11)).toBe(false)
    expect(showToast).toHaveBeenCalledWith(photoCountLimitMessage(10, 11), 'error', 5000)
    showToast.mockReset()
    expect(checkPhotoPrintPhotoCount(10)).toBe(true)
    expect(checkPhotoPrintPhotoCount(0)).toBe(true)
    expect(checkPhotoPrintPhotoCount(Number.NaN)).toBe(true)
    expect(showToast).not.toHaveBeenCalled()
  })
})
