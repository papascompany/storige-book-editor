import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'

/**
 * SafeZoneWarningPlugin (E1 §5-5) — 재단/안전영역 침범 실시간 경고
 *
 * object:moving/scaling 중 대상 객체 경계가 안전영역(safeSizeBorder) 밖으로 나가거나
 * (안전영역이 없으면 재단선 cutBorder 기준) 재단선을 넘보면:
 *  ① 워크스페이스 경계 강조 오버레이(주황 사각 테두리)를 표시하고
 *  ② `safeZoneViolation` 이벤트를 발행한다 — canvas-core 는 editor 스토어에 직접
 *     의존하지 않으므로 토스트는 editor 쪽 구독(useSafeZoneWarningToast)이 담당
 *     (WorkspacePlugin `objectOutOfTrim` → useObjectOutOfTrimToast 브리지 전례 준용).
 *
 * - 경계 좌표는 WorkspacePlugin 이 생성한 `safe-zone-border` / `cut-border` 객체의
 *   실측 bounding rect 를 **재사용**한다(신규 계산 금지) — 스프레드(펼침면) 모드에서도
 *   WorkspacePlugin 이 배치한 좌표를 그대로 따르므로 정합이 유지된다.
 * - 디바운스: 침범 상태 **전이 시 1회**만 발행(enter 에서만 emit, 유지 중 무발화,
 *   복귀 시 오버레이만 숨김) — 과발화 원천 차단.
 * - 오버레이: SmartGuides 풀링 패턴 — id 미부여 + excludeFromExport +
 *   extensionType 'guideline' → 저장(toJSON)/히스토리 스냅샷/PDF 원천 제외.
 * - 제외: workspace/시스템·가이드 객체, 배경(의도적으로 블리드까지 확장),
 *   보호객체(movable===false — 사용자 이동 불가 객체는 경고 대상 아님).
 * - 두 경계 객체가 모두 없으면(예: cutline-template 상품) 완전 inert.
 */

export interface SafeZoneWarningOptions extends PluginOption {
  /** 경계 강조 색 — 기본 주황 (cutBorder 색상 계열) */
  warningColor?: string
  /** 강조 테두리 두께 (화면 px, strokeUniform) — 기본 2 */
  warningStrokeWidth?: number
}

const WARNING_COLOR = '#ff7a00'
const WARNING_STROKE_WIDTH = 2
/** 경계 판정 부동소수 여유 (WorkspacePlugin checkObjectsOutOfTrim 과 동일 0.5px) */
const EPS = 0.5

/** WorkspacePlugin checkObjectsOutOfTrim 과 동일한 제외 정책 (+ guideline/clipping) */
const EXCLUDED_IDS = new Set([
  'workspace',
  'template-background',
  'template-mockup',
  'page-outline',
  'cutline-template',
  'crop-marks',
  'cut-border',
  'safe-zone-border',
])
const EXCLUDED_EXTENSION_TYPES = new Set([
  'printguide',
  'outline',
  'overlay',
  'template-element',
  'guideline',
  'background',
  'clipping',
])

interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** a 가 b 와 교차하는가 (경계 접촉 포함) */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.left < b.left + b.width + EPS &&
    a.left + a.width > b.left - EPS &&
    a.top < b.top + b.height + EPS &&
    a.top + a.height > b.top - EPS
  )
}

/** inner 가 outer 안에 완전히 포함되는가 (EPS 여유) */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.left >= outer.left - EPS &&
    inner.top >= outer.top - EPS &&
    inner.left + inner.width <= outer.left + outer.width + EPS &&
    inner.top + inner.height <= outer.top + outer.height + EPS
  )
}

type FabricEventHandler = (e: fabric.IEvent) => void

class SafeZoneWarningPlugin extends PluginBase {
  name = 'SafeZoneWarningPlugin'
  events: string[] = ['safeZoneViolation']
  hotkeys = []

  private _warningColor: string
  private _warningStrokeWidth: number

  private _overlay: fabric.Rect | null = null
  private _violating = false

