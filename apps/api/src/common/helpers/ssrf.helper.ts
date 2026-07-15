/**
 * SSRF 방어 공용 유틸 (WH-002 계열 로직의 단일 출처).
 *
 * 원래 worker-jobs.service.ts 에 private 로 있던 사설/링크로컬/루프백 IP 판정과
 * 원격 URL DNS 해석 검사를, 웹훅 발신 시점 가드(SEC/SSRF, 2026-07-16)가 동일 로직을
 * 재사용할 수 있도록 추출했다. worker-jobs 는 이 유틸에 위임하고(계약 불변),
 * webhook.service 는 콜백 발신 직전에 `isRemoteUrlPublic` 로 실 IP 해석 후 사설대역을
 * 관통하는 DNS 이름/IPv4-mapped IPv6/정수 IP 표기를 차단한다.
 *
 * DNS 리바인딩 완화: 발신 직전에 해석하므로 write-time(호스트 문자열) 검사만으로는
 * 뚫리는 "공개 DNS 이름 → 내부 IP A레코드" 벡터를 실 IP 기준으로 막는다.
 */
import { lookup } from 'dns/promises';
import * as net from 'net';

/**
 * 사설/링크로컬/루프백/메타데이터 IP 판정.
 * IPv4 대역 + IPv6 loopback/ULA/link-local + IPv4-mapped(점표기·16진표기) 포함.
 * 형식 불명은 안전측 차단(true).
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === '::1' || l === '::') return true;
    if (l.startsWith('fc') || l.startsWith('fd') || /^fe[89ab]/.test(l)) {
      return true;
    }
    // IPv4-mapped 점표기(::ffff:169.254.169.254)
    const m = l.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (m) return isPrivateIp(m[1]);
    // IPv4-mapped 16진표기(::ffff:a9fe:a9fe) — WHATWG URL 이 [::ffff:169.254.169.254]
    // 를 이 형태로 정규화하므로 반드시 처리(누락 시 메타데이터/루프백 SSRF 우회).
    const mh = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mh) {
      const hi = parseInt(mh[1], 16);
      const lo = parseInt(mh[2], 16);
      return isPrivateIp(
        `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`,
      );
    }
    return false;
  }
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const v = ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const blocks: [number, number][] = [
    [0x7f000000, 0xff000000], // 127/8
    [0x0a000000, 0xff000000], // 10/8
    [0xac100000, 0xfff00000], // 172.16/12
    [0xc0a80000, 0xffff0000], // 192.168/16
    [0xa9fe0000, 0xffff0000], // 169.254/16 (링크로컬 + 클라우드 메타데이터)
    [0x64400000, 0xffc00000], // 100.64/10 (CGN)
    [0x00000000, 0xff000000], // 0/8
  ];
  return blocks.some(([b, m]) => ((v & m) >>> 0) === (b >>> 0));
}

/**
 * URL 호스트가 리터럴 IP 라면 그 IP 를, DNS 이름이면 해석한 모든 IP 를 검사해
 * 하나라도 사설/링크로컬/루프백이면 false. http/https 아니면 false.
 *
 * @param raw 검사할 URL 문자열
 * @param resolve DNS 해석 함수(테스트 주입용). 기본 dns/promises.lookup.
 * @returns 발신해도 안전한 공개 대상이면 true
 */
export async function isRemoteUrlPublic(
  raw: string,
  resolve: (
    host: string,
  ) => Promise<Array<{ address: string }>> = defaultResolveAll,
): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  const host = u.hostname.toLowerCase();
  const bare =
    host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  // 리터럴 IP (WHATWG 가 정수/16진/IPv4-mapped 를 정규화한 결과 포함) — DNS 불필요
  if (net.isIP(bare)) return !isPrivateIp(bare);

  try {
    const addrs = await resolve(bare);
    if (!addrs || addrs.length === 0) return false;
    return addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

async function defaultResolveAll(
  host: string,
): Promise<Array<{ address: string }>> {
  return lookup(host, { all: true });
}

/**
 * write-time 조기 거부용 동기 검사 — 리터럴 내부/사설 호스트 차단.
 * (DNS 해석은 하지 않는다 — 정본 방어선은 발신 시점 isRemoteUrlPublic.
 *  이 함수는 셀프서브 등록 UX 에서 명백한 내부 주소를 즉시 400 하는 방어막.)
 *
 * URL 호스트 문자열(대괄호 제거 전)을 받아, 내부 리터럴이면 true.
 */
export function isForbiddenLiteralHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === 'host.docker.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  // 리터럴 IP(IPv4/IPv6/IPv4-mapped 16진 포함)면 사설대역 판정에 위임.
  // WHATWG URL 이 정수/16진 IPv4 와 IPv4-mapped 를 정규화하므로 net.isIP 로 잡힌다.
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}
