import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Typography,
  message,
  Popconfirm,
  Tag,
  Input,
  Tooltip,
  Select,
  Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DownloadOutlined,
  EditOutlined,
  MergeCellsOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { sitesApi } from '../../api/sites';
import {
  editDataApi,
  saveDownloadedFile,
  type RetentionState,
  type SessionFileKind,
  type StaffSessionItem,
  type StaffSessionStatus,
} from '../../api/edit-data';
import { useAuthStore } from '../../stores/authStore';
import { isGlobalAdmin } from '../../utils/permissions';
import {
  buildEditorUrl,
  canCompleteItem,
  canDeleteItem,
  canOpenEditor,
  canSynthesize,
  describeApiError,
  isEditAllowed,
  isOrderLinked,
  orderLinkedAfterActionMessage,
  type OrderLinkedAction,
  retentionLabel,
  retentionTagColor,
} from './editDataHelpers';
import { SynthesizeModal } from './SynthesizeModal';
import { OrderLinkedConfirmModal, type OrderLinkedTarget } from './OrderLinkedConfirmModal';
import { usePartnerNoticeCopy } from './usePartnerNoticeCopy';

type NoticeAction = Exclude<OrderLinkedAction, 'synthesize'>;
import { SessionJobsDrawer } from './SessionJobsDrawer';

const { Title, Text } = Typography;

const EDITOR_BASE_URL: string = String(import.meta.env.VITE_EDITOR_URL || 'http://localhost:3000');

const STATUS_MAP: Record<StaffSessionStatus, { label: string; color: string }> = {
  draft: { label: '초안', color: 'default' },
  editing: { label: '편집중', color: 'processing' },
  complete: { label: '편집완료', color: 'success' },
};

const MODE_LABEL: Record<string, string> = {
  cover: '표지',
  content: '내지',
  both: '표지+내지',
  template: '템플릿',
  spread: '펼침면',
};

const RETENTION_FILTER_OPTIONS: { value: RetentionState; label: string }[] = [
  { value: 'active', label: '보관중' },
  { value: 'expired', label: '만료' },
  { value: 'unset', label: '미설정' },
];

const STATUS_FILTER_OPTIONS: { value: StaffSessionStatus; label: string }[] = [
  { value: 'draft', label: '초안' },
  { value: 'editing', label: '편집중' },
  { value: 'complete', label: '편집완료' },
];

const FILE_BUTTONS: { kind: SessionFileKind; field: keyof StaffSessionItem; label: string }[] = [
  { kind: 'cover', field: 'coverFileId', label: '표지' },
  { kind: 'content', field: 'contentFileId', label: '내지' },
  { kind: 'contentPdf', field: 'contentPdfFileId', label: '첨부 내지' },
];

