/**
 * 상수 정합 — SDK 미러 vs 서버 정본 실측값.
 *
 * SDK 상수는 서버 코드를 **수작업으로 미러**한 값이라 자동 동기화가 없다.
 * 이 테스트는 값을 못 박아 두어, 서버가 바뀌었는데 SDK 를 안 고친 상황이
 * 리뷰에서 드러나게 한다(정본 위치는 constants.ts 각 주석 참조).
 */

import { describe, expect, it } from 'vitest';
import {
  DIRECT_UPLOAD_ALLOWED_MIME,
  DIRECT_UPLOAD_MAX_BYTES,
  EDITOR_PRESIGNED_THRESHOLD_BYTES,
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_REPLAYED_HEADER,
  IDEMPOTENCY_TTL_MS,
  MAX_RETRY_AFTER_MS,
  PAGINATION_DEFAULT_LIMIT,
  PAGINATION_MAX_LIMIT,
  PRESIGNED_MAX_BYTES,
  RATE_LIMIT_GENERAL_PER_MIN,
  RATE_LIMIT_HEAVY_PER_MIN,
  RETRY_AFTER_FALLBACK_SECONDS,
  SDK_VERSION,
  V1_PATH_PREFIX,
} from '../index';

describe('S-2 업로드 상한 3종', () => {
  it('직접 업로드 100MB — books.constants.ts:19 BOOK_ASSET_DIRECT_UPLOAD_MAX_BYTES', () => {
    expect(DIRECT_UPLOAD_MAX_BYTES).toBe(100 * 1024 * 1024);
    expect(DIRECT_UPLOAD_MAX_BYTES).toBe(104_857_600);
  });

  it('presigned 2GB — presigned-upload.service.ts:37 MAX_EXPECTED_SIZE', () => {
    expect(PRESIGNED_MAX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    expect(PRESIGNED_MAX_BYTES).toBe(2_147_483_648);
  });

  it('편집기 presigned 임계 50MB(참조용) — apps/editor/src/api/storage.ts:8', () => {
    expect(EDITOR_PRESIGNED_THRESHOLD_BYTES).toBe(50 * 1024 * 1024);
  });

  it('세 상한의 대소 관계 — 편집기 임계 < 직접 업로드 < presigned', () => {
    expect(EDITOR_PRESIGNED_THRESHOLD_BYTES).toBeLessThan(DIRECT_UPLOAD_MAX_BYTES);
    expect(DIRECT_UPLOAD_MAX_BYTES).toBeLessThan(PRESIGNED_MAX_BYTES);
  });

  it('직접 업로드 MIME 은 PDF 단독 — photo 도 예외 아님(이미지는 fileId 경로)', () => {
    expect(DIRECT_UPLOAD_ALLOWED_MIME).toEqual(['application/pdf']);
  });
});

describe('레이트리밋(§5.2)', () => {
  it('general 300/min — partner-api.config.ts 기본값', () => {
    expect(RATE_LIMIT_GENERAL_PER_MIN).toBe(300);
  });

  it('heavy 100/min — 업로드/최종화/PDF 다운로드', () => {
    expect(RATE_LIMIT_HEAVY_PER_MIN).toBe(100);
  });

  it('Retry-After 폴백 60초 — partner-api.constants.ts RETRY_AFTER_FALLBACK_SECONDS', () => {
    expect(RETRY_AFTER_FALLBACK_SECONDS).toBe(60);
  });

  it('Retry-After 자동 준수 상한은 서버 리밋 윈도우(60초)와 같다', () => {
    expect(MAX_RETRY_AFTER_MS).toBe(RETRY_AFTER_FALLBACK_SECONDS * 1000);
  });
});

describe('멱등(§4.1)', () => {
  it('TTL 24h — PARTNER_API_IDEMPOTENCY_TTL_HOURS 기본값', () => {
    expect(IDEMPOTENCY_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(IDEMPOTENCY_TTL_MS).toBe(86_400_000);
  });

  it('키 길이 상한 128 — partner-idempotency.interceptor.ts', () => {
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(128);
  });

  it('헤더명 — 서버 IDEMPOTENCY_KEY_HEADER / IDEMPOTENCY_REPLAYED_HEADER', () => {
    expect(IDEMPOTENCY_KEY_HEADER.toLowerCase()).toBe('idempotency-key');
    expect(IDEMPOTENCY_REPLAYED_HEADER).toBe('Idempotency-Replayed');
  });
});

describe('페이지네이션(§5.1)', () => {
  it('기본 20 / 최대 100 — partner-api/http/pagination.ts', () => {
    expect(PAGINATION_DEFAULT_LIMIT).toBe(20);
    expect(PAGINATION_MAX_LIMIT).toBe(100);
  });
});

describe('경로·버전', () => {
  it('v1 접두 — 글로벌 prefix api + @PartnerV1Controller v1', () => {
    expect(V1_PATH_PREFIX).toBe('/api/v1');
  });

  it('SDK_VERSION 은 package.json version 과 일치한다', async () => {
    const pkg = (await import('../../package.json')) as unknown as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
