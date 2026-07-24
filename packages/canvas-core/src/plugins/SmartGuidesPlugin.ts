import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import {
  SnapBounds,
  boundsIntersect,
  computeSnap,
  snapAngle,
  toSnapBounds,
} from '../utils/snapCoordinator'

/**
 * SmartGuidesPlugin (E1 §5-1) — 객체 간 정렬 가이드/스냅 + 회전 각도 스냅
 *
 * - object:moving: 타 객체의 엣지/센터(수직 3선·수평 3선)와 근접 시 마젠타
 *   가이드라인 표시 + 스냅. threshold 는 화면 px 기준(canvas 좌표는 /zoom).
 * - RulerPlugin 경합 회피(AD-E2): RulerPlugin 무수정. 이동 객체 중심이 workspace
 *   중앙 스냅 반경 이내인 축은 SmartGuides 가 양보(스킵) — 이중 당김 구조적 방지.
 * - object:rotating: 0/15/30…° ±3° 스냅, Shift 시 해제(데스크톱). 전역 snapAngle
 *   설정 금지 — 이벤트 방식(target.angle 직접 라운딩)이라 플래그로 개별 off 가능.
 *   FrameInteractionPlugin 의 사진틀 동기화 전파는 그대로 허용(의도 부합).
 * - 성능: 드래그 시작 시 후보 객체 경계 캐시(뷰포트 내 + visible + 비시스템),
 *   mouse:up 에 무효화.
 * - 가이드 객체: id 미부여 + excludeFromExport + extensionType 'guideline'
 *   → 저장(toJSON)/히스토리 스냅샷(_historyNext) 모두 원천 제외.
 *   fabric.GuideLine(RulerPlugin 서브클래스)은 드래그 가능한 사용자 가이드용
 *   인터랙티브 객체(리스너 다수)이고 setupGuideLine() 이후에만 존재하므로
 *   재사용하지 않고 plain fabric.Line 을 쓴다(룰러 off 환경에서도 동작).
 */

export interface SmartGuidesOptions extends PluginOption {
  /** 가이드 표시 임계값 (화면 px) — 기본 15 (RulerPlugin 과 동일 감각) */
  showThresholdPx?: number
  /** 스냅 임계값 (화면 px) — 기본 8 */
  snapThresholdPx?: number
  /** 회전 스냅 간격(°) — 기본 15 */
  angleStep?: number
  /** 회전 스냅 허용 오차(°) — 기본 3 */
  angleToleranceDeg?: number
  /** 가이드 색 — 기본 마젠타 */
  guideColor?: string
}

const SHOW_THRESHOLD_SCREEN_PX = 15
const SNAP_THRESHOLD_SCREEN_PX = 8
/**
 * workspace 중앙 양보 반경 — RulerPlugin 의 중앙 스냅 임계값(canvas 좌표 8px,
 * RulerPlugin.ts snapThreshold)과 동일 값·동일 좌표계. 룰러가 당길 수 있는
 * 영역에서는 SmartGuides 가 해당 축을 스킵해 이중 당김을 구조적으로 막는다.
 */
const WORKSPACE_CENTER_YIELD_CANVAS_PX = 8
const ANGLE_SNAP_STEP = 15
const ANGLE_SNAP_TOLERANCE = 3
const GUIDE_COLOR = '#ff00ff'
const GUIDE_EXTENT = 999999
/** printguide(cut/safe border) 등 스냅 후보·스냅 대상에서 제외할 extensionType */
const EXCLUDED_EXTENSION_TYPES = new Set(['guideline', 'printguide'])

type FabricEventHandler = (e: fabric.IEvent) => void

class SmartGuidesPlugin extends PluginBase {
  name = 'SmartGuidesPlugin'
  events: string[] = []
  hotkeys = []

  private _showThresholdPx: number
  private _snapThresholdPx: number
  private _angleStep: number
  private _angleTolerance: number
  private _guideColor: string
  // §6-3 스냅 설정(런타임 토글) — 기본 on(현행 거동). 순수 거동 게이트만 하고 생성자 옵션·
  // 이벤트 바인딩은 불변(생성 순서 계약 P0 준수).
  private _objectSnapEnabled = true
  private _angleSnapEnabled = true
  // 중앙스냅 토글에 연동 — false 면 RulerPlugin 중앙스냅에 축을 양보하지 않는다(중앙스냅 OFF +
  // 객체스냅 ON 시 중앙 근처가 무-스냅이 되는 데드존 방지, 적대 리뷰 함정).
  private _centerYieldEnabled = true

