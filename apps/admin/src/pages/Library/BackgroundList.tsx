import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Typography,
  Upload,
  message,
  Modal,
  Form,
  Input,
  Popconfirm,
  Image,
  Switch,
  Select,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd/es/upload';
import {
  PlusOutlined,
  DeleteOutlined,
  UploadOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { LibraryBackground } from '@storige/types';
import { libraryApi } from '../../api/library';
import { resolveStorageUrl } from '../../lib/axios';

const { Title } = Typography;

export const BackgroundList = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingBackground, setEditingBackground] = useState<LibraryBackground | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  // Fetch all backgrounds (no filter) to compute unique category list
  const { data: allBackgrounds } = useQuery({
    queryKey: ['backgrounds-all'],
    queryFn: () => libraryApi.getBackgrounds(),
  });

  // Derive unique categories from all backgrounds
  const categoryOptions = Array.from(
    new Set((allBackgrounds || []).map((b) => b.category).filter(Boolean))
  ).map((cat) => ({ label: cat as string, value: cat as string }));

  // Fetch backgrounds with optional category filter
  const { data: backgrounds, isLoading } = useQuery({
    queryKey: ['backgrounds', selectedCategory],
    queryFn: () => libraryApi.getBackgrounds(selectedCategory),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LibraryBackground> }) =>
      libraryApi.updateBackground(id, data),
    onSuccess: () => {
      message.success('배경이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['backgrounds'] });
      setIsEditModalOpen(false);
      setEditingBackground(null);
      editForm.resetFields();
    },
    onError: () => {
      message.error('배경 수정에 실패했습니다.');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: libraryApi.deleteBackground,
    onSuccess: () => {
      message.success('배경이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['backgrounds'] });
    },
    onError: () => {
      message.error('배경 삭제에 실패했습니다.');
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: { name: string; category?: string; file: File }) => {
      // 1. 파일 업로드
      const uploadResult = await libraryApi.uploadFile(data.file);

      // 2. 배경 정보 저장
      const background = await libraryApi.createBackground({
        name: data.name,
        category: data.category || undefined,
        fileUrl: uploadResult.url,
        thumbnailUrl: uploadResult.url, // 썸네일도 동일한 URL 사용
        isActive: true,
      });

      return background;
    },
    onSuccess: () => {
      message.success('배경이 업로드되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['backgrounds'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      console.error('Background upload error:', error);
      message.error(error?.response?.data?.message || '배경 업로드에 실패했습니다.');
    },
  });

  const handleOpenModal = () => {
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    form.resetFields();
    setFileList([]);
  };

  const handleOpenEditModal = (bg: LibraryBackground) => {
    setEditingBackground(bg);
    editForm.setFieldsValue({ name: bg.name, category: bg.category || '', isActive: bg.isActive ?? true });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = (values: any) => {
    if (!editingBackground) return;
    updateMutation.mutate({ id: editingBackground.id, data: { name: values.name, category: values.category || undefined, isActive: values.isActive } });
  };

  const handleSubmit = async (values: any) => {
    if (fileList.length === 0) {
      message.error('파일을 선택해주세요.');
      return;
    }

    const file = fileList[0].originFileObj as File;
    if (!file) {
      message.error('파일을 다시 선택해주세요.');
      return;
    }

    uploadMutation.mutate({
      name: values.name,
      category: values.category,
      file,
    });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const columns: ColumnsType<LibraryBackground> = [
    {
      title: '미리보기',
      dataIndex: 'thumbnailUrl',
      key: 'thumbnailUrl',
      width: 100,
      render: (url: string, record) => (
        <Image
          src={resolveStorageUrl(url || record.fileUrl)}
          alt={record.name}
          width={60}
          height={60}
          style={{ objectFit: 'cover' }}
        />
      ),
    },
    {
      title: '이름',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: '카테고리',
      dataIndex: 'category',
      key: 'category',
      render: (category: string | null) => category || '-',
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '작업',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button type="link" icon={<EditOutlined />} onClick={() => handleOpenEditModal(record)}>
            수정
          </Button>
          <Popconfirm
            title="배경을 삭제하시겠습니까?"
            onConfirm={() => handleDelete(record.id)}
            okText="삭제"
            cancelText="취소"
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            >
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
        <Title level={2}>배경 관리</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleOpenModal}
        >
          배경 업로드
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Select
          placeholder="카테고리 필터"
          allowClear
          style={{ width: 200 }}
          value={selectedCategory}
          onChange={setSelectedCategory}
          options={categoryOptions}
        />
      </div>

      <Table
        columns={columns}
        dataSource={backgrounds || []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      <Modal
        title="배경 업로드"
        open={isModalOpen}
        onOk={() => form.submit()}
        onCancel={handleCloseModal}
        confirmLoading={uploadMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="배경 이름"
            rules={[{ required: true, message: '배경 이름을 입력해주세요' }]}
          >
            <Input placeholder="예: 파스텔 배경" />
          </Form.Item>

          <Form.Item name="category" label="카테고리">
            <Input placeholder="예: 파스텔" />
          </Form.Item>

          <Form.Item
            label="파일"
            rules={[{ required: true, message: '파일을 선택해주세요' }]}
          >
            <Upload
              listType="picture-card"
              fileList={fileList}
              onChange={({ fileList }) => setFileList(fileList)}
              beforeUpload={() => false}
              maxCount={1}
            >
              {fileList.length < 1 && (
                <div>
                  <UploadOutlined />
                  <div style={{ marginTop: 8 }}>Upload</div>
                </div>
              )}
            </Upload>
          </Form.Item>
        </Form>
      </Modal>

      {/* 수정 모달 */}
      <Modal
        title="배경 수정"
        open={isEditModalOpen}
        onOk={() => editForm.submit()}
        onCancel={() => { setIsEditModalOpen(false); setEditingBackground(null); editForm.resetFields(); }}
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item
            name="name"
            label="배경 이름"
            rules={[{ required: true, message: '배경 이름을 입력해주세요' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="category" label="카테고리">
            <Input placeholder="예: 파스텔" />
          </Form.Item>
          <Form.Item name="isActive" label="활성 상태" valuePropName="checked">
            <Switch checkedChildren="활성" unCheckedChildren="비활성" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
