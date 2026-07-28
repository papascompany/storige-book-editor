/**
 * 임베드 postMessage 계약 v1 — 상수·봉투·페이로드 재선언.
 *
 * 정본:
 *  - 편집기 발신부/수신부: `apps/editor/src/embed.tsx`
 *  - 계약 동결 표: `docs/CONTRACT_FREEZE.md` §1-D · **§1-D-1**(호스트→편집기 수신 명령 v1)
 *  - 파트너 문서: `docs/PLATFORM_INTEGRATION_GUIDE.md` §3.2
 *
 * ## 동결 표면을 부풀리지 않는다
 * 편집기 **발신**은 **8종 FROZEN + `editor.pricingChange` 1종 ADDITIVE** 다(9종 아님).
 * `EDITOR_FROZEN_EVENTS` / `EDITOR_ADDITIVE_EVENTS` 로 분리 선언하는 이유가 이것이다 —
 * 합집합 `EDITOR_EVENTS` 는 "수신부가 알아보는 이벤트" 목록일 뿐 동결 범위가 아니다.
 *
 * ## 미지 이벤트는 무시한다
 * 카탈로그는 additive 로만 자란다. 모르는 이벤트에서 던지면 편집기가 이벤트를 하나
 * 추가하는 순간 파트너 통합이 깨진다 — `mountEditor` 는 미지 이벤트를 조용히 흘린다.
 */

/** 편집기 → 호스트 정식 엔벨로프의 `source` 식별자 */
export const EDITOR_MESSAGE_SOURCE = 'storige-editor';

/** 호스트 → 편집기 명령 엔벨로프의 `source` 식별자 */
export const HOST_MESSAGE_SOURCE = 'storige-host';

/** 양방향 엔벨로프의 `version` — **문자열** `'1'` (숫자 1 아님) */
export const EMBED_MESSAGE_VERSION = '1';

/**
 * 편집기 발신 **동결 8종**.
 *
 * `editor.state`/`editor.saved` 는 호스트 명령의 **응답**이라 `mountEditor` 가 내부에서
 * requestId 상관에 소비한다(핸들러로 노출하지 않는다 — 요청-응답 추상화를 지키기 위함).
 */
export const EDITOR_FROZEN_EVENTS = [
  'editor.ready',
  'editor.save',
  'editor.complete',
  'editor.cancel',
  'editor.error',
  'editor.needAuth',
  'editor.state',
  'editor.saved',
] as const;

/**
 * 편집기 발신 **ADDITIVE**(동결 아님) — 2026-07-06 D-3.
 *
 * 조건부 발신이다: 템플릿셋 `pricing` 설정 + 회원 세션 + 초기화 완료 이후에만 온다.
 */
export const EDITOR_ADDITIVE_EVENTS = ['editor.pricingChange'] as const;

/** 수신부가 알아보는 이벤트 전체(동결 8 + additive 1). **동결 범위가 아니다.** */
export const EDITOR_EVENTS = [
  ...EDITOR_FROZEN_EVENTS,
  ...EDITOR_ADDITIVE_EVENTS,
] as const;

export type EditorFrozenEvent = (typeof EDITOR_FROZEN_EVENTS)[number];
export type EditorAdditiveEvent = (typeof EDITOR_ADDITIVE_EVENTS)[number];
export type EditorEvent = EditorFrozenEvent | EditorAdditiveEvent;

/** 값이 알려진 편집기 이벤트명인가 (미지 이벤트 무시 판정용) */
export function isKnownEditorEvent(event: string): event is EditorEvent {
  return (EDITOR_EVENTS as readonly string[]).includes(event);
}

/**
 * 호스트 → 편집기 명령 v1 **3종**(CONTRACT_FREEZE §1-D-1).
 *
 * 확장은 additive 추가만 가능하고, 신규 명령은 **응답 유형을 반드시 명기**한다.
 */
export const HOST_COMMANDS = ['getState', 'saveNow', 'setBackGuard'] as const;
export type HostCommand = (typeof HOST_COMMANDS)[number];

/**
 * 명령별 **응답 유형** — 계약의 일부다.
 *
 * 🚨 3종을 일괄 Promise 로 감싸면 `setBackGuard` 만 **영원히 pending** 된다.
 * SDK 는 그래서 타입 레벨로 분리 노출한다:
 * `getState(): Promise<…>` / `saveNow(): Promise<void>` / `setBackGuard(on): void`.
 */
