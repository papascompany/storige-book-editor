import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * StorageSetting — 저장계층/보존정책 런타임 설정 (2026-06-15, 단일 행 id=1).
 *
 * 목적: 관리자가 admin UI 에서 ① 저장 백엔드(local|s3=R2) 토글 + R2 키 입력으로 **즉시 활성**,
 * ② 보존정책 cron on/off·관찰모드를 관리. env 보다 DB 값이 우선(미설정 필드는 env fallback).
 *
 * ⚠️ s3_secret_access_key 는 인프라 시크릿 — admin(JWT+Role) 가드 + 조회 시 마스킹(API에서 평문 미반환).
 */
@Entity('storage_settings')
export class StorageSettingEntity {
  /** 싱글톤 — 항상 1 */
  @PrimaryColumn({ type: 'int' })
  id: number;

  /** 'local' | 's3'. 활성 쓰기 백엔드. */
  @Column({ name: 'driver', type: 'varchar', length: 16, default: 'local' })
  driver: 'local' | 's3';

  @Column({ name: 's3_endpoint', type: 'varchar', length: 500, nullable: true })
  s3Endpoint: string | null;

  @Column({ name: 's3_region', type: 'varchar', length: 64, nullable: true })
  s3Region: string | null;

  @Column({ name: 's3_bucket', type: 'varchar', length: 200, nullable: true })
  s3Bucket: string | null;

  @Column({ name: 's3_access_key_id', type: 'varchar', length: 200, nullable: true })
  s3AccessKeyId: string | null;

  /** 시크릿 — API 조회 응답에는 절대 평문 노출 안 함(마스킹). */
  @Column({ name: 's3_secret_access_key', type: 'varchar', length: 500, nullable: true })
  s3SecretAccessKey: string | null;

  @Column({ name: 's3_force_path_style', type: 'boolean', default: true })
  s3ForcePathStyle: boolean;

  /** 보존정책 cron 마스터 스위치. false=cron 비활성(자동삭제 안 함). */
  @Column({ name: 'retention_enabled', type: 'boolean', default: true })
  retentionEnabled: boolean;

  /** 관찰모드 — true 면 삭제 대상만 로깅하고 실제 삭제 안 함(첫 도입 시 안전 확인용). */
  @Column({ name: 'retention_dry_run', type: 'boolean', default: false })
  retentionDryRun: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
