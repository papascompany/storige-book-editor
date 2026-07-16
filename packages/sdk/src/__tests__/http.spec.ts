/**
 * HTTP 코어 — 인증·봉투 언랩·에러 매핑·재시도 정책.
 */

import { describe, expect, it, vi } from 'vitest';
import { StorigeClient } from '../client/client';
import {
  backoffDelayMs,
  parseRetryAfterSeconds,
  shouldRetry,
  HttpClient,
  type RetryOptions,
} from '../client/http';
import { ErrorCode, StorigeApiError, StorigeConnectionError, StorigeUsageError } from '../errors';
import { RETRY_AFTER_FALLBACK_SECONDS } from '../constants';
import { NO_DELAY_RETRY, err, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';

function client(
  fetchImpl: typeof globalThis.fetch,
  retry: Partial<RetryOptions> = NO_DELAY_RETRY,
) {
  return new StorigeClient({
    apiKey: 'sk_test_abc',
    baseUrl: BASE,
    fetch: fetchImpl,
    retry,
  });
}

/** backoffDelayMs 단위 테스트용 — maxRetryAfterMs 는 백오프 계산과 무관 */
function retryOpts(partial: Omit<RetryOptions, 'maxRetryAfterMs'>): RetryOptions {
  return { ...partial, maxRetryAfterMs: 60_000 };
}

describe('HttpClient — 인증', () => {
  it('Authorization: Bearer 를 단독 전송한다 (X-API-Key 미전송)', async () => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await client(m.fetch).ping();

    const call = m.calls[0]!;
    expect(call.headers['authorization']).toBe('Bearer sk_test_abc');
    // 서버 가드는 Bearer 와 X-API-Key 를 병행 수용하지만 값이 다르면 401(모호성
    // 거부) — 굳이 둘 다 보낼 이유가 없다. 단독 전송이 계약이다.
    expect(call.headers['x-api-key']).toBeUndefined();
  });

  it('env 를 옵션으로 받지 않는다 — 키에 내재(타입·전송 모두 부재)', async () => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await client(m.fetch).ping();
    const call = m.calls[0]!;
    expect(call.url).not.toContain('env=');
    expect(Object.keys(call.headers)).not.toContain('x-storige-env');
  });

  /**
   * 🚨 예약 헤더 방어 — 종전엔 "덮어쓸 수 없다"가 **표기에 따라 거짓**이었다.
   *
   * buildHeaders 가 사용자 헤더를 펼친 뒤 SDK 값을 덮어쓰므로 정확히 같은 표기
   * (`Authorization`)면 SDK 가 이겼다. 하지만 소문자(`authorization`)로 넘기면
   * 두 키가 객체에 공존하고, 실 fetch 는 이를 Headers 로 채우며 **결합**한다:
   *   실물 → "Bearer 사용자값, Bearer sk_test_abc" → 서버 401
   *   구 mock → "Bearer sk_test_abc" (덮어쓰기) → green = **거짓 안심**
   * 이제 예약 헤더는 거부하고, mock 도 실 Headers 의미론을 쓴다.
   */
  it.each([
    ['Authorization', 'Bearer 탈취시도'],
    ['authorization', 'Bearer 탈취시도'], // ← 실 fetch 라면 결합돼 401 이 나던 표기
    ['AUTHORIZATION', 'Bearer 탈취시도'],
    ['Accept', 'application/xml'],
    ['content-type', 'text/plain'],
    ['User-Agent', 'evil/1.0'],
    ['Idempotency-Key', 'bypass-검증'],
  ])('예약 헤더 %s 는 즉시 StorigeUsageError — 대소문자 무관', async (name, value) => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await expect(client(m.fetch).ping({ headers: { [name]: value } })).rejects.toThrow(
      StorigeUsageError,
    );
    expect(m.calls).toHaveLength(0); // 발신 전에 실패한다
  });

  it('예약 아닌 사용자 헤더(추적 등)는 그대로 실린다', async () => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await client(m.fetch).ping({ headers: { 'X-Request-Id': 'req-1', traceparent: 'tp-1' } });
    const call = m.calls[0]!;
    expect(call.headers['x-request-id']).toBe('req-1');
    expect(call.headers['traceparent']).toBe('tp-1');
    expect(call.headers['authorization']).toBe('Bearer sk_test_abc'); // 인증은 SDK 것 단독
  });

  it('mock 이 실 fetch 의 결합 의미론을 쓴다 — 이 괴리가 P2-6 을 숨겼다', async () => {
    // helpers.mockFetch 가 Headers 를 거치는지 박제. 덮어쓰기 mock 이면 이 단언이 깨진다.
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await client(m.fetch).ping();
    const captured = m.calls[0]!.headers;
    // Headers 는 이름을 소문자로 정규화한다(원본은 'User-Agent' 표기였다)
    expect(captured['user-agent']).toBe('@storige/sdk');
    expect(captured['User-Agent']).toBeUndefined();
  });

  it('apiKey/baseUrl 누락 시 즉시 사용법 에러', () => {
    expect(() => new HttpClient({ apiKey: '', baseUrl: BASE })).toThrow(StorigeUsageError);
    expect(() => new HttpClient({ apiKey: 'k', baseUrl: '' })).toThrow(StorigeUsageError);
  });

  it('경로 접두 /api/v1 을 SDK 가 붙인다 (baseUrl 은 오리진만)', async () => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: 'T' }) }]);
    await client(m.fetch).ping();
    expect(m.calls[0]!.url).toBe(`${BASE}/api/v1/ping`);
  });
});

