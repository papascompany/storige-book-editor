import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

/**
 * P2-d 사진인화 (2026-10-19): 사진틀 채움 스케일 회귀 가드.
 *  - fitMode 미설정(legacy)·inset 없음 → image 틀 cover = Math.max(frameW/imgW, frameH/imgH), 벡터 틀 = 폭 기준, clip scale = frame scale (종전 값과 동일)
 *  - D8/serialization-1: 벡터 틀 fitMode 'cover' 는 창을 가로·세로 모두 덮는 max 비율·창 중심, 'contain' 은 min
 *  - 창(window): `__frameWindow`(플러그인) 우선, 없으면 resolveFrameWindowFor(캔버스 workspace − bleed) 폴백, 캔버스를 모르면 frameInsetScale
 *  - tests-3: image(PNG, inverted clipPath) 틀은 inset 을 0 으로 취급(console.warn 1회)
 *  - 촬영일(extension.takenAt)은 사진인화 세트에서만 기록(legacy 세트는 extension 미기록)
 *  - contract-1/2: 사진인화 세트에서 채움 시 items[].lowRes(dpi < minDpi)·sourcePhotoId(업로드 파일 id / 외부 사진 id, 없으면 키 제거) 기록
 */
vi.mock('@/api', () => ({
  storageApi: { uploadFilePublic: vi.fn(), uploadFile: vi.fn() },
}))

import { FRAME_INSET_PX_RUNTIME_KEY, FRAME_WINDOW_RUNTIME_KEY, PHOTO_PRINT_BLEED_PX_RUNTIME_KEY, mmToPxDisplay } from '@storige/canvas-core'
import { resolveFillDpi, useImageStore } from './useImageStore'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useExternalPhotosStore } from '@/stores/useExternalPhotosStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'

interface Props { [k: string]: unknown }

function fakeFrame(over: Props = {}) {
  const frame: Props = {
    type: 'image',
    id: 'f1',
    extensionType: 'frame',
    width: 100,
    height: 50,
    scaleX: 2,
    scaleY: 2,
    angle: 0,
    flipX: false,
    flipY: false,
    getCenterPoint: () => ({ x: 10, y: 20 }),
    clone(cb: (c: Props) => void) {
      const cloned: Props = { set(p: Props) { Object.assign(cloned, p) } }
      cb(cloned)
    },
    bringToFront: vi.fn(),
    ...over,
  }
  return frame
}

function fakeImage(over: Props = {}) {
  const img: Props = {
    width: 400,
    height: 400,
    set(p: Props) { Object.assign(img, p) },
    setCoords: vi.fn(),
    ...over,
  }
  return img
}

const photoProfile: ProductProfile = {
  version: 1,
  kind: 'photo-print',
  editorType: 'photo_chem',
  pages: { kind: 'range', min: 1, max: 200, labelRule: 'photo' },
  sheet: { faces: 1, canvasLayout: 'canvas-per-sheet', binding: 'none', backRotation: 0, duplexFlip: 'short-edge' },
  photoPrint: {
    process: 'chemical',
    composition: 'per-photo-free-back',
    sizes: [{ code: '4x6', widthMm: 102, heightMm: 152, minDpi: 200 }],
    options: { border: ['none', 'white'], fit: ['paper-full', 'image-full'], finish: ['glossy'], brightnessFix: false, dateOverlay: true, grayscale: true },
    copies: { min: 1, max: 99 },
    upload: { maxPhotos: 200, maxMb: 25 },
  },
  output: { mode: 'single-pdf' },
}

const plugin = {} as never
const canvas = {} as never

beforeEach(() => {
  useSettingsStore.getState().setProductProfile(null)
  useImageStore.setState({ uploadedPhotoMeta: [], uploadedPhotoIdByUrl: {} })
  useExternalPhotosStore.getState().reset()
  usePhotoPrintStore.getState().reset()
  useAppStore.setState({ allCanvas: [], allEditors: [] } as never)
})

