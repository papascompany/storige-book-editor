import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import EditorHeader from './EditorHeader'
import { useSettingsStore } from '@/stores/useSettingsStore'

/**
 * S1 (2026-07-04): 주문 컨텍스트(embed) 사이즈 게이팅 회귀 테스트.
 * - orderContext + 비-editMode(고객) → 사이즈 편집 Popover 트리거 부재, 읽기전용 라벨만.
 * - orderContext + editMode(관리자) → 편집 Popover 유지.
 * - 비-orderContext(standalone) → 현행 유지.
 */

// 무거운 자식/훅은 렌더 안정화를 위해 스텁 (게이팅 로직과 무관)
vi.mock('../Mockup3D/BookMockup3D', () => ({ BookMockup3D: () => null }))
vi.mock('./KeyboardShortcutsModal', () => ({ default: () => null }))
vi.mock('./CommandPaletteModal', () => ({ default: () => null }))
vi.mock('./HistoryPanel', () => ({ default: () => null }))
vi.mock('./AutoSaveIndicator', () => ({ AutoSaveIndicator: () => null }))
vi.mock('@/hooks/useWorkSave', () => ({
  useWorkSave: () => ({ saveWork: vi.fn(), saveWorkForAdmin: vi.fn() }),
}))
vi.mock('@/hooks/useTemplateSetSave', () => ({
  useTemplateSetSave: () => ({ saving: false, saveTemplateSet: vi.fn() }),
}))

const EDIT_UI_LABEL = '작업 사이즈 변경'
const READONLY_LABEL = '작업 사이즈 (상품 옵션에서 변경)'

async function setEditMode(editMode: boolean) {
  await useSettingsStore.getState().updateSettings({ editMode })
}

describe('EditorHeader 사이즈 게이팅 (S1)', () => {
  // assertion 실패 시에도 editMode 잔류 방지 (리뷰 지적 — 견고성)
  afterEach(async () => {
    await useSettingsStore.getState().updateSettings({ editMode: false })
  })

  it('orderContext + 고객(비-editMode): 편집 트리거 없음, 읽기전용 라벨 노출', async () => {
    await setEditMode(false)
    render(<EditorHeader orderContext />)
    expect(screen.queryByLabelText(EDIT_UI_LABEL)).toBeNull()
    expect(screen.getByLabelText(READONLY_LABEL)).toBeInTheDocument()
  })

  it('orderContext + 관리자(editMode): 편집 Popover 유지', async () => {
    await setEditMode(true)
    render(<EditorHeader orderContext />)
    expect(screen.getByLabelText(EDIT_UI_LABEL)).toBeInTheDocument()
    expect(screen.queryByLabelText(READONLY_LABEL)).toBeNull()
  })

  it('비-orderContext(standalone): 편집 Popover 유지 (현행)', async () => {
    await setEditMode(false)
    render(<EditorHeader />)
    expect(screen.getByLabelText(EDIT_UI_LABEL)).toBeInTheDocument()
    expect(screen.queryByLabelText(READONLY_LABEL)).toBeNull()
  })
})
