import type Editor from '@storige/canvas-core'
import {
  collectSkinTemplateIds,
  core,
  mergeSkinCanvas,
  summarizeSkinMergeReports,
  type ImageProcessingPlugin,
  type ServicePlugin,
  type SkinCanvasJson,
  type SkinMergeResult,
  type SkinMergeSummary,
} from '@storige/canvas-core'
import { checkCalendarSkinCompatibility, type CalendarSkin } from '@storige/types'
import type { fabric } from 'fabric'
import { templateSetsApi, type TemplateSetWithDetails } from '@/api/template-sets'
import { applyCustomerLocks } from '@/hooks/useEditorContents'
import { useAppStore } from '@/stores/useAppStore'
import { useCalendarSkinStore, type SkinUndoSnapshot } from '@/stores/useCalendarSkinStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { useEditorStore } from '@/stores/useEditorStore'
import { useImageStore } from '@/stores/useImageStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { runWithAutosaveSuspended } from '@/utils/autosaveSuspend'
import { rehydrateCalendarGridsStrict, type StrictGridRehydrateResult } from '@/utils/calendarRehydrate'
import { classifyBackgroundSrc, keepSkinUploads } from '@/utils/calendarSkinUploads'
import { rebindFrameInteractivity } from '@/utils/frameInteractive'
import { httpStatusOf } from '@/utils/httpErrorFields'
import { rehydratePhotoPrint } from '@/utils/photoPrintRehydrate'
import { isCalendarProfile, makeCalendarLabelResolver, resolveFixedCanvasCount } from '@/utils/productProfile'
import { trackRequiredEdits } from '@/utils/requiredEditGate'
import { getAssetBaseUrl } from '@/utils/resolveAssetUrl'
import { saveNowRegistry, type SaveNowFn } from '@/utils/saveNowRegistry'

/**
 * calendarSkinApply.ts — 캘린더 디자인(스킨) 적용 오케스트레이터
 *
 * 적용 경로는 세션 재오픈과 같다: 순수 병합(`mergeSkinCanvas`) → `ServicePlugin.loadJSON` → 재오픈 후처리
 * (workspace 리사이즈 → 사진틀 재바인딩 → 그리드 재합성(실패 신호) → 사진인화 복구 → 고객 잠금 → 필수 편집 추적).
 * 페이지 템플릿 교체(`TemplatePlugin.replaceTemplate`)는 쓰지 않는다.
 *
 * 1. `prepareSkinApply(key)` — 기준·대상·직전 스킨 세트를 매번 새로 받아 호환(사이트 포함)을 다시 검사하고,
 *    판정 집합 `T[i]`(기준 ∪ 세션 시작 때 연결 템플릿 ∪ 직전 ∪ 대상 ∪ 등록된 다른 스킨의 top-level ids)으로 dryRun 해
 *    확인 대화상자 개수·차단 여부·배경 선택 정보를 만든다. 아무것도 바꾸지 않는다.
 * 2. `executeSkinApply(plan, choice)` — 적용 직전 저장(자동저장 보류에 들어가기 **전**, 보류 중 저장은 미뤄지기 때문) →
 *    보류 + longTask 안에서 캔버스를 순서대로 다시 싣고 사후 검증 → 성공하면 skinKey 기록·dirty 1회.
 *    실패하면 손댄 캔버스를 적용 직전 JSON 으로 되돌린다. 되돌리기도 실패하면 보류를 풀지 않은 채 멈춘다(fatal —
 *    보류가 풀리면 미뤄 둔 저장이 깨진 캔버스를 서버에 쓴다. 서버에는 적용 직전 저장본이 있다).
 * 3. `undoSkinApply()` — 「적용 취소」. 적용 뒤 편집 이벤트가 없을 때만 스냅샷으로 되돌린다.
 *
 * 의존성은 `SkinApplyDeps` 로 주입한다(단위 테스트에서 fabric 없이 순서·롤백을 검증).
 */

/** loadJSON 콜백 대기 상한(재오픈 경로와 같은 8초). 적용 경로에서는 시간 초과를 실패로 본다 */
export const SKIN_LOAD_TIMEOUT_MS = 8000
/** 판정 집합용 다른 스킨 세트 동시 조회 수 */
export const SKIN_OTHERS_CONCURRENCY = 3
export const SKIN_LONG_TASK_MESSAGE = '디자인을 바꾸는 중...'

/**
 * 킬스위치 — 값이 정확히 'false' 면 끈다(기존 VITE_ENABLE_* 관례). 달력 기능 전체(VITE_ENABLE_CALENDAR)와
 * 스킨(VITE_ENABLE_CALENDAR_SKINS) 둘 중 하나라도 꺼지면 스킨 절·적용을 막는다(메뉴 노출과 별개로 코드에서 방어).
 */
export function isCalendarSkinsFlagEnabled(): boolean {
  return import.meta.env.VITE_ENABLE_CALENDAR !== 'false' && import.meta.env.VITE_ENABLE_CALENDAR_SKINS !== 'false'
}

export interface SkinCanvasHandle {
  canvas: fabric.Canvas
  editor: Editor | null | undefined
}

