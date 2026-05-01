import { useState, useEffect, useRef } from 'react';
import { Wand2 as MagicWand, Loader as CircleNotch, Check, X, RefreshCw as ArrowsClockwise } from 'lucide-react';
import { TemplateSetType } from '@storige/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  aiApi,
  GenerationRequest,
  GenerationStatus,
  GenerationStatusResponse,
} from '../../api/ai';

interface GenerationPanelProps {
  defaultDimensions?: { width: number; height: number };
  defaultTemplateType?: TemplateSetType;
  onGenerated?: (templateSetId: string) => void;
}

type StyleOption = 'minimal' | 'modern' | 'elegant' | 'playful' | 'professional';

const STYLE_OPTIONS: { value: StyleOption; label: string }[] = [
  { value: 'minimal', label: '미니멀' },
  { value: 'modern', label: '모던' },
  { value: 'elegant', label: '엘레강스' },
  { value: 'playful', label: '플레이풀' },
  { value: 'professional', label: '프로페셔널' },
];

const COLOR_SCHEMES = [
  { value: 'blue', label: '블루', color: '#3B82F6' },
  { value: 'green', label: '그린', color: '#10B981' },
  { value: 'red', label: '레드', color: '#EF4444' },
  { value: 'purple', label: '퍼플', color: '#8B5CF6' },
  { value: 'orange', label: '오렌지', color: '#F59E0B' },
  { value: 'monochrome', label: '모노크롬', color: '#1F2937' },
];

const PAGE_COUNT_OPTIONS = [4, 8, 12, 16, 20, 24, 32];

/**
 * AI 템플릿 생성 패널
 */
