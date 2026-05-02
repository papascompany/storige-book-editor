/**
 * PDF Before/After 미리보기 컴포넌트
 *
 * FIXABLE 상태의 검증 결과를 받아 자동 수정 (변환) 잡을 실행하고
 * 원본 vs 수정본 PDF의 첫 페이지 썸네일을 좌우로 비교 표시.
 *
 * 동작:
 *  1. "자동 수정 미리보기" 버튼 클릭 → POST /worker-jobs/convert
 *  2. 수정 잡 폴링 (1초)
 *  3. 완료 시 outputFileUrl로 fixed PDF 썸네일 가져와 표시
 *  4. 원본 / 수정 메타데이터 (페이지 수 등) diff 표시
 */
import { useState } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Spin,
  Alert,
  Tag,
  Space,
  Typography,
  Image,
  Statistic,
} from 'antd';
import {
  RightOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { workerJobsApi, ValidationError } from '../api/worker-jobs';
import { axiosInstance, resolveStorageUrl } from '../lib/axios';

const { Text } = Typography;

interface Props {
  /** 원본 파일 URL ('storage/...' 또는 '/storage/...') */
  originalFileUrl: string;
  /** 검증 결과 메타데이터 */
  metadata: {
    pageCount?: number;
    pageSize?: { width: number; height: number };
  };
  /** 검증 에러 (autoFixable=true 만 활용) */
  errors: ValidationError[];
  /** 주문 옵션 (변환 시 필요) */
  orderOptions: {
    pages: number;
    bleed: number;
  };
}

export const PdfBeforeAfterPreview = ({
  originalFileUrl,
  metadata,
  errors,
  orderOptions,
}: Props) => {
  const [conversionJobId, setConversionJobId] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);

  // 자동 수정 가능한 에러만 추출
  const fixableErrors = errors.filter((e) => e.autoFixable);

  // 적용할 수정 옵션 추론
  const fixOptions = {
    addPages: fixableErrors.some((e) => e.fixMethod === 'addBlankPages'),
    applyBleed: fixableErrors.some((e) => e.fixMethod === 'extendBleed'),
    targetPages: orderOptions.pages,
    bleed: orderOptions.bleed,
  };

  // 변환 잡 생성
  const createConversionMutation = useMutation({
    mutationFn: async () => {
      const res = await axiosInstance.post('/worker-jobs/convert', {
        fileUrl: originalFileUrl,
        convertOptions: fixOptions,
      });
      return res.data;
    },
    onSuccess: (job) => {
      setConversionJobId(job.id);
      setPollingEnabled(true);
    },
  });

  // 변환 잡 폴링
  const { data: conversionJob } = useQuery({
    queryKey: ['conversion-job', conversionJobId],
    queryFn: async () => {
      if (!conversionJobId) return null;
      return workerJobsApi.getById(conversionJobId);
    },
    enabled: !!conversionJobId && pollingEnabled,
    refetchInterval: pollingEnabled ? 1000 : false,
  });

  // 완료 시 폴링 중지
  if (
    conversionJob &&
    (conversionJob.status === 'COMPLETED' || conversionJob.status === 'FAILED') &&
    pollingEnabled
  ) {
    setPollingEnabled(false);
  }

  const fixedFileUrl =
    conversionJob?.status === 'COMPLETED'
      ? (conversionJob.result as any)?.outputFileUrl
      : undefined;

  // PDF 썸네일 URL 생성 (API의 /files/{id}/thumbnail 또는 직접 PDF 표시)
  const buildThumbnailUrl = (url?: string) => {
    if (!url) return undefined;
    const resolved = resolveStorageUrl(url);
    // 일단 PDF 자체를 iframe/embed로 표시 (썸네일 endpoint는 fileId 기반인데 여기는 URL 기반)
    return resolved;
  };

  if (fixableErrors.length === 0) {
    return null; // 자동 수정 가능한 에러 없으면 표시 안 함
  }

  return (
    <Card
      title={
        <Space>
          <span>자동 수정 미리보기 (Before / After)</span>
          <Tag color="blue">{fixableErrors.length}개 자동 수정 가능</Tag>
        </Space>
      }
      style={{ marginTop: 16 }}
      extra={
        !conversionJobId ? (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={() => createConversionMutation.mutate()}
            loading={createConversionMutation.isPending}
          >
            자동 수정 적용
          </Button>
        ) : conversionJob?.status === 'PROCESSING' || conversionJob?.status === 'PENDING' ? (
          <Tag color="processing" icon={<LoadingOutlined spin />}>
            변환 중...
          </Tag>
        ) : conversionJob?.status === 'COMPLETED' ? (
          <Tag color="success" icon={<CheckCircleOutlined />}>완료</Tag>
        ) : null
      }
    >
      {/* 적용 예정 수정 항목 */}
      <Alert
        type="info"
        message="다음 자동 수정이 적용됩니다:"
        description={
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {fixableErrors.map((err, idx) => (
              <li key={idx}>
                {err.message} <Text type="secondary">({err.fixMethod})</Text>
              </li>
            ))}
          </ul>
        }
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* Before / After 비교 */}
      <Row gutter={16} align="middle">
        {/* Before */}
        <Col xs={24} md={11}>
          <Card
            size="small"
            title={<Text strong>Before (원본)</Text>}
            bodyStyle={{ padding: 8, textAlign: 'center', minHeight: 240 }}
          >
            <iframe
              src={buildThumbnailUrl(originalFileUrl)}
              style={{ width: '100%', height: 220, border: 0 }}
              title="원본 PDF"
            />
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={12}>
                <Statistic
                  title="페이지"
                  value={metadata.pageCount || 0}
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
              <Col span={12}>
                <Statistic
                  title="크기 (mm)"
                  value={
                    metadata.pageSize
                      ? `${metadata.pageSize.width.toFixed(0)}x${metadata.pageSize.height.toFixed(0)}`
                      : '-'
                  }
                  valueStyle={{ fontSize: 16 }}
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* Arrow */}
        <Col xs={0} md={2} style={{ textAlign: 'center' }}>
          <RightOutlined style={{ fontSize: 24, color: '#1890ff' }} />
        </Col>

        {/* After */}
        <Col xs={24} md={11}>
          <Card
            size="small"
            title={
              <Text strong>
                After (수정본){' '}
                {fixedFileUrl && <Tag color="green" style={{ marginLeft: 4 }}>완료</Tag>}
              </Text>
            }
            bodyStyle={{ padding: 8, textAlign: 'center', minHeight: 240 }}
          >
            {fixedFileUrl ? (
              <>
                <iframe
                  src={buildThumbnailUrl(fixedFileUrl)}
                  style={{ width: '100%', height: 220, border: 0 }}
                  title="수정본 PDF"
                />
                <Row gutter={8} style={{ marginTop: 8 }}>
                  <Col span={12}>
                    <Statistic
                      title="페이지 (수정)"
                      value={(conversionJob?.result as any)?.result?.totalPages || orderOptions.pages}
                      valueStyle={{ fontSize: 16, color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={12}>
                    <Statistic
                      title="추가됨"
                      value={(conversionJob?.result as any)?.result?.pagesAdded || 0}
                      suffix="p"
                      valueStyle={{
                        fontSize: 16,
                        color: ((conversionJob?.result as any)?.result?.pagesAdded || 0) > 0 ? '#52c41a' : undefined,
                      }}
                    />
                  </Col>
                </Row>
              </>
            ) : conversionJob?.status === 'PROCESSING' || conversionJob?.status === 'PENDING' ? (
              <div style={{ padding: 80 }}>
                <Spin size="large" tip="수정 중..." />
              </div>
            ) : conversionJob?.status === 'FAILED' ? (
              <Alert
                type="error"
                message="자동 수정 실패"
                description={conversionJob.errorMessage}
                showIcon
              />
            ) : (
              <div style={{ padding: 80, color: '#999' }}>
                <Image
                  preview={false}
                  width={100}
                  src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'%3E%3Cpath d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/%3E%3C/svg%3E"
                  alt="대기"
                />
                <p>
                  <Text type="secondary">상단 버튼으로 자동 수정 미리보기를 시작하세요.</Text>
                </p>
              </div>
            )}
          </Card>
        </Col>
      </Row>
    </Card>
  );
};
