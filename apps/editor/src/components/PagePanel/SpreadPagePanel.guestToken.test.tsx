/**
 * 2026-09-29 (T5) — SpreadPagePanel 내지 순서 저장이 바인딩된 세션의 guestToken 을 쓴다.
 *
 *  - /embed 는 currentSession.guestToken 을 prop 으로 넘긴다(embed 는 useGuestStore 를 채우지 않음).
 *  - prop 이 있으면 스토어 값보다 우선 → 게스트 세션은 게스트 경로(updateGuest)로 저장한다.
 *  - prop 이 없거나 null 이면 종전대로 useGuestStore 값을 쓴다(비-embed 사용처 동작 불변).
 */
import type { ReactNode, DragEvent } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const sessionUpdate = vi.fn(async (..._a: unknown[]) => ({}))
const sessionUpdateGuest = vi.fn(async (..._a: unknown[]) => ({}))
vi.mock('@/api/edit-sessions', () => ({
  editSessionsApi: {
    update: (...a: unknown[]) => sessionUpdate(...a),
    updateGuest: (...a: unknown[]) => sessionUpdateGuest(...a),
  },
}))

interface FakeCanvas {
  id: string
  getObjects: () => Array<{ meta?: { system?: string } }>
}
function underlayCanvas(id: string): FakeCanvas {
  return { id, getObjects: () => [{ meta: { system: 'innerPdfGuide' } }] }
}

const editorState = {
  pages: [
    { id: 'p0', canvasData: { width: 200, height: 100 } },
    { id: 'p1', canvasData: { width: 100, height: 100 } },
    { id: 'p2', canvasData: { width: 100, height: 100 } },
  ],
  currentPageIndex: 0,
  canDeletePage: () => true,
  bindingType: null,
  pageStep: null,
  getPageAddUnit: () => 1,
  getPageStepPerCanvas: () => 1,
  getPageDeleteUnit: () => 1,
  getDeleteGroup: (id: string) => [id],
}
vi.mock('@/stores/useEditorStore', () => {
  const useEditorStore = Object.assign(
    (sel: (s: typeof editorState) => unknown) => sel(editorState),
    { getState: () => editorState },
  )
  return { useEditorStore, useCanAddPage: () => true }
})

const reorderByIndex = vi.fn()
const appState = {
  setPage: vi.fn(),
  addPage: vi.fn(),
  deletePage: vi.fn(),
  reorderByIndex: (...a: unknown[]) => reorderByIndex(...a),
  allCanvas: [underlayCanvas('c0'), underlayCanvas('c1'), underlayCanvas('c2')],
  screenshots: [] as string[],
}
vi.mock('@/stores/useAppStore', () => ({
  useAppStore: Object.assign(
    (sel: (s: typeof appState) => unknown) => sel(appState),
    { getState: () => appState },
  ),
}))

const settingsState = { spreadConfig: null, hasCoverSlot: true }
vi.mock('@/stores/useSettingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel: (s: typeof settingsState) => unknown) => sel(settingsState),
    { getState: () => settingsState },
  ),
}))

const guestState: { guestToken: string | null } = { guestToken: null }
vi.mock('@/stores/useGuestStore', () => ({
  useGuestStore: (sel: (s: typeof guestState) => unknown) => sel(guestState),
}))

vi.mock('@/stores/useToastStore', () => ({ showToast: vi.fn() }))

interface FakePageItemProps {
  page: { id: string }
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void
  onDrop?: (e: DragEvent<HTMLDivElement>) => void
}
vi.mock('./PageItem', () => ({
  PageItem: ({ page, onDragStart, onDrop }: FakePageItemProps) => (
    <div data-testid={`page-${page.id}`} draggable onDragStart={onDragStart} onDrop={onDrop} />
  ),
}))
vi.mock('./SpreadThumbnailItem', () => ({ SpreadThumbnailItem: () => <div /> }))
vi.mock('./PageStepWarning', () => ({ PageStepWarning: () => null }))

import { SpreadPagePanel, resolveReorderGuestToken } from './SpreadPagePanel'

function renderPanel(props: { guestToken?: string | null } = {}): void {
  const wrap = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/embed?sessionId=s1']}>{children}</MemoryRouter>
  )
  render(<SpreadPagePanel orientation="horizontal" {...props} />, { wrapper: wrap })
}

/** 내지 p1 을 p2 뒤로 드래그-드롭 → reorder + underlay 순서 저장 */
function dragInnerPage(): void {
  fireEvent.dragStart(screen.getByTestId('page-p1'))
  fireEvent.drop(screen.getByTestId('page-p2'))
}

const orderPayload = expect.objectContaining({
  metadata: expect.objectContaining({ contentPdfPageOrder: expect.any(Array) }),
})

describe('resolveReorderGuestToken', () => {
  it('prop 이 있으면 스토어보다 우선', () => {
    expect(resolveReorderGuestToken('g1', 'store')).toBe('g1')
  })
  it('prop 이 null/undefined 면 스토어 값', () => {
    expect(resolveReorderGuestToken(null, 'store')).toBe('store')
    expect(resolveReorderGuestToken(undefined, 'store')).toBe('store')
  })
  it('둘 다 없으면 null', () => {
    expect(resolveReorderGuestToken(undefined, null)).toBeNull()
  })
})

describe('SpreadPagePanel — 내지 순서 저장 경로 (T5)', () => {
  beforeEach(() => {
    sessionUpdate.mockClear()
    sessionUpdateGuest.mockClear()
    reorderByIndex.mockClear()
    guestState.guestToken = null
  })

  it('guestToken prop(게스트 세션) → updateGuest(s1, g1) 로 저장, 회원 update 미호출', async () => {
    renderPanel({ guestToken: 'g1' })
    dragInnerPage()
    expect(reorderByIndex).toHaveBeenCalledWith([0, 2, 1])
    await waitFor(() => expect(sessionUpdateGuest).toHaveBeenCalledTimes(1))
    expect(sessionUpdateGuest).toHaveBeenCalledWith('s1', 'g1', orderPayload)
    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('prop 이 스토어 guestToken 보다 우선', async () => {
    guestState.guestToken = 'store-token'
    renderPanel({ guestToken: 'g1' })
    dragInnerPage()
    await waitFor(() => expect(sessionUpdateGuest).toHaveBeenCalledTimes(1))
    expect(sessionUpdateGuest).toHaveBeenCalledWith('s1', 'g1', orderPayload)
    expect(sessionUpdate).not.toHaveBeenCalled()
  })

  it('prop 미지정 + 스토어 비어 있음(회원) → update(s1) — 종전 동작', async () => {
    renderPanel()
    dragInnerPage()
    await waitFor(() => expect(sessionUpdate).toHaveBeenCalledTimes(1))
    expect(sessionUpdate).toHaveBeenCalledWith('s1', orderPayload)
    expect(sessionUpdateGuest).not.toHaveBeenCalled()
  })

  it('prop null(embed 회원 세션) + 스토어 값 있음 → 스토어 값으로 updateGuest — 종전 폴백 유지', async () => {
    guestState.guestToken = 'store-token'
    renderPanel({ guestToken: null })
    dragInnerPage()
    await waitFor(() => expect(sessionUpdateGuest).toHaveBeenCalledTimes(1))
    expect(sessionUpdateGuest).toHaveBeenCalledWith('s1', 'store-token', orderPayload)
    expect(sessionUpdate).not.toHaveBeenCalled()
  })
})
