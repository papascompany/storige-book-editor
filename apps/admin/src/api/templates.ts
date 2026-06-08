import { axiosInstance } from '../lib/axios';
import { Template, CanvasData, TemplateType, SpreadConfig } from '@storige/types';

export interface CreateTemplateDto {
  name: string;
  categoryId?: string;
  type?: TemplateType;
  width?: number;
  height?: number;
  editCode?: string;
  templateCode?: string;
  thumbnailUrl?: string;
  canvasData: CanvasData;
  spreadConfig?: SpreadConfig;
  isActive?: boolean;
}

export interface UpdateTemplateDto {
  name?: string;
  categoryId?: string;
  type?: TemplateType;
  width?: number;
  height?: number;
  editCode?: string;
  templateCode?: string;
  thumbnailUrl?: string;
  canvasData?: CanvasData;
  isActive?: boolean;
}

export const templatesApi = {
  getAll: async (categoryId?: string, isActive?: boolean): Promise<Template[]> => {
    const params = new URLSearchParams();
    if (categoryId) params.append('categoryId', categoryId);
    if (isActive !== undefined) params.append('isActive', String(isActive));

    const response = await axiosInstance.get<Template[]>(`/templates?${params.toString()}`);
    return response.data;
  },

  getById: async (id: string): Promise<Template> => {
    const response = await axiosInstance.get<Template>(`/templates/${id}`);
    return response.data;
  },

  create: async (data: CreateTemplateDto): Promise<Template> => {
    const response = await axiosInstance.post<Template>('/templates', data);
    return response.data;
  },

  update: async (id: string, data: UpdateTemplateDto): Promise<Template> => {
    const response = await axiosInstance.patch<Template>(`/templates/${id}`, data);
    return response.data;
  },

  checkEditCode: async (editCode: string, excludeId?: string): Promise<boolean> => {
    const params = excludeId ? `?excludeId=${excludeId}` : '';
    const response = await axiosInstance.get<{ exists: boolean }>(
      `/templates/check-edit-code/${encodeURIComponent(editCode)}${params}`
    );
    return response.data.exists;
  },

  delete: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/templates/${id}`);
  },

  copy: async (id: string): Promise<Template> => {
    const response = await axiosInstance.post<Template>(`/templates/${id}/copy`);
    return response.data;
  },
};
