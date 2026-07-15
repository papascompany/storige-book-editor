/**
 * SSRF 공용 유틸 회귀 — isPrivateIp / isRemoteUrlPublic / isForbiddenLiteralHost.
 *
 * 발신 시점 웹훅 가드(2026-07-16)와 worker-jobs WH-002 가 공유하는 단일 출처.
 * DNS 해석은 주입 resolver 로 결정론적으로 검증(실 네트워크 미사용).
 */
import {
  isForbiddenLiteralHost,
  isPrivateIp,
  isRemoteUrlPublic,
} from './ssrf.helper';

describe('ssrf.helper', () => {
  describe('isPrivateIp', () => {
    it.each([
      '127.0.0.1',
      '10.0.0.5',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.1.1',
      '169.254.169.254', // 클라우드 메타데이터
      '100.64.0.1',
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1', // IPv4-mapped 점표기
      '::ffff:169.254.169.254',
      '::ffff:7f00:1', // IPv4-mapped 16진표기(WHATWG 정규화 형태 — 반드시 차단)
      '::ffff:a9fe:a9fe',
    ])('차단: %s', (ip) => {
      expect(isPrivateIp(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700::1111'])(
      '통과(공인): %s',
      (ip) => {
        expect(isPrivateIp(ip)).toBe(false);
      },
    );

    it('형식 불명은 안전측 차단', () => {
      expect(isPrivateIp('not-an-ip')).toBe(true);
    });
  });

  describe('isRemoteUrlPublic', () => {
    const publicResolver = async () => [{ address: '93.184.216.34' }];
    const internalResolver = async () => [{ address: '169.254.169.254' }];

    it('비-http(s) 스킴 거부', async () => {
      expect(await isRemoteUrlPublic('file:///etc/passwd', publicResolver)).toBe(false);
      expect(await isRemoteUrlPublic('gopher://x/', publicResolver)).toBe(false);
    });

    it('DNS 이름이 내부 IP 로 해석되면 차단(리바인딩 벡터)', async () => {
      expect(
        await isRemoteUrlPublic('https://rebind.evil.example/hook', internalResolver),
      ).toBe(false);
    });

    it('DNS 이름이 공인 IP 로 해석되면 통과', async () => {
      expect(
        await isRemoteUrlPublic('https://www.bookmoa.com/hook', publicResolver),
      ).toBe(true);
    });

    it('IPv4-mapped IPv6 리터럴 차단(DNS 불필요)', async () => {
      expect(
        await isRemoteUrlPublic('http://[::ffff:169.254.169.254]/latest/', publicResolver),
      ).toBe(false);
    });

    it('정수/16진 IP 표기는 WHATWG 정규화 후 사설대역이면 차단', async () => {
      // 2130706433 == 127.0.0.1, 0x7f000001 == 127.0.0.1
      expect(await isRemoteUrlPublic('http://2130706433/', publicResolver)).toBe(false);
      expect(await isRemoteUrlPublic('http://0x7f000001/', publicResolver)).toBe(false);
    });

    it('공인 IP 리터럴은 통과(DNS 불필요)', async () => {
      expect(await isRemoteUrlPublic('https://8.8.8.8/x.pdf', publicResolver)).toBe(true);
    });

    it('해석 실패/빈 결과는 안전측 차단', async () => {
      expect(await isRemoteUrlPublic('https://x.example/', async () => [])).toBe(false);
      expect(
        await isRemoteUrlPublic('https://x.example/', async () => {
          throw new Error('ENOTFOUND');
        }),
      ).toBe(false);
    });
  });

  describe('isForbiddenLiteralHost (write-time 조기 거부)', () => {
    it.each([
      'localhost',
      '0.0.0.0',
      '::1',
      'host.docker.internal',
      'foo.internal',
      'bar.local',
      '127.0.0.1',
      '10.0.0.5',
      '192.168.0.2',
      '172.20.1.1',
      '169.254.169.254',
    ])('내부/사설 리터럴 차단: %s', (host) => {
      expect(isForbiddenLiteralHost(host)).toBe(true);
    });

    it.each(['api.example.com', 'www.bookmoa.com', '8.8.8.8', '93.184.216.34'])(
      '공개 호스트 통과: %s',
      (host) => {
        expect(isForbiddenLiteralHost(host)).toBe(false);
      },
    );
  });
});
