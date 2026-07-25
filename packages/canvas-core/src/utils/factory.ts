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
 * fabric 의 캐시된 devicePixelRatio 를 현재 살아있는 `window.devicePixelRatio` 로 재동기화.
 *
 * ⚠️ 근본(클릭 좌표 오프셋의 원인): `fabric.devicePixelRatio` 는 fabric 모듈 로드 시 **1회만**
 * 캡처된다. `getRetinaScaling()` 과 `_initRetinaScaling()`(setDimensions 가 내부 호출) 이 모두
 * 이 캐시 값을 읽으므로, 페이지 로드 후 dpr 이 바뀌면(브라우저 줌·모니터 간 이동·OS 배율 변경)
 * 캐시가 stale 해진다. 이 상태에서는 setDimensions 를 다시 호출해도 백킹스토어(upperCanvasEl.width)
 * 가 새 dpr 로 재산출되지 않아, getPointer 의 cssScale(= upperCanvasEl.width / boundingWidth) 과
 * retina 나눗셈 배율이 어긋난다 → 클릭 좌표가 원점에서 멀수록 비례해 밀린다.
 *
 * 이 함수로 캐시를 갱신한 뒤 `canvas.setDimensions(현재 CSS 크기)` 를 호출하면 백킹스토어가
 * `cssWidth × liveDpr` 로 재산출되어 `cssScale === retinaScaling` 정합이 회복된다.
 *
 * @returns 캐시 값이 실제로 갱신됐으면 true (호출측이 setDimensions 재적용 여부 판단에 사용)
 */
export function syncFabricDevicePixelRatio(): boolean {
  if (typeof window === 'undefined') return false
  const live = window.devicePixelRatio || 1
  const fb = fabric as unknown as { devicePixelRatio?: number }
  const cached = fb.devicePixelRatio ?? 1
  // 부동소수 여유(1e-3) — 동일 dpr 재호출에서 무의미한 재정합 방지
  if (Math.abs(live - cached) < 1e-3) return false
  fb.devicePixelRatio = live
  return true
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
 *
 * @param canvasOrId 캔버스 DOM 요소 또는 요소 id.
 *   ⚠️ 가능하면 **요소 자체**를 넘겨라 — id 문자열은 내부적으로 getElementById 조회라,
 *   같은 id 의 초기화 두 개가 겹치는 창(StrictMode 이중 마운트)에서 늦게 재개된 쪽이
 *   상대편 요소를 훔쳐 바인딩하는 레이스가 있다(2026-07-13 dev 초기화 레이스 근본원인).
 */
export async function createFabricCanvas(
  canvasOrId: string | HTMLCanvasElement,
  options: FabricCanvasOptions = {}
): Promise<fabric.Canvas> {
  const fb = await getFabric()

  // 생성 시점의 살아있는 dpr 로 fabric 캐시를 맞춘다 — 모듈이 다른 dpr 에서 먼저 로드됐거나
  // (예: 늦은 하이드레이션) 로드 후 dpr 이 바뀐 뒤 새 캔버스를 만드는 경우, 백킹스토어가
  // stale dpr 로 산출돼 첫 프레임부터 클릭 좌표가 어긋나는 것을 방지한다.
  syncFabricDevicePixelRatio()

  // 모바일/터치 디바이스에서는 retina scaling 을 끔 (iOS Safari 메모리 한계 회피).
  // DPR=3 (iPhone) 시 내부 캔버스가 9배 크기 → toDataURL/렌더링 비용 9배. 이걸 끄면
  // 시각 선명도가 약간 떨어지지만 메모리 절감이 훨씬 큼. 워크스페이스가 보통
  // CSS px 단위로 100~400px 크기라 1x 렌더로도 화면상 충분히 선명함.
  const isCoarse = isCoarsePointer()
  const defaultOptions = {
    fireRightClick: false,
    stopContextMenu: true,
    controlsAboveOverlay: true,
    selection: true,
    preserveObjectStacking: true,
    imageSmoothingEnabled: true,
    enableRetinaScaling: !isCoarse,
    renderOnAddRemove: false,
    skipOffscreen: true,
    // 터치에서 브라우저가 페이지 스크롤을 가로채는 것 방지 (CSS touch-action과 함께 동작)
    allowTouchScrolling: false
  }

  const canvas = new fb.Canvas(canvasOrId, {
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
