/**
 * 방향 쌍 (orientation pair) 섹션 — 2026-07-14.
 *
 * 저장된 템플릿셋(서버 값) 기준으로 가로/세로 방향 쌍을 조회·연결·해제하고,
 * 기본 판형 설정 + 반대 방향 세트 파생 생성을 제공한다.
 *
 * 데이터 소스는 ['template-sets'] 목록 쿼리 하나로 통일한다(현재 세트·짝 상대·후보 전부).
 * ⚠️ 의도적으로 부모 폼의 ['template-set', id] 쿼리는 무효화하지 않는다 —
 * 무효화하면 폼 로드 이펙트(setFieldsValue)가 재실행되어 저장 전 편집값이
 * 소리 없이 초기화되기 때문. 방향 쌍 필드는 이 섹션(목록 쿼리)만 소비한다.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Divider,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { templateSetsApi } from '../../api/template-sets';
import {
  canPairOrientation,
  formatSizeLabel,
  isOrientationPairMatch,
} from '../../components/formatPresetHelpers';

const { Text } = Typography;

interface OrientationPairSectionProps {
  /** 저장된(수정 모드) 템플릿셋 id — 신규(미저장) 세트에서는 이 섹션 자체를 렌더하지 않는다 */
  templateSetId: string;
}

