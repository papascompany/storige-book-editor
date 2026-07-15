import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Max, Min } from 'class-validator';

export class CreateSiteDto {
  @ApiProperty({ example: '북모아 메인', description: '사이트명' })
  @IsString()
  @Length(1, 100)
  name: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  domain?: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr/mypage' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrlBase?: string;

  @ApiPropertyOptional({ example: 'https://www.bookmoa.co.kr/storige/proc/synthesis_callback.php' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  // S2-4: 타입만 | null 확장 — @IsOptional 은 원래 null 도 스킵하므로 런타임 불변.
  // (포털 셀프 PATCH 가 콜백 해제(null) 를 타입 안전하게 전달하기 위함)
  uploadCallbackUrl?: string | null;

  @ApiPropertyOptional({
    description:
      '편집기 인증코드 (X-API-Key). 미입력 시 자동 생성 (sk-storige-{32hex})',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  editorAuthCode?: string;

  @ApiPropertyOptional({
    description: '워커 인증코드. 미입력 시 editorAuthCode와 동일 값 사용',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  workerAuthCode?: string;

  @ApiPropertyOptional({ example: 'active', enum: ['active', 'suspended'] })
  @IsOptional()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';

  @ApiPropertyOptional({
    description: '파일 보존 기간(일). null/0=영구보관. 이 사이트 업로드 파일을 N일 후 자동삭제(retention cron).',
    example: 14,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3650)
  retentionDays?: number | null;

  // ── Phase B 워커 옵션 default ───────────────────────────────

  @ApiPropertyOptional({ default: true, description: 'PDF 자동 변환(addPages/applyBleed) 사용' })
  @IsOptional()
  @IsBoolean()
  pdfConversionEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Before/After 미리보기 비교 URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  beforeAfterUrl?: string;

  @ApiPropertyOptional({ enum: ['mm', 'inch'], default: 'mm' })
  @IsOptional()
  @IsIn(['mm', 'inch'])
  defaultUnit?: 'mm' | 'inch';

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  checkWorkorder?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  checkCutting?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  checkSafezone?: boolean;

  // ── Phase 1-1 (2026-05-16) — 외부 도메인 보안 정책 ────────────

  @ApiPropertyOptional({
    type: [String],
    description:
      'CORS allowlist (외부 사이트 브라우저 origin). 예: ["https://www.bookmoa.co.kr"]',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  allowedOrigins?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'iframe embed parent origin allowlist (CSP frame-ancestors). 예: ["https://www.bookmoa.co.kr"]',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  frameAncestors?: string[];

  @ApiPropertyOptional({
    enum: ['inline'],
    default: 'inline',
    description: '편집기 실행 모드 — Phase 0 결정: inline embed 단일',
  })
  @IsOptional()
  @IsIn(['inline'])
  editorLaunchMode?: 'inline';

  @ApiPropertyOptional({ description: 'Editor IIFE 번들 URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  editorBundleUrl?: string;

  @ApiPropertyOptional({ description: 'Editor CSS URL' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  editorCssUrl?: string;

  @ApiPropertyOptional({ description: 'Editor 버전 라벨 (예: 1.0.0)' })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  editorVersion?: string;
}

export class UpdateSiteDto extends PartialType(CreateSiteDto) {}
