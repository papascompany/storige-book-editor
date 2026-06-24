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

import type { SpreadInnerSpec, SpreadConfig, SpreadPairMeta, SpreadSpec } from '@storige/types'

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
    version: 1,
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