export function GenerationPanel({
  defaultDimensions = { width: 210, height: 297 },
  defaultTemplateType = TemplateSetType.BOOK,
  onGenerated,
}: GenerationPanelProps) {
  // 입력 상태
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<StyleOption>('modern');
  const [colorScheme, setColorScheme] = useState('blue');
  const [pageCount, setPageCount] = useState(12);
  const [includeImages, setIncludeImages] = useState(true);

  // 생성 상태
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [status, setStatus] = useState<GenerationStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 폴링 참조
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // 클린업
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  // 생성 시작
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('생성할 템플릿에 대해 설명해주세요.');
      return;
    }

    setError(null);

    try {
      const request: GenerationRequest = {
        prompt: prompt.trim(),
        options: {
          templateType: defaultTemplateType,
          pageCount,
          style,
          colorScheme,
          dimensions: defaultDimensions,
          includeImages,
        },
      };

      const response = await aiApi.startGeneration(request);
      setGenerationId(response.generationId);

      // 상태 폴링 시작
      startPolling(response.generationId);
    } catch (err: any) {
      setError(err.message || '생성을 시작할 수 없습니다.');
    }
  };

  // 상태 폴링
  const startPolling = (id: string) => {
    // 기존 폴링 정리
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    // 즉시 한 번 조회
    pollStatus(id);

    // 2초마다 폴링
    pollingRef.current = setInterval(() => {
      pollStatus(id);
    }, 2000);
  };

  const pollStatus = async (id: string) => {
    try {
      const statusResponse = await aiApi.getGenerationStatus(id);
      setStatus(statusResponse);

      // 완료 또는 실패 시 폴링 중지
      if (
        statusResponse.status === 'completed' ||
        statusResponse.status === 'failed'
      ) {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }

        if (statusResponse.status === 'failed') {
          setError(statusResponse.errorMessage || '생성에 실패했습니다.');
        }
      }
    } catch (err) {
      console.error('Failed to poll status:', err);
    }
  };

  // 결과 수락
  const handleAccept = async () => {
    if (!generationId) return;

    try {
      const result = await aiApi.acceptGeneration(generationId, {
        rating: 5,
      });
      onGenerated?.(result.templateSetId);
      resetState();
    } catch (err: any) {
      setError(err.message || '수락에 실패했습니다.');
    }
  };

  // 결과 거절
  const handleReject = async () => {
    if (!generationId) return;

    try {
      await aiApi.rejectGeneration(generationId, {});
      resetState();
    } catch (err: any) {
      setError(err.message || '거절에 실패했습니다.');
    }
  };

  // 상태 초기화
  const resetState = () => {
    setGenerationId(null);
    setStatus(null);
    setError(null);
    setPrompt('');
  };

  // 진행 중인지 확인
  const isGenerating =
    generationId &&
    status &&
    !['completed', 'failed'].includes(status.status);

  const isCompleted = status?.status === 'completed';

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center gap-2 p-4 border-b">
        <MagicWand className="w-5 h-5 text-purple-500" />
        <h3 className="font-medium">AI 템플릿 생성</h3>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* 생성 완료 상태 */}
        {isCompleted && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h4 className="font-medium text-lg">생성 완료!</h4>
              <p className="text-gray-500 text-sm mt-1">
                템플릿이 성공적으로 생성되었습니다.
              </p>
            </div>

            {/* 미리보기 */}
            {status.thumbnailUrl && (
              <div className="aspect-[4/3] bg-gray-100 rounded-lg overflow-hidden">
                <img
                  src={status.thumbnailUrl}
                  alt="Generated template"
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* 액션 버튼 */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleReject}
              >
                <X className="w-4 h-4 mr-2" />
                다시 생성
              </Button>
              <Button className="flex-1" onClick={handleAccept}>
                <Check className="w-4 h-4 mr-2" />
                사용하기
              </Button>
            </div>
          </div>
        )}

        {/* 생성 진행 중 */}
        {isGenerating && (
          <div className="space-y-6">
            <div className="text-center py-8">
              <CircleNotch className="w-12 h-12 animate-spin text-purple-500 mx-auto" />
              <h4 className="font-medium mt-4">{status?.statusMessage}</h4>
              <p className="text-gray-500 text-sm mt-1">
                잠시만 기다려주세요...
              </p>
            </div>

            {/* 진행률 바 */}
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">진행률</span>
                <span className="font-medium">{status?.progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-500 transition-all duration-500"
                  style={{ width: `${status?.progress}%` }}
                />
              </div>
            </div>

            {/* 단계 표시 */}
            <div className="space-y-2">
              <StepIndicator
                label="레이아웃 생성"
                status={getStepStatus('layout', status?.status)}
              />
              <StepIndicator
                label="이미지 생성"
                status={getStepStatus('images', status?.status)}
              />
              <StepIndicator
                label="템플릿 조립"
                status={getStepStatus('assembly', status?.status)}
              />
            </div>
          </div>
        )}

        {/* 입력 폼 */}
        {!isGenerating && !isCompleted && (
          <div className="space-y-6">
            {/* 프롬프트 입력 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                어떤 템플릿을 만들어드릴까요?
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="예: IT 스타트업 회사 소개서, 미니멀하고 현대적인 느낌으로"
                className="w-full h-24 px-3 py-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            {/* 스타일 선택 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                스타일
              </label>
              <div className="flex flex-wrap gap-2">
                {STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setStyle(option.value)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      style === option.value
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 색상 테마 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                색상 테마
              </label>
              <div className="flex flex-wrap gap-2">
                {COLOR_SCHEMES.map((scheme) => (
                  <button
                    key={scheme.value}
                    onClick={() => setColorScheme(scheme.value)}
                    className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      colorScheme === scheme.value
                        ? 'border-gray-900 bg-gray-100'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: scheme.color }}
                    />
                    {scheme.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 페이지 수 */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                페이지 수
              </label>
              <div className="flex flex-wrap gap-2">
                {PAGE_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    onClick={() => setPageCount(count)}
                    className={`w-10 h-10 text-sm rounded-lg border transition-colors ${
                      pageCount === count
                        ? 'bg-purple-500 text-white border-purple-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-purple-300'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>

            {/* 이미지 포함 여부 */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeImages"
                checked={includeImages}
                onChange={(e) => setIncludeImages(e.target.checked)}
                className="w-4 h-4 text-purple-500 rounded focus:ring-purple-500"
              />
              <label
                htmlFor="includeImages"
                className="text-sm text-gray-700"
              >
                AI 이미지 자동 생성 포함
              </label>
            </div>

            {/* 에러 표시 */}
            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">
                {error}
              </div>
            )}

            {/* 생성 버튼 */}
            <Button
              className="w-full"
              size="lg"
              onClick={handleGenerate}
              disabled={!prompt.trim()}
            >
              <MagicWand className="w-5 h-5 mr-2" />
              템플릿 생성하기
            </Button>

            {/* 안내 문구 */}
            <p className="text-xs text-gray-400 text-center">
              생성에는 약 30초~1분이 소요됩니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 단계 인디케이터
 */
function StepIndicator({
  label,
  status,
}: {
  label: string;
  status: 'pending' | 'active' | 'completed';
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center ${
          status === 'completed'
            ? 'bg-green-500'
            : status === 'active'
            ? 'bg-purple-500'
            : 'bg-gray-200'
        }`}
      >
        {status === 'completed' ? (
          <Check className="w-4 h-4 text-white" />
        ) : status === 'active' ? (
          <CircleNotch className="w-4 h-4 text-white animate-spin" />
        ) : (
          <div className="w-2 h-2 bg-gray-400 rounded-full" />
        )}
      </div>
      <span
        className={`text-sm ${
          status === 'pending' ? 'text-gray-400' : 'text-gray-700'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * 현재 상태를 기반으로 단계 상태 반환
 */
function getStepStatus(
  step: string,
  currentStatus?: GenerationStatus,
): 'pending' | 'active' | 'completed' {
  const steps = ['layout', 'images', 'assembly', 'completed'];
  const currentIndex = steps.indexOf(currentStatus || 'pending');
  const stepIndex = steps.indexOf(step);

  if (stepIndex < currentIndex) return 'completed';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}
