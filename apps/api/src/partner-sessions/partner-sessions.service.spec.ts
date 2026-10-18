/**
 * PartnerSessionsService 단위 — P2-b 1-call 런처(2026-10-18).
 *
 * 잠그는 계약:
 *  ① status 매핑 5경우(editing/complete/synthesizing/ready/failed)
 *  ② files 조립 — 편집기 PDF·썸네일(api-key) + 완료 잡 outputFiles set→sheet / pages→single(signed, 이름 매칭)
 *  ③ 스코프 404 — 타 site / NULL-site / launch.env 불일치 / 런처 세션 아님
 *  ④ synthesize — 미완료 409 / pdfOutputMode≠duplex-split 422 / coverFileId 없음 409 / 정상 {jobId,revision}
 *  ⑤ launch — 템플릿셋 스코프 404(타 site·비활성) / mode 기본 both / 토큰 발급 호출 인자 / callbackUrl SSRF 422
 *  ⑥ 킬스위치 off → 503, worker 키 → 403
 *  ⑦ EditSessionsService.requestDuplexSplitResynthesis — revision +1 저장·requestId ≤36·siteId/revision 전달
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ErrV1, WorkerJobStatus } from '@storige/types';
import { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import {
  EditSessionsService,
  duplexSplitRevisionRequestId,
  nextSessionRevision,
  sessionRevisionOf,
} from '../edit-sessions/edit-sessions.service';
import { SessionMode, SessionStatus } from '../edit-sessions/entities/edit-session.entity';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';
import * as ssrf from '../common/helpers/ssrf.helper';
import { SheetMapError } from '../edit-sessions/sheet-map';
import {
  PartnerSessionsService,
  buildCalendarView,
  resolveDeliverableStatus,
} from './partner-sessions.service';

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SITE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TS_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const COVER_FILE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const T0 = new Date('2026-10-18T00:00:00.000Z');

const siteA = (o: Partial<CurrentSitePayload> = {}): CurrentSitePayload => ({
  siteId: SITE_A,
  siteName: 'Site A',
  role: 'editor',
  apiKey: 'key-a',
  env: 'live',
  ...o,
});

const makeSession = (o: Record<string, unknown> = {}) => ({
  id: SESSION_ID,
  siteId: SITE_A,
  status: SessionStatus.COMPLETE,
  mode: SessionMode.BOTH,
  orderSeqno: 777,
  memberSeqno: 5,
  templateSetId: TS_ID,
  coverFileId: COVER_FILE_ID,
  coverFile: { id: COVER_FILE_ID, thumbnailUrl: '/thumb.png', createdAt: T0 },
  contentFile: null,
  canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }, { objects: [] }],
  callbackUrl: null,
  completedAt: T0,
  metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1 },
  ...o,
});

const sheetProfile = () => ({
  version: 1,
  kind: 'sheet',
  editorType: 'card',
  pages: { kind: 'fixed', count: 4, labelRule: 'default' },
  sheet: { faces: 2, canvasLayout: 'canvas-pair', binding: 'none', backRotation: 180, duplexFlip: 'long-edge' },
  output: { mode: 'single-pdf' },
});

/** P2-c: 검증 통과(resolveProductProfile)하는 sheet-map 프로파일 — 4쪽 same-sheet, 뒷면 180° */
const sheetMapProfile = (o: Record<string, unknown> = {}) => ({
  ...sheetProfile(),
  sheet: { ...sheetProfile().sheet, pairing: 'same-sheet' },
  output: { mode: 'sheet-map', sheetFiles: 'per-sheet' },
  ...o,
});

const SHEETS_4P = [
  { index: 0, front: { page: 0 }, back: { page: 1, rotate: 180 }, copies: 2, label: 'A' },
  { index: 1, front: { page: 2 }, back: { page: 3, rotate: 180 } },
];

const makeTemplateSet = (o: Record<string, unknown> = {}) => ({
  id: TS_ID,
  siteId: null,
  isActive: true,
  pdfOutputMode: 'duplex-split',
  productProfile: sheetProfile(),
  ...o,
});

