/**
 * 어댑터 — 검증 → 멱등 단락 → 핸들러 → 상태코드 파이프라인.
 *
 * 서명 생성은 발신부 스냅샷(webhook-signature.spec.ts 와 동일 알고리즘)으로 만든다.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createExpressWebhookHandler,
  createNextWebhookRoute,
  InMemoryWebhookDeduper,
  processWebhookRequest,
  type ExpressLikeResponse,
  type StorigeWebhookPayload,
  type WebhookDeduper,
  type WebhookHandlerContext,
} from '../webhook';
import { StorigeUsageError } from '../index';

const SECRET = `whsec_${'cd'.repeat(24)}`;

/** v2 발신 스냅샷 (webhook-delivery.service.ts attemptHttp) */
function sign(
  payload: Record<string, unknown>,
  deliveryUid = 'whd_default',
  secret = SECRET,
  nowMs = Date.now(),
): Record<string, string> {
  const identifier = (payload.jobId as string) ?? (payload.sessionId as string) ?? deliveryUid;
  const t = Math.floor(nowMs / 1000);
  const data = `${t}.${identifier}:${payload.event}:${payload.timestamp ?? ''}`;
  return {
    'content-type': 'application/json',
    'x-storige-event': String(payload.event),
    'x-storige-delivery': deliveryUid,
    'x-storige-signature-hmac': `t=${t},v1=${createHmac('sha256', secret).update(data).digest('hex')}`,
  };
}

function payloadOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event: 'synthesis.completed',
    jobId: 'job-adapter',
    status: 'completed',
    outputFileUrl: '/storage/outputs/merged.pdf',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/** express Response 목 */
