import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { TemplateSetsService } from './template-sets.service';
import { TemplateSet, TemplateSetItem, TemplateSetTypeEnum } from './entities/template-set.entity';
import { TemplateSetLibraryCategory } from './entities/template-set-library-category.entity';
import { Template } from './entities/template.entity';
import { Product } from '../products/entities/product.entity';
import { TemplateSetType, TemplateType, CanvasData, EditorMode } from '@storige/types';

describe('TemplateSetsService', () => {
  let service: TemplateSetsService;
  let templateSetRepository: jest.Mocked<Repository<TemplateSet>>;
  let templateRepository: jest.Mocked<Repository<Template>>;
  let productRepository: jest.Mocked<Repository<Product>>;
  let tslcRepository: jest.Mocked<Repository<TemplateSetLibraryCategory>>;

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
    tslcRepository = module.get(getRepositoryToken(TemplateSetLibraryCategory));
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

    // D-4 (2026-07-06, C-4 Track 3): 커버 3종 메타 create 매핑 — 저장/조회 라운드트립의 저장측 고정
    it('coverType/coverConfig(caseBind) 를 생성 시 영속 매핑한다 (D-4)', async () => {
      const createDto = {
        name: 'Hardcover Photobook Set',
        type: TemplateSetType.PHOTOBOOK,
        width: 210,
        height: 297,
        coverType: 'hardcover_wrap',
        coverConfig: {
          caseBind: { boardThicknessMm: 2.5, turnInMm: 15, wrapMarginMm: 8 },
        },
      };

      await service.create(createDto as any);

      expect(templateSetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coverType: 'hardcover_wrap',
          coverConfig: { caseBind: { boardThicknessMm: 2.5, turnInMm: 15, wrapMarginMm: 8 } },
        }),
      );
    });

    it('coverConfig.finishing 을 생성 시 영속 매핑한다 (G8)', async () => {
      const createDto = {
        name: 'Fabric Cover Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        coverEditable: false,
        coverConfig: {
          finishing: { emboss: true, gold: false, silver: true },
        },
      };

      await service.create(createDto as any);

      expect(templateSetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          coverEditable: false,
          coverConfig: { finishing: { emboss: true, gold: false, silver: true } },
        }),
      );
    });

    it('coverType 미지정(기존 페이로드)은 null 로 저장 — 기존 셋 동작 비파괴 (D-4)', async () => {
      const createDto = {
        name: 'Legacy Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
      };

      await service.create(createDto);

      expect(templateSetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ coverType: null, coverConfig: null }),
      );
    });
  });

  describe('pageStep (S8 내지 증감 단위)', () => {
    it('create: pageStep 을 영속 매핑한다', async () => {
      await service.create({
        name: 'Step Set',
        type: TemplateSetType.BOOK,
        width: 210,
        height: 297,
        pageCountRange: [16, 500],
        pageStep: 2,
      });
      expect(templateSetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ pageStep: 2, pageCountRange: [16, 500] }),
      );
    });

    it('create: 미지정(기존 페이로드)은 null — 제약 없음(비파괴)', async () => {
      await service.create({ name: 'Legacy', type: TemplateSetType.BOOK, width: 210, height: 297 });
      expect(templateSetRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ pageStep: null }),
      );
    });

    it('update: pageStep 설정 및 null 로 해제', async () => {
      await service.update('template-set-id', { pageStep: 2 });
      expect(templateSetRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageStep: 2 }),
      );
      await service.update('template-set-id', { pageStep: null });
      expect(templateSetRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageStep: null }),
      );
    });

    it('update: pageStep 미포함 페이로드는 기존 값 유지', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({
        ...mockTemplateSet,
        pageStep: 2,
      });
      await service.update('template-set-id', { name: 'Renamed' });
      expect(templateSetRepository.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ name: 'Renamed', pageStep: 2 }),
      );
    });

    it('copy: pageStep 을 복제본에 유지', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({
        ...mockTemplateSet,
        pageStep: 2,
      });
      await service.copy('template-set-id');
      expect(templateSetRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageStep: 2 }),
      );
    });
  });

  describe('padToPageStep (첨부 내지 PDF 빈 페이지 배수 채움)', () => {
    it('create: 지정값을 매핑하고 미지정은 false(비파괴)', async () => {
      await service.create({ name: 'Pad', type: TemplateSetType.BOOK, width: 210, height: 297, pageStep: 2, padToPageStep: true });
      expect(templateSetRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageStep: 2, padToPageStep: true }),
      );
      await service.create({ name: 'Legacy', type: TemplateSetType.BOOK, width: 210, height: 297 });
      expect(templateSetRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ padToPageStep: false }),
      );
    });

    it('copy: padToPageStep 을 복제본에 유지', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({
        ...mockTemplateSet,
        pageStep: 2,
        padToPageStep: true,
      });
      await service.copy('template-set-id');
      expect(templateSetRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ pageStep: 2, padToPageStep: true }),
      );
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

    describe('N-NEW-2 참조 템플릿 누락 경고', () => {
      let warnSpy: jest.SpyInstance;

      beforeEach(() => {
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      });

      afterEach(() => {
        warnSpy.mockRestore();
      });

      it('누락 템플릿은 응답에서 제외(순서 유지)하고 warn 을 1회 남긴다', async () => {
        (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({
          ...mockTemplateSet,
          id: 'set-missing',
          templates: [
            { templateId: 'tpl-a', required: true },
            { templateId: 'tpl-gone', required: false },
            { templateId: 'tpl-b', required: false },
          ],
        });
        (templateRepository.findByIds as jest.Mock).mockResolvedValueOnce([
          { ...mockTemplate, id: 'tpl-b' },
          { ...mockTemplate, id: 'tpl-a' },
        ]);

        const result = await service.findOneWithTemplates('set-missing');

        expect(Object.keys(result)).toEqual(['templateSet', 'templateDetails']);
        expect(result.templateDetails.map((t) => t.id)).toEqual(['tpl-a', 'tpl-b']);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const message = String(warnSpy.mock.calls[0][0]);
        expect(message).toContain('[template-sets] 참조 템플릿 누락');
        expect(message).toContain('set-missing');
        expect(message).toContain('tpl-gone');
        expect(message).toContain('1/3');
        expect(message).not.toContain('tpl-a');
      });

      it('누락이 없으면 warn 을 남기지 않는다', async () => {
        const result = await service.findOneWithTemplates('template-set-id');

        expect(result.templateDetails.map((t) => t.id)).toEqual(['template-id-1']);
        expect(warnSpy).not.toHaveBeenCalled();
      });
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

    // 싸바리 book 세트(9e768d01 형태) — 모든 설정 컬럼을 보존해야 사본이 같은 상품으로 동작한다.
    const hardcoverWrapOriginal: Partial<TemplateSet> = {
      ...mockTemplateSet,
      id: 'orig-hardcover',
      name: '싸바리 동화책',
      siteId: 'site-1',
      thumbnailUrl: 'https://example.com/thumb.png',
      width: 210,
      height: 210,
      canAddPage: true,
      pageCountRange: [8, 16, 24],
      pageStep: 2,
      padToPageStep: true,
      templates: [
        { templateId: 'tpl-cover', required: true },
        { templateId: 'tpl-inner', required: false },
      ],
      editorMode: EditorMode.BOOK,
      enabledMenus: ['UPLOAD', 'TEXT'],
      endpaperConfig: { frontCount: 1, backCount: 1, frontEditable: false, backEditable: false },
      coverEditable: false,
      coverPreviewImage: 'https://example.com/cover-preview.png',
      contentPdfEditable: false,
      pdfOutputMode: 'duplex-split',
      colorMode: 'cmyk',
      bleedMm: 5,
      cropMarkEnabled: true,
      sizeToleranceMm: 0.5,
      pricing: { includedPages: 16, minPages: 8, pageStep: 2, perPageUnit: 1000 },
      coverType: 'hardcover_wrap',
      coverConfig: { caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 3 } },
      description: '싸바리 하드커버',
      categoryId: 'cat-1',
      productSpecs: null,
      pairedTemplateSetId: 'orig-pair',
      isOrientationDefault: false,
      isActive: false,
    };

    it('N-TD-1: 설정 컬럼 전부를 보존하고 isActive 는 원본을 승계한다', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({ ...hardcoverWrapOriginal });

      await service.copy('orig-hardcover');

      expect(templateSetRepository.create).toHaveBeenLastCalledWith({
        name: '싸바리 동화책 (복사본)',
        siteId: 'site-1',
        thumbnailUrl: 'https://example.com/thumb.png',
        type: hardcoverWrapOriginal.type,
        width: 210,
        height: 210,
        canAddPage: true,
        pageCountRange: [8, 16, 24],
        pageStep: 2,
        padToPageStep: true,
        templates: hardcoverWrapOriginal.templates,
        editorMode: EditorMode.BOOK,
        enabledMenus: ['UPLOAD', 'TEXT'],
        endpaperConfig: { frontCount: 1, backCount: 1, frontEditable: false, backEditable: false },
        coverEditable: false,
        coverPreviewImage: 'https://example.com/cover-preview.png',
        contentPdfEditable: false,
        pdfOutputMode: 'duplex-split',
        colorMode: 'cmyk',
        bleedMm: 5,
        cropMarkEnabled: true,
        sizeToleranceMm: 0.5,
        pricing: { includedPages: 16, minPages: 8, pageStep: 2, perPageUnit: 1000 },
        coverType: 'hardcover_wrap',
        coverConfig: { caseBind: { boardThicknessMm: 2, turnInMm: 15, wrapMarginMm: 3 } },
        description: '싸바리 하드커버',
        categoryId: 'cat-1',
        productSpecs: null,
        pairedTemplateSetId: null,
        isOrientationDefault: true,
        isDeleted: false,
        isActive: false,
      });
    });

    it('N-TD-1: 활성 원본의 사본은 활성이다', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({
        ...hardcoverWrapOriginal,
        isActive: true,
      });

      await service.copy('orig-hardcover');

      expect(templateSetRepository.create).toHaveBeenLastCalledWith(
        expect.objectContaining({ isActive: true }),
      );
    });

    it('N-TD-1: 라이브러리 카테고리 연결을 사본에 복사하고 다시 로드한다', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({ ...hardcoverWrapOriginal });
      (templateSetRepository.create as jest.Mock).mockImplementationOnce(
        (row: Partial<TemplateSet>) => ({ ...row }),
      );
      (templateSetRepository.save as jest.Mock).mockImplementationOnce(
        (row: Partial<TemplateSet>) => Promise.resolve({ ...row, id: 'copy-id' }),
      );
      // findOne(원본) populate → 원본 연결, 사본 save 후 재로드 → 사본 연결
      (tslcRepository.find as jest.Mock)
        .mockResolvedValueOnce([
          { templateSetId: 'orig-hardcover', libraryCategoryId: 'lib-1', sortOrder: 0 },
          { templateSetId: 'orig-hardcover', libraryCategoryId: 'lib-2', sortOrder: 1 },
        ])
        .mockResolvedValueOnce([
          { templateSetId: 'copy-id', libraryCategoryId: 'lib-1', sortOrder: 0 },
          { templateSetId: 'copy-id', libraryCategoryId: 'lib-2', sortOrder: 1 },
        ]);

      const result = await service.copy('orig-hardcover');

      expect(tslcRepository.delete).toHaveBeenCalledWith({ templateSetId: 'copy-id' });
      expect(tslcRepository.save).toHaveBeenCalledWith([
        { templateSetId: 'copy-id', libraryCategoryId: 'lib-1', sortOrder: 0 },
        { templateSetId: 'copy-id', libraryCategoryId: 'lib-2', sortOrder: 1 },
      ]);
      expect(tslcRepository.find).toHaveBeenLastCalledWith({
        where: { templateSetId: 'copy-id' },
        order: { sortOrder: 'ASC' },
      });
      expect(result.id).toBe('copy-id');
      expect(result.libraryCategoryIds).toEqual(['lib-1', 'lib-2']);
    });

    it('N-TD-1: 원본에 라이브러리 카테고리 연결이 없으면 연결을 쓰지 않는다(전역 유지)', async () => {
      (templateSetRepository.findOne as jest.Mock).mockResolvedValueOnce({ ...hardcoverWrapOriginal });

      const result = await service.copy('orig-hardcover');

      expect(tslcRepository.delete).not.toHaveBeenCalled();
      expect(tslcRepository.save).not.toHaveBeenCalled();
      expect(result.libraryCategoryIds).toEqual([]);
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
