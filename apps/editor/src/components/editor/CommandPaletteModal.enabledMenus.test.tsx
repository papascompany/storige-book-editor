// @vitest-environment happy-dom
//
// 명령 팔레트 — 「템플릿」(페이지 템플릿 교체) 항목만 템플릿셋 enabledMenus 화이트리스트를 따른다(ToolBar 와 같은 규칙).
// 캘린더 스킨을 둔 세트는 화이트리스트에서 TEMPLATE 을 빼 팔레트 우회 진입까지 막는다. 다른 메뉴·CLIPPING 게이트는 현행.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'

const toast = vi.hoisted(() => vi.fn())
vi.mock('@/stores/useToastStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/useToastStore')>()),
  showToast: (...a: unknown[]) => toast(...a),
}))

import CommandPaletteModal from './CommandPaletteModal'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

const TEMPLATE_LABEL = '템플릿 도구 열기'

function setMenus(enabledMenus: string[] | null, editMode = false) {
  act(() => {
    useSettingsStore.setState({
      enabledMenus,
      currentSettings: { ...useSettingsStore.getState().currentSettings, editMode },
    } as never)
  })
}

beforeEach(() => {
  toast.mockReset()
  useAppStore.setState({ allCanvas: [], tapMenu: vi.fn() } as never)
  useSettingsStore.setState({ linkedPrintTemplates: [], spreadConfig: null } as never)
})

afterEach(() => {
  cleanup()
  setMenus(null)
})

describe('CommandPaletteModal — 「템플릿」 enabledMenus 필터', () => {
  it('화이트리스트에 TEMPLATE 이 없으면 「템플릿」 항목을 숨긴다', () => {
    setMenus(['TEXT', 'IMAGE', 'CALENDAR'])
    render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.queryByText(TEMPLATE_LABEL)).toBeNull()
  })

  it('enabledMenus null(전체)·TEMPLATE 포함이면 노출한다', () => {
    setMenus(null)
    const { unmount } = render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.getByText(TEMPLATE_LABEL)).toBeTruthy()
    unmount()
    setMenus(['TEMPLATE'])
    render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.getByText(TEMPLATE_LABEL)).toBeTruthy()
  })

  it('editMode(관리자)는 화이트리스트와 무관하게 노출한다(ToolBar 와 같음)', () => {
    setMenus(['TEXT'], true)
    render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.getByText(TEMPLATE_LABEL)).toBeTruthy()
  })

  it('다른 메뉴는 화이트리스트에 없어도 현행처럼 노출한다(필터는 TEMPLATE 한 항목만)', () => {
    setMenus(['TEXT'])
    render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.getByText('이미지 도구 열기')).toBeTruthy()
    expect(screen.getByText('배경 도구 열기')).toBeTruthy()
    expect(screen.getByText('모양컷 도구 열기')).toBeTruthy()
  })

  it('마운트된 채 세트의 enabledMenus 가 바뀌면 목록을 다시 만든다', () => {
    setMenus(null)
    render(<CommandPaletteModal open onClose={() => {}} />)
    expect(screen.getByText(TEMPLATE_LABEL)).toBeTruthy()
    setMenus(['TEXT'])
    expect(screen.queryByText(TEMPLATE_LABEL)).toBeNull()
  })

  it('CLIPPING 게이트 회귀 0 — 다중 캔버스 상품에서 모양컷은 안내 후 열지 않는다', () => {
    const tapMenu = vi.fn()
    useAppStore.setState({ allCanvas: [{}, {}], tapMenu } as never)
    setMenus(['TEXT'])
    render(<CommandPaletteModal open onClose={() => {}} />)
    fireEvent.click(screen.getByText('모양컷 도구 열기'))
    expect(toast).toHaveBeenCalledWith('이 상품에서는 모양컷을 사용할 수 없습니다.', 'info')
    expect(tapMenu).not.toHaveBeenCalled()
  })
})
