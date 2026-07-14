import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 판형 프리셋 엔티티 (2026-07-14)
 * 인쇄물 규격(재단 사이즈)의 저작측 정본 — templateSet 생성 시 값을 복사 주입한다.
 *
 * - 세로형(portrait) 기준 1행 저장. 방향 토글은 UI 에서 W↔H 스왑(정사각은 disabled).
 * - templateSet 에 presetId 컬럼을 추가하지 않는다(무스키마 — 값 복사만).
 * - 삭제 정책: 하드 삭제 금지(멱등 시드가 부활시켜 충돌) — is_active 소프트 토글만.
 * - 마이그레이션: apps/api/migrations/20260714_add_format_presets.sql
 */
@Entity('format_presets')
export class FormatPreset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 프리셋 코드 — 'a4', 'b5', 'baepan46' 등. 시드 멱등 키(UNIQUE) */
  @Column({ length: 50, unique: true })
  code: string;

  /** 표시명 — 'A4', '46배판' 등 */
  @Column({ length: 100 })
  name: string;

  /** 재단 폭 mm (세로형 기준) */
  @Column({ name: 'trim_width_mm', type: 'float' })
  trimWidthMm: number;

  /** 재단 높이 mm (세로형 기준) */
  @Column({ name: 'trim_height_mm', type: 'float' })
  trimHeightMm: number;

  /** 사방(per-edge) 블리드 mm. 작업사이즈 = 재단 + bleedMm*2. 기본 3 */
  @Column({ name: 'bleed_mm', type: 'float', default: 3 })
  bleedMm: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** 사이트 스코프 (null = 전역 프리셋) */
  @Column({ name: 'site_id', type: 'varchar', length: 36, nullable: true })
  siteId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
