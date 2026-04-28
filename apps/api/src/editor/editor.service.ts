import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { EditSession, EditHistory } from './entities/edit-session.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { Template } from '../templates/entities/template.entity';
import {
  CreateEditSessionDto,
  UpdateEditSessionDto,
  AutoSaveDto,
  AddPageDto,
  ReorderPagesDto,
  ReplaceTemplateDto,
  ReplaceTemplateSetDto,
  ChangeStatusDto,
  AcquireLockDto,
  SessionQueryDto,
} from './dto/edit-session.dto';
import { TemplateType } from '@storige/types';
import type { EditPage, EditStatus, PaginatedResponse } from '@storige/types';
import { EditSessionsService } from '../edit-sessions/edit-sessions.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';

// 잠금 만료 시간 (30분)
const LOCK_EXPIRY_MS = 30 * 60 * 1000;

@Injectable()
export class EditorService {
  constructor(
    @InjectRepository(EditSession)
    private editSessionRepository: Repository<EditSession>,
    @InjectRepository(EditHistory)
    private editHistoryRepository: Repository<EditHistory>,
    @InjectRepository(TemplateSet)
    private templateSetRepository: Repository<TemplateSet>,
    @InjectRepository(Template)
    private templateRepository: Repository<Template>,
    private editSessionsService: EditSessionsService,
    private workerJobsService: WorkerJobsService,
  ) {}

  /**
   * 편집 세션 생성 (템플릿셋 기반)
   */
  async createSession(dto: CreateEditSessionDto): Promise<EditSession> {
    // 템플릿셋 조회
    const templateSet = await this.templateSetRepository.findOne({
      where: { id: dto.templateSetId, isDeleted: false },
    });

    if (!templateSet) {
      throw new NotFoundException(`템플릿셋을 찾을 수 없습니다: ${dto.templateSetId}`);
    }

    // 템플릿 정보 조회 및 초기 페이지 생성
    const pages: EditPage[] = [];
    for (let i = 0; i < templateSet.templates.length; i++) {
      const ref = templateSet.templates[i];
      const template = await this.templateRepository.findOne({
        where: { id: ref.templateId },
      });

      if (template) {
        pages.push({
          id: uuidv4(),
          templateId: ref.templateId,
          templateType: template.type,
          canvasData: template.canvasData,
          sortOrder: i,
          required: ref.required,
          deleteable: template.deleteable,
        });
      }
    }

    const session = this.editSessionRepository.create({
      templateSetId: dto.templateSetId,
      orderId: dto.orderId || null,
      userId: dto.userId || null,
      pages,
      status: 'draft' as EditStatus,
      // Legacy fields
      templateId: dto.templateId || null,
      canvasData: dto.canvasData || null,
      orderOptions: dto.orderOptions || null,
    });

    return this.editSessionRepository.save(session);
  }

  /**
   * 편집 세션 목록 조회
   */
  async findAll(query: SessionQueryDto): Promise<PaginatedResponse<EditSession>> {
    const {
      userId,
      orderId,
      status,
      page = 1,
      pageSize = 20,
    } = query;

    const qb = this.editSessionRepository.createQueryBuilder('session');

    if (userId) {
      qb.andWhere('session.userId = :userId', { userId });
    }
    if (orderId) {
      qb.andWhere('session.orderId = :orderId', { orderId });
    }
    if (status) {
      qb.andWhere('session.status = :status', { status });
    }

    qb.leftJoinAndSelect('session.templateSet', 'templateSet')
      .orderBy('session.updatedAt', 'DESC');

    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return { items, total, page, pageSize };
  }

  /**
   * 편집 세션 상세 조회
   */
  async findOne(id: string): Promise<EditSession> {
    const session = await this.editSessionRepository.findOne({
      where: { id },
      relations: ['templateSet', 'user', 'lockedByUser'],
    });

    if (!session) {
      throw new NotFoundException(`편집 세션을 찾을 수 없습니다: ${id}`);
    }

    return session;
  }

  /**
   * 편집 세션 업데이트
   */
  async updateSession(
    id: string,
    dto: UpdateEditSessionDto,
    userId?: string,
  ): Promise<EditSession> {
    const session = await this.findOne(id);

    // 잠금 확인
    this.checkLock(session, userId);

    Object.assign(session, dto);
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    return this.editSessionRepository.save(session);
  }

