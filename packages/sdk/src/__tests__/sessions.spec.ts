/**
 * Sessions(런처) 고유 동작 — 본문 직렬화·멱등키·에러 코드 분기·폴링 헬퍼.
 * 라우트 method·path 는 routes.spec.ts [23~25/25] 가 담당한다.
 */

import { describe, expect, it, vi } from 'vitest';
import { StorigeClient } from '../client/client';
import { ErrorCode, StorigeApiError, StorigeUsageError } from '../errors';
import type { SessionDeliverables, SessionDeliverablesItem, SessionLaunchInput } from '../types';
import { NO_DELAY_RETRY, err, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';

function client(fetchImpl: typeof globalThis.fetch) {
  return new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
}

const LAUNCH_INPUT: SessionLaunchInput = {
  member: { seqno: 7, id: 'member-7', name: '홍길동' },
  templateSetId: 'ts_calendar',
  orderSeqno: 12345,
  mode: 'both',
  callbackUrl: 'https://partner.example/storige/callback',
  orderOptions: { quantity: 2 },
  items: [{ sku: 'A' }],
  calendar: { startYm: '2027-01' },
};

const LAUNCH_RESULT = {
  sessionId: 'sess_1',
  accessToken: 'at',
  refreshToken: 'rt',
  expiresIn: 3600,
  embed: { sessionId: 'sess_1', token: 'at', refreshToken: 'rt', orderSeqno: 12345 },
};

function deliverables(
  status: SessionDeliverables['status'],
  extra: Partial<SessionDeliverables> = {},
): SessionDeliverables {
  return {
    sessionId: 'sess_1',
    orderSeqno: 12345,
    revision: 1,
    status,
    product: null,
    calendar: null,
    files: [],
    ...extra,
  };
}

describe('POST /sessions/launch', () => {
  it('입력을 JSON 본문으로 보내고 201 봉투 data 를 그대로 돌려준다', async () => {
    const m = mockFetch([{ status: 201, json: ok(LAUNCH_RESULT) }]);
    const result = await client(m.fetch).sessions.launch(LAUNCH_INPUT);

    expect(m.calls[0]!.headers['content-type']).toBe('application/json');
    expect(JSON.parse(m.calls[0]!.body as string)).toEqual(LAUNCH_INPUT);
    expect(result).toEqual(LAUNCH_RESULT);
    // embed 는 mountEditor params 로 바로 쓸 수 있는 동결 파라미터 집합
    expect(Object.keys(result.embed).sort()).toEqual(['orderSeqno', 'refreshToken', 'sessionId', 'token']);
  });

  it('JSON POST 라 Idempotency-Key 가 자동 부여된다(재시도 중복 세션 방지)', async () => {
    const m = mockFetch([{ status: 201, json: ok(LAUNCH_RESULT) }]);
    await client(m.fetch).sessions.launch(LAUNCH_INPUT);
    expect(m.calls[0]!.headers['idempotency-key']).toBeDefined();
  });

  it('idempotencyKey 를 명시하면 그 값을 그대로 보낸다(주문 단위 고정)', async () => {
    const m = mockFetch([{ status: 201, json: ok(LAUNCH_RESULT) }]);
    await client(m.fetch).sessions.launch(LAUNCH_INPUT, { idempotencyKey: 'order-12345-launch' });
    expect(m.calls[0]!.headers['idempotency-key']).toBe('order-12345-launch');
  });

  it('503 ERR_SERVICE_UNAVAILABLE(킬스위치)은 StorigeApiError 로 던진다', async () => {
    const m = mockFetch([
      { status: 503, json: err(ErrorCode.ERR_SERVICE_UNAVAILABLE, '런처 비활성') },
    ]);
    const error = (await client(m.fetch)
      .sessions.launch(LAUNCH_INPUT, { retry: { maxRetries: 0 } })
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.status).toBe(503);
    expect(error.errorCode).toBe(ErrorCode.ERR_SERVICE_UNAVAILABLE);
  });
});

describe('GET /sessions/{id}/deliverables', () => {
  it('files[].auth 가 api-key/signed 로 섞여 와도 그대로 돌려준다', async () => {
    const view = deliverables('ready', {
      revision: 2,
      product: { kind: 'calendar', editorType: 'calendar', canvasCount: 26, sheetCount: 13, faces: 2, duplexFlip: 'short-edge', backRotation: 0 },
      calendar: { startYm: '2027-01', dataVersion: '2026-10' },
      files: [
        { role: 'single', fileId: 'f1', jobId: 'j1', url: `${BASE}/api/v1/files/f1`, auth: 'api-key', pageCount: 26, generatedAt: 'T' },
        { role: 'thumbnail', url: 'https://cdn.example/thumb?sig=x', auth: 'signed', generatedAt: 'T' },
      ],
      production: { status: 'queued', note: null, updatedAt: 'T' },
    });
    const m = mockFetch([{ json: ok(view) }]);
    const result = await client(m.fetch).sessions.deliverables('sess_1');

    expect(result).toEqual(view);
    expect(result.files.map((f) => f.auth)).toEqual(['api-key', 'signed']);
  });

  // ADDITIVE 2026-10-19 P2-d 사진인화(v1.25)
  it("사진인화 세트의 product.kind 'photo-print' 와 items(정제본)·files[].copies 를 그대로 돌려준다", async () => {
    const items: SessionDeliverablesItem[] = [
      { index: 0, canvasIndex: 0, sourcePhotoId: 'upload-1', sizeCode: '4x6', copies: 2, border: 'white', fit: 'paper-full', finish: 'glossy', brightnessFix: false, dateOverlay: true, grayscale: false, lowRes: false },
      { index: 1, canvasIndex: 2, sizeCode: '4x6', copies: 1, border: 'none', fit: 'image-full', finish: 'matte', brightnessFix: false, dateOverlay: false, grayscale: true, lowRes: true },
    ];
    const view = deliverables('ready', {
      product: { kind: 'photo-print', editorType: 'photo_digital_4x6', canvasCount: 4, sheetCount: 2, faces: 2, duplexFlip: 'short-edge', backRotation: 0 },
      items,
      files: [
        { role: 'sheet', fileId: 'f1', jobId: 'j1', url: `${BASE}/api/v1/files/f1`, auth: 'api-key', pageCount: 2, sheetIndex: 0, copies: 2, generatedAt: 'T' },
        { role: 'sheet', fileId: 'f2', jobId: 'j1', url: `${BASE}/api/v1/files/f2`, auth: 'api-key', pageCount: 2, sheetIndex: 1, copies: 1, generatedAt: 'T' },
      ],
    });
    const m = mockFetch([{ json: ok(view) }]);
    const result = await client(m.fetch).sessions.deliverables('sess_1');

    expect(result).toEqual(view);
    expect(result.items?.map((i) => i.copies)).toEqual([2, 1]);
    expect(result.files.map((f) => f.copies)).toEqual([2, 1]);
  });

  it('404 ERR_NOT_FOUND(타 사이트·타 env·없음 — 존재 은닉)', async () => {
    const m = mockFetch([{ status: 404, json: err(ErrorCode.ERR_NOT_FOUND) }]);
    const error = (await client(m.fetch)
      .sessions.deliverables('sess_other')
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.errorCode).toBe(ErrorCode.ERR_NOT_FOUND);
  });

  it('경로 파라미터를 URL 인코딩한다', async () => {
    const m = mockFetch([{ json: ok(deliverables('editing')) }]);
    await client(m.fetch).sessions.deliverables('a/../b');
    expect(m.calls[0]!.url).toBe(`${BASE}/api/v1/sessions/a%2F..%2Fb/deliverables`);
  });
});

describe('POST /sessions/{id}/synthesize', () => {
  it('본문 없이 보내고 { jobId, revision } 을 돌려준다 — 멱등키 자동 부여', async () => {
    const m = mockFetch([{ status: 201, json: ok({ jobId: 'job_9', revision: 2 }) }]);
    const result = await client(m.fetch).sessions.synthesize('sess_1');

    expect(m.calls[0]!.body).toBeUndefined();
    expect(m.calls[0]!.headers['idempotency-key']).toBeDefined();
    expect(result).toEqual({ jobId: 'job_9', revision: 2 });
  });

  it('409 ERR_SESSION_NOT_COMPLETE — 편집 완료 전', async () => {
    const m = mockFetch([{ status: 409, json: err(ErrorCode.ERR_SESSION_NOT_COMPLETE) }]);
    const error = (await client(m.fetch)
      .sessions.synthesize('sess_1')
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.status).toBe(409);
    expect(error.errorCode).toBe(ErrorCode.ERR_SESSION_NOT_COMPLETE);
    // 409 라도 멱등 IN_PROGRESS 가 아니면 재시도하지 않는다
    expect(m.calls).toHaveLength(1);
  });

  it('422 ERR_OUTPUT_MODE_UNSUPPORTED — duplex-split 세트가 아님', async () => {
    const m = mockFetch([{ status: 422, json: err(ErrorCode.ERR_OUTPUT_MODE_UNSUPPORTED) }]);
    const error = (await client(m.fetch)
      .sessions.synthesize('sess_1')
      .catch((e: unknown) => e)) as StorigeApiError;

    expect(error).toBeInstanceOf(StorigeApiError);
    expect(error.status).toBe(422);
    expect(error.errorCode).toBe(ErrorCode.ERR_OUTPUT_MODE_UNSUPPORTED);
  });
});

describe('waitForDeliverables — 폴링 헬퍼', () => {
  it("기본 until:'ready' — ready 까지 폴링한다", async () => {
    const m = mockFetch([
      { json: ok(deliverables('editing')) },
      { json: ok(deliverables('complete')) },
      { json: ok(deliverables('synthesizing')) },
      { json: ok(deliverables('ready', { revision: 1 })) },
    ]);
    const result = await client(m.fetch).sessions.waitForDeliverables('sess_1', { intervalMs: 0 });

    expect(result.status).toBe('ready');
    expect(m.calls).toHaveLength(4);
  });

  it("until:'complete' — 편집이 끝나면(complete) 바로 반환한다", async () => {
    const m = mockFetch([
      { json: ok(deliverables('editing')) },
      { json: ok(deliverables('complete')) },
      { json: ok(deliverables('ready')) },
    ]);
    const result = await client(m.fetch).sessions.waitForDeliverables('sess_1', {
      intervalMs: 0,
      until: 'complete',
    });

    expect(result.status).toBe('complete');
    expect(m.calls).toHaveLength(2);
  });

  it("until:'complete' 는 synthesizing 도 편집 종료로 본다", async () => {
    const m = mockFetch([{ json: ok(deliverables('synthesizing')) }]);
    const result = await client(m.fetch).sessions.waitForDeliverables('sess_1', {
      intervalMs: 0,
      until: 'complete',
    });
    expect(result.status).toBe('synthesizing');
    expect(m.calls).toHaveLength(1);
  });

  it('failed 는 예외가 아니라 값으로 반환한다(두 until 모두)', async () => {
    const m1 = mockFetch([{ json: ok(deliverables('failed')) }]);
    expect((await client(m1.fetch).sessions.waitForDeliverables('sess_1', { intervalMs: 0 })).status).toBe(
      'failed',
    );
    const m2 = mockFetch([{ json: ok(deliverables('failed')) }]);
    expect(
      (await client(m2.fetch).sessions.waitForDeliverables('sess_1', { intervalMs: 0, until: 'complete' }))
        .status,
    ).toBe('failed');
  });

  it('onPoll 로 상태 전이를 관찰할 수 있다', async () => {
    const m = mockFetch([
      { json: ok(deliverables('editing')) },
      { json: ok(deliverables('ready')) },
    ]);
    const seen: string[] = [];
    await client(m.fetch).sessions.waitForDeliverables('sess_1', {
      intervalMs: 0,
      onPoll: (v) => seen.push(v.status),
    });
    expect(seen).toEqual(['editing', 'ready']);
  });

  it('타임아웃 초과 시 웹훅 전환을 안내하는 StorigeUsageError', async () => {
    const m = mockFetch([{ json: ok(deliverables('editing')) }]);
    const error = (await client(m.fetch)
      .sessions.waitForDeliverables('sess_1', { intervalMs: 0, timeoutMs: 0 })
      .catch((e: unknown) => e)) as StorigeUsageError;

    expect(error).toBeInstanceOf(StorigeUsageError);
    expect(error.message).toContain('웹훅');
    expect(error.message).toContain('until=ready');
  });

  it('until 에 알 수 없는 값을 주면 요청 전에 StorigeUsageError', async () => {
    const m = mockFetch([{ json: ok(deliverables('ready')) }]);
    await expect(
      client(m.fetch).sessions.waitForDeliverables('sess_1', {
        until: 'done' as unknown as 'ready',
      }),
    ).rejects.toBeInstanceOf(StorigeUsageError);
    expect(m.calls).toHaveLength(0);
  });

  it('폴링 간격은 지수 증가하되 상한을 넘지 않는다', async () => {
    const m = mockFetch([
      { json: ok(deliverables('editing')) },
      { json: ok(deliverables('editing')) },
      { json: ok(deliverables('complete')) },
      { json: ok(deliverables('ready')) },
    ]);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await client(m.fetch).sessions.waitForDeliverables('sess_1', {
      intervalMs: 100,
      maxIntervalMs: 250,
    });

    // 요청별 타임아웃 타이머(기본 60초)는 제외하고 폴링 지연만 고른다
    const REQUEST_TIMEOUT_MS = 60_000;
    const pollDelays = timeoutSpy.mock.calls
      .map((args) => args[1])
      .filter((d) => d !== REQUEST_TIMEOUT_MS);

    expect(pollDelays).toEqual([100, 200, 250]);
    timeoutSpy.mockRestore();
  });
});
