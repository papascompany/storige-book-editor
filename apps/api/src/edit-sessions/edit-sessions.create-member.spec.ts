/**
 * POST /edit-sessions — 세션 회원 번호 도출.
 *
 *  - shop-session 토큰: 토큰의 회원 번호(양의 정수만)로 세션을 만든다. 본문 memberSeqno 는 쓰지 않고,
 *    토큰과 다른 본문 값이면 관측 로그 1줄(번호 값 미기록). 토큰 회원 번호가 양의 정수가 아니면 400 MEMBER_REQUIRED.
 *  - admin-app staff(admin/manager/super_admin): 본문 memberSeqno, 없으면 토큰 회원 번호(양의 정수만), 둘 다 없으면 400.
 *  - 그 밖의 토큰(admin-app CUSTOMER·사이트 운영자 역할 등): 403 PERMISSION_DENIED, 세션 미생성.
 */
import { HttpException, Logger } from '@nestjs/common';
import { EditSessionsController } from './edit-sessions.controller';
import type { EditSessionsService } from './edit-sessions.service';
import type { CreateEditSessionDto } from './dto/create-edit-session.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const shopUser = (sub: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId: sub,
  role: 'customer',
  source: 'shop',
  siteId: SITE_A,
  ...extra,
});
/** admin-app JWT → JwtStrategy 가 User 엔티티를 그대로 반환(userId·source 없음). */
const adminAppUser = (role: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `admin-${role.toLowerCase()}`,
  email: `${role.toLowerCase()}@example.com`,
  role,
  ...extra,
});

async function httpError(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) {
      return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
    }
    throw e;
  }
  throw new Error('expected rejection');
}

describe('EditSessionsController.create — 세션 회원 번호', () => {
  let service: { create: jest.Mock; toResponseDto: jest.Mock };
  let controller: EditSessionsController;
  let logSpy: jest.SpyInstance;

  const dto = (extra: Partial<CreateEditSessionDto> = {}): CreateEditSessionDto =>
    ({ orderSeqno: 100, mode: 'both', ...extra }) as unknown as CreateEditSessionDto;
  const createdMember = (): unknown => (service.create.mock.calls[0][0] as { memberSeqno: unknown }).memberSeqno;
  const memberLogs = (): string[] =>
    logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('[session-create]'));

  beforeEach(() => {
    service = {
      create: jest.fn(async (input: Record<string, unknown>) => ({ id: 'new-session', ...input })),
      toResponseDto: jest.fn((s: unknown) => s),
    };
    controller = new EditSessionsController(service as unknown as EditSessionsService);
    logSpy = jest
      .spyOn((controller as unknown as { logger: Logger }).logger, 'log')
      .mockImplementation(() => undefined);
  });

  describe('shop-session 토큰', () => {
    it.each<[string, number | undefined]>([
      ['본문 없음', undefined],
      ['본문 0', 0],
      ['본문 = 토큰 회원', 123],
    ])('C1: 회원 123 + %s → 회원 123 세션, 관측 로그 없음', async (_l, bodySeqno) => {
      await controller.create(dto({ memberSeqno: bodySeqno }), shopUser('123'));
      expect(createdMember()).toBe(123);
      expect(service.create.mock.calls[0][0]).toMatchObject({ siteId: SITE_A });
      expect(memberLogs()).toEqual([]);
    });

    it('C2: 회원 123 + 본문 456 → 회원 123 세션, 관측 로그 1줄(번호 값 미기록)', async () => {
      await controller.create(dto({ memberSeqno: 456 }), shopUser('123'));
      expect(createdMember()).toBe(123);
      expect(memberLogs()).toEqual([`[session-create] body-member-ignored site=${SITE_A} token=member`]);
      for (const call of logSpy.mock.calls as unknown[][]) {
        expect(JSON.stringify(call)).not.toContain('456');
        expect(JSON.stringify(call)).not.toContain('123');
      }
    });

    it.each(['-5', '0', '1.5', '12abc', ''])(
      "C3: 토큰 sub '%s' + 본문 없음 → 400 MEMBER_REQUIRED, 세션 미생성",
      async (sub) => {
        const r = await httpError(controller.create(dto(), shopUser(sub)));
        expect(r.status).toBe(400);
        expect(r.body.code).toBe('MEMBER_REQUIRED');
        expect(service.create).not.toHaveBeenCalled();
      },
    );

    it("C4: 토큰 sub '0' + 본문 456 → 400 MEMBER_REQUIRED(본문 미사용), 관측 로그 token=non-member", async () => {
      const r = await httpError(controller.create(dto({ memberSeqno: 456 }), shopUser('0')));
      expect(r.body.code).toBe('MEMBER_REQUIRED');
      expect(service.create).not.toHaveBeenCalled();
      expect(memberLogs()).toEqual([`[session-create] body-member-ignored site=${SITE_A} token=non-member`]);
    });

    it('C5: 사이트 없는 토큰의 관측 로그는 site=-', async () => {
      await controller.create(dto({ memberSeqno: 456 }), { userId: '123', role: 'customer', source: 'shop' });
      expect(createdMember()).toBe(123);
      expect(memberLogs()).toEqual(['[session-create] body-member-ignored site=- token=member']);
    });

    it('C6: 주문권한 검사는 그대로 — allowedOrderSeqnos 밖 주문 → 403 ORDER_NOT_ALLOWED', async () => {
      const r = await httpError(
        controller.create(dto({ orderSeqno: 200 }), shopUser('123', { allowedOrderSeqnos: [100] })),
      );
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('ORDER_NOT_ALLOWED');
      expect(service.create).not.toHaveBeenCalled();
    });
  });

  describe('admin-app staff', () => {
    it.each(['ADMIN', 'MANAGER', 'SUPER_ADMIN', 'admin'])('S1: %s + 본문 789 → 회원 789 세션', async (role) => {
      await controller.create(dto({ memberSeqno: 789 }), adminAppUser(role));
      expect(createdMember()).toBe(789);
      expect(memberLogs()).toEqual([]);
    });

    it('S2: staff(userId 없음) + 본문 없음 → 400 MEMBER_REQUIRED', async () => {
      const r = await httpError(controller.create(dto(), adminAppUser('ADMIN')));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('MEMBER_REQUIRED');
      expect(service.create).not.toHaveBeenCalled();
    });

    it("S3: staff 토큰 userId '1.5' + 본문 없음 → 400 MEMBER_REQUIRED, userId '77' → 회원 77", async () => {
      const r = await httpError(controller.create(dto(), adminAppUser('ADMIN', { userId: '1.5' })));
      expect(r.body.code).toBe('MEMBER_REQUIRED');
      await controller.create(dto(), adminAppUser('ADMIN', { userId: '77' }));
      expect(createdMember()).toBe(77);
    });
  });

  describe('그 밖의 토큰', () => {
    it.each(['CUSTOMER', 'customer', 'SITE_ADMIN', 'SITE_MANAGER'])(
      'O1: admin-app %s + 본문 456 → 403 PERMISSION_DENIED, 세션 미생성',
      async (role) => {
        const r = await httpError(controller.create(dto({ memberSeqno: 456 }), adminAppUser(role)));
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('PERMISSION_DENIED');
        expect(service.create).not.toHaveBeenCalled();
      },
    );

    it('O2: 인증 컨텍스트 없음 → 403 PERMISSION_DENIED', async () => {
      const r = await httpError(controller.create(dto({ memberSeqno: 456 }), undefined));
      expect(r.status).toBe(403);
      expect(service.create).not.toHaveBeenCalled();
    });
  });
});
