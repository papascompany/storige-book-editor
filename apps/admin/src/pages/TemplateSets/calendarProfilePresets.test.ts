import { describe, it, expect } from 'vitest';
import { EditorMode, resolveCalendarCanvasCount, validateProductProfile, type CalendarProfile } from '@storige/types';
import {
  CALENDAR_PROFILE_PRESETS,
  buildCalendarTemplateRefs,
  calendarPresetFormValues,
  findCalendarProfilePreset,
} from './calendarProfilePresets';

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
  it('단일 모드·양면 원파일·내지 추가 불가·[26,26]·pageStep 없음·JSON textarea', () => {
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
