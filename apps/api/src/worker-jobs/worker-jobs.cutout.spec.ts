/**
 * S-P2A-B 샤드2 (2026-08-05) — 컷아웃 잡 생성/조회의 **보안 계약** 잠금.
 *
 * 이 스펙이 지키는 것은 1차 적대 리뷰의 blocker 를 닫은 코드 자체다. 무테스트로 두면
 * 리팩터 한 번에 조용히 되돌아간다:
 *  1. 테넌트 대조(confused deputy) — @Public 라우트에서 남의 파일로 파생물을 만들 수 없다.
 *  2. 조회 격리 — **토큰을 빼면 더 많이 보이는** 역전이 없어야 한다.
 *  3. 모델 화이트리스트 — `_custom` 세션(CVE-2026-40086 경로 순회 벡터) 거부.
 *  4. 멱등 재사용 — 같은 입력의 중복 추론을 막되, 산출물이 사라진 잡은 재사용하지 않는다.
 *  5. 미완 업로드(status!=='ready') 로 잡을 만들지 않는다.
 *
 * 인스턴스 생성 패턴은 worker-jobs.bleed-fix.spec.ts 선례를 따른다
 * (cutoutQueue 는 생성자 최후미 @Optional 인자).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType, CUTOUT_JOB_NAME } from '@storige/types';

describe('WorkerJobsService — 컷아웃(배경제거) 보안 계약', () => {
  const storageBase = '/tmp/storige-cutout-spec-storage';

  let service: WorkerJobsService;
  let workerJobRepository: {
    create: jest.Mock;
    save: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let cutoutQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let savedEnv: string | undefined;

  /** 기본 입력 파일 — site 스탬프된 파트너 소유 이미지 */
  const siteFile = {
    id: 'file-A',
    filePath: '/app/storage/uploads/a.png',
    mimeType: 'image/png',
    siteId: 'site-A',
    status: 'ready',
    storageBackend: 'local',
  };

  /** 게스트 업로드 — site 미스탬프 */
  const guestFile = { ...siteFile, id: 'file-G', siteId: null };

  const build = () =>
    new WorkerJobsService(
      workerJobRepository as never,
      { findOne: jest.fn(), update: jest.fn() } as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      { add: jest.fn() } as never, // synthesisQueue
      filesService as never,
      {} as never, // webhookService
      {} as never, // sitesService
      {} as never, // templateSetsService
      undefined, // bookFinalizationsService (@Optional)
      undefined, // spineService (@Optional)
      cutoutQueue as never, // cutoutQueue — 반드시 최후미(@Optional)
    );

  beforeEach(async () => {
    savedEnv = process.env.STORAGE_PATH;
    process.env.STORAGE_PATH = storageBase;
    await fs.rm(storageBase, { recursive: true, force: true });

    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-cut', ...x })),
      findOne: jest.fn(),
      find: jest.fn(async () => []), // 기본: 재사용 후보 없음
    };
    cutoutQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn(async () => ({ ...siteFile })) };
    service = build();
  });

  afterEach(async () => {
    if (savedEnv === undefined) delete process.env.STORAGE_PATH;
    else process.env.STORAGE_PATH = savedEnv;
    await fs.rm(storageBase, { recursive: true, force: true }).catch(() => {});
  });

  // ── 1. 테넌트 대조 (confused deputy 차단) ────────────────────────────────
  describe('createCutoutJob — 입력 파일 테넌트 대조', () => {
    it('익명 호출자는 site 스탬프된 파일로 잡을 만들 수 없다(404)', async () => {
      await expect(service.createCutoutJob({ fileId: 'file-A' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(cutoutQueue.add).not.toHaveBeenCalled();
    });

    it('다른 site 의 검증된 세션도 막힌다(404)', async () => {
      await expect(
        service.createCutoutJob({ fileId: 'file-A' }, { siteId: 'site-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cutoutQueue.add).not.toHaveBeenCalled();
    });

    it('같은 site 의 검증된 세션은 통과한다', async () => {
      const job = await service.createCutoutJob({ fileId: 'file-A' }, { siteId: 'site-A' });

      expect(job.siteId).toBe('site-A'); // 잡 siteId 는 body 가 아니라 파일에서 승계
      expect(cutoutQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, payload] = cutoutQueue.add.mock.calls[0];
      expect(jobName).toBe(CUTOUT_JOB_NAME);
      expect(payload).toMatchObject({ fileUrl: siteFile.filePath, maxLongEdge: 2560 });
    });

    it('게스트 업로드(site 미스탬프)는 익명도 허용 — 무인증 경로의 유일한 허용면', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });

      const job = await service.createCutoutJob({ fileId: 'file-G' });

      expect(job.siteId).toBeNull();
      expect(cutoutQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  // ── 2. 입력 검증 ────────────────────────────────────────────────────────
  describe('createCutoutJob — 입력 검증', () => {
    it('비이미지 MIME 은 400', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile, mimeType: 'application/pdf' });

      await expect(service.createCutoutJob({ fileId: 'file-G' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it("업로드 미완(status!=='ready') 파일은 404 — 실패 잡 양산 차단", async () => {
      filesService.findById.mockResolvedValue({ ...guestFile, status: 'pending' });

      await expect(service.createCutoutJob({ fileId: 'file-G' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(cutoutQueue.add).not.toHaveBeenCalled();
    });

    it('`_custom` 모델은 거부한다 — CVE-2026-40086 경로 순회 벡터', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });

      for (const model of ['u2net_custom', 'BEN_CUSTOM', 'dis_custom']) {
        await expect(
          service.createCutoutJob({ fileId: 'file-G', model }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(cutoutQueue.add).not.toHaveBeenCalled();
    });

    it('화이트리스트 밖 모델도 거부한다', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });

      await expect(
        service.createCutoutJob({ fileId: 'file-G', model: 'bria-rmbg' }), // 비상업 라이선스
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ── 3. 멱등 재사용 ──────────────────────────────────────────────────────
  describe('createCutoutJob — 멱등 재사용', () => {
    const seedOutput = async (jobId: string): Promise<string> => {
      const dir = path.join(storageBase, 'cutouts', jobId);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'out.png'), 'dummy');
      return `/storage/cutouts/${jobId}/out.png`;
    };

    const completedJob = (cutoutUrl: string, options: Record<string, unknown> = {}) => ({
      id: 'job-prev',
      jobType: WorkerJobType.CUTOUT,
      status: WorkerJobStatus.COMPLETED,
      options: { kind: 'cutout', ...options },
      result: { cutoutUrl },
      createdAt: new Date(),
    });

    it('같은 (fileId, model) 의 최근 성공 잡이 있으면 재추론하지 않는다', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });
      const url = await seedOutput('job-prev');
      workerJobRepository.find.mockResolvedValue([completedJob(url)]);

      const job = await service.createCutoutJob({ fileId: 'file-G' });

      expect(job.id).toBe('job-prev');
      expect(cutoutQueue.add).not.toHaveBeenCalled();
      expect(workerJobRepository.save).not.toHaveBeenCalled();
    });

    it('산출물이 이미 지워졌으면 재사용하지 않고 새로 만든다(자가 복구)', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });
      // 파일을 만들지 않는다 = 보존 cron 이 지웠거나 운영자가 수동 삭제한 상태
      workerJobRepository.find.mockResolvedValue([
        completedJob('/storage/cutouts/job-prev/out.png'),
      ]);

      await service.createCutoutJob({ fileId: 'file-G' });

      expect(cutoutQueue.add).toHaveBeenCalledTimes(1);
    });

    it('보존 cron 이 purge 마커를 남긴 잡은 재사용하지 않는다', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });
      const url = await seedOutput('job-prev');
      workerJobRepository.find.mockResolvedValue([
        completedJob(url, { cutoutOutputsPurgedAt: new Date().toISOString() }),
      ]);

      await service.createCutoutJob({ fileId: 'file-G' });

      expect(cutoutQueue.add).toHaveBeenCalledTimes(1);
    });

    it('모델이 다르면 재사용하지 않는다', async () => {
      filesService.findById.mockResolvedValue({ ...guestFile });
      const url = await seedOutput('job-prev');
      workerJobRepository.find.mockResolvedValue([completedJob(url, { model: 'u2net' })]);

      await service.createCutoutJob({ fileId: 'file-G', model: 'birefnet-general' });

      expect(cutoutQueue.add).toHaveBeenCalledTimes(1);
    });
  });

  // ── 4. 조회 격리 (토큰을 빼면 더 보이는 역전이 없어야 한다) ──────────────
  describe('findCutoutJob — 조회 격리', () => {
    const siteJob = {
      id: 'job-1',
      jobType: WorkerJobType.CUTOUT,
      status: WorkerJobStatus.COMPLETED,
      siteId: 'site-A',
    };

    it('CUTOUT 이 아닌 잡은 미존재와 동일한 404(존재 오라클 차단)', async () => {
      workerJobRepository.findOne.mockResolvedValue({
        ...siteJob,
        jobType: WorkerJobType.SYNTHESIZE,
      });

      await expect(service.findCutoutJob('job-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('★ 익명(토큰 없음) 호출자는 site 스탬프된 잡을 볼 수 없다', async () => {
      // 공용 assertJobSiteAccess 는 caller 부재를 '면제'로 해석한다 —
      // 그걸 그대로 쓰면 토큰을 뺄수록 권한이 커지는 역전이 생긴다.
      workerJobRepository.findOne.mockResolvedValue({ ...siteJob });

      await expect(service.findCutoutJob('job-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('다른 site 의 검증된 세션도 볼 수 없다', async () => {
      workerJobRepository.findOne.mockResolvedValue({ ...siteJob });

      await expect(
        service.findCutoutJob('job-1', { siteId: 'site-B' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('같은 site 세션은 볼 수 있다', async () => {
      workerJobRepository.findOne.mockResolvedValue({ ...siteJob });

      await expect(service.findCutoutJob('job-1', { siteId: 'site-A' })).resolves.toMatchObject({
        id: 'job-1',
      });
    });

    it('NULL-site 잡(게스트)은 익명도 볼 수 있다', async () => {
      workerJobRepository.findOne.mockResolvedValue({ ...siteJob, siteId: null });

      await expect(service.findCutoutJob('job-1')).resolves.toMatchObject({ id: 'job-1' });
    });
  });
});
