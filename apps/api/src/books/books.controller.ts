import { Body, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BooksService } from './books.service';
import { PartnerV1Controller } from '../partner-api/partner-v1.decorator';
import { PaginatedResult } from '../partner-api/http/pagination';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { BookListQueryDto, BookView, CreateBookDto } from './dto/book.dto';

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
  constructor(private readonly booksService: BooksService) {}

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
