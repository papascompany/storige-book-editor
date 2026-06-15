import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Radio,
  Input,
  Switch,
  Button,
  Typography,
  Alert,
  Divider,
  Space,
  message,
  Spin,
} from 'antd';
import { CloudServerOutlined, DatabaseOutlined } from '@ant-design/icons';
import { storageSettingsApi, type UpdateStorageSettingsDto } from '../../api/storageSettings';

const { Title, Text, Paragraph } = Typography;

/**
 * 저장소 설정 — 관리자가 ① 저장 백엔드(로컬|R2) 토글 + R2 키 입력으로 즉시 활성,
 * ② 파일 보존정책 cron on/off·관찰모드 관리.
 */
export default function StorageSettings() {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['storage-settings'],
    queryFn: () => storageSettingsApi.get(),
  });

  useEffect(() => {
    if (data) {
      form.setFieldsValue({
        driver: data.driver,
        s3Endpoint: data.s3Endpoint,
        s3Region: data.s3Region,
        s3Bucket: data.s3Bucket,
        s3AccessKeyId: data.s3AccessKeyId,
        s3SecretAccessKey: '', // 시크릿은 비워둠(입력 시에만 갱신)
        s3ForcePathStyle: data.s3ForcePathStyle,
        retentionEnabled: data.retentionEnabled,
        retentionDryRun: data.retentionDryRun,
      });
    }
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (dto: UpdateStorageSettingsDto) => storageSettingsApi.update(dto),
    onSuccess: () => {
      message.success('저장소 설정 저장 완료 — 즉시 반영됩니다.');
      queryClient.invalidateQueries({ queryKey: ['storage-settings'] });
    },
    onError: (e: any) => message.error(e?.response?.data?.message ?? '저장 실패'),
  });

  const driver = Form.useWatch('driver', form);

  const onFinish = (values: any) => {
    const dto: UpdateStorageSettingsDto = {
      driver: values.driver,
      s3Endpoint: values.s3Endpoint,
      s3Region: values.s3Region,
      s3Bucket: values.s3Bucket,
      s3AccessKeyId: values.s3AccessKeyId,
      s3ForcePathStyle: values.s3ForcePathStyle,
      retentionEnabled: values.retentionEnabled,
      retentionDryRun: values.retentionDryRun,
    };
    // 시크릿은 입력했을 때만 전송(빈 값이면 기존 유지)
    if (values.s3SecretAccessKey && values.s3SecretAccessKey.trim()) {
      dto.s3SecretAccessKey = values.s3SecretAccessKey.trim();
    }
    saveMutation.mutate(dto);
  };

  if (isLoading) return <Spin style={{ marginTop: 80 }} />;

  return (
    <div style={{ maxWidth: 760 }}>
      <Title level={3}>
        <CloudServerOutlined /> 저장소 설정
      </Title>
      <Paragraph type="secondary">
        업로드 파일(인쇄 PDF 등)의 저장 위치와 보존정책을 관리합니다. 변경 사항은 재배포 없이 즉시 반영됩니다.
      </Paragraph>

      <Form form={form} layout="vertical" onFinish={onFinish}>
        {/* ── 저장 백엔드 ── */}
        <Card
          title={<><DatabaseOutlined /> 파일 저장 위치</>}
          style={{ marginBottom: 24 }}
        >
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="이 설정은 fileId 기반 업로드/다운로드(외부 연동 PDF)에만 적용됩니다."
            description="라이브러리·썸네일 등 nginx 직접서빙 자산은 항상 로컬에 유지됩니다."
          />
          <Form.Item name="driver" label="저장 백엔드" initialValue="local">
            <Radio.Group>
              <Radio.Button value="local">로컬 디스크 (VPS)</Radio.Button>
              <Radio.Button value="s3">객체스토리지 (R2 / S3)</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {driver === 's3' && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                message="R2 사용 전 체크"
                description="Cloudflare R2 버킷을 만들고 API 토큰(Access Key/Secret)을 발급한 뒤 아래에 입력하세요. 저장하면 즉시 새 업로드가 R2로 저장됩니다. (기존 로컬 파일은 그대로 읽힙니다)"
              />
              <Form.Item
                name="s3Endpoint"
                label="엔드포인트 (R2)"
                tooltip="예: https://<account_id>.r2.cloudflarestorage.com (AWS S3면 비움)"
              >
                <Input placeholder="https://<account_id>.r2.cloudflarestorage.com" />
              </Form.Item>
              <Form.Item name="s3Region" label="리전" initialValue="auto">
                <Input placeholder="auto (R2) / ap-northeast-2 (AWS)" />
              </Form.Item>
              <Form.Item name="s3Bucket" label="버킷명" rules={[{ required: driver === 's3', message: '버킷명을 입력하세요' }]}>
                <Input placeholder="storige-files" />
              </Form.Item>
              <Form.Item name="s3AccessKeyId" label="Access Key ID">
                <Input placeholder="R2 Access Key ID" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="s3SecretAccessKey"
                label="Secret Access Key"
                tooltip="보안상 저장된 값은 표시되지 않습니다. 비워두면 기존 값을 유지하고, 변경 시에만 입력하세요."
                extra={data?.s3SecretConfigured ? '✅ 시크릿이 이미 설정되어 있습니다 (변경 시에만 입력).' : '⚠️ 아직 시크릿이 없습니다.'}
              >
                <Input.Password placeholder={data?.s3SecretConfigured ? '••••••••  (변경 시에만 입력)' : 'R2 Secret Access Key'} autoComplete="new-password" />
              </Form.Item>
              <Form.Item name="s3ForcePathStyle" label="Path-style 강제" valuePropName="checked" initialValue={true} tooltip="R2/MinIO는 보통 true">
                <Switch />
              </Form.Item>
            </>
          )}
        </Card>

        {/* ── 보존정책 ── */}
        <Card title="파일 보존정책" style={{ marginBottom: 24 }}>
          <Paragraph type="secondary">
            보존 기간이 지난 파일을 자동 삭제해 저장 용량을 관리합니다. 인쇄 PDF는 편집 원본에서 다시 생성할 수 있어 안전합니다.
            <br />
            <Text strong>※ 사이트별 보존 기간(일)은 [사이트 관리]의 각 사이트 설정에서 지정합니다.</Text> 여기서는 자동 삭제 작업의 전체 on/off만 제어합니다.
          </Paragraph>
          <Form.Item
            name="retentionEnabled"
            label="자동 삭제 작업 활성화"
            valuePropName="checked"
            initialValue={true}
            tooltip="끄면 보존 기간이 지나도 자동 삭제하지 않습니다(수동 삭제만)."
          >
            <Switch checkedChildren="켜짐" unCheckedChildren="꺼짐" />
          </Form.Item>
          <Form.Item
            name="retentionDryRun"
            label="관찰 모드 (실제 삭제 안 함)"
            valuePropName="checked"
            initialValue={false}
            tooltip="켜면 삭제 대상만 로그로 남기고 실제로는 지우지 않습니다. 처음 도입 시 안전 확인용."
          >
            <Switch checkedChildren="관찰만" unCheckedChildren="실삭제" />
          </Form.Item>
        </Card>

        <Space>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            저장 (즉시 반영)
          </Button>
          {data?.updatedAt && (
            <Text type="secondary">최종 변경: {new Date(data.updatedAt).toLocaleString('ko-KR')}</Text>
          )}
        </Space>
      </Form>

      <Divider />
      <Text type="secondary" style={{ fontSize: 12 }}>
        상세 운영 절차: <code>docs/STORAGE_R2_RUNBOOK.md</code>
      </Text>
    </div>
  );
}
