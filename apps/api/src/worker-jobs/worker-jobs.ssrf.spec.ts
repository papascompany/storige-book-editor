/**
 * WH-002(2026-06-22) SSRF 가드 회귀 — checkFileAccessible 원격 URL 검증.
 *
 * 적대검증이 적발한 MAJOR(16진 IPv4-mapped IPv6 우회)를 고정한다: WHATWG URL 이
 * [::ffff:169.254.169.254] 를 ::ffff:a9fe:a9fe(16진)로 정규화하므로 점표기만 검사하면
 * 메타데이터/루프백/사설대역 SSRF 가 뚫린다. isPrivateIp 가 16진 매핑도 차단해야 한다.
 *
 * isPrivateIp/isRemoteUrlSafe 는 인스턴스 상태를 쓰지 않으므로 deps 를 빈 목으로 구성.
 */
import { WorkerJobsService } from './worker-jobs.service';

function makeService(): any {
  return new WorkerJobsService(
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any,
  );
}

describe('WorkerJobsService SSRF 가드 (WH-002)', () => {
  const svc = makeService();

  describe('isPrivateIp', () => {
    it.each([
      '127.0.0.1', '10.0.0.5', '172.16.0.1', '172.31.255.254', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0',
      '::1', 'fc00::1', 'fd00::1', 'fe80::1', 'feba::1',
      '::ffff:127.0.0.1', '::ffff:169.254.169.254', // 점표기
      '::ffff:7f00:1', '::ffff:a9fe:a9fe', // 16진표기 (MAJOR 회귀 — 반드시 차단)
    ])('차단: %s', (ip) => {
      expect(svc.isPrivateIp(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700::1111'])(
      '통과(공인): %s',
      (ip) => {
        expect(svc.isPrivateIp(ip)).toBe(false);
      },
    );

    it('형식 불명은 안전측 차단', () => {
      expect(svc.isPrivateIp('not-an-ip')).toBe(true);
    });
  });

  describe('isRemoteUrlSafe', () => {
    it('비-http(s) 스킴 거부', async () => {
      expect(await svc.isRemoteUrlSafe('file:///etc/passwd')).toBe(false);
      expect(await svc.isRemoteUrlSafe('gopher://x/')).toBe(false);
      expect(await svc.isRemoteUrlSafe('dict://x/')).toBe(false);
    });

    it('사설/메타데이터 IP 리터럴 거부 (점표기·대괄호 IPv6·16진 매핑)', async () => {
      expect(await svc.isRemoteUrlSafe('http://169.254.169.254/latest/meta-data/')).toBe(false);
      expect(await svc.isRemoteUrlSafe('http://127.0.0.1:6379/')).toBe(false);
      expect(await svc.isRemoteUrlSafe('http://10.0.0.1/x')).toBe(false);
      // WHATWG 정규화로 16진 매핑이 되는 핵심 우회 벡터
      expect(await svc.isRemoteUrlSafe('http://[::ffff:169.254.169.254]/latest/')).toBe(false);
      expect(await svc.isRemoteUrlSafe('http://[::1]/')).toBe(false);
    });

    it('공인 IP 리터럴은 통과(DNS 불필요)', async () => {
      expect(await svc.isRemoteUrlSafe('https://8.8.8.8/x.pdf')).toBe(true);
    });

    it('잘못된 URL 거부', async () => {
      expect(await svc.isRemoteUrlSafe('::::')).toBe(false);
    });
  });
});
