/**
 * R-44 — createValidationJob 서버 spine 재계산 주입 + Bull 머지본 탑재 (2026-07-21)
 *
 * 잠그는 계약:
 *  1. cover + perfect/hardcover + paperType/pages 보유 → 서버가 spine 재계산해
 *     orderOptions.spineWidthMm 을 **덮어씀**(fail-closed). 클라 원본은
 *     clientSpineWidthMm 보존, spineSource='server' 스탬프.
 *  2. Bull 페이로드는 raw DTO 가 아니라 **머지·주입본** — 종전엔 DB job.options 에만
 *     남고 워커에는 raw 가 가서 silent 미적용(백로그 "site-default 머지 미적용" 실확정).
 *  3. SOFT 정책: content 파일 / v1 폴백 / 지종 미해석(예외) / SpineService 미주입 —
 *     전부 클라 값 유지(현행 동작 그대로, spineSource 미스탬프).
 *
 * 인스턴스 생성 패턴은 external-site-stamp/bleed-fix spec 선례(positional mock).
 */
import { WorkerJobsService } from './worker-jobs.service';

describe('WorkerJobsService — R-44 spine 서버 재계산 주입(createValidationJob)', () => {
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let validationQueue: { add: jest.Mock };
  let spineService: { calculate: jest.Mock };

  const makeService = (withSpine = true) =>
    new WorkerJobsService(
      workerJobRepository as any,
      {} as any, // editSessionRepository
      validationQueue as any,
      { add: jest.fn() } as any, // conversionQueue
      { add: jest.fn() } as any, // synthesisQueue
      {} as any, // filesService (fileUrl 경로만 사용 — findById 미호출)
      {} as any, // webhookService
      {} as any, // sitesService (siteId 미전달 — merge 는 copy 만)
      {} as any, // templateSetsService
      undefined, // bookFinalizationsService (@Optional)
      withSpine ? (spineService as any) : undefined, // spineService (@Optional)
    );

  const coverDto = (orderOptions: Record<string, any>) => ({
    fileUrl: 'storage/uploads/cover.pdf',
    fileType: 'cover' as const,
    orderOptions: {
      size: { width: 210, height: 297 },
      pages: 200,
      binding: 'perfect' as const,
      bleed: 3,
      ...orderOptions,
    },
  });

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-validate', ...x })),
      findOne: jest.fn(async () => null),
    };
    validationQueue = { add: jest.fn(async () => ({})) };
    spineService = {
      calculate: jest.fn(async () => ({
        spineWidth: 9.6,
        formulaVersion: 'v2',
        paperThickness: 0.048,
        bindingMargin: 0,
        warnings: [],
        formula: '',
      })),
    };
  });

  it('cover+perfect: 서버 v2 재계산이 클라 spineWidthMm 을 덮어쓰고 원본 보존', async () => {
    await makeService().createValidationJob(
      coverDto({ paperType: '미색모조80', spineWidthMm: 12.3 }) as any,
    );

    expect(spineService.calculate).toHaveBeenCalledWith({
      pageCount: 200,
      paperType: '미색모조80',
      bindingType: 'perfect',
    });
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions).toMatchObject({
      spineWidthMm: 9.6,
      clientSpineWidthMm: 12.3,
      spineSource: 'server',
    });
    // DB job.options 에도 동일 주입본
    const created = workerJobRepository.create.mock.calls[0][0];
    expect(created.options.orderOptions).toMatchObject({
      spineWidthMm: 9.6,
      spineSource: 'server',
    });
  });

  it('Bull 페이로드 = 머지·주입본(raw DTO 금지) — DB options 와 동일 객체 내용', async () => {
    await makeService().createValidationJob(
      coverDto({ paperType: '미색모조80', spineWidthMm: 12.3 }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    const created = workerJobRepository.create.mock.calls[0][0];
    expect(payload.orderOptions).toEqual(created.options.orderOptions);
  });

  it('content 파일 → 주입 없음(클라 값 유지, calculate 미호출)', async () => {
    await makeService().createValidationJob({
      ...coverDto({ paperType: '미색모조80', spineWidthMm: 12.3 }),
      fileType: 'content',
    } as any);

    expect(spineService.calculate).not.toHaveBeenCalled();
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineWidthMm).toBe(12.3);
    expect(payload.orderOptions.spineSource).toBeUndefined();
  });

  it('v1 폴백(legacy 지종) → 클라 값 유지(골든과 다른 v1 값으로 덮지 않음)', async () => {
    spineService.calculate.mockResolvedValueOnce({
      spineWidth: 10.5,
      formulaVersion: 'v1',
      paperThickness: 0.1,
      bindingMargin: 0.5,
      warnings: [],
      formula: '',
    });
    await makeService().createValidationJob(
      coverDto({ paperType: 'mojo_80g', spineWidthMm: 9.6 }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineWidthMm).toBe(9.6);
    expect(payload.orderOptions.spineSource).toBeUndefined();
  });

  it('지종 미해석(404 예외) → SOFT: 클라 값 유지 + 잡은 정상 생성', async () => {
    spineService.calculate.mockRejectedValueOnce(new Error("종이 타입 '이라이트80' 없음"));
    await makeService().createValidationJob(
      coverDto({ paperType: '이라이트80', spineWidthMm: 9.6 }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineWidthMm).toBe(9.6);
    expect(workerJobRepository.save).toHaveBeenCalled();
  });

  it('paperType 미전달(레거시 호출) → 주입 시도 없음(완전 무변화)', async () => {
    await makeService().createValidationJob(coverDto({ spineWidthMm: 9.6 }) as any);
    expect(spineService.calculate).not.toHaveBeenCalled();
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineWidthMm).toBe(9.6);
  });

  it('SpineService 미주입(@Optional) → no-op(기존 9~10인자 스펙 하위호환)', async () => {
    await makeService(false).createValidationJob(
      coverDto({ paperType: '미색모조80', spineWidthMm: 9.6 }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineWidthMm).toBe(9.6);
  });

  it('hardcover 도 주입 대상(binding 게이트)', async () => {
    spineService.calculate.mockResolvedValueOnce({
      spineWidth: 14,
      formulaVersion: 'v2',
      paperThickness: 0.095,
      bindingMargin: 4,
      warnings: [],
      formula: '',
      pageThickMm: 10,
    });
    await makeService().createValidationJob(
      coverDto({ paperType: '미색모조80', binding: 'hardcover', spineWidthMm: 8 }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions).toMatchObject({ spineWidthMm: 14, spineSource: 'server' });
  });

  it('saddle 은 주입 비대상(spine 개념 없음)', async () => {
    await makeService().createValidationJob(
      coverDto({ paperType: '미색모조80', binding: 'saddle' }) as any,
    );
    expect(spineService.calculate).not.toHaveBeenCalled();
  });

  it('F2 위조 스탬프 선소독: 스킵 경로(saddle)에서도 클라 spineSource/clientSpineWidthMm 소거', async () => {
    await makeService().createValidationJob(
      coverDto({
        binding: 'saddle',
        spineWidthMm: 9.6,
        spineSource: 'server', // 위조 — @IsObject 단독이라 전송 가능
        clientSpineWidthMm: 99,
      }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineSource).toBeUndefined();
    expect(payload.orderOptions.clientSpineWidthMm).toBeUndefined();
    expect(payload.orderOptions.spineWidthMm).toBe(9.6); // 값 자체는 보존(현행 신뢰 수준)
  });

  it('F2 위조 스탬프 선소독: v1 폴백 경로에서도 잔존 금지 — server 스탬프는 성공 경로 전유', async () => {
    spineService.calculate.mockResolvedValueOnce({
      spineWidth: 10.5, formulaVersion: 'v1', paperThickness: 0.1,
      bindingMargin: 0.5, warnings: [], formula: '',
    });
    await makeService().createValidationJob(
      coverDto({ paperType: 'mojo_80g', spineWidthMm: 9.6, spineSource: 'server' }) as any,
    );
    const [, payload] = validationQueue.add.mock.calls[0];
    expect(payload.orderOptions.spineSource).toBeUndefined();
  });
});
