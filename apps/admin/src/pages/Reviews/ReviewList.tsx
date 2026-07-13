import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Input,
  Select,
  Card,
  Row,
  Col,
  Statistic,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  EyeOutlined,
  EditOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { EditSession, EditStatus } from '@storige/types';
import { reviewsApi } from '../../api/reviews';

const EDITOR_URL = import.meta.env.VITE_EDITOR_URL || 'http://localhost:3000';

const { Title, Text } = Typography;

const statusLabels: Record<EditStatus, string> = {
  [EditStatus.DRAFT]: '편집 중',
  [EditStatus.REVIEW]: '검토 대기',
  [EditStatus.SUBMITTED]: '완료',
};

const statusColors: Record<EditStatus, string> = {
  [EditStatus.DRAFT]: 'default',
  [EditStatus.REVIEW]: 'orange',
  [EditStatus.SUBMITTED]: 'green',
};

const statusIcons: Record<EditStatus, React.ReactNode> = {
  [EditStatus.DRAFT]: <SyncOutlined spin />,
  [EditStatus.REVIEW]: <ClockCircleOutlined />,
  [EditStatus.SUBMITTED]: <CheckCircleOutlined />,
};

export const ReviewList = () => {
  const navigate = useNavigate();
  const [searchText, setSearchText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<EditStatus | undefined>(EditStatus.REVIEW);

  // Fetch reviews
  const { data: reviewData, isLoading } = useQuery({
    queryKey: ['reviews', selectedStatus],
    queryFn: () => reviewsApi.getAll({ status: selectedStatus }),
  });

  // Statistics
  const { data: allData } = useQuery({
    queryKey: ['reviews-stats'],
    queryFn: () => reviewsApi.getAll({}),
  });

  const stats = {
    draft: allData?.items?.filter((s) => s.status === EditStatus.DRAFT).length || 0,
    review: allData?.items?.filter((s) => s.status === EditStatus.REVIEW).length || 0,
    submitted: allData?.items?.filter((s) => s.status === EditStatus.SUBMITTED).length || 0,
  };

  const handleViewDetail = (id: string) => {
    navigate(`/reviews/${id}`);
  };

  const handleOpenEditor = (id: string) => {
    // 외부 에디터 앱에서 검토 모드로 세션 열기
    window.open(`${EDITOR_URL}/?sessionId=${id}&mode=review`, '_blank');
  };

  const columns: ColumnsType<EditSession> = [
    {
      title: '세션 ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      render: (id: string) => (
        <Text copyable={{ text: id }}>
          {id.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: '사용자',
      dataIndex: 'userId',
      key: 'userId',
      width: 150,
    },
    {
      title: '주문번호',
      dataIndex: 'orderId',
      key: 'orderId',
      width: 150,
      render: (orderId: string) => orderId || '-',
    },
    {
      title: '페이지 수',
      dataIndex: 'pages',
      key: 'pages',
      width: 100,
      render: (pages: any[]) => `${pages?.length || 0}p`,
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: EditStatus) => (
        <Tag icon={statusIcons[status]} color={statusColors[status]}>
          {statusLabels[status]}
        </Tag>
      ),
    },
    {
      title: '잠금',
      key: 'lock',
      width: 120,
      render: (_, record) => (
        record.lockedBy ? (
          <Tag color="red">{record.lockedBy} 편집 중</Tag>
        ) : (
          <Tag color="green">편집 가능</Tag>
        )
      ),
    },
    {
      title: '수정일',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (date: string) => new Date(date).toLocaleString('ko-KR'),
      sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '작업',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            상세
          </Button>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleOpenEditor(record.id)}
            disabled={!!record.lockedBy}
          >
            에디터
          </Button>
        </Space>
      ),
    },
  ];

  // Filter by search
  const filteredItems = reviewData?.items?.filter((item) =>
    item.id.toLowerCase().includes(searchText.toLowerCase()) ||
    item.userId?.toLowerCase().includes(searchText.toLowerCase()) ||
    item.orderId?.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div>
      <Title level={2}>편집 검토</Title>

      {/* Statistics */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="편집 중"
              value={stats.draft}
              prefix={<SyncOutlined spin />}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="검토 대기"
              value={stats.review}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#fa8c16' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="완료"
              value={stats.submitted}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="세션/사용자/주문 검색"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250 }}
        />
        <Select
          placeholder="상태 선택"
          style={{ width: 150 }}
          value={selectedStatus}
          onChange={setSelectedStatus}
          allowClear
          options={[
            { label: '편집 중', value: EditStatus.DRAFT },
            { label: '검토 대기', value: EditStatus.REVIEW },
            { label: '완료', value: EditStatus.SUBMITTED },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={filteredItems}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />
    </div>
  );
};
