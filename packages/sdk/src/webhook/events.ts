/**
 * 웹훅 이벤트 카탈로그·페이로드 타입 — 수신측 소비용.
 *
 * 서버 정본:
 *  - 카탈로그: apps/api/src/webhook/v2/webhook-v2.constants.ts
 *      WEBHOOK_V2_SUBSCRIBABLE_EVENTS(9종) / WEBHOOK_TEST_EVENT
 *  - 페이로드: packages/types/src/index.ts
 *      ValidationWebhookPayload / SynthesisWebhookPayload / BookFinalizationWebhookPayload
 *    + apps/api/src/webhook/webhook.service.ts SessionWebhookPayload
 *      (⚠️ 이 한 종만 @storige/types 가 아니라 서비스 파일에 선언돼 있다)
 *
 * 계약 타입을 **자체 재선언**하는 이유는 루트 index.ts 상단 참조(@storige/types 는
 * private:true 내부 모델 2200줄 — 통째 배포 불가). 드리프트는 types-parity 계열
 * 테스트가 구조 등가성으로 감시한다.
 */

// ── 카탈로그 ────────────────────────────────────────────────────────────

/**
 * 구독 가능 이벤트 9종 — 웹훅 config 의 `events` 에 넣을 수 있는 값.
 *
 * ⚠️ **additive-only 성장**(설계서 §3.3): 서버는 추가만 하고 기존 이벤트명
 * 삭제/의미변경을 하지 않는다. 따라서 수신측은 모르는 이벤트를 만나도
 * **크래시하지 말고 무시**해야 한다(향후 추가분 대비).
 */
export const WEBHOOK_SUBSCRIBABLE_EVENTS = [
  'validation.completed',
  'validation.fixable',
  'validation.failed',
  'synthesis.completed',
  'synthesis.failed',
  'session.validated',
  'session.failed',
  'book.finalization.completed',
  'book.finalization.failed',
] as const;

export type WebhookSubscribableEvent = (typeof WEBHOOK_SUBSCRIBABLE_EVENTS)[number];

/**
 * 테스트 발송 전용 이벤트 — POST /api/v1/webhooks/test 가 보낸다.
 * **구독 목록과 무관하게** 발송되므로 events 에 넣을 수 없고, 수신측은
 * 항상 이 이벤트를 받을 각오를 해야 한다.
 */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** 수신 가능한 모든 이벤트 = 구독 9종 + 테스트 1종 */
export type WebhookEvent = WebhookSubscribableEvent | typeof WEBHOOK_TEST_EVENT;

/** 구독 가능 이벤트인지 — 모르는 문자열 방어용(카탈로그 additive 성장 대비) */
export function isSubscribableEvent(event: string): event is WebhookSubscribableEvent {
  return (WEBHOOK_SUBSCRIBABLE_EVENTS as readonly string[]).includes(event);
}

// ── 페이로드 ────────────────────────────────────────────────────────────

/** 모든 페이로드 공통 필드 */
export interface WebhookPayloadBase {
  /**
   * **이벤트 시각**(ISO 8601). 서명 헤더의 `t`(서명 시각)와 다르다 —
   * 재시도 시 t 는 갱신되지만 이 값은 최초 발생 시각 그대로다.
   * ⚠️ 이 값에 신선도 게이트를 걸지 말 것(30분 재시도가 죽는다).
   */
  timestamp: string;
  /**
   * test env 발송 표식 — 서버가 `{...payload, isTest:true}` 로 얹는다
   * (webhook-delivery.service.ts tryDispatchForSite). live 페이로드엔 없다.
   */
  isTest?: boolean;
}

/** 자산 산출물 참조 — separate/spread 모드 합성 결과 */
export interface WebhookOutputFile {
  type: 'cover' | 'content' | 'pages' | 'set';
  url: string;
  pageCount?: number;
  /** duplex-split('set') 전용 — 세트 순번(0-base) */
  setIndex?: number;
}

/** PDF 검증 결과 — `validation.*` */
export interface ValidationWebhookPayload extends WebhookPayloadBase {
  event: 'validation.completed' | 'validation.fixable' | 'validation.failed';
  /** 서명 identifier 1순위 */
  jobId: string;
  /** job.editSessionId 가 있을 때만 */
  sessionId?: string;
  fileType: 'cover' | 'content' | 'post_process';
  /** 파트너 주문번호 echo-back */
  orderSeqno?: number;
  status: 'completed' | 'fixable' | 'failed';
  /** 검증 상세(errors/warnings/metadata) — 서버가 shape 을 고정하지 않는다 */
  result?: unknown;
  errorMessage?: string;
}

