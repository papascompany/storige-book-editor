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
  LoadingOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload/interface';
import { workerJobsApi, CreateValidationJobDto } from '../../api/worker-jobs';
import { PdfBeforeAfterPreview } from '../../components/PdfBeforeAfterPreview';
import { ValidationResultView } from '../../components/ValidationResultView';
import { extractValidationResult } from '../../components/validationResultHelpers';

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
    let fileId: string | undefined;

    // 파일이 선택된 경우 먼저 업로드 후 fileId 획득
    if (fileList.length > 0 && fileList[0].originFileObj) {
      try {
        // fileType을 API에 전달해야 400 오류를 방지할 수 있음
        const uploadResult = await workerJobsApi.uploadTestFile(
          fileList[0].originFileObj as File,
          values.fileType as 'cover' | 'content',
        );
        // fileId 우선 사용 — API가 자동으로 filePath(선행슬래시 없는 경로)로 해결
        // 워커가 /storage/... 절대경로를 ENOENT로 실패하는 것을 방지
        fileId = uploadResult.fileId;
        fileUrl = uploadResult.fileUrl; // fallback용 보존
      } catch (err: any) {
        message.error(`파일 업로드 실패: ${err?.response?.data?.message || err.message}`);
        return;
      }
    }

    const dto: CreateValidationJobDto = {
      // fileId가 있으면 fileId를 우선 사용, 없으면 사용자가 입력한 fileUrl 사용
      ...(fileId ? { fileId } : { fileUrl }),
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

    // Worker stores result as { result: { isValid, errors, warnings, metadata } }
    const view = extractValidationResult(currentJob.result, String(currentJob.status));
    if (!view) return null;

    return (
      <div style={{ marginTop: 16 }}>
        <Divider>검증 결과</Divider>

        <ValidationResultView result={view} />

        {/* Before/After 자동 수정 미리보기 — FIXABLE 상태에서만 표시 */}
        {(currentJob.status as string) === 'FIXABLE' && currentJob.inputFileUrl && (
          <PdfBeforeAfterPreview
            originalFileUrl={currentJob.inputFileUrl}
            metadata={view.metadata}
            errors={view.errors}
            orderOptions={{
              pages: form.getFieldValue('pages') || 4,
              bleed: form.getFieldValue('bleed') || 3,
            }}
          />
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
