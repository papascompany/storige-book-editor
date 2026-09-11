// @vitest-environment jsdom
//
// FontPlugin.createFontCSS — A-1 「동일 CSS 재기입 스킵」 회귀 테스트.
//
// 배경: createFontCSS 는 <style id="dynamic-font-faces"> 를 쓴 뒤 항상 rAF + 300ms 를
// 기다리고 resolve 했다. 이 메서드는 **생성자에서만** 호출되므로, 같은 폰트 목록으로
// FontPlugin 이 재생성되면(에디터 재초기화·StrictMode 이중 마운트) 이미 CSSOM 에 있는
// 것과 바이트 동일한 CSS 를 다시 쓰고 300ms 를 또 기다린다.
//
// 증명 대상:
//  ① 최초 호출은 <style> 을 만들어 @font-face 를 쓴다
//  ② 같은 목록으로 다시 호출하면 DOM 노드를 건드리지 않고 **마이크로태스크 안에** resolve
//     (= rAF+300ms 정착 대기를 타지 않는다)
//  ③ 스킵 경로에서도 fontUrlByName(이름 정규화 변형 → URL)은 정상 구성된다
//     — 스킵 검사가 forEach 뒤에 있어야 하는 이유. 앞으로 올리면 맵이 빈 채 남는다
//  ④ 목록이 달라지면 스킵하지 않고 재기입한다
//
// createFontCSS 는 private 이고 this 에서 fontUrlByName 하나만 쓴다. 생성자는 네트워크를
// 타는 preloadEssentialFonts 를 이어 부르므로, 인스턴스 대신 프로토타입 메서드를 최소 컨텍스트에
// 바인딩해 호출한다(테스트 대상 = 이 메서드 하나).
import { describe, it, expect, beforeEach } from 'vitest'
import FontPlugin from './FontPlugin'

type FontSource = { name: string; src: string }
type Ctx = { fontUrlByName: Map<string, string> }

type WithCreateFontCSS = { createFontCSS(this: Ctx, arr: FontSource[]): Promise<void> }

const createFontCSS = (ctx: Ctx, arr: FontSource[]): Promise<void> =>
  (FontPlugin.prototype as unknown as WithCreateFontCSS).createFontCSS.call(ctx, arr)

const newCtx = (): Ctx => ({ fontUrlByName: new Map<string, string>() })

const styleEl = () => document.getElementById('dynamic-font-faces') as HTMLStyleElement | null

/** 프라미스가 "타이머 없이" 정착했는지 본다 — 마이크로태스크만 비운 뒤 판정. */
const settledWithoutTimers = async (p: Promise<void>): Promise<boolean> => {
  let settled = false
  void p.then(() => {
    settled = true
  })
  await Promise.resolve()
  await Promise.resolve()
  return settled
}

const FONTS: FontSource[] = [
  { name: '나눔고딕', src: 'https://cdn.example/nanum-gothic.woff2' },
  { name: 'Pretendard', src: 'https://cdn.example/pretendard.woff2' }
]

describe('FontPlugin.createFontCSS — 동일 CSS 재기입 스킵 (A-1)', () => {
  beforeEach(() => {
    styleEl()?.remove()
  })

  it('최초 호출은 style 노드를 만들고 @font-face 를 기입한다', async () => {
    expect(styleEl()).toBeNull()

    await createFontCSS(newCtx(), FONTS)

    const style = styleEl()
    expect(style).not.toBeNull()
    expect(style!.textContent).toContain('@font-face')
    expect(style!.textContent).toContain('https://cdn.example/nanum-gothic.woff2')
    expect(style!.textContent).toContain('https://cdn.example/pretendard.woff2')
  })

  it('같은 목록 재호출은 DOM 을 건드리지 않고 정착 대기 없이 resolve 한다', async () => {
    await createFontCSS(newCtx(), FONTS)

    const style = styleEl()!
    const before = style.textContent

    // 재기입 여부를 노드 정체성이 아니라 실제 대입으로 판정한다 —
    // 같은 노드에 같은 문자열을 다시 써도 스킵이 아니기 때문이다.
    let writes = 0
    const desc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')!
    Object.defineProperty(style, 'textContent', {
      configurable: true,
      get: () => desc.get!.call(style),
      set: (v: string) => {
        writes += 1
        desc.set!.call(style, v)
      }
    })

    try {
      const fast = await settledWithoutTimers(createFontCSS(newCtx(), FONTS))
      expect(fast).toBe(true)
      expect(writes).toBe(0)
    } finally {
      delete (style as unknown as Record<string, unknown>).textContent
    }

    expect(styleEl()).toBe(style)
    expect(styleEl()!.textContent).toBe(before)
  })

  it('스킵 경로에서도 fontUrlByName 은 정상 구성된다', async () => {
    await createFontCSS(newCtx(), FONTS)

    const ctx = newCtx()
    const fast = await settledWithoutTimers(createFontCSS(ctx, FONTS))
    expect(fast).toBe(true)

    // NFC/NFD 변형이 모두 등재된다(한글은 두 변형이 다르다)
    expect(ctx.fontUrlByName.get('나눔고딕'.normalize('NFC'))).toBe(
      'https://cdn.example/nanum-gothic.woff2'
    )
    expect(ctx.fontUrlByName.get('나눔고딕'.normalize('NFD'))).toBe(
      'https://cdn.example/nanum-gothic.woff2'
    )
    expect(ctx.fontUrlByName.get('Pretendard')).toBe('https://cdn.example/pretendard.woff2')
  })

  it('목록이 달라지면 스킵하지 않고 재기입한다', async () => {
    await createFontCSS(newCtx(), FONTS)

    const next: FontSource[] = [...FONTS, { name: 'Noto Sans', src: 'https://cdn.example/noto.woff2' }]
    const fast = await settledWithoutTimers(createFontCSS(newCtx(), next))
    expect(fast).toBe(false)

    await createFontCSS(newCtx(), next)
    expect(styleEl()!.textContent).toContain('https://cdn.example/noto.woff2')
  })

  it('웹폰트가 없는 목록(시스템 폰트만)은 style 을 만들지 않고 즉시 resolve 한다', async () => {
    const fast = await settledWithoutTimers(
      createFontCSS(newCtx(), [{ name: 'Arial', src: 'ignored' }])
    )
    expect(fast).toBe(true)
    expect(styleEl()).toBeNull()
  })
})
