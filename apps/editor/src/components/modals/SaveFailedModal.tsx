import { memo, useCallback } from 'react'
import { AlertTriangle as Warning, RefreshCw as ArrowsClockwise, X, Download as DownloadSimple } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SaveFailedModalProps {
  isOpen: boolean
  error: string | null
  onRetry: () => void
  onDismiss: () => void
  onSaveLocal?: () => void
  isRetrying?: boolean
}

/**
 * 저장 실패 모달
 */
export const SaveFailedModal = memo(function SaveFailedModal({
  isOpen,
  error,
  onRetry,
  onDismiss,
  onSaveLocal,
  isRetrying = false,
}: SaveFailedModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 py-4 bg-red-50 border-b border-red-100">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
            <Warning className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              저장에 실패했습니다
            </h3>
            <p className="text-sm text-gray-500">
              작업 내용이 저장되지 않았습니다
            </p>
          </div>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          {error && (
            <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600 mb-4">
              <span className="font-medium">오류 내용:</span> {error}
            </div>
          )}
          <p className="text-gray-600 text-sm mb-4">
            네트워크 연결을 확인하고 다시 시도해주세요.
            문제가 계속되면 로컬에 임시 저장 후 나중에 다시 시도해주세요.
          </p>
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex flex-col gap-2">
          <button
            onClick={onRetry}
            disabled={isRetrying}
            className={cn(
              'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors',
              'bg-blue-600 text-white hover:bg-blue-700',
              isRetrying && 'opacity-50 cursor-not-allowed'
            )}
          >
            <ArrowsClockwise className={cn('w-4 h-4', isRetrying && 'animate-spin')} />
            {isRetrying ? '저장 중...' : '다시 시도'}
          </button>

          {onSaveLocal && (
            <button
              onClick={onSaveLocal}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors',
                'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
              )}
            >
              <DownloadSimple className="w-4 h-4" />
              로컬에 임시 저장
            </button>
          )}

          <button
            onClick={onDismiss}
            className={cn(
              'w-full px-4 py-2.5 rounded-lg transition-colors',
              'text-gray-500 hover:bg-gray-100'
            )}
          >
            나중에 저장
          </button>
        </div>
      </div>
    </div>
  )
})
