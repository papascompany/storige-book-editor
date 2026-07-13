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
  Tag,
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
import { LibraryShape, LibraryCategory } from '@storige/types';
import { libraryApi } from '../../api/library';
import { resolveStorageUrl } from '../../lib/axios';

const { Title } = Typography;

export const ShapeList = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingShape, setEditingShape] = useState<LibraryShape | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | undefined>(undefined);

  // Fetch shapes
  const { data: shapes, isLoading } = useQuery({
    queryKey: ['shapes', selectedCategoryId],
    queryFn: () => libraryApi.getShapes(selectedCategoryId),
  });

  // Fetch categories for filter and form
  const { data: categories } = useQuery({
    queryKey: ['library-categories', 'shape'],
    queryFn: () => libraryApi.getCategories('shape'),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LibraryShape> }) =>
      libraryApi.updateShape(id, data),
    onSuccess: () => {
      message.success('도형이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['shapes'] });
      setIsEditModalOpen(false);
      setEditingShape(null);
      editForm.resetFields();
    },
    onError: () => {
      message.error('도형 수정에 실패했습니다.');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: libraryApi.deleteShape,
    onSuccess: () => {
      message.success('도형이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['shapes'] });
    },
    onError: () => {
      message.error('도형 삭제에 실패했습니다.');
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: libraryApi.createShape,
    onSuccess: () => {
      message.success('도형이 추가되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['shapes'] });
      handleCloseModal();
    },
    onError: () => {
      message.error('도형 추가에 실패했습니다.');
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

  const handleOpenEditModal = (shape: LibraryShape) => {
    setEditingShape(shape);
    editForm.setFieldsValue({
      name: shape.name,
      categoryId: shape.categoryId || undefined,
      tags: (shape.tags || []).join(', '),
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = (values: any) => {
    if (!editingShape) return;
    const tags = values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    updateMutation.mutate({ id: editingShape.id, data: { name: values.name, categoryId: values.categoryId || undefined, tags } });
  };

  const handleSubmit = async (values: any) => {
    try {
      let fileUrl = '';

      // Upload file if selected
      if (fileList.length > 0 && fileList[0].originFileObj) {
        const uploadResult = await libraryApi.uploadFile(fileList[0].originFileObj as File);
        fileUrl = uploadResult.url;
      }

      const tags = values.tags ? values.tags.split(',').map((t: string) => t.trim()) : [];

      createMutation.mutate({
        name: values.name,
        fileUrl,
        categoryId: values.categoryId,
        tags,
      });
    } catch (_error) {
      message.error('파일 업로드에 실패했습니다.');
    }
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const columns: ColumnsType<LibraryShape> = [
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
          style={{ objectFit: 'contain' }}
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
      dataIndex: 'categoryId',
      key: 'categoryId',
      render: (categoryId: string | null) => {
        const category = categories?.find((c: LibraryCategory) => c.id === categoryId);
        return category?.name || '-';
      },
    },
    {
      title: '태그',
      dataIndex: 'tags',
      key: 'tags',
      render: (tags: string[]) => (
        <>
          {tags && tags.map((tag) => (
            <Tag key={tag}>{tag}</Tag>
          ))}
        </>
      ),
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
            title="도형을 삭제하시겠습니까?"
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
        <Title level={2}>도형 관리</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleOpenModal}
        >
          도형 추가
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Select
          placeholder="카테고리 필터"
          allowClear
          style={{ width: 200 }}
          value={selectedCategoryId}
          onChange={setSelectedCategoryId}
          options={categories?.map((c: LibraryCategory) => ({ label: c.name, value: c.id }))}
        />
      </div>

      <Table
        columns={columns}
        dataSource={shapes || []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      <Modal
        title="도형 추가"
        open={isModalOpen}
        onOk={() => form.submit()}
        onCancel={handleCloseModal}
        confirmLoading={createMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="도형 이름"
            rules={[{ required: true, message: '도형 이름을 입력해주세요' }]}
          >
            <Input placeholder="예: 원형" />
          </Form.Item>

          <Form.Item name="categoryId" label="카테고리">
            <Select
              placeholder="카테고리 선택"
              allowClear
              options={categories?.map((c: LibraryCategory) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item name="tags" label="태그" extra="쉼표로 구분">
            <Input placeholder="예: 원, 기본도형" />
          </Form.Item>

          <Form.Item
            label="파일"
            extra="SVG 파일 권장"
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
        title="도형 수정"
        open={isEditModalOpen}
        onOk={() => editForm.submit()}
        onCancel={() => { setIsEditModalOpen(false); setEditingShape(null); editForm.resetFields(); }}
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item name="name" label="도형 이름" rules={[{ required: true, message: '이름을 입력해주세요' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="categoryId" label="카테고리">
            <Select
              placeholder="카테고리 선택"
              allowClear
              options={categories?.map((c: LibraryCategory) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item name="tags" label="태그" extra="쉼표로 구분">
            <Input placeholder="예: 원, 기본도형" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
