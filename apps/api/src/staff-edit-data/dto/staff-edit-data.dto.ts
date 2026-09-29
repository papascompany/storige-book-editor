import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * 관리자 편집데이터 관리 DTO (2026-09-29, ADDITIVE) — /api/admin/edit-data.
 * 전역 ValidationPipe(whitelist + forbidNonWhitelisted)가 선언되지 않은 키(siteId·callbackUrl 등)를 400 으로 거부한다.
 */

export const STAFF_SESSION_STATUSES = ['draft', 'editing', 'complete'] as const;
export const STAFF_RETENTION_FILTERS = ['active', 'expired', 'unset'] as const;
export const STAFF_DELETED_FILTERS = ['exclude', 'only', 'include'] as const;
export const STAFF_OUTPUT_MODES = ['separate', 'content-only', 'single'] as const;

export type StaffRetentionFilter = (typeof STAFF_RETENTION_FILTERS)[number];
export type StaffDeletedFilter = (typeof STAFF_DELETED_FILTERS)[number];
export type StaffOutputMode = (typeof STAFF_OUTPUT_MODES)[number];

/** GET /sessions/:id/files/:kind — 세션 컬럼(cover_file_id / content_file_id / content_pdf_file_id)만 */
export enum StaffSessionFileKind {
  cover = 'cover',
  content = 'content',
  contentPdf = 'contentPdf',
}

export class ListStaffSessionsQueryDto {
  @ApiPropertyOptional({ description: '사이트 id — 호출자 범위 안이어야 한다' })
  @IsOptional()
  @IsString()
  @Length(1, 36)
  siteId?: string;

  @ApiPropertyOptional({ enum: STAFF_SESSION_STATUSES })
  @IsOptional()
  @IsIn(STAFF_SESSION_STATUSES)
  status?: (typeof STAFF_SESSION_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderSeqno?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  memberSeqno?: number;

  @ApiPropertyOptional({ enum: STAFF_RETENTION_FILTERS })
  @IsOptional()
  @IsIn(STAFF_RETENTION_FILTERS)
  retention?: StaffRetentionFilter;

  @ApiPropertyOptional({ enum: STAFF_DELETED_FILTERS, default: 'exclude' })
  @IsOptional()
  @IsIn(STAFF_DELETED_FILTERS)
  deleted?: StaffDeletedFilter;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class StaffEditorSessionDto {
  @ApiPropertyOptional({ default: false, description: '편집기에서 삭제까지 허용(삭제 권한 필요)' })
  @IsOptional()
  @IsBoolean()
  allowDelete?: boolean;

  @ApiPropertyOptional({ default: 3600, minimum: 300, maximum: 28800 })
  @IsOptional()
  @IsInt()
  @Min(300)
  @Max(28800)
  ttlSeconds?: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** siteId·callbackUrl 은 받지 않는다 — 잡 사이트는 서버가 세션에서 읽는다 */
export class StaffSynthesizeDto {
  @ApiPropertyOptional({ enum: STAFF_OUTPUT_MODES, description: '미지정 = 세트 설정' })
  @IsOptional()
  @IsIn(STAFF_OUTPUT_MODES)
  outputMode?: StaffOutputMode;

  @ApiPropertyOptional({ default: false, description: '파트너 콜백·웹훅 발신' })
  @IsOptional()
  @IsBoolean()
  notifyPartner?: boolean;

  @ApiPropertyOptional({ default: false, description: '관리자 편집 후 미완료여도 합성' })
  @IsOptional()
  @IsBoolean()
  allowStale?: boolean;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class StaffRetentionReportQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 36)
  siteId?: string;
}

export class StaffAuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 36)
  siteId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'ISO8601 — 이 시각 이전 행만' })
  @IsOptional()
  @IsISO8601()
  before?: string;
}

// ── 응답 형태 ──

export interface StaffRetentionView {
  days: number | null;
  until: string | null;
  state: 'unset' | 'active' | 'expired';
  anchor: 'createdAt';
}

export interface StaffOrderMeta {
  productName: string | null;
  title: string | null;
  quantity: number | null;
  size: string | null;
}

export interface StaffSessionItem {
  id: string;
  siteId: string | null;
  siteName: string | null;
  orderSeqno: number;
  memberSeqno: number;
  memberId: string | null;
  orderMeta: StaffOrderMeta | null;
  isGuest: boolean;
  status: string;
  mode: string;
  templateSetId: string | null;
  templateSetName: string | null;
  coverFileId: string | null;
  contentFileId: string | null;
  contentPdfFileId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
  deletedAt: string | null;
  retention: StaffRetentionView;
  staffEditedAfterComplete: boolean;
  canDelete: boolean;
}

export interface StaffSessionListResponse {
  items: StaffSessionItem[];
  total: number;
  page: number;
  limit: number;
}

export interface StaffJobItem {
  id: string;
  jobType: string;
  status: string;
  capability: string | null;
  staffInitiated: boolean;
  createdAt: string | null;
  completedAt: string | null;
  hasOutput: boolean;
}

export interface StaffEditorSessionResponse {
  success: true;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  grantId: string;
  grantExpiresAt: string;
  capabilities: string[];
  sessionId: string;
  editorPath: string;
}

export interface StaffRetentionReportRow {
  siteId: string | null;
  siteName: string | null;
  editRetentionDays: number | null;
  total: number;
  active: number;
  expired: number;
  expiredDeleted: number;
  unset: number;
  purge: 'disabled';
}
