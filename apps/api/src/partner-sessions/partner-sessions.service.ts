import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ErrV1, WorkerJobStatus, resolveProductProfile, summarizeProductProfile } from '@storige/types';
import type { PhotoItem, ProductProfile, SheetSpec } from '@storige/types';
import { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { AuthService } from '../auth/auth.service';
import { isRemoteUrlPublic } from '../common/helpers/ssrf.helper';
import { isPartnerSessionLaunchEnabled, isSheetMapOutputEnabled } from '../config/feature-flags';
import {
  EditSessionsService,
  PartnerVisibleSynthJobRow,
  type SheetMapFailureRecord,
  sessionRevisionOf,
  sheetMapFailureOf,
} from '../edit-sessions/edit-sessions.service';
import { EditSessionEntity, SessionMode, SessionStatus } from '../edit-sessions/entities/edit-session.entity';
import { readSessionPhotoItems } from '../edit-sessions/photo-items';
import { resolveSessionPageCount } from '../edit-sessions/session-page-count';
import { SheetMapError } from '../edit-sessions/sheet-map';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';
import { PartnerEnv } from '../partner-api/partner-api.constants';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { TemplateSetsService } from '../templates/template-sets.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import {
  PartnerSessionLaunchDto,
  PartnerSessionLaunchMode,
  PartnerSessionLaunchView,
} from './dto/partner-session-launch.dto';
import {
  PartnerSessionCalendarView,
  PartnerSessionDeliverableStatus,
  PartnerSessionDeliverablesView,
  PartnerSessionFileView,
  PartnerSessionProductView,
  PartnerSessionSynthesizeView,
} from './dto/partner-session-deliverables.dto';

/** 편집기 shop 세션 accessToken 만료(초) — auth.service createShopSession 의 expiresIn '1h' 와 같다. */
export const PARTNER_SESSION_ACCESS_TOKEN_TTL_SEC = 3600;

/** 세션 metadata.launch 스탬프 — 런처 세션 식별·env 스코프의 원천 */
export interface PartnerSessionLaunchStamp {
  via: 'partner-v1';
  env: PartnerEnv;
  requestId: string;
  launchedAt: string;
}

const LAUNCH_MODE_TO_SESSION_MODE: Record<PartnerSessionLaunchMode, SessionMode> = {
  both: SessionMode.BOTH,
  cover: SessionMode.COVER,
  content: SessionMode.CONTENT,
};

type SessionMetadata = Record<string, unknown> & {
  launch?: Partial<PartnerSessionLaunchStamp>;
  calendar?: { startYear?: unknown; startMonth?: unknown; dataVersion?: unknown };
  productProfile?: unknown;
  /** 사진인화 항목(편집기 기록 PhotoItem[] 또는 런처 PhotoItemInput[] — 자유형, 읽을 때 readPhotoItems 로 정제) */
  items?: unknown;
  production?: unknown;
};

/**
 * Partner API v1 — 1-call 런처(P2-b, 2026-10-18).
 * 정본: docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md §8.1
 *
 * 기존 파트너 v1 스택(@PartnerV1Controller) 위에서 편집 세션 생성 + 편집기 토큰 발급을 한 번에 하고,
 * 완료 뒤 산출물 조회·duplex-split 재합성을 제공한다. 기존 EditSessionsService.create /
 * AuthService.createShopSession / WorkerJobsService.createDuplexSplitJob 을 재사용한다(세션 엔티티·
 * 기존 라우트 무변경).
 *
 * 게이트(순서):
 *  ① 킬스위치 PARTNER_SESSION_LAUNCH_ENABLED(미설정 ON) off → 503 ERR_SERVICE_UNAVAILABLE
 *  ② 호출자 = 사이트 editor 키만(role 'editor') → 아니면 403 ERR_FORBIDDEN
 *  ③ 스코프: 세션 siteId = 호출 사이트(NULL 거부) AND metadata.launch.env = 호출 키 env → 아니면 404 ERR_NOT_FOUND
 *     (존재 은닉 — books.service 의 site+env 스코프와 같은 시맨틱. test 키로 만든 세션은 live 키에 보이지 않는다)
 */
@Injectable()
export class PartnerSessionsService {
  private readonly logger = new Logger(PartnerSessionsService.name);

