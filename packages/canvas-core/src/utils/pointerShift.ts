// 포인터→scene 매핑 점프 보정 (P1-3, 2026-06-12)
//
// [배경 — 라이브 4/4 재현 결함]
// 속성 패널(ControlBar, 280px)이 "닫힌 상태"에서 textbox 더블클릭 편집 시 객체가
// 정확히 -280px/zoom 수평 텔레포트.
//
// 메커니즘:
//  1. 1번째 클릭 mousedown → selection:created → React 가 280px 패널을 DOM 에 마운트
//     → 캔버스 요소의 페이지 오프셋이 +280px 이동 (스프레드 템플릿은 렌더가 무거워
//     커밋/레이아웃이 2번째 클릭의 mousedown~mousemove 사이에 떨어질 수 있음).
//  2. 2번째 클릭 mousedown 시 fabric _setupCurrentTransform 이
//     offsetX = pointerScene.x - target.left 를 "이동 전" 매핑으로 기록.
//  3. mousemove 에서 fabric getPointer 가 calcOffset() 으로 "이동 후" 오프셋을 다시 읽음
//     → 마우스가 실제로 움직이지 않아도 scene 포인터가 -280/zoom 점프.
//  4. dragHandler: newLeft = x - offsetX → 객체가 -280/zoom 물리 이동(object:moving).
//     이후 SpreadPlugin.handleObjectModified 가 오염된 위치 기준으로 meta 를 재계산해 박제.
//
// 같은 레이스는 프로그램적 viewportTransform 패닝(EditorView 의 ResizeObserver →
// setCenterPointOf/setZoomAuto)에서도 동일하게 발생한다 — 드래그 변환 진행 중
// "포인터→scene 매핑"이 바뀌는 모든 경우가 같은 결함 클래스다.
//
// [수정 전략 — 후보 (b): 진행 중 변환의 기준 좌표 보정]
// 패널 열림 시 화면 보정(UX)은 보존하고, 매핑 변화가 드래그 변위로 전이되지 않도록
// 변환 기준점(offsetX/ex/lastX 등)을 같은 양만큼 이동시킨다. 요소 오프셋 이동(embed),
// vpt 패닝/줌 변경(EditorView) 모두 하나의 보정식으로 커버된다.
//
// fabric 5.5 getPointer 의 좌표식 (retina/cssScale 은 상쇄됨 — backstore = css * retina):
//   scene = (raw - offset - pan) / zoom        (raw = 문서 기준 포인터 좌표, 축별 동일)
// 같은 raw 점에 대한 매핑 변경 전/후 scene 차이가 "점프"다:
//   jump = sceneNew - sceneOld
//        = sceneNew - (raw - offsetOld - panOld) / zoomOld
//   (raw 는 sceneNew 로부터 역산: raw = sceneNew * zoomNew + panNew + offsetNew)

/** 포인터→scene 매핑 스냅샷 (캔버스 요소 문서 오프셋 + viewportTransform 성분) */
export interface PointerMappingSnapshot {
  /** 캔버스 요소의 문서 기준 left (fabric canvas._offset.left) */
  offsetLeft: number
  /** 캔버스 요소의 문서 기준 top (fabric canvas._offset.top) */
  offsetTop: number
  /** viewportTransform[0] (x 줌) */
  zoomX: number
  /** viewportTransform[3] (y 줌) */
  zoomY: number
  /** viewportTransform[4] (x 패닝) */
  panX: number
  /** viewportTransform[5] (y 패닝) */
  panY: number
}

export interface ScenePoint {
  x: number
  y: number
}

/**
 * fabric._currentTransform 의 드래그 기준 좌표 부분집합.
 * dragHandler: newLeft = x - offsetX / newTop = y - offsetY 이므로 offsetX/offsetY 가
 * 핵심이고, ex/ey/lastX/lastY 는 회전·스큐 등 델타 기반 핸들러의 기준점이다.
 */
