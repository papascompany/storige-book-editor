import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';
import {
  WEBHOOK_SECRET_PREFIX_LEN,
  WEBHOOK_SECRET_TOKEN_PREFIX,
} from './webhook-v2.constants';

/**
 * 웹훅 v2 secret 유틸 — 발급 / at-rest 암호화(AES-256-GCM) / HMAC 서명.
 *
 * 설계서 §2.7: secret 은 서명 계산에 원문이 필요해 해시 보관 불가 →
 * WEBHOOK_CONFIG_ENC_KEY(32바이트)로 at-rest 암호화(secret_enc).
 * 응답 노출은 발급/회전 1회뿐. 원문 secret 은 절대 로그 금지.
 *
 * 서명 형식은 기존 WH-001 발신 정본(CONTRACT_FREEZE §1-E)과 동일:
 *   `t=<unixsec>,v1=<hex>` / data = `${t}.${identifier}:${event}:${timestamp}`
 * — 전역 WEBHOOK_SECRET 대신 사이트별 secret 을 쓰는 것만 다르다.
 */

const ENC_VERSION = 'v1';
const GCM_IV_BYTES = 12;

export interface GeneratedWebhookSecret {
  /** 원문 secret ('whsec_' + 48 hex) — 발급/회전 응답 1회만 노출 */
  secret: string;
  /** 표시용 마스킹 prefix (secret_prefix 컬럼) */
  secretPrefix: string;
}

/** 신규 secret 발급 — whsec_ + 24바이트 hex(48자) */
export function generateWebhookSecret(): GeneratedWebhookSecret {
  const secret = `${WEBHOOK_SECRET_TOKEN_PREFIX}${randomBytes(24).toString('hex')}`;
  return { secret, secretPrefix: secret.slice(0, WEBHOOK_SECRET_PREFIX_LEN) };
}

/** AES-256-GCM 암호화 → `v1:<iv hex>:<tag hex>:<ct hex>` (VARCHAR(256) 내 수용) */
export function encryptWebhookSecret(secret: string, encKey: Buffer): string {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', encKey, iv);
  const ct = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_VERSION,
    iv.toString('hex'),
    tag.toString('hex'),
    ct.toString('hex'),
  ].join(':');
}

/** secret_enc 복호화 — 형식/무결성 불량 시 throw (호출측에서 처리) */
export function decryptWebhookSecret(secretEnc: string, encKey: Buffer): string {
  const parts = secretEnc.split(':');
  if (parts.length !== 4 || parts[0] !== ENC_VERSION) {
    throw new Error('webhook secret_enc 형식 불량');
  }
  const [, ivHex, tagHex, ctHex] = parts;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encKey,
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * v2 HMAC-SHA256 서명 — WH-001 발신 정본 형식 유지(t=,v1=), 사이트별 secret.
 * data = `${t}.${identifier}:${event}:${timestamp}`
 * (identifier = payload.jobId ?? payload.sessionId ?? delivery uid — 테스트 발송용 폴백)
 *
 * @param tUnixSec 서명 시각(unix 초). 재시도마다 새 t 로 재서명 — payload 바이트는 불변.
 */
export function signWebhookV2(
  secret: string,
  identifier: string,
  event: string,
  timestamp: string,
  tUnixSec: number,
): string {
  const data = `${tUnixSec}.${identifier}:${event}:${timestamp}`;
  const v1 = createHmac('sha256', secret).update(data).digest('hex');
  return `t=${tUnixSec},v1=${v1}`;
}
