/**
 * Fabric.js 타입 확장
 * canvas-core의 fabric.d.ts와 동기화
 */

declare namespace fabric {
  interface Canvas {
    id: string
    contextTop: CanvasRenderingContext2D
    lowerCanvasEl: HTMLCanvasElement
    upperCanvasEl: HTMLCanvasElement
    wrapperEl: HTMLElement
    isDragging: boolean
    historyProcessing: boolean
    _currentTransform: unknown
    extraProps: any
    _centerObject: (obj: fabric.Object, center: fabric.Point) => fabric.Canvas
    undo: (callback?: () => void) => void
    redo: (callback?: () => void) => void
    canUndo: () => boolean
    canRedo: () => boolean
    historyUndo: any[]
    historyRedo: any[]
    strokeOpacity: number
    fillOpacity: number
    screenshot: any
    disposed?: boolean

    name?: string

    unitOptions: {
      unit: 'px' | 'mm'
      dpi: number
    }

    clearHistory(): void
    _historyNext(): void
    _historyInit(): void
    offHistory(): void
    onHistory(): void
    _setupCurrentTransform(e: Event, target: fabric.Object, alreadySelected: boolean): void
    getCenterPoint(): fabric.Point
  }

  interface ICanvasOptions {
    id?: string
    index?: number
  }

  interface Object {
    id: string
    originalLeft: number
    originalTop: number
    extensionType: string
    fillImage: string
    editable: boolean
    movingPath?: fabric.Path
    fixed?: boolean
    alwaysTop?: boolean
    // B1 (2026-07-04): 레이어별 편집권한 속성 — extendFabricOption 등재(직렬화)와 동기.
    /** false = 고객 이동/변형 잠금 (Part B, applyObjectPermissions 강제) */
    movable?: boolean
    /** false = 고객 삭제 잠금 (P1-5, ObjectPlugin.del 가드) */
    deleteable?: boolean
    /** false = 고객 내용편집 잠금 (텍스트 진입/사진틀 교체 차단) */
    contentEditable?: boolean
    /** true = PDF 출력 제외 (화면·썸네일에는 표시) */
    printExclude?: boolean
    /** true = 레이어 순서 변경 잠금 (ObjectPlugin z-order/reorderObject 가드) */
    lockLayerOrder?: boolean
    /** L7 (2026-07-11): true = 필수 편집 요소 — 고객 미편집 완료 시 비차단 경고 (텍스트·사진틀) */
    requiredEdit?: boolean
    /** L7: true = 고객 편집 발생 마킹 (텍스트 text:changed 시 세팅, 세션 영속 판정) */
    requiredEditTouched?: boolean
    /** LockPlugin 고급 잠금 메타 (lockedAt 은 JSON 왕복 후 string 가능) */
    lockInfo?: {
      isLocked: boolean
      lockLevel: 'user' | 'designer' | 'admin' | 'system'
      lockedBy?: string
      lockedAt?: Date | string
      reason?: string
    }
    getElement(): HTMLCanvasElement
    [key: string]: any
  }

  interface IGroupOptions {
    id?: string
    editable?: boolean
    extensionType?: string
  }

  interface IPathOptions {
    id?: string
    editable?: boolean
    extensionType?: string
    evented?: boolean
    hasControls?: boolean
    lockMovementX?: boolean
    lockMovementY?: boolean
    [key: string]: any
  }

  interface Path {
    editable?: boolean
    [key: string]: any
  }

  interface IRectOptions {
    id?: string
    editable?: boolean
    clipPath?: any
    extensionType?: string
  }

  interface IImageOptions {
    id?: string
    crossOrigin?: string
    editable?: boolean
    extensionType?: string
  }

  interface ITextOptions {
    id?: string
    editable?: boolean
    extensionType?: string
  }

  interface ILineOptions {
    id?: string
  }

  interface IBaseFilter {
    effectType?: string | undefined
  }

  interface StaticCanvas {
    ruler: any
  }
}
