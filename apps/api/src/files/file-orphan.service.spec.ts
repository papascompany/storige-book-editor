/**
 * OPS-S4-N2 — FileOrphanService.getEnvFlags() (기동 스냅샷용 env 계층 값).
 *
 * @nestjs/config v3 의 get() 은 validatedEnv → process.env → internalConfig → default 순으로
 * 조회한다. 그래서 new ConfigService()(internal 비움)로 만들고, 값은 테스트마다 process.env 를
 * 설정·삭제한 뒤 새 인스턴스를 생성하는 방식만 쓴다.
 * 파싱 규칙(정확 일치)은 바꾸지 않고 현행을 고정한다.
 * 수치 env(배치·유예)는 file-cron-env.ts 규칙을 따른다 — 아래 두 번째 describe.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileOrphanService } from './file-orphan.service';
import { FilesService } from './files.service';
import { StorageConfigService } from '../settings/storage-config.service';

const ENV_KEYS = ['FILE_ORPHAN_ENABLED', 'FILE_ORPHAN_DRY_RUN'] as const;

function create(): FileOrphanService {
  return new FileOrphanService(
    {} as unknown as FilesService,
    new ConfigService(),
    {} as unknown as StorageConfigService,
  );
}

describe('FileOrphanService.getEnvFlags', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('둘 다 미설정이면 {enabled:true, dryRun:true}', () => {
    expect(create().getEnvFlags()).toEqual({ enabled: true, dryRun: true });
  });

  it.each([
    ['false', false],
    ['FALSE', true],
    ['0', true],
    ['', true],
    ['true', true],
  ])('FILE_ORPHAN_ENABLED=%j → enabled=%s (정확히 false 일 때만 OFF)', (raw, expected) => {
    process.env.FILE_ORPHAN_ENABLED = raw;
    expect(create().getEnvFlags().enabled).toBe(expected);
  });

  it.each([
    ['0', false],
    ['false', true],
    ['', true],
    ['1', true],
  ])('FILE_ORPHAN_DRY_RUN=%j → dryRun=%s (정확히 0 일 때만 OFF)', (raw, expected) => {
    process.env.FILE_ORPHAN_DRY_RUN = raw;
    expect(create().getEnvFlags().dryRun).toBe(expected);
  });

  it('두 값은 서로 독립적으로 반영된다', () => {
    process.env.FILE_ORPHAN_ENABLED = 'false';
    process.env.FILE_ORPHAN_DRY_RUN = '0';
    expect(create().getEnvFlags()).toEqual({ enabled: false, dryRun: false });
  });
});

describe('FileOrphanService 수치 env(batch·grace)', () => {
  const NUM_KEYS = [
    'FILE_RETENTION_BATCH',
    'FILE_ORPHAN_GRACE_PENDING_HOURS',
    'FILE_ORPHAN_GRACE_READY_DAYS',
  ] as const;
  const envBackup: Record<string, string | undefined> = {};
  let warn: jest.SpyInstance;

  interface OrphanInternals {
    batchLimit: number;
    pendingGraceHours: number;
    readyGraceDays: number;
  }
  const internals = (): OrphanInternals => create() as unknown as OrphanInternals;

  beforeEach(() => {
    for (const k of NUM_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    for (const k of NUM_KEYS) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('모두 미설정이면 batch 200, pending 24h, ready 30d 이고 warn 은 없다', () => {
    expect(internals()).toMatchObject({ batchLimit: 200, pendingGraceHours: 24, readyGraceDays: 30 });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, number]>([
    ['200', 200],
    ['1', 1],
    ['1000', 1000],
    ['0', 200],
    ['-5', 200],
    ['0.5', 200],
    ['abc', 200],
    ['1.5', 1],
    ['1001', 1000],
    ['1e9', 1000],
    ['Infinity', 200],
  ])('FILE_RETENTION_BATCH=%j → batchLimit %d (보존정책과 같은 규칙)', (raw, expected) => {
    process.env.FILE_RETENTION_BATCH = raw;
    expect(internals().batchLimit).toBe(expected);
  });

  // grace 는 종전 식(유한한 숫자이고 1 이상이면 그대로, 아니면 기본값)과 같은 결과를 고정한다.
  const legacyGrace = (raw: string, def: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? n : def;
  };
  const GRACE_VALUES = ['', '0', '0.5', '0.99', '1', '1.5', '24', '-3', 'abc', 'Infinity', '1e4', ' 12 '];

  it.each(GRACE_VALUES.map((v) => [v]))('FILE_ORPHAN_GRACE_PENDING_HOURS=%j — 종전 결과와 같다', (raw) => {
    process.env.FILE_ORPHAN_GRACE_PENDING_HOURS = raw;
    expect(internals().pendingGraceHours).toBe(legacyGrace(raw, 24));
  });

  it.each(GRACE_VALUES.map((v) => [v]))('FILE_ORPHAN_GRACE_READY_DAYS=%j — 종전 결과와 같다', (raw) => {
    process.env.FILE_ORPHAN_GRACE_READY_DAYS = raw;
    expect(internals().readyGraceDays).toBe(legacyGrace(raw, 30));
  });

  it('기본값으로 바꾸면 키별 warn 1줄을 남기고 원래 값은 남기지 않는다', () => {
    process.env.FILE_ORPHAN_GRACE_PENDING_HOURS = '0.5sentinel';
    process.env.FILE_ORPHAN_GRACE_READY_DAYS = '30';
    create();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      '[env] FILE_ORPHAN_GRACE_PENDING_HOURS 값이 허용 범위(1 이상) 밖이라 적용값 24 사용',
    ]);
    expect(lines.join('\n')).not.toContain('sentinel');
  });
});
