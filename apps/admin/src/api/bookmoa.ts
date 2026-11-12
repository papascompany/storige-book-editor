import { axiosInstance } from '../lib/axios';

export interface BookmoaCategory {
  sortcode: string;
  name: string;
  depth: number;
  parentSortcode: string | null;
}

export interface CategoriesResponse {
  categories: BookmoaCategory[];
  total: number;
}

export interface CategoriesQueryParams {
  search?: string;
  depth?: number;
  parent?: string;
  limit?: number;
}

export const bookmoaApi = {
  /**
   * 파트너 쇼핑몰 카테고리 목록 조회
   */
  getCategories: async (params?: CategoriesQueryParams): Promise<CategoriesResponse> => {
    const response = await axiosInstance.get<CategoriesResponse>('/bookmoa/categories', {
      params,
    });
    return response.data;
  },
};
