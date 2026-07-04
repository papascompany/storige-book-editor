// @ts-nocheck

import { fabric } from 'fabric'
import { getImgSrc, getImgStr } from './utils'
import { v4 as uuid } from 'uuid'
import ImageProcessingPlugin from '../plugins/ImageProcessingPlugin'

// ============================================================
// 고수준 API 옵션 인터페이스
// ============================================================

export interface AddImageOptions {
  left?: number
  top?: number
  scaleX?: number
  scaleY?: number
  originX?: string
  originY?: string
  crossOrigin?: string
  id?: string
  centerInWorkspace?: boolean
  setActive?: boolean
  selectable?: boolean
  evented?: boolean
  hasControls?: boolean
  hasBorders?: boolean
  [key: string]: any
}

export interface AddTextOptions {
  left?: number
  top?: number
  fontSize?: number
  fontFamily?: string
  fill?: string
  textAlign?: string
  id?: string
  centerInWorkspace?: boolean
  setActive?: boolean
  originX?: string
  originY?: string
  [key: string]: any
}

export interface AddPathOptions {
  left?: number
  top?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  selectable?: boolean
  evented?: boolean
  id?: string
  extensionType?: string
  originX?: string
  originY?: string
  strokeUniform?: boolean
  [key: string]: any
}

export interface AddRectOptions {
  left?: number
  top?: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  rx?: number
  ry?: number
  id?: string
  selectable?: boolean
  evented?: boolean
  opacity?: number
  [key: string]: any
}

export interface AddGroupOptions {
  left?: number
  top?: number
  id?: string
  selectable?: boolean
  evented?: boolean
  centerInWorkspace?: boolean
  setActive?: boolean
  originX?: string
  originY?: string
  hasControls?: boolean
  hasBorders?: boolean
  [key: string]: any
}

export namespace core {
  export const extendFabricOption = [
    'id',
    'gradientAngle',
    'selectable',
    'hasControls',
    'linkData',
    'editable',
    'hasCutting',
    'hasMolding',
    'hasBinding',
    'effects',
    'extensionType',
    'overlayType',
    'extension',
    'index',
    'fillOpacity',
    'strokeOpacity',
    'styles', // 텍스트 per-character 스타일 (색상, stroke 등)
    'curveRadius',
    'charSpacing',
    'curveDirection',
    'curveArcDeg',
    'pathAlign',
    'fillImage',
    // 사진틀(프레임) 마스킹: 채워진 사진이 어떤 프레임에 속하는지 가리키는 링크.
    // 프레임 PNG 의 투명창 영역에만 사진이 보이도록 inverted clipPath 를 쓰며,
    // 저장→로드/인쇄 라운드트립에서 프레임↔사진 관계를 다시 찾기 위해 보존한다.
    'frameRef',
    'accessory',
    'movingPath',
    'hasBorders',
    'name',
    'displayOrder',
    'alwaysTop',
    'originalFill',
    'effectType',
    'filters',
    'isNestedGroup',
    'originalIndex',
    'parentIndex',
    'nestedIndex',
    // Lock-related properties for layer lock state persistence
    'lockMovementX',
    'lockMovementY',
    'lockRotation',
    'lockScalingX',
    'lockScalingY',
    'preventAutoResize',
    // CMYK 원본 값 저장 (CMYK ↔ RGB 변환 손실 방지)
    'cmykFill',
    'cmykStroke',
    // 레이어 순서 잠금 관련 속성
    'lockLayerOrder',
    'parentLayerId',
    // P1-5 (2026-06-02): 객체 잠금/삭제불가 영속화.
    // lockInfo(LockPlugin) + deleteable 플래그가 저장→복원 시 유지돼야
    // 관리자가 지정한 보호가 고객 진입 시에도 강제됨.
    'lockInfo',
    'deleteable',
    // Part B (2026-06-16): 객체별 편집권한 — 이동/변형 잠금.
    // movable===false 면 고객(비 editMode) 로드 시 applyObjectPermissions 가 lockMovement/
    // Scaling/Rotation 을 강제(deleteable 와 동일하게 관리자가 지정→저장→고객 진입 시 적용).
    'movable',
    // B1 (2026-07-04): 레이어별 속성 4축 — 신규 2종.
    // contentEditable===false 면 고객(비 editMode) 로드 시 applyObjectPermissions 가
    // 텍스트 편집 진입/사진틀 교체를 차단. printExclude===true 면 ServicePlugin PDF
    // 생성에서만 제외(화면·썸네일에는 표시). 미등재 시 저장 1회 왕복에 침묵 소실.
    'contentEditable',
    'printExclude',
    'evented',
    // spread 책등 가변 재배치용 meta(regionRef/anchor) 보존 — useTemplateSetSave와 정합
    'meta',
    // D1 외부 사진 주입 (2026-06-12): 공유방 사진 탭에서 추가된 이미지의 출처 URL.
    // 저장→재편집 라운드트립에서 '사용됨' 뱃지를 복원하기 위해 보존.
    'externalPhotoUrl'
  ]

