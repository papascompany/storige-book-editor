import { fabric } from 'fabric'
import Editor from '../Editor'
import { PluginBase, PluginOption } from '../plugin'
import { pxToMmDisplay } from '../utils/math'

/**
 * ImageDpiWarningPlugin (R8) — 배치 이미지 유효 DPI 실시간 경고
 *
 * object:added / object:modified 시 fabric.Image 계열 사용자 객체의 **유효 DPI**
 * (원본 픽셀 ÷ 인쇄 크기 inch)를 계산해, 인쇄 최소 기준(기본 150DPI) 미만으로
 * **진입하는 전이**에서만 `imageLowDpi` 이벤트를 1회 발행한다 — canvas-core 는
 * editor 스토어에 직접 의존하지 않으므로 토스트는 editor 쪽 구독
 * (useImageLowDpiToast)이 담당한다(SafeZoneWarningPlugin `safeZoneViolation`
 * → useSafeZoneWarningToast 브리지 전례 준용).
 *
 * - mm 환산은 기존 좌표 유틸(pxToMmDisplay — 150dpi 표시 규약, getUnitSize 계열)을
 *   **재사용**한다(신규 환산식 발명 금지). 유효 DPI = 원본px ÷ (표시 mm ÷ 25.4).
 * - 디바운스: 객체별 저해상 상태를 추적해 **진입 전이에서만 1회** 발행 —
 *   저해상 유지 중 반복 modified 무발화, 회복(축소) 후 재진입이면 다시 1회.
 * - 대상: 사용자 이미지 객체(type 'image'). **배경 이미지는 인쇄되므로 포함**
 *   (SafeZoneWarningPlugin 과 달리 'background' 를 제외하지 않는다).
 *   workspace/clipping/guideline/overlay/cutline-template/frame(액자 장식)과
 *   excludeFromExport·meta.system(비인쇄 시스템 객체)은 제외.
 * - 직렬화 무영향: 객체 속성 write 없음 — 순수 read + 이벤트만.
 * - 원본 픽셀은 `_originalElement`(필터 적용 후 getElement 가 축소 canvas 를
 *   반환하는 함정 회피) 우선, 없으면 getElement() 의 naturalWidth/Height.
 *   엘리먼트 미로드(natural 0)면 판정 보류(상태 오염 없음 — 로드 후 재판정).
 */

export interface ImageDpiWarningOptions extends PluginOption {
  /** 인쇄 최소 유효 DPI 임계값 — 기본 150 */
  minDpi?: number
}

export interface ImageLowDpiPayload {
  /** 판정된 유효 DPI (가로/세로 축 중 최악값, 반올림) */
  dpi: number
  objectId?: string
}

const DEFAULT_MIN_DPI = 150
const MM_PER_INCH = 25.4

/** 인쇄물이 아니거나 사용자 배치 대상이 아닌 id (SafeZoneWarningPlugin 정책 준용, 배경 제외 없음) */
const EXCLUDED_IDS = new Set(['workspace', 'cutline-template'])
/** 제외 extensionType — 시스템/가이드/장식(액자 PNG). 'background' 는 인쇄되므로 **미포함** */
const EXCLUDED_EXTENSION_TYPES = new Set(['clipping', 'guideline', 'overlay', 'frame'])

/**
 * 유효 DPI 계산 (순수 함수) — 원본 픽셀 ÷ 표시 크기(mm→inch).
 * 표시 px 는 캔버스 150dpi 표시 규약이므로 pxToMmDisplay 로 mm 환산 후 inch 로 나눈다.
 * 가로/세로 중 **최악(작은) 축**을 반환 — 한 축만 확대돼도 그 축 화질이 깨진다.
 * 원본/표시 크기가 유효하지 않으면 null (판정 보류).
 */
export function computeEffectiveDpi(
  naturalWidth: number,
  naturalHeight: number,
  displayWidthPx: number,
  displayHeightPx: number
): number | null {
  if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null
  const widthMm = pxToMmDisplay(displayWidthPx)
  const heightMm = pxToMmDisplay(displayHeightPx)
  if (!(widthMm > 0) || !(heightMm > 0)) return null
  const dpiX = naturalWidth / (widthMm / MM_PER_INCH)
  const dpiY = naturalHeight / (heightMm / MM_PER_INCH)
  return Math.round(Math.min(dpiX, dpiY))
}