describe('PartnerSessionsService (P2-b 1-call 런처)', () => {
  let service: PartnerSessionsService;
  const findById = jest.fn();
  const create = jest.fn();
  const findLatestPartnerVisibleSynthJob = jest.fn();
  const requestDuplexSplitResynthesis = jest.fn();
  const requestSheetMapResynthesis = jest.fn();
  const tsFindOne = jest.fn();
  const createShopSession = jest.fn();
  const issueOutputUrls = jest.fn();
  const envBackup = process.env.PARTNER_SESSION_LAUNCH_ENABLED;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.PARTNER_SESSION_LAUNCH_ENABLED;
    service = new PartnerSessionsService(
      {
        findById,
        create,
        findLatestPartnerVisibleSynthJob,
        requestDuplexSplitResynthesis,
        requestSheetMapResynthesis,
      } as never,
      { findOne: tsFindOne } as never,
      { createShopSession } as never,
      { issueOutputUrls } as never,
    );
    findById.mockResolvedValue(makeSession());
    tsFindOne.mockResolvedValue(makeTemplateSet());
    findLatestPartnerVisibleSynthJob.mockResolvedValue(null);
    create.mockImplementation(async (dto: Record<string, unknown>) => ({ id: SESSION_ID, ...dto }));
    createShopSession.mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' });
    issueOutputUrls.mockResolvedValue({ jobId: 'job-1', files: [], expiresInSec: 300 });
  });

  afterAll(() => {
    if (envBackup === undefined) delete process.env.PARTNER_SESSION_LAUNCH_ENABLED;
    else process.env.PARTNER_SESSION_LAUNCH_ENABLED = envBackup;
  });

  const expectV1 = async (p: Promise<unknown>, code: ErrV1, status: number) => {
    await expect(p).rejects.toBeInstanceOf(PartnerApiException);
    await expect(p).rejects.toMatchObject({ errorCode: code, status });
  };

  // ── ① status 매핑 ─────────────────────────────────────────────────────
  describe('① resolveDeliverableStatus', () => {
    it.each<[string, string | null, string]>([
      [SessionStatus.EDITING, null, 'editing'],
      [SessionStatus.DRAFT, WorkerJobStatus.COMPLETED, 'editing'],
      [SessionStatus.COMPLETE, null, 'complete'],
      [SessionStatus.COMPLETE, WorkerJobStatus.PENDING, 'synthesizing'],
      [SessionStatus.COMPLETE, WorkerJobStatus.PROCESSING, 'synthesizing'],
      [SessionStatus.COMPLETE, WorkerJobStatus.COMPLETED, 'ready'],
      [SessionStatus.COMPLETE, WorkerJobStatus.FAILED, 'failed'],
    ])('session=%s job=%s → %s', (s, j, expected) => {
      expect(resolveDeliverableStatus(s, j)).toBe(expected);
    });
  });

  // ── ② files 조립 ──────────────────────────────────────────────────────
  describe('② deliverables files 조립', () => {
    it('잡 없음 — 편집기 PDF(single, api-key, pageCount) + 썸네일(api-key); product·calendar·revision', async () => {
      findById.mockResolvedValue(
        makeSession({
          metadata: {
            launch: { via: 'partner-v1', env: 'live' },
            revision: 2,
            calendar: { startYear: 2027, startMonth: 3, dataVersion: 'kr-2025-2035-v1' },
            production: { lot: 'L1' },
          },
        }),
      );
      const view = await service.getDeliverables(siteA(), SESSION_ID);

      expect(view.status).toBe('complete');
      expect(view.revision).toBe(2);
      expect(view.orderSeqno).toBe(777);
      expect(view.files).toEqual([
        {
          role: 'single',
          fileId: COVER_FILE_ID,
          url: `/api/files/${COVER_FILE_ID}/download/external`,
          auth: 'api-key',
          pageCount: 4,
          generatedAt: T0.toISOString(),
        },
        { role: 'thumbnail', fileId: COVER_FILE_ID, url: `/api/files/${COVER_FILE_ID}/thumbnail`, auth: 'api-key' },
      ]);
      expect(view.product).toEqual({
        kind: 'sheet',
        editorType: 'card',
        canvasCount: 4,
        sheetCount: 2,
        faces: 2,
        duplexFlip: 'long-edge',
        backRotation: 180,
      });
      expect(view.calendar).toEqual({ startYm: '2027-03', dataVersion: 'kr-2025-2035-v1' });
      expect(view.production).toEqual({ lot: 'L1' });
      expect(issueOutputUrls).not.toHaveBeenCalled();
    });

    it('완료 잡 — outputFiles set→sheet(signed, sheetIndex, jobId, expiresAt) / pages→single; 서명 이름 매칭', async () => {
      const completedAt = new Date('2026-10-18T01:00:00.000Z');
      findLatestPartnerVisibleSynthJob.mockResolvedValue({
        id: 'job-9',
        status: WorkerJobStatus.COMPLETED,
        result: {
          outputFiles: [
            { type: 'set', url: '/storage/outputs/job-9/set-0.pdf', pageCount: 2, setIndex: 0 },
            { type: 'set', url: '/storage/outputs/job-9/set-1.pdf', pageCount: 2, setIndex: 1 },
            { type: 'pages', url: '/storage/outputs/job-9/pages.pdf', pageCount: 4 },
            { type: 'cover', url: '/storage/outputs/job-9/cover.pdf' },
          ],
        },
        outputFileUrl: null,
        createdAt: T0,
        completedAt,
      });
      issueOutputUrls.mockResolvedValue({
        jobId: 'job-9',
        expiresInSec: 300,
        files: [
          { name: 'set-0.pdf', url: '/storage-signed/outputs/job-9/set-0.pdf?md5=a&expires=1800000000', expires: 1800000000 },
          { name: 'set-1.pdf', url: '/storage-signed/outputs/job-9/set-1.pdf?md5=b&expires=1800000000', expires: 1800000000 },
          { name: 'pages.pdf', url: '/storage-signed/outputs/job-9/pages.pdf?md5=c&expires=1800000000', expires: 1800000000 },
          { name: 'cover.pdf', url: '/storage-signed/outputs/job-9/cover.pdf?md5=d&expires=1800000000', expires: 1800000000 },
        ],
      });

      const view = await service.getDeliverables(siteA(), SESSION_ID);

      expect(view.status).toBe('ready');
      expect(issueOutputUrls).toHaveBeenCalledWith('job-9', { siteId: SITE_A, role: 'editor' });
      const signed = view.files.filter((f) => f.auth === 'signed');
      expect(signed).toEqual([
        {
          role: 'sheet',
          jobId: 'job-9',
          url: '/storage-signed/outputs/job-9/set-0.pdf?md5=a&expires=1800000000',
          auth: 'signed',
          sheetIndex: 0,
          pageCount: 2,
          generatedAt: completedAt.toISOString(),
          expiresAt: new Date(1800000000 * 1000).toISOString(),
        },
        expect.objectContaining({ role: 'sheet', sheetIndex: 1 }),
        expect.objectContaining({ role: 'single', jobId: 'job-9', pageCount: 4, auth: 'signed' }),
      ]);
      // cover/content(책 compose) 타입은 싣지 않는다
      expect(view.files.some((f) => f.url.includes('cover.pdf'))).toBe(false);
      // 편집기 원본은 그대로 앞에 남는다
      expect(view.files[0]).toMatchObject({ role: 'single', auth: 'api-key' });
    });

    it('P2-c 완료 sheet-map 잡 — sheets(options.sheets) 싣고 sheet 파일에 copies/label 전달; duplex-split 잡은 sheets 키 없음', async () => {
      const completedAt = new Date('2026-10-18T01:00:00.000Z');
      const job = (options: Record<string, unknown>) => ({
        id: 'job-sm',
        status: WorkerJobStatus.COMPLETED,
        result: {
          outputFiles: [
            { type: 'set', url: '/storage/outputs/job-sm/set-0.pdf', pageCount: 2, setIndex: 0 },
            { type: 'set', url: '/storage/outputs/job-sm/set-1.pdf', pageCount: 2, setIndex: 1 },
          ],
        },
        options,
        outputFileUrl: null,
        createdAt: T0,
        completedAt,
      });
      issueOutputUrls.mockResolvedValue({
        jobId: 'job-sm',
        expiresInSec: 300,
        files: [
          { name: 'set-0.pdf', url: '/storage-signed/outputs/job-sm/set-0.pdf?md5=a&expires=1800000000', expires: 1800000000 },
          { name: 'set-1.pdf', url: '/storage-signed/outputs/job-sm/set-1.pdf?md5=b&expires=1800000000', expires: 1800000000 },
        ],
      });

      findLatestPartnerVisibleSynthJob.mockResolvedValue(
        job({ mode: 'sheet-map', totalExpectedPages: 4, sheets: SHEETS_4P, output: 'per-sheet', duplexFlip: 'long-edge' }),
      );
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.status).toBe('ready');
      expect(view.sheets).toEqual(SHEETS_4P);
      const sheetFiles = view.files.filter((f) => f.role === 'sheet');
      expect(sheetFiles).toEqual([
        expect.objectContaining({ sheetIndex: 0, pageCount: 2, copies: 2, label: 'A', auth: 'signed' }),
        expect.objectContaining({ sheetIndex: 1, pageCount: 2 }),
      ]);
      expect(sheetFiles[1]).not.toHaveProperty('copies');
      expect(sheetFiles[1]).not.toHaveProperty('label');
      // 편집기 원본(api-key)은 영향 없음
      expect(view.files[0]).toMatchObject({ role: 'single', auth: 'api-key' });
      expect(view.files[0]).not.toHaveProperty('copies');

      findLatestPartnerVisibleSynthJob.mockResolvedValue(job({ mode: 'duplex-split', totalExpectedPages: 4 }));
      const dup = await service.getDeliverables(siteA(), SESSION_ID);
      expect(dup).not.toHaveProperty('sheets');
      expect(dup.files.filter((f) => f.role === 'sheet')).toHaveLength(2);
      expect(dup.files.filter((f) => f.role === 'sheet')[0]).not.toHaveProperty('copies');

      // options 없음(종전 행)·sheets 가 배열이 아님 → sheets 키 없음
      findLatestPartnerVisibleSynthJob.mockResolvedValue(job({ mode: 'sheet-map', sheets: 'nope' }));
      expect(await service.getDeliverables(siteA(), SESSION_ID)).not.toHaveProperty('sheets');
      findLatestPartnerVisibleSynthJob.mockResolvedValue({ ...job({}), options: null });
      expect(await service.getDeliverables(siteA(), SESSION_ID)).not.toHaveProperty('sheets');
    });

    it('P2-c 진행 중 sheet-map 잡 — status synthesizing 이어도 sheets 는 싣는다(파일은 없음)', async () => {
      findLatestPartnerVisibleSynthJob.mockResolvedValue({
        id: 'job-sm',
        status: 'PROCESSING',
        result: null,
        options: { mode: 'sheet-map', sheets: SHEETS_4P },
        outputFileUrl: null,
        createdAt: T0,
        completedAt: null,
      });
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.status).toBe('synthesizing');
      expect(view.sheets).toEqual(SHEETS_4P);
      expect(issueOutputUrls).not.toHaveBeenCalled();
    });

    it('진행 중 잡 — synthesizing, 서명 URL 미발급', async () => {
      findLatestPartnerVisibleSynthJob.mockResolvedValue({
        id: 'job-2',
        status: WorkerJobStatus.PROCESSING,
        result: null,
        outputFileUrl: null,
        createdAt: T0,
        completedAt: null,
      });
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.status).toBe('synthesizing');
      expect(issueOutputUrls).not.toHaveBeenCalled();
      expect(view.files.every((f) => f.auth === 'api-key')).toBe(true);
    });

    it('완료 잡인데 산출물 없음(JOB_OUTPUT_NOT_READY 400) — 잡 파일만 비우고 200', async () => {
      findLatestPartnerVisibleSynthJob.mockResolvedValue({
        id: 'job-3',
        status: WorkerJobStatus.COMPLETED,
        result: null,
        outputFileUrl: null,
        createdAt: T0,
        completedAt: T0,
      });
      issueOutputUrls.mockRejectedValue(new BadRequestException({ code: 'JOB_OUTPUT_NOT_READY' }));
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.status).toBe('ready');
      expect(view.files).toHaveLength(2);
    });

    it('NULL 세트(productProfile 없음) — product null, calendar null, 썸네일 없으면 single 만', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ productProfile: null }));
      findById.mockResolvedValue(
        makeSession({
          coverFile: { id: COVER_FILE_ID, thumbnailUrl: null, createdAt: T0 },
          metadata: { launch: { via: 'partner-v1', env: 'live' } },
        }),
      );
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.product).toBeNull();
      expect(view.calendar).toBeNull();
      expect(view.revision).toBe(0);
      expect(view.files.map((f) => f.role)).toEqual(['single']);
      expect(view).not.toHaveProperty('production');
    });

    it('템플릿셋 프로파일이 없으면 세션 스냅샷(metadata.productProfile)을 쓴다', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ productProfile: null }));
      findById.mockResolvedValue(
        makeSession({ metadata: { launch: { via: 'partner-v1', env: 'live' }, productProfile: sheetProfile() } }),
      );
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.product).toMatchObject({ kind: 'sheet', sheetCount: 2 });
    });

    it('미완료 세션 — editing, coverFileId 없으면 files 빈 배열', async () => {
      findById.mockResolvedValue(
        makeSession({ status: SessionStatus.EDITING, coverFileId: null, coverFile: null, completedAt: null }),
      );
      const view = await service.getDeliverables(siteA(), SESSION_ID);
      expect(view.status).toBe('editing');
      expect(view.files).toEqual([]);
    });

    it('buildCalendarView — 월 범위·정수 검사, 형식 불충분이면 null', () => {
      expect(buildCalendarView({})).toBeNull();
      expect(buildCalendarView({ calendar: { startYear: 2027, startMonth: 13 } })).toBeNull();
      expect(buildCalendarView({ calendar: { startYear: 2027, startMonth: 12 } })).toEqual({
        startYm: '2027-12',
        dataVersion: null,
      });
    });
  });

  // ── ③ 스코프 404 ──────────────────────────────────────────────────────
  describe('③ 스코프 — 404 ERR_NOT_FOUND(존재 은닉)', () => {
    it('타 site 세션', async () => {
      findById.mockResolvedValue(makeSession({ siteId: SITE_B }));
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
    });

    it('NULL-site 세션(소유 없음) 명시 거부', async () => {
      findById.mockResolvedValue(makeSession({ siteId: null }));
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
    });

    it('launch.env 불일치 — test 키 세션을 live 키로 / live 세션을 test 키로', async () => {
      findById.mockResolvedValue(makeSession({ metadata: { launch: { via: 'partner-v1', env: 'test' } } }));
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
      findById.mockResolvedValue(makeSession());
      await expectV1(service.getDeliverables(siteA({ env: 'test' }), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
    });

    it('런처로 만들지 않은 세션(metadata.launch 없음)', async () => {
      findById.mockResolvedValue(makeSession({ metadata: {} }));
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
    });

    it('없음(findById 404) → v1 ERR_NOT_FOUND 로 변환', async () => {
      findById.mockRejectedValue(new NotFoundException({ code: 'SESSION_NOT_FOUND' }));
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_NOT_FOUND, 404);
    });

    it('test 키로 만든 세션은 test 키로 보인다', async () => {
      findById.mockResolvedValue(makeSession({ metadata: { launch: { via: 'partner-v1', env: 'test' } } }));
      const view = await service.getDeliverables(siteA({ env: 'test' }), SESSION_ID);
      expect(view.sessionId).toBe(SESSION_ID);
    });
  });

  // ── ④ synthesize ──────────────────────────────────────────────────────
  describe('④ synthesize', () => {
    it('미완료 → 409 ERR_SESSION_NOT_COMPLETE', async () => {
      findById.mockResolvedValue(makeSession({ status: SessionStatus.EDITING }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_SESSION_NOT_COMPLETE, 409);
      expect(requestDuplexSplitResynthesis).not.toHaveBeenCalled();
    });

    it("pdfOutputMode≠'duplex-split' → 422 ERR_OUTPUT_MODE_UNSUPPORTED", async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'duplex-merged' }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422);
    });

    it('템플릿셋 미연결/타 site 셋 → 422 ERR_OUTPUT_MODE_UNSUPPORTED', async () => {
      findById.mockResolvedValue(makeSession({ templateSetId: null }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422);
      findById.mockResolvedValue(makeSession());
      tsFindOne.mockResolvedValue(makeTemplateSet({ siteId: SITE_B }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422);
    });

    it('coverFileId 없음 → 409 ERR_SESSION_NOT_COMPLETE', async () => {
      findById.mockResolvedValue(makeSession({ coverFileId: null, coverFile: null }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_SESSION_NOT_COMPLETE, 409);
    });

    it('정상 → requestDuplexSplitResynthesis(sessionId, {siteId, env}) 결과 {jobId, revision} 그대로', async () => {
      requestDuplexSplitResynthesis.mockResolvedValue({ jobId: 'job-5', revision: 2 });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-5', revision: 2 });
      expect(requestDuplexSplitResynthesis).toHaveBeenCalledWith(SESSION_ID, { siteId: SITE_A, env: 'live' });
    });

    it('진행 중 잡(PENDING/PROCESSING)이 있으면 새 잡 없이 그 jobId·현재 revision 재사용 (보안 리뷰 #3 연타)', async () => {
      findById.mockResolvedValue(makeSession({ metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 3 } }));
      findLatestPartnerVisibleSynthJob.mockResolvedValue({ id: 'job-inflight', status: 'PROCESSING' });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-inflight', revision: 3 });
      expect(requestDuplexSplitResynthesis).not.toHaveBeenCalled();
    });

    it('최신 잡이 COMPLETED/FAILED 면 재사용하지 않고 새 회차 잡', async () => {
      findLatestPartnerVisibleSynthJob.mockResolvedValue({ id: 'job-old', status: 'FAILED' });
      requestDuplexSplitResynthesis.mockResolvedValue({ jobId: 'job-6', revision: 2 });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-6', revision: 2 });
      expect(requestDuplexSplitResynthesis).toHaveBeenCalledTimes(1);
    });
  });

  // ── ④-b synthesize — P2-c sheet-map ───────────────────────────────────
  describe('④-b synthesize — 프로파일 output.mode=sheet-map (P2-c)', () => {
    const flagBackup = process.env.SHEET_MAP_OUTPUT_ENABLED;
    beforeEach(() => {
      delete process.env.SHEET_MAP_OUTPUT_ENABLED;
      requestSheetMapResynthesis.mockResolvedValue({ jobId: 'job-sm', revision: 2 });
    });
    afterAll(() => {
      if (flagBackup === undefined) delete process.env.SHEET_MAP_OUTPUT_ENABLED;
      else process.env.SHEET_MAP_OUTPUT_ENABLED = flagBackup;
    });

    it("템플릿셋 프로파일 sheet-map + pdfOutputMode≠'duplex-split' → 422 해제, requestSheetMapResynthesis 호출", async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-sm', revision: 2 });
      expect(requestSheetMapResynthesis).toHaveBeenCalledWith(SESSION_ID, { siteId: SITE_A, env: 'live' });
      expect(requestDuplexSplitResynthesis).not.toHaveBeenCalled();
    });

    it("sheet-map 프로파일이 pdfOutputMode='duplex-split' 보다 우선한다", async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'duplex-split', productProfile: sheetMapProfile() }));
      await service.synthesize(siteA(), SESSION_ID);
      expect(requestSheetMapResynthesis).toHaveBeenCalledTimes(1);
      expect(requestDuplexSplitResynthesis).not.toHaveBeenCalled();
    });

    it('템플릿셋 프로파일 없음 → 세션 스냅샷(metadata.productProfile) sheet-map 으로 판정', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: null }));
      findById.mockResolvedValue(
        makeSession({ metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1, productProfile: sheetMapProfile() } }),
      );
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-sm', revision: 2 });
      expect(requestSheetMapResynthesis).toHaveBeenCalledTimes(1);
    });

    it('템플릿셋 미연결/타 site 셋이어도 스냅샷이 sheet-map 이면 재합성(스냅샷 = 세트 변경·삭제 뒤 폴백)', async () => {
      findById.mockResolvedValue(
        makeSession({
          templateSetId: null,
          metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1, productProfile: sheetMapProfile() },
        }),
      );
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-sm', revision: 2 });
    });

    it('검증 실패 프로파일(canvas-pair 인데 pairing 없음)은 sheet-map 으로 보지 않는다 → duplex-split 세트면 종전 경로', async () => {
      tsFindOne.mockResolvedValue(
        makeTemplateSet({ pdfOutputMode: 'duplex-split', productProfile: { ...sheetProfile(), output: { mode: 'sheet-map' } } }),
      );
      requestDuplexSplitResynthesis.mockResolvedValue({ jobId: 'job-ds', revision: 2 });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-ds', revision: 2 });
      expect(requestSheetMapResynthesis).not.toHaveBeenCalled();
    });

    it("킬스위치 SHEET_MAP_OUTPUT_ENABLED=off → 프로파일 무시: duplex-split 세트는 종전 경로, 아니면 422", async () => {
      process.env.SHEET_MAP_OUTPUT_ENABLED = 'off';
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422);
      expect(requestSheetMapResynthesis).not.toHaveBeenCalled();

      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'duplex-split', productProfile: sheetMapProfile() }));
      requestDuplexSplitResynthesis.mockResolvedValue({ jobId: 'job-ds', revision: 2 });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-ds', revision: 2 });
      expect(requestSheetMapResynthesis).not.toHaveBeenCalled();
    });

    it('미완료 409 / coverFileId 없음 409 는 sheet-map 에서도 같다', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
      findById.mockResolvedValue(makeSession({ status: SessionStatus.EDITING }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_SESSION_NOT_COMPLETE, 409);
      findById.mockResolvedValue(makeSession({ coverFileId: null, coverFile: null }));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_SESSION_NOT_COMPLETE, 409);
      expect(requestSheetMapResynthesis).not.toHaveBeenCalled();
    });

    it('진행 중 잡(PENDING/PROCESSING)이 있으면 새 잡 없이 그 jobId·현재 revision 재사용', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
      findById.mockResolvedValue(makeSession({ metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 3 } }));
      findLatestPartnerVisibleSynthJob.mockResolvedValue({ id: 'job-inflight', status: 'PENDING' });
      await expect(service.synthesize(siteA(), SESSION_ID)).resolves.toEqual({ jobId: 'job-inflight', revision: 3 });
      expect(requestSheetMapResynthesis).not.toHaveBeenCalled();
    });

    it('SheetMapError(매핑 불가) → 422 ERR_OUTPUT_MODE_UNSUPPORTED(500 아님); 그 밖 오류는 그대로', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
      requestSheetMapResynthesis.mockRejectedValueOnce(new SheetMapError('PAGE_COUNT_MISMATCH', '시트가 참조한 페이지 수 2 ≠ pageCount 4'));
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_OUTPUT_MODE_UNSUPPORTED, 422);
      requestSheetMapResynthesis.mockRejectedValueOnce(new Error('boom'));
      await expect(service.synthesize(siteA(), SESSION_ID)).rejects.toThrow('boom');
    });
  });

  // ── ⑤ launch ──────────────────────────────────────────────────────────
  describe('⑤ launch', () => {
    const body = () => ({
      member: { seqno: 5, id: 'u@example.com', name: '홍길동' },
      templateSetId: TS_ID,
    });

    it('템플릿셋 없음/타 site/비활성 → 404 ERR_NOT_FOUND', async () => {
      tsFindOne.mockRejectedValue(new NotFoundException('x'));
      await expectV1(service.launch(siteA(), body(), 'req_1'), ErrV1.ERR_NOT_FOUND, 404);
      tsFindOne.mockResolvedValue(makeTemplateSet({ siteId: SITE_B }));
      await expectV1(service.launch(siteA(), body(), 'req_1'), ErrV1.ERR_NOT_FOUND, 404);
      tsFindOne.mockResolvedValue(makeTemplateSet({ isActive: false }));
      await expectV1(service.launch(siteA(), body(), 'req_1'), ErrV1.ERR_NOT_FOUND, 404);
      expect(create).not.toHaveBeenCalled();
      expect(createShopSession).not.toHaveBeenCalled();
    });

    it('자기 site 셋은 허용(hybrid)', async () => {
      tsFindOne.mockResolvedValue(makeTemplateSet({ siteId: SITE_A }));
      await expect(service.launch(siteA(), body(), 'req_1')).resolves.toMatchObject({ sessionId: SESSION_ID });
    });

    it('mode 기본 both·metadata.launch 스탬프·productProfile 스냅샷·revision 0·siteId 주입', async () => {
      const view = await service.launch(
        siteA({ env: 'test' }),
        { ...body(), calendar: { startYear: 2027, startMonth: 1 }, items: [{ a: 1 }] },
        'req_abc',
      );
      expect(create).toHaveBeenCalledTimes(1);
      const dto = create.mock.calls[0][0];
      expect(dto).toMatchObject({
        mode: SessionMode.BOTH,
        orderSeqno: 0,
        memberSeqno: 5,
        templateSetId: TS_ID,
        siteId: SITE_A,
        callbackUrl: undefined,
      });
      expect(dto.metadata).toMatchObject({
        launch: { via: 'partner-v1', env: 'test', requestId: 'req_abc' },
        revision: 0,
        calendar: { startYear: 2027, startMonth: 1 },
        items: [{ a: 1 }],
        productProfile: sheetProfile(),
      });
      expect(typeof dto.metadata.launch.launchedAt).toBe('string');
      expect(dto.metadata).not.toHaveProperty('orderOptions');
      expect(dto.metadata).not.toHaveProperty('externalPhotos');
      expect(view).toEqual({
        sessionId: SESSION_ID,
        accessToken: 'at',
        refreshToken: 'rt',
        expiresIn: 3600,
        embed: { sessionId: SESSION_ID, token: 'at', refreshToken: 'rt' },
      });
    });

    it('mode cover/content 는 그대로, orderSeqno 는 세션·토큰·embed 에 전달', async () => {
      const view = await service.launch(siteA(), { ...body(), mode: 'cover', orderSeqno: 123 }, 'req_1');
      expect(create.mock.calls[0][0]).toMatchObject({ mode: SessionMode.COVER, orderSeqno: 123 });
      expect(createShopSession).toHaveBeenCalledWith(
        { memberSeqno: 5, memberId: 'u@example.com', memberName: '홍길동', orderSeqno: 123 },
        { siteId: SITE_A, siteName: 'Site A' },
      );
      expect(view.embed).toEqual({ sessionId: SESSION_ID, token: 'at', refreshToken: 'rt', orderSeqno: 123 });
    });

    it('callbackUrl — 공개 호스트면 세션에 저장, 사설/루프백이면 422 ERR_WEBHOOK_URL_FORBIDDEN(세션 미생성)', async () => {
      const spy = jest.spyOn(ssrf, 'isRemoteUrlPublic');
      spy.mockResolvedValueOnce(true);
      await service.launch(siteA(), { ...body(), callbackUrl: 'https://partner.example.com/cb' }, 'req_1');
      expect(create.mock.calls[0][0]).toMatchObject({ callbackUrl: 'https://partner.example.com/cb' });

      create.mockClear();
      spy.mockResolvedValueOnce(false);
      await expectV1(
        service.launch(siteA(), { ...body(), callbackUrl: 'https://10.0.0.1/cb' }, 'req_1'),
        ErrV1.ERR_WEBHOOK_URL_FORBIDDEN,
        422,
      );
      expect(create).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ── ⑥ 가드 ────────────────────────────────────────────────────────────
  describe('⑥ 킬스위치·호출자', () => {
    it('PARTNER_SESSION_LAUNCH_ENABLED=off → 3경로 503 ERR_SERVICE_UNAVAILABLE', async () => {
      process.env.PARTNER_SESSION_LAUNCH_ENABLED = 'off';
      const body = { member: { seqno: 1, id: 'a', name: 'b' }, templateSetId: TS_ID };
      await expectV1(service.launch(siteA(), body, 'r'), ErrV1.ERR_SERVICE_UNAVAILABLE, 503);
      await expectV1(service.getDeliverables(siteA(), SESSION_ID), ErrV1.ERR_SERVICE_UNAVAILABLE, 503);
      await expectV1(service.synthesize(siteA(), SESSION_ID), ErrV1.ERR_SERVICE_UNAVAILABLE, 503);
      expect(findById).not.toHaveBeenCalled();
    });

    it("worker 키(role 'worker') / site 없음 → 403 ERR_FORBIDDEN", async () => {
      await expectV1(service.getDeliverables(siteA({ role: 'worker' }), SESSION_ID), ErrV1.ERR_FORBIDDEN, 403);
      await expectV1(service.synthesize(undefined, SESSION_ID), ErrV1.ERR_FORBIDDEN, 403);
      expect(findById).not.toHaveBeenCalled();
    });
  });
});

// ── ⑦ EditSessionsService.requestDuplexSplitResynthesis ──────────────────
describe('EditSessionsService.requestDuplexSplitResynthesis (P2-b)', () => {
  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x: Record<string, unknown>) => x),
    manager: { query: jest.fn() },
  };
  const createDuplexSplitJob = jest.fn();
  let service: EditSessionsService;

  const session = (o: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    siteId: SITE_A,
    status: SessionStatus.COMPLETE,
    coverFileId: COVER_FILE_ID,
    coverFile: { id: COVER_FILE_ID },
    contentFile: null,
    callbackUrl: 'https://partner.example.com/cb',
    metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1 },
    ...o,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EditSessionsService(
      sessionRepo as never,
      {} as never,
      { createDuplexSplitJob } as never,
      {} as never,
    );
    sessionRepo.findOne.mockResolvedValue(session());
    createDuplexSplitJob.mockResolvedValue({ id: 'job-7' });
  });

  it('revision 헬퍼 — 비정수/음수/없음은 0, 다음 회차 +1, requestId 36자 이내', () => {
    expect(sessionRevisionOf(null)).toBe(0);
    expect(sessionRevisionOf({ revision: '3' })).toBe(0);
    expect(sessionRevisionOf({ revision: -1 })).toBe(0);
    expect(sessionRevisionOf({ revision: 4 })).toBe(4);
    expect(nextSessionRevision({ revision: 4 })).toBe(5);
    expect(duplexSplitRevisionRequestId(1)).toBe('duplex-split-r1');
    expect(duplexSplitRevisionRequestId(999999999).length).toBeLessThanOrEqual(36);
  });

  it('정상 — revision 1→2 저장 후 duplex-split 잡(requestId duplex-split-r2 · siteId · revision · callbackUrl)', async () => {
    const out = await service.requestDuplexSplitResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' });

    expect(out).toEqual({ jobId: 'job-7', revision: 2 });
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    expect(sessionRepo.save.mock.calls[0][0].metadata).toMatchObject({ revision: 2, launch: { env: 'live' } });
    expect(createDuplexSplitJob).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      pdfFileId: COVER_FILE_ID,
      requestId: 'duplex-split-r2',
      callbackUrl: 'https://partner.example.com/cb',
      siteId: SITE_A,
      revision: 2,
    });
    expect((createDuplexSplitJob.mock.calls[0][0].requestId as string).length).toBeLessThanOrEqual(36);
  });

  it('revision 없던 세션 — 1 로 시작', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ metadata: { launch: { via: 'partner-v1', env: 'live' } } }));
    await expect(service.requestDuplexSplitResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).resolves.toEqual(
      { jobId: 'job-7', revision: 1 },
    );
  });

  it('방어적 스코프 — 타 site / env 불일치 / NULL-site 는 404 SESSION_NOT_FOUND, 저장·잡 없음', async () => {
    for (const bad of [
      session({ siteId: SITE_B }),
      session({ siteId: null }),
      session({ metadata: { launch: { env: 'test' }, revision: 1 } }),
    ]) {
      sessionRepo.findOne.mockResolvedValue(bad);
      await expect(
        service.requestDuplexSplitResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(sessionRepo.save).not.toHaveBeenCalled();
    expect(createDuplexSplitJob).not.toHaveBeenCalled();
  });

  it('방어적 완료 게이트 — 미완료/coverFileId 없음은 400 SESSION_NOT_COMPLETE', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ status: SessionStatus.EDITING }));
    await expect(
      service.requestDuplexSplitResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessionRepo.save).not.toHaveBeenCalled();
  });
});

