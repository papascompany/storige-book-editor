/**
 * createSheetMapJob (P2-c, 2026-10-18 — ProductProfile output.mode='sheet-map').
 *
 * 잠그는 계약:
 *  1. 멱등 lookup(session_id, pdf_file_id, request_id) 히트면 기존 잡 반환·저장·큐 없음(duplex-split 과 동일).
 *  2. 파일 검증(PDF_NOT_FROM_EDITOR·SESSION_FILE_MISMATCH)·EMPTY_SESSION_PAGES 는 duplex-split 과 같은 코드.
 *  3. 홀수 검사 없음 — 대신 sheets 가 세션 페이지 수를 정확히 1회씩 덮지 않으면 SheetMapError(PAGE_COUNT_MISMATCH).
 *  4. DB options { mode:'sheet-map', totalExpectedPages, sheets, output, duplexFlip, callbackUrl, revision? } 와
 *     Bull payload(SheetMapSynthesisJobData) + SYNTHESIS_QUEUE_RETRY_OPTS 스냅샷.
 *
 * 인스턴스 생성 패턴은 worker-jobs.duplex-split-page-count.spec.ts 선례.
 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { SheetSpec } from '@storige/types';
import { SheetMapError } from '../edit-sessions/sheet-map';
import { SYNTHESIS_QUEUE_RETRY_OPTS, WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService.createSheetMapJob', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let findById: jest.Mock;

  const requestId = 'sheet-map-r2';
  const sheets3: SheetSpec[] = [
    { index: 0, front: { page: 0 }, back: null },
    { index: 1, front: { page: 1 }, back: { page: 2, rotate: 180 } },
  ];

  const editorPdf = (id: string) => ({
    id,
    filePath: `/app/storage/uploads/${id}.pdf`,
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  });

  const useSession = (session: Record<string, unknown>) => {
    editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', ...session });
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-1', ...x })),
      findOne: jest.fn(async () => null),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    findById = jest.fn(async (id: string) => editorPdf(id));

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      synthesisQueue as never,
      { findById } as never, // filesService
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
    );
    useSession({ metadata: { pages: 3 }, canvasData: { objects: [] } });
  });

  const call = (o: Record<string, unknown> = {}) =>
    service.createSheetMapJob({
      sessionId: 'sess-1',
      pdfFileId: 'file-1',
      sheets: sheets3,
      output: 'per-sheet',
      duplexFlip: 'short-edge',
      requestId,
      ...o,
    });

  it('정상(3쪽, 홀수 허용) — DB options·Bull payload·재시도 옵션 스냅샷', async () => {
    const job = await call({ callbackUrl: 'https://partner.example.com/cb', siteId: 'site-a', revision: 2 });

    expect(workerJobRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: 'SYNTHESIZE',
        status: 'PENDING',
        editSessionId: 'sess-1',
        sessionId: 'sess-1',
        pdfFileId: 'file-1',
        requestId,
        siteId: 'site-a',
      }),
    );
    expect(job.options).toEqual({
      mode: 'sheet-map',
      totalExpectedPages: 3,
      sheets: sheets3,
      output: 'per-sheet',
      duplexFlip: 'short-edge',
      callbackUrl: 'https://partner.example.com/cb',
      revision: 2,
    });
    expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = synthesisQueue.add.mock.calls[0];
    expect(name).toBe('synthesize-pdf');
    expect(payload).toEqual({
      jobId: 'job-1',
      mode: 'sheet-map',
      sessionId: 'sess-1',
      pdfFileId: 'file-1',
      totalExpectedPages: 3,
      sheets: sheets3,
      output: 'per-sheet',
      duplexFlip: 'short-edge',
      callbackUrl: 'https://partner.example.com/cb',
    });
    expect(opts).toEqual({ priority: 5, ...SYNTHESIS_QUEUE_RETRY_OPTS });
  });

  it('revision·siteId 미전달 — options 에 revision 키 없음, siteId null(duplex-split 과 같은 규칙); merged-duplex 전달', async () => {
    const job = await call({ output: 'merged-duplex', duplexFlip: 'long-edge' });
    expect(job.options).not.toHaveProperty('revision');
    expect(job.siteId).toBeNull();
    expect(job.options).toMatchObject({ output: 'merged-duplex', duplexFlip: 'long-edge' });
    expect(synthesisQueue.add.mock.calls[0][1]).toMatchObject({ output: 'merged-duplex', duplexFlip: 'long-edge' });
  });

  it('priority high/low → 1/10', async () => {
    await call({ priority: 'high' });
    await call({ priority: 'low' });
    expect(synthesisQueue.add.mock.calls[0][2]).toMatchObject({ priority: 1 });
    expect(synthesisQueue.add.mock.calls[1][2]).toMatchObject({ priority: 10 });
  });

  it('멱등 히트 — 기존 잡 반환, 세션·파일 조회·저장·큐 없음', async () => {
    workerJobRepository.findOne.mockResolvedValueOnce({ id: 'job-existing', requestId });
    const job = await call();
    expect(job.id).toBe('job-existing');
    expect(workerJobRepository.findOne).toHaveBeenCalledWith({
      where: { sessionId: 'sess-1', pdfFileId: 'file-1', requestId },
    });
    expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
    expect(workerJobRepository.save).not.toHaveBeenCalled();
    expect(synthesisQueue.add).not.toHaveBeenCalled();
  });

  it('sheets 가 페이지 수를 덮지 못하면 SheetMapError(PAGE_COUNT_MISMATCH) — 저장·큐 없음', async () => {
    useSession({ metadata: { pages: 4 }, canvasData: { objects: [] } });
    const p = call();
    await expect(p).rejects.toBeInstanceOf(SheetMapError);
    await expect(p).rejects.toMatchObject({ code: 'PAGE_COUNT_MISMATCH' });
    expect(workerJobRepository.save).not.toHaveBeenCalled();
    expect(synthesisQueue.add).not.toHaveBeenCalled();
  });

  it('근거 없음(metadata·canvasData 없음) → EMPTY_SESSION_PAGES', async () => {
    useSession({ metadata: null, canvasData: null });
    const p = call();
    await expect(p).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(p).rejects.toMatchObject({ response: { code: 'EMPTY_SESSION_PAGES' } });
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  });

  it('편집기 산출 아님 / 세션 불일치 → PDF_NOT_FROM_EDITOR / SESSION_FILE_MISMATCH', async () => {
    findById.mockResolvedValueOnce({ id: 'file-1', metadata: { generatedBy: 'upload', editSessionId: 'sess-1' } });
    await expect(call()).rejects.toMatchObject({ response: { code: 'PDF_NOT_FROM_EDITOR' } });
    findById.mockResolvedValueOnce({ id: 'file-1', metadata: { generatedBy: 'editor', editSessionId: 'sess-other' } });
    const p = call();
    await expect(p).rejects.toBeInstanceOf(BadRequestException);
    await expect(p).rejects.toMatchObject({ response: { code: 'SESSION_FILE_MISMATCH' } });
    expect(workerJobRepository.save).not.toHaveBeenCalled();
  });

  it('세션 없음 → SESSION_NOT_FOUND', async () => {
    editSessionRepository.findOne.mockResolvedValue(null);
    await expect(call()).rejects.toMatchObject({ response: { code: 'SESSION_NOT_FOUND' } });
  });

  it('저장 unique 위반(race) → 기존 잡 반환, 큐 없음', async () => {
    workerJobRepository.save.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY', errno: 1062 });
    workerJobRepository.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'job-race', requestId });
    const job = await call();
    expect(job.id).toBe('job-race');
    expect(synthesisQueue.add).not.toHaveBeenCalled();
  });
});
