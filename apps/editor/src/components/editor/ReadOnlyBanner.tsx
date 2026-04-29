import { memo } from 'react'
import { Eye, Lock as LockSimple, X, RefreshCw as ArrowsClockwise } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatLockInfo } from '@/hooks/useEditLock'

interface ReadOnlyBannerProps {
  /**
   * 읽기 전용 사유
   */
  reason: 'locked' | 'submitted' | 'review' | 'permission'
  /**
   * 잠금 사용자 (locked 사유일 때)
   */
  lockedBy?: string | null
  /**
   * 잠금 시간 (locked 사유일 때)
   */
  lockedAt?: Date | null
  /**
   * 편집 모드로 전환 시도
   */
  onRequestEdit?: () => void
  /**
   * 배너 닫기
   */
  onDismiss?: () => void
  className?: string
}

/**
 * 읽기 전용 모드 안내 배너
 */
export const ReadOnlyBanner = memo(function ReadOnlyBanner({
  reason,
  lockedBy,
  lockedAt,
  onRequestEdit,
  onDismiss,
  className,
}: ReadOnlyBannerProps) {
  const getMessage = () => {
    switch (reason) {
      case 'locked':
        return {
          icon: LockSimple,
          title: '읽기 전용 모드',
          description: formatLockInfo(lockedBy || null, lockedAt || null),
          canRequest: true,
        }
      case 'submitted':
        return {
          icon: LockSimple,
          title: '편집 완료됨',
          description: '이 작업은 이미 제출되어 수정할 수 없습니다.',
          canRequest: false,
        }
      case 'review':
        return {
          icon: Eye,
          title: '검토 중',
          description: '관리자가 검토 중인 작업입니다.',
          canRequest: false,
        }
      case 'permission':
        return {
          icon: LockSimple,
          title: '권한 없음',
          description: '이 작업을 편집할 권한이 없습니다.',
          canRequest: false,
        }
    }
  }

  const message = getMessage()
  const Icon = message.icon

  return (
    <div
      className={cn(
        'flex items-center justify-between px-4 py-2 bg-yellow-50 border-b border-yellow-100',
        className
      )}
    >
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-yellow-100 flex items-center justify-center">
          <Icon className="w-4 h-4 text-yellow-600" />
        </div>
        <div>
          <div className="text-sm font-medium text-yellow-800">
            {message.title}
          </div>
          <div className="text-xs text-yellow-600">
            {message.description}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {message.canRequest && onRequestEdit && (
          <button
            onClick={onRequestEdit}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors',
              'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
            )}
          >
            <ArrowsClockwise className="w-4 h-4" />
            편집 시도
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="p-1.5 text-yellow-600 hover:bg-yellow-100 rounded transition-colors"
            title="닫기"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
})

/**
 * 간단한 읽기 전용 표시 배지
 */
interface ReadOnlyBadgeProps {
  className?: string
}

export const ReadOnlyBadge = memo(function ReadOnlyBadge({
  className,
}: ReadOnlyBadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium',
        className
      )}
    >
      <Eye className="w-3 h-3" />
      읽기 전용
    </div>
  )
})
