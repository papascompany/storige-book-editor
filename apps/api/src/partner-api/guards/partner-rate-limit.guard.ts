import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';
import {
  PARTNER_API_CONFIG,
  PARTNER_RATE_BUCKET_KEY,
  PartnerRateBucket,
} from '../partner-api.constants';
import { PartnerApiConfig } from '../partner-api.config';
import { PartnerRateLimitedException } from '../http/partner-api.exceptions';
import { PartnerRequest, resolvePartnerEnv } from '../http/request-context';

/**
 * per-API-Key 레이트리밋 (설계서 §5.2) — ThrottlerGuard 커스텀.
 *
 * - 트래커 = `siteId:env:keyFingerprint`(키 원문 미사용 — SHA-256 앞 16자).
 *   env 는 인증 컨텍스트(Stage 2 — test/live 카운터 분리, sites 키는 live).
 * - 버킷: general 300/min · heavy(업로드/최종화) 100/min — env 로 조정
 *   (PARTNER_API_RATE_LIMIT_*_PER_MIN, partner-api.config.ts 중앙 파싱).
 * - 기존 전역 per-IP ThrottlerGuard(APP_GUARD)는 무수정 병존 — 이 가드는
 *   v1 스코프에만 바인딩되는 추가 레이어(스토리지 키 분리로 비간섭).
 * - 초과 시 429 ERR_RATE_LIMITED 봉투 + Retry-After(초) 헤더(필터가 부착).
 * - 가드 순서 전제: PartnerApiKeyGuard 뒤(req.user 필요).
 */
@Injectable()
export class PartnerRateLimitGuard extends ThrottlerGuard {
  @Inject(PARTNER_API_CONFIG)
  private readonly partnerConfig!: PartnerApiConfig;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { req } = this.getRequestResponse(context);
    const bucket =
      this.reflector.getAllAndOverride<PartnerRateBucket | undefined>(
        PARTNER_RATE_BUCKET_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'general';

    const limit = this.partnerConfig.rateLimit[bucket].limitPerMin;
    const ttlMs = 60_000; // 60초 윈도우 (한도 표기 단위: req/min)

    const tracker = this.buildTracker(req as PartnerRequest);
    const storageKey = `partner-v1:${bucket}:${tracker}`;

    const record = await this.storageService.increment(
      storageKey,
      ttlMs,
      limit,
      ttlMs, // blockDuration = 윈도우와 동일(윈도우 만료 시 해제)
      `partner-v1-${bucket}`,
    );

    if (record.totalHits > limit) {
      const retryAfterSeconds = Math.max(
        1,
        record.isBlocked && record.timeToBlockExpire > 0
          ? record.timeToBlockExpire
          : record.timeToExpire,
      );
      throw new PartnerRateLimitedException(retryAfterSeconds);
    }
    return true;
  }

  /** 키 단위 식별자 — siteId:env:keyFingerprint (설계서 §5.2, 키 원문 비저장) */
  private buildTracker(req: PartnerRequest): string {
    const user = req.user;
    if (user?.siteId && user.apiKey) {
      const fingerprint = createHash('sha256')
        .update(user.apiKey)
        .digest('hex')
        .slice(0, 16);
      return `${user.siteId}:${resolvePartnerEnv(user)}:${fingerprint}`;
    }
    // 방어적 폴백 — v1 은 인증 가드 뒤라 정상 경로에선 도달하지 않음
    return `ip:${req.ip ?? 'unknown'}`;
  }
}
