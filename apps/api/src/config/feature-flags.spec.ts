/**
 * OPS-S4-N2 — api 기능 플래그 기동 스냅샷.
 *
 * 스냅샷 함수는 순수 함수라 입력 조합 표로 검증하고, 소비 서비스의 필드를 직접 읽지 못하는
 * 플래그(FILE_RETENTION_*, THUMBNAIL_CLEANUP_DRY_RUN)는 실제 서비스 인스턴스와 값이 같은지
 * 동치 테스트로 고정한다(소비 코드의 식이 바뀌면 여기서 드러난다).
 */
import { ConfigService } from '@nestjs/config';
import { Logger as NestPinoLogger, PinoLogger } from 'nestjs-pino';
import { Repository } from 'typeorm';
import {
  API_FEATURE_FLAG_KEYS,
  ApiFeatureFlagInputs,
  buildApiFeatureFlagSnapshot,
  formatEffectiveRetentionLine,
  formatFeatureFlagSnapshot,
  isFlagOn,
  isSessionJobOutputLookupOn,
} from './feature-flags';
import { StorageConfigService } from '../settings/storage-config.service';
import { StorageSettingEntity } from '../settings/entities/storage-setting.entity';
import { ThumbnailCleanupService } from '../editor/thumbnail-cleanup.service';
import { EditSessionVersion } from '../editor/entities/edit-session-version.entity';

const LINE_PATTERN = /^\[FLAGS\] api( [A-Z_]+=(true|false))+$/;

const BASE_INPUTS: ApiFeatureFlagInputs = {
  cutoutRaw: undefined,
  queueMonitorEnabled: true,
  fileOrphan: { enabled: true, dryRun: true },
  fileRetentionEnabledRaw: 'true',
  fileRetentionDryRunRaw: '0',
  thumbnailCleanupDryRunRaw: undefined,
  spreadSnapshotHardFailRaw: undefined,
  jobLinkStrictRaw: undefined,
  jobFileSiteStrictRaw: undefined,
  sessionJobOutputLookupRaw: undefined,
};

