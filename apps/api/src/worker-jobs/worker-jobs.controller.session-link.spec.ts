/**
 * 잡 생성 라우트의 세션 연결 확인 배선 — 컨트롤러 + 실제 WorkerJobsService.assertEditSessionLink(저장소 mock),
 * 잡 생성 메서드는 spy.
 *
 *  - compose-mixed 수동 경로·validate·validate/external·synthesize/external·split-synthesize/external·render-pages 는
 *    본문 세션 id 가 있을 때만 연결 확인을 거친다. 세션 id 가 없거나 compose-mixed 자동조립(assembleFromSession:true)이면 확인하지 않는다.
 *  - 사이트 키 + 자기 사이트 세션(파트너 서버 경로)은 compose-mixed·synthesize/external 모두 통과하고 잡 생성 인자는 그대로다.
 *  - 운영자·사이트 키·shop 호출자가 연결을 증명하지 못하면 404 SESSION_NOT_FOUND, 잡 미생성.
 *  - 무인증 호출(compose-mixed·render-pages)은 잡을 그대로 만들고 운영 로그만 남긴다(JOB_LINK_STRICT 미설정 시).
 *    연결을 확인하지 못한 호출은 잡 생성 인자에 storeSessionLink:false 를 넘긴다(세션 연결 컬럼 미저장).
 *  - staff 전용 라우트(convert·synthesize·split-synthesize)는 확인하지 않는다.
 *  - 입력 파일(fileId 계열·`api://<uuid>` URL)의 사이트가 호출자 사이트와 다르면 운영 로그(`[job-file] cross-site`).
 */
import { HttpException, Logger } from '@nestjs/common';
import { WorkerJobsController } from './worker-jobs.controller';
import { WorkerJobsService } from './worker-jobs.service';
import type { CurrentSitePayload } from '../auth/decorators/current-site.decorator';

const SITE_BOOKMOA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_PRINTY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SITE_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BOOKMOA_MEMBER = '11111111-1111-4111-8111-111111111111'; // bookmoa 회원 123 · 주문 100
const BOOKMOA_GUEST = '22222222-2222-4222-8222-222222222222'; // bookmoa 비회원
const PRINTY_MEMBER = '33333333-3333-4333-8333-333333333333'; // printy 회원 77
const PRINTY_GUEST = '44444444-4444-4444-8444-444444444444'; // printy 비회원
const OTHER_MEMBER = '55555555-5555-4555-8555-555555555555'; // 다른 사이트 회원 123
const GUEST_TOKEN = 'guest-token-value-7c1e';
const FILE_BOOKMOA = 'f0000000-0000-4000-8000-00000000000a';
const FILE_OTHER = 'f0000000-0000-4000-8000-00000000000b';

interface Row {
  id: string;
  siteId: string | null;
  memberSeqno: number;
  orderSeqno: number;
  guestToken: string | null;
  guestExpiresAt: Date | null;
}

function rowsTable(): Record<string, Row> {
  const future = new Date(Date.now() + 3600_000);
  const row = (id: string, extra: Partial<Row>): Row => ({
    id,
    siteId: SITE_BOOKMOA,
    memberSeqno: 123,
    orderSeqno: 100,
    guestToken: null,
    guestExpiresAt: null,
    ...extra,
  });
  return {
    [BOOKMOA_MEMBER]: row(BOOKMOA_MEMBER, {}),
    [BOOKMOA_GUEST]: row(BOOKMOA_GUEST, { memberSeqno: 0, guestToken: GUEST_TOKEN, guestExpiresAt: future }),
    [PRINTY_MEMBER]: row(PRINTY_MEMBER, { siteId: SITE_PRINTY, memberSeqno: 77, orderSeqno: 0 }),
    [PRINTY_GUEST]: row(PRINTY_GUEST, {
      siteId: SITE_PRINTY,
      memberSeqno: 0,
      orderSeqno: 0,
      guestToken: 'printy-guest-token',
      guestExpiresAt: future,
    }),
    [OTHER_MEMBER]: row(OTHER_MEMBER, { siteId: SITE_OTHER }),
  };
}

