import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '../../partner-api/http/pagination';

/**
 * Partner API v1 BookSpecs DTO 모음.
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.2·§3·§5.1
 *
 * 봉투/페이지네이션 shape 는 v1 코어 정본을 사용한다 —
 * @storige/types PartnerV1SuccessEnvelope·PartnerV1Pagination +
 * partner-api/http/pagination(PaginatedResult, PAGINATION_DEFAULT/MAX_LIMIT).
 * (통합 전 임시 V1Envelope/v1Envelope 수동 래핑은 제거됨 — 이중 래핑 방지)
 */

/** GET /api/v1/book-specs 쿼리 */
export class BookSpecListQueryDto {
  @ApiPropertyOptional({ example: 'softcover', description: '커버 종류 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  coverType?: string;

  @ApiPropertyOptional({ example: 'perfect', description: '제본 방식 필터' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bindingType?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: '활성 여부 필터. 미지정 시 활성 판형만 노출(외부 대면 기본)',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: 'true' | 'false';

  @ApiPropertyOptional({ default: PAGINATION_DEFAULT_LIMIT, maximum: PAGINATION_MAX_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** GET /api/v1/book-specs/{uid}/calculated-size 쿼리 — 비정수/0/음수/누락 = 400 */
export class CalculatedSizeQueryDto {
  @ApiProperty({ example: 100, description: '총 페이지 수 (양의 정수)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  pageCount: number;
}

/** 판형 목록/상세 공용 노출 shape — 내부 UUID(id)·siteId 는 비노출 */
export interface BookSpecView {
  uid: string;
  name: string;
  coverType: string;
  bindingType: string;
  orientation: 'portrait' | 'landscape';
  innerTrimWidthMm: number;
  innerTrimHeightMm: number;
  bleedMm: number;
  sizeToleranceMm: number;
  pageMin: number;
  pageMax: number;
  pageIncrement: number;
  defaultPaperCode: string | null;
  isActive: boolean;
}

/** calculated-size 응답 data shape (설계서 §1.2 #3) */
export interface CalculatedSizeView {
  bookSpecUid: string;
  pageCount: number;
  /**
   * 사이즈 검증 허용오차 mm — 응답의 각 mm 값대로 PDF 를 제작하면
   * 워커 사이즈 검증을 통과한다(±sizeToleranceMm).
   * 워커 폴백 상수 LEGACY_SIZE_TOLERANCE_MM=1 과 정합하는 값만 노출.
   */
  sizeToleranceMm: number;
  bleedMm: number;
  inner: {
    trimWidthMm: number;
    trimHeightMm: number;
    workWidthMm: number;
    workHeightMm: number;
  };
  /** 책등 — 기존 SpineService 계산 재사용. 계수 미구성 시 null + warning */
  spine: {
    widthMm: number;
    paperThicknessMm: number;
    bindingMarginMm: number;
    formula: string;
  } | null;
  /** 표지 펼침면(앞+책등+뒤) — spine 미계산 시 null + warning */
  cover: {
    trimWidthMm: number;
    trimHeightMm: number;
    workWidthMm: number;
    workHeightMm: number;
  } | null;
  warnings: Array<{ code: string; message: string }>;
}