  export function getWorkspace(canvas: fabric.Canvas): fabric.Object | undefined {
    return canvas.getObjects().find((obj: fabric.Object) => obj.id === 'workspace')
  }

  export function getObjects(canvas: fabric.Canvas): fabric.Object[] {
    const all = canvas.getObjects()
    return all.filter(
      (obj: fabric.Object) =>
        !obj.excludeFromExport &&
        obj.type !== 'GuideLine' &&
        (obj.id !== 'workspace' || (obj.id === 'workspace' && obj.extensionType === 'frame'))
    )
  }

  export function getActiveObjects(canvas: fabric.Canvas): fabric.Object[] {
    return canvas
      .getActiveObjects()
      .filter(
        (obj: fabric.Object) =>
          !obj.excludeFromExport &&
          obj.type !== 'GuideLine' &&
          (obj.id !== 'workspace' || (obj.id === 'workspace' && obj.extensionType === 'frame'))
      )
  }

  export async function fileToURL(file: File) {
    const imageString = await getImgStr(file)
    return getImgSrc(imageString)
  }

  export async function fileToImage(
    canvas: fabric.Canvas,
    file: File,
    imagePlugin?: ImageProcessingPlugin | null
  ) {
    try {
      const src = await fileToURL(file)

      if (src === undefined) {
        console.error('No image source')
        return
      }

      const item = await createFabricImage(canvas, src, imagePlugin)

      const workspace = canvas.getObjects().find((obj: fabric.Object) => obj.id === 'workspace')!

      if (workspace) {
        const center = workspace.getCenterPoint()
        item.set({
          originX: 'center',
          originY: 'center',
          left: center.x,
          top: center.y
        })
      } else {
        item.set({
          left: 0,
          top: 0,
          originX: 'center',
          originY: 'center'
        })
      }

      console.log('fileToImage', item)

      return Promise.resolve(item)
    } catch (e) {
      console.error(e)
      return Promise.reject(e)
    }
  }

  export function fixViewportObjects(canvas: fabric.Canvas): void {
    // 모든 객체 순회
    canvas.getObjects().forEach((obj: fabric.Object) => {
      // 좌표 재설정
      obj.setCoords()

      // 가상화된 객체인 경우 원래 속성 복원
      if (obj._virtualized && obj._originalValues) {
        obj.set(obj._originalValues)
        obj._virtualized = false
        delete obj._originalValues
        obj.dirty = true
      }

      // 오버레이 객체 처리
      if (obj.extensionType === 'overlay' && obj.clipPath) {
        obj.visible = true
        if (obj.clipPath.setCoords) {
          obj.clipPath.setCoords()
        }
      }
    })

    // 캔버스 강제 렌더링
    canvas.requestRenderAll()
  }

