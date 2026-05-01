import { useEffect, useState, useCallback } from 'react'
import { History, Clock, RotateCcw, Save, FileText, Undo2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAutoSaveSnapshotsStore } from '@/stores/useAutoSaveSnapshotsStore'
import { showToast } from '@/stores/useToastStore'
import { sessionsApi } from '@/api/sessions'
import { HistoryPlugin } from '@storige/canvas-core'
import { cn } from '@/lib/utils'

interface BackendVersion {
  id: string
  savedAt: string
  pageCount: number
  createdBy: string | null
  thumbnailUrl: string | null
}

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
  // BB-Phase 3 — sessionId가 있으면 백엔드 versions 페치, 없으면 localStorage snapshots 사용
  const sessionId = useEditorStore((s) => s.sessionId)
  const userId = useEditorStore((s) => s.userId)
  const [backendVersions, setBackendVersions] = useState<BackendVersion[] | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  /** P0-4: 복원 confirm 대기 중인 versionId (실수 클릭 방지). null이면 일반 list 모드 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

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

  // BB-Phase 3 — popover 열릴 때 백엔드 versions 페치 (sessionId 있을 때만)
  useEffect(() => {
    if (!open || !sessionId) {
      setBackendVersions(null)
      return
    }
    let cancelled = false
    sessionsApi
      .listVersions(sessionId, userId || undefined)
      .then((list) => {
        if (cancelled) return
        setBackendVersions(list)
      })
      .catch((err) => {
        console.warn('[HistoryPanel] listVersions 실패:', err?.message ?? err)
        if (!cancelled) setBackendVersions([])
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionId, userId])

  // P0-4 — 복원 클릭 시 confirm 단계 enter (즉시 API 호출하지 않음)
  const handleRestoreClick = useCallback((versionId: string) => {
    setConfirmingId(versionId)
  }, [])

  // P0-4 — confirm 후 실제 복원 수행 + 성공 시 자동 페이지 reload
  const handleRestoreConfirm = useCallback(
    async (versionId: string) => {
      if (!sessionId) return
      setRestoringId(versionId)
      try {
        await sessionsApi.restoreVersion(sessionId, versionId, userId || undefined)
        showToast('시점으로 복원되었습니다. 페이지를 새로고침합니다…', 'success', 2500)
        // 캔버스 / store / 모든 객체를 깨끗이 다시 로드 — 가장 안전한 방법은 페이지 새로고침
        // (in-place reload는 useEditorStore + 모든 캔버스 plugin reload 흐름이 복잡)
        setTimeout(() => {
          try { window.location.reload() } catch {}
        }, 500)
      } catch (err: any) {
        console.error('[HistoryPanel] restore 실패:', err)
        showToast(
          `복원 실패: ${err?.response?.data?.message ?? err?.message ?? '알 수 없음'}`,
          'error',
          4000
        )
        setRestoringId(null)
        setConfirmingId(null)
      }
    },
    [sessionId, userId]
  )

  // P0-4 — confirm 취소
  const handleRestoreCancel = useCallback(() => {
    setConfirmingId(null)
  }, [])

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

        {/* 자동저장 스냅샷 list — BB-Phase 3 백엔드 versions 우선, 없으면 localStorage minimal */}
        <div className="border-t border-editor-border mt-3 pt-2">
          {/* 백엔드 versions가 로드된 경우 (sessionId 있음 + 페치 성공) */}
          {sessionId && backendVersions !== null ? (
            <>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-editor-text-muted flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  자동저장 시점 ({backendVersions.length})
                </span>
              </div>
              {backendVersions.length === 0 ? (
                <p className="text-[11px] text-editor-text-muted leading-snug py-1">
                  아직 시점 기록이 없습니다. 1분 이상 편집 후 자동저장되면 시점이 만들어집니다.
                </p>
              ) : (
                <ul className="space-y-1 max-h-48 overflow-y-auto scrollbar-hide">
                  {backendVersions.map((v) => {
                    const date = new Date(v.savedAt)
                    const restoring = restoringId === v.id
                    const confirming = confirmingId === v.id
                    return (
                      <li
                        key={v.id}
                        className={cn(
                          'rounded transition-colors',
                          confirming
                            ? 'bg-editor-accent/5 border border-editor-accent/30'
                            : 'hover:bg-editor-hover'
                        )}
                        title={confirming ? undefined : date.toLocaleString('ko-KR')}
                      >
                        {confirming ? (
                          // P0-4 — confirm 카드 (실수 클릭 방지)
                          <div className="px-2 py-2 flex flex-col gap-1.5">
                            <p className="text-[11px] text-editor-text leading-snug">
                              <span className="font-semibold text-editor-accent">
                                {formatRelative(date)}
                              </span>{' '}
                              시점으로 복원합니다.
                            </p>
                            <p className="text-[10px] text-amber-600 leading-snug">
                              ⚠ 현재 편집 중인 내용은 덮어씌워집니다. 페이지가 자동으로 새로고침됩니다.
                            </p>
                            <div className="flex gap-1.5 mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleRestoreConfirm(v.id)}
                                disabled={restoring}
                                className={cn(
                                  'flex-1 text-[10px] px-2 py-1.5 rounded border border-editor-accent bg-editor-accent text-white hover:bg-editor-accent-hover transition-colors flex items-center justify-center gap-1',
                                  restoring && 'opacity-60 cursor-wait'
                                )}
                                aria-label="복원 확인"
                              >
                                <Undo2 className="h-3 w-3" />
                                {restoring ? '복원 중…' : '확인 후 복원'}
                              </button>
                              <button
                                type="button"
                                onClick={handleRestoreCancel}
                                disabled={restoring}
                                className="flex-1 text-[10px] px-2 py-1.5 rounded border border-editor-border bg-editor-surface-low hover:bg-editor-hover text-editor-text-muted transition-colors"
                                aria-label="복원 취소"
                              >
                                취소
                              </button>
                            </div>
                          </div>
                        ) : (
                          // 일반 list item (복원 버튼 → confirm 단계로)
                          <div className="flex items-center justify-between gap-2 px-2 py-1">
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-[11px] text-editor-text truncate">
                                {formatRelative(date)}
                              </span>
                              <span className="text-[10px] text-editor-text-muted">
                                {v.pageCount}페이지
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRestoreClick(v.id)}
                              disabled={restoring || confirmingId !== null}
                              className={cn(
                                'text-[10px] px-1.5 py-1 rounded border border-editor-border bg-editor-surface-low hover:bg-editor-hover hover:border-editor-accent text-editor-text-muted transition-colors flex items-center gap-1',
                                (restoring || confirmingId !== null) && 'opacity-50 cursor-not-allowed'
                              )}
                              title="이 시점으로 복원"
                              aria-label={`${formatRelative(date)} 시점으로 복원`}
                            >
                              <Undo2 className="h-3 w-3" />
                              복원
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              <p className="mt-1.5 text-[10px] text-editor-text-muted leading-snug">
                자동저장은 1분에 한 번 시점을 기록하고 최근 20개를 유지합니다.
              </p>
            </>
          ) : (
            <>
              {/* sessionId 없는 경우(임베드 미연결) — 트랙 BB minimal localStorage 메타 표시 */}
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
                시점별 복원은 세션 컨텍스트(sessionId)가 있을 때만 활성화됩니다.
              </p>
            </>
          )}
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