export interface SkinApplyDeps {
  fetchSet: (templateSetId: string) => Promise<TemplateSetWithDetails>
  getSaveNow: () => SaveNowFn | undefined
  suspend: <T>(fn: () => Promise<T>) => Promise<T>
  getHandles: () => SkinCanvasHandle[]
  serialize: (canvas: fabric.Canvas) => SkinCanvasJson
  /** ServicePlugin.loadJSON + 가드. 시간 초과·예외는 reject */
  loadJSON: (editor: Editor | null | undefined, canvas: fabric.Canvas, json: SkinCanvasJson) => Promise<void>
  resizeWorkspace: (canvas: fabric.Canvas) => void
  rebind: (editor: Editor | null | undefined, canvas: fabric.Canvas) => void
  rehydrateStrict: (editor: Editor | null | undefined, canvas: fabric.Canvas, index: number) => Promise<StrictGridRehydrateResult>
  rehydratePhotoPrint: (editor: Editor | null | undefined, canvas: fabric.Canvas, index: number) => Promise<unknown>
  applyLocks: (canvas: fabric.Canvas) => void
  trackRequired: (canvas: fabric.Canvas) => void
  loadImage: (src: string) => Promise<fabric.Object>
  fillFrame: (editor: Editor | null | undefined, canvas: fabric.Canvas, image: fabric.Object, frame: fabric.Object) => Promise<unknown>
  /** 빠진 업로드 원본을 '내 업로드'에 남긴다(실패해도 적용은 유지) */
  keepUploads: (urls: string[]) => Promise<unknown>
  emit: (event: string, payload?: unknown) => void
  apiBase: () => string
  requestFrame: (cb: () => void) => void
}

// ─── 기본 의존성 ─────────────────────────────────────────────────────────────

function loadJSONWithGuard(editor: Editor | null | undefined, _canvas: fabric.Canvas, json: SkinCanvasJson): Promise<void> {
  const plugin = editor?.getPlugin<ServicePlugin>('ServicePlugin')
  if (!plugin) return Promise.reject(new Error('ServicePlugin 없음'))
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error(`loadJSON 시간 초과(${SKIN_LOAD_TIMEOUT_MS}ms)`))
    }, SKIN_LOAD_TIMEOUT_MS)
    try {
      plugin.loadJSON(json, () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve()
      })
    } catch (e) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

interface SizedObject {
  id?: unknown
  preventAutoResize?: unknown
}

/** workspace·template-background 리사이즈 — 세션 재오픈 경로(useEditorContents loadJSON 콜백)와 같은 식 */
function resizeWorkspaceLikeReopen(canvas: fabric.Canvas): void {
  const { currentSettings, getEffectiveValue } = useSettingsStore.getState()
  const size = currentSettings.size
  const totalWidth = getEffectiveValue(size.width + (size.cutSize || 0))
  const totalHeight = getEffectiveValue(size.height + (size.cutSize || 0))
  for (const obj of canvas.getObjects()) {
    const o = obj as fabric.Object & SizedObject
    if (o.id === 'workspace') {
      obj.set({ width: totalWidth, height: totalHeight, scaleX: 1, scaleY: 1 })
    } else if (o.id === 'template-background' && !o.preventAutoResize && obj.width && obj.height) {
      obj.set({ scaleX: totalWidth / obj.width, scaleY: totalHeight / obj.height })
    }
  }
}

export function createDefaultSkinApplyDeps(): SkinApplyDeps {
  return {
    fetchSet: (id) => templateSetsApi.getTemplateSetWithTemplates(id),
    getSaveNow: () => saveNowRegistry.get(),
    suspend: (fn) => runWithAutosaveSuspended(fn),
    getHandles: () => {
      const { allCanvas, allEditors } = useAppStore.getState()
      return (allCanvas as fabric.Canvas[]).map((canvas, i) => ({ canvas, editor: allEditors[i] }))
    },
    serialize: (canvas) => canvas.toJSON(core.extendFabricOption) as unknown as SkinCanvasJson,
    loadJSON: loadJSONWithGuard,
    resizeWorkspace: resizeWorkspaceLikeReopen,
    rebind: rebindFrameInteractivity,
    rehydrateStrict: rehydrateCalendarGridsStrict,
    rehydratePhotoPrint,
    applyLocks: applyCustomerLocks,
    trackRequired: trackRequiredEdits,
    loadImage: (src) => core.imageFromURL(src, { crossOrigin: 'anonymous' }) as Promise<fabric.Object>,
    fillFrame: async (editor, canvas, image, frame) => {
      const plugin = editor?.getPlugin<ImageProcessingPlugin>('ImageProcessingPlugin')
      if (!plugin) throw new Error('ImageProcessingPlugin 없음')
      return useImageStore.getState().fillImageIntoFrame(canvas, image, frame, plugin)
    },
    keepUploads: (urls) => keepSkinUploads(urls),
    emit: (event, payload) => {
      useAppStore.getState().editor?.emit(event, payload)
    },
    apiBase: getAssetBaseUrl,
    requestFrame: (cb) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cb())
      else setTimeout(cb, 0)
    },
  }
}

function withDefaults(deps?: Partial<SkinApplyDeps>): SkinApplyDeps {
  return { ...createDefaultSkinApplyDeps(), ...deps }
}

