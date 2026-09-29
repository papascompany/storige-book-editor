/**
 * /api/admin/edit-data 컨트롤러 표면(2026-09-29) — 경로·가드·역할·운영자 토큰 거부·공개 라우트 없음·
 * 파라미터 파이프·DTO 화이트리스트·서비스 위임.
 */
import 'reflect-metadata';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  ParseEnumPipe,
  ParseUUIDPipe,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { UserRole } from '@storige/types';
import type { Response } from 'express';
import { StaffEditDataController } from './staff-edit-data.controller';
import { StaffEditDataService } from './staff-edit-data.service';
import { StaffEditDataModule } from './staff-edit-data.module';
import {
  ListStaffSessionsQueryDto,
  StaffEditorSessionDto,
  StaffSessionFileKind,
  StaffSynthesizeDto,
} from './dto/staff-edit-data.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { PARTNER_OPERATOR_ALLOWED_KEY } from '../auth/decorators/partner-operator-allowed.decorator';
import { AuthModule } from '../auth/auth.module';
import { EditSessionsModule } from '../edit-sessions/edit-sessions.module';
import { WorkerJobsModule } from '../worker-jobs/worker-jobs.module';
import { FilesModule } from '../files/files.module';

const ID = '11111111-1111-4111-8111-111111111111';

type Handler = keyof StaffEditDataController;
const ROUTES: Array<[Handler, RequestMethod, string]> = [
  ['listSessions', RequestMethod.GET, 'sessions'],
  ['listJobs', RequestMethod.GET, 'sessions/:id/jobs'],
  ['downloadJobOutput', RequestMethod.GET, 'jobs/:jobId/output'],
  ['downloadSessionFile', RequestMethod.GET, 'sessions/:id/files/:kind'],
  ['openEditorSession', RequestMethod.POST, 'sessions/:id/editor-session'],
  ['listGrants', RequestMethod.GET, 'sessions/:id/grants'],
  ['revokeGrant', RequestMethod.POST, 'grants/:grantId/revoke'],
  ['complete', RequestMethod.POST, 'sessions/:id/complete'],
  ['remove', RequestMethod.DELETE, 'sessions/:id'],
  ['restore', RequestMethod.POST, 'sessions/:id/restore'],
  ['synthesize', RequestMethod.POST, 'sessions/:id/synthesize'],
  ['retentionReport', RequestMethod.GET, 'retention-report'],
  ['audit', RequestMethod.GET, 'audit'],
];

const handlerFn = (name: Handler): (...args: never[]) => unknown =>
  (StaffEditDataController.prototype as unknown as Record<string, (...args: never[]) => unknown>)[name];

