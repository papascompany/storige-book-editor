/**
 * frame-ancestors CSP 동적 합성 순수 로직 spec (P-Stage2-3).
 *
 * 핵심 회귀 3방향:
 *  (a) 정적 parity — STATIC_FRAME_ANCESTORS ≠ vercel.json 정적 CSP 이면 red
 *      (동적 헤더가 정적 폴백보다 좁아지는 파트너 무중단 위반을 원천 차단)
 *  (b) 헤더 인젝션 — DB 값 검증 우회 시 red
 *  (c) 실패 폴백 — fetch 실패/타임아웃/비정상 shape 에서 null 아닌 값이 나오면 red
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  STATIC_FRAME_ANCESTORS,
  isValidAncestorSource,
  parseFrameAncestorsResponse,
  mergeFrameAncestors,
  buildFrameAncestorsCsp,
  fetchFrameAncestors,
} from './frameAncestorsCsp';

// ── (a) vercel.json 정적 헤더와의 parity ──────────────────────────

/** vercel.json 의 CSP 헤더 값에서 origin 토큰만 추출 (frame-ancestors, 'self' 제거) */
function extractOrigins(cspValue: string): string[] {
  return cspValue
    .split(/\s+/)
    .filter((t) => t !== 'frame-ancestors' && t !== "'self'" && t.length > 0);
}

describe('STATIC_FRAME_ANCESTORS ↔ vercel.json parity (파트너 무중단 불변식 1)', () => {
  // vitest root = apps/editor (happy-dom 에서 import.meta.url 은 http 스킴이라 cwd 사용)
  const vercelJsonPath = resolve(process.cwd(), 'vercel.json');
  const vercelJson = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const cspValues = vercelJson.headers
    .flatMap((h) => h.headers)
    .filter((h) => h.key === 'Content-Security-Policy')
    .map((h) => h.value);

  it('vercel.json 에 정적 CSP 헤더 2곳이 존재한다 (폴백 병존 전제)', () => {
    expect(cspValues).toHaveLength(2);
  });

  it.each(cspValues.map((v, i) => [i, v] as const))(
    'vercel.json CSP #%d 의 origin 집합 == STATIC_FRAME_ANCESTORS (순서 포함)',
    (_i, value) => {
      expect(extractOrigins(value)).toEqual([...STATIC_FRAME_ANCESTORS]);
    },
  );

  it("vercel.json CSP 는 'self' 로 시작하는 frame-ancestors 지시어다", () => {
    for (const value of cspValues) {
      expect(value.startsWith("frame-ancestors 'self' ")).toBe(true);
    }
  });
});

// ── (b) DB 값 검증 (헤더 인젝션 방어) ─────────────────────────────

describe('isValidAncestorSource', () => {
  it.each([
    'https://partner.example.com',
    'https://*.partner.example.com',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'https://shop.example.com:8443',
  ])('허용: %s', (v) => {
    expect(isValidAncestorSource(v)).toBe(true);
  });

  it.each([
    '*', // 전면 와일드카드 — 의도적 거부
    'example.com', // 스킴 없음
    'javascript://evil', // 비허용 스킴
    'https://a.com/path', // 경로 포함
    "https://a.com; script-src 'unsafe-inline'", // CSP 지시어 인젝션
    'https://a.com https://b.com', // 공백 인젝션
    'https://a.com\nSet-Cookie: x=1', // 제어문자
    '', // 빈 문자열
    'https://', // 호스트 없음
  ])('거부: %j', (v) => {
    expect(isValidAncestorSource(v)).toBe(false);
  });

  it('비문자열 거부', () => {
    expect(isValidAncestorSource(null)).toBe(false);
    expect(isValidAncestorSource(42)).toBe(false);
    expect(isValidAncestorSource({ toString: () => 'https://a.com' })).toBe(false);
  });
});

