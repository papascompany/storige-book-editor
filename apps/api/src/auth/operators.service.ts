import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { UserRole } from '@storige/types';
import { User } from './entities/user.entity';
import { UserSiteRole } from './entities/user-site-role.entity';
import { SitesService } from '../sites/sites.service';
import {
  CreateOperatorDto,
  AddAssignmentDto,
  ResetOperatorPasswordDto,
} from './dto/operator.dto';

/** 사이트 운영자 역할(전역역할 제외) */
const SITE_ROLES: UserRole[] = [UserRole.SITE_ADMIN, UserRole.SITE_MANAGER];

export interface OperatorView {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  assignments: { siteId: string; siteName: string; role: UserRole }[];
}

/**
 * P3a 멀티테넌시 — 사이트 운영자(SITE_ADMIN/SITE_MANAGER) 계정·배정 관리.
 * 전역 admin(컨트롤러 @Roles(ADMIN))만 호출. user_site_roles 에 쓰는 유일한 경로.
 * 안전: 모든 변경 대상은 '운영자(site role User)'로 한정 → 전역 admin 계정은 이 API 로 조작 불가.
 */
@Injectable()
export class OperatorsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSiteRole)
    private readonly userSiteRoleRepository: Repository<UserSiteRole>,
    private readonly sitesService: SitesService,
  ) {}

  /** 운영자 목록(site 이름 매핑 포함). siteId 지정 시 그 site 에 배정된 운영자만. */
  async list(siteId?: string): Promise<OperatorView[]> {
    const users = await this.userRepository.find({
      where: SITE_ROLES.map((role) => ({ role })),
      relations: ['siteRoleAssignments'],
      order: { createdAt: 'DESC' },
    });
    const sites = await this.sitesService.findAll();
    const siteName = new Map(sites.map((s) => [s.id, s.name]));

    let result: OperatorView[] = users.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      assignments: (u.siteRoleAssignments ?? []).map((a) => ({
        siteId: a.siteId,
        siteName: siteName.get(a.siteId) ?? a.siteId,
        role: a.role,
      })),
    }));

    if (siteId) {
      result = result.filter((u) =>
        u.assignments.some((a) => a.siteId === siteId),
      );
    }
    return result;
  }

  /** 운영자 생성: User(site role) + 첫 site 배정. */
  async create(dto: CreateOperatorDto): Promise<OperatorView> {
    this.assertSiteRole(dto.role);
    await this.assertSiteExists(dto.siteId);

    const existing = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('이미 존재하는 이메일입니다.');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(dto.password, salt);
    const user = await this.userRepository.save(
      this.userRepository.create({
        email: dto.email,
        passwordHash,
        role: dto.role,
      }),
    );
    await this.userSiteRoleRepository.save(
      this.userSiteRoleRepository.create({
        userId: user.id,
        siteId: dto.siteId,
        role: dto.role,
      }),
    );
    return this.getOne(user.id);
  }

  /** 추가 site 배정(한 계정이 여러 site 운영). */
  async addAssignment(
    userId: string,
    dto: AddAssignmentDto,
  ): Promise<OperatorView> {
    this.assertSiteRole(dto.role);
    await this.getOperator(userId);
    await this.assertSiteExists(dto.siteId);

    const dup = await this.userSiteRoleRepository.findOne({
      where: { userId, siteId: dto.siteId },
    });
    if (dup) {
      throw new ConflictException('이미 이 사이트에 배정된 운영자입니다.');
    }
    await this.userSiteRoleRepository.save(
      this.userSiteRoleRepository.create({
        userId,
        siteId: dto.siteId,
        role: dto.role,
      }),
    );
    return this.getOne(userId);
  }

  /** site 배정 회수. */
  async removeAssignment(
    userId: string,
    siteId: string,
  ): Promise<OperatorView> {
    await this.getOperator(userId);
    const row = await this.userSiteRoleRepository.findOne({
      where: { userId, siteId },
    });
    if (!row) {
      throw new NotFoundException('해당 사이트 배정을 찾을 수 없습니다.');
    }
    await this.userSiteRoleRepository.remove(row);
    return this.getOne(userId);
  }

  /** admin 비밀번호 리셋(현재 비번 불요). 운영자만 대상(전역 admin 보호). */
  async resetPassword(
    userId: string,
    dto: ResetOperatorPasswordDto,
  ): Promise<void> {
    const user = await this.getOperator(userId);
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(dto.newPassword, salt);
    await this.userRepository.save(user);
  }

  /** 운영자 삭제(user_site_roles ON DELETE CASCADE). 운영자만 대상. */
  async remove(userId: string): Promise<void> {
    const user = await this.getOperator(userId);
    await this.userRepository.remove(user);
  }

  // ── 내부 헬퍼 ─────────────────────────────────────────────────────────

  private assertSiteRole(role: UserRole): void {
    if (!SITE_ROLES.includes(role)) {
      throw new BadRequestException(
        '역할은 SITE_ADMIN 또는 SITE_MANAGER 만 가능합니다.',
      );
    }
  }

  private async assertSiteExists(siteId: string): Promise<void> {
    // SitesService.findOne 은 없으면 NotFoundException
    await this.sitesService.findOne(siteId);
  }

  /** 대상이 '운영자(site role User)'인지 보장 — 전역 admin 을 이 API 로 조작 못 하게. */
  private async getOperator(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    }
    if (!SITE_ROLES.includes(user.role)) {
      throw new BadRequestException(
        '사이트 운영자(SITE_ADMIN/SITE_MANAGER)만 관리할 수 있습니다.',
      );
    }
    return user;
  }

  private async getOne(userId: string): Promise<OperatorView> {
    const found = (await this.list()).find((u) => u.id === userId);
    if (!found) {
      throw new NotFoundException('운영자를 찾을 수 없습니다.');
    }
    return found;
  }
}
