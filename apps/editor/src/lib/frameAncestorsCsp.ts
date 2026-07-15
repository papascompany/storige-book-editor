/**
 * frame-ancestors CSP 동적 합성 — 순수 로직 (P-Stage2-3, D-7b a안).
 *
 * 소비자: apps/editor/middleware.ts (Vercel Edge Middleware).
 * /embed 계열 응답의 `Content-Security-Policy: frame-ancestors ...` 헤더를
 * "정적 기본값(vercel.json과 동일) + API(DB site.frame_ancestors) 추가 origin"
 * 으로 합성한다.
 *
 * 불변식 (임베드 파트너 무중단 — P0):
 *  1. STATIC_FRAME_ANCESTORS 는 apps/editor/vercel.json 의 정적 CSP 값과
 *     항상 동일해야 한다 — frameAncestorsCsp.test.ts 의 parity 테스트가 고정.
 *  2. 동적 합성 결과는 정적 기본값의 상위집합(superset)만 가능 — DB 값은
 *     "추가"만 하며 축소는 불가능하다.
 *  3. API 실패/타임아웃/비정상 응답 시 null 을 반환 → 미들웨어는 아무것도
 *     하지 않고 vercel.json 정적 헤더가 그대로 적용된다(무중단 폴백).
 *
 * 브라우저 번들 비포함: 이 모듈은 middleware.ts(엣지)와 테스트에서만 import
 * 된다. src/ 앱 코드에서 import 하지 말 것(불필요한 번들 증가).
 */

/**
 * 정적 기본값 — apps/editor/vercel.json 의 frame-ancestors 값(따옴표 'self' 제외)과
 * 1:1 동일. vercel.json 을 수정하면 이 목록과 parity 테스트를 함께 갱신하라.
 */
export const STATIC_FRAME_ANCESTORS: readonly string[] = [
  'https://*.papascompany.co.kr',
  'https://*.bookmoa.co.kr',
  'https://www.bookmoa.co.kr',
  'https://bookmoa.com',
  'https://*.bookmoa.com',
  'https://bookmoa.net',
  'https://*.bookmoa.net',
  'https://mybookmake.com',
  'https://*.mybookmake.com',
  'https://*.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:3000',
];

/**
 * CSP host-source 로 안전한 origin 인지 검증 (헤더 인젝션 방어).
 *
 * DB(site.frame_ancestors) 값이 그대로 응답 헤더에 들어가므로, 세미콜론·공백·
 * 제어문자 등으로 다른 CSP 지시어를 주입하지 못하도록 엄격한 화이트리스트
 * 패턴만 통과시킨다. 허용: http(s) 스킴 + (와일드카드 서브도메인) 호스트 + 포트.
 * 전면 와일드카드('*')·스킴 없는 값·경로 포함 값은 의도적으로 거부한다.
 *
 * [보안 P2-2] 추가 거부 2종:
 *  - 퍼블릭 서픽스 단독 와일드카드(`https://*.com` 등 — `*.` 뒤 라벨 1개):
 *    사실상 인터넷 전체 임베드 허용이므로 거부. 와일드카드는 최소
 *    `*.example.com`(라벨 2개 이상)부터 허용한다.
 *  - 범위 밖 포트(`:99999`, `:0` 등): 유효 포트는 1~65535 만.
 */
const HOST_SOURCE_PATTERN =
  /^https?:\/\/(\*\.)?([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?)(:(\d{1,5}))?$/;

export function isValidAncestorSource(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 300) return false;
  const match = HOST_SOURCE_PATTERN.exec(value);
  if (!match) return false;
  const [, wildcard, host, , , port] = match;
  // 와일드카드는 등록 도메인 이하(`*.example.com`)만 — `*.com`/`*.kr` 같은
  // TLD 단독 와일드카드(호스트 라벨 1개)는 거부.
  if (wildcard && !host.includes('.')) return false;
  if (port !== undefined) {
    const portNum = Number(port);
    if (portNum < 1 || portNum > 65535) return false;
  }
  return true;
}

/**
 * API 응답(JSON)에서 frame-ancestors origin 배열을 추출한다.
 * 기대 shape: { success: true, data: { frameAncestors: string[] } }
 * shape 이 다르면 null(폴백), 배열 내 유효하지 않은 항목은 조용히 제거.
 */
export function parseFrameAncestorsResponse(json: unknown): string[] | null {
  if (typeof json !== 'object' || json === null) return null;
  const root = json as { success?: unknown; data?: unknown };
  if (root.success !== true) return null;
  if (typeof root.data !== 'object' || root.data === null) return null;
  const data = root.data as { frameAncestors?: unknown };
  if (!Array.isArray(data.frameAncestors)) return null;
  return data.frameAncestors.filter(isValidAncestorSource);
}

/**
 * 정적 기본값 + DB 추가 origin 병합 (중복 제거, 정적 우선 순서 보존).
 * 결과는 항상 STATIC_FRAME_ANCESTORS 의 상위집합 — 축소 불가(불변식 2).
 */
export function mergeFrameAncestors(dbAncestors: readonly string[]): string[] {
  const merged: string[] = [...STATIC_FRAME_ANCESTORS];
  const seen = new Set<string>(STATIC_FRAME_ANCESTORS);
  for (const origin of dbAncestors) {
    if (!isValidAncestorSource(origin) || seen.has(origin)) continue;
    seen.add(origin);
    merged.push(origin);
  }
  return merged;
}

/** 병합된 origin 목록으로 CSP 헤더 값을 조립한다. */
export function buildFrameAncestorsCsp(ancestors: readonly string[]): string {
  return `frame-ancestors 'self' ${ancestors.join(' ')}`;
}

/**
 * API 에서 DB 추가 origin 목록을 가져온다 (짧은 타임아웃).
 * 실패/타임아웃/비-2xx/shape 불일치 등 어떤 이유든 null → 호출측 무중단 폴백.
 */
export async function fetchFrameAncestors(
  endpoint: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<string[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, { signal: controller.signal });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return parseFrameAncestorsResponse(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
