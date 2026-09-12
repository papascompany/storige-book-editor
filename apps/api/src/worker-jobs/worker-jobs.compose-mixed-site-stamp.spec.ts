/**
 * 테넌트 스탬프 위조 차단 (2026-08-13) — `POST /worker-jobs/compose-mixed` 의
 * `job.siteId` 결정 규칙 잠금.
 *
 * ── 왜 필요한가 ────────────────────────────────────────────────────────────
 * 이 라우트는 `@Public` 이다(worker-jobs.controller.ts:276-278, contract-freeze.spec.ts:65
 * auth:'public' 로 동결). 다른 잡 생성 라우트가 `@CurrentSite()` 서버 도출값을 넣는 것과
 * 달리(worker-jobs.controller.ts:139·190·224·461) 이 라우트의 `siteId` 는 **무인증
 * 호출자가 body 로 고른 값**이었고, 종전 구현은 그것을 그대로 잡에 기록했다
 * (`siteId: dto.siteId || null`). 결과:
 *   ① 잡이 임의 테넌트 소유로 귀속(assertJobSiteAccess:2310-2318 이 그 테넌트에 개방),
 *   ② 완료 시 **그 사이트의 v2 웹훅 엔드포인트로 발신** — v2 는 목적지 URL 이 사이트
 *      config 에서 나오므로 호출자가 callbackUrl 을 주지 않아도 남의 파트너 서버로
 *      잡 결과가 배달된다(updateJobStatus:2382-2391 게이트 → hasV2ConfigForJob).
 *
 * ── 이 spec 이 잠그는 계약 ─────────────────────────────────────────────────
 *  1. 위조 siteId(caller 부재/불일치) → **무시하고 NULL 스탬프**. 400 을 던지지 않는다
 *     (무중단 최우선 — 프로덕션 compose-mixed 호출 이력 0건이지만 조용한 하향이 안전).
 *  2. 검증된 shop-session 의 siteId 와 **일치**하면 채택(정상 파트너 배선 무영향).
 *  3. 자동조립 경로는 `session.siteId` 권위 그대로(인가 게이트를 이미 통과한 값).
 *  4. 웹훅 발신 게이트 파급: NULL 스탬프 잡은 `hasV2Config(null)`(webhook.service.ts:87)
 *     로 v2 게이트가 닫히고, 위조 대상 사이트의 v2 엔드포인트로는 발신되지 않는다.
 *
 * 인스턴스 생성 패턴: worker-jobs.service.compose-mixed-assembly.spec.ts /
 * worker-jobs.callback-gate.spec.ts 선례.
 */
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsService } from './worker-jobs.service';

