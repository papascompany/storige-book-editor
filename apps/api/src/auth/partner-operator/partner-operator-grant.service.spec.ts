/**
 * 운영자 대리 편집 권한 서비스 (2026-09-29, ADDITIVE) — 발급·갱신·권한 행 확인·취소·감사 조회.
 *
 * 저장소는 모두 mock. 토큰은 실제 JwtService 로 서명·검증해 클레임을 확인한다.
 * 테스트 키 문자열은 임의 값이며 운영 키가 아니다.
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';
import { Site } from '../../sites/entities/site.entity';
import { PartnerOperatorGrantEntity } from '../entities/partner-operator-grant.entity';
import { PartnerOperatorAuditLogEntity } from '../entities/partner-operator-audit-log.entity';
import type { CurrentSitePayload } from '../decorators/current-site.decorator';
import { CreatePartnerOperatorSessionDto } from '../dto/partner-operator-session.dto';
import {
  PartnerOperatorGrantService,
  assertPartnerOperatorSiteCaller,
  keyFingerprint,
} from './partner-operator-grant.service';
import { PartnerOperatorAuditWriter, isStaffEditAfterCompletion } from './partner-operator-audit.writer';
import {
  ACCESS_MAX,
  PartnerOperatorGrant,
  grantFromClaims,
  isPartnerOperatorClaims,
} from './partner-operator.types';
import { User } from '../entities/user.entity';
import { UserSiteRole } from '../entities/user-site-role.entity';

const SECRET = 'partner-operator-grant-spec';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const S3 = '33333333-3333-4333-8333-333333333333';
const KEY_A = 'test-editor-key-site-a';
const KEY_A_WORKER = 'test-worker-key-site-a';

type SessionRow = Pick<EditSessionEntity, 'id' | 'siteId' | 'memberSeqno' | 'guestExpiresAt'>;

interface ActiveRow {
  id: string;
  siteId: string;
  operatorId: string;
  sessionIds: unknown;
  capabilities: string;
  keyFp: string;
  expiresAtUnix: string | number;
  revokedAt: Date | null;
  origin: string;
  siteStatus: string;
  editorCode: string;
  workerCode: string;
}

interface QbMock {
  innerJoin: jest.Mock;
  select: jest.Mock;
  addSelect: jest.Mock;
  where: jest.Mock;
  getRawOne: jest.Mock;
}

function qbReturning(result: ActiveRow | undefined | Error): QbMock {
  const qb: QbMock = {
    innerJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    getRawOne: jest.fn(),
  };
  qb.innerJoin.mockReturnValue(qb);
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  if (result instanceof Error) qb.getRawOne.mockRejectedValue(result);
  else qb.getRawOne.mockResolvedValue(result);
  return qb;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

const siteA = (extra: Partial<CurrentSitePayload> = {}): CurrentSitePayload => ({
  siteId: SITE_A,
  siteName: 'Site A',
  role: 'editor',
  apiKey: KEY_A,
  ...extra,
});

const mintDto = (extra: Partial<CreatePartnerOperatorSessionDto> = {}): CreatePartnerOperatorSessionDto =>
  Object.assign(new CreatePartnerOperatorSessionDto(), {
    operatorId: 'op-7f3c',
    operatorName: '운영팀',
    sessionIds: [S1],
    ...extra,
  });

async function codeOf(p: Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
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

describe('PartnerOperatorGrantService', () => {
  const jwt = new JwtService({ secret: SECRET });
  let sessionRepo: { find: jest.Mock };
  let grantRepo: { insert: jest.Mock; update: jest.Mock; find: jest.Mock; createQueryBuilder: jest.Mock };
  let siteRepo: { findOne: jest.Mock };
  let audit: { recordOrThrow: jest.Mock; recordBestEffort: jest.Mock; list: jest.Mock };
  let service: PartnerOperatorGrantService;

  const sessions = (rows: SessionRow[]): void => {
    sessionRepo.find.mockResolvedValue(rows);
  };
  const row = (id: string, siteId: string | null, memberSeqno = 777, guestExpiresAt: Date | null = null): SessionRow =>
    ({ id, siteId, memberSeqno, guestExpiresAt }) as SessionRow;

  beforeEach(() => {
    sessionRepo = { find: jest.fn().mockResolvedValue([row(S1, SITE_A)]) };
    grantRepo = {
      insert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };
    siteRepo = { findOne: jest.fn().mockResolvedValue({ id: SITE_A, status: 'active' }) };
    audit = {
      recordOrThrow: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    };
    service = new PartnerOperatorGrantService(
      jwt,
      sessionRepo as unknown as Repository<EditSessionEntity>,
      grantRepo as unknown as Repository<PartnerOperatorGrantEntity>,
      siteRepo as unknown as Repository<Site>,
      audit as unknown as PartnerOperatorAuditWriter,
    );
  });

  // ─────────────────────────────── mint: 호출자·범위 ───────────────────────────────
  describe('mint — 호출자·범위 검사', () => {
    it.each([
      ['sessionIds 누락', undefined],
      ['빈 sessionIds', [] as string[]],
    ])('%s → 400 PARTNER_OPERATOR_SCOPE_REQUIRED (권한 행·토큰 없음)', async (_l, ids) => {
      const r = await codeOf(service.mint(mintDto({ sessionIds: ids }), siteA()));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('PARTNER_OPERATOR_SCOPE_REQUIRED');
      expect(grantRepo.insert).not.toHaveBeenCalled();
    });

    it.each([
      ['worker 역할 키(내부 워커)', siteA({ role: 'worker' })],
      ['사이트 없는 호출(JWT/브라우저 등 CurrentSite 부재)', undefined],
      ['siteId 빈 값', siteA({ siteId: '' })],
      ['키 원문 부재(지문 계산 불가)', siteA({ apiKey: '' })],
    ])('%s → 403 PARTNER_OPERATOR_SITE_REQUIRED', async (_l, site) => {
      const r = await codeOf(service.mint(mintDto(), site));
      expect(r.status).toBe(403);
      expect(r.body.code).toBe('PARTNER_OPERATOR_SITE_REQUIRED');
      expect(sessionRepo.find).not.toHaveBeenCalled();
      expect(grantRepo.insert).not.toHaveBeenCalled();
    });

    it('운영중지(suspended) 사이트 → 403, 사이트 행 없음 → 403', async () => {
      siteRepo.findOne.mockResolvedValueOnce({ id: SITE_A, status: 'suspended' });
      expect((await codeOf(service.mint(mintDto(), siteA()))).status).toBe(403);
      siteRepo.findOne.mockResolvedValueOnce(null);
      expect((await codeOf(service.mint(mintDto(), siteA()))).status).toBe(403);
      expect(grantRepo.insert).not.toHaveBeenCalled();
    });

    it('사이트 조회는 id·status 만 선택한다(인증코드 비선택)', async () => {
      await service.mint(mintDto(), siteA());
      expect(siteRepo.findOne).toHaveBeenCalledWith({ where: { id: SITE_A }, select: ['id', 'status'] });
    });

    it.each([
      ['다른 사이트 세션', [row(S1, SITE_B)]],
      ['NULL-site(레거시) 세션', [row(S1, null)]],
      ['존재하지 않거나 soft delete 된 세션(조회 결과 없음)', [] as SessionRow[]],
      ['보관기간이 지난 비회원 세션', [row(S1, SITE_A, 0, new Date(Date.now() - 1000))]],
    ])('%s → 동일한 404 SESSION_NOT_FOUND 본문(사유·id 비노출)', async (_l, rows) => {
      sessions(rows);
      const r = await codeOf(service.mint(mintDto(), siteA()));
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ code: 'SESSION_NOT_FOUND', message: '편집 세션을 찾을 수 없습니다.' });
      expect(grantRepo.insert).not.toHaveBeenCalled();
    });

    it('여러 세션 중 하나라도 범위 밖이면 전체 404', async () => {
      sessions([row(S1, SITE_A), row(S2, SITE_B)]);
      const r = await codeOf(service.mint(mintDto({ sessionIds: [S1, S2] }), siteA()));
      expect(r.status).toBe(404);
    });

    it('세션 조회는 In() + id·siteId·memberSeqno·guestExpiresAt 만 선택', async () => {
      await service.mint(mintDto(), siteA());
      const arg = sessionRepo.find.mock.calls[0][0] as { select: string[] };
      expect(arg.select).toEqual(['id', 'siteId', 'memberSeqno', 'guestExpiresAt']);
    });
  });

  // ─────────────────────────────── mint: 클레임 ───────────────────────────────
  describe('mint — 토큰·권한 행·감사 행', () => {
    it('obo: 모든 범위 세션이 같은 회원(>0)일 때만 설정', async () => {
      sessions([row(S1, SITE_A, 777), row(S2, SITE_A, 777)]);
      const same = await service.mint(mintDto({ sessionIds: [S1, S2] }), siteA());
      expect((jwt.verify(same.accessToken) as Record<string, unknown>).obo).toBe(777);

      sessions([row(S1, SITE_A, 777), row(S2, SITE_A, 888)]);
      const mixed = await service.mint(mintDto({ sessionIds: [S1, S2] }), siteA());
      expect((jwt.verify(mixed.accessToken) as Record<string, unknown>).obo).toBeUndefined();

      sessions([row(S1, SITE_A, 0)]);
      const guest = await service.mint(mintDto(), siteA());
      expect((jwt.verify(guest.accessToken) as Record<string, unknown>).obo).toBeUndefined();
    });

    it("caps 기본 ['edit'], allowDelete:true → ['edit','delete']", async () => {
      const a = await service.mint(mintDto(), siteA());
      expect(a.capabilities).toEqual(['edit']);
      expect((jwt.verify(a.accessToken) as Record<string, unknown>).caps).toEqual(['edit']);
      const b = await service.mint(mintDto({ allowDelete: true }), siteA());
      expect(b.capabilities).toEqual(['edit', 'delete']);
      expect(grantRepo.insert.mock.calls[1][0].capabilities).toBe('edit,delete');
    });

    it('클레임: sub po:, typ/source/role partner_operator, 고객 권한 필드 없음, exp 상한', async () => {
      const now = nowSec();
      const res = await service.mint(mintDto({ ttlSeconds: 3600 }), siteA(), now);
      const access = jwt.verify(res.accessToken) as Record<string, unknown>;
      const refresh = jwt.verify(res.refreshToken) as Record<string, unknown>;
      const gexp = now + 3600;

      for (const c of [access, refresh]) {
        expect(c.sub).toBe('po:op-7f3c');
        expect(Number.isFinite(Number(c.sub))).toBe(false);
        expect(c.typ).toBe('partner_operator');
        expect(c.source).toBe('partner_operator');
        expect(c.role).toBe('partner_operator');
        expect(c.siteId).toBe(SITE_A);
        expect(c.sids).toEqual([S1]);
        expect(c.gid).toBe(res.grantId);
        expect(c.gexp).toBe(gexp);
        expect(c).not.toHaveProperty('permissions');
        expect(c).not.toHaveProperty('allowedOrderSeqnos');
        expect(c).not.toHaveProperty('email');
      }
      expect(access.tu).toBe('access');
      expect(refresh.tu).toBe('refresh');
      expect(access.exp as number).toBeLessThanOrEqual(Math.min(now + ACCESS_MAX, gexp));
      expect(refresh.exp).toBe(gexp);
      expect(res.expiresIn).toBe(ACCESS_MAX);
      expect(res.grantExpiresAt).toBe(new Date(gexp * 1000).toISOString());
      expect(res.scope).toEqual({ sessionIds: [S1] });
      expect(res.operator).toEqual({ id: 'op-7f3c', name: '운영팀' });
    });

    it('파트너 발급: 클레임에 org 없음(토큰 키 집합 불변) + 권한 행 origin partner·발급자 없음', async () => {
      const res = await service.mint(mintDto(), siteA());
      for (const t of [res.accessToken, res.refreshToken]) {
        const c = jwt.verify(t) as Record<string, unknown>;
        expect(c).not.toHaveProperty('org');
        expect(Object.keys(c).sort()).toEqual(
          ['caps', 'exp', 'gexp', 'gid', 'iat', 'name', 'obo', 'opId', 'opName', 'role', 'sids', 'siteId', 'siteName', 'source', 'sub', 'tu', 'typ'].sort(),
        );
      }
      const inserted = grantRepo.insert.mock.calls[0][0] as PartnerOperatorGrantEntity;
      expect(inserted.origin).toBe('partner');
      expect(inserted.issuedByUserId).toBeNull();
      const entry = audit.recordOrThrow.mock.calls[0][0] as Record<string, unknown>;
      expect(entry).not.toHaveProperty('origin');
      expect(grantFromClaims(jwt.verify(res.accessToken), 'access')?.origin).toBe('partner');
    });

    it('짧은 권한(5분)이면 액세스 exp 도 권한 만료를 넘지 않는다', async () => {
      const now = nowSec();
      const res = await service.mint(mintDto({ ttlSeconds: 300 }), siteA(), now);
      const access = jwt.verify(res.accessToken) as Record<string, unknown>;
      expect(access.exp).toBe(now + 300);
      expect(res.expiresIn).toBe(300);
    });

    it('권한 행 + grant.mint 감사 행을 저장한다(키 지문만, 키 원문 없음)', async () => {
      const res = await service.mint(mintDto({ orderRef: 'ORD-1', reason: 're-edit' }), siteA());
      const inserted = grantRepo.insert.mock.calls[0][0] as PartnerOperatorGrantEntity;
      expect(inserted.id).toBe(res.grantId);
      expect(inserted.siteId).toBe(SITE_A);
      expect(inserted.sessionIds).toEqual([S1]);
      expect(inserted.keyFp).toBe(keyFingerprint(KEY_A));
      expect(inserted.keyFp).toHaveLength(16);
      expect(inserted.revokedAt).toBeNull();
      expect(JSON.stringify(inserted)).not.toContain(KEY_A);

      expect(audit.recordOrThrow).toHaveBeenCalledTimes(1);
      const entry = audit.recordOrThrow.mock.calls[0][0] as { action: string; detail: Record<string, unknown> };
      expect(entry.action).toBe('grant.mint');
      expect(entry.detail).toMatchObject({
        sessionCount: 1,
        capabilities: ['edit'],
        orderRef: 'ORD-1',
        reason: 're-edit',
        keyFp: keyFingerprint(KEY_A),
      });
      expect(JSON.stringify(entry)).not.toContain(KEY_A);
    });

    it('권한 행 저장 실패 → 503 PARTNER_OPERATOR_UNAVAILABLE, 토큰 서명 없음', async () => {
      grantRepo.insert.mockRejectedValueOnce(new Error("Table 'partner_operator_grants' doesn't exist"));
      const sign = jest.spyOn(jwt, 'sign');
      const r = await codeOf(service.mint(mintDto(), siteA()));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('PARTNER_OPERATOR_UNAVAILABLE');
      expect(sign).not.toHaveBeenCalled();
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      sign.mockRestore();
    });

    it('감사 행 저장 실패 → 503, 토큰 없음 + 방금 만든 권한 행 무효화', async () => {
      audit.recordOrThrow.mockRejectedValueOnce(
        new ServiceUnavailableException({ code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE' }),
      );
      const sign = jest.spyOn(jwt, 'sign');
      const r = await codeOf(service.mint(mintDto(), siteA()));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('PARTNER_OPERATOR_UNAVAILABLE');
      expect(sign).not.toHaveBeenCalled();
      expect(grantRepo.update).toHaveBeenCalledWith(
        { id: grantRepo.insert.mock.calls[0][0].id },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
      sign.mockRestore();
    });
  });

  // ─────────────────────────────── assertActive / refresh ───────────────────────────────
  describe('assertActive · refresh', () => {
    const activeRow = (grant: PartnerOperatorGrant, extra: Partial<ActiveRow> = {}): ActiveRow => ({
      id: grant.grantId,
      siteId: grant.siteId,
      operatorId: grant.operatorId,
      sessionIds: JSON.stringify(grant.sessionIds),
      capabilities: grant.capabilities.join(','),
      keyFp: keyFingerprint(KEY_A),
      expiresAtUnix: String(grant.grantExpiresAt),
      revokedAt: null,
      origin: 'partner',
      siteStatus: 'active',
      editorCode: KEY_A,
      workerCode: KEY_A_WORKER,
      ...extra,
    });

    async function mintAndDecode(dto = mintDto()): Promise<{
      access: Record<string, unknown>;
      refresh: Record<string, unknown>;
      grant: PartnerOperatorGrant;
    }> {
      const res = await service.mint(dto, siteA());
      const access = jwt.verify(res.accessToken) as Record<string, unknown>;
      const refresh = jwt.verify(res.refreshToken) as Record<string, unknown>;
      const grant = grantFromClaims(access, 'access');
      if (!grant) throw new Error('grant expected');
      return { access, refresh, grant };
    }

    it('활성 권한 → 통과(편집기 코드 또는 워커 코드 지문 일치)', async () => {
      const { grant } = await mintAndDecode();
      grantRepo.createQueryBuilder.mockReturnValue(qbReturning(activeRow(grant)));
      await expect(service.assertActive(grant)).resolves.toBeUndefined();

      grantRepo.createQueryBuilder.mockReturnValue(
        qbReturning(activeRow(grant, { keyFp: keyFingerprint(KEY_A_WORKER) })),
      );
      await expect(service.assertActive(grant)).resolves.toBeUndefined();
    });

    it.each<[string, (g: PartnerOperatorGrant) => ActiveRow | undefined | Error]>([
      ['행 없음', () => undefined],
      ['취소됨', (g) => activeRow(g, { revokedAt: new Date() })],
      ['행 만료', (g) => activeRow(g, { expiresAtUnix: String(nowSec() - 1) })],
      ['다른 사이트 행', (g) => activeRow(g, { siteId: SITE_B })],
      ['다른 운영자 행', (g) => activeRow(g, { operatorId: 'someone-else' })],
      ['사이트 운영중지', (g) => activeRow(g, { siteStatus: 'suspended' })],
      ['키 교체(지문 불일치)', (g) => activeRow(g, { editorCode: 'rotated-editor', workerCode: 'rotated-worker' })],
      ['행의 세션 범위가 토큰보다 좁음', (g) => activeRow(g, { sessionIds: JSON.stringify([S3]) })],
      ['행에 delete 권한 없음(토큰은 delete 주장)', (g) => activeRow(g, { capabilities: 'edit' })],
      ['DB 오류', () => new Error('db down')],
      ['출처 불일치(관리자 행 — 파트너 토큰)', (g) => activeRow(g, { origin: 'staff' })],
    ])('%s → 401 (fail-closed)', async (_l, make) => {
      const { grant } = await mintAndDecode(mintDto({ allowDelete: true }));
      grantRepo.createQueryBuilder.mockReturnValue(qbReturning(make(grant)));
      await expect(service.assertActive(grant)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refresh: sids·caps·obo·gid·gexp 를 그대로 유지한 액세스 토큰(범위 확장 불가)', async () => {
      sessions([row(S1, SITE_A, 777), row(S2, SITE_A, 777)]);
      const { refresh, grant } = await mintAndDecode(mintDto({ sessionIds: [S1, S2], allowDelete: true }));
      grantRepo.createQueryBuilder.mockReturnValue(qbReturning(activeRow(grant)));
      const out = await service.refresh(refresh);
      const renewed = jwt.verify(out.accessToken) as Record<string, unknown>;
      expect(renewed.tu).toBe('access');
      expect(renewed.sids).toEqual([S1, S2]);
      expect(renewed.caps).toEqual(['edit', 'delete']);
      expect(renewed.obo).toBe(777);
      expect(renewed.gid).toBe(refresh.gid);
      expect(renewed.gexp).toBe(refresh.gexp);
      expect(renewed.siteId).toBe(SITE_A);
      expect(renewed.exp as number).toBeLessThanOrEqual(refresh.gexp as number);
      expect(out.expiresIn).toBeLessThanOrEqual(ACCESS_MAX);
      expect(isPartnerOperatorClaims(renewed)).toBe(true);
    });

    it('refresh: 권한 만료 이후 → 401 REFRESH_TOKEN_EXPIRED', async () => {
      const { refresh, grant } = await mintAndDecode();
      grantRepo.createQueryBuilder.mockReturnValue(qbReturning(activeRow(grant)));
      const r = await codeOf(service.refresh(refresh, (refresh.gexp as number) + 1));
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ success: false, error: 'REFRESH_TOKEN_EXPIRED', redirectUrl: '/login' });
    });

    it.each<[string, (g: PartnerOperatorGrant) => ActiveRow]>([
      ['취소된 권한', (g) => activeRow(g, { revokedAt: new Date() })],
      ['운영중지 사이트', (g) => activeRow(g, { siteStatus: 'suspended' })],
      ['키 교체', (g) => activeRow(g, { editorCode: 'rotated', workerCode: 'rotated-w' })],
    ])('refresh: %s → 401 REFRESH_TOKEN_EXPIRED', async (_l, make) => {
      const { refresh, grant } = await mintAndDecode();
      grantRepo.createQueryBuilder.mockReturnValue(qbReturning(make(grant)));
      const r = await codeOf(service.refresh(refresh));
      expect(r.status).toBe(401);
      expect(r.body.error).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('refresh: 액세스 토큰을 리프레시 입력으로 쓰면 401 (DB 조회 전)', async () => {
      const { access } = await mintAndDecode();
      const r = await codeOf(service.refresh(access));
      expect(r.status).toBe(401);
      expect(grantRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('refresh: shop 토큰 페이로드 → 401 (운영자 클레임이 아님)', async () => {
      const r = await codeOf(service.refresh({ sub: '777', role: 'customer', source: 'shop' }));
      expect(r.status).toBe(401);
    });
  });

  // ─────────────────────────────── revoke / audit ───────────────────────────────
  describe('revoke · audit', () => {
    const G1 = '44444444-4444-4444-8444-444444444444';

    it('grantId 로 취소 — 호출 사이트 조건으로만 찾고 갱신, grant.revoke 감사 행', async () => {
      grantRepo.find.mockResolvedValue([{ id: G1, operatorId: 'op-7f3c', operatorName: null }]);
      const out = await service.revoke(siteA(), { grantId: G1 });
      expect(out).toEqual({ success: true, revoked: 1 });
      const where = grantRepo.find.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.siteId).toBe(SITE_A);
      expect(where.id).toBe(G1);
      // 파트너 취소는 파트너 발급 권한만 — 관리자 발급 권한 제외
      expect(where.origin).toBe('partner');
      expect(grantRepo.update.mock.calls[0][0]).toMatchObject({ siteId: SITE_A, origin: 'partner' });
      expect(audit.recordBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'grant.revoke', grantId: G1, siteId: SITE_A }),
      );
    });

    it('all:true — 호출 사이트의 미취소 권한 전부', async () => {
      grantRepo.find.mockResolvedValue([
        { id: G1, operatorId: 'a', operatorName: null },
        { id: '55555555-5555-4555-8555-555555555555', operatorId: 'b', operatorName: null },
      ]);
      grantRepo.update.mockResolvedValue({ affected: 2 });
      const out = await service.revoke(siteA(), { all: true });
      expect(out.revoked).toBe(2);
      const where = grantRepo.find.mock.calls[0][0].where as Record<string, unknown>;
      expect(where.siteId).toBe(SITE_A);
      expect(where).not.toHaveProperty('id');
      expect(audit.recordBestEffort).toHaveBeenCalledTimes(2);
    });

    it('다른 사이트의 grantId → 0건(오류 아님, 갱신 없음)', async () => {
      grantRepo.find.mockResolvedValue([]);
      const out = await service.revoke(siteA(), { grantId: G1 });
      expect(out).toEqual({ success: true, revoked: 0 });
      expect(grantRepo.update).not.toHaveBeenCalled();
    });

    it.each([
      ['대상 없음', {}],
      ['둘 다 지정', { grantId: G1, all: true }],
      ['all:false 만', { all: false }],
    ])('%s → 400 PARTNER_OPERATOR_REVOKE_TARGET_REQUIRED', async (_l, dto) => {
      const r = await codeOf(service.revoke(siteA(), dto));
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('PARTNER_OPERATOR_REVOKE_TARGET_REQUIRED');
    });

    it('revoke/audit 도 편집기 키만 — worker 키 403', async () => {
      await expect(service.revoke(siteA({ role: 'worker' }), { all: true })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.audit(siteA({ role: 'worker' }), {})).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('audit(): 호출 사이트로 필터해 조회', async () => {
      await service.audit(siteA(), { sessionId: S1, limit: 10 });
      expect(audit.list).toHaveBeenCalledWith(SITE_A, {
        sessionId: S1,
        grantId: undefined,
        limit: 10,
        before: undefined,
      });
    });
  });

  it('assertPartnerOperatorSiteCaller: editor 키만 통과', () => {
    expect(() => assertPartnerOperatorSiteCaller(siteA())).not.toThrow();
    expect(() => assertPartnerOperatorSiteCaller(siteA({ role: 'worker' }))).toThrow(ForbiddenException);
    expect(() => assertPartnerOperatorSiteCaller(undefined)).toThrow(ForbiddenException);
  });

  it('BadRequest/NotFound 는 HttpException 계열(전역 필터가 본문 그대로 반환)', () => {
    expect(new BadRequestException()).toBeInstanceOf(HttpException);
    expect(new NotFoundException()).toBeInstanceOf(HttpException);
  });
});

describe('PartnerOperatorAuditWriter', () => {
  let repo: { insert: jest.Mock; find: jest.Mock };
  let writer: PartnerOperatorAuditWriter;
  const entry = {
    grantId: '44444444-4444-4444-8444-444444444444',
    siteId: SITE_A,
    operatorId: 'op-1',
    action: 'session.update',
  };

  beforeEach(() => {
    repo = { insert: jest.fn().mockResolvedValue({}), find: jest.fn().mockResolvedValue([]) };
    writer = new PartnerOperatorAuditWriter(repo as unknown as Repository<PartnerOperatorAuditLogEntity>);
  });

  it('recordOrThrow: 저장 실패 → 503 PARTNER_OPERATOR_AUDIT_UNAVAILABLE', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    const r = await codeOf(writer.recordOrThrow(entry));
    expect(r.status).toBe(503);
    expect(r.body).toEqual({
      code: 'PARTNER_OPERATOR_AUDIT_UNAVAILABLE',
      message: '감사 기록을 저장할 수 없어 작업을 중단했습니다.',
    });
  });

  it('recordBestEffort: 저장 실패를 삼킨다', async () => {
    repo.insert.mockRejectedValueOnce(new Error('db down'));
    await expect(writer.recordBestEffort(entry)).resolves.toBeUndefined();
  });

  it('행에 uuid id 를 부여하고 route 를 200자로 자른다', async () => {
    await writer.recordBestEffort({ ...entry, route: 'x'.repeat(500) });
    const inserted = repo.insert.mock.calls[0][0] as PartnerOperatorAuditLogEntity;
    expect(inserted.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inserted.route).toHaveLength(200);
  });

  it('toRow: origin 기본 partner·actorUserId null, staff 항목은 grant/site NULL 허용', async () => {
    await writer.recordBestEffort(entry);
    const a = repo.insert.mock.calls[0][0] as PartnerOperatorAuditLogEntity;
    expect(a.origin).toBe('partner');
    expect(a.actorUserId).toBeNull();
    await writer.recordBestEffort({ ...entry, grantId: null, siteId: null, origin: 'staff', actorUserId: 'u-1' });
    const b = repo.insert.mock.calls[1][0] as PartnerOperatorAuditLogEntity;
    expect(b).toMatchObject({ origin: 'staff', actorUserId: 'u-1', grantId: null, siteId: null });
  });

  it('list(파트너 감사 조회): origin partner 행만', async () => {
    await writer.list(SITE_A, {});
    const arg = repo.find.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(arg.where).toMatchObject({ siteId: SITE_A, origin: 'partner' });
  });

  it('listStaff: origin staff + 사이트 범위(배열), 범위 밖 siteId → 조회 없이 빈 결과', async () => {
    await writer.listStaff({ siteIds: [SITE_A], limit: 500 });
    const arg = repo.find.mock.calls[0][0] as { where: Record<string, unknown>; take: number; select: string[] };
    expect(arg.where.origin).toBe('staff');
    expect(arg.where.siteId).toBeDefined();
    expect(arg.take).toBe(200);
    expect(arg.select).toContain('actorUserId');
    expect(await writer.listStaff({ siteIds: [SITE_A], siteId: SITE_B, limit: 10 })).toEqual([]);
    expect(await writer.listStaff({ siteIds: [], limit: 10 })).toEqual([]);
    expect(repo.find).toHaveBeenCalledTimes(1);
    await writer.listStaff({ siteIds: 'all', limit: 10 });
    const all = repo.find.mock.calls[1][0] as { where: Record<string, unknown> };
    expect(all.where).toEqual({ origin: 'staff' });
  });

  /** createQueryBuilder(...).getRawMany() 체인 목 — 호출 순서대로 rows 를 돌려준다. */
  const rawRepo = (...results: Array<Array<{ sessionId: string; lastAt: Date | string }>>) => {
    const calls: Array<Array<{ m: string; a: unknown[] }>> = [];
    const createQueryBuilder = jest.fn(() => {
      const rec: Array<{ m: string; a: unknown[] }> = [];
      calls.push(rec);
      const rows = results.shift() ?? [];
      const qb: Record<string, jest.Mock> = {};
      for (const m of ['select', 'addSelect', 'where', 'andWhere', 'groupBy']) {
        qb[m] = jest.fn((...a: unknown[]) => {
          rec.push({ m, a });
          return qb;
        });
      }
      qb.getRawMany = jest.fn(async () => rows);
      return qb;
    });
    const w = new PartnerOperatorAuditWriter({ createQueryBuilder } as unknown as Repository<PartnerOperatorAuditLogEntity>);
    return { w, calls, createQueryBuilder };
  };

  it('hasStaffUpdateAfter: 관리자 편집 기록 없음 → false(완료 조회 생략), 완료 없음(after null) → true', async () => {
    const none = rawRepo([]);
    expect(await none.w.hasStaffUpdateAfter(S1, new Date('2026-09-01T00:00:00Z'))).toBe(false);
    expect(none.createQueryBuilder).toHaveBeenCalledTimes(1);
    const q = JSON.stringify(none.calls[0]);
    expect(q).toContain('"origin":"staff"');
    expect(q).toContain('"action":"session.update"');

    const neverCompleted = rawRepo([{ sessionId: S1, lastAt: new Date('2026-09-01T00:00:00.200Z') }]);
    expect(await neverCompleted.w.hasStaffUpdateAfter(S1, null)).toBe(true);
    expect(neverCompleted.createQueryBuilder).toHaveBeenCalledTimes(1);
  });

  it('hasStaffUpdateAfter: 편집기 update→complete 같은 초(update T.200, completed_at T.000 절삭) → stale 아님', async () => {
    const T = Date.parse('2026-09-29T10:00:00.000Z');
    const { w, calls } = rawRepo(
      [{ sessionId: S1, lastAt: new Date(T + 200) }],
      [{ sessionId: S1, lastAt: new Date(T + 350) }], // 'session.complete'(운영자 경로) 감사 — 완료 저장 직전
    );
    expect(await w.hasStaffUpdateAfter(S1, new Date(T))).toBe(false);
    const completionQuery = JSON.stringify(calls[1]);
    expect(completionQuery).toContain('session.complete');
    expect(completionQuery).toContain('staff.session.complete');
    expect(completionQuery).not.toContain('"origin"');
  });

  it('hasStaffUpdateAfter: 완료 감사 행 없음(고객·파트너 키 완료) + 같은 초 update → stale 아님, 1초 이상 뒤 → stale', async () => {
    const T = Date.parse('2026-09-29T10:00:00.000Z');
    const same = rawRepo([{ sessionId: S1, lastAt: new Date(T + 200) }], []);
    expect(await same.w.hasStaffUpdateAfter(S1, new Date(T))).toBe(false);
    const later = rawRepo([{ sessionId: S1, lastAt: new Date(T + 1500) }], []);
    expect(await later.w.hasStaffUpdateAfter(S1, new Date(T))).toBe(true);
  });

  it('hasStaffUpdateAfter: 완료 뒤 추가 편집(완료 감사 T.300 < update T.500, 같은 초) → stale', async () => {
    const T = Date.parse('2026-09-29T10:00:00.000Z');
    const { w } = rawRepo(
      [{ sessionId: S1, lastAt: new Date(T + 500) }],
      [{ sessionId: S1, lastAt: new Date(T + 300) }],
    );
    expect(await w.hasStaffUpdateAfter(S1, new Date(T))).toBe(true);
  });

  it('isStaffEditAfterCompletion: 경계·반올림·오래된 완료 감사 행', () => {
    const T = Date.parse('2026-09-29T10:00:00.000Z');
    const d = (ms: number) => new Date(T + ms);
    expect(isStaffEditAfterCompletion(null, d(0), null)).toBe(false);
    expect(isStaffEditAfterCompletion(d(0), null, null)).toBe(true);
    // 감사 행 없음: completedAt + 1초 경계
    expect(isStaffEditAfterCompletion(d(999), d(0), null)).toBe(false);
    expect(isStaffEditAfterCompletion(d(1000), d(0), null)).toBe(true);
    // 반올림 저장(실제 완료 T.600 → completed_at T+1s): update T.400 은 stale 아님
    expect(isStaffEditAfterCompletion(d(400), d(1000), d(550))).toBe(false);
    expect(isStaffEditAfterCompletion(d(400), d(1000), null)).toBe(false);
    // 완료 감사 행이 이전 완료(현재 completedAt ±1초 밖) → completedAt 기준 폴백
    expect(isStaffEditAfterCompletion(d(-5000), d(0), d(-60000))).toBe(false);
    expect(isStaffEditAfterCompletion(d(3000), d(0), d(-60000))).toBe(true);
    // 실패한 완료 시도(감사 행만 남고 completed_at 미변경, +1초 밖) → 폴백
    expect(isStaffEditAfterCompletion(d(3000), d(0), d(4000))).toBe(true);
  });

  it('list: siteId 필터 + 명시 컬럼 + 최신순 + limit 상한 200', async () => {
    await writer.list(SITE_A, { limit: 999 });
    const arg = repo.find.mock.calls[0][0] as {
      where: Record<string, unknown>;
      select: string[];
      order: Record<string, string>;
      take: number;
    };
    expect(arg.where.siteId).toBe(SITE_A);
    expect(arg.select).toContain('operatorId');
    expect(arg.order).toEqual({ createdAt: 'DESC' });
    expect(arg.take).toBe(200);
  });
});

