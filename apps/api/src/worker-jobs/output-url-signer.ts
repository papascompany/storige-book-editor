/**
 * S4 2단계(2026-08-28, 오너 결정 D3·D4) — 합성 산출물 서명 URL 생성기.
 *
 * compose-mixed 등 SYNTHESIZE 산출물은 files 미등록이라 회수 경로가
 * nginx 무인증 정적 `/storage/outputs/…` 뿐이었다(접근통제 = jobId 은닉).
 * 이 유틸은 nginx `secure_link_md5` 와 짝을 이루는 서명 URL 을 만든다:
 *
 *   nginx:  secure_link $arg_md5,$arg_expires;
 *           secure_link_md5 "$secure_link_expires$uri$outputs_sign_secret";
 *   여기:   md5 = base64url( md5( `${expires}${uri}${secret}` ) )
 *
 * ⚠️ $uri 는 **서명 경로**(/storage-signed/…) 그대로다 — 기존 무인증 경로
 *    (/storage/…)는 유예(grandfathering, D4)로 당분간 병행 서빙되며 cutover(D5,
 *    bookmoa 조율) 때 별도로 닫는다. 신규 표면은 처음부터 fail-closed.
 * ⚠️ md5 는 여기서 암호학적 무결성용이 아니라 nginx secure_link 모듈의 고정
 *    포맷이다. 시크릿이 충분히 길면(32B+) 위조에는 시크릿 추측이 필요하다.
 */
import { createHash } from 'crypto';

/** 무인증 공개 경로 프리픽스 — 이 아래 산출물만 서명 대상이다. */
export const PUBLIC_OUTPUTS_PREFIX = '/storage/outputs/';
/** 서명 검증 경로 프리픽스 — nginx location 과 일치해야 한다. */
export const SIGNED_OUTPUTS_PREFIX = '/storage-signed/outputs/';

export interface SignedOutputUrl {
  /** 산출물 파일명 (cover.pdf 등) */
  name: string;
  /** 서명된 상대 URL — 그대로 GET 하면 nginx 가 검증 후 서빙 */
  url: string;
  /** 만료(unix epoch seconds) */
  expires: number;
}

/** `/storage/outputs/<jobId>/<file>` → 서명 URL. 대상 밖 경로는 null. */
export function signOutputUrl(
  publicUrl: string,
  secret: string,
  ttlSec: number,
  nowMs: number = Date.now(),
): SignedOutputUrl | null {
  if (!publicUrl.startsWith(PUBLIC_OUTPUTS_PREFIX)) return null;
  const rest = publicUrl.slice(PUBLIC_OUTPUTS_PREFIX.length);
  // 경로 순회 방어 — jobId/파일명 세그먼트에 ..·빈 세그먼트 금지.
  if (rest.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) return null;
  const uri = SIGNED_OUTPUTS_PREFIX + rest;
  const expires = Math.floor(nowMs / 1000) + ttlSec;
  const md5 = createHash('md5')
    .update(`${expires}${uri}${secret}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const name = rest.split('/').pop() ?? rest;
  return { name, url: `${uri}?md5=${md5}&expires=${expires}`, expires };
}
