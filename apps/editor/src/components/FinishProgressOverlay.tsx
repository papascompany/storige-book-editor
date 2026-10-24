import { useEffect, useRef } from 'react'
import { Check } from 'lucide-react'

/**
 * B10 (2026-10-25): 편집완료 진행 표시 + 진행 중 이탈 경고.
 *
 * 편집완료(저장 → PDF 생성 → 업로드 → 완료)는 캔버스 수에 따라 수십 초가 걸린다. 이 오버레이는
 * 현재 단계와 PDF 생성 캔버스 진행 수를 보여 주고, 진행 중에는 `beforeunload` 경고를 건다
 * (탭 닫기·새로고침 시 생성이 중단되면 세션이 완료되지 않은 채 남기 때문). 상품 종류와 무관한 공통 UI.
 * 진행 수 정보원은 canvas-core ServicePlugin.saveMultiPagePDFAsBlob 의 onProgress(page, total) 콜백이다.
 */

export type FinishProgressStage = 'save' | 'generate' | 'upload' | 'complete'

export interface FinishProgress {
  stage: FinishProgressStage
  /** PDF 생성 단계에서 현재 처리 중인 캔버스 순번(1-based). 0 = 아직 시작 전 */
  current?: number
  /** PDF 생성 대상 캔버스 총수 */
  total?: number
}

export const FINISH_STAGES: ReadonlyArray<{ stage: FinishProgressStage; label: string }> = [
  { stage: 'save', label: '저장' },
  { stage: 'generate', label: 'PDF 생성' },
  { stage: 'upload', label: '업로드' },
  { stage: 'complete', label: '완료' },
]

export const FINISH_LEAVE_WARNING = '편집완료를 진행하고 있습니다. 지금 나가면 완료되지 않을 수 있습니다.'

/** 생성 진행률(0~100) — 처리 중인 캔버스 직전까지를 완료분으로 본다. 총수를 모르면 null */
export function finishProgressPercent(progress: FinishProgress): number | null {
  if (progress.stage !== 'generate') return null
  const total = progress.total ?? 0
  if (total <= 0) return null
  const done = Math.min(Math.max((progress.current ?? 0) - 1, 0), total)
  return Math.round((done / total) * 100)
}

export interface FinishLeaveGuard {
  /** beforeunload 경고 등록(중복 호출 무해) */
  arm(): void
  /** beforeunload 경고 해제(중복 호출 무해) */
  disarm(): void
  readonly armed: boolean
}

/**
 * 편집완료 이탈 경고 — 등록·해제를 **동기**로 한다. 완료 이벤트를 받은 호스트가 곧바로 iframe 을
 * 이동시킬 수 있으므로, 렌더 후 effect 가 아니라 완료/오류 이벤트 발신 직전에 해제해야 정상 완료에
 * 경고가 뜨지 않는다.
 */
export function createFinishLeaveGuard(target: Window = window): FinishLeaveGuard {
  let armed = false
  const handleBeforeUnload = (e: BeforeUnloadEvent): string => {
    e.preventDefault()
    e.returnValue = FINISH_LEAVE_WARNING
    return FINISH_LEAVE_WARNING
  }
  return {
    arm() {
      if (armed) return
      armed = true
      target.addEventListener('beforeunload', handleBeforeUnload)
    },
    disarm() {
      if (!armed) return
      armed = false
      target.removeEventListener('beforeunload', handleBeforeUnload)
    },
    get armed() {
      return armed
    },
  }
}

/** 컴포넌트 수명 동안 같은 가드 인스턴스 — 언마운트 시 해제한다. */
export function useFinishLeaveGuard(): FinishLeaveGuard {
  const ref = useRef<FinishLeaveGuard | null>(null)
  if (!ref.current) ref.current = createFinishLeaveGuard()
  const guard = ref.current
  useEffect(() => () => guard.disarm(), [guard])
  return guard
}

interface FinishProgressOverlayProps {
  progress: FinishProgress | null
  /** 단계 안의 세부 안내(예: '내지 PDF 생성 중 (3/24)...') */
  detail?: string
}

export default function FinishProgressOverlay({ progress, detail }: FinishProgressOverlayProps) {
  if (!progress) return null
  const activeIndex = FINISH_STAGES.findIndex((s) => s.stage === progress.stage)
  const percent = finishProgressPercent(progress)
  const total = progress.total ?? 0
  const current = Math.min(Math.max(progress.current ?? 0, 0), total)

  return (
    <div
      className="absolute inset-0 z-[200] flex items-center justify-center bg-black/50"
      data-testid="finish-progress-overlay"
    >
      <div
        className="bg-white rounded-lg p-6 flex flex-col items-center gap-4 min-w-[300px]"
        role="status"
        aria-live="polite"
      >
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-editor-accent" />
        <ol className="flex items-center gap-2 text-sm" aria-label="편집완료 단계">
          {FINISH_STAGES.map((s, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'pending'
            return (
              <li
                key={s.stage}
                data-stage={s.stage}
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
                className={
                  state === 'active'
                    ? 'flex items-center gap-1 font-semibold text-editor-accent'
                    : state === 'done'
                      ? 'flex items-center gap-1 text-editor-text'
                      : 'flex items-center gap-1 text-gray-400'
                }
              >
                {state === 'done' && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                <span>{s.label}</span>
                {i < FINISH_STAGES.length - 1 && <span className="text-gray-300" aria-hidden="true">›</span>}
              </li>
            )
          })}
        </ol>
        {progress.stage === 'generate' && total > 0 && (
          <div className="w-full flex flex-col items-center gap-1">
            <div className="w-full h-1.5 rounded bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-editor-accent transition-[width] duration-300"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-editor-text" data-testid="finish-progress-count">
              캔버스 {current} / {total}
            </p>
          </div>
        )}
        {detail && <p className="text-editor-text text-sm">{detail}</p>}
        <p className="text-xs text-gray-500">완료될 때까지 창을 닫거나 새로고침하지 마세요.</p>
      </div>
    </div>
  )
}
