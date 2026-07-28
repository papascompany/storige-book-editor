/**
 * `mountEditor` — iframe 배선 · 명령 3종(응답 유형 분리) · 수신 게이트 · 게스트 함정.
 *
 * ## jsdom 을 쓰지 않는 이유
 * SDK 는 **npm 런타임 의존성 0** 이고 devDependency 도 최소로 유지한다. `mountEditor` 가
 * 실제로 만지는 DOM 표면은 `createElement/setAttribute/appendChild/remove/contentWindow/
 * addEventListener` 뿐이라, 그만큼을 손으로 만든 가짜로 덮으면 jsdom 없이도 **편집기와
 * 주고받는 실제 메시지**를 그대로 검증할 수 있다.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  EDITOR_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  EditorCommandFailedError,
  EditorCommandUnsupportedError,
  EditorDetachedError,
  EditorNotReadyError,
  HOST_MESSAGE_SOURCE,
  isEditorCommandUnsupported,
  mountEditor,
  type EditorEventHandlers,
  type MountEditorOptions,
} from '../embed';
import { StorigeUsageError } from '../errors';

const EDITOR_ORIGIN = 'https://editor.storige.test';
const PARENT_ORIGIN = 'https://shop.partner.test';
const CONTAINER_ID = 'editor-root';

// ── 가짜 DOM ────────────────────────────────────────────────────────────

interface Posted {
  message: Record<string, unknown>;
  targetOrigin: string;
}

class FakePostTarget {
  readonly posted: Posted[] = [];
  postMessage(message: unknown, targetOrigin: string): void {
    this.posted.push({
      message: message as Record<string, unknown>,
      targetOrigin,
    });
  }
}

class FakeIframe {
  readonly attrs: Record<string, string> = {};
  contentWindow: FakePostTarget | null = new FakePostTarget();
  removed = false;
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }
  remove(): void {
    this.removed = true;
  }
}

class FakeContainer {
  readonly children: FakeIframe[] = [];
  appendChild(child: FakeIframe): FakeIframe {
    this.children.push(child);
    return child;
  }
}

class FakeDocument {
  readonly containers = new Map<string, FakeContainer>();
  readonly created: FakeIframe[] = [];
  createElement(_tagName: string): FakeIframe {
    const iframe = new FakeIframe();
    this.created.push(iframe);
    return iframe;
  }
  getElementById(id: string): FakeContainer | null {
    return this.containers.get(id) ?? null;
  }
  querySelector(selector: string): FakeContainer | null {
    return this.containers.get(selector.replace(/^#/, '')) ?? null;
  }
}

interface IncomingMessage {
  origin: string;
  source: unknown;
  data: unknown;
}

class FakeWindow {
  readonly document = new FakeDocument();
  listeners: Array<(event: IncomingMessage) => void> = [];
  addEventListener(
    type: string,
    listener: (event: IncomingMessage) => void,
  ): void {
    if (type === 'message') this.listeners.push(listener);
  }
  removeEventListener(
    type: string,
    listener: (event: IncomingMessage) => void,
  ): void {
    if (type === 'message') {
      this.listeners = this.listeners.filter((l) => l !== listener);
    }
  }
  emit(event: IncomingMessage): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

// ── 하네스 ──────────────────────────────────────────────────────────────

interface Harness {
  win: FakeWindow;
  iframe: FakeIframe;
  posted: Posted[];
  handle: ReturnType<typeof mountEditor>;
  /** 편집기가 보낸 것처럼 정식 엔벨로프를 흘려 넣는다 */
  fromEditor(event: string, payload?: unknown): void;
  /** 임의의 origin/source 로 위조 메시지를 흘려 넣는다 */
  raw(event: IncomingMessage): void;
  /** 마지막으로 전송된 명령 봉투 */
  lastCommand(): Record<string, unknown>;
}

