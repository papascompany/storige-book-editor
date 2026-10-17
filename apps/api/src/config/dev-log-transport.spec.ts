import { resolveDevLogTransport } from './dev-log-transport';

describe('resolveDevLogTransport — 개발 모드 pino 전송기 선택', () => {
  it('production 은 전송기 없음(JSON)', () => {
    expect(resolveDevLogTransport({ nodeEnv: 'production', logPretty: undefined, resolvePretty: () => '/x/pino-pretty' })).toBeUndefined();
  });

  it('개발 모드 + pino-pretty 해석 가능 → 절대 경로 target 의 pretty 전송기', () => {
    const t = resolveDevLogTransport({ nodeEnv: 'development', logPretty: undefined, resolvePretty: () => '/abs/pino-pretty/index.js' });
    expect(t).toEqual({ target: '/abs/pino-pretty/index.js', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } });
  });

  it('개발 모드 + pino-pretty 미설치 → JSON 으로 기동하고 안내 1줄', () => {
    const warn = jest.fn();
    const t = resolveDevLogTransport({
      nodeEnv: 'development',
      logPretty: undefined,
      resolvePretty: () => { throw new Error("Cannot find module 'pino-pretty'"); },
      warn,
    });
    expect(t).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('pino-pretty');
  });

  it.each(['false', '0', 'off', ' NO '])('LOG_PRETTY=%s 면 개발 모드에서도 JSON', (v) => {
    expect(resolveDevLogTransport({ nodeEnv: 'development', logPretty: v, resolvePretty: () => '/abs' })).toBeUndefined();
  });

  it('NODE_ENV 미설정(개발 기본)도 해석 결과를 따른다', () => {
    expect(resolveDevLogTransport({ nodeEnv: undefined, logPretty: undefined, resolvePretty: () => '/abs' })?.target).toBe('/abs');
  });
});
