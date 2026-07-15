import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PartnerApiKeysService } from './partner-api-keys.service';

/**
 * grace 만료 배치 (로드맵 §6 Stage 2 작업 4 — Stage 1 멱등 sweeper 패턴 준용).
 *
 * 회전 유예(72h)가 지난 grace 키를 revoked 로 승격한다.
 * 보안 판정 자체는 검증 시점(findValidByPlaintextKey)이 grace_until 을 직접
 * 검사하므로 이 배치는 상태 위생(목록 표기·감사 정합)용 — 지연돼도 차단 공백 없음.
 */
@Injectable()
export class PartnerApiKeysSweeper {
  private readonly logger = new Logger(PartnerApiKeysSweeper.name);

  constructor(private readonly partnerApiKeysService: PartnerApiKeysService) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async sweepExpiredGrace(): Promise<void> {
    try {
      const affected = await this.partnerApiKeysService.expireGraceKeys();
      if (affected > 0) {
        this.logger.log(`grace 만료 파트너 키 ${affected}건 revoked 승격`);
      }
    } catch (err) {
      this.logger.warn(
        `파트너 키 grace sweep 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
