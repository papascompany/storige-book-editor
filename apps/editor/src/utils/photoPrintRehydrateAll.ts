import type { PhotoItem, ProductProfile } from '@storige/types'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'
import { isPhotoPrintProfile } from '@/utils/productProfile'
import { applyPhotoPrintCanvas, applyPhotoPrintForCanvas } from '@/utils/photoPrintRehydrate'

/**
 * photoPrintRehydrateAll.ts — 사진인화 세션 메타의 편집기 측 배선 (P2-d, 2026-10-19; calendarRehydrateAll 모방)
 *
 * 1. `applyAllPhotoPrint()` — 항목 옵션이 바뀐 뒤 모든 캔버스에 PhotoPrintPlugin.apply 를 순서대로 호출하고
 *    1개 이상 처리했으면 dirty 마킹(자동저장이 metadata.items 변경을 서버에 반영).
 * 2. `restorePhotoPrintSessionItems()` — `edit_sessions.metadata.items`(런처 PhotoItemInput 부분형 가능) 판독·시드.
 * 3. `photoPrintSessionMetadataFields()` — 세션 PATCH 에 동봉할 `{ metadata: { productProfile, items } }`.
 * 4. `photoPrintResultFields()` — editor.complete 에 싣는 `{ items }`.
 * 5. `bindPhotoPrintCanvasEvents()` — undo/redo 완료(`history:undo`/`history:redo`)·채운 사진 삭제(`object:removed` fillImage) 뒤
 *    `applyPhotoPrintForCanvas(canvas)` 한 번(캔버스별 coalesce) — date-overlay·흑백·clip 창이 자가 복구된다(D5/serialization-6).
 *
 * 모든 함수는 profile 이 null/legacy/캘린더면 no-op(`{}`·0·false)이라 기존 세트의 payload 키 집합이 바뀌지 않는다.
 */

/**
 * 모든 캔버스에 현재 항목 옵션 적용 합계. 1개 이상이면 dirty 마킹(옵션 변경·세션 복원).
 * `markDirty:false` 는 신규 세션 첫 진입의 프로파일 기본값 적용용 — 무편집 세션을 dirty 로 만들지 않는다.
 */
export async function applyAllPhotoPrint(opts: { markDirty?: boolean } = {}): Promise<number> {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return 0
  const { allCanvas, allEditors } = useAppStore.getState()
  let total = 0
  for (let i = 0; i < allCanvas.length; i += 1) {
    total += await applyPhotoPrintCanvas(allEditors[i], allCanvas[i], i)
  }
  if (total > 0 && opts.markDirty !== false) useSaveStore.getState().markDirty()
  return total
}

/** 캔버스 수에 맞춘 현재 항목 목록(프로파일 없으면 []). 페이지 추가/삭제 뒤·메타 동봉·완료 시 공통 */
export function syncPhotoPrintItemsWithCanvases(): PhotoItem[] {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return []
  return usePhotoPrintStore.getState().syncWithCanvasCount(useAppStore.getState().allCanvas.length)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 재오픈·런처 선생성 세션의 metadata.items 를 스토어에 복원(캔버스 복원 **전**에 호출해야 rehydrate 가 저장값을 쓴다).
 * profile 이 사진인화가 아니거나 items 가 배열이 아니거나 비었으면 아무것도 하지 않는다.
 * @returns 복원했으면 true
 */
export function restorePhotoPrintSessionItems(metadata: unknown): boolean {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return false
  if (!isRecord(metadata)) return false
  return usePhotoPrintStore.getState().restore(metadata.items)
}

export interface PhotoPrintSessionMetadataFields {
  metadata?: { productProfile: ProductProfile; items: PhotoItem[] }
}

/**
 * 세션 PATCH(자동저장·save·complete)에 동봉할 metadata — API 가 얕은 병합하므로 다른 키는 유지된다.
 * 사진인화 세트가 아니면 `{}`(payload 키 집합 불변). items 는 캔버스 수와 동기화한 완전형.
 */
export function photoPrintSessionMetadataFields(): PhotoPrintSessionMetadataFields {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return {}
  return { metadata: { productProfile: profile, items: syncPhotoPrintItemsWithCanvases() } }
}

/** editor.complete `items` 키 — 사진인화 세트에서만. canvasCount 와 동기화한 완전형 PhotoItem[] */
export function photoPrintResultFields(canvasCount: number): { items?: PhotoItem[] } {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile)) return {}
  return { items: usePhotoPrintStore.getState().syncWithCanvasCount(canvasCount) }
}

/** fabric-history(utils/history.ts) 가 캔버스에 두는 플래그 — undo/redo 로드 중의 object:removed 는 무시한다 */
interface HistoryCanvasFields {
  historyProcessing?: boolean
}

type EventCanvas = fabric.Canvas & HistoryCanvasFields

/**
 * undo/redo 완료·채운 사진(fillImage) 삭제 뒤 `applyPhotoPrintForCanvas(canvas)` 를 캔버스별로 한 번(setTimeout 0 coalesce) 부른다.
 * 호출자(embed)가 사진인화 세트에서만 바인딩한다 — applyPhotoPrintForCanvas 자체도 프로파일 NULL 이면 즉시 0.
 * @returns 모든 리스너를 떼고 대기 중인 타이머를 지우는 해제 함수
 */
export function bindPhotoPrintCanvasEvents(canvases: ReadonlyArray<fabric.Canvas>): () => void {
  const timers = new Map<fabric.Canvas, ReturnType<typeof setTimeout>>()
  const offs: Array<() => void> = []
  const schedule = (canvas: fabric.Canvas) => {
    const prev = timers.get(canvas)
    if (prev) clearTimeout(prev)
    timers.set(
      canvas,
      setTimeout(() => {
        timers.delete(canvas)
        void applyPhotoPrintForCanvas(canvas)
      }, 0),
    )
  }
  for (const canvas of canvases) {
    const onHistory = () => schedule(canvas)
    const onRemoved = (e: { target?: { extensionType?: string } }) => {
      if ((canvas as EventCanvas).historyProcessing) return
      if (e?.target?.extensionType !== 'fillImage') return
      schedule(canvas)
    }
    try {
      canvas.on('history:undo', onHistory)
      canvas.on('history:redo', onHistory)
      canvas.on('object:removed', onRemoved as (e: fabric.IEvent) => void)
    } catch {
      continue
    }
    offs.push(() => {
      try {
        canvas.off('history:undo', onHistory)
        canvas.off('history:redo', onHistory)
        canvas.off('object:removed', onRemoved as (e: fabric.IEvent) => void)
      } catch { /* dispose 된 캔버스 — 무시 */ }
    })
  }
  return () => {
    for (const off of offs) off()
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }
}
