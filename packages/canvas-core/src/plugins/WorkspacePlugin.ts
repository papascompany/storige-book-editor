import { debounce } from 'lodash-es'
import Editor from '../Editor'
import { IEvent } from 'fabric/fabric-impl'
import { PluginBase, PluginOption } from '../plugin'
import { fabric } from 'fabric'
import { mmToPxDisplay } from '../utils/math'
import { CanvasSettings } from '../models'
import { extractSvgElementsAsObjects, convertFabricObjectToSVGString } from '../utils/svg'
import { connectWorkspacePlugin } from '../utils/history'

const _defaultZoomRatio = 0.8

type WorkspacePluginOptions = PluginOption & CanvasSettings

class WorkspacePlugin extends PluginBase {
  private static DEFAULT_OPTIONS = {
    width: 900,
    height: 1200
  }
  name = 'WorkspacePlugin'
  events = ['sizeChange', 'toggleCutBorder', 'toggleSafeBorder', 'objectOutOfTrim']
  hotkeys = []

  element: HTMLElement | undefined
  workspace: undefined | null | fabric.Object
  zoomRatio: number = _defaultZoomRatio

  private cutBorder: fabric.Path | null = null
  private safeSizeBorder: fabric.Path | null = null
  // P2: 재단선 코너 마커(crop marks) — 화면 전용 system 가이드, excludeFromExport
  private cropMarks: fabric.Group | null = null

  private _cutlineTemplate: fabric.Object | null = null