// ─── 노출 조건 ──────────────────────────────────────────────────────────────

export interface SkinSectionState {
  visible: boolean
  skins: CalendarSkin[]
}

/** 스킨 절 노출 — 캘린더 프로파일 + skins ≥ 1 + 플래그 + editMode 아님 + 기준 세트 id 를 앎 */
export function resolveSkinSection(): SkinSectionState {
  const { productProfile, currentSettings } = useSettingsStore.getState()
  const skins = isCalendarProfile(productProfile) ? productProfile.calendar.skins ?? [] : []
  const visible =
    skins.length > 0
    && isCalendarSkinsFlagEnabled()
    && currentSettings.editMode !== true
    && useCalendarSkinStore.getState().baseTemplateSetId !== null
  return { visible, skins }
}

// ─── 준비(dryRun) ───────────────────────────────────────────────────────────

export type SkinRejectReason =
  | 'disabled'
  | 'preview'
  | 'saving'
  | 'busy'
  | 'base-unavailable'
  | 'missing'
  | 'incompatible'
  | 'network'

export interface SkinApplyPlan {
  /** undefined = 기본 디자인 */
  targetKey: string | undefined
  label: string
  thumbnailUrl: string | null
  prevSkinKey: string | undefined
  from: Array<SkinCanvasJson | null>
  to: SkinCanvasJson[]
  templateIds: Set<string>[]
  /** dryRun 에 쓴 현재 캔버스 JSON */
  cur: SkinCanvasJson[]
  /** '스킨 배경 사용' dryRun 합계 */
  summarySkin: SkinMergeSummary
  /** '내 배경 유지' dryRun 합계 */
  summaryKeep: SkinMergeSummary
  backgrounds: SkinBackgroundDecision
  /** 대화상자 배경 선택 블록 노출 */
  showBackgroundChoice: boolean
  pageLabels: string[]
  anniversaryCount: number
}

export interface SkinBackgroundDecision {
  /** '스킨 배경 사용'을 고를 때 캔버스별 keepCustomerBackground(편집기 강제 포함) */
  keepOnSkinChoice: boolean[]
  /** 대화상자에 보일 강제 유지 캔버스 = canvas-core data URL ∪ 편집기 강제(되살릴 수 없는 원본) */
  forcedKeepIndices: number[]
  /** 그중 편집기가 강제한 캔버스 */
  editorForcedKeepIndices: number[]
  /** '스킨 배경 사용' 때 실제로 고객 배경이 빠지는 캔버스 */
  removedCanvasIndices: number[]
  /** 캔버스별 '내 업로드'에 남길 업로드 배경 URL(강제 유지 캔버스는 비어 있음) */
  uploadsByCanvas: string[][]
}

export type SkinPrepareOutcome =
  | { kind: 'noop' }
  | { kind: 'rejected'; reason: SkinRejectReason }
  | { kind: 'blocked'; plan: SkinApplyPlan; suspectIndices: number[] }
  | { kind: 'confirm'; plan: SkinApplyPlan }

function toCanvasJson(data: unknown): SkinCanvasJson | null {
  let v = data
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return null
    }
  }
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as SkinCanvasJson) : null
}

function detailJsons(set: TemplateSetWithDetails): Array<SkinCanvasJson | null> {
  return (set.templateDetails ?? []).map((t) => toCanvasJson((t as { canvasData?: unknown } | null)?.canvasData))
}

function idSetsOf(set: TemplateSetWithDetails): Set<string>[] {
  return detailJsons(set).map((j) => collectSkinTemplateIds(j ? [j] : []))
}

// strict 가 꺼진 프로젝트라 boolean 판별자는 좁혀지지 않는다 — 문자열 판별자를 쓴다
type FetchResult = { status: 'ok'; set: TemplateSetWithDetails } | { status: 'missing' | 'network' }

async function fetchSafe(deps: SkinApplyDeps, id: string): Promise<FetchResult> {
  try {
    return { status: 'ok', set: await deps.fetchSet(id) }
  } catch (e) {
    return { status: httpStatusOf(e) === 404 ? 'missing' : 'network' }
  }
}

function compatErrors(base: TemplateSetWithDetails, skin: TemplateSetWithDetails): string[] {
  return checkCalendarSkinCompatibility(
    { templateSet: base.templateSet, templateDetails: base.templateDetails },
    { templateSet: skin.templateSet, templateDetails: skin.templateDetails },
  )
}

/** 판정 집합용 다른 스킨 세트 id 집합 — 캐시에 없으면 동시 3개까지 받는다. 실패한 세트는 건너뛴다 */
async function collectOtherIdSets(deps: SkinApplyDeps, setIds: string[]): Promise<Set<string>[][]> {
  const store = useCalendarSkinStore.getState()
  const out: Set<string>[][] = []
  const queue = setIds.filter((id) => {
    const cached = store.idSetCache[id]
    if (cached) out.push(cached)
    return !cached
  })
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      const r = await fetchSafe(deps, id)
      if (r.status !== 'ok') {
        console.warn(`[calendarSkin] 판정 집합용 스킨 세트 조회 실패(${r.status}) — 건너뜀`)
        continue
      }
      const sets = idSetsOf(r.set)
      useCalendarSkinStore.getState().cacheIdSets(id, sets)
      out.push(sets)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SKIN_OTHERS_CONCURRENCY, queue.length) }, () => worker()))
  return out
}

