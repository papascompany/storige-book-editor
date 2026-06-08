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
import { convertIdmlToTemplate } from '@storige/indesign-import';
import type { SpreadTemplateResult } from '@storige/indesign-import';
import { TemplateType } from '@storige/types';
import { templatesApi } from '../../api/templates';
import { categoriesApi } from '../../api/categories';

const { Title, Text, Paragraph } = Typography;
const { Dragger } = Upload;

interface CategoryNode {
  id: string;
  name: string;
  children?: CategoryNode[];
}

const flattenCategories = (cats: CategoryNode[], level = 0): { label: string; value: string }[] => {
  let out: { label: string; value: string }[] = [];
  for (const c of cats) {
    out.push({ label: `${'  '.repeat(level)}${c.name}`, value: c.id });
    if (c.children?.length) out = out.concat(flattenCategories(c.children, level + 1));
  }
  return out;
};

export const TemplateImport = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [fileName, setFileName] = useState<string>('');
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [result, setResult] = useState<SpreadTemplateResult | null>(null);
  const [previewSvg, setPreviewSvg] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [mode, setMode] = useState<'vector' | 'hybrid'>('vector');
  const [lastFile, setLastFile] = useState<File | null>(null);
  // 등록 대상: 표지 템플릿만 / 책등 가변 셋으로 이어서 등록(방법 A — 기존 템플릿셋 폼 인계)
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

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!result) throw new Error('변환 결과가 없습니다.');
      const dto = result.draftTemplateDto;
      // 디버그 필드(_idml) 제거, meta 는 책등 가변 재배치를 위해 유지
      const objects = dto.canvasData.objects.map((o) => {
        const { _idml, ...rest } = o as Record<string, unknown>;
        return rest;
      });
      return templatesApi.create({
        name: name.trim() || dto.name,
        categoryId,
        type: TemplateType.SPREAD,
        width: dto.width,
        height: dto.height,
        canvasData: { ...dto.canvasData, objects } as never,
        spreadConfig: dto.spreadConfig as never,
        isActive: true,
      });
    },
    onSuccess: () => {
      message.success('표지 펼침면 템플릿이 생성되었습니다.');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      // 이동은 등록 대상에 따라 onClick(handleSave)에서 처리
    },
    onError: (e: unknown) => {
      message.error('템플릿 저장에 실패했습니다: ' + (e instanceof Error ? e.message : '알 수 없는 오류'));
    },
  });

  const handleFile = async (file: File, convertMode: 'vector' | 'hybrid' = mode) => {
    setLastFile(file);
    setConverting(true);
    setConvertError(null);
    setResult(null);
    setPreviewSvg('');
    try {
      const baseName = file.name.replace(/\.(idml|indd)$/i, '');
      const buffer = await file.arrayBuffer();
      const { result: r, previewSvg: svg } = await convertIdmlToTemplate(buffer, {
        name: `${baseName} (가져옴)`,
        previewWidth: 1100,
        mode: convertMode,
      });
      setResult(r);
      setPreviewSvg(svg);
      setName(`${baseName} (가져옴)`);
      setFileName(file.name);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : 'IDML 변환에 실패했습니다.');
    } finally {
      setConverting(false);
    }
  };

  const handleModeChange = (next: 'vector' | 'hybrid') => {
    setMode(next);
    // 이미 업로드한 파일이 있으면 새 모드로 재변환
    if (lastFile) void handleFile(lastFile, next);
  };

  // 저장 후 등록 대상에 따라 이동: 표지 단품→편집기 / 책등 가변 셋→템플릿셋 폼(표지 seed 인계)
  const handleSave = async () => {
    try {
      const tpl = await saveMutation.mutateAsync();
      if (registerTarget === 'bookset') {
        navigate('/template-sets/new', { state: { seedTemplateId: tpl.id } });
      } else {
        navigate(`/templates/editor?id=${tpl.id}`);
      }
    } catch {
      // 실패 메시지는 saveMutation.onError 에서 처리됨
    }
  };

  const uploadProps: UploadProps = {
    accept: '.idml',
    multiple: false,
    showUploadList: false,
    beforeUpload: (file) => {
      void handleFile(file as unknown as File);
      return false; // 자동 업로드 방지 (브라우저에서 직접 변환)
    },
  };

  const spec = result?.spec;
  const typeCounts = useMemo(() => {
    if (!result) return {} as Record<string, number>;
    const c: Record<string, number> = {};
    for (const o of result.draftTemplateDto.canvasData.objects) {
      const k = (o._idml?.srcType as string) || o.type;
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
          IDML 가져오기 (표지 펼침면)
        </Title>
      </Space>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="InDesign 표지 펼침면을 IDML 로 내보낸 뒤 업로드하세요."
        description="브라우저에서 변환되어 미리보기로 확인 후 저장합니다. INDD 는 InDesign 에서 '내보내기 > IDML' 로 변환해 주세요. 폰트는 임베드되지 않으므로 누락 폰트는 시딩이 필요합니다."
      />

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text strong>변환 방식</Text>
          <Segmented<'vector' | 'hybrid'>
            value={mode}
            onChange={(v) => handleModeChange(v)}
            options={[
              { label: '벡터 (정밀 편집)', value: 'vector' },
              { label: '하이브리드 (텍스트만 편집·디자인 300dpi)', value: 'hybrid' },
            ]}
          />
          <Text type="secondary">
            {mode === 'vector'
              ? '도형·텍스트를 모두 편집 가능한 벡터로 추출합니다 (정밀). 단순한 디자인에 적합합니다.'
              : '텍스트만 편집 가능한 레이어로 두고, 나머지 디자인(도형·배경·효과)은 300dpi PNG 한 장으로 고정합니다. 효과·그라디언트·별색이 많은 복잡한 디자인에 권장합니다.'}
          </Text>
        </Space>
      </Card>

      <Dragger {...uploadProps} style={{ marginBottom: 16 }}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">IDML 파일을 끌어다 놓거나 클릭하여 선택</p>
        <p className="ant-upload-hint">.idml — 표지 펼침면(앞표지 + 책등 + 뒤표지)</p>
      </Dragger>

      {converting && (
        <Card style={{ marginBottom: 16, textAlign: 'center' }}>
          <Spin /> <Text style={{ marginLeft: 8 }}>변환 중…</Text>
        </Card>
      )}

      {convertError && (
        <Alert type="error" showIcon style={{ marginBottom: 16 }} message="변환 실패" description={convertError} />
      )}

      {result && spec && (
        <>
          <Card
            title={`미리보기 — ${fileName}`}
            style={{ marginBottom: 16 }}
            styles={{ body: { overflow: 'auto', background: '#fff' } }}
          >
            <div
              style={{ width: '100%', maxWidth: 1100, margin: '0 auto' }}
              // 변환 결과 SVG (내부 생성, 신뢰됨)
              dangerouslySetInnerHTML={{ __html: previewSvg }}
            />
          </Card>

          <Card title="감지된 사양" style={{ marginBottom: 16 }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="표지 한 면 (coverWidth)">{spec.coverWidthMm} mm</Descriptions.Item>
              <Descriptions.Item label="표지 높이 (coverHeight)">{spec.coverHeightMm} mm</Descriptions.Item>
              <Descriptions.Item label="책등 (spineWidth · 가변)">{spec.spineWidthMm} mm</Descriptions.Item>
              <Descriptions.Item label="날개 (wing)">
                {spec.wingEnabled ? `${spec.wingWidthMm} mm` : '없음'}
              </Descriptions.Item>
              <Descriptions.Item label="재단여백 (cutSize)">{spec.cutSizeMm} mm</Descriptions.Item>
              <Descriptions.Item label="총폭 (totalWidth)">
                <b>{result.totalWidthMm} mm</b>
              </Descriptions.Item>
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
              <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {registerTarget === 'bookset'
                  ? '표지 Template(type=spread) 생성 후, 표지가 미리 추가된 템플릿셋 폼으로 이동합니다. 거기서 내지(page) 템플릿과 페이지 수 범위를 추가해 책등 가변 책 셋을 완성하세요. (책등 가변은 런타임 자동 작동)'
                  : '표지 Template(type=spread)만 생성하고 편집기로 이동합니다. 셋 구성은 추후 템플릿셋 관리에서 가능합니다.'}
              </Paragraph>
              <Button
                type="primary"
                icon={<SaveOutlined />}
                loading={saveMutation.isPending}
                onClick={handleSave}
              >
                {registerTarget === 'bookset' ? '저장 후 셋 등록으로 →' : '템플릿으로 저장'}
              </Button>
            </Space>
          </Card>
        </>
      )}
    </div>
  );
};
