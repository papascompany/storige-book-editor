import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EditSessionsController } from './edit-sessions.controller';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { EditSessionsService } from './edit-sessions.service';
import { SessionStatus, SessionMode } from './entities/edit-session.entity';
import { SitesService } from '../sites/sites.service';

describe('EditSessionsController', () => {
  let controller: EditSessionsController;
  let service: jest.Mocked<EditSessionsService>;

  const mockExternalResponse = [
    {
      sessionId: 'session-uuid-1',
      orderSeqno: 12345,
      status: SessionStatus.COMPLETE,
      mode: SessionMode.SPREAD,
      files: {
        cover: '/storage/outputs/job-1/cover.pdf',
        content: '/storage/outputs/job-1/content.pdf',
        merged: '/storage/outputs/job-1/merged.pdf',
      },
      completedAt: new Date('2026-02-19T10:00:00Z'),
    },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      // POST /edit-sessions/guest 의 route-scoped OptionalShopJwtGuard 가 JwtService 를
      // 요구한다(2026-07-30 siteId 스탬프) — 프로덕션 EditSessionsModule 과 동일 배선.
      imports: [JwtModule.register({ secret: 'spec-secret' })],
      controllers: [EditSessionsController],
      providers: [
        OptionalShopJwtGuard,
        {
          provide: EditSessionsService,
          useValue: {
            findByOrderExternal: jest.fn().mockResolvedValue(mockExternalResponse),
            findByOrderSeqno: jest.fn(),
            findByMemberSeqno: jest.fn(),
            findBySiteId: jest.fn(),
            findMyRecent: jest.fn(),
            findMyRecentSummary: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            complete: jest.fn(),
            delete: jest.fn(),
            toResponseDto: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('test_api_key'),
          },
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

  describe('GET /edit-sessions/external', () => {
    it('정상 조회 - orderSeqno로 세션 목록 반환', async () => {
      // P2c: 컨트롤러가 @CurrentSite().siteId 를 2번째 인자로 전달(테스트엔 site 미주입 → undefined).
      const result = await controller.findByOrderExternal('12345', undefined);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockExternalResponse);
      expect(service.findByOrderExternal).toHaveBeenCalledWith(12345, undefined);
    });

    it('orderSeqno 파라미터 누락 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal(undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('orderSeqno 빈 문자열 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal('')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('orderSeqno 비숫자 - 400 Bad Request', async () => {
      await expect(controller.findByOrderExternal('abc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('세션 없음 - success: true, 빈 배열', async () => {
      service.findByOrderExternal.mockResolvedValue([]);

      const result = await controller.findByOrderExternal('99999');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ── IDOR 가드 (2026-06-11): GET /edit-sessions?memberSeqno=X ──
  // admin/manager 가 아니면 본인 memberSeqno 만 허용, 타인은 403.
  describe('GET /edit-sessions (memberSeqno IDOR 가드)', () => {
    // 실제 admin-app JWT 의 role 은 UserRole enum **대문자**('ADMIN'/'MANAGER') —
    // 소문자 비교는 admin 검색 403 회귀를 만들었으므로(2026-06-11 수정) 실값으로 검증.
    const adminUser = { role: 'ADMIN' }; // admin-app User 엔티티 (userId 없음)
    const managerUser = { role: 'MANAGER' };
    const shopUser = { userId: '100', role: 'customer', source: 'shop' };

    beforeEach(() => {
      service.findByMemberSeqno.mockResolvedValue([]);
      service.toResponseDto.mockReturnValue({} as any);
    });

    it('admin 은 타인 memberSeqno 조회 허용', async () => {
      const result = await controller.findSessions(undefined, '200', undefined, adminUser);

      expect(service.findByMemberSeqno).toHaveBeenCalledWith(200);
      expect(result.total).toBe(0);
    });

    it('manager 도 타인 memberSeqno 조회 허용', async () => {
      await controller.findSessions(undefined, '200', undefined, managerUser);

      expect(service.findByMemberSeqno).toHaveBeenCalledWith(200);
    });

    it('일반 사용자(shop customer)가 타인 memberSeqno 조회 시 403 FORBIDDEN_MEMBER_QUERY', async () => {
      await expect(
        controller.findSessions(undefined, '200', undefined, shopUser),
      ).rejects.toThrow(ForbiddenException);
      expect(service.findByMemberSeqno).not.toHaveBeenCalled();
    });

    it('일반 사용자 본인 memberSeqno 조회는 허용', async () => {
      await controller.findSessions(undefined, '100', undefined, shopUser);

      expect(service.findByMemberSeqno).toHaveBeenCalledWith(100);
    });
  });

  // ── F-1 (2026-07-30): POST /edit-sessions/guest 는 @Public — body 는 무인증 임의 입력 ──
  // dto.siteId 를 그대로 신뢰하면 누구나 임의 테넌트 스탬프 세션을 심을 수 있고,
  // 그 세션이 곧 파트너 승격(교차테넌트 IDOR) 대상이 된다.
  describe('POST /edit-sessions/guest — dto.siteId 위조 통로 차단(F-1)', () => {
    beforeEach(() => {
      service.create.mockResolvedValue({ id: 'sess-new' } as any);
      service.toResponseDto.mockReturnValue({ id: 'sess-new' } as any);
    });

    it('T1 공격: body 에 피해자 siteId 를 실어도 service 에 전달되지 않는다', async () => {
      await controller.createGuest(
        { mode: SessionMode.SPREAD, siteId: 'victim-site-uuid' } as any,
        undefined, // 인증 컨텍스트 없음 = 무인증 공격자
      );

      const passed = service.create.mock.calls[0][0];
      expect(passed.siteId).toBeUndefined();
      // 게스트 계약(무중단) — 나머지 스탬프는 종전 그대로
      expect(passed.asGuest).toBe(true);
      expect(passed.memberSeqno).toBe(0);
      expect(passed.orderSeqno).toBe(0);
    });

    it('siteId 미전송(정상 클라이언트)도 종전대로 생성된다', async () => {
      await controller.createGuest({ mode: SessionMode.SPREAD } as any, undefined);

      const passed = service.create.mock.calls[0][0];
      expect(passed.siteId).toBeUndefined();
    });

    // ── 스탬프 도출 분기표 (I-1) — 근거는 "검증된 shop-session JWT" 하나뿐 ──
    it('검증된 shop 컨텍스트가 있으면 그 siteId 로 스탬프한다', async () => {
      await controller.createGuest({ mode: SessionMode.SPREAD } as any, {
        source: 'shop',
        siteId: 'site-a',
      });

      expect(service.create.mock.calls[0][0].siteId).toBe('site-a');
    });

    it('body siteId 는 shop 컨텍스트가 있어도 무시된다(JWT 가 이긴다)', async () => {
      await controller.createGuest(
        { mode: SessionMode.SPREAD, siteId: 'site-b' } as any,
        { source: 'shop', siteId: 'site-a' },
      );

      expect(service.create.mock.calls[0][0].siteId).toBe('site-a');
    });

    it('source!=="shop" 컨텍스트는 스탬프 근거가 아니다 → NULL 유지', async () => {
      await controller.createGuest({ mode: SessionMode.SPREAD } as any, {
        source: 'admin',
        siteId: 'site-a',
      });

      expect(service.create.mock.calls[0][0].siteId).toBeUndefined();
    });
  });

  // ── 편집보관함 경량(summary) 모드 (2026-06-11): GET /edit-sessions/my?summary=1 ──
  describe('GET /edit-sessions/my (summary 경량 모드)', () => {
    const shopUser = { userId: '100', role: 'customer', source: 'shop' };

    it("summary='1' 시 경량 매퍼 사용 — canvasData 부재 + templateSetName 포함", async () => {
      service.findMyRecentSummary.mockResolvedValue([
        {
          id: 'session-1',
          templateSetName: 'A4 기본 책자',
          thumbnailUrl: '/storage/thumbs/f-1.png',
        } as any,
      ]);

      const result = await controller.findMy(shopUser, '1');

      expect(service.findMyRecentSummary).toHaveBeenCalledWith(100);
      expect(service.findMyRecent).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.sessions[0]).not.toHaveProperty('canvasData');
      expect(result.sessions[0].templateSetName).toBe('A4 기본 책자');
      expect(result.sessions[0].thumbnailUrl).toBe('/storage/thumbs/f-1.png');
    });

    it('summary 미지정 시 기존(canvasData 전문 포함) 경로 불변', async () => {
      service.findMyRecent.mockResolvedValue([{ id: 'session-1' } as any]);
      service.toResponseDto.mockReturnValue({
        id: 'session-1',
        canvasData: { objects: [] },
      } as any);

      const result = await controller.findMy(shopUser, undefined);

      expect(service.findMyRecent).toHaveBeenCalledWith(100);
      expect(service.findMyRecentSummary).not.toHaveBeenCalled();
      expect(result.sessions[0].canvasData).toEqual({ objects: [] });
    });
  });
});
