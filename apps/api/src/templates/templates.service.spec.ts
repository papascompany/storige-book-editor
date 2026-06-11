import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { Template } from './entities/template.entity';
import { TemplateSet } from './entities/template-set.entity';
import { TemplateType } from '@storige/types';

describe('TemplatesService', () => {
  let service: TemplatesService;
  let templateRepository: jest.Mocked<Repository<Template>>;
  let templateSetRepository: jest.Mocked<Repository<TemplateSet>>;

  const mockTemplate: Partial<Template> = {
    id: 'test-template-id',
    name: 'Test Template',
    templateCode: 'TMPL-ABCD1234',
    editCode: 'EDIT-EFGH5678',
    type: TemplateType.PAGE,
    width: 210,
    height: 297,
    isActive: true,
    isDeleted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(0),
    getMany: jest.fn().mockResolvedValue([mockTemplate]),
    getOne: jest.fn().mockResolvedValue(mockTemplate),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        {
          provide: getRepositoryToken(Template),
          useValue: {
            create: jest.fn().mockReturnValue(mockTemplate),
            save: jest.fn().mockResolvedValue(mockTemplate),
            findOne: jest.fn().mockResolvedValue(mockTemplate),
            find: jest.fn().mockResolvedValue([mockTemplate]),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: getRepositoryToken(TemplateSet),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
      ],
    }).compile();

    service = module.get<TemplatesService>(TemplatesService);
    templateRepository = module.get(getRepositoryToken(Template));
    templateSetRepository = module.get(getRepositoryToken(TemplateSet));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a new template with auto-generated codes', async () => {
      const createDto = {
        name: 'New Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: '{}',
      };

      templateRepository.findOne.mockResolvedValueOnce(null); // templateCode not exists
      templateRepository.findOne.mockResolvedValueOnce(null); // editCode not exists

      const result = await service.create(createDto as any, 'user-id');

      expect(templateRepository.create).toHaveBeenCalled();
      expect(templateRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockTemplate);
    });

    it('should retry code generation if duplicate found', async () => {
      const createDto = {
        name: 'New Template',
        type: TemplateType.PAGE,
        width: 210,
        height: 297,
        canvasData: '{}',
      };

      // First templateCode check returns duplicate, second returns null
      templateRepository.findOne
        .mockResolvedValueOnce(mockTemplate as Template) // duplicate
        .mockResolvedValueOnce(null) // unique
        .mockResolvedValueOnce(null); // editCode unique

      const result = await service.create(createDto as any, 'user-id');

      expect(templateRepository.findOne).toHaveBeenCalledTimes(3);
      expect(result).toEqual(mockTemplate);
    });
  });

  describe('create (spread conversionMode)', () => {
    const baseSpec = {
      coverWidthMm: 210,
      coverHeightMm: 297,
      spineWidthMm: 10,
      wingEnabled: false,
      wingWidthMm: 0,
      cutSizeMm: 3,
      safeSizeMm: 5,
      dpi: 300,
    };
    const fullRegions = [
      { kind: 'back-cover', x: 0, width: 100 },
      { kind: 'spine', x: 100, width: 10 },
      { kind: 'front-cover', x: 110, width: 100 },
    ];
    const makeDto = (spreadConfig: Record<string, unknown>) => ({
      name: 'Spread Template',
      type: TemplateType.SPREAD,
      canvasData: '{}',
      spreadConfig: { version: 1, spec: baseSpec, totalWidthMm: 0, totalHeightMm: 0, ...spreadConfig },
    });

    beforeEach(() => {
      templateRepository.findOne.mockResolvedValue(null); // code 중복 없음
    });

    it('should accept flat-spine when back-cover/spine/front-cover regions exist and preserve conversionMode', async () => {
      const dto = makeDto({ conversionMode: 'flat-spine', regions: fullRegions });

      const result = await service.create(dto as any, 'user-id');

      expect(result).toEqual(mockTemplate);
      // 검증/정규화 후에도 conversionMode 가 스트립되지 않고 보존되어야 함
      expect((dto.spreadConfig as any).conversionMode).toBe('flat-spine');
      expect(templateRepository.save).toHaveBeenCalled();
    });

    it('should reject flat-spine when a required region is missing', async () => {
      const dto = makeDto({
        conversionMode: 'flat-spine',
        regions: fullRegions.filter((r) => r.kind !== 'spine'),
      });

      await expect(service.create(dto as any, 'user-id')).rejects.toThrow(BadRequestException);
      expect(templateRepository.save).not.toHaveBeenCalled();
    });

    it('should reject unknown conversionMode values', async () => {
      const dto = makeDto({ conversionMode: 'bogus-mode', regions: fullRegions });

      await expect(service.create(dto as any, 'user-id')).rejects.toThrow(BadRequestException);
    });

    it('should accept spreads without conversionMode (legacy = full)', async () => {
      const dto = makeDto({ regions: [] });

      const result = await service.create(dto as any, 'user-id');
      expect(result).toEqual(mockTemplate);
    });

    it('should accept region entries keyed by position (editor layout shape)', async () => {
      const dto = makeDto({
        conversionMode: 'flat-spine',
        regions: [
          { position: 'back-cover', type: 'cover', x: 0, width: 100 },
          { position: 'spine', type: 'spine', x: 100, width: 10 },
          { position: 'front-cover', type: 'cover', x: 110, width: 100 },
        ],
      });

      const result = await service.create(dto as any, 'user-id');
      expect(result).toEqual(mockTemplate);
    });
  });

  describe('update (spread conversionMode preservation)', () => {
    it('should preserve existing conversionMode when incoming spreadConfig omits it', async () => {
      const baseSpec = {
        coverWidthMm: 210,
        coverHeightMm: 297,
        spineWidthMm: 10,
        wingEnabled: false,
        wingWidthMm: 0,
        cutSizeMm: 3,
        safeSizeMm: 5,
        dpi: 300,
      };
      const fullRegions = [
        { kind: 'back-cover', x: 0, width: 100 },
        { kind: 'spine', x: 100, width: 10 },
        { kind: 'front-cover', x: 110, width: 100 },
      ];
      // 기존 템플릿: flat-spine 으로 변환된 spread
      const existingTemplate = {
        ...mockTemplate,
        type: TemplateType.SPREAD,
        spreadConfig: {
          version: 1,
          spec: baseSpec,
          regions: fullRegions,
          totalWidthMm: 430,
          totalHeightMm: 297,
          conversionMode: 'flat-spine',
        },
      };
      templateRepository.findOne.mockResolvedValueOnce(existingTemplate as any);

      // 클라이언트(템플릿 편집기)가 spreadConfig 를 재구성해 conversionMode 없이 전송
      const updateDto = {
        name: 'Updated Spread',
        spreadConfig: {
          version: 1,
          spec: baseSpec,
          regions: fullRegions,
          totalWidthMm: 430,
          totalHeightMm: 297,
        },
      };

      await service.update('test-template-id', updateDto as any);

      expect(templateRepository.save).toHaveBeenCalled();
      const saved = templateRepository.save.mock.calls[0][0] as any;
      expect(saved.spreadConfig.conversionMode).toBe('flat-spine');
    });
  });

  describe('findAll', () => {
    it('should return all templates without filters', async () => {
      const result = await service.findAll();

      expect(templateRepository.createQueryBuilder).toHaveBeenCalled();
      expect(result).toEqual([mockTemplate]);
    });

    it('should filter by categoryId when provided', async () => {
      await service.findAll('category-id');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.categoryId = :categoryId',
        { categoryId: 'category-id' }
      );
    });

    it('should filter by isActive when provided', async () => {
      await service.findAll(undefined, true);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.isActive = :isActive',
        { isActive: true }
      );
    });
  });

  describe('findOne', () => {
    it('should return a template by id', async () => {
      templateRepository.findOne.mockResolvedValueOnce(mockTemplate as Template);

      const result = await service.findOne('test-template-id');

      expect(result).toEqual(mockTemplate);
    });

    it('should throw NotFoundException when template not found', async () => {
      templateRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkEditCodeExists', () => {
    it('should return true when editCode exists', async () => {
      mockQueryBuilder.getCount.mockResolvedValueOnce(1);

      const result = await service.checkEditCodeExists('EDIT-EXISTING');

      expect(result).toBe(true);
    });

    it('should return false when editCode does not exist', async () => {
      mockQueryBuilder.getCount.mockResolvedValueOnce(0);

      const result = await service.checkEditCodeExists('EDIT-NEW');

      expect(result).toBe(false);
    });

    it('should exclude specific id when checking', async () => {
      await service.checkEditCodeExists('EDIT-CODE', 'exclude-id');

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.id != :excludeId',
        { excludeId: 'exclude-id' }
      );
    });
  });
});