  export function createFabricImage(
    canvas: fabric.Canvas,
    src: string,
    imagePlugin?: ImageProcessingPlugin | null
  ): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      try {
        const imgEl = document.createElement('img')
        imgEl.crossOrigin = 'anonymous'
        imgEl.src = src
        imgEl.onload = () => {
          // imagePlugin이 있고 알파 채널이 있는 경우에만 이미지 처리
          if (imagePlugin && imagePlugin.tellHasAlpha && imagePlugin.tellHasAlpha(imgEl as any)) {
            const processImage = imagePlugin.processImage(imgEl as any)
            fabric.Image.fromURL(processImage, (img: fabric.Image) => {
              const scale = getScale(canvas, img.getElement())

              img.set({
                top: canvas.getCenterPoint().y,
                left: canvas.getCenterPoint().x,
                originX: 'center',
                originY: 'center',
                scaleX: scale,
                scaleY: scale,
                id: uuid(),
                crossOrigin: 'anonymous'
              })

              resolve(img as any)
            })
          } else {
            // imagePlugin이 없거나 알파 채널이 없는 경우 기본 처리
            const scale = getScale(canvas, imgEl)
            const img = new fabric.Image(imgEl, {
              top: canvas.getCenterPoint().y,
              left: canvas.getCenterPoint().x,
              originX: 'center',
              originY: 'center',
              scaleX: scale,
              scaleY: scale,
              id: uuid(),
              crossOrigin: 'anonymous'
            })
            img.setCoords()
            return resolve(img)
          }
        }
        imgEl.onerror = (e) => {
          reject(new Error('Failed to load image'))
        }
      } catch (e) {
        console.error(e)
        reject(e)
      }
    })
  }

  /**
   * Simple file to image conversion without ImageProcessingPlugin
   * Use this when OpenCV features are disabled
   */
  export async function fileToImageSimple(
    canvas: fabric.Canvas,
    file: File
  ): Promise<fabric.Image> {
    const src = await fileToURL(file)

    if (src === undefined) {
      throw new Error('No image source')
    }

    const item = await createFabricImageSimple(canvas, src)

    const workspace = canvas.getObjects().find((obj: fabric.Object) => obj.id === 'workspace')

    if (workspace) {
      const center = workspace.getCenterPoint()
      item.set({
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y
      })
    } else {
      item.set({
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center'
      })
    }

    return item
  }

  /**
   * Simple fabric image creation without ImageProcessingPlugin
   * Skips alpha channel processing (no OpenCV required)
   */
  export function createFabricImageSimple(
    canvas: fabric.Canvas,
    src: string
  ): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      try {
        const imgEl = document.createElement('img')
        imgEl.crossOrigin = 'anonymous'
        imgEl.src = src
        imgEl.onload = () => {
          const scale = getScale(canvas, imgEl)
          const img = new fabric.Image(imgEl, {
            top: canvas.getCenterPoint().y,
            left: canvas.getCenterPoint().x,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            id: uuid(),
            crossOrigin: 'anonymous'
          })
          img.setCoords()
          resolve(img)
        }
        imgEl.onerror = (e) => {
          reject(new Error('Failed to load image'))
        }
      } catch (e) {
        console.error(e)
        reject(e)
      }
    })
  }

  export function getScale(
    canvas: fabric.Canvas,
    imgEl: HTMLCanvasElement | HTMLImageElement | HTMLVideoElement
  ) {
    const canvasWidth = canvas.width!
    const canvasHeight = canvas.height!

    const imageWidth = imgEl.width
    const imageHeight = imgEl.height

    let scale = 1

    if (imageWidth > imageHeight) {
      scale = canvasWidth / imageWidth
    } else {
      scale = canvasHeight / imageHeight
    }

    scale = scale > 0.5 ? 0.5 : scale
    return scale < 0.2 ? 0.2 : scale
  }

  export function keepObjectRatio(object: fabric.Image) {
    object.set({
      lockRotation: true,
      lockSkewingX: true,
      lockSkewingY: true,
      lockUniScaling: true,
      lockScalingFlip: true
    })
    object.setControlsVisibility({
      mt: false,
      mb: false,
      ml: false,
      mr: false,
      mtr: false
    })
    object.on('scaling', function (e) {
      const scale = object.scaleX

      if (object.scaleX !== object.scaleY) {
        object.scaleX = scale
        object.scaleY = scale
      }
    })
  }

  // ============================================================
  // 고수준 API: 객체 추가 함수들
  // editor에서 fabric을 직접 사용하지 않고 이 함수들을 호출
  // ============================================================

  /**
   * URL에서 이미지 로드 후 캔버스에 추가
   */
  export function addImageFromURL(
    canvas: fabric.Canvas,
    url: string,
    options: AddImageOptions = {}
  ): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      const {
        centerInWorkspace = true,
        setActive = true,
        crossOrigin = 'anonymous',
        ...restOptions
      } = options

      fabric.Image.fromURL(
        url,
        (img: fabric.Image) => {
          if (!img) {
            reject(new Error('이미지 로드 실패'))
            return
          }

          const imageId = options.id || uuid()

          // 기본 속성 설정
          img.set({
            id: imageId,
            crossOrigin,
            ...restOptions
          })

          // 워크스페이스 중앙에 배치
          if (centerInWorkspace) {
            const workspace = getWorkspace(canvas)
            if (workspace) {
              const center = workspace.getCenterPoint()
              img.set({
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center'
              })
            }
          }

          // 캔버스에 추가
          canvas.add(img)

          // 활성 객체로 설정
          if (setActive) {
            canvas.setActiveObject(img)
          }

          canvas.requestRenderAll()
          resolve(img)
        },
        { crossOrigin }
      )
    })
  }

  /**
   * 텍스트 객체 생성 후 캔버스에 추가
   */
  export function addText(
    canvas: fabric.Canvas,
    text: string,
    options: AddTextOptions = {}
  ): fabric.IText {
    const {
      centerInWorkspace = true,
      setActive = true,
      fontSize = 40,
      fontFamily = 'Arial',
      fill = '#000000',
      ...restOptions
    } = options

    const textId = options.id || uuid()

    const textObj = new fabric.IText(text, {
      id: textId,
      fontSize,
      fontFamily,
      fill,
      ...restOptions
    })

    // 워크스페이스 중앙에 배치
    if (centerInWorkspace) {
      const workspace = getWorkspace(canvas)
      if (workspace) {
        const center = workspace.getCenterPoint()
        textObj.set({
          left: center.x,
          top: center.y,
          originX: 'center',
          originY: 'center'
        })
      }
    }

    // 캔버스에 추가
    canvas.add(textObj)

    // 활성 객체로 설정
    if (setActive) {
      canvas.setActiveObject(textObj)
    }

    canvas.requestRenderAll()
    return textObj
  }

  /**
   * Path 객체 생성 후 캔버스에 추가
   */
  export function addPath(
    canvas: fabric.Canvas,
    pathData: string | any[],
    options: AddPathOptions = {}
  ): fabric.Path {
    const pathId = options.id || uuid()

    const path = new fabric.Path(pathData, {
      id: pathId,
      ...options
    })

    canvas.add(path)
    canvas.requestRenderAll()

    return path
  }

  /**
   * Rect 객체 생성 후 캔버스에 추가
   */
  export function addRect(
    canvas: fabric.Canvas,
    options: AddRectOptions = {}
  ): fabric.Rect {
    const rectId = options.id || uuid()

    const rect = new fabric.Rect({
      id: rectId,
      width: 100,
      height: 100,
      fill: '#cccccc',
      ...options
    })

    canvas.add(rect)
    canvas.requestRenderAll()

    return rect
  }

  /**
   * Group 객체 생성 후 캔버스에 추가
   */
  export function addGroup(
    canvas: fabric.Canvas,
    objects: fabric.Object[],
    options: AddGroupOptions = {}
  ): fabric.Group {
    const {
      centerInWorkspace = false,
      setActive = true,
      ...restOptions
    } = options

    const groupId = options.id || uuid()

    const group = new fabric.Group(objects, {
      id: groupId,
      ...restOptions
    })

    // 워크스페이스 중앙에 배치
    if (centerInWorkspace) {
      const workspace = getWorkspace(canvas)
      if (workspace) {
        const center = workspace.getCenterPoint()
        group.set({
          left: center.x,
          top: center.y,
          originX: 'center',
          originY: 'center'
        })
      }
    }

    canvas.add(group)

    if (setActive) {
      canvas.setActiveObject(group)
    }

    canvas.requestRenderAll()
    return group
  }

  /**
   * URL에서 SVG 로드 후 캔버스에 추가
   */
  export function addSVGFromURL(
    canvas: fabric.Canvas,
    url: string,
    options: AddGroupOptions = {}
  ): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      const {
        centerInWorkspace = true,
        setActive = true,
        ...restOptions
      } = options

      fabric.loadSVGFromURL(
        url,
        (objects, svgOptions) => {
          if (!objects || objects.length === 0) {
            reject(new Error('SVG 로드 실패'))
            return
          }

          let result: fabric.Object

          if (objects.length > 1) {
            result = fabric.util.groupSVGElements(objects, svgOptions)
          } else {
            result = objects[0]
          }

          result.set({
            id: options.id || uuid(),
            ...restOptions
          })

          // 워크스페이스 중앙에 배치
          if (centerInWorkspace) {
            const workspace = getWorkspace(canvas)
            if (workspace) {
              const center = workspace.getCenterPoint()
              result.set({
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center'
              })
            }
          }

          canvas.add(result)

          if (setActive) {
            canvas.setActiveObject(result)
          }

          canvas.requestRenderAll()
          resolve(result)
        },
        undefined,
        { crossOrigin: 'anonymous' }
      )
    })
  }

  /**
   * SVG 문자열에서 객체 생성 후 캔버스에 추가
   */
  export function addSVGFromString(
    canvas: fabric.Canvas,
    svgString: string,
    options: AddGroupOptions = {}
  ): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      const {
        centerInWorkspace = true,
        setActive = true,
        ...restOptions
      } = options

      fabric.loadSVGFromString(svgString, (objects, svgOptions) => {
        if (!objects || objects.length === 0) {
          reject(new Error('SVG 파싱 실패'))
          return
        }

        let result: fabric.Object

        if (objects.length > 1) {
          result = fabric.util.groupSVGElements(objects, svgOptions)
        } else {
          result = objects[0]
        }

        result.set({
          id: options.id || uuid(),
          ...restOptions
        })

        // 워크스페이스 중앙에 배치
        if (centerInWorkspace) {
          const workspace = getWorkspace(canvas)
          if (workspace) {
            const center = workspace.getCenterPoint()
            result.set({
              left: center.x,
              top: center.y,
              originX: 'center',
              originY: 'center'
            })
          }
        }

        canvas.add(result)

        if (setActive) {
          canvas.setActiveObject(result)
        }

        canvas.requestRenderAll()
        resolve(result)
      })
    })
  }

  /**
   * Point 객체 생성 (캔버스에 추가하지 않음, 좌표 계산용)
   */
  export function createPoint(x: number, y: number): fabric.Point {
    return new fabric.Point(x, y)
  }

  // ============================================================
  // 객체 생성 전용 함수들 (캔버스에 추가하지 않음)
  // fillImage, 오버레이 등 복잡한 로직에서 사용
  // ============================================================

  /**
   * Rect 객체 생성 (캔버스에 추가하지 않음)
   */
  export function createRect(options: AddRectOptions = {}): fabric.Rect {
    const rectId = options.id || uuid()
    return new fabric.Rect({
      id: rectId,
      ...options
    })
  }

  /**
   * Text 객체 생성 (캔버스에 추가하지 않음)
   */
  export function createText(text: string, options: AddTextOptions = {}): fabric.Text {
    const textId = options.id || uuid()
    return new fabric.Text(text, {
      id: textId,
      ...options
    })
  }

  /**
   * IText 객체 생성 (캔버스에 추가하지 않음)
   */
  export function createIText(text: string, options: AddTextOptions = {}): fabric.IText {
    const textId = options.id || uuid()
    return new fabric.IText(text, {
      id: textId,
      ...options
    })
  }

  /**
   * Path 객체 생성 (캔버스에 추가하지 않음)
   */
  export function createPath(pathData: string | any[], options: AddPathOptions = {}): fabric.Path {
    const pathId = options.id || uuid()
    return new fabric.Path(pathData, {
      id: pathId,
      ...options
    })
  }

  /**
   * Group 객체 생성 (캔버스에 추가하지 않음)
   */
  export function createGroup(objects: fabric.Object[], options: AddGroupOptions = {}): fabric.Group {
    const groupId = options.id || uuid()
    return new fabric.Group(objects, {
      id: groupId,
      ...options
    })
  }

  /**
   * URL에서 이미지 로드 (캔버스에 추가하지 않음)
   */
  export function imageFromURL(
    url: string,
    options: AddImageOptions = {}
  ): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      const { crossOrigin = 'anonymous', ...restOptions } = options

      fabric.Image.fromURL(
        url,
        (img: fabric.Image) => {
          if (!img) {
            reject(new Error('이미지 로드 실패'))
            return
          }

          img.set({
            id: options.id || uuid(),
            crossOrigin,
            ...restOptions
          })

          resolve(img)
        },
        { crossOrigin }
      )
    })
  }

  /**
   * URL에서 SVG 로드 (캔버스에 추가하지 않음)
   */
  export function loadSVGFromURL(
    url: string,
    options: AddGroupOptions = {}
  ): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      fabric.loadSVGFromURL(
        url,
        (objects, svgOptions) => {
          if (!objects || objects.length === 0) {
            reject(new Error('SVG 로드 실패'))
            return
          }

          let result: fabric.Object

          if (objects.length > 1) {
            result = fabric.util.groupSVGElements(objects, svgOptions)
          } else {
            result = objects[0]
          }

          result.set({
            id: options.id || uuid(),
            ...options
          })

          resolve(result)
        },
        undefined,
        { crossOrigin: 'anonymous' }
      )
    })
  }

  /**
   * SVG 문자열에서 객체 생성 (캔버스에 추가하지 않음)
   */
  export function loadSVGFromString(
    svgString: string,
    options: AddGroupOptions = {}
  ): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      fabric.loadSVGFromString(svgString, (objects, svgOptions) => {
        if (!objects || objects.length === 0) {
          reject(new Error('SVG 파싱 실패'))
          return
        }

        let result: fabric.Object

        if (objects.length > 1) {
          result = fabric.util.groupSVGElements(objects, svgOptions)
        } else {
          result = objects[0]
        }

        result.set({
          id: options.id || uuid(),
          ...options
        })

        resolve(result)
      })
    })
  }

  /**
   * 캔버스 스크린샷 생성
   */
  export function takeScreenshot(
    canvas: fabric.Canvas,
    options: {
      format?: 'png' | 'jpeg' | 'webp'
      quality?: number
      multiplier?: number
    } = {}
  ): string {
    const { format = 'png', quality = 1, multiplier = 1 } = options

    return canvas.toDataURL({
      format,
      quality,
      multiplier
    })
  }

  /**
   * 워크스페이스 영역만 스크린샷
   */
  export function takeWorkspaceScreenshot(
    canvas: fabric.Canvas,
    options: {
      format?: 'png' | 'jpeg' | 'webp'
      quality?: number
      multiplier?: number
    } = {}
  ): string | null {
    const workspace = getWorkspace(canvas)
    if (!workspace) {
      return null
    }

    const bound = workspace.getBoundingRect()
    const { format = 'png', quality = 1, multiplier = 1 } = options

    return canvas.toDataURL({
      format,
      quality,
      multiplier,
      left: bound.left,
      top: bound.top,
      width: bound.width,
      height: bound.height
    })
  }

  /**
   * 객체 복제
   */
  export function cloneObject(obj: fabric.Object): fabric.Object {
    return fabric.util.object.clone(obj)
  }

  /**
   * 임시 캔버스 생성 (DOM에 추가하지 않음)
   */
  export function createTempCanvas(options: {
    width?: number
    height?: number
  } = {}): fabric.Canvas {
    const { width = 800, height = 600 } = options
    const tempCanvasEl = document.createElement('canvas')
    const tempCanvas = new fabric.Canvas(tempCanvasEl, {
      width,
      height,
      renderOnAddRemove: false
    })
    return tempCanvas
  }

  /**
   * 텍스트 객체 styles 정규화 (fabric 5.5 크래시 방어).
   *
   * canvasData 에 textbox 의 `styles` 키가 아예 없으면(예: 외부 변환기 출력)
   * fabric 5.5 의 fromObject 가 stylesFromArray(undefined)를 그대로 전파해
   * 객체의 styles 가 undefined 가 되고, 이후 toObject(저장/PDF/썸네일)에서
   * stylesToArray 가 "Cannot read properties of undefined (reading '0')" 로
   * 크래시한다(저장 무한로딩). 로드 직후/직렬화 직전에 빈 객체로 보정한다.
   */
  export function ensureTextStyles(canvas: fabric.StaticCanvas): void {
    for (const obj of canvas.getObjects()) {
      const t = obj as fabric.Object & { styles?: unknown; type?: string }
      if (
        (t.type === 'textbox' || t.type === 'text' || t.type === 'i-text') &&
        (t.styles === undefined || t.styles === null)
      ) {
        ;(t as any).styles = {}
      }
    }
  }

  /**
   * 이미지 객체 crossOrigin 새니타이저 (cross-origin canvas taint 방어, 2026-06-12).
   *
   * fabric 5.5 Image.fromObject 는 object.crossOrigin 을 loadImage 에 그대로 전달하고,
   * crossOrigin 이 없으면(undefined/null) <img> 를 비-CORS 모드로 로드한다. 변환기 출력·
   * 기존 등록 템플릿 canvasData 의 image 객체에는 crossOrigin 이 없어, 편집기
   * (editor.papascompany.co.kr)가 스토리지(api.papascompany.co.kr) PNG 를 로드하면
   * 캔버스가 taint → 썸네일 자동저장/미리보기 toDataURL·getImageData 가
   * SecurityError 로 터진다(서버는 ACAO:* 정상 — 클라이언트 로드 모드 문제).
   *
   * 로드 직전에 type==='image' && src 가 교차출처 http(s)/protocol-relative URL 인
   * 객체에 crossOrigin:'anonymous' 를 주입해 기존 등록 템플릿을 재가져오기 없이 구제한다.
   * - dataURL/blob/상대경로/동일출처 절대 URL 은 불변 (회귀 금지)
   * - 기존 crossOrigin 값('', 'anonymous', 'use-credentials')은 보존
   *   (fabric toObject 는 비-CORS 로드 이미지를 crossOrigin:null 로 직렬화하므로
   *   null 은 '미지정'으로 간주하고 주입한다)
   * - 비파괴: 변경이 필요한 노드만 얕은 복사(원본 store 객체 불변)
   * - group(objects)/clipPath/backgroundImage/overlayImage 재귀 처리
   */
  export function ensureImageCrossOrigin<T extends object>(input: T): T {
    const isCrossOriginHttpSrc = (src: unknown): boolean => {
      if (typeof src !== 'string') return false
      const isHttp =
        src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')
      if (!isHttp) return false // dataURL/blob/상대경로 등은 대상 아님
      // 동일출처 절대 URL 은 불변 (브라우저 환경에서만 판정 가능 — node 등은 주입)
      if (typeof window !== 'undefined' && window.location?.origin) {
        const origin = window.location.origin
        if (src === origin || src.startsWith(origin + '/')) return false
      }
      return true
    }

    const visit = (node: any): any => {
      if (!node || typeof node !== 'object') return node

      if (Array.isArray(node)) {
        let changed = false
        const mapped = node.map((item) => {
          const v = visit(item)
          if (v !== item) changed = true
          return v
        })
        return changed ? mapped : node
      }

      let out = node
      const set = (key: string, value: any) => {
        if (out === node) out = { ...node }
        out[key] = value
      }

      if (
        node.type === 'image' &&
        (node.crossOrigin === undefined || node.crossOrigin === null) &&
        isCrossOriginHttpSrc(node.src)
      ) {
        set('crossOrigin', 'anonymous')
      }

      // 중첩 이미지가 들어올 수 있는 키만 재귀 (styles 등 대형 트리는 건드리지 않음)
      for (const key of ['objects', 'clipPath', 'backgroundImage', 'overlayImage']) {
        const child = node[key]
        if (child && typeof child === 'object') {
          const v = visit(child)
          if (v !== child) set(key, v)
        }
      }

      return out
    }

    return visit(input)
  }

  /**
   * JSON에서 캔버스 로드
   */
  export function loadFromJSON(
    canvas: fabric.Canvas,
    json: object | string
  ): Promise<void> {
    // 교차출처 이미지 crossOrigin 주입 (taint 방어 — ensureImageCrossOrigin 참조)
    let input: object | string = json
    try {
      const parsed = typeof json === 'string' ? JSON.parse(json) : json
      if (parsed && typeof parsed === 'object') {
        input = ensureImageCrossOrigin(parsed)
      }
    } catch {
      input = json
    }
    return new Promise((resolve) => {
      canvas.loadFromJSON(input, () => {
        ensureTextStyles(canvas)
        canvas.renderAll()
        resolve()
      })
    })
  }

  /**
   * 캔버스를 JSON으로 변환
   */
  export function toJSON(
    canvas: fabric.Canvas,
    propertiesToInclude?: string[]
  ): object {
    ensureTextStyles(canvas)
    const defaultProps = ['id', 'extensionType', 'selectable', 'evented']
    return canvas.toJSON(propertiesToInclude || defaultProps)
  }
}

