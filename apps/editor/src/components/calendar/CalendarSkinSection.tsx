import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCalendarSkinStore, type SkinCardReason } from '@/stores/useCalendarSkinStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { showToast } from '@/stores/useToastStore'
import {
  SKIN_FATAL_MESSAGE,
  executeSkinApply,
  isCalendarSkinsFlagEnabled,
  prepareSkinApply,
  undoSkinApply,
  type SkinApplyPlan,
  type SkinBackgroundChoice,
  type SkinRejectReason,
} from '@/utils/calendarSkinApply'
import { isCalendarProfile } from '@/utils/productProfile'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'
import CalendarSkinConfirmModal from './CalendarSkinConfirmModal'

/**
 * CalendarSkinSection — 달력 패널 「디자인」 절(캘린더 디자인 묶음 = 스킨 선택)
 *
 * 노출: 캘린더 프로파일 + `calendar.skins` 1개 이상 + `VITE_ENABLE_CALENDAR_SKINS !== 'false'` + editMode 아님 + 기준 세트 id 를 앎.
 * 완료 뒤 재편집 세션에서도 보인다. 고객 미리보기 중에는 보이되 비활성(저장 경로가 미리보기 중 저장을 거부한다).
 * 카드를 누르기 전에는 스킨 세트를 받지 않는다. 미리보기는 카드 썸네일만 쓴다.
 */

export const SKIN_SECTION_TITLE = '디자인'
export const DEFAULT_SKIN_LABEL = '기본 디자인'
export const SKIN_PREVIEW_DISABLED_MESSAGE = '미리보기 중에는 디자인을 바꿀 수 없습니다'
export const SKIN_UNKNOWN_CURRENT_MESSAGE = '현재: 목록에 없는 디자인'
export const SKIN_BASE_UNAVAILABLE_MESSAGE = '지금은 디자인을 바꿀 수 없습니다'
export const SKIN_SAVE_FAILED_MESSAGE = '저장하지 못해 디자인을 바꾸지 않았습니다.'
export const SKIN_FAILED_MESSAGE = '디자인을 바꾸지 못해 이전 상태로 되돌렸습니다'

export const SKIN_CARD_REASON_MESSAGES: Record<SkinCardReason, string> = {
  missing: '더 이상 제공되지 않는 디자인입니다',
  incompatible: '지금 상품과 맞지 않는 디자인입니다',
}

const REJECT_MESSAGES: Partial<Record<SkinRejectReason, string>> = {
  ...SKIN_CARD_REASON_MESSAGES,
  network: '디자인을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
  saving: '저장 중입니다. 잠시 후 다시 시도해 주세요.',
  'base-unavailable': SKIN_BASE_UNAVAILABLE_MESSAGE,
  preview: SKIN_PREVIEW_DISABLED_MESSAGE,
  busy: '디자인을 바꾸는 중입니다.',
}

export function appliedMessage(label: string): string {
  return `디자인을 「${label}」(으)로 바꿨습니다`
}

interface DialogState {
  mode: 'confirm' | 'blocked'
  plan: SkinApplyPlan
  suspectIndices: number[]
}

interface CardProps {
  label: string
  thumbnailUrl: string | null | undefined
  current: boolean
  disabled: boolean
  checking: boolean
  reason?: string
  onClick: () => void
}

function SkinCard({ label, thumbnailUrl, current, disabled, checking, reason, onClick }: CardProps) {
  const src = resolveAssetUrl(thumbnailUrl)
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={current}
      aria-label={`디자인 ${label}`}
      title={reason}
      className={cn(
        'flex flex-col gap-1 rounded-md border p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        current ? 'border-editor-accent ring-2 ring-editor-accent' : 'border-editor-border hover:border-editor-accent',
      )}
    >
      <div className="aspect-[4/3] w-full overflow-hidden rounded bg-editor-surface-low flex items-center justify-center">
        {src ? (
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[11px] text-editor-text-muted">미리보기 없음</span>
        )}
      </div>
      <span className="truncate text-xs text-editor-text">{checking ? '확인 중…' : label}</span>
      {reason && <span className="text-[11px] text-editor-text-muted">{reason}</span>}
    </button>
  )
}

