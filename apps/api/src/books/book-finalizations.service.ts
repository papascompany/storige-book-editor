import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import {
  ErrV1,
  WorkerJobStatus,
  BookFinalizationWebhookPayload,
} from '@storige/types';
import { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';
import { FilesService } from '../files/files.service';
import { FileEntity, FileType } from '../files/entities/file.entity';
import { WebhookService } from '../webhook/webhook.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { WorkerJob } from '../worker-jobs/entities/worker-job.entity';
import { CreateValidationJobDto } from '../worker-jobs/dto/worker-job.dto';
import { BookSpecsService } from '../book-specs/book-specs.service';
import { BookSpec } from '../book-specs/entities/book-spec.entity';
import { BooksService } from './books.service';
import { Book } from './entities/book.entity';
import { BookAsset } from './entities/book-asset.entity';
import { BookFinalization } from './entities/book-finalization.entity';
import {
  BOOK_FINALIZATION_UID_PREFIX,
  type BookAssetType,
} from './books.constants';
import { BookFinalizationView } from './dto/book-finalization.dto';

/**
 * 최종화 실행 계획 — creationType 별 자산 해석 결과.
 *  - synthesize: validate(내지) → synthesize(표지+내지) → merged 산출(PDF_UPLOAD, 표지분리 세션).
 *  - passthrough: validate(병합본) → 편집기 합성완료본을 그대로 최종 산출(EDITOR_SESSION 병합).
 */
interface FinalizationPlan {
  mode: 'synthesize' | 'passthrough';
  /** validate 잡 대상(내지/병합본) files.id */
  validateFileId: string;
  /** synthesize 표지 files.id (mode='synthesize'만) */
  coverFileId?: string;
  /** synthesize 내지 / passthrough 최종 산출 files.id */
  contentFileId: string;
}

/**
 * Partner API v1 — Books 최종화 오케스트레이터 (Stage 3 W3).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §6.3
 *
 * 상태머신(§6.3): PENDING → VALIDATING(createValidationJob) → COMPOSING
 * (createSynthesisJob) → COMPLETED(registerExternalFile outputFileId 고정) +
 * books.status=FINALIZED + pageCount 확정 + 웹훅 book.finalization.completed.
 * 실패 시 FAILED(book 은 DRAFT 유지) + book.finalization.failed.
 *
 * 재호출 멱등(§6.3):
 *  - 진행 중(PENDING/VALIDATING/COMPOSING) → 409 ERR_FINALIZATION_IN_PROGRESS
 *    (멱등 인터셉터 409 와 별개 — book_finalizations.status 직접 체크).
 *  - COMPLETED → 기존 결과 200 재전달.
 *  - FAILED → 새 attempt 행(attempt+1).
 *
 * 재사용(AD-1, 무접촉): 워커 validate/synthesize 잡·files.registerExternalFile·
 * BookSpecsService.assertPageRules(public 추출)·webhook v2 발신. 신규는
 * book_finalizations 상태머신 + 콜백 역참조(#4)뿐.
 *
 * creationType 지원 범위(본 배치):
 *  - PDF_UPLOAD: 표지/내지 PDF → synthesize. 완전 구현.
 *  - EDITOR_SESSION: 세션 병합본(승격 시 연결) → validate 후 passthrough. 완전 구현.
 *  - MIX_COVER_TEMPLATE / TEMPLATE: 표지 템플릿 렌더링(Stage 5 스키마 + 게스트 폴백
 *    함정 #6) 미도입 → 렌더된 표지 자산 미비로 422 ERR_ASSETS_INCOMPLETE
 *    (TEMPLATE_COVER_NOT_RENDERED). compose-mixed partnerEnv/test env 배선(#2)은
 *    worker-jobs 계층에서 선반영(장래 Stage 5 표지 렌더 연결 시 즉시 실현).
 */
@Injectable()
export class BookFinalizationsService {
  private readonly logger = new Logger(BookFinalizationsService.name);

  constructor(
    @InjectRepository(Book)
    private readonly bookRepo: Repository<Book>,
    @InjectRepository(BookAsset)
    private readonly bookAssetRepo: Repository<BookAsset>,
    @InjectRepository(BookFinalization)
    private readonly finalizationRepo: Repository<BookFinalization>,
    @InjectRepository(BookSpec)
    private readonly bookSpecRepo: Repository<BookSpec>,
    // ⚠️ forwardRef — books ↔ worker-jobs 순환 ES import 에서 BooksService 참조가
    //   undefined 로 실체화되는 것을 차단(BooksService 는 같은 모듈이나 순환 로드 순서 방어).
    @Inject(forwardRef(() => BooksService))
    private readonly booksService: BooksService,
    private readonly bookSpecsService: BookSpecsService,
    // worker-jobs ⇄ books 순환 — forwardRef.
    @Inject(forwardRef(() => WorkerJobsService))
    private readonly workerJobsService: WorkerJobsService,
    private readonly filesService: FilesService,
    private readonly webhookService: WebhookService,
  ) {}

  // ── POST /api/v1/books/:uid/finalization ─────────────────────────────

  /**
   * 최종화 착수(또는 멱등 재전달). 게이트 순서:
   *  ① 테넌트 스코프 404(findBookForSite) → ② COMPLETED 재호출=기존 결과 200
   *  → ③ 진행 중=409 ERR_FINALIZATION_IN_PROGRESS → ④ 자산 완비(422 ERR_ASSETS_INCOMPLETE)
   *  → ⑤ 페이지 규칙(book_spec 연결 + pageCount 확정 시만, 422 ERR_PAGE_COUNT_OUT_OF_RANGE)
   *  → ⑥ 새 attempt 행(PENDING) → ⑦ validate 잡 착수(partnerEnv=book.env, finalizationId 마커)
   *     → VALIDATING. 폴링(GET)·웹훅 병행으로 완주.
   */
  async startFinalization(
    site: CurrentSitePayload,
    uid: string,
  ): Promise<BookFinalizationView> {
    const book = await this.booksService.findBookForSite(site, uid); // ①

    const latest = await this.latestFinalization(book.id);

    // ② COMPLETED 재호출 = 기존 결과 재전달(멱등 200)
    if (latest?.status === 'COMPLETED') {
      return this.toView(book, latest);
    }
    // ③ 진행 중 재호출 = 409(도메인 — 멱등 인터셉터 409 와 별개)
    if (
      latest &&
      (latest.status === 'PENDING' ||
        latest.status === 'VALIDATING' ||
        latest.status === 'COMPOSING')
    ) {
      throw new PartnerApiException(
        ErrV1.ERR_FINALIZATION_IN_PROGRESS,
        409,
        `도서 '${uid}' 의 최종화가 진행 중입니다(status=${latest.status})`,
      );
    }

    // ④ creationType 지원 + 필수 자산 완비(422 ERR_ASSETS_INCOMPLETE / TEMPLATE 미지원)
    const plan = await this.resolvePlan(book);
    // ⑤ 페이지 규칙(연결 + pageCount 확정 시만)
    await this.assertPageRulesIfApplicable(book);

    // ⑥ 새 attempt 행(FAILED 후 재호출이면 attempt+1)
    const attempt = (latest?.attempt ?? 0) + 1;
    let fin = this.finalizationRepo.create({
      uid: `${BOOK_FINALIZATION_UID_PREFIX}${randomUUID().replace(/-/g, '')}`,
      bookId: book.id,
      attempt,
      status: 'PENDING',
      startedAt: new Date(),
    });
    fin = await this.finalizationRepo.save(fin);

    // ⑦ 착수 — 워커 validate 는 대상 판형(orderOptions.size/pages)을 하드 요구한다
    //   (pdf-validator.service 는 size/pages 를 널가드 없이 접근). 따라서 book_spec 연결 +
    //   pageCount 확정 시에만 validate(판형 대조) → VALIDATING. 미연결/미확정이면 검증 대상
    //   판형이 없어 validate 를 건너뛰고 바로 합성/완료로 진행(파트너 자산 as-is). §6.3 정합.
    const spec = await this.resolveValidatableSpec(book);
    if (spec) {
      const validateJob = await this.workerJobsService.createValidationJob({
        fileId: plan.validateFileId,
        fileType: 'content',
        orderOptions: this.buildValidateOrderOptions(spec, book.pageCount as number),
        siteId: book.siteId,
        partnerEnv: book.env,
        finalizationId: fin.id,
      });
      fin.status = 'VALIDATING';
      fin.validateJobId = validateJob.id;
      fin = await this.finalizationRepo.save(fin);
      this.logger.log(
        `[finalization] ${fin.uid} 착수(VALIDATING) — book=${book.uid}(${book.creationType}/${book.env}) attempt=${attempt} validateJob=${validateJob.id} mode=${plan.mode}`,
      );
      return this.toView(book, fin);
    }

    // 검증 대상 판형 부재 — 바로 합성(PDF_UPLOAD)/완료(EDITOR_SESSION passthrough)
    this.logger.log(
      `[finalization] ${fin.uid} 착수(검증 skip — book_spec/pageCount 미확정) — book=${book.uid}(${book.creationType}/${book.env}) attempt=${attempt} mode=${plan.mode}`,
    );
    fin = await this.dispatchComposeOrComplete(book, fin, plan);
    return this.toView(book, fin);
  }

  // ── GET /api/v1/books/:uid/finalization ──────────────────────────────

  /** 최신 attempt 이력 조회(폴링 표면). 이력 없으면 404 ERR_NOT_FOUND. */
  async getFinalization(
    site: CurrentSitePayload,
    uid: string,
  ): Promise<BookFinalizationView> {
    const book = await this.booksService.findBookForSite(site, uid);
    const latest = await this.latestFinalization(book.id);
    if (!latest) {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        `도서 '${uid}' 의 최종화 이력이 없습니다 — POST 로 착수하세요`,
      );
    }
    return this.toView(book, latest);
  }

  // ── GET /api/v1/books/:uid/pdf ───────────────────────────────────────

  /**
   * 최종 PDF 파일 엔티티 조회(소유검증 표면 — §9-10). 컨트롤러가 스트림한다.
   * 테넌트 스코프(findBookForSite)로 소유검증 — 기존 무소유검증 동결 표면
   * (GET /files/:id/download/external)과 별개 신규 표면. FINALIZED 아니거나 산출
   * 미고정이면 404 ERR_NOT_FOUND(존재 은닉 정합).
   */
  async getFinalizedPdf(
    site: CurrentSitePayload,
    uid: string,
  ): Promise<FileEntity> {
    const book = await this.booksService.findBookForSite(site, uid);
    if (book.status !== 'FINALIZED') {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        `도서 '${uid}' 의 최종 PDF 가 아직 없습니다 — finalization 완료 후 다시 시도하세요`,
      );
    }
    const completed = await this.finalizationRepo.findOne({
      where: { bookId: book.id, status: 'COMPLETED' },
      order: { attempt: 'DESC' },
    });
    if (!completed?.outputFileId) {
      throw new PartnerApiException(
        ErrV1.ERR_NOT_FOUND,
        404,
        `도서 '${uid}' 의 최종 산출물을 찾을 수 없습니다`,
      );
    }
    try {
      return await this.filesService.findById(completed.outputFileId);
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw new PartnerApiException(
          ErrV1.ERR_NOT_FOUND,
          404,
          `도서 '${uid}' 의 최종 산출물을 찾을 수 없습니다`,
        );
      }
      throw err;
    }
  }

  // ── 워커 콜백(#4) — updateJobStatus 종결 훅 ───────────────────────────

  /**
   * options.finalizationId 마커 잡의 종결(COMPLETED/FIXABLE/FAILED) 시 상태머신 전진.
   * worker-jobs.updateJobStatus 가 호출(additive 분기, 기존 경로 불변). 멱등:
   * 이미 종결(COMPLETED/FAILED)한 finalization·단계 불일치 잡은 no-op.
   */
  async onWorkerJobSettled(job: WorkerJob): Promise<void> {
    const finId = (job.options as { finalizationId?: string } | null)
      ?.finalizationId;
    if (!finId) return; // 이중 게이트(호출측도 검사)

    const fin = await this.finalizationRepo.findOne({ where: { id: finId } });
    if (!fin) return; // 고아 마커 — 무시
    if (fin.status === 'COMPLETED' || fin.status === 'FAILED') return; // 이미 종결(멱등)

    const book = await this.bookRepo.findOne({ where: { id: fin.bookId } });
    if (!book) return;

    const succeeded = job.status === WorkerJobStatus.COMPLETED;

    // VALIDATING 단계 — validate 잡 종결
    if (fin.status === 'VALIDATING' && fin.validateJobId === job.id) {
      if (succeeded) {
        await this.advanceAfterValidation(book, fin, job);
      } else {
        // FIXABLE(수정필요)·FAILED = 검증 실패 → 파트너가 자산 수정 후 재최종화
        await this.failFinalization(
          book,
          fin,
          ErrV1.ERR_PDF_VALIDATION_FAILED,
          this.jobResultDetail(job),
        );
      }
      return;
    }

    // COMPOSING 단계 — synthesize 잡 종결
    if (fin.status === 'COMPOSING' && fin.composeJobId === job.id) {
      if (succeeded) {
        await this.completeFromCompose(book, fin, job);
      } else {
        await this.failFinalization(
          book,
          fin,
          ErrV1.ERR_PDF_VALIDATION_FAILED,
          this.jobResultDetail(job),
        );
      }
      return;
    }
    // 단계/잡 불일치 — 방어적 무시
  }

  // ── 내부 상태 전이 ───────────────────────────────────────────────────

  /** validate 통과 후 — synthesize 착수(표지분리) 또는 병합본 passthrough 완료. */
  private async advanceAfterValidation(
    book: Book,
    fin: BookFinalization,
    validateJob: WorkerJob,
  ): Promise<void> {
    const plan = await this.resolvePlan(book); // DRAFT 잠금 — 자산 불변 가정
    const validatedPageCount = this.extractPageCount(validateJob) ?? book.pageCount;
    await this.dispatchComposeOrComplete(book, fin, plan, validatedPageCount);
  }

  /**
   * validate 이후(또는 검증 skip 시) 공용 분기 — synthesize 착수(COMPOSING) 또는
   * passthrough 즉시 완료. passthrough(EDITOR_SESSION 병합본)는 편집기 합성완료본을
   * 그대로 최종 산출로 고정(재합성 불필요).
   */
  private async dispatchComposeOrComplete(
    book: Book,
    fin: BookFinalization,
    plan: FinalizationPlan,
    pageCountHint?: number | null,
  ): Promise<BookFinalization> {
    if (plan.mode === 'synthesize' && plan.coverFileId) {
      const composeJob = await this.workerJobsService.createSynthesisJob({
        coverFileId: plan.coverFileId,
        contentFileId: plan.contentFileId,
        outputFormat: 'merged',
        // 파트너 pdf_cover 는 완성 표지(스파인 내장)라 병합=단순 이어붙임 — 스파인 갭 0.
        spineWidth: 0,
        siteId: book.siteId,
        partnerEnv: book.env,
        finalizationId: fin.id,
      });
      fin.status = 'COMPOSING';
      fin.composeJobId = composeJob.id;
      const saved = await this.finalizationRepo.save(fin);
      this.logger.log(
        `[finalization] ${fin.uid} → COMPOSING — synthesizeJob=${composeJob.id}`,
      );
      return saved;
    }
    // passthrough — 편집기 병합본이 곧 최종 산출
    await this.completeFinalization(
      book,
      fin,
      plan.contentFileId,
      pageCountHint ?? book.pageCount,
    );
    return fin;
  }

  /** synthesize 완료 — 산출 URL 을 files 로 등록(outputFileId 고정) 후 완료 전이. */
  private async completeFromCompose(
    book: Book,
    fin: BookFinalization,
    composeJob: WorkerJob,
  ): Promise<void> {
    const outputUrl = this.jobOutputUrl(composeJob);
    if (!outputUrl) {
      await this.failFinalization(book, fin, ErrV1.ERR_INTERNAL, {
        reason: 'synthesis output url 부재',
      });
      return;
    }
    let registered: FileEntity;
    try {
      registered = await this.filesService.registerExternalFile(outputUrl, {
        siteId: book.siteId, // 테넌트 소유 스탬프(외부 라우트 격리)
        fileType: FileType.CONTENT,
        metadata: {
          generatedBy: 'book-finalization',
          bookUid: book.uid,
          finalizationUid: fin.uid,
          workerJobId: composeJob.id,
        },
      });
    } catch (e) {
      await this.failFinalization(book, fin, ErrV1.ERR_INTERNAL, {
        reason: `산출물 등록 실패: ${(e as Error).message}`,
      });
      return;
    }
    const pageCount = this.extractPageCount(composeJob) ?? book.pageCount;
    await this.completeFinalization(book, fin, registered.id, pageCount);
  }

  /** COMPLETED 전이 — fin 고정 + book FINALIZED + pageCount 확정 + 웹훅. */
  private async completeFinalization(
    book: Book,
    fin: BookFinalization,
    outputFileId: string,
    pageCount: number | null,
  ): Promise<void> {
    fin.status = 'COMPLETED';
    fin.outputFileId = outputFileId;
    fin.pageCount = pageCount ?? null;
    fin.completedAt = new Date();
    await this.finalizationRepo.save(fin);

    book.status = 'FINALIZED';
    book.finalizedAt = new Date();
    if (pageCount != null) book.pageCount = pageCount;
    await this.bookRepo.save(book);

    this.logger.log(
      `[finalization] ${fin.uid} COMPLETED — book=${book.uid} FINALIZED outputFileId=${outputFileId} pageCount=${pageCount ?? '(unchanged)'}`,
    );
    await this.sendFinalizationWebhook(book, fin, 'completed');
  }

  /** FAILED 전이 — book 은 DRAFT 유지(재최종화 가능) + 실패 웹훅. */
  private async failFinalization(
    book: Book,
    fin: BookFinalization,
    errorCode: ErrV1,
    detail: Record<string, unknown> | null,
  ): Promise<void> {
    fin.status = 'FAILED';
    fin.errorCode = errorCode;
    fin.errorDetail = detail;
    fin.completedAt = new Date();
    await this.finalizationRepo.save(fin);
    // book.status 는 DRAFT 그대로(§6.2 — finalization 실패 시 DRAFT 유지)
    this.logger.warn(
      `[finalization] ${fin.uid} FAILED — book=${book.uid} errorCode=${errorCode}`,
    );
    await this.sendFinalizationWebhook(book, fin, 'failed');
  }

  /**
   * book.finalization.* 웹훅 — v2 config(opt-in) 사이트만 발신, 미구성은 폴링으로 완주.
   * per-request callbackUrl 없음(sendCallback('') → v2 tryDispatchForSite 전용).
   * context.env=book.env → test env 는 페이로드 isTest:true 부착(test/live 격리).
   * best-effort(throw 금지 — 상태 전이는 이미 커밋).
   */
  private async sendFinalizationWebhook(
    book: Book,
    fin: BookFinalization,
    status: 'completed' | 'failed',
  ): Promise<void> {
    const payload: BookFinalizationWebhookPayload = {
      event:
        status === 'completed'
          ? 'book.finalization.completed'
          : 'book.finalization.failed',
      bookUid: book.uid,
      finalizationUid: fin.uid,
      status,
      pageCount: fin.pageCount ?? null,
      outputFileId: fin.outputFileId ?? null,
      errorCode: fin.errorCode ?? null,
      timestamp: new Date().toISOString(),
    };
    try {
      await this.webhookService.sendCallback('', payload, {
        siteId: book.siteId,
        env: book.env,
      });
    } catch (e) {
      this.logger.warn(
        `[finalization] ${fin.uid} 웹훅 발신 실패(무중단): ${(e as Error).message}`,
      );
    }
  }

  // ── 계획/규칙 해석 ───────────────────────────────────────────────────

  /**
   * creationType 별 자산 해석. 필수 자산 미비 = 422 ERR_ASSETS_INCOMPLETE.
   * MIX_COVER_TEMPLATE/TEMPLATE 은 표지 템플릿 렌더(Stage 5) 미도입 → 렌더된 표지
   * 자산 부재로 422(TEMPLATE_COVER_NOT_RENDERED).
   */
  private async resolvePlan(book: Book): Promise<FinalizationPlan> {
    const assets = await this.bookAssetRepo.find({
      where: { bookId: book.id, status: 'active' },
    });
    const byType = (t: BookAssetType): BookAsset | null =>
      assets.find((a) => a.assetType === t) ?? null;

    if (book.creationType === 'PDF_UPLOAD') {
      const cover = byType('pdf_cover');
      const contents = byType('pdf_contents');
      const missing: string[] = [];
      if (!cover?.fileId) missing.push('pdf_cover');
      if (!contents?.fileId) missing.push('pdf_contents');
      if (missing.length > 0) {
        throw this.assetsIncomplete(
          `필수 자산이 미비합니다: ${missing.join(', ')}`,
          missing.map((m) => ({
            code: 'ASSET_MISSING',
            message: `${m} 자산이 필요합니다`,
          })),
        );
      }
      return {
        mode: 'synthesize',
        validateFileId: contents!.fileId!,
        coverFileId: cover!.fileId!,
        contentFileId: contents!.fileId!,
      };
    }

    if (book.creationType === 'EDITOR_SESSION') {
      // 승격(W4)이 세션 병합 산출을 pdf_contents(+선택 pdf_cover)로 연결.
      const contents = byType('pdf_contents');
      if (!contents?.fileId) {
        throw this.assetsIncomplete(
          '세션 산출물이 연결되지 않았습니다 — EDITOR_SESSION 승격을 확인하세요',
          [
            {
              code: 'SESSION_OUTPUT_MISSING',
              message: '세션 병합 산출(pdf_contents)이 필요합니다',
            },
          ],
        );
      }
      const cover = byType('pdf_cover');
      if (cover?.fileId) {
        return {
          mode: 'synthesize',
          validateFileId: contents.fileId,
          coverFileId: cover.fileId,
          contentFileId: contents.fileId,
        };
      }
      return {
        mode: 'passthrough',
        validateFileId: contents.fileId,
        contentFileId: contents.fileId,
      };
    }

    // MIX_COVER_TEMPLATE / TEMPLATE — 표지 템플릿 렌더링 미도입(Stage 5 + 게스트 폴백 함정 #6).
    throw this.assetsIncomplete(
      '템플릿 기반 최종화는 아직 지원되지 않습니다(표지 렌더링 Stage 5)',
      [
        {
          code: 'TEMPLATE_COVER_NOT_RENDERED',
          message:
            '템플릿 표지 렌더링은 이후 단계에서 지원됩니다 — 현재는 PDF_UPLOAD/EDITOR_SESSION 만 최종화 가능',
        },
      ],
    );
  }

  private assetsIncomplete(
    message: string,
    errors: Array<{ code: string; message: string }>,
  ): PartnerApiException {
    return new PartnerApiException(
      ErrV1.ERR_ASSETS_INCOMPLETE,
      422,
      message,
      errors,
    );
  }

  /**
   * 페이지 규칙 사전 검증 — book_spec 연결 + pageCount 확정 시만(§6.3 ①).
   * 미연결 or pageCount 미확정(워커 검증이 실측)이면 skip. 위반 = 422
   * ERR_PAGE_COUNT_OUT_OF_RANGE(BookSpecsService.assertPageRules 재사용 — 단일 출처).
   */
  private async assertPageRulesIfApplicable(book: Book): Promise<void> {
    if (!book.bookSpecId || book.pageCount == null) return;
    const spec: BookSpec | null = await this.bookSpecRepo.findOne({
      where: { id: book.bookSpecId },
    });
    if (!spec) return; // 스펙 소실(방어) — 사전검증 skip, 워커 검증으로 위임
    this.bookSpecsService.assertPageRules(spec, book.pageCount);
  }

  /**
   * validate 가능한 판형 — book_spec 연결 + pageCount 확정 시에만 반환(둘 다 있어야
   * 워커 orderOptions.size/pages 를 채울 수 있다 — pdf-validator 는 널가드 없이 접근).
   * 아니면 null → 검증 skip(바로 합성/완료).
   */
  private async resolveValidatableSpec(book: Book): Promise<BookSpec | null> {
    if (!book.bookSpecId || book.pageCount == null) return null;
    return this.bookSpecRepo.findOne({ where: { id: book.bookSpecId } });
  }

  /** book_spec + pageCount → 워커 validate orderOptions(판형 대조 계약). */
  private buildValidateOrderOptions(
    spec: BookSpec,
    pageCount: number,
  ): CreateValidationJobDto['orderOptions'] {
    return {
      size: { width: spec.innerTrimWidthMm, height: spec.innerTrimHeightMm },
      pages: pageCount,
      binding: this.mapBinding(spec.bindingType),
      bleed: spec.bleedMm,
      sizeToleranceMm: spec.sizeToleranceMm,
      ...(spec.pageIncrement > 0 ? { pageMultiple: spec.pageIncrement } : {}),
    };
  }

  /** book_spec.bindingType(자유입력) → 워커 검증 binding enum(안전 폴백 perfect). */
  private mapBinding(bindingType: string): 'perfect' | 'saddle' | 'spring' {
    const b = (bindingType ?? '').toLowerCase();
    if (b.includes('saddle') || b.includes('중철')) return 'saddle';
    if (b.includes('spring') || b.includes('스프링')) return 'spring';
    return 'perfect';
  }

  // ── 헬퍼 ─────────────────────────────────────────────────────────────

  private latestFinalization(bookId: string): Promise<BookFinalization | null> {
    return this.finalizationRepo.findOne({
      where: { bookId },
      order: { attempt: 'DESC' },
    });
  }

  /** 워커 result 에서 총 페이지 수 best-effort 추출(검증/합성 공통). */
  private extractPageCount(job: WorkerJob): number | null {
    const r = (job.result ?? {}) as {
      totalPages?: unknown;
      result?: { totalPages?: unknown };
      metadata?: { pageCount?: unknown; totalPages?: unknown };
    };
    const cands = [
      r.totalPages,
      r.result?.totalPages,
      r.metadata?.pageCount,
      r.metadata?.totalPages,
    ];
    for (const c of cands) {
      if (typeof c === 'number' && Number.isFinite(c) && c > 0) return c;
    }
    return null;
  }

  /** 합성 잡 산출 URL — job-level 우선, result 폴백(fix-* 훅과 동형). */
  private jobOutputUrl(job: WorkerJob): string | null {
    const r = (job.result ?? {}) as {
      outputFileUrl?: unknown;
      result?: { outputFileUrl?: unknown };
    };
    const cands = [job.outputFileUrl, r.outputFileUrl, r.result?.outputFileUrl];
    for (const c of cands) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    return null;
  }

  /** 실패 진단 스냅샷(errors/warnings) — 파트너 errorDetail 노출용. */
  private jobResultDetail(job: WorkerJob): Record<string, unknown> {
    const r = (job.result ?? null) as Record<string, unknown> | null;
    return {
      jobStatus: job.status,
      result: r,
    };
  }

  private toView(book: Book, fin: BookFinalization): BookFinalizationView {
    return {
      uid: fin.uid,
      bookUid: book.uid,
      status: fin.status,
      attempt: fin.attempt,
      pageCount: fin.pageCount,
      outputFileId: fin.outputFileId,
      errorCode: fin.errorCode,
      errorDetail: fin.errorDetail,
      createdAt: fin.createdAt.toISOString(),
      startedAt: fin.startedAt ? fin.startedAt.toISOString() : null,
      completedAt: fin.completedAt ? fin.completedAt.toISOString() : null,
    };
  }
}