  private _boundTransform: FabricEventHandler | null = null
  private _boundReset: FabricEventHandler | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: SafeZoneWarningOptions = {}) {
    super(canvas, editor, options)
    this._warningColor = options.warningColor ?? WARNING_COLOR
    this._warningStrokeWidth = options.warningStrokeWidth ?? WARNING_STROKE_WIDTH
    this._init()
  }

  private _init(): void {
    this._boundTransform = this._handleTransform.bind(this)
    this._boundReset = this._reset.bind(this)
    this._canvas.on('object:moving', this._boundTransform)
    this._canvas.on('object:scaling', this._boundTransform)
    this._canvas.on('mouse:up', this._boundReset)
    this._canvas.on('object:modified', this._boundReset)
    this._canvas.on('selection:cleared', this._boundReset)
  }

  /** 경고 대상이 아닌 객체(시스템/가이드/배경/보호객체) 판정 */
  private _isExcludedTarget(obj: fabric.Object): boolean {
    const o = obj as fabric.Object & {
      extensionType?: string
      movable?: boolean
      meta?: { system?: boolean }
    }
    if (o.meta?.system) return true
    if (obj.excludeFromExport === true) return true
    if (obj.id && EXCLUDED_IDS.has(obj.id)) return true
    if (o.extensionType && EXCLUDED_EXTENSION_TYPES.has(o.extensionType)) return true
    if (obj.type === 'GuideLine') return true
    // 보호객체(위치고정)는 사용자 조작으로 침범할 수 없음 — 경고 제외
    if (o.movable === false) return true
    return false
  }

  private _findById(id: string): fabric.Object | undefined {
    return this._canvas.getObjects().find((obj: fabric.Object) => obj.id === id)
  }

  private _handleTransform(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isExcludedTarget(target)) return

    // WorkspacePlugin 이 생성한 경계 객체 좌표 재사용 (신규 계산 금지)
    const safeBorder = this._findById('safe-zone-border')
    const cutBorder = this._findById('cut-border')
    const boundary = safeBorder ?? cutBorder
    if (!boundary) return // cutline-template 등 경계 없는 상품 — inert

    const boundaryRect = boundary.getBoundingRect(true, true)
    // 인쇄영역 판정은 재단선(없으면 안전영역) — 지면 밖에 통째로 있는 객체(파킹)는 경고 대상 아님
    const printableRect = (cutBorder ?? boundary).getBoundingRect(true, true)
    const objRect = target.getBoundingRect(true, true)

    const violating =
      rectsIntersect(objRect, printableRect) && !rectContains(boundaryRect, objRect)

    if (violating && !this._violating) {
      // 침범 진입 전이 — 오버레이 표시 + 이벤트 1회 발행 (디바운스 = 전이 기반)
      this._showOverlay(boundaryRect)
      this._editor.emit('safeZoneViolation', {
        objectId: (target as fabric.Object & { id?: string }).id,
        boundary: safeBorder ? 'safe' : 'cut',
      })
    } else if (!violating && this._violating) {
      // 복귀 전이 — 오버레이만 숨김 (재침범 시 다시 1회 발행)
      this._hideOverlay()
    }
    this._violating = violating
  }

  private _reset(): void {
    if (this._violating || this._overlay?.visible) {
      this._hideOverlay()
      this._canvas.requestRenderAll()
    }
    this._violating = false
  }

  /** 오버레이 풀 생성 (lazy) — id 미부여·excludeFromExport·guideline (SmartGuides 패턴) */
  private _ensureOverlay(): fabric.Rect {
    if (this._overlay) return this._overlay
    const options = {
      fill: 'transparent',
      stroke: this._warningColor,
      strokeWidth: this._warningStrokeWidth,
      strokeUniform: true,
      selectable: false,
      evented: false,
      visible: false,
      excludeFromExport: true,
      extensionType: 'guideline',
      originX: 'left' as const,
      originY: 'top' as const,
      // 히스토리/저장 원천 제외 계약: id 미부여 (§8.2 — _loadHistory 삭제 판정 회피)
    }
    this._overlay = new fabric.Rect(options as unknown as fabric.IRectOptions)
    this._canvas.add(this._overlay)
    return this._overlay
  }

  private _showOverlay(rect: Rect): void {
    const overlay = this._ensureOverlay()
    overlay.set({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      scaleX: 1,
      scaleY: 1,
      visible: true,
    })
    overlay.setCoords()
    overlay.bringToFront()
    this._canvas.requestRenderAll()
  }

  private _hideOverlay(): void {
    if (this._overlay?.visible) {
      this._overlay.set('visible', false)
      this._canvas.requestRenderAll()
    }
  }

  /** 저장 직전 오버레이 숨김 (SmartGuides/Ruler 패턴 — 썸네일 캡처류 방어) */
  beforeSave(): Promise<void> {
    return new Promise((resolve) => {
      this._hideOverlay()
      resolve()
    })
  }

  dispose(): void {
    if (this._boundTransform) {
      this._canvas.off('object:moving', this._boundTransform)
      this._canvas.off('object:scaling', this._boundTransform)
      this._boundTransform = null
    }
    if (this._boundReset) {
      this._canvas.off('mouse:up', this._boundReset)
      this._canvas.off('object:modified', this._boundReset)
      this._canvas.off('selection:cleared', this._boundReset)
      this._boundReset = null
    }
    if (this._overlay) {
      this._canvas.remove(this._overlay)
      this._overlay = null
    }
    this._violating = false
  }
}

export default SafeZoneWarningPlugin
