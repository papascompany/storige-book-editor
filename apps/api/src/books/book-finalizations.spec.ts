/**
 * Partner API v1 — Books 최종화 상태머신 유닛 (Stage 3 W3 + #4 콜백 역참조 + W5 env).
 *
 * BookFinalizationsService 를 직접 생성(레포/서비스 mock)해 §6.3 상태머신을 잠근다:
 *  ① 진행 중 재호출 → 409 ERR_FINALIZATION_IN_PROGRESS (도메인, 멱등 인터셉터와 별개)
 *  ② COMPLETED 재호출 → 기존 결과 재전달(200, 새 잡 미생성)
 *  ③ 자산 미비(PDF_UPLOAD 표지 결측) → 422 ERR_ASSETS_INCOMPLETE
 *  ④ MIX_COVER_TEMPLATE → 422 (템플릿 표지 렌더 미도입 — TEMPLATE_COVER_NOT_RENDERED)
 *  ⑤ PDF_UPLOAD(spec 미연결) → 검증 skip → 바로 COMPOSING(createSynthesisJob, partnerEnv/#4 마커)
 *  ⑥ PDF_UPLOAD(spec+pageCount) → VALIDATING(createValidationJob, orderOptions 판형 대조)
 *  ⑦ 페이지 규칙 위반(spec) → 422 ERR_PAGE_COUNT_OUT_OF_RANGE
 *  ⑧ #4 콜백: validate COMPLETED→COMPOSING / compose COMPLETED→COMPLETED+FINALIZED+웹훅
 *  ⑨ #4 콜백: validate FAILED→FAILED(book DRAFT 유지)+웹훅 book.finalization.failed
 *  ⑩ 멱등: 이미 COMPLETED 인 finalization 콜백 재유입 → no-op
 *  ⑪ FAILED 후 재착수 → attempt+1
 *  ⑫ W5 test env: book.env='test' → 잡 partnerEnv='test' 전달 + 웹훅 context.env='test'
 *  ⑬ X1: bookSpec 연결 → 합성 인자 contentTrim(재단·도련·허용오차, source 'bookSpec'), 조회 실패·무효는 키 없음
 *  ⑭ 겹치는 보고: 상태 전이는 읽은 상태일 때만 쓰고, 전이·도서 확정·웹훅은 최종화당 한 번
 */
import { ErrV1, WorkerJobStatus } from '@storige/types';
import { BookFinalizationsService } from './book-finalizations.service';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';

type AnyRec = Record<string, any>;

const SITE = { siteId: 'site-a', siteName: 'A', role: 'editor' as const, apiKey: 'k', env: 'live' as const };

const makeBook = (o: AnyRec = {}): AnyRec => ({
  id: 'book-1',
  uid: 'bk_0001',
  siteId: 'site-a',
  env: 'live',
  creationType: 'PDF_UPLOAD',
  bookSpecId: null,
  status: 'DRAFT',
  pageCount: null,
  title: null,
  editSessionId: null,
  partnerRef: null,
  finalizedAt: null,
  ...o,
});

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: Error) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 조건이 참이 될 때까지 이벤트 루프를 몇 차례 넘긴다(겹치는 보고 인터리빙용). */
async function waitUntil(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !cond(); i++) {
    await new Promise((r) => setImmediate(r));
  }
}

