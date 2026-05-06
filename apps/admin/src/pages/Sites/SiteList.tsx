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
  Switch,
  Tooltip,
  Dropdown,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { sitesApi, type Site, type CreateSiteDto } from '../../api/sites';

const { Title, Text } = Typography;

/**
 * 기본설정 — 외부 사이트(테넌트) 관리 페이지 (Phase A).
 *
 * 운영팀이 admin에서:
 *  1. 사이트 등록 (자동 발급된 인증코드 받음)
 *  2. PHP 팀에 인증코드 전달
 *  3. 운영 중지 시 status=suspended 토글
 *  4. 키 노출/보안 사고 시 재발급
 */
export default function SiteList() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [form] = Form.useForm<CreateSiteDto>();

  const { data: sites = [], isLoading } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (dto: CreateSiteDto) => sitesApi.create(dto),
    onSuccess: (site) => {
      message.success(`사이트 등록 완료: ${site.name}`);
      Modal.info({
        title: '신규 인증코드 발급',
        content: (
          <div>
            <Text strong>편집기 인증코드 (X-API-Key):</Text>
            <Input.TextArea
              value={site.editorAuthCode}
              readOnly
              autoSize
              style={{ marginTop: 8, marginBottom: 12 }}
            />
            <Text strong>워커 인증코드:</Text>
            <Input.TextArea
              value={site.workerAuthCode}
              readOnly
              autoSize
              style={{ marginTop: 8 }}
            />
            <Text type="warning" style={{ marginTop: 12, display: 'block' }}>
              ⚠️ 이 코드는 PHP 팀에 안전 채널로 전달하세요.
            </Text>
          </div>
        ),
      });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      handleCloseModal();
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? '등록 실패'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Partial<CreateSiteDto> }) =>
      sitesApi.update(id, dto),
    onSuccess: () => {
      message.success('사이트 수정 완료');
      queryClient.invalidateQueries({ queryKey: ['sites'] });
      handleCloseModal();
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? '수정 실패'),
  });

  const regenerateMutation = useMutation({
    mutationFn: ({
      id,
      target,
    }: {
      id: string;
      target: 'editor' | 'worker' | 'both';
    }) => sitesApi.regenerate(id, target),
    onSuccess: (site, vars) => {
      message.success(`인증코드 재발급 (${vars.target})`);
      Modal.warning({
        title: '신규 인증코드',
        content: (
          <div>
            {(vars.target === 'editor' || vars.target === 'both') && (
              <>
                <Text strong>편집기:</Text>
                <Input.TextArea value={site.editorAuthCode} readOnly autoSize />
              </>
            )}
            {(vars.target === 'worker' || vars.target === 'both') && (
              <>
                <Text strong style={{ marginTop: 12, display: 'block' }}>
                  워커:
                </Text>
                <Input.TextArea value={site.workerAuthCode} readOnly autoSize />
              </>
            )}
            <Text type="danger" style={{ marginTop: 12, display: 'block' }}>
              ⚠️ 이전 키는 즉시 무효화됐습니다. 새 키를 PHP 팀에 전달하세요.
            </Text>
          </div>
        ),
      });
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => sitesApi.remove(id),
    onSuccess: () => {
      message.success('사이트 삭제');
      queryClient.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const handleOpenCreate = () => {
    setEditingSite(null);
    form.resetFields();
    setIsModalOpen(true);
  };

  const handleOpenEdit = (site: Site) => {
    setEditingSite(site);
    form.setFieldsValue({
      name: site.name,
      domain: site.domain ?? undefined,
      returnUrlBase: site.returnUrlBase ?? undefined,
      uploadCallbackUrl: site.uploadCallbackUrl ?? undefined,
      status: site.status,
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSite(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editingSite) {
      updateMutation.mutate({ id: editingSite.id, dto: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const handleCopyKey = (key: string) => {
    navigator.clipboard.writeText(key);
    message.success('클립보드에 복사됨');
  };

  const columns: ColumnsType<Site> = [
    {
      title: '사이트명',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '도메인',
      dataIndex: 'domain',
      key: 'domain',
      ellipsis: true,
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '편집기 인증코드',
      dataIndex: 'editorAuthCode',
      key: 'editorAuthCode',
      render: (v: string) => (
        <Tooltip title={v}>
          <Space size={4}>
            <Text code style={{ fontSize: 11 }}>
              {v.slice(0, 18)}…
            </Text>
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={() => handleCopyKey(v)}
            />
          </Space>
        </Tooltip>
      ),
    },
    {
      title: '운영',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: 'active' | 'suspended', record) => (
        <Switch
          checked={status === 'active'}
          checkedChildren="운영중"
          unCheckedChildren="중지"
          onChange={(checked) =>
            updateMutation.mutate({
              id: record.id,
              dto: { status: checked ? 'active' : 'suspended' },
            })
          }
        />
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
      width: 200,
      render: (_, record) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleOpenEdit(record)}
          >
            수정
          </Button>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'editor',
                  label: '편집기 키 재발급',
                  onClick: () =>
                    regenerateMutation.mutate({
                      id: record.id,
                      target: 'editor',
                    }),
                },
                {
                  key: 'worker',
                  label: '워커 키 재발급',
                  onClick: () =>
                    regenerateMutation.mutate({
                      id: record.id,
                      target: 'worker',
                    }),
                },
                {
                  key: 'both',
                  label: '양쪽 모두 재발급',
                  onClick: () =>
                    regenerateMutation.mutate({
                      id: record.id,
                      target: 'both',
                    }),
                },
              ],
            }}
          >
            <Button size="small" icon={<ReloadOutlined />}>
              키 재발급
            </Button>
          </Dropdown>
          <Popconfirm
            title="이 사이트를 영구 삭제하시겠습니까?"
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
            기본설정 — 사이트 관리
          </Title>
          <Text type="secondary">
            외부 사이트(쇼핑몰)의 편집기·워커 연동 인증코드 발급/관리
          </Text>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          사이트 등록
        </Button>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={sites}
        loading={isLoading}
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <Modal
        title={editingSite ? '사이트 수정' : '신규 사이트 등록'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={handleCloseModal}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={620}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="사이트명"
            rules={[{ required: true, message: '사이트명을 입력해주세요' }]}
          >
            <Input placeholder="예: 북모아 메인" />
          </Form.Item>
          <Form.Item name="domain" label="사이트 URL">
            <Input placeholder="https://www.bookmoa.co.kr" />
          </Form.Item>
          <Form.Item name="returnUrlBase" label="보관함(returnUrl) 기본 경로">
            <Input placeholder="https://www.bookmoa.co.kr/mypage" />
          </Form.Item>
          <Form.Item name="uploadCallbackUrl" label="업로드 콜백 URL (Webhook)">
            <Input placeholder="https://www.bookmoa.co.kr/storige/proc/synthesis_callback.php" />
          </Form.Item>
          {!editingSite && (
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              💡 인증코드(편집기/워커)는 자동 생성됩니다. 등록 후 모달에서 복사해
              PHP 팀에 전달하세요.
            </Text>
          )}
        </Form>
      </Modal>
    </div>
  );
}
