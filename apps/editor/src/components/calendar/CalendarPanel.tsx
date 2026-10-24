import { useCallback, useMemo, useState, useEffect } from 'react'
import { getCalendarData, type CalendarData } from '@storige/canvas-core'
import {
  DEFAULT_CALENDAR_DATA_VERSION,
  type CalendarAnniversary,
  type CalendarAnniversaryStyle,
  type CalendarDisplayOptions,
  type CalendarYearDeltas,
  type CalendarYearPolicy,
  type YearMonth,
} from '@storige/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/useAppStore'
import { useSettingsStore } from '@/stores/useSettingsStore'
import { useCalendarStore, type CalendarYearRole } from '@/stores/useCalendarStore'
import { rehydrateAllCalendarGrids } from '@/utils/calendarRehydrateAll'
import CalendarGridTools from './CalendarGridTools'
import {
  formatCalendarEndMonthLabel,
  daysInSolarMonth,
  findDuplicateAnniversary,
  formatAnniversaryDateLabel,
  formatDateKey,
  formatYearCalendarLabel,
  isSolarDateInCalendarRange,
  listAllowedYearMonths,
  listAnniversaryYears,
  mergeAnniversaryStyle,
  parseDateKey,
  resolveAnniversarySolar,
  scanYearGrids,
  type YearGridScan,
} from './calendarPanelUtils'

/**
 * CalendarPanel — 좌측 메뉴 `CALENDAR`(달력) 패널 (P1-d 캘린더, 2026-10-17)
 *
 * 세 섹션: 시작연월(allowedRange 안만 허용) · 표기 옵션(공휴일/음력/24절기) · 기념일 관리(목록 + 추가/수정/삭제).
 * 변경은 useCalendarStore 에 쓰고 `rehydrateAllCalendarGrids()` 로 모든 캔버스의 그리드를 다시 그린다
 * (사진·텍스트 보존, dirty 마킹 → 자동저장). 활성 캔버스의 날짜칸 더블클릭은 그 날짜로 기념일 폼을 연다.
 * editMode(관리자 템플릿 제작)에서는 그리드 배치 도구(CalendarGridTools)를 추가로 노출한다.
 *
 * T3b 연달력(2026-10-24): 캔버스에 연달력(variant 'year')이 있으면 '연달력' 섹션을 보인다 —
 *  - 연도 제목 표시 on/off → `metadata.calendar.show.yearTitle`(템플릿 `style.showTitle=false` 면 제목 자리 자체가 없다).
 *  - 표지·에필로그 연도 선택 → `metadata.calendar.yearDeltas`. 프로파일 `calendar.yearPolicy.select` 가 있고 그 역할 캔버스에
 *    연달력이 있을 때만 노출, 후보는 허용 폭(minDelta~maxDelta)만. 값은 시작연도 기준 상대값이라 시작연월을 바꿔도 유지된다(Q4).
 * 기념일 폼은 문구 스타일 최소 2종(글자색·굵게, D1(b))을 받아 `anniversaries[].style` 에 저장한다.
 * ToolBar 가 productProfile.kind==='calendar' 세트 또는 editMode 에서만 메뉴를 노출한다.
 */

export const START_MONTH_CONFIRM_MESSAGE =
  '사진·텍스트는 유지되고 달력 그리드만 다시 그려집니다. 새 범위 밖 기념일은 목록에 표시됩니다.'
export const DUPLICATE_DATE_MESSAGE = '이미 등록된 날짜입니다'
export const LUNAR_DATA_PENDING_MESSAGE = '음력 환산 데이터 준비 중'
export const OUT_OF_RANGE_BADGE = '범위 밖 — 수정 또는 삭제'
/** 임시공휴일·선거일 체크박스 라벨 — 기본 해제(키 없음 = false = 법정 공휴일만, 2026-10-17 오너 결정) */
export const TEMPORARY_HOLIDAYS_LABEL = '임시공휴일·선거일 표시(공표분)'
/** 기념일 글자색 지정 시 처음 고르는 색(공휴일 기본색과 같은 빨강) */
const DEFAULT_ANNIVERSARY_FILL = '#d93025'

