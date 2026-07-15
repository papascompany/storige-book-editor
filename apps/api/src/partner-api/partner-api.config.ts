import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PARTNER_API_CONFIG } from './partner-api.constants';

/**
 * Partner API v1 설정 (env 중앙화 — 이 모듈에서만 파싱·검증).
 *
 * 설계서 §5.2 초기값:
 *  - general: per API Key 300 req/min
 *  - heavy(업로드/최종화 계열): per API Key 100 req/min
 *  - 멱등 캐시 TTL 24h (§4.1)
 *
 * env 로 조정 가능(운영 데이터 기반 튜닝) — 잘못된 값(비수치/0 이하)은 기본값 폴백.
 */
export interface PartnerApiRateLimitConfig {
  /** 분당 허용 요청 수 (per API Key) */
  limitPerMin: number;
}

export interface PartnerApiConfig {
  rateLimit: {
    general: PartnerApiRateLimitConfig;
    heavy: PartnerApiRateLimitConfig;
  };
  /** 멱등 캐시 TTL (ms) — 기본 24h */
  idempotencyTtlMs: number;
}

function positiveIntFromEnv(
  config: ConfigService,
  key: string,
  defaultValue: number,
): number {
  const raw = config.get<string>(key);
  if (raw === undefined || raw === null || raw === '') return defaultValue;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
}

export function buildPartnerApiConfig(config: ConfigService): PartnerApiConfig {
  return {
    rateLimit: {
      general: {
        limitPerMin: positiveIntFromEnv(
          config,
          'PARTNER_API_RATE_LIMIT_GENERAL_PER_MIN',
          300,
        ),
      },
      heavy: {
        limitPerMin: positiveIntFromEnv(
          config,
          'PARTNER_API_RATE_LIMIT_HEAVY_PER_MIN',
          100,
        ),
      },
    },
    idempotencyTtlMs:
      positiveIntFromEnv(config, 'PARTNER_API_IDEMPOTENCY_TTL_HOURS', 24) *
      60 *
      60 *
      1000,
  };
}

/** PartnerApiModule providers 등록용 팩토리 프로바이더 */
export const partnerApiConfigProvider: Provider = {
  provide: PARTNER_API_CONFIG,
  useFactory: buildPartnerApiConfig,
  inject: [ConfigService],
};