describe('BookFinalizationsService — 상태머신(W3) + 콜백 역참조(#4) + env(W5)', () => {
  let svc: BookFinalizationsService;
  let bookRepo: AnyRec;
  let assetRepo: AnyRec;
  let finRepo: AnyRec;
  let specRepo: AnyRec;
  let booksService: AnyRec;
  let bookSpecsService: AnyRec;
  let workerJobsService: AnyRec;
  let filesService: AnyRec;
  let webhookService: AnyRec;

  const activeAssets = (types: string[]): AnyRec[] =>
    types.map((t, i) => ({ id: `a${i}`, assetType: t, fileId: `f_${t}`, status: 'active' }));

  beforeEach(() => {
    bookRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (b: AnyRec) => b),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    assetRepo = { find: jest.fn(async () => activeAssets(['pdf_cover', 'pdf_contents'])) };
    finRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x: AnyRec) => ({ ...x })),
      save: jest.fn(async (x: AnyRec) => ({ id: x.id ?? 'fin-1', createdAt: new Date('2026-01-01T00:00:00Z'), ...x })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    specRepo = { findOne: jest.fn(async () => null) };
    booksService = { findBookForSite: jest.fn(async () => makeBook()) };
    bookSpecsService = { assertPageRules: jest.fn() };
    workerJobsService = {
      createValidationJob: jest.fn(async () => ({ id: 'vjob-1' })),
      createSynthesisJob: jest.fn(async () => ({ id: 'sjob-1' })),
    };
    filesService = {
      registerExternalFile: jest.fn(async () => ({ id: 'out-file-1' })),
      findById: jest.fn(async () => ({ id: 'out-file-1' })),
      softDelete: jest.fn(async () => undefined),
    };
    webhookService = { sendCallback: jest.fn(async () => true) };

    svc = new BookFinalizationsService(
      bookRepo as never,
      assetRepo as never,
      finRepo as never,
      specRepo as never,
      booksService as never,
      bookSpecsService as never,
      workerJobsService as never,
      filesService as never,
      webhookService as never,
    );
  });

  // ── 착수 게이트 ──────────────────────────────────────────────────────

  it('① 진행 중 재호출 → 409 ERR_FINALIZATION_IN_PROGRESS', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-x', attempt: 1, status: 'VALIDATING' });
    await expect(svc.startFinalization(SITE, 'bk_0001')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_FINALIZATION_IN_PROGRESS,
      status: 409,
    });
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
  });

  it('② COMPLETED 재호출 → 기존 결과 재전달(새 잡 미생성)', async () => {
    finRepo.findOne.mockResolvedValue({
      id: 'fin-done', uid: 'fin_done', attempt: 1, status: 'COMPLETED',
      pageCount: 40, outputFileId: 'out-1', errorCode: null, errorDetail: null,
      createdAt: new Date('2026-01-01T00:00:00Z'), startedAt: null, completedAt: new Date('2026-01-01T01:00:00Z'),
    });
    const view = await svc.startFinalization(SITE, 'bk_0001');
    expect(view.status).toBe('COMPLETED');
    expect(view.uid).toBe('fin_done');
    expect(view.outputFileId).toBe('out-1');
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
    expect(workerJobsService.createSynthesisJob).not.toHaveBeenCalled();
  });

  it('③ 자산 미비(PDF_UPLOAD 표지 결측) → 422 ERR_ASSETS_INCOMPLETE', async () => {
    assetRepo.find.mockResolvedValue(activeAssets(['pdf_contents'])); // 표지 없음
    await expect(svc.startFinalization(SITE, 'bk_0001')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_ASSETS_INCOMPLETE,
      status: 422,
    });
  });

  it('④ MIX_COVER_TEMPLATE → 422 (템플릿 표지 렌더 미도입)', async () => {
    booksService.findBookForSite.mockResolvedValue(makeBook({ creationType: 'MIX_COVER_TEMPLATE' }));
    assetRepo.find.mockResolvedValue(activeAssets(['pdf_contents', 'cover_binding']));
    const err = (await svc
      .startFinalization(SITE, 'bk_0001')
      .catch((e) => e)) as PartnerApiException;
    expect(err).toBeInstanceOf(PartnerApiException);
    expect(err.errorCode).toBe(ErrV1.ERR_ASSETS_INCOMPLETE);
    expect(err.getStatus()).toBe(422);
    expect(err.errorItems[0]?.code).toBe('TEMPLATE_COVER_NOT_RENDERED');
    expect(workerJobsService.createSynthesisJob).not.toHaveBeenCalled();
  });

  it('⑤ PDF_UPLOAD(spec 미연결) → 검증 skip → 바로 COMPOSING(createSynthesisJob, #4 마커)', async () => {
    const view = await svc.startFinalization(SITE, 'bk_0001');
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
    expect(workerJobsService.createSynthesisJob).toHaveBeenCalledTimes(1);
    const arg = workerJobsService.createSynthesisJob.mock.calls[0][0];
    expect(arg.coverFileId).toBe('f_pdf_cover');
    expect(arg.contentFileId).toBe('f_pdf_contents');
    expect(arg.partnerEnv).toBe('live');
    expect(arg.finalizationId).toBe('fin-1'); // #4 역참조 마커
    expect(view.status).toBe('COMPOSING');
  });

  it('⑥ PDF_UPLOAD(spec+pageCount) → VALIDATING(createValidationJob, 판형 orderOptions)', async () => {
    booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: 40 }));
    specRepo.findOne.mockResolvedValue({
      id: 'spec-1', innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3,
      sizeToleranceMm: 1, pageIncrement: 2, bindingType: 'perfect', pageMin: 24, pageMax: 200,
    });
    const view = await svc.startFinalization(SITE, 'bk_0001');
    expect(workerJobsService.createValidationJob).toHaveBeenCalledTimes(1);
    const arg = workerJobsService.createValidationJob.mock.calls[0][0];
    expect(arg.fileId).toBe('f_pdf_contents');
    expect(arg.orderOptions.size).toEqual({ width: 148, height: 210 });
    expect(arg.orderOptions.pages).toBe(40);
    expect(arg.orderOptions.pageMultiple).toBe(2);
    expect(arg.partnerEnv).toBe('live');
    expect(arg.finalizationId).toBe('fin-1');
    expect(view.status).toBe('VALIDATING');
    expect(workerJobsService.createSynthesisJob).not.toHaveBeenCalled();
  });

  it('⑦ 페이지 규칙 위반(spec) → 422 ERR_PAGE_COUNT_OUT_OF_RANGE(assertPageRules 재사용)', async () => {
    booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: 41 }));
    specRepo.findOne.mockResolvedValue({ id: 'spec-1', pageMin: 24, pageMax: 200, pageIncrement: 2, innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3, sizeToleranceMm: 1, bindingType: 'perfect' });
    bookSpecsService.assertPageRules.mockImplementation(() => {
      throw new PartnerApiException(ErrV1.ERR_PAGE_COUNT_OUT_OF_RANGE, 422, 'x');
    });
    await expect(svc.startFinalization(SITE, 'bk_0001')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_PAGE_COUNT_OUT_OF_RANGE,
      status: 422,
    });
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
  });

  // ── #4 콜백 역참조 ───────────────────────────────────────────────────

  it('⑧ 콜백: validate COMPLETED → COMPOSING(synthesize 착수)', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1' });
    bookRepo.findOne.mockResolvedValue(makeBook());
    const job = { id: 'vjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, result: { totalPages: 40 } };
    await svc.onWorkerJobSettled(job as never);
    expect(workerJobsService.createSynthesisJob).toHaveBeenCalledTimes(1);
    const [where, patch] = finRepo.update.mock.calls.at(-1);
    expect(where).toEqual({ id: 'fin-1', status: 'VALIDATING' });
    expect(patch).toEqual({ status: 'COMPOSING', composeJobId: 'sjob-1' });
    expect(finRepo.save).not.toHaveBeenCalled();
  });

  it('⑧ 콜백: compose COMPLETED → registerExternalFile→COMPLETED+book FINALIZED+웹훅 completed', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1' });
    const book = makeBook();
    bookRepo.findOne.mockResolvedValue(book);
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, outputFileUrl: '/storage/outputs/sjob-1/merged.pdf', result: { totalPages: 42 } };
    await svc.onWorkerJobSettled(job as never);
    expect(filesService.registerExternalFile).toHaveBeenCalledTimes(1);
    const [finWhere, finPatch] = finRepo.update.mock.calls.at(-1);
    expect(finWhere).toEqual({ id: 'fin-1', status: 'COMPOSING' });
    expect(finPatch).toEqual({ status: 'COMPLETED', outputFileId: 'out-file-1', pageCount: 42, completedAt: expect.any(Date) });
    expect(bookRepo.update).toHaveBeenCalledTimes(1);
    expect(bookRepo.update).toHaveBeenCalledWith(
      { id: 'book-1' },
      { status: 'FINALIZED', finalizedAt: expect.any(Date), pageCount: 42 },
    );
    expect(bookRepo.save).not.toHaveBeenCalled();
    expect(finRepo.save).not.toHaveBeenCalled();
    const [url, payload, ctx] = webhookService.sendCallback.mock.calls.at(-1);
    expect(url).toBe('');
    expect(payload.event).toBe('book.finalization.completed');
    expect(payload.bookUid).toBe('bk_0001');
    expect(payload.outputFileId).toBe('out-file-1');
    expect(ctx).toEqual({ siteId: 'site-a', env: 'live' });
  });

  it('⑨ 콜백: validate FAILED → FAILED(book DRAFT 유지)+웹훅 failed', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1' });
    const book = makeBook();
    bookRepo.findOne.mockResolvedValue(book);
    const job = { id: 'vjob-1', status: WorkerJobStatus.FAILED, options: { finalizationId: 'fin-1' }, result: { errors: ['bad'] } };
    await svc.onWorkerJobSettled(job as never);
    const [finWhere, finPatch] = finRepo.update.mock.calls.at(-1);
    expect(finWhere).toEqual({ id: 'fin-1', status: 'VALIDATING' });
    expect(finPatch.status).toBe('FAILED');
    expect(finPatch.errorCode).toBe(ErrV1.ERR_PDF_VALIDATION_FAILED);
    expect(bookRepo.update).not.toHaveBeenCalled(); // book DRAFT 유지
    expect(webhookService.sendCallback.mock.calls.at(-1)[1].event).toBe('book.finalization.failed');
  });

  it('⑩ 멱등: 이미 COMPLETED 인 finalization 콜백 재유입 → no-op', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', status: 'COMPLETED', bookId: 'book-1' });
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' } };
    await svc.onWorkerJobSettled(job as never);
    expect(finRepo.update).not.toHaveBeenCalled();
    expect(bookRepo.update).not.toHaveBeenCalled();
    expect(webhookService.sendCallback).not.toHaveBeenCalled();
    expect(filesService.registerExternalFile).not.toHaveBeenCalled();
  });

  it('⑩-b 콜백: finalizationId 마커 없는 잡 → no-op(기존 파트너 잡 불변)', async () => {
    const job = { id: 'jx', status: WorkerJobStatus.COMPLETED, options: {} };
    await svc.onWorkerJobSettled(job as never);
    expect(finRepo.findOne).not.toHaveBeenCalled();
  });

  it('⑪ FAILED 후 재착수 → attempt+1', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-prev', attempt: 2, status: 'FAILED' });
    await svc.startFinalization(SITE, 'bk_0001');
    const created = finRepo.create.mock.calls[0][0];
    expect(created.attempt).toBe(3);
  });

  // ── W5 test env 관통 ─────────────────────────────────────────────────

  it('⑫ test env book → 잡 partnerEnv=test + 웹훅 context.env=test(격리)', async () => {
    booksService.findBookForSite.mockResolvedValue(makeBook({ env: 'test' }));
    await svc.startFinalization(SITE, 'bk_0001'); // spec 미연결 → 바로 synthesize
    expect(workerJobsService.createSynthesisJob.mock.calls[0][0].partnerEnv).toBe('test');

    // compose 완료 콜백 → 웹훅 context.env='test'
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1' });
    bookRepo.findOne.mockResolvedValue(makeBook({ env: 'test' }));
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, outputFileUrl: '/storage/outputs/x/merged.pdf', result: { totalPages: 10 } };
    await svc.onWorkerJobSettled(job as never);
    expect(webhookService.sendCallback.mock.calls.at(-1)[2]).toEqual({ siteId: 'site-a', env: 'test' });
  });

  // ── [P1-2] validate skip 명시화(validation_skipped) ───────────────────

  it('P1-2: spec 미연결 skip → validationSkipped=true(create·view)', async () => {
    const view = await svc.startFinalization(SITE, 'bk_0001'); // spec 미연결 → skip
    expect(finRepo.create.mock.calls[0][0].validationSkipped).toBe(true);
    expect(view.validationSkipped).toBe(true);
  });

  it('P1-2: spec+pageCount validate → validationSkipped=false(검증 수행)', async () => {
    booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: 40 }));
    specRepo.findOne.mockResolvedValue({
      id: 'spec-1', innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3,
      sizeToleranceMm: 1, pageIncrement: 2, bindingType: 'perfect', pageMin: 24, pageMax: 200,
    });
    const view = await svc.startFinalization(SITE, 'bk_0001');
    expect(finRepo.create.mock.calls[0][0].validationSkipped).toBe(false);
    expect(view.validationSkipped).toBe(false);
  });

  it('P1-2: skip 후 완료 웹훅 payload.validationSkipped=true(파트너 인지)', async () => {
    finRepo.findOne.mockResolvedValue({
      id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING',
      composeJobId: 'sjob-1', validationSkipped: true,
    });
    bookRepo.findOne.mockResolvedValue(makeBook());
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, outputFileUrl: '/storage/outputs/x/merged.pdf', result: { totalPages: 12 } };
    await svc.onWorkerJobSettled(job as never);
    const payload = webhookService.sendCallback.mock.calls.at(-1)[1];
    expect(payload.event).toBe('book.finalization.completed');
    expect(payload.validationSkipped).toBe(true);
  });

  // ── [렌즈1 P2-2] 동시 착수 원자화(CAS dup-key → 409) ──────────────────

  it('렌즈1 P2-2: 동시 착수 패자(dup-key) → 409 ERR_FINALIZATION_IN_PROGRESS', async () => {
    // (book_id, attempt) 유니크 충돌을 PENDING INSERT 에서 시뮬레이트.
    finRepo.save.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY', errno: 1062 });
    await expect(svc.startFinalization(SITE, 'bk_0001')).rejects.toMatchObject({
      errorCode: ErrV1.ERR_FINALIZATION_IN_PROGRESS,
      status: 409,
    });
    // 패자는 어떤 잡도 착수하지 않는다(이중 finalization 차단).
    expect(workerJobsService.createSynthesisJob).not.toHaveBeenCalled();
    expect(workerJobsService.createValidationJob).not.toHaveBeenCalled();
  });

  it('렌즈1 P2-2: dup-key 가 아닌 저장 오류는 그대로 전파(오분류 금지)', async () => {
    finRepo.save.mockRejectedValueOnce(new Error('connection reset'));
    await expect(svc.startFinalization(SITE, 'bk_0001')).rejects.toThrow('connection reset');
  });

  // ── [렌즈2 P2-3] 착수 시점 자산 스냅샷(TOCTOU) ────────────────────────

  it('렌즈2 P2-3: 착수 시 plan_snapshot 고정(finRepo.create planSnapshot)', async () => {
    await svc.startFinalization(SITE, 'bk_0001'); // PDF_UPLOAD spec 미연결 → synthesize
    expect(finRepo.create.mock.calls[0][0].planSnapshot).toEqual({
      mode: 'synthesize',
      validateFileId: 'f_pdf_contents',
      coverFileId: 'f_pdf_cover',
      contentFileId: 'f_pdf_contents',
    });
  });

  it('렌즈2 P2-3: validate 콜백은 스냅샷 자산으로 compose(진행 중 자산 교체 무시)', async () => {
    // 진행 중 자산이 교체돼도(assetRepo 가 신자산 반환) compose 는 착수 스냅샷 자산을 써야 한다.
    assetRepo.find.mockResolvedValue([
      { id: 'a0', assetType: 'pdf_cover', fileId: 'MUTATED_cover', status: 'active' },
      { id: 'a1', assetType: 'pdf_contents', fileId: 'MUTATED_contents', status: 'active' },
    ]);
    finRepo.findOne.mockResolvedValue({
      id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1',
      planSnapshot: { mode: 'synthesize', validateFileId: 'f_pdf_contents', coverFileId: 'f_pdf_cover', contentFileId: 'f_pdf_contents' },
    });
    bookRepo.findOne.mockResolvedValue(makeBook());
    const job = { id: 'vjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, result: { totalPages: 40 } };
    await svc.onWorkerJobSettled(job as never);
    const arg = workerJobsService.createSynthesisJob.mock.calls[0][0];
    expect(arg.coverFileId).toBe('f_pdf_cover'); // 스냅샷(구자산) — MUTATED_* 아님
    expect(arg.contentFileId).toBe('f_pdf_contents');
  });

  // ── [렌즈2 P2-4] 콜백 전이 예외 격리(FAILED 전이) ─────────────────────

  it('렌즈2 P2-4: 전이 예외(createSynthesisJob throw) → FAILED+ERR_INTERNAL+웹훅 failed(삼킴)', async () => {
    finRepo.findOne.mockResolvedValue({
      id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1',
      planSnapshot: { mode: 'synthesize', validateFileId: 'f_pdf_contents', coverFileId: 'f_pdf_cover', contentFileId: 'f_pdf_contents' },
    });
    bookRepo.findOne.mockResolvedValue(makeBook());
    workerJobsService.createSynthesisJob.mockRejectedValue(new Error('queue down'));
    const job = { id: 'vjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, result: { totalPages: 40 } };
    // 예외를 삼켜 교착을 막는다(재던짐 금지).
    await expect(svc.onWorkerJobSettled(job as never)).resolves.toBeUndefined();
    const [finWhere, finPatch] = finRepo.update.mock.calls.at(-1);
    expect(finWhere).toEqual({ id: 'fin-1', status: 'VALIDATING' });
    expect(finPatch.status).toBe('FAILED');
    expect(finPatch.errorCode).toBe(ErrV1.ERR_INTERNAL);
    expect(webhookService.sendCallback.mock.calls.at(-1)[1].event).toBe('book.finalization.failed');
  });

  // ── X1 — 확정 합성의 내지 기대 재단(bookSpec 출처) ─────────────────────

  describe('X1 contentTrim — bookSpec 재단·도련·허용오차', () => {
    /** 계약 fixture — apps/worker spec 과 같은 리터럴 */
    const FIXTURE_BOOK_SPEC = JSON.parse(
      '{"trimWidthMm":148,"trimHeightMm":210,"bleedMm":3,"tolMm":0.5,"source":"bookSpec"}',
    ) as unknown;
    const spec148 = {
      id: 'spec-1', innerTrimWidthMm: 148, innerTrimHeightMm: 210, bleedMm: 3,
      sizeToleranceMm: 0.5, pageIncrement: 2, bindingType: 'perfect', pageMin: 24, pageMax: 200,
    };

    it('bookSpec 연결(pageCount 미확정 → 검증 생략) → 합성 인자 contentTrim = 계약 fixture', async () => {
      booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: null }));
      specRepo.findOne.mockResolvedValue(spec148);
      const view = await svc.startFinalization(SITE, 'bk_0001');
      expect(view.status).toBe('COMPOSING');
      const arg = workerJobsService.createSynthesisJob.mock.calls[0][0];
      expect(arg.contentTrim).toEqual(FIXTURE_BOOK_SPEC);
      expect(arg.finalizationId).toBe('fin-1');
    });

    it('validate COMPLETED 콜백 → compose 인자 contentTrim = 계약 fixture', async () => {
      finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1' });
      bookRepo.findOne.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: 40 }));
      specRepo.findOne.mockResolvedValue(spec148);
      const job = { id: 'vjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, result: { totalPages: 40 } };
      await svc.onWorkerJobSettled(job as never);
      const arg = workerJobsService.createSynthesisJob.mock.calls[0][0];
      expect(arg.contentTrim).toEqual(FIXTURE_BOOK_SPEC);
      expect(finRepo.update.mock.calls.at(-1)[1].status).toBe('COMPOSING');
    });

    it('bookSpec 미연결 → 합성 인자에 contentTrim 키 없음, bookSpec 조회 없음', async () => {
      await svc.startFinalization(SITE, 'bk_0001');
      const arg = workerJobsService.createSynthesisJob.mock.calls[0][0];
      expect(arg).not.toHaveProperty('contentTrim');
      expect(specRepo.findOne).not.toHaveBeenCalled();
    });

    it('bookSpec 조회 실패 → contentTrim 없이 COMPOSING', async () => {
      booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: null }));
      specRepo.findOne.mockRejectedValue(new Error('db down'));
      const view = await svc.startFinalization(SITE, 'bk_0001');
      expect(view.status).toBe('COMPOSING');
      expect(workerJobsService.createSynthesisJob.mock.calls[0][0]).not.toHaveProperty('contentTrim');
    });

    it('bookSpec 없음(소실)·도련 범위 밖 → contentTrim 없이 COMPOSING', async () => {
      booksService.findBookForSite.mockResolvedValue(makeBook({ bookSpecId: 'spec-1', pageCount: null }));
      specRepo.findOne.mockResolvedValue(null);
      await svc.startFinalization(SITE, 'bk_0001');
      expect(workerJobsService.createSynthesisJob.mock.calls[0][0]).not.toHaveProperty('contentTrim');

      workerJobsService.createSynthesisJob.mockClear();
      finRepo.findOne.mockResolvedValue(null);
      specRepo.findOne.mockResolvedValue({ ...spec148, bleedMm: 8 });
      await svc.startFinalization(SITE, 'bk_0001');
      expect(workerJobsService.createSynthesisJob.mock.calls[0][0]).not.toHaveProperty('contentTrim');
    });
  });

  // ── 겹치는 보고 — 조건부 상태 전이 ─────────────────────────────────────

  describe('겹치는 보고 — 상태 전이는 읽은 상태일 때만', () => {
    type Rec = Record<string, unknown>;
    type SettledJob = { id: string; status: string; options: Rec; outputFileUrl?: string; result?: Rec };
    const SNAPSHOT = { mode: 'synthesize', validateFileId: 'f_pdf_contents', coverFileId: 'f_pdf_cover', contentFileId: 'f_pdf_contents' };
    const OPTS = { finalizationId: 'fin-1' };
    const vjob = (status: string): SettledJob => ({ id: 'vjob-1', status, options: OPTS, result: { totalPages: 40 } });
    const sjob = (id = 'sjob-1'): SettledJob => ({
      id,
      status: WorkerJobStatus.COMPLETED,
      options: OPTS,
      outputFileUrl: `/storage/outputs/${id}/merged.pdf`,
      result: { totalPages: 42 },
    });
    let finRow: Rec;
    let bookRow: Rec;

    const events = (): string[] =>
      (webhookService.sendCallback.mock.calls as unknown[][]).map((c) => (c[1] as { event: string }).event);
    const matchesWhere = (where: Rec, target: Rec): boolean =>
      Object.entries(where).every(([k, v]) => target[k] === v);

    beforeEach(() => {
      bookRow = makeBook();
      // 호출마다 복사본을 돌려준다 — 겹친 처리가 서로의 메모리 엔티티를 공유하지 않게 한다.
      finRepo.findOne.mockImplementation(async () => ({ ...finRow }));
      finRepo.update.mockImplementation(async (where: Rec, patch: Rec) => {
        if (!matchesWhere(where, finRow)) return { affected: 0 };
        finRow = { ...finRow, ...patch };
        return { affected: 1 };
      });
      bookRepo.findOne.mockImplementation(async () => ({ ...bookRow }));
      bookRepo.update.mockImplementation(async (where: Rec, patch: Rec) => {
        if (!matchesWhere(where, bookRow)) return { affected: 0 };
        bookRow = { ...bookRow, ...patch };
        return { affected: 1 };
      });
    });

    it('검증 완료 보고가 겹치면 합성 단계 전이는 한 번만 일어난다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1', composeJobId: null, planSnapshot: SNAPSHOT };
      const synthA = deferred<{ id: string }>();
      workerJobsService.createSynthesisJob
        .mockImplementationOnce(() => synthA.promise)
        .mockImplementationOnce(async () => ({ id: 'sjob-B' }));

      const a = svc.onWorkerJobSettled(vjob(WorkerJobStatus.COMPLETED) as never);
      await waitUntil(() => workerJobsService.createSynthesisJob.mock.calls.length > 0);
      await svc.onWorkerJobSettled(vjob(WorkerJobStatus.COMPLETED) as never);
      expect(finRow.status).toBe('COMPOSING');
      expect(finRow.composeJobId).toBe('sjob-B');

      synthA.resolve({ id: 'sjob-A' });
      await a;
      expect(finRow.status).toBe('COMPOSING');
      expect(finRow.composeJobId).toBe('sjob-B');
      expect(workerJobsService.createSynthesisJob).toHaveBeenCalledTimes(2);
      expect(finRepo.save).not.toHaveBeenCalled();
      expect(webhookService.sendCallback).not.toHaveBeenCalled();

      // 연결되지 않은 합성 잡의 완료 보고는 아무것도 바꾸지 않는다
      await svc.onWorkerJobSettled(sjob('sjob-A') as never);
      expect(filesService.registerExternalFile).not.toHaveBeenCalled();
      expect(finRow.status).toBe('COMPOSING');
      expect(webhookService.sendCallback).not.toHaveBeenCalled();
    });

    it('검증 완료 보고 처리 중 최종화 상태가 이미 바뀌었으면 합성 잡을 만들지 않는다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', validateJobId: 'vjob-1', composeJobId: 'sjob-B', planSnapshot: SNAPSHOT };
      finRepo.findOne.mockImplementationOnce(async () => ({ ...finRow, status: 'VALIDATING', composeJobId: null }));

      await svc.onWorkerJobSettled(vjob(WorkerJobStatus.COMPLETED) as never);

      expect(finRepo.findOne).toHaveBeenCalledTimes(2);
      expect(workerJobsService.createSynthesisJob).not.toHaveBeenCalled();
      expect(finRepo.update).not.toHaveBeenCalled();
      expect(finRow.composeJobId).toBe('sjob-B');
      expect(webhookService.sendCallback).not.toHaveBeenCalled();
    });

    it('검증 잡의 실패 처리와 늦은 완료 처리가 겹치면 먼저 쓴 전이 하나만 반영된다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'VALIDATING', validateJobId: 'vjob-1', composeJobId: null, planSnapshot: SNAPSHOT };
      const synthLate = deferred<{ id: string }>();
      workerJobsService.createSynthesisJob.mockImplementationOnce(() => synthLate.promise);

      const late = svc.onWorkerJobSettled(vjob(WorkerJobStatus.COMPLETED) as never);
      await waitUntil(() => workerJobsService.createSynthesisJob.mock.calls.length > 0);
      await svc.onWorkerJobSettled(vjob(WorkerJobStatus.FAILED) as never);
      expect(finRow.status).toBe('FAILED');

      synthLate.resolve({ id: 'sjob-late' });
      await late;
      expect(finRow.status).toBe('FAILED');
      expect(finRow.composeJobId).toBeNull();
      expect(events()).toEqual(['book.finalization.failed']);
      expect(bookRepo.update).not.toHaveBeenCalled();
    });

    it('합성 완료 보고가 겹치면 완료 전이·도서 확정·완료 웹훅은 한 번이다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1', outputFileId: null };
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementationOnce(async () => ({ id: 'out-B' }));

      const a = svc.onWorkerJobSettled(sjob() as never);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      await svc.onWorkerJobSettled(sjob() as never);
      expect(finRow.status).toBe('COMPLETED');
      expect(finRow.outputFileId).toBe('out-B');

      regA.resolve({ id: 'out-A' });
      await a;
      expect(finRow.outputFileId).toBe('out-B');
      expect(bookRepo.update).toHaveBeenCalledTimes(1);
      expect(bookRow.status).toBe('FINALIZED');
      expect(events()).toEqual(['book.finalization.completed']);
      expect((webhookService.sendCallback.mock.calls[0][1] as { outputFileId: string }).outputFileId).toBe('out-B');
      expect(filesService.softDelete).toHaveBeenCalledTimes(1);
      expect(filesService.softDelete).toHaveBeenCalledWith('out-A');
      expect(finRepo.save).not.toHaveBeenCalled();
      expect(bookRepo.save).not.toHaveBeenCalled();
    });

    it('사용하지 않는 산출 파일의 삭제 표시가 실패해도 완료 결과와 웹훅은 그대로다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1', outputFileId: null };
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementationOnce(async () => ({ id: 'out-B' }));
      filesService.softDelete.mockRejectedValueOnce(new Error('not found'));

      const a = svc.onWorkerJobSettled(sjob() as never);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      await svc.onWorkerJobSettled(sjob() as never);
      regA.resolve({ id: 'out-A' });
      await expect(a).resolves.toBeUndefined();

      expect(filesService.softDelete).toHaveBeenCalledWith('out-A');
      expect(finRow.status).toBe('COMPLETED');
      expect(finRow.outputFileId).toBe('out-B');
      expect(bookRepo.update).toHaveBeenCalledTimes(1);
      expect(events()).toEqual(['book.finalization.completed']);
    });

    it('완료된 최종화는 늦게 끝난 같은 보고의 처리 오류로 실패로 바뀌지 않는다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1', outputFileId: null };
      const regA = deferred<{ id: string }>();
      filesService.registerExternalFile
        .mockImplementationOnce(() => regA.promise)
        .mockImplementationOnce(async () => ({ id: 'out-B' }));

      const a = svc.onWorkerJobSettled(sjob() as never);
      await waitUntil(() => filesService.registerExternalFile.mock.calls.length > 0);
      await svc.onWorkerJobSettled(sjob() as never);
      regA.reject(new Error('io'));
      await a;

      expect(finRow.status).toBe('COMPLETED');
      expect(finRow.outputFileId).toBe('out-B');
      expect(events()).toEqual(['book.finalization.completed']);
    });

    it('완료 전이 뒤 도서 확정 쓰기가 실패하면 최종화는 실패로 끝난다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1', outputFileId: null };
      bookRepo.update.mockRejectedValueOnce(new Error('db down'));

      await svc.onWorkerJobSettled(sjob() as never);

      expect(finRow.status).toBe('FAILED');
      expect(finRow.errorCode).toBe(ErrV1.ERR_INTERNAL);
      expect(bookRow.status).toBe('DRAFT');
      expect(events()).toEqual(['book.finalization.failed']);
    });

    it('병합본 그대로 완료(passthrough)에서 전이가 생략되면 자산 파일은 그대로 둔다', async () => {
      finRow = { id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPLETED', validateJobId: 'vjob-1', outputFileId: 'f_session_merged' };
      finRepo.findOne.mockImplementationOnce(async () => ({
        ...finRow,
        status: 'VALIDATING',
        outputFileId: null,
        planSnapshot: { mode: 'passthrough', validateFileId: 'f_session_merged', contentFileId: 'f_session_merged' },
      }));

      await svc.onWorkerJobSettled(vjob(WorkerJobStatus.COMPLETED) as never);

      expect(finRepo.update).toHaveBeenCalledTimes(1);
      expect(finRow.status).toBe('COMPLETED');
      expect(webhookService.sendCallback).not.toHaveBeenCalled();
      expect(bookRepo.update).not.toHaveBeenCalled();
      expect(filesService.softDelete).not.toHaveBeenCalled();
    });
  });
});
