/**
 * E2E 검증 — `node src/verify.ts` (프로덕션·외부 의존 0)
 *
 * 실제 express 서버를 임시 포트로 띄우고, **테스트 secret 으로 서명을 직접 만들어**
 * HTTP 로 던진다. 발신부(서버)가 없어도 수신 배선 전체가 진짜로 도는지 확인한다.
 *
 *   ①   정상 서명        → 200 {received:true} + 핸들러 1회 실행
 *   ②   위조 서명        → 401 {error:'SIGNATURE_MISMATCH'} + 핸들러 미실행
 *   ③   중복 delivery uid → 200 {received:true,duplicate:true} + 핸들러 미실행
 *   ③'  **서명 고정 + uid 헤더만 교체**(jobId 서명 페이로드) → 200, 핸들러 재진입,
 *       그러나 도메인 멱등이 부수효과를 1회로 묶는다
 *   ③'' 같은 조작을 book.finalization.* 에 하면 → 401 (uid 가 서명 안에 있다)
 *   ④   secret 미설정     → 팩토리가 던져 **부팅 실패**(첫 웹훅까지 미루지 않는다)
 *   ⑤   express.json() 누락 → 500 {error:'ADAPTER_MISCONFIGURED'} (401 로 위장하지 않는다)
 *   ⑥   replay 창 밖 t    → 400 {error:'TIMESTAMP_OUT_OF_TOLERANCE'}
 *
 * ## 서명 규약 (발신부 정본)
 *   data   = `${t}.${identifier}:${event}:${timestamp}`
 *   헤더   = `X-Storige-Signature-HMAC: t=<unix초>,v1=<hmac-sha256 hex>`
 *   t          서명 시각(재시도마다 갱신) — replay 판정은 **이 값**으로 한다
 *   timestamp  이벤트 시각(ISO, 재시도해도 불변) — 여기에 신선도 게이트를 걸면
 *              30분 뒤 재시도가 죽는다
 *   identifier v2 경로 = `jobId ?? sessionId ?? <X-Storige-Delivery 헤더값>`
 *
 * ## ⚠️ identifier 가 무엇이냐에 따라 uid 재생 공격의 성립 여부가 갈린다
 *   - `synthesis.*` · `validation.*` · `session.*` → jobId/sessionId 로 서명
 *     = **uid 는 서명 밖** → 캡처한 서명 그대로 uid 만 바꿔 재생 가능 (③')
 *   - `book.finalization.*`                        → jobId/sessionId 가 없어 uid 로 서명
 *     = **uid 가 서명 안** → uid 변조는 401 (③'')
 *   두 경우를 한 문장으로 뭉뚱그리면 재현되지 않는 주장이 된다. 그래서 둘 다 돌린다.
 */

import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { StorigeUsageError } from '@storige/sdk';
import type { StorigeWebhookPayload } from '@storige/sdk/webhook';

import { createApp, type AppOptions } from './app.ts';
import {
  createStorigeWebhookHandler,
  InMemoryDomainIdempotency,
  type DomainIdempotency,
} from './handler.ts';

const SECRET = 'whsec_test_only_generated_locally';
const WRONG_SECRET = 'whsec_attacker_guess';

// ── 서명 생성(발신부 규약 재현) ─────────────────────────────────────────

function signHeader(
  secret: string,
  fields: { identifier: string; event: string; timestamp: string },
  t = Math.floor(Date.now() / 1000),
): string {
  const data = `${t}.${fields.identifier}:${fields.event}:${fields.timestamp}`;
  const v1 = createHmac('sha256', secret).update(data).digest('hex');
  return `t=${t},v1=${v1}`;
}

interface Delivery {
  deliveryUid: string;
  payload: StorigeWebhookPayload;
}

function newDeliveryUid(): string {
  return `whd_${randomUUID().replace(/-/g, '')}`;
}

function finalizationDelivery(deliveryUid = newDeliveryUid()): Delivery {
  return {
    deliveryUid,
    payload: {
      event: 'book.finalization.completed',
      bookUid: 'bk_demo',
      finalizationUid: 'fin_demo',
      status: 'completed',
      pageCount: 24,
      outputFileId: 'file_out',
      validationSkipped: false,
      timestamp: new Date().toISOString(),
    },
  };
}

