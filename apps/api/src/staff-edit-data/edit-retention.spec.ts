/**
 * 편집데이터 보관기간 계산(순수) — 2026-09-29.
 */
import { ConflictException } from '@nestjs/common';
import {
  assertWithinRetention,
  buildEditRetentionCutoffs,
  computeEditRetention,
  normalizeEditRetentionDays,
} from './edit-retention';

const DAY = 86_400_000;
const created = new Date('2026-09-01T00:00:00.000Z');
const member = { createdAt: created, isGuest: false, guestExpiresAt: null };

describe('computeEditRetention', () => {
  it.each([null, undefined, 0, -3, Number.NaN])('days=%p → unset(until null)', (days) => {
    const r = computeEditRetention(member, days as number | null, new Date('2030-01-01T00:00:00Z'));
    expect(r).toEqual({ days: null, until: null, state: 'unset', anchor: 'createdAt' });
  });

  it('N일: 경계 직전 active, 경계 시각 expired (created_at 기준)', () => {
    const until = new Date(created.getTime() + 30 * DAY);
    const before = computeEditRetention(member, 30, new Date(until.getTime() - 1));
    expect(before).toEqual({ days: 30, until: until.toISOString(), state: 'active', anchor: 'createdAt' });
    expect(computeEditRetention(member, 30, until).state).toBe('expired');
    expect(computeEditRetention(member, 30, new Date(until.getTime() + 1)).state).toBe('expired');
  });

  it('비회원 세션은 guestExpiresAt 이 상한', () => {
    const guestExpiresAt = new Date(created.getTime() + DAY);
    const guest = { createdAt: created, isGuest: true, guestExpiresAt };
    const r = computeEditRetention(guest, 365, new Date(created.getTime() + 2 * DAY));
    expect(r.until).toBe(guestExpiresAt.toISOString());
    expect(r.state).toBe('expired');
    expect(computeEditRetention(guest, 365, new Date(created.getTime() + 1000)).state).toBe('active');
    // 미설정 사이트의 비회원 세션도 24h 퍼지 시각까지만
    const unsetGuest = computeEditRetention(guest, null, new Date(created.getTime() + 2 * DAY));
    expect(unsetGuest.until).toBe(guestExpiresAt.toISOString());
    expect(unsetGuest.state).toBe('expired');
    // 보관기간이 더 짧으면 보관기간이 상한
    const shortGuest = { createdAt: created, isGuest: true, guestExpiresAt: new Date(created.getTime() + 10 * DAY) };
    expect(computeEditRetention(shortGuest, 1, new Date(created.getTime() + 2 * DAY)).until).toBe(
      new Date(created.getTime() + DAY).toISOString(),
    );
  });

  it('문자열 날짜 입력도 처리', () => {
    const r = computeEditRetention(
      { createdAt: created.toISOString(), isGuest: false, guestExpiresAt: null },
      1,
      new Date(created.getTime() + 1000),
    );
    expect(r.state).toBe('active');
  });
});

describe('assertWithinRetention', () => {
  it('expired → 409 EDIT_RETENTION_EXPIRED { retentionUntil }', () => {
    const r = computeEditRetention(member, 1, new Date(created.getTime() + 2 * DAY));
    let caught: unknown;
    try {
      assertWithinRetention(r);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toEqual({
      code: 'EDIT_RETENTION_EXPIRED',
      message: '편집데이터 보관기간이 지났습니다.',
      retentionUntil: r.until,
    });
  });

  it('active·unset → 통과', () => {
    expect(() => assertWithinRetention(computeEditRetention(member, null))).not.toThrow();
    expect(() => assertWithinRetention(computeEditRetention(member, 3650, created))).not.toThrow();
  });
});

describe('normalizeEditRetentionDays · buildEditRetentionCutoffs', () => {
  it('정수 1 이상만 유효', () => {
    expect(normalizeEditRetentionDays(7)).toBe(7);
    expect(normalizeEditRetentionDays('14')).toBe(14);
    expect(normalizeEditRetentionDays(0)).toBeNull();
    expect(normalizeEditRetentionDays(null)).toBeNull();
    expect(normalizeEditRetentionDays('x')).toBeNull();
  });

  it('보호 사이트만 cutoff = now − N일', () => {
    const now = new Date('2026-09-29T00:00:00Z');
    const out = buildEditRetentionCutoffs(
      [
        { id: 's1', days: 10 },
        { id: 's2', days: null },
        { id: 's3', days: 0 },
        { id: '', days: 5 },
      ],
      now,
    );
    expect(out).toEqual([{ siteId: 's1', cutoff: new Date(now.getTime() - 10 * DAY) }]);
  });
});
