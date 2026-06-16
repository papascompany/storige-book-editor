import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import CanvasHotkey from '../models/CanvasHotkey'

type AnyObj = fabric.Object & { [k: string]: any }

/**
 * 사진틀(프레임) 인터랙션 플러그인 — 표준 web-to-print(Canva/Pixlr) 모델 구현.
 *
 * 배경: 프레임에 사진을 채우면 사진(fillImage)이 inverted/absolutePositioned clipPath 로
 * 마스킹된다. 채운 사진은 캔버스 절대좌표에 고정된 마스크 창 안에서만 보인다. 그 결과
 * 두 가지 상호작용을 명확히 분리해야 한다.
 *
 *  1) 기본 모드 — "프레임이 선택 단위":
 *     프레임을 이동/스케일/회전하면 사진 + 마스크 창이 **함께** 따라온다(시각적 그룹).
 *     채운 사진은 selectable/evented=false(채우기 시 설정)라 클릭이 프레임을 잡는다.
 *
 *  2) adjust(사진 조정) 모드 — 더블클릭으로 진입:
 *     마스크 창은 캔버스에 고정되고 그 안에서 **사진만** pan/zoom 한다(액자 속 사진 위치 조정).
 *     진입 시 사진 evented=true·프레임 evented=false. 빈 곳 클릭/Esc/선택해제 → 종료.
 *
 * 왜 플러그인(캔버스 레벨)인가:
 *  - EditorView 와 embed(iframe) 모두 createCanvas()→initPlugins() 경로라 한 번 등록으로 둘 다 적용.
 *  - canvas.on 리스너는 loadFromJSON(복원) 후에도 유지되므로 rebind 가 불필요(프레임별 바인딩과 달리).
 *  - Editor.dispose() 가 dispose() 를 호출하므로 멀티페이지 누수 없이 정리된다.
 *
 * 프레임↔사진 링크 규약(기존): 사진은 extensionType==='fillImage', parentLayerId===frame.id.
 * 이 규약으로 ObjectPlugin 의 삭제 동반제거·z-order 동기화와 정합한다.
 */
class FrameInteractionPlugin extends PluginBase {
  name = 'FrameInteractionPlugin'
  events = ['frame:adjustEnter', 'frame:adjustExit']

  // 현재 adjust 모드의 프레임 id (없으면 null)
  private _adjustFrameId: string | null = null

  // 바인딩 핸들러 보관 (dispose 시 정확히 같은 참조로 off)
  private readonly _boundBeforeTransform: (e: fabric.IEvent) => void
  private readonly _boundTransform: (e: fabric.IEvent) => void
  private readonly _boundTransformEnd: () => void
  private readonly _boundDblClick: (e: fabric.IEvent) => void
  private readonly _boundMouseDown: (e: fabric.IEvent) => void
  private readonly _boundSelectionCleared: () => void
  private _boundKeyDown: ((e: KeyboardEvent) => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: PluginOption) {
    super(canvas, editor, options)

    this._boundBeforeTransform = this._onBeforeTransform.bind(this)
    this._boundTransform = this._onTransform.bind(this)
    this._boundTransformEnd = this._onTransformEnd.bind(this)
    this._boundDblClick = this._onDblClick.bind(this)
    this._boundMouseDown = this._onMouseDown.bind(this)
    this._boundSelectionCleared = this._onSelectionCleared.bind(this)

    canvas.on('before:transform', this._boundBeforeTransform)
    canvas.on('object:moving', this._boundTransform)
    canvas.on('object:scaling', this._boundTransform)
    canvas.on('object:rotating', this._boundTransform)
    canvas.on('object:modified', this._boundTransformEnd)
    canvas.on('mouse:up', this._boundTransformEnd)
    canvas.on('mouse:dblclick', this._boundDblClick)
    canvas.on('mouse:down', this._boundMouseDown)
    canvas.on('selection:cleared', this._boundSelectionCleared)
  }

  get hotkeys(): CanvasHotkey[] {
    // Esc 종료는 adjust 중에만 window keydown 으로 처리한다(전역 Esc preventDefault 가로채기 방지).
    return []
  }

  // ── 헬퍼 ──────────────────────────────────────────────────────────────

  /** 프레임에 채워진 사진(fillImage) 찾기 — parentLayerId 규약 */
  private _findFore(frame: fabric.Object | null | undefined): AnyObj | undefined {
    const fid = frame ? (frame as AnyObj).id : undefined
    if (!fid) return undefined
    return this._canvas.getObjects().find(
      (o) => (o as AnyObj).extensionType === 'fillImage' && (o as AnyObj).parentLayerId === fid
    ) as AnyObj | undefined
  }

