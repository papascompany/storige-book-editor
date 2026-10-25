// 캘린더 디자인(스킨) 적용 오케스트레이터 — fabric 없이 주입 의존성·가짜 캔버스로 순서·롤백·판정 집합을 검증한다.
// 병합은 canvas-core 실물(mergeSkinCanvas)을 감싼 spy 로 호출 인자를 본다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProductProfile } from '@storige/types'

const spies = vi.hoisted(() => ({ merge: vi.fn(), actualMerge: null as unknown as (...a: unknown[]) => unknown }))
vi.mock('@storige/canvas-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@storige/canvas-core')>()
  spies.actualMerge = actual.mergeSkinCanvas as unknown as (...a: unknown[]) => unknown
  return { ...actual, mergeSkinCanvas: (...a: Parameters<typeof actual.mergeSkinCanvas>) => spies.merge(...a) }
})
vi.mock('@/hooks/useEditorContents', () => ({ applyCustomerLocks: vi.fn() }))

import { useCalendarSkinStore } from '@/stores/useCalendarSkinStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore, type LinkedPrintTemplate } from '@/stores/useSettingsStore'
import {
  __resetAutosaveSuspendForTest,
  deferUntilAutosaveResumed,
  isAutosaveSuspended,
  runWithAutosaveSuspended,
} from '@/utils/autosaveSuspend'
import { __resetSaveNowRegistryForTest } from '@/utils/saveNowRegistry'
import {
  SKIN_LONG_TASK_MESSAGE,
  SKIN_LOAD_TIMEOUT_MS,
  __resetSkinApplyForTest,
  createDefaultSkinApplyDeps,
  executeSkinApply,
  prepareSkinApply,
  resolveSkinSection,
  undoSkinApply,
  type SkinApplyDeps,
  type SkinApplyPlan,
  type SkinCanvasHandle,
} from './calendarSkinApply'

type Plain = Record<string, unknown>
const API = 'http://localhost:4000/api'
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

// ─── 픽스처 ────────────────────────────────────────────────────────────────

const WS: Plain = { type: 'rect', id: 'workspace', left: 0, top: 0, width: 100, height: 100 }
const frame = (id: string, over: Plain = {}): Plain => ({ type: 'rect', id, extensionType: 'frame', left: 10, top: 10, width: 50, height: 50, ...over })
const grid = (id: string): Plain => ({ type: 'group', id, extensionType: 'calendar-grid', deleteable: false, objects: [] })
const text = (id: string, t: string): Plain => ({ type: 'textbox', id, text: t })

/** 캔버스 2장짜리 세트(표지·1월 앞면 위치) — 기준(b-*), 복제 스킨(spring, 같은 id), 새 제작 스킨(winter, w-*), 다른 스킨(third, t-*) */
const BASE_T = [
  [WS, { type: 'rect', id: 'b-bg', extensionType: 'background' }, frame('b-frame0'), text('b-title', '제목'), grid('b-grid0')],
  [WS, frame('b-frame1'), grid('b-grid1')],
]
const SPRING_T = BASE_T.map((objs) => objs.map((o) => (o.id === 'workspace' ? o : { ...o, fill: '#f00' })))
const WINTER_T = [
  [WS, { type: 'rect', id: 'w-bg', extensionType: 'background' }, frame('w-frame0'), text('w-title', '겨울'), grid('w-grid0')],
  [WS, frame('w-frame1'), grid('w-grid1')],
]
const THIRD_T = [
  [WS, { type: 'rect', id: 't-deco0' }, frame('t-frame0'), grid('t-grid0')],
  [WS, frame('t-frame1'), grid('t-grid1')],
]

function calendarProfile(skins: Array<{ key: string; label: string; templateSetId: string; thumbnailUrl?: string }> = SKINS): ProductProfile {
  return {
    version: 1,
    kind: 'calendar',
    editorType: 'calendar_desk',
    pages: { kind: 'fixed', count: 2, labelRule: 'month' },
    sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'same-sheet', backRotation: 0, duplexFlip: 'short-edge' },
    calendar: {
      layout: 'desk',
      monthCount: 12,
      coverCanvases: 1,
      canvasesPerMonth: 2,
      epilogueCanvases: 1,
      allowedRange: { from: '2027-01', to: '2027-12' },
      weekStart: 0,
      show: { holidays: true, lunar: false, solarTerms: false },
      dataVersion: 'kr-2025-2035-v1',
      skins,
    },
    output: { mode: 'single-pdf' },
  } as ProductProfile
}
const SKINS = [
  { key: 'spring', label: '봄', templateSetId: 'set-spring' },
  { key: 'winter', label: '겨울', templateSetId: 'set-winter', thumbnailUrl: '/storage/files/w.png' },
  { key: 'third', label: '셋째', templateSetId: 'set-third' },
]

