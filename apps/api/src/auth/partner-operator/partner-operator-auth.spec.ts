/**
 * 운영자 대리 편집 토큰의 인증 경로 (2026-09-29, ADDITIVE).
 *
 *  - JwtStrategy: 운영자 액세스 토큰만 PartnerOperatorUser, 그 외 운영자 흔적 토큰은 401
 *  - JwtAuthGuard.handleRequest: 핸들러 수준 @PartnerOperatorAllowed() 가 없으면 403(기본 거부)
 *  - AuthService: shop 갱신 결과 불변 / admin 갱신은 운영자 토큰 거부
 *  - POST /auth/me: 운영자에게 표시용 role 'customer' + source 'partner_operator'
 *  - OptionalShopJwtGuard: 운영자 액세스 토큰에서만 사이트 컨텍스트 복원, 절대 throw 하지 않음
 *  - 감사 인터셉터 · DTO 검증 · 발급 라우트 호출자 · 모듈 배선
 */
import 'reflect-metadata';
import {
  BadRequestException,
  CallHandler,
  Controller,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Post,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { lastValueFrom, of, throwError } from 'rxjs';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { OptionalShopJwtGuard } from '../guards/optional-shop-jwt.guard';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { AuthService } from '../auth.service';
import { AuthController } from '../auth.controller';
import { AuthModule } from '../auth.module';
import { User } from '../entities/user.entity';
import {
  PARTNER_OPERATOR_ALLOWED_KEY,
  PartnerOperatorAllowed,
} from '../decorators/partner-operator-allowed.decorator';
import { CreatePartnerOperatorSessionDto } from '../dto/partner-operator-session.dto';
import type { CurrentSitePayload } from '../decorators/current-site.decorator';
import type { SitesService } from '../../sites/sites.service';
import { PartnerOperatorGrantService } from './partner-operator-grant.service';
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import { PartnerOperatorAuditInterceptor } from './partner-operator-audit.interceptor';
import {
  controllerPathOf,
  markRejectedOperatorGrant,
  operatorIdentityFromGrant,
  recordOperatorRequest,
  rejectedOperatorGrantOf,
} from './partner-operator-request-audit';
import {
  PartnerOperatorClaims,
  PartnerOperatorGrant,
  PartnerOperatorUser,
  claimsFromGrant,
  grantFromClaims,
  isPartnerOperatorClaims,
} from './partner-operator.types';

const SECRET = 'partner-operator-auth-spec';
const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const S1 = '11111111-1111-4111-8111-111111111111';
const GID = '44444444-4444-4444-8444-444444444444';

const nowSec = (): number => Math.floor(Date.now() / 1000);

const grant = (extra: Partial<PartnerOperatorGrant> = {}): PartnerOperatorGrant => ({
  grantId: GID,
  operatorId: 'op-7f3c',
  operatorName: '운영팀',
  siteId: SITE_A,
  sessionIds: [S1],
  capabilities: ['edit'],
  grantExpiresAt: nowSec() + 3600,
  ...extra,
});

const claims = (
  tu: 'access' | 'refresh' = 'access',
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({ ...claimsFromGrant(grant(), 'Site A', tu), ...extra });

const operatorUser = (g: PartnerOperatorGrant = grant()): PartnerOperatorUser => ({
  userId: `po:${g.operatorId}`,
  email: '',
  name: g.operatorName ?? g.operatorId,
  role: 'partner_operator',
  source: 'partner_operator',
  permissions: [],
  siteId: g.siteId,
  siteName: 'Site A',
  partnerOperator: g,
});

describe('partner-operator.types — 판정', () => {
  it('shop/admin 토큰은 운영자 판정에 걸리지 않는다', () => {
    expect(isPartnerOperatorClaims({ sub: '777', role: 'customer', source: 'shop' })).toBe(false);
    expect(isPartnerOperatorClaims({ sub: 'uuid', role: 'ADMIN' })).toBe(false);
    expect(isPartnerOperatorClaims(null)).toBe(false);
  });

  it('흔적 하나(typ/source/role)만 있어도 판정에 걸린다 → 이후 전체 일관성 강제', () => {
    expect(isPartnerOperatorClaims({ typ: 'partner_operator' })).toBe(true);
    expect(isPartnerOperatorClaims({ source: 'partner_operator' })).toBe(true);
    expect(isPartnerOperatorClaims({ role: 'partner_operator' })).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['typ 누락', { typ: undefined }],
    ['source shop 혼합', { source: 'shop' }],
    ['role customer 혼합', { role: 'customer' }],
    ['siteId 누락', { siteId: undefined }],
    ['gid 비UUID', { gid: 'x' }],
    ['gexp 과거', { gexp: nowSec() - 1 }],
    ['sids 빈 배열', { sids: [] }],
    ['sids 21개', { sids: Array.from({ length: 21 }, (_, i) => `s${i}`) }],
    ['caps 에 edit 없음', { caps: ['delete'] }],
    ['caps 에 미지 값', { caps: ['edit', 'admin'] }],
    ["opId 에 '@'", { opId: 'a@b.c', sub: 'po:a@b.c' }],
    ['sub 불일치', { sub: 'po:other' }],
    ['obo 음수', { obo: -1 }],
  ])('grantFromClaims: %s → null', (_l, extra) => {
    expect(grantFromClaims(claims('access', extra), 'access')).toBeNull();
  });

  it('org: 파트너 클레임에는 없음(origin partner), staff 만 허용, 그 외 값은 거부', () => {
    const partner = claims('access');
    expect(partner).not.toHaveProperty('org');
    expect(grantFromClaims(partner, 'access')).toMatchObject({ origin: 'partner', issuedByUserId: null });
    expect(grantFromClaims(claims('access', { org: 'staff' }), 'access')?.origin).toBe('staff');
    for (const bad of ['partner', 'STAFF', '', null, 1, { x: 1 }]) {
      expect(grantFromClaims(claims('access', { org: bad }), 'access')).toBeNull();
    }
  });

  it('claimsFromGrant: staff 권한만 org 를 싣는다(발급자 id 는 싣지 않음)', () => {
    const c = claimsFromGrant(grant({ origin: 'staff', issuedByUserId: 'u-1' }), 'Site A', 'refresh');
    expect(c.org).toBe('staff');
    expect(JSON.stringify(c)).not.toContain('u-1');
    expect(claimsFromGrant(grant({ origin: 'partner' }), 'Site A', 'access')).not.toHaveProperty('org');
  });

  it('grantFromClaims: tu 불일치 → null, 일치 → 권한', () => {
    expect(grantFromClaims(claims('refresh'), 'access')).toBeNull();
    expect(grantFromClaims(claims('access'), 'access')).toMatchObject({ grantId: GID, siteId: SITE_A });
  });
});

// ───────────────────────────── JwtStrategy ─────────────────────────────
describe('JwtStrategy — 운영자 분기', () => {
  const config = { get: jest.fn(() => SECRET) } as unknown as ConfigService;
  let userRepo: { findOne: jest.Mock };
  let grants: { assertActive: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    grants = { assertActive: jest.fn().mockResolvedValue(undefined) };
    strategy = new JwtStrategy(
      config,
      userRepo as unknown as Repository<User>,
      grants as unknown as PartnerOperatorGrantService,
    );
  });

  it('유효 액세스 토큰 + 활성 권한 → PartnerOperatorUser (User 조회 없음)', async () => {
    const user = (await strategy.validate(claims('access') as never)) as PartnerOperatorUser;
    expect(user).toMatchObject({
      userId: 'po:op-7f3c',
      email: '',
      role: 'partner_operator',
      source: 'partner_operator',
      permissions: [],
      siteId: SITE_A,
      siteName: 'Site A',
    });
    expect(user.partnerOperator).toMatchObject({ grantId: GID, sessionIds: [S1], capabilities: ['edit'] });
    expect(grants.assertActive).toHaveBeenCalledTimes(1);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['리프레시 토큰을 Bearer 로 사용', claims('refresh')],
    ['sids 누락', claims('access', { sids: undefined })],
    ['gexp 만료', claims('access', { gexp: nowSec() - 5 })],
    ['siteId 누락', claims('access', { siteId: undefined })],
    ['혼합: source shop + typ 운영자', claims('access', { source: 'shop' })],
    ['혼합: role 운영자 + source shop (typ 없음)', { sub: '777', role: 'partner_operator', source: 'shop', siteId: SITE_A }],
  ])('%s → 401, 권한 행·User 조회 없음', async (_l, payload) => {
    await expect(strategy.validate(payload as never)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(grants.assertActive).not.toHaveBeenCalled();
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });

  it('취소된 권한(assertActive 401) → 401', async () => {
    grants.assertActive.mockRejectedValue(new UnauthorizedException());
    await expect(strategy.validate(claims('access') as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('DB 오류 → 401 (실제 서비스 assertActive 의 fail-closed)', async () => {
    const qb = {
      innerJoin: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      getRawOne: jest.fn().mockRejectedValue(new Error('db down')),
    };
    qb.innerJoin.mockReturnValue(qb);
    qb.select.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    const real = new PartnerOperatorGrantService(
      new JwtService({ secret: SECRET }),
      {} as never,
      { createQueryBuilder: jest.fn(() => qb) } as never,
      {} as never,
      {} as never,
    );
    const s = new JwtStrategy(config, userRepo as unknown as Repository<User>, real);
    await expect(s.validate(claims('access') as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('권한 서비스 미주입(@Optional) 구성 → 운영자 토큰 401', async () => {
    const s = new JwtStrategy(config, userRepo as unknown as Repository<User>);
    await expect(s.validate(claims('access') as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('회귀: shop 토큰은 DB 조회 없이 종전 형태 그대로', async () => {
    const out = await strategy.validate({
      sub: '777',
      email: 'a@b.c',
      name: '홍',
      role: 'customer',
      source: 'shop',
      siteId: SITE_A,
      siteName: 'Site A',
    });
    expect(out).toEqual({
      userId: '777',
      email: 'a@b.c',
      name: '홍',
      role: 'customer',
      source: 'shop',
      permissions: ['edit', 'upload', 'validate'],
      allowedOrderSeqnos: undefined,
      siteId: SITE_A,
      siteName: 'Site A',
    });
    expect(grants.assertActive).not.toHaveBeenCalled();
  });

  it('회귀: admin 토큰은 User 조회 경로 그대로', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', role: 'ADMIN' });
    const out = (await strategy.validate({ sub: 'u1', email: 'x', role: 'ADMIN' })) as User;
    expect(out.id).toBe('u1');
    expect(userRepo.findOne).toHaveBeenCalledWith({ where: { id: 'u1' } });
    expect(grants.assertActive).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── JwtAuthGuard gate ─────────────────────────────
class ProbeController {
  @PartnerOperatorAllowed()
  allowed(): void {}

  plain(): void {}
}

@SetMetadata(PARTNER_OPERATOR_ALLOWED_KEY, true)
class ClassLevelProbe {
  handler(): void {}
}

const ctxFor = (cls: object, handler: (...args: never[]) => unknown): ExecutionContext =>
  ({ getHandler: () => handler, getClass: () => cls }) as unknown as ExecutionContext;

describe('JwtAuthGuard.handleRequest — 운영자 라우트 게이트(기본 거부)', () => {
  const guard = new JwtAuthGuard(new Reflector());
  const shop = { userId: '777', source: 'shop', role: 'customer' };
  const admin = { id: 'u1', role: 'ADMIN' };

  it('데코레이터 없는 핸들러 → 403 PARTNER_OPERATOR_ROUTE_NOT_ALLOWED', () => {
    let caught: unknown;
    try {
      guard.handleRequest(null, operatorUser(), undefined, ctxFor(ProbeController, ProbeController.prototype.plain));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect((caught as ForbiddenException).getResponse()).toEqual({
      code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
      message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
    });
  });

  it('@PartnerOperatorAllowed() 핸들러 → 통과', () => {
    const u = operatorUser();
    expect(
      guard.handleRequest(null, u, undefined, ctxFor(ProbeController, ProbeController.prototype.allowed)),
    ).toBe(u);
  });

  it('클래스 수준 메타데이터만으로는 열리지 않는다', () => {
    expect(() =>
      guard.handleRequest(null, operatorUser(), undefined, ctxFor(ClassLevelProbe, ClassLevelProbe.prototype.handler)),
    ).toThrow(ForbiddenException);
  });

  it('shop/admin 사용자는 데코레이터와 무관하게 종전대로 통과', () => {
    const ctx = ctxFor(ProbeController, ProbeController.prototype.plain);
    expect(guard.handleRequest(null, shop, undefined, ctx)).toBe(shop);
    expect(guard.handleRequest(null, admin, undefined, ctx)).toBe(admin);
  });

  it('사용자 없음 → 종전 401', () => {
    expect(() =>
      guard.handleRequest(null, false, undefined, ctxFor(ProbeController, ProbeController.prototype.allowed)),
    ).toThrow(UnauthorizedException);
  });
});

// ───────────────────────────── JwtAuthGuard 거부 요청 감사 ─────────────────────────────
describe('JwtAuthGuard — 가드 단계 거부 요청 감사', () => {
  const writer = {
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
    resolveGrantOrigin: jest.fn(),
  };
  const guard = new JwtAuthGuard(new Reflector(), writer as unknown as PartnerOperatorAuditWriter);

  @SetMetadata('path', 'edit-sessions')
  class EditSessionsProbe {
    @PartnerOperatorAllowed()
    allowed(): void {}

    plain(): void {}
  }
  @SetMetadata('path', 'files')
  class FilesProbe {
    plain(): void {}
  }

  const httpCtx = (
    cls: object,
    handler: (...args: never[]) => unknown,
    req: Record<string, unknown>,
    type = 'http',
  ): ExecutionContext =>
    ({
      getType: () => type,
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => req }),
    }) as unknown as ExecutionContext;
  const sessionReq = (user?: unknown): Record<string, unknown> => ({
    method: 'PATCH',
    params: { id: S1 },
    route: { path: '/api/edit-sessions/:id' },
    user,
  });
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
  const caught = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return undefined;
  };
  const grantInvalidError = (): UnauthorizedException =>
    new UnauthorizedException({
      code: 'PARTNER_OPERATOR_GRANT_INVALID',
      message: '운영자 권한이 만료되었거나 취소되었습니다.',
    });

  beforeEach(() => {
    writer.recordBestEffort.mockReset().mockResolvedValue(undefined);
    writer.resolveGrantOrigin.mockReset();
  });

  it('운영자 토큰 + 허용 표시 없는 핸들러 → 403 그대로, 요청 감사 행 1건', () => {
    const u = operatorUser();
    const e = caught(() =>
      guard.handleRequest(null, u, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.plain, sessionReq(u))),
    );
    expect(e).toBeInstanceOf(ForbiddenException);
    expect((e as ForbiddenException).getResponse()).toEqual({
      code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
      message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
    });
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith({
      grantId: GID,
      siteId: SITE_A,
      origin: 'partner',
      actorUserId: null,
      sessionId: S1,
      operatorId: 'op-7f3c',
      operatorName: '운영팀',
      action: 'request',
      method: 'PATCH',
      route: '/api/edit-sessions/:id',
      statusCode: 403,
      detail: { errorCode: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED' },
    });
    expect(writer.resolveGrantOrigin).not.toHaveBeenCalled();
  });

  it('files 컨트롤러 경로 거부 → resourceId 기록, sessionId null', () => {
    const u = operatorUser();
    const req = { method: 'DELETE', params: { id: 'file-1' }, route: { path: '/api/files/:id' }, user: u };
    expect(() => guard.handleRequest(null, u, undefined, httpCtx(FilesProbe, FilesProbe.prototype.plain, req))).toThrow(
      ForbiddenException,
    );
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: null,
        statusCode: 403,
        detail: { errorCode: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED', resourceId: 'file-1' },
      }),
    );
  });

  it("관리자 발급 권한 거부 → origin 'staff', actorUserId = 권한 발급자", () => {
    const u = operatorUser(grant({ origin: 'staff', issuedByUserId: 'u-admin-1', operatorId: 'staff.u-admin-1' }));
    expect(() =>
      guard.handleRequest(null, u, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.plain, sessionReq(u))),
    ).toThrow(ForbiddenException);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'staff', actorUserId: 'u-admin-1', operatorId: 'staff.u-admin-1', statusCode: 403 }),
    );
  });

  it('허용 핸들러를 통과한 운영자 요청은 가드에서 기록하지 않는다', () => {
    const u = operatorUser();
    expect(
      guard.handleRequest(null, u, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.allowed, sessionReq(u))),
    ).toBe(u);
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });

  it('shop·admin 사용자는 통과와 사용자 없음 401 모두 기록하지 않는다', () => {
    const shop = { userId: '777', source: 'shop', role: 'customer', siteId: SITE_A };
    const admin = { id: 'u1', role: 'ADMIN' };
    const ctx = httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.plain, sessionReq(shop));
    expect(guard.handleRequest(null, shop, undefined, ctx)).toBe(shop);
    expect(guard.handleRequest(null, admin, undefined, ctx)).toBe(admin);
    expect(() => guard.handleRequest(null, false, undefined, ctx)).toThrow(UnauthorizedException);
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });

  it('권한이 연결된 401 → 같은 예외 객체 그대로, 감사 행 1건(statusCode 401)', () => {
    const err = grantInvalidError();
    markRejectedOperatorGrant(err, grant());
    const e = caught(() =>
      guard.handleRequest(err, false, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.allowed, sessionReq())),
    );
    expect(e).toBe(err);
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith({
      grantId: GID,
      siteId: SITE_A,
      origin: 'partner',
      actorUserId: null,
      sessionId: S1,
      operatorId: 'op-7f3c',
      operatorName: '운영팀',
      action: 'request',
      method: 'PATCH',
      route: '/api/edit-sessions/:id',
      statusCode: 401,
      detail: { errorCode: 'PARTNER_OPERATOR_GRANT_INVALID' },
    });
  });

  it("관리자 발급 권한이 연결된 401 → origin 'staff', actorUserId null", () => {
    const err = grantInvalidError();
    markRejectedOperatorGrant(err, grant({ origin: 'staff', issuedByUserId: null, operatorId: 'staff.u-admin-1' }));
    expect(
      caught(() =>
        guard.handleRequest(err, false, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.allowed, sessionReq())),
      ),
    ).toBe(err);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'staff', actorUserId: null, operatorId: 'staff.u-admin-1', statusCode: 401 }),
    );
  });

  it('권한이 연결되지 않은 401(토큰 만료·클레임 불일치)은 기록하지 않는다', () => {
    const ctx = httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.allowed, sessionReq());
    const invalid = new UnauthorizedException('Invalid token');
    expect(caught(() => guard.handleRequest(invalid, false, undefined, ctx))).toBe(invalid);
    expect(() => guard.handleRequest(null, false, { name: 'TokenExpiredError' }, ctx)).toThrow(UnauthorizedException);
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });

  it('감사 기록기 없이 만든 가드도 403·401 응답이 같다', () => {
    const bare = new JwtAuthGuard(new Reflector());
    const ctx = ctxFor(EditSessionsProbe, EditSessionsProbe.prototype.plain);
    const e = caught(() => bare.handleRequest(null, operatorUser(), undefined, ctx));
    expect(e).toBeInstanceOf(ForbiddenException);
    expect((e as ForbiddenException).getResponse()).toEqual({
      code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
      message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
    });
    const err = grantInvalidError();
    markRejectedOperatorGrant(err, grant());
    expect(caught(() => bare.handleRequest(err, false, undefined, ctx))).toBe(err);
  });

  it('감사 기록이 실패해도 403 그대로, 처리되지 않은 거부가 생기지 않는다', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      writer.recordBestEffort.mockRejectedValueOnce(new Error('db down'));
      const u = operatorUser();
      expect(() =>
        guard.handleRequest(null, u, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.plain, sessionReq(u))),
      ).toThrow(ForbiddenException);
      await flush();
      await flush();
      expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('HTTP가 아닌 컨텍스트나 요청 접근 오류가 있어도 403 그대로이고 기록하지 않는다', () => {
    const u = operatorUser();
    expect(() =>
      guard.handleRequest(null, u, undefined, httpCtx(EditSessionsProbe, EditSessionsProbe.prototype.plain, sessionReq(u), 'rpc')),
    ).toThrow(ForbiddenException);
    const throwing = {
      getType: () => 'http',
      getHandler: () => EditSessionsProbe.prototype.plain,
      getClass: () => EditSessionsProbe,
      switchToHttp: () => {
        throw new Error('no http');
      },
    } as unknown as ExecutionContext;
    expect(() => guard.handleRequest(null, u, undefined, throwing)).toThrow(ForbiddenException);
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── 요청 감사 helper ─────────────────────────────
describe('partner-operator-request-audit', () => {
  it('operatorIdentityFromGrant: 파트너 권한은 origin partner, 관리자 권한은 origin staff·발급자', () => {
    expect(operatorIdentityFromGrant(grant())).toEqual({
      grantId: GID,
      siteId: SITE_A,
      operatorId: 'op-7f3c',
      operatorName: '운영팀',
      origin: 'partner',
      actorUserId: null,
    });
    expect(operatorIdentityFromGrant(grant({ origin: 'staff', issuedByUserId: 'u-1' }))).toMatchObject({
      origin: 'staff',
      actorUserId: 'u-1',
    });
    expect(operatorIdentityFromGrant(grant({ issuedByUserId: 'u-1' }))).toMatchObject({
      origin: 'partner',
      actorUserId: null,
    });
  });

  it('권한 연결은 예외의 응답 본문·키·직렬화를 바꾸지 않는다', () => {
    const err = new UnauthorizedException({
      code: 'PARTNER_OPERATOR_GRANT_INVALID',
      message: '운영자 권한이 만료되었거나 취소되었습니다.',
    });
    const keys = Object.keys(err);
    const body = JSON.stringify(err.getResponse());
    const serialized = JSON.stringify(err);
    const g = grant();
    markRejectedOperatorGrant(err, g);
    expect(Object.keys(err)).toEqual(keys);
    expect(JSON.stringify(err.getResponse())).toBe(body);
    expect(JSON.stringify(err)).toBe(serialized);
    expect(rejectedOperatorGrantOf(err)).toBe(g);
  });

  it('연결 없는 예외·null·원시값은 권한 없음, 원시값·null 연결 요청은 throw 하지 않는다', () => {
    expect(rejectedOperatorGrantOf(new UnauthorizedException())).toBeNull();
    expect(rejectedOperatorGrantOf(null)).toBeNull();
    expect(rejectedOperatorGrantOf(undefined)).toBeNull();
    expect(rejectedOperatorGrantOf('x')).toBeNull();
    for (const v of ['x', null, undefined, 1, true]) {
      expect(() => markRejectedOperatorGrant(v, grant())).not.toThrow();
      expect(rejectedOperatorGrantOf(v)).toBeNull();
    }
  });

  it('recordOperatorRequest 는 기록기가 throw·reject 해도 resolve 한다', async () => {
    const identity = { ...operatorIdentityFromGrant(grant()), origin: null };
    const syncThrow = {
      recordBestEffort: jest.fn(),
      resolveGrantOrigin: jest.fn(() => {
        throw new Error('sync');
      }),
    };
    await expect(
      recordOperatorRequest(syncThrow as unknown as PartnerOperatorAuditWriter, {
        identity,
        req: { method: 'GET' },
        controllerPath: null,
        statusCode: 200,
      }),
    ).resolves.toBeUndefined();
    expect(syncThrow.recordBestEffort).not.toHaveBeenCalled();

    const rejecting = {
      recordBestEffort: jest.fn().mockRejectedValue(new Error('db down')),
      resolveGrantOrigin: jest.fn(),
    };
    await expect(
      recordOperatorRequest(rejecting as unknown as PartnerOperatorAuditWriter, {
        identity: operatorIdentityFromGrant(grant()),
        req: null,
        controllerPath: 'edit-sessions',
        statusCode: 403,
        errorCode: 'X',
      }),
    ).resolves.toBeUndefined();
    expect(rejecting.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, method: null, route: null, statusCode: 403, detail: { errorCode: 'X' } }),
    );
  });

  it('controllerPathOf: 문자열 path 만 읽고 앞뒤 슬래시를 제거한다', () => {
    @SetMetadata('path', '/files/')
    class Slashed {}
    @SetMetadata('path', ['a', 'b'])
    class Multi {}
    class NoMeta {}
    expect(controllerPathOf(Slashed)).toBe('files');
    expect(controllerPathOf(Multi)).toBeNull();
    expect(controllerPathOf(NoMeta)).toBeNull();
    expect(controllerPathOf(undefined)).toBeNull();
    expect(controllerPathOf('files')).toBeNull();
  });
});

// ───────────────────────────── AuthService refresh ─────────────────────────────
describe('AuthService — refresh 분기', () => {
  const jwt = new JwtService({ secret: SECRET });

  afterEach(() => jest.useRealTimers());

  it('T16 회귀: shop 갱신 결과가 운영자 의존성 유무와 무관하게 바이트 단위로 동일', async () => {
    jest.useFakeTimers({ now: new Date('2026-09-29T00:00:00Z') });
    const grants = { refresh: jest.fn() };
    const legacy = new AuthService({} as never, jwt);
    const withOperator = new AuthService({} as never, jwt, grants as unknown as PartnerOperatorGrantService);
    const { refreshToken } = await legacy.createShopSession(
      { memberSeqno: 777, memberId: 'a@b.c', memberName: '홍', orderSeqno: 5 } as never,
      { siteId: SITE_A, siteName: 'Site A' },
    );
    const a = await legacy.refreshShopToken(refreshToken);
    const b = await withOperator.refreshShopToken(refreshToken);
    expect(b).toEqual(a);
    expect(b.expiresIn).toBe(3600);
    expect(Object.keys(jwt.verify(b.accessToken)).sort()).toEqual(
      ['allowedOrderSeqnos', 'email', 'exp', 'iat', 'name', 'permissions', 'role', 'siteId', 'siteName', 'source', 'sub'].sort(),
    );
    expect(grants.refresh).not.toHaveBeenCalled();
  });

  it('운영자 리프레시 토큰 → 권한 서비스 refresh 로 위임', async () => {
    const grants = { refresh: jest.fn().mockResolvedValue({ accessToken: 'NEW', expiresIn: 900 }) };
    const svc = new AuthService({} as never, jwt, grants as unknown as PartnerOperatorGrantService);
    const token = jwt.sign(claims('refresh'), { expiresIn: 600 });
    await expect(svc.refreshShopToken(token)).resolves.toEqual({ accessToken: 'NEW', expiresIn: 900 });
    expect(grants.refresh).toHaveBeenCalledTimes(1);
  });

  it('운영자 갱신 실패 → 종전과 같은 401 REFRESH_TOKEN_EXPIRED 본문', async () => {
    const grants = { refresh: jest.fn().mockRejectedValue(new UnauthorizedException('x')) };
    const svc = new AuthService({} as never, jwt, grants as unknown as PartnerOperatorGrantService);
    const token = jwt.sign(claims('refresh'), { expiresIn: 600 });
    let caught: unknown;
    try {
      await svc.refreshShopToken(token);
    } catch (e) {
      caught = e;
    }
    expect((caught as HttpException).getStatus()).toBe(401);
    expect((caught as HttpException).getResponse()).toEqual({
      success: false,
      error: 'REFRESH_TOKEN_EXPIRED',
      redirectUrl: '/login',
    });
  });

  it('운영자 의존성 없는 구성에서 운영자 리프레시 → 401 (shop 경로로 새지 않음)', async () => {
    const svc = new AuthService({} as never, jwt);
    const token = jwt.sign(claims('refresh'), { expiresIn: 600 });
    await expect(svc.refreshShopToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('admin /auth/refresh 는 운영자 토큰을 DB 조회 전에 거부', async () => {
    const userRepo = { findOne: jest.fn() };
    const svc = new AuthService(userRepo as unknown as Repository<User>, jwt);
    const token = jwt.sign(claims('refresh'), { expiresIn: 600 });
    await expect(svc.refreshToken(token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── AuthController ─────────────────────────────
describe('AuthController — POST /auth/me · 발급 라우트', () => {
  const grants = {
    mint: jest.fn().mockResolvedValue({ success: true }),
    revoke: jest.fn().mockResolvedValue({ success: true, revoked: 0 }),
    audit: jest.fn().mockResolvedValue({ success: true, items: [] }),
  };
  const controller = new AuthController({} as never, grants as unknown as PartnerOperatorGrantService);

  beforeEach(() => jest.clearAllMocks());

  it('getMe: 운영자 → role customer + source partner_operator + operator 블록', async () => {
    const g = grant({ capabilities: ['edit', 'delete'] });
    const out = await controller.getMe(operatorUser(g));
    expect(out).toEqual({
      userId: 'po:op-7f3c',
      email: '',
      name: '운영팀',
      role: 'customer',
      source: 'partner_operator',
      siteId: SITE_A,
      siteName: 'Site A',
      operator: {
        id: 'op-7f3c',
        name: '운영팀',
        grantId: GID,
        grantExpiresAt: new Date(g.grantExpiresAt * 1000).toISOString(),
        capabilities: ['edit', 'delete'],
      },
    });
  });

  it('getMe 회귀: shop 사용자 · admin User 는 종전 출력 그대로', async () => {
    const shop = { userId: '777', email: 'a@b.c', name: '홍', role: 'customer', source: 'shop', permissions: ['edit'] };
    expect(await controller.getMe(shop as unknown as User)).toEqual(shop);
    const admin = { id: 'u1', email: 'x@y', role: 'ADMIN', passwordHash: 'hash', createdAt: new Date(0), updatedAt: new Date(0) };
    const out = await controller.getMe(admin as unknown as User);
    expect(out).toEqual({ id: 'u1', email: 'x@y', role: 'ADMIN', createdAt: new Date(0), updatedAt: new Date(0) });
  });

  it('getMe 는 운영자 허용 핸들러, GET /auth/me(admin UI) 는 아니다', () => {
    expect(Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, AuthController.prototype.getMe)).toBe(true);
    expect(Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, AuthController.prototype.getMeForAdmin)).toBeUndefined();
  });

  const editorSite: CurrentSitePayload = { siteId: SITE_A, siteName: 'Site A', role: 'editor', apiKey: 'k' };

  it.each<[string, CurrentSitePayload | undefined]>([
    ['사이트 컨텍스트 없음(브라우저/JWT 호출)', undefined],
    ['내부 worker 키', { ...editorSite, role: 'worker' }],
  ])('발급·취소·조회: %s → 403, 서비스 미호출', async (_l, site) => {
    const dto = Object.assign(new CreatePartnerOperatorSessionDto(), { operatorId: 'op', sessionIds: [S1] });
    await expect(controller.createPartnerOperatorSession(dto, site)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.revokePartnerOperatorSession({ all: true }, site)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.listPartnerOperatorAudit({}, site)).rejects.toBeInstanceOf(ForbiddenException);
    expect(grants.mint).not.toHaveBeenCalled();
    expect(grants.revoke).not.toHaveBeenCalled();
    expect(grants.audit).not.toHaveBeenCalled();
  });

  it('편집기 키 → 서비스로 위임', async () => {
    const dto = Object.assign(new CreatePartnerOperatorSessionDto(), { operatorId: 'op', sessionIds: [S1] });
    await controller.createPartnerOperatorSession(dto, editorSite);
    expect(grants.mint).toHaveBeenCalledWith(dto, editorSite);
  });

  it('브라우저(Bearer 만, X-API-Key 없음) 는 ApiKeyGuard 에서 401 — 발급 불가', async () => {
    const sites = { findByEditorAuthCode: jest.fn(), findByWorkerAuthCode: jest.fn() };
    const apiKeyGuard = new ApiKeyGuard(sites as unknown as SitesService);
    const req = { headers: { authorization: `Bearer ${new JwtService({ secret: SECRET }).sign(claims('access'))}` } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    await expect(apiKeyGuard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sites.findByEditorAuthCode).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── OptionalShopJwtGuard ─────────────────────────────
describe('OptionalShopJwtGuard — 운영자 분기(절대 throw 하지 않음)', () => {
  const jwt = new JwtService({ secret: SECRET });
  const guard = new OptionalShopJwtGuard(jwt);
  const run = (authorization?: string): Record<string, unknown> => {
    const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    expect(guard.canActivate(ctx)).toBe(true);
    return req;
  };

  it('유효 운영자 액세스 토큰 → req.user.source partner_operator + siteId + grantId', () => {
    const req = run(`Bearer ${jwt.sign(claims('access'))}`);
    expect(req.user).toEqual({
      userId: 'po:op-7f3c',
      source: 'partner_operator',
      siteId: SITE_A,
      siteName: 'Site A',
      grantId: GID,
      operatorId: 'op-7f3c',
    });
  });

  it.each<[string, () => string]>([
    ['운영자 리프레시 토큰', () => jwt.sign(claims('refresh'))],
    ['다른 시크릿으로 서명', () => new JwtService({ secret: 'other' }).sign(claims('access'))],
    ['혼합 클레임(source shop + typ 운영자)', () => jwt.sign(claims('access', { source: 'shop' }))],
    ['권한 만료(gexp 과거)', () => jwt.sign(claims('access', { gexp: nowSec() - 1 }))],
  ])('%s → req.user 미설정(익명 취급)', (_l, token) => {
    const req = run(`Bearer ${token()}`);
    expect(req.user).toBeUndefined();
  });

  it('회귀: shop 토큰은 종전 형태 그대로', () => {
    const token = jwt.sign({ sub: '777', role: 'customer', source: 'shop', siteId: SITE_A, siteName: 'Site A' });
    const req = run(`Bearer ${token}`);
    expect(req.user).toEqual({
      userId: '777',
      source: 'shop',
      siteId: SITE_A,
      siteName: 'Site A',
      allowedOrderSeqnos: undefined,
    });
  });

  it('토큰 없음/형식 오류 → 통과, req.user 미설정', () => {
    expect(run().user).toBeUndefined();
    expect(run('Basic abc').user).toBeUndefined();
  });
});

// ───────────────────────────── 감사 인터셉터 ─────────────────────────────
describe('PartnerOperatorAuditInterceptor', () => {
  const writer = {
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
    resolveGrantOrigin: jest.fn().mockResolvedValue({ origin: 'partner', issuedByUserId: null }),
  };
  const interceptor = new PartnerOperatorAuditInterceptor(writer as unknown as PartnerOperatorAuditWriter);

  @SetMetadata('path', 'edit-sessions')
  class EditSessionsLike {}
  @SetMetadata('path', 'files')
  class FilesLike {}

  const ctx = (cls: object, req: Record<string, unknown>, statusCode = 200): ExecutionContext =>
    ({
      getType: () => 'http',
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode }) }),
    }) as unknown as ExecutionContext;
  const handlerOk: CallHandler = { handle: () => of({ ok: true }) };

  beforeEach(() => {
    writer.recordBestEffort.mockClear();
    writer.resolveGrantOrigin.mockClear();
  });
  /** 평면 스탬프 사용자는 권한 행 출처 조회(비동기) 뒤에 기록된다 */
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

  it('운영자 요청 성공 → request 행(sessionId·메서드·라우트·상태코드), 본문 없음', async () => {
    const req = {
      method: 'PATCH',
      params: { id: S1 },
      route: { path: '/api/edit-sessions/:id' },
      user: operatorUser(),
      body: { canvasData: [{ secret: 'canvas' }] },
    };
    await lastValueFrom(interceptor.intercept(ctx(EditSessionsLike, req), handlerOk));
    expect(writer.recordBestEffort).toHaveBeenCalledWith({
      grantId: GID,
      siteId: SITE_A,
      origin: 'partner',
      actorUserId: null,
      sessionId: S1,
      operatorId: 'op-7f3c',
      operatorName: '운영팀',
      action: 'request',
      method: 'PATCH',
      route: '/api/edit-sessions/:id',
      statusCode: 200,
      detail: null,
    });
    expect(JSON.stringify(writer.recordBestEffort.mock.calls[0][0])).not.toContain('canvas');
  });

  it('OptionalShopJwtGuard 사용자(@Public 라우트)도 기록, files 는 resourceId', async () => {
    const req = {
      method: 'POST',
      params: { id: 'file-1' },
      route: { path: '/api/files/:id/complete' },
      user: { userId: 'po:op', source: 'partner_operator', siteId: SITE_A, siteName: '', grantId: GID, operatorId: 'op' },
    };
    await lastValueFrom(interceptor.intercept(ctx(FilesLike, req, 200), handlerOk));
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: null, detail: { resourceId: 'file-1' }, operatorId: 'op', origin: 'partner' }),
    );
    expect(writer.resolveGrantOrigin).toHaveBeenCalledWith(GID);
  });

  it('오류 → 원래 오류 그대로 전달 + 상태코드·오류 코드 기록', async () => {
    const err = new ForbiddenException({ code: 'PARTNER_OPERATOR_CAPABILITY_REQUIRED', message: 'x' });
    const req = { method: 'DELETE', params: { id: S1 }, route: { path: '/api/edit-sessions/:id' }, user: operatorUser() };
    await expect(
      lastValueFrom(interceptor.intercept(ctx(EditSessionsLike, req), { handle: () => throwError(() => err) })),
    ).rejects.toBe(err);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403, detail: { errorCode: 'PARTNER_OPERATOR_CAPABILITY_REQUIRED' } }),
    );
  });

  it('관리자 발급 권한(JwtStrategy 사용자, origin staff) → origin staff + actorUserId = 권한 행 발급자', async () => {
    const staffGrant = grant({ origin: 'staff', issuedByUserId: 'u-admin-1', operatorId: 'staff.u-admin-1' });
    const req = { method: 'PATCH', params: { id: S1 }, route: { path: '/api/edit-sessions/:id' }, user: operatorUser(staffGrant) };
    await lastValueFrom(interceptor.intercept(ctx(EditSessionsLike, req), handlerOk));
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ origin: 'staff', actorUserId: 'u-admin-1', operatorId: 'staff.u-admin-1' }),
    );
    expect(writer.resolveGrantOrigin).not.toHaveBeenCalled();
  });

  it('평면 스탬프 사용자: 권한 행 출처로 기록(관리자 요청이 파트너 감사에 섞이지 않음), 조회 실패·행 없음 → 기록 안 함', async () => {
    const flat = { userId: 'po:x', source: 'partner_operator', siteId: SITE_A, siteName: '', grantId: GID, operatorId: 'staff.u-9' };
    writer.resolveGrantOrigin.mockResolvedValueOnce({ origin: 'staff', issuedByUserId: 'u-9' });
    await lastValueFrom(interceptor.intercept(ctx(FilesLike, { method: 'POST', params: {}, user: flat }), handlerOk));
    await flush();
    expect(writer.recordBestEffort).toHaveBeenLastCalledWith(expect.objectContaining({ origin: 'staff', actorUserId: 'u-9' }));

    writer.recordBestEffort.mockClear();
    writer.resolveGrantOrigin.mockResolvedValueOnce(null);
    await lastValueFrom(interceptor.intercept(ctx(FilesLike, { method: 'POST', params: {}, user: flat }), handlerOk));
    await flush();
    writer.resolveGrantOrigin.mockRejectedValueOnce(new Error('db down'));
    await lastValueFrom(interceptor.intercept(ctx(FilesLike, { method: 'POST', params: {}, user: flat }), handlerOk));
    await new Promise((r) => setImmediate(r));
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });

  it('운영자가 아닌 요청 → no-op', async () => {
    const req = { method: 'GET', params: {}, user: { userId: '777', source: 'shop', siteId: SITE_A } };
    await lastValueFrom(interceptor.intercept(ctx(EditSessionsLike, req), handlerOk));
    await lastValueFrom(interceptor.intercept(ctx(EditSessionsLike, { method: 'GET' }), handlerOk));
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });
});

// ───────────────────────────── DTO (전역 ValidationPipe 구성) ─────────────────────────────
describe('CreatePartnerOperatorSessionDto — whitelist/forbidNonWhitelisted', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (body: Record<string, unknown>): Promise<CreatePartnerOperatorSessionDto> =>
    pipe.transform(body, { type: 'body', metatype: CreatePartnerOperatorSessionDto });

  it('정상 요청 + sessionIds 중복 제거', async () => {
    const dto = await validate({ operatorId: 'op-1', sessionIds: [S1, S1], allowDelete: true, ttlSeconds: 600 });
    expect(dto.sessionIds).toEqual([S1]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["operatorId 에 '@'(이메일)", { operatorId: 'a@b.c', sessionIds: [S1] }],
    ['sessionIds 21개', { operatorId: 'op', sessionIds: Array.from({ length: 21 }, (_, i) => `${i.toString(16).padStart(8, '0')}-1111-4111-8111-111111111111`) }],
    ['sessionIds 비UUID', { operatorId: 'op', sessionIds: ['nope'] }],
    ['ttlSeconds 상한 초과', { operatorId: 'op', sessionIds: [S1], ttlSeconds: 28801 }],
    ['ttlSeconds 하한 미만', { operatorId: 'op', sessionIds: [S1], ttlSeconds: 299 }],
    ['orderSeqnos(미지원 필드)', { operatorId: 'op', sessionIds: [S1], orderSeqnos: [1] }],
    ['siteId 주장(미지원 필드)', { operatorId: 'op', sessionIds: [S1], siteId: SITE_A }],
  ])('%s → 400', async (_l, body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ───────────────────────────── 모듈 배선 ─────────────────────────────
describe('AuthModule 배선', () => {
  const providers = (Reflect.getMetadata('providers', AuthModule) ?? []) as unknown[];

  it('관리자 편집데이터 모듈용으로 권한 서비스·감사 기록기를 export 한다', () => {
    const exported = (Reflect.getMetadata('exports', AuthModule) ?? []) as unknown[];
    expect(exported).toContain(PartnerOperatorGrantService);
    expect(exported).toContain(PartnerOperatorAuditWriter);
  });

  it('권한 서비스·감사 기록기·전역 감사 인터셉터를 등록한다', () => {
    expect(providers).toContain(PartnerOperatorGrantService);
    expect(providers).toContain(PartnerOperatorAuditWriter);
    expect(providers).toContainEqual({ provide: APP_INTERCEPTOR, useClass: PartnerOperatorAuditInterceptor });
  });

  it('JwtAuthGuard 의 감사 기록기는 선택 의존성이다', () => {
    const optional = (Reflect.getMetadata(OPTIONAL_DEPS_METADATA, JwtAuthGuard) ?? []) as unknown[];
    expect(optional).toContain(1);
  });

  it('감사 기록기가 없는 모듈의 @UseGuards(JwtAuthGuard) 컨트롤러도 구성된다', async () => {
    @Controller('no-writer-probe')
    @UseGuards(JwtAuthGuard)
    class NoWriterProbe {
      @Post()
      run(): void {}
    }
    const moduleRef = await Test.createTestingModule({ controllers: [NoWriterProbe] }).compile();
    await moduleRef.close();
  });

  it('PartnerOperatorClaims 타입은 claimsFromGrant 출력과 일치(컴파일 확인)', () => {
    const c: PartnerOperatorClaims = claimsFromGrant(grant(), 'Site A', 'access');
    expect(c.typ).toBe('partner_operator');
  });
});
