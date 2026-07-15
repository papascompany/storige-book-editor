import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type { BookAssetType, BookAssetStatus } from '../books.constants';

/**
 * 자산 투입 body (설계서 §2.5·§6.1) — 두 입력 형태 중 fileId 참조형.
 *
 * 파일 투입 두 형태(라우트는 둘 다 수용):
 *  ① fileId 참조 — 동결 presigned/multipart 업로드 표면(≤2GB, 전 MIME)에서 올린
 *     파일의 files.id. 본 DTO 의 fileId. status='ready' + siteId===caller 검증.
 *  ② 직접 멀티파트 업로드(≤100MB, PDF) — multipart/form-data 의 `file` 필드
 *     (@UploadedFile, 본 DTO 밖). 이미지/대용량 자산은 ① 경로를 쓴다.
 *
 * 둘 다 없으면 400 ERR_VALIDATION_FAILED, 둘 다 있으면 fileId 우선.
 */
export class AssetInputDto {
  @ApiPropertyOptional({
    description:
      'files.id (동결 업로드 표면 산출). 직접 업로드(multipart file) 대신 참조 투입 시 사용',
  })
  @IsOptional()
  @IsString()
  @MaxLength(36)
  fileId?: string;
}

/** 자산 노출 shape — 내부 UUID(book_asset.id)는 비노출, fileId(파트너 파일 핸들)는 노출 */
export interface BookAssetView {
  assetType: BookAssetType;
  /** files.id — 동결 파일 표면(GET /files/:id/...)의 파트너 파일 핸들 */
  fileId: string | null;
  sortOrder: number;
  status: BookAssetStatus;
  createdAt: string;
}
