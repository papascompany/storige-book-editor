import { fabric } from 'fabric'
import CanvasRuler, { RulerOptions } from '../ruler/ruler'
import Editor from '../Editor'
import { PluginBase } from '../plugin'
import { setupGuideLine } from '../ruler/guideline'
import { getRulerDefaults, type RulerTheme } from '../ruler/constants'

class RulerPlugin extends PluginBase {
  events = []
  hotkeys = []
  name = 'RulerPlugin'

  public ruler: CanvasRuler | null = null
  private centerGuidelineH: fabric.Line | null = null
  private centerGuidelineV: fabric.Line | null = null
  private isDragging: boolean = false
  private boundHandleObjectMoving: any
  private boundHandleMouseUp: any
  private boundUpdateCenterGuidelines: (() => void) | null = null
  // §6-3: 중앙 스냅 런타임 토글 — 기본 on(현행 거동). off 면 중앙 가이드 표시·스냅 모두 스킵.
  private _centerSnapEnabled: boolean = true

  constructor(canvas: fabric.Canvas, editor: Editor, options: RulerOptions) {
    super(canvas, editor, options)
    this.init(options)
  }

  /** §6-3: 중앙 스냅 런타임 토글. early-return 게이트만(리스너·룰러 표시 불변). */
  setCenterSnapEnabled(enabled: boolean): void {
    this._centerSnapEnabled = enabled
  }

  init(options: RulerOptions) {
    this.ruler = new CanvasRuler(this._canvas, options)
    setupGuideLine(this._canvas)

    // 이벤트 핸들러 바인딩
    this.boundHandleObjectMoving = this.handleObjectMoving.bind(this)
    this.boundHandleMouseUp = this.handleMouseUp.bind(this)

    // 초기화 지연
    setTimeout(() => {
      this.initCenterGuidelines()
    }, 500)
  }

  hideGuideline() {
    this._canvas.getObjects(fabric.GuideLine.prototype.type).forEach((guideLine) => {
      guideLine.set('visible', false)
    })

    // 중앙 가이드라인도 숨김
    if (this.centerGuidelineH) this.centerGuidelineH.set('visible', false)
    if (this.centerGuidelineV) this.centerGuidelineV.set('visible', false)

    this._canvas.renderAll()
  }

  enable() {
    this.ruler?.enable()
    this.showGuideline()

    // 센터 가이드라인이 없으면 다시 초기화
    if (!this.centerGuidelineH || !this.centerGuidelineV) {
      this.initCenterGuidelines()
    }
  }

  /**
   * 룰러 색상 팔레트를 light/dark 테마로 전환.
   * editor의 useCanvasThemeSync hook이 테마 변경 시 호출.
   * (cover.md / editor_layout_custom.md §8.3 다크 모드 Phase 3)
   */
  setTheme(theme: RulerTheme): void {
    if (!this.ruler) return
    const defaults = getRulerDefaults(theme)
    const opts = (this.ruler as any)._options
    if (!opts) return
    opts.backgroundColor = defaults.BACKGROUND_COLOR
    opts.textColor = defaults.TEXT_COLOR
    opts.borderColor = defaults.BORDER_COLOR
    opts.highlightColor = defaults.HIGHLIGHT_COLOR
    // 새 색상으로 즉시 다시 그리기
    if (typeof (this.ruler as any).forceReset === 'function') {
      ;(this.ruler as any).forceReset()
    }
  }

  // lifecycle hooks
  beforeSave(): Promise<void> {
    return new Promise((resolve) => {
      this.hideGuideline()
      resolve()
    })
  }

  // 플러그인 정리
  dispose() {
    // 이벤트 리스너 제거
    if (this.boundHandleObjectMoving) {
      this._canvas.off('object:moving', this.boundHandleObjectMoving)
      this.boundHandleObjectMoving = null
    }
    if (this.boundHandleMouseUp) {
      this._canvas.off('mouse:up', this.boundHandleMouseUp)
      this.boundHandleMouseUp = null
    }
    if (this.boundUpdateCenterGuidelines) {
      this._canvas.off('resize', this.boundUpdateCenterGuidelines)
      this._editor.off('sizeChange', this.boundUpdateCenterGuidelines)
      this.boundUpdateCenterGuidelines = null
    }

    // 가이드라인 제거
    if (this.centerGuidelineH) {
      this._canvas.remove(this.centerGuidelineH)
      this.centerGuidelineH = null
    }

    if (this.centerGuidelineV) {
      this._canvas.remove(this.centerGuidelineV)
      this.centerGuidelineV = null
    }

    // 부모 클래스의 dispose 호출
    if (this.ruler) {
      this.ruler.dispose()
      this.ruler = null
    }
  }

