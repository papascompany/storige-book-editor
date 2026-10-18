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
  ApiConfigGetter,
  ApiFeatureFlagInputs,
  ApiFeatureFlagSnapshot,
  buildApiFeatureFlagSnapshot,
  checkFlagExpectation,
  collectApiFeatureFlagInputs,
  formatEffectiveRetentionLine,
  formatFeatureFlagSnapshot,
  formatFlagExpectationLine,
  isEditorContentPageRulesOn,
  isEditorContentPageRulesOnRaw,
  isEditorSpreadValidationMappingOn,
  isEditorSpreadValidationMappingOnRaw,
  isFlagOn,
  isPartnerJobViewOn,
  isSessionJobOutputLookupOn,
  isSpreadSnapshotHardFail,
  isSpreadSnapshotHardFailRaw,
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
  editorContentPageRulesRaw: undefined,
  editorSheetValidationRulesRaw: undefined,
  editorSpreadValidationMappingRaw: undefined,
  partnerJobViewRaw: undefined,
  partnerSessionLaunchEnabledRaw: undefined,
  sheetMapOutputEnabledRaw: undefined,
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
        EDITOR_CONTENT_PAGE_RULES: true,
        EDITOR_SPREAD_VALIDATION_MAPPING: true,
        PARTNER_JOB_VIEW: false,
        EDITOR_SHEET_VALIDATION_RULES: true,
        PARTNER_SESSION_LAUNCH_ENABLED: true,
        SHEET_MAP_OUTPUT_ENABLED: true,
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

    it.each<[unknown, boolean]>([
      ['true', true],
      ['TRUE', false],
      [' true', false],
      ['1', false],
      ['', false],
      [undefined, false],
    ])(
      'SPREAD_SNAPSHOT_HARD_FAIL=%j → %s (규칙 C — 스냅샷·소비 함수가 같은 값)',
      (raw, expected) => {
        expect(isSpreadSnapshotHardFailRaw(raw)).toBe(expected);
        const env = (raw === undefined ? {} : { SPREAD_SNAPSHOT_HARD_FAIL: String(raw) }) as NodeJS.ProcessEnv;
        expect(isSpreadSnapshotHardFail(env)).toBe(expected);
        const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, spreadSnapshotHardFailRaw: raw });
        expect(snap.SPREAD_SNAPSHOT_HARD_FAIL).toBe(expected);
      },
    );

    it('isSpreadSnapshotHardFail: 인자가 없으면 호출 시점의 process.env 를 읽는다', () => {
      const backup = process.env.SPREAD_SNAPSHOT_HARD_FAIL;
      try {
        delete process.env.SPREAD_SNAPSHOT_HARD_FAIL;
        expect(isSpreadSnapshotHardFail()).toBe(false);
        process.env.SPREAD_SNAPSHOT_HARD_FAIL = 'true';
        expect(isSpreadSnapshotHardFail()).toBe(true);
      } finally {
        if (backup === undefined) delete process.env.SPREAD_SNAPSHOT_HARD_FAIL;
        else process.env.SPREAD_SNAPSHOT_HARD_FAIL = backup;
      }
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
      'partnerJobViewRaw=%j → PARTNER_JOB_VIEW=%s (isFlagOn, 컨트롤러 술어 isPartnerJobViewOn 과 같은 값)',
      (raw, expected) => {
        const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, partnerJobViewRaw: raw });
        expect(snap.PARTNER_JOB_VIEW).toBe(expected);
        expect(isPartnerJobViewOn(raw)).toBe(expected);
        expect(isFlagOn(raw)).toBe(expected);
        expect(snap.JOB_LINK_STRICT).toBe(false);
      },
    );

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

    it.each<[unknown, boolean]>([
      [undefined, true],
      ['', true],
      ['on', true],
      ['true', true],
      ['0', true],
      ['off', false],
      [' OFF ', false],
      ['Off', false],
    ])(
      'editorContentPageRulesRaw=%j → EDITOR_CONTENT_PAGE_RULES=%s (기본 ON, off 만 OFF — 소비 함수와 같은 값)',
      (raw, expected) => {
        const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, editorContentPageRulesRaw: raw });
        expect(snap.EDITOR_CONTENT_PAGE_RULES).toBe(expected);
        expect(isEditorContentPageRulesOnRaw(raw)).toBe(expected);
        const env = (raw === undefined ? {} : { EDITOR_CONTENT_PAGE_RULES: String(raw) }) as NodeJS.ProcessEnv;
        expect(isEditorContentPageRulesOn(env)).toBe(expected);
        expect(snap.SESSION_JOB_OUTPUT_LOOKUP).toBe(false);
      },
    );

    it('isEditorContentPageRulesOn: 인자가 없으면 호출 시점의 process.env 를 읽는다', () => {
      const backup = process.env.EDITOR_CONTENT_PAGE_RULES;
      try {
        delete process.env.EDITOR_CONTENT_PAGE_RULES;
        expect(isEditorContentPageRulesOn()).toBe(true);
        process.env.EDITOR_CONTENT_PAGE_RULES = 'off';
        expect(isEditorContentPageRulesOn()).toBe(false);
        process.env.EDITOR_CONTENT_PAGE_RULES = 'on';
        expect(isEditorContentPageRulesOn()).toBe(true);
      } finally {
        if (backup === undefined) delete process.env.EDITOR_CONTENT_PAGE_RULES;
        else process.env.EDITOR_CONTENT_PAGE_RULES = backup;
      }
    });

    it.each<[unknown, boolean]>([
      [undefined, true],
      ['on', true],
      ['off', false],
      ['OFF', true],
      [' off', true],
      ['off ', true],
      ['', true],
      ['false', true],
    ])(
      'editorSpreadValidationMappingRaw=%j → EDITOR_SPREAD_VALIDATION_MAPPING=%s (규칙 C — 정확히 off 만 해제, 소비 함수와 같은 값)',
      (raw, expected) => {
        const snap = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, editorSpreadValidationMappingRaw: raw });
        expect(snap.EDITOR_SPREAD_VALIDATION_MAPPING).toBe(expected);
        expect(isEditorSpreadValidationMappingOnRaw(raw)).toBe(expected);
        const env = (
          raw === undefined ? {} : { EDITOR_SPREAD_VALIDATION_MAPPING: String(raw) }
        ) as NodeJS.ProcessEnv;
        expect(isEditorSpreadValidationMappingOn(env)).toBe(expected);
        expect(snap.EDITOR_CONTENT_PAGE_RULES).toBe(true);
      },
    );

    it('isEditorSpreadValidationMappingOn: 인자가 없으면 호출 시점의 process.env 를 읽는다', () => {
      const backup = process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
      try {
        delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
        expect(isEditorSpreadValidationMappingOn()).toBe(true);
        process.env.EDITOR_SPREAD_VALIDATION_MAPPING = 'off';
        expect(isEditorSpreadValidationMappingOn()).toBe(false);
        process.env.EDITOR_SPREAD_VALIDATION_MAPPING = 'on';
        expect(isEditorSpreadValidationMappingOn()).toBe(true);
      } finally {
        if (backup === undefined) delete process.env.EDITOR_SPREAD_VALIDATION_MAPPING;
        else process.env.EDITOR_SPREAD_VALIDATION_MAPPING = backup;
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
          editorContentPageRulesRaw: 'sk-sentinel',
          editorSpreadValidationMappingRaw: 'sk-sentinel',
          partnerJobViewRaw: 'sk-sentinel',
        }),
      );
      expect(line).not.toContain('sentinel');
      expect(line).toContain('PARTNER_JOB_VIEW=false');
      expect(line).toContain('EDITOR_SPREAD_VALIDATION_MAPPING=true');
      expect(line).toContain('CUTOUT_ENABLED=false');
      expect(line).toContain('JOB_LINK_STRICT=false');
      expect(line).toContain('JOB_FILE_SITE_STRICT=false');
      expect(line).toContain('SESSION_JOB_OUTPUT_LOOKUP=false');
      expect(line).toContain('EDITOR_CONTENT_PAGE_RULES=true');
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

  describe('collectApiFeatureFlagInputs — 종전 main.ts 입력 매핑과 같다', () => {
    const COLLECT_ENV_KEYS = [
      'CUTOUT_ENABLED',
      'FILE_RETENTION_ENABLED',
      'FILE_RETENTION_DRY_RUN',
      'THUMBNAIL_CLEANUP_DRY_RUN',
      'SPREAD_SNAPSHOT_HARD_FAIL',
      'JOB_LINK_STRICT',
      'JOB_FILE_SITE_STRICT',
      'SESSION_JOB_OUTPUT_LOOKUP',
      'EDITOR_CONTENT_PAGE_RULES',
      'EDITOR_SPREAD_VALIDATION_MAPPING',
      'PARTNER_JOB_VIEW',
      'EDITOR_SHEET_VALIDATION_RULES',
      'PARTNER_SESSION_LAUNCH_ENABLED',
      'SHEET_MAP_OUTPUT_ENABLED',
    ] as const;
    const backup: Record<string, string | undefined> = {};
    const sources = {
      queueMonitor: { isEnabled: (): boolean => false },
      fileOrphan: { getEnvFlags: () => ({ enabled: false, dryRun: true }) },
    };

    beforeEach(() => {
      for (const k of COLLECT_ENV_KEYS) {
        backup[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(() => {
      for (const k of COLLECT_ENV_KEYS) {
        const v = backup[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    /** 종전 main.ts 스냅샷 블록의 입력 매핑을 그대로 옮긴 기준식 */
    const legacyInputs = (config: ConfigService): ApiFeatureFlagInputs => ({
      cutoutRaw: config.get<string>('CUTOUT_ENABLED'),
      queueMonitorEnabled: sources.queueMonitor.isEnabled(),
      fileOrphan: sources.fileOrphan.getEnvFlags(),
      fileRetentionEnabledRaw: config.get<string>('FILE_RETENTION_ENABLED', 'true'),
      fileRetentionDryRunRaw: config.get<string>('FILE_RETENTION_DRY_RUN', '0'),
      thumbnailCleanupDryRunRaw: config.get<string>('THUMBNAIL_CLEANUP_DRY_RUN'),
      spreadSnapshotHardFailRaw: process.env.SPREAD_SNAPSHOT_HARD_FAIL,
      jobLinkStrictRaw: config.get<string>('JOB_LINK_STRICT'),
      jobFileSiteStrictRaw: config.get<string>('JOB_FILE_SITE_STRICT'),
      sessionJobOutputLookupRaw: process.env.SESSION_JOB_OUTPUT_LOOKUP,
      editorContentPageRulesRaw: process.env.EDITOR_CONTENT_PAGE_RULES,
      editorSheetValidationRulesRaw: process.env.EDITOR_SHEET_VALIDATION_RULES,
      editorSpreadValidationMappingRaw: process.env.EDITOR_SPREAD_VALIDATION_MAPPING,
      partnerJobViewRaw: config.get<string>('PARTNER_JOB_VIEW'),
      partnerSessionLaunchEnabledRaw: process.env.PARTNER_SESSION_LAUNCH_ENABLED,
      sheetMapOutputEnabledRaw: process.env.SHEET_MAP_OUTPUT_ENABLED,
    });

    const getterOf = (config: ConfigService): ApiConfigGetter => (key, defaultValue) =>
      defaultValue === undefined ? config.get<string>(key) : config.get<string>(key, defaultValue);

    it.each<[string, string | undefined]>([
      ['미설정', undefined],
      ['빈 값', ''],
      ['true', 'true'],
      ['off', 'off'],
      ['1', '1'],
    ])('모든 키 = %s', (_label, value) => {
      for (const k of COLLECT_ENV_KEYS) {
        if (value !== undefined) process.env[k] = value;
      }
      const config = new ConfigService();
      const collected = collectApiFeatureFlagInputs(getterOf(config), sources);
      expect(collected).toEqual(legacyInputs(config));
      expect(buildApiFeatureFlagSnapshot(collected)).toEqual(
        buildApiFeatureFlagSnapshot(legacyInputs(config)),
      );
    });

    it('env 인자를 주면 process.env 대신 그 값을 읽는다(ConfigService 경유 키는 getter 를 따른다)', () => {
      const get: ApiConfigGetter = (_key, defaultValue) => defaultValue;
      const env = {
        SPREAD_SNAPSHOT_HARD_FAIL: 'true',
        SESSION_JOB_OUTPUT_LOOKUP: '1',
        EDITOR_CONTENT_PAGE_RULES: 'off',
        EDITOR_SPREAD_VALIDATION_MAPPING: 'off',
      } as NodeJS.ProcessEnv;
      const snap = buildApiFeatureFlagSnapshot(collectApiFeatureFlagInputs(get, sources, env));
      expect(snap).toMatchObject({
        SPREAD_SNAPSHOT_HARD_FAIL: true,
        SESSION_JOB_OUTPUT_LOOKUP: true,
        EDITOR_CONTENT_PAGE_RULES: false,
        EDITOR_SPREAD_VALIDATION_MAPPING: false,
        FILE_RETENTION_ENABLED: true,
        FILE_RETENTION_DRY_RUN: false,
        QUEUE_MONITOR_ENABLED: false,
        FILE_ORPHAN_ENABLED: false,
        FILE_ORPHAN_DRY_RUN: true,
      });
    });
  });
});

describe('api 기대값 프로필 대조 — [FLAGS-CHECK]', () => {
  const SNAP: ApiFeatureFlagSnapshot = buildApiFeatureFlagSnapshot({ ...BASE_INPUTS, cutoutRaw: 'true' });
  /** [FLAGS] api 줄의 토큰 부분 그대로 */
  const PROFILE = formatFeatureFlagSnapshot('api', SNAP).replace(/^\[FLAGS\] api /, '');
  const lineOf = (profile: unknown, production = true): string | null =>
    formatFlagExpectationLine('api', checkFlagExpectation(SNAP, profile, production));

  it('production 이 아니면 검사하지 않는다(줄 없음)', () => {
    expect(checkFlagExpectation(SNAP, undefined, false)).toEqual({ status: 'skipped' });
    expect(lineOf('CUTOUT_ENABLED=false', false)).toBeNull();
  });

  it.each<[unknown]>([[undefined], [''], ['   '], [42]])('production 에서 프로필 %j → missing', (profile) => {
    expect(lineOf(profile)).toBe('[FLAGS-CHECK] api missing');
  });

  it('[FLAGS] 줄 토큰과 같은 프로필 → ok n=키 수', () => {
    expect(lineOf(PROFILE)).toBe(`[FLAGS-CHECK] api ok n=${API_FEATURE_FLAG_KEYS.length}`);
    // 2026-10-17: EDITOR_SHEET_VALIDATION_RULES 추가로 14 → 15, 2026-10-18: PARTNER_SESSION_LAUNCH_ENABLED 추가로 15 → 16,
    // 2026-10-18 P2-c: SHEET_MAP_OUTPUT_ENABLED 추가로 16 → 17
    expect(API_FEATURE_FLAG_KEYS.length).toBe(17);
  });

  it('쉼표·여러 공백·줄바꿈 구분도 같다', () => {
    const tokens = PROFILE.split(' ');
    expect(lineOf(tokens.join(','))).toMatch(/ ok n=17$/);
    expect(lineOf(`  ${tokens.join(' ,\n  ')}  `)).toMatch(/ ok n=17$/);
  });

  it('값이 다른 키는 mismatch 에 유효값·기대값으로 나온다(KEYS 순서)', () => {
    const profile = PROFILE.replace('CUTOUT_ENABLED=true', 'CUTOUT_ENABLED=false').replace(
      'JOB_LINK_STRICT=false',
      'JOB_LINK_STRICT=true',
    );
    const r = checkFlagExpectation(SNAP, profile, true);
    expect(r).toEqual({
      status: 'problem',
      invalidCount: 0,
      invalidNames: [],
      mismatches: [
        { key: 'CUTOUT_ENABLED', actual: true, expected: false },
        { key: 'JOB_LINK_STRICT', actual: false, expected: true },
      ],
    });
    expect(formatFlagExpectationLine('api', r)).toBe(
      '[FLAGS-CHECK] api mismatch CUTOUT_ENABLED=true(expected=false) JOB_LINK_STRICT=false(expected=true)',
    );
  });

  it('프로필에 없는 키는 unlisted 로 나온다', () => {
    const profile = PROFILE.split(' ')
      .filter((t) => !t.startsWith('EDITOR_SPREAD_VALIDATION_MAPPING='))
      .join(' ');
    expect(lineOf(profile)).toBe('[FLAGS-CHECK] api mismatch EDITOR_SPREAD_VALIDATION_MAPPING=true(unlisted)');
  });

  it('KEYS 밖 키·형식 오류·중복은 invalid — 개수와 키 형식 이름만, 토큰 원문은 남기지 않는다', () => {
    const profile = [
      PROFILE,
      'UNKNOWN_FLAG=true',
      'CUTOUT_ENABLED=true',
      'sk-sentinel-value',
      'lower_case=true',
      '=true',
      'QUEUE_MONITOR_ENABLED=sentinel',
    ].join(' ');
    const r = checkFlagExpectation(SNAP, profile, true);
    expect(r).toMatchObject({ status: 'problem', invalidCount: 6, mismatches: [] });
    const line = formatFlagExpectationLine('api', r);
    expect(line).toBe('[FLAGS-CHECK] api invalid n=6 names=UNKNOWN_FLAG,CUTOUT_ENABLED,QUEUE_MONITOR_ENABLED');
    expect(line).not.toContain('sentinel');
    expect(line).not.toContain('lower_case');
  });

  it('invalid 와 mismatch 가 함께 있으면 한 줄에 둘 다 나온다', () => {
    const profile = PROFILE.replace('CUTOUT_ENABLED=true', 'CUTOUT_ENABLED=TRUE');
    expect(lineOf(profile)).toBe(
      '[FLAGS-CHECK] api invalid n=1 names=CUTOUT_ENABLED mismatch CUTOUT_ENABLED=true(unlisted)',
    );
  });

  it('[FLAGS-CHECK] 줄은 [FLAGS] 정규식에 걸리지 않는다(기존 [FLAGS] 줄 확인 방식 불변)', () => {
    const lines = [lineOf(PROFILE), lineOf(''), lineOf('X=1'), lineOf(PROFILE.replace('=true', '=false'))];
    for (const line of lines) {
      expect(line).toMatch(/^\[FLAGS-CHECK\] api (ok|missing|invalid|mismatch)( |$)/);
      expect(/\[FLAGS\]/.test(line ?? '')).toBe(false);
      expect(line).not.toContain('\n');
    }
  });
});
