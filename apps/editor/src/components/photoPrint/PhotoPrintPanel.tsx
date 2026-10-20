import { useEffect, useMemo, useState } from 'react'
import type { PhotoBorder, PhotoFinish, PhotoFit, PhotoItem, PhotoPrintProfile } from '@storige/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore, useCurrentIndex } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore, type PhotoItemOptionPatch } from '@/stores/usePhotoPrintStore'
import { applyPhotoPrintItem, resolvePhotoItemIndexForCanvas } from '@/utils/photoPrintRehydrate'
import { applyAllPhotoPrint } from '@/utils/photoPrintRehydrateAll'

/**
 * PhotoPrintPanel — 좌측 메뉴 `PHOTO_PRINT`(사진인화) 패널 (P2-d, 2026-10-19; CalendarPanel 모방)
 *
 * 항목 목록(사진 N): 매수 ±, 유테(none/white), 맞춤(paper-full/image-full), 마감(matte/glossy), 촬영일·흑백·밝기보정 토글
 * + '전체 적용'(현재 캔버스 항목의 옵션을 모든 항목에 복사). 프로파일 options 가 허용하지 않는 값은 노출하지 않는다
 * (어휘 1개면 select 생략, 플래그 정책 false 면 체크박스 생략). 변경은 usePhotoPrintStore 에 쓰고 해당 캔버스에
 * PhotoPrintPlugin.apply 를 호출한다(finish/brightnessFix/copies 는 통과만 — 캔버스 미적용).
 * ToolBar 가 productProfile.kind==='photo-print' 세트 또는 editMode 에서만 메뉴를 노출한다.
 */

export const BORDER_LABELS: Record<PhotoBorder, string> = { none: '무테', white: '유테(흰 테두리)' }
export const FIT_LABELS: Record<PhotoFit, string> = { 'paper-full': '페이퍼풀', 'image-full': '이미지풀' }
export const FINISH_LABELS: Record<PhotoFinish, string> = { matte: '무광', glossy: '유광' }
export const APPLY_ALL_LABEL = '현재 항목 설정을 전체 적용'
/** items[].lowRes(채움 dpi < sizes[0].minDpi) 배지 문구 */
export const LOW_RES_BADGE_LABEL = '저해상도'

const SELECT_CLASS =
  'h-8 rounded-md border border-editor-border bg-editor-panel px-2 text-xs text-editor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent disabled:cursor-not-allowed disabled:opacity-50'

/** 항목에서 '전체 적용' 으로 복사할 옵션(copies 는 항목 고유라 제외) */
export function pickSharedOptions(item: PhotoItem): PhotoItemOptionPatch {
  return {
    border: item.border,
    fit: item.fit,
    finish: item.finish,
    brightnessFix: item.brightnessFix,
    dateOverlay: item.dateOverlay,
    grayscale: item.grayscale,
  }
}

export default function PhotoPrintPanel() {
  const profile = usePhotoPrintStore((s) => s.profile)
  const items = usePhotoPrintStore((s) => s.items)
  const editMode = useSettingsStore((s) => s.currentSettings.editMode)
  const canvasCount = useAppStore((s) => s.allCanvas.length)
  const currentIndex = useCurrentIndex()

  // 캔버스 수와 항목 수 동기화(페이지 추가/삭제·세션 복원 뒤 패널이 열릴 때)
  useEffect(() => {
    if (!profile) return
    usePhotoPrintStore.getState().syncWithCanvasCount(canvasCount)
  }, [profile, canvasCount])

  const currentItemIndex = useMemo(
    () => (profile ? resolvePhotoItemIndexForCanvas(profile, currentIndex) : -1),
    [profile, currentIndex],
  )

  if (!profile) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="px-4 pt-4 pb-3 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-editor-text">사진인화</h2>
          <p className="text-sm text-editor-text-muted">
            {editMode ? '사진인화 상품 프로파일이 없는 세트입니다.' : '사진인화 상품이 아닙니다.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto">
      <div className="px-4 pt-4 pb-3 flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-editor-text">사진인화</h2>
        <ApplyAllSection items={items} currentItemIndex={currentItemIndex} />
        <ItemListSection profile={profile} items={items} currentItemIndex={currentItemIndex} />
      </div>
    </div>
  )
}

// ─── 전체 적용 ─────────────────────────────────────────────────────────────

