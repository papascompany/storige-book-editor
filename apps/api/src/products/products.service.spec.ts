import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { ProductSize } from './entities/product-size.entity';

describe('ProductsService', () => {
  let service: ProductsService;
  let productRepository: jest.Mocked<Repository<Product>>;
  let productSizeRepository: jest.Mocked<Repository<ProductSize>>;

  const mockProduct: Partial<Product> = {
    id: 'product-id',
    title: 'Test Product',
    productId: 'PROD-001',
    description: 'Test description',
    isActive: true,
    templateSetId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([mockProduct]),
    getManyAndCount: jest.fn().mockResolvedValue([[mockProduct], 1]),
    getOne: jest.fn().mockResolvedValue(mockProduct),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: {
            create: jest.fn().mockReturnValue(mockProduct),
            save: jest.fn().mockResolvedValue(mockProduct),
            findOne: jest.fn().mockResolvedValue(mockProduct),
            find: jest.fn().mockResolvedValue([mockProduct]),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            remove: jest.fn().mockResolvedValue(mockProduct),
          },
        },
        {
          provide: getRepositoryToken(ProductSize),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    productRepository = module.get(getRepositoryToken(Product));
    productSizeRepository = module.get(getRepositoryToken(ProductSize));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new product', async () => {
      const createDto = {
        title: 'New Product',
        productId: 'PROD-002',
        description: 'New description',
      };

      const result = await service.create(createDto);

      expect(productRepository.create).toHaveBeenCalledWith(createDto);
      expect(productRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockProduct);
    });
  });

  describe('findAll', () => {
    it('should return paginated products', async () => {
      const result = await service.findAll({});

      expect(productRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('total');
    });

    it('should filter by search when provided', async () => {
      await service.findAll({ search: 'test' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(product.title LIKE :search OR product.description LIKE :search)',
        { search: '%test%' }
      );
    });

    it('should filter by isActive when provided', async () => {
      await service.findAll({ isActive: true });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'product.isActive = :isActive',
        { isActive: true }
      );
    });
  });

  describe('findOne', () => {
    it('should return a product by id', async () => {
      const result = await service.findOne('product-id');

      expect(productRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'product-id' },
        relations: ['sizes', 'templateSet'],
      });
      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException when product not found', async () => {
      productRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByProductId', () => {
    it('should return a product by productId', async () => {
      const result = await service.findByProductId('PROD-001');

      expect(productRepository.findOne).toHaveBeenCalledWith({
        where: { productId: 'PROD-001' },
        relations: ['sizes', 'templateSet'],
      });
      expect(result).toEqual(mockProduct);
    });

    it('should throw NotFoundException when product not found', async () => {
      productRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findByProductId('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('linkTemplateSet', () => {
    it('should link a template set to a product', async () => {
      const linkedProduct = { ...mockProduct, templateSetId: 'template-set-id' };
      productRepository.findOne.mockResolvedValueOnce(linkedProduct as Product);

      const result = await service.linkTemplateSet('product-id', 'template-set-id');

      expect(productRepository.update).toHaveBeenCalled();
    });
  });

  describe('unlinkTemplateSet', () => {
    it('should unlink a template set from a product', async () => {
      const linkedProduct = { ...mockProduct, templateSetId: 'template-set-id' };
      productRepository.findOne.mockResolvedValueOnce(linkedProduct as Product);

      const result = await service.unlinkTemplateSet('product-id');

      expect(productRepository.update).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove a product', async () => {
      await service.remove('product-id');

      expect(productRepository.remove).toHaveBeenCalled();
    });

    it('should throw NotFoundException when product not found', async () => {
      productRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.remove('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