describe('fillImageIntoFrame — 스케일/clip 회귀', () => {
  it('legacy(fitMode 미설정·inset 없음): cover = max 비율, clip scale = 프레임 scale, extension 미기록', async () => {
    const frame = fakeFrame()
    const fore = fakeImage()
    const out = await useImageStore.getState().fillImageIntoFrame(canvas, fore, frame, plugin)
    expect(out).toBe(fore)
    // frameW=200, frameH=100, img 400×400 → max(0.5, 0.25) = 0.5
    expect(fore.scaleX).toBe(0.5)
    expect(fore.scaleY).toBe(0.5)
    const clip = fore.clipPath as Props
    expect(clip.scaleX).toBe(2)
    expect(clip.scaleY).toBe(2)
    expect(clip.inverted).toBe(true)
    expect(clip.absolutePositioned).toBe(true)
    expect(fore).not.toHaveProperty('extension')
    expect(fore.extensionType).toBe('fillImage')
    expect(fore.parentLayerId).toBe('f1')
    expect(frame.fillImage).toBe('f1_fillImage')
  })

  it("tests-3: image 틀 + fitMode 'contain' + __frameInsetPx 10 → inset 무시(min 비율·원래 창 기준, clip scale = 프레임 scale) + console.warn 1회", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const frame = fakeFrame({ fitMode: 'contain', [FRAME_INSET_PX_RUNTIME_KEY]: 10 })
    const fore = fakeImage()
    await useImageStore.getState().fillImageIntoFrame(canvas, fore, frame, plugin)
    // 창 축소 없음 → min(200/400, 100/400) = 0.25, clip 은 프레임 scale 그대로
    expect(fore.scaleX).toBe(0.25)
    expect(fore.scaleY).toBe(0.25)
    const clip = fore.clipPath as Props
    expect(clip.scaleX).toBe(2)
    expect(clip.scaleY).toBe(2)
    expect(clip.left).toBe(10)
    expect(clip.top).toBe(20)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('image(PNG)')
    warn.mockRestore()
  })

  it("tests-3: image 틀 + fitMode 'cover' + inset → 사진이 원래 창 전체를 덮는다(max 비율), 경고는 다시 찍지 않는다", async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const frame = fakeFrame({ fitMode: 'cover', [FRAME_INSET_PX_RUNTIME_KEY]: 10 })
    const fore = fakeImage()
    await useImageStore.getState().fillImageIntoFrame(canvas, fore, frame, plugin)
    expect(fore.scaleX).toBe(0.5) // max(200/400, 100/400) — 종전 cover 와 같다
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("image 틀 fitMode 'contain'(inset 없음): min 비율", async () => {
    const frame = fakeFrame({ fitMode: 'contain' })
    const fore = fakeImage()
    await useImageStore.getState().fillImageIntoFrame(canvas, fore, frame, plugin)
    expect(fore.scaleX).toBe(0.25) // min(200/400, 100/400)
    expect((fore.clipPath as Props).scaleX).toBe(2)
  })

  it('사진인화 세트: 외부 주입 사진·내 업로드 메타의 takenAt 을 extension 에 기록(기존 extension 과 spread 병합)', async () => {
    useSettingsStore.getState().setProductProfile(photoProfile)
    useExternalPhotosStore.getState().setPhotos([{ url: 'https://cdn/x.jpg', takenAt: '2026-05-01T09:00:00.000Z' }] as never)
    useImageStore.setState({ uploadedPhotoMeta: [{ url: 'https://api/u.jpg', takenAt: '2025-12-24T00:00:00.000Z', exifParsed: true }] })

    const a = fakeImage({ externalPhotoUrl: 'https://cdn/x.jpg', extension: { custom: 1 } })
    await useImageStore.getState().fillImageIntoFrame(canvas, a, fakeFrame(), plugin)
    expect(a.extension).toEqual({ custom: 1, takenAt: '2026-05-01T09:00:00.000Z' })

    const b = fakeImage({ getSrc: () => 'https://api/u.jpg' })
    await useImageStore.getState().fillImageIntoFrame(canvas, b, fakeFrame(), plugin)
    expect(b.extension).toEqual({ takenAt: '2025-12-24T00:00:00.000Z' })

    // 이미 extension.takenAt 이 있으면(클릭 채움 경로의 EXIF) 그 값 유지
    const c = fakeImage({ getSrc: () => 'https://api/u.jpg', extension: { takenAt: '2020-01-01' } })
    await useImageStore.getState().fillImageIntoFrame(canvas, c, fakeFrame(), plugin)
    expect(c.extension).toEqual({ takenAt: '2020-01-01' })

    // 원천 없음 → extension 미기록
    const d = fakeImage({ getSrc: () => 'blob:unknown' })
    await useImageStore.getState().fillImageIntoFrame(canvas, d, fakeFrame(), plugin)
    expect(d).not.toHaveProperty('extension')
  })

  it('legacy 세트: 원천에 takenAt 이 있어도 extension 을 기록하지 않는다(직렬화 바이트 동일)', async () => {
    useExternalPhotosStore.getState().setPhotos([{ url: 'https://cdn/x.jpg', takenAt: '2026-05-01T09:00:00.000Z' }] as never)
    const a = fakeImage({ externalPhotoUrl: 'https://cdn/x.jpg' })
    await useImageStore.getState().fillImageIntoFrame(canvas, a, fakeFrame(), plugin)
    expect(a).not.toHaveProperty('extension')
  })
})

