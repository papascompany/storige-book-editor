/**
 * HTTP 코어 — fetch 기반. 봉투 언랩·인증·재시도의 **단일 지점**.
 *
 * 리소스 모듈(books/webhooks/…)은 여기를 통해서만 서버와 대화한다 —
 * 봉투 해석이 흩어지면 계약 변경 시 누락이 생긴다.
 */

import {
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  ErrorCode,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_REPLAYED_HEADER,
  MAX_RETRY_AFTER_MS,
  RETRY_AFTER_FALLBACK_SECONDS,
  StorigeApiError,
  StorigeConnectionError,
  StorigeUsageError,
  V1_PATH_PREFIX,
  isErrorEnvelope,
  isSuccessEnvelope,
  type ErrorEnvelope,
  type Page,
  type SuccessEnvelope,
} from '../index';
import {
  assertValidIdempotencyKey,
  canAutoAssignIdempotencyKey,
  generateIdempotencyKey,
  type BodyKind,
} from './idempotency';

/** 재시도 튜닝 */
export interface RetryOptions {
  /** 최초 시도를 제외한 재시도 횟수. 0 이면 재시도 없음 */
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** full jitter 적용 여부(기본 true — thundering herd 방지) */
  jitter: boolean;
  /**
   * 429 Retry-After 를 자동 준수할 상한(ms).
   *
   * 서버가 지시한 대기가 이 값을 넘으면 **자동 재시도하지 않고** 429 를 던진다
   * (StorigeApiError.retryAfterSeconds 로 값을 전달) — 호출측이 직접 스케줄하게
   * 둔다. 상한이 없으면 잘못 설정된 서버·프록시의 `Retry-After: 86400` 하나에
   * SDK 가 하루를 잠들 수 있다. 기본값은 서버 per-Key 리밋 윈도우(60초)와 동일.
   */
  maxRetryAfterMs: number;
}

/** 호출 단위 옵션 — 모든 리소스 메서드의 마지막 인자 */
export interface RequestOptions {
  /**
   * 멱등 키.
   *
   * - JSON POST: 생략 시 SDK 가 자동 부여(UUID)
   * - 멀티파트 POST: **자동 부여 없음**. 제공 시 파일 해시를 합성해 내용 주소화
   *   (idempotency.ts 상단 사유 참조)
   * - GET/PUT/DELETE: 서버 인터셉터가 POST 만 처리하므로 무시된다(자연 멱등)
   */
  idempotencyKey?: string;
  /** 이 호출만 타임아웃 override — 대용량 업로드/다운로드에 사용 */
  timeoutMs?: number;
  /** 취소 신호 */
  signal?: AbortSignal;
  /** 이 호출만 재시도 override */
  retry?: Partial<RetryOptions>;
  /**
   * 추가 헤더 — 추적 헤더(`X-Request-Id`·`traceparent`) 등에 쓴다.
   *
   * ⚠️ SDK 가 소유한 헤더는 **대소문자 무관하게 거부**한다(StorigeUsageError):
   * `Authorization`·`Accept`·`User-Agent`·`Content-Type`·`Idempotency-Key`.
   * 조용히 무시하지 않는 이유는 {@link RESERVED_HEADERS} 참조 — 실 fetch 는 같은
   * 이름의 헤더를 **덮어쓰지 않고 결합**하므로(`Headers` append 의미론) 그냥
   * 뒀다간 `Authorization: Bearer A, Bearer B` 가 나가 401 이 된다.
   */
  headers?: Record<string, string>;
}

export interface HttpClientOptions {
  /** 파트너 API 키. env(test/live)는 키에 내재 — 별도 파라미터가 아니다 */
  apiKey: string;
  /** 서버 오리진(예: https://api.example.com). 경로 접두 /api/v1 은 SDK 가 붙인다 */
  baseUrl: string;
  timeoutMs?: number;
  retry?: Partial<RetryOptions>;
  /** 주입식 fetch — 테스트/커스텀 에이전트용. 기본은 전역 fetch */
  fetch?: typeof globalThis.fetch;
  /** User-Agent 접미(진단용) */
  userAgent?: string;
}

interface InternalRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, unknown> | undefined;
  /** JSON 본문 */
  json?: unknown;
  /** 멀티파트 본문 */
  form?: FormData;
  options?: RequestOptions | undefined;
}

const DEFAULT_RETRY: RetryOptions = {
  maxRetries: DEFAULT_MAX_RETRIES,
  baseDelayMs: DEFAULT_BACKOFF_BASE_MS,
  maxDelayMs: DEFAULT_BACKOFF_MAX_MS,
  jitter: true,
  maxRetryAfterMs: MAX_RETRY_AFTER_MS,
};