  /**
   * 사용자가 추가한 가이드라인을 표시합니다.
   * 중앙 가이드라인(center-guideline-h, center-guideline-v)은 제외됩니다.
   */
  showGuideline() {
    this._canvas.getObjects(fabric.GuideLine.prototype.type).forEach((guideLine) => {
      if (guideLine.id !== 'center-guideline-h' && guideLine.id !== 'center-guideline-v') {
        guideLine.set('visible', true)
      }
    })
    this._canvas.renderAll()
  }

  rulerDisable() {
    this.ruler?.disable()
    this.hideGuideline()
  }

  /**
   * 중앙 가이드라인 초기화 및 이벤트 설정
   */
  private initCenterGuidelines() {
    // 기존 가이드라인이 있다면 먼저 제거
    if (this.centerGuidelineH) {
      this._canvas.remove(this.centerGuidelineH)
      this.centerGuidelineH = null
    }
    if (this.centerGuidelineV) {
      this._canvas.remove(this.centerGuidelineV)
      this.centerGuidelineV = null
    }

    // 워크스페이스 찾기
    const workspace = this._getWorkspace()
    if (!workspace) return

    const center = workspace.getCenterPoint()

    // 워크스페이스 크기(미사용)
    /* const workspaceWidth = workspace.width * workspace.scaleX
    const workspaceHeight = workspace.height * workspace.scaleY */

    // GuideLine 사용: 범위값 계산 생략

    // 중앙 가이드라인을 기존 fabric.GuideLine으로 생성 (중복 구현 제거)
    this.centerGuidelineH = new (fabric as any).GuideLine(center.y, {
      id: 'center-guideline-h',
      axis: 'horizontal',
      selectable: false,
      visible: false,
      excludeFromExport: true,
      extensionType: 'guideline'
    }) as unknown as fabric.Line

    this.centerGuidelineV = new (fabric as any).GuideLine(center.x, {
      id: 'center-guideline-v',
      axis: 'vertical',
      selectable: false,
      visible: false,
      excludeFromExport: true,
      extensionType: 'guideline'
    }) as unknown as fabric.Line

    // 캔버스에 가이드라인 추가
    this._canvas.add(this.centerGuidelineH)
    this._canvas.add(this.centerGuidelineV)

    // 이벤트 핸들러 등록
    this._canvas.off('object:moving', this.boundHandleObjectMoving)
    this._canvas.off('mouse:up', this.boundHandleMouseUp)

    this._canvas.on('object:moving', this.boundHandleObjectMoving)
    this._canvas.on('mouse:up', this.boundHandleMouseUp)

    // 워크스페이스 크기 변경 이벤트 연결 (참조 저장)
    // 이전 리스너가 있으면 제거
    if (this.boundUpdateCenterGuidelines) {
      this._canvas.off('resize', this.boundUpdateCenterGuidelines)
      this._editor.off('sizeChange', this.boundUpdateCenterGuidelines)
    }
    this.boundUpdateCenterGuidelines = this.updateCenterGuidelines.bind(this)
    this._canvas.on('resize', this.boundUpdateCenterGuidelines)
    this._editor.on('sizeChange', this.boundUpdateCenterGuidelines)
  }

