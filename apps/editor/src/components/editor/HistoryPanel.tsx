import { useEffect, useState, useCallback } from 'react'
import { History, Clock, RotateCcw, Save, FileText, Undo2, ImageOff } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useAutoSaveSnapshotsStore } from '@/stores/useAutoSaveSnapshotsStore'
import { showToast } from '@/stores/useToastStore'
import { sessionsApi } from '@/api/sessions'
import { HistoryPlugin } from '@storige/canvas-core'
import { resolveAssetUrl as resolveThumbnailUrl } from '@/utils/resolveAssetUrl'
import { cn } from '@/lib/utils'
import type { EditSessionVersionSummary } from '@/api/edit-sessions'
import {
  describeVersionReason,
  formatVersionPages,
  sortVersionsNewestFirst,
} from '@/utils/sessionVersions'

// 썸네일 URL 정규화는 공유 헬퍼 resolveAssetUrl 로 일원화(P0-B, 2026-06-15).
// 백엔드는 `/storage/files/...` 상대 경로를 반환하므로 API origin 을 prefix 한다.

interface BackendVersion {
  id: string
  savedAt: string
  pageCount: number
  createdBy: string | null
  thumbnailUrl: string | null
}

/**
 * P1-4 (2026-08-22) — 임베드(/embed, file_edit_sessions) 세션 버전 소스.
 * 임베드는 useEditorStore.sessionId 를 쓰지 않고 세션을 embed.tsx 가 소유하므로,
 * 목록/복원을 콜백으로 주입받는다. 복원 후 라이브 재하이드레이션도 embed 가 수행한다
 * (레거시 경로의 window.location.reload 와 달리 iframe 내 in-place 재초기화).
 */
export interface SessionVersionsSource {
  /** 스냅샷 목록(최신순 권장 — 패널이 한 번 더 정렬) */
  list: () => Promise<EditSessionVersionSummary[]>
  /** 해당 스냅샷으로 복원 + 라이브 적용. 실패 시 throw. */
  restore: (versionId: string) => Promise<void>
}

export interface HistoryPanelProps {
  /** 임베드 세션 버전 소스. 주어지면 레거시(sessionsApi) 분기 대신 이 소스를 사용. */
  sessionVersions?: SessionVersionsSource | null
  /**
   * 레거시 시점 분기(useEditorStore.sessionId persist + /editor/sessions) 사용 여부. 기본 true.
   * 임베드는 false — 같은 origin 의 레거시 `/` 방문에서 persist 된 sessionId 가 남아 있으면
   * 소스가 null 인 창(ready 이전·replace 세션)에 다른 세션의 이력이 뜨고 리로드 복원까지 가능했다.
   */
  legacyVersions?: boolean
}

/** 서버 오류 메시지 정규화 — class-validator 400 은 string[] 로 오고, 5xx 는 영문 고정 문구 */
function describeApiError(err: unknown, fallback: string): string {
  const e = err as { response?: { status?: number; data?: { message?: unknown; code?: string } }; message?: string }
  const raw = e?.response?.data?.message
  if (Array.isArray(raw)) return raw.map(String).join(', ')
  if (typeof raw === 'string' && raw && (e?.response?.status ?? 0) < 500) return raw
  if (typeof e?.message === 'string' && e.message && !e.response) return e.message
  return fallback
}

/**
 * 히스토리 요약 패널 (트랙 Q — 작은 진척)
 *
 * 헤더의 History 아이콘 버튼을 누르면 popover로 표시:
 * - 되돌릴 수 있는 단계 수 (canvas.historyUndo.length)
 * - 다시 실행 가능한 단계 수 (historyRedo.length)
 * - 마지막 저장 시각 (useSaveStore.lastSavedAt)
 * - 현재 dirty 여부
 *
 * 향후 확장 (Phase 2 — cover.md 향후 작업 표 참고):
 * - 자동저장 스냅샷 list (백엔드 versions API 필요)
 * - 시점별 thumbnail 미리보기 + "여기로 복원" 액션
 * - 사용자 마일스톤 마킹 (별표)
 */

