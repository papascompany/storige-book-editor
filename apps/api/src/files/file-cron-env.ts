/**
 * 파일 정리·보존 cron 의 수치형 환경 변수 규칙(FileRetentionService·FileOrphanService 공용).
 *
 * `def` 는 docker-compose.yml api environment 의 `${KEY:-<기본값>}` 리터럴과 같아야 한다
 * (compose-env-parity spec 이 대조한다).
 */
import { ConfigService } from '@nestjs/config';
import { describeEnvNumberRange, EnvNumberRule, parseEnvNumber } from '../config/env-number';

export type FileCronEnvKey =
  | 'FILE_RETENTION_BATCH'
  | 'FILE_PURGE_GRACE_HOURS'
  | 'FILE_ORPHAN_GRACE_PENDING_HOURS'
  | 'FILE_ORPHAN_GRACE_READY_DAYS';

export const FILE_CRON_ENV_RULES: Readonly<Record<FileCronEnvKey, EnvNumberRule>> = {
  /** 1회 처리 건수(보존정책 sweep·purge 와 고아 정리가 함께 쓴다). */
  FILE_RETENTION_BATCH: { def: 200, min: 1, max: 1000, integer: true },
  /** soft-delete 뒤 영구 삭제까지 시간. 클수록 덜 지우는 방향이라 상한을 두지 않는다. */
  FILE_PURGE_GRACE_HOURS: { def: 48, min: 1 },
  /** pending/failed 고아 후보 유예(시간). */
  FILE_ORPHAN_GRACE_PENDING_HOURS: { def: 24, min: 1 },
  /** ready 고아 후보 유예(일). */
  FILE_ORPHAN_GRACE_READY_DAYS: { def: 30, min: 1 },
};

export interface EnvWarnLogger {
  warn(message: string): void;
}

/**
 * `config.get(key, String(def))` 를 규칙대로 해석한다. 값을 고쳐 썼으면 warn 1줄을 남긴다
 * (키·허용 범위·적용값만, 원래 값은 남기지 않는다).
 */
export function resolveFileEnvNumber(
  config: ConfigService,
  key: FileCronEnvKey,
  logger: EnvWarnLogger,
): number {
  const rule = FILE_CRON_ENV_RULES[key];
  const { value, adjusted } = parseEnvNumber(config.get<string>(key, String(rule.def)), rule);
  if (adjusted !== 'none') {
    logger.warn(
      `[env] ${key} 값이 허용 범위(${describeEnvNumberRange(rule)}) 밖이라 적용값 ${value} 사용`,
    );
  }
  return value;
}
