import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 첨부 내지 PDF 빈 페이지 배수 채움 (2026-09-28) DTO.
 *
 * 템플릿셋 padToPageStep=true 이고 pageStep 이 있을 때, 고객이 첨부한 내지 PDF(underlay) 끝에
 * 빈 페이지를 붙여 쪽수를 pageStep 배수로 올린 **새 파일**을 만든다(원본 보존).
 * 비동기 — 반환 WorkerJob(jobId) 폴링(GET /worker-jobs/:id) → COMPLETED 시 outputFileId.
 *
 * ⚠️ 배수(targetMultiple)는 클라이언트가 보내지 않는다 — 서버가 templateSetId 로 권위 산출
 *    (@Public 라우트의 임의 배수 입력 남용 방어, fix-bleed 와 같은 계약).
 */
export class CreateAttachPagePadJobDto {
  @ApiProperty({ example: 'uuid', description: '첨부 내지 PDF 파일 ID' })
  @IsUUID()
  @IsNotEmpty()
  fileId: string;

  @ApiProperty({
    example: 'uuid',
    description: '템플릿셋 ID — 서버가 padToPageStep·pageStep 으로 채움 여부와 배수를 산출',
  })
  @IsUUID()
  @IsNotEmpty()
  templateSetId: string;
}
