import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import { getUnitSize } from '../utils/math'

/**
 * TransformFeedbackPlugin (E1 §5-2) — 변형 중 실시간 치수/각도/좌표 피드백
 *
 * - 이동 중 `X/Y mm` · 리사이즈 중 `W×H mm` · 회전 중 `각도°` 를 객체 상단에 표시.
 * - **DOM 오버레이** (canvas.wrapperEl 내 absolute div, pointer-events:none)
 *   — fabric 객체가 아니므로 저장(toJSON)/히스토리/PDF 직렬화와 원천 무관.
 * - 순수 read: 표시 중 객체 속성을 일절 변경하지 않는다 (getBoundingRect/
 *   getScaledWidth/Height/angle 조회만).
 * - mouse:up / object:modified / selection:cleared 에 숨김.
 * - pointer:coarse(터치) 환경에서는 폰트 확대.
 * - dispose() 시 리스너 해제 + DOM 노드 제거 (완전 정리).
 */

export interface TransformFeedbackOptions extends PluginOption {
  /** 오버레이 폰트 크기 px — 기본 12 (coarse pointer 는 COARSE_FONT_SIZE_PX) */
  fontSizePx?: number
}

const FONT_SIZE_PX = 12
const COARSE_FONT_SIZE_PX = 15
/** 객체 상단으로부터의 오버레이 간격 (화면 px) */
const OFFSET_PX = 10

/** mm 좌표 라벨 (이동 중) — px 값은 canvas 평면(150dpi 표시 규약) 기준 */
export function formatMoveLabel(xPx: number, yPx: number): string {
  return `X ${getUnitSize(xPx, 'mm')} · Y ${getUnitSize(yPx, 'mm')} mm`
}

/** mm 치수 라벨 (리사이즈 중) */
export function formatSizeLabel(widthPx: number, heightPx: number): string {
  return `${getUnitSize(widthPx, 'mm')} × ${getUnitSize(heightPx, 'mm')} mm`
}

/** 각도 라벨 (회전 중) — 0~360 정규화, 0.1° 반올림 */
export function formatAngleLabel(angle: number): string {
  const normalized = ((angle % 360) + 360) % 360
  return `${Math.round(normalized * 10) / 10}°`
}

type FabricEventHandler = (e: fabric.IEvent) => void

class TransformFeedbackPlugin extends PluginBase {
  name = 'TransformFeedbackPlugin'
  events: string[] = []
  hotkeys = []

  private _el: HTMLElement | null = null
  private _fontSizePx: number