// ─────────────────────────────── 관리자 발급 권한(origin 'staff') ───────────────────────────────
describe('PartnerOperatorGrantService — 관리자 발급(staff)', () => {
  const jwt = new JwtService({ secret: SECRET });
  const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  let grantRepo: {
    insert: jest.Mock;
    update: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let sessionRepo: { find: jest.Mock; findOne: jest.Mock };
  let siteRepo: { findOne: jest.Mock };
  let userRepo: { createQueryBuilder: jest.Mock };
  let audit: { recordOrThrow: jest.Mock; recordBestEffort: jest.Mock; list: jest.Mock };
  let service: PartnerOperatorGrantService;

  interface Chain {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    leftJoin: jest.Mock;
    innerJoin: jest.Mock;
    getRawOne: jest.Mock;
  }
  const chain = (result: unknown): Chain => {
    const c = {} as Chain;
    for (const k of ['select', 'addSelect', 'where', 'leftJoin', 'innerJoin'] as const) c[k] = jest.fn(() => c);
    c.getRawOne = result instanceof Error ? jest.fn().mockRejectedValue(result) : jest.fn().mockResolvedValue(result);
    return c;
  };

  const baseInput = (extra: Record<string, unknown> = {}) => ({
    sessionId: S1,
    siteId: SITE_A,
    siteName: 'Site A',
    actorUserId: ACTOR,
    allowDelete: false,
    ...extra,
  });

  beforeEach(() => {
    grantRepo = {
      insert: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    sessionRepo = {
      find: jest.fn(),
      findOne: jest.fn().mockResolvedValue({
        id: S1,
        createdAt: new Date(Date.now() - 86_400_000),
        guestToken: null,
        guestExpiresAt: null,
      }),
    };
    siteRepo = { findOne: jest.fn().mockResolvedValue({ id: SITE_A, editRetentionDays: null }) };
    userRepo = { createQueryBuilder: jest.fn(() => chain({ userRole: 'ADMIN', siteRole: null })) };
    audit = {
      recordOrThrow: jest.fn().mockResolvedValue(undefined),
      recordBestEffort: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([]),
    };
    service = new PartnerOperatorGrantService(
      jwt,
      sessionRepo as unknown as Repository<EditSessionEntity>,
      grantRepo as unknown as Repository<PartnerOperatorGrantEntity>,
      siteRepo as unknown as Repository<Site>,
      audit as unknown as PartnerOperatorAuditWriter,
      userRepo as unknown as Repository<User>,
      {} as unknown as Repository<UserSiteRole>,
    );
  });

  describe('mintForStaff', () => {
    it('권한 행: key_fp NULL · origin staff · issued_by_user_id · operatorId staff.<id> · 기본 ttl 3600', async () => {
      const now = nowSec();
      const res = await service.mintForStaff(baseInput(), now);
      const row = grantRepo.insert.mock.calls[0][0] as PartnerOperatorGrantEntity;
      expect(row.keyFp).toBeNull();
      expect(row.origin).toBe('staff');
      expect(row.issuedByUserId).toBe(ACTOR);
      expect(row.operatorId).toBe(`staff.${ACTOR}`);
      expect(row.operatorName).toBe('Storige 관리자');
      expect(row.sessionIds).toEqual([S1]);
      expect(row.capabilities).toBe('edit');
      expect(row.expiresAtUnix).toBe(now + 3600);
      expect(res.grantExpiresAt).toBe(new Date((now + 3600) * 1000).toISOString());
      expect(res.capabilities).toEqual(['edit']);

      const entry = audit.recordOrThrow.mock.calls[0][0] as Record<string, unknown>;
      expect(entry).toMatchObject({ action: 'grant.mint', origin: 'staff', actorUserId: ACTOR, sessionId: S1 });

      const access = jwt.verify(res.accessToken) as Record<string, unknown>;
      const refresh = jwt.verify(res.refreshToken) as Record<string, unknown>;
      expect(access.org).toBe('staff');
      expect(refresh.org).toBe('staff');
      const g = grantFromClaims(access, 'access');
      expect(g?.origin).toBe('staff');
      // 발급자는 클레임에서 얻지 않는다(행에서만)
      expect(g?.issuedByUserId).toBeNull();
    });

    it('allowDelete → edit,delete / ttl 은 300..28800 으로 고정', async () => {
      const now = nowSec();
      await service.mintForStaff(baseInput({ allowDelete: true, ttlSeconds: 10 }), now);
      const row = grantRepo.insert.mock.calls[0][0] as PartnerOperatorGrantEntity;
      expect(row.capabilities).toBe('edit,delete');
      expect(row.expiresAtUnix).toBe(now + 300);
      await service.mintForStaff(baseInput({ ttlSeconds: 999999 }), now);
      expect((grantRepo.insert.mock.calls[1][0] as PartnerOperatorGrantEntity).expiresAtUnix).toBe(now + 28800);
    });

    it('권한 만료는 보관기간 종료(notAfterUnix)를 넘지 않는다', async () => {
      const now = nowSec();
      const res = await service.mintForStaff(baseInput({ notAfterUnix: now + 600 }), now);
      expect((grantRepo.insert.mock.calls[0][0] as PartnerOperatorGrantEntity).expiresAtUnix).toBe(now + 600);
      expect((jwt.verify(res.refreshToken) as Record<string, unknown>).gexp).toBe(now + 600);
    });

    it('잔여 60초 미만 → 409 EDIT_RETENTION_EXPIRED, 권한 행·토큰 없음', async () => {
      const now = nowSec();
      const r = await codeOf(service.mintForStaff(baseInput({ notAfterUnix: now + 59 }), now));
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EDIT_RETENTION_EXPIRED');
      expect(grantRepo.insert).not.toHaveBeenCalled();
    });

    it('감사 실패 → 503, 토큰 없음 + 행 무효화', async () => {
      audit.recordOrThrow.mockRejectedValueOnce(new Error('db down'));
      const r = await codeOf(service.mintForStaff(baseInput()));
      expect(r.status).toBe(503);
      expect(grantRepo.update).toHaveBeenCalledWith(
        { id: grantRepo.insert.mock.calls[0][0].id },
        expect.objectContaining({ revokedAt: expect.any(Date) }),
      );
    });
  });

  describe('assertActive — 관리자 분기', () => {
    const staffRow = (g: PartnerOperatorGrant, extra: Record<string, unknown> = {}) => ({
      id: g.grantId,
      siteId: g.siteId,
      operatorId: g.operatorId,
      sessionIds: JSON.stringify(g.sessionIds),
      capabilities: g.capabilities.join(','),
      keyFp: null,
      expiresAtUnix: String(g.grantExpiresAt),
      revokedAt: null,
      origin: 'staff',
      issuedByUserId: ACTOR,
      ...extra,
    });

    async function staffGrant(allowDelete = false): Promise<{ grant: PartnerOperatorGrant; refresh: Record<string, unknown> }> {
      const res = await service.mintForStaff(baseInput({ allowDelete }));
      const grant = grantFromClaims(jwt.verify(res.accessToken), 'access');
      if (!grant) throw new Error('grant expected');
      return { grant, refresh: jwt.verify(res.refreshToken) as Record<string, unknown> };
    }

    it('정상 → 통과, 사이트 조인·사이트 코드 조회 없음, 발급자는 행 값으로 채움', async () => {
      const { grant } = await staffGrant();
      const qb = chain(staffRow(grant));
      grantRepo.createQueryBuilder.mockReturnValue(qb);
      await expect(service.assertActive(grant)).resolves.toBeUndefined();
      expect(qb.innerJoin).not.toHaveBeenCalled();
      const selected = [...qb.select.mock.calls, ...qb.addSelect.mock.calls].map((c) => String(c[0]));
      expect(selected.some((x) => x.includes('editorAuthCode') || x.includes('workerAuthCode'))).toBe(false);
      expect(grant.issuedByUserId).toBe(ACTOR);
    });

    it('사이트 운영자(해당 사이트 행 존재) → 통과, 운영중지 사이트도 확인하지 않는다', async () => {
      const { grant } = await staffGrant();
      grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(grant)));
      userRepo.createQueryBuilder.mockReturnValue(chain({ userRole: 'SITE_MANAGER', siteRole: 'SITE_MANAGER' }));
      await expect(service.assertActive(grant)).resolves.toBeUndefined();
    });

    it.each<[string, (g: PartnerOperatorGrant) => void]>([
      ['계정 삭제됨', () => userRepo.createQueryBuilder.mockReturnValue(chain(undefined))],
      ['계정 강등(CUSTOMER, 사이트 행 없음)', () => userRepo.createQueryBuilder.mockReturnValue(chain({ userRole: 'CUSTOMER', siteRole: null }))],
      ['사이트 배정 해제(user_site_roles 행 없음)', () => userRepo.createQueryBuilder.mockReturnValue(chain({ userRole: 'SITE_ADMIN', siteRole: null }))],
      ['operatorId 불일치', (g) => grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(g, { operatorId: 'staff.someone-else' })))],
      ['발급자와 operatorId 불일치', (g) => grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(g, { issuedByUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })))],
      ['출처 불일치(파트너 행)', (g) => grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(g, { origin: 'partner' })))],
      ['키 지문이 있는 행', (g) => grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(g, { keyFp: 'abcdabcdabcdabcd' })))],
      ['취소됨', (g) => grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(g, { revokedAt: new Date() })))],
      ['발급 후 보관기간 만료(설정 축소)', () => siteRepo.findOne.mockResolvedValue({ id: SITE_A, editRetentionDays: 1 }) && sessionRepo.findOne.mockResolvedValue({ id: S1, createdAt: new Date(Date.now() - 2 * 86_400_000), guestToken: null, guestExpiresAt: null })],
      ['세션 행 없음(영구삭제)', () => sessionRepo.findOne.mockResolvedValue(null)],
      ['사이트 행 없음', () => siteRepo.findOne.mockResolvedValue(null)],
      ['역할 조회 DB 오류', () => userRepo.createQueryBuilder.mockReturnValue(chain(new Error('db down')))],
      ['권한 행 조회 DB 오류', () => grantRepo.createQueryBuilder.mockReturnValue(chain(new Error('db down')))],
    ])('%s → 401', async (_l, arrange) => {
      const { grant } = await staffGrant();
      grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(grant)));
      arrange(grant);
      await expect(service.assertActive(grant)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('delete 권한 + SITE_MANAGER 사이트 행 → 401, SITE_ADMIN 행이면 통과', async () => {
      const { grant } = await staffGrant(true);
      grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(grant)));
      userRepo.createQueryBuilder.mockReturnValue(chain({ userRole: 'SITE_ADMIN', siteRole: 'SITE_MANAGER' }));
      await expect(service.assertActive(grant)).rejects.toBeInstanceOf(UnauthorizedException);
      userRepo.createQueryBuilder.mockReturnValue(chain({ userRole: 'SITE_MANAGER', siteRole: 'SITE_ADMIN' }));
      await expect(service.assertActive(grant)).resolves.toBeUndefined();
    });

    it('파트너 토큰(org 없음)을 관리자 행에 쓰면 401 — 파트너 분기의 출처 대조', async () => {
      const { grant } = await staffGrant();
      const partnerLike: PartnerOperatorGrant = { ...grant, origin: 'partner' };
      grantRepo.createQueryBuilder.mockReturnValue(chain({ ...staffRow(grant), siteStatus: 'active', editorCode: KEY_A, workerCode: KEY_A_WORKER }));
      await expect(service.assertActive(partnerLike)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('refresh 는 org 를 유지한다', async () => {
      const { grant, refresh } = await staffGrant();
      grantRepo.createQueryBuilder.mockReturnValue(chain(staffRow(grant)));
      const out = await service.refresh(refresh);
      const renewed = jwt.verify(out.accessToken) as Record<string, unknown>;
      expect(renewed.org).toBe('staff');
      expect(renewed.tu).toBe('access');
    });

    it('userRepository 미주입 구성 → 관리자 권한 401(fail-closed)', async () => {
      const { grant } = await staffGrant();
      const bare = new PartnerOperatorGrantService(
        jwt,
        sessionRepo as unknown as Repository<EditSessionEntity>,
        grantRepo as unknown as Repository<PartnerOperatorGrantEntity>,
        siteRepo as unknown as Repository<Site>,
        audit as unknown as PartnerOperatorAuditWriter,
      );
      await expect(bare.assertActive(grant)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('revokeStaff · listStaffGrantsForSession', () => {
    const G = '99999999-9999-4999-8999-999999999999';

    it('origin staff 로만 찾는다 — 파트너 발급 권한은 404 GRANT_NOT_FOUND', async () => {
      grantRepo.findOne.mockResolvedValue(null);
      const r = await codeOf(service.revokeStaff(G, { global: true, siteIds: [] }, ACTOR));
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('GRANT_NOT_FOUND');
      expect((grantRepo.findOne.mock.calls[0][0] as { where: Record<string, unknown> }).where).toEqual({ id: G, origin: 'staff' });
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
    });

    it('범위 밖 사이트 → 같은 404, 감사·갱신 없음', async () => {
      grantRepo.findOne.mockResolvedValue({ id: G, siteId: SITE_B, sessionIds: [S1], revokedAt: null });
      const r = await codeOf(service.revokeStaff(G, { global: false, siteIds: [SITE_A] }, ACTOR));
      expect(r.status).toBe(404);
      expect(audit.recordOrThrow).not.toHaveBeenCalled();
      expect(grantRepo.update).not.toHaveBeenCalled();
    });

    it('감사(fail-closed) 후 revoked_at 설정, 이미 취소면 갱신 없이 성공(멱등)', async () => {
      grantRepo.findOne.mockResolvedValue({ id: G, siteId: SITE_A, sessionIds: [S1], revokedAt: null });
      const first = await service.revokeStaff(G, { global: false, siteIds: [SITE_A] }, ACTOR);
      expect(first).toEqual({ success: true, grantId: G, revoked: true });
      expect(audit.recordOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff.grant.revoke', origin: 'staff', actorUserId: ACTOR, grantId: G }),
      );
      expect(grantRepo.update.mock.calls[0][0]).toMatchObject({ id: G, origin: 'staff' });

      grantRepo.findOne.mockResolvedValue({ id: G, siteId: SITE_A, sessionIds: [S1], revokedAt: new Date() });
      const second = await service.revokeStaff(G, { global: false, siteIds: [SITE_A] }, ACTOR);
      expect(second.revoked).toBe(false);
      expect(grantRepo.update).toHaveBeenCalledTimes(1);
    });

    it('감사 실패 → 503 STAFF_AUDIT_UNAVAILABLE, 취소하지 않음', async () => {
      grantRepo.findOne.mockResolvedValue({ id: G, siteId: SITE_A, sessionIds: [S1], revokedAt: null });
      audit.recordOrThrow.mockRejectedValueOnce(new ServiceUnavailableException());
      const r = await codeOf(service.revokeStaff(G, { global: true, siteIds: [] }, ACTOR));
      expect(r.status).toBe(503);
      expect(r.body.code).toBe('STAFF_AUDIT_UNAVAILABLE');
      expect(grantRepo.update).not.toHaveBeenCalled();
    });

    it('listStaffGrantsForSession: NULL-site → 조회 없이 빈 목록', async () => {
      expect(await service.listStaffGrantsForSession(S1, null)).toEqual([]);
      expect(grantRepo.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
