import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  Optional,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  EditSessionEntity,
  SessionStatus,
  SessionMode,
} from './entities/edit-session.entity';
import {
  EditSessionVersionEntity,
  type EditSessionVersionReason,
} from './entities/edit-session-version.entity';
import { CreateEditSessionDto } from './dto/create-edit-session.dto';
import { UpdateEditSessionDto } from './dto/update-edit-session.dto';
import {
  EditSessionResponseDto,
  FileInfoDto,
} from './dto/edit-session-response.dto';
import {
  ExternalSessionResponseDto,
  ExternalSessionFilesDto,
} from './dto/external-session-response.dto';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { CreateValidationJobDto } from '../worker-jobs/dto/worker-job.dto';
import {
  TemplateType,
  WorkerJobStatus,
  type ProductProfile,
  type SheetSpec,
  type SpreadValidationResult,
  validateSpreadAgainstAuthority,
} from '@storige/types';
import { TemplateSetsService } from '../templates/template-sets.service';
import {
  computeReaderSpreadLayout,
  type SpreadStartSide,
} from '../worker-jobs/imposition.util';
import { ImpositionPreviewResponseDto } from './dto/imposition-preview.dto';
import {
  deriveEditorContentPageRules,
  deriveEditorSpreadValidationOverrides,
} from './editor-spread-validation-options';
import { FileEntity } from '../files/entities/file.entity';
import { PartnerOperatorAuditWriter } from '../auth/partner-operator/partner-operator-audit.writer';
import type { PartnerOperatorGrant } from '../auth/partner-operator/partner-operator.types';
import type { PartnerOperatorAuditDetail } from '../auth/entities/partner-operator-audit-log.entity';
import { computeEditRetention, editRetentionExpired } from '../staff-edit-data/edit-retention';
import { staffAuditUnavailable, staffDeleteNotAllowed } from '../staff-edit-data/staff-actor';
import { resolveSessionPageCount } from './session-page-count';
import { deriveSheetValidationRules, resolveSessionProductProfile } from './sheet-validation-rules';
import { SheetMapError, buildSheetMap } from './sheet-map';
import { applyPhotoItemsToSheets, readSessionPhotoItems } from './photo-items';
import {
  isEditorContentPageRulesOn,
  isEditorSheetValidationRulesOn,
  isEditorSpreadValidationMappingOn,
  isSessionJobOutputLookupOn,
  isSheetMapOutputEnabled,
  isSpreadSnapshotHardFail,
} from '../config/feature-flags';

/**
 * Storige 관리자 호출 컨텍스트(2026-09-29, ADDITIVE) — StaffEditDataService 만 설정한다.
 * 범위: global 이거나 세션 siteId 가 siteIds 안(NULL-site 는 global 만). 범위 안에서는 소유자 판정을 대신하고,
 * 삭제는 canDelete(전역 또는 그 사이트 행 역할 SITE_ADMIN)일 때만.
 */
export interface StaffCallerContext {
  userId: string;
  global: boolean;
  siteIds: string[];
  canDelete: boolean;
}

/** 레거시 관리자 경로(admin JWT) 보관기간·감사 게이트 대상 */
export type LegacyStaffMutation = 'version_restore' | 'restore' | 'guest_update' | 'guest_complete';

/** 호출자 테넌트 컨텍스트 — JWT 의 siteId/role(shop JWT 는 siteId 존재, admin-app JWT 는 없음) */
export interface TenantCaller {
  siteId?: string | null;
  role?: string | null;
  /** 관리자 편집데이터 관리(2026-09-29) — StaffEditDataService 전용. 없으면 기존 규칙 그대로. */
  staff?: StaffCallerContext | null;
  /**
   * admin-app JWT 사용자 id(컨트롤러 tenantCaller 가 admin JWT 일 때만 설정). 레거시 관리자 경로
   * (게스트 세션 staff 수정·완료)의 보관기간·감사 게이트 판정과 감사 actor 에만 쓴다.
   */
  adminUserId?: string;
  /**
   * 운영자 대리 편집 권한(2026-09-29, ADDITIVE). 있으면 테넌트 판정은 권한의 사이트·세션 범위·만료만으로
   * 하고(isPartnerOperatorInScope), 범위 안에서는 소유자 판정을 대신한다. 없으면 기존 규칙 그대로.
   */
  partnerOperator?: PartnerOperatorGrant | null;
}

/** 운영자 파일 참조 검사 대상 필드 */
const OPERATOR_FILE_REF_FIELDS = ['coverFileId', 'contentFileId', 'contentPdfFileId'] as const;
type OperatorFileRefField = (typeof OPERATOR_FILE_REF_FIELDS)[number];

/**
 * 파트너에게 보이는 합성 잡 조건(2026-09-29) — 관리자가 파트너 알림 없이(notifyPartner≠true) 만든
 * 조용한 합성 잡은 파트너 조회(주문 조회 external·책 승격)에서 제외한다. 그래야 관리자 재합성이
 * 진행 중·실패일 때 파트너가 받던 이전 합성 결과물이 원본 파일로 바뀌지 않는다.
 * worker-jobs.service.ts isStaffSilentJob 과 같은 규칙. MariaDB JSON_EXTRACT 는 불리언 true 를
 * 문자열 'true' 로 돌려준다(JSON_VALUE 는 '1') — 운영 DB 에서 확인(2026-09-29).
 */
export function partnerVisibleSynthJobSql(alias: string): string {
  return `(JSON_EXTRACT(${alias}.options, '$.staffInitiated') IS NULL OR JSON_EXTRACT(${alias}.options, '$.staffInitiated.notifyPartner') = 'true')`
}

/**
 * 회원 경로의 회원 번호 — 토큰 userId 가 양의 정수 문자열(/^[1-9][0-9]*$/)일 때만 그 수, 그 밖(없음·0·음수·소수·
 * 지수표기·비숫자)은 NaN. 회원 소유 판정(GET·PATCH·DELETE :id, :id/complete, guest/migrate)과
 * compose-mixed 자동조립 소유 판정이 같은 규칙을 쓴다.
 */
