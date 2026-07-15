/**
 * Partner API v1 — BookSpecs 판형 마스터 spec (Stage 1-B → Stage 1 통합 정합화)
 *
 * 고정하는 계약:
 *  1. 인증 시맨틱 — @PartnerV1Controller 조합 데코레이터: @Public(전역
 *     JwtAuthGuard 우회) + PartnerApiKeyGuard(Bearer/X-API-Key 병행) +
 *     PartnerRateLimitGuard + v1 필터/인터셉터 스택 (Stage 1 통합 반영).
 *  2. 성공 봉투 4필드 {success,message,data,pagination} — 설계서 §3.1.
 *     핸들러는 순수 데이터(목록=PaginatedResult)만 반환, 봉투는
 *     PartnerEnvelopeInterceptor 가 조립(이중 래핑 금지).
 *  3. calculated-size 수치 — 기존 SpineService 실물 계산과 대조
 *     (책등 = pageCount/2 × thickness + margin, 반올림 2자리).
 *  4. 페이지 경계 — min/max/increment 위반 = 422 ERR_PAGE_COUNT_OUT_OF_RANGE
 *     (설계서 §3.3 카탈로그 정본), 비정수/0/음수/누락 = DTO 400.
 *  5. 404 — 없음/비활성/타 사이트 = ERR_BOOK_SPEC_NOT_FOUND (존재 은닉).
 *
 * ⚠️ 워커 검증 상수 LEGACY_SIZE_TOLERANCE_MM=1 은 참조(정합 단언)만 —
 *    검증측 변경 금지(2026-06-10 회귀 이력).
 */
import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  PATH_METADATA,
  METHOD_METADATA,
  GUARDS_METADATA,
  EXCEPTION_FILTERS_METADATA,
  INTERCEPTORS_METADATA,
} from '@nestjs/common/constants';
import { firstValueFrom, of } from 'rxjs';
import { BookSpecsService } from './book-specs.service';
import { BookSpecsController } from './book-specs.controller';
import { BookSpec } from './entities/book-spec.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { SpineService } from '../products/spine.service';
import { PaperTypeEntity } from '../products/entities/paper-type.entity';
import { BindingTypeEntity } from '../products/entities/binding-type.entity';
import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { PartnerApiKeyGuard } from '../partner-api/guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../partner-api/guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from '../partner-api/http/partner-api-exception.filter';
import { PartnerApiException } from '../partner-api/http/partner-api.exceptions';
import { PartnerEnvelopeInterceptor } from '../partner-api/http/partner-envelope.interceptor';
import { PartnerAuditInterceptor } from '../partner-api/audit/partner-audit.interceptor';
import { PartnerIdempotencyInterceptor } from '../partner-api/idempotency/partner-idempotency.interceptor';
import { CalculatedSizeQueryDto, BookSpecListQueryDto } from './dto/book-spec.dto';
import { CurrentSitePayload } from '../auth/decorators/current-site.decorator';
import {
  TemplateSetRow,
  collectBookSpecCandidates,
  derivePageRules,
  toInsertSql,
} from './cli/collect-book-specs.core';

const SITE_A = 'site-aaaa';
const SITE_B = 'site-bbbb';

/** 반드시 throw 해야 하는 호출을 실행하고 에러를 반환 (jest circus 에 fail() 없음) */
async function captureRejection(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error('expected rejection, but resolved');
}

/**
 * 핸들러 반환값을 실물 PartnerEnvelopeInterceptor 에 통과시켜 성공 봉투를
 * 얻는다 — 컨트롤러는 순수 데이터만 반환하고 봉투는 인터셉터 책임(§3.1)이라는
 * Stage 1 통합 규약을 유닛 레벨에서 그대로 재현한다.
 */
async function throughEnvelope<T>(result: T) {
  const interceptor = new PartnerEnvelopeInterceptor();
  const handler: CallHandler = { handle: () => of(result) };
  return firstValueFrom(interceptor.intercept({} as ExecutionContext, handler));
}

