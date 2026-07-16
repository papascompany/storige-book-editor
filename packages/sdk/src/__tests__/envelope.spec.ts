/**
 * 공개 헬퍼 표면 — 봉투 판별·Page 결합·코드 판정·재전달 감지 + 취소/타임아웃.
 */

import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  IDEMPOTENCY_REPLAYED_HEADER,
  isErrorEnvelope,
  isKnownErrorCode,
  StorigeConnectionError,
  toPage,
  type SuccessEnvelope,
} from '../index';
import { isSuccessEnvelope } from '../envelope';
import { isIdempotentReplay } from '../client/http';
import { StorigeClient } from '../client/client';
import { NO_DELAY_RETRY, err, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';

describe('봉투 판별', () => {
  it('isSuccessEnvelope', () => {
    expect(isSuccessEnvelope(ok({ a: 1 }))).toBe(true);
    expect(isSuccessEnvelope(err(ErrorCode.ERR_NOT_FOUND))).toBe(false);
    expect(isSuccessEnvelope(null)).toBe(false);
    expect(isSuccessEnvelope('문자열')).toBe(false);
    expect(isSuccessEnvelope({ success: 'true' })).toBe(false); // 문자열 'true' 는 아님
  });

  it('isErrorEnvelope', () => {
    expect(isErrorEnvelope(err(ErrorCode.ERR_NOT_FOUND))).toBe(true);
    expect(isErrorEnvelope(ok({}))).toBe(false);
    expect(isErrorEnvelope(null)).toBe(false);
    expect(isErrorEnvelope(undefined)).toBe(false);
    // errorCode 가 문자열이어야 에러 봉투다
    expect(isErrorEnvelope({ success: false })).toBe(false);
    expect(isErrorEnvelope({ success: false, errorCode: 42 })).toBe(false);
  });
});

describe('toPage — 목록 봉투 결합', () => {
  it('pagination 이 있으면 그대로 싣는다', () => {
    const pagination = { total: 100, limit: 20, offset: 40, hasNext: true };
    const envelope: SuccessEnvelope<number[]> = ok([1, 2, 3], pagination);
    expect(toPage(envelope)).toEqual({ items: [1, 2, 3], pagination });
  });

  it('pagination 이 없으면(계약 위반) items 기준 메타로 폴백한다', () => {
    const envelope: SuccessEnvelope<number[]> = ok([1, 2]);
    // 조용히 0 으로 만들지 않고 관측된 items 를 반영 — 오해석 방지
    expect(toPage(envelope)).toEqual({
      items: [1, 2],
      pagination: { total: 2, limit: 2, offset: 0, hasNext: false },
    });
  });

  it('빈 목록', () => {
    expect(toPage(ok([] as number[]))).toEqual({
      items: [],
      pagination: { total: 0, limit: 0, offset: 0, hasNext: false },
    });
  });
});

describe('isKnownErrorCode — additive 성장 관용', () => {
  it('카탈로그 29종은 known', () => {
    for (const code of Object.keys(ErrorCode)) {
      expect(isKnownErrorCode(code)).toBe(true);
    }
  });

  it('미지 코드는 unknown 이지만 값은 보존된다(에러 아님)', () => {
    expect(isKnownErrorCode('ERR_FUTURE')).toBe(false);
    expect(isKnownErrorCode('')).toBe(false);
  });

  it('Object.prototype 상속 키를 코드로 오인하지 않는다', () => {
    // hasOwnProperty 대신 `in` 을 썼다면 'toString' 이 known 으로 나온다
    expect(isKnownErrorCode('toString')).toBe(false);
    expect(isKnownErrorCode('constructor')).toBe(false);
  });
});

describe('isIdempotentReplay — 재전달 감지', () => {
  it('Idempotency-Replayed: true 면 최초 응답 스냅샷', () => {
    const replayed = new Response('{}', {
      headers: { [IDEMPOTENCY_REPLAYED_HEADER]: 'true' },
    });
    expect(isIdempotentReplay(replayed)).toBe(true);
  });

  it('헤더가 없으면 신규 처리', () => {
    expect(isIdempotentReplay(new Response('{}'))).toBe(false);
  });
});

describe('취소·타임아웃', () => {
  it('AbortSignal 로 요청을 취소할 수 있다', async () => {
    const controller = new AbortController();
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({
      apiKey: 'k',
      baseUrl: BASE,
      fetch: fetchImpl,
      retry: { ...NO_DELAY_RETRY, maxRetries: 0 },
    });

    const promise = client.ping({ signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toThrow(StorigeConnectionError);
  });

  it('타임아웃 초과 시 연결 에러', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
      })) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({
      apiKey: 'k',
      baseUrl: BASE,
      fetch: fetchImpl,
      retry: { ...NO_DELAY_RETRY, maxRetries: 0 },
    });

    await expect(client.ping({ timeoutMs: 10 })).rejects.toThrow(StorigeConnectionError);
  });

  it('네트워크 실패는 retrySafe(GET)일 때 재시도 후 성공할 수 있다', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      return new Response(JSON.stringify(ok({ pong: true, serverTime: 'T' })), {
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
    const result = await client.ping();
    expect(result.pong).toBe(true);
    expect(calls).toBe(2);
  });

  it('네트워크 실패가 소진되면 StorigeConnectionError', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({
      apiKey: 'k',
      baseUrl: BASE,
      fetch: fetchImpl,
      retry: { ...NO_DELAY_RETRY, maxRetries: 1 },
    });
    await expect(client.ping()).rejects.toThrow(StorigeConnectionError);
  });

  it('🚨 멱등키 없는 POST(멀티파트)는 네트워크 실패에도 재시도하지 않는다 (중복 생성 방지)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error('ECONNRESET');
    }) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });

    await expect(
      client.books.uploadPdfCover('bk_1', {
        file: { data: new TextEncoder().encode('PDF'), filename: 'a.pdf' },
      }),
    ).rejects.toThrow(StorigeConnectionError);

    // 서버 도달 여부를 알 수 없는데 멱등 보호도 없다 → 재시도하면 중복 자산이 생긴다
    expect(calls).toBe(1);
  });

  it('멱등키 있는 POST 는 네트워크 실패에 재시도한다 (서버가 중복을 막아준다)', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) throw new Error('ECONNRESET');
      return new Response(JSON.stringify(ok({ uid: 'bk_1' })), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    const client = new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
    // JSON POST — 자동 부여된 키가 재시도를 안전하게 만든다
    await client.books.create({ creationType: 'PDF_UPLOAD' });
    expect(calls).toBe(2);
  });
});

describe('409 ERR_IDEMPOTENCY_IN_PROGRESS — 짧은 백오프 후 재시도', () => {
  it('진행 중이면 재시도해 최종 응답을 받는다', async () => {
    const m = mockFetch([
      { status: 409, json: err(ErrorCode.ERR_IDEMPOTENCY_IN_PROGRESS) },
      { status: 201, json: ok({ uid: 'bk_1' }) },
    ]);
    const client = new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: m.fetch, retry: NO_DELAY_RETRY });

    const result = await client.books.create({ creationType: 'PDF_UPLOAD' });
    expect(result).toEqual({ uid: 'bk_1' });
    expect(m.calls).toHaveLength(2);
    // 재시도는 같은 멱등키로 나가야 한다(다른 키면 중복 생성)
    expect(m.calls[0]!.headers['idempotency-key']).toBe(m.calls[1]!.headers['idempotency-key']);
  });
});
