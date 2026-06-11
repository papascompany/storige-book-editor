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
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { SearchOutlined, UndoOutlined } from '@ant-design/icons';
import { editSessionsApi, EditSessionResponse } from '../../api/edit-sessions';

const { Title, Text } = Typography;

// 세션 상태 라벨 — API 실값은 draft/editing/complete (edit-sessions.ts 의 구형 타입과 별개)
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  draft: { label: '초안', color: 'default' },
  editing: { label: '편집중', color: 'processing' },
  complete: { label: '편집완료', color: 'success' },
  completed: { label: '편집완료', color: 'success' },
};

/** metadata 에서 제작 스펙 요약 문자열 생성 (orderOptions/spread/spine 우선순위) */
function specSummary(metadata: Record<string, any> | null | undefined): string {
  if (!metadata) return '-';
  const parts: string[] = [];
  const oo = metadata.orderOptions || {};
  const spine = metadata.spine || {};
  const spread = metadata.spread || {};
  const size = oo.size || metadata.size;
  if (size?.width && size?.height) parts.push(`${size.width}×${size.height}mm`);
  else if (spread?.spec?.coverWidthMm) parts.push(`표지 ${spread.spec.coverWidthMm}×${spread.spec.coverHeightMm}mm`);
  const pageCount = oo.pageCount ?? spine.pageCount ?? metadata.pages;
  if (pageCount) parts.push(`${pageCount}p`);
  const paper = oo.paperType ?? spine.paperType;
  if (paper) parts.push(String(paper));
  const binding = oo.bindingType ?? spine.bindingType ?? metadata.binding;
  if (binding) parts.push(String(binding));
  if (oo.quantity) parts.push(`${oo.quantity}부`);
  return parts.length ? parts.join(' · ') : '-';
}

/**
 * 삭제 리스트 (2026-06-11) — 고객이 보관함/장바구니에서 삭제한 편집 세션 누적 조회 + 복구.
 *
 * 고객의 "실수로 삭제했어요, 살려주세요" 요구 대응: soft delete 라 파일이 보존되므로
 * [복구] 한 번으로 고객 보관함/불러오기 모달에 즉시 재노출된다.
 * 고객아이디는 세션 생성 시 JWT 에서 스냅샷한 metadata.member.memberId (2026-06-11 이후 세션).
 */
export const DeletedSessionList = () => {
  const queryClient = useQueryClient();
  const [searchMemberSeqno, setSearchMemberSeqno] = useState('');
  const [searchOrderSeqno, setSearchOrderSeqno] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['edit-sessions-deleted', searchMemberSeqno, searchOrderSeqno, page, pageSize],
    queryFn: () =>
      editSessionsApi.getDeleted({
        memberSeqno: searchMemberSeqno ? parseInt(searchMemberSeqno) : undefined,
        orderSeqno: searchOrderSeqno ? parseInt(searchOrderSeqno) : undefined,
        page,
        limit: pageSize,
      }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => editSessionsApi.restore(id),
    onSuccess: () => {
      message.success('세션을 복구했습니다. 고객 보관함에 다시 표시됩니다.');
      queryClient.invalidateQueries({ queryKey: ['edit-sessions-deleted'] });
      queryClient.invalidateQueries({ queryKey: ['edit-sessions'] });
    },
    onError: (e: any) => {
      message.error(e?.response?.data?.message || '복구에 실패했습니다.');
    },
  });

  const columns: ColumnsType<EditSessionResponse> = [
    {
      title: '고객아이디',
      key: 'memberId',
      width: 180,
      render: (_, r) => {
        const memberId = (r.metadata as any)?.member?.memberId;
        const memberName = (r.metadata as any)?.member?.memberName;
        return memberId ? (
          <Tooltip title={memberName || undefined}>
            <Text>{memberId}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">- (메타 없음)</Text>
        );
      },
    },
    {
      title: '회원번호',
      dataIndex: 'memberSeqno',
      key: 'memberSeqno',
      width: 120,
      render: (v: number) => <Text type="secondary">{v || '-'}</Text>,
    },
    {
      title: '주문번호',
      dataIndex: 'orderSeqno',
      key: 'orderSeqno',
      width: 130,
      render: (v: number) => <Text strong>{v || '-'}</Text>,
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
      render: (_, r) => (
        <Tooltip title={specSummary(r.metadata)}>
          <Text style={{ fontSize: 12 }}>{specSummary(r.metadata)}</Text>
        </Tooltip>
      ),
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
      render: (v: string) => (
        <Text type="danger">{v ? new Date(v).toLocaleString('ko-KR') : '-'}</Text>
      ),
    },
    {
      title: '복구',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_, r) => (
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
            loading={restoreMutation.isPending}
          >
            복구
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          삭제 리스트
        </Title>
        <Space>
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
        고객이 편집보관함/장바구니에서 삭제한 편집 세션이 누적 표시됩니다. 파일은 보존되므로
        [복구] 시 고객 계정의 보관함·불러오기 목록에 즉시 재노출됩니다. (게스트 작업은 24시간 후
        영구 삭제되어 복구할 수 없습니다.)
      </Text>
      <Table<EditSessionResponse>
        rowKey="id"
        columns={columns}
        dataSource={data?.sessions || []}
        loading={isLoading}
        scroll={{ x: 1320 }}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (t) => `총 ${t}건`,
          onChange: (p, ps) => { setPage(p); setPageSize(ps); },
        }}
      />
    </div>
  );
};
