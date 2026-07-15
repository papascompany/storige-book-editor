import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PublicApiAuditLog } from '../entities/public-api-audit-log.entity';

export interface PartnerAuditRecord {
  requestId: string;
  siteId: string | null;
  env: 'test' | 'live' | null;
  method: string;
  path: string;
  statusCode: number;
  errorCode: string | null;
  latencyMs: number;
  ip: string | null;
}

/**
 * v1 호출 감사 기록기 (설계서 §2.9).
 *
 * fire-and-forget: 감사 기록 실패가 파트너 응답을 지연/실패시키지 않는다.
 * (본문/헤더/키 값은 기록하지 않음 — 시크릿 로그 금지 규약)
 */
@Injectable()
export class PartnerAuditService {
  private readonly logger = new Logger(PartnerAuditService.name);

  constructor(
    @InjectRepository(PublicApiAuditLog)
    private readonly auditRepository: Repository<PublicApiAuditLog>,
  ) {}

  record(entry: PartnerAuditRecord): void {
    void this.auditRepository
      .insert({
        id: randomUUID(),
        requestId: entry.requestId,
        siteId: entry.siteId,
        env: entry.env,
        apiKeyId: null, // Stage 2(partner_api_keys) 이후 채움
        method: entry.method.slice(0, 8),
        path: entry.path.slice(0, 300),
        statusCode: entry.statusCode,
        errorCode: entry.errorCode ? entry.errorCode.slice(0, 60) : null,
        latencyMs: Math.max(0, Math.round(entry.latencyMs)),
        ip: entry.ip ? entry.ip.slice(0, 64) : null,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `v1 감사 로그 기록 실패 (requestId=${entry.requestId}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
  }
}
