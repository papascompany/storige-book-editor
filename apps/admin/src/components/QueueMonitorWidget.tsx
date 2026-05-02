/**
 * Bull 큐 실시간 모니터링 위젯 (Admin Dashboard)
 *
 * 5초마다 자동 갱신. 큐 상태별로 색상 구분 (ok/warning/critical).
 * GET /health/queues 엔드포인트 호출 (JWT 인증 필요).
 */
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Tag, Tooltip, Space, Typography } from 'antd';
import {
  CheckCircleOutlined,
  WarningOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { axiosInstance } from '../lib/axios';

const { Text } = Typography;

interface QueueState {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  backlog: number;
  status: 'ok' | 'warning' | 'critical';
}

interface DashboardSnapshot {
  queues: Record<string, QueueState>;
  thresholds: {
    backlog: number;
    intervalMs: number;
    cooldownMs: number;
  };
  timestamp: string;
}

const queueLabels: Record<string, string> = {
  'pdf-validation': 'PDF 검증',
  'pdf-conversion': 'PDF 변환',
  'pdf-synthesis': 'PDF 합성',
};

const statusConfig = {
  ok: {
    color: '#52c41a',
    icon: <CheckCircleOutlined />,
    label: '정상',
    bgColor: '#f6ffed',
  },
  warning: {
    color: '#faad14',
    icon: <WarningOutlined />,
    label: '주의',
    bgColor: '#fffbe6',
  },
  critical: {
    color: '#ff4d4f',
    icon: <CloseCircleOutlined />,
    label: '적체',
    bgColor: '#fff1f0',
  },
};

export const QueueMonitorWidget = () => {
  const { data, isLoading, isError, error } = useQuery<DashboardSnapshot>({
    queryKey: ['queue-monitor'],
    queryFn: async () => {
      const res = await axiosInstance.get<DashboardSnapshot>('/health/queues');
      return res.data;
    },
    refetchInterval: 5000, // 5초마다 자동 갱신
    retry: 1,
  });

  if (isError) {
    return (
      <Card title="워커 큐 모니터링" size="small">
        <Text type="secondary">큐 상태를 가져올 수 없습니다.</Text>
        {error instanceof Error && <Text type="danger"> ({error.message})</Text>}
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card title="워커 큐 모니터링" size="small">
        <LoadingOutlined /> 로딩 중...
      </Card>
    );
  }

  const queueNames = Object.keys(data.queues);
  const hasIssue = queueNames.some(
    (name) => data.queues[name].status !== 'ok',
  );

  return (
    <Card
      size="small"
      title={
        <Space>
          <span>워커 큐 모니터링</span>
          {hasIssue ? (
            <Tag color="orange" icon={<WarningOutlined />}>이상 감지</Tag>
          ) : (
            <Tag color="green" icon={<CheckCircleOutlined />}>모두 정상</Tag>
          )}
        </Space>
      }
      extra={
        <Tooltip title={`적체 임계치: ${data.thresholds.backlog} · 갱신: 5초`}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {new Date(data.timestamp).toLocaleTimeString('ko-KR')}
          </Text>
        </Tooltip>
      }
    >
      <Row gutter={[12, 12]}>
        {queueNames.map((name) => {
          const q = data.queues[name];
          const cfg = statusConfig[q.status];
          return (
            <Col key={name} xs={24} sm={12} lg={8}>
              <Card
                size="small"
                style={{
                  background: cfg.bgColor,
                  borderLeft: `4px solid ${cfg.color}`,
                }}
                bodyStyle={{ padding: 12 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <Text strong>{queueLabels[name] || name}</Text>
                  <Tag color={cfg.color} icon={cfg.icon} style={{ margin: 0 }}>
                    {cfg.label}
                  </Tag>
                </div>
                <Row gutter={8}>
                  <Col span={8}>
                    <Statistic
                      title="대기"
                      value={q.waiting}
                      valueStyle={{ fontSize: 18 }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="처리중"
                      value={q.active}
                      valueStyle={{
                        fontSize: 18,
                        color: q.active > 0 ? cfg.color : undefined,
                      }}
                    />
                  </Col>
                  <Col span={8}>
                    <Statistic
                      title="실패"
                      value={q.failed}
                      valueStyle={{
                        fontSize: 18,
                        color: q.failed > 0 ? '#ff4d4f' : undefined,
                      }}
                    />
                  </Col>
                </Row>
                <div style={{ marginTop: 6, fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                  완료 {q.completed.toLocaleString()} · 지연 {q.delayed}
                </div>
              </Card>
            </Col>
          );
        })}
      </Row>
    </Card>
  );
};
