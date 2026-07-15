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
    bookRepo = { findOne: jest.fn(), save: jest.fn(async (b: AnyRec) => b) };
    assetRepo = { find: jest.fn(async () => activeAssets(['pdf_cover', 'pdf_contents'])) };
    finRepo = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x: AnyRec) => ({ ...x })),
      save: jest.fn(async (x: AnyRec) => ({ id: x.id ?? 'fin-1', createdAt: new Date('2026-01-01T00:00:00Z'), ...x })),
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
    const saved = finRepo.save.mock.calls.at(-1)[0];
    expect(saved.status).toBe('COMPOSING');
    expect(saved.composeJobId).toBe('sjob-1');
  });

  it('⑧ 콜백: compose COMPLETED → registerExternalFile→COMPLETED+book FINALIZED+웹훅 completed', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', uid: 'fin_1', bookId: 'book-1', attempt: 1, status: 'COMPOSING', composeJobId: 'sjob-1' });
    const book = makeBook();
    bookRepo.findOne.mockResolvedValue(book);
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' }, outputFileUrl: '/storage/outputs/sjob-1/merged.pdf', result: { totalPages: 42 } };
    await svc.onWorkerJobSettled(job as never);
    expect(filesService.registerExternalFile).toHaveBeenCalledTimes(1);
    const finSaved = finRepo.save.mock.calls.at(-1)[0];
    expect(finSaved.status).toBe('COMPLETED');
    expect(finSaved.outputFileId).toBe('out-file-1');
    expect(finSaved.pageCount).toBe(42);
    const bookSaved = bookRepo.save.mock.calls.at(-1)[0];
    expect(bookSaved.status).toBe('FINALIZED');
    expect(bookSaved.pageCount).toBe(42);
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
    const finSaved = finRepo.save.mock.calls.at(-1)[0];
    expect(finSaved.status).toBe('FAILED');
    expect(finSaved.errorCode).toBe(ErrV1.ERR_PDF_VALIDATION_FAILED);
    expect(bookRepo.save).not.toHaveBeenCalled(); // book DRAFT 유지
    expect(webhookService.sendCallback.mock.calls.at(-1)[1].event).toBe('book.finalization.failed');
  });

  it('⑩ 멱등: 이미 COMPLETED 인 finalization 콜백 재유입 → no-op', async () => {
    finRepo.findOne.mockResolvedValue({ id: 'fin-1', status: 'COMPLETED', bookId: 'book-1' });
    const job = { id: 'sjob-1', status: WorkerJobStatus.COMPLETED, options: { finalizationId: 'fin-1' } };
    await svc.onWorkerJobSettled(job as never);
    expect(bookRepo.save).not.toHaveBeenCalled();
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
    const finSaved = finRepo.save.mock.calls.at(-1)[0];
    expect(finSaved.status).toBe('FAILED');
    expect(finSaved.errorCode).toBe(ErrV1.ERR_INTERNAL);
    expect(webhookService.sendCallback.mock.calls.at(-1)[1].event).toBe('book.finalization.failed');
  });
});
