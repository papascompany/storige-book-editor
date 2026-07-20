/**
 * 오프라인 검증(드라이런) — `node src/verify.ts`
 *
 * 서버 없이 단언한다:
 *   A.  postMessage 게이트 — 브라우저가 실행하는 바로 그 모듈(public/editor-events.js)을
 *       import 해서 위조 오리진·다른 프레임·레거시 dual-emit 이 전부 막히는지 확인.
 *       `expectedSource` 를 빠뜨렸을 때 **던지는지**(fail-closed)까지 확인한다.
 *   A'. 게스트 완료 분기 — `editor.complete`(needsAuth:true) 에서 승격을 **중단**하는지
 *   B.  승격 호출 시퀀스 — 주입식 fetch 로 실제 SDK 를 통과시켜 경로·메서드·헤더·
 *       봉투 언랩과 404/409 분기를 확인
 *   B'. `bookSpecUid`/`pageCount` 전달 — 미검증 FINALIZED(D-9) 회피 배선
 */

import assert from 'node:assert/strict';

import { StorigeClient } from '@storige/sdk/client';

import {
  decideCompleteAction,
  parseEditorMessage,
  readCompletePayload,
  SKIP_SOURCE_CHECK,
} from '../public/editor-events.js';
import { PromoteRejected, promoteSession } from './promote.ts';

const EDITOR_ORIGIN = 'https://editor.example.test';
const ALLOWED = [EDITOR_ORIGIN];

// 브라우저에서는 iframe.contentWindow 다. Node 에는 window 가 없으므로 대역 객체를 쓴다.
const IFRAME_WINDOW = { id: 'our-iframe' };

function envelope(event: string, payload: unknown): Record<string, unknown> {
  return {
    source: 'storige-editor',
    version: '1',
    event,
    payload,
    timestamp: '2026-07-20T00:00:00.000Z',
  };
}

// ── A. postMessage 게이트 ───────────────────────────────────────────────

