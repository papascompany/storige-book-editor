import { useState } from 'react';
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
import { CopyOutlined, SearchOutlined, UndoOutlined } from '@ant-design/icons';
import { sitesApi } from '../../api/sites';
import { editDataApi, type StaffSessionItem } from '../../api/edit-data';
import { useAuthStore } from '../../stores/authStore';
import { isGlobalAdmin } from '../../utils/permissions';
import {
  canRestoreItem,
  describeApiError,
  isOrderLinked,
  orderMetaSummary,
  retentionLabel,
  retentionTagColor,
} from './editDataHelpers';
import { usePartnerNoticeCopy } from './usePartnerNoticeCopy';

const { Title, Text } = Typography;

// 세션 상태 라벨 — API 실값은 draft/editing/complete
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: '초안', color: 'default' },
  editing: { label: '편집중', color: 'processing' },
  complete: { label: '편집완료', color: 'success' },
};

function parseSeqno(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * 삭제 리스트 (2026-06-11, 2026-09-29 관리자 편집데이터 관리로 전환) — 삭제된(soft delete) 편집 세션 조회 + 복구.
 *
 * 고객 삭제·관리자 삭제 모두 soft delete 라 보관기간 안이면 [복구] 한 번으로 고객 보관함/불러오기에 재노출된다.
 * 복구는 삭제 권한(canDelete, 서버 판정)이 있고 편집데이터 보관기간이 지나지 않은 세션만 가능하다.
 */
export const DeletedSessionList = () => {
  const queryClient = useQueryClient();
  const [searchMemberSeqno, setSearchMemberSeqno] = useState('');
  const [searchOrderSeqno, setSearchOrderSeqno] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  // 주문 연결 세션 삭제의 사후 통지(세션 id·삭제 시각 UTC)는 여기서 복사한다(3-B 운영 원칙).
  const { copyingId, copyNotice } = usePartnerNoticeCopy();
  // 헤더 테넌트 스위처가 고정한 site 가 로컬 필터보다 우선(EditSessionList 와 동일)
  const currentSiteId = useAuthStore((s) => s.currentSiteId) ?? undefined;
  // GET /sites 는 전역 관리자 전용(사이트 운영자는 403) — 전역 관리자일 때만 드롭다운을 조회한다.
  // 역할 미하이드레이션(undefined)이면 종전처럼 조회한다(permissions.ts 보수 정책).
  const userRole = useAuthStore((s) => s.user?.role);
  const isGlobal = userRole ? isGlobalAdmin(userRole) : true;
  const effectiveSiteId = currentSiteId ?? selectedSiteId;

  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
    enabled: !currentSiteId && isGlobal,
  });
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  const memberSeqno = parseSeqno(searchMemberSeqno);
  const orderSeqno = parseSeqno(searchOrderSeqno);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['edit-data-sessions', 'deleted', effectiveSiteId, memberSeqno, orderSeqno, page, pageSize],
    queryFn: () =>
      editDataApi.listSessions({
        deleted: 'only',
        siteId: effectiveSiteId,
        memberSeqno,
        orderSeqno,
        page,
        limit: pageSize,
      }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => editDataApi.restore(id),
    onSuccess: () => {
      message.success('세션을 복구했습니다. 고객 보관함에 다시 표시됩니다.');
      queryClient.invalidateQueries({ queryKey: ['edit-data-sessions'] });
    },
    onError: (err: unknown) => {
      message.error(describeApiError(err, '복구에 실패했습니다.'));
    },
  });

  const now = new Date();

  const columns: ColumnsType<StaffSessionItem> = [
    {
      title: '고객아이디',
      dataIndex: 'memberId',
      key: 'memberId',
      width: 160,
      render: (memberId: string | null, r) =>
        memberId ? (
          <Text>{memberId}</Text>
        ) : (
          <Text type="secondary">{r.isGuest ? '비회원' : '- (메타 없음)'}</Text>
        ),
    },
    {
      title: '사이트',
      key: 'site',
      width: 120,
      render: (_, r) =>
        r.siteId ? (
          <Tag color="blue">{r.siteName || r.siteId.slice(0, 8)}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '회원번호',
      dataIndex: 'memberSeqno',
      key: 'memberSeqno',
      width: 100,
      render: (v: number | null) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: '주문번호',
      dataIndex: 'orderSeqno',
      key: 'orderSeqno',
      width: 150,
      render: (v: number | null, r) => (
        <Space size={4} wrap>
          <Text strong>{v || '-'}</Text>
          {isOrderLinked(r) && (
            <Tooltip title="파트너 주문에 연결된 세션입니다. 삭제·복구 사실을 파트너에 알리세요.">
              <Tag color="gold">주문 연결</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '템플릿셋',
      dataIndex: 'templateSetName',
      key: 'templateSetName',
      width: 160,
      ellipsis: true,
      render: (v: string | null, r) => v || r.templateSetId || '-',
    },
    {
      title: '제작 스펙',
      key: 'spec',
      width: 200,
      ellipsis: true,
      render: (_, r) => {
        const summary = orderMetaSummary(r.orderMeta);
        return (
          <Tooltip title={summary}>
            <Text style={{ fontSize: 12 }}>{summary}</Text>
          </Tooltip>
        );
      },
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => (
        <Tag color={STATUS_LABEL[status]?.color || 'default'}>
          {STATUS_LABEL[status]?.label || status}
        </Tag>
      ),
    },
    {
      title: '보관기한',
      key: 'retention',
      width: 190,
      render: (_, r) => (
        <Tag color={retentionTagColor(r.retention)}>{retentionLabel(r.retention, now)}</Tag>
      ),
    },
    {
      title: '최초편집',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (v: string) => (v ? new Date(v).toLocaleString('ko-KR') : '-'),
    },
    {
      title: '마지막편집',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (v: string) => (v ? new Date(v).toLocaleString('ko-KR') : '-'),
    },
    {
      title: '삭제요청시간',
      dataIndex: 'deletedAt',
      key: 'deletedAt',
      width: 150,
      render: (v: string | null) => (
        <Text type="danger">{v ? new Date(v).toLocaleString('ko-KR') : '-'}</Text>
      ),
    },
    {
      title: '작업',
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (_, r) => (
        <Space size={4} wrap>
          {canRestoreItem(r) ? (
            <Popconfirm
              title="이 세션을 복구할까요?"
              description="복구 즉시 고객 보관함/불러오기 목록에 다시 표시됩니다."
              onConfirm={() => restoreMutation.mutate(r.id)}
              okText="복구"
              cancelText="취소"
            >
              <Button
                size="small"
                icon={<UndoOutlined />}
                loading={restoreMutation.isPending && restoreMutation.variables === r.id}
              >
                복구
              </Button>
            </Popconfirm>
          ) : (
            <Tooltip
              title={
                r.canDelete ? '보관기간이 지나 복구할 수 없습니다' : '복구 권한이 없습니다'
              }
            >
              <Text type="secondary">-</Text>
            </Tooltip>
          )}
          {isOrderLinked(r) && (
            <Tooltip title="파트너 사후 통지용 세션 id·삭제 시각(UTC)을 복사합니다">
              <Button
                size="small"
                icon={<CopyOutlined />}
                loading={copyingId === r.id}
                onClick={() => copyNotice(r)}
              >
                통지 정보 복사
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
        <Title level={4} style={{ margin: 0 }}>
          삭제 리스트
        </Title>
        <Space wrap>
          {!currentSiteId && (
            <Select
              placeholder="사이트 선택"
              allowClear
              style={{ width: 180 }}
              value={selectedSiteId}
              onChange={(v: string | undefined) => {
                setSelectedSiteId(v);
                setPage(1);
              }}
              options={siteOptions}
            />
          )}
          <Input
            placeholder="회원번호 검색"
            value={searchMemberSeqno}
            onChange={(e) => { setSearchMemberSeqno(e.target.value); setPage(1); }}
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 160 }}
          />
          <Input
            placeholder="주문번호 검색"
            value={searchOrderSeqno}
            onChange={(e) => { setSearchOrderSeqno(e.target.value); setPage(1); }}
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 160 }}
          />
        </Space>
      </Space>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
        고객 또는 관리자가 삭제한 편집 세션이 누적 표시됩니다. 편집데이터 보관기간 안이면 [복구] 시 고객
        계정의 보관함·불러오기 목록에 즉시 재노출됩니다. (게스트 작업은 24시간 후 영구 삭제되어 복구할 수
        없습니다.)
      </Text>
      {isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={describeApiError(error, '삭제 리스트를 불러오지 못했습니다.', { listContext: true })}
        />
      )}
      <Table<StaffSessionItem>
        rowKey="id"
        columns={columns}
        dataSource={data?.items ?? []}
        loading={isLoading}
        scroll={{ x: 1730 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total ?? 0,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (t) => `총 ${t}건`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </div>
  );
};
