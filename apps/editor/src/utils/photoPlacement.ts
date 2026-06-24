/**
 * 포토북 자동편집(autofill) — 프레임 배치 엔진 (Phase 3, 2026-06-24).
 *
 * 설계서 §7-1 (4. 프레임 매칭) + SKILL.md "블록 B — 사진 자동편집".
 *
 * 역할: 정렬된 사진 목록을 모든 캔버스(페이지)의 빈 사진틀(frame)에 배치한다.
 *   (a) 정렬     : sortPhotosForAutofill(photos, mode) 재사용(photoAutofill.ts import).
 *   (b) 빈 프레임 : extensionType==='frame' 이고 채워진 사진(fillImage)이 없는 프레임을
 *                  페이지(캔버스) 순서대로 수집.
 *   (c) aspect 매칭: 사진 가로세로비 ↔ 프레임 가로세로비 최근접 우선 배치(순수).
 *   (d) 채움     : useImageStore.fillImageIntoFrame 경로로 채움(마스킹/clipPath 재사용 —
 *                  중복 구현 없음). 결과 = 편집가능 시드(이후 자유 편집).
 *   (e) 저해상도 : effective_dpi = imgPx / frameInch 계산해 임계 미만이면 경고 수집.
 *
 * ⚠️ 순수/부수효과 분리:
 *   - 매칭(matchPhotosToFrames)·DPI 계산(computeEffectiveDpi)·프레임 측정(measureFrame)은 순수 함수.
 *   - 실제 캔버스 채움(autofillPhotosIntoFrames)만 부수효과(fabric 객체 로드/추가).
 *   - 테스트는 순수 함수(매칭·DPI·측정) 위주.
 *
 * 가드: photoAutofill.ts(sortPhotosForAutofill)·useImageStore(fillImageIntoFrame)는 호출만(불변).
 *       기존 frame 채우기 동작 비파괴.
 */
import type { ExternalPhoto, PhotoSortMode } from '@storige/types'
import { sortPhotosForAutofill } from './photoAutofill'

// ────────────────────────────────────────────────────────────────────────────
// 타입 (느슨한 fabric 타입 — useImageStore 와 동일하게 any 경유)
// ────────────────────────────────────────────────────────────────────────────


type FabricCanvas = any

type FabricObject = any

/** 사진을 프레임에 채우는 함수(useImageStore.fillImageIntoFrame 시그니처). 주입해 테스트 가능. */
export type FillFrameFn = (
  canvas: FabricCanvas,
  fore: FabricObject,
  frame: FabricObject,
  imagePlugin: unknown,
) => Promise<FabricObject>

/** URL → fabric.Image 로더(core.imageFromURL 시그니처). 주입해 테스트 가능. */
export type LoadImageFn = (url: string) => Promise<FabricObject>

export interface LowResWarning {
  /** 사진 URL */
  url: string
  /** 표시명(있으면) */
  name?: string
  /** 계산된 유효 인쇄 해상도(dpi) */
  effectiveDpi: number
  /** 임계 dpi(이 미만이라 경고) */
  thresholdDpi: number
}

export interface AutofillOptions {
  /** 정렬 기준(기본 'date'). photoAutofill.sortPhotosForAutofill 에 전달. */
  mode?: PhotoSortMode
  /** 저해상도 경고 임계 dpi (기본 150 — hard 권장, 절대 강제 아님). */
  lowResDpi?: number
  /** aspect 매칭 사용(기본 true). false 면 단순 순서 채움(MVP). */
  aspectMatch?: boolean
  /** 프레임 채움 함수(기본=호출처에서 useImageStore.fillImageIntoFrame 주입). */
  fillFrame: FillFrameFn
  /** URL→이미지 로더(기본=호출처에서 core.imageFromURL 주입). */
  loadImage: LoadImageFn
  /** fillFrame 에 전달할 ImageProcessingPlugin. */
  imagePlugin: unknown
  /** 채움 후 setActiveObject 등 호출처 후처리(선택). */
  onFilled?: (canvas: FabricCanvas, frame: FabricObject, fore: FabricObject) => void
}

