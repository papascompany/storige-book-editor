// @vitest-environment jsdom
//
// 곡선(패스) 텍스트 → PDF 벡터화(svgTextToPath) 회귀 테스트 — R9 (2026-08-11)
//
// fabric 5.x 는 path(text-on-path) 텍스트를 SVG 로 낼 때 글자별 <tspan x y rotate> 를
// 방출한다(dist _createTextCharSpan 의 renderLeft 분기). convertSvgTextToPath 는 이
// tspan 을 opentype 아웃라인 <path> 로 바꾸면서 rotate 를 (x,y) 기준 transform 으로
// 이관해야 PDF 에서도 호를 따라 글자가 회전된다 (P1-6, 2026-06-02 — 기존엔 무테스트).
//
// ⚠️ 이 테스트가 적발한 실결함(R9 에서 수정): fabric 5.5.2 Text#toSVG 는 path 가 있으면
// <g>(텍스트) + <g id="curveText">(가이드 패스) "루트 2개" 프래그먼트를 반환한다.
// XML 다중 루트는 파스 에러 → convertSvgTextToPath 가 즉시 throw → FontPlugin catch
// → null → ServicePlugin 래스터(PNG) 폴백. 즉 곡선 텍스트는 도입 이래 벡터화가
// 실행조차 안 됐다. 수정: 파스 실패 시 <svg> 루트로 감싸 재파싱(래퍼는 출력 유지).
//
// 고정하는 계약:
//  (1) fabric text-on-path 가 글자별 tspan rotate + 루트 2개 프래그먼트를 방출한다
//      (전제 고정 — fabric 업그레이드로 방출 형태가 바뀌면 여기서 먼저 적발)
//  (2) 루트 2개 프래그먼트에서도 throw 없이 벡터화가 완주된다 (결함 회귀 가드)
//  (3) 각 글리프 회전이 rotate(deg x y) transform 으로 보존된다
//  (4) 아웃라인이 tspan (x,y) 기준선·상속 폰트크기로 생성된다 (좌표 정확성)
//  (5) font-family 는 정리(cleanFontFamilyValue)된 이름으로 리졸버에 전달되고
//      해당 폰트로 아웃라인한다 — 미해결 시 기본 폰트 폴백(throw 금지, export 보호)
//  (6) 회전 없는 일반 텍스트는 transform 이 붙지 않는다 (비곡선 무영향)
//
// 폰트는 목(opentype.js mock) — 실 TTF 없이 좌표/회전/폰트선택 계약만 고정한다.
// jsdom per-file 환경: convertSvgTextToPath 가 DOMParser/document/XMLSerializer 를 쓴다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fabric } from 'fabric'
import { applyCurveToText } from '../utils/curveText'
import { convertSvgTextToPath } from './svgTextToPath'

// ---------------------------------------------------------------------------
// opentype.js 목 — getPath 호출 인자를 기록하고, 좌표를 pathData 에 그대로 새겨
// 출력 <path d> 만으로 좌표 정확성을 단언할 수 있게 한다.
// ---------------------------------------------------------------------------
const { otState, makeMockFont } = vi.hoisted(() => {
  const makeMockFont = (name: string) => {
    const calls: Array<{ text: string; x: number; y: number; fontSize: number }> = []
    return {
      mockName: name,
      calls,
      names: { fullName: { en: name } },
      unitsPerEm: 1000,
      getPath(text: string, x: number, y: number, fontSize: number) {
        calls.push({ text, x, y, fontSize })
        return { toPathData: (_digits: number) => `M ${x} ${y} L ${x + fontSize} ${y}` }
      },
      stringToGlyphs(t: string) {
        return t.split('').map(() => ({ advanceWidth: 500 }))
      },
    }
  }
  const otState = { base: null as ReturnType<typeof makeMockFont> | null }
  return { otState, makeMockFont }
})

vi.mock('opentype.js', () => {
  const parse = (_buf: ArrayBuffer) => {
    otState.base = makeMockFont('MockBase')
    return otState.base
  }
  return { parse, default: { parse } }
})