  /**
   * 자동 저장
   */
  async autoSave(id: string, dto: AutoSaveDto, userId?: string): Promise<EditSession> {
    const session = await this.findOne(id);

    // 잠금 확인
    this.checkLock(session, userId);

    if (dto.pages) {
      session.pages = dto.pages;
    }
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    return this.editSessionRepository.save(session);
  }

  /**
   * 페이지 추가
   */
  async addPage(id: string, dto: AddPageDto, userId?: string): Promise<EditSession> {
    const session = await this.findOne(id);
    this.checkLock(session, userId);

    if (!session.templateSetId) {
      throw new BadRequestException('템플릿셋이 연결되어 있지 않습니다.');
    }

    const templateSet = await this.templateSetRepository.findOne({
      where: { id: session.templateSetId },
    });

    if (!templateSet?.canAddPage) {
      throw new BadRequestException('이 템플릿셋은 페이지 추가가 허용되지 않습니다.');
    }

    // 현재 내지(page) 수량 확인
    const currentPageCount = session.pages?.filter((p) => p.templateType === TemplateType.PAGE).length || 0;
    const maxPageCount = Math.max(...(templateSet.pageCountRange || [999]));

    if (currentPageCount >= maxPageCount) {
      throw new BadRequestException(
        `내지 수량이 최대 한도(${maxPageCount})에 도달했습니다.`,
      );
    }

    // 마지막 내지 템플릿 복제
    const pages = session.pages || [];
    const lastPageTemplate = [...pages]
      .reverse()
      .find((p) => p.templateType === TemplateType.PAGE);

    if (!lastPageTemplate) {
      throw new BadRequestException('복제할 내지 템플릿이 없습니다.');
    }

    const newPage: EditPage = {
      id: uuidv4(),
      templateId: lastPageTemplate.templateId,
      templateType: TemplateType.PAGE,
      canvasData: {
        ...lastPageTemplate.canvasData,
        objects: [], // 빈 페이지로 생성
      },
      sortOrder: pages.length,
      required: false,
      deleteable: true,
    };

    // 위치 결정 (기본: 마지막 내지 뒤)
    let position = dto.position;
    if (position === undefined) {
      // findLastIndex 대신 직접 구현 (ES2023 이전 호환)
      let lastPageIndex = -1;
      for (let i = pages.length - 1; i >= 0; i--) {
        if (pages[i].templateType === TemplateType.PAGE) {
          lastPageIndex = i;
          break;
        }
      }
      position = lastPageIndex + 1;
    }

    pages.splice(position, 0, newPage);

    // sortOrder 재계산
    pages.forEach((p, i) => (p.sortOrder = i));

    session.pages = pages;
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    // 이력 기록
    await this.addHistory(session.id, userId || '', '페이지 추가');

    return this.editSessionRepository.save(session);
  }

  /**
   * 페이지 삭제
   */
  async deletePage(id: string, pageId: string, userId?: string): Promise<EditSession> {
    const session = await this.findOne(id);
    this.checkLock(session, userId);

    const pages = session.pages || [];
    const pageIndex = pages.findIndex((p) => p.id === pageId);

    if (pageIndex === -1) {
      throw new NotFoundException(`페이지를 찾을 수 없습니다: ${pageId}`);
    }

    const page = pages[pageIndex];

    if (!page.deleteable) {
      throw new BadRequestException('이 페이지는 삭제할 수 없습니다.');
    }

    if (page.required) {
      throw new BadRequestException('필수 페이지는 삭제할 수 없습니다.');
    }

    // 내지 수량 범위 확인
    let templateSet: TemplateSet | null = null;
    if (session.templateSetId) {
      templateSet = await this.templateSetRepository.findOne({
        where: { id: session.templateSetId },
      });
    }

    const currentPageCount = pages.filter((p) => p.templateType === TemplateType.PAGE).length;
    const minPageCount = Math.min(...(templateSet?.pageCountRange || [1]));

    if (page.templateType === TemplateType.PAGE && currentPageCount <= minPageCount) {
      throw new BadRequestException(
        `내지 수량이 최소 한도(${minPageCount})입니다.`,
      );
    }

    pages.splice(pageIndex, 1);
    pages.forEach((p, i) => (p.sortOrder = i));

    session.pages = pages;
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    await this.addHistory(session.id, userId || '', '페이지 삭제');

    return this.editSessionRepository.save(session);
  }

