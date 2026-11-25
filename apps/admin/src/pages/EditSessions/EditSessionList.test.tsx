// @vitest-environment happy-dom
// 편집데이터 관리 목록 — 주문 연결 세션의 편집기 열기·완료·삭제·합성은 확인 창(사전 통지 체크)을 거치고,
// 성공한 작업마다 사후 통지를 안내한다. 비연결 세션은 기존 Popconfirm·즉시 실행 경로를 쓴다.
import {
  buttonByText,
  createTestQueryClient,
  deferred,
  openDialog,
  openPopover,
  renderWithAntd,
  stubAntdFeedback,
  type AntdFeedbackSpies,
} from '../../test/renderWithAntd';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Modal, type ModalFuncProps } from 'antd';
import type {
  BulkDeleteResponse,
  EditorSessionResponse,
  StaffSessionItem,
  StaffSessionListResponse,
} from '../../api/edit-data';
import { makeSessionItem } from '../../test/sessionFixtures';
import { orderLinkedAfterActionMessage, orderLinkedConfirmCopy } from './editDataHelpers';
import { EditSessionList } from './EditSessionList';

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  openEditorSession: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
  bulkDelete: vi.fn(),
  downloadSessionFile: vi.fn(),
  saveDownloadedFile: vi.fn(),
  listSites: vi.fn(),
}));

vi.mock('../../api/edit-data', () => ({
  editDataApi: {
    listSessions: mocks.listSessions,
    openEditorSession: mocks.openEditorSession,
    complete: mocks.complete,
    remove: mocks.remove,
    bulkDelete: mocks.bulkDelete,
    downloadSessionFile: mocks.downloadSessionFile,
  },
  saveDownloadedFile: mocks.saveDownloadedFile,
}));

vi.mock('../../api/sites', () => ({ sitesApi: { list: mocks.listSites } }));

vi.mock('../../stores/authStore', () => {
  const state = { currentSiteId: 'site-1', user: { role: 'SUPER_ADMIN' } };
  return { useAuthStore: <T,>(selector: (s: typeof state) => T): T => selector(state) };
});

vi.mock('./SynthesizeModal', async () => {
  const { createElement } = await import('react');
  return {
    SynthesizeModal: ({ session, open }: { session: { id: string } | null; open: boolean }) =>
      open && session ? createElement('div', { 'data-testid': 'synthesize-modal' }, session.id) : null,
  };
});

vi.mock('./SessionJobsDrawer', () => ({ SessionJobsDrawer: () => null }));

const linked = makeSessionItem({ id: 'sess-linked', memberId: 'member-linked' });
const plain = makeSessionItem({ id: 'sess-plain', orderSeqno: null, memberId: 'member-plain' });

function page(items: StaffSessionItem[]): StaffSessionListResponse {
  return { items, total: items.length, page: 1, limit: 20 };
}

function editorSession(sessionId: string): EditorSessionResponse {
  return {
    success: true,
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresIn: 3600,
    grantId: 'grant-1',
    grantExpiresAt: '2026-10-03T01:00:00.000Z',
    capabilities: ['session.read', 'session.update'],
    sessionId,
    editorPath: `/embed?sessionId=${sessionId}&adminEdit=session`,
  };
}

let feedback: AntdFeedbackSpies;
let windowOpen: MockInstance<typeof window.open>;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listSessions.mockResolvedValue(page([linked, plain]));
  mocks.openEditorSession.mockImplementation((id: string) => Promise.resolve(editorSession(id)));
  mocks.complete.mockResolvedValue({ success: true });
  mocks.remove.mockResolvedValue({ success: true });
  mocks.listSites.mockResolvedValue([]);
  feedback = stubAntdFeedback();
  windowOpen = vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function renderList(firstMemberId = 'member-linked'): Promise<void> {
  renderWithAntd(<EditSessionList />, { queryClient: createTestQueryClient() });
  await screen.findByText(firstMemberId);
}

