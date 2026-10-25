/**
 * calendar/skin.ts — 캘린더 스킨 적용 병합(순수 함수, 설계 C10 §3.3 · T7a, 2026-10-25)
 *
 * 캔버스 1장의 현재 JSON(`cur`)·지금 따르는 템플릿(`from`, 알 수 없으면 null)·새 스킨 템플릿(`to`)을 받아
 * 스킨을 입힌 캔버스 JSON 을 만든다. fabric 에 의존하지 않고 입력을 바꾸지 않는다(출력은 입력과 참조를 공유하지 않음).
 *
 * 규칙 요약(오너 결정 Q1 (a) 템플릿 전체 · Q2 (a) 면별 사진틀 수 같음 · Q3 (a) 문구는 문자열만):
 * - workspace: 현재 캔버스 것을 유지(도련 반영 크기 그대로 — 리사이즈는 편집기 후처리).
 * - 템플릿 유래 요소(top-level id ∈ 판정 집합, 또는 보조 판정)는 버리고 `to` 의 요소를 쓴다.
 *   보조 판정(판정 집합 밖)은 고객이 만들 수 없는 표지만 쓴다 — `deleteable:false`·템플릿 잠금(designer/admin)·날짜 그리드.
 *   extensionType(frame·background 등)만으로는 고객 요소로 둔다(고객도 라이브러리 틀·배경을 추가한다 — 오분류 시
 *   요소가 하나 더 남는 쪽으로 실패, 오너 Q2 '사진 손실 없음').
 *   · 날짜 그리드는 버린다(`to` 의 그리드를 쓰고 내용은 세션 메타로 다시 그림).
 *   · 고객이 고친 템플릿 문구(`from` 의 같은 id 문구와 다름)는 문자열만 `to` 의 같은 id 문구로 옮긴다.
 *   · 사진틀은 `to` 의 틀로 바뀌고, 채운 사진은 아래 규칙으로 옮긴다.
 * - 채운 사진: 대상 틀 = `to` 의 같은 id 틀, 없으면 읽는 순서(중심 top→left)로 남은 틀끼리 짝짓는다.
 *   기하가 같고 틀 모양(type·src·path)도 같으면 사진 JSON 을 그대로 두고 링크만 고친다. 이미지 틀끼리 src 만 다르면
 *   변환은 유지하고 clipPath 를 새 틀 이미지로 다시 만든다. 그 밖에는 `refills` 로 보낸다(편집기가 다시 채움, 자르기 초기화).
 *   대상 틀이 없으면 캔버스에서 빼고 보고한다(사진은 '내 업로드'에 남음).
 * - 고객 추가 요소: 원래 순서대로 맨 위에 둔다. 출력에 같은 id 가 있으면 새 id 로 바꾸고 참조도 고친다.
 * - 고객 배경(템플릿 유래가 아닌 extensionType 'background'): `keepCustomerBackground` 로 정한다(오너 결정 B2 (b)).
 *   true = 고객 배경을 workspace 바로 위에 두고 스킨 배경은 뺀다(편집기 addBackground 와 같이 배경은 하나 — 스킨 배경을 남기면
 *   고객 배경을 덮는다). false = 고객 배경을 빼고 보고(`removedCustomerBackgrounds`). 단 src 가 data URL 이면 '내 업로드'로
 *   되살릴 수 없어 false 여도 유지한다(`forcedKeepReason: 'data-url'`).
 */
import { v4 as uuidv4 } from 'uuid'

/** 캔버스 JSON(`toJSON(core.extendFabricOption)` 또는 템플릿 canvasData) — 필요한 키만 본다 */
export interface SkinCanvasJson {
  objects?: unknown[]
  [key: string]: unknown
}

type SkinObject = Record<string, unknown>

/**
 * 보조 판정 — id 가 판정 집합에 없어도 extensionType 만으로 템플릿 유래로 보는 값.
 * 날짜 그리드만 둔다: 그리드는 관리자 템플릿 제작(editMode) 도구로만 추가된다(고객 경로 없음).
 * 'frame'·'background'·'template-element' 는 고객 라이브러리 추가와 겹쳐 넣지 않는다.
 */
export const SKIN_TEMPLATE_EXTENSION_TYPES: readonly string[] = ['calendar-grid']
/** 템플릿 문구로 보는 fabric type */
export const SKIN_TEXT_TYPES: readonly string[] = ['text', 'i-text', 'textbox']
/** 사진틀 기하 비교 허용 오차(px·도) */
export const SKIN_GEOMETRY_TOLERANCE = 0.5
/**
 * 차단 판정의 템플릿 표지 extensionType — '고객 추가'로 분류된 요소에 이 값(또는 deleteable:false·템플릿 잠금)이 있고
 * 출처가 불명하면 판정 오류 의심으로 막는다. 분류(보조 판정)에는 쓰지 않는다(`SKIN_TEMPLATE_EXTENSION_TYPES`).
 */
export const SKIN_TEMPLATE_MARK_EXTENSION_TYPES: readonly string[] = ['frame', 'background', 'calendar-grid']

