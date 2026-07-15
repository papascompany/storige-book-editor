import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PartnerIdempotencyKey } from '../entities/partner-idempotency-key.entity';

/**
 * 멱등 캐시 TTL sweep (설계서 §4.1 — 24h TTL, 일 1회 sweep cron).
 *
 * expires_at 인덱스(idx_idem_expires) 기반 만료 행 일괄 삭제.
 * claim 경로도 만료 행을 지연 삭제하므로 sweep 은 잔여물 정리용.
 */
@Injectable()
export class PartnerIdempotencySweeper {
  private readonly logger = new Logger(PartnerIdempotencySweeper.name);

  constructor(
    @InjectRepository(PartnerIdempotencyKey)
    private readonly idempotencyRepository: Repository<PartnerIdempotencyKey>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweepExpired(): Promise<void> {
    try {
      const result = await this.idempotencyRepository.delete({
        expiresAt: LessThan(new Date()),
      });
      if (result.affected) {
        this.logger.log(`만료 멱등 키 ${result.affected}건 정리`);
      }
    } catch (err) {
      this.logger.warn(
        `멱등 키 sweep 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
