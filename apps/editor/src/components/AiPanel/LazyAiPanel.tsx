import { lazy, Suspense } from 'react';
import type { TemplateSetType } from '@storige/types';

/**
 * AI 패널 Props
 */
interface AiPanelProps {
  templateType?: TemplateSetType;
  dimensions?: { width: number; height: number };
  onSelectTemplate?: (templateSetId: string) => void;
  onGenerated?: (templateSetId: string) => void;
}

/**
 * AI 기능 활성화 여부 (빌드 타임 상수)
 * Vite define으로 'false'가 주입되면 dead code elimination으로 AiPanel이 번들에서 제외됨
 */
const AI_ENABLED = import.meta.env.VITE_AI_ENABLED === 'true';

/**
 * Lazy loaded AI Panel
 * AI 기능이 비활성화되어 있으면 컴포넌트를 로드하지 않음 (tree-shaking)
 *
 * 중요: 환경변수를 직접 사용해야 빌드 타임에 정적 분석이 가능함
 */
const LazyAiPanelComponent = AI_ENABLED
  ? lazy(() =>
      import('./AiPanel').then((module) => ({
        default: module.AiPanel,
      })),
    )
  : null;

/**
 * 로딩 스피너
 */
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  );
}

/**
 * AI 패널 래퍼 (조건부 렌더링 + Lazy Loading)
 *
 * 사용법:
 * ```tsx
 * import { LazyAiPanel } from '@/components/AiPanel';
 *
 * // AI가 비활성화되면 null 반환
 * <LazyAiPanel
 *   templateType="book"
 *   onSelectTemplate={(id) => console.log(id)}
 * />
 * ```
 */
export function LazyAiPanel(props: AiPanelProps) {
  // AI 기능이 비활성화되어 있으면 렌더링하지 않음
  if (!LazyAiPanelComponent) {
    return null;
  }

  return (
    <Suspense fallback={<LoadingFallback />}>
      <LazyAiPanelComponent {...props} />
    </Suspense>
  );
}

/**
 * AI 기능 활성화 여부 확인 훅
 */
export function useAiEnabled(): boolean {
  return AI_ENABLED;
}
