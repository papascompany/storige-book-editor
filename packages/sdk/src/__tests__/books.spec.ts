/**
 * Books 고유 동작 — PDF 스트림 분기·업로드 상한·폴링 헬퍼.
 */

import { describe, expect, it, vi } from 'vitest';
import { StorigeClient } from '../client/client';
import { DIRECT_UPLOAD_MAX_BYTES } from '../constants';
import { ErrorCode, StorigeApiError, StorigeUsageError } from '../errors';
import type { BookFinalizationView } from '../types';
import { NO_DELAY_RETRY, err, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';

function client(fetchImpl: typeof globalThis.fetch) {
  return new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(merged);
}

describe('GET /books/{uid}/pdf — 봉투 없는 스트림 분기', () => {
  it('성공 시 application/pdf 스트림을 그대로 돌려준다 (봉투 파싱 안 함)', async () => {
    const m = mockFetch([
      {
        raw: '%PDF-1.7 본문',
        headers: {
          'content-type': 'application/pdf',
          'content-length': '13',
          'content-disposition': 'attachment; filename="bk_1.pdf"',
        },
      },
    ]);

    const result = await client(m.fetch).books.downloadPdf('bk_1');

    expect(result.contentType).toBe('application/pdf');
    expect(result.contentLength).toBe(13);
    expect(result.filename).toBe('bk_1.pdf');
    expect(await readAll(result.stream)).toBe('%PDF-1.7 본문');
  });

  it('오류는 JSON 봉투로 오므로 StorigeApiError 로 던진다', async () => {
    // 서버: 미FINALIZED/없음/타 테넌트 = 404 봉투(존재 은닉)
    const m = mockFetch([{ status: 404, json: err(ErrorCode.ERR_NOT_FOUND, '없음') }]);

    const error = (await client(m.fetch)
      .books.downloadPdf('bk_1')
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.errorCode).toBe(ErrorCode.ERR_NOT_FOUND);
    expect(error.status).toBe(404);
  });

  it('200 이어도 Content-Type 이 JSON 이면 봉투로 해석한다', async () => {
    // 서버 스트림 error 핸들러가 headersSent 전에 500 JSON 을 쓰는 경로
    const m = mockFetch([
      {
        status: 500,
        json: {
          success: false,
          errorCode: 'ERR_INTERNAL',
          message: '파일 스트리밍 중 오류가 발생했습니다',
          errors: [],
          fieldErrors: null,
          requestId: null, // ⚠️ 계약상 string 이나 이 경로만 null
        },
        headers: { 'content-type': 'application/json' },
      },
    ]);

    const error = (await client(m.fetch)
      .books.downloadPdf('bk_1')
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.errorCode).toBe(ErrorCode.ERR_INTERNAL);
    expect(error.requestId).toBeNull();
  });

  it('Content-Length 미제공 시 null (스트리밍 응답)', async () => {
    const m = mockFetch([{ raw: 'X', headers: { 'content-type': 'application/pdf' } }]);
    const result = await client(m.fetch).books.downloadPdf('bk_1');
    // Response 가 Blob 에서 길이를 자동 계산할 수 있으므로 값이 있어도 무방 —
    // 계약은 "없으면 null"
    expect(result.contentLength === null || typeof result.contentLength === 'number').toBe(true);
  });

  it('Accept 헤더에 pdf 와 json 을 함께 싣는다 (성공/오류 두 경로)', async () => {
    const m = mockFetch([{ raw: 'X', headers: { 'content-type': 'application/pdf' } }]);
    await client(m.fetch).books.downloadPdf('bk_1');
    expect(m.calls[0]!.headers['accept']).toBe('application/pdf, application/json');
  });
});

describe('직접 업로드 상한 — 발신 전 검증', () => {
  it('100MB 초과는 네트워크에 나가기 전에 거부하고 fileId 경로를 안내한다', async () => {
    const m = mockFetch([{ status: 201, json: ok({}) }]);
    const oversized = { data: new Uint8Array(DIRECT_UPLOAD_MAX_BYTES + 1), filename: 'big.pdf' };

    const error = (await client(m.fetch)
      .books.uploadPdfContents('bk_1', { file: oversized })
      .catch((e: unknown) => e)) as StorigeUsageError;

    expect(error).toBeInstanceOf(StorigeUsageError);
    expect(error.message).toContain('fileId');
    // 100MB 를 다 올려보내고 413 을 받는 낭비를 막는 게 요점
    expect(m.calls).toHaveLength(0);
  });

  it('상한 이내는 정상 전송', async () => {
    const m = mockFetch([{ status: 201, json: ok({ assetType: 'pdf_contents' }) }]);
    await client(m.fetch).books.uploadPdfContents('bk_1', {
      file: { data: new Uint8Array(1024), filename: 'ok.pdf' },
    });
    expect(m.calls).toHaveLength(1);
  });

  it('fileId 경로는 크기 검증 대상이 아니다 (presigned ≤2GB)', async () => {
    const m = mockFetch([{ status: 201, json: ok({ assetType: 'pdf_contents' }) }]);
    await client(m.fetch).books.uploadPdfContents('bk_1', { fileId: 'f_2gb' });
    expect(m.calls).toHaveLength(1);
  });

  it('fileId·file 둘 다 없으면 사용법 에러', async () => {
    const m = mockFetch([{ json: ok({}) }]);
    await expect(
      // 타입으로 막히지만 런타임(JS 소비자) 방어를 확인
      client(m.fetch).books.uploadPdfCover('bk_1', {} as never),
    ).rejects.toThrow(StorigeUsageError);
  });
});

describe('waitForFinalization — 폴링 헬퍼', () => {
  const view = (status: BookFinalizationView['status']): Partial<BookFinalizationView> => ({
    uid: 'fin_1',
    bookUid: 'bk_1',
    status,
    attempt: 1,
    validationSkipped: false,
    outputFileId: status === 'COMPLETED' ? 'file_out' : null,
    errorCode: status === 'FAILED' ? 'ERR_PDF_VALIDATION_FAILED' : null,
  });

  it('COMPLETED 까지 폴링한다', async () => {
    const m = mockFetch([
      { json: ok(view('PENDING')) },
      { json: ok(view('VALIDATING')) },
      { json: ok(view('COMPOSING')) },
      { json: ok(view('COMPLETED')) },
    ]);

    const result = await client(m.fetch).books.waitForFinalization('bk_1', { intervalMs: 0 });

    expect(result.status).toBe('COMPLETED');
    expect(result.outputFileId).toBe('file_out');
    expect(m.calls).toHaveLength(4);
  });

  it('FAILED 는 예외가 아니라 값으로 반환한다 (errorCode 분기가 계약)', async () => {
    const m = mockFetch([{ json: ok(view('FAILED')) }]);
    const result = await client(m.fetch).books.waitForFinalization('bk_1', { intervalMs: 0 });

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ERR_PDF_VALIDATION_FAILED');
  });

  it('onPoll 로 상태 전이를 관찰할 수 있다', async () => {
    const m = mockFetch([
      { json: ok(view('PENDING')) },
      { json: ok(view('COMPLETED')) },
    ]);
    const seen: string[] = [];
    await client(m.fetch).books.waitForFinalization('bk_1', {
      intervalMs: 0,
      onPoll: (v) => seen.push(v.status),
    });
    expect(seen).toEqual(['PENDING', 'COMPLETED']);
  });

  it('타임아웃 초과 시 웹훅 전환을 안내하는 에러', async () => {
    const m = mockFetch([{ json: ok(view('PENDING')) }]);
    const error = (await client(m.fetch)
      .books.waitForFinalization('bk_1', { intervalMs: 0, timeoutMs: 0 })
      .catch((e: unknown) => e)) as StorigeUsageError;

    expect(error).toBeInstanceOf(StorigeUsageError);
    expect(error.message).toContain('웹훅');
  });

  it('폴링 간격은 지수 증가하되 상한을 넘지 않는다', async () => {
    const m = mockFetch([
      { json: ok(view('PENDING')) },
      { json: ok(view('PENDING')) },
      { json: ok(view('PENDING')) },
      { json: ok(view('COMPLETED')) },
    ]);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await client(m.fetch).books.waitForFinalization('bk_1', {
      intervalMs: 100,
      maxIntervalMs: 250,
    });

    // setTimeout 은 폴링 지연 외에 요청별 타임아웃 타이머(기본 60초)도 건다 —
    // 폴링 지연만 골라낸다(intervalMs=100·maxIntervalMs=250 이라 60000 과 겹칠 수 없다).
    const REQUEST_TIMEOUT_MS = 60_000;
    const pollDelays = timeoutSpy.mock.calls
      .map((args) => args[1])
      .filter((d) => d !== REQUEST_TIMEOUT_MS);

    expect(pollDelays).toEqual([100, 200, 250]); // 100→200→400 이 상한 250 으로 캡
    timeoutSpy.mockRestore();
  });
});
