/**
 * fix-bleed(2026-07-13) — 도련 자동 삽입 실행기 잠금 (fix-pagecount 동형).
 *
 * 잠그는 계약:
 *  - editSize 는 서버가 templateSet 에서 권위 산출: 판형 297×210 + bleedMm 3 → 303×216
 *    (클라이언트 임의 사이즈 입력 차단 — @Public 남용 방어). 큐 페이로드 convertOptions 는
 *    { editSize, sizeToleranceMm } 만(mode 미지정 → 워커 resolveMode 자체결정, 워커 무수정).
 *  - 잡 레코드에 editSessionId/editSession 절대 미주입 — 세션 workerStatus 상태기계 오염 방지.
 *  - templateSet 미존재·비PDF → 400 BadRequestException(코드 명시).
 *  - 완료훅: CONVERT + options.kind='bleed-fix' + COMPLETED 에서만 결과를 새 File 로 등록
 *    (generatedBy='worker-bleed-fix', 잡 site 승계) + job.outputFileId 기록. 원본 파일 보존
 *    (filesService 에 조회/등록 외 다른 호출 없음). 마커 없는 일반 convert 는 개입 0.
 *
 * 인스턴스 생성 패턴은 worker-jobs.service.compose-mixed.spec.ts 선례를 따른다.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';

describe('WorkerJobsService — fix-bleed(도련 자동 삽입)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let conversionQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock; registerExternalFile: jest.Mock };
  let templateSetsService: { findOne: jest.Mock };

  const templateSet = {
    id: 'ts-1',
    width: 297,
    height: 210,
    bleedMm: 3,
    sizeToleranceMm: 0.2,
  };

  const pdfFile = {
    id: 'file-1',
    filePath: '/app/storage/uploads/inner.pdf',
    mimeType: 'application/pdf',
    siteId: 'site-1',
    orderSeqno: 55,
    memberSeqno: 77,
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-bf', ...x })),
      findOne: jest.fn(),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    conversionQueue = { add: jest.fn(async () => ({})) };
    filesService = {
      findById: jest.fn(async () => ({ ...pdfFile })),
      registerExternalFile: jest.fn(async () => ({ id: 'file-fixed' })),
    };
    templateSetsService = { findOne: jest.fn(async () => ({ ...templateSet })) };

    service = new WorkerJobsService(
      workerJobRepository as any,
      editSessionRepository as any,
      { add: jest.fn() } as any, // validationQueue
      conversionQueue as any,
      { add: jest.fn() } as any, // synthesisQueue
      filesService as any,
      {} as any, // webhookService
      {} as any, // sitesService
      templateSetsService as any,
    );
  });

  describe('createBleedFixJob — editSize 권위 산출 + 잡/큐 계약', () => {
    it('templateSet 297×210 + bleed 3 → editSize 303×216 (콘텐츠 무스케일 중앙 배치용)', async () => {
      await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'ts-1' });

      expect(templateSetsService.findOne).toHaveBeenCalledWith('ts-1');
      const [jobName, payload] = conversionQueue.add.mock.calls[0];
      expect(jobName).toBe('convert-pdf');
      expect(payload.convertOptions).toEqual({
        editSize: { width: 303, height: 216 },
        sizeToleranceMm: 0.2,
      });
      // mode 미지정(워커 resolveMode 자체결정) 잠금
      expect(payload.convertOptions.mode).toBeUndefined();
      expect(payload.fileUrl).toBe(pdfFile.filePath);
    });

    it('잡 레코드: CONVERT + kind=bleed-fix 마커 + 원본 site 승계, editSessionId/editSession 절대 미주입', async () => {
      await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'ts-1' });

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.jobType).toBe(WorkerJobType.CONVERT);
      expect(created.options).toMatchObject({
        kind: 'bleed-fix',
        sourceFileId: 'file-1',
        templateSetId: 'ts-1',
        editSize: { width: 303, height: 216 },
        sizeToleranceMm: 0.2,
      });
      expect(created.siteId).toBe('site-1');
      // 세션 workerStatus 상태기계 오염 방지 — 주입 자체 금지(적발 이력) 잠금
      expect(created).not.toHaveProperty('editSessionId');
      expect(created).not.toHaveProperty('editSession');
    });

    it('bleedMm/sizeToleranceMm 미설정 templateSet → 기본 3mm/0.2mm 폴백 (edit-sessions 규약 동일)', async () => {
      templateSetsService.findOne.mockResolvedValue({
        id: 'ts-2',
        width: 210,
        height: 297,
        bleedMm: null,
        sizeToleranceMm: null,
      });

      await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'ts-2' });

      const payload = conversionQueue.add.mock.calls[0][1];
      expect(payload.convertOptions).toEqual({
        editSize: { width: 216, height: 303 },
        sizeToleranceMm: 0.2,
      });
    });

    it('templateSet 미존재 → 400 TEMPLATE_SET_NOT_FOUND (잡/큐 미발행)', async () => {
      templateSetsService.findOne.mockRejectedValue(
        new NotFoundException('템플릿셋을 찾을 수 없습니다: nope'),
      );

      let err: unknown;
      try {
        await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'nope' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'TEMPLATE_SET_NOT_FOUND',
      });
      expect(workerJobRepository.save).not.toHaveBeenCalled();
      expect(conversionQueue.add).not.toHaveBeenCalled();
    });

    it('P2-4: templateSet 조회의 비-NotFound 예외(DB 단절 등)는 400 으로 뭉개지 않고 rethrow', async () => {
      const infra = new Error('DB connection lost');
      templateSetsService.findOne.mockRejectedValue(infra);

      let err: unknown;
      try {
        await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'ts-1' });
      } catch (e) {
        err = e;
      }
      expect(err).toBe(infra); // 원 예외 그대로 — TEMPLATE_SET_NOT_FOUND(400) 변환 금지
      expect(err).not.toBeInstanceOf(BadRequestException);
      expect(workerJobRepository.save).not.toHaveBeenCalled();
      expect(conversionQueue.add).not.toHaveBeenCalled();
    });

    it('비PDF 파일 → 400 FILE_NOT_PDF (잡/큐 미발행)', async () => {
      filesService.findById.mockResolvedValue({ ...pdfFile, mimeType: 'image/png' });

      let err: unknown;
      try {
        await service.createBleedFixJob({ fileId: 'file-1', templateSetId: 'ts-1' });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        code: 'FILE_NOT_PDF',
      });
      expect(workerJobRepository.save).not.toHaveBeenCalled();
      expect(conversionQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('updateJobStatus 완료훅 — kind=bleed-fix 게이트', () => {
    const bleedFixJob = () => ({
      id: 'job-bf',
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
      editSessionId: null,
      fileId: 'file-1',
      siteId: 'site-1',
      outputFileId: null,
      outputFileUrl: null,
      result: null,
      options: {
        kind: 'bleed-fix',
        sourceFileId: 'file-1',
        templateSetId: 'ts-1',
        editSize: { width: 303, height: 216 },
        sizeToleranceMm: 0.2,
      },
    });

    it('COMPLETED → 결과를 새 File 등록(site 승계·worker-bleed-fix 마킹) + outputFileId 기록 + 원본 보존', async () => {
      const job = bleedFixJob();
      workerJobRepository.findOne.mockResolvedValue(job);
      workerJobRepository.save.mockImplementation(async (x) => x);

      const saved = await service.updateJobStatus('job-bf', {
        status: WorkerJobStatus.COMPLETED,
        outputFileUrl: '/storage/converted/converted_x.pdf',
      });

      expect(filesService.registerExternalFile).toHaveBeenCalledWith(
        '/storage/converted/converted_x.pdf',
        expect.objectContaining({
          orderSeqno: 55,
          memberSeqno: 77,
          siteId: 'site-1',
          metadata: expect.objectContaining({
            generatedBy: 'worker-bleed-fix',
            sourceFileId: 'file-1',
            templateSetId: 'ts-1',
            workerJobId: 'job-bf',
          }),
        }),
      );
      expect(saved.outputFileId).toBe('file-fixed');
      // 원본 보존: filesService 는 조회(findById)+등록(registerExternalFile)만 호출됨
      // (삭제/이동류 메서드는 mock 에 없음 — 호출 시 TypeError 로 이 테스트가 깨진다).
      expect(filesService.findById).toHaveBeenCalledWith('file-1');
      // editSessionId 부재 → 세션 workerStatus 경로 완전 미개입
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
      expect(editSessionRepository.update).not.toHaveBeenCalled();
    });

    it('FAILED → 결과 등록 안 함 (COMPLETED 한정 게이트)', async () => {
      workerJobRepository.findOne.mockResolvedValue(bleedFixJob());
      workerJobRepository.save.mockImplementation(async (x) => x);

      await service.updateJobStatus('job-bf', {
        status: WorkerJobStatus.FAILED,
        errorMessage: 'boom',
      });

      expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    });

    it('kind 마커 없는 일반 convert COMPLETED → 개입 0 (기존 잡 유형 무영향)', async () => {
      workerJobRepository.findOne.mockResolvedValue({
        ...bleedFixJob(),
        options: { addPages: true },
      });
      workerJobRepository.save.mockImplementation(async (x) => x);

      await service.updateJobStatus('job-bf', {
        status: WorkerJobStatus.COMPLETED,
        outputFileUrl: '/storage/converted/other.pdf',
      });

      expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    });

    it('이미 outputFileId 있으면 재등록 안 함 (멱등 — 동일 잡 상태 재배달 방어)', async () => {
      workerJobRepository.findOne.mockResolvedValue({
        ...bleedFixJob(),
        outputFileId: 'file-fixed',
      });
      workerJobRepository.save.mockImplementation(async (x) => x);

      await service.updateJobStatus('job-bf', {
        status: WorkerJobStatus.COMPLETED,
        outputFileUrl: '/storage/converted/converted_x.pdf',
      });

      expect(filesService.registerExternalFile).not.toHaveBeenCalled();
    });
  });
});
