/**
 * 양장 싸바리(hardcover_wrap) 편집 모드 — 순수 헬퍼.
 *
 * 모드가 켜지는 조건(모두 참일 때만):
 *  - templateSet.coverType === 'hardcover_wrap'
 *  - caseBind 없음(템플릿셋 coverConfig.caseBind · 표지 템플릿 spec.caseBind 모두)
 *  - 내지 전용 세트가 아님
 *  - 날개(wing) 꺼짐
 *  - 표지 spec 한 면 = 판형 + HARDCOVER_COVER_EXTRA_MM (가로·세로 각 ±0.2mm)
 *  - 표지 캔버스에 외곽선(템플릿 id 'outline' 또는 변환 뒤 id 'page-outline')이 없음.
 *    외곽선이 있으면 ServicePlugin 이 PDF clipPath 를 그 외곽선으로 바꾸고 싸바리 여분까지
 *    넓히지 않으므로, 켜면 사방 여분이 백지로 나간다.
 *
 * 모드가 켜지면
 *  - 화면: 표지 spec.cutSizeMm = HARDCOVER_WRAP_MARGIN_MM(사방 HARDCOVER_WRAP_PER_SIDE_MM)
 *  - 낱장 내지 workspace cutSize: 표지 덮어쓰기 전 값(innerCutSizeMm)
 *  - 표지 PDF: 페이지 = 콘텐츠 + 사방 wrapMm (printSize·재단 마커 옵션 없음)
 *  - metadata.coverOutput: layout·trimWidthMm·trimHeightMm·wrapMm 추가
 * 꺼져 있으면 모든 헬퍼가 기존 산식과 같은 값을 돌려준다.
 */
import {
  type SpreadSpec,
  HARDCOVER_WRAP_MARGIN_MM,
  HARDCOVER_WRAP_PER_SIDE_MM,
  hardcoverWrapFaceFromTrim,
  roundMm01,
} from '@storige/types'
import type { OutputPageSizeMm } from './photobookSpread'
import { computePdfPageOutputMm, type PdfPageOutputMm } from './pdfPageSize'

/** 표지 면 = 판형 + 8 대조 허용 오차(mm) */
export const HARDCOVER_WRAP_FACE_TOLERANCE_MM = 0.2

export interface HardcoverWrapMode {
  /** 템플릿셋 판형(mm) */
  trimWidthMm: number
  trimHeightMm: number
  /** 싸바리 여분 한 변(mm) = HARDCOVER_WRAP_PER_SIDE_MM */
  wrapPerSideMm: number
  /** 표지 화면 cutSizeMm(양변 합) = HARDCOVER_WRAP_MARGIN_MM */
  screenCutSizeMm: number
  /** 낱장 내지 workspace cutSize — 표지 덮어쓰기 전 spec.cutSizeMm */
  innerCutSizeMm: number
}

export type HardcoverWrapOffReason =
  | 'NOT_HARDCOVER_WRAP'
  | 'CASE_BIND'
  | 'INNER_ONLY'
  | 'WING'
  | 'NO_TRIM'
  | 'FACE_MISMATCH'
  | 'PAGE_OUTLINE'

export interface ResolveHardcoverWrapModeInput {
  coverType: string | null | undefined
  hasCaseBind: boolean
  isInnerOnly: boolean
  templateSetSize: { width: number; height: number } | null | undefined
  spec: Pick<SpreadSpec, 'coverWidthMm' | 'coverHeightMm' | 'wingEnabled' | 'cutSizeMm'> | null | undefined
  /** 표지 캔버스에 외곽선(id 'outline' | 'page-outline')이 있는지 — canvasDataHasPageOutline 결과. 생략 = 없음 */
  hasPageOutline?: boolean
}

export interface ResolveHardcoverWrapModeResult {
  mode: HardcoverWrapMode | null
  reason?: HardcoverWrapOffReason
}

function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

const PAGE_OUTLINE_IDS: ReadonlySet<string> = new Set(['outline', 'page-outline'])
/** 중첩 그룹 탐색 깊이 상한 — 손상 데이터 방어 */
const PAGE_OUTLINE_MAX_DEPTH = 32

function nodeHasPageOutline(node: unknown, depth: number): boolean {
  if (depth > PAGE_OUTLINE_MAX_DEPTH || node === null || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((child) => nodeHasPageOutline(child, depth + 1))
  const rec = node as { id?: unknown; objects?: unknown }
  if (typeof rec.id === 'string' && PAGE_OUTLINE_IDS.has(rec.id)) return true
  return Array.isArray(rec.objects) && rec.objects.some((child) => nodeHasPageOutline(child, depth + 1))
}

/**
 * 표지 템플릿 canvasData(JSON 문자열 · 캔버스 객체 · 캔버스 배열)에 외곽선 객체가 있는지.
 * 그룹 안(objects 중첩)까지 본다. 파싱할 수 없는 문자열이나 빈 값은 false.
 */
export function canvasDataHasPageOutline(canvasData: unknown): boolean {
  let data: unknown = canvasData
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown
    } catch {
      return false
    }
  }
  return nodeHasPageOutline(data, 0)
}

