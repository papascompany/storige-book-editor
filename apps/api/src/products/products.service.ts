import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Product, ProductSize } from './entities';
import { CreateProductDto, UpdateProductDto, QueryProductDto } from './dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(ProductSize)
    private readonly productSizeRepository: Repository<ProductSize>,
  ) {}

  async create(dto: CreateProductDto): Promise<Product> {
    // 2026-05-03: Admin UI 호환 — name을 title로 자동 매핑 (둘 중 하나만 있어도 OK)
    const normalized = this.normalizeProductDto(dto);
    const product = this.productRepository.create(normalized as Partial<Product>);
    return this.productRepository.save(product);
  }

  /**
   * Admin UI (`name`)와 Storige API (`title`) 양쪽 모델 호환을 위한 정규화.
   * - title 누락 + name 있음 → title = name
   * - name 누락 + title 있음 → name 그대로 (DB 컬럼 추가됨, nullable)
   * - 둘 다 누락 → 검증은 DTO에서 처리하되 둘 다 optional이라 service에서 가드 권장
   *
   * 반환 타입: Partial<Product> 호환 plain object (TypeORM repository.create() 입력용)
   */
  private normalizeProductDto(dto: CreateProductDto | UpdateProductDto): Record<string, any> {
    const result: Record<string, any> = { ...dto };
    if (!result.title && result.name) {
      result.title = result.name;
    }
    return result;
  }

  async findAll(query: QueryProductDto) {
    const {
      search,
      isActive,
      page = 1,
      pageSize = 20,
      sortField = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const queryBuilder = this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.templateSet', 'templateSet');

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(product.title LIKE :search OR product.description LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Active filter
    if (isActive !== undefined) {
      queryBuilder.andWhere('product.isActive = :isActive', { isActive });
    }

    // Sorting
    queryBuilder.orderBy(`product.${sortField}`, sortOrder.toUpperCase() as 'ASC' | 'DESC');

    // Pagination
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [items, total] = await queryBuilder.getManyAndCount();

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: ['sizes', 'templateSet'],
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    return product;
  }

  async findByProductId(productId: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { productId },
      relations: ['sizes', 'templateSet'],
    });

    if (!product) {
      throw new NotFoundException(`Product with productId "${productId}" not found`);
    }

    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);
    Object.assign(product, dto);
    return this.productRepository.save(product);
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    await this.productRepository.remove(product);
  }

  // Product sizes management
  async addSize(productId: string, sizeData: Partial<ProductSize>): Promise<ProductSize> {
    const product = await this.findOne(productId);
    const size = this.productSizeRepository.create({
      ...sizeData,
      productId: product.id,
    });
    return this.productSizeRepository.save(size);
  }

  async updateSize(sizeId: string, sizeData: Partial<ProductSize>): Promise<ProductSize> {
    const size = await this.productSizeRepository.findOne({ where: { id: sizeId } });
    if (!size) {
      throw new NotFoundException(`Size with ID "${sizeId}" not found`);
    }
    Object.assign(size, sizeData);
    return this.productSizeRepository.save(size);
  }

  async removeSize(sizeId: string): Promise<void> {
    const size = await this.productSizeRepository.findOne({ where: { id: sizeId } });
    if (!size) {
      throw new NotFoundException(`Size with ID "${sizeId}" not found`);
    }
    await this.productSizeRepository.remove(size);
  }

  // Template set linking
  async linkTemplateSet(productId: string, templateSetId: string): Promise<Product> {
    const product = await this.findOne(productId);
    product.templateSetId = templateSetId;
    return this.productRepository.save(product);
  }

  async unlinkTemplateSet(productId: string): Promise<Product> {
    const product = await this.findOne(productId);
    product.templateSetId = null;
    return this.productRepository.save(product);
  }
}