describe('HttpClient — 봉투 언랩', () => {
  it('성공 봉투에서 data 만 벗겨 반환한다', async () => {
    const m = mockFetch([{ json: ok({ pong: true, serverTime: '2026-07-16T00:00:00.000Z' }) }]);
    const result = await client(m.fetch).ping();
    // 봉투(success/message/pagination)는 호출측에 새지 않는다
    expect(result).toEqual({ pong: true, serverTime: '2026-07-16T00:00:00.000Z' });
  });

  it('목록 봉투를 items+pagination(Page)으로 결합한다', async () => {
    const pagination = { total: 42, limit: 20, offset: 0, hasNext: true };
    const m = mockFetch([{ json: ok([{ uid: 'bs_1' }], pagination) }]);
    const page = await client(m.fetch).bookSpecs.list();
    expect(page.items).toEqual([{ uid: 'bs_1' }]);
    expect(page.pagination).toEqual(pagination);
  });

  it('2xx 인데 에러 봉투면 조용히 넘기지 않고 던진다', async () => {
    const m = mockFetch([{ status: 200, json: err(ErrorCode.ERR_INTERNAL) }]);
    await expect(client(m.fetch).ping()).rejects.toThrow(StorigeApiError);
  });

  it('봉투가 아닌 2xx JSON 은 연결 에러로 던진다', async () => {
    const m = mockFetch([{ status: 200, json: { unexpected: true } }]);
    await expect(client(m.fetch).ping()).rejects.toThrow(StorigeConnectionError);
  });

  it('JSON 이 아닌 본문은 파싱 에러를 명확히 알린다', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof globalThis.fetch;
    await expect(client(fetchImpl).ping()).rejects.toThrow(StorigeConnectionError);
  });
});

describe('HttpClient — 에러 매핑', () => {
  it('에러 봉투를 StorigeApiError 필드로 옮긴다 (errorCode·status·requestId·fieldErrors)', async () => {
    const m = mockFetch([
      {
        status: 400,
        json: err(ErrorCode.ERR_VALIDATION_FAILED, '요청 검증에 실패했습니다', {
          fieldErrors: { pageCount: ['pageCount must be an integer'] },
          errors: [{ code: 'VALIDATION', message: 'x' }],
          requestId: 'req_abc',
        }),
      },
    ]);

    const error = await client(m.fetch)
      .ping()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StorigeApiError);
    const apiError = error as StorigeApiError;
    expect(apiError.errorCode).toBe(ErrorCode.ERR_VALIDATION_FAILED);
    expect(apiError.status).toBe(400);
    expect(apiError.requestId).toBe('req_abc');
    expect(apiError.fieldErrors).toEqual({ pageCount: ['pageCount must be an integer'] });
    expect(apiError.errors).toEqual([{ code: 'VALIDATION', message: 'x' }]);
  });

  it('미지 errorCode(카탈로그 additive 성장)도 그대로 보존한다', async () => {
    const m = mockFetch([{ status: 422, json: err('ERR_FUTURE_CODE_NOT_IN_SDK') }]);
    const error = (await client(m.fetch)
      .ping()
      .catch((e: unknown) => e)) as StorigeApiError;
    // 미지 코드에 SDK 가 터지면 서버의 additive 성장이 파트너를 깨뜨린다
    expect(error.errorCode).toBe('ERR_FUTURE_CODE_NOT_IN_SDK');
  });

  it('requestId=null(스트림 중단 경로)도 수용한다', async () => {
    const m = mockFetch([{ status: 500, json: err(ErrorCode.ERR_INTERNAL, 'x', { requestId: null }) }]);
    const error = (await client(m.fetch, { ...NO_DELAY_RETRY, maxRetries: 0 })
      .ping()
      .catch((e: unknown) => e)) as StorigeApiError;
    expect(error.requestId).toBeNull();
  });

  it('봉투가 아닌 오류 응답(프록시 502 등)도 StorigeApiError 로 정규화한다', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof globalThis.fetch;
    const error = (await client(fetchImpl, { ...NO_DELAY_RETRY, maxRetries: 0 })
      .ping()
      .catch((e: unknown) => e)) as StorigeApiError;
    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.status).toBe(502);
  });
});

