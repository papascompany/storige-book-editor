import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import axios from 'axios'
import { recalculateSpineWidth } from './spineCalculator'

/**
 * recalculateSpineWidth — 스테일 응답 경합 마감 (2026-08-26).
 *
 * 배경: 542fa18 의 runBulkPageOps 구간 게이트로 재진입 증설 루프 기인 다중 in-flight 는
 * 구조적으로 사라졌지만, **구간 밖 사용자 연타**('+내지'를 400~600ms 간격으로 누름 +
 * API 응답 지연)는 여전히 여러 요청을 동시에 띄운다. 이때 늦게 도착한 구(舊) pageCount
 * 응답이 최신 응답보다 나중에 효과를 적용하면 최종 책등 폭이 스테일 값으로 확정됐다.
 *
 * S1/S2/S5 는 **대조군**이다 — spineCalculator 의 세대 가드를 제거하면 즉시 실패하며,
 * 수정 전 프로덕션 동작(늦게 온 A 가 B 를 덮어쓴다)을 그대로 서술한다.
 * 기대값만 뒤집어 남기지 말 것.
 *
 * fake timers 를 쓰지 않는다: 이 결함은 타이머가 아니라 promise 인터리브라 지연을
 * gate resolver 로 결정적으로 제어한다. (debounce 경유 '호출 횟수' 계약은
 * stores/useAppStore.spineBatching.test.ts 소관 — 두 파일의 mock 전략이 상충한다.)
 */

// spineApi 만 대체하고 isRequestCancelled 는 실물을 쓴다(취소 판별식 자체가 검증 대상).
const calc = vi.fn()
vi.mock('@/api/spine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/spine')>()),
  spineApi: { calculate: (...args: unknown[]) => calc(...args) },
}))

// 스토어 3종은 통째로 대체한다(zustand 실물·persist 를 끌어오지 않는다).
type Applied = { via: string; w: number | null }
let applied: Applied[] = []

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

/** calculate 를 게이트로 붙잡는다. 반환 spineWidth = pageCount / 2 (요청별로 구분 가능한 값). */
let gates: Array<() => void> = []
function gateCalculate() {
  gates = []
  calc.mockImplementation(async (params: { pageCount: number }) => {
    await new Promise<void>((resolve) => {
      gates.push(resolve)
    })
    return {
      spineWidth: params.pageCount / 2,
      paperThickness: 0.1,
      bindingMargin: 0,
      warnings: [],
      formula: 'test',
    }
  })
}

/** resizeSpine 안의 await 를 붙잡는다(가드 ② 검증용). null 이면 즉시 완료. */
let resizeGate: (() => void) | null = null

/** 캔버스 개수만 바꾸는 헬퍼가 모드별 캔버스 형상을 유지하도록 팩토리를 기억한다. */
let canvasFactory: () => unknown = () => ({})

function setCanvasCount(n: number) {
  appState.allCanvas = new Array(n).fill(null).map(() => canvasFactory())
  editorState.pages = new Array(n).fill({})
}

function makeSettings(extra: Record<string, any>) {
  return {
    spineConfig: { paperType: 'mojo_80g', bindingType: 'perfect', calculatedSpineWidth: 1 },
    hasCoverSlot: true,
    setSpineConfig: (cfg: { calculatedSpineWidth?: number }) =>
      applied.push({ via: 'setSpineConfig', w: cfg.calculatedSpineWidth ?? null }),
    updateSpreadSpineWidth: (w: number) => applied.push({ via: 'updateSpreadSpineWidth', w }),
    ...extra,
  }
}

