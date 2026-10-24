/**
 * calendar/core.test.ts — 캘린더 순수 함수 단위 테스트 (P1-c, 2026-10-17)
 * 데이터는 생성물 kr-2025-2035-v1 을 그대로 사용한다(외부 API 없음).
 */
import { describe, it, expect } from 'vitest';
import {
  buildMonthMatrix,
  buildYearMatrix,
  daysInMonth,
  formatDateKey,
  getHolidaysForMonth,
  getMinorTermsForMonth,
  getSolarTermsForMonth,
  isDateInRange,
  isLeapYear,
  lunarToSolar,
  parseDateKey,
  resolveAnniversarySolarDate,
  solarToLunar,
  weekdayOf,
} from './core';
import { CALENDAR_DATA_KR_2025_2035_V1 as data } from './data/kr-2025-2035-v1';
import { DEFAULT_CALENDAR_DATA_VERSION, getCalendarData, listCalendarDataVersions } from './data';

describe('calendar/core — 날짜 기본 함수', () => {
  it('윤년 판정: 2028·2032·2000 true, 2100·2025 false', () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2032)).toBe(true);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2025)).toBe(false);
  });

  it('daysInMonth: 2월 윤년/평년, 30일·31일 달', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 12)).toBe(31);
  });

  it('formatDateKey / parseDateKey 왕복과 무효 입력', () => {
    expect(formatDateKey(2025, 1, 5)).toBe('2025-01-05');
    expect(parseDateKey('2025-01-05')).toEqual({ year: 2025, month: 1, day: 5 });
    expect(parseDateKey('2025-02-29')).toBeNull();
    expect(parseDateKey('2028-02-29')).toEqual({ year: 2028, month: 2, day: 29 });
    expect(parseDateKey('2025-13-01')).toBeNull();
    expect(parseDateKey('2025-1-5')).toBeNull();
    expect(parseDateKey('')).toBeNull();
  });

  it('weekdayOf: 2025-01-01 수요일(3), 2026-03-01 일요일(0), 2027-10-09 토요일(6)', () => {
    expect(weekdayOf('2025-01-01')).toBe(3);
    expect(weekdayOf('2026-03-01')).toBe(0);
    expect(weekdayOf('2027-10-09')).toBe(6);
  });

  it('isDateInRange: 범위 안·경계·밖', () => {
    expect(isDateInRange('2025-01-01', data)).toBe(true);
    expect(isDateInRange('2035-12-31', data)).toBe(true);
    expect(isDateInRange('2024-12-31', data)).toBe(false);
    expect(isDateInRange('2036-01-01', data)).toBe(false);
    expect(isDateInRange('bad', data)).toBe(false);
  });
});

