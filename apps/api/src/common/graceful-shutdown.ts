/**
 * 종료 신호(SIGTERM/SIGINT)를 받으면 진행 중인 일을 마치고 프로세스를 끝낸다.
 *
 * 컨테이너에서는 node 가 PID 1 로 뜬다. PID 1 은 핸들러가 없는 신호를 무시하므로,
 * 핸들러를 달지 않으면 `docker stop` 의 SIGTERM 이 버려지고 유예 시간이 지난 뒤
 * SIGKILL(exit 137)로 끝난다. 그 사이 처리 중이던 잡과 요청은 중간에 끊긴다.
 *
 * Nest 의 enableShutdownHooks() 는 정리 뒤 자기 자신에게 같은 신호를 다시 보내 끝내는데,
 * PID 1 에서는 그 신호도 무시된다. 그래서 여기서는 process.exit 로 직접 끝낸다.
 *
 * 순서: drain(새 잡을 받지 않고 처리 중인 잡을 기다림) → app.close()(HTTP·DB·Redis 정리) → exit.
 * drain 을 app.close() 앞에 두는 이유는, 잡이 끝나기 전에 DB 연결이 먼저 닫히지 않게 하기 위해서다.
 */
export interface ShutdownLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ClosableApp {
  close(): Promise<void>;
}

/** 처리하는 종료 신호. 컨테이너 중지는 SIGTERM, 터미널 중단은 SIGINT 다. */
export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface SignalSource {
  on(signal: ShutdownSignal, listener: (signal: ShutdownSignal) => void): unknown;
}

export interface GracefulShutdownOptions {
  /** 로그에 찍을 서비스 이름 */
  name: string;
  /** 이 시간 안에 끝나지 않으면 exit 1 로 끝낸다. compose 의 stop_grace_period 보다 짧아야 한다. */
  timeoutMs: number;
  logger: ShutdownLogger;
  /** app.close() 전에 실행한다. 실패해도 종료는 계속한다. */
  drain?: () => Promise<unknown>;
  signals?: ShutdownSignal[];
  /** 테스트용 주입. 기본은 process. */
  signalSource?: SignalSource;
  /** 테스트용 주입. 기본은 process.exit. */
  exit?: (code: number) => void;
}

/** 로컬 일시정지만 쓰는 최소 큐 형태(Bull Queue 가 만족한다). */
export interface DrainableQueue {
  name: string;
  pause(isLocal?: boolean, doNotWaitActive?: boolean): Promise<void>;
}

/**
 * 이 프로세스가 새 잡을 가져오지 않게 하고, 처리 중인 잡이 끝날 때까지 기다린다.
 * 로컬 일시정지라 큐 자체(Redis 의 대기 목록)는 그대로이고, 다른 프로세스에는 영향이 없다.
 */
export async function drainQueues(
  queues: DrainableQueue[],
  logger: ShutdownLogger,
): Promise<void> {
  const results = await Promise.allSettled(queues.map((q) => q.pause(true, false)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      logger.warn(
        `[SHUTDOWN] 큐 ${queues[i].name} 비우기 실패: ${errorMessage(r.reason)}`,
      );
    }
  });
}

export function installGracefulShutdown(
  app: ClosableApp,
  options: GracefulShutdownOptions,
): void {
  const { name, timeoutMs, logger, drain } = options;
  const signals = options.signals ?? ['SIGTERM', 'SIGINT'];
  const signalSource = options.signalSource ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  let started = false;

  const onSignal = (signal: ShutdownSignal): void => {
    if (started) return;
    started = true;

    const startedAt = Date.now();
    let finished = false;
    const finish = (code: number): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      exit(code);
    };

    logger.log(`[SHUTDOWN] ${name}: ${signal} 수신, 종료 시작 (최대 ${timeoutMs}ms)`);
    const timer = setTimeout(() => {
      logger.warn(`[SHUTDOWN] ${name}: ${timeoutMs}ms 안에 끝나지 않아 강제 종료`);
      finish(1);
    }, timeoutMs);

    void (async () => {
      try {
        if (drain) {
          try {
            await drain();
          } catch (err) {
            logger.warn(`[SHUTDOWN] ${name}: 잡 대기 실패, 종료 계속: ${errorMessage(err)}`);
          }
        }
        await app.close();
        logger.log(`[SHUTDOWN] ${name}: 종료 완료 (${Date.now() - startedAt}ms)`);
        finish(0);
      } catch (err) {
        logger.error(`[SHUTDOWN] ${name}: 종료 중 오류: ${errorMessage(err)}`);
        finish(1);
      }
    })();
  };

  for (const signal of signals) {
    signalSource.on(signal, onSignal);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
