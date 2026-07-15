import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Repository } from 'typeorm';
import { BookSpec } from './entities/book-spec.entity';
import { TemplateSet } from '../templates/entities/template-set.entity';
import { SpineService } from '../products/spine.service';
import {
  BookSpecListQueryDto,
  BookSpecView,
  CalculatedSizeView,
  V1Pagination,
  V1_PAGINATION_DEFAULT_LIMIT,
  V1_PAGINATION_MAX_LIMIT,
} from './dto/book-spec.dto';

/**
 * Partner API v1 — BookSpecs (판형 마스터) 읽기 전용 서비스.
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md §1.2
 * - v1 은 읽기 전용 — 검증측(워커) 상수·로직 무접촉.
 * - 책등 계산은 기존 SpineService 재사용 (중복 구현 금지).
 * - 테넌트 스코프: 전역(siteId=null) + 자기 site 판형만 노출.
 *   타 사이트 판형은 존재 은닉을 위해 404 (ERR_NOT_FOUND 원칙, 설계서 §3.3).
 */
@Injectable()
export class BookSpecsService {
  constructor(
    @InjectRepository(BookSpec)
    private readonly bookSpecRepo: Repository<BookSpec>,
    @InjectRepository(TemplateSet)
    private readonly templateSetRepo: Repository<TemplateSet>,
    private readonly spineService: SpineService,
  ) {}

  /** mm 값 반올림(소수 2자리) — SpineService 반올림 규칙과 동일 */
  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private toView(spec: BookSpec): BookSpecView {
    return {
      uid: spec.uid,
      name: spec.name,
      coverType: spec.coverType,
      bindingType: spec.bindingType,
      orientation: spec.orientation,
      innerTrimWidthMm: spec.innerTrimWidthMm,
      innerTrimHeightMm: spec.innerTrimHeightMm,
      bleedMm: spec.bleedMm,
      sizeToleranceMm: spec.sizeToleranceMm,
      pageMin: spec.pageMin,
      pageMax: spec.pageMax,
      pageIncrement: spec.pageIncrement,
      defaultPaperCode: spec.defaultPaperCode,
      isActive: spec.isActive,
    };
  }

  /**
   * 목록 — 필터(coverType/bindingType/isActive) + 페이지네이션(설계서 §5.1).
   * 기본 정렬 sort_order ASC, created_at DESC 보조.
   */
  async list(
    siteId: string,
    query: BookSpecListQueryDto,
  ): Promise<{ items: BookSpecView[]; pagination: V1Pagination }> {
    const limit = Math.min(query.limit ?? V1_PAGINATION_DEFAULT_LIMIT, V1_PAGINATION_MAX_LIMIT);
    const offset = query.offset ?? 0;

    // 외부 대면 기본 = 활성 판형만. isActive 명시 시 해당 값으로 필터.
    const base: FindOptionsWhere<BookSpec> = {
      isActive: query.isActive === undefined ? true : query.isActive === 'true',
    };
    if (query.coverType) base.coverType = query.coverType;
    if (query.bindingType) base.bindingType = query.bindingType;

    // 테넌트 스코프: 전역(siteId NULL) OR 자기 site
    const where: FindOptionsWhere<BookSpec>[] = [
      { ...base, siteId: IsNull() },
      { ...base, siteId },
    ];

    const [rows, total] = await this.bookSpecRepo.findAndCount({
      where,
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });

    return {
      items: rows.map((r) => this.toView(r)),
      pagination: { total, limit, offset, hasNext: offset + rows.length < total },
    };
  }

  /**
   * uid 단건 — 활성 + (전역 또는 자기 site)만.
   * 없음/비활성/타 사이트 = 404 ERR_BOOK_SPEC_NOT_FOUND (존재 은닉).
   */
  async findByUid(siteId: string, uid: string): Promise<BookSpec> {
    const spec = await this.bookSpecRepo.findOne({
      where: [
        { uid, isActive: true, siteId: IsNull() },
        { uid, isActive: true, siteId },
      ],
    });

    if (!spec) {
      // 트랙 A v1 예외 필터(에러 봉투 표준화) 병합 전 — 객체 페이로드로
      // errorCode 를 실어 보낸다. 통합 시 필터가 requestId 등을 부착하는
      // 표준 봉투로 치환될 예정 (이중 래핑 방지 포인트).
      throw new NotFoundException({
        success: false,
        errorCode: 'ERR_BOOK_SPEC_NOT_FOUND',
        message: `판형 '${uid}' 을(를) 찾을 수 없습니다`,
      });
    }
    return spec;
  }

  async getDetail(siteId: string, uid: string): Promise<BookSpecView> {
    return this.toView(await this.findByUid(siteId, uid));
  }

