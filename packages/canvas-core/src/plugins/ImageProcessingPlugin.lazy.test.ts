// ImageProcessingPlugin lazy 초기화 회귀 테스트 (D-6b① 2026-07-15 · D-12d 2026-08-06)
//
// 검증 대상:
//  (1) 생성자가 어떤 네트워크/무거운 초기화도 트리거하지 않는다.
//      — 기존엔 생성자가 startService() 를 즉시 실행해 ONNX 모델(≈88MB)+
//        ort wasm(≈23MB)을 모든 에디터/embed 캔버스 생성 시마다 다운로드했다.
//  (2) [R7 2026-08-11 갱신] cv 레거시 표면(ensureCvReady 등)이 존재하지 않고,
//      정밀 경로(createPrecisePathFromObject)는 cv 없이 순수 JS 로 완주한다.
//  (3) **D-12d 라이선스 잠금**: 브라우저 배경제거(@imgly/background-removal, AGPL-3.0)가
//      다시 들어오지 않는다 — getForeground() 부재 + package.json 의존 부재로 잠근다.
//      추론은 서버(rembg 사이드카)가 하고 진입점은 editor 의 api/cutout.ts 다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock
// (Editor.dispose.test.ts / AccessoryPlugin.leak.test.ts 와 동일 패턴)
// R7: createPrecisePathFromObject(순수 경로)가 쓰는 최소 표면(util.transformPoint/Point/Path)만 채운다.
vi.mock('fabric', () => ({
  fabric: {
    util: {
      transformPoint: (p: { x: number; y: number }, m: number[]) => ({
        x: m[0] * p.x + m[2] * p.y + m[4],
        y: m[1] * p.x + m[3] * p.y + m[5]
      })
    },
    Point: class {
      x: number
      y: number
      constructor(x: number, y: number) {
        this.x = x
        this.y = y
      }
    },
    Path: class {
      pathData: unknown
      constructor(pathData: unknown, options: Record<string, unknown>) {
        this.pathData = pathData
        Object.assign(this, options)
      }
    }
  }
}))

const { hotkeysMock } = vi.hoisted(() => {
  const fn: any = vi.fn()
  fn.unbind = vi.fn()
  return { hotkeysMock: fn }
})
vi.mock('hotkeys-js', () => ({ default: hotkeysMock }))

vi.mock('../contextMenu', () => ({
  default: class MockContextMenu {
    addMenu = vi.fn()
    dispose = vi.fn()
  }
}))

// openCv lazy-loader mock — R7 이후 플러그인은 openCv 를 임포트하지 않는다.
// 이 mock 은 회귀 tripwire 다: 누군가 cv 임포트/호출을 되살리면 아래
// `getCvMock).not.toHaveBeenCalled()` 잠금이 터진다.
const { getCvMock } = vi.hoisted(() => ({
  getCvMock: vi.fn(async () => ({ __mockCv: true }))
}))
vi.mock('../utils/openCv', () => ({
  getCv: getCvMock
}))

import ImageProcessingPlugin from './ImageProcessingPlugin'