/** 스프레드 모드. 캔버스 n장 = 표지 1 + 내지 (n-1)p (pagesPerCanvas=1) */
function setupSpread(canvasCount: number) {
  const spreadPlugin = {
    getLayout: () => ({ totalWidthMm: 100 }),
    resizeSpine: async (w: number) => {
      if (resizeGate !== null) {
        await new Promise<void>((resolve) => {
          resizeGate = resolve
        })
      }
      applied.push({ via: 'resizeSpine', w })
    },
  }
  canvasFactory = () => ({})
  appState = {
    isSpreadMode: true,
    allCanvas: new Array(canvasCount).fill({}),
    allEditors: [{ getPlugin: (n: string) => (n === 'SpreadPlugin' ? spreadPlugin : undefined) }],
  }
  editorState = { pages: new Array(canvasCount).fill({}), pagesPerCanvas: 1 }
  settingsState = makeSettings({
    spreadConfig: { regionScope: 'cover', conversionMode: 'full', spec: { spineWidthMm: 1 } },
    editorTemplates: [],
  })
}

/** 비스프레드(단일) 모드. editorTemplates 에 spine 1개 → pageCount = 캔버스수 - 1 */
function setupSingle(canvasCount: number) {
  const workspacePlugin = {
    _options: { size: { width: 1, height: 297 } },
    setZoomAuto: () => {},
  }
  const workspaceObj = {
    id: 'workspace',
    set: (o: { width: number }) => applied.push({ via: 'workspaceObj.set', w: o.width }),
    setCoords: () => {},
  }
  canvasFactory = () => ({ getObjects: () => [workspaceObj], requestRenderAll: () => {} })
  appState = {
    isSpreadMode: false,
    allCanvas: new Array(canvasCount).fill(null).map(() => canvasFactory()),
    allEditors: new Array(canvasCount).fill(null).map(() => ({
      getPlugin: (n: string) => (n === 'WorkspacePlugin' ? workspacePlugin : undefined),
    })),
  }
  editorState = { pages: new Array(canvasCount).fill({}), pagesPerCanvas: 1 }
  settingsState = makeSettings({
    spreadConfig: undefined,
    editorTemplates: [{ pageType: 'spine' }],
  })
  return { workspacePlugin }
}

