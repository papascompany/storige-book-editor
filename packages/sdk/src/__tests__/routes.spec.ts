/**
 * v1 표면 22라우트 전수 — method·path·query 직렬화 대조.
 *
 * 서버 라우트 정본:
 *  - ping 1        apps/api/src/partner-api/ping.controller.ts
 *  - book-specs 3  apps/api/src/book-specs/book-specs.controller.ts
 *  - books 11      apps/api/src/books/books.controller.ts
 *  - webhooks 7    apps/api/src/webhook/v2/partner-webhooks.controller.ts
 */

import { describe, expect, it } from 'vitest';
import { StorigeClient } from '../client/client';
import { NO_DELAY_RETRY, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';
const PREFIX = `${BASE}/api/v1`;

function client(fetchImpl: typeof globalThis.fetch) {
  return new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
}

/** 라우트 1건 호출 후 (method, url) 반환 */
async function capture(
  call: (c: StorigeClient) => Promise<unknown>,
  response: unknown = ok({}),
): Promise<{ method: string; url: string }> {
  const m = mockFetch([{ json: response }]);
  await call(client(m.fetch));
  const req = m.calls[0]!;
  return { method: req.method, url: req.url };
}

describe('v1 표면 22라우트 — method·path 대조', () => {
  it('[1/22] GET /ping', async () => {
    expect(await capture((c) => c.ping(), ok({ pong: true, serverTime: 'T' }))).toEqual({
      method: 'GET',
      url: `${PREFIX}/ping`,
    });
  });

  // ── book-specs 3 ────────────────────────────────────────────────────
  it('[2/22] GET /book-specs', async () => {
    expect(await capture((c) => c.bookSpecs.list(), ok([]))).toEqual({
      method: 'GET',
      url: `${PREFIX}/book-specs`,
    });
  });

  it('[3/22] GET /book-specs/{uid}', async () => {
    expect(await capture((c) => c.bookSpecs.get('bs_1'))).toEqual({
      method: 'GET',
      url: `${PREFIX}/book-specs/bs_1`,
    });
  });

  it('[4/22] GET /book-specs/{uid}/calculated-size', async () => {
    expect(await capture((c) => c.bookSpecs.calculatedSize('bs_1', 100))).toEqual({
      method: 'GET',
      url: `${PREFIX}/book-specs/bs_1/calculated-size?pageCount=100`,
    });
  });

  // ── books 11 ────────────────────────────────────────────────────────
  it('[5/22] POST /books', async () => {
    expect(await capture((c) => c.books.create({ creationType: 'PDF_UPLOAD' }))).toEqual({
      method: 'POST',
      url: `${PREFIX}/books`,
    });
  });

  it('[6/22] GET /books', async () => {
    expect(await capture((c) => c.books.list(), ok([]))).toEqual({
      method: 'GET',
      url: `${PREFIX}/books`,
    });
  });

  it('[7/22] POST /books/{uid}/pdf-cover', async () => {
    expect(await capture((c) => c.books.uploadPdfCover('bk_1', { fileId: 'f1' }))).toEqual({
      method: 'POST',
      url: `${PREFIX}/books/bk_1/pdf-cover`,
    });
  });

  it('[8/22] PUT /books/{uid}/pdf-cover', async () => {
    expect(await capture((c) => c.books.replacePdfCover('bk_1', { fileId: 'f1' }))).toEqual({
      method: 'PUT',
      url: `${PREFIX}/books/bk_1/pdf-cover`,
    });
  });

  it('[9/22] POST /books/{uid}/pdf-contents', async () => {
    expect(await capture((c) => c.books.uploadPdfContents('bk_1', { fileId: 'f1' }))).toEqual({
      method: 'POST',
      url: `${PREFIX}/books/bk_1/pdf-contents`,
    });
  });

  it('[10/22] PUT /books/{uid}/pdf-contents', async () => {
    expect(await capture((c) => c.books.replacePdfContents('bk_1', { fileId: 'f1' }))).toEqual({
      method: 'PUT',
      url: `${PREFIX}/books/bk_1/pdf-contents`,
    });
  });

  it('[11/22] POST /books/{uid}/photos', async () => {
    expect(await capture((c) => c.books.addPhoto('bk_1', { fileId: 'f1' }))).toEqual({
      method: 'POST',
      url: `${PREFIX}/books/bk_1/photos`,
    });
  });

  it('[12/22] POST /books/{uid}/finalization', async () => {
    expect(await capture((c) => c.books.startFinalization('bk_1'))).toEqual({
      method: 'POST',
      url: `${PREFIX}/books/bk_1/finalization`,
    });
  });

  it('[13/22] GET /books/{uid}/finalization', async () => {
    expect(await capture((c) => c.books.getFinalization('bk_1'))).toEqual({
      method: 'GET',
      url: `${PREFIX}/books/bk_1/finalization`,
    });
  });

  it('[14/22] GET /books/{uid}/pdf — 스트림(별도 spec 에서 상세 검증)', async () => {
    const m = mockFetch([{ raw: '%PDF-1.7', headers: { 'content-type': 'application/pdf' } }]);
    await client(m.fetch).books.downloadPdf('bk_1');
    expect(m.calls[0]!.method).toBe('GET');
    expect(m.calls[0]!.url).toBe(`${PREFIX}/books/bk_1/pdf`);
  });

  it('[15/22] GET /books/{uid}', async () => {
    expect(await capture((c) => c.books.get('bk_1'))).toEqual({
      method: 'GET',
      url: `${PREFIX}/books/bk_1`,
    });
  });

  // ── webhooks 7 ──────────────────────────────────────────────────────
  it('[16/22] PUT /webhooks/config', async () => {
    expect(await capture((c) => c.webhooks.putConfig({ url: 'https://p.example/hook' }))).toEqual({
      method: 'PUT',
      url: `${PREFIX}/webhooks/config`,
    });
  });

  it('[17/22] GET /webhooks/config', async () => {
    expect(await capture((c) => c.webhooks.getConfig())).toEqual({
      method: 'GET',
      url: `${PREFIX}/webhooks/config`,
    });
  });

  it('[18/22] DELETE /webhooks/config', async () => {
    expect(await capture((c) => c.webhooks.deleteConfig())).toEqual({
      method: 'DELETE',
      url: `${PREFIX}/webhooks/config`,
    });
  });

  it('[19/22] POST /webhooks/test', async () => {
    expect(await capture((c) => c.webhooks.sendTest())).toEqual({
      method: 'POST',
      url: `${PREFIX}/webhooks/test`,
    });
  });

  it('[20/22] GET /webhooks/deliveries', async () => {
    expect(await capture((c) => c.webhooks.listDeliveries(), ok([]))).toEqual({
      method: 'GET',
      url: `${PREFIX}/webhooks/deliveries`,
    });
  });

  it('[21/22] GET /webhooks/deliveries/{uid}', async () => {
    expect(await capture((c) => c.webhooks.getDelivery('wd_1'))).toEqual({
      method: 'GET',
      url: `${PREFIX}/webhooks/deliveries/wd_1`,
    });
  });

  it('[22/22] POST /webhooks/deliveries/{uid}/retry', async () => {
    expect(await capture((c) => c.webhooks.retryDelivery('wd_1'))).toEqual({
      method: 'POST',
      url: `${PREFIX}/webhooks/deliveries/wd_1/retry`,
    });
  });
});

describe('쿼리 직렬화', () => {
  it('book-specs 필터 — isActive boolean 을 서버가 받는 문자열로 변환', async () => {
    const m = mockFetch([{ json: ok([]) }]);
    await client(m.fetch).bookSpecs.list({
      coverType: 'softcover',
      bindingType: 'perfect',
      isActive: false,
      limit: 50,
      offset: 10,
    });
    const url = new URL(m.calls[0]!.url);
    // 서버 DTO 는 @IsIn(['true','false']) — boolean 을 그대로 보내면 400
    expect(url.searchParams.get('isActive')).toBe('false');
    expect(url.searchParams.get('coverType')).toBe('softcover');
    expect(url.searchParams.get('bindingType')).toBe('perfect');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.get('offset')).toBe('10');
  });

  it('미지정 쿼리는 아예 보내지 않는다 (undefined 문자열화 방지)', async () => {
    const m = mockFetch([{ json: ok([]) }]);
    await client(m.fetch).bookSpecs.list({ coverType: 'softcover' });
    const url = m.calls[0]!.url;
    expect(url).toContain('coverType=softcover');
    expect(url).not.toContain('undefined');
    expect(url).not.toContain('isActive');
  });

  it('books 목록 필터', async () => {
    const m = mockFetch([{ json: ok([]) }]);
    await client(m.fetch).books.list({ status: 'DRAFT', creationType: 'PDF_UPLOAD', limit: 5 });
    const url = new URL(m.calls[0]!.url);
    expect(url.searchParams.get('status')).toBe('DRAFT');
    expect(url.searchParams.get('creationType')).toBe('PDF_UPLOAD');
    expect(url.searchParams.get('limit')).toBe('5');
  });

  it('deliveries since 는 Date/문자열 모두 ISO 8601 로 직렬화', async () => {
    const m = mockFetch([{ json: ok([]) }, { json: ok([]) }]);
    const c = client(m.fetch);

    await c.webhooks.listDeliveries({ since: new Date('2026-07-01T00:00:00.000Z') });
    expect(new URL(m.calls[0]!.url).searchParams.get('since')).toBe('2026-07-01T00:00:00.000Z');

    await c.webhooks.listDeliveries({ since: '2026-07-01T00:00:00Z', status: 'EXHAUSTED' });
    expect(new URL(m.calls[1]!.url).searchParams.get('since')).toBe('2026-07-01T00:00:00Z');
    expect(new URL(m.calls[1]!.url).searchParams.get('status')).toBe('EXHAUSTED');
  });

  it('경로 파라미터를 URL 인코딩한다 (경로 이탈 방지)', async () => {
    const m = mockFetch([{ json: ok({}) }]);
    await client(m.fetch).books.get('bk_1/../../admin');
    expect(m.calls[0]!.url).toBe(`${PREFIX}/books/bk_1%2F..%2F..%2Fadmin`);
  });
});

