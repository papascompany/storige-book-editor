import { axiosInstance } from '../lib/axios';

/**
 * P3a 멀티테넌시 — 운영자(SITE_ADMIN/SITE_MANAGER) 관리 API 클라이언트.
 *
 * 전역 admin(JWT, role=ADMIN) 전용. 응답 봉투 `{ success, data }` 를 벗겨 반환한다.
 * sites.ts 패턴 그대로(interface + xxxApi 객체 + axiosInstance).
 */

/** 운영자 역할 — 사이트 단위 역할만 발급. */
export type OperatorRole = 'SITE_ADMIN' | 'SITE_MANAGER';

/** 한 운영자의 사이트별 배정 1건. */
export interface OperatorAssignment {
  siteId: string;
  siteName: string;
  role: OperatorRole;
}

export interface Operator {
  id: string;
  email: string;
  role: OperatorRole;
  createdAt: string;
  assignments: OperatorAssignment[];
}

export interface CreateOperatorRequest {
  email: string;
  password: string;
  role: OperatorRole;
  siteId: string;
}

export interface AddAssignmentRequest {
  siteId: string;
  role: OperatorRole;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

interface ListResponse {
  items: Operator[];
  total: number;
}

export const operatorsApi = {
  async list(siteId?: string): Promise<Operator[]> {
    const r = await axiosInstance.get<ApiResponse<ListResponse>>('/operators', {
      params: siteId ? { siteId } : undefined,
    });
    return r.data.data.items;
  },

  async create(data: CreateOperatorRequest): Promise<Operator> {
    const r = await axiosInstance.post<ApiResponse<Operator>>('/operators', data);
    return r.data.data;
  },

  async addAssignment(
    userId: string,
    data: AddAssignmentRequest,
  ): Promise<Operator> {
    const r = await axiosInstance.post<ApiResponse<Operator>>(
      `/operators/${userId}/assignments`,
      data,
    );
    return r.data.data;
  },

  async removeAssignment(userId: string, siteId: string): Promise<Operator> {
    const r = await axiosInstance.delete<ApiResponse<Operator>>(
      `/operators/${userId}/assignments/${siteId}`,
    );
    return r.data.data;
  },

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    await axiosInstance.patch(`/operators/${userId}/password`, { newPassword });
  },

  async remove(userId: string): Promise<void> {
    await axiosInstance.delete(`/operators/${userId}`);
  },
};
