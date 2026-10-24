import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import {
  core,
  ImageProcessingPlugin,
  selectFiles,
  SelectionType,
  frameInsetScale,
  mmToPxDisplay,
  pxToMmDisplay,
  resolveFrameWindowFor,
  FRAME_INSET_PX_RUNTIME_KEY,
  FRAME_WINDOW_RUNTIME_KEY,
  PHOTO_PRINT_BLEED_PX_RUNTIME_KEY,
  type FrameWindow,
} from '@storige/canvas-core'
import type { fabric } from 'fabric'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useExternalPhotosStore } from '@/stores/useExternalPhotosStore'
import { storageApi } from '@/api'
import { requestCutout } from '@/api/cutout'
import { CUTTING_LINE_CONFIG } from '@/constants/cutting'
import { showToast } from '@/stores/useToastStore'
import { parsePhotoExif } from '@/utils/photoAutofill'
import { resolveAssetUrl } from '@/utils/resolveAssetUrl'
import type { UploadedPhotoMeta } from '@/utils/photoPlacement'
import { isPhotoPrintProfile } from '@/utils/productProfile'
import { checkPhotoPrintUploadLimit } from '@/utils/photoPrintUpload'
import { applyPhotoPrintForCanvas, resolvePhotoItemIndexForCanvas } from '@/utils/photoPrintRehydrate'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'

// Feature flag for image processing (OpenCV) features
const ENABLE_IMAGE_PROCESSING = import.meta.env.VITE_ENABLE_IMAGE_PROCESSING !== 'false'

// 모바일/터치 환경에서는 retina(DPR=3) 캔버스에 대용량 이미지 추가 시 메모리 hit이 매우 큼.
// 4MB 이상 파일은 사전 차단해 iOS Safari 페이지 크래시 방지 (P0-2 사용자 보고 대응).
function isTouchEnv(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  try { return window.matchMedia('(pointer: coarse)').matches } catch { return false }
}
const TOUCH_ENV = isTouchEnv()
const MOBILE_MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB
const MOBILE_MAX_FILE_LABEL = '4MB'

/**
 * 모바일 환경에서 파일 크기 사전 가드.
 * - 데스크톱: 항상 허용
 * - 모바일: MOBILE_MAX_FILE_BYTES 초과 시 toast 안내 + false 반환 (호출자가 abort)
 *
 * D-6b② (2026-08-05): 모양컷(AppClipping) 업로드 경로에도 배선하기 위해 export —
 * Wave0 실측에서 이 경로만 가드가 없어 12MP 원본이 배경제거 파이프에 직행했다.
 */
export function checkMobileFileSize(file: File): boolean {
  if (!TOUCH_ENV) return true
  if (file.size <= MOBILE_MAX_FILE_BYTES) return true
  const sizeMb = (file.size / 1024 / 1024).toFixed(1)
  showToast(
    `이미지가 너무 큽니다 (${sizeMb}MB). 모바일에선 ${MOBILE_MAX_FILE_LABEL} 이하만 지원합니다. 갤러리에서 더 작은 파일을 선택해주세요.`,
    'error',
    5000
  )
  return false
}

// ─── P2-d 사진인화 (2026-10-19) 보조 — 프로파일 NULL 세트에서는 전부 no-op/바이트 동일 ───────────────

/** 사진인화 세트인지(업로드 한도·촬영일 기록·옵션 재적용 게이트) */
function isPhotoPrintSession(): boolean {
  return isPhotoPrintProfile(useSettingsStore.getState().productProfile)
}

/**
 * B11 (2026-10-25): 상품 프로파일이 있는 세트인지(캘린더·사진인화 등 — `resolveProductProfile` 판정 결과가 non-null).
 * 틀 클릭 채움을 storage 업로드 URL 로 넣는 게이트 — 세트 종류가 아니라 프로파일 존재(데이터 속성)로만 판정한다.
 */
function hasProductProfileSession(): boolean {
  return !!useSettingsStore.getState().productProfile
}

/** 업로드 한도 판정용 현재 사진 수 — 내 업로드(객체·메타 중 큰 값) + 외부 주입 사진 */
function currentPhotoCountForLimit(uploaded: unknown[], uploadedPhotoMeta: UploadedPhotoMeta[]): number {
  return Math.max(uploaded.length, uploadedPhotoMeta.length) + useExternalPhotosStore.getState().photos.length
}

/** 업로드 한도 판정용 현재 사진 수 — 다른 업로드 진입점(AppClipping 모양컷·AppEdit 배경·자동배치)이 쓴다 */
export function currentPhotoPrintPhotoCount(): number {
  const s = useImageStore.getState()
  return currentPhotoCountForLimit(s.uploaded, s.uploadedPhotoMeta)
}

/** 사진틀 채움 기하 — 마스크 창(window)의 프레임 대비 비율·중심과 fit 모드 */
export interface FrameFillGeometry {
  /** fitMode 미설정(legacy·프로파일 NULL 세트): 종전 산식(벡터 틀 폭 기준 / image 틀 max 비율)·프레임 중심 그대로 */
  legacy: boolean
  contain: boolean
  sx: number
  sy: number
  cx: number
  cy: number
  /** 창 크기(px) = 프레임 × (sx, sy) */
  winW: number
  winH: number
}

function isFrameWindow(v: unknown): v is FrameWindow {
  if (typeof v !== 'object' || v === null) return false
  const w = v as Record<string, unknown>
  return ['sx', 'sy', 'cx', 'cy'].every((k) => typeof w[k] === 'number' && Number.isFinite(w[k] as number))
}

/** 런타임 유테 px(`__frameInsetPx`, PhotoPrintPlugin.apply 가 세팅) — 없으면 직렬화된 frameInsetMm(>0) 환산, 둘 다 없으면 0 */
function readFrameInsetPx(frame: Record<string, unknown>): number {
  const runtime = frame[FRAME_INSET_PX_RUNTIME_KEY]
  if (typeof runtime === 'number' && Number.isFinite(runtime)) return runtime
  const mm = frame.frameInsetMm
  return typeof mm === 'number' && Number.isFinite(mm) && mm > 0 ? mmToPxDisplay(mm) : 0
}

let warnedImageFrameInset = false

/**
 * 사진틀의 fitMode('cover' | 'contain' | 미설정=legacy)와 마스크 창을 읽는다(D8/serialization-1, tests-3).
 * - 창: inset 0 이면 {1,1,프레임 중심}(종전과 바이트 동일). inset>0 이면 플러그인이 둔 `__frameWindow` 를 쓰고, 없으면
 *   FrameInteractionPlugin 과 같은 폴백(`resolveFrameWindowFor(frame, canvas, insetPx, canvas.__photoPrintBleedPx ?? 0)`),
 *   캔버스를 모르면(테스트 더미) frameInsetScale 비율·프레임 중심.
 * - image(PNG, inverted clipPath) 틀은 유테를 지원하지 않는다 — `ignoreInset` 로 inset 을 0 으로 취급(console.warn 1회).
 */
function readFrameFill(
  frame: Record<string, unknown>,
  canvas: Record<string, unknown> | null | undefined,
  frameW: number,
  frameH: number,
  ignoreInset = false,
): FrameFillGeometry {
  const center = (frame.getCenterPoint as () => { x: number; y: number }).call(frame)
  const fit = frame.fitMode
  const legacy = fit !== 'cover' && fit !== 'contain'
  const contain = fit === 'contain'
  const insetPx = readFrameInsetPx(frame)
  let sx = 1
  let sy = 1
  let cx = center.x
  let cy = center.y
  if (insetPx > 0 && ignoreInset) {
    if (!warnedImageFrameInset) {
      warnedImageFrameInset = true
      console.warn('[useImageStore] image(PNG) 타입 사진틀은 유테(frameInsetMm)를 지원하지 않아 inset 0 으로 채웁니다 — 사진인화 템플릿은 rect/path 틀 규약')
    }
  } else if (insetPx > 0) {
    const win = frame[FRAME_WINDOW_RUNTIME_KEY]
    if (isFrameWindow(win)) {
      ;({ sx, sy, cx, cy } = win)
    } else if (canvas && typeof canvas.getObjects === 'function') {
      const bleed = canvas[PHOTO_PRINT_BLEED_PX_RUNTIME_KEY]
      const w = resolveFrameWindowFor(
        frame as unknown as fabric.Object,
        canvas as unknown as fabric.Canvas,
        insetPx,
        typeof bleed === 'number' && Number.isFinite(bleed) ? bleed : 0,
      )
      ;({ sx, sy, cx, cy } = w)
    } else {
      const ratio = frameInsetScale(frameW, frameH, insetPx)
      sx = ratio.sx
      sy = ratio.sy
    }
  }
  return { legacy, contain, sx, sy, cx, cy, winW: frameW * sx, winH: frameH * sy }
}

/** 채움 스케일 — legacy 는 호출자별 종전 산식, cover = max, contain = min (PhotoPrintPlugin.resolveFillScale 과 같은 규칙) */
function resolveFillScaleFor(g: FrameFillGeometry, imgW: number, imgH: number, legacyScale: number): number {
  if (g.legacy) return legacyScale
  return (g.contain ? Math.min : Math.max)(g.winW / imgW, g.winH / imgH)
}

