import { useState, useEffect } from 'react';
import { ThumbsUp, ThumbsDown, Sparkles as Sparkle, RefreshCw as ArrowsClockwise } from 'lucide-react';
import { TemplateSetType } from '@storige/types';
import { Button } from '../ui/button';
import {
  aiApi,
  RecommendationItem,
  RecommendationRequest,
  UserPreferenceInput,
} from '../../api/ai';

interface RecommendationPanelProps {
  templateType?: TemplateSetType;
  onSelectTemplate?: (templateSetId: string) => void;
}

/**
 * AI 템플릿 추천 패널
 */
export function RecommendationPanel({
  templateType,
  onSelectTemplate,
}: RecommendationPanelProps) {
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferenceInput>({});

  // 추천 로드
  const loadRecommendations = async (prefs?: UserPreferenceInput) => {
    setLoading(true);
    setError(null);

    try {
      const request: RecommendationRequest = {
        templateType,
        limit: 8,
        preferences: prefs || preferences,
      };

      const response = await aiApi.getRecommendations(request);
      setRecommendations(response.recommendations);
    } catch (err: any) {
      setError(err.message || '추천을 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 초기 로드
  useEffect(() => {
    loadRecommendations();
  }, [templateType]);

  // 피드백 제출
  const handleFeedback = async (
    templateSetId: string,
    type: 'like' | 'dislike',
    rank: number,
  ) => {
    try {
      await aiApi.submitFeedback({
        templateSetId,
        type,
        context: 'recommendation',
        recommendationRank: rank,
      });

      // UI 피드백 (선택사항)
      setRecommendations((prev) =>
        prev.map((item) =>
          item.templateSetId === templateSetId
            ? { ...item, userFeedback: type }
            : item,
        ) as any,
      );
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  };

  // 선호도 변경 핸들러
  const handleStyleChange = (style: string) => {
    setPreferences((prev) => {
      const styles = prev.preferredStyles || [];
      const newStyles = styles.includes(style)
        ? styles.filter((s) => s !== style)
        : [...styles, style];
      return { ...prev, preferredStyles: newStyles };
    });
  };

  const handleColorChange = (color: string) => {
    setPreferences((prev) => ({
      ...prev,
      preferredColors: { primary: color },
    }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Sparkle className="w-5 h-5 text-blue-500" />
          <h3 className="font-medium">AI 추천</h3>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreferences(!showPreferences)}
          >
            선호도 설정
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => loadRecommendations()}
            disabled={loading}
          >
            <ArrowsClockwise className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* 선호도 설정 패널 */}
      {showPreferences && (
        <div className="p-4 border-b bg-gray-50">
          <div className="space-y-4">
            {/* 스타일 선택 */}
            <div>
              <label className="text-sm font-medium text-gray-700">스타일</label>
              <div className="flex flex-wrap gap-2 mt-2">
                {['minimal', 'modern', 'elegant', 'playful'].map((style) => (
                  <button
                    key={style}
                    onClick={() => handleStyleChange(style)}
                    className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                      preferences.preferredStyles?.includes(style)
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                    }`}
                  >
                    {style === 'minimal' && '미니멀'}
                    {style === 'modern' && '모던'}
                    {style === 'elegant' && '엘레강스'}
                    {style === 'playful' && '플레이풀'}
                  </button>
                ))}
              </div>
            </div>

            {/* 색상 선택 */}
            <div>
              <label className="text-sm font-medium text-gray-700">
                선호 색상
              </label>
              <div className="flex gap-2 mt-2">
                {[
                  '#3B82F6',
                  '#EF4444',
                  '#10B981',
                  '#F59E0B',
                  '#8B5CF6',
                  '#1F2937',
                ].map((color) => (
                  <button
                    key={color}
                    onClick={() => handleColorChange(color)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      preferences.preferredColors?.primary === color
                        ? 'border-gray-900 scale-110'
                        : 'border-transparent hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            {/* 적용 버튼 */}
            <Button
              size="sm"
              onClick={() => loadRecommendations(preferences)}
              disabled={loading}
            >
              적용하기
            </Button>
          </div>
        </div>
      )}

      {/* 추천 목록 */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex items-center justify-center h-32">
            <ArrowsClockwise className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="text-center py-8 text-red-500">
            <p>{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={() => loadRecommendations()}
            >
              다시 시도
            </Button>
          </div>
        )}

        {!loading && !error && recommendations.length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p>추천 템플릿이 없습니다.</p>
          </div>
        )}

        {!loading && !error && recommendations.length > 0 && (
          <div className="grid grid-cols-2 gap-4">
            {recommendations.map((item, index) => (
              <RecommendationCard
                key={item.templateSetId}
                item={item}
                rank={index + 1}
                onSelect={() => onSelectTemplate?.(item.templateSetId)}
                onFeedback={(type) =>
                  handleFeedback(item.templateSetId, type, index + 1)
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 추천 카드 컴포넌트
 */
interface RecommendationCardProps {
  item: RecommendationItem;
  rank: number;
  onSelect: () => void;
  onFeedback: (type: 'like' | 'dislike') => void;
}

function RecommendationCard({
  item,
  rank,
  onSelect,
  onFeedback,
}: RecommendationCardProps) {
  const [feedbackGiven, setFeedbackGiven] = useState<'like' | 'dislike' | null>(
    null,
  );

  const handleFeedback = (type: 'like' | 'dislike') => {
    if (feedbackGiven === type) return;
    setFeedbackGiven(type);
    onFeedback(type);
  };

  return (
    <div className="border rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow">
      {/* 썸네일 */}
      <div
        className="aspect-[4/3] bg-gray-100 cursor-pointer relative group"
        onClick={onSelect}
      >
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            No Image
          </div>
        )}

        {/* 점수 배지 */}
        <div className="absolute top-2 right-2 bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
          {Math.round(item.score * 100)}%
        </div>

        {/* 오버레이 */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white font-medium">선택하기</span>
        </div>
      </div>

      {/* 정보 */}
      <div className="p-3">
        <h4 className="font-medium text-sm truncate">{item.name}</h4>

        {/* 추천 이유 */}
        <div className="flex flex-wrap gap-1 mt-2">
          {item.reasons.slice(0, 2).map((reason, i) => (
            <span
              key={i}
              className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded"
            >
              {reason}
            </span>
          ))}
        </div>

        {/* 피드백 버튼 */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => handleFeedback('like')}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-sm transition-colors ${
              feedbackGiven === 'like'
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleFeedback('dislike')}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-sm transition-colors ${
              feedbackGiven === 'dislike'
                ? 'bg-red-100 text-red-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
