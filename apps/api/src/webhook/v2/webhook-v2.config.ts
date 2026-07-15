import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WEBHOOK_V2_CONFIG } from './webhook-v2.constants';

/**
 * 웹훅 v2 설정 (env 중앙화 — 이 모듈에서만 파싱·검증).
 *
 * WEBHOOK_CONFIG_ENC_KEY: webhook_configs.secret_enc 의 AES-256-GCM at-rest
 * 암호화 키. **64자 hex(32바이트)** 형식.
 *
 * 미설정/형식 불량 시 v2 기능 전체 비활성(enabled=false) + 부팅 경고 1회 — 무중단:
 *  - 발신: config 조회 자체를 생략 → 기존 v1(base64) 경로 그대로(바이트/타이밍 불변)
 *  - v1 API: config CRUD/test/retry 는 503 ERR_SERVICE_UNAVAILABLE,
 *    deliveries 조회(읽기)는 동작
 *
 * ⚠️ 키 회전 주의: 키를 바꾸면 기존 secret_enc 복호화가 불가 — 회전 시 전체
 * config 의 secret 재발급(파트너 재교부)이 필요하다.
 */
export interface WebhookV2Config {
  /** 암호화 키가 유효하게 주입되어 v2 발신/CRUD 가 가능한 상태인지 */
  enabled: boolean;
  /** AES-256-GCM 32바이트 키 (enabled=false 면 null) */
  encKey: Buffer | null;
}

const HEX_64 = /^[0-9a-fA-F]{64}$/;

export function buildWebhookV2Config(config: ConfigService): WebhookV2Config {
  const logger = new Logger('WebhookV2Config');
  const raw = config.get<string>('WEBHOOK_CONFIG_ENC_KEY');

  if (!raw) {
    // 부팅 경고 1회(팩토리는 부팅 시 1회 실행) — 무중단으로 v2 만 비활성.
    logger.warn(
      '[CFG] WEBHOOK_CONFIG_ENC_KEY 미설정 — 웹훅 v2(사이트별 HMAC secret) 비활성. ' +
        '기존 v1 발신 경로는 영향 없음. 활성화: 64자 hex(32바이트) 키를 .env + compose environment 에 주입.',
    );
    return { enabled: false, encKey: null };
  }

  if (!HEX_64.test(raw.trim())) {
    logger.warn(
      '[CFG] WEBHOOK_CONFIG_ENC_KEY 형식 불량(64자 hex 아님) — 웹훅 v2 비활성(무중단). 키 값은 로그에 남기지 않는다.',
    );
    return { enabled: false, encKey: null };
  }

  return { enabled: true, encKey: Buffer.from(raw.trim(), 'hex') };
}

/** WebhookModule providers 등록용 팩토리 프로바이더 */
export const webhookV2ConfigProvider: Provider = {
  provide: WEBHOOK_V2_CONFIG,
  useFactory: buildWebhookV2Config,
  inject: [ConfigService],
};