const GRID_EXTENSION_TYPE = 'calendar-grid'
const FRAME_EXTENSION_TYPE = 'frame'
const BACKGROUND_EXTENSION_TYPE = 'background'
const WORKSPACE_ID = 'workspace'
/** 캔버스 최상위 키 중 디자인(템플릿) 소유 — `to` 값을 쓰고 `to` 에 없으면 지운다 */
const DESIGN_TOP_LEVEL_KEYS = ['background', 'backgroundImage', 'overlay', 'overlayImage'] as const
/** 템플릿이 건 잠금 수준(고객 'user' 잠금은 고객 요소일 수 있어 판정에 쓰지 않는다) */
const TEMPLATE_LOCK_LEVELS = ['designer', 'admin']
/** 출처 판정에서 빼는 시스템 객체(편집기 화면 전용 가이드·재단선) — 편집기 시스템 객체 판정과 같은 표지 */
const SYSTEM_OBJECT_IDS = ['workspace', 'cut-border', 'safe-zone-border']
const SYSTEM_OBJECT_ID_PREFIXES = ['center-guideline-', 'spread-guide-']
const SYSTEM_EXTENSION_TYPES = ['guideline', 'printguide']

export interface SkinMergeOptions {
  /** true 면 보고·refills 만 계산하고 json 은 null(확인 대화상자 개수용 — 보고는 실제 실행과 같다) */
  dryRun?: boolean
  /**
   * 판정 집합 추가분 — 기준 세트 템플릿 i 의 ids ∪ 등록된 모든 스킨 세트 템플릿 i 의 ids(`collectSkinTemplateIds`).
   * `from`·`to` 의 top-level ids 는 항상 포함한다.
   */
  templateIds?: Iterable<string>
  /**
   * 세션의 직전 디자인(스킨) key. `from` 이 null 인데 이 값이 있으면 '출처 불명'(직전 스킨 세트를 쓸 수 없음)으로 본다.
   * 생략·null = 직전 스킨 없음(기본 디자인).
   */
  prevSkinKey?: string | null
  /** 보고용 기준 템플릿 객체 수(workspace 제외). 생략 = `from`(없으면 `to`) 의 객체 수 — @deprecated 차단 판정에 쓰지 않는다 */
  referenceObjectCount?: number
  /** 새 id 생성기(테스트 주입용). 기본 uuid v4 */
  createId?: () => string
  /**
   * 고객 배경 처리(오너 결정 B2 (b)). true = '내 배경 유지'(workspace 바로 위, 스킨 배경 대체) ·
   * false(기본) = '스킨 배경 사용'(고객 배경 제거 + 보고). data URL 고객 배경은 false 여도 유지한다.
   */
  keepCustomerBackground?: boolean
}

/** 고객 배경 src 종류 — 'storage-url' 이면 호출자가 '내 업로드'에 남길 수 있다 */
export type SkinBackgroundSrcKind = 'storage-url' | 'data-url' | 'other'

/** '스킨 배경 사용'으로 뺀 고객 배경 */
export interface SkinRemovedBackground {
  /** 현재 캔버스의 객체 id */
  id: string
  srcKind: SkinBackgroundSrcKind
  /** srcKind 'storage-url' 일 때만 — '내 업로드' 등록용 */
  src?: string
}

/** 'geometry' = 대상 틀 기하가 다름 · 'frame-shape' = 기하는 같으나 틀 모양이 달라 clipPath 를 다시 만들 수 없음 */
export type SkinRefillReason = 'geometry' | 'frame-shape'

/** 적용 뒤 편집기가 `fillImageIntoFrame` 으로 다시 채울 사진(자르기·확대는 초기화) */
export interface SkinRefill {
  /** 출력 JSON 의 대상 틀 id */
  frameId: string
  src: string
  extension?: unknown
  /** 원래 사진 객체 id */
  photoId: string
  reason: SkinRefillReason
}

export interface SkinMergeDropped {
  kind: 'photo' | 'text'
  /** 현재 캔버스의 객체 id */
  id: string
  src?: string
  text?: string
}