  /**
   * calculated-size — 페이지 수 기반 표지/내지/책등 실측 mm 계산.
   *
   * - 페이지 규칙(pageMin/Max/Increment) 위반 = 400 ERR_PAGE_COUNT_OUT_OF_RANGE.
   *   ※ 설계서 §3.3 카탈로그는 422 — 트랙 A 전역 필터 통합 시 status 재검토
   *   포인트(Stage 1-B 작업지시는 400 표준 에러로 고정).
   * - 책등 = 기존 SpineService.calculate() 재사용.
   * - sizeToleranceMm: templateSet 계약값(size_tolerance_mm) 우선, 없으면
   *   spec 값(기본 1 = 워커 LEGACY_SIZE_TOLERANCE_MM 정합 — 검증측 무접촉).
   */
  async calculateSize(
    siteId: string,
    uid: string,
    pageCount: number,
  ): Promise<CalculatedSizeView> {
    const spec = await this.findByUid(siteId, uid);

    this.assertPageRules(spec, pageCount);

    const warnings: Array<{ code: string; message: string }> = [];

    // 톨러런스: templateSet 계약값 우선(검증측과 동일한 우선순위 규칙)
    let sizeToleranceMm = spec.sizeToleranceMm;
    if (spec.templateSetId) {
      const templateSet = await this.templateSetRepo.findOne({
        where: { id: spec.templateSetId },
        select: ['id', 'sizeToleranceMm'],
      });
      if (templateSet && typeof templateSet.sizeToleranceMm === 'number') {
        sizeToleranceMm = templateSet.sizeToleranceMm;
      }
    }

    const bleed2 = spec.bleedMm * 2;
    const inner = {
      trimWidthMm: this.round2(spec.innerTrimWidthMm),
      trimHeightMm: this.round2(spec.innerTrimHeightMm),
      workWidthMm: this.round2(spec.innerTrimWidthMm + bleed2),
      workHeightMm: this.round2(spec.innerTrimHeightMm + bleed2),
    };

    // 책등 — SpineService 재사용. 계수 미구성/불일치 시 실패 대신 null+warning
    // (읽기 전용 마스터 표면이 시드 결함으로 5xx/404 를 내지 않게).
    let spine: CalculatedSizeView['spine'] = null;
    const paperCode = spec.spineFormula?.paperCode ?? spec.defaultPaperCode ?? undefined;
    const bindingCode = spec.spineFormula?.bindingCode ?? spec.bindingType;
    if (!paperCode) {
      warnings.push({
        code: 'SPINE_PARAMS_MISSING',
        message: '용지 계수(defaultPaperCode/spineFormula.paperCode)가 없어 책등을 계산할 수 없습니다',
      });
    } else {
      try {
        const result = await this.spineService.calculate({
          pageCount,
          paperType: paperCode,
          bindingType: bindingCode,
          customPaperThickness: spec.spineFormula?.customPaperThickness,
          customBindingMargin: spec.spineFormula?.customBindingMargin,
        });
        spine = {
          widthMm: result.spineWidth,
          paperThicknessMm: result.paperThickness,
          bindingMarginMm: result.bindingMargin,
          formula: result.formula,
        };
        warnings.push(...result.warnings);
      } catch (err) {
        if (err instanceof NotFoundException) {
          warnings.push({
            code: 'SPINE_PARAMS_INVALID',
            message: `책등 계수 조회 실패 — 용지/제본 코드(${paperCode}/${bindingCode})를 확인하세요`,
          });
        } else {
          throw err;
        }
      }
    }

    // 표지 = 펼침면(뒤표지 + 책등 + 앞표지). 하드커버 wrap(싸바리) 여분은
    // v1 calculated-size 범위 밖(templateSet coverConfig.caseBind 참조).
    let cover: CalculatedSizeView['cover'] = null;
    if (spine) {
      const coverTrimW = this.round2(spec.innerTrimWidthMm * 2 + spine.widthMm);
      cover = {
        trimWidthMm: coverTrimW,
        trimHeightMm: this.round2(spec.innerTrimHeightMm),
        workWidthMm: this.round2(coverTrimW + bleed2),
        workHeightMm: this.round2(spec.innerTrimHeightMm + bleed2),
      };
      if (spec.coverType.toLowerCase().includes('hardcover')) {
        warnings.push({
          code: 'HARDCOVER_WRAP_NOT_INCLUDED',
          message: '하드커버 싸바리(wrap) 여분은 포함되지 않은 값입니다 — 표지 아트워크는 templateSet coverConfig 를 따르세요',
        });
      }
    }

    return {
      bookSpecUid: spec.uid,
      pageCount,
      sizeToleranceMm,
      bleedMm: this.round2(spec.bleedMm),
      inner,
      spine,
      cover,
      warnings,
    };
  }

  /** 페이지 규칙 검증 — 위반 시 400 ERR_PAGE_COUNT_OUT_OF_RANGE */
  private assertPageRules(spec: BookSpec, pageCount: number): void {
    const errors: Array<{ code: string; message: string }> = [];

    if (pageCount < spec.pageMin || pageCount > spec.pageMax) {
      errors.push({
        code: 'PAGE_COUNT_RANGE',
        message: `pageCount 는 ${spec.pageMin}~${spec.pageMax} 범위여야 합니다`,
      });
    }
    if (spec.pageIncrement > 0 && pageCount % spec.pageIncrement !== 0) {
      errors.push({
        code: 'PAGE_COUNT_INCREMENT',
        message: `pageCount 는 ${spec.pageIncrement} 의 배수여야 합니다`,
      });
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        success: false,
        errorCode: 'ERR_PAGE_COUNT_OUT_OF_RANGE',
        message: '페이지 수가 판형 규칙을 벗어났습니다',
        errors,
      });
    }
  }
}
