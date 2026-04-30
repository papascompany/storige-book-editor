import { fabric } from 'fabric'
import Editor from '../Editor'
import CanvasHotkey from '../models/CanvasHotkey'
import { PluginBase } from '../plugin'

declare type ExtCanvas = fabric.Canvas & {
  isDragging: boolean
  lastPosX: number
  lastPosY: number
}

class DraggingPlugin extends PluginBase {
  name = 'DraggingPlugin'
  events = ['startDragging', 'endDragging']
  hotkeys: CanvasHotkey[] = []

  dragMode = false

  // 이벤트 핸들러 참조 저장 (cleanup용)
  private _boundMouseDown: ((opt: fabric.IEvent) => void) | null = null
  private _boundMouseMove: ((opt: fabric.IEvent) => void) | null = null
  private _boundMouseUp: (() => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})

    this.dragMode = false
    this.initDragging()
  }

  addItem(item: fabric.Object, event?: DragEvent) {
    if (event) {
      const { left, top } = this._canvas.getSelectionElement().getBoundingClientRect()
      if (event.x < left || event.y < top || item.width === undefined) return

      const point = {
        x: event.x - left,
        y: event.y - top
      }
      const pointerVpt = this._canvas.restorePointerVpt(point)
      item.left = pointerVpt.x - item.width / 2
      item.top = pointerVpt.y
    }

    item.scaleToWidth(this._getWorkspace().width / 2)
    this._canvas.add(item)
    this._canvas.requestRenderAll()
  }

  dispose() {
    // window 이벤트 리스너 제거
    window.removeEventListener('keydown', this.setDragMode)
    window.removeEventListener('keyup', this.setDragMode)

    // 캔버스 이벤트 리스너 제거
    if (this._boundMouseDown) {
      this._canvas.off('mouse:down', this._boundMouseDown)
      this._boundMouseDown = null
    }
    if (this._boundMouseMove) {
      this._canvas.off('mouse:move', this._boundMouseMove)
      this._boundMouseMove = null
    }
    if (this._boundMouseUp) {
      this._canvas.off('mouse:up', this._boundMouseUp)
      this._boundMouseUp = null
    }
  }

  private isCanvasVisible(): boolean {
    if (!this._canvas) return false
    const el = this._canvas.wrapperEl || this._canvas.getElement()?.parentElement
    if (!el) return false
    return el.offsetParent !== null && getComputedStyle(el).display !== 'none'
  }

  private startDragging() {
    // 캔버스가 dispose되었거나 컨텍스트가 없으면 무시
    if (!this._canvas || (this._canvas as any).disposed || !(this._canvas as any).contextContainer) return
    // 숨겨진 캔버스에서는 드래그 모드 활성화 안함
    if (!this.isCanvasVisible()) return

    this.dragMode = true
    this._canvas.defaultCursor = 'grab'
    // 드래그 모드에서는 타겟 탐색 비활성화 → defaultCursor가 항상 적용됨
    // (workspace Rect의 hoverCursor가 defaultCursor를 덮어쓰는 문제 방지)
    this._canvas.skipTargetFind = true
    this._editor.emit('startDragging')
    this._canvas.renderAll()
  }

  private endDragging() {
    // 캔버스가 dispose되었거나 컨텍스트가 없으면 무시
    if (!this._canvas || (this._canvas as any).disposed || !(this._canvas as any).contextContainer) return

    this.dragMode = false
    this._canvas.defaultCursor = 'default'
    this._canvas.skipTargetFind = false
    this._canvas.isDragging = false
    this._canvas.selection = true // 선택 기능 다시 활성화
    this._editor.emit('endDragging')
    this._canvas.renderAll()
  }

  private setDragMode = (e: KeyboardEvent) => {
    if (e.code === 'Space' && e.type === 'keydown') {
      if (!this.dragMode) {
        this.startDragging()
      }
    } else if (e.code === 'Space' && e.type === 'keyup') {
      if (this.dragMode) {
        this.endDragging()
      }
    }
  }

  private initDragging() {
    const vm = this

    window.addEventListener('keydown', this.setDragMode)
    window.addEventListener('keyup', this.setDragMode)

    // mouse/pointer/touch 이벤트에서 좌표/altKey 를 안전하게 추출.
    // TouchEvent 는 clientX/clientY/altKey 가 직접 없고 touches[0] 에 있다.
    const getEventPoint = (e: any): { x: number; y: number; altKey: boolean } => {
      if (!e) return { x: 0, y: 0, altKey: false }
      if (typeof e.clientX === 'number') {
        return { x: e.clientX, y: e.clientY, altKey: !!e.altKey }
      }
      const t = e.touches?.[0] ?? e.changedTouches?.[0]
      if (t) return { x: t.clientX, y: t.clientY, altKey: !!e.altKey }
      return { x: 0, y: 0, altKey: false }
    }

    // 핸들러 참조 저장 (cleanup을 위해)
    this._boundMouseDown = function (this: ExtCanvas, opt: fabric.IEvent) {
      const { x, y, altKey } = getEventPoint(opt.e)
      // 터치에서는 altKey 가 항상 false → dragMode 일 때만 panning 시작
      if (altKey || vm.dragMode) {
        vm._canvas!.offHistory()

        vm._canvas.defaultCursor = 'grabbing'
        //vm._canvas.discardActiveObject();
        vm.setDragging()

        this.isDragging = true
        this.lastPosX = x
        this.lastPosY = y
        this.requestRenderAll()
        vm._canvas!.onHistory()
      }
    }

    this._boundMouseMove = function (this: ExtCanvas, opt: fabric.IEvent) {
      if (this.isDragging) {
        //vm._canvas.discardActiveObject();
        vm._canvas.defaultCursor = 'grabbing'
        const { x, y } = getEventPoint(opt.e)
        if (!this.viewportTransform) return
        const vpt = this.viewportTransform
        vpt[4] += x - this.lastPosX
        vpt[5] += y - this.lastPosY
        this.lastPosX = x
        this.lastPosY = y
        this.requestRenderAll()
      }
    }

    this._boundMouseUp = function (this: ExtCanvas) {
      if (!this.viewportTransform) return
      this.setViewportTransform(this.viewportTransform)
      this.isDragging = false
      if (!vm.dragMode) {
        vm._canvas.defaultCursor = 'default'
        vm._canvas.skipTargetFind = false
      } else {
        vm._canvas.defaultCursor = 'grab'
      }
      this.requestRenderAll()
    }

    this._canvas.on('mouse:down', this._boundMouseDown)
    this._canvas.on('mouse:move', this._boundMouseMove)
    this._canvas.on('mouse:up', this._boundMouseUp)
  }

  private setDragging() {
    this._canvas.selection = false
    this._canvas.defaultCursor = 'grab'

    this._canvas.requestRenderAll()
  }
}

export default DraggingPlugin