  constructor(
    private readonly editSessionsService: EditSessionsService,
    private readonly templateSetsService: TemplateSetsService,
    private readonly authService: AuthService,
    private readonly workerJobsService: WorkerJobsService,
  ) {}

  // ── 게이트 ────────────────────────────────────────────────────────────

  private assertEnabled(): void {
    if (!isPartnerSessionLaunchEnabled()) {
      throw new PartnerApiException(
        ErrV1.ERR_SERVICE_UNAVAILABLE,
        503,
        '세션 런처 기능이 비활성 상태입니다 (PARTNER_SESSION_LAUNCH_ENABLED=off)',
      );
    }
  }

  /** 사이트 편집기 키만(partner-edit-sessions.controller assertOwnersSiteCaller 와 같은 조건) */
  private assertEditorCaller(site: CurrentSitePayload | undefined | null): asserts site is CurrentSitePayload {
    if (!site?.siteId || site.role !== 'editor') {
      throw new PartnerApiException(
        ErrV1.ERR_FORBIDDEN,
        403,
        '사이트 편집기 키로만 호출할 수 있습니다.',
      );
    }
  }

  private resolveEnv(site: CurrentSitePayload): PartnerEnv {
    return site.env === 'test' ? 'test' : 'live';
  }

  private notFound(sessionId: string): PartnerApiException {
    return new PartnerApiException(
      ErrV1.ERR_NOT_FOUND,
      404,
      `세션 '${sessionId}' 을(를) 찾을 수 없습니다`,
    );
  }

  /** 세션 단건 — 자기 site(NULL 거부) + launch.env 스코프. 없음/타 site/타 env = 404 ERR_NOT_FOUND */
  private async findSessionForSite(site: CurrentSitePayload, sessionId: string): Promise<EditSessionEntity> {
    let session: EditSessionEntity;
    try {
      session = await this.editSessionsService.findById(sessionId);
    } catch (e) {
      if (e instanceof NotFoundException) throw this.notFound(sessionId);
      throw e;
    }
    const launchEnv = this.metadataOf(session).launch?.env;
    if (!session.siteId || session.siteId !== site.siteId || launchEnv !== this.resolveEnv(site)) {
      throw this.notFound(sessionId);
    }
    return session;
  }

  private metadataOf(session: EditSessionEntity): SessionMetadata {
    return (session.metadata ?? {}) as SessionMetadata;
  }

  /**
   * 템플릿셋 — hybrid 스코프(시스템 공유 NULL 또는 자기 site) + 활성만. 그 밖·없음은 null.
   * (template-sets.service findOne 은 scope 없이 호출하고 여기서 판정 — applySiteScope includeNull 과 같은 규칙)
   */
  private async findTemplateSetForSite(site: CurrentSitePayload, templateSetId: string): Promise<TemplateSet | null> {
    let templateSet: TemplateSet;
    try {
      templateSet = await this.templateSetsService.findOne(templateSetId);
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw e;
    }
    if (templateSet.siteId !== null && templateSet.siteId !== site.siteId) return null;
    if (templateSet.isActive === false) return null;
    return templateSet;
  }

  // ── launch ───────────────────────────────────────────────────────────

  async launch(
    site: CurrentSitePayload | undefined,
    dto: PartnerSessionLaunchDto,
    requestId: string,
  ): Promise<PartnerSessionLaunchView> {
    this.assertEnabled();
    this.assertEditorCaller(site);
    const env = this.resolveEnv(site);

    const templateSet = await this.findTemplateSetForSite(site, dto.templateSetId);
    if (!templateSet) {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        `템플릿셋 '${dto.templateSetId}' 을(를) 찾을 수 없습니다`,
      );
    }

    assertLaunchPayloadWithinLimit(dto);

    if (dto.callbackUrl !== undefined && !(await isRemoteUrlPublic(dto.callbackUrl))) {
      throw new PartnerApiException(
        ErrV1.ERR_WEBHOOK_URL_FORBIDDEN,
        422,
        '허용되지 않는 callbackUrl 입니다 (https 공개 호스트만 — 사설/링크로컬/루프백 거부)',
        [],
        { callbackUrl: ['https 공개 호스트만 허용됩니다'] },
      );
    }

