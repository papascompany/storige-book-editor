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

  it('알파가 있으면 그때 OpenCV 를 로드한다(윤곽 추출에 실제로 필요)', async () => {
    const { plugin } = makePlugin()
    plugin.tellHasAlpha = vi.fn(() => true)
    plugin.preProcessImage = vi.fn(async () => ({ __binary: true }))
    plugin.findLargestContour = vi.fn(() => [{ __contour: true }, false])
    plugin.smoothContour = vi.fn(async () => [{ x: 0, y: 0 }])
    plugin.generateCurvedPath = vi.fn(() => 'M 1 1')

    const pathData = await plugin.getObjectPathData(makeItem())

    expect(pathData).toBe('M 1 1')
    expect(getCvMock).toHaveBeenCalledTimes(1)
    expect(plugin.preProcessImage).toHaveBeenCalledWith({ __mockCv: true }, expect.anything(), true, 1)
  })

  it('윤곽 좌표는 축소본 배율만큼 선형 역보정된다 (칼선 다운스케일 회귀 잠금)', async () => {
    const { plugin } = makePlugin()
    // 축소본(1/2)에서 얻은 컨투어 좌표 → 원본 좌표로 2배 복원되어야 한다.
    const contour = {
      rows: 2,
      cols: 1,
      type: () => 4,
      data32S: [10, 20, 30, 40],
      delete: vi.fn(),
    }
    const object: any = { left: 0, top: 0, scaleX: 1, scaleY: 1 }

    const points = await (plugin as any).smoothContour(object, contour, false, 2)

    expect(points).toEqual([
      [20, 40],
      [60, 80],
    ])
  })

  it('배율 1(캡 미발동)이면 좌표를 그대로 쓴다', async () => {
    const { plugin } = makePlugin()
    const contour = { rows: 1, cols: 1, type: () => 4, data32S: [7, 9], delete: vi.fn() }
    const object: any = { left: 0, top: 0, scaleX: 1, scaleY: 1 }

    const points = await (plugin as any).smoothContour(object, contour, false)

    expect(points).toEqual([[7, 9]])
  })

  it('윤곽 근사화(approxPolyDP)를 실제로 호출한다 — 주석만 있고 호출이 없던 회귀 잠금', async () => {
    const { plugin } = makePlugin()
    const approxPolyDP = vi.fn((_src: any, dst: any) => {
      dst.rows = 4
      dst.data32S = [0, 0, 10, 0, 10, 10, 0, 10]
    })
    const arcLength = vi.fn(() => 400)
    getCvMock.mockResolvedValueOnce({
      CV_32SC2: 4,
      arcLength,
      approxPolyDP,
      Mat: function (this: any) {
        this.rows = 0
        this.data32S = [] as number[]
        this.delete = vi.fn()
      },
    })

    // 원본 컨투어는 점이 아주 많다고 가정 — 근사화 결과(4점)가 쓰여야 한다.
    const many: number[] = []
    for (let i = 0; i < 5000; i++) many.push(i * 10, 0)
    const contour = { rows: 2500, cols: 1, type: () => 4, data32S: many, delete: vi.fn() }
    const object: any = { left: 0, top: 0, scaleX: 1, scaleY: 1 }

    const points = await (plugin as any).smoothContour(object, contour, false)

    expect(arcLength).toHaveBeenCalledTimes(1)
    expect(approxPolyDP).toHaveBeenCalledTimes(1)
    expect(points).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ])
  })

  it('근사화가 없는 cv 빌드에서도 칼선은 나오되 점 수는 상한으로 제한된다', async () => {
    const { plugin } = makePlugin()
    // 기본 mock cv 에는 arcLength/approxPolyDP 가 없다 → 폴백(원본 컨투어) 경로.
    const many: number[] = []
    for (let i = 0; i < 9000; i++) many.push(i * 10, 0) // 간격 10 > nearThreshold(1.5) 라 전부 통과
    const contour = { rows: 9000, cols: 1, type: () => 4, data32S: many, delete: vi.fn() }
    const object: any = { left: 0, top: 0, scaleX: 1, scaleY: 1 }

    const points = await (plugin as any).smoothContour(object, contour, false)

    const cap = (ImageProcessingPlugin as any).CONTOUR_MAX_POINTS
    expect(points.length).toBeLessThanOrEqual(cap)
    // 균등 샘플링이라 도형이 열리지 않는다 — 시작점은 보존되고 끝쪽 좌표까지 포함한다.
    expect(points[0]).toEqual([0, 0])
    expect(points[points.length - 1][0]).toBeGreaterThan(80000)
  })

  it('윤곽 입력 장변 캡 상수가 서버 산출물(2560)보다 작게 유지된다', () => {
    const cap = (ImageProcessingPlugin as any).CONTOUR_MAX_LONG_EDGE
    expect(cap).toBeGreaterThan(0)
    expect(cap).toBeLessThan(2560)
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