export interface AutofillResult {
  /** 실제로 채운 (사진, 프레임) 쌍 수 */
  filledCount: number
  /** 채우지 못하고 남은 빈 프레임 수(사진 부족) */
  remainingFrames: number
  /** 배치되지 못한 사진 수(프레임 부족) */
  remainingPhotos: number
  /** 저해상도 경고 목록 */
  lowResWarnings: LowResWarning[]
}

// ────────────────────────────────────────────────────────────────────────────
// 순수 함수 — 프레임 측정 / DPI / aspect 매칭
// ────────────────────────────────────────────────────────────────────────────

/** 캔버스에서 사진 인쇄 해상도 산출에 쓰는 dpi. unit==='mm' 면 unitOptions.dpi(기본 150), 아니면 72(px=pt). */
export function canvasDpi(canvas: FabricCanvas): number {
  const uo = canvas?.unitOptions
  if (uo?.unit === 'mm') return uo.dpi || 150
  return 72
}

export interface FrameMeasure {
  /** 프레임 화면 폭(px, scale 반영) */
  widthPx: number
  /** 프레임 화면 높이(px, scale 반영) */
  heightPx: number
  /** 가로세로비 (width / height). 0 이하 입력은 1 로 폴백. */
  aspect: number
}

/** 프레임의 화면상 크기(scale 반영)와 가로세로비를 측정한다(순수). */
export function measureFrame(frame: FabricObject): FrameMeasure {
  const widthPx = Math.abs((frame.width || 0) * (frame.scaleX || 1))
  const heightPx = Math.abs((frame.height || 0) * (frame.scaleY || 1))
  const aspect = widthPx > 0 && heightPx > 0 ? widthPx / heightPx : 1
  return { widthPx, heightPx, aspect }
}

/** 이미지의 가로세로비 (width / height). 0 이하면 1 폴백(순수). */
export function imageAspect(img: { width?: number; height?: number }): number {
  const w = img.width || 0
  const h = img.height || 0
  return w > 0 && h > 0 ? w / h : 1
}

/**
 * 유효 인쇄 해상도(dpi) = 사진 픽셀 / 프레임 인쇄 인치.
 *   프레임 인쇄 인치 = framePx / canvasDpi  →  effectiveDpi = imgPx * canvasDpi / framePx.
 * cover 채움(짧은 변 기준 스케일)이라 가로/세로 각각의 유효 dpi 중 **작은 쪽**(= 가장 늘어나는 축)을
 * 보수적으로 채택한다. 측정 불가(0) → +Infinity(경고 안 띄움).
 */
export function computeEffectiveDpi(
  img: { width?: number; height?: number },
  frame: FrameMeasure,
  dpi: number,
): number {
  const iw = img.width || 0
  const ih = img.height || 0
  if (iw <= 0 || ih <= 0 || frame.widthPx <= 0 || frame.heightPx <= 0 || dpi <= 0) {
    return Number.POSITIVE_INFINITY
  }
  const dpiX = (iw * dpi) / frame.widthPx
  const dpiY = (ih * dpi) / frame.heightPx
  return Math.min(dpiX, dpiY)
}

export interface MatchPair<P, F> {
  photo: P
  frame: F
}

export interface MatchResult<P, F> {
  pairs: MatchPair<P, F>[]
  /** 매칭 안 된 사진(프레임 부족) */
  leftoverPhotos: P[]
  /** 매칭 안 된 프레임(사진 부족) */
  leftoverFrames: F[]
}

/**
 * 정렬된 사진과 (페이지 순서대로 수집된) 프레임을 1:1 매칭한다(순수).
 *
 * - aspectMatch=false: 순서대로 zip(MVP). 사진 순서(스토리 흐름) 100% 보존.
 * - aspectMatch=true : 사진 순서를 **페이지 순서대로 진행**하되, 각 사진을 아직 빈
 *   프레임 중 가로세로비가 가장 가까운 것에 배치한다. (가로사진→가로프레임)
 *   탐색을 "현재 사진 인덱스 부근 프레임"이 아니라 남은 프레임 전체에서 하므로
 *   스토리 순서를 크게 흐트러뜨리지 않으면서 형태 적합도를 높인다.
 *
 * 둘 다 사진/프레임 중 적은 쪽까지만 매칭하고 나머지는 leftover 로 반환.
 */
