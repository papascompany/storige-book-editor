import {
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
  Inject,
} from '@nestjs/common';
import { InjectRepository, getRepositoryToken } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { ProductTemplateSet } from './entities/product-template-set.entity';
import { TemplateSet } from './entities/template-set.entity';
import {
  CreateProductTemplateSetDto,
  UpdateProductTemplateSetDto,
  BulkCreateProductTemplateSetDto,
  ProductTemplateSetListQueryDto,
  ProductTemplateSetResponseDto,
  TemplateSetsByProductResponseDto,
  ProductTemplateSetListResponseDto,
} from './dto/product-template-set.dto';

// 파트너 쇼핑몰 카테고리 엔티티 타입 (조건부 import)
interface BookmoaCategoryLike {
  sortcode: string;
  cateName: string;
}

@Injectable()
export class ProductTemplateSetsService {
  private categoryRepository: Repository<BookmoaCategoryLike> | null = null;

  constructor(
    @InjectRepository(ProductTemplateSet)
    private ptsRepository: Repository<ProductTemplateSet>,
    @InjectRepository(TemplateSet)
    private templateSetRepository: Repository<TemplateSet>,
    @Optional()
    @Inject('BOOKMOA_CATEGORY_REPOSITORY')
    categoryRepository?: Repository<BookmoaCategoryLike>,
  ) {
    // 조건부로 주입된 repository 저장
    if (categoryRepository) {
      this.categoryRepository = categoryRepository;
    }
  }

  /**
   * 상품-템플릿셋 연결 생성
   */
  async create(dto: CreateProductTemplateSetDto): Promise<ProductTemplateSet> {
    // 템플릿셋 존재 확인
    const templateSet = await this.templateSetRepository.findOne({
      where: { id: dto.templateSetId, isDeleted: false },
    });
    if (!templateSet) {
      throw new NotFoundException(`TemplateSet ${dto.templateSetId} not found`);
    }

    // 중복 확인
    const existing = await this.ptsRepository.findOne({
      where: {
        sortcode: dto.sortcode,
        prdtStanSeqno: dto.prdtStanSeqno ?? IsNull(),
        templateSetId: dto.templateSetId,
      },
    });
    if (existing) {
      throw new ConflictException('This product-template set link already exists');
    }

    // 기본 템플릿 설정 시 기존 기본 해제
    if (dto.isDefault) {
      await this.clearDefaultForProduct(dto.sortcode, dto.prdtStanSeqno);
    }

    const pts = this.ptsRepository.create({
      sortcode: dto.sortcode,
      prdtStanSeqno: dto.prdtStanSeqno ?? null,
      templateSetId: dto.templateSetId,
      displayOrder: dto.displayOrder ?? 0,
      isDefault: dto.isDefault ?? false,
      isActive: true,
    });

    return this.ptsRepository.save(pts);
  }

