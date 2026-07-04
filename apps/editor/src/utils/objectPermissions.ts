import type { fabric } from 'fabric'

/**
 * Part B — 객체별 편집권한(고객용) 적용. (2026-06-16)
 *
 * 관리자(editMode)가 ControlBar 에서 객체에 `movable=false` 또는 `deleteable=false` 를 지정하면
 * 템플릿/캔버스 JSON 에 영속(extendFabricOption 화이트리스트)되고, 고객 편집기 로드 시 이 함수가
 * **비-editMode 일 때만** 실제 fabric 잠금으로 강제한다. (관리자 미리보기/템플릿 제작 editMode 에서는
 * 전체 자유 편집이라 잠금을 적용하지 않는다 — del 가드·LockPlugin 과 동일한 editMode 규약.)
 *
 * - `movable===false` → lockMovementX/Y · lockScalingX/Y · lockRotation = true + hasControls 숨김.
 *   드래그·스케일·회전·화살표이동(ObjectPlugin 가드)이 모두 막힌다. 선택/내용편집(텍스트 등)은 유지.
 * - `deleteable===false` → ObjectPlugin.del 가드가 이미 처리하므로 여기선 무동작.
 *
 * - B1 (2026-07-04) `contentEditable===false` → 텍스트류(fabric editable=false)로 편집 진입 차단.
 *   사진틀 교체 차단은 교체 핸들러(사진 주입/스왑 경로)가 frame.contentEditable 을 직접 검사.
 *
 * 기본값은 permissive(undefined=허용) — 기존 라이브 템플릿/주문은 영향 없음(관리자가 명시적으로
 * 잠근 객체만 적용). 멱등하게 재호출 가능(저장복원·멀티페이지 경로에서 반복 호출 안전).
 *
 * editMode(관리자)에서는 강제 적용 대신 **역오염 원복**을 수행한다: 고객 세션 저장본에는
 * 강제된 editable=false 가 영속(extendFabricOption 등재 속성)될 수 있는데, contentEditable===false
 * 마커가 있는 객체의 editable 만 true 로 되돌려 관리자 재편집이 잠기는 것을 방지한다.
 */
const TEXT_TYPES = ['text', 'textbox', 'i-text']

export function applyObjectPermissions(
  canvas: fabric.Canvas | null | undefined,
  editMode: boolean | undefined,
): void {
  if (!canvas) return
  let changed = false
  if (editMode) {
    // 관리자 재진입 원복 — 강제 마커(contentEditable===false)가 있는 텍스트만 editable 복구.
    for (const obj of canvas.getObjects() as fabric.Object[]) {
      if (
        (obj as { contentEditable?: boolean }).contentEditable === false &&
        TEXT_TYPES.includes(obj.type || '') &&
        (obj as { editable?: boolean }).editable === false
      ) {
        obj.set({ editable: true })
        changed = true
      }
    }
    if (changed) canvas.requestRenderAll()
    return
  }
  for (const obj of canvas.getObjects() as fabric.Object[]) {
    // 사진틀에 채운 사진(fillImage)은 잠그지 않는다 — 프레임이 위치고정(movable=false)이어도
    // Part A adjust 모드(더블클릭 사진 pan/zoom)는 동작해야 한다. (현재는 fillImage 가 selectable:false
    // 라 admin 이 movable 플래그를 줄 수 없지만, 복사/상속 등으로 유입될 가능성에 대한 방어.)
    if ((obj as { extensionType?: string }).extensionType === 'fillImage') continue
    if ((obj as { movable?: boolean }).movable === false) {
      obj.set({
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hasControls: false,
      })
      obj.setCoords()
      changed = true
    }
    // B1: 내용편집 잠금 — 텍스트류는 fabric editable=false 로 더블클릭/진입 자체 차단.
    // (선택·이동은 movable 축과 독립 — contentEditable 단독이면 이동은 허용.)
    if (
      (obj as { contentEditable?: boolean }).contentEditable === false &&
      TEXT_TYPES.includes(obj.type || '') &&
      (obj as { editable?: boolean }).editable !== false
    ) {
      obj.set({ editable: false })
      changed = true
    }
  }
  if (changed) canvas.requestRenderAll()
}
