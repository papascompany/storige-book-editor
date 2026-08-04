// curveText 유틸 테스트 — S-E3 곡선(패스) 텍스트
//
// 고정하는 계약:
//  (1) 아크 수식은 TextEffect 06-02 원본과 동일 (이동 리팩터링 — 동작 불변 증명)
//  (2) 웨이브는 위상 반전(direction)과 진폭/폭 하한이 성립
//  (3) applyCurveToText 가 저장 왕복에 필요한 직렬화 속성 전부를 세팅
//  (4) 신규 직렬화 속성 curvePathType 이 extendFabricOption 에 등재 (L7 침묵 소실 함정)
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'

// fabric 은 node 환경에서 native canvas 바인딩을 요구 → mock (pointerShift.test 전례)
vi.mock('fabric', () => ({ fabric: {} }))
vi.mock('./factory', () => ({
  getFabric: vi.fn(async () => ({
    util: { getPathSegmentsInfo: vi.fn((_p: unknown) => [{ length: 100 }]) },
  })),
  createPath: vi.fn(async (pathData: string, options: Record<string, unknown>) => ({
    ...options,
    path: pathData,
    type: 'path',
  })),
}))

import {
  generateArcPathData,
  generateWavePathData,
  generateCurvePathData,
  applyCurveToText,
  removeCurveFromText,
  radiusForTextOnArc,
} from './curveText'

// TextEffect.tsx 06-02 원본 수식 (검증 기준 사본 — 이동 전 동작의 golden)
function legacyGeneratePathData(r: number, reverse: boolean = false, deg: number = 180): string {
  const d = Math.max(10, Math.min(deg, 350))
  const h = (d / 2) * (Math.PI / 180)
  const sx = r * Math.sin(h)
  const cy = r * Math.cos(h)
  const largeArc = d > 180 ? 1 : 0
  if (!reverse) {
    return `M ${-sx}, ${-cy} A ${r} ${r} 0 ${largeArc} 1 ${sx}, ${-cy}`
  }
  return `M ${-sx}, ${cy} A ${r} ${r} 0 ${largeArc} 0 ${sx}, ${cy}`
}

describe('generateArcPathData — TextEffect 원본 수식과 동일(이동 불변)', () => {
  const cases: Array<[number, boolean, number]> = [
    [200, false, 180], // 위 반원 (기본)
    [200, true, 180],  // 아래 반원
    [150, false, 320], // 원형 프리셋
    [80, false, 270],  // ¾
    [50, true, 30],    // 최소 근처
    [100, false, 350], // 상한
    [100, false, 5],   // 하한 클램프(→10)
    [100, false, 400], // 상한 클램프(→350)
  ]

  it.each(cases)('r=%s reverse=%s deg=%s', (r, reverse, deg) => {
    expect(generateArcPathData(r, reverse, deg)).toBe(legacyGeneratePathData(r, reverse, deg))
  })

  it('기본 인자 = 반원(180)', () => {
    expect(generateArcPathData(200)).toBe(legacyGeneratePathData(200, false, 180))
  })
})

describe('generateWavePathData', () => {
  it('상행(산 먼저): 첫 제어점 y 가 음수(캔버스 상단)', () => {
    const d = generateWavePathData(400, 40)
    // M -200 0 Q -100 -80 0 0 Q 100 80 200 0
    expect(d).toBe('M -200 0 Q -100 -80 0 0 Q 100 80 200 0')
  })

  it('reverse(골 먼저): 위상 반전 — 부호만 뒤집힘', () => {
    const d = generateWavePathData(400, 40, true)
    expect(d).toBe('M -200 0 Q -100 80 0 0 Q 100 -80 200 0')
  })

  it('폭 하한 20, 음수 진폭은 0 처리', () => {
    expect(generateWavePathData(5, -10)).toBe('M -10 0 Q -5 0 0 0 Q 5 0 10 0')
  })
})