describe('api feature-flags', () => {
  describe('isFlagOn — 컨트롤러 원래 식 String(x ?? "").trim().toLowerCase() ∈ {true,1} 과 동치', () => {
    const original = (x: unknown): boolean => {
      const v = String(x ?? '').trim().toLowerCase();
      return v === 'true' || v === '1';
    };

    it.each<[unknown, boolean]>([
      ['true', true],
      ['TRUE', true],
      [' true ', true],
      ['1', true],
      [1, true],
      [true, true],
      [undefined, false],
      [null, false],
      ['', false],
      ['false', false],
      ['0', false],
      ['yes', false],
      ['on', false],
      ['2', false],
    ])('%j → %s', (raw, expected) => {
      expect(isFlagOn(raw)).toBe(expected);
      expect(isFlagOn(raw)).toBe(original(raw));
    });
  });

  describe('buildApiFeatureFlagSnapshot — 입력 조합 표', () => {
    it('기본 입력(미설정 상당) → 코드 기본값', () => {
      expect(buildApiFeatureFlagSnapshot(BASE_INPUTS)).toEqual({
        CUTOUT_ENABLED: false,
        QUEUE_MONITOR_ENABLED: true,
        FILE_ORPHAN_ENABLED: true,
        FILE_ORPHAN_DRY_RUN: true,
        FILE_RETENTION_ENABLED: true,
        FILE_RETENTION_DRY_RUN: false,
        THUMBNAIL_CLEANUP_DRY_RUN: false,
        SPREAD_SNAPSHOT_HARD_FAIL: false,
        JOB_LINK_STRICT: false,
        JOB_FILE_SITE_STRICT: false,
        SESSION_JOB_OUTPUT_LOOKUP: false,
      });
    });

    it.each<[unknown, boolean]>([
      [undefined, false],
      ['1', true],
      ['false', false],
    ])('cutoutRaw=%j → CUTOUT_ENABLED=%s', (cutoutRaw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, cutoutRaw });
      expect(snap.CUTOUT_ENABLED).toBe(expected);
    });

    it.each([true, false])('queueMonitorEnabled=%s 그대로 반영', (queueMonitorEnabled) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, queueMonitorEnabled });
      expect(snap.QUEUE_MONITOR_ENABLED).toBe(queueMonitorEnabled);
    });

    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ])('fileOrphan {enabled:%s, dryRun:%s} 그대로 반영', (enabled, dryRun) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, fileOrphan: { enabled, dryRun } });
      expect(snap.FILE_ORPHAN_ENABLED).toBe(enabled);
      expect(snap.FILE_ORPHAN_DRY_RUN).toBe(dryRun);
    });

    it.each<[unknown, boolean]>([
      ['true', true],
      ['false', false],
      ['FALSE', true],
      ['0', true],
      ['', true],
    ])('fileRetentionEnabledRaw=%j → %s (정확히 false 일 때만 OFF)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, fileRetentionEnabledRaw: raw });
      expect(snap.FILE_RETENTION_ENABLED).toBe(expected);
    });

    it.each<[unknown, boolean]>([
      ['1', true],
      ['0', false],
      ['true', false],
      ['', false],
    ])('fileRetentionDryRunRaw=%j → %s (정확히 1 일 때만 ON)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, fileRetentionDryRunRaw: raw });
      expect(snap.FILE_RETENTION_DRY_RUN).toBe(expected);
    });

    it.each<[unknown, boolean]>([
      [undefined, false],
      ['1', true],
      ['true', false],
      [' 1', false],
    ])('thumbnailCleanupDryRunRaw=%j → %s (정확히 1 일 때만 ON)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, thumbnailCleanupDryRunRaw: raw });
      expect(snap.THUMBNAIL_CLEANUP_DRY_RUN).toBe(expected);
    });

    it.each<[unknown, boolean]>([
      [undefined, false],
      ['true', true],
      ['TRUE', false],
      ['1', false],
    ])('spreadSnapshotHardFailRaw=%j → %s (대소문자 구분 정확 일치)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, spreadSnapshotHardFailRaw: raw });
      expect(snap.SPREAD_SNAPSHOT_HARD_FAIL).toBe(expected);
    });

    const STRICT_TABLE: Array<[unknown, boolean]> = [
      [undefined, false],
      ['true', true],
      [' TRUE ', true],
      ['1', true],
      ['false', false],
      ['0', false],
      ['yes', false],
    ];

    it.each(STRICT_TABLE)('jobLinkStrictRaw=%j → JOB_LINK_STRICT=%s (isFlagOn)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, jobLinkStrictRaw: raw });
      expect(snap.JOB_LINK_STRICT).toBe(expected);
      expect(snap.JOB_FILE_SITE_STRICT).toBe(false);
    });

    it.each(STRICT_TABLE)('jobFileSiteStrictRaw=%j → JOB_FILE_SITE_STRICT=%s (isFlagOn)', (raw, expected) => {
      const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, jobFileSiteStrictRaw: raw });
      expect(snap.JOB_FILE_SITE_STRICT).toBe(expected);
      expect(snap.JOB_LINK_STRICT).toBe(false);
    });

    it.each(STRICT_TABLE)(
      'sessionJobOutputLookupRaw=%j → SESSION_JOB_OUTPUT_LOOKUP=%s (isFlagOn, 소비 함수와 같은 값)',
      (raw, expected) => {
        const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, sessionJobOutputLookupRaw: raw });
        expect(snap.SESSION_JOB_OUTPUT_LOOKUP).toBe(expected);
        const env = (raw === undefined ? {} : { SESSION_JOB_OUTPUT_LOOKUP: String(raw) }) as NodeJS.ProcessEnv;
        expect(isSessionJobOutputLookupOn(env)).toBe(expected);
        expect(snap.JOB_LINK_STRICT).toBe(false);
      },
    );

    it('isSessionJobOutputLookupOn: 인자가 없으면 호출 시점의 process.env 를 읽는다', () => {
      const backup = process.env.SESSION_JOB_OUTPUT_LOOKUP;
      try {
        delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
        expect(isSessionJobOutputLookupOn()).toBe(false);
        process.env.SESSION_JOB_OUTPUT_LOOKUP = 'true';
        expect(isSessionJobOutputLookupOn()).toBe(true);
      } finally {
        if (backup === undefined) delete process.env.SESSION_JOB_OUTPUT_LOOKUP;
        else process.env.SESSION_JOB_OUTPUT_LOOKUP = backup;
      }
    });

    it('키 집합이 API_FEATURE_FLAG_KEYS 와 같고 값은 전부 boolean', () => {
      const snap = buildApiFeatureFlagSnapshot(BASE_INPUTS);
      expect(Object.keys(snap).sort()).toEqual([...API_FEATURE_FLAG_KEYS].sort());
      for (const v of Object.values(snap)) expect(typeof v).toBe('boolean');
    });
  });

  describe('formatFeatureFlagSnapshot', () => {
    it('한 줄·형식 고정·키 순서 = KEYS 배열 순서', () => {
      const line = formatFeatureFlagSnapshot(
        'api',
        buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, cutoutRaw: 'true' }),
      );
      expect(line).not.toContain('\n');
      expect(line).toMatch(LINE_PATTERN);
      const keys = line
        .replace(/^\[FLAGS\] api /, '')
        .split(' ')
        .map((t) => t.split('=')[0]);
      expect(keys).toEqual([...API_FEATURE_FLAG_KEYS]);
      expect(line).toContain('CUTOUT_ENABLED=true');
      expect(line).toContain('QUEUE_MONITOR_ENABLED=true');
    });

    it('입력 원문 값은 출력 문자열에 나타나지 않는다', () => {
      const line = formatFeatureFlagSnapshot(
        'api',
        buildApiFeatureFlagSnapshot({
          ...BASE_INPUTS,
          cutoutRaw: 'sk-sentinel',
          fileRetentionEnabledRaw: 'sk-sentinel',
          fileRetentionDryRunRaw: 'sk-sentinel',
          thumbnailCleanupDryRunRaw: 'sk-sentinel',
          spreadSnapshotHardFailRaw: 'sk-sentinel',
          jobLinkStrictRaw: 'sk-sentinel',
          jobFileSiteStrictRaw: 'sk-sentinel',
          sessionJobOutputLookupRaw: 'sk-sentinel',
        }),
      );
      expect(line).not.toContain('sentinel');
      expect(line).toContain('CUTOUT_ENABLED=false');
      expect(line).toContain('JOB_LINK_STRICT=false');
      expect(line).toContain('JOB_FILE_SITE_STRICT=false');
      expect(line).toContain('SESSION_JOB_OUTPUT_LOOKUP=false');
      expect(line).toMatch(LINE_PATTERN);
    });
  });

  describe('formatEffectiveRetentionLine', () => {
    const EFFECTIVE_PATTERN =
      /^\[FLAGS\] api retention-effective FILE_RETENTION_ENABLED=(true|false) FILE_RETENTION_DRY_RUN=(true|false)$/;

    it.each([
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ])('enabled=%s dryRun=%s — 한 줄·형식 고정', (enabled, dryRun) => {
      const line = formatEffectiveRetentionLine('api', { enabled, dryRun });
      expect(line).not.toContain('\n');
      expect(line).toMatch(EFFECTIVE_PATTERN);
      expect(line).toContain(`FILE_RETENTION_ENABLED=${enabled}`);
      expect(line).toContain(`FILE_RETENTION_DRY_RUN=${dryRun}`);
    });

    it('boolean 이 아닌 입력은 false 로 출력한다', () => {
      const loose = { enabled: 'sk-sentinel', dryRun: 1 } as unknown as {
        enabled: boolean;
        dryRun: boolean;
      };
      const line = formatEffectiveRetentionLine('api', loose);
      expect(line).not.toContain('sentinel');
      expect(line).toMatch(EFFECTIVE_PATTERN);
      expect(line).toContain('FILE_RETENTION_ENABLED=false');
      expect(line).toContain('FILE_RETENTION_DRY_RUN=false');
    });
  });

  describe('main.ts 로그 호출 형태(nestjs-pino Logger)', () => {
    it('세 번째 인자를 주면 스냅샷 문자열이 msg 로, 인자가 context 로 들어간다', () => {
      const info = jest.fn();
      const logger = new NestPinoLogger({ info } as unknown as PinoLogger, {});
      const flags = buildApiFeatureFlagSnapshot(BASE_INPUTS);
      const line = formatFeatureFlagSnapshot('api', flags);

      logger.log({ featureFlags: flags }, line, 'FeatureFlags');

      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith({ featureFlags: flags, context: 'FeatureFlags' }, line);
    });
  });

  describe('소비 서비스와의 값 동치(같은 ConfigService 호출 → 같은 결과)', () => {
    const ENV_KEYS = [
      'FILE_RETENTION_ENABLED',
      'FILE_RETENTION_DRY_RUN',
      'THUMBNAIL_CLEANUP_DRY_RUN',
    ] as const;
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

    /** main.ts 스냅샷 블록과 같은 호출로 입력을 만든다 */
    const snapshotFrom = (config: ConfigService) =>
      buildApiFeatureFlagSnapshot({
        ...BASE_INPUTS,
        fileRetentionEnabledRaw: config.get<string>('FILE_RETENTION_ENABLED', 'true'),
        fileRetentionDryRunRaw: config.get<string>('FILE_RETENTION_DRY_RUN', '0'),
        thumbnailCleanupDryRunRaw: config.get<string>('THUMBNAIL_CLEANUP_DRY_RUN'),
      });

    const VALUES: Array<string | undefined> = [undefined, '', 'true', 'false', 'FALSE', '0', '1'];

    it.each(VALUES.flatMap((e) => VALUES.map((d) => [e, d] as const)))(
      'FILE_RETENTION_ENABLED=%j, FILE_RETENTION_DRY_RUN=%j — 관리자 설정 행이 없을 때 storage-config 결과와 같다',
      async (enabledEnv, dryRunEnv) => {
        if (enabledEnv !== undefined) process.env.FILE_RETENTION_ENABLED = enabledEnv;
        if (dryRunEnv !== undefined) process.env.FILE_RETENTION_DRY_RUN = dryRunEnv;
        const config = new ConfigService();
        const repo = {
          findOne: async (): Promise<StorageSettingEntity | null> => null,
        } as unknown as Repository<StorageSettingEntity>;
        const storage = new StorageConfigService(repo, config);

        const { retention } = await storage.getEffectiveConfig(0);
        const snap = snapshotFrom(config);

        expect(snap.FILE_RETENTION_ENABLED).toBe(retention.enabled);
        expect(snap.FILE_RETENTION_DRY_RUN).toBe(retention.dryRun);
      },
    );

    it('관리자 설정 행이 있으면 실효값은 행을 따르고 스냅샷 줄은 env 계층 값을 유지한다', async () => {
      process.env.FILE_RETENTION_ENABLED = 'true';
      process.env.FILE_RETENTION_DRY_RUN = '1';
      const config = new ConfigService();
      const row = { id: 1, retentionEnabled: true, retentionDryRun: false } as StorageSettingEntity;
      const repo = {
        findOne: async (): Promise<StorageSettingEntity | null> => row,
      } as unknown as Repository<StorageSettingEntity>;
      const storage = new StorageConfigService(repo, config);

      const { retention } = await storage.getEffectiveConfig(0);
      const snap = snapshotFrom(config);

      expect(snap.FILE_RETENTION_DRY_RUN).toBe(true);
      expect(retention.dryRun).toBe(false);
      expect(formatEffectiveRetentionLine('api', retention)).toContain(
        'FILE_RETENTION_DRY_RUN=false',
      );
    });

    it.each(VALUES.map((v) => [v]))(
      'THUMBNAIL_CLEANUP_DRY_RUN=%j — thumbnail-cleanup 서비스 필드와 같다',
      (raw) => {
        if (raw !== undefined) process.env.THUMBNAIL_CLEANUP_DRY_RUN = raw;
        const config = new ConfigService();
        const repo = {} as unknown as Repository<EditSessionVersion>;
        const svc = new ThumbnailCleanupService(config, repo);

        const field = (svc as unknown as { dryRun: boolean }).dryRun;
        expect(snapshotFrom(config).THUMBNAIL_CLEANUP_DRY_RUN).toBe(field);
      },
    );
  });
});
