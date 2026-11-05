// @vitest-environment jsdom
//
// FontPlugin — 미등록 폰트 패밀리의 기본 폰트 대체(별칭 폴백) 회귀 테스트.
//
// 배경(2026-11-05): fontFamily 가 라이브러리에 없으면(fabric 기본 'Times New Roman', 로드 실패
// 폴백 'Arial, sans-serif', 비활성화된 폰트) getTtfBuffer 가 'WOFF2 font URL not found' 로 throw →
// convertTextToPath null → ServicePlugin 이 화면 2배 래스터(PNG)로 폴백했다(인쇄 해상도 미달,
// 사용자 안내 없음).
//
// 증명 대상:
//  ① resolveFontFamily: 미등록 → 기본 폰트, 등록 → 그대로, 대체 시 fontSubstituted 1회 발행
//  ② getTtfBuffer: 미등록 패밀리는 기본 폰트 파일을 받아 벡터화 가능(요청 이름으로 캐시)
//  ③ 기본 폰트가 미등록(목록 미로드)이면 대체하지 않고 종전처럼 throw(이벤트 없음)
//
// 생성자는 네트워크(preloadEssentialFonts)를 타므로 프로토타입을 상속한 최소 컨텍스트에
// 필드만 채워 메서드를 호출한다(FontPlugin.fontCss.test.ts 와 같은 기법).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import FontPlugin, { FONT_SUBSTITUTED_EVENT } from './FontPlugin'

const DEFAULT = '본고딕(Noto Sans) Regular'
const DEFAULT_URL = 'https://cdn.example/noto-sans-kr-regular.otf'
const NANUM_URL = 'https://cdn.example/nanum-gothic.otf'

type Ctx = FontPlugin & {
  fontUrlByName: Map<string, string>
  defaultFontName: string
  substitutions: Map<string, string>
  ttfBufferCache: Map<string, ArrayBuffer>
  ttfBufferFailed: Set<string>
  _editor: { emit: ReturnType<typeof vi.fn> }
  getTtfBuffer(fontFamily: string): Promise<ArrayBuffer>
}

const variants = (name: string): string[] => {
  const nfc = name.normalize('NFC')
  const nfd = name.normalize('NFD')
  return nfc === nfd ? [nfc] : [nfc, nfd]
}

const makeCtx = (registered: Array<[string, string]>): Ctx => {
  const ctx = Object.create(FontPlugin.prototype) as Ctx
  ctx.fontUrlByName = new Map()
  for (const [name, url] of registered) for (const v of variants(name)) ctx.fontUrlByName.set(v, url)
  ctx.defaultFontName = DEFAULT
  ctx.substitutions = new Map()
  ctx.ttfBufferCache = new Map()
  ctx.ttfBufferFailed = new Set()
  ctx._editor = { emit: vi.fn() }
  return ctx
}

const fetchedUrls: string[] = []

beforeEach(() => {
  fetchedUrls.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchedUrls.push(url)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
      }
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('FontPlugin.resolveFontFamily — 미등록 패밀리 → 기본 폰트', () => {
  it('등록 폰트는 그대로 해석하고 이벤트를 내지 않는다', () => {
    const ctx = makeCtx([[DEFAULT, DEFAULT_URL], ['나눔고딕', NANUM_URL]])
    const r = ctx.resolveFontFamily('나눔고딕'.normalize('NFC'))
    expect(r.family).toBe('나눔고딕'.normalize('NFC'))
    expect(r.substituted).toBe(false)
    expect(ctx._editor.emit).not.toHaveBeenCalled()
    expect(ctx.getFontSubstitutions()).toEqual([])
  })

  it("'Times New Roman' 은 기본 폰트로 대체되고 fontSubstituted 를 요청 패밀리당 1회만 발행한다", () => {
    const ctx = makeCtx([[DEFAULT, DEFAULT_URL]])

    const first = ctx.resolveFontFamily('Times New Roman')
    expect(first).toMatchObject({ family: DEFAULT, registered: false, substituted: true })
    expect(ctx._editor.emit).toHaveBeenCalledTimes(1)
    expect(ctx._editor.emit).toHaveBeenCalledWith(FONT_SUBSTITUTED_EVENT, {
      requested: 'Times New Roman',
      applied: DEFAULT
    })

    // 같은 패밀리(CSS 목록 표기 차이 포함)는 재발행하지 않는다
    ctx.resolveFontFamily('Times New Roman')
    ctx.resolveFontFamily('"Times New Roman", serif')
    expect(ctx._editor.emit).toHaveBeenCalledTimes(1)

    // 다른 패밀리는 따로 1회
    ctx.resolveFontFamily('Arial, sans-serif')
    expect(ctx._editor.emit).toHaveBeenCalledTimes(2)
    expect(ctx.getFontSubstitutions()).toEqual([
      { requested: 'Times New Roman', applied: DEFAULT },
      { requested: 'Arial', applied: DEFAULT }
    ])
  })

  it('기본 폰트도 미등록(목록 미로드)이면 대체하지 않는다', () => {
    const ctx = makeCtx([])
    const r = ctx.resolveFontFamily('Times New Roman')
    expect(r).toMatchObject({ family: 'Times New Roman', substituted: false })
    expect(ctx._editor.emit).not.toHaveBeenCalled()
  })
})

describe('FontPlugin.getTtfBuffer — 미등록 패밀리도 기본 폰트 파일로 벡터화 가능', () => {
  it('미등록 패밀리는 기본 폰트 OTF 를 받아오고 요청 이름으로 캐시한다', async () => {
    const ctx = makeCtx([[DEFAULT, DEFAULT_URL]])

    const buf = await ctx.getTtfBuffer('Times New Roman')
    expect(buf.byteLength).toBe(4)
    expect(fetchedUrls).toEqual([DEFAULT_URL])
    expect(ctx.ttfBufferCache.has('Times New Roman')).toBe(true)
    expect(ctx.ttfBufferFailed.size).toBe(0)
    expect(ctx._editor.emit).toHaveBeenCalledTimes(1)

    // 두 번째 호출은 캐시 — 네트워크 재요청 없음
    await ctx.getTtfBuffer('Times New Roman')
    expect(fetchedUrls).toEqual([DEFAULT_URL])
  })

  it('등록 패밀리는 자기 파일을 받아온다(대체 없음)', async () => {
    const ctx = makeCtx([[DEFAULT, DEFAULT_URL], ['나눔고딕', NANUM_URL]])
    await ctx.getTtfBuffer('나눔고딕'.normalize('NFD'))
    expect(fetchedUrls).toEqual([NANUM_URL])
    expect(ctx._editor.emit).not.toHaveBeenCalled()
  })

  it('기본 폰트도 미등록이면 종전처럼 URL 없음으로 실패하고 음수 캐시에 남긴다', async () => {
    const ctx = makeCtx([])
    await expect(ctx.getTtfBuffer('Times New Roman')).rejects.toThrow('WOFF2 font URL not found')
    expect(fetchedUrls).toEqual([])
    expect(ctx.ttfBufferFailed.has('Times New Roman')).toBe(true)
    expect(ctx._editor.emit).not.toHaveBeenCalled()
  })
})
