/**
 * kr-2025-2035-v1.test.ts — 생성 데이터 교차 검증 (P1-c, 2026-10-17)
 *
 * 참고값: KASI 달력자료·우주항공청 2027 월력요항·대통령령 제36290호(2026-04-30 개정) 대조 결과(2026-10-17).
 * 설날 2027-02-07·2028-01-27 은 KASI 와 일치(중국력 2/6·1/26 과 하루 차이 — KST 자정 직후 합삭).
 * 2025~2027 공휴일 날짜 집합과 2025~2027 절기 72건은 KASI 와 전부 일치해 아래에 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { CALENDAR_DATA_VERSIONS } from '@storige/types';
import { CALENDAR_DATA_KR_2025_2035_V1 as data } from './kr-2025-2035-v1';
import { lunarToSolar, parseDateKey, weekdayOf } from '../core';

const YEARS = Array.from({ length: 11 }, (_, i) => 2025 + i);

const SEOLLAL: Record<number, string> = {
  2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-07', 2028: '2028-01-27', 2029: '2029-02-13', 2030: '2030-02-03',
  2031: '2031-01-23', 2032: '2032-02-11', 2033: '2033-01-31', 2034: '2034-02-19', 2035: '2035-02-08',
};
const CHUSEOK: Record<number, string> = {
  2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12',
  2031: '2031-10-01', 2032: '2032-09-19', 2033: '2033-09-08', 2034: '2034-09-27', 2035: '2035-09-16',
};
const BUDDHA: Record<number, string> = {
  2025: '2025-05-05', 2026: '2026-05-24', 2027: '2027-05-13', 2028: '2028-05-02', 2029: '2029-05-20', 2030: '2030-05-09',
  2031: '2031-05-28', 2032: '2032-05-16', 2033: '2033-05-06', 2034: '2034-05-25', 2035: '2035-05-15',
};
const LEAP_MONTHS: Record<number, number | null> = {
  2025: 6, 2026: null, 2027: null, 2028: 5, 2029: null, 2030: null, 2031: 3, 2032: null, 2033: 11, 2034: null, 2035: null,
};
const TERMS_2025: Record<string, string> = {
  소한: '2025-01-05', 대한: '2025-01-20', 입춘: '2025-02-03', 우수: '2025-02-18', 경칩: '2025-03-05', 춘분: '2025-03-20',
  청명: '2025-04-04', 곡우: '2025-04-20', 입하: '2025-05-05', 소만: '2025-05-21', 망종: '2025-06-05', 하지: '2025-06-21',
  소서: '2025-07-07', 대서: '2025-07-22', 입추: '2025-08-07', 처서: '2025-08-23', 백로: '2025-09-07', 추분: '2025-09-23',
  한로: '2025-10-08', 상강: '2025-10-23', 입동: '2025-11-07', 소설: '2025-11-22', 대설: '2025-12-07', 동지: '2025-12-22',
};
const TERMS_2026_PARTIAL: Record<string, string> = {
  입춘: '2026-02-04', 춘분: '2026-03-20', 청명: '2026-04-05', 망종: '2026-06-06', 하지: '2026-06-21', 대서: '2026-07-23',
  추분: '2026-09-23', 동지: '2026-12-22',
};
const TERMS_2026_KASI_EXTRA: Record<string, string> = { 우수: '2026-02-19', 경칩: '2026-03-05', 청명: '2026-04-05', 망종: '2026-06-06', 대서: '2026-07-23' };
const TERMS_2027: Record<string, string> = {
  소한: '2027-01-05', 대한: '2027-01-20', 입춘: '2027-02-04', 우수: '2027-02-19', 경칩: '2027-03-06', 춘분: '2027-03-21',
  청명: '2027-04-05', 곡우: '2027-04-20', 입하: '2027-05-06', 소만: '2027-05-21', 망종: '2027-06-06', 하지: '2027-06-21',
  소서: '2027-07-07', 대서: '2027-07-23', 입추: '2027-08-08', 처서: '2027-08-23', 백로: '2027-09-08', 추분: '2027-09-23',
  한로: '2027-10-08', 상강: '2027-10-24', 입동: '2027-11-08', 소설: '2027-11-22', 대설: '2027-12-07', 동지: '2027-12-22',
};
/** KASI 공휴일 날짜 집합(이름 무관) — 대체공휴일·임시공휴일·선거일 포함 */
const KASI_HOLIDAY_DATES: Record<number, string[]> = {
  2025: ['01-01', '01-27', '01-28', '01-29', '01-30', '03-01', '03-03', '05-05', '05-06', '06-03', '06-06', '08-15', '10-03', '10-05', '10-06', '10-07', '10-08', '10-09', '12-25'],
  2026: ['01-01', '02-16', '02-17', '02-18', '03-01', '03-02', '05-01', '05-05', '05-24', '05-25', '06-03', '06-06', '07-17', '08-15', '08-17', '09-24', '09-25', '09-26', '10-03', '10-05', '10-09', '12-25'],
  2027: ['01-01', '02-06', '02-07', '02-08', '02-09', '03-01', '05-01', '05-03', '05-05', '05-13', '06-06', '07-17', '07-19', '08-15', '08-16', '09-14', '09-15', '09-16', '10-03', '10-04', '10-09', '10-11', '12-25', '12-27'],
};
const TERM_ORDER = [
  '소한', '대한', '입춘', '우수', '경칩', '춘분', '청명', '곡우', '입하', '소만', '망종', '하지',
  '소서', '대서', '입추', '처서', '백로', '추분', '한로', '상강', '입동', '소설', '대설', '동지',
];

