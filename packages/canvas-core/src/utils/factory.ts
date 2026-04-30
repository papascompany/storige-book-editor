/**
 * Fabric.js Factory Utilities
 *
 * fabric.js 동적 import 및 캔버스/객체 생성을 위한 팩토리 함수들
 * web-react 앱에서 fabric을 직접 import하지 않고 이 모듈을 통해 사용
 */

import { fabric } from 'fabric'
import { v4 as uuid } from 'uuid'

// fabric 모듈 캐싱 (동적 import용)
let fabricModule: typeof fabric | null = null
let defaultsConfigured = false

/**
 * Fabric 인스턴스 획득 (캐싱)
 * 동적 import가 필요한 경우 이 함수 사용
 */
export async function getFabric(): Promise<typeof fabric> {
  if (fabricModule) {
    return fabricModule
  }

  // 동적 import 후 캐싱
  const module = await import('fabric')
  fabricModule = (module as any).fabric || (module as any).default || module
  return fabricModule!
}

/**
 * Fabric 동기 접근 (이미 로드된 경우)
 * canvas-core 내부에서 사용
 */
export function getFabricSync(): typeof fabric {
  return fabric
}

/**
 * Canvas 생성 옵션 인터페이스
 */
export interface FabricCanvasOptions {
  fireRightClick?: boolean
  stopContextMenu?: boolean
  controlsAboveOverlay?: boolean
  selection?: boolean
  preserveObjectStacking?: boolean
  imageSmoothingEnabled?: boolean
  enableRetinaScaling?: boolean
  renderOnAddRemove?: boolean
  skipOffscreen?: boolean
  allowTouchScrolling?: boolean
  index?: number
  unitOptions?: {
    unit?: string
    dpi?: number
  }
}

/**
 * coarse pointer (모바일/태블릿 터치) 디바이스 여부 — SSR 안전.
 */