type FabricEventHandler = (e: fabric.IEvent) => void

class ImageDpiWarningPlugin extends PluginBase {
  name = 'ImageDpiWarningPlugin'
  events: string[] = ['imageLowDpi']
  hotkeys = []

  private _minDpi: number

  /**
   * 객체별 저해상 상태 — 진입 전이에서만 발행하기 위한 추적.
   * WeakMap: loadFromJSON/삭제로 교체된 객체 참조는 GC 에 위임(수동 청소 불필요).
   */
  private _lowState: WeakMap<fabric.Object, boolean> = new WeakMap()

  private _boundCheck: FabricEventHandler | null = null

  constructor(canvas: fabric.Canvas, editor: Editor, options: ImageDpiWarningOptions = {}) {
    super(canvas, editor, options)
    this._minDpi = options.minDpi ?? DEFAULT_MIN_DPI
    this._init()
  }

  private _init(): void {
    this._boundCheck = this._handleCheck.bind(this)
    this._canvas.on('object:added', this._boundCheck)
    this._canvas.on('object:modified', this._boundCheck)
  }

  /** 경고 대상이 아닌 객체(비이미지/시스템/가이드/장식) 판정 — 배경은 대상에 포함 */
  private _isExcludedTarget(obj: fabric.Object): boolean {
    const o = obj as fabric.Object & {
      extensionType?: string
      meta?: { system?: boolean }
    }
    if (obj.type !== 'image') return true
    if (o.meta?.system) return true
    if (obj.excludeFromExport === true) return true
    if (obj.id && EXCLUDED_IDS.has(obj.id)) return true
    if (o.extensionType && EXCLUDED_EXTENSION_TYPES.has(o.extensionType)) return true
    return false
  }

  /**
   * 원본 픽셀 크기 — _originalElement 우선(필터 적용 시 getElement 가 필터 결과
   * canvas 를 반환하는 함정 회피), naturalWidth 부재(canvas 엘리먼트)면 width 폴백.
   */
  private _resolveSourceSize(obj: fabric.Object): { width: number; height: number } | null {
    const img = obj as unknown as fabric.Image & {
      _originalElement?: HTMLImageElement | HTMLCanvasElement
    }
    const element =
      img._originalElement ?? (typeof img.getElement === 'function' ? img.getElement() : undefined)
    if (!element) return null
    const el = element as Partial<HTMLImageElement>
    const width = el.naturalWidth || el.width || 0
    const height = el.naturalHeight || el.height || 0
    if (!(width > 0) || !(height > 0)) return null
    return { width, height }
  }

  private _handleCheck(e: fabric.IEvent): void {
    const target = e.target
    if (!target || this._isExcludedTarget(target)) return

    const source = this._resolveSourceSize(target)
    if (!source) return // 엘리먼트 미로드 등 — 판정 보류 (상태 오염 없음)

    const dpi = computeEffectiveDpi(
      source.width,
      source.height,
      target.getScaledWidth(),
      target.getScaledHeight()
    )
    if (dpi === null) return

    const low = dpi < this._minDpi
    const wasLow = this._lowState.get(target) === true
    if (low && !wasLow) {
      // 저해상 진입 전이 — 1회 발행 (유지 중 무발화, 회복 후 재진입이면 다시 1회)
      const payload: ImageLowDpiPayload = {
        dpi,
        objectId: (target as fabric.Object & { id?: string }).id,
      }
      this._editor.emit('imageLowDpi', payload)
    }
    this._lowState.set(target, low)
  }

  dispose(): void {
    if (this._boundCheck) {
      this._canvas.off('object:added', this._boundCheck)
      this._canvas.off('object:modified', this._boundCheck)
      this._boundCheck = null
    }
    this._lowState = new WeakMap()
  }
}

export default ImageDpiWarningPlugin
