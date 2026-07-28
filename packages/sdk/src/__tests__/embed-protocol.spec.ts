/**
 * `@storige/sdk/embed` — 계약 상수 · 수신 게이트 · URL 조립.
 *
 * 마운트(iframe·명령 3종)는 embed-mount.spec.ts 가 맡는다. 여기서는 DOM 없이
 * 검증 가능한 순수 계층만 다룬다.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEmbedUrl,
  decideCompleteAction,
  EDITOR_ADDITIVE_EVENTS,
  EDITOR_EVENTS,
  EDITOR_FROZEN_EVENTS,
  EDITOR_MESSAGE_SOURCE,
  EMBED_MESSAGE_VERSION,
  HOST_COMMAND_RESPONSE_KIND,
  HOST_COMMANDS,
  HOST_MESSAGE_SOURCE,
  isKnownEditorEvent,
  normalizeOrigin,
  parseEditorMessage,
  readCompletePayload,
  SKIP_SOURCE_CHECK,
  type EditorMessageLike,
  type ParseEditorMessageOptions,
} from '../embed';
import { StorigeUsageError } from '../errors';

const EDITOR_ORIGIN = 'https://editor.storige.test';
const PARENT_ORIGIN = 'https://shop.partner.test';
const IFRAME_WINDOW = { name: 'iframe.contentWindow' };

function envelope(event: string, payload: unknown = {}): unknown {
  return {
    source: EDITOR_MESSAGE_SOURCE,
    version: EMBED_MESSAGE_VERSION,
    event,
    payload,
    timestamp: '2026-07-28T00:00:00.000Z',
  };
}

function message(over: Partial<EditorMessageLike> = {}): EditorMessageLike {
  return {
    origin: EDITOR_ORIGIN,
    source: IFRAME_WINDOW,
    data: envelope('editor.ready', { sessionId: 's1' }),
    ...over,
  };
}

const GATE: ParseEditorMessageOptions = {
  allowedOrigins: [EDITOR_ORIGIN],
  expectedSource: IFRAME_WINDOW,
};

// ── 계약 동결 잠금 ──────────────────────────────────────────────────────

describe('계약 카탈로그 — 동결 표면을 부풀리지 않는다', () => {
  it('편집기 발신은 8종 FROZEN + 1종 ADDITIVE 다 (9종 동결이 아니다)', () => {
    expect(EDITOR_FROZEN_EVENTS).toEqual([
      'editor.ready',
      'editor.save',
      'editor.complete',
      'editor.cancel',
      'editor.error',
      'editor.needAuth',
      'editor.state',
      'editor.saved',
    ]);
    expect(EDITOR_FROZEN_EVENTS).toHaveLength(8);
    expect(EDITOR_ADDITIVE_EVENTS).toEqual(['editor.pricingChange']);
    expect(EDITOR_EVENTS).toHaveLength(9);
  });

  it('수신 명령 v1 은 3종이고 응답 유형이 계약의 일부다', () => {
    expect(HOST_COMMANDS).toEqual(['getState', 'saveNow', 'setBackGuard']);
    expect(HOST_COMMAND_RESPONSE_KIND).toEqual({
      getState: 'request-response',
      saveNow: 'request-response',
      // 🚨 Promise 로 감싸면 영원히 pending 되는 명령
      setBackGuard: 'fire-and-forget',
    });
  });

  it('봉투 식별자 — version 은 문자열 "1"', () => {
    expect(EDITOR_MESSAGE_SOURCE).toBe('storige-editor');
    expect(HOST_MESSAGE_SOURCE).toBe('storige-host');
    expect(EMBED_MESSAGE_VERSION).toBe('1');
  });

  it('isKnownEditorEvent 는 미지 이벤트를 false 로 판정한다(무시 대상)', () => {
    expect(isKnownEditorEvent('editor.pricingChange')).toBe(true);
    expect(isKnownEditorEvent('editor.thumbnail')).toBe(false);
  });
});

// ── 수신 게이트 ─────────────────────────────────────────────────────────

describe('parseEditorMessage — 4단 게이트', () => {
  it('정상 메시지는 통과한다', () => {
    const result = parseEditorMessage(message(), GATE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.envelope.event).toBe('editor.ready');
      expect(result.envelope.timestamp).toBe('2026-07-28T00:00:00.000Z');
    }
  });

  it('① origin 은 정확 일치 — 접미 일치·스킴 차이·서브도메인 위조를 전부 차단', () => {
    for (const origin of [
      'https://evil-editor.storige.test.attacker.test',
      'http://editor.storige.test',
      'https://editor.storige.test.evil.test',
      'https://sub.editor.storige.test',
    ]) {
      const result = parseEditorMessage(message({ origin }), GATE);
      expect(result).toEqual({ ok: false, reason: 'ORIGIN_NOT_ALLOWED' });
    }
  });

  it('② 같은 오리진의 다른 프레임/팝업은 차단된다', () => {
    const sibling = { name: 'sibling frame' };
    const result = parseEditorMessage(message({ source: sibling }), GATE);
    expect(result).toEqual({ ok: false, reason: 'SOURCE_WINDOW_MISMATCH' });
  });

  it('② iframe 미로드(null) 도 불일치로 처리된다', () => {
    const result = parseEditorMessage(message(), {
      allowedOrigins: [EDITOR_ORIGIN],
      expectedSource: null,
    });
    expect(result).toEqual({ ok: false, reason: 'SOURCE_WINDOW_MISMATCH' });
  });

  it('② expectedSource=null 은 source:null 메시지도 통과시키지 않는다(fail-open 방지)', () => {
    // 닫힌 윈도우·worker·MessagePort 발신은 source 가 null 이다.
    // 단순 `!==` 비교였다면 null !== null === false 로 게이트를 통과했을 자리.
    const result = parseEditorMessage(message({ source: null }), {
      allowedOrigins: [EDITOR_ORIGIN],
      expectedSource: null,
    });
    expect(result).toEqual({ ok: false, reason: 'SOURCE_WINDOW_MISMATCH' });
  });

  it('②는 fail-closed — expectedSource 를 빠뜨리면 통과가 아니라 TypeError', () => {
    expect(() =>
      parseEditorMessage(
        message(),
        // @ts-expect-error expectedSource 는 필수다 — 타입에서도 막힌다
        { allowedOrigins: [EDITOR_ORIGIN] },
      ),
    ).toThrow(TypeError);
    expect(() =>
      parseEditorMessage(message(), {
        allowedOrigins: [EDITOR_ORIGIN],
        expectedSource: undefined as unknown as null,
      }),
    ).toThrow(/expectedSource/);
  });

  it('②를 끄는 유일한 경로는 SKIP_SOURCE_CHECK 리터럴 명시다', () => {
    const result = parseEditorMessage(message({ source: { other: true } }), {
      allowedOrigins: [EDITOR_ORIGIN],
      expectedSource: SKIP_SOURCE_CHECK,
    });
    expect(result.ok).toBe(true);
  });

  it('③ 레거시 storige:* dual-emit 은 봉투 게이트에서 탈락한다', () => {
    const result = parseEditorMessage(
      message({ data: { type: 'storige:completed', sessionId: 's1' } }),
      GATE,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_EDITOR_ENVELOPE' });
  });

  it('③ 미래 version 은 조용히 무시된다', () => {
    const result = parseEditorMessage(
      message({ data: { ...(envelope('editor.ready') as object), version: '2' } }),
      GATE,
    );
    expect(result).toEqual({ ok: false, reason: 'VERSION_MISMATCH' });
  });

  it('④ event 가 문자열이 아니면 탈락', () => {
    const result = parseEditorMessage(
      message({ data: { ...(envelope('x') as object), event: 42 } }),
      GATE,
    );
    expect(result).toEqual({ ok: false, reason: 'NOT_EDITOR_ENVELOPE' });
  });

  it('미지 이벤트도 봉투로서는 유효하다 — 무시 판단은 상위 계층 몫', () => {
    const result = parseEditorMessage(
      message({ data: envelope('editor.thumbnail', { page: 3 }) }),
      GATE,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.envelope.event).toBe('editor.thumbnail');
  });
});

// ── 게스트 함정 ─────────────────────────────────────────────────────────

describe('readCompletePayload — 게스트 분기와 토큰 비노출', () => {
  const memberPayload = {
    sessionId: 'sess-1',
    orderSeqno: 12345,
    editCode: 'EDIT-ABCDEF12',
    pages: { initial: 24, final: 26 },
    pageCount: 26,
    size: { width: 210, height: 297, unit: 'mm' },
    files: { coverFileId: 'f-cover', contentFileId: 'f-content' },
    savedAt: '2026-07-28T00:00:00.000Z',
  };

  it('회원 완료 — action=promote, needsAuth=false, 중첩 files 보존', () => {
    const done = readCompletePayload(memberPayload);
    expect(done).not.toBeNull();
    expect(done?.needsAuth).toBe(false);
    expect(done?.action).toBe('promote');
    expect(done?.hasGuestToken).toBe(false);
    expect(done?.files.coverFileId).toBe('f-cover');
    expect(done?.pages).toEqual({ initial: 24, final: 26 });
    expect(done?.size).toEqual({ width: 210, height: 297, unit: 'mm' });
    expect(decideCompleteAction(done)).toBe('promote');
  });

  it('게스트 완료 — needsAuth=true, guestToken 값은 결과 어디에도 없다', () => {
    const done = readCompletePayload({
      sessionId: 'sess-2',
      needsAuth: true,
      guestToken: 'super-secret-guest-token',
      pages: { initial: 4, final: 4 },
      files: {},
      savedAt: '2026-07-28T00:00:00.000Z',
    });
    expect(done?.needsAuth).toBe(true);
    expect(done?.action).toBe('require-login');
    expect(done?.hasGuestToken).toBe(true);
    expect(JSON.stringify(done)).not.toContain('super-secret-guest-token');
    expect(decideCompleteAction(done)).toBe('require-login');
  });

  it('guestToken 만 있고 needsAuth 가 없어도 게스트로 본다(fail-closed)', () => {
    const done = readCompletePayload({
      sessionId: 'sess-3',
      guestToken: 'tok',
      files: {},
    });
    expect(done?.needsAuth).toBe(true);
    expect(done?.action).toBe('require-login');
  });

  it('sessionId 가 없으면 null → decideCompleteAction=ignore', () => {
    expect(readCompletePayload({ files: {} })).toBeNull();
    expect(readCompletePayload(null)).toBeNull();
    expect(readCompletePayload('nope')).toBeNull();
    expect(decideCompleteAction(null)).toBe('ignore');
  });
});

// ── URL 조립 ────────────────────────────────────────────────────────────

describe('buildEmbedUrl — parentOrigin 강제', () => {
  const base = {
    editorOrigin: EDITOR_ORIGIN,
    parentOrigin: PARENT_ORIGIN,
    params: { token: 'jwt', templateSetId: 'TS_8x8' },
  };

  it('parentOrigin 을 항상 실어 준다', () => {
    const url = new URL(buildEmbedUrl(base));
    expect(url.origin).toBe(EDITOR_ORIGIN);
    expect(url.pathname).toBe('/embed');
    expect(url.searchParams.get('parentOrigin')).toBe(PARENT_ORIGIN);
    expect(url.searchParams.get('token')).toBe('jwt');
    expect(url.searchParams.get('templateSetId')).toBe('TS_8x8');
  });

  it('parentOrigin 누락·와일드카드는 던진다 — 레거시 폴백을 유도하지 않는다', () => {
    expect(() =>
      buildEmbedUrl({ ...base, parentOrigin: '' }),
    ).toThrow(StorigeUsageError);
    expect(() => buildEmbedUrl({ ...base, parentOrigin: '*' })).toThrow(
      /와일드카드/,
    );
    expect(() =>
      buildEmbedUrl({
        ...base,
        parentOrigin: undefined as unknown as string,
      }),
    ).toThrow(StorigeUsageError);
  });

  it('경로·쿼리가 붙은 오리진은 거부한다(정확 일치 비교가 영원히 실패하므로)', () => {
    expect(() =>
      buildEmbedUrl({ ...base, parentOrigin: `${PARENT_ORIGIN}/shop` }),
    ).toThrow(/오리진/);
    expect(() =>
      buildEmbedUrl({ ...base, editorOrigin: `${EDITOR_ORIGIN}/embed` }),
    ).toThrow(StorigeUsageError);
    // 후행 슬래시는 관용
    expect(() =>
      buildEmbedUrl({ ...base, parentOrigin: `${PARENT_ORIGIN}/` }),
    ).not.toThrow();
  });

  it('token 과 (templateSetId | sessionId) 는 필수다', () => {
    expect(() =>
      buildEmbedUrl({ ...base, params: { token: '', templateSetId: 'T' } }),
    ).toThrow(/token/);
    expect(() =>
      buildEmbedUrl({ ...base, params: { token: 'jwt' } }),
    ).toThrow(/templateSetId/);
    expect(() =>
      buildEmbedUrl({ ...base, params: { token: 'jwt', sessionId: 'sess' } }),
    ).not.toThrow();
  });

  it("레거시 루트 '/' 경로는 거부한다(완료 메시지 미발신)", () => {
    expect(() => buildEmbedUrl({ ...base, path: '/' })).toThrow(/레거시/);
    expect(() => buildEmbedUrl({ ...base, path: 'embed' })).toThrow(/'\/'/);
  });

  it('extraParams 로 parentOrigin 을 덮어쓸 수 없다', () => {
    expect(() =>
      buildEmbedUrl({
        ...base,
        extraParams: { parentOrigin: 'https://evil.test' },
      }),
    ).toThrow(/parentOrigin/);
    expect(() =>
      buildEmbedUrl({
        ...base,
        extraParams: { parent_origin: 'https://evil.test' },
      }),
    ).toThrow(/parentOrigin/);
  });

  it('선택 파라미터 직렬화 — boolean 은 1/0, undefined 는 생략', () => {
    const url = new URL(
      buildEmbedUrl({
        ...base,
        params: {
          token: 'jwt',
          templateSetId: 'TS',
          orderSeqno: 12345,
          mode: 'both',
          allowSampleFallback: true,
        },
        extraParams: { future_flag: 'on' },
      }),
    );
    expect(url.searchParams.get('orderSeqno')).toBe('12345');
    expect(url.searchParams.get('mode')).toBe('both');
    expect(url.searchParams.get('allowSampleFallback')).toBe('1');
    expect(url.searchParams.get('future_flag')).toBe('on');
    expect(url.searchParams.has('refreshToken')).toBe(false);
  });

  it('normalizeOrigin 은 후행 슬래시를 정규화한다', () => {
    expect(normalizeOrigin('x', 'https://a.test/')).toBe('https://a.test');
    expect(normalizeOrigin('x', 'https://a.test:8443')).toBe(
      'https://a.test:8443',
    );
    expect(() => normalizeOrigin('x', 'ftp://a.test')).toThrow(/http/);
  });
});
