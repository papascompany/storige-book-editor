import { memo, useState, useCallback, useMemo } from 'react'
import { X, Eye, EyeOff as EyeSlash, Settings as GearSix, Calculator } from 'lucide-react'
import {
  PaperType,
  BindingType,
  calculateSpineWidth,
} from '@storige/types'
import { SpinePreview } from './SpinePreview'
import { SpineSettings } from './SpineSettings'
import { SpineCalculator } from './SpineCalculator'
import { cn } from '@/lib/utils'

interface SpineEditorProps {
  /**
   * 표지 너비 (mm)
   */
  coverWidth: number
  /**
   * 표지 높이 (mm)
   */
  coverHeight: number
  /**
   * 초기 페이지 수
   */
  initialPageCount?: number
  /**
   * 초기 종이 타입
   */
  initialPaperType?: PaperType
  /**
   * 초기 제본 방식
   */
  initialBindingType?: BindingType
  /**
   * 최소 페이지 수
   */
  minPages?: number
  /**
   * 최대 페이지 수
   */
  maxPages?: number
  /**
   * 페이지 간격
   */
  pageInterval?: number
  /**
   * 앞표지 썸네일 URL
   */
  frontCoverUrl?: string
  /**
   * 뒤표지 썸네일 URL
   */
  backCoverUrl?: string
  /**
   * 책등 썸네일 URL
   */
  spineUrl?: string
  /**
   * 블리드 크기 (mm)
   */
  bleed?: number
  /**
   * 책등 폭 변경 콜백
   */
  onSpineWidthChange?: (width: number) => void
  /**
   * 닫기 콜백
   */
  onClose?: () => void
  className?: string
}

type TabType = 'preview' | 'settings' | 'calculator'

/**
 * 책등 편집 뷰 컴포넌트
 */