function parseSeqno(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 편집데이터 관리 (2026-09-29 관리자 편집데이터 관리).
 * 파트너와 무관하게 사이트별 편집데이터 보관기간 안에서 편집·완료·삭제·합성·재합성.
 * 데이터·권한 판정은 /api/admin/edit-data (서버 스코프·보관기간·감사) 가 권위다.
 */
export const EditSessionList = () => {
  const queryClient = useQueryClient();
  const [searchMemberSeqno, setSearchMemberSeqno] = useState('');
  const [searchOrderSeqno, setSearchOrderSeqno] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<StaffSessionStatus | undefined>(undefined);
  const [retentionFilter, setRetentionFilter] = useState<RetentionState | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [synthesizeTarget, setSynthesizeTarget] = useState<StaffSessionItem | null>(null);
  const [jobsTarget, setJobsTarget] = useState<StaffSessionItem | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  // 파트너 주문 연결 세션(주문번호 있음)의 편집기 열기·완료·삭제·합성은 확인 창을 거친다(3-B 운영 원칙).
  const [orderConfirm, setOrderConfirm] = useState<OrderLinkedTarget | null>(null);
  const { copyingId: copyingNoticeId, copyNotice } = usePartnerNoticeCopy();
  // 확인 창을 거쳐 시작한 작업(작업·세션 id 별) — 성공하면 사후 통지를 안내한다.
  // 호출별 mutate 콜백은 마지막 호출만 받으므로 mutation 수준 onSuccess 에서 이 표를 본다.
  // 같은 작업·세션이 겹쳐 실행돼도 호출마다 안내하도록 진행 중 호출 수를 센다.
  const pendingNotice = useRef(new Map<string, { record: StaffSessionItem; count: number }>());
  // P3b — 헤더 테넌트 스위처가 컨텍스트를 고정하면 페이지 로컬 site 필터보다 우선.
  const currentSiteId = useAuthStore((s) => s.currentSiteId) ?? undefined;
  // GET /sites 는 전역 관리자 전용(사이트 운영자는 403) — 전역 관리자일 때만 드롭다운을 조회한다.
  // 역할 미하이드레이션(undefined)이면 종전처럼 조회한다(permissions.ts 보수 정책).
  const userRole = useAuthStore((s) => s.user?.role);
  const isGlobal = userRole ? isGlobalAdmin(userRole) : true;
  const effectiveSiteId = currentSiteId ?? selectedSiteId;

  // 사이트 dropdown 옵션 (전역 admin 전용 — 운영자는 GET /sites 403)
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
    enabled: !currentSiteId && isGlobal,
  });
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  const memberSeqno = parseSeqno(searchMemberSeqno);
  const orderSeqno = parseSeqno(searchOrderSeqno);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      'edit-data-sessions',
      'active',
      effectiveSiteId,
      memberSeqno,
      orderSeqno,
      statusFilter,
      retentionFilter,
      page,
      pageSize,
    ],
    queryFn: () =>
      editDataApi.listSessions({
        siteId: effectiveSiteId,
        memberSeqno,
        orderSeqno,
        status: statusFilter,
        retention: retentionFilter,
        deleted: 'exclude',
        page,
        limit: pageSize,
      }),
  });

  const invalidateLists = (): void => {
    queryClient.invalidateQueries({ queryKey: ['edit-data-sessions'] });
  };

  const settleNotice = (action: NoticeAction, sessionId: string, succeeded: boolean): void => {
    const key = `${action}:${sessionId}`;
    const entry = pendingNotice.current.get(key);
    if (!entry) return;
    if (entry.count <= 1) pendingNotice.current.delete(key);
    else entry.count -= 1;
    if (succeeded) message.warning(orderLinkedAfterActionMessage(action, entry.record), 10);
  };

  const openEditorMutation = useMutation({
    mutationFn: (sessionId: string) =>
      editDataApi.openEditorSession(sessionId, { allowDelete: false }),
    onSuccess: (res, sessionId) => {
      const url = buildEditorUrl(EDITOR_BASE_URL, res.editorPath, res.accessToken, res.refreshToken);
      window.open(url, '_blank', 'noopener,noreferrer');
      const expiresAt = new Date(res.grantExpiresAt).toLocaleString('ko-KR');
      message.success(
        `편집 권한 만료: ${expiresAt}. 저장 후 PDF를 갱신하려면 편집기에서 편집완료를 누르세요. 한 브라우저 탭당 한 세션을 편집합니다.`,
        8,
      );
      queryClient.invalidateQueries({ queryKey: ['edit-data-grants', res.sessionId] });
      settleNotice('open', sessionId, true);
    },
    onError: (err: unknown, sessionId) => {
      settleNotice('open', sessionId, false);
      message.error(describeApiError(err, '편집기 열기에 실패했습니다.'));
    },
  });

  const completeMutation = useMutation({
    mutationFn: (sessionId: string) => editDataApi.complete(sessionId),
    onSuccess: (_res, sessionId) => {
      message.success('편집 세션을 완료 처리했습니다.');
      invalidateLists();
      settleNotice('complete', sessionId, true);
    },
    onError: (err: unknown, sessionId) => {
      settleNotice('complete', sessionId, false);
      message.error(describeApiError(err, '완료 처리에 실패했습니다.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => editDataApi.remove(sessionId),
    onSuccess: (_res, sessionId) => {
      message.success('편집 세션을 삭제했습니다. [삭제 리스트]에서 확인할 수 있습니다.');
      invalidateLists();
      settleNotice('delete', sessionId, true);
    },
    onError: (err: unknown, sessionId) => {
      settleNotice('delete', sessionId, false);
      message.error(describeApiError(err, '삭제에 실패했습니다.'));
    },
  });

  // 표지/내지 입력 파일 — 세션 컬럼 기준 스코프 검사 라우트(/admin/edit-data/sessions/:id/files/:kind)
  const handleDownloadFile = async (record: StaffSessionItem, kind: SessionFileKind): Promise<void> => {
    const key = `${record.id}:${kind}`;
    setDownloadingKey(key);
    try {
      const file = await editDataApi.downloadSessionFile(record.id, kind);
      saveDownloadedFile(file, `${kind}_${record.id.slice(0, 8)}.pdf`);
    } catch (err: unknown) {
      message.error(describeApiError(err, '파일 다운로드에 실패했습니다.'));
    } finally {
      setDownloadingKey(null);
    }
  };

  // 확인 창에서 진행을 누른 주문 연결 세션 작업 실행
  const runAction = ({ action, record }: OrderLinkedTarget): void => {
    if (action === 'synthesize') {
      setSynthesizeTarget(record);
      return;
    }
    const key = `${action}:${record.id}`;
    const entry = pendingNotice.current.get(key);
    pendingNotice.current.set(key, { record, count: (entry?.count ?? 0) + 1 });
    if (action === 'open') openEditorMutation.mutate(record.id);
    else if (action === 'complete') completeMutation.mutate(record.id);
    else deleteMutation.mutate(record.id);
  };

  const now = new Date();

  const columns: ColumnsType<StaffSessionItem> = [
    {
      title: '사이트',
      dataIndex: 'siteName',
      key: 'site',
      width: 130,
      render: (_, record) =>
        record.siteId ? (
          <Tag color="blue">{record.siteName || record.siteId.slice(0, 8)}</Tag>
        ) : (
          <Tooltip title="사이트가 없는 이전 세션">
            <Text type="secondary">—</Text>
          </Tooltip>
        ),
    },
    {
      title: '주문번호',
      dataIndex: 'orderSeqno',
      key: 'orderSeqno',
      width: 150,
      render: (v: number | null, record) => (
        <Space size={4} wrap>
          <Text strong>{v || '-'}</Text>
          {isOrderLinked(record) && (
            <Tooltip title="파트너 주문번호(또는 장바구니 단계 번호)가 붙은 세션입니다. 실제 주문 여부는 세션 id로 파트너에 확인하세요. 관리자 작업은 파트너 주문 파일에 자동 반영되지 않으니 사전·사후 통지가 필요합니다.">
              <Tag color="gold">주문 연결</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '회원',
      key: 'member',
      width: 130,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.memberId || (record.isGuest ? '비회원' : '-')}</Text>
          {record.memberSeqno ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              #{record.memberSeqno}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '모드',
      dataIndex: 'mode',
      key: 'mode',
      width: 90,
      render: (mode: string) => MODE_LABEL[mode] ?? mode,
    },
    {
      title: '상태',
      key: 'status',
      width: 150,
      render: (_, record) => (
        <Space size={[4, 4]} wrap>
          <Tag color={STATUS_MAP[record.status]?.color ?? 'default'}>
            {STATUS_MAP[record.status]?.label ?? record.status}
          </Tag>
          {record.staffEditedAfterComplete && (
            <Tooltip title="관리자 편집 뒤 편집완료가 되지 않아 합성 결과가 이전 PDF 기준입니다">
              <Tag color="orange">편집 후 미완료</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '보관기한',
      key: 'retention',
      width: 190,
      render: (_, record) => (
        <Tag color={retentionTagColor(record.retention)}>{retentionLabel(record.retention, now)}</Tag>
      ),
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 110,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
    },
    {
      title: '완료일',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 110,
      render: (date: string | null) => (date ? new Date(date).toLocaleDateString('ko-KR') : '-'),
    },
    {
      title: '작업',
      key: 'actions',
      width: 440,
      fixed: 'right',
      render: (_, record) => {
        const editAllowed = isEditAllowed(record);
        const linked = isOrderLinked(record);
        const expiredTip = '보관기간이 지나 작업할 수 없습니다';
        const openTip = !record.siteId
          ? '사이트가 없는 이전 세션은 편집기·합성을 지원하지 않습니다'
          : !editAllowed
            ? expiredTip
            : '편집기에서 열기 (세션 1건 전용 단기 권한)';
        const synthTip = !record.siteId
          ? '사이트가 없는 이전 세션은 편집기·합성을 지원하지 않습니다'
          : !editAllowed
            ? expiredTip
            : '합성/재합성';
        return (
          <Space size={2} wrap>
            <Tooltip title={openTip}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                disabled={!canOpenEditor(record)}
                loading={openEditorMutation.isPending && openEditorMutation.variables === record.id}
                onClick={() =>
                  linked
                    ? setOrderConfirm({ action: 'open', record })
                    : openEditorMutation.mutate(record.id)
                }
              >
                편집기에서 열기
              </Button>
            </Tooltip>
            {record.status !== 'complete' && (
              <Tooltip title={editAllowed ? '완료 처리' : expiredTip}>
                {/* 주문 연결 세션은 Popconfirm 대신 확인 창(OrderLinkedConfirmModal) */}
                <Popconfirm
                  title="이 세션을 완료 처리할까요?"
                  description="고객 편집완료와 같은 후속 처리(검증 등)가 실행됩니다."
                  onConfirm={() => completeMutation.mutate(record.id)}
                  okText="완료 처리"
                  cancelText="취소"
                  disabled={!canCompleteItem(record) || linked}
                >
                  <Button
                    type="link"
                    size="small"
                    icon={<CheckCircleOutlined />}
                    disabled={!canCompleteItem(record)}
                    loading={completeMutation.isPending && completeMutation.variables === record.id}
                    onClick={linked ? () => setOrderConfirm({ action: 'complete', record }) : undefined}
                  >
                    완료 처리
                  </Button>
                </Popconfirm>
              </Tooltip>
            )}
            <Tooltip title={synthTip}>
              <Button
                type="link"
                size="small"
                icon={<MergeCellsOutlined />}
                disabled={!canSynthesize(record)}
                onClick={() =>
                  linked
                    ? setOrderConfirm({ action: 'synthesize', record })
                    : setSynthesizeTarget(record)
                }
              >
                합성/재합성
              </Button>
            </Tooltip>
            <Button
              type="link"
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => setJobsTarget(record)}
            >
              작업·권한
            </Button>
            {linked && (
              <Tooltip title="파트너 사후 통지용 세션 id·파일 id·시각(UTC)을 복사합니다">
                <Button
                  type="link"
                  size="small"
                  icon={<CopyOutlined />}
                  loading={copyingNoticeId === record.id}
                  onClick={() => copyNotice(record)}
                >
                  통지 정보 복사
                </Button>
              </Tooltip>
            )}
            {FILE_BUTTONS.map(({ kind, field, label }) =>
              record[field] ? (
                <Tooltip key={kind} title={`${label} 파일 다운로드`}>
                  <Button
                    type="link"
                    size="small"
                    icon={<DownloadOutlined />}
                    loading={downloadingKey === `${record.id}:${kind}`}
                    onClick={() => handleDownloadFile(record, kind)}
                  >
                    {label}
                  </Button>
                </Tooltip>
              ) : null,
            )}
            {canDeleteItem(record) && (
              <Popconfirm
                title="편집 세션을 삭제할까요?"
                description="삭제하면 고객·파트너 화면에서 사라지고 해당 세션 재편집·합성이 불가합니다. 보관기간 안에는 [삭제 리스트]에서 복구할 수 있습니다."
                onConfirm={() => deleteMutation.mutate(record.id)}
                okText="삭제"
                okButtonProps={{ danger: true }}
                cancelText="취소"
                disabled={linked}
              >
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleteMutation.isPending && deleteMutation.variables === record.id}
                  onClick={linked ? () => setOrderConfirm({ action: 'delete', record }) : undefined}
                >
                  삭제
                </Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={2}>편집데이터 관리</Title>
        <Text type="secondary">
          사이트별 편집데이터 보관기간 안(또는 미설정)인 세션은 편집기 열기·완료·합성/재합성·삭제를 할 수
          있습니다. 보관기간이 지난 세션은 삭제만 가능합니다.
        </Text>
      </div>

      <Space style={{ marginBottom: 16 }} wrap>
        {/* P3b — 헤더 스위처가 site 를 고정하면 로컬 필터 숨김(이중 컨트롤 방지) */}
        {!currentSiteId && (
          <Select
            placeholder="사이트 선택"
            allowClear
            style={{ width: 200 }}
            value={selectedSiteId}
            onChange={(v: string | undefined) => {
              setSelectedSiteId(v);
              setPage(1);
            }}
            options={siteOptions}
          />
        )}
        <Select
          placeholder="상태"
          allowClear
          style={{ width: 130 }}
          value={statusFilter}
          onChange={(v: StaffSessionStatus | undefined) => {
            setStatusFilter(v);
            setPage(1);
          }}
          options={STATUS_FILTER_OPTIONS}
        />
        <Select
          placeholder="보관기한"
          allowClear
          style={{ width: 130 }}
          value={retentionFilter}
          onChange={(v: RetentionState | undefined) => {
            setRetentionFilter(v);
            setPage(1);
          }}
          options={RETENTION_FILTER_OPTIONS}
        />
        <Input
          placeholder="회원번호 검색"
          prefix={<SearchOutlined />}
          value={searchMemberSeqno}
          onChange={(e) => {
            setSearchMemberSeqno(e.target.value);
            setPage(1);
          }}
          style={{ width: 150 }}
          allowClear
        />
        <Input
          placeholder="주문번호 검색"
          prefix={<SearchOutlined />}
          value={searchOrderSeqno}
          onChange={(e) => {
            setSearchOrderSeqno(e.target.value);
            setPage(1);
          }}
          style={{ width: 150 }}
          allowClear
        />
      </Space>

      {isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={describeApiError(error, '편집 세션 목록을 불러오지 못했습니다.', {
            listContext: true,
          })}
        />
      )}

      <Table<StaffSessionItem>
        columns={columns}
        dataSource={data?.items ?? []}
        rowKey="id"
        loading={isLoading}
        scroll={{ x: 1600 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `총 ${total}개`,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <OrderLinkedConfirmModal
        target={orderConfirm}
        onConfirm={(target) => {
          setOrderConfirm(null);
          runAction(target);
        }}
        onCancel={() => setOrderConfirm(null)}
      />
      <SynthesizeModal
        session={synthesizeTarget}
        open={!!synthesizeTarget}
        onClose={() => setSynthesizeTarget(null)}
      />
      <SessionJobsDrawer
        session={jobsTarget}
        open={!!jobsTarget}
        onClose={() => setJobsTarget(null)}
      />
    </div>
  );
};
