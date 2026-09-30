/**
 * 기능 플래그 기동 스냅샷(OPS-S4-N2).
 *
 * 부팅 시 각 플래그의 **유효 불리언**을 한 줄 로그로 남긴다. 값은 소비 코드와 같은 소스·같은
 * 술어로 얻는다(원값을 다시 해석하지 않도록, 가능하면 소비 서비스의 getter 를 쓴다):
 *  - CUTOUT_ENABLED: worker-jobs.controller 와 같은 isFlagOn 술어. 컨트롤러는 요청 시점마다
 *    평가하므로 기동 스냅샷은 그 시점의 표본이다(env 는 런타임에 바뀌지 않음).
 *  - QUEUE_MONITOR_ENABLED: QueueMonitorService.isEnabled().
 *  - FILE_ORPHAN_ENABLED / FILE_ORPHAN_DRY_RUN: FileOrphanService.getEnvFlags() — **env 계층 값**.
 *    최종 유효값은 sweep 시점에 관리자 보존정책과 합쳐진다(enabled = env AND admin,
 *    dryRun = env OR admin).
 *  - FILE_RETENTION_ENABLED / FILE_RETENTION_DRY_RUN: storage-config.service 의 env 폴백 식과
 *    같은 식. 관리자 설정 행에 값이 있으면 그 값이 우선하므로 이 스냅샷은 env 계층 값이다.
 *    보존정책이 실제로 쓰는 값은 별도 줄(formatEffectiveRetentionLine,
 *    `[FLAGS] api retention-effective ...`)로 남긴다 — 삭제 모드 확인은 그 줄로 한다.
 *  - THUMBNAIL_CLEANUP_DRY_RUN: thumbnail-cleanup.service 생성자와 같은 식.
 *  - SPREAD_SNAPSHOT_HARD_FAIL: edit-sessions.service 의 호출 시점 식과 같은 식.
 *
 * 파싱 규칙은 플래그마다 다르다(통일하지 않음 — 동작 변경이므로 테스트로 현행을 고정).
 *
 * 플래그 추가 방법: API_FEATURE_FLAG_KEYS 에 키 1개, 입력 필드 1개, build 에 1줄.
 * 스냅샷 타입이 키 배열에서 파생되므로 한쪽만 추가하면 컴파일 오류가 난다.
 */

/**
 * CUTOUT_ENABLED 진리값 술어 — worker(apps/worker/src/config/feature-flags.ts isFlagOn)와
 * **같은 술어**. 앞뒤 공백 제거 + 대소문자 무시, 'true' 또는 '1' 이면 ON.
 */
export function isFlagOn(raw: unknown): boolean {
  const v = String(raw ?? '').trim().toLowerCase();
  return v === 'true' || v === '1';
}

export const API_FEATURE_FLAG_KEYS = [
  'CUTOUT_ENABLED',
  'QUEUE_MONITOR_ENABLED',
  'FILE_ORPHAN_ENABLED',
  'FILE_ORPHAN_DRY_RUN',
  'FILE_RETENTION_ENABLED',
  'FILE_RETENTION_DRY_RUN',
  'THUMBNAIL_CLEANUP_DRY_RUN',
  'SPREAD_SNAPSHOT_HARD_FAIL',
] as const;

export type ApiFeatureFlagKey = (typeof API_FEATURE_FLAG_KEYS)[number];
export type ApiFeatureFlagSnapshot = Readonly<Record<ApiFeatureFlagKey, boolean>>;

export interface ApiFeatureFlagInputs {
  /** configService.get('CUTOUT_ENABLED') 원값 — 컨트롤러와 동일 소스 */
  cutoutRaw: unknown;
  /** QueueMonitorService.isEnabled() */
  queueMonitorEnabled: boolean;
  /** FileOrphanService.getEnvFlags() — env 계층만 */
  fileOrphan: { enabled: boolean; dryRun: boolean };
  /** configService.get('FILE_RETENTION_ENABLED', 'true') — storage-config.service 와 동일 호출 */
  fileRetentionEnabledRaw: unknown;
  /** configService.get('FILE_RETENTION_DRY_RUN', '0') — storage-config.service 와 동일 호출 */
  fileRetentionDryRunRaw: unknown;
  /** configService.get('THUMBNAIL_CLEANUP_DRY_RUN') — thumbnail-cleanup.service 와 동일 호출 */
  thumbnailCleanupDryRunRaw: unknown;
  /** process.env.SPREAD_SNAPSHOT_HARD_FAIL — edit-sessions.service 와 동일 소스 */
  spreadSnapshotHardFailRaw: unknown;
}

export function buildApiFeatureFlagSnapshot(i: ApiFeatureFlagInputs): ApiFeatureFlagSnapshot {
  return {
    CUTOUT_ENABLED: isFlagOn(i.cutoutRaw),
    QUEUE_MONITOR_ENABLED: i.queueMonitorEnabled === true,
    FILE_ORPHAN_ENABLED: i.fileOrphan.enabled === true,
    FILE_ORPHAN_DRY_RUN: i.fileOrphan.dryRun === true,
    // storage-config.service: `env('FILE_RETENTION_ENABLED', 'true') !== 'false'`
    FILE_RETENTION_ENABLED: i.fileRetentionEnabledRaw !== 'false',
    // storage-config.service: `env('FILE_RETENTION_DRY_RUN', '0') === '1'`
    FILE_RETENTION_DRY_RUN: i.fileRetentionDryRunRaw === '1',
    // thumbnail-cleanup.service: `configService.get('THUMBNAIL_CLEANUP_DRY_RUN') === '1'`
    THUMBNAIL_CLEANUP_DRY_RUN: i.thumbnailCleanupDryRunRaw === '1',
    // edit-sessions.service: `process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true'`
    SPREAD_SNAPSHOT_HARD_FAIL: i.spreadSnapshotHardFailRaw === 'true',
  };
}

/** 한 줄, `KEY=true|false` 토큰만. 값은 boolean 으로 강제(env 원문 출력 불가). */
export function formatFeatureFlagSnapshot(service: 'api', snap: ApiFeatureFlagSnapshot): string {
  return (
    `[FLAGS] ${service} ` +
    API_FEATURE_FLAG_KEYS.map((k) => `${k}=${snap[k] === true}`).join(' ')
  );
}

/** StorageConfigService.getEffectiveConfig().retention 의 불리언 두 개 */
export interface EffectiveRetentionFlags {
  enabled: boolean;
  dryRun: boolean;
}

/**
 * 보존정책 실효값 한 줄. 관리자 저장소 설정(storage_settings 행)이 env 보다 우선하므로
 * 스냅샷 줄의 FILE_RETENTION_* 와 다를 수 있다. file-retention 이 실제로 쓰는 값은 이 줄이다.
 * 기동 시점 표본이며, 관리자 화면에서 저장하면 런타임에 바뀐다. 값은 boolean 으로 강제.
 */
export function formatEffectiveRetentionLine(service: 'api', r: EffectiveRetentionFlags): string {
  return (
    `[FLAGS] ${service} retention-effective ` +
    `FILE_RETENTION_ENABLED=${r.enabled === true} FILE_RETENTION_DRY_RUN=${r.dryRun === true}`
  );
}
