/**
 * TemplateSetsService 방향(orientation) 페어링/파생 spec (2026-07-14, 오너 승인 설계).
 *
 * 불변식:
 * - 대칭 저장: 페어 양쪽 행이 서로를 가리킨다 (트랜잭션).
 * - 짝 중 is_orientation_default 정확히 1개 (한쪽 세팅 시 반대쪽 자동 해제).
 * - 성립 조건: 같은 재단 규격의 정확 W↔H 스왑(±0.01mm), 정사각·자기자신 불가.
 * - 파생: page류만 변환 복제, spread/spine/wing/endpaper 제외, is_active=0 초안,
 *   생성 즉시 원본과 페어링(원본 default 유지). 이미 짝이 있으면 409.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { TemplateSetsService } from './template-sets.service';
import { TemplateSet, TemplateSetItem } from './entities/template-set.entity';
import { TemplateSetLibraryCategory } from './entities/template-set-library-category.entity';
import { Template } from './entities/template.entity';
import { Product } from '../products/entities/product.entity';
import type { CanvasData } from '@storige/types';

interface MockTxManager {
  update: jest.Mock;
  save: jest.Mock;
}

describe('TemplateSetsService — orientation 페어링/파생', () => {
  let service: TemplateSetsService;

  // id → 세트 fixture 저장소 (findOne mock 이 조회)
  let setsById: Record<string, Partial<TemplateSet>>;
  let templatesById: Record<string, Partial<Template>>;

  let txManager: MockTxManager;
  let templateSetFindOne: jest.Mock;
  let templateFindByIds: jest.Mock;

  const pageCanvasData: CanvasData = {
    version: '5.3.0',
    width: 210,
    height: 297,
    objects: [
      {
        type: 'rect',
        id: 'workspace',
        left: 0,
        top: 0,
        width: 1275.59,
        height: 1789.37,
        scaleX: 1,
        scaleY: 1,
        originX: 'center',
        originY: 'center',
      },
      {
        type: 'textbox',
        id: 't1',
        left: 100,
        top: 50,
        width: 200,
        height: 40,
        scaleX: 1,
        scaleY: 1,
        angle: 0,
        styles: { '0': { '0': { fontFamily: 'NanumGothic' } } },
      },
    ],
  };

  function makePortraitSet(overrides: Partial<TemplateSet> = {}): Partial<TemplateSet> {
    return {
      id: 'set-portrait',
      name: 'A4 세트',
      type: 'book' as TemplateSet['type'],
      width: 210,
      height: 297,
      canAddPage: true,
      pageCountRange: [10, 20],
      templates: [
        { templateId: 'tpl-spread', required: true },
        { templateId: 'tpl-page', required: false },
      ],
      editorMode: 'book' as TemplateSet['editorMode'],
      enabledMenus: null,
      endpaperConfig: null,
      coverEditable: true,
      coverPreviewImage: null,
      contentPdfEditable: true,
      pdfOutputMode: 'duplex-merged' as TemplateSet['pdfOutputMode'],
      colorMode: 'rgb' as TemplateSet['colorMode'],
      bleedMm: 3,
      cropMarkEnabled: true,
      sizeToleranceMm: 0.2,
      pricing: null,
      coverType: null,
      coverConfig: null,
      description: null,
      categoryId: null,
      productSpecs: null,
      siteId: null,
      isDeleted: false,
      isActive: true,
      pairedTemplateSetId: null,
      isOrientationDefault: true,
      ...overrides,
    };
  }

  function makeLandscapeSet(overrides: Partial<TemplateSet> = {}): Partial<TemplateSet> {
    return makePortraitSet({
      id: 'set-landscape',
      name: 'A4 세트 (가로)',
      width: 297,
      height: 210,
      templates: [],
      ...overrides,
    });
  }

  beforeEach(async () => {
    setsById = {};
    templatesById = {
      'tpl-spread': {
        id: 'tpl-spread',
        name: 'A4 표지 스프레드',
        type: 'spread' as Template['type'],
        width: 430,
        height: 297,
        editable: true,
        deleteable: false,
        canvasData: { version: '5.3.0', width: 430, height: 297, objects: [] },
        spreadConfig: null,
        isDeleted: false,
        categoryId: null,
        editCode: 'EC-SPREAD',
        templateCode: 'TC-SPREAD',
        isActive: true,
        createdBy: 'admin-001',
        siteId: null,
      },
      'tpl-page': {
        id: 'tpl-page',
        name: 'A4 내지',
        type: 'page' as Template['type'],
        width: 210,
        height: 297,
        editable: true,
        deleteable: true,
        canvasData: pageCanvasData,
        spreadConfig: null,
        isDeleted: false,
        categoryId: 'cat-1',
        editCode: 'EC-PAGE',
        templateCode: 'TC-PAGE',
        isActive: true,
        createdBy: 'admin-001',
        siteId: 'site-1',
      },
    };

    txManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation(async (_entity: unknown, obj: unknown) => obj),
    };

    templateSetFindOne = jest.fn().mockImplementation(
      async (opts: { where: { id: string; isDeleted: boolean } }) => {
        const found = setsById[opts.where.id];
        if (!found || found.isDeleted) return null;
        return { ...found };
      },
    );

    templateFindByIds = jest.fn().mockImplementation(async (ids: string[]) => {
      return ids
        .map((tid) => templatesById[tid])
        .filter((t): t is Partial<Template> => Boolean(t));
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplateSetsService,
        {
          provide: getRepositoryToken(TemplateSet),
          useValue: {
            create: jest.fn().mockImplementation((v: Partial<TemplateSet>) => ({ ...v })),
            save: jest.fn().mockImplementation(async (v: Partial<TemplateSet>) => v),
            findOne: templateSetFindOne,
            manager: {
              transaction: jest
                .fn()
                .mockImplementation(async (cb: (m: MockTxManager) => Promise<unknown>) =>
                  cb(txManager),
                ),
            },
          },
        },
        {
          provide: getRepositoryToken(TemplateSetItem),
          useValue: { create: jest.fn(), save: jest.fn(), find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(Template),
          useValue: {
            create: jest.fn().mockImplementation((v: Partial<Template>) => ({ ...v })),
            findOne: jest.fn().mockResolvedValue(null),
            findByIds: templateFindByIds,
          },
        },
        {
          provide: getRepositoryToken(Product),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(TemplateSetLibraryCategory),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            delete: jest.fn().mockResolvedValue({ affected: 0 }),
            create: jest.fn().mockImplementation((row: unknown) => row),
            save: jest.fn().mockImplementation(async (rows: unknown) => rows),
          },
        },
      ],
    }).compile();

    service = module.get<TemplateSetsService>(TemplateSetsService);
  });

  // ───────────────────────── pair ─────────────────────────

  describe('pair', () => {
    it('정확 W↔H 스왑 두 세트를 대칭 저장하고 :id 를 default 로 세팅한다', async () => {
      setsById['set-portrait'] = makePortraitSet();
      setsById['set-landscape'] = makeLandscapeSet();

      const result = await service.pair('set-portrait', 'set-landscape');

      expect(txManager.update).toHaveBeenCalledTimes(2);
      expect(txManager.update).toHaveBeenNthCalledWith(1, TemplateSet, 'set-portrait', {
        pairedTemplateSetId: 'set-landscape',
        isOrientationDefault: true,
      });
      expect(txManager.update).toHaveBeenNthCalledWith(2, TemplateSet, 'set-landscape', {
        pairedTemplateSetId: 'set-portrait',
        isOrientationDefault: false,
      });
      expect(result.success).toBe(true);
      expect(result.data.pairedTemplateSetId).toBe('set-landscape');
      expect(result.data.isOrientationDefault).toBe(true);
    });

    it('허용오차 ±0.01mm 이내 스왑은 성립한다', async () => {
      setsById['set-portrait'] = makePortraitSet();
      setsById['set-landscape'] = makeLandscapeSet({ width: 297.01, height: 209.99 });

      const result = await service.pair('set-portrait', 'set-landscape');
      expect(result.success).toBe(true);
    });

    it('자기 자신과의 페어링은 400', async () => {
      setsById['set-portrait'] = makePortraitSet();
      await expect(service.pair('set-portrait', 'set-portrait')).rejects.toThrow(
        BadRequestException,
      );
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it('정사각 판형은 400', async () => {
      setsById['sq-a'] = makePortraitSet({ id: 'sq-a', width: 210, height: 210 });
      setsById['sq-b'] = makePortraitSet({ id: 'sq-b', width: 210, height: 210 });
      await expect(service.pair('sq-a', 'sq-b')).rejects.toThrow(BadRequestException);
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it('W↔H 스왑이 아닌 치수는 400 (같은 방향 동일 판형 포함)', async () => {
      setsById['set-portrait'] = makePortraitSet();
      setsById['set-other'] = makePortraitSet({ id: 'set-other', width: 210, height: 297 });
      await expect(service.pair('set-portrait', 'set-other')).rejects.toThrow(
        BadRequestException,
      );

      setsById['set-b5'] = makePortraitSet({ id: 'set-b5', width: 257, height: 182 });
      await expect(service.pair('set-portrait', 'set-b5')).rejects.toThrow(BadRequestException);
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it(':id 쪽이 이미 다른 세트와 페어링돼 있으면 409', async () => {
      setsById['set-portrait'] = makePortraitSet({ pairedTemplateSetId: 'set-third' });
      setsById['set-landscape'] = makeLandscapeSet();
      await expect(service.pair('set-portrait', 'set-landscape')).rejects.toThrow(
        ConflictException,
      );
    });

    it('상대 쪽이 이미 다른 세트와 페어링돼 있으면 409', async () => {
      setsById['set-portrait'] = makePortraitSet();
      setsById['set-landscape'] = makeLandscapeSet({ pairedTemplateSetId: 'set-third' });
      await expect(service.pair('set-portrait', 'set-landscape')).rejects.toThrow(
        ConflictException,
      );
    });

    it('이미 서로 페어인 두 세트의 재호출은 멱등 (default 재단언)', async () => {
      setsById['set-portrait'] = makePortraitSet({
        pairedTemplateSetId: 'set-landscape',
        isOrientationDefault: false,
      });
      setsById['set-landscape'] = makeLandscapeSet({ pairedTemplateSetId: 'set-portrait' });

      const result = await service.pair('set-portrait', 'set-landscape');
      expect(result.data.isOrientationDefault).toBe(true);
      expect(txManager.update).toHaveBeenCalledTimes(2);
    });

    it('상대 세트가 없거나 삭제됐으면 404', async () => {
      setsById['set-portrait'] = makePortraitSet();
      await expect(service.pair('set-portrait', 'missing')).rejects.toThrow(NotFoundException);

      setsById['set-landscape'] = makeLandscapeSet({ isDeleted: true });
      await expect(service.pair('set-portrait', 'set-landscape')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ───────────────────────── unpair ─────────────────────────

  describe('unpair', () => {
    it('양쪽 모두 NULL + default 원복으로 대칭 해제한다', async () => {
      setsById['set-portrait'] = makePortraitSet({ pairedTemplateSetId: 'set-landscape' });

      const result = await service.unpair('set-portrait');

      expect(txManager.update).toHaveBeenCalledTimes(2);
      expect(txManager.update).toHaveBeenNthCalledWith(1, TemplateSet, 'set-portrait', {
        pairedTemplateSetId: null,
        isOrientationDefault: true,
      });
      expect(txManager.update).toHaveBeenNthCalledWith(2, TemplateSet, 'set-landscape', {
        pairedTemplateSetId: null,
        isOrientationDefault: true,
      });
      expect(result.data.pairedTemplateSetId).toBeNull();
      expect(result.data.isOrientationDefault).toBe(true);
    });

    it('페어링되어 있지 않으면 400', async () => {
      setsById['set-portrait'] = makePortraitSet();
      await expect(service.unpair('set-portrait')).rejects.toThrow(BadRequestException);
      expect(txManager.update).not.toHaveBeenCalled();
    });
  });

  // ───────────────────── orientation-default ─────────────────────

  describe('setOrientationDefault', () => {
    it('자신 true + 짝 반대쪽 자동 해제 (트랜잭션)', async () => {
      setsById['set-portrait'] = makePortraitSet({
        pairedTemplateSetId: 'set-landscape',
        isOrientationDefault: false,
      });

      const result = await service.setOrientationDefault('set-portrait');

      expect(txManager.update).toHaveBeenCalledTimes(2);
      expect(txManager.update).toHaveBeenNthCalledWith(1, TemplateSet, 'set-portrait', {
        isOrientationDefault: true,
      });
      expect(txManager.update).toHaveBeenNthCalledWith(2, TemplateSet, 'set-landscape', {
        isOrientationDefault: false,
      });
      expect(result.data.isOrientationDefault).toBe(true);
    });

    it('비페어 세트는 자신만 true (반대쪽 갱신 없음)', async () => {
      setsById['set-portrait'] = makePortraitSet();

      await service.setOrientationDefault('set-portrait');

      expect(txManager.update).toHaveBeenCalledTimes(1);
      expect(txManager.update).toHaveBeenCalledWith(TemplateSet, 'set-portrait', {
        isOrientationDefault: true,
      });
    });
  });

  // ───────────────────── derive-orientation ─────────────────────

  describe('deriveOrientation', () => {
    it('page류만 변환 복제 + is_active=0 초안 세트 + 즉시 대칭 페어링(원본 default 유지)', async () => {
      setsById['set-portrait'] = makePortraitSet();

      const result = await service.deriveOrientation('set-portrait');

      // 1) 템플릿 복제: page 1건만 (spread 제외)
      const templateSaves = txManager.save.mock.calls.filter(([entity]) => entity === Template);
      expect(templateSaves).toHaveLength(1);
      const savedTpl = templateSaves[0][1] as Partial<Template>;
      expect(savedTpl.type).toBe('page');
      expect(savedTpl.width).toBe(297); // W↔H 스왑
      expect(savedTpl.height).toBe(210);
      expect(savedTpl.name).toBe('A4 내지 (가로)');
      expect(savedTpl.thumbnailUrl).toBeNull();
      expect(savedTpl.isActive).toBe(true); // 복제 템플릿은 활성 (오너 설계 ④)
      expect(savedTpl.editCode).toBeNull(); // unique 컬럼 복제 금지
      expect(savedTpl.templateCode).toBeNull();
      expect(savedTpl.categoryId).toBe('cat-1');
      expect(savedTpl.siteId).toBe('site-1');
      expect(typeof savedTpl.id).toBe('string');
      expect(savedTpl.id).not.toBe('tpl-page');

      // canvasData 변환: top-level mm 스왑 + 위치 축별 비율 + styles/크기 보존
      const cd = savedTpl.canvasData as CanvasData;
      expect(cd.width).toBe(297);
      expect(cd.height).toBe(210);
      const textbox = cd.objects.find((o) => o.id === 't1');
      expect(textbox?.left).toBeCloseTo(100 * (297 / 210), 10);
      expect(textbox?.top).toBeCloseTo(50 * (210 / 297), 10);
      expect(textbox?.width).toBe(200);
      expect(textbox?.styles).toEqual({ '0': { '0': { fontFamily: 'NanumGothic' } } });
      const ws = cd.objects.find((o) => o.id === 'workspace');
      expect(ws?.width).toBeCloseTo(1789.37, 6); // 유효 치수 W↔H 스왑
      expect(ws?.height).toBeCloseTo(1275.59, 6);
      // 원본 canvasData 는 불변 (순수 변환)
      expect((templatesById['tpl-page'].canvasData as CanvasData).width).toBe(210);

      // 2) 새 세트: 판형 스왑 + 설정 복사 + 초안 + refs 재작성(spread 제외)
      const setSaves = txManager.save.mock.calls.filter(([entity]) => entity === TemplateSet);
      expect(setSaves).toHaveLength(1);
      const savedSet = setSaves[0][1] as Partial<TemplateSet>;
      expect(savedSet.name).toBe('A4 세트 (가로)');
      expect(savedSet.width).toBe(297);
      expect(savedSet.height).toBe(210);
      expect(savedSet.isActive).toBe(false); // 초안 — 사람 검수 후 활성 (오너 설계 ③)
      expect(savedSet.isDeleted).toBe(false);
      expect(savedSet.thumbnailUrl).toBeNull();
      expect(savedSet.templates).toEqual([{ templateId: savedTpl.id, required: false }]);
      expect(savedSet.bleedMm).toBe(3);
      expect(savedSet.cropMarkEnabled).toBe(true);
      expect(savedSet.sizeToleranceMm).toBe(0.2);
      expect(savedSet.pageCountRange).toEqual([10, 20]);
      expect(savedSet.editorMode).toBe('book');
      expect(savedSet.pairedTemplateSetId).toBe('set-portrait');
      expect(savedSet.isOrientationDefault).toBe(false); // 원본이 default

      // 3) 원본에 대칭 페어링 기록 (default 유지)
      expect(txManager.update).toHaveBeenCalledWith(TemplateSet, 'set-portrait', {
        pairedTemplateSetId: savedSet.id,
        isOrientationDefault: true,
      });

      expect(result.success).toBe(true);
      expect(result.data).toBe(savedSet);
    });

    it('가로 원본에서 파생하면 접미는 (세로), 기존 접미는 치환된다', async () => {
      setsById['set-landscape'] = makeLandscapeSet({
        templates: [{ templateId: 'tpl-page-l', required: true }],
      });
      templatesById['tpl-page-l'] = {
        ...templatesById['tpl-page'],
        id: 'tpl-page-l',
        name: 'A4 내지 (가로)',
        width: 297,
        height: 210,
        canvasData: { version: '5.3.0', width: 297, height: 210, objects: [] },
      };

      const result = await service.deriveOrientation('set-landscape');

      const setSaves = txManager.save.mock.calls.filter(([entity]) => entity === TemplateSet);
      const savedSet = setSaves[0][1] as Partial<TemplateSet>;
      expect(savedSet.name).toBe('A4 세트 (세로)'); // ' (가로)' 접미 치환
      expect(savedSet.width).toBe(210);
      expect(savedSet.height).toBe(297);

      const templateSaves = txManager.save.mock.calls.filter(([entity]) => entity === Template);
      const savedTpl = templateSaves[0][1] as Partial<Template>;
      expect(savedTpl.name).toBe('A4 내지 (세로)');
      expect(result.success).toBe(true);
    });

    it('이미 방향 짝이 있으면 409 (파생 없음)', async () => {
      setsById['set-portrait'] = makePortraitSet({ pairedTemplateSetId: 'set-landscape' });
      await expect(service.deriveOrientation('set-portrait')).rejects.toThrow(ConflictException);
      expect(txManager.save).not.toHaveBeenCalled();
      expect(txManager.update).not.toHaveBeenCalled();
    });

    it('정사각 판형은 400 (파생 무의미)', async () => {
      setsById['sq'] = makePortraitSet({ id: 'sq', width: 210, height: 210 });
      await expect(service.deriveOrientation('sq')).rejects.toThrow(BadRequestException);
      expect(txManager.save).not.toHaveBeenCalled();
    });

    it('셋이 참조하는 템플릿이 없으면 404 (부분 파생 방지)', async () => {
      setsById['set-portrait'] = makePortraitSet({
        templates: [{ templateId: 'tpl-missing', required: false }],
      });
      await expect(service.deriveOrientation('set-portrait')).rejects.toThrow(NotFoundException);
      expect(txManager.save).not.toHaveBeenCalled();
    });

    it('세트가 없으면 404', async () => {
      await expect(service.deriveOrientation('missing')).rejects.toThrow(NotFoundException);
    });
  });
});
