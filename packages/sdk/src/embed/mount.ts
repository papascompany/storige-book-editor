/**
 * `mountEditor` — iframe 생성 + postMessage 배선 + 명령 3종.
 *
 * ## 보안 게이트는 **생략할 수 없다**
 * SDK 가 iframe 을 소유하므로 `event.source === iframe.contentWindow` 대조를
 * 호출측이 넘길 여지가 없다. 게이트 4단(origin 정확일치 / source window / 봉투
 * `source` / `version`)은 {@link parseEditorMessage} 단일 지점에서 매 메시지마다
 * 적용되며, `contentWindow` 는 **이벤트 시점에** 다시 읽는다(로드 전후로 값이 바뀐다).
 *
 * ## 응답 유형을 타입으로 분리한다
 * `getState`/`saveNow` 는 요청-응답(Promise), `setBackGuard` 는 fire-and-forget(`void`).
 * 셋을 일괄 Promise 로 감싸면 `setBackGuard` 만 영원히 pending 된다 — 계약(§1-D-1)이
 * 응답 유형을 명시하는 이유이며, 이 타입 분리가 그 계약의 코드 표현이다.
 *
 * ## 타임아웃은 실패가 아니라 "미지원" 판정이다
 * 편집기는 미지원 command 를 조용히 무시한다(`default: break`). 원인별 구분은
 * `errors.ts` 상단 표 참조.
 *
 * ## 게스트 함정
 * - `editor.complete` 가 `editor.needAuth` **보다 먼저** 온다 → 분기 근거는 `needsAuth`.
 * - `guestToken` 값은 콜백으로 흘리지 않는다 — `consumeGuestToken()` 1회성 소비만 연다.
 * - 중복 처리 가드의 키로 **`sessionId` 를 쓸 수 없다**(`editor.needAuth` payload 에
 *   sessionId 가 없다). SDK 는 `guestToken` 을 내부 키로 쓴다.
 */

import { StorigeUsageError } from '../errors';
import {
  EditorCommandFailedError,
  EditorCommandUnsupportedError,
  EditorDetachedError,
  EditorNotReadyError,
} from './errors';
import {
  extractGuestToken,
  parseEditorMessage,
  readCompletePayload,
  readRequestId,
  readStatePayload,
  type EditorMessageLike,
} from './parse';
import {
  EMBED_MESSAGE_VERSION,
  HOST_MESSAGE_SOURCE,
  type EditorCancelPayload,
  type EditorCompletePayload,
  type EditorEnvelope,
  type EditorErrorPayload,
  type EditorNeedAuthPayload,
  type EditorPricingChangePayload,
  type EditorReadyPayload,
  type EditorSavePayload,
  type EditorState,
  type GuestAuthRequired,
  type HostCommand,
  type HostCommandEnvelope,
} from './protocol';
import { buildEmbedUrl, type EmbedUrlParams } from './url';

/** 요청-응답 명령의 기본 타임아웃(ms). 초과 = **미지원 판정**(실패 아님) */
export const DEFAULT_COMMAND_TIMEOUT_MS = 8_000;

/** `editor.ready` 대기 기본 타임아웃(ms) */
export const DEFAULT_READY_TIMEOUT_MS = 30_000;

// ── 내부 최소 DOM 형태 ──────────────────────────────────────────────────
// 공개 옵션은 표준 DOM 타입(`HTMLElement`/`Window`)을 그대로 받고, 구현에서는
// 실제로 쓰는 멤버만 좁혀 잡는다. 런타임 의존성 0 을 지키면서(jsdom 불요)
// 테스트가 가짜 DOM 을 주입할 수 있게 하는 경계다.

