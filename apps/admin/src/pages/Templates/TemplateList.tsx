import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  Tooltip,
  Switch,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { InputRef } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  SearchOutlined,
  CheckOutlined,
  CloseOutlined,
  ImportOutlined,
} from '@ant-design/icons';
import { Template } from '@storige/types';
import { templatesApi } from '../../api/templates';
import { categoriesApi } from '../../api/categories';
import { ThumbnailImage } from '../../components/ThumbnailImage';

const { Title } = Typography;

// 썸네일 표시는 공통 컴포넌트 사용 (admin/components/ThumbnailImage)
// — placeholder/로드 실패 UX 통일 + resolveStorageUrl 위임

// 편집 가능한 editCode 컴포넌트
interface EditableEditCodeProps {
  templateId: string;
  value: string | null;
  onSave: (id: string, editCode: string) => Promise<void>;
}

const EditableEditCode = ({ templateId, value, onSave }: EditableEditCodeProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value || '');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    setEditValue(value || '');
    setError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(value || '');
    setError(null);
  };

  const handleSave = async () => {
    const trimmedValue = editValue.trim();

    if (!trimmedValue) {
      setError('편집 코드를 입력해주세요.');
      return;
    }

    if (trimmedValue === value) {
      setIsEditing(false);
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      // 중복 검사
      const exists = await templatesApi.checkEditCode(trimmedValue, templateId);
      if (exists) {
        setError('이미 사용 중인 편집 코드입니다.');
        setIsChecking(false);
        return;
      }

      // 저장
      await onSave(templateId, trimmedValue);
      setIsEditing(false);
    } catch (_err) {
      setError('저장에 실패했습니다.');
    } finally {
      setIsChecking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <Space.Compact size="small" style={{ width: '100%' }}>
        <Tooltip title={error} open={!!error} color="red">
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            status={error ? 'error' : undefined}
            style={{ width: 100 }}
            disabled={isChecking}
          />
        </Tooltip>
        <Button
          type="primary"
          size="small"
          icon={<CheckOutlined />}
          onClick={handleSave}
          loading={isChecking}
        />
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={handleCancel}
          disabled={isChecking}
        />
      </Space.Compact>
    );
  }

  return (
    <div
      style={{
        cursor: 'pointer',
        padding: '4px 8px',
        borderRadius: 4,
        minHeight: 24,
        display: 'flex',
        alignItems: 'center',
      }}
      onClick={handleStartEdit}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = '#f5f5f5';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      <span style={{ color: value ? 'inherit' : '#bfbfbf' }}>
        {value || '클릭하여 입력'}
      </span>
      <EditOutlined style={{ marginLeft: 8, fontSize: 12, color: '#bfbfbf' }} />
    </div>
  );
};

