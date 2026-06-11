import { fabric } from 'fabric'
import Editor from '../Editor'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase } from '../plugin'
import {
  capturePointerMapping,
  compensateTransformAnchors,
  computePointerSceneJump,
  pointerMappingsEqual,
  type PointerMappingSnapshot,
} from '../utils/pointerShift'

/**
 * PointerShiftGuardPlugin (P1-3, 2026-06-12)
 *
 * 마우스 변환(_currentTransform) 진행 중에 "포인터→scene 매핑"이 프로그램적으로
 * 바뀌면(캔버스 요소 레이아웃 이동 / viewportTransform 패닝·줌 변경) fabric 이
 * 그 변화를 드래그 변위로 오해석해 객체를 물리 이동시키는 결함을 차단한다.
 *
 * 실측 사고: 속성 패널(280px)이 닫힌 상태에서 textbox 더블클릭 → 패널 마운트로
 * 캔버스 요소가 +280px 밀리는 레이아웃 시프트가 2번째 클릭의 mousedown~mousemove
 * 사이에 떨어짐 → 객체가 정확히 -280px/zoom 수평 텔레포트(zoom 0.339 에서 -826.7px,
 * zoom 0.4 에서 -700px) → SpreadPlugin 이 오염 위치로 meta 재계산(front→back 월경).
 *
 * 동작 (fabric 5.5 이벤트 순서에 정합):
 *  - mouse:down  : __onMouseDown 이 _setupCurrentTransform 후에 발화 + 같은 이벤트에서
 *                  getPointer→calcOffset 이 _offset 을 갱신했으므로, 이 시점 스냅샷이
 *                  변환 기준점(ex/offsetX)과 정확히 같은 매핑이다.
 *  - mouse:move:before : _transformObject 보다 먼저 발화. calcOffset 으로 현재 매핑을
 *                  읽어 스냅샷과 비교 — 바뀌었으면 진행 중 변환의 기준 좌표를 점프량만큼
 *                  보정해 객체 불이동을 보장하고 스냅샷을 갱신한다.
 *  - mouse:up    : 스냅샷 해제.
 *
 * 패널 열림 시 화면 보정(setCenterPointOf/setZoomAuto 등 UX)은 그대로 유지된다 —
 * 보정은 "변환 기준점"만 옮기므로 이후의 실제 마우스 이동은 정상적으로 반영된다.
 * DraggingPlugin 스페이스 팬은 skipTargetFind 로 변환 자체가 안 생겨 간섭 없음.
 * alt-팬은 객체 위에서 시작하면 fabric 이 drag 변환을 만들므로(altKey 차단 없음),
 * isDragging(DraggingPlugin 플래그) 중에는 보정을 스킵해 기존 팬 동작을 보존한다.
 *
 * 한계(적대 리뷰 2026-06-12): 보정 anchors(offsetX/ex/ey/lastX/lastY)는 fabric 5.5.2 의
 * dragHandler(offsetX)·rotationWithSnapping(ex/ey)만 소비한다. scale/skew/changeWidth 는
 * getLocalPoint(현재 포인터만 사용) 기반이라 변환 중 매핑 변화가 점프로 전이돼도 본
 * 보정으로는 못 막는다(무해·무효). 라이브 사고 경로(첫 선택 직후 변환)는 fabric 의
 * alreadySelected 게이트로 항상 drag 라 완전 커버 — 잔여 노출은 "스케일 도중 리사이즈/
 * 줌 변경"의 좁은 창이며 필요 시 transform.original 기준 재앵커로 확장한다.
 */
class PointerShiftGuardPlugin extends PluginBase {
  name = 'PointerShiftGuardPlugin'
  events: string[] = []
  hotkeys: CanvasHotkey[] = []

  private _snapshot: PointerMappingSnapshot | null = null

