/**
 * WK-2/WK-3/WK-5 회귀 테스트 (2026-06-13)
 *
 * - WK-2: buildAddBleedArgs 인자 공식 고정 — DEVICEWIDTHPOINTS=(원본W+2*bleed)*2.83465,
 *         HEIGHT 동일, -dFIXEDMEDIA + BeginPage translate 유지, dead psCode 제거.
 * - WK-3: runGhostscript timeoutMs — 만료 시 SIGTERM(→5s 후 SIGKILL), close 시 타이머 정리.
 * - WK-5: 모듈 레벨 카운팅 세마포어(GS_CONCURRENCY, 기본 2)로 GS spawn 동시 수 제한.
 */
import { setImmediate } from 'node:timers';
import {
  buildAddBleedArgs,
  CountingSemaphore,
  DEFAULT_GS_TIMEOUT_MS,
  GS_PDFWRITE_TIMEOUT_MS,
  GS_RASTER_TIMEOUT_MS,
} from './ghostscript';

const MM_TO_PT = 2.83465;

describe('WK-2: buildAddBleedArgs (블리드 인자 공식)', () => {
  it('A4(210x297) + 3mm 블리드 → 페이지 크기 (216x303)mm 를 pt 로 지정해야 한다', () => {
    const args = buildAddBleedArgs('/in.pdf', '/out.pdf', 3, 210, 297);

    const expectedWidthPt = (210 + 2 * 3) * MM_TO_PT; // 216mm
    const expectedHeightPt = (297 + 2 * 3) * MM_TO_PT; // 303mm

    expect(args).toContain(`-dDEVICEWIDTHPOINTS=${expectedWidthPt}`);
    expect(args).toContain(`-dDEVICEHEIGHTPOINTS=${expectedHeightPt}`);
  });

  it('종전 버그(페이지 크기 = bleedPt*2)가 재발하지 않아야 한다', () => {
    const args = buildAddBleedArgs('/in.pdf', '/out.pdf', 3, 210, 297);
    const buggyValue = 3 * MM_TO_PT * 2; // 종전: bleedPt * 2 (≈17pt — 원본 무시)

    expect(args).not.toContain(`-dDEVICEWIDTHPOINTS=${buggyValue}`);
    expect(args).not.toContain(`-dDEVICEHEIGHTPOINTS=${buggyValue}`);
  });

  it('-dFIXEDMEDIA 와 BeginPage translate(bleedPt, bleedPt) 를 유지해야 한다', () => {
    const bleedMm = 5;
    const args = buildAddBleedArgs('/in.pdf', '/out.pdf', bleedMm, 100, 200);
    const bleedPt = bleedMm * MM_TO_PT;

    expect(args).toContain('-dFIXEDMEDIA');
    expect(args).toContain(
      `<< /BeginPage { ${bleedPt} ${bleedPt} translate } bind >> setpagedevice`,
    );
    // -c ... -f 입력 순서 유지
    expect(args.indexOf('-c')).toBeLessThan(args.indexOf('-f'));
    expect(args[args.length - 1]).toBe('/in.pdf');
  });

  it('dead psCode(/PageSize [/oldwidth ...]) 가 어떤 인자에도 포함되지 않아야 한다', () => {
    const args = buildAddBleedArgs('/in.pdf', '/out.pdf', 3, 210, 297);
    expect(args.some((a) => a.includes('/oldwidth'))).toBe(false);
    expect(args.some((a) => a.includes('oldheight'))).toBe(false);
  });

  it('pdfwrite 인쇄 규약 보존 플래그(PRESERVE)를 유지해야 한다', () => {
    const args = buildAddBleedArgs('/in.pdf', '/out.pdf', 3, 210, 297);
    expect(args).toContain('-dPreserveOverprintSettings=true');
    expect(args).toContain('-dPreserveSeparation=true');
    expect(args).toContain('-dPreserveDeviceN=true');
    expect(args).toContain('-sDEVICE=pdfwrite');
    expect(args).toContain('-sOutputFile=/out.pdf');
  });
});

describe('WK-3: 타임아웃 상수', () => {
  it('기본 120s / pdfwrite 60s / 래스터 30s 정책이 고정되어야 한다', () => {
    expect(DEFAULT_GS_TIMEOUT_MS).toBe(120_000);
    expect(GS_PDFWRITE_TIMEOUT_MS).toBe(60_000);
    expect(GS_RASTER_TIMEOUT_MS).toBe(30_000);
  });
});

