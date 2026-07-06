/**
 * A1 (2026-07-06): 레이어 패널 다중선택(shift/ctrl 클릭)·모바일 ↑↓ 순서변경 보조 로직.
 * SidePanel 에서 분리해 fabric 인스턴스 없이 단위테스트 가능하게 유지(구조적 타입).
 */

/** 다중선택 판정에 필요한 최소 구조 (fabric.Object 서브셋) */
export interface MultiSelectCandidate {
  selectable?: boolean
  lockMovementX?: boolean
  lockMovementY?: boolean
  /** Part B 위치고정 플래그 — false=관리자 지정 잠금 */
  movable?: boolean
  /** LockPlugin 고급 잠금 메타 */
  lockInfo?: { isLocked?: boolean }
}

/**
 * 레이어 패널 다중선택 포함 가능 여부.
 *
 * ⚠️ fabric 5.5.2 의 ActiveSelection 드래그(controls.dragHandler)는 transform.target
 * (= ActiveSelection 자체)의 lockMovementX/Y 만 검사하고 자식(children)의 lock 은
 * 조회하지 않는다 — dist 소스 확인 + 재현 테스트(layerPanelSelection.test.ts)로 확정.
 * 잠긴 객체를 ActiveSelection 에 넣으면 드래그로 함께 이동해 잠금이 무력화되므로,
 * 비-editMode 에서는 잠긴 객체를 제외한다(LockPlugin.handleSelection 이 잠긴 객체를
 * 선택에서 걷어내는 선례와 동일 규약).
 *
 * 제외 기준(비-editMode):
 * - lockMovementX/Y === true — 실제로 무시되는 속성 그 자체
 *   (ObjectPlugin.lock 단순잠금 · LockPlugin.lock · applyObjectPermissions 가 모두 세팅)
 * - movable === false — 관리자 위치고정 마커(permissions 미적용 시점 방어)
 * - lockInfo.isLocked — LockPlugin 고급 잠금 마커
 * - selectable === false — 캔버스 드래그 선택에서도 제외되는 객체(동작 일관성)
 *
 * editMode(관리자)는 잠금 미강제(applyObjectPermissions editMode 면제·LockPlugin admin
 * 바이패스)라 제외하지 않는다 — B1 잔여 ⑤(admin 다중선택 드래그 동반 이동 수용)와 동일.
 */
export function isMultiSelectableInLayerPanel(
  obj: MultiSelectCandidate | null | undefined,
  editMode: boolean | undefined
): boolean {
  if (!obj) return false
  if (editMode) return true
  if (obj.selectable === false) return false
  if (obj.lockMovementX === true || obj.lockMovementY === true) return false
  if (obj.movable === false) return false
  if (obj.lockInfo?.isLocked === true) return false
  return true
}

/**
 * shift/ctrl 클릭 시 다음 다중선택 멤버 산출 — 이미 선택돼 있으면 토글 제거, 아니면 추가.
 * 마지막에 다중선택 가드(isMultiSelectableInLayerPanel)로 필터.
 */
export function buildNextMultiSelection<T extends MultiSelectCandidate>(
  prev: readonly T[],
  clicked: T,
  editMode: boolean | undefined
): T[] {
  const next = prev.includes(clicked)
    ? prev.filter((o) => o !== clicked)
    : [...prev, clicked]
  return next.filter((o) => isMultiSelectableInLayerPanel(o, editMode))
}

export interface LayerRow {
  id: string
}

/**
 * 모바일 ↑↓ 순서변경 — reorderObject(useAppStore) 호출 인자 산출.
 *
 * ⚠️ reverse 방향 함정(useAppStore.reorderObject 주석): 레이어 목록은 fabric 스택의
 * reverse 라 "목록 위 = 맨앞(front)". 목록 인덱스로 z-order 를 직접 계산하면 방향이
 * 뒤집힌다. 여기서는 "목록에서 한 칸 위/아래의 행"을 target 으로 삼고 placeAbove
 * (= target 보다 앞/front 배치) 여부만 산출해 reorderObject 에 위임한다 — fabric 라이브
 * 스택 인덱스 계산·fillImage 동반 이동·setUnchangeable 재고정·updateObjects 갱신은
 * 전부 reorderObject 가 내장 처리(중복 호출 금지).
 */
export function layerStepReorderArgs(
  rows: readonly LayerRow[],
  index: number,
  dir: 'up' | 'down'
): { targetId: string; placeAbove: boolean } | null {
  if (index < 0 || index >= rows.length) return null
  const targetIndex = dir === 'up' ? index - 1 : index + 1
  if (targetIndex < 0 || targetIndex >= rows.length) return null
  return { targetId: rows[targetIndex].id, placeAbove: dir === 'up' }
}
