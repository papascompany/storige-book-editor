import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Drawer,
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Popconfirm,
  Alert,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DownloadOutlined, StopOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  editDataApi,
  saveDownloadedFile,
  type StaffGrantItem,
  type StaffJobItem,
  type StaffSessionItem,
} from '../../api/edit-data';
import { describeApiError } from './editDataHelpers';

const { Title, Text } = Typography;

const JOB_STATUS_COLOR: Record<string, string> = {
  PENDING: 'default',
  PROCESSING: 'processing',
  COMPLETED: 'success',
  FIXABLE: 'warning',
  FAILED: 'error',
};

const DOWNLOADABLE_STATUSES = new Set(['COMPLETED', 'FIXABLE']);

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('ko-KR') : '-';
}

interface SessionJobsDrawerProps {
  session: StaffSessionItem | null;
  open: boolean;
  onClose: () => void;
}

/**
 * 세션별 작업(워커 잡)·열린 편집 권한 (2026-09-29).
 * 결과물 다운로드는 스코프 검사가 있는 /admin/edit-data/jobs/:id/output 만 사용한다.
 */
export function SessionJobsDrawer({ session, open, onClose }: SessionJobsDrawerProps) {
  const queryClient = useQueryClient();
  const sessionId = session?.id ?? '';
  const enabled = open && !!session;
  const [downloadingJobId, setDownloadingJobId] = useState<string | null>(null);

  const jobsQuery = useQuery({
    queryKey: ['edit-data-jobs', sessionId],
    queryFn: () => editDataApi.listJobs(sessionId),
    enabled,
  });

  const grantsQuery = useQuery({
    queryKey: ['edit-data-grants', sessionId],
    queryFn: () => editDataApi.listGrants(sessionId),
    enabled,
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => editDataApi.revokeGrant(grantId),
    onSuccess: () => {
      message.success('편집 권한을 회수했습니다. 열린 편집기 탭은 다음 저장부터 막힙니다.');
      queryClient.invalidateQueries({ queryKey: ['edit-data-grants', sessionId] });
    },
    onError: (err: unknown) => {
      message.error(describeApiError(err, '권한 회수에 실패했습니다.'));
    },
  });

  const handleDownload = async (job: StaffJobItem): Promise<void> => {
    setDownloadingJobId(job.id);
    try {
      const file = await editDataApi.downloadJobOutput(job.id);
      saveDownloadedFile(file, `output_${job.id.slice(0, 8)}.pdf`);
    } catch (err: unknown) {
      message.error(describeApiError(err, '결과물 다운로드에 실패했습니다.'));
    } finally {
      setDownloadingJobId(null);
    }
  };

  const jobColumns: ColumnsType<StaffJobItem> = [
    {
      title: '생성',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '유형',
      key: 'jobType',
      width: 170,
      render: (_, job) => (
        <Space size={4}>
          <Text>{job.jobType}</Text>
          {job.staffInitiated && <Tag color="purple">관리자</Tag>}
        </Space>
      ),
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (status: string) => (
        <Tag color={JOB_STATUS_COLOR[status] ?? 'default'}>{status}</Tag>
      ),
    },
    {
      title: '완료',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 160,
      render: (v: string | null) => formatDateTime(v),
    },
    {
      title: '결과물',
      key: 'output',
      width: 110,
      render: (_, job) =>
        DOWNLOADABLE_STATUSES.has(job.status) && job.hasOutput ? (
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingJobId === job.id}
            onClick={() => handleDownload(job)}
          >
            받기
          </Button>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
  ];

  const now = Date.now();
  const grantColumns: ColumnsType<StaffGrantItem> = [
    {
      title: '발급',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 160,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '만료',
      dataIndex: 'expiresAt',
      key: 'expiresAt',
      width: 160,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '상태',
      key: 'state',
      width: 150,
      render: (_, g) => {
        if (g.revokedAt) return <Tag>회수됨 {formatDateTime(g.revokedAt)}</Tag>;
        if (new Date(g.expiresAt).getTime() <= now) return <Tag>만료</Tag>;
        return <Tag color="green">사용 가능</Tag>;
      },
    },
    {
      title: '권한',
      dataIndex: 'capabilities',
      key: 'capabilities',
      render: (caps: string[]) => (
        <Space size={[4, 4]} wrap>
          {(caps ?? []).map((c) => (
            <Tag key={c} color={c === 'delete' ? 'red' : 'default'}>
              {c}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      render: (_, g) =>
        !g.revokedAt ? (
          <Popconfirm
            title="이 편집 권한을 회수할까요?"
            description="열린 편집기 탭은 다음 저장부터 막힙니다."
            onConfirm={() => revokeMutation.mutate(g.id)}
            okText="회수"
            cancelText="취소"
          >
            <Button
              size="small"
              danger
              icon={<StopOutlined />}
              loading={revokeMutation.isPending && revokeMutation.variables === g.id}
            >
              권한 회수
            </Button>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Drawer
      title={
        session
          ? `작업·권한 — ${session.siteName ?? '—'} · 주문번호 ${session.orderSeqno ?? '-'}`
          : '작업·권한'
      }
      open={open}
      onClose={onClose}
      width={860}
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            void jobsQuery.refetch();
            void grantsQuery.refetch();
          }}
          disabled={!enabled}
        >
          새로고침
        </Button>
      }
    >
      <Title level={5}>작업</Title>
      {jobsQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={describeApiError(jobsQuery.error, '작업 목록을 불러오지 못했습니다.', {
            listContext: true,
          })}
        />
      )}
      <Table<StaffJobItem>
        rowKey="id"
        size="small"
        columns={jobColumns}
        dataSource={jobsQuery.data ?? []}
        loading={jobsQuery.isLoading && enabled}
        pagination={false}
        locale={{ emptyText: '작업이 없습니다' }}
      />

      <Title level={5} style={{ marginTop: 24 }}>
        열린 편집 권한
      </Title>
      {grantsQuery.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={describeApiError(grantsQuery.error, '편집 권한 목록을 불러오지 못했습니다.', {
            listContext: true,
          })}
        />
      )}
      <Table<StaffGrantItem>
        rowKey="id"
        size="small"
        columns={grantColumns}
        dataSource={grantsQuery.data ?? []}
        loading={grantsQuery.isLoading && enabled}
        pagination={false}
        locale={{ emptyText: '발급된 편집 권한이 없습니다' }}
      />
    </Drawer>
  );
}
