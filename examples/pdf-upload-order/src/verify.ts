/**
 * 오프라인 검증(드라이런) — **라이브 키 없이** 흐름을 돌려 본다.
 *
 *   node src/verify.ts
 *
 * 주입식 fetch(`new StorigeClient({ fetch })`)로 서버를 흉내 내고, 실제 SDK 를
 * 통과한 **호출 시퀀스**(경로·메서드·헤더·봉투 언랩)를 단언한다. 파트너 입장에선
 * "내 통합이 어떤 HTTP 요청을 만드는가"를 서버 없이 눈으로 확인하는 용도고,
 * 이 레포 입장에선 예제가 SDK 변경으로 썩는 것을 막는 회귀 그물이다.
 *
 * 검증 대상:
 *   A. fileId 참조 경로 — 전 여정 9콜 시퀀스 + POST 전량 Idempotency-Key 자동 부여
 *   B. 멀티파트 경로    — 자동 부여 **없음**, 명시 키는 파일 해시로 내용 주소화
 *   C. 실패 경로        — 409 ERR_FINALIZATION_IN_PROGRESS → 기존 attempt 합류
 *   D. 실패 경로        — 422 ERR_PAGE_COUNT_OUT_OF_RANGE 를 사람이 읽는 오류로 번역
 */

import assert from 'node:assert/strict';

import { StorigeClient } from '@storige/sdk/client';

import { runPdfUploadOrder } from './order.ts';

// ── 최소 mock 서버 ──────────────────────────────────────────────────────

interface Call {
  method: string;
  path: string;
  query: string;
  headers: Record<string, string>;
  bodyKind: 'none' | 'json' | 'multipart';
  json: unknown;
}

type Route = (call: Call) => { status?: number; json?: unknown; raw?: string };

function ok<T>(data: T, pagination: unknown = null): unknown {
  return { success: true, message: 'Success', data, pagination };
}