/**
 * SDK 가 소유해 사용자 override 를 거부하는 헤더(소문자 정규화).
 *
 * ## 왜 "무시"가 아니라 "거부"인가 — mock 이 거짓말을 하던 자리
 * `buildHeaders` 는 사용자 헤더를 먼저 펼치고 SDK 값을 덮어쓴다. 그래서 정확히
 * 같은 표기(`Authorization`)면 SDK 값이 이긴다. 하지만 **소문자로 넘기면**
 * (`authorization`) 두 키가 객체에 **공존**하고, 실 fetch 는 레코드를 `Headers`
 * 로 채우며 같은 이름을 **append(결합)** 한다:
 *
 *     실 fetch : "Bearer user-supplied, Bearer sdk-key"  → 서버 401
 *     테스트 mock: "Bearer sdk-key"                      → green (거짓 안심)
 *
 * 즉 "인증 헤더는 덮어쓸 수 없다"는 종전 JSDoc 은 표기가 다르면 **거짓**이었고,
 * 테스트는 그 괴리를 잡지 못했다. 예약 헤더를 거부하면 그 주장이 **참이 된다**.
 *
 * Content-Type 은 멀티파트에서 특히 위험하다 — SDK 가 일부러 비워 fetch 가
 * boundary 를 붙이게 하는데, 사용자가 넣으면 boundary 없는 값이 결합돼 서버가
 * 본문을 파싱하지 못한다. Idempotency-Key 는 `options.idempotencyKey` 로 넘겨야
 * 길이 검증·멀티파트 내용 주소화(idempotency.ts)를 거치고 재시도 안전성 판정
 * (retrySafe)에도 반영된다.
 */
const RESERVED_HEADERS: ReadonlyMap<string, string> = new Map([
  ['authorization', 'apiKey 옵션으로 설정됩니다'],
  ['accept', 'SDK 가 라우트별로 설정합니다'],
  ['user-agent', 'userAgent 옵션을 쓰십시오'],
  ['content-type', 'SDK 가 본문 종류에 따라 설정합니다(멀티파트는 fetch 가 boundary 를 붙여야 해 비워 둡니다)'],
  [IDEMPOTENCY_KEY_HEADER.toLowerCase(), 'options.idempotencyKey 를 쓰십시오(길이 검증·멀티파트 내용 주소화가 적용됩니다)'],
]);

/** GET /books/:uid/pdf 등 봉투 없는 원본 스트림 응답 */
export interface RawStream {
  /** 응답 본문 스트림 — 소비 책임은 호출측 */
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  /** Content-Length. 미제공 시 null */
  contentLength: number | null;
  /** Content-Disposition 에서 뽑은 파일명. 없으면 null */
  filename: string | null;
}

/** 지수 백오프 + full jitter */
export function backoffDelayMs(attempt: number, retry: RetryOptions): number {
  const exponential = Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs);
  if (!retry.jitter) return exponential;
  // full jitter: [0, exponential] 균등 — 다중 클라이언트 동시 재시도 분산
  return Math.floor(Math.random() * exponential);
}

/**
 * 재시도 판정 — **errorCode/status 로만** 분기한다(message 파싱 금지, §3.2).
 *
 * | 조건                              | 재시도 | 지연            |
 * |-----------------------------------|--------|-----------------|
 * | 429                               | O      | Retry-After 준수 |
 * | 5xx                               | 조건부 | 지수 백오프+jitter |
 * | 409 ERR_IDEMPOTENCY_IN_PROGRESS   | O      | 짧은 백오프      |
 * | 그 외 4xx                         | X      | —               |
 *
 * ## 5xx 의 "조건부"
 * 서버는 5xx 시 멱등 선점을 **해제**하므로(스냅샷 미저장) 멱등키를 가진 요청은
 * 재시도해도 중복 생성이 없다. 반대로 **키 없는 POST**(=멀티파트 자동부여 금지
 * 경로)는 5xx 가 "처리 전 실패"인지 "처리 후 응답 실패"인지 구분할 수 없어
 * 재시도가 중복 생성을 낳을 수 있다 → 재시도하지 않는다.
 *
 * 429 는 레이트리밋 가드가 **핸들러 실행 전에** 거부한 것이라 부수효과가 없다
 * → 멱등 보호와 무관하게 항상 재시도 안전.
 */
