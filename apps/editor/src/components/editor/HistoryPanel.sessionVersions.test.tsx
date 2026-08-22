import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import HistoryPanel, { type SessionVersionsSource } from './HistoryPanel'
import type { EditSessionVersionSummary } from '@/api/edit-sessions'
import { useSaveStore } from '@/stores/useSaveStore'

/**
 * P1-4 (2026-08-22): 임베드 세션 버전 이력 패널 + "여기로 복원".
 * - 소스 주입 시 목록을 최신순으로 보여주고(사유 배지·페이지 감소 문구), 레거시 sessionsApi 는 호출하지 않는다.
 * - 복원 = 확인 단계 → restore 콜백 → 성공 토스트 + 팝오버 닫힘 / 실패 토스트 + 상태 원복.
 */

const showToast = vi.fn()
vi.mock('@/stores/useToastStore', () => ({ showToast: (...a: unknown[]) => showToast(...a) }))

const legacyList = vi.fn()
vi.mock('@/api/sessions', () => ({
  sessionsApi: { listVersions: (...a: unknown[]) => legacyList(...a), restoreVersion: vi.fn() },
}))

// 레거시 분기가 켜지지 않도록 sessionId 없음
vi.mock('@/stores/useEditorStore', () => ({
  useEditorStore: (sel: (s: { sessionId: null; userId: null }) => unknown) =>
    sel({ sessionId: null, userId: null }),
}))
vi.mock('@/stores/useAutoSaveSnapshotsStore', () => ({
  useAutoSaveSnapshotsStore: (sel: (s: { snapshots: never[]; clearSnapshots: () => void }) => unknown) =>
    sel({ snapshots: [], clearSnapshots: () => {} }),
}))

const versions: EditSessionVersionSummary[] = [
  {
    id: 'v-old',
    createdAt: '2026-08-22T01:00:00.000Z',
    pageCount: 9,
    nextPageCount: 5,
    reason: 'shrink',
    sessionStatus: 'editing',
  },
  {
    id: 'v-new',
    createdAt: '2026-08-22T05:00:00.000Z',
    pageCount: 5,
    nextPageCount: 5,
    reason: 'autosave',
    sessionStatus: 'editing',
  },
]

function makeSource(over: Partial<SessionVersionsSource> = {}): SessionVersionsSource {
  return {
    list: vi.fn(async () => versions),
    restore: vi.fn(async () => {}),
    ...over,
  }
}

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '변경 이력' }))
  await screen.findByTestId('session-versions')
}

describe('HistoryPanel — 임베드 세션 버전 (P1-4)', () => {
  beforeEach(() => {
    showToast.mockReset()
    legacyList.mockReset()
  })

  it('소스가 주어지면 목록을 최신순으로 렌더하고 레거시 API 는 호출하지 않는다', async () => {
    const source = makeSource()
    render(<HistoryPanel sessionVersions={source} />)
    await openPanel()

    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1))
    const items = await screen.findAllByRole('listitem')
    expect(items).toHaveLength(2)
    // 최신(v-new, autosave) 이 먼저, 절단 직전(v-old, shrink) 이 뒤
    expect(items[0].textContent).toContain('자동 저장')
    expect(items[1].textContent).toContain('페이지 감소 직전')
    expect(items[1].textContent).toContain('9장 → 이후 5장으로 줄어듦')
    expect(legacyList).not.toHaveBeenCalled()
  })

  it('빈 목록/오류 상태를 표시한다', async () => {
    const { unmount } = render(<HistoryPanel sessionVersions={makeSource({ list: vi.fn(async () => []) })} />)
    await openPanel()
    expect(await screen.findByText(/아직 저장 시점이 없습니다/)).toBeInTheDocument()
    unmount()

    render(
      <HistoryPanel
        sessionVersions={makeSource({
          list: vi.fn(async () => {
            throw new Error('403 게스트 토큰 불일치')
          }),
        })}
      />,
    )
    await openPanel()
    expect(await screen.findByRole('alert')).toHaveTextContent('403 게스트 토큰 불일치')
  })

  it('복원: 확인 단계 → restore 콜백 → 성공 토스트 + 팝오버 닫힘', async () => {
    const source = makeSource()
    render(<HistoryPanel sessionVersions={source} />)
    await openPanel()
    await screen.findAllByRole('listitem')

    // 확인 단계 진입(즉시 복원 안 함)
    const restoreButtons = screen.getAllByRole('button', { name: /시점으로 복원$/ })
    fireEvent.click(restoreButtons[1]) // v-old (shrink)
    expect(source.restore).not.toHaveBeenCalled()
    expect(screen.getByText(/복원 직전.*시점으로 목록에 남아/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '여기로 복원 확인' }))
    await waitFor(() => expect(source.restore).toHaveBeenCalledWith('v-old'))
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringContaining('되돌렸습니다'), 'success', 4000))
    await waitFor(() => expect(screen.queryByTestId('session-versions')).toBeNull())
  })

  it('복원 실패: 오류 토스트 + 확인 단계 해제(목록 유지)', async () => {
    const source = makeSource({
      restore: vi.fn(async () => {
        throw new Error('편집 중인 내용을 먼저 저장하지 못했습니다.')
      }),
    })
    render(<HistoryPanel sessionVersions={source} />)
    await openPanel()
    await screen.findAllByRole('listitem')

    fireEvent.click(screen.getAllByRole('button', { name: /시점으로 복원$/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '여기로 복원 확인' }))

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('복원 실패'), 'error', 6000),
    )
    expect(screen.getByTestId('session-versions')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '여기로 복원 확인' })).toBeNull()
    // 다시 복원 버튼 활성
    expect(screen.getAllByRole('button', { name: /시점으로 복원$/ })[0]).not.toBeDisabled()
  })

  it('서버 저장 중(status=saving)에는 복원 버튼과 확인 버튼이 비활성 (in-flight PATCH 경합 차단)', async () => {
    const source = makeSource()
    render(<HistoryPanel sessionVersions={source} />)
    await openPanel()
    await screen.findAllByRole('listitem')
    // 확인 단계 진입 후 저장 시작
    fireEvent.click(screen.getAllByRole('button', { name: /시점으로 복원$/ })[0])
    act(() => {
      useSaveStore.setState({ status: 'saving' } as never)
    })
    const confirmBtn = await screen.findByRole('button', { name: '여기로 복원 확인' })
    expect(confirmBtn).toBeDisabled()
    expect(confirmBtn.textContent).toContain('저장 중')
    act(() => {
      useSaveStore.setState({ status: 'saved' } as never)
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '여기로 복원 확인' })).not.toBeDisabled())
    expect(source.restore).not.toHaveBeenCalled()
  })

  it('legacyVersions=false 면 소스가 없어도 레거시 API 를 호출하지 않는다 (임베드 차단)', async () => {
    render(<HistoryPanel sessionVersions={null} legacyVersions={false} />)
    fireEvent.click(screen.getByRole('button', { name: '변경 이력' }))
    await screen.findByText(/최근 자동저장/)
    expect(legacyList).not.toHaveBeenCalled()
  })

  it('취소하면 확인 단계만 해제된다', async () => {
    const source = makeSource()
    render(<HistoryPanel sessionVersions={source} />)
    await openPanel()
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getAllByRole('button', { name: /시점으로 복원$/ })[0])
    fireEvent.click(screen.getByRole('button', { name: '복원 취소' }))
    expect(screen.queryByRole('button', { name: '여기로 복원 확인' })).toBeNull()
    expect(source.restore).not.toHaveBeenCalled()
  })
})
