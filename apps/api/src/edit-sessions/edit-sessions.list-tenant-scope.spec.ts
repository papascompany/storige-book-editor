/**
 * 목록 라우트 테넌트 격리 (2026-08-23) — GET /edit-sessions(orderSeqno/memberSeqno/siteId/self 분기) ·
 * GET /edit-sessions/my(기본/summary). 비-staff 는 자기 site(+레거시 NULL) 세션만, staff/worker/siteId 없는
 * JWT 는 기존 전량. 제외는 404 가 아닌 조용한 누락.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { EditSessionsController } from './edit-sessions.controller';
import { EditSessionsService } from './edit-sessions.service';
import { OptionalShopJwtGuard } from '../auth/guards/optional-shop-jwt.guard';
import { SitesService } from '../sites/sites.service';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mixed = [
  { id: 's-a', memberSeqno: 777, orderSeqno: 100, siteId: SITE_A },
  { id: 's-b', memberSeqno: 777, orderSeqno: 100, siteId: SITE_B },
  { id: 's-null', memberSeqno: 777, orderSeqno: 100, siteId: null },
];

describe('EditSessionsController 목록 라우트 테넌트 격리', () => {
  let controller: EditSessionsController;
  let service: jest.Mocked<EditSessionsService>;
  let warnSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'spec-secret' })],
      controllers: [EditSessionsController],
      providers: [
        OptionalShopJwtGuard,
        {
          provide: EditSessionsService,
          useValue: {
            isInTenantScope: (s: any, c: any) => EditSessionsService.prototype.isInTenantScope.call(null, s, c),
            findByOrderSeqno: jest.fn().mockResolvedValue(mixed),
            findByMemberSeqno: jest.fn().mockResolvedValue(mixed),
            findBySiteId: jest.fn().mockResolvedValue(mixed.filter((m) => m.siteId === SITE_A)),
            findMyRecent: jest.fn().mockResolvedValue(mixed),
            findMyRecentSummary: jest.fn().mockResolvedValue(mixed.map((m) => ({ ...m, templateSetName: null }))),
            toResponseDto: jest.fn((s: any) => ({ id: s.id, siteId: s.siteId })),
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
    warnSpy = jest.spyOn((controller as any).logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warnSpy.mockRestore());

  const ids = (r: { sessions: Array<{ id: string }> }) => r.sessions.map((s) => s.id);
  const customerA = { userId: '777', role: 'customer', siteId: SITE_A, allowedOrderSeqnos: [100] };

  it('orderSeqno 분기: site A 고객 → A + 레거시 NULL 만(타 site B 제외) + warn 1회', async () => {
    const r = await controller.findSessions('100', undefined, undefined, customerA);
    expect(ids(r)).toEqual(['s-a', 's-null']);
    expect(r.total).toBe(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain('[tenant-scope] list');
  });

  it('memberSeqno(본인) 분기·self 분기도 동일 필터', async () => {
    expect(ids(await controller.findSessions(undefined, '777', undefined, customerA))).toEqual(['s-a', 's-null']);
    expect(ids(await controller.findSessions(undefined, undefined, undefined, customerA))).toEqual(['s-a', 's-null']);
  });

  it('staff 는 전량(필터·warn 없음), siteId 없는 레거시 JWT 도 전량', async () => {
    expect(ids(await controller.findSessions('100', undefined, undefined, { role: 'ADMIN', siteId: SITE_B }))).toEqual(['s-a', 's-b', 's-null']);
    expect(ids(await controller.findSessions('100', undefined, undefined, { userId: '777', role: 'customer', allowedOrderSeqnos: [100] }))).toEqual(['s-a', 's-b', 's-null']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('siteId 쿼리 분기(자기 site): 필터 결과 불변 + 기존 taSite 거부 유지', async () => {
    expect(ids(await controller.findSessions(undefined, undefined, SITE_A, customerA))).toEqual(['s-a']);
    await expect(controller.findSessions(undefined, undefined, SITE_B, customerA)).rejects.toMatchObject({
      response: { code: 'FORBIDDEN_SITE_QUERY' },
    });
  });

  it('my: 기본·summary 모드 모두 타 site 세션 제외, staff 전량', async () => {
    expect(ids(await controller.findMy(customerA))).toEqual(['s-a', 's-null']);
    expect(ids(await controller.findMy(customerA, '1'))).toEqual(['s-a', 's-null']);
    expect(ids(await controller.findMy({ userId: '777', role: 'MANAGER', siteId: SITE_B }))).toEqual(['s-a', 's-b', 's-null']);
    expect(service.findMyRecentSummary).toHaveBeenCalledWith(777);
  });
});
