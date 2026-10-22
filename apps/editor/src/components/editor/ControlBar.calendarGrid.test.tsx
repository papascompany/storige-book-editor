// @vitest-environment happy-dom
//
// T2 그리드·기념일 안전성 (2026-10-22): ControlBar '그룹해제' 버튼 게이트.
//  (1) 캘린더 날짜 그리드(fabric.Group, extensionType 'calendar-grid') 선택 → 바는 뜨지만 '그룹해제' 버튼은 없다
//      (GroupPlugin.unGroup 이 no-op 이라 눌러도 무동작인 버튼을 내지 않는다)
//  (2) 일반 그룹(extensionType 'group') 선택 → 버튼 노출 + 클릭 시 GroupPlugin.unGroup 1회·requestRenderAll (회귀)
//  (3) 다중 선택은 '그룹화' 만, 그룹해제 없음 (기존 동작)
// 하위 컨트롤(크기·색·외곽선·그림자·효과·표지 이동·텍스트)은 fabric 실객체가 필요해 null 로 대체 — 게이트만 본다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import ControlBar from './ControlBar'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'

vi.mock('@/controls/ObjectSize', () => ({ default: () => null }))
vi.mock('@/controls/ObjectFill', () => ({ default: () => null }))
vi.mock('@/controls/ObjectShadow', () => ({ default: () => null }))
vi.mock('@/controls/ObjectStroke', () => ({ default: () => null }))
vi.mock('@/controls/TextAttributes', () => ({ default: () => null }))
vi.mock('@/controls/TextEffect', () => ({ default: () => null }))
vi.mock('@/controls/MoveToCoverRegion', () => ({ default: () => null }))
vi.mock('@/controls/SpecialEffect', () => ({ default: () => null }))

const unGroup = vi.fn()
const group = vi.fn()
const requestRenderAll = vi.fn()

/** CalendarPlugin.createGrid 가 만드는 그리드 그룹의 선택 시 모습(기본 잠금: movable/deleteable/contentEditable=false) */
const calendarGridGroup = {
  id: 'grid-1',
  type: 'group',
  extensionType: 'calendar-grid',
  extension: { variant: 'month' },
  visible: true,
  hasControls: true,
  movable: false,
  deleteable: false,
  contentEditable: false,
  getObjects: () => [],
}

/** GroupPlugin.group() 이 만드는 일반 그룹 */
const plainGroup = {
  id: 'g1',
  type: 'group',
  extensionType: 'group',
  visible: true,
  hasControls: true,
  getObjects: () => [],
}

const rectA = { id: 'a', type: 'rect', extensionType: 'shape', visible: true, hasControls: true }
const rectB = { id: 'b', type: 'rect', extensionType: 'shape', visible: true, hasControls: true }

function wire(selection: Array<Record<string, unknown>>) {
  act(() => {
    useAppStore.setState({
      ready: true,
      canvas: { requestRenderAll, getObjects: () => [] },
      activeSelection: selection,
      getPlugin: (name: string) => (name === 'GroupPlugin' ? { unGroup, group } : undefined),
      showSidePanel: false,
    } as never)
  })
  return render(<ControlBar />)
}

const ungroupButton = () => screen.queryByRole('button', { name: '그룹해제' })
const groupButton = () => screen.queryByRole('button', { name: '그룹화' })
const bar = () => document.getElementById('control-bar')

beforeEach(() => {
  unGroup.mockClear()
  group.mockClear()
  requestRenderAll.mockClear()
  act(() => {
    useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: false } }))
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    useAppStore.setState({ activeSelection: [], canvas: null } as never)
  })
})

describe("ControlBar — '그룹해제' 버튼 게이트 (T2 calendar-grid)", () => {
  it('(1) calendar-grid 그룹 선택: 컨트롤 바는 렌더되지만 그룹해제 버튼은 없다', () => {
    wire([calendarGridGroup])
    expect(bar()).not.toBeNull()
    expect(ungroupButton()).toBeNull()
    expect(groupButton()).toBeNull()
  })

  it('(1b) editMode(관리자)에서도 calendar-grid 그룹에는 그룹해제 버튼이 없다', () => {
    act(() => {
      useSettingsStore.setState((s) => ({ currentSettings: { ...s.currentSettings, editMode: true } }))
    })
    wire([calendarGridGroup])
    expect(bar()).not.toBeNull()
    expect(ungroupButton()).toBeNull()
  })

  it('(2) 일반 그룹 선택: 그룹해제 버튼 노출, 클릭 → GroupPlugin.unGroup 1회 + requestRenderAll (회귀)', () => {
    wire([plainGroup])
    expect(bar()).not.toBeNull()
    expect(screen.getByText('그룹')).toBeInTheDocument()
    const btn = ungroupButton()
    expect(btn).not.toBeNull()
    fireEvent.click(btn as HTMLElement)
    expect(unGroup).toHaveBeenCalledTimes(1)
    expect(requestRenderAll).toHaveBeenCalled()
    expect(group).not.toHaveBeenCalled()
  })

  it('(3) 다중 선택(2개): 그룹화 버튼만, 그룹해제 없음 (기존 동작)', () => {
    wire([rectA, rectB])
    expect(groupButton()).not.toBeNull()
    expect(ungroupButton()).toBeNull()
    fireEvent.click(groupButton() as HTMLElement)
    expect(group).toHaveBeenCalledTimes(1)
    expect(unGroup).not.toHaveBeenCalled()
  })
})
