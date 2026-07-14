import { axiosInstance } from '../lib/axios';

/**
 * 판형 프리셋(format_presets) API 클라이언트.
 *
 * - 프리셋은 저작측 정본(값 복사 주입) — templateSet/템플릿에 presetId 를 저장하지 않는다(무스키마).
 * - 세로형 기준 1행 저장: trimWidthMm ≤ trimHeightMm 가 원칙, 가로형은 표시/주입 시 W↔H 스왑.
 * - 삭제 정책: 하드 삭제 금지(멱등 시드 부활 충돌) — isActive 소프트 토글만(delete 메서드 없음).
 * - 응답 봉투 `{ success, data }` 를 벗겨 반환한다(operators.ts 신형 계약 패턴).
 */

export interface FormatPreset {
  id: string;
  /** 시드 코드(UNIQUE) — 예: a4, a5, b5, baepan46, jeol16, b6, square210 */
  code: string;
  name: string;
  /** 재단 가로(mm) — 세로형 기준 저장 */
  trimWidthMm: number;
  /** 재단 세로(mm) — 세로형 기준 저장 */
  trimHeightMm: number;
  /** 사방 도련(mm) — 작업 = 재단 + 2×bleed */
  bleedMm: number;
  sortOrder: number;
  isActive: boolean;
  /** null = 전역 프리셋 */
  siteId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateFormatPresetRequest {
  code: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  sortOrder: number;
  isActive?: boolean;
}

export type UpdateFormatPresetRequest = Partial<CreateFormatPresetRequest>;

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ListResponse {
  items: FormatPreset[];
  total: number;
}

export const formatPresetsApi = {
  /** 전체 목록(비활성 포함) — 픽커는 isActive 만 필터해 사용. */
  async list(): Promise<FormatPreset[]> {
    const r = await axiosInstance.get<ApiResponse<ListResponse>>('/format-presets');
    return r.data.data.items;
  },

  async create(data: CreateFormatPresetRequest): Promise<FormatPreset> {
    const r = await axiosInstance.post<ApiResponse<FormatPreset>>('/format-presets', data);
    return r.data.data;
  },

  async update(id: string, data: UpdateFormatPresetRequest): Promise<FormatPreset> {
    const r = await axiosInstance.patch<ApiResponse<FormatPreset>>(`/format-presets/${id}`, data);
    return r.data.data;
  },
};
