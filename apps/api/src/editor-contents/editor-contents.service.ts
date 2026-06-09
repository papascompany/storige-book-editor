import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ObjectLiteral } from 'typeorm';
import { EditorContent } from './entities/editor-content.entity';
import { LibraryClipart } from '../library/entities/clipart.entity';
import { LibraryFrame } from '../library/entities/frame.entity';
import { LibraryBackground } from '../library/entities/background.entity';
import { TemplateSetLibraryCategory } from '../templates/entities/template-set-library-category.entity';
import { QueryEditorContentDto } from './dto/query-editor-content.dto';
import { UpdateEditorContentDto } from './dto/update-editor-content.dto';
import { EditorContentType } from '@storige/types';

/**
 * 편집기 콘텐츠 조회 서비스.
 *
 * ⚠️ 2026-06-02 (P0-1, 에셋 단절 해소): 관리자 Library(`library_cliparts`/`library_frames`/
 * `library_backgrounds`)에 등록한 에셋이 고객 편집기 패널(요소/프레임/배경)에 노출되도록,
 * element/frame/background 타입은 **library_* 테이블에서** 조회한다.
 * (기존 `editor_contents` 테이블은 비어 있어 admin 에셋이 고객에게 전혀 안 보이던 문제.)
 * template/image 타입은 종전대로 `editor_contents` 사용(향후 통합 후보).
 */
@Injectable()
export class EditorContentsService {
  constructor(
    @InjectRepository(EditorContent)
    private readonly editorContentRepository: Repository<EditorContent>,
    @InjectRepository(LibraryClipart)
    private readonly clipartRepository: Repository<LibraryClipart>,
    @InjectRepository(LibraryFrame)
    private readonly frameRepository: Repository<LibraryFrame>,
    @InjectRepository(LibraryBackground)
    private readonly backgroundRepository: Repository<LibraryBackground>,
    @InjectRepository(TemplateSetLibraryCategory)
    private readonly templateSetLibraryCategoryRepository: Repository<TemplateSetLibraryCategory>,
  ) {}

  /**
   * 템플릿셋별 에셋 큐레이션(2026-06-09)을 위한 카테고리 화이트리스트 조회.
   *
   * 규약(template_set_library_categories 엔티티 참조):
   *  - 템플릿셋에 연결이 **하나도 없으면** → 전역(모든 카테고리 노출) ⇒ `null` 반환(필터 미적용).
   *  - 연결이 **하나 이상** 있으면 → 그 카테고리들만 ⇒ 연결된 library_category_id 배열 반환.
   * 호출부는 `null`이면 카테고리 필터를 적용하지 않고(전역), 배열이면 `category_id IN (...)` 로 좁힌다.
   * (idx_tslc_set 인덱스로 template_set_id 단일 컬럼 조회 — 효율적)
   */
  private async getCuratedCategoryIds(
    templateSetId: string,
  ): Promise<string[] | null> {
    const links = await this.templateSetLibraryCategoryRepository.find({
      where: { templateSetId },
      select: ['libraryCategoryId'],
    });
    // 연결 없음 = 전역 (필터 미적용)
    if (links.length === 0) return null;
    return links.map((l) => l.libraryCategoryId);
  }

  /** library_* 행 → 편집기 EditorContent 응답 형태로 매핑 */
  private mapLibraryRow(row: any, type: EditorContentType): EditorContent {
    return {
      id: row.id,
      type,
      name: row.name,
      // 편집기는 imageUrl(또는 nested image.image.url) / designUrl 로 에셋 URL을 읽는다.
      imageUrl: row.fileUrl ?? null,
      designUrl: row.fileUrl ?? null,
      cutLineUrl: null,
      tags: Array.isArray(row.tags) ? row.tags : [],
      metadata: { source: 'library', category: row.category ?? null, categoryId: row.categoryId ?? null },
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
    } as unknown as EditorContent;
  }

  /** library_* 리포지토리에서 type에 맞는 콘텐츠를 EditorContent 형태로 조회 */
  private async findFromLibrary(
    repo: Repository<ObjectLiteral>,
    type: EditorContentType,
    query: QueryEditorContentDto,
  ) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const sortField = query.sortField || 'createdAt';
    const sortOrder = (query.sortOrder || 'desc').toUpperCase() as 'ASC' | 'DESC';

    const qb = repo.createQueryBuilder('c');
    qb.where('c.is_active = :isActive', { isActive: query.isActive ?? true });
    if (query.search) {
      qb.andWhere('c.name LIKE :search', { search: `%${query.search}%` });
    }
    if (query.tags && query.tags.length > 0) {
      query.tags.forEach((tag, i) => {
        qb.andWhere(`JSON_CONTAINS(c.tags, :tag${i})`, { [`tag${i}`]: JSON.stringify(tag) });
      });
    }

