import { useState } from 'react';
import { Sparkles as Sparkle, Wand2 as MagicWand } from 'lucide-react';
import { TemplateSetType } from '@storige/types';
import { RecommendationPanel } from './RecommendationPanel';
import { GenerationPanel } from './GenerationPanel';

interface AiPanelProps {
  templateType?: TemplateSetType;
  dimensions?: { width: number; height: number };
  onSelectTemplate?: (templateSetId: string) => void;
  onGenerated?: (templateSetId: string) => void;
}

type Tab = 'recommend' | 'generate';

/**
 * AI 기능 통합 패널
 */
export function AiPanel({
  templateType = TemplateSetType.BOOK,
  dimensions = { width: 210, height: 297 },
  onSelectTemplate,
  onGenerated,
}: AiPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('recommend');

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 탭 헤더 */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('recommend')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            activeTab === 'recommend'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <Sparkle className="w-4 h-4" />
          추천
        </button>
        <button
          onClick={() => setActiveTab('generate')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
            activeTab === 'generate'
              ? 'text-purple-600 border-b-2 border-purple-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          <MagicWand className="w-4 h-4" />
          생성
        </button>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'recommend' && (
          <RecommendationPanel
            templateType={templateType}
            onSelectTemplate={onSelectTemplate}
          />
        )}
        {activeTab === 'generate' && (
          <GenerationPanel
            defaultTemplateType={templateType}
            defaultDimensions={dimensions}
            onGenerated={onGenerated}
          />
        )}
      </div>
    </div>
  );
}