function mockRes(): ExpressLikeResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('processWebhookRequest — 공통 파이프라인', () => {
  it('유효 서명 → 핸들러 호출 + 200', async () => {
    const payload = payloadOf();
    const handler = vi.fn();
    const outcome = await processWebhookRequest(sign(payload, 'whd_a'), payload, {
      secret: SECRET,
      handler,
    });
    expect(outcome).toEqual({ status: 200, body: { received: true } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('핸들러에 검증된 컨텍스트를 넘긴다', async () => {
    const payload = payloadOf();
    let context: WebhookHandlerContext | undefined;
    await processWebhookRequest(sign(payload, 'whd_ctx'), payload, {
      secret: SECRET,
      handler: (_p, ctx) => {
        context = ctx;
      },
    });
    expect(context).toMatchObject({
      event: 'synthesis.completed',
      identifier: 'job-adapter',
      deliveryUid: 'whd_ctx',
      insecureLegacy: false,
    });
    expect(context?.t).toBeTypeOf('number');
  });

  it('핸들러는 payload 를 그대로 받는다(타입 좁히기 가능)', async () => {
    const payload = payloadOf();
    let received: StorigeWebhookPayload | undefined;
    await processWebhookRequest(sign(payload), payload, {
      secret: SECRET,
      handler: (p) => {
        received = p;
      },
    });
    expect(received).toBe(payload);
  });

  it.each([
    ['서명 없음', {}, 400, 'MISSING_SIGNATURE'],
    ['형식 불량', { 'x-storige-signature-hmac': 'nope' }, 400, 'MALFORMED_SIGNATURE'],
  ])('%s → %d %s', async (_name, headers, status, error) => {
    const handler = vi.fn();
    const outcome = await processWebhookRequest(headers, payloadOf(), {
      secret: SECRET,
      handler,
    });
    expect(outcome).toEqual({ status, body: { error } });
    expect(handler).not.toHaveBeenCalled(); // 검증 실패 시 핸들러 미진입
  });

  it('서명 불일치 → 401 (인증 실패)', async () => {
    const payload = payloadOf();
    const handler = vi.fn();
    const outcome = await processWebhookRequest(
      sign(payload, 'whd_bad', 'attacker-secret'),
      payload,
      { secret: SECRET, handler },
    );
    expect(outcome).toEqual({ status: 401, body: { error: 'SIGNATURE_MISMATCH' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('t 만료 → 400 (재시도는 새 t 로 재서명되므로 통과 가능)', async () => {
    const nowMs = Date.now();
    const payload = payloadOf();
    const outcome = await processWebhookRequest(sign(payload, 'whd_old', SECRET, nowMs), payload, {
      secret: SECRET,
      handler: vi.fn(),
      now: () => nowMs + 400_000,
    });
    expect(outcome).toEqual({ status: 400, body: { error: 'TIMESTAMP_OUT_OF_TOLERANCE' } });
  });

  it('레거시 base64 단독 → 400 기본 거부', async () => {
    const payload = payloadOf();
    const legacy = Buffer.from(
      `${payload.jobId}:${payload.event}:${payload.timestamp}`,
    ).toString('base64');
    const outcome = await processWebhookRequest(
      { 'x-storige-signature': legacy },
      payload,
      { secret: SECRET, handler: vi.fn() },
    );
    expect(outcome).toEqual({ status: 400, body: { error: 'INSECURE_LEGACY_SIGNATURE' } });
  });

  it('응답 본문에는 사유 코드만 — 사람이 읽는 message 는 노출하지 않는다', async () => {
    const outcome = await processWebhookRequest({}, payloadOf(), {
      secret: SECRET,
      handler: vi.fn(),
    });
    expect(Object.keys(outcome.body)).toEqual(['error']);
    expect(JSON.stringify(outcome.body)).not.toMatch(/서명 헤더가 없습니다/);
  });
});

describe('멱등 단락', () => {
  it('중복 배달은 핸들러를 건너뛰고 200 duplicate 로 재시도 체인을 끊는다', async () => {
    const payload = payloadOf();
    const headers = sign(payload, 'whd_dup');
    const handler = vi.fn();
    const deduper = new InMemoryWebhookDeduper();
    const options = { secret: SECRET, handler, deduper };

    const first = await processWebhookRequest(headers, payload, options);
    const second = await processWebhookRequest(headers, payload, options);

    expect(first).toEqual({ status: 200, body: { received: true } });
    // 4xx/5xx 를 주면 서버가 계속 재시도한다 → 200 이어야 체인이 끊긴다
    expect(second).toEqual({ status: 200, body: { received: true, duplicate: true } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('서버 재시도 4회(인라인1+큐3)를 핸들러 1회로 접는다', async () => {
    const payload = payloadOf();
    const handler = vi.fn();
    const deduper = new InMemoryWebhookDeduper();
    const nowMs = Date.now();

    // 재시도는 payload 불변 + 새 t 로 재서명 + 같은 delivery uid
    for (const offset of [0, 60_000, 300_000, 1_800_000]) {
      await processWebhookRequest(sign(payload, 'whd_chain', SECRET, nowMs + offset), payload, {
        secret: SECRET,
        handler,
        deduper,
        now: () => nowMs + offset,
      });
    }
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('검증 실패는 선점하지 않는다 — 위조가 정상 배달을 선점하면 DoS 가 된다', async () => {
    const payload = payloadOf();
    const deduper = new InMemoryWebhookDeduper();
    const handler = vi.fn();

    // 공격자가 같은 uid 로 잘못된 서명을 먼저 보낸다
    await processWebhookRequest(sign(payload, 'whd_dos', 'wrong-secret'), payload, {
      secret: SECRET,
      handler,
      deduper,
    });
    // 진짜 배달은 여전히 처리돼야 한다
    const real = await processWebhookRequest(sign(payload, 'whd_dos'), payload, {
      secret: SECRET,
      handler,
      deduper,
    });
    expect(real).toEqual({ status: 200, body: { received: true } });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('deduper 미지정이면 단락 없이 매번 처리한다', async () => {
    const payload = payloadOf();
    const headers = sign(payload, 'whd_nodedupe');
    const handler = vi.fn();
    await processWebhookRequest(headers, payload, { secret: SECRET, handler });
    await processWebhookRequest(headers, payload, { secret: SECRET, handler });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('X-Storige-Delivery 가 없으면(v1 발신) 단락이 불가능하다 — context.deliveryUid=null 로 알린다', async () => {
    // v1 발신 스냅샷: delivery 헤더 없음
    const payload = payloadOf();
    const t = Math.floor(Date.now() / 1000);
    const data = `${t}.${payload.jobId}:${payload.event}:${payload.timestamp}`;
    const headers = {
      'x-storige-event': String(payload.event),
      'x-storige-signature-hmac': `t=${t},v1=${createHmac('sha256', SECRET).update(data).digest('hex')}`,
    };
    const handler = vi.fn();
    const deduper = new InMemoryWebhookDeduper();

    await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });

    // dedupe 키가 없으니 둘 다 처리된다(문서화된 v1 경로 한계)
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler.mock.calls[0]?.[1]).toMatchObject({ deliveryUid: null });
    expect(deduper.size).toBe(0);
  });

  it('비동기 deduper(Redis 등)를 await 한다', async () => {
    const store = new Set<string>();
    const deduper: WebhookDeduper = {
      claim: async (uid) => {
        await Promise.resolve();
        if (store.has(uid)) return false;
        store.add(uid);
        return true;
      },
    };
    const payload = payloadOf();
    const headers = sign(payload, 'whd_async');
    const handler = vi.fn();
    await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    const second = await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(second.body).toEqual({ received: true, duplicate: true });
  });
});

describe('핸들러 실패 — 조용한 유실 차단', () => {
  it('핸들러가 던지면 500 + release → 다음 재시도가 다시 처리한다(at-least-once)', async () => {
    const payload = payloadOf();
    const headers = sign(payload, 'whd_fail');
    const deduper = new InMemoryWebhookDeduper();
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('DB 순단'))
      .mockResolvedValueOnce(undefined);

    const first = await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    expect(first).toEqual({ status: 500, body: { error: 'HANDLER_FAILED' } });

    // 🚨 핵심: 선점이 풀려야 재시도가 처리된다. 안 풀면 이 배달은 영구 유실.
    const retry = await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    expect(retry).toEqual({ status: 200, body: { received: true } });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('release 없는 deduper = at-most-once — 실패 후 재시도가 단락된다(문서화된 트레이드오프)', async () => {
    const store = new Set<string>();
    const deduper: WebhookDeduper = {
      claim: (uid) => {
        if (store.has(uid)) return false;
        store.add(uid);
        return true;
      },
      // release 미구현
    };
    const payload = payloadOf();
    const headers = sign(payload, 'whd_atmostonce');
    const handler = vi.fn().mockRejectedValue(new Error('실패'));

    const first = await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    expect(first.status).toBe(500);
    const retry = await processWebhookRequest(headers, payload, { secret: SECRET, handler, deduper });
    // 선점이 남아 단락된다 — 이 이벤트는 영영 처리되지 않는다
    expect(retry.body).toEqual({ received: true, duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('release 가 던져도 원래 실패 응답을 덮지 않는다', async () => {
    const deduper: WebhookDeduper = {
      claim: () => true,
      release: () => {
        throw new Error('redis 순단');
      },
    };
    const payload = payloadOf();
    const outcome = await processWebhookRequest(sign(payload, 'whd_relfail'), payload, {
      secret: SECRET,
      handler: () => {
        throw new Error('핸들러 실패');
      },
      deduper,
    });
    expect(outcome).toEqual({ status: 500, body: { error: 'HANDLER_FAILED' } });
  });

  it('onError 로 예외를 관측할 수 있다', async () => {
    const payload = payloadOf();
    const error = new Error('부수효과 실패');
    const onError = vi.fn();
    await processWebhookRequest(sign(payload, 'whd_obs'), payload, {
      secret: SECRET,
      handler: () => {
        throw error;
      },
      onError,
    });
    expect(onError).toHaveBeenCalledWith(error, expect.objectContaining({ identifier: 'job-adapter' }));
  });

  it('onError 가 던져도 응답을 바꾸지 않는다', async () => {
    const payload = payloadOf();
    const outcome = await processWebhookRequest(sign(payload, 'whd_obsfail'), payload, {
      secret: SECRET,
      handler: () => {
        throw new Error('x');
      },
      onError: () => {
        throw new Error('로거 폭발');
      },
    });
    expect(outcome).toEqual({ status: 500, body: { error: 'HANDLER_FAILED' } });
  });
});

describe('express 어댑터', () => {
  it('유효 서명 → 200 {received:true}', async () => {
    const payload = payloadOf();
    const handler = vi.fn();
    const route = createExpressWebhookHandler({ secret: SECRET, handler });
    const res = mockRes();
    await route({ headers: sign(payload, 'whd_ex1'), body: payload }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('서명 불일치 → 401', async () => {
    const payload = payloadOf();
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const res = mockRes();
    await route({ headers: sign(payload, 'whd_ex2', 'wrong'), body: payload }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'SIGNATURE_MISMATCH' });
  });

  it('일반 JSON 파서와 공존한다 — raw body 불요(express.json() 결과 그대로)', async () => {
    // express.json() 이 만든 파싱 객체를 그대로 넘겨도 검증이 성립한다
    const payload = JSON.parse(JSON.stringify(payloadOf()));
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const res = mockRes();
    await route({ headers: sign(payload, 'whd_ex3'), body: payload }, res);
    expect(res.statusCode).toBe(200);
  });

  it('req.body 가 undefined 면 StorigeUsageError — 파서 누락을 조용히 서명불일치로 위장하지 않는다', async () => {
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    await expect(route({ headers: {} }, mockRes())).rejects.toThrow(StorigeUsageError);
    await expect(route({ headers: {} }, mockRes())).rejects.toThrow(/express\.json\(\)/);
  });

  it('배열 헤더(중복 수신)도 처리한다', async () => {
    const payload = payloadOf();
    const headers = sign(payload, 'whd_ex4');
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const res = mockRes();
    await route(
      { headers: { ...headers, 'x-storige-event': [String(payload.event)] }, body: payload },
      res,
    );
    expect(res.statusCode).toBe(200);
  });
});

describe('Next.js App Router 어댑터', () => {
  function request(headers: Record<string, string>, body: unknown): Request {
    return new Request('https://partner.example/api/webhooks/storige', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  it('유효 서명 → 200 {received:true}', async () => {
    const payload = payloadOf();
    const handler = vi.fn();
    const route = createNextWebhookRoute({ secret: SECRET, handler });
    const response = await route(request(sign(payload, 'whd_nx1'), payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('Headers 인스턴스 경유 검증이 성립한다', async () => {
    const payload = payloadOf();
    let context: WebhookHandlerContext | undefined;
    const route = createNextWebhookRoute({
      secret: SECRET,
      handler: (_p, ctx) => {
        context = ctx;
      },
    });
    await route(request(sign(payload, 'whd_nx2'), payload));
    expect(context).toMatchObject({ identifier: 'job-adapter', deliveryUid: 'whd_nx2' });
  });

  it('서명 불일치 → 401', async () => {
    const payload = payloadOf();
    const route = createNextWebhookRoute({ secret: SECRET, handler: vi.fn() });
    const response = await route(request(sign(payload, 'whd_nx3', 'wrong'), payload));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'SIGNATURE_MISMATCH' });
  });

  it('JSON 이 아니면 400 INVALID_JSON (크래시 금지)', async () => {
    const route = createNextWebhookRoute({ secret: SECRET, handler: vi.fn() });
    const response = await route(
      new Request('https://partner.example/w', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json{{',
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'INVALID_JSON' });
  });

  it('응답 content-type 은 application/json', async () => {
    const payload = payloadOf();
    const route = createNextWebhookRoute({ secret: SECRET, handler: vi.fn() });
    const response = await route(request(sign(payload, 'whd_nx4'), payload));
    expect(response.headers.get('content-type')).toBe('application/json');
  });

  it('중복 배달 단락이 어댑터 경유로도 동작한다', async () => {
    const payload = payloadOf();
    const headers = sign(payload, 'whd_nx5');
    const handler = vi.fn();
    const route = createNextWebhookRoute({
      secret: SECRET,
      handler,
      deduper: new InMemoryWebhookDeduper(),
    });
    await route(request(headers, payload));
    const second = await route(request(headers, payload));
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toEqual({ received: true, duplicate: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('핸들러 예외 → 500 (서버가 재시도한다)', async () => {
    const payload = payloadOf();
    const route = createNextWebhookRoute({
      secret: SECRET,
      handler: () => {
        throw new Error('실패');
      },
    });
    const response = await route(request(sign(payload, 'whd_nx6'), payload));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'HANDLER_FAILED' });
  });
});