describe('calendar/core — 음력 환산', () => {
  it("solarToLunar('2027-01-05') → 음력 2026-11-28(참조 편집기 관찰값)", () => {
    expect(solarToLunar('2027-01-05', data)).toEqual({ year: 2026, month: 11, day: 28, isLeapMonth: false });
  });

  it("lunarToSolar({2026,11,28}) → '2027-01-05'", () => {
    expect(lunarToSolar({ year: 2026, month: 11, day: 28, isLeapMonth: false }, data)).toBe('2027-01-05');
  });

  it('설날·추석 환산: 2025-01-29 = 음력 1/1, 2025-10-06 = 음력 8/15', () => {
    expect(solarToLunar('2025-01-29', data)).toEqual({ year: 2025, month: 1, day: 1, isLeapMonth: false });
    expect(solarToLunar('2025-10-06', data)).toEqual({ year: 2025, month: 8, day: 15, isLeapMonth: false });
    expect(lunarToSolar({ year: 2025, month: 8, day: 15, isLeapMonth: false }, data)).toBe('2025-10-06');
  });

  it('윤달 왕복: 2025 윤6월 1일', () => {
    const solar = lunarToSolar({ year: 2025, month: 6, day: 1, isLeapMonth: true }, data);
    expect(solar).toBe('2025-07-25');
    expect(solarToLunar(solar as string, data)).toEqual({ year: 2025, month: 6, day: 1, isLeapMonth: true });
    // 평6월 1일과는 다른 날짜
    expect(lunarToSolar({ year: 2025, month: 6, day: 1, isLeapMonth: false }, data)).toBe('2025-06-25');
  });

  it('없는 윤달·30일 없는 달·범위 밖 음력 → null', () => {
    expect(lunarToSolar({ year: 2026, month: 6, day: 1, isLeapMonth: true }, data)).toBeNull();
    const m29 = data.lunarYears['2025'].months.find((m) => m.days === 29 && !m.leap);
    expect(m29).toBeDefined();
    expect(lunarToSolar({ year: 2025, month: m29!.month, day: 30, isLeapMonth: false }, data)).toBeNull();
    expect(lunarToSolar({ year: 2025, month: m29!.month, day: 0, isLeapMonth: false }, data)).toBeNull();
    expect(lunarToSolar({ year: 2040, month: 1, day: 1, isLeapMonth: false }, data)).toBeNull();
  });

  it('양력 2025-01-01 은 음력 2024년 12월 2일(직전 음력 연도 표로 환산)', () => {
    expect(solarToLunar('2025-01-01', data)).toEqual({ year: 2024, month: 12, day: 2, isLeapMonth: false });
  });

  it('데이터 밖 양력(2036-01-01 이후, 2024-02-09 이전) → null', () => {
    expect(solarToLunar('2036-12-31', data)).toBeNull();
    expect(solarToLunar('2024-02-09', data)).toBeNull();
    expect(solarToLunar('not-a-date', data)).toBeNull();
  });

  it('solarToLunar 가 모든 음력 월 시작일에서 1일을 돌려준다(표 일관성)', () => {
    for (const [yearKey, info] of Object.entries(data.lunarYears)) {
      for (const m of info.months) {
        expect(solarToLunar(m.start, data)).toEqual({ year: Number(yearKey), month: m.month, day: 1, isLeapMonth: m.leap });
      }
    }
  });
});