const SELECT_CLASS =
  'h-9 rounded-md border border-editor-border bg-editor-panel px-2 text-sm text-editor-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-editor-accent disabled:cursor-not-allowed disabled:opacity-50'

interface AnniversaryFormState {
  mode: 'add' | 'edit'
  id?: string
  year: number
  month: number
  day: number
  lunar: boolean
  isLeapMonth: boolean
  text: string
  /** 저장분 스타일(색·굵게 외 키 보존용) */
  baseStyle?: CalendarAnniversaryStyle
  /** null = 기본 색 */
  fill: string | null
  bold: boolean
}

function styleFormFields(style: CalendarAnniversaryStyle | undefined): Pick<AnniversaryFormState, 'baseStyle' | 'fill' | 'bold'> {
  return { baseStyle: style, fill: style?.fill ?? null, bold: style?.fontWeight === 'bold' }
}

export default function CalendarPanel() {
  const meta = useCalendarStore((s) => s.meta)
  const editMode = useSettingsStore((s) => s.currentSettings.editMode)
  const profile = useSettingsStore((s) => s.productProfile)
  const dataVersion = meta?.dataVersion ?? profile?.calendar?.dataVersion ?? DEFAULT_CALENDAR_DATA_VERSION
  const data = useMemo(() => getCalendarData(dataVersion), [dataVersion])

  const [form, setForm] = useState<AnniversaryFormState | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const openFormForDate = useCallback(
    (date: string) => {
      const current = useCalendarStore.getState().meta
      if (!current) return
      const p = parseDateKey(date)
      if (!p) return
      const existing = current.anniversaries.find((a) => resolveAnniversarySolar(a, data) === date)
      setFormError(null)
      if (existing) {
        const ep = parseDateKey(existing.date) ?? p
        setForm({
          mode: 'edit',
          id: existing.id,
          year: ep.year,
          month: ep.month,
          day: ep.day,
          lunar: existing.lunar,
          isLeapMonth: Boolean(existing.isLeapMonth),
          text: existing.text,
          ...styleFormFields(existing.style),
        })
      } else {
        setForm({ mode: 'add', year: p.year, month: p.month, day: p.day, lunar: false, isLeapMonth: false, text: '', ...styleFormFields(undefined) })
      }
    },
    [data],
  )

  // 날짜칸 더블클릭은 FeatureSidebar 가 구독한다(그리드 선택 시 이 패널이 언마운트되기 때문) — 여기서는 pendingDate 만 소비
  const pendingDate = useCalendarStore((s) => s.pendingDate)
  useEffect(() => {
    if (!pendingDate || !meta) return
    openFormForDate(pendingDate)
    useCalendarStore.getState().setPendingDate(null)
  }, [pendingDate, meta, openFormForDate])

  // 연달력 유무·역할별 템플릿 연도 — 캔버스 목록이 바뀌거나 관리자 도구가 그리드를 바꾸면 다시 센다
  const allCanvas = useAppStore((s) => s.allCanvas)
  const [gridRev, setGridRev] = useState(0)
  const onGridsChanged = useCallback(() => setGridRev((n) => n + 1), [])
  const yearScan = useMemo(() => {
    // gridRev: 관리자 도구가 같은 캔버스 배열 안에서 객체를 바꿨을 때 다시 세기 위한 의존성
    void gridRev
    return scanYearGrids(allCanvas ?? [], profile?.calendar)
  }, [allCanvas, profile, gridRev])

  if (!meta) {
    return (
      <div className="w-full h-full flex flex-col">
        <div className="px-4 pt-4 pb-3 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-editor-text">달력</h2>
          <p className="text-sm text-editor-text-muted">
            {editMode ? '캘린더 상품 프로파일이 없는 세트입니다. 그리드 배치만 가능합니다.' : '캘린더 상품이 아닙니다.'}
          </p>
          {editMode && <CalendarGridTools onGridsChanged={onGridsChanged} />}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto">
      <div className="px-4 pt-4 pb-3 flex flex-col gap-5">
        <h2 className="text-sm font-semibold text-editor-text">달력</h2>
        <StartMonthSection start={{ year: meta.startYear, month: meta.startMonth }} />
        <DisplayOptionsSection show={meta.show} />
        {yearScan.any && (
          <YearCalendarSection
            start={{ year: meta.startYear, month: meta.startMonth }}
            show={meta.show}
            yearDeltas={meta.yearDeltas}
            policy={profile?.calendar?.yearPolicy}
            scan={yearScan}
          />
        )}
        <AnniversarySection
          anniversaries={meta.anniversaries}
          start={{ year: meta.startYear, month: meta.startMonth }}
          data={data}
          form={form}
          setForm={setForm}
          formError={formError}
          setFormError={setFormError}
        />
        {editMode && <CalendarGridTools onGridsChanged={onGridsChanged} />}
      </div>
    </div>
  )
}

// ─── 시작연월 ──────────────────────────────────────────────────────────────

function StartMonthSection({ start }: { start: YearMonth }) {
  const allowedRange = useCalendarStore((s) => s.allowedRange)
  const options = useMemo(() => listAllowedYearMonths(allowedRange), [allowedRange])
  const years = useMemo(() => Array.from(new Set(options.map((o) => o.year))), [options])
  const [year, setYear] = useState(start.year)
  const [month, setMonth] = useState(start.month)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const monthsForYear = useMemo(() => options.filter((o) => o.year === year).map((o) => o.month), [options, year])
  const rangeLabel = allowedRange ? `${allowedRange.from}~${allowedRange.to}` : ''
  const unchanged = year === start.year && month === start.month

  const apply = async () => {
    setError(null)
    if (unchanged) return
    if (!window.confirm(START_MONTH_CONFIRM_MESSAGE)) return
    const ok = useCalendarStore.getState().setStartMonth(year, month)
    if (!ok) {
      setError(`허용 범위(${rangeLabel}) 밖입니다`)
      return
    }
    setBusy(true)
    try {
      await rehydrateAllCalendarGrids()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2" aria-label="시작연월">
      <h3 className="text-xs font-semibold text-editor-text">시작연월</h3>
      <p className="text-xs text-editor-text-muted">
        현재 {start.year}년 {start.month}월 ~ {formatCalendarEndMonthLabel(start)} · 허용 {rangeLabel}
      </p>
      <div className="flex items-center gap-2">
        <Label htmlFor="calendar-start-year" className="sr-only">시작 연도</Label>
        <select
          id="calendar-start-year"
          aria-label="시작 연도"
          className={cn(SELECT_CLASS, 'flex-1')}
          value={year}
          onChange={(e) => {
            const y = Number(e.target.value)
            setYear(y)
            const months = options.filter((o) => o.year === y).map((o) => o.month)
            if (!months.includes(month)) setMonth(months[0] ?? 1)
          }}
        >
          {(years.length > 0 ? years : [start.year]).map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <Label htmlFor="calendar-start-month" className="sr-only">시작 월</Label>
        <select
          id="calendar-start-month"
          aria-label="시작 월"
          className={cn(SELECT_CLASS, 'w-24')}
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          {(monthsForYear.length > 0 ? monthsForYear : [start.month]).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
        <Button size="sm" disabled={busy || unchanged} onClick={() => void apply()}>적용</Button>
      </div>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    </section>
  )
}

// ─── 표기 옵션 ─────────────────────────────────────────────────────────────

type DisplayOptionKey = keyof CalendarDisplayOptions

function DisplayOptionsSection({ show }: { show: CalendarDisplayOptions }) {
  const toggle = async (key: DisplayOptionKey, value: boolean) => {
    useCalendarStore.getState().setShow({ [key]: value })
    await rehydrateAllCalendarGrids()
  }
  const items: Array<{ key: DisplayOptionKey; label: string }> = [
    { key: 'holidays', label: '공휴일' },
    { key: 'temporaryHolidays', label: TEMPORARY_HOLIDAYS_LABEL },
    { key: 'lunar', label: '음력' },
    { key: 'solarTerms', label: '24절기' },
  ]
  return (
    <section className="flex flex-col gap-2" aria-label="표기 옵션">
      <h3 className="text-xs font-semibold text-editor-text">표기 옵션</h3>
      <div className="flex flex-col gap-1.5">
        {items.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm text-editor-text cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 accent-editor-accent"
              checked={show[key] ?? false}
              onChange={(e) => void toggle(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </section>
  )
}

// ─── 연달력(T3b) ───────────────────────────────────────────────────────────

const YEAR_ROLE_LABEL: Record<CalendarYearRole, string> = { cover: '표지', epilogue: '에필로그' }

interface YearCalendarSectionProps {
  start: YearMonth
  show: CalendarDisplayOptions
  yearDeltas: CalendarYearDeltas | undefined
  policy: CalendarYearPolicy | undefined
  scan: YearGridScan
}

function YearCalendarSection({ start, show, yearDeltas, policy, scan }: YearCalendarSectionProps) {
  const select = policy?.select
  // 정책 허용 폭이 있고 그 역할 캔버스에 연달력이 있을 때만 연도 선택을 연다
  const roles = (['cover', 'epilogue'] as const).filter((r) => select && scan[r] !== undefined)
  const deltas = useMemo(() => {
    if (!select) return []
    const out: number[] = []
    for (let d = select.minDelta; d <= select.maxDelta; d += 1) out.push(d)
    return out
  }, [select])

  const toggleTitle = async (value: boolean) => {
    useCalendarStore.getState().setShow({ yearTitle: value })
    await rehydrateAllCalendarGrids()
  }
  const chooseYear = async (role: CalendarYearRole, raw: string) => {
    const ok = useCalendarStore.getState().setYearDelta(role, raw === '' ? null : Number(raw))
    if (ok) await rehydrateAllCalendarGrids()
  }

  return (
    <section className="flex flex-col gap-2" aria-label="연달력">
      <h3 className="text-xs font-semibold text-editor-text">연달력</h3>
      <label className="flex items-center gap-2 text-sm text-editor-text cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 accent-editor-accent"
          checked={show.yearTitle ?? true}
          onChange={(e) => void toggleTitle(e.target.checked)}
        />
        연도 제목 표시
      </label>
      {roles.map((role) => {
        const current = yearDeltas?.[role]
        return (
          <div key={role} className="flex items-center gap-2">
            <Label htmlFor={`calendar-year-${role}`} className="w-16 shrink-0 text-sm text-editor-text">{YEAR_ROLE_LABEL[role]}</Label>
            <select
              id={`calendar-year-${role}`}
              aria-label={`${YEAR_ROLE_LABEL[role]} 연달력 연도`}
              className={cn(SELECT_CLASS, 'flex-1')}
              value={current === undefined ? '' : String(current)}
              onChange={(e) => void chooseYear(role, e.target.value)}
            >
              <option value="">기본 ({formatYearCalendarLabel(policy?.span, start, scan[role] ?? 0)})</option>
              {deltas.map((d) => (
                <option key={d} value={String(d)}>{formatYearCalendarLabel(policy?.span, start, d)}</option>
              ))}
            </select>
          </div>
        )
      })}
    </section>
  )
}

// ─── 기념일 ────────────────────────────────────────────────────────────────

interface AnniversarySectionProps {
  anniversaries: CalendarAnniversary[]
  start: YearMonth
  data: CalendarData | null
  form: AnniversaryFormState | null
  setForm: (f: AnniversaryFormState | null) => void
  formError: string | null
  setFormError: (m: string | null) => void
}

function AnniversarySection({ anniversaries, start, data, form, setForm, formError, setFormError }: AnniversarySectionProps) {
  const allowedRange = useCalendarStore((s) => s.allowedRange)
  const years = useMemo(() => listAnniversaryYears(allowedRange, start), [allowedRange, start])
  const lunarAvailable = data !== null

  const openAdd = () => {
    setFormError(null)
    setForm({ mode: 'add', year: start.year, month: start.month, day: 1, lunar: false, isLeapMonth: false, text: '', ...styleFormFields(undefined) })
  }
  const openEdit = (a: CalendarAnniversary) => {
    const p = parseDateKey(a.date) ?? { year: start.year, month: start.month, day: 1 }
    setFormError(null)
    setForm({
      mode: 'edit',
      id: a.id,
      year: p.year,
      month: p.month,
      day: p.day,
      lunar: a.lunar,
      isLeapMonth: Boolean(a.isLeapMonth),
      text: a.text,
      ...styleFormFields(a.style),
    })
  }
  const remove = async (id: string) => {
    useCalendarStore.getState().removeAnniversary(id)
    if (form?.id === id) setForm(null)
    await rehydrateAllCalendarGrids()
  }
  const save = async () => {
    if (!form) return
    const text = form.text.trim()
    if (!text) {
      setFormError('문구를 입력해 주세요')
      return
    }
    const candidate = {
      date: formatDateKey(form.year, form.month, form.day),
      lunar: form.lunar && lunarAvailable,
      isLeapMonth: form.lunar && lunarAvailable ? form.isLeapMonth : undefined,
      text,
    }
    const style = mergeAnniversaryStyle(form.baseStyle, form.fill, form.bold)
    if (candidate.lunar && resolveAnniversarySolar(candidate, data) === null) {
      setFormError('해당 음력 날짜가 데이터에 없습니다(윤달·30일 확인)')
      return
    }
    const list = useCalendarStore.getState().meta?.anniversaries ?? []
    if (findDuplicateAnniversary(list, candidate, data, form.mode === 'edit' ? form.id : undefined)) {
      setFormError(DUPLICATE_DATE_MESSAGE)
      return
    }
    const store = useCalendarStore.getState()
    if (form.mode === 'edit' && form.id) {
      // style: undefined 는 저장분 스타일 제거(색·굵게 해제 + 다른 키 없음)
      store.updateAnniversary(form.id, { ...candidate, style })
    } else {
      store.addAnniversary(style ? { ...candidate, style } : candidate)
    }
    setForm(null)
    setFormError(null)
    await rehydrateAllCalendarGrids()
  }

  const maxDay = form ? (form.lunar ? 30 : daysInSolarMonth(form.year, form.month)) : 31
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)

  return (
    <section className="flex flex-col gap-2" aria-label="기념일 관리">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-editor-text">기념일 관리</h3>
        <Button variant="outline" size="sm" onClick={openAdd}>추가</Button>
      </div>
      <p className="text-xs text-editor-text-muted">달력의 날짜칸을 더블클릭하면 그 날짜로 바로 추가·수정할 수 있습니다.</p>

      {anniversaries.length === 0 ? (
        <p className="py-2 text-center text-xs text-editor-text-muted">등록된 기념일이 없습니다.</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="기념일 목록">
          {anniversaries.map((a) => {
            const solar = resolveAnniversarySolar(a, data)
            const outOfRange = !isSolarDateInCalendarRange(solar, start)
            return (
              <li
                key={a.id}
                data-testid={`anniversary-${a.id}`}
                className="flex items-start justify-between gap-2 rounded-md border border-editor-border px-2 py-1.5 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-editor-text">{a.text}</div>
                  <div className="text-xs text-editor-text-muted">{formatAnniversaryDateLabel(a)}</div>
                  {outOfRange && (
                    <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                      {OUT_OF_RANGE_BADGE}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" aria-label={`기념일 수정 ${a.text}`} onClick={() => openEdit(a)}>수정</Button>
                  <Button variant="ghost" size="sm" aria-label={`기념일 삭제 ${a.text}`} onClick={() => void remove(a.id)}>삭제</Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {form && (
        <form
          className="flex flex-col gap-2 rounded-md border border-editor-border p-2"
          aria-label={form.mode === 'edit' ? '기념일 수정' : '기념일 추가'}
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <div className="grid grid-cols-3 gap-1">
            <select
              aria-label="기념일 연도"
              className={SELECT_CLASS}
              value={form.year}
              onChange={(e) => setForm({ ...form, year: Number(e.target.value) })}
            >
              {years.map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
            <select
              aria-label="기념일 월"
              className={SELECT_CLASS}
              value={form.month}
              onChange={(e) => {
                const month = Number(e.target.value)
                const limit = form.lunar ? 30 : daysInSolarMonth(form.year, month)
                setForm({ ...form, month, day: Math.min(form.day, limit) })
              }}
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
            </select>
            <select
              aria-label="기념일 일"
              className={SELECT_CLASS}
              value={Math.min(form.day, maxDay)}
              onChange={(e) => setForm({ ...form, day: Number(e.target.value) })}
            >
              {days.map((d) => <option key={d} value={d}>{d}일</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className={cn('flex items-center gap-1.5 text-sm text-editor-text', !lunarAvailable && 'opacity-50')}>
              <input
                type="checkbox"
                className="h-4 w-4 accent-editor-accent"
                aria-label="음력"
                disabled={!lunarAvailable}
                checked={form.lunar && lunarAvailable}
                onChange={(e) => setForm({ ...form, lunar: e.target.checked, isLeapMonth: e.target.checked ? form.isLeapMonth : false })}
              />
              음력
            </label>
            {form.lunar && lunarAvailable && (
              <label className="flex items-center gap-1.5 text-sm text-editor-text">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-editor-accent"
                  aria-label="윤달"
                  checked={form.isLeapMonth}
                  onChange={(e) => setForm({ ...form, isLeapMonth: e.target.checked })}
                />
                윤달
              </label>
            )}
            {!lunarAvailable && <span className="text-xs text-editor-text-muted">{LUNAR_DATA_PENDING_MESSAGE}</span>}
          </div>
          <Input
            aria-label="기념일 문구"
            placeholder="문구 (예: 생일)"
            value={form.text}
            maxLength={40}
            onChange={(e) => setForm({ ...form, text: e.target.value })}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-sm text-editor-text">
              <input
                type="checkbox"
                className="h-4 w-4 accent-editor-accent"
                aria-label="글자색 지정"
                checked={form.fill !== null}
                onChange={(e) => setForm({ ...form, fill: e.target.checked ? (form.fill ?? DEFAULT_ANNIVERSARY_FILL) : null })}
              />
              글자색
            </label>
            <input
              type="color"
              aria-label="기념일 글자색"
              className="h-7 w-10 cursor-pointer rounded border border-editor-border bg-transparent disabled:cursor-not-allowed disabled:opacity-50"
              disabled={form.fill === null}
              value={form.fill ?? DEFAULT_ANNIVERSARY_FILL}
              onChange={(e) => setForm({ ...form, fill: e.target.value })}
            />
            <label className="flex items-center gap-1.5 text-sm text-editor-text">
              <input
                type="checkbox"
                className="h-4 w-4 accent-editor-accent"
                aria-label="굵게"
                checked={form.bold}
                onChange={(e) => setForm({ ...form, bold: e.target.checked })}
              />
              굵게
            </label>
          </div>
          {formError && <p role="alert" className="text-xs text-red-500">{formError}</p>}
          <div className="flex justify-end gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setForm(null); setFormError(null) }}>취소</Button>
            <Button type="submit" size="sm">{form.mode === 'edit' ? '수정 저장' : '추가 저장'}</Button>
          </div>
        </form>
      )}
    </section>
  )
}