const TTF = new ArrayBuffer(8)
const parseXml = (svg: string) => new DOMParser().parseFromString(svg, 'image/svg+xml')
// fabric 프래그먼트(루트 2개 가능)를 테스트에서 조회하기 위한 래핑 파서
const parseFragment = (svg: string) =>
  parseXml(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`)

/** 변환 결과에서 글리프 아웃라인 path 만 추출 (fabric 이 함께 방출한 가이드 패스 제외) */
const glyphPaths = (doc: ReturnType<typeof parseXml>) =>
  Array.from(doc.querySelectorAll('path')).filter(
    (p) => p.parentElement?.getAttribute('id') !== 'curveText'
  )

/** 실 fabric IText + 실 applyCurveToText(반원 arc)로 곡선 텍스트 SVG 를 만든다 */
async function makeCurvedTextSvg(): Promise<string> {
  const t = new fabric.IText('CURVE', {
    fontSize: 40,
    fontFamily: 'Nanum Gothic',
    fill: '#ff0000',
  })
  await applyCurveToText(t as unknown as fabric.Object, {
    pathType: 'arc',
    radius: 150,
    direction: 'upward',
    arcDeg: 180,
  })
  return t.toSVG()
}

beforeEach(() => {
  otState.base = null
})

describe('전제 고정 — fabric 5.x text-on-path 의 SVG 방출 형태', () => {
  it('루트 2개 프래그먼트(텍스트 g + 가이드 패스 g#curveText)를 방출한다', async () => {
    const svg = await makeCurvedTextSvg()
    // 다중 루트라 그대로는 XML 파스 에러 — 래핑 재파싱 수정의 존재 이유
    // (fabric 업그레이드로 단일 루트가 되면 이 핀이 깨져 래퍼 제거 시점을 알려준다)
    expect(parseXml(svg).querySelector('parsererror')).toBeTruthy()

    const roots = Array.from(parseFragment(svg).documentElement.children)
    expect(roots.length).toBe(2)
    expect(roots[1].getAttribute('id')).toBe('curveText')
    expect(roots[1].querySelector('path')).toBeTruthy()
  })

  it('글자별 tspan 에 x/y/rotate 가 붙고 회전값이 글자마다 다르다', async () => {
    const svg = await makeCurvedTextSvg()
    const tspans = Array.from(parseFragment(svg).querySelectorAll('tspan'))
    // path 텍스트는 글자 단위 방출 (C U R V E)
    expect(tspans.length).toBe(5)
    for (const ts of tspans) {
      expect(Number.isFinite(parseFloat(ts.getAttribute('x') ?? ''))).toBe(true)
      expect(Number.isFinite(parseFloat(ts.getAttribute('y') ?? ''))).toBe(true)
      expect(Number.isFinite(parseFloat(ts.getAttribute('rotate') ?? ''))).toBe(true)
    }
    // 반원 위 글리프 회전은 좌→우 진행하며 달라진다 (전부 동일하면 회전 미방출 의심)
    const rotations = tspans.map((ts) => parseFloat(ts.getAttribute('rotate') ?? '0'))
    expect(new Set(rotations.map((r) => r.toFixed(1))).size).toBeGreaterThan(1)
  })
})

describe('곡선 글리프 변환 — 회전·좌표·구조 보존', () => {
  it('루트 2개 프래그먼트에서 throw 없이 완주하고 가이드 패스를 보존한다 (결함 회귀 가드)', async () => {
    const svg = await makeCurvedTextSvg()
    const guideD = parseFragment(svg).querySelector('#curveText path')?.getAttribute('d')
    expect(guideD).toBeTruthy()

    // 수정 전: 여기서 'SVG parsing error: … only one root' throw → 래스터 폴백
    const { svg: out } = await convertSvgTextToPath(TTF, svg)
    const doc = parseXml(out) // 출력은 <svg> 루트로 감싸져 단일 루트 — 그대로 파스 가능

    expect(doc.querySelector('parsererror')).toBeNull()
    expect(doc.querySelectorAll('text').length).toBe(0) // 텍스트 요소는 전부 아웃라인으로 대체
    expect(glyphPaths(doc).length).toBe(5)
    // 비가시 가이드 패스(fill none·strokeWidth 0)는 원형 그대로 유지
    expect(doc.querySelector('#curveText path')?.getAttribute('d')).toBe(guideD)
  })

  it('각 tspan rotate 가 (x,y) 기준 path transform 으로 이관된다', async () => {
    const svg = await makeCurvedTextSvg()
    const srcTspans = Array.from(parseFragment(svg).querySelectorAll('tspan'))

    const { svg: out } = await convertSvgTextToPath(TTF, svg)
    const paths = glyphPaths(parseXml(out))
    expect(paths.length).toBe(srcTspans.length)

    paths.forEach((p, i) => {
      const ts = srcTspans[i]
      const [x, y, deg] = ['x', 'y', 'rotate'].map((a) => parseFloat(ts.getAttribute(a) ?? ''))
      const m = /^rotate\((-?[\d.]+) (-?[\d.]+) (-?[\d.]+)\)$/.exec(
        p.getAttribute('transform') ?? ''
      )
      expect(m, `glyph ${i}("${ts.textContent}") transform`).toBeTruthy()
      expect(parseFloat(m![1])).toBeCloseTo(deg, 5)
      expect(parseFloat(m![2])).toBeCloseTo(x, 5)
      expect(parseFloat(m![3])).toBeCloseTo(y, 5)
    })
  })

  it('아웃라인은 tspan (x,y) 기준선 + 부모 상속 폰트크기로 생성된다 (좌표 정확성)', async () => {
    const svg = await makeCurvedTextSvg()
    const srcTspans = Array.from(parseFragment(svg).querySelectorAll('tspan'))

    const { svg: out } = await convertSvgTextToPath(TTF, svg)

    const base = otState.base
    expect(base).toBeTruthy()
    expect(base!.calls.length).toBe(srcTspans.length)
    base!.calls.forEach((c, i) => {
      const ts = srcTspans[i]
      expect(c.text).toBe(ts.textContent)
      expect(c.x).toBeCloseTo(parseFloat(ts.getAttribute('x') ?? ''), 5)
      expect(c.y).toBeCloseTo(parseFloat(ts.getAttribute('y') ?? ''), 5)
      expect(c.fontSize).toBe(40) // <text font-size="40"> 상속 (tspan 자체엔 없음)
    })

    // 목이 좌표를 새긴 pathData 가 d 로 그대로 실린다
    const paths = glyphPaths(parseXml(out))
    paths.forEach((p, i) => {
      const { x, y } = base!.calls[i]
      expect(p.getAttribute('d')).toBe(`M ${x} ${y} L ${x + 40} ${y}`)
    })
  })

  it('객체 배치 행렬(부모 g transform)은 변환 후에도 보존된다', async () => {
    const svg = await makeCurvedTextSvg()
    const srcTransform = parseFragment(svg)
      .querySelector('g[transform]')
      ?.getAttribute('transform')
    expect(srcTransform).toBeTruthy()

    const { svg: out } = await convertSvgTextToPath(TTF, svg)
    expect(parseXml(out).querySelector('g[transform]')?.getAttribute('transform')).toBe(
      srcTransform
    )
  })
})

describe('폰트 패밀리 정리 + 리졸버 (혼합폰트 runs 계약)', () => {
  it('부모 <text font-family> 를 정리된 이름으로 리졸브해 그 폰트로 아웃라인한다', async () => {
    const svg = await makeCurvedTextSvg()
    const nanum = makeMockFont('NanumMock')
    const resolver = vi.fn((family: string) => (family === 'Nanum Gothic' ? nanum : null))

    await convertSvgTextToPath(TTF, svg, resolver)

    // 따옴표/폴백목록 없는 정리된 첫 패밀리명으로 호출
    expect(resolver).toHaveBeenCalledWith('Nanum Gothic')
    expect(nanum.calls.length).toBe(5)
    expect(otState.base!.calls.length).toBe(0) // 기본 폰트 미사용
  })

  it("tspan style 의 \"'패밀리', sans-serif\" 형태도 첫 패밀리명으로 정리해 리졸브한다", async () => {
    const myeongjo = makeMockFont('MyeongjoMock')
    const resolver = vi.fn((family: string) => (family === 'Nanum Myeongjo' ? myeongjo : null))

    await convertSvgTextToPath(
      TTF,
      FIX(
        `<tspan x="0" y="0" rotate="15" style="font-family: 'Nanum Myeongjo', sans-serif; fill: rgb(0,0,0);">가</tspan>`
      ),
      resolver
    )

    expect(resolver).toHaveBeenCalledWith('Nanum Myeongjo')
    expect(myeongjo.calls.length).toBe(1)
  })

  it('리졸버 미해결 시 기본 폰트로 폴백하고 throw 없이 완주한다 (export 보호)', async () => {
    const svg = await makeCurvedTextSvg()
    const resolver = vi.fn(() => null)

    const { svg: out } = await convertSvgTextToPath(TTF, svg, resolver)

    expect(otState.base!.calls.length).toBe(5)
    expect(glyphPaths(parseXml(out)).length).toBe(5)
  })
})

// fabric 방출 형태를 모사한 수제 픽스처 — 결정적 경계값 단언용 (단일 루트)
const FIX = (tspans: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1 0 0 1 200 200)">` +
  `<text xml:space="preserve" font-family="Nanum Gothic" font-size="40" ` +
  `style="stroke: none; stroke-width: 1; fill: rgb(255,0,0); opacity: 1; white-space: pre;">` +
  `${tspans}</text></g></svg>`

describe('수제 픽스처 — 경계값·비곡선 무영향', () => {
  it('rotate 절대값이 그대로 이관된다: rotate="-45.5" x="-100.5" y="-20.25"', async () => {
    const { svg: out } = await convertSvgTextToPath(
      TTF,
      FIX('<tspan x="-100.5" y="-20.25" rotate="-45.5">A</tspan>')
    )
    const p = parseXml(out).querySelector('path')
    expect(p?.getAttribute('transform')).toBe('rotate(-45.5 -100.5 -20.25)')
    expect(p?.getAttribute('d')).toBe('M -100.5 -20.25 L -60.5 -20.25') // x+fontSize(40)
  })

  it('rotate 미부착·"0"·미세값(|deg|≤0.001)·비수치는 transform 을 만들지 않는다 (일반 텍스트 무영향)', async () => {
    const { svg: out } = await convertSvgTextToPath(
      TTF,
      FIX(
        '<tspan x="0" y="0">A</tspan>' +
          '<tspan x="10" y="0" rotate="0">B</tspan>' +
          '<tspan x="20" y="0" rotate="0.0005">C</tspan>' +
          '<tspan x="30" y="0" rotate="abc">D</tspan>'
      )
    )
    const paths = Array.from(parseXml(out).querySelectorAll('path'))
    expect(paths.length).toBe(4)
    for (const p of paths) {
      expect(p.hasAttribute('transform')).toBe(false)
    }
  })

  it('혼합 스타일 곡선: per-tspan fill 이 회전과 함께 보존되고, 없으면 부모 fill 폴백', async () => {
    const { svg: out } = await convertSvgTextToPath(
      TTF,
      FIX(
        '<tspan x="0" y="0" style="fill: rgb(0,0,255);" rotate="30">A</tspan>' +
          '<tspan x="10" y="0" rotate="-30">B</tspan>'
      )
    )
    const paths = Array.from(parseXml(out).querySelectorAll('path'))
    expect(paths.length).toBe(2)
    expect(paths[0].getAttribute('fill')).toBe('rgb(0,0,255)')
    expect(paths[0].getAttribute('transform')).toBe('rotate(30 0 0)')
    expect(paths[1].getAttribute('fill')).toBe('rgb(255,0,0)')
    expect(paths[1].getAttribute('transform')).toBe('rotate(-30 10 0)')
  })

  it('공백 tspan 은 스킵된다 (빈 아웃라인 미생성)', async () => {
    const { svg: out } = await convertSvgTextToPath(
      TTF,
      FIX(
        '<tspan x="0" y="0" rotate="10">A</tspan>' +
          '<tspan x="10" y="0" rotate="20"> </tspan>' +
          '<tspan x="20" y="0" rotate="30">B</tspan>'
      )
    )
    expect(parseXml(out).querySelectorAll('path').length).toBe(2)
  })
})
