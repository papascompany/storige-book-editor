import { axiosInstance } from '../lib/axios';
import { WorkerJob, WorkerJobStatus, WorkerJobType } from '@storige/types';

// Validation Job DTO
export interface CreateValidationJobDto {
  editSessionId?: string;
  fileId?: string;
  fileUrl?: string;
  fileType: 'cover' | 'content';
  orderOptions: {
    size: { width: number; height: number };
    pages: number;
    binding: 'perfect' | 'saddle' | 'spring';
    bleed: number;
    paperThickness?: number;
  };
}

// Conversion Job DTO
export interface CreateConversionJobDto {
  fileId?: string;
  fileUrl?: string;
  convertOptions: {
    addPages?: boolean;
    applyBleed?: boolean;
    targetPages?: number;
    bleed?: number;
  };
}

// Synthesis Job DTO
export interface CreateSynthesisJobDto {
  editSessionId?: string;
  coverFileId?: string;
  coverUrl?: string;
  contentFileId?: string;
  contentUrl?: string;
  spineWidth: number;
  orderId?: string;
  priority?: 'high' | 'normal' | 'low';
  callbackUrl?: string;
}

// Validation Result interfaces
export interface ValidationError {
  code: string;
  message: string;
  details: Record<string, any>;
  autoFixable: boolean;
  fixMethod?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  details?: any;
  autoFixable: boolean;
  fixMethod?: string;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  metadata: {
    pageCount: number;
    pageSize: { width: number; height: number };
    hasBleed: boolean;
    bleedSize?: number;
    spineSize?: number;
    resolution?: number;
    colorMode?: string;
  };
}

export const workerJobsApi = {
  // List jobs
  getAll: async (status?: WorkerJobStatus, jobType?: WorkerJobType): Promise<WorkerJob[]> => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    if (jobType) params.append('jobType', jobType);

    const response = await axiosInstance.get<WorkerJob[]>(
      `/worker-jobs?${params.toString()}`
    );
    return response.data;
  },

  // Get single job
  getById: async (id: string): Promise<WorkerJob> => {
    const response = await axiosInstance.get<WorkerJob>(`/worker-jobs/${id}`);
    return response.data;
  },

  // Get statistics
  getStats: async (): Promise<any> => {
    const response = await axiosInstance.get('/worker-jobs/stats');
    return response.data;
  },

  // Create validation job
  createValidationJob: async (dto: CreateValidationJobDto): Promise<WorkerJob> => {
    const response = await axiosInstance.post<WorkerJob>('/worker-jobs/validate', dto);
    return response.data;
  },

  // Create conversion job
  createConversionJob: async (dto: CreateConversionJobDto): Promise<WorkerJob> => {
    const response = await axiosInstance.post<WorkerJob>('/worker-jobs/convert', dto);
    return response.data;
  },

  // Create synthesis job
  createSynthesisJob: async (dto: CreateSynthesisJobDto): Promise<WorkerJob> => {
    const response = await axiosInstance.post<WorkerJob>('/worker-jobs/synthesize', dto);
    return response.data;
  },

  // Upload file for testing
  // fileType: 'cover' | 'content' — required by the API UploadFileDto
  uploadTestFile: async (file: File, fileType: 'cover' | 'content' = 'content'): Promise<{ fileId: string; fileUrl: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    // /files/upload requires a `type` field (FileType enum: 'cover'|'content'|'template'|'other')
    formData.append('type', fileType);

    const response = await axiosInstance.post<{ id: string; fileUrl: string }>('/files/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    // API returns FileResponseDto: { id, fileUrl, ... }
    return { fileId: response.data.id, fileUrl: response.data.fileUrl };
  },
};
