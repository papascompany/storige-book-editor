import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { UserRole } from '@storige/types';
import { useAuthStore } from '../../stores/authStore';
import { portalApi, type PortalPartnerKey } from '../../api/portal';

const { Title, Text, Paragraph } = Typography;

interface SettingsFormValues {
  allowedOrigins?: string[];
  uploadCallbackUrl?: string;
}

/** axios 에러에서 사용자 메시지 추출 (any 금지 — 필요한 shape 만 좁힌다) */
function errorMessage(e: unknown, fallback: string): string {
  const maybe = e as {
    response?: { data?: { message?: string | string[] } };
  };
  const msg = maybe?.response?.data?.message;
  if (Array.isArray(msg)) return msg.join(' / ');
  return typeof msg === 'string' ? msg : fallback;
}

const KEY_STATUS_TAG: Record<
  PortalPartnerKey['status'],
  { color: string; label: string }
> = {
  active: { color: 'green', label: '활성' },
  grace: { color: 'orange', label: '회전 유예' },
  revoked: { color: 'red', label: '폐기됨' },
};

/**
 * 내 사이트 — 파트너 포털 v0 (S2-4, SITE_ADMIN 셀프 뷰).
 *
 * 전역 admin 의 기존 화면(기본설정/운영자 관리)은 무변경 — 이 페이지는
 * SITE_ADMIN 배정이 있는 운영자에게만 메뉴 노출된다(MainLayout 게이팅).
 *  ① 셀프 설정: allowedOrigins / uploadCallbackUrl(웹훅 URL) — PATCH 허용 2필드만
 *  ② test API 키: 발급(원문 1회 노출 모달)·목록(prefix 마스킹)·폐기
 *  ③ 온보딩 안내: 가이드 §1.1 양식의 셀프 입력화 + live 키·웹훅 v2 절차 안내
 */
