import Editor from '../Editor'
import * as d3 from 'd3'
import { v4 as uuid } from 'uuid'
import { fabric } from 'fabric'
import { PluginBase } from '../plugin'
// P2-11/A — OpenCV/배경제거 lazy-loader 분리. 같은 module-level 캐시 공유.
import { getCv, getBackgroundRemoval } from '../utils/openCv'

// Config type for background removal (inline to avoid static import)
interface BgRemovalConfig {
  debug?: boolean
  rescale?: boolean
  model?: string
  device?: string
  output?: {
    quality?: number
    format?: string
  }
}

class ImageProcessingPlugin extends PluginBase {
  name = 'ImageProcessingPlugin'
  events = []
  hotkeys = []

  private config: BgRemovalConfig = {
    debug: false,
    rescale: true,
    model: 'isnet_fp16',
    device: 'gpu',
    output: {
      quality: 0.5,
      format: 'image/png'
    }
  }

  /**
   * 배경제거(imgly ONNX 모델) 초기화 in-flight promise — 멱등 캐시.
   * null = 미시작 / pending = 진행 중 / resolved = 준비 완료.
   * 실패 시 null 로 리셋되어 다음 호출에서 재시도한다.
   */
  private modelReadyPromise: Promise<void> | null = null

  /** 모델 초기화 완료 여부 — 로딩 UX(준비 중 메시지) 분기용 */
  private modelReady = false

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
    // D-6b① (2026-07-15): eager preload 제거 — 기존엔 여기서 startService() 를
    // 즉시 실행해 ONNX 모델(ISNet fp16 ≈88MB)+ort wasm(≈23MB)을 모든 에디터/embed
    // 캔버스 생성 시마다 CDN 에서 다운로드했다. 이제 실사용 진입점이
    // ensureReady()(모델) / ensureCvReady()(OpenCV) 를 선행 await 하는 lazy 초기화.
    // 플러그인 생성은 어떤 네트워크/무거운 초기화도 트리거하지 않는다.
  }

  /**
   * HEX 문자열을 RGB 배열로 변환
   */
  private hexToRgb(hex: string): [number, number, number] {
    const normalized = hex.replace('#', '')
    const bigint = parseInt(normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return [r, g, b]
  }

  /**
   * 두 색상이 tolerance 이내로 유사한지 판단
   */
  private isColorNear(
    pixel: [number, number, number],
    target: [number, number, number],
    tolerance: number
  ): boolean {
    const dr = pixel[0] - target[0]
    const dg = pixel[1] - target[1]
    const db = pixel[2] - target[2]
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance
  }

  /**
   * 주어진 fabric.Object를 캔버스로 렌더한 뒤, 특정 색상(들)만 남기고 나머지는 투명 처리한 마스크 이미지를 생성
   * - 기본: fillColor(예: #00ff00)만 유지 → 내부 오프셋용
   * - includeStroke=true일 때 strokeColor(예: #ff0000)도 함께 유지 → 외부 오프셋용
   */
  async extractMaskImageFromObject(
    object: fabric.Object,
    opts?: {
      fillColor?: string
      includeStroke?: boolean
      strokeColor?: string
      stroke?: string
      strokeWidth?: number,
      multiplier?: number
    }
  ): Promise<fabric.Image> {
    const fillColor = opts?.fillColor ?? '#00ff00'
    const strokeColor = opts?.strokeColor ?? '#ff0000'
    const includeStroke = opts?.includeStroke ?? false
    const tolerance = 10
    const multiplier = opts?.multiplier ?? 4

    // 원본을 건드리지 않기 위해 복제본을 생성하여 렌더
    const renderObject: fabric.Object = await new Promise((resolve) => {
      ; (object as any).clone((cloned: fabric.Object) => resolve(cloned))
    })

    // 복제본에 색상/스트로크를 덮어씌워 구분 가능한 마스크를 생성
    renderObject.set({
      fill: fillColor,
      width: object.width!,
      height: object.height!,
      scaleX: object.scaleX!,
      stroke: strokeColor,
      strokeWidth: opts?.strokeWidth ?? (object.strokeWidth ?? 1),
      strokeLineJoin: 'round',
      strokeLineCap: 'round',
    } as any)

    const sourceCanvas = (renderObject as any).toCanvasElement({
      multiplier: multiplier,
      withoutTransform: true,
      enableRetinaScaling: true
    }) as HTMLCanvasElement

    // 픽셀 처리용 캔버스
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = Math.max(1, Math.round(sourceCanvas.width))
    tempCanvas.height = Math.max(1, Math.round(sourceCanvas.height))
    const ctx = tempCanvas.getContext('2d')
    if (!ctx) throw new Error('캔버스 컨텍스트를 가져올 수 없습니다.')

    ctx.drawImage(sourceCanvas, 0, 0, tempCanvas.width, tempCanvas.height)

    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
    const data = imageData.data

    const fillRgb = this.hexToRgb(fillColor)
    const strokeRgb = this.hexToRgb(strokeColor)

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]
      if (a === 0) continue

      const isFill = this.isColorNear([r, g, b], fillRgb, tolerance)
      const isStroke = includeStroke && this.isColorNear([r, g, b], strokeRgb, tolerance)

      if (!(isFill || isStroke)) {
        // 유지 대상이 아니면 완전 투명 처리
        data[i + 3] = 0
      } else {
        // 유지 대상은 불투명 유지 (가급적 경계 보존)
        data[i + 3] = 255
      }
    }

    ctx.putImageData(imageData, 0, 0)

    const dataURL = tempCanvas.toDataURL('image/png')

    // 결과를 fabric.Image 로 래핑하여 반환 (원본 배치/스케일과 정렬)
    return await new Promise<fabric.Image>((resolve, reject) => {
      const dpr = (typeof window !== 'undefined' && (window as any).devicePixelRatio) ? (window as any).devicePixelRatio : 1
      console.log('dpr', dpr)
      fabric.Image.fromURL(
        dataURL,
        (img) => {
          if (!img) return reject(new Error('Failed to load image'))
          const center = object.getCenterPoint()
          img.set({
            id: uuid(),
            originX: 'center',
            originY: 'center',
            left: center.x,
            top: center.y,
            scaleX: (object.scaleX ?? 1) / (multiplier * dpr),
            scaleY: (object.scaleY ?? 1) / (multiplier * dpr),
            angle: object.angle,
            absolutePositioned: true,
            enableRetinaScaling: false,
          })
          resolve(img as any)
        },
        { id: uuid(), crossOrigin: 'anonymous' }
      )
    })
  }

  /**
   * shape(경로/다각형 등)에 대해 색상 마스크를 생성 → 그 마스크를 기반으로 경로를 추출(오프셋 패스)
   * - includeStroke=false: 내부 오프셋(채움색만)
   * - includeStroke=true: 외부 오프셋(채움+스트로크 포함)
   */
  async createOffsetPathFromShape(
    object: fabric.Object,
    opts?: {
      fillColor?: string
      includeStroke?: boolean
      strokeColor?: string
      stroke?: string
      strokeWidth?: number,
      multiplier?: number
    }
  ): Promise<fabric.Path | undefined> {
    // OpenCV 선행 로드 (createPrecisePathFromObject 가 사용) — 마스크 렌더 전에
    // 초기화를 시작해 미초기화 크래시/후행 대기를 방지 (멱등)
    await this.ensureCvReady()

    const maskImage = await this.extractMaskImageFromObject(object, opts)


    // 알파 기반 정밀 경로 추출 + 내부 오프셋(inset)
    const insetPx = Math.max(0, Math.round(opts?.strokeWidth ?? 0))
    const precise = await this.createPrecisePathFromObject(maskImage as unknown as fabric.Object, {
      threshold: 220,
      insetPx: opts?.includeStroke ? 0 : insetPx,
      smooth: true,
      multiplier: opts?.multiplier ?? 3
    })
    if (!precise) return undefined

    const path = (precise as fabric.Path).set({
      id: `${object.id}_outline`,
      extensionType: 'outline',
      absolutePositioned: true,
      originX: 'center',
      originY: 'center',
      fill: 'transparent',
      stroke: '#e30413',
      strokeWidth: 2,
      editable: false,
      strokeUniform: true,
      selectable: false,
      evented: false,
      enableRetinaScaling: false,
      scaleX: 1 / (opts?.multiplier ?? 3),
      scaleY: 1 / (opts?.multiplier ?? 3),
    }) as fabric.Path

    path.set({
      strokeWidth: path.width! * path.scaleX! * 0.01,
    })

    // 캔버스에 기존 outline 제거 후 추가 및 바인딩
    const prev = this._canvas
      .getObjects()
      .find((o) => o.extensionType === 'outline' && o.id === path.id)
    if (prev) this._canvas.remove(prev)
    this._canvas.add(path)
    this.bindWithOutline(object, path)
    this._canvas.renderAll()

    return path
  }

  /**
   * image 객체에 대해 오프셋 패스 생성 (이미지 칼선용)
   * - includeStroke=true: 외부 오프셋 (이미지 외곽선 확장)
   * - includeStroke=false: 내부 오프셋
   */
  async createOffsetPathFromImage(
    image: fabric.Image,
    opts?: {
      fillColor?: string
      includeStroke?: boolean
      strokeColor?: string
      stroke?: string
      strokeWidth?: number,
      multiplier?: number
    }
  ): Promise<fabric.Path | undefined> {
    // OpenCV 선행 로드 (createPrecisePathFromObject 가 사용) — 멱등
    await this.ensureCvReady()

    const multiplier = opts?.multiplier ?? 3
    const strokeWidthPx = Math.max(0, Math.round(opts?.strokeWidth ?? 0))

    // 이미지를 고해상도로 렌더링하여 마스크 생성
    const renderCanvas = (image as any).toCanvasElement({
      multiplier: multiplier,
      withoutTransform: true,
      enableRetinaScaling: true
    }) as HTMLCanvasElement

    // 마스크 이미지 생성 (알파 채널이 있는 이미지를 그대로 사용)
    const dataURL = renderCanvas.toDataURL('image/png')
    const maskImage = await new Promise<fabric.Image>((resolve, reject) => {
      const dpr = (typeof window !== 'undefined' && (window as any).devicePixelRatio) ? (window as any).devicePixelRatio : 1
      fabric.Image.fromURL(
        dataURL,
        (img) => {
          if (!img) return reject(new Error('Failed to load image'))
          const center = image.getCenterPoint()
          img.set({
            id: uuid(),
            originX: 'center',
            originY: 'center',
            left: center.x,
            top: center.y,
            scaleX: (image.scaleX ?? 1) / (multiplier * dpr),
            scaleY: (image.scaleY ?? 1) / (multiplier * dpr),
            angle: image.angle,
            absolutePositioned: true,
            enableRetinaScaling: false,
          })
          resolve(img as any)
        },
        { id: uuid(), crossOrigin: 'anonymous' }
      )
    })

    // 알파 기반 정밀 경로 추출
    // includeStroke=true이면 외부 오프셋이므로 insetPx를 음수로 (확장)
    // includeStroke=false이면 내부 오프셋이므로 insetPx를 양수로 (축소)
    const insetPx = opts?.includeStroke ? 0 : strokeWidthPx
    
    const precise = await this.createPrecisePathFromObject(maskImage as unknown as fabric.Object, {
      threshold: 220,
      insetPx: insetPx,
      smooth: true,
      multiplier: multiplier
    })
    
    if (!precise) return undefined

    // 기본 스케일만 설정하고, 나머지 속성은 호출하는 쪽에서 설정
    const path = (precise as fabric.Path).set({
      absolutePositioned: true,
      originX: 'center',
      originY: 'center',
      enableRetinaScaling: false,
      scaleX: 1 / multiplier,
      scaleY: 1 / multiplier,
    }) as fabric.Path

    return path
  }

  /**
   * 배경제거 모델(≈111MB) lazy 초기화 — 멱등.
   * - 동시 호출은 단일 in-flight promise 를 공유한다 (중복 다운로드 X).
   * - 실패 시 promise 를 리셋해 다음 호출에서 재시도 가능하다.
   * (D-6b①: 구 startService() 의 생성자 eager 실행을 대체)
   */
  ensureReady(): Promise<void> {
    if (!this.modelReadyPromise) {
      this.modelReadyPromise = this.initializeModel()
        .then(() => {
          this.modelReady = true
        })
        .catch((e) => {
          this.modelReadyPromise = null
          throw e
        })
    }
    return this.modelReadyPromise
  }

  /**
   * OpenCV(WASM ≈수 MB) lazy 초기화 — 칼선/크롭/윤곽 추출 등 OpenCV 만 쓰는
   * 경로가 88MB ONNX 모델을 받지 않도록 모델 초기화(ensureReady)와 분리 유지.
   * openCv.ts 의 module-level promise 캐시를 공유(멱등·실패 시 재시도 가능).
   */
  ensureCvReady(): Promise<any> {
    return getCv()
  }

  private async initializeModel(): Promise<void> {
    let isWebGLSupported = false
    try {
      const canvas = document.createElement('canvas')
      isWebGLSupported = !!(
        window.WebGLRenderingContext &&
        (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
      )
      console.log('WebGL supported:', isWebGLSupported)
    } catch {
      isWebGLSupported = false
    }

    const { preload } = await getBackgroundRemoval()
    await preload({
      ...this.config,
      device: isWebGLSupported ? 'gpu' : 'cpu'
    } as any)
    console.log('Asset preloading succeeded')
  }

  async processImage(img: HTMLImageElement, useStrict: boolean = false) {
    const cv = await this.ensureCvReady()
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2d context from canvas')
    }
    canvas.width = img.width
    canvas.height = img.height
    ctx.drawImage(img, 0, 0)

    // OpenCV processing
    const src = cv.imread(canvas)
    const rgbaPlanes = new cv.MatVector()
    cv.split(src, rgbaPlanes)

    const alpha = rgbaPlanes.get(3) // Alpha channel
    const binary = new cv.Mat()
    cv.threshold(alpha, binary, useStrict ? 218 : 20, 255, cv.THRESH_BINARY)

    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let x = Number.MAX_VALUE,
      y = Number.MAX_VALUE
    let x2 = 0,
      y2 = 0
    for (let i = 0; i < contours.size(); i++) {
      const rect = cv.boundingRect(contours.get(i))
      x = Math.min(x, rect.x)
      y = Math.min(y, rect.y)
      x2 = Math.max(x2, rect.x + rect.width)
      y2 = Math.max(y2, rect.y + rect.height)
    }

    // Add a small margin to ensure we don't cut off important parts
    const margin = 0 // Set to 0 for strict cropping, or adjust as needed
    const width = x2 - x - margin
    const height = y2 - y - margin

    // Ensure coordinates are within the image bounds
    x = Math.max(0, x + margin)
    y = Math.max(0, y + margin)

    const dst = src.roi(new cv.Rect(x, y, width, height))

    // to dataURL
    const dstCanvas = document.createElement('canvas')
    dstCanvas.width = width
    dstCanvas.height = height
    cv.imshow(dstCanvas, dst)

    // Clean up
    src.delete()
    rgbaPlanes.delete()
    alpha.delete()
    binary.delete()
    contours.delete()
    hierarchy.delete()
    dst.delete()

    return dstCanvas.toDataURL('image/png')
  }

  /**
   * 객체를 이미지로 변환하여 주변에 균등한 여백을 적용
   * @param objectPath 변환할 객체 경로
   * @param distance 적용할 여백 크기(픽셀)
   * @param multiplier 크기 배율(기본값: 1)
   * @returns Promise<fabric.Image> 변환된 이미지
   */
  async objAsImage(
    objectPath: fabric.Object,
    distance: number,
    multiplier: number = 1
  ): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      const width = (objectPath.width! * objectPath.scaleX! + distance) * multiplier
      const height = (objectPath.height! * objectPath.scaleY! + distance) * multiplier
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const context = canvas.getContext('2d')
      if (!context) {
        reject(new Error('Failed to get 2d context from canvas'))
        return
      }

      console.log('objToImage Size', width, height)

      /// add path as obj to canvas and screenshot canvas
      context.drawImage(
        objectPath.toCanvasElement({
          enableRetinaScaling: true
        }),
        0,
        0,
        width,
        height
      )

      const dataURL = canvas.toDataURL('image/png', 1)
      const scale = (objectPath.height! * objectPath.scaleY! + distance) / height
      fabric.Image.fromURL(
        dataURL,
        (img) => {
          resolve(img)
        },
        {
          id: uuid(),
          scaleX: scale,
          scaleY: scale
        }
      )
    })
  }

  /**
   * 직사각형 객체 주변에 일정 거리만큼 확장된 path를 생성
   * @param {fabric.Object} rect 원본 직사각형 객체
   * @param {number} distance 확장할 거리(픽셀)
   * @returns {fabric.Path} 확장된 path 객체
   */
  createExpandedPath(rect: fabric.Object, distance: number): fabric.Path {
    // 원본 직사각형 중심점과 크기 정보
    const centerPoint = rect.getCenterPoint()
    const width = rect.width * rect.scaleX
    const height = rect.height * rect.scaleY

    // 확장된 크기 계산
    const expandedWidth = width + distance
    const expandedHeight = height + distance

    // 확장된 사각형의 좌상단 좌표 (중심점 기준)
    const left = centerPoint.x - expandedWidth / 2
    const top = centerPoint.y - expandedHeight / 2

    // path 데이터 생성 (사각형 경로)
    const pathData = [
      ['M', left, top],
      ['L', left + expandedWidth, top],
      ['L', left + expandedWidth, top + expandedHeight],
      ['L', left, top + expandedHeight],
      ['Z']
    ]

    return new fabric.Path(pathData as any, {
      id: `${rect.id}_objectPath`,
      fill: 'black',
      strokeUniform: true,
      absolutePositioned: true,
      extensionType: 'clipping',
      stroke: '#e30413',
      strokeWidth: 1,
      originX: 'center',
      originY: 'center',
      left: centerPoint.x,
      top: centerPoint.y
    })
  }

  async getObjectPath(item: fabric.Object): Promise<fabric.Path | undefined> {
    // OpenCV 선행 로드 — getObjectPathData 내부에서도 보장되지만 공개 진입점에서 명시 (멱등)
    await this.ensureCvReady()
    const pathData = await this.getObjectPathData(item)
    if (!pathData) {
      console.error('Failed to generate path data')
      return
    }

    const objectPath = new fabric.Path(pathData, {
      id: `${item.id}_objectPath`,
      fill: 'black',
      strokeUniform: true,
      absolutePositioned: true,
      extensionType: 'clipping'
    })

    objectPath.hasControls = false
    objectPath.selectable = false
    objectPath.evented = false

    return objectPath as any
  }

  async getForeground(item: fabric.Object): Promise<fabric.Image> {
    if (item.type !== 'image') {
      return Promise.reject(new Error('Item is not an image'))
    }

    // 최초 사용 시 모델 초기화(모델+wasm 다운로드, 수 초)가 선행된다 —
    // 준비 단계임을 구분해 표시 (기존 longTask 오버레이 패턴 재사용,
    // canvas-core 는 editor 스토어를 모름 — 이벤트로만 통신).
    this._editor.emit('longTask:start', {
      message: this.modelReady ? '배경 제거 중...' : '배경 제거 도구 준비 중...'
    })

    try {
      // preload 실패는 구 startService 와 동일하게 non-fatal —
      // removeBackground 가 on-demand 다운로드로 폴백한다.
      await this.ensureReady().catch((e) => {
        console.warn('Asset preloading failed (on-demand fallback):', e)
      })
      this._editor.emit('longTask:start', { message: '배경 제거 중...' })

      const { removeBackground } = await getBackgroundRemoval()
      const imgElement: any = item.getElement()
      const foregroundBlob = await removeBackground(imgElement.src)
      const foregroundUrl = URL.createObjectURL(foregroundBlob)
      const foreground = await this.loadCanvasImageFromUrl(foregroundUrl)
      const center = item.getCenterPoint()
      const foregroundObj = foreground.set({
        id: uuid(),
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        width: item.width,
        height: item.height,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        absolutePositioned: true
      })
      return foregroundObj as any
    } catch (e) {
      console.error(e)
      throw e
    } finally {
      this._editor.emit('longTask:end')
    }
  }

  async getForegroundByAlpha(
    item: fabric.Object,
    color: string = '#000',
    alphaThreshold: number = 200
  ): Promise<fabric.Image> {
    if (item.type !== 'image') {
      return Promise.reject(new Error('Item is not an image'))
    }

    try {
      const sourceElement: HTMLImageElement | HTMLCanvasElement = (item as any).getElement()

      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = sourceElement.width
      tempCanvas.height = sourceElement.height
      const ctx = tempCanvas.getContext('2d')
      if (!ctx) throw new Error('캔버스 컨텍스트를 가져올 수 없습니다.')
      ctx.drawImage(sourceElement as CanvasImageSource, 0, 0)

      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
      const data = imageData.data

      const colorCanvas = document.createElement('canvas')
      const colorCtx = colorCanvas.getContext('2d')
      if (!colorCtx) throw new Error('색상 캔버스 컨텍스트를 가져올 수 없습니다.')
      colorCtx.fillStyle = color
      colorCtx.fillRect(0, 0, 1, 1)
      const [r, g, b] = Array.from(colorCtx.getImageData(0, 0, 1, 1).data)

      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]
        if (a >= alphaThreshold) {
          // 이제 전경으로 보던 부분을 완전 투명으로 전환
          data[i] = 0
          data[i + 1] = 0
          data[i + 2] = 0
          data[i + 3] = 0
        } else {
          // 투명해야 했던 부분을 단색으로 채움
          data[i] = r
          data[i + 1] = g
          data[i + 2] = b
          data[i + 3] = 255
        }
      }

      ctx.putImageData(imageData, 0, 0)

      const dataURL = tempCanvas.toDataURL('image/png')

      return await new Promise<fabric.Image>((resolve, reject) => {
        fabric.Image.fromURL(
          dataURL,
          (img) => {
            if (!img) return reject(new Error('Failed to load image'))
            const center = item.getCenterPoint()
            img.set({
              id: uuid(),
              originX: 'center',
              originY: 'center',
              left: center.x,
              top: center.y,
              scaleX: item.scaleX,
              scaleY: item.scaleY,
              absolutePositioned: true
            })
            resolve(img as any)
          },
          { id: uuid(), crossOrigin: 'anonymous' }
        )
      })
    } catch (e) {
      console.error(e)
      throw e
    }
  }

  clippingMask(activeObject: fabric.Object, imgObject: fabric.Object) {
    if (activeObject) {
      const center = activeObject.getCenterPoint()
      activeObject.set({
        absolutePositioned: true,
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        strokeLineCap: 'round',
        strokeLineJoin: 'round'
      })

      imgObject.set({
        top: activeObject.top,
        left: activeObject.left,
        originX: 'center',
        originY: 'center',
        scaleX: (activeObject.width! * activeObject.scaleX!) / imgObject.width!,
        scaleY: (activeObject.width! * activeObject.scaleX!) / imgObject.width!,
        clipPath: activeObject
      })

      this._canvas.add(imgObject)
      this._canvas.setActiveObject(imgObject)
      this._canvas.renderAll()

      console.log('clippingMask success')
    }
  }

  dispose() { }

  tellHasAlpha(image: HTMLCanvasElement): boolean {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Failed to get 2d context from canvas')
    }
    context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) {
        return true
      }
    }
    return false
  }

  async getObjectPathData(object: fabric.Object) {
    const cv = await this.ensureCvReady()
    const kSize = 1
    // 오브제가 path 인 경우 element 로 변환
    let imgElement: HTMLCanvasElement
    if (object.type === 'path') {
      const path = object as fabric.Path
      imgElement = await this.pathToElement(path)
    } else {
      imgElement = object.getElement()
    }

    console.log('imgElement', imgElement.width, imgElement.height)

    // 최종 추출된 좌표

    const hasAlpha = this.tellHasAlpha(imgElement)

    if (hasAlpha) {
      const binary = await this.preProcessImage(cv, imgElement, hasAlpha, kSize)
      const largestContour: [any, boolean] = this.findLargestContour(cv, binary)
      const points = await this.smoothContour(object, largestContour[0], largestContour[1])
      return this.generateCurvedPath(points, hasAlpha)
    } else {
      return this.createExpandedPath(object, 0).path
    }
  }

  loadCanvasImageFromUrl(url: string): Promise<fabric.Image> {
    return new Promise((resolve, reject) => {
      fabric.Image.fromURL(
        url,
        (img) => {
          if (img) {
            resolve(img)
          } else {
            reject(new Error('Failed to load image'))
            return
          }
        },
        {
          id: 'foregroundMask',
          left: 0,
          top: 0,
          scaleY: 1,
          scaleX: 1
        }
      )
    })
  }

  /**
   * 아이템과 모양틀 요소들(칼선 + + 아이콘)을 연결하여 모양틀 효과 적용
   * @param item 대상 객체 (shape)
   * @param path 칼선 경로
   * @param icon + 아이콘
   */
  bindWithMold(item: fabric.Object, path: fabric.Object, icon: fabric.Object) {
    const canvas = this._canvas

    // 아이템 설정
    item.setOptions({
      originX: 'center',
      originY: 'center',
      hasMolding: true
    })

    // 칼선과 아이콘 설정
    path.setOptions({
      originX: 'center',
      originY: 'center',
      left: item.left,
      top: item.top,
      evented: false
    })

    icon.setOptions({
      originX: 'center',
      originY: 'center',
      left: item.left,
      top: item.top,
      evented: false
    })

    item.setCoords()
    path.setCoords()
    icon.setCoords()

    canvas.discardActiveObject()
    canvas.renderAll()
    canvas.setActiveObject(item)

    // 모양틀 클릭 이벤트 바인딩
    this.bindMoldClickEvent(item as any)

      // 최신 path/icon 참조를 보관하여 재바인딩 시에도 동일 핸들러가 최신 참조를 사용
      ; (item as any)._moldBinding = {
        get path() {
          return path
        },
        set path(p: fabric.Object) {
          path = p
        },
        get icon() {
          return icon
        },
        set icon(i: fabric.Object) {
          icon = i
        }
      }

    if (!(item as any)._moldModifiedHandler) {
      const handler = () => {
        if (!(item as any).hasMolding) return
        const binding = (item as any)._moldBinding
        const bPath: fabric.Object = binding?.path
        const bIcon: fabric.Object = binding?.icon
        if (bPath) {
          bPath.setOptions({
            left: item.left,
            top: item.top,
            flipX: item.flipX,
            flipY: item.flipY,
            angle: item.angle,
            skewX: item.skewX,
            skewY: item.skewY,
            opacity: item.opacity,
            evented: false
          })
        }
        if (bIcon) {
          bIcon.setOptions({
            left: item.left,
            top: item.top,
            flipX: item.flipX,
            flipY: item.flipY,
            angle: item.angle,
            skewX: item.skewX,
            skewY: item.skewY,
            opacity: item.opacity,
            evented: false
          })
        }
        this._canvas.requestRenderAll()
      }
        ; (item as any)._moldModifiedHandler = handler
      // object-level modified 이벤트에 바인딩
      item.on('modified', handler)
    }
  }

  /**
   * 모양틀 클릭 이벤트 바인딩
   * @param shape 모양틀 객체
   */
  bindMoldClickEvent(shape: fabric.Object) {
    const canvas = this._canvas

    // 이미 이벤트가 바인딩된 경우 중복 바인딩 방지
    if ((shape as any)._moldClickBound) {
      return
    }
    (shape as any)._moldClickBound = true

    let isDragging = false
    let mouseDownTime = 0
    let mouseDownPos = { x: 0, y: 0 }

    // 마우스 다운 시 시간과 위치 기록
    shape.on('mousedown', (e) => {
      isDragging = false
      mouseDownTime = Date.now()
      const pointer = canvas.getPointer(e.e)
      mouseDownPos = { x: pointer.x, y: pointer.y }
    })

    // 마우스 이동 시 드래그 상태 확인
    shape.on('moving', () => {
      isDragging = true
    })

    // 마우스 업 시 클릭/드래그 구분하여 처리
    shape.on('mouseup', async (e) => {
      const mouseUpTime = Date.now()
      const timeDiff = mouseUpTime - mouseDownTime
      const pointer = canvas.getPointer(e.e)
      const distance = Math.sqrt(
        Math.pow(pointer.x - mouseDownPos.x, 2) + Math.pow(pointer.y - mouseDownPos.y, 2)
      )

      // 드래그가 아니고, 시간이 짧고, 거리가 짧으면 클릭으로 판단
      if (!isDragging && timeDiff < 300 && distance < 5) {
        await this.handleMoldClick(shape)
      }

      // 상태 초기화
      isDragging = false
    })
  }

  /**
   * 모양틀 클릭 처리
   * @param shape 클릭된 모양틀 객체
   */
  async handleMoldClick(shape: fabric.Object) {
    const canvas = this._canvas

    // 이미 채워진 이미지가 있는지 확인
    const filledImage = canvas
      .getObjects()
      .filter((obj) => obj.clipPath?.id === shape.id && obj.extensionType !== 'moldIcon')[0]

    if (filledImage) {
      return
    }

    try {
      // selectFiles 함수를 동적으로 import하여 사용
      const { selectFiles } = await import('../utils/utils')

      const files = await selectFiles({ accept: 'image/*', multiple: false })
      if (!files || files.length === 0) {
        return
      }

      const file = files[0]

      // core.fileToImage 방식 사용 (image.ts와 동일한 방식)
      const { core } = await import('../utils/canvas')
      const fabricImage = await core.fileToImage(canvas, file, this)
      if (!fabricImage) {
        console.log('이미지를 불러올 수 없습니다')
        return
      }

      // 이미지를 모양틀에 채우기
      const filledImageObject = await this.fillImageToMold(fabricImage as any, shape as any)

      canvas.add(filledImageObject)
      this._editor.getPlugin('ObjectPlugin')?.setUnchangeable()
      canvas.setActiveObject(filledImageObject)
      canvas.renderAll()
    } catch (error) {
      console.error('모양틀 이미지 채우기 오류:', error)
    }
  }

  /**
   * 이미지를 모양틀에 채우기
   * @param fore 전경 이미지
   * @param rear 후경 모양틀
   */
  async fillImageToMold(fore: fabric.Object, rear: fabric.Object): Promise<fabric.Object> {
    const centerOf = rear.getCenterPoint()
    rear.absolutePositioned = true
    fore.set({
      extensionType: 'fillImage',
      left: centerOf.x,
      top: centerOf.y,
      originX: 'center',
      originY: 'center',
      hasControls: true,
      absolutePositioned: true,
      scaleX: (rear.width! * rear.scaleX!) / fore.width!,
      scaleY: (rear.width! * rear.scaleX!) / fore.width!,
      id: rear.id + '_fillImage',
      clipPath: rear
    })
      ; (rear as any).fillImage = fore.id

    return fore
  }

  /**
   * 아이템과 외곽선 경로를 연결하여 칼선 효과 적용
   * @param item 대상 객체
   * @param path 외곽선 경로
   * @param distance 여백 크기
   */
  bindWithOutline(item: fabric.Object, path: fabric.Object) {
    const canvas = this._canvas

    // 아이템과 경로 모두 중앙 정렬로 설정
    item.set({
      hasCutting: true
    })

    
    path.set({
      originX: item.originX,
      originY: item.originY,
      left: item.left,
      top: item.top,
      angle: item.angle,
      flipX: item.flipX,
      flipY: item.flipY,
      evented: false
    })
    path.setPositionByOrigin(item.getCenterPoint(),'center', 'center')

    item.setCoords()
    path.setCoords()

    canvas.discardActiveObject()
    canvas.requestRenderAll()
    canvas.setActiveObject(item)

      // 최신 path 참조 보관 + object-level modified 핸들러 단일 유지
      ; (item as any)._cutBinding = {
        get path() {
          return path
        },
        set path(p: fabric.Object) {
          path = p
        }
      }

    if (!(item as any)._cutModifiedHandler) {
      const handler = () => {
        if (!(item as any).hasCutting) return
        const binding = (item as any)._cutBinding
        const bPath: fabric.Object = binding?.path
        if (bPath) {
          bPath.setOptions({
            left: item.left,
            top: item.top,
            flipX: item.flipX,
            flipY: item.flipY,
            angle: item.angle,
            skewX: item.skewX,
            skewY: item.skewY,
            opacity: item.opacity,
            evented: false
          })
          bPath.setPositionByOrigin(item.getCenterPoint(),'center', 'center')
          this._canvas.requestRenderAll()
        }
      }
      (item as any)._cutModifiedHandler = handler
      item.on('modified', handler)
    }
  }

  afterLoad(...args): Promise<void> {
    const hasCuttings = this._canvas.getObjects().filter((item) => item.hasCutting)
    const hasMoldings = this._canvas.getObjects().filter((item) => item.hasMolding)

    // 칼선 바인딩
    for (const item of hasCuttings) {
      const objects = this._canvas.getObjects()
      // id 우선 탐색 후, extensionType 보조 탐색
      const path =
        objects.find((obj) => obj.id === `${item.id}_outline`) ||
        objects.find((obj) => obj.extensionType === 'outline' && obj.id === `${item.id}_outline`)
      if (!path) {
        console.error('Failed to find path object')
        continue
      }

      console.log('bindWithOutline', item, path)
      this.bindWithOutline(item, path)
    }

    // 모양틀 바인딩
    for (const item of hasMoldings) {
      const objects = this._canvas.getObjects()
      const path = objects.find((obj) => obj.id === `${item.id}_outline`)
      const icon = objects.find((obj) => obj.id === `${item.id}_moldIcon`)

      if (!path || !icon) {
        console.error('Failed to find mold objects (path or icon)')
        continue
      }

      console.log('bindWithMold', item, path, icon)
      this.bindWithMold(item, path, icon)
    }

    // afterLoad 시에도 모든 모양틀에 클릭 이벤트 바인딩
    this.bindAllMoldClickEvents()

    return super.afterLoad(...args)
  }

  /**
   * PDF 저장 등 afterSave 훅에서 모양틀/칼선 바인딩과 클릭 이벤트를 재등록
   */
  afterSave(...args): Promise<void> {
    try {
      // 칼선 바인딩 재적용
      const hasCuttings = this._canvas.getObjects().filter((item) => (item as any).hasCutting)
      for (const item of hasCuttings) {
        const objects = this._canvas.getObjects()
        const path =
          objects.find((obj) => obj.id === `${item.id}_outline`) ||
          objects.find((obj) => (obj as any).extensionType === 'outline' && obj.id === `${item.id}_outline`)
        if (path) {
          this.bindWithOutline(item as any, path as any)
        }
      }

      // 모양틀 바인딩 및 클릭 이벤트 재등록
      const hasMoldings = this._canvas.getObjects().filter((item) => (item as any).hasMolding)
      for (const item of hasMoldings) {
        const objects = this._canvas.getObjects()
        const path = objects.find((obj) => obj.id === `${item.id}_outline`)
        const icon = objects.find((obj) => obj.id === `${item.id}_moldIcon`)
        if (path && icon) {
          this.bindWithMold(item as any, path as any, icon as any)
        }
      }

      this.bindAllMoldClickEvents()

      // 캔버스 다시 렌더링
      this._canvas.requestRenderAll()
    } catch (e) {
      console.warn('afterSave 재바인딩 중 오류:', e)
    }

    return new Promise((r) => r(...args))
  }

  /**
   * 모든 모양틀 객체에 클릭 이벤트 바인딩
   */
  bindAllMoldClickEvents() {
    const moldShapes = this._canvas.getObjects().filter((obj) => obj.hasMolding)

    for (const shape of moldShapes) {
      this.bindMoldClickEvent(shape)
    }
  }

  async createPrecisePathFromObject(
    object: fabric.Object,
    opts?: {
      threshold?: number // 알파 임계값(기본 225)
      insetPx?: number // 안쪽으로 당길 픽셀(기본 2)
      smooth?: boolean // 곡선 보간(기본 true)
      multiplier?: number // 크기 배율(기본 1)
    }
  ): Promise<fabric.Path | undefined> {
    const cv = await this.ensureCvReady()
    const threshold = opts?.threshold ?? 225
    const insetPx = Math.max(0, opts?.insetPx ?? 2)
    const smooth = opts?.smooth ?? true

    const element = object.toCanvasElement({
      multiplier: (opts?.multiplier ?? 1),
      withoutTransform: true,
      enableRetinaScaling: false,
    }) as HTMLCanvasElement

    const src = cv.imread(element)
    const planes = new cv.MatVector()
    cv.split(src, planes)
    const alpha = planes.get(3)
    const bin = new cv.Mat()
    cv.threshold(alpha, bin, threshold, 255, cv.THRESH_BINARY)

    const dist = new cv.Mat()
    cv.distanceTransform(bin, dist, cv.DIST_L2, 3)
    const dist8u = new cv.Mat()
    const insetMask = new cv.Mat()
    cv.threshold(dist, insetMask, insetPx, 255, cv.THRESH_BINARY)
    insetMask.convertTo(dist8u, cv.CV_8U)

    const [contourMat] = this.findLargestContour(cv, dist8u)

    const m = object.calcTransformMatrix()
    const points: [number, number][] = []
    for (let j = 0; j < contourMat.data32S.length; j += 2) {
      const x = contourMat.data32S[j]
      const y = contourMat.data32S[j + 1]
      const world = fabric.util.transformPoint(new fabric.Point(x, y), m)
      points.push([world.x, world.y])
    }
    const pathData = this.generateCurvedPath(points, smooth)

    src.delete()
    planes.delete()
    alpha.delete()
    bin.delete()
    dist.delete()
    insetMask.delete()
    dist8u.delete()
    contourMat.delete()

    if (!pathData) return undefined

    // The path is created with absolute coordinates, so we need to position it at 0,0
    const path = new fabric.Path(pathData, {
      id: uuid(),
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
      scaleX: object.scaleX! / (opts?.multiplier ?? 1),
      scaleY: object.scaleY! / (opts?.multiplier ?? 1),
    })

    return path
  }

  /**
   * fabric.Object를 특정 색상으로 채우고 새로운 객체를 반환하는 함수
   * 투명 부분은 유지되며 배경색이 없는 경우에는 비투명 부분만 채움
   *
   * @param object 원본 fabric.Object
   * @param color 채울 색상 (CSS 색상 문자열)
   * @returns Promise<fabric.Object> 색상이 채워진 새 fabric.Object
   */
  fillObjectWithColor(object: fabric.Object, color: string): Promise<fabric.Object> {
    return new Promise((resolve, reject) => {
      try {
        // 객체를 캔버스에 렌더링하여 이미지로 변환
        const tempCanvas = document.createElement('canvas')

        // 객체 크기 계산
        const width = object.width! * object.scaleX!
        const height = object.height! * object.scaleY!

        tempCanvas.width = width
        tempCanvas.height = height

        const tempContext = tempCanvas.getContext('2d')
        if (!tempContext) {
          reject(new Error('캔버스 컨텍스트를 가져올 수 없습니다.'))
          return
        }

        // 객체의 이미지 데이터 가져오기
        const objectCanvas = object.toCanvasElement({
          multiplier: 1,
          withoutTransform: true,
          withoutShadow: false,
          enableRetinaScaling: true
        })

        // 이미지 데이터를 임시 캔버스에 그리기
        tempContext.drawImage(objectCanvas, 0, 0, width, height)

        // 픽셀 데이터 가져오기
        const imageData = tempContext.getImageData(0, 0, width, height)
        const data = imageData.data

        // 색상 파싱
        const colorCanvas = document.createElement('canvas')
        const colorContext = colorCanvas.getContext('2d')
        if (!colorContext) {
          reject(new Error('색상 캔버스 컨텍스트를 가져올 수 없습니다.'))
          return
        }

        colorContext.fillStyle = color
        colorContext.fillRect(0, 0, 1, 1)
        const colorData = colorContext.getImageData(0, 0, 1, 1).data

        // 픽셀 데이터 수정 - 투명도는 유지하면서 색상만 변경
        for (let i = 0; i < data.length; i += 4) {
          // 알파 채널이 0이 아닌 경우에만 색상 변경 (투명한 부분은 건너뛰기)
          if (data[i + 3] > 0) {
            data[i] = colorData[0] // R
            data[i + 1] = colorData[1] // G
            data[i + 2] = colorData[2] // B
            // 알파 채널(data[i + 3])은 원래 값을 유지
          }
        }

        // 수정된 이미지 데이터를 캔버스에 다시 그리기
        tempContext.putImageData(imageData, 0, 0)

        // 결과 캔버스를 데이터 URL로 변환
        const dataURL = tempCanvas.toDataURL('image/png')

        // 새 이미지 객체 생성
        fabric.Image.fromURL(dataURL, (img) => {
          // 원본 객체의 속성 복사
          img.set({
            left: object.left,
            top: object.top,
            angle: object.angle,
            originX: object.originX,
            originY: object.originY,
            flipX: object.flipX,
            flipY: object.flipY,
            opacity: object.opacity,
            scaleX: 1,
            scaleY: 1
          })

          // 필요한 경우 object의 추가 속성 복사
          if (object.id) img.id = object.id
          if (object.name) img.name = object.name
          if (object.clipPath) img.clipPath = object.clipPath

          resolve(img as any)
        })
      } catch (error) {
        reject(error)
      }
    })
  }

  private pathToElement(path: fabric.Path): Promise<HTMLCanvasElement> {
    return new Promise((resolve, reject) => {
      const url = path.toDataURL({
        format: 'png',
        multiplier: 1
      })

      const imageElement = new Image()
      imageElement.src = url

      imageElement.onload = () => {
        const htmlCanvasElement = document.createElement('canvas')
        htmlCanvasElement.width = imageElement.width
        htmlCanvasElement.height = imageElement.height

        const context = htmlCanvasElement.getContext('2d')
        if (!context) {
          reject(new Error('Failed to get 2d context from canvas'))
          return
        }
        context.drawImage(imageElement, 0, 0)

        resolve(htmlCanvasElement)
      }
    })
  }

  // D3.js를 사용하여 곡선 경로 생성
  private generateCurvedPath(
    points: [number, number][] | Iterable<[number, number]>,
    curved: boolean
  ) {
    // curved true이고 포인트가 많을경우 2의 배수인 인덱스만사용 사용
    // TODO: 인접한지 고려해야함
    // if (curved && Array.isArray(points) && points.length > 100) {
    //   points = points.filter((_, index) => index % 2 === 0)
    // }
    const line = d3
      .line<[number, number]>()
      .x((d) => d[0])
      .y((d) => d[1])
      .curve(curved ? d3.curveBasisClosed : d3.curveLinearClosed)

    return line(points)
  }

  private getSimpleContourPoints(cv: any, object: fabric.Object, binary: any): [number, number][] {
    const points: [number, number][] = []
    // Find contours
    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    // Assuming we want the largest contour from the new set of contours
    let largestContour = null
    let largestArea = 0
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i)
      const area = cv.contourArea(contour)
      if (area > largestArea) {
        largestArea = area
        largestContour = contour
      }
    }

    if (!largestContour) {
      throw new Error('Failed to find largest contour')
    }

    for (let j = 0; j < largestContour.data32S.length; j += 2) {
      const x = largestContour.data32S[j]
      const y = largestContour.data32S[j + 1]
      points.push([
        (x + object.left!) * (object.scaleX ?? 1),
        (y + object.top!) * (object.scaleY ?? 1)
      ])
    }

    binary.delete()
    contours.delete()
    hierarchy.delete()

    return points
  }

  // 추출된 윤곽선을 부드럽게 만든 후 포인터 반환
  private async smoothContour(
    object: fabric.Object,
    contour: any,
    useHull: boolean
  ): Promise<[number, number][]> {
    const cv = await this.ensureCvReady()
    const simplified = { delete: () => {} }
    const tempContour = { delete: () => {} }

    // 더글라스 피커 알고리즘 적용으로 다각형 근사화
    try {
      if (contour.rows === 0 || contour.cols !== 1) {
        console.error('Invalid contour')
      }

      if (contour.type() !== cv.CV_32SC2) {
        console.error('Invalid contour type')
      }
      console.log('useHull', useHull)

      const result = contour

      if (contour.rows === 0) {
        console.error('Failed to simplify contour')
      }

      const points: [number, number][] = []

      for (let j = 0; j < result.data32S.length; j += 2) {
        const x = result.data32S[j]
        const y = result.data32S[j + 1]

        const currentX = (x + object.left!) * (object.scaleX ?? 1)
        const currentY = (y + object.top!) * (object.scaleY ?? 1)

        const nearThreshold = 1.5 * object.scaleY!
        // 현재 좌표와 이전 좌표의 거리가 1 이상일 경우만 추가
        if (
          points.length === 0 ||
          Math.hypot(
            currentX - points[points.length - 1][0],
            currentY - points[points.length - 1][1]
          ) > nearThreshold
        ) {
          points.push([currentX, currentY])
        }
      }
      return points
    } catch (error) {
      console.error('Error in smoothContour:', error)
      return []
    } finally {
      contour.delete()
      simplified.delete()
      tempContour.delete()
    }
  }

  // 그레이로 변환 후 노이즈 제거 및 이진화
  private async preProcessImage(cv: any, imgElement: HTMLCanvasElement, hasAlpha: boolean, kSize: number): Promise<any> {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get 2d context from canvas')
    }
    canvas.width = imgElement.width
    canvas.height = imgElement.height
    ctx.drawImage(imgElement, 0, 0)

    const src = cv.imread(canvas)
    const gray = new cv.Mat()
    cv.cvtColor(src, gray, cv.COLOR_BGR2GRAY)

    const blur = new cv.Mat()
    if (hasAlpha) {
      cv.GaussianBlur(gray, blur, new cv.Size(kSize, kSize), 0)
    }

    const binary = new cv.Mat()
    cv.threshold(!hasAlpha ? gray : blur, binary, 0, 255, cv.THRESH_BINARY)

    src.delete()
    gray.delete()
    blur.delete()

    return binary
  }

  // 윤곽선 생성 후 모든 윤곽선을 덮는 최대 윤곽선을 그려서 반환
  private findLargestContour(cv: any, binary: any): [any, boolean] {
    // Find all contours
    const contours = new cv.MatVector()
    const hierarchy = new cv.Mat()
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    // Collect all contours with their areas
    const contourAreas: { contour: any; area: number }[] = []
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i)
      const area = cv.contourArea(contour)
      console.log('contour area', area)
      // Filter out small contours
      if (area > 1000) {
        contourAreas.push({ contour, area })
      }
    }

    // Sort contours by area in descending order
    contourAreas.sort((a, b) => b.area - a.area)

    const size = contourAreas.length
    const useHull = size > 1
    // Select the largest n contours
    const n = useHull ? size : 1
    const selectedContours = contourAreas.slice(0, n)

    // Combine selected contours into one set of points
    const points: [number, number][] = []
    selectedContours.forEach(({ contour }) => {
      for (let j = 0; j < contour.rows; j++) {
        points.push([contour.data32S[j * 2], contour.data32S[j * 2 + 1]])
      }
    })

    contours.delete()
    hierarchy.delete()

    if (useHull) {
      // Convert points to a Mat
      const pointsMat = cv.matFromArray(points.length, 1, cv.CV_32SC2, points.flat())
      // Find the convex hull
      const hull = new cv.Mat()
      cv.convexHull(pointsMat, hull, false, true)
      pointsMat.delete()

      return [hull, true]
    } else {
      return [cv.matFromArray(points.length, 1, cv.CV_32SC2, points.flat()), false]
    }
  }

  /**
   * 케이스 clipPath 적용 결과에서 '보이는 부분'만 외곽선 생성
   * @param object 대상 객체
   * @param opts 옵션
   */
  async drawCaseOutlinePrecise(
    object: fabric.Object,
    opts?: {
      threshold?: number // 알파 임계값(기본 225)
      insetPx?: number // 안쪽으로 당길 픽셀(기본 2)
      smooth?: boolean // 곡선 보간(기본 true)
      stroke?: string // 라인색
      strokeWidth?: number // 라인두께
    }
  ): Promise<fabric.Path | undefined> {
    const cv = await this.ensureCvReady()
    const threshold = opts?.threshold ?? 225
    const insetPx = Math.max(0, opts?.insetPx ?? 2)
    const smooth = opts?.smooth ?? true

    // 1) 보이는 모습 그대로 렌더(clip 포함) → 알파 마스크 얻기
    const element = object.toCanvasElement({
      multiplier: 1,
      withoutTransform: true,
      enableRetinaScaling: true
    }) as HTMLCanvasElement

    // 2) 알파 기반 이진화
    const src = cv.imread(element)
    const planes = new cv.MatVector()
    cv.split(src, planes)
    const alpha = planes.get(3)
    const bin = new cv.Mat()
    cv.threshold(alpha, bin, threshold, 255, cv.THRESH_BINARY)

    // 3) 거리 변환으로 '정확한 안쪽 오프셋' 적용
    const dist = new cv.Mat()
    cv.distanceTransform(bin, dist, cv.DIST_L2, 3)
    const dist8u = new cv.Mat()
    // insetPx 만큼 안쪽으로 당기기: 거리 >= insetPx 인 픽셀만 유지
    const insetMask = new cv.Mat()
    cv.threshold(dist, insetMask, insetPx, 255, cv.THRESH_BINARY)
    insetMask.convertTo(dist8u, cv.CV_8U)

    // 4) 가장 큰 윤곽선 찾기
    const [contourMat] = this.findLargestContour(cv, dist8u)

    // 5) 좌표 변환(회전/왜곡 보정)
    const m = object.calcTransformMatrix()
    const points: [number, number][] = []
    for (let j = 0; j < contourMat.data32S.length; j += 2) {
      const x = contourMat.data32S[j]
      const y = contourMat.data32S[j + 1]
      // 로컬 좌표를 월드(전역) 좌표로 변환
      const world = fabric.util.transformPoint(new fabric.Point(x, y), m)
      points.push([world.x, world.y])
    }
    const pathData = this.generateCurvedPath(points, smooth)

    // 메모리 정리
    src.delete()
    planes.delete()
    alpha.delete()
    bin.delete()
    dist.delete()
    insetMask.delete()
    dist8u.delete()
    contourMat.delete()

    if (!pathData) {
      return
    }

    const path = new fabric.Path(pathData, {
      id: `${object.id}_outline`,
      extensionType: 'outline',
      absolutePositioned: true,
      originX: 'left',
      originY: 'top',
      left: 0,
      top: 0,
      fill: '',
      stroke: opts?.stroke ?? '#111',
      strokeWidth: opts?.strokeWidth ?? 1.5,
      strokeUniform: true,
      selectable: false,
      evented: false
    })

    // 기존 outline 제거 후 바인딩
    const prev = this._canvas
      .getObjects()
      .find((o) => o.extensionType === 'outline' && o.id === path.id)
    if (prev) this._canvas.remove(prev)
    this._canvas.add(path)
    this.bindWithOutline(object, path)
    this._canvas.renderAll()
    return path
  }

}

export default ImageProcessingPlugin
