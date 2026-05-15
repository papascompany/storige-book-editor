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
  Switch,
  Modal,
  Select,
  InputNumber,
  Form,
  Card,
  Tooltip,
  Badge,
  AutoComplete,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  DeleteOutlined,
  SearchOutlined,
  StarOutlined,
  StarFilled,
  FileImageOutlined,
} from '@ant-design/icons';
import {
  productTemplateSetsApi,
  ProductTemplateSet,
  CreateProductTemplateSetInput,
} from '../../api/product-template-sets';
import { templateSetsApi } from '../../api/template-sets';
import { bookmoaApi, BookmoaCategory } from '../../api/bookmoa';
import { TemplateSet } from '@storige/types';
import { useDebouncedCallback } from 'use-debounce';
import { resolveStorageUrl } from '../../lib/axios';

const { Title, Text } = Typography;

// 썸네일 URL 변환 — 단일 소스 lib/axios.resolveStorageUrl 위임.
// (운영의 nginx 가 /storage/* 직접 서빙하므로 /api prefix 가 들어가면 404. 2026-05-15 fix)
const getFullThumbnailUrl = (url: string | null | undefined): string | null => {
  const resolved = resolveStorageUrl(url ?? undefined);
  return resolved || null;
};

// 썸네일 이미지 컴포넌트
const ThumbnailImage = ({ url }: { url: string | null | undefined }) => {
  const [hasError, setHasError] = useState(false);
  const fullUrl = getFullThumbnailUrl(url);

  if (!fullUrl || hasError) {
    return (
      <div
        style={{
          width: 50,
          height: 50,
          borderRadius: 4,
          backgroundColor: '#f5f5f5',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid #e8e8e8',
        }}
      >
        <FileImageOutlined style={{ fontSize: 20, color: '#bfbfbf' }} />
      </div>
    );
  }

  return (
    <img
      src={fullUrl}
      alt="thumbnail"
      style={{
        width: 50,
        height: 50,
        objectFit: 'cover',
        borderRadius: 4,
        backgroundColor: '#f5f5f5',
      }}
      onError={() => setHasError(true)}
    />
  );
};

