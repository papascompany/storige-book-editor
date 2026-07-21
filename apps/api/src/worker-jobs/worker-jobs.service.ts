import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
  Optional,
  Inject,
  forwardRef,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Repository } from 'typeorm';
import { Queue } from 'bull';
import { WorkerJob } from './entities/worker-job.entity';
import {
  WorkerJobType,
  WorkerJobStatus,
  SynthesisWebhookPayload,
  ValidationWebhookPayload,
  TemplateType,
  PageTypes,
} from '@storige/types';
import {
  CreateValidationJobDto,
  CreateConversionJobDto,
  CreatePageCountFixJobDto,
  CreateSynthesisJobDto,
  UpdateJobStatusDto,
} from './dto/worker-job.dto';
import { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';
import { ComposeMixedJobInput } from './dto/create-compose-mixed-job.dto';
import { CreateSpreadSynthesisJobDto } from './dto/create-spread-synthesis-job.dto';
import { CreateRenderPagesJobDto } from './dto/create-render-pages-job.dto';
import { CreateBleedFixJobDto } from './dto/create-bleed-fix-job.dto';
import {
  CheckMergeableDto,
  CheckMergeableResponseDto,
  MergeIssueDto,
} from './dto/check-mergeable.dto';
import * as fs from 'fs/promises';
import axios from 'axios';
import {
  isPrivateIp,
  isRemoteUrlPublic,
} from '../common/helpers/ssrf.helper';
import { FilesService } from '../files/files.service';
import { WebhookService } from '../webhook/webhook.service';
import { EditSessionEntity, WorkerStatus } from '../edit-sessions/entities/edit-session.entity';
import { SitesService } from '../sites/sites.service';
import { TemplateSetsService } from '../templates/template-sets.service';
import {
  PARTNER_ENV_TEST,
  PartnerEnv,
} from '../partner-api/partner-api.constants';
// [Stage 3 W3, #4] 최종화 콜백 역참조 — forwardRef 로 순환(books ⇄ worker-jobs) 차단.
import { BookFinalizationsService } from '../books/book-finalizations.service';
// R-44 — 표지 검증 잡 서버 spine 재계산(fail-closed 주입)
import { SpineService } from '../products/spine.service';

@Injectable()
export class WorkerJobsService implements OnModuleInit {
  private readonly logger = new Logger(WorkerJobsService.name);

  constructor(
    @InjectRepository(WorkerJob)
    private workerJobRepository: Repository<WorkerJob>,
    @InjectRepository(EditSessionEntity)
    private editSessionRepository: Repository<EditSessionEntity>,
    @InjectQueue('pdf-validation') private validationQueue: Queue,
    @InjectQueue('pdf-conversion') private conversionQueue: Queue,
    @InjectQueue('pdf-synthesis') private synthesisQueue: Queue,
    private filesService: FilesService,
    private webhookService: WebhookService,
    private sitesService: SitesService,
    // fix-bleed(2026-07-13) — templateSet 권위 editSize 산출용.
    private templateSetsService: TemplateSetsService,
    // [Stage 3 W3, #4] 최종화 콜백 역참조 — @Optional + forwardRef(순환 모듈 books ⇄ worker-jobs).
    //   updateJobStatus 가 options.finalizationId 마커 잡의 종결(COMPLETED/FIXABLE/FAILED) 시
    //   book_finalizations 상태머신을 전진시킨다(기존 edit_session 갱신과 병렬 additive 분기).
    //   ⚠️ 반드시 최후미 @Optional — 기존 9-인자 유닛스펙(callback-gate 등 7건)이 미주입
    //   (undefined)해도 finalization 분기는 no-op(서비스 존재 + options.finalizationId 이중 게이트).
    @Optional()
    @Inject(forwardRef(() => BookFinalizationsService))
    private readonly bookFinalizationsService?: BookFinalizationsService,
    // R-44(2026-07-21) — 표지 검증 잡 서버 spine 재계산(injectServerSpine).
    // ⚠️ 반드시 최후미 @Optional — 기존 positional 유닛스펙(9~10인자) 미주입 시
    // spine 주입만 no-op(클라 값 유지 = 기존 동작)로 격리. 미주입은 onModuleInit warn.
    @Optional()
    private readonly spineService?: SpineService,
  ) {}

  /**
   * [P1-1] 배선 실패 관측 — books ⇄ worker-jobs forwardRef 가 깨지면 @Optional 이
   * bookFinalizationsService 를 undefined 로 침묵 실체화해 finalization 마커 잡 콜백
   * (onWorkerJobSettled)이 영원히 no-op → finalization 이 VALIDATING/COMPOSING 에서 교착한다.
   * API 프로세스에선 반드시 주입돼야 하므로 미주입을 warn 으로 관측 가능하게 남긴다(침묵 마스킹
   * 방지). books 모듈을 로드하지 않는 워커 전용 프로세스라면 정상 — 그래서 @Optional 은 유지한다.
   */
  onModuleInit(): void {
    if (!this.bookFinalizationsService) {
      this.logger.warn(
        '[finalization] BookFinalizationsService 미주입 — books ⇄ worker-jobs forwardRef 배선을 ' +
          '확인하세요. finalization 마커 잡 콜백(onWorkerJobSettled)이 no-op 처리됩니다. ' +
          '(books 모듈을 로드하지 않는 워커 전용 프로세스라면 정상입니다.)',
      );
    }
    if (!this.spineService) {
      this.logger.warn(
        '[spine-inject] SpineService 미주입 — ProductsModule 배선을 확인하세요. ' +
          '표지 검증 잡의 서버 spine 재계산이 no-op(클라 값 유지) 처리됩니다.',
      );
    }
  }

  /**
   * [S2-5, 2026-07-16] test env 잡 마커 스탬프 — 잡 생성 옵션에 isTest:true 를
   * 조건부로 얹는다. env 는 컨트롤러가 @CurrentSite().env(=resolvePartnerEnv 해석값)로
   * 주입한 dto.partnerEnv — 미전달(내부/게스트/레거시)·'live' 는 그대로(키 자체가 없음
   * = 기존 잡 options 바이트 불변).
   *
   * ⚠️ 현 구조에서 잡 생성 external 라우트는 공용 ApiKeyGuard(sites 키=항상 live) 전용
   * 이라 v1 test 키(partner_api_keys)로는 인증 불가 — 이 스탬프는 **선행 인프라(no-op 훅)**
   * 이며 실발화는 Stage 3(v1 books 잡 생성 표면)이다. external 라우트에 v1 키 인증을
   * 추가하는 배선은 AD-1 위반으로 금지(로드맵 §6 Stage 2 작업 1).
   */
  private stampTestEnv<T extends Record<string, any>>(
    options: T,
    partnerEnv?: PartnerEnv,
  ): T | (T & { isTest: true }) {
    if (partnerEnv === PARTNER_ENV_TEST) {
      return { ...options, isTest: true as const };
    }
    return options;
  }

  /**
   * [S2-5] 잡 완료 웹훅 발신 컨텍스트용 env 해석 — isTest 잡만 'test', 그 외 undefined.
   * undefined 는 WebhookService.sendCallback 이 live 로 폴백(기존 발신 바이트 불변,
   * webhook-v1-invariance.spec 게이트).
   */
  private jobWebhookEnv(job: WorkerJob): PartnerEnv | undefined {
    return job.options?.isTest === true ? PARTNER_ENV_TEST : undefined;
  }

  /**
   * [S2-5] hasV2Config 게이트의 env-aware 래퍼 — isTest 잡만 test env config 로
   * 판정하고, 그 외(기존 전원)는 **기존과 동일한 단일 인자 호출**을 유지한다
   * (worker-jobs.callback-gate.spec 의 호출 계약 고정 — live 경로 완전 불변).
   */
  private hasV2ConfigForJob(
    job: WorkerJob,
    siteId?: string | null,
  ): Promise<boolean> {
    const env = this.jobWebhookEnv(job);
    return env
      ? this.webhookService.hasV2Config(siteId, env)
      : this.webhookService.hasV2Config(siteId);
  }

  /**
   * 워커 잡 입력용 파일 URL 해석. s3(R2) 백엔드 파일은 워커가 api://<fileId> 마커로
   * GET /files/:id/download/external 경유 다운로드(로컬/s3 무관). local 은 기존 filePath 그대로.
   */
  private toWorkerInputUrl(file: { id: string; storageBackend?: 'local' | 's3'; filePath: string }): string {
    return file.storageBackend === 's3' ? `api://${file.id}` : file.filePath;
  }

  /**
   * Phase B-2 — site 조회 + 잡 옵션 default 머지.
   * 호출자 옵션이 명시되어 있으면 우선, 누락된 항목만 site default로 채움.
   */
  private async mergeSiteWorkerDefaults(
    siteId: string | null | undefined,
    options: Record<string, any> | null | undefined,
  ): Promise<Record<string, any>> {
    const opts = { ...(options || {}) };

    // ⚠️ bleedMm/sizeToleranceMm 전역 기본값은 여기서 주입하지 않는다(2026-06-10 제거).
    //   큐 페이로드는 raw DTO 라 워커에 전달되지도 않았고(DB job.options 만 오염),
    //   워커 validatePageSize 의 '?? 1' 폴백을 무력화해 검증 허용오차가 전 상품
    //   1mm→0.2mm 로 좁아지는 회귀의 원인이 될 수 있다. 주입은 edit-sessions 가
    //   cropMarkEnabled===true(opt-in) 세션에만 수행한다.

    if (!siteId) return opts;

    try {
      const site = await this.sitesService.findOne(siteId);
      // 누락 항목만 site default로 채움 (호출자 명시값=templateSet 우선 보존)
      if (opts.applyBleed === undefined) opts.applyBleed = site.pdfConversionEnabled;
      if (opts.unit === undefined) opts.unit = site.defaultUnit;
      if (opts.checkWorkorder === undefined) opts.checkWorkorder = site.checkWorkorder;
      if (opts.checkCutting === undefined) opts.checkCutting = site.checkCutting;
      if (opts.checkSafezone === undefined) opts.checkSafezone = site.checkSafezone;
    } catch (e) {
      // site 조회 실패 시 silent (잡은 그대로 진행)
      this.logger.debug(
        `mergeSiteWorkerDefaults skip: ${(e as Error).message}`,
      );
    }
    return opts;
  }

  // ============================================================================
  // Merge Check (Dry-run)
  // ============================================================================

  /**
   * 병합 가능 여부 체크 (dry-run)
   * 실제 파일 생성 없이 병합 가능 여부만 확인
   *
   * @param site 호출 사이트 컨텍스트(X-API-Key 경유 시 컨트롤러가 주입) — Stage 0
   *   비대칭 봉합(2026-07-15). 현재는 감사 로깅·후속 스코핑용 전달만이며 **동작 불변**:
   *   worker_job 행을 만들지 않는 순수 조회라 스탬프 대상이 없고, 접근 차단/스코핑
   *   강제는 NULL-siteId 이원 정책(오너 결정 잔여 사안, CONTRACT_FREEZE §4.3) 확정
   *   전에는 도입하지 않는다(보수 기본값 — 기존 파트너 호출 응답 동일).
   */
  async checkMergeable(
    dto: CheckMergeableDto,
    site?: { siteId?: string; role?: string },
  ): Promise<CheckMergeableResponseDto> {
    if (site?.siteId) {
      // 감사 로깅(Stage 0) — 후속 스코핑 도입 시 근거 데이터
      this.logger.log(
        `checkMergeable called by site=${site.siteId} (editSessionId=${dto.editSessionId})`,
      );
    }
    const issues: MergeIssueDto[] = [];

    // 1. 표지 파일 존재 확인
    let coverUrl = dto.coverUrl;
    if (dto.coverFileId) {
      try {
        const coverFile = await this.filesService.findById(dto.coverFileId);
        coverUrl = coverFile.filePath;
      } catch {
        issues.push({
          code: 'COVER_FILE_NOT_FOUND',
          message: '표지 파일을 찾을 수 없습니다.',
        });
      }
    }

    // 2. 내지 파일 존재 확인
    let contentUrl = dto.contentUrl;
    if (dto.contentFileId) {
      try {
        const contentFile = await this.filesService.findById(dto.contentFileId);
        contentUrl = contentFile.filePath;
      } catch {
        issues.push({
          code: 'CONTENT_FILE_NOT_FOUND',
          message: '내지 파일을 찾을 수 없습니다.',
        });
      }
    }

    // 3. 파일 URL 필수 체크
    if (!coverUrl && !dto.coverFileId) {
      issues.push({
        code: 'COVER_URL_REQUIRED',
        message: '표지 URL 또는 파일 ID가 필요합니다.',
      });
    }

    if (!contentUrl && !dto.contentFileId) {
      issues.push({
        code: 'CONTENT_URL_REQUIRED',
        message: '내지 URL 또는 파일 ID가 필요합니다.',
      });
    }

    // 4. 파일 접근 가능 여부 확인 (실제 존재 여부)
    if (coverUrl && issues.filter(i => i.code.startsWith('COVER_')).length === 0) {
      const coverAccessible = await this.checkFileAccessible(coverUrl);
      if (!coverAccessible) {
        issues.push({
          code: 'COVER_FILE_INACCESSIBLE',
          message: '표지 파일에 접근할 수 없습니다.',
        });
      }
    }

    if (contentUrl && issues.filter(i => i.code.startsWith('CONTENT_')).length === 0) {
      const contentAccessible = await this.checkFileAccessible(contentUrl);
      if (!contentAccessible) {
        issues.push({
          code: 'CONTENT_FILE_INACCESSIBLE',
          message: '내지 파일에 접근할 수 없습니다.',
        });
      }
    }

    // 5. 책등 폭 유효성 체크
    if (dto.spineWidth < 0) {
      issues.push({
        code: 'INVALID_SPINE_WIDTH',
        message: '책등 폭은 0 이상이어야 합니다.',
      });
    }

    this.logger.log(
      `Check mergeable for session ${dto.editSessionId}: ${issues.length === 0 ? 'OK' : issues.map(i => i.code).join(', ')}`,
    );

    return {
      mergeable: issues.length === 0,
      issues: issues.length > 0 ? issues : undefined,
    };
  }

  /**
   * 파일 접근 가능 여부 확인.
   * WH-002: 원격 URL 분기에 SSRF 가드 추가 — http/https 만 허용(file://·dict://·gopher:// 차단),
   * DNS 해석 후 사설/링크로컬/루프백 IP(169.254 메타데이터 포함) 차단, maxRedirects:0 으로
   * 리다이렉트 우회 차단. 정당 흐름은 fileId→로컬경로(아래 fs.access 분기)라 원격 분기 미진입.
   */
  private async checkFileAccessible(url: string): Promise<boolean> {
    try {
      if (url.startsWith('/') || url.startsWith('./')) {
        // 로컬 파일
        await fs.access(url);
        return true;
      } else {
        // 원격 URL — SSRF 검증 후에만 HEAD 요청
        if (!(await this.isRemoteUrlSafe(url))) {
          this.logger.warn(`[checkFileAccessible] Blocked unsafe remote URL: ${url}`);
          return false;
        }
        const response = await axios.head(url, { timeout: 5000, maxRedirects: 0 });
        return response.status === 200;
      }
    } catch {
      return false;
    }
  }

  /**
   * SSRF 방어: http/https 스킴 + DNS 해석 결과가 사설/링크로컬/루프백이 아닌 경우만 true.
   * 로직은 공용 유틸(common/helpers/ssrf.helper)로 이전 — webhook 발신 가드와 단일 출처.
   * (인스턴스 메서드 유지: 기존 ssrf.spec 이 `svc.isRemoteUrlSafe` 를 호출.)
   */
  private async isRemoteUrlSafe(raw: string): Promise<boolean> {
    return isRemoteUrlPublic(raw);
  }

  /** 사설/링크로컬/루프백 IP 판정 — 공용 유틸 위임(단일 출처). */
  private isPrivateIp(ip: string): boolean {
    return isPrivateIp(ip);
  }

  // ============================================================================
  // Validation Jobs
  // ============================================================================

  async createValidationJob(createValidationJobDto: CreateValidationJobDto): Promise<WorkerJob> {
    // fileId 또는 fileUrl 중 하나는 필수
    if (!createValidationJobDto.fileId && !createValidationJobDto.fileUrl) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'fileId 또는 fileUrl 중 하나를 제공해야 합니다.',
      });
    }

    // fileId로 파일 경로 조회
    let fileUrl = createValidationJobDto.fileUrl;
    let fileId = createValidationJobDto.fileId;

    if (fileId) {
      const file = await this.filesService.findById(fileId);
      fileUrl = this.toWorkerInputUrl(file); // s3 백엔드면 api://<id> 마커, local 은 filePath
    }

    // Phase B-2 — site default 머지 (호출자 명시값 보존)
    const orderOptions = await this.mergeSiteWorkerDefaults(
      createValidationJobDto.siteId,
      createValidationJobDto.orderOptions,
    );

    // R-44 — 표지 잡은 서버가 spine 을 재계산해 덮어씀(fail-closed, B-2 원칙).
    await this.injectServerSpine(createValidationJobDto.fileType, orderOptions);

    // Create job record in database
    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.VALIDATE,
      status: WorkerJobStatus.PENDING,
      editSessionId: createValidationJobDto.editSessionId || null,
      fileId,
      inputFileUrl: fileUrl,
      siteId: createValidationJobDto.siteId || null, // Phase C
      // [S2-5] test env 컨텍스트면 isTest:true 스탬프(live/미전달=키 없음, 기존 불변).
      // 검증 잡은 실검증을 그대로 수행(읽기 전용·경량) — isTest 는 완료 웹훅 v2 발신의
      // env 판정(페이로드 isTest)에만 쓰인다. 더미 분기는 합성 잡 전용(로드맵 §6).
      options: this.stampTestEnv(
        {
          fileType: createValidationJobDto.fileType,
          orderOptions,
          callbackUrl: createValidationJobDto.callbackUrl || undefined,
          // [Stage 3 W3] finalization 역참조 마커(#4) — 부재=기존 옵션 바이트 불변(conditional spread)
          ...(createValidationJobDto.finalizationId
            ? { finalizationId: createValidationJobDto.finalizationId }
            : {}),
        },
        createValidationJobDto.partnerEnv,
      ),
    });

    const savedJob = await this.workerJobRepository.save(job);

    // Add to Bull queue
    // R-44(2026-07-21): raw DTO 가 아니라 **머지본**을 싣는다 — 종전엔 site default
    // 머지(B-2)와 서버 spine 주입이 DB job.options 에만 남고 워커에는 raw 가 가서
    // silent 미적용이었다(백로그 "검증 잡 큐 site-default 머지 미적용 의심" 실확정).
    await this.validationQueue.add('validate-pdf', {
      jobId: savedJob.id,
      fileId,
      fileUrl,
      fileType: createValidationJobDto.fileType,
      orderOptions,
    });

    return savedJob;
  }

  /**
   * R-44 — 표지(cover) 검증 잡의 서버 spine 재계산 주입.
   *
   * 클라(spineWidthMm)를 신뢰하지 않고 pageCount/paperType/binding 으로 서버가
   * 재산출해 덮어쓴다(가격 recompute 와 동일한 fail-closed 철학). 원본 클라 값은
   * clientSpineWidthMm 로 보존(대조 계측). SOFT 정책:
   *  - v2 산출 성공 → 덮어씀(spineSource='server'), 클라·서버 불일치는 warn 계측
   *  - 지종 미해석/오류(SPINE_PARAMS_UNRESOLVED) 또는 v1 폴백 → 클라 값 유지(현행 동작)
   *    — HARD 승격(차단)은 관찰기간 후 별도 게이트.
   */
  private async injectServerSpine(
    fileType: string,
    // mergeSiteWorkerDefaults 반환형(Record) 수용 — 필드 접근은 DTO orderOptions 계약 기준
    orderOptions: Partial<CreateValidationJobDto['orderOptions']> & Record<string, any>,
  ): Promise<void> {
    if (!orderOptions) return;
    // F2(스탬프 선소독): spineSource/clientSpineWidthMm 은 서버 전유 필드 —
    // orderOptions 가 @IsObject 단독(중첩 무검증)이라 호출자가 위조 전송 가능하므로
    // 모든 경로(비cover·미주입·v1 폴백·예외 포함)에서 무조건 소거하고, 'server'
    // 스탬프는 아래 성공 경로만 재발급한다(감사 판별 1:1 보장).
    delete orderOptions.spineSource;
    delete orderOptions.clientSpineWidthMm;
    if (fileType !== 'cover' || !this.spineService) return;
    const binding = orderOptions.binding as string;
    if (binding !== 'perfect' && binding !== 'hardcover') return;
    const { paperType, pages } = orderOptions;
    if (!paperType || typeof pages !== 'number' || pages < 1) return;

    try {
      const r = await this.spineService.calculate({
        pageCount: pages,
        paperType,
        bindingType: binding,
      });
      if (r.formulaVersion !== 'v2') {
        // v1 폴백(legacy 8코드 등)은 bookmoa 골든과 다른 값 — 클라 값을 덮지 않는다.
        this.logger.warn(
          `[spine-inject] 지종 '${paperType}' v2 두께 미보유(v1 폴백) — 클라 spineWidthMm 유지`,
        );
        return;
      }
      const client = orderOptions.spineWidthMm;
      if (typeof client === 'number' && Math.abs(client - r.spineWidth) > 0.01) {
        // warn 레벨 유지 — 클라 vs 서버 불일치 계측(관찰기간 mismatch율 리뷰용)
        this.logger.warn(
          `[spine-inject] 클라 spineWidthMm ${client} ≠ 서버 ${r.spineWidth}mm ` +
            `(${binding}/${paperType}/${pages}p) — 서버 권위값으로 교체`,
        );
      }
      orderOptions.clientSpineWidthMm = client;
      orderOptions.spineWidthMm = r.spineWidth;
      orderOptions.spineSource = 'server';
    } catch (error) {
      this.logger.warn(
        `[spine-inject] SPINE_PARAMS_UNRESOLVED: '${paperType}'/${binding} 재계산 실패 ` +
          `(${error.message}) — 클라 값 유지(SOFT)`,
      );
    }
  }

  // ============================================================================
  // Conversion Jobs
  // ============================================================================

  async createConversionJob(createConversionJobDto: CreateConversionJobDto): Promise<WorkerJob> {
    // fileId 또는 fileUrl 중 하나는 필수
    if (!createConversionJobDto.fileId && !createConversionJobDto.fileUrl) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'fileId 또는 fileUrl 중 하나를 제공해야 합니다.',
      });
    }

    // fileId로 파일 경로 조회
    let fileUrl = createConversionJobDto.fileUrl;
    let fileId = createConversionJobDto.fileId;

    if (fileId) {
      const file = await this.filesService.findById(fileId);
      fileUrl = this.toWorkerInputUrl(file); // s3 백엔드면 api://<id> 마커, local 은 filePath
    }

    // Phase B-2 — site default 머지
    const convertOptions = await this.mergeSiteWorkerDefaults(
      createConversionJobDto.siteId,
      createConversionJobDto.convertOptions,
    );

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
      // P4 — 임포지션 결과 콜백이 세션을 역참조하도록 edit_session_id 세팅(relation 경유).
      //   editSessionId 컬럼은 insert:false 라 relation 객체로만 설정 가능. 미지정이면 null(기존 convert 동작 보존).
      editSession: createConversionJobDto.editSessionId
        ? ({ id: createConversionJobDto.editSessionId } as EditSessionEntity)
        : null,
      fileId,
      inputFileUrl: fileUrl,
      siteId: createConversionJobDto.siteId || null, // Phase C
      options: convertOptions,
    });

    const savedJob = await this.workerJobRepository.save(job);

    await this.conversionQueue.add('convert-pdf', {
      jobId: savedJob.id,
      fileId,
      fileUrl,
      // 큐 페이로드는 raw DTO convertOptions 그대로(현행 동작 보존 — admin 자동수정 경로 무변경).
      // P4 임포지션은 호출부가 editSize/sizeToleranceMm 를 명시 전달하므로 raw 로 충분.
      // (DB job.options 는 merged 저장 — 기존과 동일.)
      convertOptions: createConversionJobDto.convertOptions,
    });

    return savedJob;
  }

  /**
   * 페이지수 배수 보정 잡 (fix-pagecount, 2026-06-25) — 데이터 주도 검증 d1 빈페이지 추가 실행기.
   * pdf-conversion(addPages) 재사용: convertOptions.padToMultiple 로 현재 페이지수를 배수까지 백지 보정.
   * 비동기 — 반환 WorkerJob(jobId) 폴링 → COMPLETED 시 updateJobStatus 가 결과를 새 fileId 로 등록
   * (options.kind='pagecount-fix' 게이트, 원본 site/order 승계). 원본 fileId 는 보존(되돌리기 가능).
   */
  async createPageCountFixJob(dto: CreatePageCountFixJobDto): Promise<WorkerJob> {
    if (!dto.fileId) {
      throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'fileId 가 필요합니다.' });
    }
    const targetMultiple = Math.floor(Number(dto.targetMultiple));
    if (!Number.isFinite(targetMultiple) || targetMultiple < 1) {
      throw new BadRequestException({
        code: 'INVALID_MULTIPLE',
        message: 'targetMultiple 은 1 이상의 정수여야 합니다.',
      });
    }

    const file = await this.filesService.findById(dto.fileId);
    const fileUrl = this.toWorkerInputUrl(file); // s3 백엔드면 api://<id>, local 은 filePath

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
      fileId: dto.fileId,
      inputFileUrl: fileUrl,
      siteId: dto.siteId || null,
      // kind 마커 → updateJobStatus 완료 훅이 결과를 fileId 로 등록(세션 무관). sourceFileId=원본 승계용.
      options: {
        kind: 'pagecount-fix',
        sourceFileId: dto.fileId,
        targetMultiple,
        callbackUrl: dto.callbackUrl || undefined,
      },
    });
    const savedJob = await this.workerJobRepository.save(job);

    await this.conversionQueue.add('convert-pdf', {
      jobId: savedJob.id,
      fileId: dto.fileId,
      fileUrl,
      convertOptions: {
        addPages: false,
        applyBleed: false,
        targetPages: 0,
        bleed: 0,
        padToMultiple: targetMultiple, // 현재 페이지수 → 다음 배수까지 백지 보정(addPages 재사용)
      },
    });

    return savedJob;
  }

  /**
   * 도련 자동 삽입 잡 (fix-bleed, 2026-07-13) — BLEED_MISSING(extendBleed) 실행기.
   * 고객이 재단 사이즈(=templateSet 판형, 예 297×210)로 업로드한 PDF 를 작업 사이즈
   * (판형 + 사방 bleedMm×2, 예 303×216)로 변환한 **새 파일**을 만든다.
   *
   * pdf-conversion(convert-pdf) 재사용: convertOptions 에 editSize/sizeToleranceMm 만 주입,
   * mode 미지정 → 워커 resolveMode 가 실측 vs editSize±tol 로 자체결정
   * (재단 사이즈 업로드=작음 → 'center' 무스케일 중앙 배치 = 정확히 사방 bleedMm 확장.
   *  이미 작업 사이즈=passthrough / 더 큼=innerfit — 전부 안전한 기존 워커 경로, 워커 무수정).
   *
   * editSize 는 서버가 templateSetId 로 권위 산출 — @Public 라우트의 임의 사이즈 입력 차단.
   * 비동기 — 반환 WorkerJob(jobId) 폴링(GET /worker-jobs/:id) → COMPLETED 시 updateJobStatus 가
   * 결과를 새 fileId 로 등록(options.kind='bleed-fix' 게이트, 원본 site 승계). 원본 fileId 보존.
   *
   * ⚠️ editSessionId 절대 미주입 — 세션 workerStatus 상태기계 오염 방지
   *    (inner-imposition 의 스푸리어스 webhook 적발 이력 참조, updateJobStatus 상단 주석).
   */
  async createBleedFixJob(dto: CreateBleedFixJobDto): Promise<WorkerJob> {
    // 1) templateSet 권위 산출 — 미존재는 클라이언트 입력 오류로 400 (@Public 계약).
    let editSize: { width: number; height: number };
    let sizeToleranceMm: number;
    try {
      const templateSet = await this.templateSetsService.findOne(dto.templateSetId);
      const bleedMm = templateSet.bleedMm ?? 3;
      sizeToleranceMm = templateSet.sizeToleranceMm ?? 0.2;
      // 작업(work) 사이즈 = 재단(판형) + 사방 블리드*2 (createInnerPdfImpositionJob 과 동일 규약)
      editSize = {
        width: templateSet.width + bleedMm * 2,
        height: templateSet.height + bleedMm * 2,
      };
    } catch (err) {
      // P2-4(2026-07-13 리뷰): NotFoundException(미존재)만 400 TEMPLATE_SET_NOT_FOUND 로
      // 매핑. 종전 catch-all 은 DB 단절 등 인프라 예외까지 '클라이언트 입력 오류(400)'로
      // 뭉개 원인 은폐 — 그 외 예외는 rethrow(전역 필터가 5xx 로 처리).
      if (err instanceof NotFoundException) {
        throw new BadRequestException({
          code: 'TEMPLATE_SET_NOT_FOUND',
          message: `템플릿셋을 찾을 수 없습니다: ${dto.templateSetId}`,
        });
      }
      throw err;
    }
    if (!(editSize.width > 0) || !(editSize.height > 0)) {
      throw new BadRequestException({
        code: 'INVALID_WORK_SIZE',
        message: `작업 사이즈 산출 불가(판형/bleed 무효): ${editSize.width}x${editSize.height}mm`,
      });
    }

    // 2) 파일 존재(미존재 404 — fix-pagecount 동형) + PDF mime 검증.
    const file = await this.filesService.findById(dto.fileId);
    if (!(file.mimeType ?? '').toLowerCase().includes('pdf')) {
      throw new BadRequestException({
        code: 'FILE_NOT_PDF',
        message: 'PDF 파일만 도련 보정이 가능합니다.',
        details: { fileId: dto.fileId, mimeType: file.mimeType },
      });
    }
    const fileUrl = this.toWorkerInputUrl(file); // s3 백엔드면 api://<id>, local 은 filePath

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
      // ⚠️ editSessionId/editSession 미주입(위 주석) — 세션 상태기계·웹훅 경로 완전 비켜감.
      fileId: dto.fileId,
      inputFileUrl: fileUrl,
      siteId: file.siteId ?? null, // 원본 파일 site 승계(게스트 업로드는 null)
      // kind 마커 → updateJobStatus 완료 훅이 결과를 새 fileId 로 등록(세션 무관).
      options: {
        kind: 'bleed-fix',
        sourceFileId: dto.fileId,
        templateSetId: dto.templateSetId,
        editSize,
        sizeToleranceMm,
      },
    });
    const savedJob = await this.workerJobRepository.save(job);

    await this.conversionQueue.add('convert-pdf', {
      jobId: savedJob.id,
      fileId: dto.fileId,
      fileUrl,
      convertOptions: {
        // mode 미지정 → 워커 resolveMode 자체결정 (inner-imposition 과 동일 계약).
        editSize,
        sizeToleranceMm,
      },
    });

    return savedJob;
  }

  // ============================================================================
  // Render Pages Jobs — 내지 PDF 표시전용 가이드 (2026-06-07)
  // ============================================================================

  /**
   * 내지 PDF 각 페이지를 이미지로 래스터화하는 잡 생성.
   * 산출 result.pageImageUrls 를 편집기가 underlay 잠금 가이드로 로드.
   * ⚠️ 표시 전용 — 최종 인쇄엔 미반영(워커 content.pdf 는 첨부 원본 그대로).
   * pdf-conversion 큐 공유(render-pdf-pages 잡명).
   */
  async createRenderPagesJob(dto: CreateRenderPagesJobDto): Promise<WorkerJob> {
    if (!dto.fileId && !dto.fileUrl) {
      throw new BadRequestException({
        code: 'FILE_REQUIRED',
        message: 'fileId 또는 fileUrl 중 하나를 제공해야 합니다.',
      });
    }

    let fileUrl = dto.fileUrl;
    const fileId = dto.fileId;
    if (fileId) {
      const file = await this.filesService.findById(fileId);
      fileUrl = this.toWorkerInputUrl(file); // s3 백엔드면 api://<id> 마커, local 은 filePath
    }

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.RENDER_PAGES,
      status: WorkerJobStatus.PENDING,
      editSessionId: dto.editSessionId || null,
      fileId: fileId || null,
      inputFileUrl: fileUrl,
      siteId: dto.siteId || null,
      options: { fileId, fileUrl, pageCount: dto.pageCount },
    });

    const savedJob = await this.workerJobRepository.save(job);

    await this.conversionQueue.add('render-pdf-pages', {
      jobId: savedJob.id,
      fileUrl,
      sourceFileId: fileId,
      pageCount: dto.pageCount,
    });

    return savedJob;
  }

  // ============================================================================
  // Synthesis Jobs
  // ============================================================================

  async createSynthesisJob(createSynthesisJobDto: CreateSynthesisJobDto): Promise<WorkerJob> {
    // 표지: coverFileId 또는 coverUrl 중 하나는 필수
    if (!createSynthesisJobDto.coverFileId && !createSynthesisJobDto.coverUrl) {
      throw new BadRequestException({
        code: 'COVER_FILE_REQUIRED',
        message: 'coverFileId 또는 coverUrl 중 하나를 제공해야 합니다.',
      });
    }

    // 내지: contentFileId 또는 contentUrl 중 하나는 필수
    if (!createSynthesisJobDto.contentFileId && !createSynthesisJobDto.contentUrl) {
      throw new BadRequestException({
        code: 'CONTENT_FILE_REQUIRED',
        message: 'contentFileId 또는 contentUrl 중 하나를 제공해야 합니다.',
      });
    }

    // 파일 경로 조회
    let coverUrl = createSynthesisJobDto.coverUrl;
    let contentUrl = createSynthesisJobDto.contentUrl;
    const coverFileId = createSynthesisJobDto.coverFileId;
    const contentFileId = createSynthesisJobDto.contentFileId;

    if (coverFileId) {
      const coverFile = await this.filesService.findById(coverFileId);
      coverUrl = this.toWorkerInputUrl(coverFile); // s3 백엔드면 api://<id> 마커, local 은 filePath
    }

    if (contentFileId) {
      const contentFile = await this.filesService.findById(contentFileId);
      contentUrl = this.toWorkerInputUrl(contentFile); // s3 백엔드면 api://<id> 마커, local 은 filePath
    }

    const outputFormat = createSynthesisJobDto.outputFormat || 'merged';

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: createSynthesisJobDto.editSessionId || null,
      fileId: coverFileId, // 대표 파일로 표지 사용
      inputFileUrl: coverUrl,
      siteId: createSynthesisJobDto.siteId || null, // Phase C
      // [S2-5] test env 컨텍스트면 isTest:true 스탬프 — 워커가 실합성 대신 TEST
      // 워터마크 더미 산출 + outputs 24h retention 대상. live/미전달=키 없음(기존 불변).
      options: this.stampTestEnv(
        {
          coverFileId,
          contentFileId,
          coverUrl,
          contentUrl,
          spineWidth: createSynthesisJobDto.spineWidth,
          orderId: createSynthesisJobDto.orderId,
          callbackUrl: createSynthesisJobDto.callbackUrl,
          outputFormat, // 출력 형식 저장
          // [Stage 3 W3] finalization 역참조 마커(#4) — 부재=기존 옵션 바이트 불변(conditional spread)
          ...(createSynthesisJobDto.finalizationId
            ? { finalizationId: createSynthesisJobDto.finalizationId }
            : {}),
        },
        createSynthesisJobDto.partnerEnv,
      ),
    });

    const savedJob = await this.workerJobRepository.save(job);

    // 우선순위 설정
    const jobOptions: { priority?: number } = {};
    if (createSynthesisJobDto.priority === 'high') {
      jobOptions.priority = 1;
    } else if (createSynthesisJobDto.priority === 'low') {
      jobOptions.priority = 10;
    } else {
      jobOptions.priority = 5; // normal
    }

    await this.synthesisQueue.add(
      'synthesize-pdf',
      {
        jobId: savedJob.id,
        coverFileId,
        contentFileId,
        coverUrl,
        contentUrl,
        spineWidth: createSynthesisJobDto.spineWidth,
        orderId: createSynthesisJobDto.orderId,
        callbackUrl: createSynthesisJobDto.callbackUrl,
        outputFormat, // 출력 형식 전달
        bindingType: createSynthesisJobDto.bindingType, // 제본 방식 (saddle 등) — synthesizer가 분기 처리
        // [S2-5] 큐 페이로드는 명시 구성이라 isTest 직렬화 등재 필요 — isTest 잡에만
        // conditional spread(live 잡 페이로드 키 집합 불변, external-site-stamp spec 계약 준용).
        ...(createSynthesisJobDto.partnerEnv === PARTNER_ENV_TEST
          ? { isTest: true as const }
          : {}),
      },
      jobOptions,
    );

    this.logger.log(
      `Synthesis job created: ${savedJob.id}, orderId: ${createSynthesisJobDto.orderId || 'N/A'}, priority: ${createSynthesisJobDto.priority || 'normal'}, format: ${outputFormat}`,
    );

    return savedJob;
  }

  // ============================================================================
  // Compose-mixed Jobs — 인쇄 워크플로우 v1 Phase 5 (2026-05-19)
  // ============================================================================

  /**
   * Compose-mixed 잡 생성 — [표지, 앞면지N, 내지, 뒷면지K] 합본 PDF 생성.
   *
   * 기존 synthesis / split / spread 흐름과 분리된 별도 mode.
   * PHP 기존 호출 경로 회귀 보호 (mode='compose-mixed' 만 신규 worker handler 사용).
   */
  async createComposeMixedJob(dto: ComposeMixedJobInput): Promise<WorkerJob> {
    // P0-3: 스프레드 책 무결성 — 세션의 출력재현 단일소스(metadata.spread)를 조회해
    //  ① 워커 cover MediaBox 검증용 기대치(totalWidthMm/HeightMm/dpi)를 큐로 push,
    //  ② 확정 비즈니스 규칙(스프레드 책 = cover.pdf + content.pdf "분리 2파일")에 맞춰
    //     outputMode 를 'separate' 로 강제(편집기 펼침면 cover 가 출력에서 누락되지 않도록).
    //  best-effort: 조회 실패/세션부재/스냅샷부재 시 검증·강제 미적용으로 자연 통과(잡 생성 무중단).
    let composeSpreadTotalWidthMm: number | undefined;
    let composeSpreadTotalHeightMm: number | undefined;
    let composeSpreadDpi: number | undefined;
    // D-4 (2026-07-06, C-4 Track 3): 하드커버 싸바리 등 '출력(wrap 포함) 사이즈'가 화면 trim 과
    // 다른 상품의 cover 검증 기대치. 세션 metadata.spread.outputWidthMm/outputHeightMm(mm, Track 1
    // 합의 인터페이스)를 내부 큐 metadata 로만 additive push — 워커 external DTO 표면 불변.
    // 부재 시 기존 totalWidthMm 검증과 100% 동일(output 우선·total 폴백).
    let composeSpreadOutputWidthMm: number | undefined;
    let composeSpreadOutputHeightMm: number | undefined;
    let effectiveOutputMode = dto.outputMode;
    try {
      if (dto.editSessionId) {
        const sess = await this.editSessionRepository.findOne({
          where: { id: dto.editSessionId },
        });
        const sp = (sess?.metadata as any)?.spread;
        if (sp?.totalWidthMm && sp?.totalHeightMm) {
          composeSpreadTotalWidthMm = sp.totalWidthMm;
          composeSpreadTotalHeightMm = sp.totalHeightMm;
          composeSpreadDpi = sp.dpi ?? 300;
          // 스프레드 책은 표지/내지 분리 2파일이 기본(합본·single 금지). coverEditable 인 경우만.
          if (dto.coverEditable !== false && effectiveOutputMode !== 'separate') {
            this.logger.log(
              `[compose-mixed] spread book ${dto.editSessionId}: outputMode '${effectiveOutputMode}' → 'separate' 강제(분리 2파일 규칙)`,
            );
            effectiveOutputMode = 'separate';
          }
        }
        // D-4: output 사이즈는 total 게이트와 독립적으로 읽는다(배포 순서 무관 안전).
        //  둘 다 양수 number 일 때만 유효 — 한쪽만 있으면 무시(기존 동작 유지).
        if (
          typeof sp?.outputWidthMm === 'number' && sp.outputWidthMm > 0 &&
          typeof sp?.outputHeightMm === 'number' && sp.outputHeightMm > 0
        ) {
          composeSpreadOutputWidthMm = sp.outputWidthMm;
          composeSpreadOutputHeightMm = sp.outputHeightMm;
          composeSpreadDpi = composeSpreadDpi ?? (sp.dpi ?? 300);
        }
      }
    } catch (e) {
      this.logger.warn(
        `[compose-mixed] spread 스냅샷 조회 skip(잡 생성은 계속): ${(e as Error).message}`,
      );
    }

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: dto.editSessionId || null,
      inputFileUrl: dto.coverUrl || dto.contentPdfUrl || null,
      siteId: dto.siteId || null,
      // [S2-5] test env 컨텍스트면 isTest:true 스탬프 — 워커가 실합성(compose-mixed) 대신
      // TEST 워터마크 더미(handleTestSynthesis compose-mixed 분기) 산출 + outputs 24h retention.
      // live/미전달(external sites 키)=키 없음 → 기존 옵션 바이트 불변(compose-mixed.spec 계약).
      options: this.stampTestEnv(
        {
          capability: 'compose-mixed',
          editSessionId: dto.editSessionId,
          coverUrl: dto.coverUrl,
          coverEditable: dto.coverEditable !== false,
          coverWidthMm: dto.coverWidthMm,
          coverHeightMm: dto.coverHeightMm,
          frontEndpaperUrls: dto.frontEndpaperUrls ?? [],
          backEndpaperUrls: dto.backEndpaperUrls ?? [],
          contentPdfUrl: dto.contentPdfUrl,
          contentWidthMm: dto.contentWidthMm,
          contentHeightMm: dto.contentHeightMm,
          orderId: dto.orderId,
          callbackUrl: dto.callbackUrl,
          outputMode: effectiveOutputMode,
          spreadTotalWidthMm: composeSpreadTotalWidthMm,
          spreadTotalHeightMm: composeSpreadTotalHeightMm,
          spreadDpi: composeSpreadDpi,
          // D-4: 출력(wrap 포함) 사이즈 기대치 — additive, 부재=기존 total 검증
          spreadOutputWidthMm: composeSpreadOutputWidthMm,
          spreadOutputHeightMm: composeSpreadOutputHeightMm,
          // [Stage 3 W3] finalization 역참조 마커(#4) — 부재=기존 옵션 바이트 불변(conditional spread)
          ...(dto.finalizationId ? { finalizationId: dto.finalizationId } : {}),
        },
        dto.partnerEnv,
      ),
    });
    const savedJob = await this.workerJobRepository.save(job);

    await this.synthesisQueue.add(
      'synthesize-pdf',
      {
        jobId: savedJob.id,
        mode: 'compose-mixed',
        composeCoverUrl: dto.coverUrl,
        composeCoverEditable: dto.coverEditable !== false,
        composeCoverWidthMm: dto.coverWidthMm,
        composeCoverHeightMm: dto.coverHeightMm,
        composeFrontEndpaperUrls: dto.frontEndpaperUrls ?? [],
        composeBackEndpaperUrls: dto.backEndpaperUrls ?? [],
        composeContentPdfUrl: dto.contentPdfUrl,
        composeContentWidthMm: dto.contentWidthMm,
        composeContentHeightMm: dto.contentHeightMm,
        composeOutputMode: effectiveOutputMode,
        // P0-3: 스프레드 cover MediaBox 검증 기대치(세션 metadata.spread). 부재=비스프레드 → 워커 검증 skip.
        composeSpreadTotalWidthMm,
        composeSpreadTotalHeightMm,
        composeSpreadDpi,
        // D-4: 출력(싸바리 wrap 포함) 사이즈 기대치 — output 우선·total 폴백(additive, 내부 큐 전용)
        composeSpreadOutputWidthMm,
        composeSpreadOutputHeightMm,
        callbackUrl: dto.callbackUrl,
        // [S2-5] isTest 잡에만 conditional spread — live 잡 페이로드 키 집합 불변
        // (createSynthesisJob/createSplitSynthesisJob 큐 페이로드 계약 준용). 워커
        // handleSynthesis 가 job.data.isTest===true → handleTestSynthesis(compose-mixed 분기).
        ...(dto.partnerEnv === PARTNER_ENV_TEST ? { isTest: true as const } : {}),
      },
      { priority: 5 },
    );

    this.logger.log(
      `Compose-mixed job created: ${savedJob.id} (front=${(dto.frontEndpaperUrls ?? []).length}, back=${(dto.backEndpaperUrls ?? []).length}, coverEditable=${dto.coverEditable !== false}, outputMode=${effectiveOutputMode}, spread=${!!composeSpreadTotalWidthMm}, spreadOutput=${!!composeSpreadOutputWidthMm})`,
    );

    return savedJob;
  }

  // ============================================================================
  // Split Synthesis Jobs (단일 PDF 분리)
  // ============================================================================

  /**
   * 분리 합성 작업 생성 (★ v1.1.4 설계서 기준)
   *
   * 단일 PDF에서 표지/내지를 분리하는 작업
   * - pdfFileId: 업로드된 PDF 파일 ID (pdfUrl 완전 제거)
   * - sessionId: EditSession ID (pageTypes 추출용)
   * - requestId: 멱등성 키 (클라이언트 UUID)
   */
  async createSplitSynthesisJob(dto: CreateSplitSynthesisJobDto): Promise<WorkerJob> {
    // 0. ★ 멱등성 체크 (requestId required)
    const existingJob = await this.workerJobRepository.findOne({
      where: {
        sessionId: dto.sessionId,
        pdfFileId: dto.pdfFileId,
        requestId: dto.requestId,
      },
    });
    if (existingJob) {
      this.logger.log(
        `Idempotent hit: returning existing job ${existingJob.id} for requestId=${dto.requestId}`,
      );
      return existingJob;
    }

    // 0-1. ★ 옵션 조합 검증 (INVALID_OUTPUT_OPTIONS)
    const outputFormat = dto.outputFormat ?? 'merged';
    const alsoGenerateMerged = dto.alsoGenerateMerged ?? false;

    if (outputFormat === 'merged' && alsoGenerateMerged === true) {
      throw new BadRequestException({
        code: 'INVALID_OUTPUT_OPTIONS',
        message: "outputFormat='merged' 일 때 alsoGenerateMerged는 사용할 수 없습니다.",
      });
    }

    // 1. EditSession 조회
    const session = await this.editSessionRepository.findOne({
      where: { id: dto.sessionId },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'EditSession을 찾을 수 없습니다.',
      });
    }

    // 2. PDF 파일 조회 + 검증 (★ pdfUrl 제거, pdfFileId로 조회)
    const file = await this.filesService.findById(dto.pdfFileId);
    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
      });
    }

    // 2-1. ★ 편집기 산출물 검증
    if (file.metadata?.generatedBy !== 'editor') {
      throw new BadRequestException({
        code: 'PDF_NOT_FROM_EDITOR',
        message: '편집기에서 생성된 PDF만 지원합니다.',
      });
    }

    // 2-2. ★ session-file 일치 검증 (400, 계약 위반)
    if (file.metadata?.editSessionId !== dto.sessionId) {
      throw new BadRequestException({
        code: 'SESSION_FILE_MISMATCH',
        message: '세션과 파일이 일치하지 않습니다.',
      });
    }

    // 3. ★ 빈 세션 검증 (pages 존재 확인)
    // 페이지 정보는 canvasData 또는 metadata에 저장됨
    const pages = session.metadata?.pages || session.canvasData?.pages || [];
    if (pages.length === 0) {
      throw new UnprocessableEntityException({
        code: 'EMPTY_SESSION_PAGES',
        message: '세션에 페이지가 없습니다.',
      });
    }

    // 3-1. ★ sortOrder 무결성 검증 (중복/누락/타입/연속성 오류 방어)
    const sortOrders = pages.map((p: any) => p.sortOrder);
    const n = sortOrders.length;

    // 검증 조건:
    // 1. 모든 값이 정수
    // 2. 모든 값이 0 이상
    // 3. 중복 없음 (Set 크기 == 배열 길이)
    // 4. ★ 연속성: min === 0, max === n-1 (0..n-1 범위 강제)
    const allIntegers = sortOrders.every(
      (o: any) => typeof o === 'number' && Number.isInteger(o) && o >= 0,
    );
    const uniqueSet = new Set(sortOrders);
    const noDuplicates = uniqueSet.size === n;
    const minOrder = Math.min(...sortOrders);
    const maxOrder = Math.max(...sortOrders);
    const isContiguous = minOrder === 0 && maxOrder === n - 1;

    if (!allIntegers || !noDuplicates || !isContiguous) {
      throw new UnprocessableEntityException({
        code: 'INVALID_SORT_ORDER',
        message: 'sortOrder가 유효하지 않습니다 (중복/누락/비정수/비연속).',
      });
    }

    // 4. sortOrder ASC 기준으로 정렬 (★ 연속성 강제로 동률 불가능)
    const sortedPages = [...pages].sort((a: any, b: any) => a.sortOrder - b.sortOrder);

    // 5. ★ pageTypes 배열 생성 (객체 대신 배열 권장)
    const pageTypes: PageTypes = sortedPages.map((page: any) =>
      page.templateType === TemplateType.PAGE ? 'content' : 'cover',
    );

    // 6. cover/content 존재성 검증
    if (!pageTypes.includes('cover')) {
      throw new UnprocessableEntityException({
        code: 'NO_COVER_PAGES',
        message: '표지 페이지가 없습니다.',
      });
    }
    if (!pageTypes.includes('content')) {
      throw new UnprocessableEntityException({
        code: 'NO_CONTENT_PAGES',
        message: '내지 페이지가 없습니다.',
      });
    }

    // 7. WorkerJob 생성 (★ pdfUrl 대신 pdfFileId + sessionId)
    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: dto.sessionId,
      sessionId: dto.sessionId,
      pdfFileId: dto.pdfFileId,
      requestId: dto.requestId,
      siteId: dto.siteId || null, // Phase C — Stage 0 비대칭 봉합(validate/external 준용). 미전달=NULL(기존 동작 불변)
      // [S2-5] test env 컨텍스트면 isTest:true 스탬프 — createSynthesisJob 주석 참조.
      options: this.stampTestEnv(
        {
          mode: 'split',
          pageTypes,
          totalExpectedPages: sortedPages.length,
          outputFormat,
          alsoGenerateMerged,
          callbackUrl: dto.callbackUrl,
        },
        dto.partnerEnv,
      ),
    });

    // ★ Race condition 방어: unique violation 시 기존 job 반환
    let savedJob: WorkerJob;
    try {
      savedJob = await this.workerJobRepository.save(job);
    } catch (error: any) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.workerJobRepository.findOne({
          where: {
            sessionId: dto.sessionId,
            pdfFileId: dto.pdfFileId,
            requestId: dto.requestId,
          },
        });
        if (existing) {
          this.logger.log(
            `Race condition resolved: returning existing job ${existing.id}`,
          );
          return existing;
        }
      }
      throw error;
    }

    // 8. Bull Queue에 추가 (★ mode: 'split' 필수)
    const jobOptions: { priority?: number } = {};
    if (dto.priority === 'high') {
      jobOptions.priority = 1;
    } else if (dto.priority === 'low') {
      jobOptions.priority = 10;
    } else {
      jobOptions.priority = 5;
    }

    await this.synthesisQueue.add(
      'synthesize-pdf',
      {
        jobId: savedJob.id,
        mode: 'split', // ★ 필수: handleSynthesis()에서 분기 기준
        sessionId: dto.sessionId,
        pdfFileId: dto.pdfFileId,
        pageTypes,
        totalExpectedPages: sortedPages.length,
        outputFormat,
        alsoGenerateMerged,
        callbackUrl: dto.callbackUrl,
        // [S2-5] isTest 잡에만 conditional spread — live 잡 페이로드 키 집합 불변
        // (external-site-stamp spec "큐 페이로드 불변" 계약 준용).
        ...(dto.partnerEnv === PARTNER_ENV_TEST ? { isTest: true as const } : {}),
      },
      jobOptions,
    );

    this.logger.log(
      `Split synthesis job created: ${savedJob.id}, sessionId=${dto.sessionId}, ` +
        `pages=${sortedPages.length}, format=${outputFormat}, priority=${dto.priority || 'normal'}`,
    );

    return savedJob;
  }

  /**
   * Duplex-split 합성 작업 생성 — 2026-06-09 (TemplateSet.pdfOutputMode='duplex-split').
   *
   * 단일/낱장 양면 상품의 편집기 산출 단일 PDF(앞,뒤,앞,뒤… 순서)를
   * 앞/뒤 한 세트(각 2페이지)씩 잘라 개별 PDF n개로 분리한다.
   *
   * 기존 split(cover/content 분리) 머신을 재사용하지 않고 별도 mode로 분기하는 이유:
   *  split 은 pageTypes(cover/content) 기준 "2파일" 분리이고, duplex-split 은
   *  2페이지씩 "n파일" 그룹핑이라 산출 형태가 다르기 때문. 큐/프로세서/synthesizer
   *  다운로드·copyPages 프리미티브는 동일하게 재사용한다.
   *
   * - pdfFileId: 편집기가 업로드한 단일 PDF(보통 session.coverFileId)
   * - sessionId: EditSession ID (편집기 산출물 + 세션 일치 이중 검증용)
   * - requestId: 멱등성 키
   */
  async createDuplexSplitJob(dto: {
    sessionId: string;
    pdfFileId: string;
    requestId: string;
    callbackUrl?: string;
    priority?: 'high' | 'normal' | 'low';
  }): Promise<WorkerJob> {
    // 0. 멱등성 체크 (split/spread 와 동일 unique 인덱스 사용)
    const existingJob = await this.workerJobRepository.findOne({
      where: {
        sessionId: dto.sessionId,
        pdfFileId: dto.pdfFileId,
        requestId: dto.requestId,
      },
    });
    if (existingJob) {
      this.logger.log(
        `Idempotent hit: returning existing duplex-split job ${existingJob.id} for requestId=${dto.requestId}`,
      );
      return existingJob;
    }

    // 1. EditSession 조회
    const session = await this.editSessionRepository.findOne({
      where: { id: dto.sessionId },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'EditSession을 찾을 수 없습니다.',
      });
    }

    // 2. PDF 파일 조회 + 편집기 산출물 / 세션 일치 검증 (split 과 동일 계약)
    const file = await this.filesService.findById(dto.pdfFileId);
    if (!file) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '파일을 찾을 수 없습니다.',
      });
    }
    if (file.metadata?.generatedBy !== 'editor') {
      throw new BadRequestException({
        code: 'PDF_NOT_FROM_EDITOR',
        message: '편집기에서 생성된 PDF만 지원합니다.',
      });
    }
    if (file.metadata?.editSessionId !== dto.sessionId) {
      throw new BadRequestException({
        code: 'SESSION_FILE_MISMATCH',
        message: '세션과 파일이 일치하지 않습니다.',
      });
    }

    // 3. 페이지 수(=세트 수×2) 산출. metadata.pages → canvasData.pages 순으로 조회.
    //    실제 PDF 페이지 수 검증은 워커(handleDuplexSplitSynthesis)에서 최종 수행한다.
    const pages = session.metadata?.pages || session.canvasData?.pages || [];
    const totalExpectedPages = pages.length;
    if (totalExpectedPages === 0) {
      throw new UnprocessableEntityException({
        code: 'EMPTY_SESSION_PAGES',
        message: '세션에 페이지가 없습니다.',
      });
    }
    if (totalExpectedPages % 2 !== 0) {
      // 양면(앞/뒤) 세트 구성 불가 — 짝수만 허용.
      throw new UnprocessableEntityException({
        code: 'ODD_PAGE_COUNT',
        message: `duplex-split은 짝수 페이지만 지원합니다 (현재 ${totalExpectedPages}쪽).`,
      });
    }

    // 4. WorkerJob 생성
    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: dto.sessionId,
      sessionId: dto.sessionId,
      pdfFileId: dto.pdfFileId,
      requestId: dto.requestId,
      options: {
        mode: 'duplex-split',
        totalExpectedPages,
        callbackUrl: dto.callbackUrl,
      },
    });

    // Race condition 방어 (split/spread 와 동일)
    let savedJob: WorkerJob;
    try {
      savedJob = await this.workerJobRepository.save(job);
    } catch (error: any) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.workerJobRepository.findOne({
          where: {
            sessionId: dto.sessionId,
            pdfFileId: dto.pdfFileId,
            requestId: dto.requestId,
          },
        });
        if (existing) {
          this.logger.log(
            `Race condition resolved: returning existing duplex-split job ${existing.id}`,
          );
          return existing;
        }
      }
      throw error;
    }

    // 5. Bull Queue에 추가 (mode: 'duplex-split' 필수 — 워커 분기 기준)
    const jobOptions: { priority?: number } = {};
    if (dto.priority === 'high') {
      jobOptions.priority = 1;
    } else if (dto.priority === 'low') {
      jobOptions.priority = 10;
    } else {
      jobOptions.priority = 5;
    }

    await this.synthesisQueue.add(
      'synthesize-pdf',
      {
        jobId: savedJob.id,
        mode: 'duplex-split',
        sessionId: dto.sessionId,
        pdfFileId: dto.pdfFileId,
        totalExpectedPages,
        callbackUrl: dto.callbackUrl,
      },
      jobOptions,
    );

    this.logger.log(
      `Duplex-split job created: ${savedJob.id}, sessionId=${dto.sessionId}, ` +
        `pages=${totalExpectedPages} (${totalExpectedPages / 2} sets), priority=${dto.priority || 'normal'}`,
    );

    return savedJob;
  }

  /**
   * 스프레드 합성 작업 생성
   * - spreadPdfFileId: 스프레드 PDF (1페이지)
   * - contentPdfFileIds: 내지 PDF들 (순서대로 병합)
   * - sessionId: EditSession ID (스냅샷 검증용)
   * - requestId: 멱등성 키
   */
  async createSpreadSynthesisJob(dto: CreateSpreadSynthesisJobDto): Promise<WorkerJob> {
    // 0. 멱등성 체크
    const existingJob = await this.workerJobRepository.findOne({
      where: {
        sessionId: dto.sessionId,
        pdfFileId: dto.spreadPdfFileId, // spreadPdfFileId를 pdfFileId로 저장
        requestId: dto.requestId,
      },
    });
    if (existingJob) {
      this.logger.log(
        `Idempotent hit: returning existing spread job ${existingJob.id} for requestId=${dto.requestId}`,
      );
      return existingJob;
    }

    // 0-1. outputFormat 고정 검증 (spread 모드는 항상 separate)
    const outputFormat = dto.outputFormat ?? 'separate';
    if (outputFormat !== 'separate') {
      throw new BadRequestException({
        code: 'INVALID_OUTPUT_FORMAT',
        message: 'spread 모드는 outputFormat=separate만 지원합니다.',
      });
    }

    // 1. EditSession 조회
    const session = await this.editSessionRepository.findOne({
      where: { id: dto.sessionId },
    });
    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'EditSession을 찾을 수 없습니다.',
      });
    }

    // 2. 스프레드 PDF 파일 조회 + 검증
    const spreadFile = await this.filesService.findById(dto.spreadPdfFileId);
    if (!spreadFile) {
      throw new NotFoundException({
        code: 'FILE_NOT_FOUND',
        message: '스프레드 PDF 파일을 찾을 수 없습니다.',
      });
    }

    if (spreadFile.metadata?.generatedBy !== 'editor') {
      throw new BadRequestException({
        code: 'PDF_NOT_FROM_EDITOR',
        message: '편집기에서 생성된 PDF만 지원합니다.',
      });
    }

    if (spreadFile.metadata?.editSessionId !== dto.sessionId) {
      throw new BadRequestException({
        code: 'SESSION_FILE_MISMATCH',
        message: '스프레드 PDF와 세션이 일치하지 않습니다.',
      });
    }

    // 3. 내지 PDF 파일들 조회 + 검증
    // DB-003: 루프 내 findById(N+1)를 In() 배치 1회로 치환. 미존재 시 findById 와 동일한
    // NotFoundException(FILE_NOT_FOUND, details.fileId)을 던져 기존 reachable 동작 보존
    // (기존 코드의 per-file 메시지 블록은 findById 가 먼저 throw 해 도달 불가했음).
    const _contentFiles = await this.filesService.findManyByIds(dto.contentPdfFileIds);
    for (const fileId of dto.contentPdfFileIds) {
      const contentFile = _contentFiles.get(fileId);
      if (!contentFile) {
        throw new NotFoundException({
          code: 'FILE_NOT_FOUND',
          message: '파일을 찾을 수 없습니다.',
          details: { fileId },
        });
      }

      if (contentFile.metadata?.generatedBy !== 'editor') {
        throw new BadRequestException({
          code: 'PDF_NOT_FROM_EDITOR',
          message: '편집기에서 생성된 PDF만 지원합니다.',
        });
      }

      if (contentFile.metadata?.editSessionId !== dto.sessionId) {
        throw new BadRequestException({
          code: 'SESSION_FILE_MISMATCH',
          message: `내지 PDF와 세션이 일치하지 않습니다: ${fileId}`,
        });
      }
    }

    // 4. WorkerJob 생성
    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: dto.sessionId,
      sessionId: dto.sessionId,
      pdfFileId: dto.spreadPdfFileId, // spreadPdfFileId를 pdfFileId로 저장
      requestId: dto.requestId,
      options: {
        mode: 'spread',
        spreadPdfFileId: dto.spreadPdfFileId,
        contentPdfFileIds: dto.contentPdfFileIds,
        totalExpectedPages: 1 + dto.contentPdfFileIds.length, // spread 1p + content Np
        outputFormat: 'separate',
        alsoGenerateMerged: dto.alsoGenerateMerged ?? false,
        callbackUrl: dto.callbackUrl,
      },
    });

    // Race condition 방어
    let savedJob: WorkerJob;
    try {
      savedJob = await this.workerJobRepository.save(job);
    } catch (error: any) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.workerJobRepository.findOne({
          where: {
            sessionId: dto.sessionId,
            pdfFileId: dto.spreadPdfFileId,
            requestId: dto.requestId,
          },
        });
        if (existing) {
          this.logger.log(
            `Race condition resolved: returning existing spread job ${existing.id}`,
          );
          return existing;
        }
      }
      throw error;
    }

    // 5. Bull Queue에 추가
    const jobOptions: { priority?: number } = {};
    if (dto.priority === 'high') {
      jobOptions.priority = 1;
    } else if (dto.priority === 'low') {
      jobOptions.priority = 10;
    } else {
      jobOptions.priority = 5;
    }

    await this.synthesisQueue.add(
      'synthesize-pdf',
      {
        jobId: savedJob.id,
        mode: 'spread',
        sessionId: dto.sessionId,
        spreadPdfFileId: dto.spreadPdfFileId,
        contentPdfFileIds: dto.contentPdfFileIds,
        totalExpectedPages: 1 + dto.contentPdfFileIds.length,
        outputFormat: 'separate',
        alsoGenerateMerged: dto.alsoGenerateMerged ?? false,
        callbackUrl: dto.callbackUrl,
      },
      jobOptions,
    );

    this.logger.log(
      `Spread synthesis job created: ${savedJob.id}, sessionId=${dto.sessionId}, ` +
        `spreadPdf=${dto.spreadPdfFileId}, contentPdfs=${dto.contentPdfFileIds.length}, ` +
        `priority=${dto.priority || 'normal'}`,
    );

    return savedJob;
  }

  /**
   * DB unique violation 체크 (DB 중립적)
   */
  private isUniqueViolation(error: any): boolean {
    // MySQL: ER_DUP_ENTRY (1062)
    // PostgreSQL: 23505
    // SQLite: SQLITE_CONSTRAINT_UNIQUE
    const code = error.code || error.errno;
    return (
      code === 'ER_DUP_ENTRY' ||
      code === '23505' ||
      code === 1062 ||
      error.message?.includes('UNIQUE constraint failed')
    );
  }

  // ============================================================================
  // Job Management
  // ============================================================================

  async findAll(
    status?: WorkerJobStatus,
    jobType?: WorkerJobType,
    siteId?: string, // Phase C-3
    limit?: number, // DB-016: 무제한 getMany OOM 방지
  ): Promise<WorkerJob[]> {
    const query = this.workerJobRepository.createQueryBuilder('job');

    if (status) {
      query.andWhere('job.status = :status', { status });
    }

    if (jobType) {
      query.andWhere('job.jobType = :jobType', { jobType });
    }

    if (siteId) {
      query.andWhere('job.siteId = :siteId', { siteId });
    }

    // DB-016: 잡이 수만 건 누적되면 단일 요청으로 전체를 메모리 적재 → OOM/타임아웃.
    // 최신순 정렬 후 상한(기본 200, 1~1000 클램프)으로 자른다. 배열 반환형 불변(admin Table 호환).
    const take = Math.min(Math.max(Number(limit) || 200, 1), 1000);
    return await query.orderBy('job.createdAt', 'DESC').take(take).getMany();
  }

  /**
   * P2c S-3 테넌트 격리 — 외부(API Key) 호출자의 잡 접근 검증.
   * - worker 역할(내부/사이트 워커): 잡 처리·상태콜백 위해 바이패스(잡 site 무관, 내부 WORKER_API_KEY=Default Site).
   * - editor 역할(테넌트): 잡 site 가 NULL(공유/레거시) 또는 자기 site 일 때만 허용.
   * - 불일치는 not-found 와 **동일한 404** 로 던져 존재 오라클을 차단.
   * - caller 미지정(내부 in-process 호출)은 검사 생략(불변).
   */
  private assertJobSiteAccess(
    job: WorkerJob,
    caller?: { siteId?: string; role?: string },
  ): void {
    if (!caller || caller.role === 'worker') return;
    if (job.siteId && job.siteId !== caller.siteId) {
      throw new NotFoundException(`Worker job with ID ${job.id} not found`);
    }
  }

  async findOne(
    id: string,
    caller?: { siteId?: string; role?: string },
  ): Promise<WorkerJob> {
    const job = await this.workerJobRepository.findOne({ where: { id } });

    if (!job) {
      throw new NotFoundException(`Worker job with ID ${id} not found`);
    }

    this.assertJobSiteAccess(job, caller);

    return job;
  }

  async updateJobStatus(
    id: string,
    updateJobStatusDto: UpdateJobStatusDto,
    caller?: { siteId?: string; role?: string },
  ): Promise<WorkerJob> {
    const job = await this.workerJobRepository.findOne({
      where: { id },
      relations: ['editSession'],
    });

    if (!job) {
      throw new NotFoundException(`Worker job with ID ${id} not found`);
    }

    this.assertJobSiteAccess(job, caller);

    Object.assign(job, updateJobStatusDto);

    if (
      updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
      updateJobStatusDto.status === WorkerJobStatus.FIXABLE ||
      updateJobStatusDto.status === WorkerJobStatus.FAILED
    ) {
      job.completedAt = new Date();
    }

    const savedJob = await this.workerJobRepository.save(job);

    // Update EditSession workerStatus and send webhook callback
    //   ⚠️ 임포지션 잡(CONVERT + purpose='inner-imposition')은 세션 검증상태 추적 대상이 아니다.
    //   editSessionId 는 결과 되연결 역참조 용도일 뿐이므로, workerStatus 오염/스푸리어스 webhook
    //   (session.validated)을 피하려 이 경로에서 제외한다. 일반 validation/synthesis 흐름은 무영향.
    const isInnerImpositionJob =
      job.jobType === WorkerJobType.CONVERT &&
      job.options?.purpose === 'inner-imposition';
    if (job.editSessionId && !isInnerImpositionJob) {
      await this.updateEditSessionWorkerStatus(job, updateJobStatusDto);
    }

    // Synthesis 작업 완료/실패 시 콜백 전송
    // [Stage 2 P1-1] 게이트 = "callbackUrl 존재 OR v2 config(opt-in) 존재".
    // hasV2Config 는 callbackUrl 부재 시에만 평가(|| 단락)되고, v2 비활성
    // (WEBHOOK_CONFIG_ENC_KEY 미설정)이면 DB 조회 없이 false — callbackUrl 없는
    // 잡은 기존과 완전 동일하게 스킵되며 추가 DB 조회도 없다(불변 조건).
    if (
      job.jobType === WorkerJobType.SYNTHESIZE &&
      // [Stage 3 W3] finalization 내부 잡은 book.finalization.* 만 발신 — 중간 synthesis.*
      //   억제(파트너에 내부 오케스트레이션 단계 누출 방지). 마커 부재=기존 파트너 잡(불변).
      !job.options?.finalizationId &&
      (updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
        updateJobStatusDto.status === WorkerJobStatus.FAILED) &&
      (job.options?.callbackUrl ||
        // [S2-5] isTest 잡만 test env config 로 게이트 판정(기존 잡은 기존 호출 그대로)
        (await this.hasV2ConfigForJob(job, job.siteId)))
    ) {
      await this.sendSynthesisCallback(savedJob);
    }

    // Validation 작업 완료/수정필요/실패 시 직접 콜백 전송 (editSessionId 없이 callbackUrl만 있는 경우)
    // [Stage 2 P1-1] 위 synthesis 게이트와 동일 정합화 — v2 opt-in 사이트는
    // callbackUrl 없이도 발신 도달 가능해야 한다(종전엔 callbackUrl 선차단으로
    // sendValidationCallback 내부 v2 분기가 죽은 코드였음).
    if (
      job.jobType === WorkerJobType.VALIDATE &&
      // [Stage 3 W3] finalization 내부 validate 잡은 book.finalization.* 만 발신 —
      //   중간 validation.* 억제. 마커 부재=기존 잡(불변).
      !job.options?.finalizationId &&
      (updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
        updateJobStatusDto.status === WorkerJobStatus.FIXABLE ||
        updateJobStatusDto.status === WorkerJobStatus.FAILED) &&
      (job.options?.callbackUrl ||
        // [S2-5] isTest 잡만 test env config 로 게이트 판정(기존 잡은 기존 호출 그대로)
        (await this.hasV2ConfigForJob(job, job.siteId)))
    ) {
      await this.sendValidationCallback(savedJob);
    }

    // P4 (2026-06-10) — 내지 임포지션 결과를 세션에 되연결 (best-effort, 마커 게이트).
    //   조건: CONVERT 잡 && options.purpose==='inner-imposition' && COMPLETED && outputFileUrl 존재.
    //   마커가 없는 일반 convert(admin 자동수정 등)는 절대 개입하지 않음 → 기존 동작 무영향.
    if (
      job.jobType === WorkerJobType.CONVERT &&
      job.options?.purpose === 'inner-imposition' &&
      updateJobStatusDto.status === WorkerJobStatus.COMPLETED
    ) {
      await this.relinkImposedInnerPdf(savedJob);
    }

    // fix-pagecount(2026-06-25) — 배수 보정 결과(converted PDF)를 새 fileId 로 등록(세션 무관).
    //   조건: CONVERT && options.kind==='pagecount-fix' && COMPLETED. 마커 없는 일반 convert 무영향.
    //   호출측(파트너)은 GET /worker-jobs/:id 폴링 → outputFileId 로 보정본을 사용한다.
    if (
      job.jobType === WorkerJobType.CONVERT &&
      job.options?.kind === 'pagecount-fix' &&
      updateJobStatusDto.status === WorkerJobStatus.COMPLETED
    ) {
      await this.registerPageCountFixOutput(savedJob);
    }

    // fix-bleed(2026-07-13) — 도련 삽입 결과(converted PDF)를 새 fileId 로 등록(세션 무관).
    //   조건: CONVERT && options.kind==='bleed-fix' && COMPLETED. 마커 없는 일반 convert 무영향.
    //   호출측(편집기 모달)은 GET /worker-jobs/:id 폴링 → outputFileId 로 보정본을 사용한다.
    if (
      job.jobType === WorkerJobType.CONVERT &&
      job.options?.kind === 'bleed-fix' &&
      updateJobStatusDto.status === WorkerJobStatus.COMPLETED
    ) {
      await this.registerBleedFixOutput(savedJob);
    }

    // [Stage 3 W3, #4] books finalization 역참조 — options.finalizationId 마커 잡 종결 시
    //   book_finalizations 상태머신 전진(VALIDATING→COMPOSING→COMPLETED / FAILED). 이중 게이트:
    //   @Optional 서비스 미주입(기존 9-인자 유닛스펙 7건)·마커 부재(기존 파트너/세션 잡)면 no-op —
    //   기존 edit_session 갱신 경로와 병렬 additive(기존 경로 완전 불변).
    if (
      this.bookFinalizationsService &&
      job.options?.finalizationId &&
      (updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
        updateJobStatusDto.status === WorkerJobStatus.FIXABLE ||
        updateJobStatusDto.status === WorkerJobStatus.FAILED)
    ) {
      // [렌즈2 P2-4] 콜백 예외 격리 — onWorkerJobSettled 가 throw 해도 워커 PATCH 는 성공
      //   반환한다(기존 edit_session 갱신·발신 경로 불변). 미격리 시 워커가 500 → 잡 재시도
      //   폭주 + compose 중복. finalization 자체 FAILED 전이는 onWorkerJobSettled 내부에서
      //   시도되므로(이중 방어) 여기선 로깅만 하고 삼킨다.
      try {
        await this.bookFinalizationsService.onWorkerJobSettled(savedJob);
      } catch (err) {
        this.logger.error(
          `[finalization] onWorkerJobSettled 예외 격리(job=${savedJob.id}): ${(err as Error).message}`,
          (err as Error).stack,
        );
      }
    }

    return savedJob;
  }

  /**
   * 페이지수 보정(fix-pagecount) 완료 결과를 새 File 로 등록하고 job.outputFileId 에 기록 (2026-06-25).
   * inner-imposition 의 relinkImposedInnerPdf 와 동일 패턴이되 **세션 되연결 없이** 등록만 — 직접 업로드
   * 파일은 세션이 없기 때문. 원본 fileId(sourceFileId) 의 order/member/site 를 승계. best-effort(throw 금지).
   */
  private async registerPageCountFixOutput(job: WorkerJob): Promise<void> {
    try {
      const outputFileUrl: string | undefined =
        job.outputFileUrl ||
        (job.result as any)?.outputFileUrl ||
        (job.result as any)?.result?.outputFileUrl;

      if (!outputFileUrl) {
        this.logger.warn(`[fix-pagecount] job ${job.id}: outputFileUrl 없음 → 등록 스킵`);
        return;
      }
      if (job.outputFileId) return; // 멱등(중복 등록 방지)

      const sourceFileId: string | undefined = job.options?.sourceFileId;
      let orderSeqno: number | null = null;
      let memberSeqno: number | null = null;
      try {
        if (sourceFileId) {
          const src = await this.filesService.findById(sourceFileId);
          orderSeqno = (src.orderSeqno as number) ?? null;
          memberSeqno = (src.memberSeqno as number) ?? null;
        }
      } catch {
        // 원본 메타 승계 실패는 무시(등록 자체는 계속)
      }

      const registered = await this.filesService.registerExternalFile(outputFileUrl, {
        orderSeqno,
        memberSeqno,
        siteId: job.siteId, // 원본 잡 site 승계(외부 라우트 격리)
        metadata: {
          generatedBy: 'worker-pagecount-fix',
          sourceFileId: sourceFileId ?? null,
          targetMultiple: job.options?.targetMultiple ?? null,
          workerJobId: job.id,
        },
      });

      try {
        job.outputFileId = registered.id;
        await this.workerJobRepository.save(job);
      } catch (e) {
        this.logger.warn(
          `[fix-pagecount] job ${job.id} outputFileId 기록 실패(무중단): ${(e as Error).message}`,
        );
      }

      this.logger.log(
        `[fix-pagecount] job ${job.id} 완료 → outputFileId=${registered.id} (배수 ${job.options?.targetMultiple})`,
      );
    } catch (e) {
      this.logger.error(
        `[fix-pagecount] job ${job.id} 결과 등록 실패(무중단): ${(e as Error).message}`,
      );
    }
  }

  /**
   * 도련 삽입(fix-bleed) 완료 결과를 새 File 로 등록하고 job.outputFileId 에 기록 (2026-07-13).
   * registerPageCountFixOutput 동형 — **세션 되연결 없이** 등록만(잡에 editSessionId 자체가 없음).
   * 원본 fileId(sourceFileId) 의 order/member 승계 + 잡 site 승계. 원본 파일은 보존(되돌리기 가능).
   * best-effort(throw 금지) — status 업데이트(이미 저장됨)를 되돌리지 않는다.
   */
  private async registerBleedFixOutput(job: WorkerJob): Promise<void> {
    try {
      const outputFileUrl: string | undefined =
        job.outputFileUrl ||
        (job.result as any)?.outputFileUrl ||
        (job.result as any)?.result?.outputFileUrl;

      if (!outputFileUrl) {
        this.logger.warn(`[fix-bleed] job ${job.id}: outputFileUrl 없음 → 등록 스킵`);
        return;
      }
      if (job.outputFileId) return; // 멱등(중복 등록 방지)

      const sourceFileId: string | undefined = job.options?.sourceFileId;
      let orderSeqno: number | null = null;
      let memberSeqno: number | null = null;
      try {
        if (sourceFileId) {
          const src = await this.filesService.findById(sourceFileId);
          orderSeqno = (src.orderSeqno as number) ?? null;
          memberSeqno = (src.memberSeqno as number) ?? null;
        }
      } catch {
        // 원본 메타 승계 실패는 무시(등록 자체는 계속)
      }

      const registered = await this.filesService.registerExternalFile(outputFileUrl, {
        orderSeqno,
        memberSeqno,
        siteId: job.siteId, // 원본 잡 site 승계(외부 라우트 격리)
        metadata: {
          generatedBy: 'worker-bleed-fix',
          sourceFileId: sourceFileId ?? null,
          templateSetId: job.options?.templateSetId ?? null,
          editSize: job.options?.editSize ?? null,
          workerJobId: job.id,
        },
      });

      try {
        job.outputFileId = registered.id;
        await this.workerJobRepository.save(job);
      } catch (e) {
        this.logger.warn(
          `[fix-bleed] job ${job.id} outputFileId 기록 실패(무중단): ${(e as Error).message}`,
        );
      }

      this.logger.log(
        `[fix-bleed] job ${job.id} 완료 → outputFileId=${registered.id} (editSize ${job.options?.editSize?.width}x${job.options?.editSize?.height}mm)`,
      );
    } catch (e) {
      this.logger.error(
        `[fix-bleed] job ${job.id} 결과 등록 실패(무중단): ${(e as Error).message}`,
      );
    }
  }

  /**
   * P4 — 임포지션 완료 결과(converted PDF)를 세션 contentPdfFileId 로 되연결 (2026-06-10).
   *
   * 동작:
   *  1) 워커 산출 outputFileUrl 을 File 레코드로 등록(이미 outputFileId 가 세팅돼 있으면 재사용).
   *  2) 해당 세션의 contentPdfFileId 를 그 결과 파일로 재포인팅.
   *     → 원본 업로드 PDF 는 본 잡의 inputFileUrl/별도 File 레코드로 보존(되돌리기 가능).
   *  3) metadata.innerPdfImposition 에 결과(resultFileId/outputFileUrl/relinkedAt) 스냅샷 추가.
   *
   * ⚠️ best-effort: 어떤 실패도 status 업데이트(이미 저장됨)를 되돌리지 않는다(throw 금지, 로그만).
   *    재포인팅 실패 시 downstream 은 원본 contentPdfFileId 를 계속 사용(현행 동작과 동일 — 안전한 degrade).
   */
  private async relinkImposedInnerPdf(job: WorkerJob): Promise<void> {
    try {
      const outputFileUrl: string | undefined =
        job.outputFileUrl ||
        job.result?.outputFileUrl ||
        job.result?.result?.outputFileUrl;

      if (!outputFileUrl) {
        this.logger.warn(
          `[inner-imposition] job ${job.id} COMPLETED 이나 outputFileUrl 부재 → 되연결 스킵(원본 유지)`,
        );
        return;
      }

      // 세션 역참조 — edit_session_id 컬럼 우선, 없으면 마커(options.editSessionId) 폴백.
      const sessionId = job.editSessionId || job.options?.editSessionId;
      if (!sessionId) {
        this.logger.warn(
          `[inner-imposition] job ${job.id} 세션 역참조 불가(editSessionId 부재) → 되연결 스킵`,
        );
        return;
      }

      const session = await this.editSessionRepository.findOne({
        where: { id: sessionId },
      });
      if (!session) {
        this.logger.warn(
          `[inner-imposition] job ${job.id}: 세션 ${sessionId} 미발견 → 되연결 스킵`,
        );
        return;
      }

      // 1) 결과 File 등록 (이미 outputFileId 세팅 시 재사용 — 멱등성/중복등록 방지)
      let resultFileId = job.outputFileId;
      if (!resultFileId) {
        const sourceFileId: string | undefined = job.options?.sourceFileId;
        let orderSeqno: number | null = null;
        let memberSeqno: number | null = null;
        try {
          if (sourceFileId) {
            const src = await this.filesService.findById(sourceFileId);
            orderSeqno = (src.orderSeqno as number) ?? null;
            memberSeqno = (src.memberSeqno as number) ?? null;
          }
        } catch {
          // 원본 메타 승계 실패는 무시 (등록 자체는 계속)
        }

        const registered = await this.filesService.registerExternalFile(outputFileUrl, {
          orderSeqno,
          memberSeqno,
          siteId: job.siteId, // P2c S-3: 워커 출력 파일에 잡 site 승계(외부 라우트 격리 적용)
          metadata: {
            generatedBy: 'worker-imposition',
            editSessionId: sessionId,
            sourceFileId: sourceFileId ?? null,
            workerJobId: job.id,
          },
        });
        resultFileId = registered.id;

        // 잡에도 outputFileId 기록(추적/멱등). best-effort.
        try {
          job.outputFileId = resultFileId;
          await this.workerJobRepository.save(job);
        } catch (e) {
          this.logger.warn(
            `[inner-imposition] job ${job.id} outputFileId 기록 실패(무중단): ${(e as Error).message}`,
          );
        }
      }

      // 2) 세션 contentPdfFileId 재포인팅 + metadata 결과 스냅샷
      //
      // ⚠️ 동시쓰기 lost update 방지 (2026-06-10) — 전체 save() 금지, 컬럼 한정 원자 update().
      //    검증 잡 콜백(updateEditSessionWorkerStatus)과 본 콜백은 설계상 병렬 완료될 수 있다.
      //    TypeORM save(entity) 는 전 컬럼을 기록하므로 stale 엔티티 save 가 상대 변경을
      //    덮어쓴다(최악: 검증 콜백의 stale save 가 contentPdfFileId 를 원본으로 되돌려
      //    임포지션 결과가 무증상 소실). → 갱신 컬럼을 contentPdfFileId + metadata 2개로 한정.
      //    metadata 는 update 직전 fresh reload 본에 innerPdfImposition 패치만 머지해
      //    경합 창을 최소화한다.
      //    (잔여 한계: metadata 는 단일 JSON 컬럼이라 reload~update 사이 타 트랜잭션의
      //     metadata 변경과는 여전히 최종-쓰기-승리. 현재 병렬 상대(검증 콜백)는 metadata 를
      //     쓰지 않으므로 실질 경합 없음 — 향후 metadata 동시 기록자가 생기면 재설계 필요)
      const fresh = await this.editSessionRepository.findOne({
        where: { id: sessionId },
      });
      const base = fresh ?? session;
      const prevFileId = base.contentPdfFileId;
      const mergedMetadata = {
        ...(base.metadata ?? {}),
        innerPdfImposition: {
          ...((base.metadata as any)?.innerPdfImposition ?? {}),
          jobId: job.id,
          resultFileId,
          outputFileUrl,
          originalContentPdfFileId: prevFileId,
          relinkedAt: new Date().toISOString(),
        },
      };
      await this.editSessionRepository.update(sessionId, {
        contentPdfFileId: resultFileId,
        metadata: mergedMetadata,
      });

      this.logger.log(
        `[inner-imposition] session ${sessionId} contentPdfFileId 재포인팅: ${prevFileId} → ${resultFileId} (job ${job.id})`,
      );
    } catch (error) {
      // best-effort — status 업데이트는 이미 성공. 되연결 실패는 로그만(원본 유지).
      this.logger.error(
        `[inner-imposition] job ${job.id} 결과 되연결 실패(원본 유지, status 업데이트는 성공): ${(error as Error).message}`,
      );
    }
  }

  /**
   * Synthesis 작업 완료/실패 시 콜백 전송
   * 설계서 기준: 하위호환 유지 (outputFileUrl은 항상 merged URL)
   */
  private async sendSynthesisCallback(job: WorkerJob): Promise<void> {
    const callbackUrl = job.options?.callbackUrl;
    // [Stage 2 P1-1] 발신 여부 게이트("callbackUrl 존재 OR v2 config 존재")는
    // 호출측(updateJobStatus)이 판정한다 — 여기서 hasV2Config 를 재조회하지
    // 않는다(동일 판정 이중 조회 방지). callbackUrl 없이 도달한 경우
    // sendCallback 이 v2 경로(tryDispatchForSite)로 발신하고, 그 사이 config
    // 가 사라졌다면 빈 callbackUrl 폴스루로 안전하게 스킵(warn)된다.

    try {
      const isCompleted = job.status === WorkerJobStatus.COMPLETED;
      const outputFormat = job.options?.outputFormat || 'merged';

      const payload: SynthesisWebhookPayload = {
        event: isCompleted ? 'synthesis.completed' : 'synthesis.failed',
        jobId: job.id, // domain ID (worker_jobs.id)
        sessionId: job.editSessionId || undefined, // additive (계약 보강)
        orderId: job.options?.orderId,
        orderSeqno: job.options?.orderOptions?.orderSeqno, // WH-005: bookmoa orderOptions.orderSeqno echo-back
        status: isCompleted ? 'completed' : 'failed',

        // 하위호환: 항상 merged URL (failed면 '')
        outputFileUrl: isCompleted ? (job.outputFileUrl || '') : '',

        // separate 모드에서만 추가 (cover→content 순서 보장)
        outputFiles: isCompleted ? job.result?.outputFiles : undefined,

        // 요청 옵션 echo-back
        outputFormat,

        // 실패 시
        errorMessage: !isCompleted ? (job.errorMessage || undefined) : undefined,

        timestamp: new Date().toISOString(),
      };

      const success = await this.webhookService.sendCallback(
        callbackUrl ?? '',
        payload,
        // [Stage 2] v2 opt-in 판정용 — config 없으면 기존 경로 그대로.
        // [S2-5] env = 잡 생성 시 스탬프된 options.isTest 로 해석(jobWebhookEnv):
        // isTest 잡만 'test'(v2 발신 페이로드 isTest:true), 그 외 undefined→live 폴백
        // (기존 발신 바이트 불변 — webhook-v1-invariance.spec 게이트).
        { siteId: job.siteId, env: this.jobWebhookEnv(job) },
      );

      if (success) {
        this.logger.log(
          `Synthesis callback sent successfully for job ${job.id}, format=${outputFormat}, hasOutputFiles=${!!payload.outputFiles}`,
        );
      } else {
        this.logger.warn(`Synthesis callback failed for job ${job.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send synthesis callback: ${error.message}`);
    }
  }

  /**
   * Validation 작업 완료/수정필요/실패 시 직접 콜백 전송
   * editSessionId 없이 callbackUrl만 있는 경우 사용 (bookmoa 서버 간 통신)
   */
  private async sendValidationCallback(job: WorkerJob): Promise<void> {
    const callbackUrl = job.options?.callbackUrl;
    // [Stage 2 P1-1] 발신 여부 게이트는 호출측(updateJobStatus)이 판정 —
    // sendSynthesisCallback 의 동일 주석 참조(이중 조회 방지).

    try {
      const statusMap: Record<string, ValidationWebhookPayload['status']> = {
        [WorkerJobStatus.COMPLETED]: 'completed',
        [WorkerJobStatus.FIXABLE]: 'fixable',
        [WorkerJobStatus.FAILED]: 'failed',
      };
      const eventMap: Record<string, ValidationWebhookPayload['event']> = {
        [WorkerJobStatus.COMPLETED]: 'validation.completed',
        [WorkerJobStatus.FIXABLE]: 'validation.fixable',
        [WorkerJobStatus.FAILED]: 'validation.failed',
      };

      const status = statusMap[job.status] ?? 'failed';
      const event = eventMap[job.status] ?? 'validation.failed';

      const payload: ValidationWebhookPayload = {
        event,
        jobId: job.id,
        sessionId: job.editSessionId || undefined, // WH-005
        fileType: job.options?.fileType ?? 'cover',
        orderSeqno: job.options?.orderOptions?.orderSeqno, // WH-005: bookmoa orderOptions.orderSeqno echo-back
        status,
        result: job.result,
        errorMessage: job.errorMessage || undefined,
        timestamp: new Date().toISOString(),
      };

      const success = await this.webhookService.sendCallback(
        callbackUrl ?? '',
        payload,
        // [Stage 2] v2 opt-in 판정용 — config 없으면 기존 경로 그대로.
        // [S2-5] env = options.isTest 해석(jobWebhookEnv) — sendSynthesisCallback 주석 참조.
        { siteId: job.siteId, env: this.jobWebhookEnv(job) },
      );

      if (success) {
        this.logger.log(
          `Validation callback sent successfully for job ${job.id}, status=${status}`,
        );
      } else {
        this.logger.warn(`Validation callback failed for job ${job.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send validation callback: ${error.message}`);
    }
  }

  /**
   * EditSession의 workerStatus를 업데이트하고 웹훅 콜백 전송
   */
  private async updateEditSessionWorkerStatus(
    job: WorkerJob,
    updateDto: UpdateJobStatusDto,
  ): Promise<void> {
    if (!job.editSessionId) {
      this.logger.warn(`Job ${job.id} has no editSessionId, skipping session update`);
      return;
    }

    const session = await this.editSessionRepository.findOne({
      where: { id: job.editSessionId },
    });

    if (!session) {
      this.logger.warn(`EditSession ${job.editSessionId} not found for job ${job.id}`);
      return;
    }

    // Update workerStatus based on job status
    let newWorkerStatus: WorkerStatus | null = null;

    if (updateDto.status === WorkerJobStatus.PROCESSING) {
      newWorkerStatus = WorkerStatus.PROCESSING;
    } else if (
      updateDto.status === WorkerJobStatus.COMPLETED ||
      updateDto.status === WorkerJobStatus.FIXABLE ||
      // C+ G2(2026-07-11): 세션(생성 PDF) 경로 한정 FIXABLE 동등 처리.
      // 워커 게이팅(WORKER_WIRED_FIXABLE_GATING) ON 시 실행기 없는 fixMethod
      // (SIZE/SPINE)의 autoFixable 이 false 가 되어 잡 status 가 FIXABLE→FAILED 로
      // 내려오지만, 세션의 종전 의미(자동수정급 이슈=VALIDATED 로 주문 진행,
      // session.validated 웹훅)는 보존한다 — 게이팅 ON/OFF 무관하게 세션의
      // '상태 전이·웹훅 이벤트'는 동일(웹훅 payload 내 result 의 autoFixable 값
      // 자체는 게이팅의 의도된 정직화로 달라짐 — 고지문 참조). 판정: 검증(VALIDATE)
      // 잡이면서 모든 에러가 fixMethod 를 가진 잡(= 게이팅 전 FIXABLE 이었을 잡)만
      // 동등 처리 — jobType 게이트로 '검증 경로 한정'을 구조적으로 강제(향후 다른
      // 프로세서가 FAILED 에 errors[] 형태 result 를 싣더라도 오VALIDATED 방지).
      (job.jobType === WorkerJobType.VALIDATE &&
        this.isFixableEquivalentFailure(updateDto))
    ) {
      // FIXABLE: 자동 수정 가능한 오류 → VALIDATED로 처리 (수정 후 진행 가능)
      // Check if all jobs for this session are completed/fixable
      const allJobsCompleted = await this.areAllSessionJobsCompleted(job.editSessionId);
      newWorkerStatus = allJobsCompleted ? WorkerStatus.VALIDATED : WorkerStatus.PROCESSING;
    } else if (updateDto.status === WorkerJobStatus.FAILED) {
      newWorkerStatus = WorkerStatus.FAILED;
      session.workerError = updateDto.errorMessage || 'Unknown error';
    }

    if (newWorkerStatus) {
      session.workerStatus = newWorkerStatus;
      // ⚠️ 동시쓰기 lost update 방지 (2026-06-10) — 전체 save() 금지, 컬럼 한정 원자 update().
      //    임포지션 콜백(relinkImposedInnerPdf)이 병렬로 contentPdfFileId/metadata 를 갱신할
      //    수 있는데, 여기서 stale 엔티티를 전체 save 하면 그 결과를 원본으로 되돌린다.
      //    본 메서드가 실제로 기록하는 컬럼은 workerStatus(+FAILED 시 workerError)뿐이므로
      //    그 컬럼만 갱신한다. contentPdfFileId/metadata 등은 절대 포함 금지(상호 클로버 제거).
      //    in-memory session 의 workerStatus/workerError 변경은 아래 sendWebhookCallback
      //    payload 일관성을 위해 유지.
      await this.editSessionRepository.update(session.id, {
        workerStatus: newWorkerStatus,
        // C+ G2 리뷰 반영: 조건을 잡 status 가 아니라 '분기 결과(newWorkerStatus)'로 판정.
        // fixable-동등 FAILED(→VALIDATED) 잡이 updateDto.status===FAILED 기준에 걸려
        // findOne 시점의 stale workerError 를 재기록하는 것을 차단(컬럼 한정 기록 계약 유지,
        // 병렬 FAILED 콜백의 workerError lost-update 방지). 종전 FIXABLE 경로와 SQL 동일.
        ...(newWorkerStatus === WorkerStatus.FAILED
          ? { workerError: session.workerError }
          : {}),
      });
      this.logger.log(`Updated EditSession ${session.id} workerStatus to ${newWorkerStatus}`);

      // Send webhook callback when validation completes or fails
      if (
        newWorkerStatus === WorkerStatus.VALIDATED ||
        newWorkerStatus === WorkerStatus.FAILED
      ) {
        await this.sendWebhookCallback(session, job, newWorkerStatus);
      }
    }
  }

  /**
   * C+ G2: '게이팅 전 FIXABLE 이었을 FAILED' 판정 — 세션 상태 전이 한정 동등 처리용.
   *
   * 검증 잡의 result 는 프로세서가 { result } 로 감싸 PATCH 하므로 이중 중첩
   * (updateDto.result.result = ValidationResultDto)이며, 방어적으로 단일 중첩도 지원한다.
   * 모든 에러가 fixMethod(자동수정 의도 메타데이터)를 갖고 에러가 1건 이상일 때만 true —
   * FILE_CORRUPTED/예외 FAILED(fixMethod 없음)나 result 부재 시엔 false(기존 FAILED 처리).
   * ⚠️ 세션(생성 PDF) 경로 전용 — 파트너 대면 잡 status/autoFixable 정직화에는 영향 없음.
   * ⚠️ 호출부에서 job.jobType === VALIDATE 게이트와 반드시 함께 쓸 것(검증 잡 한정 의미).
   */
  private isFixableEquivalentFailure(updateDto: UpdateJobStatusDto): boolean {
    if (updateDto.status !== WorkerJobStatus.FAILED) return false;
    const raw = updateDto.result as
      | { result?: { errors?: unknown } ; errors?: unknown }
      | undefined;
    const vr = (raw?.result ?? raw) as { errors?: unknown } | undefined;
    const errors = vr?.errors;
    if (!Array.isArray(errors) || errors.length === 0) return false;
    return errors.every(
      (e) => typeof (e as { fixMethod?: unknown })?.fixMethod === 'string' &&
        ((e as { fixMethod?: string }).fixMethod as string).length > 0,
    );
  }

  /**
   * 세션의 모든 Worker 작업이 완료되었는지 확인
   */
  private async areAllSessionJobsCompleted(editSessionId: string): Promise<boolean> {
    const jobs = await this.workerJobRepository.find({
      where: { editSessionId },
    });

    return jobs
      // 임포지션 잡(CONVERT + purpose='inner-imposition')은 세션 검증 완료 판정 대상에서 제외.
      //   비동기로 별도 진행되므로 포함하면 validation 완료가 지연될 수 있음(opt-in 회귀 방지).
      .filter(
        (j) =>
          !(
            j.jobType === WorkerJobType.CONVERT &&
            j.options?.purpose === 'inner-imposition'
          ),
      )
      .every(
        (j) =>
          j.status === WorkerJobStatus.COMPLETED ||
          j.status === WorkerJobStatus.FIXABLE ||
          j.status === WorkerJobStatus.FAILED,
      );
  }

  /**
   * 웹훅 콜백 전송
   */
  private async sendWebhookCallback(
    session: EditSessionEntity,
    job: WorkerJob,
    workerStatus: WorkerStatus,
  ): Promise<void> {
    // [Stage 2] callbackUrl 이 없어도 v2 config(opt-in) 사이트면 발송 진행
    // [S2-5] isTest 잡은 test env config 로 판정(기본 live — 기존 호출 SQL 동일)
    const webhookSiteId = session.siteId ?? job.siteId;
    if (
      !session.callbackUrl &&
      !(await this.hasV2ConfigForJob(job, webhookSiteId))
    ) {
      this.logger.log(`No callback URL for session ${session.id}, skipping webhook`);
      return;
    }

    try {
      const event = workerStatus === WorkerStatus.VALIDATED ? 'session.validated' : 'session.failed';
      const status = workerStatus === WorkerStatus.VALIDATED ? 'validated' : 'failed';
      const payload = {
        event: event as 'session.validated' | 'session.failed',
        sessionId: session.id,
        orderSeqno: Number(session.orderSeqno),
        status: status as 'validated' | 'failed',
        fileType: job.options?.fileType as 'cover' | 'content' | undefined,
        errorMessage: session.workerError || undefined,
        result: job.result,
        timestamp: new Date().toISOString(),
      };

      const success = await this.webhookService.sendCallback(
        session.callbackUrl ?? '',
        payload,
        // [Stage 2] v2 opt-in 판정용 — config 없으면 기존 경로 그대로.
        // [S2-5] env = options.isTest 해석(jobWebhookEnv) — sendSynthesisCallback 주석 참조.
        { siteId: webhookSiteId, env: this.jobWebhookEnv(job) },
      );

      if (success) {
        this.logger.log(`Webhook callback sent successfully for session ${session.id}`);
      } else {
        this.logger.warn(`Webhook callback failed for session ${session.id}`);
      }
    } catch (error) {
      this.logger.error(`Failed to send webhook callback: ${error.message}`);
    }
  }

  async getJobStats(): Promise<any> {
    const stats = await this.workerJobRepository
      .createQueryBuilder('job')
      .select('job.status', 'status')
      .addSelect('job.jobType', 'jobType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('job.status')
      .addGroupBy('job.jobType')
      .getRawMany();

    return stats;
  }
}
