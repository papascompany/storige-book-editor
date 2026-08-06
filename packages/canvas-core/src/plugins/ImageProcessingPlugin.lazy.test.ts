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
