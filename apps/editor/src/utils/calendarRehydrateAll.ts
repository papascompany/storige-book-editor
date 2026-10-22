import type { CalendarAnniversary, CalendarDisplayOptions, CalendarSessionMeta, ProductProfile } from '@storige/types'
import { getCalendarData } from '@storige/canvas-core'
import { findDuplicateAnniversary } from '@/components/calendar/calendarPanelUtils'
import { useAppStore } from '@/stores/useAppStore'
import { useSaveStore } from '@/stores/useSaveStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore } from '@/stores/useCalendarStore'
import { isCalendarProfile } from '@/utils/productProfile'
import { rehydrateCalendarGrids } from '@/utils/calendarRehydrate'

/**
 * calendarRehydrateAll.ts — 캘린더 세션 메타의 편집기 측 배선 (P1-d 캘린더, 2026-10-17)
 *
 * 1. `rehydrateAllCalendarGrids()` — 시작연월·표기 옵션·기념일이 바뀐 뒤 모든 캔버스의 calendar-grid 를
 *    순서대로 다시 그리고(사진·텍스트 보존) 자동저장이 변경을 감지하도록 dirty 마킹.
 * 2. `readCalendarSessionMeta()` — `edit_sessions.metadata.calendar` 판독(재오픈 복원용).
 * 3. `calendarSessionMetadataFields()` — 세션 PATCH 에 동봉할 `{ metadata: { productProfile, calendar } }`.
 *
 * 모든 함수는 profile 이 null/legacy 면 no-op(`{}`·0·null)이라 기존 세트의 payload 키 집합이 바뀌지 않는다.
 *
 * T2 그리드·기념일 안전성(2026-10-22): 복원은 **비파괴** — 저장분·런처 입력에 같은 날짜 기념일이 섞여 있어도
 * 삭제하지 않고 그대로 복원하고 `console.warn` 1회만 남긴다. 거부는 `useCalendarStore.addAnniversary/updateAnniversary`(편집 시점)에서만.
 */

/**
 * 모든 캔버스의 calendar-grid 재합성 합계. 1개 이상 다시 그렸으면 dirty 마킹(useEmbedAutoSave 의
 * 주기 저장·언마운트 백업이 `useSaveStore.isDirty` 를 본다 — 기존 메커니즘 1회 트리거).
 */
