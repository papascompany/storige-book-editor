import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  ParseUUIDPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { Response } from 'express';
import { FilesService } from './files.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { FileResponseDto, FileListResponseDto } from './dto/file-response.dto';
import { FileType } from './entities/file.entity';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('Files')
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * 파일 업로드
   */
  @Post('upload')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'PDF 파일 업로드' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF 파일' },
        type: {
          type: 'string',
          enum: Object.values(FileType),
          description: '파일 타입',
        },
        orderSeqno: { type: 'number', description: '주문 번호 (선택)' },
        memberSeqno: { type: 'number', description: '회원 번호 (선택)' },
      },
      required: ['file', 'type'],
    },
  })
  @ApiResponse({
    status: 201,
    description: '파일 업로드 성공',
    type: FileResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식 또는 크기 초과' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
      fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          cb(
            new BadRequestException({
              code: 'UNSUPPORTED_FORMAT',
              message: 'PDF 파일만 업로드할 수 있습니다.',
            }),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentUser() user: any,
  ): Promise<FileResponseDto> {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: '파일을 선택해주세요.',
      });
    }

    // JWT에서 memberSeqno 추출 (dto에 없으면)
    const memberSeqno = dto.memberSeqno || (user?.userId ? parseInt(user.userId) : undefined);

    const fileEntity = await this.filesService.uploadFile(
      file,
      dto.type,
      dto.orderSeqno,
      memberSeqno,
      dto.metadata,
    );

    return this.filesService.toResponseDto(fileEntity);
  }

  /**
   * 외부 연동용 파일 업로드 (API Key 인증)
   * bookmoa 등 외부 시스템에서 서버 간 통신으로 호출
   */
  @Post('upload/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'PDF 파일 업로드 (외부 API Key 인증)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: 'PDF 파일' },
        type: {
          type: 'string',
          enum: Object.values(FileType),
          description: '파일 타입',
        },
        orderSeqno: { type: 'number', description: '주문 번호 (선택)' },
        memberSeqno: { type: 'number', description: '회원 번호 (선택)' },
      },
      required: ['file', 'type'],
    },
  })
  @ApiResponse({
    status: 201,
    description: '파일 업로드 성공',
    type: FileResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 파일 형식 또는 크기 초과' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
      fileFilter: (req, file, cb) => {
        if (file.mimetype !== 'application/pdf') {
          cb(
            new BadRequestException({
              code: 'UNSUPPORTED_FORMAT',
              message: 'PDF 파일만 업로드할 수 있습니다.',
            }),
            false,
          );
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadFileExternal(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<FileResponseDto> {
    if (!file) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: '파일을 선택해주세요.',
      });
    }

    let fileEntity = await this.filesService.uploadFile(
      file,
      dto.type,
      dto.orderSeqno,
      dto.memberSeqno,
      dto.metadata,
      site?.siteId, // P2c S-2: 외부 업로드 파일에 호출자 site 스탬프(테넌트 소유)
    );

    // 사이트 보존정책 적용 — retentionDays>0 이면 expires_at = now + N일 (retention cron 이 정리)
    const days = site?.retentionDays ?? 0;
    if (days && days > 0) {
      const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      fileEntity = await this.filesService.setExpiry(fileEntity.id, expiresAt);
    }

    return this.filesService.toResponseDto(fileEntity);
  }

  /**
   * 파일 정보 조회 (소유자 또는 관리자만)
   */
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '파일 정보 조회 — 소유자 또는 관리자만 접근 가능' })
  @ApiResponse({ status: 200, description: '파일 정보', type: FileResponseDto })
  @ApiResponse({ status: 403, description: '권한 없음 (다른 사용자의 파일)' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async getFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<FileResponseDto> {
    const file = await this.filesService.findById(id);

    // 권한 확인: 파일 소유자 (memberSeqno 일치) 또는 admin/manager 역할
    // 단, file.memberSeqno가 null인 경우 (외부 업로드)는 staff만 허용
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const userRole = user?.role || '';
    const isOwner = file.memberSeqno !== null && Number(file.memberSeqno) === userId;
    const isStaff = userRole === 'admin' || userRole === 'manager';

    if (!isOwner && !isStaff) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 파일에 접근할 권한이 없습니다.',
      });
    }

    return this.filesService.toResponseDto(file);
  }

  /**
   * 파일 목록 조회 — 소유자 본인 또는 관리자만
   *
   * SECURITY: 이전엔 임의 orderSeqno/memberSeqno로 타인 파일 조회 가능하던 결함.
   * 2026-05-03 패치 — admin/manager가 아니면 JWT.memberSeqno 강제.
   *
   * 동작:
   *  - admin/manager: 임의 orderSeqno / memberSeqno 조회 가능
   *  - 일반 사용자: JWT의 memberSeqno로 강제 필터, 다른 회원 조회 차단
   *  - 일반 사용자가 orderSeqno로 조회 시 — 그 주문이 본인 것인지 추가 검증
   */
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: '파일 목록 조회 — 소유자 본인 또는 관리자만' })
  @ApiResponse({
    status: 200,
    description: '파일 목록',
    type: FileListResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음 (다른 회원의 파일 조회 시도)' })
  async getFiles(
    @CurrentUser() user: any,
    @Query('orderSeqno') orderSeqno?: string,
    @Query('memberSeqno') memberSeqno?: string,
  ): Promise<FileListResponseDto> {
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const userRole = user?.role || '';
    const isStaff = userRole === 'admin' || userRole === 'manager';

    let files;

    if (orderSeqno) {
      files = await this.filesService.findByOrderSeqno(parseInt(orderSeqno));
      // 일반 사용자: 결과 중 본인 소유 파일만 노출 (다른 회원의 같은 주문 추적 방지)
      if (!isStaff) {
        files = files.filter((f) => Number(f.memberSeqno) === userId);
      }
    } else if (memberSeqno) {
      const requestedMember = parseInt(memberSeqno);
      // 일반 사용자: 본인 memberSeqno만 조회 가능
      if (!isStaff && requestedMember !== userId) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message: '다른 회원의 파일 목록은 조회할 수 없습니다.',
        });
      }
      files = await this.filesService.findByMemberSeqno(requestedMember);
    } else {
      // 파라미터 없으면: 일반 사용자는 본인 파일 자동 조회, admin은 빈 결과 (전체 조회 막기)
      if (!isStaff && userId > 0) {
        files = await this.filesService.findByMemberSeqno(userId);
      } else {
        files = [];
      }
    }

    return {
      files: files.map((f) => this.filesService.toResponseDto(f)),
      total: files.length,
    };
  }

  /**
   * 파일 다운로드 (소유자 또는 관리자만)
   *
   * SECURITY: 이전 @Public() 노출은 UUID 유출 시 누구나 다운로드 가능하던 결함이었음.
   * 2026-05-03 패치 — JWT 인증 + 소유자 검증 강제.
   */
  @Get(':id/download')
  @ApiBearerAuth()
  @ApiOperation({ summary: '파일 다운로드 — 소유자 또는 관리자만 접근 가능' })
  @ApiResponse({ status: 200, description: 'PDF 파일' })
  @ApiResponse({ status: 403, description: '권한 없음 (다른 사용자의 파일)' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async downloadFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentUser() user: any,
  ): Promise<void> {
    const file = await this.filesService.findById(id);

    // 권한 확인: 파일 소유자 또는 admin/manager
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const userRole = user?.role || '';
    const isOwner = file.memberSeqno !== null && Number(file.memberSeqno) === userId;
    const isStaff = userRole === 'admin' || userRole === 'manager';

    if (!isOwner && !isStaff) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 파일을 다운로드할 권한이 없습니다.',
      });
    }

    const { buffer } = await this.filesService.getFileBuffer(id);

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  /**
   * 외부 연동용 파일 다운로드 (API Key 인증)
   * bookmoa 등 외부 시스템에서 합성 결과 PDF를 가져갈 때 사용.
   */
  @Get(':id/download/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: '파일 다운로드 (외부 API Key 인증)' })
  @ApiResponse({ status: 200, description: 'PDF 파일' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async downloadFileExternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<void> {
    // P2c S-2: 호출자 site 대조 — 타 테넌트 파일 다운로드 차단(NULL=레거시/공유 허용).
    const { buffer, file } = await this.filesService.getFileBuffer(
      id,
      site?.siteId,
    );

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(file.originalName)}"`,
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  /**
   * 파일 하드 삭제 (외부 API Key 인증) — 2026-06-13 보존정책 트랙.
   * 테넌트(100p_books 등)가 주문 이행 완료 후 호출 → 저장 백엔드 객체 + DB 레코드 영구 제거.
   * 멱등 — 이미 없으면 404.
   */
  @Delete(':id/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: '파일 하드 삭제 (외부 API Key 인증) — 보존정책/주문이행 후 정리' })
  @ApiResponse({ status: 200, description: '삭제 완료' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async deleteFileExternal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<{ success: boolean }> {
    // P2c S-2: 호출자 site 대조 — 타 테넌트 파일 하드삭제 차단(파괴적).
    await this.filesService.hardDelete(id, site?.siteId);
    return { success: true };
  }

  /**
   * 파일 보존 만료 예약 (외부 API Key 인증) — 2026-06-13.
   * 테넌트가 'N일 뒤 자동 삭제' 를 예약. expiresAt(ISO) 또는 null(영구보관 복원).
   * retention cron 이 만료분을 하드삭제.
   */
  @Post(':id/expiry/external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: '파일 보존 만료 예약 (외부 API Key 인증)' })
  @ApiResponse({ status: 200, description: '예약 완료', type: FileResponseDto })
  @ApiResponse({ status: 400, description: '잘못된 expiresAt' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async setFileExpiryExternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { expiresAt: string | null },
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<FileResponseDto> {
    let parsed: Date | null = null;
    if (body?.expiresAt != null) {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException({
          code: 'INVALID_EXPIRES_AT',
          message: 'expiresAt 은 유효한 ISO 날짜 또는 null 이어야 합니다.',
        });
      }
      parsed = d;
    }
    // P2c S-2: 호출자 site 대조 — 타 테넌트 파일 만료예약 차단.
    const file = await this.filesService.setExpiry(id, parsed, site?.siteId);
    return this.filesService.toResponseDto(file);
  }

  /**
   * PDF 썸네일 조회
   */
  @Get(':id/thumbnail')
  @Public()
  @ApiOperation({ summary: 'PDF 썸네일 조회' })
  @ApiResponse({ status: 200, description: 'PNG 이미지' })
  @ApiResponse({ status: 400, description: 'PDF 파일이 아니거나 썸네일 생성 실패' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async getThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: string = '1',
    @Query('width') width: string = '200',
    @Res() res: Response,
  ): Promise<void> {
    const pageNum = parseInt(page, 10) || 1;
    const widthNum = parseInt(width, 10) || 200;

    // 유효성 검증
    if (pageNum < 1 || pageNum > 1000) {
      throw new BadRequestException({
        code: 'INVALID_PAGE',
        message: '페이지 번호는 1-1000 사이여야 합니다.',
      });
    }
    if (widthNum < 50 || widthNum > 1000) {
      throw new BadRequestException({
        code: 'INVALID_WIDTH',
        message: '너비는 50-1000 사이여야 합니다.',
      });
    }

    const buffer = await this.filesService.getThumbnailBuffer(id, pageNum, widthNum);

    // 캐싱 헤더 설정 (1시간)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  /**
   * 파일 삭제
   */
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '파일 삭제' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async deleteFile(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ success: boolean }> {
    await this.filesService.softDelete(id);
    return { success: true };
  }
}
