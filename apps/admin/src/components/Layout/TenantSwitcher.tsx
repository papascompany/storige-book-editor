import { useEffect, useMemo } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { Select, Tag, Tooltip } from 'antd';
import { GlobalOutlined } from '@ant-design/icons';
import { useAuthStore } from '../../stores/authStore';
import { isGlobalAdmin } from '../../utils/permissions';
import { sitesApi } from '../../api/sites';
import { portalApi } from '../../api/portal';

const ALL_SITES = '__ALL__';

/**
 * P3b 멀티테넌시 — 상단 헤더 테넌트 스위처.
 *
 * - 전역 admin(SUPER_ADMIN/ADMIN/MANAGER): 전체 site 드롭다운 + "전체 사이트" 옵션.
 *   선택값은 authStore.currentSiteId 로 저장되어 목록 페이지의 siteId 필터로 주입된다.
 * - 사이트 운영자(SITE_ADMIN/SITE_MANAGER): 배정 site 로 자동 고정.
 *   단일 배정이면 태그로 표시(전환 불가), 다중 배정이면 자기 site 간 전환 드롭다운.
 * - 서버가 권위: 이 컨트롤은 뷰 필터일 뿐, 격리는 API 의 TenantGuard/applySiteScope 가 강제.
 */
export const TenantSwitcher = () => {
  const { user, currentSiteId, setCurrentSiteId } = useAuthStore();

  const hasRole = !!user?.role;
  const global = hasRole && isGlobalAdmin(user?.role);
  const siteRoles = useMemo(() => user?.siteRoles ?? [], [user?.siteRoles]);
  const isOperator = hasRole && !global && siteRoles.length > 0;

  // 전역 admin — 전체 site 목록 (기존 GET /sites 재사용)
  const { data: sites = [] } = useQuery({
    queryKey: ['sites'],
    queryFn: () => sitesApi.list(),
    enabled: global,
  });

  // 사이트 운영자 — 배정 site 이름(portal 셀프 뷰, site 당 1회 캐시)
  const operatorSiteQueries = useQueries({
    queries: siteRoles.map((r) => ({
      queryKey: ['portal-site', r.siteId],
      queryFn: () => portalApi.getSite(r.siteId),
      enabled: isOperator,
      staleTime: 5 * 60 * 1000,
      retry: 0, // SITE_MANAGER 단독 배정 등 403 가능 — 이름 대신 id 폴백
    })),
  });

  // 운영자: currentSiteId 가 비었거나 배정 밖이면 첫 배정 site 로 자동 고정
  useEffect(() => {
    if (!isOperator) return;
    const allowed = siteRoles.map((r) => r.siteId);
    if (!currentSiteId || !allowed.includes(currentSiteId)) {
      setCurrentSiteId(allowed[0]);
    }
  }, [isOperator, siteRoles, currentSiteId, setCurrentSiteId]);

  if (!hasRole) return null;

  if (global) {
    return (
      <Select
        size="small"
        style={{ minWidth: 180 }}
        value={currentSiteId ?? ALL_SITES}
        onChange={(v) => setCurrentSiteId(v === ALL_SITES ? null : v)}
        options={[
          { value: ALL_SITES, label: '전체 사이트' },
          ...sites.map((s) => ({ value: s.id, label: s.name })),
        ]}
        popupMatchSelectWidth={false}
        aria-label="사이트 컨텍스트"
      />
    );
  }

  if (!isOperator) return null;

  const nameOf = (siteId: string) => {
    const idx = siteRoles.findIndex((r) => r.siteId === siteId);
    const loaded = idx >= 0 ? operatorSiteQueries[idx]?.data?.name : undefined;
    return loaded ?? `${siteId.slice(0, 8)}…`;
  };

  if (siteRoles.length === 1) {
    return (
      <Tooltip title="이 계정은 해당 사이트로 고정되어 있습니다">
        <Tag icon={<GlobalOutlined />} color="blue" style={{ marginRight: 0 }}>
          {nameOf(siteRoles[0].siteId)}
        </Tag>
      </Tooltip>
    );
  }

  return (
    <Select
      size="small"
      style={{ minWidth: 180 }}
      value={currentSiteId ?? siteRoles[0].siteId}
      onChange={(v) => setCurrentSiteId(v)}
      options={siteRoles.map((r) => ({
        value: r.siteId,
        label: nameOf(r.siteId),
      }))}
      popupMatchSelectWidth={false}
      aria-label="사이트 컨텍스트"
    />
  );
};