    const launch: PartnerSessionLaunchStamp = {
      via: 'partner-v1',
      env,
      requestId,
      launchedAt: new Date().toISOString(),
    };
    const metadata: Record<string, unknown> = { launch, revision: 0 };
    if (dto.orderOptions !== undefined) metadata.orderOptions = dto.orderOptions;
    if (dto.items !== undefined) metadata.items = dto.items;
    if (dto.calendar !== undefined) metadata.calendar = normalizeLaunchCalendar(dto.calendar);
    if (dto.externalPhotos !== undefined) metadata.externalPhotos = dto.externalPhotos;
    // 템플릿셋 프로파일 스냅샷 — 검증 권위는 템플릿셋. security-2(2026-10-19): productProfile 은 서버 소유 키라
    // EditSessionsService.create/update/complete 가 템플릿셋 현재값으로 다시 기록하고 클라이언트 PATCH 는 무시된다.
    if (templateSet.productProfile) metadata.productProfile = templateSet.productProfile;

    const session = await this.editSessionsService.create({
      mode: LAUNCH_MODE_TO_SESSION_MODE[dto.mode ?? 'both'],
      orderSeqno: dto.orderSeqno ?? 0,
      memberSeqno: dto.member.seqno, // ≥1 → 비게스트 세션
      templateSetId: templateSet.id,
      callbackUrl: dto.callbackUrl,
      metadata,
      siteId: site.siteId,
    });

    // 편집기 shop 세션 JWT — 쿠키는 설정하지 않는다(호스트가 embed 파라미터로 전달).
    const tokens = await this.authService.createShopSession(
      {
        memberSeqno: dto.member.seqno,
        memberId: dto.member.id,
        memberName: dto.member.name,
        orderSeqno: dto.orderSeqno,
      },
      { siteId: site.siteId, siteName: site.siteName },
    );

    this.logger.log(
      `[partner-v1] launched session ${session.id} site=${site.siteId} env=${env} templateSet=${templateSet.id} requestId=${requestId}`,
    );