function verifyMessageGate(): void {
  const complete = envelope('editor.complete', {
    sessionId: 'sess_abc',
    orderSeqno: 1234,
    pageCount: 24,
    files: { coverFileId: 'f1', contentFileId: 'f2' },
    savedAt: '2026-07-20T00:00:00.000Z',
  });

  // 정상 — 4단 게이트 통과
  const okResult = parseEditorMessage(
    { origin: EDITOR_ORIGIN, source: IFRAME_WINDOW, data: complete },
    { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
  );
  assert.equal(okResult.ok, true);
  if (okResult.ok) assert.equal(okResult.envelope.event, 'editor.complete');

  // ① 다른 오리진 — 접미 일치 우회(evil-editor.example.test 등)도 막혀야 한다
  for (const origin of [
    'https://evil.test',
    'https://evil-editor.example.test',
    'http://editor.example.test', // 스킴 다름
    'https://editor.example.test.evil.test',
  ]) {
    const result = parseEditorMessage(
      { origin, source: IFRAME_WINDOW, data: complete },
      { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
    );
    assert.deepEqual(result, { ok: false, reason: 'ORIGIN_NOT_ALLOWED' }, `origin=${origin}`);
  }

  // ② 오리진은 맞지만 우리 iframe 이 아닌 프레임/팝업
  assert.deepEqual(
    parseEditorMessage(
      { origin: EDITOR_ORIGIN, source: { id: 'other-frame' }, data: complete },
      { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
    ),
    { ok: false, reason: 'SOURCE_WINDOW_MISMATCH' },
  );

  // ③ 레거시 dual-emit(`{type:'storige:completed'}`) — 신규 연동은 듣지 않는다
  assert.deepEqual(
    parseEditorMessage(
      {
        origin: EDITOR_ORIGIN,
        source: IFRAME_WINDOW,
        data: { type: 'storige:completed', payload: { sessionId: 'sess_abc' } },
      },
      { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
    ),
    { ok: false, reason: 'NOT_EDITOR_ENVELOPE' },
  );

  // ③' 봉투를 흉내 냈지만 version 이 다름 — 추측하지 말고 무시
  assert.deepEqual(
    parseEditorMessage(
      { origin: EDITOR_ORIGIN, source: IFRAME_WINDOW, data: { ...complete, version: '2' } },
      { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
    ),
    { ok: false, reason: 'VERSION_MISMATCH' },
  );

  // ④ 모르는 이벤트는 통과시키되 호출측이 무시한다(카탈로그는 additive 로 자란다)
  const future = parseEditorMessage(
    { origin: EDITOR_ORIGIN, source: IFRAME_WINDOW, data: envelope('editor.futureThing', {}) },
    { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
  );
  assert.equal(future.ok, true, '모르는 이벤트에서 크래시하지 않는다');

  // ⑤ expectedSource 생략은 **fail-closed** — 조용히 ② 게이트가 사라지면 안 된다.
  //    한 줄 빠뜨린 통합이 "공격자 프레임 payload 도 ok:true" 가 되던 초판 구멍.
  assert.throws(
    () =>
      parseEditorMessage(
        { origin: EDITOR_ORIGIN, source: { id: 'attacker-frame' }, data: complete },
        // @ts-expect-error expectedSource 는 필수다 — 타입에서도 막힌다
        { allowedOrigins: ALLOWED },
      ),
    (error: unknown) => error instanceof TypeError,
    'expectedSource 를 빠뜨리면 통과시키지 말고 던져야 한다',
  );

  // ⑤' 의도적 우회는 **명시 리터럴로만**. 이 문자열을 손으로 적어야만 ②가 꺼진다.
  const skipped = parseEditorMessage(
    { origin: EDITOR_ORIGIN, source: { id: 'any-frame' }, data: complete },
    { allowedOrigins: ALLOWED, expectedSource: SKIP_SOURCE_CHECK },
  );
  assert.equal(skipped.ok, true, '명시적 우회 리터럴일 때만 ② 를 건너뛴다');

  // ⑤'' contentWindow 가 아직 null(로드 전)이면 우회가 아니라 **불일치**다
  assert.deepEqual(
    parseEditorMessage(
      { origin: EDITOR_ORIGIN, source: IFRAME_WINDOW, data: complete },
      { allowedOrigins: ALLOWED, expectedSource: null },
    ),
    { ok: false, reason: 'SOURCE_WINDOW_MISMATCH' },
  );

  // payload 파싱 — sessionId 없는 payload 는 null(승격을 시도조차 하지 않는다)
  assert.deepEqual(readCompletePayload(complete.payload), {
    sessionId: 'sess_abc',
    needsAuth: false,
    hasGuestToken: false,
    orderSeqno: 1234,
    pageCount: 24,
  });
  assert.equal(readCompletePayload({ files: {} }), null);
  assert.equal(readCompletePayload(null), null);

  console.log('✓ A. postMessage 게이트 — 오리진 4종·타 프레임·레거시·버전 불일치 차단 + expectedSource 누락 fail-closed');
}

// ── A'. 게스트 완료 분기 ────────────────────────────────────────────────

/**
 * 게스트 세션 완료의 **실제 발신 순서**를 재현한다.
 *
 * 편집기(apps/editor/src/embed.tsx)는 게스트 완료 시
 *   ① `editor.complete` { needsAuth:true, guestToken, ... }   ← 먼저
 *   ② `editor.needAuth` { guestToken, reason:'complete_save' } ← 나중
 * 순으로 보낸다. 그래서 `editor.needAuth` 를 기다렸다 분기하면 **늦다** —
 * 그 사이 승격을 때려 404 를 맞는다. 분기 근거는 complete payload 의 needsAuth 다.
 */
function verifyGuestBranch(): void {
  const guestComplete = envelope('editor.complete', {
    sessionId: 'sess_guest',
    needsAuth: true,
    guestToken: 'gt_demo_not_a_real_token',
    pages: { initial: 1, final: 1 },
    files: {},
    savedAt: '2026-07-20T00:00:00.000Z',
  });

  const parsed = parseEditorMessage(
    { origin: EDITOR_ORIGIN, source: IFRAME_WINDOW, data: guestComplete },
    { allowedOrigins: ALLOWED, expectedSource: IFRAME_WINDOW },
  );
  assert.equal(parsed.ok, true, '게스트 complete 도 정식 엔벨로프다 — 게이트는 통과한다');

  const guest = readCompletePayload(guestComplete.payload);
  assert.equal(guest?.needsAuth, true, 'needsAuth 가 노출돼야 호출측이 분기할 수 있다');
  assert.equal(guest?.hasGuestToken, true);
  // 🔒 guestToken **값**은 돌려주지 않는다 — 로그·DOM 유출 시 세션 탈취로 이어진다
  assert.equal(
    Object.prototype.hasOwnProperty.call(guest ?? {}, 'guestToken'),
    false,
    '게스트 토큰 값은 파싱 결과에 담지 않는다(유무만)',
  );

  // 🚨 핵심 단언 — 게스트는 승격을 **시도조차 하지 않는다**
  assert.equal(decideCompleteAction(guest), 'require-login');

  // needsAuth 없이 guestToken 만 온 형태도 게스트로 본다(fail-closed)
  assert.equal(
    decideCompleteAction(readCompletePayload({ sessionId: 's', guestToken: 'gt_x' })),
    'require-login',
  );

  // 회원 세션은 그대로 승격한다(게이트가 정상 경로를 막지 않는다)
  assert.equal(
    decideCompleteAction(readCompletePayload({ sessionId: 'sess_member' })),
    'promote',
  );
  assert.equal(decideCompleteAction(readCompletePayload({ files: {} })), 'ignore');

  console.log("✓ A'. 게스트 분기 — editor.complete(needsAuth:true) 에서 승격 중단(404 자초 방지)");
}

// ── B. 승격 호출 시퀀스 ─────────────────────────────────────────────────

interface Call {
  method: string;
  path: string;
  headers: Record<string, string>;
  json: unknown;
}

type Route = () => { status?: number; json: unknown };

function ok<T>(data: T): unknown {
  return { success: true, message: 'Success', data, pagination: null };
}

function fail(errorCode: string, errors: Array<{ code: string; message: string }> = []): unknown {
  return { success: false, errorCode, message: '오류', errors, fieldErrors: null, requestId: 'r1' };
}

function createMock(routes: Record<string, Route>): {
  fetch: typeof globalThis.fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  type FetchArgs = Parameters<typeof globalThis.fetch>;

  const impl = async (input: FetchArgs[0], init?: FetchArgs[1]): Promise<Response> => {
    const url = new URL(String(input));
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    const body = init?.body;
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      headers,
      json: typeof body === 'string' ? JSON.parse(body) : null,
    });

    const key = `${init?.method ?? 'GET'} ${url.pathname}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`mock 라우트 없음: ${key}`);
    const result = route();
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetch: impl as unknown as typeof globalThis.fetch, calls };
}

const BOOK = {
  uid: 'bk_sess',
  env: 'test' as const,
  creationType: 'EDITOR_SESSION' as const,
  status: 'DRAFT' as const,
  bookSpecUid: null,
  pageCount: 24,
  title: '임베드 편집 주문',
  partnerRef: 'demo-1',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  finalizedAt: null,
};

const FIN = {
  uid: 'fin_sess',
  bookUid: 'bk_sess',
  status: 'PENDING',
  attempt: 1,
  pageCount: null,
  validationSkipped: false,
  outputFileId: null,
  errorCode: null,
  errorDetail: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
};

function client(fetchImpl: typeof globalThis.fetch): StorigeClient {
  return new StorigeClient({
    apiKey: 'sk_test_example_not_a_real_key',
    baseUrl: 'https://api.example.test',
    fetch: fetchImpl,
  });
}

async function verifyPromoteSequence(): Promise<void> {
  const mock = createMock({
    'POST /api/v1/books': () => ({ json: ok(BOOK) }),
    'POST /api/v1/books/bk_sess/finalization': () => ({ json: ok(FIN) }),
  });

  const result = await promoteSession(client(mock.fetch), {
    sessionId: 'sess_abc',
    partnerRef: 'demo-1',
    title: '임베드 편집 주문',
  });

  assert.deepEqual(
    mock.calls.map((c) => `${c.method} ${c.path}`),
    ['POST /api/v1/books', 'POST /api/v1/books/bk_sess/finalization'],
    'EDITOR_SESSION 승격은 2콜 — 자산 투입 라우트가 없다(세션 산출물이 자동 연결된다)',
  );

  // 승격 본문 — creationType + sessionId 가 계약이다
  assert.deepEqual(mock.calls[0]?.json, {
    creationType: 'EDITOR_SESSION',
    sessionId: 'sess_abc',
    partnerRef: 'demo-1',
    title: '임베드 편집 주문',
  });

  // JSON 본문이라 멱등키 자동 부여 — 브라우저 재시도가 도서를 중복 생성하지 않는다
  assert.ok((mock.calls[0]?.headers['idempotency-key'] ?? '').length > 0);
  assert.equal(mock.calls[0]?.headers['authorization'], 'Bearer sk_test_example_not_a_real_key');

  assert.equal(result.book.uid, 'bk_sess');
  assert.equal(result.finalization.status, 'PENDING');

  // 🖨️ 판형 미전달 = 미검증 FINALIZED 예고. 웹훅을 기다리지 않고 지금 알 수 있다(D-9).
  assert.equal(result.willSkipValidation, true, 'bookSpecUid 없이 승격하면 검증이 생략된다');

  console.log('✓ B. 승격 시퀀스 — POST /books(EDITOR_SESSION) → POST /finalization, 멱등키 자동 부여');
}

// ── B'. 판형 전달 (D-9 인쇄 게이트) ─────────────────────────────────────

async function verifyBookSpecPassthrough(): Promise<void> {
  const mock = createMock({
    'POST /api/v1/books': () => ({ json: ok({ ...BOOK, bookSpecUid: 'bs_a4', pageCount: 24 }) }),
    'POST /api/v1/books/bk_sess/finalization': () => ({ json: ok(FIN) }),
  });

  const result = await promoteSession(client(mock.fetch), {
    sessionId: 'sess_abc',
    partnerRef: 'demo-1',
    bookSpecUid: 'bs_a4',
    pageCount: 24,
  });

  // 옵션 파라미터가 **실제로 본문에 실려 나가는지** — 주석만 있고 배선이 없으면 소용없다
  assert.deepEqual(mock.calls[0]?.json, {
    creationType: 'EDITOR_SESSION',
    sessionId: 'sess_abc',
    partnerRef: 'demo-1',
    bookSpecUid: 'bs_a4',
    pageCount: 24,
  });
  assert.equal(result.willSkipValidation, false, '판형이 붙으면 검증이 돈다');

  console.log("✓ B'. bookSpecUid/pageCount 전달 — 미검증 FINALIZED(D-9) 회피 경로가 배선돼 있다");
}

async function verifyPromoteRejections(): Promise<void> {
  // 교차 테넌트 / NULL-site(게스트) / 미존재 — 전부 404 한 코드(존재 은닉)
  const notFound = createMock({
    'POST /api/v1/books': () => ({ status: 404, json: fail('ERR_NOT_FOUND') }),
  });
  await assert.rejects(
    promoteSession(client(notFound.fetch), { sessionId: 'sess_other_tenant', partnerRef: 'x' }),
    (error: unknown) =>
      error instanceof PromoteRejected &&
      error.status === 404 &&
      error.reason === 'SESSION_NOT_FOUND',
    '교차 테넌트/NULL-site 세션은 404 로 거부된다',
  );

  // 편집이 끝나지 않은 세션
  const notComplete = createMock({
    'POST /api/v1/books': () => ({
      status: 409,
      json: fail('ERR_SESSION_NOT_PROMOTABLE', [
        { code: 'SESSION_NOT_COMPLETE', message: '완료 상태 세션만 승격할 수 있습니다' },
      ]),
    }),
  });
  await assert.rejects(
    promoteSession(client(notComplete.fetch), { sessionId: 'sess_draft', partnerRef: 'x' }),
    (error: unknown) =>
      error instanceof PromoteRejected &&
      error.status === 409 &&
      error.reason === 'SESSION_NOT_COMPLETE',
    '미완료 세션은 409 + 세부 코드로 구분된다',
  );

  // 최종화가 이미 진행 중 — 실패가 아니라 기존 attempt 합류
  const inProgress = createMock({
    'POST /api/v1/books': () => ({ json: ok(BOOK) }),
    'POST /api/v1/books/bk_sess/finalization': () => ({
      status: 409,
      json: fail('ERR_FINALIZATION_IN_PROGRESS'),
    }),
    'GET /api/v1/books/bk_sess/finalization': () => ({
      json: ok({ ...FIN, status: 'VALIDATING', attempt: 1 }),
    }),
  });
  const joined = await promoteSession(client(inProgress.fetch), {
    sessionId: 'sess_abc',
    partnerRef: 'x',
  });
  assert.equal(joined.finalization.status, 'VALIDATING');

  console.log('✓ C. 거부 분기 — 404 존재 은닉 / 409 SESSION_NOT_COMPLETE / 409 진행 중 합류');
}

async function main(): Promise<void> {
  verifyMessageGate();
  verifyGuestBranch();
  await verifyPromoteSequence();
  await verifyBookSpecPassthrough();
  await verifyPromoteRejections();
  console.log('\n✓ editor-session-order 오프라인 검증 5/5 통과');
}

main().catch((error: unknown) => {
  console.error('✗ 검증 실패:', error);
  process.exitCode = 1;
});
