/**
 * 관리자 합성·재합성(2026-09-29) — createStaffComposeFromSession + 알림 없는 관리자 잡의 파트너 부수효과 차단
 * + 세션 잡 조회 + 산출물 스트리밍 헬퍼(downloadOutput 추출) 동작 동일성.
 *
 * 인스턴스 생성 패턴은 worker-jobs.service.compose-mixed-assembly.spec.ts / callback-gate.spec.ts 선례.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import { BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService, isStaffSilentJob } from './worker-jobs.service';
import { WorkerJobsController } from './worker-jobs.controller';
import { streamJobOutput } from './job-output-stream';
import { WorkerStatus } from '../edit-sessions/entities/edit-session.entity';

const SITE = 'site-A';
const ACTOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const sessionA = {
  id: 'sess-1',
  siteId: SITE,
  orderSeqno: 111,
  templateSetId: 'ts-1',
  callbackUrl: 'https://partner.example.com/hook',
  metadata: {},
  coverFile: { id: 'file-cover', filePath: '/app/storage/cover-x.pdf', storageBackend: 'local' },
  contentFile: { id: 'file-content', filePath: '/app/storage/content-x.pdf', storageBackend: 'local' },
  contentPdfFileId: null,
  workerStatus: null,
};

const templateSetA4 = { id: 'ts-1', width: 210, height: 297, endpaperConfig: null, coverEditable: true };

describe('WorkerJobsService.createStaffComposeFromSession', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock };
  let synthesisQueue: { add: jest.Mock };

  beforeEach(() => {
    let n = 0;
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: `job-${++n}` })),
    };
    editSessionRepository = { findOne: jest.fn(async () => ({ ...sessionA })) };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    const templateSetsService = {
      findOne: jest.fn(async () => templateSetA4),
      findOneWithTemplates: jest.fn(async () => ({ templateSet: templateSetA4, templateDetails: [] })),
    };
    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      synthesisQueue as never,
      { findById: jest.fn() } as never,
      {} as never,
      {} as never,
      templateSetsService as never,
    );
  });

  const job = (i = 0): Record<string, unknown> => workerJobRepository.create.mock.calls[i][0];
  const opts = (i = 0): Record<string, unknown> => job(i).options as Record<string, unknown>;

  it('세션 자산·세션 사이트로 조립, 기본은 callbackUrl 제거 + staffInitiated 마커', async () => {
    const saved = await service.createStaffComposeFromSession('sess-1', SITE, {
      notifyPartner: false,
      actorUserId: ACTOR,
    });
    expect(saved.id).toBe('job-1');
    expect(job().siteId).toBe(SITE);
    expect(job().jobType).toBe(WorkerJobType.SYNTHESIZE);
    expect(opts()).toMatchObject({
      capability: 'compose-mixed',
      editSessionId: 'sess-1',
      coverUrl: '/app/storage/cover-x.pdf',
      contentPdfUrl: '/app/storage/content-x.pdf',
      staffInitiated: { actorUserId: ACTOR, notifyPartner: false },
    });
    expect(opts().callbackUrl).toBeUndefined();
    const payload = synthesisQueue.add.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.callbackUrl).toBeUndefined();
    expect(payload).not.toHaveProperty('staffInitiated'); // 워커 큐 페이로드 키 불변
  });

  it('notifyPartner=true → 세션 callbackUrl 유지 + 마커 notifyPartner true, outputMode 전달', async () => {
    await service.createStaffComposeFromSession('sess-1', SITE, {
      outputMode: 'single',
      notifyPartner: true,
      actorUserId: ACTOR,
    });
    expect(opts().callbackUrl).toBe(sessionA.callbackUrl);
    expect(opts().staffInitiated).toEqual({ actorUserId: ACTOR, notifyPartner: true });
    expect(opts().outputMode).toBe('single');
  });

  it('다른 사이트를 넘기면 자동조립 인가와 같은 404(서버가 세션 사이트를 넘겨야 한다)', async () => {
    await expect(
      service.createStaffComposeFromSession('sess-1', 'site-B', { notifyPartner: false, actorUserId: ACTOR }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  });

  it('재합성: 두 번째 호출은 새 잡을 만들고 이전 잡을 갱신하지 않는다', async () => {
    const a = await service.createStaffComposeFromSession('sess-1', SITE, { notifyPartner: false, actorUserId: ACTOR });
    const b = await service.createStaffComposeFromSession('sess-1', SITE, { notifyPartner: false, actorUserId: ACTOR });
    expect(a.id).not.toBe(b.id);
    expect(workerJobRepository.save).toHaveBeenCalledTimes(2);
    expect(job(0)).not.toBe(job(1));
    expect(synthesisQueue.add).toHaveBeenCalledTimes(2);
  });

  it('조립 불가(내지 없음) → 400 SESSION_ASSEMBLY_INCOMPLETE 그대로', async () => {
    editSessionRepository.findOne.mockResolvedValue({ ...sessionA, contentFile: null });
    await expect(
      service.createStaffComposeFromSession('sess-1', SITE, { notifyPartner: false, actorUserId: ACTOR }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('회귀: 기존 호출자(4번째 인자 없음)의 options 에는 staffInitiated 키가 없다', async () => {
    await service.createComposeMixedJob({ coverUrl: '/app/storage/c.pdf', contentPdfUrl: '/app/storage/d.pdf' });
    expect(opts()).not.toHaveProperty('staffInitiated');
  });
});

describe('WorkerJobsService.createStaffComposeFromSession — 내지 기대 재단(contentTrim)', () => {
  /** 계약 fixture — apps/worker spec 과 같은 리터럴 */
  const FIXTURE_TEMPLATE_SET = JSON.parse(
    '{"trimWidthMm":210,"trimHeightMm":297,"bleedMm":3,"source":"templateSet"}',
  ) as unknown;

  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let templateSet: Record<string, unknown>;
  let templateDetails: unknown[];

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'job-1' })),
    };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    templateSet = { ...templateSetA4, bleedMm: 3 };
    templateDetails = [];
    service = new WorkerJobsService(
      workerJobRepository as never,
      { findOne: jest.fn(async () => ({ ...sessionA })) } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      synthesisQueue as never,
      { findById: jest.fn() } as never,
      {} as never,
      {} as never,
      {
        findOne: jest.fn(async () => templateSet),
        findOneWithTemplates: jest.fn(async () => ({ templateSet, templateDetails })),
      } as never,
    );
  });

  const created = (): Record<string, unknown> => workerJobRepository.create.mock.calls[0][0];
  const payload = (): Record<string, unknown> => synthesisQueue.add.mock.calls[0][1];

  it('관리자 합성 + templateSet bleedMm 3 → options·큐에 같은 contentTrim(계약 fixture)', async () => {
    await service.createStaffComposeFromSession('sess-1', SITE, { notifyPartner: false, actorUserId: ACTOR });
    expect((created().options as Record<string, unknown>).contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
    expect(payload().contentTrim).toEqual(FIXTURE_TEMPLATE_SET);
  });

  it('templateSet bleedMm 없음 → contentTrim 키 없음', async () => {
    delete templateSet.bleedMm;
    await service.createStaffComposeFromSession('sess-1', SITE, { notifyPartner: false, actorUserId: ACTOR });
    expect(created().options).not.toHaveProperty('contentTrim');
    expect(payload()).not.toHaveProperty('contentTrim');
  });

  it('내지 펼침면 세트 → contentTrim 키 없음, 잡은 생성', async () => {
    templateDetails = [
      {
        id: 'tpl-inner',
        spreadConfig: { regionScope: 'inner', innerSpec: { pageWidthMm: 210, pageHeightMm: 297 } },
      },
    ];
    const saved = await service.createStaffComposeFromSession('sess-1', SITE, {
      notifyPartner: false,
      actorUserId: ACTOR,
    });
    expect(saved.id).toBe('job-1');
    expect(payload()).not.toHaveProperty('contentTrim');
  });
});

