import { Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BookSpecsService } from './book-specs.service';
import { PartnerV1Controller } from '../partner-api/partner-v1.decorator';
import { PaginatedResult } from '../partner-api/http/pagination';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import {
  BookSpecListQueryDto,
  BookSpecView,
  CalculatedSizeQueryDto,
  CalculatedSizeView,
} from './dto/book-spec.dto';

/**
 * Partner API v1 — BookSpecs (판형 마스터) GET 3종.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.2
 * 글로벌 prefix 'api' → 최종 경로 /api/v1/book-specs (설계서 모듈 배치 규약).
 *
 * v1 표준 스택 — @PartnerV1Controller 조합 데코레이터가 일괄 바인딩:
 *   @Public(전역 JwtAuthGuard 우회) + PartnerApiKeyGuard(Bearer/X-API-Key 병행)
 *   + PartnerRateLimitGuard(per-Key §5.2) + 에러 필터(§3.2) + 감사→멱등→봉투
 *   인터셉터(§3.1). 핸들러는 순수 데이터만 반환 — 봉투 수동 래핑 금지
 *   (이중 래핑 방지). 목록 라우트는 PaginatedResult 로 pagination 을 싣는다.
 *
 * 레이트리밋 버킷: GET 3종(calculated-size 포함) 전부 기본 'general'(300/min)
 *   — 읽기 전용 마스터 조회라 heavy(업로드/최종화 100/min) 대상 아님.
 *
 * v1 은 읽기 전용 — 검증측(워커) 상수·로직 무접촉. 기존 @Public spine
 * 3라우트(POST /products/spine/calculate 등)는 무접촉 병존(AD-1).
 */
@ApiTags('partner-v1')
@ApiSecurity('api-key')
@PartnerV1Controller('book-specs')
export class BookSpecsController {
  constructor(private readonly bookSpecsService: BookSpecsService) {}

  @Get()
  @ApiOperation({ summary: '판형 목록 (페이지네이션·필터 coverType/bindingType/isActive)' })
  @ApiResponse({ status: 200, description: '{success,message,data,pagination} 봉투' })
  async list(
    @CurrentSite() site: CurrentSitePayload,
    @Query() query: BookSpecListQueryDto,
  ): Promise<PaginatedResult<BookSpecView>> {
    const { items, total, limit, offset } = await this.bookSpecsService.list(site.siteId, query);
    return PaginatedResult.of(items, total, { limit, offset });
  }

  @Get(':uid')
  @ApiOperation({ summary: '판형 상세' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: 'ERR_BOOK_SPEC_NOT_FOUND — 없음/비활성/타 사이트' })
  async findOne(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
  ): Promise<BookSpecView> {
    return this.bookSpecsService.getDetail(site.siteId, uid);
  }

  @Get(':uid/calculated-size')
  @ApiOperation({
    summary: '페이지 수 기반 표지/내지/책등 실측 mm 계산 (기존 SpineService 재사용)',
    description:
      '응답의 각 mm 값대로 PDF 를 제작하면 워커 사이즈 검증을 ±sizeToleranceMm 내에서 통과한다',
  })
  @ApiResponse({ status: 200, description: '계산 성공' })
  @ApiResponse({ status: 400, description: 'ERR_VALIDATION_FAILED — pageCount 비정수/0/음수/누락' })
  @ApiResponse({
    status: 422,
    description:
      'ERR_PAGE_COUNT_OUT_OF_RANGE — pageMin/Max/Increment 위반 (설계서 §3.3, errors[].code 세분)',
  })
  @ApiResponse({ status: 404, description: 'ERR_BOOK_SPEC_NOT_FOUND' })
  async calculatedSize(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Query() query: CalculatedSizeQueryDto,
  ): Promise<CalculatedSizeView> {
    return this.bookSpecsService.calculateSize(site.siteId, uid, query.pageCount);
  }
}
