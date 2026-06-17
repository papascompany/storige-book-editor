import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  BeforeInsert,
} from 'typeorm';
import { UserRole } from '@storige/types';
import { v4 as uuidv4 } from 'uuid';
import { User } from './user.entity';

/**
 * P1 멀티테넌시 (2026-06-17) — 사용자 ↔ 사이트 역할 매핑(다대다 조인).
 *
 * 한 계정이 여러 site 를 서로 다른 역할(SITE_ADMIN / SITE_MANAGER)로 운영할 수 있게 한다.
 * - 전역 관리자(User.role = SUPER_ADMIN | ADMIN)는 이 테이블에 행이 **없어도** 전역 접근
 *   (dual-mode — 기존 admin@storige.com 무변경).
 * - 사이트 운영자(User.role = SITE_ADMIN | SITE_MANAGER)는 여기 매핑된 site 에서만 권한을 가지며,
 *   TenantGuard 가 요청 site 가 매핑에 포함되는지 강제한다.
 *
 * additive — 신규 테이블, 기존 users/sites 미변경. user_id/site_id 는 마이그레이션에서
 * FK(ON DELETE CASCADE) 로 sites/users 와 연결한다.
 */
@Entity('user_site_roles')
@Unique('uq_user_site', ['userId', 'siteId'])
export class UserSiteRole {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index('idx_user_site_roles_user_id')
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Index('idx_user_site_roles_site_id')
  @Column({ name: 'site_id', type: 'varchar', length: 36 })
  siteId: string;

  /** 해당 site 에서의 역할 — SITE_ADMIN | SITE_MANAGER */
  @Column({ type: 'varchar', length: 20 })
  role: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
