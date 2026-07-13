import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import SidePanel from './SidePanel'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { SelectionType, type CanvasObject } from '@storige/canvas-core'

/**
 * T4 (2026-07-13): 헤더 Layers 아이콘 → "페이지 네비" 오인 해소 스펙.
 * - ① DOM 순서: '요소'(레이어) 섹션이 '페이지' 섹션보다 문서상 먼저
 * - ② 데스크톱 헤더: '레이어' 제목 + 닫기 버튼 상시 노출 (구 lg:hidden 닫기 바 대체)
 * - ③ 패널 열림(show false→true) 시 선택 행 scrollIntoView({block:'nearest'}) 1회
 * - ④ 페이지 섹션: 기본 접힘 → 펼침 후 addPage 버튼 동작 (진입점 보존 — 제거 금지)
 */

// -- 테스트 더블 ---------------------------------------------------------------

function makeRow(id: string, name: string): CanvasObject {
  return {
    id,
    name,
    type: SelectionType.text, // 썸네일 비대상 타입 — idle 썸네일 패스 무발화(테스트 안정)
    visible: true,
    locked: false,
    selected: false,
    editable: true,
    displayOrder: 0,
  }
}

function makeFakeCanvas(id = 'canvas-1') {
  return {
    id,
    on: vi.fn(),
    off: vi.fn(),
    getObjects: vi.fn(() => [] as unknown[]),
    requestRenderAll: vi.fn(),
    renderAll: vi.fn(),
    setActiveObject: vi.fn(),
    discardActiveObject: vi.fn(),
  }
}

const addPageMock = vi.fn()

function wireStores(overrides?: { activeSelection?: unknown[]; objects?: CanvasObject[] }) {
  const canvas = makeFakeCanvas()
  useAppStore.setState({
    canvas,
    allCanvas: [canvas],
    objects: overrides?.objects ?? [makeRow('obj-1', '상자 1'), makeRow('obj-2', '상자 2')],
    screenshots: [''],
    activeSelection: overrides?.activeSelection ?? [],
    addPage: addPageMock,
  } as never)
  useSettingsStore.setState((s) => ({
    currentSettings: {
      ...s.currentSettings,
      page: { count: 1, min: 1, max: 99, interval: 1 },
    },
  }))
  return canvas
}

const scrollSpy = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // happy-dom 미구현 대비 — 프로토타입에 spy 주입(선택 행 스크롤 관측)
  window.HTMLElement.prototype.scrollIntoView = scrollSpy
})

afterEach(() => {
  // RTL 자동 cleanup(LIFO 상 나중 실행)보다 먼저 실행되므로 컴포넌트가 아직 마운트 상태 —
  // store 리셋 리렌더를 act 로 감싸 경고 없이 정리한다.
  act(() => {
    useAppStore.setState({
      canvas: null,
      allCanvas: [],
      objects: [],
      screenshots: [],
      activeSelection: [],
    } as never)
  })
})

// -- 스펙 -----------------------------------------------------------------------

describe('SidePanel T4 — 섹션 순서/헤더/열림 스크롤/페이지 collapsible', () => {
  it("① '요소' 섹션이 '페이지' 섹션보다 문서상 먼저 온다", () => {
    wireStores()
    render(<SidePanel show onClose={() => {}} />)

    const objectsHeader = screen.getByText('요소')
    const pagesHeader = screen.getByText('페이지')
    // DOCUMENT_POSITION_FOLLOWING: pagesHeader 가 objectsHeader 뒤에 위치
    expect(
      objectsHeader.compareDocumentPosition(pagesHeader) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("② 데스크톱 헤더: '레이어' 제목 + 닫기 버튼이 항상 보인다", () => {
    wireStores()
    const onClose = vi.fn()
    render(<SidePanel show onClose={onClose} />)

    const title = screen.getByText('레이어')
    // 구 lg:hidden 닫기 바 회귀 방지 — 데스크톱에서 숨겨지는 클래스가 없어야 한다
    expect(title.closest('.top')?.className ?? '').not.toContain('lg:hidden')

    fireEvent.click(screen.getByLabelText('레이어 패널 닫기'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('③ show false→true 전환 시 선택 행을 scrollIntoView({block:nearest}) 1회 호출', () => {
    wireStores({ activeSelection: [{ id: 'obj-2' }] })
    const { rerender } = render(<SidePanel show={false} onClose={() => {}} />)
    expect(scrollSpy).not.toHaveBeenCalled()

    rerender(<SidePanel show onClose={() => {}} />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' })
    // 대상은 선택 행(obj-2)의 행 요소여야 한다
    const target = scrollSpy.mock.contexts[0] as HTMLElement
    expect(target.textContent).toContain('상자 2')

    // 열린 상태 유지 중 재렌더에는 재발화하지 않는다(1회 규약)
    rerender(<SidePanel show onClose={() => {}} />)
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('③-보강: 선택이 없으면 열림 전환에도 스크롤하지 않는다', () => {
    wireStores({ activeSelection: [] })
    const { rerender } = render(<SidePanel show={false} onClose={() => {}} />)
    rerender(<SidePanel show onClose={() => {}} />)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('④ 페이지 섹션은 기본 접힘 — 펼치면 addPage 버튼이 동작한다', () => {
    wireStores()
    render(<SidePanel show onClose={() => {}} />)

    // 기본 접힘: 페이지 썸네일/추가 버튼 미노출
    expect(screen.queryByLabelText('페이지 추가')).toBeNull()
    expect(screen.queryByText('Page 1')).toBeNull()

    // 펼침
    const toggle = screen.getByText('페이지')
    expect(toggle.closest('button')).not.toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText('Page 1')).toBeInTheDocument()

    // addPage 동작 (진입점 보존 — BookNavigation 은 순수 네비라 여기가 유일)
    fireEvent.click(screen.getByLabelText('페이지 추가'))
    expect(addPageMock).toHaveBeenCalledTimes(1)

    // 다시 접힘
    fireEvent.click(toggle)
    expect(screen.queryByText('Page 1')).toBeNull()
  })
})
