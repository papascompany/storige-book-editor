/**
 * 테넌트 격리 확장 (2026-08-23) — findOne(GET :id) / update(PATCH :id) / complete / delete 에
 * versions 라우트와 동일한 `assertTenantScope` 적용.
 *
 * 규칙: 비-staff·비-worker 호출자의 JWT siteId 와 세션 siteId 가 모두 있고 불일치 → 404 SESSION_NOT_FOUND
 * (findById 의 not-found 와 동일 응답 = 존재 오라클 차단, 소유자 판정보다 먼저). staff/worker 예외,
 * caller 미지정(내부 호출)·siteId 부재(레거시 JWT/구 세션) 통과.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import { EditSessionVersionEntity } from './entities/edit-session-version.entity';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { SitesService } from '../sites/sites.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const expectSessionNotFound = async (p: Promise<unknown>) => {
  let caught: unknown;
  try {
    await p;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(NotFoundException);
  const body = (caught as NotFoundException).getResponse() as Record<string, unknown>;
  expect(body).toEqual({
    code: 'SESSION_NOT_FOUND',
    message: '편집 세션을 찾을 수 없습니다.',
    details: { sessionId: SESSION_ID },
  });
};

describe('EditSessionsService — assertTenantScope + update/complete/delete', () => {
  let service: EditSessionsService;
  const mockSessionRepository = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(async (s: EditSessionEntity) => s),
    softDelete: jest.fn(),
    manager: { createQueryBuilder: jest.fn(), query: jest.fn().mockResolvedValue([]) },
  };
  const mockVersionRepository = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((v: Record<string, unknown>) => ({ id: 'ver', ...v })),
    save: jest.fn(async (v: Record<string, unknown>) => v),
    delete: jest.fn(),
  };
  const mkSession = (extra: Partial<EditSessionEntity> = {}): EditSessionEntity =>
    ({
      id: SESSION_ID,
      memberSeqno: 777,
      guestToken: null,
      siteId: SITE_A,
      status: SessionStatus.EDITING,
      canvasData: [{ a: 1 }],
      metadata: null,
      contentPdfFileId: null,
      contentPdfMode: null,
      ...extra,
    }) as EditSessionEntity;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionRepository.save.mockImplementation(async (s: EditSessionEntity) => s);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditSessionsService,
        { provide: getRepositoryToken(EditSessionEntity), useValue: mockSessionRepository },
        { provide: getRepositoryToken(EditSessionVersionEntity), useValue: mockVersionRepository },
        { provide: WorkerJobsService, useValue: { createValidationJob: jest.fn() } },
        { provide: TemplateSetsService, useValue: { findOneWithTemplates: jest.fn(), findOne: jest.fn() } },
      ],
    }).compile();
    service = module.get(EditSessionsService);
  });

  describe('assertTenantScope (순수 판정)', () => {
    const session = { id: SESSION_ID, siteId: SITE_A };
    it('비-staff 교차 site → 404 SESSION_NOT_FOUND', () => {
      expect(() => service.assertTenantScope(session, { siteId: SITE_B, role: 'customer' })).toThrow(
        NotFoundException,
      );
    });
    it('같은 site / caller 없음 / siteId 부재(양쪽) → 통과', () => {
      expect(() => service.assertTenantScope(session, { siteId: SITE_A, role: 'customer' })).not.toThrow();
      expect(() => service.assertTenantScope(session, null)).not.toThrow();
      expect(() => service.assertTenantScope(session, { siteId: null, role: 'customer' })).not.toThrow();
      expect(() =>
        service.assertTenantScope({ id: SESSION_ID, siteId: null }, { siteId: SITE_B, role: 'customer' }),
      ).not.toThrow();
    });
    it('staff(대소문자 무관)·worker 는 교차 site 도 통과', () => {
      for (const role of ['ADMIN', 'manager', 'SUPER_ADMIN', 'worker']) {
        expect(() => service.assertTenantScope(session, { siteId: SITE_B, role })).not.toThrow();
      }
    });
  });

  it('update: 교차 site 소유자(같은 memberSeqno) → 404, save 미호출 (소유자 판정보다 먼저)', async () => {
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    await expectSessionNotFound(
      service.update(SESSION_ID, { canvasData: [{ b: 2 }] }, 777, { siteId: SITE_B, role: 'customer' }),
    );
    expect(mockSessionRepository.save).not.toHaveBeenCalled();
  });

  it('update: 같은 site 소유자 → 정상 저장 / caller 미지정(게스트 라우트·내부) → 기존 동작', async () => {
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    await service.update(SESSION_ID, { canvasData: [{ b: 2 }] }, 777, { siteId: SITE_A, role: 'customer' });
    expect(mockSessionRepository.save).toHaveBeenCalledTimes(1);
    mockSessionRepository.findOne.mockResolvedValue(mkSession({ guestToken: 'g-1', memberSeqno: null as any }));
    await service.update(SESSION_ID, { canvasData: [{ c: 3 }] }, 0);
    expect(mockSessionRepository.save).toHaveBeenCalledTimes(2);
  });

  it('update: 교차 site 비소유자도 403 이 아닌 404 (존재 비누설)', async () => {
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    await expectSessionNotFound(
      service.update(SESSION_ID, { canvasData: [] }, 999, { siteId: SITE_B, role: 'customer' }),
    );
    // 같은 site 비소유자는 기존 403
    await expect(
      service.update(SESSION_ID, { canvasData: [] }, 999, { siteId: SITE_A, role: 'customer' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('complete: 교차 site → 404, 같은 site → 진행', async () => {
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    await expectSessionNotFound(service.complete(SESSION_ID, 777, { siteId: SITE_B, role: 'customer' }));
    expect(mockSessionRepository.save).not.toHaveBeenCalled();
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    const done = await service.complete(SESSION_ID, 777, { siteId: SITE_A, role: 'customer' });
    expect(done.status).toBe(SessionStatus.COMPLETE);
  });

  it('delete: 교차 site → 404·softDelete 미호출, staff 교차 site → 통과(소유자일 때)', async () => {
    mockSessionRepository.findOne.mockResolvedValue(mkSession());
    await expectSessionNotFound(service.delete(SESSION_ID, 777, { siteId: SITE_B, role: 'customer' }));
    expect(mockSessionRepository.softDelete).not.toHaveBeenCalled();
    await service.delete(SESSION_ID, 777, { siteId: SITE_B, role: 'ADMIN' });
    expect(mockSessionRepository.softDelete).toHaveBeenCalledWith(SESSION_ID);
  });
});

describe('EditSessionsController — findOne/PATCH/complete/DELETE 테넌트 caller 전달', () => {
  let controller: EditSessionsController;
  let service: jest.Mocked<EditSessionsService>;
  const sessionOfSiteA = { id: SESSION_ID, memberSeqno: 777, siteId: SITE_A };

  beforeEach(async () => {
    // 컨트롤러 단위: 서비스는 모킹하되 assertTenantScope 는 실구현을 물려 판정을 검증한다.
    const real = new (EditSessionsService as any)();
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'spec-secret' })],
      controllers: [EditSessionsController],
      providers: [
        OptionalShopJwtGuard,
        {
          provide: EditSessionsService,
          useValue: {
            findById: jest.fn().mockResolvedValue(sessionOfSiteA),
            assertTenantScope: (s: any, c: any) => real.assertTenantScope(s, c),
            update: jest.fn().mockResolvedValue(sessionOfSiteA),
            complete: jest.fn().mockResolvedValue(sessionOfSiteA),
            delete: jest.fn().mockResolvedValue(undefined),
            toResponseDto: jest.fn().mockReturnValue({ id: SESSION_ID }),
          },
        },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('k') } },
        {
          provide: SitesService,
          useValue: { findByEditorAuthCode: jest.fn().mockResolvedValue(null), findByWorkerAuthCode: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();
    controller = module.get(EditSessionsController);
    service = module.get(EditSessionsService);
  });

  it('findOne: 교차 site 소유자 → 404, 같은 site → 200, staff 교차 site → 200, 레거시 JWT(siteId 없음) → 200', async () => {
    await expectSessionNotFound(controller.findOne(SESSION_ID, { userId: '777', role: 'customer', siteId: SITE_B }));
    expect(await controller.findOne(SESSION_ID, { userId: '777', role: 'customer', siteId: SITE_A })).toEqual({ id: SESSION_ID });
    expect(await controller.findOne(SESSION_ID, { role: 'ADMIN', siteId: SITE_B })).toEqual({ id: SESSION_ID });
    expect(await controller.findOne(SESSION_ID, { userId: '777', role: 'customer' })).toEqual({ id: SESSION_ID });
  });

  it('findOne: 교차 site 비소유자는 403 대신 404(존재 비누설), 같은 site 비소유자는 403', async () => {
    await expectSessionNotFound(controller.findOne(SESSION_ID, { userId: '1', role: 'customer', siteId: SITE_B }));
    await expect(controller.findOne(SESSION_ID, { userId: '1', role: 'customer', siteId: SITE_A })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('update/complete/delete: 서비스에 caller(siteId/role) 를 전달한다', async () => {
    const user = { userId: '777', role: 'customer', siteId: SITE_A };
    await controller.update(SESSION_ID, { status: 'editing' } as any, user);
    expect(service.update).toHaveBeenCalledWith(SESSION_ID, { status: 'editing' }, 777, { siteId: SITE_A, role: 'customer' });
    await controller.complete(SESSION_ID, user);
    expect(service.complete).toHaveBeenCalledWith(SESSION_ID, 777, { siteId: SITE_A, role: 'customer' });
    await controller.delete(SESSION_ID, user);
    expect(service.delete).toHaveBeenCalledWith(SESSION_ID, 777, { siteId: SITE_A, role: 'customer' });
    // user 부재(내부/비인증 경로) → caller null
    await controller.update(SESSION_ID, {} as any, undefined);
    expect(service.update).toHaveBeenLastCalledWith(SESSION_ID, {}, 0, null);
  });
});