const MM_PER_INCH = 25.4

/**
 * 채움 실효 dpi — 창 크기(mm, 화면 px → mm)와 원본 px: min(imgW/(wMm/25.4), imgH/(hMm/25.4)). 비유한이면 Infinity(저해상 아님).
 */
export function resolveFillDpi(imgW: number, imgH: number, winWpx: number, winHpx: number): number {
  const wMm = pxToMmDisplay(winWpx)
  const hMm = pxToMmDisplay(winHpx)
  if (!(wMm > 0) || !(hMm > 0) || !(imgW > 0) || !(imgH > 0)) return Infinity
  return Math.min(imgW / (wMm / MM_PER_INCH), imgH / (hMm / MM_PER_INCH))
}

/** 채움 사진의 원본 식별자 — 내 업로드(files 레코드 id, url 키) 또는 외부 주입 사진의 id(호스트가 준 경우). 없으면 undefined */
function resolveFillSourcePhotoId(fore: Record<string, unknown>, uploadedPhotoIdByUrl: Record<string, string>): string | undefined {
  const keys: string[] = []
  for (const k of [fore.storagePhotoUrl, fore.externalPhotoUrl, fore.src]) {
    if (typeof k === 'string' && k) keys.push(k)
  }
  const getSrc = fore.getSrc
  if (typeof getSrc === 'function') {
    try {
      const src = (getSrc as () => unknown).call(fore)
      if (typeof src === 'string' && src) keys.push(src)
    } catch { /* 이미지 미로드 등 — 무시 */ }
  }
  for (const k of keys) {
    const id = uploadedPhotoIdByUrl[k]
    if (typeof id === 'string' && id) return id
  }
  const external = useExternalPhotosStore.getState().photos.find((p) => keys.includes(p.url)) as
    | (Record<string, unknown> & { url: string })
    | undefined
  const extId = external?.id
  return typeof extId === 'string' && extId ? extId : undefined
}

/**
 * 채움/교체 뒤 항목 메타 기록(contract-1/contract-2) — 사진인화 세트에서만, 캔버스가 allCanvas 에 있을 때만.
 * lowRes = 이 채움의 dpi < sizes[0].minDpi, 또는 같은 캔버스의 다른 채움(런타임 `__lowRes`)이 저해상인 경우.
 * sourcePhotoId 는 원본 식별자가 있으면 기록, 없으면 키 제거(런처 입력 echo 금지).
 */
function recordPhotoFillMeta(canvas: Record<string, unknown> | null | undefined, fore: Record<string, unknown>, g: FrameFillGeometry): void {
  const profile = useSettingsStore.getState().productProfile
  if (!isPhotoPrintProfile(profile) || !canvas) return
  const { allCanvas } = useAppStore.getState()
  const idx = allCanvas.indexOf(canvas)
  if (idx < 0) return
  const itemIndex = resolvePhotoItemIndexForCanvas(profile.photoPrint, idx)
  if (itemIndex < 0) return
  const minDpi = profile.photoPrint.sizes[0]?.minDpi
  const imgW = typeof fore.width === 'number' ? fore.width : 0
  const imgH = typeof fore.height === 'number' ? fore.height : 0
  const lowRes = typeof minDpi === 'number' && minDpi > 0 && resolveFillDpi(imgW, imgH, g.winW, g.winH) < minDpi
  fore.__lowRes = lowRes
  let anyLow = lowRes
  if (typeof canvas.getObjects === 'function') {
    for (const obj of (canvas.getObjects as () => Record<string, unknown>[]).call(canvas)) {
      if (obj !== fore && obj.extensionType === 'fillImage' && obj.__lowRes === true) anyLow = true
    }
  }
  const store = usePhotoPrintStore.getState()
  store.syncWithCanvasCount(allCanvas.length)
  store.setItemMeta(itemIndex, {
    lowRes: anyLow,
    sourcePhotoId: resolveFillSourcePhotoId(fore, useImageStore.getState().uploadedPhotoIdByUrl) ?? null,
  })
}

/**
 * 채움 시점의 촬영일 — 이미 extension.takenAt 이 있으면 그 값, 없으면 사진 원천(외부 주입 사진·내 업로드 메타)의
 * takenAt 을 src/externalPhotoUrl/storagePhotoUrl 로 찾는다. 사진인화 세트에서만 기록한다(legacy 직렬화 불변).
 */
function resolveFillTakenAt(fore: Record<string, unknown>, uploadedPhotoMeta: UploadedPhotoMeta[]): string | undefined {
  const ext = fore.extension
  const existing = typeof ext === 'object' && ext !== null ? (ext as { takenAt?: unknown }).takenAt : undefined
  if (typeof existing === 'string' && existing) return existing
  const keys = new Set<string>()
  for (const k of [fore.externalPhotoUrl, fore.storagePhotoUrl, fore.src]) {
    if (typeof k === 'string' && k) keys.add(k)
  }
  const getSrc = fore.getSrc
  if (typeof getSrc === 'function') {
    try {
      const src = (getSrc as () => unknown).call(fore)
      if (typeof src === 'string' && src) keys.add(src)
    } catch { /* 이미지 미로드 등 — 무시 */ }
  }
  if (keys.size === 0) return undefined
  const external = useExternalPhotosStore.getState().photos.find((p) => keys.has(p.url))
  if (external?.takenAt) return external.takenAt
  const meta = uploadedPhotoMeta.find((m) => keys.has(m.url))
  return meta?.takenAt
}

/** 틀 채움 원본 — image 는 캔버스에 넣을 fabric 이미지, takenAt 은 EXIF(사진인화 세트만), uploaded 는 storage URL src 여부 */
export interface FrameFillSource {
  image: FabricObject
  takenAt?: string
  uploaded: boolean
}

/** fillImage 의 extension 에 takenAt 을 spread 병합으로 기록(플러그인이 같은 extension 에 grayscale 를 덧붙인다) */
function writeFillTakenAt(fore: Record<string, unknown>, takenAt: string | undefined): void {
  if (!takenAt) return
  const ext = typeof fore.extension === 'object' && fore.extension !== null ? (fore.extension as Record<string, unknown>) : {}
  fore.extension = { ...ext, takenAt }
}

/**
 * 로드된 이미지의 크기가 0 보다 큰지 — fabric 5 `Image.fromURL` 은 로드 실패에도 `new fabric.Image(null)`(0×0)로 콜백하고
 * canvas-core imageFromURL 은 그 오류 표시를 넘기지 않아 resolve 된다. 0×0 을 그대로 쓰면 배경·틀 채움 배율이 Infinity 가 된다.
 * width/height 를 보고, 원본 요소가 img 면 naturalWidth/naturalHeight 도 본다.
 */
function hasLoadedImageSize(image: unknown): boolean {
  const img = image as { width?: unknown; height?: unknown; getElement?: () => unknown } | null | undefined
  if (!img) return false
  const width = Number(img.width)
  const height = Number(img.height)
  if (!(width > 0) || !(height > 0)) return false
  const el = typeof img.getElement === 'function' ? img.getElement() : undefined
  if (el && typeof (el as { naturalWidth?: unknown }).naturalWidth === 'number') {
    const natural = el as { naturalWidth: number; naturalHeight?: unknown }
    return natural.naturalWidth > 0 && Number(natural.naturalHeight) > 0
  }
  return true
}

/**
 * D12·B11-b: storage 업로드 URL 로 이미지 로드(crossOrigin anonymous — PDF 생성 toDataURL taint 방지, AppImage 자동편집과 동일).
 * 로드 실패(예외 또는 0×0 결과)는 경고만 남기고 undefined — 호출부가 종전 data URL 경로로 폴백한다.
 */
async function loadImageFromStorageUrl(url: string, logTag: string, fileName: string): Promise<{ image: FabricObject } | undefined> {
  try {
    const image = await core.imageFromURL(url, { crossOrigin: 'anonymous' })
    if (!hasLoadedImageSize(image)) {
      console.warn(`[${logTag}] 업로드 URL 이미지 로드 실패(0×0) — data URL 폴백:`, fileName)
      return undefined
    }
    return { image: image as unknown as FabricObject }
  } catch (e) {
    console.warn(`[${logTag}] 업로드 URL 이미지 로드 실패 — data URL 폴백:`, fileName, e)
    return undefined
  }
}

/**
 * B11-b (2026-10-25): 프로파일 세트(캘린더·사진인화 등)의 래스터 배경 업로드 원본 — storage 업로드(게스트 통로
 * `/storage/upload-public`) 후 절대 URL 로 로드해 canvasData 에 base64 를 넣지 않는다.
 * 배경은 자동편집 입력이 아니므로 registerUploadedPhoto(메타 등록·사진 수 한도 집계)를 거치지 않는다(종전과 같음).
 * 업로드·URL 로드 실패는 종전 core.fileToImage(data URL)로 폴백해 편집을 막지 않는다.
 */
