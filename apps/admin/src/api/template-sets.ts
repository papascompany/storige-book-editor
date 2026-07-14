import { axiosInstance } from '../lib/axios';
import {
  TemplateSet,
  TemplateSetType,
  TemplateRef,
  CreateTemplateSetInput,
  UpdateTemplateSetInput,
  PaginatedResponse,
} from '@storige/types';

export interface TemplateSetQueryParams {
  type?: TemplateSetType;
  categoryId?: string;
  isDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * 방향 쌍 additive 필드 (2026-07-14) — template_sets 의
 * paired_template_set_id / is_orientation_default 컬럼. 공유 타입(@storige/types)
 * 반영은 API 트랙 소유라 admin 로컬 확장으로 둔다(값 없으면 기존 동작 그대로).
 */
export interface TemplateSetOrientationFields {
  /** 방향 쌍 상대 세트 id — null/undefined = 짝 없음 */
  pairedTemplateSetId?: string | null;
  /** 짝 중 기본 판형 여부 — 짝이 있으면 정확히 한쪽만 true */
  isOrientationDefault?: boolean;
}

export type TemplateSetWithOrientation = TemplateSet & TemplateSetOrientationFields;

export const templateSetsApi = {
  /**
   * 템플릿셋 목록 조회
   */
  getAll: async (params?: TemplateSetQueryParams): Promise<TemplateSetWithOrientation[]> => {
    const response = await axiosInstance.get<PaginatedResponse<TemplateSetWithOrientation>>('/template-sets', { params });
    return response.data.items;
  },

  /**
   * 템플릿셋 상세 조회
   */
  getById: async (id: string): Promise<TemplateSetWithOrientation> => {
    const response = await axiosInstance.get<TemplateSetWithOrientation>(`/template-sets/${id}`);
    return response.data;
  },

  /**
   * 템플릿셋 생성
   */
  create: async (data: CreateTemplateSetInput): Promise<TemplateSet> => {
    const response = await axiosInstance.post<TemplateSet>('/template-sets', data);
    return response.data;
  },

  /**
   * 템플릿셋 수정
   */
  update: async (id: string, data: UpdateTemplateSetInput): Promise<TemplateSet> => {
    const response = await axiosInstance.put<TemplateSet>(`/template-sets/${id}`, data);
    return response.data;
  },

  /**
   * 템플릿셋 삭제 (소프트 삭제)
   */
  delete: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/template-sets/${id}`);
  },

  /**
   * 템플릿셋 복제
   */
  copy: async (id: string): Promise<TemplateSet> => {
    const response = await axiosInstance.post<TemplateSet>(`/template-sets/${id}/copy`);
    return response.data;
  },

  /**
   * 템플릿 구성 수정 (순서 포함)
   */
  updateTemplates: async (id: string, templates: TemplateRef[]): Promise<TemplateSet> => {
    const response = await axiosInstance.put<TemplateSet>(
      `/template-sets/${id}/templates`,
      { templates }
    );
    return response.data;
  },

  /**
   * 템플릿 추가
   */
  addTemplate: async (
    id: string,
    templateId: string,
    required: boolean = false
  ): Promise<TemplateSet> => {
    const response = await axiosInstance.post<TemplateSet>(
      `/template-sets/${id}/templates`,
      { templateId, required }
    );
    return response.data;
  },

  /**
   * 템플릿 제거
   */
  removeTemplate: async (id: string, templateId: string): Promise<TemplateSet> => {
    const response = await axiosInstance.delete<TemplateSet>(
      `/template-sets/${id}/templates/${templateId}`
    );
    return response.data;
  },

  /**
   * 연결된 상품 목록 조회
   */
  getProducts: async (id: string): Promise<any[]> => {
    const response = await axiosInstance.get<any[]>(`/template-sets/${id}/products`);
    return response.data;
  },

  // ===== 방향 쌍 (2026-07-14) — API 트랙과 동결된 계약. 응답={ success, data } 봉투(신규 라우트 패밀리) =====

  /**
   * 방향 쌍 연결 — 대칭 저장(양쪽 상대 id, 서버 트랜잭션).
   * 서버가 같은 재단 규격의 정확 W↔H 스왑(±0.01mm)만 허용(정사각·자기자신 불가).
   */
  pair: async (id: string, pairedTemplateSetId: string): Promise<TemplateSetWithOrientation> => {
    const response = await axiosInstance.post<{ success: boolean; data: TemplateSetWithOrientation }>(
      `/template-sets/${id}/pair`,
      { pairedTemplateSetId }
    );
    return response.data.data;
  },

  /**
   * 방향 쌍 해제 — 양쪽 연결이 함께 해제된다.
   */
  unpair: async (id: string): Promise<TemplateSetWithOrientation> => {
    const response = await axiosInstance.delete<{ success: boolean; data: TemplateSetWithOrientation }>(
      `/template-sets/${id}/pair`
    );
    return response.data.data;
  },

  /**
   * 이 세트를 짝의 기본 판형으로 설정 — 반대쪽은 서버가 자동 해제(정확히 1개 유지).
   */
  setOrientationDefault: async (id: string): Promise<TemplateSetWithOrientation> => {
    const response = await axiosInstance.post<{ success: boolean; data: TemplateSetWithOrientation }>(
      `/template-sets/${id}/orientation-default`
    );
    return response.data.data;
  },

  /**
   * 반대 방향 세트 파생 생성 — 판형 W↔H 스왑 + 설정 복사, page류 템플릿만 비율 재배치 이월,
   * is_active=0(초안) 생성 즉시 원본과 페어링. 응답 = 새로 생성된 세트.
   */
  deriveOrientation: async (id: string): Promise<TemplateSetWithOrientation> => {
    const response = await axiosInstance.post<{ success: boolean; data: TemplateSetWithOrientation }>(
      `/template-sets/${id}/derive-orientation`
    );
    return response.data.data;
  },
};
