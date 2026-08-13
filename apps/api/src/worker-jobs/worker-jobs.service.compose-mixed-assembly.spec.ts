/**
 * 자동조립 opt-in (2026-08-13) — `createComposeMixedJob(rawDto, caller?)` 계약 잠금.
 *
 * 이 스펙이 지키는 것(순서 = 중요도):
 *  1. **회귀 잠금(최우선)**: `assembleFromSession` 미전달이면 기존 호출자 경로가 한 줄도
 *     달라지지 않는다 — 자동조립용 세션 조회(relations 동반) 0회, filesService/
 *     templateSetsService 미호출, 인가 미발동, 큐 페이로드 **키 집합과 값** 동일.
 *  2. 자동조립 정상 경로: 표지·내지·판형·siteId·callbackUrl 이 계약대로 채워진다.
 *  3. per-field 우선순위: dto 명시값이 언제나 세션 도출값을 이긴다(자동조립은 빈 자리만).
 *  4. 인가(자동조립 경로 한정): 호출자 siteId 없음 / session.siteId 없음 / 불일치 →
 *     전부 404 SESSION_NOT_FOUND (미존재와 동일한 응답 = 존재 은닉, books 패턴).
 *  5. 빈 입력 400 EMPTY_COMPOSE_INPUT — 워커 백지 1p COMPLETED 산출 차단.
 *  6. 자동조립 도출 실패 400 SESSION_ASSEMBLY_INCOMPLETE + missing 배열.
 *  7. 워커 무변경 보장: 도출값이 **기존 큐 키 이름** 그대로 실린다(신규 키 0건).
 *
 * 인스턴스 생성 패턴은 worker-jobs.service.compose-mixed.spec.ts 선례를 따른다.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkerJobsService } from './worker-jobs.service';

/**
 * 기존(자동조립 이전) compose-mixed 큐 페이로드의 키 집합 — 워커 계약 동결.
 * 여기에 키가 늘거나 이름이 바뀌면 apps/worker 변경 없이는 깨진다.
 */
const LEGACY_QUEUE_KEYS = [
  'jobId',
  'mode',
  'composeCoverUrl',
  'composeCoverEditable',
  'composeCoverWidthMm',
  'composeCoverHeightMm',
  'composeFrontEndpaperUrls',
  'composeBackEndpaperUrls',
  'composeContentPdfUrl',
  'composeContentWidthMm',
  'composeContentHeightMm',
  'composeOutputMode',
  'composeSpreadTotalWidthMm',
  'composeSpreadTotalHeightMm',
  'composeSpreadDpi',
  'composeSpreadOutputWidthMm',
  'composeSpreadOutputHeightMm',
  'callbackUrl',
].sort();