export interface SkinMergeReport {
  /** 기준 템플릿 객체 수(workspace 제외) — @deprecated 차단 판정에 쓰지 않는다(보고용으로만 남김) */
  referenceObjectCount: number
  /** 템플릿 유래로 판정해 버린 현재 객체 수(그리드·틀·문구 포함, 채운 사진 제외) */
  templateRemoved: number
  /** 그중 날짜 그리드 수 */
  gridsRemoved: number
  /** 그중 판정 집합 밖인데 보조 판정(deleteable:false·템플릿 잠금·그리드)만으로 분류된 수 — 안내·차단 참고값 */
  auxiliaryTemplateCount: number
  /** 사진 JSON 을 그대로 유지(링크만 수정) */
  photosKept: number
  /** 변환은 유지하고 clipPath 만 새 틀 이미지로 다시 만듦 */
  photosClipRebuilt: number
  /** 유지·재생성 중 다른 id 틀(읽는 순서 짝)로 옮긴 수 */
  photosRelinked: number
  /** refills 로 보낸 수(적용 후 다시 채움 — 자르기 초기화) */
  photosRefilled: number
  /** 대상 틀이 없어 캔버스에서 뺀 수 */
  photosDropped: number
  /** 고친 문구를 새 디자인 자리로 옮긴 수 */
  textsMoved: number
  /** 고친 문구인데 새 디자인에 같은 자리가 없어 뺀 수 */
  textsDropped: number
  /** 기준(`from`)을 알 수 없거나 기준에 없는 문구라 고침 여부를 판정하지 못해 옮기지 않은 수(새 디자인 문구와 다른 것만) */
  textsUnverified: number
  /** 고객 추가 요소로 남긴 수 */
  customerKept: number
  /** 그중 id 충돌(자신·그룹 자식·clipPath 중 하나라도)로 새 id 를 받은 객체 수 */
  customerReissued: number
  /** 판정 오류 의심 — 출처 불명이고 '고객 추가' 중 템플릿 표지가 있다(`isSkinMergeSuspect`). true 면 적용하지 않는다 */
  suspect: boolean
  /**
   * 출처 불명 — `from` 이 null 인데 직전 스킨이 있었거나(`prevSkinKey`), 판정 집합 밖 top-level 객체가 있다.
   * 판정 집합 밖 객체에서 시스템 객체와 고객 분류(고객 추가·고객 배경·채움 사진)는 뺀다 — 고객 요소는 원래 집합 밖이라
   * 세면 이 신호가 늘 참이 된다. 남는 것은 보조 판정(템플릿 표지)으로만 템플릿 유래가 된 객체다(`outsideTemplateIdsCount`).
   */
  originUnknown: boolean
  /** 판정 집합 밖인데 보조 판정으로 템플릿 유래가 된 top-level 객체 수(시스템 객체 제외) — 판정 집합이 현재 디자인을 다 담지 못한다는 신호 */
  outsideTemplateIdsCount: number
  /** '고객 추가'로 분류된 요소 중 템플릿 표지(템플릿 잠금·deleteable:false·`SKIN_TEMPLATE_MARK_EXTENSION_TYPES`)가 있는 수 */
  templateMarkedCustomerCount: number
  /** 뺀 사진·문구 목록(안내용) */
  dropped: SkinMergeDropped[]
  /** 결과에 남긴 고객 배경 수(workspace 바로 위). customerKept 에는 세지 않는다 */
  customerBackgroundsKept: number
  /** 고객 배경을 남겨서 뺀 스킨 배경 수 */
  skinBackgroundsReplaced: number
  /** '스킨 배경 사용'으로 뺀 고객 배경 */
  removedCustomerBackgrounds: SkinRemovedBackground[]
  /** keepCustomerBackground=false 인데 data URL 고객 배경이라 유지했으면 'data-url'(없으면 키 없음) */
  forcedKeepReason?: 'data-url'
}

export interface SkinMergeResult {
  /** 병합된 캔버스 JSON. dryRun 이면 null */
  json: SkinCanvasJson | null
  refills: SkinRefill[]
  report: SkinMergeReport
}

/** 여러 캔버스 보고 합계(확인 대화상자·차단 판정용) */
export interface SkinMergeSummary
  extends Omit<SkinMergeReport, 'dropped' | 'suspect' | 'originUnknown' | 'referenceObjectCount' | 'removedCustomerBackgrounds' | 'forcedKeepReason'> {
  /** 판정 오류 의심 캔버스 인덱스(입력 배열 순서) — 1개라도 있으면 적용하지 않는다 */
  suspectIndices: number[]
  blocked: boolean
  dropped: SkinMergeDropped[]
  /** 캔버스별 뺀 고객 배경(canvasIndex = 입력 배열 순서) */
  removedCustomerBackgrounds: Array<SkinRemovedBackground & { canvasIndex: number }>
  /** data URL 이라 강제로 유지한 캔버스 인덱스 */
  forcedKeepIndices: number[]
}

// ─── 공개 헬퍼 ──────────────────────────────────────────────────────────────

/** 템플릿 canvasData 들의 top-level 객체 id 합집합(판정 집합 T[i] 구성용). 문자열 JSON 도 읽는다 */
export function collectSkinTemplateIds(canvasDatas: Iterable<unknown>): Set<string> {
  const ids = new Set<string>()
  for (const data of canvasDatas) {
    for (const o of objectsOf(data)) {
      if (typeof o.id === 'string') ids.add(o.id)
    }
  }
  return ids
}

/**
 * 판정 오류 의심 — 출처 불명(`originUnknown`)이고 '고객 추가'로 분류된 요소 중 템플릿 표지가 1개 이상.
 * 판정 집합이 완전하면 템플릿 요소가 고객 추가로 남지 않으므로(오분류 0) 개수 임계값은 쓰지 않는다.
 * '고객 추가'는 고객 배경을 세지 않은 값이다(고객 배경은 따로 분류·보고 — `customerBackgroundsKept`).
 */
export function isSkinMergeSuspect(originUnknown: boolean, templateMarkedCustomerCount: number): boolean {
  return originUnknown && templateMarkedCustomerCount > 0
}

/** 템플릿 표지 — 템플릿 잠금(designer/admin)·deleteable:false·`SKIN_TEMPLATE_MARK_EXTENSION_TYPES` */
function hasSkinTemplateMark(o: SkinObject): boolean {
  return o.deleteable === false
    || hasTemplateLock(o.lockInfo)
    || (typeof o.extensionType === 'string' && SKIN_TEMPLATE_MARK_EXTENSION_TYPES.includes(o.extensionType))
}

