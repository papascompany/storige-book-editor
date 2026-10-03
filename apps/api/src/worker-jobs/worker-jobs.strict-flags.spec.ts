/**
 * 잡 생성 확인 플래그 — JOB_LINK_STRICT·JOB_FILE_SITE_STRICT(api, 기본 false).
 *
 * 컨트롤러가 요청 시점에 ConfigService 에서 읽고(isFlagOn: true|1, 공백·대소문자 무시) 서비스에 인자로 넘긴다.
 *  - JOB_LINK_STRICT: 그 밖의 호출자(none — 무인증·운영자 토큰·admin JWT 등)도 세션 연결을 증명하지 못하면
 *    404 SESSION_NOT_FOUND, 잡 미생성. 꺼져 있으면 관측 로그만(`[job-link] would-deny`).
 *  - JOB_FILE_SITE_STRICT: 입력 파일(fileId 계열·`api://<uuid>` URL)의 사이트가 호출 사이트와 다르면
 *    403 FILE_SITE_MISMATCH, 잡 미생성. 사이트 미지정·같은 사이트 파일은 통과. 꺼져 있으면 관측 로그만.
 *
 * 컨트롤러 + 실제 WorkerJobsService(저장소 mock). compose-mixed 는 실제 잡 생성까지, 나머지 잡 생성 메서드는 spy.
 */