export default function CalendarSkinSection() {
  const profile = useSettingsStore((s) => s.productProfile)
  const editMode = useSettingsStore((s) => s.currentSettings.editMode)
  const customerPreview = useSettingsStore((s) => s.customerPreview)
  const linked = useSettingsStore((s) => s.linkedPrintTemplates)
  const skinKey = useCalendarStore((s) => s.meta?.skinKey)
  const baseTemplateSetId = useCalendarSkinStore((s) => s.baseTemplateSetId)
  const baseUnavailable = useCalendarSkinStore((s) => s.baseUnavailable)
  const cardReasons = useCalendarSkinStore((s) => s.cardReasons)
  const phase = useCalendarSkinStore((s) => s.phase)
  const activeKey = useCalendarSkinStore((s) => s.activeKey)
  const undo = useCalendarSkinStore((s) => s.undo)

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const skins = isCalendarProfile(profile) ? profile.calendar.skins ?? [] : []
  const visible = skins.length > 0 && isCalendarSkinsFlagEnabled() && editMode !== true && baseTemplateSetId !== null

  const busy = phase === 'checking' || phase === 'applying' || phase === 'fatal' || dialog !== null
  const unknownCurrent = skinKey !== undefined && !skins.some((s) => s.key === skinKey)

  const pick = useCallback(async (key: string | undefined) => {
    if (useCalendarSkinStore.getState().phase === 'checking' || useCalendarSkinStore.getState().phase === 'applying') return
    setNotice(null)
    if (useSaveStore.getState().status === 'saving') {
      setNotice(REJECT_MESSAGES.saving ?? null)
      return
    }
    if (key === useCalendarStore.getState().meta?.skinKey) return
    useCalendarSkinStore.getState().setPhase('checking', key ?? '')
    let out: Awaited<ReturnType<typeof prepareSkinApply>>
    try {
      out = await prepareSkinApply(key)
    } catch (e) {
      // 예외로 'checking' 에 갇히지 않게 상태를 푼다(준비 단계는 캔버스·스토어를 바꾸지 않는다)
      console.warn('[calendarSkin] 적용 준비 실패:', e instanceof Error ? e.message : e)
      useCalendarSkinStore.getState().setPhase('idle')
      setNotice(REJECT_MESSAGES.network ?? null)
      return
    }
    if (out.kind === 'noop') {
      useCalendarSkinStore.getState().setPhase('idle')
      return
    }
    if (out.kind === 'rejected') {
      useCalendarSkinStore.getState().setPhase('idle')
      setNotice(REJECT_MESSAGES[out.reason] ?? null)
      return
    }
    if (out.kind === 'blocked') {
      useCalendarSkinStore.getState().setPhase('blocked')
      setDialog({ mode: 'blocked', plan: out.plan, suspectIndices: out.suspectIndices })
      return
    }
    useCalendarSkinStore.getState().setPhase('confirm')
    setDialog({ mode: 'confirm', plan: out.plan, suspectIndices: [] })
  }, [])

  const cancel = useCallback(() => {
    setDialog(null)
    useCalendarSkinStore.getState().setPhase('idle')
  }, [])

  const confirm = useCallback(async (plan: SkinApplyPlan, choice: SkinBackgroundChoice) => {
    setDialog(null)
    let out: Awaited<ReturnType<typeof executeSkinApply>>
    try {
      out = await executeSkinApply(plan, choice)
    } catch (e) {
      // 실행이 예외로 끝나면 'applying' 상태에 갇히지 않게 푼다(작업 오버레이는 executeSkinApply 가 보류 안에서 닫는다)
      console.warn('[calendarSkin] 적용 실패:', e instanceof Error ? e.message : e)
      useCalendarSkinStore.getState().setPhase('idle')
      showToast(SKIN_FAILED_MESSAGE, 'error', 5000)
      return
    }
    if (out.kind === 'aborted') {
      useCalendarSkinStore.getState().setPhase('idle')
      setNotice(out.reason === 'save-failed' ? SKIN_SAVE_FAILED_MESSAGE : REJECT_MESSAGES[out.reason] ?? null)
      return
    }
    if (out.kind === 'failed') {
      useCalendarSkinStore.getState().setPhase('idle')
      showToast(SKIN_FAILED_MESSAGE, 'error', 5000)
      return
    }
    showToast(appliedMessage(out.label), 'success')
  }, [])

  const revert = useCallback(async () => {
    const ok = await undoSkinApply()
    if (ok) {
      setNotice(null)
      showToast('디자인을 되돌렸습니다', 'info')
    }
  }, [])

  if (!visible) return null

  const disabledAll = busy || customerPreview || baseUnavailable
  const cards = [
    { key: undefined as string | undefined, label: DEFAULT_SKIN_LABEL, thumbnailUrl: linked[0]?.thumbnailUrl ?? null },
    ...skins.map((s) => ({ key: s.key as string | undefined, label: s.label, thumbnailUrl: s.thumbnailUrl ?? null })),
  ]

  return (
    <section className="flex flex-col gap-2" aria-label="디자인">
      <h3 className="text-xs font-semibold text-editor-text">{SKIN_SECTION_TITLE}</h3>
      {customerPreview && <p className="text-xs text-editor-text-muted">{SKIN_PREVIEW_DISABLED_MESSAGE}</p>}
      {baseUnavailable && <p className="text-xs text-editor-text-muted">{SKIN_BASE_UNAVAILABLE_MESSAGE}</p>}
      {unknownCurrent && <p className="text-xs text-editor-text-muted">{SKIN_UNKNOWN_CURRENT_MESSAGE}</p>}
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => {
          const reasonKey = c.key !== undefined ? cardReasons[c.key] : undefined
          const reason = reasonKey ? SKIN_CARD_REASON_MESSAGES[reasonKey] : undefined
          const current = unknownCurrent ? false : c.key === skinKey
          return (
            <SkinCard
              key={c.key ?? ''}
              label={c.label}
              thumbnailUrl={c.thumbnailUrl}
              current={current}
              disabled={disabledAll || reason !== undefined}
              checking={phase === 'checking' && activeKey === (c.key ?? '')}
              reason={reason}
              onClick={() => void pick(c.key)}
            />
          )
        })}
      </div>
      {notice && <p role="status" className="text-xs text-editor-text-muted">{notice}</p>}
      {phase === 'applied' && undo && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-editor-border p-2" role="status">
          <span className="text-xs text-editor-text">{appliedMessage(undo.label)}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void revert()}>
            적용 취소
          </Button>
        </div>
      )}
      {dialog && (
        <CalendarSkinConfirmModal
          mode={dialog.mode}
          plan={dialog.plan}
          suspectIndices={dialog.suspectIndices}
          onCancel={cancel}
          onConfirm={(choice) => void confirm(dialog.plan, choice)}
        />
      )}
      {phase === 'fatal' && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60" role="alertdialog" aria-modal="true" aria-label="화면 복구 실패">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full mx-4 p-6 flex flex-col gap-4">
            <p className="text-sm text-gray-800 leading-relaxed">{SKIN_FATAL_MESSAGE}</p>
            <Button type="button" onClick={() => window.location.reload()}>
              새로고침
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
