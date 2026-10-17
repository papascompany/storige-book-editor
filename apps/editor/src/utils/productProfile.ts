import {
  formatCalendarPageLabel,
  parseMonthKey,
  resolveCalendarCanvasCount,
  resolveCalendarCanvasSlot,
  resolveProductProfile,
  type CalendarProfile,
  type CalendarSessionMeta,
  type ProductProfile,
  type ProductProfileSource,
  type YearMonth,
} from '@storige/types'
import type { PdfExportOptions } from '@storige/canvas-core'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'

/**
 * productProfile.ts — 템플릿셋 `productProfile` 을 편집기 스토어에 배선하는 헬퍼 (P1 캘린더, 2026-10-17)
 *
 * 모든 함수는 profile 이 null/legacy 이면 no-op 또는 null 을 돌려줘 기존 경로를 바꾸지 않는다.
 */

export type CalendarProductProfile = ProductProfile & { kind: 'calendar'; calendar: CalendarProfile }

export function isCalendarProfile(profile: ProductProfile | null | undefined): profile is CalendarProductProfile {
  return !!profile && profile.kind === 'calendar' && !!profile.calendar
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
