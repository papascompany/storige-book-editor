import { useEffect, useRef, useState } from 'react';
import { Modal, Alert, Checkbox, Typography } from 'antd';
import type { StaffSessionItem } from '../../api/edit-data';
import { orderLinkedConfirmCopy, type OrderLinkedAction } from './editDataHelpers';

const { Text } = Typography;

export interface OrderLinkedTarget {
  action: OrderLinkedAction;
  record: StaffSessionItem;
}

interface OrderLinkedConfirmModalProps {
  target: OrderLinkedTarget | null;
  onConfirm: (target: OrderLinkedTarget) => void;
  onCancel: () => void;
}

/**
 * 파트너 주문 연결 세션 확인 창 (2026-09-30, 3-B 운영 원칙).
 * 편집기 열기·완료 처리·삭제·합성 전에 파트너 주문에 미치는 영향과 통지 절차를 보여 주고,
 * '사전 통지했습니다' 체크 뒤에만 진행한다. 서버 권한 판정과는 무관한 운영 안전장치다.
 */
export function OrderLinkedConfirmModal({ target, onConfirm, onCancel }: OrderLinkedConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setAcknowledged(false);
  }, [target?.action, target?.record.id]);

  // 닫힘 애니메이션 동안에도 직전 대상의 문구를 유지한다(제목·본문이 비지 않게).
  const lastTarget = useRef<OrderLinkedTarget | null>(target);
  if (target) lastTarget.current = target;
  const view = target ?? lastTarget.current;
  const copy = view ? orderLinkedConfirmCopy(view.action, view.record) : null;

  return (
    <Modal
      title={copy?.title}
      open={!!target}
      onOk={() => {
        if (target && acknowledged) onConfirm(target);
      }}
      onCancel={onCancel}
      okText={copy?.okText}
      cancelText="취소"
      okButtonProps={{ disabled: !acknowledged, danger: copy?.danger }}
    >
      {view && copy && (
        <>
          <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
            {view.record.siteName ?? '—'} · 주문번호 {view.record.orderSeqno ?? '-'}
          </Text>
          {/* 사전 통지에 넣을 세션 id — 파트너는 orderSeqno 가 아니라 세션 id 로 주문을 찾는다 */}
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            세션 id <Text code copyable>{view.record.id}</Text>
          </Text>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={copy.notice}
            description={copy.effect}
          />
          <Checkbox checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)}>
            {copy.ackLabel}
          </Checkbox>
        </>
      )}
    </Modal>
  );
}
