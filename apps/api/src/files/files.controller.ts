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
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Readable } from 'stream';
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
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { FilesService } from './files.service';
import { PresignedUploadService } from './presigned-upload.service';
import { UploadFileDto } from './dto/upload-file.dto';
import { FileResponseDto, FileListResponseDto } from './dto/file-response.dto';
import {
  PresignUploadDto,
  MultipartInitDto,
  MultipartSignDto,
  MultipartCompleteDto,
  MultipartAbortDto,
  CompleteUploadDto,
} from './dto/presigned-upload.dto';
import { FileType } from './entities/file.entity';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';

@ApiTags('Files')
@Controller('files')
export class FilesController {
  private readonly logger = new Logger(FilesController.name);

  constructor(
    private readonly filesService: FilesService,
    private readonly presignedUpload: PresignedUploadService,
  ) {}

  /**
   * 공통 스트리밍 파이프 — 헤더 설정 + 에러/중단 처리(트랙 B-(c)).
   * `res.send(buffer)` 대신 `stream.pipe(res)` 로 2GB 도 API heap 상수.
   * - stream 'error': 헤더 전이면 500 JSON, 후면 연결 강제 종료(잘린 응답).
   * - res 'close'(클라 중단): 업스트림(R2/fs) 스트림 destroy → 연결 누수 방지.
   */
  private streamToResponse(
    res: Response,
    stream: Readable,
    opts: {
      contentType: string;
      disposition: string;
      contentLength?: number;
      cacheControl?: string;
      nosniff?: boolean;
      corp?: boolean;
      logCtx: string;
    },
  ): void {
    res.setHeader('Content-Type', opts.contentType);
    res.setHeader('Content-Disposition', opts.disposition);
    if (opts.nosniff) res.setHeader('X-Content-Type-Options', 'nosniff');
    if (opts.corp) res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (opts.cacheControl) res.setHeader('Cache-Control', opts.cacheControl);
    if (
      opts.contentLength != null &&
      Number.isFinite(opts.contentLength) &&
      opts.contentLength > 0
    ) {
      res.setHeader('Content-Length', String(opts.contentLength));
    }

    res.on('close', () => stream.destroy());

    stream.on('error', (err: Error) => {
      this.logger.error(`[${opts.logCtx}] stream error: ${err?.message}`);
      if (!res.headersSent) {
        res
          .status(500)
          .json({ code: 'STREAM_ERROR', message: '파일 스트리밍 중 오류가 발생했습니다.' });
      } else {
        res.destroy(err);
      }
    });

    stream.pipe(res);
  }

  // ─────────────────────────────────────────────────────────────
  // R2 presigned 직결 업로드 (2026-06-19) — driver!=='s3' 이면 503 STORAGE_NOT_S3.
  // 키 서버생성·contentType 화이트리스트(pdf+이미지) 서명바인딩·2GB 상한·public throttle.
  // ─────────────────────────────────────────────────────────────

