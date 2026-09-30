import { redactUrlTokens } from './url-redact.helper';

describe('redactUrlTokens', () => {
  it('게스트 토큰 쿼리 값을 가리고 경로·다른 파라미터는 유지한다', () => {
    expect(
      redactUrlTokens('/api/edit-sessions/guest/abc/versions?guestToken=secret-1&limit=5'),
    ).toBe('/api/edit-sessions/guest/abc/versions?guestToken=[Filtered]&limit=5');
  });

  it('여러 토큰류 키를 대소문자 무관하게 가린다', () => {
    expect(redactUrlTokens('/x?a=1&TOKEN=t&refresh_token=r&uploadToken=u#frag')).toBe(
      '/x?a=1&TOKEN=[Filtered]&refresh_token=[Filtered]&uploadToken=[Filtered]#frag',
    );
  });

  it('비슷한 이름의 다른 키는 건드리지 않는다', () => {
    expect(redactUrlTokens('/x?tokenType=a&myguestToken=b')).toBe('/x?tokenType=a&myguestToken=b');
  });

  it('쿼리가 없거나 문자열이 아니면 그대로 돌려준다', () => {
    expect(redactUrlTokens('/api/health')).toBe('/api/health');
    expect(redactUrlTokens(undefined)).toBeUndefined();
    expect(redactUrlTokens(42)).toBe(42);
  });
});