function formatRelative(date: Date | null): string {
  // null 은 lastSavedAt 경로에서만 온다(버전 목록은 항상 실제 Date). '없음' 은 "저장이 안 됐다"로
  // 읽혀 오도되므로 "아직 저장 기록이 없다"는 사실만 말한다.
  if (!date) return '기록 없음'
  const diff = Date.now() - date.getTime()
  if (diff < 60_000) return '방금 전'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`
  return date.toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function HistoryPanel({ sessionVersions = null, legacyVersions = true }: HistoryPanelProps = {}) {
  const [open, setOpen] = useState(false)
  const ready = useAppStore((s) => s.ready)
  const canvas = useAppStore((s) => s.canvas)
  const getPlugin = useAppStore((s) => s.getPlugin)
  const lastSavedAt = useSaveStore((s) => s.lastSavedAt)
  const isDirty = useSaveStore((s) => s.isDirty)
  /** P1-4: 서버 저장이 진행 중이면 복원을 잠시 막는다(진행 중 PATCH 가 복원본을 되덮는 경합 차단) */
  const isSavingNow = useSaveStore((s) => s.status === 'saving')
  const allEditors = useAppStore((s) => s.allEditors)
  const snapshots = useAutoSaveSnapshotsStore((s) => s.snapshots)
  const clearSnapshots = useAutoSaveSnapshotsStore((s) => s.clearSnapshots)
  // BB-Phase 3 — sessionId가 있으면 백엔드 versions 페치, 없으면 localStorage snapshots 사용
  const sessionId = useEditorStore((s) => s.sessionId)
  const userId = useEditorStore((s) => s.userId)
  const [backendVersions, setBackendVersions] = useState<BackendVersion[] | null>(null)
  /** P1-4 — 임베드 세션 버전 목록(null=미로드/로드 중, 배열=로드 완료) */
  const [sessionVersionList, setSessionVersionList] = useState<EditSessionVersionSummary[] | null>(null)
  const [sessionVersionError, setSessionVersionError] = useState<string | null>(null)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  /** P0-4: 복원 confirm 대기 중인 versionId (실수 클릭 방지). null이면 일반 list 모드 */
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  /** BB-Phase 3 follow-up: hover 시 큰 썸네일 미리보기 표시할 versionId */
  const [hoverPreviewId, setHoverPreviewId] = useState<string | null>(null)

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
        try { editor.off?.('historyUpdate', fn) } catch { /* noop */ }
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

  // P1-4 — popover 열릴 때 임베드 세션 버전 목록 페치(소스가 주입된 경우만)
  useEffect(() => {
    if (!open || !sessionVersions) {
      setSessionVersionList(null)
      setSessionVersionError(null)
      return
    }
    let cancelled = false
    setSessionVersionError(null)
    sessionVersions
      .list()
      .then((list) => {
        if (cancelled) return
        setSessionVersionList(sortVersionsNewestFirst(Array.isArray(list) ? list : []))
      })
      .catch((err: any) => {
        console.warn('[HistoryPanel] 세션 버전 목록 실패:', err?.message ?? err)
        if (cancelled) return
        setSessionVersionList([])
        setSessionVersionError(describeApiError(err, '목록을 불러오지 못했습니다. 잠시 후 다시 열어주세요.'))
      })
    return () => {
      cancelled = true
    }
  }, [open, sessionVersions])

  // BB-Phase 3 — popover 열릴 때 백엔드 versions 페치 (sessionId 있을 때만, 임베드 소스가 없을 때)
  useEffect(() => {
    if (!open || !sessionId || sessionVersions || !legacyVersions) {
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
  }, [open, sessionId, userId, sessionVersions, legacyVersions])

  // P0-4 — 복원 클릭 시 confirm 단계 enter (즉시 API 호출하지 않음)
  const handleRestoreClick = useCallback((versionId: string) => {
    setConfirmingId(versionId)
  }, [])

  // P0-4 — confirm 후 실제 복원 수행 + 성공 시 자동 페이지 reload
  const handleRestoreConfirm = useCallback(
    async (versionId: string) => {
      // P1-4 — 임베드 세션 버전: embed 가 서버 복원 + in-place 재하이드레이션을 수행(리로드 없음)
      if (sessionVersions) {
        setRestoringId(versionId)
        try {
          await sessionVersions.restore(versionId)
          showToast('선택한 시점으로 되돌렸습니다. 직전 상태는 "복원 직전" 시점으로 목록에 남아요.', 'success', 4000)
          setOpen(false)
        } catch (err: any) {
          console.error('[HistoryPanel] 세션 버전 복원 실패:', err)
          showToast(`복원 실패: ${describeApiError(err, '알 수 없는 오류')}`, 'error', 6000)
        } finally {
          setRestoringId(null)
          setConfirmingId(null)
        }
        return
      }
      if (!sessionId) return
      setRestoringId(versionId)
      try {
        await sessionsApi.restoreVersion(sessionId, versionId, userId || undefined)
        showToast('시점으로 복원되었습니다. 페이지를 새로고침합니다…', 'success', 2500)
        // 캔버스 / store / 모든 객체를 깨끗이 다시 로드 — 가장 안전한 방법은 페이지 새로고침
        // (in-place reload는 useEditorStore + 모든 캔버스 plugin reload 흐름이 복잡)
        setTimeout(() => {
          try { window.location.reload() } catch { /* noop */ }
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
    [sessionId, userId, sessionVersions]
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
      {/* P1-4 실기(2026-08-23): align=end 는 트리거(헤더 좌측 x≈157)에서 왼쪽으로 펼쳐져 z-[101] ToolBar/FeatureSidebar(z-100)
          아래 가려졌다(기본 z-50). 오른쪽으로 펼치고 z 를 올린다. */}
      <PopoverContent align="start" sideOffset={8} collisionPadding={8} className="w-80 p-3 z-[150]">
        <div className="text-[12px] font-semibold text-editor-text mb-2 flex items-center gap-2">
          <History className="h-4 w-4 text-editor-accent" />
          변경 이력 요약
        </div>

        <div className="space-y-2 text-sm">
          <Row icon={RotateCcw} label="되돌릴 수 있는 단계" value={`${undoLen}단계`} />
          <Row icon={RotateCcw} label="다시 실행 가능" value={`${redoLen}단계`} flipIcon />
          {/* 라벨을 '마지막 저장' 으로 넓힌 이유: 시드 원천인 세션 updatedAt 은 @UpdateDateColumn 이라
              자동저장 외 PATCH(편집완료·contentPdf 첨부·검증결과 캐시)로도 갱신된다. '자동저장' 이라
              단정하면 시드값과 어긋난다. */}
          <Row icon={Save} label="마지막 저장" value={formatRelative(lastSavedAt)} />
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

        {/* 자동저장 스냅샷 list — P1-4 임베드 세션 버전 > BB-Phase 3 백엔드 versions > localStorage minimal */}
        <div className="border-t border-editor-border mt-3 pt-2">
          {sessionVersions ? (
            <div data-testid="session-versions">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-editor-text-muted flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5" />
                  저장 시점{sessionVersionList ? ` (${sessionVersionList.length})` : ''}
                </span>
              </div>
              {sessionVersionList === null ? (
                <p className="text-[11px] text-editor-text-muted leading-snug py-1" role="status">
                  시점을 불러오는 중…
                </p>
              ) : sessionVersionError ? (
                <p className="text-[11px] text-red-600 leading-snug py-1" role="alert">
                  {sessionVersionError}
                </p>
              ) : sessionVersionList.length === 0 ? (
                <p className="text-[11px] text-editor-text-muted leading-snug py-1">
                  아직 저장 시점이 없습니다. 편집 후 자동저장되면 시점이 만들어집니다.
                </p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-y-auto scrollbar-hide" aria-label="저장 시점 목록">
                  {sessionVersionList.map((v) => {
                    const date = new Date(v.createdAt)
                    const restoring = restoringId === v.id
                    const confirming = confirmingId === v.id
                    const reason = describeVersionReason(v.reason)
                    const pagesText = formatVersionPages(v)
                    return (
                      <li
                        key={v.id}
                        className={cn(
                          'rounded transition-colors',
                          confirming
                            ? 'bg-editor-accent/5 border border-editor-accent/30'
                            : 'hover:bg-editor-hover',
                        )}
                        title={confirming ? undefined : date.toLocaleString('ko-KR')}
                      >
                        {confirming ? (
                          <div className="px-2 py-2 flex flex-col gap-1.5">
                            <p className="text-[11px] text-editor-text leading-snug">
                              <span className="font-semibold text-editor-accent">{formatRelative(date)}</span>{' '}
                              시점으로 되돌립니다 ({pagesText}).
                            </p>
                            <p className="text-[10px] text-editor-text-muted leading-snug">
                              편집 중인 내용은 먼저 저장되고, 현재 상태는 &quot;복원 직전&quot; 시점으로 목록에 남아
                              다시 고를 수 있습니다.
                            </p>
                            <div className="flex gap-1.5 mt-0.5">
                              <button
                                type="button"
                                onClick={() => handleRestoreConfirm(v.id)}
                                disabled={restoring || isSavingNow}
                                className={cn(
                                  'flex-1 text-[10px] px-2 py-1.5 rounded border border-editor-accent bg-editor-accent text-white hover:bg-editor-accent-hover transition-colors flex items-center justify-center gap-1',
                                  restoring && 'opacity-60 cursor-wait',
                                  !restoring && isSavingNow && 'opacity-50 cursor-not-allowed',
                                )}
                                aria-label="여기로 복원 확인"
                                title={isSavingNow ? '저장 중 — 잠시 후 복원할 수 있어요' : undefined}
                              >
                                <Undo2 className="h-3 w-3" />
                                {restoring ? '되돌리는 중…' : isSavingNow ? '저장 중…' : '여기로 복원'}
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
                          <div className="flex items-center gap-2 px-2 py-1">
                            <div className="flex flex-col min-w-0 flex-1">
                              <span className="text-[11px] text-editor-text truncate flex items-center gap-1.5">
                                {formatRelative(date)}
                                <span
                                  className={cn(
                                    'inline-flex items-center px-1.5 py-px rounded-full text-[9px] font-medium border',
                                    reason.tone === 'warning' && 'bg-amber-500/15 text-amber-700 border-amber-300/60',
                                    reason.tone === 'info' && 'bg-sky-500/15 text-sky-700 border-sky-300/60',
                                    reason.tone === 'neutral' && 'bg-editor-surface-low text-editor-text-muted border-editor-border',
                                  )}
                                >
                                  {reason.label}
                                </span>
                              </span>
                              <span className="text-[10px] text-editor-text-muted">{pagesText}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRestoreClick(v.id)}
                              disabled={restoringId !== null || confirmingId !== null || isSavingNow}
                              className={cn(
                                'text-[10px] px-1.5 py-1 rounded border border-editor-border bg-editor-surface-low hover:bg-editor-hover hover:border-editor-accent text-editor-text-muted transition-colors flex items-center gap-1',
                                (restoringId !== null || confirmingId !== null || isSavingNow) && 'opacity-50 cursor-not-allowed',
                              )}
                              title={isSavingNow ? '저장 중 — 잠시 후 복원할 수 있어요' : '이 시점으로 되돌리기'}
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
                편집이 저장될 때 1분에 한 번 시점을 남기고, 페이지 수가 줄어들기 직전에는 즉시 남깁니다. 최근
                10개를 유지합니다(페이지 감소 직전 시점은 추가 보호). 장 수는 편집 화면 기준 — 표지와 각
                펼침면을 1장으로 셉니다.
              </p>
            </div>
          ) : legacyVersions && sessionId && backendVersions !== null ? (
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
                          <div
                            className="relative flex items-center gap-2 px-2 py-1"
                            onMouseEnter={() => v.thumbnailUrl && setHoverPreviewId(v.id)}
                            onMouseLeave={() => setHoverPreviewId((prev) => (prev === v.id ? null : prev))}
                          >
                            {/* 썸네일 mini (28x40) — null이면 placeholder */}
                            <ThumbnailMini url={resolveThumbnailUrl(v.thumbnailUrl)} />
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
                            {/* hover 큰 미리보기 — popover 우측에 floating */}
                            {hoverPreviewId === v.id && v.thumbnailUrl && (
                              <div
                                className="absolute left-full top-0 ml-2 z-50 pointer-events-none rounded border border-editor-border bg-editor-panel shadow-lg p-1"
                                aria-hidden
                              >
                                <img
                                  src={resolveThumbnailUrl(v.thumbnailUrl) || ''}
                                  alt=""
                                  className="block w-[160px] h-auto max-h-[220px] object-contain"
                                />
                              </div>
                            )}
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

/**
 * BB-Phase 3 follow-up — 시점 list item에 표시하는 썸네일 mini.
 * - 28x40 (A4 portrait 비율 근사)
 * - URL이 null이면 placeholder 아이콘 (모바일에서 캡처 스킵된 시점)
 */
function ThumbnailMini({ url }: { url: string | null }) {
  if (!url) {
    return (
      <div
        className="flex-shrink-0 w-7 h-10 rounded border border-editor-border bg-editor-surface-low flex items-center justify-center"
        aria-label="썸네일 없음"
        title="이 시점은 썸네일이 없습니다 (모바일 캡처 스킵 또는 업로드 실패)"
      >
        <ImageOff className="h-3 w-3 text-editor-text-muted opacity-50" />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt=""
      className="flex-shrink-0 w-7 h-10 rounded border border-editor-border object-cover bg-editor-surface-low"
      loading="lazy"
    />
  )
}