/**
 * `synthesis.completed` — **jobId 로 서명되는** 페이로드.
 *
 * `book.finalization.*` 와 결정적으로 다르다: v2 발신 identifier 는
 * `jobId ?? sessionId ?? delivery.uid` 라서 jobId 가 있으면 **delivery uid 가 서명에
 * 들어가지 않는다**. 즉 유효 서명 1건으로 uid 만 갈아끼운 재생이 성립한다(③').
 *
 * `timestamp` 를 인자로 받는 이유: 재생은 **같은 payload 를 다른 객체로** 던져야
 * 단언이 동어반복이 되지 않는다(같은 참조를 재사용하면 무엇을 비교해도 통과한다).
 */
function synthesisDelivery(
  deliveryUid: string,
  timestamp: string,
  jobId = 'job_demo',
): Delivery {
  return {
    deliveryUid,
    payload: {
      event: 'synthesis.completed',
      jobId,
      sessionId: 'sess_demo',
      orderSeqno: 1234,
      status: 'completed',
      outputFileUrl: 'https://files.example.test/merged.pdf',
      outputFormat: 'merged',
      timestamp,
    },
  };
}

// ── 테스트 서버 ─────────────────────────────────────────────────────────

interface Harness {
  url: string;
  /** SDK 파이프라인이 핸들러를 부른 횟수(=uid 단락을 통과한 배달) */
  handled: string[];
  /** 도메인 멱등이 **실제로 허용한** 부수효과 키(=진짜 처리된 건) */
  granted: string[];
  close: () => Promise<void>;
}

/** 도메인 멱등 통과분을 기록하는 래퍼 — 단락이 진짜로 도는지 단언하기 위한 것 */
class RecordingDomainIdempotency implements DomainIdempotency {
  readonly granted: string[] = [];
  private readonly inner = new InMemoryDomainIdempotency();

  claim(domainKey: string): boolean {
    const first = this.inner.claim(domainKey);
    if (first) this.granted.push(domainKey);
    return first;
  }
}

