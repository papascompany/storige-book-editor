import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { recalculateSpineWidth, initSpineConfig } from './spineCalculator'

/**
 * R-195 — 호스트(주문) 지정 책등 폭의 spineCalculator 스프레드 경로 통합 동작.
 *
 * 모든 책등 트리거(초기 로드 12단계 / 내지 추가·삭제 debounce·즉시)는
 * recalculateSpineWidth → recalculateSpineWidthSpreadMode 로 수렴한다. 초기 로드만
 * `initial: true` 를 넘기고, 편집 중 트리거는 인자 없이(또는 signal 만) 부른다 — 여기서도 동일하게 호출한다.
 */

const calc = vi.fn()
vi.mock('@/api/spine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/spine')>()),
  spineApi: { calculate: (...args: unknown[]) => calc(...args) },
}))

interface FakeAppState {
  isSpreadMode: boolean
  allCanvas: unknown[]
  allEditors: unknown[]
}
let appState: FakeAppState
let settingsState: Record<string, any>
let editorState: Record<string, any>

vi.mock('@/stores/useAppStore', () => ({ useAppStore: { getState: () => appState } }))
vi.mock('@/stores/useSettingsStore', () => ({ useSettingsStore: { getState: () => settingsState } }))
vi.mock('@/stores/useEditorStore', () => ({ useEditorStore: { getState: () => editorState } }))

let resized: number[] = []
let spreadCanvasObjects: Array<{ meta?: Record<string, unknown> }> = []

/**
 * 스프레드 모드: 캔버스 n장 = 표지 1 + 내지 (n-1)p.
 * setSpineConfig 는 실물처럼 병합, updateSpreadSpineWidth 는 spec 을 갱신한다.
 */
function setupSpread(canvasCount: number, spreadExtra: Record<string, unknown> = {}) {
  resized = []
  spreadCanvasObjects = []
  const spreadPlugin = {
    getLayout: () => ({ totalWidthMm: 100 }),
    resizeSpine: async (w: number) => {
      resized.push(w)
    },
  }
  const spreadCanvas = { getObjects: () => spreadCanvasObjects }
  appState = {
    isSpreadMode: true,
    allCanvas: [spreadCanvas, ...new Array(Math.max(0, canvasCount - 1)).fill({})],
    allEditors: [{ getPlugin: (n: string) => (n === 'SpreadPlugin' ? spreadPlugin : undefined) }],
  }
  editorState = { pages: new Array(canvasCount).fill({}), pagesPerCanvas: 1 }
  settingsState = {
    spineConfig: { paperType: null, bindingType: null, calculatedSpineWidth: null },
    hasCoverSlot: true,
    spreadConfig: {
      regionScope: 'cover',
      conversionMode: 'full',
      spec: { spineWidthMm: 10 },
      ...spreadExtra,
    },
    editorTemplates: [],
    setSpineConfig(cfg: Record<string, unknown>) {
      settingsState.spineConfig = { ...settingsState.spineConfig, ...cfg }
    },
    updateSpreadSpineWidth(w: number) {
      settingsState.spreadConfig = {
        ...settingsState.spreadConfig,
        spec: { ...settingsState.spreadConfig.spec, spineWidthMm: w },
      }
    },
  }
}

function setCanvasCount(n: number) {
  const [spreadCanvas] = appState.allCanvas
  appState.allCanvas = [spreadCanvas, ...new Array(Math.max(0, n - 1)).fill({})]
  editorState.pages = new Array(n).fill({})
}

beforeEach(() => {
  calc.mockReset()
  calc.mockImplementation(async (params: { pageCount: number }) => ({
    spineWidth: params.pageCount / 2,
    paperThickness: 0.1,
    bindingMargin: 0,
    warnings: [],
    formula: 'test',
  }))
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('호스트 책등 미전달 — 기존 동작 불변', () => {
  it('초기 로드(initial)도 API 계산, 미설정 용지/제본은 mojo_80g/perfect 기본값 강제', async () => {
    setupSpread(21)
    initSpineConfig(null, null)
    const r = await recalculateSpineWidth({ initial: true })
    expect(calc).toHaveBeenCalledTimes(1)
    expect(calc.mock.calls[0][0]).toEqual({ pageCount: 20, paperType: 'mojo_80g', bindingType: 'perfect' })
    expect(r.success).toBe(true)
    expect(resized).toEqual([10])
    expect(settingsState.spineConfig).toMatchObject({
      paperType: 'mojo_80g',
      bindingType: 'perfect',
      calculatedSpineWidth: 10,
      hostSpineWidthMm: null,
      hostFixed: false,
      appliedSource: 'formula',
    })
  })
})

describe('호스트 책등 — 고정 모드 (용지/제본 누락 또는 0mm)', () => {
  it('초기 로드: API 없이 호스트 값을 resizeSpine/스토어/spec 에 적용, source=host', async () => {
    setupSpread(21)
    initSpineConfig(null, null, { spineWidthMm: 6.4 })
    expect(settingsState.spineConfig.hostFixed).toBe(true)
    const r = await recalculateSpineWidth({ initial: true })
    expect(calc).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, spineWidth: 6.4, pageCount: 20 })
    expect(resized).toEqual([6.4])
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(6.4)
    expect(settingsState.spineConfig).toMatchObject({
      calculatedSpineWidth: 6.4,
      hostBaselinePageCount: 20,
      appliedSource: 'host',
      // 기본값(mojo_80g/perfect)을 스토어에 강제 기록하지 않는다
      paperType: null,
      bindingType: null,
    })
  })

  it('편집 중 페이지 추가/삭제 트리거: API 호출 없이 스킵, 값 유지', async () => {
    setupSpread(21)
    initSpineConfig(null, null, { spineWidthMm: 6.4 })
    await recalculateSpineWidth({ initial: true })
    setCanvasCount(23)
    const add = await recalculateSpineWidth({ signal: new AbortController().signal })
    setCanvasCount(19)
    const del = await recalculateSpineWidth()
    expect(calc).not.toHaveBeenCalled()
    expect(add).toMatchObject({ success: false, skipped: true, spineWidth: 6.4 })
    expect(del).toMatchObject({ success: false, skipped: true, spineWidth: 6.4 })
    expect(resized).toEqual([6.4])
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(6.4)
  })

  it('용지/제본이 있어도 host 0 이면 고정 — 0mm 적용(책등 객체 없음)', async () => {
    setupSpread(21, { conversionMode: 'flat-spine' })
    // flat 책등 아트워크는 canvas-core 가 spine 영역 부재를 가드하므로 허용
    spreadCanvasObjects = [{ meta: { regionRef: null, flatArtwork: 'spine' } }]
    initSpineConfig('mojo_80g', 'perfect', { spineWidthMm: 0 })
    expect(settingsState.spineConfig.hostFixed).toBe(true)
    const r = await recalculateSpineWidth({ initial: true })
    expect(calc).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, spineWidth: 0 })
    expect(resized).toEqual([0])
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(0)
    setCanvasCount(25)
    expect(await recalculateSpineWidth()).toMatchObject({ skipped: true, spineWidth: 0 })
    expect(calc).not.toHaveBeenCalled()
  })

  it('host 0 + 책등 영역 소속 객체 존재 → 적용 차단(canvas-core resizeSpine(0) 예외 회피), 템플릿 폭 유지', async () => {
    setupSpread(21)
    spreadCanvasObjects = [{ meta: { regionRef: 'spine' } }]
    initSpineConfig('mojo_80g', 'perfect', { spineWidthMm: 0 })
    const r = await recalculateSpineWidth({ initial: true })
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/0mm/)
    expect(resized).toEqual([])
    expect(calc).not.toHaveBeenCalled()
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(10)
    expect(settingsState.spineConfig.appliedSource).toBeNull()
  })
})

