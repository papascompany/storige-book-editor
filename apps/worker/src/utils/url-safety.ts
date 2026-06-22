/**
 * SSRF 방어 — 워커가 임의 외부 URL 을 페치하기 전 안전성 검증 (P0-1, 2026-06-22).
 *
 * downloadToTempFile 의 raw-URL 분기(api://·로컬경로가 아닌 임의 http(s) URL)는
 * 인증 없는 잡 적재(compose-mixed/render-pages @Public)와 맞물려, 공격자가
 * coverUrl/contentPdfUrl/fileUrl 에 http://169.254.169.254/... (AWS 메타데이터),
 * http://redis:6379, http://mariadb:3306, http://localhost:4000/api/... 등을 넣으면
 * 워커가 내부망을 페치하는 SSRF 가 가능했다.
 *
 * 이 유틸은 raw-URL 다운로드 직전에 호출되어:
 *  - http/https 스킴만 허용(file://·gopher:// 등 거부)
 *  - DNS 해석 결과가 사설/링크로컬/루프백 대역이면 거부(169.254 AWS 메타데이터 포함)
 *  - WORKER_DOWNLOAD_ALLOWED_HOSTS(콤마구분)로 정당 호스트는 명시 예외(도커 내부 'api' 등)
 *
 * ⚠️ api:// 분기(API_BASE_URL 고정 내부 호출)와 로컬경로 분기는 이 검증을 거치지 않는다
 *    (네트워크 미경유 또는 신뢰 내부 호출) — 정당 흐름 무영향.
 */
import { lookup } from 'dns/promises';
import * as net from 'net';

/** 차단 IPv4 대역 [네트워크주소, 마스크] (>>>0 으로 unsigned 비교). */
const BLOCKED_V4: ReadonlyArray<readonly [number, number]> = [
  [0x7f000000, 0xff000000], // 127.0.0.0/8    loopback
  [0x0a000000, 0xff000000], // 10.0.0.0/8     private
  [0xac100000, 0xfff00000], // 172.16.0.0/12  private
  [0xc0a80000, 0xffff0000], // 192.168.0.0/16 private
  [0xa9fe0000, 0xffff0000], // 169.254.0.0/16 link-local (AWS/GCP 메타데이터 169.254.169.254)
  [0x64400000, 0xffc00000], // 100.64.0.0/10  CGNAT
  [0x00000000, 0xff000000], // 0.0.0.0/8      "this network"
];

/** 주어진 IP(v4/v6 문자열)가 차단 대역이면 true. 파싱 불가도 안전측(true)으로 차단. */
export function isBlockedIp(ip: string): boolean {
  // 대괄호 IPv6 리터럴([2606:4700::1]) → 대괄호 제거 후 판정(공인 IPv6 오차단 방지).
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (net.isIPv6(bare)) {
    const l = bare.toLowerCase();
    if (l === '::1' || l === '::') return true; // loopback / unspecified
    if (l.startsWith('fc') || l.startsWith('fd')) return true; // ULA fc00::/7
    // link-local fe80::/10 = fe80~febf (앞 3니블 fe8/fe9/fea/feb).
    if (/^fe[89ab]/.test(l)) return true;
    // IPv4-mapped — 점표기(::ffff:127.0.0.1) 와 16진표기(::ffff:7f00:1) 양쪽.
    const mappedDotted = l.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return isBlockedIp(mappedDotted[1]);
    const mappedHex = l.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isBlockedIp(v4);
    }
    return false;
  }
  const parts = bare.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // 형식 불명 → 안전측 차단
  }
  const v = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  return BLOCKED_V4.some(([base, mask]) => ((v & mask) >>> 0) === (base >>> 0));
}

/** WORKER_DOWNLOAD_ALLOWED_HOSTS 를 소문자 집합으로 파싱(콤마구분, 공백 무시). */
function allowedHosts(): Set<string> {
  return new Set(
    (process.env.WORKER_DOWNLOAD_ALLOWED_HOSTS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * raw-URL 다운로드 직전 안전성 검증. 부적합하면 throw.
 * @throws Error 스킴 불허·DNS 실패·사설/링크로컬 IP
 */
export async function assertSafeDownloadUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`Invalid download URL: ${raw}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`Blocked URL scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase();

  // 명시 허용 호스트(도커 내부 'api' 등)는 통과 — 정당 내부 http 호출 깨짐 방지.
  if (allowedHosts().has(host)) return;

  // 호스트가 IP 리터럴이면 즉시 검사(DNS 불필요). URL.hostname 은 IPv6 를 대괄호로
  // 감싸 반환([::1])하므로 net.isIP 판정 전 대괄호를 제거한다(공인 IPv6 오차단 방지).
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (net.isIP(bareHost)) {
    if (isBlockedIp(bareHost)) {
      throw new Error(`Blocked private/link-local address: ${bareHost}`);
    }
    return;
  }

  // 도메인이면 DNS 해석 후 모든 결과 IP 를 검사(하나라도 사설이면 거부 = rebinding 1차 방어).
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolve failed for host: ${host}`);
  }
  if (addrs.length === 0) {
    throw new Error(`No DNS records for host: ${host}`);
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`Blocked private/link-local address for host ${host}: ${a.address}`);
    }
  }
}