    return {
      sessionId: session.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: PARTNER_SESSION_ACCESS_TOKEN_TTL_SEC,
      embed: {
        sessionId: session.id,
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        ...(dto.orderSeqno !== undefined ? { orderSeqno: dto.orderSeqno } : {}),
      },
    };
  }

  // ── deliverables ─────────────────────────────────────────────────────

  async getDeliverables(
    site: CurrentSitePayload | undefined,
    sessionId: string,
  ): Promise<PartnerSessionDeliverablesView> {
    this.assertEnabled();
    this.assertEditorCaller(site);
    const session = await this.findSessionForSite(site, sessionId);
    const metadata = this.metadataOf(session);

    const templateSet = session.templateSetId
      ? await this.findTemplateSetForSite(site, session.templateSetId)
      : null;
    const job = await this.editSessionsService.findLatestPartnerVisibleSynthJob(session.id);
    // contract-6(2026-10-19): product 요약과 items 판정은 같은 검증 프로파일(템플릿셋 → 세션 스냅샷, resolveProductProfile 통과)
    // 을 쓴다 — 무효 프로파일이면 둘 다 생략(product null·items 키 없음).
    const profile = this.resolveValidatedProfile(templateSet, metadata, 'deliverables');
    // api-sheetmap-3: 완료 시 sheet-map 발행 실패 기록(production.sheetMap)이 최신 합성 잡보다 새로우면 'failed'
    const sheetMapFailure = resolveSheetMapFailure(session.status, metadata, job);

    const sheets = sheetMapSheetsOf(job);
    const files: PartnerSessionFileView[] = this.buildEditorFiles(session);
    if (job && job.status === WorkerJobStatus.COMPLETED) {
      files.push(...(await this.buildJobFiles(site, job, sheets)));
    }

    const view: PartnerSessionDeliverablesView = {
      sessionId: session.id,
      status: sheetMapFailure ? 'failed' : resolveDeliverableStatus(session.status, job?.status ?? null),
      revision: sessionRevisionOf(session.metadata),
      orderSeqno: Number(session.orderSeqno) || 0,
      product: this.buildProductView(session, profile),
      calendar: buildCalendarView(metadata),
      files,
    };
    if (sheets) view.sheets = sheets;
    const items = this.buildItemsView(session, profile, metadata);
    if (items) view.items = items;
    if (metadata.production !== undefined) view.production = metadata.production;
    if (sheetMapFailure) {
      view.errorCode = sheetMapFailure.error;
      view.errorDetail = sheetMapFailure.message;
    }
    return view;
  }

  /** 편집기 산출 단일 PDF(coverFileId) + 썸네일 — 파트너 키로 회수하는 기존 files 라우트 */
  private buildEditorFiles(session: EditSessionEntity): PartnerSessionFileView[] {
    const files: PartnerSessionFileView[] = [];
    const coverFileId = session.coverFileId ?? session.coverFile?.id ?? null;
    if (!coverFileId) return files;

    const pageCount = resolveSessionPageCount(session);
    const generatedAt = toIso(session.coverFile?.createdAt ?? session.completedAt ?? null);
    files.push({
      role: 'single',
      fileId: coverFileId,
      url: `/api/files/${coverFileId}/download/external`,
      auth: 'api-key',
      ...(pageCount > 0 ? { pageCount } : {}),
      ...(generatedAt ? { generatedAt } : {}),
    });
    if (session.coverFile?.thumbnailUrl) {
      files.push({
        role: 'thumbnail',
        fileId: coverFileId,
        url: `/api/files/${coverFileId}/thumbnail`,
        auth: 'api-key',
      });
    }
    return files;
  }

  /**
   * 완료된 SYNTHESIZE 잡 산출물 — issueOutputUrls(서명 URL, TTL OUTPUT_URL_TTL_SEC 기본 300s)로 회수.
   * outputFiles[].type 'set' → role 'sheet'(sheetIndex=setIndex), 'pages' → role 'single'. 서명 대상 밖
   * (/storage/outputs/ 아님) 산출물은 싣지 않는다. 산출물 없는 완료 잡(JOB_OUTPUT_NOT_READY/NOT_SIGNABLE)은 빈 목록.
   * 서명 시크릿 미설정(503 SIGNED_URL_NOT_CONFIGURED)은 그대로 올린다(fail-closed → ERR_SERVICE_UNAVAILABLE).
   * P2-c: sheet-map 잡(`sheets` 전달)은 role 'sheet' 항목에 `sheets[setIndex]` 의 copies/label 을 더한다(additive).
   */
  private async buildJobFiles(
    site: CurrentSitePayload,
    job: PartnerVisibleSynthJobRow,
    sheets: SheetSpec[] | null = null,
  ): Promise<PartnerSessionFileView[]> {
    let signed: Array<{ name: string; url: string; expires: number }>;
    try {
      signed = (await this.workerJobsService.issueOutputUrls(job.id, { siteId: site.siteId, role: site.role })).files;
    } catch (e) {
      if (e instanceof BadRequestException) return [];
      throw e;
    }
    const signedByName = new Map(signed.map((s) => [s.name, s] as const));
    const generatedAt = toIso(job.completedAt);
    const files: PartnerSessionFileView[] = [];

    const outputFiles = Array.isArray(job.result?.outputFiles) ? job.result.outputFiles : [];
    for (const out of outputFiles) {
      if (!out?.url) continue;
      const role: PartnerSessionFileView['role'] | null =
        out.type === 'set' ? 'sheet' : out.type === 'pages' ? 'single' : null;
      if (!role) continue;
      const entry = signedByName.get(basenameOf(out.url));
      if (!entry) continue;
      const sheet = role === 'sheet' && typeof out.setIndex === 'number' ? (sheets?.[out.setIndex] ?? null) : null;
      files.push({
        role,
        jobId: job.id,
        url: entry.url,
        auth: 'signed',
        ...(role === 'sheet' && typeof out.setIndex === 'number' ? { sheetIndex: out.setIndex } : {}),
        ...(typeof out.pageCount === 'number' ? { pageCount: out.pageCount } : {}),
        ...(typeof sheet?.copies === 'number' ? { copies: sheet.copies } : {}),
        ...(typeof sheet?.label === 'string' ? { label: sheet.label } : {}),
        ...(generatedAt ? { generatedAt } : {}),
        expiresAt: new Date(entry.expires * 1000).toISOString(),
      });
    }

    // outputFiles 없는 단일 산출(merged) — job.output_file_url
    if (files.length === 0 && job.outputFileUrl) {
      const entry = signedByName.get(basenameOf(job.outputFileUrl));
      if (entry) {
        files.push({
          role: 'single',
          jobId: job.id,
          url: entry.url,
          auth: 'signed',
          ...(generatedAt ? { generatedAt } : {}),
          expiresAt: new Date(entry.expires * 1000).toISOString(),
        });
      }
    }
    return files;
  }

  /** 검증 프로파일(resolveValidatedProfile: 템플릿셋 우선, 없으면 세션 스냅샷) 요약. 없거나 무효(NULL 세트 포함)면 null */
  private buildProductView(session: EditSessionEntity, profile: ProductProfile | null): PartnerSessionProductView | null {
    if (!profile) return null;
    return {
      ...summarizeProductProfile(profile, resolveSessionPageCount(session)),
      duplexFlip: profile.sheet.duplexFlip,
      backRotation: profile.sheet.backRotation,
    };
  }

  /**
   * P2-d(2026-10-19): kind='photo-print' 세트(검증된 프로파일 — buildProductView 와 같은 값)만 세션 `metadata.items` 를
   * `readPhotoItems(…, profile.photoPrint)` 로 정제해 싣는다. 그 외 세트·프로파일 무효는 null(응답에 키 없음).
   * 항목 수는 세션 캔버스 수(사진 수)·upload.maxPhotos 를 넘지 않는다(security-1).
   */
  private buildItemsView(
    session: EditSessionEntity,
    profile: ProductProfile | null,
    metadata: SessionMetadata,
  ): PhotoItem[] | null {
    if (profile?.kind !== 'photo-print') return null;
    return readSessionPhotoItems(profile, metadata, resolveSessionPageCount(session));
  }

  // ── synthesize ───────────────────────────────────────────────────────

  async synthesize(
    site: CurrentSitePayload | undefined,
    sessionId: string,
  ): Promise<PartnerSessionSynthesizeView> {
    this.assertEnabled();
    this.assertEditorCaller(site);
    const session = await this.findSessionForSite(site, sessionId);

    if (session.status !== SessionStatus.COMPLETE) {
      throw new PartnerApiException(
        ErrV1.ERR_SESSION_NOT_COMPLETE,
        409,
        '편집이 완료된 세션에만 재합성을 요청할 수 있습니다',
      );
    }

    const templateSet = session.templateSetId
      ? await this.findTemplateSetForSite(site, session.templateSetId)
      : null;
    // P2-c(2026-10-18): ① 상품 프로파일(템플릿셋 우선, 없으면 세션 스냅샷 — buildProductView 와 같은 우선순위)
    // output.mode='sheet-map' → 시트 매핑 재합성(킬스위치 SHEET_MAP_OUTPUT_ENABLED 가 켜진 경우만)
    // ② 아니면 템플릿셋 pdfOutputMode='duplex-split' → 종전 duplex-split 재합성 ③ 아니면 422.
    const sheetMapTarget =
      isSheetMapOutputEnabled() &&
      this.resolveValidatedProfile(templateSet, this.metadataOf(session), 'synthesize')?.output.mode === 'sheet-map';
    if (!sheetMapTarget && (!templateSet || templateSet.pdfOutputMode !== 'duplex-split')) {
      throw new PartnerApiException(
        ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED,
        422,
        "상품 프로파일 output.mode 가 'sheet-map' 이거나 템플릿셋 pdfOutputMode 가 'duplex-split' 인 세션만 재합성할 수 있습니다",
      );
    }

    if (!session.coverFileId && !session.coverFile?.id) {
      throw new PartnerApiException(
        ErrV1.ERR_SESSION_NOT_COMPLETE,
        409,
        '편집기 산출 PDF 가 아직 없습니다 — 편집 완료 뒤 다시 요청하세요',
      );
    }

    // 보안 리뷰(2026-10-18 #3): Idempotency-Key 없이 연타하면 호출마다 회차·잡·웹훅이 늘어난다 —
    // 파트너 가시 최신 합성 잡이 아직 진행 중이면 새 잡을 만들지 않고 그 잡과 현재 회차를 돌려준다(멱등 재사용).
    const inFlight = await this.editSessionsService.findLatestPartnerVisibleSynthJob(session.id);
    if (inFlight && SYNTH_IN_FLIGHT_STATUSES.has(String(inFlight.status))) {
      return { jobId: inFlight.id, revision: sessionRevisionOf(session.metadata) };
    }

    const caller = { siteId: site.siteId, env: this.resolveEnv(site) };
    if (sheetMapTarget) {
      try {
        return await this.editSessionsService.requestSheetMapResynthesis(session.id, caller);
      } catch (e) {
        // 시트 매핑 불가(프로파일·페이지 수 불일치 등)는 파트너가 고칠 수 없는 상품 구성 문제 — 422 로 알린다(500 아님).
        if (e instanceof SheetMapError) {
          throw new PartnerApiException(ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422, e.message);
        }
        throw e;
      }
    }
    return this.editSessionsService.requestDuplexSplitResynthesis(session.id, caller);
  }

  /**
   * synthesize 게이트·deliverables items 용 프로파일 — buildProductView 와 같은 우선순위(템플릿셋 productProfile → 세션 스냅샷)이되
   * 검증된 프로파일만 인정한다(resolveProductProfile: version·validateProductProfile 통과). 둘 다 없거나 무효면 null.
   * `scope` 는 경고 로그 접두사([partner-v1 synthesize] / [partner-v1 deliverables])에만 쓴다.
   */
  private resolveValidatedProfile(
    templateSet: TemplateSet | null,
    metadata: SessionMetadata,
    scope: 'synthesize' | 'deliverables',
  ): ProductProfile | null {
    const warn = (m: string): void => this.logger.warn(`[partner-v1 ${scope}] ${m}`);
    const fromTemplateSet = resolveProductProfile(templateSet, warn);
    if (fromTemplateSet) return fromTemplateSet;
    if (metadata.productProfile === undefined || metadata.productProfile === null) return null;
    return resolveProductProfile({ productProfile: metadata.productProfile as ProductProfile }, warn);
  }
}

