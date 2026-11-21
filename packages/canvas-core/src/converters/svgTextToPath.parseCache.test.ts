// @vitest-environment jsdom
//
// convertSvgTextToPath 글꼴 파싱 캐시 — 같은 버퍼는 한 번만 opentype.parse 한다.
// PDF 생성은 텍스트 객체마다 이 함수를 부르므로, 글자 객체가 많은 면(연달력 등)에서
// 매번 큰 한글 글꼴을 다시 파싱하던 비용을 없앤다. 출력은 캐시 전후 동일해야 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { convertSvgTextToPath, __resetParsedFontCacheForTest } from './svgTextToPath'

const { parseSpy } = vi.hoisted(() => {
  const makeFont = () => ({
    names: { fullName: { en: 'MockFont' } },
    unitsPerEm: 1000,
    getPath: (_t: string, x: number, y: number, size: number) => ({
      toPathData: () => `M ${x} ${y} L ${x + size} ${y}`,
    }),
    stringToGlyphs: (t: string) => t.split('').map(() => ({ advanceWidth: 500 })),
  })
  return { parseSpy: vi.fn((_buf: ArrayBuffer) => makeFont()) }
})

vi.mock('opentype.js', () => ({ parse: parseSpy, default: { parse: parseSpy } }))

const svgOf = (text: string) =>
  `<g transform="matrix(1 0 0 1 10 20)"><text font-family="Mock" font-size="12"><tspan x="0" y="4">${text}</tspan></text></g>`

beforeEach(() => {
  parseSpy.mockClear()
  __resetParsedFontCacheForTest()
})

describe('convertSvgTextToPath 글꼴 파싱 캐시', () => {
  it('같은 버퍼로 여러 번 불러도 파싱은 한 번만 한다', async () => {
    const buf = new ArrayBuffer(16)
    for (let i = 1; i <= 30; i++) {
      await convertSvgTextToPath(buf, svgOf(String(i)))
    }
    expect(parseSpy).toHaveBeenCalledTimes(1)
  })

  it('다른 버퍼(다른 글꼴)는 각각 파싱한다', async () => {
    await convertSvgTextToPath(new ArrayBuffer(16), svgOf('1'))
    await convertSvgTextToPath(new ArrayBuffer(16), svgOf('2'))
    expect(parseSpy).toHaveBeenCalledTimes(2)
  })

  it('캐시를 쓴 두 번째 호출의 출력이 첫 호출과 같다', async () => {
    const buf = new ArrayBuffer(16)
    const first = await convertSvgTextToPath(buf, svgOf('31'))
    const second = await convertSvgTextToPath(buf, svgOf('31'))
    expect(second.svg).toBe(first.svg)
    expect(second.svg).toContain('<path')
    expect(second.font).toBe(first.font)
  })
})
