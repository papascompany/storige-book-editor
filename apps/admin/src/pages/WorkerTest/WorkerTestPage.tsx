import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Typography,
  Card,
  Form,
  Input,
  InputNumber,
  Select,
  Button,
  Upload,
  Space,
  Divider,
  Alert,
  Spin,
  Tag,
  Descriptions,
  Table,
  message,
  Row,
  Col,
  Tabs,
} from 'antd';
import {
  UploadOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import type { ColumnsType } from 'antd/es/table';
import { workerJobsApi, CreateValidationJobDto, ValidationError, ValidationWarning } from '../../api/worker-jobs';

const { Title, Text } = Typography;
const { Option } = Select;

// Preset sizes
const SIZE_PRESETS = [
  { label: 'A4 (210x297)', width: 210, height: 297 },
  { label: 'A5 (148x210)', width: 148, height: 210 },
  { label: 'B5 (182x257)', width: 182, height: 257 },
  { label: 'B6 (128x182)', width: 128, height: 182 },
  { label: 'Custom', width: 0, height: 0 },
];

// Status colors
const statusColors: Record<string, string> = {
  PENDING: 'default',
  PROCESSING: 'processing',
  COMPLETED: 'success',
  FAILED: 'error',
  FIXABLE: 'warning',
};

// Error code translations
const errorCodeLabels: Record<string, string> = {
  UNSUPPORTED_FORMAT: '지원하지 않는 파일 형식',
  FILE_CORRUPTED: '손상된 파일',
  FILE_TOO_LARGE: '파일 크기 초과',
  PAGE_COUNT_INVALID: '페이지 수 오류',
  PAGE_COUNT_EXCEEDED: '페이지 수 초과',
  SIZE_MISMATCH: '사이즈 불일치',
  SADDLE_STITCH_INVALID: '사철 제본 규격 오류',
  POST_PROCESS_CMYK: '후가공 파일 CMYK 사용',
  SPREAD_SIZE_MISMATCH: '스프레드 사이즈 불일치',
};

// Warning code translations
const warningCodeLabels: Record<string, string> = {
  PAGE_COUNT_MISMATCH: '페이지 수 불일치',
  BLEED_MISSING: '재단 여백 없음',
  RESOLUTION_LOW: '해상도 낮음',
  LANDSCAPE_PAGE: '가로형 페이지',
  CENTER_OBJECT_CHECK: '중앙부 객체 확인',
  CMYK_STRUCTURE_DETECTED: 'CMYK 구조 감지',
  MIXED_PDF: '혼합 PDF',
  TRANSPARENCY_DETECTED: '투명도 감지',
  OVERPRINT_DETECTED: '오버프린트 감지',
};

export const WorkerTestPage = () => {
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [sizePreset, setSizePreset] = useState('A4 (210x297)');

  // Fetch current job details
  const { data: currentJob, refetch: refetchJob, isLoading: isJobLoading } = useQuery({
    queryKey: ['worker-job', currentJobId],
    queryFn: () => currentJobId ? workerJobsApi.getById(currentJobId) : null,
    enabled: !!currentJobId,
    refetchInterval: pollingEnabled ? 1000 : false,
  });

  // Stop polling when job is complete
  useEffect(() => {
    const status = currentJob?.status as string;
    if (status === 'COMPLETED' || status === 'FAILED' || status === 'FIXABLE') {
      setPollingEnabled(false);
    }
  }, [currentJob?.status]);

  // Create validation job mutation
  const createJobMutation = useMutation({
    mutationFn: workerJobsApi.createValidationJob,
    onSuccess: (job) => {
      message.success(`검증 작업이 생성되었습니다 (ID: ${job.id.substring(0, 8)}...)`);
      setCurrentJobId(job.id);
      setPollingEnabled(true);
    },
    onError: (error: any) => {
      message.error(`작업 생성 실패: ${error.response?.data?.message || error.message}`);
    },
  });

  // Handle size preset change
  const handleSizePresetChange = (value: string) => {
    setSizePreset(value);
    const preset = SIZE_PRESETS.find((p) => p.label === value);
    if (preset && preset.width > 0) {
      form.setFieldsValue({
        width: preset.width,
        height: preset.height,
      });
    }
  };

  // Handle form submission
  const handleSubmit = async (values: any) => {
    // Validate file or URL
    if (!values.fileUrl && fileList.length === 0) {
      message.error('PDF 파일 또는 URL을 입력해주세요');
      return;
    }

    let fileUrl = values.fileUrl;

    // 파일이 선택된 경우 먼저 업로드 후 URL 획득
    if (fileList.length > 0 && fileList[0].originFileObj) {
      try {
        const uploadResult = await workerJobsApi.uploadTestFile(fileList[0].originFileObj as File);
        fileUrl = uploadResult.fileUrl;
      } catch (err: any) {
        message.error(`파일 업로드 실패: ${err?.response?.data?.message || err.message}`);
        return;
      }
    }

    const dto: CreateValidationJobDto = {
      fileUrl: fileUrl,
      fileType: values.fileType,
      orderOptions: {
        size: { width: values.width, height: values.height },
        pages: values.pages,
        binding: values.binding,
        bleed: values.bleed,
        paperThickness: values.paperThickness,
      },
    };

    createJobMutation.mutate(dto);
  };

  // Render validation result
  const renderValidationResult = () => {
    if (!currentJob) return null;

    const rawResult = currentJob.result as any;
    if (!rawResult) return null;

    // Worker stores result as { result: { isValid, errors, warnings, metadata } }
    const result = rawResult.result || rawResult;

    const errors: ValidationError[] = result.errors || [];
    const warnings: ValidationWarning[] = result.warnings || [];
    // Check isValid from result, or infer from job status + errors
    const isValid = result.isValid ?? (currentJob.status === 'COMPLETED' && errors.length === 0);
    const metadata = result.metadata || {};

    const errorColumns: ColumnsType<ValidationError> = [
      {
        title: '코드',
        dataIndex: 'code',
        key: 'code',
        render: (code: string) => (
          <Tag color="error">{errorCodeLabels[code] || code}</Tag>
        ),
      },
      {
        title: '메시지',
        dataIndex: 'message',
        key: 'message',
      },
      {
        title: '자동 수정',
        dataIndex: 'autoFixable',
        key: 'autoFixable',
        render: (autoFixable: boolean, record) => (
          autoFixable ? (
            <Tag color="blue">{record.fixMethod || 'Yes'}</Tag>
          ) : (
            <Tag>No</Tag>
          )
        ),
      },
    ];

    const warningColumns: ColumnsType<ValidationWarning> = [
      {
        title: '코드',
        dataIndex: 'code',
        key: 'code',
        render: (code: string) => (
          <Tag color="warning">{warningCodeLabels[code] || code}</Tag>
        ),
      },
      {
        title: '메시지',
        dataIndex: 'message',
        key: 'message',
      },
      {
        title: '자동 수정',
        dataIndex: 'autoFixable',
        key: 'autoFixable',
        render: (autoFixable: boolean, record) => (
          autoFixable ? (
            <Tag color="blue">{record.fixMethod || 'Yes'}</Tag>
          ) : (
            <Tag>No</Tag>
          )
        ),
      },
    ];

    return (
      <div style={{ marginTop: 16 }}>
        <Divider>검증 결과</Divider>

        {/* Result Summary */}
        <Alert
          type={isValid ? 'success' : 'error'}
          message={isValid ? '검증 통과' : '검증 실패'}
          description={`에러: ${errors.length}개, 경고: ${warnings.length}개`}
          showIcon
          style={{ marginBottom: 16 }}
        />

        {/* Metadata */}
        <Card title="PDF 메타데이터" size="small" style={{ marginBottom: 16 }}>
          <Descriptions column={2} size="small">
            <Descriptions.Item label="페이지 수">{metadata.pageCount || '-'}</Descriptions.Item>
            <Descriptions.Item label="페이지 크기">
              {metadata.pageSize ? `${metadata.pageSize.width?.toFixed(1)} x ${metadata.pageSize.height?.toFixed(1)} mm` : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="재단 여백">
              {metadata.hasBleed ? `있음 (${metadata.bleedSize || 0}mm)` : '없음'}
            </Descriptions.Item>
            <Descriptions.Item label="색상 모드">{metadata.colorMode || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        {/* Errors */}
        {errors.length > 0 && (
          <Card
            title={<><CloseCircleOutlined style={{ color: '#ff4d4f' }} /> 에러 ({errors.length})</>}
            size="small"
            style={{ marginBottom: 16 }}
          >
            <Table
              dataSource={errors}
              columns={errorColumns}
              rowKey={(_, idx) => `error-${idx}`}
              pagination={false}
              size="small"
            />
          </Card>
        )}

        {/* Warnings */}
        {warnings.length > 0 && (
          <Card
            title={<><ExclamationCircleOutlined style={{ color: '#faad14' }} /> 경고 ({warnings.length})</>}
            size="small"
          >
            <Table
              dataSource={warnings}
              columns={warningColumns}
              rowKey={(_, idx) => `warning-${idx}`}
              pagination={false}
              size="small"
            />
          </Card>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <Title level={2}>Worker 테스트</Title>
      <Text type="secondary">PDF 검증 기능을 테스트합니다.</Text>

      <Divider />

      <Row gutter={24}>
        {/* Left: Form */}
        <Col span={12}>
          <Card title="검증 테스트 설정">
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              initialValues={{
                fileType: 'content',
                binding: 'perfect',
                width: 210,
                height: 297,
                pages: 4,
                bleed: 3,
                paperThickness: 0.1,
              }}
            >
              {/* File Input */}
              <Form.Item label="PDF 파일">
                <Tabs
                  items={[
                    {
                      key: 'url',
                      label: 'URL 입력',
                      children: (
                        <Form.Item name="fileUrl" noStyle>
                          <Input
                            placeholder="https://example.com/test.pdf 또는 storage/..."
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                      ),
                    },
                    {
                      key: 'upload',
                      label: '파일 업로드',
                      children: (
                        <Upload
                          fileList={fileList}
                          onChange={({ fileList }) => setFileList(fileList)}
                          beforeUpload={() => false}
                          accept=".pdf"
                          maxCount={1}
                        >
                          <Button icon={<UploadOutlined />}>PDF 파일 선택</Button>
                        </Upload>
                      ),
                    },
                  ]}
                />
              </Form.Item>

              {/* File Type */}
              <Form.Item name="fileType" label="파일 타입" rules={[{ required: true }]}>
                <Select>
                  <Option value="content">내지 (Content)</Option>
                  <Option value="cover">표지 (Cover)</Option>
                </Select>
              </Form.Item>

              {/* Size Preset */}
              <Form.Item label="사이즈 프리셋">
                <Select value={sizePreset} onChange={handleSizePresetChange}>
                  {SIZE_PRESETS.map((p) => (
                    <Option key={p.label} value={p.label}>{p.label}</Option>
                  ))}
                </Select>
              </Form.Item>

              {/* Size */}
              <Space>
                <Form.Item name="width" label="너비 (mm)" rules={[{ required: true }]}>
                  <InputNumber min={1} max={1000} />
                </Form.Item>
                <Form.Item name="height" label="높이 (mm)" rules={[{ required: true }]}>
                  <InputNumber min={1} max={1000} />
                </Form.Item>
              </Space>

              {/* Pages */}
              <Form.Item name="pages" label="페이지 수" rules={[{ required: true }]}>
                <InputNumber min={1} max={1000} style={{ width: '100%' }} />
              </Form.Item>

              {/* Binding */}
              <Form.Item name="binding" label="제본 방식" rules={[{ required: true }]}>
                <Select>
                  <Option value="perfect">무선 제본 (Perfect)</Option>
                  <Option value="saddle">사철 제본 (Saddle)</Option>
                  <Option value="spring">스프링 제본 (Spring)</Option>
                </Select>
              </Form.Item>

              {/* Bleed */}
              <Form.Item name="bleed" label="재단 여백 (mm)" rules={[{ required: true }]}>
                <InputNumber min={0} max={10} style={{ width: '100%' }} />
              </Form.Item>

              {/* Paper Thickness */}
              <Form.Item name="paperThickness" label="종이 두께 (mm)">
                <InputNumber min={0.01} max={1} step={0.01} style={{ width: '100%' }} />
              </Form.Item>

              {/* Submit */}
              <Form.Item>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<PlayCircleOutlined />}
                  loading={createJobMutation.isPending}
                  size="large"
                  block
                >
                  검증 시작
                </Button>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* Right: Results */}
        <Col span={12}>
          <Card
            title="검증 결과"
            extra={
              currentJobId && (
                <Button
                  icon={<ReloadOutlined />}
                  onClick={() => refetchJob()}
                  loading={isJobLoading}
                >
                  새로고침
                </Button>
              )
            }
          >
            {!currentJobId ? (
              <Alert
                type="info"
                message="검증을 시작하면 결과가 여기에 표시됩니다."
                showIcon
              />
            ) : isJobLoading && !currentJob ? (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <Spin size="large" />
              </div>
            ) : currentJob ? (
              <div>
                {/* Job Status */}
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Job ID">
                    <Text code copyable>{currentJob.id}</Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="상태">
                    <Tag
                      color={statusColors[currentJob.status]}
                      icon={
                        currentJob.status === 'PROCESSING' ? <LoadingOutlined spin /> :
                        currentJob.status === 'COMPLETED' ? <CheckCircleOutlined /> :
                        currentJob.status === 'FAILED' ? <CloseCircleOutlined /> :
                        undefined
                      }
                    >
                      {currentJob.status}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="입력 파일">
                    <Text ellipsis style={{ maxWidth: 300 }}>
                      {currentJob.inputFileUrl || '-'}
                    </Text>
                  </Descriptions.Item>
                  <Descriptions.Item label="생성 시간">
                    {new Date(currentJob.createdAt).toLocaleString()}
                  </Descriptions.Item>
                  {currentJob.errorMessage && (
                    <Descriptions.Item label="에러 메시지">
                      <Text type="danger">{currentJob.errorMessage}</Text>
                    </Descriptions.Item>
                  )}
                </Descriptions>

                {/* Validation Result */}
                {((currentJob.status as string) === 'COMPLETED' || (currentJob.status as string) === 'FIXABLE') && renderValidationResult()}
              </div>
            ) : null}
          </Card>
        </Col>
      </Row>

      {/* Test Fixtures Info */}
      <Divider />
      <Card title="테스트 픽스처 안내" size="small">
        <Text type="secondary">
          테스트용 PDF 파일 경로 예시 (apps/worker/test/fixtures/pdf/ 기준):
        </Text>
        <ul style={{ marginTop: 8 }}>
          <li><Text code>storage/test/rgb/success-a4-single.pdf</Text> - A4 단면 정상 파일</li>
          <li><Text code>storage/test/saddle-stitch/success-16-pages.pdf</Text> - 사철 16페이지 정상</li>
          <li><Text code>storage/test/saddle-stitch/fail-13-pages.pdf</Text> - 사철 13페이지 (4배수 아님)</li>
          <li><Text code>storage/test/spread/success-a4-spread-10.pdf</Text> - A4 스프레드 10장</li>
          <li><Text code>storage/test/transparency/warn-with-transparency.pdf</Text> - 투명도 포함</li>
        </ul>
        <Alert
          type="warning"
          message="테스트 파일을 storage/test/ 폴더에 복사해야 API에서 접근할 수 있습니다."
          style={{ marginTop: 8 }}
        />
      </Card>
    </div>
  );
};
