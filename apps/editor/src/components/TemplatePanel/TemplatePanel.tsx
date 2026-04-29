import { memo, useState, useEffect, useCallback } from 'react'
import { Layers as Stack, FileText, X, RefreshCw as ArrowsClockwise, ChevronRight as CaretRight, ChevronLeft as CaretLeft } from 'lucide-react'
import { TemplateCard } from './TemplateCard'
import { TemplateSetCard } from './TemplateSetCard'
import { TemplateReplaceModal } from './TemplateReplaceModal'
import { useEditorStore, useCurrentPage } from '@/stores/useEditorStore'
import { templatesApi, type Template, type TemplateSet } from '@/api/templates'
import { sessionsApi } from '@/api/sessions'
import { cn } from '@/lib/utils'
import type { TemplateType, TemplateSetType } from '@storige/types'

type TabType = 'templateSet' | 'template'

interface TemplatePanelProps {
  className?: string
  collapsed?: boolean
  onToggle?: () => void
}

export const TemplatePanel = memo(function TemplatePanel({
  className,
  collapsed = false,
  onToggle,
}: TemplatePanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('template')
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateSets, setTemplateSets] = useState<TemplateSet[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 교체 모달 상태
  const [replaceModal, setReplaceModal] = useState<{
    isOpen: boolean
    mode: 'template' | 'templateSet'
    selectedItem: Template | TemplateSet | null
  }>({
    isOpen: false,
    mode: 'template',
    selectedItem: null,
  })
  const [isReplacing, setIsReplacing] = useState(false)

  // Store
  const sessionId = useEditorStore((state) => state.sessionId)
  const session = useEditorStore((state) => state.session)
  const userId = useEditorStore((state) => state.userId)
  const setSession = useEditorStore((state) => state.setSession)
  const currentPage = useCurrentPage()

  // 현재 페이지 타입과 템플릿셋 정보
  const currentPageType = currentPage?.templateType as TemplateType | undefined
  const templateSetId = session?.templateSetId
  const templateSetWidth = session?.templateSet?.width || 210
  const templateSetHeight = session?.templateSet?.height || 297
  const templateSetType = session?.templateSet?.type as TemplateSetType | undefined

  // 낱장 템플릿 목록 로드
  const loadTemplates = useCallback(async () => {
    if (!currentPageType || activeTab !== 'template') return

    setIsLoading(true)
    setError(null)
    try {
      const data = await templatesApi.getTemplates({
        categoryId: undefined,
      })
      // 같은 타입과 판형으로 필터링
      const filtered = data.filter(
        (t) =>
          t.type === currentPageType &&
          t.width === templateSetWidth &&
          t.height === templateSetHeight
      )
      setTemplates(filtered)
    } catch (err) {
      console.error('템플릿 로드 실패:', err)
      setError('템플릿을 불러오는데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [currentPageType, activeTab, templateSetWidth, templateSetHeight])

  // 템플릿셋 목록 로드
  const loadTemplateSets = useCallback(async () => {
    if (activeTab !== 'templateSet') return

    setIsLoading(true)
    setError(null)
    try {
      const data = await templatesApi.getTemplateSets({
        width: templateSetWidth,
        height: templateSetHeight,
        type: templateSetType,
        isActive: true,
      })
      setTemplateSets(data.items)
    } catch (err) {
      console.error('템플릿셋 로드 실패:', err)
      setError('템플릿셋을 불러오는데 실패했습니다.')
    } finally {
      setIsLoading(false)
    }
  }, [activeTab, templateSetWidth, templateSetHeight, templateSetType])

  // 탭 변경 시 데이터 로드
  useEffect(() => {
    if (activeTab === 'template') {
      loadTemplates()
    } else {
      loadTemplateSets()
    }
  }, [activeTab, loadTemplates, loadTemplateSets])

  // 템플릿 선택 핸들러
  const handleTemplateSelect = useCallback((template: Template) => {
    setReplaceModal({
      isOpen: true,
      mode: 'template',
      selectedItem: template,
    })
  }, [])

  // 템플릿셋 선택 핸들러
  const handleTemplateSetSelect = useCallback((templateSet: TemplateSet) => {
    setReplaceModal({
      isOpen: true,
      mode: 'templateSet',
      selectedItem: templateSet,
    })
  }, [])

  // 교체 확인 핸들러
  const handleReplaceConfirm = useCallback(async () => {
    if (!sessionId || !replaceModal.selectedItem) return

    setIsReplacing(true)
    try {
      let updatedSession
      if (replaceModal.mode === 'template') {
        const template = replaceModal.selectedItem as Template
        updatedSession = await sessionsApi.replaceTemplate(
          sessionId,
          {
            newTemplateId: template.id,
            pageId: currentPage?.id,
          },
          userId || undefined
        )
      } else {
        const templateSet = replaceModal.selectedItem as TemplateSet
        updatedSession = await sessionsApi.replaceTemplateSet(
          sessionId,
          { newTemplateSetId: templateSet.id },
          userId || undefined
        )
      }

      // 세션 업데이트
      setSession(updatedSession)

      // 모달 닫기
      setReplaceModal({
        isOpen: false,
        mode: 'template',
        selectedItem: null,
      })
    } catch (err) {
      console.error('교체 실패:', err)
      setError('템플릿 교체에 실패했습니다.')
    } finally {
      setIsReplacing(false)
    }
  }, [sessionId, replaceModal, currentPage, userId, setSession])

  // 모달 취소 핸들러
  const handleReplaceCancel = useCallback(() => {
    if (isReplacing) return
    setReplaceModal({
      isOpen: false,
      mode: 'template',
      selectedItem: null,
    })
  }, [isReplacing])

  if (collapsed) {
    return (
      <div
        className={cn(
          'w-10 bg-white border-l flex flex-col items-center py-2',
          className
        )}
      >
        <button
          onClick={onToggle}
          className="p-2 hover:bg-gray-100 rounded"
          title="템플릿 패널 열기"
        >
          <CaretLeft className="w-4 h-4" />
        </button>
        <div className="mt-4 text-xs text-gray-500 writing-vertical">
          템플릿
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        className={cn(
          'w-64 bg-white border-l flex flex-col',
          className
        )}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-medium">템플릿</h3>
          {onToggle && (
            <button
              onClick={onToggle}
              className="p-1 hover:bg-gray-100 rounded"
              title="템플릿 패널 접기"
            >
              <CaretRight className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* 탭 */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('template')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'template'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            <div className="flex items-center justify-center gap-1.5">
              <FileText className="w-4 h-4" />
              낱장
            </div>
          </button>
          <button
            onClick={() => setActiveTab('templateSet')}
            className={cn(
              'flex-1 px-4 py-2 text-sm font-medium transition-colors',
              activeTab === 'templateSet'
                ? 'text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            <div className="flex items-center justify-center gap-1.5">
              <Stack className="w-4 h-4" />
              템플릿셋
            </div>
          </button>
        </div>

        {/* 필터 정보 */}
        <div className="px-4 py-2 bg-gray-50 border-b text-xs text-gray-500">
          {activeTab === 'template' ? (
            <span>
              {currentPageType || '알 수 없음'} 타입 | {templateSetWidth}x{templateSetHeight}
            </span>
          ) : (
            <span>
              {templateSetType || '전체'} | {templateSetWidth}x{templateSetHeight}
            </span>
          )}
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <ArrowsClockwise className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="text-center text-sm text-red-500 py-4">
              {error}
            </div>
          ) : activeTab === 'template' ? (
            <div className="grid grid-cols-1 gap-3">
              {templates.length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-4">
                  사용 가능한 템플릿이 없습니다.
                </div>
              ) : (
                templates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    id={template.id}
                    name={template.name}
                    type={template.type}
                    thumbnailUrl={template.thumbnailUrl}
                    width={template.width}
                    height={template.height}
                    isSelected={currentPage?.templateId === template.id}
                    onClick={() => handleTemplateSelect(template)}
                  />
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {templateSets.length === 0 ? (
                <div className="text-center text-sm text-gray-500 py-4">
                  사용 가능한 템플릿셋이 없습니다.
                </div>
              ) : (
                templateSets.map((ts) => (
                  <TemplateSetCard
                    key={ts.id}
                    id={ts.id}
                    name={ts.name}
                    type={ts.type}
                    thumbnailUrl={ts.thumbnailUrl}
                    width={ts.width}
                    height={ts.height}
                    templateCount={ts.templates.length}
                    isSelected={templateSetId === ts.id}
                    onClick={() => handleTemplateSetSelect(ts)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* 교체 확인 모달 */}
      <TemplateReplaceModal
        isOpen={replaceModal.isOpen}
        mode={replaceModal.mode}
        templateName={
          replaceModal.mode === 'template'
            ? (replaceModal.selectedItem as Template)?.name
            : undefined
        }
        templateSetName={
          replaceModal.mode === 'templateSet'
            ? (replaceModal.selectedItem as TemplateSet)?.name
            : undefined
        }
        onConfirm={handleReplaceConfirm}
        onCancel={handleReplaceCancel}
        isReplacing={isReplacing}
      />

      {/* 세로 글자 스타일 */}
      <style>{`
        .writing-vertical {
          writing-mode: vertical-rl;
          text-orientation: mixed;
        }
      `}</style>
    </>
  )
})
