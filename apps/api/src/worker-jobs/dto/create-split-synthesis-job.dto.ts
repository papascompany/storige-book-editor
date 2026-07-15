import {
  IsString,
  IsUUID,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsUrl,
} from 'class-validator';
import { PartnerEnv } from '../../partner-api/partner-api.constants';

/**
 * 분리 합성 작업 생성 DTO
 *
 * POST /worker-jobs/split-synthesize
 *
 * 단일 PDF에서 표지/내지를 분리하는 작업 생성
 * - pdfFileId: 업로드된 PDF 파일 ID (pdfUrl 완전 제거)
 * - sessionId: EditSession ID (pageTypes 추출용)
 * - requestId: 멱등성 키 (클라이언트 UUID 생성)
 */
export class CreateSplitSynthesisJobDto {
  /**
   * EditSession ID
   * 세션의 pages.templateType으로 pageTypes 배열 생성
   */
  @IsUUID()
  sessionId: string;

  /**
   * 업로드된 PDF 파일 ID
   * files 테이블에서 조회하여 URL 및 메타데이터 검증
   */
  @IsUUID()
  pdfFileId: string;

  /**
   * 멱등성 키
   * 클라이언트가 UUID로 생성
   * (sessionId, pdfFileId, requestId) unique
   *
   * ⚠️ 옵션 변경 시 새 requestId를 발급해야 함
   */
  @IsUUID()
  requestId: string;

  /**
   * 출력 형식
   * - 'merged': merged.pdf만 생성 (기본값)
   * - 'separate': cover.pdf + content.pdf만 생성
   */
  @IsOptional()
  @IsEnum(['merged', 'separate'])
  outputFormat?: 'merged' | 'separate';

  /**
   * separate 모드에서 merged도 함께 생성
   * outputFormat='merged'일 때는 사용 불가 (INVALID_OUTPUT_OPTIONS 에러)
   */
  @IsOptional()
  @IsBoolean()
  alsoGenerateMerged?: boolean;

  /**
   * 완료 시 호출할 웹훅 URL
   */
  @IsOptional()
  @IsUrl()
  callbackUrl?: string;

  /**
   * 작업 우선순위
   */
  @IsOptional()
  @IsEnum(['high', 'normal', 'low'])
  priority?: 'high' | 'normal' | 'low';

  /** Phase C — 호출 컨트롤러에서 자동 주입 (X-API-Key 사용 시 req.user.siteId) */
  @IsOptional()
  @IsUUID()
  siteId?: string;

  /**
   * [S2-5] 인증 컨텍스트 env — 호출 컨트롤러가 @CurrentSite().env 로 주입.
   * ⚠️ 의도적으로 validation 데코레이터 없음(비화이트리스트) — body 자가선언 불가.
   * ⚠️ `declare` 필수(ES2022 own-property 실체화 함정) —
   * worker-job.dto.ts CreateValidationJobDto.partnerEnv 주석 참조.
   */
  declare partnerEnv?: PartnerEnv;
}
