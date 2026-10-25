/**
 * 캘린더 스킨(디자인 묶음) 편집 절 — 템플릿셋 폼 「상품 프로파일」 패널 (설계 docs/CALENDAR_SKINSET_DESIGN_2026-10-24.md §4.2, 2026-10-25).
 *
 * - 노출: 입력 중인 프로파일 JSON 이 `kind='calendar'` 일 때만(TemplateSetType 과 무관).
 * - 저장 필드는 `productProfileJson` 하나뿐이다. 이 절은 그 글의 `calendar.skins` 를 읽어 보여 주고,
 *   사용자가 조작할 때만 다시 써 넣는다(열기·저장만 하면 글을 건드리지 않는다).
 * - 후보: 기존 목록 조회(`templateSetsApi.getAll`) 중 같은 사이트(또는 공유)·캘린더 프로파일 세트.
 *   구조 호환은 types `checkCalendarSkinCompatibility` 결과를 저장 전에 안내한다. 사이트 일치는 서버가 저장 시 다시 검사하며,
 *   그 400 응답은 폼의 저장 실패 메시지가 그대로 보여 준다.
 * - 부모 폼의 ['template-set', id] 쿼리는 구독·무효화하지 않는다(폼 로드 이펙트가 편집값을 덮지 않도록).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Divider, Empty, Form, Input, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { CALENDAR_SKIN_LABEL_MAX, CALENDAR_SKIN_MAX, validateProductProfile } from '@storige/types';
import { templateSetsApi } from '../../api/template-sets';
import { templatesApi } from '../../api/templates';
import { resolveStorageUrl } from '../../lib/axios';
import {
  canAddSkin,
  filterSkinCandidates,
  moveSkin,
  parseRawProfile,
  patchSkin,
  readCalendarSkins,
  removeSkin,
  skinCompatibilityErrors,
  skinFromTemplateSet,
  skinValidationErrors,
  templateDetailsFor,
  uniqueTemplateIds,
  writeCalendarSkins,
  type CalendarSkinDraft,
  type SkinCandidateSet,
} from './calendarSkins';

const { Text } = Typography;

/** 후보 목록 조회 크기 — 목록 API 기본값(20)으로는 후보가 잘릴 수 있다 */
export const SKIN_CANDIDATE_PAGE_SIZE = 500;
/** 미리보기 썸네일 최대 개수(고유 템플릿 기준) */
const PREVIEW_THUMB_MAX = 13;

export interface CalendarSkinsSectionProps {
  /** 저장된 템플릿셋 id — 신규(미저장) 세트에서는 스킨 지정 대신 안내만 보인다 */
  templateSetId?: string;
  /** 폼에 연결된 템플릿 id(참조 순서) — 기준 세트 면별 사진틀 수 비교용 */
  templateIds: readonly string[];
}

interface TemplateInfo {
  canvasData?: unknown;
  thumbnailUrl?: string | null;
}

