import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  OneToMany,
} from 'typeorm';
import { UserRole, SiteRoleClaim } from '@storige/types';
import { v4 as uuidv4 } from 'uuid';
import { UserSiteRole } from './user-site-role.entity';

@Entity('users')
export class User {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Column({ type: 'varchar', unique: true, length: 255 })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: UserRole.CUSTOMER,
  })
  role: UserRole;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /**
   * P1 멀티테넌시 — 이 계정이 운영하는 site 별 역할 매핑(DB 관계).
   * (런타임 JWT 클레임은 SiteRoleClaim[] 형태로 req.user.siteRoles 에 별도로 실린다.)
   * 전역 관리자(SUPER_ADMIN/ADMIN)는 비어 있어도 전역 접근(dual-mode).
   * eager 아님 — 로그인/토큰 발급 시 relations:['siteRoleAssignments'] 로 명시 로드.
   */
  @OneToMany(() => UserSiteRole, (usr) => usr.user)
  siteRoleAssignments?: UserSiteRole[];

  /**
   * 비영속(런타임 전용) — JwtStrategy.validate 가 토큰의 siteRoles 클레임을 여기 채운다.
   * (@Column 없음 → DB 컬럼 아님). Guard/QueryScope 가 req.user.siteRoles 로 읽는다.
   */
  siteRoles?: SiteRoleClaim[];

  @BeforeInsert()
  generateId() {
    if (!this.id) {
      this.id = uuidv4();
    }
  }
}