function currentPageLabels(count: number): string[] {
  const resolve = makeCalendarLabelResolver(useSettingsStore.getState().productProfile, useCalendarStore.getState().meta)
  return Array.from({ length: count }, (_, i) => resolve(i) ?? `${i + 1}쪽`)
}

function findSrcById(json: SkinCanvasJson, id: string): unknown {
  const objects = Array.isArray(json.objects) ? json.objects : []
  for (const o of objects) {
    if (typeof o === 'object' && o !== null && (o as { id?: unknown }).id === id) return (o as { src?: unknown }).src
  }
  return undefined
}

/**
 * 캔버스별 고객 배경 결정. '스킨 배경 사용' dryRun 합계에서 빠질 고객 배경의 원본을 분류한다.
 * upload → 빼고 등록 · library → 빼기만 · unrecoverable → 그 캔버스만 keep=true 강제.
 */
export function decideSkinBackgrounds(
  cur: readonly SkinCanvasJson[],
  summarySkin: SkinMergeSummary,
  apiBase: string,
): SkinBackgroundDecision {
  const n = cur.length
  const keepOnSkinChoice = Array.from({ length: n }, () => false)
  const editorForced = new Set<number>()
  const uploadsByCanvas: string[][] = Array.from({ length: n }, () => [])
  const removed = new Set<number>()
  for (const b of summarySkin.removedCustomerBackgrounds) {
    const i = b.canvasIndex
    if (i < 0 || i >= n) continue
    const src = b.src ?? findSrcById(cur[i], b.id)
    const kind = classifyBackgroundSrc(src, apiBase)
    if (kind === 'upload' && typeof src === 'string') uploadsByCanvas[i].push(src)
    else if (kind !== 'library') editorForced.add(i)
    removed.add(i)
  }
  for (const i of editorForced) {
    keepOnSkinChoice[i] = true
    uploadsByCanvas[i] = []
    removed.delete(i)
  }
  const forced = new Set<number>([...summarySkin.forcedKeepIndices, ...editorForced])
  for (const i of summarySkin.forcedKeepIndices) removed.delete(i)
  return {
    keepOnSkinChoice,
    forcedKeepIndices: [...forced].sort((a, b) => a - b),
    editorForcedKeepIndices: [...editorForced].sort((a, b) => a - b),
    removedCanvasIndices: [...removed].sort((a, b) => a - b),
    uploadsByCanvas,
  }
}

function dryRunAll(
  cur: readonly SkinCanvasJson[],
  from: ReadonlyArray<SkinCanvasJson | null>,
  to: readonly SkinCanvasJson[],
  templateIds: readonly Set<string>[],
  prevSkinKey: string | undefined,
  keep: (i: number) => boolean,
): SkinMergeSummary {
  return summarizeSkinMergeReports(
    cur.map((c, i) =>
      mergeSkinCanvas(c, from[i], to[i], { dryRun: true, templateIds: templateIds[i], prevSkinKey, keepCustomerBackground: keep(i) }).report,
    ),
  )
}

/**
 * 카드 클릭 → 원천 조회·호환 재검사·판정 집합·dryRun. 캔버스·스토어(사유 캐시 제외)를 바꾸지 않는다.
 * @param targetKey undefined = 기본 디자인
 */