interface MinimalPostTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}
interface MinimalIframe {
  setAttribute(name: string, value: string): void;
  remove(): void;
  readonly contentWindow: MinimalPostTarget | null;
}
interface MinimalContainer {
  appendChild(child: MinimalIframe): unknown;
}
interface MinimalDocument {
  createElement(tagName: 'iframe'): MinimalIframe;
  getElementById(elementId: string): MinimalContainer | null;
  querySelector(selectors: string): MinimalContainer | null;
}
interface MinimalHostWindow {
  document: MinimalDocument;
  addEventListener(
    type: 'message',
    listener: (event: EditorMessageLike) => void,
  ): void;
  removeEventListener(
    type: 'message',
    listener: (event: EditorMessageLike) => void,
  ): void;
}

// ── 공개 타입 ───────────────────────────────────────────────────────────

/**
 * 편집기 이벤트 핸들러.
 *
 * `editor.state`/`editor.saved` 는 **호스트 명령의 응답**이라 핸들러가 없다 —
 * `getState()`/`saveNow()` 의 Promise 로만 도달한다(요청-응답 상관을 두 벌로
 * 갈라놓지 않기 위함).
 */
export interface EditorEventHandlers {
  ready?(payload: EditorReadyPayload): void;
  save?(payload: EditorSavePayload): void;
  /**
   * 편집 완료. **게스트 완료에서도 호출된다** — 반드시 `payload.needsAuth`(또는
   * `payload.action`)를 먼저 확인하라. `true` 면 주문 생성·승격·합성을 하지 말 것.
   *
   * `sessionId` 가 없는 payload 는 후속 처리 대상이 아니라 호출되지 않는다.
   */
  complete?(payload: EditorCompletePayload): void;
  cancel?(payload: EditorCancelPayload): void;
  error?(payload: EditorErrorPayload): void;
  /**
   * 게스트 로그인 유도 — `editor.complete{needsAuth}` 와 뒤따르는 `editor.needAuth`
   * **중복을 SDK 가 1회로 합쳐** 호출한다(정상 순서에서 `detectedBy='editor.complete'`).
   */
  guestAuthRequired?(info: GuestAuthRequired): void;
  /** 하위호환 보조 신호 원본. 대개는 {@link guestAuthRequired} 만 쓰면 된다 */
  needAuth?(payload: EditorNeedAuthPayload): void;
  pricingChange?(payload: EditorPricingChangePayload): void;
  /** 미지 이벤트(전방 호환 관찰용). 기본 동작은 무시다 */
  unknownEvent?(event: string, payload: unknown): void;
}

export interface EmbedIframeAttributes {
  title?: string;
  id?: string;
  className?: string;
  /** 기본 `width:100%;height:100%;border:0` */
  style?: string;
  /** 기본 `clipboard-write` */
  allow?: string;
  /** 기본 미설정 — sandbox 를 켜면 편집기 기능이 깨질 수 있다 */
  sandbox?: string;
  loading?: 'eager' | 'lazy';
}

export interface MountEditorOptions {
  /** 편집기 오리진. iframe src 이자 수신 게이트의 **정확 일치** 화이트리스트 */
  editorOrigin: string;
  /**
   * **필수** — 호스트 페이지 오리진.
   *
   * 없으면 편집기가 정식 엔벨로프를 발신하지 않고 레거시만 와일드카드로 내보낸다.
   * SDK 는 그 폴백으로 가는 길을 열지 않는다(누락·`'*'` 는 `StorigeUsageError`).
   */
  parentOrigin: string;
  /** iframe 을 붙일 요소, 또는 id/CSS 선택자 */
  container: HTMLElement | string;
  params: EmbedUrlParams;
  /** 기본 `/embed` */
  path?: string;
  extraParams?: Readonly<Record<string, string | number | boolean>>;
  on?: EditorEventHandlers;
  /** 요청-응답 명령 타임아웃. 기본 {@link DEFAULT_COMMAND_TIMEOUT_MS} */
  commandTimeoutMs?: number;
  /** `editor.ready` 대기 타임아웃. 기본 {@link DEFAULT_READY_TIMEOUT_MS} */
  readyTimeoutMs?: number;
  iframe?: EmbedIframeAttributes;
  /** 기본 `globalThis.window`. SSR/테스트 주입용 */
  hostWindow?: Window;
}