/** 캔버스별 보고 합계 */
export function summarizeSkinMergeReports(reports: readonly SkinMergeReport[]): SkinMergeSummary {
  const sum: SkinMergeSummary = {
    templateRemoved: 0,
    gridsRemoved: 0,
    auxiliaryTemplateCount: 0,
    photosKept: 0,
    photosClipRebuilt: 0,
    photosRelinked: 0,
    photosRefilled: 0,
    photosDropped: 0,
    textsMoved: 0,
    textsDropped: 0,
    textsUnverified: 0,
    customerKept: 0,
    customerReissued: 0,
    outsideTemplateIdsCount: 0,
    templateMarkedCustomerCount: 0,
    suspectIndices: [],
    blocked: false,
    dropped: [],
    customerBackgroundsKept: 0,
    skinBackgroundsReplaced: 0,
    removedCustomerBackgrounds: [],
    forcedKeepIndices: [],
  }
  reports.forEach((r, i) => {
    sum.templateRemoved += r.templateRemoved
    sum.gridsRemoved += r.gridsRemoved
    sum.auxiliaryTemplateCount += r.auxiliaryTemplateCount
    sum.photosKept += r.photosKept
    sum.photosClipRebuilt += r.photosClipRebuilt
    sum.photosRelinked += r.photosRelinked
    sum.photosRefilled += r.photosRefilled
    sum.photosDropped += r.photosDropped
    sum.textsMoved += r.textsMoved
    sum.textsDropped += r.textsDropped
    sum.textsUnverified += r.textsUnverified
    sum.customerKept += r.customerKept
    sum.customerReissued += r.customerReissued
    sum.outsideTemplateIdsCount += r.outsideTemplateIdsCount ?? 0
    sum.templateMarkedCustomerCount += r.templateMarkedCustomerCount ?? 0
    if (r.suspect) sum.suspectIndices.push(i)
    sum.dropped.push(...r.dropped)
    // 새 필드가 없는 구 보고(직렬화 왕복 등)도 받는다
    sum.customerBackgroundsKept += r.customerBackgroundsKept ?? 0
    sum.skinBackgroundsReplaced += r.skinBackgroundsReplaced ?? 0
    for (const b of r.removedCustomerBackgrounds ?? []) sum.removedCustomerBackgrounds.push({ ...b, canvasIndex: i })
    if (r.forcedKeepReason) sum.forcedKeepIndices.push(i)
  })
  sum.blocked = sum.suspectIndices.length > 0
  return sum
}

// ─── 병합 ──────────────────────────────────────────────────────────────────

interface FillPlan {
  obj: SkinObject
  /** 현재 캔버스의 연결 대상(틀) id */
  linkId: string
  /** 현재 캔버스에서 사진이 틀보다 아래(앞 순번)였는가 */
  below: boolean
}

interface PlacedPhoto {
  obj: SkinObject
  below: boolean
}

