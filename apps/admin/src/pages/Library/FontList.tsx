import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Typography,
  Tag,
  Popconfirm,
  message,
  Modal,
  Form,
  Input,
  Switch,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';
import { PlusOutlined, EditOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { LibraryFont } from '@storige/types';
import { libraryApi, CreateFontDto } from '../../api/library';

const { Title } = Typography;

// 파일 확장자에서 폰트 형식 추출
const getFileFormat = (filename: string): string => {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
    return ext;
  }
  return 'ttf';
};

export const FontList = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFont, setEditingFont] = useState<LibraryFont | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);

  const { data: fonts, isLoading } = useQuery({
    queryKey: ['fonts'],
    queryFn: () => libraryApi.getFonts(),
  });

  // 폰트 생성 mutation (파일 업로드 포함)
  const createMutation = useMutation({
    mutationFn: async (data: { name: string; isActive: boolean; file: File }) => {
      // 1. 파일 업로드
      const uploadResult = await libraryApi.uploadFile(data.file);

      // 2. 파일 형식 추출
      const fileFormat = getFileFormat(data.file.name);

      // 3. 폰트 정보 저장
      const font = await libraryApi.createFont({
        name: data.name,
        fileUrl: uploadResult.url,
        fileFormat,
        isActive: data.isActive,
      });

      return font;
    },
    onSuccess: () => {
      message.success('폰트가 추가되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      console.error('Font upload error:', error);
      message.error(error?.response?.data?.message || '폰트 추가에 실패했습니다.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, newFile }: { id: string; data: Partial<CreateFontDto>; newFile?: File }) => {
      let updateData = { ...data };
      // 파일이 새로 선택된 경우 먼저 업로드
      if (newFile) {
        const uploadResult = await libraryApi.uploadFile(newFile);
        const fileFormat = getFileFormat(newFile.name);
        updateData = { ...updateData, fileUrl: uploadResult.url, fileFormat };
      }
      return libraryApi.updateFont(id, updateData);
    },
    onSuccess: () => {
      message.success('폰트가 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.message || '폰트 수정에 실패했습니다.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: libraryApi.deleteFont,
    onSuccess: () => {
      message.success('폰트가 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['fonts'] });
    },
    onError: () => {
      message.error('폰트 삭제에 실패했습니다.');
    },
  });

  const handleOpenModal = (font?: LibraryFont) => {
    setEditingFont(font || null);
    setFileList([]);
    if (font) {
      form.setFieldsValue({
        name: font.name,
        isActive: font.isActive,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ isActive: true });
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingFont(null);
    setFileList([]);
    form.resetFields();
  };

  const handleSubmit = async (values: any) => {
    if (editingFont) {
      // 수정: 이름, 활성상태 + 새 파일 선택 시 파일 교체
      const newFile = fileList.length > 0 ? (fileList[0].originFileObj as File | undefined) : undefined;
      updateMutation.mutate({
        id: editingFont.id,
        data: { name: values.name, isActive: values.isActive },
        newFile,
      });
    } else {
      // 새 폰트 추가 시 파일 필수
      if (fileList.length === 0) {
        message.error('폰트 파일을 선택해주세요.');
        return;
      }

      const file = fileList[0].originFileObj as File;
      if (!file) {
        message.error('폰트 파일을 다시 선택해주세요.');
        return;
      }

      createMutation.mutate({
        name: values.name,
        isActive: values.isActive ?? true,
        file,
      });
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const columns: ColumnsType<LibraryFont> = [
    {
      title: '폰트명',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: '파일 형식',
      dataIndex: 'fileFormat',
      key: 'fileFormat',
      width: 120,
      render: (format: string) => <Tag>{format.toUpperCase()}</Tag>,
    },
    {
      title: '파일 경로',
      dataIndex: 'fileUrl',
      key: 'fileUrl',
      ellipsis: true,
      render: (url: string) => url,
    },
    {
      title: '상태',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean) => (
        <Tag color={isActive ? 'green' : 'default'}>{isActive ? '활성' : '비활성'}</Tag>
      ),
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
    },
    {
      title: '작업',
      key: 'actions',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenModal(record)}>
            수정
          </Button>
          <Popconfirm
            title="폰트를 삭제하시겠습니까?"
            onConfirm={() => handleDelete(record.id)}
            okText="삭제"
            cancelText="취소"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              삭제
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>폰트 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenModal()}>
          폰트 업로드
        </Button>
      </div>

      <Table
        columns={columns}
        dataSource={fonts}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      <Modal
        title={editingFont ? '폰트 수정' : '폰트 업로드'}
        open={isModalOpen}
        onOk={() => form.submit()}
        onCancel={handleCloseModal}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="폰트명"
            rules={[{ required: true, message: '폰트명을 입력해주세요' }]}
          >
            <Input placeholder="예: Noto Sans KR" />
          </Form.Item>

          {!editingFont && (
            <Form.Item
              label="폰트 파일"
              required
              extra="TTF, OTF, WOFF, WOFF2 파일 지원"
            >
              <Upload
                fileList={fileList}
                onChange={({ fileList }) => setFileList(fileList)}
                beforeUpload={() => false}
                maxCount={1}
                accept=".ttf,.otf,.woff,.woff2"
              >
                {fileList.length < 1 && (
                  <Button icon={<UploadOutlined />}>파일 선택</Button>
                )}
              </Upload>
            </Form.Item>
          )}

          {editingFont && (
            <>
              <Form.Item label="현재 파일">
                <Input value={editingFont.fileUrl} disabled />
              </Form.Item>
              <Form.Item
                label="파일 교체 (선택사항)"
                extra="새 파일을 선택하면 기존 파일이 교체됩니다. TTF, OTF, WOFF, WOFF2 지원"
              >
                <Upload
                  fileList={fileList}
                  onChange={({ fileList }) => setFileList(fileList)}
                  beforeUpload={() => false}
                  maxCount={1}
                  accept=".ttf,.otf,.woff,.woff2"
                >
                  {fileList.length < 1 && (
                    <Button icon={<UploadOutlined />}>새 파일 선택</Button>
                  )}
                </Upload>
              </Form.Item>
            </>
          )}

          <Form.Item name="isActive" label="활성 상태" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
