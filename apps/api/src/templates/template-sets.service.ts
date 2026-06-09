import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TemplateSet, TemplateSetItem } from './entities/template-set.entity';
import { TemplateSetLibraryCategory } from './entities/template-set-library-category.entity';
import { Template } from './entities/template.entity';
import { Product } from '../products/entities/product.entity';
import {
  CreateTemplateSetDto,
  UpdateTemplateSetDto,
  TemplateSetQueryDto,
  AddTemplateDto,
  ReorderTemplatesDto,
} from './dto/template-set.dto';
import { EditorMode } from '@storige/types';
import type { TemplateRef, PaginatedResponse } from '@storige/types';

@Injectable()
export class TemplateSetsService {
  constructor(
    @InjectRepository(TemplateSet)
    private templateSetRepository: Repository<TemplateSet>,
    @InjectRepository(TemplateSetItem)
    private templateSetItemRepository: Repository<TemplateSetItem>,
    @InjectRepository(Template)
    private templateRepository: Repository<Template>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(TemplateSetLibraryCategory)
    private tslcRepository: Repository<TemplateSetLibraryCategory>,
  ) {}

  /** ④ 템플릿셋의 노출 라이브러리 카테고리 ID 목록 로드 (없으면 빈 배열 = 전역) */
  private async loadLibraryCategoryIds(templateSetId: string): Promise<string[]> {
    const rows = await this.tslcRepository.find({
      where: { templateSetId },
      order: { sortOrder: 'ASC' },
    });
    return rows.map((r) => r.libraryCategoryId);
  }

  /** ④ 템플릿셋의 라이브러리 카테고리 연결을 전량 교체(delete-then-insert) */
  private async setLibraryCategories(templateSetId: string, ids: string[]): Promise<void> {
    await this.tslcRepository.delete({ templateSetId });
    const unique = [...new Set((ids || []).filter(Boolean))];
    if (unique.length === 0) return;
    const rows = unique.map((libraryCategoryId, i) =>
      this.tslcRepository.create({ templateSetId, libraryCategoryId, sortOrder: i }),
    );
    await this.tslcRepository.save(rows);
  }

  /**
   * 템플릿셋 생성
   */
  async create(dto: CreateTemplateSetDto): Promise<TemplateSet> {
    const editorMode = dto.editorMode ?? EditorMode.SINGLE;

    // 템플릿 유효성 검사
    if (dto.templates && dto.templates.length > 0) {
      await this.validateTemplates(dto.templates, dto.width, dto.height, editorMode);
    }

    // 썸네일 URL이 없으면 첫 번째 템플릿의 썸네일 사용
    let thumbnailUrl = dto.thumbnailUrl || null;
    if (!thumbnailUrl && dto.templates && dto.templates.length > 0) {
      thumbnailUrl = await this.getFirstTemplateThumbnail(dto.templates);
    }

    const templateSet = this.templateSetRepository.create({
      name: dto.name,
      thumbnailUrl,
      type: dto.type,
      width: dto.width,
      height: dto.height,
      canAddPage: dto.canAddPage ?? true,
      pageCountRange: dto.pageCountRange || [],
      templates: dto.templates || [],
      editorMode,
      // null = 모든 메뉴 노출(기본). admin 에서 명시적으로 배열을 보내면 화이트리스트로 작동.
      enabledMenus: dto.enabledMenus ?? null,
      categoryId: dto.categoryId || null,
      // 생성 시에도 인쇄 워크플로우/출력 설정 저장(이전엔 누락되어 entity 기본값으로만 저장됨)
      endpaperConfig: dto.endpaperConfig ?? null,
      coverEditable: dto.coverEditable ?? true,
      coverPreviewImage: dto.coverPreviewImage ?? null,
      contentPdfEditable: dto.contentPdfEditable ?? true,
      pdfOutputMode: dto.pdfOutputMode ?? 'duplex-merged',
      isDeleted: false,
      isActive: true,
    });

    const saved = await this.templateSetRepository.save(templateSet);
    // ④ 라이브러리 카테고리 연결(undefined면 미설정 = 전역 유지)
    if (dto.libraryCategoryIds !== undefined) {
      await this.setLibraryCategories(saved.id, dto.libraryCategoryIds);
    }
    saved.libraryCategoryIds = await this.loadLibraryCategoryIds(saved.id);
    return saved;
  }

