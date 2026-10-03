/**
 * 운영자 요청 감사 HTTP 회귀 (2026-10-03).
 *
 *  - 핸들러를 통과한 운영자 요청: 감사 행 statusCode 가 실제 응답 상태와 같다(@HttpCode 없는 POST 201,
 *    @HttpCode(200) 200, HttpException 핸들러 예외는 그 상태·오류 코드).
 *  - 가드 단계 거부: 허용 표시 없는 핸들러 403·권한 행 확인 실패 401 도 action 'request' 행 1건,
 *    응답 상태·본문은 그대로. 라우트 수준 가드가 함께 걸려도 행은 1건.
 *  - 액세스 토큰 만료(검증된 신원 없음)·shop 토큰은 기록하지 않는다.
 *
 * 실제 JwtStrategy·JwtAuthGuard(APP_GUARD)·PartnerOperatorAuditInterceptor(APP_INTERCEPTOR) 구성.
 * 권한 서비스·감사 기록기는 mock 이며, 401 경로는 실제 PartnerOperatorGrantService.assertActive 를 쓴다.
 */
import 'reflect-metadata';
import {
  ConflictException,
  Controller,
  Delete,
  HttpCode,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { JwtStrategy } from '../strategies/jwt.strategy';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { PartnerOperatorAllowed } from '../decorators/partner-operator-allowed.decorator';
import { PartnerOperatorGrantService } from './partner-operator-grant.service';
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import { PartnerOperatorAuditInterceptor } from './partner-operator-audit.interceptor';
import { PartnerOperatorGrant, claimsFromGrant } from './partner-operator.types';

const SECRET = 'partner-operator-audit-http-spec';
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

@Controller('edit-sessions')
class SessionProbeController {
  @Post(':id/probe-created')
  @PartnerOperatorAllowed()
  created(): { ok: boolean } {
    return { ok: true };
  }

  @Post(':id/probe-ok')
  @HttpCode(200)
  @PartnerOperatorAllowed()
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Post(':id/probe-conflict')
  @PartnerOperatorAllowed()
  conflict(): never {
    throw new ConflictException({ code: 'PROBE_CONFLICT', message: 'x' });
  }

  @Post(':id/probe-denied')
  denied(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('files')
class FilesProbeController {
  @Delete(':id')
  remove(): { ok: boolean } {
    return { ok: true };
  }
}

@Controller('route-guarded')
@UseGuards(JwtAuthGuard)
class RouteGuardedProbeController {
  @Post(':id')
  denied(): { ok: boolean } {
    return { ok: true };
  }
}

const ROUTE_NOT_ALLOWED_BODY = {
  code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
  message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
};
const GRANT_INVALID_BODY = {
  code: 'PARTNER_OPERATOR_GRANT_INVALID',
  message: '운영자 권한이 만료되었거나 취소되었습니다.',
};

describe('운영자 요청 감사 — HTTP 상태코드·가드 단계 거부', () => {
  let app: INestApplication;
  const jwt = new JwtService({ secret: SECRET });
  const writer = {
    recordBestEffort: jest.fn().mockResolvedValue(undefined),
    resolveGrantOrigin: jest.fn(),
  };
  const grants = { assertActive: jest.fn().mockResolvedValue(undefined) };

  /** 권한 행 조회 결과 없음 → 실제 assertActive 가 401 PARTNER_OPERATOR_GRANT_INVALID */
  const realGrants = (): PartnerOperatorGrantService => {
    const qb = {
      innerJoin: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      where: jest.fn(),
      getRawOne: jest.fn().mockResolvedValue(undefined),
    };
    qb.innerJoin.mockReturnValue(qb);
    qb.select.mockReturnValue(qb);
    qb.addSelect.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    return new PartnerOperatorGrantService(
      jwt,
      {} as never,
      { createQueryBuilder: jest.fn(() => qb) } as never,
      {} as never,
      {} as never,
    );
  };

  const operatorToken = (g: PartnerOperatorGrant = grant()): string =>
    jwt.sign(claimsFromGrant(g, 'Site A', 'access'), { expiresIn: 600 });
  const shopToken = (): string =>
    jwt.sign({ sub: '777', source: 'shop', role: 'customer', siteId: SITE_A }, { expiresIn: 600 });
  const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [SessionProbeController, FilesProbeController, RouteGuardedProbeController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(SECRET) } },
        { provide: getRepositoryToken(User), useValue: { findOne: jest.fn().mockResolvedValue(null) } },
        { provide: PartnerOperatorGrantService, useValue: grants },
        { provide: PartnerOperatorAuditWriter, useValue: writer },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_INTERCEPTOR, useClass: PartnerOperatorAuditInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    writer.recordBestEffort.mockReset().mockResolvedValue(undefined);
    writer.resolveGrantOrigin.mockReset();
    grants.assertActive.mockReset().mockResolvedValue(undefined);
  });

  it('운영자 허용 POST(@HttpCode 없음) → 201, 감사 행 statusCode 201', async () => {
    await http()
      .post(`/api/edit-sessions/${S1}/probe-created`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(201);
    await flush();
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
      method: 'POST',
      route: '/api/edit-sessions/:id/probe-created',
      statusCode: 201,
      detail: null,
    });
  });

  it('@HttpCode(200) POST → 200, 감사 행 statusCode 200', async () => {
    await http()
      .post(`/api/edit-sessions/${S1}/probe-ok`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(200);
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 200, route: '/api/edit-sessions/:id/probe-ok', detail: null }),
    );
  });

  it('HttpException 핸들러 예외 → 응답 상태와 같은 감사 statusCode·errorCode', async () => {
    const res = await http()
      .post(`/api/edit-sessions/${S1}/probe-conflict`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(409);
    expect(res.body).toEqual({ code: 'PROBE_CONFLICT', message: 'x' });
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 409, detail: { errorCode: 'PROBE_CONFLICT' } }),
    );
  });

  it('허용 표시 없는 핸들러 → 403 본문 그대로, 가드 행 1건만 기록', async () => {
    const res = await http()
      .post(`/api/edit-sessions/${S1}/probe-denied`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(403);
    expect(res.body).toEqual(ROUTE_NOT_ALLOWED_BODY);
    await flush();
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
      method: 'POST',
      route: '/api/edit-sessions/:id/probe-denied',
      statusCode: 403,
      detail: { errorCode: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED' },
    });
  });

  it('files 경로 거부 → 403, resourceId 기록', async () => {
    await http()
      .delete('/api/files/file-1')
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(403);
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: null,
        method: 'DELETE',
        route: '/api/files/:id',
        statusCode: 403,
        detail: { errorCode: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED', resourceId: 'file-1' },
      }),
    );
  });

  it('클래스 수준 @UseGuards(JwtAuthGuard) + 전역 가드 → 403, 감사 행 1건', async () => {
    const res = await http()
      .post('/api/route-guarded/x-1')
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(403);
    expect(res.body).toEqual(ROUTE_NOT_ALLOWED_BODY);
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/route-guarded/:id', statusCode: 403, sessionId: null }),
    );
  });

  it('권한 행 확인 실패 → 401 본문 그대로, 감사 행 statusCode 401', async () => {
    const real = realGrants();
    grants.assertActive.mockImplementationOnce((g: PartnerOperatorGrant) => real.assertActive(g));
    const res = await http()
      .post(`/api/edit-sessions/${S1}/probe-created`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(401);
    expect(res.body).toEqual(GRANT_INVALID_BODY);
    await flush();
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
      method: 'POST',
      route: '/api/edit-sessions/:id/probe-created',
      statusCode: 401,
      detail: { errorCode: 'PARTNER_OPERATOR_GRANT_INVALID' },
    });
  });

  it("관리자 발급 권한 확인 실패 → 401 본문 그대로, 감사 행 origin 'staff'", async () => {
    const real = realGrants();
    grants.assertActive.mockImplementationOnce((g: PartnerOperatorGrant) => real.assertActive(g));
    const staff = grant({ origin: 'staff', operatorId: 'staff.u-admin-1', operatorName: 'Storige 관리자' });
    const res = await http()
      .post(`/api/edit-sessions/${S1}/probe-created`)
      .set('Authorization', `Bearer ${operatorToken(staff)}`)
      .expect(401);
    expect(res.body).toEqual(GRANT_INVALID_BODY);
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
    expect(writer.recordBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'staff',
        actorUserId: null,
        operatorId: 'staff.u-admin-1',
        statusCode: 401,
        detail: { errorCode: 'PARTNER_OPERATOR_GRANT_INVALID' },
      }),
    );
  });

  it('감사 기록이 실패해도 403 상태·본문이 같다', async () => {
    writer.recordBestEffort.mockRejectedValueOnce(new Error('db down'));
    const res = await http()
      .post(`/api/edit-sessions/${S1}/probe-denied`)
      .set('Authorization', `Bearer ${operatorToken()}`)
      .expect(403);
    expect(res.body).toEqual(ROUTE_NOT_ALLOWED_BODY);
    await flush();
    expect(writer.recordBestEffort).toHaveBeenCalledTimes(1);
  });

  it('만료된 운영자 액세스 토큰 → 401, 감사 행 없음', async () => {
    const expired = jwt.sign({ ...claimsFromGrant(grant(), 'Site A', 'access'), exp: nowSec() - 30 });
    await http()
      .post(`/api/edit-sessions/${S1}/probe-created`)
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    await flush();
    expect(grants.assertActive).not.toHaveBeenCalled();
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });

  it('shop 토큰 → 허용·비허용 핸들러 모두 종전 응답, 감사 행 없음', async () => {
    await http()
      .post(`/api/edit-sessions/${S1}/probe-created`)
      .set('Authorization', `Bearer ${shopToken()}`)
      .expect(201);
    await http()
      .post(`/api/edit-sessions/${S1}/probe-denied`)
      .set('Authorization', `Bearer ${shopToken()}`)
      .expect(201);
    await flush();
    expect(writer.recordBestEffort).not.toHaveBeenCalled();
  });
});
