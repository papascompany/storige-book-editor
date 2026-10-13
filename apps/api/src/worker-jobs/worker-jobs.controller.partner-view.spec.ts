/**
 * 파트너 잡 라우트 응답 형태 플래그 PARTNER_JOB_VIEW(api, 기본 false).
 *
 * 컨트롤러가 요청 시점에 ConfigService 에서 읽는다(isPartnerJobViewOn — 'true'·'1', 공백·대소문자 무시).
 *  - 꺼져 있으면 서비스가 돌려준 객체를 그대로 돌려준다(같은 참조 — 직렬화 결과도 같다).
 *  - 켜져 있으면 9 라우트의 모든 반환 경로가 정해진 키만 싣는 형태(toPartnerJobView)다.
 *
 * 서비스는 mock — 경로마다 다른 잡 객체를 돌려주고, 어느 경로를 탔는지는 서비스 호출 인자로 확인한다.
 */
import type { ConfigService } from '@nestjs/config';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsController } from './worker-jobs.controller';
import type { WorkerJobsService } from './worker-jobs.service';
import type { WorkerJob } from './entities/worker-job.entity';
import { PARTNER_JOB_VIEW_KEYS, toPartnerJobView } from './partner-job-view';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import type { ApiKeySitePayload } from '../auth/guards/optional-api-key-site.guard';
import type { CreateValidationJobDto, CreatePageCountFixJobDto, CreateSynthesisJobDto } from './dto/worker-job.dto';
import type { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';
import type { CreateComposeMixedJobDto } from './dto/create-compose-mixed-job.dto';
import type { CreateRenderPagesJobDto } from './dto/create-render-pages-job.dto';
import type { CreateBleedFixJobDto } from './dto/create-bleed-fix-job.dto';
import type { CreateAttachPagePadJobDto } from './dto/create-attach-page-pad-job.dto';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION = '11111111-1111-4111-8111-111111111111';

const site: CurrentSitePayload = {
  siteId: SITE_A,
  siteName: 'site',
  role: 'editor',
  apiKey: 'redacted',
  env: 'live',
};
const apiKeySite: ApiKeySitePayload = { siteId: SITE_A, siteName: 'site' };

/** 경로마다 다른 저장 잡(응답에 싣지 않는 키 포함). */
function job(path: string, jobType: WorkerJobType = WorkerJobType.SYNTHESIZE): WorkerJob {
  const stored: Record<string, unknown> = {
    id: `job-${path}`,
    jobType,
    status: WorkerJobStatus.FAILED,
    editSession: null,
    editSessionId: SESSION,
    fileId: 'file-1',
    inputFileUrl: 'api://file-1',
    outputFileUrl: null,
    outputFileId: null,
    options: { siteWebhook: false, callbackUrl: 'https://partner.example/hook', orderOptions: { binding: 'perfect' } },
    result:
      jobType === WorkerJobType.VALIDATE
        ? { result: { isValid: false, errors: [{ code: 'FILE_CORRUPTED', message: 'raw', details: { e: 1 } }], warnings: [], metadata: {} } }
        : { coverSizeValidation: { ok: false } },
    errorMessage: 'raw failure text',
    sessionId: null,
    pdfFileId: null,
    requestId: null,
    errorCode: null,
    errorDetail: { stage: path, jobData: { url: 'x' } },
    createdAt: new Date('2026-10-13T00:00:00.000Z'),
    completedAt: null,
    siteId: SITE_A,
  };
  return stored as unknown as WorkerJob;
}

type ServiceMock = {
  findOne: jest.Mock;
  createValidationJob: jest.Mock;
  createPageCountFixJob: jest.Mock;
  createSynthesisJob: jest.Mock;
  createSplitSynthesisJob: jest.Mock;
  createComposeMixedJob: jest.Mock;
  createRenderPagesJob: jest.Mock;
  createBleedFixJob: jest.Mock;
  createAttachPagePadJob: jest.Mock;
  assertEditSessionLink: jest.Mock;
  observeJobInputFileSites: jest.Mock;
};

interface Harness {
  controller: WorkerJobsController;
  service: ServiceMock;
  flags: Record<string, string | undefined>;
}

function harness(): Harness {
  const flags: Record<string, string | undefined> = {};
  const service: ServiceMock = {
    findOne: jest.fn(),
    createValidationJob: jest.fn(),
    createPageCountFixJob: jest.fn(),
    createSynthesisJob: jest.fn(),
    createSplitSynthesisJob: jest.fn(),
    createComposeMixedJob: jest.fn(),
    createRenderPagesJob: jest.fn(),
    createBleedFixJob: jest.fn(),
    createAttachPagePadJob: jest.fn(),
    assertEditSessionLink: jest.fn().mockResolvedValue(true),
    observeJobInputFileSites: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn((key: string) => flags[key]) };
  const controller = new WorkerJobsController(
    service as unknown as WorkerJobsService,
    config as unknown as ConfigService,
  );
  return { controller, service, flags };
}

/** 반환 경로 표 — 9 라우트 12 경로. 경로를 빠뜨리면 ON 단언이 실패한다. */
interface ReturnPath {
  name: string;
  jobType?: WorkerJobType;
  run(h: Harness, stored: WorkerJob): Promise<unknown>;
  /** 이 경로를 탔다는 근거(서비스 호출 인자). */
  verify(h: Harness): void;
}

const PATHS: ReturnPath[] = [
  {
    name: 'GET external/:id',
    jobType: WorkerJobType.VALIDATE,
    run: (h, stored) => {
      h.service.findOne.mockResolvedValue(stored);
      return h.controller.findOneExternal('job-id', site);
    },
    verify: (h) => expect(h.service.findOne).toHaveBeenCalledWith('job-id', site),
  },
  {
    name: 'POST validate/external',
    jobType: WorkerJobType.VALIDATE,
    run: (h, stored) => {
      h.service.createValidationJob.mockResolvedValue(stored);
      return h.controller.createValidationJobExternal({ fileId: 'f', fileType: 'cover' } as unknown as CreateValidationJobDto, site);
    },
    verify: (h) => expect(h.service.createValidationJob).toHaveBeenCalledTimes(1),
  },
  {
    name: 'POST fix-pagecount/external',
    jobType: WorkerJobType.CONVERT,
    run: (h, stored) => {
      h.service.createPageCountFixJob.mockResolvedValue(stored);
      return h.controller.createPageCountFixJobExternal({ fileId: 'f' } as unknown as CreatePageCountFixJobDto, site);
    },
    verify: (h) => expect(h.service.createPageCountFixJob).toHaveBeenCalledTimes(1),
  },
  {
    name: 'POST synthesize/external',
    run: (h, stored) => {
      h.service.createSynthesisJob.mockResolvedValue(stored);
      return h.controller.createSynthesisJobExternal({ coverFileId: 'c', contentFileId: 'd' } as unknown as CreateSynthesisJobDto, site);
    },
    verify: (h) => expect(h.service.createSynthesisJob).toHaveBeenCalledTimes(1),
  },
  {
    name: 'POST split-synthesize/external',
    run: (h, stored) => {
      h.service.createSplitSynthesisJob.mockResolvedValue(stored);
      return h.controller.createSplitSynthesisJobExternal({ pdfFileId: 'p' } as unknown as CreateSplitSynthesisJobDto, site);
    },
    verify: (h) => expect(h.service.createSplitSynthesisJob).toHaveBeenCalledTimes(1),
  },
  {
    name: 'POST compose-mixed — 세션 연결 미확인(storeSessionLink:false)',
    run: (h, stored) => {
      h.service.assertEditSessionLink.mockResolvedValue(false);
      h.service.createComposeMixedJob.mockResolvedValue(stored);
      return h.controller.createComposeMixed({ editSessionId: SESSION } as unknown as CreateComposeMixedJobDto);
    },
    verify: (h) =>
      expect(h.service.createComposeMixedJob).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        undefined,
        undefined,
        undefined,
        { storeSessionLink: false },
      ),
  },
  {
    name: 'POST compose-mixed — 사이트 키 수동 경로(입력 파일 사이트 확인)',
    run: (h, stored) => {
      h.service.createComposeMixedJob.mockResolvedValue(stored);
      return h.controller.createComposeMixed({} as unknown as CreateComposeMixedJobDto, undefined, apiKeySite);
    },
    verify: (h) =>
      expect(h.service.createComposeMixedJob).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        apiKeySite,
        undefined,
        { strict: false },
      ),
  },
  {
    name: 'POST compose-mixed — 그 밖',
    run: (h, stored) => {
      h.service.createComposeMixedJob.mockResolvedValue(stored);
      return h.controller.createComposeMixed({} as unknown as CreateComposeMixedJobDto);
    },
    verify: (h) => {
      expect(h.service.createComposeMixedJob).toHaveBeenCalledTimes(1);
      expect(h.service.createComposeMixedJob.mock.calls[0]).toHaveLength(3);
    },
  },
  {
    name: 'POST render-pages — 세션 연결 미확인(storeSessionLink:false)',
    jobType: WorkerJobType.RENDER_PAGES,
    run: (h, stored) => {
      h.service.assertEditSessionLink.mockResolvedValue(false);
      h.service.createRenderPagesJob.mockResolvedValue(stored);
      return h.controller.createRenderPages({ editSessionId: SESSION } as unknown as CreateRenderPagesJobDto);
    },
    verify: (h) =>
      expect(h.service.createRenderPagesJob).toHaveBeenCalledWith(expect.anything(), { storeSessionLink: false }),
  },
  {
    name: 'POST render-pages — 그 밖',
    jobType: WorkerJobType.RENDER_PAGES,
    run: (h, stored) => {
      h.service.createRenderPagesJob.mockResolvedValue(stored);
      return h.controller.createRenderPages({} as unknown as CreateRenderPagesJobDto);
    },
    verify: (h) => {
      expect(h.service.createRenderPagesJob).toHaveBeenCalledTimes(1);
      expect(h.service.createRenderPagesJob.mock.calls[0]).toHaveLength(1);
    },
  },
  {
    name: 'POST fix-bleed',
    jobType: WorkerJobType.CONVERT,
    run: (h, stored) => {
      h.service.createBleedFixJob.mockResolvedValue(stored);
      return h.controller.createBleedFixJob({ fileId: 'f', templateSetId: 't' } as unknown as CreateBleedFixJobDto);
    },
    verify: (h) => expect(h.service.createBleedFixJob).toHaveBeenCalledTimes(1),
  },
  {
    name: 'POST fix-pagecount/attach',
    jobType: WorkerJobType.CONVERT,
    run: (h, stored) => {
      h.service.createAttachPagePadJob.mockResolvedValue(stored);
      return h.controller.createAttachPagePadJob({ fileId: 'f', templateSetId: 't' } as unknown as CreateAttachPagePadJobDto);
    },
    verify: (h) => expect(h.service.createAttachPagePadJob).toHaveBeenCalledTimes(1),
  },
];

