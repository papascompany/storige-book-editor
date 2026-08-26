/**
 * Jest 테스트 환경 설정
 */

// 테스트 타임아웃 설정
jest.setTimeout(30000);

// 콘솔 출력 정리 (선택적)
beforeAll(() => {
  // 테스트 시작 전 초기화
});

afterAll(() => {
  // 테스트 종료 후 정리
});

// Mock 환경 변수
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '3306';
process.env.DB_USERNAME = 'test';
process.env.DB_PASSWORD = 'test';
process.env.DB_DATABASE = 'storige_test';

// ── supertest 실패 진단 보강 (2026-08-26) ──────────────────────────────────
// 전체실행 플레이크(정본 §1 ⑩)의 유일한 증거가 "expected 201, got 403" 뿐이라
// 어떤 예외가 던져졌는지(응답 body 의 code/message)를 알 수 없었다. 상태 불일치
// 에러 메시지에 응답 body 를 덧붙인다 — 모든 spec 에 자동 적용되는 진단 계층이며
// 통과하는 테스트에는 어떤 영향도 없다(에러 객체가 만들어질 때만 문자열을 늘린다).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const supertestForDiag = require('supertest');

// ── supertest 접속 주소 패밀리 정합 (2026-08-26 — 전체실행 플레이크 근본 수정) ──
// supertest 의 serverAddress 는 `app.listen(0)`(host 미지정 = IPv6 '::' 와일드카드)으로
// 임시 포트를 받고, URL 은 하드코딩된 `127.0.0.1:<port>`(IPv4)로 만든다. macOS 는
// IPv4/IPv6 바인딩을 분리 취급하므로, 커널이 IPv6 공간에서 고른 포트의 **IPv4 쪽을
// 로컬 상주 데몬**(Orca·agy 등 Go 계열 — 이 Mac 실측 9개)이 이미 점유하고 있어도
// listen 은 성공하고, 그 테스트의 모든 요청은 남의 서버로 간다. Go 데몬의
// "404 page not found" 가 무작위 spec 의 실패로 나타났다(희생자 무작위·단독 통과·
// runInBand 재현·CI 무발현 전부 이것으로 설명 — 정본 RESUME §1 ⑩).
//
// 수정: 바인딩은 원 구현 그대로 두고(`::` 무-host listen 은 동기 바인딩이라 supertest 의
// "listen 직후 address()" 가정이 성립한다), **URL 의 호스트를 실제 바인딩 패밀리에
// 맞춘다** — IPv6 바인딩이면 [::1] 로 접속한다. 우리가 v6 공간에서 받은 포트이므로
// v6 루프백 접속은 우리 서버에 닿는다.
//
// ⚠️ host 를 준 listen(0,'127.0.0.1') 로 IPv4 를 강제하는 안은 기각 — host 가 있으면
//    dns.lookup 경유 비동기 바인딩이라 직후 address() 가 null 이고, 원 구현이 그걸 보고
//    listen(0) 을 한 번 더 해버린다(실측: 결과가 도로 '::').
// ⚠️ 잔여 위험(문서화): macOS 는 특정 ::1:P 리스너와 우리 '::' 와일드카드의 공존을
//    허용하므로 v6 루프백 데몬과의 충돌 가능성이 0 은 아니다. 실측상 이 Mac 의 v6
//    루프백 리스너는 well-known 포트 2개(postgres·redis)뿐이고 ephemeral 범위엔 없다
//    — IPv4 쪽 상주 9개와 달리 실질 표면이 소멸한다.
const origServerAddress = supertestForDiag.Test.prototype.serverAddress;
supertestForDiag.Test.prototype.serverAddress = function (
  app: { address?: () => { family?: string } | string | null },
  path: string,
) {
  const url = origServerAddress.call(this, app, path);
  const addr = typeof app?.address === 'function' ? app.address() : null;
  if (
    addr &&
    typeof addr === 'object' &&
    addr.family === 'IPv6' &&
    typeof url === 'string'
  ) {
    return url.replace('://127.0.0.1:', '://[::1]:');
  }
  return url;
};

const origAssertStatus = supertestForDiag.Test.prototype._assertStatus;
supertestForDiag.Test.prototype._assertStatus = function (
  status: number,
  res: { body?: unknown; text?: string },
) {
  const err = origAssertStatus.call(this, status, res);
  if (err && res) {
    let bodyStr: string;
    try {
      bodyStr = JSON.stringify(res.body);
      if (bodyStr === '{}' && res.text) bodyStr = `(raw) ${res.text.slice(0, 500)}`;
    } catch {
      bodyStr = String(res.text ?? '').slice(0, 500);
    }
    err.message += `\n    response body: ${bodyStr}`;
  }
  return err;
};
