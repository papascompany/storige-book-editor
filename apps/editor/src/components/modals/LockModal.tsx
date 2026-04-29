import { memo } from 'react'
import { Lock as LockSimple, Eye, X, RefreshCw as ArrowsClockwise } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatLockInfo } from '@/hooks/useEditLock'

interface LockModalProps {
  isOpen: boolean
  lockedBy: string | null
  lockedAt: Date | null
  onReadOnly: () => void
  onRetry: () => void
  onClose: () => void
  isRetrying?: boolean
}

/**
 * 편집 잠금 안내 모달
 * 다른 사용자가 편집 중일 때 표시
 */
export const LockModal = memo(function LockModal({
  isOpen,
  lockedBy,
  lockedAt,
  onReadOnly,
  onRetry,
  onClose,
  isRetrying = false,
}: LockModalProps) {
  if (!isOpen) return null

  const lockInfo = formatLockInfo(lockedBy, lockedAt)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
        {/* 헤더 */}
        <div className="flex items-center gap-3 px-6 py-4 bg-yellow-50 border-b border-yellow-100">
          <div className="w-10 h-10 rounded-full bg-yellow-100 flex items-center justify-center">
            <LockSimple className="w-5 h-5 text-yellow-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">
              편집 중인 작업입니다
            </h3>
            <p className="text-sm text-gray-500">
              {lockInfo}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-yellow-100 rounded transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-6 py-4">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg mb-4">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-medium text-sm">
              {lockedBy?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <div className="font-medium text-gray-900">{lockedBy || '알 수 없는 사용자'}</div>
              <div className="text-xs text-gray-500">현재 이 작업을 편집 중입니다</div>
            </div>
          </div>
          <p className="text-gray-600 text-sm">
            동시에 같은 작업을 편집할 수 없습니다.
            읽기 전용으로 확인하거나, 나중에 다시 시도해주세요.
          </p>
        </div>

        {/* 버튼 */}
        <div className="px-6 py-4 bg-gray-50 border-t flex gap-2">
          <button
            onClick={onReadOnly}
            className={cn(
              'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors',
              'bg-blue-600 text-white hover:bg-blue-700'
            )}
          >
            <Eye className="w-4 h-4" />
            읽기 전용으로 보기
          </button>

          <button
            onClick={onRetry}
            disabled={isRetrying}
            className={cn(
              'flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg transition-colors',
              'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50',
              isRetrying && 'opacity-50 cursor-not-allowed'
            )}
          >
            <ArrowsClockwise className={cn('w-4 h-4', isRetrying && 'animate-spin')} />
            {isRetrying ? '확인 중...' : '다시 시도'}
          </button>
        </div>
      </div>
    </div>
  )
})