function setup(
  overrides: Partial<MountEditorOptions> = {},
  handlers: EditorEventHandlers = {},
): Harness {
  const win = new FakeWindow();
  win.document.containers.set(CONTAINER_ID, new FakeContainer());

  const handle = mountEditor({
    editorOrigin: EDITOR_ORIGIN,
    parentOrigin: PARENT_ORIGIN,
    container: CONTAINER_ID,
    params: { token: 'jwt', templateSetId: 'TS_8x8' },
    commandTimeoutMs: 40,
    readyTimeoutMs: 40,
    on: handlers,
    hostWindow: win as unknown as Window,
    ...overrides,
  });

  const iframe = win.document.created[0];
  if (!iframe) throw new Error('iframe 이 생성되지 않았습니다');

  return {
    win,
    iframe,
    get posted() {
      return iframe.contentWindow?.posted ?? [];
    },
    handle,
    fromEditor(event, payload = {}) {
      win.emit({
        origin: EDITOR_ORIGIN,
        source: iframe.contentWindow,
        data: {
          source: EDITOR_MESSAGE_SOURCE,
          version: EMBED_MESSAGE_VERSION,
          event,
          payload,
          timestamp: '2026-07-28T00:00:00.000Z',
        },
      });
    },
    raw(event) {
      win.emit(event);
    },
    lastCommand() {
      const posts = iframe.contentWindow?.posted ?? [];
      const last = posts[posts.length - 1];
      if (!last) throw new Error('전송된 명령이 없습니다');
      return last.message;
    },
  };
}

/** 편집기가 requestId 를 echo 하며 응답하는 정상 동작 재현 */
function respondTo(h: Harness, event: 'editor.state' | 'editor.saved', extra: Record<string, unknown>): void {
  const requestId = h.lastCommand().requestId;
  h.fromEditor(event, { requestId, ...extra });
}

// ── 마운트 ──────────────────────────────────────────────────────────────

describe('mountEditor — 마운트와 iframe 배선', () => {
  it('iframe 을 만들어 컨테이너에 붙이고 parentOrigin 을 URL 에 강제한다', () => {
    const h = setup();
    const src = new URL(h.iframe.attrs.src ?? '');
    expect(src.origin).toBe(EDITOR_ORIGIN);
    expect(src.pathname).toBe('/embed');
    expect(src.searchParams.get('parentOrigin')).toBe(PARENT_ORIGIN);
    expect(h.iframe.attrs.title).toBe('Storige Editor');
    expect(h.win.document.containers.get(CONTAINER_ID)?.children).toHaveLength(1);
    expect(h.handle.url).toBe(h.iframe.attrs.src);
  });

  it('parentOrigin 누락/와일드카드는 마운트 자체를 거부한다', () => {
    expect(() => setup({ parentOrigin: '' })).toThrow(StorigeUsageError);
    expect(() => setup({ parentOrigin: '*' })).toThrow(/와일드카드/);
  });

  it('컨테이너를 찾지 못하면 던진다', () => {
    expect(() => setup({ container: 'missing-root' })).toThrow(/container/);
  });

  it('브라우저 환경이 아니면 던진다(hostWindow 미주입 + window 없음)', () => {
    expect(() =>
      mountEditor({
        editorOrigin: EDITOR_ORIGIN,
        parentOrigin: PARENT_ORIGIN,
        container: CONTAINER_ID,
        params: { token: 'jwt', templateSetId: 'TS' },
      }),
    ).toThrow(/window/);
  });
});

// ── 명령 3종 ────────────────────────────────────────────────────────────

describe('명령 3종 — 응답 유형별 분리', () => {
  it('getState 는 요청-응답: 봉투·targetOrigin·requestId echo 매칭', async () => {
    const h = setup();
    h.fromEditor('editor.ready', { sessionId: 'sess-1' });

    const promise = h.handle.getState();
    await Promise.resolve();

    const sent = h.posted[h.posted.length - 1];
    expect(sent?.targetOrigin).toBe(EDITOR_ORIGIN); // 와일드카드 금지
    expect(sent?.message.source).toBe(HOST_MESSAGE_SOURCE);
    expect(sent?.message.version).toBe(EMBED_MESSAGE_VERSION);
    expect(sent?.message.command).toBe('getState');
    expect(typeof sent?.message.requestId).toBe('string');

    respondTo(h, 'editor.state', {
      ready: true,
      dirty: true,
      sessionId: 'sess-1',
    });

    await expect(promise).resolves.toEqual({
      ready: true,
      dirty: true,
      sessionId: 'sess-1',
    });
  });

  it('saveNow 는 요청-응답: ok=true 로 resolve', async () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const promise = h.handle.saveNow();
    await Promise.resolve();
    expect(h.lastCommand().command).toBe('saveNow');
    respondTo(h, 'editor.saved', { ok: true });
    await expect(promise).resolves.toBeUndefined();
  });

  it('saveNow 의 {ok:false} 는 **진짜 실패** — 미지원 판정과 구분된다', async () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const promise = h.handle.saveNow();
    await Promise.resolve();
    respondTo(h, 'editor.saved', { ok: false, error: 'SAVE_FAILED' });

    await expect(promise).rejects.toBeInstanceOf(EditorCommandFailedError);
    await promise.catch((err: unknown) => {
      expect(isEditorCommandUnsupported(err)).toBe(false);
      expect((err as EditorCommandFailedError).reason).toBe('SAVE_FAILED');
    });
  });

  it('setBackGuard 는 fire-and-forget — void 를 반환하고 requestId 를 싣지 않는다', () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const returned: void = h.handle.setBackGuard(false);
    expect(returned).toBeUndefined();

    const sent = h.lastCommand();
    expect(sent.command).toBe('setBackGuard');
    expect(sent.payload).toEqual({ enabled: false });
    expect(sent.requestId).toBeUndefined();
  });

  it('ready 이전의 setBackGuard 는 큐잉됐다가 ready 직후 1회 전송된다', () => {
    const h = setup();
    h.handle.setBackGuard(true);
    expect(h.posted).toHaveLength(0);

    h.fromEditor('editor.ready');
    expect(h.posted).toHaveLength(1);
    expect(h.lastCommand().payload).toEqual({ enabled: true });
  });
});

