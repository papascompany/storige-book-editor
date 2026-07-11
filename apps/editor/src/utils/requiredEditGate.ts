/**
 * L7 (2026-07-11) — requiredEdit store 연동 계층.
 *
 * 순수 판정(requiredEditCheck.ts)과 앱 상태(zustand)를 잇는다:
 *   - trackRequiredEdits(canvas): 로드 완료 지점(applyObjectPermissions 호출부와 동일)에서
 *     touched 추적 리스너 부착. shouldTrack 은 이벤트 시점 평가 — editMode(관리자 authoring)
 *     와 customerPreview(저장 없는 일시 모드) 타이핑은 마킹하지 않는다.
 *   - confirmRequiredEditsBeforeComplete(): '편집완료' 직전 게이트. 미편집 필수 요소가
 *     있으면 비차단 경고 모달을 띄우고 [그래도 완료]=true / [계속 편집]=false(+첫 요소
 *     페이지 이동·선택)를 반환. editor.complete emit '이전' 단계라 파트너 계약 무변경.
 */
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useEditorStore } from '@/stores/useEditorStore'
import {
  attachRequiredEditTracking,
  collectUneditedRequired,
  type UneditedRequiredItem,
} from './requiredEditCheck'

/** 로드 완료 지점용 — touched 추적 부착(멱등). applyObjectPermissions 와 나란히 호출. */
export function trackRequiredEdits(canvas: unknown): void {
  attachRequiredEditTracking(canvas as never, () => {
    const s = useSettingsStore.getState()
    return !s.currentSettings.editMode && !s.customerPreview
  })
}

interface FocusableObject {
  id?: string
  type?: string
  getObjects?: () => unknown[]
  setCoords?: () => void
}

/** 최상위 객체 중 id 일치 또는 (그룹) 자식에 id 포함하는 객체 — 선택은 최상위 단위 */
function findTopLevelById(objects: unknown[], id: string): FocusableObject | null {
  const containsDeep = (obj: FocusableObject): boolean => {
    if (obj.id === id) return true
    if (obj.type === 'group' && typeof obj.getObjects === 'function') {
      return obj.getObjects().some((c) => containsDeep(c as FocusableObject))
    }
    return false
  }
  for (const obj of objects) {
    if (containsDeep(obj as FocusableObject)) return obj as FocusableObject
  }
  return null
}

/** [계속 편집] 발견성 — 첫 미편집 요소의 페이지로 이동 후 선택 (best-effort) */
function focusUneditedItem(item: UneditedRequiredItem): void {
  try {
    const { canvas, allCanvas, setPage } = useAppStore.getState()
    const canvases = allCanvas.length > 0 ? allCanvas : canvas ? [canvas] : []
    const target = canvases[item.canvasIndex]
    if (!target) return
    if (canvases.length > 1 && target !== canvas) {
      // BookNavigation.handleSelect 와 동일 규약(setPage + goToPage)으로 페이지 전환
      setPage(item.canvasIndex)
      useEditorStore.getState().goToPage(item.canvasIndex)
    }
    const obj = findTopLevelById(target.getObjects(), item.objectId)
    if (obj) {
      ;(target as { setActiveObject?: (o: unknown) => void }).setActiveObject?.(obj)
      obj.setCoords?.()
      ;(target as { requestRenderAll?: () => void }).requestRenderAll?.()
    }
  } catch (e) {
    // 발견성 보조 실패는 완료 흐름 판단에 영향 없음
    console.warn('[requiredEditGate] focusUneditedItem 실패:', e)
  }
}

/** 고객 컨텍스트에서 미편집 필수 요소 수집 (없으면 빈 배열) */
export function collectUneditedRequiredForCustomer(): UneditedRequiredItem[] {
  if (useSettingsStore.getState().currentSettings.editMode) return []
  const { canvas, allCanvas } = useAppStore.getState()
  const canvases = allCanvas.length > 0 ? allCanvas : canvas ? [canvas] : []
  return collectUneditedRequired(canvases as never)
}

/**
 * '편집완료' 직전 게이트. true=완료 속행 / false=중단([계속 편집] — 첫 요소 포커스).
 * 관리자(editMode)는 항상 true (지정 authoring 흐름 무간섭).
 */
export async function confirmRequiredEditsBeforeComplete(): Promise<boolean> {
  const items = collectUneditedRequiredForCustomer()
  if (items.length === 0) return true
  const choice = await useAppStore.getState().requestRequiredEditConfirm(items)
  if (choice === 'proceed') return true
  focusUneditedItem(items[0])
  return false
}
