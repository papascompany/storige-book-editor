/**
 * 파트너 서버 간 편집 세션 소유자 배치 조회 (ADDITIVE 2026-09-30)
 * POST /api/partner/edit-sessions/owners
 *
 *  - DTO: 소문자 UUID 1~50개, 대문자·형식 오류·추가 필드 400 (정규화하지 않음)
 *  - 서비스: 단일 IN 쿼리, 호출 사이트 엄격 일치, 입력 순서·길이 유지, found:false 단일 shape,
 *            게스트 memberSeqno=null, 게스트 orderSeqno 0 → null(회원 세션은 저장값 그대로)
 *  - 컨트롤러: 사이트 편집기 키만(403 PARTNER_SITE_KEY_REQUIRED), 본문 siteId 불채택
 *  - 한도: 사이트 키당 120/min(전역 per-IP 300/min 과 별개 버킷)
 */
import 'reflect-metadata';
import { HttpException, INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { SitesService } from '../sites/sites.service';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { assertPartnerOperatorSiteCaller } from '../auth/partner-operator/partner-operator-grant.service';
import { EditSessionsModule } from './edit-sessions.module';
import { EditSessionEntity } from './entities/edit-session.entity';
import {
  PartnerEditSessionsController,
  PARTNER_OWNERS_RATE,
  assertOwnersSiteCaller,
} from './partner-edit-sessions.controller';
import {
  PARTNER_OWNERS_SQL,
  PartnerEditSessionOwnersService,
} from './partner-edit-session-owners.service';
import {
  LOWER_UUID_RE,
  PARTNER_OWNERS_MAX,
  PartnerSessionOwnerDto,
} from './dto/partner-session-owners.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S_MEMBER = '11111111-1111-4111-8111-111111111111';
const S_GUEST = '22222222-2222-4222-8222-222222222222';
const S_TOKEN = '33333333-3333-4333-8333-333333333333';
const S_MISSING = '44444444-4444-4444-8444-444444444444';
/** 영문 16진 문자를 포함한 id — 대문자 거부 검증용 */
const S_HEX = 'abcdef12-3456-4789-8abc-def012345678';

const uuid = (i: number): string =>
  `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;

interface Row {
  id: string;
  memberSeqno: unknown;
  orderSeqno: unknown;
  status: string;
  hasGuestToken: unknown;
}

const memberRow: Row = { id: S_MEMBER, memberSeqno: '777', orderSeqno: '9001', status: 'editing', hasGuestToken: 0 };
const guestRow: Row = { id: S_GUEST, memberSeqno: '0', orderSeqno: '0', status: 'draft', hasGuestToken: 1 };
const tokenRow: Row = { id: S_TOKEN, memberSeqno: '555', orderSeqno: 12, status: 'complete', hasGuestToken: '1' };

const NOT_FOUND = (sessionId: string): PartnerSessionOwnerDto => ({
  sessionId,
  found: false,
  memberSeqno: null,
  guest: false,
  orderSeqno: null,
  status: null,
});

const site = (extra: Partial<CurrentSitePayload> = {}): CurrentSitePayload => ({
  siteId: SITE_A,
  siteName: 'Site A',
  role: 'editor',
  apiKey: 'k',
  ...extra,
});

describe('B1 — 파트너 세션 소유자 배치 조회', () => {
  // ───────────────── 서비스 ─────────────────
  describe('PartnerEditSessionOwnersService', () => {
    let query: jest.Mock;
    let service: PartnerEditSessionOwnersService;

    beforeEach(() => {
      query = jest.fn().mockResolvedValue([]);
      service = new PartnerEditSessionOwnersService({ manager: { query } } as never);
    });

    it('쿼리 1회 — IN·사이트 엄격 일치·삭제 제외·게스트 토큰은 존재 여부만, 파라미터 = [중복 제거 id, siteId]', async () => {
      await service.lookup(SITE_A, [S_MEMBER, S_GUEST, S_MEMBER]);
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0] as [string, unknown[]];
      expect(sql).toBe(PARTNER_OWNERS_SQL);
      expect(sql).toContain('IN (?)');
      expect(sql).toContain('s.site_id = ?');
      expect(sql).toContain('s.deleted_at IS NULL');
      expect(sql).toContain('guest_token IS NOT NULL');
      expect(sql).not.toMatch(/guest_token\s+AS/i);
      expect(sql).not.toMatch(/s\.site_id\s+AS/i);
      expect(sql).not.toMatch(/site_id IS NULL/i);
      expect(params).toEqual([[S_MEMBER, S_GUEST], SITE_A]);
    });

    it('응답 순서·길이 = 입력(존재·부재 교차)', async () => {
      query.mockResolvedValue([guestRow, memberRow]);
      const out = await service.lookup(SITE_A, [S_MISSING, S_MEMBER, S_GUEST]);
      expect(out.map((o) => o.sessionId)).toEqual([S_MISSING, S_MEMBER, S_GUEST]);
      expect(out.map((o) => o.found)).toEqual([false, true, true]);
    });

    it('중복 id → 쿼리 1회·id 1번, 응답은 입력 횟수만큼 같은 결과', async () => {
      query.mockResolvedValue([memberRow]);
      const out = await service.lookup(SITE_A, [S_MEMBER, S_MEMBER, S_MEMBER]);
      expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([[S_MEMBER], SITE_A]);
      expect(out).toHaveLength(3);
      expect(out[0]).toStrictEqual(out[1]);
      expect(out[1]).toStrictEqual(out[2]);
    });

    it('다른 사이트·무소속·삭제·없음(쿼리 결과 부재) → 모두 같은 found:false 객체', async () => {
      query.mockResolvedValue([]);
      const out = await service.lookup(SITE_A, [S_MEMBER, S_MISSING]);
      expect(out[0]).toStrictEqual(NOT_FOUND(S_MEMBER));
      expect(out[1]).toStrictEqual(NOT_FOUND(S_MISSING));
    });

    it('회원 세션: bigint 문자열 → number, guest:false, status 통과', async () => {
      query.mockResolvedValue([memberRow]);
      const [o] = await service.lookup(SITE_A, [S_MEMBER]);
      expect(o).toStrictEqual({
        sessionId: S_MEMBER,
        found: true,
        memberSeqno: 777,
        guest: false,
        orderSeqno: 9001,
        status: 'editing',
      });
    });

    it('게스트(memberSeqno 0) → guest:true, memberSeqno:null, orderSeqno 0 → null', async () => {
      query.mockResolvedValue([guestRow]);
      const [o] = await service.lookup(SITE_A, [S_GUEST]);
      expect(o).toStrictEqual({
        sessionId: S_GUEST,
        found: true,
        memberSeqno: null,
        guest: true,
        orderSeqno: null,
        status: 'draft',
      });
    });

    it('회원 세션 orderSeqno 0 → 0 그대로(정규화는 게스트 세션만)', async () => {
      query.mockResolvedValue([{ ...memberRow, orderSeqno: '0' }]);
      const [o] = await service.lookup(SITE_A, [S_MEMBER]);
      expect(o.guest).toBe(false);
      expect(o.memberSeqno).toBe(777);
      expect(o.orderSeqno).toBe(0);
    });

    it('게스트 토큰 보유 세션의 orderSeqno 0 → null', async () => {
      query.mockResolvedValue([{ ...tokenRow, orderSeqno: 0 }]);
      const [o] = await service.lookup(SITE_A, [S_TOKEN]);
      expect(o.guest).toBe(true);
      expect(o.orderSeqno).toBeNull();
    });

    it('게스트 토큰 보유(memberSeqno>0 경계) → guest:true, memberSeqno:null', async () => {
      query.mockResolvedValue([tokenRow]);
      const [o] = await service.lookup(SITE_A, [S_TOKEN]);
      expect(o.guest).toBe(true);
      expect(o.memberSeqno).toBeNull();
      expect(o.orderSeqno).toBe(12);
      expect(o.status).toBe('complete');
    });

    it('응답 객체 키는 정확히 6개(게스트 토큰·사이트 없음)', async () => {
      query.mockResolvedValue([memberRow, guestRow]);
      const out = await service.lookup(SITE_A, [S_MEMBER, S_GUEST, S_MISSING]);
      for (const o of out) {
        expect(Object.keys(o).sort()).toEqual(
          ['found', 'guest', 'memberSeqno', 'orderSeqno', 'sessionId', 'status'],
        );
      }
    });
  });

  // ───────────────── 컨트롤러(단위) ─────────────────
  describe('PartnerEditSessionsController', () => {
    let lookup: jest.Mock;
    let controller: PartnerEditSessionsController;

    beforeEach(() => {
      lookup = jest.fn().mockResolvedValue([]);
      controller = new PartnerEditSessionsController({ lookup } as unknown as PartnerEditSessionOwnersService);
    });

    it.each([
      ['사이트 없음', undefined],
      ['내부 워커 키(role worker)', site({ role: 'worker' })],
      ['siteId 빈 값', site({ siteId: '' })],
    ])('%s → 403 PARTNER_SITE_KEY_REQUIRED, 서비스 미호출', async (_l, s) => {
      let caught: unknown;
      try {
        await controller.lookupOwners({ sessionIds: [S_MEMBER] }, s);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HttpException);
      const err = caught as HttpException;
      expect(err.getStatus()).toBe(403);
      expect((err.getResponse() as { code: string }).code).toBe('PARTNER_SITE_KEY_REQUIRED');
      expect(lookup).not.toHaveBeenCalled();
    });

    it('서비스에 가드가 도출한 site.siteId 만 전달', async () => {
      await controller.lookupOwners({ sessionIds: [S_MEMBER, S_GUEST] }, site({ siteId: SITE_B }));
      expect(lookup).toHaveBeenCalledWith(SITE_B, [S_MEMBER, S_GUEST]);
    });

    it('호출자 조건이 운영자 권한 라우트와 같다(워커 키·사이트 없음 → 거부, 편집기 키 → 통과)', () => {
      const cases: Array<CurrentSitePayload | undefined> = [
        site({ role: 'worker' }),
        undefined,
        site(),
      ];
      for (const c of cases) {
        const ours = (() => {
          try {
            assertOwnersSiteCaller(c);
            return 'pass';
          } catch (e) {
            return (e as HttpException).getStatus();
          }
        })();
        const operatorRoute = (() => {
          try {
            assertPartnerOperatorSiteCaller(c);
            return 'pass';
          } catch (e) {
            return (e as HttpException).getStatus();
          }
        })();
        expect(ours).toBe(operatorRoute);
      }
      expect(() => assertOwnersSiteCaller(site())).not.toThrow();
    });

    it('라우트 메타데이터 — prefix·경로·POST·200', () => {
      expect(Reflect.getMetadata(PATH_METADATA, PartnerEditSessionsController)).toBe('partner/edit-sessions');
      const h = PartnerEditSessionsController.prototype.lookupOwners;
      expect(Reflect.getMetadata(PATH_METADATA, h)).toBe('owners');
      expect(Reflect.getMetadata(METHOD_METADATA, h)).toBe(RequestMethod.POST);
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, h)).toBe(200);
    });

    it('모듈 배선 — EditSessionsModule controllers·providers 등록', () => {
      const controllers = (Reflect.getMetadata('controllers', EditSessionsModule) ?? []) as unknown[];
      const providers = (Reflect.getMetadata('providers', EditSessionsModule) ?? []) as unknown[];
      expect(controllers).toContain(PartnerEditSessionsController);
      expect(providers).toContain(PartnerEditSessionOwnersService);
    });

    it('상수 — 최대 50개·소문자 UUID', () => {
      expect(PARTNER_OWNERS_MAX).toBe(50);
      expect(LOWER_UUID_RE.test(S_MEMBER)).toBe(true);
      expect(LOWER_UUID_RE.test(S_HEX)).toBe(true);
      expect(LOWER_UUID_RE.test(S_HEX.toUpperCase())).toBe(false);
    });
  });

  // ───────────────── HTTP (가드·검증·한도) ─────────────────
  describe('HTTP — POST /api/partner/edit-sessions/owners', () => {
    const INTERNAL_WORKER_KEY = 'spec-internal-worker-key';
    const prevWorkerKey = process.env.WORKER_API_KEY;
    let app: INestApplication;
    const query = jest.fn();

    beforeAll(async () => {
      process.env.WORKER_API_KEY = INTERNAL_WORKER_KEY;
      const moduleRef = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }])],
        controllers: [PartnerEditSessionsController],
        providers: [
          PartnerEditSessionOwnersService,
          { provide: getRepositoryToken(EditSessionEntity), useValue: { manager: { query } } },
          {
            provide: SitesService,
            useValue: {
              // key-* → 각자 독립 사이트, 내부 워커 키 → 기본 사이트(role 은 가드가 worker 로 판정)
              findByEditorAuthCode: async (code: string) =>
                code.startsWith('key-')
                  ? { id: `site-${code}`, name: code, retentionDays: null }
                  : code === INTERNAL_WORKER_KEY
                    ? { id: 'site-default', name: 'default', retentionDays: null }
                    : null,
              findByWorkerAuthCode: async () => null,
            },
          },
          // 운영과 같은 전역 per-IP ThrottlerGuard(APP_GUARD) 병존
          { provide: APP_GUARD, useClass: ThrottlerGuard },
        ],
      }).compile();
      app = moduleRef.createNestApplication();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
      );
      await app.init();
    });

    afterAll(async () => {
      await app.close();
      if (prevWorkerKey === undefined) delete process.env.WORKER_API_KEY;
      else process.env.WORKER_API_KEY = prevWorkerKey;
    });

    beforeEach(() => {
      query.mockReset();
      query.mockResolvedValue([]);
    });

    const post = (key: string | null, body: unknown) => {
      const r = request(app.getHttpServer()).post('/api/partner/edit-sessions/owners');
      return (key ? r.set('X-API-Key', key) : r).send(body as object);
    };

    it('정상 → 200 최상위 배열(입력 순서·길이), 쿼리 사이트 = 키의 사이트', async () => {
      query.mockResolvedValue([memberRow]);
      const res = await post('key-ok', { sessionIds: [S_MISSING, S_MEMBER] }).expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toEqual([NOT_FOUND(S_MISSING), expect.objectContaining({ sessionId: S_MEMBER, found: true })]);
      expect((query.mock.calls[0] as [string, unknown[]])[1]).toEqual([[S_MISSING, S_MEMBER], 'site-key-ok']);
    });

    it('소문자 UUID 1개·50개 → 200', async () => {
      await post('key-ok', { sessionIds: [S_MEMBER] }).expect(200);
      const fifty = Array.from({ length: 50 }, (_, i) => uuid(i));
      const res = await post('key-ok', { sessionIds: fifty }).expect(200);
      expect(res.body).toHaveLength(50);
    });

    it.each([
      ['빈 배열', { sessionIds: [] }],
      ['51개', { sessionIds: Array.from({ length: 51 }, (_, i) => uuid(i)) }],
      ['sessionIds 누락', {}],
      ['배열 아님', { sessionIds: S_MEMBER }],
      ['대문자 UUID', { sessionIds: [S_HEX.toUpperCase()] }],
      ['대소문자 혼합 UUID', { sessionIds: [S_HEX, 'ABCDEF12-3456-4789-8abc-def012345678'] }],
      ['비UUID', { sessionIds: ['not-a-uuid'] }],
      ['숫자 원소', { sessionIds: [123] }],
      ['null 원소', { sessionIds: [null] }],
      ['추가 필드(siteId)', { sessionIds: [S_MEMBER], siteId: SITE_B }],
    ])('%s → 400, 쿼리 없음', async (_l, body) => {
      await post('key-ok', body).expect(400);
      expect(query).not.toHaveBeenCalled();
    });

    it('키 없음·무효 키 → 401', async () => {
      await post(null, { sessionIds: [S_MEMBER] }).expect(401);
      await post('nope', { sessionIds: [S_MEMBER] }).expect(401);
      expect(query).not.toHaveBeenCalled();
    });

    it('내부 워커 키 → 403 PARTNER_SITE_KEY_REQUIRED', async () => {
      const res = await post(INTERNAL_WORKER_KEY, { sessionIds: [S_MEMBER] }).expect(403);
      expect(res.body.code).toBe('PARTNER_SITE_KEY_REQUIRED');
      expect(query).not.toHaveBeenCalled();
    });

    it(`사이트 키당 ${PARTNER_OWNERS_RATE.limit}/min — 초과 시 429 + Retry-After, 다른 키는 같은 IP 에서도 별도 버킷`, async () => {
      const body = { sessionIds: [S_MEMBER] };
      for (let i = 0; i < PARTNER_OWNERS_RATE.limit; i++) {
        await post('key-busy', body).expect(200);
      }
      const blocked = await post('key-busy', body).expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      await post('key-other', body).expect(200);
    });
  });
});
