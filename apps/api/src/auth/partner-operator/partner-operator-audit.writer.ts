import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  PartnerOperatorAuditDetail,
  PartnerOperatorAuditLogEntity,
} from '../entities/partner-operator-audit-log.entity';
import { OPERATOR_NAME_MAX, PartnerOperatorOrigin } from './partner-operator.types';

export interface PartnerOperatorAuditEntry {
  /** 관리자 직접 작업·사이트 설정 변경은 null */
  grantId: string | null;
  /** NULL-site 레거시 세션 작업은 null */
  siteId: string | null;
  /** 기본 'partner' — Storige 관리자 작업은 'staff' */
  origin?: PartnerOperatorOrigin;
  /** 관리자 작업의 users.id (origin 'staff' 전용) */
  actorUserId?: string | null;
  sessionId?: string | null;
  operatorId: string;
  operatorName?: string | null;
  action: string;
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
  detail?: PartnerOperatorAuditDetail | null;
}

/**
 * 세션 완료를 기록하는 감사 action(모든 origin) — 편집기 편집완료(운영자 권한 경로 'session.complete'),
 * 관리자 화면 완료 처리('staff.session.complete'), 레거시 관리자 게스트 완료('staff.legacy.guest_complete').
 * 세 행 모두 완료 저장 직전에 fail-closed 로 기록된다.
 */
export const SESSION_COMPLETION_AUDIT_ACTIONS: readonly string[] = [
  'session.complete',
  'staff.session.complete',
  'staff.legacy.guest_complete',
];

/**
 * completed_at 은 TIMESTAMP(초 단위, 절삭 또는 반올림)이고 감사 created_at 은 TIMESTAMP(3)이다.
 * 같은 해상도로 비교하기 위해 초 단위 값의 오차 범위(1초)를 둔다.
 */
export const COMPLETED_AT_PRECISION_MS = 1000;

/**
 * 관리자 편집 저장('session.update', origin 'staff')이 마지막 완료 이후에 있었는가(= 기존 PDF가 편집 전 상태).
 *
 * - 관리자 편집 기록이 없으면 false, 한 번도 완료되지 않았으면(completedAt null) true.
 * - 마지막 완료 감사 행(ms 정밀도)이 completedAt ±1초 안에 있으면 현재 완료 이벤트로 보고 그 시각과 비교한다.
 *   편집기의 update → complete 순서(같은 초 안)에서도 update 행 < 완료 행이므로 stale 이 아니다.
 * - 완료 감사 행이 없거나(고객·파트너 키 완료) 현재 완료와 맞지 않으면 completedAt + 1초 이상일 때만 stale.
 *   (초 단위 절삭·반올림으로 인한 오탐 방지. 완료 직후 1초 미만의 추가 편집은 이 경로에서 잡히지 않는다.)
 */
export function isStaffEditAfterCompletion(
  lastStaffUpdate: Date | null,
  completedAt: Date | null,
  lastCompletionAudit: Date | null,
): boolean {
  if (lastStaffUpdate === null) return false;
  if (completedAt === null) return true;
  const updateMs = lastStaffUpdate.getTime();
  const completedMs = completedAt.getTime();
  if (lastCompletionAudit !== null) {
    const auditMs = lastCompletionAudit.getTime();
    if (
      auditMs >= completedMs - COMPLETED_AT_PRECISION_MS &&
      auditMs <= completedMs + COMPLETED_AT_PRECISION_MS
    ) {
      return updateMs > auditMs;
    }
  }
  return updateMs >= completedMs + COMPLETED_AT_PRECISION_MS;
}

export interface PartnerOperatorAuditListQuery {
  sessionId?: string;
  grantId?: string;
  limit?: number;
  before?: string;
}

export interface PartnerOperatorAuditListItem {
  id: string;
  grantId: string;
  sessionId: string | null;
  operatorId: string;
  operatorName: string | null;
  action: string;
  method: string | null;
  route: string | null;
  statusCode: number | null;
  detail: PartnerOperatorAuditDetail | null;
  createdAt: Date;
}

/** 관리자 감사 조회(GET /admin/edit-data/audit) */
export interface StaffAuditListQuery {
  /** 'all' = 전역 관리자(사이트 무관, NULL-site 포함) */
  siteIds: string[] | 'all';
  siteId?: string;
  sessionId?: string;
  limit?: number;
  before?: string;
}

export interface StaffAuditListItem {
  id: string;
  siteId: string | null;
  sessionId: string | null;
  operatorId: string;
  actorUserId: string | null;
  action: string;
  route: string | null;
  statusCode: number | null;
  detail: PartnerOperatorAuditDetail | null;
  createdAt: Date;
}

export const AUDIT_LIST_DEFAULT_LIMIT = 50;
export const AUDIT_LIST_MAX_LIMIT = 200;