describe('WorkerJobsService.updateJobStatus — 알림 없는 관리자 잡', () => {
  let workerJobRepository: { findOne: jest.Mock; save: jest.Mock; find: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };

  const staffJob = (notifyPartner: boolean, extra: Record<string, unknown> = {}) => ({
    id: 'job-staff',
    jobType: WorkerJobType.SYNTHESIZE,
    editSessionId: 'sess-1',
    siteId: SITE,
    options: {
      capability: 'compose-mixed',
      editSessionId: 'sess-1',
      ...(notifyPartner ? { callbackUrl: 'https://partner.example.com/hook' } : {}),
      staffInitiated: { actorUserId: ACTOR, notifyPartner },
    },
    result: null,
    status: WorkerJobStatus.PROCESSING,
    ...extra,
  });

  const make = (job: Record<string, unknown>, siblings: Array<Record<string, unknown>> = []): WorkerJobsService => {
    workerJobRepository = {
      findOne: jest.fn(async () => ({ ...job })),
      save: jest.fn(async (e: unknown) => e),
      find: jest.fn(async () => siblings),
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ ...sessionA, workerStatus: WorkerStatus.VALIDATED })),
      update: jest.fn(async () => ({})),
    };
    return new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      {} as never,
      webhookService as never,
      {} as never,
      {} as never,
    );
  };

  beforeEach(() => {
    webhookService = { sendCallback: jest.fn(async () => true), hasV2Config: jest.fn(async () => true) };
  });

  it.each([WorkerJobStatus.COMPLETED, WorkerJobStatus.FAILED])(
    'notifyPartner=false + v2 config 사이트, %s → 콜백·웹훅·세션 workerStatus 변경 없음',
    async (status) => {
      const service = make(staffJob(false));
      await service.updateJobStatus('job-staff', { status, errorMessage: 'x' });
      expect(webhookService.sendCallback).not.toHaveBeenCalled();
      expect(webhookService.hasV2Config).not.toHaveBeenCalled();
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(editSessionRepository.update).not.toHaveBeenCalled();
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1); // 잡 자체 상태는 갱신
    },
  );

  it('notifyPartner=false VALIDATE 잡도 validation.* 발신 없음', async () => {
    const service = make(staffJob(false, { jobType: WorkerJobType.VALIDATE, editSessionId: null }));
    await service.updateJobStatus('job-staff', { status: WorkerJobStatus.FIXABLE });
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
  });

  it('notifyPartner=true → 종전 동작(세션 workerStatus 갱신 + 콜백 발신)', async () => {
    const service = make(staffJob(true), [staffJob(true, { status: WorkerJobStatus.COMPLETED })]);
    await service.updateJobStatus('job-staff', { status: WorkerJobStatus.COMPLETED });
    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', { workerStatus: WorkerStatus.VALIDATED });
    expect(webhookService.sendCallback).toHaveBeenCalled();
    const events = webhookService.sendCallback.mock.calls.map((c) => (c[1] as { event: string }).event);
    expect(events).toContain('synthesis.completed');
  });

  it('areAllSessionJobsCompleted: 대기 중인 알림 없는 관리자 잡은 무시(세션을 PROCESSING 에 묶지 않음)', async () => {
    const validate = {
      id: 'job-v',
      jobType: WorkerJobType.VALIDATE,
      editSessionId: 'sess-1',
      siteId: SITE,
      options: { fileType: 'content' },
      status: WorkerJobStatus.PROCESSING,
    };
    const silentPending = staffJob(false, { status: WorkerJobStatus.PENDING });
    const service = make(validate, [{ ...validate, status: WorkerJobStatus.COMPLETED }, silentPending]);
    webhookService.hasV2Config.mockResolvedValue(false);
    await service.updateJobStatus('job-v', { status: WorkerJobStatus.COMPLETED });
    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', { workerStatus: WorkerStatus.VALIDATED });

    // 대조: 알림을 켠 관리자 잡이 대기 중이면 종전 규칙대로 PROCESSING
    const notifying = staffJob(true, { status: WorkerJobStatus.PENDING });
    const service2 = make(validate, [{ ...validate, status: WorkerJobStatus.COMPLETED }, notifying]);
    await service2.updateJobStatus('job-v', { status: WorkerJobStatus.COMPLETED });
    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', { workerStatus: WorkerStatus.PROCESSING });
  });

  it('isStaffSilentJob: 마커 없음·notifyPartner true → false', () => {
    expect(isStaffSilentJob({ options: {} })).toBe(false);
    expect(isStaffSilentJob({ options: null })).toBe(false);
    expect(isStaffSilentJob({ options: { staffInitiated: { notifyPartner: true } } })).toBe(false);
    expect(isStaffSilentJob({ options: { staffInitiated: { notifyPartner: false } } })).toBe(true);
    expect(isStaffSilentJob({ options: { staffInitiated: {} } })).toBe(true);
  });
});

