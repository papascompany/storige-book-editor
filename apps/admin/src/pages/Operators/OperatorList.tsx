import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Typography,
  message,
  Modal,
  Form,
  Input,
  Popconfirm,
  Select,
  Tag,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  DeleteOutlined,
  UserAddOutlined,
  KeyOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import {
  operatorsApi,
  type Operator,
  type OperatorRole,
  type CreateOperatorRequest,
} from '../../api/operators';
import { sitesApi } from '../../api/sites';

const { Title, Text } = Typography;

const ROLE_OPTIONS: { value: OperatorRole; label: string }[] = [
  { value: 'SITE_ADMIN', label: 'SITE_ADMIN (사이트 관리자)' },
  { value: 'SITE_MANAGER', label: 'SITE_MANAGER (사이트 운영)' },
];

const roleTagColor = (role: OperatorRole) =>
  role === 'SITE_ADMIN' ? 'blue' : 'green';

interface CreateFormValues {
  email: string;
  password: string;
  role: OperatorRole;
  siteId: string;
}

interface AssignFormValues {
  siteId: string;
  role: OperatorRole;
}

interface ResetFormValues {
  newPassword: string;
}

/**
 * P3a 멀티테넌시 — 운영자 관리 페이지.
 *
 * 전역 admin 이 사이트별 운영자(SITE_ADMIN/SITE_MANAGER) 계정을 발급·배정한다.
 * SiteList.tsx 패턴(List + Modal Form CRUD, React Query, antd) 클론.
 */
