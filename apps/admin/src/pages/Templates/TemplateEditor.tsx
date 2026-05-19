import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, message, Modal, Form, Input, Select, InputNumber, Space, Spin, Switch, Divider } from 'antd';
import { ArrowLeftOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';
import { computeSpreadDimensions, normalizeSpreadSpec } from '@storige/types';

const { Option } = Select;

// 템플릿 타입 (인쇄 워크플로우 v1 Phase 3, 2026-05-19: endpaper 추가)
type TemplateType = 'wing' | 'cover' | 'spine' | 'page' | 'spread' | 'endpaper';

// PostMessage 이벤트 타입
interface TemplateEditorMessage {
  type: 'TEMPLATE_SAVED' | 'TEMPLATE_CLOSED' | 'TEMPLATE_READY';
  payload?: {
    templateId?: string;
    success?: boolean;
    error?: string;
  };
}

// 템플릿 설정 폼 타입
interface TemplateConfig {
  name: string;
  type: TemplateType;
  width: number;
  height: number;
}

// 스프레드 최소 설정 타입
interface SpreadMinimalConfig {
  coverWidthMm: number;
  coverHeightMm: number;
  wingEnabled: boolean;
  wingWidthMm: number;
  initialSpineWidthMm?: number;
}

// 에디터 URL
const EDITOR_URL = import.meta.env.VITE_EDITOR_URL || 'http://localhost:3000';

export const TemplateEditor = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { accessToken } = useAuthStore();

  // URL에서 templateId 가져오기 (편집 모드)
  const templateId = searchParams.get('id');

  // 상태
  const [configModalVisible, setConfigModalVisible] = useState(!templateId);
  const [spreadConfigModalVisible, setSpreadConfigModalVisible] = useState(false);
  const [editorLoading, setEditorLoading] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [templateConfig, setTemplateConfig] = useState<TemplateConfig | null>(null);
  const [spreadConfig, setSpreadConfig] = useState<SpreadMinimalConfig | null>(null);
  const [selectedType, setSelectedType] = useState<TemplateType>('page');

  // 폼 인스턴스
  const [form] = Form.useForm();
  const [spreadForm] = Form.useForm();

  // iframe으로 보낼 URL 생성
  const getEditorUrl = useCallback((config?: TemplateConfig, spread?: SpreadMinimalConfig) => {
    const params = new URLSearchParams();

    if (templateId) {
      params.set('templateId', templateId);
    }

    if (config) {
      params.set('name', config.name);
      params.set('type', config.type);

      if (config.type === 'spread' && spread) {
        // spread일 때는 width/height를 URL에 넣지 않음 (spec이 권위)
        params.set('mode', 'spread');
        params.set('spec', JSON.stringify(spread));
      } else {
        // 일반 타입은 width/height 전달
        params.set('width', config.width.toString());
        params.set('height', config.height.toString());
      }
    }

    if (accessToken) {
      params.set('token', accessToken);
    }

    return `${EDITOR_URL}/template?${params.toString()}`;
  }, [templateId, accessToken]);

  // PostMessage 핸들러
  useEffect(() => {
    const handleMessage = (event: MessageEvent<TemplateEditorMessage>) => {
      // 에디터 origin 확인
      // 상대 경로인 경우 현재 origin과 비교, 절대 URL인 경우 해당 host와 비교
      const isValidOrigin = (() => {
        if (event.origin.includes('localhost:3000')) return true;
        if (EDITOR_URL.startsWith('/')) {
          // 상대 경로: 같은 origin에서 로드됨
          return event.origin === window.location.origin;
        }
        try {
          return event.origin.includes(new URL(EDITOR_URL).host);
        } catch {
          return false;
        }
      })();

      if (!isValidOrigin) {
        return;
      }

      const { type, payload } = event.data;

      switch (type) {
        case 'TEMPLATE_READY':
          console.log('[TemplateEditor] Editor ready');
          setEditorLoading(false);
          setEditorReady(true);
          break;

        case 'TEMPLATE_SAVED':
          if (payload?.success) {
            message.success('템플릿이 저장되었습니다.');
            // 템플릿 목록 캐시 무효화
            queryClient.invalidateQueries({ queryKey: ['templates'] });
            navigate('/templates');
          } else {
            message.error(payload?.error || '템플릿 저장에 실패했습니다.');
          }
          break;

        case 'TEMPLATE_CLOSED':
          // 템플릿 목록 캐시 무효화 (변경사항이 있을 수 있음)
          queryClient.invalidateQueries({ queryKey: ['templates'] });
          navigate('/templates');
          break;

        default:
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigate, queryClient]);

  // 설정 모달 확인
  const handleConfigSubmit = async () => {
    try {
      const values = await form.validateFields();

      // spread 타입인 경우 추가 설정 모달 표시
      if (values.type === 'spread') {
        setTemplateConfig(values);
        setConfigModalVisible(false);
        setSpreadConfigModalVisible(true);
      } else {
        setTemplateConfig(values);
        setConfigModalVisible(false);
      }
    } catch (error) {
      console.error('Form validation failed:', error);
    }
  };

  // 스프레드 설정 모달 확인
  const handleSpreadConfigSubmit = async () => {
    try {
      const values = await spreadForm.validateFields();
      setSpreadConfig(values);
      setSpreadConfigModalVisible(false);
    } catch (error) {
      console.error('Spread form validation failed:', error);
    }
  };

  // 스프레드 설정 모달 취소
  const handleSpreadConfigCancel = () => {
    setSpreadConfigModalVisible(false);
    setConfigModalVisible(true); // 다시 기본 설정 모달로
  };

  // 설정 모달 취소
  const handleConfigCancel = () => {
    navigate('/templates');
  };

  // 뒤로가기
  const handleBack = () => {
    Modal.confirm({
      title: '에디터를 닫으시겠습니까?',
      content: '저장하지 않은 변경사항은 사라집니다.',
      okText: '닫기',
      cancelText: '취소',
      onOk: () => navigate('/templates'),
    });
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <div
        style={{
          height: 48,
          padding: '0 16px',
          display: 'flex',
          alignItems: 'center',
          borderBottom: '1px solid #f0f0f0',
          background: '#fff',
        }}
      >
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          style={{ marginRight: 16 }}
        >
          템플릿 목록
        </Button>
        <span style={{ fontWeight: 500 }}>
          {templateId ? '템플릿 편집' : '새 템플릿 생성'}
        </span>
        {templateConfig && (
          <span style={{ marginLeft: 16, color: '#888' }}>
            {templateConfig.type === 'spread'
              ? (spreadConfig ? (() => {
                  const spec = normalizeSpreadSpec(spreadConfig);
                  const dims = computeSpreadDimensions(spec);
                  return `spread | ${dims.totalWidthMm} × ${dims.totalHeightMm} mm (표지 ${spreadConfig.coverWidthMm}×${spreadConfig.coverHeightMm})`;
                })() : 'spread | 설정 중...')
              : `${templateConfig.type} | ${templateConfig.width} × ${templateConfig.height} mm`}
          </span>
        )}
      </div>

      {/* 에디터 iframe */}
      <div style={{ flex: 1, position: 'relative' }}>
        {/* 로딩 오버레이 */}
        {editorLoading && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#f5f5f5',
              zIndex: 10,
            }}
          >
            <Space direction="vertical" align="center">
              <Spin size="large" />
              <span>에디터를 로딩하는 중...</span>
            </Space>
          </div>
        )}

        {/* iframe - 설정이 완료되었거나 편집 모드일 때만 표시 */}
        {/* spread 타입은 spreadConfig까지 완료되어야 iframe 렌더링 */}
        {((templateConfig && (templateConfig.type !== 'spread' || spreadConfig)) || templateId) && (
          <iframe
            ref={iframeRef}
            src={getEditorUrl(
              templateConfig || undefined,
              templateConfig?.type === 'spread' ? spreadConfig || undefined : undefined
            )}
            style={{
              width: '100%',
              height: '100%',
              border: 'none',
              visibility: editorReady ? 'visible' : 'hidden',
            }}
            title="Template Editor"
            allow="clipboard-read; clipboard-write"
          />
        )}
      </div>

      {/* 설정 모달 (새 템플릿 생성 시) */}
      <Modal
        title="새 템플릿 설정"
        open={configModalVisible}
        onOk={handleConfigSubmit}
        onCancel={handleConfigCancel}
        okText={selectedType === 'spread' ? '다음' : '에디터 열기'}
        cancelText="취소"
        maskClosable={false}
        closable={false}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: '새 템플릿',
            type: 'page',
            width: 210,
            height: 297,
          }}
        >
          <Form.Item
            name="name"
            label="템플릿 이름"
            rules={[{ required: true, message: '템플릿 이름을 입력해주세요' }]}
          >
            <Input placeholder="템플릿 이름" />
          </Form.Item>

          <Form.Item
            name="type"
            label="템플릿 타입"
            rules={[{ required: true, message: '템플릿 타입을 선택해주세요' }]}
          >
            <Select onChange={(value: TemplateType) => {
              setSelectedType(value);
              if (value === 'spread' || form.getFieldValue('type') === 'spread') {
                form.resetFields(['width', 'height']);
              }
            }}>
              <Option value="page">내지 (Page)</Option>
              <Option value="cover">표지 (Cover)</Option>
              <Option value="spine">책등 (Spine)</Option>
              <Option value="wing">날개 (Wing)</Option>
              <Option value="spread">스프레드 (Spread) - 책모드용</Option>
              <Option value="endpaper">면지 (EndPaper) - 표지 안쪽/뒷표지 안쪽</Option>
            </Select>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.type !== curr.type}>
            {({ getFieldValue }) =>
              getFieldValue('type') !== 'spread' && (
                <Space size="middle" style={{ display: 'flex' }}>
                  <Form.Item
                    name="width"
                    label="가로 (mm)"
                    rules={[{ required: true, message: '가로 크기를 입력해주세요' }]}
                  >
                    <InputNumber min={10} max={1000} style={{ width: 120 }} />
                  </Form.Item>

                  <Form.Item
                    name="height"
                    label="세로 (mm)"
                    rules={[{ required: true, message: '세로 크기를 입력해주세요' }]}
                  >
                    <InputNumber min={10} max={1000} style={{ width: 120 }} />
                  </Form.Item>
                </Space>
              )
            }
          </Form.Item>

          <div style={{ color: '#888', fontSize: 12, marginTop: 8 }}>
            일반적인 판형:
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li>A4: 210 × 297 mm</li>
              <li>A5: 148 × 210 mm</li>
              <li>B5: 176 × 250 mm</li>
              <li>46배판: 188 × 257 mm</li>
            </ul>
          </div>
        </Form>
      </Modal>

      {/* 스프레드 최소 설정 모달 */}
      <Modal
        title="스프레드 템플릿 설정"
        open={spreadConfigModalVisible}
        onOk={handleSpreadConfigSubmit}
        onCancel={handleSpreadConfigCancel}
        okText="에디터 열기"
        cancelText="뒤로"
        maskClosable={false}
        width={600}
      >
        <Form
          form={spreadForm}
          layout="vertical"
          initialValues={{
            coverWidthMm: 210,
            coverHeightMm: 297,
            wingEnabled: true,
            wingWidthMm: 60,
            initialSpineWidthMm: undefined,
          }}
        >
          <Divider orientation="left">표지 크기</Divider>
          <Space size="middle" style={{ display: 'flex' }}>
            <Form.Item
              name="coverWidthMm"
              label="표지 가로 (mm)"
              rules={[{ required: true, message: '표지 가로를 입력해주세요' }]}
            >
              <InputNumber min={50} max={1000} style={{ width: 150 }} />
            </Form.Item>

            <Form.Item
              name="coverHeightMm"
              label="표지 세로 (mm)"
              rules={[{ required: true, message: '표지 세로를 입력해주세요' }]}
            >
              <InputNumber min={50} max={1000} style={{ width: 150 }} />
            </Form.Item>
          </Space>

          <Divider orientation="left">날개 설정</Divider>
          <Form.Item
            name="wingEnabled"
            label="날개 포함"
            valuePropName="checked"
          >
            <Switch checkedChildren="포함" unCheckedChildren="제외" />
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prev, curr) => prev.wingEnabled !== curr.wingEnabled}>
            {({ getFieldValue }) =>
              getFieldValue('wingEnabled') && (
                <Form.Item
                  name="wingWidthMm"
                  label="날개 너비 (mm)"
                  rules={[
                    { required: true, message: '날개 너비를 입력해주세요' },
                    { type: 'number', min: 30, max: 200, message: '30~200mm 사이로 입력해주세요' },
                  ]}
                >
                  <InputNumber min={30} max={200} style={{ width: 150 }} />
                </Form.Item>
              )
            }
          </Form.Item>

          <Divider orientation="left">책등 설정 (선택)</Divider>
          <Form.Item
            name="initialSpineWidthMm"
            label="초기 책등 너비 (mm)"
            extra="입력하지 않으면 상품 스펙에서 자동 계산됩니다"
          >
            <InputNumber min={1} max={100} style={{ width: 150 }} placeholder="자동 계산" />
          </Form.Item>

          <div style={{ color: '#888', fontSize: 12, marginTop: 16 }}>
            <strong>참고:</strong>
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li>스프레드 템플릿은 책모드 전용입니다</li>
              <li>표지 크기는 상품 스펙과 일치해야 합니다</li>
              <li>책등 너비는 내지 페이지 수에 따라 동적으로 변경됩니다</li>
            </ul>
          </div>
        </Form>
      </Modal>
    </div>
  );
};
