import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { StorageSettingEntity } from './entities/storage-setting.entity';

export interface EffectiveStorageConfig {
  driver: 'local' | 's3';
  s3: {
    endpoint: string | null;
    region: string;
    bucket: string | null;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    forcePathStyle: boolean;
  };
  retention: {
    enabled: boolean;
    dryRun: boolean;
  };
  /** s3 클라이언트 재생성 판단용 시그니처(시크릿 제외 식별값) */
  s3Signature: string;
}

const SINGLETON_ID = 1;

/**
 * StorageConfigService — 저장계층/보존정책 **유효 설정** 제공 (2026-06-15).
 *
 * DB(storage_settings 단일행)가 env 보다 우선. 미설정(null) 필드는 env fallback →
 * admin 미설정 상태에서도 기존 env 기반 동작 유지(비파괴).
 *
 * 짧은 캐시(기본 30s) + admin 저장 시 invalidate() → 재배포 없이 **즉시 반영**.
 */
@Injectable()
export class StorageConfigService {
  private readonly logger = new Logger(StorageConfigService.name);
  private cache: EffectiveStorageConfig | null = null;
  private cacheAt = 0;
  private readonly ttlMs = 30_000;

  constructor(
    @InjectRepository(StorageSettingEntity)
    private readonly repo: Repository<StorageSettingEntity>,
    private readonly config: ConfigService,
  ) {}

  /** admin 저장 직후 호출 → 다음 조회에서 최신값 사용 */
  invalidate(): void {
    this.cache = null;
    this.cacheAt = 0;
  }

  async getEffectiveConfig(nowMs?: number): Promise<EffectiveStorageConfig> {
    const now = nowMs ?? this.monoNow();
    if (this.cache && now - this.cacheAt < this.ttlMs) return this.cache;

    let row: StorageSettingEntity | null = null;
    try {
      row = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    } catch (e) {
      // 테이블 미생성(마이그레이션 전) 등 → env fallback 으로만 동작
      this.logger.debug(`storage_settings 조회 실패(env fallback): ${(e as Error).message}`);
    }

    const env = (k: string, d?: string) => this.config.get<string>(k, d as string);
    const driver = (row?.driver || env('STORAGE_DRIVER', 'local')) as 'local' | 's3';
    const s3 = {
      endpoint: row?.s3Endpoint ?? env('S3_ENDPOINT') ?? null,
      region: row?.s3Region ?? env('S3_REGION', 'auto') ?? 'auto',
      bucket: row?.s3Bucket ?? env('S3_BUCKET') ?? null,
      accessKeyId: row?.s3AccessKeyId ?? env('S3_ACCESS_KEY_ID') ?? null,
      secretAccessKey: row?.s3SecretAccessKey ?? env('S3_SECRET_ACCESS_KEY') ?? null,
      forcePathStyle:
        row?.s3ForcePathStyle ?? (env('S3_FORCE_PATH_STYLE', 'true') !== 'false'),
    };
    const retention = {
      enabled: row?.retentionEnabled ?? env('FILE_RETENTION_ENABLED', 'true') !== 'false',
      dryRun: row?.retentionDryRun ?? env('FILE_RETENTION_DRY_RUN', '0') === '1',
    };

    const cfg: EffectiveStorageConfig = {
      driver,
      s3,
      retention,
      s3Signature: `${s3.endpoint}|${s3.region}|${s3.bucket}|${s3.accessKeyId}|${s3.forcePathStyle}`,
    };
    this.cache = cfg;
    this.cacheAt = now;
    return cfg;
  }

  /** 설정 행 조회(없으면 기본행 반환, 저장 안 함) — controller 표시용 */
  async getRow(): Promise<StorageSettingEntity> {
    const row = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    if (row) return row;
    const def = this.repo.create({ id: SINGLETON_ID, driver: 'local', s3ForcePathStyle: true, retentionEnabled: true, retentionDryRun: false });
    return def;
  }

  /** 부분 업데이트(upsert). secret 은 빈 값이면 기존 유지. 저장 후 invalidate. */
  async update(patch: Partial<StorageSettingEntity>): Promise<StorageSettingEntity> {
    const existing = await this.repo.findOne({ where: { id: SINGLETON_ID } });
    const merged = this.repo.create({
      ...(existing ?? { id: SINGLETON_ID }),
      ...patch,
      id: SINGLETON_ID,
    });
    // secret 빈 값/undefined 면 기존 보존(마스킹 입력 무시)
    if (patch.s3SecretAccessKey === undefined || patch.s3SecretAccessKey === '') {
      merged.s3SecretAccessKey = existing?.s3SecretAccessKey ?? null;
    }
    const saved = await this.repo.save(merged);
    this.invalidate();
    return saved;
  }

  // Date.now() 회피 환경 대응 — process.hrtime 기반 단조 시간(ms)
  private monoNow(): number {
    const [s, ns] = process.hrtime();
    return s * 1000 + ns / 1e6;
  }
}