// ============================================================================
// Cross-canvas object move (cover.md §7 / D5 Phase 3b-v)
// ============================================================================

export interface MoveObjectToCanvasOptions {
  /** target canvas 좌표계 left (미지정 시 source 좌표 유지) */
  left?: number
  /** target canvas 좌표계 top (미지정 시 source 좌표 유지) */
  top?: number
  /** id 보존 여부 (기본 true) */
  preserveId?: boolean
  /** meta(예: regionRef/anchor) 보존 여부 (기본 true). 호출 측이 새 region에 맞게 추가 갱신 필요 */
  preserveMeta?: boolean
  /** atomic history 트랜잭션 사용 (기본 true). false면 fabric 자동 history만 사용 */
  atomicHistory?: boolean
}

/**
 * 객체를 한 캔버스에서 다른 캔버스로 이동 (cross-canvas move).
 *
 * fabric 객체는 한 캔버스에만 속하므로 다음 순서로 처리:
 *   1) source.clone(obj) → 보존 속성 array 명시 (core.extendFabricOption 재사용)
 *   2) target.add(cloned)
 *   3) source.remove(obj)
 *
 * 각 캔버스에 대해 offHistory/onHistory로 atomic 1 step씩 등록 (기본).
 * 두 캔버스의 history가 분리되어 있어 user-visible Undo는 active canvas만
 * 영향 받음 — Phase 3b-v 1차는 이 정책을 받아들이고, 호출 측이 active canvas를
 * target으로 두어 직관적 Undo를 보장한다.
 *
 * 시스템 객체(workspace/cut-border/safe-zone-border/guideline 등)는 이동하지 않음.
 *
 * cover.md §7 / D5 Phase 3b-v — Composite 모드 cross-canvas 객체 이동.
 *
 * @returns target canvas의 새 객체. 실패/미이동 시 null.
 */