export const OrientationPairSection = ({ templateSetId }: OrientationPairSectionProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pairTargetId, setPairTargetId] = useState<string | undefined>();

  // 목록 쿼리 — 현재 세트(방향 쌍 필드 포함)·짝 상대 이름·연결 후보를 전부 여기서 해석
  const { data: allSets, isLoading } = useQuery({
    queryKey: ['template-sets'],
    queryFn: () => templateSetsApi.getAll(),
  });

  const current = useMemo(
    () => allSets?.find((s) => s.id === templateSetId),
    [allSets, templateSetId],
  );

  const pairedSet = useMemo(() => {
    const pairedId = current?.pairedTemplateSetId;
    return pairedId ? allSets?.find((s) => s.id === pairedId) : undefined;
  }, [allSets, current]);

  // 연결 후보 = 같은 재단 규격의 정확 W↔H 스왑(±0.01mm) 세트만 (정사각·자기자신 제외)
  const candidates = useMemo(() => {
    if (!current || !allSets) return [];
    return allSets.filter(
      (s) =>
        s.id !== current.id &&
        !s.isDeleted &&
        isOrientationPairMatch(
          { widthMm: current.width, heightMm: current.height },
          { widthMm: s.width, heightMm: s.height },
        ),
    );
  }, [allSets, current]);

  const invalidate = () => {
    // ['template-sets'] prefix — 이 섹션 쿼리와 목록 화면 쿼리(['template-sets', type])를 함께 갱신
    void queryClient.invalidateQueries({ queryKey: ['template-sets'] });
  };

  const pairMutation = useMutation({
    mutationFn: (pairedTemplateSetId: string) =>
      templateSetsApi.pair(templateSetId, pairedTemplateSetId),
    onSuccess: () => {
      message.success('방향 쌍이 연결되었습니다.');
      setPairTargetId(undefined);
      invalidate();
    },
    onError: () => {
      message.error('방향 쌍 연결에 실패했습니다.');
    },
  });

  const unpairMutation = useMutation({
    mutationFn: () => templateSetsApi.unpair(templateSetId),
    onSuccess: () => {
      message.success('방향 쌍이 해제되었습니다.');
      invalidate();
    },
    onError: () => {
      message.error('방향 쌍 해제에 실패했습니다.');
    },
  });

  const orientationDefaultMutation = useMutation({
    mutationFn: () => templateSetsApi.setOrientationDefault(templateSetId),
    onSuccess: () => {
      message.success('기본 판형으로 설정되었습니다. 반대쪽 세트는 자동 해제됩니다.');
      invalidate();
    },
    onError: () => {
      message.error('기본 판형 설정에 실패했습니다.');
    },
  });

  const deriveMutation = useMutation({
    mutationFn: () => templateSetsApi.deriveOrientation(templateSetId),
    onSuccess: (created) => {
      invalidate();
      message.success(
        <span>
          반대 방향 세트가 초안(비활성)으로 생성되고 이 세트와 쌍으로 연결되었습니다.
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/template-sets/${created.id}`)}
          >
            새 세트 편집으로 이동
          </Button>
        </span>,
        8,
      );
    },
    onError: () => {
      message.error('반대 방향 세트 파생 생성에 실패했습니다.');
    },
  });

  const handleDeriveClick = () => {
    if (!current) return;
    Modal.confirm({
      title: '반대 방향 세트 파생 생성',
      width: 560,
      content: (
        <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
          <li>
            판형 W↔H 스왑(<b>{formatSizeLabel(current.height, current.width)}</b>) 세트가{' '}
            <b>초안(비활성)</b>으로 생성됩니다 — 사람 검수 후 직접 활성화해야 노출됩니다.
          </li>
          <li>내지(page) 템플릿만 자동 재배치(축별 비율 위치 이동)로 이월됩니다.</li>
          <li>표지류(스프레드·책등·날개·면지)는 이월되지 않습니다 — 별도 저작이 필요합니다.</li>
          <li>생성 즉시 이 세트와 방향 쌍으로 연결됩니다(기본 판형은 현재 세트 유지).</li>
        </ul>
      ),
      okText: '파생 생성',
      cancelText: '취소',
      onOk: async () => {
        try {
          await deriveMutation.mutateAsync();
        } catch {
          // 실패 메시지는 onError 에서 처리 — 모달은 닫는다
        }
      },
    });
  };

  if (isLoading) {
    return <Spin size="small" />;
  }

  if (!current) {
    return (
      <Alert
        type="warning"
        showIcon
        message="세트 정보를 불러올 수 없습니다"
        description="목록을 새로고침한 뒤 다시 시도하세요."
      />
    );
  }

  // 정사각(±0.01mm)은 방향 구분이 없어 쌍·파생 불가 (오너 확정 규칙)
  if (!canPairOrientation(current.width, current.height)) {
    return (
      <Alert
        type="info"
        showIcon
        message="정사각 판형은 방향 쌍을 사용할 수 없습니다"
        description="가로/세로 구분이 없는 판형(W=H)에는 방향 쌍 연결·파생 생성이 적용되지 않습니다."
      />
    );
  }

  // ── 짝 있음: 현재 짝 표시 + 짝 해제 + 기본 판형 ──
  if (current.pairedTemplateSetId) {
    const pairedId = current.pairedTemplateSetId;
    return (
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color="geekblue">⇄ {pairedSet?.name ?? `${pairedId.slice(0, 8)}…`}</Tag>
          {pairedSet && (
            <Text type="secondary">{formatSizeLabel(pairedSet.width, pairedSet.height)}</Text>
          )}
          {pairedSet &&
            (pairedSet.isActive === false ? (
              <Tag>비활성(초안)</Tag>
            ) : (
              <Tag color="green">활성</Tag>
            ))}
          <Button size="small" type="link" onClick={() => navigate(`/template-sets/${pairedId}`)}>
            바로가기
          </Button>
          <Popconfirm
            title="방향 쌍을 해제하시겠습니까?"
            description="양쪽 세트의 연결이 함께 해제됩니다."
            okText="해제"
            cancelText="취소"
            onConfirm={() => unpairMutation.mutate()}
          >
            <Button size="small" danger loading={unpairMutation.isPending}>
              짝 해제
            </Button>
          </Popconfirm>
        </Space>

        <Checkbox
          checked={!!current.isOrientationDefault}
          disabled={!!current.isOrientationDefault || orientationDefaultMutation.isPending}
          onChange={(e) => {
            if (e.target.checked) {
              orientationDefaultMutation.mutate();
            }
          }}
        >
          기본 판형
        </Checkbox>
        <Text type="secondary" style={{ fontSize: 12 }}>
          짝 중 정확히 한쪽만 기본 판형입니다. 이쪽을 설정하면 반대쪽은 자동 해제됩니다.
          {current.isOrientationDefault
            ? ' 해제하려면 반대쪽 세트에서 기본 판형을 설정하세요.'
            : ''}
        </Text>
      </Space>
    );
  }

  // ── 짝 없음: 기존 세트 연결 + 반대 방향 세트 파생 생성 ──
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space wrap>
        <Select
          placeholder="기존 세트 연결 — W↔H 스왑 세트 선택"
          style={{ minWidth: 340 }}
          value={pairTargetId}
          onChange={setPairTargetId}
          allowClear
          showSearch
          optionFilterProp="label"
          options={candidates.map((s) => ({
            value: s.id,
            label: `${s.name} — ${formatSizeLabel(s.width, s.height)}${
              s.pairedTemplateSetId ? ' (이미 다른 세트와 짝)' : ''
            }`,
            disabled: !!s.pairedTemplateSetId,
          }))}
        />
        <Button
          type="primary"
          disabled={!pairTargetId}
          loading={pairMutation.isPending}
          onClick={() => {
            if (pairTargetId) {
              pairMutation.mutate(pairTargetId);
            }
          }}
        >
          기존 세트 연결
        </Button>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        후보는 같은 재단 규격의 정확 W↔H 스왑(±0.01mm) 세트만 표시됩니다 (현재 판형{' '}
        {formatSizeLabel(current.width, current.height)} ↔ 상대{' '}
        {formatSizeLabel(current.height, current.width)}).
      </Text>

      <Divider style={{ margin: '8px 0' }} />

      <Space wrap>
        <Button loading={deriveMutation.isPending} onClick={handleDeriveClick}>
          반대 방향 세트 파생 생성
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          판형을 W↔H 스왑한 세트를 초안(비활성)으로 만들고 즉시 쌍으로 연결합니다.
        </Text>
      </Space>
    </Space>
  );
};
