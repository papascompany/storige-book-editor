/**
 * 임베드 삭제 확인 모달 마운트 테스트 (적대 리뷰 P1-2, 2026-07-15)
 *
 * ObjectActionBar 삭제 버튼(과 DEL/Backspace 인터셉터)은 requestDeleteSelection() 으로
 * deleteConfirmOpen 상태만 세팅하고, 실제 모달 UI 는 <ObjectDeleteConfirm /> 소비자가
 * 렌더한다. 소비자는 App.tsx 루트에만 마운트돼 있었는데 embed.tsx 는 독립 엔트리
 * (createRoot(EmbeddedEditor))라 App 트리를 타지 않는다 → 임베드에서 삭제 버튼이
 * dead button 이었다. 본 테스트는 EmbeddedEditor 마운트 트리에 ObjectDeleteConfirm 이
 * 존재해 삭제 요청 → 모달 오픈이 동작함을 잠근다.
 *
 * EmbeddedEditor 의 무거운 초기화(캔버스/API)는 store.ready=true 선세팅으로 스킵되고
 * (embed.tsx init effect 의 `if (useAppStore.getState().ready) return` 가드),
 * 하위 UI 컴포넌트/훅은 스텁한다 — 검증 대상인 ObjectDeleteConfirm 은 실물 그대로.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'

// ── 하위 UI 스텁 (검증 대상 아님 — ObjectDeleteConfirm 은 스텁하지 않는다) ──────
vi.mock('./components/editor/EditorHeader', () => ({ default: () => null }))
vi.mock('./components/editor/ToolBar', () => ({ default: () => null }))
vi.mock('./components/editor/ObjectActionBar', () => ({ default: () => null }))
vi.mock('./components/editor/FeatureSidebar', () => ({ default: () => null }))
vi.mock('./components/editor/ControlBar', () => ({ default: () => null }))
vi.mock('./components/editor/SidePanel', () => ({ default: () => null }))
vi.mock('./components/PageNavigation/BookNavigation', () => ({ BookNavigation: () => null }))
vi.mock('./components/PagePanel/SpreadPagePanel', () => ({ SpreadPagePanel: () => null }))
vi.mock('./components/modals', () => ({ WorkspaceModal: () => null }))
vi.mock('./components/RestoreBackupBanner', () => ({ RestoreBackupBanner: () => null }))

// ── 훅 스텁 (부수효과 차단 — 저장 타이머/리스너/리사이즈 옵저버) ────────────────
vi.mock('./hooks/useEditorContents', () => ({
  useEditorContents: () => ({ loadEmptyEditor: vi.fn(), loadTemplateSetEditor: vi.fn() }),
}))
vi.mock('./hooks/useEmbedAutoSave', () => ({
  useEmbedAutoSave: () => ({
    saveNow: vi.fn(),
    restoreFromLocal: vi.fn(),
    evaluateRestore: () => ({ offer: false, confident: false }),
    deleteLocalBackup: vi.fn(),
  }),
}))
vi.mock('./hooks/useEmbedBackGuard', () => ({ useEmbedBackGuard: () => undefined }))
vi.mock('./hooks/useCanvasContainerSizeSync', () => ({
  useCanvasContainerSizeSync: () => undefined,
}))
vi.mock('./hooks/useResolvedPageNavPosition', () => ({
  useResolvedPageNavPosition: () => 'bottom' as const,
}))

import { EmbeddedEditor, type EditorInstanceMethods } from './embed'
import { useAppStore } from './stores/useAppStore'

function makeFakeCanvas(selection: Array<Record<string, unknown>>) {
  return {
    getActiveObjects: () => selection,
    getActiveObject: () => selection[0] ?? null,
  }
}

function renderEmbed() {
  const instanceRef = { current: null as EditorInstanceMethods | null }
  return render(<EmbeddedEditor templateSetId="ts-test" instanceRef={instanceRef} />)
}

beforeEach(() => {
  // ready=true 선세팅 → embed init effect 가 조기 반환(무거운 초기화/네트워크 스킵)
  act(() => {
    useAppStore.setState({
      ready: true,
      canvas: makeFakeCanvas([{ id: 'obj-1' }]),
      activeSelection: [],
      deleteConfirmOpen: false,
      deleteConfirmCount: 0,
    } as never)
  })
})

afterEach(() => {
  act(() => {
    useAppStore.setState({
      ready: false,
      canvas: null,
      activeSelection: [],
      deleteConfirmOpen: false,
      deleteConfirmCount: 0,
    } as never)
  })
})

describe('EmbeddedEditor — ObjectDeleteConfirm 마운트 (S2 모달 규약)', () => {
  it('삭제 요청(requestDeleteSelection — ObjectActionBar 삭제 버튼 경로) 시 확인 모달이 열린다', () => {
    renderEmbed()

    // 마운트 직후에는 모달 없음
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // ObjectActionBar 삭제 버튼이 호출하는 것과 동일한 공통 경로
    act(() => {
      useAppStore.getState().requestDeleteSelection()
    })

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('객체 삭제')).toBeInTheDocument()

    // 취소하면 닫힌다 (상태 소비자가 실제로 배선되어 있음을 확인)
    fireEvent.click(screen.getByText('취소'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(useAppStore.getState().deleteConfirmOpen).toBe(false)
  })

  it('DEL 키 캡처 인터셉터도 임베드 트리에서 동작한다 (hotkeys-js 선점 → 모달 오픈)', () => {
    renderEmbed()

    fireEvent.keyDown(document, { key: 'Delete' })

    expect(useAppStore.getState().deleteConfirmOpen).toBe(true)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
