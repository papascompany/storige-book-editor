// @vitest-environment happy-dom
// 삭제 리스트 — 삭제된 주문 연결 세션의 사후 통지 정보는 여기서 복사한다.
import {
  buttonByText,
  createTestQueryClient,
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
