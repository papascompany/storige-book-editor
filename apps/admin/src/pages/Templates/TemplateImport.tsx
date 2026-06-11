import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Typography,
  Card,
  Upload,
  Button,
  Descriptions,
  Alert,
  Input,
  Select,
  Segmented,
  Radio,
  Space,
  Spin,
  Tag,
  message,
} from 'antd';
import { InboxOutlined, SaveOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { convertIdmlToTemplate, convertPsdToTemplate } from '@storige/indesign-import';
import type { SpreadTemplateResult, SinglePageResult } from '@storige/indesign-import';
import { TemplateType } from '@storige/types';
import { templatesApi } from '../../api/templates';
import { categoriesApi } from '../../api/categories';
import { libraryApi } from '../../api/library';
import { resolveStorageUrl } from '../../lib/axios';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

type DesignFormat = 'idml' | 'psd';

const flattenCategories = (cats: CategoryNode[], level = 0): { label: string; value: string }[] => {
  let out: { label: string; value: string }[] = [];
  for (const c of cats) {
    out.push({ label: `${'  '.repeat(level)}${c.name}`, value: c.id });
    if (c.children?.length) out = out.concat(flattenCategories(c.children, level + 1));
  }
  return out;
};

const detectFormat = (fileName: string): DesignFormat => (/\.psd$/i.test(fileName) ? 'psd' : 'idml');

// IDML 변환 방식 3종 (spreadConfig.conversionMode 와 1:1 대응 — vector→full, hybrid→flat-spread, flat-spine→flat-spine)
type IdmlImportMode = 'vector' | 'hybrid' | 'flat-spine';

const IDML_MODE_OPTIONS: { label: string; value: IdmlImportMode }[] = [
  { label: '벡터 (전체 편집형)', value: 'vector' },
  { label: '펼침면 플랫형 (책등 고정)', value: 'hybrid' },
  { label: '책등가변 3분할 플랫형', value: 'flat-spine' },
];

const IDML_MODE_DESCRIPTIONS: Record<IdmlImportMode, string> = {
  vector:
    '도형·텍스트를 모두 편집 가능한 벡터로 추출합니다 (정밀). 단순한 디자인에 적합합니다.',
  hybrid:
    '텍스트만 편집 가능한 레이어로 두고, 나머지 디자인은 전폭 300dpi PNG 한 장으로 고정합니다. 책등 두께가 고정인 상품(페이지 수 변동 없음)에 사용하세요 — 편집기에서 책등 가변이 차단됩니다.',
  'flat-spine':
    '텍스트만 편집 가능한 레이어로 두고, 디자인을 뒷표지/책등/앞표지 3장의 300dpi PNG 로 분할 고정합니다. 책등 PNG 는 책등 중심 기준 3배폭이라 페이지 수에 따라 책등 두께가 변해도 디자인이 따라갑니다 (책등 가변 책 셋용 권장).',
};

// canvasData 객체(불투명 Record). 변환기는 배경 PNG 를 type='image', src='data:image/png;base64,...'
// 로 내보낸다(idml hybrid → id 'idml-artwork' 1장, idml flat-spine → 'spine-artwork'/'back-artwork'/'front-artwork' 3장,
// psd → id 'psd-artwork').
type CanvasObject = Record<string, unknown>;

// 객체의 src 가 base64 dataURL 인 이미지인지 판정.
const isDataUrlImage = (o: CanvasObject): o is CanvasObject & { src: string } =>
  o.type === 'image' && typeof o.src === 'string' && (o.src as string).startsWith('data:');

// base64 dataURL → File. fetch().blob() 대신 atob 로 직접 디코딩
// (대용량 PNG 에서 fetch(dataUrl) 가 일부 환경에서 느림 — editor useAutoSaveThumbnail 과 동일 패턴).
const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const match = dataUrl.match(/^data:(.+?);base64,(.*)$/);
  if (!match) throw new Error('배경 이미지 dataURL 형식을 해석할 수 없습니다.');
  const mime = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
};

/**
 * DB bloat 방지: canvasData 에 인라인된 base64 PNG 배경(들)을 스토리지에 업로드하고
 * 객체의 src 를 스토리지 URL 로 치환한 새 객체 배열을 반환한다.
 *
 * - dataURL 이미지가 없으면(순수 벡터 IDML 등) 입력 배열을 그대로 반환(업로드 0회).
 * - 여러 개여도 모두 처리 (flat-spine 의 spine/back/front 3장 포함). 순서·z-order 보존(map).
 * - 한 장이라도 업로드 실패 시 Promise.all 전체 reject → 호출자(saveMutation)가 에러를
 *   표면화하고 저장을 중단 (부분 치환된 깨진 템플릿을 저장하지 않음 — 전체 실패 처리).
 * - 저장 src 는 resolveStorageUrl 로 변환한 값: prod=절대 URL, dev=vite proxy 상대경로.
 *   resolveStorageUrl 은 http(s)/data URL 을 그대로 통과시키므로 멱등.
 */