export const HOST_COMMAND_RESPONSE_KIND = {
  getState: 'request-response',
  saveNow: 'request-response',
  setBackGuard: 'fire-and-forget',
} as const satisfies Record<HostCommand, 'request-response' | 'fire-and-forget'>;

export type HostCommandResponseKind =
  (typeof HOST_COMMAND_RESPONSE_KIND)[HostCommand];

/** 호스트 → 편집기 명령 엔벨로프 */
export interface HostCommandEnvelope<T = unknown> {
  source: typeof HOST_MESSAGE_SOURCE;
  version: typeof EMBED_MESSAGE_VERSION;
  command: HostCommand | (string & {});
  /** 응답 이벤트에 그대로 echo 된다. 요청-응답 명령에는 **매번 새로** 부여해야 한다 */
  requestId?: string;
  payload?: T;
}

/** 편집기 → 호스트 정식 엔벨로프 */
export interface EditorEnvelope<T = unknown> {
  source: typeof EDITOR_MESSAGE_SOURCE;
  version: typeof EMBED_MESSAGE_VERSION;
  /** `EditorEvent` 외의 미지 이벤트도 그대로 실려 온다(additive 관용) */
  event: EditorEvent | (string & {});
  payload: T;
  /** ISO 8601. 편집기는 항상 싣지만 방어적으로 optional */
  timestamp?: string;
}

// ── 페이로드 ────────────────────────────────────────────────────────────

/**
 * 템플릿셋 가변 가격 메타 — **불투명 통과값**.
 *
 * 정본 타입은 `@storige/types` 의 `PhotobookPricing` 이지만 그 패키지는 내부
 * 도메인 모델 전량이라 배포 대상이 아니다(루트 index.ts 상단 참조). 가격 계산
 * 주체는 **호스트**이므로 SDK 는 형태를 좁히지 않고 그대로 전달한다.
 */
export type EditorPricingMeta = Readonly<Record<string, unknown>>;

export interface EditorReadyPayload {
  sessionId?: string;
  templateSetId?: string;
  /** 편집기 번들 버전(엔벨로프 `version` 과 다른 값) */
  version?: string;
  /** DEV/allowSampleFallback 로 샘플 템플릿셋이 대체 구동된 경우에만 true */
  fallback?: boolean;
  effectiveTemplateSetId?: string;
  /** 주문 옵션과 템플릿셋의 방향(가로/세로) 불일치 통지 (2026-07-09 additive) */
  orientationMismatch?: unknown;
}

export interface EditorSavePayload {
  sessionId?: string;
  savedAt?: string;
  thumbnail?: string;
}

export interface EditorCancelPayload {
  sessionId?: string;
}

/** `editor.error` code 6종 (+ 미지 코드 관용) */
export type EditorErrorCode =
  | 'AUTH_EXPIRED'
  | 'NETWORK_ERROR'
  | 'SAVE_FAILED'
  | 'INVALID_DATA'
  | 'SESSION_NOT_FOUND'
  | 'TEMPLATE_SET_NOT_FOUND';

export interface EditorErrorPayload {
  code: EditorErrorCode | (string & {});
  message: string;
  templateSetId?: string;
}

export interface EditorPricingChangePayload {
  /** 게스트/미초기화 구간에서 null 일 수 있다 */
  sessionId: string | null;
  /** 물리 페이지 수 — 포토북 내지 펼침면은 캔버스 ×2 */
  pageCount: number;
  pricing?: EditorPricingMeta;
  /** 커버 종류 코드(고정 enum 아님 — 확장 가능한 string) */
  coverType?: string;
}

/**
 * `editor.complete` 의 `files` — **중첩 구조가 동결 계약**이다.
 *
 * 🚨 평탄화되지 않는다. `payload.coverFileId` 를 읽는 파서는 항상 `undefined` 를 얻는다.
 */
export interface EditorCompleteFiles {
  coverFileId?: string;
  contentFileId?: string;
  cover?: string;
  content?: string;
  thumbnailUrl?: string;
  thumbnail?: string;
}

/** `editor.complete` 의 `pages` — **`{initial, final}` 객체**(숫자 아님) */
export interface EditorCompletePages {
  initial: number;
  final: number;
}

