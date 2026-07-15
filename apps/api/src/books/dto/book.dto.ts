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
      'book_specs uid(bs_...). 생략 시 book_spec 없이 DRAFT 생성(시드 게이트). ' +
      '존재/활성/테넌트 스코프 위반 시 404 ERR_BOOK_SPEC_NOT_FOUND',
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
      'EDITOR_SESSION 승격 원본 file_edit_sessions 참조. ⚠️ W4 스텁 — 완료/소유 실검증과 ' +
      '세션 산출 PDF 의 book_assets 연결은 W4. 본 배치는 참조 저장(EDITOR_SESSION 한정)까지.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sessionId?: string;

  @ApiPropertyOptional({
    description:
      'TEMPLATE/MIX_COVER_TEMPLATE 바인딩 templateSet. ⚠️ W4 스텁 — 실검증·바인딩 자산 연결은 W4.',
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
