import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useImageStore } from '@/stores/useImageStore'
import { classifyBackgroundSrc, keepSkinUploads, registerUploadsFromUrls } from './calendarSkinUploads'

const API = 'https://api.example.test/api'

describe('classifyBackgroundSrc', () => {
  it('상대 경로·API base 절대 URL 의 /storage/uploads/<파일> → upload', () => {
    expect(classifyBackgroundSrc('/storage/uploads/a.jpg', API)).toBe('upload')
    expect(classifyBackgroundSrc(`${API}/storage/uploads/a.jpg`, API)).toBe('upload')
  })

  it('query·hash 는 떼고 판정한다', () => {
    expect(classifyBackgroundSrc(`${API}/storage/uploads/a.jpg?v=2#x`, API)).toBe('upload')
    expect(classifyBackgroundSrc('/storage/uploads/a.jpg?t=1', API)).toBe('upload')
  })

  it('/storage/outputs·/storage/designs·그 밖 /storage 경로 → unrecoverable', () => {
    expect(classifyBackgroundSrc('/storage/outputs/x.pdf', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc(`${API}/storage/designs/x`, API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('/storage/files/thumbnails/a.jpg', API)).toBe('unrecoverable')
  })

  it('/storage/library/… → library', () => {
    expect(classifyBackgroundSrc('/storage/library/bg/x.jpg', API)).toBe('library')
    expect(classifyBackgroundSrc(`${API}/storage/library/bg/x.jpg`, API)).toBe('library')
  })

  it('다른 origin(경로에 /storage/uploads 가 있어도)·base 경로 접두 불일치 → unrecoverable', () => {
    expect(classifyBackgroundSrc('https://cdn.example.test/storage/uploads/a.jpg', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('https://api.example.test/storage/uploads/a.jpg', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('//cdn.example.test/api/storage/uploads/a.jpg', API)).toBe('unrecoverable')
  })

  it('blob:·빈 값·비문자열 → unrecoverable, data: → data', () => {
    expect(classifyBackgroundSrc('blob:https://editor.example.test/1-2', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc(undefined, API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc(3, API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('data:image/png;base64,AAAA', API)).toBe('data')
  })

  it("'..'·인코딩된 '/'·'\\'·하위 폴더가 있는 업로드 경로 → unrecoverable", () => {
    expect(classifyBackgroundSrc('/storage/uploads/../outputs/x.pdf', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc(`${API}/storage/uploads/..%2foutputs%2fx.pdf`, API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('/storage/uploads/a%2Fb.jpg', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('/storage/uploads/a%5cb.jpg', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('/storage/uploads/sub/a.jpg', API)).toBe('unrecoverable')
    expect(classifyBackgroundSrc('/storage/library/../uploads/a.jpg', API)).toBe('unrecoverable')
  })
})

function fakeUploaded(src: string, storagePhotoUrl?: string) {
  return { getSrc: () => src, ...(storagePhotoUrl ? { storagePhotoUrl } : {}) }
}

describe('registerUploadsFromUrls', () => {
  beforeEach(() => {
    useImageStore.setState({ uploaded: [], uploadedPhotoMeta: [], uploadedPhotoIdByUrl: {} } as never)
  })

  it('새 URL 을 등록하고 storagePhotoUrl 을 붙인다 — uploadedPhotoMeta·uploadedPhotoIdByUrl 은 그대로', async () => {
    const meta = [{ url: 'm' }]
    useImageStore.setState({ uploadedPhotoMeta: meta, uploadedPhotoIdByUrl: { m: 'f1' } } as never)
    const load = vi.fn(async (url: string) => ({ getSrc: () => url }))
    const r = await registerUploadsFromUrls(['https://api/x/storage/uploads/a.jpg'], { loadImage: load })
    expect(r).toEqual({ added: ['https://api/x/storage/uploads/a.jpg'], skipped: 0, failed: 0 })
    const list = useImageStore.getState().uploaded as unknown as Array<{ storagePhotoUrl?: string }>
    expect(list).toHaveLength(1)
    expect(list[0].storagePhotoUrl).toBe('https://api/x/storage/uploads/a.jpg')
    expect(useImageStore.getState().uploadedPhotoMeta).toBe(meta)
    expect(useImageStore.getState().uploadedPhotoIdByUrl).toEqual({ m: 'f1' })
  })

  it('기존 항목의 getSrc·storagePhotoUrl 과 같거나 입력 안에서 겹치면 건너뛴다', async () => {
    useImageStore.setState({ uploaded: [fakeUploaded('u1'), fakeUploaded('data:x', 'u2')] } as never)
    const load = vi.fn(async (url: string) => ({ getSrc: () => url }))
    const r = await registerUploadsFromUrls(['u1', 'u2', 'u3', 'u3'], { loadImage: load })
    expect(r).toEqual({ added: ['u3'], skipped: 3, failed: 0 })
    expect(load).toHaveBeenCalledTimes(1)
    expect(useImageStore.getState().uploaded).toHaveLength(3)
  })

  it('로드에 실패한 URL 은 등록하지 않고 개수만 센다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const load = vi.fn(async (url: string) => {
      if (url === 'bad') throw new Error('load')
      return { getSrc: () => url }
    })
    const r = await registerUploadsFromUrls(['bad', 'ok'], { loadImage: load })
    expect(r).toEqual({ added: ['ok'], skipped: 0, failed: 1 })
    expect(useImageStore.getState().uploaded).toHaveLength(1)
  })

  it('keepSkinUploads 는 등록 경로로 위임한다', async () => {
    const load = vi.fn(async (url: string) => ({ getSrc: () => url }))
    expect((await keepSkinUploads(['k1'], { loadImage: load })).added).toEqual(['k1'])
    expect(useImageStore.getState().uploaded).toHaveLength(1)
  })
})
