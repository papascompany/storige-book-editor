import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
} from '../../partner-api/http/pagination';
import {
  BOOK_CREATION_TYPES,
  BOOK_STATUSES,
  type BookCreationType,
  type BookStatus,
} from '../books.constants';

/**
 * Partner API v1 Books DTO 모음.
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1·§2.4·§5.1
 *
 * 봉투/페이지네이션 shape 는 v1 코어 정본을 사용한다(수동 래핑 금지 — 이중 래핑 방지).
 * 내부 UUID(id)·siteId 는 외부 view 에 비노출(§2.0 접두 체계).
 */

/** POST /api/v1/books body (설계서 §1 표 #4) */
export class CreateBookDto {
  @ApiProperty({ enum: BOOK_CREATION_TYPES, description: '생성 유형 4종(필수)' })
  @IsIn(BOOK_CREATION_TYPES as unknown as string[])
  creationType: BookCreationType;

  @ApiPropertyOptional({
    description:
      'book_specs uid(bs_...). 생략하면 판형 없이 DRAFT 로 생성한다. ' +
      '존재하지 않거나 비활성이거나 다른 테넌트의 판형이면 404 ERR_BOOK_SPEC_NOT_FOUND',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  bookSpecUid?: string;

  @ApiPropertyOptional({ description: '총 페이지 수(양의 정수, 선택 — finalization 시 확정)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  pageCount?: number;

  @ApiPropertyOptional({
    description:
      'EDITOR_SESSION 승격에 사용할 편집 세션 식별자(creationType=EDITOR_SESSION 이면 필수). ' +
      '서버가 세션의 완료(COMPLETE) 상태와 테넌트 소유를 검증한 뒤, 세션 산출 PDF 를 ' +
      'pdf_contents 자산으로 자동 연결한 DRAFT 도서를 생성한다. 누락 400 ERR_VALIDATION_FAILED / ' +
      '미존재·타테넌트·소유 사이트 없음 404 ERR_NOT_FOUND / 미완료·산출물 없음 409 ERR_SESSION_NOT_PROMOTABLE',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @ApiPropertyOptional({
    description:
      'TEMPLATE/MIX_COVER_TEMPLATE 바인딩용 templateSet 식별자. 두 creationType 은 생성(201 DRAFT)까지만 ' +
      '되고 최종화가 422 ERR_ASSETS_INCOMPLETE(TEMPLATE_COVER_NOT_RENDERED) 로 거부되므로, ' +
      '현재 이 값은 저장·바인딩되지 않는다.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  templateSetId?: string;

  @ApiPropertyOptional({ description: '표시명(선택)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: '파트너측 자체 참조 ID(자유)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  partnerRef?: string;
}

/** GET /api/v1/books 쿼리 (설계서 §1 표 #5 — status/creationType 필터 + 페이지네이션) */
export class BookListQueryDto {
  @ApiPropertyOptional({ enum: BOOK_STATUSES, description: '상태 필터' })
  @IsOptional()
  @IsIn(BOOK_STATUSES as unknown as string[])
  status?: BookStatus;

  @ApiPropertyOptional({ enum: BOOK_CREATION_TYPES, description: '생성 유형 필터' })
  @IsOptional()
  @IsIn(BOOK_CREATION_TYPES as unknown as string[])
  creationType?: BookCreationType;

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

/** 도서 목록/상세 공용 노출 shape — 내부 UUID(id)·siteId 는 비노출 */
export interface BookView {
  uid: string;
  env: 'test' | 'live';
  creationType: BookCreationType;
  status: BookStatus;
  /** 연결된 판형 uid(bs_...). 미연결(시드 게이트) 시 null */
  bookSpecUid: string | null;
  pageCount: number | null;
  title: string | null;
  partnerRef: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
}