function fail(errorCode: string, message = '오류'): unknown {
  return { success: false, errorCode, message, errors: [], fieldErrors: null, requestId: 'req_1' };
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
    // 실 fetch 와 같은 의미론(대소문자 정규화·동명 헤더 결합)을 쓰려면 Headers 를 거쳐야 한다.
    new Headers(init?.headers ?? {}).forEach((value, key) => {
      headers[key] = value;
    });

    const body = init?.body;
    const bodyKind = body === undefined || body === null
      ? 'none'
      : body instanceof FormData
        ? 'multipart'
        : 'json';

    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: url.search,
      headers,
      bodyKind,
      json: bodyKind === 'json' ? JSON.parse(String(body)) : null,
    };
    calls.push(call);

    const key = `${call.method} ${call.path}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`mock 라우트 없음: ${key}`);

    const result = route(call);
    if (result.raw !== undefined) {
      return new Response(result.raw, {
        status: result.status ?? 200,
        headers: { 'content-type': 'application/pdf', 'content-length': String(result.raw.length) },
      });
    }
    return new Response(JSON.stringify(result.json ?? null), {
      status: result.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  return { fetch: impl as unknown as typeof globalThis.fetch, calls };
}

// ── 고정 응답 ───────────────────────────────────────────────────────────

const SPEC = {
  uid: 'bs_demo',
  name: 'A5 무선 데모',
  coverType: 'soft',
  bindingType: 'perfect',
  orientation: 'portrait' as const,
  innerTrimWidthMm: 148,
  innerTrimHeightMm: 210,
  bleedMm: 3,
  sizeToleranceMm: 1,
  pageMin: 20,
  pageMax: 400,
  pageIncrement: 2,
  defaultPaperCode: 'MJ100',
  isActive: true,
};

const SIZE = {
  bookSpecUid: SPEC.uid,
  pageCount: 24,
  sizeToleranceMm: 1,
  bleedMm: 3,
  inner: { trimWidthMm: 148, trimHeightMm: 210, workWidthMm: 154, workHeightMm: 216 },
  spine: { widthMm: 2.4, paperThicknessMm: 0.1, bindingMarginMm: 0, formula: 'pages/2*thickness' },
  cover: { trimWidthMm: 298.4, trimHeightMm: 210, workWidthMm: 304.4, workHeightMm: 216 },
  warnings: [],
};

const BOOK = {
  uid: 'bk_demo',
  env: 'test' as const,
  creationType: 'PDF_UPLOAD' as const,
  status: 'DRAFT' as const,
  bookSpecUid: SPEC.uid,
  pageCount: 24,
  title: null,
  partnerRef: 'demo-order-0001',
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z',
  finalizedAt: null,
};

const asset = (assetType: string) => ({
  assetType,
  fileId: 'file_1',
  sortOrder: 0,
  status: 'active',
  createdAt: '2026-07-20T00:00:00.000Z',
});

const finalization = (status: string) => ({
  uid: 'fin_demo',
  bookUid: BOOK.uid,
  status,
  attempt: 1,
  pageCount: status === 'COMPLETED' ? 24 : null,
  validationSkipped: false,
  outputFileId: status === 'COMPLETED' ? 'file_out' : null,
  errorCode: null,
  errorDetail: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  startedAt: null,
  completedAt: null,
});

const HAPPY_ROUTES: Record<string, Route> = {
  'GET /api/v1/ping': () => ({ json: ok({ pong: true, serverTime: '2026-07-20T00:00:00.000Z' }) }),
  'GET /api/v1/book-specs': () => ({
    json: ok([SPEC], { total: 1, limit: 20, offset: 0, hasNext: false }),
  }),
  'GET /api/v1/book-specs/bs_demo': () => ({ json: ok(SPEC) }),
  'GET /api/v1/book-specs/bs_demo/calculated-size': () => ({ json: ok(SIZE) }),
  'POST /api/v1/books': () => ({ json: ok(BOOK) }),
  'POST /api/v1/books/bk_demo/pdf-cover': () => ({ json: ok(asset('pdf_cover')) }),
  'POST /api/v1/books/bk_demo/pdf-contents': () => ({ json: ok(asset('pdf_contents')) }),
  'POST /api/v1/books/bk_demo/finalization': () => ({ json: ok(finalization('PENDING')) }),
  'GET /api/v1/books/bk_demo/finalization': () => ({ json: ok(finalization('COMPLETED')) }),
  'GET /api/v1/books/bk_demo/pdf': () => ({ raw: '%PDF-1.7 (mock)' }),
};

function client(fetchImpl: typeof globalThis.fetch): StorigeClient {
  return new StorigeClient({
    apiKey: 'sk_test_example_not_a_real_key',
    baseUrl: 'https://api.example.test',
    fetch: fetchImpl,
  });
}

const silent = (): void => {};

// ── A. fileId 참조 경로 — 전 여정 시퀀스 ────────────────────────────────

async function verifyFileIdPath(): Promise<void> {
  const mock = createMock(HAPPY_ROUTES);
  const outcome = await runPdfUploadOrder(
    client(mock.fetch),
    {
      bookSpecUid: undefined, // 목록에서 자동 선택
      pageCount: 24,
      partnerRef: 'demo-order-0001',
      cover: { fileId: 'file_cover' },
      contents: { fileId: 'file_contents' },
      skipPolling: false,
    },
    silent,
  );

  assert.equal(outcome.kind, 'completed');

  assert.deepEqual(
    mock.calls.map((c) => `${c.method} ${c.path}${c.query}`),
    [
      'GET /api/v1/ping',
      'GET /api/v1/book-specs?limit=20',
      'GET /api/v1/book-specs/bs_demo/calculated-size?pageCount=24',
      'POST /api/v1/books',
      'POST /api/v1/books/bk_demo/pdf-cover',
      'POST /api/v1/books/bk_demo/pdf-contents',
      'POST /api/v1/books/bk_demo/finalization',
      'GET /api/v1/books/bk_demo/finalization',
      'GET /api/v1/books/bk_demo/pdf',
    ],
    'PDF_UPLOAD 전 여정 호출 시퀀스',
  );

  // 인증은 Bearer 단일 헤더 — 전 호출 공통
  for (const call of mock.calls) {
    assert.equal(call.headers['authorization'], 'Bearer sk_test_example_not_a_real_key');
  }

  // 자산 투입이 JSON(fileId 참조) 인지 — 멀티파트가 아니어야 자동 멱등이 산다
  const coverCall = mock.calls.find((c) => c.path.endsWith('/pdf-cover'));
  assert.equal(coverCall?.bodyKind, 'json');
  assert.deepEqual(coverCall?.json, { fileId: 'file_cover' });

  // POST 전량 Idempotency-Key 자동 부여(JSON/본문없음 경로)
  for (const call of mock.calls.filter((c) => c.method === 'POST')) {
    assert.ok(
      (call.headers['idempotency-key'] ?? '').length > 0,
      `${call.path} 에 Idempotency-Key 자동 부여`,
    );
  }

  // 봉투 언랩 — 호출측은 { success, data } 를 몰라도 된다
  assert.equal(outcome.book.uid, 'bk_demo');
  if (outcome.kind === 'completed') {
    assert.equal(outcome.finalization.status, 'COMPLETED');
    assert.equal(outcome.pdf.contentType, 'application/pdf');
    await outcome.pdf.stream.cancel();
  }

  console.log('✓ A. fileId 참조 경로 — 9콜 시퀀스 / Bearer 인증 / POST 멱등키 자동 부여');
}

// ── B. 멀티파트 경로 — 자동 부여 없음, 명시 키는 내용 주소화 ────────────

async function verifyMultipartPath(): Promise<void> {
  const mock = createMock(HAPPY_ROUTES);
  const bytes = new TextEncoder().encode('%PDF-1.7 cover bytes');

  await runPdfUploadOrder(
    client(mock.fetch),
    {
      bookSpecUid: 'bs_demo',
      pageCount: 24,
      partnerRef: 'demo-order-0002',
      cover: { file: { data: bytes, filename: 'cover.pdf' } },
      contents: { fileId: 'file_contents' },
      skipPolling: true,
    },
    silent,
  );

  const coverCall = mock.calls.find((c) => c.path.endsWith('/pdf-cover'));
  assert.equal(coverCall?.bodyKind, 'multipart', '직접 업로드는 멀티파트');

  // 예제가 명시 키를 넘겼으므로 SDK 가 파일 해시를 합성한다 →
  // 원본 키와 달라야 하고(내용 주소화), 같은 키로 다른 파일을 올리면 키도 달라진다.
  const key = coverCall?.headers['idempotency-key'] ?? '';
  assert.notEqual(key, 'bk_demo:cover', '멱등키가 파일 해시로 합성돼야 한다');
  assert.match(key, /^bk_demo:cover:[0-9a-f]{64}$/, '`${key}:${sha256(bytes)}` 형태');

  // skipPolling=true → 최종화 착수까지만
  assert.deepEqual(
    mock.calls.map((c) => `${c.method} ${c.path}`),
    [
      'GET /api/v1/ping',
      'GET /api/v1/book-specs/bs_demo',
      'GET /api/v1/book-specs/bs_demo/calculated-size',
      'POST /api/v1/books',
      'POST /api/v1/books/bk_demo/pdf-cover',
      'POST /api/v1/books/bk_demo/pdf-contents',
      'POST /api/v1/books/bk_demo/finalization',
    ],
    'skipPolling=true 는 최종화 착수에서 멈춘다(완료 통지는 웹훅)',
  );

  // 대조군: 멱등키를 **주지 않으면** 멀티파트에는 헤더가 아예 붙지 않는다.
  // (서버 request_hash 가 파일을 반영하지 못해 SDK 가 자동 부여를 거부하는 것 — README §멱등)
  const bare = createMock(HAPPY_ROUTES);
  await client(bare.fetch).books.uploadPdfCover('bk_demo', {
    file: { data: bytes, filename: 'cover.pdf' },
  });
  assert.equal(
    bare.calls[0]?.headers['idempotency-key'],
    undefined,
    '멀티파트는 Idempotency-Key 를 자동 부여하지 않는다',
  );

  console.log('✓ B. 멀티파트 경로 — 자동 부여 없음 / 명시 키 = `키:sha256(파일)` 내용 주소화');
}

// ── C. 409 ERR_FINALIZATION_IN_PROGRESS ─────────────────────────────────

async function verifyFinalizationInProgress(): Promise<void> {
  const mock = createMock({
    ...HAPPY_ROUTES,
    'POST /api/v1/books/bk_demo/finalization': () => ({
      status: 409,
      json: fail('ERR_FINALIZATION_IN_PROGRESS', '최종화가 진행 중입니다'),
    }),
  });

  const outcome = await runPdfUploadOrder(
    client(mock.fetch),
    {
      bookSpecUid: 'bs_demo',
      pageCount: 24,
      partnerRef: 'demo-order-0003',
      cover: { fileId: 'file_cover' },
      contents: { fileId: 'file_contents' },
      skipPolling: false,
    },
    silent,
  );

  // 409 는 "이미 돌고 있다" — 주문 실패가 아니라 기존 attempt 합류로 이어져야 한다
  assert.equal(outcome.kind, 'completed');
  const paths = mock.calls.map((c) => `${c.method} ${c.path}`);
  assert.equal(
    paths.filter((p) => p === 'POST /api/v1/books/bk_demo/finalization').length,
    1,
    '409 는 재시도 대상이 아니다(중복 착수 금지)',
  );
  assert.ok(paths.includes('GET /api/v1/books/bk_demo/finalization'), '기존 attempt 조회로 폴백');
  if (outcome.kind === 'completed') await outcome.pdf.stream.cancel();

  console.log('✓ C. 409 ERR_FINALIZATION_IN_PROGRESS — 재착수 없이 기존 attempt 합류');
}

// ── D. 422 ERR_PAGE_COUNT_OUT_OF_RANGE ──────────────────────────────────

async function verifyPageCountOutOfRange(): Promise<void> {
  const mock = createMock({
    ...HAPPY_ROUTES,
    'GET /api/v1/book-specs/bs_demo/calculated-size': () => ({
      status: 422,
      json: fail('ERR_PAGE_COUNT_OUT_OF_RANGE', 'pageCount 범위 위반'),
    }),
  });

  await assert.rejects(
    runPdfUploadOrder(
      client(mock.fetch),
      {
        // 판형 규칙(min20/max400/inc2)은 통과하지만 서버가 422 를 준 상황
        bookSpecUid: 'bs_demo',
        pageCount: 24,
        partnerRef: 'demo-order-0004',
        cover: { fileId: 'file_cover' },
        contents: { fileId: 'file_contents' },
        skipPolling: false,
      },
      silent,
    ),
    /허용 범위를 벗어났습니다/,
    '422 는 errorCode 로 판별해 사람이 읽는 오류로 번역된다',
  );

  // 도서를 만들기 **전에** 멈춰야 한다 — 고아 DRAFT 를 남기지 않는다
  assert.ok(
    !mock.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/books'),
    '판형 검증 실패 시 도서를 생성하지 않는다',
  );

  console.log('✓ D. 422 ERR_PAGE_COUNT_OUT_OF_RANGE — 도서 생성 전에 차단');
}

async function main(): Promise<void> {
  await verifyFileIdPath();
  await verifyMultipartPath();
  await verifyFinalizationInProgress();
  await verifyPageCountOutOfRange();
  console.log('\n✓ pdf-upload-order 오프라인 검증 4/4 통과');
}

main().catch((error: unknown) => {
  console.error('✗ 검증 실패:', error);
  process.exitCode = 1;
});