/** spine-seed.service.ts 실계수와 동일한 픽스처 (mojo_80g/mojo_70g, perfect/saddle) */
const PAPER_FIXTURES: Array<Partial<PaperTypeEntity>> = [
  { code: 'mojo_80g', name: '모조지 80g', thickness: 0.1, category: 'body', isActive: true },
  { code: 'mojo_70g', name: '모조지 70g', thickness: 0.09, category: 'body', isActive: true },
];
const BINDING_FIXTURES: Array<Partial<BindingTypeEntity>> = [
  { code: 'perfect', name: '무선제본', margin: 0.5, minPages: 32, isActive: true },
  {
    code: 'saddle',
    name: '중철제본',
    margin: 0.3,
    maxPages: 64,
    pageMultiple: 4,
    isActive: true,
  },
];

const makeSpec = (overrides: Partial<BookSpec> = {}): BookSpec => {
  const base = new BookSpec();
  base.id = 'internal-uuid-1';
  base.uid = 'bs_a4perfect01';
  base.siteId = null;
  base.name = 'A4 무선 소프트커버';
  base.coverType = 'softcover_variable_spine';
  base.bindingType = 'perfect';
  base.orientation = 'portrait';
  base.innerTrimWidthMm = 210;
  base.innerTrimHeightMm = 297;
  base.bleedMm = 3;
  base.sizeToleranceMm = 1; // 워커 LEGACY_SIZE_TOLERANCE_MM 정합값(노출용)
  base.pageMin = 32;
  base.pageMax = 400;
  base.pageIncrement = 2;
  base.spineFormula = null;
  base.defaultPaperCode = 'mojo_80g';
  base.templateSetId = null;
  base.pricing = null;
  base.isActive = true;
  base.sortOrder = 10;
  return Object.assign(base, overrides);
};

