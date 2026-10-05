import { describe, it, expect } from 'vitest';
import { pageStepLabel } from './pageStepLabel';

describe('pageStepLabel — 템플릿셋 목록 쪽 추가 단위 표시', () => {
  it('2 이상 정수 → N쪽', () => {
    expect(pageStepLabel(4)).toBe('4쪽');
    expect(pageStepLabel(2)).toBe('2쪽');
    expect(pageStepLabel('4')).toBe('4쪽');
  });

  it('미설정·1·무효값 → -', () => {
    for (const raw of [null, undefined, 1, 0, -4, 2.5, '', ' ', 'abc', Number.NaN]) {
      expect(pageStepLabel(raw)).toBe('-');
    }
  });
});