function clip(value: string | null | undefined, max: number): string | null {
  if (value === null || value === undefined) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * 운영자 대리 편집 감사 기록 저장소 (append-only, 2026-09-29).
 *
 * - recordOrThrow  : 상태 변경 전에 호출. 저장 실패 시 503 으로 작업을 중단한다(fail-closed).
 * - recordBestEffort: 요청 단위 기록. 실패해도 응답을 실패시키지 않는다(warn 로그만).
 * 요청 본문·캔버스·토큰·키는 기록하지 않는다.
 */
@Injectable()
export class PartnerOperatorAuditWriter {
  private readonly logger = new Logger(PartnerOperatorAuditWriter.name);

  constructor(
    @InjectRepository(PartnerOperatorAuditLogEntity)
    private readonly auditRepository: Repository<PartnerOperatorAuditLogEntity>,
  ) {}

  private toRow(entry: PartnerOperatorAuditEntry): PartnerOperatorAuditLogEntity {
    const row = new PartnerOperatorAuditLogEntity();
    row.id = randomUUID();
    row.grantId = entry.grantId ?? null;
    row.origin = entry.origin ?? 'partner';
    row.actorUserId = entry.actorUserId ?? null;
    row.siteId = entry.siteId ?? null;
    row.sessionId = entry.sessionId ?? null;
    row.operatorId = entry.operatorId;
    row.operatorName = clip(entry.operatorName, OPERATOR_NAME_MAX);
    row.action = clip(entry.action, 40) ?? 'request';
    row.method = clip(entry.method, 8);
    row.route = clip(entry.route, 200);
    row.statusCode = typeof entry.statusCode === 'number' ? entry.statusCode : null;
    row.detail = entry.detail ?? null;
    return row;
  }

  async recordOrThrow(entry: PartnerOperatorAuditEntry): Promise<void> {
    try {
      await this.auditRepository.insert(this.toRow(entry));
    } catch (e) {
      this.logger.error(
        `[partner-operator] 감사 기록 실패(작업 중단) action=${entry.action} site=${entry.siteId} grant=${entry.grantId}: ${(e as Error)?.message}`,
      );
      throw new ServiceUnavailableException({
        code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE',
        message: '감사 기록을 저장할 수 없어 작업을 중단했습니다.',
      });
    }
  }

  async recordBestEffort(entry: PartnerOperatorAuditEntry): Promise<void> {
    try {
      await this.auditRepository.insert(this.toRow(entry));
    } catch (e) {
      this.logger.warn(
        `[partner-operator] 요청 감사 기록 실패(무시) action=${entry.action} site=${entry.siteId} grant=${entry.grantId}: ${(e as Error)?.message}`,
      );
    }
  }

  /** 호출 사이트의 파트너 발급 권한 기록만(origin 'partner'), 최신순 — 관리자 작업 행은 파트너에게 보이지 않는다 */
  async list(
    siteId: string,
    query: PartnerOperatorAuditListQuery = {},
  ): Promise<PartnerOperatorAuditListItem[]> {
    const where: FindOptionsWhere<PartnerOperatorAuditLogEntity> = { siteId, origin: 'partner' };
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.grantId) where.grantId = query.grantId;
    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) where.createdAt = LessThan(before);
    }
    const requested = Number(query.limit ?? AUDIT_LIST_DEFAULT_LIMIT);
    const take = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), AUDIT_LIST_MAX_LIMIT)
      : AUDIT_LIST_DEFAULT_LIMIT;

    const rows = await this.auditRepository.find({
      where,
      select: [
        'id',
        'grantId',
        'sessionId',
        'operatorId',
        'operatorName',
        'action',
        'method',
        'route',
        'statusCode',
        'detail',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
      take,
    });
    return rows.map((r) => ({
      id: r.id,
      // origin 'partner' 행은 항상 grant_id 가 있다(발급·요청·상태 변경 모두 권한 단위 기록).
      grantId: r.grantId ?? '',
      sessionId: r.sessionId,
      operatorId: r.operatorId,
      operatorName: r.operatorName,
      action: r.action,
      method: r.method,
      route: r.route,
      statusCode: r.statusCode,
      detail: r.detail,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 세션별 마지막 관리자 편집 저장 시각(origin 'staff', action 'session.update') — 목록 '편집 후 미완료' 표시용 1회 조회.
   */
  async latestStaffUpdateBySession(sessionIds: string[]): Promise<Map<string, Date>> {
    const out = new Map<string, Date>();
    const ids = Array.from(new Set(sessionIds.filter((v) => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return out;
    const rows = await this.auditRepository
      .createQueryBuilder('a')
      .select('a.sessionId', 'sessionId')
      .addSelect('MAX(a.createdAt)', 'lastAt')
      .where('a.origin = :origin', { origin: 'staff' })
      .andWhere('a.action = :action', { action: 'session.update' })
      .andWhere('a.sessionId IN (:...ids)', { ids })
      .groupBy('a.sessionId')
      .getRawMany<{ sessionId: string | null; lastAt: Date | string | null }>();
    return toLastAtMap(rows);
  }

  /**
   * 세션별 마지막 완료 감사 시각(SESSION_COMPLETION_AUDIT_ACTIONS, origin 무관) — completed_at 초 단위 비교 보정용.
   */
  async latestCompletionAuditBySession(sessionIds: string[]): Promise<Map<string, Date>> {
    const ids = Array.from(new Set(sessionIds.filter((v) => typeof v === 'string' && v.length > 0)));
    if (ids.length === 0) return new Map<string, Date>();
    const rows = await this.auditRepository
      .createQueryBuilder('a')
      .select('a.sessionId', 'sessionId')
      .addSelect('MAX(a.createdAt)', 'lastAt')
      .where('a.action IN (:...actions)', { actions: [...SESSION_COMPLETION_AUDIT_ACTIONS] })
      .andWhere('a.sessionId IN (:...ids)', { ids })
      .groupBy('a.sessionId')
      .getRawMany<{ sessionId: string | null; lastAt: Date | string | null }>();
    return toLastAtMap(rows);
  }

  /**
   * 권한 행의 출처·발급자 조회(평면 스탬프 사용자용 — @Public 라우트의 운영자 요청 기록).
   * 행이 없으면 null. 조회 오류는 호출부로 전달한다.
   */
  async resolveGrantOrigin(
    grantId: string,
  ): Promise<{ origin: PartnerOperatorOrigin; issuedByUserId: string | null } | null> {
    const rows: Array<{ origin?: unknown; issuedByUserId?: unknown }> =
      await this.auditRepository.manager.query(
        'SELECT origin AS origin, issued_by_user_id AS issuedByUserId FROM partner_operator_grants WHERE id = ? LIMIT 1',
        [grantId],
      );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    const staff = row.origin === 'staff';
    return {
      origin: staff ? 'staff' : 'partner',
      issuedByUserId: staff && typeof row.issuedByUserId === 'string' ? row.issuedByUserId : null,
    };
  }

  private clampLimit(limit: number | undefined): number {
    const requested = Number(limit ?? AUDIT_LIST_DEFAULT_LIMIT);
    return Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), AUDIT_LIST_MAX_LIMIT)
      : AUDIT_LIST_DEFAULT_LIMIT;
  }

  /**
   * 관리자 감사 조회 — origin 'staff' 행만, 최신순. 사이트 범위 밖 행은 조회하지 않는다.
   * siteIds 가 배열이면 그 사이트 행만(빈 배열 = 결과 없음), 'all' 이면 전 사이트 + NULL-site.
   */
  async listStaff(query: StaffAuditListQuery): Promise<StaffAuditListItem[]> {
    const where: FindOptionsWhere<PartnerOperatorAuditLogEntity> = { origin: 'staff' };
    if (query.siteIds !== 'all') {
      const allowed = query.siteIds.filter((s) => typeof s === 'string' && s.length > 0);
      if (query.siteId) {
        if (!allowed.includes(query.siteId)) return [];
        where.siteId = query.siteId;
      } else {
        if (allowed.length === 0) return [];
        where.siteId = In(allowed);
      }
    } else if (query.siteId) {
      where.siteId = query.siteId;
    }
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.before) {
      const before = new Date(query.before);
      if (!Number.isNaN(before.getTime())) where.createdAt = LessThan(before);
    }
    const rows = await this.auditRepository.find({
      where,
      select: [
        'id',
        'siteId',
        'sessionId',
        'operatorId',
        'actorUserId',
        'action',
        'route',
        'statusCode',
        'detail',
        'createdAt',
      ],
      order: { createdAt: 'DESC' },
      take: this.clampLimit(query.limit),
    });
    return rows.map((r) => ({
      id: r.id,
      siteId: r.siteId,
      sessionId: r.sessionId,
      operatorId: r.operatorId,
      actorUserId: r.actorUserId,
      action: r.action,
      route: r.route,
      statusCode: r.statusCode,
      detail: r.detail,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 관리자가 편집기에서 세션 내용을 바꾼 기록(origin 'staff', action 'session.update')이
   * 완료(after = session.completedAt, 초 단위) 이후에 있는가. after 가 null 이면(한 번도 완료되지 않음)
   * 기록이 하나라도 있으면 true. 정밀도 차이 보정 규칙은 isStaffEditAfterCompletion 참조.
   */
  async hasStaffUpdateAfter(sessionId: string, after: Date | null): Promise<boolean> {
    const lastUpdate = (await this.latestStaffUpdateBySession([sessionId])).get(sessionId) ?? null;
    if (lastUpdate === null) return false;
    if (after === null) return true;
    const lastCompletion =
      (await this.latestCompletionAuditBySession([sessionId])).get(sessionId) ?? null;
    return isStaffEditAfterCompletion(lastUpdate, after, lastCompletion);
  }
}

function toLastAtMap(
  rows: Array<{ sessionId: string | null; lastAt: Date | string | null }>,
): Map<string, Date> {
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (typeof r.sessionId !== 'string' || r.lastAt === null || r.lastAt === undefined) continue;
    const d = r.lastAt instanceof Date ? r.lastAt : new Date(r.lastAt);
    if (!Number.isNaN(d.getTime())) out.set(r.sessionId, d);
  }
  return out;
}