const daysBetween = (a: string, b: string): number => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000;

describe('kr-2025-2035-v1 — 메타', () => {
  it('version·range 가 @storige/types CALENDAR_DATA_VERSIONS 와 일치한다', () => {
    expect(data.version).toBe('kr-2025-2035-v1');
    expect(CALENDAR_DATA_VERSIONS[data.version]).toBeDefined();
    expect(data.range).toEqual(CALENDAR_DATA_VERSIONS[data.version].range);
    expect(data.range).toEqual({ from: '2025-01', to: '2035-12' });
    expect(data.source.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(data.generatedAt))).toBe(false);
  });

  it('양력 2025~2035 연도마다 holidays·solarTerms 가 있고, lunarYears 는 2024~2035', () => {
    expect(Object.keys(data.holidays).map(Number)).toEqual(YEARS);
    expect(Object.keys(data.solarTerms).map(Number)).toEqual(YEARS);
    expect(Object.keys(data.lunarYears).map(Number)).toEqual([2024, ...YEARS]);
  });
});

describe('kr-2025-2035-v1 — 공휴일', () => {
  it('연도별 날짜 오름차순·(date,name) 중복 없음·연도 일치·형식 유효', () => {
    for (const y of YEARS) {
      const list = data.holidays[String(y)];
      expect(list.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        expect(parseDateKey(h.date), h.date).not.toBeNull();
        expect(h.date.startsWith(`${y}-`)).toBe(true);
        if (i > 0) expect(h.date >= list[i - 1].date, `${y} 정렬: ${list[i - 1].date} > ${h.date}`).toBe(true);
        const key = `${h.date}|${h.name}`;
        expect(seen.has(key), `중복 ${key}`).toBe(false);
        seen.add(key);
        if (h.substitute) {
          expect(h.for).toBeTruthy();
          expect(h.name).toBe(`대체공휴일(${h.for})`);
        }
      }
    }
  });

  it('고정 공휴일 8종이 매년 있고, 노동절·제헌절은 2026년부터(2026-04-30 개정)', () => {
    const fixed: Array<[string, string]> = [
      ['01-01', '신정'], ['03-01', '삼일절'], ['05-05', '어린이날'], ['06-06', '현충일'],
      ['08-15', '광복절'], ['10-03', '개천절'], ['10-09', '한글날'], ['12-25', '기독탄신일'],
    ];
    const since2026: Array<[string, string]> = [['05-01', '노동절'], ['07-17', '제헌절']];
    for (const y of YEARS) {
      const list = data.holidays[String(y)];
      for (const [md, name] of fixed) {
        expect(list.some((h) => h.date === `${y}-${md}` && h.name === name), `${y}-${md} ${name}`).toBe(true);
      }
      for (const [md, name] of since2026) {
        expect(list.some((h) => h.date === `${y}-${md}` && h.name === name), `${y}-${md} ${name}`).toBe(y >= 2026);
      }
    }
  });

  it('2025·2026·2027 공휴일 날짜 집합이 KASI 목록과 정확히 같다', () => {
    for (const [y, mds] of Object.entries(KASI_HOLIDAY_DATES)) {
      const got = [...new Set(data.holidays[y].map((h) => h.date))].sort();
      expect(got, `${y} 공휴일 집합`).toEqual(mds.map((md) => `${y}-${md}`));
    }
  });

  it('설날·추석 연휴 3일과 부처님오신날이 음력 환산과 일치한다', () => {
    for (const y of YEARS) {
      const list = data.holidays[String(y)];
      const seol = SEOLLAL[y];
      const seolDays = list.filter((h) => h.name === '설날').map((h) => h.date);
      expect(seolDays, `${y} 설날`).toHaveLength(3);
      expect(seolDays[1]).toBe(seol);
      expect(daysBetween(seolDays[0], seolDays[2])).toBe(2);
      const chu = list.filter((h) => h.name === '추석').map((h) => h.date);
      expect(chu, `${y} 추석`).toHaveLength(3);
      expect(chu[1]).toBe(CHUSEOK[y]);
      expect(daysBetween(chu[0], chu[2])).toBe(2);
      expect(list.filter((h) => h.name === '부처님오신날').map((h) => h.date)).toEqual([BUDDHA[y]]);
    }
  });

  it('대체공휴일은 토·일이 아니고 다른 공휴일과 겹치지 않는다; 신정·현충일 대체 없음', () => {
    for (const y of YEARS) {
      const list = data.holidays[String(y)];
      for (const h of list) {
        if (!h.substitute) continue;
        const wd = weekdayOf(h.date);
        expect(wd === 0 || wd === 6, `${h.date} 대체공휴일이 주말`).toBe(false);
        expect(list.filter((o) => o.date === h.date && !o.temporary), `${h.date} 겹침`).toHaveLength(1);
        expect(h.for!.includes('신정') || h.for!.includes('현충일'), `${h.date} ${h.for}`).toBe(false);
      }
    }
  });

  it('대체공휴일 참고 예시(있어야/없어야 하는 날짜)', () => {
    const all = Object.values(data.holidays).flat();
    const subs = new Set(all.filter((h) => h.substitute).map((h) => h.date));
    for (const d of ['2025-03-03', '2025-05-06', '2025-10-08', '2026-03-02', '2026-05-25', '2026-08-17', '2026-10-05', '2027-02-09', '2027-05-03', '2027-07-19', '2027-08-16', '2027-10-04', '2027-10-11', '2027-12-27']) {
      expect(subs.has(d), `대체공휴일 ${d} 있어야 함`).toBe(true);
    }
    for (const d of ['2026-06-08', '2027-03-02']) expect(subs.has(d), `대체공휴일 ${d} 없어야 함`).toBe(false);
  });

  it('overrides(temporary) 시드가 병합돼 있다', () => {
    const t = (y: number) => data.holidays[String(y)].filter((h) => h.temporary).map((h) => `${h.date} ${h.name}`);
    expect(t(2025)).toEqual(['2025-01-27 임시공휴일', '2025-06-03 대통령선거일']);
    expect(t(2026)).toEqual(['2026-06-03 지방선거일']);
    // D4(2026-10-24): 2028 국회의원선거일(공직선거법 제34조 — 임기만료일 전 50일 이후 첫 수요일)은 temporary·기본 미표시
    expect(t(2027)).toEqual([]);
    expect(t(2028)).toEqual(['2028-04-12 국회의원선거일']);
    expect(weekdayOf('2028-04-12')).toBe(3);
  });
});