// ── ⑦-b EditSessionsService.requestSheetMapResynthesis (P2-c) ────────────
describe('EditSessionsService.requestSheetMapResynthesis (P2-c)', () => {
  const sessionRepo = {
    findOne: jest.fn(),
    save: jest.fn(async (x: Record<string, unknown>) => x),
    manager: { query: jest.fn() },
  };
  const createDuplexSplitJob = jest.fn();
  const createSheetMapJob = jest.fn();
  const tsFindOneRaw = jest.fn();
  let service: EditSessionsService;

  const session = (o: Record<string, unknown> = {}) => ({
    id: SESSION_ID,
    siteId: SITE_A,
    status: SessionStatus.COMPLETE,
    templateSetId: TS_ID,
    coverFileId: COVER_FILE_ID,
    coverFile: { id: COVER_FILE_ID },
    contentFile: null,
    callbackUrl: 'https://partner.example.com/cb',
    canvasData: [{ objects: [] }, { objects: [] }, { objects: [] }, { objects: [] }],
    metadata: { launch: { via: 'partner-v1', env: 'live' }, revision: 1 },
    ...o,
  });

  const EXPECTED_SHEETS = [
    { index: 0, front: { page: 0 }, back: { page: 1, rotate: 180 } },
    { index: 1, front: { page: 2 }, back: { page: 3, rotate: 180 } },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EditSessionsService(
      sessionRepo as never,
      {} as never,
      { createDuplexSplitJob, createSheetMapJob } as never,
      { findOne: tsFindOneRaw } as never,
    );
    sessionRepo.findOne.mockResolvedValue(session());
    tsFindOneRaw.mockResolvedValue(makeTemplateSet({ pdfOutputMode: 'single', productProfile: sheetMapProfile() }));
    createSheetMapJob.mockResolvedValue({ id: 'job-8' });
  });

  it('정상 — revision 1→2 저장 후 sheet-map 잡(requestId sheet-map-r2 · sheets · output · duplexFlip · siteId · revision · callbackUrl)', async () => {
    const out = await service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' });

    expect(out).toEqual({ jobId: 'job-8', revision: 2 });
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    expect(sessionRepo.save.mock.calls[0][0].metadata).toMatchObject({ revision: 2, launch: { env: 'live' } });
    expect(createSheetMapJob).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      pdfFileId: COVER_FILE_ID,
      sheets: EXPECTED_SHEETS,
      output: 'per-sheet',
      duplexFlip: 'long-edge',
      requestId: 'sheet-map-r2',
      callbackUrl: 'https://partner.example.com/cb',
      siteId: SITE_A,
      revision: 2,
    });
    expect(createDuplexSplitJob).not.toHaveBeenCalled();
  });

  it('템플릿셋 조회 실패·프로파일 없음 → 세션 스냅샷 프로파일(sheetFiles merged-duplex 전달)', async () => {
    tsFindOneRaw.mockRejectedValue(new Error('db down'));
    sessionRepo.findOne.mockResolvedValue(
      session({
        metadata: {
          launch: { via: 'partner-v1', env: 'live' },
          revision: 4,
          productProfile: sheetMapProfile({ output: { mode: 'sheet-map', sheetFiles: 'merged-duplex' } }),
        },
      }),
    );
    await expect(service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).resolves.toEqual({
      jobId: 'job-8',
      revision: 5,
    });
    expect(createSheetMapJob).toHaveBeenCalledWith(expect.objectContaining({ output: 'merged-duplex', requestId: 'sheet-map-r5' }));
  });

  it('프로파일이 sheet-map 이 아니면 400 OUTPUT_MODE_UNSUPPORTED — revision 은 이미 올라가 있고 잡 없음', async () => {
    tsFindOneRaw.mockResolvedValue(makeTemplateSet({ productProfile: sheetProfile() }));
    await expect(service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).rejects.toMatchObject({
      response: { code: 'OUTPUT_MODE_UNSUPPORTED' },
    });
    expect(sessionRepo.save).toHaveBeenCalledTimes(1);
    expect(createSheetMapJob).not.toHaveBeenCalled();
  });

  it('페이지 수 ≠ pages.count → SheetMapError 그대로(호출측이 422 로 변환), 잡 없음', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ canvasData: [{ objects: [] }, { objects: [] }] }));
    await expect(service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).rejects.toBeInstanceOf(
      SheetMapError,
    );
    expect(createSheetMapJob).not.toHaveBeenCalled();
  });

  it('방어적 스코프·완료 게이트는 duplex-split 과 같다(404 SESSION_NOT_FOUND / 400 SESSION_NOT_COMPLETE)', async () => {
    sessionRepo.findOne.mockResolvedValue(session({ siteId: SITE_B }));
    await expect(service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).rejects.toMatchObject({
      response: { code: 'SESSION_NOT_FOUND' },
    });
    sessionRepo.findOne.mockResolvedValue(session({ status: SessionStatus.EDITING }));
    await expect(service.requestSheetMapResynthesis(SESSION_ID, { siteId: SITE_A, env: 'live' })).rejects.toMatchObject({
      response: { code: 'SESSION_NOT_COMPLETE' },
    });
    expect(sessionRepo.save).not.toHaveBeenCalled();
    expect(createSheetMapJob).not.toHaveBeenCalled();
  });
});

