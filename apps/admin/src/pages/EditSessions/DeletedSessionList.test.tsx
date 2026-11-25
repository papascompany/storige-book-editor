// @vitest-environment happy-dom
// 삭제 리스트 — 삭제된 주문 연결 세션의 사후 통지 정보는 여기서 복사한다.
import {
  buttonByText,
  createTestQueryClient,
  openPopover,
  renderWithAntd,
  stubAntdFeedback,
  type AntdFeedbackSpies,
} from '../../test/renderWithAntd';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { StaffSessionItem, StaffSessionListResponse } from '../../api/edit-data';
import { makeSessionItem } from '../../test/sessionFixtures';
import { DeletedSessionList } from './DeletedSessionList';

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  restore: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock('../../api/edit-data', () => ({
  editDataApi: { listSessions: mocks.listSessions, restore: mocks.restore },
}));

vi.mock('../../api/sites', () => ({ sitesApi: { list: mocks.listSites } }));

vi.mock('../../stores/authStore', () => {
  const state = { currentSiteId: 'site-1', user: { role: 'SUPER_ADMIN' } };
  return { useAuthStore: <T,>(selector: (s: typeof state) => T): T => selector(state) };
});

const deletedAt = '2026-10-02T00:00:00.000Z';
const linked = makeSessionItem({ id: 'sess-linked', memberId: 'member-linked', deletedAt });
const plain = makeSessionItem({ id: 'sess-plain', orderSeqno: null, memberId: 'member-plain', deletedAt });

function page(items: StaffSessionItem[]): StaffSessionListResponse {
  return { items, total: items.length, page: 1, limit: 20 };
}

let feedback: AntdFeedbackSpies;
let writeText: MockInstance<(data: string) => Promise<void>>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listSessions.mockResolvedValue(page([linked, plain]));
  mocks.restore.mockResolvedValue({ success: true });
  mocks.listSites.mockResolvedValue([]);
  feedback = stubAntdFeedback();
  writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`tr[data-row-key="${id}"]`);
  if (!el) throw new Error(`행 ${id} 가 없습니다`);
  return el;
}

