/**
 * calendar/data/index.ts — 정적 날짜 데이터 레지스트리 (P1, 2026-10-17)
 *
 * 버전 키는 `@storige/types` `CALENDAR_DATA_VERSIONS` 와 같아야 한다. 새 버전은
 * `scripts/gen-calendar-data.mjs` 로 생성한 모듈을 여기 등록하고 오너 승인 후 릴리스한다.
 */
import type { CalendarData } from '../types';
import { CALENDAR_DATA_KR_2025_2035_V1 } from './kr-2025-2035-v1';

export { CALENDAR_DATA_KR_2025_2035_V1 } from './kr-2025-2035-v1';

export const DEFAULT_CALENDAR_DATA_VERSION = 'kr-2025-2035-v1';

const REGISTRY: Readonly<Record<string, CalendarData>> = {
  [CALENDAR_DATA_KR_2025_2035_V1.version]: CALENDAR_DATA_KR_2025_2035_V1,
};

/** 버전 키 → 데이터. 없으면 null */
export function getCalendarData(version: string): CalendarData | null {
  if (typeof version !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(REGISTRY, version) ? REGISTRY[version] : null;
}

export function listCalendarDataVersions(): string[] {
  return Object.keys(REGISTRY);
}