describe('StaffEditDataController — 표면', () => {
  it("@Controller('admin/edit-data') + JwtAuthGuard·RolesGuard + 관리자 역할 4종", () => {
    expect(Reflect.getMetadata(PATH_METADATA, StaffEditDataController)).toBe('admin/edit-data');
    const guards = Reflect.getMetadata(GUARDS_METADATA, StaffEditDataController) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, RolesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, StaffEditDataController)).toEqual([
      UserRole.ADMIN,
      UserRole.MANAGER,
      UserRole.SITE_ADMIN,
      UserRole.SITE_MANAGER,
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StaffEditDataController)).toBeUndefined();
  });

  it.each(ROUTES)('%s → %s %s, 공개·운영자 허용 표시 없음', (name, method, path) => {
    const fn = handlerFn(name);
    expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, fn)).toBe(path);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(PARTNER_OPERATOR_ALLOWED_KEY, fn)).toBeUndefined();
  });

  it('id 파라미터는 ParseUUIDPipe, kind 는 ParseEnumPipe', () => {
    for (const [name, , path] of ROUTES) {
      if (!path.includes(':')) continue;
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, StaffEditDataController, name) as Record<
        string,
        { data?: string; pipes?: unknown[] }
      >;
      const params = Object.values(args).filter((a) => typeof a.data === 'string' && path.includes(`:${a.data}`));
      expect(params.length).toBeGreaterThan(0);
      for (const p of params) {
        const pipe = (p.pipes ?? [])[0];
        if (p.data === 'kind') expect(pipe).toBeInstanceOf(ParseEnumPipe);
        else expect(pipe === ParseUUIDPipe || pipe instanceof ParseUUIDPipe).toBe(true);
      }
    }
  });

  it('kind 파이프: cover/content/contentPdf 만 허용', async () => {
    const pipe = new ParseEnumPipe(StaffSessionFileKind);
    // ParseEnumPipe.transform 의 선언 타입은 enum 객체 — 런타임 입력은 경로 문자열이다.
    const raw = (v: string): typeof StaffSessionFileKind => v as unknown as typeof StaffSessionFileKind;
    await expect(pipe.transform(raw('contentPdf'), { type: 'param' })).resolves.toBe('contentPdf');
    await expect(pipe.transform(raw('../etc'), { type: 'param' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('가드 — 운영자 토큰·shop 토큰 거부, SUPER_ADMIN 통과', () => {
  const reflector = new Reflector();
  const ctx = (name: Handler, user: unknown): ExecutionContext =>
    ({
      getHandler: () => handlerFn(name),
      getClass: () => StaffEditDataController,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('운영자 토큰(관리자 발급 포함) → JwtAuthGuard 403 PARTNER_OPERATOR_ROUTE_NOT_ALLOWED', () => {
    const guard = new JwtAuthGuard(reflector);
    const op = { userId: 'po:staff.x', source: 'partner_operator', role: 'partner_operator', partnerOperator: {} };
    for (const [name] of ROUTES) {
      expect(() => guard.handleRequest(null, op, undefined, ctx(name, op))).toThrow(ForbiddenException);
    }
  });

  it('RolesGuard: shop 토큰·CUSTOMER → 거부, 관리자 4종·SUPER_ADMIN → 통과', () => {
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctx('listSessions', { userId: '1', role: 'customer', source: 'shop' }))).toBe(false);
    expect(guard.canActivate(ctx('listSessions', { id: 'u', role: UserRole.CUSTOMER }))).toBe(false);
    for (const role of [UserRole.ADMIN, UserRole.MANAGER, UserRole.SITE_ADMIN, UserRole.SITE_MANAGER, UserRole.SUPER_ADMIN]) {
      expect(guard.canActivate(ctx('complete', { id: 'u', role }))).toBe(true);
    }
  });
});

describe('DTO 화이트리스트(전역 ValidationPipe 구성)', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });

  it.each([
    ['siteId', { siteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    ['callbackUrl', { callbackUrl: 'https://evil.example.com/cb' }],
    ['outputMode 미지원 값', { outputMode: 'merged' }],
    ['reason 201자', { reason: 'x'.repeat(201) }],
  ])('synthesize body %s → 400', async (_l, body) => {
    await expect(pipe.transform(body, { type: 'body', metatype: StaffSynthesizeDto })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('synthesize 정상 body', async () => {
    const dto = (await pipe.transform(
      { outputMode: 'separate', notifyPartner: true, allowStale: false, reason: '재합성' },
      { type: 'body', metatype: StaffSynthesizeDto },
    )) as StaffSynthesizeDto;
    expect(dto.outputMode).toBe('separate');
  });

  it('editor-session: ttl 300..28800, 그 외 키 거부', async () => {
    await expect(pipe.transform({ ttlSeconds: 299 }, { type: 'body', metatype: StaffEditorSessionDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ sessionIds: [ID] }, { type: 'body', metatype: StaffEditorSessionDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ allowDelete: true, ttlSeconds: 3600 }, { type: 'body', metatype: StaffEditorSessionDto })).resolves.toBeDefined();
  });

  it('목록 쿼리: 숫자 변환 + limit 상한 100 + 필터 enum', async () => {
    const q = (await pipe.transform(
      { page: '2', limit: '50', retention: 'expired', deleted: 'only', orderSeqno: '12' },
      { type: 'query', metatype: ListStaffSessionsQueryDto },
    )) as ListStaffSessionsQueryDto;
    expect(q).toMatchObject({ page: 2, limit: 50, retention: 'expired', deleted: 'only', orderSeqno: 12 });
    await expect(pipe.transform({ limit: '101' }, { type: 'query', metatype: ListStaffSessionsQueryDto })).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ retention: 'all' }, { type: 'query', metatype: ListStaffSessionsQueryDto })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('서비스 위임 · 모듈 배선', () => {
  it('각 핸들러는 (user, …) 순서로 서비스에 위임한다', async () => {
    const svc = {
      listSessions: jest.fn(),
      listJobs: jest.fn(),
      streamJobOutput: jest.fn(),
      streamSessionFile: jest.fn(),
      openEditorSession: jest.fn(),
      listGrants: jest.fn(),
      revokeGrant: jest.fn(),
      complete: jest.fn(),
      remove: jest.fn(),
      restore: jest.fn(),
      synthesize: jest.fn(),
      retentionReport: jest.fn(),
      audit: jest.fn(),
    };
    const c = new StaffEditDataController(svc as unknown as StaffEditDataService);
    const user = { id: 'u', role: UserRole.ADMIN };
    const res = {} as Response;
    await c.listSessions({}, user);
    await c.listJobs(ID, user);
    await c.downloadJobOutput(ID, res, user);
    await c.downloadSessionFile(ID, StaffSessionFileKind.cover, res, user);
    await c.openEditorSession(ID, {}, user);
    await c.listGrants(ID, user);
    await c.revokeGrant(ID, user);
    await c.complete(ID, user);
    await c.remove(ID, user);
    await c.restore(ID, user);
    await c.synthesize(ID, {}, user);
    await c.retentionReport({}, user);
    await c.audit({}, user);
    expect(svc.streamJobOutput).toHaveBeenCalledWith(user, ID, res);
    expect(svc.streamSessionFile).toHaveBeenCalledWith(user, ID, 'cover', res);
    expect(svc.synthesize).toHaveBeenCalledWith(user, ID, {});
    for (const fn of Object.values(svc)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it('StaffEditDataModule: 세션·잡·파일·인증 모듈 import, 컨트롤러·서비스 등록', () => {
    const imports = (Reflect.getMetadata('imports', StaffEditDataModule) ?? []) as unknown[];
    for (const m of [EditSessionsModule, WorkerJobsModule, FilesModule, AuthModule]) expect(imports).toContain(m);
    expect(Reflect.getMetadata('controllers', StaffEditDataModule)).toEqual([StaffEditDataController]);
    expect(Reflect.getMetadata('providers', StaffEditDataModule)).toEqual([StaffEditDataService]);
  });
});
