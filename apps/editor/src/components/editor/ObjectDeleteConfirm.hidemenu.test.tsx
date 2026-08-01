/**
 * C6-fix(2026-08-01 실측 결함 ②) 회귀 가드: 삭제 확인 모달 오픈 시 컨텍스트 메뉴 강제 닫기.
 *
 * 포인터 경유 오픈(휴지통 탭 등)은 canvas-core 의 document pointerdown 해제가 선처리하지만,
 * DEL/Backspace 핫키 등 비-포인터 경로에선 메뉴가 모달 위에 잔류해 취소/삭제 버튼을 가렸다.
 * ObjectDeleteConfirm 은 deleteConfirmOpen 전이(false→true) 시 editor.hideContextMenu() 를
 * 호출해야 한다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import ObjectDeleteConfirm from './ObjectDeleteConfirm'
import { useAppStore } from '@/stores/useAppStore'

type EditorInStore = NonNullable<ReturnType<typeof useAppStore.getState>['editor']>

const hideContextMenu = vi.fn()

beforeEach(() => {
  hideContextMenu.mockClear()
  useAppStore.setState({
    deleteConfirmOpen: false,
    deleteConfirmCount: 0,
    editor: { hideContextMenu } as unknown as EditorInStore,
  })
})

describe('ObjectDeleteConfirm — 모달 오픈 시 컨텍스트 메뉴 강제 닫기 (C6-fix)', () => {
  it('deleteConfirmOpen 전이(false→true) 시 editor.hideContextMenu 를 1회 호출한다', () => {
    render(<ObjectDeleteConfirm />)
    expect(hideContextMenu).not.toHaveBeenCalled()

    act(() => {
      useAppStore.setState({ deleteConfirmOpen: true, deleteConfirmCount: 1 })
    })
    expect(hideContextMenu).toHaveBeenCalledTimes(1)
  })

  it('닫힌 상태 렌더만으로는 호출하지 않는다', () => {
    render(<ObjectDeleteConfirm />)
    expect(hideContextMenu).not.toHaveBeenCalled()
  })

  it('editor 미설정(null)이어도 오픈이 크래시 없이 모달을 렌더한다', () => {
    useAppStore.setState({ editor: null })
    render(<ObjectDeleteConfirm />)
    act(() => {
      useAppStore.setState({ deleteConfirmOpen: true, deleteConfirmCount: 1 })
    })
    expect(document.body.textContent).toContain('객체 삭제')
  })
})
