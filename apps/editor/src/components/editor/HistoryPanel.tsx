import { useEffect, useState } from 'react'
import { History, Clock, RotateCcw, Save, FileText } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useAutoSaveSnapshotsStore } from '@/stores/useAutoSaveSnapshotsStore'
import { HistoryPlugin } from '@storige/canvas-core'
import { cn } from '@/lib/utils'

/**
 * 히스토리 요약 패널 (트랙 Q — 작은 진척)
 *
 * 헤더의 History 아이콘 버튼을 누르면 popover로 표시:
 * - 되돌릴 수 있는 단계 수 (canvas.historyUndo.length)
 * - 다시 실행 가능한 단계 수 (historyRedo.length)
 * - 마지막 자동저장 시각 (useSaveStore.lastSavedAt)
 * - 현재 dirty 여부
 *
 * 향후 확장 (Phase 2 — cover.md 향후 작업 표 참고):
 * - 자동저장 스냅샷 list (백엔드 versions API 필요)
 * - 시점별 thumbnail 미리보기 + "여기로 복원" 액션
 * - 사용자 마일스톤 마킹 (별표)
 */

function formatRelative(date: Date | null): string {
  if (!date) return '없음'
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return date.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPanel() {
  const [open, setOpen] = useState(false)
  const ready = useAppStore((s) => s.ready)
  const canvas = useAppStore((s) => s.canvas)
  const getPlugin = useAppStore((s) => s.getPlugin)
  const lastSavedAt = useSaveStore((s) => s.lastSavedAt)
  const isDirty = useSaveStore((s) => s.isDirty)
  const allEditors = useAppStore((s) => s.allEditors)
  const snapshots = useAutoSaveSnapshotsStore((s) => s.snapshots)
  const clearSnapshots = useAutoSaveSnapshotsStore((s) => s.clearSnapshots)

  // 스택 길이 — historyUpdate 이벤트 구독으로 갱신
  const [undoLen, setUndoLen] = useState(0)
  const [redoLen, setRedoLen] = useState(0)

  useEffect(() => {
    if (!ready) return

    const refresh = () => {
      const cv = useAppStore.getState().canvas
      if (!cv || (cv as any).disposed) return
      try {
        setUndoLen(cv.historyUndo?.length ?? 0)
        setRedoLen(cv.historyRedo?.length ?? 0)
      } catch {
        // ignore
      }
    }
    refresh()
    const id = setTimeout(refresh, 200)

    const handlers: Array<{ editor: any; fn: () => void }> = []
    allEditors.forEach((editor: any) => {
      if (!editor?.on) return
      const fn = () => refresh()
      editor.on('historyUpdate', fn)
      handlers.push({ editor, fn })
    })

    return () => {
      clearTimeout(id)
      handlers.forEach(({ editor, fn }) => {
        try { editor.off?.('historyUpdate', fn) } catch {}
      })
    }
  }, [ready, allEditors, canvas])

  const handleResetToSaved = () => {
    // 저장 시점으로 되돌리기 — undo 가능한 만큼 모두 undo
    const plugin = getPlugin<HistoryPlugin>('HistoryPlugin')
    if (!plugin) return
    const cv = useAppStore.getState().canvas
    if (!cv) return
    const steps = cv.historyUndo?.length ?? 0
    for (let i = 0; i < steps; i++) {
      plugin.undo()
    }
    setOpen(false)
  }

  const dirtyDots = isDirty ? '●' : '○'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="변경 이력"
          title="변경 이력"
          className="h-9 w-9 text-editor-text-muted hover:bg-editor-hover"
        >
          <History className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 p-3">
        <div className="text-[12px] font-semibold text-editor-text mb-2 flex items-center gap-2">
          <History className="h-4 w-4 text-editor-accent" />
          변경 이력 요약
        </div>

        <div className="space-y-2 text-sm">
          <Row icon={RotateCcw} label="되돌릴 수 있는 단계" value={`${undoLen}단계`} />
          <Row icon={RotateCcw} label="다시 실행 가능" value={`${redoLen}단계`} flipIcon />
          <Row icon={Save} label="마지막 자동저장" value={formatRelative(lastSavedAt)} />
          <Row icon={Clock} label="현재 변경됨" value={isDirty ? '예 ●' : '아니오 ○'} />
        </div>

        <div className="border-t border-editor-border mt-3 pt-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={handleResetToSaved}
            disabled={undoLen === 0}
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
            모든 변경 되돌리기 ({undoLen}단계)
          </Button>
        </div>

        {/* 자동저장 스냅샷 list (트랙 BB — Phase 2 minimal) */}
        <div className="border-t border-editor-border mt-3 pt-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-semibold text-editor-text-muted flex items-center gap-1">
              <FileText className="h-3.5 w-3.5" />
              최근 자동저장 ({snapshots.length})
            </span>
            {snapshots.length > 0 && (
              <button
                type="button"
                onClick={clearSnapshots}
                className="text-[10px] text-editor-text-muted hover:text-editor-text underline-offset-2 hover:underline"
                title="스냅샷 list 지우기"
              >
                지우기
              </button>
            )}
          </div>
          {snapshots.length === 0 ? (
            <p className="text-[11px] text-editor-text-muted leading-snug py-1">
              아직 자동저장 기록이 없습니다.
            </p>
          ) : (
            <ul className="space-y-1 max-h-40 overflow-y-auto scrollbar-hide">
              {snapshots.map((s) => {
                const date = new Date(s.savedAt)
                return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-editor-hover"
                    title={date.toLocaleString('ko-KR')}
                  >
                    <span className="text-[11px] text-editor-text">
                      {formatRelative(date)}
                    </span>
                    <span className="text-[10px] text-editor-text-muted">
                      {s.pageCount}페이지
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-1.5 text-[10px] text-editor-text-muted leading-snug">
            시점별 복원은 백엔드 versions API 연동 후 활성화 예정입니다.
          </p>
        </div>

        <span className="hidden">{dirtyDots}</span>
      </PopoverContent>
    </Popover>
  )
}

function Row({
  icon: Icon,
  label,
  value,
  flipIcon,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  flipIcon?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-editor-text-muted">
        <Icon className={cn('h-3.5 w-3.5', flipIcon && 'scale-x-[-1]')} />
        <span className="text-[12px]">{label}</span>
      </span>
      <span className="text-[12px] font-medium text-editor-text">{value}</span>
    </div>
  )
}
