import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { RefObject } from 'react'
import { useCanvasContainerSizeSync } from './useCanvasContainerSizeSync'
import { useAppStore } from '@/stores/useAppStore'

/**
 * T6 (2026-07-13): EditorView 에서 추출한 캔버스 컨테이너 크기 동기화 훅 스펙.
 * - 폭 변화 → setDimensions 호출 + sizeChange emit
 * - 재정렬 분기: fits(5% 패딩) → setCenterPointOf(줌 유지) / 미적합 → setZoomAuto
 * - 동일 치수 → setDimensions 스킵(no-op)
 * - 1px 미만 지터 → apply 자체 스킵 (iOS Safari 무한 루프 3중 방어의 일부)
 */

// -- 테스트 더블 ---------------------------------------------------------------

interface FakeWorkspace {
  id: string
  width: number
  height: number
  scaleX: number
  scaleY: number
}

function makeFakeCanvas(initial?: { width?: number; height?: number; zoom?: number; workspaceSize?: number }) {
  let w = initial?.width ?? 0
  let h = initial?.height ?? 0
  const zoom = initial?.zoom ?? 1
  const workspace: FakeWorkspace = {
    id: 'workspace',
    width: initial?.workspaceSize ?? 100,
    height: initial?.workspaceSize ?? 100,
    scaleX: 1,
    scaleY: 1,
  }
  const canvas = {
    disposed: false,
    getWidth: () => w,
    getHeight: () => h,
    setDimensions: vi.fn(({ width, height }: { width: number; height: number }) => {
      w = width
      h = height
    }),
    getZoom: () => zoom,
    getObjects: () => [workspace],
    requestRenderAll: vi.fn(),
  }
  return { canvas, workspace }
}

function makeFakeEditor() {
  const wsPlugin = { setCenterPointOf: vi.fn(), setZoomAuto: vi.fn() }
  const editor = {
    getPlugin: vi.fn((name: string) => (name === 'WorkspacePlugin' ? wsPlugin : undefined)),
    emit: vi.fn(),
  }
  return { editor, wsPlugin }
}

function makeContainer(w: number, h: number) {
  const el = document.createElement('div')
  let width = w
  let height = h
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height })
  document.body.appendChild(el)
  const ref = { current: el } as RefObject<HTMLDivElement>
  return {
    el,
    ref,
    setSize: (nw: number, nh: number) => {
      width = nw
      height = nh
    },
  }
}

/** window resize → schedule → RAF(setTimeout 스텁) 플러시 */
async function fireResizeAndFlush(): Promise<void> {
  window.dispatchEvent(new Event('resize'))
  await new Promise((r) => setTimeout(r, 10))
}

// -- 셋업 -----------------------------------------------------------------------

beforeEach(() => {
  // RAF 를 setTimeout(0) 으로 스텁 — schedule 의 rafId 병합 가드(동기 실행 시 오동작)를
  // 존중하면서 테스트에서 결정적으로 플러시할 수 있게 한다.
  vi.stubGlobal('requestAnimationFrame', ((cb: (time: number) => void) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame)
  vi.stubGlobal('cancelAnimationFrame', ((id: number) =>
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>)) as typeof cancelAnimationFrame)
})

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState({ allCanvas: [], allEditors: [] } as never)
  document.body.innerHTML = ''
})

function wireStore(canvas: unknown, editor: unknown): void {
  useAppStore.setState({ allCanvas: [canvas], allEditors: [editor] } as never)
}

// -- 스펙 -----------------------------------------------------------------------