export async function prepareSkinApply(targetKey: string | undefined, depsIn?: Partial<SkinApplyDeps>): Promise<SkinPrepareOutcome> {
  const deps = withDefaults(depsIn)
  const section = resolveSkinSection()
  if (!section.visible) return { kind: 'rejected', reason: 'disabled' }
  const settings = useSettingsStore.getState()
  if (settings.customerPreview) return { kind: 'rejected', reason: 'preview' }
  if (useSaveStore.getState().status === 'saving') return { kind: 'rejected', reason: 'saving' }
  const skinStore = useCalendarSkinStore.getState()
  if (skinStore.phase === 'applying' || skinStore.phase === 'fatal') return { kind: 'rejected', reason: 'busy' }
  if (skinStore.baseUnavailable) return { kind: 'rejected', reason: 'base-unavailable' }
  const prevSkinKey = useCalendarStore.getState().meta?.skinKey
  if ((targetKey ?? undefined) === (prevSkinKey ?? undefined)) return { kind: 'noop' }

  const skins = section.skins
  const target = targetKey === undefined ? null : skins.find((s) => s.key === targetKey) ?? null
  if (targetKey !== undefined && !target) return { kind: 'rejected', reason: 'missing' }
  const baseId = skinStore.baseTemplateSetId as string

  // 1) 기준 세트 — 매번 새로 받는다(세션 중 사이트·템플릿이 바뀌었을 수 있음)
  const baseRes = await fetchSafe(deps, baseId)
  if (baseRes.status !== 'ok') {
    if (baseRes.status === 'missing') useCalendarSkinStore.getState().setBaseUnavailable(true)
    return { kind: 'rejected', reason: baseRes.status === 'missing' ? 'base-unavailable' : 'network' }
  }
  const base = baseRes.set

  // 2) 대상 세트 + 3) 호환 재검사(사이트·자기 참조 포함)
  let toSet = base
  if (target) {
    const r = await fetchSafe(deps, target.templateSetId)
    if (r.status !== 'ok') {
      if (r.status === 'missing') useCalendarSkinStore.getState().setCardReason(target.key, 'missing')
      return { kind: 'rejected', reason: r.status }
    }
    const errors = compatErrors(base, r.set)
    if (errors.length > 0) {
      console.warn(`[calendarSkin] 「${target.label}」 호환 오류:`, errors)
      useCalendarSkinStore.getState().setCardReason(target.key, 'incompatible')
      return { kind: 'rejected', reason: 'incompatible' }
    }
    toSet = r.set
  }

  // 4) 캔버스 수 — 캔버스 = 기준 프로파일 pages.count = 기준 템플릿 수
  const handles = deps.getHandles()
  const count = resolveFixedCanvasCount(base.templateSet.productProfile ?? null)
  const baseJsons = detailJsons(base)
  const to = detailJsons(toSet)
  const incompatible = (): SkinPrepareOutcome => {
    if (target) useCalendarSkinStore.getState().setCardReason(target.key, 'incompatible')
    return { kind: 'rejected', reason: 'incompatible' }
  }
  if (count === null || handles.length !== count || baseJsons.length !== count || to.length !== count) return incompatible()
  if (to.some((j) => j === null)) return incompatible()

  // 5) from — 지금 캔버스가 따르는 디자인. 직전 스킨을 알 수 없으면 null
  let from: Array<SkinCanvasJson | null> = Array.from({ length: count }, () => null)
  let prevSkinSetId: string | null = null
  if (prevSkinKey === undefined) {
    from = baseJsons
  } else {
    const prevSkin = skins.find((s) => s.key === prevSkinKey)
    if (prevSkin) {
      const prevSet = target && prevSkin.templateSetId === target.templateSetId ? toSet : null
      const r: FetchResult = prevSet ? { status: 'ok', set: prevSet } : await fetchSafe(deps, prevSkin.templateSetId)
      if (r.status === 'ok') useCalendarSkinStore.getState().cacheIdSets(prevSkin.templateSetId, idSetsOf(r.set))
      const jsons = r.status === 'ok' && compatErrors(base, r.set).length === 0 ? detailJsons(r.set) : null
      if (jsons && jsons.length === count) {
        from = jsons
        prevSkinSetId = prevSkin.templateSetId
      } else {
        // from 은 null(출처 불명). 직전 세트 ids 는 다른 스킨과 같이 판정 집합에 넣는다(캐시 우선, 없으면 다시 조회 — 실패하면 빠짐)
        console.warn(`[calendarSkin] 직전 디자인(${prevSkinKey}) 세트를 쓸 수 없음 — 기준을 알 수 없음으로 진행`)
      }
    }
  }
  if (target) useCalendarSkinStore.getState().cacheIdSets(target.templateSetId, idSetsOf(toSet))

  // 6) 판정 집합 T[i]
  const otherIds = skins
    .map((s) => s.templateSetId)
    .filter((id) => id !== target?.templateSetId && id !== prevSkinSetId && id !== baseId)
  const others = await collectOtherIdSets(deps, [...new Set(otherIds)])
  const linked = useSettingsStore.getState().linkedPrintTemplates
  const templateIds = Array.from({ length: count }, (_, i) => {
    const ids = collectSkinTemplateIds([baseJsons[i], linked[i]?.canvasData, from[i], to[i]].filter((v) => v != null))
    for (const sets of others) for (const id of sets[i] ?? []) ids.add(id)
    return ids
  })

  // 단계 2 — dryRun 두 옵션(blocked 는 두 옵션에서 같다: 출처·템플릿 표지 판정은 고객 배경 배치와 무관)
  const cur = handles.map((h) => deps.serialize(h.canvas))
  const toJsons = to as SkinCanvasJson[]
  const summarySkin = dryRunAll(cur, from, toJsons, templateIds, prevSkinKey, () => false)
  const summaryKeep = dryRunAll(cur, from, toJsons, templateIds, prevSkinKey, () => true)
  const backgrounds = decideSkinBackgrounds(cur, summarySkin, deps.apiBase())
  const plan: SkinApplyPlan = {
    targetKey,
    label: target?.label ?? '기본 디자인',
    thumbnailUrl: target ? target.thumbnailUrl ?? null : linked[0]?.thumbnailUrl ?? null,
    prevSkinKey,
    from,
    to: toJsons,
    templateIds,
    cur,
    summarySkin,
    summaryKeep,
    backgrounds,
    showBackgroundChoice:
      summarySkin.removedCustomerBackgrounds.length + summarySkin.forcedKeepIndices.length > 0
      || summaryKeep.customerBackgroundsKept > 0,
    pageLabels: currentPageLabels(count),
    anniversaryCount: useCalendarStore.getState().meta?.anniversaries.length ?? 0,
  }
  if (summarySkin.blocked) return { kind: 'blocked', plan, suspectIndices: summarySkin.suspectIndices }
  return { kind: 'confirm', plan }
}

