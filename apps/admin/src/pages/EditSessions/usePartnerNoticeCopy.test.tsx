// @vitest-environment happy-dom
// 통지 정보 복사 — 복사 직전 재조회 값으로 만들고, 재조회·클립보드 실패 시 목록 값·복사 창으로 계속한다.
import { deferred, stubAntdFeedback, type AntdFeedbackSpies } from '../../test/renderWithAntd';
import { act, renderHook } from '@testing-library/react';
import { isValidElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { StaffSessionItem, StaffSessionListResponse } from '../../api/edit-data';
import { makeSessionItem } from '../../test/sessionFixtures';
import { usePartnerNoticeCopy } from './usePartnerNoticeCopy';

const mocks = vi.hoisted(() => ({ listSessions: vi.fn() }));

vi.mock('../../api/edit-data', () => ({ editDataApi: { listSessions: mocks.listSessions } }));

function page(items: StaffSessionItem[]): StaffSessionListResponse {
  return { items, total: items.length, page: 1, limit: 100 };
}

let feedback: AntdFeedbackSpies;
let writeText: MockInstance<(data: string) => Promise<void>>;

beforeEach(() => {
  feedback = stubAntdFeedback();
  writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
  mocks.listSessions.mockReset().mockResolvedValue(page([]));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function copiedText(): string {
  expect(writeText).toHaveBeenCalledTimes(1);
  return String(writeText.mock.calls[0][0]);
}

describe('usePartnerNoticeCopy', () => {
  it('재조회한 최신 값으로 통지 정보를 만들어 복사한다', async () => {
    const record = makeSessionItem();
    mocks.listSessions.mockResolvedValue(page([{ ...record, contentFileId: 'file-content-new' }]));
    const { result } = renderHook(() => usePartnerNoticeCopy());

    await act(async () => {
      await result.current.copyNotice(record);
    });

    expect(mocks.listSessions).toHaveBeenCalledWith({
      siteId: 'site-1',
      orderSeqno: 1001,
      deleted: 'include',
      limit: 100,
    });
    const text = copiedText();
    expect(text).toContain('세션 ID: sess-0001');
    expect(text).toContain('file-content-new');
    expect(text).not.toContain('file-content-old');
    expect(feedback.success).toHaveBeenCalledWith('파트너 통지 정보를 복사했습니다.');
    expect(feedback.warning).not.toHaveBeenCalled();
    expect(result.current.copyingId).toBeNull();
  });

  it('재조회 결과에 해당 세션이 없으면 안내 후 목록 값으로 만든다', async () => {
    const record = makeSessionItem();
    mocks.listSessions.mockResolvedValue(page([makeSessionItem({ id: 'sess-other' })]));
    const { result } = renderHook(() => usePartnerNoticeCopy());

    await act(async () => {
      await result.current.copyNotice(record);
    });

    expect(feedback.warning).toHaveBeenCalledWith(
      '최신 세션 정보를 찾지 못해 목록 값으로 만듭니다. 새로고침 후 다시 확인하세요.',
    );
    const text = copiedText();
    expect(text).toContain('세션 ID: sess-0001');
    expect(text).toContain('file-content-old');
  });

  it('재조회가 실패하면 안내 후 목록 값으로 만든다', async () => {
    const record = makeSessionItem();
    mocks.listSessions.mockRejectedValue(new Error('x'));
    const { result } = renderHook(() => usePartnerNoticeCopy());

    await act(async () => {
      await result.current.copyNotice(record);
    });

    expect(feedback.warning).toHaveBeenCalledWith(
      '최신 세션 정보를 불러오지 못했습니다. 목록 값으로 만듭니다.',
    );
    expect(copiedText()).toContain('file-content-old');
  });

  it('클립보드 쓰기가 거부되면 통지 정보를 복사 창으로 보여 준다', async () => {
    const record = makeSessionItem();
    mocks.listSessions.mockResolvedValue(page([record]));
    writeText.mockRejectedValue(new Error('denied'));
    const { result } = renderHook(() => usePartnerNoticeCopy());

    await act(async () => {
      await result.current.copyNotice(record);
    });

    expect(feedback.modalInfo).toHaveBeenCalledTimes(1);
    const props = feedback.modalInfo.mock.calls[0][0];
    expect(props.title).toBe('파트너 통지 정보');
    expect(props.okText).toBe('닫기');
    const content = props.content;
    expect(isValidElement(content)).toBe(true);
    const copyable = (content as ReactElement<{ copyable: { text: string } }>).props.copyable;
    expect(copyable.text).toContain('세션 ID: sess-0001');
    expect(feedback.success).not.toHaveBeenCalled();
    expect(result.current.copyingId).toBeNull();
  });

  it('복사가 끝날 때까지 copyingId 가 해당 세션 id 다', async () => {
    const record = makeSessionItem();
    const pending = deferred<StaffSessionListResponse>();
    mocks.listSessions.mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePartnerNoticeCopy());

    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.copyNotice(record);
    });
    expect(result.current.copyingId).toBe('sess-0001');

    await act(async () => {
      pending.resolve(page([record]));
      await running;
    });
    expect(result.current.copyingId).toBeNull();
  });

  it('두 세션 복사가 겹치면 나중 세션이 끝날 때까지 copyingId 가 나중 세션 id 다', async () => {
    const a = makeSessionItem({ id: 'sess-a' });
    const b = makeSessionItem({ id: 'sess-b' });
    const pendingA = deferred<StaffSessionListResponse>();
    const pendingB = deferred<StaffSessionListResponse>();
    mocks.listSessions.mockReturnValueOnce(pendingA.promise).mockReturnValueOnce(pendingB.promise);
    const { result } = renderHook(() => usePartnerNoticeCopy());

    let runningA: Promise<void> = Promise.resolve();
    let runningB: Promise<void> = Promise.resolve();
    act(() => {
      runningA = result.current.copyNotice(a);
    });
    act(() => {
      runningB = result.current.copyNotice(b);
    });
    expect(result.current.copyingId).toBe('sess-b');

    await act(async () => {
      pendingA.resolve(page([a]));
      await runningA;
    });
    expect(result.current.copyingId).toBe('sess-b');

    await act(async () => {
      pendingB.resolve(page([b]));
      await runningB;
    });
    expect(result.current.copyingId).toBeNull();
  });

  it('사이트·주문번호가 없는 세션은 재조회 조건에서 두 값을 뺀다', async () => {
    const record = makeSessionItem({ siteId: null, siteName: null, orderSeqno: null });
    const { result } = renderHook(() => usePartnerNoticeCopy());

    await act(async () => {
      await result.current.copyNotice(record);
    });

    expect(mocks.listSessions).toHaveBeenCalledWith({
      siteId: undefined,
      orderSeqno: undefined,
      deleted: 'include',
      limit: 100,
    });
  });
});
