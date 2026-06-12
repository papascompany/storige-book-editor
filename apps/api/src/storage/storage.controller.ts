import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UseInterceptors,
  UploadedFile,
  Query,
  UseGuards,
  BadRequestException,
  UnsupportedMediaTypeException,
  StreamableFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { memoryStorage } from 'multer';
import { StorageService } from './storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '@storige/types';
import * as fs from 'fs';

// Multer 메모리 스토리지 설정
const multerOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
};

/**
 * 게스트(비로그인) 업로드 허용 MIME 화이트리스트.
 * 인쇄 워크플로우 v1 Phase 1 (2026-05-19) — 고객이 편집기에서 직접 이미지/PDF 업로드.
 * 그 외 타입은 multer fileFilter 에서 415 Unsupported Media Type 으로 거부.
 */
const PUBLIC_UPLOAD_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const multerOptionsPublic = {
  storage: memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (
    _req: Request,
    file: Express.Multer.File,
    cb: (err: Error | null, accept: boolean) => void,
  ) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (PUBLIC_UPLOAD_ALLOWED_MIME.has(mime)) {
      cb(null, true);
    } else {
      cb(
        new UnsupportedMediaTypeException(
          `Unsupported file type: ${mime}. Allowed: ${Array.from(PUBLIC_UPLOAD_ALLOWED_MIME).join(', ')}`,
        ),
        false,
      );
    }
  },
};

