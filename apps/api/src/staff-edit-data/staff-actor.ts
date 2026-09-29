import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { UserRole } from '@storige/types';
import type { UserSiteRole } from '../auth/entities/user-site-role.entity';
import type { TenantScope } from '../common/helpers/tenant-scope.helper';

/**
 * Storige 관리자(staff) 호출자 판정 (2026-09-29, ADDITIVE) — /admin/edit-data 전용.
 *
 *  - admin-app JWT 사용자만: `source` 없음 + 문자열 `id` + 정확한 UserRole 값의 `role`.
 *    shop-session(source 'shop')·운영자 토큰(source 'partner_operator')·API 키 사용자는 403.
 *  - 전역: SUPER_ADMIN | ADMIN | MANAGER (getTenantScope 와 동일).
 *  - SITE_ADMIN | SITE_MANAGER: 사이트 역할을 **매 호출 DB(user_site_roles)에서** 다시 읽는다.
 *    JWT 의 siteRoles 스냅샷은 쓰지 않는다(강등·배정 해제 즉시 반영).
 *  - 삭제·복구·삭제 권한 발급(canDeleteFor): 전역 또는 그 사이트 행의 역할이 SITE_ADMIN.
 *    users.role 이 아니라 사이트별 행의 역할을 쓴다.
 */

export type StaffSiteRole = 'SITE_ADMIN' | 'SITE_MANAGER';

export interface StaffActor {
  userId: string;
  role: UserRole;
  global: boolean;
  /** 사이트 운영자의 사이트별 역할(DB 행). 전역 관리자는 빈 Map. */
  siteRoles: Map<string, StaffSiteRole>;
}

const GLOBAL_ROLES: ReadonlySet<string> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
]);
const SITE_ROLES: ReadonlySet<string> = new Set([UserRole.SITE_ADMIN, UserRole.SITE_MANAGER]);
const ALL_ROLES: ReadonlySet<string> = new Set(Object.values(UserRole));

export function staffRoleRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'STAFF_ROLE_REQUIRED',
    message: 'Storige 관리자만 사용할 수 있습니다.',
  });
}

export function staffDeleteNotAllowed(): ForbiddenException {
  return new ForbiddenException({
    code: 'STAFF_DELETE_NOT_ALLOWED',
    message: '삭제 권한이 없습니다.',
  });
}

export function staffAuditUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STAFF_AUDIT_UNAVAILABLE',
    message: '감사 기록을 저장할 수 없어 작업을 중단했습니다.',
  });
}

export function staffBaselineUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'STAFF_BASELINE_UNAVAILABLE',
    message: '편집 전 스냅샷을 저장할 수 없어 작업을 중단했습니다.',
  });
}

export function staffSessionNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'SESSION_NOT_FOUND',
    message: '편집 세션을 찾을 수 없습니다.',
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * admin-app JWT 사용자(User 엔티티)인가 — `source` 없음 + 문자열 id + 정확한 UserRole 값.
 * shop-session(role 'customer' 소문자, source 'shop')·운영자 토큰은 false.
 */
export function isAdminAppUser(user: unknown): user is { id: string; role: UserRole } {
  if (!isRecord(user)) return false;
  if (user.source !== undefined && user.source !== null) return false;
  if (typeof user.id !== 'string' || user.id.length === 0) return false;
  return typeof user.role === 'string' && ALL_ROLES.has(user.role);
}

export async function resolveStaffActor(
  user: unknown,
  userSiteRoleRepo: Pick<Repository<UserSiteRole>, 'find'>,
): Promise<StaffActor> {
  if (!isAdminAppUser(user)) throw staffRoleRequired();
  const role = user.role;
  if (GLOBAL_ROLES.has(role)) {
    return { userId: user.id, role, global: true, siteRoles: new Map() };
  }
  if (!SITE_ROLES.has(role)) throw staffRoleRequired();

  const rows = await userSiteRoleRepo.find({
    where: { userId: user.id },
    select: ['siteId', 'role'],
  });
  const siteRoles = new Map<string, StaffSiteRole>();
  for (const r of rows) {
    if (typeof r.siteId !== 'string' || r.siteId.length === 0) continue;
    if (r.role === UserRole.SITE_ADMIN) siteRoles.set(r.siteId, 'SITE_ADMIN');
    else if (r.role === UserRole.SITE_MANAGER) siteRoles.set(r.siteId, 'SITE_MANAGER');
  }
  return { userId: user.id, role, global: false, siteRoles };
}

/** 사이트 범위 — 전역은 NULL-site 포함 전부, 사이트 운영자는 DB 행의 사이트만(NULL-site 제외) */
export function actorCanSeeSite(actor: StaffActor, siteId: string | null | undefined): boolean {
  if (actor.global) return true;
  if (typeof siteId !== 'string' || siteId.length === 0) return false;
  return actor.siteRoles.has(siteId);
}

export function canDeleteFor(actor: StaffActor, siteId: string | null | undefined): boolean {
  if (actor.global) return true;
  if (typeof siteId !== 'string' || siteId.length === 0) return false;
  return actor.siteRoles.get(siteId) === 'SITE_ADMIN';
}

export function actorSiteIds(actor: StaffActor): string[] {
  return Array.from(actor.siteRoles.keys());
}

/** applySiteScope 용 — DB 행에서 만든 범위(JWT 스냅샷 아님) */
export function actorTenantScope(actor: StaffActor): TenantScope {
  return actor.global ? { isGlobal: true, siteIds: [] } : { isGlobal: false, siteIds: actorSiteIds(actor) };
}
