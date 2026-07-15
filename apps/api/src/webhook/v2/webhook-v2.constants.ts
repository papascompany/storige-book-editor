/**
 * 웹훅 v2 (Stage 2 작업 5 — 신규 파트너 전용 opt-in) 상수.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.5·§2.7·§2.8
 *
 * ⚠️ 절대 불변: 기존 v1(base64) 발신 경로는 webhook_configs 행이 **없는** 사이트에
 * 대해 바이트/헤더/타이밍 그대로 보존된다. v2 는 config 행이 있는 사이트만 opt-in.
 * 기존 파트너의 v2 전환은 D-7c 게이트(수신부 실물 대조) 선행 — 코드가 전환을
 * 강제하는 경로는 없다.
 */

/** v2 전용 Bull 큐 이름 — 기존 3큐(pdf-validation/conversion/synthesis) 무접촉 */
export const WEBHOOK_DELIVERY_QUEUE = 'webhook-delivery';

/** 커스텀 backoff 전략 키 (BullModule.registerQueue settings.backoffStrategies) */
export const WEBHOOK_DELIVERY_BACKOFF = 'webhook-delivery-backoff';

/** 웹훅 v2 설정 주입 토큰 (env 중앙화 — webhook-v2.config.ts 참조) */
export const WEBHOOK_V2_CONFIG = Symbol('WEBHOOK_V2_CONFIG');

/** delivery uid prefix — X-Storige-Delivery 헤더값 (설계서 §2.8 'whd_...') */
export const WEBHOOK_DELIVERY_UID_PREFIX = 'whd_';

/** 파트너에게 발급되는 서명 secret prefix (발급/회전 응답 1회만 노출) */
export const WEBHOOK_SECRET_TOKEN_PREFIX = 'whsec_';

/** 표시용 마스킹 prefix 길이 (webhook_configs.secret_prefix VARCHAR(12)) */
export const WEBHOOK_SECRET_PREFIX_LEN = 12;

/**
 * 재시도 백오프 스케줄(ms) — 1분/5분/30분, 최대 3회(설계서 §1.5 상태 흐름).
 * [0] 최초 실패→재시도1 지연, [1] 재시도1 실패→재시도2, [2] 재시도2 실패→재시도3.
 */
export const WEBHOOK_RETRY_DELAYS_MS: readonly number[] = [
  60_000,
  300_000,
  1_800_000,
];

/** 큐 재시도 횟수 — 인라인 최초 발송 1회 + 큐 재시도 3회 = 총 4회 시도 */
export const WEBHOOK_MAX_QUEUE_RETRIES = 3;

/**
 * [P1-2] 수동 재발송 stale 판정 유예(ms) — PENDING/RETRYING 인데 예정 재시도
 * 시각(nextRetryAt, 없으면 createdAt)에서 이 시간 이상 경과하면 재시도 체인이
 * 죽은 것(인큐 실패/프로세스 중단/Redis 유실)으로 보고 수동 retry 재진입을 허용.
 * 진행 중인 정상 체인(미경과)은 여전히 409.
 */
export const WEBHOOK_MANUAL_RETRY_STALE_MS = 600_000;

/** 발송 HTTP 타임아웃(ms) — 기존 v1 발신과 동일값(계약 §1.5 승계) */
export const WEBHOOK_DELIVERY_TIMEOUT_MS = 10_000;

/** webhook_deliveries.last_response 절삭 저장 상한(바이트 아님 — JS 문자 기준) */
export const WEBHOOK_RESPONSE_SNIPPET_MAX = 2_000;

/**
 * 구독 가능 이벤트 카탈로그 — 기존 발신 7종 승계(설계서 §1.5).
 * Stage 3 의 book.finalization.* 은 additive 추가 예정.
 * `webhook.test` 는 POST /api/v1/webhooks/test 전용 — 구독 목록과 무관하게 발송.
 */
export const WEBHOOK_V2_SUBSCRIBABLE_EVENTS = [
  'validation.completed',
  'validation.fixable',
  'validation.failed',
  'synthesis.completed',
  'synthesis.failed',
  'session.validated',
  'session.failed',
] as const;

export type WebhookV2SubscribableEvent =
  (typeof WEBHOOK_V2_SUBSCRIBABLE_EVENTS)[number];

/** 테스트 발송 이벤트명 (isTest=true, 구독 필터 미적용) */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

export type WebhookConfigStatus = 'active' | 'disabled';

export type WebhookDeliveryStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'RETRYING'
  | 'EXHAUSTED';