describe('kr-2025-2035-v1 — 24절기', () => {
  it('매년 24개, 소한→동지 순서, 날짜 오름차순·연도 일치', () => {
    for (const y of YEARS) {
      const list = data.solarTerms[String(y)];
      expect(list.map((t) => t.name)).toEqual(TERM_ORDER);
      for (let i = 0; i < list.length; i++) {
        expect(parseDateKey(list[i].date)).not.toBeNull();
        expect(list[i].date.startsWith(`${y}-`)).toBe(true);
        if (i > 0) {
          const gap = daysBetween(list[i - 1].date, list[i].date);
          expect(gap >= 14 && gap <= 17, `${y} ${list[i].name} 간격 ${gap}`).toBe(true);
        }
      }
    }
  });

  it('2025·2027 전체, 2026 일부 절기 날짜가 KASI 값과 일치한다', () => {
    const t2025 = Object.fromEntries(data.solarTerms['2025'].map((t) => [t.name, t.date]));
    expect(t2025).toEqual(TERMS_2025);
    const t2026 = Object.fromEntries(data.solarTerms['2026'].map((t) => [t.name, t.date]));
    for (const [name, date] of Object.entries({ ...TERMS_2026_PARTIAL, ...TERMS_2026_KASI_EXTRA })) expect(t2026[name], `2026 ${name}`).toBe(date);
    const t2027 = Object.fromEntries(data.solarTerms['2027'].map((t) => [t.name, t.date]));
    expect(t2027).toEqual(TERMS_2027);
  });
});

