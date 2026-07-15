import { axiosInstance } from '../lib/axios';

/**
 * S2-4 파트너 포털 v0 — SITE_ADMIN 셀프서브 API 클라이언트.
 *
 * /api/portal/sites/:siteId (JWT, SITE_ADMIN 전용 — 전역 admin 은 기존 sites.ts).
 * 응답 봉투 `{ success, data }` 를 벗겨 반환한다(operators.ts 패턴 준용).
 */

/** SITE_ADMIN 셀프 뷰 — 인증코드는 prefix 마스킹만(원문 미노출) */
export interface PortalSite {
  id: string;
  name: string;
  domain: string | null;
  returnUrlBase: string | null;
  uploadCallbackUrl: string | null;
  status: 'active' | 'suspended';
  retentionDays: number | null;
  allowedOrigins: string[] | null;
  frameAncestors: string[] | null;
  editorBundleUrl: string | null;
  editorCssUrl: string | null;
  editorVersion: string | null;
  editorAuthCodeMasked: string;
  workerAuthCodeMasked: string;
  createdAt: string;
  updatedAt: string;
}

/** PATCH 셀프 설정 — 이 2필드만 허용(그 외는 API 가 400) */
export interface UpdatePortalSiteRequest {
  allowedOrigins?: string[];
  uploadCallbackUrl?: string | null;
}

export type PartnerKeyStatus = 'active' | 'grace' | 'revoked';

/** 마스킹된 test 파트너 키 (prefix 만 — 원문은 발급 응답 1회) */
export interface PortalPartnerKey {
  id: string;
  siteId: string;
  env: 'test' | 'live';
  keyPrefix: string;
  name: string | null;
  status: PartnerKeyStatus;
  graceUntil: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 발급 응답 — key 원문은 이 응답에서만 1회 노출 */
export interface IssuedPortalPartnerKey {
  key: string;
  apiKey: PortalPartnerKey;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface KeyListResponse {
  items: PortalPartnerKey[];
  total: number;
}

export const portalApi = {
  async getSite(siteId: string): Promise<PortalSite> {
    const r = await axiosInstance.get<ApiResponse<PortalSite>>(
      `/portal/sites/${siteId}`,
    );
    return r.data.data;
  },

  async updateSite(
    siteId: string,
    dto: UpdatePortalSiteRequest,
  ): Promise<PortalSite> {
    const r = await axiosInstance.patch<ApiResponse<PortalSite>>(
      `/portal/sites/${siteId}`,
      dto,
    );
    return r.data.data;
  },

  async listTestKeys(siteId: string): Promise<PortalPartnerKey[]> {
    const r = await axiosInstance.get<ApiResponse<KeyListResponse>>(
      `/portal/sites/${siteId}/partner-keys`,
    );
    return r.data.data.items;
  },

  async issueTestKey(
    siteId: string,
    name?: string,
  ): Promise<IssuedPortalPartnerKey> {
    const r = await axiosInstance.post<ApiResponse<IssuedPortalPartnerKey>>(
      `/portal/sites/${siteId}/partner-keys`,
      name ? { name } : {},
    );
    return r.data.data;
  },

  async revokeTestKey(
    siteId: string,
    keyId: string,
  ): Promise<PortalPartnerKey> {
    const r = await axiosInstance.delete<ApiResponse<PortalPartnerKey>>(
      `/portal/sites/${siteId}/partner-keys/${keyId}`,
    );
    return r.data.data;
  },
};