function makePlugin() {
  const canvas: any = { getObjects: () => [] }
  const editor: any = { emit: vi.fn(), on: vi.fn(), getPlugin: vi.fn() }
  const plugin = new (ImageProcessingPlugin as any)(canvas, editor)
  return { plugin, canvas, editor }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ImageProcessingPlugin — lazy 초기화 (D-6b① · D-12d)', () => {
  it('생성자는 OpenCV 로드 등 어떤 무거운 초기화도 트리거하지 않는다', () => {
    makePlugin()

    expect(getCvMock).not.toHaveBeenCalled()
  })

  it('cv 레거시 표면이 존재하지 않는다 — R7 이식 잠금 (ensureCvReady/drawCaseOutlinePrecise/findLargestContour/getSimpleContourPoints)', () => {
    const { plugin } = makePlugin()

    expect((plugin as { ensureCvReady?: unknown }).ensureCvReady).toBeUndefined()
    expect((plugin as { drawCaseOutlinePrecise?: unknown }).drawCaseOutlinePrecise).toBeUndefined()
    expect((plugin as { findLargestContour?: unknown }).findLargestContour).toBeUndefined()
    expect((plugin as { getSimpleContourPoints?: unknown }).getSimpleContourPoints).toBeUndefined()
    expect(getCvMock).not.toHaveBeenCalled()
  })

  // ─────────────────────────────────────────────────────────────────
  // 모양컷 업로드 프리즈 회귀 잠금 (2026-08-06 프로덕션 실적발)
  //
  // 알파가 없는 이미지(= 일반 JPEG 사진)의 칼선은 createExpandedPath 로 끝나 OpenCV 가 전혀
  // 필요 없는데, 종전에는 getObjectPath/getObjectPathData 진입점에서 무조건 로드해
  // 10MB 파싱·컴파일이 메인 스레드를 점유했다 → 브라우저 '응답 없는 페이지'.
  // ─────────────────────────────────────────────────────────────────
  const makeItem = () => ({ type: 'image', id: 'img-1', getElement: () => ({ width: 8, height: 8 }) })

  it('알파 없는 이미지의 칼선은 OpenCV 를 로드하지 않는다 (프리즈 회귀 잠금)', async () => {
    const { plugin } = makePlugin()
    plugin.tellHasAlpha = vi.fn(() => false)
    plugin.createExpandedPath = vi.fn(() => ({ path: 'M 0 0 L 8 8' }))

    const pathData = await plugin.getObjectPathData(makeItem())

    expect(pathData).toBe('M 0 0 L 8 8')
    expect(plugin.createExpandedPath).toHaveBeenCalledTimes(1)
    expect(getCvMock).not.toHaveBeenCalled() // ★ 이 단언이 프리즈를 막는다
  })

  // ─────────────────────────────────────────────────────────────────
  // R7 (2026-08-11): 정밀 경로(createPrecisePathFromObject) 순수 JS 이식 잠금
  // — 순수 계산부의 상세 검증은 utils/preciseOutline.test.ts, 여기는 배선만 잠근다.
  // ─────────────────────────────────────────────────────────────────
  const makeRaster = (w: number, h: number, block: { x: number; y: number; size: number }) => {
    const data = new Uint8ClampedArray(w * h * 4)
    for (let y = block.y; y < block.y + block.size; y++)
      for (let x = block.x; x < block.x + block.size; x++) {
        const p = (y * w + x) * 4
        data[p] = 255
        data[p + 3] = 255
      }
    return { data, width: w, height: h }
  }

  it('createPrecisePathFromObject 는 cv 없이 순수 경로로 완주하고 계약(fabric.Path·scale)을 지킨다 — R7', async () => {
    const { plugin } = makePlugin()
    ;(plugin as any).readImageData = vi.fn(() => makeRaster(32, 32, { x: 8, y: 8, size: 16 }))
    const object: any = {
      width: 32,
      height: 32,
      scaleX: 2,
      scaleY: 2,
      toCanvasElement: vi.fn(() => ({ width: 32, height: 32 })),
      calcTransformMatrix: () => [1, 0, 0, 1, 0, 0]
    }

    const path = await plugin.createPrecisePathFromObject(object, {
      threshold: 128,
      insetPx: 2,
      multiplier: 1
    })

    expect(getCvMock).not.toHaveBeenCalled() // ★ cv 0회 — 정밀 경로도 순수 JS
    expect(path).toBeDefined()
    expect(typeof (path as any).pathData).toBe('string')
    expect((path as any).pathData).toContain('M')
    // 반환 계약: left/top 0 + scale = objectScale / multiplier (호출부 2곳이 소비)
    expect((path as any).left).toBe(0)
    expect((path as any).top).toBe(0)
    expect((path as any).scaleX).toBe(2)
    expect((path as any).scaleY).toBe(2)
  })

  it('정밀 경로 래스터는 장변 캡을 넘지 않는 배율로만 생성된다 — 해상도 폭발(b019994) 재발 잠금', async () => {
    const { plugin } = makePlugin()
    ;(plugin as any).readImageData = vi.fn(() => makeRaster(16, 16, { x: 4, y: 4, size: 8 }))
    const object: any = {
      width: 2560, // 마스크 이미지(이미 dpr×multiplier 곱해진 대형) 시나리오
      height: 2560,
      scaleX: 1,
      scaleY: 1,
      toCanvasElement: vi.fn(() => ({ width: 1280, height: 1280 })),
      calcTransformMatrix: () => [1, 0, 0, 1, 0, 0]
    }

    const path = await plugin.createPrecisePathFromObject(object, {
      threshold: 128,
      insetPx: 0,
      multiplier: 3
    })

    // 요청 3× 그대로면 7680px 래스터 — 캡 반영 배율(3 × 1280/7680 = 0.5)로만 호출해야 한다.
    expect(object.toCanvasElement).toHaveBeenCalledTimes(1)
    expect(object.toCanvasElement.mock.calls[0][0].multiplier).toBeCloseTo(0.5, 10)
    expect(object.toCanvasElement.mock.calls[0][0].enableRetinaScaling).toBe(false)
    // scale 계약은 캡과 무관하게 **요청 배율** 기준이다
    expect((path as any).scaleX).toBeCloseTo(1 / 3, 10)
    expect(getCvMock).not.toHaveBeenCalled()
  })

  it('전부 투명한 래스터면 undefined 를 반환한다 (종전 빈 윤곽 규약)', async () => {
    const { plugin } = makePlugin()
    ;(plugin as any).readImageData = vi.fn(() => ({
      data: new Uint8ClampedArray(8 * 8 * 4),
      width: 8,
      height: 8
    }))
    const object: any = {
      width: 8,
      height: 8,
      scaleX: 1,
      scaleY: 1,
      toCanvasElement: vi.fn(() => ({ width: 8, height: 8 })),
      calcTransformMatrix: () => [1, 0, 0, 1, 0, 0]
    }

    const path = await plugin.createPrecisePathFromObject(object, { threshold: 128 })

    expect(path).toBeUndefined()
    expect(getCvMock).not.toHaveBeenCalled()
  })

  it('컨투어 스캔 상한이 있고 hull 점 예산보다 작다', () => {
    const scan = (ImageProcessingPlugin as any).CONTOUR_SCAN_LIMIT
    const hull = (ImageProcessingPlugin as any).HULL_MAX_INPUT_POINTS
    expect(scan).toBeGreaterThan(0)
    expect(scan).toBeLessThanOrEqual(hull)
  })

  it('윤곽 입력 장변 캡 상수가 서버 산출물(2560)보다 작게 유지된다', () => {
    const cap = (ImageProcessingPlugin as any).CONTOUR_MAX_LONG_EDGE
    expect(cap).toBeGreaterThan(0)
    expect(cap).toBeLessThan(2560)
  })

  it('워커 추출 결과의 좌표 매핑은 smoothContour 와 동일 수식이다 (2026-08-07 워커 전환 회귀 잠금)', () => {
    const { plugin } = makePlugin()
    const object: any = { left: 10, top: 20, scaleX: 2, scaleY: 2 }
    // 캡 배율 2 → 원좌표 복원 후 (x+left)*scaleX
    const mapped = (plugin as any).mapContourPoints(
      [
        [5, 5],
        [50, 50],
      ],
      object,
      2
    )
    expect(mapped).toEqual([
      [(5 * 2 + 10) * 2, (5 * 2 + 20) * 2],
      [(50 * 2 + 10) * 2, (50 * 2 + 20) * 2],
    ])
  })

  it('추출기가 주입되면 알파 경로는 cv(getCv)를 전혀 부르지 않는다 — 메인 스레드 프리즈 재발 잠금', async () => {
    const { configureContourExtractor } = await import('../utils/contourExtractor')
    const extractor = vi.fn(async () => ({
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
      ] as [number, number][],
      useHull: false,
    }))
    configureContourExtractor(extractor)
    try {
      const { plugin } = makePlugin()
      plugin.tellHasAlpha = vi.fn(() => true)
      ;(plugin as any).readImageData = vi.fn(() => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }))
      const item: any = { type: 'image', id: 'i', left: 0, top: 0, scaleX: 1, scaleY: 1, getElement: () => ({ width: 8, height: 8 }) }

      const pathData = await plugin.getObjectPathData(item)

      expect(extractor).toHaveBeenCalledTimes(1)
      expect(typeof pathData).toBe('string')
      expect(getCvMock).not.toHaveBeenCalled() // ★ 메인 스레드 cv 로드 없음
    } finally {
      configureContourExtractor(null)
    }
  })

  it('미주입이어도 알파 경로는 순수 추출기로 cv 없이 완주한다 — 2026-08-07 OpenCV 제거의 핵심 불변식', async () => {
    const { configureContourExtractor } = await import('../utils/contourExtractor')
    configureContourExtractor(null) // 기본 = extractContoursPure
    const { plugin } = makePlugin()
    plugin.tellHasAlpha = vi.fn(() => true)
    // 8×8 에 4×4 불투명 블록 — 면적 필터(>1000)에 걸리지 않도록 필터 통과 크기가 아니어도
    // 파이프라인 완주(빈 결과 포함)가 cv 무호출로 이루어지는지가 요점이다.
    const data = new Uint8ClampedArray(8 * 8 * 4)
    for (let y = 2; y < 6; y++)
      for (let x = 2; x < 6; x++) {
        const p = (y * 8 + x) * 4
        data[p] = 255
        data[p + 3] = 255
      }
    ;(plugin as any).readImageData = vi.fn(() => ({ data, width: 8, height: 8 }))
    const item: any = { type: 'image', id: 'i', left: 0, top: 0, scaleX: 1, scaleY: 1, getElement: () => ({ width: 8, height: 8 }) }

    await plugin.getObjectPathData(item)

    expect(getCvMock).not.toHaveBeenCalled() // ★ 기본 경로도 cv 0회 — 프리즈 원인 완전 제거
  })

  it('브라우저 추론 진입점(getForeground)은 존재하지 않는다 — 서버 오프로드 전환 (D-12d)', () => {
    const { plugin } = makePlugin()

    expect((plugin as { getForeground?: unknown }).getForeground).toBeUndefined()
    // 결과 후처리(알파 트림·윤곽)는 남아 있어야 한다 — 서버 결과를 이 경로가 다듬는다.
    expect(typeof plugin.processImage).toBe('function')
    expect(typeof plugin.getObjectPath).toBe('function')
  })

  it('canvas-core 는 @imgly/background-removal(AGPL-3.0)에 의존하지 않는다 — 라이선스 회귀 잠금', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

    const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
    expect(Object.keys(all).filter((n) => n.includes('imgly'))).toEqual([])
  })
})
