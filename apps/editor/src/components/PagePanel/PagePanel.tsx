import { memo, useState, useCallback } from 'react'
import { Plus, ChevronLeft as CaretLeft, ChevronRight as CaretRight } from 'lucide-react'
import { PageList } from './PageList'
import { useEditorStore, useCanAddPage } from '@/stores/useEditorStore'
import { useAppStore } from '@/stores/useAppStore'
import { cn } from '@/lib/utils'

interface PagePanelProps {
  className?: string
  collapsed?: boolean
  onToggle?: () => void
}

export const PagePanel = memo(function PagePanel({
  className,
  collapsed = false,
  onToggle,
}: PagePanelProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const pages = useEditorStore((state) => state.pages)
  const currentPageIndex = useEditorStore((state) => state.currentPageIndex)
  const deletePage = useEditorStore((state) => state.deletePage)
  const canAddMore = useCanAddPage()

  const addPage = useAppStore((state) => state.addPage)

  const handleAddPage = useCallback(async () => {
    if (!canAddMore) return

    try {
      await addPage()
    } catch (error) {
      console.error('페이지 추가 실패:', error)
    }
  }, [canAddMore, addPage])

  const handleDeleteRequest = useCallback((pageId: string) => {
    setDeleteConfirmId(pageId)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return

    setIsDeleting(true)
    try {
      deletePage(deleteConfirmId)
    } catch (error) {
      console.error('페이지 삭제 실패:', error)
    } finally {
      setIsDeleting(false)
      setDeleteConfirmId(null)
    }
  }, [deleteConfirmId, deletePage])

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmId(null)
  }, [])

  if (collapsed) {
    return (
      <div
        className={cn(
          'w-10 bg-white border-r flex flex-col items-center py-2',
          className
        )}
      >
        <button
          onClick={onToggle}
          className="p-2 hover:bg-gray-100 rounded"
          title="페이지 패널 열기"
        >
          <CaretRight className="w-4 h-4" />
        </button>
        <div className="mt-4 text-xs text-gray-500 writing-vertical">
          {currentPageIndex + 1}/{pages.length}
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'w-32 bg-white border-r flex flex-col',
        className
      )}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-2 py-2 border-b">
        <span className="text-sm font-medium">페이지</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleAddPage}
            disabled={!canAddMore}
            className={cn(
              'p-1 rounded hover:bg-gray-100',
              !canAddMore && 'opacity-50 cursor-not-allowed'
            )}
            title={canAddMore ? '페이지 추가' : '최대 페이지 수에 도달했습니다'}
          >
            <Plus className="w-4 h-4" />
          </button>
          {onToggle && (
            <button
              onClick={onToggle}
              className="p-1 rounded hover:bg-gray-100"
              title="페이지 패널 접기"
            >
              <CaretLeft className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 페이지 목록 */}
      <div className="flex-1 overflow-hidden">
        <PageList onDeletePage={handleDeleteRequest} />
      </div>

      {/* 페이지 카운터 */}
      <div className="px-2 py-1 border-t text-center text-xs text-gray-500">
        {currentPageIndex + 1} / {pages.length}
      </div>

      {/* 삭제 확인 모달 */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-4 max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-2">페이지 삭제</h3>
            <p className="text-gray-600 mb-4">
              이 페이지를 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleDeleteCancel}
                className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
                disabled={isDeleting}
              >
                취소
              </button>
              <button
                onClick={handleDeleteConfirm}
                className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 rounded"
                disabled={isDeleting}
              >
                {isDeleting ? '삭제 중...' : '삭제'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

// 세로 글자 스타일
const style = document.createElement('style')
style.textContent = `
  .writing-vertical {
    writing-mode: vertical-rl;
    text-orientation: mixed;
  }
`
document.head.appendChild(style)