export const CalendarSkinsSection = ({ templateSetId, templateIds }: CalendarSkinsSectionProps) => {
  const form = Form.useFormInstance();
  const profileJson: string | undefined = Form.useWatch('productProfileJson', form);
  const width: number | undefined = Form.useWatch('width', form);
  const height: number | undefined = Form.useWatch('height', form);
  const bleedMm: number | undefined = Form.useWatch('bleedMm', form);
  const cropMarkEnabled: boolean | undefined = Form.useWatch('cropMarkEnabled', form);

  const read = useMemo(() => readCalendarSkins(profileJson), [profileJson]);
  const visible = read.kind !== 'hidden';
  const queryEnabled = visible && !!templateSetId;

  const { data: allSets, isLoading: isLoadingSets, isError: isSetsError } = useQuery({
    queryKey: ['template-sets', 'calendar-skin-candidates'],
    queryFn: () => templateSetsApi.getAll({ pageSize: SKIN_CANDIDATE_PAGE_SIZE }),
    enabled: queryEnabled,
    refetchOnWindowFocus: false,
  });
  // 폼과 같은 키 — 캐시를 함께 쓰고, 이 절이 마운트될 때 다시 받지 않는다(폼 로드 이펙트 재실행 방지)
  const { data: allTemplates, isLoading: isLoadingTemplates, isError: isTemplatesError } = useQuery({
    queryKey: ['templates'],
    queryFn: () => templatesApi.getAll(),
    enabled: queryEnabled,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });

  const templateInfo = useMemo(() => {
    const map = new Map<string, TemplateInfo>();
    for (const t of allTemplates ?? []) map.set(t.id, { canvasData: t.canvasData, thumbnailUrl: t.thumbnailUrl });
    return map;
  }, [allTemplates]);

  const setsById = useMemo(() => {
    const map = new Map<string, SkinCandidateSet>();
    for (const s of (allSets ?? []) as SkinCandidateSet[]) map.set(s.id, s);
    return map;
  }, [allSets]);

  const baseSet = templateSetId ? setsById.get(templateSetId) : undefined;
  const baseSiteId: string | null | undefined = baseSet ? (baseSet.siteId ?? null) : undefined;
  const templateIdsKey = templateIds.join('\n');

  const baseInput = useMemo(
    () => ({
      templateSet: {
        id: templateSetId ?? '',
        siteId: baseSiteId ?? null,
        productProfile: parseRawProfile(profileJson),
        width: Number(width),
        height: Number(height),
        bleedMm,
        cropMarkEnabled,
      },
      templateDetails: templateDetailsFor(templateIdsKey === '' ? [] : templateIdsKey.split('\n'), templateInfo),
    }),
    [templateSetId, baseSiteId, profileJson, width, height, bleedMm, cropMarkEnabled, templateIdsKey, templateInfo],
  );

  const skins: CalendarSkinDraft[] = useMemo(() => (read.kind === 'calendar' ? read.skins : []), [read]);
  const dataReady = queryEnabled && !!allSets && !!allTemplates;

  const rowErrors = useMemo(
    () => (dataReady ? skins.map((s) => skinCompatibilityErrors(baseInput, setsById.get(s.templateSetId), templateInfo)) : []),
    [dataReady, skins, baseInput, setsById, templateInfo],
  );

  const candidates = useMemo(() => {
    if (!dataReady || baseSiteId === undefined || !templateSetId) return [];
    return filterSkinCandidates(Array.from(setsById.values()), { id: templateSetId, siteId: baseSiteId }).map((set) => ({
      set,
      errors: skinCompatibilityErrors(baseInput, set, templateInfo),
    }));
  }, [dataReady, baseSiteId, templateSetId, setsById, baseInput, templateInfo]);

  const validationErrors = useMemo(() => {
    const raw = parseRawProfile(profileJson);
    return raw ? skinValidationErrors(validateProductProfile(raw)) : [];
  }, [profileJson]);

  if (!visible) return null;

  const commit = (next: CalendarSkinDraft[]) => {
    const text = writeCalendarSkins(form.getFieldValue('productProfileJson'), next);
    if (text === null) return;
    form.setFieldsValue({ productProfileJson: text });
    // 거부 Promise 가 unhandled 로 남지 않게 한다(오류 문구는 textarea 아래에 표시된다)
    form.validateFields(['productProfileJson']).catch(() => undefined);
  };

  const incompatibleCount = rowErrors.filter((e) => e.length > 0).length;

  const renderThumbs = (set: SkinCandidateSet | undefined) => {
    if (!set) return null;
    const ids = uniqueTemplateIds(set).slice(0, PREVIEW_THUMB_MAX);
    const urls = ids
      .map((id) => resolveStorageUrl(templateInfo.get(id)?.thumbnailUrl ?? undefined))
      .filter((u): u is string => !!u);
    if (urls.length === 0) return null;
    return (
      <Space size={4} wrap style={{ marginTop: 6 }} data-testid="calendar-skin-thumbs">
        {urls.map((url, i) => (
          <img
            key={`${url}-${i}`}
            src={url}
            alt=""
            style={{ height: 40, border: '1px solid #f0f0f0', borderRadius: 2, objectFit: 'contain' }}
          />
        ))}
      </Space>
    );
  };

  return (
    <div data-testid="calendar-skins-section">
      <Divider orientation="left" style={{ marginTop: 8 }}>
        캘린더 스킨(디자인 묶음)
      </Divider>
      <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 12 }}>
        스킨 세트는 이 세트와 구조가 같은 일반 캘린더 세트입니다. 이 세트의 템플릿을 복제해 디자인만 고치면 객체 id 가 유지되어
        문구·사진틀이 같은 자리로 옮겨집니다. 스킨을 둔 세트는 도구 메뉴에서 「템플릿」을 빼 두세요. 판매 중인 스킨은 고치지 말고 새
        스킨으로 등록하고, 스킨 key 는 다른 세트에 다시 쓰지 않습니다. 목록은 아래 프로파일 JSON 의 calendar.skins 에 그대로 쓰입니다.
      </Text>

      {read.kind === 'unreadable' && <Alert type="warning" showIcon message={read.reason} style={{ marginBottom: 12 }} />}

      {!templateSetId && (
        <Alert
          type="info"
          showIcon
          message="스킨 세트는 이 세트를 한 번 저장한 뒤 수정 화면에서 지정할 수 있습니다(사이트·자기 참조 검사에 저장된 세트가 필요합니다)."
          style={{ marginBottom: 12 }}
        />
      )}

      {queryEnabled && (isSetsError || isTemplatesError) && (
        <Alert
          type="error"
          showIcon
          message="템플릿셋·템플릿 목록을 불러오지 못해 스킨 호환 검사를 할 수 없습니다."
          style={{ marginBottom: 12 }}
        />
      )}
      {queryEnabled && (isLoadingSets || isLoadingTemplates) && <Spin size="small" style={{ marginBottom: 12 }} />}
      {dataReady && baseSiteId === undefined && (
        <Alert
          type="warning"
          showIcon
          message="현재 세트를 목록에서 찾지 못해 사이트를 확인할 수 없습니다. 스킨 후보를 보여 줄 수 없습니다."
          style={{ marginBottom: 12 }}
        />
      )}

      {validationErrors.length > 0 && (
        <Alert
          type="error"
          showIcon
          message="스킨 목록 형식 오류"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {validationErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          }
          style={{ marginBottom: 12 }}
        />
      )}

      {incompatibleCount > 0 && (
        <Alert
          type="warning"
          showIcon
          data-testid="calendar-skins-incompatible"
          message={`호환되지 않는 스킨 ${incompatibleCount}개`}
          description="저장은 되지만 편집기에서 그 스킨은 고를 수 없습니다(세트를 찾을 수 없거나 다른 사이트면 저장 시 서버가 거부합니다)."
          style={{ marginBottom: 12 }}
        />
      )}

      {read.kind === 'calendar' && skins.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="스킨 없음 — 고객에게 디자인 선택이 보이지 않습니다" />
      )}

      {skins.map((skin, i) => {
        const set = setsById.get(skin.templateSetId);
        const errors = rowErrors[i];
        return (
          <div
            key={`${i}-${skin.templateSetId}`}
            data-testid="calendar-skin-row"
            style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: 10, marginBottom: 8 }}
          >
            <Space wrap align="start" style={{ width: '100%' }}>
              <Text strong style={{ minWidth: 20, display: 'inline-block' }}>
                {i + 1}
              </Text>
              <Input
                aria-label="스킨 이름"
                value={skin.label}
                maxLength={CALENDAR_SKIN_LABEL_MAX}
                placeholder="고객에게 보일 이름"
                style={{ width: 220 }}
                onChange={(e) => commit(patchSkin(skins, i, { label: e.target.value }))}
              />
              <Tooltip title="세션에 기록되는 키. 판매를 시작한 뒤에는 바꾸지 마세요.">
                <Input
                  aria-label="스킨 key"
                  value={skin.key}
                  prefix="key"
                  style={{ width: 200, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
                  onChange={(e) => commit(patchSkin(skins, i, { key: e.target.value }))}
                />
              </Tooltip>
              <span data-testid="calendar-skin-target">
                {set ? <Text>{set.name}</Text> : <Tag color="red">목록에 없는 세트</Tag>}
                <Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                  {skin.templateSetId}
                </Text>
              </span>
              <Space size={4}>
                <Button
                  size="small"
                  aria-label="위로"
                  icon={<ArrowUpOutlined />}
                  disabled={i === 0}
                  onClick={() => commit(moveSkin(skins, i, i - 1))}
                />
                <Button
                  size="small"
                  aria-label="아래로"
                  icon={<ArrowDownOutlined />}
                  disabled={i === skins.length - 1}
                  onClick={() => commit(moveSkin(skins, i, i + 1))}
                />
                <Button
                  size="small"
                  danger
                  aria-label="삭제"
                  icon={<DeleteOutlined />}
                  onClick={() => commit(removeSkin(skins, i))}
                />
              </Space>
            </Space>
            {errors !== undefined &&
              (errors.length === 0 ? (
                <Tag color="green" style={{ marginTop: 6 }} data-testid="calendar-skin-compat-ok">
                  구조 호환
                </Tag>
              ) : (
                <Alert
                  type="error"
                  showIcon
                  data-testid="calendar-skin-compat-errors"
                  style={{ marginTop: 6 }}
                  message="구조 호환 검사 실패"
                  description={
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  }
                />
              ))}
            {renderThumbs(set)}
          </div>
        );
      })}

      {templateSetId && dataReady && baseSiteId !== undefined && (
        <div style={{ marginTop: 12 }}>
          <Text strong style={{ display: 'block', marginBottom: 6 }}>
            스킨 세트 후보(같은 사이트·공유 캘린더 세트 {candidates.length}개, 최대 {CALENDAR_SKIN_MAX}개 지정)
          </Text>
          {candidates.length === 0 && <Text type="secondary">후보 세트가 없습니다.</Text>}
          {candidates.map(({ set, errors }) => {
            const used = skins.some((s) => s.templateSetId === set.id);
            const disabled = used || errors.length > 0 || !canAddSkin(skins) || read.kind !== 'calendar';
            return (
              <div
                key={set.id}
                data-testid="calendar-skin-candidate"
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', borderBottom: '1px dashed #f0f0f0' }}
              >
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  disabled={disabled}
                  onClick={() => commit([...skins, skinFromTemplateSet(set, skins)])}
                >
                  추가
                </Button>
                <div style={{ flex: 1 }}>
                  <Space size={6} wrap>
                    <Text>{set.name}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {set.width} × {set.height} mm
                    </Text>
                    {(set.siteId ?? null) === null && <Tag>공유</Tag>}
                    {used && <Tag color="blue">지정됨</Tag>}
                    {errors.length === 0 ? <Tag color="green">호환</Tag> : <Tag color="red">호환 안 됨</Tag>}
                  </Space>
                  {errors.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12, color: '#cf1322' }}>
                      {errors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