function setOf(id: string, templates: Plain[][], over: Plain = {}) {
  return {
    templateSet: { id, name: id, siteId: 'site-a', width: 100, height: 100, productProfile: calendarProfile(), ...over },
    templateDetails: templates.map((objects, i) => ({ id: `${id}-tpl${i}`, canvasData: { version: '5.3.0', objects: clone(objects) } })),
  }
}

let sets: Record<string, ReturnType<typeof setOf>>

// ─── 가짜 캔버스 ────────────────────────────────────────────────────────────

interface FakeCanvas {
  idx: number
  objects: Plain[]
  handlers: Record<string, Array<() => void>>
  getObjects: () => Plain[]
  offHistory: () => void
  onHistory: () => void
  clearHistory: () => void
  requestRenderAll: () => void
  on: (ev: string, fn: () => void) => void
  off: (ev: string, fn: () => void) => void
  fire: (ev: string) => void
}

let log: string[]

function toFake(o: Plain): Plain {
  return { ...clone(o), setCoords: () => undefined }
}

function makeCanvas(idx: number, objects: Plain[]): FakeCanvas {
  const c: FakeCanvas = {
    idx,
    objects: objects.map(toFake),
    handlers: {},
    getObjects: () => c.objects,
    offHistory: () => log.push(`offHistory${idx}`),
    onHistory: () => log.push(`onHistory${idx}`),
    clearHistory: () => log.push(`clearHistory${idx}`),
    requestRenderAll: () => undefined,
    on: (ev, fn) => {
      ;(c.handlers[ev] ??= []).push(fn)
    },
    off: (ev, fn) => {
      c.handlers[ev] = (c.handlers[ev] ?? []).filter((f) => f !== fn)
    },
    fire: (ev) => {
      for (const f of [...(c.handlers[ev] ?? [])]) f()
    },
  }
  return c
}

let canvases: FakeCanvas[]
let pendingFrame: (() => void) | null

function handles(): SkinCanvasHandle[] {
  return canvases.map((c) => ({ canvas: c as never, editor: { id: c.idx } as never }))
}

/** fabric toJSON 처럼 런타임 표지(dirty)는 직렬화하지 않는다 */
const serialize = (c: FakeCanvas) => ({ version: '5.3.0', objects: clone(c.objects).map(({ dirty: _d, ...o }) => o) })

function makeDeps(over: Partial<SkinApplyDeps> = {}): Partial<SkinApplyDeps> {
  return {
    fetchSet: vi.fn(async (id: string) => {
      const s = sets[id]
      if (!s) throw { status: 404 }
      return clone(s) as never
    }),
    getSaveNow: () => undefined,
    suspend: (fn) => runWithAutosaveSuspended(fn),
    getHandles: () => handles(),
    serialize: (c) => serialize(c as unknown as FakeCanvas) as never,
    loadJSON: vi.fn(async (_e, c, json) => {
      const fc = c as unknown as FakeCanvas
      log.push(`load${fc.idx}`)
      fc.objects = (json.objects as Plain[]).map(toFake)
    }),
    resizeWorkspace: (c) => log.push(`resize${(c as unknown as FakeCanvas).idx}`),
    rebind: (_e, c) => log.push(`rebind${(c as unknown as FakeCanvas).idx}`),
    rehydrateStrict: vi.fn(async (_e, c, i) => {
      log.push(`grid${i}`)
      return { ok: true, count: (c as unknown as FakeCanvas).objects.filter((o) => o.extensionType === 'calendar-grid').length }
    }),
    rehydratePhotoPrint: async (_e, _c, i) => {
      log.push(`photoPrint${i}`)
      return 0
    },
    applyLocks: (c) => log.push(`locks${(c as unknown as FakeCanvas).idx}`),
    trackRequired: (c) => log.push(`required${(c as unknown as FakeCanvas).idx}`),
    loadImage: vi.fn(async (src: string) => ({ src }) as never),
    fillFrame: vi.fn(async (_e, c, _img, fr) => {
      log.push(`fill${(c as unknown as FakeCanvas).idx}:${String((fr as Plain).id)}`)
    }),
    keepUploads: vi.fn(async () => undefined),
    emit: (ev, payload) => log.push(payload ? `${ev}:${(payload as { message: string }).message}` : ev),
    apiBase: () => API,
    requestFrame: (cb) => {
      pendingFrame = cb
    },
    ...over,
  }
}