export function matchPhotosToFrames<
  P extends { aspect: number },
  F extends { aspect: number },
>(photos: P[], frames: F[], aspectMatch = true): MatchResult<P, F> {
  const pairs: MatchPair<P, F>[] = []

  if (!aspectMatch) {
    const n = Math.min(photos.length, frames.length)
    for (let i = 0; i < n; i++) pairs.push({ photo: photos[i], frame: frames[i] })
    return {
      pairs,
      leftoverPhotos: photos.slice(n),
      leftoverFrames: frames.slice(n),
    }
  }

  const remaining = frames.map((f, idx) => ({ f, idx }))
  const usedPhotos: boolean[] = new Array(photos.length).fill(false)

  for (let i = 0; i < photos.length && remaining.length > 0; i++) {
    const photo = photos[i]
    // 남은 프레임 중 aspect 차가 최소인 것(동률이면 페이지 순서 앞쪽)을 고른다.
    let bestK = 0
    let bestDiff = Number.POSITIVE_INFINITY
    for (let k = 0; k < remaining.length; k++) {
      const diff = Math.abs(remaining[k].f.aspect - photo.aspect)
      if (diff < bestDiff || (diff === bestDiff && remaining[k].idx < remaining[bestK].idx)) {
        bestDiff = diff
        bestK = k
      }
    }
    const chosen = remaining.splice(bestK, 1)[0]
    pairs.push({ photo, frame: chosen.f })
    usedPhotos[i] = true
  }

  const leftoverPhotos = photos.filter((_, i) => !usedPhotos[i])
  const leftoverFrames = remaining.sort((a, b) => a.idx - b.idx).map((r) => r.f)
  return { pairs, leftoverPhotos, leftoverFrames }
}

// ────────────────────────────────────────────────────────────────────────────
// 빈 프레임 수집 (순수에 가까움 — 캔버스 읽기만)
// ────────────────────────────────────────────────────────────────────────────

/** 프레임에 채워진 사진(fillImage)이 있는지 — fillImageIntoFrame 규약(parentLayerId/frameRef)과 동일 기준. */
export function isFrameFilled(canvas: FabricCanvas, frame: FabricObject): boolean {
  try {
    return canvas
      .getObjects()
      .some(
        (obj: FabricObject) =>
          obj.extensionType === 'fillImage' &&
          (obj.parentLayerId === frame.id || obj.frameRef === frame.id),
      )
  } catch {
    return false
  }
}

export interface CollectedFrame {
  canvas: FabricCanvas
  frame: FabricObject
  dpi: number
  measure: FrameMeasure
  aspect: number
}

/**
 * 모든 캔버스(페이지)에서 빈 사진틀을 페이지 순서대로 수집.
 * extensionType==='frame' 이고 채워진 사진이 없는 프레임만.
 */