describe('호스트 책등 — 비고정 모드 (용지·제본 있음 + host > 0)', () => {
  it('초기 로드는 호스트 값(API 생략), source=formula', async () => {
    setupSpread(21)
    initSpineConfig('mojo_80g', 'perfect', { spineWidthMm: 8.8 })
    expect(settingsState.spineConfig.hostFixed).toBe(false)
    await recalculateSpineWidth({ initial: true })
    expect(calc).not.toHaveBeenCalled()
    expect(resized).toEqual([8.8])
    expect(settingsState.spineConfig).toMatchObject({ calculatedSpineWidth: 8.8, appliedSource: 'formula' })
  })

  it('시드 루프 지연 트리거처럼 페이지 수가 기준선과 같으면 API 로 덮어쓰지 않는다', async () => {
    setupSpread(21)
    initSpineConfig('mojo_80g', 'perfect', { spineWidthMm: 8.8 })
    await recalculateSpineWidth({ initial: true })
    const r = await recalculateSpineWidth()
    expect(calc).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, spineWidth: 8.8 })
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(8.8)
  })

  it('페이지 증감 → 기존 API 재계산, 기준선 복귀 → 호스트 값 재적용', async () => {
    setupSpread(21)
    initSpineConfig('mojo_80g', 'perfect', { spineWidthMm: 8.8 })
    await recalculateSpineWidth({ initial: true })

    setCanvasCount(23) // 내지 22p
    const add = await recalculateSpineWidth()
    expect(calc).toHaveBeenCalledTimes(1)
    expect(calc.mock.calls[0][0]).toEqual({ pageCount: 22, paperType: 'mojo_80g', bindingType: 'perfect' })
    expect(add).toMatchObject({ success: true, spineWidth: 11 })
    expect(settingsState.spreadConfig.spec.spineWidthMm).toBe(11)

    setCanvasCount(21) // 원 주문 페이지 수로 복귀
    const back = await recalculateSpineWidth()
    expect(calc).toHaveBeenCalledTimes(1)
    expect(back).toMatchObject({ success: true, spineWidth: 8.8 })
    expect(resized).toEqual([8.8, 11, 8.8])
  })
})

describe('호스트 책등 — flat-spread / 내지 펼침면은 기존 가드 우선', () => {
  it('flat-spread: 호스트 값 무시, 템플릿 고정값 스킵', async () => {
    setupSpread(21, { conversionMode: 'flat-spread' })
    initSpineConfig(null, null, { spineWidthMm: 3 })
    const r = await recalculateSpineWidth({ initial: true })
    expect(r).toMatchObject({ skipped: true, spineWidth: 10 })
    expect(resized).toEqual([])
    expect(calc).not.toHaveBeenCalled()
  })

  it("regionScope='inner': 호스트 값 무시, 책등 없음 스킵", async () => {
    setupSpread(3, { regionScope: 'inner' })
    initSpineConfig(null, null, { spineWidthMm: 3 })
    const r = await recalculateSpineWidth({ initial: true })
    expect(r).toMatchObject({ skipped: true, spineWidth: null })
    expect(resized).toEqual([])
  })
})

describe("S5: 스프레드 경로 URL 폴백 정규화 ('-' / snake_case)", () => {
  it("URL paperType='-' 는 미지정 → 기본값, snake binding_type 수용", async () => {
    window.history.replaceState(null, '', '/embed?paperType=-&binding_type=%20saddle%20')
    setupSpread(21)
    initSpineConfig(null, null)
    await recalculateSpineWidth()
    expect(calc.mock.calls[0][0]).toEqual({ pageCount: 20, paperType: 'mojo_80g', bindingType: 'saddle' })
  })
})
