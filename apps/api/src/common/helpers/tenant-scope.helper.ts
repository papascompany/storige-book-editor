import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { UserRole } from '@storige/types';

/**
 * P1 멀티테넌시 (2026-06-17) — 테넌트(site) 쿼리 스코핑 헬퍼.
 *
 * site-scoped 엔티티 조회에 `WHERE site_id IN (...허용 site) [OR site_id IS NULL(시스템공유)]`
 * 를 자동으로 주입해, service 마다 수동 필터를 작성하다 누락하는 위험을 제거한다.
 * (TenantGuard 가 "명시 site 권한"을 막는다면, 이 헬퍼는 "목록 조회를 자기 site 로 제한"한다.)
 *
 * 정책:
 * - 전역 관리자(SUPER_ADMIN/ADMIN): 필터 없음(모든 site).  ← dual-mode, 기존 admin 무변경.
 * - 외부 shop/api-key(user.siteId): 자기 site 로 제한.
 * - 사이트 운영자(SITE_ADMIN/SITE_MANAGER): JWT siteRoles 의 site 들 + (옵션) 시스템공유(NULL).
 */
export interface TenantScope {
  /** true 면 전역(필터 미적용) */
  isGlobal: boolean;
  /** 허용 site id 목록(전역이 아닐 때) */
  siteIds: string[];
}

/** req.user(또는 shop/api-key user)로부터 테넌트 스코프를 도출한다. */
export function getTenantScope(user: unknown): TenantScope {
  const u = (user ?? {}) as {
    role?: string;
    siteId?: string;
    siteRoles?: Array<{ siteId: string }>;
  };
  // 전역 관리자 역할(레거시 단일테넌트 admin 포함): SUPER_ADMIN/ADMIN/MANAGER → 필터 없음.
  // ⚠️ MANAGER 는 사이트 역할(SITE_MANAGER)이 아닌 '전역 매니저' → 전역 취급.
  //    (누락 시 MANAGER 가 siteIds=[] 로 떨어져 목록이 빈 결과가 되는 회귀를 방지.)
  if (
    u.role === UserRole.SUPER_ADMIN ||
    u.role === UserRole.ADMIN ||
    u.role === UserRole.MANAGER
  ) {
    return { isGlobal: true, siteIds: [] };
  }
  // 외부 shop-session / api-key 인증 — site 가 토큰/키로 고정
  if (u.siteId) {
    return { isGlobal: false, siteIds: [u.siteId] };
  }
  // 사이트 운영자 — siteRoles 클레임
  const siteIds = Array.isArray(u.siteRoles)
    ? u.siteRoles.map((r) => r.siteId).filter(Boolean)
    : [];
  return { isGlobal: false, siteIds };
}

/**
 * QueryBuilder 에 site 스코프를 적용한다.
 * @param includeNull 시스템공유(site_id IS NULL) 리소스도 포함할지.
 *   **기본 false(안전 우선)** — 주문/파일 같은 소유 리소스는 자기 site 만 보이게.
 *   템플릿/라이브러리처럼 시스템공유를 함께 노출해야 하는 경우에만 **명시적으로 true** 전달.
 *   (적대검증 반영: 기본 true 이면 includeNull 누락 시 다른 테넌트의 NULL 데이터가 새는 위험.)
 */
export function applySiteScope<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  scope: TenantScope,
  options: { includeNull?: boolean } = {},
): SelectQueryBuilder<T> {
  const includeNull = options.includeNull ?? false;

  // 전역 관리자 — 필터 없음
  if (scope.isGlobal) return qb;

  // 허용 site 가 하나도 없는 운영자 — 시스템공유만(includeNull) 또는 빈 결과
  if (scope.siteIds.length === 0) {
    return includeNull
      ? qb.andWhere(`${alias}.siteId IS NULL`)
      : qb.andWhere('1 = 0');
  }

  // 파라미터 충돌 방지를 위해 alias 로 네임스페이싱
  const param = `tenantSiteIds_${alias}`;
  if (includeNull) {
    qb.andWhere(
      `(${alias}.siteId IN (:...${param}) OR ${alias}.siteId IS NULL)`,
      { [param]: scope.siteIds },
    );
  } else {
    qb.andWhere(`${alias}.siteId IN (:...${param})`, {
      [param]: scope.siteIds,
    });
  }
  return qb;
}

/**
 * P3b 멀티테넌시 (2026-08-04) — 단건 행에 대한 테넌트 소유권 단정 (mutation/상세 가드).
 *
 * TenantGuard 는 요청에 **명시된** siteId(param/query/body)만 검증한다. `PUT /template-sets/:id`
 * 처럼 리소스 id 로 접근하는 라우트는 행을 로드한 뒤 이 함수로 소유권을 강제해야
 * 크로스 테넌트 변조(IDOR)가 막힌다.
 *
 * 정책:
 * - 전역(SUPER_ADMIN/ADMIN/MANAGER): 통과.
 * - 행 siteId ∈ scope.siteIds: 통과.
 * - 행 siteId == NULL(시스템 공유): **기본 거부** — 사이트 운영자는 공유 리소스를 읽을 수는
 *   있어도(목록 includeNull) 변조할 수는 없다. 읽기 상세처럼 공유 열람을 허용해야 하면
 *   `allowNull: true` 를 명시.
 */
export function assertSiteInScope(
  scope: TenantScope,
  rowSiteId: string | null | undefined,
  options: { allowNull?: boolean } = {},
): void {
  if (scope.isGlobal) return;
  if (rowSiteId == null) {
    if (options.allowNull) return;
    throw new ForbiddenException({
      code: 'TENANT_FORBIDDEN',
      message: '시스템 공유 리소스는 사이트 운영자가 수정할 수 없습니다.',
    });
  }
  if (scope.siteIds.includes(rowSiteId)) return;
  throw new ForbiddenException({
    code: 'TENANT_FORBIDDEN',
    message: '이 사이트에 대한 권한이 없습니다.',
  });
}

/**
 * P3b 멀티테넌시 (2026-08-04) — 생성 시 저장할 siteId 확정.
 *
 * - 전역: 요청값 그대로(미지정이면 null = 시스템 공유, 기존 admin 동작 무변경).
 * - 사이트 운영자: 요청값이 있으면 자기 site 인지 검증, 없으면 단일 배정 site 로 강제.
 *   다중 배정인데 미지정이면 400 (어느 site 소유인지 모호 — NULL 공유 생성은 금지).
 */
export function resolveScopedSiteId(
  scope: TenantScope,
  requestedSiteId?: string | null,
): string | null {
  if (scope.isGlobal) return requestedSiteId ?? null;
  if (requestedSiteId) {
    assertSiteInScope(scope, requestedSiteId);
    return requestedSiteId;
  }
  if (scope.siteIds.length === 1) return scope.siteIds[0];
  throw new BadRequestException({
    code: 'SITE_ID_REQUIRED',
    message: '여러 사이트를 운영 중입니다. siteId 를 지정하세요.',
  });
}