describe('normalizeLaunchCalendar — launch body calendar.startYm 변환', () => {
  const { normalizeLaunchCalendar } = require('./partner-sessions.service');
  it("startYm 'YYYY-MM' → startYear/startMonth 정수 + anniversaries [](편집기 restore 형식), startYm 은 제거", () => {
    expect(normalizeLaunchCalendar({ startYm: '2027-01' })).toEqual({ startYear: 2027, startMonth: 1, anniversaries: [] });
  });
  it('이미 startYear/startMonth 가 있으면 그대로, dataVersion 등 다른 키는 보존', () => {
    expect(normalizeLaunchCalendar({ startYear: 2027, startMonth: 3, dataVersion: 'kr-2025-2035-v1' }))
      .toEqual({ startYear: 2027, startMonth: 3, dataVersion: 'kr-2025-2035-v1' });
  });
  it('형식이 아닌 startYm(월 13, 문자열) 은 변환하지 않고 그대로 기록', () => {
    expect(normalizeLaunchCalendar({ startYm: '2027-13' })).toEqual({ startYm: '2027-13' });
    expect(normalizeLaunchCalendar({ startYm: 'next-year' })).toEqual({ startYm: 'next-year' });
  });
});

describe('보안 리뷰 반영(2026-10-18) — synthesize 연타 재사용 · launch 본문 상한', () => {
  const mod = require('./partner-sessions.service');
  it('launchPayloadBytes / assertLaunchPayloadWithinLimit — 상한 이내 통과, 초과 400 ERR_VALIDATION_FAILED', () => {
    expect(mod.launchPayloadBytes({ orderOptions: { a: 1 } })).toBeGreaterThan(0);
    expect(() => mod.assertLaunchPayloadWithinLimit({ items: [] })).not.toThrow();
    const big = { items: [{ note: 'x'.repeat(mod.LAUNCH_PAYLOAD_MAX_BYTES + 1) }] };
    expect(() => mod.assertLaunchPayloadWithinLimit(big)).toThrow(/상한/);
    try { mod.assertLaunchPayloadWithinLimit(big); } catch (e: any) { expect(e.status ?? e.getStatus?.()).toBe(400); }
  });
  it('SYNTH_IN_FLIGHT_STATUSES — PENDING·PROCESSING 만', () => {
    expect(mod.SYNTH_IN_FLIGHT_STATUSES.has('PENDING')).toBe(true);
    expect(mod.SYNTH_IN_FLIGHT_STATUSES.has('PROCESSING')).toBe(true);
    expect(mod.SYNTH_IN_FLIGHT_STATUSES.has('COMPLETED')).toBe(false);
    expect(mod.SYNTH_IN_FLIGHT_STATUSES.has('FAILED')).toBe(false);
  });
});