export interface TransformAnchors {
  offsetX: number
  offsetY: number
  ex: number
  ey: number
  lastX: number
  lastY: number
}

/** 매핑 동일성 비교 (서브픽셀 잡음 허용) */
export function pointerMappingsEqual(
  a: PointerMappingSnapshot,
  b: PointerMappingSnapshot,
  epsilon = 1e-6
): boolean {
  return (
    Math.abs(a.offsetLeft - b.offsetLeft) < epsilon &&
    Math.abs(a.offsetTop - b.offsetTop) < epsilon &&
    Math.abs(a.zoomX - b.zoomX) < epsilon &&
    Math.abs(a.zoomY - b.zoomY) < epsilon &&
    Math.abs(a.panX - b.panX) < epsilon &&
    Math.abs(a.panY - b.panY) < epsilon
  )
}

/**
 * 매핑이 prev → next 로 바뀌었을 때, 같은 물리(문서) 포인터 위치가 scene 좌표에서
 * 얼마나 "점프"했는지 계산한다.
 *
 * @param prev 변환 시작(또는 직전 move) 시점의 매핑
 * @param next 현재 매핑
 * @param scenePointerNew 현재 매핑으로 계산된 scene 포인터 (fabric getPointer 결과)
 * @returns scene 좌표계의 점프량 (마우스가 움직이지 않았어도 발생한 가짜 변위)
 */
export function computePointerSceneJump(
  prev: PointerMappingSnapshot,
  next: PointerMappingSnapshot,
  scenePointerNew: ScenePoint
): ScenePoint {
  // 0 나눗셈 방어 — 줌이 0 이면 매핑 자체가 무효이므로 점프 없음 처리
  if (!prev.zoomX || !prev.zoomY || !next.zoomX || !next.zoomY) {
    return { x: 0, y: 0 }
  }

  // 현재 scene 포인터로부터 문서 기준 raw 좌표 역산
  const rawX = scenePointerNew.x * next.zoomX + next.panX + next.offsetLeft
  const rawY = scenePointerNew.y * next.zoomY + next.panY + next.offsetTop

  // 같은 raw 점을 "이전 매핑"으로 해석했을 때의 scene 좌표
  const sceneOldX = (rawX - prev.offsetLeft - prev.panX) / prev.zoomX
  const sceneOldY = (rawY - prev.offsetTop - prev.panY) / prev.zoomY

  return {
    x: scenePointerNew.x - sceneOldX,
    y: scenePointerNew.y - sceneOldY,
  }
}

/**
 * 진행 중 변환의 기준 좌표를 점프량만큼 이동 — 매핑 변화가 객체 변위로 전이되지 않게 한다.
 * dragHandler 불변식: newLeft = sceneNew - (offsetX + jump)
 *                          = (sceneDown + jump) - offsetX - jump = 원래 left  ✓ (줌 변경 포함)
 */
export function compensateTransformAnchors(anchors: TransformAnchors, jump: ScenePoint): void {
  anchors.offsetX += jump.x
  anchors.offsetY += jump.y
  anchors.ex += jump.x
  anchors.ey += jump.y
  anchors.lastX += jump.x
  anchors.lastY += jump.y
}

/**
 * fabric 캔버스에서 현재 매핑 스냅샷을 추출한다.
 * (duck-typed — 테스트에서 실제 fabric 캔버스 없이 사용 가능)
 */
export function capturePointerMapping(canvas: {
  viewportTransform?: number[]
  _offset?: { left: number; top: number }
}): PointerMappingSnapshot | null {
  const vpt = canvas.viewportTransform
  const offset = canvas._offset
  if (!vpt || vpt.length < 6 || !offset) return null
  return {
    offsetLeft: offset.left,
    offsetTop: offset.top,
    zoomX: vpt[0],
    zoomY: vpt[3],
    panX: vpt[4],
    panY: vpt[5],
  }
}
