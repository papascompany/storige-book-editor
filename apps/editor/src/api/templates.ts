import { apiClient } from './client';
import type { CanvasData, TemplateType, TemplateSetType, TemplateRef, PaginatedResponse, SpreadConfig } from '@storige/types';

export interface Template {
  id: string;
  name: string;
  categoryId?: string;
  type?: TemplateType;
  width?: number;
  height?: number;
  thumbnailUrl: string | null;
  canvasData: CanvasData;
  spreadConfig?: SpreadConfig | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSet {
  id: string;
  name: string;
  thumbnailUrl: string | null;
  type: TemplateSetType;
  width: number;
  height: number;
  canAddPage: boolean;
  pageCountRange: number[];
  /** S8: 내지 페이지 증감 단위 (null=제약 없음) */
  pageStep?: number | null;
  templates: TemplateRef[];
  categoryId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateDto {
  name: string;
  categoryId?: string;
  type?: TemplateType | string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  canvasData: CanvasData;
  spreadConfig?: SpreadConfig;
  isActive?: boolean;
}

export interface UpdateTemplateDto {
  name?: string;
  categoryId?: string;
  type?: TemplateType | string;
  width?: number;
  height?: number;
  thumbnailUrl?: string;
  canvasData?: CanvasData;
  spreadConfig?: SpreadConfig;
  isActive?: boolean;
}

export interface Category {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  level: number;
  children?: Category[];
}

export const templatesApi = {
  /**
   * Get all templates
   */
  getTemplates: async (params?: {
    categoryId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) => {
    const response = await apiClient.get<Template[]>('/templates', { params });
    return response.data;
  },

  /**
   * Get template by ID
   */
  getTemplate: async (id: string) => {
    const response = await apiClient.get<Template>(`/templates/${id}`);
    return response.data;
  },

  /**
   * Get categories tree
   */
  getCategories: async () => {
    const response = await apiClient.get<Category[]>('/categories');
    return response.data;
  },

  /**
   * Get templates by category
   */
  getTemplatesByCategory: async (categoryId: string) => {
    const response = await apiClient.get<Template[]>(`/templates`, {
      params: { categoryId },
    });
    return response.data;
  },

  /**
   * Create a new template
   */
  createTemplate: async (data: CreateTemplateDto) => {
    const response = await apiClient.post<Template>('/templates', data);
    return response.data;
  },

  /**
   * Update a template
   */
  updateTemplate: async (id: string, data: UpdateTemplateDto) => {
    const response = await apiClient.patch<Template>(`/templates/${id}`, data);
    return response.data;
  },

  // ============================================================================
  // Template Sets
  // ============================================================================

  /**
   * Get template sets list
   */
  getTemplateSets: async (params?: {
    type?: TemplateSetType;
    width?: number;
    height?: number;
    categoryId?: string;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }) => {
    const response = await apiClient.get<PaginatedResponse<TemplateSet>>('/template-sets', { params });
    return response.data;
  },

  /**
   * Get template set by ID
   */
  getTemplateSet: async (id: string) => {
    const response = await apiClient.get<TemplateSet>(`/template-sets/${id}`);
    return response.data;
  },

  /**
   * Get template set with template details
   */
  getTemplateSetWithTemplates: async (id: string) => {
    const response = await apiClient.get<{
      templateSet: TemplateSet;
      templateDetails: Template[];
    }>(`/template-sets/${id}/with-templates`);
    return response.data;
  },

  /**
   * Get compatible template sets (same dimension and type)
   */
  getCompatibleTemplateSets: async (width: number, height: number, type?: TemplateSetType) => {
    const response = await apiClient.get<TemplateSet[]>('/template-sets/compatible', {
      params: { width, height, type },
    });
    return response.data;
  },

  /**
   * Get templates by type and dimension (for single template replacement)
   */
  getTemplatesByTypeAndDimension: async (
    type: TemplateType,
    width: number,
    height: number
  ) => {
    const response = await apiClient.get<Template[]>('/templates', {
      params: { type, width, height, isActive: true },
    });
    return response.data;
  },
};
