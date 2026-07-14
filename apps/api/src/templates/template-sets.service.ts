import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
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
import {
  applySiteScope,
  TenantScope,
} from '../common/helpers/tenant-scope.helper';
import {
  isNearlySquare,
  isExactOrientationSwap,
  orientationNameSuffix,
  withOrientationSuffix,
  transformCanvasDataOrientation,
} from './orientation-derive.util';

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
      pricing: dto.pricing ?? null, // 포토북 가격 메타 (Phase 2 §8)
      coverEditable: dto.coverEditable ?? true,
      coverPreviewImage: dto.coverPreviewImage ?? null,
      // D-4 커버 3종 메타 (2026-07-06, C-4 Track 3) — 생성 시에도 영속(additive nullable)
      coverType: dto.coverType ?? null,
      coverConfig: dto.coverConfig ?? null,
      contentPdfEditable: dto.contentPdfEditable ?? true,
      pdfOutputMode: dto.pdfOutputMode ?? 'duplex-merged',
      colorMode: dto.colorMode ?? 'rgb',
      // 블리드 / 재단선 / 사이즈 검증 허용오차 (2026-06-10)
      bleedMm: dto.bleedMm ?? 3,
      cropMarkEnabled: dto.cropMarkEnabled ?? false,
      sizeToleranceMm: dto.sizeToleranceMm ?? 0.2,
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
  async findAll(
    query: TemplateSetQueryDto,
    scope?: TenantScope,
  ): Promise<PaginatedResponse<TemplateSet>> {
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

    // P2b: 템플릿셋=hybrid. includeNull=true → 시스템공유(site_id=NULL) 셋 + 자기 site.
    if (scope) applySiteScope(qb, 'ts', scope, { includeNull: true });

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
    scope?: TenantScope,
  ): Promise<TemplateSet[]> {
    const qb = this.templateSetRepository.createQueryBuilder('ts');

    qb.where('ts.isDeleted = :isDeleted', { isDeleted: false })
      .andWhere('ts.isActive = :isActive', { isActive: true })
      .andWhere('ts.width = :width', { width })
      .andWhere('ts.height = :height', { height });

    if (type) {
      qb.andWhere('ts.type = :type', { type });
    }

    // P2b: hybrid. includeNull=true → 시스템공유 + 자기 site (편집기 '셋 교체'용).
    if (scope) applySiteScope(qb, 'ts', scope, { includeNull: true });

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

  // ─────────────────────────────────────────────────────
  // 방향(orientation) 페어링 + 파생 (2026-07-14, 오너 승인 설계)
  // 마이그레이션: apps/api/migrations/20260714_add_orientation_pair.sql
  // 불변식: 대칭 저장(양쪽이 서로를 가리킴) / 짝 중 is_orientation_default 정확히 1개.
  // 일반 PUT update 경로로는 두 필드를 설정할 수 없다(DTO 미노출 + forbidNonWhitelisted).
  // ─────────────────────────────────────────────────────

  /**
   * 페어링 기하 규칙 검증 — admin 헬퍼(formatPresetHelpers ±0.01mm)와 동일 시맨틱.
   * 존재/비삭제는 호출측 findOne 이 보장, 여기서는 정사각·정확 W↔H 스왑만 본다.
   */
  private assertOrientationPairGeometry(a: TemplateSet, b: TemplateSet): void {
    if (isNearlySquare(a.width, a.height) || isNearlySquare(b.width, b.height)) {
      throw new BadRequestException({
        code: 'ORIENTATION_PAIR_SQUARE',
        message: '정사각 판형은 방향 페어링이 무의미합니다(W↔H 스왑해도 동일).',
      });
    }
    if (!isExactOrientationSwap(a.width, a.height, b.width, b.height)) {
      throw new BadRequestException({
        code: 'ORIENTATION_PAIR_DIM_MISMATCH',
        message:
          `페어링은 같은 재단 규격의 정확 W↔H 스왑(±0.01mm)만 허용합니다. ` +
          `${a.width}x${a.height} ↔ ${b.width}x${b.height}`,
      });
    }
  }

  /**
   * 방향 페어링 — 대칭 저장(트랜잭션). :id 쪽이 기본 방향(default)이 된다.
   * 이미 서로 페어인 두 세트의 재호출은 멱등(default 재단언).
   */
  async pair(
    id: string,
    pairedTemplateSetId: string,
  ): Promise<{ success: true; data: TemplateSet }> {
    if (id === pairedTemplateSetId) {
      throw new BadRequestException({
        code: 'ORIENTATION_PAIR_SELF',
        message: '자기 자신과는 페어링할 수 없습니다.',
      });
    }

    const target = await this.findOne(id);
    const partner = await this.findOne(pairedTemplateSetId);

    if (target.pairedTemplateSetId && target.pairedTemplateSetId !== partner.id) {
      throw new ConflictException({
        code: 'ORIENTATION_ALREADY_PAIRED',
        message: `이미 다른 세트와 페어링되어 있습니다: ${target.pairedTemplateSetId}. 먼저 해제하세요.`,
      });
    }
    if (partner.pairedTemplateSetId && partner.pairedTemplateSetId !== target.id) {
      throw new ConflictException({
        code: 'ORIENTATION_ALREADY_PAIRED',
        message: `상대 세트가 이미 다른 세트와 페어링되어 있습니다: ${partner.pairedTemplateSetId}. 먼저 해제하세요.`,
      });
    }

    this.assertOrientationPairGeometry(target, partner);

    await this.templateSetRepository.manager.transaction(async (manager) => {
      await manager.update(TemplateSet, target.id, {
        pairedTemplateSetId: partner.id,
        isOrientationDefault: true,
      });
      await manager.update(TemplateSet, partner.id, {
        pairedTemplateSetId: target.id,
        isOrientationDefault: false,
      });
    });

    target.pairedTemplateSetId = partner.id;
    target.isOrientationDefault = true;
    return { success: true, data: target };
  }

  /**
   * 방향 페어링 해제 — 양쪽 모두 NULL + default 원복(비페어 세트는 자기 자신이 기본).
   */
  async unpair(id: string): Promise<{ success: true; data: TemplateSet }> {
    const target = await this.findOne(id);

    if (!target.pairedTemplateSetId) {
      throw new BadRequestException({
        code: 'ORIENTATION_NOT_PAIRED',
        message: '페어링되어 있지 않은 템플릿셋입니다.',
      });
    }

    const partnerId = target.pairedTemplateSetId;
    await this.templateSetRepository.manager.transaction(async (manager) => {
      await manager.update(TemplateSet, id, {
        pairedTemplateSetId: null,
        isOrientationDefault: true,
      });
      // 대칭 불변식상 상대는 반드시 나를 가리킨다 — 함께 해제(행이 없어도 affected 0 무해)
      await manager.update(TemplateSet, partnerId, {
        pairedTemplateSetId: null,
        isOrientationDefault: true,
      });
    });

    target.pairedTemplateSetId = null;
    target.isOrientationDefault = true;
    return { success: true, data: target };
  }

  /**
   * 방향 노출 기본 세팅 — :id 를 default 로, 짝 반대쪽은 자동 해제(트랜잭션).
   * 비페어 세트에도 허용(자기 자신 true 재단언 — 무해).
   */
  async setOrientationDefault(id: string): Promise<{ success: true; data: TemplateSet }> {
    const target = await this.findOne(id);

    await this.templateSetRepository.manager.transaction(async (manager) => {
      await manager.update(TemplateSet, id, { isOrientationDefault: true });
      if (target.pairedTemplateSetId) {
        await manager.update(TemplateSet, target.pairedTemplateSetId, {
          isOrientationDefault: false,
        });
      }
    });

    target.isOrientationDefault = true;
    return { success: true, data: target };
  }

  /**
   * 반대 방향 세트 파생 (오너 승인 설계 ③④, 2026-07-14).
   *
   * - 판형 W↔H 스왑 + 설정(bleedMm·sizeToleranceMm·cropMarkEnabled·pageCountRange·
   *   editorMode·enabledMenus·pricing 등) 복사, 이름 ' (가로)'/' (세로)' 접미.
   * - is_active=0 초안 — 사람 검수 후 활성.
   * - page류 템플릿만 복제·변환(위치만 축별 비율 재배치 — orientation-derive.util).
   *   spread(표지)/spine/wing/endpaper류는 이월하지 않음(책등·싸바리 기하 별도 저작).
   *   ⚠️ 따라서 editorMode=book 파생 초안은 SPREAD 없이 시작 — 활성 전 표지 저작 필요
   *   (create/update 의 validateBookModeTemplates 는 DTO 경로에만 적용되므로 저장 가능).
   * - 생성 즉시 원본과 대칭 페어링(원본 default 유지). 이미 짝이 있으면 409.
   */
  async deriveOrientation(id: string): Promise<{ success: true; data: TemplateSet }> {
    const original = await this.findOne(id);

    if (original.pairedTemplateSetId) {
      throw new ConflictException({
        code: 'ORIENTATION_ALREADY_PAIRED',
        message: `이미 방향 짝이 있는 템플릿셋입니다: ${original.pairedTemplateSetId}`,
      });
    }
    if (isNearlySquare(original.width, original.height)) {
      throw new BadRequestException({
        code: 'ORIENTATION_DERIVE_SQUARE',
        message: '정사각 판형은 방향 파생이 무의미합니다(W↔H 스왑해도 동일).',
      });
    }

    const newWidth = original.height;
    const newHeight = original.width;
    const suffix = orientationNameSuffix(newWidth, newHeight);

    // 원본 구성 템플릿 로드 (templates JSON 순서 보존)
    const refs = original.templates || [];
    const refIds = refs.map((r) => r.templateId);
    const found = refIds.length > 0 ? await this.templateRepository.findByIds(refIds) : [];
    const byId = new Map(found.map((t) => [t.id, t] as const));

    // 참조 무결성 — 셋이 가리키는 템플릿이 사라졌으면 파생 중단(부분 파생 방지)
    const missing = refs.filter((ref) => !byId.has(ref.templateId));
    if (missing.length > 0) {
      throw new NotFoundException(
        `템플릿셋이 참조하는 템플릿을 찾을 수 없습니다: ${missing.map((m) => m.templateId).join(', ')}`,
      );
    }

    const derived = await this.templateSetRepository.manager.transaction(async (manager) => {
      // 1) page류 템플릿 복제·변환 — spread/spine/wing/endpaper/cover류 제외
      const newRefs: TemplateRef[] = [];
      for (const ref of refs) {
        const tpl = byId.get(ref.templateId);
        if (!tpl || tpl.type !== 'page') continue;

        // canvasData top-level width/height(mm)가 정본 — 없으면 템플릿 행 치수로 폴백.
        // (page 캔버스는 재단 또는 작업(재단+2×bleed) 치수일 수 있으나 W↔H 스왑은 양쪽 모두 정확.)
        const oldWmm =
          typeof tpl.canvasData?.width === 'number' && tpl.canvasData.width > 0
            ? tpl.canvasData.width
            : tpl.width;
        const oldHmm =
          typeof tpl.canvasData?.height === 'number' && tpl.canvasData.height > 0
            ? tpl.canvasData.height
            : tpl.height;

        const newTemplate = this.templateRepository.create({
          id: uuidv4(),
          name: withOrientationSuffix(tpl.name, suffix),
          thumbnailUrl: null, // 방향이 다른 원본 썸네일 오도 방지 (오너 설계 ④)
          type: tpl.type,
          width: tpl.height,
          height: tpl.width,
          editable: tpl.editable,
          deleteable: tpl.deleteable,
          canvasData: transformCanvasDataOrientation(tpl.canvasData, {
            oldWmm,
            oldHmm,
            newWmm: oldHmm,
            newHmm: oldWmm,
          }),
          spreadConfig: tpl.spreadConfig,
          isDeleted: false,
          categoryId: tpl.categoryId,
          editCode: null, // unique 컬럼 — 복제 금지
          templateCode: null, // unique 컬럼 — 복제 금지
          isActive: true, // 오너 설계 ④: 복제 템플릿 is_active=1
          createdBy: tpl.createdBy,
          siteId: tpl.siteId,
        });
        await manager.save(Template, newTemplate);
        newRefs.push({ templateId: newTemplate.id, required: ref.required });
      }

      // 2) 새 세트 — 판형 스왑 + 설정 복사, templates JSON 은 복제된 id 로 재작성
      const newSet = this.templateSetRepository.create({
        id: uuidv4(),
        name: withOrientationSuffix(original.name, suffix),
        thumbnailUrl: null,
        type: original.type,
        width: newWidth,
        height: newHeight,
        canAddPage: original.canAddPage,
        pageCountRange: original.pageCountRange,
        templates: newRefs,
        editorMode: original.editorMode,
        enabledMenus: original.enabledMenus,
        endpaperConfig: original.endpaperConfig,
        coverEditable: original.coverEditable,
        coverPreviewImage: original.coverPreviewImage,
        contentPdfEditable: original.contentPdfEditable,
        pdfOutputMode: original.pdfOutputMode,
        colorMode: original.colorMode,
        bleedMm: original.bleedMm,
        cropMarkEnabled: original.cropMarkEnabled,
        sizeToleranceMm: original.sizeToleranceMm,
        pricing: original.pricing,
        coverType: original.coverType,
        coverConfig: original.coverConfig,
        description: original.description,
        categoryId: original.categoryId,
        productSpecs: original.productSpecs,
        siteId: original.siteId,
        isDeleted: false,
        isActive: false, // 초안 — 사람 검수 후 활성 (오너 설계 ③)
        pairedTemplateSetId: original.id,
        isOrientationDefault: false, // 원본이 default 유지
      });
      await manager.save(TemplateSet, newSet);

      // 3) 대칭 페어링 — 원본에 상대 ID 기록(원본 default 유지)
      await manager.update(TemplateSet, original.id, {
        pairedTemplateSetId: newSet.id,
        isOrientationDefault: true,
      });

      return newSet;
    });

    return { success: true, data: derived };
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