async function resolveProfileBackgroundImage(
  canvas: FabricCanvas,
  file: File,
  imagePlugin: ImageProcessingPlugin
): Promise<FabricObject | undefined> {
  let url: string | null = null
  try {
    url = resolveAssetUrl((await storageApi.uploadFilePublic(file))?.url)
  } catch (e) {
    console.warn('[useImageStore.upload] 배경 업로드 실패 — data URL 폴백:', file.name, e)
  }
  if (url) {
    const loaded = await loadImageFromStorageUrl(url, 'useImageStore.upload', file.name)
    if (loaded?.image) return loaded.image
  } else {
    console.warn('[useImageStore.upload] 배경 업로드 URL 없음 — data URL 폴백:', file.name)
  }
  return core.fileToImage(canvas, file, imagePlugin)
}

// Fabric.js 타입 (실제 fabric 타입은 런타임에 로드됨)
// canvas-core API를 통해 fabric 객체를 다루므로 타입만 정의
 
type FabricCanvas = any
 
type FabricObject = any
 
type FabricImage = any


interface LoadingBar {
  start: () => void
  finish: () => void
}

interface ImageState {
  uploading: boolean
  uploaded: FabricObject[]
  /**
   * Track 2 (D-2 잔여 갭, 2026-07-06): '내 업로드' 사진 메타 — 자동편집(autofill) 입력용.
   * 기존 uploaded(FabricObject[])는 불변 유지(additive). url 은 storage 업로드 결과 URL
   * (objectURL/dataURL 금지 — 세션 휘발로 저장 JSON·재편집 기준이 깨짐).
   * ⚠️ uploadedAt = file.lastModified(파일 수정시각) — 외부주입 ExternalPhoto.uploadedAt
   * (호스트 업로드시각)과 시맨틱이 다름. photoPlacement.UploadedPhotoMeta 주석 참조.
   */
  uploadedPhotoMeta: UploadedPhotoMeta[]
  /** P2-d 사진인화: storage 업로드 URL → files 레코드 id(sourcePhotoId 원천). 등록 실패분은 없음 */
  uploadedPhotoIdByUrl: Record<string, string>
}

interface ImageActions {
  // 파일 업로드 (ImageProcessingPlugin 필요)
  upload: (
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    type?: SelectionType,
    accept?: string,
    onVectorStart?: () => void,
    onVectorEnd?: (success: boolean) => void
  ) => Promise<FabricObject | undefined>

  // 간단한 파일 업로드 (ImageProcessingPlugin 불필요, OpenCV 미사용)
  uploadSimple: (
    canvas: FabricCanvas,
    accept?: string
  ) => Promise<FabricObject | undefined>

  // 이미 가지고 있는 File 객체로 업로드 (드래그앤드롭, 클립보드 paste 등)
  uploadFile: (
    canvas: FabricCanvas,
    file: File
  ) => Promise<FabricObject | undefined>

  // Track 2 (D-2): 업로드 File 을 자동편집 입력으로 등록 — EXIF(원본 File) 파싱 +
  // storage 업로드 URL 확보 후 uploadedPhotoMeta 에 additive 추가. 실패는 조용히 스킵
  // (자동편집 대상에서만 제외, 캔버스 업로드 UX 무영향). fire-and-forget 호출 전제.
  registerUploadedPhoto: (file: File) => Promise<UploadedPhotoMeta | undefined>

