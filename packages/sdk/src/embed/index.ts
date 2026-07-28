/**
 * `@storige/sdk/embed` — 임베드 편집기(iframe) 호스트측 도구.
 *
 * **브라우저 전용**(DOM·postMessage 사용). npm 런타임 의존성은 여전히 0 이다.
 *
 * ## 이 서브패스가 존재하는 이유
 * 임베드 연동의 실패는 대부분 계약을 몰라서가 아니라 **한 줄을 빠뜨려서** 난다:
 * `parentOrigin` 을 안 넣어 레거시 와일드카드로 세션 식별자가 새고, `event.source`
 * 대조를 빠뜨려 같은 오리진의 다른 프레임이 메시지를 밀어 넣고, 세 명령을 일괄
 * Promise 로 감싸 `setBackGuard` 만 영원히 pending 되고, `needsAuth` 를 확인하지 않아
 * 게스트 세션에 주문을 태운다. 이 모듈은 **그 실수들이 구조적으로 불가능하도록** 짜여 있다.
 *
 * | 함정 | SDK 의 처리 |
 * |---|---|
 * | `parentOrigin` 누락 → 와일드카드 폴백 | 필수 인자 + `'*'` 거부 → `StorigeUsageError` |
 * | `event.source` 대조 누락(fail-open) | `mountEditor` 가 iframe 을 소유해 **넘길 여지 자체가 없다**. 저수준 `parseEditorMessage` 는 `expectedSource` 필수(생략 시 throw) |
 * | 명령 3종 일괄 Promise 화 | 응답 유형별 타입 분리 — `setBackGuard(on): void` |
 * | 타임아웃을 실패로 오판 | `EditorCommandUnsupportedError`(미지원) ↔ `EditorNotReadyError` ↔ `EditorCommandFailedError` 3분 |
 * | 미지 이벤트에서 크래시 | 조용히 무시(관찰은 `unknownEvent`) |
 * | `guestToken` 로깅 유출 | 콜백은 `hasGuestToken` 불리언만. 값은 `consumeGuestToken()` 1회성 소비 |
 * | complete/needAuth 이중 처리 | SDK 가 `guestToken` 키로 dedup (`sessionId` 는 needAuth 에 없어 키가 못 된다) |
 *
 * 계약 정본: `docs/CONTRACT_FREEZE.md` §1-D · §1-D-1 / `docs/PLATFORM_INTEGRATION_GUIDE.md` §3.
 */

// ── 계약 상수·타입 ──────────────────────────────────────────────────────
export {
  EDITOR_ADDITIVE_EVENTS,
  EDITOR_EVENTS,
  EDITOR_FROZEN_EVENTS,
  EDITOR_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  HOST_COMMAND_RESPONSE_KIND,
  HOST_COMMANDS,
  HOST_MESSAGE_SOURCE,
  isKnownEditorEvent,
} from './protocol';
export type {
  CompleteAction,
  EditorAdditiveEvent,
  EditorCancelPayload,
  EditorCompleteFiles,
  EditorCompletePages,
  EditorCompletePayload,
  EditorCompleteSize,
  EditorEnvelope,
  EditorErrorCode,
  EditorErrorPayload,
  EditorEvent,
  EditorFrozenEvent,
  EditorNeedAuthPayload,
  EditorPricingChangePayload,
  EditorPricingMeta,
  EditorReadyPayload,
  EditorSavePayload,
  EditorState,
  GuestAuthRequired,
  HostCommand,
  HostCommandEnvelope,
  HostCommandResponseKind,
} from './protocol';

// ── 저수준 수신 게이트(직접 iframe 을 관리하는 호스트용) ─────────────────
export {
  decideCompleteAction,
  parseEditorMessage,
  readCompletePayload,
  SKIP_SOURCE_CHECK,
} from './parse';
export type {
  EditorMessageLike,
  EditorMessageRejectReason,
  ParseEditorMessageOptions,
  ParseEditorMessageResult,
} from './parse';
// 주의: `extractGuestToken` 은 의도적으로 재수출하지 않는다 — 게스트 토큰 값의
// 공개 노출 경로는 `EditorHandle.consumeGuestToken()` 단 하나다.

// ── URL 조립 ────────────────────────────────────────────────────────────
export { buildEmbedUrl, DEFAULT_EMBED_PATH, normalizeOrigin } from './url';
export type { BuildEmbedUrlOptions, EmbedUrlParams } from './url';

// ── 마운트 ──────────────────────────────────────────────────────────────
export {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_READY_TIMEOUT_MS,
  mountEditor,
} from './mount';
export type {
  EditorEventHandlers,
  EditorHandle,
  EmbedIframeAttributes,
  MountEditorOptions,
} from './mount';

// ── 에러 ────────────────────────────────────────────────────────────────
export {
  EditorCommandFailedError,
  EditorCommandUnsupportedError,
  EditorDetachedError,
  EditorNotReadyError,
  isEditorCommandUnsupported,
} from './errors';