/**
 * api-sheetmap-3(2026-10-19): 완료 세션의 `metadata.production.sheetMap`(서버 기록 sheet-map 발행 실패) 이 유효하고,
 * 그보다 뒤(createdAt ≥ at)에 만들어진 파트너 가시 합성 잡이 없으면 그 기록 — deliverables 는 status 'failed' +
 * errorCode/errorDetail 로 노출한다. 미완료 세션(editing)·기록 없음·더 새 잡 있음 → null(종전 status 산출).
 */
export function resolveSheetMapFailure(
  sessionStatus: SessionStatus | string,
  metadata: Record<string, unknown> | null | undefined,
  job: Pick<PartnerVisibleSynthJobRow, 'createdAt'> | null,
): SheetMapFailureRecord | null {
  if (sessionStatus !== SessionStatus.COMPLETE) return null;
  const failure = sheetMapFailureOf(metadata);
  if (!failure) return null;
  if (job) {
    const jobAt = new Date(job.createdAt).getTime();
    const failedAt = new Date(failure.at).getTime();
    if (Number.isFinite(jobAt) && Number.isFinite(failedAt) && jobAt >= failedAt) return null;
  }
  return failure;
}

/** 최신 파트너 가시 합성 잡이 sheet-map 잡이면 발행 시 저장한 `options.sheets`(배열) — 그 밖은 null */
export function sheetMapSheetsOf(job: PartnerVisibleSynthJobRow | null): SheetSpec[] | null {
  const options = job?.options;
  if (!options || options.mode !== 'sheet-map' || !Array.isArray(options.sheets)) return null;
  return options.sheets;
}