  // 이벤트 핸들러 참조 저장 (cleanup용)
  private _boundHandleObjectAdded: ((e: fabric.IEvent) => void) | null = null
  private _boundHandleObjectRemoved: ((e: fabric.IEvent) => void) | null = null
  private _boundHandleObjectModified: ((e: fabric.IEvent) => void) | null = null
  private _boundHandleObjectMoved: (() => void) | null = null
  // P2: object:moving (드래그/리사이즈 중) 재단선 이탈 라이브 감지
  private _boundHandleObjectMoving: ((e: fabric.IEvent) => void) | null = null
  private _boundEnsureTemplateBackgroundZOrder: (() => void) | null = null
  private _boundToggleCutBorder: ((value?: boolean) => void) | null = null
  private _boundToggleSafeBorder: ((value?: boolean) => void) | null = null
  private _boundRestoreGuideElements: (() => void) | null = null
  private _boundMouseWheel: ((opt: IEvent<WheelEvent>) => void) | null = null
  private _afterZoomDebounced: ReturnType<typeof debounce> | null = null
  // D2 핀치-투-줌 (2026-06-12): wrapperEl 포인터 이벤트 2지 추적
  private _boundPinchDown: ((e: PointerEvent) => void) | null = null
  private _boundPinchMove: ((e: PointerEvent) => void) | null = null
  private _boundPinchUp: ((e: PointerEvent) => void) | null = null
  private _pinchPointers: Map<number, { x: number; y: number }> = new Map()
  private _pinchState: {
    startDist: number
    startZoom: number
    lastMid: { x: number; y: number }
    prevSelection: boolean
    prevSkipTargetFind: boolean
  } | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: WorkspacePluginOptions) {
    super(canvas, editor, options)
    console.log('WorkspacePlugin created', options)
  }

  // 리소스 정리 메서드
  destroyed(): Promise<void> {
    // 캔버스 이벤트 리스너 제거
    if (this._boundHandleObjectAdded) {
      this._canvas.off('object:added', this._boundHandleObjectAdded)
    }
    if (this._boundHandleObjectRemoved) {
      this._canvas.off('object:removed', this._boundHandleObjectRemoved)
    }
    if (this._boundHandleObjectModified) {
      this._canvas.off('object:modified', this._boundHandleObjectModified)
    }
    if (this._boundHandleObjectMoved) {
      this._canvas.off('object:moved', this._boundHandleObjectMoved)
    }
    if (this._boundHandleObjectMoving) {
      this._canvas.off('object:moving', this._boundHandleObjectMoving)
      this._canvas.off('object:scaling', this._boundHandleObjectMoving)
    }
    if (this._boundEnsureTemplateBackgroundZOrder) {
      this._canvas.off('object:added', this._boundEnsureTemplateBackgroundZOrder)
      this._canvas.off('object:removed', this._boundEnsureTemplateBackgroundZOrder)
      this._canvas.off('object:modified', this._boundEnsureTemplateBackgroundZOrder)
    }
    if (this._boundMouseWheel) {
      this._canvas.off('mouse:wheel', this._boundMouseWheel)
    }

    // D2 핀치 리스너 제거 (wrapperEl 네이티브 이벤트)
    const wrapperEl = (this._canvas as unknown as { wrapperEl?: HTMLElement }).wrapperEl
    if (wrapperEl) {
      if (this._boundPinchDown) wrapperEl.removeEventListener('pointerdown', this._boundPinchDown)
      if (this._boundPinchMove) wrapperEl.removeEventListener('pointermove', this._boundPinchMove)
      if (this._boundPinchUp) {
        wrapperEl.removeEventListener('pointerup', this._boundPinchUp)
        wrapperEl.removeEventListener('pointercancel', this._boundPinchUp)
      }
    }
    this._boundPinchDown = null
    this._boundPinchMove = null
    this._boundPinchUp = null
    this._pinchPointers.clear()
    this._pinchState = null

    // 에디터 이벤트 리스너 제거
    if (this._boundToggleCutBorder) {
      this._editor.off('toggleCutBorder', this._boundToggleCutBorder)
    }
    if (this._boundToggleSafeBorder) {
      this._editor.off('toggleSafeBorder', this._boundToggleSafeBorder)
    }
    if (this._boundRestoreGuideElements) {
      this._editor.off('restoreGuideElements', this._boundRestoreGuideElements)
    }

    // debounce 함수 취소
    if (this._afterZoomDebounced) {
      this._afterZoomDebounced.cancel()
      this._afterZoomDebounced = null
    }

    // 참조 정리
    this._boundHandleObjectAdded = null
    this._boundHandleObjectRemoved = null
    this._boundHandleObjectModified = null
    this._boundHandleObjectMoved = null
    this._boundHandleObjectMoving = null
    this._boundEnsureTemplateBackgroundZOrder = null
    this._boundToggleCutBorder = null
    this._boundToggleSafeBorder = null
    this._boundRestoreGuideElements = null
    this._boundMouseWheel = null

    return Promise.resolve()
  }

  init(workspace?: fabric.Object) {
    // 캔버스 유효성 검사
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized or has been disposed in init')
      return
    }

    this._options.size.width ??= WorkspacePlugin.DEFAULT_OPTIONS?.width
    this._options.size.height ??= WorkspacePlugin.DEFAULT_OPTIONS?.height

    this.element = document.querySelector('#workspace') as HTMLElement
    if (!this.element) {
      console.error('cannot find element #workspace')
      return
    } else {
      this.reset(workspace)
      this.bindWheel()
      this.bindPinch()

      // 이벤트 핸들러 참조 저장 (cleanup을 위해)
      this._boundHandleObjectAdded = this.handleObjectAdded.bind(this)
      this._boundHandleObjectRemoved = this.handleObjectRemoved.bind(this)
      this._boundHandleObjectModified = this.handleObjectModified.bind(this)
      this._boundHandleObjectMoved = this.bringBordersToFront.bind(this)
      this._boundHandleObjectMoving = this.handleObjectMoving.bind(this)
      this._boundEnsureTemplateBackgroundZOrder = this.ensureTemplateBackgroundZOrder.bind(this)
      this._boundToggleCutBorder = this.toggleCutBorder.bind(this)
      this._boundToggleSafeBorder = this.toggleSafeBorder.bind(this)
      this._boundRestoreGuideElements = this.restoreGuideElements.bind(this)

      this._canvas.on('object:added', this._boundHandleObjectAdded)
      this._canvas.on('object:removed', this._boundHandleObjectRemoved)

      // 통합된 이벤트 핸들러 등록
      this._canvas.on('object:modified', this._boundHandleObjectModified)
      this._canvas.on('object:moved', this._boundHandleObjectMoved)
      // P2: 드래그/리사이즈 중 재단선 이탈 라이브 감지
      this._canvas.on('object:moving', this._boundHandleObjectMoving)
      this._canvas.on('object:scaling', this._boundHandleObjectMoving)

      // 템플릿 배경의 Z-순서 보장
      this._canvas.on('object:added', this._boundEnsureTemplateBackgroundZOrder)
      this._canvas.on('object:removed', this._boundEnsureTemplateBackgroundZOrder)
      this._canvas.on('object:modified', this._boundEnsureTemplateBackgroundZOrder)

      // 이벤트 구독
      this._editor.on('toggleCutBorder', this._boundToggleCutBorder)
      this._editor.on('toggleSafeBorder', this._boundToggleSafeBorder)
      this._editor.on('restoreGuideElements', this._boundRestoreGuideElements)

      // 히스토리 시스템과 연결
      this.setupHistoryConnection()
    }
  }

  // 경계선 토글 메서드
  toggleSafeBorder(value?: boolean) {
    // 전달된 값이 있으면 옵션에 반영
    if (typeof value === 'boolean') {
      this._options.showSafeBorder = value
    }
    console.log('toggleSafeBorder', this._options.showSafeBorder)

    // 기존 객체가 있으면 가시성만 변경, 없으면 생성
    if (this.safeSizeBorder) {
      this.safeSizeBorder.visible = Boolean(this._options.showSafeBorder)
      this.safeSizeBorder.dirty = true
      this._canvas.requestRenderAll()
      this.bringBordersToFront()
    } else {
      this.createOrUpdateSafeSize()
    }
  }

  toggleCutBorder(value?: boolean) {
    // 전달된 값이 있으면 옵션에 반영
    if (typeof value === 'boolean') {
      this._options.showCutBorder = value
    }
    console.log('toggleCutBorder', this._options.showCutBorder)

    // 기존 객체가 있으면 가시성만 변경, 없으면 생성
    if (this.cutBorder) {
      this.cutBorder.visible = Boolean(this._options.showCutBorder)
      this.cutBorder.dirty = true
      // P2: crop marks 도 cutBorder 가시성을 따른다
      if (this.cropMarks) {
        this.cropMarks.visible = Boolean(this._options.showCutBorder)
        this.cropMarks.dirty = true
      }
      this._canvas.requestRenderAll()
      this.bringBordersToFront()
    } else {
      this.createOrUpdateCutBorder()
    }
  }

  // WorkspacePlugin.ts에서 모든 주요 메서드에 방어 코드 추가

  // 경계선을 항상 최상위로 가져오는 메서드
  bringBordersToFront() {
    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized')
      return
    }

    // cut border 있으면 최상위로 가져오기
    if (this.cutBorder) {
      this.cutBorder.bringToFront()
    }

    // safe border 있으면 최상위로 가져오기
    if (this.safeSizeBorder) {
      this.safeSizeBorder.bringToFront()
    }

    // P2: crop marks(재단 코너 마커) 도 최상위로 (화면 전용 가이드)
    if (this.cropMarks) {
      this.cropMarks.bringToFront()
    }

    this._canvas.requestRenderAll()
  }

  // template-background의 Z-순서를 workspace 위, 나머지 아래로 유지
  private ensureTemplateBackgroundZOrder() {
    if (!this._canvas || !this._canvas.getContext()) return

    const workspace = this._getWorkspace() as fabric.Object | null
    const templateBg = this._canvas.getObjects().find((o) => o.id === 'template-background')
    const mockup = this._canvas.getObjects().find((o) => o.id === 'template-mockup')
    const pageOutline = this._canvas.getObjects().find((o) => o.id === 'page-outline')

    if (!templateBg || !workspace) return

    if (this._options.renderType === 'noBounded' && !this._options.editMode) {
      templateBg.set({
        editable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        selectable: false,
        lockMovementY: true
      })
    }
    if (this._options.renderType === 'noBounded' && !!pageOutline) {
      pageOutline.set({
        editable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        selectable: false,
        lockMovementY: true
      })
    }
    if (mockup) {
      mockup.set({
        editable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        selectable: false,
        lockMovementY: true
      })
    }
    // workspace 바로 위 인덱스로 이동
    const workspaceIndex = this._canvas.getObjects().indexOf(workspace)
    const desiredIndex = Math.max(0, workspaceIndex + 1)

    const currentIndex = this._canvas.getObjects().indexOf(templateBg)
    if (currentIndex !== desiredIndex) {
      // 먼저 앞으로 가져온 후 정확한 인덱스로 재배치
      ; (templateBg as any).moveTo(desiredIndex)
    }

    // printguide(경계선)과의 순서를 보장: 경계선들은 항상 더 위에 위치
    this.bringBordersToFront()
  }

  setCenterPointOf(obj: fabric.Object) {
    // 객체 유효성 검사
    if (!obj || !this._canvas || !this._canvas.viewportTransform) {
      console.warn('Invalid object or canvas state for centering')
      return
    }

    try {
      const objCenter = obj.getCenterPoint()
      const viewportTransform = this._canvas.viewportTransform

      if (!this._canvas.width || !this._canvas.height) {
        console.warn('Canvas dimensions not set')
        return
      }

      viewportTransform[4] = this._canvas.width / 2 - objCenter.x * viewportTransform[0]
      viewportTransform[5] = this._canvas.height / 2 - objCenter.y * viewportTransform[3]
      this._canvas.setViewportTransform(viewportTransform)
      this._canvas.requestRenderAll() // renderAll() 대신 requestRenderAll() 사용
    } catch (e) {
      console.error('Error in setCenterPointOf:', e)
    }
  }

  setZoomAuto(scale?: number) {
    try {
      // 캔버스 유효성 검사 - contextTop이 없으면 setWidth/setHeight에서 오류 발생
      if (!this._canvas || !this._canvas.getContext()) {
        console.warn('Canvas not initialized or has been disposed')
        return
      }

      // canvas-wrapper 요소 찾기
      const canvasWrapper = document.querySelector('#canvas-wrapper') as HTMLElement
      if (!canvasWrapper) {
        console.warn('Canvas wrapper element not found')
        return
      }

      // canvas-wrapper의 실제 크기와 위치 가져오기
      const wrapperRect = canvasWrapper.getBoundingClientRect()
      const wrapperWidth = wrapperRect.width
      const wrapperHeight = wrapperRect.height

      // 캔버스 크기를 wrapper 크기로 설정
      this._canvas.setWidth(wrapperWidth)
      this._canvas.setHeight(wrapperHeight)

      // 워크스페이스 객체 가져오기
      this.workspace = this._getWorkspace() as fabric.Object | null

      if (!this.workspace) {
        console.warn('Workspace object not found')
        return
      }

      // 워크스페이스 속성 확인
      const workspaceWidth = this.workspace.width! * this.workspace.scaleX!
      const workspaceHeight = this.workspace.height! * this.workspace.scaleY!

      if (workspaceWidth <= 0 || workspaceHeight <= 0) {
        console.warn('Invalid workspace dimensions:', workspaceWidth, workspaceHeight)
        return
      }

      // 뷰포트 초기화
      this._canvas.setViewportTransform(fabric.iMatrix.concat())

      // 적절한 스케일 계산 - 약간 더 작게 조정하여 여백 확보
      const adaptedScale = this.getScale() * (scale ?? this.zoomRatio) * 0.98

      // wrapper의 중앙 좌표 계산
      const wrapperCenterX = wrapperWidth / 2
      const wrapperCenterY = wrapperHeight / 2

      // 워크스페이스의 중심 위치 가져오기
      this.workspace.setCoords()
      const workspaceCenter = this.workspace.getCenterPoint()

      // 중앙 정렬을 위한 오프셋 계산
      const deltaX = wrapperCenterX - workspaceCenter.x * adaptedScale
      const deltaY = wrapperCenterY - workspaceCenter.y * adaptedScale

      // 줌 적용 - wrapper 중앙을 기준으로
      this._canvas.zoomToPoint(new fabric.Point(wrapperCenterX, wrapperCenterY), adaptedScale)

      // 뷰포트 변환 행렬 직접 업데이트하여 중앙 정렬
      if (this._canvas.viewportTransform) {
        this._canvas.viewportTransform[4] = deltaX
        this._canvas.viewportTransform[5] = deltaY
        this._canvas.setViewportTransform(this._canvas.viewportTransform)
      }

      // 위치와 크기 재계산을 위해 모든 객체의 좌표 업데이트
      this._canvas.forEachObject((obj) => {
        obj.setCoords()
      })

      // 캔버스 다시 그리기
      this._canvas.requestRenderAll()

      console.log('Workspace centered at:', this.workspace.getCenterPoint())
      console.log('Wrapper center:', { x: wrapperCenterX, y: wrapperCenterY })
    } catch (e) {
      console.error('Error in setZoomAuto:', e)
    }
  }

  // setOptions 메서드에도 비동기 처리 추가
  setOptions(options: Partial<WorkspacePluginOptions>) {
    console.log('setOptions', options)
    const sizeChanged =
      options.size &&
      (options.size.width !== this._options.size.width ||
        options.size.height !== this._options.size.height)

    const editModeChanged =
      options.editMode !== undefined && options.editMode !== this._options.editMode

    const showCutChanged =
      options.showCutBorder !== undefined && options.showCutBorder !== this._options.showCutBorder
    const showSafeChanged =
      options.showSafeBorder !== undefined && options.showSafeBorder !== this._options.showSafeBorder

    this._options = {
      ...this._options,
      ...options
    }

    console.log('setOptions - size changed', sizeChanged)

    // editMode가 변경된 경우 page-outline 권한 업데이트
    if (editModeChanged) {
      this.updatepageOutline()
    }

    if (sizeChanged) {
      const canvasWidth = this._options.size.width + this._options.size.cutSize
      const effectiveWidth = this._options.unit === 'mm' ? mmToPxDisplay(canvasWidth) : canvasWidth
      const canvasHeight = this._options.size.height + this._options.size.cutSize
      const effectiveHeight =
        this._options.unit === 'mm' ? mmToPxDisplay(canvasHeight) : canvasHeight

      console.log('setOptions - 새 크기:', effectiveWidth, effectiveHeight)

      // 객체 크기가 유효한지 확인
      if (effectiveWidth <= 0 || effectiveHeight <= 0) {
        console.error('Invalid workspace dimensions:', effectiveWidth, effectiveHeight)
        return
      }

      const workspace = this._getWorkspace() as fabric.Object | null

      if (!workspace) {
        console.error('Workspace object not found')
        return
      }

      console.log('workspace before setOptions', workspace)
      const templateBackground = this._canvas
        .getObjects()
        .find((obj: fabric.Object) => obj.id === 'template-background')

      // workspace에 맞춰 크기변경 - workspace와 동일한 크기로 설정
      if (templateBackground) {
        const renderType = (this._options as any)?.renderType || (this._canvas as any)?.renderType
        const isNoBounded = renderType === 'noBounded'
        if (!isNoBounded) {
          templateBackground.set({
            scaleX: effectiveWidth / templateBackground.width!,
            scaleY: effectiveHeight / templateBackground.height!
          })
        } else {
          ; (templateBackground as any).preventAutoResize = true
        }
      }

      if (this._canvas.clipPath && templateBackground && templateBackground.type !== 'group' && templateBackground.type !== 'image' && this._options.renderType !== 'mockup') {
        this._canvas.clipPath = templateBackground
      }
      
      // 봉투 타입의 경우 template-background를 clipPath로 설정
      if (this._options.renderType === 'envelope' && templateBackground) {
        this._canvas.clipPath = templateBackground
      }

      this.workspace = workspace

      // 크기 변경을 비동기적으로 처리
      setTimeout(() => {
        this.workspace.set({
          width: effectiveWidth,
          height: effectiveHeight,
          scaleX: 1,
          scaleY: 1,
          dirty: true
        })

        this.workspace.setCoords()
        this._canvas.requestRenderAll()

        // 다른 요소 업데이트
        this.createOrUpdateCutBorder()
        this.createOrUpdateSafeSize()
        this.setZoomAuto()
      }, 0)
    }

    // 가이드 가시성 변경이 있는 경우 즉시 반영
    if (showCutChanged) {
      if (this.cutBorder) {
        this.cutBorder.visible = Boolean(this._options.showCutBorder)
        this.cutBorder.dirty = true
        // P2: crop marks 도 cutBorder 가시성을 따른다
        if (this.cropMarks) {
          this.cropMarks.visible = Boolean(this._options.showCutBorder)
          this.cropMarks.dirty = true
        }
        this._canvas.requestRenderAll()
        this.bringBordersToFront()
      } else if (this._options.showCutBorder) {
        this.createOrUpdateCutBorder()
      }
    }

    if (showSafeChanged) {
      if (this.safeSizeBorder) {
        this.safeSizeBorder.visible = Boolean(this._options.showSafeBorder)
        this.safeSizeBorder.dirty = true
        this._canvas.requestRenderAll()
        this.bringBordersToFront()
      } else if (this._options.showSafeBorder) {
        this.createOrUpdateSafeSize()
      }
    }
  }

  getScale() {
    const workspace = this._getWorkspace()
    const element = document.querySelector('#workspace') as HTMLElement

    if (!workspace || workspace.width === 0 || workspace.height === 0 || !element) return 1

    const width = this._options.offsetWidth || element.offsetWidth
    const height = this._options.offsetHeight || element.offsetHeight

    return fabric.util.findScaleToFit(workspace, {
      width: width,
      height: height
    })
  }

  afterLoad(...args: any[]): Promise<void> {
    return new Promise((r) => {
      let workspace = this._getWorkspace()

      // 로드된 canvasData 에 workspace 객체가 없는 경우(= IDML/PSD 변환 템플릿: 변환기는 디자인
      //   객체만 내보내고 흰 판형 rect 를 넣지 않음) afterLoad 가 통째로 스킵돼 흰 판형 배경·clipPath·
      //   setZoomAuto(줌 핏)·재단선이 전부 누락된다. 이때 init→reset 단계에서 _options.size 로 이미
      //   만들어 둔 this.workspace 를 z-최하단에 복원해 일반 템플릿과 동일한 로드 후처리를 태운다.
      //   (일반 템플릿은 canvasData 에 workspace 가 포함되므로 이 분기를 타지 않음 — 무영향.)
      if (
        !workspace &&
        this.workspace &&
        this._options.renderType !== 'noBounded' &&
        this._options.renderType !== 'mockup'
      ) {
        this._canvas.add(this.workspace)
        ; (this.workspace as any).moveTo(0)
        workspace = this._getWorkspace()
      }

      if (workspace) {
        workspace.set('selectable', false)
        workspace.set('hasControls', false)

        console.log('workspace after load', workspace)

        // 로드된 워크스페이스를 this.workspace에 할당하고 clipPath 업데이트
        this.workspace = workspace

        const templateBackground = this._canvas.getObjects().find((obj) => obj.id === 'template-background')
        if (templateBackground && templateBackground.preventAutoResize && this._options.renderType !== 'mockup') {
          // 봉투 타입의 경우 template-background를 clipPath로 유지
          if (this._options.renderType === 'envelope') {
            this._canvas.clipPath = templateBackground
          } else {
            this._canvas.clipPath = null
          }
        } else if (this._options.renderType !== 'noBounded' && this._options.renderType !== 'mockup') {
          // 일반 모드에서는 로드된 workspace를 clipPath로 설정
          this._canvas.clipPath = workspace
          console.log('[WorkspacePlugin] Updated clipPath to loaded workspace:', {
            width: workspace.width,
            height: workspace.height,
            scaleX: workspace.scaleX,
            scaleY: workspace.scaleY
          })
        }

        this.createOrUpdateCutBorder()
        this.createOrUpdateSafeSize()

        // page-outline 권한 관리
        this.updatepageOutline()

        // 모든 객체를 선택후 선택해제
        const objects = this._canvas.getObjects()
        this._canvas.setActiveObject(new fabric.ActiveSelection(objects, { canvas: this._canvas }))

        this._canvas.discardActiveObject()
        this._canvas.requestRenderAll()

        // 경계선들을 최상위로 가져오기
        this.bringBordersToFront()
        this.setCutlineTemplate()
        this.setZoomAuto()
      }
      r(...args)
    })
  }

  beforeSave(...args): Promise<void> {
    return new Promise((r) => {
      console.log('beforeSave : workspace')
      this._cutlineTemplate = this._canvas.getObjects().find((obj) => obj.id === 'cutline-template')
      
      const pageOutline = this._canvas.getObjects().find((obj) => obj.id === 'page-outline')
      if (pageOutline) {
        pageOutline.set({
          stroke: 'transparent'
        })
      }
      r(...args)
    })
  }

  afterSave(...args: any[]): Promise<void> {
    return new Promise((r) => {
      const workspace = this._getWorkspace()
      if (workspace) {
        console.log('workspace after save', workspace)
        this.createOrUpdateCutBorder()
        this.createOrUpdateSafeSize()

        // page-outline 권한 관리
        this.updatepageOutline()

        const pageOutline = this._canvas.getObjects().find((obj) => obj.id === 'page-outline')
        if (pageOutline) {
          pageOutline.set({
            stroke: '#ff6b6b'
          })
        }

        // 경계선들을 최상위로 가져오기
        this.bringBordersToFront()
        this.setCutlineTemplate()

        // 캔버스 다시 렌더링
        this._canvas.requestRenderAll()
      }
      r(...args)
    })
  }

  private setCutlineTemplate() {
    const prev = this._canvas.getObjects().find((obj) => obj.id === 'cutline-template')
    console.log('setCutlineTemplate', prev)
    this._cutlineTemplate = prev || this._cutlineTemplate
    if (this._cutlineTemplate) {
      const isEnvelope = this._options.renderType === 'envelope'
      
      this._cutlineTemplate.clipPath = null
      this._cutlineTemplate.set({
        originX: 'center',
        originY: 'center',
        left: 0,
        top: 0,
        fill: null,
        selectable: false,
        evented: false,
        hasControls: false,
        lockMovementX: true,
        lockMovementY: true,
        excludeFromExport: true,
        extensionType: 'printguide',
        editable: false,
        visible: !isEnvelope  // 봉투 타입인 경우 숨김
      })

      if (!prev) {
        console.log('add cutline-template', this._cutlineTemplate)
        this._canvas.add(this._cutlineTemplate)
      }
    }
  }

  // 통합된 object:modified 이벤트 핸들러
  private handleObjectModified(e: fabric.IEvent) {
    const obj = e.target
    if (!obj) return

    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in handleObjectModified')
      return
    }

    // page-outline이 수정된 경우, 관련된 클립패스 업데이트
    if (obj.id === 'page-outline') {
      this.updateAllClipPathsFromOutline()
    }

    // outlines 표시 여부 처리
    this.showHiddenOutlines(obj)

    // 경계선 최상위로 가져오기
    this.bringBordersToFront()

    // P2: 재단선(trim) 이탈 검사 — 이동/리사이즈 확정 시점
    this.checkObjectsOutOfTrim()

    // 기타 로직 처리
    this._editor.emit('object:modified', obj)
  }

  // P2: object:moving / object:scaling (드래그/리사이즈 중) 라이브 이탈 감지
  private handleObjectMoving(_e: fabric.IEvent) {
    if (!this._canvas || !this._canvas.getContext()) return
    this.checkObjectsOutOfTrim()
  }

  /**
   * P2: 사용자 객체가 재단선(trim) 사각형을 벗어났는지 검사하고
   * `objectOutOfTrim` { count, objects } 이벤트를 발행한다 (화면 경고용).
   *
   * - 좌표계: workspace 중앙원점(scene). trim 사각형 = workspace 중심 ± trim 반폭.
   *   trim 반폭 = mmToPxDisplay(size.width)/2 (px 단위는 size.width/2). 높이도 동일.
   *   (재단선은 workspace 보다 각 변 cutSize/2 안쪽 = size.width/size.height 폭.)
   * - 비교: 각 객체 getBoundingRect(true, true) (aCoords = scene absolute) 사용.
   * - 제외: system 객체(meta.system), workspace/template-background/page-outline/
   *   cutline-template/template-mockup/crop-marks, printguide/outline/overlay extensionType,
   *   excludeFromExport 객체. (배경은 의도적으로 블리드까지 나가므로 제외.)
   * - 출력/저장 경로는 전혀 건드리지 않음 — 순수 화면 경고.
   */
  private checkObjectsOutOfTrim(): void {
    if (!this._canvas || !this._canvas.getContext()) return

    const workspace = this._getWorkspace() as fabric.Object | null
    if (!workspace) return
    if (workspace.extensionType === 'clipping') return

    const sizeWidth = this._options.size?.width
    const sizeHeight = this._options.size?.height
    if (!sizeWidth || !sizeHeight) return

    // trim 폭/높이 (화면 픽셀)
    let trimW: number
    let trimH: number
    if (this._options.unit === 'mm') {
      trimW = mmToPxDisplay(sizeWidth)
      trimH = mmToPxDisplay(sizeHeight)
    } else {
      trimW = sizeWidth
      trimH = sizeHeight
    }

    const center = workspace.getCenterPoint()
    const minX = center.x - trimW / 2
    const maxX = center.x + trimW / 2
    const minY = center.y - trimH / 2
    const maxY = center.y + trimH / 2

    // 시스템/가이드 객체로 간주해 제외할 id / extensionType
    const excludedIds = new Set([
      'workspace',
      'template-background',
      'template-mockup',
      'page-outline',
      'cutline-template',
      'crop-marks',
      'cut-border',
      'safe-zone-border'
    ])
    const excludedExtTypes = new Set(['printguide', 'outline', 'overlay', 'template-element'])

    const outOfTrim: fabric.Object[] = []
    for (const obj of this._canvas.getObjects()) {
      if (!obj) continue
      if ((obj as any).meta?.system) continue
      if (obj.excludeFromExport) continue
      if (obj.id && excludedIds.has(obj.id)) continue
      if (obj.extensionType && excludedExtTypes.has(obj.extensionType)) continue

      // scene(absolute) 좌표 바운딩 — 줌/팬 무관 정합
      const br = obj.getBoundingRect(true, true)
      // 약간의 부동소수 여유(0.5px) — 정확히 경계에 붙은 경우 오판정 방지
      const eps = 0.5
      const overflowLeft = br.left < minX - eps
      const overflowRight = br.left + br.width > maxX + eps
      const overflowTop = br.top < minY - eps
      const overflowBottom = br.top + br.height > maxY + eps

      if (overflowLeft || overflowRight || overflowTop || overflowBottom) {
        outOfTrim.push(obj)
      }
    }

    if (outOfTrim.length > 0) {
      this._editor.emit('objectOutOfTrim', {
        count: outOfTrim.length,
        objects: outOfTrim
      })
    }
  }

  // page-outline 기반의 모든 클립패스 업데이트
  private updateAllClipPathsFromOutline() {
    console.log('updateAllClipPathsFromOutline')
    this._canvas.getObjects().forEach((obj) => {
      // clipPath가 page-outline-clip인 경우에만 재지정
      if (obj.id === 'template-background') return
      if (
        obj.id !== 'page-outline' &&
        obj.extensionType !== 'template-element' &&
        obj.extensionType !== 'outline' &&
        obj.extensionType !== 'printguide' &&
        obj.clipPath &&
        obj.clipPath.id === 'page-outline-clip'
      ) {
        this.applyPageOutlineClipPath(obj)
      }
    })
  }

  // 숨겨진 아웃라인을 표시하는 함수
  private showHiddenOutlines(obj: fabric.Object) {
    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in showHiddenOutlines')
      return
    }

    const outlineId = `${obj.id}_outline`
    const outlineObj = this._canvas.getObjects().find((item) => item.id === outlineId)

    if (outlineObj && outlineObj.visible === false) {
      outlineObj.visible = true
      this._canvas.requestRenderAll()
    }
  }

  private reset(workspace?: fabric.Object) {
    // 캔버스 유효성 검사 - contextTop/contextContainer가 없으면 캔버스가 dispose된 상태
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized or has been disposed in reset')
      return
    }

    // reset
    this.workspace = workspace
    if (!this.workspace) {
      const canvasWidth = this._options.size.width + this._options.size.cutSize
      const canvasHeight = this._options.size.height + this._options.size.cutSize

      // 에디터 내부에서는 DPI를 고려하지 않고 픽셀 기준으로 작업
      // mm 단위인 경우 화면 표시용 변환만 수행
      const effectiveWidth = this._options.unit === 'mm' ? mmToPxDisplay(canvasWidth) : canvasWidth
      const effectiveHeight =
        this._options.unit === 'mm' ? mmToPxDisplay(canvasHeight) : canvasHeight

      console.log('reset', canvasWidth, canvasHeight, 'effective:', effectiveWidth, effectiveHeight)

      this.workspace = new fabric.Rect({
        id: 'workspace',
        //type: 'Workspace',
        width: effectiveWidth,
        height: effectiveHeight,
        top: 0,
        left: 0,
        originX: 'center',
        originY: 'center',
        lockMovementX: true,
        lockMovementY: true,
        selectable: false,
        hasControls: false,
        hasBorders: false,
        moveCursor: 'default',
        hoverCursor: 'default',
        scaleX: 1,
        scaleY: 1,
        fill: '#fff'
      }) as fabric.Object
    }

    if (this._options.renderType !== 'noBounded' && this._options.renderType !== 'mockup') {
      this._canvas.clipPath = this.workspace
    }
    this.zoomRatio = _defaultZoomRatio

    this._canvas.discardActiveObject()

    this._canvas.getObjects().forEach((obj: fabric.Object) => {
      if (obj.id !== 'workspace') {
        this._canvas.remove(obj)
      }
    })

    // size
    if (this.element) {
      try {
        // 읽기 전용 속성 문제를 해결하기 위해 try-catch 사용
        this._options.offsetWidth = this.element.offsetWidth
        this._options.offsetHeight = this.element.offsetHeight
      } catch (error) {
        // 읽기 전용 속성인 경우 새로운 객체를 생성하여 할당
        this._options = {
          ...this._options,
          offsetWidth: this.element.offsetWidth,
          offsetHeight: this.element.offsetHeight
        }
      }

      this._canvas.setWidth(this._options.offsetWidth)
      this._canvas.setHeight(this._options.offsetHeight)
    }

    // add workspace
    this._canvas.add(this.workspace!)

    // 히스토리 연결 설정 (워크스페이스 추가 후)
    this.setupHistoryConnection()

    this._canvas.clearHistory()

    this._canvas.renderAll()
    this.createOrUpdateCutBorder()
    this.createOrUpdateSafeSize()
    this.setZoomAuto()
  }

  private bindWheel() {
    const vm = this
    let isZooming = false

    // 외부에서 debounce된 함수 생성 - 매번 새로 생성하지 않음
    this._afterZoomDebounced = debounce(() => {
      isZooming = false
      // 캔버스 유효성 검사
      if (!vm._canvas || !vm._canvas.getContext()) {
        console.warn('Canvas context is not available during afterZoom')
        return
      }

      // clipPath 복원
      try {
        const objects = vm._canvas.getObjects()
        if (objects && Array.isArray(objects)) {
          objects.forEach((obj) => {
            if (obj && obj.extensionType === 'overlay') {
              obj.visible = true
            }
          })
        }
        // renderAll 대신 requestRenderAll 사용 (더 안전함)
        vm._canvas.requestRenderAll()
      } catch (error) {
        console.error('Error in afterZoom:', error)
      }
    }, 300)

    // mouse:wheel 핸들러 참조 저장
    this._boundMouseWheel = function (this: fabric.Canvas, opt: IEvent<WheelEvent>) {
      // 줌 시작 시 clipPath 일시 제거
      if (!isZooming) {
        isZooming = true
        // clipPath 임시 저장 및 제거
        vm._canvas.getObjects().forEach((obj) => {
          if (obj.extensionType === 'overlay') {
            obj.visible = false
          }
        })
      }

      const delta = opt.e.deltaY
      let zoom = this.getZoom()
      zoom *= 0.999 ** delta
      if (zoom > 20) zoom = 20
      if (zoom < 0.01) zoom = 0.01
      const center = this.getCenter()
      this.zoomToPoint(new fabric.Point(center.left, center.top), zoom)
      vm._editor.emit('zoomChanged')
      opt.e.preventDefault()
      opt.e.stopPropagation()

      // 캔버스 유효성 검사 후 렌더링
      if (vm._canvas && vm._canvas.getContext()) {
        vm._canvas.requestRenderAll()
      }

      vm._afterZoomDebounced!()
    }

    this._canvas.on('mouse:wheel', this._boundMouseWheel)
  }

  /**
   * D2 핀치-투-줌 (2026-06-12, EDITOR.md §20.2).
   *
   * fabric 5는 빌드 옵션 없이 `touch:gesture` 를 발화하지 않으므로 wrapperEl 에
   * 네이티브 pointer 이벤트로 2지(터치)를 직접 추적한다.
   * - 두 손가락 거리 비율 → zoomToPoint(중점 기준), 중점 이동량 → relativePan
   * - 핀치 중에는 fabric 객체 조작 차단: 진행 중 transform 중단 + skipTargetFind
   * - 캔버스 컨테이너는 이미 touch-action:none (index.css) → 브라우저 제스처 충돌 없음
   * - 줌 한계는 휠 줌과 동일 (0.01 ~ 20)
   */
  private bindPinch() {
    const wrapper = (this._canvas as unknown as { wrapperEl?: HTMLElement }).wrapperEl
    if (!wrapper || typeof window === 'undefined' || !window.PointerEvent) return
    const vm = this

    const midAndDist = () => {
      const pts = Array.from(vm._pinchPointers.values())
      const dx = pts[0].x - pts[1].x
      const dy = pts[0].y - pts[1].y
      return {
        dist: Math.hypot(dx, dy),
        mid: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
      }
    }

    this._boundPinchDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      vm._pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (vm._pinchPointers.size !== 2 || vm._pinchState) return

      // 핀치 시작 — 첫 손가락으로 시작된 fabric 변형(드래그/스케일) 즉시 중단
      const canvasAny = vm._canvas as unknown as { _currentTransform?: unknown }
      if (canvasAny._currentTransform) canvasAny._currentTransform = undefined
      vm._canvas.discardActiveObject()

      const { dist, mid } = midAndDist()
      vm._pinchState = {
        startDist: dist,
        startZoom: vm._canvas.getZoom(),
        lastMid: mid,
        prevSelection: vm._canvas.selection !== false,
        prevSkipTargetFind: vm._canvas.skipTargetFind === true,
      }
      vm._canvas.selection = false
      vm._canvas.skipTargetFind = true

      // 휠 줌과 동일하게 overlay 일시 숨김 (줌 중 clipPath 렌더 부하 회피)
      vm._canvas.getObjects().forEach((obj) => {
        if (obj.extensionType === 'overlay') obj.visible = false
      })
      vm._canvas.requestRenderAll()
    }

    this._boundPinchMove = (e: PointerEvent) => {
      if (!vm._pinchPointers.has(e.pointerId)) return
      vm._pinchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (vm._pinchPointers.size !== 2 || !vm._pinchState) return
      if (vm._pinchState.startDist <= 0) return
      e.preventDefault()

      const { dist, mid } = midAndDist()
      let zoom = vm._pinchState.startZoom * (dist / vm._pinchState.startDist)
      if (zoom > 20) zoom = 20
      if (zoom < 0.01) zoom = 0.01

      const rect = wrapper.getBoundingClientRect()
      vm._canvas.zoomToPoint(new fabric.Point(mid.x - rect.left, mid.y - rect.top), zoom)

      // 두 손가락 팬 — 중점 이동량만큼 viewport 이동
      const dxm = mid.x - vm._pinchState.lastMid.x
      const dym = mid.y - vm._pinchState.lastMid.y
      if (dxm !== 0 || dym !== 0) {
        vm._canvas.relativePan(new fabric.Point(dxm, dym))
      }
      vm._pinchState.lastMid = mid

      vm._editor.emit('zoomChanged')
      if (vm._canvas.getContext()) {
        vm._canvas.requestRenderAll()
      }
      vm._afterZoomDebounced?.()
    }

    this._boundPinchUp = (e: PointerEvent) => {
      if (!vm._pinchPointers.delete(e.pointerId)) return
      if (vm._pinchPointers.size < 2 && vm._pinchState) {
        vm._canvas.selection = vm._pinchState.prevSelection
        vm._canvas.skipTargetFind = vm._pinchState.prevSkipTargetFind
        vm._pinchState = null
        vm._canvas.requestRenderAll()
      }
    }

    wrapper.addEventListener('pointerdown', this._boundPinchDown)
    wrapper.addEventListener('pointermove', this._boundPinchMove, { passive: false })
    wrapper.addEventListener('pointerup', this._boundPinchUp)
    wrapper.addEventListener('pointercancel', this._boundPinchUp)
  }

  private async createOrUpdateCutBorder() {
    // Remove existing cut border if any
    if (this.cutBorder) {
      this._canvas.remove(this.cutBorder)
      this.cutBorder = null
    }
    // P2: crop marks 도 함께 제거 (아래 early-return 경로에서도 잔존 방지)
    if (this.cropMarks) {
      this._canvas.remove(this.cropMarks)
      this.cropMarks = null
    }

    if (!this.workspace) return
    // cutline-template이 존재하면 cutBorder를 생성하지 않음
    if (this._canvas.getObjects().find((obj) => obj.id === 'cutline-template')) return

    this.workspace = this._getWorkspace() as fabric.Object
    const center = this.workspace.getCenterPoint()

    if (this.workspace.extensionType === 'clipping') return

    // 에디터 내부에서는 화면 표시용 변환만 사용
    let margin: number
    if (this._options.unit === 'mm') {
      margin = mmToPxDisplay(this._options.size.cutSize)
    } else {
      margin = this._options.size.cutSize // px 단위는 그대로 사용
    }

    const templateBackground = this._canvas
      .getObjects()
      .find((obj) => obj.id === 'template-background')

    let pathDataForBorder: Array<any> | string | undefined
    let borderProps: Partial<fabric.IPathOptions> = {
      left: center.x,
      top: center.y,
      scaleX: 1,
      scaleY: 1,
      angle: 0
    }

    let adjustedWidth: number
    let adjustedHeight: number

    if (templateBackground && !templateBackground.preventAutoResize) {
      // templateBackground가 있으면 templateBackground 기준으로 크기 계산
      adjustedWidth = templateBackground.width * templateBackground.scaleX - margin
      adjustedHeight = templateBackground.height * templateBackground.scaleY - margin
    } else {
      // templateBackground가 없으면 workspace 기준으로 크기 계산
      adjustedWidth = this.workspace.width * this.workspace.scaleX - margin
      adjustedHeight = this.workspace.height * this.workspace.scaleY - margin
    }

    if (adjustedWidth <= 0 || adjustedHeight <= 0) return

    if (templateBackground && !templateBackground.preventAutoResize) {
      try {
        const svgString = convertFabricObjectToSVGString(templateBackground)
        const fabricObjectsFromSvg = await extractSvgElementsAsObjects(svgString, margin)

        if (fabricObjectsFromSvg && fabricObjectsFromSvg.length > 0) {
          // 여러 객체가 반환될 수 있으므로, 첫 번째 객체를 사용하거나 그룹으로 묶어야 할 수 있습니다.
          // 여기서는 첫 번째 객체의 경로를 사용한다고 가정합니다.
          const firstObject = fabricObjectsFromSvg[0]
          if (firstObject) {
            pathDataForBorder = firstObject.path

            const scaleX = (adjustedWidth * firstObject.scaleX) / firstObject.width
            const scaleY = (adjustedHeight * firstObject.scaleY) / firstObject.height

            const scaleFactor = Math.min(scaleX, scaleY)
            borderProps = {
              left: 0,
              top: 0,
              scaleX: scaleFactor,
              scaleY: scaleFactor,
              angle: firstObject.angle,
              originX: 'center',
              originY: 'center'
            }
          } else {
            // Path 객체가 아닌 경우, 기존 로직으로 대체 또는 에러 처리
            console.warn(
              'Template background SVG did not yield a usable Path object for cut border.'
            )
          }
        }
      } catch (error) {
        console.error('Error processing template background for cut border:', error)
      }
    }

    // pathDataForBorder가 준비되지 않았다면 기존 사각형 로직 사용
    if (!pathDataForBorder) {
      const halfWidth = adjustedWidth / 2
      const halfHeight = adjustedHeight / 2

      pathDataForBorder = [
        ['M', -halfWidth, -halfHeight],
        ['L', halfWidth, -halfHeight],
        ['L', halfWidth, halfHeight],
        ['L', -halfWidth, halfHeight],
        ['Z'] // 닫힌 경로
      ]
      borderProps = {
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center'
      }
    }

    this.cutBorder = new fabric.Path(pathDataForBorder as any, {
      ...borderProps, // 위치, 크기, 각도 등 적용
      fill: 'transparent',
      stroke: '#e8943a',
      strokeWidth: 0.5,
      opacity: 0.8,
      strokeDashArray: [12, 12],
      selectable: false,
      hasControls: false,
      hoverCursor: 'default',
      evented: false,
      strokeUniform: true,
      id: 'cut-border',
      extensionType: 'printguide',
      editable: false,
      absolutePositioned: true,
      excludeFromExport: true,
      visible: this._options.showCutBorder
    })

    this._canvas.add(this.cutBorder)
    this._canvas.renderAll()

    // P2: 재단선(trim) 코너 마커를 함께 갱신 (화면 전용, excludeFromExport)
    // adjustedWidth/Height = 재단선(trim) 사각형 폭/높이. 마커는 trim 4코너에 그린다.
    this.createOrUpdateCropMarks(adjustedWidth, adjustedHeight)

    this.bringBordersToFront()
  }

  /**
   * P2: 재단선(trim) 4코너에 표준 crop marks 를 그린다 (화면 전용 가이드).
   *
   * - cutSize(블리드) > 0 일 때만 생성. cutSize=0 이면 마커 없음(블리드 영역이 없어 의미 없음).
   * - 각 코너에 2개의 짧은 선(수평/수직). trim 코너에서 바깥(블리드 방향)으로 뻗는다.
   * - 1개의 system fabric.Group (id 'crop-marks') 로 묶어 excludeFromExport:true → PDF/저장 미포함.
   * - 좌표는 workspace 중앙원점(scene) 기준. trim 반폭 = adjustedWidth/2.
   *
   * ⚠️ 출력(ServicePlugin) 경로는 절대 건드리지 않는다. 순수 화면 가이드.
   */
  private createOrUpdateCropMarks(trimWidth: number, trimHeight: number) {
    // 기존 마커 제거
    if (this.cropMarks) {
      this._canvas.remove(this.cropMarks)
      this.cropMarks = null
    }

    if (!this.workspace) return
    if (this.workspace.extensionType === 'clipping') return
    // cutline-template 모드에서는 자동 cutBorder 가 없으므로 마커도 생성하지 않음
    if (this._canvas.getObjects().find((obj) => obj.id === 'cutline-template')) return

    // 블리드(cutSize) 가 없으면 코너 마커도 의미 없음
    const cutSize = this._options.size?.cutSize ?? 0
    if (!cutSize || cutSize <= 0) return

    // 블리드 폭(화면 픽셀): 워크스페이스 가장자리 ~ 재단선 사이 = cutSize/2 (각 변)
    let bleedPx: number
    if (this._options.unit === 'mm') {
      bleedPx = mmToPxDisplay(cutSize) / 2
    } else {
      bleedPx = cutSize / 2
    }
    if (bleedPx <= 0) return

    const center = this.workspace.getCenterPoint()
    const halfW = trimWidth / 2
    const halfH = trimHeight / 2
    if (halfW <= 0 || halfH <= 0) return

    // 마커 선 길이: 블리드 폭만큼(워크스페이스 가장자리까지) 뻗고,
    // trim 안쪽으로는 약간(짧게) 들어가지 않도록 trim 코너에서 바깥으로만 그린다.
    const len = bleedPx
    const stroke = '#1a1a1a'
    const strokeWidth = 0.5

    const lineOpts = {
      id: 'crop-mark-line',
      stroke,
      strokeWidth,
      strokeUniform: true,
      selectable: false,
      evented: false,
      hasControls: false,
      hoverCursor: 'default'
    }

    // trim 코너 4개. 각 코너에서 수평선 1개 + 수직선 1개를 바깥(블리드)으로.
    // 좌표는 workspace 로컬(중앙원점) 기준 — Group originX/originY='center', left/top=center 로 배치.
    const corners: Array<{ x: number; y: number; dx: number; dy: number }> = [
      { x: -halfW, y: -halfH, dx: -1, dy: -1 }, // 좌상
      { x: halfW, y: -halfH, dx: 1, dy: -1 }, // 우상
      { x: halfW, y: halfH, dx: 1, dy: 1 }, // 우하
      { x: -halfW, y: halfH, dx: -1, dy: 1 } // 좌하
    ]

    const lines: fabric.Line[] = []
    for (const c of corners) {
      // 수평 마커: 코너에서 바깥쪽 x 방향으로 len 만큼
      lines.push(
        new fabric.Line([c.x, c.y, c.x + c.dx * len, c.y], { ...lineOpts })
      )
      // 수직 마커: 코너에서 바깥쪽 y 방향으로 len 만큼
      lines.push(
        new fabric.Line([c.x, c.y, c.x, c.y + c.dy * len], { ...lineOpts })
      )
    }

    this.cropMarks = new fabric.Group(lines, {
      left: center.x,
      top: center.y,
      originX: 'center',
      originY: 'center',
      selectable: false,
      hasControls: false,
      hoverCursor: 'default',
      evented: false,
      id: 'crop-marks',
      extensionType: 'printguide',
      editable: false,
      excludeFromExport: true,
      // 재단선(cutBorder)과 동일한 표시 토글을 따른다
      visible: this._options.showCutBorder
    })

    this._canvas.add(this.cropMarks)
  }

  private async createOrUpdateSafeSize() {
    if (this.safeSizeBorder) {
      this._canvas.remove(this.safeSizeBorder)
      this.safeSizeBorder = null
    }

    if (!this._options.size.safeSize) {
      return
    }

    if (!this.workspace) return
    // cutline-template이 존재하면 safeSizeBorder를 생성하지 않음
    if (this._canvas.getObjects().find((obj) => obj.id === 'cutline-template')) return

    this.workspace = this._getWorkspace() as fabric.Object
    const center = this.workspace.getCenterPoint()

    if (this.workspace.extensionType === 'clipping') return

    // 안전 영역 계산 - 화면 표시용 변환만 사용 (DPI 고려 안함)
    let margin: number
    if (this._options.unit === 'mm') {
      margin = mmToPxDisplay((this._options.size.safeSize || 0) + this._options.size.cutSize)
    } else {
      // px 단위는 그대로 사용
      margin = (this._options.size.safeSize || 0) + this._options.size.cutSize
    }

    const templateBackground = this._canvas
      .getObjects()
      .find((obj) => obj.id === 'template-background')

    let pathDataForBorder: Array<any> | string | undefined
    let borderProps: Partial<fabric.IPathOptions> = {
      left: center.x,
      top: center.y,
      scaleX: 1,
      scaleY: 1,
      angle: 0
    }

    let adjustedWidth: number
    let adjustedHeight: number

    if (templateBackground && !templateBackground.preventAutoResize) {
      // templateBackground가 있으면 templateBackground 기준으로 크기 계산
      adjustedWidth = templateBackground.width * templateBackground.scaleX - margin
      adjustedHeight = templateBackground.height * templateBackground.scaleY - margin
    } else {
      // templateBackground가 없으면 workspace 기준으로 크기 계산
      adjustedWidth = this.workspace.width * this.workspace.scaleX - margin
      adjustedHeight = this.workspace.height * this.workspace.scaleY - margin
    }

    if (adjustedWidth <= 0 || adjustedHeight <= 0) return

    if (templateBackground && !templateBackground.preventAutoResize) {
      try {
        const svgString = convertFabricObjectToSVGString(templateBackground)
        const fabricObjectsFromSvg = await extractSvgElementsAsObjects(svgString, margin)

        if (fabricObjectsFromSvg && fabricObjectsFromSvg.length > 0) {
          const firstObject = fabricObjectsFromSvg[0]
          if (firstObject) {
            const scaleX = (adjustedWidth * firstObject.scaleX) / firstObject.width
            const scaleY = (adjustedHeight * firstObject.scaleY) / firstObject.height

            const scaleFactor = Math.min(scaleX, scaleY)

            pathDataForBorder = firstObject.path
            borderProps = {
              left: 0,
              top: 0,
              scaleX: scaleFactor,
              scaleY: scaleFactor,
              angle: firstObject.angle,
              originX: 'center',
              originY: 'center'
            }
          } else {
            console.warn(
              'Template background SVG did not yield a usable Path object for safe border.'
            )
          }
        }
      } catch (error) {
        console.error('Error processing template background for safe border:', error)
      }
    }

    if (!pathDataForBorder) {
      const halfWidth = adjustedWidth / 2
      const halfHeight = adjustedHeight / 2

      pathDataForBorder = [
        ['M', -halfWidth, -halfHeight],
        ['L', halfWidth, -halfHeight],
        ['L', halfWidth, halfHeight],
        ['L', -halfWidth, halfHeight],
        ['Z']
      ]
      borderProps = {
        left: center.x,
        top: center.y,
        originX: 'center',
        originY: 'center'
      }
    }

    this.safeSizeBorder = new fabric.Path(pathDataForBorder as any, {
      ...borderProps,
      fill: 'transparent',
      stroke: '#4a90d9',
      strokeWidth: 0.5,
      opacity: 0.8,
      strokeDashArray: [10, 10],
      selectable: false,
      hasControls: false,
      hoverCursor: 'default',
      evented: false,
      strokeUniform: true,
      id: 'safe-zone-border',
      extensionType: 'printguide',
      editable: false,
      excludeFromExport: true,
      visible: this._options.showSafeBorder
    })

    this._canvas.add(this.safeSizeBorder)
    this.bringBordersToFront()
  }

  // page-outline 권한 관리
  private updatepageOutline() {
    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in updatepageOutline')
      return
    }

    const pageOutline = this._canvas.getObjects().find((obj) => obj.id === 'page-outline')
    if (pageOutline) {
      const isEditMode = this._options.editMode || false
      pageOutline.set({
        selectable: isEditMode,
        hasControls: isEditMode,
        lockMovementX: !isEditMode,
        lockMovementY: !isEditMode,
        editable: isEditMode,
        evented: isEditMode,
        stroke: '#ff6b6b',
        fill: 'transparent',
        extensionType: 'template-element'
      })
        ; (pageOutline as any).editable = isEditMode
      this._canvas.requestRenderAll()
    }
  }

  // object:added 이벤트 핸들러 통합
  private handleObjectAdded(e: fabric.IEvent) {
    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in handleObjectAdded')
      return
    }

    // page-outline이 추가된 경우, 모든 기존 오브젝트에 클립패스 적용
    if (e.target?.id === 'page-outline') {
      console.log('page-outline added, apply clipPaths to all objects')
      this._canvas.getObjects().forEach((obj) => {
        this.applyPageOutlineClipPath(obj)
      })

      return
    }

    if (e.target?.id === 'cutline-template') {
      this.createOrUpdateCutBorder()
      this.createOrUpdateSafeSize()
    }

    // template-background 가 추가되면 Z-순서 정리
    if (e.target?.id === 'template-background') {
      this.ensureTemplateBackgroundZOrder()
    }

    if (e.target?.extensionType !== 'template-element') {
      // 새로 추가된 오브젝트에 page-outline 클립패스 적용 (outline/printguide/overlay 제외)
      if (!['outline', 'printguide', 'overlay'].includes((e.target as any)?.extensionType)) {
        this.applyPageOutlineClipPath(e.target)
      }
    }



    // 경계선 최상위로 가져오기
    this.bringBordersToFront()
  }

  // object:removed 이벤트 핸들러
  private handleObjectRemoved(e: fabric.IEvent) {
    // page-outline이 제거된 경우 모든 관련 clipPath 해제
    if (e.target?.id === 'page-outline') {
      this._canvas.getObjects().forEach((obj) => {
        this.removePageOutlineClipPath(obj)
      })
      console.log('Page-outline removed, clipPaths cleared')
    }

    // 제거 후에도 Z-순서 재확인
    this.ensureTemplateBackgroundZOrder()
  }

  // page-outline clipPath 적용
  private async applyPageOutlineClipPath(obj: fabric.Object) {
    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in applyPageOutlineClipPath')
      return
    }

    if (!obj || obj.excludeFromExport || obj.extensionType === 'template-element') return
    // outline/printguide/overlay는 clipPath 적용 제외
    if (obj.extensionType === 'outline' || obj.extensionType === 'printguide' || obj.extensionType === 'overlay') return

    if (obj.id === 'page-outline' || obj.id === 'template-background') return

    // 사진틀(프레임)에 채워진 사진은 프레임 투명창 마스킹용 inverted clipPath 를 가진다.
    // page-outline clip 으로 덮어쓰면 마스크가 사라지므로 건드리지 않는다.
    // (frameRef 가 설정된 fillImage 객체 = 프레임 채움 사진)
    if (obj.frameRef) return

    // page-outline 찾기
    const pageOutline = this._canvas.getObjects().find((o) => o.id === 'page-outline')
    if (!pageOutline) return

    // 기존 clipPath 확인
    // 현재는 클립패스 무시
    // if (obj.clipPath && obj.clipPath.id !== 'page-outline-clip') {
    //   console.log(`Object ${obj.id} already has a custom clipPath, skipping.`)
    //   return
    // }

    const clone = await this.cloneOutlineForClipPath(pageOutline)
    obj.clipPath = null
    obj.clipPath = clone
    this._canvas.requestRenderAll()
  }

  // page-outline을 clipPath용으로 복제
  private cloneOutlineForClipPath(outline: fabric.Object): Promise<fabric.Object> {
    return new Promise((resolve) => {
      outline.clone((cloned: fabric.Object) => {
        cloned.set({
          absolutePositioned: true,
          id: 'page-outline-clip',
          fill: 'white',
          extensionType: 'template-element',
        })
        resolve(cloned)
      })
    })
  }

  // page-outline clipPath 제거
  private removePageOutlineClipPath(obj: fabric.Object) {
    if (!obj) return

    // canvas가 유효한지 확인
    if (!this._canvas || !this._canvas.getContext()) {
      console.warn('Canvas is not properly initialized in removePageOutlineClipPath')
      return
    }

    // clipPath가 page-outline-clip인 경우에만 제거
    if (obj.clipPath && obj.clipPath.id === 'page-outline-clip') {
      obj.clipPath = null
      console.log(`Removed page-outline clipPath from object: ${obj.id}`)
      this._canvas.requestRenderAll()
    }
  }

  // 히스토리 시스템과의 연결 설정
  private setupHistoryConnection() {
    // connectWorkspacePlugin 함수를 사용하여 연결
    connectWorkspacePlugin(this._canvas, this)
    console.log('History connection established for WorkspacePlugin using connectWorkspacePlugin')
  }

  // 가이드 요소 복원 메서드 (히스토리에서 호출)
  restoreGuideElements() {
    console.log('WorkspacePlugin.restoreGuideElements called')

    // 기존 경계선들을 제거하고 다시 생성
    this.createOrUpdateCutBorder()
    this.createOrUpdateSafeSize()

    // 경계선들을 최상위로 가져오기
    this.bringBordersToFront()
  }
}

export default WorkspacePlugin