/** 현재 세션 캔버스 — 기준 디자인 + 표지 틀에 채운 사진 */
function sessionObjects(extra0: Plain[] = [], extra1: Plain[] = []): Plain[][] {
  return [
    [...clone(BASE_T[0]), { type: 'image', id: 'photo0', frameRef: 'b-frame0', src: '/storage/uploads/p0.jpg', left: 10, top: 10, width: 50, height: 50 }, ...extra0],
    [...clone(BASE_T[1]), ...extra1],
  ]
}

function linked(templates: Plain[][]): LinkedPrintTemplate[] {
  return templates.map((objects, i) => ({ id: `base-tpl${i}`, name: `t${i}`, type: 'page', width: 100, height: 100, thumbnailUrl: i === 0 ? '/storage/files/b.png' : null, canvasData: { objects: clone(objects) } }) as LinkedPrintTemplate)
}

function setup(objects: Plain[][] = sessionObjects(), profile: ProductProfile = calendarProfile()) {
  canvases = objects.map((o, i) => makeCanvas(i, o))
  useSettingsStore.getState().setProductProfile(profile)
  useSettingsStore.setState({
    customerPreview: false,
    linkedPrintTemplates: linked(BASE_T),
    currentSettings: { ...useSettingsStore.getState().currentSettings, editMode: false },
  } as never)
  useCalendarStore.getState().setFromProfile(profile)
  useCalendarSkinStore.getState().reset()
  useCalendarSkinStore.getState().setBase('base')
  useEditorStore.setState({ pages: canvases.map((_, i) => ({ id: `p${i}` })) } as never)
}

const markDirty = vi.fn()

beforeEach(() => {
  log = []
  pendingFrame = null
  spies.merge.mockReset().mockImplementation((...a: unknown[]) => spies.actualMerge(...a))
  markDirty.mockReset()
  __resetAutosaveSuspendForTest()
  __resetSaveNowRegistryForTest()
  __resetSkinApplyForTest()
  sets = {
    base: setOf('base', BASE_T),
    'set-spring': setOf('set-spring', SPRING_T),
    'set-winter': setOf('set-winter', WINTER_T),
    'set-third': setOf('set-third', THIRD_T),
  }
  useSaveStore.setState({ status: 'saved', isDirty: false, markDirty } as never)
  setup()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

async function confirmPlan(key: string | undefined, deps = makeDeps()): Promise<SkinApplyPlan> {
  const out = await prepareSkinApply(key, deps)
  if (out.kind !== 'confirm') throw new Error(`confirm 아님: ${JSON.stringify(out.kind === 'rejected' ? out.reason : out.kind)}`)
  return out.plan
}

const idsOf = (c: FakeCanvas) => c.objects.map((o) => o.id)

// ─── 노출·가드 ──────────────────────────────────────────────────────────────

describe('prepareSkinApply — 노출 조건·진입 가드', () => {
  it('NULL 프로파일·비캘린더·skins 없음·플래그 off·editMode·기준 세트 미상 → disabled, 조회 0회', async () => {
    const cases: Array<() => void> = [
      () => useSettingsStore.getState().setProductProfile(null),
      () => useSettingsStore.getState().setProductProfile({ ...calendarProfile(), kind: 'sheet' } as ProductProfile),
      () => useSettingsStore.getState().setProductProfile(calendarProfile([])),
      () => vi.stubEnv('VITE_ENABLE_CALENDAR_SKINS', 'false'),
      () => useSettingsStore.setState({ currentSettings: { ...useSettingsStore.getState().currentSettings, editMode: true } } as never),
      () => useCalendarSkinStore.getState().reset(),
    ]
    for (const apply of cases) {
      setup()
      vi.unstubAllEnvs()
      apply()
      const deps = makeDeps()
      expect(resolveSkinSection().visible).toBe(false)
      expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'disabled' })
      expect(deps.fetchSet).not.toHaveBeenCalled()
    }
  })

  it("플래그는 정확히 'false' 일 때만 끈다", () => {
    vi.stubEnv('VITE_ENABLE_CALENDAR_SKINS', 'FALSE')
    expect(resolveSkinSection().visible).toBe(true)
    vi.stubEnv('VITE_ENABLE_CALENDAR_SKINS', 'false')
    expect(resolveSkinSection().visible).toBe(false)
  })

  it('저장 중이면 거부하고 조회하지 않는다', async () => {
    useSaveStore.setState({ status: 'saving' } as never)
    const deps = makeDeps()
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'saving' })
    expect(deps.fetchSet).not.toHaveBeenCalled()
  })

  it('고객 미리보기 중이면 거부한다', async () => {
    useSettingsStore.setState({ customerPreview: true } as never)
    expect(await prepareSkinApply('winter', makeDeps())).toEqual({ kind: 'rejected', reason: 'preview' })
  })

  it('현재 디자인 카드를 다시 누르면 noop', async () => {
    const deps = makeDeps()
    expect(await prepareSkinApply(undefined, deps)).toEqual({ kind: 'noop' })
    useCalendarStore.getState().setSkinKey('winter')
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'noop' })
    expect(deps.fetchSet).not.toHaveBeenCalled()
  })
})

