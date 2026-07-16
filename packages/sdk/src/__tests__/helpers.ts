/**
 * 테스트 헬퍼 — fetch mock + 봉투 빌더.
 */

import type { ErrorEnvelope, Pagination, SuccessEnvelope } from '../envelope';
import type { RetryOptions } from '../client/http';

export interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null | undefined;
}

export interface MockResponseSpec {
  status?: number;
  /** JSON 본문(봉투) */
  json?: unknown;
  /** 원본 본문(스트림 라우트) */
  raw?: Uint8Array | string;
  headers?: Record<string, string>;
}

export interface FetchMock {
  fetch: typeof globalThis.fetch;
  calls: CapturedRequest[];
}

/** 순차 응답 큐 기반 fetch mock — 마지막 응답은 소진 후 반복 사용 */
export function mockFetch(responses: MockResponseSpec[]): FetchMock {
  const calls: CapturedRequest[] = [];
  let index = 0;

  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // ⚠️ 실 fetch 의미론을 그대로 쓴다. 종전처럼 `headers[k.toLowerCase()] = v` 로
    //    직접 채우면 **같은 이름의 헤더가 덮어써진다** — 실 fetch 는 Headers 로
    //    채우며 **append(결합)** 하므로(`Bearer A, Bearer B`) mock 이 통과시킨 요청이
    //    실전에서 401 이 나는 괴리가 생긴다. Headers 를 거치면 결합·대소문자 정규화·
    //    잘못된 헤더명 거부까지 실물과 같아진다.
    // (forEach 를 쓰는 이유: tsconfig lib 이 DOM 이라 Headers 반복자 타입은
    //  DOM.Iterable 이 있어야 잡힌다 — 공용 tsconfig 를 건드리지 않는다)
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body,
    });

    const spec = responses[Math.min(index, responses.length - 1)] as MockResponseSpec;
    index += 1;

    const status = spec.status ?? 200;
    const responseHeaders = new Headers(spec.headers ?? {});

    if (spec.raw !== undefined) {
      if (!responseHeaders.has('content-type')) {
        responseHeaders.set('content-type', 'application/pdf');
      }
      const bytes = typeof spec.raw === 'string' ? new TextEncoder().encode(spec.raw) : spec.raw;
      // TS 5.9 의 Uint8Array<ArrayBufferLike> 는 BlobPart(Uint8Array<ArrayBuffer>)와
      // 제네릭 인자가 달라 직접 대입되지 않는다 — 런타임상 동일한 값이라 좁혀 준다.
      return new Response(new Blob([bytes as BlobPart]), { status, headers: responseHeaders });
    }

    responseHeaders.set('content-type', 'application/json');
    return new Response(JSON.stringify(spec.json ?? null), { status, headers: responseHeaders });
  };

  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, calls };
}

/** 성공 봉투 */
export function ok<T>(data: T, pagination: Pagination | null = null): SuccessEnvelope<T> {
  return { success: true, message: 'Success', data, pagination };
}

/** 에러 봉투 */
export function err(
  errorCode: string,
  message = '오류',
  extra: Partial<ErrorEnvelope> = {},
): ErrorEnvelope {
  return {
    success: false,
    errorCode,
    message,
    errors: [],
    fieldErrors: null,
    requestId: 'req_test_1',
    ...extra,
  };
}

/**
 * 재시도 지연을 없애 테스트를 빠르게 — 재시도 '여부'만 검증할 때 사용.
 *
 * ⚠️ 429 는 지연이 Retry-After 에서 오므로 이 설정으로도 실제로 잔다.
 *    429 경로 테스트는 maxRetries:0 을 쓰거나 retry-after 를 작게 준다.
 */
export const NO_DELAY_RETRY: Partial<RetryOptions> = {
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitter: false,
};

/** FormData 에서 파일 바이트를 꺼낸다(멀티파트 단언용) */
export async function formFileBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (!(body instanceof FormData)) return null;
  const file = body.get('file');
  if (!(file instanceof Blob)) return null;
  return new Uint8Array(await file.arrayBuffer());
}
