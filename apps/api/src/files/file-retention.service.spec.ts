/**
 * FileRetentionService — 배치 건수(FILE_RETENTION_BATCH)와 영구 삭제 유예(FILE_PURGE_GRACE_HOURS) 해석.
 *
 * file-orphan.service.spec 과 같이 new ConfigService()(internal 비움)로 만들고, 값은 테스트마다
 * process.env 를 설정·삭제한 뒤 새 인스턴스를 생성한다.
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileRetentionService } from './file-retention.service';
import { FilesService } from './files.service';
import { StorageConfigService } from '../settings/storage-config.service';

const ENV_KEYS = ['FILE_RETENTION_BATCH', 'FILE_PURGE_GRACE_HOURS'] as const;

interface RetentionInternals {
  batchLimit: number;
  graceHours: number;
}

function create(): RetentionInternals {
  const svc = new FileRetentionService(
    {} as unknown as FilesService,
    new ConfigService(),
    {} as unknown as StorageConfigService,
  );
  return svc as unknown as RetentionInternals;
}

describe('FileRetentionService 수치 env', () => {
  const envBackup: Record<string, string | undefined> = {};
  let warn: jest.SpyInstance;

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      envBackup[k] = process.env[k];
      delete process.env[k];
    }
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    for (const k of ENV_KEYS) {
      const v = envBackup[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('둘 다 미설정이면 batch 200, grace 48h 이고 warn 은 없다', () => {
    const svc = create();
    expect(svc.batchLimit).toBe(200);
    expect(svc.graceHours).toBe(48);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each<[string, number, boolean]>([
    ['200', 200, false],
    ['1', 1, false],
    ['1000', 1000, false],
    ['', 200, true],
    ['abc', 200, true],
    ['0', 200, true],
    ['-5', 200, true],
    ['0.5', 200, true],
    ['1.5', 1, true],
    ['1001', 1000, true],
    ['1e9', 1000, true],
    ['Infinity', 200, true],
  ])('FILE_RETENTION_BATCH=%j → batchLimit %d (warn=%s)', (raw, expected, warned) => {
    process.env.FILE_RETENTION_BATCH = raw;
    expect(create().batchLimit).toBe(expected);
    expect(warn.mock.calls.length > 0).toBe(warned);
  });

  it.each<[string, number, boolean]>([
    ['48', 48, false],
    ['1', 1, false],
    ['72.5', 72.5, false],
    ['', 48, true],
    ['abc', 48, true],
    ['0', 48, true],
    ['-1', 48, true],
    ['0.01', 48, true],
    ['0.5', 48, true],
    ['Infinity', 48, true],
  ])('FILE_PURGE_GRACE_HOURS=%j → graceHours %d (warn=%s)', (raw, expected, warned) => {
    process.env.FILE_PURGE_GRACE_HOURS = raw;
    expect(create().graceHours).toBe(expected);
    expect(warn.mock.calls.length > 0).toBe(warned);
  });

  it('warn 줄은 키·허용 범위·적용값만 담고 원래 값은 담지 않는다', () => {
    process.env.FILE_RETENTION_BATCH = '5000sentinel';
    process.env.FILE_PURGE_GRACE_HOURS = '0.25';
    create();
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines).toEqual([
      '[env] FILE_RETENTION_BATCH 값이 허용 범위(1~1000, 정수) 밖이라 적용값 200 사용',
      '[env] FILE_PURGE_GRACE_HOURS 값이 허용 범위(1 이상) 밖이라 적용값 48 사용',
    ]);
    for (const line of lines) {
      expect(line).not.toContain('sentinel');
      expect(line).not.toContain('0.25');
    }
  });
});
