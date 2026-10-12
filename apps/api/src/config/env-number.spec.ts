/**
 * parseEnvNumber — 수치형 환경 변수 해석 규칙(기본값·하한·정수 내림·상한).
 */
import { describeEnvNumberRange, EnvNumberAdjust, EnvNumberRule, parseEnvNumber } from './env-number';

const BATCH_RULE: EnvNumberRule = { def: 200, min: 1, max: 1000, integer: true };
const GRACE_RULE: EnvNumberRule = { def: 48, min: 1 };

describe('parseEnvNumber', () => {
  describe('정수·상한 규칙(def 200, 1~1000)', () => {
    it.each<[unknown, number, EnvNumberAdjust]>([
      [undefined, 200, 'default'],
      ['', 200, 'default'],
      ['abc', 200, 'default'],
      ['0', 200, 'default'],
      ['-5', 200, 'default'],
      ['0.5', 200, 'default'],
      ['1', 1, 'none'],
      ['1.5', 1, 'floored'],
      ['200', 200, 'none'],
      ['1000', 1000, 'none'],
      ['1001', 1000, 'clamped-max'],
      ['1e9', 1000, 'clamped-max'],
      ['1500.7', 1000, 'clamped-max'],
      ['Infinity', 200, 'default'],
      ['-Infinity', 200, 'default'],
      ['NaN', 200, 'default'],
      [' 24 ', 24, 'none'],
    ])('%j → %d (%s)', (raw, value, adjusted) => {
      expect(parseEnvNumber(raw, BATCH_RULE)).toEqual({ value, adjusted });
    });

    it('결과는 항상 1~1000 의 정수다', () => {
      const raws = ['', 'x', '-1', '0', '0.99', '1', '2.5', '999.9', '1000', '1000.1', '1e300', 'Infinity'];
      for (const raw of raws) {
        const { value } = parseEnvNumber(raw, BATCH_RULE);
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(1000);
      }
    });
  });

  describe('하한만 있는 규칙(def 48, 1 이상, 소수 허용)', () => {
    it.each<[unknown, number, EnvNumberAdjust]>([
      [undefined, 48, 'default'],
      ['', 48, 'default'],
      ['0', 48, 'default'],
      ['0.01', 48, 'default'],
      ['0.5', 48, 'default'],
      ['-1', 48, 'default'],
      ['abc', 48, 'default'],
      ['Infinity', 48, 'default'],
      ['1', 1, 'none'],
      ['1.5', 1.5, 'none'],
      ['48', 48, 'none'],
      ['720', 720, 'none'],
      ['1e6', 1e6, 'none'],
    ])('%j → %d (%s)', (raw, value, adjusted) => {
      expect(parseEnvNumber(raw, GRACE_RULE)).toEqual({ value, adjusted });
    });
  });

  describe('describeEnvNumberRange', () => {
    it.each<[EnvNumberRule, string]>([
      [BATCH_RULE, '1~1000, 정수'],
      [GRACE_RULE, '1 이상'],
      [{ def: 5, min: 2, integer: true }, '2 이상, 정수'],
      [{ def: 5, min: 1, max: 9 }, '1~9'],
    ])('%j → %s', (rule, text) => {
      expect(describeEnvNumberRange(rule)).toBe(text);
    });
  });
});