// ─── 원천 조회·호환 ─────────────────────────────────────────────────────────

describe('prepareSkinApply — 원천 재조회·호환 재검사', () => {
  it('대상 404 → missing(세션 캐시), loadJSON 0회', async () => {
    delete sets['set-winter']
    const deps = makeDeps()
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'missing' })
    expect(useCalendarSkinStore.getState().cardReasons).toEqual({ winter: 'missing' })
    expect(deps.loadJSON).not.toHaveBeenCalled()
  })

  it('네트워크·5xx 는 network 이고 캐시하지 않는다', async () => {
    const deps = makeDeps({ fetchSet: vi.fn(async (id: string) => {
      if (id === 'set-winter') throw { status: 503 }
      return clone(sets[id]) as never
    }) })
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'network' })
    expect(useCalendarSkinStore.getState().cardReasons).toEqual({})
  })

  it('사이트 불일치 → incompatible(캐시), 적용 0 — 지난번 통과했어도 매번 다시 받아 검사한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeDeps()
    expect((await prepareSkinApply('winter', deps)).kind).toBe('confirm')
    sets['set-winter'] = setOf('set-winter', WINTER_T, { siteId: 'site-b' })
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'incompatible' })
    expect(useCalendarSkinStore.getState().cardReasons).toEqual({ winter: 'incompatible' })
    expect(deps.loadJSON).not.toHaveBeenCalled()
  })

  it('기준 세트 404 → base-unavailable(절 전체 비활성)', async () => {
    delete sets.base
    expect(await prepareSkinApply('winter', makeDeps())).toEqual({ kind: 'rejected', reason: 'base-unavailable' })
    expect(useCalendarSkinStore.getState().baseUnavailable).toBe(true)
  })

  it('캔버스 수 불일치 → incompatible, 적용 0', async () => {
    setup([...sessionObjects(), [WS]])
    useEditorStore.setState({ pages: [{ id: 'p0' }, { id: 'p1' }, { id: 'p2' }] } as never)
    const deps = makeDeps()
    expect(await prepareSkinApply('winter', deps)).toEqual({ kind: 'rejected', reason: 'incompatible' })
    expect(deps.loadJSON).not.toHaveBeenCalled()
  })

  it('판정 집합: 기준 ∪ 세션 시작 연결 템플릿 ∪ from ∪ to ∪ 다른 스킨 ids 를 templateIds 로 넘긴다', async () => {
    useSettingsStore.setState({ linkedPrintTemplates: linked([[...BASE_T[0], { type: 'rect', id: 'l-old0' }], BASE_T[1]]) } as never)
    await confirmPlan('winter')
    const call = spies.merge.mock.calls.find((c) => (c[3] as { dryRun?: boolean }).dryRun) as unknown[]
    const ids = (call[3] as { templateIds: Set<string> }).templateIds
    for (const id of ['b-bg', 'b-title', 'l-old0', 'w-title', 'w-frame0', 't-deco0', 't-frame0']) expect(ids.has(id)).toBe(true)
    expect(call[1]).not.toBeNull()
  })

  it('판별: 옛 디자인 요소(다른 스킨·세션 시작 템플릿 id)는 적용 뒤 남지 않는다 — 판정 집합이 없으면 고객 요소로 남는다', async () => {
    useSettingsStore.setState({ linkedPrintTemplates: linked([[...BASE_T[0], { type: 'rect', id: 'l-old0' }], BASE_T[1]]) } as never)
    setup(sessionObjects([{ type: 'rect', id: 't-deco0' }, { type: 'rect', id: 'l-old0' }]))
    useSettingsStore.setState({ linkedPrintTemplates: linked([[...BASE_T[0], { type: 'rect', id: 'l-old0' }], BASE_T[1]]) } as never)
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    expect(plan.summarySkin.customerKept).toBe(0)
    expect((await executeSkinApply(plan, 'skin', deps)).kind).toBe('applied')
    expect(idsOf(canvases[0])).not.toContain('t-deco0')
    expect(idsOf(canvases[0])).not.toContain('l-old0')
    // 같은 입력에서 판정 집합을 빼면 두 요소가 고객 요소로 분류된다(위 단언이 판정 집합에 의존함을 고정)
    const { mergeSkinCanvas } = await vi.importActual<typeof import('@storige/canvas-core')>('@storige/canvas-core')
    const bare = mergeSkinCanvas(plan.cur[0], plan.from[0], plan.to[0], { dryRun: true })
    expect(bare.report.customerKept).toBe(2)
  })

  it('skinKey 가 skins 에 없으면 from=null 로 병합한다', async () => {
    useCalendarStore.getState().setSkinKey('gone')
    await confirmPlan('winter')
    expect(spies.merge.mock.calls.every((c) => c[1] === null)).toBe(true)
  })

  it('직전 스킨이 있으면 그 세트를 from 으로 받는다(대상과 같으면 재사용)', async () => {
    useCalendarStore.getState().setSkinKey('spring')
    const deps = makeDeps()
    await confirmPlan('winter', deps)
    expect((deps.fetchSet as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['base', 'set-winter', 'set-spring']))
    const fromObjs = (spies.merge.mock.calls[0][1] as { objects: Plain[] }).objects
    expect(fromObjs.find((o) => o.id === 'b-bg')?.fill).toBe('#f00')
  })
})