describe('calendar/core — 공휴일·절기 조회', () => {
  it('2025-10 공휴일: 개천절·추석 연휴·대체공휴일(추석)·한글날·임시공휴일', () => {
    const list = getHolidaysForMonth(2025, 10, data);
    const dates = list.map((h) => `${h.date} ${h.name}`);
    expect(dates).toContain('2025-10-03 개천절');
    expect(dates).toContain('2025-10-05 추석');
    expect(dates).toContain('2025-10-06 추석');
    expect(dates).toContain('2025-10-07 추석');
    expect(dates).toContain('2025-10-08 대체공휴일(추석)');
    expect(dates).toContain('2025-10-09 한글날');
    expect(list.find((h) => h.date === '2025-10-08')?.substitute).toBe(true);
    expect(list.some((h) => h.date === '2025-10-10'), '2025-10-10 은 정부 미지정(임시공휴일 아님)').toBe(false);
  });

  it('2026-04-30 개정: 노동절 5/1·제헌절 7/17 은 2026년부터(2025 없음), 2027 토요일 → 대체 5/3·7/19', () => {
    expect(getHolidaysForMonth(2025, 5, data).some((h) => h.name === '노동절')).toBe(false);
    expect(getHolidaysForMonth(2025, 7, data).some((h) => h.name === '제헌절')).toBe(false);
    expect(getHolidaysForMonth(2026, 5, data).find((h) => h.date === '2026-05-01')?.name).toBe('노동절');
    expect(getHolidaysForMonth(2026, 7, data).find((h) => h.date === '2026-07-17')?.name).toBe('제헌절');
    expect(getHolidaysForMonth(2027, 5, data).find((h) => h.date === '2027-05-03')).toMatchObject({ substitute: true, for: '노동절' });
    expect(getHolidaysForMonth(2027, 7, data).find((h) => h.date === '2027-07-19')).toMatchObject({ substitute: true, for: '제헌절' });
  });

  it('대체공휴일 예시: 2025-03-03·2025-05-06·2026-03-02·2026-05-25·2026-08-17·2026-10-05·2027-08-16·2027-10-04·2027-10-11·2027-12-27', () => {
    const sub = (y: number, m: number, d: string) => getHolidaysForMonth(y, m, data).find((h) => h.date === d && h.substitute);
    expect(sub(2025, 3, '2025-03-03')?.for).toBe('삼일절');
    expect(sub(2025, 5, '2025-05-06')?.for).toBe('어린이날·부처님오신날');
    expect(sub(2026, 3, '2026-03-02')?.for).toBe('삼일절');
    expect(sub(2026, 5, '2026-05-25')?.for).toBe('부처님오신날');
    expect(sub(2026, 8, '2026-08-17')?.for).toBe('광복절');
    expect(sub(2026, 10, '2026-10-05')?.for).toBe('개천절');
    expect(sub(2027, 8, '2027-08-16')?.for).toBe('광복절');
    expect(sub(2027, 10, '2027-10-04')?.for).toBe('개천절');
    expect(sub(2027, 10, '2027-10-11')?.for).toBe('한글날');
    expect(sub(2027, 12, '2027-12-27')?.for).toBe('기독탄신일');
  });

  it('대체 없음: 현충일 토요일(2026-06-08 없음)·삼일절 월요일(2027-03-02 없음)·추석 연휴 토요일(2026-09 대체 없음)', () => {
    expect(getHolidaysForMonth(2026, 6, data).some((h) => h.date === '2026-06-08')).toBe(false);
    expect(getHolidaysForMonth(2027, 3, data).some((h) => h.date === '2027-03-02')).toBe(false);
    expect(getHolidaysForMonth(2026, 9, data).some((h) => h.substitute)).toBe(false);
  });

  it('2025-12 절기: 대설 12/7·동지 12/22, 없는 연도는 빈 배열', () => {
    expect(getSolarTermsForMonth(2025, 12, data)).toEqual([
      { date: '2025-12-07', name: '대설' },
      { date: '2025-12-22', name: '동지' },
    ]);
    expect(getSolarTermsForMonth(2040, 1, data)).toEqual([]);
    expect(getHolidaysForMonth(2040, 1, data)).toEqual([]);
  });
});

describe('calendar/core — 기념일 환산', () => {
  it('양력 기념일은 그대로, 무효 날짜는 null', () => {
    expect(resolveAnniversarySolarDate({ date: '2026-03-15', lunar: false, text: '결혼' }, data)).toBe('2026-03-15');
    expect(resolveAnniversarySolarDate({ date: '2026-02-30', lunar: false, text: 'x' }, data)).toBeNull();
    expect(resolveAnniversarySolarDate({ date: '2026/03/15', lunar: false, text: 'x' }, data)).toBeNull();
  });

  it('음력 기념일은 양력으로 환산(윤달 플래그 반영)', () => {
    expect(resolveAnniversarySolarDate({ date: '2026-11-28', lunar: true, text: '생일' }, data)).toBe('2027-01-05');
    expect(resolveAnniversarySolarDate({ date: '2025-06-01', lunar: true, isLeapMonth: true, text: 'x' }, data)).toBe('2025-07-25');
    expect(resolveAnniversarySolarDate({ date: '2026-06-01', lunar: true, isLeapMonth: true, text: 'x' }, data)).toBeNull();
    expect(resolveAnniversarySolarDate({ date: '2036-01-01', lunar: true, text: 'x' }, data)).toBeNull();
  });
});

