import { axiosInstance } from '../lib/axios';

export interface Site {
  id: string;
  name: string;
  domain: string | null;
  returnUrlBase: string | null;
  uploadCallbackUrl: string | null;
  editorAuthCode: string;
  workerAuthCode: string;
  status: 'active' | 'suspended';
  // Phase B — 사이트별 워커 옵션 default
  pdfConversionEnabled: boolean;
  beforeAfterUrl: string | null;
  defaultUnit: 'mm' | 'inch';
  checkWorkorder: boolean;
  checkCutting: boolean;
  checkSafezone: boolean;
  // Phase 1-1 (2026-05-16) — 외부 도메인 보안 정책
  allowedOrigins: string[] | null;
  frameAncestors: string[] | null;
  editorLaunchMode: 'inline';
  editorBundleUrl: string | null;
  editorCssUrl: string | null;
  editorVersion: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSiteDto {
  name: string;
  domain?: string;
  returnUrlBase?: string;
  uploadCallbackUrl?: string;
  editorAuthCode?: string;
  workerAuthCode?: string;
  status?: 'active' | 'suspended';
  pdfConversionEnabled?: boolean;
  beforeAfterUrl?: string;
  defaultUnit?: 'mm' | 'inch';
  checkWorkorder?: boolean;
  checkCutting?: boolean;
  checkSafezone?: boolean;
  // Phase 1-1 (2026-05-16)
  allowedOrigins?: string[];
  frameAncestors?: string[];
  editorLaunchMode?: 'inline';
  editorBundleUrl?: string;
  editorCssUrl?: string;
  editorVersion?: string;
}

export type UpdateSiteDto = Partial<CreateSiteDto>;

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ListResponse {
  items: Site[];
  total: number;
}

export const sitesApi = {
  async list(): Promise<Site[]> {
    const r = await axiosInstance.get<ApiResponse<ListResponse>>('/sites');
    return r.data.data.items;
  },

  async get(id: string): Promise<Site> {
    const r = await axiosInstance.get<ApiResponse<Site>>(`/sites/${id}`);
    return r.data.data;
  },

  async create(dto: CreateSiteDto): Promise<Site> {
    const r = await axiosInstance.post<ApiResponse<Site>>('/sites', dto);
    return r.data.data;
  },

  async update(id: string, dto: UpdateSiteDto): Promise<Site> {
    const r = await axiosInstance.put<ApiResponse<Site>>(`/sites/${id}`, dto);
    return r.data.data;
  },

  async regenerate(
    id: string,
    target: 'editor' | 'worker' | 'both' = 'both',
  ): Promise<Site> {
    const r = await axiosInstance.patch<ApiResponse<Site>>(
      `/sites/${id}/regenerate`,
      { target },
    );
    return r.data.data;
  },

  async remove(id: string): Promise<void> {
    await axiosInstance.delete(`/sites/${id}`);
  },
};
