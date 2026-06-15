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
import { LibraryClipart, LibraryCategory } from '@storige/types';
import { libraryApi } from '../../api/library';
import { resolveStorageUrl } from '../../lib/axios';

const { Title } = Typography;

export const ClipartList = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingClipart, setEditingClipart] = useState<LibraryClipart | null>(null);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(undefined);

  // Fetch all cliparts (no filter) to compute unique category list
  const { data: allCliparts } = useQuery({
    queryKey: ['cliparts-all'],
    queryFn: () => libraryApi.getCliparts(),
  });

  // Derive unique categories from all cliparts
  const categoryOptions = Array.from(
    new Set((allCliparts || []).map((c) => c.category).filter(Boolean))
  ).map((cat) => ({ label: cat as string, value: cat as string }));

  // Fetch cliparts with optional category filter
  const { data: cliparts, isLoading } = useQuery({
    queryKey: ['cliparts', selectedCategory],
    queryFn: () => libraryApi.getCliparts(selectedCategory),
  });

  // Fetch library categories (type='clipart') for the FK Select.
  // categoryId 가 큐레이션 정본 — 자유텍스트 category 는 하위호환용 보조 필드로만 유지.
  const { data: libraryCategories } = useQuery({
    queryKey: ['library-categories', 'clipart'],
    queryFn: () => libraryApi.getCategories('clipart'),
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<LibraryClipart> }) =>
      libraryApi.updateClipart(id, data),
    onSuccess: () => {
      message.success('클립아트가 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['cliparts'] });
      setIsEditModalOpen(false);
      setEditingClipart(null);
      editForm.resetFields();
    },
    onError: () => {
      message.error('클립아트 수정에 실패했습니다.');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: libraryApi.deleteClipart,
    onSuccess: () => {
      message.success('클립아트가 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['cliparts'] });
    },
    onError: () => {
      message.error('클립아트 삭제에 실패했습니다.');
    },
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: async (data: { name: string; category?: string; categoryId?: string; tags?: string; file: File }) => {
      // 1. 파일 업로드
      const uploadResult = await libraryApi.uploadFile(data.file);

      // 2. 태그 파싱
      const tags = data.tags ? data.tags.split(',').map((t: string) => t.trim()) : [];

      // 3. 클립아트 정보 저장 (categoryId = 큐레이션 FK 정본, category = 하위호환 자유텍스트)
      const clipart = await libraryApi.createClipart({
        name: data.name,
        category: data.category || undefined,
        categoryId: data.categoryId || undefined,
        fileUrl: uploadResult.url,
        thumbnailUrl: uploadResult.url,
        tags,
        isActive: true,
      });

      return clipart;
    },
    onSuccess: () => {
      message.success('클립아트가 업로드되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['cliparts'] });
      handleCloseModal();
    },
    onError: (error: any) => {
      console.error('Clipart upload error:', error);
      message.error(error?.response?.data?.message || '클립아트 업로드에 실패했습니다.');
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

  const handleOpenEditModal = (clipart: LibraryClipart) => {
    setEditingClipart(clipart);
    editForm.setFieldsValue({
      name: clipart.name,
      category: clipart.category || '',
      categoryId: clipart.categoryId || undefined,
      tags: clipart.tags?.join(', ') || '',
      isActive: clipart.isActive ?? true,
    });
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = (values: any) => {
    if (!editingClipart) return;
    const tags = values.tags ? values.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : [];
    updateMutation.mutate({
      id: editingClipart.id,
      data: { name: values.name, category: values.category || undefined, categoryId: values.categoryId || undefined, tags, isActive: values.isActive },
    });
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
      categoryId: values.categoryId,
      tags: values.tags,
      file,
    });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const columns: ColumnsType<LibraryClipart> = [
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
      key: 'category',
      render: (_, record) => {
        const fkName = libraryCategories?.find((c: LibraryCategory) => c.id === record.categoryId)?.name;
        return fkName || record.category || '-';
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
            title="클립아트를 삭제하시겠습니까?"
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
        <Title level={2}>클립아트 관리</Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleOpenModal}
        >
          클립아트 업로드
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
        dataSource={cliparts || []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      <Modal
        title="클립아트 업로드"
        open={isModalOpen}
        onOk={() => form.submit()}
        onCancel={handleCloseModal}
        confirmLoading={uploadMutation.isPending}
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="name"
            label="클립아트 이름"
            rules={[{ required: true, message: '클립아트 이름을 입력해주세요' }]}
          >
            <Input placeholder="예: 하트 아이콘" />
          </Form.Item>

          <Form.Item name="categoryId" label="카테고리" extra="큐레이션 분류용 (정본)">
            <Select
              placeholder="카테고리 선택"
              allowClear
              options={libraryCategories?.map((c: LibraryCategory) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item name="category" label="카테고리(텍스트)" extra="레거시 자유 분류 — 선택 입력">
            <Input placeholder="예: 아이콘" />
          </Form.Item>

          <Form.Item name="tags" label="태그" extra="쉼표로 구분">
            <Input placeholder="예: 하트, 사랑, 로맨스" />
          </Form.Item>

          <Form.Item
            label="파일"
            rules={[{ required: true, message: '파일을 선택해주세요' }]}
            extra="SVG, PNG 파일 권장"
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
        title="클립아트 수정"
        open={isEditModalOpen}
        onOk={() => editForm.submit()}
        onCancel={() => { setIsEditModalOpen(false); setEditingClipart(null); editForm.resetFields(); }}
        confirmLoading={updateMutation.isPending}
      >
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item name="name" label="클립아트 이름" rules={[{ required: true, message: '이름을 입력해주세요' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="categoryId" label="카테고리" extra="큐레이션 분류용 (정본)">
            <Select
              placeholder="카테고리 선택"
              allowClear
              options={libraryCategories?.map((c: LibraryCategory) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>
          <Form.Item name="category" label="카테고리(텍스트)" extra="레거시 자유 분류 — 선택 입력">
            <Input placeholder="예: 아이콘" />
          </Form.Item>
          <Form.Item name="tags" label="태그" extra="쉼표로 구분">
            <Input placeholder="예: 하트, 사랑" />
          </Form.Item>
          <Form.Item name="isActive" label="활성 상태" valuePropName="checked">
            <Switch checkedChildren="활성" unCheckedChildren="비활성" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