function isCoarsePointer(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try {
    return window.matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * FabricJS 캔버스 인스턴스 생성
 */
export async function createFabricCanvas(
  canvasId: string,
  options: FabricCanvasOptions = {}
): Promise<fabric.Canvas> {
  const fb = await getFabric()

  const defaultOptions = {
    fireRightClick: false,
    stopContextMenu: true,
    controlsAboveOverlay: true,
    selection: true,
    preserveObjectStacking: true,
    imageSmoothingEnabled: true,
    enableRetinaScaling: true,
    renderOnAddRemove: false,
    skipOffscreen: true,
    // 터치에서 브라우저가 페이지 스크롤을 가로채는 것 방지 (CSS touch-action과 함께 동작)
    allowTouchScrolling: false
  }

  const canvas = new fb.Canvas(canvasId, {
    ...defaultOptions,
    ...options,
    id: uuid()
  })

  return canvas
}

/**
 * Fabric Object.prototype 기본 설정
 * 앱 초기화 시 1회만 호출
 */
export function configureFabricDefaults(): void {
  if (defaultsConfigured) {
    return
  }

  // 기본 객체 캐싱 설정
  fabric.Object.prototype.objectCaching = true
  fabric.Object.prototype.statefullCache = false
  fabric.Object.prototype.noScaleCache = false
  fabric.Object.prototype.cacheProperties = [
    'fill',
    'stroke',
    'strokeWidth',
    'strokeDashArray',
    'width',
    'height',
    'strokeLineCap',
    'strokeDashOffset',
    'strokeLineJoin',
    'strokeMiterLimit',
    'fillRule',
    'backgroundColor',
    'clipPath'
  ]

  // 터치 디바이스에서는 컨트롤 핸들의 hit-area를 키워 손가락으로 잡기 쉽게.
  // touchCornerSize 는 fabric 5+ 에서 터치 입력에 한해 사용되는 corner hit-area.
  if (isCoarsePointer()) {
    fabric.Object.prototype.cornerSize = 16
    ;(fabric.Object.prototype as any).touchCornerSize = 36
    fabric.Object.prototype.padding = 8
    fabric.Object.prototype.borderScaleFactor = 2
  }

  defaultsConfigured = true
}

/**
 * 기본 설정 상태 리셋 (테스트용)
 */
export function resetFabricDefaults(): void {
  defaultsConfigured = false
}

// ============================================================
// 객체 생성 팩토리 함수들
// ============================================================

/**
 * Rect 생성 옵션
 */
export interface RectOptions {
  left?: number
  top?: number
  width?: number
  height?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  rx?: number
  ry?: number
  selectable?: boolean
  evented?: boolean
  id?: string
  [key: string]: any
}

/**
 * Rect 객체 생성
 */
export async function createRect(options: RectOptions = {}): Promise<fabric.Rect> {
  const fb = await getFabric()
  return new fb.Rect({
    id: uuid(),
    ...options
  })
}

/**
 * Text 생성 옵션
 */
export interface TextOptions {
  left?: number
  top?: number
  fontSize?: number
  fontFamily?: string
  fill?: string
  textAlign?: string
  selectable?: boolean
  evented?: boolean
  id?: string
  [key: string]: any
}

/**
 * Text 객체 생성
 */
export async function createText(
  text: string,
  options: TextOptions = {}
): Promise<fabric.Text> {
  const fb = await getFabric()
  return new fb.Text(text, {
    id: uuid(),
    ...options
  })
}

/**
 * IText 객체 생성 (편집 가능한 텍스트)
 */
export async function createIText(
  text: string,
  options: TextOptions = {}
): Promise<fabric.IText> {
  const fb = await getFabric()
  return new fb.IText(text, {
    id: uuid(),
    ...options
  })
}

/**
 * Path 생성 옵션
 */
export interface PathOptions {
  left?: number
  top?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  selectable?: boolean
  evented?: boolean
  id?: string
  [key: string]: any
}

/**
 * Path 객체 생성
 */
export async function createPath(
  pathData: string | any[],
  options: PathOptions = {}
): Promise<fabric.Path> {
  const fb = await getFabric()
  return new fb.Path(pathData, {
    id: uuid(),
    ...options
  })
}

/**
 * Group 생성 옵션
 */
export interface GroupOptions {
  left?: number
  top?: number
  selectable?: boolean
  evented?: boolean
  id?: string
  [key: string]: any
}

/**
 * Group 객체 생성
 */
export async function createGroup(
  objects: fabric.Object[],
  options: GroupOptions = {}
): Promise<fabric.Group> {
  const fb = await getFabric()
  return new fb.Group(objects, {
    id: uuid(),
    ...options
  })
}

/**
 * Point 객체 생성
 */
export async function createPoint(x: number, y: number): Promise<fabric.Point> {
  const fb = await getFabric()
  return new fb.Point(x, y)
}

/**
 * Circle 생성 옵션
 */
export interface CircleOptions {
  left?: number
  top?: number
  radius?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  selectable?: boolean
  evented?: boolean
  id?: string
  [key: string]: any
}

/**
 * Circle 객체 생성
 */
export async function createCircle(options: CircleOptions = {}): Promise<fabric.Circle> {
  const fb = await getFabric()
  return new fb.Circle({
    id: uuid(),
    ...options
  })
}

// ============================================================
// SVG / 이미지 로드 함수들
// ============================================================

/**
 * SVG 로드 옵션
 */
export interface SVGLoadOptions {
  crossOrigin?: string
  grouping?: boolean
}

/**
 * URL에서 SVG 로드
 */
export async function loadSVGFromURL(
  url: string,
  options: SVGLoadOptions = {}
): Promise<fabric.Object> {
  const fb = await getFabric()

  return new Promise((resolve, reject) => {
    fb.loadSVGFromURL(
      url,
      (objects, svgOptions) => {
        if (!objects || objects.length === 0) {
          reject(new Error('SVG 로드 실패: 객체 없음'))
          return
        }

        // 그룹화 여부 (기본: true)
        if (options.grouping !== false && objects.length > 1) {
          const group = fb.util.groupSVGElements(objects, svgOptions)
          group.set({ id: uuid() })
          resolve(group)
        } else if (objects.length === 1) {
          objects[0].set({ id: uuid() })
          resolve(objects[0])
        } else {
          // 그룹화 없이 배열 반환 (첫 번째 객체)
          objects[0].set({ id: uuid() })
          resolve(objects[0])
        }
      },
      undefined,
      { crossOrigin: options.crossOrigin || 'anonymous' }
    )
  })
}

/**
 * SVG 문자열에서 객체 로드
 */
export async function loadSVGFromString(
  svgString: string,
  options: SVGLoadOptions = {}
): Promise<fabric.Object> {
  const fb = await getFabric()

  return new Promise((resolve, reject) => {
    fb.loadSVGFromString(svgString, (objects, svgOptions) => {
      if (!objects || objects.length === 0) {
        reject(new Error('SVG 파싱 실패: 객체 없음'))
        return
      }

      // 그룹화 여부 (기본: true)
      if (options.grouping !== false && objects.length > 1) {
        const group = fb.util.groupSVGElements(objects, svgOptions)
        group.set({ id: uuid() })
        resolve(group)
      } else if (objects.length === 1) {
        objects[0].set({ id: uuid() })
        resolve(objects[0])
      } else {
        objects[0].set({ id: uuid() })
        resolve(objects[0])
      }
    })
  })
}

/**
 * 이미지 로드 옵션
 */
export interface ImageLoadOptions {
  crossOrigin?: string
  left?: number
  top?: number
  scaleX?: number
  scaleY?: number
  originX?: string
  originY?: string
  [key: string]: any
}

/**
 * URL에서 이미지 로드
 */
export async function imageFromURL(
  url: string,
  options: ImageLoadOptions = {}
): Promise<fabric.Image> {
  const fb = await getFabric()

  return new Promise((resolve, reject) => {
    fb.Image.fromURL(
      url,
      (img) => {
        if (!img) {
          reject(new Error('이미지 로드 실패'))
          return
        }

        img.set({
          id: uuid(),
          crossOrigin: options.crossOrigin || 'anonymous',
          ...options
        })

        resolve(img)
      },
      { crossOrigin: options.crossOrigin || 'anonymous' }
    )
  })
}

/**
 * HTMLImageElement에서 fabric.Image 생성
 */
export async function imageFromElement(
  element: HTMLImageElement,
  options: ImageLoadOptions = {}
): Promise<fabric.Image> {
  const fb = await getFabric()

  const img = new fb.Image(element, {
    id: uuid(),
    crossOrigin: options.crossOrigin || 'anonymous',
    ...options
  })

  return img
}
