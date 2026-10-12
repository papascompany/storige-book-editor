/**
 * 수치형 환경 변수 해석 규칙.
 *
 * 값은 `Number(raw)` 로 읽는다(빈 문자열은 0, 앞뒤 공백은 무시). 그 뒤
 *  - 유한한 숫자가 아니거나 `min` 미만이면 `def`
 *  - `integer` 규칙이면 소수를 내림
 *  - `max` 를 넘으면 `max`
 * 를 적용한다. 결과가 원래 값과 다르면 `adjusted` 로 이유를 알린다(로그는 호출부가 남긴다).
 */
export interface EnvNumberRule {
  readonly def: number;
  readonly min: number;
  readonly max?: number;
  readonly integer?: boolean;
}

export type EnvNumberAdjust = 'none' | 'default' | 'floored' | 'clamped-max';

export interface EnvNumberResult {
  readonly value: number;
  readonly adjusted: EnvNumberAdjust;
}

export function parseEnvNumber(raw: unknown, r: EnvNumberRule): EnvNumberResult {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < r.min) return { value: r.def, adjusted: 'default' };
  let v = n;
  let adjusted: EnvNumberAdjust = 'none';
  if (r.integer && !Number.isInteger(v)) {
    v = Math.floor(v);
    adjusted = 'floored';
  }
  if (r.max !== undefined && v > r.max) {
    v = r.max;
    adjusted = 'clamped-max';
  }
  return { value: v, adjusted };
}

/** 로그용 허용 범위 표기 — 예: `1~1000, 정수`, `1 이상`. 원래 값은 넣지 않는다. */
export function describeEnvNumberRange(r: EnvNumberRule): string {
  const range = r.max !== undefined ? `${r.min}~${r.max}` : `${r.min} 이상`;
  return r.integer ? `${range}, 정수` : range;
}