export default function MySitePage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [form] = Form.useForm<SettingsFormValues>();
  const [isIssueModalOpen, setIsIssueModalOpen] = useState(false);
  const [issueForm] = Form.useForm<{ name?: string }>();

  // SITE_ADMIN 역할로 배정된 site 만 — SITE_MANAGER 배정 site 는 포털 밖(API 도 403)
  const adminSites = useMemo(
    () =>
      (user?.siteRoles ?? []).filter((r) => r.role === UserRole.SITE_ADMIN),
    [user],
  );
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(
    undefined,
  );
  const siteId = selectedSiteId ?? adminSites[0]?.siteId;

  const { data: site, isLoading: isSiteLoading } = useQuery({
    queryKey: ['portal-site', siteId],
    queryFn: () => portalApi.getSite(siteId!),
    enabled: !!siteId,
  });

  const { data: keys = [], isLoading: isKeysLoading } = useQuery({
    queryKey: ['portal-keys', siteId],
    queryFn: () => portalApi.listTestKeys(siteId!),
    enabled: !!siteId,
  });

  // site 데이터 로드 시 폼 동기화
  useEffect(() => {
    if (site) {
      form.setFieldsValue({
        allowedOrigins: site.allowedOrigins ?? [],
        uploadCallbackUrl: site.uploadCallbackUrl ?? undefined,
      });
    }
  }, [site, form]);

  const updateMutation = useMutation({
    mutationFn: (values: SettingsFormValues) =>
      portalApi.updateSite(siteId!, {
        allowedOrigins: values.allowedOrigins ?? [],
        uploadCallbackUrl: values.uploadCallbackUrl?.trim()
          ? values.uploadCallbackUrl.trim()
          : null,
      }),
    onSuccess: () => {
      message.success('설정이 저장되었습니다');
      queryClient.invalidateQueries({ queryKey: ['portal-site', siteId] });
    },
    onError: (e: unknown) => message.error(errorMessage(e, '저장 실패')),
  });

  const issueMutation = useMutation({
    mutationFn: (name?: string) => portalApi.issueTestKey(siteId!, name),
    onSuccess: (issued) => {
      setIsIssueModalOpen(false);
      issueForm.resetFields();
      queryClient.invalidateQueries({ queryKey: ['portal-keys', siteId] });
      Modal.info({
        title: 'test API 키 발급 완료 — 지금만 확인 가능합니다',
        width: 560,
        content: (
          <div>
            <Paragraph>
              아래 키 원문은 <Text strong>이 창에서만 1회</Text> 표시됩니다.
              닫으면 다시 조회할 수 없으니 안전한 곳에 보관하세요.
            </Paragraph>
            <Space.Compact style={{ width: '100%' }}>
              <Input.TextArea value={issued.key} readOnly autoSize />
              <Button
                icon={<CopyOutlined />}
                onClick={() => {
                  navigator.clipboard.writeText(issued.key);
                  message.success('클립보드에 복사됨');
                }}
              />
            </Space.Compact>
            <Text type="warning" style={{ marginTop: 12, display: 'block' }}>
              ⚠️ test 키는 서버에서만 사용하고 브라우저에 노출하지 마세요.
            </Text>
          </div>
        ),
      });
    },
    onError: (e: unknown) => message.error(errorMessage(e, '발급 실패')),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => portalApi.revokeTestKey(siteId!, keyId),
    onSuccess: () => {
      message.success('키를 폐기했습니다');
      queryClient.invalidateQueries({ queryKey: ['portal-keys', siteId] });
    },
    onError: (e: unknown) => message.error(errorMessage(e, '폐기 실패')),
  });

  const handleSave = async () => {
    const values = await form.validateFields();
    updateMutation.mutate(values);
  };

  const keyColumns: ColumnsType<PortalPartnerKey> = [
    {
      title: '키 (prefix)',
      dataIndex: 'keyPrefix',
      key: 'keyPrefix',
      render: (v: string) => (
        <Text code>
          {v}
          {'…'}
        </Text>
      ),
    },
    {
      title: '라벨',
      dataIndex: 'name',
      key: 'name',
      render: (v: string | null) => v ?? <Text type="secondary">—</Text>,
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: PortalPartnerKey['status']) => (
        <Tag color={KEY_STATUS_TAG[status].color}>
          {KEY_STATUS_TAG[status].label}
        </Tag>
      ),
    },
    {
      title: '마지막 사용',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 170,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('ko-KR') : <Text type="secondary">—</Text>,
    },
    {
      title: '발급일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('ko-KR'),
    },
    {
      title: '작업',
      key: 'action',
      width: 90,
      render: (_, record) =>
        record.status !== 'revoked' ? (
          <Popconfirm
            title="이 test 키를 즉시 폐기하시겠습니까?"
            description="폐기 즉시 이 키를 쓰는 호출이 401 로 거부됩니다."
            okText="폐기"
            cancelText="취소"
            okButtonProps={{ danger: true }}
            onConfirm={() => revokeMutation.mutate(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              폐기
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  if (adminSites.length === 0) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={2}>내 사이트</Title>
        <Alert
          type="info"
          showIcon
          message="SITE_ADMIN 으로 배정된 사이트가 없습니다"
          description="사이트 배정은 Storige 운영팀이 관리합니다. 운영팀에 문의하세요."
        />
      </div>
    );
  }

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
            내 사이트
          </Title>
          <Text type="secondary">
            연동 설정 셀프 관리 + test API 키 발급 (파트너 포털 v0)
          </Text>
        </div>
        {adminSites.length > 1 && (
          <Select
            style={{ width: 260 }}
            value={siteId}
            onChange={setSelectedSiteId}
            options={adminSites.map((r) => ({
              value: r.siteId,
              label: r.siteName ?? r.siteId,
            }))}
          />
        )}
      </div>

      {/* ── ① 사이트 정보 (읽기 전용 — 인증코드는 마스킹) ── */}
      <Card title="사이트 정보" loading={isSiteLoading} style={{ marginBottom: 24 }}>
        {site && (
          <Descriptions column={2} size="small" bordered>
            <Descriptions.Item label="사이트명">{site.name}</Descriptions.Item>
            <Descriptions.Item label="운영 상태">
              <Tag color={site.status === 'active' ? 'green' : 'red'}>
                {site.status === 'active' ? '운영중' : '중지'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="도메인">
              {site.domain ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="파일 보존">
              {site.retentionDays ? `${site.retentionDays}일` : '영구보관'}
            </Descriptions.Item>
            <Descriptions.Item label="편집기 인증코드">
              <Text code>{site.editorAuthCodeMasked}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="워커 인증코드">
              <Text code>{site.workerAuthCodeMasked}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="iframe 허용 origin" span={2}>
              {site.frameAncestors?.length ? (
                site.frameAncestors.map((o) => <Tag key={o}>{o}</Tag>)
              ) : (
                <Text type="secondary">미설정 (변경은 운영팀 문의)</Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
          인증코드 원문 확인/재발급, 운영 상태·보존정책·iframe 허용 origin 변경은
          Storige 운영팀에 요청하세요.
        </Text>
      </Card>

      {/* ── ② 셀프 설정 (PATCH 허용 2필드) ── */}
      <Card title="연동 설정 (셀프 관리)" style={{ marginBottom: 24 }}>
        <Form form={form} layout="vertical">
          <Form.Item
            name="allowedOrigins"
            label="CORS 허용 origin (콤마 또는 줄바꿈 구분)"
            tooltip="브라우저에서 Storige API 를 호출할 origin. path 없이 https://host 형식만."
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
              placeholder={'https://app.example.com\nhttps://staging.example.com'}
            />
          </Form.Item>
          <Form.Item
            name="uploadCallbackUrl"
            label="업로드 콜백 URL (웹훅 URL)"
            tooltip="합성/업로드 완료 시 Storige 가 호출하는 웹훅. 비우면 해제. 내부/사설 주소는 등록 불가."
          >
            <Input placeholder="https://api.example.com/storige/webhook" />
          </Form.Item>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={handleSave}
            loading={updateMutation.isPending}
          >
            설정 저장
          </Button>
        </Form>
      </Card>

      {/* ── ③ test API 키 관리 ── */}
      <Card
        title={
          <Space>
            <KeyOutlined />
            test API 키
          </Space>
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setIsIssueModalOpen(true)}
          >
            test 키 발급
          </Button>
        }
        style={{ marginBottom: 24 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="test 키는 Partner API v1(/api/v1/*) 의 테스트 환경 전용입니다"
          description="live 키 발급은 Storige 운영팀 승인 절차를 통해서만 가능합니다(포털 발급 불가). 키 원문은 발급 순간에만 표시되며 이후에는 prefix 만 조회됩니다."
        />
        <Table
          rowKey="id"
          size="small"
          columns={keyColumns}
          dataSource={keys}
          loading={isKeysLoading}
          pagination={false}
        />
      </Card>

      {/* ── ④ 온보딩 안내 (가이드 §1.1 셀프 입력화) ── */}
      <Card title="온보딩 안내">
        <Paragraph>
          기존 온보딩 양식(파트너 → Storige 팀)의 항목 중{' '}
          <Text strong>허용 Origin 목록(allowedOrigins)</Text> 과{' '}
          <Text strong>웹훅 수신 URL(uploadCallbackUrl)</Text> 은 이 페이지에서
          직접 관리할 수 있습니다. 나머지 항목은 운영팀 처리가 필요합니다:
        </Paragraph>
        <ul>
          <li>
            <Text strong>연동 유형·회원번호 체계·보존정책(retentionDays)·대용량
            검증(&gt;1GB)</Text> — 운영팀에 요청 (가이드 §1.1 양식)
          </li>
          <li>
            <Text strong>live API 키</Text> — 운영팀 승인 큐 전용 (이 포털에서는
            test 키만 발급)
          </li>
          <li>
            <Text strong>iframe 임베드 허용 origin(frameAncestors)</Text> —
            편집기 CSP 에 반영되므로 운영팀이 처리
          </li>
        </ul>
        <Divider plain>웹훅 v2 설정</Divider>
        <Paragraph>
          웹훅 v2(사이트별 secret·이벤트 구독·발송 이력·재발송)는 Partner API
          v1 로 직접 관리합니다 — 위에서 발급한 <Text code>test</Text> 키로
          인증하세요 (test 키 설정은 test 발송에만 적용됩니다):
        </Paragraph>
        <Paragraph>
          <Text code>PUT /api/v1/webhooks/config</Text> · <Text code>GET
          /api/v1/webhooks/config</Text> · <Text code>POST
          /api/v1/webhooks/test</Text> · <Text code>GET
          /api/v1/webhooks/deliveries</Text>
        </Paragraph>
        <Paragraph type="secondary">
          자세한 절차는 PLATFORM_INTEGRATION_GUIDE(연동 가이드)를 참고하세요.
        </Paragraph>
      </Card>

      {/* test 키 발급 모달 */}
      <Modal
        title="test API 키 발급"
        open={isIssueModalOpen}
        onOk={async () => {
          const values = await issueForm.validateFields();
          issueMutation.mutate(values.name?.trim() || undefined);
        }}
        onCancel={() => {
          setIsIssueModalOpen(false);
          issueForm.resetFields();
        }}
        confirmLoading={issueMutation.isPending}
        okText="발급"
        cancelText="취소"
      >
        <Form form={issueForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="name"
            label="키 라벨 (선택)"
            rules={[{ max: 100, message: '100자 이내로 입력해주세요' }]}
          >
            <Input placeholder="예: staging integration" />
          </Form.Item>
          <Text type="secondary">
            발급되는 키는 <Text code>sk_test_…</Text> 형식의 테스트 환경
            전용이며, 원문은 발급 직후 1회만 표시됩니다.
          </Text>
        </Form>
      </Modal>
    </div>
  );
}
