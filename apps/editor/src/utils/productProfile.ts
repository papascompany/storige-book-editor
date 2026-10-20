import {
  formatCalendarPageLabel,
  formatPhotoPageLabel,
  parseMonthKey,
  resolveCalendarCanvasCount,
  resolveCalendarCanvasSlot,
  resolveProductProfile,
  type CalendarProfile,
  type CalendarSessionMeta,
  type PhotoPrintProfile,
  type ProductProfile,
  type ProductProfileSource,
  type YearMonth,
} from '@storige/types'
import type { PdfExportOptions } from '@storige/canvas-core'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { usePhotoPrintStore } from '@/stores/usePhotoPrintStore'

/**
 * productProfile.ts — 템플릿셋 `productProfile` 을 편집기 스토어에 배선하는 헬퍼 (P1 캘린더, 2026-10-17)
 *
 * 모든 함수는 profile 이 null/legacy 이면 no-op 또는 null 을 돌려줘 기존 경로를 바꾸지 않는다.
 */

export type CalendarProductProfile = ProductProfile & { kind: 'calendar'; calendar: CalendarProfile }

export function isCalendarProfile(profile: ProductProfile | null | undefined): profile is CalendarProductProfile {
  return !!profile && profile.kind === 'calendar' && !!profile.calendar
}

/** P2-d 사진인화 (2026-10-19): kind 'photo-print' + photoPrint 블록이 있는 프로파일 */
export type PhotoPrintProductProfile = ProductProfile & { kind: 'photo-print'; photoPrint: PhotoPrintProfile }

export function isPhotoPrintProfile(profile: ProductProfile | null | undefined): profile is PhotoPrintProductProfile {
  return !!profile && profile.kind === 'photo-print' && !!profile.photoPrint
}

/**
 * pages.kind==='range' 면 캔버스 수 범위 {min,max}(settings.page.min/max 와 같은 '전체 캔버스 수' 단위), 아니면 null.
 * min/max 가 1 이상 정수가 아니면 null(검증이 보장하지만 방어적 경로).
 */
export function resolveRangeCanvasBounds(profile: ProductProfile | null | undefined): { min: number; max: number } | null {
  if (!profile || profile.pages.kind !== 'range') return null
  const { min, max } = profile.pages
  if (typeof min !== 'number' || typeof max !== 'number') return null
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) return null
  return { min, max }
}

/** pages.kind==='fixed' 면 고정 캔버스 수, 아니면 null */
export function resolveFixedCanvasCount(profile: ProductProfile | null | undefined): number | null {
  if (!profile || profile.pages.kind !== 'fixed') return null
  const count = profile.pages.count
  if (typeof count === 'number' && Number.isInteger(count) && count >= 1) return count
  // fixed 인데 count 가 없으면 캘린더 구성으로 계산(검증이 count 를 요구하므로 방어적 경로)
  return isCalendarProfile(profile) ? resolveCalendarCanvasCount(profile.calendar) : null
}

/**
 * 템플릿셋 → settings.productProfile + calendar store. resolve 결과가 null(legacy)이면 둘 다 reset.
 * @returns 판정된 프로파일(null = legacy)
 */
export function applyTemplateSetProductProfile(
  templateSet: ProductProfileSource | null | undefined,
): ProductProfile | null {
  const profile = resolveProductProfile(templateSet, (m) => console.warn(`[EditorContents] ${m}`))
  useSettingsStore.getState().setProductProfile(profile)
  useCalendarStore.getState().setFromProfile(profile)
  // P2-d 사진인화: photo-print 가 아니면 reset(null) — 캘린더 스토어와 같은 규약
  usePhotoPrintStore.getState().setFromProfile(profile)
  return profile
}

