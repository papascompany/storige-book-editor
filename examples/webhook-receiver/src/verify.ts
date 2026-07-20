/**
 * E2E 검증 — `node src/verify.ts` (프로덕션·외부 의존 0)
 *
 * 실제 express 서버를 임시 포트로 띄우고, **테스트 secret 으로 서명을 직접 만들어**
 * HTTP 로 던진다. 발신부(서버)가 없어도 수신 배선 전체가 진짜로 도는지 확인한다.
 *
 *   ① 정상 서명        → 200 {received:true} + 핸들러 1회 실행
 *   ② 위조 서명        → 401 {error:'SIGNATURE_MISMATCH'} + 핸들러 미실행
 *   ③ 중복 delivery uid → 200 {received:true,duplicate:true} + 핸들러 미실행
 *   ④ secret 미설정     → 팩토리가 던져 **부팅 실패**(첫 웹훅까지 미루지 않는다)
 *   ⑤ express.json() 누락 → 500 {error:'ADAPTER_MISCONFIGURED'} (401 로 위장하지 않는다)
 *   ⑥ replay 창 밖 t    → 400 {error:'TIMESTAMP_OUT_OF_TOLERANCE'}
 *
 * ## 서명 규약 (발신부 정본)
 *   data   = `${t}.${identifier}:${event}:${timestamp}`
 *   헤더   = `X-Storige-Signature-HMAC: t=<unix초>,v1=<hmac-sha256 hex>`
 *   t          서명 시각(재시도마다 갱신) — replay 판정은 **이 값**으로 한다
 *   timestamp  이벤트 시각(ISO, 재시도해도 불변) — 여기에 신선도 게이트를 걸면
 *              30분 뒤 재시도가 죽는다
 *   identifier v2 경로 = `jobId ?? sessionId ?? <X-Storige-Delivery 헤더값>`
 *              book.finalization.* 는 jobId/sessionId 가 없어 delivery uid 가 된다
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

function finalizationDelivery(deliveryUid = `whd_${randomUUID().replace(/-/g, '')}`): Delivery {
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

/** book.finalization.* 의 서명 필드 — identifier 는 delivery uid 다 */
function fieldsOf(delivery: Delivery): { identifier: string; event: string; timestamp: string } {
  return {
    identifier: delivery.deliveryUid,
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

    // ③' 서명은 그대로 두고 **uid 헤더만** 바꾼 재생 — SDK 단락은 통과한다.
    //     이것이 "멱등은 인증 통제가 아니다"의 실물이다. 도메인 멱등이 막는다.
    const replayed: Delivery = {
      deliveryUid: `whd_${randomUUID().replace(/-/g, '')}`,
      payload: first.payload,
    };
    const replayRes = await post(app.url, replayed, signHeader(SECRET, fieldsOf(replayed)));
    assert.equal(replayRes.status, 200);
    assert.deepEqual(replayRes.body, { received: true }, 'uid 가 다르므로 SDK 단락은 통과한다');
    assert.equal(app.handled.length, 2, 'SDK 단락만으로는 핸들러 재진입을 막지 못한다');
    // 그러나 부수효과는 **한 번만** 났다 — 도메인 키(book.finalization.completed:fin_demo)로
    // 막았기 때문이다. 이것이 "멱등은 인증 통제가 아니다"에 대한 실제 방어다.
    assert.deepEqual(
      app.granted,
      ['book.finalization.completed:fin_demo'],
      '도메인 멱등이 uid 재생의 부수효과를 1회로 묶는다',
    );
    console.log('✓ ③\' uid 변조 재생 — SDK 단락은 통과(핸들러 2회)하나 도메인 멱등이 부수효과를 1회로 묶는다');
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
  console.log('\n✓ webhook-receiver E2E 검증 통과 (정상·위조·중복·uid재생·부팅실패·오설정·replay)');
}

main().catch((error: unknown) => {
  console.error('✗ 검증 실패:', error);
  process.exitCode = 1;
});