// ─── 차단 ──────────────────────────────────────────────────────────────────

describe('prepareSkinApply / executeSkinApply — 차단', () => {
  it('blocked(판정 오류 의심) → 확인 없이 끝나고 loadJSON·저장 0회', async () => {
    const stickers = Array.from({ length: 4 }, (_, k) => ({ type: 'rect', id: `s${k}`, extensionType: 'sticker' }))
    setup(sessionObjects(stickers))
    const saveNow = vi.fn(async () => true)
    const deps = makeDeps({ getSaveNow: () => saveNow })
    const out = await prepareSkinApply('winter', deps)
    expect(out.kind).toBe('blocked')
    expect(out.kind === 'blocked' && out.suspectIndices).toEqual([0])
    expect(deps.loadJSON).not.toHaveBeenCalled()
    expect(saveNow).not.toHaveBeenCalled()
  })
})

// ─── 실행 ──────────────────────────────────────────────────────────────────

describe('executeSkinApply — 적용 직전 저장', () => {
  it('저장은 자동저장 보류에 들어가기 전에 부른다(보류 중이면 saveToServer 가 미뤄질 뿐이라)', async () => {
    useSaveStore.setState({ isDirty: true, status: 'unsaved' } as never)
    let suspendedAtSave: boolean | null = null
    const saveNow = vi.fn(async () => {
      suspendedAtSave = isAutosaveSuspended()
      log.push('saveNow')
      return true
    })
    const deps = makeDeps({ getSaveNow: () => saveNow })
    const plan = await confirmPlan('winter', deps)
    await executeSkinApply(plan, 'skin', deps)
    expect(saveNow).toHaveBeenCalledTimes(1)
    expect(suspendedAtSave).toBe(false)
    expect(log.indexOf('saveNow')).toBeLessThan(log.indexOf(`longTask:start:${SKIN_LONG_TASK_MESSAGE}`))
  })

  it('저장 결과 false·예외면 중단(loadJSON 0회, skinKey 불변)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useSaveStore.setState({ isDirty: true, status: 'unsaved' } as never)
    for (const saveNow of [vi.fn(async () => false), vi.fn(async () => { throw new Error('x') })]) {
      const deps = makeDeps({ getSaveNow: () => saveNow })
      const plan = await confirmPlan('winter', deps)
      expect(await executeSkinApply(plan, 'skin', deps)).toEqual({ kind: 'aborted', reason: 'save-failed' })
      expect(deps.loadJSON).not.toHaveBeenCalled()
      expect(useCalendarStore.getState().meta?.skinKey).toBeUndefined()
    }
  })

  it('깨끗하고 저장됨 상태면 저장을 건너뛴다', async () => {
    const saveNow = vi.fn(async () => true)
    const deps = makeDeps({ getSaveNow: () => saveNow })
    await executeSkinApply(await confirmPlan('winter', deps), 'skin', deps)
    expect(saveNow).not.toHaveBeenCalled()
  })

  it('실행 시점에 저장 중이면 aborted', async () => {
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    useSaveStore.setState({ status: 'saving' } as never)
    expect(await executeSkinApply(plan, 'skin', deps)).toEqual({ kind: 'aborted', reason: 'saving' })
  })
})