  private _candidateBounds: SnapBounds[] | null = null
  private _isDragging = false
  private _guideV: fabric.Line | null = null
  private _guideH: fabric.Line | null = null

  private _boundObjectMoving: FabricEventHandler | null = null
  private _boundObjectRotating: FabricEventHandler | null = null
  private _boundMouseUp: FabricEventHandler | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: SmartGuidesOptions = {}) {
    super(canvas, editor, options)
    this._showThresholdPx = options.showThresholdPx ?? SHOW_THRESHOLD_SCREEN_PX
    this._snapThresholdPx = options.snapThresholdPx ?? SNAP_THRESHOLD_SCREEN_PX
    this._angleStep = options.angleStep ?? ANGLE_SNAP_STEP
    this._angleTolerance = options.angleToleranceDeg ?? ANGLE_SNAP_TOLERANCE
    this._guideColor = options.guideColor ?? GUIDE_COLOR
    this._init()
  }

  private _init(): void {
    this._boundObjectMoving = this._handleObjectMoving.bind(this)
    this._boundObjectRotating = this._handleObjectRotating.bind(this)
    this._boundMouseUp = this._handleMouseUp.bind(this)
    this._canvas.on('object:moving', this._boundObjectMoving)
    this._canvas.on('object:rotating', this._boundObjectRotating)
    this._canvas.on('mouse:up', this._boundMouseUp)
  }

  /** 시스템 객체(스냅 주체/후보 모두 불가) 판정 */
  private _isSystemObject(obj: fabric.Object): boolean {
    const extensionType = (obj as fabric.Object & { extensionType?: string }).extensionType
    return (
      obj.id === 'workspace' ||
      obj.type === 'GuideLine' ||
      (extensionType !== undefined && EXCLUDED_EXTENSION_TYPES.has(extensionType)) ||
      obj.excludeFromExport === true
    )
  }

  /** 드래그 시작 시 1회 — 뷰포트 내 가시 비시스템 객체 경계 캐시 */
  private _buildCandidateCache(target: fabric.Object): SnapBounds[] {
    const viewportRect = this._getViewportRect()
    const activeObjects: fabric.Object[] = this._canvas.getActiveObjects
      ? this._canvas.getActiveObjects()
      : []
    const candidates: SnapBounds[] = []
    for (const obj of this._canvas.getObjects()) {
      if (obj === target) continue
      if (obj.visible === false) continue
      if (this._isSystemObject(obj)) continue
      // ActiveSelection(다중 선택) 이동 시 선택 멤버는 후보에서 제외 — 자기 스냅 방지
      if (activeObjects.includes(obj)) continue
      // group(ActiveSelection) 소속 객체도 제외 (getActiveObjects 미포함 케이스 방어)
      if ((obj as fabric.Object & { group?: fabric.Object }).group === target) continue
      const bounds = toSnapBounds(obj.getBoundingRect(true, true))
      if (viewportRect && !boundsIntersect(bounds, viewportRect)) continue
      candidates.push(bounds)
    }
    return candidates
  }

  /** 현재 뷰포트의 canvas 평면 사각형 (calcViewportBoundaries 미지원 mock 대비 null 허용) */
  private _getViewportRect(): { left: number; top: number; right: number; bottom: number } | null {
    const calc = (this._canvas as fabric.Canvas & {
      calcViewportBoundaries?: () => { tl: { x: number; y: number }; br: { x: number; y: number } }
    }).calcViewportBoundaries
    if (typeof calc !== 'function') return null
    const { tl, br } = calc.call(this._canvas)
    return { left: tl.x, top: tl.y, right: br.x, bottom: br.y }
  }

  /** §6-3: 객체 스냅(정렬 가이드/스냅) 런타임 토글. early-return 게이트만 — 리스너 불변. */
  setObjectSnapEnabled(enabled: boolean): void {
    this._objectSnapEnabled = enabled
    if (!enabled) this._hideGuides()
  }
  /** §6-3: 각도(회전) 스냅 런타임 토글. */
  setAngleSnapEnabled(enabled: boolean): void {
    this._angleSnapEnabled = enabled
  }
  /** §6-3: 중앙축 룰러 양보 토글(중앙스냅 토글에 연동) — off 면 중앙 근처도 객체 스냅 적용. */
  setCenterYieldEnabled(enabled: boolean): void {
    this._centerYieldEnabled = enabled
  }

  private _handleObjectMoving(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isSystemObject(target)) return

    this._isDragging = true
    // §6-3: 객체 스냅 OFF → 스냅·가이드 모두 스킵
    if (!this._objectSnapEnabled) {
      this._hideGuides()
      return
    }
    if (!this._candidateBounds) {
      this._candidateBounds = this._buildCandidateCache(target)
    }
    if (this._candidateBounds.length === 0) {
      this._hideGuides()
      return
    }

    const zoom = this._canvas.getZoom() || 1
    const showThreshold = this._showThresholdPx / zoom
    const snapThreshold = this._snapThresholdPx / zoom

    const moving = toSnapBounds(target.getBoundingRect(true, true))
    const objCenter = target.getCenterPoint()

    // RulerPlugin 중앙 스냅 양보 판정 (축별) — 룰러와 동일 좌표계(canvas px)·동일 반경
    let yieldX = false
    let yieldY = false
    const workspace = this._getWorkspace()
    if (workspace && this._centerYieldEnabled) {
      const wsCenter = workspace.getCenterPoint()
      yieldX = Math.abs(objCenter.x - wsCenter.x) < WORKSPACE_CENTER_YIELD_CANVAS_PX
      yieldY = Math.abs(objCenter.y - wsCenter.y) < WORKSPACE_CENTER_YIELD_CANVAS_PX
    }

    const snap = computeSnap(moving, this._candidateBounds, showThreshold, snapThreshold)

    // 스냅 적용 — 객체 중심 기준 이동 (RulerPlugin 과 동일하게 origin 영향 제거)
    const deltaX = !yieldX && snap.x.delta !== null ? snap.x.delta : 0
    const deltaY = !yieldY && snap.y.delta !== null ? snap.y.delta : 0
    if (deltaX !== 0 || deltaY !== 0) {
      target.setPositionByOrigin(
        new fabric.Point(objCenter.x + deltaX, objCenter.y + deltaY),
        'center',
        'center'
      )
      target.setCoords()
    }

    // 가이드 표시 (양보 축은 룰러의 중앙 가이드가 담당 — 표시도 스킵)
    const showV = !yieldX && snap.x.guideLine !== null
    const showH = !yieldY && snap.y.guideLine !== null
    if (showV || showH) this._ensureGuides()
    this._setGuideVisible(this._guideV, showV, { left: snap.x.guideLine ?? 0 }, zoom)
    this._setGuideVisible(this._guideH, showH, { top: snap.y.guideLine ?? 0 }, zoom)
    this._canvas.requestRenderAll()
  }

  private _handleObjectRotating(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isSystemObject(target)) return

    // §6-3: 각도 스냅 OFF → 라운딩 안 함
    if (!this._angleSnapEnabled) return

    // Shift 홀드 시 스냅 해제 (데스크톱 전용 — 터치는 상시 스냅, 플래그로 개별 off 가능)
    const domEvent = e.e as MouseEvent | undefined
    if (domEvent && domEvent.shiftKey === true) return

    const snapped = snapAngle(target.angle ?? 0, this._angleStep, this._angleTolerance)
    if (snapped !== null && snapped !== target.angle) {
      // fabric 자체 snapAngle 구현과 동일하게 angle 직접 라운딩.
      // 사진틀 동기화 정합은 **바인딩 순서**로 보장된다: fabric 이벤트는 등록 순서대로
      // 발화하며, createCanvas 가 본 플러그인을 FrameInteractionPlugin 보다 먼저
      // 생성(=먼저 바인딩)하므로 FrameInteraction 의 object:rotating 핸들러는 이미
      // 스냅된 각을 받아 사진(fillImage)/마스크(clipPath)에 동일 적용한다
      // (생성 순서 계약 — apps/editor/src/utils/createCanvas.ts).
      target.set('angle', snapped)
      target.setCoords()
    }
  }

  private _handleMouseUp(): void {
    if (this._isDragging) {
      this._isDragging = false
      this._hideGuides()
      this._canvas.requestRenderAll()
    }
    // 드래그 종료 시 후보 캐시 무효화 (객체 추가/이동 반영 위해 매 드래그 재수집)
    this._candidateBounds = null
  }

  /**
   * 참조 객체가 현재 캔버스에 실제 소속되어 있는가.
   * canvas.clear()/loadFromJSON(ServicePlugin.toPDF/loadJSON, 임시저장 불러오기,
   * 백업 복원 등)은 캔버스 객체 목록을 갈아치우므로, 풀 참조가 non-null 이어도
   * 캔버스 미소속 유령이 될 수 있다 — 이대로 두면 시각층(가이드)이 영구 사망한다
   * (스냅 로직은 동작하나 가이드만 안 보임). SafeZoneWarningPlugin 과 동일 정책.
   */
  private _isAttached(obj: fabric.Object): boolean {
    return this._canvas.getObjects().indexOf(obj) !== -1
  }

  /** 가이드 라인 풀 생성 (lazy) — id 미부여·excludeFromExport·guideline */
  private _ensureGuides(): void {
    const attachedV = this._guideV !== null && this._isAttached(this._guideV)
    const attachedH = this._guideH !== null && this._isAttached(this._guideH)
    if (attachedV && attachedH) return
    // 유령 참조/짝 깨짐 — 잔존측을 제거하고 풀 전체를 재생성한다(짝 불변식 유지, 중복 방지)
    if (this._guideV && attachedV) this._canvas.remove(this._guideV)
    if (this._guideH && attachedH) this._canvas.remove(this._guideH)
    this._guideV = null
    this._guideH = null
    const common = {
      stroke: this._guideColor,
      strokeWidth: 1,
      selectable: false,
      evented: false,
      visible: false,
      excludeFromExport: true,
      extensionType: 'guideline',
      originX: 'center' as const,
      originY: 'center' as const,
    }
    // 레포 타입 규약(fabric.d.ts ILineOptions)은 사용자 객체에 id 를 강제하지만,
    // 스마트 가이드는 "id 미부여" 가 계약(§8.2 — _loadHistory 삭제 판정 원천 회피)
    // 이므로 이 지점만 좁게 캐스팅한다(전역 타입 약화 금지).
    this._guideV = new fabric.Line(
      [0, -GUIDE_EXTENT, 0, GUIDE_EXTENT],
      { ...common } as unknown as fabric.ILineOptions
    )
    this._guideH = new fabric.Line(
      [-GUIDE_EXTENT, 0, GUIDE_EXTENT, 0],
      { ...common } as unknown as fabric.ILineOptions
    )
    // excludeFromExport 라 history 이벤트 게이트가 add 를 스킵 — 히스토리 무오염
    this._canvas.add(this._guideV)
    this._canvas.add(this._guideH)
  }

  private _setGuideVisible(
    guide: fabric.Line | null,
    visible: boolean,
    position: { left?: number; top?: number },
    zoom: number
  ): void {
    if (!guide) return
    if (visible) {
      guide.set({
        ...position,
        visible: true,
        // 줌 무관 화면 1px 두께 유지
        strokeWidth: 1 / zoom,
      })
      guide.setCoords()
      guide.bringToFront()
    } else if (guide.visible) {
      guide.set('visible', false)
    }
  }

  private _hideGuides(): void {
    if (this._guideV?.visible) this._guideV.set('visible', false)
    if (this._guideH?.visible) this._guideH.set('visible', false)
  }

  /** 저장 직전 가이드 숨김 (RulerPlugin 패턴 — 썸네일 캡처류 방어) */
  beforeSave(): Promise<void> {
    return new Promise((resolve) => {
      this._hideGuides()
      resolve()
    })
  }

  dispose(): void {
    if (this._boundObjectMoving) {
      this._canvas.off('object:moving', this._boundObjectMoving)
      this._boundObjectMoving = null
    }
    if (this._boundObjectRotating) {
      this._canvas.off('object:rotating', this._boundObjectRotating)
      this._boundObjectRotating = null
    }
    if (this._boundMouseUp) {
      this._canvas.off('mouse:up', this._boundMouseUp)
      this._boundMouseUp = null
    }
    if (this._guideV) {
      this._canvas.remove(this._guideV)
      this._guideV = null
    }
    if (this._guideH) {
      this._canvas.remove(this._guideH)
      this._guideH = null
    }
    this._candidateBounds = null
    this._isDragging = false
  }
}

export default SmartGuidesPlugin
