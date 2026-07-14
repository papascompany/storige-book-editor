import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, FindOneOptions, FindManyOptions } from 'typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { FormatPresetsService } from './format-presets.service';
import { FormatPreset } from './entities/format-preset.entity';
import {
  FormatPresetSeedService,
  FORMAT_PRESET_SEEDS,
} from '../database/seeds/format-preset-seed.service';

/**
 * 판형 프리셋 — 서비스 CRUD + 시드 멱등 검증 (2026-07-14)
 *
 * 규칙:
 *  1. 목록은 sort_order ASC, isActive 미지정 시 전체(비활성 포함).
 *  2. create 는 code 중복 시 409(ConflictException).
 *  3. 하드 삭제 금지 — 서비스에 remove 메서드가 없고, 비활성화는 isActive 토글.
 *  4. 시드는 code 기준 멱등 — 2회 실행해도 7행 유지, 운영자가 수정한 기존 행 보존.
 */

const makePreset = (overrides: Partial<FormatPreset> = {}): FormatPreset => {
  const base = new FormatPreset();
  base.id = 'preset-a4';
  base.code = 'a4';
  base.name = 'A4';
  base.trimWidthMm = 210;
  base.trimHeightMm = 297;
  base.bleedMm = 3;
  base.sortOrder = 10;
  base.isActive = true;
  base.siteId = null;
  return Object.assign(base, overrides);
};

describe('FormatPresetsService', () => {
  let service: FormatPresetsService;
  let repo: jest.Mocked<Repository<FormatPreset>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormatPresetsService,
        {
          provide: getRepositoryToken(FormatPreset),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn((v: Partial<FormatPreset>) => v as FormatPreset),
            save: jest.fn(async (v: FormatPreset) => v),
          },
        },
      ],
    }).compile();

    service = module.get(FormatPresetsService);
    repo = module.get(getRepositoryToken(FormatPreset));
  });

  describe('list', () => {
    it('sort_order ASC 로 정렬 조회하고, 기본은 전체(비활성 포함)', async () => {
      const items = [
        makePreset(),
        makePreset({ id: 'preset-b6', code: 'b6', isActive: false }),
      ];
      repo.find.mockResolvedValue(items);

      const result = await service.list();

      expect(result).toBe(items);
      const options = repo.find.mock
        .calls[0][0] as FindManyOptions<FormatPreset>;
      expect(options.order).toMatchObject({ sortOrder: 'ASC' });
      expect(options.where).toEqual({});
    });

    it('isActive=true 지정 시 활성만 필터', async () => {
      repo.find.mockResolvedValue([]);

      await service.list(true);

      const options = repo.find.mock
        .calls[0][0] as FindManyOptions<FormatPreset>;
      expect(options.where).toEqual({ isActive: true });
    });
  });

  describe('create', () => {
    it('신규 code 는 생성 후 저장', async () => {
      repo.findOne.mockResolvedValue(null);

      const dto = {
        code: 'square210',
        name: '정사각',
        trimWidthMm: 210,
        trimHeightMm: 210,
      };
      const result = await service.create(dto);

      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.code).toBe('square210');
    });

    it('code 중복이면 ConflictException(409)', async () => {
      repo.findOne.mockResolvedValue(makePreset());

      await expect(
        service.create({
          code: 'a4',
          name: '다른 A4',
          trimWidthMm: 210,
          trimHeightMm: 297,
        }),
      ).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('존재하지 않는 id 는 NotFoundException', async () => {
      repo.findOne.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('필드 병합 후 저장 (soft 비활성 = isActive:false 토글)', async () => {
      repo.findOne.mockResolvedValue(makePreset());

      const result = await service.update('preset-a4', { isActive: false });

      expect(repo.save).toHaveBeenCalledTimes(1);
      expect(result.isActive).toBe(false);
      // 나머지 필드는 보존
      expect(result.code).toBe('a4');
      expect(result.trimWidthMm).toBe(210);
    });

    it('code 를 기존 다른 행의 code 로 변경하면 ConflictException', async () => {
      repo.findOne.mockImplementation(
        async (options: FindOneOptions<FormatPreset>) => {
          const where = options.where as Partial<FormatPreset>;
          if (where.id === 'preset-a4') return makePreset();
          if (where.code === 'b5') {
            return makePreset({ id: 'preset-b5', code: 'b5' });
          }
          return null;
        },
      );

      await expect(
        service.update('preset-a4', { code: 'b5' }),
      ).rejects.toThrow(ConflictException);
      expect(repo.save).not.toHaveBeenCalled();
    });
  });

  it('하드 삭제 금지 — 서비스에 remove/delete 메서드가 없다', () => {
    const surface = service as unknown as Record<string, unknown>;
    expect(surface.remove).toBeUndefined();
    expect(surface.delete).toBeUndefined();
  });
});

describe('FormatPresetSeedService (멱등)', () => {
  let seedService: FormatPresetSeedService;
  let saveSpy: jest.Mock;
  /** code → row 인메모리 저장소 (멱등 검증용) */
  let store: Map<string, FormatPreset>;

  beforeEach(async () => {
    store = new Map();
    saveSpy = jest.fn(async (v: FormatPreset) => {
      store.set(v.code, v);
      return v;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FormatPresetSeedService,
        {
          provide: getRepositoryToken(FormatPreset),
          useValue: {
            findOne: jest.fn(
              async (options: FindOneOptions<FormatPreset>) => {
                const where = options.where as Partial<FormatPreset>;
                return (where.code && store.get(where.code)) || null;
              },
            ),
            create: jest.fn((v: Partial<FormatPreset>) =>
              Object.assign(new FormatPreset(), v),
            ),
            save: saveSpy,
          },
        },
      ],
    }).compile();

    seedService = module.get(FormatPresetSeedService);
  });

  it('빈 DB 에서 표준 7종을 생성한다', async () => {
    await seedService.onModuleInit();

    expect(store.size).toBe(7);
    expect(saveSpy).toHaveBeenCalledTimes(7);
    const a4 = store.get('a4');
    expect(a4).toMatchObject({
      name: 'A4',
      trimWidthMm: 210,
      trimHeightMm: 297,
      bleedMm: 3,
      sortOrder: 10,
    });
    // 정의된 시드 자체도 7종 고정
    expect(FORMAT_PRESET_SEEDS).toHaveLength(7);
  });

  it('2회 실행해도 7행 유지 (재삽입 없음)', async () => {
    await seedService.onModuleInit();
    await seedService.onModuleInit();

    expect(store.size).toBe(7);
    expect(saveSpy).toHaveBeenCalledTimes(7); // 2회차는 전부 no-op
  });

  it('운영자가 수정한 기존 행은 덮어쓰지 않는다', async () => {
    const customized = makePreset({
      code: 'a4',
      name: 'A4 커스텀',
      bleedMm: 5,
    });
    store.set('a4', customized);

    await seedService.onModuleInit();

    expect(store.size).toBe(7);
    expect(saveSpy).toHaveBeenCalledTimes(6); // a4 는 건너뜀
    expect(store.get('a4')).toMatchObject({ name: 'A4 커스텀', bleedMm: 5 });
  });

  it('세로형 기준 저장 — 정사각 제외 전부 W ≤ H', () => {
    for (const seed of FORMAT_PRESET_SEEDS) {
      expect(seed.trimWidthMm).toBeLessThanOrEqual(seed.trimHeightMm);
    }
  });
});
