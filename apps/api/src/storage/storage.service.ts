import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';

export interface UploadedFile {
  id: string;
  originalName: string;
  filename: string;
  path: string;
  url: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly storagePath: string;
  private readonly maxFileSize: number;
  private readonly allowedMimeTypes: string[];
  private readonly imageMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  constructor(private configService: ConfigService) {
    const configuredPath = this.configService.get<string>('STORAGE_PATH', './storage');
    // Resolve relative paths from project root (monorepo root, 2 levels up from apps/api/dist)
    this.storagePath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);
    this.maxFileSize = this.configService.get<number>('STORAGE_MAX_FILE_SIZE', 52428800); // 50MB
    this.allowedMimeTypes = [
      // Images
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      // PDFs
      'application/pdf',
      // Fonts
      'font/ttf',
      'font/otf',
      'font/woff',
      'font/woff2',
      'application/x-font-ttf',
      'application/x-font-otf',
      // JSON (for design data)
      'application/json',
    ];
  }

  async saveFile(
    file: Express.Multer.File,
    category: 'templates' | 'library' | 'uploads' | 'temp' | 'designs' | 'thumbnails' = 'uploads',
  ): Promise<UploadedFile> {
    console.log('[StorageService] saveFile called', {
      originalname: file?.originalname,
      mimetype: file?.mimetype,
      size: file?.size,
      hasBuffer: !!file?.buffer,
      bufferLength: file?.buffer?.length,
    });

    // Validate file
    this.validateFile(file);
    console.log('[StorageService] Validation passed');

    // Generate unique filename
    const fileId = uuidv4();
    const ext = path.extname(file.originalname);
    const filename = `${fileId}${ext}`;

    // Create category directory if it doesn't exist
    const categoryPath = path.join(this.storagePath, category);
    await this.ensureDirectory(categoryPath);

    // Save file
    const filePath = path.join(categoryPath, filename);
    await fs.writeFile(filePath, file.buffer);

    // Generate URL — 운영 nginx 가 /storage/* 를 NestJS 우회로 직접 서빙하므로
    // URL 의 path segment 가 디스크 경로와 1:1 매칭되어야 함.
    // 이전 형식 `/storage/files/<cat>/<file>` 는 디스크 `<storagePath>/<cat>/<file>` 와
    // 어긋나 404 발생 → /files/ 접두사 제거 (2026-05-19 fix).
    // NestJS legacy controller `@Get(':category/:filename')` 도 새 URL 패턴을 그대로 받음.
    const url = `/storage/${category}/${filename}`;

    return {
      id: fileId,
      originalName: file.originalname,
      filename,
      path: filePath,
      url,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  async deleteFile(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // File might not exist, ignore error
      console.error(`Failed to delete file: ${filePath}`, error);
    }
  }

  async deleteFileByUrl(url: string): Promise<void> {
    // Extract path from URL (e.g., /storage/files/uploads/file.jpg -> uploads/file.jpg)
    const relativePath = url.replace('/storage/files/', '').replace('/storage/', '');
    const filePath = path.join(this.storagePath, relativePath);
    await this.deleteFile(filePath);
  }

  async getFile(filePath: string): Promise<Buffer> {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      throw new BadRequestException('File not found');
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private validateFile(file: Express.Multer.File): void {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException(
        `File size exceeds maximum allowed size of ${this.maxFileSize / 1024 / 1024}MB`,
      );
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `File type ${file.mimetype} is not allowed. Allowed types: ${this.allowedMimeTypes.join(', ')}`,
      );
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  // Helper method to get full file path from URL
  getFilePathFromUrl(url: string): string {
    // Handle both old (/storage/category/file) and new (/storage/files/category/file) URL formats
    const relativePath = url.replace('/storage/files/', '').replace('/storage/', '');
    return path.join(this.storagePath, relativePath);
  }

  /**
   * 이미지 파일의 썸네일 생성 (Sharp 사용).
   * - 입력 파일이 raster 이미지(jpg/png/gif/webp)인 경우만 동작.
   * - SVG/PDF/기타 형식은 원본 경로 그대로 반환 (호출자가 별도 처리).
   * - 결과는 `{원본경로}.thumb-{width}.jpg` 형태로 같은 디렉토리에 저장.
   * - 멱등: 이미 존재하면 다시 만들지 않음.
   *
   * @param filePath  원본 파일 절대 경로
   * @param width     리사이즈 가로 기준 (기본 200px, fit:'inside'로 비율 유지)
   * @returns 생성된 썸네일 절대 경로 (실패/스킵 시 원본 경로)
   */
  async generateThumbnail(filePath: string, width: number = 200): Promise<string> {
    try {
      // 원본 존재 확인
      if (!(await this.fileExists(filePath))) {
        this.logger.warn(`generateThumbnail: source not found ${filePath}`);
        return filePath;
      }

      // raster 이미지가 아니면 원본 경로 그대로 반환
      const ext = path.extname(filePath).toLowerCase();
      const rasterExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      if (!rasterExts.includes(ext)) {
        return filePath;
      }

      const dir = path.dirname(filePath);
      const base = path.basename(filePath, ext);
      const thumbPath = path.join(dir, `${base}.thumb-${width}.jpg`);

      // 이미 생성됐으면 스킵
      if (await this.fileExists(thumbPath)) {
        return thumbPath;
      }

      await sharp(filePath)
        .rotate() // EXIF orientation 자동 보정
        .resize(width, width, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toFile(thumbPath);

      this.logger.log(`Thumbnail generated: ${thumbPath}`);
      return thumbPath;
    } catch (error: any) {
      this.logger.error(
        `generateThumbnail failed for ${filePath}: ${error?.message ?? error}`,
      );
      return filePath; // 실패 시 원본 경로 fallback (호출자에게 에러 안 던짐)
    }
  }
}