describe('calendar/core — buildMonthMatrix', () => {
  it('항상 6행×7열, 2026-08(토요일 시작·31일) 은 usedRows 6', () => {
    const m = buildMonthMatrix(2026, 8, { weekStart: 0, data });
    expect(m.rows).toHaveLength(6);
    for (const row of m.rows) expect(row).toHaveLength(7);
    expect(weekdayOf('2026-08-01')).toBe(6);
    expect(m.usedRows).toBe(6);
    expect(m.rows[0][6]).toMatchObject({ date: '2026-08-01', inMonth: true, weekday: 6 });
    expect(m.rows[0][0]).toMatchObject({ date: '2026-07-26', inMonth: false });
    expect(m.rows[5][6]).toMatchObject({ date: '2026-09-05', inMonth: false });
  });

  it('2026-02(일요일 시작·28일) 은 usedRows 4, 5~6행은 익월 채움', () => {
    const m = buildMonthMatrix(2026, 2, { weekStart: 0, data });
    expect(weekdayOf('2026-02-01')).toBe(0);
    expect(m.usedRows).toBe(4);
    expect(m.rows[0][0]).toMatchObject({ date: '2026-02-01', inMonth: true });
    expect(m.rows[3][6]).toMatchObject({ date: '2026-02-28', inMonth: true });
    expect(m.rows[4][0]).toMatchObject({ date: '2026-03-01', inMonth: false });
    expect(m.rows[4].every((c) => !c.inMonth)).toBe(true);
    expect(m.rows[5].every((c) => !c.inMonth)).toBe(true);
  });

  it('weekStart 0/1 열 순서와 첫 칸', () => {
    const sun = buildMonthMatrix(2025, 10, { weekStart: 0, data });
    expect(sun.weekdayOrder).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(sun.rows[0][0].date).toBe('2025-09-28'); // 10/1 수요일 → 일요일 9/28 부터
    const mon = buildMonthMatrix(2025, 10, { weekStart: 1, data });
    expect(mon.weekStart).toBe(1);
    expect(mon.weekdayOrder).toEqual([1, 2, 3, 4, 5, 6, 0]);
    expect(mon.rows[0][0].date).toBe('2025-09-29');
    expect(mon.rows[0].map((c) => c.weekday)).toEqual([1, 2, 3, 4, 5, 6, 0]);
    for (const row of mon.rows) for (const cell of row) expect(cell.weekday).toBe(weekdayOf(cell.date));
  });

  it('칸에 공휴일·절기·음력·기념일이 채워진다(2025-10)', () => {
    const m = buildMonthMatrix(2025, 10, {
      weekStart: 0,
      data,
      anniversaries: [
        { date: '2025-10-15', lunar: false, text: '양력기념' },
        { date: '2025-08-15', lunar: true, text: '음력기념(추석)' },
        { date: '2036-01-01', lunar: true, text: '환산불가' },
      ],
    });
    const cells = m.rows.flat();
    const byDate = (d: string) => cells.find((c) => c.date === d)!;
    expect(byDate('2025-10-06')).toMatchObject({ isHoliday: true, holidayNames: ['추석'], anniversaries: ['음력기념(추석)'] });
    expect(byDate('2025-10-06').lunar).toEqual({ year: 2025, month: 8, day: 15, isLeapMonth: false });
    expect(byDate('2025-10-08')).toMatchObject({ isHoliday: true, holidayNames: ['대체공휴일(추석)'], solarTerm: '한로' });
    expect(byDate('2025-10-23').solarTerm).toBe('상강');
    expect(byDate('2025-10-15').anniversaries).toEqual(['양력기념']);
    expect(byDate('2025-10-02')).toMatchObject({ isHoliday: false, holidayNames: [], solarTerm: null, anniversaries: [] });
    expect(cells.filter((c) => c.anniversaries.includes('환산불가'))).toHaveLength(0);
  });

  it('전월·익월 채움 칸도 공휴일·음력을 채우고, 데이터 밖 칸은 lunar/solarTerm null', () => {
    const jan = buildMonthMatrix(2025, 1, { weekStart: 0, data });
    const dec31 = jan.rows[0][2];
    expect(dec31).toMatchObject({ date: '2024-12-31', inMonth: false, isHoliday: false });
    expect(dec31.lunar).toEqual({ year: 2024, month: 12, day: 1, isLeapMonth: false });
    const dec = buildMonthMatrix(2035, 12, { weekStart: 0, data });
    const cells = dec.rows.flat();
    const jan2036 = cells.filter((c) => c.year === 2036);
    expect(jan2036.length).toBeGreaterThan(0);
    for (const c of jan2036) {
      expect(c.inMonth).toBe(false);
      expect(c.solarTerm).toBeNull();
      expect(c.isHoliday).toBe(false);
    }
    // 2036-01 은 음력 2035-12 안이라 lunar 는 채워지고, 표 끝(2036-01-28 이후)은 null
    expect(cells.find((c) => c.date === '2036-01-01')!.lunar).toEqual({ year: 2035, month: 12, day: 4, isLeapMonth: false });
    expect(solarToLunar('2036-02-01', data)).toBeNull();
  });

  const byDateOf = (m: ReturnType<typeof buildMonthMatrix>, d: string) => m.rows.flat().find((c) => c.date === d)!;

  it('잡절(삼복) getMinorTermsForMonth — 월 필터, 키 없는 데이터·범위 밖 연도는 빈 배열, 월 행렬 셀 구조는 불변(T4)', () => {
    expect(getMinorTermsForMonth(2026, 7, data)).toEqual([
      { date: '2026-07-15', name: '초복' },
      { date: '2026-07-25', name: '중복' },
    ]);
    expect(getMinorTermsForMonth(2026, 8, data)).toEqual([{ date: '2026-08-14', name: '말복' }]);
    expect(getMinorTermsForMonth(2026, 6, data)).toEqual([]);
    expect(getMinorTermsForMonth(2036, 7, data)).toEqual([]);
    const legacy = { ...data, minorTerms: undefined }; // 구 데이터(키 없음)와 같은 취급
    expect(getMinorTermsForMonth(2026, 7, legacy)).toEqual([]);
    // buildMonthMatrix 는 잡절을 칸에 넣지 않는다(표기는 CalendarPlugin cellNotes 의 show.minorTerms 몫) — 데이터 유무와 무관하게 같은 행렬
    expect(buildMonthMatrix(2026, 7, { weekStart: 0, data: legacy })).toEqual(buildMonthMatrix(2026, 7, { weekStart: 0, data }));
  });

  it('임시공휴일·선거일(temporary)은 기본 미표시, includeTemporaryHolidays=true 면 휴일(2026-06-03 지방선거일, 2026-10-17 오너 결정)', () => {
    // 데이터 파일의 temporary 항목 4건이 전제(2025-01-27 임시공휴일, 2025-06-03 대통령선거일, 2026-06-03 지방선거일,
    // 2028-04-12 국회의원선거일 — T4·D4 2026-10-24)
    const temporaryDates = Object.values(data.holidays).flat().filter((h) => h.temporary === true).map((h) => h.date);
    expect(temporaryDates).toEqual(['2025-01-27', '2025-06-03', '2026-06-03', '2028-04-12']);
    // 2028-04-12(수) 국회의원선거일도 기본 미표시, 옵션 true 면 휴일
    const apr28 = (on: boolean) => byDateOf(buildMonthMatrix(2028, 4, { weekStart: 0, data, includeTemporaryHolidays: on }), '2028-04-12');
    expect(apr28(false)).toMatchObject({ isHoliday: false, holidayNames: [] });
    expect(apr28(true)).toMatchObject({ isHoliday: true, holidayNames: ['국회의원선거일'] });

    const byDate = (m: ReturnType<typeof buildMonthMatrix>, d: string) => m.rows.flat().find((c) => c.date === d)!;
    // 기본(옵션 없음) = 법정 공휴일만 — 선거일 칸은 평일
    const jun = buildMonthMatrix(2026, 6, { weekStart: 0, data });
    expect(byDate(jun, '2026-06-03')).toMatchObject({ isHoliday: false, holidayNames: [] });
    expect(byDate(jun, '2026-06-06')).toMatchObject({ isHoliday: true, holidayNames: ['현충일'] });
    expect(buildMonthMatrix(2026, 6, { weekStart: 0, data, includeTemporaryHolidays: false }).rows.flat().find((c) => c.date === '2026-06-03')!.isHoliday).toBe(false);

    // 옵션 true — 선거일이 휴일(색·라벨 입력)로 들어간다
    const junOn = buildMonthMatrix(2026, 6, { weekStart: 0, data, includeTemporaryHolidays: true });
    expect(byDate(junOn, '2026-06-03')).toMatchObject({ isHoliday: true, holidayNames: ['지방선거일'] });
    expect(byDate(junOn, '2026-06-06')).toMatchObject({ isHoliday: true, holidayNames: ['현충일'] });

    // 2025-01-27 임시공휴일: 기본 미표시여도 법정(설 연휴 01-28~30)·대체공휴일(substitute, 03-03 대체공휴일(삼일절))은 그대로
    const jan = buildMonthMatrix(2025, 1, { weekStart: 0, data });
    expect(byDate(jan, '2025-01-27')).toMatchObject({ isHoliday: false, holidayNames: [] });
    expect(byDate(jan, '2025-01-28').isHoliday).toBe(true);
    expect(byDate(jan, '2025-01-30')).toMatchObject({ isHoliday: true, holidayNames: ['설날'] });
    expect(byDate(buildMonthMatrix(2025, 3, { weekStart: 0, data }), '2025-03-03')).toMatchObject({ isHoliday: true, holidayNames: ['대체공휴일(삼일절)'] });
    expect(byDate(buildMonthMatrix(2025, 1, { weekStart: 0, data, includeTemporaryHolidays: true }), '2025-01-27').holidayNames).toEqual(['임시공휴일']);
    // 전월·익월 채움 칸에도 같은 규칙(2025-05 그리드의 06-03 칸)
    const may = buildMonthMatrix(2025, 5, { weekStart: 0, data });
    expect(byDate(may, '2025-06-03')).toMatchObject({ inMonth: false, isHoliday: false });
    expect(byDate(buildMonthMatrix(2025, 5, { weekStart: 0, data, includeTemporaryHolidays: true }), '2025-06-03')).toMatchObject({ inMonth: false, isHoliday: true, holidayNames: ['대통령선거일'] });
  });
});