  // 이미지 채우기
  fillImage: (
    canvas: FabricCanvas,
    fore: FabricObject,
    rear: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => Promise<FabricObject>

  // P2-d D12 (2026-10-21)·B11 (2026-10-25): 틀 채움 원본 이미지 — 프로파일 세트(캘린더·사진인화 등)는 storage 업로드(URL src),
  // 프로파일 NULL 세트는 종전 core.fileToImage(data URL)
  resolveFrameFillImage: (
    canvas: FabricCanvas,
    file: File,
    imagePlugin: ImageProcessingPlugin
  ) => Promise<FrameFillSource | undefined>

  // 사진틀(프레임)을 인터랙티브하게 만들기: hover "이미지 채우기" 오버레이 + 클릭 시 파일 선택
  makeFrameInteractive: (
    canvas: FabricCanvas,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => void

  // 사진을 프레임의 투명창 안에만 보이도록 채우기 (inverted clipPath 마스킹)
  fillImageIntoFrame: (
    canvas: FabricCanvas,
    fore: FabricObject,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ) => Promise<FabricObject>

  // 빈 사진틀(채워진 사진 없는 frame) 삭제 — 포토북 고유, 무경고 분기
  // 채워진 틀은 삭제하지 않고 false 반환(채워진 틀의 '사진' 삭제 경고는 별도 항목).
  deleteEmptyFrame: (
    canvas: FabricCanvas,
    frame: FabricObject
  ) => boolean

  // 배경 추가
  addBackground: (item: FabricObject, canvas: FabricCanvas) => FabricObject

  // 이미지 세그멘테이션 (배경 제거)
  segmentImage: (
    image: FabricImage,
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    loadingBar: LoadingBar,
    /** 서버 모델 선택(미지정 시 서버 env 기본값). 스파이크 §5-10 시그니처 규약을 깨지 않는 선택 인자. */
    options?: { model?: string }
  ) => Promise<FabricImage>

  // 모양을 몰드로 설정
  setShapeAsMold: (
    shape: FabricObject,
    canvas: FabricCanvas
  ) => Promise<FabricObject | undefined>
}

// 벡터 파일 업로드 (REST API 사용)
const uploadVector = async (file: File): Promise<string> => {
  try {
    // storageApi를 사용하여 파일 업로드
    const result = await storageApi.uploadFile(file, 'uploads')

    if (!result.success || !result.data) {
      throw new Error(result.error?.message || '벡터 파일 업로드 실패')
    }

    return result.data.url
  } catch (error) {
    console.error('vector 업로드 오류:', error)
    throw new Error('vector 업로드에 실패했습니다')
  }
}

export const useImageStore = create<ImageState & ImageActions>()((set, get) => ({
  // 초기 상태
  uploading: false,
  uploaded: [],
  uploadedPhotoMeta: [],
  uploadedPhotoIdByUrl: {},

  // Track 2 (D-2): '내 업로드' → 자동편집 입력 메타 등록.
  // 순서 제약(SKILL.md §자동편집 EXIF): EXIF 는 **원본 File** 에서 즉시 파싱한다 —
  // 서버 썸네일 파이프(storage.service.ts sharp.rotate())는 사본에만 적용되지만,
  // 원본 File 파싱이면 그 경로와 아예 무관해 takenAt/GPS 보존이 구조적으로 보장된다.
  registerUploadedPhoto: async (file: File): Promise<UploadedPhotoMeta | undefined> => {
    try {
      const exif = await parsePhotoExif(file)
      // storage 업로드 URL 기준(안정 참조). objectURL/dataURL 은 세션 휘발이라
      // 자동편집 결과(fillImage src)의 저장/재편집 라운드트립이 깨진다.
      //
      // ⚠️ 게스트 통로(`/storage/upload-public`)로만 올린다 — 종전 `storageApi.uploadFile` 은
      // `/storage/upload`(JWT+@Roles)라 비로그인 고객에게 **401** 이었고, 자동편집(배지/EXIF)
      // 입력 등록이 전량 실패하고 있었다(fire-and-forget 이라 편집 자체는 무영향, 2026-08-09 수정).
      const result = await storageApi.uploadFilePublic(file)
      // 응답 url 은 `/storage/uploads/...` 상대 경로다. meta.url 은 ExternalPhoto.url 과 같은
      // 자리(자동편집 fillImage src)에 쓰이므로 API origin 기준 절대 URL 이어야 한다 —
      // 상대로 두면 editor/임베드 호스트 origin 으로 해석돼 404 다.
      const url = resolveAssetUrl(result?.url)
      if (!url) {
        console.warn('[useImageStore.registerUploadedPhoto] storage 업로드 실패 — 자동편집 대상 제외:', file.name)
        return undefined
      }
      const meta: UploadedPhotoMeta = {
        url,
        name: file.name,
        // ⚠️ uploadedAt = file.lastModified(기기 파일 수정시각) — 호스트 업로드시각이 아님.
        uploadedAt: Number.isFinite(file.lastModified)
          ? new Date(file.lastModified).toISOString()
          : undefined,
        takenAt: exif.takenAt,
        gps: exif.gps,
        exifParsed: true,
      }
      const fileId = typeof result?.id === 'string' && result.id ? result.id : undefined
      set((s) => ({
        ...(s.uploadedPhotoMeta.some((m) => m.url === meta.url) ? {} : { uploadedPhotoMeta: [...s.uploadedPhotoMeta, meta] }),
        ...(fileId ? { uploadedPhotoIdByUrl: { ...s.uploadedPhotoIdByUrl, [url]: fileId } } : {}),
      }))
      return meta
    } catch (e) {
      console.warn('[useImageStore.registerUploadedPhoto] 등록 실패 — 자동편집 대상 제외:', e)
      return undefined
    }
  },

  // 배경 추가
  addBackground: (item: FabricObject, canvas: FabricCanvas): FabricObject => {
    const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
    if (!workspace) {
      return item
    }

    const prev = canvas.getObjects().find((obj: FabricObject) => obj.extensionType === 'background')
    if (prev) {
      canvas.remove(prev)
    }

    const fitSide = workspace.width! / item.width! > workspace.height! / item.height!
    const scale = fitSide ? workspace.width! / item.width! : workspace.height! / item.height!

    item.set({
      left: workspace.left,
      top: workspace.top,
      originX: 'center',
      originY: 'center'
    })
    item.set({
      id: uuid(),
      scaleX: scale,
      scaleY: scale,
      hasControls: false,
      selectable: true,
      lockMovementX: fitSide,
      lockMovementY: !fitSide,
      name: '배경',
      extensionType: 'background'
    })

    return item
  },

  // 간단한 파일 업로드 (ImageProcessingPlugin 불필요)
  uploadSimple: async (
    canvas: FabricCanvas,
    accept: string = 'image/*'
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded } = get()

    if (uploading) {
      console.log('Already uploading, please wait')
      return undefined
    }

    try {
      set({ uploading: true })

      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')

      if (!workspace) {
        alert('workspace를 등록해 주세요')
        return undefined
      }

      const files = await selectFiles({
        accept: accept,
        multiple: false
      })

      if (!files || files.length === 0) {
        console.log('No file selected')
        return undefined
      }

      const file = files[0]

      // P2-d 사진인화: 프로파일 업로드 한도(maxPhotos/maxMb) — 프로파일 NULL 세트는 no-op
      if (!checkPhotoPrintUploadLimit(files, currentPhotoCountForLimit(uploaded, get().uploadedPhotoMeta))) return undefined

      // 벡터 파일은 지원하지 않음 (ImageProcessingPlugin 필요)
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const isVectorFile = ['ai', 'eps', 'pdf'].includes(fileExtension || '')

      if (isVectorFile) {
        alert('벡터 파일 업로드는 이미지 처리 기능이 활성화된 경우에만 사용할 수 있습니다.')
        return undefined
      }

      // 모바일 메모리 가드 — 4MB 초과 차단 (P0-2 사용자 보고: iOS Safari 크래시)
      if (!checkMobileFileSize(file)) return undefined

      // 간단한 이미지 로드 (OpenCV 미사용)
      const item = await core.fileToImageSimple(canvas, file)

      if (item) {
        // workspace 크기 계산
        const workspaceWidth = workspace.width! * workspace.scaleX!
        const workspaceHeight = workspace.height! * workspace.scaleY!
        const workspaceCenter = workspace.getCenterPoint()

        // canvas setting이 mm인 경우 스케일 보정
        const scale = canvas.unitOptions?.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

        // 일반 이미지
        item.set({
          originX: 'center',
          originY: 'center',
          left: workspaceCenter.x,
          top: workspaceCenter.y
        })

        const actualItemWidth = item.width! * scale
        const actualItemHeight = item.height! * scale

        if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
          const scaleX = workspaceWidth / actualItemWidth
          const scaleY = workspaceHeight / actualItemHeight
          const itemScale = Math.min(scaleX, scaleY)
          item.scale(itemScale * scale)
        } else {
          item.scale(scale)
        }

        canvas.add(item)
        canvas.setActiveObject(item)

        set({ uploaded: [...uploaded, item] })
        // Track 2 (D-2): 자동편집 입력 등록 — fire-and-forget(업로드 UX 비블로킹).
        // S-E4: storage URL 을 업로드 객체에 링크 — 자동편집 채움(src=storage URL)과
        // 패널 썸네일(src=dataURL)의 사용 횟수 집계를 잇는다(photoUsage 키 합산).
        void get().registerUploadedPhoto(file).then((meta) => {
          if (meta?.url) (item as FabricObject & { storagePhotoUrl?: string }).storagePhotoUrl = meta.url
        })
        return item
      }

      return undefined
    } catch (e) {
      console.log(e)
      throw e
    } finally {
      set({ uploading: false })
    }
  },

  // 이미 가지고 있는 File로 업로드 (드래그앤드롭 등)
  // uploadSimple과 동일한 로직이지만 file picker 단계 생략
  uploadFile: async (
    canvas: FabricCanvas,
    file: File
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded } = get()
    if (uploading) return undefined

    try {
      set({ uploading: true })
      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')
      if (!workspace) return undefined
      // P2-d 사진인화: 드래그드롭(EditorView) 등 File 직접 경로도 프로파일 업로드 한도 — 프로파일 NULL 세트는 no-op
      if (!checkPhotoPrintUploadLimit([file], currentPhotoCountForLimit(uploaded, get().uploadedPhotoMeta))) return undefined

      // 벡터 파일은 지원 안 함 (uploadSimple과 동일)
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (['ai', 'eps', 'pdf'].includes(ext || '')) return undefined

      // 모바일 메모리 가드
      if (!checkMobileFileSize(file)) return undefined

      const item = await core.fileToImageSimple(canvas, file)
      if (!item) return undefined

      const workspaceWidth = workspace.width! * workspace.scaleX!
      const workspaceHeight = workspace.height! * workspace.scaleY!
      const workspaceCenter = workspace.getCenterPoint()
      const scale = canvas.unitOptions?.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

      item.set({
        originX: 'center',
        originY: 'center',
        left: workspaceCenter.x,
        top: workspaceCenter.y,
      })

      const actualW = item.width! * scale
      const actualH = item.height! * scale
      if (actualW > workspaceWidth || actualH > workspaceHeight) {
        const sx = workspaceWidth / actualW
        const sy = workspaceHeight / actualH
        item.scale(Math.min(sx, sy) * scale)
      } else {
        item.scale(scale)
      }

      canvas.add(item)
      canvas.setActiveObject(item)
      set({ uploaded: [...uploaded, item] })
      // Track 2 (D-2): 자동편집 입력 등록 — fire-and-forget(업로드 UX 비블로킹).
      // S-E4: storage URL 링크(uploadSimple 과 동일 — photoUsage 키 합산용).
      void get().registerUploadedPhoto(file).then((meta) => {
        if (meta?.url) (item as FabricObject & { storagePhotoUrl?: string }).storagePhotoUrl = meta.url
      })
      return item
    } catch (e) {
      console.error('[useImageStore.uploadFile]', e)
      return undefined
    } finally {
      set({ uploading: false })
    }
  },

  // 파일 업로드 (ImageProcessingPlugin 필요)
  upload: async (
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    type?: SelectionType,
    accept: string = 'image/*',
    onVectorStart?: () => void,
    onVectorEnd?: (success: boolean) => void
  ): Promise<FabricObject | undefined> => {
    const { uploading, uploaded, addBackground, fillImage } = get()

    if (uploading) {
      console.log('Already uploading, please wait')
      return undefined
    }

    try {
      set({ uploading: true })

      const workspace = canvas.getObjects().find((obj: FabricObject) => obj.id === 'workspace')

      if (!workspace) {
        alert('workspace를 등록해 주세요')
        return undefined
      }

      const files = await selectFiles({
        accept: accept,
        multiple: false
      })

      if (!files || files.length === 0) {
        console.log('No file selected')
        return undefined
      }

      const file = files[0]

      // P2-d 사진인화: 프로파일 업로드 한도(maxPhotos/maxMb) — 프로파일 NULL 세트는 no-op
      if (!checkPhotoPrintUploadLimit(files, currentPhotoCountForLimit(uploaded, get().uploadedPhotoMeta))) return undefined

      // 모바일 메모리 가드 — 4MB 초과 차단 (P0-2 사용자 보고: iOS Safari 크래시)
      if (!checkMobileFileSize(file)) return undefined

      let item: FabricObject | undefined

      // 파일 타입 체크
      const fileExtension = file.name.split('.').pop()?.toLowerCase()
      const isVectorFile = ['ai', 'eps', 'pdf'].includes(fileExtension || '')
      // SVG는 fabric.Image로 처리 불가 (loadImage indexOf TypeError 유발).
      // SelectionType.shape에서 SVG는 loadSVGFromURL로 별도 로드.
      const isSvgFile = file.type === 'image/svg+xml' || fileExtension === 'svg'

      if (isVectorFile) {
        if (onVectorStart) {
          onVectorStart()
        }

        try {
          const url = await uploadVector(file)
          const response = await fetch(url)
          const blob = await response.blob()
          const uploadedFile = new File([blob], file.name, { type: 'image/png' })
          item = await core.fileToImage(canvas, uploadedFile, imagePlugin)

          if (onVectorEnd) {
            onVectorEnd(true)
          }
        } catch (error) {
          if (onVectorEnd) {
            onVectorEnd(false)
          }
          throw error
        }
      } else if (isSvgFile) {
        // SVG는 모든 SelectionType에서 fabric.Image.fromURL이 indexOf throw 유발.
        // 항상 loadSVGFromURL로 vector 그대로 로드 (image/background/shape/frame 무관).
        try {
          const dataUrl = await core.fileToURL(file)
          const svgItem = await core.loadSVGFromURL(dataUrl)
          if (svgItem) {
            item = svgItem as FabricObject
          }
        } catch (error) {
          console.error('SVG 로드 실패:', error)
          showToast('SVG 파일 로드에 실패했습니다.', 'error', 4000)
          return undefined
        }
      } else if (type === SelectionType.background && hasProductProfileSession()) {
        // B11-b: 프로파일 세트의 래스터 배경은 storage 업로드 URL 로 로드(실패 시 data URL 폴백). 벡터·SVG·다른 타입과
        // 프로파일 NULL 세트는 아래 종전 경로 그대로.
        item = await resolveProfileBackgroundImage(canvas, file, imagePlugin)
      } else {
        item = await core.fileToImage(canvas, file, imagePlugin)
      }

      if (item) {
        // workspace 크기 계산
        const workspaceWidth = workspace.width! * workspace.scaleX!
        const workspaceHeight = workspace.height! * workspace.scaleY!
        const workspaceCenter = workspace.getCenterPoint()

        // canvas setting이 mm인 경우 스케일 보정
        const scale = canvas.unitOptions?.unit === 'mm' ? (canvas.unitOptions.dpi || 150) / 72 : 1

        if (type === SelectionType.frame) {
          // 프레임 처리
          canvas.clipPath = undefined
          canvas.clear()

          item.set({
            id: 'workspace',
            name: '배경 프레임',
            lockMovementX: true,
            lockMovementY: true,
            hasControls: false,
            hasBorders: false,
            extensionType: 'frame',
            scaleX: 1,
            absolutePositioned: true,
            scaleY: 1,
            fill: '#fff',
            hoverCursor: 'pointer',
            moveCursor: 'pointer',
            editable: false
          })

          // core API를 사용하여 fabric 객체 생성
          const rect = core.createRect({
            id: uuid(),
            width: (item.width || 0) + 100,
            height: (item.height || 0) + 100,
            fill: '#000',
            opacity: 0.5,
            originX: 'center',
            originY: 'center',
            left: item.left,
            top: item.top,
            selectable: false,
            hasControls: false,
            absolutePositioned: true,
            clipPath: item,
            evented: false
          })

          const text = core.createText('이미지 채우기', {
            fill: '#fff',
            fontSize: (item.width || 100) / 2 / 5,
            originX: 'center',
            originY: 'center',
            left: item.left,
            top: item.top,
            selectable: false,
            hasControls: false,
            absolutePositioned: true,
            evented: false
          })

          const group = core.createGroup([rect, text], {
            id: uuid(),
            evented: false,
            selectable: false,
            hasControls: false,
            editable: false,
            extensionType: 'overlay'
          })

          item.on('mouseover', () => {
            const hasFilled = canvas.getObjects().some((obj: FabricObject) => obj.clipPath?.id === item?.id)

            if (!hasFilled && !(group as FabricObject).added) {
              canvas.add(group)
              ;(group as FabricObject).added = true
              canvas.renderAll()
            }
          })

          item.on('mouseout', () => {
            if ((group as FabricObject).added) {
              canvas.remove(group)
              ;(group as FabricObject).added = false
              canvas.renderAll()
            }
          })

          item.on('mousedown', async () => {
            const filledImage = canvas
              .getObjects()
              .filter((obj: FabricObject) => obj.clipPath?.id === item?.id && obj.extensionType !== 'overlay')![0]

            if (filledImage) {
              return
            }

            const selectedFiles = await selectFiles({ accept: 'image/*', multiple: false })
            if (!selectedFiles || selectedFiles.length === 0) {
              return null
            }
            const selectedFile = selectedFiles[0]
            // P2-d 사진인화: 프로파일 업로드 한도(maxPhotos/maxMb) — 프로파일 NULL 세트는 no-op
            if (!checkPhotoPrintUploadLimit(selectedFiles, currentPhotoCountForLimit(get().uploaded, get().uploadedPhotoMeta))) return
            // D12·B11: 프로파일 세트(캘린더·사진인화 등)는 storage 업로드 URL, NULL 세트는 종전 data URL
            const fabricImage = (await get().resolveFrameFillImage(canvas, selectedFile, imagePlugin))?.image
            if (!fabricImage) {
              console.log('no image selected')
              return
            }

            const fore = await fillImage(canvas, fabricImage, item, imagePlugin)
            canvas.add(fore)
            canvas.setActiveObject(fore)
            canvas.renderAll()
            // P2-d 사진인화: 채움 뒤 항목 옵션 재적용(흑백·촬영일). 프로파일 NULL 이면 즉시 0.
            if (isPhotoPrintSession()) void applyPhotoPrintForCanvas(canvas)
          })
        } else if (type === SelectionType.background) {
          item = addBackground(item, canvas)
        } else if (type === SelectionType.shape) {
          // SVG/raster 모두 위에서 item이 이미 로드 완료. 여기선 위치/크기/extensionType만.
          item.set({
            id: uuid(),
            originX: 'center',
            originY: 'center',
            left: workspaceCenter.x,
            top: workspaceCenter.y,
            extensionType: 'shape',
          })

          const actualItemWidth = item.width! * scale
          const actualItemHeight = item.height! * scale

          if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
            const scaleX = workspaceWidth / actualItemWidth
            const scaleY = workspaceHeight / actualItemHeight
            const itemScale = Math.min(scaleX, scaleY)
            item.scale(itemScale * scale)
          } else {
            item.scale(scale)
          }
        } else {
          // 일반 이미지
          item.set({
            originX: 'center',
            originY: 'center',
            left: workspaceCenter.x,
            top: workspaceCenter.y
          })

          const actualItemWidth = item.width! * scale
          const actualItemHeight = item.height! * scale

          if (actualItemWidth > workspaceWidth || actualItemHeight > workspaceHeight) {
            const scaleX = workspaceWidth / actualItemWidth
            const scaleY = workspaceHeight / actualItemHeight
            const itemScale = Math.min(scaleX, scaleY)
            item.scale(itemScale * scale)
          } else {
            item.scale(scale)
          }
        }

        canvas.add(item)
        canvas.setActiveObject(item)

        if (type === SelectionType.image) {
          set({ uploaded: [...uploaded, item] })
          // Track 2 (D-2): 래스터 사진만 자동편집 입력 등록(벡터/SVG 는 사진틀 채움 대상 아님).
          if (!isVectorFile && !isSvgFile) {
            // S-E4: storage URL 링크(uploadSimple 과 동일 — photoUsage 키 합산용).
            void get().registerUploadedPhoto(file).then((meta) => {
              if (meta?.url) (item as FabricObject & { storagePhotoUrl?: string }).storagePhotoUrl = meta.url
            })
          }
        }
        return item
      }

      return undefined
    } catch (e) {
      console.log(e)
      throw e
    } finally {
      set({ uploading: false })
    }
  },

