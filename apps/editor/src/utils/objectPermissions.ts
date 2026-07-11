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
 * - L4-④ (2026-07-11, CTO 결정) **'내용편집 잠금' 정의 = 내용+스타일 모두 잠금.**
 *   contentEditable=false 는 텍스트 내용 진입 차단뿐 아니라 스타일(폰트·크기·색·정렬·
 *   외곽선·그림자 등) 변경도 함께 차단한다 — Canva 'Lock position and appearance' 대응.
 *   템플릿 무결성이 목적이므로 "내용은 잠그고 스타일은 허용"은 모순. UI 게이트는
 *   isAppearanceLocked() 헬퍼로 판정(ControlBar 스타일 컨트롤 감산). editMode 는 면제.
 *
 * - L4-③ (2026-07-11) 그룹 내부 텍스트에도 contentEditable 강제/원복을 **재귀 적용**.
 *   (그룹 해제 후 자식 더블클릭 진입 구멍 봉쇄.) 저장 왕복 오염 없음 — fabric group
 *   toObject 는 propertiesToInclude 를 자식에 전파해 editable 이 자식 단위로 직렬화되고,
 *   editMode 원복 분기가 같은 재귀로 대칭 복구한다(기존 '대칭이라 오염 없음' 계약 유지).
 *
 * 기본값은 permissive(undefined=허용) — 기존 라이브 템플릿/주문은 영향 없음(관리자가 명시적으로
 * 잠근 객체만 적용). 멱등하게 재호출 가능(저장복원·멀티페이지 경로에서 반복 호출 안전).
 *
 * editMode(관리자)에서는 강제 적용 대신 **역오염 원복**을 수행한다: 고객 세션 저장본에는
 * 강제된 editable=false 가 영속(extendFabricOption 등재 속성)될 수 있는데, contentEditable===false
 * 마커가 있는 객체의 editable 만 true 로 되돌려 관리자 재편집이 잠기는 것을 방지한다.
 */
const TEXT_TYPES = ['text', 'textbox', 'i-text']

/**
 * L4-③: 그룹(중첩 포함) 자식까지 깊이 순회. fabric.Group 은 getObjects() 로 자식 접근.
 * (ActiveSelection 도 type='activeSelection' 이라 group 분기에 안 걸린다 — 캔버스
 * 최상위 순회에서는 등장하지 않으므로 group 타입만 재귀하면 충분.)
 */
function forEachObjectDeep(
  objects: fabric.Object[],
  fn: (obj: fabric.Object) => void,
): void {
  for (const obj of objects) {
    fn(obj)
    const maybeGroup = obj as { type?: string; getObjects?: () => fabric.Object[] }
    if (maybeGroup.type === 'group' && typeof maybeGroup.getObjects === 'function') {
      forEachObjectDeep(maybeGroup.getObjects(), fn)
    }
  }
}

export function applyObjectPermissions(
  canvas: fabric.Canvas | null | undefined,
  editMode: boolean | undefined,
): void {
  if (!canvas) return
  let changed = false
  if (editMode) {
    // 관리자 재진입 원복 — 강제 마커(contentEditable===false)가 있는 텍스트만 editable 복구.
    // L4-③: 그룹 자식도 재귀 원복(강제와 대칭 — 저장 왕복 오염 방지).
    forEachObjectDeep(canvas.getObjects() as fabric.Object[], (obj) => {
      if (
        (obj as { contentEditable?: boolean }).contentEditable === false &&
        TEXT_TYPES.includes(obj.type || '') &&
        (obj as { editable?: boolean }).editable === false
      ) {
        obj.set({ editable: true })
        changed = true
      }
    })
    if (changed) canvas.requestRenderAll()
    return
  }
  // L4-③: 그룹 내부 텍스트도 contentEditable 강제 — 최상위 순회만으로는 그룹 해제 후
  // 자식 더블클릭 진입이 열려 있었다. movable 축은 그룹 단위 조작이라 최상위 유지.
  forEachObjectDeep(canvas.getObjects() as fabric.Object[], (obj) => {
    if (
      (obj as { contentEditable?: boolean }).contentEditable === false &&
      TEXT_TYPES.includes(obj.type || '') &&
      (obj as { editable?: boolean }).editable !== false
    ) {
      obj.set({ editable: false })
      changed = true
    }
  })
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
    // B1: 내용편집 잠금(텍스트 editable=false 강제)은 위 forEachObjectDeep 재귀 순회가 담당
    // — 최상위+그룹 자식 공통. (선택·이동은 movable 축과 독립.)
  }
  if (changed) canvas.requestRenderAll()
}

/**
 * L4-④ (CTO 결정): '내용편집 잠금'은 내용+스타일 모두 잠금 — 비-editMode 에서
 * contentEditable===false 객체는 스타일 컨트롤(TextAttributes·색·외곽선·그림자·곡선 등)을
 * 감산(미노출)한다. editMode(디자이너)는 면제. 다중선택은 하나라도 잠겨 있으면 잠금 취급.
 */
export function isAppearanceLocked(
  selection: ReadonlyArray<unknown> | null | undefined,
  editMode: boolean | undefined,
): boolean {
  if (editMode) return false
  if (!selection || selection.length === 0) return false
  return selection.some(
    (obj) => (obj as { contentEditable?: boolean } | null | undefined)?.contentEditable === false,
  )
}

/**
 * L3 B-3 (2026-07-06): 고객 시점 미리보기 종료 시 원복 — applyObjectPermissions 가
 * movable===false 객체에 강제한 fabric 잠금 5속성+hasControls 를 되돌린다.
 * (contentEditable 의 editable 원복은 applyObjectPermissions(canvas, true) 가 담당.)
 * 미리보기는 저장 없는 일시 모드이므로 마커(movable 플래그) 기준 정확 원복이 가능하다.
 */
export function revertObjectPermissions(canvas: fabric.Canvas | null | undefined): void {
  if (!canvas) return
  let changed = false
  for (const obj of canvas.getObjects() as fabric.Object[]) {
    // apply 와 대칭: fillImage 는 apply 가 건드리지 않으므로 revert 도 건드리지 않는다.
    if ((obj as { extensionType?: string }).extensionType === 'fillImage') continue
    if ((obj as { movable?: boolean }).movable === false) {
      obj.set({
        lockMovementX: false,
        lockMovementY: false,
        lockScalingX: false,
        lockScalingY: false,
        lockRotation: false,
        hasControls: true,
      })
      obj.setCoords()
      changed = true
    }
  }
  if (changed) canvas.requestRenderAll()
}
