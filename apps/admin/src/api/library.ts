import { axiosInstance } from '../lib/axios';
import { LibraryFont, LibraryBackground, LibraryClipart, LibraryShape, LibraryFrame, LibraryCategory, LibraryCategoryType } from '@storige/types';

// File upload response type
interface UploadResponse {
  url: string;
  filename: string;
  originalName: string;
  size: number;
}

// Fonts
export interface CreateFontDto {
  name: string;
  fileUrl: string;
  fileFormat: string;
  isActive?: boolean;
}

export const libraryApi = {
  // File upload
  uploadFile: async (file: File): Promise<UploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axiosInstance.post<UploadResponse>(
      '/storage/upload?category=library',
      formData,
      {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      }
    );
    return response.data;
  },

  // Fonts
  getFonts: async (isActive?: boolean): Promise<LibraryFont[]> => {
    const params = isActive !== undefined ? `?isActive=${isActive}` : '';
    const response = await axiosInstance.get<LibraryFont[]>(`/library/fonts${params}`);
    return response.data;
  },

  createFont: async (data: CreateFontDto): Promise<LibraryFont> => {
    const response = await axiosInstance.post<LibraryFont>('/library/fonts', data);
    return response.data;
  },

  updateFont: async (id: string, data: Partial<CreateFontDto>): Promise<LibraryFont> => {
    // API 컨트롤러가 @Patch('fonts/:id') — PUT 은 404. 2026-05-15 fix
    const response = await axiosInstance.patch<LibraryFont>(`/library/fonts/${id}`, data);
    return response.data;
  },

  deleteFont: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/fonts/${id}`);
  },

  // Backgrounds
  getBackgrounds: async (category?: string, isActive?: boolean): Promise<LibraryBackground[]> => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const response = await axiosInstance.get<LibraryBackground[]>(
      `/library/backgrounds?${params.toString()}`
    );
    return response.data;
  },

  createBackground: async (data: Partial<LibraryBackground>): Promise<LibraryBackground> => {
    const response = await axiosInstance.post<LibraryBackground>('/library/backgrounds', data);
    return response.data;
  },

  updateBackground: async (
    id: string,
    data: Partial<LibraryBackground>
  ): Promise<LibraryBackground> => {
    // API 컨트롤러가 @Patch('backgrounds/:id') — PUT 은 404. 2026-05-15 fix
    const response = await axiosInstance.patch<LibraryBackground>(
      `/library/backgrounds/${id}`,
      data
    );
    return response.data;
  },

  deleteBackground: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/backgrounds/${id}`);
  },

  // Cliparts
  getCliparts: async (category?: string, isActive?: boolean): Promise<LibraryClipart[]> => {
    const params = new URLSearchParams();
    if (category) params.append('category', category);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const response = await axiosInstance.get<LibraryClipart[]>(
      `/library/cliparts?${params.toString()}`
    );
    return response.data;
  },

  searchClipartsByTags: async (tags: string[]): Promise<LibraryClipart[]> => {
    const response = await axiosInstance.get<LibraryClipart[]>(
      `/library/cliparts/search/tags?tags=${tags.join(',')}`
    );
    return response.data;
  },

  createClipart: async (data: Partial<LibraryClipart>): Promise<LibraryClipart> => {
    const response = await axiosInstance.post<LibraryClipart>('/library/cliparts', data);
    return response.data;
  },

  updateClipart: async (id: string, data: Partial<LibraryClipart>): Promise<LibraryClipart> => {
    // API 컨트롤러가 @Patch('cliparts/:id') — PUT 은 404. 2026-05-15 fix
    const response = await axiosInstance.patch<LibraryClipart>(`/library/cliparts/${id}`, data);
    return response.data;
  },

  deleteClipart: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/cliparts/${id}`);
  },

  // Shapes
  getShapes: async (categoryId?: string, isActive?: boolean): Promise<LibraryShape[]> => {
    const params = new URLSearchParams();
    if (categoryId) params.append('categoryId', categoryId);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const response = await axiosInstance.get<LibraryShape[]>(
      `/library/shapes?${params.toString()}`
    );
    return response.data;
  },

  createShape: async (data: Partial<LibraryShape>): Promise<LibraryShape> => {
    const response = await axiosInstance.post<LibraryShape>('/library/shapes', data);
    return response.data;
  },

  updateShape: async (id: string, data: Partial<LibraryShape>): Promise<LibraryShape> => {
    const response = await axiosInstance.patch<LibraryShape>(`/library/shapes/${id}`, data);
    return response.data;
  },

  deleteShape: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/shapes/${id}`);
  },

  // Frames
  getFrames: async (categoryId?: string, isActive?: boolean): Promise<LibraryFrame[]> => {
    const params = new URLSearchParams();
    if (categoryId) params.append('categoryId', categoryId);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const response = await axiosInstance.get<LibraryFrame[]>(
      `/library/frames?${params.toString()}`
    );
    return response.data;
  },

  createFrame: async (data: Partial<LibraryFrame>): Promise<LibraryFrame> => {
    const response = await axiosInstance.post<LibraryFrame>('/library/frames', data);
    return response.data;
  },

  updateFrame: async (id: string, data: Partial<LibraryFrame>): Promise<LibraryFrame> => {
    const response = await axiosInstance.patch<LibraryFrame>(`/library/frames/${id}`, data);
    return response.data;
  },

  deleteFrame: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/frames/${id}`);
  },

  // Categories
  getCategories: async (type?: LibraryCategoryType, isActive?: boolean): Promise<LibraryCategory[]> => {
    const params = new URLSearchParams();
    if (type) params.append('type', type);
    if (isActive !== undefined) params.append('isActive', String(isActive));
    const response = await axiosInstance.get<LibraryCategory[]>(
      `/library/categories?${params.toString()}`
    );
    return response.data;
  },

  getCategoriesTree: async (type: LibraryCategoryType): Promise<LibraryCategory[]> => {
    const response = await axiosInstance.get<LibraryCategory[]>(
      `/library/categories/tree/${type}`
    );
    return response.data;
  },

  createCategory: async (data: Partial<LibraryCategory> & { type: LibraryCategoryType }): Promise<LibraryCategory> => {
    const response = await axiosInstance.post<LibraryCategory>('/library/categories', data);
    return response.data;
  },

  updateCategory: async (id: string, data: Partial<LibraryCategory>): Promise<LibraryCategory> => {
    const response = await axiosInstance.patch<LibraryCategory>(`/library/categories/${id}`, data);
    return response.data;
  },

  deleteCategory: async (id: string): Promise<void> => {
    await axiosInstance.delete(`/library/categories/${id}`);
  },
};
