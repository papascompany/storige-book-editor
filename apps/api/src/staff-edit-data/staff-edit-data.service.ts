import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import type { Response } from 'express';
import type { Readable } from 'stream';
import { WorkerJobStatus } from '@storige/types';
import { EditSessionEntity } from '../edit-sessions/entities/edit-session.entity';
import {
  EditSessionsService,
  StaffCallerContext,
} from '../edit-sessions/edit-sessions.service';
import { Site } from '../sites/entities/site.entity';
import { UserSiteRole } from '../auth/entities/user-site-role.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { streamJobOutput } from '../worker-jobs/job-output-stream';
import { FilesService } from '../files/files.service';
import {
  PartnerOperatorGrantService,
  StaffGrantListItem,
  StaffGrantRevokeResult,
} from '../auth/partner-operator/partner-operator-grant.service';
import {
  PartnerOperatorAuditWriter,
  StaffAuditListItem,
  isStaffEditAfterCompletion,
} from '../auth/partner-operator/partner-operator-audit.writer';
import type { PartnerOperatorAuditDetail } from '../auth/entities/partner-operator-audit-log.entity';
import { applySiteScope } from '../common/helpers/tenant-scope.helper';
import {
  EditRetentionCutoff,
  EditRetentionInfo,
  assertWithinRetention,
  buildEditRetentionCutoffs,
  computeEditRetention,
  normalizeEditRetentionDays,
} from './edit-retention';
import {
  StaffActor,
  actorCanSeeSite,
  actorSiteIds,
  actorTenantScope,
  canDeleteFor,
  resolveStaffActor,
  staffAuditUnavailable,
  staffBaselineUnavailable,
  staffDeleteNotAllowed,
  staffSessionNotFound,
} from './staff-actor';
import {
  ListStaffSessionsQueryDto,
  StaffAuditQueryDto,
  StaffEditorSessionDto,
  StaffEditorSessionResponse,
  StaffJobItem,
  StaffOrderMeta,
  StaffRetentionReportQueryDto,
  StaffRetentionReportRow,
  StaffSessionFileKind,
  StaffSessionItem,
  StaffSessionListResponse,
  StaffSynthesizeDto,
} from './dto/staff-edit-data.dto';

/** 세션 1행(명시 컬럼, raw) — guest_token 원문은 선택하지 않는다(isGuest 만) */
export interface StaffSessionRow {
  id: string;
  siteId: string | null;
  orderSeqno: number;
  memberSeqno: number;
  status: string;
  mode: string;
  templateSetId: string | null;
  metadata: Record<string, unknown> | null;
  coverFileId: string | null;
  contentFileId: string | null;
  contentPdfFileId: string | null;
  isGuest: boolean;
  guestExpiresAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  completedAt: Date | null;
  deletedAt: Date | null;
}

type RawSessionRow = { [K in keyof StaffSessionRow]?: unknown };

interface SiteInfo {
  id: string;
  name: string | null;
  editRetentionDays: number | null;
}

export interface StaffActionResult {
  success: true;
  sessionId: string;
  status?: string;
  completedAt?: string | null;
}

export interface StaffSynthesizeResult {
  success: true;
  job: { id: string; status: string; jobType: string };
}

const EDITOR_PATH = (sessionId: string): string =>
  `/embed?sessionId=${encodeURIComponent(sessionId)}&adminEdit=session`;

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(v: Date | null): string | null {
  return v ? v.toISOString() : null;
}

function toStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseJsonObject(v: unknown): Record<string, unknown> | null {
  let value: unknown = v;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** metadata.member.memberId — 세션 생성 시 shop JWT 에서 스냅샷(2026-06-11~) */
export function memberIdFromMetadata(metadata: Record<string, unknown> | null): string | null {
  const member = asRecord(metadata?.member);
  return toStr(member?.memberId);
}

/** metadata.orderOptions(편집기 주문 옵션 스냅샷) → 제작 스펙 요약 필드. 값이 하나도 없으면 null */
export function orderMetaFromMetadata(metadata: Record<string, unknown> | null): StaffOrderMeta | null {
  if (!metadata) return null;
  const oo = asRecord(metadata.orderOptions) ?? {};
  const sizeRaw = asRecord(oo.size) ?? asRecord(metadata.size);
  const w = Number(sizeRaw?.width);
  const h = Number(sizeRaw?.height);
  const size = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `${w}×${h}mm` : null;
  const q = Number(oo.quantity);
  const meta: StaffOrderMeta = {
    productName: toStr(oo.productName),
    title: toStr(oo.title),
    quantity: Number.isFinite(q) && q > 0 ? q : null,
    size,
  };
  return meta.productName || meta.title || meta.quantity !== null || meta.size ? meta : null;
}

function normalizeSessionRow(raw: RawSessionRow): StaffSessionRow {
  const guest = raw.isGuest;
  return {
    id: String(raw.id),
    siteId: toStr(raw.siteId),
    orderSeqno: toNum(raw.orderSeqno),
    memberSeqno: toNum(raw.memberSeqno),
    status: String(raw.status ?? ''),
    mode: String(raw.mode ?? ''),
    templateSetId: toStr(raw.templateSetId),
    metadata: parseJsonObject(raw.metadata),
    coverFileId: toStr(raw.coverFileId),
    contentFileId: toStr(raw.contentFileId),
    contentPdfFileId: toStr(raw.contentPdfFileId),
    isGuest: guest === true || guest === 1 || guest === '1',
    guestExpiresAt: toDate(raw.guestExpiresAt),
    createdAt: toDate(raw.createdAt),
    updatedAt: toDate(raw.updatedAt),
    completedAt: toDate(raw.completedAt),
    deletedAt: toDate(raw.deletedAt),
  };
}

/** 보관기간 SQL 조각(목록 필터) — 사이트별 OR cutoff, sites 조인 없음 */
function retentionSql(cutoffs: EditRetentionCutoff[]): {
  active: string;
  expired: string;
  unset: string;
  params: Record<string, unknown>;
} {
  const params: Record<string, unknown> = { erNow: new Date() };
  // 괄호로 감싼다 — NOT 우선순위(HIGH_NOT_PRECEDENCE)와 무관하게 같은 뜻이 되도록.
  let protectedSites = '(1=0)';
  let inWindow = '(1=0)';
  if (cutoffs.length > 0) {
    params.erSites = cutoffs.map((c) => c.siteId);
    protectedSites = '(s.site_id IS NOT NULL AND s.site_id IN (:...erSites))';
    inWindow = `(${cutoffs
      .map((c, i) => {
        params[`lrs${i}`] = c.siteId;
        params[`lrc${i}`] = c.cutoff;
        return `(s.site_id = :lrs${i} AND s.created_at > :lrc${i})`;
      })
      .join(' OR ')})`;
  }
  const guest = '(s.guest_token IS NOT NULL AND s.guest_expires_at IS NOT NULL)';
  const active = `((${inWindow} OR (NOT ${protectedSites} AND ${guest})) AND (NOT ${guest} OR s.guest_expires_at > :erNow))`;
  const expired = `((${protectedSites} OR ${guest}) AND NOT ${active})`;
  const unset = `(NOT ${protectedSites} AND NOT ${guest})`;
  return { active, expired, unset, params };
}

/**
 * Storige 관리자 편집데이터 관리 (2026-09-29, ADDITIVE) — /api/admin/edit-data 13개 라우트.
 *
 * 공통 순서: 세션 로드(필요 시 삭제 포함) → 범위(404, 미존재와 동일) → 삭제/사이트 전제(409) →
 * 보관기간(409, 삭제 예외) → 권한(403) → 감사(fail-closed, 실패 시 503 STAFF_AUDIT_UNAVAILABLE) →
 * 변경 → 후속 감사(best-effort).
 * 호출자 역할·사이트 범위는 매 요청 DB(user_site_roles)에서 다시 읽는다(resolveStaffActor).
 */
@Injectable()
export class StaffEditDataService {
  private readonly logger = new Logger(StaffEditDataService.name);

  constructor(
    @InjectRepository(EditSessionEntity)
    private readonly sessionRepository: Repository<EditSessionEntity>,
    @InjectRepository(Site)
    private readonly siteRepository: Repository<Site>,
    @InjectRepository(UserSiteRole)
    private readonly userSiteRoleRepository: Repository<UserSiteRole>,
    private readonly editSessionsService: EditSessionsService,
    private readonly workerJobsService: WorkerJobsService,
    private readonly filesService: FilesService,
    private readonly grantService: PartnerOperatorGrantService,
    private readonly auditWriter: PartnerOperatorAuditWriter,
  ) {}

  // ───────────────────────────── 공통 ─────────────────────────────

  resolveActor(user: unknown): Promise<StaffActor> {
    return resolveStaffActor(user, this.userSiteRoleRepository);
  }

  private selectSessionColumns(qb: SelectQueryBuilder<EditSessionEntity>): SelectQueryBuilder<EditSessionEntity> {
    return qb
      .select('s.id', 'id')
      .addSelect('s.siteId', 'siteId')
      .addSelect('s.orderSeqno', 'orderSeqno')
      .addSelect('s.memberSeqno', 'memberSeqno')
      .addSelect('s.status', 'status')
      .addSelect('s.mode', 'mode')
      .addSelect('s.templateSetId', 'templateSetId')
      .addSelect('s.metadata', 'metadata')
      .addSelect('s.cover_file_id', 'coverFileId')
      .addSelect('s.content_file_id', 'contentFileId')
      .addSelect('s.contentPdfFileId', 'contentPdfFileId')
      .addSelect('CASE WHEN s.guest_token IS NULL THEN 0 ELSE 1 END', 'isGuest')
      .addSelect('s.guestExpiresAt', 'guestExpiresAt')
      .addSelect('s.createdAt', 'createdAt')
      .addSelect('s.updatedAt', 'updatedAt')
      .addSelect('s.completedAt', 'completedAt')
      .addSelect('s.deletedAt', 'deletedAt');
  }

  /** 세션 1건(삭제 포함) — 없으면 null */
  async loadSession(id: string): Promise<StaffSessionRow | null> {
    const qb = this.selectSessionColumns(this.sessionRepository.createQueryBuilder('s').withDeleted()).where(
      's.id = :id',
      { id },
    );
    const raw = await qb.getRawOne<RawSessionRow>();
    return raw ? normalizeSessionRow(raw) : null;
  }

  /** 세션 로드 + 범위 확인 — 미존재·범위 밖은 동일한 404 SESSION_NOT_FOUND */
  private async loadScopedSession(actor: StaffActor, id: string): Promise<StaffSessionRow> {
    const session = await this.loadSession(id);
    if (!session || !actorCanSeeSite(actor, session.siteId)) throw staffSessionNotFound();
    return session;
  }

  private async loadSite(siteId: string | null): Promise<SiteInfo | null> {
    if (!siteId) return null;
    const row = await this.siteRepository.findOne({
      where: { id: siteId },
      select: ['id', 'name', 'editRetentionDays'],
    });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name ?? null,
      editRetentionDays: normalizeEditRetentionDays(row.editRetentionDays),
    };
  }

  private async loadSitesMap(): Promise<Map<string, SiteInfo>> {
    const rows = await this.siteRepository.find({ select: ['id', 'name', 'editRetentionDays'] });
    const map = new Map<string, SiteInfo>();
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        name: r.name ?? null,
        editRetentionDays: normalizeEditRetentionDays(r.editRetentionDays),
      });
    }
    return map;
  }

  private retentionOf(session: StaffSessionRow, site: SiteInfo | null, now: Date = new Date()): EditRetentionInfo {
    return computeEditRetention(
      { createdAt: session.createdAt, isGuest: session.isGuest, guestExpiresAt: session.guestExpiresAt },
      session.siteId ? (site?.editRetentionDays ?? null) : null,
      now,
    );
  }

  private staffContext(actor: StaffActor, siteId: string | null): StaffCallerContext {
    return {
      userId: actor.userId,
      global: actor.global,
      siteIds: actorSiteIds(actor),
      canDelete: canDeleteFor(actor, siteId),
    };
  }

  private assertExplicitSite(actor: StaffActor, siteId: string | undefined): void {
    if (siteId && !actorCanSeeSite(actor, siteId)) {
      throw new ForbiddenException({
        code: 'TENANT_FORBIDDEN',
        message: '이 사이트에 대한 권한이 없습니다.',
      });
    }
  }

  private assertNotDeleted(session: StaffSessionRow): void {
    if (session.deletedAt) {
      throw new ConflictException({
        code: 'SESSION_DELETED',
        message: '삭제된 세션입니다. 먼저 복구하세요.',
      });
    }
  }

  private assertSiteRequired(session: StaffSessionRow): asserts session is StaffSessionRow & { siteId: string } {
    if (!session.siteId) {
      throw new ConflictException({
        code: 'STAFF_SESSION_SITE_REQUIRED',
        message: '사이트가 없는 이전 세션은 편집기·합성을 지원하지 않습니다.',
      });
    }
  }

  /** 감사 행(fail-closed) — 실패하면 503 STAFF_AUDIT_UNAVAILABLE, 이후 변경 없음 */
  private async auditOrThrow(
    actor: StaffActor,
    session: Pick<StaffSessionRow, 'id' | 'siteId'>,
    action: string,
    detail: PartnerOperatorAuditDetail,
  ): Promise<void> {
    try {
      await this.auditWriter.recordOrThrow({
        grantId: null,
        origin: 'staff',
        actorUserId: actor.userId,
        siteId: session.siteId,
        sessionId: session.id,
        operatorId: `staff.${actor.userId}`,
        action,
        detail,
      });
    } catch {
      throw staffAuditUnavailable();
    }
  }

  private async auditBestEffort(
    actor: StaffActor,
    session: Pick<StaffSessionRow, 'id' | 'siteId'>,
    action: string,
    detail: PartnerOperatorAuditDetail,
  ): Promise<void> {
    await this.auditWriter.recordBestEffort({
      grantId: null,
      origin: 'staff',
      actorUserId: actor.userId,
      siteId: session.siteId,
      sessionId: session.id,
      operatorId: `staff.${actor.userId}`,
      action,
      detail,
    });
  }

  /** 보관기간 안(설정된 사이트)이면 세션이 직접 참조하는 soft-deleted 파일을 복구(best-effort) */
  private async reviveFiles(session: StaffSessionRow, retention: EditRetentionInfo): Promise<string[]> {
    if (retention.state !== 'active' || retention.days === null || !retention.until) return [];
    const ids = [session.coverFileId, session.contentFileId, session.contentPdfFileId].filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    if (ids.length === 0) return [];
    try {
      return await this.filesService.reviveForEditRetention(ids, new Date(retention.until));
    } catch (e) {
      this.logger.warn(
        `[staff-edit-data] 파일 복구 실패(계속) session=${session.id}: ${(e as Error)?.message}`,
      );
      return [];
    }
  }

  private toItem(
    session: StaffSessionRow,
    site: SiteInfo | null,
    actor: StaffActor,
    templateSetName: string | null,
    lastStaffUpdate: Date | null,
    lastCompletionAudit: Date | null,
    now: Date,
  ): StaffSessionItem {
    const retention = this.retentionOf(session, site, now);
    // completed_at(초 단위) ↔ 감사 created_at(ms) 정밀도 차이 보정 — synthesize 의 OUTPUT_STALE 과 같은 규칙.
    const staffEditedAfterComplete = isStaffEditAfterCompletion(
      lastStaffUpdate,
      session.completedAt,
      lastCompletionAudit,
    );
    return {
      id: session.id,
      siteId: session.siteId,
      siteName: site?.name ?? null,
      orderSeqno: session.orderSeqno,
      memberSeqno: session.memberSeqno,
      memberId: memberIdFromMetadata(session.metadata),
      orderMeta: orderMetaFromMetadata(session.metadata),
      isGuest: session.isGuest,
      status: session.status,
      mode: session.mode,
      templateSetId: session.templateSetId,
      templateSetName,
      coverFileId: session.coverFileId,
      contentFileId: session.contentFileId,
      contentPdfFileId: session.contentPdfFileId,
      createdAt: toIso(session.createdAt),
      updatedAt: toIso(session.updatedAt),
      completedAt: toIso(session.completedAt),
      deletedAt: toIso(session.deletedAt),
      retention,
      staffEditedAfterComplete,
      canDelete: canDeleteFor(actor, session.siteId),
    };
  }

  private async templateSetNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const unique = Array.from(new Set(ids.filter((v) => typeof v === 'string' && v.length > 0)));
    if (unique.length === 0) return map;
    const rows = await this.sessionRepository.manager
      .createQueryBuilder()
      .select('ts.id', 'id')
      .addSelect('ts.name', 'name')
      .from('template_sets', 'ts')
      .where('ts.id IN (:...ids)', { ids: unique })
      .getRawMany<{ id: string; name: string }>();
    for (const r of rows) map.set(r.id, r.name);
    return map;
  }

  // ───────────────────────────── 1. 목록 ─────────────────────────────

  async listSessions(user: unknown, query: ListStaffSessionsQueryDto): Promise<StaffSessionListResponse> {
    const actor = await this.resolveActor(user);
    this.assertExplicitSite(actor, query.siteId);
    const page = Math.max(1, Math.trunc(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.trunc(query.limit ?? 20)));
    const deleted = query.deleted ?? 'exclude';
    const now = new Date();
    const sites = await this.loadSitesMap();

    const qb = this.sessionRepository.createQueryBuilder('s');
    if (deleted !== 'exclude') qb.withDeleted();
    if (deleted === 'only') qb.andWhere('s.deletedAt IS NOT NULL');
    // 사이트 운영자: DB 사이트 역할 범위만(NULL-site 제외). 전역: 필터 없음(NULL-site 포함).
    applySiteScope(qb, 's', actorTenantScope(actor), { includeNull: false });
    if (query.siteId) qb.andWhere('s.siteId = :fSiteId', { fSiteId: query.siteId });
    if (query.status) qb.andWhere('s.status = :fStatus', { fStatus: query.status });
    if (query.orderSeqno !== undefined) qb.andWhere('s.orderSeqno = :fOrder', { fOrder: query.orderSeqno });
    if (query.memberSeqno !== undefined) qb.andWhere('s.memberSeqno = :fMember', { fMember: query.memberSeqno });
    if (query.retention) {
      const cutoffs = buildEditRetentionCutoffs(
        Array.from(sites.values()).map((s) => ({ id: s.id, days: s.editRetentionDays })),
        now,
      );
      const sql = retentionSql(cutoffs);
      qb.andWhere(sql[query.retention], sql.params);
    }

    const total = await qb.getCount();
    const raws = await this.selectSessionColumns(qb)
      .orderBy('s.createdAt', 'DESC')
      .offset((page - 1) * limit)
      .limit(limit)
      .getRawMany<RawSessionRow>();
    const rows = raws.map(normalizeSessionRow);

    const names = await this.templateSetNames(rows.map((r) => r.templateSetId ?? ''));
    const lastUpdates = await this.auditWriter.latestStaffUpdateBySession(rows.map((r) => r.id));
    const lastCompletions =
      lastUpdates.size > 0
        ? await this.auditWriter.latestCompletionAuditBySession(Array.from(lastUpdates.keys()))
        : new Map<string, Date>();
    const items = rows.map((r) =>
      this.toItem(
        r,
        r.siteId ? (sites.get(r.siteId) ?? null) : null,
        actor,
        r.templateSetId ? (names.get(r.templateSetId) ?? null) : null,
        lastUpdates.get(r.id) ?? null,
        lastCompletions.get(r.id) ?? null,
        now,
      ),
    );
    return { items, total, page, limit };
  }

  // ───────────────────────────── 2. 잡 목록 ─────────────────────────────

  async listJobs(user: unknown, sessionId: string): Promise<{ items: StaffJobItem[] }> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    const jobs = await this.workerJobsService.findJobsBySession(session.id, 50, session.siteId);
    const items = jobs.map((j): StaffJobItem => {
      const options = asRecord(j.options);
      const result = asRecord(j.result);
      const inner = asRecord(result?.result);
      const outputUrl = toStr(result?.outputFileUrl) ?? toStr(inner?.outputFileUrl);
      const done = j.status === WorkerJobStatus.COMPLETED || j.status === WorkerJobStatus.FIXABLE;
      return {
        id: j.id,
        jobType: String(j.jobType),
        status: String(j.status),
        capability: toStr(options?.capability),
        staffInitiated: asRecord(options?.staffInitiated) !== null,
        createdAt: toIso(toDate(j.createdAt)),
        completedAt: toIso(toDate(j.completedAt)),
        hasOutput: done && outputUrl !== null,
      };
    });
    return { items };
  }

  // ───────────────────────────── 3. 잡 산출물 ─────────────────────────────

  async streamJobOutput(user: unknown, jobId: string, res: Response): Promise<void> {
    const actor = await this.resolveActor(user);
    const notFound = (): NotFoundException =>
      new NotFoundException({ code: 'JOB_NOT_FOUND', message: `Worker job ${jobId} not found` });
    const ref = await this.workerJobsService.findJobScopeRef(jobId);
    if (!ref) throw notFound();
    // 범위: 잡의 edit_session_id 세션(삭제 포함)의 사이트, 없으면 잡 site_id(NULL = 전역만).
    let scopeSiteId: string | null = ref.siteId;
    if (ref.editSessionId) {
      const session = await this.loadSession(ref.editSessionId);
      if (session) scopeSiteId = session.siteId;
    }
    if (!actorCanSeeSite(actor, scopeSiteId)) throw notFound();
    const job = await this.workerJobsService.findOne(jobId);
    streamJobOutput(job, res, this.logger);
  }

  // ───────────────────────────── 4. 세션 입력 파일 ─────────────────────────────

  async streamSessionFile(
    user: unknown,
    sessionId: string,
    kind: StaffSessionFileKind,
    res: Response,
  ): Promise<void> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    // 파일 id 는 세션 컬럼에서만 얻는다(요청값 불신).
    const fileId =
      kind === StaffSessionFileKind.cover
        ? session.coverFileId
        : kind === StaffSessionFileKind.content
          ? session.contentFileId
          : session.contentPdfFileId;
    if (!fileId) {
      throw new NotFoundException({ code: 'FILE_NOT_FOUND', message: '파일을 찾을 수 없습니다.' });
    }
    const { stream, file, size } = await this.filesService.getFileStream(fileId);
    this.pipeFile(res, stream, {
      contentType: file.mimeType || 'application/octet-stream',
      filename: file.originalName || file.fileName || `${kind}.pdf`,
      size,
      logCtx: `staff file ${sessionId}/${kind}`,
    });
  }

  private pipeFile(
    res: Response,
    stream: Readable,
    opts: { contentType: string; filename: string; size?: number; logCtx: string },
  ): void {
    res.setHeader('Content-Type', opts.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(opts.filename)}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (typeof opts.size === 'number' && opts.size > 0) res.setHeader('Content-Length', opts.size);
    res.on('close', () => stream.destroy());
    stream.on('error', (err: NodeJS.ErrnoException) => {
      this.logger.error(`[staff-edit-data] ${opts.logCtx} stream error (${err.code ?? 'unknown'}): ${err.message}`);
      if (!res.headersSent) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Disposition');
        res.removeHeader('Content-Length');
        res.status(500).json({ code: 'STREAM_ERROR', message: '파일 스트리밍 중 오류가 발생했습니다.' });
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  }

  // ───────────────────────────── 5. 편집기 권한 ─────────────────────────────

  async openEditorSession(
    user: unknown,
    sessionId: string,
    dto: StaffEditorSessionDto,
  ): Promise<StaffEditorSessionResponse> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    this.assertNotDeleted(session);
    this.assertSiteRequired(session);
    const site = await this.loadSite(session.siteId);
    const retention = this.retentionOf(session, site);
    assertWithinRetention(retention);
    const allowDelete = dto.allowDelete === true;
    if (allowDelete && !canDeleteFor(actor, session.siteId)) throw staffDeleteNotAllowed();

    const revived = await this.reviveFiles(session, retention);
    if (revived.length > 0) {
      this.logger.log(`[staff-edit-data] editor-session 파일 복구 session=${session.id} files=${revived.join(',')}`);
    }
    try {
      await this.editSessionsService.pinStaffBaseline(session.id);
    } catch (e) {
      this.logger.error(
        `[staff-edit-data] staff-baseline 저장 실패(발급 중단) session=${session.id}: ${(e as Error)?.message}`,
      );
      throw staffBaselineUnavailable();
    }

    const notAfterUnix = retention.until ? Math.floor(new Date(retention.until).getTime() / 1000) : null;
    const minted = await this.grantService.mintForStaff({
      sessionId: session.id,
      siteId: session.siteId,
      siteName: site?.name ?? '',
      actorUserId: actor.userId,
      allowDelete,
      ttlSeconds: dto.ttlSeconds,
      notAfterUnix,
      reason: dto.reason ?? null,
      ...(session.memberSeqno > 0 && Number.isSafeInteger(session.memberSeqno)
        ? { onBehalfOfMemberSeqno: session.memberSeqno }
        : {}),
    });
    return {
      success: true,
      accessToken: minted.accessToken,
      refreshToken: minted.refreshToken,
      expiresIn: minted.expiresIn,
      grantId: minted.grantId,
      grantExpiresAt: minted.grantExpiresAt,
      capabilities: [...minted.capabilities],
      sessionId: session.id,
      editorPath: EDITOR_PATH(session.id),
    };
  }

  // ───────────────────────────── 6·7. 권한 목록·회수 ─────────────────────────────

  async listGrants(user: unknown, sessionId: string): Promise<{ items: StaffGrantListItem[] }> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    const items = await this.grantService.listStaffGrantsForSession(session.id, session.siteId);
    return { items };
  }

  async revokeGrant(user: unknown, grantId: string): Promise<StaffGrantRevokeResult> {
    const actor = await this.resolveActor(user);
    return this.grantService.revokeStaff(
      grantId,
      { global: actor.global, siteIds: actorSiteIds(actor) },
      actor.userId,
    );
  }

  // ───────────────────────────── 8. 완료 ─────────────────────────────

  async complete(user: unknown, sessionId: string): Promise<StaffActionResult> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    this.assertNotDeleted(session);
    const site = await this.loadSite(session.siteId);
    const retention = this.retentionOf(session, site);
    assertWithinRetention(retention);
    if (session.status === 'complete') {
      throw new ConflictException({
        code: 'SESSION_ALREADY_COMPLETE',
        message: '이미 완료된 세션입니다.',
      });
    }
    await this.auditOrThrow(actor, session, 'staff.session.complete', {
      statusFrom: session.status,
      retentionState: retention.state,
    });
    const done = await this.editSessionsService.complete(session.id, 0, {
      role: actor.role,
      staff: this.staffContext(actor, session.siteId),
    });
    return {
      success: true,
      sessionId: session.id,
      status: String(done.status),
      completedAt: toIso(toDate(done.completedAt)),
    };
  }

  // ───────────────────────────── 9. 삭제 ─────────────────────────────

  async remove(user: unknown, sessionId: string): Promise<StaffActionResult> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    this.assertNotDeleted(session);
    // 보관기간 만료 후에도 삭제는 허용(삭제 요청 이행) — 권한만 확인.
    if (!canDeleteFor(actor, session.siteId)) throw staffDeleteNotAllowed();
    const site = await this.loadSite(session.siteId);
    const retention = this.retentionOf(session, site);
    await this.auditOrThrow(actor, session, 'staff.session.delete', {
      retentionState: retention.state,
      statusFrom: session.status,
      orderSeqno: session.orderSeqno,
    });
    await this.editSessionsService.delete(session.id, 0, {
      role: actor.role,
      staff: this.staffContext(actor, session.siteId),
    });
    return { success: true, sessionId: session.id };
  }

  // ───────────────────────────── 10. 복구 ─────────────────────────────

  async restore(user: unknown, sessionId: string): Promise<StaffActionResult> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    const site = await this.loadSite(session.siteId);
    const retention = this.retentionOf(session, site);
    assertWithinRetention(retention);
    if (!canDeleteFor(actor, session.siteId)) throw staffDeleteNotAllowed();
    await this.auditOrThrow(actor, session, 'staff.session.restore', {
      wasDeleted: session.deletedAt !== null,
      retentionState: retention.state,
    });
    await this.editSessionsService.restoreSession(session.id);
    return { success: true, sessionId: session.id };
  }

  // ───────────────────────────── 11. 합성·재합성 ─────────────────────────────

  async synthesize(user: unknown, sessionId: string, dto: StaffSynthesizeDto): Promise<StaffSynthesizeResult> {
    const actor = await this.resolveActor(user);
    const session = await this.loadScopedSession(actor, sessionId);
    this.assertNotDeleted(session);
    this.assertSiteRequired(session);
    const site = await this.loadSite(session.siteId);
    const retention = this.retentionOf(session, site);
    assertWithinRetention(retention);

    const allowStale = dto.allowStale === true;
    const notifyPartner = dto.notifyPartner === true;
    const stale = await this.auditWriter.hasStaffUpdateAfter(session.id, session.completedAt);
    if (stale && !allowStale) {
      throw new ConflictException({
        code: 'OUTPUT_STALE',
        message: '편집기에서 편집완료로 PDF를 다시 만든 뒤 합성하세요',
      });
    }
    const previousJobs = await this.workerJobsService.findJobsBySession(session.id, 50, session.siteId);

    await this.auditOrThrow(actor, session, 'staff.session.synthesize', {
      outputMode: dto.outputMode ?? null,
      notifyPartner,
      allowStale,
      stale,
      previousJobCount: previousJobs.length,
      reason: dto.reason ?? null,
    });
    const revivedFileIds = await this.reviveFiles(session, retention);
    const job = await this.workerJobsService.createStaffComposeFromSession(session.id, session.siteId, {
      ...(dto.outputMode ? { outputMode: dto.outputMode } : {}),
      notifyPartner,
      actorUserId: actor.userId,
    });
    await this.auditBestEffort(actor, session, 'staff.session.synthesize.job', {
      jobId: job.id,
      revivedFileIds,
    });
    return { success: true, job: { id: job.id, status: String(job.status), jobType: String(job.jobType) } };
  }

  // ───────────────────────────── 12. 보관기간 보고서 ─────────────────────────────

  async retentionReport(
    user: unknown,
    query: StaffRetentionReportQueryDto,
  ): Promise<{ items: StaffRetentionReportRow[]; generatedAt: string }> {
    const actor = await this.resolveActor(user);
    this.assertExplicitSite(actor, query.siteId);
    const now = new Date();
    const sites = await this.loadSitesMap();
    const cutoffs = buildEditRetentionCutoffs(
      Array.from(sites.values()).map((s) => ({ id: s.id, days: s.editRetentionDays })),
      now,
    );
    const params: Record<string, unknown> = {};
    let inWindow = '1=0';
    let outWindow = '1=0';
    if (cutoffs.length > 0) {
      const ins: string[] = [];
      const outs: string[] = [];
      cutoffs.forEach((c, i) => {
        params[`rrs${i}`] = c.siteId;
        params[`rrc${i}`] = c.cutoff;
        ins.push(`(s.site_id = :rrs${i} AND s.created_at > :rrc${i})`);
        outs.push(`(s.site_id = :rrs${i} AND s.created_at <= :rrc${i})`);
      });
      inWindow = ins.join(' OR ');
      outWindow = outs.join(' OR ');
    }

    const qb = this.sessionRepository
      .createQueryBuilder('s')
      .withDeleted()
      .select('s.siteId', 'siteId')
      .addSelect('COUNT(*)', 'total')
      .addSelect(`SUM(CASE WHEN ${inWindow} THEN 1 ELSE 0 END)`, 'active')
      .addSelect(`SUM(CASE WHEN ${outWindow} THEN 1 ELSE 0 END)`, 'expired')
      .addSelect(`SUM(CASE WHEN (${outWindow}) AND s.deleted_at IS NOT NULL THEN 1 ELSE 0 END)`, 'expiredDeleted')
      .setParameters(params);
    applySiteScope(qb, 's', actorTenantScope(actor), { includeNull: false });
    if (query.siteId) qb.andWhere('s.siteId = :fSiteId', { fSiteId: query.siteId });
    const rows = await qb.groupBy('s.siteId').getRawMany<{
      siteId: string | null;
      total: unknown;
      active: unknown;
      expired: unknown;
      expiredDeleted: unknown;
    }>();

    const items = rows.map((r): StaffRetentionReportRow => {
      const siteId = toStr(r.siteId);
      const site = siteId ? (sites.get(siteId) ?? null) : null;
      const total = toNum(r.total);
      const active = toNum(r.active);
      const expired = toNum(r.expired);
      return {
        siteId,
        siteName: site?.name ?? null,
        editRetentionDays: site?.editRetentionDays ?? null,
        total,
        active,
        expired,
        expiredDeleted: toNum(r.expiredDeleted),
        unset: Math.max(0, total - active - expired),
        purge: 'disabled',
      };
    });
    return { items, generatedAt: now.toISOString() };
  }

  // ───────────────────────────── 13. 감사 조회 ─────────────────────────────

  async audit(user: unknown, query: StaffAuditQueryDto): Promise<{ items: StaffAuditListItem[] }> {
    const actor = await this.resolveActor(user);
    this.assertExplicitSite(actor, query.siteId);
    const items = await this.auditWriter.listStaff({
      siteIds: actor.global ? 'all' : actorSiteIds(actor),
      siteId: query.siteId,
      sessionId: query.sessionId,
      limit: query.limit,
      before: query.before,
    });
    return { items };
  }
}