// ─── 실행 ──────────────────────────────────────────────────────────────────

export type SkinBackgroundChoice = 'skin' | 'keep'

export type SkinExecuteOutcome =
  | { kind: 'aborted'; reason: 'saving' | 'save-failed' | 'busy' }
  | { kind: 'applied'; label: string; photosDropped: number }
  | { kind: 'failed'; reason: string }

function gridCountOf(objects: readonly unknown[]): number {
  return objects.filter((o) => typeof o === 'object' && o !== null && (o as { extensionType?: unknown }).extensionType === 'calendar-grid').length
}

/**
 * 캔버스 1장을 JSON 으로 다시 싣고 재오픈 후처리를 한다. 그리드 재합성 실패·수 불일치는 throw.
 * 히스토리는 꺼 둔 채 끝내고, 호출자가 refills 뒤 clearHistory → onHistory 를 한다.
 */
async function loadCanvas(deps: SkinApplyDeps, h: SkinCanvasHandle, index: number, json: SkinCanvasJson): Promise<void> {
  const canvas = h.canvas
  canvas.offHistory()
  await deps.loadJSON(h.editor, canvas, json)
  deps.resizeWorkspace(canvas)
  for (const obj of canvas.getObjects()) {
    obj.setCoords()
    obj.dirty = true
  }
  deps.rebind(h.editor, canvas)
  const grid = await deps.rehydrateStrict(h.editor, canvas, index)
  const expected = gridCountOf(canvas.getObjects())
  if (!grid.ok || grid.count !== expected) {
    throw new Error(`그리드 재합성 실패(page ${index}, ok=${grid.ok}, ${grid.count}/${expected})`)
  }
  await deps.rehydratePhotoPrint(h.editor, canvas, index)
  deps.applyLocks(canvas)
  deps.trackRequired(canvas)
}

function finishHistory(canvas: fabric.Canvas): void {
  canvas.clearHistory()
  canvas.onHistory()
  canvas.requestRenderAll()
}

async function restoreCanvas(deps: SkinApplyDeps, h: SkinCanvasHandle, index: number, json: SkinCanvasJson): Promise<void> {
  await loadCanvas(deps, h, index, json)
  finishHistory(h.canvas)
}

interface PagesSnapshot {
  ids: string[]
  labels: string[]
}

function snapshotPages(count: number): PagesSnapshot {
  return { ids: useEditorStore.getState().pages.map((p) => p.id), labels: currentPageLabels(count) }
}

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** 적용 뒤 첫 편집(객체 추가·수정·삭제)에서 「적용 취소」를 거둔다. 적용 직후 처리 이벤트를 세지 않도록 다음 프레임에 무장 */
export function armSkinUndoWatch(handles: readonly SkinCanvasHandle[], onEdit: () => void, requestFrame: (cb: () => void) => void): () => void {
  let disarmed = false
  let armed = false
  const events = ['object:added', 'object:modified', 'object:removed'] as const
  const handler = (): void => {
    if (disarmed) return
    disarm()
    onEdit()
  }
  function disarm(): void {
    disarmed = true
    if (!armed) return
    for (const h of handles) for (const ev of events) h.canvas.off(ev, handler)
  }
  requestFrame(() => {
    if (disarmed) return
    armed = true
    for (const h of handles) for (const ev of events) h.canvas.on(ev, handler)
  })
  return disarm
}

let disarmUndoWatch: (() => void) | null = null

function releaseUndo(): void {
  disarmUndoWatch?.()
  disarmUndoWatch = null
  useCalendarSkinStore.getState().setUndo(null)
}

export const SKIN_FATAL_MESSAGE = '화면을 복구하지 못했습니다. 새로고침해 주세요. 서버에는 적용 직전 상태가 저장돼 있습니다'

/**
 * fatal — 보류를 풀지 않고 멈춘다(보류가 풀리면 미뤄 둔 저장이 깨진 캔버스를 서버에 쓴다). longTask 오버레이는 남기고
 * 문구만 바꾼다. 사용자가 새로고침한다(CalendarSkinSection 이 새로고침 버튼을 띄운다).
 */
function haltFatal(deps: SkinApplyDeps, error: unknown): Promise<never> {
  console.error('[calendarSkin] 화면 복구 실패 — 새로고침 필요:', error instanceof Error ? error.message : error)
  useCalendarSkinStore.getState().setPhase('fatal')
  deps.emit('longTask:start', { message: SKIN_FATAL_MESSAGE })
  return new Promise<never>(() => undefined)
}

/**
 * 확인 뒤 실행. 단계 5(적용 직전 저장) → 단계 6(보류 + longTask 안에서 순서 적용·사후 검증) → 실패면 단계 7(복원).
 */