export function moveObjectToCanvas(
  obj: fabric.Object,
  source: fabric.Canvas,
  target: fabric.Canvas,
  options: MoveObjectToCanvasOptions = {}
): Promise<fabric.Object | null> {
  const {
    left,
    top,
    preserveId = true,
    preserveMeta = true,
    atomicHistory = true,
  } = options

  return new Promise((resolve) => {
    if (!obj || !source || !target) return resolve(null)
    if (source === target) return resolve(obj)
    if ((obj as any).meta?.system) return resolve(null)
    if ((obj as any).id === 'workspace') return resolve(null)

    const origId = (obj as any).id
    const origMeta = (obj as any).meta

    // fabric clone — 두 번째 인자로 보존 속성 array 전달 (core.extendFabricOption 재사용)
    obj.clone(
      (cloned: fabric.Object) => {
        try {
          if (preserveId && origId) (cloned as any).id = origId
          if (preserveMeta && origMeta) {
            try {
              ;(cloned as any).meta = JSON.parse(JSON.stringify(origMeta))
            } catch {
              ;(cloned as any).meta = origMeta
            }
          }
          if (left !== undefined) cloned.set('left', left)
          if (top !== undefined) cloned.set('top', top)
          cloned.set('evented', true)
          cloned.setCoords()

          // source: offHistory → discard + remove → onHistory
          if (atomicHistory && (source as any).offHistory) (source as any).offHistory()
          source.discardActiveObject()
          source.remove(obj)
          source.requestRenderAll()
          if (atomicHistory && (source as any).onHistory) (source as any).onHistory()

          // target: offHistory → add + setActive → onHistory
          if (atomicHistory && (target as any).offHistory) (target as any).offHistory()
          target.add(cloned)
          target.setActiveObject(cloned)
          target.requestRenderAll()
          if (atomicHistory && (target as any).onHistory) (target as any).onHistory()

          resolve(cloned)
        } catch (e) {
          console.error('[moveObjectToCanvas] move failed:', e)
          resolve(null)
        }
      },
      core.extendFabricOption
    )
  })
}
