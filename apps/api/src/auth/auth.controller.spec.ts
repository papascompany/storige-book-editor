import { AuthController } from './auth.controller';

/**
 * AUTH-001 stage1(2026-06-23) 회귀 가드: admin login/refresh 가
 * httpOnly 쿠키(storige_access/storige_refresh)를 *추가* 발급하되,
 * body 토큰(accessToken/refreshToken)도 그대로 반환(비파괴)하는지 검증.
 */
describe('AuthController — AUTH-001 stage1 httpOnly 쿠키 이원화', () => {
  let controller: AuthController;
  const authService = {
    login: jest.fn(),
    refreshToken: jest.fn(),
  };

  const makeRes = () => ({ cookie: jest.fn() }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    // 직접 인스턴스화 — 클래스 가드(JwtStrategy 등)의 DI 해소를 우회(메서드 단위 검증).
    controller = new AuthController(authService as any);
  });

  it('login: body 토큰 반환 + storige_access/refresh 쿠키 httpOnly 설정', async () => {
    const tokens = { accessToken: 'AT', refreshToken: 'RT' };
    authService.login.mockResolvedValue(tokens);
    const res = makeRes();

    const result = await controller.login({ email: 'a@b.c', password: 'x' } as any, res);

    // 비파괴: body 토큰 그대로 반환
    expect(result).toEqual(tokens);
    // 쿠키 추가 발급(httpOnly)
    const names = res.cookie.mock.calls.map((c: any[]) => c[0]);
    expect(names).toContain('storige_access');
    expect(names).toContain('storige_refresh');
    const accessOpts = res.cookie.mock.calls.find((c: any[]) => c[0] === 'storige_access')[2];
    expect(accessOpts.httpOnly).toBe(true);
    expect(accessOpts.path).toBe('/api');
    const refreshOpts = res.cookie.mock.calls.find((c: any[]) => c[0] === 'storige_refresh')[2];
    expect(refreshOpts.httpOnly).toBe(true);
    expect(refreshOpts.path).toBe('/api/auth');
  });

  it('refresh: 갱신 토큰 body 반환 + 쿠키 재설정', async () => {
    const tokens = { accessToken: 'AT2', refreshToken: 'RT2' };
    authService.refreshToken.mockResolvedValue(tokens);
    const res = makeRes();

    const result = await controller.refresh('old-RT', res);

    expect(result).toEqual(tokens);
    expect(authService.refreshToken).toHaveBeenCalledWith('old-RT');
    const names = res.cookie.mock.calls.map((c: any[]) => c[0]);
    expect(names).toContain('storige_access');
    expect(names).toContain('storige_refresh');
  });

  it('refreshToken 누락 시 storige_refresh 쿠키는 설정하지 않는다', async () => {
    authService.login.mockResolvedValue({ accessToken: 'AT', refreshToken: '' });
    const res = makeRes();
    await controller.login({ email: 'a@b.c', password: 'x' } as any, res);
    const names = res.cookie.mock.calls.map((c: any[]) => c[0]);
    expect(names).toContain('storige_access');
    expect(names).not.toContain('storige_refresh');
  });
});
