/**
 * Vercel Edge Middleware — /embed 계열 CSP frame-ancestors 동적 합성 (P-Stage2-3, D-7b a안).
 *
 * 동작:
 *  1. API(GET /api/frame-ancestors)에서 활성 사이트들의 frame_ancestors 목록 조회
 *     (모듈 스코프 60s 캐시 + 1.5s 타임아웃).
 *  2. 성공 시 "정적 기본값(vercel.json과 동일) + DB 추가 origin" 으로
 *     Content-Security-Policy: frame-ancestors 헤더를 override.
 *  3. 실패/타임아웃/비정상 응답 시 아무것도 하지 않음(undefined 반환) →
 *     vercel.json 의 정적 CSP 헤더가 그대로 적용된다 — 무중단 폴백 (P0).
 *
 * vercel.json 의 정적 헤더는 삭제/수정하지 않는다(폴백 경로 병존).
 * DB 값은 정적 기본값에 "추가"만 가능 — 축소 불가(frameAncestorsCsp.ts 불변식 2).
 *
 * 파일 위치·형식: Vercel Routing Middleware 규약 — 프로젝트 루트(apps/editor 가
 * Vercel 프로젝트 루트)의 middleware.ts, default export, 기본 Edge 런타임.
 * 정적(Vite) 프로젝트에서도 동작하며 캐시 이전 단계에서 실행된다.
 */
import { next } from '@vercel/functions';
import {
  buildFrameAncestorsCsp,
  fetchFrameAncestors,
  mergeFrameAncestors,
} from './src/lib/frameAncestorsCsp';

/**
 * Edge 런타임의 process.env 최소 타입 (에디터 tsconfig 는 DOM lib 만 사용 —
 * @types/node 전역 도입은 앱 전체 타입에 영향이 커서 지역 선언으로 한정).
 */
declare const process: { env: Record<string, string | undefined> };

/** DB 목록 fetch 실패 시 정적 폴백까지 걸리는 최대 지연 상한 (P0: 짧게) */
const FETCH_TIMEOUT_MS = 1500;
/** 모듈 스코프(엣지 isolate 단위) 캐시 TTL — API 서버 캐시(60s)와 동일 */
const CACHE_TTL_MS = 60_000;

/** 런타임 env 로 override 가능 (Vercel 프로젝트 env). 기본값 = 운영 API */
const FRAME_ANCESTORS_ENDPOINT =
  process.env.FRAME_ANCESTORS_API_URL ??
  'https://api.papascompany.co.kr/api/frame-ancestors';

/** isolate-로컬 캐시. 만료 후 fetch 실패 시 stale 값을 계속 사용(무중단 우선). */
let cache: { header: string; expiresAt: number } | null = null;

export default async function middleware(): Promise<Response | undefined> {
  try {
    const now = Date.now();

    if (!cache || cache.expiresAt <= now) {
      const dbAncestors = await fetchFrameAncestors(
        FRAME_ANCESTORS_ENDPOINT,
        FETCH_TIMEOUT_MS,
      );
      if (dbAncestors) {
        cache = {
          header: buildFrameAncestorsCsp(mergeFrameAncestors(dbAncestors)),
          expiresAt: now + CACHE_TTL_MS,
        };
      }
      // dbAncestors === null: cache 가 있으면 stale 재사용, 없으면 아래에서 폴백
    }

    if (!cache) {
      // 조회 실패 + 캐시 없음 → 아무것도 하지 않음 = vercel.json 정적 CSP 적용
      return undefined;
    }

    return next({
      headers: { 'Content-Security-Policy': cache.header },
    });
  } catch {
    // 어떤 예외도 임베드를 깨뜨리지 않는다 — 정적 폴백
    return undefined;
  }
}

export const config = {
  // /embed 계열만 — 그 외 경로는 미들웨어 미실행(컴퓨팅 절약 + 정적 헤더 유지)
  matcher: ['/embed', '/embed/:path*'],
};
