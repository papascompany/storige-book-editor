import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminSeedService } from './admin-seed.service';
import { User } from '../../auth/entities/user.entity';
import { UserRole } from '@storige/types';

/**
 * AdminSeedService — 기본 비밀번호 폴백 제거 검증 (보안 SCRT, 2026-06-13).
 *
 * 규칙:
 *  1. 관리자가 이미 존재하면 ADMIN_PASSWORD 없이도 정상 기동 (no-op).
 *  2. 관리자가 없고 ADMIN_PASSWORD 미설정이면 명시 에러로 기동 실패
 *     ('admin1234' 류 기본값으로 계정이 생성되는 일은 절대 없어야 함).
 *  3. 관리자가 없고 ADMIN_PASSWORD 설정 시 정상 생성 (bcrypt 해시, 평문 저장 금지).
 */
describe('AdminSeedService', () => {
  let service: AdminSeedService;
  let userRepository: jest.Mocked<Repository<User>>;

  const ORIGINAL_ENV = { ...process.env };

  beforeEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ADMIN_EMAIL;
    delete process.env.ADMIN_PASSWORD;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSeedService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((v) => v),
            save: jest.fn(async (v) => v),
          },
        },
      ],
    }).compile();

    service = module.get(AdminSeedService);
    userRepository = module.get(getRepositoryToken(User));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('관리자가 이미 존재하면 ADMIN_PASSWORD 없이도 통과(no-op)', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 'existing',
      email: 'admin@storige.com',
    } as User);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it('관리자가 없고 ADMIN_PASSWORD 미설정이면 명시 에러로 기동 실패', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(service.onModuleInit()).rejects.toThrow(
      /ADMIN_PASSWORD env is not set/,
    );
    expect(userRepository.save).not.toHaveBeenCalled();
  });

  it("기본 비밀번호 'admin1234' 폴백으로는 절대 계정을 만들지 않는다", async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(service.onModuleInit()).rejects.toThrow();
    expect(userRepository.create).not.toHaveBeenCalled();
  });

  it('관리자가 없고 ADMIN_PASSWORD 설정 시 bcrypt 해시로 생성', async () => {
    process.env.ADMIN_EMAIL = 'owner@example.com';
    process.env.ADMIN_PASSWORD = 'unit-test-password-!@#';
    userRepository.findOne.mockResolvedValue(null);

    await service.onModuleInit();

    expect(userRepository.save).toHaveBeenCalledTimes(1);
    const saved = userRepository.save.mock.calls[0][0] as Partial<User>;
    expect(saved.email).toBe('owner@example.com');
    expect(saved.role).toBe(UserRole.ADMIN);
    // 평문 저장 금지 — bcrypt 해시 형태($2a/$2b)여야 함
    expect(saved.passwordHash).not.toBe('unit-test-password-!@#');
    expect(saved.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});