export function memberSeqnoOf(userId: unknown): number {
  if (typeof userId !== 'string' && typeof userId !== 'number') return Number.NaN;
  const raw = String(userId);
  return /^[1-9][0-9]*$/.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * P2-b(2026-10-18) 세션 산출 회차. `metadata.revision` 이 0 이상의 정수가 아니면 0 으로 본다.
 * 완료(complete)마다, 그리고 파트너 v1 synthesize 재합성마다 1 올린다.
 */
export function sessionRevisionOf(metadata: Record<string, any> | null | undefined): number {
  const raw: unknown = metadata?.revision;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

export function nextSessionRevision(metadata: Record<string, any> | null | undefined): number {
  return sessionRevisionOf(metadata) + 1;
}

/**
 * D9(2026-10-19): 검증 잡 orderOptions.bleed 의 기본값(세션 metadata.bleed 가 없을 때).
 * 상품 프로파일(템플릿셋 → 세션 스냅샷) 이 있는 세트에서 템플릿셋 cropMarkEnabled 가 true 가 아니거나 bleedMm 이 0 이면 0,
 * 그 밖(프로파일 NULL·템플릿셋 없음·도련 세트)은 종전 기본 3. 프로파일 검증 경고는 여기서 내지 않는다(deriveSheetValidationRules 가 냄).
 */
export function resolveDefaultBleedMm(
  session: Pick<EditSessionEntity, 'mode' | 'metadata'>,
  templateSet: { cropMarkEnabled?: boolean | null; bleedMm?: number | null; productProfile?: ProductProfile | null } | null,
): number {
  if (!templateSet) return 3;
  if (templateSet.cropMarkEnabled === true && templateSet.bleedMm !== 0) return 3;
  return resolveSessionProductProfile({ session, templateSet }) !== null ? 0 : 3;
}

/** 파트너 v1 synthesize 가 만드는 duplex-split 잡의 requestId — `duplex-split-r{revision}`(36자 이내). */
/** 편집 완료 자동 duplex-split 잡의 request_id(고정 태그, ≤36자 — 유일성은 session_id+pdf_file_id 와의 복합 유니크) */
export const DUPLEX_SPLIT_AUTO_REQUEST_ID = 'duplex-split';

export function duplexSplitRevisionRequestId(revision: number): string {
  return `duplex-split-r${revision}`;
}

/**
 * P2-c(2026-10-18) sheet-map 잡의 request_id — `sheet-map-r{revision}`(36자 이내). duplex-split 과 같은 회차 카운터
 * (metadata.revision)를 쓰되 접두사가 달라 같은 회차의 두 모드 잡이 (session_id, pdf_file_id, request_id) 멱등 인덱스에서
 * 충돌하지 않는다. 편집 완료 자동 잡·파트너 v1 synthesize 재합성이 같은 형식을 쓴다.
 */
export function sheetMapRevisionRequestId(revision: number): string {
  return `sheet-map-r${revision}`;
}

/**
 * P2-b 보안 리뷰(2026-10-18) — 세션 `metadata` 는 클라이언트 자유형(얕은 병합)이지만 아래 키는 서버가 소유한다:
 *  - `launch`   : 파트너 v1 런처 스탬프(via/env/requestId/launchedAt) — deliverables/synthesize 의 사이트·env 판정 근거
 *  - `revision` : 산출 회차(complete·재합성마다 서버가 +1) — 재합성 requestId 멱등 키
 *  - `production` : 운영자 제작 메모(P2-e, 서버/운영 콘솔만) + `production.sheetMap`(완료 시 sheet-map 발행 실패 기록, 아래)
 *  - `productProfile` : 템플릿셋 상품 프로파일 스냅샷 — 보안 리뷰 security-2(2026-10-19): 클라이언트가 쓰면 NULL 세트에서
 *    copies 상한·sheet-map 모드를 스스로 정의할 수 있어 서버가 소유한다. 세션 생성·metadata PATCH·완료 때 서버가 템플릿셋
 *    현재 프로파일로 (재)기록하고, 세트 프로파일이 NULL 이면 키를 제거한다(stampProductProfileSnapshot). 템플릿셋 조회
 *    실패 시에만 기존(서버 기록) 값을 유지한다 — resolveSessionProductProfile 의 스냅샷 폴백은 그 값만 본다.
 * 편집기·호스트의 PATCH 가 이 키를 보내도 무시하고 기존 값을 유지한다(test 세션의 live 위장·revision 위조 방지).
 */
export const SESSION_METADATA_SERVER_OWNED_KEYS = ['launch', 'revision', 'production', 'productProfile'] as const;

export function mergeSessionMetadata(
  existing: Record<string, any> | null | undefined,
  incoming: Record<string, any> | null | undefined,
): Record<string, any> {
  const safe: Record<string, any> = { ...(incoming ?? {}) };
  for (const key of SESSION_METADATA_SERVER_OWNED_KEYS) delete safe[key];
  return { ...(existing ?? {}), ...safe };
}

/**
 * 완료 시 sheet-map 발행 실패 기록(api-sheetmap-3, 2026-10-19) — 서버 소유 키 `metadata.production.sheetMap`.
 * 종전에는 buildSheetMap(SheetMapError: PAGE_COUNT_MISMATCH 등)·createSheetMapJob 실패를 로그만 남기고 삼켜 파트너
 * deliverables 가 'complete'·시트 없음으로 보였다. 이제 실패를 기록하고(완료는 유지) deliverables 가 'failed' +
 * errorCode/errorDetail 로 노출한다. 다음 발행(재완료·재합성)이 성공하면 키를 지운다. 그 밖의 production 키는 건드리지 않는다.
 */
export const SHEET_MAP_FAILURE_METADATA_KEY = 'sheetMap';

export interface SheetMapFailureRecord {
  /** SheetMapError.code 또는 'SHEET_MAP_JOB_FAILED'(잡 생성 실패) */
  error: string;
  message: string;
  /** ISO 8601 — 이 시각보다 뒤에 만들어진 합성 잡이 있으면 기록은 지난 회차로 본다(deliverables) */
  at: string;
}

export function sheetMapFailureOf(metadata: Record<string, any> | null | undefined): SheetMapFailureRecord | null {
  const production: unknown = metadata?.production;
  if (!production || typeof production !== 'object') return null;
  const raw: unknown = (production as Record<string, unknown>)[SHEET_MAP_FAILURE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const { error, message, at } = raw as { error?: unknown; message?: unknown; at?: unknown };
  if (typeof error !== 'string' || error === '' || typeof at !== 'string') return null;
  return { error, message: typeof message === 'string' ? message : '', at };
}

/** production.sheetMap 을 기록(failure) 또는 제거(null). 제거 뒤 production 이 비면 production 키도 지운다. */
export function withSheetMapFailure(
  metadata: Record<string, any> | null | undefined,
  failure: SheetMapFailureRecord | null,
): Record<string, any> {
  const base: Record<string, any> = { ...(metadata ?? {}) };
  const production: Record<string, any> =
    base.production && typeof base.production === 'object' ? { ...base.production } : {};
  if (failure) {
    production[SHEET_MAP_FAILURE_METADATA_KEY] = failure;
    base.production = production;
    return base;
  }
  delete production[SHEET_MAP_FAILURE_METADATA_KEY];
  if (Object.keys(production).length === 0) delete base.production;
  else base.production = production;
  return base;
}

/** findLatestPartnerVisibleSynthJob 반환 행 — worker_jobs 의 파트너 가시 최신 SYNTHESIZE 잡. */
export interface PartnerVisibleSynthJobRow {
  id: string;
  status: string;
  result: { outputFileUrl?: string; outputFiles?: Array<{ type?: string; url?: string; pageCount?: number; setIndex?: number }> } | null;
  outputFileUrl: string | null;
  createdAt: Date;
  completedAt: Date | null;
  /**
   * P2-c(2026-10-18, additive) worker_jobs.options — 파트너 v1 deliverables 가 `mode==='sheet-map'` 잡의 `sheets`
   * (API 가 발행 시 저장한 SheetSpec[])를 그대로 싣는 데 쓴다. 파싱 실패·NULL 은 null.
   */
  options?: { mode?: string; sheets?: SheetSpec[]; [key: string]: unknown } | null;
}

@Injectable()
export class EditSessionsService {
  private readonly logger = new Logger(EditSessionsService.name);

  constructor(
    @InjectRepository(EditSessionEntity)
    private sessionRepository: Repository<EditSessionEntity>,
    @InjectRepository(EditSessionVersionEntity)
    private versionRepository: Repository<EditSessionVersionEntity>,
    @Inject(forwardRef(() => WorkerJobsService))
    private workerJobsService: WorkerJobsService,
    private templateSetsService: TemplateSetsService,
    // 운영자 대리 편집(2026-09-29) — 파일 참조 검사·감사 기록. EditSessionsModule 이 등록한다.
    // @Optional: 이 두 의존성이 없는 구성에서는 운영자 경로만 503 으로 막히고(fail-closed) 나머지는 그대로다.
    @Optional()
    @InjectRepository(FileEntity)
    private fileRepository?: Repository<FileEntity>,
    @Optional()
    private partnerOperatorAudit?: PartnerOperatorAuditWriter,
  ) {}

  /**
   * security-2(2026-10-19): `metadata.productProfile` 을 템플릿셋 현재 프로파일로 (재)기록한다.
   *  - templateSetId 없음 → 키 제거(클라이언트가 보낸 값은 버린다).
   *  - 템플릿셋 프로파일 있음 → 그 값으로 덮어쓴다(기존 키 위치 유지).
   *  - 템플릿셋 프로파일 NULL → 키 제거(세트를 NULL 로 되돌리면 진행 중 세션도 현행 동작으로 복귀 — 롤백 약속).
   *  - 템플릿셋 조회 실패 → 기존(서버 기록) 값 유지 + warn(완료·저장은 계속).
   * 바꿀 것이 없으면 입력 객체를 그대로(참조 동일) 돌려준다 — NULL 세트·키 없음 경로는 바이트 동일.
   */
  private async stampProductProfileSnapshot(
    metadata: Record<string, any> | null | undefined,
    templateSetId: string | null | undefined,
    context: string,
  ): Promise<Record<string, any> | null | undefined> {
    const hasKey = !!metadata && Object.prototype.hasOwnProperty.call(metadata, 'productProfile');
    const dropKey = (): Record<string, any> | null | undefined => {
      if (!hasKey || !metadata) return metadata;
      const rest: Record<string, any> = { ...metadata };
      delete rest.productProfile;
      return rest;
    };
    if (!templateSetId) return dropKey();

    let profile: ProductProfile | null;
    try {
      const templateSet = await this.templateSetsService.findOne(templateSetId);
      profile = templateSet?.productProfile ?? null;
    } catch (e) {
      this.logger.warn(
        `[productProfile] ${context}: TemplateSet ${templateSetId} 조회 실패 → 기존 스냅샷 유지: ${(e as Error).message}`,
      );
      return metadata;
    }
    if (!profile) return dropKey();
    return { ...(metadata ?? {}), productProfile: profile };
  }

  /**
   * api-sheetmap-3: sheet-map 발행 실패를 `metadata.production.sheetMap` 에 기록(로그 error). 저장 실패는 warn(무중단).
   */
  private async recordSheetMapFailure(session: EditSessionEntity, error: unknown, scope: string): Promise<void> {
    const code = error instanceof SheetMapError ? error.code : 'SHEET_MAP_JOB_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      `[${scope}] session ${session.id}: sheet-map 발행 실패(완료는 유지, production.sheetMap=${code} 기록): ${message}`,
    );
    session.metadata = withSheetMapFailure(session.metadata, { error: code, message, at: new Date().toISOString() });
    try {
      await this.sessionRepository.save(session);
    } catch (e) {
      this.logger.warn(`[${scope}] session ${session.id}: production.sheetMap 기록 저장 실패: ${(e as Error).message}`);
    }
  }

  /** 발행 성공 뒤 지난 실패 기록(production.sheetMap)이 남아 있으면 지운다. 기록이 없으면 저장하지 않는다(바이트 동일). */
  private async clearSheetMapFailure(session: EditSessionEntity, scope: string): Promise<void> {
    if (!sheetMapFailureOf(session.metadata)) return;
    session.metadata = withSheetMapFailure(session.metadata, null);
    try {
      await this.sessionRepository.save(session);
    } catch (e) {
      this.logger.warn(`[${scope}] session ${session.id}: production.sheetMap 제거 저장 실패: ${(e as Error).message}`);
    }
  }

  /**
   * B49: 세션의 출력재현 스냅샷(metadata.spread.spec)을 템플릿 권위 스펙(spreadConfig.spec)과 대조.
   * 책등은 동적이라 제외하고 표지 가로/세로·날개 기하만 검증. 권위 미해결(레거시/비스프레드/스펙부재) 시 빈 배열(통과).
   */
  private async compareSpreadWithTemplateAuthority(
    session: EditSessionEntity,
  ): Promise<string[]> {
    try {
      const candidate = (session.metadata as any)?.spread?.spec;
      if (!session.templateSetId || !candidate) return [];
      const { templateDetails } = await this.templateSetsService.findOneWithTemplates(
        session.templateSetId,
      );
      const spreadTpl = templateDetails.find((t) => t.type === ('spread' as any));
      const authority = spreadTpl?.spreadConfig?.spec;
      if (!authority) return []; // 권위 스펙 없음 → 검증 불가(통과)
      const { mismatches } = validateSpreadAgainstAuthority(candidate, authority);
      return mismatches.map((m) => 'AUTHORITY_' + m);
    } catch (e) {
      this.logger.warn(`[spread-spec] 권위 대조 skip(완료는 계속): ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 내지 펼침면(regionScope='inner') 세트의 **content.pdf 실제 페이지 크기**를 해석한다.
   *
   * 배경(2026-08-03 E2E 실측): 포토북 내지 세트의 content.pdf 는 '1페이지 = 1펼침면'(D-1 결정)이라
   * 실제 페이지가 `pageWidthMm×2 × pageHeightMm` 인데, 검증 잡의 기대 크기는 templateSet 판형
   * (= 내지 한 면)이라 정상 PDF 가 항상 SIZE_MISMATCH 로 오검증됐다.
   *   `페이지 크기가 맞지 않습니다. (기대: 210x297mm, 현재: 420x297mm)`
   *
   * [표지 spread → 내지 spread] 결합 세트(W8 N-API-3)도 지원한다 — 첫 spread 가 아니라
   * regionScope='inner' 인 spread 템플릿을 찾는다. 해석 결과는 호출부에서 **content 잡에만** 적용한다
   * (표지 잡 옵션 무접촉).
   *
   * 반환(N-API-3b 에서 3분기로 확장 — 쪽 단위 판정이 '판정 실패'와 '내지 spread 없음'을 구분):
   *  - { kind: 'inner-spread', size } : 내지 펼침면 세트(content.pdf 1쪽 = 펼침면)
   *  - { kind: 'none' }   : 템플릿셋 미연결·내지 spread 없는 세트(표지 spread 만·비스프레드) → 기존 폴백(무회귀)
   *  - { kind: 'unknown' }: 내지 spread 인데 치수 무효이거나 조회 예외 → 크기는 기존 폴백, 쪽 규칙 미주입
   */
  private async resolveInnerSpreadContentSizeMm(
    session: EditSessionEntity,
  ): Promise<
    | { kind: 'inner-spread'; size: { width: number; height: number } }
    | { kind: 'none' }
    | { kind: 'unknown' }
  > {
    try {
      if (!session.templateSetId) return { kind: 'none' };
      const { templateDetails } = await this.templateSetsService.findOneWithTemplates(
        session.templateSetId,
      );
      // 결합 세트는 표지 spread 가 앞에 올 수 있다 → 첫 spread 고정이 아니라 내지 spread 를 찾는다.
      const spreadTpl = templateDetails.find(
        (t) => t.type === TemplateType.SPREAD && t.spreadConfig?.regionScope === 'inner',
      );
      const cfg = spreadTpl?.spreadConfig as
        | { regionScope?: string; innerSpec?: { pageWidthMm?: number; pageHeightMm?: number } }
        | undefined;
      if (cfg?.regionScope !== 'inner') return { kind: 'none' };
      const w = cfg.innerSpec?.pageWidthMm;
      const h = cfg.innerSpec?.pageHeightMm;
      if (!Number.isFinite(w) || !Number.isFinite(h) || (w as number) <= 0 || (h as number) <= 0) {
        return { kind: 'unknown' };
      }
      // content.pdf 1페이지 = 좌면+우면 (거터는 면 내부라 총폭에 미가산 — 편집기 규약과 동일)
      return { kind: 'inner-spread', size: { width: (w as number) * 2, height: h as number } };
    } catch (e) {
      this.logger.warn(
        `[validation-jobs] 내지 펼침면 크기 해석 skip(기존 폴백 사용): ${(e as Error).message}`,
      );
      return { kind: 'unknown' };
    }
  }

  /**
   * 편집 세션 생성
   *
   * 인쇄 워크플로우 v1 Phase 4 (2026-05-19):
   * - dto.asGuest=true → guestToken (uuid) + guestExpiresAt (NOW + 24h) 자동 발급.
   * - 결정 3-1: EVENT evt_purge_expired_guest_sessions (1h 주기) 가 만료 시 DELETE.
   * - 결정 3-6: 회원 전환은 저장(편집완료) 시점에 별도 흐름. 본 메서드는 발급만.
   */
  async create(dto: CreateEditSessionDto): Promise<EditSessionEntity> {
    // 게스트 모드: orderSeqno/memberSeqno 미전송 시 0 / null. token 발급.
    const isGuest = !!dto.asGuest || (!dto.memberSeqno && !dto.orderSeqno);
    const guestToken = isGuest ? randomUUID() : null;
    const guestExpiresAt = isGuest ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    // security-2: metadata.productProfile 은 서버 소유 — 클라이언트 값 대신 템플릿셋 현재 프로파일을 기록(NULL 세트는 키 없음).
    const metadata = await this.stampProductProfileSnapshot(dto.metadata, dto.templateSetId, 'create');

    // coverFileId/contentFileId는 @RelationId(read-only). ManyToOne relation을 통해 set.
    const session = this.sessionRepository.create({
      orderSeqno: dto.orderSeqno ?? 0,
      memberSeqno: dto.memberSeqno ?? 0,
      mode: dto.mode,
      coverFile: dto.coverFileId ? ({ id: dto.coverFileId } as any) : null,
      contentFile: dto.contentFileId ? ({ id: dto.contentFileId } as any) : null,
      templateSetId: dto.templateSetId,
      canvasData: dto.canvasData,
      metadata,
      callbackUrl: dto.callbackUrl,
      siteId: (dto as any).siteId || null, // Phase C-2 — JWT siteId 자동 주입
      guestToken,
      guestExpiresAt,
    });

    const saved = await this.sessionRepository.save(session);
    if (isGuest) {
      this.logger.log(`Created guest edit session ${saved.id} (token=${guestToken?.slice(0, 8)}…, expires ${guestExpiresAt?.toISOString()})`);
    } else {
      this.logger.log(`Created edit session ${saved.id} for order ${dto.orderSeqno}`);
    }

    return saved;
  }

  /**
   * 주문 번호로 세션 목록 조회
   */
  async findByOrderSeqno(orderSeqno: number): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { orderSeqno },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 회원 번호로 세션 목록 조회
   */
  async findByMemberSeqno(memberSeqno: number): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { memberSeqno },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Phase C-3 — 사이트 ID로 세션 목록 조회 (admin 사이트별 필터)
   */
  async findBySiteId(siteId: string): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { siteId },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /**
   * 주문 번호로 외부 조회 (워커잡 포함, nimda용)
   */
  async findByOrderExternal(
    orderSeqno: number,
    caller?: { siteId?: string; role?: string },
  ): Promise<ExternalSessionResponseDto[]> {
    const qb = this.sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.coverFile', 'coverFile')
      .leftJoinAndSelect('session.contentFile', 'contentFile')
      .where('session.orderSeqno = :orderSeqno', { orderSeqno })
      .andWhere('session.deletedAt IS NULL');

    // P2c 테넌트 격리: 호출자 site 세션 + 레거시 NULL(시스템공유)만 노출. 타 테넌트 세션·PDF URL 차단.
    // (order_seqno 는 사이트별 네임스페이스가 없어, 미대조 시 교차 열람 가능했음.)
    // worker 역할(내부 워커)·caller 미지정(내부 호출)은 바이패스.
    // 사이트 미지정(NULL) 세션 중 게스트 세션(guest_token 보유)은 포함하지 않는다.
    if (caller && caller.role !== 'worker' && caller.siteId) {
      qb.andWhere(
        '(session.siteId = :callerSiteId OR (session.siteId IS NULL AND session.guestToken IS NULL))',
        { callerSiteId: caller.siteId },
      );
    }

    const sessions = await qb.orderBy('session.createdAt', 'DESC').getMany();

    // DB-001(2026-06-22): 세션 루프 내 최신 SYNTHESIZE 잡 조회(N+1)를 윈도우함수 1회 배치로 치환.
    // 세션별 created_at DESC 최신 1건(group-wise max)을 ROW_NUMBER()=1 로 정확히 보존
    // (MariaDB 11.2 윈도우함수 지원). 미존재 세션은 Map 미수록 → 기존 getRawOne undefined 와 동일.
    // SESSION_JOB_OUTPUT_LOOKUP 이 꺼져 있으면(기본) 조회하지 않고 편집기 원본 파일을 돌려준다.
    // 켜져 있으면 잡 사이트가 세션 사이트와 같은(NULL 끼리 포함) 잡만 쓴다.
    const latestJobBySession = new Map<
      string,
      { status: string; result: any; outputFileUrl: string | null }
    >();
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length > 0 && isSessionJobOutputLookupOn()) {
      const rows: Array<{
        sessionId: string;
        status: string;
        result: any;
        outputFileUrl: string | null;
      }> = await this.sessionRepository.manager.query(
        `SELECT t.edit_session_id AS sessionId, t.status AS status,
                t.result AS result, t.output_file_url AS outputFileUrl
           FROM (
             SELECT job.edit_session_id, job.status, job.result, job.output_file_url,
                    ROW_NUMBER() OVER (
                      PARTITION BY job.edit_session_id ORDER BY job.created_at DESC
                    ) AS rn
               FROM worker_jobs job
               JOIN file_edit_sessions sess ON sess.id = job.edit_session_id
              WHERE job.edit_session_id IN (?) AND job.job_type = 'SYNTHESIZE'
                AND job.site_id <=> sess.site_id
                AND ${partnerVisibleSynthJobSql('job')}
           ) t
          WHERE t.rn = 1`,
        [sessionIds],
      );
      for (const r of rows) {
        latestJobBySession.set(r.sessionId, {
          status: r.status,
          result: r.result,
          outputFileUrl: r.outputFileUrl,
        });
      }
    }

    const results: ExternalSessionResponseDto[] = [];

    for (const session of sessions) {
      // 세션별 최신 SYNTHESIZE 워커잡(배치 Map). 없으면 null → resolveFiles 가 에디터 원본 fallback.
      const workerJob = latestJobBySession.get(session.id) ?? null;

      const files = this.resolveFiles(session, workerJob);

      results.push({
        sessionId: session.id,
        orderSeqno: Number(session.orderSeqno),
        status: session.status,
        mode: session.mode,
        files,
        completedAt: session.completedAt,
      });
    }

    return results;
  }

  /**
   * 파일 URL 결정 (워커 출력 > 에디터 원본 fallback)
   */
  private resolveFiles(
    session: EditSessionEntity,
    workerJob: any,
  ): ExternalSessionFilesDto {
    let cover: string | null = null;
    let content: string | null = null;
    let merged: string | null = null;

    if (workerJob && workerJob.status === WorkerJobStatus.COMPLETED) {
      // 워커잡 결과에서 파일 URL 추출
      const result = typeof workerJob.result === 'string'
        ? JSON.parse(workerJob.result)
        : workerJob.result;

      if (result?.outputFiles) {
        for (const file of result.outputFiles) {
          if (file.type === 'cover') cover = file.url;
          if (file.type === 'content') content = file.url;
        }
      }
      if (result?.outputFileUrl) {
        merged = result.outputFileUrl;
      }
      // job-level outputFileUrl fallback for merged
      if (!merged && workerJob.outputFileUrl) {
        merged = workerJob.outputFileUrl;
      }
    }

    // 에디터 원본 fallback
    if (!cover && session.coverFile) {
      cover = session.coverFile.fileUrl ?? null;
    }
    if (!content && session.contentFile) {
      content = session.contentFile.fileUrl ?? null;
    }

    return { cover, content, merged };
  }

  /**
   * 세션 ID로 조회
   */
  async findById(id: string): Promise<EditSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['coverFile', 'contentFile'],
    });

    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: id },
      });
    }

    return session;
  }

  /** soft delete 포함 단건 조회(관리자 복구·보관기간 게이트용). 미존재는 findById 와 같은 404. */
  async findByIdWithDeleted(id: string): Promise<EditSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: id },
      });
    }
    return session;
  }

  /**
   * [Stage 3 W4] EDITOR_SESSION 승격용 — 세션 + 최신 SYNTHESIZE 산출 파일(URL) 조회(조회 전용).
   *
   * resolveFiles(워커 COMPLETED 출력 우선, 없으면 에디터 원본 fallback) 재사용 — URL 만 반환.
   * ⚠️ 소유/NULL-site/status 게이트는 호출측(BooksService 승격)이 caller site 컨텍스트로
   *    수행한다(본 메서드는 조립만 — AD-1: 세션 상태 변경 없음). worker_jobs 는 조회만.
   */
  async getPromotionArtifact(
    id: string,
  ): Promise<{ session: EditSessionEntity; files: ExternalSessionFilesDto }> {
    const session = await this.findById(id); // coverFile/contentFile 로드 + 미존재 404
    // 세션 최신 SYNTHESIZE 잡 1건(created_at DESC) — 조회 전용 raw(findByOrderExternal 준용).
    // SESSION_JOB_OUTPUT_LOOKUP 이 꺼져 있으면(기본) 조회하지 않고 편집기 원본 파일을 돌려준다.
    // 켜져 있으면 잡 사이트가 세션 사이트와 같은(NULL 끼리 포함) 잡만 쓴다.
    const rows: Array<{
      status: string;
      result: unknown;
      outputFileUrl: string | null;
    }> = isSessionJobOutputLookupOn()
      ? await this.sessionRepository.manager.query(
          `SELECT job.status AS status, job.result AS result, job.output_file_url AS outputFileUrl
             FROM worker_jobs job
             JOIN file_edit_sessions sess ON sess.id = job.edit_session_id
            WHERE job.edit_session_id = ? AND job.job_type = 'SYNTHESIZE'
              AND job.site_id <=> sess.site_id
              AND ${partnerVisibleSynthJobSql('job')}
            ORDER BY job.created_at DESC
            LIMIT 1`,
          [id],
        )
      : [];
    const files = this.resolveFiles(session, rows[0] ?? null);
    return { session, files };
  }

  /**
   * 고객 첨부 내지 PDF "리더 스프레드" 임포지션 미리보기 (2026-06-16).
   *
   * 외부(bookmoa-mobile 등)가 "이 PDF가 책으로 묶이면 펼침면이 이렇게 보입니다"를
   * 그리기 위한 표시용 데이터를 조회한다. 부수효과 없음 — 재렌더/잡 생성 금지.
   *
   * 동작:
   *  - 세션의 metadata.contentPdfGuide 가 있으면 그 pageImageUrls/resolution 을
   *    그대로 재사용한다(워커 RENDER_PAGES 산출 캐시). 없으면 ready:false +
   *    reason 으로 "썸네일 미생성" 을 알린다(재렌더 트리거하지 않음).
   *  - totalPages = contentPdfGuide.pageImageUrls.length ?? metadata.pages ?? 0.
   *    (썸네일이 없어도 metadata.pages 로 페이지 수를 알면 layout 은 채운다)
   *  - bindingType = bindingOverride ?? metadata.binding ?? 'perfect'.
   *  - layout 은 imposition.util 순수 함수(computeReaderSpreadLayout)가 계산.
   *
   * ⚠️ 권한/소유 검증은 호출하는 컨트롤러(외부 ApiKeyGuard 또는 소유자/staff)가 담당.
   *   본 메서드는 순수 조회 + 조립만 한다.
   */
  async getImpositionPreview(
    id: string,
    startSide: SpreadStartSide,
    bindingOverride?: string,
    caller?: { siteId?: string; role?: string },
  ): Promise<ImpositionPreviewResponseDto> {
    const session = await this.findById(id);
    // P2c 테넌트 격리: 타 site 세션 미리보기 차단(NULL=레거시/공유 허용, worker/내부호출 바이패스).
    // findById 의 not-found 404 와 **동일한 응답**으로 던져 존재 오라클을 차단.
    if (
      caller &&
      caller.role !== 'worker' &&
      caller.siteId &&
      session.siteId &&
      session.siteId !== caller.siteId
    ) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: id },
      });
    }
    const metadata = (session.metadata ?? {}) as Record<string, any>;
    const guide = metadata.contentPdfGuide as
      | { pageImageUrls?: string[]; resolution?: number }
      | undefined;

    const pageImageUrls = Array.isArray(guide?.pageImageUrls)
      ? guide!.pageImageUrls
      : [];
    const ready = pageImageUrls.length > 0;
    const resolution = ready ? guide?.resolution ?? null : null;

    // 페이지 수: 썸네일이 있으면 썸네일 수, 없으면 metadata.pages, 그것도 없으면 0.
    const totalPages = ready
      ? pageImageUrls.length
      : typeof metadata.pages === 'number'
        ? metadata.pages
        : 0;

    // 제본: override > metadata.binding > 'perfect'(검증잡 기본과 동일)
    const bindingType = bindingOverride ?? metadata.binding ?? 'perfect';

    const layout = computeReaderSpreadLayout(totalPages, startSide, bindingType);

    return {
      ready,
      pageImageUrls,
      resolution,
      layout,
      bindingType,
      ...(ready ? {} : { reason: '썸네일 미생성: 업로드/렌더 대기' }),
    };
  }

  /**
   * 세션 업데이트
   *
   * 인쇄 워크플로우 v1 Phase 4 (2026-05-19):
   * - 게스트 세션(`guestToken` 보유)은 토큰 검증된 게스트 경로(`opts.guestVerified`) 또는
   *   staff 만 변경할 수 있다(2026-09-29). 회원 세션은 소유자만 변경한다.
   * - PDF 첨부 / 검증 결과 / 페이지수 필드(`contentPdf*`) 갱신 지원.
   * - 결정 3-3: PDF 첨부 시 `canvasData` 동시 수정은 클라가 막아야 함 (API 는 1차 가드만).
   */
  /** 운영자(staff) 역할 — admin-app UserRole(대문자)·shop JWT(소문자) 모두 대소문자 무관 */
  static isStaffRole(role: string | null | undefined): boolean {
    const r = String(role ?? '').toLowerCase();
    return r === 'admin' || r === 'manager' || r === 'super_admin';
  }

  /**
   * 테넌트 격리 (2026-08-23, findOne/PATCH/complete/DELETE/versions 공통).
   *
   * memberSeqno 는 site 별 독립 번호공간이라 "같은 memberSeqno·다른 siteId" 의 customer JWT 가
   * 소유자로 오판된다. 비-staff·비-worker 호출자가 JWT siteId 와 다른 site 의 세션에 닿으면
   * findById 의 not-found 와 **동일한** 404 SESSION_NOT_FOUND 로 차단한다(존재 오라클 방지).
   * staff(admin/manager/super_admin)·worker 는 전 테넌트 운영 주체로 예외, caller 미지정(내부 호출)·
   * user.siteId 또는 session.siteId 부재(레거시 JWT/구 세션)는 기존 동작대로 통과.
   * ⚠️ 같은 회사의 다중 site(예: bookmoa PHP ↔ bookmoa-mobile)는 서로의 세션을 볼 수 없게 된다 — 오너 결정(8/23).
   */
  /**
   * 테넌트 범위 판정(순수) — assertTenantScope 와 목록 라우트 필터가 공유.
   * true = 노출 가능(caller 없음·staff·worker·caller siteId 없음·세션 siteId 없음(레거시)·같은 site).
   */
  isInTenantScope(
    session: { id?: string; siteId?: string | null },
    caller?: TenantCaller | null,
  ): boolean {
    // 관리자 편집데이터 관리(2026-09-29): 전역이거나 세션 site 가 DB 사이트 역할 범위 안. NULL-site 는 전역만.
    if (caller?.staff) {
      if (caller.staff.global) return true;
      return (
        typeof session.siteId === 'string' &&
        session.siteId.length > 0 &&
        caller.staff.siteIds.includes(session.siteId)
      );
    }
    if (caller?.partnerOperator) return this.isPartnerOperatorInScope(session, caller.partnerOperator);
    if (!caller) return true;
    const role = String(caller.role ?? '').toLowerCase();
    if (role === 'worker' || EditSessionsService.isStaffRole(role)) return true;
    if (!caller.siteId || !session.siteId) return true;
    return caller.siteId === session.siteId;
  }

  /**
   * 운영자 대리 편집 범위 판정(순수, 2026-09-29). 모두 만족할 때만 true:
   *  - 권한 siteId 가 비어 있지 않고 세션 siteId(NULL 불가)와 같다
   *  - 권한이 만료 전이다
   *  - 세션 id 가 권한의 세션 목록에 있다(빈 목록은 false)
   * NULL-site(레거시) 세션은 운영자 범위 밖이다 — 고객 규칙의 NULL 허용은 적용하지 않는다.
   */
  isPartnerOperatorInScope(
    session: { id?: string; siteId?: string | null },
    grant: PartnerOperatorGrant | null | undefined,
  ): boolean {
    if (!grant) return false;
    if (typeof grant.siteId !== 'string' || grant.siteId.length === 0) return false;
    if (session.siteId === null || session.siteId === undefined) return false;
    if (session.siteId !== grant.siteId) return false;
    if (!(Math.floor(Date.now() / 1000) < grant.grantExpiresAt)) return false;
    if (typeof session.id !== 'string') return false;
    return Array.isArray(grant.sessionIds) && grant.sessionIds.includes(session.id);
  }

  /**
   * 운영자 상태 변경 감사 기록(fail-closed). 검사가 끝난 뒤·저장 전에 호출한다.
   * 기록 저장에 실패하면 503 으로 중단되어 변경이 일어나지 않는다. 세션 metadata 에는 쓰지 않는다.
   */
  private async recordOperatorAction(
    op: PartnerOperatorGrant,
    sessionId: string,
    action: 'session.update' | 'session.complete' | 'session.delete' | 'session.version_restore',
    detail: PartnerOperatorAuditDetail,
  ): Promise<void> {
    if (!this.partnerOperatorAudit) {
      throw new ServiceUnavailableException({
        code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE',
        message: '감사 기록을 저장할 수 없어 작업을 중단했습니다.',
      });
    }
    const staffOrigin = op.origin === 'staff';
    await this.partnerOperatorAudit.recordOrThrow({
      grantId: op.grantId,
      siteId: op.siteId,
      // 관리자 발급 권한(2026-09-29): 출처·발급자(권한 행 issued_by_user_id — assertActive 가 채움)
      ...(staffOrigin ? { origin: 'staff' as const, actorUserId: op.issuedByUserId ?? null } : {}),
      sessionId,
      operatorId: op.operatorId,
      operatorName: op.operatorName,
      action,
      detail,
    });
    this.logger.log(
      `[partner-operator] ${action} session=${sessionId} site=${op.siteId} op=${op.operatorId} grant=${op.grantId}`,
    );
  }

  /**
   * 운영자 파일 참조 검사(2026-09-29, 운영자 전용 — 고객 동작 불변).
   * DTO 가 null 이 아닌 값으로 지정한 cover/content/contentPdf 파일은 존재(삭제 제외)하고
   * siteId 가 NULL 이거나 세션 site 와 같아야 한다. 아니면 400 FILE_NOT_IN_SCOPE.
   * (site 없는 토큰의 /files/upload 산출물·레거시 파일은 NULL-site 이므로 NULL-site 파일은 허용한다.)
   */
  private async assertOperatorFileRefs(
    session: Pick<EditSessionEntity, 'siteId'>,
    dto: Pick<UpdateEditSessionDto, OperatorFileRefField>,
  ): Promise<void> {
    const ids = OPERATOR_FILE_REF_FIELDS.map((f) => dto[f]).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (ids.length === 0) return;
    if (!this.fileRepository) {
      throw new ServiceUnavailableException({
        code: 'PARTNER_OPERATOR_UNAVAILABLE',
        message: '운영자 권한 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    for (const id of Array.from(new Set(ids))) {
      const file = await this.fileRepository.findOne({
        where: { id },
        select: ['id', 'siteId'],
      });
      if (!file || (file.siteId !== null && file.siteId !== session.siteId)) {
        throw new BadRequestException({
          code: 'FILE_NOT_IN_SCOPE',
          message: '참조한 파일을 이 세션에서 사용할 수 없습니다.',
        });
      }
    }
  }

  assertTenantScope(
    session: Pick<EditSessionEntity, 'id' | 'siteId'>,
    caller?: TenantCaller | null,
  ): void {
    if (!this.isInTenantScope(session, caller)) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: session.id },
      });
    }
  }

  async update(
    id: string,
    dto: UpdateEditSessionDto,
    userId: number,
    caller?: TenantCaller | null,
    opts?: { guestVerified?: boolean },
  ): Promise<EditSessionEntity> {
    const session = await this.findById(id);
    // 테넌트 판정(404)이 권한 판정(403)보다 먼저 — 존재 비누설
    this.assertTenantScope(session, caller);

    // 권한 확인: 회원 세션은 소유자만 변경.
    // 게스트 세션은 토큰 검증된 게스트 경로(guestVerified) 또는 staff 만 변경 (2026-09-29).
    // 운영자 대리 편집(2026-09-29): 위 assertTenantScope 가 권한 범위를 이미 확인했으므로 소유자 판정을 대신한다.
    const op = caller?.partnerOperator ?? null;
    const staff = caller?.staff ?? null;
    const isGuest = !!session.guestToken;
    // 관리자 편집데이터 관리(2026-09-29): staff 컨텍스트는 범위(assertTenantScope) 안에서 소유자 판정을 대신한다.
    const allowed = op || staff
      ? true
      : isGuest
        ? opts?.guestVerified === true || EditSessionsService.isStaffRole(caller?.role)
        : userId > 0 && Number(session.memberSeqno) === userId;
    if (!allowed) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 수정할 권한이 없습니다.',
      });
    }
    // 레거시 관리자 경로(admin JWT 의 게스트 세션 수정): 게스트 토큰 경로가 아니고 staff 역할로 통과한 경우만
    // 보관기간 확인 + 감사(fail-closed).
    const legacyStaffGuest =
      !op && !staff && isGuest && opts?.guestVerified !== true &&
      EditSessionsService.isStaffRole(caller?.role) && typeof caller?.adminUserId === 'string';

    // Phase 4 결정 3-3: PDF 첨부 ↔ 편집 배타(replace 모드).
    // P0-2 (2026-06-02): underlay 모드는 PDF를 배경으로 깔고 그 위 편집을 허용 → 배타 완화.
    // (부수효과 없는 검사 — 운영자 감사 기록보다 먼저 판정한다.)
    if (dto.canvasData !== undefined) {
      const effectiveMode =
        (dto.contentPdfMode ?? session.contentPdfMode ?? 'replace');
      if (
        session.contentPdfFileId &&
        dto.contentPdfFileId === undefined &&
        effectiveMode !== 'underlay'
      ) {
        throw new BadRequestException({
          code: 'PDF_ATTACHED_EXCLUSIVE',
          message: '내지 PDF 첨부(replace) 상태에서는 편집 캔버스를 변경할 수 없습니다. PDF 를 먼저 제거하거나 underlay 모드로 첨부하세요.',
        });
      }
    }

    if (legacyStaffGuest) {
      await this.gateLegacyStaffMutation(session, caller?.adminUserId, 'guest_update');
    }

    // 운영자: 파일 참조 검사 → 상태/파일 참조가 바뀌는 경우에만 감사 기록(저장 전, fail-closed).
    // 일반 캔버스 자동저장은 요청 단위 기록(인터셉터)으로 남는다.
    // 관리자 발급 권한(origin 'staff')은 캔버스·메타데이터 저장도 감사 1행(fail-closed)으로 남긴다 —
    // 재합성 전 '편집 후 미완료'(OUTPUT_STALE) 판정 근거. 파트너 발급 권한 경로는 종전 그대로.
    if (op) {
      await this.assertOperatorFileRefs(session, dto);
      const statusChanged = dto.status !== undefined && dto.status !== session.status;
      const fileRefs: Record<string, string | null> = {};
      if (dto.coverFileId !== undefined && (dto.coverFileId || null) !== (session.coverFileId ?? null)) {
        fileRefs.cover = dto.coverFileId || null;
      }
      if (dto.contentFileId !== undefined && (dto.contentFileId || null) !== (session.contentFileId ?? null)) {
        fileRefs.content = dto.contentFileId || null;
      }
      if (
        dto.contentPdfFileId !== undefined &&
        (dto.contentPdfFileId ?? null) !== (session.contentPdfFileId ?? null)
      ) {
        fileRefs.contentPdf = dto.contentPdfFileId ?? null;
      }
      const fileRefsChanged = Object.keys(fileRefs).length > 0;
      if (op.origin === 'staff') {
        const canvasChanged = dto.canvasData !== undefined;
        const metadataChanged = dto.metadata !== undefined;
        if (statusChanged || fileRefsChanged || canvasChanged || metadataChanged) {
          await this.recordOperatorAction(op, session.id, 'session.update', {
            statusFrom: session.status ?? null,
            statusTo: dto.status ?? session.status ?? null,
            fileRefs,
            canvasChanged,
            metadataChanged,
            statusChanged,
            fileRefsChanged,
          });
        }
      } else if (statusChanged || fileRefsChanged) {
        await this.recordOperatorAction(op, session.id, 'session.update', {
          statusFrom: session.status ?? null,
          statusTo: dto.status ?? session.status ?? null,
          fileRefs,
        });
      }
    }

    // 캔버스 데이터 업데이트
    if (dto.canvasData !== undefined) {
      // P1-4 (2026-08-22): 덮어쓰기 직전 스냅샷 — 실패해도 저장은 계속(로깅만)
      // 운영자 쓰기는 created_by 를 남기지 않는다(NaN → null). 운영자는 감사 기록으로 식별한다.
      try {
        await this.snapshotBeforeOverwrite(session, dto.canvasData, op ? Number.NaN : userId);
      } catch (e) {
        this.logger.warn(`[versions] snapshot 실패 (무시) session=${id}: ${(e as Error)?.message}`);
      }
      session.canvasData = dto.canvasData;
    }

    // 메타데이터 병합 — 서버 소유 키(launch·revision·production·productProfile)는 클라이언트 값 무시(mergeSessionMetadata)
    if (dto.metadata !== undefined) {
      session.metadata = mergeSessionMetadata(session.metadata, dto.metadata);
      // security-2: productProfile 스냅샷은 서버가 템플릿셋 현재값으로 재기록(NULL 세트 = 키 제거)
      session.metadata =
        (await this.stampProductProfileSnapshot(session.metadata, session.templateSetId, `update ${id}`)) ??
        session.metadata;
    }

    // 상태 업데이트
    if (dto.status !== undefined) {
      session.status = dto.status;
      if (dto.status === SessionStatus.COMPLETE) {
        session.completedAt = new Date();
      }
    }

    // 파일 ID 업데이트 — coverFileId/contentFileId는 @RelationId(read-only)이므로
    // ManyToOne relation을 통해 set해야 실제 cover_file_id/content_file_id 칼럼이 갱신됨.
    if (dto.coverFileId !== undefined) {
      session.coverFile = dto.coverFileId ? ({ id: dto.coverFileId } as any) : null;
    }
    if (dto.contentFileId !== undefined) {
      session.contentFile = dto.contentFileId ? ({ id: dto.contentFileId } as any) : null;
    }

    // ── Phase 4 (2026-05-19) — 고객 첨부 내지 PDF 필드 ──
    if (dto.contentPdfFileId !== undefined) {
      session.contentPdfFileId = dto.contentPdfFileId;
      // PDF 를 비우면 검증 결과도 클리어 (재첨부 시 새 검증 결과로 덮어씀)
      if (dto.contentPdfFileId === null) {
        session.contentPdfPageCount = null;
        session.contentPdfValidationResult = null;
      }
    }
    if (dto.contentPdfPageCount !== undefined) {
      session.contentPdfPageCount = dto.contentPdfPageCount;
    }
    if (dto.contentPdfValidationResult !== undefined) {
      session.contentPdfValidationResult = dto.contentPdfValidationResult;
    }
    // P0-2: 첨부 모드(replace|underlay). PDF 제거 시 모드도 클리어.
    if (dto.contentPdfMode !== undefined) {
      session.contentPdfMode = dto.contentPdfMode;
    }
    if (dto.contentPdfFileId === null) {
      session.contentPdfMode = null;
    }

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Updated edit session ${id}${isGuest ? ' (guest)' : ''}`);

    return updated;
  }

  // ───────────────────────────────────────────────────────────────
  // P1-4 (2026-08-22) — canvasData 덮어쓰기 직전 스냅샷 (file_edit_session_versions)
  //
  // 구조 원인: 프로덕션 /embed 세션 모델(file_edit_sessions)은 update() 가 canvasData 를
  // 그대로 덮어써 절단(R2)·오저장이 영구화됐다. 레거시 edit_sessions 의 버전 테이블은
  // 이 모델과 무관(프로덕션 0행). 여기서 **이전 값**을 보존해 복구 경로를 연다.
  // ───────────────────────────────────────────────────────────────
  /** 세션당 통상(autosave) 스냅샷 최소 간격 */
  static readonly VERSION_DEBOUNCE_MS = 60_000;
  /** 세션당 보존 건수(전체) */
  static readonly VERSION_KEEP = 10;
  /** shrink(페이지 수 감소) 스냅샷은 트림에서 최근 N 건 보호 */
  static readonly SHRINK_KEEP = 5;
  /** staff-baseline(관리자 편집 직전) 스냅샷은 가장 오래된 1건 + 최근 N 건 보호 */
  static readonly STAFF_BASELINE_KEEP = 2;

  private lastVersionAt: Map<string, number> = new Map();

  /** canvasData 의 캔버스 수 — 배열이면 길이, 객체면 1, 없으면 0 */
  static countCanvases(canvasData: unknown): number {
    if (canvasData == null) return 0;
    return Array.isArray(canvasData) ? canvasData.length : 1;
  }

  /**
   * update() 가 canvasData 를 덮어쓰기 직전에 호출. 이전 값이 없거나(최초 저장) 동일하면 저장하지 않는다.
   * page_count 감소는 절단 의심(shrink) — debounce 무시. 통상은 세션당 60s debounce.
   */
  async snapshotBeforeOverwrite(
    session: EditSessionEntity,
    nextCanvasData: unknown,
    createdBy: number,
    reasonOverride?: EditSessionVersionReason,
  ): Promise<EditSessionVersionEntity | null> {
    const prev = session.canvasData;
    if (prev == null) return null;
    const prevCount = EditSessionsService.countCanvases(prev);
    const nextCount = EditSessionsService.countCanvases(nextCanvasData);
    const reason: EditSessionVersionReason =
      reasonOverride ?? (nextCount < prevCount ? 'shrink' : 'autosave');

    const now = Date.now();
    if (reason === 'autosave') {
      const last = this.lastVersionAt.get(session.id) ?? 0;
      if (now - last < EditSessionsService.VERSION_DEBOUNCE_MS) return null;
    }
    // 동일 내용이면 스냅샷 무의미(자동저장 무변경 저장 흡수)
    if (reason !== 'restore' && JSON.stringify(prev) === JSON.stringify(nextCanvasData)) {
      return null;
    }
    // restore 중복 억제 (2026-08-23): 클라이언트/프록시 재시도로 같은 (session, version) restore 가
    // 연속 호출되면 매번 restore 스냅샷이 쌓여 VERSION_KEEP 트림이 오래된 autosave 시점을 밀어낸다.
    //  (1) 현재 상태가 이미 복원 대상과 동일 = 멱등 재호출 → 보존할 '직전 상태' 없음
    //  (2) 세션의 가장 최근 스냅샷이 현재 상태와 동일 → 직전 상태가 이미 보존됨
    // 조회 실패는 삼키고 스냅샷을 진행한다(보수: 누락보다 중복이 낫다).
    if (reason === 'restore') {
      const prevJson = JSON.stringify(prev);
      if (prevJson === JSON.stringify(nextCanvasData)) return null;
      try {
        const latest = await this.versionRepository.findOne({
          where: { session: { id: session.id } },
          select: ['id', 'reason', 'canvasData'],
          order: { createdAt: 'DESC' },
        });
        if (latest && JSON.stringify(latest.canvasData) === prevJson) return null;
      } catch (e) {
        this.logger.warn(
          `[versions] restore 중복 확인 조회 실패 (스냅샷 진행) session=${session.id}: ${(e as Error)?.message}`,
        );
      }
    }

    const version = this.versionRepository.create({
      session: { id: session.id } as EditSessionEntity,
      canvasData: prev,
      pageCount: prevCount,
      nextPageCount: nextCount,
      reason,
      sessionStatus: session.status ?? null,
      createdBy: Number.isFinite(createdBy) ? createdBy : null,
    });
    const saved = await this.versionRepository.save(version);
    this.lastVersionAt.set(session.id, now);
    if (reason === 'shrink') {
      this.logger.warn(
        `[versions] shrink 스냅샷 session=${session.id} ${prevCount}→${nextCount} (version=${saved.id})`,
      );
    }
    await this.trimVersions(session.id);
    return saved;
  }

  /** 세션당 VERSION_KEEP 초과분 삭제 — shrink 는 최근 SHRINK_KEEP 건 보호 */
  private async trimVersions(sessionId: string): Promise<void> {
    const all = await this.versionRepository.find({
      where: { session: { id: sessionId } },
      select: ['id', 'reason', 'createdAt'],
      order: { createdAt: 'DESC' },
    });
    if (all.length <= EditSessionsService.VERSION_KEEP) return;
    let shrinkSeen = 0;
    const protectedIds = new Set<string>();
    for (const v of all) {
      if (v.reason === 'shrink' && shrinkSeen < EditSessionsService.SHRINK_KEEP) {
        protectedIds.add(v.id);
        shrinkSeen++;
      }
    }
    // 관리자 편집 직전 스냅샷(2026-09-29): 가장 오래된 1건 + 최근 STAFF_BASELINE_KEEP 건 보호(고객 이력 보존).
    const baselines = all.filter((v) => v.reason === 'staff-baseline');
    if (baselines.length > 0) {
      protectedIds.add(baselines[baselines.length - 1].id);
      for (const v of baselines.slice(0, EditSessionsService.STAFF_BASELINE_KEEP)) protectedIds.add(v.id);
    }
    const toDelete: string[] = [];
    let kept = 0;
    for (const v of all) {
      if (protectedIds.has(v.id)) { kept++; continue; }
      if (kept < EditSessionsService.VERSION_KEEP) { kept++; continue; }
      toDelete.push(v.id);
    }
    if (toDelete.length) await this.versionRepository.delete(toDelete);
  }

  /**
   * 관리자 편집 직전 스냅샷(2026-09-29) — 편집기 권한 발급 전에 호출한다(StaffEditDataService).
   * canvasData 가 없으면 아무것도 하지 않는다. 가장 최근 'staff-baseline' 과 내용이 같으면 중복 저장하지 않는다.
   * 오류는 그대로 던진다(호출부가 503 STAFF_BASELINE_UNAVAILABLE 로 바꾸고 발급을 중단한다).
   */
  async pinStaffBaseline(sessionId: string): Promise<EditSessionVersionEntity | null> {
    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      select: ['id', 'canvasData', 'status'],
    });
    if (!session || session.canvasData == null) return null;
    const currentJson = JSON.stringify(session.canvasData);
    const latest = await this.versionRepository.findOne({
      where: { session: { id: sessionId }, reason: 'staff-baseline' },
      select: ['id', 'canvasData'],
      order: { createdAt: 'DESC' },
    });
    if (latest && JSON.stringify(latest.canvasData) === currentJson) return null;
    const pageCount = EditSessionsService.countCanvases(session.canvasData);
    const version = this.versionRepository.create({
      session: { id: sessionId } as EditSessionEntity,
      canvasData: session.canvasData,
      pageCount,
      nextPageCount: pageCount,
      reason: 'staff-baseline',
      sessionStatus: session.status ?? null,
      createdBy: null,
    });
    const saved = await this.versionRepository.save(version);
    await this.trimVersions(sessionId);
    this.logger.log(`[versions] staff-baseline 스냅샷 session=${sessionId} (version=${saved.id})`);
    return saved;
  }

  /**
   * 레거시 관리자 경로(admin-app JWT)의 편집데이터 보관기간·감사 게이트(2026-09-29).
   * 대상: 버전 복원·삭제 세션 복구·게스트 세션 staff 수정/완료. 게스트 토큰·고객·운영자 경로는 호출하지 않는다.
   *  1) 사이트 편집데이터 보관기간(sites PK 조회, NULL-site = 미설정) → 만료면 409 EDIT_RETENTION_EXPIRED
   *  2) 감사 행(origin 'staff', 'staff.legacy.<action>') fail-closed → 실패 시 503 STAFF_AUDIT_UNAVAILABLE
   */
  async gateLegacyStaffMutation(
    session: Pick<EditSessionEntity, 'id' | 'siteId' | 'createdAt' | 'guestToken' | 'guestExpiresAt'>,
    adminUserId: string | undefined,
    action: LegacyStaffMutation,
  ): Promise<void> {
    let days: number | null = null;
    if (typeof session.siteId === 'string' && session.siteId.length > 0) {
      try {
        const rows: Array<{ days: unknown }> = await this.sessionRepository.manager.query(
          'SELECT edit_retention_days AS days FROM sites WHERE id = ? LIMIT 1',
          [session.siteId],
        );
        const raw = Array.isArray(rows) && rows[0] ? rows[0].days : null;
        days = raw === null || raw === undefined ? null : Number(raw);
      } catch (e) {
        this.logger.error(
          `[edit-retention] 보관기간 조회 실패(작업 중단) session=${session.id} site=${session.siteId}: ${(e as Error)?.message}`,
        );
        throw staffAuditUnavailable();
      }
    }
    const retention = computeEditRetention(
      { createdAt: session.createdAt, isGuest: !!session.guestToken, guestExpiresAt: session.guestExpiresAt },
      days,
    );
    if (retention.state === 'expired') throw editRetentionExpired(retention.until);

    if (!this.partnerOperatorAudit) throw staffAuditUnavailable();
    try {
      await this.partnerOperatorAudit.recordOrThrow({
        grantId: null,
        origin: 'staff',
        actorUserId: adminUserId ?? null,
        siteId: session.siteId ?? null,
        sessionId: session.id,
        operatorId: `staff.${adminUserId ?? 'unknown'}`,
        action: `staff.legacy.${action}`,
        detail: { retentionState: retention.state, retentionUntil: retention.until },
      });
    } catch {
      throw staffAuditUnavailable();
    }
  }

  /** 세션의 스냅샷 목록(canvasData 제외 — 경량) */
  async listVersions(sessionId: string): Promise<
    Array<{
      id: string;
      createdAt: Date;
      pageCount: number;
      nextPageCount: number | null;
      reason: EditSessionVersionReason;
      sessionStatus: string | null;
    }>
  > {
    const rows = await this.versionRepository.find({
      where: { session: { id: sessionId } },
      select: ['id', 'createdAt', 'pageCount', 'nextPageCount', 'reason', 'sessionStatus'],
      order: { createdAt: 'DESC' },
    });
    return rows.map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      pageCount: v.pageCount,
      nextPageCount: v.nextPageCount,
      reason: v.reason,
      sessionStatus: v.sessionStatus,
    }));
  }

  async getVersion(sessionId: string, versionId: string): Promise<EditSessionVersionEntity> {
    const version = await this.versionRepository.findOne({
      where: { id: versionId, session: { id: sessionId } },
    });
    if (!version) {
      throw new NotFoundException({
        code: 'VERSION_NOT_FOUND',
        message: '세션 스냅샷을 찾을 수 없습니다.',
        details: { sessionId, versionId },
      });
    }
    return version;
  }

  /**
   * 스냅샷으로 canvasData 복원. 복원 직전의 현재 상태는 reason='restore' 로 보존(되돌리기).
   * 호출측(컨트롤러)이 소유 검사를 끝낸 뒤 호출한다. status 는 건드리지 않는다.
   */
  async restoreVersion(
    sessionId: string,
    versionId: string,
    userId: number,
    partnerOperator?: PartnerOperatorGrant | null,
  ): Promise<EditSessionEntity> {
    const session = await this.findById(sessionId);
    // 운영자 대리 편집: 컨트롤러 검사와 별도로 권한 범위를 다시 확인한다(같은 404).
    if (partnerOperator) this.assertTenantScope(session, { partnerOperator });
    // PDF 첨부 ↔ 편집 배타(replace 모드) — update() 와 동일 가드. 복원도 canvasData 변경이므로
    // 스냅샷 생성·save 이전(부수효과 0)에 차단한다. underlay 모드는 허용.
    if (
      session.contentPdfFileId &&
      (session.contentPdfMode ?? 'replace') !== 'underlay'
    ) {
      throw new BadRequestException({
        code: 'PDF_ATTACHED_EXCLUSIVE',
        message: '내지 PDF 첨부(replace) 상태에서는 편집 캔버스를 변경할 수 없습니다. PDF 를 먼저 제거하거나 underlay 모드로 첨부하세요.',
      });
    }
    const version = await this.getVersion(sessionId, versionId);
    if (partnerOperator) {
      await this.recordOperatorAction(partnerOperator, session.id, 'session.version_restore', {
        versionId,
        statusFrom: session.status ?? null,
      });
    }
    try {
      await this.snapshotBeforeOverwrite(
        session,
        version.canvasData,
        partnerOperator ? Number.NaN : userId,
        'restore',
      );
    } catch (e) {
      this.logger.warn(`[versions] restore 전 스냅샷 실패 (무시) session=${sessionId}: ${(e as Error)?.message}`);
    }
    session.canvasData = version.canvasData;
    const saved = await this.sessionRepository.save(session);
    this.logger.log(
      `[versions] restored session=${sessionId} from version=${versionId} (pages=${version.pageCount})`,
    );
    return saved;
  }

  /**
   * 게스트 세션 마이그레이션 — 인쇄 워크플로우 v1 Phase 6-B (2026-05-19).
   *
   * 결정 3-6: 회원 전환은 저장(편집완료) 시점에만. 본 메서드는 로그인 직후 호출되어
   * 게스트 세션을 해당 회원 소유로 흡수.
   *
   * 보안:
   * - guestToken 일치 세션만 흡수 가능 (타인 세션 흡수 불가)
   * - 호출자는 인증된 사용자 (controller 가 JWT 검증)
   *
   * 작업:
   * - WHERE guest_token = ? → memberSeqno 채움
   * - guestToken / guestExpiresAt NULL 처리 (EVENT 가 더 이상 삭제 안 함)
   *
   * ── 테넌시 불변식 (2026-07-30) ────────────────────────────────────────────
   * I-2: **non-null siteId 는 어떤 경로에서도 덮어쓰지 않는다.** 본 메서드는
   *      memberSeqno/guestToken/guestExpiresAt 만 쓴다. NULL 을 채우지도 않는다 —
   *      "guestToken 보유"는 세션 **소유** 증명이지 **발사 테넌트** 증명이 아니라서
   *      여기서 caller 의 siteId 를 찍으면 그게 곧 테넌트 위조 통로가 된다.
   * I-3: 세션 siteId 와 caller siteId 가 **둘 다 non-null 이고 불일치**하면
   *      **요청 전체를 거부**한다(부분 흡수·조용한 스킵·조용한 덮어쓰기 전부 금지).
   *
   * callerSiteId 가 null 인 경우(예: siteId 를 담지 않던 구형 refreshToken)는
   * **허용 + warn**. 근거: 본 메서드가 siteId 를 쓰지 않으므로 테넌시가 변하지 않고,
   * 흡수된 세션은 여전히 원래 site 로 스탬프되어 타 site 키의 승격은 404 다.
   * 여기서 거부하면 정상 사용자가 토큰 리프레시 한 번으로 마이그레이션 불가가 되는
   * 신규 장애만 생긴다. — 의도된 완화.
   */
  async migrateGuestSessions(
    guestToken: string,
    memberSeqno: number,
    callerSiteId?: string | null,
  ): Promise<{ migratedCount: number; sessionIds: string[] }> {
    // 흡수 대상 회원 번호는 양의 정수만(조회·저장 전에 판정).
    if (!(memberSeqno > 0)) {
      throw new ForbiddenException({
        code: 'AUTH_REQUIRED',
        message: '회원 마이그레이션은 로그인 사용자만 가능합니다.',
      });
    }
    const sessions = await this.sessionRepository.find({
      where: { guestToken },
    });
    if (sessions.length === 0) {
      return { migratedCount: 0, sessionIds: [] };
    }

    // I-3 — 교차 site 흡수 거부(요청 전체).
    if (callerSiteId) {
      const foreign = sessions.filter((s) => s.siteId && s.siteId !== callerSiteId);
      if (foreign.length > 0) {
        this.logger.warn(
          `[tenancy] CROSS_SITE_MIGRATION_DENIED — caller site=${callerSiteId}, ` +
            `foreign=${foreign.length}/${sessions.length}, token=${guestToken.slice(0, 8)}…`,
        );
        throw new ForbiddenException({
          code: 'CROSS_SITE_MIGRATION_DENIED',
          message: '다른 사이트에서 생성된 게스트 세션은 흡수할 수 없습니다.',
        });
      }
    } else {
      this.logger.warn(
        `[tenancy] guest migrate without caller site — token=${guestToken.slice(0, 8)}…, ` +
          `member=${memberSeqno}, sessions=${sessions.length} (siteId 무변경이므로 허용)`,
      );
    }

    // 만료 세션은 흡수하지 않는다 — EVENT 가 곧 DELETE 할 행을 회원 소유로 되살리지 않는다.
    const now = new Date();
    const live = sessions.filter((s) => !s.guestExpiresAt || s.guestExpiresAt > now);
    if (live.length === 0) {
      return { migratedCount: 0, sessionIds: [] };
    }

    const sessionIds: string[] = [];
    for (const session of live) {
      // ⚠️ I-2 — session.siteId 는 읽지도 쓰지도 않는다.
      session.memberSeqno = memberSeqno as any;
      session.guestToken = null;
      session.guestExpiresAt = null;
      await this.sessionRepository.save(session);
      sessionIds.push(session.id);
    }

    this.logger.log(
      `Migrated ${live.length} guest session(s) to member ${memberSeqno} (token=${guestToken.slice(0, 8)}…)`,
    );
    return { migratedCount: live.length, sessionIds };
  }

  /**
   * 내 세션 목록 — 인쇄 워크플로우 v1 Phase 6-C (2026-05-19).
   *
   * 로그인 사용자 본인 세션을 최근순 200건 반환.
   * 게스트 토큰 보유 세션은 제외 (회원만의 영구 보관 작업).
   */
  async findMyRecent(memberSeqno: number, limit = 200): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { memberSeqno: memberSeqno as any, guestToken: null as any },
      relations: ['coverFile', 'contentFile'],
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 내 세션 목록 — 경량(summary) 모드 (2026-06-11).
   *
   * bookmoa-mobile '편집보관함' 등 모바일 목록 UI 용. findMyRecent 와 동일 조회 후:
   *  - canvasData 제외 — 세션당 수백KB~MB 라 목록 응답에 부적합.
   *  - templateSetName(template_sets.name) 추가 — 단일 IN 쿼리 배치 조회(세션당 N+1 금지).
   *  - thumbnailUrl(coverFile.thumbnailUrl) 평탄화 추가.
   * 기본(GET /my 무파라미터) 경로는 본 메서드를 타지 않으므로 현행 응답 100% 불변.
   */
  async findMyRecentSummary(memberSeqno: number): Promise<EditSessionResponseDto[]> {
    const sessions = await this.findMyRecent(memberSeqno);
    const templateSetIds = sessions
      .map((s) => s.templateSetId)
      .filter((id): id is string => !!id);
    const nameMap = await this.getTemplateSetNames(templateSetIds);
    return sessions.map((s) =>
      this.toSummaryResponseDto(
        s,
        s.templateSetId ? (nameMap.get(s.templateSetId) ?? null) : null,
      ),
    );
  }

  /**
   * 삭제된 세션 목록 — admin '삭제 리스트' 메뉴 (2026-06-11).
   *
   * 고객이 보관함/장바구니에서 삭제(soft delete)한 세션을 admin 이 누적 조회·복구하기 위한
   * 목록. withDeleted + deletedAt IS NOT NULL 로 삭제분만, 삭제시각 내림차순.
   * 응답은 summary 매퍼(canvasData 제외 + templateSetName/thumbnailUrl) + deletedAt 포함.
   * 게스트 세션은 DB EVENT 가 24h 후 hard DELETE 하므로 여기 잔존분은 회원 세션 위주.
   */
  async findDeleted(opts: {
    memberSeqno?: number;
    orderSeqno?: number;
    siteId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ sessions: EditSessionResponseDto[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20));

    const qb = this.sessionRepository
      .createQueryBuilder('session')
      .withDeleted()
      .leftJoinAndSelect('session.coverFile', 'coverFile')
      .leftJoinAndSelect('session.contentFile', 'contentFile')
      .where('session.deletedAt IS NOT NULL');

    if (opts.memberSeqno) {
      qb.andWhere('session.memberSeqno = :memberSeqno', { memberSeqno: opts.memberSeqno });
    }
    if (opts.orderSeqno) {
      qb.andWhere('session.orderSeqno = :orderSeqno', { orderSeqno: opts.orderSeqno });
    }
    if (opts.siteId) {
      qb.andWhere('session.siteId = :siteId', { siteId: opts.siteId });
    }

    const [sessions, total] = await qb
      .orderBy('session.deletedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const templateSetIds = sessions
      .map((s) => s.templateSetId)
      .filter((id): id is string => !!id);
    const nameMap = await this.getTemplateSetNames(templateSetIds);

    return {
      sessions: sessions.map((s) => {
        const dto = this.toSummaryResponseDto(
          s,
          s.templateSetId ? (nameMap.get(s.templateSetId) ?? null) : null,
        );
        dto.deletedAt = s.deletedAt; // 삭제요청시간 — 삭제 리스트 전용 노출
        return dto;
      }),
      total,
    };
  }

  /**
   * 삭제된 세션 복구 — admin 전용 (2026-06-11).
   *
   * 고객이 실수로 삭제한 세션 복원 요구 대응. softDelete 는 파일(coverFile/contentFile)을
   * 건드리지 않으므로 deletedAt 해제만으로 완전 복구된다(보관함/불러오기 모달 재노출).
   * 멱등: 이미 활성(deletedAt null)이면 그대로 반환.
   */
  async restoreSession(id: string): Promise<EditSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      withDeleted: true,
      relations: ['coverFile', 'contentFile'],
    });

    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: id },
      });
    }

    if (session.deletedAt) {
      await this.sessionRepository.restore(id);
      session.deletedAt = null;
      this.logger.log(`Restored edit session ${id} (admin)`);
    }

    return session;
  }

  /**
   * templateSetId 목록 → 이름 매핑 배치 조회 (단일 IN 쿼리).
   * findByOrderExternal 의 manager 쿼리빌더 관례 재사용. 빈 입력이면 쿼리 없이 빈 Map.
   */
  private async getTemplateSetNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return map;

    const rows = await this.sessionRepository.manager
      .createQueryBuilder()
      .select('ts.id', 'id')
      .addSelect('ts.name', 'name')
      .from('template_sets', 'ts')
      .where('ts.id IN (:...ids)', { ids: uniqueIds })
      .getRawMany();

    for (const row of rows) {
      map.set(row.id, row.name);
    }
    return map;
  }

  /**
   * 세션 완료 처리
   *
   * 인쇄 워크플로우 v1 Phase 5 (2026-05-19):
   * - 게스트 세션도 complete 호출 가능 (userId=0 통과)
   * - 기존 SPREAD / 일반 흐름은 그대로 유지 (PHP 영향 0).
   *
   * ⚠️ [주석 정정 2026-08-13] 이 메서드는 **compose-mixed 잡을 발행하지 않는다**.
   *   이전 주석은 "contentPdfFileId / endpaperConfig / coverEditable=false 가 있으면
   *   compose-mixed 잡 enqueue 분기" 라고 적었으나, 본문에 그런 분기는 없다.
   *   본문이 실제로 하는 일은 아래가 전부다(로직 무변경, 주석만 실제 동작에 정렬):
   *     1) 책 세션(mode===SPREAD 또는 metadata.spread)이면 스프레드 스냅샷 검증
   *        (기본 SOFT — env SPREAD_SNAPSHOT_HARD_FAIL='true' 일 때만 차단)
   *     2) status=COMPLETE / completedAt 저장
   *     3) mode !== SPREAD 인 경우에만 createValidationJobs + applyPdfOutputMode
   *     4) 모든 경로에서 createInnerPdfImpositionJob (내부 opt-in 게이트, 기본 no-op)
   *   합본(표지+앞면지+내지+뒷면지)은 **외부 호출자가 명시적으로 호출**하는
   *   `POST /api/worker-jobs/compose-mixed` (worker-jobs.controller.ts:281-288, @Public)
   *   에서만 발행된다 — 세션 완료가 자동으로 발행하지 않는다는 사실은 그대로다.
   *
   * ℹ️ [보강 2026-08-13 G7] 세션 자산으로부터의 자동 조립은 이제 **구현돼 있다**
   *   (이전 판본 주석의 '미구현' 서술 정정). 단 위치는 이 메서드가 아니라
   *   compose-mixed 라우트다 — 요청 body 의 `assembleFromSession === true` 일 때에 한해
   *   worker-jobs.service.ts 가 이 세션에서 표지(coverFile)·내지(contentPdfFileId 우선,
   *   없으면 contentFile)·면지 매수·판형·callbackUrl·siteId 를 도출해 빈 필드만 채운다
   *   (assembleComposeInputFromSession, worker-jobs.service.ts:1223 / 분기 게이트 :1567).
   *   달라진 것은 compose-mixed 쪽뿐이고, **이 complete() 의 동작은 변함이 없다**:
   *   여전히 잡 발행은 호출자 트리거이며, 자동조립도 그 호출 안에서 일어난다.
   *   인가는 그 경로에만 붙는다(검증된 shop-session siteId ↔ session.siteId 일치 +
   *   주문 스코프, 실패 시 404 SESSION_NOT_FOUND). 미전달/false 면 기존 경로 그대로다.
   */
  async complete(
    id: string,
    userId: number,
    caller?: TenantCaller | null,
  ): Promise<EditSessionEntity> {
    const session = await this.findById(id);
    this.assertTenantScope(session, caller);

    // 게스트 세션 완료는 staff 만 (2026-09-29). 게스트 작업은 guest/migrate 로 회원 세션이 된 뒤
    // 회원 토큰으로 완료한다. 회원 세션은 소유자만 완료한다.
    // 운영자 대리 편집(2026-09-29): 권한 범위 안(assertTenantScope 통과)이면 두 판정을 대신한다.
    const op = caller?.partnerOperator ?? null;
    // 관리자 편집데이터 관리(2026-09-29): staff 컨텍스트는 범위 안에서 두 판정을 대신한다.
    const staff = caller?.staff ?? null;
    const isGuest = !!session.guestToken;
    if (!op && !staff && isGuest && !EditSessionsService.isStaffRole(caller?.role)) {
      throw new ForbiddenException({
        code: 'GUEST_COMPLETE_NOT_ALLOWED',
        message: '비회원 편집 세션은 로그인 후(세션 흡수) 완료할 수 있습니다.',
      });
    }
    if (!op && !staff && !isGuest && (!(userId > 0) || Number(session.memberSeqno) !== userId)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 완료할 권한이 없습니다.',
      });
    }
    // 레거시 관리자 경로(admin JWT 의 게스트 세션 완료) — 보관기간 확인 + 감사(fail-closed).
    if (!op && !staff && isGuest && typeof caller?.adminUserId === 'string') {
      await this.gateLegacyStaffMutation(session, caller.adminUserId, 'guest_complete');
    }

    // 스프레드 책 스냅샷 검증.
    // 게이트: session.mode===SPREAD(PHP/worker 합성 경로) 또는 metadata.spread 존재(편집기 책 완료 경로).
    //   편집기는 책 완료 시에도 mode 를 'both'/'cover' 로 보내 SessionMode.SPREAD 가 안 걸리므로
    //   metadata.spread 존재로 편집기 책 완료를 포착한다(P0-1 이 metadata.spread 를 채움).
    // 기본 SOFT: 누락/불일치를 경고·기록만(throw 금지) → 기존 주문 무중단.
    //   env SPREAD_SNAPSHOT_HARD_FAIL='true' 일 때만 HARD(차단)로 승격(P0-3 이후).
    const isBookSession =
      session.mode === SessionMode.SPREAD || !!session.metadata?.spread;
    if (isBookSession) {
      const validation = this.validateSpreadSnapshot(session);
      // B49: 스냅샷 spec 을 템플릿 권위 기하(표지 가로/세로·날개, 책등 제외)와 대조해 병합.
      const authorityMismatches = await this.compareSpreadWithTemplateAuthority(session);
      if (authorityMismatches.length > 0) {
        validation.ok = false;
        validation.mismatches = [...validation.mismatches, ...authorityMismatches];
        const hardFail = isSpreadSnapshotHardFail();
        this.logger.warn(
          `[spread-spec] session ${session.id} 템플릿 권위 불일치 ${hardFail ? 'HARD' : 'SOFT'}: ${authorityMismatches.join(' | ')}`,
        );
        if (hardFail) {
          throw new BadRequestException({
            code: 'TEMPLATE_SPEC_MISMATCH',
            message: '스프레드 스펙이 템플릿 권위(spreadConfig)와 불일치합니다.',
            mismatches: authorityMismatches,
          });
        }
      }
      session.metadata = { ...(session.metadata ?? {}), spreadValidation: validation };
    }

    if (op) {
      await this.recordOperatorAction(op, session.id, 'session.complete', {
        statusFrom: session.status ?? null,
      });
    }

    session.status = SessionStatus.COMPLETE;
    session.completedAt = new Date();
    // P2-b(2026-10-18) 산출 회차 — 완료할 때마다 1 증가(런처 세션은 launch 시 0 으로 시작). 파트너 v1
    // deliverables.revision · synthesize 재합성 회차의 단일 원천. 그 밖의 소비처 없음(additive).
    session.metadata = { ...(session.metadata ?? {}), revision: nextSessionRevision(session.metadata) };
    // security-2: 완료 시에도 productProfile 스냅샷을 템플릿셋 현재값으로 재기록(NULL 세트 = 키 제거) — 검증 잡·sheet-map
    // 발행·파트너 deliverables 가 모두 서버 기록값만 보게 한다.
    session.metadata =
      (await this.stampProductProfileSnapshot(session.metadata, session.templateSetId, `complete ${id}`)) ??
      session.metadata;

    const completed = await this.sessionRepository.save(session);
    this.logger.log(`Completed edit session ${id}${isGuest ? ' (guest)' : ''}`);

    // 스프레드 모드는 자동 검증 잡 발행을 스킵.
    // 표지(펼침면)는 일반 사이즈 검증(±1mm)에서 SIZE_MISMATCH가 나기 때문이며,
    // 실제 합성/검증은 PHP가 worker-jobs/synthesize/external 또는 spread 전용
    // 흐름을 호출하는 시점에 수행 (NEW_DEV_PLAN §3 PHP 무변경 정책과 정합).
    if (completed.mode !== SessionMode.SPREAD) {
      await this.createValidationJobs(completed);
      // 단일/낱장 상품의 PDF 출력 모드(TemplateSet.pdfOutputMode) 적용.
      // 책(spread) 셋은 위 분기(mode !== SPREAD)에서 이미 제외 — 책의 최종 합본은
      // 외부 호출자가 직접 발행하는 compose-mixed 잡이 담당한다(여기서 발행하지 않음).
      await this.applyPdfOutputMode(completed);
    } else {
      this.logger.log(
        `Skipping auto validation jobs for SPREAD session ${id} (PHP-driven synthesis flow)`,
      );
    }

    // P4 (2026-06-10) — 고객 업로드 내지 PDF 작업사이즈 자동 임포지션 (opt-in).
    // 마스터 게이트: TemplateSet.cropMarkEnabled === true 인 세션만 변환 잡 발행.
    //   cropMarkEnabled !== true → 완전 no-op(현행 보존). 기본 false 라 배포 무변경.
    // 메서드 내부에서 모든 게이트/예외를 처리하므로 spread 포함 모든 경로에서 안전 호출.
    await this.createInnerPdfImpositionJob(completed);

    return completed;
  }

  /**
   * P4 — 고객 업로드 내지 PDF 작업사이즈 자동 임포지션 잡 발행 (2026-06-10, opt-in).
   *
   * 대상: 고객이 첨부한 내지 PDF (session.contentPdfFileId). 편집기 산출 PDF(coverFileId/
   * contentFileId)는 대상이 아니다(convert 미경유 정책 유지).
   *
   * ⚠️ 마스터 opt-in 게이트 — TemplateSet.cropMarkEnabled === true 일 때만 발행:
   *   - cropMarkEnabled !== true            → 발행 안 함(현행 100% 보존). 기본 false.
   *   - contentPdfFileId 없음               → 발행 안 함(첨부 내지 없음).
   *   - underlay 모드(표시전용)              → 발행 안 함. 최종 인쇄는 원본 PDF 그대로라
   *                                            임포지션 무의미(엔티티 주석 §content_pdf_mode).
   *   - templateSet 미연결/조회실패/workSize 무효 → 발행 안 함(best-effort).
   *
   * 동작: convert 잡을 발행하되 convertOptions 에 editSize(=작업사이즈=trim+bleed*2),
   * sizeToleranceMm 만 주입한다. mode 는 주입하지 않음 → 워커 convert() 의 resolveMode 가
   * 실측 vs editSize±tol 비교로 자체결정(동일=passthrough / 큼=innerfit / 작음=center).
   *
   * 결과 되연결(P4 콜백, 2026-06-10): 본 잡에 editSessionId + convertOptions.purpose=
   * 'inner-imposition' 마커를 심는다. 워커 변환 완료 → updateJobStatus(COMPLETED) 시
   * worker-jobs.service.relinkImposedInnerPdf 가 결과 PDF 를 File 로 등록하고
   * session.contentPdfFileId 를 그 결과로 재포인팅한다(원본은 잡 inputFileUrl/별도 File 로 보존).
   * → 후속(PHP compose-mixed contentPdfUrl 조회, 마이페이지 다운로드)이 임포지션 결과를 사용.
   * cropMarkEnabled 가 기본 off 라 미opt-in 세션은 잡 자체가 없어 영향 0.
   *
   * best-effort: 어떤 실패도 세션 완료를 막지 않는다(throw 금지).
   */
  private async createInnerPdfImpositionJob(
    session: EditSessionEntity,
  ): Promise<void> {
    try {
      // 첨부 내지 PDF 없음 → no-op.
      if (!session.contentPdfFileId) return;

      // underlay(표시전용)는 원본 PDF 그대로 인쇄 → 임포지션 대상 아님.
      const pdfMode = session.contentPdfMode ?? 'replace';
      if (pdfMode === 'underlay') {
        this.logger.log(
          `[inner-imposition] session ${session.id}: contentPdfMode=underlay → 임포지션 스킵(원본 인쇄)`,
        );
        return;
      }

      // 템플릿셋 미연결 → 작업사이즈 산출 불가 → 스킵(현행).
      if (!session.templateSetId) return;

      let cropMarkEnabled = false;
      let workWidth: number | undefined;
      let workHeight: number | undefined;
      let sizeToleranceMm = 0.2;
      try {
        const templateSet = await this.templateSetsService.findOne(
          session.templateSetId,
        );
        cropMarkEnabled = templateSet.cropMarkEnabled === true;
        const bleedMm = templateSet.bleedMm ?? 3;
        sizeToleranceMm = templateSet.sizeToleranceMm ?? 0.2;
        // 작업(work) 사이즈 = 재단(판형) + 사방 블리드*2. (createValidationJobs 와 동일 규약)
        workWidth = templateSet.width + bleedMm * 2;
        workHeight = templateSet.height + bleedMm * 2;
      } catch (e) {
        this.logger.warn(
          `[inner-imposition] templateSet ${session.templateSetId} 조회 실패 → 임포지션 스킵(완료는 계속): ${(e as Error).message}`,
        );
        return;
      }

      // ⚠️ 마스터 게이트: opt-in 아니면 절대 발행 안 함(현행 100% 보존).
      if (!cropMarkEnabled) {
        return;
      }

      // 작업사이즈 무효 → 스킵.
      if (!(workWidth! > 0) || !(workHeight! > 0)) {
        this.logger.warn(
          `[inner-imposition] session ${session.id}: 작업사이즈 무효(${workWidth}x${workHeight}) → 스킵`,
        );
        return;
      }

      // 멱등 가드 (2026-06-10) — complete() 재진입 시 중복 발행 방지.
      //   PHP가 HTTP 타임아웃 후 complete 를 재호출하면 본 메서드가 재진입한다.
      //   이전 호출이 잡 발행 후 metadata.innerPdfImposition.jobId 스냅샷을 저장했다면
      //   이미 임포지션 잡이 존재 → 재발행하면 중복 변환 잡 + 중복 File 레코드가 생기므로 스킵.
      //   (스냅샷 저장 자체가 best-effort 라 드물게 가드가 빠질 수 있으나, 그 경우도
      //    relink 콜백이 동일 결과로 수렴해 기능상 해는 없음 — 중복 잡 비용만 발생)
      const existingJobId = (session.metadata as any)?.innerPdfImposition?.jobId;
      if (existingJobId) {
        this.logger.log(
          `[inner-imposition] session ${session.id}: 임포지션 잡 ${existingJobId} 이미 발행됨 → 중복 발행 스킵(멱등)`,
        );
        return;
      }

      const job = await this.workerJobsService.createConversionJob({
        fileId: session.contentPdfFileId,
        siteId: session.siteId ?? undefined,
        // P4 결과 콜백 — 잡↔세션 연결 + 임포지션 식별 마커.
        //  · editSessionId: 완료 콜백(updateJobStatus)이 세션을 역참조할 수 있게 edit_session_id 컬럼 세팅.
        //  · convertOptions.purpose='inner-imposition': updateJobStatus 가 "임포지션 잡"임을 판별하는 마커
        //    (이 마커가 없는 convert 잡=admin 자동수정 등은 콜백 개입 0 → 기존 동작 무영향).
        editSessionId: session.id,
        convertOptions: {
          // mode 미지정 → 워커 resolveMode 가 실측 vs editSize 로 자체결정.
          editSize: { width: workWidth, height: workHeight },
          sizeToleranceMm,
          purpose: 'inner-imposition',
          editSessionId: session.id,
          sourceFileId: session.contentPdfFileId,
        },
      });

      // 임포지션 잡 추적 정보를 metadata 에 스냅샷(후속 배선/검증용, additive).
      try {
        session.metadata = {
          ...(session.metadata ?? {}),
          innerPdfImposition: {
            jobId: job.id,
            sourceFileId: session.contentPdfFileId,
            workSize: { width: workWidth, height: workHeight },
            sizeToleranceMm,
            createdAt: new Date().toISOString(),
          },
        };
        await this.sessionRepository.save(session);
      } catch (e) {
        this.logger.warn(
          `[inner-imposition] metadata 스냅샷 저장 실패(무중단): ${(e as Error).message}`,
        );
      }

      this.logger.log(
        `[inner-imposition] Created conversion job ${job.id} for session ${session.id} ` +
          `(content_pdf=${session.contentPdfFileId}, work=${workWidth}x${workHeight}mm, tol=${sizeToleranceMm})`,
      );
    } catch (error) {
      // 완료 무중단 — 잡 발행 실패가 세션 완료를 막지 않도록.
      this.logger.error(
        `[inner-imposition] session ${session.id} 임포지션 잡 발행 실패(완료는 유지): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 단일/낱장 상품 PDF 출력 모드 적용 — 2026-06-09.
   *
   * 세션의 TemplateSet.pdfOutputMode 에 따라 최종 PDF 구성을 결정한다.
   * 적용 대상: 비-spread 세션(낱장/단일). 책 spread 셋은 호출측에서 이미 제외됨.
   *
   *  - 'single'        : 단면 1p. 편집기 산출 PDF 그대로가 최종(추가 잡 없음).
   *  - 'duplex-merged' : 양면 1파일(앞,뒤,…). 기존 기본 동작 그대로(추가 잡 없음).
   *  - 'duplex-split'  : 양면 — coverFileId(편집기 단일 PDF)를 앞/뒤 2페이지 세트별
   *                      개별 PDF n개로 분리하는 워커 잡 발행.
   *
   * best-effort: TemplateSet 미해결/파일부재/잡 생성 실패 시 경고만 남기고 완료는 무중단.
   * 출력 모드는 session.metadata.pdfOutputMode 에 스냅샷으로 기록(다운스트림/PHP 가독).
   */
  private async applyPdfOutputMode(session: EditSessionEntity): Promise<void> {
    try {
      if (!session.templateSetId) return; // 템플릿셋 미연결 → 기본(duplex-merged) 동작 유지

      let pdfOutputMode: string;
      let templateSet: Awaited<ReturnType<TemplateSetsService['findOne']>>;
      try {
        templateSet = await this.templateSetsService.findOne(
          session.templateSetId,
        );
        pdfOutputMode = templateSet.pdfOutputMode ?? 'duplex-merged';
      } catch (e) {
        this.logger.warn(
          `[pdfOutputMode] TemplateSet ${session.templateSetId} 조회 실패 → 기본(duplex-merged) 유지: ${(e as Error).message}`,
        );
        return;
      }

      // 출력 모드 스냅샷 기록 (additive, 실패해도 무중단)
      try {
        session.metadata = {
          ...(session.metadata ?? {}),
          pdfOutputMode,
        };
        await this.sessionRepository.save(session);
      } catch (e) {
        this.logger.warn(
          `[pdfOutputMode] metadata 스냅샷 저장 실패(무중단): ${(e as Error).message}`,
        );
      }

      // P2-c(2026-10-18): 상품 프로파일 output.mode='sheet-map' 이 pdfOutputMode 보다 우선한다(설계 §6.2 — 시트 매핑이
      // 이기면 duplex-split 잡은 만들지 않는다). 프로파일 원천은 sheet-validation-rules 와 같다(템플릿셋 우선, 없으면
      // 세션 스냅샷). 매핑 실패(SheetMapError)·잡 생성 실패는 완료를 막지 않되 production.sheetMap 에 기록한다(api-sheetmap-3).
      // 킬스위치 SHEET_MAP_OUTPUT_ENABLED=off 면 프로파일을 보지 않고 종전 pdfOutputMode 경로로 떨어진다.
      if (isSheetMapOutputEnabled()) {
        const profile = resolveSessionProductProfile({
          session,
          templateSet,
          warn: (m) => this.logger.warn(`[pdfOutputMode] session ${session.id}: ${m}`),
        });
        if (profile?.output.mode === 'sheet-map') {
          if (!session.coverFileId) {
            this.logger.warn(
              `[pdfOutputMode] session ${session.id}: sheet-map 이나 coverFileId 부재 → 시트 매핑 잡 스킵`,
            );
            return;
          }
          const revision = sessionRevisionOf(session.metadata);
          const pageCount = resolveSessionPageCount(session);
          try {
            // P2-d: 사진인화 세트는 metadata.items 의 매수를 시트 copies/label 로 주입(그 외 세트는 무변경).
            // items 는 캔버스 수·upload.maxPhotos 상한으로 자른다(security-1).
            const sheets = applyPhotoItemsToSheets(
              buildSheetMap(profile, pageCount),
              readSessionPhotoItems(profile, session.metadata, pageCount),
            );
            const job = await this.workerJobsService.createSheetMapJob({
              sessionId: session.id,
              pdfFileId: session.coverFileId,
              sheets,
              output: profile.output.sheetFiles ?? 'per-sheet',
              duplexFlip: profile.sheet.duplexFlip,
              // duplex-split 과 같은 회차 카운터·다른 접두사(sheet-map-r<revision>, ≤36자) — 재완료 = 새 회차 잡.
              requestId: sheetMapRevisionRequestId(revision),
              callbackUrl: session.callbackUrl ?? undefined,
              siteId: session.siteId ?? null,
              revision,
            });
            this.logger.log(
              `[pdfOutputMode] Created sheet-map job ${job.id} for session ${session.id} ` +
                `(cover=${session.coverFileId}, sheets=${sheets.length}, output=${profile.output.sheetFiles ?? 'per-sheet'}, pdfOutputMode='${pdfOutputMode}' 무시)`,
            );
            await this.clearSheetMapFailure(session, 'pdfOutputMode');
          } catch (e) {
            // api-sheetmap-3: 삼키지 않고 기록 — 파트너 deliverables 가 'failed' + errorCode/errorDetail 로 노출한다.
            await this.recordSheetMapFailure(session, e, 'pdfOutputMode');
          }
          return;
        }
      }

      // single / duplex-merged 는 편집기 산출 PDF 그대로가 최종 → 추가 잡 없음.
      if (pdfOutputMode !== 'duplex-split') {
        this.logger.log(
          `[pdfOutputMode] session ${session.id}: '${pdfOutputMode}' — 편집기 산출 PDF 그대로 사용(분리 없음)`,
        );
        return;
      }

      // duplex-split: 편집기 단일 PDF(coverFileId)를 앞/뒤 2페이지 세트별로 분리.
      if (!session.coverFileId) {
        this.logger.warn(
          `[pdfOutputMode] session ${session.id}: duplex-split 이나 coverFileId 부재 → 분리 잡 스킵`,
        );
        return;
      }

      const job = await this.workerJobsService.createDuplexSplitJob({
        sessionId: session.id,
        pdfFileId: session.coverFileId,
        // 멱등성 키: 세션+파일에 고정(완료당 1회). 재완료 시 동일 키 → 멱등 히트.
        // 2026-10-18(P2-b 런처 e2e 실측): 종전 키 `duplex-split-<세션uuid>-<파일uuid>`(86자)는 `worker_jobs.request_id VARCHAR(36)`
        // 에 들어가지 못해 strict 모드에서 "Data too long" 으로 잡 생성이 조용히 실패했다(분리 잡이 만들어진 적 없음).
        // 멱등 유일성은 UNIQUE (session_id, pdf_file_id, request_id). 보안 리뷰(2026-10-18 #6): 고정 태그는 FAILED 잡에도
        // 멱등 히트해 재완료로 복구가 불가하므로, complete() 가 올린 회차로 `duplex-split-r<revision>` 을 쓴다(재완료 = 새 회차 잡).
        // 런처 재합성(requestDuplexSplitResynthesis)도 같은 형식·같은 카운터라 회차 간 충돌이 없다.
        requestId: duplexSplitRevisionRequestId(sessionRevisionOf(session.metadata)),
        callbackUrl: session.callbackUrl ?? undefined,
        // 잡 소유 사이트 = 세션 사이트(검증 잡과 같은 규칙, 2026-10-18). 파트너 v1 deliverables 가
        // `job.site_id <=> sess.site_id` 로 이 잡을 찾고 서명 URL 테넌트 판정도 같은 값을 쓴다.
        siteId: session.siteId ?? null,
      });
      this.logger.log(
        `[pdfOutputMode] Created duplex-split job ${job.id} for session ${session.id} (cover=${session.coverFileId})`,
      );
    } catch (error) {
      // 완료 무중단 정책 — 잡 발행 실패가 세션 완료를 막지 않도록.
      this.logger.error(
        `[pdfOutputMode] session ${session.id} 적용 실패(완료는 유지): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 세션의 파트너 가시 최신 SYNTHESIZE 잡 1건(created_at DESC) — P2-b 파트너 v1 deliverables 용(2026-10-18).
   * findByOrderExternal 의 윈도우함수 배치 쿼리와 같은 조건(잡 사이트 = 세션 사이트(NULL 끼리 포함),
   * partnerVisibleSynthJobSql)을 단일 세션으로 좁힌 것. SESSION_JOB_OUTPUT_LOOKUP 게이트는 적용하지 않는다
   * (그 플래그는 기존 external 조회·책 승격의 파일 치환 여부만 다룬다). 조회 전용 — 상태 변경 없음.
   */
  async findLatestPartnerVisibleSynthJob(sessionId: string): Promise<PartnerVisibleSynthJobRow | null> {
    const rows: Array<{
      id: string;
      status: string;
      result: unknown;
      options?: unknown;
      outputFileUrl: string | null;
      createdAt: Date | string;
      completedAt: Date | string | null;
    }> = await this.sessionRepository.manager.query(
      `SELECT job.id AS id, job.status AS status, job.result AS result, job.options AS options,
              job.output_file_url AS outputFileUrl, job.created_at AS createdAt, job.completed_at AS completedAt
         FROM worker_jobs job
         JOIN file_edit_sessions sess ON sess.id = job.edit_session_id
        WHERE job.edit_session_id = ? AND job.job_type = 'SYNTHESIZE'
          AND job.site_id <=> sess.site_id
          AND ${partnerVisibleSynthJobSql('job')}
        ORDER BY job.created_at DESC
        LIMIT 1`,
      [sessionId],
    );
    const row = rows[0];
    if (!row) return null;
    const parseJson = (raw: unknown): unknown => {
      if (typeof raw !== 'string') return raw;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const result = parseJson(row.result);
    const options = parseJson(row.options);
    return {
      id: row.id,
      status: row.status,
      result: (result ?? null) as PartnerVisibleSynthJobRow['result'],
      options: (options !== null && typeof options === 'object' ? options : null) as PartnerVisibleSynthJobRow['options'],
      outputFileUrl: row.outputFileUrl ?? null,
      createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
      completedAt:
        row.completedAt === null || row.completedAt === undefined
          ? null
          : row.completedAt instanceof Date
            ? row.completedAt
            : new Date(row.completedAt),
    };
  }

  /**
   * P2-b 파트너 v1 `POST /api/v1/sessions/:id/synthesize` — duplex-split 재합성(2026-10-18).
   *
   * 완료 상태·템플릿셋 pdfOutputMode·coverFileId 게이트(v1 에러 코드)는 호출측(PartnerSessionsService)이
   * 끝낸 뒤 부른다. 여기서는 세션을 다시 읽어 사이트·launch.env 스코프를 방어적으로 재확인하고
   * (불일치 = 404 SESSION_NOT_FOUND, 존재 은닉), `metadata.revision` 을 1 올려 저장한 뒤 그 회차로
   * duplex-split 잡을 만든다. requestId `duplex-split-r{revision}` 은 (session_id, pdf_file_id, request_id)
   * 멱등 인덱스 안에서 회차마다 새 잡이 되고 36자(worker_jobs.request_id VARCHAR(36)) 안이다.
   * 잡 생성이 실패하면 revision 은 이미 올라가 있다(다음 호출은 그 다음 회차) — 잡 없는 회차는 허용.
   */
  async requestDuplexSplitResynthesis(
    sessionId: string,
    caller: { siteId: string; env: string },
  ): Promise<{ jobId: string; revision: number }> {
    const { session, revision } = await this.prepareResynthesis(sessionId, caller);

    const job = await this.workerJobsService.createDuplexSplitJob({
      sessionId: session.id,
      pdfFileId: session.coverFileId,
      requestId: duplexSplitRevisionRequestId(revision),
      callbackUrl: session.callbackUrl ?? undefined,
      siteId: session.siteId,
      revision,
    });
    this.logger.log(
      `[partner-v1] duplex-split resynthesis job ${job.id} for session ${session.id} (revision=${revision})`,
    );
    return { jobId: job.id, revision };
  }

  /**
   * P2-c 파트너 v1 synthesize — 프로파일 `output.mode='sheet-map'` 세션의 시트 매핑 재합성(2026-10-18).
   *
   * 스코프·완료 검사·회차 +1 은 duplex-split 재합성과 같은 prepareResynthesis 를 쓴다. 프로파일 원천은 편집 완료
   * 자동 잡(applyPdfOutputMode)과 같다(템플릿셋 우선, 없으면 세션 스냅샷; 템플릿셋 조회 실패 = 스냅샷만).
   * 프로파일이 없거나 sheet-map 이 아니면 400 OUTPUT_MODE_UNSUPPORTED(호출측 게이트가 먼저 걸러 보통 도달하지 않음).
   * buildSheetMap 의 SheetMapError 는 그대로 올린다 — 호출측(PartnerSessionsService)이 v1 코드로 바꾼다.
   * 잡 requestId `sheet-map-r{revision}` 은 duplex-split 과 같은 카운터·다른 접두사라 회차 간·모드 간 충돌이 없다.
   */
  async requestSheetMapResynthesis(
    sessionId: string,
    caller: { siteId: string; env: string },
  ): Promise<{ jobId: string; revision: number }> {
    const { session, revision } = await this.prepareResynthesis(sessionId, caller);

    let templateSet: Awaited<ReturnType<TemplateSetsService['findOne']>> | null = null;
    if (session.templateSetId) {
      try {
        templateSet = await this.templateSetsService.findOne(session.templateSetId);
      } catch (e) {
        this.logger.warn(
          `[partner-v1] session ${session.id}: TemplateSet ${session.templateSetId} 조회 실패 → 세션 스냅샷 프로파일만 사용: ${(e as Error).message}`,
        );
      }
    }
    const profile = resolveSessionProductProfile({
      session,
      templateSet,
      warn: (m) => this.logger.warn(`[partner-v1] session ${session.id}: ${m}`),
    });
    if (profile?.output.mode !== 'sheet-map') {
      throw new BadRequestException({
        code: 'OUTPUT_MODE_UNSUPPORTED',
        message: "상품 프로파일 output.mode 가 'sheet-map' 인 세션만 시트 매핑 재합성을 요청할 수 있습니다.",
        details: { sessionId, outputMode: profile?.output.mode ?? null },
      });
    }

    const pageCount = resolveSessionPageCount(session);
    try {
      // P2-d: 사진인화 세트는 metadata.items 의 매수를 시트 copies/label 로 주입(그 외 세트는 무변경). items 상한은 security-1.
      const sheets = applyPhotoItemsToSheets(
        buildSheetMap(profile, pageCount),
        readSessionPhotoItems(profile, session.metadata, pageCount),
      );
      const job = await this.workerJobsService.createSheetMapJob({
        sessionId: session.id,
        pdfFileId: session.coverFileId,
        sheets,
        output: profile.output.sheetFiles ?? 'per-sheet',
        duplexFlip: profile.sheet.duplexFlip,
        requestId: sheetMapRevisionRequestId(revision),
        callbackUrl: session.callbackUrl ?? undefined,
        siteId: session.siteId,
        revision,
      });
      this.logger.log(
        `[partner-v1] sheet-map resynthesis job ${job.id} for session ${session.id} (revision=${revision}, sheets=${sheets.length})`,
      );
      await this.clearSheetMapFailure(session, 'partner-v1');
      return { jobId: job.id, revision };
    } catch (e) {
      // api-sheetmap-3: 재합성 실패도 같은 키에 기록한 뒤 그대로 올린다(호출측이 v1 코드로 변환).
      await this.recordSheetMapFailure(session, e, 'partner-v1');
      throw e;
    }
  }

  /**
   * 재합성 공통 전처리(P2-c 에서 추출, 동작 불변): 세션 재조회 → 사이트·launch.env 스코프(불일치 = 404 SESSION_NOT_FOUND,
   * 존재 은닉) → 완료·coverFileId 게이트(400 SESSION_NOT_COMPLETE) → `metadata.revision` +1 저장.
   * 반환 세션의 coverFileId 는 게이트를 지나 non-null 이다. 잡 생성이 실패해도 revision 은 올라가 있다(잡 없는 회차 허용).
   */
  private async prepareResynthesis(
    sessionId: string,
    caller: { siteId: string; env: string },
  ): Promise<{ session: EditSessionEntity & { coverFileId: string; siteId: string }; revision: number }> {
    const session = await this.findById(sessionId);
    const launchEnv = (session.metadata as { launch?: { env?: unknown } } | null)?.launch?.env;
    if (!session.siteId || session.siteId !== caller.siteId || launchEnv !== caller.env) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId },
      });
    }
    if (session.status !== SessionStatus.COMPLETE || !session.coverFileId) {
      throw new BadRequestException({
        code: 'SESSION_NOT_COMPLETE',
        message: '편집이 완료된 세션에만 재합성을 요청할 수 있습니다.',
        details: { sessionId, status: session.status },
      });
    }

    const revision = nextSessionRevision(session.metadata);
    session.metadata = { ...(session.metadata ?? {}), revision };
    await this.sessionRepository.save(session);
    return { session: session as EditSessionEntity & { coverFileId: string; siteId: string }, revision };
  }

  /**
   * 스프레드 책 스냅샷 무결성 검증.
   *
   * 검증 항목(하드 승격 시 차단 사유):
   *  - metadata.spine: spineWidthMm 유한수 ≥ 0(S7: 0 = 책등 없는 책, 유효) +
   *    pageCount/paperType/bindingType/formulaVersion 4필드 truthy
   *    (S7 예외: spineWidthMm===0 이고 bindingType 이 perfect/hardcover 가 아니면 paperType 생략 허용)
   *  - metadata.spread: spec/totalWidthMm/totalHeightMm/dpi 4필드 truthy
   *
   * 모드:
   *  - SOFT(기본): 누락/불일치를 mismatches 에 누적하고 logger.warn 만(throw 금지) → 완료 무중단.
   *  - HARD: env SPREAD_SNAPSHOT_HARD_FAIL='true' 일 때, mismatches 가 있으면 BadRequestException 으로 차단.
   * 검증 로직은 하나로 유지하고 throw 여부만 토글 → P0-3 이후 ENV 만 켜서 hard 승격(인쇄사고 방지).
   *
   * @returns SpreadValidationResult — 호출측이 session.metadata.spreadValidation 에 기록.
   */
  private validateSpreadSnapshot(session: EditSessionEntity): SpreadValidationResult {
    const mismatches: string[] = [];

    const spine = session.metadata?.spine;
    // S7: paperType 은 spineWidthMm===0 이고 bindingType 이 공식제본(perfect/hardcover, 대소문자 무시)이
    // 아닐 때만(스프링·중철 등) 생략 가능. 동일 predicate: editor buildSpreadSnapshots,
    // packages/types SpineSnapshot.paperType 주석, worker PdfSynthesizerService.validateSpreadSnapshot.
    const paperTypeOptional =
      !!spine &&
      spine.spineWidthMm === 0 &&
      !!spine.bindingType &&
      !['perfect', 'hardcover'].includes(String(spine.bindingType).toLowerCase());
    if (!spine) {
      mismatches.push('SPINE_MISSING: metadata.spine 누락');
    } else if (
      // S7: 0mm(스프링 표지펼침면 등 책등 없는 책)는 유효 — truthy 검사로 0 을 거르지 않는다.
      typeof spine.spineWidthMm !== 'number' ||
      !Number.isFinite(spine.spineWidthMm) ||
      spine.spineWidthMm < 0 ||
      !spine.pageCount ||
      (!spine.paperType && !paperTypeOptional) ||
      !spine.bindingType ||
      !spine.formulaVersion
    ) {
      mismatches.push(
        'SPINE_INVALID: spine 필수필드 누락(spineWidthMm/pageCount/paperType/bindingType/formulaVersion)',
      );
    }

    const spread = session.metadata?.spread;
    if (!spread) {
      mismatches.push('SPREAD_MISSING: metadata.spread 누락');
    } else if (!spread.spec || !spread.totalWidthMm || !spread.totalHeightMm || !spread.dpi) {
      mismatches.push('SPREAD_INVALID: spread 필수필드 누락(spec/totalWidthMm/totalHeightMm/dpi)');
    }

    const hardFail = isSpreadSnapshotHardFail();
    const result: SpreadValidationResult = {
      ok: mismatches.length === 0,
      checkedAt: new Date().toISOString(),
      gate: session.mode === SessionMode.SPREAD ? 'session-mode' : 'metadata-spread',
      mismatches,
      mode: hardFail ? 'hard' : 'soft',
    };

    if (mismatches.length > 0) {
      this.logger.warn(
        `[spread-snapshot] session ${session.id} 검증 ${hardFail ? 'HARD' : 'SOFT'} 불일치: ${mismatches.join(' | ')}`,
      );
      if (hardFail) {
        throw new BadRequestException({
          code: 'SPREAD_SNAPSHOT_INVALID',
          message: '스프레드 스냅샷 무결성 검증 실패',
          mismatches,
        });
      }
    } else {
      this.logger.log(`[spread-snapshot] session ${session.id} 검증 통과 (${result.gate})`);
    }

    return result;
  }

  /**
   * 완료된 세션의 파일에 대한 Worker 검증 작업 생성
   */
  private async createValidationJobs(session: EditSessionEntity): Promise<void> {
    try {
      // templateSet 은 ①size 폴백(C+ G2)과 ②cropMark 주입(2026-06-10) 둘 다에 쓰인다.
      // 조회 실패해도 세션 완료는 계속(기존 try/catch 패턴 유지).
      let templateSet: Awaited<ReturnType<TemplateSetsService['findOne']>> | null = null;
      if (session.templateSetId) {
        try {
          templateSet = await this.templateSetsService.findOne(session.templateSetId);
        } catch (error) {
          this.logger.warn(
            `[validation-jobs] templateSet ${session.templateSetId} 조회 실패(size 폴백/블리드·허용오차 주입 생략, 완료는 계속): ${error.message}`,
          );
        }
      }

      // 2026-10-17(낱장 분류 검증): 낱장 판정(spine/wing/spread 템플릿 유무)용 템플릿 타입 1회 조회.
      // 킬스위치 off·템플릿셋 미연결·조회 실패는 null → 레거시(sheet 키 미주입). 완료는 계속.
      const sheetRulesOn = isEditorSheetValidationRulesOn();
      let templateTypes: string[] | null = null;
      if (sheetRulesOn && session.templateSetId) {
        try {
          const { templateDetails } = await this.templateSetsService.findOneWithTemplates(
            session.templateSetId,
          );
          templateTypes = templateDetails.map((t) => String(t.type));
        } catch (error) {
          this.logger.warn(
            `[validation-jobs] templateSet ${session.templateSetId} 템플릿 타입 조회 실패(낱장 분류 생략, 완료는 계속): ${(error as Error).message}`,
          );
        }
      }

      // 내지 펼침면 세트 여부/크기 해석 (내지 spread 가 없는 세트는 kind 'none' → 기존 폴백).
      // 결과는 아래 R-195 블록 뒤에서 content 잡 옵션에만 적용한다.
      const innerLayout = await this.resolveInnerSpreadContentSizeMm(session);

      // Get order options from metadata or use defaults
      // expectedOrientation(워커 R3 방향검증)은 워커 측 DTO(validation-result.dto.ts /
      // validation.processor.ts)에만 정의된 필드 — API CreateValidationJobDto 미정의라
      // 로컬 확장 타입으로 주입한다. 이 경로는 서비스 내부 직호출이며 orderOptions 는
      // DB job.options·Bull 페이로드에 스프레드 복사로 필드 보존 전달됨(worker-jobs.service.ts).
      const orderOptions: CreateValidationJobDto['orderOptions'] & {
        expectedOrientation?: 'portrait' | 'landscape';
      } = {
        // C+ G2(2026-07-11): metadata.size 부재 시 A4 하드코드 대신 templateSet 판형으로 폴백.
        // A4 고정 디폴트는 비-A4 상품 세션의 생성 PDF 를 SIZE_MISMATCH 로 오검증했고
        // (FIXABLE→VALIDATED 매핑이 마스킹), 게이팅 ON 시 session.failed 로 flip 하는 원인.
        // templateSet 까지 없을 때만 최후 A4 폴백(레거시 동일).
        // 내지 펼침면 크기는 여기(표지·내지 공유)가 아니라 아래에서 content 잡에만 적용한다.
        size:
          session.metadata?.size ||
          (templateSet
            ? { width: templateSet.width, height: templateSet.height }
            : { width: 210, height: 297 }),
        // 2026-10-16(낱장 N장): 편집기 다캔버스 낱장 세션(canvasData 배열)만 실제 캔버스 수를
        // 기대 쪽수로 쓴다 — 편집기가 캔버스당 1페이지 PDF 를 내므로 PAGE_COUNT_MISMATCH 기대치와 정합.
        // 제외: 편집기 책 세션(metadata.spread — 배열은 [표지,...내지]라 내지 PDF 쪽수가 아님)과
        // 내지 펼침면 세트(PDF 1쪽=펼침면). 그 외(단일 객체·미저장)는 종전 식 그대로.
        pages:
          Array.isArray(session.canvasData) &&
          !session.metadata?.spread &&
          innerLayout.kind !== 'inner-spread'
            ? resolveSessionPageCount(session)
            : session.metadata?.pages || 1,
        binding: session.metadata?.binding || 'perfect',
        // ?? (|| 아님): 도련無(bleed=0) 상품의 명시적 0 을 보존한다.
        // || 사용 시 0 이 3 으로 덮여 작업사이즈가 trim+6mm 로 오산정→정상 PDF 가 SIZE_MISMATCH 로 오검증(R2).
        // D9(2026-10-19): metadata.bleed 미기재 시 기본 3 은 종전대로이되, 상품 프로파일 세트(사진인화 chemical 등)에서
        // 템플릿셋이 재단선 없음(cropMarkEnabled≠true) 또는 bleedMm 0 이면 0 — 도련 없는 세트의 완료 PDF 가 BLEED_MISSING
        // (expected 3, actual 0) 경고를 받지 않도록. 프로파일 NULL 세트는 종전(3) 그대로.
        bleed: session.metadata?.bleed ?? resolveDefaultBleedMm(session, templateSet),
        paperThickness: session.metadata?.paperThickness,
      };

      // ── 내지 판형 방향 정합 (2026-07-14, 오너 규격표 스펙) ──
      // templateSet.width/height = 오리엔트된 판형 권위(가로 A4 세트=297×210).
      // metadata.size 는 bookmoa /embed 원본으로 미오리엔트 전달 실측 이력(R-13)이 있어,
      // 가로 상품에서 정상 가로 PDF 가 SIZE_MISMATCH 로 오검증됐다(G-A).
      // 워커 validatePageSize 는 축별 엄격 비교를 유지한다(스왑 허용 금지 —
      // 방향 오업로드 마스킹 + fix-bleed innerfit 축소 사고 방지). 방향 정합은
      // 기준값 유도측(여기)에서만 확정: templateSet 판형과 "정확히 W↔H 스왑 관계"인
      // 전달값만 templateSet 방향으로 정규화. 정사각·스왑 아닌 불일치·templateSet 부재는
      // 원본 보존(파트너 명시값 계약 불변).
      const AXIS_EPS = 0.01; // mm — 정확 스왑/비정사각 판정 오차
      if (templateSet) {
        const tsWidth = templateSet.width;
        const tsHeight = templateSet.height;
        const tsNonSquare = Math.abs(tsWidth - tsHeight) > AXIS_EPS;
        const { width: sizeWidth, height: sizeHeight } = orderOptions.size;
        const sizeNonSquare = Math.abs(sizeWidth - sizeHeight) > AXIS_EPS;

        if (
          tsNonSquare &&
          sizeNonSquare &&
          Math.abs(sizeWidth - tsHeight) < AXIS_EPS &&
          Math.abs(sizeHeight - tsWidth) < AXIS_EPS
        ) {
          orderOptions.size = { width: tsWidth, height: tsHeight };
          // warn 레벨 유지 — bookmoa 전달값 교정 계측용(정규화 빈도·원본값 추적)
          this.logger.warn(
            `[validation-jobs] session ${session.id} orderOptions.size 방향 정규화: ` +
              `${sizeWidth}×${sizeHeight} → ${tsWidth}×${tsHeight}mm ` +
              `(templateSet ${session.templateSetId} 판형과 정확 W↔H 스왑 관계)`,
          );
        }

        // 방향 의도 주입 — 비정사각 templateSet 세션 전체(cropMarkEnabled 게이트 밖).
        // 워커 validatePageOrientation: 명시 시 어긋난 페이지를 ORIENTATION_MISMATCH
        // 경고 1건(비차단)으로 집계 → 방향 오업로드가 SIZE_MISMATCH 만으로 침묵하는 대신
        // 방향 안내로 표현된다. 정사각은 방향 개념 없음 → 미주입(워커 auto 동작 유지).
        if (tsNonSquare) {
          orderOptions.expectedOrientation =
            tsWidth > tsHeight ? 'landscape' : 'portrait';
        }
      }

      // ── 블리드 / 재단선 / 사이즈 허용오차 + 재단/작업 사이즈 주입 (2026-06-10) ──
      // ⚠️ 마스터 게이트(cropMarkEnabled===true) 통과 세션만 주입.
      //   P4 워커 validatePageSize 가 이 필드를 실제 사용(tolerance '?? 1' / workSize 케이스)하므로
      //   게이트 없이 주입하면 모든 templateSet 세션의 검증 허용오차가 1mm→0.2mm 로 좁아지는
      //   회귀가 발생(실제 발생 → 본 게이트로 수정). off 세션 = 필드 미주입 = 워커 현행(1mm).
      if (templateSet?.cropMarkEnabled === true) {
        const bleedMm = templateSet.bleedMm ?? 3;
        const trimWidth = templateSet.width;
        const trimHeight = templateSet.height;
        orderOptions.bleedMm = bleedMm;
        orderOptions.cropMarkEnabled = true;
        orderOptions.sizeToleranceMm = templateSet.sizeToleranceMm ?? 0.2;
        // 재단(trim) = 템플릿셋 판형. 작업(work) = 재단 + 사방 블리드*2.
        // 워커 수신 필드명(trimSize/workSize)에 맞춤.
        orderOptions.trimSize = { width: trimWidth, height: trimHeight };
        orderOptions.workSize = {
          width: trimWidth + bleedMm * 2,
          height: trimHeight + bleedMm * 2,
        };
      }

      // ── R-195(2026-09-28): 편집기 스프레드 책 — 주문 제본·실제 내지 쪽수·표지 책등 기하 연결 ──
      // 근거·안전 원칙은 editor-spread-validation-options.ts 머리말. 스프레드 스냅샷이 없는 세션은
      // null → 아래 두 잡 모두 현행 orderOptions 그대로. 비상 차단: EDITOR_SPREAD_VALIDATION_MAPPING=off.
      let coverOrderOptions = orderOptions;
      let contentOrderOptions = orderOptions;
      if (isEditorSpreadValidationMappingOn()) {
        // 템플릿셋 판형은 싸바리 전개 표지(coverOutput.layout='hardcover-wrap') 판정에만 쓰인다.
        // 위에서 이미 조회한 templateSet 재사용(추가 조회 없음). 조회 실패·미연결이면 null →
        // 싸바리 전개 표지는 연결 생략, 그 밖의 세션 결과는 판형 인자와 무관.
        const templateTrimMm = templateSet
          ? { widthMm: templateSet.width, heightMm: templateSet.height }
          : null;
        const overrides = deriveEditorSpreadValidationOverrides(session.metadata, templateTrimMm);
        if (overrides) {
          contentOrderOptions = { ...orderOptions, ...overrides.content };
          if (overrides.cover) {
            coverOrderOptions = { ...orderOptions, ...overrides.content, ...overrides.cover };
            this.logger.log(
              `[validation-jobs] session ${session.id} 표지 책등 기하 연결: ` +
                `binding=${coverOrderOptions.binding} spine=${overrides.cover.spineWidthMm}mm ` +
                `bleed=${overrides.cover.bleed}mm source=${overrides.cover.paperType ? 'formula' : 'fixed'}`,
            );
          } else {
            // 표지는 현행 옵션 그대로(크기 검사 생략) — 내지 보정(제본)을 얹으면 안 된다:
            // spiral/saddle 펼침 표지가 책등 기대치 없이 단일 판형 검사로 떨어져 오차단된다.
            // 기하 불일치는 편집기 출력 이상 신호라 warn.
            const note = `[validation-jobs] session ${session.id} 표지 책등 연결 생략(${overrides.coverSkipReason})`;
            if (overrides.coverSkipReason === 'GEOMETRY_INCONSISTENT') {
              this.logger.warn(
                overrides.coverGeometry ? `${note} ${JSON.stringify(overrides.coverGeometry)}` : note,
              );
            } else {
              this.logger.log(note);
            }
          }
        }
      }

      // ── 내지 펼침면 세트(W8 N-API-3): content 기대 크기·방향 = 펼침면 — **content 잡에만** 적용 ──
      // content.pdf 1페이지가 '펼침면'이라 세트 판형(한 면)이 아니라 펼침면 크기가 기대값이다.
      // 해석되면 metadata.size 보다도 우선(서버 권위). 방향도 실제 content 페이지(펼침면) 기준 —
      // 세로 판형(210×297)의 펼침면은 420×297 = 가로라 판형 기준 'portrait' 를 두면 정상 PDF 가
      // ORIENTATION_MISMATCH 경고로 집계된다. 표지 잡(coverOrderOptions)은 건드리지 않는다 —
      // [표지 spread → 내지 spread] 결합 세트의 표지 기대 크기·방향은 판형 기준 그대로.
      // R-195 플래그(EDITOR_SPREAD_VALIDATION_MAPPING)와 무관하게 적용(overrides.content 에 size 키 없음).
      if (innerLayout.kind === 'inner-spread') {
        const { width: iw, height: ih } = innerLayout.size;
        contentOrderOptions = {
          ...contentOrderOptions,
          size: { width: iw, height: ih },
          expectedOrientation: iw > ih ? 'landscape' : 'portrait',
        };
      }

      // ── N-API-3b(2026-10-06): 편집기 실효 쪽 단위 → content PDF 쪽 단위 pageMultiple(중철은 pageCountMax) ──
      // 근거는 editor-spread-validation-options.ts deriveEditorContentPageRules. content 잡에만 적용하고
      // binding·pages·size 는 바꾸지 않는다. 비상 차단: EDITOR_CONTENT_PAGE_RULES=off (R-195 플래그와 독립).
      if (isEditorContentPageRulesOn()) {
        try {
          const rules = deriveEditorContentPageRules({
            metadata: session.metadata,
            contentFileId: session.contentFileId,
            templatePageStep: templateSet?.pageStep,
            layout: innerLayout.kind,
            legacyBinding: contentOrderOptions.binding,
          });
          if (rules) {
            contentOrderOptions = {
              ...contentOrderOptions,
              pageMultiple: rules.pageMultiple,
              ...(rules.pageCountMax ? { pageCountMax: rules.pageCountMax } : {}),
            };
            this.logger.log(
              `[validation-jobs] session ${session.id} 내지 쪽 규칙: S=${rules.physicalStep ?? '-'} ` +
                `k=${rules.pagesPerPdfPage} pageMultiple=${rules.pageMultiple} ` +
                `max=${rules.pageCountMax ?? '-'} source=${rules.source}`,
            );
          }
        } catch (e) {
          this.logger.warn(
            `[validation-jobs] session ${session.id} 내지 쪽 규칙 생략(기존 옵션 유지): ${(e as Error).message}`,
          );
        }
      }

      // ── 2026-10-17(낱장 분류 검증): 낱장(single 세트, spine/wing/spread 없음) → 두 잡 모두 productKind='sheet' ──
      // 판정 근거는 sheet-validation-rules.ts 머리말. 워커는 sheet 분기에서 actualPages === pages 정확 비교
      // 뒤 바로 return 하므로, 위 N-API-3b 가 content 잡에 pageMultiple 을 실어도 공존해 무해하다(무접촉).
      // null = 레거시(키 미주입 = 현행 byte-identical). 비상 차단: EDITOR_SHEET_VALIDATION_RULES=off.
      // 2026-10-17 P1-e: 상품 프로파일(세션 스냅샷 > templateSet.productProfile)이 고정 캔버스 수를 주면
      // 두 잡의 `pages` 를 그 값으로 바꾼다(캘린더 26). expectedPages 는 orderOptions 키로 보내지 않는다.
      // 프로파일 세트는 coverSpine='none' 도 함께 실린다(sheetOptions 스프레드) — 워커 cover 슬롯 spine 게이트 우회.
      if (sheetRulesOn) {
        const sheetRules = deriveSheetValidationRules({
          session,
          templateSet,
          templateTypes,
          innerLayoutKind: innerLayout.kind,
          warn: (message) => this.logger.warn(`[validation-jobs] session ${session.id} ${message}`),
        });
        if (sheetRules) {
          const { expectedPages, ...sheetOptions } = sheetRules;
          const pagesOverride = expectedPages !== undefined ? { pages: expectedPages } : {};
          coverOrderOptions = { ...coverOrderOptions, ...sheetOptions, ...pagesOverride };
          contentOrderOptions = { ...contentOrderOptions, ...sheetOptions, ...pagesOverride };
          this.logger.log(
            `[validation-jobs] session ${session.id} 낱장 분류 규칙: productKind=sheet ` +
              `pageStep=${sheetRules.pageStep ?? '-'} pages=${coverOrderOptions.pages}` +
              (expectedPages !== undefined ? ' (pages 출처: productProfile pages.count)' : ''),
          );
        }
      }

      // 잡 테넌트 스탬프 = 세션 site(NULL 세션은 종전대로 NULL). site default 머지는
      // 건너뛴다 — orderOptions 는 스탬프 도입 전과 동일해야 검증 결과가 바뀌지 않는다.
      const validationJobSiteId = session.siteId ?? undefined;
      const validationJobInternal = { skipSiteWorkerDefaults: true };

      // Create validation job for cover file
      if (session.coverFileId) {
        try {
          const job = await this.workerJobsService.createValidationJob(
            {
              editSessionId: session.id,
              fileId: session.coverFileId,
              fileType: 'cover',
              orderOptions: coverOrderOptions,
              siteId: validationJobSiteId,
            },
            validationJobInternal,
          );
          this.logger.log(
            `Created validation job ${job.id} for cover file ${session.coverFileId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to create validation job for cover file: ${error.message}`,
          );
        }
      }

      // Create validation job for content file
      if (session.contentFileId) {
        try {
          const job = await this.workerJobsService.createValidationJob(
            {
              editSessionId: session.id,
              fileId: session.contentFileId,
              fileType: 'content',
              orderOptions: contentOrderOptions,
              siteId: validationJobSiteId,
            },
            validationJobInternal,
          );
          this.logger.log(
            `Created validation job ${job.id} for content file ${session.contentFileId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to create validation job for content file: ${error.message}`,
          );
        }
      }
    } catch (error) {
      // Don't fail session completion if worker job creation fails
      this.logger.error(
        `Failed to create validation jobs for session ${session.id}: ${error.message}`,
      );
    }
  }

  /**
   * 세션 삭제 (소프트 삭제)
   */
  async delete(id: string, userId: number, caller?: TenantCaller | null): Promise<void> {
    const session = await this.findById(id);
    this.assertTenantScope(session, caller);

    // 운영자 대리 편집(2026-09-29): 삭제는 발급 시 allowDelete 로 받은 'delete' 권한이 있을 때만.
    // 범위 판정(404)이 권한 판정(403)보다 먼저다.
    const op = caller?.partnerOperator ?? null;
    if (op) {
      if (!op.capabilities.includes('delete')) {
        throw new ForbiddenException({
          code: 'PARTNER_OPERATOR_CAPABILITY_REQUIRED',
          message: '이 운영자 권한에는 삭제가 포함되어 있지 않습니다.',
        });
      }
      await this.recordOperatorAction(op, session.id, 'session.delete', {
        statusFrom: session.status ?? null,
        orderSeqno: Number(session.orderSeqno ?? 0),
      });
    } else if (caller?.staff) {
      // 관리자 편집데이터 관리(2026-09-29): 범위 안 + 삭제 권한(전역 또는 사이트 행 SITE_ADMIN)만.
      // 감사 기록은 호출부(StaffEditDataService)가 삭제 전에 남긴다.
      if (!caller.staff.canDelete) throw staffDeleteNotAllowed();
    } else if (!(userId > 0) || Number(session.memberSeqno) !== userId) {
      // 운영 관측: 회원 경로의 게스트 세션 삭제 거부(세션 id·site 만 기록, 토큰 원문 없음).
      if (session.guestToken) {
        this.logger.log(
          `[guest-delete] denied-member-route session=${session.id} site=${session.siteId ?? '-'}`,
        );
      }
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 삭제할 권한이 없습니다.',
      });
    }

    await this.sessionRepository.softDelete(id);
    this.logger.log(`Deleted edit session ${id}`);
  }

  /**
   * 엔티티를 응답 DTO로 변환
   */
  toResponseDto(session: EditSessionEntity): EditSessionResponseDto {
    const response: EditSessionResponseDto = {
      id: session.id,
      orderSeqno: Number(session.orderSeqno),
      memberSeqno: Number(session.memberSeqno),
      status: session.status,
      mode: session.mode,
      coverFileId: session.coverFileId,
      contentFileId: session.contentFileId,
      templateSetId: session.templateSetId,
      canvasData: session.canvasData,
      metadata: session.metadata,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      siteId: session.siteId, // Phase C-3
      // ── 인쇄 워크플로우 v1 Phase 4 (2026-05-19) ──
      contentPdfFileId: session.contentPdfFileId,
      contentPdfPageCount: session.contentPdfPageCount,
      contentPdfValidationResult: session.contentPdfValidationResult,
      contentPdfMode: session.contentPdfMode, // P0-2
      guestToken: session.guestToken,
      guestExpiresAt: session.guestExpiresAt,
    };

    // 파일 정보 추가
    if (session.coverFile) {
      response.coverFile = this.toFileInfoDto(session.coverFile);
    }
    if (session.contentFile) {
      response.contentFile = this.toFileInfoDto(session.contentFile);
    }

    return response;
  }

  /**
   * summary 전용 매퍼 (2026-06-11) — toResponseDto 에서 canvasData 만 제외하고
   * templateSetName / thumbnailUrl(coverFile.thumbnailUrl 평탄화)을 추가한다.
   * GET /edit-sessions/my?summary=1 (편집보관함 경량 목록) 에서만 사용.
   */
  toSummaryResponseDto(
    session: EditSessionEntity,
    templateSetName: string | null,
  ): EditSessionResponseDto {
    const response = this.toResponseDto(session);
    delete response.canvasData; // 목록 경량화 — 전문은 GET /edit-sessions/:id 로 조회
    response.templateSetName = templateSetName;
    response.thumbnailUrl = session.coverFile?.thumbnailUrl ?? null;
    return response;
  }

  private toFileInfoDto(file: any): FileInfoDto {
    return {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      thumbnailUrl: file.thumbnailUrl,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
    };
  }
}