function row(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`tr[data-row-key="${id}"]`);
  if (!el) throw new Error(`행 ${id} 가 없습니다`);
  return el;
}

function shownDialog(): HTMLElement {
  const dialog = openDialog();
  if (!dialog) throw new Error('열린 확인 창이 없습니다');
  return dialog;
}

/** 열린 확인 창에서 사전 통지를 체크하고 진행 버튼을 누른다 */
function acknowledgeAndConfirm(okText: string): void {
  const dialog = shownDialog();
  const checkbox = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error('사전 통지 체크박스가 없습니다');
  fireEvent.click(checkbox);
  fireEvent.click(buttonByText(dialog, okText));
}

function warningsWith(text: string): number {
  return feedback.warning.mock.calls.filter((call) => call[0] === text).length;
}

describe('EditSessionList — 주문 연결 세션', () => {
  it('주문 연결 행에만 주문 연결 태그와 통지 정보 복사 버튼이 있다', async () => {
    await renderList();
    expect(within(row('sess-linked')).queryByText('주문 연결')).not.toBeNull();
    expect(within(row('sess-linked')).queryByText('통지 정보 복사')).not.toBeNull();
    expect(within(row('sess-plain')).queryByText('주문 연결')).toBeNull();
    expect(within(row('sess-plain')).queryByText('통지 정보 복사')).toBeNull();
  });

  it('편집기에서 열기는 확인 창을 먼저 띄우고 체크 전에는 편집 권한을 발급하지 않는다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '편집기에서 열기'));
    const dialog = shownDialog();
    expect(within(dialog).getByText(orderLinkedConfirmCopy('open', linked).title)).toBeTruthy();
    expect(mocks.openEditorSession).not.toHaveBeenCalled();
  });

  it('완료 처리는 Popconfirm 대신 확인 창을 띄운다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '완료 처리'));
    const dialog = shownDialog();
    expect(within(dialog).getByText(orderLinkedConfirmCopy('complete', linked).title)).toBeTruthy();
    expect(screen.queryByText('이 세션을 완료 처리할까요?')).toBeNull();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it('삭제는 Popconfirm 대신 확인 창을 띄운다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '삭제'));
    const dialog = shownDialog();
    expect(within(dialog).getByText(orderLinkedConfirmCopy('delete', linked).title)).toBeTruthy();
    expect(screen.queryByText('편집 세션을 삭제할까요?')).toBeNull();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('합성/재합성은 확인 창에서 체크 후 계속을 눌러야 합성 창을 연다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '합성/재합성'));
    expect(within(shownDialog()).getByText(orderLinkedConfirmCopy('synthesize', linked).title)).toBeTruthy();
    expect(screen.queryByTestId('synthesize-modal')).toBeNull();

    acknowledgeAndConfirm('계속');
    expect(screen.getByTestId('synthesize-modal').textContent).toBe('sess-linked');
    expect(feedback.warning).not.toHaveBeenCalled();
  });

  it('확인 후 완료 처리에 성공하면 사후 통지를 안내한다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '완료 처리'));
    acknowledgeAndConfirm('완료 처리');

    await waitFor(() =>
      expect(feedback.warning).toHaveBeenCalledWith(orderLinkedAfterActionMessage('complete', linked), 10),
    );
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.complete).toHaveBeenCalledWith('sess-linked');
  });

  it('확인 후 편집기를 열면 편집기 새 탭을 열고 사후 통지를 안내한다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '편집기에서 열기'));
    acknowledgeAndConfirm('편집기에서 열기');

    await waitFor(() =>
      expect(feedback.warning).toHaveBeenCalledWith(orderLinkedAfterActionMessage('open', linked), 10),
    );
    expect(mocks.openEditorSession).toHaveBeenCalledWith('sess-linked', { allowDelete: false });
    expect(windowOpen).toHaveBeenCalledWith(
      expect.stringContaining('#token='),
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('확인 후 삭제가 실패하면 오류만 알리고 사후 통지는 안내하지 않는다', async () => {
    mocks.remove.mockRejectedValue(new Error('x'));
    await renderList();
    fireEvent.click(buttonByText(row('sess-linked'), '삭제'));
    acknowledgeAndConfirm('삭제');

    await waitFor(() => expect(feedback.error).toHaveBeenCalledWith('삭제에 실패했습니다.'));
    expect(mocks.remove).toHaveBeenCalledWith('sess-linked');
    expect(feedback.warning).not.toHaveBeenCalled();
  });

  it('같은 세션 완료를 두 번 확인하고 하나만 성공하면 사후 통지를 1회 안내한다', async () => {
    // 사후 안내 문구는 통지 대상(사이트명)만 담으므로 두 세션의 사이트명을 달리해 안내를 구분한다
    const other = makeSessionItem({
      id: 'sess-linked-2',
      memberId: 'member-linked-2',
      siteName: '테스트사이트2',
    });
    mocks.listSessions.mockResolvedValue(page([linked, other]));
    const first = deferred<{ success: boolean }>();
    const otherRun = deferred<{ success: boolean }>();
    const second = deferred<{ success: boolean }>();
    mocks.complete
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(otherRun.promise)
      .mockReturnValueOnce(second.promise);
    await renderList();

    fireEvent.click(buttonByText(row('sess-linked'), '완료 처리'));
    acknowledgeAndConfirm('완료 처리');
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(1));
    // 다른 세션 작업이 시작되면 첫 행의 진행 표시가 풀려 같은 세션을 다시 확인할 수 있다
    fireEvent.click(buttonByText(row('sess-linked-2'), '완료 처리'));
    acknowledgeAndConfirm('완료 처리');
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(buttonByText(row('sess-linked'), '완료 처리').classList.contains('ant-btn-loading')).toBe(false),
    );
    fireEvent.click(buttonByText(row('sess-linked'), '완료 처리'));
    acknowledgeAndConfirm('완료 처리');
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledTimes(3));
    expect(mocks.complete.mock.calls.map((call) => call[0])).toEqual([
      'sess-linked',
      'sess-linked-2',
      'sess-linked',
    ]);

    const linkedNotice = orderLinkedAfterActionMessage('complete', linked);
    await act(async () => {
      first.resolve({ success: true });
      await first.promise;
    });
    await waitFor(() => expect(warningsWith(linkedNotice)).toBe(1));
    await act(async () => {
      second.reject(new Error('x'));
      await second.promise.catch(() => undefined);
    });
    await waitFor(() => expect(feedback.error).toHaveBeenCalledWith('완료 처리에 실패했습니다.'));
    await act(async () => {
      otherRun.resolve({ success: true });
      await otherRun.promise;
    });
    await waitFor(() =>
      expect(warningsWith(orderLinkedAfterActionMessage('complete', other))).toBe(1),
    );

    expect(warningsWith(linkedNotice)).toBe(1);
    expect(feedback.warning).toHaveBeenCalledTimes(2);
  });

  it('보관기간이 만료된 주문 연결 행은 편집기 열기·완료·합성이 비활성이고 확인 창을 띄우지 않는다', async () => {
    const expired = makeSessionItem({
      id: 'sess-expired',
      memberId: 'member-expired',
      retention: { days: 30, until: '2026-09-01T00:00:00.000Z', state: 'expired', anchor: 'createdAt' },
    });
    mocks.listSessions.mockResolvedValue(page([expired]));
    await renderList('member-expired');

    for (const label of ['편집기에서 열기', '완료 처리', '합성/재합성']) {
      const button = buttonByText(row('sess-expired'), label);
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(openDialog()).toBeNull();
    }
    expect(mocks.openEditorSession).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(screen.queryByTestId('synthesize-modal')).toBeNull();

    // 삭제는 보관기간과 무관하게 허용되며 같은 확인 창을 거친다
    fireEvent.click(buttonByText(row('sess-expired'), '삭제'));
    expect(within(shownDialog()).getByText(orderLinkedConfirmCopy('delete', expired).title)).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
  });
});