  /** 채워진 프레임인지 (= 사진을 가진 프레임) */
  private _isFilledFrame(obj?: fabric.Object | null): boolean {
    if (!obj) return false
    return !!this._findFore(obj)
  }

  // ── 베이스라인 캡처 (상호작용 시작 시점의 변환행렬) ──────────────────

  private _onBeforeTransform(e: fabric.IEvent) {
    const target = (e as { transform?: { target?: fabric.Object } }).transform?.target
    this._captureBaseline(target)
  }

  /** 프레임/사진의 시작 변환행렬을 저장 — moving/scaling/rotating 델타 계산용 */
  private _captureBaseline(frame?: fabric.Object | null) {
    if (!frame || !this._isFilledFrame(frame)) return
    const fore = this._findFore(frame)
    ;(frame as AnyObj).__frameTxStart = frame.calcTransformMatrix()
    if (fore) (fore as AnyObj).__frameTxStart = fore.calcTransformMatrix()
  }

  // ── 그룹 동기화 (기본 모드: 프레임 변형 → 사진+마스크 동반) ──────────

  private _onTransform(e: fabric.IEvent) {
    const frame = e.target as fabric.Object | undefined
    if (!frame) return
    // adjust 모드의 프레임은 evented=false 라 여기 들어오지 않지만 방어적으로 skip.
    if (this._adjustFrameId && (frame as AnyObj).id === this._adjustFrameId) return
    if (!this._isFilledFrame(frame)) return
    try {
      this._syncFromFrame(frame)
    } catch (err) {
      // 동기화 실패가 드래그 자체를 깨지 않도록 방어
      console.warn('[FrameInteractionPlugin] sync error', err)
    }
  }

  /**
   * 프레임이 시작 시점 대비 겪은 변환(델타 행렬)을 사진에 동일 적용하고,
   * 마스크 창(clipPath)은 프레임과 정확히 겹치도록 좌표를 직접 맞춘다.
   * 이동/스케일/회전을 행렬로 일괄 처리해 cover 비율·상대 오프셋을 보존한다.
   */
  private _syncFromFrame(frame: fabric.Object) {
    const fore = this._findFore(frame)
    if (!fore) return

    const start = (frame as AnyObj).__frameTxStart as number[] | undefined
    if (!start) {
      // 베이스라인이 없으면 이번 이벤트는 캡처만 (한 프레임 no-op)
      this._captureBaseline(frame)
      return
    }

    const foreStart = (fore as AnyObj).__frameTxStart as number[] | undefined
    const cur = frame.calcTransformMatrix()
    const delta = fabric.util.multiplyTransformMatrices(cur, fabric.util.invertTransform(start))

    if (foreStart) {
      const newM = fabric.util.multiplyTransformMatrices(delta, foreStart)
      const o = fabric.util.qrDecompose(newM)
      fore.set({
        scaleX: o.scaleX,
        scaleY: o.scaleY,
        skewX: o.skewX,
        skewY: o.skewY,
        angle: o.angle,
      })
      fore.setPositionByOrigin(new fabric.Point(o.translateX, o.translateY), 'center', 'center')
      fore.setCoords()
    }

    // 마스크 창은 absolutePositioned 라 캔버스 좌표를 직접 갱신해야 사진을 따라간다(버그 #4 핵심).
    const cp = (fore as AnyObj).clipPath as fabric.Object | undefined
    if (cp) {
      const fc = frame.getCenterPoint()
      cp.set({
        left: fc.x,
        top: fc.y,
        scaleX: frame.scaleX,
        scaleY: frame.scaleY,
        angle: frame.angle,
        flipX: frame.flipX,
        flipY: frame.flipY,
      })
      cp.setCoords()
    }

    this._canvas.requestRenderAll()
  }

  private _onTransformEnd() {
    // 베이스라인 정리 — 다음 상호작용에서 mouse:down/before:transform 가 재캡처
    this._canvas.getObjects().forEach((o) => {
      if ((o as AnyObj).__frameTxStart) delete (o as AnyObj).__frameTxStart
    })
  }

  // ── adjust(사진 조정) 모드 ────────────────────────────────────────────

  private _onDblClick(e: fabric.IEvent) {
    const target = e.target as fabric.Object | undefined
    if (this._isFilledFrame(target)) {
      this._enterAdjust(target as fabric.Object)
    }
  }