describe('compose-mixed — job.siteId 스탬프 규칙(위조 차단)', () => {
  let service: WorkerJobsService;
  let workerJobRepository: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let editSessionRepository: { findOne: jest.Mock; update: jest.Mock };
  let synthesisQueue: { add: jest.Mock };
  let filesService: { findById: jest.Mock };
  let webhookService: { sendCallback: jest.Mock; hasV2Config: jest.Mock };
  let templateSetsService: { findOne: jest.Mock; findOneWithTemplates: jest.Mock };

  /** 수동 경로(URL 직접 공급) — 자동조립 플래그 없음 */
  const manualDto = {
    editSessionId: 'sess-1',
    coverUrl: '/app/storage/cover.pdf',
    contentPdfUrl: '/app/storage/content.pdf',
    coverWidthMm: 216,
    coverHeightMm: 303,
    contentWidthMm: 210,
    contentHeightMm: 297,
    outputMode: 'merged',
  };

  /** 자동조립 대상 세션 — site-A 소유 */
  const sessionA = {
    id: 'sess-1',
    siteId: 'site-A',
    orderSeqno: 111,
    templateSetId: 'ts-1',
    callbackUrl: null,
    metadata: {},
    coverFile: { id: 'file-cover', filePath: '/app/storage/cover-x.pdf', storageBackend: 'local' },
    contentFile: { id: 'file-content', filePath: '/app/storage/content-x.pdf', storageBackend: 'local' },
    contentPdfFileId: null,
  };

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
      save: jest.fn(async (x) => ({ ...x, id: 'job-stamp' })),
      findOne: jest.fn(),
    };
    editSessionRepository = { findOne: jest.fn(), update: jest.fn() };
    synthesisQueue = { add: jest.fn(async () => ({})) };
    filesService = { findById: jest.fn() };
    webhookService = {
      sendCallback: jest.fn(async () => true),
      // 위조 대상 사이트만 v2 config 보유 — NULL/타 site 는 false.
      hasV2Config: jest.fn(async (siteId?: string | null) => siteId === 'site-VICTIM'),
    };
    templateSetsService = {
      findOne: jest.fn(),
      findOneWithTemplates: jest.fn(async (id: string) => ({
        templateSet: await templateSetsService.findOne(id),
        templateDetails: [],
      })),
    };

    service = new WorkerJobsService(
      workerJobRepository as never,
      editSessionRepository as never,
      { add: jest.fn() } as never, // validationQueue
      { add: jest.fn() } as never, // conversionQueue
      synthesisQueue as never,
      filesService as never,
      webhookService as never,
      {} as never, // sitesService
      templateSetsService as never,
    );
  });

  const createdJob = () => workerJobRepository.create.mock.calls[0][0];
  const queuePayload = () => synthesisQueue.add.mock.calls[0][1];

  // ────────────────────────────────────────────────────────────────────────
  // 1. 수동 경로 — 위조 siteId 무시
  // ────────────────────────────────────────────────────────────────────────
  describe('수동 경로 — 위조 siteId 무시(NULL 스탬프)', () => {
    beforeEach(() => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });
    });

    it('caller 없음(무인증 게스트) + body.siteId → 무시하고 NULL 스탬프', async () => {
      const job = await service.createComposeMixedJob({ ...manualDto, siteId: 'site-VICTIM' });

      expect(createdJob().siteId).toBeNull();
      // 무중단: 400 이 아니라 잡은 그대로 생성된다.
      expect(job.id).toBe('job-stamp');
      expect(synthesisQueue.add).toHaveBeenCalledTimes(1);
    });

    it('caller 있음 + 불일치 body.siteId → 무시하고 NULL 스탬프(자기 site 로도 승격하지 않는다)', async () => {
      await service.createComposeMixedJob(
        { ...manualDto, siteId: 'site-VICTIM' },
        { siteId: 'site-A' },
      );

      // ⚠️ caller.siteId 로 '교정'하지 않는다 — 이 라우트의 기존 계약은 "미전달=NULL" 이고,
      //    자동 승격은 기존 무-siteId 호출자의 잡을 갑자기 테넌트 스코프로 밀어넣는 변경이 된다.
      expect(createdJob().siteId).toBeNull();
    });

    it('body.siteId 미전달 → 종전과 동일하게 NULL (회귀 없음)', async () => {
      await service.createComposeMixedJob({ ...manualDto }, { siteId: 'site-A' });

      expect(createdJob().siteId).toBeNull();
    });

    it('스탬프 규칙은 큐 페이로드에 영향을 주지 않는다(워커 입력 불변)', async () => {
      await service.createComposeMixedJob({ ...manualDto, siteId: 'site-VICTIM' });
      const forged = queuePayload();

      synthesisQueue.add.mockClear();
      workerJobRepository.create.mockClear();
      await service.createComposeMixedJob({ ...manualDto });

      expect(queuePayload()).toEqual(forged);
      expect(forged).not.toHaveProperty('siteId');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2. 수동 경로 — 일치 시 채택
  // ────────────────────────────────────────────────────────────────────────
  describe('수동 경로 — 검증된 shop-session 과 일치하면 채택', () => {
    it('caller.siteId === body.siteId → 스탬프 유지(정상 파트너 배선 무영향)', async () => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });

      await service.createComposeMixedJob(
        { ...manualDto, siteId: 'site-A' },
        { siteId: 'site-A' },
      );

      expect(createdJob().siteId).toBe('site-A');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3. 자동조립 — 세션 권위
  // ────────────────────────────────────────────────────────────────────────
  describe('자동조립 — session.siteId 권위 유지', () => {
    beforeEach(() => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue(templateSetA4);
    });

    it('body.siteId 가 위조여도 세션 권위값으로 스탬프된다', async () => {
      await service.createComposeMixedJob(
        { editSessionId: 'sess-1', assembleFromSession: true, siteId: 'site-VICTIM' },
        { siteId: 'site-A' },
      );

      // 자동조립은 caller↔session 일치가 이미 강제된 경로(assembleComposeInputFromSession)라
      // 세션 siteId 가 곧 검증된 값이다. NULL 로 떨어뜨리면 정상 파트너 잡이 테넌트를 잃는다.
      expect(createdJob().siteId).toBe('site-A');
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 4. 웹훅 발신 게이트 파급 — 위조 테넌트의 v2 엔드포인트로 새지 않는다
  // ────────────────────────────────────────────────────────────────────────
  describe('웹훅 발신 게이트 파급(updateJobStatus 경유)', () => {
    /** 생성된 잡을 그대로 updateJobStatus 에 먹인다(실제 완료 흐름 재현). */
    const completeCreatedJob = async () => {
      const created = createdJob();
      workerJobRepository.findOne.mockResolvedValue({
        ...created,
        id: 'job-stamp',
        jobType: WorkerJobType.SYNTHESIZE,
        status: WorkerJobStatus.PROCESSING,
        editSessionId: null, // 세션 전이 경로 배제 — 발신 게이트만 관찰
        result: null,
      });
      await service.updateJobStatus('job-stamp', { status: WorkerJobStatus.COMPLETED });
    };

    beforeEach(() => {
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });
    });

    it('위조 siteId(NULL 스탬프) + callbackUrl 없음 → 위조 사이트 v2 로 발신되지 않는다', async () => {
      await service.createComposeMixedJob({ ...manualDto, siteId: 'site-VICTIM' });
      await completeCreatedJob();

      // 게이트는 job.siteId 로 판정한다(worker-jobs.service.ts:2391 hasV2ConfigForJob(job, job.siteId)).
      // NULL 이면 webhook.service.ts:87 이 DB 조회 없이 false → 발신 0.
      expect(webhookService.hasV2Config).toHaveBeenCalledWith(null);
      expect(webhookService.hasV2Config).not.toHaveBeenCalledWith('site-VICTIM');
      expect(webhookService.sendCallback).not.toHaveBeenCalled();
    });

    it('일치 siteId(채택) → 자기 사이트 v2 게이트는 종전대로 평가된다', async () => {
      webhookService.hasV2Config.mockImplementation(
        async (siteId?: string | null) => siteId === 'site-A',
      );

      await service.createComposeMixedJob(
        { ...manualDto, siteId: 'site-A' },
        { siteId: 'site-A' },
      );
      await completeCreatedJob();

      expect(webhookService.hasV2Config).toHaveBeenCalledWith('site-A');
      expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
      const [, , context] = webhookService.sendCallback.mock.calls[0];
      expect(context).toEqual({ siteId: 'site-A', env: undefined });
    });

    it('호출자 지정 callbackUrl(v1) 은 스탬프와 무관하게 종전대로 발신(무중단 확인)', async () => {
      await service.createComposeMixedJob({
        ...manualDto,
        siteId: 'site-VICTIM',
        callbackUrl: 'https://partner.example.com/hook',
      });
      await completeCreatedJob();

      // v1 게이트는 options.callbackUrl 단락이라 hasV2Config 조회조차 없다(기존 계약).
      expect(webhookService.hasV2Config).not.toHaveBeenCalled();
      expect(webhookService.sendCallback).toHaveBeenCalledTimes(1);
      const [url, , context] = webhookService.sendCallback.mock.calls[0];
      expect(url).toBe('https://partner.example.com/hook');
      // ⚠️ 발신 컨텍스트의 siteId 도 NULL — v2 재배달(tryDispatchForSite)이 위조 사이트로
      //    폴백하지 않는다.
      expect(context).toEqual({ siteId: null, env: undefined });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 5. [D6-ⓐ 2026-09-12] 검증된 사이트 키를 스탬프 권위로 인정
  //
  // 왜: 2026-08-13 위조 차단이 `body.siteId` 무검증 채택을 막으면서, **API 키 호출자가
  // 자기 잡에 siteId 를 붙일 수단이 남지 않았다**. 파트너 정규 경로(키 + body.siteId
  // 미전송)는 전건 NULL 스탬프가 되고, D6 NULL-파괴 게이트를 켜면 그 파트너의 산출물
  // 다운로드가 404 로 죽는다(RESUME 2026-09-11 §8-1 하드 블로커).
  //
  // 이 블록이 잠그는 계약:
  //  1. 키만 있고 body.siteId 가 없어도 **키 소유 사이트로 스탬프**(= 파트너 실제 호출 형태).
  //  2. 위조 차단은 유지 — 키와 다른 body.siteId / 타 테넌트 세션 / 상충 JWT 는 전부 NULL.
  //  3. 자동조립은 여전히 세션 권위 — 키로 덮어쓰지 않는다.
  //  4. 스탬프 근거가 늘어도 워커 입력(큐 페이로드)은 불변.
  // ────────────────────────────────────────────────────────────────────────
  describe('[D6-ⓐ] 검증된 사이트 키 = 스탬프 권위', () => {
    /** OptionalApiKeySiteGuard 가 복원해 주는 컨텍스트(컨트롤러가 3번째 인자로 전달) */
    const keyA = { siteId: 'site-A' };

    beforeEach(() => {
      // 기본: 세션은 존재하지만 소유 테넌트 정보 없음(= 상충 소유자 없음)
      editSessionRepository.findOne.mockResolvedValue({ id: 'sess-1', metadata: {} });
    });

    it('🔑 키만 + body.siteId 미전송 → 키 소유 사이트로 스탬프 (파트너 실제 호출 형태)', async () => {
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(createdJob().siteId).toBe('site-A');
    });

    it('키 + 일치하는 body.siteId → 채택', async () => {
      await service.createComposeMixedJob({ ...manualDto, siteId: 'site-A' }, undefined, keyA);
      expect(createdJob().siteId).toBe('site-A');
    });

    it('키 + editSessionId 미전달 → 채택(세션 대조 불가 = 상충 없음)', async () => {
      await service.createComposeMixedJob(
        { ...manualDto, editSessionId: undefined },
        undefined,
        keyA,
      );
      expect(createdJob().siteId).toBe('site-A');
    });

    it('키 + 세션 소유가 같은 테넌트 → 채택', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        id: 'sess-1',
        siteId: 'site-A',
        metadata: {},
      });
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(createdJob().siteId).toBe('site-A');
    });

    it('키 + 세션 siteId 가 NULL(레거시 무소유) → 채택 — 여기서 거부하면 정상 파트너가 깨진다', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        id: 'sess-1',
        siteId: null,
        metadata: {},
      });
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(createdJob().siteId).toBe('site-A');
    });

    it('키 + 세션 조회 실패(throw) → 채택(잡 생성 무중단, 기존 best-effort 계약)', async () => {
      editSessionRepository.findOne.mockRejectedValue(new Error('DB down'));
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(createdJob().siteId).toBe('site-A');
    });

    // ── 위조 차단은 그대로 유지된다 ──────────────────────────────────────
    it('🚫 키 + 불일치 body.siteId → NULL 스탬프(타 테넌트 주장 차단)', async () => {
      await service.createComposeMixedJob(
        { ...manualDto, siteId: 'site-VICTIM' },
        undefined,
        keyA,
      );
      expect(createdJob().siteId).toBeNull();
    });

    it('🚫 키 + 세션이 타 테넌트 소유 → NULL 스탬프(교차 테넌트 링크 차단)', async () => {
      editSessionRepository.findOne.mockResolvedValue({
        id: 'sess-1',
        siteId: 'site-VICTIM',
        metadata: {},
      });
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(createdJob().siteId).toBeNull();
    });

    it('🚫 키 + shop-session JWT 가 다른 테넌트 → NULL 스탬프(권위 상충)', async () => {
      await service.createComposeMixedJob({ ...manualDto }, { siteId: 'site-VICTIM' }, keyA);
      expect(createdJob().siteId).toBeNull();
    });

    it('키 없음 → 종전과 완전히 동일(NULL 스탬프, 회귀 없음)', async () => {
      await service.createComposeMixedJob({ ...manualDto, siteId: 'site-A' }, undefined, undefined);
      expect(createdJob().siteId).toBeNull();
    });

    // ── 자동조립 경로 무변경 ────────────────────────────────────────────
    it('자동조립 + 키 → 세션 권위가 이긴다(키로 덮어쓰지 않는다)', async () => {
      editSessionRepository.findOne.mockResolvedValue(sessionA);
      templateSetsService.findOne.mockResolvedValue(templateSetA4);
      await service.createComposeMixedJob(
        { assembleFromSession: true, editSessionId: 'sess-1', siteId: 'site-VICTIM' },
        { siteId: 'site-A' },
        { siteId: 'site-OTHER' },
      );
      expect(createdJob().siteId).toBe('site-A');
    });

    // ── 워커 입력 불변 ──────────────────────────────────────────────────
    it('키 스탬프는 큐 페이로드에 siteId 를 넣지 않는다(워커 입력 불변)', async () => {
      await service.createComposeMixedJob({ ...manualDto }, undefined, keyA);
      expect(queuePayload()).not.toHaveProperty('siteId');
    });
  });
});