import { HttpException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEMBER_A = '11111111-1111-4111-8111-111111111111'; // site A 회원 123
const GUEST_A = '22222222-2222-4222-8222-222222222222'; // site A 비회원
const MEMBER_B = '55555555-5555-4555-8555-555555555555'; // site B 회원 123
const GUEST_TOKEN = 'guest-token-value-7c1e';
const FILE_A = 'f0000000-0000-4000-8000-00000000000a';
const FILE_B = 'f0000000-0000-4000-8000-00000000000b';
const FILE_NULL = 'f0000000-0000-4000-8000-0000000000ff';

const site = (siteId: string, role: 'editor' | 'worker' = 'editor'): CurrentSitePayload => ({
  siteId,
  siteName: 'site',
  role,
  apiKey: 'redacted',
  env: 'live',
});
const shopUser = (sub: string, siteId: string = SITE_A): Record<string, unknown> => ({
  userId: sub,
  role: 'customer',
  source: 'shop',
  siteId,
});
const operatorUser = (sessionIds: string[] = []): Record<string, unknown> => ({
  source: 'partner_operator',
  siteId: SITE_A,
  partnerOperator: { siteId: SITE_A, sessionIds },
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

describe('잡 생성 확인 플래그 JOB_LINK_STRICT·JOB_FILE_SITE_STRICT', () => {
  let service: WorkerJobsService;
  let flags: Record<string, unknown>;
  let requestedKeys: string[];
  let controller: WorkerJobsController;
  const editSessionRepository = { findOne: jest.fn() };
  const filesService = { findById: jest.fn() };
  const workerJobRepository = { create: jest.fn(), save: jest.fn() };
  const synthesisQueue = { add: jest.fn() };
  let logSpy: jest.SpyInstance;
  let create: Record<
    | 'createValidationJob'
    | 'createSynthesisJob'
    | 'createSplitSynthesisJob'
    | 'createRenderPagesJob'
    | 'createPageCountFixJob',
    jest.SpyInstance
  >;

  const logs = (prefix: string): string[] =>
    logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith(prefix));

  beforeEach(() => {
    jest.clearAllMocks();
    const future = new Date(Date.now() + 3600_000);
    const rows: Record<string, Record<string, unknown>> = {
      [MEMBER_A]: { id: MEMBER_A, siteId: SITE_A, memberSeqno: 123, orderSeqno: 100, guestToken: null, guestExpiresAt: null },
      [GUEST_A]: { id: GUEST_A, siteId: SITE_A, memberSeqno: 0, orderSeqno: 0, guestToken: GUEST_TOKEN, guestExpiresAt: future },
      [MEMBER_B]: { id: MEMBER_B, siteId: SITE_B, memberSeqno: 123, orderSeqno: 100, guestToken: null, guestExpiresAt: null },
    };
    editSessionRepository.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const r = rows[opts.where.id];
      return r ? { ...r, metadata: {} } : null;
    });
    const files: Record<string, { id: string; siteId: string | null }> = {
      [FILE_A]: { id: FILE_A, siteId: SITE_A },
      [FILE_B]: { id: FILE_B, siteId: SITE_B },
      [FILE_NULL]: { id: FILE_NULL, siteId: null },
    };
    filesService.findById.mockImplementation(async (id: string) => files[id]);
    workerJobRepository.create.mockImplementation((x: unknown) => x);
    workerJobRepository.save.mockImplementation(async (x: object) => ({ ...x, id: 'job-compose' }));
    synthesisQueue.add.mockResolvedValue({});

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      synthesisQueue as never,
      filesService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const job = { id: 'job-1' } as never;
    create = {
      createValidationJob: jest.spyOn(service, 'createValidationJob').mockResolvedValue(job),
      createSynthesisJob: jest.spyOn(service, 'createSynthesisJob').mockResolvedValue(job),
      createSplitSynthesisJob: jest.spyOn(service, 'createSplitSynthesisJob').mockResolvedValue(job),
      createRenderPagesJob: jest.spyOn(service, 'createRenderPagesJob').mockResolvedValue(job),
      createPageCountFixJob: jest.spyOn(service, 'createPageCountFixJob').mockResolvedValue(job),
    };
    flags = {};
    requestedKeys = [];
    const config = {
      get: (key: string): unknown => {
        requestedKeys.push(key);
        return flags[key];
      },
    } as unknown as ConfigService;
    controller = new WorkerJobsController(service, config);
    const controllerLogger = (controller as unknown as { logger: Logger }).logger;
    jest.spyOn(controllerLogger, 'warn').mockImplementation(() => undefined);
  });

  // ── JOB_LINK_STRICT ───────────────────────────────────────────────────
  describe('JOB_LINK_STRICT', () => {
    it.each<[unknown]>([[undefined], ['false'], ['0']])(
      'JOB_LINK_STRICT=%j → 무인증 render-pages 의 미증명 editSessionId 는 잡 생성 + would-deny 로그',
      async (value) => {
        flags.JOB_LINK_STRICT = value;
        await controller.createRenderPages({ fileId: FILE_A, editSessionId: MEMBER_A } as never);
        expect(create.createRenderPagesJob).toHaveBeenCalledTimes(1);
        expect(logs('[job-link]')).toEqual([`[job-link] would-deny route=render-pages caller=none site=${SITE_A}`]);
      },
    );

    it.each<[unknown]>([['true'], ['1'], [' TRUE ']])(
      'JOB_LINK_STRICT=%j → render-pages·compose-mixed(수동)·validate(그 밖의 JWT) 미증명은 404 SESSION_NOT_FOUND, 잡 미생성, denied 1줄씩',
      async (value) => {
        flags.JOB_LINK_STRICT = value;
        const r1 = await httpError(controller.createRenderPages({ fileId: FILE_A, editSessionId: MEMBER_A } as never));
        const r2 = await httpError(controller.createComposeMixed({ editSessionId: MEMBER_A, coverUrl: '/c.pdf' } as never, undefined));
        const r3 = await httpError(
          controller.createValidationJob({ fileId: FILE_A, fileType: 'content', editSessionId: MEMBER_A } as never, { role: 'customer' }),
        );
        for (const r of [r1, r2, r3]) {
          expect(r.status).toBe(404);
          expect(r.body.code).toBe('SESSION_NOT_FOUND');
        }
        expect(create.createRenderPagesJob).not.toHaveBeenCalled();
        expect(create.createValidationJob).not.toHaveBeenCalled();
        expect(workerJobRepository.save).not.toHaveBeenCalled();
        expect(logs('[job-link]')).toEqual([
          `[job-link] denied route=render-pages caller=none site=${SITE_A}`,
          `[job-link] denied route=compose-mixed caller=none site=${SITE_A}`,
          `[job-link] denied route=validate caller=none site=${SITE_A}`,
        ]);
      },
    );

    it("JOB_LINK_STRICT='true' → 유효한 X-Guest-Token 의 비회원 세션은 통과", async () => {
      flags.JOB_LINK_STRICT = 'true';
      await controller.createRenderPages({ fileId: FILE_A, editSessionId: GUEST_A } as never, GUEST_TOKEN);
      await controller.createComposeMixed({ editSessionId: GUEST_A, coverUrl: '/c.pdf' } as never, undefined, undefined, GUEST_TOKEN);
      expect(create.createRenderPagesJob).toHaveBeenCalledTimes(1);
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
      expect(logs('[job-link]')).toEqual([]);
    });

    it("JOB_LINK_STRICT='true' → staff 는 조회 없이 통과, 사이트 키·shop 판정 결과는 꺼져 있을 때와 같다", async () => {
      const run = async (): Promise<number[]> => {
        const statuses: number[] = [];
        const settle = async (p: Promise<unknown>): Promise<void> => {
          try {
            await p;
            statuses.push(201);
          } catch (e) {
            statuses.push((e as HttpException).getStatus());
          }
        };
        await settle(controller.createSynthesisJobExternal({ editSessionId: MEMBER_A } as never, site(SITE_A)));
        await settle(controller.createSynthesisJobExternal({ editSessionId: MEMBER_B } as never, site(SITE_A)));
        await settle(controller.createValidationJob({ fileId: FILE_A, editSessionId: MEMBER_A } as never, shopUser('123')));
        await settle(controller.createValidationJob({ fileId: FILE_A, editSessionId: MEMBER_A } as never, shopUser('456')));
        return statuses;
      };
      const off = await run();
      flags.JOB_LINK_STRICT = 'true';
      const on = await run();
      expect(off).toEqual([201, 404, 201, 404]);
      expect(on).toEqual(off);

      editSessionRepository.findOne.mockClear();
      await controller.createValidationJob({ fileId: FILE_A, editSessionId: MEMBER_B } as never, { role: 'ADMIN' });
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    });

    it("JOB_LINK_STRICT='true' → 세션 조회 오류는 전파되고 잡은 만들어지지 않는다", async () => {
      flags.JOB_LINK_STRICT = 'true';
      editSessionRepository.findOne.mockRejectedValueOnce(new Error('db down'));
      await expect(controller.createRenderPages({ fileId: FILE_A, editSessionId: MEMBER_A } as never)).rejects.toThrow('db down');
      expect(create.createRenderPagesJob).not.toHaveBeenCalled();
    });

    it("JOB_LINK_STRICT='true' → 운영자 토큰·admin JWT 의 compose-mixed 수동 경로 미증명 404 / 자동조립은 연결 확인 없음", async () => {
      flags.JOB_LINK_STRICT = 'true';
      const r1 = await httpError(
        controller.createComposeMixed({ editSessionId: MEMBER_B, coverUrl: '/c.pdf' } as never, { source: 'partner_operator', siteId: SITE_A }),
      );
      const r2 = await httpError(
        controller.createComposeMixed({ editSessionId: MEMBER_B, coverUrl: '/c.pdf' } as never, { role: 'ADMIN', siteId: SITE_A }),
      );
      expect([r1.status, r2.status]).toEqual([404, 404]);
      expect(workerJobRepository.save).not.toHaveBeenCalled();

      const linkSpy = jest.spyOn(service, 'assertEditSessionLink');
      const assembled = jest.spyOn(service, 'createComposeMixedJob').mockResolvedValue({ id: 'job-asm' } as never);
      await controller.createComposeMixed({ editSessionId: MEMBER_B, assembleFromSession: true } as never, undefined);
      expect(linkSpy).not.toHaveBeenCalled();
      expect(assembled).toHaveBeenCalledTimes(1);
    });
  });

  // ── JOB_FILE_SITE_STRICT ──────────────────────────────────────────────
  describe('JOB_FILE_SITE_STRICT', () => {
    it('미설정 → 다른 사이트 파일도 잡 생성 + [job-file] cross-site 로그', async () => {
      await controller.createValidationJobExternal({ fileId: FILE_B } as never, site(SITE_A));
      await controller.createPageCountFixJobExternal({ fileId: FILE_B } as never, site(SITE_A));
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      expect(create.createPageCountFixJob).toHaveBeenCalledTimes(1);
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=validate/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] cross-site route=fix-pagecount/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
      ]);
    });

    it("'true' → external 4개·validate(shop·운영자)의 다른 사이트 파일은 403 FILE_SITE_MISMATCH, 잡 미생성, denied 로그(파일 id 미기록)", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      const results = [
        await httpError(controller.createValidationJobExternal({ fileId: FILE_B } as never, site(SITE_A))),
        await httpError(controller.createSynthesisJobExternal({ coverFileId: FILE_A, contentFileId: FILE_B } as never, site(SITE_A))),
        await httpError(controller.createSplitSynthesisJobExternal({ sessionId: MEMBER_A, pdfFileId: FILE_B } as never, site(SITE_A))),
        await httpError(controller.createPageCountFixJobExternal({ fileId: FILE_B } as never, site(SITE_A))),
        await httpError(controller.createValidationJob({ fileId: FILE_B, fileType: 'content' } as never, shopUser('123'))),
        await httpError(controller.createValidationJob({ fileId: FILE_B, fileType: 'content' } as never, operatorUser())),
      ];
      for (const r of results) {
        expect(r).toEqual({
          status: 403,
          body: {
            code: 'FILE_SITE_MISMATCH',
            message: '이 사이트에서 사용할 수 없는 파일입니다.',
            details: { fileId: FILE_B },
          },
        });
      }
      for (const m of Object.values(create)) expect(m).not.toHaveBeenCalled();
      expect(logs('[job-file]')).toEqual([
        `[job-file] denied route=validate/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] denied route=synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] denied route=split-synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] denied route=fix-pagecount/external caller=siteKey site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] denied route=validate caller=shop site=${SITE_A} fileSite=${SITE_B}`,
        `[job-file] denied route=validate caller=operator site=${SITE_A} fileSite=${SITE_B}`,
      ]);
      expect(JSON.stringify(logSpy.mock.calls)).not.toContain(FILE_B);
    });

    it("'true' → 같은 사이트·사이트 미지정 파일은 통과", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      await controller.createValidationJobExternal({ fileId: FILE_A } as never, site(SITE_A));
      await controller.createSynthesisJobExternal({ coverFileId: FILE_A, contentFileId: FILE_NULL } as never, site(SITE_A));
      await controller.createPageCountFixJobExternal({ fileId: FILE_NULL } as never, site(SITE_A));
      await controller.createValidationJob({ fileId: FILE_NULL, fileType: 'content' } as never, shopUser('123'));
      expect(create.createValidationJob).toHaveBeenCalledTimes(2);
      expect(create.createSynthesisJob).toHaveBeenCalledTimes(1);
      expect(create.createPageCountFixJob).toHaveBeenCalledTimes(1);
      expect(logs('[job-file]')).toEqual([]);
    });

    it("'true' → api://<다른 사이트 파일 id> URL 입력도 403", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      const r1 = await httpError(controller.createValidationJobExternal({ fileUrl: `api://${FILE_B}` } as never, site(SITE_A)));
      const r2 = await httpError(
        controller.createSynthesisJobExternal({ coverUrl: `api://${FILE_A}`, contentUrl: `api://${FILE_B}` } as never, site(SITE_A)),
      );
      expect([r1.status, r2.status]).toEqual([403, 403]);
      expect(r1.body.code).toBe('FILE_SITE_MISMATCH');
      expect(logs('[job-file]')).toEqual([
        `[job-file] denied route=validate/external caller=siteKey site=${SITE_A} fileSite=${SITE_B} ref=url`,
        `[job-file] denied route=synthesize/external caller=siteKey site=${SITE_A} fileSite=${SITE_B} ref=url`,
      ]);
    });

    it("'true' → 내부 워커 키는 확인하지 않는다(findById 0회)", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      await controller.createValidationJobExternal({ fileId: FILE_B } as never, site(SITE_A, 'worker'));
      await controller.createSynthesisJobExternal({ coverFileId: FILE_B } as never, site(SITE_A, 'worker'));
      await controller.createSplitSynthesisJobExternal({ pdfFileId: FILE_B } as never, site(SITE_A, 'worker'));
      await controller.createPageCountFixJobExternal({ fileId: FILE_B } as never, site(SITE_A, 'worker'));
      expect(filesService.findById).not.toHaveBeenCalled();
    });

    it("'true' → staff·무인증 validate 는 확인 대상이 아니다", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      await controller.createValidationJob({ fileId: FILE_B, fileType: 'content' } as never, { role: 'ADMIN' });
      await controller.createValidationJob({ fileUrl: `api://${FILE_B}`, fileType: 'content' } as never, undefined);
      expect(filesService.findById).not.toHaveBeenCalled();
      expect(create.createValidationJob).toHaveBeenCalledTimes(2);
    });
  });

  // ── compose-mixed 수동 경로 입력 URL ─────────────────────────────────────
  describe('compose-mixed 수동 경로 입력 URL(api://)', () => {
    const manual = (extra: Record<string, unknown> = {}): never =>
      ({
        coverUrl: `api://${FILE_A}`,
        contentPdfUrl: `api://${FILE_B}`,
        frontEndpaperUrls: [],
        backEndpaperUrls: [],
        ...extra,
      }) as never;
    const key = (siteId: string): { siteId: string; siteName: string } => ({ siteId, siteName: 'site' });

    it('사이트 키 + 다른 사이트 파일 → 미설정은 cross-site … ref=url 후 잡 생성(잡 사이트 = 키 사이트)', async () => {
      await controller.createComposeMixed(manual(), undefined, key(SITE_A));
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=compose-mixed caller=siteKey site=${SITE_A} fileSite=${SITE_B} ref=url`,
      ]);
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
      expect(workerJobRepository.create.mock.calls[0][0].siteId).toBe(SITE_A);
    });

    it("JOB_FILE_SITE_STRICT='true' → 사이트 키 + 면지 URL 의 다른 사이트 파일 403, 잡 미생성", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      const r = await httpError(
        controller.createComposeMixed(
          manual({ contentPdfUrl: `api://${FILE_A}`, backEndpaperUrls: [`api://${FILE_B}`] }),
          undefined,
          key(SITE_A),
        ),
      );
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ code: 'FILE_SITE_MISMATCH', details: { fileId: FILE_B } });
      expect(workerJobRepository.save).not.toHaveBeenCalled();
      expect(synthesisQueue.add).not.toHaveBeenCalled();
    });

    it("JOB_FILE_SITE_STRICT='true' → shop-session(사이트 있음) 호출자도 대상, 같은 사이트·미지정 파일은 통과", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      const r = await httpError(controller.createComposeMixed(manual(), shopUser('123')));
      expect(r.status).toBe(403);
      expect(logs('[job-file]')).toEqual([
        `[job-file] denied route=compose-mixed caller=shop site=${SITE_A} fileSite=${SITE_B} ref=url`,
      ]);
      await controller.createComposeMixed(manual({ contentPdfUrl: `api://${FILE_NULL}` }), shopUser('123'));
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
    });

    it("JOB_FILE_SITE_STRICT='true' → 잡 사이트가 NULL 로 결정돼도(키와 본문 siteId 불일치) 키 사이트와 대조해 403", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      const r = await httpError(controller.createComposeMixed(manual({ siteId: SITE_B }), undefined, key(SITE_A)));
      expect(r.status).toBe(403);
      expect(workerJobRepository.save).not.toHaveBeenCalled();
    });

    it("JOB_FILE_SITE_STRICT='true' → 무인증·자동조립 호출은 확인하지 않는다", async () => {
      flags.JOB_FILE_SITE_STRICT = 'true';
      await controller.createComposeMixed(manual(), undefined);
      expect(filesService.findById).not.toHaveBeenCalled();
      expect(workerJobRepository.save).toHaveBeenCalledTimes(1);
      const spy = jest.spyOn(service, 'createComposeMixedJob').mockResolvedValue({ id: 'job-asm' } as never);
      await controller.createComposeMixed(manual({ editSessionId: MEMBER_A, assembleFromSession: true }), shopUser('123'));
      expect(spy).toHaveBeenCalledWith(expect.anything(), expect.anything(), undefined);
    });
  });

  it('플래그는 요청마다 ConfigService 에서 JOB_LINK_STRICT·JOB_FILE_SITE_STRICT 키로 읽는다', async () => {
    await controller.createRenderPages({ fileId: FILE_A, editSessionId: GUEST_A } as never, GUEST_TOKEN);
    expect(requestedKeys).toEqual(['JOB_LINK_STRICT']);
    requestedKeys.length = 0;
    await controller.createValidationJobExternal({ fileId: FILE_A } as never, site(SITE_A));
    expect(requestedKeys).toEqual(['JOB_FILE_SITE_STRICT']);
    requestedKeys.length = 0;
    flags.JOB_FILE_SITE_STRICT = 'true';
    const r = await httpError(controller.createValidationJobExternal({ fileId: FILE_B } as never, site(SITE_A)));
    expect(r.status).toBe(403);
    flags.JOB_FILE_SITE_STRICT = 'false';
    await controller.createValidationJobExternal({ fileId: FILE_B } as never, site(SITE_A));
    expect(create.createValidationJob).toHaveBeenCalledTimes(2);
  });
});
