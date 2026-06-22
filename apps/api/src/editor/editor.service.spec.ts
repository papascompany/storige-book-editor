import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { EditorService } from './editor.service';
import { EditSession, EditHistory, EditSessionStatus } from './entities/edit-session.entity';
import { EditSessionVersion } from './entities/edit-session-version.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { Template } from '../templates/entities/template.entity';
import { TemplateType, TemplateSetType, EditStatus, CanvasData } from '@storige/types';
import { EditSessionsService } from '../edit-sessions/edit-sessions.service';
import { WorkerJobsService } from '../worker-jobs/worker-jobs.service';
import { ThumbnailCleanupService } from './thumbnail-cleanup.service';

describe('EditorService', () => {
  let service: EditorService;
  let editSessionRepository: jest.Mocked<Repository<EditSession>>;
  let templateSetRepository: jest.Mocked<Repository<TemplateSet>>;
  let templateRepository: jest.Mocked<Repository<Template>>;

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
    deleteable: true,
    width: 210,
    height: 297,
  };

  const mockTemplateSet: Partial<TemplateSet> = {
    id: 'template-set-id',
    name: 'Test Template Set',
    type: TemplateSetType.BOOK,
    width: 210,
    height: 297,
    isDeleted: false,
    templates: [
      { templateId: 'template-id-1', required: true },
      { templateId: 'template-id-2', required: false },
    ],
  };

  const mockEditSession: Partial<EditSession> = {
    id: 'session-id',
    templateSetId: 'template-set-id',
    userId: 'user-id',
    status: EditSessionStatus.DRAFT as unknown as EditStatus,
    pages: [
      {
        id: 'page-1',
        templateId: 'template-id-1',
        templateType: TemplateType.PAGE,
        canvasData: mockCanvasData,
        sortOrder: 0,
        required: true,
        deleteable: false,
      },
    ],
    lockedBy: null,
    lockedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockQueryBuilder = {
    andWhere: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([[mockEditSession], 1]),
    getOne: jest.fn().mockResolvedValue(mockEditSession),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EditorService,
        {
          provide: getRepositoryToken(EditSession),
          useValue: {
            create: jest.fn().mockReturnValue(mockEditSession),
            save: jest.fn().mockResolvedValue(mockEditSession),
            findOne: jest.fn().mockResolvedValue(mockEditSession),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
          },
        },
        {
          provide: getRepositoryToken(EditHistory),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: getRepositoryToken(EditSessionVersion),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn().mockResolvedValue(null),
            find: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: EditSessionsService,
          useValue: {
            findById: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: WorkerJobsService,
          useValue: {
            createSynthesisJob: jest.fn(),
          },
        },
        {
          provide: ThumbnailCleanupService,
          useValue: {
            scheduleCleanup: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TemplateSet),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockTemplateSet),
          },
        },
        {
          provide: getRepositoryToken(Template),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockTemplate),
            // DB-002: createSession/replaceTemplateSet 가 findBy(In()) 배치 사용 →
            // templateSet.templates 의 두 id 를 모두 해석하도록 목 제공.
            findBy: jest.fn().mockResolvedValue([
              mockTemplate,
              { ...mockTemplate, id: 'template-id-2' },
            ]),
          },
        },
      ],
    }).compile();

    service = module.get<EditorService>(EditorService);
    editSessionRepository = module.get(getRepositoryToken(EditSession));
    templateSetRepository = module.get(getRepositoryToken(TemplateSet));
    templateRepository = module.get(getRepositoryToken(Template));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSession', () => {
    it('should create a new session from template set', async () => {
      const createDto = {
        templateSetId: 'template-set-id',
        userId: 'user-id',
      };

      const result = await service.createSession(createDto);

      expect(templateSetRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'template-set-id', isDeleted: false },
      });
      expect(editSessionRepository.create).toHaveBeenCalled();
      expect(editSessionRepository.save).toHaveBeenCalled();
      expect(result).toEqual(mockEditSession);
    });

    it('should throw NotFoundException when template set not found', async () => {
      templateSetRepository.findOne.mockResolvedValueOnce(null);

      const createDto = {
        templateSetId: 'non-existent-id',
      };

      await expect(service.createSession(createDto)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated sessions', async () => {
      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        items: [mockEditSession],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it('should filter by userId when provided', async () => {
      await service.findAll({ userId: 'user-id', page: 1, pageSize: 20 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'session.userId = :userId',
        { userId: 'user-id' }
      );
    });

    it('should filter by status when provided', async () => {
      await service.findAll({ status: 'review', page: 1, pageSize: 20 });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'session.status = :status',
        { status: 'review' }
      );
    });
  });

  describe('findOne', () => {
    it('should return a session by id', async () => {
      const result = await service.findOne('session-id');

      expect(editSessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-id' },
        relations: ['templateSet', 'user', 'lockedByUser'],
      });
      expect(result).toEqual(mockEditSession);
    });

    it('should throw NotFoundException when session not found', async () => {
      editSessionRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.findOne('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });
});