export interface EditorHandle {
  /** 생성된 iframe. 재부착·스타일 조정용(직접 postMessage 하지 말 것) */
  readonly iframe: HTMLIFrameElement;
  /** 실제 로드된 `/embed` URL */
  readonly url: string;

  /** `editor.ready` 를 기다린다. 미도달 시 {@link EditorNotReadyError} */
  whenReady(timeoutMs?: number): Promise<EditorReadyPayload>;

  /**
   * **요청-응답** — 현재 상태 조회.
   *
   * @throws {EditorCommandUnsupportedError} 응답 타임아웃 = 미지원 판정(실패 아님)
   * @throws {EditorNotReadyError} `editor.ready` 자체가 오지 않은 경우
   */
  getState(): Promise<EditorState>;

  /**
   * **요청-응답** — 즉시 저장.
   *
   * @throws {EditorCommandFailedError} 편집기가 `{ok:false}` 로 응답(진짜 실패)
   * @throws {EditorCommandUnsupportedError} 응답 타임아웃 = 미지원 판정
   */
  saveNow(): Promise<void>;

  /**
   * **fire-and-forget** — 응답 이벤트가 없다. 그래서 `void` 다.
   *
   * `Promise` 로 감싸지 마라 — 편집기는 이 명령에 아무것도 응답하지 않으므로
   * 그 Promise 는 영원히 pending 된다. 준비 전에 호출하면 SDK 가 큐에 넣었다가
   * `editor.ready` 직후 1회 전송한다(마지막 값만 유효).
   */
  setBackGuard(on: boolean): void;

  /**
   * 게스트 토큰 **1회성 소비**. 두 번째 호출부터는 `null`.
   *
   * 🚨 이 값은 세션 자격증명이다. 로그·DOM·URL 에 남기지 말고 파트너 백엔드의
   * `POST /api/edit-sessions/guest/migrate` 호출에만 쓰라. 이 함수가 유일한 노출
   * 경로인 이유 — 이벤트 콜백으로 뿌리면 무심코 로깅된다.
   */
  consumeGuestToken(): string | null;

  /** 리스너 해제 + iframe 제거 + 대기 중 명령 취소({@link EditorDetachedError}) */
  destroy(): void;
}

// ── 구현 ────────────────────────────────────────────────────────────────

let requestCounter = 0;

function newRequestId(): string {
  const scope = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = scope.crypto?.randomUUID;
  if (typeof uuid === 'function') return uuid.call(scope.crypto);
  requestCounter += 1;
  return `req_${Date.now().toString(36)}_${requestCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

interface PendingCommand {
  command: HostCommand;
  expectedEvent: 'editor.state' | 'editor.saved';
  timer: ReturnType<typeof setTimeout>;
  settle(payload: unknown): void;
  cancel(err: unknown): void;
}

interface ReadyWaiter {
  timer: ReturnType<typeof setTimeout> | null;
  resolve(payload: EditorReadyPayload): void;
  reject(err: unknown): void;
}

function resolveContainer(
  doc: MinimalDocument,
  container: HTMLElement | string,
): MinimalContainer {
  if (typeof container !== 'string') {
    return container as unknown as MinimalContainer;
  }
  const selector = container.trim();
  if (selector === '') {
    throw new StorigeUsageError('container 선택자가 비어 있습니다.');
  }
  // 순수 id 처럼 보이면 getElementById 를 먼저 본다(GUIDE 예시가 id 를 쓴다).
  const looksLikeBareId = /^[A-Za-z][\w:.-]*$/.test(selector);
  const found = looksLikeBareId
    ? (doc.getElementById(selector) ?? doc.querySelector(`#${selector}`))
    : doc.querySelector(selector);
  if (found === null) {
    throw new StorigeUsageError(
      `container 를 찾지 못했습니다: ${selector} (요소가 DOM 에 있는지 확인하십시오)`,
    );
  }
  return found;
}