export function shouldRetry(params: {
  status: number | null;
  errorCode: string | null;
  /** 재시도해도 중복 부수효과가 없는 요청인가 */
  retrySafe: boolean;
}): boolean {
  const { status, errorCode, retrySafe } = params;

  // 네트워크 실패(status 없음) — 서버 도달 여부 불명 → 안전한 요청만
  if (status === null) return retrySafe;

  if (status === 429) return true;

  if (status === 409 && errorCode === ErrorCode.ERR_IDEMPOTENCY_IN_PROGRESS) {
    // 키가 있어야만 발생하는 코드 → 원 요청 완료를 기다렸다 재시도
    return true;
  }

  if (status >= 500) return retrySafe;

  return false;
}

/** 429 Retry-After(초) 파싱 — delta-seconds 및 HTTP-date 형식 모두 수용 */
export function parseRetryAfterSeconds(headerValue: string | null): number | null {
  if (headerValue === null || headerValue.trim() === '') return null;
  const raw = headerValue.trim();

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  // HTTP-date 형식 — 서버 가드는 초를 보내지만 프록시가 바꿔 끼울 수 있다
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000));
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StorigeConnectionError('요청이 취소되었습니다', signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new StorigeConnectionError('요청이 취소되었습니다', signal?.reason));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Content-Disposition 에서 filename 추출(실패 시 null) */
function parseFilename(disposition: string | null): string | null {
  if (disposition === null) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? null;
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Date) {
      params.append(key, value.toISOString());
      continue;
    }
    params.append(key, String(value));
  }
  const serialized = params.toString();
  return serialized === '' ? '' : `?${serialized}`;
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryOptions;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly userAgent: string;

  constructor(options: HttpClientOptions) {
    if (!options.apiKey) {
      throw new StorigeUsageError('apiKey 가 필요합니다');
    }
    if (!options.baseUrl) {
      throw new StorigeUsageError('baseUrl 이 필요합니다 (예: https://api.example.com)');
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new StorigeUsageError(
        '전역 fetch 를 찾을 수 없습니다 — Node 18+ 를 쓰거나 options.fetch 를 주입하세요',
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    // bind: 일부 런타임의 전역 fetch 는 illegal invocation 을 피하려면 바인딩이 필요
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.userAgent = options.userAgent ?? '@storige/sdk';
  }

  /** 봉투를 벗겨 data 를 반환(단건 라우트) */
  async request<T>(req: InternalRequest): Promise<T> {
    const envelope = await this.requestEnvelope<T>(req);
    return envelope.data;
  }

  /** 봉투를 벗겨 items+pagination 을 Page 로 반환(목록 라우트) */
  async requestPage<T>(req: InternalRequest): Promise<Page<T>> {
    const envelope = await this.requestEnvelope<T[]>(req);
    const items = envelope.data;
    return {
      items,
      pagination: envelope.pagination ?? {
        total: items.length,
        limit: items.length,
        offset: 0,
        hasNext: false,
      },
    };
  }

  /**
   * 원본 스트림 요청 — 봉투 없는 raw 응답용(GET /books/:uid/pdf).
   *
   * 성공은 application/pdf 스트림(@Res 직접 파이프라 봉투가 없다), 오류일 때만
   * JSON 봉투가 온다 → Content-Type 분기가 필수다.
   */
  async requestStream(req: InternalRequest): Promise<RawStream> {
    const res = await this.send(req, 'stream');
    const contentType = res.headers.get('content-type') ?? '';

    // 오류 경로 — 봉투(JSON)로 온다
    if (!res.ok || contentType.includes('application/json')) {
      await this.throwFromResponse(res);
    }
    if (res.body === null) {
      throw new StorigeConnectionError('응답 본문이 비어 있습니다');
    }
    const length = res.headers.get('content-length');
    return {
      stream: res.body,
      contentType: contentType === '' ? 'application/octet-stream' : contentType,
      contentLength: length === null ? null : Number(length),
      filename: parseFilename(res.headers.get('content-disposition')),
    };
  }

  private async requestEnvelope<T>(req: InternalRequest): Promise<SuccessEnvelope<T>> {
    const res = await this.send(req, 'json');
    if (!res.ok) {
      await this.throwFromResponse(res);
    }

    // 204 등 본문 없는 성공 — 서버 v1 표면에는 없으나 방어적으로 수용
    const text = await res.text();
    if (text === '') {
      return { success: true, message: 'Success', data: null as T, pagination: null };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      throw new StorigeConnectionError(
        `서버 응답을 JSON 으로 파싱할 수 없습니다 (status=${res.status})`,
        err,
      );
    }

    // 2xx 인데 에러 봉투 — 계약상 없어야 하지만 조용히 넘기지 않는다
    if (isErrorEnvelope(parsed)) {
      throw this.toApiError(parsed, res);
    }
    if (!isSuccessEnvelope(parsed)) {
      throw new StorigeConnectionError(
        `v1 성공 봉투 형식이 아닙니다 (status=${res.status})`,
      );
    }
    return parsed as SuccessEnvelope<T>;
  }

  /** 재시도 루프 — 실제 fetch 발신 */
  private async send(req: InternalRequest, mode: 'json' | 'stream'): Promise<Response> {
    const retry = { ...this.retry, ...req.options?.retry };
    const url = `${this.baseUrl}${V1_PATH_PREFIX}${req.path}${buildQuery(req.query)}`;
    const bodyKind: BodyKind = req.form ? 'multipart' : req.json === undefined ? 'none' : 'json';

    const { headers, hasIdempotencyKey } = this.buildHeaders(req, bodyKind, mode);
    // 재시도가 중복 부수효과를 만들지 않는 요청인가
    const retrySafe = req.method !== 'POST' || hasIdempotencyKey;

    let lastError: unknown;
    for (let attempt = 0; attempt <= retry.maxRetries; attempt += 1) {
      let res: Response;
      try {
        res = await this.fetchOnce(url, req, headers);
      } catch (err) {
        lastError = err;
        if (err instanceof StorigeConnectionError && err.message.includes('취소')) throw err;
        if (!shouldRetry({ status: null, errorCode: null, retrySafe }) || attempt === retry.maxRetries) {
          throw new StorigeConnectionError(
            `요청 실패: ${err instanceof Error ? err.message : String(err)}`,
            err,
          );
        }
        await sleep(backoffDelayMs(attempt, retry), req.options?.signal);
        continue;
      }

      if (res.ok) return res;

      // 오류 — 재시도 판정을 위해 errorCode 를 읽되, 본문은 한 번만 소비 가능하므로
      // 재시도하지 않을 경우 원본을 그대로 돌려주도록 clone 을 쓴다.
      const errorCode = await this.peekErrorCode(res);
      const retryable = shouldRetry({ status: res.status, errorCode, retrySafe });
      if (!retryable || attempt === retry.maxRetries) return res;

      const delayMs = this.retryDelayMs(res, errorCode, attempt, retry);
      // 서버가 지시한 대기가 상한을 넘으면 자동 재시도를 포기하고 429 를 돌려준다
      // — 호출측이 retryAfterSeconds 를 보고 직접 스케줄하도록(무한 sleep 방지).
      if (res.status === 429 && delayMs > retry.maxRetryAfterMs) return res;
      await sleep(delayMs, req.options?.signal);
    }

    // 루프는 항상 return/throw 로 빠져나간다 — 방어적 폴백
    throw new StorigeConnectionError('요청 재시도가 모두 실패했습니다', lastError);
  }

  /** 429=Retry-After 준수 / 409 IN_PROGRESS=짧은 백오프 / 5xx=지수 백오프 */
  private retryDelayMs(
    res: Response,
    errorCode: string | null,
    attempt: number,
    retry: RetryOptions,
  ): number {
    if (res.status === 429) {
      const seconds =
        parseRetryAfterSeconds(res.headers.get('retry-after')) ?? RETRY_AFTER_FALLBACK_SECONDS;
      return seconds * 1000;
    }
    if (res.status === 409 && errorCode === ErrorCode.ERR_IDEMPOTENCY_IN_PROGRESS) {
      // 원 요청이 끝나길 기다린다 — 지수 증가로 과도한 폴링 방지
      return Math.min(retry.baseDelayMs * 2 ** attempt, retry.maxDelayMs);
    }
    return backoffDelayMs(attempt, retry);
  }

  private async fetchOnce(
    url: string,
    req: InternalRequest,
    headers: Record<string, string>,
  ): Promise<Response> {
    const timeoutMs = req.options?.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`타임아웃 ${timeoutMs}ms 초과`)), timeoutMs);
    const external = req.options?.signal;
    const onExternalAbort = () => controller.abort(external?.reason);
    external?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const body: BodyInit | undefined = req.form ?? (req.json === undefined ? undefined : JSON.stringify(req.json));
      return await this.fetchImpl(url, {
        method: req.method,
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * 인증·멱등 헤더 구성.
   *
   * ⚠️ 인증은 `Authorization: Bearer <key>` **단독**으로 보낸다. 서버 가드는
   *    Bearer 와 X-API-Key 를 병행 수용하지만 **둘 다 왔는데 값이 다르면 401**
   *    (모호성 거부)이다. 굳이 두 헤더를 보낼 이유가 없고, 프록시가 한쪽을
   *    바꿔 끼우면 401 이 되므로 단독 전송이 안전하다.
   *
   * @throws {StorigeUsageError} options.headers 에 SDK 예약 헤더가 있을 때
   *   ({@link RESERVED_HEADERS} — 대소문자 무관)
   */
  private buildHeaders(
    req: InternalRequest,
    bodyKind: BodyKind,
    mode: 'json' | 'stream',
  ): { headers: Record<string, string>; hasIdempotencyKey: boolean } {
    const headers: Record<string, string> = {
      // 사용자 헤더 — 예약 헤더는 여기서 걸러진다(뒤에서 덮어쓰는 것으로는
      // 부족하다: 표기가 다르면 두 키가 공존해 실 fetch 가 값을 **결합**한다)
      ...this.userHeaders(req.options?.headers),
      Authorization: `Bearer ${this.apiKey}`,
      Accept: mode === 'stream' ? 'application/pdf, application/json' : 'application/json',
      'User-Agent': this.userAgent,
    };

    // multipart 는 boundary 를 fetch 가 붙여야 하므로 Content-Type 을 세팅하지 않는다
    if (req.json !== undefined && !req.form) {
      headers['Content-Type'] = 'application/json';
    }

    const explicitKey = req.options?.idempotencyKey;
    if (explicitKey !== undefined) {
      assertValidIdempotencyKey(explicitKey);
      headers[IDEMPOTENCY_KEY_HEADER] = explicitKey;
      return { headers, hasIdempotencyKey: true };
    }

    // 자동 부여 — JSON POST 만(멀티파트 제외: idempotency.ts 상단 사유)
    if (canAutoAssignIdempotencyKey(req.method, bodyKind)) {
      headers[IDEMPOTENCY_KEY_HEADER] = generateIdempotencyKey();
      return { headers, hasIdempotencyKey: true };
    }

    return { headers, hasIdempotencyKey: false };
  }

  /** 사용자 헤더 검사 — 예약 헤더는 조용히 버리지 않고 즉시 알린다 */
  private userHeaders(headers: Record<string, string> | undefined): Record<string, string> {
    if (headers === undefined) return {};
    for (const name of Object.keys(headers)) {
      const reason = RESERVED_HEADERS.get(name.toLowerCase());
      if (reason !== undefined) {
        throw new StorigeUsageError(
          `options.headers 에 '${name}' 를 넣을 수 없습니다 — SDK 가 소유하는 헤더입니다 (${reason}). ` +
            '실 fetch 는 같은 이름의 헤더를 덮어쓰지 않고 결합하므로 그대로 두면 ' +
            '잘못된 값이 전송됩니다.',
        );
      }
    }
    return headers;
  }

  /** 본문을 소비하지 않고 errorCode 만 엿본다(재시도 판정용) */
  private async peekErrorCode(res: Response): Promise<string | null> {
    try {
      const parsed: unknown = await res.clone().json();
      return isErrorEnvelope(parsed) ? parsed.errorCode : null;
    } catch {
      return null; // 봉투가 아니거나 파싱 불가 — status 로만 판정
    }
  }

  private async throwFromResponse(res: Response): Promise<never> {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new StorigeApiError({
        errorCode: ErrorCode.ERR_INTERNAL,
        status: res.status,
        message: `서버가 v1 봉투가 아닌 응답을 반환했습니다 (status=${res.status})`,
        retryAfterSeconds: parseRetryAfterSeconds(res.headers.get('retry-after')),
      });
    }
    if (!isErrorEnvelope(parsed)) {
      throw new StorigeApiError({
        errorCode: ErrorCode.ERR_INTERNAL,
        status: res.status,
        message: `서버가 v1 에러 봉투가 아닌 응답을 반환했습니다 (status=${res.status})`,
      });
    }
    throw this.toApiError(parsed, res);
  }

  private toApiError(envelope: ErrorEnvelope, res: Response): StorigeApiError {
    return new StorigeApiError({
      errorCode: envelope.errorCode,
      status: res.status,
      message: envelope.message,
      requestId: envelope.requestId,
      errors: envelope.errors,
      fieldErrors: envelope.fieldErrors,
      retryAfterSeconds: parseRetryAfterSeconds(res.headers.get('retry-after')),
    });
  }
}

/** 응답이 멱등 재전달(최초 응답 스냅샷)인지 — 진단용 */
export function isIdempotentReplay(res: Response): boolean {
  return res.headers.get(IDEMPOTENCY_REPLAYED_HEADER.toLowerCase()) === 'true';
}