describe('WK-3: runGhostscript 타임아웃 (GHOSTSCRIPT_PATH=/bin/sh 대역)', () => {
  // GS_PATH 는 모듈 로드 시 읽히므로 isolateModules + 신선한 require 로 주입한다.
  function loadWithEnv(env: Record<string, string | undefined>) {
    let mod: typeof import('./ghostscript');
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('./ghostscript');
    });
    // env 복원 (모듈은 이미 자기 값을 캡처함)
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return mod!;
  }

  it('정상 종료 시 stdout 을 resolve 해야 한다', async () => {
    const gs = loadWithEnv({ GHOSTSCRIPT_PATH: '/bin/sh', GS_CONCURRENCY: undefined });
    await expect(gs.runGhostscript(['-c', 'echo hello'])).resolves.toContain('hello');
  });

  it('비정상 종료 코드는 reject 해야 한다', async () => {
    const gs = loadWithEnv({ GHOSTSCRIPT_PATH: '/bin/sh', GS_CONCURRENCY: undefined });
    await expect(gs.runGhostscript(['-c', 'exit 3'])).rejects.toThrow(/exited with code 3/);
  });

  it('timeoutMs 만료 시 프로세스를 죽이고 타임아웃 에러로 reject 해야 한다', async () => {
    const gs = loadWithEnv({ GHOSTSCRIPT_PATH: '/bin/sh', GS_CONCURRENCY: undefined });
    const started = Date.now();
    await expect(gs.runGhostscript(['-c', 'sleep 5'], 300)).rejects.toThrow(/timed out after 300ms/);
    // SIGTERM 으로 즉시 종료 — sleep 5(5s)를 기다리지 않아야 한다.
    expect(Date.now() - started).toBeLessThan(3_000);
  }, 10_000);

  it('GS_CONCURRENCY=1 이면 두 spawn 이 직렬화되어야 한다 (WK-5 배선 확인)', async () => {
    const gs = loadWithEnv({ GHOSTSCRIPT_PATH: '/bin/sh', GS_CONCURRENCY: '1' });
    expect(gs.gsSemaphore.limit).toBe(1);

    const started = Date.now();
    await Promise.all([
      gs.runGhostscript(['-c', 'sleep 0.25']),
      gs.runGhostscript(['-c', 'sleep 0.25']),
    ]);
    // 병렬이면 ~250ms, 직렬화되면 ≥500ms (스케줄링 지연은 시간을 늘릴 뿐 — 하한 단언은 안전)
    expect(Date.now() - started).toBeGreaterThanOrEqual(450);
  }, 10_000);

  it('GS_CONCURRENCY 미설정 시 기본 한도는 2 여야 한다', () => {
    const gs = loadWithEnv({ GS_CONCURRENCY: undefined });
    expect(gs.gsSemaphore.limit).toBe(2);
  });

  it('GS_CONCURRENCY=5 면 한도 5 로 생성되어야 한다', () => {
    const gs = loadWithEnv({ GS_CONCURRENCY: '5' });
    expect(gs.gsSemaphore.limit).toBe(5);
  });

  it('GS_CONCURRENCY 무효값은 안전 한도로 폴백되어야 한다', () => {
    // '0' → falsy → 기본 2 폴백 (0 동시성은 데드락이므로 허용 안 함)
    expect(loadWithEnv({ GS_CONCURRENCY: '0' }).gsSemaphore.limit).toBe(2);
    // 음수 → 최소 1 로 클램프
    expect(loadWithEnv({ GS_CONCURRENCY: '-3' }).gsSemaphore.limit).toBe(1);
    // 비숫자 → NaN → 기본 2 폴백
    expect(loadWithEnv({ GS_CONCURRENCY: 'abc' }).gsSemaphore.limit).toBe(2);
  });
});

describe('WK-5: CountingSemaphore', () => {
  it('한도 내 acquire 는 즉시 통과해야 한다', async () => {
    const sem = new CountingSemaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.active).toBe(2);
    expect(sem.pending).toBe(0);
  });

  it('한도 초과 acquire 는 release 까지 대기해야 한다', async () => {
    const sem = new CountingSemaphore(1);
    await sem.acquire();

    let third = false;
    const waiting = sem.acquire().then(() => {
      third = true;
    });

    // 마이크로태스크 플러시 후에도 아직 대기 중이어야 함
    await new Promise((r) => setImmediate(r));
    expect(third).toBe(false);
    expect(sem.pending).toBe(1);

    sem.release(); // 슬롯 양도
    await waiting;
    expect(third).toBe(true);
    expect(sem.active).toBe(1); // 양도라 점유 수 유지
    expect(sem.pending).toBe(0);

    sem.release();
    expect(sem.active).toBe(0);
  });

  it('대기자가 FIFO 순서로 깨어나야 한다', async () => {
    const sem = new CountingSemaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const w1 = sem.acquire().then(() => order.push(1));
    const w2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await w1;
    sem.release();
    await w2;

    expect(order).toEqual([1, 2]);
    sem.release();
    expect(sem.active).toBe(0);
  });

  it('대기자 없는 release 는 점유 수만 줄이고 0 아래로 내려가지 않아야 한다', () => {
    const sem = new CountingSemaphore(2);
    sem.release(); // 비정상 호출 방어
    expect(sem.active).toBe(0);
  });
});