export const TemplateList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>();

  // Fetch templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['templates', selectedCategory],
    queryFn: () => templatesApi.getAll(selectedCategory),
    staleTime: 30 * 1000, // 30초 동안 데이터를 fresh 상태로 유지
    refetchOnWindowFocus: false, // 창 포커스 시 자동 refetch 비활성화
  });

  // Fetch categories for filter
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getTree,
    staleTime: 60 * 1000, // 1분 동안 데이터를 fresh 상태로 유지
    refetchOnWindowFocus: false,
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: templatesApi.delete,
    onSuccess: () => {
      message.success('템플릿이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      message.error('템플릿 삭제에 실패했습니다.');
    },
  });

  // Copy mutation
  const copyMutation = useMutation({
    mutationFn: templatesApi.copy,
    onSuccess: () => {
      message.success('템플릿이 복사되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      message.error('템플릿 복사에 실패했습니다.');
    },
  });

  // Update editCode mutation
  const updateEditCodeMutation = useMutation({
    mutationFn: ({ id, editCode }: { id: string; editCode: string }) =>
      templatesApi.update(id, { editCode }),
    onSuccess: () => {
      message.success('편집 코드가 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      message.error('편집 코드 수정에 실패했습니다.');
    },
  });

  const handleSaveEditCode = async (id: string, editCode: string) => {
    await updateEditCodeMutation.mutateAsync({ id, editCode });
  };

  // Update isActive mutation
  const updateIsActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      templatesApi.update(id, { isActive }),
    onSuccess: (_, variables) => {
      message.success(variables.isActive ? '템플릿이 활성화되었습니다.' : '템플릿이 비활성화되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      message.error('상태 변경에 실패했습니다.');
    },
  });

  // Update name mutation
  const updateNameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      templatesApi.update(id, { name }),
    onSuccess: () => {
      message.success('템플릿명이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: () => {
      message.error('템플릿명 수정에 실패했습니다.');
    },
  });

  const handleToggleActive = (id: string, isActive: boolean) => {
    updateIsActiveMutation.mutate({ id, isActive });
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleCopy = (id: string) => {
    copyMutation.mutate(id);
  };

  const columns: ColumnsType<Template> = [
    {
      title: '썸네일',
      dataIndex: 'thumbnailUrl',
      key: 'thumbnailUrl',
      width: 100,
      render: (url: string | null | undefined) => <ThumbnailImage url={url} />,
    },
    {
      title: '템플릿명',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record: Template) => (
        <Space>
          <span>{name}</span>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              const newName = prompt('템플릿명 수정', name);
              if (newName && newName !== name) {
                updateNameMutation.mutate({ id: record.id, name: newName });
              }
            }}
          />
        </Space>
      ),
    },
    {
      title: '편집 코드',
      dataIndex: 'editCode',
      key: 'editCode',
      width: 180,
      render: (editCode: string | null, record: Template) => (
        <EditableEditCode
          templateId={record.id}
          value={editCode}
          onSave={handleSaveEditCode}
        />
      ),
    },
    {
      title: '템플릿 코드',
      dataIndex: 'templateCode',
      key: 'templateCode',
      width: 150,
    },
    {
      title: '타입',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: string) => {
        const typeLabels: Record<string, { label: string; color: string }> = {
          page: { label: '내지', color: 'blue' },
          cover: { label: '표지', color: 'green' },
          spine: { label: '책등', color: 'orange' },
          wing: { label: '날개', color: 'purple' },
          spread: { label: '스프레드', color: 'magenta' },
          // 인쇄 워크플로우 v1 Phase 3 (2026-05-19)
          endpaper: { label: '면지', color: 'gold' },
        };
        const typeInfo = typeLabels[type] || { label: type, color: 'default' };
        return <Tag color={typeInfo.color}>{typeInfo.label}</Tag>;
      },
      filters: [
        { text: '내지', value: 'page' },
        { text: '표지', value: 'cover' },
        { text: '책등', value: 'spine' },
        { text: '날개', value: 'wing' },
        { text: '스프레드', value: 'spread' },
        { text: '면지', value: 'endpaper' },
      ],
      onFilter: (value, record) => record.type === value,
    },
    {
      title: '상태',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 100,
      render: (isActive: boolean, record: Template) => (
        <Switch
          checked={isActive}
          onChange={(checked) => handleToggleActive(record.id, checked)}
          checkedChildren="활성"
          unCheckedChildren="비활성"
          loading={updateIsActiveMutation.isPending && updateIsActiveMutation.variables?.id === record.id}
        />
      ),
      filters: [
        { text: '활성', value: true },
        { text: '비활성', value: false },
      ],
      onFilter: (value, record) => record.isActive === value,
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
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => navigate(`/templates/editor?id=${record.id}`)}
          >
            편집
          </Button>
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(record.id)}
            loading={copyMutation.isPending}
          >
            복사
          </Button>
          <Popconfirm
            title="템플릿을 삭제하시겠습니까?"
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

  // Flatten categories for select options
  const flattenCategories = (cats: any[], level = 0): any[] => {
    let result: any[] = [];
    cats.forEach((cat) => {
      result.push({
        label: `${'  '.repeat(level)}${cat.name}`,
        value: cat.id,
      });
      if (cat.children && cat.children.length > 0) {
        result = result.concat(flattenCategories(cat.children, level + 1));
      }
    });
    return result;
  };

  const categoryOptions = categories ? flattenCategories(categories) : [];

  // Filter templates by search text
  const filteredTemplates = templates?.filter((template) =>
    template.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>템플릿 관리</Title>
        <Space>
          <Button
            icon={<ImportOutlined />}
            onClick={() => navigate('/templates/import')}
          >
            IDML 가져오기
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/templates/editor')}
          >
            템플릿 생성
          </Button>
        </Space>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="템플릿 검색"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250 }}
        />
        <Select
          placeholder="카테고리 선택"
          style={{ width: 200 }}
          value={selectedCategory}
          onChange={setSelectedCategory}
          allowClear
          options={categoryOptions}
        />
      </Space>

      <Table
        columns={columns}
        dataSource={filteredTemplates}
        rowKey="id"
        loading={isLoading}
        pagination={{
          pageSize: 10,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />
    </div>
  );
};
