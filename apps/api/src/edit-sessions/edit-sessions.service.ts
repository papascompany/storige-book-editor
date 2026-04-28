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
import { WorkerJobStatus } from '@storige/types';

@Injectable()
export class EditSessionsService {
  private readonly logger = new Logger(EditSessionsService.name);

  constructor(
    @InjectRepository(EditSessionEntity)
    private sessionRepository: Repository<EditSessionEntity>,
    @Inject(forwardRef(() => WorkerJobsService))
    private workerJobsService: WorkerJobsService,
  ) {}

  /**
   * 편집 세션 생성
   */
  async create(dto: CreateEditSessionDto): Promise<EditSessionEntity> {
    // coverFileId/contentFileId는 @RelationId(read-only). ManyToOne relation을 통해 set.
    const session = this.sessionRepository.create({
      orderSeqno: dto.orderSeqno,
      memberSeqno: dto.memberSeqno,
      mode: dto.mode,
      coverFile: dto.coverFileId ? ({ id: dto.coverFileId } as any) : null,
      contentFile: dto.contentFileId ? ({ id: dto.contentFileId } as any) : null,
      templateSetId: dto.templateSetId,
      canvasData: dto.canvasData,
      metadata: dto.metadata,
      callbackUrl: dto.callbackUrl,
    });

    const saved = await this.sessionRepository.save(session);
    this.logger.log(`Created edit session ${saved.id} for order ${dto.orderSeqno}`);

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
   */
  async update(
    id: string,
    dto: UpdateEditSessionDto,
    userId: number,
  ): Promise<EditSessionEntity> {
    const session = await this.findById(id);

    // 권한 확인: 세션 소유자만 수정 가능
    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 수정할 권한이 없습니다.',
      });
    }

    // 캔버스 데이터 업데이트
    if (dto.canvasData !== undefined) {
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

    const updated = await this.sessionRepository.save(session);
    this.logger.log(`Updated edit session ${id}`);

    return updated;
  }

  /**
   * 세션 완료 처리
   */
  async complete(id: string, userId: number): Promise<EditSessionEntity> {
    const session = await this.findById(id);

    if (Number(session.memberSeqno) !== userId) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션을 완료할 권한이 없습니다.',
      });
    }

    // 스프레드 모드 스냅샷 검증 (하드 실패)
    if (session.mode === SessionMode.SPREAD) {
      this.validateSpreadSnapshot(session);
    }

    session.status = SessionStatus.COMPLETE;
    session.completedAt = new Date();

    const completed = await this.sessionRepository.save(session);
    this.logger.log(`Completed edit session ${id}`);

    // 스프레드 모드는 자동 검증 잡 발행을 스킵.
    // 표지(펼침면)는 일반 사이즈 검증(±1mm)에서 SIZE_MISMATCH가 나기 때문이며,
    // 실제 합성/검증은 PHP가 worker-jobs/synthesize/external 또는 spread 전용
    // 흐름을 호출하는 시점에 수행 (NEW_DEV_PLAN §3 PHP 무변경 정책과 정합).
    if (completed.mode !== SessionMode.SPREAD) {
      await this.createValidationJobs(completed);
    } else {
      this.logger.log(
        `Skipping auto validation jobs for SPREAD session ${id} (PHP-driven synthesis flow)`,
      );
    }

    return completed;
  }

  /**
   * 스프레드 모드 스냅샷 검증 (필수 필드 누락 시 하드 실패)
   */
  private validateSpreadSnapshot(session: EditSessionEntity): void {
    // metadata.spine 검증
    if (!session.metadata?.spine) {
      throw new BadRequestException({
        code: 'SPREAD_SNAPSHOT_MISSING',
        message: 'spread 모드 세션 완료 시 metadata.spine이 필수입니다.',
      });
    }

    const { spine } = session.metadata;
    if (!spine.spineWidthMm || !spine.pageCount || !spine.paperType || !spine.bindingType || !spine.formulaVersion) {
      throw new BadRequestException({
        code: 'SPREAD_SNAPSHOT_INVALID',
        message: 'metadata.spine의 필수 필드가 누락되었습니다: spineWidthMm, pageCount, paperType, bindingType, formulaVersion',
      });
    }

    // metadata.spread 검증
    if (!session.metadata?.spread) {
      throw new BadRequestException({
        code: 'SPREAD_SNAPSHOT_MISSING',
        message: 'spread 모드 세션 완료 시 metadata.spread가 필수입니다.',
      });
    }

    const { spread } = session.metadata;
    if (!spread.spec || !spread.totalWidthMm || !spread.totalHeightMm || !spread.dpi) {
      throw new BadRequestException({
        code: 'SPREAD_SNAPSHOT_INVALID',
        message: 'metadata.spread의 필수 필드가 누락되었습니다: spec, totalWidthMm, totalHeightMm, dpi',
      });
    }

    this.logger.log(`Validated spread snapshot for session ${session.id}`);
  }

  /**
   * 완료된 세션의 파일에 대한 Worker 검증 작업 생성
   */
  private async createValidationJobs(session: EditSessionEntity): Promise<void> {
    try {
      // Get order options from metadata or use defaults
      const orderOptions = {
        size: session.metadata?.size || { width: 210, height: 297 },
        pages: session.metadata?.pages || 1,
        binding: session.metadata?.binding || 'perfect',
        bleed: session.metadata?.bleed || 3,
        paperThickness: session.metadata?.paperThickness,
      };

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
