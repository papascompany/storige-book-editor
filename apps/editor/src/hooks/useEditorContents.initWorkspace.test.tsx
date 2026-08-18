// @vitest-environment jsdom
//
// R1 (2026-08-18) 회귀 테스트 — initWorkspace stale closure 경화.
//
// embed.tsx 초기화 useEffect(deps=[])는 마운트 시점의 훅 반환(loadTemplateSetEditor 등)을
// 캡처한다. 그 시점 useAppStore 의 editor/canvas 는 null 이라, initWorkspace 가 클로저
// editor/canvas 로 가드하면 통째로 조기 반환(no-op) — 빈 표지(flat-spread)의 workspace
// 치수 적용이 누락돼 createCanvas 기본 105×105mm 정사각이 잔존했다(DB 실측).
// 수정: loadCanvasData(:363)와 동일하게 useAppStore.getState() 최신 참조로 경화.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useEditorContents } from './useEditorContents'

function makeWorkspacePlugin() {
  return { setOptions: vi.fn(), init: vi.fn() }
}

function makeEditor(wsPlugin: ReturnType<typeof makeWorkspacePlugin>) {
  return {
    getPlugin: vi.fn((name: string) => (name === 'WorkspacePlugin' ? wsPlugin : undefined)),
    emit: vi.fn(),
  }
}

afterEach(() => {
  useAppStore.setState({ editor: null, canvas: null } as never)
  vi.restoreAllMocks()
})

describe('useEditorContents.initWorkspace — R1 stale closure 경화', () => {
  it('마운트 시점 editor/canvas 가 null(임베드 초기화 순서)이어도 호출 시점 스토어 최신 참조로 workspace 를 초기화한다', async () => {
    // 1) 임베드와 동일: 스토어가 비어 있는 상태에서 훅 렌더 → 반환 함수 캡처(stale closure).
    useAppStore.setState({ editor: null, canvas: null } as never)
    const { result } = renderHook(() => useEditorContents())
    const captured = result.current // 이 시점 클로저의 editor/canvas 는 null

    // 2) createCanvas 이후처럼 스토어에 editor/canvas 가 채워진다.
    const wsPlugin = makeWorkspacePlugin()
    const editor = makeEditor(wsPlugin)
    const canvas = { getContext: () => ({}), disposed: false }
    useAppStore.setState({ editor: editor as never, canvas: canvas as never })

    // 3) 캡처해 둔(stale) 로더 경유로 initWorkspace 실행 — loadEmptyEditor 는
    //    setupEmptyEditorStore(순수 스토어 갱신) 후 initWorkspace 를 호출한다.
    await captured.loadEmptyEditor({
      name: 'r1-test',
      size: { width: 496, height: 276, cutSize: 0, safeSize: 0 },
      unit: 'mm',
    } as never)

    // 경화 전: 클로저 null 가드로 setOptions/init 미호출(무음 no-op).
    expect(editor.getPlugin).toHaveBeenCalledWith('WorkspacePlugin')
    expect(wsPlugin.setOptions).toHaveBeenCalledWith(useSettingsStore.getState().currentSettings)
    expect(wsPlugin.init).toHaveBeenCalledTimes(1)
    // 설정도 실제로 반영됐는지 (setupEmptyEditorStore → currentSettings.size)
    expect(useSettingsStore.getState().currentSettings.size.width).toBe(496)
    expect(useSettingsStore.getState().currentSettings.size.height).toBe(276)
  })

  it('disposed 캔버스면 안전하게 스킵한다 (StrictMode 이중 마운트 가드 유지)', async () => {
    const wsPlugin = makeWorkspacePlugin()
    const editor = makeEditor(wsPlugin)
    const canvas = { getContext: () => ({}), disposed: true }
    useAppStore.setState({ editor: editor as never, canvas: canvas as never })

    const { result } = renderHook(() => useEditorContents())
    await result.current.loadEmptyEditor(undefined)

    expect(wsPlugin.setOptions).not.toHaveBeenCalled()
    expect(wsPlugin.init).not.toHaveBeenCalled()
  })
})