export async function rehydrateAllCalendarGrids(): Promise<number> {
  const profile = useSettingsStore.getState().productProfile
  if (!isCalendarProfile(profile)) return 0
  const { allCanvas, allEditors } = useAppStore.getState()
  let total = 0
  for (let i = 0; i < allCanvas.length; i += 1) {
    total += await rehydrateCalendarGrids(allEditors[i], allCanvas[i], i)
  }
  if (total > 0) useSaveStore.getState().markDirty()
  return total
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 기념일 문구 최대 길이(CalendarPanel 입력 maxLength 와 동일) · 세션당 기념일 최대 개수 */
export const ANNIVERSARY_TEXT_MAX = 40
export const ANNIVERSARY_MAX_COUNT = 400

function readAnniversaryStyle(v: unknown): CalendarAnniversary['style'] | undefined {
  if (!isRecord(v)) return undefined
  const style: NonNullable<CalendarAnniversary['style']> = {}
  if (typeof v.fontFamily === 'string' && v.fontFamily.length <= 100) style.fontFamily = v.fontFamily
  if (typeof v.fontSize === 'number' && Number.isFinite(v.fontSize) && v.fontSize > 0 && v.fontSize <= 500) style.fontSize = v.fontSize
  if (typeof v.fill === 'string' && v.fill.length <= 50) style.fill = v.fill
  if (v.fontWeight === 'normal' || v.fontWeight === 'bold') style.fontWeight = v.fontWeight
  if (v.fontStyle === 'normal' || v.fontStyle === 'italic') style.fontStyle = v.fontStyle
  if (v.textAlign === 'left' || v.textAlign === 'center' || v.textAlign === 'right') style.textAlign = v.textAlign
  return Object.keys(style).length > 0 ? style : undefined
}

// 세션 metadata 는 클라이언트가 쓰는 자유형 JSON — 길이·개수·허용 키를 여기서 잘라 렌더·검증 비용을 묶는다
function readAnniversary(v: unknown): CalendarAnniversary | null {
  if (!isRecord(v)) return null
  if (typeof v.id !== 'string' || v.id === '' || v.id.length > 64) return null
  if (typeof v.date !== 'string' || !DATE_KEY_RE.test(v.date)) return null
  if (typeof v.text !== 'string') return null
  const item: CalendarAnniversary = { id: v.id, date: v.date, lunar: v.lunar === true, text: v.text.slice(0, ANNIVERSARY_TEXT_MAX) }
  if (typeof v.isLeapMonth === 'boolean') item.isLeapMonth = v.isLeapMonth
  const style = readAnniversaryStyle(v.style)
  if (style) item.style = style
  return item
}

/**
 * 세션 metadata → 캘린더 세션 메타. `startYear/startMonth` 가 정수(월 1~12)이고 `anniversaries` 가
 * 배열일 때만 유효. `show`·`dataVersion` 이 빠졌거나 형식이 틀리면 `fallback`(프로파일 기본 메타)에서 채운다.
 * 유효하지 않으면 null(P1-b 의 setFromProfile 결과 유지).
 */
export function readCalendarSessionMeta(
  metadata: unknown,
  fallback: CalendarSessionMeta | null,
): CalendarSessionMeta | null {
  if (!isRecord(metadata)) return null
  const cal = metadata.calendar
  if (!isRecord(cal)) return null
  const { startYear, startMonth, anniversaries } = cal
  if (!Number.isInteger(startYear) || !Number.isInteger(startMonth)) return null
  if ((startMonth as number) < 1 || (startMonth as number) > 12) return null
  if (!Array.isArray(anniversaries)) return null

  const show = isRecord(cal.show) ? cal.show : {}
  const fallbackShow: CalendarDisplayOptions = fallback?.show ?? { holidays: true, lunar: false, solarTerms: false }
  const restoredShow: CalendarDisplayOptions = {
    holidays: typeof show.holidays === 'boolean' ? show.holidays : fallbackShow.holidays,
    lunar: typeof show.lunar === 'boolean' ? show.lunar : fallbackShow.lunar,
    solarTerms: typeof show.solarTerms === 'boolean' ? show.solarTerms : fallbackShow.solarTerms,
  }
  // 임시공휴일·선거일 표시(2026-10-17): 저장분 boolean 이면 그 값, 없으면 fallback 값, 둘 다 없으면 키 생략(= false)
  if (typeof show.temporaryHolidays === 'boolean') restoredShow.temporaryHolidays = show.temporaryHolidays
  else if (typeof fallbackShow.temporaryHolidays === 'boolean') restoredShow.temporaryHolidays = fallbackShow.temporaryHolidays
  return {
    startYear: startYear as number,
    startMonth: startMonth as number,
    show: restoredShow,
    anniversaries: anniversaries.slice(0, ANNIVERSARY_MAX_COUNT).map(readAnniversary).filter((a): a is CalendarAnniversary => a !== null),
    dataVersion:
      typeof cal.dataVersion === 'string' && cal.dataVersion !== ''
        ? cal.dataVersion
        : (fallback?.dataVersion ?? ''),
  }
}

/**
 * 같은 날짜(양력 환산 기준 — CalendarPanel·store 의 `findDuplicateAnniversary` 와 같은 판정)로 앞선 항목과 겹치는
 * 기념일 수. 데이터 버전을 모르면 음력은 환산 불가라 원문(date·lunar·윤달) 동일만 센다. 복원 경로는 비파괴라 경고에만 쓴다.
 */
export function countDuplicateAnniversaries(list: CalendarAnniversary[], dataVersion: string): number {
  const data = getCalendarData(dataVersion)
  let count = 0
  for (let i = 1; i < list.length; i += 1) {
    if (findDuplicateAnniversary(list.slice(0, i), list[i], data)) count += 1
  }
  return count
}

/**
 * 재오픈 시 세션 metadata.calendar 를 스토어에 복원(캔버스 복원 **전**에 호출해야 rehydrate 가 저장값을 쓴다).
 * profile 이 캘린더가 아니거나 메타가 무효면 아무것도 하지 않는다.
 * 같은 날짜 기념일은 삭제하지 않고 유지한다(비파괴) — console.warn 1회만.
 * @returns 복원했으면 true
 */
export function restoreCalendarSessionMeta(metadata: unknown): boolean {
  const profile = useSettingsStore.getState().productProfile
  if (!isCalendarProfile(profile)) return false
  const store = useCalendarStore.getState()
  const meta = readCalendarSessionMeta(metadata, store.meta)
  if (!meta) return false
  const duplicates = countDuplicateAnniversaries(meta.anniversaries, meta.dataVersion)
  if (duplicates > 0) {
    console.warn(`[calendar] 복원한 기념일 중 같은 날짜 ${duplicates}건 — 삭제하지 않고 유지(편집 시 추가·수정만 거부)`)
  }
  store.restore(meta)
  return true
}

export interface CalendarSessionMetadataFields {
  metadata?: { productProfile: ProductProfile; calendar: CalendarSessionMeta }
}

/**
 * 세션 PATCH(자동저장·save·complete)에 동봉할 metadata — API 가 얕은 병합하므로 다른 키는 유지된다.
 * 캘린더 세트가 아니면 `{}`(payload 키 집합 불변).
 */
export function calendarSessionMetadataFields(): CalendarSessionMetadataFields {
  const profile = useSettingsStore.getState().productProfile
  if (!isCalendarProfile(profile)) return {}
  const meta = useCalendarStore.getState().meta
  if (!meta) return {}
  return { metadata: { productProfile: profile, calendar: meta } }
}