/** PDF 합성 결과 — `synthesis.*` */
export interface SynthesisWebhookPayload extends WebhookPayloadBase {
  event: 'synthesis.completed' | 'synthesis.failed';
  /** 서명 identifier 1순위 */
  jobId: string;
  sessionId?: string;
  orderId?: string;
  orderSeqno?: number;
  status: 'completed' | 'failed';
  /** 항상 merged URL — failed 면 빈 문자열 */
  outputFileUrl: string;
  /** separate 모드에서만 (cover→content 순서 보장) */
  outputFiles?: WebhookOutputFile[];
  outputFormat?: 'merged' | 'separate';
  /** Bull 큐 ID — 디버깅용 */
  queueJobId?: string | number;
  errorMessage?: string;
}

/**
 * 편집 세션 검증 결과 — `session.*`.
 *
 * ⚠️ 이 타입만 @storige/types 가 아니라 apps/api/src/webhook/webhook.service.ts
 *    에 선언돼 있다 → 구조 등가성 테스트의 자동 감시 대상이 아니다(수기 대조).
 */
export interface SessionWebhookPayload extends WebhookPayloadBase {
  event: 'session.validated' | 'session.failed';
  /** 서명 identifier 2순위 (jobId 부재 시) */
  sessionId: string;
  orderSeqno: number;
  status: 'validated' | 'failed';
  fileType?: 'cover' | 'content';
  errorMessage?: string;
  result?: unknown;
}

/**
 * 도서 최종화 결과 — `book.finalization.*` (Partner API v1 Stage 3).
 * 폴링(GET /api/v1/books/:uid/finalization)과 병행 — opt-in 사이트만 수신.
 *
 * ⚠️ **서명 identifier 주의**: 이 페이로드엔 jobId/sessionId 가 없다.
 *    - v2 발신(사이트별 secret) → **delivery uid** 로 서명된다
 *    - v1 발신(전역 secret)     → **finalizationUid** 로 서명된다
 *    SDK 기본 `identifierStrategy: 'auto'` 가 헤더로 자동 판별한다.
 */
export interface BookFinalizationWebhookPayload extends WebhookPayloadBase {
  event: 'book.finalization.completed' | 'book.finalization.failed';
  /** 'bk_...' */
  bookUid: string;
  /** 'fin_...' */
  finalizationUid: string;
  status: 'completed' | 'failed';
  /** completed 시 확정 */
  pageCount?: number | null;
  /** 최종 PDF files.id — GET /api/v1/books/:uid/pdf 로 스트림 */
  outputFileId?: string | null;
  /** 실패 시 ERR_* */
  errorCode?: string | null;
  /**
   * 대조 판형 부재(book_spec 미연결 or pageCount 미확정)로 워커 validate 를
   * **건너뛰고** 최종화됐다. true 면 미검증 FINALIZED 이므로 파트너가 자체
   * 게이팅해야 한다.
   */
  validationSkipped?: boolean;
}

/** 테스트 발송 — `webhook.test` (구독 무관) */
export interface WebhookTestPayload extends WebhookPayloadBase {
  event: typeof WEBHOOK_TEST_EVENT;
  /** X-Storige-Delivery 헤더와 동일값 — 서명 identifier 로도 쓰인다 */
  deliveryUid: string;
  isTest: true;
  message: string;
}

/**
 * 수신 가능한 모든 페이로드 — `event` 로 판별하는 discriminated union.
 *
 * @example
 * ```ts
 * function handle(payload: StorigeWebhookPayload) {
 *   switch (payload.event) {
 *     case 'synthesis.completed':
 *       payload.outputFileUrl; // ✅ 좁혀짐
 *       break;
 *     case 'book.finalization.completed':
 *       if (payload.validationSkipped) reviewManually(payload.bookUid);
 *       break;
 *     default:
 *       // 모르는 이벤트는 무시 — 카탈로그는 additive 로 자란다
 *   }
 * }
 * ```
 */
export type StorigeWebhookPayload =
  | ValidationWebhookPayload
  | SynthesisWebhookPayload
  | SessionWebhookPayload
  | BookFinalizationWebhookPayload
  | WebhookTestPayload;
