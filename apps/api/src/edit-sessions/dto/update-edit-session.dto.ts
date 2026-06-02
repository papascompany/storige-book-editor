import { IsOptional, IsObject, IsEnum, IsUUID, IsInt, Min, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SessionStatus } from '../entities/edit-session.entity';

export class UpdateEditSessionDto {
  // 캔버스 데이터: 단일 페이지는 객체, 멀티페이지(책자/스프레드)는 페이지별 배열.
  // @IsObject() 는 배열을 거부하므로 사용하지 않는다 (멀티페이지 autosave 400 회귀 방지, 2026-06-02).
  @ApiPropertyOptional({ description: '캔버스 데이터 (단일 객체 또는 멀티페이지 배열)' })
  @IsOptional()
  canvasData?: any;

  @ApiPropertyOptional({ description: '메타데이터' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiPropertyOptional({ example: 'complete', enum: SessionStatus, description: '세션 상태' })
  @IsOptional()
  @IsEnum(SessionStatus)
  status?: SessionStatus;

  @ApiPropertyOptional({ example: 'uuid', description: '표지 파일 ID' })
  @IsOptional()
  @IsUUID()
  coverFileId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '내지 파일 ID' })
  @IsOptional()
  @IsUUID()
  contentFileId?: string;

  // ── 인쇄 워크플로우 v1 Phase 4 (2026-05-19) ──
  // 고객 첨부 내지 PDF 흐름. 결정 3-3: PDF 첨부 ↔ 편집 배타.
  // 결정 3-4: 검증 실패 시 첨부 자체 거부 — validationResult.issues 있으면 클라가 거부 UI 노출.

  @ApiPropertyOptional({ example: 'uuid', description: '고객 첨부 내지 PDF file_id (Phase 4)' })
  @IsOptional()
  @IsUUID()
  contentPdfFileId?: string | null;

  @ApiPropertyOptional({ example: 24, description: 'PDF 페이지수 (자동 페이지 확장 계산용)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  contentPdfPageCount?: number | null;

  @ApiPropertyOptional({ description: '워커 검증 결과 캐시 (issues, warnings, metadata)' })
  @IsOptional()
  @IsObject()
  contentPdfValidationResult?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    enum: ['replace', 'underlay'],
    description: 'P0-2: 내지 PDF 첨부 모드. replace=PDF만 인쇄(배타), underlay=PDF 배경+편집 허용',
  })
  @IsOptional()
  @IsIn(['replace', 'underlay'])
  contentPdfMode?: 'replace' | 'underlay' | null;
}