export function collectEmptyFrames(canvases: FabricCanvas[]): CollectedFrame[] {
  const out: CollectedFrame[] = []
  for (const canvas of canvases) {
    let objs: FabricObject[]
    try {
      objs = canvas.getObjects()
    } catch {
      continue
    }
    const dpi = canvasDpi(canvas)
    for (const obj of objs) {
      if (obj.extensionType !== 'frame') continue
      if (isFrameFilled(canvas, obj)) continue
      const measure = measureFrame(obj)
      out.push({ canvas, frame: obj, dpi, measure, aspect: measure.aspect })
    }
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────────
// 배치 엔진 (부수효과 — 캔버스 채움)
// ────────────────────────────────────────────────────────────────────────────

/**
 * 자동편집 본체: 정렬 → 빈 프레임 수집 → aspect 매칭 → fillImageIntoFrame 채움 → 저해상도 경고.
 *
 * - 정렬·매칭·DPI 계산은 위 순수 함수 재사용.
 * - 실제 채움은 opts.loadImage(URL→Image) + opts.fillFrame(=useImageStore.fillImageIntoFrame)로만 수행
 *   (마스킹/clipPath/frameRef/parentLayerId/z-order 보정은 전부 fillImageIntoFrame 재사용 — 중복 없음).
 * - 한 사진 로드/채움 실패는 그 쌍만 건너뛰고 계속(부분 성공 허용).
 *
 * aspect 매칭은 이미지 픽셀 크기를 알아야 정확하므로, 매칭 전 단계에서는 ExternalPhoto 가 들고 있는
 * 정보가 없다 → 매칭은 **프레임 aspect 대비 사진 aspect** 가 필요. 사진 aspect 는 로드해야 알 수 있어
 * 비용이 크므로, 여기서는 "정렬된 사진 순서"를 우선 보존하고 프레임은 **순서대로** 매칭하는 것을 기본으로 하되,
 * aspectMatch=true 면 각 사진을 로드한 직후 측정한 aspect 로 "남은 빈 프레임 중 최근접"을 고른다(온라인 매칭).
 */
export async function autofillPhotosIntoFrames(
  canvases: FabricCanvas[],
  photos: ExternalPhoto[],
  opts: AutofillOptions,
): Promise<AutofillResult> {
  const mode = opts.mode ?? 'date'
  const lowResDpi = opts.lowResDpi ?? 150
  const aspectMatch = opts.aspectMatch ?? true

  const sorted = sortPhotosForAutofill(photos, mode)
  const emptyFrames = collectEmptyFrames(canvases)

  const lowResWarnings: LowResWarning[] = []
  let filledCount = 0

  // 남은 빈 프레임 풀(채울 때마다 제거). 페이지 순서 보존.
  const framePool = [...emptyFrames]
  let photoIdx = 0

  for (; photoIdx < sorted.length && framePool.length > 0; photoIdx++) {
    const photo = sorted[photoIdx]

    // 1) 사진 로드(부수효과). 실패 시 이 사진만 건너뛴다(프레임은 보존).
    let img: FabricObject
    try {
      img = await opts.loadImage(photo.url)
    } catch {
      continue
    }
    const imgAspect = imageAspect(img)

    // 2) 채울 프레임 선택: aspectMatch 면 남은 풀에서 aspect 최근접, 아니면 풀 앞(페이지 순서).
    let poolPos = 0
    if (aspectMatch) {
      let bestDiff = Number.POSITIVE_INFINITY
      for (let k = 0; k < framePool.length; k++) {
        const diff = Math.abs(framePool[k].aspect - imgAspect)
        if (diff < bestDiff) {
          bestDiff = diff
          poolPos = k
        }
      }
    }
    const target = framePool[poolPos]

    // 3) 채움(부수효과) — fillImageIntoFrame 경로 그대로(마스킹/링크/z-order 재사용).
    try {
      const fore = await opts.fillFrame(target.canvas, img, target.frame, opts.imagePlugin)
      target.canvas.add(fore)
      opts.onFilled?.(target.canvas, target.frame, fore)
      target.canvas.requestRenderAll?.()
      filledCount++

      // 4) 저해상도 경고(순수 계산).
      const effectiveDpi = computeEffectiveDpi(img, target.measure, target.dpi)
      if (isFinite(effectiveDpi) && effectiveDpi < lowResDpi) {
        lowResWarnings.push({
          url: photo.url,
          name: photo.name,
          effectiveDpi: Math.round(effectiveDpi),
          thresholdDpi: lowResDpi,
        })
      }
    } catch {
      // 채움 실패 → 이 프레임은 풀에서 빼지 않고 다음 사진에 다시 시도하지 않도록 photoIdx 만 진행.
      // (target 을 풀에 남겨도 다음 루프에서 같은 사진 재로드는 없으므로 무한루프 없음)
      continue
    }

    // 채운 프레임은 풀에서 제거.
    framePool.splice(poolPos, 1)
  }

  return {
    filledCount,
    remainingFrames: framePool.length,
    remainingPhotos: Math.max(0, sorted.length - photoIdx),
    lowResWarnings,
  }
}
