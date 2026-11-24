import { describe, it, expect, vi } from 'vitest'
import type { ExternalPhoto } from '@storige/types'
import type { AutofillResult, UploadedPhotoMeta } from '@/utils/photoPlacement'
import { photoPrintBatchMessage, runPhotoPrintBatchUpload, type PhotoPrintBatchDeps } from './photoPrintBatchUpload'

/**
 * 사진인화 툴바 업로드: 여러 장 선택 → 순차 storage 등록 → 등록된 사진만 자동 채움, 결과 집계·문구.
 */
const file = (name: string) => new File([''], name, { type: 'image/jpeg' })
const meta = (name: string): UploadedPhotoMeta => ({ url: `https://api.test/storage/uploads/${name}`, name, exifParsed: true })
const fill = (r: Partial<AutofillResult>): AutofillResult => ({
  filledCount: 0, remainingFrames: 0, remainingPhotos: 0, failedPhotos: 0, lowResWarnings: [], ...r,
})

function deps(over: Partial<PhotoPrintBatchDeps>): PhotoPrintBatchDeps {
  return {
    selectFiles: async () => [],
    checkLimit: () => true,
    checkFile: () => true,
    register: async (f) => meta(f.name),
    autofill: async (photos) => fill({ filledCount: photos.length }),
    ...over,
  }
}

describe('runPhotoPrintBatchUpload', () => {
  it('선택 취소면 null — 등록·채움 없음', async () => {
    const register = vi.fn()
    expect(await runPhotoPrintBatchUpload(deps({ register }))).toBeNull()
    expect(register).not.toHaveBeenCalled()
  })

  it('한도 초과면 null — 등록 없음', async () => {
    const register = vi.fn()
    const r = await runPhotoPrintBatchUpload(deps({ selectFiles: async () => [file('a.jpg')], checkLimit: () => false, register }))
    expect(r).toBeNull()
    expect(register).not.toHaveBeenCalled()
  })

  it('여러 장을 선택 순서대로 순차 등록하고, 등록된 사진 전부를 한 번에 채움에 넘긴다', async () => {
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0
    const autofill = vi.fn(async (photos: ExternalPhoto[]) => fill({ filledCount: photos.length }))
    const r = await runPhotoPrintBatchUpload(deps({
      selectFiles: async () => [file('1.jpg'), file('2.jpg'), file('3.jpg')],
      register: async (f) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        order.push(f.name); inFlight--
        return meta(f.name)
      },
      autofill,
    }))
    expect(order).toEqual(['1.jpg', '2.jpg', '3.jpg'])
    expect(maxInFlight).toBe(1)
    expect(autofill).toHaveBeenCalledTimes(1)
    expect(autofill.mock.calls[0][0].map((p) => p.url)).toEqual([meta('1.jpg').url, meta('2.jpg').url, meta('3.jpg').url])
    expect(r).toMatchObject({ selected: 3, filled: 3, uploadFailed: 0, skipped: 0 })
  })

  it('파일 검사 탈락·등록 실패는 건너뛰고 나머지만 채운다', async () => {
    const autofill = vi.fn(async (photos: ExternalPhoto[]) => fill({ filledCount: photos.length }))
    const r = await runPhotoPrintBatchUpload(deps({
      selectFiles: async () => [file('big.jpg'), file('fail.jpg'), file('ok.jpg')],
      checkFile: (f) => f.name !== 'big.jpg',
      register: async (f) => (f.name === 'fail.jpg' ? undefined : meta(f.name)),
      autofill,
    }))
    expect(autofill.mock.calls[0][0].map((p) => p.name)).toEqual(['ok.jpg'])
    expect(r).toMatchObject({ selected: 3, skipped: 1, uploadFailed: 1, filled: 1 })
  })

  it('등록된 사진이 없으면 채움을 부르지 않는다', async () => {
    const autofill = vi.fn()
    const r = await runPhotoPrintBatchUpload(deps({ selectFiles: async () => [file('x.jpg')], register: async () => undefined, autofill }))
    expect(autofill).not.toHaveBeenCalled()
    expect(r).toMatchObject({ filled: 0, uploadFailed: 1 })
  })

  it('틀 부족·채움 실패·남은 빈 틀을 채움 결과에서 옮긴다', async () => {
    const r = await runPhotoPrintBatchUpload(deps({
      selectFiles: async () => [file('a.jpg'), file('b.jpg'), file('c.jpg')],
      autofill: async () => fill({ filledCount: 1, remainingPhotos: 1, failedPhotos: 1, remainingFrames: 0 }),
    }))
    expect(r).toMatchObject({ filled: 1, unplaced: 1, fillFailed: 1, remainingFrames: 0 })
  })
})

describe('photoPrintBatchMessage', () => {
  const base = { selected: 0, skipped: 0, uploadFailed: 0, filled: 0, unplaced: 0, fillFailed: 0, remainingFrames: 0 }
  it('모두 채우면 success', () => {
    expect(photoPrintBatchMessage({ ...base, selected: 3, filled: 3 })).toEqual({ text: '사진 3장을 넣었습니다.', level: 'success' })
  })
  it('남은 빈 칸을 함께 알린다(success)', () => {
    const m = photoPrintBatchMessage({ ...base, selected: 2, filled: 2, remainingFrames: 8 })
    expect(m.level).toBe('success')
    expect(m.text).toContain('빈 칸 8개')
  })
  it('틀 부족·실패·용량 초과는 warning', () => {
    const m = photoPrintBatchMessage({ ...base, selected: 5, filled: 2, unplaced: 1, uploadFailed: 1, skipped: 1 })
    expect(m.level).toBe('warning')
    expect(m.text).toContain('1장이 남았습니다')
    expect(m.text).toContain('1장은 올리지 못했습니다')
    expect(m.text).toContain('1장은 용량이 커서')
  })
  it('아무것도 못 했으면 info', () => {
    expect(photoPrintBatchMessage({ ...base, selected: 1 }).level).toBe('info')
  })
})
