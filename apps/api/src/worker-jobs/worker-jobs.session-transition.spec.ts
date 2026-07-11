/**
 * C+ G2 (2026-07-11) — updateEditSessionWorkerStatus 세션 전이 배선 잠금.
 *
 * 술어(worker-jobs.fixable-equivalent.spec.ts)가 아니라 **실제 분기 배선**을 잠근다:
 *  - VALIDATE FAILED + 전에러 fixMethod(=게이팅 전 FIXABLE 급) → VALIDATED 전이
 *    + session.validated 웹훅 + update 는 workerStatus 단일 컬럼(workerError 미포함)
 *  - VALIDATE FAILED + fixMethod 없는 에러(FILE_CORRUPTED) → FAILED + workerError
 *    + session.failed 웹훅 (기존 동작 회귀 잠금)
 *  - 비검증 잡(RENDER_PAGES 등)의 FAILED 는 result 형태와 무관하게 동등 처리 금지
 *    (jobType 게이트 — '검증 경로 한정' 구조 강제)
 *
 * 회귀 표적: 술어가 fixMethod 존재 기반으로 processor 쪽과 어긋나거나, else-if 순서/
 * update 컬럼 스프레드 조건(newWorkerStatus 기준)이 바뀌면 이 스펙이 깨진다.
 * 인스턴스 생성 패턴은 worker-jobs.service.compose-mixed.spec.ts 선례를 따른다.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerStatus } from '../edit-sessions/entities/edit-session.entity';

describe('WorkerJobsService.updateEditSessionWorkerStatus — C+ G2 세션 전이', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { find: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let webhookService: { sendCallback: jest.Mock };

  const session = {
    id: 'sess-1',
    orderSeqno: 777,
    callbackUrl: 'https://partner.example.com/webhook',
    workerStatus: null,
    workerError: null,
  };

  const makeJob = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    jobType: WorkerJobType.VALIDATE,
    editSessionId: 'sess-1',
    options: { fileType: 'content' },
    result: null,
    ...overrides,
  });

  const gatedFailedDto = {
    status: WorkerJobStatus.FAILED,
    errorMessage: '페이지 크기가 맞지 않습니다.',
    result: {
      result: {
        isValid: false,
        errors: [
          {
            code: 'SIZE_MISMATCH',
            message: '페이지 크기가 맞지 않습니다.',
            details: {},
            autoFixable: false,
            fixMethod: 'resizeWithPadding',
          },
        ],
        warnings: [],
        metadata: {},
      },
    },
  };

  const corruptedFailedDto = {
    status: WorkerJobStatus.FAILED,
    errorMessage: '파일이 손상되었습니다.',
    result: {
      result: {
        isValid: false,
        errors: [
          {
            code: 'FILE_CORRUPTED',
            message: '파일이 손상되었습니다.',
            details: {},
            autoFixable: false,
          },
        ],
        warnings: [],
        metadata: {},
      },
    },
  };

  const callPrivate = (job: unknown, dto: unknown): Promise<void> =>
    (
      service as unknown as {
        updateEditSessionWorkerStatus(j: unknown, d: unknown): Promise<void>;
      }
    ).updateEditSessionWorkerStatus(job, dto);

  beforeEach(() => {
    workerJobRepository = {
      // areAllSessionJobsCompleted: 세션 잡 = 대상 잡 1건(종결) → 전체 종결.
      find: jest.fn(async () => [
        { jobType: WorkerJobType.VALIDATE, status: WorkerJobStatus.FAILED, options: {} },
      ]),
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ ...session })),
      update: jest.fn(async () => ({})),
    };
    webhookService = { sendCallback: jest.fn(async () => true) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      editSessionRepository as any,
      { add: jest.fn() } as any, // validationQueue
      { add: jest.fn() } as any, // conversionQueue
      { add: jest.fn() } as any, // synthesisQueue
      {} as any, // filesService
      webhookService as any,
      {} as any, // sitesService
    );
  });

  it('VALIDATE FAILED + 전에러 fixMethod → VALIDATED 전이 + session.validated 웹훅 + workerError 미기록', async () => {
    await callPrivate(makeJob(), gatedFailedDto);

    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', {
      workerStatus: WorkerStatus.VALIDATED,
      // workerError 컬럼 미포함(단일 컬럼 갱신 — 종전 FIXABLE 경로와 SQL 동일) 잠금:
    });
    const payload = webhookService.sendCallback.mock.calls[0][1];
    expect(payload.event).toBe('session.validated');
    expect(payload.status).toBe('validated');
  });

  it('VALIDATE FAILED + FILE_CORRUPTED(fixMethod 없음) → FAILED + workerError + session.failed (기존 잠금)', async () => {
    await callPrivate(makeJob(), corruptedFailedDto);

    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', {
      workerStatus: WorkerStatus.FAILED,
      workerError: '파일이 손상되었습니다.',
    });
    const payload = webhookService.sendCallback.mock.calls[0][1];
    expect(payload.event).toBe('session.failed');
    expect(payload.status).toBe('failed');
  });

  it('VALIDATE FIXABLE → VALIDATED (게이팅 OFF 기존 경로 회귀 잠금, workerError 미기록)', async () => {
    await callPrivate(makeJob(), {
      status: WorkerJobStatus.FIXABLE,
      result: { result: { isValid: false, errors: [], warnings: [], metadata: {} } },
    });

    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', {
      workerStatus: WorkerStatus.VALIDATED,
    });
    expect(webhookService.sendCallback.mock.calls[0][1].event).toBe('session.validated');
  });

  it('비검증 잡(RENDER_PAGES) FAILED 는 errors 전원 fixMethod 형태라도 동등 처리 금지 → FAILED (jobType 게이트)', async () => {
    await callPrivate(
      makeJob({ jobType: WorkerJobType.RENDER_PAGES }),
      gatedFailedDto,
    );

    expect(editSessionRepository.update).toHaveBeenCalledWith('sess-1', {
      workerStatus: WorkerStatus.FAILED,
      workerError: '페이지 크기가 맞지 않습니다.',
    });
    expect(webhookService.sendCallback.mock.calls[0][1].event).toBe('session.failed');
  });
});