export async function executeSkinApply(
  plan: SkinApplyPlan,
  choice: SkinBackgroundChoice,
  depsIn?: Partial<SkinApplyDeps>,
): Promise<SkinExecuteOutcome> {
  const deps = withDefaults(depsIn)
  const phase = useCalendarSkinStore.getState().phase
  if (phase === 'applying' || phase === 'fatal') return { kind: 'aborted', reason: 'busy' }

  // 단계 5 — 보류에 들어가기 전에 저장한다(보류 중 saveToServer 는 미뤄질 뿐 실행되지 않는다)
  const save = useSaveStore.getState()
  if (save.status === 'saving') return { kind: 'aborted', reason: 'saving' }
  if (save.isDirty || save.status !== 'saved') {
    const saveNow = deps.getSaveNow()
    if (saveNow) {
      let ok = false
      try {
        ok = await saveNow()
      } catch (e) {
        console.warn('[calendarSkin] 적용 직전 저장 실패:', e instanceof Error ? e.message : e)
      }
      if (!ok) return { kind: 'aborted', reason: 'save-failed' }
    }
  }

  const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
  try {
    releaseUndo()
    useCalendarSkinStore.getState().setPhase('applying')
  } catch (e) {
    // 보류 진입 전 예외 — 캔버스는 그대로라 실패로만 끝낸다
    useCalendarSkinStore.getState().setPhase('failed')
    return { kind: 'failed', reason: `적용 준비 실패: ${errorText(e)}` }
  }
  let longTaskOpen = false
  const fail = (reason: string): SkinExecuteOutcome => {
    if (longTaskOpen) deps.emit('longTask:end')
    longTaskOpen = false
    useCalendarSkinStore.getState().setPhase('failed')
    return { kind: 'failed', reason }
  }
  try {
    return await deps.suspend(() => applyInsideSuspend())
  } catch (e) {
    // 보류 안에서 처리하지 못한 예외(보류는 runWithAutosaveSuspended finally 가 푼다) — 상태·오버레이만 정리
    return fail(`적용 실패: ${errorText(e)}`)
  }

  async function applyInsideSuspend(): Promise<SkinExecuteOutcome> {
    deps.emit('longTask:start', { message: SKIN_LONG_TASK_MESSAGE })
    longTaskOpen = true
    const count = plan.to.length
    let handles: SkinCanvasHandle[]
    let before: SkinCanvasJson[]
    let pagesBefore: PagesSnapshot
    try {
      handles = deps.getHandles()
      if (handles.length !== count) return fail('캔버스 수가 바뀜')
      // 스냅샷은 지금 다시 뜬다(대화상자를 띄운 사이의 변화까지 담는다). 병합도 이 값으로 다시 계산한다(순수 함수)
      before = handles.map((h) => deps.serialize(h.canvas))
      pagesBefore = snapshotPages(count)
    } catch (e) {
      // 아직 아무 캔버스도 바꾸지 않았다 — 되돌릴 것 없이 실패
      return fail(`캔버스 읽기 실패: ${errorText(e)}`)
    }
    /** 손댄 캔버스(0..touched)를 적용 직전 JSON 으로 되돌린다. 되돌리기도 실패하면 fatal(보류 유지) */
    const rollback = async (touched: number, reason: string): Promise<SkinExecuteOutcome> => {
      try {
        for (let j = 0; j <= touched; j += 1) await restoreCanvas(deps, handles[j], j, before[j])
      } catch (rollbackError) {
        return haltFatal(deps, rollbackError)
      }
      return fail(reason)
    }
    let keep: boolean[]
    let decision: SkinBackgroundDecision
    let results: SkinMergeResult[]
    try {
      const summarySkin = dryRunAll(before, plan.from, plan.to, plan.templateIds, plan.prevSkinKey, () => false)
      decision = decideSkinBackgrounds(before, summarySkin, deps.apiBase())
      const keepAll = choice === 'keep'
      keep = keepAll ? before.map(() => true) : decision.keepOnSkinChoice
      results = before.map((cur, i) =>
        mergeSkinCanvas(cur, plan.from[i], plan.to[i], {
          templateIds: plan.templateIds[i],
          prevSkinKey: plan.prevSkinKey,
          keepCustomerBackground: keep[i],
        }),
      )
      if (results.some((r) => r.report.suspect || !r.json)) return fail('판정 오류 의심')
    } catch (e) {
      return fail(`병합 실패: ${e instanceof Error ? e.message : String(e)}`)
    }

    const droppedSrcs: string[] = []
    let touched = -1
    try {
      for (let i = 0; i < count; i += 1) {
        const h = handles[i]
        touched = i
        await loadCanvas(deps, h, i, results[i].json as SkinCanvasJson)
        for (const refill of results[i].refills) {
          const frame = h.canvas.getObjects().find((o) => (o as { id?: unknown }).id === refill.frameId)
          if (!frame) {
            droppedSrcs.push(refill.src)
            continue
          }
          try {
            const image = await deps.loadImage(refill.src)
            // 원래 사진의 extension(촬영일 등)을 보존한다 — 채움 경로는 기존 extension 에 병합한다
            if (refill.extension !== undefined) {
              ;(image as fabric.Object & { extension?: unknown }).extension = JSON.parse(JSON.stringify(refill.extension)) as unknown
            }
            await deps.fillFrame(h.editor, h.canvas, image, frame)
          } catch (e) {
            console.warn(`[calendarSkin] 사진 다시 넣기 실패(page ${i}) — 그 사진만 뺌:`, e instanceof Error ? e.message : e)
            droppedSrcs.push(refill.src)
          }
        }
        finishHistory(h.canvas)
      }
      // 사후 검증 — 캔버스·페이지·라벨 불변, 캔버스별 그리드 수 = 새 디자인 그리드 수
      const after = deps.getHandles()
      if (after.length !== count || after.some((h, i) => h.canvas !== handles[i].canvas)) throw new Error('캔버스 목록이 바뀜')
      const pagesAfter = snapshotPages(count)
      if (!sameArray(pagesBefore.ids, pagesAfter.ids) || !sameArray(pagesBefore.labels, pagesAfter.labels)) throw new Error('페이지 정보가 바뀜')
      for (let i = 0; i < count; i += 1) {
        const want = gridCountOf(Array.isArray(plan.to[i].objects) ? (plan.to[i].objects as unknown[]) : [])
        if (gridCountOf(handles[i].canvas.getObjects()) !== want) throw new Error(`그리드 수 불일치(page ${i})`)
      }
    } catch (e) {
      console.warn('[calendarSkin] 적용 실패 — 되돌림:', errorText(e))
      return rollback(touched, errorText(e))
    }

    try {
      return finishApplied(handles, before, keep, decision, results, droppedSrcs)
    } catch (e) {
      // 성공 후처리 중 예외 — 전 캔버스를 되돌리고 skinKey·되돌리기 스냅샷도 원래대로
      console.warn('[calendarSkin] 적용 후처리 실패 — 되돌림:', errorText(e))
      useCalendarStore.getState().setSkinKey(plan.prevSkinKey)
      disarmUndoWatch?.()
      disarmUndoWatch = null
      useCalendarSkinStore.getState().setUndo(null)
      return rollback(count - 1, `적용 후처리 실패: ${errorText(e)}`)
    }
  }

  function finishApplied(
    handles: SkinCanvasHandle[],
    before: SkinCanvasJson[],
    keep: boolean[],
    decision: SkinBackgroundDecision,
    results: SkinMergeResult[],
    droppedSrcs: string[],
  ): SkinExecuteOutcome {
    // 성공 — skinKey 기록·dirty 1회
    useCalendarStore.getState().setSkinKey(plan.targetKey)
    useSaveStore.getState().markDirty()
    const apiBase = deps.apiBase()
    const uploads = new Set<string>()
    results.forEach((r, i) => {
      if (!keep[i]) for (const u of decision.uploadsByCanvas[i] ?? []) uploads.add(u)
      for (const d of r.report.dropped) if (d.kind === 'photo' && classifyBackgroundSrc(d.src, apiBase) === 'upload') uploads.add(d.src as string)
    })
    for (const src of droppedSrcs) if (classifyBackgroundSrc(src, apiBase) === 'upload') uploads.add(src)
    if (uploads.size > 0) {
      void deps.keepUploads([...uploads]).catch((e: unknown) => {
        console.warn('[calendarSkin] 내 업로드 등록 실패(적용은 유지):', e instanceof Error ? e.message : e)
      })
    }
    const undo: SkinUndoSnapshot = { before, prevSkinKey: plan.prevSkinKey, label: plan.label }
    useCalendarSkinStore.getState().setUndo(undo)
    useCalendarSkinStore.getState().setPhase('applied')
    deps.emit('longTask:end')
    longTaskOpen = false
    disarmUndoWatch = armSkinUndoWatch(handles, () => {
      disarmUndoWatch = null
      useCalendarSkinStore.getState().setUndo(null)
      if (useCalendarSkinStore.getState().phase === 'applied') useCalendarSkinStore.getState().setPhase('idle')
    }, deps.requestFrame)
    const photosDropped = results.reduce((n, r) => n + r.report.photosDropped, 0) + droppedSrcs.length
    return { kind: 'applied', label: plan.label, photosDropped }
  }
}