describe('calendar/core — buildYearMatrix', () => {
  const ym = (m: { year: number; month: number }) => `${m.year}-${String(m.month).padStart(2, '0')}`;
  const inMonthCount = (m: ReturnType<typeof buildMonthMatrix>) => m.rows.flat().filter((c) => c.inMonth).length;

  it('(2027,1) → 2027-01~2027-12 연속 12개월, 각 월은 buildMonthMatrix 결과와 같다', () => {
    const y = buildYearMatrix(2027, 1, { weekStart: 0, data });
    expect(y).toMatchObject({ year: 2027, month: 1, weekStart: 0, weekdayOrder: [0, 1, 2, 3, 4, 5, 6] });
    expect(y.months).toHaveLength(12);
    expect(y.months.map(ym)).toEqual(Array.from({ length: 12 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`));
    y.months.forEach((m, i) => expect(m).toEqual(buildMonthMatrix(2027, i + 1, { weekStart: 0, data })));
  });

  it('(2027,3) → 2027-03~2028-02 — 연도 경계를 넘긴다', () => {
    const y = buildYearMatrix(2027, 3, { weekStart: 0, data });
    expect(y.year).toBe(2027);
    expect(y.month).toBe(3);
    expect(y.months.map(ym)).toEqual([
      '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09', '2027-10', '2027-11', '2027-12', '2028-01', '2028-02',
    ]);
    expect(y.months[11]).toEqual(buildMonthMatrix(2028, 2, { weekStart: 0, data }));
  });

  it('윤년 2028: 2월 inMonth 29일, 2027 은 28일; 2028 연간 inMonth 합 366', () => {
    const y2028 = buildYearMatrix(2028, 1, { weekStart: 0, data });
    expect(inMonthCount(y2028.months[1])).toBe(29);
    expect(y2028.months.reduce((n, m) => n + inMonthCount(m), 0)).toBe(366);
    const y2027 = buildYearMatrix(2027, 1, { weekStart: 0, data });
    expect(inMonthCount(y2027.months[1])).toBe(28);
    expect(y2027.months.reduce((n, m) => n + inMonthCount(m), 0)).toBe(365);
  });

  it('weekStart 0/1: 12개월 모두 weekdayOrder·첫 칸이 weekStart 를 따른다', () => {
    for (const weekStart of [0, 1] as const) {
      const y = buildYearMatrix(2027, 1, { weekStart, data });
      expect(y.weekStart).toBe(weekStart);
      expect(y.weekdayOrder).toEqual(weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]);
      for (const m of y.months) {
        expect(m.weekStart).toBe(weekStart);
        expect(m.weekdayOrder).toEqual(y.weekdayOrder);
        expect(weekdayOf(m.rows[0][0].date)).toBe(weekStart);
      }
    }
  });

  it('includeTemporaryHolidays 재사용: 2026-06-03 기본 미표시, true 면 휴일', () => {
    const cell = (y: ReturnType<typeof buildYearMatrix>) => y.months[5].rows.flat().find((c) => c.date === '2026-06-03')!;
    expect(cell(buildYearMatrix(2026, 1, { weekStart: 0, data })).isHoliday).toBe(false);
    expect(cell(buildYearMatrix(2026, 1, { weekStart: 0, data, includeTemporaryHolidays: true }))).toMatchObject({ isHoliday: true, holidayNames: ['지방선거일'] });
  });

  it('데이터 밖 연도(2036) → throw 없이 칸을 채우고 holiday 없음·lunar null', () => {
    const y = buildYearMatrix(2036, 1, { weekStart: 0, data });
    expect(y.months).toHaveLength(12);
    const inMonth = y.months.flatMap((m) => m.rows.flat().filter((c) => c.inMonth));
    expect(inMonth).toHaveLength(366); // 2036 윤년
    for (const c of inMonth) {
      expect(c.isHoliday).toBe(false);
      expect(c.solarTerm).toBeNull();
    }
    expect(inMonth.filter((c) => c.date >= '2036-03-01').every((c) => c.lunar === null)).toBe(true);
  });

  it('monthCount 인자(확장용, 기본 12): 16·24개월도 연속으로 만든다', () => {
    expect(buildYearMatrix(2027, 1, { weekStart: 0, data }, 16).months.map(ym).at(-1)).toBe('2028-04');
    expect(buildYearMatrix(2027, 3, { weekStart: 0, data }, 24).months.map(ym).at(-1)).toBe('2029-02');
    expect(buildYearMatrix(2027, 1, { weekStart: 0, data }, 0).months).toHaveLength(12);
  });
});

describe('calendar/data — 레지스트리', () => {
  it('기본 버전 조회·목록·없는 버전 null', () => {
    expect(DEFAULT_CALENDAR_DATA_VERSION).toBe('kr-2025-2035-v1');
    expect(getCalendarData(DEFAULT_CALENDAR_DATA_VERSION)).toBe(data);
    expect(listCalendarDataVersions()).toEqual(['kr-2025-2035-v1']);
    expect(getCalendarData('kr-9999-v0')).toBeNull();
    expect(getCalendarData('toString')).toBeNull();
  });
});
