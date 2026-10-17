import { describe, it, expect } from 'vitest';
import type { ProductProfile } from '@storige/types';
import { parseProductProfileJson, stringifyProductProfile } from './productProfileJson';

const deskLarge: ProductProfile = {
  version: 1,
  kind: 'calendar',
  editorType: 'calendar_desk_large',
  pages: { kind: 'fixed', count: 26, step: 2, protectedIndices: [0, 25], labelRule: 'month' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'top-ring', pairing: 'offset-next', backRotation: 0, duplexFlip: 'short-edge' },
  calendar: {
    layout: 'desk', monthCount: 12, coverCanvases: 1, canvasesPerMonth: 2, epilogueCanvases: 1,
    allowedRange: { from: '2026-01', to: '2027-12' }, weekStart: 0,
    show: { holidays: true, lunar: true, solarTerms: true }, dataVersion: 'kr-2025-2035-v1',
  },
  output: { mode: 'single-pdf' },
};

describe('parseProductProfileJson — 상품 프로파일 JSON 섹션', () => {
  it('빈 문자열·공백·null·undefined → value null, 오류 없음(기존 동작)', () => {
    for (const text of ['', '   ', '\n\t', null, undefined]) {
      expect(parseProductProfileJson(text)).toEqual({ value: null, errors: [] });
    }
  });

  it('JSON 파싱 오류 → errors 1건, value null', () => {
    const out = parseProductProfileJson('{ version: 1 ');
    expect(out.value).toBeNull();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatch(/^JSON 파싱 오류: /);
  });

  it('validateProductProfile 오류 → errors 그대로, value null', () => {
    const bad = { ...deskLarge, pages: { ...deskLarge.pages, count: 25 } };
    const out = parseProductProfileJson(JSON.stringify(bad));
    expect(out.value).toBeNull();
    expect(out.errors).toContain('pages.count(25)는 coverCanvases + 12×canvasesPerMonth + epilogueCanvases = 26 여야 합니다');
  });

  it('유효 JSON → 파싱된 객체, 오류 없음', () => {
    const out = parseProductProfileJson(JSON.stringify(deskLarge));
    expect(out.errors).toEqual([]);
    expect(out.value).toEqual(deskLarge);
  });
});

describe('stringifyProductProfile', () => {
  it('null/undefined → 빈 문자열', () => {
    expect(stringifyProductProfile(null)).toBe('');
    expect(stringifyProductProfile(undefined)).toBe('');
  });

  it('값 → 2칸 들여쓰기 JSON, 라운드트립 동일', () => {
    const text = stringifyProductProfile(deskLarge);
    expect(text).toBe(JSON.stringify(deskLarge, null, 2));
    expect(parseProductProfileJson(text).value).toEqual(deskLarge);
  });
});
