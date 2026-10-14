import { ApiProperty } from '@nestjs/swagger';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import type { PartnerJobOptions, PartnerJobPrimitive, PartnerJobView } from '../partner-job-view';

/**
 * 파트너 잡 응답 스키마 — OpenAPI 문서 전용(검증·변환 없음).
 *
 * 응답 형태는 partner-job-view.ts `toPartnerJobView` 가 정하고, 이 클래스는 그 형태를 문서에 싣기만 한다.
 * 속성 집합은 `PARTNER_JOB_VIEW_KEYS` 와 같아야 한다(partner-job-view.dto.spec).
 * 공개 문서에 그대로 실리므로 description 에는 응답 계약만 적는다.
 */
export class PartnerJobViewDto implements PartnerJobView {
  @ApiProperty({ description: '작업 ID', format: 'uuid' })
  id: string;

  @ApiProperty({ enum: WorkerJobType, description: '작업 유형' })
  jobType: WorkerJobType;

  @ApiProperty({ enum: WorkerJobStatus, description: '작업 상태' })
  status: WorkerJobStatus;

  @ApiProperty({ type: String, nullable: true, description: '편집 세션 ID(없으면 null)' })
  editSessionId: string | null;

  @ApiProperty({ type: String, nullable: true, description: '분리 합성 세션 ID(없으면 null)' })
  sessionId: string | null;

  @ApiProperty({ type: String, nullable: true, description: '산출 파일 ID(없으면 null)' })
  outputFileId: string | null;

  @ApiProperty({ type: String, nullable: true, description: '산출물 URL(없으면 null)' })
  outputFileUrl: string | null;

  @ApiProperty({ type: String, nullable: true, description: '작업 오류 코드(없으면 null). 분기는 status·errorCode 로 한다' })
  errorCode: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: '생성 시각' })
  createdAt: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: '완료 시각(없으면 null)' })
  completedAt: Date | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'contentTrim·siteWebhook·editSessionId 키만 싣는다. 셋 다 없으면 null',
  })
  options: PartnerJobOptions | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      '검증 작업(VALIDATE): 기록된 형식을 유지한다 — 보통 { result: { isValid, errors, warnings, metadata } } 로 감싼 형식이고, ' +
      '감싸지 않고 기록된 작업은 { isValid, errors, warnings, metadata } 형식이다. errors·warnings 항목은 ' +
      'code·message·details·autoFixable·fixMethod 만 싣고, code 가 FILE_CORRUPTED 인 항목은 message 가 고정 문구이며 details 가 없다. ' +
      '기록값이 객체가 아니면 null. 그 밖의 작업 유형: 기록된 값 그대로(없으면 null)',
  })
  result: unknown;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '사람용 안내 문구. 검증 작업은 errors 항목의 message 를 "; " 로 이은 값, 그 밖에는 errorCode 에 대응하는 문구 ' +
      '또는 작업 유형별 고정 문구. null·빈 문자열은 그대로',
  })
  errorMessage: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }], nullable: true },
    nullable: true,
    description: '문자열·수·불리언·null 값의 키만 싣는다. 남는 키가 없으면 null',
  })
  errorDetail: Record<string, PartnerJobPrimitive> | null;
}