  /**
   * 템플릿셋 목록 조회
   */
  async findAll(query: TemplateSetQueryDto): Promise<PaginatedResponse<TemplateSet>> {
    const {
      type,
      width,
      height,
      categoryId,
      isActive,
      includeDeleted = false,
      page = 1,
      pageSize = 20,
    } = query;

    const qb = this.templateSetRepository.createQueryBuilder('ts');

    // 소프트 삭제 필터
    if (!includeDeleted) {
      qb.andWhere('ts.isDeleted = :isDeleted', { isDeleted: false });
    }

    // 타입 필터
    if (type) {
      qb.andWhere('ts.type = :type', { type });
    }

    // 판형 필터
    if (width) {
      qb.andWhere('ts.width = :width', { width });
    }
    if (height) {
      qb.andWhere('ts.height = :height', { height });
    }

    // 카테고리 필터
    if (categoryId) {
      qb.andWhere('ts.categoryId = :categoryId', { categoryId });
    }

    // 활성 상태 필터
    if (isActive !== undefined) {
      qb.andWhere('ts.isActive = :isActive', { isActive });
    }

    // 정렬
    qb.orderBy('ts.createdAt', 'DESC');

    // 페이지네이션
    const skip = (page - 1) * pageSize;
    qb.skip(skip).take(pageSize);

    const [items, total] = await qb.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 템플릿셋 상세 조회
   */
  async findOne(id: string): Promise<TemplateSet> {
    const templateSet = await this.templateSetRepository.findOne({
      where: { id, isDeleted: false },
      relations: ['category'],
    });

    if (!templateSet) {
      throw new NotFoundException(`템플릿셋을 찾을 수 없습니다: ${id}`);
    }

    // ④ 연결된 라이브러리 카테고리 populate
    templateSet.libraryCategoryIds = await this.loadLibraryCategoryIds(id);
    return templateSet;
  }

  /**
   * 템플릿셋과 템플릿 상세 정보 조회
   */
  async findOneWithTemplates(id: string): Promise<{
    templateSet: TemplateSet;
    templateDetails: Template[];
  }> {
    const templateSet = await this.findOne(id);

    // 템플릿 상세 정보 조회
    const templateIds = templateSet.templates.map((t) => t.templateId);
    const templateDetails = templateIds.length > 0
      ? await this.templateRepository.findByIds(templateIds)
      : [];

    // 순서대로 정렬
    const orderedTemplates = templateIds.map((id) =>
      templateDetails.find((t) => t.id === id),
    ).filter(Boolean) as Template[];

    return {
      templateSet,
      templateDetails: orderedTemplates,
    };
  }

  /**
   * 템플릿셋 수정
   */
  async update(id: string, dto: UpdateTemplateSetDto): Promise<TemplateSet> {
    const templateSet = await this.findOne(id);

    const editorMode = dto.editorMode ?? templateSet.editorMode;

    // 템플릿 유효성 검사
    if (dto.templates) {
      const width = dto.width ?? templateSet.width;
      const height = dto.height ?? templateSet.height;
      await this.validateTemplates(dto.templates, width, height, editorMode);
    }

    // 템플릿 목록이 변경되었고 썸네일이 없으면 첫 번째 템플릿의 썸네일 사용
    let thumbnailUrl = dto.thumbnailUrl ?? templateSet.thumbnailUrl;
    const templates = dto.templates ?? templateSet.templates;
    if (!thumbnailUrl && templates && templates.length > 0) {
      thumbnailUrl = await this.getFirstTemplateThumbnail(templates);
    }

    // 업데이트 (libraryCategoryIds 는 컬럼이 아니므로 save 가 무시 — 조인은 아래에서 처리)
    Object.assign(templateSet, {
      ...dto,
      thumbnailUrl,
    });

    const saved = await this.templateSetRepository.save(templateSet);
    // ④ 라이브러리 카테고리 연결 교체(undefined면 기존 유지)
    if (dto.libraryCategoryIds !== undefined) {
      await this.setLibraryCategories(saved.id, dto.libraryCategoryIds);
    }
    saved.libraryCategoryIds = await this.loadLibraryCategoryIds(saved.id);
    return saved;
  }

  /**
   * 템플릿셋 삭제 (소프트 삭제) — 사용 중이면 차단
   *
   * 사용 여부 체크:
   * 1. products 테이블 — templateSetId FK 참조 중인 상품 (RelationId 기반)
   * 2. edit_sessions 테이블 — templateSetId 사용 중인 active 세션
   *
   * 어느 하나라도 > 0이면 BadRequestException, usage 카운트와 상품 ID 반환.
   * 운영 중 잘못된 삭제로 FK 위반/주문 깨짐을 방지.
   */
  async remove(id: string): Promise<{ affected: number; usedByProducts: string[] }> {
    const templateSet = await this.findOne(id);

    // 1. 이 템플릿셋을 사용 중인 상품 (활성 상품만)
    //    Product entity는 title + isActive (isDeleted 없음, name 대신 title)
    const usingProducts = await this.productRepository
      .createQueryBuilder('product')
      .leftJoin('product.templateSet', 'ts')
      .where('ts.id = :id', { id })
      .andWhere('product.isActive = :active', { active: true })
      .select(['product.id', 'product.title'])
      .getMany();

    // 2. 이 템플릿셋을 참조하는 활성 edit_sessions (legacy editor 모듈 테이블)
    //    소프트 삭제된 세션은 제외
    const activeSessionCount = await this.templateSetRepository.manager
      .createQueryBuilder()
      .select('COUNT(*)', 'cnt')
      .from('edit_sessions', 'es')
      .where('es.template_set_id = :id', { id })
      .andWhere("es.status != 'submitted'") // 완료된 세션은 자료 보존
      .getRawOne<{ cnt: string }>();

    const activeSessions = Number(activeSessionCount?.cnt ?? 0);
    const usedByProducts = usingProducts.map((p) => p.id);

    if (usingProducts.length > 0 || activeSessions > 0) {
      throw new BadRequestException({
        code: 'TEMPLATE_SET_IN_USE',
        message: '이 템플릿셋은 사용 중입니다. 먼저 상품/편집 세션을 정리하세요.',
        usage: {
          products: usingProducts.length,
          activeSessions,
          productIds: usedByProducts,
          productTitles: usingProducts.map((p) => p.title),
        },
      });
    }

    templateSet.isDeleted = true;
    templateSet.isActive = false;
    await this.templateSetRepository.save(templateSet);

    return { affected: 1, usedByProducts };
  }

  /**
   * 템플릿셋 복제
   */
  async copy(id: string): Promise<TemplateSet> {
    const original = await this.findOne(id);

    const copy = this.templateSetRepository.create({
      name: `${original.name} (복사본)`,
      thumbnailUrl: original.thumbnailUrl,
      type: original.type,
      width: original.width,
      height: original.height,
      canAddPage: original.canAddPage,
      pageCountRange: original.pageCountRange,
      templates: original.templates,
      categoryId: original.categoryId,
      isDeleted: false,
      isActive: true,
    });

    return this.templateSetRepository.save(copy);
  }

  /**
   * 연결된 상품 목록 조회
   */
  async getProducts(id: string): Promise<Product[]> {
    await this.findOne(id); // 존재 확인

    return this.productRepository.find({
      where: { templateSetId: id },
      select: ['id', 'title', 'productId', 'isActive', 'createdAt'],
      order: { title: 'ASC' },
    });
  }

  /**
   * 템플릿셋에 템플릿 추가
   */
  async addTemplate(id: string, dto: AddTemplateDto): Promise<TemplateSet> {
    const templateSet = await this.findOne(id);

    // 템플릿 존재 확인
    const template = await this.templateRepository.findOne({
      where: { id: dto.templateId, isDeleted: false },
    });

    if (!template) {
      throw new NotFoundException(`템플릿을 찾을 수 없습니다: ${dto.templateId}`);
    }

    // 판형 검사 (cover, page 타입만)
    if (['cover', 'page'].includes(template.type)) {
      if (template.width !== templateSet.width || template.height !== templateSet.height) {
        throw new BadRequestException(
          `템플릿 판형이 템플릿셋과 일치하지 않습니다. ` +
          `템플릿: ${template.width}x${template.height}, 템플릿셋: ${templateSet.width}x${templateSet.height}`,
        );
      }
    }

    // 템플릿 추가
    const newRef: TemplateRef = {
      templateId: dto.templateId,
      required: dto.required ?? false,
    };

    const templates = [...templateSet.templates];
    const position = dto.position ?? templates.length;
    templates.splice(position, 0, newRef);

    templateSet.templates = templates;
    return this.templateSetRepository.save(templateSet);
  }

  /**
   * 템플릿셋에서 템플릿 제거
   */
  async removeTemplate(id: string, templateId: string): Promise<TemplateSet> {
    const templateSet = await this.findOne(id);

    templateSet.templates = templateSet.templates.filter(
      (t) => t.templateId !== templateId,
    );

    return this.templateSetRepository.save(templateSet);
  }

  /**
   * 템플릿 순서 변경
   */
  async reorderTemplates(id: string, dto: ReorderTemplatesDto): Promise<TemplateSet> {
    const templateSet = await this.findOne(id);

    // 모든 템플릿 ID가 유효한지 확인
    const existingIds = new Set(templateSet.templates.map((t) => t.templateId));
    const newIds = new Set(dto.templates.map((t) => t.templateId));

    // 동일한 템플릿들인지 확인
    if (existingIds.size !== newIds.size) {
      throw new BadRequestException('템플릿 목록이 일치하지 않습니다.');
    }

    for (const id of existingIds) {
      if (!newIds.has(id)) {
        throw new BadRequestException(`누락된 템플릿: ${id}`);
      }
    }

    templateSet.templates = dto.templates;
    return this.templateSetRepository.save(templateSet);
  }

  /**
   * 같은 판형의 템플릿셋 조회 (템플릿셋 교체용)
   */
  async findCompatible(
    width: number,
    height: number,
    type?: string,
  ): Promise<TemplateSet[]> {
    const qb = this.templateSetRepository.createQueryBuilder('ts');

    qb.where('ts.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('ts.isActive = :isActive', { isActive: true })
      .andWhere('ts.width = :width', { width })
      .andWhere('ts.height = :height', { height });

    if (type) {
      qb.andWhere('ts.type = :type', { type });
    }

    qb.orderBy('ts.name', 'ASC');

    return qb.getMany();
  }

  /**
   * 템플릿 유효성 검사
   */
  private async validateTemplates(
    templates: TemplateRef[],
    width: number,
    height: number,
    editorMode: EditorMode = EditorMode.SINGLE,
  ): Promise<void> {
    const templateDetails: Template[] = [];

    for (const ref of templates) {
      const template = await this.templateRepository.findOne({
        where: { id: ref.templateId, isDeleted: false },
      });

      if (!template) {
        throw new NotFoundException(`템플릿을 찾을 수 없습니다: ${ref.templateId}`);
      }

      templateDetails.push(template);

      // cover, page 타입만 판형 검사
      if (['cover', 'page'].includes(template.type)) {
        if (template.width !== width || template.height !== height) {
          throw new BadRequestException(
            `템플릿 "${template.name}" 판형이 일치하지 않습니다. ` +
            `템플릿: ${template.width}x${template.height}, 템플릿셋: ${width}x${height}`,
          );
        }
      }
    }

    // editorMode별 템플릿 구성 검증
    if (editorMode === EditorMode.BOOK) {
      this.validateBookModeTemplates(templateDetails);
    } else {
      this.validateSingleModeTemplates(templateDetails);
    }
  }

  /**
   * 책모드 템플릿 구성 검증
   * - SPREAD 템플릿 정확히 1개 필수
   * - WING/COVER/SPINE 타입 불허
   * - PAGE 타입 1개 이상 필수
   */
  private validateBookModeTemplates(templates: Template[]): void {
    const spreadTemplates = templates.filter((t) => t.type === 'spread');
    const wingTemplates = templates.filter((t) => t.type === 'wing');
    const coverTemplates = templates.filter((t) => t.type === 'cover');
    const spineTemplates = templates.filter((t) => t.type === 'spine');
    const pageTemplates = templates.filter((t) => t.type === 'page');

    // SPREAD 타입 정확히 1개
    if (spreadTemplates.length === 0) {
      throw new BadRequestException(
        'editorMode=book일 때 SPREAD 타입 템플릿이 정확히 1개 필요합니다.',
      );
    }
    if (spreadTemplates.length > 1) {
      throw new BadRequestException(
        'editorMode=book일 때 SPREAD 타입 템플릿은 1개만 허용됩니다.',
      );
    }

    // WING/COVER/SPINE 타입 불허
    if (wingTemplates.length > 0) {
      throw new BadRequestException(
        'editorMode=book일 때 WING 타입 템플릿은 허용되지 않습니다. SPREAD 템플릿에 날개가 포함됩니다.',
      );
    }
    if (coverTemplates.length > 0) {
      throw new BadRequestException(
        'editorMode=book일 때 COVER 타입 템플릿은 허용되지 않습니다. SPREAD 템플릿에 표지가 포함됩니다.',
      );
    }
    if (spineTemplates.length > 0) {
      throw new BadRequestException(
        'editorMode=book일 때 SPINE 타입 템플릿은 허용되지 않습니다. SPREAD 템플릿에 책등이 포함됩니다.',
      );
    }

    // PAGE 타입 1개 이상
    if (pageTemplates.length === 0) {
      throw new BadRequestException(
        'editorMode=book일 때 PAGE 타입 템플릿이 최소 1개 필요합니다.',
      );
    }
  }

  /**
   * 단일모드 템플릿 구성 검증
   * - SPREAD 타입 불허
   */
  private validateSingleModeTemplates(templates: Template[]): void {
    const spreadTemplates = templates.filter((t) => t.type === 'spread');

    if (spreadTemplates.length > 0) {
      throw new BadRequestException(
        'editorMode=single일 때 SPREAD 타입 템플릿은 허용되지 않습니다.',
      );
    }
  }

  /**
   * 첫 번째 템플릿의 썸네일 URL 가져오기
   */
  private async getFirstTemplateThumbnail(
    templates: TemplateRef[],
  ): Promise<string | null> {
    if (!templates || templates.length === 0) {
      return null;
    }

    const firstTemplateId = templates[0].templateId;
    const template = await this.templateRepository.findOne({
      where: { id: firstTemplateId, isDeleted: false },
      select: ['thumbnailUrl'],
    });

    return template?.thumbnailUrl || null;
  }

  /**
   * 모든 템플릿셋의 썸네일 URL 일괄 업데이트
   * 썸네일이 없는 템플릿셋에 대해 첫 번째 템플릿의 썸네일을 설정
   */
  async updateAllThumbnails(): Promise<{ updated: number; total: number }> {
    // 모든 템플릿셋 조회 (삭제되지 않은 것만)
    const templateSets = await this.templateSetRepository.find({
      where: { isDeleted: false },
    });

    let updatedCount = 0;

    for (const templateSet of templateSets) {
      // 썸네일이 없고 템플릿이 있는 경우에만 업데이트
      if (!templateSet.thumbnailUrl && templateSet.templates && templateSet.templates.length > 0) {
        const thumbnailUrl = await this.getFirstTemplateThumbnail(templateSet.templates);
        if (thumbnailUrl) {
          templateSet.thumbnailUrl = thumbnailUrl;
          await this.templateSetRepository.save(templateSet);
          updatedCount++;
        }
      }
    }

    return {
      updated: updatedCount,
      total: templateSets.length,
    };
  }
}
