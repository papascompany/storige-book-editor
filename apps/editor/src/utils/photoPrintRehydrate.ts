import type Editor from '@storige/canvas-core'
import { mmToPxDisplay, type PhotoPrintCanvasOptions, type PhotoPrintPlugin } from '@storige/canvas-core'
import type { fabric } from 'fabric'
import {
  resolvePhotoFitMode,
  resolvePhotoFrameInsetMm,
  resolvePhotoItemCanvasIndex,
  type PhotoItem,
  type PhotoPrintProfile,
} from '@storige/types'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'
import { isPhotoPrintProfile, type PhotoPrintProductProfile } from '@/utils/productProfile'

/**
 * photoPrintRehydrate.ts — 사진인화 항목 옵션을 캔버스에 적용 (P2-d, 2026-10-19)
 *
 * `PhotoPrintPlugin.apply/rehydrate(opts)` 호출 지점. 항목(`usePhotoPrintStore.items[i]`)의 border/fit/dateOverlay/grayscale 를
 * 플러그인 옵션(§13-3: paper-full→cover, image-full→contain, white→frameInsetMm)으로 바꿔 그 항목의 캔버스
 * (chemical 1장, digital [앞, 뒤] 2장)에 적용한다. finish/brightnessFix/copies 는 통과만(편집기 미적용).
 *
 * 게이트: settings.productProfile 이 null 이거나 kind≠photo-print 면 즉시 0(legacy 세트 no-op).
 * 실패는 편집기 진입을 막지 않는다(catch 후 warn, 0 반환). calendarRehydrate 와 같은 모델.
 */

/** 항목 1건이 차지하는 캔버스 수 — chemical 1 / digital 2 */
export function photoPrintStride(photo: Pick<PhotoPrintProfile, 'process'>): 1 | 2 {
  return photo.process === 'digital' ? 2 : 1
}

/** 캔버스 인덱스 → 항목 순번(0부터). 음수·비정수면 -1 */
export function resolvePhotoItemIndexForCanvas(photo: Pick<PhotoPrintProfile, 'process'>, canvasIndex: number): number {
  if (!Number.isInteger(canvasIndex) || canvasIndex < 0) return -1
  return Math.floor(canvasIndex / photoPrintStride(photo))
}

/**
 * 템플릿셋 재단선 설정(settings.printMarkConfig)에서 도련 px — cropMarkEnabled && bleedMm>0 이면 mmToPxDisplay(bleedMm), 아니면 0.
 * 유테 창은 (프레임 ∩ (workspace − bleed)) 기준이라(D3) 도련 세트의 풀블리드 틀에서도 흰 띠가 재단 안에 남는다.
 */
export function resolvePhotoPrintBleedPx(
  printMark: { bleedMm: number; cropMarkEnabled: boolean } | null | undefined,
): number {
  if (!printMark || !printMark.cropMarkEnabled) return 0
  const mm = printMark.bleedMm
  if (typeof mm !== 'number' || !Number.isFinite(mm) || mm <= 0) return 0
  return mmToPxDisplay(mm)
}

/**
 * 항목 → 플러그인 옵션(§13-3 매핑). mmToPx 는 workspace 와 같은 화면 px 환산(mmToPxDisplay).
 * bleedPx(기본 0)는 `resolvePhotoPrintBleedPx(settings.printMarkConfig)` — apply/rehydrate 호출 전부가 전달한다.
 */
export function resolvePhotoPrintCanvasOptions(photo: PhotoPrintProfile, item: PhotoItem, bleedPx = 0): PhotoPrintCanvasOptions {
  return {
    fitMode: resolvePhotoFitMode(item.fit),
    frameInsetMm: resolvePhotoFrameInsetMm(photo, item.border),
    dateOverlay: item.dateOverlay,
    grayscale: item.grayscale,
    mmToPx: (mm: number) => mmToPxDisplay(mm),
    bleedPx,
  }
}

function currentProfile(): PhotoPrintProductProfile | null {
  const profile = useSettingsStore.getState().productProfile
  return isPhotoPrintProfile(profile) ? profile : null
}

async function applyToCanvas(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
  canvasIndex: number,
  mode: 'apply' | 'rehydrate',
): Promise<number> {
  const profile = currentProfile()
  if (!profile) return 0
  if (!editor || !canvas) return 0
  const plugin = editor.getPlugin<PhotoPrintPlugin>('PhotoPrintPlugin')
  if (!plugin) return 0

  const itemIndex = resolvePhotoItemIndexForCanvas(profile.photoPrint, canvasIndex)
  if (itemIndex < 0) return 0
  const store = usePhotoPrintStore.getState()
  const items = store.syncWithCanvasCount(useAppStore.getState().allCanvas.length)
  const item = items[itemIndex] ?? store.items[itemIndex]
  if (!item) return 0

  const opts = resolvePhotoPrintCanvasOptions(
    profile.photoPrint,
    item,
    resolvePhotoPrintBleedPx(useSettingsStore.getState().printMarkConfig),
  )
  try {
    return mode === 'rehydrate' ? await plugin.rehydrate(opts) : await plugin.apply(opts)
  } catch (error) {
    console.warn(`[photoPrintRehydrate] 옵션 ${mode} 실패(page ${canvasIndex}):`, error instanceof Error ? error.message : error)
    return 0
  }
}

/**
 * 캔버스 복원(loadJSON/loadFromJSON) 직후 호출 — 저장된 fitMode/frameInsetMm 로 런타임 inset·흑백 태그를 되살린다.
 * (rebindFrameInteractivity 와 같은 모델 — 복원 경로마다 한 줄 호출.)
 * @returns 처리한 사진틀 수
 */
export async function rehydratePhotoPrint(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
  canvasIndex: number,
): Promise<number> {
  return applyToCanvas(editor, canvas, canvasIndex, 'rehydrate')
}

/** 옵션 변경·사진 교체/삭제 뒤 한 캔버스에 현재 항목 옵션을 다시 적용 */
export async function applyPhotoPrintCanvas(
  editor: Editor | null | undefined,
  canvas: fabric.Canvas | null | undefined,
  canvasIndex: number,
): Promise<number> {
  return applyToCanvas(editor, canvas, canvasIndex, 'apply')
}

/** 캔버스 객체만 아는 호출자(useImageStore)용 — allCanvas 에서 인덱스·에디터를 찾는다. 프로파일 null 이면 즉시 0 */
export async function applyPhotoPrintForCanvas(canvas: fabric.Canvas | null | undefined): Promise<number> {
  if (!canvas || !currentProfile()) return 0
  const { allCanvas, allEditors } = useAppStore.getState()
  const idx = allCanvas.indexOf(canvas)
  if (idx < 0) return 0
  return applyToCanvas(allEditors[idx], canvas, idx, 'apply')
}

/** 항목 i 의 캔버스 전부(chemical 1장 / digital 앞·뒤 2장)에 옵션 적용. @returns 처리한 사진틀 수 합계 */
export async function applyPhotoPrintItem(itemIndex: number): Promise<number> {
  const profile = currentProfile()
  if (!profile) return 0
  const first = resolvePhotoItemCanvasIndex(profile, itemIndex)
  if (first < 0) return 0
  const stride = photoPrintStride(profile.photoPrint)
  const { allCanvas, allEditors } = useAppStore.getState()
  let total = 0
  for (let k = first; k < first + stride && k < allCanvas.length; k += 1) {
    total += await applyToCanvas(allEditors[k], allCanvas[k], k, 'apply')
  }
  return total
}
