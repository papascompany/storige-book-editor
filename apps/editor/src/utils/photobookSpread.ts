/**
 * 포토북 내지 2-up 펼침면 순수 헬퍼.
 *
 * - 좌표 규약: 콘텐츠 중앙원점 @150dpi (편집기/PDF/반응형 공통).
 * - 좌면 = verso(왼쪽), 우면 = recto(오른쪽). 한 펼침면(spread) = 두 논리 페이지.
 * - 이 모듈은 100% 순수함수다: fabric/스토어/네트워크 의존 0, 부수효과 0.
 *   스펙·설정(SpreadConfig) 빌더와 펼침면 페어 번호 유도만 담당한다.
 *
 * 통합(편집기 스토어/렌더)은 이 헬퍼의 반환값을 입력으로 받아 레이아웃을 계산한다.
 */

import {
  type SpreadInnerSpec,
  type SpreadConfig,
  type SpreadPairMeta,
  type SpreadSpec,
  type CaseBindSpec,
  type TemplateSetCoverMeta,
  SPREAD_CONFIG_VERSION,
  computeSpreadOutputDimensions,
  isValidCaseBind,
} from '@storige/types'

/** buildInnerSpreadSpec 입력. page 치수는 필수, 나머지는 기본값 보충. */
export interface BuildInnerSpreadSpecInput {
  pageWidthMm: number
  pageHeightMm: number
  gutterMm?: number
  cutSizeMm?: number
  safeSizeMm?: number
  dpi?: number
}

/** 유한·양수 판정(NaN/Infinity/0/음수 배제). */
function isPositiveFinite(n: number): boolean {
  return Number.isFinite(n) && n > 0
}

/**
 * 펼침면 내지(2-up) 스펙을 만든다. page 치수는 양수 필수, 나머지는 기본값(gutter0/cut3/safe5/dpi150) 보충.
 * @throws page 치수가 비유한·≤0 이거나 dpi≤0 이면 Error.
 */
export function buildInnerSpreadSpec(input: BuildInnerSpreadSpecInput): SpreadInnerSpec {
  const { pageWidthMm, pageHeightMm } = input
  if (!isPositiveFinite(pageWidthMm) || !isPositiveFinite(pageHeightMm)) {
    throw new Error('buildInnerSpreadSpec: pageWidthMm/pageHeightMm 는 양수여야 합니다')
  }
  const dpi = input.dpi ?? 150
  if (!(Number.isFinite(dpi) && dpi > 0)) {
    throw new Error('buildInnerSpreadSpec: dpi 는 양수여야 합니다')
  }
  return {
    pageWidthMm,
    pageHeightMm,
    gutterMm: input.gutterMm ?? 0,
    cutSizeMm: input.cutSizeMm ?? 3,
    safeSizeMm: input.safeSizeMm ?? 5,
    dpi,
  }
}

/**
 * 내지 스펙으로부터 저장용 SpreadConfig 를 만든다(regionScope='inner', spec 생략).
 * totalWidthMm = pageWidthMm*2(펼침면 trim 폭), totalHeightMm = pageHeightMm.
 */
export function buildInnerSpreadConfig(spec: SpreadInnerSpec): SpreadConfig {
  return {
    version: SPREAD_CONFIG_VERSION,
    regionScope: 'inner',
    innerSpec: spec,
    regions: [],
    totalWidthMm: spec.pageWidthMm * 2,
    totalHeightMm: spec.pageHeightMm,
  }
}

/**
 * 페이지 수로부터 필요한 펼침면 수를 구한다(2페이지=1펼침면, 홀수면 올림).
 * 음수·비유한 입력은 0 으로 간주한다.
 */
export function spreadCountFromPageCount(pageCount: number): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0
  return Math.max(0, Math.ceil(pageCount / 2))
}

/**
 * 펼침면 수로부터 총 페이지 수를 구한다(펼침면당 2페이지).
 * 음수·비유한 입력은 0 으로 간주한다.
 */
export function pageCountFromSpreads(spreadCount: number): number {
  if (!Number.isFinite(spreadCount) || spreadCount <= 0) return 0
  return Math.max(0, Math.floor(spreadCount)) * 2
}

