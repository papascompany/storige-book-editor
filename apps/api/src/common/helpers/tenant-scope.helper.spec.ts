import { getTenantScope, applySiteScope } from './tenant-scope.helper';
import { UserRole } from '@storige/types';

/**
 * P2b 멀티테넌시 — 테넌트 스코프 헬퍼 단위테스트.
 * DB 없이 getTenantScope(순수함수) + applySiteScope(QueryBuilder 호출 기록 mock)를 검증.
 */
describe('tenant-scope.helper', () => {
  describe('getTenantScope', () => {
    it('SUPER_ADMIN → 전역(필터 없음)', () => {
      expect(getTenantScope({ role: UserRole.SUPER_ADMIN })).toEqual({
        isGlobal: true,
        siteIds: [],
      });
    });

    it('ADMIN → 전역', () => {
      expect(getTenantScope({ role: UserRole.ADMIN })).toEqual({
        isGlobal: true,
        siteIds: [],
      });
    });

    it('MANAGER → 전역 (P2b 수정: 전역 매니저, 빈 결과 회귀 방지)', () => {
      expect(getTenantScope({ role: UserRole.MANAGER })).toEqual({
        isGlobal: true,
        siteIds: [],
      });
    });

    it('shop/api-key 토큰(siteId) → 자기 site 로 스코프', () => {
      expect(getTenantScope({ role: 'customer', siteId: 'site-1' })).toEqual({
        isGlobal: false,
        siteIds: ['site-1'],
      });
    });

    it('SITE_ADMIN(siteRoles) → siteRoles 의 site 들로 스코프', () => {
      expect(
        getTenantScope({
          role: UserRole.SITE_ADMIN,
          siteRoles: [{ siteId: 'a' }, { siteId: 'b' }],
        }),
      ).toEqual({ isGlobal: false, siteIds: ['a', 'b'] });
    });

    it('req.user 없음(@Public) → 비전역·빈 siteIds', () => {
      expect(getTenantScope(undefined)).toEqual({ isGlobal: false, siteIds: [] });
    });
  });

  describe('applySiteScope', () => {
    function mockQb() {
      const calls: { sql: string; params?: Record<string, unknown> }[] = [];
      const qb: any = {
        calls,
        andWhere: (sql: string, params?: Record<string, unknown>) => {
          calls.push({ sql, params });
          return qb;
        },
      };
      return qb;
    }

    it('전역 → andWhere 미호출(필터 없음)', () => {
      const qb = mockQb();
      applySiteScope(qb, 'template', { isGlobal: true, siteIds: [] });
      expect(qb.calls).toHaveLength(0);
    });

    it('스코프 includeNull=true → IN(...) OR IS NULL', () => {
      const qb = mockQb();
      applySiteScope(
        qb,
        'template',
        { isGlobal: false, siteIds: ['s1'] },
        { includeNull: true },
      );
      expect(qb.calls).toHaveLength(1);
      expect(qb.calls[0].sql).toContain('template.siteId IN');
      expect(qb.calls[0].sql).toContain('IS NULL');
      expect(qb.calls[0].params).toEqual({ tenantSiteIds_template: ['s1'] });
    });

    it('스코프 includeNull=false(기본) → IN(...) 만(누수방지)', () => {
      const qb = mockQb();
      applySiteScope(qb, 'product', { isGlobal: false, siteIds: ['s1'] });
      expect(qb.calls[0].sql).toContain('product.siteId IN');
      expect(qb.calls[0].sql).not.toContain('IS NULL');
    });

    it('빈 siteIds + includeNull=true → IS NULL 만(시스템공유)', () => {
      const qb = mockQb();
      applySiteScope(
        qb,
        'template',
        { isGlobal: false, siteIds: [] },
        { includeNull: true },
      );
      expect(qb.calls[0].sql).toContain('template.siteId IS NULL');
    });

    it('빈 siteIds + includeNull=false → 1 = 0(빈 결과, 누수방지)', () => {
      const qb = mockQb();
      applySiteScope(qb, 'product', { isGlobal: false, siteIds: [] });
      expect(qb.calls[0].sql).toContain('1 = 0');
    });
  });
});
