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
  Select,
  Divider,
  InputNumber,
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
      retentionDays: site.retentionDays ?? undefined,
      pdfConversionEnabled: site.pdfConversionEnabled,
      beforeAfterUrl: site.beforeAfterUrl ?? undefined,
      defaultUnit: site.defaultUnit,
      checkWorkorder: site.checkWorkorder,
      checkCutting: site.checkCutting,
      checkSafezone: site.checkSafezone,
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
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
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

          <Divider orientation="left" plain>
            파일 보존정책
          </Divider>
          <Form.Item
            name="retentionDays"
            label="파일 보존 기간 (일)"
            tooltip="이 사이트가 업로드한 파일을 N일 후 자동 삭제합니다(저장 용량 관리). 인쇄 PDF는 편집 원본에서 재생성 가능. 비우거나 0이면 영구보관."
            extra="비우면 영구보관. 예: 14 = 업로드 14일 후 자동 삭제 (전체 자동삭제 작업은 [저장소 설정]에서 on/off)."
          >
            <InputNumber min={0} max={3650} style={{ width: 200 }} placeholder="비움 = 영구보관" addonAfter="일" />
          </Form.Item>

          <Divider orientation="left" plain>
            워커 옵션 (default)
          </Divider>

          <Form.Item
            name="pdfConversionEnabled"
            label="PDF 자동 변환 사용 (addPages/applyBleed)"
            valuePropName="checked"
            initialValue={true}
          >
            <Switch checkedChildren="사용" unCheckedChildren="사용안함" />
          </Form.Item>
          <Form.Item name="beforeAfterUrl" label="Before/After 미리보기 URL">
            <Input placeholder="https://example.com/before-after" />
          </Form.Item>
          <Form.Item
            name="defaultUnit"
            label="단위 구분"
            initialValue="mm"
          >
            <Select
              options={[
                { value: 'mm', label: '밀리미터 (mm)' },
                { value: 'inch', label: '인치 (inch)' },
              ]}
            />
          </Form.Item>
          <Space size="large">
            <Form.Item
              name="checkWorkorder"
              label="작업서 체크"
              valuePropName="checked"
              initialValue={true}
            >
              <Switch checkedChildren="사용" unCheckedChildren="사용안함" />
            </Form.Item>
            <Form.Item
              name="checkCutting"
              label="재단선 체크"
              valuePropName="checked"
              initialValue={true}
            >
              <Switch checkedChildren="사용" unCheckedChildren="사용안함" />
            </Form.Item>
            <Form.Item
              name="checkSafezone"
              label="안전선 체크"
              valuePropName="checked"
              initialValue={true}
            >
              <Switch checkedChildren="사용" unCheckedChildren="사용안함" />
            </Form.Item>
          </Space>

          <Divider orientation="left" plain>
            외부 도메인 보안 정책 (Phase 1-2)
          </Divider>

          <Form.Item
            name="allowedOrigins"
            label="CORS 허용 origin (콤마 또는 줄바꿈 구분)"
            tooltip="외부 사이트 브라우저가 Storige API 를 호출할 때 허용할 origin. 예: https://www.bookmoa.co.kr"
            getValueFromEvent={(e) => {
              const raw = (e?.target?.value ?? e ?? '') as string;
              return raw
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            }}
            getValueProps={(value: string[] | undefined) => ({
              value: Array.isArray(value) ? value.join('\n') : value,
            })}
          >
            <Input.TextArea
              rows={3}
              placeholder={'https://www.bookmoa.co.kr\nhttps://bookmoa-mobile.vercel.app'}
            />
          </Form.Item>

          <Form.Item
            name="frameAncestors"
            label="iframe embed 허용 parent origin"
            tooltip="외부 사이트가 Storige Editor 를 iframe 으로 임베드할 때 허용할 parent origin (CSP frame-ancestors 합성)."
            getValueFromEvent={(e) => {
              const raw = (e?.target?.value ?? e ?? '') as string;
              return raw
                .split(/[\n,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            }}
            getValueProps={(value: string[] | undefined) => ({
              value: Array.isArray(value) ? value.join('\n') : value,
            })}
          >
            <Input.TextArea
              rows={3}
              placeholder={'https://www.bookmoa.co.kr\nhttps://bookmoa-mobile.vercel.app'}
            />
          </Form.Item>

          <Form.Item
            name="editorLaunchMode"
            label="편집기 실행 모드"
            initialValue="inline"
            tooltip="Phase 0 결정 D-1: inline embed 단일."
          >
            <Select
              options={[{ value: 'inline', label: 'Inline embed (오버레이 + iframe)' }]}
              disabled
            />
          </Form.Item>

          <Form.Item name="editorBundleUrl" label="Editor IIFE 번들 URL (선택)">
            <Input placeholder="https://editor.papascompany.co.kr/embed-bundle.js" />
          </Form.Item>
          <Form.Item name="editorCssUrl" label="Editor CSS URL (선택)">
            <Input placeholder="https://editor.papascompany.co.kr/embed.css" />
          </Form.Item>
          <Form.Item name="editorVersion" label="Editor 버전 (선택)">
            <Input placeholder="1.0.0" />
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
