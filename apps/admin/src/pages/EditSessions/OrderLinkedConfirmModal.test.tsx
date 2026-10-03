// @vitest-environment happy-dom
// 주문 연결 세션 확인 창 — 사전 통지 체크 뒤에만 진행 버튼이 켜진다.
import {
  buttonByText,
  openDialog,
  renderWithAntd,
} from '../../test/renderWithAntd';
import { fireEvent, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { makeSessionItem } from '../../test/sessionFixtures';
import { orderLinkedConfirmCopy } from './editDataHelpers';
import { OrderLinkedConfirmModal, type OrderLinkedTarget } from './OrderLinkedConfirmModal';

function shownDialog(): HTMLElement {
  const dialog = openDialog();
  if (!dialog) throw new Error('열린 확인 창이 없습니다');
  return dialog;
}

function ackCheckbox(dialog: HTMLElement): HTMLInputElement {
  const input = dialog.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!input) throw new Error('사전 통지 체크박스가 없습니다');
  return input;
}

describe('OrderLinkedConfirmModal', () => {
  it('target 이 null 이면 확인 창을 띄우지 않는다', () => {
    renderWithAntd(<OrderLinkedConfirmModal target={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(openDialog()).toBeNull();
    expect(screen.queryByText(orderLinkedConfirmCopy('delete', makeSessionItem()).title)).toBeNull();
  });

  it('삭제 확인 창은 사이트·주문번호·세션 id·통지 안내를 보여 주고 체크 전에는 진행 버튼이 비활성이다', () => {
    const record = makeSessionItem();
    const copy = orderLinkedConfirmCopy('delete', record);
    renderWithAntd(
      <OrderLinkedConfirmModal target={{ action: 'delete', record }} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = shownDialog();
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText('테스트사이트 · 주문번호 1001')).toBeTruthy();
    expect(screen.getByText('sess-0001')).toBeTruthy();
    expect(screen.getByText(copy.notice)).toBeTruthy();
    expect(screen.getByText(copy.effect)).toBeTruthy();
    expect(screen.getByText('테스트사이트에 사전 통지했습니다')).toBeTruthy();
    expect(ackCheckbox(dialog).checked).toBe(false);
    const ok = buttonByText(dialog, '삭제');
    expect(ok.disabled).toBe(true);
    expect(ok.classList.contains('ant-btn-dangerous')).toBe(true);
  });

  it('사전 통지를 체크하면 진행 버튼이 켜지고 누르면 같은 target 으로 onConfirm 을 1회 호출한다', () => {
    const target: OrderLinkedTarget = { action: 'delete', record: makeSessionItem() };
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithAntd(<OrderLinkedConfirmModal target={target} onConfirm={onConfirm} onCancel={onCancel} />);
    const dialog = shownDialog();
    fireEvent.click(ackCheckbox(dialog));
    const ok = buttonByText(dialog, '삭제');
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0][0]).toBe(target);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('체크하지 않고 진행 버튼을 누르면 onConfirm 을 호출하지 않는다(버튼 disabled)', () => {
    const onConfirm = vi.fn();
    renderWithAntd(
      <OrderLinkedConfirmModal
        target={{ action: 'delete', record: makeSessionItem() }}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(buttonByText(shownDialog(), '삭제'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('취소를 누르면 onCancel 만 호출한다', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    renderWithAntd(
      <OrderLinkedConfirmModal
        target={{ action: 'delete', record: makeSessionItem() }}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(buttonByText(shownDialog(), '취소'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('대상 세션이 바뀌면 사전 통지 체크가 해제된다', () => {
    const record = makeSessionItem();
    const props = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderWithAntd(
      <OrderLinkedConfirmModal target={{ action: 'delete', record }} {...props} />,
    );
    fireEvent.click(ackCheckbox(shownDialog()));
    expect(ackCheckbox(shownDialog()).checked).toBe(true);

    rerender(
      <OrderLinkedConfirmModal
        target={{ action: 'delete', record: makeSessionItem({ id: 'sess-0002' }) }}
        {...props}
      />,
    );
    const dialog = shownDialog();
    expect(ackCheckbox(dialog).checked).toBe(false);
    expect(buttonByText(dialog, '삭제').disabled).toBe(true);
  });

  it('작업 종류가 바뀌면 체크가 해제되고 진행 버튼 문구·위험 표시가 그 작업을 따른다', () => {
    const record = makeSessionItem();
    const props = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderWithAntd(
      <OrderLinkedConfirmModal target={{ action: 'delete', record }} {...props} />,
    );
    fireEvent.click(ackCheckbox(shownDialog()));

    rerender(<OrderLinkedConfirmModal target={{ action: 'open', record }} {...props} />);
    const dialog = shownDialog();
    expect(ackCheckbox(dialog).checked).toBe(false);
    const ok = buttonByText(dialog, '편집기에서 열기');
    expect(ok.disabled).toBe(true);
    expect(ok.classList.contains('ant-btn-dangerous')).toBe(false);
  });

  it('닫힌 뒤에도 직전 대상의 제목을 유지한다', () => {
    const record = makeSessionItem();
    const props = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { rerender } = renderWithAntd(
      <OrderLinkedConfirmModal target={{ action: 'delete', record }} {...props} />,
    );
    fireEvent.click(ackCheckbox(shownDialog()));
    rerender(<OrderLinkedConfirmModal target={null} {...props} />);
    expect(openDialog()).toBeNull();
    expect(screen.getByText(orderLinkedConfirmCopy('delete', record).title)).toBeTruthy();
  });

  it('사이트 없는 이전 세션은 대상 표기를 — 로, 체크 문구를 해당 파트너로 보여 준다', () => {
    const record = makeSessionItem({ siteId: null, siteName: null });
    renderWithAntd(
      <OrderLinkedConfirmModal target={{ action: 'delete', record }} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText('— · 주문번호 1001')).toBeTruthy();
    expect(screen.getByText('해당 파트너에 사전 통지했습니다')).toBeTruthy();
  });
});
