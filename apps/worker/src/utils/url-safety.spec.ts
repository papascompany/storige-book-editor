/**
 * P0-1(2026-06-22) SSRF 방어 회귀 테스트.
 *
 * assertSafeDownloadUrl 가 사설/링크로컬/루프백 IP 와 비-http(s) 스킴을 거부하고,
 * 공인 IP·허용 호스트는 통과시키는지 검증한다. isBlockedIp 는 순수 함수라 DNS 불필요.
 * 거부 오류는 UnsafeDownloadUrlError(reason)이고, name·message 는 평범한 Error 와 같다.
 * 이름 확인이 필요한 사례는 dns/promises lookup 목으로 대신한다(IP 리터럴·허용 호스트 사례는 lookup 을 쓰지 않음).
 */
import { lookup } from 'dns/promises';
import { DomainError } from '../common/errors';
import { isBlockedIp, assertSafeDownloadUrl, UnsafeDownloadUrlError } from './url-safety';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
const mockedLookup = lookup as unknown as jest.Mock;

describe('isBlockedIp (사설/링크로컬/루프백 차단)', () => {
  it.each([
    '127.0.0.1', // loopback
    '10.0.0.5', // private /8
    '172.16.0.1', // private /12 하한
    '172.31.255.254', // private /12 상한
    '192.168.1.1', // private /16
    '169.254.169.254', // AWS/GCP 메타데이터
    '100.64.0.1', // CGNAT
    '0.0.0.0', // this-network
  ])('차단해야 함: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8', // 공인
    '1.1.1.1',
    '172.32.0.1', // /12 경계 밖 → 공인
    '172.15.255.255', // /12 경계 밖 → 공인
    '93.184.216.34', // example.com
  ])('통과해야 함: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it.each([
    '::1', // IPv6 loopback
    'fc00::1', // ULA
    'fd12:3456::1', // ULA
    'fe80::1', // link-local
    'fe81::1', // link-local fe80::/10 (fe80 prefix-only 검사의 사각지대 — 보강 확인)
    'feba::1', // link-local 상한
    '::ffff:127.0.0.1', // IPv4-mapped loopback(점표기)
    '::ffff:169.254.169.254', // IPv4-mapped 메타데이터(점표기)
    '::ffff:7f00:1', // IPv4-mapped loopback(16진표기 = 127.0.0.1)
    '::ffff:a9fe:a9fe', // IPv4-mapped 169.254.169.254(16진표기)
    '[::1]', // 대괄호 IPv6 loopback
  ])('IPv6 차단해야 함: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '2606:4700::1111', // 공인 IPv6(Cloudflare)
    '[2606:4700::1111]', // 대괄호 공인 IPv6 — 오차단 없어야 함
  ])('공인 IPv6 통과해야 함: %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });

  it('형식 불명은 안전측(차단)으로 처리', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true);
    expect(isBlockedIp('999.999.999.999')).toBe(true);
  });
});

describe('assertSafeDownloadUrl', () => {
  it('비-http(s) 스킴을 거부', async () => {
    await expect(assertSafeDownloadUrl('file:///etc/passwd')).rejects.toThrow(/scheme/i);
    await expect(assertSafeDownloadUrl('gopher://x')).rejects.toThrow(/scheme/i);
  });

  it('잘못된 URL 을 거부', async () => {
    await expect(assertSafeDownloadUrl('::::')).rejects.toThrow(/Invalid download URL/);
  });

  it('IP 리터럴 사설/메타데이터 주소를 DNS 없이 즉시 거부', async () => {
    await expect(assertSafeDownloadUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /private|link-local/i,
    );
    await expect(assertSafeDownloadUrl('http://127.0.0.1:4000/api')).rejects.toThrow(
      /private|link-local/i,
    );
    await expect(assertSafeDownloadUrl('http://10.0.0.1/x')).rejects.toThrow(/private|link-local/i);
  });

  it('공인 IP 리터럴은 통과', async () => {
    await expect(assertSafeDownloadUrl('https://8.8.8.8/x')).resolves.toBeUndefined();
  });

  it('WORKER_DOWNLOAD_ALLOWED_HOSTS 의 호스트는 DNS 검사 없이 통과(도커 내부 api 등)', async () => {
    const prev = process.env.WORKER_DOWNLOAD_ALLOWED_HOSTS;
    process.env.WORKER_DOWNLOAD_ALLOWED_HOSTS = 'api,cdn.example.com';
    try {
      // 'api' 는 도커 내부 사설 IP 로 해석되지만 allowlist 라 통과해야 함
      await expect(assertSafeDownloadUrl('http://api:4000/files/x')).resolves.toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.WORKER_DOWNLOAD_ALLOWED_HOSTS;
      else process.env.WORKER_DOWNLOAD_ALLOWED_HOSTS = prev;
    }
  });
});

describe('assertSafeDownloadUrl 오류 형태', () => {
  async function rejection(raw: string): Promise<unknown> {
    return assertSafeDownloadUrl(raw).then(
      () => undefined,
      (err: unknown) => err,
    );
  }

  beforeEach(() => {
    mockedLookup.mockReset();
  });

  it.each([
    ['::::', 'invalid-url', 'Invalid download URL: ::::'],
    ['ftp://files.example.com/a.pdf', 'blocked-scheme', 'Blocked URL scheme: ftp:'],
    ['http://169.254.169.254/latest', 'blocked-address', 'Blocked private/link-local address: 169.254.169.254'],
  ])('%s → UnsafeDownloadUrlError(%s), name Error·메시지 고정', async (raw, reason, message) => {
    const err = await rejection(raw);
    expect(err).toBeInstanceOf(UnsafeDownloadUrlError);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(DomainError);
    expect((err as UnsafeDownloadUrlError).reason).toBe(reason);
    expect((err as Error).message).toBe(message);
    expect((err as Error).name).toBe('Error');
    expect(String(err)).toBe(`Error: ${message}`);
  });

  it('이름 확인 결과가 사설 주소면 UnsafeDownloadUrlError(blocked-address)', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34' }, { address: '10.1.2.3' }]);
    const err = await rejection('https://files.example.com/a.pdf');
    expect(err).toBeInstanceOf(UnsafeDownloadUrlError);
    expect((err as UnsafeDownloadUrlError).reason).toBe('blocked-address');
    expect((err as Error).message).toBe(
      'Blocked private/link-local address for host files.example.com: 10.1.2.3',
    );
    expect((err as Error).name).toBe('Error');
  });

  it('이름 확인 실패는 평범한 Error', async () => {
    mockedLookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const err = await rejection('https://files.example.com/a.pdf');
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnsafeDownloadUrlError);
    expect((err as Error).message).toBe('DNS resolve failed for host: files.example.com');
  });

  it('이름 확인 레코드가 없으면 평범한 Error', async () => {
    mockedLookup.mockResolvedValue([]);
    const err = await rejection('https://files.example.com/a.pdf');
    expect(err).not.toBeInstanceOf(UnsafeDownloadUrlError);
    expect((err as Error).message).toBe('No DNS records for host: files.example.com');
  });

  it('이름 확인 결과가 공인 주소면 통과', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34' }]);
    await expect(assertSafeDownloadUrl('https://files.example.com/a.pdf')).resolves.toBeUndefined();
  });
});
