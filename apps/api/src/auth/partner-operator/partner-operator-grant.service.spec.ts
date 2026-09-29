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
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import {
  ACCESS_MAX,
  PartnerOperatorGrant,
  grantFromClaims,
  isPartnerOperatorClaims,
} from './partner-operator.types';

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
      expect(grantRepo.update.mock.calls[0][0]).toMatchObject({ siteId: SITE_A });
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
