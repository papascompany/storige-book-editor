import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Table,
  Space,
  Typography,
  Tag,
  Select,
  Button,
  Card,
  Row,
  Col,
  Statistic,
  Modal,
  Descriptions,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import { WorkerJob, WorkerJobStatus, WorkerJobType } from '@storige/types';
import { workerJobsApi } from '../../api/worker-jobs';
import { resolveStorageUrl } from '../../lib/axios';

const { Title } = Typography;

const statusColors: Record<WorkerJobStatus, string> = {
  [WorkerJobStatus.PENDING]: 'default',
  [WorkerJobStatus.PROCESSING]: 'processing',
  [WorkerJobStatus.COMPLETED]: 'success',
  [WorkerJobStatus.FAILED]: 'error',
};

const statusLabels: Record<WorkerJobStatus, string> = {
  [WorkerJobStatus.PENDING]: '대기 중',
  [WorkerJobStatus.PROCESSING]: '처리 중',
  [WorkerJobStatus.COMPLETED]: '완료',
  [WorkerJobStatus.FAILED]: '실패',
};

const jobTypeLabels: Record<WorkerJobType, string> = {
  [WorkerJobType.VALIDATE]: '검증',
  [WorkerJobType.CONVERT]: '변환',
  [WorkerJobType.SYNTHESIZE]: '합성',
};

export const WorkerJobList = () => {
  const [filterStatus, setFilterStatus] = useState<WorkerJobStatus | undefined>();
  const [filterJobType, setFilterJobType] = useState<WorkerJobType | undefined>();
  const [selectedJob, setSelectedJob] = useState<WorkerJob | null>(null);

  const { data: jobs, isLoading, refetch } = useQuery({
    queryKey: ['worker-jobs', filterStatus, filterJobType],
    queryFn: () => workerJobsApi.getAll(filterStatus, filterJobType),
    refetchInterval: 5000, // Auto-refresh every 5 seconds
  });

  const { data: stats } = useQuery({
    queryKey: ['worker-jobs-stats'],
    queryFn: workerJobsApi.getStats,
    refetchInterval: 10000,
  });

  const columns: ColumnsType<WorkerJob> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      ellipsis: true,
      render: (id: string) => <code>{id.substring(0, 8)}...</code>,
    },
    {
      title: '작업 유형',
      dataIndex: 'jobType',
      key: 'jobType',
      width: 100,
      render: (type: WorkerJobType) => <Tag color="blue">{jobTypeLabels[type]}</Tag>,
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: WorkerJobStatus) => (
        <Tag color={statusColors[status]}>{statusLabels[status]}</Tag>
      ),
    },
    {
      title: '입력 파일',
      dataIndex: 'inputFileUrl',
      key: 'inputFileUrl',
      ellipsis: true,
      render: (url: string) =>
        url ? (
          <a href={resolveStorageUrl(url)} target="_blank" rel="noopener noreferrer">
            파일 보기
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: '출력 파일',
      dataIndex: 'outputFileUrl',
      key: 'outputFileUrl',
      ellipsis: true,
      render: (url: string) =>
        url ? (
          <a href={resolveStorageUrl(url)} target="_blank" rel="noopener noreferrer">
            파일 보기
          </a>
        ) : (
          '-'
        ),
    },
    {
      title: '에러 메시지',
      dataIndex: 'errorMessage',
      key: 'errorMessage',
      ellipsis: true,
      render: (msg: string) => (msg ? <span style={{ color: 'red' }}>{msg}</span> : '-'),
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (date: string) =>
        new Date(date).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '작업',
      key: 'actions',
      width: 80,
      render: (_, record) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => setSelectedJob(record)}
        >
          상세
        </Button>
      ),
    },
  ];

  // Calculate statistics from stats data
  const getStatValue = (status?: WorkerJobStatus, jobType?: WorkerJobType) => {
    if (!stats || !Array.isArray(stats)) return 0;
    return stats
      .filter(
        (s: any) =>
          (!status || s.status === status) && (!jobType || s.jobType === jobType)
      )
      .reduce((sum: number, s: any) => sum + parseInt(s.count, 10), 0);
  };

  return (
    <div>
      <Title level={2}>워커 작업 모니터링</Title>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="대기 중"
              value={getStatValue(WorkerJobStatus.PENDING)}
              valueStyle={{ color: '#666' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="처리 중"
              value={getStatValue(WorkerJobStatus.PROCESSING)}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="완료"
              value={getStatValue(WorkerJobStatus.COMPLETED)}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="실패"
              value={getStatValue(WorkerJobStatus.FAILED)}
              valueStyle={{ color: '#f5222d' }}
            />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="상태 필터"
          style={{ width: 150 }}
          value={filterStatus}
          onChange={setFilterStatus}
          allowClear
          options={Object.entries(statusLabels).map(([value, label]) => ({
            label,
            value,
          }))}
        />
        <Select
          placeholder="작업 유형 필터"
          style={{ width: 150 }}
          value={filterJobType}
          onChange={setFilterJobType}
          allowClear
          options={Object.entries(jobTypeLabels).map(([value, label]) => ({
            label,
            value,
          }))}
        />
        <Button icon={<ReloadOutlined />} onClick={() => refetch()}>
          새로고침
        </Button>
      </Space>

      <Table
        columns={columns}
        dataSource={jobs}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      {/* 작업 상세 모달 */}
      <Modal
        title="워커 작업 상세"
        open={!!selectedJob}
        onCancel={() => setSelectedJob(null)}
        footer={<Button onClick={() => setSelectedJob(null)}>닫기</Button>}
        width={700}
      >
        {selectedJob && (
          <>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="Job ID">
                <Typography.Text code copyable>{selectedJob.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="작업 유형">
                <Tag color="blue">{jobTypeLabels[selectedJob.jobType]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="상태">
                <Tag color={statusColors[selectedJob.status]}>{statusLabels[selectedJob.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="입력 파일">
                {selectedJob.inputFileUrl ? (
                  <a href={resolveStorageUrl(selectedJob.inputFileUrl)} target="_blank" rel="noopener noreferrer">
                    {selectedJob.inputFileUrl}
                  </a>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="출력 파일">
                {selectedJob.outputFileUrl ? (
                  <a href={resolveStorageUrl(selectedJob.outputFileUrl)} target="_blank" rel="noopener noreferrer">
                    {selectedJob.outputFileUrl}
                  </a>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="에러 메시지">
                {selectedJob.errorMessage ? (
                  <Typography.Text type="danger">{selectedJob.errorMessage}</Typography.Text>
                ) : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="생성일">
                {new Date(selectedJob.createdAt).toLocaleString('ko-KR')}
              </Descriptions.Item>
              <Descriptions.Item label="완료일">
                {selectedJob.completedAt ? new Date(selectedJob.completedAt).toLocaleString('ko-KR') : '-'}
              </Descriptions.Item>
            </Descriptions>
            {selectedJob.result && (
              <Card title="처리 결과" size="small" style={{ marginTop: 16 }}>
                <pre style={{ maxHeight: 300, overflow: 'auto', fontSize: 12, background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
                  {JSON.stringify(selectedJob.result, null, 2)}
                </pre>
              </Card>
            )}
          </>
        )}
      </Modal>
    </div>
  );
};
