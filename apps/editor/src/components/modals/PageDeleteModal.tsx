import { memo } from 'react'
import { Trash2 as Trash, AlertTriangle as Warning, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PageDeleteModalProps {
  isOpen: boolean
  pageNumber: number
  pageType?: string
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
}

/**
 * 페이지 삭제 확인 모달
 */
export const PageDeleteModal = memo(function PageDeleteModal({
  isOpen,
  pageNumber,
  pageType,
  onConfirm,
  onCancel,
  isDeleting = false,
}: PageDeleteModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <Trash className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              페이지 삭제
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100 mb-4">
            <Warning className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-yellow-800">
              이 작업은 취소할 수 없습니다.
            </p>
          </div>
          <p className="text-gray-600">
            <span className="font-medium text-gray-900">
              {pageNumber}페이지
              {pageType && ` (${pageType})`}
            </span>
            를 삭제하시겠습니까?
          </p>
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className={cn(
              'px-4 py-2 rounded-lg transition-colors',
              'text-gray-600 hover:bg-gray-100',
              isDeleting && 'opacity-50 cursor-not-allowed'
            )}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className={cn(
              'px-4 py-2 rounded-lg transition-colors',
              'bg-red-600 text-white hover:bg-red-700',
              isDeleting && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isDeleting ? '삭제 중...' : '삭제'}
          </button>
        </div>
      </div>
    </div>
  )
})
