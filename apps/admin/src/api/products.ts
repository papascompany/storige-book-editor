import { axiosInstance } from '../lib/axios';

export interface Product {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  templateSetId?: string;
  templateSet?: any;
  price: number;
  isActive: boolean;
  /** 외부 쇼핑몰이 width/height URL 파라미터로 사이즈 override 허용 (옵션 C) */
  allowCustomSize?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductDto {
  name: string;
  code: string;
  categoryId: string;
  templateSetId?: string;
  price: number;
  isActive?: boolean;
  allowCustomSize?: boolean;
}

export interface UpdateProductDto {
  name?: string;
  code?: string;
  categoryId?: string;
  templateSetId?: string;
  price?: number;
  isActive?: boolean;
  allowCustomSize?: boolean;
}

export interface ProductQueryParams {
  categoryId?: string;
  isActive?: boolean;
  hasTemplateSet?: boolean;
  page?: number;
  pageSize?: number;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export const productsApi = {
  /**
   * 상품 목록 조회
   */
  getAll: async (params?: ProductQueryParams): Promise<Product[]> => {
    const response = await axiosInstance.get<PaginatedResponse<Product>>('/products', { params });
    // API returns { success, data: { items, total, page, pageSize, totalPages } }
    const payload = response.data;
    if (payload && typeof payload === 'object' && 'data' in payload && Array.isArray((payload as any).data?.items)) {
      return (payload as any).data.items as Product[];
    }
    // Fallback: if server returns a plain array directly
    return Array.isArray(payload) ? (payload as unknown as Product[]) : [];
  },

  /**
   * 상품 상세 조회
   */
  getById: async (id: string): Promise<Product> => {
    const response = await axiosInstance.get<Product>(`/products/${id}`);
    return response.data;
  },

  /**
   * 상품 생성
   */
  create: async (data: CreateProductDto): Promise<Product> => {
    const response = await axiosInstance.post<Product>('/products', data);
    return response.data;
  },

  /**
   * 상품 수정
   */
  update: async (id: string, data: UpdateProductDto): Promise<Product> => {
    const response = await axiosInstance.put<Product>(`/products/${id}`, data);
    return response.data;
  },

  /**
   * 상품 삭제
   */
  delete: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/products/${id}`);
  },

  /**
   * 템플릿셋 연결
   */
  linkTemplateSet: async (id: string, templateSetId: string): Promise<Product> => {
    const response = await axiosInstance.put<Product>(`/products/${id}/template-set`, {
      templateSetId,
    });
    return response.data;
  },

  /**
   * 템플릿셋 연결 해제
   */
  unlinkTemplateSet: async (id: string): Promise<Product> => {
    const response = await axiosInstance.delete<Product>(`/products/${id}/template-set`);
    return response.data;
  },
};