// ── 타임아웃 판정 ───────────────────────────────────────────────────────

describe('타임아웃 = 미지원 판정(실패 아님)', () => {
  it('ready 이후 무응답 → EditorCommandUnsupportedError', async () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const promise = h.handle.getState();

    await expect(promise).rejects.toBeInstanceOf(EditorCommandUnsupportedError);
    await promise.catch((err: unknown) => {
      expect(isEditorCommandUnsupported(err)).toBe(true);
      expect((err as EditorCommandUnsupportedError).command).toBe('getState');
      expect((err as EditorCommandUnsupportedError).timeoutMs).toBe(40);
    });
  });

  it('다른 requestId 응답은 상관되지 않는다 → 여전히 미지원 판정', async () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const promise = h.handle.getState();
    await Promise.resolve();
    h.fromEditor('editor.state', {
      requestId: 'someone-elses-id',
      ready: true,
      dirty: false,
      sessionId: 'x',
    });
    await expect(promise).rejects.toBeInstanceOf(EditorCommandUnsupportedError);
  });

  it('editor.ready 자체가 안 오면 미지원이 아니라 EditorNotReadyError', async () => {
    const h = setup();
    const promise = h.handle.getState();
    await expect(promise).rejects.toBeInstanceOf(EditorNotReadyError);
    await promise.catch((err: unknown) => {
      // 명령을 보내지도 못했으므로 "미지원" 결론을 내릴 수 없다
      expect(isEditorCommandUnsupported(err)).toBe(false);
      expect((err as EditorNotReadyError).command).toBe('getState');
    });
    expect(h.posted).toHaveLength(0);
  });

  it('whenReady 는 ready payload 로 resolve 된다', async () => {
    const h = setup();
    const promise = h.handle.whenReady();
    h.fromEditor('editor.ready', { sessionId: 'sess-9', templateSetId: 'TS' });
    await expect(promise).resolves.toMatchObject({ sessionId: 'sess-9' });
  });
});

// ── 수신 게이트 ─────────────────────────────────────────────────────────