@ApiTags('Storage')
@ApiBearerAuth()
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiOperation({ summary: 'Upload a file' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        category: {
          type: 'string',
          enum: ['templates', 'library', 'uploads', 'temp'],
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'Invalid file or file too large' })
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Query('category') category?: 'templates' | 'library' | 'uploads' | 'temp',
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    return await this.storageService.saveFile(file, category || 'uploads');
  }

  /**
   * 게스트(비로그인) 업로드 endpoint — 인쇄 워크플로우 v1 Phase 1 (2026-05-19).
   *
   * - 인증 없이 호출 가능 (@Public).
   * - 50MB 크기 제한 (multerOptionsPublic).
   * - MIME 화이트리스트: image/jpeg|png|webp + application/pdf. 그 외 415.
   * - category 강제: `uploads` (운영 nginx 가 /storage/uploads/* 서빙).
   * - 응답 URL 은 `/storage/uploads/<filename>` 형식 (`/files/` 접두사 없음 — 커밋 d0f364d 정합).
   *
   * 기존 `POST /storage/upload` (ADMIN/MANAGER 전용) 는 그대로 유지.
   */
  @Post('upload-public')
  @Public()
  // SEC-4: 비인증 업로드 디스크 고갈 방어 — IP 당 분당 20회.
  // 고객 플로우는 1회 1파일(이미지/PDF 첨부) 수동 업로드라 일반 사용 영향 없음.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', multerOptionsPublic))
  @ApiOperation({ summary: 'Upload a file (public — guest customer)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'File uploaded successfully' })
  @ApiResponse({ status: 400, description: 'No file provided' })
  @ApiResponse({ status: 413, description: 'File too large (max 50MB)' })
  @ApiResponse({ status: 415, description: 'Unsupported file type' })
  async uploadFilePublic(
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // category 는 강제로 'uploads' — 게스트가 임의 디렉토리 쓰기 방지
    return await this.storageService.saveFile(file, 'uploads');
  }

  // Legacy endpoint for backward compatibility (old URLs: /storage/:category/:filename)
  @Get(':category/:filename')
  @Public()
  @ApiOperation({ summary: 'Get a file (legacy URL format)' })
  @ApiResponse({ status: 200, description: 'File retrieved successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFileLegacy(
    @Param('category') category: string,
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // Delegate to the main getFile method
    return this.getFile(category, filename, res);
  }

  @Get('files/:category/:filename')
  @Public()
  @ApiOperation({ summary: 'Get a file' })
  @ApiResponse({ status: 200, description: 'File retrieved successfully' })
  @ApiResponse({ status: 404, description: 'File not found' })
  async getFile(
    @Param('category') category: string,
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const url = `/storage/${category}/${filename}`;
    const filePath = this.storageService.getFilePathFromUrl(url);

    const exists = await this.storageService.fileExists(filePath);
    if (!exists) {
      throw new BadRequestException('File not found');
    }

    const file = fs.createReadStream(filePath);

    // Set appropriate content type
    const ext = filename.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
      ttf: 'font/ttf',
      otf: 'font/otf',
      woff: 'font/woff',
      woff2: 'font/woff2',
    };

    if (ext && contentTypes[ext]) {
      res.set('Content-Type', contentTypes[ext]);
    }

    return new StreamableFile(file);
  }

  @Delete('files')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete a file by URL' })
  @ApiResponse({ status: 200, description: 'File deleted successfully' })
  async deleteFile(@Query('url') url: string) {
    if (!url) {
      throw new BadRequestException('URL is required');
    }

    await this.storageService.deleteFileByUrl(url);
    return { message: 'File deleted successfully' };
  }

  // ============================================================================
  // Designs Storage Endpoints
  // ============================================================================

  @Post('upload/designs')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiOperation({ summary: 'Upload a design file (JSON or image)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Design file uploaded successfully' })
  async uploadDesignFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    console.log('[Storage] uploadDesignFile called', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      hasBuffer: !!file.buffer,
      bufferLength: file.buffer?.length,
    });

    try {
      const result = await this.storageService.saveFile(file, 'designs');
      console.log('[Storage] File saved successfully:', result.url);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('[Storage] Error saving file:', error);
      throw error;
    }
  }

  @Get('designs/:filename')
  @Public()
  @ApiOperation({ summary: 'Get a design file' })
  @ApiResponse({ status: 200, description: 'Design file retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Design file not found' })
  async getDesignFile(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const url = `/storage/designs/${filename}`;
    const filePath = this.storageService.getFilePathFromUrl(url);

    const exists = await this.storageService.fileExists(filePath);
    if (!exists) {
      throw new BadRequestException('Design file not found');
    }

    const file = fs.createReadStream(filePath);

    // Set appropriate content type
    const ext = filename.split('.').pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      json: 'application/json',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      pdf: 'application/pdf',
    };

    if (ext && contentTypes[ext]) {
      res.set('Content-Type', contentTypes[ext]);
    }

    return new StreamableFile(file);
  }

  @Delete('designs/:filename')
  @ApiOperation({ summary: 'Delete a design file' })
  @ApiResponse({ status: 200, description: 'Design file deleted successfully' })
  async deleteDesignFile(@Param('filename') filename: string) {
    const url = `/storage/designs/${filename}`;
    await this.storageService.deleteFileByUrl(url);
    return {
      success: true,
      message: 'Design file deleted successfully',
    };
  }

  // ============================================================================
  // BB-Phase 3 follow-up — 자동저장 시점 썸네일
  //
  // editor의 autoSave 흐름과 동일한 인증 모델(@Public + X-User-Id 헤더 trust)을 사용한다.
  // editor가 fabric.toDataURL(0.25x JPEG)로 캡처한 ~10-50KB 이미지를 업로드하고
  // EditSessionVersion.thumbnailUrl에 URL을 저장한다.
  //
  // 모바일은 TOUCH_ENV 가드로 캡처를 스킵하므로 이 엔드포인트는 데스크톱에서만 호출됨.
  // 별도 cleanup cron은 1차 도입 안 함 (LRU 20 trim과 함께 orphan 허용 — P2 follow-up).
  // ============================================================================
  @Post('upload/thumbnails')
  @Public()
  @UseInterceptors(FileInterceptor('file', multerOptions))
  @ApiOperation({ summary: 'Upload a version thumbnail (autosave snapshot)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Thumbnail uploaded successfully' })
  async uploadThumbnail(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    return await this.storageService.saveFile(file, 'thumbnails');
  }
}
