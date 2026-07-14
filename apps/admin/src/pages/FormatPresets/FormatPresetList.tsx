import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Switch,
  Table,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { formatPresetsApi } from '../../api/formatPresets';
import type {
  CreateFormatPresetRequest,
  FormatPreset,
  UpdateFormatPresetRequest,
} from '../../api/formatPresets';
import { formatSizeLabel, workSize } from '../../components/formatPresetHelpers';

const { Title, Text } = Typography;

interface PresetFormValues {
  code: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  sortOrder: number;
}

/**
 * 판형 관리 — format_presets CRUD(삭제 제외) 화면.
 *
 * - 삭제 정책: 하드 삭제 금지(멱등 시드 부활 충돌) — '활성' 소프트 토글만 제공.
 * - 세로형 기준 1행 저장(가로형은 픽커에서 W↔H 스왑 파생) — 여기선 세로형 값만 편집.
 * - '작업' 컬럼은 파생 표시(재단 + 2×도련) — 저장 필드 아님.
 */
export const FormatPresetList = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<PresetFormValues>();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<FormatPreset | null>(null);

  const { data: presets, isLoading } = useQuery({
    queryKey: ['format-presets'],
    queryFn: formatPresetsApi.list,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['format-presets'] });

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingPreset(null);
    form.resetFields();
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateFormatPresetRequest) => formatPresetsApi.create(data),
    onSuccess: () => {
      message.success('판형 프리셋이 추가되었습니다.');
      invalidate();
      closeModal();
    },
    onError: () => {
      message.error('판형 프리셋 추가에 실패했습니다. (코드 중복 여부를 확인하세요)');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateFormatPresetRequest }) =>
      formatPresetsApi.update(id, data),
    onSuccess: () => {
      message.success('판형 프리셋이 수정되었습니다.');
      invalidate();
      closeModal();
    },
    onError: () => {
      message.error('판형 프리셋 수정에 실패했습니다.');
    },
  });

  // 활성 Switch 전용(모달 비경유 — 모달 close 부작용 없이 목록만 갱신)
  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      formatPresetsApi.update(id, { isActive }),
    onSuccess: () => {
      invalidate();
    },
    onError: () => {
      message.error('활성 상태 변경에 실패했습니다.');
    },
  });

  const handleOpenCreate = () => {
    setEditingPreset(null);
    form.setFieldsValue({
      code: '',
      name: '',
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
      sortOrder: 0,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (preset: FormatPreset) => {
    setEditingPreset(preset);
    form.setFieldsValue({
      code: preset.code,
      name: preset.name,
      trimWidthMm: preset.trimWidthMm,
      trimHeightMm: preset.trimHeightMm,
      bleedMm: preset.bleedMm,
      sortOrder: preset.sortOrder,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingPreset) {
        // code 는 시드 멱등성 키(UNIQUE) — 수정 모달에서는 변경 불가(disabled) → 전송 제외.
        updateMutation.mutate({
          id: editingPreset.id,
          data: {
            name: values.name,
            trimWidthMm: values.trimWidthMm,
            trimHeightMm: values.trimHeightMm,
            bleedMm: values.bleedMm,
            sortOrder: values.sortOrder,
          },
        });
      } else {
        createMutation.mutate({
          code: values.code,
          name: values.name,
          trimWidthMm: values.trimWidthMm,
          trimHeightMm: values.trimHeightMm,
          bleedMm: values.bleedMm,
          sortOrder: values.sortOrder,
        });
      }
    } catch {
      // antd validateFields 실패 — 폼 자체가 에러 표시
    }
  };

  const sortedPresets = [...(presets ?? [])].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );

  const columns: ColumnsType<FormatPreset> = [
    {
      title: '이름',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '코드',
      dataIndex: 'code',
      key: 'code',
      render: (code: string) => <Text code>{code}</Text>,
    },
    {
      title: '재단 (mm)',
      key: 'trim',
      render: (_, record) => formatSizeLabel(record.trimWidthMm, record.trimHeightMm),
    },
    {
      title: '작업 (재단+2×도련)',
      key: 'work',
      render: (_, record) => {
        const work = workSize(record.trimWidthMm, record.trimHeightMm, record.bleedMm);
        return (
          <Text type="secondary">{formatSizeLabel(work.widthMm, work.heightMm)}</Text>
        );
      },
    },
    {
      title: '도련 (mm)',
      dataIndex: 'bleedMm',
      key: 'bleedMm',
      width: 100,
    },
    {
      title: '정렬',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 80,
    },
    {
      title: '활성',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean, record) => (
        <Tooltip title="프리셋은 삭제하지 않습니다(시드 부활 충돌) — 사용 중지는 비활성 토글로.">
          <Switch
            checked={isActive}
            checkedChildren="활성"
            unCheckedChildren="비활성"
            loading={toggleMutation.isPending}
            onChange={(checked) => toggleMutation.mutate({ id: record.id, isActive: checked })}
          />
        </Tooltip>
      ),
    },
    {
      title: '작업',
      key: 'actions',
      width: 100,
      render: (_, record) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenEdit(record)}>
          수정
        </Button>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>판형 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreate}>
          판형 추가
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          판형 프리셋은 세로형 기준으로 저장됩니다(가로형은 선택 시 W↔H 스왑). 삭제 대신
          &lsquo;활성&rsquo; 토글로 사용 여부를 관리하세요.
        </Text>
      </div>

      <Table
        columns={columns}
        dataSource={sortedPresets}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      <Modal
        title={editingPreset ? '판형 수정' : '판형 추가'}
        open={isModalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        okText={editingPreset ? '수정' : '추가'}
        cancelText="취소"
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="code"
            label="코드"
            extra="영문 소문자/숫자 식별자(UNIQUE) — 예: a4, baepan46. 생성 후 변경 불가."
            rules={[
              { required: true, message: '코드를 입력해주세요' },
              {
                pattern: /^[a-z0-9_-]+$/,
                message: '영문 소문자·숫자·하이픈·언더스코어만 사용할 수 있습니다',
              },
            ]}
          >
            <Input placeholder="예: a4" disabled={!!editingPreset} maxLength={50} />
          </Form.Item>

          <Form.Item
            name="name"
            label="이름"
            rules={[{ required: true, message: '이름을 입력해주세요' }]}
          >
            <Input placeholder="예: A4" maxLength={100} />
          </Form.Item>

          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="trimWidthMm"
              label="재단 가로 (mm)"
              rules={[{ required: true, message: '재단 가로를 입력해주세요' }]}
            >
              <InputNumber min={1} max={2000} style={{ width: 140 }} />
            </Form.Item>

            <Form.Item
              name="trimHeightMm"
              label="재단 세로 (mm)"
              rules={[{ required: true, message: '재단 세로를 입력해주세요' }]}
            >
              <InputNumber min={1} max={2000} style={{ width: 140 }} />
            </Form.Item>

            <Form.Item
              name="bleedMm"
              label="도련 (mm)"
              rules={[{ required: true, message: '도련을 입력해주세요' }]}
            >
              <InputNumber min={0} max={50} step={0.5} style={{ width: 120 }} />
            </Form.Item>
          </Space>

          <Form.Item
            name="sortOrder"
            label="정렬 순서"
            extra="작을수록 앞에 표시(시드는 10 단위)"
            rules={[{ required: true, message: '정렬 순서를 입력해주세요' }]}
          >
            <InputNumber min={0} max={10000} style={{ width: 140 }} />
          </Form.Item>

          <div style={{ color: '#888', fontSize: 12 }}>
            규격표(재단): A4 210×297 · A5 148×210 · B5 182×257 · 46배판 188×257 · 16절
            190×260 · B6 128×182 · 정사각 210×210
          </div>
        </Form>
      </Modal>
    </div>
  );
};
