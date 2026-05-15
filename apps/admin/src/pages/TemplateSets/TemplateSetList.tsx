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
  Tooltip,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  SearchOutlined,
  FileOutlined,
  DesktopOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { TemplateSet, TemplateSetType } from '@storige/types';
import { templateSetsApi } from '../../api/template-sets';
import { templatesApi } from '../../api/templates';
import { ThumbnailImage } from '../../components/ThumbnailImage';

const { Title, Text } = Typography;

// API 서버 URL (storage URL 변환용)
// 썸네일 표시는 공통 컴포넌트 사용 (admin/components/ThumbnailImage)
// — placeholder/로드 실패 UX 통일 + resolveStorageUrl 위임

const templateSetTypeLabels: Record<TemplateSetType, string> = {
  [TemplateSetType.BOOK]: '책자',
  [TemplateSetType.LEAFLET]: '리플렛',
};

const templateSetTypeColors: Record<TemplateSetType, string> = {
  [TemplateSetType.BOOK]: 'blue',
  [TemplateSetType.LEAFLET]: 'green',
};

// 에디터 URL
const EDITOR_BASE_URL = import.meta.env.VITE_EDITOR_URL || 'http://localhost:3000';

export const TemplateSetList = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState('');
  const [selectedType, setSelectedType] = useState<TemplateSetType | undefined>();
  const { accessToken } = useAuthStore();

  // Fetch template sets
  const { data: templateSets, isLoading } = useQuery({
    queryKey: ['template-sets', selectedType],
    queryFn: () => templateSetsApi.getAll({ type: selectedType }),
  });

  // Fetch all templates (썸네일 fallback용)
  const { data: allTemplates } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.getAll(),
  });

  // 템플릿 ID로 썸네일 URL 가져오기
  const getTemplateThumbnail = (templateId: string): string | null => {
    const template = allTemplates?.find((t) => t.id === templateId);
    return template?.thumbnailUrl || null;
  };

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: templateSetsApi.delete,
    onSuccess: () => {
      message.success('템플릿셋이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['template-sets'] });
    },
    onError: () => {
      message.error('템플릿셋 삭제에 실패했습니다.');
    },
  });

  // Copy mutation
  const copyMutation = useMutation({
    mutationFn: templateSetsApi.copy,
    onSuccess: () => {
      message.success('템플릿셋이 복사되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['template-sets'] });
    },
    onError: () => {
      message.error('템플릿셋 복사에 실패했습니다.');
    },
  });

  // Update name mutation
  const updateNameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      templateSetsApi.update(id, { name }),
    onSuccess: () => {
      message.success('템플릿셋명이 수정되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['template-sets'] });
    },
    onError: () => {
      message.error('템플릿셋명 수정에 실패했습니다.');
    },
  });

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleCopy = (id: string) => {
    copyMutation.mutate(id);
  };

  const handleCreate = () => {
    navigate('/template-sets/new');
  };

  const handleEdit = (id: string) => {
    navigate(`/template-sets/${id}`);
  };

  /**
   * 템플릿셋 디자인 수정 (admin 전용).
   *
   * URL 에 `adminEdit=templateSet` 을 함께 전달하면 EditorView 가 admin 모드로 진입해서:
   * - 상단에 "관리자 모드: 저장하면 이 템플릿셋의 모든 페이지가 갱신됩니다" 안내 노출
   * - 저장(편집완료) 시 각 페이지 fabric canvas → 해당 templates.canvas_data 로 PATCH 처리
   *   (editor_designs 에 작품으로 저장하던 기존 admin 흐름과 분리)
   *
   * 고객(PHP/bookmoa) 흐름은 이 파라미터를 보내지 않으므로 영향 없음.
   */
  const handleEditTemplateSet = (id: string) => {
    // 상대 경로인 경우 현재 origin을 base로 사용
    let baseUrl = EDITOR_BASE_URL.startsWith('/')
      ? window.location.origin + EDITOR_BASE_URL
      : EDITOR_BASE_URL;
    // trailing slash 보장 (Apache SPA 라우팅을 위해 필요)
    if (!baseUrl.endsWith('/')) {
      baseUrl += '/';
    }
    const url = new URL(baseUrl);
    url.searchParams.set('templateSetId', id);
    url.searchParams.set('adminEdit', 'templateSet');
    if (accessToken) {
      url.searchParams.set('token', accessToken);
    }
    window.open(url.toString(), '_blank');
  };

  const columns: ColumnsType<TemplateSet> = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      render: (id: string) => (
        <Tooltip title={id}>
          <Text copyable={{ text: id }} style={{ fontSize: 12 }}>
            {id.slice(0, 8)}...
          </Text>
        </Tooltip>
      ),
    },
    {
      title: '썸네일',
      key: 'thumbnailUrl',
      width: 100,
      render: (_, record) => {
        // 템플릿셋 자체 썸네일 우선, 없으면 첫 번째 템플릿 썸네일 사용
        let url: string | null | undefined = record.thumbnailUrl ?? undefined;
        if (!url && record.templates && record.templates.length > 0) {
          url = getTemplateThumbnail(record.templates[0].templateId);
        }
        return <ThumbnailImage url={url} />;
      },
    },
    {
      title: '템플릿셋명',
      dataIndex: 'name',
      key: 'name',
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (name: string, record) => (
        <Space>
          <Text>{name}</Text>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              const newName = prompt('템플릿셋명 수정', name);
              if (newName && newName !== name) {
                updateNameMutation.mutate({ id: record.id, name: newName });
              }
            }}
          />
        </Space>
      ),
    },
    {
      title: '타입',
      dataIndex: 'type',
      key: 'type',
      width: 100,
      render: (type: TemplateSetType) => (
        <Tag color={templateSetTypeColors[type]}>
          {templateSetTypeLabels[type]}
        </Tag>
      ),
    },
    {
      title: '판형',
      key: 'size',
      width: 120,
      render: (_, record) => (
        <Text>{record.width} × {record.height}mm</Text>
      ),
    },
    {
      title: '템플릿 수',
      dataIndex: 'templates',
      key: 'templates',
      width: 100,
      render: (templates: any[]) => (
        <Tooltip title="템플릿 구성 보기">
          <Tag icon={<FileOutlined />}>
            {templates?.length || 0}개
          </Tag>
        </Tooltip>
      ),
    },
    {
      title: '내지 설정',
      key: 'pageSettings',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text type={record.canAddPage ? undefined : 'secondary'}>
            {record.canAddPage ? '추가 가능' : '추가 불가'}
          </Text>
          {record.pageCountRange && record.pageCountRange.length > 0 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {record.pageCountRange[0]}~{record.pageCountRange[record.pageCountRange.length - 1]}p
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: '생성일',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 120,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: '작업',
      key: 'actions',
      width: 280,
      render: (_, record) => (
        <Space>
          {/* 디자인 캔버스 — 저장 시 templates.canvas_data 갱신 (admin 전용) */}
          <Tooltip title="에디터로 진입해 모든 페이지의 캔버스를 입히고 저장합니다. 각 페이지 templates.canvas_data 가 갱신됩니다.">
            <Button
              type="link"
              icon={<DesktopOutlined />}
              onClick={() => handleEditTemplateSet(record.id)}
            >
              템플릿셋 수정
            </Button>
          </Tooltip>
          {/* 메타 수정 — name/판형/templates 구성/도구 메뉴 화이트리스트 등 */}
          <Tooltip title="템플릿셋 메타(이름·판형·페이지 구성·노출 도구 메뉴 등) 수정.">
            <Button
              type="link"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.id)}
            >
              설정
            </Button>
          </Tooltip>
          <Button
            type="link"
            icon={<CopyOutlined />}
            onClick={() => handleCopy(record.id)}
            loading={copyMutation.isPending}
          >
            복사
          </Button>
          <Popconfirm
            title="템플릿셋을 삭제하시겠습니까?"
            description="연결된 상품이 있으면 삭제할 수 없습니다."
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

  // Filter by search text
  const filteredTemplates = templateSets?.filter((set) =>
    set.name.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <Title level={2}>템플릿셋 관리</Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          템플릿셋 생성
        </Button>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Input
          placeholder="템플릿셋 검색"
          prefix={<SearchOutlined />}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 250 }}
        />
        <Select
          placeholder="타입 선택"
          style={{ width: 150 }}
          value={selectedType}
          onChange={setSelectedType}
          allowClear
          options={[
            { label: '책자', value: TemplateSetType.BOOK },
            { label: '리플렛', value: TemplateSetType.LEAFLET },
          ]}
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