describe('fillImage(벡터/모양 틀) — 스케일 회귀', () => {
  function vectorFrame(over: Props = {}) {
    return fakeFrame({ type: 'rect', extensionType: 'frame', ...over })
  }

  it('legacy: 폭 기준 산식(rearW/imgW) 그대로, clip 은 복제본 scale 유지', async () => {
    const rear = vectorFrame()
    const fore = fakeImage()
    await useImageStore.getState().fillImage(canvas, fore, rear, plugin)
    expect(fore.scaleX).toBe(0.5) // 200/400
    expect(fore.scaleY).toBe(0.5)
    const clip = fore.clipPath as Props
    expect(clip.id).toBe('f1_rearClip')
    expect(clip).not.toHaveProperty('scaleX')
    expect(rear.bringToFront).toHaveBeenCalled()
  })

  it("fitMode 'contain' + inset(캔버스 미상 → frameInsetScale 폴백): min 비율·축소된 창 기준, clip 복제본 scale 에 비율 곱·프레임 중심", async () => {
    const rear = vectorFrame({ fitMode: 'contain', [FRAME_INSET_PX_RUNTIME_KEY]: 10 })
    const fore = fakeImage()
    await useImageStore.getState().fillImage(canvas, fore, rear, plugin)
    expect(fore.scaleX).toBeCloseTo(0.2, 10)
    expect(fore.left).toBe(10)
    expect(fore.top).toBe(20)
    const clip = fore.clipPath as Props
    expect(clip.scaleX).toBeCloseTo(0.9, 10) // (undefined ?? 1) × 0.9
    expect(clip.scaleY).toBeCloseTo(0.8, 10)
    expect(clip.left).toBe(10)
    expect(clip.top).toBe(20)
  })

  // D8 / serialization-1: 페이퍼풀(cover)은 창을 가로·세로 모두 덮는다(가로 사진 × 세로 틀) — 플러그인 resolveFillScale 과 일치.
  it("D8: 1800×1200 사진 × 637.8×933 세로 rect 틀 fitMode 'cover' → scale 933/1200(0.7775), 창 중심 정렬", async () => {
    const rear = vectorFrame({ width: 637.8, height: 933, scaleX: 1, scaleY: 1, fitMode: 'cover', getCenterPoint: () => ({ x: 318.9, y: 466.5 }) })
    const fore = fakeImage({ width: 1800, height: 1200 })
    await useImageStore.getState().fillImage(canvas, fore, rear, plugin)
    expect(fore.scaleX).toBeCloseTo(933 / 1200, 6)
    expect(fore.scaleY).toBeCloseTo(933 / 1200, 6)
    expect(fore.left).toBe(318.9)
    expect(fore.top).toBe(466.5)
    const clip = fore.clipPath as Props
    expect(clip.left).toBe(318.9)
    expect(clip.top).toBe(466.5)
    expect(clip).not.toHaveProperty('scaleX')
  })

  it("D8: 4000×3000 × 602.4×897.6 'cover' → 0.2992; legacy(fitMode 미설정) 틀은 종전 폭 기준 0.3543 그대로", async () => {
    const fore = fakeImage({ width: 4000, height: 3000 })
    await useImageStore.getState().fillImage(canvas, fore, vectorFrame({ width: 602.4, height: 897.6, scaleX: 1, scaleY: 1, fitMode: 'cover' }), plugin)
    expect(fore.scaleX).toBeCloseTo(897.6 / 3000, 6) // 0.2992
    const legacyFore = fakeImage({ width: 1800, height: 1200 })
    await useImageStore.getState().fillImage(canvas, legacyFore, vectorFrame({ width: 637.8, height: 933, scaleX: 1, scaleY: 1 }), plugin)
    expect(legacyFore.scaleX).toBeCloseTo(637.8 / 1800, 6) // 0.3543
    expect(legacyFore.left).toBe(10)
    expect(legacyFore.top).toBe(20)
  })

  it("`__frameWindow`(플러그인 창) 가 있으면 창 크기·중심으로 cover 하고 clip 복제본도 창 중심·비율", async () => {
    const rear = vectorFrame({ fitMode: 'cover', [FRAME_INSET_PX_RUNTIME_KEY]: 10, [FRAME_WINDOW_RUNTIME_KEY]: { sx: 0.9, sy: 0.8, cx: 15, cy: 25 } })
    const fore = fakeImage()
    await useImageStore.getState().fillImage(canvas, fore, rear, plugin)
    // 창 180×80, 사진 400×400 → max(0.45, 0.2)
    expect(fore.scaleX).toBeCloseTo(0.45, 10)
    expect(fore.left).toBe(15)
    expect(fore.top).toBe(25)
    const clip = fore.clipPath as Props
    expect(clip.left).toBe(15)
    expect(clip.top).toBe(25)
    expect(clip.scaleX).toBeCloseTo(0.9, 10)
    expect(clip.scaleY).toBeCloseTo(0.8, 10)
  })

  it('`__frameWindow` 가 없고 캔버스를 알면 resolveFrameWindowFor(workspace − `__photoPrintBleedPx`) 폴백으로 같은 창을 만든다', async () => {
    const workspace: Props = { id: 'workspace', width: 300, height: 300, scaleX: 1, scaleY: 1, getCenterPoint: () => ({ x: 150, y: 150 }) }
    const cv: Props = { getObjects: () => [workspace] }
    // 프레임 박스: 중심(10,20) 200×100 → [-90,110]×[-30,70]; trim [0,300] 과 교집합 [0,110]×[0,70]; inset 10 → [10,100]×[10,60]
    const rear = vectorFrame({ fitMode: 'cover', [FRAME_INSET_PX_RUNTIME_KEY]: 10 })
    const fore = fakeImage()
    await useImageStore.getState().fillImage(cv, fore, rear, plugin)
    expect(fore.scaleX).toBeCloseTo(Math.max(90 / 400, 50 / 400), 10) // 0.225
    expect(fore.left).toBeCloseTo(55, 10)
    expect(fore.top).toBeCloseTo(35, 10)
    const clip = fore.clipPath as Props
    expect(clip.scaleX).toBeCloseTo(90 / 200, 10)
    expect(clip.scaleY).toBeCloseTo(50 / 100, 10)

    // 도련 5px: trim [5,295] → 교집합 [5,110]×[5,70] → inset 10 → [15,100]×[15,60]
    const cvBleed: Props = { getObjects: () => [workspace], [PHOTO_PRINT_BLEED_PX_RUNTIME_KEY]: 5 }
    const fore2 = fakeImage()
    await useImageStore.getState().fillImage(cvBleed, fore2, vectorFrame({ fitMode: 'cover', [FRAME_INSET_PX_RUNTIME_KEY]: 10 }), plugin)
    expect(fore2.left).toBeCloseTo(57.5, 10)
    expect(fore2.top).toBeCloseTo(37.5, 10)
    expect((fore2.clipPath as Props).scaleX).toBeCloseTo(85 / 200, 10)
    expect((fore2.clipPath as Props).scaleY).toBeCloseTo(45 / 100, 10)
  })

  it('런타임 inset 이 없어도 직렬화된 frameInsetMm(>0) 으로 창을 줄인다(undo 로 틀 인스턴스가 재생성된 경우)', async () => {
    const rear = vectorFrame({ fitMode: 'cover', frameInsetMm: 2 })
    const fore = fakeImage()
    await useImageStore.getState().fillImage(canvas, fore, rear, plugin)
    const inset = mmToPxDisplay(2)
    expect((fore.clipPath as Props).scaleX).toBeCloseTo((200 - inset * 2) / 200, 10)
  })
})

