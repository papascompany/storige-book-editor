import { describe, it, expect } from 'vitest';
import { EditorMode, resolveCalendarCanvasCount, validateProductProfile, type CalendarProfile } from '@storige/types';
import {
  CALENDAR_PROFILE_PRESETS,
  DESK_CALENDAR_YEAR_POLICY,
  buildCalendarTemplateRefs,
  calendarPresetFormValues,
  findCalendarProfilePreset,
} from './calendarProfilePresets';
import { parseProductProfileJson, stringifyProductProfile } from './productProfileJson';

describe('CALENDAR_PROFILE_PRESETS — 오너 확정 7종', () => {
  it('키 7종이 순서대로 있고 중복이 없다', () => {
    expect(CALENDAR_PROFILE_PRESETS.map((p) => p.key)).toEqual([
      'calendar_desk_large',
      'calendar_desk_basic',
      'calendar_desk_tiny',
      'calendar_desk_mini',
      'calendar_wall1_a3',
      'calendar_wall2_a4',
      'calendar_wall2_a3',
    ]);
  });

  it.each(CALENDAR_PROFILE_PRESETS.map((p) => [p.key, p] as const))('%s 는 validateProductProfile 오류 0, 캔버스 26', (_key, preset) => {
    expect(validateProductProfile(preset.profile)).toEqual([]);
    expect(preset.profile.editorType).toBe(preset.key);
    expect(preset.profile.pages.count).toBe(26);
    expect(resolveCalendarCanvasCount(preset.profile.calendar as CalendarProfile)).toBe(26);
    expect(preset.width).toBeGreaterThan(0);
    expect(preset.height).toBeGreaterThan(0);
  });

  it('판형·레이아웃이 오너 확정값과 같다', () => {
    const sizes = CALENDAR_PROFILE_PRESETS.map((p) => [p.key, p.width, p.height, p.profile.calendar?.layout]);
    expect(sizes).toEqual([
      ['calendar_desk_large', 265, 190, 'desk'],
      ['calendar_desk_basic', 210, 150, 'desk'],
      ['calendar_desk_tiny', 100, 125, 'desk'],
      ['calendar_desk_mini', 140, 140, 'desk'],
      ['calendar_wall1_a3', 297, 415, 'wall-1'],
      ['calendar_wall2_a4', 294, 210, 'wall-2'],
      ['calendar_wall2_a3', 415, 297, 'wall-2'],
    ]);
  });

  it('findCalendarProfilePreset: 키로 찾고 없으면 undefined', () => {
    expect(findCalendarProfilePreset('calendar_desk_mini')?.width).toBe(140);
    expect(findCalendarProfilePreset('nope')).toBeUndefined();
    expect(findCalendarProfilePreset(undefined)).toBeUndefined();
  });
});

describe('calendarPresetFormValues — 프리셋 적용 폼 값', () => {
  it('단일 모드·양면 원파일·내지 추가 불가·[26,26]·pageStep 없음·재단선 마커+도련 3mm·JSON textarea', () => {
    const values = calendarPresetFormValues(CALENDAR_PROFILE_PRESETS[0]);
    expect(values).toMatchObject({
      width: 265,
      height: 190,
      editorMode: EditorMode.SINGLE,
      pdfOutputMode: 'duplex-merged',
      canAddPage: false,
      pageCountMin: 26,
      pageCountMax: 26,
      pageStep: undefined,
      cropMarkEnabled: true,
      bleedMm: 3,
    });
    expect(values.productProfileJson).toContain('"editorType": "calendar_desk_large"');
    expect(JSON.parse(values.productProfileJson)).toEqual(CALENDAR_PROFILE_PRESETS[0].profile);
  });
});

describe('buildCalendarTemplateRefs — 26개 refs', () => {
  const cal = { coverCanvases: 1, canvasesPerMonth: 2 as const, epilogueCanvases: 1 };

  it('표지 → (앞, 뒤)×12 → 에필로그, 전부 required', () => {
    const refs = buildCalendarTemplateRefs({ cover: ['c'], monthFaces: ['f', 'b'], epilogue: ['e'] }, cal);
    expect(refs).toHaveLength(26);
    expect(refs.every((r) => r.required)).toBe(true);
    expect(refs[0].templateId).toBe('c');
    expect(refs[1].templateId).toBe('f');
    expect(refs[2].templateId).toBe('b');
    expect(refs[23].templateId).toBe('f');
    expect(refs[24].templateId).toBe('b');
    expect(refs[25].templateId).toBe('e');
  });

  it('월1면·표지 없음·에필로그 없음 → 12개', () => {
    const refs = buildCalendarTemplateRefs(
      { cover: [], monthFaces: ['m'], epilogue: [] },
      { coverCanvases: 0, canvasesPerMonth: 1, epilogueCanvases: 0 },
    );
    expect(refs).toHaveLength(12);
    expect(new Set(refs.map((r) => r.templateId))).toEqual(new Set(['m']));
  });

  it('슬롯 수가 프로파일과 다르면 throw', () => {
    expect(() => buildCalendarTemplateRefs({ cover: [], monthFaces: ['f', 'b'], epilogue: ['e'] }, cal)).toThrow('표지 템플릿 1개');
    expect(() => buildCalendarTemplateRefs({ cover: ['c'], monthFaces: ['f'], epilogue: ['e'] }, cal)).toThrow('월 면 템플릿 2개');
    expect(() => buildCalendarTemplateRefs({ cover: ['c'], monthFaces: ['f', 'b'], epilogue: [] }, cal)).toThrow('에필로그 템플릿 1개');
  });
});