/**
 * 펼침면 수만큼 좌/우 페이지 번호 페어 메타를 유도한다(좌면 우선, startPageNo 기본 1).
 * spreadCount 가 ≤0·비유한이면 빈 배열을 반환한다.
 */
export function deriveSpreadPairs(
  spreadCount: number,
  opts?: { startPageNo?: number },
): SpreadPairMeta[] {
  if (!Number.isFinite(spreadCount) || spreadCount <= 0) return []
  const startPageNo = opts?.startPageNo ?? 1
  const count = Math.floor(spreadCount)
  const pairs: SpreadPairMeta[] = []
  for (let i = 0; i < count; i++) {
    const leftPageNo = startPageNo + 2 * i
    pairs.push({
      pairId: `spread-${i + 1}`,
      leftPageNo,
      rightPageNo: leftPageNo + 1,
    })
  }
  return pairs
}

/**
 * 펼침면 페어를 내비 표시용 라벨로 포맷한다(예: 'p.1–2', en-dash 사용).
 */
export function formatPairLabel(pair: SpreadPairMeta): string {
  return `p.${pair.leftPageNo}–${pair.rightPageNo}`
}

/**
 * 내지 스펙으로부터 placeholder 표지 SpreadSpec 을 합성한다.
 *
 * SpreadPlugin 은 inner 모드에서도 생성자 계약상 spec(표지 SpreadSpec)을 요구한다(currentSpec 비-null 불변).
 * 단 inner 렌더는 전적으로 innerSpec 으로 수행되므로 이 placeholder 는 **실제 렌더에 사용되지 않는다**
 * (cover 전용 메서드는 inner 모드에서 호출되지 않음). 펼침면 trim(pageWidth*2 × pageHeight)을 표지 폭으로,
 * 책등 0·날개 없음으로 둔 무해한 유효값이다.
 */
export function innerSpecToPlaceholderSpec(spec: SpreadInnerSpec): SpreadSpec {
  return {
    coverWidthMm: spec.pageWidthMm * 2,
    coverHeightMm: spec.pageHeightMm,
    spineWidthMm: 0,
    wingEnabled: false,
    wingWidthMm: 0,
    dpi: spec.dpi,
    cutSizeMm: spec.cutSizeMm,
    safeSizeMm: spec.safeSizeMm,
  }
}

// ============================================================================
// 출력 계약 헬퍼 (Track 1, 2026-07-06) — D-1 1단계 · D-4 이중경계 · D-3 pageCount
// embed.tsx(handleFinish/instance.complete)와 useWorkSave.completeSpreadWork 두 완료 경로가
// **반드시 이 헬퍼를 단일 진실원으로** 사용한다(경로별 출력 크기 불일치 회귀 방지).
// ============================================================================

/** useSettingsStore.spreadConfig 의 구조적 부분형 — 출력 크기 산출에 필요한 필드만. */
export interface SpreadOutputConfigLike {
  regionScope?: 'cover' | 'inner'
  innerSpec?: SpreadInnerSpec | null
  spec?: SpreadSpec | null
  totalWidthMm?: number
  totalHeightMm?: number
}

/** 출력 페이지 크기(mm, trim 기준 — bleed 게이트는 ServicePlugin 이 별도 처리) */
export interface OutputPageSizeMm {
  widthMm: number
  heightMm: number
}

/**
 * D-1 1단계: 포토북 내지(regionScope='inner') content.pdf 의 **페이지 크기**를 계산한다.
 * 'content.pdf 1페이지 = 1펼침면' 계약 — 2-up trim = pageWidthMm×2 × pageHeightMm.
 *
 * inner 가 아니거나 innerSpec 이 비유효하면 null 반환 → 호출측은 기존 폴백
 * (spec.coverWidthMm/주문 옵션)으로 진행한다(BOOK/LEAFLET byte-parity).
 */
export function computeInnerContentSizeMm(
  cfg: SpreadOutputConfigLike | null | undefined,
): OutputPageSizeMm | null {
  if (cfg?.regionScope !== 'inner') return null
  const inner = cfg.innerSpec
  if (!inner) return null
  if (!isPositiveFinite(inner.pageWidthMm) || !isPositiveFinite(inner.pageHeightMm)) return null
  return {
    widthMm: inner.pageWidthMm * 2,
    heightMm: inner.pageHeightMm,
  }
}