/** 「적용 취소」 — 스냅샷으로 되돌리고 skinKey 를 이전 값으로. 스냅샷이 없으면 false */
export async function undoSkinApply(depsIn?: Partial<SkinApplyDeps>): Promise<boolean> {
  const deps = withDefaults(depsIn)
  const snapshot = useCalendarSkinStore.getState().undo
  if (!snapshot || useCalendarSkinStore.getState().phase !== 'applied') return false
  disarmUndoWatch?.()
  disarmUndoWatch = null
  useCalendarSkinStore.getState().setPhase('applying')
  return deps.suspend(async (): Promise<boolean> => {
    deps.emit('longTask:start', { message: SKIN_LONG_TASK_MESSAGE })
    const handles = deps.getHandles()
    try {
      if (handles.length !== snapshot.before.length) throw new Error('캔버스 수가 바뀜')
      for (let i = 0; i < handles.length; i += 1) await restoreCanvas(deps, handles[i], i, snapshot.before[i] as SkinCanvasJson)
    } catch (e) {
      return haltFatal(deps, e)
    }
    useCalendarStore.getState().setSkinKey(snapshot.prevSkinKey)
    useSaveStore.getState().markDirty()
    useCalendarSkinStore.getState().setUndo(null)
    useCalendarSkinStore.getState().setPhase('idle')
    deps.emit('longTask:end')
    return true
  })
}

/** 테스트 전용 — 모듈 전역 감시 해제 */
export function __resetSkinApplyForTest(): void {
  disarmUndoWatch?.()
  disarmUndoWatch = null
}