  /**
   * 일괄 연결 생성
   */
  async bulkCreate(dto: BulkCreateProductTemplateSetDto): Promise<ProductTemplateSet[]> {
    const results: ProductTemplateSet[] = [];

    for (let i = 0; i < dto.templateSetIds.length; i++) {
      const templateSetId = dto.templateSetIds[i];

      try {
        const pts = await this.create({
          sortcode: dto.sortcode,
          prdtStanSeqno: dto.prdtStanSeqno,
          templateSetId,
          displayOrder: i,
          isDefault: i === 0, // 첫 번째를 기본으로
        });
        results.push(pts);
      } catch (error) {
        // 중복은 무시하고 계속 진행
        if (!(error instanceof ConflictException)) {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * 연결 수정
   */
  async update(id: string, dto: UpdateProductTemplateSetDto): Promise<ProductTemplateSet> {
    const pts = await this.ptsRepository.findOne({ where: { id } });
    if (!pts) {
      throw new NotFoundException(`ProductTemplateSet ${id} not found`);
    }

    // 기본 템플릿 설정 시 기존 기본 해제
    if (dto.isDefault && !pts.isDefault) {
      await this.clearDefaultForProduct(pts.sortcode, pts.prdtStanSeqno);
    }

    Object.assign(pts, dto);
    return this.ptsRepository.save(pts);
  }

  /**
   * 연결 삭제
   */
  async delete(id: string): Promise<void> {
    const pts = await this.ptsRepository.findOne({ where: { id } });
    if (!pts) {
      throw new NotFoundException(`ProductTemplateSet ${id} not found`);
    }

    await this.ptsRepository.remove(pts);
  }

  /**
   * 연결 단건 조회
   */
  async findById(id: string): Promise<ProductTemplateSet> {
    const pts = await this.ptsRepository.findOne({
      where: { id },
      relations: ['templateSet'],
    });
    if (!pts) {
      throw new NotFoundException(`ProductTemplateSet ${id} not found`);
    }
    return pts;
  }

  /**
   * 관리자용 목록 조회
   */
  async findAll(query: ProductTemplateSetListQueryDto): Promise<ProductTemplateSetListResponseDto> {
    const { sortcode, templateSetId, isActive, page = 1, limit = 20 } = query;

    const qb = this.ptsRepository
      .createQueryBuilder('pts')
      .leftJoinAndSelect('pts.templateSet', 'ts');

    if (sortcode) {
      qb.andWhere('pts.sortcode LIKE :sortcode', { sortcode: `%${sortcode}%` });
    }

    if (templateSetId) {
      qb.andWhere('pts.templateSetId = :templateSetId', { templateSetId });
    }

    if (isActive !== undefined) {
      qb.andWhere('pts.isActive = :isActive', { isActive });
    }

    qb.orderBy('pts.sortcode', 'ASC')
      .addOrderBy('pts.prdtStanSeqno', 'ASC')
      .addOrderBy('pts.displayOrder', 'ASC');

    const [items, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // 카테고리 이름 조회 (파트너 쇼핑몰 카테고리 DB에서)
    const sortcodes = [...new Set(items.map((item) => item.sortcode))];
    const categoryMap = new Map<string, string>();

    if (sortcodes.length > 0 && this.categoryRepository) {
      try {
        const categories = await this.categoryRepository.find({
          where: { sortcode: In(sortcodes) },
        });
        categories.forEach((cat) => {
          categoryMap.set(cat.sortcode, cat.cateName);
        });
      } catch (error) {
        // 파트너 쇼핑몰 카테고리 DB 연결 실패 시 무시
        console.warn('Failed to fetch category names from bookmoa:', error.message);
      }
    }

    return {
      items: items.map((item) => this.toResponseDto(item, categoryMap.get(item.sortcode))),
      total,
      page,
      limit,
    };
  }

  /**
   * 상품별 템플릿셋 목록 조회 (외부용)
   * 폴백 로직: sortcode+stanSeqno 정확히 매칭 → sortcode만 (stanSeqno IS NULL)
   */
  async findByProduct(
    sortcode: string,
    stanSeqno?: number,
  ): Promise<TemplateSetsByProductResponseDto> {
    // 1. 정확히 매칭되는 항목 조회
    let items = await this.ptsRepository.find({
      where: {
        sortcode,
        prdtStanSeqno: stanSeqno ?? IsNull(),
        isActive: true,
      },
      relations: ['templateSet'],
      order: {
        isDefault: 'DESC', // 기본 템플릿 먼저
        displayOrder: 'ASC',
      },
    });

    // 2. 없으면 sortcode만으로 조회 (prdtStanSeqno IS NULL)
    if (items.length === 0 && stanSeqno !== undefined) {
      items = await this.ptsRepository.find({
        where: {
          sortcode,
          prdtStanSeqno: IsNull(),
          isActive: true,
        },
        relations: ['templateSet'],
        order: {
          isDefault: 'DESC',
          displayOrder: 'ASC',
        },
      });
    }

    // 삭제된 템플릿셋 제외
    items = items.filter((item) => item.templateSet && !item.templateSet.isDeleted);

    return {
      templateSets: items.map((item) => ({
        id: item.templateSet.id,
        name: item.templateSet.name,
        type: item.templateSet.type,
        width: item.templateSet.width,
        height: item.templateSet.height,
        thumbnailUrl: item.templateSet.thumbnailUrl,
        isDefault: item.isDefault,
      })),
      total: items.length,
    };
  }

  /**
   * 해당 상품의 기본 템플릿 해제
   */
  private async clearDefaultForProduct(
    sortcode: string,
    prdtStanSeqno: number | null | undefined,
  ): Promise<void> {
    await this.ptsRepository.update(
      {
        sortcode,
        prdtStanSeqno: prdtStanSeqno ?? IsNull(),
        isDefault: true,
      },
      { isDefault: false },
    );
  }

  /**
   * Entity → Response DTO 변환
   */
  toResponseDto(entity: ProductTemplateSet, categoryName?: string): ProductTemplateSetResponseDto {
    return {
      id: entity.id,
      sortcode: entity.sortcode,
      categoryName: categoryName || null,
      prdtStanSeqno: entity.prdtStanSeqno,
      templateSetId: entity.templateSetId,
      displayOrder: entity.displayOrder,
      isDefault: entity.isDefault,
      isActive: entity.isActive,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      templateSet: entity.templateSet
        ? {
            id: entity.templateSet.id,
            name: entity.templateSet.name,
            type: entity.templateSet.type,
            width: entity.templateSet.width,
            height: entity.templateSet.height,
            thumbnailUrl: entity.templateSet.thumbnailUrl,
          }
        : undefined,
    };
  }
}
