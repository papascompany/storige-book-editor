import { IsString, IsNotEmpty, IsObject, IsEnum, IsOptional, IsUUID, ValidateIf, IsNumber, IsIn, IsUrl, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WorkerJobType, OutputFile } from '@storige/types';

export class CreateValidationJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '파일 ID (fileUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/file.pdf', description: '파일 URL (fileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.fileId)
  @IsString()
  @IsNotEmpty()
  fileUrl?: string;

  @ApiProperty({ example: 'cover', enum: ['cover', 'content', 'post_process'] })
  @IsString()
  @IsNotEmpty()
  fileType: 'cover' | 'content' | 'post_process';

  @ApiProperty({
    example: {
      size: { width: 210, height: 297 },
      pages: 4,
      binding: 'perfect',
      bleed: 3,
      paperThickness: 0.1,
      spineWidthMm: 1.0,
      wingEnabled: false,
      wingWidthMm: 0,
    },
  })
  @IsObject()
  @IsNotEmpty()
  orderOptions: {
    size: { width: number; height: number };
    pages: number;
    binding: 'perfect' | 'saddle' | 'spring';
    bleed: number;
    paperThickness?: number;
    /** 책등 폭(mm) — /products/spine/calculate 권위 값. 있으면 워커가 직접 사용(bindingMargin 포함) */
    spineWidthMm?: number;
    /** 날개(wing/flap) 사용 여부 — 표지 총너비 검증에 반영 */
    wingEnabled?: boolean;
    /** 날개 한쪽 폭(mm) */
    wingWidthMm?: number;
    /** 사방 블리드 mm (2026-06-10, P1) — 워커는 받기만(optional), 검증/변환 실제 사용은 P4 */
    bleedMm?: number;
    /** 재단선 마커 표기 ON/OFF (2026-06-10, P1) */
    cropMarkEnabled?: boolean;
    /** 업로드 PDF 사이즈 검증 허용오차 mm (2026-06-10, P1) */
    sizeToleranceMm?: number;
    /** 재단(완성) 사이즈 = 템플릿셋 판형 mm (2026-06-10, P1). 워커 수신 필드명 일치 */
    trimSize?: { width: number; height: number };
    /** 작업 사이즈 = 재단 + 사방 블리드*2 mm (2026-06-10, P1). 워커 수신 필드명 일치 */
    workSize?: { width: number; height: number };
    /**
     * 내지 페이지수 배수(데이터 주도 계약, 2026-06-25) — 파트너가 제본별 값 전달(무선=2/양장=4/중철=4/스프링=8 등).
     * 제공 시 워커가 binding 하드코딩 대신 이 값으로 검증(PAGE_COUNT_INVALID·자동수정). 미제공 시 레거시 폴백.
     */
    pageMultiple?: number;
    /** 제본별 페이지수 상한(중철 64 등). 미제공 시 레거시 폴백. */
    pageCountMax?: number;
    /** 제본별 페이지수 하한(무선 32 등). 미제공 시 미검사. 위반=경고(비차단). */
    pageCountMin?: number;
  };

  @ApiPropertyOptional({
    example: 'https://bookmoa.com/api/webhook/validation',
    description: '검증 완료/실패 시 콜백 URL (editSessionId 없이 서버 간 통신에 사용)',
  })
  @IsOptional()
  // SEC-009: http/https 절대 URL 만 허용(file://·상대경로 등 차단). SSRF 1차 방어는
  // WebhookService.isAllowedCallbackUrl(allowlist) — 여기선 입력 형식 위생.
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  callbackUrl?: string;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class CreateConversionJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '편집 세션 ID (P4 임포지션 결과 콜백 역참조용)' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '파일 ID (fileUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/file.pdf', description: '파일 URL (fileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.fileId)
  @IsString()
  @IsNotEmpty()
  fileUrl?: string;

  @ApiProperty({
    example: {
      addPages: true,
      applyBleed: true,
      targetPages: 4,
      bleed: 3,
    },
  })
  @IsObject()
  @IsNotEmpty()
  convertOptions: any;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

/**
 * 페이지수 배수 보정(fix-pagecount, 2026-06-25) — 데이터 주도 검증 d1 빈페이지 추가 실행기.
 * 검증이 PAGE_COUNT_INVALID(배수위반, autoFixable)로 끝난 파일을 targetMultiple 배수까지
 * 백지로 보정한 **새 파일**을 만든다. 비동기 — 반환 WorkerJob(jobId) 폴링 → COMPLETED 시 outputFileId.
 * 내부적으로 pdf-conversion(addPages) 재사용. 원본 fileId 는 보존.
 */
export class CreatePageCountFixJobDto {
  @ApiProperty({ example: 'uuid', description: '원본 PDF 파일 ID' })
  @IsUUID()
  @IsNotEmpty()
  fileId: string;