  /**
   * 페이지 순서 변경
   */
  async reorderPages(
    id: string,
    dto: ReorderPagesDto,
    userId?: string,
  ): Promise<EditSession> {
    const session = await this.findOne(id);
    this.checkLock(session, userId);

    const pages = session.pages || [];
    const pageMap = new Map(pages.map((p) => [p.id, p]));

    // 내지(page) 타입만 순서 변경 가능
    const reorderedPages: EditPage[] = [];
    for (const pageId of dto.pageIds) {
      const page = pageMap.get(pageId);
      if (!page) {
        throw new BadRequestException(`페이지를 찾을 수 없습니다: ${pageId}`);
      }
      if (page.templateType !== TemplateType.PAGE) {
        throw new BadRequestException('내지(page) 타입만 순서 변경이 가능합니다.');
      }
      reorderedPages.push(page);
    }

    // 고정 페이지 (wing, cover, spine)와 재정렬된 페이지 병합
    const fixedPages = pages.filter((p) => p.templateType !== TemplateType.PAGE);
    const allPages = [...fixedPages, ...reorderedPages];
    allPages.forEach((p, i) => (p.sortOrder = i));

    session.pages = allPages;
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    return this.editSessionRepository.save(session);
  }

  /**
   * 편집 잠금 획득
   */
  async acquireLock(id: string, dto: AcquireLockDto): Promise<EditSession> {
    const session = await this.findOne(id);

    // 기존 잠금 확인 (만료되지 않은 경우)
    if (session.lockedBy && session.lockedAt) {
      const lockAge = Date.now() - session.lockedAt.getTime();
      if (lockAge < LOCK_EXPIRY_MS && session.lockedBy !== dto.userId) {
        throw new ConflictException({
          message: '다른 사용자가 편집 중입니다.',
          lockedBy: session.lockedBy,
          lockedAt: session.lockedAt,
        });
      }
    }

    session.lockedBy = dto.userId;
    session.lockedAt = new Date();

    return this.editSessionRepository.save(session);
  }

  /**
   * 편집 잠금 해제
   */
  async releaseLock(id: string, userId: string): Promise<EditSession> {
    const session = await this.findOne(id);

    if (session.lockedBy !== userId) {
      throw new BadRequestException('잠금을 해제할 권한이 없습니다.');
    }

    session.lockedBy = null;
    session.lockedAt = null;

    return this.editSessionRepository.save(session);
  }

  /**
   * 상태 변경
   */
  async changeStatus(
    id: string,
    dto: ChangeStatusDto,
    userId: string,
  ): Promise<EditSession> {
    const session = await this.findOne(id);

    session.status = dto.status as EditStatus;
    session.modifiedBy = userId;
    session.modifiedAt = new Date();

    // 잠금 해제
    session.lockedBy = null;
    session.lockedAt = null;

    await this.addHistory(
      session.id,
      userId,
      `상태 변경: ${dto.status}`,
      dto.comment,
    );

    return this.editSessionRepository.save(session);
  }

