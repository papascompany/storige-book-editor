/**
 * 호스트 세션 — **파트너 자신의 로그인 자리**를 차지하는 최소 구현.
 *
 * ============================================================================
 * 왜 예제에 로그인이 들어가 있나
 * ============================================================================
 * 편집기에 넘기는 `token`(회원 JWT)은 **세션 자격증명**이다. 그것을 내려주는
 * 엔드포인트가 무인증이면, 그 URL 을 아는 누구나 남의 편집 세션을 열 수 있는
 * "토큰 자판기"가 된다. 정적 데모 토큰일 때는 피해가 없어 보이지만, 파트너는 이
 * 구조를 그대로 복사한 뒤 **정적 토큰만 로그인 사용자 토큰으로 갈아끼운다** —
 * 그 순간 무인증 자판기가 된다.
 *
 * 그래서 이 예제는 토큰을 내려주는 `GET /api/config` 앞에 세션 게이트를 세운다.
 * 파트너가 갈아끼워야 할 것은 **토큰이 아니라 이 파일**이다.
 *
 * ## 이것은 인증이 아니다 (fail-closed 로 설계한 이유)
 * 여기서 "신원"의 근거는 **서버 콘솔에 찍힌 1회용 nonce 를 읽을 수 있었다**는 사실뿐이다.
 * 즉 이 데모에 로그인할 수 있는 사람 = 서버를 직접 띄운 사람. 공개 가입 경로가 없다.
 *
 * 무인증 `POST /api/demo-login` 을 열어 두면 "누구나 세션을 만들 수 있다"가 되어
 * 게이트가 장식이 된다 — 그래서 그렇게 하지 않았다. **생략은 fail-closed 여야 한다.**
 *
 * ## 파트너가 할 일
 * `resolve()` 를 자기 세션 미들웨어(쿠키/JWT/서드파티 IdP)로 **통째로 교체**하고,
 * `HostUser` 를 자기 회원 식별자로 바꾼 뒤, `src/server.ts` 의
 * `resolveEditorTokenFor(user)` 가 **그 회원의** 편집기 토큰을 반환하게 하라.
 */

import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/** 파트너 회원 — 실제로는 자기 회원 테이블의 row 다 */
export interface HostUser {
  id: string;
  label: string;
}

export interface HostSessions {
  /** 부팅 시 1회 생성되는 로그인 nonce — 서버 콘솔에만 찍힌다 */
  readonly bootNonce: string;
  readonly cookieName: string;
  /** nonce 대조 성공 시 세션 id 발급 (실패 = null) */
  login(nonce: unknown): string | null;
  /** Cookie 헤더에서 세션을 복원 (없으면 null) */
  resolve(cookieHeader: string | undefined): HostUser | null;
}

/** 길이가 달라도 조기 반환하지 않는 상수시간 문자열 비교 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // 길이 노출을 줄이려 자기 자신과 비교해 동일한 작업량을 태운 뒤 false
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Cookie 헤더 파싱 — `a=1; b=2` 한 줄짜리라 의존성을 늘리지 않는다.
 * (cookie-parser 를 넣으면 파트너가 "이것도 필수인가" 오해한다)
 */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

const COOKIE_NAME = 'demo_host_sid';

export function createHostSessions(): HostSessions {
  const bootNonce = randomBytes(24).toString('base64url');
  // ⚠️ 데모용 인메모리 — 프로세스 재시작·다중 인스턴스에서 무력하다.
  //    운영은 자기 세션 저장소(Redis/DB)를 쓴다.
  const sessions = new Map<string, HostUser>();

  return {
    bootNonce,
    cookieName: COOKIE_NAME,

    login(nonce: unknown): string | null {
      if (typeof nonce !== 'string' || nonce === '') return null;
      if (!safeEqual(nonce, bootNonce)) return null;
      const sid = randomUUID();
      sessions.set(sid, { id: 'demo-user-1', label: '데모 회원' });
      return sid;
    },

    resolve(cookieHeader: string | undefined): HostUser | null {
      const sid = readCookie(cookieHeader, COOKIE_NAME);
      if (sid === undefined) return null;
      return sessions.get(sid) ?? null;
    },
  };
}