export function mergeSkinCanvas(
  cur: SkinCanvasJson,
  from: SkinCanvasJson | null,
  to: SkinCanvasJson,
  opts: SkinMergeOptions = {},
): SkinMergeResult {
  const createId = opts.createId ?? uuidv4
  const curObjs = objectsOf(cur)
  const fromObjs = from ? objectsOf(from) : null
  const toObjs = objectsOf(to)
  const curById = indexById(curObjs)
  const fromById = fromObjs ? indexById(fromObjs) : null
  const toById = indexById(toObjs)

  const judge = new Set<string>(opts.templateIds ?? [])
  for (const o of fromObjs ?? []) if (typeof o.id === 'string') judge.add(o.id)
  for (const o of toObjs) if (typeof o.id === 'string') judge.add(o.id)

  const inJudge = (o: SkinObject): boolean => typeof o.id === 'string' && judge.has(o.id)
  const isAuxiliaryTemplate = (o: SkinObject): boolean =>
    o.deleteable === false
    || hasTemplateLock(o.lockInfo)
    || (typeof o.extensionType === 'string' && SKIN_TEMPLATE_EXTENSION_TYPES.includes(o.extensionType))
  const isTemplateOrigin = (o: SkinObject): boolean => inJudge(o) || isAuxiliaryTemplate(o)

  const report: SkinMergeReport = {
    referenceObjectCount: opts.referenceObjectCount ?? countDesignObjects(fromObjs ?? toObjs),
    templateRemoved: 0,
    gridsRemoved: 0,
    auxiliaryTemplateCount: 0,
    photosKept: 0,
    photosClipRebuilt: 0,
    photosRelinked: 0,
    photosRefilled: 0,
    photosDropped: 0,
    textsMoved: 0,
    textsDropped: 0,
    textsUnverified: 0,
    customerKept: 0,
    customerReissued: 0,
    suspect: false,
    originUnknown: false,
    outsideTemplateIdsCount: 0,
    templateMarkedCustomerCount: 0,
    dropped: [],
    customerBackgroundsKept: 0,
    skinBackgroundsReplaced: 0,
    removedCustomerBackgrounds: [],
  }

  // 1) 현재 객체 분류
  let curWorkspace: SkinObject | null = null
  const fills: FillPlan[] = []
  const customers: SkinObject[] = []
  /** 결과에 남길 고객 배경(workspace 바로 위) */
  const keptBackgrounds: SkinObject[] = []
  /** to 문구 id → 옮길 문자열(+requiredEditTouched) */
  const textMoves = new Map<string, { text: unknown; touched: unknown }>()

  const curIndex = new Map<SkinObject, number>(curObjs.map((o, k) => [o, k]))
  for (let k = 0; k < curObjs.length; k += 1) {
    const o = curObjs[k]
    if (o.id === WORKSPACE_ID) {
      if (!curWorkspace) curWorkspace = o
      continue
    }
    const linkId = linkOf(o)
    if (linkId && isImageLike(o) && !isTemplateSample(o, fromById)) {
      const target = curById.get(linkId)
      if (target && target !== o && target.id !== WORKSPACE_ID && isTemplateOrigin(target)) {
        fills.push({ obj: o, linkId, below: k < (curIndex.get(target) ?? -1) })
        continue
      }
    }
    if (!isTemplateOrigin(o)) {
      if (o.extensionType === BACKGROUND_EXTENSION_TYPE) classifyCustomerBackground(o)
      else customers.push(o)
      continue
    }
    report.templateRemoved += 1
    if (!inJudge(o)) report.auxiliaryTemplateCount += 1
    if (o.extensionType === GRID_EXTENSION_TYPE) {
      report.gridsRemoved += 1
      continue
    }
    if (isText(o) && typeof o.id === 'string') classifyText(o, o.id)
  }

  function classifyCustomerBackground(o: SkinObject): void {
    const srcKind = backgroundSrcKind(o.src)
    if (opts.keepCustomerBackground === true) {
      keptBackgrounds.push(o)
      return
    }
    if (srcKind === 'data-url') {
      keptBackgrounds.push(o)
      report.forcedKeepReason = 'data-url'
      return
    }
    const removed: SkinRemovedBackground = { id: typeof o.id === 'string' ? o.id : '', srcKind }
    if (srcKind === 'storage-url' && typeof o.src === 'string') removed.src = o.src
    report.removedCustomerBackgrounds.push(removed)
  }

  function classifyText(o: SkinObject, id: string): void {
    const toText = toById.get(id)
    const toIsText = !!toText && isText(toText)
    const base = fromById?.get(id)
    if (!base || !isText(base)) {
      if (toIsText && o.text !== toText.text) report.textsUnverified += 1
      return
    }
    if (o.text === base.text) return
    if (toIsText) {
      textMoves.set(id, { text: o.text, touched: o.requiredEditTouched })
      report.textsMoved += 1
    } else {
      report.textsDropped += 1
      report.dropped.push({ kind: 'text', id, text: typeof o.text === 'string' ? o.text : undefined })
    }
  }

  // 2) 사진틀 짝짓기 — 같은 id 우선, 나머지는 읽는 순서
  const pairs = pairFrames(
    curObjs.filter((o) => isFrame(o) && isTemplateOrigin(o)),
    toObjs.filter(isFrame),
  )

  /** to 객체 id → 그 위·아래에 끼울 사진 */
  const placed = new Map<string, PlacedPhoto[]>()
  /** 사진을 받는(유지·refill) to 틀 id — 그 틀에 걸린 `to` 의 채움 사진(견본)은 뺀다 */
  const occupied = new Set<string>()
  /** to 틀 id → 유지한 사진 id(틀의 fillImage 속성) */
  const frameFill = new Map<string, string>()
  const refills: SkinRefill[] = []

  for (const fill of fills) {
    const o = fill.obj
    const photoId = typeof o.id === 'string' ? o.id : ''
    const curTarget = curById.get(fill.linkId) as SkinObject
    const target = isFrame(curTarget) ? pairs.get(fill.linkId) : sameIdTarget(toById.get(fill.linkId))
    if (!target || typeof target.id !== 'string' || occupied.has(target.id)) {
      dropPhoto(o, photoId)
      continue
    }
    const targetId = target.id
    if (!sameGeometry(curTarget, target)) {
      queueRefill(o, photoId, targetId, 'geometry')
      continue
    }
    let photo: SkinObject | null = null
    if (sameFrameShape(curTarget, target)) {
      photo = relinkPhoto(o, fill.linkId, targetId, null)
      report.photosKept += 1
    } else {
      const clip = rebuildImageClip(o.clipPath, curTarget, target)
      if (!clip) {
        queueRefill(o, photoId, targetId, 'frame-shape')
        continue
      }
      photo = relinkPhoto(o, fill.linkId, targetId, clip)
      report.photosClipRebuilt += 1
    }
    if (targetId !== fill.linkId) report.photosRelinked += 1
    occupied.add(targetId)
    if (typeof photo.id === 'string') frameFill.set(targetId, photo.id)
    const list = placed.get(targetId) ?? []
    list.push({ obj: photo, below: fill.below })
    placed.set(targetId, list)
  }

  function dropPhoto(o: SkinObject, photoId: string): void {
    report.photosDropped += 1
    report.dropped.push({ kind: 'photo', id: photoId, src: typeof o.src === 'string' ? o.src : undefined })
  }

  function queueRefill(o: SkinObject, photoId: string, frameId: string, reason: SkinRefillReason): void {
    if (typeof o.src !== 'string' || o.src.length === 0) {
      dropPhoto(o, photoId)
      return
    }
    const refill: SkinRefill = { frameId, src: o.src, photoId, reason }
    if (o.extension !== undefined) refill.extension = o.extension
    refills.push(refill)
    occupied.add(frameId)
    report.photosRefilled += 1
  }

  // 3) 출력 순서 — to 순서 + 유지 사진 끼움, 그 위에 고객 추가 요소
  const replaceSkinBackground = keptBackgrounds.length > 0
  const toKept = toObjs.filter((t) => {
    if (isImageLike(t) && occupied.has(linkOf(t) ?? '')) return false
    if (replaceSkinBackground && t.extensionType === BACKGROUND_EXTENSION_TYPE) {
      report.skinBackgroundsReplaced += 1
      return false
    }
    return true
  })
  report.customerBackgroundsKept = keptBackgrounds.length
  const used = new Set<string>()
  if (curWorkspace || toById.has(WORKSPACE_ID)) used.add(WORKSPACE_ID)
  for (const t of toKept) collectIds(t, used)
  for (const list of placed.values()) for (const p of list) collectIds(p.obj, used)

  // 고객 요소 id 충돌 — 출력 쪽 collectIds 와 같은 기준(자신·그룹 자식·clipPath)으로 검사·재부여
  const idMap = new Map<string, string>()
  for (const c of [...keptBackgrounds, ...customers]) {
    const own: string[] = []
    collectIdList(c, own)
    let reissued = false
    for (const id of own) {
      if (used.has(id)) {
        const next = createId()
        idMap.set(id, next)
        used.add(next)
        reissued = true
      } else {
        used.add(id)
      }
    }
    if (reissued) report.customerReissued += 1
  }
  report.customerKept = customers.length
  // 차단 판정 — 출처 불명 + '고객 추가' 중 템플릿 표지
  for (const o of curObjs) {
    if (o.id !== WORKSPACE_ID && !isSystemObject(o) && !inJudge(o) && isAuxiliaryTemplate(o)) report.outsideTemplateIdsCount += 1
  }
  report.templateMarkedCustomerCount = customers.filter((c) => !isSystemObject(c) && hasSkinTemplateMark(c)).length
  const prevSkinKnown = typeof opts.prevSkinKey === 'string' && opts.prevSkinKey.length > 0
  report.originUnknown = (from === null && prevSkinKnown) || report.outsideTemplateIdsCount > 0
  report.suspect = isSkinMergeSuspect(report.originUnknown, report.templateMarkedCustomerCount)

  if (opts.dryRun) return { json: null, refills, report }

  const out: SkinObject[] = []
  let workspacePlaced = false
  for (const t of toKept) {
    if (t.id === WORKSPACE_ID) {
      out.push(curWorkspace ?? t)
      workspacePlaced = true
      continue
    }
    const id = typeof t.id === 'string' ? t.id : null
    const photos = id ? placed.get(id) ?? [] : []
    for (const p of photos) if (p.below) out.push(p.obj)
    out.push(adjustTemplateObject(t, id))
    for (const p of photos) if (!p.below) out.push(p.obj)
  }
  if (!workspacePlaced && curWorkspace) out.unshift(curWorkspace)
  // 고객 배경은 workspace 바로 위(workspace 가 없으면 맨 아래)
  const wsAt = out.findIndex((o) => o.id === WORKSPACE_ID)
  out.splice(wsAt + 1, 0, ...keptBackgrounds.map((b) => remapCustomer(b, idMap)))
  for (const c of customers) out.push(remapCustomer(c, idMap))

  function adjustTemplateObject(t: SkinObject, id: string | null): SkinObject {
    if (!id) return t
    const move = textMoves.get(id)
    const fillId = frameFill.get(id)
    const refillTarget = occupied.has(id) && !fillId
    if (!move && !fillId && !refillTarget) return t
    const next: SkinObject = { ...t }
    if (move) {
      next.text = move.text
      if (move.touched !== undefined) next.requiredEditTouched = move.touched
    }
    if (fillId) next.fillImage = fillId
    else if (refillTarget) delete next.fillImage
    return next
  }

  const json: SkinCanvasJson = {}
  for (const [key, value] of Object.entries(cur)) if (key !== 'objects') json[key] = value
  for (const key of DESIGN_TOP_LEVEL_KEYS) {
    if (key in to) json[key] = to[key]
    else delete json[key]
  }
  json.objects = out
  return { json: deepCloneJson(json), refills, report }
}