/** 호출이 calculate 안의 await 까지 진입하도록 한 틱 양보한다. */
const tick = () => Promise.resolve()
/** 대기 중인 마이크로태스크를 전부 흘려보낸다(실타이머). */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('recalculateSpineWidth — 스테일 응답 경합(세대 가드)', () => {
  beforeEach(() => {
    applied = []
    resizeGate = null
    calc.mockReset()
    gateCalculate()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('S1 [대조군] 늦게 도착한 스테일 응답이 최종 책등 폭을 덮어쓰지 않는다', async () => {
    setupSpread(9) // 내지 8p → 4mm (A, 느림)
    const pA = recalculateSpineWidth()
    await tick()
    setCanvasCount(10) // 내지 9p → 4.5mm (B, 빠름)
    const pB = recalculateSpineWidth()
    await tick()
    expect(gates).toHaveLength(2)

    gates[1]!() // B 먼저 도착
    expect(await pB).toMatchObject({ success: true, spineWidth: 4.5 })
    gates[0]!() // A(스테일) 나중 도착
    const rA = await pA

    expect(applied.at(-1)!.w).toBe(4.5)
    expect(rA.superseded).toBe(true)
    expect(rA.error).toBeUndefined() // 정상 경합 — 호출자 콘솔 경고를 유발하지 않는다
  })

  it('S2 [대조군] 스테일 응답은 효과 3종을 하나도 실행하지 않는다', async () => {
    setupSpread(9)
    const pA = recalculateSpineWidth()
    await tick()
    setCanvasCount(10)
    const pB = recalculateSpineWidth()
    await tick()

    gates[1]!()
    await pB
    gates[0]!()
    await pA

    expect(applied.map((a) => a.via)).toEqual([
      'resizeSpine',
      'setSpineConfig',
      'updateSpreadSpineWidth',
    ])
    expect(applied.map((a) => a.w)).not.toContain(4) // A 의 값이 어디에도 새지 않는다
  })

  it('S3 [비회귀] 단일 호출은 종전대로 resizeSpine→setSpineConfig→updateSpreadSpineWidth 를 적용한다', async () => {
    setupSpread(9)
    const p = recalculateSpineWidth()
    await tick()
    gates[0]!()
    const r = await p

    expect(r).toMatchObject({ success: true, spineWidth: 4, pageCount: 8 })
    expect(r.superseded).toBeUndefined()
    expect(applied).toEqual([
      { via: 'resizeSpine', w: 4 },
      { via: 'setSpineConfig', w: 4 },
      { via: 'updateSpreadSpineWidth', w: 4 },
    ])
  })

  it('S4 [역순] A 가 먼저 도착해도 최신 요청 B 가 최종값이다', async () => {
    setupSpread(9)
    const pA = recalculateSpineWidth()
    await tick()
    setCanvasCount(10)
    const pB = recalculateSpineWidth()
    await tick()

    gates[0]!() // A 먼저 도착 — 이미 구세대
    expect((await pA).superseded).toBe(true)
    gates[1]!()
    expect(await pB).toMatchObject({ success: true, spineWidth: 4.5 })

    expect(applied.map((a) => a.w)).toEqual([4.5, 4.5, 4.5])
  })

  it('S4b [가드 ②] resizeSpine 대기 중 새 세대가 뜨면 스토어 쓰기를 건너뛴다', async () => {
    setupSpread(9)
    resizeGate = () => {} // 게이트 모드 on (진입 시 실제 resolver 로 교체된다)
    const pA = recalculateSpineWidth()
    await tick()
    gates[0]!()
    await flush() // A 가 resizeSpine 안의 await 에 진입

    setCanvasCount(10)
    const pB = recalculateSpineWidth() // A 가 매달린 사이 B 발사 → A 는 구세대
    await tick()

    resizeGate!()
    const rA = await pA
    // 스토어 쓰기(setSpineConfig/updateSpreadSpineWidth)에는 A 몫이 하나도 없어야 한다.
    expect(applied.filter((a) => a.via !== 'resizeSpine')).toEqual([])
    expect(rA.superseded).toBe(true)
    expect(rA.spineWidth).toBe(4) // 레이아웃은 이미 바뀐 뒤라 값 자체는 반환한다

    resizeGate = null
    gates[1]!()
    expect(await pB).toMatchObject({ success: true, spineWidth: 4.5 })
  })

  it('S5 [비스프레드 대칭] 스테일 응답이 workspace 크기·스토어를 건드리지 않는다', async () => {
    const { workspacePlugin } = setupSingle(9) // spine 1개 → pageCount 8 → 4mm
    const pA = recalculateSpineWidth()
    await tick()
    setCanvasCount(10) // pageCount 9 → 4.5mm
    const pB = recalculateSpineWidth()
    await tick()
    expect(gates).toHaveLength(2)

    gates[1]!()
    expect(await pB).toMatchObject({ success: true, spineWidth: 4.5 })
    gates[0]!()
    const rA = await pA

    // 스테일 A 는 workspace 크기도, 플러그인 옵션도, 스토어도 건드리지 않는다.
    expect(applied.map((a) => a.via)).toEqual(['workspaceObj.set', 'setSpineConfig'])
    expect(applied.at(-1)!.w).toBe(4.5)
    expect(workspacePlugin._options.size.width).toBe(4.5)
    expect(rA.superseded).toBe(true)
  })

  it('S6 [배선] AbortSignal 이 HTTP 로 전달되고, 새 요청이 이전 요청을 끊는다', async () => {
    setupSpread(9)
    const pA = recalculateSpineWidth()
    await tick()
    const firstSignal = (calc.mock.calls[0]![1] as { signal?: AbortSignal } | undefined)?.signal
    expect(firstSignal).toBeInstanceOf(AbortSignal)
    expect(firstSignal!.aborted).toBe(false)

    setCanvasCount(10)
    const pB = recalculateSpineWidth()
    await tick()
    expect(firstSignal!.aborted).toBe(true)

    gates[0]!()
    gates[1]!()
    await Promise.all([pA, pB])
  })

  it('S6b [배선] 호출자가 넘긴 signal 의 취소가 spineApi 로 전달하는 signal 로 전파된다', async () => {
    // ⚠️ 이 파일은 @/api/spine 을 mock 하므로 여기까지가 증명 범위다.
    //    그 signal 이 axios config 로 실제로 넘어가는지는 api/spine.test.ts 소관.
    setupSpread(9)
    const controller = new AbortController()
    const p = recalculateSpineWidth({ signal: controller.signal })
    await tick()
    const sig = (calc.mock.calls[0]![1] as { signal: AbortSignal }).signal
    expect(sig.aborted).toBe(false)
    controller.abort()
    expect(sig.aborted).toBe(true)

    gates[0]!()
    await p
  })

  it('S7 [반환 계약] 취소 에러는 superseded 로 삼키고 console.error 로 새지 않는다', async () => {
    setupSpread(9)
    calc.mockRejectedValueOnce(new axios.CanceledError('canceled'))
    const r = await recalculateSpineWidth()

    expect(r).toMatchObject({ success: false, superseded: true })
    expect(r.error).toBeUndefined()
    expect(r.skipped).toBeUndefined() // 정상 스킵(flat-spread)과도 구분된다
    expect(console.error).not.toHaveBeenCalled()
    expect(applied).toEqual([])
  })

  it('S7b [반환 계약] 진짜 실패는 종전대로 error 를 채우고 로그를 남긴다', async () => {
    setupSpread(9)
    calc.mockRejectedValueOnce(new Error('boom'))
    const r = await recalculateSpineWidth()

    expect(r).toMatchObject({ success: false, error: 'boom' })
    expect(r.superseded).toBeUndefined()
    expect(console.error).toHaveBeenCalled()
  })

  it('S7c [비스프레드 대칭] 단일 모드 취소도 superseded 로 삼키고 로그를 남기지 않는다', async () => {
    // 스프레드(S7)와 비스프레드는 catch 가 서로 다른 블록이다 — 한쪽만 고치면
    // 나머지는 취소 때마다 console.error 를 뿜는다. 두 경로를 대칭으로 고정한다.
    setupSingle(9)
    calc.mockRejectedValueOnce(new axios.CanceledError('canceled'))
    const r = await recalculateSpineWidth()

    expect(r).toMatchObject({ success: false, superseded: true })
    expect(r.error).toBeUndefined()
    expect(console.error).not.toHaveBeenCalled()
    expect(applied).toEqual([])
  })

  it('S8 [우회 경로] 컨트롤러 없는 직접 호출(deletePage 경로)도 같은 가드를 탄다', async () => {
    setupSpread(9)
    const pA = recalculateSpineWidth() // deletePage 는 signal 없이 맨손 호출한다
    await tick()
    setCanvasCount(10)
    const pB = recalculateSpineWidth()
    await tick()

    gates[1]!()
    await pB
    gates[0]!()
    const rA = await pA
    expect(applied.at(-1)!.w).toBe(4.5)
    expect(rA.superseded).toBe(true)
  })

  it('S9 [기존 가드 불변] inner/flat-spread 는 skipped 로 즉시 반환하고 세대를 소비하지 않는다', async () => {
    setupSpread(9)
    const pA = recalculateSpineWidth() // 살아있는 in-flight
    await tick()
    const base = settingsState.spreadConfig

    settingsState.spreadConfig = { ...base, regionScope: 'inner' }
    const rInner = await recalculateSpineWidth()
    expect(rInner).toMatchObject({ success: false, skipped: true })
    expect(rInner.superseded).toBeUndefined()

    settingsState.spreadConfig = { ...base, conversionMode: 'flat-spread' }
    const rFlat = await recalculateSpineWidth()
    expect(rFlat).toMatchObject({ success: false, skipped: true, spineWidth: 1 })
    expect(rFlat.superseded).toBeUndefined()

    // 스킵 호출들이 세대를 올리지도, in-flight 를 끊지도 않았으므로 A 는 여전히 최신이다.
    settingsState.spreadConfig = base
    expect(calc).toHaveBeenCalledTimes(1)
    gates[0]!()
    expect(await pA).toMatchObject({ success: true, spineWidth: 4 })
    expect(applied.at(-1)!.w).toBe(4)
  })
})