  /**
   * 오브젝트 이동 시 가이드라인 표시 처리
   */
  private handleObjectMoving(e: fabric.IEvent) {
    const obj = e.target
    if (!obj) return

    // 이미 진행 중인 드래그 표시
    this.isDragging = true

    // 워크스페이스나 가이드라인 자체는 무시
    if (
      obj.id === 'workspace' ||
      obj.type === 'GuideLine' ||
      obj.id === 'center-guideline-h' ||
      obj.id === 'center-guideline-v'
    ) {
      return
    }

    // 워크스페이스 찾기
    const workspace = this._getWorkspace()
    if (!workspace) return

    // §6-3: 중앙 스냅 OFF → 중앙 가이드 표시·스냅 모두 스킵(가이드↔동작 정합, 오펀 가이드 방지).
    // SmartGuidesPlugin.setCenterYieldEnabled 와 함께 토글되어 중앙 근처 무-스냅 데드존을 막는다.
    if (!this._centerSnapEnabled) {
      if (this.centerGuidelineH) this.centerGuidelineH.set('visible', false)
      if (this.centerGuidelineV) this.centerGuidelineV.set('visible', false)
      this._canvas.requestRenderAll()
      return
    }

    const center = workspace.getCenterPoint()
    const objCenter = obj.getCenterPoint()

    // 워크스페이스 경계 계산
    const workspaceWidth = workspace.width * workspace.scaleX
    const workspaceHeight = workspace.height * workspace.scaleY
    const wsLeft = center.x - workspaceWidth / 2
    const wsRight = center.x + workspaceWidth / 2
    const wsTop = center.y - workspaceHeight / 2
    const wsBottom = center.y + workspaceHeight / 2

    // 객체가 워크스페이스 안에 있는지 확인
    const isInWorkspace =
      objCenter.x >= wsLeft &&
      objCenter.x <= wsRight &&
      objCenter.y >= wsTop &&
      objCenter.y <= wsBottom
    // 워크스페이스 밖이면 가이드라인 숨기기
    if (!isInWorkspace) {
      if (this.centerGuidelineH) this.centerGuidelineH.set('visible', false)
      if (this.centerGuidelineV) this.centerGuidelineV.set('visible', false)
      this._canvas.requestRenderAll()
      return
    }

    // 중앙에 가까운지 체크할 범위
    const threshold = 15

    // 수평/수직 중앙과의 거리 계산
    const distanceH = Math.abs(objCenter.y - center.y)
    const distanceV = Math.abs(objCenter.x - center.x)

    // 수평 중앙 가이드라인 표시 여부
    if (this.centerGuidelineH) {
      if (distanceH < threshold) {
        this.centerGuidelineH.set('visible', true)
      } else {
        this.centerGuidelineH.set('visible', false)
      }
    }

    // 수직 중앙 가이드라인 표시 여부
    if (this.centerGuidelineV) {
      if (distanceV < threshold) {
        this.centerGuidelineV.set('visible', true)
      } else {
        this.centerGuidelineV.set('visible', false)
      }
    }

    // 모든 객체에 대해 중앙 스냅 적용 (축별 스냅)
    const snapThreshold = 8 // 스냅 임계값 (가이드 표시 임계값보다 약간 촘촘하게)

    const shouldSnapX = distanceV < snapThreshold
    const shouldSnapY = distanceH < snapThreshold

    if (shouldSnapX || shouldSnapY) {
      const targetX = shouldSnapX ? center.x : objCenter.x
      const targetY = shouldSnapY ? center.y : objCenter.y

      // 객체 중심을 기준으로 위치 설정 (origin 영향 제거)
      obj.setPositionByOrigin(new fabric.Point(targetX, targetY), 'center', 'center')
      obj.setCoords()
    }

    // 가이드라인이 보이는 상태면 캔버스 다시 그리기
    if (this.centerGuidelineH?.visible || this.centerGuidelineV?.visible) {
      // 가이드라인을 항상 최상위로
      if (this.centerGuidelineH) this.centerGuidelineH.bringToFront()
      if (this.centerGuidelineV) this.centerGuidelineV.bringToFront()
      this._canvas.requestRenderAll()
    }
  }

  /**
   * 마우스 업 이벤트 (드래그 종료) 처리
   */
  private handleMouseUp() {
    // 드래그가 진행 중이었을 때만 처리
    if (this.isDragging) {
      this.isDragging = false

      // 가이드라인 숨기기
      if (this.centerGuidelineH) this.centerGuidelineH.set('visible', false)
      if (this.centerGuidelineV) this.centerGuidelineV.set('visible', false)

      this._canvas.requestRenderAll()
    }
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((r) => {
      this.showGuideline()
      console.log('afterSave: ruler plugin')
      // 가이드라인 표시 후 캔버스 다시 렌더링
      this._canvas.requestRenderAll()
      r(...args)
    })
  }

  async afterLoad(): Promise<void> {
    this.showGuideline()
  }

  /**
   * 워크스페이스 크기 변경 시 가이드라인 위치 업데이트
   */
  private updateCenterGuidelines() {
    const workspace = this._getWorkspace()
    if (!workspace || !this.centerGuidelineH || !this.centerGuidelineV) return

    const center = workspace.getCenterPoint()

    // 워크스페이스 크기(미사용)
    /* const workspaceWidth = workspace.width * workspace.scaleX
    const workspaceHeight = workspace.height * workspace.scaleY */

    // GuideLine 사용: 범위값 계산 생략

    // 수평/수직 가이드라인 위치 업데이트 (GuideLine은 좌표값만 갱신)
    this.centerGuidelineH.set({ top: center.y })
    this.centerGuidelineV.set({ left: center.x })

    this._canvas.requestRenderAll()
  }
}

export default RulerPlugin