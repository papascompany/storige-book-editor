/**
 * versions 라우트 3종(listVersions/getVersion/restoreVersion) 의 인가 헬퍼
 * `assertOwnerOrStaff` 테넌트 격리 스펙 (2026-08-23).
 *
 * 배경: memberSeqno 는 site 별 독립 번호공간이라 "같은 memberSeqno·다른 siteId" 의
 * customer JWT 가 소유자로 오판될 수 있다. 비-staff 호출자에 한해 user.siteId ↔ session.siteId
 * 불일치 시 findById 의 not-found 와 동일한 404 SESSION_NOT_FOUND 로 차단(존재 오라클 방지).
 * staff(admin/manager/super_admin)는 전 테넌트 운영자로 예외, siteId 부재(레거시)는 통과.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EditSessionsController } from './edit-sessions.controller';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { EditSessionsService } from './edit-sessions.service';
import { SitesService } from '../sites/sites.service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('EditSessionsController versions 라우트 테넌트 격리 (assertOwnerOrStaff)', () => {
  let controller: EditSessionsController;
  let service: jest.Mocked<EditSessionsService>;

  const sessionOfSiteA = {
    id: SESSION_ID,
    memberSeqno: 777,
    siteId: SITE_A,
  };

  const versionsPayload = [{ id: VERSION_ID, createdAt: new Date(), reason: 'manual' }];
  const restoredSession = { id: SESSION_ID, memberSeqno: 777, siteId: SITE_A };
  const restoredDto = { id: SESSION_ID };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'spec-secret' })],
      controllers: [EditSessionsController],
      providers: [
        OptionalShopJwtGuard,
        {
          provide: EditSessionsService,
          useValue: {
            findById: jest.fn().mockResolvedValue(sessionOfSiteA),
            // 2026-08-23: 테넌트 판정이 서비스 공용 assertTenantScope 로 이동 — 실구현을 물린다
            assertTenantScope: (sess: unknown, caller: unknown) =>
              EditSessionsService.prototype.assertTenantScope.call(
                EditSessionsService.prototype,
                sess as any,
                caller as any,
              ),
            listVersions: jest.fn().mockResolvedValue(versionsPayload),
            getVersion: jest.fn().mockResolvedValue({
              id: VERSION_ID,
              createdAt: new Date(),
              pageCount: 4,
              nextPageCount: null,
              reason: 'manual',
              sessionStatus: 'editing',
              canvasData: { pages: [] },
            }),
            restoreVersion: jest.fn().mockResolvedValue(restoredSession),
            toResponseDto: jest.fn().mockReturnValue(restoredDto),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test_api_key') },
        },
        {
          provide: SitesService,
          useValue: {
            findByEditorAuthCode: jest.fn().mockResolvedValue(null),
            findByWorkerAuthCode: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    controller = module.get<EditSessionsController>(EditSessionsController);
    service = module.get(EditSessionsService);
  });

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

  it('(1) 같은 memberSeqno·다른 siteId 의 customer JWT → listVersions 404 SESSION_NOT_FOUND, service.listVersions 미호출', async () => {
    const crossTenantCustomer = { userId: '777', role: 'customer', siteId: SITE_B };

    await expectSessionNotFound(controller.listVersions(SESSION_ID, crossTenantCustomer));

    expect(service.findById).toHaveBeenCalledWith(SESSION_ID);
    expect(service.listVersions).not.toHaveBeenCalled();
  });

  it('(1-b) getVersion 교차 테넌트 → 403 이 아닌 404(존재 비누설), service.getVersion 미호출', async () => {
    const crossTenantCustomer = { userId: '777', role: 'customer', siteId: SITE_B };

    await expectSessionNotFound(
      controller.getVersion(SESSION_ID, VERSION_ID, crossTenantCustomer),
    );
    expect(service.getVersion).not.toHaveBeenCalled();
  });

  it('(2) 같은 site 의 소유자 → 통과, service.listVersions 호출', async () => {
    const sameTenantOwner = { userId: '777', role: 'customer', siteId: SITE_A };

    const result = await controller.listVersions(SESSION_ID, sameTenantOwner);

    expect(result).toBe(versionsPayload);
    expect(service.listVersions).toHaveBeenCalledWith(SESSION_ID);
  });

  it('(3) staff(role ADMIN, 다른 site) → 전 테넌트 운영자로 통과', async () => {
    const staffOtherSite = { userId: '999', role: 'ADMIN', siteId: SITE_B };

    const result = await controller.listVersions(SESSION_ID, staffOtherSite);

    expect(result).toBe(versionsPayload);
    expect(service.listVersions).toHaveBeenCalledWith(SESSION_ID);
  });

  it('(4) user.siteId 없음(레거시 JWT) → 소유자면 통과', async () => {
    const legacyOwner = { userId: '777', role: 'customer' };

    const result = await controller.listVersions(SESSION_ID, legacyOwner);

    expect(result).toBe(versionsPayload);
    expect(service.listVersions).toHaveBeenCalledWith(SESSION_ID);
  });

  it('(4-b) session.siteId 없음(구 세션) → 타 site JWT 소유자도 통과(기존 동작 보존)', async () => {
    service.findById.mockResolvedValueOnce({ ...sessionOfSiteA, siteId: null } as any);
    const ownerOtherSite = { userId: '777', role: 'customer', siteId: SITE_B };

    const result = await controller.listVersions(SESSION_ID, ownerOtherSite);

    expect(result).toBe(versionsPayload);
    expect(service.listVersions).toHaveBeenCalledWith(SESSION_ID);
  });

  it('(5) restoreVersion 도 동일 가드 경유 — 교차 테넌트 404, service.restoreVersion 미호출', async () => {
    const crossTenantCustomer = { userId: '777', role: 'customer', siteId: SITE_B };

    await expectSessionNotFound(
      controller.restoreVersion(SESSION_ID, VERSION_ID, crossTenantCustomer),
    );

    expect(service.restoreVersion).not.toHaveBeenCalled();
    expect(service.toResponseDto).not.toHaveBeenCalled();
  });

  it('(5-b) restoreVersion 같은 site 소유자 → 통과, userId 전달', async () => {
    const sameTenantOwner = { userId: '777', role: 'customer', siteId: SITE_A };

    const result = await controller.restoreVersion(SESSION_ID, VERSION_ID, sameTenantOwner);

    expect(service.restoreVersion).toHaveBeenCalledWith(SESSION_ID, VERSION_ID, 777);
    expect(result).toBe(restoredDto);
  });

  it('(6) 비소유자·비staff 는 site 와 무관하게 기존 403 PERMISSION_DENIED 유지', async () => {
    const stranger = { userId: '123', role: 'customer', siteId: SITE_A };

    await expect(controller.listVersions(SESSION_ID, stranger)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.listVersions).not.toHaveBeenCalled();
  });
});
