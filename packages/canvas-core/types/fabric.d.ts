declare namespace IUtil {
  export const findScaleToFit: (source: Object, destination: Object) => number
}
declare namespace fabric {
  export interface IUtil {
    findScaleToFit(source: Object, destination: any): number
  }

  export interface Canvas {
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

  export interface ICanvasOptions {
    id?: string
    index?: number
  }

  export interface Object {
    id: string

    originalLeft: number
    originalTop: number
    extensionType: string

    /// uid of the object
    fillImage: string
    editable: boolean

    movingPath?: fabric.Path
    fixed?: boolean
    alwaysTop?: boolean

    // B1 (2026-07-04): 레이어별 편집권한 속성 — apps/editor/src/types/fabric.d.ts 와 동기.
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

  export interface IGroupOptions {
    id: string
    editable?: boolean
    extensionType?: string
  }

  export interface IPathOptions {
    id: string
    editable?: boolean
    extensionType?: string
  }

  export interface IPatternOptions {
    source: string | HTMLImageElement | HTMLCanvasElement
  }

  export interface IRectOptions {
    id: string
    editable?: boolean
    clipPath?: any
    extensionType?: string
  }

  export interface IImageOptions {
    id?: string
    crossOrigin?: string
    editable?: boolean
    extensionType?: string
  }

  export interface ITextOptions {
    id: string
    editable?: boolean
    extensionType?: string
  }

  export interface IBaseFilter {
    effectType?: string | undefined
  }

  export interface ILineOptions {
    id: string
  }

  export interface Control {
    rotate: number
  }

  function ControlMouseEventHandler(
    eventData: MouseEvent,
    transformData: Transform,
    x: number,
    y: number
  ): boolean

  function ControlStringHandler(
    eventData: MouseEvent,
    control: fabric.Control,
    fabricObject: fabric.Object
  ): string

  export const controlsUtils: {
    rotationWithSnapping: ControlMouseEventHandler
    scalingEqually: ControlMouseEventHandler
    scalingYOrSkewingX: ControlMouseEventHandler
    scalingXOrSkewingY: ControlMouseEventHandler

    scaleCursorStyleHandler: ControlStringHandler
    scaleSkewCursorStyleHandler: ControlStringHandler
    scaleOrSkewActionName: ControlStringHandler
    rotationStyleHandler: ControlStringHandler
  }

  type EventNameExt = 'removed' | EventName

  export interface IObservable<T> {
    on(
      eventName: 'guideline:moving' | 'guideline:mouseup',
      handler: (event: { e: Event; target: fabric.GuideLine }) => void
    ): T

    on(events: { [key: EventName]: (event: { e: Event; target: fabric.GuideLine }) => void }): T
  }

  export interface IGuideLineOptions extends ILineOptions {
    axis: 'horizontal' | 'vertical'
  }

  export interface IGuideLineClassOptions extends IGuideLineOptions {
    canvas: {
      setActiveObject(object: fabric.Object | fabric.GuideLine, e?: Event): Canvas
      remove<T>(...object: (fabric.Object | fabric.GuideLine)[]): T
    } & Canvas
    activeOn: 'down' | 'up'

    initialize(xy: number, objObjects: IGuideLineOptions): void

    callSuper(methodName: string, ...args: unknown[]): any

    getBoundingRect(absolute?: boolean, calculate?: boolean): Rect

    on(eventName: EventNameExt, handler: (e: IEvent<MouseEvent>) => void): void

    off(eventName: EventNameExt, handler?: (e: IEvent<MouseEvent>) => void): void

    fire<T>(eventName: EventNameExt, options?: any): T

    isPointOnRuler(e: MouseEvent): 'horizontal' | 'vertical' | false

    bringToFront(): fabric.Object

    isHorizontal(): boolean
  }

  export interface GuideLine extends Line, IGuideLineClassOptions {}

  export class GuideLine extends Line {
    left: number
    top: number
    type: string

    constructor(xy: number, objObjects?: IGuideLineOptions)

    static fromObject(object: any, callback: any): void
  }

  export interface StaticCanvas {
    ruler: InstanceType<typeof CanvasRuler>
  }
}