describe('본문 직렬화', () => {
  it('POST /books 는 입력을 JSON 본문으로 보낸다', async () => {
    const m = mockFetch([{ status: 201, json: ok({}) }]);
    await client(m.fetch).books.create({
      creationType: 'PDF_UPLOAD',
      bookSpecUid: 'bs_1',
      pageCount: 100,
      title: '제목',
      partnerRef: 'ref-1',
    });
    expect(m.calls[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(m.calls[0]!.body as string)).toEqual({
      creationType: 'PDF_UPLOAD',
      bookSpecUid: 'bs_1',
      pageCount: 100,
      title: '제목',
      partnerRef: 'ref-1',
    });
  });

  it('PUT /webhooks/config 본문', async () => {
    const m = mockFetch([{ json: ok({}) }]);
    await client(m.fetch).webhooks.putConfig({
      url: 'https://p.example/hook',
      events: ['synthesis.completed'],
      rotateSecret: true,
    });
    expect(JSON.parse(m.calls[0]!.body as string)).toEqual({
      url: 'https://p.example/hook',
      events: ['synthesis.completed'],
      rotateSecret: true,
    });
  });

  it('본문 없는 POST(finalization·test·retry)는 body 를 보내지 않는다', async () => {
    const m = mockFetch([{ status: 201, json: ok({}) }]);
    await client(m.fetch).books.startFinalization('bk_1');
    expect(m.calls[0]!.body).toBeUndefined();
    // 그래도 멱등키는 붙는다(POST + 본문 없음 = 자동 부여 대상)
    expect(m.calls[0]!.headers['idempotency-key']).toBeDefined();
  });
});