describe('연달력 yearPolicy 예시 (T3b, 2026-10-24)', () => {
  /** T3b 이전 프리셋 프로파일(키 순서 포함) — 픽스처 diff 기준 */
  function legacyProfile(editorType: string, layout: string) {
    return {
      version: 1,
      kind: 'calendar',
      editorType,
      pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
      sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
      calendar: {
        layout,
        monthCount: 12,
        coverCanvases: 1,
        canvasesPerMonth: 2,
        epilogueCanvases: 1,
        allowedRange: { from: '2026-01', to: '2027-12' },
        weekStart: 0,
        show: { holidays: true, lunar: true, solarTerms: true },
        dataVersion: 'kr-2025-2035-v1',
      },
      output: { mode: 'single-pdf' },
    };
  }

  it('탁상형 4종만 yearPolicy {select {0,1}}(span 생략 = 기본 규칙), 벽걸이 3종은 없음', () => {
    expect(DESK_CALENDAR_YEAR_POLICY).toEqual({ select: { minDelta: 0, maxDelta: 1 } });
    expect(CALENDAR_PROFILE_PRESETS.map((p) => [p.key, p.profile.calendar?.yearPolicy ?? null])).toEqual([
      ['calendar_desk_large', { select: { minDelta: 0, maxDelta: 1 } }],
      ['calendar_desk_basic', { select: { minDelta: 0, maxDelta: 1 } }],
      ['calendar_desk_tiny', { select: { minDelta: 0, maxDelta: 1 } }],
      ['calendar_desk_mini', { select: { minDelta: 0, maxDelta: 1 } }],
      ['calendar_wall1_a3', null],
      ['calendar_wall2_a4', null],
      ['calendar_wall2_a3', null],
    ]);
    // 프리셋끼리 정책 객체를 공유하지 않는다(폼에서 한 세트를 고쳐도 다른 프리셋 불변)
    const desk = CALENDAR_PROFILE_PRESETS.slice(0, 4).map((p) => p.profile.calendar?.yearPolicy);
    expect(new Set(desk).size).toBe(4);
    expect(desk.every((y) => y !== DESK_CALENDAR_YEAR_POLICY)).toBe(true);
  });

  it.each(CALENDAR_PROFILE_PRESETS.map((p) => [p.key, p] as const))(
    '%s — yearPolicy 를 뺀 JSON 이 T3b 이전과 바이트 동일(yearPolicy 는 calendar 블록 끝)',
    (_key, preset) => {
      const legacy = legacyProfile(preset.key, preset.profile.calendar?.layout ?? '');
      const { yearPolicy, ...calendarRest } = preset.profile.calendar ?? ({} as NonNullable<typeof preset.profile.calendar>);
      expect(JSON.stringify({ ...preset.profile, calendar: calendarRest })).toBe(JSON.stringify(legacy));
      if (yearPolicy) expect(Object.keys(preset.profile.calendar ?? {}).at(-1)).toBe('yearPolicy');
      else expect(JSON.stringify(preset.profile)).toBe(JSON.stringify(legacy));
    },
  );

  it('프로파일 JSON 텍스트 왕복(폼 textarea) — yearPolicy 보존·검증 오류 0, 범위 밖 select 는 검증 문구', () => {
    const preset = CALENDAR_PROFILE_PRESETS[0];
    const parsed = parseProductProfileJson(stringifyProductProfile(preset.profile));
    expect(parsed.errors).toEqual([]);
    expect(parsed.value).toEqual(preset.profile);
    const bad = { ...preset.profile, calendar: { ...preset.profile.calendar, yearPolicy: { select: { minDelta: 0, maxDelta: 3 } } } };
    const result = parseProductProfileJson(JSON.stringify(bad));
    expect(result.value).toBeNull();
    expect(result.errors.some((e) => e.includes('calendar.yearPolicy.select'))).toBe(true);
  });

  it('프리셋 프로파일 show 에 yearTitle 기본값을 두지 않는다(생략 = 표시, 고객 on/off 로만 바뀜)', () => {
    for (const p of CALENDAR_PROFILE_PRESETS) {
      expect(p.profile.calendar?.show).not.toHaveProperty('yearTitle');
      expect(validateProductProfile(p.profile)).toEqual([]);
    }
  });
});
