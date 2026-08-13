import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsSafeFileRef } from './is-safe-file-ref.validator';
import { PartnerEnv } from '../../partner-api/partner-api.constants';

/**
 * Compose-mixed 잡 생성 DTO — 인쇄 워크플로우 v1 Phase 5 (2026-05-19).
 *
 * 표지 + 앞면지 N + 내지(편집 또는 첨부 PDF) + 뒷면지 K 를 합본 PDF 로 생성.
 * 출력 순서: [표지, 앞면지 1..N, 내지, 뒷면지 1..K] (고정).
 */
export class CreateComposeMixedJobDto {
  @ApiPropertyOptional({ description: '편집 세션 ID' })
  @IsOptional()
  @IsUUID()
  editSessionId?: string;

  // ── 표지 ──
  @ApiPropertyOptional({ description: '표지 PDF URL (coverEditable=true 일 때)' })
  @IsOptional()
  @IsString()
  @IsSafeFileRef()
  coverUrl?: string;

  @ApiPropertyOptional({ default: true, description: '표지 편집 가능 여부 (false=레더커버)' })
  @IsOptional()
  @IsBoolean()
  coverEditable?: boolean;

  @ApiPropertyOptional({ description: '표지 폭 (mm) — 빈 표지 생성 시 사용', example: 210 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  coverWidthMm?: number;

  @ApiPropertyOptional({ description: '표지 높이 (mm)', example: 297 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  coverHeightMm?: number;

  // ── 면지 ──
  @ApiPropertyOptional({
    description: '앞면지 URL 배열 (null 원소는 빈 면지 페이지)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsSafeFileRef({ each: true })
  frontEndpaperUrls?: (string | null)[];

  @ApiPropertyOptional({
    description: '뒷면지 URL 배열 (null 원소는 빈 면지 페이지)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsSafeFileRef({ each: true })
  backEndpaperUrls?: (string | null)[];

  // ── 내지 ──
  @ApiPropertyOptional({ description: '내지 PDF URL (편집 결과 또는 첨부 PDF)' })
  @IsOptional()
  @IsString()
  @IsSafeFileRef()
  contentPdfUrl?: string;

  @ApiPropertyOptional({ description: '내지 폭 (mm)', example: 210 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  contentWidthMm?: number;

  @ApiPropertyOptional({ description: '내지 높이 (mm)', example: 297 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  contentHeightMm?: number;

  @ApiPropertyOptional({
    description: '출력 모드: separate(표지+내지 분리), content-only(내지만), single(낱장 단일)',
    enum: ['separate', 'content-only', 'single'],
  })
  @IsOptional()
  @IsString()
  outputMode?: 'separate' | 'content-only' | 'single';

  @ApiPropertyOptional({ description: '완료 시 콜백 URL' })
  @IsOptional()
  @IsString()
  callbackUrl?: string;

  @ApiPropertyOptional({ description: '주문 번호 (선택)' })
  @IsOptional()
  @IsString()
  orderId?: string;

  /**
   * [자동조립 opt-in, 2026-08-13] true 일 때만 서버가 `editSessionId` 세션에서
   * 표지/내지/면지/판형을 도출해 **빈 자리만** 채운다(dto 명시값이 항상 우선).
   *
   * ⚠️ 미전달/false = 기존 경로와 한 줄도 다르지 않게 동작한다(무중단 최우선).
   * ⚠️ 자동조립 경로에만 인가가 걸린다 — 검증된 shop-session JWT 의 siteId 와
   *    세션 siteId 가 **둘 다 존재하고 일치**할 때만 허용, 아니면 404 SESSION_NOT_FOUND.
   */
  @ApiPropertyOptional({
    default: false,
    description: '세션 자동조립(opt-in) — 빈 필드만 세션/템플릿셋에서 도출',
  })
  @IsOptional()
  @IsBoolean()
  assembleFromSession?: boolean;

  /**
   * Phase C — 다른 라우트에서는 컨트롤러가 `@CurrentSite()` 로 자동 주입한다.
   *
   * ⚠️ [2026-08-13] compose-mixed 라우트는 `@Public` 이라 이 필드가 **무인증 호출자 입력**이다.
   *    잡 스탬프로 그대로 채택되지 않는다 — 검증된 shop-session 의 siteId 와 일치할 때만
   *    채택되고, 불일치·토큰 부재면 무시(NULL 스탬프)된다(400 아님, 무중단).
   *    판정 근거: worker-jobs.service.ts `resolveComposeMixedSiteId`.
   */
  @IsOptional()
  @IsUUID()
  siteId?: string;
}

/**
 * [Stage 3 W5] createComposeMixedJob 서비스 입력 계약 — dto:any 제거용(TS strict).
 *
 * CreateComposeMixedJobDto(외부 라우트 경유, class-validator 검증본)와 finalization
 * 오케스트레이터(W3)의 내부 호출을 모두 수용하는 구조 타입. 전 필드 optional 이라
 * DTO(부분집합)·내부 plain 객체 양쪽이 구조적으로 대입 가능하다.
 *
 * - outputMode 는 string 폭(런타임은 @IsString 만 검증 — 'merged' 폴백 실값 통과)이라
 *   DTO 의 좁은 유니온을 그대로 흡수한다.
 * - partnerEnv 는 [S2-5] 인증 컨텍스트 env — external 라우트(sites 키)는 미전달=live 고정
 *   (기존 호출 불변), finalization 은 book.env('test'|'live')를 전달해 isTest 더미 발화.
 */
export interface ComposeMixedJobInput {
  editSessionId?: string;
  coverUrl?: string;
  coverEditable?: boolean;
  coverWidthMm?: number;
  coverHeightMm?: number;
  frontEndpaperUrls?: (string | null)[];
  backEndpaperUrls?: (string | null)[];
  contentPdfUrl?: string;
  contentWidthMm?: number;
  contentHeightMm?: number;
  outputMode?: string;
  callbackUrl?: string;
  orderId?: string;
  siteId?: string;
  /**
   * [자동조립 opt-in] 외부 라우트 DTO 와 동일 의미(위 필드 주석 참조).
   * 미전달=기존 동작 불변 — finalization 오케스트레이터(W3)는 전달하지 않는다.
   */
  assembleFromSession?: boolean;
  /** [S2-5] 인증 컨텍스트 env — 미전달=live(기존 불변). 'test'=isTest 더미 산출. */
  partnerEnv?: PartnerEnv;
  /** [Stage 3 W3] books finalization 역참조 마커(#4) — 부재=기존 옵션 불변 */
  finalizationId?: string;
}
