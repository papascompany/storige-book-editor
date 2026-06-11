import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { TemplateSetsService } from './template-sets.service';
import { TemplateSet, TemplateSetItem, TemplateSetTypeEnum } from './entities/template-set.entity';
import { TemplateSetLibraryCategory } from './entities/template-set-library-category.entity';
import { Template } from './entities/template.entity';
import { Product } from '../products/entities/product.entity';
import { TemplateSetType, TemplateType, CanvasData } from '@storige/types';

describe('TemplateSetsService', () => {
  let service: TemplateSetsService;
  let templateSetRepository: jest.Mocked<Repository<TemplateSet>>;
  let templateRepository: jest.Mocked<Repository<Template>>;
  let productRepository: jest.Mocked<Repository<Product>>;

  const mockCanvasData: CanvasData = {
    version: '5.3.0',
    width: 210,
    height: 297,
    objects: [],
  };

  const mockTemplate: Partial<Template> = {
    id: 'template-id-1',
    name: 'Test Template',
    type: TemplateType.PAGE,
    canvasData: mockCanvasData,
    width: 210,
    height: 297,
    isDeleted: false,
  };

  const mockTemplateSet: Partial<TemplateSet> = {
    id: 'template-set-id',
    name: 'Test Template Set',
    type: TemplateSetTypeEnum.BOOK as unknown as TemplateSetType,
    width: 210,
    height: 297,
    canAddPage: true,
    pageCountRange: [10, 20, 30],
    templates: [
      { templateId: 'template-id-1', required: true },
    ],
    isDeleted: false,
    isActive: true,
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
    getMany: jest.fn().mockResolvedValue([mockTemplateSet]),
    getManyAndCount: jest.fn().mockResolvedValue([[mockTemplateSet], 1]),
    getOne: jest.fn().mockResolvedValue(mockTemplateSet),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateSetsService,
        {
          provide: getRepositoryToken(TemplateSet),
          useValue: {
            create: jest.fn().mockReturnValue(mockTemplateSet),
            save: jest.fn().mockResolvedValue(mockTemplateSet),
            findOne: jest.fn().mockResolvedValue(mockTemplateSet),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            manager: {
              createQueryBuilder: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnThis(),
                from: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getRawOne: jest.fn().mockResolvedValue({ cnt: '0' }),
              }),
            },
          },
        },
        {
          provide: getRepositoryToken(TemplateSetItem),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(Template),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockTemplate),
            findByIds: jest.fn().mockResolvedValue([mockTemplate]),
          },
        },
        {
          provide: getRepositoryToken(Product),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
            }),
          },
        },
        {
          // ④ 에셋 구성(노출 라이브러리 카테고리) — 서비스 생성자 5번째 의존성.
          // loadLibraryCategoryIds(find) + setLibraryCategories(delete/create/save) 경로용.
          provide: getRepositoryToken(TemplateSetLibraryCategory),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
            create: jest.fn().mockImplementation((row) => row),
            save: jest.fn().mockImplementation((rows) => Promise.resolve(rows)),
          },
        },
      ],
    }).compile();

    service = module.get<TemplateSetsService>(TemplateSetsService);
    templateSetRepository = module.get(getRepositoryToken(TemplateSet));
    templateRepository = module.get(getRepositoryToken(Template));
    productRepository = module.get(getRepositoryToken(Product));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new template set', async () => {
      const createDto = {
        name: 'New Template Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
      };

      const result = await service.create(createDto);

      expect(templateSetRepository.create).toHaveBeenCalled();
      expect(templateSetRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockTemplateSet);
    });

    it('should validate templates when provided', async () => {
      const createDto = {
        name: 'New Template Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [{ templateId: 'template-id-1', required: true }],
      };

      await service.create(createDto);

      expect(templateRepository.findOne).toHaveBeenCalled();
    });

    it('should throw NotFoundException when template not found', async () => {
      templateRepository.findOne.mockResolvedValueOnce(null);

      const createDto = {
        name: 'New Template Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        templates: [{ templateId: 'non-existent', required: true }],
      };

      await expect(service.create(createDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated template sets', async () => {
      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(templateSetRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result).toEqual({
        items: [mockTemplateSet],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('should filter by type when provided', async () => {
      await service.findAll({ type: TemplateSetType.BOOK, page: 1, pageSize: 20 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.type = :type',
        { type: TemplateSetType.BOOK }
      );
    });

    it('should filter by width and height when provided', async () => {
      await service.findAll({ width: 210, height: 297, page: 1, pageSize: 20 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.width = :width',
        { width: 210 }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.height = :height',
        { height: 297 }
      );
    });
  });

  describe('findOne', () => {
    it('should return a template set by id', async () => {
      const result = await service.findOne('template-set-id');

      expect(templateSetRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'template-set-id', isDeleted: false },
        relations: ['category'],
      });
      expect(result).toEqual(mockTemplateSet);
    });

    it('should throw NotFoundException when template set not found', async () => {
      templateSetRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOneWithTemplates', () => {
    it('should return template set with template details', async () => {
      const result = await service.findOneWithTemplates('template-set-id');

      expect(templateRepository.findByIds).toHaveBeenCalled();
      expect(result).toHaveProperty('templateSet');
      expect(result).toHaveProperty('templateDetails');
    });
  });

  describe('update', () => {
    it('should update a template set', async () => {
      const updateDto = {
        name: 'Updated Template Set',
      };

      const result = await service.update('template-set-id', updateDto);

      expect(templateSetRepository.save).toHaveBeenCalled();
    });

    it('should validate templates when updating templates', async () => {
      const updateDto = {
        templates: [{ templateId: 'template-id-1', required: true }],
      };

      await service.update('template-set-id', updateDto);

      expect(templateRepository.findOne).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should soft delete a template set', async () => {
      const result = await service.remove('template-set-id');

      expect(templateSetRepository.save).toHaveBeenCalled();
      expect(result).toHaveProperty('affected', 1);
    });
  });

  describe('copy', () => {
    it('should create a copy of a template set', async () => {
      const result = await service.copy('template-set-id');

      expect(templateSetRepository.create).toHaveBeenCalled();
      expect(templateSetRepository.save).toHaveBeenCalled();
    });
  });

  describe('getProducts', () => {
    it('should return products linked to template set', async () => {
      const result = await service.getProducts('template-set-id');

      expect(productRepository.find).toHaveBeenCalledWith({
        where: { templateSetId: 'template-set-id' },
        select: ['id', 'title', 'productId', 'isActive', 'createdAt'],
        order: { title: 'ASC' },
      });
    });
  });

  describe('addTemplate', () => {
    it('should add a template to template set', async () => {
      const addDto = {
        templateId: 'template-id-1',
        required: true,
      };

      const result = await service.addTemplate('template-set-id', addDto);

      expect(templateSetRepository.save).toHaveBeenCalled();
    });

    it('should throw NotFoundException when template not found', async () => {
      templateRepository.findOne.mockResolvedValueOnce(null);

      const addDto = {
        templateId: 'non-existent',
        required: true,
      };

      await expect(service.addTemplate('template-set-id', addDto)).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException when template size does not match', async () => {
      templateRepository.findOne.mockResolvedValueOnce({
        ...mockTemplate,
        width: 100,
        height: 100,
      } as Template);

      const addDto = {
        templateId: 'template-id-1',
        required: true,
      };

      await expect(service.addTemplate('template-set-id', addDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('removeTemplate', () => {
    it('should remove a template from template set', async () => {
      const result = await service.removeTemplate('template-set-id', 'template-id-1');

      expect(templateSetRepository.save).toHaveBeenCalled();
    });
  });

  describe('reorderTemplates', () => {
    it('should reorder templates in template set', async () => {
      // findOne이 호출되므로 해당 mock 설정
      const templateSetWithMultiple = {
        ...mockTemplateSet,
        templates: [
          { templateId: 'template-id-1', required: true },
          { templateId: 'template-id-2', required: false },
        ],
      };
      templateSetRepository.findOne.mockResolvedValueOnce(templateSetWithMultiple as TemplateSet);

      const reorderDto = {
        templates: [
          { templateId: 'template-id-2', required: false },
          { templateId: 'template-id-1', required: true },
        ],
      };

      const result = await service.reorderTemplates('template-set-id', reorderDto);

      expect(templateSetRepository.save).toHaveBeenCalled();
    });

    it('should throw BadRequestException when template list does not match', async () => {
      const reorderDto = {
        templates: [
          { templateId: 'template-id-1', required: true },
          { templateId: 'template-id-2', required: false },
        ],
      };

      await expect(service.reorderTemplates('template-set-id', reorderDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findCompatible', () => {
    it('should find template sets with matching dimensions', async () => {
      const result = await service.findCompatible(210, 297);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.width = :width',
        { width: 210 }
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.height = :height',
        { height: 297 }
      );
    });

    it('should filter by type when provided', async () => {
      await service.findCompatible(210, 297, 'book');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'ts.type = :type',
        { type: 'book' }
      );
    });
  });
});