describe('EditSessionList — 주문 연결이 아닌 세션', () => {
  it('편집기에서 열기는 확인 창 없이 바로 편집 권한을 발급한다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-plain'), '편집기에서 열기'));

    await waitFor(() => expect(windowOpen).toHaveBeenCalledTimes(1));
    expect(mocks.openEditorSession).toHaveBeenCalledWith('sess-plain', { allowDelete: false });
    expect(openDialog()).toBeNull();
    expect(feedback.warning).not.toHaveBeenCalled();
  });

  it('완료 처리는 Popconfirm 확인 후 실행하고 사후 통지를 안내하지 않는다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-plain'), '완료 처리'));
    const popover = await waitFor(() => {
      const el = openPopover();
      if (!el) throw new Error('Popconfirm 이 열리지 않았습니다');
      return el;
    });
    expect(within(popover).getByText('이 세션을 완료 처리할까요?')).toBeTruthy();
    fireEvent.click(buttonByText(popover, '완료 처리'));

    await waitFor(() => expect(feedback.success).toHaveBeenCalledWith('편집 세션을 완료 처리했습니다.'));
    expect(mocks.complete).toHaveBeenCalledWith('sess-plain');
    expect(openDialog()).toBeNull();
    expect(feedback.warning).not.toHaveBeenCalled();
  });

  it('삭제는 Popconfirm 을 띄우고 확인 전에는 삭제하지 않는다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-plain'), '삭제'));
    const popover = await waitFor(() => {
      const el = openPopover();
      if (!el) throw new Error('Popconfirm 이 열리지 않았습니다');
      return el;
    });
    expect(within(popover).getByText('편집 세션을 삭제할까요?')).toBeTruthy();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(openDialog()).toBeNull();
  });
});