describe('generateCurvePathData — 파라미터 라우팅', () => {
  it('arc 파라미터', () => {
    expect(
      generateCurvePathData({ pathType: 'arc', radius: 200, direction: 'downward', arcDeg: 270 })
    ).toBe(legacyGeneratePathData(200, true, 270))
  })

  it('wave 파라미터 (radius=진폭, width=폭)', () => {
    expect(
      generateCurvePathData({ pathType: 'wave', radius: 40, direction: 'upward', width: 400 })
    ).toBe(generateWavePathData(400, 40, false))
  })

  it('wave 에서 direction=downward 는 위상 반전', () => {
    expect(
      generateCurvePathData({ pathType: 'wave', radius: 40, direction: 'downward', width: 400 })
    ).toBe(generateWavePathData(400, 40, true))
  })
})

describe('applyCurveToText — 직렬화 속성 계약', () => {
  function makeTextStub(width = 300, scaleX = 1) {
    const attrs: Record<string, unknown> = { width, scaleX }
    return {
      ...attrs,
      set: vi.fn(function (this: Record<string, unknown>, values: Record<string, unknown>) {
        Object.assign(attrs, values)
      }),
      attrs,
    }
  }

  it('arc: extensionType/curve* 속성 + path 세팅', async () => {
    const obj = makeTextStub()
    await applyCurveToText(obj as never, {
      pathType: 'arc',
      radius: 180,
      direction: 'upward',
      arcDeg: 320,
    })

    const set = (obj.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(set.extensionType).toBe('curveText')
    expect(set.curvePathType).toBe('arc')
    expect(set.curveRadius).toBe(180)
    expect(set.curveDirection).toBe('upward')
    expect(set.curveArcDeg).toBe(320)
    expect(set.path).toBeTruthy()
    expect((set.path as { path: string }).path).toBe(legacyGeneratePathData(180, false, 320))
    // 기존 TextEffect 동작 보존: 텍스트 폭을 path width 로 전달
    expect((set.path as { width: number }).width).toBe(300)
    // segmentsInfo 선계산 (기존 동작 보존)
    expect((set.path as { segmentsInfo: unknown }).segmentsInfo).toBeTruthy()
  })

  it('wave: curveArcDeg 는 undefined, flip 은 pathSide 로', async () => {
    const obj = makeTextStub(400)
    await applyCurveToText(
      obj as never,
      { pathType: 'wave', radius: 40, direction: 'upward', width: 400 },
      { flip: 'right', charSpacing: 50 }
    )

    const set = (obj.set as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(set.curvePathType).toBe('wave')
    expect(set.curveArcDeg).toBeUndefined()
    expect(set.pathSide).toBe('right')
    expect(set.charSpacing).toBe(50)
  })
})

describe('removeCurveFromText', () => {
  it('path 해제 + 곡선 속성 초기화 + pathSide 원복', () => {
    const set = vi.fn()
    removeCurveFromText({ set } as never)
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        path: null,
        charSpacing: 0,
        extensionType: undefined,
        curvePathType: undefined,
        pathSide: 'left',
      })
    )
  })
})

describe('radiusForTextOnArc', () => {
  it('반원(180°): r = 텍스트폭/π (기존 calcRadius 와 동일 수식)', () => {
    expect(radiusForTextOnArc(628.3, 180)).toBeCloseTo(628.3 / Math.PI, 1)
  })

  it('원형(320°)은 반원보다 작은 반지름', () => {
    expect(radiusForTextOnArc(600, 320)).toBeLessThan(radiusForTextOnArc(600, 180))
  })

  it('하한 50 보장', () => {
    expect(radiusForTextOnArc(10, 180)).toBe(50)
  })
})

describe('직렬화 화이트리스트 등재 (L7 침묵 소실 함정 가드)', () => {
  it('curvePathType 이 extendFabricOption 소스에 등재돼 있다', () => {
    // canvas.ts 는 fabric 을 top-level import 라 직접 import 불가(테스트 env) → 소스 검사
    const src = readFileSync(fileURLToPath(new URL('./canvas.ts', import.meta.url)), 'utf-8')
    const start = src.indexOf('extendFabricOption = [')
    const whitelistBlock = src.slice(start, src.indexOf(']', start))
    expect(whitelistBlock).toContain("'curvePathType'")
    expect(whitelistBlock).toContain("'curveRadius'")
    expect(whitelistBlock).toContain("'curveDirection'")
    expect(whitelistBlock).toContain("'curveArcDeg'")
  })
})