  // ── single-part: 인증 ─────────────────────────────────────────
  @Post('presigned-upload')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'presigned 직결 업로드 URL 발급(인증)' })
  @ApiResponse({ status: 201, description: '발급 성공' })
  @ApiResponse({ status: 503, description: 'STORAGE_NOT_S3 (local 드라이버)' })
  async presignUpload(@Body() dto: PresignUploadDto, @CurrentUser() user: any) {
    const memberSeqno = dto.memberSeqno ?? (user?.userId ? parseInt(user.userId) : undefined);
    return this.presignedUpload.presignPut({
      fileType: dto.type ?? FileType.CONTENT,
      expectedSize: dto.expectedSize,
      originalName: dto.originalName,
      orderSeqno: dto.orderSeqno,
      memberSeqno,
      contentType: dto.contentType,
    });
  }

  // ── single-part: 공개(게스트) ────────────────────────────────
  @Post('presigned-upload-public')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'presigned 직결 업로드 URL 발급(공개/게스트)' })
  @ApiResponse({ status: 201, description: '발급 성공' })
  @ApiResponse({ status: 503, description: 'STORAGE_NOT_S3 (local 드라이버)' })
  async presignUploadPublic(@Body() dto: PresignUploadDto) {
    return this.presignedUpload.presignPut({
      fileType: dto.type ?? FileType.CONTENT,
      expectedSize: dto.expectedSize,
      originalName: dto.originalName,
      orderSeqno: dto.orderSeqno,
      // 공개(게스트) 경로는 클라가 보낸 memberSeqno 를 신뢰하지 않는다(소유권 위조 차단).
      // 실제 소유 연결은 edit-session(contentPdfFileId) 등 서버측 컨텍스트에서 이뤄진다.
      memberSeqno: null,
      contentType: dto.contentType,
    });
  }

  // ── multipart: init ──────────────────────────────────────────
  @Post('multipart/init')
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: '멀티파트 업로드 시작' })
  @ApiResponse({ status: 503, description: 'STORAGE_NOT_S3' })
  async multipartInit(@Body() dto: MultipartInitDto) {
    return this.presignedUpload.initMultipart({
      fileType: dto.type ?? FileType.CONTENT,
      expectedSize: dto.expectedSize,
      originalName: dto.originalName,
      orderSeqno: dto.orderSeqno,
      // 공개(게스트) 경로 — 클라 memberSeqno 미신뢰(소유권 위조 차단).
      memberSeqno: null,
      contentType: dto.contentType,
    });
  }

  // ── multipart: sign part ─────────────────────────────────────
  @Post('multipart/sign')
  @Public()
  @Throttle({ default: { limit: 600, ttl: 60000 } }) // 파트당 1콜 — 대용량은 콜 多 → 넉넉히
  @ApiOperation({ summary: '멀티파트 파트 업로드 URL 서명' })
  async multipartSign(@Body() dto: MultipartSignDto) {
    return this.presignedUpload.signUploadPart(dto.fileId, dto.partNumber, dto.uploadToken);
  }

  // ── multipart: complete ──────────────────────────────────────
  @Post('multipart/complete')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '멀티파트 완료(파트 etag 결합 + HeadObject 검증)' })
  @ApiResponse({ status: 200, type: FileResponseDto })
  async multipartComplete(@Body() dto: MultipartCompleteDto): Promise<FileResponseDto> {
    const file = await this.presignedUpload.completeMultipart(dto.fileId, dto.parts, dto.uploadToken);
    return this.filesService.toResponseDto(file);
  }

  // ── multipart: abort ─────────────────────────────────────────
  @Post('multipart/abort')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '멀티파트 취소(R2 abort + status=failed)' })
  async multipartAbort(@Body() dto: MultipartAbortDto): Promise<{ success: boolean }> {
    await this.presignedUpload.abortMultipart(dto.fileId, dto.uploadToken);
    return { success: true };
  }

  // ── complete (single) ─ 공개+throttle (게스트 흐름이 호출). 멱등. ─
  // ⚠️ 반드시 multipart/* 라우트 "뒤"에 선언: ':id/complete' 파라미터 경로가
  //    'multipart/complete'(:id='multipart')를 가로채면 단품 DTO로 검증돼 400 난다(라우트 충돌).
  @Post(':id/complete')
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: '직결 업로드 완료 확정(HeadObject 검증)' })
  @ApiResponse({ status: 200, description: 'ready 확정', type: FileResponseDto })
  @ApiResponse({ status: 400, description: 'UPLOAD_NOT_FOUND_ON_R2 / EMPTY_UPLOAD' })
  async completeUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<FileResponseDto> {
    const file = await this.presignedUpload.completeSingle(id, dto.uploadToken);
    return this.filesService.toResponseDto(file);
  }

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

    // per-product override 우선 → 없으면 site.retentionDays.
    // 규약(site.entity): null/0 = 영구(미설정), >0 = now + N일.
    //   dto.retentionDays 가 명시되면(0 포함) 그 값으로 override(0=영구 강제, site 무시).
    const effectiveDays =
      dto.retentionDays !== undefined ? dto.retentionDays : (site?.retentionDays ?? 0);
    if (effectiveDays && effectiveDays > 0) {
      const expiresAt = new Date(Date.now() + effectiveDays * 24 * 60 * 60 * 1000);
      // setExpiry 에 site 전달 — assertSiteAccess 가 방금 업로드한 동일 site 파일이므로 통과(테넌트 정합).
      fileEntity = await this.filesService.setExpiry(fileEntity.id, expiresAt, site);
    }
    // effectiveDays === 0 → 영구(expires_at NULL 유지, uploadFile 기본).

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

    // 트랙 B-(c): 전체버퍼(res.send) → 스트리밍(stream.pipe). 권한검증은 위에서 완료.
    const { stream, file: f, size } = await this.filesService.getFileStream(id);
    this.streamToResponse(res, stream, {
      contentType: f.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(f.originalName)}"`,
      contentLength: size,
      nosniff: true,
      logCtx: `download ${id}`,
    });
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
    // 트랙 B-(c): 전체버퍼 → 스트리밍(합성결과 PDF 가 2GB 라도 API heap 상수).
    const { stream, file, size } = await this.filesService.getFileStream(id, site);
    this.streamToResponse(res, stream, {
      contentType: file.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(file.originalName)}"`,
      contentLength: size,
      nosniff: true,
      logCtx: `download/external ${id}`,
    });
  }

  /**
   * R2/local **이미지 자산** 브라우저 공개 스트리밍 — 트랙 B-(c) 권장안 A. ⭐
   *
   * 편집기가 >50MB 내부 '이미지'를 R2 에 presigned 업로드한 뒤, 이 엔드포인트로 표시(display)한다.
   * (nginx `/storage/*` 는 로컬만 서빙 → R2 키는 404 였음. 이 라우트가 그 갭을 메운다.)
   *
   * 보안 설계(적대검증 high 반영 — 2026-06-20):
   *  - **표시용 래스터 이미지로만 한정**: RAW_SERVE_TYPES(jpeg/png/webp/gif) 만 서빙, 그 외는 404.
   *    ⚠️ application/pdf 는 절대 서빙하지 않는다 — 합성결과/주문 content PDF(민감)도 동일 files
   *    테이블에 status='ready' 로 공존하고, 편집기가 content PDF 를 표시이미지와 동일한 공개
   *    presigned 경로(`uploadViaPresigned isPublic, type:'content'`)로 올리므로 fileType/마커로는
   *    구분이 불가능하다. content-type 만이 안전한 판별자다. PDF 취득은 `:id/download`(JWT)·
   *    `:id/download/external`(ApiKey+site)만 담당 → raw 가 그 권한경계를 우회하지 못하게 한다
   *    (2026-05-03 패치가 막은 'UUID 유출 시 무인증 다운로드' 회귀를 차단).
   *    image/svg+xml 도 제외(서빙단 인라인 XSS 이중방어).
   *  - **@Public** + fileId(UUID=비추측). 서빙 대상이 '공유 표시 이미지'(public presigned=siteId NULL)로
   *    좁혀져 테넌트 격리 비대칭도 함께 해소(민감 siteId 스탬프 PDF 가 raw 로 새지 않음).
   *  - **X-Content-Type-Options: nosniff** 항상 + **inline**(서빙 대상이 안전 래스터뿐) + CORP cross-origin
   *    (crossOriginIsolated 편집기/임베드 fabric 로드 통과). ACAO 는 전역 CORS(허용오리진 반영)가 처리.
   *  - status!=='ready' 는 미완 업로드 → 404. soft-deleted 는 findById 가 자동 제외 → 404.
   *  - @Throttle: 무인증 대용량 egress 남용 완화(전역 300/min 보다 보수적).
   */
  @Get(':id/raw')
  @Public()
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({ summary: 'R2/local 이미지 공개 스트리밍(인라인 표시용) — fileId(UUID) 기반, 이미지만' })
  @ApiResponse({ status: 200, description: '이미지 스트림' })
  @ApiResponse({ status: 404, description: '파일 없음 / 미완(pending) / 비이미지(PDF 등) / 삭제됨' })
  async getRawFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, file, size } = await this.filesService.getFileStream(id);

    // 표시 가능한 안전 래스터 이미지로만 한정. PDF(content/합성/회원/디자인)·svg·html·기타는
    // 비공개 다운로드 경로 전용 → 여기선 404. (mimeType 은 파라미터/대소문자 정규화 후 비교.)
    const RAW_SERVE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    const mime = (file.mimeType || '').toLowerCase().split(';')[0].trim();

    // 미완(pending/failed) 또는 비표시 타입은 404. 이미 연 스트림은 즉시 정리(소켓/fd 누수 방지).
    if (file.status !== 'ready' || !RAW_SERVE_TYPES.has(mime)) {
      stream.destroy();
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
        details: { fileId: id },
      });
    }

    this.streamToResponse(res, stream, {
      contentType: file.mimeType,
      disposition: `inline; filename="${encodeURIComponent(file.originalName)}"`,
      contentLength: size,
      cacheControl: 'public, max-age=31536000, immutable',
      nosniff: true,
      corp: true,
      logCtx: `raw ${id}`,
    });
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
    await this.filesService.hardDelete(id, site);
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
    const file = await this.filesService.setExpiry(id, parsed, site);
    return this.filesService.toResponseDto(file);
  }

  /**
   * PDF 썸네일 조회 (외부 API Key 인증 + 테넌트 격리)
   *
   * P0-3 (2026-07-03): 과거 @Public 무인증이라 fileId(UUID)만 알면 임의 파일의 첫 페이지를
   * PNG 로 무인증 유출했다 — 바로 위 :id/raw 가 'content PDF(민감) 무인증 유출' 회귀를 막으려
   * PDF/svg 를 404 배제하는데, thumbnail 은 그 권한경계에 뚫린 구멍이었다(주문 원고·합성물·
   * 회원 디자인 첫 페이지 노출). download/external·:id/expiry/external 와 동일하게
   * ApiKeyGuard + @CurrentSite + assertSiteAccess(서비스단) 로 강등하고, PDF→PNG 래스터화
   * 무인증 DoS 를 @Throttle 로 완화. NULL-siteId(레거시/공유)는 assertSiteAccess 가 기존 정책대로 통과.
   */
  @Get(':id/thumbnail')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({ summary: 'PDF 썸네일 조회 (외부 API Key 인증 + 테넌트 격리)' })
  @ApiResponse({ status: 200, description: 'PNG 이미지' })
  @ApiResponse({ status: 400, description: 'PDF 파일이 아니거나 썸네일 생성 실패' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async getThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page: string = '1',
    @Query('width') width: string = '200',
    @Res() res: Response,
    @CurrentSite() site?: CurrentSitePayload,
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

    // P0-3: 호출자 site 대조 — 타 테넌트 파일 썸네일 유출 차단(assertSiteAccess 서비스단).
    const buffer = await this.filesService.getThumbnailBuffer(id, pageNum, widthNum, site);

    // 캐싱 헤더 (1시간). P0-3: 이제 테넌트 격리 인증 라우트이므로 `private` — 공유 프록시/CDN 이
    // fileId(URL) 로 캐시해 API·assertSiteAccess 를 우회하고 타 테넌트에 서빙하는 벡터 차단.
    // (raw 라우트는 siteId=NULL 공유 이미지 전용이라 public/immutable 이지만, thumbnail 은
    //  siteId 스탬프 PDF 를 렌더하므로 private 가 맞다.)
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  /**
   * 파일 삭제
   */
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '파일 삭제 — 소유자 또는 관리자만' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 403, description: '권한 없음 (다른 사용자의 파일)' })
  @ApiResponse({ status: 404, description: '파일을 찾을 수 없음' })
  async deleteFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<{ success: boolean }> {
    // SEC-003: getFile 과 동일 소유권 검증 — UUID만으로 임의 파일 삭제(IDOR) 차단.
    // 역할 비교는 case-insensitive(UserRole enum 은 대문자 'ADMIN' — edit-sessions isStaffRole 정합).
    const file = await this.filesService.findById(id);
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const userRole = String(user?.role || '').toLowerCase();
    const isOwner = file.memberSeqno !== null && Number(file.memberSeqno) === userId;
    const isStaff = userRole === 'admin' || userRole === 'manager';
    if (!isOwner && !isStaff) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 파일을 삭제할 권한이 없습니다.',
      });
    }
    await this.filesService.softDelete(id);
    return { success: true };
  }

  /**
   * 소프트삭제 파일 복구 (48h 복구창 내) — deleted_at NULL 로 되돌림.
   * 데이터손실 안전장치: 보존 sweep/수동삭제로 soft-delete 된 파일을 purge(영구삭제) 전 복구.
   * 이미 purge(hardDelete)된 경우 404.
   */
  @Post(':id/restore')
  @ApiBearerAuth()
  @ApiOperation({ summary: '소프트삭제 파일 복구 (48h 복구창) — 관리자 전용' })
  @ApiResponse({ status: 200, description: '복구 성공', type: FileResponseDto })
  @ApiResponse({ status: 403, description: '권한 없음 (관리자만)' })
  @ApiResponse({ status: 404, description: '파일 없음 또는 이미 영구삭제됨' })
  async restoreFile(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<FileResponseDto> {
    // SEC-003: 복구는 보존 sweep/운영 작업 성격 → 관리자 전용(소프트삭제 파일의 소유권
    // 역참조 복잡성 회피 + 운영 안전). 현재 콜러 0건이라 비파괴.
    // 역할 비교 case-insensitive(UserRole enum 대문자).
    const userRole = String(user?.role || '').toLowerCase();
    if (userRole !== 'admin' && userRole !== 'manager') {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '파일 복구는 관리자만 가능합니다.',
      });
    }
    const file = await this.filesService.restore(id);
    return this.filesService.toResponseDto(file);
  }
}