describe('executeSkinApply — 성공', () => {
  it('skinKey 기록 + markDirty 1회, 캔버스마다 offHistory→loadJSON→리사이즈→rebind→strict grid→사진인화→locks→required→clearHistory→onHistory 순서', async () => {
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    log = []
    const out = await executeSkinApply(plan, 'skin', deps)
    expect(out).toEqual({ kind: 'applied', label: '겨울', photosDropped: 0 })
    expect(useCalendarStore.getState().meta?.skinKey).toBe('winter')
    expect(markDirty).toHaveBeenCalledTimes(1)
    const step = (i: number) => [`offHistory${i}`, `load${i}`, `resize${i}`, `rebind${i}`, `grid${i}`, `photoPrint${i}`, `locks${i}`, `required${i}`, `clearHistory${i}`, `onHistory${i}`]
    expect(log).toEqual([`longTask:start:${SKIN_LONG_TASK_MESSAGE}`, ...step(0), ...step(1), 'longTask:end'])
    expect(useCalendarSkinStore.getState().phase).toBe('applied')
    expect(isAutosaveSuspended()).toBe(false)
    // 새 디자인 요소로 바뀌고 채운 사진은 새 틀로 링크가 옮겨진다
    expect(idsOf(canvases[0])).toEqual(expect.arrayContaining(['workspace', 'w-bg', 'w-frame0', 'w-title', 'w-grid0']))
    expect(canvases[0].objects.find((o) => o.frameRef === 'w-frame0')).toBeTruthy()
    expect(idsOf(canvases[0])).not.toContain('b-title')
  })

  it("'기본 디자인' 적용 → skinKey 를 지운다", async () => {
    useCalendarStore.getState().setSkinKey('spring')
    const deps = makeDeps()
    expect((await executeSkinApply(await confirmPlan(undefined, deps), 'skin', deps)).kind).toBe('applied')
    expect(Object.keys(useCalendarStore.getState().meta ?? {})).not.toContain('skinKey')
  })

  it('refills: 이미지 로드 실패는 그 사진만 빼고 적용을 유지하며, 업로드 원본은 내 업로드에 남긴다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    sets['set-winter'] = setOf('set-winter', [WINTER_T[0].map((o) => (o.id === 'w-frame0' ? frame('w-frame0', { left: 30 }) : o)), WINTER_T[1]])
    const deps = makeDeps({ loadImage: vi.fn(async () => { throw new Error('load') }) })
    const plan = await confirmPlan('winter', deps)
    expect(plan.summarySkin.photosRefilled).toBe(1)
    const out = await executeSkinApply(plan, 'skin', deps)
    expect(out).toEqual({ kind: 'applied', label: '겨울', photosDropped: 1 })
    expect(useCalendarStore.getState().meta?.skinKey).toBe('winter')
    expect(deps.fillFrame).not.toHaveBeenCalled()
    expect(deps.keepUploads).toHaveBeenCalledWith(['/storage/uploads/p0.jpg'])
  })

  it('refills 성공 → 대상 틀에 fillFrame 으로 다시 채운다', async () => {
    sets['set-winter'] = setOf('set-winter', [WINTER_T[0].map((o) => (o.id === 'w-frame0' ? frame('w-frame0', { left: 30 }) : o)), WINTER_T[1]])
    const deps = makeDeps()
    await executeSkinApply(await confirmPlan('winter', deps), 'skin', deps)
    expect(log).toContain('fill0:w-frame0')
    expect(deps.keepUploads).not.toHaveBeenCalled()
  })
})

