import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { PartnerIdempotencyKey } from '../entities/partner-idempotency-key.entity';
import { PARTNER_API_CONFIG, PartnerEnv } from '../partner-api.constants';
import { PartnerApiConfig } from '../partner-api.config';

export interface IdempotencyScope {
  siteId: string;
  env: PartnerEnv;
  method: string;
  path: string;
  key: string;
}

export type IdempotencyClaim =
  | { kind: 'claimed'; id: string }
  | { kind: 'replay'; statusCode: number; body: unknown }
  | { kind: 'mismatch' }
  | { kind: 'in_progress' };

/** MariaDB unique 위반 판별 (ER_DUP_ENTRY / errno 1062) */
function isDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; errno?: number; driverError?: { code?: string; errno?: number } };
  return (
    e.code === 'ER_DUP_ENTRY' ||
    e.errno === 1062 ||
    e.driverError?.code === 'ER_DUP_ENTRY' ||
    e.driverError?.errno === 1062
  );
}

/**
 * 멱등 캐시 저장소 (설계서 §4).
 *
 * 선점은 `INSERT`(uq_idem_scope UNIQUE) 원자 연산 — 동시 요청·Bull 재시도
 * 경쟁 조건에서 이중 실행을 차단한다(기존 합성 멱등가드 완료마커 설계 교훈 승계).
 */
@Injectable()
export class PartnerIdempotencyService {
  constructor(
    @InjectRepository(PartnerIdempotencyKey)
    private readonly idempotencyRepository: Repository<PartnerIdempotencyKey>,
    @Inject(PARTNER_API_CONFIG)
    private readonly config: PartnerApiConfig,
  ) {}

  /**
   * scope 선점 시도.
   * - 신규 → claimed (핸들러 실행)
   * - 기존 completed + 동일 hash → replay (최초 응답 재전달)
   * - 기존 + 다른 hash → mismatch (422)
   * - 기존 in_progress + 동일 hash → in_progress (409)
   * - 만료 행 → 삭제 후 재선점
   */
  async claim(scope: IdempotencyScope, requestHash: string): Promise<IdempotencyClaim> {
    // 만료 행 삭제 → 재선점의 1회 재시도 루프 (삭제 경합 시 안전측 in_progress)
    for (let attempt = 0; attempt < 2; attempt++) {
      const id = randomUUID();
      try {
        await this.idempotencyRepository.insert({
          id,
          siteId: scope.siteId,
          env: scope.env,
          method: scope.method.slice(0, 8),
          path: scope.path,
          idempotencyKey: scope.key,
          requestHash,
          status: 'in_progress',
          responseStatus: null,
          responseSnapshot: null,
          expiresAt: new Date(Date.now() + this.config.idempotencyTtlMs),
        });
        return { kind: 'claimed', id };
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;

        const existing = await this.idempotencyRepository.findOne({
          where: {
            siteId: scope.siteId,
            env: scope.env,
            method: scope.method.slice(0, 8),
            path: scope.path,
            idempotencyKey: scope.key,
          },
        });
        if (!existing) continue; // 경합 삭제 — 재선점 시도

        if (existing.expiresAt.getTime() <= Date.now()) {
          // TTL 만료 — 신규 요청으로 처리 (설계서 §4.1: 만료 후 신규 처리)
          await this.idempotencyRepository.delete({ id: existing.id });
          continue;
        }

        if (existing.requestHash !== requestHash) {
          return { kind: 'mismatch' };
        }
        if (existing.status === 'completed' && existing.responseStatus !== null) {
          return {
            kind: 'replay',
            statusCode: existing.responseStatus,
            body: existing.responseSnapshot !== null
              ? (JSON.parse(existing.responseSnapshot) as unknown)
              : null,
          };
        }
        return { kind: 'in_progress' };
      }
    }
    return { kind: 'in_progress' };
  }

  /** 응답 스냅샷 고정 — 2xx·결정적 4xx 만 호출된다 */
  async complete(id: string, statusCode: number, body: unknown): Promise<void> {
    await this.idempotencyRepository.update(
      { id },
      {
        status: 'completed',
        responseStatus: statusCode,
        responseSnapshot: JSON.stringify(body ?? null),
      },
    );
  }

  /** 5xx — 스냅샷 저장 없이 선점 해제(재시도 가능 유지, 설계서 §4.2) */
  async release(id: string): Promise<void> {
    await this.idempotencyRepository.delete({ id });
  }
}
