/**
 * 멱등 정책 — 특히 **멀티파트 자동부여 금지**(파일 유실 방지)의 실증.
 *
 * 서버 함정 요약(idempotency.ts 상단에 전문):
 *   request_hash = sha256(canonicalJson(req.body)) 인데 multer 는 파일을
 *   req.file 에 담으므로 멀티파트의 hash 는 파일과 무관한 상수다
 *   → 같은 키 + 다른 파일 = 조용한 재전달(성공 응답으로 파일 유실).
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { StorigeClient } from '../client/client';
import {
  canAutoAssignIdempotencyKey,
  composeMultipartIdempotencyKey,
  generateIdempotencyKey,
} from '../client/idempotency';
import { IDEMPOTENCY_KEY_MAX_LENGTH } from '../constants';
import { StorigeUsageError } from '../errors';
import { NO_DELAY_RETRY, formFileBytes, mockFetch, ok } from './helpers';

const BASE = 'https://api.example.test';
const ASSET = { assetType: 'pdf_cover', fileId: 'f1', sortOrder: 0, status: 'active', createdAt: 'T' };

function client(fetchImpl: typeof globalThis.fetch) {
  return new StorigeClient({ apiKey: 'k', baseUrl: BASE, fetch: fetchImpl, retry: NO_DELAY_RETRY });
}

function pdf(bytes: string): { data: Uint8Array; filename: string } {
  return { data: new TextEncoder().encode(bytes), filename: 'a.pdf' };
}

describe('서버 함정 재현 — 멀티파트 request_hash 는 파일과 무관한 상수', () => {
  it('canonicalBodyHash(req.body) 는 멀티파트에서 파일 내용을 반영하지 못한다', () => {
    // 서버 canonical-hash.ts 의 로직을 그대로 재현
    const canonicalJson = (v: unknown) => JSON.stringify(v ?? null) ?? 'null';
    const hash = (b: unknown) => createHash('sha256').update(canonicalJson(b)).digest('hex');

    // multer 는 파일 바이트를 req.file 에 담는다 → 자산 라우트의 req.body 는
    // (멀티파트 경로에서 fileId 가 없으므로) 사실상 빈 값이다.
    const bodyForFileA = {}; // 파일 A 업로드 시의 req.body
    const bodyForFileB = {}; // 파일 B 업로드 시의 req.body — 완전히 동일

    expect(hash(bodyForFileA)).toBe(hash(bodyForFileB));
    expect(hash({})).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    // ⇒ 같은 Idempotency-Key 로 다른 파일을 올리면 서버는 "동일 요청"으로 보고
    //    최초 응답을 재전달한다. 두 번째 파일은 저장되지 않고 호출측은 성공을 받는다.
  });
});

describe('canAutoAssignIdempotencyKey — 자동 부여 가부', () => {
  it('POST + JSON 은 자동 부여한다', () => {
    expect(canAutoAssignIdempotencyKey('POST', 'json')).toBe(true);
  });

  it('POST + 본문 없음도 자동 부여한다 (finalization·webhooks test/retry)', () => {
    expect(canAutoAssignIdempotencyKey('POST', 'none')).toBe(true);
  });

  it('🚨 POST + 멀티파트는 자동 부여하지 않는다 (파일 유실 방지)', () => {
    expect(canAutoAssignIdempotencyKey('POST', 'multipart')).toBe(false);
  });

  it('POST 가 아니면 자동 부여하지 않는다 (서버 인터셉터가 POST 만 처리)', () => {
    expect(canAutoAssignIdempotencyKey('PUT', 'json')).toBe(false);
    expect(canAutoAssignIdempotencyKey('GET', 'none')).toBe(false);
    expect(canAutoAssignIdempotencyKey('DELETE', 'none')).toBe(false);
  });
});

describe('SDK 전송 실증 — 멀티파트에는 Idempotency-Key 가 붙지 않는다', () => {
  it('🚨 직접 업로드(멀티파트)는 Idempotency-Key 헤더 미전송', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    await client(m.fetch).books.uploadPdfCover('bk_1', { file: pdf('AAAA') });

    const headers = m.calls[0]!.headers;
    // 자동 부여했다면 서로 다른 파일이 같은 키를 공유해 유실될 수 있다
    expect(headers['idempotency-key']).toBeUndefined();
    expect(m.calls[0]!.body).toBeInstanceOf(FormData);
  });

  it('fileId 참조(JSON)는 Idempotency-Key 를 자동 부여한다 — 권장 경로', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    await client(m.fetch).books.uploadPdfCover('bk_1', { fileId: 'file_123' });

    const headers = m.calls[0]!.headers;
    expect(headers['idempotency-key']).toBeDefined();
    // body 에 실값이 있으므로 서버 request_hash 가 정상 작동한다
    expect(m.calls[0]!.body).toBe(JSON.stringify({ fileId: 'file_123' }));
  });

  it('POST /books 등 JSON POST 도 자동 부여', async () => {
    const m = mockFetch([{ status: 201, json: ok({ uid: 'bk_1' }) }]);
    await client(m.fetch).books.create({ creationType: 'PDF_UPLOAD' });
    expect(m.calls[0]!.headers['idempotency-key']).toBeDefined();
  });

  it('PUT 자산 교체(멀티파트)에도 키를 붙이지 않는다', async () => {
    const m = mockFetch([{ json: ok(ASSET) }]);
    await client(m.fetch).books.replacePdfCover('bk_1', { file: pdf('AAAA') });
    expect(m.calls[0]!.headers['idempotency-key']).toBeUndefined();
  });

  it('자동 부여 키는 호출마다 달라야 한다 (재사용 시 정상 요청이 재전달됨)', async () => {
    const m = mockFetch([{ status: 201, json: ok({ uid: 'bk_1' }) }]);
    const c = client(m.fetch);
    await c.books.create({ creationType: 'PDF_UPLOAD' });
    await c.books.create({ creationType: 'PDF_UPLOAD' });

    expect(m.calls[0]!.headers['idempotency-key']).not.toBe(m.calls[1]!.headers['idempotency-key']);
  });
});

describe('명시 제공 시 멀티파트 키 합성 — 내용 주소화', () => {
  it('🚨 같은 사용자 키 + 다른 파일 → 서로 다른 합성 키 (재전달 충돌 원천 차단)', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    const c = client(m.fetch);

    await c.books.uploadPdfCover('bk_1', { file: pdf('파일-A') }, { idempotencyKey: 'my-key' });
    await c.books.uploadPdfCover('bk_1', { file: pdf('파일-B') }, { idempotencyKey: 'my-key' });

    const keyA = m.calls[0]!.headers['idempotency-key']!;
    const keyB = m.calls[1]!.headers['idempotency-key']!;

    // 이 단언이 깨지면 두 번째 파일이 조용히 유실된다
    expect(keyA).not.toBe(keyB);
    expect(keyA.startsWith('my-key:')).toBe(true);
    expect(keyB.startsWith('my-key:')).toBe(true);
  });

  it('같은 사용자 키 + 같은 파일 → 동일 합성 키 (원하는 멱등 동작)', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    const c = client(m.fetch);

    await c.books.uploadPdfCover('bk_1', { file: pdf('동일내용') }, { idempotencyKey: 'k' });
    await c.books.uploadPdfCover('bk_1', { file: pdf('동일내용') }, { idempotencyKey: 'k' });

    expect(m.calls[0]!.headers['idempotency-key']).toBe(m.calls[1]!.headers['idempotency-key']);
  });

  it('합성 키 = `${key}:${sha256(bytes)}`', async () => {
    const bytes = new TextEncoder().encode('내용');
    const expected = `k:${createHash('sha256').update(bytes).digest('hex')}`;
    expect(await composeMultipartIdempotencyKey('k', bytes)).toBe(expected);
  });

  it('Uint8Array 뷰가 버퍼 일부만 가리켜도 해당 구간만 해시한다', async () => {
    const full = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = full.subarray(2, 4); // [3,4]
    const standalone = new Uint8Array([3, 4]);

    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    const c = client(m.fetch);
    await c.books.uploadPdfCover('bk_1', { file: { data: view, filename: 'a.pdf' } }, { idempotencyKey: 'k' });
    await c.books.uploadPdfCover('bk_1', { file: { data: standalone, filename: 'a.pdf' } }, { idempotencyKey: 'k' });

    // 뷰의 buffer 를 통째로 넘겼다면 [1..6] 이 해시돼 서로 달라졌을 것
    expect(m.calls[0]!.headers['idempotency-key']).toBe(m.calls[1]!.headers['idempotency-key']);
  });

  it('긴 사용자 키로 128자를 넘으면 전체를 재해시해 상한에 맞춘다 (결정적 유지)', async () => {
    const longKey = 'x'.repeat(100); // 100 + 1 + 64 = 165 > 128
    const bytes = new TextEncoder().encode('내용');

    const composed = await composeMultipartIdempotencyKey(longKey, bytes);
    expect(composed.length).toBe(64);
    expect(composed.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
    // 결정적 — 같은 입력이면 같은 키
    expect(await composeMultipartIdempotencyKey(longKey, bytes)).toBe(composed);
    // 내용 주소성 유지 — 다른 파일이면 다른 키
    const other = await composeMultipartIdempotencyKey(longKey, new TextEncoder().encode('다른내용'));
    expect(other).not.toBe(composed);
  });

  it('빈 키는 거부한다', async () => {
    await expect(composeMultipartIdempotencyKey('', new Uint8Array([1]))).rejects.toThrow(
      StorigeUsageError,
    );
  });
});

describe('명시 키 검증 (서버 400 왕복 방지)', () => {
  it('128자 초과 키는 발신 전에 거부', async () => {
    const m = mockFetch([{ status: 201, json: ok({ uid: 'bk_1' }) }]);
    await expect(
      client(m.fetch).books.create({ creationType: 'PDF_UPLOAD' }, { idempotencyKey: 'x'.repeat(129) }),
    ).rejects.toThrow(StorigeUsageError);
    expect(m.calls).toHaveLength(0); // 네트워크에 나가지도 않았다
  });

  it('빈 키는 발신 전에 거부', async () => {
    const m = mockFetch([{ status: 201, json: ok({ uid: 'bk_1' }) }]);
    await expect(
      client(m.fetch).books.create({ creationType: 'PDF_UPLOAD' }, { idempotencyKey: '' }),
    ).rejects.toThrow(StorigeUsageError);
    expect(m.calls).toHaveLength(0);
  });

  it('JSON POST 의 명시 키는 그대로 전송한다(합성 없음)', async () => {
    const m = mockFetch([{ status: 201, json: ok({ uid: 'bk_1' }) }]);
    await client(m.fetch).books.create({ creationType: 'PDF_UPLOAD' }, { idempotencyKey: 'user-key-1' });
    expect(m.calls[0]!.headers['idempotency-key']).toBe('user-key-1');
  });

  it('generateIdempotencyKey 는 UUID 형식이고 상한 이내다', () => {
    const key = generateIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
  });
});

describe('멀티파트 전송 형태', () => {
  it('file 필드명과 파일명을 서버 계약대로 싣는다', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    await client(m.fetch).books.uploadPdfCover('bk_1', {
      file: { data: new TextEncoder().encode('PDF'), filename: 'cover.pdf' },
    });

    const body = m.calls[0]!.body as FormData;
    // 서버: FileInterceptor('file') — 필드명이 다르면 파일이 유실된다
    const file = body.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('cover.pdf');
    expect(await formFileBytes(body)).toEqual(new TextEncoder().encode('PDF'));
  });

  it('멀티파트는 Content-Type 을 세팅하지 않는다 (boundary 는 fetch 가 붙인다)', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    await client(m.fetch).books.uploadPdfCover('bk_1', { file: pdf('X') });
    expect(m.calls[0]!.headers['content-type']).toBeUndefined();
  });

  it('기본 contentType 은 application/pdf (서버 직접 업로드 필터가 PDF 전용)', async () => {
    const m = mockFetch([{ status: 201, json: ok(ASSET) }]);
    await client(m.fetch).books.uploadPdfCover('bk_1', { file: pdf('X') });
    const body = m.calls[0]!.body as FormData;
    expect((body.get('file') as Blob).type).toBe('application/pdf');
  });
});