describe('executeSkinApply — 실패·롤백', () => {
  async function failingRun(over: Partial<SkinApplyDeps>, mutate?: () => void) {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = makeDeps(over)
    const plan = await confirmPlan('winter', deps)
    const before = canvases.map((c) => clone(serialize(c)))
    mutate?.()
    const out = await executeSkinApply(plan, 'skin', deps)
    return { out, before }
  }

  it('k번째 loadJSON 실패 → 0..k 를 적용 직전으로 되돌리고 skinKey·dirty 불변', async () => {
    let n = 0
    const { out, before } = await failingRun({
      loadJSON: vi.fn(async (_e, c, json) => {
        n += 1
        if (n === 2) throw new Error('load fail')
        ;(c as unknown as FakeCanvas).objects = (json.objects as Plain[]).map(toFake)
      }),
    })
    expect(out.kind).toBe('failed')
    expect(canvases.map(serialize)).toEqual(before)
    expect(useCalendarStore.getState().meta?.skinKey).toBeUndefined()
    expect(markDirty).not.toHaveBeenCalled()
    expect(useCalendarSkinStore.getState().phase).toBe('failed')
    expect(isAutosaveSuspended()).toBe(false)
  })

  it('loadJSON 가드: 콜백이 오지 않으면 8초 뒤 reject(시간 초과 = 실패)', async () => {
    vi.useFakeTimers()
    const editor = { getPlugin: () => ({ loadJSON: () => undefined }) }
    const p = createDefaultSkinApplyDeps().loadJSON(editor as never, {} as never, { objects: [] })
    const settled = vi.fn()
    p.catch(settled)
    await vi.advanceTimersByTimeAsync(SKIN_LOAD_TIMEOUT_MS - 1)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledTimes(1)
  })

  it('strict 그리드 재합성 실패(ok:false)·수 불일치 → 롤백', async () => {
    for (const result of [{ ok: false, count: 0 }, { ok: true, count: 0 }]) {
      setup()
      let calls = 0
      // 적용 중 첫 캔버스에서만 실패시키고 롤백 경로는 정상으로 둔다(롤백도 strict 를 쓴다)
      const strict = vi.fn(async (_e: unknown, c: unknown) => {
        calls += 1
        if (calls === 1) return result
        return { ok: true, count: (c as FakeCanvas).objects.filter((o) => o.extensionType === 'calendar-grid').length }
      })
      const { out, before } = await failingRun({ rehydrateStrict: strict as never })
      expect(out.kind).toBe('failed')
      expect(canvases.map(serialize)).toEqual(before)
    }
  })

  it('사후 검증 불일치(페이지 id 가 바뀜) → 전 캔버스 롤백', async () => {
    const { out, before } = await failingRun({
      trackRequired: (c) => {
        if ((c as unknown as FakeCanvas).idx === 1) useEditorStore.setState({ pages: [{ id: 'p0' }, { id: 'px' }] } as never)
      },
    })
    expect(out.kind).toBe('failed')
    expect(canvases.map(serialize)).toEqual(before)
    expect(useCalendarStore.getState().meta?.skinKey).toBeUndefined()
  })

  it('롤백마저 실패 → fatal: 자동저장 보류를 풀지 않고(미룬 저장 미실행) 멈춘다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let n = 0
    const deps = makeDeps({
      loadJSON: vi.fn(async (_e, c, json) => {
        n += 1
        if (n >= 2) throw new Error('load fail')
        ;(c as unknown as FakeCanvas).objects = (json.objects as Plain[]).map(toFake)
      }),
    })
    const plan = await confirmPlan('winter', deps)
    const deferred = vi.fn()
    const settled = vi.fn()
    void executeSkinApply(plan, 'skin', deps).then(settled)
    await vi.waitFor(() => expect(useCalendarSkinStore.getState().phase).toBe('fatal'))
    deferUntilAutosaveResumed('test.save', deferred)
    await new Promise((r) => setTimeout(r, 20))
    expect(isAutosaveSuspended()).toBe(true)
    expect(deferred).not.toHaveBeenCalled()
    expect(settled).not.toHaveBeenCalled()
    expect(useCalendarStore.getState().meta?.skinKey).toBeUndefined()
  })
})

// ─── 배경 결정 ──────────────────────────────────────────────────────────────

