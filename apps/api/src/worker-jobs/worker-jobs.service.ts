import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
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
  CreateSynthesisJobDto,
  UpdateJobStatusDto,
} from './dto/worker-job.dto';
import { CreateSplitSynthesisJobDto } from './dto/create-split-synthesis-job.dto';
import { CreateSpreadSynthesisJobDto } from './dto/create-spread-synthesis-job.dto';
import { CreateRenderPagesJobDto } from './dto/create-render-pages-job.dto';
import {
  CheckMergeableDto,
  CheckMergeableResponseDto,
  MergeIssueDto,
} from './dto/check-mergeable.dto';
import * as fs from 'fs/promises';
import axios from 'axios';
import { FilesService } from '../files/files.service';
import { WebhookService } from '../webhook/webhook.service';
import { EditSessionEntity, WorkerStatus } from '../edit-sessions/entities/edit-session.entity';
import { SitesService } from '../sites/sites.service';

@Injectable()
export class WorkerJobsService {
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
  ) {}

  /**
   * Phase B-2 — site 조회 + 잡 옵션 default 머지.
   * 호출자 옵션이 명시되어 있으면 우선, 누락된 항목만 site default로 채움.
   */
  private async mergeSiteWorkerDefaults(
    siteId: string | null | undefined,
    options: Record<string, any> | null | undefined,
  ): Promise<Record<string, any>> {
    const opts = { ...(options || {}) };

    // 블리드 / 사이즈 허용오차 (2026-06-10, P1) — site 유무와 무관한 워커 전역 기본값.
    // templateSet에서 주입된 값(edit-sessions)이 있으면 보존, 누락 시에만 채움.
    // ⚠️ 워커 검증/변환의 실제 사용은 P4. 여기서는 전달 보장만.
    if (opts.bleedMm === undefined) opts.bleedMm = 3;
    if (opts.sizeToleranceMm === undefined) opts.sizeToleranceMm = 0.2;

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
   */
  async checkMergeable(dto: CheckMergeableDto): Promise<CheckMergeableResponseDto> {
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
   * 파일 접근 가능 여부 확인
   */
  private async checkFileAccessible(url: string): Promise<boolean> {
    try {
      if (url.startsWith('/') || url.startsWith('./')) {
        // 로컬 파일
        await fs.access(url);
        return true;
      } else {
        // 원격 URL
        const response = await axios.head(url, { timeout: 5000 });
        return response.status === 200;
      }
    } catch {
      return false;
    }
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
      fileUrl = file.filePath; // 로컬 파일 경로 사용
    }

    // Phase B-2 — site default 머지 (호출자 명시값 보존)
    const orderOptions = await this.mergeSiteWorkerDefaults(
      createValidationJobDto.siteId,
      createValidationJobDto.orderOptions,
    );

    // Create job record in database
    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.VALIDATE,
      status: WorkerJobStatus.PENDING,
      editSessionId: createValidationJobDto.editSessionId || null,
      fileId,
      inputFileUrl: fileUrl,
      siteId: createValidationJobDto.siteId || null, // Phase C
      options: {
        fileType: createValidationJobDto.fileType,
        orderOptions,
        callbackUrl: createValidationJobDto.callbackUrl || undefined,
      },
    });

    const savedJob = await this.workerJobRepository.save(job);

    // Add to Bull queue
    await this.validationQueue.add('validate-pdf', {
      jobId: savedJob.id,
      fileId,
      fileUrl,
      fileType: createValidationJobDto.fileType,
      orderOptions: createValidationJobDto.orderOptions,
    });

    return savedJob;
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
      fileUrl = file.filePath;
    }

    // Phase B-2 — site default 머지
    const convertOptions = await this.mergeSiteWorkerDefaults(
      createConversionJobDto.siteId,
      createConversionJobDto.convertOptions,
    );

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.CONVERT,
      status: WorkerJobStatus.PENDING,
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
      convertOptions: createConversionJobDto.convertOptions,
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
      fileUrl = file.filePath;
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
      coverUrl = coverFile.filePath;
    }

    if (contentFileId) {
      const contentFile = await this.filesService.findById(contentFileId);
      contentUrl = contentFile.filePath;
    }

    const outputFormat = createSynthesisJobDto.outputFormat || 'merged';

    const job = this.workerJobRepository.create({
      jobType: WorkerJobType.SYNTHESIZE,
      status: WorkerJobStatus.PENDING,
      editSessionId: createSynthesisJobDto.editSessionId || null,
      fileId: coverFileId, // 대표 파일로 표지 사용
      inputFileUrl: coverUrl,
      siteId: createSynthesisJobDto.siteId || null, // Phase C
      options: {
        coverFileId,
        contentFileId,
        coverUrl,
        contentUrl,
        spineWidth: createSynthesisJobDto.spineWidth,
        orderId: createSynthesisJobDto.orderId,
        callbackUrl: createSynthesisJobDto.callbackUrl,
        outputFormat, // 출력 형식 저장
      },
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
  async createComposeMixedJob(dto: any): Promise<WorkerJob> {
    // P0-3: 스프레드 책 무결성 — 세션의 출력재현 단일소스(metadata.spread)를 조회해
    //  ① 워커 cover MediaBox 검증용 기대치(totalWidthMm/HeightMm/dpi)를 큐로 push,
    //  ② 확정 비즈니스 규칙(스프레드 책 = cover.pdf + content.pdf "분리 2파일")에 맞춰
    //     outputMode 를 'separate' 로 강제(편집기 펼침면 cover 가 출력에서 누락되지 않도록).
    //  best-effort: 조회 실패/세션부재/스냅샷부재 시 검증·강제 미적용으로 자연 통과(잡 생성 무중단).
    let composeSpreadTotalWidthMm: number | undefined;
    let composeSpreadTotalHeightMm: number | undefined;
    let composeSpreadDpi: number | undefined;
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
      options: {
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
      },
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
        callbackUrl: dto.callbackUrl,
      },
      { priority: 5 },
    );

    this.logger.log(
      `Compose-mixed job created: ${savedJob.id} (front=${(dto.frontEndpaperUrls ?? []).length}, back=${(dto.backEndpaperUrls ?? []).length}, coverEditable=${dto.coverEditable !== false}, outputMode=${effectiveOutputMode}, spread=${!!composeSpreadTotalWidthMm})`,
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
      options: {
        mode: 'split',
        pageTypes,
        totalExpectedPages: sortedPages.length,
        outputFormat,
        alsoGenerateMerged,
        callbackUrl: dto.callbackUrl,
      },
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
    for (const fileId of dto.contentPdfFileIds) {
      const contentFile = await this.filesService.findById(fileId);
      if (!contentFile) {
        throw new NotFoundException({
          code: 'FILE_NOT_FOUND',
          message: `내지 PDF 파일을 찾을 수 없습니다: ${fileId}`,
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

    return await query.orderBy('job.createdAt', 'DESC').getMany();
  }

  async findOne(id: string): Promise<WorkerJob> {
    const job = await this.workerJobRepository.findOne({ where: { id } });

    if (!job) {
      throw new NotFoundException(`Worker job with ID ${id} not found`);
    }

    return job;
  }

  async updateJobStatus(id: string, updateJobStatusDto: UpdateJobStatusDto): Promise<WorkerJob> {
    const job = await this.workerJobRepository.findOne({
      where: { id },
      relations: ['editSession'],
    });

    if (!job) {
      throw new NotFoundException(`Worker job with ID ${id} not found`);
    }

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
    if (job.editSessionId) {
      await this.updateEditSessionWorkerStatus(job, updateJobStatusDto);
    }

    // Synthesis 작업 완료/실패 시 콜백 전송
    if (
      job.jobType === WorkerJobType.SYNTHESIZE &&
      job.options?.callbackUrl &&
      (updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
        updateJobStatusDto.status === WorkerJobStatus.FAILED)
    ) {
      await this.sendSynthesisCallback(savedJob);
    }

    // Validation 작업 완료/수정필요/실패 시 직접 콜백 전송 (editSessionId 없이 callbackUrl만 있는 경우)
    if (
      job.jobType === WorkerJobType.VALIDATE &&
      job.options?.callbackUrl &&
      (updateJobStatusDto.status === WorkerJobStatus.COMPLETED ||
        updateJobStatusDto.status === WorkerJobStatus.FIXABLE ||
        updateJobStatusDto.status === WorkerJobStatus.FAILED)
    ) {
      await this.sendValidationCallback(savedJob);
    }

    return savedJob;
  }

  /**
   * Synthesis 작업 완료/실패 시 콜백 전송
   * 설계서 기준: 하위호환 유지 (outputFileUrl은 항상 merged URL)
   */
  private async sendSynthesisCallback(job: WorkerJob): Promise<void> {
    const callbackUrl = job.options?.callbackUrl;
    if (!callbackUrl) {
      return;
    }

    try {
      const isCompleted = job.status === WorkerJobStatus.COMPLETED;
      const outputFormat = job.options?.outputFormat || 'merged';

      const payload: SynthesisWebhookPayload = {
        event: isCompleted ? 'synthesis.completed' : 'synthesis.failed',
        jobId: job.id, // domain ID (worker_jobs.id)
        sessionId: job.editSessionId || undefined, // additive (계약 보강)
        orderId: job.options?.orderId,
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

      const success = await this.webhookService.sendCallback(callbackUrl, payload);

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
    if (!callbackUrl) {
      return;
    }

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
        fileType: job.options?.fileType ?? 'cover',
        orderSeqno: job.options?.orderOptions?.orderSeqno,
        status,
        result: job.result,
        errorMessage: job.errorMessage || undefined,
        timestamp: new Date().toISOString(),
      };

      const success = await this.webhookService.sendCallback(callbackUrl, payload);

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
      updateDto.status === WorkerJobStatus.FIXABLE
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
      await this.editSessionRepository.save(session);
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
   * 세션의 모든 Worker 작업이 완료되었는지 확인
   */
  private async areAllSessionJobsCompleted(editSessionId: string): Promise<boolean> {
    const jobs = await this.workerJobRepository.find({
      where: { editSessionId },
    });

    return jobs.every(
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
    if (!session.callbackUrl) {
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

      const success = await this.webhookService.sendCallback(session.callbackUrl, payload);

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