/**
 * D-4: 하드커버(caseBind) 표지 cover.pdf 의 **출력(wrap 포함) 페이지 크기**를 계산한다.
 * 화면은 trim 뷰 그대로(computeSpreadDimensions 불변) — PDF 페이지 크기에만 적용.
 *
 * caseBind 미설정/비유효/내지(inner) config → null 반환 → 호출측은 기존
 * totalWidthMm×totalHeightMm 출력 그대로(byte-parity).
 */
export function computeCoverOutputSizeMm(
  cfg: SpreadOutputConfigLike | null | undefined,
): OutputPageSizeMm | null {
  if (!cfg?.spec) return null
  if (cfg.regionScope === 'inner') return null // 내지 세션 — 표지는 별도 세션
  if (!isValidCaseBind(cfg.spec.caseBind)) return null
  try {
    const dims = computeSpreadOutputDimensions(cfg.spec)
    if (!isPositiveFinite(dims.totalWidthMm) || !isPositiveFinite(dims.totalHeightMm)) return null
    return { widthMm: dims.totalWidthMm, heightMm: dims.totalHeightMm }
  } catch {
    // 비정상 spec(NaN 등) — roundMm01 throw → 출력 크기 미확장(기존 동작 계속)
    return null
  }
}

/**
 * templateSet 응답의 optional 커버 메타(coverType varchar + coverConfig JSON — Track 3 데이터 소스)를
 * 옵셔널 체이닝으로 읽는다. 값 없으면 null(전 경로 기존 동작).
 */
export function resolveTemplateSetCoverMeta(templateSet: unknown): TemplateSetCoverMeta | null {
  const ts = templateSet as
    | { coverType?: unknown; coverConfig?: { caseBind?: Partial<CaseBindSpec> } | null }
    | null
    | undefined
  const coverType = typeof ts?.coverType === 'string' && ts.coverType.length > 0 ? ts.coverType : null
  const caseBind = isValidCaseBind(ts?.coverConfig?.caseBind) ? ts!.coverConfig!.caseBind! : null
  if (!coverType && !caseBind) return null
  return {
    // caseBind 만 있고 coverType 미지정인 비정상 데이터도 geometry 는 살린다(코드는 시드값 폴백).
    coverType: coverType ?? 'hardcover_wrap',
    ...(caseBind ? { coverConfig: { caseBind } } : {}),
  }
}

/**
 * D-3: 완료/가격 이벤트용 라이브 물리 페이지 수 단일 진실원.
 * 포토북 내지(inner) 펼침면은 캔버스 1개 = 2 물리페이지(×2),
 * 그 외는 캔버스 수 − coverCanvasCount(표지 캔버스 제외분).
 * 캔버스가 0개면 fallbackPages(주문 시점 pages, 최소 1)로 폴백 — 기존 두 경로 동작과 동일.
 *
 * T5 (2026-07-13): coverCanvasCount 파라미터 추가 — 표지+내지 단일 세션 spread 세트
 * (비-inner)에서 표지 캔버스 1장이 물리 페이지 수에 섞여 21로 집계되던 것을 20으로 정정.
 * 기본값 0 = 기존 호출 byte-parity(BOOK/LEAFLET/포토북 inner ×2 산식 불변).
 * 호출측 게이트: 표지 단독 세션(캔버스 1)은 0 을 전달해야 한다(physical=0 방지).
 */
export function computeLivePageCount(
  canvasCount: number,
  isInnerSpread: boolean,
  fallbackPages: number,
  coverCanvasCount: number = 0,
): number {
  const count = Number.isFinite(canvasCount) && canvasCount > 0 ? Math.floor(canvasCount) : 0
  const physical = isInnerSpread ? count * 2 : Math.max(0, count - coverCanvasCount)
  if (physical > 0) return physical
  return Number.isFinite(fallbackPages) && fallbackPages > 0 ? Math.floor(fallbackPages) : 1
}