const uploadInlineBackgrounds = async (
  objects: CanvasObject[],
  baseName: string
): Promise<CanvasObject[]> => {
  let uploadIdx = 0;
  const safeBase = (baseName || 'imported').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'imported';
  return Promise.all(
    objects.map(async (o) => {
      if (!isDataUrlImage(o)) return o;
      // 식별 가능한 파일명: 객체 id(spine-artwork 등)가 있으면 포함 (flat-spine 3장 구분에 유용)
      const idPart = typeof o.id === 'string' && o.id ? `-${(o.id as string).replace(/[^\w.-]+/g, '_').slice(0, 30)}` : '';
      const fileName = `${safeBase}${idPart}-bg-${uploadIdx++}.png`;
      const file = dataUrlToFile(o.src, fileName);
      const uploaded = await libraryApi.uploadFile(file);
      if (!uploaded?.url) throw new Error('배경 이미지 업로드 응답에 URL 이 없습니다.');
      return { ...o, src: resolveStorageUrl(uploaded.url) };
    })
  );
};

export const TemplateImport = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState<string>('');
  const [format, setFormat] = useState<DesignFormat>('idml');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [result, setResult] = useState<SpreadTemplateResult | SinglePageResult | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [mode, setMode] = useState<IdmlImportMode>('vector'); // IDML 전용
  const [pageType, setPageType] = useState<'page' | 'cover'>('page'); // PSD 전용
  const [lastFile, setLastFile] = useState<File | null>(null);
  // 등록 대상(IDML 표지 한정): 표지 단품 / 책등 가변 셋으로 이어서 등록(방법 A)
  const [registerTarget, setRegisterTarget] = useState<'template' | 'bookset'>('template');

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: categoriesApi.getTree,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const categoryOptions = useMemo(
    () => (categories ? flattenCategories(categories as unknown as CategoryNode[]) : []),
    [categories]
  );

  // 포맷별 결과 캐스팅
  const idmlResult = format === 'idml' ? (result as SpreadTemplateResult | null) : null;
  const psdResult = format === 'psd' ? (result as SinglePageResult | null) : null;

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('변환 결과가 없습니다.');
      const dto = result.draftTemplateDto;
      // 디버그 필드(_idml/_psd) 제거, meta 는 유지(책등 가변/앵커)
      const strippedObjects = dto.canvasData.objects.map((o) => {
        const { _idml, _psd, ...rest } = o as Record<string, unknown>;
        return rest;
      });
      // DB bloat 방지: 인라인 base64 PNG 배경(들)을 스토리지에 업로드하고 src 를 URL 로 치환.
      // dataURL 배경이 없으면(순수 벡터 IDML) 그대로 통과. 업로드 실패 시 throw → 저장 중단.
      const baseName = name.trim() || dto.name;
      const objects = await uploadInlineBackgrounds(strippedObjects, baseName);
      if (format === 'psd') {
        // 단일 페이지(명함/내지 단품): spreadConfig 없음
        return templatesApi.create({
          name: name.trim() || dto.name,
          categoryId,
          type: pageType === 'cover' ? TemplateType.COVER : TemplateType.PAGE,
          width: dto.width,
          height: dto.height,
          canvasData: { ...dto.canvasData, objects } as never,
          isActive: true,
        });
      }
      // IDML 표지 펼침면(spread)
      return templatesApi.create({
        name: name.trim() || dto.name,
        categoryId,
        type: TemplateType.SPREAD,
        width: dto.width,
        height: dto.height,
        canvasData: { ...dto.canvasData, objects } as never,
        spreadConfig: (dto as { spreadConfig?: unknown }).spreadConfig as never,
        isActive: true,
      });
    },
    onSuccess: () => {
      message.success('템플릿이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      // 이동은 handleSave 에서 처리
    },
    onError: (e: unknown) => {
      message.error('템플릿 저장에 실패했습니다: ' + (e instanceof Error ? e.message : '알 수 없는 오류'));
    },
  });

  const handleFile = async (
    file: File,
    opts?: { mode?: IdmlImportMode; pageType?: 'page' | 'cover' }
  ) => {
    setLastFile(file);
    setConverting(true);
    setConvertError(null);
    setResult(null);
    setPreviewSvg('');
    const fmt = detectFormat(file.name);
    setFormat(fmt);
    try {
      const baseName = file.name.replace(/\.(idml|indd|psd)$/i, '');
      const buffer = await file.arrayBuffer();
      if (fmt === 'psd') {
        const { result: r, previewSvg: svg } = await convertPsdToTemplate(buffer, {
          name: `${baseName} (가져옴)`,
          pageType: opts?.pageType ?? pageType,
          previewWidth: 1100,
        });
        setResult(r);
        setPreviewSvg(svg);
      } else {
        const { result: r, previewSvg: svg } = await convertIdmlToTemplate(buffer, {
          name: `${baseName} (가져옴)`,
          previewWidth: 1100,
          mode: opts?.mode ?? mode,
        });
        setResult(r);
        setPreviewSvg(svg);
      }
      setName(`${baseName} (가져옴)`);
      setFileName(file.name);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : '변환에 실패했습니다.');
    } finally {
      setConverting(false);
    }
  };

  const handleModeChange = (next: IdmlImportMode) => {
    setMode(next);
    if (lastFile && detectFormat(lastFile.name) === 'idml') void handleFile(lastFile, { mode: next });
  };
  const handlePageTypeChange = (next: 'page' | 'cover') => {
    setPageType(next);
    // pageType 은 저장 시 반영 — 재변환 불필요(결과 동일). 단 미리보기 라벨만 갱신.
  };

  // 저장 후 이동
  const handleSave = async () => {
    try {
      const tpl = await saveMutation.mutateAsync();
      if (format === 'idml' && registerTarget === 'bookset') {
        navigate('/template-sets/new', { state: { seedTemplateId: tpl.id } });
      } else {
        navigate(`/templates/editor?id=${tpl.id}`);
      }
    } catch {
      // onError 에서 처리
    }
  };

  const uploadProps: UploadProps = {
    accept: '.idml,.psd',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      void handleFile(file as unknown as File);
      return false; // 자동 업로드 방지(브라우저에서 직접 변환)
    },
  };

  const typeCounts = useMemo(() => {
    if (!result) return {} as Record<string, number>;
    const c: Record<string, number> = {};
    for (const o of result.draftTemplateDto.canvasData.objects) {
      const k = ((o as { _idml?: { srcType?: string } })._idml?.srcType as string) || (o as { type: string }).type;
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [result]);

  return (
    <div>
      <Space style={{ marginBottom: 16 }} align="center">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/templates')}>
          목록
        </Button>
        <Title level={2} style={{ margin: 0 }}>
          디자인 가져오기 (IDML 표지 · PSD 단품)
        </Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="InDesign 표지(IDML) 또는 Photoshop 단품 디자인(PSD)을 업로드하세요."
        description="브라우저에서 변환되어 미리보기로 확인 후 저장합니다. IDML=표지 펼침면(스프레드), PSD=단일 페이지(명함/내지 단품). 폰트는 임베드되지 않으므로 누락 폰트는 시딩/확정이 필요합니다."
      />

      {/* IDML 변환 방식(벡터/하이브리드) — 파일 선택 후 표시. PSD 는 항상 하이브리드. */}
      {format === 'idml' && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text strong>변환 방식 (IDML)</Text>
            <Segmented<IdmlImportMode>
              value={mode}
              onChange={(v) => handleModeChange(v)}
              options={IDML_MODE_OPTIONS}
            />
            <Text type="secondary">{IDML_MODE_DESCRIPTIONS[mode]}</Text>
          </Space>
        </Card>
      )}

      <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">IDML 또는 PSD 파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="ant-upload-hint">.idml — 표지 펼침면 / .psd — 단품(명함·내지). PSD 는 비텍스트=배경 PNG, 텍스트=편집 레이어로 분리됩니다.</p>
      </Dragger>

      {converting && (
        <Card style={{ marginBottom: 16, textAlign: 'center' }}>
          <Spin /> <Text style={{ marginLeft: 8 }}>변환 중…</Text>
        </Card>
      )}

      {convertError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="변환 실패" description={convertError} />
      )}

      {result && (
        <>
          <Card
            title={`미리보기 — ${fileName}`}
            style={{ marginBottom: 16 }}
            styles={{ body: { overflow: 'auto', background: '#fff' } }}
          >
            <div
              style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </Card>

          <Card title="감지된 사양" style={{ marginBottom: 16 }}>
            <Descriptions bordered size="small" column={2}>
              {idmlResult && (
                <>
                  <Descriptions.Item label="표지 한 면 (coverWidth)">{idmlResult.spec.coverWidthMm} mm</Descriptions.Item>
                  <Descriptions.Item label="표지 높이 (coverHeight)">{idmlResult.spec.coverHeightMm} mm</Descriptions.Item>
                  <Descriptions.Item label="책등 (spineWidth · 가변)">{idmlResult.spec.spineWidthMm} mm</Descriptions.Item>
                  <Descriptions.Item label="날개 (wing)">
                    {idmlResult.spec.wingEnabled ? `${idmlResult.spec.wingWidthMm} mm` : '없음'}
                  </Descriptions.Item>
                  <Descriptions.Item label="재단여백 (cutSize)">{idmlResult.spec.cutSizeMm} mm</Descriptions.Item>
                  <Descriptions.Item label="총폭 (totalWidth)">
                    <b>{idmlResult.totalWidthMm} mm</b>
                  </Descriptions.Item>
                </>
              )}
              {psdResult && (
                <>
                  <Descriptions.Item label="판형 (가로×세로)">
                    <b>{psdResult.widthMm} × {psdResult.heightMm} mm</b>
                  </Descriptions.Item>
                  <Descriptions.Item label="편집 텍스트 레이어">{psdResult.textCount} 개</Descriptions.Item>
                  <Descriptions.Item label="배경 합성 레이어">{psdResult.rasterCount} 개 → 배경 PNG 1장</Descriptions.Item>
                  <Descriptions.Item label="페이지 타입">{pageType === 'cover' ? '표지(cover)' : '내지/단품(page)'}</Descriptions.Item>
                </>
              )}
              <Descriptions.Item label="추출 객체" span={2}>
                <Space wrap>
                  <Tag color="blue">{result.draftTemplateDto.canvasData.objects.length} 개</Tag>
                  {Object.entries(typeCounts).map(([k, v]) => (
                    <Tag key={k}>
                      {k}: {v}
                    </Tag>
                  ))}
                </Space>
              </Descriptions.Item>
            </Descriptions>
          </Card>

          {result.warnings.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="검수 필요 — 변환 손실/주의 항목"
              description={
                <ul style={{ marginBottom: 0, paddingLeft: 18 }}>
                  {result.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              }
            />
          )}

          <Card title="저장">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <div>
                <Text>템플릿명</Text>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="템플릿명"
                  style={{ marginTop: 4 }}
                />
              </div>
              <div>
                <Text>카테고리</Text>
                <Select
                  value={categoryId}
                  onChange={setCategoryId}
                  options={categoryOptions}
                  placeholder="카테고리 선택 (선택)"
                  allowClear
                  style={{ width: '100%', marginTop: 4 }}
                />
              </div>

              {/* PSD: 페이지 타입 선택 */}
              {format === 'psd' && (
                <div>
                  <Text>페이지 타입</Text>
                  <Radio.Group
                    value={pageType}
                    onChange={(e) => handlePageTypeChange(e.target.value)}
                    style={{ display: 'flex', gap: 16, marginTop: 4 }}
                  >
                    <Radio value="page">내지/단품 (page)</Radio>
                    <Radio value="cover">표지 (cover)</Radio>
                  </Radio.Group>
                </div>
              )}

              {/* IDML: 등록 대상 선택 */}
              {format === 'idml' && (
                <div>
                  <Text>등록 대상</Text>
                  <Radio.Group
                    value={registerTarget}
                    onChange={(e) => setRegisterTarget(e.target.value)}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}
                  >
                    <Radio value="template">표지 템플릿만 등록 (펼침면 단품)</Radio>
                    <Radio value="bookset">책등 가변 셋으로 이어서 등록 (표지 + 내지 책)</Radio>
                  </Radio.Group>
                </div>
              )}

              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {format === 'psd'
                  ? '단일 페이지 Template 으로 생성됩니다(spread 아님). 저장 후 편집기로 이동해 텍스트 폰트·크기·효과를 확정하세요.'
                  : registerTarget === 'bookset'
                    ? '표지 Template(type=spread) 생성 후, 표지가 미리 추가된 템플릿셋 폼으로 이동합니다. 거기서 내지와 페이지 수 범위를 추가해 책등 가변 책 셋을 완성하세요.'
                    : '표지 Template(type=spread)만 생성하고 편집기로 이동합니다. 셋 구성은 추후 템플릿셋 관리에서 가능합니다.'}
              </Paragraph>
              <Button type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} onClick={handleSave}>
                {format === 'idml' && registerTarget === 'bookset' ? '저장 후 셋 등록으로 →' : '템플릿으로 저장'}
              </Button>
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};