/** 캔버스 인덱스 → 시작연월 기준 상대 월(0~11). 표지·에필로그·범위 밖·비캘린더면 null */
export function resolveCanvasMonthOffset(profile: ProductProfile | null | undefined, canvasIndex: number): number | null {
  if (!isCalendarProfile(profile)) return null
  const slot = resolveCalendarCanvasSlot(profile.calendar, canvasIndex)
  if (!slot || slot.role !== 'month' || typeof slot.monthOffset !== 'number') return null
  return slot.monthOffset
}

/** 캘린더 시작연월 — 세션 메타가 있으면 그 값, 없으면 allowedRange.from */
export function resolveCalendarStart(
  profile: CalendarProductProfile,
  meta: Pick<CalendarSessionMeta, 'startYear' | 'startMonth'> | null | undefined,
): YearMonth {
  if (meta && Number.isInteger(meta.startYear) && Number.isInteger(meta.startMonth)) {
    return { year: meta.startYear, month: meta.startMonth }
  }
  return parseMonthKey(profile.calendar.allowedRange.from) ?? { year: new Date().getFullYear(), month: 1 }
}

/**
 * 페이지 라벨 resolver — BookNavigation.buildPageMeta `labelResolver` 용.
 * 비캘린더 프로파일이면 모든 인덱스에 undefined(기존 라벨 유지).
 */
export function makeCalendarLabelResolver(
  profile: ProductProfile | null | undefined,
  calendarMeta: Pick<CalendarSessionMeta, 'startYear' | 'startMonth'> | null | undefined,
): (index: number) => string | undefined {
  if (!isCalendarProfile(profile)) return () => undefined
  const start = resolveCalendarStart(profile, calendarMeta)
  const cal = profile.calendar
  return (index) => formatCalendarPageLabel(cal, start, index) ?? undefined
}

/**
 * P2-d 사진인화 페이지 라벨 resolver — digital '사진 3 앞'/'사진 3 뒤', chemical '사진 3'(types formatPhotoPageLabel 재사용).
 * 사진인화 프로파일이 아니면 모든 인덱스에 undefined(기존 라벨 유지).
 */
export function makePhotoLabelResolver(
  profile: ProductProfile | null | undefined,
): (index: number) => string | undefined {
  if (!isPhotoPrintProfile(profile)) return () => undefined
  const mapping = { sheet: profile.sheet, photoPrint: profile.photoPrint }
  return (index) => formatPhotoPageLabel(mapping, index) ?? undefined
}

/**
 * 단일모드 완료 PDF 의 요청 치수(mm). 호스트가 size 를 보냈으면 그대로(종전 계약 — 원본 보존),
 * 보내지 않았고 상품 프로파일 세트면 템플릿셋 판형을 요청값으로 쓴다(A4 폴백 대신 상품 판형).
 * 프로파일 NULL 세트는 undefined → resolveSingleModePdfSizeMm 의 종전 A4 폴백 그대로.
 */
export function resolveProfilePdfRequestSize(
  requested: { width: number; height: number } | null | undefined,
  profile: ProductProfile | null | undefined,
  templateSetSize: { width: number; height: number } | null | undefined,
): { width: number; height: number } | undefined {
  if (requested) return requested
  if (profile && templateSetSize) return templateSetSize
  return undefined
}

/**
 * 단일모드 완료 PDF 의 프로파일 세트 전용 export 옵션(P1 캘린더, 2026-10-17).
 * 프로파일이 있으면 워커 preflight 경고(FONT_NOT_EMBEDDED / TRANSPARENCY_DETECTED)의 편집기 측 원인을 끄는
 * 세 옵션을 모두 켠다. 프로파일 NULL 세트는 undefined → ServicePlugin 종전 경로·바이트 그대로.
 */
export function resolveProfilePdfExportOptions(
  profile: ProductProfile | null | undefined,
): PdfExportOptions | undefined {
  if (!profile) return undefined
  return { omitUnusedFonts: true, excludeWorkspaceFromExport: true, neutralizeTransparentFills: true }
}

// ─── P2-d 사진인화 시드·단위 보정 (2026-10-19 결함 수정 D1/D2/api-sheetmap-3) ─────────────────────────

