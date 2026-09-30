/**
 * OPS-S4-N2 — FileOrphanService.getEnvFlags() (기동 스냅샷용 env 계층 값).
 *
 * @nestjs/config v3 의 get() 은 validatedEnv → process.env → internalConfig → default 순으로
 * 조회한다. 그래서 new ConfigService()(internal 비움)로 만들고, 값은 테스트마다 process.env 를
 * 설정·삭제한 뒤 새 인스턴스를 생성하는 방식만 쓴다.
 * 파싱 규칙(정확 일치)은 바꾸지 않고 현행을 고정한다.
 */
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