  private _enterAdjust(frame: fabric.Object) {
    const fore = this._findFore(frame)
    if (!fore) return
    const fid = (frame as AnyObj).id as string
    if (this._adjustFrameId === fid) return
    if (this._adjustFrameId) this._exitAdjust(false)

    this._adjustFrameId = fid

    // 직전 상태를 보존했다가 종료 시 복원
    ;(fore as AnyObj).__frameAdjustPrev = {
      selectable: fore.selectable,
      evented: fore.evented,
      hasControls: fore.hasControls,
    }
    ;(frame as AnyObj).__frameAdjustPrevEvented = frame.evented

    fore.set({ selectable: true, evented: true, hasControls: true })
    fore.setCoords()
    frame.set({ evented: false })
    this._canvas.setActiveObject(fore)
    this._canvas.requestRenderAll()

    // adjust 중에만 Esc 리스너 활성 (전역 Esc 를 평소엔 가로채지 않음)
    if (!this._boundKeyDown) {
      this._boundKeyDown = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') this._exitAdjust(true)
      }
      window.addEventListener('keydown', this._boundKeyDown)
    }

    this._editor.emit('frame:adjustEnter', { frameId: fid })
  }

  /**
   * @param reselectFrame 종료 후 프레임을 다시 단위 선택할지.
   *   빈 곳/다른 객체 클릭으로 종료할 땐 false(클릭한 대상 선택을 fabric 에 맡김).
   */
  private _exitAdjust(reselectFrame = true) {
    if (!this._adjustFrameId) return
    const fid = this._adjustFrameId
    const frame = this._canvas.getObjects().find((o) => (o as AnyObj).id === fid)
    const fore = frame ? this._findFore(frame) : undefined

    if (fore) {
      const prev = (fore as AnyObj).__frameAdjustPrev as
        | { selectable?: boolean; evented?: boolean; hasControls?: boolean }
        | undefined
      fore.set({
        selectable: prev?.selectable ?? false,
        evented: prev?.evented ?? false,
        hasControls: prev?.hasControls ?? true,
      })
      delete (fore as AnyObj).__frameAdjustPrev
      fore.setCoords()
    }
    if (frame) {
      const prevEv = (frame as AnyObj).__frameAdjustPrevEvented
      frame.set({ evented: prevEv === undefined ? true : prevEv })
      delete (frame as AnyObj).__frameAdjustPrevEvented
    }

    this._adjustFrameId = null
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown)
      this._boundKeyDown = null
    }

    if (reselectFrame && frame) {
      this._canvas.setActiveObject(frame)
    }
    this._canvas.requestRenderAll()
    this._editor.emit('frame:adjustExit', { frameId: fid })
  }

  private _onMouseDown(e: fabric.IEvent) {
    if (!this._adjustFrameId) {
      // 평상시: 채워진 프레임을 누르면 베이스라인 캡처(before:transform 보강)
      this._captureBaseline(e.target as fabric.Object | undefined)
      return
    }
    // adjust 중: 사진(fore)이 아닌 곳을 누르면 종료
    const frame = this._canvas.getObjects().find((o) => (o as AnyObj).id === this._adjustFrameId)
    const fore = this._findFore(frame)
    const target = e.target as fabric.Object | undefined
    if (!target || (fore && target !== fore)) {
      // 다른 객체를 눌렀다면 그 객체 선택을 fabric 에 맡기기 위해 재선택 생략
      this._exitAdjust(false)
    }
  }

  private _onSelectionCleared() {
    if (this._adjustFrameId) this._exitAdjust(false)
  }

  // ── 정리 ──────────────────────────────────────────────────────────────

  dispose() {
    const c = this._canvas
    c.off('before:transform', this._boundBeforeTransform)
    c.off('object:moving', this._boundTransform)
    c.off('object:scaling', this._boundTransform)
    c.off('object:rotating', this._boundTransform)
    c.off('object:modified', this._boundTransformEnd)
    c.off('mouse:up', this._boundTransformEnd)
    c.off('mouse:dblclick', this._boundDblClick)
    c.off('mouse:down', this._boundMouseDown)
    c.off('selection:cleared', this._boundSelectionCleared)
    if (this._boundKeyDown) {
      window.removeEventListener('keydown', this._boundKeyDown)
      this._boundKeyDown = null
    }
  }
}

export default FrameInteractionPlugin