describe('BookSpecs (Partner API v1 Stage 1-B)', () => {
  let service: BookSpecsService;
  let controller: BookSpecsController;
  let bookSpecRepo: jest.Mocked<Pick<Repository<BookSpec>, 'findOne' | 'findAndCount'>>;
  let templateSetRepo: jest.Mocked<Pick<Repository<TemplateSet>, 'findOne'>>;

  const site: CurrentSitePayload = {
    siteId: SITE_A,
    siteName: 'Site A',
    role: 'editor',
    apiKey: 'sk-test',
    retentionDays: null,
  };

  beforeEach(async () => {
    bookSpecRepo = { findOne: jest.fn(), findAndCount: jest.fn() };
    templateSetRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookSpecsController],
      providers: [
        BookSpecsService,
        // 책등 수치 대조를 위해 SpineService 는 실물 사용(용지/제본 repo 만 모킹)
        SpineService,
        { provide: getRepositoryToken(BookSpec), useValue: bookSpecRepo },
        { provide: getRepositoryToken(TemplateSet), useValue: templateSetRepo },
        {
          provide: getRepositoryToken(PaperTypeEntity),
          useValue: {
            findOne: jest.fn(async ({ where }: { where: { code: string } }) =>
              (PAPER_FIXTURES.find((p) => p.code === where.code) as PaperTypeEntity) ?? null,
            ),
          },
        },
        {
          provide: getRepositoryToken(BindingTypeEntity),
          useValue: {
            findOne: jest.fn(async ({ where }: { where: { code: string } }) =>
              (BINDING_FIXTURES.find((b) => b.code === where.code) as BindingTypeEntity) ?? null,
            ),
          },
        },
      ],
    })
      // v1 스택 enhancer 들은 DB/설정 의존 — 유닛에서는 통과 스텁으로 대체.
      // 스택 "존재" 계약은 아래 리플렉션 단언이 별도로 고정하고,
      // 실 HTTP 관통은 book-specs.v1.http.spec.ts(supertest)가 검증한다.
      .overrideGuard(PartnerApiKeyGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PartnerRateLimitGuard)
      .useValue({ canActivate: () => true })
      .overrideFilter(PartnerApiExceptionFilter)
      .useValue({ catch: () => undefined })
      .overrideInterceptor(PartnerAuditInterceptor)
      .useValue({ intercept: (_c: ExecutionContext, n: CallHandler) => n.handle() })
      .overrideInterceptor(PartnerIdempotencyInterceptor)
      .useValue({ intercept: (_c: ExecutionContext, n: CallHandler) => n.handle() })
      .overrideInterceptor(PartnerEnvelopeInterceptor)
      .useValue({ intercept: (_c: ExecutionContext, n: CallHandler) => n.handle() })
      .compile();

    service = module.get(BookSpecsService);
    controller = module.get(BookSpecsController);
  });

  // ── 1. 인증 시맨틱 (guarded-routes.spec 규약 준용) ───────────────────
  describe('인증/라우트 계약', () => {
    it('컨트롤러 prefix 는 v1/book-specs (글로벌 prefix api → /api/v1/book-specs)', () => {
      expect(Reflect.getMetadata(PATH_METADATA, BookSpecsController)).toBe('v1/book-specs');
    });

    it('@PartnerV1Controller 스택 — @Public + PartnerApiKeyGuard→RateLimit + 필터/인터셉터 (무인증 라우트 0)', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, BookSpecsController)).toBe(true);
      // 가드 순서 계약: 인증(req.user 세팅) → per-Key 리밋(req.user 필요)
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, BookSpecsController) ?? [];
      expect(guards).toEqual([PartnerApiKeyGuard, PartnerRateLimitGuard]);
      // 에러 봉투 필터 + 감사→멱등→봉투 인터셉터 스택(순서 의미 있음)
      const filters: unknown[] =
        Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, BookSpecsController) ?? [];
      expect(filters).toContain(PartnerApiExceptionFilter);
      const interceptors: unknown[] =
        Reflect.getMetadata(INTERCEPTORS_METADATA, BookSpecsController) ?? [];
      expect(interceptors).toEqual([
        PartnerAuditInterceptor,
        PartnerIdempotencyInterceptor,
        PartnerEnvelopeInterceptor,
      ]);
    });

    it('GET 3종 라우트 경로/메서드 고정', () => {
      const proto = BookSpecsController.prototype as unknown as Record<string, unknown>;
      const routes: Array<[string, string]> = [
        ['list', ''],
        ['findOne', ':uid'],
        ['calculatedSize', ':uid/calculated-size'],
      ];
      for (const [handler, path] of routes) {
        const fn = proto[handler] as object;
        expect(Reflect.getMetadata(PATH_METADATA, fn) ?? '').toBe(path === '' ? '/' : path);
        expect(Reflect.getMetadata(METHOD_METADATA, fn)).toBe(RequestMethod.GET);
      }
    });
  });

  // ── 2. 봉투/목록/404 ─────────────────────────────────────────────────
  describe('목록/단건', () => {
    it('목록 = PaginatedResult → 봉투 4필드 + pagination {total,limit,offset,hasNext} (§5.1 산식 offset+limit<total)', async () => {
      bookSpecRepo.findAndCount.mockResolvedValue([[makeSpec()], 60]);

      const result = await controller.list(site, {
        limit: 20,
        offset: 20,
      } as BookSpecListQueryDto);
      const res = await throughEnvelope(result);

      expect(Object.keys(res).sort()).toEqual(['data', 'message', 'pagination', 'success']);
      expect(res.success).toBe(true);
      expect(res.message).toBe('Success');
      expect(res.pagination).toEqual({ total: 60, limit: 20, offset: 20, hasNext: true });
      // 외부 노출 shape — 내부 UUID/siteId 비노출
      const items = res.data as Array<Record<string, unknown>>;
      expect(items[0]).not.toHaveProperty('id');
      expect(items[0]).not.toHaveProperty('siteId');
      expect(items[0].uid).toBe('bs_a4perfect01');
    });

    it('마지막 페이지 — hasNext=false (offset+limit>=total)', async () => {
      bookSpecRepo.findAndCount.mockResolvedValue([[makeSpec()], 37]);

      const res = await throughEnvelope(
        await controller.list(site, { limit: 20, offset: 20 } as BookSpecListQueryDto),
      );
      expect(res.pagination).toEqual({ total: 37, limit: 20, offset: 20, hasNext: false });
    });

    it('limit 은 최대 100 으로 캡, 기본 20/offset 0 (설계서 §5.1)', async () => {
      bookSpecRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.list(SITE_A, { limit: 500 } as BookSpecListQueryDto);
      expect(bookSpecRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 100, skip: 0 }),
      );

      await service.list(SITE_A, {} as BookSpecListQueryDto);
      expect(bookSpecRepo.findAndCount).toHaveBeenLastCalledWith(
        expect.objectContaining({ take: 20, skip: 0 }),
      );
    });

    it('테넌트 스코프 — 전역(NULL) OR 자기 site 의 OR where 로 조회', async () => {
      bookSpecRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.list(SITE_A, {} as BookSpecListQueryDto);

      const arg = bookSpecRepo.findAndCount.mock.calls[0][0] as { where: unknown[] };
      expect(Array.isArray(arg.where)).toBe(true);
      expect(arg.where).toHaveLength(2);
      expect(arg.where[1]).toMatchObject({ siteId: SITE_A });
    });

    it('단건 pagination 은 null, 미존재 uid 는 404 ERR_BOOK_SPEC_NOT_FOUND', async () => {
      bookSpecRepo.findOne.mockResolvedValue(makeSpec());
      const view = await controller.findOne(site, 'bs_a4perfect01');
      expect(view.uid).toBe('bs_a4perfect01');
      const ok = await throughEnvelope(view);
      expect(ok.pagination).toBeNull();
      expect((ok.data as { uid: string }).uid).toBe('bs_a4perfect01');

      bookSpecRepo.findOne.mockResolvedValue(null);
      const err = await captureRejection(() => controller.findOne(site, 'bs_missing'));
      expect(err).toBeInstanceOf(PartnerApiException);
      expect((err as PartnerApiException).getStatus()).toBe(404);
      expect((err as PartnerApiException).errorCode).toBe('ERR_BOOK_SPEC_NOT_FOUND');
    });

    it('비활성/타 사이트 판형은 조회 조건에서 배제된다 (활성+전역/자기site where)', async () => {
      bookSpecRepo.findOne.mockResolvedValue(null);
      await expect(service.findByUid(SITE_A, 'bs_x')).rejects.toBeInstanceOf(PartnerApiException);

      const arg = bookSpecRepo.findOne.mock.calls[0][0] as {
        where: Array<Record<string, unknown>>;
      };
      expect(arg.where[0]).toMatchObject({ uid: 'bs_x', isActive: true });
      expect(arg.where[1]).toMatchObject({ uid: 'bs_x', isActive: true, siteId: SITE_A });
      // SITE_B 판형이 SITE_A where 로 매칭될 수 없음(존재 은닉 404) —
      // where 절 자체에 SITE_B 가 등장하지 않는 것으로 단언
      expect(JSON.stringify(arg.where)).not.toContain(SITE_B);
    });
  });

  // ── 3. calculated-size 수치 대조 (SpineService 실물 재사용) ──────────
  describe('calculated-size', () => {
    it('A4 무선(210×297, mojo_80g 0.10, perfect +0.5), 100p — 책등 5.5 / 내지 216×303 / 표지 425.5→431.5', async () => {
      bookSpecRepo.findOne.mockResolvedValue(makeSpec());

      const res = await service.calculateSize(SITE_A, 'bs_a4perfect01', 100);

      // 책등: (100/2)×0.10 + 0.5 = 5.5mm — SpineService 공식과 동일
      expect(res.spine).not.toBeNull();
      expect(res.spine?.widthMm).toBe(5.5);
      expect(res.spine?.paperThicknessMm).toBe(0.1);
      expect(res.spine?.bindingMarginMm).toBe(0.5);
      // 내지: 재단 210×297, 작업 = 재단 + 2×3
      expect(res.inner).toEqual({
        trimWidthMm: 210,
        trimHeightMm: 297,
        workWidthMm: 216,
        workHeightMm: 303,
      });
      // 표지 펼침면: 2×210 + 5.5 = 425.5, 작업 431.5×303
      expect(res.cover).toEqual({
        trimWidthMm: 425.5,
        trimHeightMm: 297,
        workWidthMm: 431.5,
        workHeightMm: 303,
      });
      // 톨러런스 = 워커 LEGACY_SIZE_TOLERANCE_MM(1mm) 정합값
      expect(res.sizeToleranceMm).toBe(1);
      expect(res.bleedMm).toBe(3);
      expect(res.pageCount).toBe(100);
    });

    it('A5 중철(148×210, mojo_70g 0.09, saddle +0.3), 48p — 책등 2.46 / 표지 298.46', async () => {
      bookSpecRepo.findOne.mockResolvedValue(
        makeSpec({
          uid: 'bs_a5saddle01',
          name: 'A5 중철',
          bindingType: 'saddle',
          innerTrimWidthMm: 148,
          innerTrimHeightMm: 210,
          pageMin: 8,
          pageMax: 64,
          pageIncrement: 4,
          defaultPaperCode: 'mojo_70g',
        }),
      );

      const res = await service.calculateSize(SITE_A, 'bs_a5saddle01', 48);

      // (48/2)×0.09 + 0.3 = 2.46mm
      expect(res.spine?.widthMm).toBe(2.46);
      expect(res.cover?.trimWidthMm).toBe(298.46); // 2×148 + 2.46
      expect(res.cover?.workWidthMm).toBe(304.46);
      expect(res.inner.workWidthMm).toBe(154);
    });

    it('spineFormula 커스텀 계수가 DB 계수보다 우선한다 (SpineService 규약 승계)', async () => {
      bookSpecRepo.findOne.mockResolvedValue(
        makeSpec({
          spineFormula: {
            paperCode: 'mojo_80g',
            bindingCode: 'perfect',
            customPaperThickness: 0.2,
            customBindingMargin: 1,
          },
        }),
      );

      const res = await service.calculateSize(SITE_A, 'bs_a4perfect01', 100);
      // (100/2)×0.2 + 1 = 11mm
      expect(res.spine?.widthMm).toBe(11);
    });

    it('하드커버 판형은 wrap 미포함 경고를 동반한다', async () => {
      bookSpecRepo.findOne.mockResolvedValue(
        makeSpec({ uid: 'bs_hardcover01', coverType: 'hardcover_wrap' }),
      );

      const res = await service.calculateSize(SITE_A, 'bs_hardcover01', 100);
      expect(res.warnings.map((w) => w.code)).toContain('HARDCOVER_WRAP_NOT_INCLUDED');
      expect(res.cover).not.toBeNull();
    });

    it('templateSet 연결 시 size_tolerance_mm 계약값을 우선 노출 (검증측과 동일 우선순위)', async () => {
      bookSpecRepo.findOne.mockResolvedValue(makeSpec({ templateSetId: 'ts-1' }));
      templateSetRepo.findOne.mockResolvedValue({
        id: 'ts-1',
        sizeToleranceMm: 0.2,
      } as TemplateSet);

      const res = await service.calculateSize(SITE_A, 'bs_a4perfect01', 100);
      expect(res.sizeToleranceMm).toBe(0.2);
    });

    it('용지 계수 미구성 시 실패 대신 spine/cover null + SPINE_PARAMS_MISSING 경고', async () => {
      bookSpecRepo.findOne.mockResolvedValue(
        makeSpec({ defaultPaperCode: null, spineFormula: null }),
      );

      const res = await service.calculateSize(SITE_A, 'bs_a4perfect01', 100);
      expect(res.spine).toBeNull();
      expect(res.cover).toBeNull();
      expect(res.warnings.map((w) => w.code)).toContain('SPINE_PARAMS_MISSING');
    });
  });

  // ── 4. pageCount 경계 — 422 표준 에러 (설계서 §3.3 카탈로그 정본) ────
  describe('pageCount 경계', () => {
    const expect422OutOfRange = async (pageCount: number, expectedErrorCode?: string) => {
      bookSpecRepo.findOne.mockResolvedValue(makeSpec()); // pageMin 32 / max 400 / +2
      const err = await captureRejection(() =>
        service.calculateSize(SITE_A, 'bs_a4perfect01', pageCount),
      );
      expect(err).toBeInstanceOf(PartnerApiException);
      const exception = err as PartnerApiException;
      expect(exception.getStatus()).toBe(422);
      expect(exception.errorCode).toBe('ERR_PAGE_COUNT_OUT_OF_RANGE');
      if (expectedErrorCode) {
        expect(exception.errorItems.map((e) => e.code)).toContain(expectedErrorCode);
      }
    };

    it('pageMin 미만 = 422 ERR_PAGE_COUNT_OUT_OF_RANGE', async () => {
      await expect422OutOfRange(30, 'PAGE_COUNT_RANGE');
    });

    it('pageMax 초과 = 422 ERR_PAGE_COUNT_OUT_OF_RANGE', async () => {
      await expect422OutOfRange(402, 'PAGE_COUNT_RANGE');
    });

    it('pageIncrement 위반 = 422 + errors[].code PAGE_COUNT_INCREMENT 세분', async () => {
      await expect422OutOfRange(33, 'PAGE_COUNT_INCREMENT');
    });

    it('비정수/0/음수/누락 pageCount 는 DTO 검증 400 (전역 ValidationPipe 동일 옵션)', async () => {
      const pipe = new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      });
      const metadata = { type: 'query' as const, metatype: CalculatedSizeQueryDto };

      for (const bad of [{ pageCount: '12.5' }, { pageCount: '-3' }, { pageCount: '0' }, {}]) {
        await expect(pipe.transform(bad, metadata)).rejects.toBeInstanceOf(BadRequestException);
      }
      // 정상값은 통과 + number 변환
      const ok = (await pipe.transform({ pageCount: '100' }, metadata)) as CalculatedSizeQueryDto;
      expect(ok.pageCount).toBe(100);
    });
  });

  // ── 5. 수집 스크립트 정규화 코어 (dry-run 산출 규칙) ─────────────────
  describe('collect-book-specs 정규화 코어', () => {
    const makeTsRow = (overrides: Partial<TemplateSetRow> = {}): TemplateSetRow => ({
      id: 'ts-1',
      name: 'A4 책자',
      type: 'book',
      width: 210,
      height: 297,
      bleed_mm: 3,
      size_tolerance_mm: 0.2,
      page_count_range: JSON.stringify([16, 24, 32, 40]),
      cover_type: 'softcover_variable_spine',
      product_specs: JSON.stringify({
        size: { width: 210, height: 297, unit: 'mm' },
        binding: 'perfect',
      }),
      site_id: null,
      is_active: 1,
      ...overrides,
    });
    const bindingRows = [
      { code: 'perfect', min_pages: 32, max_pages: null, page_multiple: null },
      { code: 'saddle', min_pages: null, max_pages: 64, page_multiple: 4 },
    ];
    const paperRows = [
      { code: 'mojo_70g', category: 'body', is_active: 1 as const, sort_order: 1 },
      { code: 'art_200g', category: 'cover', is_active: 1 as const, sort_order: 10 },
    ];

    it('정상 행은 후보로 정규화 — pageCountRange 도출·templateSet 톨러런스 승계·body 용지 기본', () => {
      const { candidates, anomalies, excluded } = collectBookSpecCandidates(
        [makeTsRow()],
        bindingRows,
        paperRows,
      );

      expect(excluded).toBe(0);
      expect(anomalies).toHaveLength(0);
      expect(candidates).toHaveLength(1);
      const c = candidates[0];
      expect(c.uid).toMatch(/^bs_[0-9a-f]{12}$/);
      expect(c).toMatchObject({
        innerTrimWidthMm: 210,
        innerTrimHeightMm: 297,
        orientation: 'portrait',
        bindingType: 'perfect',
        pageMin: 16,
        pageMax: 40,
        pageIncrement: 8,
        sizeToleranceMm: 0.2,
        defaultPaperCode: 'mojo_70g',
        templateSetId: 'ts-1',
      });
    });

    it('이상치 검출 — 치수 붕괴는 제외, specs 불일치·미지 제본은 플래그, binding none 제외', () => {
      const rows = [
        makeTsRow({ id: 'ts-bad', name: '치수붕괴', width: 0 }),
        makeTsRow({
          id: 'ts-mismatch',
          name: '불일치',
          product_specs: JSON.stringify({ size: { width: 200, height: 300 }, binding: 'ring' }),
        }),
        makeTsRow({
          id: 'ts-leaflet',
          name: '리플렛',
          product_specs: JSON.stringify({ binding: 'none' }),
        }),
      ];
      const { candidates, anomalies, excluded } = collectBookSpecCandidates(
        rows,
        bindingRows,
        paperRows,
      );

      expect(excluded).toBe(2); // 치수붕괴 + binding none
      expect(anomalies.map((a) => a.code).sort()).toEqual([
        'INVALID_TRIM',
        'SPECS_SIZE_MISMATCH',
        'UNKNOWN_BINDING_CODE',
      ]);
      expect(candidates).toHaveLength(1);
      expect(candidates[0].reviewFlags).toEqual(
        expect.arrayContaining(['SPECS_SIZE_MISMATCH', 'UNKNOWN_BINDING_CODE']),
      );
    });

    it('동일 (이름·치수·커버·제본·site) 중복은 1행 병합 + 출처 나열, 가로형 orientation 판별', () => {
      const rows = [
        makeTsRow({ id: 'ts-a' }),
        makeTsRow({ id: 'ts-b' }), // 동일 스펙 중복
        makeTsRow({ id: 'ts-land', name: '가로형', width: 297, height: 210 }),
      ];
      const { candidates } = collectBookSpecCandidates(rows, bindingRows, paperRows);

      expect(candidates).toHaveLength(2);
      expect(candidates[0].sources).toEqual(['ts-a', 'ts-b']);
      expect(candidates[1].orientation).toBe('landscape');
    });

    it('pageCountRange 없으면 binding_types 폴백 + 플래그, SQL 초안은 멱등 INSERT', () => {
      const { candidates } = collectBookSpecCandidates(
        [
          makeTsRow({
            page_count_range: '[]',
            product_specs: JSON.stringify({ binding: 'saddle' }),
          }),
        ],
        bindingRows,
        paperRows,
      );

      const c = candidates[0];
      expect(c.reviewFlags).toContain('PAGE_RULES_FROM_BINDING_FALLBACK');
      expect(c).toMatchObject({ pageMin: 2, pageMax: 64, pageIncrement: 4 });

      const sql = toInsertSql(c);
      expect(sql).toContain('INSERT INTO book_specs');
      expect(sql).toContain('ON DUPLICATE KEY UPDATE uid = uid');
      expect(sql).not.toMatch(/DELETE|UPDATE book_specs|TRUNCATE/);
    });

    it('derivePageRules — 최빈 간격 도출, 단일 값, 빈 배열 null', () => {
      expect(derivePageRules([10, 20, 30, 40])).toEqual({ min: 10, max: 40, increment: 10 });
      expect(derivePageRules([24])).toEqual({ min: 24, max: 24, increment: 2 });
      expect(derivePageRules([])).toBeNull();
    });
  });
});