describe('shouldRetry — errorCode/status 로만 분기 (message 파싱 금지)', () => {
  it('429 는 항상 재시도 (레이트리밋은 핸들러 실행 전 거부라 부수효과 없음)', () => {
    expect(shouldRetry({ status: 429, errorCode: ErrorCode.ERR_RATE_LIMITED, retrySafe: false })).toBe(true);
    expect(shouldRetry({ status: 429, errorCode: ErrorCode.ERR_RATE_LIMITED, retrySafe: true })).toBe(true);
  });

  it('5xx 는 retrySafe 일 때만 재시도', () => {
    expect(shouldRetry({ status: 500, errorCode: ErrorCode.ERR_INTERNAL, retrySafe: true })).toBe(true);
    expect(shouldRetry({ status: 503, errorCode: null, retrySafe: true })).toBe(true);
    // 멱등키 없는 POST — 중복 생성 위험이라 재시도 금지
    expect(shouldRetry({ status: 500, errorCode: ErrorCode.ERR_INTERNAL, retrySafe: false })).toBe(false);
  });

  it('409 ERR_IDEMPOTENCY_IN_PROGRESS 는 재시도', () => {
    expect(
      shouldRetry({ status: 409, errorCode: ErrorCode.ERR_IDEMPOTENCY_IN_PROGRESS, retrySafe: true }),
    ).toBe(true);
  });

  it('그 외 409 는 재시도 금지 (ERR_ASSET_ALREADY_EXISTS 등)', () => {
    expect(
      shouldRetry({ status: 409, errorCode: ErrorCode.ERR_ASSET_ALREADY_EXISTS, retrySafe: true }),
    ).toBe(false);
  });

  it('429 를 제외한 4xx 는 재시도 금지', () => {
    for (const status of [400, 401, 403, 404, 413, 415, 422]) {
      expect(shouldRetry({ status, errorCode: ErrorCode.ERR_VALIDATION_FAILED, retrySafe: true })).toBe(false);
    }
  });

  it('네트워크 실패(status=null)는 retrySafe 일 때만 재시도', () => {
    expect(shouldRetry({ status: null, errorCode: null, retrySafe: true })).toBe(true);
    expect(shouldRetry({ status: null, errorCode: null, retrySafe: false })).toBe(false);
  });
});