// ─── 내부 판정 ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is SkinObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function objectsOf(json: unknown): SkinObject[] {
  let data = json
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return []
    }
  }
  if (!isRecord(data) || !Array.isArray(data.objects)) return []
  return data.objects.filter(isRecord)
}

function indexById(objs: readonly SkinObject[]): Map<string, SkinObject> {
  const map = new Map<string, SkinObject>()
  for (const o of objs) if (typeof o.id === 'string' && !map.has(o.id)) map.set(o.id, o)
  return map
}

function countDesignObjects(objs: readonly SkinObject[]): number {
  return objs.filter((o) => o.id !== WORKSPACE_ID).length
}

function hasTemplateLock(lockInfo: unknown): boolean {
  return isRecord(lockInfo) && lockInfo.isLocked === true
    && typeof lockInfo.lockLevel === 'string' && TEMPLATE_LOCK_LEVELS.includes(lockInfo.lockLevel)
}

/** 편집기 화면 전용 시스템 객체(workspace·가이드·재단선) — 출처 판정에서 뺀다 */
function isSystemObject(o: SkinObject): boolean {
  if (o.excludeFromExport === true || o.type === 'GuideLine') return true
  if (typeof o.extensionType === 'string' && SYSTEM_EXTENSION_TYPES.includes(o.extensionType)) return true
  if (typeof o.id !== 'string') return false
  const id = o.id
  return SYSTEM_OBJECT_IDS.includes(id) || SYSTEM_OBJECT_ID_PREFIXES.some((p) => id.startsWith(p))
}

