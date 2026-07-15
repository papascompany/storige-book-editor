// ImageProcessingPlugin lazy 초기화 회귀 테스트 (D-6b①, 2026-07-15)
//
// 검증 대상:
//  (1) 생성자가 어떤 네트워크/무거운 초기화도 트리거하지 않는다.
//      — 기존엔 생성자가 startService() 를 즉시 실행해 ONNX 모델(≈88MB)+
//        ort wasm(≈23MB)을 모든 에디터/embed 캔버스 생성 시마다 다운로드했다.
//  (2) ensureReady() 는 멱등 — 동시 다중 호출도 단일 초기화(preload 1회)만 수행.
//  (3) 초기화 실패 시 in-flight promise 가 리셋되어 다음 호출에서 재시도 가능.
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

// openCv lazy-loader mock — 플러그인이 이 진입점 외의 경로로 모델/wasm 을
// 로드하지 않는다는 전제 하에, 호출 횟수로 초기화 트리거 여부를 단언한다.
const { getCvMock, getBackgroundRemovalMock, preloadMock, removeBackgroundMock } = vi.hoisted(
  () => {
    const preloadMock = vi.fn(async () => undefined)
    const removeBackgroundMock = vi.fn()
    return {
      preloadMock,
      removeBackgroundMock,
      getCvMock: vi.fn(async () => ({ __mockCv: true })),
      getBackgroundRemovalMock: vi.fn(async () => ({
        preload: preloadMock,
        removeBackground: removeBackgroundMock
      }))
    }
  }
)
vi.mock('../utils/openCv', () => ({
  getCv: getCvMock,
  getBackgroundRemoval: getBackgroundRemovalMock
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

describe('ImageProcessingPlugin — lazy 초기화 (D-6b①)', () => {
  it('생성자는 모델 preload/OpenCV 로드 등 어떤 무거운 초기화도 트리거하지 않는다', () => {
    makePlugin()

    expect(getBackgroundRemovalMock).not.toHaveBeenCalled()
    expect(preloadMock).not.toHaveBeenCalled()
    expect(getCvMock).not.toHaveBeenCalled()
  })

  it('ensureReady() 는 멱등 — 동시 2회 호출도 단일 초기화(preload 1회)만 수행한다', async () => {
    const { plugin } = makePlugin()

    // 동시 호출 — 동일 in-flight promise 공유
    const [p1, p2] = [plugin.ensureReady(), plugin.ensureReady()]
    expect(p1).toBe(p2)
    await Promise.all([p1, p2])

    // 완료 후 추가 호출도 재초기화하지 않는다
    await plugin.ensureReady()

    expect(getBackgroundRemovalMock).toHaveBeenCalledTimes(1)
    expect(preloadMock).toHaveBeenCalledTimes(1)
  })

  it('초기화 실패 시 promise 가 리셋되어 다음 ensureReady() 가 재시도한다', async () => {
    const { plugin } = makePlugin()

    preloadMock.mockRejectedValueOnce(new Error('network down'))

    await expect(plugin.ensureReady()).rejects.toThrow('network down')

    // 재시도 — 새 초기화가 수행되고 성공한다
    await expect(plugin.ensureReady()).resolves.toBeUndefined()
    expect(preloadMock).toHaveBeenCalledTimes(2)
  })

  it('ensureCvReady() 는 openCv lazy-loader 로 위임하고 cv 인스턴스를 반환한다', async () => {
    const { plugin } = makePlugin()

    const cv = await plugin.ensureCvReady()

    expect(cv).toEqual({ __mockCv: true })
    expect(getCvMock).toHaveBeenCalledTimes(1)
    // OpenCV 경로는 88MB ONNX 모델을 받지 않는다 (모델 초기화와 분리)
    expect(getBackgroundRemovalMock).not.toHaveBeenCalled()
    expect(preloadMock).not.toHaveBeenCalled()
  })

  it('getForeground() 는 최초 사용 시 준비 중 메시지를 발행하고 ensureReady 를 선행한다', async () => {
    const { plugin, editor } = makePlugin()

    // fabric mock 환경이라 실제 이미지 파이프라인은 실행 불가 —
    // removeBackground 직전까지의 초기화 경로만 검증하고 이후는 실패시켜 단락.
    removeBackgroundMock.mockRejectedValueOnce(new Error('stop-here'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const item: any = { type: 'image', getElement: () => ({ src: 'data:image/png;base64,x' }) }
    await expect(plugin.getForeground(item)).rejects.toThrow('stop-here')
    errorSpy.mockRestore()

    // 준비 중 메시지 → (초기화 후) 배경 제거 중 메시지 → 종료 이벤트
    const messages = editor.emit.mock.calls.map((c: any[]) => c[0] + ':' + (c[1]?.message ?? ''))
    expect(messages[0]).toBe('longTask:start:배경 제거 도구 준비 중...')
    expect(messages).toContain('longTask:start:배경 제거 중...')
    expect(editor.emit.mock.calls.some((c: any[]) => c[0] === 'longTask:end')).toBe(true)

    // 초기화(preload)가 removeBackground 보다 선행
    expect(preloadMock).toHaveBeenCalledTimes(1)
    expect(preloadMock.mock.invocationCallOrder[0]).toBeLessThan(
      removeBackgroundMock.mock.invocationCallOrder[0]
    )
  })
})
