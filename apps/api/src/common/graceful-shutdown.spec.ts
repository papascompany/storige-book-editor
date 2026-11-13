import {
  drainQueues,
  installGracefulShutdown,
  ShutdownLogger,
  ShutdownSignal,
  SignalSource,
} from './graceful-shutdown';

type Listener = (signal: ShutdownSignal) => void;

function makeSignalSource(): SignalSource & { emit(signal: ShutdownSignal): void } {
  const listeners = new Map<ShutdownSignal, Listener[]>();
  return {
    on(signal: ShutdownSignal, listener: Listener) {
      listeners.set(signal, [...(listeners.get(signal) ?? []), listener]);
      return this;
    },
    emit(signal: ShutdownSignal) {
      for (const l of listeners.get(signal) ?? []) l(signal);
    },
  };
}

function makeLogger(): jest.Mocked<ShutdownLogger> {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

/** 대기 중인 promise 연쇄를 끝까지 흘려보낸다. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

describe('installGracefulShutdown', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('신호를 받으면 drain, close 순서로 실행하고 0 으로 끝낸다', async () => {
    const order: string[] = [];
    const exit = jest.fn();
    const source = makeSignalSource();
    installGracefulShutdown(
      { close: async () => void order.push('close') },
      {
        name: 'test',
        timeoutMs: 1000,
        logger: makeLogger(),
        drain: async () => void order.push('drain'),
        signalSource: source,
        exit,
      },
    );

    source.emit('SIGTERM');
    await flush();

    expect(order).toEqual(['drain', 'close']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('SIGINT 도 같은 방식으로 처리한다', async () => {
    const exit = jest.fn();
    const close = jest.fn().mockResolvedValue(undefined);
    const source = makeSignalSource();
    installGracefulShutdown(
      { close },
      { name: 'test', timeoutMs: 1000, logger: makeLogger(), signalSource: source, exit },
    );

    source.emit('SIGINT');
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('신호가 여러 번 와도 종료 절차는 한 번만 돈다', async () => {
    const exit = jest.fn();
    const close = jest.fn().mockResolvedValue(undefined);
    const source = makeSignalSource();
    installGracefulShutdown(
      { close },
      { name: 'test', timeoutMs: 1000, logger: makeLogger(), signalSource: source, exit },
    );

    source.emit('SIGTERM');
    source.emit('SIGTERM');
    source.emit('SIGINT');
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('시간 안에 끝나지 않으면 1 로 끝낸다', async () => {
    const exit = jest.fn();
    const logger = makeLogger();
    const source = makeSignalSource();
    installGracefulShutdown(
      { close: () => new Promise<void>(() => undefined) },
      { name: 'test', timeoutMs: 1000, logger, signalSource: source, exit },
    );

    source.emit('SIGTERM');
    await flush();
    expect(exit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('drain 이 실패해도 close 까지 진행하고 0 으로 끝낸다', async () => {
    const exit = jest.fn();
    const logger = makeLogger();
    const close = jest.fn().mockResolvedValue(undefined);
    const source = makeSignalSource();
    installGracefulShutdown(
      { close },
      {
        name: 'test',
        timeoutMs: 1000,
        logger,
        drain: async () => {
          throw new Error('redis down');
        },
        signalSource: source,
        exit,
      },
    );

    source.emit('SIGTERM');
    await flush();

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('redis down'));
  });

  it('close 가 실패하면 1 로 끝낸다', async () => {
    const exit = jest.fn();
    const logger = makeLogger();
    const source = makeSignalSource();
    installGracefulShutdown(
      {
        close: async () => {
          throw new Error('close failed');
        },
      },
      { name: 'test', timeoutMs: 1000, logger, signalSource: source, exit },
    );

    source.emit('SIGTERM');
    await flush();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('close failed'));
  });

  it('정상 종료 뒤에는 시간 초과 타이머가 다시 exit 를 부르지 않는다', async () => {
    const exit = jest.fn();
    const source = makeSignalSource();
    installGracefulShutdown(
      { close: async () => undefined },
      { name: 'test', timeoutMs: 1000, logger: makeLogger(), signalSource: source, exit },
    );

    source.emit('SIGTERM');
    await flush();
    jest.advanceTimersByTime(5000);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('drainQueues', () => {
  it('모든 큐를 로컬 일시정지하고 처리 중인 잡을 기다린다', async () => {
    const a = { name: 'a', pause: jest.fn().mockResolvedValue(undefined) };
    const b = { name: 'b', pause: jest.fn().mockResolvedValue(undefined) };

    await drainQueues([a, b], makeLogger());

    expect(a.pause).toHaveBeenCalledWith(true, false);
    expect(b.pause).toHaveBeenCalledWith(true, false);
  });

  it('한 큐가 실패해도 나머지를 기다리고 경고만 남긴다', async () => {
    const logger = makeLogger();
    let resolved = false;
    const bad = { name: 'bad', pause: jest.fn().mockRejectedValue(new Error('boom')) };
    const good = {
      name: 'good',
      pause: jest.fn().mockImplementation(async () => {
        await Promise.resolve();
        resolved = true;
      }),
    };

    await expect(drainQueues([bad, good], logger)).resolves.toBeUndefined();

    expect(resolved).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('bad'));
  });
});
