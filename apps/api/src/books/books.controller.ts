import {
  Body,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { BooksService } from './books.service';
import { BookFinalizationsService } from './book-finalizations.service';
import { PartnerV1Controller } from '../partner-api/partner-v1.decorator';
import { PartnerRateLimitBucket } from '../partner-api/guards/partner-rate-limit.decorator';
import { PaginatedResult } from '../partner-api/http/pagination';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { FilesService } from '../files/files.service';
import { BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES } from './books.constants';
import { BookListQueryDto, BookView, CreateBookDto } from './dto/book.dto';
import { AssetInputDto, BookAssetView } from './dto/book-asset.dto';
import { BookFinalizationView } from './dto/book-finalization.dto';

/**
 * 자산 라우트 공용 멀티파트 옵션 — 직접 업로드 ≤100MB. fileFilter 는 두지 않고
 * (JSON {fileId} 요청도 통과) MIME 검증은 서비스에서 v1 봉투(415)로 수행.
 */
const ASSET_UPLOAD = FileInterceptor('file', {
  limits: { fileSize: BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES },
});

/**
 * Partner API v1 — Books(도서 aggregate) 컨트롤러 (Stage 3).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1·§2.4·§6
 * 글로벌 prefix 'api' → 최종 경로 /api/v1/books (설계서 모듈 배치 규약).
 *
 * v1 표준 스택 — @PartnerV1Controller 조합 데코레이터가 일괄 바인딩:
 *   @Public(전역 JwtAuthGuard 우회) + PartnerApiKeyGuard(Bearer/X-API-Key 병행)
 *   + PartnerRateLimitGuard(per-Key §5.2) + 에러 필터(§3.2) + 감사→멱등→봉투
 *   인터셉터(§3.1). 핸들러는 순수 데이터만 반환 — 봉투 수동 래핑 금지(이중 래핑 방지).
 *   목록은 PaginatedResult 로 pagination(§5.1)을 싣는다.
 *
 * ⚠️ @Get(':uid') 는 정적 하위 경로(:uid/pdf-cover 등, W2)보다 뒤에 선언 —
 *    Nest 라우팅은 선언 순서를 따르므로 구체 경로 우선.
 */
@ApiTags('partner-v1')
@ApiSecurity('api-key')
@PartnerV1Controller('books')
export class BooksController {
  constructor(
    private readonly booksService: BooksService,
    // W3 — 최종화 오케스트레이터. 라우트는 본 컨트롤러에 둔다(별도 v1 컨트롤러 신설 시
    // partner-v1-guarded 전수 스캔 목록에 등재 필요 — 기존 컨트롤러 재사용이 최소 변경).
    private readonly bookFinalizationsService: BookFinalizationsService,
    // W3 GET .../pdf 스트림(local/s3 무관 getFileStream).
    private readonly filesService: FilesService,
  ) {}

  @Post()
  @ApiOperation({ summary: '도서 생성(DRAFT) — creationType 필수' })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — 생성된 DRAFT 도서' })
  @ApiResponse({ status: 400, description: 'ERR_VALIDATION_FAILED — creationType 누락/무효' })
  @ApiResponse({ status: 404, description: 'ERR_BOOK_SPEC_NOT_FOUND — bookSpecUid 없음/비활성/타 사이트' })
  async create(
    @CurrentSite() site: CurrentSitePayload,
    @Body() dto: CreateBookDto,
  ): Promise<BookView> {
    return this.booksService.create(site, dto);
  }

  @Get()
  @ApiOperation({ summary: '도서 목록(페이지네이션·자기 site+env) — status/creationType 필터' })
  @ApiResponse({ status: 200, description: '{success,message,data,pagination} 봉투' })
  async list(
    @CurrentSite() site: CurrentSitePayload,
    @Query() query: BookListQueryDto,
  ): Promise<PaginatedResult<BookView>> {
    const { items, total, limit, offset } = await this.booksService.list(site, query);
    return PaginatedResult.of(items, total, { limit, offset });
  }

  // ── 자산(W2) ────────────────────────────────────────────────────────
  // ⚠️ 정적 하위 경로는 @Get(':uid') 보다 앞에 선언(Nest 선언 순서 라우팅).
  // 각 라우트는 JSON {fileId} 또는 multipart(file) 두 입력을 함께 수용(fileId 우선).
  // 게이트: 테넌트 404 → FINALIZED 409 → 호환 422 → 기존재 409/404 순(서비스).

  @Post(':uid/pdf-cover')
  @PartnerRateLimitBucket('heavy')
  @UseInterceptors(ASSET_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: '표지 PDF 신규 투입 — 기존재 시 409 ERR_ASSET_ALREADY_EXISTS' })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — 생성된 자산' })
  @ApiResponse({ status: 409, description: 'ERR_BOOK_NOT_DRAFT(FINALIZED) / ERR_ASSET_ALREADY_EXISTS / ERR_FILE_NOT_READY' })
  @ApiResponse({ status: 422, description: 'ERR_ASSET_INCOMPATIBLE — creationType 불일치' })
  async postPdfCover(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Body() dto: AssetInputDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BookAssetView> {
    return this.booksService.putAsset(site, uid, 'pdf_cover', 'create', {
      fileId: dto.fileId,
      file,
    });
  }

  @Put(':uid/pdf-cover')
  @PartnerRateLimitBucket('heavy')
  @UseInterceptors(ASSET_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: '표지 PDF 교체 — 미존재 시 404 ERR_ASSET_NOT_FOUND' })
  @ApiResponse({ status: 200, description: '교체 성공(기존 replaced + 신규 active)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND(도서) / ERR_ASSET_NOT_FOUND(교체 대상 없음)' })
  async putPdfCover(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Body() dto: AssetInputDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BookAssetView> {
    return this.booksService.putAsset(site, uid, 'pdf_cover', 'replace', {
      fileId: dto.fileId,
      file,
    });
  }

  @Post(':uid/pdf-contents')
  @PartnerRateLimitBucket('heavy')
  @UseInterceptors(ASSET_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: '내지 PDF 신규 투입 — 기존재 시 409 ERR_ASSET_ALREADY_EXISTS' })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — 생성된 자산' })
  @ApiResponse({ status: 409, description: 'ERR_BOOK_NOT_DRAFT / ERR_ASSET_ALREADY_EXISTS / ERR_FILE_NOT_READY' })
  @ApiResponse({ status: 422, description: 'ERR_ASSET_INCOMPATIBLE' })
  async postPdfContents(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Body() dto: AssetInputDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BookAssetView> {
    return this.booksService.putAsset(site, uid, 'pdf_contents', 'create', {
      fileId: dto.fileId,
      file,
    });
  }

  @Put(':uid/pdf-contents')
  @PartnerRateLimitBucket('heavy')
  @UseInterceptors(ASSET_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: '내지 PDF 교체 — 미존재 시 404 ERR_ASSET_NOT_FOUND' })
  @ApiResponse({ status: 200, description: '교체 성공(기존 replaced + 신규 active)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND(도서) / ERR_ASSET_NOT_FOUND' })
  async putPdfContents(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Body() dto: AssetInputDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BookAssetView> {
    return this.booksService.putAsset(site, uid, 'pdf_contents', 'replace', {
      fileId: dto.fileId,
      file,
    });
  }

  @Post(':uid/photos')
  @PartnerRateLimitBucket('heavy')
  @UseInterceptors(ASSET_UPLOAD)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: '사진 자산 추가(다건, DRAFT 전용) — sort_order 자동 부여' })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — 추가된 사진 자산' })
  @ApiResponse({ status: 409, description: 'ERR_BOOK_NOT_DRAFT / ERR_FILE_NOT_READY' })
  @ApiResponse({ status: 422, description: 'ERR_ASSET_INCOMPATIBLE — creationType 불일치' })
  async postPhoto(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Body() dto: AssetInputDto,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<BookAssetView> {
    return this.booksService.addPhoto(site, uid, { fileId: dto.fileId, file });
  }

  // ── 최종화(W3) ──────────────────────────────────────────────────────
  // ⚠️ 정적 하위 경로(2 세그먼트라 @Get(':uid') 에 shadow 되진 않으나 선언 순서 관행 유지).
  //   POST/GET .../finalization 은 상태머신 폴링 표면, GET .../pdf 는 소유검증 스트림(§9-10).

  @Post(':uid/finalization')
  @PartnerRateLimitBucket('heavy')
  @ApiOperation({ summary: '최종화 착수 — DRAFT→FINALIZED 상태머신(폴링+웹훅 병행)' })
  @ApiResponse({ status: 201, description: '{success,message,data} 봉투 — 최종화 이력(status/attempt)' })
  @ApiResponse({ status: 409, description: 'ERR_FINALIZATION_IN_PROGRESS — 진행 중 재호출(COMPLETED 재호출=200 재전달)' })
  @ApiResponse({ status: 422, description: 'ERR_ASSETS_INCOMPLETE / ERR_PAGE_COUNT_OUT_OF_RANGE' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 없음/타 site/타 env(존재 은닉)' })
  async startFinalization(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
  ): Promise<BookFinalizationView> {
    return this.bookFinalizationsService.startFinalization(site, uid);
  }

  @Get(':uid/finalization')
  @ApiOperation({ summary: '최종화 상태 폴링 — 최신 attempt 이력' })
  @ApiResponse({ status: 200, description: '{success,message,data} 봉투 — 최종화 이력(status/outputFileId)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 도서/이력 없음' })
  async getFinalization(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
  ): Promise<BookFinalizationView> {
    return this.bookFinalizationsService.getFinalization(site, uid);
  }

  @Get(':uid/pdf')
  @PartnerRateLimitBucket('heavy')
  @ApiOperation({ summary: '최종 PDF 다운로드(소유검증 스트림) — FINALIZED 전용(§9-10)' })
  @ApiResponse({ status: 200, description: 'application/pdf 스트림(local/s3 무관 상수메모리)' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 미FINALIZED/없음/타 테넌트(존재 은닉)' })
  async downloadPdf(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Res() res: Response,
  ): Promise<void> {
    // 소유검증(테넌트 스코프)은 서비스가 수행 — 실패 시 v1 예외필터가 에러 봉투로 응답
    // (@Res 미접촉 상태라 필터가 res 를 안전 처리). 성공 시에만 스트림 파이프.
    const file = await this.bookFinalizationsService.getFinalizedPdf(site, uid);
    const { stream, size } = await this.filesService.getFileStream(file.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${uid}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (size != null && Number.isFinite(size) && size > 0) {
      res.setHeader('Content-Length', String(size));
    }
    res.on('close', () => stream.destroy());
    stream.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          errorCode: 'ERR_INTERNAL',
          message: '파일 스트리밍 중 오류가 발생했습니다',
          errors: [],
          fieldErrors: null,
          requestId: null,
        });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  }

  @Get(':uid')
  @ApiOperation({ summary: '도서 상세(테넌트 스코프)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: 'ERR_NOT_FOUND — 없음/타 site/타 env(존재 은닉)' })
  async findOne(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
  ): Promise<BookView> {
    return this.booksService.getDetail(site, uid);
  }
}