/** 완료 시점 캔버스 규격(mm) — 감사/정합 검증용. 규격의 권위는 상품 옵션이다 */
export interface EditorCompleteSize {
  width: number;
  height: number;
  unit: 'mm';
}

/**
 * `editor.complete` 판독 결과 — **`guestToken` 값은 의도적으로 빠져 있다**.
 *
 * 게스트 토큰은 세션 자격증명이라 로그·DOM 으로 새면 그 세션을 남이 이어 편집할 수
 * 있다. SDK 는 존재 여부만 `hasGuestToken` 으로 알리고, 값이 실제로 필요한
 * 마이그레이션 호출에는 **1회성 소비 API**(`EditorHandle.consumeGuestToken()`)만 연다.
 */
export interface EditorCompletePayload {
  /**
   * 🚨 **가장 먼저 확인할 필드.** true 면 주문 생성·책 승격·합성을 일절 하지 말고
   * 로그인 유도로 분기한다. `editor.needAuth` 를 기다렸다 분기하면 이미 늦다 —
   * 게스트 완료는 `editor.complete` 가 **먼저** 온다.
   *
   * `guestToken` 만 있고 `needsAuth` 가 없는 형태도 게스트로 본다(fail-closed).
   */
  needsAuth: boolean;
  /** `needsAuth` 분기 결과를 미리 계산해 둔 값 — `decideCompleteAction` 과 동일 */
  action: Exclude<CompleteAction, 'ignore'>;
  /** payload 에 `guestToken` 이 실려 왔는가(값은 노출하지 않는다) */
  hasGuestToken: boolean;
  sessionId: string;
  orderSeqno?: number;
  /** `EDIT-XXXXXXXX` — 접두 `EDIT-` + 세션ID 앞 8자 대문자(순수 숫자 아님) */
  editCode?: string;
  pages?: EditorCompletePages;
  /** 완료 시점 실측 물리 페이지 수. 주문 옵션과 다르면 파트너가 가격을 재계산해야 한다 */
  pageCount?: number;
  pricing?: EditorPricingMeta;
  size?: EditorCompleteSize;
  /** 🚨 중첩 구조 — 게스트 완료 시엔 **빈 객체**다 */
  files: EditorCompleteFiles;
  savedAt?: string;
}

/**
 * `editor.complete` 수신 후 취할 행동.
 *
 * - `promote`       회원 세션 — 주문 생성·승격·합성 진행
 * - `require-login` 게스트 세션 — 승격하면 404(세션에 siteId 가 없다). 로그인 후 재개
 * - `ignore`        sessionId 가 없는 payload — 후속 처리를 시도조차 하지 않는다
 */
export type CompleteAction = 'promote' | 'require-login' | 'ignore';

/**
 * `editor.needAuth` payload.
 *
 * 🚨 **`sessionId` 가 없다.** 그래서 `editor.complete` ↔ `editor.needAuth` 중복 처리
 * 가드의 키로 `sessionId` 를 쓸 수 없다 — SDK 는 `guestToken` 을 내부 키로 쓴다
 * (값은 밖으로 내보내지 않는다). `mount.ts` 의 게스트 dedup 주석 참조.
 */
export interface EditorNeedAuthPayload {
  reason?: 'complete_save' | (string & {});
  ts?: number | string;
  /** 토큰 존재 여부만 노출 */
  hasGuestToken: boolean;
}

/** `getState` 응답(`editor.state`)에서 requestId 를 제거한 상태 스냅샷 */
export interface EditorState {
  ready: boolean;
  /** 미저장 변경 유무 */
  dirty: boolean;
  sessionId: string | null;
}

/** 게스트 로그인 유도 통지 — complete/needAuth 중복을 SDK 가 1회로 합친 결과 */
export interface GuestAuthRequired {
  /**
   * 게스트 세션 id. `editor.needAuth` 로만 감지된 경우 **null** 이다
   * (그 payload 에는 sessionId 가 없다).
   */
  sessionId: string | null;
  /** 어느 이벤트가 먼저 감지했는가 — 정상 순서에서는 항상 `editor.complete` */
  detectedBy: 'editor.complete' | 'editor.needAuth';
  /** 토큰이 실려 왔는가. 값은 `EditorHandle.consumeGuestToken()` 으로만 꺼낸다 */
  hasGuestToken: boolean;
}