  private _boundMoving: FabricEventHandler | null = null
  private _boundScaling: FabricEventHandler | null = null
  private _boundRotating: FabricEventHandler | null = null
  private _boundHide: FabricEventHandler | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: TransformFeedbackOptions = {}) {
    super(canvas, editor, options)
    this._fontSizePx = options.fontSizePx ?? FONT_SIZE_PX
    this._init()
  }

  private _init(): void {
    this._boundMoving = this._handleMoving.bind(this)
    this._boundScaling = this._handleScaling.bind(this)
    this._boundRotating = this._handleRotating.bind(this)
    this._boundHide = this._hide.bind(this)
    this._canvas.on('object:moving', this._boundMoving)
    this._canvas.on('object:scaling', this._boundScaling)
    this._canvas.on('object:rotating', this._boundRotating)
    this._canvas.on('mouse:up', this._boundHide)
    this._canvas.on('object:modified', this._boundHide)
    this._canvas.on('selection:cleared', this._boundHide)
  }

  /** 시스템 객체(피드백 대상 아님) 판정 */
  private _isSystemObject(obj: fabric.Object): boolean {
    const extensionType = (obj as fabric.Object & { extensionType?: string }).extensionType
    return (
      obj.id === 'workspace' ||
      obj.type === 'GuideLine' ||
      extensionType === 'guideline' ||
      extensionType === 'printguide' ||
      obj.excludeFromExport === true
    )
  }

  /** 오버레이 DOM lazy 생성 — wrapperEl 없는 환경(node 테스트 등)에서는 null */
  private _ensureElement(): HTMLElement | null {
    if (this._el) return this._el
    const wrapper = (this._canvas as fabric.Canvas & { wrapperEl?: HTMLElement }).wrapperEl
    if (!wrapper || !wrapper.ownerDocument) return null
    const doc = wrapper.ownerDocument

    // pointer:coarse(터치) — 폰트 확대
    const win = doc.defaultView
    let isCoarse = false
    try {
      isCoarse = win?.matchMedia?.('(pointer: coarse)')?.matches === true
    } catch {
      isCoarse = false
    }
    const fontSize = isCoarse ? COARSE_FONT_SIZE_PX : this._fontSizePx

    const el = doc.createElement('div')
    el.style.position = 'absolute'
    el.style.left = '0'
    el.style.top = '0'
    el.style.display = 'none'
    el.style.pointerEvents = 'none'
    el.style.zIndex = '40'
    el.style.padding = '2px 8px'
    el.style.borderRadius = '6px'
    el.style.background = 'rgba(17, 24, 39, 0.85)'
    el.style.color = '#ffffff'
    el.style.fontSize = `${fontSize}px`
    el.style.lineHeight = '1.6'
    el.style.fontVariantNumeric = 'tabular-nums'
    el.style.whiteSpace = 'nowrap'
    el.style.transform = 'translate(-50%, -100%)'
    el.style.userSelect = 'none'
    wrapper.appendChild(el)
    this._el = el
    return el
  }

  /** 라벨 표시 + 객체 화면 위치 추종 (viewport 좌표 = getBoundingRect 기본 호출) */
  private _show(target: fabric.Object, text: string): void {
    const el = this._ensureElement()
    if (!el) return
    // viewport 반영 화면 좌표 (canvas 요소 기준) — 오버레이는 wrapperEl 내 absolute
    const rect = target.getBoundingRect()
    const wrapper = (this._canvas as fabric.Canvas & { wrapperEl?: HTMLElement }).wrapperEl
    const maxW = wrapper?.clientWidth ?? 0
    const maxH = wrapper?.clientHeight ?? 0
    let x = rect.left + rect.width / 2
    let y = rect.top - OFFSET_PX
    // 캔버스 밖 이탈 clamp (임베드 소형 뷰포트 방어)
    if (maxW > 0) x = Math.min(Math.max(x, 40), maxW - 40)
    if (maxH > 0) y = Math.min(Math.max(y, 28), maxH)
    el.textContent = text
    el.style.left = `${Math.round(x)}px`
    el.style.top = `${Math.round(y)}px`
    el.style.display = 'block'
  }

  private _handleMoving(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isSystemObject(target)) return
    // 위치는 workspace 좌상단 기준 mm (인쇄 지면 좌표) — workspace 부재 시 canvas 평면
    const rect = target.getBoundingRect(true, true)
    const workspace = this._getWorkspace()
    let x = rect.left
    let y = rect.top
    if (workspace) {
      const wsRect = workspace.getBoundingRect(true, true)
      x = rect.left - wsRect.left
      y = rect.top - wsRect.top
    }
    this._show(target, formatMoveLabel(x, y))
  }

  private _handleScaling(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isSystemObject(target)) return
    this._show(target, formatSizeLabel(target.getScaledWidth(), target.getScaledHeight()))
  }

  private _handleRotating(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isSystemObject(target)) return
    this._show(target, formatAngleLabel(target.angle ?? 0))
  }

  private _hide(): void {
    if (this._el) {
      this._el.style.display = 'none'
    }
  }

  dispose(): void {
    if (this._boundMoving) {
      this._canvas.off('object:moving', this._boundMoving)
      this._boundMoving = null
    }
    if (this._boundScaling) {
      this._canvas.off('object:scaling', this._boundScaling)
      this._boundScaling = null
    }
    if (this._boundRotating) {
      this._canvas.off('object:rotating', this._boundRotating)
      this._boundRotating = null
    }
    if (this._boundHide) {
      this._canvas.off('mouse:up', this._boundHide)
      this._canvas.off('object:modified', this._boundHide)
      this._canvas.off('selection:cleared', this._boundHide)
      this._boundHide = null
    }
    if (this._el) {
      this._el.remove()
      this._el = null
    }
  }
}

export default TransformFeedbackPlugin
