import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PageImpositionLayout,
  ReaderSpread,
  SpreadStartSide,
} from '../../worker-jobs/imposition.util';

/**
 * 임포지션 미리보기 응답 DTO (2026-06-16).
 *
 * GET /edit-sessions/:id/imposition-preview 의 응답 형태.
 * 외부(bookmoa-mobile 등)가 "고객 첨부 내지 PDF가 책으로 묶이면
 * 펼침면이 어떻게 보이는가"를 그리기 위한 표시용 데이터.
 *
 * ⚠️ Swagger 문서화를 위한 DTO 래퍼일 뿐, layout 의 실제 계산은
 *   worker-jobs/imposition.util.ts 의 순수 함수가 담당한다.
 */

/** 리더 스프레드 1쌍 (Swagger 문서화용 — 형태는 ReaderSpread 와 동일) */
export class ReaderSpreadDto implements ReaderSpread {
  @ApiProperty({ description: '스프레드 순번(0-기반)', example: 0 })
  index: number;

  @ApiProperty({
    description: '왼쪽 페이지 번호(1-기반). 빈면이면 null',
    nullable: true,
    example: null,
  })
  left: number | null;

  @ApiProperty({
    description: '오른쪽 페이지 번호(1-기반). 빈면이면 null',
    nullable: true,
    example: 1,
  })
  right: number | null;
}

/** 리더 스프레드 레이아웃 (Swagger 문서화용) */
export class PageImpositionLayoutDto implements PageImpositionLayout {
  @ApiProperty({
    description: "펼침 시작 면 ('right'=우수 기본, 'left'=좌수)",
    enum: ['left', 'right'],
    example: 'right',
  })
  startSide: SpreadStartSide;

  @ApiProperty({
    description: '사철(saddle) 거터 없는 연속 렌더 힌트',
    example: false,
  })
  seamlessFold: boolean;

  @ApiProperty({ description: '내지 총 페이지 수', example: 8 })
  totalPages: number;

  @ApiProperty({ type: [ReaderSpreadDto], description: '펼침면 목록' })
  spreads: ReaderSpreadDto[];
}

/** 임포지션 미리보기 응답 전체 */
export class ImpositionPreviewResponseDto {
  @ApiProperty({
    description:
      '썸네일(페이지 이미지) 준비 여부. true 이면 pageImageUrls 사용 가능',
    example: false,
  })
  ready: boolean;

  @ApiProperty({
    type: [String],
    description:
      "페이지 순서대로의 가이드 이미지 URL('/storage/...'). 미생성 시 빈 배열",
    example: [],
  })
  pageImageUrls: string[];

  @ApiProperty({
    description: '래스터 해상도(dpi). 미생성 시 null',
    nullable: true,
    example: null,
  })
  resolution: number | null;

  @ApiProperty({ type: PageImpositionLayoutDto, description: '리더 스프레드 레이아웃' })
  layout: PageImpositionLayoutDto;

  @ApiProperty({ description: '제본 방식', example: 'perfect' })
  bindingType: string;

  @ApiPropertyOptional({
    description: '준비되지 않은 경우 사유(설명용)',
    example: '썸네일 미생성: 업로드/렌더 대기',
  })
  reason?: string;
}