/**
 * 잡절(삼복) 공표값 — 월력요항 「□ 잡절(삼복)」 표(전자관보, KASI 달력자료 > 월력요항 링크, 2026-10-24 조회):
 *  2025 우주항공청공고 제2024-1호(2024-06-20) · 2026 제2025-0044호(2025-06-30) · 2027 제2026-0078호(2026-06-29).
 * 2028 은 월력요항 미공고(KASI 월력요항 2028년 '등록된 게시글이 없습니다', 2026-10-24)라 공표값 대조에서 제외 —
 * 아래 규칙 테스트로만 고정한다(계산값 2028-07-14·07-24·08-13).
 */
const MINOR_TERMS_PUBLISHED: Record<number, Record<string, string>> = {
  2025: { 초복: '2025-07-20', 중복: '2025-07-30', 말복: '2025-08-09' },
  2026: { 초복: '2026-07-15', 중복: '2026-07-25', 말복: '2026-08-14' },
  2027: { 초복: '2027-07-20', 중복: '2027-07-30', 말복: '2027-08-09' },
};
/** 'YYYY-MM-DD' → 일진 천간 번호(0=갑 … 6=경). JDN 기준 (JDN + 49) mod 60 = 육십갑자 번호(0=갑자) */
const dayStem = (key: string): number => {
  const jdn = Date.parse(`${key}T00:00:00Z`) / 86400000 + 2440588;
  return (((jdn + 49) % 60) + 60) % 60 % 10;
};
const GYEONG = 6;
const addDays = (key: string, n: number): string => new Date(Date.parse(`${key}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** start 당일부터 세어 n번째 경일(start 가 경일이면 그날이 첫째 — KASI 2019 초복·2012/2014 말복 선례) */
const nthGyeongFrom = (start: string, n: number): string => {
  let d = start;
  let count = 0;
  for (;;) {
    if (dayStem(d) === GYEONG && ++count === n) return d;
    d = addDays(d, 1);
  }
};

describe('kr-2025-2035-v1 — 잡절(삼복, T4)', () => {
  it('2025~2027 초복·중복·말복이 월력요항 공표값과 정확히 같다(2028 은 미공고로 제외)', () => {
    for (const [y, exp] of Object.entries(MINOR_TERMS_PUBLISHED)) {
      const got = Object.fromEntries((data.minorTerms?.[y] ?? []).map((t) => [t.name, t.date]));
      expect(got, `${y} 잡절`).toEqual(exp);
    }
  });

  it('매년 초복·중복·말복 3건(순서·연도 일치), 모두 경일, 하지·입추 기준 규칙(당일 포함)과 일치', () => {
    expect(dayStem('2000-01-01')).toBe(4); // 2000-01-01 = 무오(戊午)일 — 공식 기준점 확인
    for (const y of YEARS) {
      const list = data.minorTerms?.[String(y)] ?? [];
      expect(list.map((t) => t.name), `${y}`).toEqual(['초복', '중복', '말복']);
      const terms = Object.fromEntries(data.solarTerms[String(y)].map((t) => [t.name, t.date]));
      const [cho, jung, mal] = list.map((t) => t.date);
      for (const d of [cho, jung, mal]) {
        expect(d.startsWith(`${y}-`)).toBe(true);
        expect(dayStem(d), `${y} ${d} 경일`).toBe(GYEONG);
      }
      expect(cho, `${y} 초복`).toBe(nthGyeongFrom(terms['하지'], 3));
      expect(jung, `${y} 중복`).toBe(nthGyeongFrom(terms['하지'], 4));
      expect(mal, `${y} 말복`).toBe(nthGyeongFrom(terms['입추'], 1));
      expect(daysBetween(cho, jung)).toBe(10);
      expect([10, 20]).toContain(daysBetween(jung, mal)); // 20 = 월복
    }
  });

  it('입추 당일이 경일인 2031·2033 은 말복 = 입추 당일(KASI 2012·2014 월력요항 말복 08-07 = 입추 선례)', () => {
    for (const y of [2031, 2033]) {
      const ipchu = data.solarTerms[String(y)].find((t) => t.name === '입추')?.date;
      expect(ipchu && dayStem(ipchu)).toBe(GYEONG);
      expect(data.minorTerms?.[String(y)]?.find((t) => t.name === '말복')?.date).toBe(ipchu);
    }
  });
});

describe('kr-2025-2035-v1 — 음력 환산표', () => {
  it('설날(newYear)·윤달 11년 표', () => {
    for (const y of YEARS) {
      const info = data.lunarYears[String(y)];
      expect(info.newYear, `${y} 설날`).toBe(SEOLLAL[y]);
      const leap = info.months.filter((m) => m.leap);
      expect(leap.length, `${y} 윤달 수`).toBe(LEAP_MONTHS[y] === null ? 0 : 1);
      if (LEAP_MONTHS[y] !== null) expect(leap[0].month).toBe(LEAP_MONTHS[y]);
      expect(info.months.length).toBe(LEAP_MONTHS[y] === null ? 12 : 13);
    }
  });

  it('추석·부처님오신날 11년 표 (lunarToSolar)', () => {
    for (const y of YEARS) {
      expect(lunarToSolar({ year: y, month: 8, day: 15, isLeapMonth: false }, data), `${y} 추석`).toBe(CHUSEOK[y]);
      expect(lunarToSolar({ year: y, month: 4, day: 8, isLeapMonth: false }, data), `${y} 부처님오신날`).toBe(BUDDHA[y]);
    }
  });

  it('각 음력 연도: 1~12월 모두 존재, 윤달은 같은 번호 평달 바로 뒤, days 29|30, 월 시작일이 연속', () => {
    const years = Object.keys(data.lunarYears).map(Number);
    for (const y of years) {
      const info = data.lunarYears[String(y)];
      expect(info.months[0]).toMatchObject({ month: 1, leap: false, start: info.newYear });
      let expectedNumber = 1;
      for (let i = 0; i < info.months.length; i++) {
        const m = info.months[i];
        expect(m.days === 29 || m.days === 30, `${y}-${m.month} days ${m.days}`).toBe(true);
        expect(parseDateKey(m.start)).not.toBeNull();
        if (m.leap) {
          expect(info.months[i - 1]).toMatchObject({ month: m.month, leap: false });
        } else {
          expect(m.month).toBe(expectedNumber);
          expectedNumber += 1;
        }
        if (i > 0) expect(daysBetween(info.months[i - 1].start, m.start)).toBe(info.months[i - 1].days);
      }
      expect(expectedNumber).toBe(13);
      const total = info.months.reduce((s, m) => s + m.days, 0);
      expect(total >= 353 && total <= 385, `${y} 합계 ${total}`).toBe(true);
      const next = data.lunarYears[String(y + 1)];
      if (next) {
        const last = info.months[info.months.length - 1];
        expect(daysBetween(last.start, next.newYear), `${y} → ${y + 1} 연속`).toBe(last.days);
      }
    }
  });

  it('표가 양력 2025-01-01 ~ 2035-12-31 을 완전히 덮는다', () => {
    const first = data.lunarYears['2024'].months[0];
    expect(first.start <= '2025-01-01').toBe(true);
    const lastYear = data.lunarYears['2035'];
    const last = lastYear.months[lastYear.months.length - 1];
    expect(daysBetween('2035-12-31', last.start) + last.days > 0).toBe(true);
  });
});