    // 템플릿셋별 에셋 큐레이션(2026-06-09): templateSetId 지정 시 연결된 카테고리로 좁힌다.
    //  - 연결 0개(전역) → curatedIds=null → 필터 미적용(전체 노출, 기존 동작 유지).
    //  - 연결 1개 이상 → category_id 가 연결 목록에 포함된 에셋만.
    //    (library_* 테이블은 종류별로 1:1이므로 category_id IN (...) 가 곧 종류별 스코프가 된다)
    if (query.templateSetId) {
      const curatedIds = await this.getCuratedCategoryIds(query.templateSetId);
      if (curatedIds !== null) {
        qb.andWhere('c.category_id IN (:...curatedIds)', { curatedIds });
      }
    }
    const orderCol = sortField === 'name' ? 'c.name' : 'c.created_at';
    qb.orderBy(orderCol, sortOrder).skip((page - 1) * pageSize).take(pageSize);

    const [rows, total] = await qb.getManyAndCount();
    return { items: rows.map((r) => this.mapLibraryRow(r, type)), total, page, pageSize };
  }

  async findByType(
    type: EditorContentType,
    query: QueryEditorContentDto,
  ): Promise<{ items: EditorContent[]; total: number; page: number; pageSize: number }> {
    // 에셋 라이브러리(관리자 업로드)에서 조회 — element/frame/background
    if (type === 'element') return this.findFromLibrary(this.clipartRepository, type, query);
    if (type === 'frame') return this.findFromLibrary(this.frameRepository, type, query);
    if (type === 'background') return this.findFromLibrary(this.backgroundRepository, type, query);

    // template / image 는 종전 editor_contents 테이블
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    const sortField = query.sortField || 'createdAt';
    const sortOrder = query.sortOrder || 'desc';

    const queryBuilder = this.editorContentRepository
      .createQueryBuilder('content')
      .where('content.type = :type', { type });

    if (query.isActive !== undefined) {
      queryBuilder.andWhere('content.is_active = :isActive', { isActive: query.isActive });
    } else {
      queryBuilder.andWhere('content.is_active = :isActive', { isActive: true });
    }

    if (query.search) {
      queryBuilder.andWhere('content.name LIKE :search', { search: `%${query.search}%` });
    }

    if (query.tags && query.tags.length > 0) {
      query.tags.forEach((tag, index) => {
        queryBuilder.andWhere(`JSON_CONTAINS(content.tags, :tag${index})`, {
          [`tag${index}`]: JSON.stringify(tag),
        });
      });
    }

    const orderField = sortField === 'name' ? 'content.name' :
                       sortField === 'createdAt' ? 'content.created_at' : 'content.updated_at';
    queryBuilder.orderBy(orderField, sortOrder.toUpperCase() as 'ASC' | 'DESC');

    queryBuilder.skip((page - 1) * pageSize).take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();

    return { items, total, page, pageSize };
  }

  async getTemplates(query: QueryEditorContentDto) {
    return this.findByType('template', query);
  }

  async getFrames(query: QueryEditorContentDto) {
    return this.findByType('frame', query);
  }

  async getImages(query: QueryEditorContentDto) {
    return this.findByType('image', query);
  }

  async getBackgrounds(query: QueryEditorContentDto) {
    return this.findByType('background', query);
  }

  async getElements(query: QueryEditorContentDto) {
    return this.findByType('element', query);
  }

  async findOne(id: string): Promise<EditorContent> {
    // editor_contents 먼저, 없으면 library_* 에서 조회 (에셋 단절 해소)
    const content = await this.editorContentRepository.findOne({ where: { id } });
    if (content) return content;

    const clip = await this.clipartRepository.findOne({ where: { id } as any });
    if (clip) return this.mapLibraryRow(clip, 'element');
    const frame = await this.frameRepository.findOne({ where: { id } as any });
    if (frame) return this.mapLibraryRow(frame, 'frame');
    const bg = await this.backgroundRepository.findOne({ where: { id } as any });
    if (bg) return this.mapLibraryRow(bg, 'background');

    throw new NotFoundException(`EditorContent with id ${id} not found`);
  }

  async update(type: EditorContentType, id: string, dto: UpdateEditorContentDto): Promise<EditorContent> {
    // editor_contents(template/image) 만 PUT 지원. element/frame/background 는 관리자 Library(/library/*)에서 관리.
    const content = await this.editorContentRepository.findOne({ where: { id } });
    if (!content || content.type !== type) {
      throw new NotFoundException(`EditorContent with id ${id} and type ${type} not found (library 에셋은 /library 에서 수정)`);
    }
    Object.assign(content, dto);
    return this.editorContentRepository.save(content);
  }
}
