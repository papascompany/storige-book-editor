/**
 * Stage 0 — split-synthesize/check-mergeable external 사이트 스탬프 비대칭 봉합 (2026-07-15)
 *
 * 잠그는 계약:
 *  1. createSplitSynthesisJob — siteId 미전달(기존 파트너/내부 호출) 시 잡 siteId=NULL
 *     로 **기존 동작 그대로**. siteId 전달(X-API-Key external 경유) 시 잡 엔티티에 스탬프
 *     (validate/synthesize/fix-pagecount external 준용).
 *  2. 큐 페이로드는 siteId 유무와 무관하게 동일 — 스탬프는 DB 행에만, 워커 입력 불변.
 *  3. checkMergeable — site 컨텍스트는 감사 로깅용 전달만. site 유무와 무관하게 응답
 *     완전 동일(동작 불변 — 보수 기본값). 접근 차단/스코핑 강제 없음: NULL-siteId 이원
 *     정책은 오너 결정 잔여 사안(CONTRACT_FREEZE §4.3), 확정 전 도입 금지.
 *
 * 인스턴스 생성 패턴은 worker-jobs.bleed-fix.spec.ts / compose-mixed.spec.ts 선례.
 */
import { WorkerJobsService } from './worker-jobs.service';
import { WorkerJobStatus, WorkerJobType, TemplateType } from '@storige/types';

describe('WorkerJobsService — external 사이트 스탬프 비대칭 봉합 (Stage 0)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };

  const session = {
    id: 'sess-1',
    metadata: {
      pages: [
        { sortOrder: 0, templateType: TemplateType.COVER },
        { sortOrder: 1, templateType: TemplateType.PAGE },
      ],
    },
  };

  const editorPdf = {
    id: 'file-1',
    filePath: '/app/storage/uploads/out.pdf',
    metadata: { generatedBy: 'editor', editSessionId: 'sess-1' },
  };

  const baseDto = {
    sessionId: 'sess-1',
    pdfFileId: 'file-1',
    requestId: '11111111-1111-4111-8111-111111111111',
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'job-split', ...x })),
      findOne: jest.fn(async () => null), // 멱등 히트 없음
    };
    editSessionRepository = {
      findOne: jest.fn(async () => ({ ...session })),
      update: jest.fn(),
    };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    filesService = {
      // checkMergeable 테스트에서는 결정적 이슈 경로(파일 미존재)로 강제
      findById: jest.fn(async () => ({ ...editorPdf })),
    };

    service = new WorkerJobsService(
      workerJobRepository as any,
      editSessionRepository as any,
      { add: jest.fn() } as any, // validationQueue
      { add: jest.fn() } as any, // conversionQueue
      synthesisQueue as any,
      filesService as any,
      {} as any, // webhookService
      {} as any, // sitesService
      {} as any, // templateSetsService
    );
  });

  describe('createSplitSynthesisJob — siteId 스탬프', () => {
    it('siteId 미전달(기존 파트너 시나리오) → 잡 siteId=NULL (기존 동작 불변)', async () => {
      await service.createSplitSynthesisJob({ ...baseDto });

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.jobType).toBe(WorkerJobType.SYNTHESIZE);
      expect(created.status).toBe(WorkerJobStatus.PENDING);
      expect(created.siteId).toBeNull();
    });

    it('siteId 전달(external X-API-Key 경유) → 잡 엔티티에 스탬프', async () => {
      await service.createSplitSynthesisJob({ ...baseDto, siteId: 'site-1' });

      const created = workerJobRepository.create.mock.calls[0][0];
      expect(created.siteId).toBe('site-1');
    });

    it('큐 페이로드는 siteId 유무와 무관하게 동일 (워커 입력 불변)', async () => {
      await service.createSplitSynthesisJob({ ...baseDto });
      await service.createSplitSynthesisJob({ ...baseDto, siteId: 'site-1' });

      const [nameA, payloadA, optsA] = synthesisQueue.add.mock.calls[0];
      const [nameB, payloadB, optsB] = synthesisQueue.add.mock.calls[1];
      expect(nameA).toBe('synthesize-pdf');
      expect(nameB).toBe('synthesize-pdf');
      expect(payloadB).toEqual(payloadA); // siteId 가 큐 페이로드로 새지 않는다
      expect(payloadA).not.toHaveProperty('siteId');
      expect(optsB).toEqual(optsA);
    });

    it('멱등 조회 키는 (sessionId, pdfFileId, requestId) 그대로 — siteId 는 키에 불포함', async () => {
      await service.createSplitSynthesisJob({ ...baseDto, siteId: 'site-1' });

      expect(workerJobRepository.findOne).toHaveBeenCalledWith({
        where: {
          sessionId: baseDto.sessionId,
          pdfFileId: baseDto.pdfFileId,
          requestId: baseDto.requestId,
        },
      });
    });
  });

  describe('checkMergeable — site 컨텍스트 전달은 동작 불변 (보수 기본값)', () => {
    const dto = {
      editSessionId: 'sess-1',
      coverFileId: 'cover-x',
      contentFileId: 'content-x',
      spineWidth: 5.5,
    };

    beforeEach(() => {
      // 결정적 응답 경로: 파일 미존재 → *_FILE_NOT_FOUND 이슈 (네트워크/파일시스템 미접촉)
      filesService.findById = jest.fn(async () => {
        throw new Error('not found');
      });
    });

    it('site 미전달(기존 파트너 시나리오)과 site 전달의 응답이 완전 동일하다', async () => {
      const withoutSite = await service.checkMergeable({ ...dto } as any);
      const withSite = await service.checkMergeable({ ...dto } as any, {
        siteId: 'site-1',
        role: 'editor',
      });

      expect(withSite).toEqual(withoutSite);
      expect(withoutSite.mergeable).toBe(false);
      expect((withoutSite.issues ?? []).map((i) => i.code).sort()).toEqual([
        'CONTENT_FILE_NOT_FOUND',
        'COVER_FILE_NOT_FOUND',
      ]);
    });

    it('site 전달이 접근 차단(throw)을 일으키지 않는다 — 스코핑 강제는 오너 결정 전 도입 금지', async () => {
      await expect(
        service.checkMergeable({ ...dto } as any, { siteId: 'other-site', role: 'editor' }),
      ).resolves.toMatchObject({ mergeable: false });
    });
  });
});
