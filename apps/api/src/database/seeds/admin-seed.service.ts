import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '@storige/types';

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit() {
    await this.seedAdminUser();
  }

  private async seedAdminUser() {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@storige.com';

    // 이미 관리자가 존재하면 ADMIN_PASSWORD 불필요 — no-op
    const existingAdmin = await this.userRepository.findOne({
      where: { email: adminEmail },
    });

    if (existingAdmin) {
      this.logger.log(`Admin user already exists: ${adminEmail}`);
      return;
    }

    // 신규 생성 경로 — 기본 비밀번호 폴백 금지 (보안 SCRT, 2026-06-13).
    // ADMIN_PASSWORD 미설정 상태에서 약한 기본값('admin1234')으로 관리자
    // 계정이 만들어지는 사고를 막기 위해 명시 에러로 기동을 실패시킨다.
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new Error(
        `AdminSeedService: admin user "${adminEmail}" does not exist and ` +
          'ADMIN_PASSWORD env is not set. Refusing to create an admin account ' +
          'with a default password. Set ADMIN_PASSWORD (and optionally ADMIN_EMAIL) ' +
          'and restart.',
      );
    }

    // 관리자 계정 생성
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(adminPassword, salt);

    const admin = this.userRepository.create({
      email: adminEmail,
      passwordHash,
      role: UserRole.ADMIN,
    });

    await this.userRepository.save(admin);
    // 보안: 비밀번호 값은 절대 로그에 남기지 않는다.
    this.logger.log(`Admin user created: ${adminEmail} (password from ADMIN_PASSWORD env)`);
  }
}
