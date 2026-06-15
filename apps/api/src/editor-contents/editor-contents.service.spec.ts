import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EditorContentsService } from './editor-contents.service';
import { EditorContent } from './entities/editor-content.entity';
import { LibraryClipart } from '../library/entities/clipart.entity';
import { LibraryFrame } from '../library/entities/frame.entity';
import { LibraryBackground } from '../library/entities/background.entity';
import { TemplateSetLibraryCategory } from '../templates/entities/template-set-library-category.entity';
import { QueryEditorContentDto } from './dto/query-editor-content.dto';

/**
 * EditorContentsService 단위 테스트 — 템플릿셋 큐레이션 + 전역 폴백(P1, 2026-06-15).
 *
 * 검증 대상(findFromLibrary 경로, getElements 진입):
 *  - curated 연결 0개 → 전역(category 필터 미적용).
 *  - curated 연결 있음 + 매칭 에셋 존재 → 스코프(category_id IN (...)).
 *  - curated 연결 있으나 그 카테고리에 활성 에셋 0건 → 전역으로 재조회(빈 화면 방지).
 */
describe('EditorContentsService', () => {
  let service: EditorContentsService;
  let clipartRepository: jest.Mocked<Repository<LibraryClipart>>;
  let tslcRepository: jest.Mocked<Repository<TemplateSetLibraryCategory>>;

  const sampleRow = {
    id: 'clip-1',
    name: 'Star',
    fileUrl: '/storage/library/clip-1.svg',
    category: 'shapes',
    categoryId: 'cat-1',
    tags: ['shape'],
    isActive: true,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  };

  /**
   * createQueryBuilder() 호출마다 독립된 스텁 빌더를 반환하는 팩토리.
   * 각 호출의 getManyAndCount 결과를 큐(`results`)에서 차례로 꺼내 쓰도록 하여
   * "스코프 조회 → (빈 결과면) 전역 폴백 재조회" 2단계 동작을 검증한다.
   */
  function makeQueryBuilderFactory(results: Array<[any[], number]>) {
    const calls: Array<{ andWhereArgs: any[][] }> = [];
    const factory = jest.fn().mockImplementation(() => {
      const record = { andWhereArgs: [] as any[][] };
      calls.push(record);
      const next = results.shift() ?? [[], 0];
      const qb: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn(function (...args: any[]) {
          record.andWhereArgs.push(args);
          return qb;
        }),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue(next),
      };
      return qb;
    });
    return { factory, calls };
  }

  function buildModule(qbFactory: jest.Mock) {
    return Test.createTestingModule({
      providers: [
        EditorContentsService,
        {
          provide: getRepositoryToken(EditorContent),
          useValue: { createQueryBuilder: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(LibraryClipart),
          useValue: { createQueryBuilder: qbFactory, findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(LibraryFrame),
          useValue: { createQueryBuilder: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(LibraryBackground),
          useValue: { createQueryBuilder: jest.fn(), findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(TemplateSetLibraryCategory),
          useValue: { find: jest.fn() },
        },
      ],
    }).compile();
  }

  async function init(qbFactory: jest.Mock, tslcFind: jest.Mock) {
    const module: TestingModule = await buildModule(qbFactory);
    service = module.get<EditorContentsService>(EditorContentsService);
    clipartRepository = module.get(getRepositoryToken(LibraryClipart));
    tslcRepository = module.get(getRepositoryToken(TemplateSetLibraryCategory));
    tslcRepository.find = tslcFind as any;
  }

  it('curated 연결 0개 → 전역(category 필터 미적용, 단일 조회)', async () => {
    const { factory, calls } = makeQueryBuilderFactory([[[sampleRow], 1]]);
    // 연결 0개 → getCuratedCategoryIds 가 null 반환
    await init(factory, jest.fn().mockResolvedValue([]));

    const dto: QueryEditorContentDto = { templateSetId: 'ts-1' } as QueryEditorContentDto;
    const res = await service.getElements(dto);

    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    // 빌더는 정확히 1회 생성(폴백 없음), category_id 필터 미적용
    expect(factory).toHaveBeenCalledTimes(1);
    const categoryFilters = calls[0].andWhereArgs.filter((a) =>
      typeof a[0] === 'string' && a[0].includes('category_id'),
    );
    expect(categoryFilters).toHaveLength(0);
  });

  it('curated 매칭 있음 → 스코프(category_id IN (...)), 폴백 없음', async () => {
    const { factory, calls } = makeQueryBuilderFactory([[[sampleRow], 1]]);
    await init(factory, jest.fn().mockResolvedValue([{ libraryCategoryId: 'cat-1' }]));

    const dto: QueryEditorContentDto = { templateSetId: 'ts-1' } as QueryEditorContentDto;
    const res = await service.getElements(dto);

    expect(res.total).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    const categoryFilters = calls[0].andWhereArgs.filter((a) =>
      typeof a[0] === 'string' && a[0].includes('category_id'),
    );
    expect(categoryFilters).toHaveLength(1);
    expect(categoryFilters[0][1]).toEqual({ curatedIds: ['cat-1'] });
  });

  it('curated 연결 있으나 에셋 0건 → 전역 폴백 재조회(category 필터 없이)', async () => {
    // 1차(스코프) 조회: 0건 → 2차(폴백) 조회: 전역 결과 반환
    const { factory, calls } = makeQueryBuilderFactory([
      [[], 0],
      [[sampleRow], 1],
    ]);
    await init(factory, jest.fn().mockResolvedValue([{ libraryCategoryId: 'cat-empty' }]));

    const dto: QueryEditorContentDto = { templateSetId: 'ts-1' } as QueryEditorContentDto;
    const res = await service.getElements(dto);

    // 폴백으로 전역 결과가 채워져야 함
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    // 빌더가 정확히 2회 생성(스코프 + 폴백)
    expect(factory).toHaveBeenCalledTimes(2);
    // 1차 빌더에는 category_id 필터가 적용, 2차(폴백) 빌더에는 미적용
    const scopedCategoryFilters = calls[0].andWhereArgs.filter((a) =>
      typeof a[0] === 'string' && a[0].includes('category_id'),
    );
    const fallbackCategoryFilters = calls[1].andWhereArgs.filter((a) =>
      typeof a[0] === 'string' && a[0].includes('category_id'),
    );
    expect(scopedCategoryFilters).toHaveLength(1);
    expect(fallbackCategoryFilters).toHaveLength(0);
  });

  it('templateSetId 없음 → 큐레이션 조회 자체를 하지 않음(전역, 단일 조회)', async () => {
    const { factory } = makeQueryBuilderFactory([[[sampleRow], 1]]);
    const tslcFind = jest.fn().mockResolvedValue([]);
    await init(factory, tslcFind);

    const dto: QueryEditorContentDto = {} as QueryEditorContentDto;
    const res = await service.getElements(dto);

    expect(res.total).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
    // templateSetId 미지정이면 getCuratedCategoryIds(=tslc.find) 호출 안 함
    expect(tslcFind).not.toHaveBeenCalled();
  });
});