/**
 * 편집기를 iframe 으로 마운트하고 postMessage 채널을 배선한다.
 *
 * @example
 * const editor = mountEditor({
 *   editorOrigin: 'https://editor.papascompany.co.kr',
 *   parentOrigin: 'https://app.example.com',   // 필수 — 없으면 던진다
 *   container: 'editor-root',
 *   params: { token, refreshToken, templateSetId: 'TS_8x8', orderSeqno: 12345 },
 *   on: {
 *     complete(payload) {
 *       if (payload.needsAuth) return;         // 게스트 — guestAuthRequired 가 따로 온다
 *       saveSessionToBackend(payload.sessionId, payload.files);
 *     },
 *     guestAuthRequired() {
 *       promptLogin(editor.consumeGuestToken());
 *     },
 *   },
 * });
 */
export function mountEditor(options: MountEditorOptions): EditorHandle {
  const url = buildEmbedUrl({
    editorOrigin: options.editorOrigin,
    parentOrigin: options.parentOrigin,
    params: options.params,
    ...(options.path !== undefined ? { path: options.path } : {}),
    ...(options.extraParams !== undefined
      ? { extraParams: options.extraParams }
      : {}),
  });
  // buildEmbedUrl 이 이미 검증·정규화했으므로 여기서는 정규화된 값만 다시 뽑는다.
  const editorOrigin = new URL(url).origin;

  const rawWindow = options.hostWindow ?? globalThis.window;
  if (!rawWindow) {
    throw new StorigeUsageError(
      'mountEditor 는 브라우저 환경이 필요합니다 — window 가 없습니다(SSR 이면 hostWindow 를 주입하십시오).',
    );
  }
  const hostWindow = rawWindow as unknown as MinimalHostWindow;
  const doc = hostWindow.document;
  if (!doc || typeof doc.createElement !== 'function') {
    throw new StorigeUsageError('hostWindow.document 를 사용할 수 없습니다.');
  }

  const containerEl = resolveContainer(doc, options.container);

  const commandTimeoutMs =
    options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const on = options.on ?? {};

  const iframe = doc.createElement('iframe');
  const attrs = options.iframe ?? {};
  iframe.setAttribute('src', url);
  iframe.setAttribute('title', attrs.title ?? 'Storige Editor');
  iframe.setAttribute(
    'style',
    attrs.style ?? 'width:100%;height:100%;border:0',
  );
  iframe.setAttribute('allow', attrs.allow ?? 'clipboard-write');
  if (attrs.id !== undefined) iframe.setAttribute('id', attrs.id);
  if (attrs.className !== undefined)
    iframe.setAttribute('class', attrs.className);
  if (attrs.sandbox !== undefined) iframe.setAttribute('sandbox', attrs.sandbox);
  if (attrs.loading !== undefined) iframe.setAttribute('loading', attrs.loading);
  containerEl.appendChild(iframe);

  let destroyed = false;
  let readyPayload: EditorReadyPayload | null = null;
  const readyWaiters = new Set<ReadyWaiter>();
  const pending = new Map<string, PendingCommand>();

  /** ready 이전에 도착한 fire-and-forget 명령(마지막 값만 유효) */
  let queuedBackGuard: boolean | null = null;

  // 게스트 dedup — 키는 guestToken 이다. sessionId 를 쓸 수 없다:
  // editor.needAuth payload 에는 sessionId 가 아예 없기 때문이다.
  let guestToken: string | null = null;
  const notifiedGuestTokens = new Set<string>();
  /** complete 로 이미 통지했으니 뒤따르는 needAuth 1건은 흡수한다 */
  let suppressNextNeedAuth = false;

  function post(command: HostCommand, requestId?: string, payload?: unknown): void {
    const target = iframe.contentWindow;
    if (target === null || typeof target.postMessage !== 'function') {
      throw new StorigeUsageError(
        'iframe.contentWindow 를 사용할 수 없습니다 — 마운트 직후이거나 이미 해제된 핸들입니다.',
      );
    }
    const envelope: HostCommandEnvelope = {
      source: HOST_MESSAGE_SOURCE,
      version: EMBED_MESSAGE_VERSION,
      command,
      ...(requestId !== undefined ? { requestId } : {}),
      ...(payload !== undefined ? { payload } : {}),
    };
    // targetOrigin 은 편집기 오리진 그대로 — 와일드카드 절대 금지.
    target.postMessage(envelope, editorOrigin);
  }

  function waitReady(
    command: HostCommand | null,
    timeoutMs: number,
  ): Promise<EditorReadyPayload> {
    if (destroyed) return Promise.reject(new EditorDetachedError());
    if (readyPayload !== null) return Promise.resolve(readyPayload);
    return new Promise<EditorReadyPayload>((resolve, reject) => {
      const waiter: ReadyWaiter = { timer: null, resolve, reject };
      waiter.timer = setTimeout(() => {
        readyWaiters.delete(waiter);
        reject(new EditorNotReadyError(command, timeoutMs));
      }, timeoutMs);
      readyWaiters.add(waiter);
    });
  }

  function settleReady(payload: EditorReadyPayload): void {
    readyPayload = payload;
    for (const waiter of readyWaiters) {
      if (waiter.timer !== null) clearTimeout(waiter.timer);
      waiter.resolve(payload);
    }
    readyWaiters.clear();
    if (queuedBackGuard !== null) {
      const value = queuedBackGuard;
      queuedBackGuard = null;
      try {
        post('setBackGuard', undefined, { enabled: value });
      } catch {
        /* 마운트 직후 contentWindow 부재 — fire-and-forget 이라 조용히 포기 */
      }
    }
  }

  function notifyGuestAuthRequired(
    detectedBy: GuestAuthRequired['detectedBy'],
    sessionId: string | null,
    token: string | null,
  ): void {
    if (token !== null && notifiedGuestTokens.has(token)) {
      suppressNextNeedAuth = false;
      return;
    }
    if (detectedBy === 'editor.needAuth' && suppressNextNeedAuth) {
      // complete 에서 이미 통지했다. 토큰이 그때는 없었더라도 여기서 기록해 둔다.
      suppressNextNeedAuth = false;
      if (token !== null) notifiedGuestTokens.add(token);
      return;
    }
    if (token !== null) notifiedGuestTokens.add(token);
    suppressNextNeedAuth = detectedBy === 'editor.complete';
    on.guestAuthRequired?.({
      sessionId,
      detectedBy,
      hasGuestToken: token !== null,
    });
  }

  function handleResponse(
    envelope: EditorEnvelope,
    expected: 'editor.state' | 'editor.saved',
  ): void {
    const requestId = readRequestId(envelope.payload);
    if (requestId === null) return; // 우리가 건 요청이 아니다
    const entry = pending.get(requestId);
    if (entry === undefined || entry.expectedEvent !== expected) return;
    pending.delete(requestId);
    clearTimeout(entry.timer);
    entry.settle(envelope.payload);
  }

  function dispatch(envelope: EditorEnvelope): void {
    switch (envelope.event) {
      case 'editor.ready':
        settleReady((envelope.payload ?? {}) as EditorReadyPayload);
        on.ready?.((envelope.payload ?? {}) as EditorReadyPayload);
        return;
      case 'editor.save':
        on.save?.((envelope.payload ?? {}) as EditorSavePayload);
        return;
      case 'editor.complete': {
        const token = extractGuestToken(envelope.payload);
        if (token !== null) guestToken = token;
        const done = readCompletePayload(envelope.payload);
        if (done === null) return; // sessionId 없음 — 후속 처리 대상 아님
        on.complete?.(done);
        if (done.needsAuth) {
          notifyGuestAuthRequired('editor.complete', done.sessionId, token);
        }
        return;
      }
      case 'editor.cancel':
        on.cancel?.((envelope.payload ?? {}) as EditorCancelPayload);
        return;
      case 'editor.error':
        on.error?.((envelope.payload ?? {}) as EditorErrorPayload);
        return;
      case 'editor.needAuth': {
        const token = extractGuestToken(envelope.payload);
        if (token !== null) guestToken = token;
        const raw = (envelope.payload ?? {}) as Record<string, unknown>;
        on.needAuth?.({
          hasGuestToken: token !== null,
          ...(typeof raw.reason === 'string' ? { reason: raw.reason } : {}),
          ...(typeof raw.ts === 'string' || typeof raw.ts === 'number'
            ? { ts: raw.ts }
            : {}),
        });
        notifyGuestAuthRequired('editor.needAuth', null, token);
        return;
      }
      case 'editor.pricingChange':
        on.pricingChange?.((envelope.payload ?? {}) as EditorPricingChangePayload);
        return;
      case 'editor.state':
        handleResponse(envelope, 'editor.state');
        return;
      case 'editor.saved':
        handleResponse(envelope, 'editor.saved');
        return;
      default:
        // 미지 이벤트는 무시한다(additive 성장). 관찰만 원하면 unknownEvent 로.
        on.unknownEvent?.(envelope.event, envelope.payload);
        return;
    }
  }

  const listener = (event: EditorMessageLike): void => {
    if (destroyed) return;
    const parsed = parseEditorMessage(event, {
      allowedOrigins: [editorOrigin],
      // ② 게이트 — 이벤트 시점의 contentWindow 로 대조한다(로드 전후로 바뀐다).
      expectedSource: iframe.contentWindow,
    });
    if (!parsed.ok) return;
    dispatch(parsed.envelope);
  };

  hostWindow.addEventListener('message', listener);

  function request<T>(
    command: HostCommand,
    expectedEvent: 'editor.state' | 'editor.saved',
    settle: (
      payload: unknown,
      resolve: (value: T) => void,
      reject: (err: unknown) => void,
    ) => void,
  ): Promise<T> {
    return waitReady(command, readyTimeoutMs).then(
      () =>
        new Promise<T>((resolve, reject) => {
          if (destroyed) {
            reject(new EditorDetachedError());
            return;
          }
          const requestId = newRequestId();
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new EditorCommandUnsupportedError(command, commandTimeoutMs));
          }, commandTimeoutMs);
          pending.set(requestId, {
            command,
            expectedEvent,
            timer,
            settle: (payload) => settle(payload, resolve, reject),
            cancel: reject,
          });
          try {
            post(command, requestId);
          } catch (err) {
            clearTimeout(timer);
            pending.delete(requestId);
            reject(err);
          }
        }),
    );
  }

  const handle: EditorHandle = {
    iframe: iframe as unknown as HTMLIFrameElement,
    url,

    whenReady(timeoutMs?: number) {
      return waitReady(null, timeoutMs ?? readyTimeoutMs);
    },

    getState() {
      return request<EditorState>(
        'getState',
        'editor.state',
        (payload, resolve) => {
          resolve(readStatePayload(payload));
        },
      );
    },

    saveNow() {
      return request<void>(
        'saveNow',
        'editor.saved',
        (payload, resolve, reject) => {
          const raw = (payload ?? {}) as Record<string, unknown>;
          if (raw.ok === false) {
            const reason =
              typeof raw.error === 'string' && raw.error !== ''
                ? raw.error
                : null;
            reject(new EditorCommandFailedError('saveNow', reason));
            return;
          }
          resolve();
        },
      );
    },

    setBackGuard(enabled: boolean) {
      if (destroyed) throw new EditorDetachedError();
      const value = !!enabled;
      if (readyPayload === null) {
        queuedBackGuard = value;
        return;
      }
      post('setBackGuard', undefined, { enabled: value });
    },

    consumeGuestToken() {
      const token = guestToken;
      guestToken = null;
      return token;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      hostWindow.removeEventListener('message', listener);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.cancel(new EditorDetachedError());
      }
      pending.clear();
      for (const waiter of readyWaiters) {
        if (waiter.timer !== null) clearTimeout(waiter.timer);
        waiter.reject(new EditorDetachedError());
      }
      readyWaiters.clear();
      queuedBackGuard = null;
      guestToken = null;
      try {
        iframe.remove();
      } catch {
        /* 이미 분리된 노드 — 무시 */
      }
    },
  };

  return handle;
}
