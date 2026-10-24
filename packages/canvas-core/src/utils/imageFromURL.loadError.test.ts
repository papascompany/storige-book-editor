// imageFromURL 로드 실패 판정 — core.imageFromURL(canvas.ts)·imageFromURL(factory.ts) 공통.
//
// fabric 5.5 Image.fromURL 은 로드 실패에도 콜백을 `(new fabric.Image(null, opts), true)` 로 부른다.
// 종전 구현은 `!img` 만 검사해 0×0 이미지로 resolve 했고, 호출처 배율이 Infinity 가 될 수 있었다.
// 고정하는 계약:
//  1) isError=true → reject
//  2) isError 가 없어도 결과가 0×0(빈 요소) → reject
//  3) 정상 로드 → resolve(옵션 반영)
//  4) 오류 메시지에 쿼리스트링·해시·data 본문이 실리지 않는다
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fabric } from 'fabric'
import { core } from './canvas'
import { imageFromURL as factoryImageFromURL } from './factory'
import { summarizeImageUrl } from './imageLoad'

// 1×1 투명 PNG
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const SIGNED_URL = 'https://cdn.example.com/storage/a/b/photo.jpg?token=SECRET_TOKEN_VALUE&exp=1#frag'

type FromURLCallback = (img: fabric.Image, isError?: boolean) => void

/** fabric.Image.fromURL 을 실패 콜백으로 대체 — 실제 fabric 과 같은 모양(new fabric.Image(null), isError). */
function stubFromURLFailure(isError: boolean | undefined): void {
  vi.spyOn(fabric.Image, 'fromURL').mockImplementation(((_url: string, cb: FromURLCallback) => {
    cb(new fabric.Image(null as unknown as HTMLImageElement), isError)
  }) as unknown as typeof fabric.Image.fromURL)
}

afterEach(() => {
  vi.restoreAllMocks()
})

const loaders = [
  ['core.imageFromURL (canvas.ts)', (url: string, opts?: Record<string, unknown>) => core.imageFromURL(url, opts)],
  ['imageFromURL (factory.ts)', (url: string, opts?: Record<string, unknown>) => factoryImageFromURL(url, opts)],
] as const

describe.each(loaders)('%s', (_label, load) => {
  it('isError=true 콜백이면 reject 한다', async () => {
    stubFromURLFailure(true)
    await expect(load(SIGNED_URL)).rejects.toThrow('이미지 로드 실패')
  })

  it('isError 없이 0×0 결과가 와도 reject 한다', async () => {
    stubFromURLFailure(undefined)
    await expect(load(SIGNED_URL)).rejects.toThrow('이미지 로드 실패')
  })

  it('오류 메시지에 쿼리스트링·해시가 없고 URL 앞부분만 담는다', async () => {
    stubFromURLFailure(true)
    const err = await load(SIGNED_URL).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('https://cdn.example.com/storage/a/b/photo.jpg')
    expect(err!.message).not.toContain('SECRET_TOKEN_VALUE')
    expect(err!.message).not.toContain('token=')
    expect(err!.message).not.toContain('frag')
  })

  it('실제 fabric 로드(1×1 PNG)는 resolve 하고 옵션을 반영한다', async () => {
    const img = await load(PNG_1X1, { left: 7, crossOrigin: 'anonymous' })
    expect(img.width).toBe(1)
    expect(img.height).toBe(1)
    expect(img.left).toBe(7)
  })

  it('실제 fabric 로드 실패(깨진 data URL)는 reject 한다', async () => {
    // fabric.log·jsdom 리소스 오류 로그는 예상된 출력이라 숨긴다.
    vi.spyOn(fabric, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(load('data:image/png;base64,AAAA')).rejects.toThrow('이미지 로드 실패: data:image/png')
  })
})

describe('summarizeImageUrl', () => {
  it('쿼리·해시를 버린다', () => {
    expect(summarizeImageUrl(SIGNED_URL)).toBe('https://cdn.example.com/storage/a/b/photo.jpg')
  })

  it('data URL 은 mime 까지만 남긴다', () => {
    expect(summarizeImageUrl(PNG_1X1)).toBe('data:image/png')
  })

  it('긴 경로는 80자로 자른다', () => {
    const long = `https://cdn.example.com/${'x'.repeat(200)}.png`
    const s = summarizeImageUrl(long)
    expect(s.length).toBe(81)
    expect(s.endsWith('…')).toBe(true)
  })

  it('빈 값·비문자열은 자리표시로 바꾼다', () => {
    expect(summarizeImageUrl('')).toBe('(빈 URL)')
    expect(summarizeImageUrl(undefined)).toBe('(빈 URL)')
  })
})
