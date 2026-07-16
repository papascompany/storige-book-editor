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

  it('req.body 가 undefined 면 500 ADAPTER_MISCONFIGURED — 파서 누락을 조용히 서명불일치로 위장하지 않는다', async () => {
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const res = mockRes();
    // 🚨 던지면 안 된다: express 4 는 async rejection 을 next(err) 로 넘기지 않아
    //    unhandledRejection → 프로세스 종료가 된다. 사유는 응답 코드로 전한다.
    await expect(route({ headers: {} }, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'ADAPTER_MISCONFIGURED' });
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

/**
 * 🚨 P0 회귀 방어 — 오설정이 **원격 무인증 크래시**가 되는 경로를 봉인한다.
 *
 * 실증(수정 전, 실 express 4 서버): secret 미주입 상태에서 HMAC 헤더에 아무 값이나
 * 담은 **무인증 1요청**으로 `secret.length` TypeError → express 4 는 async rejection 을
 * next(err) 로 넘기지 않음 → unhandledRejection → **프로세스 exit(1)**. 유효 서명이
 * 필요 없으므로 스캐너가 반복하면 크래시 루프가 된다.
 *
 * 방어는 2중이다:
 *  ① 팩토리(부팅) 시점 검증 — 오설정은 첫 웹훅이 아니라 배포에서 터진다
 *  ② 어댑터 try/catch — 무슨 일이 있어도 핸들러가 reject 하지 않는다(=프로세스 생존)
 */
describe('P0 — 오설정 방어 (무인증 원격 크래시 봉인)', () => {
  const BAD_SECRETS: ReadonlyArray<[string, unknown]> = [
    ['undefined (env 미주입 — process.env.X! 의 실체)', undefined],
    ['빈 문자열', ''],
    ['null', null],
    ['숫자', 123],
    ['객체', {}],
  ];

  describe.each(BAD_SECRETS)('secret=%s', (_name, secret) => {
    it('createExpressWebhookHandler 는 팩토리에서 던진다(부팅 실패)', () => {
      expect(() =>
        createExpressWebhookHandler({ secret: secret as string, handler: vi.fn() }),
      ).toThrow(StorigeUsageError);
    });

    it('createNextWebhookRoute 는 팩토리에서 던진다(부팅 실패)', () => {
      expect(() =>
        createNextWebhookRoute({ secret: secret as string, handler: vi.fn() }),
      ).toThrow(StorigeUsageError);
    });
  });

  it('비문자열 secret 은 **종류만** 보고한다 — 값이 에러 로그로 새지 않는다', () => {
    // Buffer.from(process.env.X) 로 넘기는 실수는 흔하다. 메시지에 실값이 실리면
    // 그 시크릿이 그대로 스택트레이스·APM 에 남는다.
    const leaky = Buffer.from('whsec_진짜비밀값');
    const attempt = (): unknown =>
      createExpressWebhookHandler({ secret: leaky as unknown as string, handler: vi.fn() });
    expect(attempt).toThrow(/받은 종류: object/);
    expect(attempt).not.toThrow(/whsec_진짜비밀값/);
  });

  it('toleranceSec: NaN 도 팩토리에서 던진다 — replay 보호가 침묵으로 꺼지지 않게', () => {
    expect(() =>
      createExpressWebhookHandler({ secret: SECRET, handler: vi.fn(), toleranceSec: NaN }),
    ).toThrow(StorigeUsageError);
    expect(() =>
      createNextWebhookRoute({ secret: SECRET, handler: vi.fn(), toleranceSec: Number('abc') }),
    ).toThrow(StorigeUsageError);
  });

  it('정상 옵션은 팩토리를 통과한다(과잉 차단 없음)', () => {
    expect(() => createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() })).not.toThrow();
    expect(() =>
      createNextWebhookRoute({ secret: SECRET, handler: vi.fn(), toleranceSec: 0 }),
    ).not.toThrow();
  });

  it('🚨 팩토리 통과 후 secret 이 사라져도 프로세스를 죽이지 않는다 — 500 으로 바꾼다', async () => {
    // 팩토리는 options 를 참조로 들고 있다 → 심층 방어(processWebhookRequest 매 요청 검사)
    const options = { secret: SECRET, handler: vi.fn() };
    const route = createExpressWebhookHandler(options);
    (options as { secret: unknown }).secret = undefined;

    const res = mockRes();
    // 유효 서명 불요 — 헤더에 아무 값이나 담은 무인증 요청이 크래시 트리거였다
    await expect(
      route({ headers: { 'x-storige-signature-hmac': 'anything-goes' }, body: payloadOf() }, res),
    ).resolves.toBeUndefined(); // ← reject 하면 express 4 에서 프로세스가 죽는다
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'ADAPTER_MISCONFIGURED' });
  });

  it('🚨 next 어댑터도 동일 — 예외 대신 500 Response 를 돌려준다', async () => {
    const options = { secret: SECRET, handler: vi.fn() };
    const route = createNextWebhookRoute(options);
    (options as { secret: unknown }).secret = undefined;

    const response = await route(
      new Request('https://partner.example/w', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-storige-signature-hmac': 'anything-goes' },
        body: JSON.stringify(payloadOf()),
      }),
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'ADAPTER_MISCONFIGURED' });
  });

  it('res.status 가 던져도 핸들러는 reject 하지 않는다(최후 방어선)', async () => {
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const brokenRes = {
      status() {
        throw new Error('이미 응답됨');
      },
      json() {
        return undefined;
      },
    } as unknown as ExpressLikeResponse;
    const payload = payloadOf();
    await expect(
      route({ headers: sign(payload, 'whd_broken'), body: payload }, brokenRes),
    ).resolves.toBeUndefined();
  });

  it('예상 못 한 예외(비 StorigeUsageError)는 ADAPTER_ERROR 로 구분된다', async () => {
    const route = createExpressWebhookHandler({ secret: SECRET, handler: vi.fn() });
    const res = mockRes();
    // headers getter 가 폭발 = 파이프라인 밖의 사고
    const req = {
      get headers(): Record<string, string> {
        throw new Error('프록시 폭발');
      },
      body: payloadOf(),
    };
    await expect(route(req, res)).resolves.toBeUndefined();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'ADAPTER_ERROR' });
  });

  it('processWebhookRequest 직접 배선은 오설정을 던진다 — 호출측이 감싸야 한다(문서화)', async () => {
    await expect(
      processWebhookRequest({}, payloadOf(), {
        secret: undefined as unknown as string,
        handler: vi.fn(),
      }),
    ).rejects.toThrow(StorigeUsageError);
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
