// ImageProcessingPlugin lazy 초기화 회귀 테스트 (D-6b① 2026-07-15 · D-12d 2026-08-06)
//
// 검증 대상:
//  (1) 생성자가 어떤 네트워크/무거운 초기화도 트리거하지 않는다.
//      — 기존엔 생성자가 startService() 를 즉시 실행해 ONNX 모델(≈88MB)+
//        ort wasm(≈23MB)을 모든 에디터/embed 캔버스 생성 시마다 다운로드했다.
//  (2) ensureCvReady() 는 OpenCV lazy-loader 로만 위임한다.
//  (3) **D-12d 라이선스 잠금**: 브라우저 배경제거(@imgly/background-removal, AGPL-3.0)가
//      다시 들어오지 않는다 — getForeground() 부재 + package.json 의존 부재로 잠근다.
//      추론은 서버(rembg 사이드카)가 하고 진입점은 editor 의 api/cutout.ts 다.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// fabric 은 node 테스트 환경에서 native canvas 바인딩을 요구해 로드 불가 → mock
// (Editor.dispose.test.ts / AccessoryPlugin.leak.test.ts 와 동일 패턴)
vi.mock('fabric', () => ({ fabric: {} }))

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

// openCv lazy-loader mock — 플러그인이 이 진입점 외의 경로로 wasm 을
// 로드하지 않는다는 전제 하에, 호출 횟수로 초기화 트리거 여부를 단언한다.
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

  it('ensureCvReady() 는 openCv lazy-loader 로 위임하고 cv 인스턴스를 반환한다', async () => {
    const { plugin } = makePlugin()

    const cv = await plugin.ensureCvReady()

    expect(cv).toEqual({ __mockCv: true })
    expect(getCvMock).toHaveBeenCalledTimes(1)
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

  it('컨투어 스캔에서 버리는 복사본은 즉시 해제한다 — wasm 힙 누수 회귀 잠금', () => {
    const { plugin } = makePlugin()
    const made: any[] = []
    const mkContour = (area: number) => {
      const m = { rows: 2, data32S: [0, 0, 1, 1], delete: vi.fn(), __area: area }
      made.push(m)
      return m
    }
    const contours = [mkContour(50), mkContour(5000), mkContour(10)] // 1개만 면적 통과
    const cv = {
      CV_32SC2: 4,
      MatVector: function (this: any) {
        this.size = () => contours.length
        this.get = (i: number) => contours[i]
        this.delete = vi.fn()
      },
      Mat: function (this: any) {
        this.delete = vi.fn()
      },
      findContours: vi.fn(),
      contourArea: (c: any) => c.__area,
      matFromArray: vi.fn(() => ({ delete: vi.fn() })),
      convexHull: vi.fn(),
    }

    ;(plugin as any).findLargestContour(cv, {})

    // 면적 미달 2개는 루프에서, 통과한 1개는 점 추출 후 — 결국 전부 해제되어야 한다.
    for (const m of made) {
      expect(m.delete).toHaveBeenCalled()
    }
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