describe('파트너 잡 라우트 응답 형태 PARTNER_JOB_VIEW', () => {
  it('반환 경로 표는 9 라우트 12 경로다', () => {
    expect(PATHS).toHaveLength(12);
    const routes = new Set(PATHS.map((p) => p.name.split(' — ')[0]));
    expect(routes.size).toBe(9);
  });

  describe.each<[string, string | undefined]>([
    ['미설정', undefined],
    ['빈 값', ''],
    ['false', 'false'],
    ['0', '0'],
    ['yes', 'yes'],
  ])('플래그 %s(꺼짐) — 서비스 반환 객체를 그대로 돌려준다', (_label, raw) => {
    it.each(PATHS.map((p) => [p.name, p] as const))('%s', async (_name, path) => {
      const h = harness();
      h.flags.PARTNER_JOB_VIEW = raw;
      const stored = job(path.name, path.jobType);
      const before = JSON.stringify(stored);
      const out = await path.run(h, stored);
      path.verify(h);
      expect(out).toBe(stored);
      expect(JSON.stringify(out)).toBe(before);
    });
  });

  describe.each<[string]>([['true'], ['1'], [' TRUE ']])('플래그 %j(켜짐) — 정해진 키만 싣는다', (raw) => {
    it.each(PATHS.map((p) => [p.name, p] as const))('%s', async (_name, path) => {
      const h = harness();
      h.flags.PARTNER_JOB_VIEW = raw;
      const stored = job(path.name, path.jobType);
      const out = await path.run(h, stored);
      path.verify(h);
      expect(out).not.toBe(stored);
      expect(out).toEqual(toPartnerJobView(stored));
      expect(Object.keys(out as Record<string, unknown>).sort()).toEqual([...PARTNER_JOB_VIEW_KEYS].sort());
      expect(out).not.toHaveProperty('siteId');
      expect(out).not.toHaveProperty('inputFileUrl');
      expect(out).not.toHaveProperty('editSession');
      expect((out as { options: unknown }).options).toEqual({ siteWebhook: false });
    });
  });

  it('플래그는 요청 시점마다 읽는다(같은 컨트롤러에서 켜고 끈다)', async () => {
    const h = harness();
    const stored = job('toggle', WorkerJobType.VALIDATE);
    h.service.findOne.mockResolvedValue(stored);
    expect(await h.controller.findOneExternal('job-id', site)).toBe(stored);
    h.flags.PARTNER_JOB_VIEW = 'true';
    expect(await h.controller.findOneExternal('job-id', site)).toEqual(toPartnerJobView(stored));
    h.flags.PARTNER_JOB_VIEW = 'false';
    expect(await h.controller.findOneExternal('job-id', site)).toBe(stored);
  });

  it('켜져 있어도 검증 결과의 result.result 형식과 id·status 는 그대로다', async () => {
    const h = harness();
    h.flags.PARTNER_JOB_VIEW = 'true';
    const stored = job('validate', WorkerJobType.VALIDATE);
    h.service.findOne.mockResolvedValue(stored);
    const out = (await h.controller.findOneExternal('job-id', site)) as unknown as Record<string, unknown>;
    expect(out.id).toBe('job-validate');
    expect(out.status).toBe(WorkerJobStatus.FAILED);
    expect(out.result).toEqual({
      result: {
        isValid: false,
        errors: [{ code: 'FILE_CORRUPTED', message: '파일이 손상되었습니다. 다시 업로드해주세요.' }],
        warnings: [],
        metadata: {},
      },
    });
  });
});
