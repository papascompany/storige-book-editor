/**
 * D-4 (2026-07-06, C-4 Track 3) — createComposeMixedJob 큐 기대치 push 유닛테스트.
 *
 * 검증 대상:
 *  - 세션 metadata.spread.outputWidthMm/outputHeightMm(하드커버 싸바리 wrap 포함 출력 사이즈)를
 *    내부 큐 metadata 로 additive push (워커 external DTO 표면 불변 — CONTRACT_FREEZE).
 *  - 기존 P0-3 규칙 회귀 고정: 스프레드 책 outputMode='separate' 강제는
 *    coverEditable !== false 인 경우만(기성커버는 강제 없음), total 기대치 push 는 기존 그대로.
 */
import { WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService.createComposeMixedJob — D-4 spread 기대치 push', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock };
  let synthesisQueue: { add: jest.Mock };

  const baseDto = {
    editSessionId: 'sess-1',
    coverUrl: 'https://example.com/cover.pdf',
    contentPdfUrl: 'https://example.com/content.pdf',
    coverWidthMm: 216,
    coverHeightMm: 303,
    contentWidthMm: 210,
    contentHeightMm: 297,
    outputMode: 'merged',
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'job-d4' })),
    };
    editSessionRepository = { findOne: jest.fn() };
    synthesisQueue = { add: jest.fn(async () => ({})) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      editSessionRepository as any,
      { add: jest.fn() } as any, // validationQueue
      { add: jest.fn() } as any, // conversionQueue
      synthesisQueue as any,
      {} as any, // filesService
      {} as any, // webhookService
      {} as any, // sitesService
    );
  });

  const queuePayload = () => synthesisQueue.add.mock.calls[0][1];

  it('metadata.spread 에 total+output 둘 다 있으면 output 기대치를 additive push + separate 강제(coverEditable 기본)', async () => {
    editSessionRepository.findOne.mockResolvedValue({
      id: 'sess-1',
      metadata: {
        spread: {
          totalWidthMm: 450,
          totalHeightMm: 300,
          dpi: 300,
          // D-4 (Track 1 합의 인터페이스): 출력(wrap 포함) 사이즈
          outputWidthMm: 466,
          outputHeightMm: 316,
        },
      },
    });

    await service.createComposeMixedJob({ ...baseDto });

    const payload = queuePayload();
    // 기존 P0-3 그대로
    expect(payload.composeSpreadTotalWidthMm).toBe(450);
    expect(payload.composeSpreadTotalHeightMm).toBe(300);
    expect(payload.composeSpreadDpi).toBe(300);
    expect(payload.composeOutputMode).toBe('separate'); // merged → separate 강제
    // D-4 additive
    expect(payload.composeSpreadOutputWidthMm).toBe(466);
    expect(payload.composeSpreadOutputHeightMm).toBe(316);
    // DB options 에도 기록
    const created = workerJobRepository.create.mock.calls[0][0];
    expect(created.options.spreadOutputWidthMm).toBe(466);
    expect(created.options.spreadOutputHeightMm).toBe(316);
  });

  it('기성커버(coverEditable=false): separate 강제 없음(기존 :618 규칙 회귀 고정) — 기대치 push 는 유지', async () => {
    editSessionRepository.findOne.mockResolvedValue({
      id: 'sess-1',
      metadata: {
        spread: { totalWidthMm: 450, totalHeightMm: 300, dpi: 300, outputWidthMm: 466, outputHeightMm: 316 },
      },
    });

    await service.createComposeMixedJob({ ...baseDto, coverEditable: false, outputMode: 'content-only' });

    const payload = queuePayload();
    expect(payload.composeOutputMode).toBe('content-only'); // 강제 없음
    expect(payload.composeCoverEditable).toBe(false);
    expect(payload.composeSpreadTotalWidthMm).toBe(450);
    expect(payload.composeSpreadOutputWidthMm).toBe(466);
  });

  it('metadata.spread 부재(비스프레드): 기대치 미push + outputMode 무변경 — 기존 동작 100% 동일', async () => {
    editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

    await service.createComposeMixedJob({ ...baseDto });

    const payload = queuePayload();
    expect(payload.composeOutputMode).toBe('merged');
    expect(payload.composeSpreadTotalWidthMm).toBeUndefined();
    expect(payload.composeSpreadTotalHeightMm).toBeUndefined();
    expect(payload.composeSpreadOutputWidthMm).toBeUndefined();
    expect(payload.composeSpreadOutputHeightMm).toBeUndefined();
  });

  it('output 만 있고 total 부재(배포 순서 엣지): output 은 push 하되 separate 강제는 안 함(total 게이트 유지)', async () => {
    editSessionRepository.findOne.mockResolvedValue({
      id: 'sess-1',
      metadata: { spread: { outputWidthMm: 466, outputHeightMm: 316, dpi: 300 } },
    });

    await service.createComposeMixedJob({ ...baseDto });

    const payload = queuePayload();
    expect(payload.composeSpreadOutputWidthMm).toBe(466);
    expect(payload.composeSpreadOutputHeightMm).toBe(316);
    expect(payload.composeSpreadDpi).toBe(300);
    expect(payload.composeSpreadTotalWidthMm).toBeUndefined();
    expect(payload.composeOutputMode).toBe('merged'); // 강제 없음 (기존 게이트 불변)
  });

  it('output 이 비수치/한쪽만이면 무시(기존 페이로드와 동일)', async () => {
    editSessionRepository.findOne.mockResolvedValue({
      id: 'sess-1',
      metadata: { spread: { totalWidthMm: 450, totalHeightMm: 300, outputWidthMm: '466' } },
    });

    await service.createComposeMixedJob({ ...baseDto });

    const payload = queuePayload();
    expect(payload.composeSpreadOutputWidthMm).toBeUndefined();
    expect(payload.composeSpreadOutputHeightMm).toBeUndefined();
    expect(payload.composeSpreadTotalWidthMm).toBe(450);
    expect(payload.composeOutputMode).toBe('separate');
  });

  it('세션 조회 실패 시 잡 생성 무중단(best-effort) — 기대치/강제 미적용', async () => {
    editSessionRepository.findOne.mockRejectedValue(new Error('db down'));

    const job = await service.createComposeMixedJob({ ...baseDto });

    expect(job.id).toBe('job-d4');
    const payload = queuePayload();
    expect(payload.composeOutputMode).toBe('merged');
    expect(payload.composeSpreadOutputWidthMm).toBeUndefined();
  });
});
