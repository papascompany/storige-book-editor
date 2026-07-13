import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Typography,
  message,
  Popconfirm,
  Tag,
  Input,
  Image,
  Tooltip,
  Select,
} from 'antd';
import { sitesApi } from '../../api/sites';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  EditOutlined,
  FileImageOutlined,
} from '@ant-design/icons';
import { editSessionsApi, EditSessionResponse, SessionStatus, SessionMode } from '../../api/edit-sessions';
import { axiosInstance, resolveStorageUrl } from '../../lib/axios';

const { Title, Text } = Typography;

const STATUS_MAP: Record<SessionStatus, { label: string; color: string }> = {
  draft: { label: '편집중', color: 'processing' },
  completed: { label: '완료', color: 'success' },
};

const MODE_MAP: Record<SessionMode, { label: string; icon: React.ReactNode }> = {
  upload: { label: '파일 업로드', icon: <FileImageOutlined /> },
  editor: { label: '에디터', icon: <EditOutlined /> },
};

export const EditSessionList = () => {
  const queryClient = useQueryClient();
  const [searchMemberSeqno, setSearchMemberSeqno] = useState('');
  const [searchOrderSeqno, setSearchOrderSeqno] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState<string | undefined>(undefined);

  // Phase C-3 — 사이트 dropdown 옵션
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
  });
  const siteOptions = sites.map((s) => ({ value: s.id, label: s.name }));

  // Fetch edit sessions
  const { data, isLoading } = useQuery({
    queryKey: ['edit-sessions', searchMemberSeqno, searchOrderSeqno, selectedSiteId],
    queryFn: () =>
      editSessionsApi.getAll({
        memberSeqno: searchMemberSeqno ? parseInt(searchMemberSeqno) : undefined,
        orderSeqno: searchOrderSeqno ? parseInt(searchOrderSeqno) : undefined,
        siteId: selectedSiteId,
      }),
  });

  // siteId → name 매핑 (테이블 컬럼 표시용)
  const siteNameById: Record<string, string> = sites.reduce(
    (acc, s) => ({ ...acc, [s.id]: s.name }),
    {} as Record<string, string>,
  );

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: editSessionsApi.delete,
    onSuccess: () => {
      message.success('편집 세션이 삭제되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['edit-sessions'] });
    },
    onError: () => {
      message.error('편집 세션 삭제에 실패했습니다.');
    },
  });

  // Complete mutation
  const completeMutation = useMutation({
    mutationFn: editSessionsApi.complete,
    onSuccess: () => {
      message.success('편집 세션이 완료 처리되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['edit-sessions'] });
    },
    onError: () => {
      message.error('편집 세션 완료 처리에 실패했습니다.');
    },
  });

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
  };

  const handleComplete = (id: string) => {
    completeMutation.mutate(id);
  };

  // T5 — 표지/내지 개별 PDF 다운로드 (생산용).
  // GET /files/:id/download (JWT 인증, blob 응답) — PdfBeforeAfterPreview 의 다운로드 패턴 재사용.
  // ⚠ toFileInfoDto 에 fileUrl 을 추가하는 API 변경 금지(SEC-008 회귀) — 반드시 이 인증 엔드포인트 경유.
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  const handleDownloadFile = async (
    fileId: string,
    fallbackName: string,
    mimeType?: string,
  ): Promise<void> => {
    setDownloadingFileId(fileId);
    try {
      const response = await axiosInstance.get(`/files/${fileId}/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], { type: mimeType || 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fallbackName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('파일 다운로드에 실패했습니다.');
    } finally {
      setDownloadingFileId(null);
    }
  };

  const columns: ColumnsType<EditSessionResponse> = [
    {
      title: '사이트',
      dataIndex: 'siteId',
      key: 'siteId',
      width: 130,
      render: (siteId: string | null) =>
        siteId ? (
          <Tag color="blue">{siteNameById[siteId] || siteId.slice(0, 8)}</Tag>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '주문번호',
      dataIndex: 'orderSeqno',
      key: 'orderSeqno',
      width: 120,
      render: (orderSeqno: number) => (
        <Text strong>{orderSeqno || '-'}</Text>
      ),
    },
    {
      title: '회원번호',
      dataIndex: 'memberSeqno',
      key: 'memberSeqno',
      width: 100,
    },
    {
      title: '모드',
      dataIndex: 'mode',
      key: 'mode',
      width: 120,
      render: (mode: SessionMode) => (
        <Space>
          {MODE_MAP[mode]?.icon}
          <Text>{MODE_MAP[mode]?.label || mode}</Text>
        </Space>
      ),
    },
    {
      title: '표지',
      key: 'coverFile',
      width: 80,
      render: (_, record) => (
        record.coverFile?.thumbnailUrl ? (
          <Image
            src={resolveStorageUrl(record.coverFile.thumbnailUrl)}
            alt="표지"
            width={50}
            height={50}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <Text type="secondary">-</Text>
        )
      ),
    },
    {
      title: '내지',
      key: 'contentFile',
      width: 80,
      render: (_, record) => (
        record.contentFile?.thumbnailUrl ? (
          <Image
            src={resolveStorageUrl(record.contentFile.thumbnailUrl)}
            alt="내지"
            width={50}
            height={50}
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <Text type="secondary">-</Text>
        )
      ),
    },
    {
      title: '상태',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: SessionStatus) => (
        <Tag color={STATUS_MAP[status]?.color}>
          {STATUS_MAP[status]?.label || status}
        </Tag>
      ),
      filters: [
        { text: '편집중', value: 'draft' },
        { text: '완료', value: 'completed' },
      ],
      onFilter: (value, record) => record.status === value,
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
      title: '수정일',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 150,
      render: (date: string) => new Date(date).toLocaleDateString('ko-KR'),
      sorter: (a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
    },
    {
      title: '완료일',
      dataIndex: 'completedAt',
      key: 'completedAt',
      width: 150,
      render: (date: string | null) =>
        date ? new Date(date).toLocaleDateString('ko-KR') : '-',
    },
    {
      title: '작업',
      key: 'actions',
      width: 220,
      render: (_, record) => {
        // 클로저 내 narrowing 유지를 위해 const 로 추출 (coverFileId 는 string | null | undefined)
        const { coverFileId, contentFileId } = record;
        return (
        <Space>
          {coverFileId && (
            <Tooltip title="표지 파일 다운로드">
              <Button
                type="link"
                icon={<DownloadOutlined />}
                onClick={() =>
                  handleDownloadFile(
                    coverFileId,
                    record.coverFile?.originalName || `cover_${record.id.substring(0, 8)}.pdf`,
                    record.coverFile?.mimeType,
                  )
                }
                loading={downloadingFileId === coverFileId}
              >
                표지
              </Button>
            </Tooltip>
          )}
          {contentFileId && (
            <Tooltip title="내지 파일 다운로드">
              <Button
                type="link"
                icon={<DownloadOutlined />}
                onClick={() =>
                  handleDownloadFile(
                    contentFileId,
                    record.contentFile?.originalName || `content_${record.id.substring(0, 8)}.pdf`,
                    record.contentFile?.mimeType,
                  )
                }
                loading={downloadingFileId === contentFileId}
              >
                내지
              </Button>
            </Tooltip>
          )}
          {record.status === 'draft' && (
            <Tooltip title="완료 처리">
              <Button
                type="link"
                icon={<CheckCircleOutlined />}
                onClick={() => handleComplete(record.id)}
                loading={completeMutation.isPending}
              />
            </Tooltip>
          )}
          <Popconfirm
            title="편집 세션을 삭제하시겠습니까?"
            description="삭제된 세션은 복구할 수 없습니다."
            onConfirm={() => handleDelete(record.id)}
            okText="삭제"
            cancelText="취소"
          >
            <Button
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={deleteMutation.isPending}
            />
          </Popconfirm>
        </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Title level={2}>편집데이터 관리</Title>
      </div>

      <Space style={{ marginBottom: 16 }}>
        <Select
          placeholder="사이트 선택"
          allowClear
          style={{ width: 200 }}
          value={selectedSiteId}
          onChange={setSelectedSiteId}
          options={siteOptions}
        />
        <Input
          placeholder="회원번호 검색"
          prefix={<SearchOutlined />}
          value={searchMemberSeqno}
          onChange={(e) => setSearchMemberSeqno(e.target.value)}
          style={{ width: 150 }}
          allowClear
        />
        <Input
          placeholder="주문번호 검색"
          prefix={<SearchOutlined />}
          value={searchOrderSeqno}
          onChange={(e) => setSearchOrderSeqno(e.target.value)}
          style={{ width: 150 }}
          allowClear
        />
      </Space>

      <Table
        columns={columns}
        dataSource={data?.sessions || []}
        rowKey="id"
        loading={isLoading}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          showTotal: (total) => `총 ${total}개`,
        }}
      />
    </div>
  );
};