function isText(o: SkinObject): boolean {
  return typeof o.type === 'string' && SKIN_TEXT_TYPES.includes(o.type)
}

/** 배경 src 종류 — data: 는 'data-url', 경로(절대 URL 의 경로 포함)에 `/storage/` 가 있으면 'storage-url' */
function backgroundSrcKind(src: unknown): SkinBackgroundSrcKind {
  if (typeof src !== 'string' || src.length === 0) return 'other'
  if (/^data:/i.test(src)) return 'data-url'
  const path = src.replace(/^(https?:)?\/\/[^/]+/i, '').split(/[?#]/)[0]
  return /(^|\/)storage\//.test(path) ? 'storage-url' : 'other'
}

function isFrame(o: SkinObject): boolean {
  return o.extensionType === FRAME_EXTENSION_TYPE && o.id !== WORKSPACE_ID
}

function isImageLike(o: SkinObject): boolean {
  return o.extensionType === 'fillImage' || o.type === 'image'
}

function linkOf(o: SkinObject): string | null {
  if (typeof o.frameRef === 'string' && o.frameRef.length > 0) return o.frameRef
  if (typeof o.parentLayerId === 'string' && o.parentLayerId.length > 0) return o.parentLayerId
  return null
}

/** `from` 에 같은 id·같은 src·같은 연결로 있는 채움 사진 = 템플릿 견본(고객 사진 아님) */
function isTemplateSample(o: SkinObject, fromById: Map<string, SkinObject> | null): boolean {
  if (!fromById || typeof o.id !== 'string') return false
  const f = fromById.get(o.id)
  return !!f && f.src === o.src && linkOf(f) === linkOf(o)
}

function sameIdTarget(t: SkinObject | undefined): SkinObject | undefined {
  return t && t.id !== WORKSPACE_ID ? t : undefined
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function originFactor(v: unknown, axis: 'x' | 'y'): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v - 0.5
  if (axis === 'x') return v === 'center' ? 0 : v === 'right' ? 0.5 : -0.5
  return v === 'center' ? 0 : v === 'bottom' ? 0.5 : -0.5
}

/** 객체 중심(캔버스 좌표) — fabric translateToCenterPoint 와 같은 식(stroke 미포함, 읽는 순서용) */
function centerOf(o: SkinObject): { x: number; y: number } {
  const w = num(o.width, 0) * num(o.scaleX, 1)
  const h = num(o.height, 0) * num(o.scaleY, 1)
  const dx = -originFactor(o.originX, 'x') * w
  const dy = -originFactor(o.originY, 'y') * h
  const rad = (num(o.angle, 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: num(o.left, 0) + dx * cos - dy * sin, y: num(o.top, 0) + dx * sin + dy * cos }
}

function readingOrder(objs: readonly SkinObject[]): SkinObject[] {
  const centers = new Map(objs.map((o) => [o, centerOf(o)]))
  return [...objs].sort((a, b) => {
    const ca = centers.get(a) as { x: number; y: number }
    const cb = centers.get(b) as { x: number; y: number }
    const dy = ca.y - cb.y
    if (Math.abs(dy) > SKIN_GEOMETRY_TOLERANCE) return dy
    return ca.x - cb.x
  })
}

/** 현재 틀 id → 대상 to 틀. 같은 id 를 먼저 잇고, 남은 틀끼리 읽는 순서로 잇는다 */
function pairFrames(curFrames: readonly SkinObject[], toFrames: readonly SkinObject[]): Map<string, SkinObject> {
  const pairs = new Map<string, SkinObject>()
  const toById = indexById(toFrames)
  const taken = new Set<SkinObject>()
  const rest: SkinObject[] = []
  for (const f of curFrames) {
    const same = typeof f.id === 'string' ? toById.get(f.id) : undefined
    if (same && !taken.has(same) && typeof f.id === 'string' && !pairs.has(f.id)) {
      pairs.set(f.id, same)
      taken.add(same)
    } else {
      rest.push(f)
    }
  }
  const restTo = readingOrder(toFrames.filter((t) => !taken.has(t)))
  readingOrder(rest).forEach((f, k) => {
    if (typeof f.id === 'string' && restTo[k] && !pairs.has(f.id)) pairs.set(f.id, restTo[k])
  })
  return pairs
}

function near(a: unknown, b: unknown, fallback: number): boolean {
  return Math.abs(num(a, fallback) - num(b, fallback)) <= SKIN_GEOMETRY_TOLERANCE
}

/**
 * 틀 기하(left·top·width·height·scale·angle·skew, 오차 0.5) + origin·flip 이 같은가.
 * origin 은 fabric 과 같이 키워드와 숫자(0=left·top, 0.5=center, 1=right·bottom)를 같은 값으로 본다(생략 = left·top).
 */
function sameGeometry(a: SkinObject, b: SkinObject): boolean {
  return near(a.left, b.left, 0) && near(a.top, b.top, 0)
    && near(a.width, b.width, 0) && near(a.height, b.height, 0)
    && near(a.scaleX, b.scaleX, 1) && near(a.scaleY, b.scaleY, 1)
    && near(a.angle, b.angle, 0) && near(a.skewX, b.skewX, 0) && near(a.skewY, b.skewY, 0)
    && originFactor(a.originX, 'x') === originFactor(b.originX, 'x')
    && originFactor(a.originY, 'y') === originFactor(b.originY, 'y')
    && (a.flipX === true) === (b.flipX === true) && (a.flipY === true) === (b.flipY === true)
}

/**
 * rect 모서리 반경 — fabric `Rect._initRxRy` 와 같이 생략은 0, 한쪽만 있으면 다른 쪽도 같은 값.
 * (생략과 0, `{rx:8}` 과 `{rx:8, ry:8}` 은 같은 틀 모양이다)
 */
function cornerRadii(o: SkinObject): [number, number] {
  const rx = num(o.rx, 0)
  const ry = num(o.ry, 0)
  if (rx && !ry) return [rx, rx]
  if (ry && !rx) return [ry, ry]
  return [rx, ry]
}

/** 틀 모양(clipPath 를 결정하는 값)이 같은가 — type·src·path·points·rx·ry */
function sameFrameShape(a: SkinObject, b: SkinObject): boolean {
  if (a.type !== b.type || a.src !== b.src) return false
  for (const key of ['path', 'points'] as const) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  }
  const [arx, ary] = cornerRadii(a)
  const [brx, bry] = cornerRadii(b)
  return arx === brx && ary === bry
}

/**
 * 이미지 틀끼리(기하 같음) 틀 이미지만 바뀐 경우 — 사진의 옛 clipPath(틀 이미지 복제본, inverted·absolutePositioned)에서
 * 위치·크기·각도는 그대로 두고 이미지 원천만 새 틀 것으로 바꾼다. 그 밖(벡터 틀·clipPath 없음·이미지 아님)은 null.
 */
function rebuildImageClip(clipPath: unknown, curFrame: SkinObject, target: SkinObject): SkinObject | null {
  if (curFrame.type !== 'image' || target.type !== 'image' || typeof target.src !== 'string') return null
  if (!isRecord(clipPath) || clipPath.type !== 'image') return null
  const next: SkinObject = { ...clipPath, src: target.src }
  for (const key of ['crossOrigin', 'cropX', 'cropY', 'filters'] as const) {
    if (key in target) next[key] = target[key]
    else delete next[key]
  }
  return next
}

/** `${old}_suffix` 규약 id(예: `_fillImage`·`_frameClip`)를 새 틀 id 로 바꾼다 */
function renamePrefixed(id: unknown, oldId: string, newId: string): unknown {
  if (typeof id !== 'string' || oldId === newId) return id
  return id.startsWith(`${oldId}_`) ? `${newId}${id.slice(oldId.length)}` : id
}

function relinkPhoto(o: SkinObject, oldId: string, newId: string, clip: SkinObject | null): SkinObject {
  const next: SkinObject = { ...o }
  if (oldId !== newId) {
    next.id = renamePrefixed(o.id, oldId, newId)
    if (o.frameRef !== undefined) next.frameRef = newId
    if (o.parentLayerId !== undefined) next.parentLayerId = newId
  }
  const baseClip = clip ?? (isRecord(o.clipPath) ? o.clipPath : null)
  if (baseClip && (clip || oldId !== newId)) {
    next.clipPath = { ...baseClip, id: renamePrefixed(baseClip.id, oldId, newId) }
  }
  return next
}

/** 객체와 하위(그룹 objects·clipPath)의 id 를 모은다 */
function collectIds(o: SkinObject, into: Set<string>): void {
  if (typeof o.id === 'string') into.add(o.id)
  if (isRecord(o.clipPath)) collectIds(o.clipPath, into)
  if (Array.isArray(o.objects)) for (const child of o.objects) if (isRecord(child)) collectIds(child, into)
}

/** collectIds 와 같은 순회 순서로 id 목록(중복 포함 — 고객 요소 안의 중복 id 도 충돌로 본다) */
function collectIdList(o: SkinObject, into: string[]): void {
  if (typeof o.id === 'string') into.push(o.id)
  if (isRecord(o.clipPath)) collectIdList(o.clipPath, into)
  if (Array.isArray(o.objects)) for (const child of o.objects) if (isRecord(child)) collectIdList(child, into)
}

function remapId(id: unknown, idMap: Map<string, string>): unknown {
  if (typeof id !== 'string') return id
  const direct = idMap.get(id)
  if (direct) return direct
  for (const [oldId, newId] of idMap) {
    if (id.startsWith(`${oldId}_`)) return `${newId}${id.slice(oldId.length)}`
  }
  return id
}

/**
 * 고객 요소 — 충돌로 바뀐 id 와 그 id 를 가리키는 참조(frameRef·parentLayerId·fillImage)를 고친다.
 * 그룹 자식·clipPath 까지 같은 규칙으로 내려간다.
 */
function remapCustomer(c: SkinObject, idMap: Map<string, string>): SkinObject {
  if (idMap.size === 0) return c
  const next: SkinObject = { ...c }
  if (c.id !== undefined) next.id = remapId(c.id, idMap)
  for (const key of ['frameRef', 'parentLayerId', 'fillImage'] as const) {
    if (c[key] !== undefined) next[key] = remapId(c[key], idMap)
  }
  if (isRecord(c.clipPath)) next.clipPath = remapCustomer(c.clipPath, idMap)
  if (Array.isArray(c.objects)) next.objects = c.objects.map((child) => (isRecord(child) ? remapCustomer(child, idMap) : child))
  return next
}

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