/** ApiKeyGuard 가 실은 사이트 컨텍스트(@CurrentSite) */
const site = (siteId: string, role: 'editor' | 'worker' = 'editor'): CurrentSitePayload => ({
  siteId,
  siteName: 'site',
  role,
  apiKey: 'redacted',
  env: 'live',
});
/** OptionalApiKeySiteGuard 가 실은 사이트 키 컨텍스트(@ApiKeySite) */
const apiKeySite = (siteId: string): { siteId: string; siteName: string } => ({ siteId, siteName: 'site' });
const shopUser = (sub: string, siteId: string = SITE_BOOKMOA): Record<string, unknown> => ({
  userId: sub,
  role: 'customer',
  source: 'shop',
  siteId,
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

describe('WorkerJobsController — 세션 연결 확인 배선', () => {
  let service: WorkerJobsService;
  let controller: WorkerJobsController;
  let rows: Record<string, Row>;
  const editSessionRepository = { findOne: jest.fn() };
  const filesService = { findById: jest.fn() };
  let logSpy: jest.SpyInstance;
  let linkSpy: jest.SpyInstance;
  let create: Record<
    | 'createComposeMixedJob'
    | 'createValidationJob'
    | 'createSynthesisJob'
    | 'createSplitSynthesisJob'
    | 'createRenderPagesJob'
    | 'createConversionJob'
    | 'createPageCountFixJob',
    jest.SpyInstance
  >;

  const logs = (prefix: string): string[] =>
    logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith(prefix));

  beforeEach(() => {
    jest.clearAllMocks();
    rows = rowsTable();
    editSessionRepository.findOne.mockImplementation(async (opts: { where: { id: string } }) => {
      const r = rows[opts.where.id];
      return r ? { ...r } : null;
    });
    const files: Record<string, { id: string; siteId: string | null }> = {
      [FILE_BOOKMOA]: { id: FILE_BOOKMOA, siteId: SITE_BOOKMOA },
      [FILE_OTHER]: { id: FILE_OTHER, siteId: SITE_OTHER },
    };
    filesService.findById.mockImplementation(async (id: string) => files[id]);

    service = new WorkerJobsService(
      {} as never,
      editSessionRepository as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      { add: jest.fn() } as never,
      filesService as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const logger = (service as unknown as { logger: Logger }).logger;
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    linkSpy = jest.spyOn(service, 'assertEditSessionLink');
    const job = { id: 'job-1' } as never;
    create = {
      createComposeMixedJob: jest.spyOn(service, 'createComposeMixedJob').mockResolvedValue(job),
      createValidationJob: jest.spyOn(service, 'createValidationJob').mockResolvedValue(job),
      createSynthesisJob: jest.spyOn(service, 'createSynthesisJob').mockResolvedValue(job),
      createSplitSynthesisJob: jest.spyOn(service, 'createSplitSynthesisJob').mockResolvedValue(job),
      createRenderPagesJob: jest.spyOn(service, 'createRenderPagesJob').mockResolvedValue(job),
      createConversionJob: jest.spyOn(service, 'createConversionJob').mockResolvedValue(job),
      createPageCountFixJob: jest.spyOn(service, 'createPageCountFixJob').mockResolvedValue(job),
    };
    controller = new WorkerJobsController(service, { get: jest.fn() } as never);
  });

  // ── 파트너 서버 경로(사이트 키 + 자기 사이트 세션) ─────────────────────────
  describe('P: bookmoa·printy — 사이트 키 + 자기 사이트 세션 editSessionId', () => {
    it.each<[string, string, string]>([
      ['bookmoa 회원 세션', SITE_BOOKMOA, BOOKMOA_MEMBER],
      ['bookmoa 비회원 세션', SITE_BOOKMOA, BOOKMOA_GUEST],
      ['printy 회원 세션', SITE_PRINTY, PRINTY_MEMBER],
      ['printy 비회원 세션', SITE_PRINTY, PRINTY_GUEST],
    ])('P1: compose-mixed 수동 경로 — %s → 201 경로, createComposeMixedJob(dto, undefined, apiKeySite) + 입력 파일 확인 인자', async (_l, siteId, sessionId) => {
      const dto = { editSessionId: sessionId, coverUrl: 'api://cover', contentPdfUrl: 'api://content' } as never;
      const key = apiKeySite(siteId);
      await expect(controller.createComposeMixed(dto, undefined, key)).resolves.toEqual({ id: 'job-1' });
      expect(create.createComposeMixedJob).toHaveBeenCalledWith(dto, undefined, key, undefined, { strict: false });
      expect(logs('[job-link]')).toEqual([]);
    });

    it.each<[string, string, string]>([
      ['bookmoa 회원 세션', SITE_BOOKMOA, BOOKMOA_MEMBER],
      ['bookmoa 비회원 세션', SITE_BOOKMOA, BOOKMOA_GUEST],
      ['printy 회원 세션', SITE_PRINTY, PRINTY_MEMBER],
      ['printy 비회원 세션', SITE_PRINTY, PRINTY_GUEST],
    ])('P2: synthesize/external — %s → createSynthesisJob 인자는 본문 + 사이트 스탬프 그대로', async (_l, siteId, sessionId) => {
      const dto = { editSessionId: sessionId, coverFileId: undefined, coverUrl: 'api://c', contentUrl: 'api://d' } as never;
      await expect(controller.createSynthesisJobExternal(dto, site(siteId))).resolves.toEqual({ id: 'job-1' });
      expect(create.createSynthesisJob).toHaveBeenCalledWith({
        ...(dto as object),
        siteId,
        partnerEnv: 'live',
      });
      expect(logs('[job-link]')).toEqual([]);
    });

    it('P3: 사이트 키 + shop-session 이 함께 와도(같은 사이트) 통과 — caller·사이트 키 인자 분리 유지', async () => {
      const dto = { editSessionId: BOOKMOA_MEMBER } as never;
      const key = apiKeySite(SITE_BOOKMOA);
      await controller.createComposeMixed(dto, shopUser('999'), key);
      expect(create.createComposeMixedJob).toHaveBeenCalledTimes(1);
      const [, caller, keyArg] = create.createComposeMixedJob.mock.calls[0] as unknown[];
      expect(caller).toEqual({
        siteId: SITE_BOOKMOA,
        allowedOrderSeqnos: undefined,
        owner: { memberSeqno: 999, guestToken: undefined },
      });
      expect(keyArg).toBe(key);
    });

    it('P4: 사이트 키 + 다른 사이트 세션 → compose-mixed·synthesize/external 404 SESSION_NOT_FOUND, 잡 미생성', async () => {
      const r1 = await httpError(
        controller.createComposeMixed({ editSessionId: OTHER_MEMBER } as never, undefined, apiKeySite(SITE_BOOKMOA)),
      );
      expect(r1.status).toBe(404);
      expect(r1.body.code).toBe('SESSION_NOT_FOUND');
      const r2 = await httpError(
        controller.createSynthesisJobExternal({ editSessionId: PRINTY_MEMBER } as never, site(SITE_BOOKMOA)),
      );
      expect(r2.body.code).toBe('SESSION_NOT_FOUND');
      expect(create.createComposeMixedJob).not.toHaveBeenCalled();
      expect(create.createSynthesisJob).not.toHaveBeenCalled();
      expect(logs('[job-link]')).toEqual([
        `[job-link] denied route=compose-mixed caller=siteKey site=${SITE_OTHER}`,
        `[job-link] denied route=synthesize/external caller=siteKey site=${SITE_PRINTY}`,
      ]);
    });
  });

  // ── compose-mixed ─────────────────────────────────────────────────────
  describe('compose-mixed', () => {
    it('W1: editSessionId 없음 → 연결 확인 없음, 무인증 그대로 잡 생성', async () => {
      const dto = { coverUrl: 'api://c', contentPdfUrl: 'api://d' } as never;
      await controller.createComposeMixed(dto, undefined);
      expect(linkSpy).not.toHaveBeenCalled();
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(create.createComposeMixedJob).toHaveBeenCalledWith(dto, undefined, undefined);
    });

    it('W2: assembleFromSession:true → 연결 확인 없음(자동조립 소유 판정이 처리)', async () => {
      await controller.createComposeMixed({ editSessionId: OTHER_MEMBER, assembleFromSession: true } as never, undefined);
      expect(linkSpy).not.toHaveBeenCalled();
      expect(create.createComposeMixedJob).toHaveBeenCalledTimes(1);
    });

    it('W3: 무인증 + editSessionId(회원 세션) → 잡 생성(세션 연결 컬럼 미저장), 운영 로그(라우트·유형·사이트만)', async () => {
      const dto = { editSessionId: BOOKMOA_MEMBER } as never;
      await controller.createComposeMixed(dto, undefined);
      expect(create.createComposeMixedJob).toHaveBeenCalledWith(dto, undefined, undefined, undefined, undefined, {
        storeSessionLink: false,
      });
      expect(logs('[job-link]')).toEqual([
        `[job-link] would-deny route=compose-mixed caller=none site=${SITE_BOOKMOA}`,
      ]);
    });

    it('W3-b: 무인증 + 비회원 세션 + 유효한 X-Guest-Token → 잡 생성(세션 연결 저장), 로그 없음', async () => {
      const dto = { editSessionId: BOOKMOA_GUEST } as never;
      await controller.createComposeMixed(dto, undefined, undefined, GUEST_TOKEN);
      expect(create.createComposeMixedJob).toHaveBeenCalledWith(dto, undefined, undefined);
      expect(logs('[job-link]')).toEqual([]);
    });

    it('W4: shop-session — 자기 회원 세션 통과 / 다른 회원 세션 404 / 비회원 세션은 X-Guest-Token 필요', async () => {
      await controller.createComposeMixed({ editSessionId: BOOKMOA_MEMBER } as never, shopUser('123'));
      expect(create.createComposeMixedJob).toHaveBeenCalledTimes(1);

      const r = await httpError(controller.createComposeMixed({ editSessionId: BOOKMOA_MEMBER } as never, shopUser('456')));
      expect(r.body.code).toBe('SESSION_NOT_FOUND');

      const g = await httpError(controller.createComposeMixed({ editSessionId: BOOKMOA_GUEST } as never, shopUser('0')));
      expect(g.body.code).toBe('SESSION_NOT_FOUND');
      await controller.createComposeMixed({ editSessionId: BOOKMOA_GUEST } as never, shopUser('0'), undefined, GUEST_TOKEN);
      expect(create.createComposeMixedJob).toHaveBeenCalledTimes(2);
    });

    it('W4-b: 운영자 토큰·admin JWT 는 shop 호출자가 아니다 → none(잡 생성 + 운영 로그)', async () => {
      await controller.createComposeMixed({ editSessionId: OTHER_MEMBER } as never, { source: 'partner_operator', siteId: SITE_BOOKMOA });
      await controller.createComposeMixed({ editSessionId: OTHER_MEMBER } as never, { role: 'ADMIN', siteId: SITE_BOOKMOA });
      expect(create.createComposeMixedJob).toHaveBeenCalledTimes(2);
      expect(logs('[job-link] would-deny')).toHaveLength(2);
    });
  });

  // ── validate (JWT) ────────────────────────────────────────────────────
  describe('validate', () => {
    const vdto = (extra: Record<string, unknown> = {}): never =>
      ({ fileId: FILE_BOOKMOA, fileType: 'content', ...extra }) as never;

    it('W5-a: shop 회원 123 + 자기 세션 → 통과, 잡 사이트는 토큰 사이트', async () => {
      const dto = vdto({ editSessionId: BOOKMOA_MEMBER });
      await controller.createValidationJob(dto, shopUser('123'));
      expect(create.createValidationJob.mock.calls[0][0]).toEqual({ ...(dto as object), siteId: SITE_BOOKMOA });
      expect(create.createValidationJob.mock.calls[0][1]).toEqual({ skipSiteWorkerDefaults: true, siteWebhookOff: true });
      expect(linkSpy).toHaveBeenCalledWith(
        BOOKMOA_MEMBER,
        [{ kind: 'shop', siteId: SITE_BOOKMOA, memberSeqno: 123, allowedOrderSeqnos: undefined }],
        undefined,
        'validate',
        { strictUnverified: false },
      );
    });

    it("W5-b: shop sub '1.5' + 회원 1 세션 → 404(회원 번호는 양의 정수만)", async () => {
      rows[BOOKMOA_MEMBER] = { ...rows[BOOKMOA_MEMBER], memberSeqno: 1 };
      const r = await httpError(controller.createValidationJob(vdto({ editSessionId: BOOKMOA_MEMBER }), shopUser('1.5')));
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      expect(create.createValidationJob).not.toHaveBeenCalled();
    });

    it('W5-c: shop + 비회원 세션 — X-Guest-Token 헤더 전달 시 통과, 없으면 404', async () => {
      const r = await httpError(controller.createValidationJob(vdto({ editSessionId: BOOKMOA_GUEST }), shopUser('0')));
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      await controller.createValidationJob(vdto({ editSessionId: BOOKMOA_GUEST }), shopUser('0'), GUEST_TOKEN);
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
    });

    it('W5-d: admin-app staff → 조회 없이 통과', async () => {
      await controller.createValidationJob(vdto({ editSessionId: OTHER_MEMBER }), { role: 'ADMIN' });
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
    });

    it('W5-e: 운영자 — 권한 세션이면 통과(사이트는 권한 사이트), 권한 세션이 없는 세션이면 404', async () => {
      const operator = {
        source: 'partner_operator',
        siteId: SITE_BOOKMOA,
        partnerOperator: { siteId: SITE_BOOKMOA, sessionIds: [BOOKMOA_MEMBER, '99999999-9999-4999-8999-999999999999'] },
      };
      await controller.createValidationJob(vdto({ editSessionId: BOOKMOA_MEMBER, siteId: SITE_OTHER }), operator);
      expect(create.createValidationJob.mock.calls[0][0]).toMatchObject({ siteId: SITE_BOOKMOA, editSessionId: BOOKMOA_MEMBER });
      const r = await httpError(
        controller.createValidationJob(vdto({ editSessionId: '99999999-9999-4999-8999-999999999999' }), operator),
      );
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
    });

    it('W5-f: 그 밖의 JWT(admin-app CUSTOMER) → 잡 생성(세션 연결 컬럼 미저장) + 운영 로그', async () => {
      await controller.createValidationJob(vdto({ editSessionId: OTHER_MEMBER }), { role: 'customer' });
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      expect(create.createValidationJob.mock.calls[0][1]).toEqual({ storeSessionLink: false });
      expect(logs('[job-link]')).toEqual([`[job-link] would-deny route=validate caller=none site=${SITE_OTHER}`]);
    });

    it('W5-g: editSessionId 없음 → 연결 확인 없음', async () => {
      await controller.createValidationJob(vdto(), shopUser('123'));
      expect(linkSpy).not.toHaveBeenCalled();
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
    });
  });

  // ── 사이트 키 external 3종 ───────────────────────────────────────────
  describe('external 라우트', () => {
    it('W6-a: validate/external — 같은 사이트 통과, 다른 사이트 404', async () => {
      await controller.createValidationJobExternal({ fileId: FILE_BOOKMOA, editSessionId: BOOKMOA_MEMBER } as never, site(SITE_BOOKMOA));
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      const r = await httpError(
        controller.createValidationJobExternal({ fileId: FILE_BOOKMOA, editSessionId: OTHER_MEMBER } as never, site(SITE_BOOKMOA)),
      );
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
    });

    it('W6-b: split-synthesize/external — sessionId 로 판정(같은 사이트 통과, 다른 사이트 404)', async () => {
      await controller.createSplitSynthesisJobExternal({ sessionId: PRINTY_MEMBER, pdfFileId: FILE_OTHER } as never, site(SITE_PRINTY));
      expect(create.createSplitSynthesisJob).toHaveBeenCalledTimes(1);
      const r = await httpError(
        controller.createSplitSynthesisJobExternal({ sessionId: BOOKMOA_MEMBER, pdfFileId: FILE_OTHER } as never, site(SITE_PRINTY)),
      );
      expect(r.body.code).toBe('SESSION_NOT_FOUND');
      expect(create.createSplitSynthesisJob).toHaveBeenCalledTimes(1);
    });

    it("W6-c: 내부 워커 키(role 'worker') → 조회 없이 통과, 입력 파일 관측 없음", async () => {
      await controller.createSynthesisJobExternal({ editSessionId: OTHER_MEMBER, coverFileId: FILE_OTHER } as never, site(SITE_BOOKMOA, 'worker'));
      await controller.createValidationJobExternal({ editSessionId: OTHER_MEMBER, fileId: FILE_OTHER } as never, site(SITE_BOOKMOA, 'worker'));
      await controller.createSplitSynthesisJobExternal({ sessionId: OTHER_MEMBER, pdfFileId: FILE_OTHER } as never, site(SITE_BOOKMOA, 'worker'));
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(filesService.findById).not.toHaveBeenCalled();
      expect(create.createSynthesisJob).toHaveBeenCalledTimes(1);
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      expect(create.createSplitSynthesisJob).toHaveBeenCalledTimes(1);
    });
  });

  // ── render-pages ─────────────────────────────────────────────────────
  describe('render-pages', () => {
    it('W7-a: editSessionId 없음 → 연결 확인 없음', async () => {
      await controller.createRenderPages({ fileId: FILE_BOOKMOA } as never);
      expect(linkSpy).not.toHaveBeenCalled();
      expect(create.createRenderPagesJob).toHaveBeenCalledTimes(1);
    });

    it('W7-b: editSessionId + 헤더 없음 → 잡 생성(세션 연결 컬럼 미저장) + 운영 로그 / 유효한 X-Guest-Token → 저장, 로그 없음', async () => {
      await controller.createRenderPages({ fileId: FILE_BOOKMOA, editSessionId: BOOKMOA_GUEST } as never);
      expect(logs('[job-link]')).toEqual([
        `[job-link] would-deny route=render-pages caller=none site=${SITE_BOOKMOA}`,
      ]);
      await controller.createRenderPages({ fileId: FILE_BOOKMOA, editSessionId: BOOKMOA_GUEST } as never, GUEST_TOKEN);
      expect(logs('[job-link]')).toHaveLength(1);
      expect(create.createRenderPagesJob).toHaveBeenCalledTimes(2);
      expect(create.createRenderPagesJob.mock.calls[0]).toHaveLength(2);
      expect(create.createRenderPagesJob.mock.calls[0][1]).toEqual({ storeSessionLink: false });
      expect(create.createRenderPagesJob.mock.calls[1]).toHaveLength(1);
    });
  });

  it('W8: staff 전용 라우트(convert·synthesize·split-synthesize) → 연결 확인 없음', async () => {
    await controller.createConversionJob({ fileId: FILE_BOOKMOA, editSessionId: OTHER_MEMBER } as never);
    await controller.createSynthesisJob({ editSessionId: OTHER_MEMBER } as never);
    await controller.createSplitSynthesisJob({ sessionId: OTHER_MEMBER } as never);
    expect(linkSpy).not.toHaveBeenCalled();
    expect(editSessionRepository.findOne).not.toHaveBeenCalled();
  });

  // ── 입력 파일 사이트 관측 ─────────────────────────────────────────────
  describe('입력 파일 사이트 관측', () => {
    it('J1: 사이트 키 호출자의 다른 사이트 입력 파일 → [job-file] cross-site 로그, 잡 생성은 그대로', async () => {
      await controller.createSynthesisJobExternal(
        { coverFileId: FILE_BOOKMOA, contentFileId: FILE_OTHER } as never,
        site(SITE_BOOKMOA),
      );
      await controller.createValidationJobExternal({ fileId: FILE_OTHER } as never, site(SITE_BOOKMOA));
      await controller.createSplitSynthesisJobExternal({ sessionId: BOOKMOA_MEMBER, pdfFileId: FILE_OTHER } as never, site(SITE_BOOKMOA));
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=synthesize/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
        `[job-file] cross-site route=validate/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
        `[job-file] cross-site route=split-synthesize/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
      ]);
      expect(create.createSynthesisJob).toHaveBeenCalledTimes(1);
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      expect(create.createSplitSynthesisJob).toHaveBeenCalledTimes(1);
    });

    it('J2: validate — shop·운영자 호출자 관측, 무인증·staff·사이트 없는 shop 은 관측하지 않음', async () => {
      await controller.createValidationJob({ fileId: FILE_OTHER } as never, shopUser('123'));
      await controller.createValidationJob({ fileId: FILE_OTHER } as never, {
        source: 'partner_operator',
        siteId: SITE_BOOKMOA,
        partnerOperator: { siteId: SITE_BOOKMOA, sessionIds: [] },
      });
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=validate caller=shop site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
        `[job-file] cross-site route=validate caller=operator site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
      ]);
      filesService.findById.mockClear();
      await controller.createValidationJob({ fileId: FILE_OTHER } as never, undefined);
      await controller.createValidationJob({ fileId: FILE_OTHER } as never, { role: 'ADMIN' });
      await controller.createValidationJob({ fileId: FILE_OTHER } as never, { source: 'shop', userId: '123' });
      await controller.createRenderPages({ fileId: FILE_OTHER } as never);
      expect(filesService.findById).not.toHaveBeenCalled();
    });

    it('J3: 같은 사이트 파일 → 로그 없음', async () => {
      await controller.createValidationJobExternal({ fileId: FILE_BOOKMOA } as never, site(SITE_BOOKMOA));
      expect(logs('[job-file]')).toEqual([]);
    });

    it('J4: validate/external·synthesize/external 의 api://<다른 사이트 파일 id> URL 입력 → cross-site … ref=url, 잡 생성 그대로', async () => {
      await controller.createValidationJobExternal({ fileUrl: `api://${FILE_OTHER}` } as never, site(SITE_BOOKMOA));
      await controller.createSynthesisJobExternal(
        { coverUrl: `api://${FILE_BOOKMOA}`, contentUrl: `api://${FILE_OTHER}` } as never,
        site(SITE_BOOKMOA),
      );
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=validate/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER} ref=url`,
        `[job-file] cross-site route=synthesize/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER} ref=url`,
      ]);
      expect(create.createValidationJob).toHaveBeenCalledTimes(1);
      expect(create.createSynthesisJob).toHaveBeenCalledTimes(1);
    });

    it('J4-b: fileId 가 있으면 함께 온 fileUrl·같은 쪽 URL 은 확인 대상이 아니다', async () => {
      await controller.createValidationJobExternal(
        { fileId: FILE_BOOKMOA, fileUrl: `api://${FILE_OTHER}` } as never,
        site(SITE_BOOKMOA),
      );
      await controller.createSynthesisJobExternal(
        { contentFileId: FILE_BOOKMOA, contentUrl: `api://${FILE_OTHER}`, coverUrl: '/storage/c.pdf' } as never,
        site(SITE_BOOKMOA),
      );
      expect(logs('[job-file]')).toEqual([]);
      expect(filesService.findById.mock.calls.map((c: unknown[]) => c[0])).toEqual([FILE_BOOKMOA, FILE_BOOKMOA]);
    });

    it('J5: fix-pagecount/external 의 다른 사이트 파일 → cross-site 로그, 잡 생성 그대로 / 내부 워커 키는 관측하지 않음', async () => {
      await controller.createPageCountFixJobExternal({ fileId: FILE_OTHER } as never, site(SITE_BOOKMOA));
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=fix-pagecount/external caller=siteKey site=${SITE_BOOKMOA} fileSite=${SITE_OTHER}`,
      ]);
      expect(create.createPageCountFixJob).toHaveBeenCalledWith({ fileId: FILE_OTHER, siteId: SITE_BOOKMOA });
      filesService.findById.mockClear();
      await controller.createPageCountFixJobExternal({ fileId: FILE_OTHER } as never, site(SITE_BOOKMOA, 'worker'));
      expect(filesService.findById).not.toHaveBeenCalled();
      expect(create.createPageCountFixJob).toHaveBeenCalledTimes(2);
    });

    it('J6: validate(shop) 의 fileUrl api://<다른 사이트 파일> → cross-site … ref=url / staff 는 관측하지 않음', async () => {
      await controller.createValidationJob({ fileUrl: `api://${FILE_OTHER}`, fileType: 'content' } as never, shopUser('123'));
      expect(logs('[job-file]')).toEqual([
        `[job-file] cross-site route=validate caller=shop site=${SITE_BOOKMOA} fileSite=${SITE_OTHER} ref=url`,
      ]);
      filesService.findById.mockClear();
      await controller.createValidationJob({ fileUrl: `api://${FILE_OTHER}`, fileType: 'content' } as never, { role: 'ADMIN' });
      expect(filesService.findById).not.toHaveBeenCalled();
    });
  });
});
