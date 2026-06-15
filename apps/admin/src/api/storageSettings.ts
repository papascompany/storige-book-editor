import { axiosInstance } from '../lib/axios';

export interface StorageSettings {
  driver: 'local' | 's3';
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKeyId: string;
  /** 시크릿 설정 여부(평문 미반환) */
  s3SecretConfigured: boolean;
  s3SecretMasked: string;
  s3ForcePathStyle: boolean;
  retentionEnabled: boolean;
  retentionDryRun: boolean;
  updatedAt: string | null;
}

export interface UpdateStorageSettingsDto {
  driver?: 'local' | 's3';
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  /** 빈 값이면 기존 시크릿 유지 */
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: boolean;
  retentionEnabled?: boolean;
  retentionDryRun?: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

export const storageSettingsApi = {
  async get(): Promise<StorageSettings> {
    const r = await axiosInstance.get<ApiResponse<StorageSettings>>('/admin/storage-settings');
    return r.data.data;
  },
  async update(dto: UpdateStorageSettingsDto): Promise<void> {
    await axiosInstance.put('/admin/storage-settings', dto);
  },
};
