import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 도련 자동 삽입(fix-bleed, 2026-07-13) — BLEED_MISSING(extendBleed) 실행기 DTO.
 *
 * 고객이 재단 사이즈(=templateSet 판형)로 업로드한 내지 PDF 를 작업 사이즈
 * (판형 + 사방 bleedMm×2)로 변환(콘텐츠 무스케일 중앙 배치)한 **새 파일**을 만든다.
 * 비동기 — 반환 WorkerJob(jobId) 폴링(GET /worker-jobs/:id) → COMPLETED 시 outputFileId.
 *
 * ⚠️ editSize 는 클라이언트가 보내지 않는다 — 서버가 templateSetId 로 판형·bleedMm·
 *    sizeToleranceMm 을 권위 산출(@Public 라우트의 임의 사이즈 입력 남용 방어).
 */
export class CreateBleedFixJobDto {
  @ApiProperty({ example: 'uuid', description: '원본 PDF 파일 ID' })
  @IsUUID()
  @IsNotEmpty()
  fileId: string;

  @ApiProperty({
    example: 'uuid',
    description: '템플릿셋 ID — 서버가 판형(width/height)+bleedMm 로 작업사이즈(editSize)를 산출',
  })
  @IsUUID()
  @IsNotEmpty()
  templateSetId: string;
}
