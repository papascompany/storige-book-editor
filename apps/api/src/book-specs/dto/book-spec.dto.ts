import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Partner API v1 BookSpecs DTO 모음.
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.2·§3·§5.1
 */

/** v1 목록 페이지네이션 기본값 (설계서 §5.1: limit 기본 20 / 최대 100 캡) */
export const V1_PAGINATION_DEFAULT_LIMIT = 20;
export const V1_PAGINATION_MAX_LIMIT = 100;

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

  @ApiPropertyOptional({ default: V1_PAGINATION_DEFAULT_LIMIT, maximum: V1_PAGINATION_MAX_LIMIT })
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

/** v1 목록 응답의 pagination 객체 (설계서 §5.1) */
export interface V1Pagination {
  total: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

/**
 * v1 성공 봉투 {success,message,data,pagination} (설계서 §3.1).
 *
 * ⚠️ 트랙 A(partner-api 모듈)의 v1 성공 봉투 인터셉터가 병합되기 전이라
 *    컨트롤러에서 자체 구성한다. 인터셉터 통합 시 이 수동 래핑을 제거해
 *    이중 래핑({success,data:{success,data:...}})을 방지할 것 — 통합 포인트.
 */
export interface V1Envelope<T> {
  success: true;
  message: string;
  data: T;
  pagination: V1Pagination | null;
}

export function v1Envelope<T>(data: T, pagination: V1Pagination | null = null): V1Envelope<T> {
  return { success: true, message: 'Success', data, pagination };
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