export default function OperatorList() {
  const queryClient = useQueryClient();

  // 생성 모달
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createForm] = Form.useForm<CreateFormValues>();

  // 배정 추가 모달
  const [assignTarget, setAssignTarget] = useState<Operator | null>(null);
  const [assignForm] = Form.useForm<AssignFormValues>();

  // 비번 리셋 모달
  const [resetTarget, setResetTarget] = useState<Operator | null>(null);
  const [resetForm] = Form.useForm<ResetFormValues>();

  const { data: operators = [], isLoading } = useQuery({
    queryKey: ['operators'],
    queryFn: () => operatorsApi.list(),
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
  });

  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['operators'] });

  const createMutation = useMutation({
    mutationFn: (data: CreateOperatorRequest) => operatorsApi.create(data),
    onSuccess: (op) => {
      message.success(`운영자 등록 완료: ${op.email}`);
      invalidate();
      handleCloseCreate();
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.message ?? '등록 실패'),
  });

  const addAssignmentMutation = useMutation({
    mutationFn: ({
      userId,
      siteId,
      role,
    }: {
      userId: string;
      siteId: string;
      role: OperatorRole;
    }) => operatorsApi.addAssignment(userId, { siteId, role }),
    onSuccess: () => {
      message.success('사이트 배정 완료');
      invalidate();
      handleCloseAssign();
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.message ?? '배정 실패'),
  });

  const removeAssignmentMutation = useMutation({
    mutationFn: ({ userId, siteId }: { userId: string; siteId: string }) =>
      operatorsApi.removeAssignment(userId, siteId),
    onSuccess: () => {
      message.success('배정 회수 완료');
      invalidate();
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.message ?? '회수 실패'),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({
      userId,
      newPassword,
    }: {
      userId: string;
      newPassword: string;
    }) => operatorsApi.resetPassword(userId, newPassword),
    onSuccess: () => {
      message.success('비밀번호가 변경되었습니다');
      handleCloseReset();
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.message ?? '비밀번호 변경 실패'),
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => operatorsApi.remove(userId),
    onSuccess: () => {
      message.success('운영자 삭제');
      invalidate();
    },
    onError: (e: any) =>
      message.error(e?.response?.data?.message ?? '삭제 실패'),
  });

  // ── 생성 ──────────────────────────────────────────────
  const handleOpenCreate = () => {
    createForm.resetFields();
    setIsCreateOpen(true);
  };
  const handleCloseCreate = () => {
    setIsCreateOpen(false);
    createForm.resetFields();
  };
  const handleSubmitCreate = async () => {
    const values = await createForm.validateFields();
    createMutation.mutate(values);
  };

  // ── 배정 추가 ─────────────────────────────────────────
  const handleOpenAssign = (op: Operator) => {
    setAssignTarget(op);
    assignForm.resetFields();
  };
  const handleCloseAssign = () => {
    setAssignTarget(null);
    assignForm.resetFields();
  };
  const handleSubmitAssign = async () => {
    if (!assignTarget) return;
    const values = await assignForm.validateFields();
    addAssignmentMutation.mutate({
      userId: assignTarget.id,
      siteId: values.siteId,
      role: values.role,
    });
  };

  // ── 비번 리셋 ─────────────────────────────────────────
  const handleOpenReset = (op: Operator) => {
    setResetTarget(op);
    resetForm.resetFields();
  };
  const handleCloseReset = () => {
    setResetTarget(null);
    resetForm.resetFields();
  };
  const handleSubmitReset = async () => {
    if (!resetTarget) return;
    const values = await resetForm.validateFields();
    resetPasswordMutation.mutate({
      userId: resetTarget.id,
      newPassword: values.newPassword,
    });
  };

  const columns: ColumnsType<Operator> = [
    {
      title: '이메일',
      dataIndex: 'email',
      key: 'email',
      width: 220,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '역할',
      dataIndex: 'role',
      key: 'role',
      width: 140,
      render: (role: OperatorRole) => (
        <Tag color={roleTagColor(role)}>{role}</Tag>
      ),
    },
    {
      title: '배정 사이트',
      key: 'assignments',
      render: (_, record) =>
        record.assignments.length === 0 ? (
          <Text type="secondary">— 배정 없음</Text>
        ) : (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {record.assignments.map((a) => (
              <Space key={a.siteId} size={4}>
                <Text>{a.siteName}</Text>
                <Tag color={roleTagColor(a.role)} style={{ marginInlineEnd: 0 }}>
                  {a.role}
                </Tag>
                <Popconfirm
                  title={`${a.siteName} 배정을 회수하시겠습니까?`}
                  okText="회수"
                  cancelText="취소"
                  okButtonProps={{ danger: true }}
                  onConfirm={() =>
                    removeAssignmentMutation.mutate({
                      userId: record.id,
                      siteId: a.siteId,
                    })
                  }
                >
                  <Button size="small" type="text" danger icon={<CloseOutlined />} />
                </Popconfirm>
              </Space>
            ))}
          </Space>
        ),
    },
    {
      title: '등록일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => new Date(v).toLocaleString('ko-KR'),
    },
    {
      title: '작업',
      key: 'action',
      width: 280,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<UserAddOutlined />}
            onClick={() => handleOpenAssign(record)}
          >
            배정추가
          </Button>
          <Button
            size="small"
            icon={<KeyOutlined />}
            onClick={() => handleOpenReset(record)}
          >
            비번리셋
          </Button>
          <Popconfirm
            title="이 운영자를 영구 삭제하시겠습니까?"
            okText="삭제"
            cancelText="취소"
            okButtonProps={{ danger: true }}
            onConfirm={() => removeMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0 }}>
            운영자 관리
          </Title>
          <Text type="secondary">
            사이트별 운영자(SITE_ADMIN/SITE_MANAGER) 계정 발급·배정
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          운영자 등록
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={operators}
        loading={isLoading}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
      />

      {/* 운영자 등록 */}
      <Modal
        title="신규 운영자 등록"
        open={isCreateOpen}
        onOk={handleSubmitCreate}
        onCancel={handleCloseCreate}
        confirmLoading={createMutation.isPending}
        width={520}
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="email"
            label="이메일"
            rules={[
              { required: true, message: '이메일을 입력해주세요' },
              { type: 'email', message: '올바른 이메일 형식이 아닙니다' },
            ]}
          >
            <Input placeholder="operator@example.com" autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="password"
            label="초기 비밀번호"
            rules={[
              { required: true, message: '초기 비밀번호를 입력해주세요' },
              { min: 8, message: '비밀번호는 최소 8자 이상이어야 합니다.' },
            ]}
          >
            <Input.Password
              placeholder="최소 8자"
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            name="role"
            label="역할"
            rules={[{ required: true, message: '역할을 선택해주세요' }]}
          >
            <Select options={ROLE_OPTIONS} placeholder="역할 선택" />
          </Form.Item>
          <Form.Item
            name="siteId"
            label="사이트"
            rules={[{ required: true, message: '사이트를 선택해주세요' }]}
          >
            <Select
              options={siteOptions}
              placeholder="사이트 선택"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 사이트 배정 추가 */}
      <Modal
        title={`사이트 배정 추가${assignTarget ? ` — ${assignTarget.email}` : ''}`}
        open={!!assignTarget}
        onOk={handleSubmitAssign}
        onCancel={handleCloseAssign}
        confirmLoading={addAssignmentMutation.isPending}
        width={480}
      >
        <Form form={assignForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="siteId"
            label="사이트"
            rules={[{ required: true, message: '사이트를 선택해주세요' }]}
          >
            <Select
              options={siteOptions}
              placeholder="사이트 선택"
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item
            name="role"
            label="역할"
            rules={[{ required: true, message: '역할을 선택해주세요' }]}
          >
            <Select options={ROLE_OPTIONS} placeholder="역할 선택" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 비밀번호 리셋 */}
      <Modal
        title={`비밀번호 리셋${resetTarget ? ` — ${resetTarget.email}` : ''}`}
        open={!!resetTarget}
        onOk={handleSubmitReset}
        onCancel={handleCloseReset}
        confirmLoading={resetPasswordMutation.isPending}
        width={480}
      >
        <Form form={resetForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="newPassword"
            label="새 비밀번호"
            rules={[
              { required: true, message: '새 비밀번호를 입력해주세요' },
              { min: 8, message: '비밀번호는 최소 8자 이상이어야 합니다.' },
            ]}
          >
            <Input.Password
              placeholder="최소 8자"
              autoComplete="new-password"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