describe('useCanvasContainerSizeSync (T6)', () => {
  it('ready=false 면 아무 것도 하지 않는다', () => {
    const { canvas } = makeFakeCanvas()
    const { editor } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(false, ref))

    expect(canvas.setDimensions).not.toHaveBeenCalled()
    expect(editor.emit).not.toHaveBeenCalled()
  })

  it('초기 1회 동기화: setDimensions + sizeChange emit, 첫 apply 는 재정렬 스킵', () => {
    const { canvas } = makeFakeCanvas()
    const { editor, wsPlugin } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(true, ref))

    expect(canvas.setDimensions).toHaveBeenCalledTimes(1)
    expect(canvas.setDimensions).toHaveBeenCalledWith({ width: 800, height: 600 })
    expect(editor.emit).toHaveBeenCalledWith('sizeChange', { width: 800, height: 600 })
    // 첫 동기화는 WorkspacePlugin.reset() 의 setZoomAuto 가 담당 — 재정렬 없음
    expect(wsPlugin.setCenterPointOf).not.toHaveBeenCalled()
    expect(wsPlugin.setZoomAuto).not.toHaveBeenCalled()
  })

  it('폭 변화 + 페이지가 들어가면(fits): setDimensions 후 setCenterPointOf (줌 유지)', async () => {
    const { canvas, workspace } = makeFakeCanvas({ workspaceSize: 100 }) // 100px @zoom1
    const { editor, wsPlugin } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref, setSize } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(true, ref))
    canvas.setDimensions.mockClear()

    setSize(520, 600) // ControlBar(≈280px) 마운트로 컨테이너 폭 축소 시나리오
    await fireResizeAndFlush()

    expect(canvas.setDimensions).toHaveBeenCalledWith({ width: 520, height: 600 })
    // 100 <= 520*0.95 → fits → 줌 유지 중앙 이동
    expect(wsPlugin.setCenterPointOf).toHaveBeenCalledTimes(1)
    expect(wsPlugin.setCenterPointOf).toHaveBeenCalledWith(workspace)
    expect(wsPlugin.setZoomAuto).not.toHaveBeenCalled()
    expect(editor.emit).toHaveBeenCalledWith('sizeChange', { width: 520, height: 600 })
  })

  it('폭 변화 + 페이지가 안 들어가면(미적합): setZoomAuto 로 자동 맞춤', async () => {
    // workspace 1000px @zoom1 > 520*0.95 → 미적합
    const { canvas } = makeFakeCanvas({ workspaceSize: 1000 })
    const { editor, wsPlugin } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref, setSize } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(true, ref))

    setSize(520, 600)
    await fireResizeAndFlush()

    expect(wsPlugin.setZoomAuto).toHaveBeenCalledTimes(1)
    expect(wsPlugin.setCenterPointOf).not.toHaveBeenCalled()
  })

  it('fabric 캔버스 치수가 이미 같으면 setDimensions 를 스킵한다 (no-op)', () => {
    const { canvas } = makeFakeCanvas({ width: 800, height: 600 })
    const { editor } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(true, ref))

    expect(canvas.setDimensions).not.toHaveBeenCalled()
    // emit 은 캔버스별 스킵과 무관하게 발화(RulerPlugin 구독 계약)
    expect(editor.emit).toHaveBeenCalledWith('sizeChange', { width: 800, height: 600 })
  })

  it('1px 미만 지터는 apply 자체를 스킵한다 (모바일 viewport 지터 흡수)', async () => {
    const { canvas } = makeFakeCanvas()
    const { editor, wsPlugin } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref, setSize } = makeContainer(800, 600)

    renderHook(() => useCanvasContainerSizeSync(true, ref))
    canvas.setDimensions.mockClear()
    editor.emit.mockClear()

    setSize(800.5, 600.4)
    await fireResizeAndFlush()

    expect(canvas.setDimensions).not.toHaveBeenCalled()
    expect(editor.emit).not.toHaveBeenCalled()
    expect(wsPlugin.setCenterPointOf).not.toHaveBeenCalled()
    expect(wsPlugin.setZoomAuto).not.toHaveBeenCalled()
  })

  it('unmount 시 resize 리스너를 정리한다 (이후 resize 무반응)', async () => {
    const { canvas } = makeFakeCanvas()
    const { editor } = makeFakeEditor()
    wireStore(canvas, editor)
    const { ref, setSize } = makeContainer(800, 600)

    const { unmount } = renderHook(() => useCanvasContainerSizeSync(true, ref))
    canvas.setDimensions.mockClear()
    unmount()

    setSize(500, 500)
    await fireResizeAndFlush()

    expect(canvas.setDimensions).not.toHaveBeenCalled()
  })
})