describe('parseFrameAncestorsResponse', () => {
  it('정상 shape → 유효 항목만 반환', () => {
    expect(
      parseFrameAncestorsResponse({
        success: true,
        data: {
          frameAncestors: [
            'https://new-partner.example.com',
            'https://evil.com; frame-src *', // 인젝션 시도 → 제거
            123,
          ],
        },
      }),
    ).toEqual(['https://new-partner.example.com']);
  });

  it.each([
    [null],
    ['string'],
    [{ success: false, data: { frameAncestors: [] } }],
    [{ success: true }],
    [{ success: true, data: { frameAncestors: 'not-array' } }],
    [{ data: { frameAncestors: [] } }],
  ])('비정상 shape → null (폴백): %j', (json) => {
    expect(parseFrameAncestorsResponse(json)).toBeNull();
  });

  it('빈 배열은 유효 (DB 추가 origin 0건)', () => {
    expect(
      parseFrameAncestorsResponse({ success: true, data: { frameAncestors: [] } }),
    ).toEqual([]);
  });
});

// ── 병합·조립 (불변식 2: superset-only) ───────────────────────────

describe('mergeFrameAncestors', () => {
  it('정적 기본값이 항상 앞에 전량 포함된다 (축소 불가)', () => {
    const merged = mergeFrameAncestors(['https://extra.example.com']);
    expect(merged.slice(0, STATIC_FRAME_ANCESTORS.length)).toEqual([
      ...STATIC_FRAME_ANCESTORS,
    ]);
    expect(merged).toContain('https://extra.example.com');
  });

  it('정적 기본값과 중복되는 DB 값은 제거', () => {
    const merged = mergeFrameAncestors(['https://*.bookmoa.co.kr']);
    expect(merged).toEqual([...STATIC_FRAME_ANCESTORS]);
  });

  it('DB 값 간 중복 제거 + 무효 값 제거', () => {
    const merged = mergeFrameAncestors([
      'https://x.example.com',
      'https://x.example.com',
      'https://evil.com; default-src *',
    ]);
    expect(merged).toEqual([...STATIC_FRAME_ANCESTORS, 'https://x.example.com']);
  });

  it('빈 DB 목록 → 정적 기본값 그대로', () => {
    expect(mergeFrameAncestors([])).toEqual([...STATIC_FRAME_ANCESTORS]);
  });
});

describe('buildFrameAncestorsCsp', () => {
  it("frame-ancestors 'self' + 목록 조립", () => {
    expect(buildFrameAncestorsCsp(['https://a.com', 'https://b.com'])).toBe(
      "frame-ancestors 'self' https://a.com https://b.com",
    );
  });

  it('정적 기본값만으로 조립하면 vercel.json 정적 값과 동일하다', () => {
    const vercelJson = JSON.parse(
      readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'),
    ) as {
      headers: Array<{ headers: Array<{ key: string; value: string }> }>;
    };
    const staticValue = vercelJson.headers
      .flatMap((h) => h.headers)
      .find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(buildFrameAncestorsCsp(STATIC_FRAME_ANCESTORS)).toBe(staticValue);
  });
});

// ── (c) fetch 실패 폴백 ───────────────────────────────────────────

describe('fetchFrameAncestors — 실패 시 null (무중단 폴백)', () => {
  const okJson = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  it('정상 응답 → 목록 반환 + signal 전달', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okJson({ success: true, data: { frameAncestors: ['https://p.example.com'] } }),
    );
    await expect(
      fetchFrameAncestors('https://api.test/frame-ancestors', 1000, fetchImpl),
    ).resolves.toEqual(['https://p.example.com']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/frame-ancestors',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('비-2xx → null', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('oops', { status: 502 }));
    await expect(fetchFrameAncestors('https://api.test', 1000, fetchImpl)).resolves.toBeNull();
  });

  it('네트워크 예외 → null', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(fetchFrameAncestors('https://api.test', 1000, fetchImpl)).resolves.toBeNull();
  });

  it('JSON 파싱 실패 → null', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('<html>gateway error</html>', { status: 200 }));
    await expect(fetchFrameAncestors('https://api.test', 1000, fetchImpl)).resolves.toBeNull();
  });

  it('비정상 shape → null', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okJson({ success: false }));
    await expect(fetchFrameAncestors('https://api.test', 1000, fetchImpl)).resolves.toBeNull();
  });

  it('타임아웃(abort) → null', async () => {
    // signal abort 시 거부되는, 그 외엔 영원히 pending 인 fetch 시뮬레이션
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: { signal?: AbortSignal | null }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        }),
    );
    await expect(
      fetchFrameAncestors('https://api.test', 10, fetchImpl as unknown as typeof fetch),
    ).resolves.toBeNull();
  });
});
