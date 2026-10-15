/**
 * GET /worker-jobs/:id/output — 조회 격리가 GET /worker-jobs/:id 와 같은지 고정한다.
 *
 * 사이트 운영자 JWT 는 siteId 클레임이 없어 @CurrentSite 가 undefined 이므로,
 * site 대조만으로는 걸러지지 않는다. 이 라우트도 @CurrentScope 를 서비스에 넘겨
 * scope 밖 site 잡을 403 으로 막는다(site 가 비어 있는 잡은 GET :id 와 같이 허용).
 */
import 'reflect-metadata';
import { BadRequestException, ForbiddenException, HttpException, Logger } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { Response } from 'express';
import { WorkerJobStatus } from '@storige/types';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobsController } from './worker-jobs.controller';
import type { TenantScope } from '../common/helpers/tenant-scope.helper';

const SITE_A = 'site-A';
const SITE_B = 'site-B';

function makeController(jobs: Record<string, Record<string, unknown>>): WorkerJobsController {
  // 실물 findOne(assertJobSiteAccess·assertSiteInScope 포함)을 fake repo 에 바인딩한다.
  const svc: Record<string, unknown> = {
    workerJobRepository: {
      findOne: async ({ where }: { where: { id: string } }) => jobs[where.id] ?? null,
    },
  };
  svc.assertJobSiteAccess = (
    WorkerJobsService.prototype as unknown as Record<string, (...a: unknown[]) => unknown>
  ).assertJobSiteAccess.bind(svc);
  svc.findOne = WorkerJobsService.prototype.findOne.bind(svc);
  return new WorkerJobsController(svc as never, {} as never);
}

async function call(
  controller: WorkerJobsController,
  scope: TenantScope,
  id: string,
  site?: { siteId: string },
): Promise<unknown> {
  try {
    await controller.downloadOutput(scope, id, {} as Response, site as never);
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('GET /worker-jobs/:id/output — 테넌트 scope', () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  // PROCESSING 잡은 조회를 통과하면 스트리밍 헬퍼가 400 JOB_NOT_COMPLETED 를 던진다 —
  // 그 코드가 보이면 '격리를 통과했다'는 뜻이다.
  const jobs = {
    'job-a': { id: 'job-a', siteId: SITE_A, status: WorkerJobStatus.PROCESSING, result: null },
    'job-b': { id: 'job-b', siteId: SITE_B, status: WorkerJobStatus.PROCESSING, result: null },
    'job-null': { id: 'job-null', siteId: null, status: WorkerJobStatus.PROCESSING, result: null },
  };
  const operatorA: TenantScope = { isGlobal: false, siteIds: [SITE_A] };
  const globalAdmin: TenantScope = { isGlobal: true, siteIds: [] };

  const passed = (e: unknown): boolean =>
    e instanceof BadRequestException &&
    ((e as HttpException).getResponse() as Record<string, unknown>).code === 'JOB_NOT_COMPLETED';

  it('사이트 운영자는 다른 site 잡을 받을 수 없다(403)', async () => {
    const e = await call(makeController(jobs), operatorA, 'job-b');
    expect(e).toBeInstanceOf(ForbiddenException);
  });

  it('사이트 운영자는 자기 site 잡과 site 가 비어 있는 잡은 통과한다', async () => {
    const c = makeController(jobs);
    expect(passed(await call(c, operatorA, 'job-a'))).toBe(true);
    expect(passed(await call(c, operatorA, 'job-null'))).toBe(true);
  });

  it('전역 관리자는 모든 site 잡을 통과한다', async () => {
    const c = makeController(jobs);
    expect(passed(await call(c, globalAdmin, 'job-b'))).toBe(true);
  });

  it('site 클레임이 있는 호출자는 종전대로 다른 site 잡이 404 다', async () => {
    const e = await call(makeController(jobs), { isGlobal: false, siteIds: [SITE_A] }, 'job-b', {
      siteId: SITE_A,
    });
    expect((e as HttpException).getStatus()).toBe(404);
  });

  it('downloadOutput 은 GET :id(findOne) 와 같은 @CurrentScope 파라미터 데코레이터를 쓴다', () => {
    type ArgMeta = Record<string, { index: number; factory?: unknown }>;
    const meta = (method: string): ArgMeta =>
      Reflect.getMetadata(ROUTE_ARGS_METADATA, WorkerJobsController, method) as ArgMeta;
    const scopeFactory = Object.values(meta('findOne')).find((a) => a.index === 0)?.factory;
    expect(typeof scopeFactory).toBe('function');
    const factories = Object.values(meta('downloadOutput')).map((a) => a.factory);
    expect(factories).toContain(scopeFactory);
  });
});