describe('호스트측 수신 게이트 — 생략 불가', () => {
  it('다른 오리진의 메시지는 무시된다', () => {
    const ready = vi.fn();
    const h = setup({}, { ready });
    h.raw({
      origin: 'https://evil.test',
      source: h.iframe.contentWindow,
      data: {
        source: EDITOR_MESSAGE_SOURCE,
        version: EMBED_MESSAGE_VERSION,
        event: 'editor.ready',
        payload: {},
      },
    });
    expect(ready).not.toHaveBeenCalled();
  });

  it('같은 오리진의 다른 프레임(형제 iframe·팝업)도 무시된다', () => {
    const ready = vi.fn();
    const h = setup({}, { ready });
    h.raw({
      origin: EDITOR_ORIGIN,
      source: { name: 'sibling frame' },
      data: {
        source: EDITOR_MESSAGE_SOURCE,
        version: EMBED_MESSAGE_VERSION,
        event: 'editor.ready',
        payload: {},
      },
    });
    expect(ready).not.toHaveBeenCalled();
  });

  it('위조 프레임은 응답 상관도 가로챌 수 없다', async () => {
    const h = setup();
    h.fromEditor('editor.ready');
    const promise = h.handle.getState();
    await Promise.resolve();
    const requestId = h.lastCommand().requestId;

    // 정확한 requestId 를 알고 있어도 source 가 다르면 통과하지 못한다
    h.raw({
      origin: EDITOR_ORIGIN,
      source: { name: 'sibling frame' },
      data: {
        source: EDITOR_MESSAGE_SOURCE,
        version: EMBED_MESSAGE_VERSION,
        event: 'editor.state',
        payload: { requestId, ready: true, dirty: false, sessionId: 'spoofed' },
      },
    });

    await expect(promise).rejects.toBeInstanceOf(EditorCommandUnsupportedError);
  });

  it('iframe 미로드 구간(contentWindow=null)의 source:null 메시지도 무시된다', () => {
    const ready = vi.fn();
    const h = setup({}, { ready });
    h.iframe.contentWindow = null; // 아직 로드 전 / 이미 분리됨
    h.raw({
      origin: EDITOR_ORIGIN,
      source: null, // 닫힌 윈도우·worker 발신
      data: {
        source: EDITOR_MESSAGE_SOURCE,
        version: EMBED_MESSAGE_VERSION,
        event: 'editor.ready',
        payload: {},
      },
    });
    expect(ready).not.toHaveBeenCalled();
  });

  it('레거시 storige:* dual-emit 은 핸들러에 도달하지 않는다', () => {
    const complete = vi.fn();
    const unknownEvent = vi.fn();
    const h = setup({}, { complete, unknownEvent });
    h.raw({
      origin: EDITOR_ORIGIN,
      source: h.iframe.contentWindow,
      data: { type: 'storige:completed', sessionId: 'sess-1' },
    });
    expect(complete).not.toHaveBeenCalled();
    expect(unknownEvent).not.toHaveBeenCalled();
  });
});

// ── 이벤트 라우팅 ───────────────────────────────────────────────────────

describe('이벤트 라우팅', () => {
  it('미지 이벤트는 무시하되 unknownEvent 로 관찰할 수 있다', () => {
    const unknownEvent = vi.fn();
    const h = setup({}, { unknownEvent });
    expect(() => h.fromEditor('editor.thumbnail', { page: 3 })).not.toThrow();
    expect(unknownEvent).toHaveBeenCalledWith('editor.thumbnail', { page: 3 });
  });

  it('save·cancel·error·pricingChange 를 각 핸들러로 라우팅한다', () => {
    const save = vi.fn();
    const cancel = vi.fn();
    const error = vi.fn();
    const pricingChange = vi.fn();
    const h = setup({}, { save, cancel, error, pricingChange });

    h.fromEditor('editor.save', { sessionId: 's', savedAt: 'now' });
    h.fromEditor('editor.cancel', { sessionId: 's' });
    h.fromEditor('editor.error', { code: 'AUTH_EXPIRED', message: '만료' });
    h.fromEditor('editor.pricingChange', { sessionId: 's', pageCount: 30 });

    expect(save).toHaveBeenCalledWith({ sessionId: 's', savedAt: 'now' });
    expect(cancel).toHaveBeenCalledWith({ sessionId: 's' });
    expect(error).toHaveBeenCalledWith({ code: 'AUTH_EXPIRED', message: '만료' });
    expect(pricingChange).toHaveBeenCalledWith({ sessionId: 's', pageCount: 30 });
  });

  it('editor.state / editor.saved 는 응답 채널이라 핸들러 표면에 없다', () => {
    // 타입 레벨 확인: 아래 키들은 EditorEventHandlers 에 존재하지 않는다.
    const handlers: EditorEventHandlers = {};
    expect('state' in handlers).toBe(false);
    expect('saved' in handlers).toBe(false);
  });
});

// ── 게스트 함정 ─────────────────────────────────────────────────────────

