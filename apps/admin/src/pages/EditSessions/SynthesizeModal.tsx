import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Form, Select, Checkbox, Input, Alert, Typography, message } from 'antd';
import {
  editDataApi,
  type StaffSessionItem,
  type SynthesizeBody,
  type SynthesizeOutputMode,
} from '../../api/edit-data';
import { describeApiError, errorMessage, parseApiError } from './editDataHelpers';

const { Text } = Typography;

interface SynthesizeFormValues {
  outputMode?: SynthesizeOutputMode;
  notifyPartner?: boolean;
  reason?: string;
}

interface SynthesizeModalProps {
  session: StaffSessionItem | null;
  open: boolean;
  onClose: () => void;
}

const OUTPUT_MODE_OPTIONS: { value: SynthesizeOutputMode; label: string }[] = [
  { value: 'separate', label: '표지·내지 분리 (separate)' },
  { value: 'content-only', label: '내지만 (content-only)' },
  { value: 'single', label: '단일 PDF (single)' },
];

/**
 * 관리자 합성/재합성 (2026-09-29) — POST /admin/edit-data/sessions/:id/synthesize.
 * 매번 새 잡을 만들고 이전 결과물은 그대로 둔다. 기본은 파트너 알림(콜백·웹훅) 없음.
 */
export function SynthesizeModal({ session, open, onClose }: SynthesizeModalProps) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<SynthesizeFormValues>();

  useEffect(() => {
    if (open) form.resetFields();
  }, [open, session?.id, form]);

  const synthesizeMutation = useMutation({
    mutationFn: ({ sessionId, body }: { sessionId: string; body: SynthesizeBody }) =>
      editDataApi.synthesize(sessionId, body),
    onSuccess: (res, vars) => {
      message.success(`합성 작업을 만들었습니다. 작업 ID: ${res.job.id}`, 6);
      queryClient.invalidateQueries({ queryKey: ['edit-data-jobs', vars.sessionId] });
      queryClient.invalidateQueries({ queryKey: ['edit-data-sessions'] });
      onClose();
    },
    onError: (err: unknown, vars) => {
      const { code } = parseApiError(err);
      if (code === 'OUTPUT_STALE' && !vars.body.allowStale) {
        Modal.confirm({
          title: '편집 전 PDF로 합성할까요?',
          content: errorMessage('OUTPUT_STALE'),
          okText: '편집 전 PDF로 합성',
          cancelText: '취소',
          onOk: () =>
            synthesizeMutation.mutate({
              sessionId: vars.sessionId,
              body: { ...vars.body, allowStale: true },
            }),
        });
        return;
      }
      message.error(describeApiError(err, '합성 요청에 실패했습니다.'));
    },
  });

  const handleOk = async (): Promise<void> => {
    if (!session) return;
    const values = await form.validateFields();
    const reason = values.reason?.trim();
    const body: SynthesizeBody = {
      notifyPartner: values.notifyPartner === true,
      allowStale: false,
    };
    if (values.outputMode) body.outputMode = values.outputMode;
    if (reason) body.reason = reason;
    synthesizeMutation.mutate({ sessionId: session.id, body });
  };

  return (
    <Modal
      title="합성 / 재합성"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="합성 작업 만들기"
      cancelText="취소"
      confirmLoading={synthesizeMutation.isPending}
    >
      {session && (
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {session.siteName ?? '—'} · 주문번호 {session.orderSeqno ?? '-'} · 세션{' '}
          {session.id.slice(0, 8)}
        </Text>
      )}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="재합성은 새 작업을 만들며 이전 결과물은 그대로 보관됩니다."
        description="편집기에서 수정했다면 먼저 편집기에서 편집완료를 눌러 PDF를 다시 만드세요."
      />
      {session?.staffEditedAfterComplete && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={errorMessage('OUTPUT_STALE')}
        />
      )}
      <Form form={form} layout="vertical">
        <Form.Item name="outputMode" label="출력 방식">
          <Select
            allowClear
            placeholder="자동(세트 설정)"
            options={OUTPUT_MODE_OPTIONS}
          />
        </Form.Item>
        <Form.Item name="notifyPartner" valuePropName="checked" initialValue={false}>
          <Checkbox>파트너에게 알림(콜백·웹훅) 보내기</Checkbox>
        </Form.Item>
        <Form.Item name="reason" label="사유 (선택)">
          <Input maxLength={200} showCount placeholder="예: 고객 요청으로 표지 수정 후 재합성" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
