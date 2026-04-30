import { useEffect, useRef } from 'react'
import {
  Check,
  AlertTriangle,
  CloudOff,
  Loader2,
  HardDrive,
  Clock,
} from 'lucide-react'
import { useSaveStore, getSaveStatusText, type SaveStatus } from '@/stores/useSaveStore'
import { showToast } from '@/stores/useToastStore'
import { useUiPrefStore } from '@/stores/useUiPrefStore'
import { cn } from '@/lib/utils'

interface AutoSaveIndicatorProps {
  className?: string
}

/**
 * 자동 저장 상태 표시 컴포넌트.
 * - lucide 아이콘 + 테마 토큰 (다크 모드 호환)
 * - 상태 변화 감지: saved/failed/offline 전환 시 토스트 알림
 */
export function AutoSaveIndicator({ className = '' }: AutoSaveIndicatorProps) {
  const status = useSaveStore((state) => state.status)
  const lastSavedAt = useSaveStore((state) => state.lastSavedAt)
  const isOnline = useSaveStore((state) => state.isOnline)
  const hasLocalBackup = useSaveStore((state) => state.hasLocalBackup)
  const error = useSaveStore((state) => state.error)

  // 상태 변화 감지 → 토스트 (saved/failed/offline 전환)
  const prevStatusRef = useRef<SaveStatus>(status)
  const autoSaveToastEnabled = useUiPrefStore((s) => s.autoSaveToastEnabled)
  useEffect(() => {
    const prev = prevStatusRef.current
    if (prev !== status) {
      // saving → saved: 사용자 옵션이 켜져있을 때만 짧은 toast (1.2초, 노이즈 최소화)
      if (status === 'saved' && prev === 'saving' && autoSaveToastEnabled) {
        showToast('저장됨', 'success', 1200)
      }
      if (status === 'failed' && prev !== 'failed') {
        showToast(
          error ? `자동 저장 실패: ${error}` : '자동 저장에 실패했습니다.',
          'error',
          5000
        )
      }
      if (status === 'offline' && prev !== 'offline') {
        showToast('오프라인 상태로 전환됐습니다. 작업은 로컬에 백업됩니다.', 'warning', 4000)
      }
      prevStatusRef.current = status
    }
  }, [status, error, autoSaveToastEnabled])

  const statusText = getSaveStatusText(status)

  const formatTime = (date: Date | null): string => {
    if (!date) return ''
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    if (diff < 60000) return '방금 전'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      <StatusIcon status={status} />
      <span className={statusTextClass(status)}>{statusText}</span>

      {status === 'saved' && lastSavedAt && (
        <span className="text-editor-text-muted/70 inline-flex items-center gap-0.5">
          <Clock className="h-3 w-3" />
          {formatTime(lastSavedAt)}
        </span>
      )}

      {!isOnline && (
        <span className="text-amber-500 inline-flex items-center" title="오프라인 상태">
          <CloudOff className="h-3.5 w-3.5" />
        </span>
      )}

      {hasLocalBackup && (
        <span className="text-amber-500 inline-flex items-center" title="로컬에 백업이 있습니다">
          <HardDrive className="h-3.5 w-3.5" />
        </span>
      )}

      {error && (
        <span className="text-red-500 cursor-help" title={error}>
          <AlertTriangle className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  )
}

function statusTextClass(status: SaveStatus): string {
  switch (status) {
    case 'saved':
      return 'text-editor-accent'
    case 'saving':
      return 'text-blue-500'
    case 'failed':
      return 'text-red-500'
    case 'unsaved':
      return 'text-amber-500'
    case 'offline':
      return 'text-editor-text-muted'
    default:
      return 'text-editor-text-muted'
  }
}

function StatusIcon({ status }: { status: SaveStatus }) {
  switch (status) {
    case 'saving':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
    case 'saved':
      return <Check className="h-3.5 w-3.5 text-editor-accent" />
    case 'failed':
      return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
    case 'unsaved':
      return <Clock className="h-3.5 w-3.5 text-amber-500" />
    case 'offline':
      return <CloudOff className="h-3.5 w-3.5 text-editor-text-muted" />
    default:
      return null
  }
}

export default AutoSaveIndicator
