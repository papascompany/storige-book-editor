import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ProductProfile } from '@storige/types'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useImageStore } from '@/stores/useImageStore'
import {
  SKIN_UPLOADS_MAX,
  classifyBackgroundSrc,
  keepSkinUploads,
  normalizeSkinUploads,
  recordSkinUploads,
  registerUploadsFromUrls,
  restoreSkinUploads,
} from './calendarSkinUploads'
import { getAssetBaseUrl } from './resolveAssetUrl'

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
    const url = `${getAssetBaseUrl()}/storage/uploads/k1.jpg`
    expect((await keepSkinUploads([url], { loadImage: load })).added).toEqual([url])
    expect(useImageStore.getState().uploaded).toHaveLength(1)
  })
})

// ─── 세션 메타 calendar.skinUploads(다시 열 때 '내 업로드' 복원) ─────────────────

const BASE = getAssetBaseUrl()
const up = (n: number | string) => `${BASE}/storage/uploads/f${n}.jpg`

function calendarProfile(): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 26, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' }, weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: false }, dataVersion: 'kr-2025-2035-v1',
    },
    output: { mode: 'single-pdf' },
  }
}

describe('normalizeSkinUploads', () => {
  it('같은 API 의 /storage/uploads 절대 URL 만 남기고 상대 경로는 API base 로 바꾼다', () => {
    expect(normalizeSkinUploads([up(1), '/storage/uploads/f2.jpg'])).toEqual([up(1), up(2)])
  })

  it('다른 origin·다른 저장소 경로·data:·blob:·비문자열·길이 초과·인코딩 위장은 버린다', () => {
    const bad = [
      'https://cdn.other.test/storage/uploads/a.jpg',
      `${BASE}/storage/outputs/x.pdf`,
      `${BASE}/storage/library/bg/a.jpg`,
      'data:image/png;base64,AAAA',
      'blob:https://e.test/1',
      7,
      null,
      `${BASE}/storage/uploads/${'a'.repeat(2050)}.jpg`,
      `${BASE}/storage/uploads/..%2fx.pdf`,
    ]
    expect(normalizeSkinUploads(bad)).toEqual([])
    expect(normalizeSkinUploads('nope')).toEqual([])
  })

  it('중복은 나중 것 하나만 남기고, 상한을 넘으면 오래된 것부터 뺀다', () => {
    expect(normalizeSkinUploads([up(1), up(2), up(1)])).toEqual([up(2), up(1)])
    const many = Array.from({ length: SKIN_UPLOADS_MAX + 3 }, (_, i) => up(i))
    const out = normalizeSkinUploads(many)
    expect(out).toHaveLength(SKIN_UPLOADS_MAX)
    expect(out[0]).toBe(up(3))
    expect(out[out.length - 1]).toBe(up(SKIN_UPLOADS_MAX + 2))
  })
})

describe('recordSkinUploads / keepSkinUploads / restoreSkinUploads', () => {
  beforeEach(() => {
    useCalendarStore.getState().reset()
    useImageStore.setState({ uploaded: [] } as never)
  })

  it('캘린더 메타가 없으면(NULL 세트) 기록하지 않는다', () => {
    expect(recordSkinUploads([up(1)])).toEqual([])
    expect(useCalendarStore.getState().meta).toBeNull()
  })

  it('기존 목록 뒤에 덧붙이고 정제한다(형식 위반 제외·상한)', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    recordSkinUploads([up(1), 'https://cdn.other.test/storage/uploads/x.jpg'])
    expect(useCalendarStore.getState().meta?.skinUploads).toEqual([up(1)])
    recordSkinUploads(Array.from({ length: SKIN_UPLOADS_MAX }, (_, i) => up(`n${i}`)))
    const list = useCalendarStore.getState().meta?.skinUploads ?? []
    expect(list).toHaveLength(SKIN_UPLOADS_MAX)
    expect(list).not.toContain(up(1))
  })

  it('형식에 맞는 것이 없으면 키를 만들지 않는다', () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    recordSkinUploads(['data:image/png;base64,AAAA'])
    expect(Object.keys(useCalendarStore.getState().meta ?? {})).not.toContain('skinUploads')
  })

  it('keepSkinUploads: 세션 메타 기록은 동기로 먼저(보류가 풀릴 때 같이 저장), 이어서 내 업로드 등록', async () => {
    useCalendarStore.getState().setFromProfile(calendarProfile())
    const load = vi.fn(async (url: string) => ({ getSrc: () => url }))
    const p = keepSkinUploads(['/storage/uploads/f9.jpg'], { loadImage: load })
    expect(useCalendarStore.getState().meta?.skinUploads).toEqual([up(9)])
    await p
    expect(load).toHaveBeenCalledWith(up(9))
    expect(useImageStore.getState().uploaded).toHaveLength(1)
  })

  it('restoreSkinUploads: 목록이 없으면 null, 있으면 내 업로드에 등록하고 실패는 경고만', async () => {
    expect(restoreSkinUploads(undefined)).toBeNull()
    expect(restoreSkinUploads([])).toBeNull()
    const load = vi.fn(async (url: string) => ({ getSrc: () => url }))
    expect((await restoreSkinUploads([up(1), up(2)], { loadImage: load }))?.added).toEqual([up(1), up(2)])
    expect(useImageStore.getState().uploaded).toHaveLength(2)
  })
})