/** 항목 1건이 차지하는 캔버스 수 — chemical 1 / digital 2 (photoPrintRehydrate.photoPrintStride 와 같은 산식) */
export function photoPrintCanvasStride(profile: PhotoPrintProductProfile): 1 | 2 {
  return profile.photoPrint.process === 'digital' ? 2 : 1
}

export interface PhotoPrintSeedInput {
  /** 호스트/세션이 요청한 pageCount(단일 모드 = 전체 캔버스 수) */
  requested?: number
  /** 재오픈: 저장 canvasData 의 전체 캔버스 수(표지 없는 range 세트는 canvasData.length 그대로) */
  restoredCanvasCount?: number
  /** 신규(런처 선생성) 세션: metadata.items 건수 — 캔버스 수 = 건수 × stride */
  itemCount?: number
  /** 템플릿셋 refs 수(초기 캔버스 수 하한) */
  templateCanvasCount: number
}

export interface PhotoPrintSeedResult {
  /** 시드할 전체 캔버스 수 */
  count: number
  /** pages.max 로 잘라낸 캔버스 수(0 = 잘림 없음) */
  truncated: number
}

/**
 * 사진인화(range) 세트의 시드 캔버스 수.
 * - 재오픈(restoredCanvasCount ≥ 1)은 저장본 수를 하한으로 — 호스트 pageCount/한도와 무관하게 마지막 캔버스를 잃지 않는다(D1).
 * - 신규 세션에 런처 items N건이 있으면 N × stride 를 하한으로(D2) — 초기 캔버스보다 많은 항목이 잘리지 않는다.
 * - 셋 다 없으면 null(종전 흐름 — 템플릿셋 refs 그대로). 결과는 refs 수 이상, pages.max 이하(초과분은 truncated).
 */
export function resolvePhotoPrintSeedCount(
  profile: PhotoPrintProductProfile,
  input: PhotoPrintSeedInput,
): PhotoPrintSeedResult | null {
  const positive = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined
  const requested = positive(input.requested)
  const restored = positive(input.restoredCanvasCount)
  const itemCount = positive(input.itemCount)
  let count = requested
  if (restored !== undefined) {
    count = Math.max(count ?? 0, restored)
  } else if (itemCount !== undefined) {
    count = Math.max(count ?? 0, itemCount * photoPrintCanvasStride(profile))
  }
  if (count === undefined) return null
  count = Math.max(count, Math.max(0, Math.floor(input.templateCanvasCount)))
  const bounds = resolveRangeCanvasBounds(profile)
  let truncated = 0
  if (bounds && count > bounds.max) {
    truncated = count - bounds.max
    count = bounds.max
  }
  return { count, truncated }
}

/**
 * 사진인화 세트의 증감 단위 — 프로파일 pages.step 이 템플릿셋 pageStep·호스트 pageStep 보다 우선한다(api-sheetmap-3).
 * 호스트가 다른 pageStep 을 보냈으면 console.warn 1회 뒤 무시한다. 사진인화가 아니면 템플릿셋 값 그대로(종전 동작).
 */
export function resolvePhotoPrintPageStep(
  profile: ProductProfile | null | undefined,
  templateSetPageStep: unknown,
  hostPageStep: number | undefined,
): { pageStep: unknown; ignoreHostPageStep: boolean } {
  if (!isPhotoPrintProfile(profile)) return { pageStep: templateSetPageStep, ignoreHostPageStep: false }
  const pageStep: unknown = profile.pages.step ?? templateSetPageStep
  const ignoreHostPageStep = hostPageStep !== undefined
  if (ignoreHostPageStep && hostPageStep !== pageStep) {
    console.warn(
      `[EditorContents] 사진인화 세트 — 호스트 pageStep ${hostPageStep} 무시(프로파일 pages.step ${String(pageStep ?? '미설정')} 적용)`,
    )
  }
  return { pageStep, ignoreHostPageStep }
}
