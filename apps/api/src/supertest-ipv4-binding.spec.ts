/**
 * supertest 접속 주소 패밀리 정합 — 회귀 가드 (2026-08-26).
 *
 * 배경: supertest 의 serverAddress 는 `listen(0)`(IPv6 '::' 와일드카드)으로 포트를 받고
 * 접속은 하드코딩된 `127.0.0.1`(IPv4)로 한다. macOS 는 v4/v6 바인딩을 분리 취급하므로,
 * 커널이 v6 공간에서 고른 포트의 IPv4 쪽을 로컬 상주 데몬(Orca·agy 등 Go 계열)이
 * 점유 중이면 테스트 요청이 **남의 서버로** 간다 — 전체 스위트에서 희생자가 무작위로
 * 바뀌던 플레이크(~14%)의 근본 원인. test/setup.ts 가 URL 호스트를 실제 바인딩
 * 패밀리에 맞춰([::1]) 재작성한다.
 *
 * 아래 스펙은 그 충돌을 **결정적으로 재현**한다: IPv4 루프백에 '스쿼터'를 세우고
 * 같은 포트의 IPv6 쪽에 우리 서버를 바인딩한 뒤, supertest 요청이 우리 서버에
 * 닿는지 단언한다. setup.ts 패치가 사라지면 요청이 스쿼터의 404 를 받아 실패한다.
 */
import request from 'supertest';
import * as http from 'http';
import type { AddressInfo } from 'net';

describe('supertest 하네스 — 접속 주소 패밀리 정합 (setup.ts 패치)', () => {
  it('IPv4 루프백을 남이 점유한 포트에서도 요청이 자기 서버에 닿는다', async () => {
    // 1) 스쿼터 — Orca/agy 역할: 127.0.0.1(IPv4) 점유, 만나면 안 되는 응답을 낸다.
    const squatter = http.createServer((_req, res) => {
      res.statusCode = 404;
      res.end('SQUATTER');
    });
    await new Promise<void>((resolve) => squatter.listen(0, '127.0.0.1', resolve));
    const port = (squatter.address() as AddressInfo).port;

    // 2) 우리 서버 — 같은 포트의 IPv6 '::' 와일드카드. macOS 는 분리 바인딩을 허용한다.
    //    Linux(CI)는 dual-stack 이라 EADDRINUSE 가 나는데, 그 플랫폼엔 이 함정 자체가
    //    없으므로(충돌이면 listen 이 실패해 커널이 다른 포트를 준다) 조용히 통과시킨다.
    const ours = http.createServer((req, res) => {
      res.setHeader('x-remote-family', req.socket.remoteFamily ?? '');
      res.end('OURS');
    });
    let dualBindOk = true;
    await new Promise<void>((resolve) => {
      ours.on('error', (e: NodeJS.ErrnoException) => {
        if (e.code === 'EADDRINUSE') {
          dualBindOk = false;
          resolve();
        } else {
          throw e;
        }
      });
      ours.listen(port, resolve);
    });

    try {
      if (!dualBindOk) {
        // dual-stack 플랫폼 — 함정 없음. 게이트는 macOS 로컬에서 유효하다.
        return;
      }
      const res = await request(ours).get('/whoami').expect(200);
      // 패치가 사라지면 요청이 127.0.0.1(IPv4) 로 가 스쿼터의 404 'SQUATTER' 를 받는다.
      expect(res.text).toBe('OURS');
      // 접속 패밀리도 바인딩과 일치해야 한다(IPv6).
      expect(res.headers['x-remote-family']).toBe('IPv6');
    } finally {
      await new Promise<void>((r) => ours.close(() => r()));
      await new Promise<void>((r) => squatter.close(() => r()));
    }
  });
});