  private _boundMouseDown: ((opt: fabric.IEvent) => void) | null = null
  private _boundMouseMoveBefore: ((opt: fabric.IEvent) => void) | null = null
  private _boundMouseUp: ((opt: fabric.IEvent) => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
    this._bindEvents()
  }

  private _bindEvents() {
    this._boundMouseDown = () => {
      const canvas = this._canvas as any
      // 변환이 시작된 경우에만 추적 (빈 영역 클릭/그룹 셀렉터는 대상 아님)
      this._snapshot = canvas?._currentTransform ? capturePointerMapping(canvas) : null
    }

    this._boundMouseMoveBefore = (opt: fabric.IEvent) => {
      const canvas = this._canvas as any
      const transform = canvas?._currentTransform
      if (!transform || !this._snapshot) return

      // alt-팬(DraggingPlugin isDragging) 중에는 보정 스킵 — 객체 위에서 시작한 alt-팬은
      // drag 변환이 살아 있는데, 여기서 매 move 의 팬을 보정하면 객체가 팬 경로 전체만큼
      // scene 에서 끌려가는 오보정 회귀가 된다(적대 리뷰 major, 2026-06-12). 미보정 시
      // fabric 기존 의미(첫 이벤트 1회 점프 후 화면 고정 = 사실상 순수 팬)가 보존된다.
      if (canvas.isDragging === true) return

      // 멀티터치 비주(非主) 포인터는 무시 — 비주 touchmove 는 _resetTransformEventData 를
      // 건너뛰어 stale _absolutePointer 캐시(다른 손가락+옛 매핑)를 남길 수 있다.
      if (opt.e && typeof canvas._isMainEvent === 'function' && !canvas._isMainEvent(opt.e)) {
        return
      }

      try {
        // 현재 레이아웃 기준으로 _offset 갱신 (getPointer 가 어차피 매 이벤트 수행하는
        // 연산이라 추가 비용은 getElementOffset 1회 수준)
        canvas.calcOffset()
        const current = capturePointerMapping(canvas)
        if (!current) return

        if (!pointerMappingsEqual(this._snapshot, current)) {
          // getPointer 호출 전 포인터 캐시 무효화 — move:before 시점에 보통 비어 있지만
          // 비주 터치가 남긴 stale 캐시가 있으면 "옛 매핑" 좌표를 돌려준다. 직후 fabric 의
          // _cacheTransformEventData 가 어차피 재계산하므로 클리어는 안전하다.
          canvas._absolutePointer = null
          canvas._pointer = null
          const scenePointerNew = opt.e ? canvas.getPointer(opt.e) : null
          if (scenePointerNew) {
            const jump = computePointerSceneJump(this._snapshot, current, scenePointerNew)
            compensateTransformAnchors(transform, jump)
            // 보정에 성공했을 때만 스냅샷 갱신 — 포인터 미획득 시 갱신하면 그 제스처의
            // 점프가 영영 미보정 상태로 남는다.
            this._snapshot = current
          }
        }
      } catch (e) {
        // 보정 실패는 치명적이지 않음 — 기존(보정 없음) 동작으로 폴백
        console.warn('[PointerShiftGuardPlugin] compensation skipped:', e)
      }
    }

    this._boundMouseUp = () => {
      this._snapshot = null
    }

    this._canvas.on('mouse:down', this._boundMouseDown)
    this._canvas.on('mouse:move:before', this._boundMouseMoveBefore)
    this._canvas.on('mouse:up', this._boundMouseUp)
  }

  dispose() {
    if (this._boundMouseDown) {
      this._canvas.off('mouse:down', this._boundMouseDown)
      this._boundMouseDown = null
    }
    if (this._boundMouseMoveBefore) {
      this._canvas.off('mouse:move:before', this._boundMouseMoveBefore)
      this._boundMouseMoveBefore = null
    }
    if (this._boundMouseUp) {
      this._canvas.off('mouse:up', this._boundMouseUp)
      this._boundMouseUp = null
    }
    this._snapshot = null
  }
}

export default PointerShiftGuardPlugin