describe('배경 결정(캔버스별 keepCustomerBackground)', () => {
  const bg = (id: string, src: string): Plain => ({ type: 'image', id, extensionType: 'background', src })
  const keepArgs = () =>
    spies.merge.mock.calls.filter((c) => !(c[3] as { dryRun?: boolean }).dryRun).map((c) => (c[3] as { keepCustomerBackground?: boolean }).keepCustomerBackground)

  it("'스킨 배경 사용' + 되살릴 수 없는 원본 캔버스만 keep=true, 업로드 배경 캔버스는 false 이고 내 업로드에 남긴다", async () => {
    setup(sessionObjects([bg('cbg0', `${API}/storage/uploads/bg.jpg`)], [bg('cbg1', 'https://cdn.other.test/storage/uploads/x.jpg')]))
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    expect(plan.backgrounds.editorForcedKeepIndices).toEqual([1])
    expect(plan.backgrounds.removedCanvasIndices).toEqual([0])
    expect(plan.showBackgroundChoice).toBe(true)
    spies.merge.mockClear()
    await executeSkinApply(plan, 'skin', deps)
    expect(keepArgs()).toEqual([false, true])
    expect(idsOf(canvases[0])).not.toContain('cbg0')
    expect(idsOf(canvases[1])).toContain('cbg1')
    expect(deps.keepUploads).toHaveBeenCalledWith([`${API}/storage/uploads/bg.jpg`])
  })

  it("'내 배경 유지' → 모든 캔버스 keep=true, 내 업로드 등록 없음", async () => {
    setup(sessionObjects([bg('cbg0', `${API}/storage/uploads/bg.jpg`)]))
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    spies.merge.mockClear()
    await executeSkinApply(plan, 'keep', deps)
    expect(keepArgs()).toEqual([true, true])
    expect(idsOf(canvases[0])).toContain('cbg0')
    expect(deps.keepUploads).not.toHaveBeenCalled()
  })

  it('대화상자 forcedKeep = data URL(canvas-core) ∪ 편집기 강제, library 는 빼기만', async () => {
    setup(sessionObjects([bg('cbg0', '/storage/outputs/x.png')], [bg('cbg1', 'data:image/png;base64,AAAA')]))
    const plan = await confirmPlan('winter')
    expect(plan.summarySkin.forcedKeepIndices).toEqual([1])
    expect(plan.backgrounds.forcedKeepIndices).toEqual([0, 1])
    expect(plan.backgrounds.removedCanvasIndices).toEqual([])
    setup(sessionObjects([bg('cbg0', '/storage/library/bg/a.jpg')]))
    const lib = await confirmPlan('winter')
    expect(lib.backgrounds.forcedKeepIndices).toEqual([])
    expect(lib.backgrounds.removedCanvasIndices).toEqual([0])
    expect(lib.backgrounds.uploadsByCanvas).toEqual([[], []])
  })
})

// ─── 적용 취소 ──────────────────────────────────────────────────────────────

describe('undoSkinApply — 「적용 취소」', () => {
  it('적용 직전 JSON 으로 되돌리고 skinKey 를 이전 값으로, markDirty 1회 더', async () => {
    useCalendarStore.getState().setSkinKey('spring')
    const deps = makeDeps()
    const plan = await confirmPlan('winter', deps)
    const before = canvases.map((c) => clone(serialize(c)))
    await executeSkinApply(plan, 'skin', deps)
    expect(useCalendarStore.getState().meta?.skinKey).toBe('winter')
    expect(await undoSkinApply(deps)).toBe(true)
    expect(canvases.map(serialize)).toEqual(before)
    expect(useCalendarStore.getState().meta?.skinKey).toBe('spring')
    expect(markDirty).toHaveBeenCalledTimes(2)
    expect(useCalendarSkinStore.getState().undo).toBeNull()
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
  })

  it('적용 뒤 편집 이벤트가 나면 취소할 수 없다(감시는 다음 프레임에 무장 — 적용 직후 처리 이벤트는 세지 않음)', async () => {
    const deps = makeDeps()
    await executeSkinApply(await confirmPlan('winter', deps), 'skin', deps)
    canvases[0].fire('object:added')
    expect(useCalendarSkinStore.getState().undo).not.toBeNull()
    pendingFrame?.()
    canvases[1].fire('object:modified')
    expect(useCalendarSkinStore.getState().undo).toBeNull()
    expect(useCalendarSkinStore.getState().phase).toBe('idle')
    expect(await undoSkinApply(deps)).toBe(false)
  })

  it('새 적용은 이전 취소 스냅샷을 해제한다', async () => {
    const deps = makeDeps()
    await executeSkinApply(await confirmPlan('winter', deps), 'skin', deps)
    const first = useCalendarSkinStore.getState().undo
    await executeSkinApply(await confirmPlan('spring', deps), 'skin', deps)
    const second = useCalendarSkinStore.getState().undo
    expect(second).not.toBe(first)
    expect(second?.prevSkinKey).toBe('winter')
  })
})