function ApplyAllSection({ items, currentItemIndex }: { items: PhotoItem[]; currentItemIndex: number }) {
  const [busy, setBusy] = useState(false)
  const source = items[currentItemIndex]
  const applyAll = async () => {
    if (!source) return
    usePhotoPrintStore.getState().applyAll(pickSharedOptions(source))
    useSaveStore.getState().markDirty()
    setBusy(true)
    try {
      await applyAllPhotoPrint()
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-2" aria-label="전체 적용">
      <p className="text-xs text-editor-text-muted">
        {items.length > 0 ? `총 ${items.length}장 · 현재 사진 ${currentItemIndex + 1}` : '사진 항목이 없습니다.'}
      </p>
      <Button variant="outline" size="sm" disabled={busy || !source || items.length < 2} onClick={() => void applyAll()}>
        {APPLY_ALL_LABEL}
      </Button>
    </section>
  )
}

// ─── 항목 목록 ─────────────────────────────────────────────────────────────

interface ItemListSectionProps {
  profile: PhotoPrintProfile
  items: PhotoItem[]
  currentItemIndex: number
}

function ItemListSection({ profile, items, currentItemIndex }: ItemListSectionProps) {
  const setPage = useAppStore((s) => s.setPage)
  const { options, copies } = profile

  const update = async (index: number, patch: PhotoItemOptionPatch) => {
    usePhotoPrintStore.getState().setItemOption(index, patch)
    useSaveStore.getState().markDirty()
    await applyPhotoPrintItem(index)
  }

  if (items.length === 0) {
    return <p className="py-2 text-center text-xs text-editor-text-muted">사진 항목이 없습니다.</p>
  }

  return (
    <section className="flex flex-col gap-2" aria-label="사진 항목">
      <h3 className="text-xs font-semibold text-editor-text">사진별 옵션</h3>
      <ul className="flex flex-col gap-1.5" aria-label="사진 항목 목록">
        {items.map((item) => {
          const n = item.index + 1
          const isCurrent = item.index === currentItemIndex
          return (
            <li
              key={item.index}
              data-testid={`photo-item-${item.index}`}
              className={cn(
                'flex flex-col gap-1.5 rounded-md border px-2 py-1.5 text-sm',
                isCurrent ? 'border-editor-accent' : 'border-editor-border',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="text-editor-text font-medium hover:text-editor-accent"
                    aria-label={`사진 ${n} 보기`}
                    onClick={() => setPage(item.canvasIndex)}
                  >
                    사진 {n}
                  </button>
                  {item.lowRes && (
                    <span
                      className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
                      data-testid={`photo-lowres-${item.index}`}
                      title={`인쇄 권장 해상도(${profile.sizes[0]?.minDpi ?? ''}dpi) 미만`}
                    >
                      {LOW_RES_BADGE_LABEL}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-1" aria-label={`사진 ${n} 매수`}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`사진 ${n} 매수 감소`}
                    disabled={item.copies <= copies.min}
                    onClick={() => void update(item.index, { copies: item.copies - 1 })}
                  >
                    −
                  </Button>
                  <span className="min-w-[2.5rem] text-center text-xs text-editor-text" data-testid={`photo-copies-${item.index}`}>
                    {item.copies}매
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`사진 ${n} 매수 증가`}
                    disabled={item.copies >= copies.max}
                    onClick={() => void update(item.index, { copies: item.copies + 1 })}
                  >
                    +
                  </Button>
                </div>
              </div>

              {(options.border.length > 1 || options.fit.length > 1 || options.finish.length > 1) && (
                <div className="grid grid-cols-3 gap-1">
                  {options.border.length > 1 && (
                    <select
                      aria-label={`사진 ${n} 테두리`}
                      className={SELECT_CLASS}
                      value={item.border}
                      onChange={(e) => void update(item.index, { border: e.target.value as PhotoBorder })}
                    >
                      {options.border.map((b) => <option key={b} value={b}>{BORDER_LABELS[b]}</option>)}
                    </select>
                  )}
                  {options.fit.length > 1 && (
                    <select
                      aria-label={`사진 ${n} 맞춤`}
                      className={SELECT_CLASS}
                      value={item.fit}
                      onChange={(e) => void update(item.index, { fit: e.target.value as PhotoFit })}
                    >
                      {options.fit.map((f) => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}
                    </select>
                  )}
                  {options.finish.length > 1 && (
                    <select
                      aria-label={`사진 ${n} 마감`}
                      className={SELECT_CLASS}
                      value={item.finish}
                      onChange={(e) => void update(item.index, { finish: e.target.value as PhotoFinish })}
                    >
                      {options.finish.map((f) => <option key={f} value={f}>{FINISH_LABELS[f]}</option>)}
                    </select>
                  )}
                </div>
              )}

              {(options.dateOverlay || options.grayscale || options.brightnessFix) && (
                <div className="flex flex-wrap items-center gap-3">
                  {options.dateOverlay && (
                    <label className="flex items-center gap-1.5 text-xs text-editor-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-editor-accent"
                        aria-label={`사진 ${n} 촬영일`}
                        checked={item.dateOverlay}
                        onChange={(e) => void update(item.index, { dateOverlay: e.target.checked })}
                      />
                      촬영일
                    </label>
                  )}
                  {options.grayscale && (
                    <label className="flex items-center gap-1.5 text-xs text-editor-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-editor-accent"
                        aria-label={`사진 ${n} 흑백`}
                        checked={item.grayscale}
                        onChange={(e) => void update(item.index, { grayscale: e.target.checked })}
                      />
                      흑백
                    </label>
                  )}
                  {options.brightnessFix && (
                    <label className="flex items-center gap-1.5 text-xs text-editor-text cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-editor-accent"
                        aria-label={`사진 ${n} 밝기 보정`}
                        checked={item.brightnessFix}
                        onChange={(e) => void update(item.index, { brightnessFix: e.target.checked })}
                      />
                      밝기 보정
                    </label>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