describe('EditSessionList — 선택 삭제', () => {
  let confirmCalls: ModalFuncProps[];

  beforeEach(() => {
    confirmCalls = [];
    vi.spyOn(Modal, 'confirm').mockImplementation((config: ModalFuncProps) => {
      confirmCalls.push(config);
      return { destroy: vi.fn(), update: vi.fn() };
    });
  });

  function rowCheckbox(id: string): HTMLInputElement {
    const checkbox = row(id).querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!checkbox) throw new Error(`행 ${id} 체크박스가 없습니다`);
    return checkbox;
  }

  function bulkButton(): HTMLButtonElement {
    const button = screen.getByText(/^선택 삭제 \(\d+\)$/).closest('button');
    if (!button) throw new Error('선택 삭제 버튼이 없습니다');
    return button;
  }

  it('상품 열에 주문 상품·사이즈를 보여 주고, 없으면 템플릿셋 이름을 보여 준다', async () => {
    const withMeta = makeSessionItem({
      id: 'sess-meta',
      memberId: 'member-meta',
      orderMeta: { productName: '무선 책자', size: 'A5' },
      templateSetName: '책자 템플릿',
    });
    const templateOnly = makeSessionItem({
      id: 'sess-template',
      memberId: 'member-template',
      templateSetName: '명함 템플릿',
    });
    mocks.listSessions.mockResolvedValue(page([withMeta, templateOnly]));
    await renderList('member-meta');
    expect(within(row('sess-meta')).queryByText('무선 책자 · A5')).not.toBeNull();
    expect(within(row('sess-template')).queryByText('명함 템플릿')).not.toBeNull();
  });

  it('선택이 없으면 버튼이 비활성이고, 삭제할 수 없는 행은 체크박스가 비활성이다', async () => {
    const locked = makeSessionItem({ id: 'sess-locked', memberId: 'member-locked', canDelete: false });
    mocks.listSessions.mockResolvedValue(page([linked, locked]));
    await renderList();
    expect(bulkButton().disabled).toBe(true);
    expect(screen.getByText('선택 삭제 (0)')).toBeTruthy();
    expect(rowCheckbox('sess-locked').disabled).toBe(true);
    expect(rowCheckbox('sess-linked').disabled).toBe(false);
  });

  it('선택 삭제는 확인 창을 거쳐 선택한 id 로 bulkDelete 를 호출하고 결과를 알린다', async () => {
    const result: BulkDeleteResponse = {
      deleted: 2,
      failed: 0,
      results: [
        { sessionId: 'sess-linked', success: true, purgeAfter: '2026-10-05T00:00:00.000Z' },
        { sessionId: 'sess-plain', success: true, purgeAfter: '2026-10-05T00:00:00.000Z' },
      ],
    };
    mocks.bulkDelete.mockResolvedValue(result);
    await renderList();

    fireEvent.click(rowCheckbox('sess-linked'));
    fireEvent.click(rowCheckbox('sess-plain'));
    await waitFor(() => expect(bulkButton().disabled).toBe(false));
    expect(screen.getByText('선택 삭제 (2)')).toBeTruthy();

    fireEvent.click(bulkButton());
    expect(confirmCalls).toHaveLength(1);
    const config = confirmCalls[0];
    expect(String(config.title)).toContain('2건');
    expect(mocks.bulkDelete).not.toHaveBeenCalled();

    // 확인 창 본문 — 주문번호가 붙은 건수 경고와 48시간 복구 안내
    renderWithAntd(<>{config.content}</>);
    expect(screen.getByText('주문번호가 붙은 세션 1건이 포함되어 있습니다.')).toBeTruthy();
    expect(
      screen.getByText(
        "삭제한 세션은 48시간 동안 '삭제 리스트'에서 복구할 수 있고, 그 뒤에는 파일까지 영구 삭제됩니다.",
      ),
    ).toBeTruthy();

    await act(async () => {
      await config.onOk?.();
    });
    await waitFor(() => expect(mocks.bulkDelete).toHaveBeenCalledTimes(1));
    expect(mocks.bulkDelete).toHaveBeenCalledWith(['sess-linked', 'sess-plain']);
    await waitFor(() =>
      expect(feedback.success).toHaveBeenCalledWith(
        '2건을 삭제했습니다. 48시간 동안 [삭제 리스트]에서 복구할 수 있습니다.',
        5,
      ),
    );
    await waitFor(() => expect(screen.getByText('선택 삭제 (0)')).toBeTruthy());
  });

  it('일부 실패하면 성공·실패 건수와 첫 실패 사유를 경고로 알린다', async () => {
    mocks.bulkDelete.mockResolvedValue({
      deleted: 1,
      failed: 1,
      results: [
        { sessionId: 'sess-linked', success: true },
        { sessionId: 'sess-plain', success: false, code: 'STAFF_DELETE_NOT_ALLOWED' },
      ],
    } satisfies BulkDeleteResponse);
    await renderList();
    fireEvent.click(rowCheckbox('sess-linked'));
    fireEvent.click(rowCheckbox('sess-plain'));
    await waitFor(() => expect(bulkButton().disabled).toBe(false));
    fireEvent.click(bulkButton());
    await act(async () => {
      await confirmCalls[0].onOk?.();
    });
    await waitFor(() =>
      expect(feedback.warning).toHaveBeenCalledWith(
        '삭제 성공 1건, 실패 1건 — 삭제 권한이 없습니다',
        10,
      ),
    );
  });

  it('단건 삭제 확인에도 48시간 복구 안내가 있다', async () => {
    await renderList();
    fireEvent.click(buttonByText(row('sess-plain'), '삭제'));
    const popover = await waitFor(() => {
      const el = openPopover();
      if (!el) throw new Error('Popconfirm 이 열리지 않았습니다');
      return el;
    });
    expect(popover.textContent).toContain("48시간 동안 '삭제 리스트'에서 복구할 수 있고");
  });
});
