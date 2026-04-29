import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Button,
  Space,
  Typography,
  Tag,
  Descriptions,
  Image,
  Row,
  Col,
  Timeline,
  Modal,
  Input,
  message,
  Spin,
  Empty,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  HistoryOutlined,
  ZoomInOutlined,
} from '@ant-design/icons';
import { EditStatus, TemplateType } from '@storige/types';
import { reviewsApi } from '../../api/reviews';
import { useAuthStore } from '../../stores/authStore';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

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

const templateTypeLabels: Record<TemplateType, string> = {
  [TemplateType.WING]: '날개',
  [TemplateType.COVER]: '표지',
  [TemplateType.SPINE]: '책등',
  [TemplateType.PAGE]: '내지',
  [TemplateType.SPREAD]: '스프레드',
};

export const ReviewDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // 현재 로그인한 admin 사용자 — 승인/반려 시 누가 했는지 기록.
  // 옛 코드는 'admin' 문자열을 하드코딩해서 모든 승인이 같은 사용자로
  // 기록됐음. 이제 실제 로그인한 사용자 id 사용.
  const currentUser = useAuthStore((s) => s.user);
  const reviewerId = currentUser?.id ?? 'admin';

  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Fetch session detail
  const { data: session, isLoading } = useQuery({
    queryKey: ['review', id],
    queryFn: () => reviewsApi.getById(id!),
    enabled: !!id,
  });

  // Fetch history
  const { data: history } = useQuery({
    queryKey: ['review-history', id],
    queryFn: () => reviewsApi.getHistory(id!),
    enabled: !!id,
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () =>
      reviewsApi.changeStatus(
        id!,
        { status: EditStatus.SUBMITTED },
        reviewerId
      ),
    onSuccess: () => {
      message.success('승인되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['review', id] });
    },
    onError: () => {
      message.error('승인에 실패했습니다.');
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: () =>
      reviewsApi.changeStatus(
        id!,
        { status: EditStatus.DRAFT, comment: rejectReason },
        reviewerId
      ),
    onSuccess: () => {
      message.success('반려되었습니다.');
      setRejectModalOpen(false);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: ['review', id] });
    },
    onError: () => {
      message.error('반려에 실패했습니다.');
    },
  });

  const handleApprove = () => {
    Modal.confirm({
      title: '승인 확인',
      content: '이 편집물을 승인하시겠습니까? 승인 후 인쇄가 진행됩니다.',
      okText: '승인',
      cancelText: '취소',
      onOk: () => approveMutation.mutate(),
    });
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      message.warning('반려 사유를 입력해주세요.');
      return;
    }
    rejectMutation.mutate();
  };

  const handleOpenEditor = () => {
    window.open(`/editor?sessionId=${id}&mode=review`, '_blank');
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!session) {
    return <Empty description="세션을 찾을 수 없습니다." />;
  }

  const isReviewStatus = session.status === EditStatus.REVIEW;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/reviews')}>
            목록으로
          </Button>
          <Title level={3} style={{ margin: 0 }}>
            검토 상세
          </Title>
          <Tag color={statusColors[session.status]}>{statusLabels[session.status]}</Tag>
        </Space>

        <Space>
          <Button icon={<EditOutlined />} onClick={handleOpenEditor}>
            에디터에서 열기
          </Button>
          {isReviewStatus && (
            <>
              <Button
                icon={<CloseOutlined />}
                danger
                onClick={() => setRejectModalOpen(true)}
              >
                반려
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleApprove}
                loading={approveMutation.isPending}
              >
                승인
              </Button>
            </>
          )}
        </Space>
      </div>

      <Row gutter={24}>
        {/* Session Info */}
        <Col span={16}>
          <Card title="세션 정보" style={{ marginBottom: 24 }}>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="세션 ID">{session.id}</Descriptions.Item>
              <Descriptions.Item label="사용자">{session.userId || '-'}</Descriptions.Item>
              <Descriptions.Item label="주문번호">{session.orderId || '-'}</Descriptions.Item>
              <Descriptions.Item label="템플릿셋">{session.templateSetId}</Descriptions.Item>
              <Descriptions.Item label="페이지 수">{session.pages?.length || 0}p</Descriptions.Item>
              <Descriptions.Item label="상태">
                <Tag color={statusColors[session.status]}>{statusLabels[session.status]}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="잠금 상태">
                {session.lockedBy ? (
                  <Tag color="red">{session.lockedBy} 편집 중</Tag>
                ) : (
                  <Tag color="green">편집 가능</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="최종 수정">
                {session.modifiedBy && `${session.modifiedBy} | `}
                {new Date(session.updatedAt).toLocaleString('ko-KR')}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {/* Page Thumbnails */}
          <Card title={`페이지 미리보기 (${session.pages?.length || 0}p)`}>
            {session.pages?.length === 0 ? (
              <Empty description="페이지가 없습니다." />
            ) : (
              <Row gutter={[16, 16]}>
                {session.pages?.map((page, index) => (
                  <Col key={page.id} span={6}>
                    <Card
                      size="small"
                      hoverable
                      cover={
                        <div
                          style={{
                            height: 120,
                            background: '#f0f0f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                          }}
                        >
                          <Text type="secondary">{index + 1}p</Text>
                          <Button
                            type="text"
                            icon={<ZoomInOutlined />}
                            style={{ position: 'absolute', top: 4, right: 4 }}
                            onClick={() => setPreviewImage(`/api/pages/${page.id}/thumbnail`)}
                          />
                        </div>
                      }
                    >
                      <Card.Meta
                        title={`${index + 1}페이지`}
                        description={
                          <Space>
                            <Tag>{templateTypeLabels[page.templateType]}</Tag>
                            {page.required && <Tag color="red">필수</Tag>}
                          </Space>
                        }
                      />
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </Card>
        </Col>

        {/* History */}
        <Col span={8}>
          <Card title={<><HistoryOutlined /> 수정 이력</>}>
            {!history?.length ? (
              <Empty description="이력이 없습니다." />
            ) : (
              <Timeline
                items={history.map((item) => ({
                  children: (
                    <div>
                      <Text strong>{item.action}</Text>
                      <br />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {item.userName || item.userId} |{' '}
                        {new Date(item.createdAt).toLocaleString('ko-KR')}
                      </Text>
                      {item.details && (
                        <Paragraph
                          type="secondary"
                          style={{ fontSize: 12, marginTop: 4, marginBottom: 0 }}
                        >
                          {item.details}
                        </Paragraph>
                      )}
                    </div>
                  ),
                }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* Reject Modal */}
      <Modal
        title="반려 사유 입력"
        open={rejectModalOpen}
        onCancel={() => setRejectModalOpen(false)}
        onOk={handleReject}
        okText="반려"
        okButtonProps={{
          danger: true,
          loading: rejectMutation.isPending,
        }}
        cancelText="취소"
      >
        <TextArea
          rows={4}
          placeholder="반려 사유를 입력해주세요. 사용자에게 전달됩니다."
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
        />
      </Modal>

      {/* Image Preview Modal */}
      <Image
        style={{ display: 'none' }}
        preview={{
          visible: !!previewImage,
          src: previewImage || '',
          onVisibleChange: (visible) => {
            if (!visible) setPreviewImage(null);
          },
        }}
      />
    </div>
  );
};