describe('WorkerJobsService.createComposeMixedJob — 자동조립 opt-in', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let templateSetsService: { findOne: jest.Mock; findOneWithTemplates: jest.Mock };
  /**
   * 템플릿 상세(spreadConfig 보유 행) — 기본 없음.
   * 서비스는 `findOneWithTemplates` 로 templateSet + templateDetails 를 함께 읽는다
   * (spreadConfig 는 template_sets 가 아니라 templates 행에 있다).
   */
  let templateDetails: unknown[];

  /** 기존 호출자(URL 직접 공급) — 자동조립 플래그 없음 */
  const legacyDto = {
    editSessionId: 'sess-1',
    coverUrl: '/app/storage/cover.pdf',
    contentPdfUrl: '/app/storage/content.pdf',
    coverWidthMm: 216,
    coverHeightMm: 303,
    contentWidthMm: 210,
    contentHeightMm: 297,
    outputMode: 'merged',
  };

  /** 자동조립 대상 세션 — 파트너 site-A 소유, 표지=local / 내지=편집 산출물(s3) */
  const sessionA = {
    id: 'sess-1',
    siteId: 'site-A',
    orderSeqno: 111,
    templateSetId: 'ts-1',
    callbackUrl: 'https://partner.example.com/hook',
    metadata: {},
    coverFile: { id: 'file-cover', filePath: '/app/storage/cover-x.pdf', storageBackend: 'local' },
    contentFile: { id: 'file-content', filePath: '/app/storage/content-x.pdf', storageBackend: 's3' },
    contentPdfFileId: null,
  };

  /** 판형 A4 · 면지 없음 · 표지 편집형 */
  const templateSetA4 = {
    id: 'ts-1',
    width: 210,
    height: 297,
    endpaperConfig: null,
    coverEditable: true,
  };

  beforeEach(() => {
    workerJobRepository = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 'job-asm' })),
    };
    editSessionRepository = { findOne: jest.fn() };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn() };
    templateDetails = [];
    templateSetsService = {
      findOne: jest.fn(),
      // 각 테스트는 `templateSetsService.findOne.mockResolvedValue(...)` 로 templateSet 만
      // 지정하고, 상세는 위 templateDetails 로 주입한다(대부분 빈 배열 = spreadConfig 없음).
      findOneWithTemplates: jest.fn(async (id: string) => ({
        templateSet: await templateSetsService.findOne(id),
        templateDetails,
      })),
    };

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      synthesisQueue as never,
      filesService as never,
      {} as never, // webhookService
      {} as never, // sitesService
      templateSetsService as never,
    );
  });

  const queuePayload = () => synthesisQueue.add.mock.calls[0][1];
  const createdJob = () => workerJobRepository.create.mock.calls[0][0];

  /** 예외 본문(getResponse) 까지 검사하기 위한 헬퍼 — rejects.toThrow 는 code 를 못 본다. */
  const catchError = async (fn: () => Promise<unknown>): Promise<any> => {
    try {
      await fn();
    } catch (e) {
      return e;
    }
    throw new Error('예외가 발생하지 않았다 (기대: 거부)');
  };

  // ────────────────────────────────────────────────────────────────────────
  // 1. 회귀 잠금 — assembleFromSession 미전달 = 기존 동작 100% 동일
  // ────────────────────────────────────────────────────────────────────────
  describe('회귀 잠금 — assembleFromSession 미전달(기존 호출자)', () => {
    it('자동조립용 세션 조회(relations 동반) 0회 · filesService/templateSetsService 미호출', async () => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      await service.createComposeMixedJob({ ...legacyDto });

      // 세션 조회는 기존 P0-3 spread 스냅샷 1건뿐 — where 만 있고 relations 는 없다.
      expect(editSessionRepository.findOne).toHaveBeenCalledTimes(1);
      const findArg = editSessionRepository.findOne.mock.calls[0][0];
      expect(findArg).toEqual({ where: { id: 'sess-1' } });
      expect('relations' in findArg).toBe(false);
      // 자동조립 전용 도출 경로 미진입
      expect(filesService.findById).not.toHaveBeenCalled();
      expect(templateSetsService.findOne).not.toHaveBeenCalled();
      expect(templateSetsService.findOneWithTemplates).not.toHaveBeenCalled();
    });

    it('큐 페이로드 키 집합과 값이 종전과 동일(신규 키 0건 — 워커 무변경)', async () => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      await service.createComposeMixedJob({ ...legacyDto });

      const payload = queuePayload();
      expect(Object.keys(payload).sort()).toEqual(LEGACY_QUEUE_KEYS);
      expect(payload).toMatchObject({
        jobId: 'job-asm',
        mode: 'compose-mixed',
        composeCoverUrl: '/app/storage/cover.pdf',
        composeCoverEditable: true,
        composeCoverWidthMm: 216,
        composeCoverHeightMm: 303,
        composeFrontEndpaperUrls: [],
        composeBackEndpaperUrls: [],
        composeContentPdfUrl: '/app/storage/content.pdf',
        composeContentWidthMm: 210,
        composeContentHeightMm: 297,
        composeOutputMode: 'merged',
      });
      // 자동조립 내부 플래그가 큐/DB 옵션으로 새지 않는다
      expect('assembleFromSession' in payload).toBe(false);
      expect('assembleFromSession' in createdJob().options).toBe(false);
    });

    it('인가 미발동 — caller 없이도, 세션이 타 테넌트여도 기존 경로는 그대로 201', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        id: 'sess-1',
        siteId: 'site-OTHER',
        metadata: {},
      });

      const job = await service.createComposeMixedJob({ ...legacyDto, siteId: 'site-A' });

      // 잡 생성 자체는 종전대로 성공한다(수동 경로에 인가 예외를 추가하지 않는다).
      expect(job.id).toBe('job-asm');
      // ⚠️ [2026-08-13 스탬프 규칙 변경] 이 단언이 원래 지키던 것은 **세션 스탬프가 수동
      //    경로로 새지 않는다**(job.siteId ≠ 'site-OTHER') 였다. 그 보장은 그대로 유지되며,
      //    다만 무검증 body.siteId 도 더 이상 채택되지 않는다 → NULL(= siteId 미전달 호출과
      //    동일 상태). 채택 조건은 아래 '테넌트 스탬프 위조 차단' 블록이 잠근다.
      expect(createdJob().siteId).toBeNull();
      expect(createdJob().siteId).not.toBe('site-OTHER');
    });

    it('assembleFromSession=false(명시) 도 미전달과 동일 — 도출 경로 미진입', async () => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      await service.createComposeMixedJob({ ...legacyDto, assembleFromSession: false });

      expect(templateSetsService.findOneWithTemplates).not.toHaveBeenCalled();
      expect(Object.keys(queuePayload()).sort()).toEqual(LEGACY_QUEUE_KEYS);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. 자동조립 정상 경로
  // ────────────────────────────────────────────────────────────────────────
  describe('자동조립 정상 경로', () => {
    beforeEach(() => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue(templateSetA4);
    });

    it('표지·내지·판형·callbackUrl 을 세션/템플릿셋에서 도출해 기존 큐 키로 싣는다', async () => {
      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      // 표지: local 백엔드 → filePath 그대로
      expect(payload.composeCoverUrl).toBe('/app/storage/cover-x.pdf');
      // 내지: s3 백엔드 → api://<fileId> 마커 (IsSafeFileRef 허용 형태)
      expect(payload.composeContentPdfUrl).toBe('api://file-content');
      // 판형: templateSet.width/height
      expect(payload.composeContentWidthMm).toBe(210);
      expect(payload.composeContentHeightMm).toBe(297);
      // 표지 판형: metadata.spread 부재 → templateSet 폴백
      expect(payload.composeCoverWidthMm).toBe(210);
      expect(payload.composeCoverHeightMm).toBe(297);
      // 웹훅 미발신 사각 해소 — 세션 callbackUrl 폴백
      expect(payload.callbackUrl).toBe('https://partner.example.com/hook');
      expect(createdJob().options.callbackUrl).toBe('https://partner.example.com/hook');
    });

    it('job.siteId 는 세션 권위로 스탬프된다(dto.siteId 보다 우선)', async () => {
      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true, siteId: 'site-WRONG' },
        { siteId: 'site-A' },
      );

      // 잡이 NULL/타 테넌트로 스탬프되면 assertJobSiteAccess 가 전 테넌트에 열린다
      expect(createdJob().siteId).toBe('site-A');
    });

    it('첨부 내지 PDF(contentPdfFileId)가 편집 산출물(contentFile)보다 우선', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        contentPdfFileId: 'file-attached',
      });
      filesService.findById.mockResolvedValue({
        id: 'file-attached',
        filePath: '/app/storage/attached.pdf',
        storageBackend: 'local',
      });

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      expect(filesService.findById).toHaveBeenCalledWith('file-attached');
      expect(queuePayload().composeContentPdfUrl).toBe('/app/storage/attached.pdf');
    });

    it('면지 매수(endpaperConfig)만큼 null(빈 면지) 배열을 도출', async () => {
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        endpaperConfig: { frontCount: 2, backCount: 1, frontEditable: false, backEditable: false },
      });

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeFrontEndpaperUrls).toEqual([null, null]);
      expect(payload.composeBackEndpaperUrls).toEqual([null]);
    });

    it('펼침면 세션: 표지 치수는 metadata.spread.output* 우선(D-4 규약) — 내지는 판형 그대로', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        metadata: {
          spread: { totalWidthMm: 450, totalHeightMm: 300, dpi: 300, outputWidthMm: 466, outputHeightMm: 316 },
        },
      });

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeCoverWidthMm).toBe(466);
      expect(payload.composeCoverHeightMm).toBe(316);
      expect(payload.composeContentWidthMm).toBe(210);
      // 기존 P0-3 규칙(스프레드 책 → separate 강제)은 자동조립 경로에서도 그대로
      expect(payload.composeOutputMode).toBe('separate');
      expect(payload.composeSpreadTotalWidthMm).toBe(450);
    });

    it('templateSet 미존재(NotFound)는 흡수 — 판형만 못 채우고 나머지 도출은 계속', async () => {
      templateSetsService.findOne.mockRejectedValue(new NotFoundException('no ts'));

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true, contentWidthMm: 148, contentHeightMm: 210 },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeContentPdfUrl).toBe('api://file-content');
      expect(payload.composeContentWidthMm).toBe(148);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. per-field 우선순위 — dto 명시값이 언제나 이긴다
  // ────────────────────────────────────────────────────────────────────────
  describe('per-field 우선순위(dto > 세션 도출)', () => {
    it('dto 에 명시된 표지/내지/치수/면지/callbackUrl 은 도출값으로 덮이지 않는다', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        contentPdfFileId: 'file-attached',
      });
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        endpaperConfig: { frontCount: 2, backCount: 2, frontEditable: false, backEditable: false },
      });

      await service.createComposeMixedJob(
        {
          editSessionId: 'sess-1',
          assembleFromSession: true,
          coverUrl: '/app/storage/dto-cover.pdf',
          contentPdfUrl: 'api://dto-content',
          coverWidthMm: 999,
          coverHeightMm: 888,
          contentWidthMm: 148,
          contentHeightMm: 210,
          frontEndpaperUrls: ['/app/storage/dto-front.pdf'],
          backEndpaperUrls: [],
          callbackUrl: 'https://dto.example.com/hook',
        },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeCoverUrl).toBe('/app/storage/dto-cover.pdf');
      expect(payload.composeContentPdfUrl).toBe('api://dto-content');
      expect(payload.composeCoverWidthMm).toBe(999);
      expect(payload.composeCoverHeightMm).toBe(888);
      expect(payload.composeContentWidthMm).toBe(148);
      expect(payload.composeContentHeightMm).toBe(210);
      expect(payload.composeFrontEndpaperUrls).toEqual(['/app/storage/dto-front.pdf']);
      expect(payload.composeBackEndpaperUrls).toEqual([]); // 빈 배열도 '명시값'
      expect(payload.callbackUrl).toBe('https://dto.example.com/hook');
      // 내지가 dto 로 이미 채워졌으므로 첨부 파일 조회 자체가 없다
      expect(filesService.findById).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. 인가 — 자동조립 경로에만, 실패는 전부 404 SESSION_NOT_FOUND(존재 은닉)
  // ────────────────────────────────────────────────────────────────────────
  describe('인가(자동조립 경로 한정) — 실패는 전부 404 SESSION_NOT_FOUND', () => {
    const assembleDto = { editSessionId: 'sess-1', assembleFromSession: true };

    beforeEach(() => {
      templateSetsService.findOne.mockResolvedValue(templateSetA4);
    });

    const expectHidden404 = async (
      session: unknown,
      caller?: { siteId?: string; allowedOrderSeqnos?: unknown },
    ) => {
      editSessionRepository.findOne.mockResolvedValue(session);
      const err = await catchError(() => service.createComposeMixedJob({ ...assembleDto }, caller));
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.getResponse()).toMatchObject({ code: 'SESSION_NOT_FOUND' });
      // 잡도 큐도 만들어지지 않는다
      expect(workerJobRepository.save).not.toHaveBeenCalled();
      expect(synthesisQueue.add).not.toHaveBeenCalled();
      return err;
    };

    it('호출자 siteId 없음(토큰 미제출/게스트) → 404', async () => {
      await expectHidden404(sessionA, undefined);
    });

    it('호출자 siteId 없음(caller 객체는 있으나 siteId 미해석) → 404', async () => {
      await expectHidden404(sessionA, {});
    });

    it('session.siteId 없음(NULL-site 세션) → 404 — 약한 `session.siteId &&` 패턴 금지 확인', async () => {
      await expectHidden404({ ...sessionA, siteId: null }, { siteId: 'site-A' });
    });

    it('교차 테넌트(불일치) → 404', async () => {
      await expectHidden404(sessionA, { siteId: 'site-B' });
    });

    it('세션 미존재 → 동일한 404 본문(존재 오라클 차단)', async () => {
      const err = await expectHidden404(null, { siteId: 'site-A' });
      expect(err.getResponse()).toMatchObject({
        code: 'SESSION_NOT_FOUND',
        details: { sessionId: 'sess-1' },
      });
    });

    // ── 주문 스코프(2026-08-13 적대검증 MAJOR) ─────────────────────────────
    // siteId 만 보면 **같은 테넌트의 타 고객 세션**을 조립해 그 표지/내지를 합본으로
    // 뽑아낼 수 있다(잡이 자기 siteId 로 스탬프되므로 GET /worker-jobs/:id/output 까지
    // 통과). 형제 라우트(edit-sessions.controller.ts Patch D·F-5)와 동일 근거 필드로 막는다.
    it('동일 site · 타 고객 세션(orderSeqno 불일치) → 404 + 잡/큐 미생성', async () => {
      await expectHidden404(
        { ...sessionA, orderSeqno: 222 },
        { siteId: 'site-A', allowedOrderSeqnos: [111] },
      );
    });

    it('세션 orderSeqno 미해석(NULL) + 주문 스코프 토큰 → 404(fail-closed)', async () => {
      await expectHidden404(
        { ...sessionA, orderSeqno: null },
        { siteId: 'site-A', allowedOrderSeqnos: [111] },
      );
    });

    it('허용 주문과 일치 → 통과(201)', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);

      const job = await service.createComposeMixedJob(
        { ...assembleDto },
        { siteId: 'site-A', allowedOrderSeqnos: ['111'] }, // 문자열도 Number 정규화로 일치
      );

      expect(job.id).toBe('job-asm');
      expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    });

    it('allowedOrderSeqnos 없는 토큰 → 기존대로 통과(호환 모드 — 현행 파트너 무영향)', async () => {
      editSessionRepository.findOne.mockResolvedValue({ ...sessionA, orderSeqno: 999 });

      const job = await service.createComposeMixedJob({ ...assembleDto }, { siteId: 'site-A' });

      expect(job.id).toBe('job-asm');
      expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    });

    it('allowedOrderSeqnos 빈 배열 → 검사 생략(호환 모드)', async () => {
      editSessionRepository.findOne.mockResolvedValue({ ...sessionA, orderSeqno: 999 });

      const job = await service.createComposeMixedJob(
        { ...assembleDto },
        { siteId: 'site-A', allowedOrderSeqnos: [] },
      );

      expect(job.id).toBe('job-asm');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4-b. 도출 정확성 — 내지 페이지 크기(빈 면지 치수)·표지 요구 판정
  // ────────────────────────────────────────────────────────────────────────
  describe('도출 정확성 — spreadConfig/작업사이즈', () => {
    it('cropMarkEnabled && bleedMm>0 → 내지 치수는 작업사이즈(재단+블리드*2)', async () => {
      // 편집기가 이 게이트에서 페이지를 trim+bleed*2 로 만든다(ServicePlugin useEditSize).
      // 빈 면지를 재단 판형으로 만들면 같은 PDF 안에서 6mm 어긋난다.
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        bleedMm: 3,
        cropMarkEnabled: true,
        endpaperConfig: { frontCount: 2, backCount: 2, frontEditable: false, backEditable: false },
      });

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeContentWidthMm).toBe(216);
      expect(payload.composeContentHeightMm).toBe(303);
      expect(payload.composeFrontEndpaperUrls).toEqual([null, null]);
    });

    it('펼침면 내지(regionScope=inner) → 내지 치수는 2-up(pageWidthMm*2)', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        endpaperConfig: { frontCount: 1, backCount: 0, frontEditable: false, backEditable: false },
      });
      templateDetails = [
        {
          id: 'tpl-inner',
          spreadConfig: {
            version: 2,
            regions: [],
            totalWidthMm: 420,
            totalHeightMm: 297,
            regionScope: 'inner',
            innerSpec: { pageWidthMm: 210, pageHeightMm: 297, gutterMm: 10, cutSizeMm: 3 },
          },
        },
      ];

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      const payload = queuePayload();
      expect(payload.composeContentWidthMm).toBe(420);
      expect(payload.composeContentHeightMm).toBe(297);
    });

    it('내지 전용 펼침면 세트는 표지 부재를 결손으로 보지 않는다(coverEditable=true 기본이어도 201)', async () => {
      // 편집기가 cover PDF 를 아예 만들지 않는 상품군(embed.tsx isInnerOnlySpread).
      editSessionRepository.findOne.mockResolvedValue({ ...sessionA, coverFile: null });
      templateSetsService.findOne.mockResolvedValue(templateSetA4); // coverEditable: true
      templateDetails = [
        {
          id: 'tpl-inner',
          spreadConfig: {
            version: 2,
            regions: [],
            totalWidthMm: 420,
            totalHeightMm: 297,
            regionScope: 'inner',
            innerSpec: { pageWidthMm: 210, pageHeightMm: 297, gutterMm: 10, cutSizeMm: 3 },
          },
        },
      ];

      const job = await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      expect(job.id).toBe('job-asm');
      expect(queuePayload().composeCoverUrl).toBeUndefined();
    });

    it('스프레드 책 + outputMode=content-only 는 표지를 요구한다(워커가 separate 로 강제되므로)', async () => {
      // P0-3 이 outputMode 를 separate 로 승격 → 표지 없으면 워커가 빈 cover.pdf 1p 를
      // COMPLETED 로 낸다. 판정을 dto.outputMode 로만 하면 이 백지가 통과한다.
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        coverFile: null,
        metadata: { spread: { totalWidthMm: 440, totalHeightMm: 303, dpi: 300 } },
      });
      templateSetsService.findOne.mockResolvedValue(templateSetA4);

      const err = await catchError(() =>
        service.createComposeMixedJob(
          { editSessionId: 'sess-1', assembleFromSession: true, outputMode: 'content-only' },
          { siteId: 'site-A' },
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'SESSION_ASSEMBLY_INCOMPLETE',
        missing: ['coverUrl'],
      });
      expect(synthesisQueue.add).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. 빈 입력 400 EMPTY_COMPOSE_INPUT (오너 결정 — 전 경로 승격)
  // ────────────────────────────────────────────────────────────────────────
  describe('빈 입력 400 EMPTY_COMPOSE_INPUT', () => {
    it('{editSessionId, orderId} 만(종전 백지 COMPLETED) → 400 + 잡/큐 미생성', async () => {
      const err = await catchError(() =>
        service.createComposeMixedJob({ editSessionId: 'sess-1', orderId: 'ord-1' }),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'EMPTY_COMPOSE_INPUT',
        details: { editSessionId: 'sess-1' },
      });
      expect(workerJobRepository.create).not.toHaveBeenCalled();
      expect(synthesisQueue.add).not.toHaveBeenCalled();
      // 자산 판정은 세션 조회보다 앞선다(불필요한 DB 왕복 없음)
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    });

    it('레더커버(coverEditable=false)에 coverUrl 만 있으면 자산 0건 → 400', async () => {
      // 워커는 coverEditable=false 면 coverUrl 을 싣지 않고 빈 표지를 만든다
      const err = await catchError(() =>
        service.createComposeMixedJob({
          editSessionId: 'sess-1',
          coverEditable: false,
          coverUrl: '/app/storage/cover.pdf',
        }),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({ code: 'EMPTY_COMPOSE_INPUT' });
    });

    it('면지 non-null 원소가 1건이라도 있으면 통과(null 원소는 빈 페이지 지시라 자산 아님)', async () => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      // null 만 → 거부
      const err = await catchError(() =>
        service.createComposeMixedJob({
          editSessionId: 'sess-1',
          frontEndpaperUrls: [null, null],
        }),
      );
      expect(err.getResponse()).toMatchObject({ code: 'EMPTY_COMPOSE_INPUT' });

      // non-null 1건 → 생성
      const job = await service.createComposeMixedJob({
        editSessionId: 'sess-1',
        frontEndpaperUrls: [null, '/app/storage/front.pdf'],
      });
      expect(job.id).toBe('job-asm');
    });

    it('자동조립 경로에서는 도출 게이트(SESSION_ASSEMBLY_INCOMPLETE)가 먼저 걸린다', async () => {
      // 자산 0건 세션은 EMPTY 에 닿기 전에 도출 실패로 막힌다 — 어느 쪽이든 백지 산출 0건
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        coverFile: null,
        contentFile: null,
        contentPdfFileId: null,
      });
      templateSetsService.findOne.mockResolvedValue(templateSetA4);

      const err = await catchError(() =>
        service.createComposeMixedJob(
          { editSessionId: 'sess-1', assembleFromSession: true },
          { siteId: 'site-A' },
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse().code).toBe('SESSION_ASSEMBLY_INCOMPLETE');
      expect(synthesisQueue.add).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 6. 도출 실패 400 SESSION_ASSEMBLY_INCOMPLETE + missing
  // ────────────────────────────────────────────────────────────────────────
  describe('자동조립 도출 실패 400 SESSION_ASSEMBLY_INCOMPLETE', () => {
    it('editSessionId 없이 assembleFromSession=true → missing=[editSessionId] (세션 조회 전 차단)', async () => {
      const err = await catchError(() =>
        service.createComposeMixedJob({ assembleFromSession: true }, { siteId: 'site-A' }),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'SESSION_ASSEMBLY_INCOMPLETE',
        missing: ['editSessionId'],
      });
      expect(editSessionRepository.findOne).not.toHaveBeenCalled();
    });

    it('내지 파일이 세션에 없으면 missing 에 contentPdfUrl', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        ...sessionA,
        contentFile: null,
        contentPdfFileId: null,
      });
      templateSetsService.findOne.mockResolvedValue(templateSetA4);

      const err = await catchError(() =>
        service.createComposeMixedJob(
          { editSessionId: 'sess-1', assembleFromSession: true },
          { siteId: 'site-A' },
        ),
      );

      expect(err.getResponse().missing).toContain('contentPdfUrl');
      expect(err.getResponse().details).toMatchObject({ sessionId: 'sess-1' });
    });

    it('표지 편집형인데 표지 파일이 없으면 missing 에 coverUrl', async () => {
      editSessionRepository.findOne.mockResolvedValue({ ...sessionA, coverFile: null });
      templateSetsService.findOne.mockResolvedValue(templateSetA4);

      const err = await catchError(() =>
        service.createComposeMixedJob(
          { editSessionId: 'sess-1', assembleFromSession: true },
          { siteId: 'site-A' },
        ),
      );

      expect(err.getResponse().missing).toContain('coverUrl');
    });

    it('레더커버(templateSet.coverEditable=false)는 표지 부재가 정상 — 내지만으로 성공', async () => {
      editSessionRepository.findOne.mockResolvedValue({ ...sessionA, coverFile: null });
      templateSetsService.findOne.mockResolvedValue({ ...templateSetA4, coverEditable: false });

      const job = await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      expect(job.id).toBe('job-asm');
      expect(queuePayload().composeContentPdfUrl).toBe('api://file-content');
    });

    it('편집가능 면지(frontEditable=true)는 산출물 참조가 없어 fail-closed — missing 에 등재', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        endpaperConfig: { frontCount: 1, backCount: 1, frontEditable: true, backEditable: true },
      });

      const err = await catchError(() =>
        service.createComposeMixedJob(
          { editSessionId: 'sess-1', assembleFromSession: true },
          { siteId: 'site-A' },
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      const missing: string[] = err.getResponse().missing;
      expect(missing.some((m) => m.startsWith('frontEndpaperUrls'))).toBe(true);
      expect(missing.some((m) => m.startsWith('backEndpaperUrls'))).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 7. 워커 계약 — 도출값은 기존 큐 키로만 흐른다(apps/worker 무변경 보장)
  // ────────────────────────────────────────────────────────────────────────
  describe('워커 계약 — 도출값이 기존 큐 키 이름 그대로', () => {
    it('자동조립 페이로드의 키 집합이 기존 경로와 완전히 동일(신규 키 0건)', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue({
        ...templateSetA4,
        endpaperConfig: { frontCount: 1, backCount: 1, frontEditable: false, backEditable: false },
      });

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );

      expect(Object.keys(queuePayload()).sort()).toEqual(LEGACY_QUEUE_KEYS);
      // 내부 opt-in 플래그가 큐/DB 로 새지 않는다
      expect('assembleFromSession' in queuePayload()).toBe(false);
      expect('assembleFromSession' in createdJob().options).toBe(false);
      // 도출값이 실린 키 이름 확인(워커가 읽는 이름 그대로)
      expect(queuePayload().composeCoverUrl).toBe('/app/storage/cover-x.pdf');
      expect(queuePayload().composeContentPdfUrl).toBe('api://file-content');
      expect(queuePayload().composeFrontEndpaperUrls).toEqual([null]);
      expect(queuePayload().composeBackEndpaperUrls).toEqual([null]);
      expect(queuePayload().composeContentWidthMm).toBe(210);
      expect(queuePayload().composeCoverHeightMm).toBe(297);
    });

    it('DB job.options 도 기존 키 집합 유지 — 자동조립 전용 키 신설 0건', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue(templateSetA4);

      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true },
        { siteId: 'site-A' },
      );
      const assembledKeys = Object.keys(createdJob().options).sort();

      jest.clearAllMocks();
      workerJobRepository.create.mockImplementation((x: any) => x);
      workerJobRepository.save.mockImplementation(async (x: any) => ({ ...x, id: 'job-asm' }));
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      await service.createComposeMixedJob({ ...legacyDto });
      const legacyKeys = Object.keys(createdJob().options).sort();

      expect(assembledKeys).toEqual(legacyKeys);
    });
  });
});