// ── 순수 헬퍼(spec 에서 직접 단언) ─────────────────────────────────────

/**
 * 세션 status + 파트너 가시 최신 SYNTHESIZE 잡 status → 산출 상태.
 *  - 세션 미완료 → 'editing'
 *  - 완료 + 잡 없음 → 'complete'
 *  - 잡 COMPLETED → 'ready' / FAILED → 'failed' / 그 밖(PENDING·PROCESSING 등) → 'synthesizing'
 */
export function resolveDeliverableStatus(
  sessionStatus: SessionStatus | string,
  jobStatus: string | null,
): PartnerSessionDeliverableStatus {
  if (sessionStatus !== SessionStatus.COMPLETE) return 'editing';
  if (!jobStatus) return 'complete';
  if (jobStatus === WorkerJobStatus.COMPLETED) return 'ready';
  if (jobStatus === WorkerJobStatus.FAILED) return 'failed';
  return 'synthesizing';
}

/** metadata.calendar{startYear,startMonth,dataVersion} → {startYm:'YYYY-MM', dataVersion}. 형식 불충분이면 null */
export function buildCalendarView(metadata: { calendar?: unknown }): PartnerSessionCalendarView | null {
  const cal = metadata.calendar as { startYear?: unknown; startMonth?: unknown; dataVersion?: unknown } | undefined;
  if (!cal || typeof cal !== 'object') return null;
  const year = Number(cal.startYear);
  const month = Number(cal.startMonth);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return {
    startYm: `${year}-${String(month).padStart(2, '0')}`,
    dataVersion: typeof cal.dataVersion === 'string' ? cal.dataVersion : null,
  };
}

