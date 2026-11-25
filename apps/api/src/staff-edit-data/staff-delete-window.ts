import { ConflictException } from '@nestjs/common';

/**
 * 관리자 삭제 48시간 복구창 (2026-11-25).
 *
 * - 편집 데이터는 보관이 원칙이고 자동 삭제는 없다. 관리자가 편집데이터관리에서 골라 지운 세션만
 *   purge_after = 삭제 시각 + 48h 를 갖는다.
 * - purge_after 전: '삭제 리스트'에서 복구할 수 있다(복구하면 purge_after = NULL).
 * - purge_after 후: 복구 불가, StaffDeletePurgeService 가 세션·잡·버전 행과 그 세션만 쓰던 파일을 영구 삭제한다.
 * - 고객이 직접 지운 세션은 purge_after = NULL 이라 기한 없이 보관·복구된다.
 */
export const STAFF_DELETE_GRACE_HOURS = 48;

/** 한 번에 고를 수 있는 관리자 선택 삭제 상한 */
export const STAFF_BULK_DELETE_MAX = 100;

export function staffPurgeAfter(deletedAt: Date): Date {
  return new Date(deletedAt.getTime() + STAFF_DELETE_GRACE_HOURS * 60 * 60 * 1000);
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** 409 RESTORE_WINDOW_CLOSED { purgeAfter } — 관리자 삭제분의 복구 기한이 지났다 */
export function restoreWindowClosed(purgeAfter: Date | string | null): ConflictException {
  return new ConflictException({
    code: 'RESTORE_WINDOW_CLOSED',
    message: `복구 기한(${STAFF_DELETE_GRACE_HOURS}시간)이 지나 복구할 수 없습니다.`,
    purgeAfter: toIso(purgeAfter),
  });
}
