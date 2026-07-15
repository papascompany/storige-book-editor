import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { BookSpecsService } from './book-specs.service';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { CurrentSite, CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import {
  BookSpecListQueryDto,
  BookSpecView,
  CalculatedSizeQueryDto,
  CalculatedSizeView,
  V1Envelope,
  v1Envelope,
} from './dto/book-spec.dto';

/**
 * Partner API v1 — BookSpecs (판형 마스터) GET 3종.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.2
 * 글로벌 prefix 'api' → 최종 경로 /api/v1/book-specs (설계서 모듈 배치 규약).
 *
 * 인증 — v1 무인증 라우트 0 원칙(설계서 §1.1):
 *   @Public(전역 JwtAuthGuard 우회) + ApiKeyGuard(X-API-Key) 조합 —
 *   guarded-routes.spec 의 기존 외부 라우트와 동일 규약.
 *   ⚠️ 병렬 트랙 A 가 PartnerApiKeyGuard(Bearer 병행, AD-5)를 구현 중 —
 *   통합 시 ApiKeyGuard → PartnerApiKeyGuard 치환 예정(이 파일이 치환 지점).
 *
 * 응답 봉투 — 트랙 A 의 v1 성공 인터셉터 병합 전이라 컨트롤러에서
 *   v1Envelope() 로 자체 구성한다. 인터셉터 통합 시 여기 수동 래핑을 제거해
 *   이중 래핑을 방지할 것.
 *
 * v1 은 읽기 전용 — 검증측(워커) 상수·로직 무접촉. 기존 @Public spine
 * 3라우트(POST /products/spine/calculate 등)는 무접촉 병존(AD-1).
 */
@ApiTags('Partner API v1 — BookSpecs')
@ApiSecurity('api-key')
@Controller('v1/book-specs')
@Public()
@UseGuards(ApiKeyGuard)
export class BookSpecsController {
  constructor(private readonly bookSpecsService: BookSpecsService) {}

  @Get()
  @ApiOperation({ summary: '판형 목록 (페이지네이션·필터 coverType/bindingType/isActive)' })
  @ApiResponse({ status: 200, description: '{success,message,data,pagination} 봉투' })
  async list(
    @CurrentSite() site: CurrentSitePayload,
    @Query() query: BookSpecListQueryDto,
  ): Promise<V1Envelope<BookSpecView[]>> {
    const { items, pagination } = await this.bookSpecsService.list(site.siteId, query);
    return v1Envelope(items, pagination);
  }

  @Get(':uid')
  @ApiOperation({ summary: '판형 상세' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: 'ERR_BOOK_SPEC_NOT_FOUND — 없음/비활성/타 사이트' })
  async findOne(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
  ): Promise<V1Envelope<BookSpecView>> {
    return v1Envelope(await this.bookSpecsService.getDetail(site.siteId, uid));
  }

  @Get(':uid/calculated-size')
  @ApiOperation({
    summary: '페이지 수 기반 표지/내지/책등 실측 mm 계산 (기존 SpineService 재사용)',
    description:
      '응답의 각 mm 값대로 PDF 를 제작하면 워커 사이즈 검증을 ±sizeToleranceMm 내에서 통과한다',
  })
  @ApiResponse({ status: 200, description: '계산 성공' })
  @ApiResponse({ status: 400, description: 'ERR_PAGE_COUNT_OUT_OF_RANGE / DTO 검증 실패' })
  @ApiResponse({ status: 404, description: 'ERR_BOOK_SPEC_NOT_FOUND' })
  async calculatedSize(
    @CurrentSite() site: CurrentSitePayload,
    @Param('uid') uid: string,
    @Query() query: CalculatedSizeQueryDto,
  ): Promise<V1Envelope<CalculatedSizeView>> {
    return v1Envelope(
      await this.bookSpecsService.calculateSize(site.siteId, uid, query.pageCount),
    );
  }
}