  @ApiProperty({ example: 4, description: '맞출 페이지수 배수(2/4/8 등). 결과 = ceil(현재/배수)*배수' })
  @IsNumber()
  targetMultiple: number;

  @ApiPropertyOptional({ example: 'https://bookmoa.com/api/webhook/fix', description: '완료 콜백 URL(선택)' })
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  callbackUrl?: string;

  /** Phase C — 호출 컨트롤러에서 자동 주입 */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class CreateSynthesisJobDto {
  @ApiPropertyOptional({ example: 'uuid', description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '표지 파일 ID (coverUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  coverFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/cover.pdf', description: '표지 URL (coverFileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.coverFileId)
  @IsString()
  @IsNotEmpty()
  coverUrl?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '내지 파일 ID (contentUrl 대신 사용 가능)' })
  @IsOptional()
  @IsUUID()
  contentFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/content.pdf', description: '내지 URL (contentFileId 대신 사용 가능)' })
  @ValidateIf((o) => !o.contentFileId)
  @IsString()
  @IsNotEmpty()
  contentUrl?: string;

  @ApiProperty({ example: 3.5, description: '책등 폭 (mm)' })
  @IsNumber()
  @IsNotEmpty()
  spineWidth: number;

  @ApiPropertyOptional({ example: 'ORD-2024-12345', description: '북모아 주문 번호' })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({ example: 'high', enum: ['high', 'normal', 'low'], description: '우선순위' })
  @IsOptional()
  @IsIn(['high', 'normal', 'low'])
  priority?: 'high' | 'normal' | 'low';

  @ApiPropertyOptional({ example: 'https://bookmoa.com/api/webhook/synthesis', description: '완료 시 콜백 URL' })
  @IsOptional()
  // SEC-009: http/https 절대 URL 만 허용.
  @IsUrl({ protocols: ['http', 'https'], require_tld: false, require_protocol: true })
  callbackUrl?: string;

  @ApiPropertyOptional({
    enum: ['merged', 'separate'],
    default: 'merged',
    description: '출력 형식 (merged: 병합 PDF만, separate: 병합 + 표지/내지 분리)',
  })
  @IsOptional()
  @IsIn(['merged', 'separate'])
  outputFormat?: 'merged' | 'separate';

  @ApiPropertyOptional({
    enum: ['perfect', 'saddle', 'hardcover'],
    default: 'perfect',
    description: '제본 방식 (saddle: 중철 — 표지 펼침면 2-up 자동 합성)',
  })
  @IsOptional()
  @IsIn(['perfect', 'saddle', 'hardcover'])
  bindingType?: 'perfect' | 'saddle' | 'hardcover';

  /** Phase C — 호출 컨트롤러에서 자동 주입 (X-API-Key 사용 시 req.user.siteId) */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class UpdateJobStatusDto {
  @ApiPropertyOptional({ example: 'COMPLETED', enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FIXABLE', 'FAILED'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'uuid', description: '출력 파일 ID' })
  @IsOptional()
  @IsUUID()
  outputFileId?: string;

  @ApiPropertyOptional({ example: 'https://example.com/output.pdf' })
  @IsOptional()
  @IsString()
  outputFileUrl?: string;

  @ApiPropertyOptional({
    example: [
      { type: 'cover', url: '/storage/outputs/xxx/cover.pdf' },
      { type: 'content', url: '/storage/outputs/xxx/content.pdf' },
    ],
    description: '분리 출력 파일 목록 (separate 모드에서만)',
  })
  @IsOptional()
  @IsArray()
  outputFiles?: OutputFile[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  result?: any;

  @ApiPropertyOptional({ example: 'Processing failed: Invalid PDF' })
  @IsOptional()
  @IsString()
  errorMessage?: string;

  /**
   * WK-1 (2026-06-13) — 세분화 에러 코드 (예: 'PAGE_COUNT_MISMATCH').
   * 워커 split/duplex-split/spread 실패 경로가 DomainError.code 를 보내는데,
   * 전역 ValidationPipe(forbidNonWhitelisted)가 DTO 미정의 필드를 400 으로
   * 거부해 FAILED 상태 업데이트 자체가 실패하던 구멍을 막는다.
   * 엔티티 컬럼(error_code)은 기존재 — Object.assign 경유로 그대로 저장된다.
   */
  @ApiPropertyOptional({ example: 'PAGE_COUNT_MISMATCH', description: '세분화 에러 코드 (DomainError.code)' })
  @IsOptional()
  @IsString()
  errorCode?: string;

  /** WK-1 — 에러 상세 정보 (JSON). 엔티티 컬럼(error_detail) 기존재. */
  @ApiPropertyOptional({
    example: { expected: 4, got: 3 },
    description: '에러 상세 정보 (JSON)',
  })
  @IsOptional()
  @IsObject()
  errorDetail?: Record<string, any>;

  @ApiPropertyOptional({ example: '123', description: 'Bull queue job ID (디버깅용)' })
  @IsOptional()
  queueJobId?: string | number;
}