describe('DeletedSessionList — 통지 정보 복사', () => {
  it('삭제된 주문 연결 행에만 통지 정보 복사 버튼이 있다', async () => {
    renderWithAntd(<DeletedSessionList />, { queryClient: createTestQueryClient() });
    await screen.findByText('member-linked');
    expect(within(row('sess-linked')).queryByText('통지 정보 복사')).not.toBeNull();
    expect(within(row('sess-plain')).queryByText('통지 정보 복사')).toBeNull();
  });

  it('통지 정보 복사는 삭제 세션을 포함해 재조회한 값으로 삭제 시각을 넣어 복사한다', async () => {
    renderWithAntd(<DeletedSessionList />, { queryClient: createTestQueryClient() });
    await screen.findByText('member-linked');
    mocks.listSessions.mockClear();

    fireEvent.click(buttonByText(row('sess-linked'), '통지 정보 복사'));

    await waitFor(() => expect(feedback.success).toHaveBeenCalledWith('파트너 통지 정보를 복사했습니다.'));
    expect(mocks.listSessions).toHaveBeenCalledWith({
      siteId: 'site-1',
      orderSeqno: 1001,
      deleted: 'include',
      limit: 100,
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = String(writeText.mock.calls[0][0]);
    expect(text).toContain('세션 ID: sess-linked');
    expect(text).toContain('상태: 삭제됨 (2026-10-02T00:00:00Z)');
  });
});

describe('DeletedSessionList — 관리자 삭제 48시간 복구창', () => {
  // 2026-11-25 12:00 KST
  const NOW = new Date('2026-11-25T03:00:00.000Z');
  const staffOpen = makeSessionItem({
    id: 'sess-staff-open',
    orderSeqno: null,
    memberId: 'member-staff-open',
    deletedAt: '2026-11-24T10:00:00.000Z',
    purgeAfter: '2026-11-26T10:00:00.000Z',
  });
  const staffSoon = makeSessionItem({
    id: 'sess-staff-soon',
    orderSeqno: null,
    memberId: 'member-staff-soon',
    deletedAt: '2026-11-23T03:20:00.000Z',
    purgeAfter: '2026-11-25T03:20:00.000Z',
  });
  const staffClosed = makeSessionItem({
    id: 'sess-staff-closed',
    orderSeqno: null,
    memberId: 'member-staff-closed',
    deletedAt: '2026-11-23T02:00:00.000Z',
    purgeAfter: '2026-11-25T02:00:00.000Z',
  });
  const customer = makeSessionItem({
    id: 'sess-customer',
    orderSeqno: null,
    memberId: 'member-customer',
    deletedAt: '2026-01-01T00:00:00.000Z',
    purgeAfter: null,
  });

  beforeEach(() => {
    // Date 만 고정한다(react-query·waitFor 의 타이머는 실제로 둔다)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    mocks.listSessions.mockResolvedValue(page([staffOpen, staffSoon, staffClosed, customer]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderDeleted(): Promise<void> {
    renderWithAntd(<DeletedSessionList />, { queryClient: createTestQueryClient() });
    await screen.findByText('member-staff-open');
  }

  it('삭제 주체를 관리자 삭제/고객 삭제로 표시한다', async () => {
    await renderDeleted();
    expect(within(row('sess-staff-open')).queryByText('관리자 삭제')).not.toBeNull();
    expect(within(row('sess-staff-closed')).queryByText('관리자 삭제')).not.toBeNull();
    expect(within(row('sess-customer')).queryByText('고객 삭제')).not.toBeNull();
    expect(within(row('sess-customer')).queryByText('관리자 삭제')).toBeNull();
  });

  it('복구 기한 열 — 남은 시간·KST 기한, 1시간 미만은 분, 지남은 영구 삭제 예정, 고객 삭제는 기한 없음', async () => {
    await renderDeleted();
    expect(within(row('sess-staff-open')).queryByText('31시간 남음')).not.toBeNull();
    expect(within(row('sess-staff-open')).queryByText('2026-11-26 19:00 (KST)')).not.toBeNull();
    expect(within(row('sess-staff-soon')).queryByText('20분 남음')).not.toBeNull();
    expect(within(row('sess-staff-closed')).queryByText('영구 삭제 예정')).not.toBeNull();
    expect(within(row('sess-customer')).queryByText('기한 없음')).not.toBeNull();
  });

  it('기한이 지난 행은 복구 버튼이 비활성이고 눌러도 복구하지 않는다', async () => {
    await renderDeleted();
    const closedButton = buttonByText(row('sess-staff-closed'), '복구');
    expect(closedButton.disabled).toBe(true);
    fireEvent.click(closedButton);
    expect(mocks.restore).not.toHaveBeenCalled();
    expect(buttonByText(row('sess-staff-open'), '복구').disabled).toBe(false);
    expect(buttonByText(row('sess-customer'), '복구').disabled).toBe(false);
  });

  it('기한이 지난 행의 복구 버튼에 복구 기한 안내 툴팁을 단다', async () => {
    await renderDeleted();
    const closedButton = buttonByText(row('sess-staff-closed'), '복구');
    const wrapper = closedButton.parentElement;
    if (!wrapper) throw new Error('복구 버튼 감싸개가 없습니다');
    fireEvent.mouseEnter(wrapper);
    await waitFor(() => expect(screen.getByText('복구 기한(48시간)이 지났습니다')).toBeTruthy());
  });

  it('서버가 RESTORE_WINDOW_CLOSED 로 거절하면 복구 기한 문구로 알린다', async () => {
    mocks.restore.mockRejectedValue({
      response: {
        status: 409,
        data: { code: 'RESTORE_WINDOW_CLOSED', message: '복구 기한(48시간)이 지나 복구할 수 없습니다.' },
      },
    });
    await renderDeleted();
    fireEvent.click(buttonByText(row('sess-staff-open'), '복구'));
    const popover = await waitFor(() => {
      const el = openPopover();
      if (!el) throw new Error('Popconfirm 이 열리지 않았습니다');
      return el;
    });
    fireEvent.click(buttonByText(popover, '복구'));
    await waitFor(() =>
      expect(feedback.error).toHaveBeenCalledWith('복구 기한(48시간)이 지나 복구할 수 없습니다'),
    );
    expect(mocks.restore).toHaveBeenCalledWith('sess-staff-open');
  });
});