describe('게스트 분기 — 순서·중복·토큰 비노출', () => {
  const guestComplete = {
    sessionId: 'sess-guest',
    needsAuth: true,
    guestToken: 'super-secret-guest-token',
    pages: { initial: 4, final: 4 },
    files: {},
    savedAt: '2026-07-28T00:00:00.000Z',
  };

  it('complete(needsAuth) → guestAuthRequired 1회, 뒤이은 needAuth 는 흡수된다', () => {
    const complete = vi.fn();
    const guestAuthRequired = vi.fn();
    const h = setup({}, { complete, guestAuthRequired });

    // 계약 순서: complete 가 **먼저**, needAuth 가 나중
    h.fromEditor('editor.complete', guestComplete);
    h.fromEditor('editor.needAuth', {
      guestToken: 'super-secret-guest-token',
      reason: 'complete_save',
      ts: 1,
    });

    expect(guestAuthRequired).toHaveBeenCalledTimes(1);
    expect(guestAuthRequired).toHaveBeenCalledWith({
      sessionId: 'sess-guest',
      detectedBy: 'editor.complete',
      hasGuestToken: true,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      needsAuth: true,
      action: 'require-login',
      hasGuestToken: true,
    });
  });

  it('complete 에 토큰이 없어도 뒤따르는 needAuth 를 중복 통지하지 않는다', () => {
    const guestAuthRequired = vi.fn();
    const h = setup({}, { guestAuthRequired });
    h.fromEditor('editor.complete', {
      sessionId: 'sess-guest',
      needsAuth: true,
      files: {},
    });
    h.fromEditor('editor.needAuth', { guestToken: 'tok', reason: 'complete_save' });
    expect(guestAuthRequired).toHaveBeenCalledTimes(1);
  });

  it('needAuth 만 단독으로 와도 통지된다(sessionId 는 null — payload 에 없다)', () => {
    const guestAuthRequired = vi.fn();
    const h = setup({}, { guestAuthRequired });
    h.fromEditor('editor.needAuth', { guestToken: 'tok', reason: 'complete_save' });
    expect(guestAuthRequired).toHaveBeenCalledWith({
      sessionId: null,
      detectedBy: 'editor.needAuth',
      hasGuestToken: true,
    });
  });

  it('guestToken 값은 콜백 인자 어디에도 실리지 않는다', () => {
    const seen: unknown[] = [];
    const record = (v: unknown): void => {
      seen.push(v);
    };
    const h = setup(
      {},
      {
        complete: record,
        needAuth: record,
        guestAuthRequired: record,
      },
    );
    h.fromEditor('editor.complete', guestComplete);
    h.fromEditor('editor.needAuth', {
      guestToken: 'super-secret-guest-token',
      reason: 'complete_save',
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain('super-secret-guest-token');
  });

  it('consumeGuestToken 은 1회성이다', () => {
    const h = setup();
    h.fromEditor('editor.complete', guestComplete);
    expect(h.handle.consumeGuestToken()).toBe('super-secret-guest-token');
    expect(h.handle.consumeGuestToken()).toBeNull();
  });

  it('회원 완료는 promote 로, guestAuthRequired 는 호출되지 않는다', () => {
    const complete = vi.fn();
    const guestAuthRequired = vi.fn();
    const h = setup({}, { complete, guestAuthRequired });
    h.fromEditor('editor.complete', {
      sessionId: 'sess-member',
      files: { coverFileId: 'c', contentFileId: 'n' },
      pages: { initial: 24, final: 24 },
    });
    expect(guestAuthRequired).not.toHaveBeenCalled();
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      needsAuth: false,
      action: 'promote',
      files: { coverFileId: 'c', contentFileId: 'n' },
    });
  });

  it('sessionId 없는 complete 는 후속 처리 대상이 아니라 호출되지 않는다', () => {
    const complete = vi.fn();
    const h = setup({}, { complete });
    h.fromEditor('editor.complete', { files: {} });
    expect(complete).not.toHaveBeenCalled();
  });
});

// ── 해제 ────────────────────────────────────────────────────────────────

describe('destroy', () => {
  it('리스너 해제 + iframe 제거 + 대기 명령 취소', async () => {
    const ready = vi.fn();
    const h = setup({}, { ready });
    h.fromEditor('editor.ready');
    const promise = h.handle.getState();
    await Promise.resolve();

    h.handle.destroy();

    await expect(promise).rejects.toBeInstanceOf(EditorDetachedError);
    expect(h.iframe.removed).toBe(true);
    expect(h.win.listeners).toHaveLength(0);

    ready.mockClear();
    h.fromEditor('editor.ready');
    expect(ready).not.toHaveBeenCalled();

    expect(() => h.handle.setBackGuard(true)).toThrow(EditorDetachedError);
    await expect(h.handle.whenReady()).rejects.toBeInstanceOf(
      EditorDetachedError,
    );
    // 멱등
    expect(() => h.handle.destroy()).not.toThrow();
  });

  it('destroy 는 대기 중인 whenReady 도 취소한다', async () => {
    const h = setup();
    const promise = h.handle.whenReady();
    h.handle.destroy();
    await expect(promise).rejects.toBeInstanceOf(EditorDetachedError);
  });
});