  // 이미지 채우기
  // P2-d D12 (2026-10-21): 사진인화 틀 채움은 사진을 base64 data URL 로 캔버스에 넣지 않는다 —
  // 사진당 ≈1.8MB 씩 canvasData 가 커져 13장(26캔버스)에서 22.6MB 가 되고 PATCH /edit-sessions 가 MariaDB
  // max_allowed_packet(기본 16MB)에 걸려 500 이 났다(2026-10-20 2차 e2e). '내 업로드'·자동편집과 같은 통로
  // (registerUploadedPhoto → storage 업로드 URL, EXIF 는 원본 File 에서)로 올리고 URL 로 로드한다(crossOrigin anonymous —
  // PDF 생성 toDataURL taint 방지, AppImage 자동편집과 동일). 업로드·URL 로드 실패는 종전 data URL 경로로 폴백해 편집을 막지 않는다.
  // B11 (2026-10-25): 게이트를 사진인화 전용에서 상품 프로파일이 있는 세트 전체로 넓혔다(캘린더 세트도 사진 9장 이상이면
  // 같은 패킷 한도 위험). 촬영일 기록·옵션 재적용은 호출부에서 계속 사진인화 세트만.
  // 프로파일 NULL 세트는 종전 core.fileToImage 그대로(바이트 동일).
  resolveFrameFillImage: async (
    canvas: FabricCanvas,
    file: File,
    imagePlugin: ImageProcessingPlugin
  ): Promise<FrameFillSource | undefined> => {
    if (!hasProductProfileSession()) {
      const image = await core.fileToImage(canvas, file, imagePlugin)
      return image ? { image: image as unknown as FabricObject, uploaded: false } : undefined
    }
    const meta = await get().registerUploadedPhoto(file)
    if (meta?.url) {
      const loaded = await loadImageFromStorageUrl(meta.url, 'useImageStore.resolveFrameFillImage', file.name)
      if (loaded) return { image: loaded.image, takenAt: meta.takenAt, uploaded: true }
    } else {
      console.warn('[useImageStore.resolveFrameFillImage] 사진 업로드 실패 — data URL 폴백:', file.name)
    }
    const image = await core.fileToImage(canvas, file, imagePlugin)
    if (!image) return undefined
    const exif = await parsePhotoExif(file)
    return { image: image as unknown as FabricObject, takenAt: exif.takenAt, uploaded: false }
  },