describe('429 Retry-After 준수', () => {
  it('Retry-After(초)를 그대로 지연으로 쓴다', async () => {
    const m = mockFetch([
      { status: 429, json: err(ErrorCode.ERR_RATE_LIMITED), headers: { 'retry-after': '2' } },
      { json: ok({ pong: true, serverTime: 'T' }) },
    ]);
    const sleepSpy = vi.spyOn(globalThis, 'setTimeout');
    const c = new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: m.fetch });

    await c.ping();

    // 백오프가 아니라 서버가 지시한 2초를 준수해야 한다
    const delays = sleepSpy.mock.calls.map((args) => args[1]);
    expect(delays).toContain(2000);
    expect(m.calls).toHaveLength(2);
    sleepSpy.mockRestore();
  });

  it('Retry-After 부재 시 폴백 60초', () => {
    expect(parseRetryAfterSeconds(null)).toBeNull();
    expect(RETRY_AFTER_FALLBACK_SECONDS).toBe(60);
  });

  it('Retry-After 를 delta-seconds 와 HTTP-date 양쪽으로 파싱한다', () => {
    expect(parseRetryAfterSeconds('5')).toBe(5);
    expect(parseRetryAfterSeconds(' 0 ')).toBe(0);
    expect(parseRetryAfterSeconds('')).toBeNull();
    expect(parseRetryAfterSeconds('garbage')).toBeNull();

    const future = new Date(Date.now() + 3000).toUTCString();
    const parsed = parseRetryAfterSeconds(future);
    expect(parsed).toBeGreaterThanOrEqual(2);
    expect(parsed).toBeLessThanOrEqual(4);
  });

  it('429 재시도가 소진되면 마지막 429 를 던지고 retryAfterSeconds 를 싣는다', async () => {
    const m = mockFetch([
      { status: 429, json: err(ErrorCode.ERR_RATE_LIMITED), headers: { 'retry-after': '7' } },
    ]);
    // maxRetries:0 — 재시도 없이 즉시 던진다(429 지연은 Retry-After 를 따르므로
    // baseDelayMs=0 으로도 실제 7초를 자게 된다. 재시도 자체를 끄는 게 맞다)
    const error = (await client(m.fetch, { ...NO_DELAY_RETRY, maxRetries: 0 })
      .ping()
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error.errorCode).toBe(ErrorCode.ERR_RATE_LIMITED);
    expect(error.retryAfterSeconds).toBe(7);
    expect(m.calls).toHaveLength(1);
  });

  it('Retry-After 가 상한을 넘으면 잠들지 않고 즉시 429 를 던진다 (무한 sleep 방지)', async () => {
    // 잘못 설정된 서버/프록시가 24시간을 지시하는 경우 — SDK 가 그대로 자면
    // 호출측 프로세스가 하루 멈춘다. 상한 초과는 자동 재시도를 포기하고
    // retryAfterSeconds 를 실어 돌려줘 호출측이 스케줄하게 한다.
    const m = mockFetch([
      { status: 429, json: err(ErrorCode.ERR_RATE_LIMITED), headers: { 'retry-after': '86400' } },
    ]);
    const started = Date.now();
    const error = (await client(m.fetch, { ...NO_DELAY_RETRY, maxRetries: 3, maxRetryAfterMs: 60_000 })
      .ping()
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(Date.now() - started).toBeLessThan(1000); // 자지 않았다
    expect(error.retryAfterSeconds).toBe(86400);
    expect(m.calls).toHaveLength(1); // 재시도 없음
  });

  it('상한 이내의 Retry-After 는 정상 준수한다', async () => {
    const m = mockFetch([
      { status: 429, json: err(ErrorCode.ERR_RATE_LIMITED), headers: { 'retry-after': '0' } },
      { json: ok({ pong: true, serverTime: 'T' }) },
    ]);
    const result = await client(m.fetch, { ...NO_DELAY_RETRY, maxRetries: 3, maxRetryAfterMs: 60_000 }).ping();
    expect(result.pong).toBe(true);
    expect(m.calls).toHaveLength(2);
  });
});

describe('5xx 백오프 + jitter', () => {
  it('5xx 후 성공하면 결과를 반환한다', async () => {
    const m = mockFetch([
      { status: 500, json: err(ErrorCode.ERR_INTERNAL) },
      { json: ok({ pong: true, serverTime: 'T' }) },
    ]);
    const result = await client(m.fetch).ping();
    expect(result.pong).toBe(true);
    expect(m.calls).toHaveLength(2);
  });

  it('지수 백오프는 상한을 넘지 않는다', () => {
    const retry = retryOpts({ maxRetries: 5, baseDelayMs: 500, maxDelayMs: 8000, jitter: false });
    expect(backoffDelayMs(0, retry)).toBe(500);
    expect(backoffDelayMs(1, retry)).toBe(1000);
    expect(backoffDelayMs(2, retry)).toBe(2000);
    expect(backoffDelayMs(10, retry)).toBe(8000); // 캡
  });

  it('jitter 는 [0, exponential] 범위 안에 든다', () => {
    const retry = retryOpts({ maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 8000, jitter: true });
    for (let i = 0; i < 50; i += 1) {
      const delay = backoffDelayMs(1, retry);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });

  it('4xx 는 재시도하지 않는다 (호출 1회)', async () => {
    const m = mockFetch([{ status: 404, json: err(ErrorCode.ERR_NOT_FOUND) }]);
    await expect(client(m.fetch).bookSpecs.get('bs_x')).rejects.toThrow(StorigeApiError);
    expect(m.calls).toHaveLength(1);
  });
});