async function boot(overrides: Partial<AppOptions> = {}): Promise<Harness> {
  const handled: string[] = [];
  const processed = new RecordingDomainIdempotency();
  const domainHandler = createStorigeWebhookHandler({ processed, log: () => {} });

  const app = createApp({
    secret: SECRET,
    handler: async (payload, ctx) => {
      handled.push(payload.event);
      await domainHandler(payload, ctx);
    },
    ...overrides,
  });

  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/webhooks/storige`,
    handled,
    granted: processed.granted,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function post(
  url: string,
  delivery: Delivery,
  signature: string,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Storige-Event': delivery.payload.event,
      'X-Storige-Delivery': delivery.deliveryUid,
      'X-Storige-Signature-HMAC': signature,
    },
    body: JSON.stringify(delivery.payload),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * v2 발신 서명 필드 — identifier = `jobId ?? sessionId ?? delivery uid`.
 * (SDK `webhook/signature.ts` resolveIdentifierV2 미러)
 *
 * ⚠️ 이 한 줄이 ③'/③'' 의 결과를 가른다:
 *   - `book.finalization.*` → jobId/sessionId 가 없다 → **uid 가 서명 안에 있다**
 *   - `synthesis.*` 등      → jobId 가 있다          → **uid 는 서명 밖이다**
 */
function fieldsOf(delivery: Delivery): { identifier: string; event: string; timestamp: string } {
  const payload = delivery.payload as unknown as Record<string, unknown>;
  const jobId = payload['jobId'];
  const sessionId = payload['sessionId'];
  const identifier =
    typeof jobId === 'string' && jobId !== ''
      ? jobId
      : typeof sessionId === 'string' && sessionId !== ''
        ? sessionId
        : delivery.deliveryUid;
  return {
    identifier,
    event: delivery.payload.event,
    timestamp: delivery.payload.timestamp,
  };
}

// ── ①②③ 정상 / 위조 / 중복 ─────────────────────────────────────────────

async function verifyDeliveries(): Promise<void> {
  const app = await boot();
  try {
    // ① 정상 서명
    const first = finalizationDelivery();
    const okRes = await post(app.url, first, signHeader(SECRET, fieldsOf(first)));
    assert.equal(okRes.status, 200, '정상 서명은 200');
    assert.deepEqual(okRes.body, { received: true });
    assert.deepEqual(app.handled, ['book.finalization.completed'], '핸들러가 1회 실행됐다');
    console.log('✓ ① 정상 서명 → 200 {received:true} + 핸들러 실행');

    // ② 위조 서명 — 공격자가 secret 을 모르고 만든 HMAC
    const forged = finalizationDelivery();
    const forgedRes = await post(app.url, forged, signHeader(WRONG_SECRET, fieldsOf(forged)));
    assert.equal(forgedRes.status, 401, '서명 불일치는 401');
    assert.deepEqual(forgedRes.body, { error: 'SIGNATURE_MISMATCH' });
    assert.equal(app.handled.length, 1, '위조 요청은 핸들러에 닿지 않는다');
    console.log('✓ ② 위조 서명 → 401 SIGNATURE_MISMATCH + 핸들러 미실행');

    // ③ 같은 delivery uid 재배달(= 서버 재시도) — 서명은 새 t 로 재계산된다
    const retry: Delivery = { deliveryUid: first.deliveryUid, payload: first.payload };
    const dupRes = await post(app.url, retry, signHeader(SECRET, fieldsOf(retry)));
    assert.equal(dupRes.status, 200, '중복은 200 이어야 서버 재시도 체인이 끊긴다');
    assert.deepEqual(dupRes.body, { received: true, duplicate: true });
    assert.equal(app.handled.length, 1, '중복 배달은 핸들러를 다시 부르지 않는다');
    console.log('✓ ③ 중복 delivery uid → 200 {duplicate:true} + 핸들러 미실행');

    // ③' **캡처한 서명을 한 글자도 바꾸지 않고**, uid 헤더만 갈아끼운 재생.
    //
    //     공격자 모델: 유효 서명 1건을 관측했을 뿐 secret 은 모른다 → 재서명 불가.
    //     그래서 서명 문자열을 **재사용**한다(재서명하면 그건 시크릿 보유자의 시연이지
    //     공격자 시나리오가 아니다).
    //
    //     성립 조건: identifier 가 jobId 로 정해지는 페이로드여야 한다. 그래야 uid 가
    //     서명 data 밖이라 헤더를 바꿔도 서명이 여전히 유효하다.
    //     (book.finalization.* 로는 성립하지 않는다 — ③'' 참조)
    const capturedTs = new Date().toISOString();
    const original = synthesisDelivery(newDeliveryUid(), capturedTs);
    const capturedSignature = signHeader(SECRET, fieldsOf(original)); // ← 단 1회 서명

    const originalRes = await post(app.url, original, capturedSignature);
    assert.equal(originalRes.status, 200, '원본 배달은 정상 처리된다');
    assert.deepEqual(originalRes.body, { received: true });
    assert.equal(app.handled.length, 2);

    // 같은 payload를 **별개 객체**로 다시 만든다 — 같은 참조를 재사용하면 도메인 키가
    // 상수가 되어 granted 단언이 동어반복(vacuous)이 된다.
    const replayed = synthesisDelivery(newDeliveryUid(), capturedTs);
    assert.notEqual(replayed.payload, original.payload, '재생 payload 는 별개 객체다');
    assert.notEqual(replayed.deliveryUid, original.deliveryUid, 'uid 만 갈아끼웠다');

    const replayRes = await post(app.url, replayed, capturedSignature); // ← 서명 그대로
    assert.equal(replayRes.status, 200, '서명이 uid 를 덮지 않으므로 그대로 유효하다');
    assert.deepEqual(replayRes.body, { received: true }, 'uid 가 다르므로 SDK 단락은 통과한다');
    assert.equal(app.handled.length, 3, 'SDK 단락만으로는 핸들러 재진입을 막지 못한다');

    // 그러나 부수효과는 **한 번만** 났다 — 도메인 키(synthesis.completed:job_demo)로
    // 막았기 때문이다. 이것이 "멱등은 인증 통제가 아니다"에 대한 실제 방어다.
    assert.deepEqual(
      app.granted,
      ['book.finalization.completed:fin_demo', 'synthesis.completed:job_demo'],
      '도메인 멱등이 uid 재생의 부수효과를 1회로 묶는다',
    );
    console.log(
      "✓ ③' 서명 고정 + uid 헤더만 교체(jobId 서명 페이로드) — 핸들러 2회 진입, 도메인 멱등이 부수효과를 1회로 묶는다",
    );

    // ③'' 같은 공격을 book.finalization.* 에 쓰면 **성립하지 않는다**.
    //      v2 identifier = jobId ?? sessionId ?? delivery uid 인데 이 페이로드엔
    //      jobId/sessionId 가 없다 → uid 가 서명 data 에 들어간다 → uid 를 바꾸면 서명 불일치.
    const finTs = new Date().toISOString();
    const finOriginal: Delivery = {
      deliveryUid: newDeliveryUid(),
      payload: { ...first.payload, timestamp: finTs },
    };
    const finSignature = signHeader(SECRET, fieldsOf(finOriginal));
    const finTampered: Delivery = {
      deliveryUid: newDeliveryUid(), // uid 만 교체
      payload: { ...first.payload, timestamp: finTs },
    };
    const tamperedRes = await post(app.url, finTampered, finSignature);
    assert.equal(tamperedRes.status, 401, 'uid 가 서명 안에 있으므로 변조가 탐지된다');
    assert.deepEqual(tamperedRes.body, { error: 'SIGNATURE_MISMATCH' });
    assert.equal(app.handled.length, 3, '401 은 핸들러에 닿지 않는다');
    console.log(
      "✓ ③'' 같은 조작을 book.finalization.* 에 하면 401 — v2 에서 uid 가 서명에 포함돼 공격이 성립하지 않는다",
    );
  } finally {
    await app.close();
  }
}

// ── ④ secret 미설정 → 부팅 실패 ─────────────────────────────────────────

function verifyBootFailsWithoutSecret(): void {
  // `process.env.STORIGE_WEBHOOK_SECRET!` 가 만들어 내는 상황 그대로:
  // 타입은 string 이지만 런타임 값은 undefined 다.
  const missing = process.env['STORIGE_WEBHOOK_SECRET_DOES_NOT_EXIST'] as unknown as string;

  assert.throws(
    () => createApp({ secret: missing, handler: async () => {} }),
    (error: unknown) => error instanceof StorigeUsageError,
    'secret 미주입은 첫 웹훅이 아니라 부팅에서 터져야 한다',
  );

  // 빈 문자열도 마찬가지 — 조용히 통과시키지 않는다
  assert.throws(
    () => createApp({ secret: '', handler: async () => {} }),
    (error: unknown) => error instanceof StorigeUsageError,
  );

  // toleranceSec: NaN 은 replay 보호를 **침묵으로** 끄므로 이것도 던진다
  assert.throws(
    () => createApp({ secret: SECRET, handler: async () => {}, toleranceSec: Number('abc') }),
    (error: unknown) => error instanceof StorigeUsageError,
    'toleranceSec NaN 은 replay 검사를 통째로 무력화한다 — 던져야 한다',
  );

  console.log('✓ ④ secret 미설정/빈값 · toleranceSec NaN → 팩토리가 던져 부팅 실패');
}

// ── ⑤ express.json() 누락 → 500 ADAPTER_MISCONFIGURED ───────────────────

async function verifyMisconfigured(): Promise<void> {
  const app = await boot({ mountJsonParser: false });
  try {
    const delivery = finalizationDelivery();
    const res = await post(app.url, delivery, signHeader(SECRET, fieldsOf(delivery)));
    assert.equal(res.status, 500);
    assert.deepEqual(res.body, { error: 'ADAPTER_MISCONFIGURED' });
    assert.equal(app.handled.length, 0);
    console.log('✓ ⑤ express.json() 누락 → 500 ADAPTER_MISCONFIGURED (401 로 위장하지 않는다)');
  } finally {
    await app.close();
  }
}

// ── ⑥ replay 창 밖 ──────────────────────────────────────────────────────

async function verifyReplayWindow(): Promise<void> {
  const app = await boot({ toleranceSec: 60 });
  try {
    const delivery = finalizationDelivery();
    const staleT = Math.floor(Date.now() / 1000) - 3600; // 1시간 전 캡처 서명
    const res = await post(app.url, delivery, signHeader(SECRET, fieldsOf(delivery), staleT));
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'TIMESTAMP_OUT_OF_TOLERANCE' });
    assert.equal(app.handled.length, 0);
    console.log('✓ ⑥ replay 창(±60초) 밖의 서명 → 400 TIMESTAMP_OUT_OF_TOLERANCE');
  } finally {
    await app.close();
  }
}

async function main(): Promise<void> {
  await verifyDeliveries();
  verifyBootFailsWithoutSecret();
  await verifyMisconfigured();
  await verifyReplayWindow();
  console.log(
    '\n✓ webhook-receiver E2E 검증 통과 (정상·위조·중복·uid재생 성립/불성립·부팅실패·오설정·replay)',
  );
}

main().catch((error: unknown) => {
  console.error('✗ 검증 실패:', error);
  process.exitCode = 1;
});