export const SpineEditor = memo(function SpineEditor({
  coverWidth,
  coverHeight,
  initialPageCount = 32,
  initialPaperType = PaperType.MOJO_80G,
  initialBindingType = BindingType.PERFECT,
  minPages = 4,
  maxPages = 500,
  pageInterval = 4,
  frontCoverUrl,
  backCoverUrl,
  spineUrl,
  bleed = 3,
  onSpineWidthChange,
  onClose,
  className,
}: SpineEditorProps) {
  const [activeTab, setActiveTab] = useState<TabType>('preview')
  const [showGuidelines, setShowGuidelines] = useState(true)

  // 책등 설정 상태
  const [pageCount, setPageCount] = useState(initialPageCount)
  const [paperType, setPaperType] = useState(initialPaperType)
  const [bindingType, setBindingType] = useState(initialBindingType)

  // 책등 폭 계산
  const spineResult = useMemo(() => {
    return calculateSpineWidth({
      pageCount,
      paperType,
      bindingType,
    })
  }, [pageCount, paperType, bindingType])

  // 설정 변경 핸들러
  const handlePageCountChange = useCallback((count: number) => {
    setPageCount(count)
    const result = calculateSpineWidth({
      pageCount: count,
      paperType,
      bindingType,
    })
    onSpineWidthChange?.(result.spineWidth)
  }, [paperType, bindingType, onSpineWidthChange])

  const handlePaperTypeChange = useCallback((type: PaperType) => {
    setPaperType(type)
    const result = calculateSpineWidth({
      pageCount,
      paperType: type,
      bindingType,
    })
    onSpineWidthChange?.(result.spineWidth)
  }, [pageCount, bindingType, onSpineWidthChange])

  const handleBindingTypeChange = useCallback((type: BindingType) => {
    setBindingType(type)
    const result = calculateSpineWidth({
      pageCount,
      paperType,
      bindingType: type,
    })
    onSpineWidthChange?.(result.spineWidth)
  }, [pageCount, paperType, onSpineWidthChange])

  return (
    <div className={cn('flex flex-col h-full bg-gray-100', className)}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-gray-900">책등 편집</h2>
          <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
            {spineResult.spineWidth.toFixed(2)}mm
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuidelines(!showGuidelines)}
            className={cn(
              'p-2 rounded-lg transition-colors',
              showGuidelines
                ? 'bg-blue-100 text-blue-600'
                : 'text-gray-500 hover:bg-gray-100'
            )}
            title={showGuidelines ? '가이드라인 숨기기' : '가이드라인 표시'}
          >
            {showGuidelines ? <Eye className="w-5 h-5" /> : <EyeSlash className="w-5 h-5" />}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
              title="닫기"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex bg-white border-b">
        <TabButton
          active={activeTab === 'preview'}
          onClick={() => setActiveTab('preview')}
          icon={<Eye className="w-4 h-4" />}
          label="미리보기"
        />
        <TabButton
          active={activeTab === 'settings'}
          onClick={() => setActiveTab('settings')}
          icon={<GearSix className="w-4 h-4" />}
          label="설정"
        />
        <TabButton
          active={activeTab === 'calculator'}
          onClick={() => setActiveTab('calculator')}
          icon={<Calculator className="w-4 h-4" />}
          label="계산"
        />
      </div>

      {/* 콘텐츠 */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'preview' && (
          <div className="flex justify-center items-center h-full">
            <SpinePreview
              frontCoverUrl={frontCoverUrl}
              backCoverUrl={backCoverUrl}
              spineUrl={spineUrl}
              coverWidth={coverWidth}
              coverHeight={coverHeight}
              spineWidth={spineResult.spineWidth}
              bleed={bleed}
              showGuidelines={showGuidelines}
            />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-md mx-auto">
            <SpineSettings
              pageCount={pageCount}
              paperType={paperType}
              bindingType={bindingType}
              onPageCountChange={handlePageCountChange}
              onPaperTypeChange={handlePaperTypeChange}
              onBindingTypeChange={handleBindingTypeChange}
              minPages={minPages}
              maxPages={maxPages}
              pageInterval={pageInterval}
            />
          </div>
        )}

        {activeTab === 'calculator' && (
          <div className="max-w-md mx-auto">
            <SpineCalculator
              pageCount={pageCount}
              paperType={paperType}
              bindingType={bindingType}
              showDetails={true}
            />
          </div>
        )}
      </div>

      {/* 푸터 - 현재 설정 요약 */}
      <div className="px-4 py-3 bg-white border-t">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center gap-4">
            <span>{pageCount}페이지</span>
            <span className="text-gray-300">|</span>
            <span>
              {paperType === PaperType.MOJO_70G && '모조지 70g'}
              {paperType === PaperType.MOJO_80G && '모조지 80g'}
              {paperType === PaperType.SEOKJI_70G && '서적지 70g'}
              {paperType === PaperType.NEWSPRINT_45G && '신문지 45g'}
              {paperType === PaperType.ART_200G && '아트지 200g'}
              {paperType === PaperType.MATTE_200G && '매트지 200g'}
              {paperType === PaperType.CARD_300G && '카드지 300g'}
              {paperType === PaperType.KRAFT_120G && '크라프트지 120g'}
            </span>
            <span className="text-gray-300">|</span>
            <span>
              {bindingType === BindingType.PERFECT && '무선제본'}
              {bindingType === BindingType.SADDLE && '중철제본'}
              {bindingType === BindingType.SPIRAL && '스프링제본'}
              {bindingType === BindingType.HARDCOVER && '양장제본'}
            </span>
          </div>
          <div className="font-medium text-gray-900">
            책등 폭: {spineResult.spineWidth.toFixed(2)}mm
          </div>
        </div>
      </div>
    </div>
  )
})

interface TabButtonProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}

const TabButton = memo(function TabButton({
  active,
  onClick,
  icon,
  label,
}: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-3 border-b-2 transition-colors',
        active
          ? 'border-blue-500 text-blue-600 bg-blue-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
      )}
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </button>
  )
})
