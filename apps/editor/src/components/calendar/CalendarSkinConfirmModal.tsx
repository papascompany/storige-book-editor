import { useEffect, useState } from 'react'
import { AlertTriangle as Warning, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SkinApplyPlan, SkinBackgroundChoice } from '@/utils/calendarSkinApply'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'

/**
 * CalendarSkinConfirmModal — 캘린더 디자인(스킨) 적용 확인 대화상자(RequiredEditConfirmModal 패턴)
 *
 * - `confirm`: dryRun 합계로 보존·이동·제외 개수를 보여 주고(값이 0인 줄은 생략) 배경 선택을 받는다.
 * - `blocked`: 판정 오류 의심 쪽을 알리고 닫기만 둔다(확인 버튼 없음).
 * Esc·바깥 클릭 = 취소(아무것도 바꾸지 않음).
 */

export const SKIN_UNDO_HISTORY_LINE = '적용하면 지금까지의 실행 취소(Ctrl+Z) 기록이 비워집니다. 적용 직후에는 「적용 취소」로 되돌릴 수 있습니다.'
export const SKIN_POSITION_RESET_LINE = '디자인 요소의 위치·크기를 바꾼 것은 새 디자인 값으로 돌아갑니다.'

/** 쪽 라벨 목록 — 3개를 넘으면 "외 n쪽" */
export function formatPageList(indices: readonly number[], labels: readonly string[]): string {
  const names = indices.map((i) => labels[i] ?? `${i + 1}쪽`)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}쪽`
}

/** 확인 대화상자 본문 줄(값이 0인 항목은 생략) */
export function buildSkinConfirmLines(plan: SkinApplyPlan): string[] {
  const s = plan.summarySkin
  const lines: string[] = []
  const moved = s.photosKept + s.photosClipRebuilt
  if (moved > 0) lines.push(`사진 ${moved}장은 그대로 옮깁니다.`)
  if (s.photosRefilled > 0) lines.push(`사진 ${s.photosRefilled}장은 새 사진틀에 맞춰 다시 넣습니다(확대·자르기는 처음 상태로 돌아갑니다).`)
  const keptParts: string[] = []
  if (s.customerKept > 0) keptParts.push(`직접 추가한 요소 ${s.customerKept}개`)
  if (plan.anniversaryCount > 0) keptParts.push(`기념일 ${plan.anniversaryCount}건`)
  if (keptParts.length > 0) lines.push(`${keptParts.join('와 ')}은 그대로 둡니다.`)
  if (s.textsMoved > 0) lines.push(`수정한 문구 ${s.textsMoved}건은 새 디자인의 같은 자리로 옮깁니다.`)
  const droppedParts: string[] = []
  if (s.textsDropped > 0) droppedParts.push(`문구 ${s.textsDropped}건`)
  if (s.photosDropped > 0) droppedParts.push(`사진 ${s.photosDropped}장`)
  if (droppedParts.length > 0) {
    const tail = s.photosDropped > 0 ? " 업로드한 사진은 '내 업로드'에 남습니다." : ''
    lines.push(`새 디자인에 자리가 없는 ${droppedParts.join('·')}은 빠집니다.${tail}`)
  }
  if (s.textsUnverified > 0) lines.push(`고쳤는지 확인할 수 없는 문구 ${s.textsUnverified}건은 새 디자인 문구로 바뀝니다.`)
  lines.push(SKIN_POSITION_RESET_LINE)
  lines.push(SKIN_UNDO_HISTORY_LINE)
  return lines
}

/** '스킨 배경 사용' 선택지 설명 */
export function buildSkinBackgroundLine(plan: SkinApplyPlan): string {
  const b = plan.backgrounds
  const removed = b.removedCanvasIndices.length
  const registrable = b.uploadsByCanvas.reduce((n, list) => n + list.length, 0)
  const parts: string[] = []
  if (removed > 0) parts.push(`내 배경을 넣은 ${removed}쪽은 새 디자인 배경으로 바꿉니다.`)
  if (registrable > 0) parts.push(`업로드한 배경 ${registrable}개는 '내 업로드'에 남습니다.`)
  if (b.forcedKeepIndices.length > 0) {
    parts.push(
      `${formatPageList(b.forcedKeepIndices, plan.pageLabels)}은 내 배경을 다시 넣을 수 없는 형식이라 그대로 둡니다(그 쪽은 새 디자인 배경을 쓰지 않습니다).`,
    )
  }
  return parts.join(' ')
}

/** '내 배경 유지' 선택지 설명 */
export function buildKeepBackgroundLine(plan: SkinApplyPlan): string {
  const k = plan.summaryKeep
  const replaced = k.skinBackgroundsReplaced > 0 ? `, 그 쪽의 새 디자인 배경 ${k.skinBackgroundsReplaced}개는 쓰지 않습니다.` : '.'
  return `내 배경 ${k.customerBackgroundsKept}쪽을 그대로 두고${replaced}`
}

export function buildSkinBlockedMessage(suspectIndices: readonly number[], labels: readonly string[]): string {
  return `이 디자인은 지금 작업에 바로 적용할 수 없습니다. 기존 디자인 요소를 구분하지 못한 쪽이 있습니다(${formatPageList(suspectIndices, labels)}). 작업 내용은 바뀌지 않았습니다.`
}

export interface CalendarSkinConfirmModalProps {
  mode: 'confirm' | 'blocked'
  plan: SkinApplyPlan
  suspectIndices?: number[]
  onCancel: () => void
  onConfirm: (choice: SkinBackgroundChoice) => void
}

export default function CalendarSkinConfirmModal({ mode, plan, suspectIndices = [], onCancel, onConfirm }: CalendarSkinConfirmModalProps) {
  const [choice, setChoice] = useState<SkinBackgroundChoice>('skin')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  const thumb = resolveAssetUrl(plan.thumbnailUrl)
  const blocked = mode === 'blocked'
  const title = blocked ? '디자인을 바꿀 수 없습니다' : `디자인을 「${plan.label}」(으)로 바꿀까요?`

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50" onClick={onCancel}>
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-label={blocked ? '디자인 적용 불가' : '디자인 변경 확인'}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            {blocked && (
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Warning className="w-5 h-5 text-amber-600" />
              </div>
            )}
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-11 h-11 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400"
            aria-label="닫기"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
          {thumb && !blocked && <img src={thumb} alt={`${plan.label} 미리보기`} className="w-full max-h-48 object-contain rounded border" />}
          {blocked ? (
            <p className="text-sm text-gray-700 leading-relaxed">{buildSkinBlockedMessage(suspectIndices, plan.pageLabels)}</p>
          ) : (
            <>
              <ul className="list-disc pl-5 flex flex-col gap-1 text-sm text-gray-700" aria-label="바뀌는 내용">
                {buildSkinConfirmLines(plan).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {plan.showBackgroundChoice && (
                <fieldset className="flex flex-col gap-2 rounded border p-3" aria-label="배경 선택">
                  <legend className="px-1 text-xs font-semibold text-gray-800">내 배경</legend>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="skin-background" checked={choice === 'skin'} onChange={() => setChoice('skin')} className="mt-1" />
                    <span>
                      <strong>스킨 배경 사용(기본)</strong> — {buildSkinBackgroundLine(plan)}
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-gray-700">
                    <input type="radio" name="skin-background" checked={choice === 'keep'} onChange={() => setChoice('keep')} className="mt-1" />
                    <span>
                      <strong>내 배경 유지</strong> — {buildKeepBackgroundLine(plan)}
                    </span>
                  </label>
                </fieldset>
              )}
            </>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t bg-gray-50">
          {blocked ? (
            <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={onCancel} autoFocus>
              닫기
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" className="flex-1 min-h-[44px]" onClick={onCancel}>
                취소
              </Button>
              <Button type="button" className="flex-1 min-h-[44px]" onClick={() => onConfirm(choice)} autoFocus>
                바꾸기
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
