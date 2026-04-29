import { memo, useMemo } from 'react'
import { Cloud, CloudOff as CloudSlash, Check, AlertCircle as WarningCircle, Loader as CircleNotch } from 'lucide-react'
import {
  useSaveStore,
  useSaveStatus,
  useLastSavedAt,
  useSaveError,
  getSaveStatusText,
  type SaveStatus as SaveStatusType,
} from '@/stores/useSaveStore'
import { cn } from '@/lib/utils'

interface SaveStatusProps {
  className?: string
  showText?: boolean
  showLastSaved?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const statusIcons: Record<SaveStatusType, React.ElementType> = {
  saved: Check,
  saving: CircleNotch,
  failed: WarningCircle,
  unsaved: Cloud,
  offline: CloudSlash,
}

const statusColors: Record<SaveStatusType, string> = {
  saved: 'text-green-600',
  saving: 'text-blue-600',
  failed: 'text-red-600',
  unsaved: 'text-yellow-600',
  offline: 'text-gray-500',
}

export const SaveStatus = memo(function SaveStatus({
  className,
  showText = true,
  showLastSaved = true,
  size = 'md',
}: SaveStatusProps) {
  const status = useSaveStatus()
  const lastSavedAt = useLastSavedAt()
  const error = useSaveError()

  const Icon = statusIcons[status]
  const colorClass = statusColors[status]
  const statusText = getSaveStatusText(status)

  const sizeClasses = {
    sm: {
      icon: 'w-3 h-3',
      text: 'text-xs',
    },
    md: {
      icon: 'w-4 h-4',
      text: 'text-sm',
    },
    lg: {
      icon: 'w-5 h-5',
      text: 'text-base',
    },
  }

  const sizes = sizeClasses[size]

  const formattedLastSaved = useMemo(() => {
    if (!lastSavedAt) return null

    const now = new Date()
    const diff = now.getTime() - lastSavedAt.getTime()
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (seconds < 60) {
      return '방금 전'
    } else if (minutes < 60) {
      return `${minutes}분 전`
    } else if (hours < 24) {
      return `${hours}시간 전`
    } else {
      return lastSavedAt.toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    }
  }, [lastSavedAt])

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      title={error || statusText}
    >
      <Icon
        className={cn(
          sizes.icon,
          colorClass,
          status === 'saving' && 'animate-spin'
        )}
      />

      {showText && (
        <span className={cn(sizes.text, colorClass)}>{statusText}</span>
      )}

      {showLastSaved && formattedLastSaved && status === 'saved' && (
        <span className={cn(sizes.text, 'text-gray-400')}>
          ({formattedLastSaved})
        </span>
      )}

      {status === 'failed' && error && (
        <span className={cn(sizes.text, 'text-red-500 ml-1')} title={error}>
          !
        </span>
      )}
    </div>
  )
})

/**
 * 저장 버튼과 상태를 결합한 컴포넌트
 */
interface SaveButtonProps {
  className?: string
  onSave?: () => Promise<void>
}

export const SaveButton = memo(function SaveButton({
  className,
  onSave,
}: SaveButtonProps) {
  const status = useSaveStatus()
  const isDirty = useSaveStore((state) => state.isDirty)

  const isDisabled = status === 'saving' || (!isDirty && status === 'saved')

  const handleClick = async () => {
    if (onSave && !isDisabled) {
      await onSave()
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled}
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 rounded transition-colors',
        isDisabled
          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
          : 'bg-blue-500 text-white hover:bg-blue-600',
        className
      )}
    >
      {status === 'saving' ? (
        <CircleNotch className="w-4 h-4 animate-spin" />
      ) : (
        <Cloud className="w-4 h-4" />
      )}
      <span className="text-sm">
        {status === 'saving' ? '저장 중...' : '저장'}
      </span>
    </button>
  )
})