describe('WorkerJobsService.findJobsBySession · findJobScopeRef', () => {
  interface Qb {
    select: jest.Mock;
    addSelect: jest.Mock;
    where: jest.Mock;
    orderBy: jest.Mock;
    take: jest.Mock;
    getMany: jest.Mock;
    getRawOne: jest.Mock;
  }
  const qb = (): Qb => {
    const q = {} as Qb;
    for (const k of ['select', 'addSelect', 'where', 'orderBy', 'take'] as const) q[k] = jest.fn(() => q);
    q.getMany = jest.fn(async () => []);
    q.getRawOne = jest.fn(async () => ({ id: 'j1', editSessionId: null, siteId: SITE }));
    return q;
  };
  const make = (q: Qb): WorkerJobsService =>
    new WorkerJobsService(
      { createQueryBuilder: jest.fn(() => q) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('명시 컬럼 + 최신순 + 상한, 사이트가 있으면 options.editSessionId 는 같은 사이트 잡만', async () => {
    const q = qb();
    await make(q).findJobsBySession('sess-1', 50, SITE);
    const cols = q.select.mock.calls[0][0] as string[];
    expect(cols).toEqual(expect.arrayContaining(['job.id', 'job.jobType', 'job.status', 'job.options', 'job.createdAt']));
    expect(String(q.where.mock.calls[0][0])).toContain('job.site_id = :jobSiteId');
    expect(q.where.mock.calls[0][1]).toEqual({ sid: 'sess-1', jobSiteId: SITE });
    expect(q.orderBy).toHaveBeenCalledWith('job.createdAt', 'DESC');
    expect(q.take).toHaveBeenCalledWith(50);
  });

  it('NULL-site 세션 → edit_session_id 컬럼 일치만', async () => {
    const q = qb();
    await make(q).findJobsBySession('sess-1', 50, null);
    expect(q.where).toHaveBeenCalledWith('job.edit_session_id = :sid', { sid: 'sess-1' });
  });

  it('findJobScopeRef: 없으면 null, 있으면 id/editSessionId/siteId', async () => {
    const q = qb();
    expect(await make(q).findJobScopeRef('j1')).toEqual({ id: 'j1', editSessionId: null, siteId: SITE });
    q.getRawOne.mockResolvedValueOnce(undefined);
    expect(await make(q).findJobScopeRef('j2')).toBeNull();
  });
});

describe('streamJobOutput — GET /worker-jobs/:id/output 동작 동일(헬퍼 추출)', () => {
  const logger = new Logger('spec');
  let tmp: string;
  const prevStorage = process.env.STORAGE_PATH;

  class FakeRes extends EventEmitter {
    headers: Record<string, unknown> = {};
    headersSent = false;
    statusCode = 200;
    body: unknown;
    setHeader(k: string, v: unknown): void {
      this.headers[k] = v;
    }
    removeHeader(k: string): void {
      delete this.headers[k];
    }
    status(c: number): this {
      this.statusCode = c;
      return this;
    }
    json(b: unknown): this {
      this.body = b;
      return this;
    }
    destroy(): void {}
    write(): boolean {
      this.headersSent = true;
      return true;
    }
    end(): void {
      this.emit('finish');
    }
    once(event: string, fn: (...a: unknown[]) => void): this {
      return super.once(event, fn);
    }
  }

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'staff-out-'));
    fs.mkdirSync(path.join(tmp, 'outputs'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'outputs', 'x.pdf'), '%PDF-1.4 test');
    process.env.STORAGE_PATH = tmp;
  });
  afterAll(() => {
    process.env.STORAGE_PATH = prevStorage;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const codeOf = (fn: () => void): { status: number; code: unknown } => {
    try {
      fn();
    } catch (e) {
      if (e instanceof HttpException) {
        return { status: e.getStatus(), code: (e.getResponse() as Record<string, unknown>).code };
      }
      throw e;
    }
    throw new Error('expected throw');
  };

  it.each<[string, Record<string, unknown>, number, string]>([
    ['미완료', { status: WorkerJobStatus.PROCESSING, result: null }, 400, 'JOB_NOT_COMPLETED'],
    ['산출물 URL 없음', { status: WorkerJobStatus.COMPLETED, result: {} }, 404, 'OUTPUT_NOT_FOUND'],
    ['저장소 밖 경로', { status: WorkerJobStatus.COMPLETED, result: { outputFileUrl: '/etc/passwd' } }, 400, 'INVALID_PATH'],
    ['디스크에 없음', { status: WorkerJobStatus.FIXABLE, result: { result: { outputFileUrl: '/storage/outputs/none.pdf' } } }, 404, 'FILE_NOT_ON_DISK'],
  ])('%s → %p %s', (_l, job, status, code) => {
    const res = new FakeRes();
    expect(codeOf(() => streamJobOutput(job as never, res as unknown as Response, logger))).toEqual({ status, code });
  });

  it('존재 → PDF 헤더 + 스트림', async () => {
    const res = new FakeRes();
    const done = new Promise<void>((r) => res.once('finish', () => r()));
    streamJobOutput(
      { status: WorkerJobStatus.COMPLETED, result: { outputFileUrl: '/storage/outputs/x.pdf' } } as never,
      res as unknown as Response,
      logger,
    );
    await done;
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toBe('attachment; filename="x.pdf"');
    expect(res.headers['Content-Length']).toBe(fs.statSync(path.join(tmp, 'outputs', 'x.pdf')).size);
  });

  it('컨트롤러 downloadOutput 은 잡 조회(사이트 범위) 후 헬퍼에 위임 — 오류 코드 동일', async () => {
    const svc = { findOne: jest.fn(async () => ({ status: WorkerJobStatus.PROCESSING, result: null })) };
    const controller = new WorkerJobsController(svc as never, {} as never);
    const res = new FakeRes();
    let caught: unknown;
    try {
      await controller.downloadOutput('job-1', res as unknown as Response, { siteId: SITE } as never);
    } catch (e) {
      caught = e;
    }
    expect(svc.findOne).toHaveBeenCalledWith('job-1', { siteId: SITE });
    expect(caught).toBeInstanceOf(BadRequestException);
    expect(((caught as HttpException).getResponse() as Record<string, unknown>).code).toBe('JOB_NOT_COMPLETED');
  });
});
