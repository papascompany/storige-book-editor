/**
 * `@storige/sdk/webhook` — 웹훅 **수신**측 도구(서명 검증·멱등·어댑터).
 *
 * 발신은 서버 소관이다. 이 서브패스는 파트너가 웹훅을 안전하게 **받는** 데
 * 필요한 것만 제공한다.
 *
 * ## 먼저 알아야 할 2가지 (일반 웹훅 SDK 와 다르다)
 *  ① **raw body 가 필요 없다.** 서명 data 가 body 해시가 아니라 파싱된 필드
 *     조립이라, `express.json()` 같은 일반 파서와 그대로 공존한다.
 *  ② **본문은 서명되지 않는다.** 서명은 `identifier:event:timestamp` 만 덮는다
 *     → 본문 변조는 탐지 불가. 부수효과는 identifier 로 재조회해서 결정하라.
 *     상세는 {@link verifyWebhookSignature} 모듈 JSDoc(signature.ts 상단) 필독.
 *
 * ## 런타임
 * **Node 전용**(node:crypto 사용). npm 런타임 의존성은 0.
 */

// ── 서명 검증 ───────────────────────────────────────────────────────────
export { verifyWebhookSignature } from './signature';
export {
  DEFAULT_SIGNATURE_TOLERANCE_SEC,
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_HMAC_SIGNATURE_HEADER,
  WEBHOOK_LEGACY_SIGNATURE_HEADER,
  WEBHOOK_RETRY_HEADER,
} from './signature';
export type {
  VerifyWebhookSignatureOptions,
  WebhookHeaders,
  WebhookIdentifierStrategy,
  WebhookVerifyFailure,
  WebhookVerifyFailureReason,
  WebhookVerifyResult,
  WebhookVerifySuccess,
} from './signature';

// ── 이벤트 카탈로그·페이로드 ────────────────────────────────────────────
export {
  isSubscribableEvent,
  WEBHOOK_SUBSCRIBABLE_EVENTS,
  WEBHOOK_TEST_EVENT,
} from './events';
export type {
  BookFinalizationWebhookPayload,
  SessionWebhookPayload,
  StorigeWebhookPayload,
  SynthesisWebhookPayload,
  ValidationWebhookPayload,
  WebhookEvent,
  WebhookOutputFile,
  WebhookPayloadBase,
  WebhookSubscribableEvent,
  WebhookTestPayload,
} from './events';

// ── 멱등(중복 배달 단락) ────────────────────────────────────────────────
export { InMemoryWebhookDeduper } from './dedupe';
export type { InMemoryWebhookDeduperOptions, WebhookDeduper } from './dedupe';

// ── 프레임워크 어댑터 ───────────────────────────────────────────────────
export { createExpressWebhookHandler } from './adapters/express';
export type { ExpressLikeRequest, ExpressLikeResponse } from './adapters/express';
export { createNextWebhookRoute } from './adapters/next';
/** 프레임워크 없이 직접 파이프라인을 쓰고 싶을 때 */
export { processWebhookRequest } from './adapters/core';
export type {
  WebhookHandler,
  WebhookHandlerContext,
  WebhookHandlerOptions,
  WebhookProcessOutcome,
} from './adapters/core';