export const ProductTemplateSetList = () => {
  const queryClient = useQueryClient();
  const [searchSortcode, setSearchSortcode] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedTemplateSetIds, setSelectedTemplateSetIds] = useState<string[]>([]);
  const [form] = Form.useForm();

  // 카테고리 자동완성 상태
  const [categoryOptions, setCategoryOptions] = useState<{ value: string; label: string }[]>([]);

  // 카테고리 검색 (debounced)
  const searchCategories = useDebouncedCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setCategoryOptions([]);
      return;
    }

    try {
      const result = await bookmoaApi.getCategories({ search, limit: 20 });
      const options = result.categories.map((cat: BookmoaCategory) => ({
        value: cat.sortcode,
        label: `${cat.sortcode} - ${cat.name}`,
      }));
      setCategoryOptions(options);
    } catch (error) {
      console.error('카테고리 검색 실패:', error);
      setCategoryOptions([]);
    }
  }, 300);

  // Fetch product-template-sets
  const { data, isLoading } = useQuery({
    queryKey: ['product-template-sets', searchSortcode],
    queryFn: () =>
      productTemplateSetsApi.getAll({
        sortcode: searchSortcode || undefined,
        limit: 100,
      }),
  });

  // Fetch all template sets (for selection modal)
  const { data: templateSets } = useQuery({
    queryKey: ['template-sets'],
    queryFn: () => templateSetsApi.getAll(),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateProductTemplateSetInput) =>
      productTemplateSetsApi.create(data),
    onSuccess: () => {
      message.success('연결이 추가되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['product-template-sets'] });
      setIsModalOpen(false);
      form.resetFields();
      setSelectedTemplateSetIds([]);
    },
    onError: (error: any) => {
      const status = error.response?.status;
      const serverMessage = error.response?.data?.message;

      if (status === 409) {
        message.warning('이미 등록된 연결입니다.');
      } else {
        message.error(serverMessage || '연결 추가에 실패했습니다.');
      }
    },
  });

  // Bulk create mutation
  const bulkCreateMutation = useMutation({
    mutationFn: productTemplateSetsApi.bulkCreate,
    onSuccess: (results) => {
      message.success(`${results.length}개의 연결이 추가되었습니다.`);
      queryClient.invalidateQueries({ queryKey: ['product-template-sets'] });
      setIsModalOpen(false);
      form.resetFields();
      setSelectedTemplateSetIds([]);
    },
    onError: (error: any) => {
      const status = error.response?.status;
      const serverMessage = error.response?.data?.message;

      if (status === 409) {
        message.warning('일부 연결이 이미 등록되어 있습니다.');
      } else {
        message.error(serverMessage || '연결 추가에 실패했습니다.');
      }
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      productTemplateSetsApi.update(id, data),
    onSuccess: () => {
      message.success('수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['product-template-sets'] });
    },
    onError: () => {
      message.error('수정에 실패했습니다.');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: productTemplateSetsApi.delete,
    onSuccess: () => {
      message.success('연결이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['product-template-sets'] });
    },
    onError: () => {
      message.error('삭제에 실패했습니다.');
    },
  });

  const handleAddSubmit = () => {
    form.validateFields().then((values) => {
      if (selectedTemplateSetIds.length === 0) {
        message.warning('템플릿셋을 선택해주세요.');
        return;
      }

      if (selectedTemplateSetIds.length === 1) {
        createMutation.mutate({
          sortcode: values.sortcode,
          prdtStanSeqno: values.prdtStanSeqno || undefined,
          templateSetId: selectedTemplateSetIds[0],
          isDefault: values.isDefault,
        });
      } else {
        bulkCreateMutation.mutate({
          sortcode: values.sortcode,
          prdtStanSeqno: values.prdtStanSeqno || undefined,
          templateSetIds: selectedTemplateSetIds,
        });
      }
    });
  };

  const handleToggleDefault = (record: ProductTemplateSet) => {
    updateMutation.mutate({
      id: record.id,
      data: { isDefault: !record.isDefault },
    });
  };

  const handleToggleActive = (record: ProductTemplateSet, checked: boolean) => {
    updateMutation.mutate({
      id: record.id,
      data: { isActive: checked },
    });
  };

  const columns: ColumnsType<ProductTemplateSet> = [
    {
      title: '상품',
      key: 'product',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.categoryName || record.sortcode}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.sortcode}
            {record.prdtStanSeqno && ` · 규격 ${record.prdtStanSeqno}`}
          </Text>
        </Space>
      ),
    },
    {
      title: '썸네일',
      key: 'thumbnail',
      width: 80,
      render: (_, record) => (
        <ThumbnailImage url={record.templateSet?.thumbnailUrl} />
      ),
    },
    {
      title: '템플릿셋',
      key: 'templateSet',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.templateSet?.name || '-'}</Text>
          {record.templateSet && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.templateSet.type === 'book' ? '책자' : '리플렛'} · {record.templateSet.width}×{record.templateSet.height}mm
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '기본',
      key: 'isDefault',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Tooltip title={record.isDefault ? '기본 템플릿' : '기본으로 설정'}>
          <Button
            type="text"
            icon={record.isDefault ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
            onClick={() => handleToggleDefault(record)}
          />
        </Tooltip>
      ),
    },
    {
      title: '순서',
      dataIndex: 'displayOrder',
      key: 'displayOrder',
      width: 80,
      align: 'center',
      sorter: (a, b) => a.displayOrder - b.displayOrder,
    },
    {
      title: '활성',
      key: 'isActive',
      width: 80,
      align: 'center',
      render: (_, record) => (
        <Switch
          size="small"
          checked={record.isActive}
          onChange={(checked) => handleToggleActive(record, checked)}
        />
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
      width: 100,
      render: (_, record) => (
        <Popconfirm
          title="연결을 삭제하시겠습니까?"
          onConfirm={() => deleteMutation.mutate(record.id)}
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
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>상품-템플릿셋 연결 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)}>
          연결 추가
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="상품코드 검색 (예: 001001001)"
          prefix={<SearchOutlined />}
          value={searchSortcode}
          onChange={(e) => setSearchSortcode(e.target.value)}
          style={{ width: 300 }}
          allowClear
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data?.items}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />

      {/* Add Modal */}
      <Modal
        title="상품-템플릿셋 연결 추가"
        open={isModalOpen}
        onCancel={() => {
          setIsModalOpen(false);
          form.resetFields();
          setSelectedTemplateSetIds([]);
        }}
        onOk={handleAddSubmit}
        okText="추가"
        cancelText="취소"
        confirmLoading={createMutation.isPending || bulkCreateMutation.isPending}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="sortcode"
            label="상품코드 (sortcode)"
            rules={[{ required: true, message: '상품코드를 입력하세요' }]}
          >
            <AutoComplete
              options={categoryOptions}
              onSearch={(value) => {
                searchCategories(value);
              }}
              onSelect={(value) => {
                form.setFieldValue('sortcode', value);
              }}
              placeholder="상품명 또는 코드로 검색 (예: 책자, 001001)"
              allowClear
            />
          </Form.Item>

          <Form.Item
            name="prdtStanSeqno"
            label="규격 번호 (선택)"
            help="비워두면 해당 상품의 모든 규격에 적용됩니다"
          >
            <InputNumber placeholder="예: 1" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item
            label="템플릿셋 선택"
            required
            help={`${selectedTemplateSetIds.length}개 선택됨`}
          >
            <Select
              mode="multiple"
              placeholder="템플릿셋을 선택하세요"
              value={selectedTemplateSetIds}
              onChange={setSelectedTemplateSetIds}
              style={{ width: '100%' }}
              optionFilterProp="label"
              showSearch
              options={templateSets?.map((ts: TemplateSet) => ({
                value: ts.id,
                label: `${ts.name} (${ts.type === 'book' ? '책자' : '리플렛'} · ${ts.width}×${ts.height}mm)`,
              }))}
            />
          </Form.Item>

          {selectedTemplateSetIds.length === 1 && (
            <Form.Item name="isDefault" valuePropName="checked">
              <Switch /> <Text type="secondary">기본 템플릿으로 설정</Text>
            </Form.Item>
          )}
        </Form>

        {/* Selected template sets preview */}
        {selectedTemplateSetIds.length > 0 && (
          <Card size="small" title="선택된 템플릿셋" style={{ marginTop: 16 }}>
            <Space wrap>
              {selectedTemplateSetIds.map((id, index) => {
                const ts = templateSets?.find((t: TemplateSet) => t.id === id);
                return ts ? (
                  <Tag key={id} closable onClose={() => {
                    setSelectedTemplateSetIds(prev => prev.filter(i => i !== id));
                  }}>
                    <Badge
                      count={index + 1}
                      size="small"
                      style={{ backgroundColor: '#1890ff', marginRight: 4 }}
                    />
                    {ts.name}
                  </Tag>
                ) : null;
              })}
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                순서대로 displayOrder가 지정됩니다. 첫 번째가 기본 템플릿이 됩니다.
              </Text>
            </div>
          </Card>
        )}
      </Modal>
    </div>
  );
};
