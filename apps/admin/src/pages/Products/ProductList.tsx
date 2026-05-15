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
  Input,
  Select,
  Switch,
  Modal,
  Form,
  InputNumber,
  Empty,
  List,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  LinkOutlined,
  DisconnectOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { TemplateSetType, Category } from '@storige/types';
import { productsApi, Product, CreateProductDto, UpdateProductDto, getProductDisplayName } from '../../api/products';
import { templateSetsApi } from '../../api/template-sets';
import { categoriesApi } from '../../api/categories';
import { resolveStorageUrl } from '../../lib/axios';

const { Title, Text } = Typography;

const templateSetTypeLabels: Record<TemplateSetType, string> = {
  [TemplateSetType.BOOK]: '책자',
  [TemplateSetType.LEAFLET]: '리플렛',
};

export const ProductList = () => {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();
  const [hasTemplateSetFilter, setHasTemplateSetFilter] = useState<boolean | undefined>();

  // Modal states
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [templateSetModalOpen, setTemplateSetModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [linkingProduct, setLinkingProduct] = useState<Product | null>(null);

  const [form] = Form.useForm();

  // Fetch products
  const { data: products, isLoading } = useQuery({
    queryKey: ['products', selectedCategory, hasTemplateSetFilter],
    queryFn: () =>
      productsApi.getAll({
        categoryId: selectedCategory,
        hasTemplateSet: hasTemplateSetFilter,
      }),
  });

  // Fetch categories
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.getTree(),
  });

  // Fetch template sets for linking
  const { data: templateSets } = useQuery({
    queryKey: ['template-sets'],
    queryFn: () => templateSetsApi.getAll({}),
    enabled: templateSetModalOpen,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: productsApi.create,
    onSuccess: () => {
      message.success('상품이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setFormModalOpen(false);
      form.resetFields();
    },
    onError: () => {
      message.error('상품 생성에 실패했습니다.');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateProductDto }) =>
      productsApi.update(id, data),
    onSuccess: () => {
      message.success('상품이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setFormModalOpen(false);
      setEditingProduct(null);
      form.resetFields();
    },
    onError: () => {
      message.error('상품 수정에 실패했습니다.');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: productsApi.delete,
    onSuccess: () => {
      message.success('상품이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      message.error('상품 삭제에 실패했습니다.');
    },
  });

  // Link template set mutation
  const linkMutation = useMutation({
    mutationFn: ({ id, templateSetId }: { id: string; templateSetId: string }) =>
      productsApi.linkTemplateSet(id, templateSetId),
    onSuccess: () => {
      message.success('템플릿셋이 연결되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setTemplateSetModalOpen(false);
      setLinkingProduct(null);
    },
    onError: () => {
      message.error('템플릿셋 연결에 실패했습니다.');
    },
  });

  // Unlink template set mutation
  const unlinkMutation = useMutation({
    mutationFn: productsApi.unlinkTemplateSet,
    onSuccess: () => {
      message.success('템플릿셋 연결이 해제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      message.error('템플릿셋 연결 해제에 실패했습니다.');
    },
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      productsApi.update(id, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
      message.error('상태 변경에 실패했습니다.');
    },
  });

  const handleCreate = () => {
    setEditingProduct(null);
    form.resetFields();
    setFormModalOpen(true);
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.setFieldsValue({
      // legacy Storige 상품은 name 이 NULL — title 로 fallback
      name: getProductDisplayName(product),
      code: product.code ?? '',
      categoryId: product.categoryId,
      price: product.price,
      isActive: product.isActive,
      allowCustomSize: product.allowCustomSize ?? false,
    });
    setFormModalOpen(true);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleLinkTemplateSet = (product: Product) => {
    setLinkingProduct(product);
    setTemplateSetModalOpen(true);
  };

  const handleUnlinkTemplateSet = (id: string) => {
    unlinkMutation.mutate(id);
  };

  const handleSelectTemplateSet = (templateSetId: string) => {
    if (linkingProduct) {
      linkMutation.mutate({ id: linkingProduct.id, templateSetId });
    }
  };

  const handleSubmitForm = (values: CreateProductDto) => {
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data: values });
    } else {
      createMutation.mutate(values);
    }
  };

  const getCategoryName = (categoryId: string) => {
    const category = categories?.find((c: Category) => c.id === categoryId);
    return category?.name || categoryId;
  };

  const columns: ColumnsType<Product> = [
    {
      title: '상품코드',
      dataIndex: 'code',
      key: 'code',
      width: 120,
      render: (code: string | null | undefined) =>
        code ? <Text code>{code}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '상품명',
      dataIndex: 'name',
      key: 'name',
      // legacy 상품(name=NULL)도 title 로 fallback 표시
      render: (_: unknown, record: Product) => getProductDisplayName(record) || <Text type="secondary">—</Text>,
      sorter: (a, b) => getProductDisplayName(a).localeCompare(getProductDisplayName(b)),
    },
    {
      title: '카테고리',
      dataIndex: 'categoryId',
      key: 'categoryId',
      width: 150,
      render: (categoryId: string) => getCategoryName(categoryId),
    },
    {
      title: '가격',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      // legacy 상품은 price 가 NULL — 안전 표시
      render: (price: number | null | undefined) =>
        typeof price === 'number' ? `${price.toLocaleString()}원` : <Text type="secondary">—</Text>,
      sorter: (a, b) => (a.price ?? 0) - (b.price ?? 0),
    },
    {
      title: '템플릿셋',
      key: 'templateSet',
      width: 200,
      render: (_, record) =>
        record.templateSet ? (
          <Space>
            <Tag color="blue">{record.templateSet.name}</Tag>
            <Tag>{templateSetTypeLabels[record.templateSet.type as TemplateSetType]}</Tag>
          </Space>
        ) : (
          <Text type="secondary">미연결</Text>
        ),
    },
    {
      title: '활성',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (isActive: boolean, record) => (
        <Switch
          checked={isActive}
          size="small"
          onChange={(checked) =>
            toggleActiveMutation.mutate({ id: record.id, isActive: checked })
          }
        />
      ),
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
      sorter: (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '작업',
      key: 'actions',
      width: 280,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
          >
            편집
          </Button>
          {record.templateSetId ? (
            <Popconfirm
              title="템플릿셋 연결을 해제하시겠습니까?"
              onConfirm={() => handleUnlinkTemplateSet(record.id)}
              okText="해제"
              cancelText="취소"
            >
              <Button
                type="link"
                icon={<DisconnectOutlined />}
                danger
              >
                연결해제
              </Button>
            </Popconfirm>
          ) : (
            <Button
              type="link"
              icon={<LinkOutlined />}
              onClick={() => handleLinkTemplateSet(record)}
            >
              연결
            </Button>
          )}
          <Popconfirm
            title="상품을 삭제하시겠습니까?"
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

  // Filter by search — name/title/code 모두 nullable 이므로 안전 접근.
  // legacy Storige 상품(name=NULL, code=NULL)이 섞여 있어 unsafe 접근 시 toLowerCase 폭발.
  const filteredProducts = products?.filter((product) => {
    const term = searchText.toLowerCase();
    if (!term) return true;
    const name = getProductDisplayName(product).toLowerCase();
    const code = (product.code ?? '').toLowerCase();
    return name.includes(term) || code.includes(term);
  });

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>상품 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          상품 추가
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="상품명 / 코드 검색"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250 }}
        />
        <Select
          placeholder="카테고리"
          style={{ width: 150 }}
          value={selectedCategory}
          onChange={setSelectedCategory}
          allowClear
          options={categories?.map((c: Category) => ({ label: c.name, value: c.id }))}
        />
        <Select
          placeholder="템플릿셋"
          style={{ width: 150 }}
          value={hasTemplateSetFilter}
          onChange={setHasTemplateSetFilter}
          allowClear
          options={[
            { label: '연결됨', value: true },
            { label: '미연결', value: false },
          ]}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={filteredProducts}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      {/* Product Form Modal */}
      <Modal
        title={editingProduct ? '상품 수정' : '상품 추가'}
        open={formModalOpen}
        onCancel={() => {
          setFormModalOpen(false);
          setEditingProduct(null);
          form.resetFields();
        }}
        footer={null}
        width={500}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmitForm}
          initialValues={{ isActive: true }}
        >
          <Form.Item
            name="name"
            label="상품명"
            rules={[{ required: true, message: '상품명을 입력하세요' }]}
          >
            <Input placeholder="예: A4 책자 20p" />
          </Form.Item>

          <Form.Item
            name="code"
            label="상품코드"
            rules={[{ required: true, message: '상품코드를 입력하세요' }]}
          >
            <Input placeholder="예: BOOK-A4-20P" />
          </Form.Item>

          <Form.Item
            name="categoryId"
            label="카테고리"
            rules={[{ required: true, message: '카테고리를 선택하세요' }]}
          >
            <Select
              placeholder="카테고리 선택"
              options={categories?.map((c: Category) => ({ label: c.name, value: c.id }))}
            />
          </Form.Item>

          <Form.Item
            name="price"
            label="가격 (원)"
            rules={[{ required: true, message: '가격을 입력하세요' }]}
          >
            <InputNumber
              min={0}
              style={{ width: '100%' }}
              formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
              parser={(value) => Number(value?.replace(/,/g, '') || 0) as 0}
            />
          </Form.Item>

          {/* 옵션 C: 외부 쇼핑몰의 동적 사이즈 override 허용
              북모아 등 외부 PHP 쇼핑몰이 width/height URL 파라미터로 워크스페이스
              사이즈를 직접 지정할 수 있게 함. 사이즈가 templateSet 에 묶여있지
              않고 사용자가 폼에서 자유 입력할 수 있는 상품에 사용.
              docs/BOOKMOA_INTEGRATION_DIFF.md §3 참조. */}
          <Form.Item
            name="allowCustomSize"
            label="외부 쇼핑몰 사이즈 override 허용"
            valuePropName="checked"
            tooltip="활성화하면 ?width=148&height=210 (mm) URL 파라미터로 인쇄 사이즈를 직접 지정할 수 있습니다. (북모아 등 외부 쇼핑몰 연동용)"
          >
            <Switch checkedChildren="허용" unCheckedChildren="금지" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={createMutation.isPending || updateMutation.isPending}
              >
                {editingProduct ? '수정' : '생성'}
              </Button>
              <Button onClick={() => setFormModalOpen(false)}>취소</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Template Set Selection Modal */}
      <Modal
        title="템플릿셋 연결"
        open={templateSetModalOpen}
        onCancel={() => {
          setTemplateSetModalOpen(false);
          setLinkingProduct(null);
        }}
        footer={null}
        width={600}
      >
        {linkingProduct && (
          <div style={{ marginBottom: 16 }}>
            <Text>
              <Text strong>{linkingProduct.name}</Text>에 연결할 템플릿셋을 선택하세요.
            </Text>
          </div>
        )}
        {templateSets?.length === 0 ? (
          <Empty description="사용 가능한 템플릿셋이 없습니다." />
        ) : (
          <List
            dataSource={templateSets}
            renderItem={(templateSet) => (
              <List.Item
                actions={[
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => handleSelectTemplateSet(templateSet.id)}
                    loading={linkMutation.isPending}
                  >
                    선택
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <img
                      src={resolveStorageUrl(templateSet.thumbnailUrl) || '/placeholder.png'}
                      alt={templateSet.name}
                      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4 }}
                    />
                  }
                  title={
                    <Space>
                      {templateSet.name}
                      <Tag color={templateSet.type === TemplateSetType.BOOK ? 'blue' : 'green'}>
                        {templateSetTypeLabels[templateSet.type as TemplateSetType]}
                      </Tag>
                    </Space>
                  }
                  description={`${templateSet.width} × ${templateSet.height}mm | ${templateSet.templates?.length || 0}개 템플릿`}
                />
              </List.Item>
            )}
          />
        )}
      </Modal>
    </div>
  );
};