describe('contract-1/contract-2 — 채움 시 items[].lowRes·sourcePhotoId 기록(사진인화 세트)', () => {
  function wireCanvas() {
    const cv: Props = { id: 'c0', getObjects: () => [] as Props[] }
    useAppStore.setState({ allCanvas: [cv], allEditors: [{ getPlugin: () => undefined }] } as never)
    useSettingsStore.getState().setProductProfile(photoProfile)
    usePhotoPrintStore.getState().setFromProfile(photoProfile)
    usePhotoPrintStore.getState().syncWithCanvasCount(1)
    return cv
  }
  // 4x6(102×152mm) 창 = 602.4×897.6px(150dpi 화면 px)
  const frame4x6 = (over: Props = {}) => fakeFrame({ type: 'rect', width: 602.4, height: 897.6, scaleX: 1, scaleY: 1, fitMode: 'cover', ...over })

  it('resolveFillDpi: min(imgW/(wMm/25.4), imgH/(hMm/25.4)); 비유한 입력은 Infinity', () => {
    expect(resolveFillDpi(600, 900, mmToPxDisplay(102), mmToPxDisplay(152))).toBeCloseTo(Math.min(600 / (102 / 25.4), 900 / (152 / 25.4)), 6)
    expect(resolveFillDpi(0, 900, 602.4, 897.6)).toBe(Infinity)
    expect(resolveFillDpi(600, 900, 0, 897.6)).toBe(Infinity)
  })

  it('600×900 사진 → dpi ≈149 < minDpi 200 → lowRes true; 4000×3000 으로 교체 → false', async () => {
    const cv = wireCanvas()
    await useImageStore.getState().fillImage(cv, fakeImage({ width: 600, height: 900 }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(true)
    await useImageStore.getState().fillImage(cv, fakeImage({ width: 4000, height: 3000 }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(false)
  })

  it('sourcePhotoId: 내 업로드(files 레코드 id) → 기록, 외부 사진 id → 기록, 원천 없음 → 키 제거(런처 echo 금지)', async () => {
    const cv = wireCanvas()
    usePhotoPrintStore.getState().restore([{ sourcePhotoId: 'launcher-a', copies: 3 }])
    useImageStore.setState({ uploadedPhotoIdByUrl: { 'https://api/u.jpg': 'file-1' } })
    await useImageStore.getState().fillImage(cv, fakeImage({ width: 4000, height: 3000, getSrc: () => 'https://api/u.jpg' }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0]).toMatchObject({ sourcePhotoId: 'file-1', copies: 3, lowRes: false })

    useExternalPhotosStore.getState().setPhotos([{ url: 'https://cdn/x.jpg', id: 'ext-9' }] as never)
    await useImageStore.getState().fillImage(cv, fakeImage({ width: 4000, height: 3000, externalPhotoUrl: 'https://cdn/x.jpg' }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0].sourcePhotoId).toBe('ext-9')

    await useImageStore.getState().fillImage(cv, fakeImage({ width: 4000, height: 3000, getSrc: () => 'blob:unknown' }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0]).not.toHaveProperty('sourcePhotoId')
    expect(usePhotoPrintStore.getState().items[0].copies).toBe(3)
  })

  it('image(PNG) 틀 경로도 기록한다; legacy 세트·allCanvas 밖 캔버스는 기록하지 않는다', async () => {
    const cv = wireCanvas()
    await useImageStore.getState().fillImageIntoFrame(cv, fakeImage({ width: 300, height: 200 }), frame4x6({ type: 'image' }), plugin)
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(true)

    usePhotoPrintStore.getState().setItemMeta(0, { lowRes: false })
    await useImageStore.getState().fillImage({ id: 'ghost' } as never, fakeImage({ width: 300, height: 200 }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(false)

    useSettingsStore.getState().setProductProfile(null)
    await useImageStore.getState().fillImage(cv, fakeImage({ width: 300, height: 200 }), frame4x6(), plugin)
    expect(usePhotoPrintStore.getState().items[0].lowRes).toBe(false)
  })
})
