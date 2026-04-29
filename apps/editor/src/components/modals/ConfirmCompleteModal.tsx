import { memo, useState } from 'react'
import { CheckCircle, AlertTriangle as Warning, X, FileText as FileDashed, Loader as CircleNotch } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ConfirmCompleteModalProps {
  isOpen: boolean
  pageCount: number
  hasUnsavedChanges?: boolean
  validationErrors?: string[]
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * 편집 완료 확인 모달
 */
export const ConfirmCompleteModal = memo(function ConfirmCompleteModal({
  isOpen,
  pageCount,
  hasUnsavedChanges = false,
  validationErrors = [],
  onConfirm,
  onCancel,
}: ConfirmCompleteModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const hasErrors = validationErrors.length > 0

  const handleConfirm = async () => {
    if (hasErrors || isSubmitting) return

    setIsSubmitting(true)
    try {
      await onConfirm()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center',
              hasErrors ? 'bg-red-100' : 'bg-green-100'
            )}>
              {hasErrors ? (
                <Warning className="w-5 h-5 text-red-600" />
              ) : (
                <FileDashed className="w-5 h-5 text-green-600" />
              )}
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              편집 완료
            </h3>
          </div>
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className="p-1 hover:bg-gray-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          {/* 미저장 경고 */}
          {hasUnsavedChanges && (
            <div className="flex items-start gap-3 p-3 bg-yellow-50 rounded-lg border border-yellow-100 mb-4">
              <Warning className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800">
                <p className="font-medium">저장되지 않은 변경사항이 있습니다.</p>
                <p>완료하기 전에 자동으로 저장됩니다.</p>
              </div>
            </div>
          )}

          {/* 검증 오류 */}
          {hasErrors && (
            <div className="mb-4">
              <div className="text-sm font-medium text-red-600 mb-2">
                다음 문제를 해결해주세요:
              </div>
              <ul className="space-y-1 text-sm text-red-600">
                {validationErrors.map((error, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-red-500 rounded-full" />
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 요약 정보 */}
          {!hasErrors && (
            <div className="p-4 bg-gray-50 rounded-lg mb-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">총 페이지</div>
                  <div className="font-medium text-gray-900">{pageCount}페이지</div>
                </div>
                <div>
                  <div className="text-gray-500">상태 변경</div>
                  <div className="font-medium text-gray-900">검토 대기</div>
                </div>
              </div>
            </div>
          )}

          <p className="text-gray-600 text-sm">
            {hasErrors ? (
              '위 문제를 해결한 후 다시 시도해주세요.'
            ) : (
              '편집을 완료하면 더 이상 수정할 수 없으며, 관리자 검토 후 인쇄가 진행됩니다.'
            )}
          </p>
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isSubmitting}
            className={cn(
              'px-4 py-2 rounded-lg transition-colors',
              'text-gray-600 hover:bg-gray-100',
              isSubmitting && 'opacity-50 cursor-not-allowed'
            )}
          >
            취소
          </button>
          <button
            onClick={handleConfirm}
            disabled={hasErrors || isSubmitting}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors',
              hasErrors
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700',
              isSubmitting && 'opacity-50 cursor-not-allowed'
            )}
          >
            {isSubmitting ? (
              <>
                <CircleNotch className="w-4 h-4 animate-spin" />
                처리 중...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                편집 완료
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
})
