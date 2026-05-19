import { axiosInstance } from '../lib/axios';

export interface ProductTemplateSet {
  id: string;
  sortcode: string;
  categoryName: string | null;
  prdtStanSeqno: number | null;
  templateSetId: string;
  displayOrder: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  templateSet?: {
    id: string;
    name: string;
    type: string;
    width: number;
    height: number;
    thumbnailUrl: string | null;
    // 인쇄 워크플로우 v1 Phase 3 (2026-05-19)
    endpaperConfig?: {
      frontCount: number;
      backCount: number;
      frontEditable: boolean;
      backEditable: boolean;
    } | null;
    coverEditable?: boolean;
    coverPreviewImage?: string | null;
  };
}

export interface ProductTemplateSetListResponse {
  items: ProductTemplateSet[];
  total: number;
  page: number;
  limit: number;
}

export interface ProductTemplateSetQueryParams {
  sortcode?: string;
  templateSetId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export interface CreateProductTemplateSetInput {
  sortcode: string;
  prdtStanSeqno?: number;
  templateSetId: string;
  displayOrder?: number;
  isDefault?: boolean;
}

export interface UpdateProductTemplateSetInput {
  displayOrder?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface BulkCreateInput {
  sortcode: string;
  prdtStanSeqno?: number;
  templateSetIds: string[];
}

export const productTemplateSetsApi = {
  /**
   * 연결 목록 조회
   */
  getAll: async (params?: ProductTemplateSetQueryParams): Promise<ProductTemplateSetListResponse> => {
    const response = await axiosInstance.get<ProductTemplateSetListResponse>(
      '/product-template-sets',
      { params }
    );
    return response.data;
  },

  /**
   * 연결 상세 조회
   */
  getById: async (id: string): Promise<ProductTemplateSet> => {
    const response = await axiosInstance.get<ProductTemplateSet>(
      `/product-template-sets/${id}`
    );
    return response.data;
  },

  /**
   * 연결 생성
   */
  create: async (data: CreateProductTemplateSetInput): Promise<ProductTemplateSet> => {
    const response = await axiosInstance.post<ProductTemplateSet>(
      '/product-template-sets',
      data
    );
    return response.data;
  },

  /**
   * 일괄 연결
   */
  bulkCreate: async (data: BulkCreateInput): Promise<ProductTemplateSet[]> => {
    const response = await axiosInstance.post<ProductTemplateSet[]>(
      '/product-template-sets/bulk',
      data
    );
    return response.data;
  },

  /**
   * 연결 수정
   */
  update: async (id: string, data: UpdateProductTemplateSetInput): Promise<ProductTemplateSet> => {
    const response = await axiosInstance.patch<ProductTemplateSet>(
      `/product-template-sets/${id}`,
      data
    );
    return response.data;
  },

  /**
   * 연결 삭제
   */
  delete: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/product-template-sets/${id}`);
  },
};