function basenameOf(url: string): string {
  const path = url.split('?')[0] ?? url;
  return path.split('/').pop() ?? path;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * launch body `calendar` → 편집기가 읽는 세션 메타 형식.
 * 설계안 §8.1 의 `{ startYm: 'YYYY-MM' }` 를 `{ startYear, startMonth }` 로 풀어 기록한다(편집기 `readCalendarSessionMeta`
 * 는 정수 startYear/startMonth 만 복원하므로 startYm 그대로 두면 시작연월 요청이 무시된다). 이미 startYear/startMonth 가
 * 있으면 그대로 두고, 그 밖의 키(dataVersion 등)는 보존한다. 변환 시 anniversaries 가 배열이 아니면 [] 로 채운다(편집기 복원 조건).
 * 형식이 맞지 않는 startYm 은 제거하지 않고 그대로 남긴다(기록 전용).
 */
export function normalizeLaunchCalendar(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  const startYm = typeof input.startYm === 'string' ? input.startYm.trim() : null;
  const m = startYm ? /^(\d{4})-(\d{2})$/.exec(startYm) : null;
  if (m && !Number.isInteger(input.startYear) && !Number.isInteger(input.startMonth)) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    if (month >= 1 && month <= 12) {
      out.startYear = year;
      out.startMonth = month;
      delete out.startYm;
      // 편집기 readCalendarSessionMeta 는 anniversaries 배열이 없으면 메타 전체를 무시한다 — 빈 배열로 보강
      if (!Array.isArray(out.anniversaries)) out.anniversaries = [];
    }
  }
  return out;
}

/** 진행 중으로 보는 합성 잡 상태 — synthesize 연타 시 새 잡 대신 이 잡을 돌려준다 */
export const SYNTH_IN_FLIGHT_STATUSES: ReadonlySet<string> = new Set(['PENDING', 'PROCESSING']);

/** launch 자유형 본문(orderOptions·items·calendar·externalPhotos) 직렬화 상한 — 세션 metadata(json) 에 그대로 저장되어 세션 GET 마다 편집기로 전송된다 */
export const LAUNCH_PAYLOAD_MAX_BYTES = 256 * 1024;

export function launchPayloadBytes(dto: {
  orderOptions?: unknown;
  items?: unknown;
  calendar?: unknown;
  externalPhotos?: unknown;
}): number {
  return Buffer.byteLength(
    JSON.stringify({
      orderOptions: dto.orderOptions,
      items: dto.items,
      calendar: dto.calendar,
      externalPhotos: dto.externalPhotos,
    }),
    'utf8',
  );
}

export function assertLaunchPayloadWithinLimit(dto: {
  orderOptions?: unknown;
  items?: unknown;
  calendar?: unknown;
  externalPhotos?: unknown;
}): void {
  const bytes = launchPayloadBytes(dto);
  if (bytes > LAUNCH_PAYLOAD_MAX_BYTES) {
    throw new PartnerApiException(
      ErrV1.ERR_VALIDATION_FAILED,
      400,
      `launch 본문(orderOptions·items·calendar·externalPhotos)이 상한 ${LAUNCH_PAYLOAD_MAX_BYTES} 바이트를 넘습니다 (${bytes})`,
      [],
      { body: [`${LAUNCH_PAYLOAD_MAX_BYTES} 바이트 이내여야 합니다`] },
    );
  }
}
