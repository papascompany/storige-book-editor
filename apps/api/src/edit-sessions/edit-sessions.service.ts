import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  EditSessionEntity,
  SessionStatus,
  SessionMode,
} from './entities/edit-session.entity';
import { CreateEditSessionDto } from './dto/create-edit-session.dto';
import { UpdateEditSessionDto } from './dto/update-edit-session.dto';
import {
  EditSessionResponseDto,
  FileInfoDto,
} from './dto/edit-session-response.dto';
import {
  ExternalSessionResponseDto,
  ExternalSessionFilesDto,
} from './dto/external-session-response.dto';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { CreateValidationJobDto } from '../worker-jobs/dto/worker-job.dto';
import { WorkerJobStatus, type SpreadValidationResult, validateSpreadAgainstAuthority } from '@storige/types';
import { TemplateSetsService } from '../templates/template-sets.service';

@Injectable()
export class EditSessionsService {
  private readonly logger = new Logger(EditSessionsService.name);

  constructor(
    @InjectRepository(EditSessionEntity)
    private sessionRepository: Repository<EditSessionEntity>,
    @Inject(forwardRef(() => WorkerJobsService))
    private workerJobsService: WorkerJobsService,
    private templateSetsService: TemplateSetsService,
  ) {}

  /**
   * B49: 세션의 출력재현 스냅샷(metadata.spread.spec)을 템플릿 권위 스펙(spreadConfig.spec)과 대조.
   * 책등은 동적이라 제외하고 표지 가로/세로·날개 기하만 검증. 권위 미해결(레거시/비스프레드/스펙부재) 시 빈 배열(통과).
   */
  private async compareSpreadWithTemplateAuthority(
    session: EditSessionEntity,
  ): Promise<string[]> {
    try {
      const candidate = (session.metadata as any)?.spread?.spec;
      if (!session.templateSetId || !candidate) return [];
      const { templateDetails } = await this.templateSetsService.findOneWithTemplates(
        session.templateSetId,
      );
      const spreadTpl = templateDetails.find((t) => t.type === ('spread' as any));
      const authority = spreadTpl?.spreadConfig?.spec;
      if (!authority) return []; // 권위 스펙 없음 → 검증 불가(통과)
      const { mismatches } = validateSpreadAgainstAuthority(candidate, authority);
      return mismatches.map((m) => 'AUTHORITY_' + m);
    } catch (e) {
      this.logger.warn(`[spread-spec] 권위 대조 skip(완료는 계속): ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 편집 세션 생성
   *
   * 인쇄 워크플로우 v1 Phase 4 (2026-05-19):
   * - dto.asGuest=true → guestToken (uuid) + guestExpiresAt (NOW + 24h) 자동 발급.
   * - 결정 3-1: EVENT evt_purge_expired_guest_sessions (1h 주기) 가 만료 시 DELETE.
   * - 결정 3-6: 회원 전환은 저장(편집완료) 시점에 별도 흐름. 본 메서드는 발급만.
   */
  async create(dto: CreateEditSessionDto): Promise<EditSessionEntity> {
    // 게스트 모드: orderSeqno/memberSeqno 미전송 시 0 / null. token 발급.
    const isGuest = !!dto.asGuest || (!dto.memberSeqno && !dto.orderSeqno);
    const guestToken = isGuest ? randomUUID() : null;
    const guestExpiresAt = isGuest ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null;

    // coverFileId/contentFileId는 @RelationId(read-only). ManyToOne relation을 통해 set.
    const session = this.sessionRepository.create({
      orderSeqno: dto.orderSeqno ?? 0,
      memberSeqno: dto.memberSeqno ?? 0,
      mode: dto.mode,
      coverFile: dto.coverFileId ? ({ id: dto.coverFileId } as any) : null,
      contentFile: dto.contentFileId ? ({ id: dto.contentFileId } as any) : null,
      templateSetId: dto.templateSetId,
      canvasData: dto.canvasData,
      metadata: dto.metadata,
      callbackUrl: dto.callbackUrl,
      siteId: (dto as any).siteId || null, // Phase C-2 — JWT siteId 자동 주입
      guestToken,
      guestExpiresAt,
    });

    const saved = await this.sessionRepository.save(session);
    if (isGuest) {
      this.logger.log(`Created guest edit session ${saved.id} (token=${guestToken?.slice(0, 8)}…, expires ${guestExpiresAt?.toISOString()})`);
    } else {
      this.logger.log(`Created edit session ${saved.id} for order ${dto.orderSeqno}`);
    }

    return saved;
  }

  /**
   * 주문 번호로 세션 목록 조회
   */
  async findByOrderSeqno(orderSeqno: number): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { orderSeqno },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * 회원 번호로 세션 목록 조회
   */
  async findByMemberSeqno(memberSeqno: number): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { memberSeqno },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Phase C-3 — 사이트 ID로 세션 목록 조회 (admin 사이트별 필터)
   */
  async findBySiteId(siteId: string): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { siteId },
      relations: ['coverFile', 'contentFile'],
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  /**
   * 주문 번호로 외부 조회 (워커잡 포함, nimda용)
   */
  async findByOrderExternal(orderSeqno: number): Promise<ExternalSessionResponseDto[]> {
    const sessions = await this.sessionRepository
      .createQueryBuilder('session')
      .leftJoinAndSelect('session.coverFile', 'coverFile')
      .leftJoinAndSelect('session.contentFile', 'contentFile')
      .where('session.orderSeqno = :orderSeqno', { orderSeqno })
      .andWhere('session.deletedAt IS NULL')
      .orderBy('session.createdAt', 'DESC')
      .getMany();

    const results: ExternalSessionResponseDto[] = [];

    for (const session of sessions) {
      // 해당 세션의 최신 SYNTHESIZE 워커잡 조회
      const workerJob = await this.sessionRepository.manager
        .createQueryBuilder()
        .select('job.status', 'status')
        .addSelect('job.result', 'result')
        .addSelect('job.output_file_url', 'outputFileUrl')
        .from('worker_jobs', 'job')
        .where('job.edit_session_id = :sessionId', { sessionId: session.id })
        .andWhere('job.job_type = :jobType', { jobType: 'SYNTHESIZE' })
        .orderBy('job.created_at', 'DESC')
        .limit(1)
        .getRawOne();

      const files = this.resolveFiles(session, workerJob);

      results.push({
        sessionId: session.id,
        orderSeqno: Number(session.orderSeqno),
        status: session.status,
        mode: session.mode,
        files,
        completedAt: session.completedAt,
      });
    }

    return results;
  }

  /**
   * 파일 URL 결정 (워커 출력 > 에디터 원본 fallback)
   */
  private resolveFiles(
    session: EditSessionEntity,
    workerJob: any,
  ): ExternalSessionFilesDto {
    let cover: string | null = null;
    let content: string | null = null;
    let merged: string | null = null;

    if (workerJob && workerJob.status === WorkerJobStatus.COMPLETED) {
      // 워커잡 결과에서 파일 URL 추출
      const result = typeof workerJob.result === 'string'
        ? JSON.parse(workerJob.result)
        : workerJob.result;

      if (result?.outputFiles) {
        for (const file of result.outputFiles) {
          if (file.type === 'cover') cover = file.url;
          if (file.type === 'content') content = file.url;
        }
      }
      if (result?.outputFileUrl) {
        merged = result.outputFileUrl;
      }
      // job-level outputFileUrl fallback for merged
      if (!merged && workerJob.outputFileUrl) {
        merged = workerJob.outputFileUrl;
      }
    }

    // 에디터 원본 fallback
    if (!cover && session.coverFile) {
      cover = session.coverFile.fileUrl ?? null;
    }
    if (!content && session.contentFile) {
      content = session.contentFile.fileUrl ?? null;
    }

    return { cover, content, merged };
  }

  /**
   * 세션 ID로 조회
   */
  async findById(id: string): Promise<EditSessionEntity> {
    const session = await this.sessionRepository.findOne({
      where: { id },
      relations: ['coverFile', 'contentFile'],
    });

    if (!session) {
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: '편집 세션을 찾을 수 없습니다.',
        details: { sessionId: id },
      });
    }

    return session;
  }

  /**
   * 세션 업데이트
   *
   * 인쇄 워크플로우 v1 Phase 4 (2026-05-19):
   * - 게스트 세션(`guestToken` 보유)은 userId=0 으로 호출돼도 통과 (회원 권한 검사 우회).
   * - PDF 첨부 / 검증 결과 / 페이지수 필드(`contentPdf*`) 갱신 지원.
   * - 결정 3-3: PDF 첨부 시 `canvasData` 동시 수정은 클라가 막아야 함 (API 는 1차 가드만).
   */
  async update(
    id: string,
    dto: UpdateEditSessionDto,
    userId: number,
  ): Promise<EditSessionEntity> {
    const session = await this.findById(id);

    // 권한 확인: 회원 세션은 소유자만 / 게스트 세션은 토큰 보유자(클라이언트가 token 같이 보내는 흐름은 추후)
    const isGuest = !!session.guestToken;
    if (!isGuest && Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 수정할 권한이 없습니다.',
      });
    }

    // 캔버스 데이터 업데이트
    if (dto.canvasData !== undefined) {
      // Phase 4 결정 3-3: PDF 첨부 ↔ 편집 배타(replace 모드).
      // P0-2 (2026-06-02): underlay 모드는 PDF를 배경으로 깔고 그 위 편집을 허용 → 배타 완화.
      const effectiveMode =
        (dto.contentPdfMode ?? session.contentPdfMode ?? 'replace');
      if (
        session.contentPdfFileId &&
        dto.contentPdfFileId === undefined &&
        effectiveMode !== 'underlay'
      ) {
        throw new BadRequestException({
          code: 'PDF_ATTACHED_EXCLUSIVE',
          message: '내지 PDF 첨부(replace) 상태에서는 편집 캔버스를 변경할 수 없습니다. PDF 를 먼저 제거하거나 underlay 모드로 첨부하세요.',
        });
      }
      session.canvasData = dto.canvasData;
    }

    // 메타데이터 병합
    if (dto.metadata !== undefined) {
      session.metadata = { ...session.metadata, ...dto.metadata };
    }

    // 상태 업데이트
    if (dto.status !== undefined) {
      session.status = dto.status;
      if (dto.status === SessionStatus.COMPLETE) {
        session.completedAt = new Date();
      }
    }

    // 파일 ID 업데이트 — coverFileId/contentFileId는 @RelationId(read-only)이므로
    // ManyToOne relation을 통해 set해야 실제 cover_file_id/content_file_id 칼럼이 갱신됨.
    if (dto.coverFileId !== undefined) {
      session.coverFile = dto.coverFileId ? ({ id: dto.coverFileId } as any) : null;
    }
    if (dto.contentFileId !== undefined) {
      session.contentFile = dto.contentFileId ? ({ id: dto.contentFileId } as any) : null;
    }

    // ── Phase 4 (2026-05-19) — 고객 첨부 내지 PDF 필드 ──
    if (dto.contentPdfFileId !== undefined) {
      session.contentPdfFileId = dto.contentPdfFileId;
      // PDF 를 비우면 검증 결과도 클리어 (재첨부 시 새 검증 결과로 덮어씀)
      if (dto.contentPdfFileId === null) {
        session.contentPdfPageCount = null;
        session.contentPdfValidationResult = null;
      }
    }
    if (dto.contentPdfPageCount !== undefined) {
      session.contentPdfPageCount = dto.contentPdfPageCount;
    }
    if (dto.contentPdfValidationResult !== undefined) {
      session.contentPdfValidationResult = dto.contentPdfValidationResult;
    }
    // P0-2: 첨부 모드(replace|underlay). PDF 제거 시 모드도 클리어.
    if (dto.contentPdfMode !== undefined) {
      session.contentPdfMode = dto.contentPdfMode;
    }
    if (dto.contentPdfFileId === null) {
      session.contentPdfMode = null;
    }

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Updated edit session ${id}${isGuest ? ' (guest)' : ''}`);

    return updated;
  }

  /**
   * 게스트 세션 마이그레이션 — 인쇄 워크플로우 v1 Phase 6-B (2026-05-19).
   *
   * 결정 3-6: 회원 전환은 저장(편집완료) 시점에만. 본 메서드는 로그인 직후 호출되어
   * 게스트 세션을 해당 회원 소유로 흡수.
   *
   * 보안:
   * - guestToken 일치 세션만 흡수 가능 (타인 세션 흡수 불가)
   * - 호출자는 인증된 사용자 (controller 가 JWT 검증)
   *
   * 작업:
   * - WHERE guest_token = ? → memberSeqno 채움
   * - guestToken / guestExpiresAt NULL 처리 (EVENT 가 더 이상 삭제 안 함)
   */
  async migrateGuestSessions(
    guestToken: string,
    memberSeqno: number,
  ): Promise<{ migratedCount: number; sessionIds: string[] }> {
    const sessions = await this.sessionRepository.find({
      where: { guestToken },
    });
    if (sessions.length === 0) {
      return { migratedCount: 0, sessionIds: [] };
    }

    const sessionIds: string[] = [];
    for (const session of sessions) {
      session.memberSeqno = memberSeqno as any;
      session.guestToken = null;
      session.guestExpiresAt = null;
      await this.sessionRepository.save(session);
      sessionIds.push(session.id);
    }

    this.logger.log(
      `Migrated ${sessions.length} guest session(s) to member ${memberSeqno} (token=${guestToken.slice(0, 8)}…)`,
    );
    return { migratedCount: sessions.length, sessionIds };
  }

  /**
   * 내 세션 목록 — 인쇄 워크플로우 v1 Phase 6-C (2026-05-19).
   *
   * 로그인 사용자 본인 세션을 최근순 200건 반환.
   * 게스트 토큰 보유 세션은 제외 (회원만의 영구 보관 작업).
   */
  async findMyRecent(memberSeqno: number, limit = 200): Promise<EditSessionEntity[]> {
    return this.sessionRepository.find({
      where: { memberSeqno: memberSeqno as any, guestToken: null as any },
      relations: ['coverFile', 'contentFile'],
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 세션 완료 처리
   *
   * 인쇄 워크플로우 v1 Phase 5 (2026-05-19):
   * - 게스트 세션도 complete 호출 가능 (userId=0 통과)
   * - contentPdfFileId 또는 endpaperConfig 또는 coverEditable=false 가 있으면
   *   compose-mixed 잡 enqueue 분기 — Worker 가 표지+면지+내지+면지 합본 생성.
   * - 기존 SPREAD / 일반 흐름은 그대로 유지 (PHP 영향 0).
   */
  async complete(id: string, userId: number): Promise<EditSessionEntity> {
    const session = await this.findById(id);

    const isGuest = !!session.guestToken;
    if (!isGuest && Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 완료할 권한이 없습니다.',
      });
    }

    // 스프레드 책 스냅샷 검증.
    // 게이트: session.mode===SPREAD(PHP/worker 합성 경로) 또는 metadata.spread 존재(편집기 책 완료 경로).
    //   편집기는 책 완료 시에도 mode 를 'both'/'cover' 로 보내 SessionMode.SPREAD 가 안 걸리므로
    //   metadata.spread 존재로 편집기 책 완료를 포착한다(P0-1 이 metadata.spread 를 채움).
    // 기본 SOFT: 누락/불일치를 경고·기록만(throw 금지) → 기존 주문 무중단.
    //   env SPREAD_SNAPSHOT_HARD_FAIL='true' 일 때만 HARD(차단)로 승격(P0-3 이후).
    const isBookSession =
      session.mode === SessionMode.SPREAD || !!session.metadata?.spread;
    if (isBookSession) {
      const validation = this.validateSpreadSnapshot(session);
      // B49: 스냅샷 spec 을 템플릿 권위 기하(표지 가로/세로·날개, 책등 제외)와 대조해 병합.
      const authorityMismatches = await this.compareSpreadWithTemplateAuthority(session);
      if (authorityMismatches.length > 0) {
        validation.ok = false;
        validation.mismatches = [...validation.mismatches, ...authorityMismatches];
        const hardFail = process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true';
        this.logger.warn(
          `[spread-spec] session ${session.id} 템플릿 권위 불일치 ${hardFail ? 'HARD' : 'SOFT'}: ${authorityMismatches.join(' | ')}`,
        );
        if (hardFail) {
          throw new BadRequestException({
            code: 'TEMPLATE_SPEC_MISMATCH',
            message: '스프레드 스펙이 템플릿 권위(spreadConfig)와 불일치합니다.',
            mismatches: authorityMismatches,
          });
        }
      }
      session.metadata = { ...(session.metadata ?? {}), spreadValidation: validation };
    }

    session.status = SessionStatus.COMPLETE;
    session.completedAt = new Date();

    const completed = await this.sessionRepository.save(session);
    this.logger.log(`Completed edit session ${id}${isGuest ? ' (guest)' : ''}`);

    // 스프레드 모드는 자동 검증 잡 발행을 스킵.
    // 표지(펼침면)는 일반 사이즈 검증(±1mm)에서 SIZE_MISMATCH가 나기 때문이며,
    // 실제 합성/검증은 PHP가 worker-jobs/synthesize/external 또는 spread 전용
    // 흐름을 호출하는 시점에 수행 (NEW_DEV_PLAN §3 PHP 무변경 정책과 정합).
    if (completed.mode !== SessionMode.SPREAD) {
      await this.createValidationJobs(completed);
      // 단일/낱장 상품의 PDF 출력 모드(TemplateSet.pdfOutputMode) 적용.
      // 책(spread) 셋은 위 분기에서 제외 — 기존 compose-mixed 경로 우선.
      await this.applyPdfOutputMode(completed);
    } else {
      this.logger.log(
        `Skipping auto validation jobs for SPREAD session ${id} (PHP-driven synthesis flow)`,
      );
    }

    // P4 (2026-06-10) — 고객 업로드 내지 PDF 작업사이즈 자동 임포지션 (opt-in).
    // 마스터 게이트: TemplateSet.cropMarkEnabled === true 인 세션만 변환 잡 발행.
    //   cropMarkEnabled !== true → 완전 no-op(현행 보존). 기본 false 라 배포 무변경.
    // 메서드 내부에서 모든 게이트/예외를 처리하므로 spread 포함 모든 경로에서 안전 호출.
    await this.createInnerPdfImpositionJob(completed);

    return completed;
  }

  /**
   * P4 — 고객 업로드 내지 PDF 작업사이즈 자동 임포지션 잡 발행 (2026-06-10, opt-in).
   *
   * 대상: 고객이 첨부한 내지 PDF (session.contentPdfFileId). 편집기 산출 PDF(coverFileId/
   * contentFileId)는 대상이 아니다(convert 미경유 정책 유지).
   *
   * ⚠️ 마스터 opt-in 게이트 — TemplateSet.cropMarkEnabled === true 일 때만 발행:
   *   - cropMarkEnabled !== true            → 발행 안 함(현행 100% 보존). 기본 false.
   *   - contentPdfFileId 없음               → 발행 안 함(첨부 내지 없음).
   *   - underlay 모드(표시전용)              → 발행 안 함. 최종 인쇄는 원본 PDF 그대로라
   *                                            임포지션 무의미(엔티티 주석 §content_pdf_mode).
   *   - templateSet 미연결/조회실패/workSize 무효 → 발행 안 함(best-effort).
   *
   * 동작: convert 잡을 발행하되 convertOptions 에 editSize(=작업사이즈=trim+bleed*2),
   * sizeToleranceMm 만 주입한다. mode 는 주입하지 않음 → 워커 convert() 의 resolveMode 가
   * 실측 vs editSize±tol 비교로 자체결정(동일=passthrough / 큼=innerfit / 작음=center).
   *
   * 결과 되연결(P4 콜백, 2026-06-10): 본 잡에 editSessionId + convertOptions.purpose=
   * 'inner-imposition' 마커를 심는다. 워커 변환 완료 → updateJobStatus(COMPLETED) 시
   * worker-jobs.service.relinkImposedInnerPdf 가 결과 PDF 를 File 로 등록하고
   * session.contentPdfFileId 를 그 결과로 재포인팅한다(원본은 잡 inputFileUrl/별도 File 로 보존).
   * → 후속(PHP compose-mixed contentPdfUrl 조회, 마이페이지 다운로드)이 임포지션 결과를 사용.
   * cropMarkEnabled 가 기본 off 라 미opt-in 세션은 잡 자체가 없어 영향 0.
   *
   * best-effort: 어떤 실패도 세션 완료를 막지 않는다(throw 금지).
   */
  private async createInnerPdfImpositionJob(
    session: EditSessionEntity,
  ): Promise<void> {
    try {
      // 첨부 내지 PDF 없음 → no-op.
      if (!session.contentPdfFileId) return;

      // underlay(표시전용)는 원본 PDF 그대로 인쇄 → 임포지션 대상 아님.
      const pdfMode = session.contentPdfMode ?? 'replace';
      if (pdfMode === 'underlay') {
        this.logger.log(
          `[inner-imposition] session ${session.id}: contentPdfMode=underlay → 임포지션 스킵(원본 인쇄)`,
        );
        return;
      }

      // 템플릿셋 미연결 → 작업사이즈 산출 불가 → 스킵(현행).
      if (!session.templateSetId) return;

      let cropMarkEnabled = false;
      let workWidth: number | undefined;
      let workHeight: number | undefined;
      let sizeToleranceMm = 0.2;
      try {
        const templateSet = await this.templateSetsService.findOne(
          session.templateSetId,
        );
        cropMarkEnabled = templateSet.cropMarkEnabled === true;
        const bleedMm = templateSet.bleedMm ?? 3;
        sizeToleranceMm = templateSet.sizeToleranceMm ?? 0.2;
        // 작업(work) 사이즈 = 재단(판형) + 사방 블리드*2. (createValidationJobs 와 동일 규약)
        workWidth = templateSet.width + bleedMm * 2;
        workHeight = templateSet.height + bleedMm * 2;
      } catch (e) {
        this.logger.warn(
          `[inner-imposition] templateSet ${session.templateSetId} 조회 실패 → 임포지션 스킵(완료는 계속): ${(e as Error).message}`,
        );
        return;
      }

      // ⚠️ 마스터 게이트: opt-in 아니면 절대 발행 안 함(현행 100% 보존).
      if (!cropMarkEnabled) {
        return;
      }

      // 작업사이즈 무효 → 스킵.
      if (!(workWidth! > 0) || !(workHeight! > 0)) {
        this.logger.warn(
          `[inner-imposition] session ${session.id}: 작업사이즈 무효(${workWidth}x${workHeight}) → 스킵`,
        );
        return;
      }

      const job = await this.workerJobsService.createConversionJob({
        fileId: session.contentPdfFileId,
        siteId: session.siteId ?? undefined,
        // P4 결과 콜백 — 잡↔세션 연결 + 임포지션 식별 마커.
        //  · editSessionId: 완료 콜백(updateJobStatus)이 세션을 역참조할 수 있게 edit_session_id 컬럼 세팅.
        //  · convertOptions.purpose='inner-imposition': updateJobStatus 가 "임포지션 잡"임을 판별하는 마커
        //    (이 마커가 없는 convert 잡=admin 자동수정 등은 콜백 개입 0 → 기존 동작 무영향).
        editSessionId: session.id,
        convertOptions: {
          // mode 미지정 → 워커 resolveMode 가 실측 vs editSize 로 자체결정.
          editSize: { width: workWidth, height: workHeight },
          sizeToleranceMm,
          purpose: 'inner-imposition',
          editSessionId: session.id,
          sourceFileId: session.contentPdfFileId,
        },
      });

      // 임포지션 잡 추적 정보를 metadata 에 스냅샷(후속 배선/검증용, additive).
      try {
        session.metadata = {
          ...(session.metadata ?? {}),
          innerPdfImposition: {
            jobId: job.id,
            sourceFileId: session.contentPdfFileId,
            workSize: { width: workWidth, height: workHeight },
            sizeToleranceMm,
            createdAt: new Date().toISOString(),
          },
        };
        await this.sessionRepository.save(session);
      } catch (e) {
        this.logger.warn(
          `[inner-imposition] metadata 스냅샷 저장 실패(무중단): ${(e as Error).message}`,
        );
      }

      this.logger.log(
        `[inner-imposition] Created conversion job ${job.id} for session ${session.id} ` +
          `(content_pdf=${session.contentPdfFileId}, work=${workWidth}x${workHeight}mm, tol=${sizeToleranceMm})`,
      );
    } catch (error) {
      // 완료 무중단 — 잡 발행 실패가 세션 완료를 막지 않도록.
      this.logger.error(
        `[inner-imposition] session ${session.id} 임포지션 잡 발행 실패(완료는 유지): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 단일/낱장 상품 PDF 출력 모드 적용 — 2026-06-09.
   *
   * 세션의 TemplateSet.pdfOutputMode 에 따라 최종 PDF 구성을 결정한다.
   * 적용 대상: 비-spread 세션(낱장/단일). 책 spread 셋은 호출측에서 이미 제외됨.
   *
   *  - 'single'        : 단면 1p. 편집기 산출 PDF 그대로가 최종(추가 잡 없음).
   *  - 'duplex-merged' : 양면 1파일(앞,뒤,…). 기존 기본 동작 그대로(추가 잡 없음).
   *  - 'duplex-split'  : 양면 — coverFileId(편집기 단일 PDF)를 앞/뒤 2페이지 세트별
   *                      개별 PDF n개로 분리하는 워커 잡 발행.
   *
   * best-effort: TemplateSet 미해결/파일부재/잡 생성 실패 시 경고만 남기고 완료는 무중단.
   * 출력 모드는 session.metadata.pdfOutputMode 에 스냅샷으로 기록(다운스트림/PHP 가독).
   */
  private async applyPdfOutputMode(session: EditSessionEntity): Promise<void> {
    try {
      if (!session.templateSetId) return; // 템플릿셋 미연결 → 기본(duplex-merged) 동작 유지

      let pdfOutputMode: string;
      try {
        const templateSet = await this.templateSetsService.findOne(
          session.templateSetId,
        );
        pdfOutputMode = templateSet.pdfOutputMode ?? 'duplex-merged';
      } catch (e) {
        this.logger.warn(
          `[pdfOutputMode] TemplateSet ${session.templateSetId} 조회 실패 → 기본(duplex-merged) 유지: ${(e as Error).message}`,
        );
        return;
      }

      // 출력 모드 스냅샷 기록 (additive, 실패해도 무중단)
      try {
        session.metadata = {
          ...(session.metadata ?? {}),
          pdfOutputMode,
        };
        await this.sessionRepository.save(session);
      } catch (e) {
        this.logger.warn(
          `[pdfOutputMode] metadata 스냅샷 저장 실패(무중단): ${(e as Error).message}`,
        );
      }

      // single / duplex-merged 는 편집기 산출 PDF 그대로가 최종 → 추가 잡 없음.
      if (pdfOutputMode !== 'duplex-split') {
        this.logger.log(
          `[pdfOutputMode] session ${session.id}: '${pdfOutputMode}' — 편집기 산출 PDF 그대로 사용(분리 없음)`,
        );
        return;
      }

      // duplex-split: 편집기 단일 PDF(coverFileId)를 앞/뒤 2페이지 세트별로 분리.
      if (!session.coverFileId) {
        this.logger.warn(
          `[pdfOutputMode] session ${session.id}: duplex-split 이나 coverFileId 부재 → 분리 잡 스킵`,
        );
        return;
      }

      const job = await this.workerJobsService.createDuplexSplitJob({
        sessionId: session.id,
        pdfFileId: session.coverFileId,
        // 멱등성 키: 세션+파일에 고정(완료당 1회). 재완료 시 동일 키 → 멱등 히트.
        requestId: `duplex-split-${session.id}-${session.coverFileId}`,
        callbackUrl: session.callbackUrl ?? undefined,
      });
      this.logger.log(
        `[pdfOutputMode] Created duplex-split job ${job.id} for session ${session.id} (cover=${session.coverFileId})`,
      );
    } catch (error) {
      // 완료 무중단 정책 — 잡 발행 실패가 세션 완료를 막지 않도록.
      this.logger.error(
        `[pdfOutputMode] session ${session.id} 적용 실패(완료는 유지): ${(error as Error).message}`,
      );
    }
  }

  /**
   * 스프레드 책 스냅샷 무결성 검증.
   *
   * 검증 항목(하드 승격 시 차단 사유):
   *  - metadata.spine: spineWidthMm/pageCount/paperType/bindingType/formulaVersion 5필드 truthy
   *  - metadata.spread: spec/totalWidthMm/totalHeightMm/dpi 4필드 truthy
   *
   * 모드:
   *  - SOFT(기본): 누락/불일치를 mismatches 에 누적하고 logger.warn 만(throw 금지) → 완료 무중단.
   *  - HARD: env SPREAD_SNAPSHOT_HARD_FAIL='true' 일 때, mismatches 가 있으면 BadRequestException 으로 차단.
   * 검증 로직은 하나로 유지하고 throw 여부만 토글 → P0-3 이후 ENV 만 켜서 hard 승격(인쇄사고 방지).
   *
   * @returns SpreadValidationResult — 호출측이 session.metadata.spreadValidation 에 기록.
   */
  private validateSpreadSnapshot(session: EditSessionEntity): SpreadValidationResult {
    const mismatches: string[] = [];

    const spine = session.metadata?.spine;
    if (!spine) {
      mismatches.push('SPINE_MISSING: metadata.spine 누락');
    } else if (
      !spine.spineWidthMm ||
      !spine.pageCount ||
      !spine.paperType ||
      !spine.bindingType ||
      !spine.formulaVersion
    ) {
      mismatches.push(
        'SPINE_INVALID: spine 필수필드 누락(spineWidthMm/pageCount/paperType/bindingType/formulaVersion)',
      );
    }

    const spread = session.metadata?.spread;
    if (!spread) {
      mismatches.push('SPREAD_MISSING: metadata.spread 누락');
    } else if (!spread.spec || !spread.totalWidthMm || !spread.totalHeightMm || !spread.dpi) {
      mismatches.push('SPREAD_INVALID: spread 필수필드 누락(spec/totalWidthMm/totalHeightMm/dpi)');
    }

    const hardFail = process.env.SPREAD_SNAPSHOT_HARD_FAIL === 'true';
    const result: SpreadValidationResult = {
      ok: mismatches.length === 0,
      checkedAt: new Date().toISOString(),
      gate: session.mode === SessionMode.SPREAD ? 'session-mode' : 'metadata-spread',
      mismatches,
      mode: hardFail ? 'hard' : 'soft',
    };

    if (mismatches.length > 0) {
      this.logger.warn(
        `[spread-snapshot] session ${session.id} 검증 ${hardFail ? 'HARD' : 'SOFT'} 불일치: ${mismatches.join(' | ')}`,
      );
      if (hardFail) {
        throw new BadRequestException({
          code: 'SPREAD_SNAPSHOT_INVALID',
          message: '스프레드 스냅샷 무결성 검증 실패',
          mismatches,
        });
      }
    } else {
      this.logger.log(`[spread-snapshot] session ${session.id} 검증 통과 (${result.gate})`);
    }

    return result;
  }

  /**
   * 완료된 세션의 파일에 대한 Worker 검증 작업 생성
   */
  private async createValidationJobs(session: EditSessionEntity): Promise<void> {
    try {
      // Get order options from metadata or use defaults
      const orderOptions: CreateValidationJobDto['orderOptions'] = {
        size: session.metadata?.size || { width: 210, height: 297 },
        pages: session.metadata?.pages || 1,
        binding: session.metadata?.binding || 'perfect',
        bleed: session.metadata?.bleed || 3,
        paperThickness: session.metadata?.paperThickness,
      };

      // ── 블리드 / 재단선 / 사이즈 허용오차 + 재단/작업 사이즈 주입 (2026-06-10) ──
      // ⚠️ P1: 워커는 이 필드를 받기만(optional) 하고 실제 검증/변환은 아직 사용 안 함(P4).
      // templateSet 조회 실패해도 세션 완료는 계속(기존 try/catch 패턴 재사용).
      if (session.templateSetId) {
        try {
          const templateSet = await this.templateSetsService.findOne(session.templateSetId);
          const bleedMm = templateSet.bleedMm ?? 3;
          const trimWidth = templateSet.width;
          const trimHeight = templateSet.height;
          orderOptions.bleedMm = bleedMm;
          orderOptions.cropMarkEnabled = templateSet.cropMarkEnabled ?? false;
          orderOptions.sizeToleranceMm = templateSet.sizeToleranceMm ?? 0.2;
          // 재단(trim) = 템플릿셋 판형. 작업(work) = 재단 + 사방 블리드*2.
          // 워커 수신 필드명(trimSize/workSize)에 맞춤.
          orderOptions.trimSize = { width: trimWidth, height: trimHeight };
          orderOptions.workSize = {
            width: trimWidth + bleedMm * 2,
            height: trimHeight + bleedMm * 2,
          };
        } catch (error) {
          this.logger.warn(
            `[validation-jobs] templateSet ${session.templateSetId} 조회 실패(블리드/허용오차 주입 생략, 완료는 계속): ${error.message}`,
          );
        }
      }

      // Create validation job for cover file
      if (session.coverFileId) {
        try {
          const job = await this.workerJobsService.createValidationJob({
            editSessionId: session.id,
            fileId: session.coverFileId,
            fileType: 'cover',
            orderOptions,
          });
          this.logger.log(
            `Created validation job ${job.id} for cover file ${session.coverFileId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to create validation job for cover file: ${error.message}`,
          );
        }
      }

      // Create validation job for content file
      if (session.contentFileId) {
        try {
          const job = await this.workerJobsService.createValidationJob({
            editSessionId: session.id,
            fileId: session.contentFileId,
            fileType: 'content',
            orderOptions,
          });
          this.logger.log(
            `Created validation job ${job.id} for content file ${session.contentFileId}`,
          );
        } catch (error) {
          this.logger.error(
            `Failed to create validation job for content file: ${error.message}`,
          );
        }
      }
    } catch (error) {
      // Don't fail session completion if worker job creation fails
      this.logger.error(
        `Failed to create validation jobs for session ${session.id}: ${error.message}`,
      );
    }
  }

  /**
   * 세션 삭제 (소프트 삭제)
   */
  async delete(id: string, userId: number): Promise<void> {
    const session = await this.findById(id);

    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 삭제할 권한이 없습니다.',
      });
    }

    await this.sessionRepository.softDelete(id);
    this.logger.log(`Deleted edit session ${id}`);
  }

  /**
   * 엔티티를 응답 DTO로 변환
   */
  toResponseDto(session: EditSessionEntity): EditSessionResponseDto {
    const response: EditSessionResponseDto = {
      id: session.id,
      orderSeqno: Number(session.orderSeqno),
      memberSeqno: Number(session.memberSeqno),
      status: session.status,
      mode: session.mode,
      coverFileId: session.coverFileId,
      contentFileId: session.contentFileId,
      templateSetId: session.templateSetId,
      canvasData: session.canvasData,
      metadata: session.metadata,
      completedAt: session.completedAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      siteId: session.siteId, // Phase C-3
      // ── 인쇄 워크플로우 v1 Phase 4 (2026-05-19) ──
      contentPdfFileId: session.contentPdfFileId,
      contentPdfPageCount: session.contentPdfPageCount,
      contentPdfValidationResult: session.contentPdfValidationResult,
      contentPdfMode: session.contentPdfMode, // P0-2
      guestToken: session.guestToken,
      guestExpiresAt: session.guestExpiresAt,
    };

    // 파일 정보 추가
    if (session.coverFile) {
      response.coverFile = this.toFileInfoDto(session.coverFile);
    }
    if (session.contentFile) {
      response.contentFile = this.toFileInfoDto(session.contentFile);
    }

    return response;
  }

  private toFileInfoDto(file: any): FileInfoDto {
    return {
      id: file.id,
      fileName: file.fileName,
      originalName: file.originalName,
      thumbnailUrl: file.thumbnailUrl,
      fileSize: Number(file.fileSize),
      mimeType: file.mimeType,
    };
  }
}
