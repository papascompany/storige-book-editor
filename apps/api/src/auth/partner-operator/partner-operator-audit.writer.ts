import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, LessThan, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  PartnerOperatorAuditDetail,
  PartnerOperatorAuditLogEntity,
} from '../entities/partner-operator-audit-log.entity';
import { OPERATOR_NAME_MAX } from './partner-operator.types';

export interface PartnerOperatorAuditEntry {
  grantId: string;
  siteId: string;
  sessionId?: string | null;
  operatorId: string;
  operatorName?: string | null;
  action: string;
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
  detail?: PartnerOperatorAuditDetail | null;
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
    row.grantId = entry.grantId;
    row.siteId = entry.siteId;
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

  /** 호출 사이트의 기록만, 최신순 */
  async list(
    siteId: string,
    query: PartnerOperatorAuditListQuery = {},
  ): Promise<PartnerOperatorAuditListItem[]> {
    const where: FindOptionsWhere<PartnerOperatorAuditLogEntity> = { siteId };
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
      grantId: r.grantId,
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
}