  /**
   * 편집 이력 조회
   */
  async getHistory(sessionId: string): Promise<EditHistory[]> {
    return this.editHistoryRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      relations: ['user'],
    });
  }

  /**
   * 세션 삭제
   */
  async deleteSession(id: string): Promise<void> {
    const session = await this.findOne(id);
    await this.editSessionRepository.remove(session);
  }

  /**
   * 템플릿 교체 (사용자 요소 보존)
   */
  async replaceTemplate(
    id: string,
    dto: ReplaceTemplateDto,
    userId?: string,
  ): Promise<EditSession> {
    const session = await this.findOne(id);
    this.checkLock(session, userId);

    const newTemplate = await this.templateRepository.findOne({
      where: { id: dto.newTemplateId, isDeleted: false },
    });

    if (!newTemplate) {
      throw new NotFoundException(`템플릿을 찾을 수 없습니다: ${dto.newTemplateId}`);
    }

    const pages = session.pages || [];

    if (dto.pageId) {
      // 특정 페이지만 교체
      const pageIndex = pages.findIndex((p) => p.id === dto.pageId);
      if (pageIndex === -1) {
        throw new NotFoundException(`페이지를 찾을 수 없습니다: ${dto.pageId}`);
      }

      const page = pages[pageIndex];

      // 사용자 추가 요소 추출 (isUserAdded: true)
      const userObjects = page.canvasData?.objects?.filter(
        (obj) => obj.isUserAdded === true,
      ) || [];

      // 새 템플릿 데이터에 사용자 요소 병합
      pages[pageIndex] = {
        ...page,
        templateId: dto.newTemplateId,
        templateType: newTemplate.type,
        canvasData: {
          ...newTemplate.canvasData,
          objects: [
            ...(newTemplate.canvasData?.objects || []),
            ...userObjects,
          ],
        },
      };
    } else {
      // 같은 타입의 모든 페이지 교체
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].templateType === newTemplate.type) {
          // 사용자 추가 요소 추출
          const userObjects = pages[i].canvasData?.objects?.filter(
            (obj) => obj.isUserAdded === true,
          ) || [];

          pages[i] = {
            ...pages[i],
            templateId: dto.newTemplateId,
            canvasData: {
              ...newTemplate.canvasData,
              objects: [
                ...(newTemplate.canvasData?.objects || []),
                ...userObjects,
              ],
            },
          };
        }
      }
    }

    session.pages = pages;
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    await this.addHistory(session.id, userId || '', '템플릿 교체');

    return this.editSessionRepository.save(session);
  }

  /**
   * 템플릿셋 교체
   */
  async replaceTemplateSet(
    id: string,
    dto: ReplaceTemplateSetDto,
    userId?: string,
  ): Promise<EditSession> {
    const session = await this.findOne(id);
    this.checkLock(session, userId);

    // 새 템플릿셋 조회
    const newTemplateSet = await this.templateSetRepository.findOne({
      where: { id: dto.newTemplateSetId, isDeleted: false },
    });

    if (!newTemplateSet) {
      throw new NotFoundException(`템플릿셋을 찾을 수 없습니다: ${dto.newTemplateSetId}`);
    }

    // 기존 사용자 추가 요소 수집 (모든 페이지에서)
    const allUserObjects: Array<{ templateType: TemplateType; objects: any[] }> = [];
    for (const page of session.pages || []) {
      const userObjects = page.canvasData?.objects?.filter(
        (obj) => obj.isUserAdded === true,
      ) || [];
      if (userObjects.length > 0) {
        allUserObjects.push({
          templateType: page.templateType,
          objects: userObjects,
        });
      }
    }

    // 새 템플릿셋으로 페이지 재생성
    const newPages: EditPage[] = [];
    for (let i = 0; i < newTemplateSet.templates.length; i++) {
      const ref = newTemplateSet.templates[i];
      const template = await this.templateRepository.findOne({
        where: { id: ref.templateId },
      });

      if (template) {
        // 같은 타입의 사용자 요소 찾기
        const userObjectsForType = allUserObjects.find(
          (u) => u.templateType === template.type,
        );

        newPages.push({
          id: uuidv4(),
          templateId: ref.templateId,
          templateType: template.type,
          canvasData: {
            ...template.canvasData,
            objects: [
              ...(template.canvasData?.objects || []),
              ...(userObjectsForType?.objects || []),
            ],
          },
          sortOrder: i,
          required: ref.required,
          deleteable: template.deleteable,
        });
      }
    }

    session.templateSetId = dto.newTemplateSetId;
    session.pages = newPages;
    session.modifiedBy = userId || null;
    session.modifiedAt = new Date();

    await this.addHistory(session.id, userId || '', '템플릿셋 교체');

    return this.editSessionRepository.save(session);
  }

  /**
   * 저장 검증 (내지 수량, 필수 페이지 확인)
   */
  async validateSession(id: string): Promise<{
    valid: boolean;
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  }> {
    const session = await this.findOne(id);
    const errors: Array<{ code: string; message: string }> = [];
    const warnings: Array<{ code: string; message: string }> = [];

    if (!session.templateSetId) {
      errors.push({
        code: 'NO_TEMPLATE_SET',
        message: '템플릿셋이 연결되어 있지 않습니다.',
      });
      return { valid: false, errors, warnings };
    }

    const templateSet = await this.templateSetRepository.findOne({
      where: { id: session.templateSetId },
    });

    if (!templateSet) {
      errors.push({
        code: 'TEMPLATE_SET_NOT_FOUND',
        message: '연결된 템플릿셋을 찾을 수 없습니다.',
      });
      return { valid: false, errors, warnings };
    }

    const pages = session.pages || [];

    // 필수 페이지 확인
    for (const ref of templateSet.templates) {
      if (ref.required) {
        const hasRequiredPage = pages.some(
          (p) => p.templateId === ref.templateId || (p.required && p.templateType),
        );
        if (!hasRequiredPage) {
          errors.push({
            code: 'MISSING_REQUIRED_PAGE',
            message: `필수 페이지가 누락되었습니다.`,
          });
          break;
        }
      }
    }

    // 내지 수량 확인
    const pageTypeCount = pages.filter((p) => p.templateType === TemplateType.PAGE).length;
    const pageCountRange = templateSet.pageCountRange || [];

    if (pageCountRange.length > 0) {
      const minPages = Math.min(...pageCountRange);
      const maxPages = Math.max(...pageCountRange);

      if (pageTypeCount < minPages) {
        errors.push({
          code: 'PAGE_COUNT_TOO_LOW',
          message: `내지 수량이 최소 ${minPages}페이지 이상이어야 합니다. (현재: ${pageTypeCount})`,
        });
      } else if (pageTypeCount > maxPages) {
        errors.push({
          code: 'PAGE_COUNT_TOO_HIGH',
          message: `내지 수량이 최대 ${maxPages}페이지를 초과할 수 없습니다. (현재: ${pageTypeCount})`,
        });
      } else if (!pageCountRange.includes(pageTypeCount)) {
        warnings.push({
          code: 'PAGE_COUNT_NOT_IN_RANGE',
          message: `내지 수량이 권장 범위에 포함되지 않습니다. (현재: ${pageTypeCount}, 권장: ${pageCountRange.join(', ')})`,
        });
      }
    }

    // 빈 페이지 경고
    for (const page of pages) {
      if (!page.canvasData?.objects || page.canvasData.objects.length === 0) {
        warnings.push({
          code: 'EMPTY_PAGE',
          message: `빈 페이지가 있습니다. (페이지 ${page.sortOrder + 1})`,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * PDF 내보내기 — worker 합성 잡 발행
   *
   * EditSession에 업로드된 cover/content PDF 파일을 worker queue로 보내
   * 합성/병합 작업을 트리거한다. 합성 완료 시 session.callbackUrl 또는
   * exportOptions.callbackUrl 로 webhook이 송신된다.
   */
  async exportToPdf(
    sessionId: string,
    exportOptions?: {
      spineWidth?: number;
      orderId?: string;
      priority?: 'high' | 'normal' | 'low';
      callbackUrl?: string;
      outputFormat?: 'merged' | 'separate';
    },
  ): Promise<{ jobId: string; status: string }> {
    // 1) editor 모듈 측 EditSession 존재 확인 (legacy 호환)
    await this.findOne(sessionId);

    // 2) edit-sessions 모듈에서 파일 ID / 메타데이터 조회
    const session = await this.editSessionsService.findById(sessionId);

    if (!session.coverFileId) {
      throw new BadRequestException({
        code: 'COVER_FILE_REQUIRED',
        message: '표지 PDF 파일이 업로드되지 않았습니다. 먼저 편집 완료를 진행해 주세요.',
      });
    }
    if (!session.contentFileId) {
      throw new BadRequestException({
        code: 'CONTENT_FILE_REQUIRED',
        message: '내지 PDF 파일이 업로드되지 않았습니다. 먼저 편집 완료를 진행해 주세요.',
      });
    }

    const spineWidth = Number(
      session.metadata?.spine?.spineWidthMm ??
        exportOptions?.spineWidth ??
        0,
    );

    const job = await this.workerJobsService.createSynthesisJob({
      editSessionId: session.id,
      coverFileId: session.coverFileId,
      contentFileId: session.contentFileId,
      spineWidth,
      orderId:
        session.orderSeqno != null
          ? String(session.orderSeqno)
          : exportOptions?.orderId,
      callbackUrl: session.callbackUrl ?? exportOptions?.callbackUrl,
      outputFormat: exportOptions?.outputFormat ?? 'merged',
      priority: exportOptions?.priority,
    });

    return { jobId: job.id, status: job.status };
  }

  // ==================== Private Methods ====================

  /**
   * 잠금 확인
   */
  private checkLock(session: EditSession, userId?: string): void {
    if (!session.lockedBy || !session.lockedAt) return;

    const lockAge = Date.now() - session.lockedAt.getTime();
    if (lockAge >= LOCK_EXPIRY_MS) return; // 만료됨

    if (session.lockedBy !== userId) {
      throw new ConflictException({
        message: '다른 사용자가 편집 중입니다.',
        lockedBy: session.lockedBy,
        lockedAt: session.lockedAt,
      });
    }
  }

  /**
   * 이력 추가
   */
  private async addHistory(
    sessionId: string,
    userId: string,
    action: string,
    details?: string,
  ): Promise<void> {
    const history = this.editHistoryRepository.create({
      sessionId,
      userId,
      action,
      details: details || null,
    });
    await this.editHistoryRepository.save(history);
  }
}
