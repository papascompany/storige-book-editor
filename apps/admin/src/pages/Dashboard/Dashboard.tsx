import { useQuery } from '@tanstack/react-query';
import { Row, Col, Card, Statistic, Typography, Table, Tag, Spin } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  FileTextOutlined,
  FolderOutlined,
  PictureOutlined,
  CloudServerOutlined,
  AppstoreOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { templatesApi } from '../../api/templates';
import { categoriesApi } from '../../api/categories';
import { workerJobsApi } from '../../api/worker-jobs';
import { templateSetsApi } from '../../api/template-sets';
import { productTemplateSetsApi } from '../../api/product-template-sets';
import { QueueMonitorWidget } from '../../components/QueueMonitorWidget';

const { Title } = Typography;

export const Dashboard = () => {
  // Fetch statistics
  const { data: templates, isLoading: templatesLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.getAll(),
  });

  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getTree,
  });

  const { data: workerJobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['worker-jobs'],
    queryFn: () => workerJobsApi.getAll(),
  });

  const { data: templateSets, isLoading: templateSetsLoading } = useQuery({
    queryKey: ['template-sets-dashboard'],
    queryFn: () => templateSetsApi.getAll(),
  });

  const { data: productTemplateSets, isLoading: ptsLoading } = useQuery({
    queryKey: ['product-template-sets-dashboard'],
    queryFn: () => productTemplateSetsApi.getAll({ limit: 1 }),
  });

  // Count categories recursively
  const countCategories = (cats: any[]): number => {
    let count = cats.length;
    cats.forEach((cat) => {
      if (cat.children && cat.children.length > 0) {
        count += countCategories(cat.children);
      }
    });
    return count;
  };

  const totalCategories = categories ? countCategories(categories) : 0;
  const processingJobs = workerJobs?.filter(job => job.status === 'PROCESSING').length || 0;

  // Recent jobs for table
  const recentJobs = workerJobs?.slice(0, 5) || [];

  const jobColumns: ColumnsType<any> = [
    {
      title: '작업 ID',
      dataIndex: 'id',
      key: 'id',
      width: 200,
      render: (id: string) => id.substring(0, 8) + '...',
    },
    {
      title: '작업 타입',
      dataIndex: 'jobType',
      key: 'jobType',
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          VALIDATE: '검증',
          CONVERT: '변환',
          SYNTHESIZE: '합성',
        };
        return typeMap[type] || type;
      },
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          PENDING: 'default',
          PROCESSING: 'processing',
          COMPLETED: 'success',
          FAILED: 'error',
        };
        const textMap: Record<string, string> = {
          PENDING: '대기',
          PROCESSING: '처리중',
          COMPLETED: '완료',
          FAILED: '실패',
        };
        return <Tag color={colorMap[status]}>{textMap[status]}</Tag>;
      },
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (date: string) => new Date(date).toLocaleString('ko-KR'),
    },
  ];

  const isLoading = templatesLoading || categoriesLoading || jobsLoading || templateSetsLoading || ptsLoading;

  return (
    <div>
      <Title level={2}>대시보드</Title>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="전체 템플릿"
                  value={templates?.length || 0}
                  prefix={<FileTextOutlined />}
                />
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="템플릿셋"
                  value={templateSets?.length || 0}
                  prefix={<AppstoreOutlined />}
                />
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="상품-템플릿 연결"
                  value={productTemplateSets?.total || 0}
                  prefix={<LinkOutlined />}
                />
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="카테고리"
                  value={totalCategories}
                  prefix={<FolderOutlined />}
                />
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="전체 작업"
                  value={workerJobs?.length || 0}
                  prefix={<PictureOutlined />}
                />
              </Card>
            </Col>

            <Col xs={24} sm={12} lg={6}>
              <Card>
                <Statistic
                  title="처리 중인 작업"
                  value={processingJobs}
                  prefix={<CloudServerOutlined />}
                  valueStyle={{ color: processingJobs > 0 ? '#3f8600' : undefined }}
                />
              </Card>
            </Col>
          </Row>

          {/* 워커 큐 실시간 모니터링 (5초 폴링) */}
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <QueueMonitorWidget />
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
            <Col span={24}>
              <Card title="최근 워커 작업">
                {recentJobs.length > 0 ? (
                  <Table
                    columns={jobColumns}
                    dataSource={recentJobs}
                    rowKey="id"
                    pagination={false}
                  />
                ) : (
                  <p>최근 작업 내역이 없습니다.</p>
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  );
};