/** 싸바리 편집 모드 판정. 꺼지면 mode=null 과 첫 번째로 걸린 사유를 돌려준다. */
export function resolveHardcoverWrapMode(input: ResolveHardcoverWrapModeInput): ResolveHardcoverWrapModeResult {
  if (input.coverType !== 'hardcover_wrap') return { mode: null, reason: 'NOT_HARDCOVER_WRAP' }
  if (input.hasCaseBind) return { mode: null, reason: 'CASE_BIND' }
  if (input.isInnerOnly) return { mode: null, reason: 'INNER_ONLY' }
  const spec = input.spec
  if (!spec) return { mode: null, reason: 'FACE_MISMATCH' }
  if (spec.wingEnabled) return { mode: null, reason: 'WING' }
  const trim = input.templateSetSize
  if (!trim || !isPositiveFinite(trim.width) || !isPositiveFinite(trim.height)) {
    return { mode: null, reason: 'NO_TRIM' }
  }
  const face = hardcoverWrapFaceFromTrim({ widthMm: trim.width, heightMm: trim.height })
  if (
    !isPositiveFinite(spec.coverWidthMm) ||
    !isPositiveFinite(spec.coverHeightMm) ||
    Math.abs(spec.coverWidthMm - face.faceWidthMm) > HARDCOVER_WRAP_FACE_TOLERANCE_MM ||
    Math.abs(spec.coverHeightMm - face.faceHeightMm) > HARDCOVER_WRAP_FACE_TOLERANCE_MM
  ) {
    return { mode: null, reason: 'FACE_MISMATCH' }
  }
  if (input.hasPageOutline === true) return { mode: null, reason: 'PAGE_OUTLINE' }
  return {
    mode: {
      trimWidthMm: trim.width,
      trimHeightMm: trim.height,
      wrapPerSideMm: HARDCOVER_WRAP_PER_SIDE_MM,
      screenCutSizeMm: HARDCOVER_WRAP_MARGIN_MM,
      innerCutSizeMm: spec.cutSizeMm,
    },
  }
}

/** 낱장 내지 workspace cutSize. 모드가 꺼져 있으면 입력값 그대로. */
export function resolveInnerPageCutSizeMm(
  currentCutSizeMm: number,
  wrap: HardcoverWrapMode | null | undefined,
): number {
  return wrap ? wrap.innerCutSizeMm : currentCutSizeMm
}

/** 표지 PDF(saveMultiPagePDFAsBlob) size 옵션 */
export type CoverPdfSizeOpt = {
  width: number
  height: number
  cutSize: number
  printSize?: { width: number; height: number }
  bleedMm?: number
  cropMarkEnabled?: boolean
  wrapMm?: number
}

export interface BuildCoverPdfSizeOptInput {
  contentWidthMm: number
  contentHeightMm: number
  cutSize: number
  hardcoverWrap: HardcoverWrapMode | null | undefined
  /** caseBind 출력(wrap 포함) 크기 — computeCoverOutputSizeMm 결과 */
  caseBindOutput: OutputPageSizeMm | null | undefined
  markOpt: { bleedMm?: number; cropMarkEnabled?: boolean }
}

/**
 * 표지 PDF size 옵션.
 * - 싸바리 모드: { width, height, cutSize, wrapMm } (printSize·재단 마커 옵션 없음)
 * - caseBind 출력: { width, height, cutSize, printSize } (페이지 = 출력 크기, 콘텐츠 중앙 배치)
 * - 그 밖: { width, height, cutSize, ...markOpt }
 */
export function buildCoverPdfSizeOpt(i: BuildCoverPdfSizeOptInput): CoverPdfSizeOpt {
  const base = { width: i.contentWidthMm, height: i.contentHeightMm, cutSize: i.cutSize }
  if (i.hardcoverWrap) {
    return { ...base, wrapMm: i.hardcoverWrap.wrapPerSideMm }
  }
  const caseBindOutput = i.caseBindOutput
  return {
    ...base,
    ...(caseBindOutput
      ? { printSize: { width: caseBindOutput.widthMm, height: caseBindOutput.heightMm } }
      : i.markOpt),
  }
}

/** metadata.coverOutput. 싸바리 모드면 layout·판형·wrapMm 를 함께 싣는다. */
export type CoverOutputMeta = PdfPageOutputMm & {
  layout?: 'hardcover-wrap'
  trimWidthMm?: number
  trimHeightMm?: number
  wrapMm?: number
}

/**
 * 표지 PDF 에 넘긴 같은 size 객체로 coverOutput 을 만든다.
 * 싸바리 키는 모드가 켜져 있고 size 객체에도 wrapMm 가 실려 있을 때만 붙는다.
 */
export function buildCoverOutputMeta(
  sizeOpt: CoverPdfSizeOpt,
  wrap: HardcoverWrapMode | null | undefined,
): CoverOutputMeta {
  const base = computePdfPageOutputMm(sizeOpt)
  if (!wrap || !isPositiveFinite(sizeOpt.wrapMm)) return base
  return {
    ...base,
    layout: 'hardcover-wrap',
    trimWidthMm: roundMm01(wrap.trimWidthMm),
    trimHeightMm: roundMm01(wrap.trimHeightMm),
    wrapMm: roundMm01(sizeOpt.wrapMm),
  }
}
