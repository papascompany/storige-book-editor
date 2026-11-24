/**
 * 사진인화 완료 가드 — 빈 칸, 그리고 주문 총 매수(v1.35).
 *
 * 사진인화 세트에서 사진이 없는 사진틀이 남은 채 완료하면, 빈 칸이 흰 인화지로 출력되고 매수에도 들어간다.
 * pageStep 가드(pageStepGuard)와 같은 자리에서 완료를 막는다:
 *   - EditorHeader 편집완료(UI) → 토스트 후 중단
 *   - embed complete()(프로그래매틱) → editor.error(INVALID_DATA) 후 reject
 * 고객은 사진을 넣거나 사이드 패널에서 빈 칸(페이지)을 지운 뒤 다시 완료한다.
 * 런처가 `orderOptions.totalCopies` 를 보낸 세션은 항목 copies 합계가 그 값과 같아야 한다(매수 불일치 주문 방지).
 * 프로파일 NULL·비사진인화 세트와 관리자(editMode)는 항상 통과(기존 동작 그대로).
 */
import type { PhotoItem, ProductProfile } from '@storige/types'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { collectEmptyFrames } from '@/utils/photoPlacement'
import { isPhotoPrintProfile } from '@/utils/productProfile'
import { resolvePhotoItemIndexForCanvas } from '@/utils/photoPrintRehydrate'
import { syncPhotoPrintItemsWithCanvases } from '@/utils/photoPrintRehydrateAll'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'

type FabricCanvas = fabric.Canvas

/** 빈 사진틀이 있는 사진 칸 번호(1부터, 오름차순·중복 없음). 사진인화가 아니면 빈 배열 */
export function findEmptyPhotoPrintSlots(
  canvases: FabricCanvas[],
  profile: ProductProfile | null | undefined,
): number[] {
  if (!isPhotoPrintProfile(profile)) return []
  const slots = new Set<number>()
  for (const { canvas } of collectEmptyFrames(canvases)) {
    const idx = canvases.indexOf(canvas)
    const item = resolvePhotoItemIndexForCanvas(profile.photoPrint, idx)
    if (item >= 0) slots.add(item + 1)
  }
  return [...slots].sort((a, b) => a - b)
}

export function emptyPhotoPrintSlotsMessage(slots: number[]): string {
  const shown = slots.slice(0, 5).join(', ')
  const more = slots.length > 5 ? ` 외 ${slots.length - 5}개` : ''
  return `사진이 없는 칸이 ${slots.length}개 있습니다(${shown}번째${more}). 사진을 넣거나 빈 칸을 삭제한 뒤 완료해 주세요.`
}

/** 항목 copies 합계 */
export function photoPrintCopiesTotal(items: ReadonlyArray<Pick<PhotoItem, 'copies'>>): number {
  return items.reduce((sum, it) => sum + (Number.isFinite(it.copies) ? it.copies : 0), 0)
}

export function totalCopiesMismatchMessage(total: number, ordered: number): string {
  const diff = total > ordered ? `${total - ordered}매를 줄여` : `${ordered - total}매를 더해`
  return `주문 매수는 ${ordered}매인데 지금 합계는 ${total}매입니다. 사진별 매수에서 ${diff} ${ordered}매로 맞춘 뒤 완료해 주세요.`
}

/**
 * 차단이면 고객 안내 메시지, 아니면 null (편집완료 차단 판단용).
 * 순서: 빈 사진틀 → 주문 총 매수(런처 orderOptions.totalCopies 가 있을 때만).
 */
export function getPhotoPrintCompleteBlockMessage(): string | null {
  const settings = useSettingsStore.getState()
  if (settings.currentSettings.editMode) return null
  if (!isPhotoPrintProfile(settings.productProfile)) return null
  const { canvas, allCanvas } = useAppStore.getState()
  const canvases = (allCanvas.length > 0 ? allCanvas : canvas ? [canvas] : []) as FabricCanvas[]
  const slots = findEmptyPhotoPrintSlots(canvases, settings.productProfile)
  if (slots.length > 0) return emptyPhotoPrintSlotsMessage(slots)
  const ordered = usePhotoPrintStore.getState().orderTotalCopies
  if (ordered === null) return null
  const total = photoPrintCopiesTotal(syncPhotoPrintItemsWithCanvases())
  return total === ordered ? null : totalCopiesMismatchMessage(total, ordered)
}