  fillImage: async (
    canvas: FabricCanvas,
    fore: FabricObject,
    rear: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): Promise<FabricObject> => {
    // P2-d 사진인화(D8): 창(window) 기하 — fitMode 'cover' 는 창을 가로·세로 모두 덮는 max 비율, 'contain' 은 min, 미설정(legacy)은
    // 종전 폭 기준·프레임 중심 그대로(바이트 동일). 유테 창은 `__frameWindow`(없으면 resolveFrameWindowFor 폴백) 기준.
    const rearW = rear.width! * rear.scaleX!
    const rearH = rear.height! * rear.scaleY!
    const g = readFrameFill(rear, canvas, rearW, rearH)
    const centerOf = { x: g.cx, y: g.cy }

    let rearClip: FabricObject

    // SVG 요소인 경우 그냥 복제, 아닌 경우 pathData 생성
    if (['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'triangle'].includes(rear.type)) {
      rearClip = await new Promise<FabricObject>((resolve) => {
        rear.clone((cloned: FabricObject) => {
          cloned.set({
            id: `${rear.id}_rearClip`,
            fill: 'white',
            stroke: 'transparent',
            strokeUniform: true,
            originX: 'center',
            originY: 'center',
            left: centerOf.x,
            top: centerOf.y,
            absolutePositioned: true,
          })
          resolve(cloned)
        })
      })
    } else {
      const rearObjectPath = await imagePlugin.getObjectPath(rear)
      // core API를 사용하여 Path 생성
      rearClip = core.createPath(rearObjectPath?.path, {
        id: `${rear.id}_rearPath`,
        fill: 'white',
        stroke: 'transparent',
        strokeUniform: true,
        originX: 'center',
        originY: 'center',
        left: centerOf.x,
        top: centerOf.y,
        angle: rear.angle,
        absolutePositioned: true,
      })
    }

    // 사진틀(extensionType==='frame')에 채운 사진은 기본 모드에서 비선택(클릭이 프레임을 잡게).
    // FrameInteractionPlugin 더블클릭(adjust) 진입 시에만 evented 를 켠다. 모양틀(mold/clipart)
    // 등 비-frame 채우기는 기존 동작(사진 직접 선택)을 유지해 회귀를 막는다.
    const asFrame = rear.extensionType === 'frame'

    // 사진 스케일: legacy = 종전 폭 기준(rearW/imgW), cover = max(창 비율), contain = min. clip 복제본은 창 비율·중심으로.
    const { sx, sy } = g
    const fillScale = resolveFillScaleFor(g, fore.width!, fore.height!, (rearW * sx) / fore.width!)
    if (sx !== 1 || sy !== 1) {
      rearClip.set({ scaleX: (rearClip.scaleX ?? 1) * sx, scaleY: (rearClip.scaleY ?? 1) * sy })
    }
    if (asFrame && isPhotoPrintSession()) writeFillTakenAt(fore, resolveFillTakenAt(fore, get().uploadedPhotoMeta))

    fore.set({
      extensionType: 'fillImage',
      left: centerOf.x,
      top: centerOf.y,
      originX: 'center',
      originY: 'center',
      hasControls: true,
      // 프레임 채우기: 비선택(프레임=선택단위). 모양틀: 선택 가능(기존 동작).
      selectable: !asFrame,
      evented: !asFrame,
      scaleX: fillScale,
      scaleY: fillScale,
      id: rear.id + '_fillImage',
      // 프레임↔사진 링크 (vector/SVG 프레임 경로). frameRef = makeFrameInteractive.isFilled()
      // 중복채움 가드, parentLayerId = ObjectPlugin 삭제 동반제거·z-order 동기화 키.
      // 둘 다 extendFabricOption 화이트리스트라 저장/복원에 보존된다. (image 분기는
      // fillImageIntoFrame 가 동일하게 설정.)
      frameRef: rear.id,
      parentLayerId: rear.id,
      clipPath: rearClip
    })
    fore.setCoords()
    rear.fillImage = fore.id

    // z-order 보정: SVG 프레임도 image 경로(fillImageIntoFrame)와 통일해 프레임을 위로.
    // (모양틀은 기존 스택 유지를 위해 건드리지 않음)
    if (asFrame) rear.bringToFront()
    // P2-d 사진인화: 항목 lowRes·sourcePhotoId 기록(프로파일 NULL·allCanvas 밖 캔버스면 no-op)
    if (asFrame) recordPhotoFillMeta(canvas, fore, g)

    return fore
  },

  // 사진틀(프레임)을 인터랙티브하게 만들기
  // - hover 시 "이미지 채우기" 오버레이를 프레임 위에 표시
  // - 클릭(mousedown) 시 파일 선택 → 선택한 사진을 프레임 투명창에 마스킹하여 채움
  // 테스트용 경로(useImageStore.upload 의 SelectionType.frame 블록)와 같은 UX 패턴을
  // 공유하되, 마스킹 방식은 inverted clipPath(투명창 표시)로 통일한다.
  makeFrameInteractive: (
    canvas: FabricCanvas,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): void => {
    // 중복 바인딩 방지 (afterLoad 재바인딩 등에서 다시 호출될 수 있음)
    if (frame._frameInteractiveBound) return
    frame._frameInteractiveBound = true

    const isFilled = () =>
      canvas
        .getObjects()
        .some((obj: FabricObject) => obj.frameRef === frame.id && obj.extensionType !== 'overlay')

    // 이 프레임에 채워진 사진(fillImage) 찾기 — frameRef/parentLayerId 규약(FrameInteractionPlugin·
    // ObjectPlugin.del 과 동일). 드롭 오버라이드 스왑·빈틀삭제 가드에서 공유.
    const findFilledImage = (): FabricObject | undefined =>
      canvas
        .getObjects()
        .find(
          (obj: FabricObject) =>
            obj.extensionType === 'fillImage' && obj.parentLayerId === frame.id
        )

    // 채워진 사진을 캔버스에서 제거 — ObjectPlugin.del(:309-310) 과 동일하게
    // clipPath 해제 후 remove (clipPath 잔존 시 렌더 누수/마스크 오염 방지).
    const removeFilledImage = (filled: FabricObject) => {
      filled.clipPath = undefined
      canvas.remove(filled)
      frame.fillImage = null
    }

    // hover 오버레이는 매 hover 시 즉석 생성/제거 (프레임의 현재 위치/크기에 맞춤)
    let overlay: FabricObject | null = null

    const removeOverlay = () => {
      if (overlay) {
        canvas.remove(overlay)
        overlay = null
        canvas.requestRenderAll()
      }
    }

    frame.set({ hoverCursor: 'pointer', moveCursor: 'pointer' })

    // B1 (2026-07-04): 내용편집 잠금 — contentEditable===false 프레임은 고객(비-editMode)의
    // 채우기/교체 진입 차단. 관리자(editMode)는 자유 편집(다른 잠금 축과 동일 규약).
    const isContentLocked = () =>
      frame.contentEditable === false &&
      !useSettingsStore.getState().currentSettings.editMode

    frame.on('mouseover', () => {
      if (overlay || isContentLocked()) return
      // A1-5 (스왑 발견성): 채워진 액자에도 hover 시 '사진 교체' 오버레이를 표시한다.
      // 클릭 동작은 기존 mousedown 스왑 경로 그대로(로직 무변경) — 표시만 추가.
      // adjust(사진 조정) 모드 중엔 숨김: FrameInteractionPlugin 이 frame.evented=false 로
      // 두어 mouseover 자체가 오지 않지만, fore.evented(adjust 진입 시 true)도 방어 검사.
      const filled = isFilled()
      if (filled && findFilledImage()?.evented === true) return
      const center = frame.getCenterPoint()
      const w = frame.width! * frame.scaleX!
      const h = frame.height! * frame.scaleY!

      const rect = core.createRect({
        id: uuid(),
        width: w,
        height: h,
        fill: '#000',
        opacity: 0.5,
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        angle: frame.angle,
        selectable: false,
        hasControls: false,
        evented: false
      })

      const text = core.createText(filled ? '사진 교체' : '이미지 채우기', {
        fill: '#fff',
        fontSize: Math.max(12, Math.min(w, h) / 10),
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
        angle: frame.angle,
        selectable: false,
        hasControls: false,
        evented: false
      })

      overlay = core.createGroup([rect, text], {
        id: uuid(),
        evented: false,
        selectable: false,
        hasControls: false,
        editable: false,
        excludeFromExport: true,
        extensionType: 'overlay'
      })
      canvas.add(overlay)
      overlay.bringToFront()
      canvas.requestRenderAll()
    })

    frame.on('mouseout', removeOverlay)

    frame.on('mousedown', async () => {
      // B1: 내용편집 잠금 프레임은 채우기/스왑 진입 차단(비-editMode).
      if (isContentLocked()) return
      // A1-5: 클릭(파일선택 진입)·더블클릭(adjust 진입) 시 오버레이 즉시 제거 —
      // adjust 진입 후엔 frame.evented=false 라 mouseout 이 오지 않아 잔존할 수 있다.
      removeOverlay()
      // 드롭 오버라이드 스왑(포토북 고유): 이미 채워진 틀에 새 사진을 떨어뜨리면
      // early-return 으로 차단하지 않고 기존 사진을 교체한다. 새 파일을 먼저 받은 뒤
      // (취소 시 기존 사진 보존) 기존 fillImage 를 제거하고 동일한 fillImageIntoFrame
      // 경로로 다시 채워 마스킹(inverted clipPath)·frameRef/parentLayerId·z-order 보정을
      // 그대로 재사용한다(중복 구현 없음).
      const selectedFiles = await selectFiles({ accept: 'image/*', multiple: false })
      if (!selectedFiles || selectedFiles.length === 0) return
      const selectedFile = selectedFiles[0]
      // P2-d 사진인화: 프로파일 업로드 한도(maxPhotos/maxMb) — 프로파일 NULL 세트는 no-op.
      // 교체(이미 채워진 틀)는 사진 수가 늘지 않으므로 수량 한도에서 1장 빼고 판정한다.
      const photoPrint = isPhotoPrintSession()
      if (photoPrint) {
        const replacing = !!findFilledImage()
        const count = currentPhotoCountForLimit(get().uploaded, get().uploadedPhotoMeta) - (replacing ? 1 : 0)
        if (!checkPhotoPrintUploadLimit(selectedFiles, count)) return
      }
      if (!checkMobileFileSize(selectedFile)) return

      // D12·B11: 프로파일 세트(캘린더·사진인화 등)는 storage 업로드 URL 로 로드(canvasData 에 base64 미포함), NULL 세트는 종전 data URL
      const source = await get().resolveFrameFillImage(canvas, selectedFile, imagePlugin)
      const fabricImage = source?.image
      if (!fabricImage) {
        console.log('no image selected')
        return
      }
      // P2-d 사진인화: 촬영일(EXIF DateTimeOriginal)을 원본 File 에서 읽어 채움 시 extension.takenAt 으로 기록(사진인화 세트만)
      if (photoPrint) writeFillTakenAt(fabricImage as Record<string, unknown>, source.takenAt)

      // 새 이미지 로드 성공 후에만 기존 사진을 치운다(로드 실패 시 기존 채움 유지).
      const existing = findFilledImage()
      if (existing) removeFilledImage(existing)

      removeOverlay()
      const fore = await get().fillImageIntoFrame(canvas, fabricImage, frame, imagePlugin)
      canvas.add(fore)
      // 프레임=선택단위: 채우기 후엔 사진이 아니라 프레임을 선택한다(사진은 비evented).
      // 사진 위치 조정은 프레임 더블클릭(FrameInteractionPlugin adjust 모드)으로.
      canvas.setActiveObject(frame)
      canvas.requestRenderAll()
      // P2-d 사진인화: 채움/교체 뒤 항목 옵션 재적용(date-overlay·흑백이 새 사진 기준으로 갱신). 프로파일 NULL 이면 즉시 0.
      if (photoPrint) void applyPhotoPrintForCanvas(canvas)
    })
  },

  // 사진을 프레임의 투명창 안에만 보이도록 채우기 (inverted clipPath 마스킹)
  // - image 타입 프레임(PNG 사진틀/액자/말풍선): 프레임 이미지를 복제하여 inverted clipPath 로 사용.
  //   프레임이 투명한 영역(=창)에서만 사진이 보이고, 불투명한 영역에선 가려진다.
  // - 비-image 프레임(vector/shape/mold): 기존 fillImage(외곽선 path clip) 동작을 유지하여
  //   몰드/테스트용 path 경로가 변하지 않게 한다.
  fillImageIntoFrame: async (
    canvas: FabricCanvas,
    fore: FabricObject,
    frame: FabricObject,
    imagePlugin: ImageProcessingPlugin
  ): Promise<FabricObject> => {
    // image 가 아닌 프레임은 기존 외곽선 clip 방식으로 위임 (몰드/벡터 호환 유지)
    if (frame.type !== 'image') {
      return get().fillImage(canvas, fore, frame, imagePlugin)
    }

    // P2-d 사진인화: 사진틀 fitMode(cover 기본 | contain) — 미설정(legacy)이면 max 비율·프레임 중심으로 종전과 바이트 동일.
    // image(PNG) 틀은 유테(inset)를 지원하지 않는다(tests-3): inset 을 0 으로 취급해 사진이 창 전체를 덮게 한다(console.warn 1회).
    const frameW = frame.width! * frame.scaleX!
    const frameH = frame.height! * frame.scaleY!
    const g = readFrameFill(frame, canvas, frameW, frameH, true)
    const { sx, sy } = g
    const centerOf = { x: g.cx, y: g.cy }

    // 프레임 이미지를 복제해 alpha 마스크로 사용.
    // inverted:true → 프레임이 "투명한" 곳에서 사진이 보이고, "불투명한" 곳에서 가려진다.
    // absolutePositioned:true → clipPath 가 사진의 로컬 좌표가 아니라 캔버스 절대좌표에 고정,
    //   화면상의 프레임과 정확히 같은 위치/크기/각도로 마스킹된다.
    // 유테(frameInsetMm)는 clip 복제본 scale 에 축별 비율만 곱한다(FrameInteractionPlugin._syncFromFrame 과 동일 규약).
    const frameClip: FabricObject = await new Promise<FabricObject>((resolve) => {
      frame.clone((cloned: FabricObject) => {
        cloned.set({
          id: `${frame.id}_frameClip`,
          originX: 'center',
          originY: 'center',
          left: centerOf.x,
          top: centerOf.y,
          scaleX: sx === 1 ? frame.scaleX : frame.scaleX * sx,
          scaleY: sy === 1 ? frame.scaleY : frame.scaleY * sy,
          angle: frame.angle,
          flipX: frame.flipX,
          flipY: frame.flipY,
          absolutePositioned: true,
          inverted: true,
          selectable: false,
          evented: false
        })
        resolve(cloned)
      })
    })

    // 사진이 프레임 창 전체를 덮도록 스케일링 (가로/세로 중 큰 비율로 cover)
    // P2-d 사진인화: fitMode 'contain'(이미지풀)이면 작은 비율.
    const coverScale = resolveFillScaleFor(g, fore.width!, fore.height!, Math.max(frameW / fore.width!, frameH / fore.height!))
    // 촬영일: 사진인화 세트에서만 채움 시점에 extension.takenAt 기록(외부 주입·내 업로드 메타의 EXIF 원천)
    if (isPhotoPrintSession()) writeFillTakenAt(fore, resolveFillTakenAt(fore, get().uploadedPhotoMeta))

    fore.set({
      extensionType: 'fillImage',
      left: centerOf.x,
      top: centerOf.y,
      originX: 'center',
      originY: 'center',
      hasControls: true,
      // 프레임=선택단위: 채운 사진은 기본 모드에서 비선택(클릭이 프레임을 잡게).
      // FrameInteractionPlugin 더블클릭(adjust)에서만 evented 를 켠다.
      selectable: false,
      evented: false,
      scaleX: coverScale,
      scaleY: coverScale,
      id: `${frame.id}_fillImage`,
      frameRef: frame.id,
      // ObjectPlugin 삭제 동반제거·z-order 동기화 키 (frameRef 만으론 불충분 — 매칭 기준이 parentLayerId).
      parentLayerId: frame.id,
      clipPath: frameClip
    })
    fore.setCoords()
    frame.fillImage = fore.id

    // 프레임을 사진 위로 올려 프레임 테두리/장식이 사진을 덮도록 z-order 보정.
    // (사진은 위 add 호출 직후 맨 위에 놓이므로 프레임을 다시 최상단으로)
    frame.bringToFront()
    // P2-d 사진인화: 항목 lowRes·sourcePhotoId 기록(프로파일 NULL·allCanvas 밖 캔버스면 no-op)
    recordPhotoFillMeta(canvas, fore, g)

    return fore
  },

  // 빈 사진틀 삭제 (포토북 고유)
  // - 채워진 사진이 없는(frameRef/parentLayerId 매칭 fillImage 부재) 사진틀만 무경고로 즉시 삭제.
  //   (설계: 빈틀 무경고 분기 = 포토북 고유. 채워진 틀의 '사진' 삭제 경고는 별도 항목.)
  // - 채워진 틀이면 아무 것도 하지 않고 false 반환(여기서 사진 삭제/경고를 다루지 않음).
  // - 삭제 시 hover 오버레이가 남지 않도록 잔여 overlay 도 정리한다.
  deleteEmptyFrame: (
    canvas: FabricCanvas,
    frame: FabricObject
  ): boolean => {
    if (!frame || frame.extensionType !== 'frame') return false

    // 채워진 사진 존재 여부 — fillImage 채우기 규약(frameRef/parentLayerId)과 동일 기준.
    const hasFilled = canvas
      .getObjects()
      .some(
        (obj: FabricObject) =>
          obj.extensionType === 'fillImage' &&
          (obj.parentLayerId === frame.id || obj.frameRef === frame.id)
      )
    if (hasFilled) return false

    // hover "이미지 채우기" 오버레이는 frame.mouseout(=삭제 시 포인터 이탈) 에서 removeOverlay 로
    // 정리되고 excludeFromExport:true 라 출력에도 무영향이므로 여기서 별도 제거하지 않는다
    // (overlay 는 hover 싱글톤이라 전역 제거 시 타 프레임 오버레이 오염 위험 → 비파괴 유지).
    frame.clipPath = undefined
    canvas.remove(frame)
    canvas.requestRenderAll()
    // P2-d 사진인화: 틀 삭제 뒤 항목 옵션 재적용(date-overlay 가 남은 첫 채워진 틀 기준으로 갱신). 프로파일 NULL 이면 즉시 0.
    if (isPhotoPrintSession()) void applyPhotoPrintForCanvas(canvas)
    return true
  },

  // 이미지 세그멘테이션 (배경 제거)
  segmentImage: async (
    image: FabricImage,
    canvas: FabricCanvas,
    imagePlugin: ImageProcessingPlugin,
    loadingBar: LoadingBar,
    options?: { model?: string }
  ): Promise<FabricImage> => {
    if (!image) {
      throw new Error('이미지가 없습니다')
    }

    loadingBar.start()
    canvas.offHistory()

    // 진행 표시는 canvas-core 가 쓰던 것과 같은 longTask 이벤트로 발행한다
    // (EditorView 전역 오버레이가 소비 — 서버 왕복이 수 초라 표시가 없으면 멈춘 것처럼 보인다).
    const editor = useAppStore.getState().editor

    try {

      const hasRemoved = imagePlugin.tellHasAlpha(image.getElement() as any)

      if (hasRemoved) {
        alert('배경이 제거된 이미지 입니다.')
        throw new Error('배경이 이미 제거된 이미지입니다')
      }

      // S-P2A-B 샤드3: 추론을 서버(rembg 사이드카)로 오프로드한다.
      // 종전 `imagePlugin.getForeground()`(=@imgly/background-removal, AGPL-3.0 · 브라우저 ONNX)를
      // 대체한다 — 픽셀 캡·업로드·잡·폴링은 api/cutout.ts 가 담당한다(D-12b/D-12d).
      editor?.emit('longTask:start', { message: '배경 제거 준비 중...' })
      const { element: cutoutElement, result } = await requestCutout(
        image.getElement() as HTMLImageElement,
        {
          model: options?.model,
          onPhase: (phase) => {
            const message =
              phase === 'upload'
                ? '이미지 올리는 중...'
                : phase === 'queue'
                  ? '배경 제거 중...'
                  : '결과 불러오는 중...'
            editor?.emit('longTask:start', { message })
          },
        },
      )

      // 서버 결과는 **원본 프레임에 알파만 입힌** PNG 다. 종전 클라 경로는 getForeground 가
      // 전경만 남긴 이미지를 줬으므로, 동일한 산출을 얻으려면 여기서 투명 여백을 잘라야 한다
      // (모양컷 워크스페이스가 item.height 기준으로 스케일하므로 여백이 남으면 그림이 작아진다).
      // processImage 는 OpenCV(순수) 경로라 imgly 제거와 무관하다.
      const imageURLResult = imagePlugin.processImage(cutoutElement)
      // processImage가 Promise<string>인 경우 await로 풀어줌
      const imageURL = typeof (imageURLResult as any)?.then === 'function'
        ? await (imageURLResult as Promise<string>)
        : (imageURLResult as unknown as string)
      const center = image.getCenterPoint()

      // core API를 사용하여 이미지 로드
      const img = await core.imageFromURL(imageURL, {
        id: uuid(),
        selectable: false,
        evented: false,
        hasControls: false,
        originX: 'center',
        originY: 'center',
        left: center.x,
        top: center.y,
      })

      // 화면 크기 보상 — 결과는 **추론 입력 좌표계**(장변 캡 적용본) 기준이라, 캡이 걸린 원본은
      // 결과 픽셀 수가 원본보다 적다. 트림(processImage)은 잘라내기만 하고 픽셀당 크기를 바꾸지
      // 않으므로 `화면크기 / inputWidth` 가 정확한 배율이다.
      // (모양컷 경로는 renderWorkspace 가 다시 스케일하므로 무해하고, 일반 캔버스 교체 경로에서
      //  원본과 같은 크기로 놓이게 하는 것이 이 계산의 목적이다.)
      const visualW = (image.width ?? 0) * (image.scaleX ?? 1)
      const visualH = (image.height ?? 0) * (image.scaleY ?? 1)
      if (result.inputWidth > 0 && result.inputHeight > 0 && visualW > 0 && visualH > 0) {
        img.set({
          scaleX: visualW / result.inputWidth,
          scaleY: visualH / result.inputHeight,
        })
        img.setCoords()
      }

      return img
    } finally {
      // ⚠️ 종전에는 실패 경로에서 offHistory 가 복구되지 않아 이후 편집이 히스토리에
      //    기록되지 않았다. 서버 왕복은 네트워크·타임아웃 실패가 정상 범위라 반드시 복구한다.
      canvas.onHistory()
      loadingBar.finish()
      editor?.emit('longTask:end')
    }
  },

  // 모양을 몰드로 설정
  setShapeAsMold: async (
    shape: FabricObject,
    canvas: FabricCanvas
  ): Promise<FabricObject | undefined> => {
    if (!shape) return undefined

    // 기존에 설정된 모양틀이면 해제
    if (shape.isMold || shape.hasMolding) {
      // 기존 + 아이콘 제거
      const existingIcon = canvas.getObjects().find((obj: FabricObject) =>
        obj.extensionType === 'moldIcon' && obj.id === `${shape.id}_moldIcon`
      )
      if (existingIcon) {
        canvas.remove(existingIcon)
      }

      // 기존 칼선 제거
      const existingOutline = canvas.getObjects().find((obj: FabricObject) =>
        obj.extensionType === 'outline' && obj.id === `${shape.id}_outline`
      )
      if (existingOutline) {
        canvas.remove(existingOutline)
      }

      // 이벤트 제거
      shape.off('mousedown')
      shape.off('mouseup')
      shape.off('moving')
      shape.isMold = false
      shape.hasMolding = false
      shape.hasCutting = false
      shape.extensionType = 'shape'
      canvas.renderAll()
      return shape
    }

    // 모양틀로 설정
    shape.set({
      extensionType: 'mold',
      hoverCursor: 'pointer',
      moveCursor: 'pointer',
      isMold: true,
      hasMolding: true
    })

    // 자동으로 칼선 생성
    const appStore = useAppStore.getState()
    const imagePlugin = appStore.getPlugin('ImageProcessingPlugin') as ImageProcessingPlugin
    if (!imagePlugin) {
      console.error('ImageProcessingPlugin을 찾을 수 없습니다')
      return shape
    }

    try {
      const { fillColor, strokeColor, strokeWidth, multiplier } = CUTTING_LINE_CONFIG

      const outline = await imagePlugin.createOffsetPathFromShape(shape, {
        fillColor: fillColor,
        includeStroke: false,
        stroke: strokeColor,
        strokeWidth: strokeWidth,
        multiplier: multiplier
      })

      if (outline) {
         
        (outline as any).alwaysTop = true
      }

      if (!outline) {
        console.error('칼선 생성에 실패했습니다')
        return shape
      }

      // + 아이콘 SVG 생성
      const iconSize = Math.min(shape.width!, shape.height!) / 8
      const plusSvg = `
        <svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="11" fill="rgba(0,0,0,0.6)" stroke="#fff" stroke-width="1"/>
          <path d="M12 6v12M6 12h12" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        </svg>
      `

      // core API를 사용하여 SVG 로드
      const plusIcon = await core.loadSVGFromString(plusSvg, {
        originX: 'center',
        originY: 'center',
        left: shape.getCenterPoint().x,
        top: shape.getCenterPoint().y,
        selectable: false,
        hasControls: false,
        hasBorders: false,
        absolutePositioned: true,
        evented: false,
        excludeFromExport: true,
        extensionType: 'template-element'
      }) as FabricObject

      // + 아이콘에 ID와 extensionType 설정
      plusIcon.id = `${shape.id}_moldIcon`
      plusIcon.extensionType = 'moldIcon'

      canvas.add(plusIcon)

      // 히스토리에 포함되도록 SVG 요소로 등록
       
      if (typeof (canvas as any).registerSvgElement === 'function') {
         
        ;(canvas as any).registerSvgElement(plusIcon)
      }

      // 칼선과 + 아이콘을 shape와 바인딩
       
      imagePlugin.bindWithMold(shape, outline as any, plusIcon)

      console.log('모양틀 생성 완료:', shape.id)
    } catch (error) {
      console.error('칼선 생성 오류:', error)
    }

    return shape
  }
}))

// Selector hooks
export const useUploading = () => useImageStore((state) => state.uploading)
export const useUploaded = () => useImageStore((state) => state.uploaded)
export const useUploadedPhotoMeta = () => useImageStore((state) => state.uploadedPhotoMeta)
