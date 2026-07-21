import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HARDCOVER_MANILA_MM,
  calcPerfectSpine,
  hardcoverSpineRaw,
  normalizeSpinePaperLabel,
} from '@storige/types';
import { PaperTypeEntity } from './entities/paper-type.entity';
import { BindingTypeEntity } from './entities/binding-type.entity';
import { CalculateSpineDto } from './dto/spine.dto';

export interface SpineCalculationResult {
  spineWidth: number;
  paperThickness: number;
  bindingMargin: number;
  warnings: Array<{ code: string; message: string }>;
  formula: string;
  /**
   * R-44: 적용 공식 버전.
   * - 'v2' = bookmoa SSOT 정합 공식(무선 홀수보정·무마진 / 양장 ceil+합지4+min8)
   * - 'v1' = legacy 선형식((p/2)×thickness+margin) — v2 두께 미보유 지종(기존 8코드 등)
   */
  formulaVersion: 'v1' | 'v2';
  /** v2 무선: 홀수 +1 보정 후 유효 페이지수 */
  effPages?: number;
  /** v2 양장: 내지뭉치 두께(mm, 올림 정수) */
  pageThickMm?: number;
  /** 해석된 지종 코드(별칭 입력 시 정규 code) */
  resolvedPaperCode?: string;
}

@Injectable()
export class SpineService {
  constructor(
    @InjectRepository(PaperTypeEntity)
    private paperTypeRepo: Repository<PaperTypeEntity>,
    @InjectRepository(BindingTypeEntity)
    private bindingTypeRepo: Repository<BindingTypeEntity>,
  ) {}

  /**
   * 책등 너비 계산.
   *
   * R-44 v2 (2026-07-21): binding 별 공식 분기 — bookmoa SSOT(spine-calc) 자구 정합.
   *  - perfect  : 홀수 +1 보정 → round2(effPages × mm/페이지). margin 무가산.
   *  - hardcover: ceil(toFixed3(p/2 × mm/장)) + 합지 4, 최소 8. 정수 mm. margin 무시.
   *  - saddle/spiral 및 v2 두께 미보유 지종(legacy 8코드): v1 선형식 유지(무회귀).
   * 지종 해석은 code → aliases → 정규화(공백·말미 g 제거) 순 — bookmoa 한글
   * 라벨("미색모조80"·"아르떼(UW)130")이 404 로 무음 실패하던 결함(G-6) 해소.
   */
  async calculate(dto: CalculateSpineDto): Promise<SpineCalculationResult> {
    const bindingType = await this.bindingTypeRepo.findOne({
      where: { code: dto.bindingType },
    });
    if (!bindingType) {
      throw new NotFoundException(`제본 방식 '${dto.bindingType}'을(를) 찾을 수 없습니다.`);
    }

    // binding-aware 해석: 같은 지종명이 무선표/양장표 양쪽 행으로 존재할 수 있어
    // (예: "미색모조80" 양장행 ↔ "미색모조 80g" 무선행) 요청 binding 에 필요한
    // 두께 컬럼 보유 행을 우선한다 — bookmoa perfect+"미색모조80" 가 양장행에
    // 정확일치로 걸려 v1 로 오폴백하는 갭 방지.
    const prefer =
      bindingType.code === 'perfect'
        ? 'perPage'
        : bindingType.code === 'hardcover'
          ? 'perSheet'
          : undefined;
    const paperType = await this.resolvePaperType(dto.paperType, prefer);

    // v2 커스텀 두께 오버라이드(additive) — 지종 행 없이도 v2 공식 강제 가능
    const customPerPage = dto.customThicknessPerPage;
    const customPerSheet = dto.customThicknessPerSheet;

    const warnings: Array<{ code: string; message: string }> = [];
    this.collectBindingWarnings(bindingType, dto.pageCount, warnings);

    // ── v2: perfect ──────────────────────────────────────────────
    const perPage = customPerPage ?? this.toNum(paperType?.thicknessPerPageMm);
    if (bindingType.code === 'perfect' && perPage != null) {
      const r = calcPerfectSpine({ pages: dto.pageCount, pageThicknessMm: perPage });
      if (r.ok) {
        this.warnNarrowSpine(r.spineMm, warnings);
        return {
          spineWidth: r.spineMm,
          paperThickness: perPage,
          bindingMargin: 0,
          warnings,
          formula: `round2(${r.effPages}p(홀수+1보정) × ${perPage}mm/페이지) = ${r.spineMm}mm`,
          formulaVersion: 'v2',
          effPages: r.effPages,
          resolvedPaperCode: paperType?.code,
        };
      }
    }

    // ── v2: hardcover ────────────────────────────────────────────
    const perSheet = customPerSheet ?? this.toNum(paperType?.thicknessPerSheetMm);
    if (bindingType.code === 'hardcover' && perSheet != null) {
      // SSOT 유효성(p≥12·4의배수)은 비차단 경고로 표현(D-3 기본 정책) —
      // 산술 자체는 어떤 p 에도 정의되므로 값은 항상 반환한다.
      if (dto.pageCount % 4 !== 0 || dto.pageCount < 12) {
        warnings.push({
          code: 'HARDCOVER_PAGE_RULE',
          message: '양장은 12페이지 이상, 4의 배수를 권장합니다(원본 계산기 유효 조건).',
        });
      }
      // calcHardcoverSpine 은 유효성 위반 시 ok:false 라 비차단 정책상 산술 코어
      // (hardcoverSpineRaw — toFixed3→ceil·합지·min8 단일 구현)만 공유(드리프트 방지).
      const { pageThickMm, spineMm } = hardcoverSpineRaw(dto.pageCount, perSheet);
      this.warnNarrowSpine(spineMm, warnings);
      return {
        spineWidth: spineMm,
        paperThickness: perSheet,
        bindingMargin: HARDCOVER_MANILA_MM,
        warnings,
        formula: `max(합지4 + ceil(${dto.pageCount}/2 × ${perSheet}mm/장), 최소8) = ${spineMm}mm`,
        formulaVersion: 'v2',
        pageThickMm,
        resolvedPaperCode: paperType?.code,
      };
    }

    // ── v1: legacy 선형식 (saddle/spiral 전체 + v2 두께 미보유 지종) ──
    if (!paperType && dto.customPaperThickness == null) {
      throw new NotFoundException(`종이 타입 '${dto.paperType}'을(를) 찾을 수 없습니다.`);
    }

    const thickness = dto.customPaperThickness ?? this.toNum(paperType?.thickness) ?? 0;
    const margin = dto.customBindingMargin ?? Number(bindingType.margin);

    // 책등 폭 계산 — 음수 방지(무결성: 음수 책등은 펼침면 총폭을 줄여 영역 레이아웃을 붕괴시킴).
    const spineWidth = Math.max(0, (dto.pageCount / 2) * thickness + margin);
    const roundedSpineWidth = Math.round(spineWidth * 100) / 100;

    this.warnNarrowSpine(roundedSpineWidth, warnings);

    return {
      spineWidth: roundedSpineWidth,
      paperThickness: thickness,
      bindingMargin: margin,
      warnings,
      formula: `(${dto.pageCount} / 2) × ${thickness} + ${margin} = ${roundedSpineWidth.toFixed(2)}mm`,
      formulaVersion: 'v1',
      resolvedPaperCode: paperType?.code,
    };
  }

  /**
   * 지종 해석: code 정확 일치 → aliases → 정규화 비교(공백·말미 g 흡수).
   * 미해석 시 null — calculate 는 v1 커스텀 두께도 없으면 404(기존 계약 유지),
   * 잡 주입 경로(worker-jobs)는 비차단(SPINE_PARAMS_UNRESOLVED 로그) 처리.
   */
  async resolvePaperType(
    input: string,
    prefer?: 'perPage' | 'perSheet',
  ): Promise<PaperTypeEntity | null> {
    if (!input) return null;

    // 결정적 정렬(F12): 무선표(sortOrder 100+)·양장표(200+)가 동일 alias('모조70' 등)를
    // 공유할 때 prefer 미지정(saddle/spiral) 경로의 tie-break 를 DB 반환 순서가 아닌
    // sortOrder 로 고정 — 동순위 충돌 시 항상 무선행(legacy thickness=perPage×2 규약) 승자.
    const all = await this.paperTypeRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
    const norm = normalizeSpinePaperLabel(input);

    // 우선순위 사다리: code 정확 → alias 정확 → code 정규화 → alias 정규화
    const ladder: Array<(p: PaperTypeEntity) => boolean> = [
      (p) => p.code === input,
      (p) => p.aliases?.includes(input) ?? false,
      (p) => normalizeSpinePaperLabel(p.code) === norm,
      (p) => p.aliases?.some((a) => normalizeSpinePaperLabel(a) === norm) ?? false,
    ];
    const candidates: PaperTypeEntity[] = [];
    for (const match of ladder) {
      for (const p of all) {
        if (match(p) && !candidates.includes(p)) candidates.push(p);
      }
    }
    if (candidates.length === 0) {
      // isActive=false 라도 code 정확일치는 기존(findOne code) 계약 유지
      return this.paperTypeRepo.findOne({ where: { code: input } });
    }

    // binding 에 필요한 두께 컬럼 보유 행 우선(사다리 순서 내 최선), 없으면 사다리 1순위
    if (prefer) {
      const has = (p: PaperTypeEntity) =>
        prefer === 'perPage' ? p.thicknessPerPageMm != null : p.thicknessPerSheetMm != null;
      const preferred = candidates.find(has);
      if (preferred) return preferred;
    }
    return candidates[0];
  }

  private collectBindingWarnings(
    bindingType: BindingTypeEntity,
    pageCount: number,
    warnings: Array<{ code: string; message: string }>,
  ) {
    if (bindingType.minPages && pageCount < bindingType.minPages) {
      warnings.push({
        code: 'BINDING_PAGE_LIMIT',
        message: `${bindingType.name}은 최소 ${bindingType.minPages}페이지 이상이어야 합니다.`,
      });
    }
    if (bindingType.maxPages && pageCount > bindingType.maxPages) {
      warnings.push({
        code: 'BINDING_PAGE_LIMIT',
        message: `${bindingType.name}은 최대 ${bindingType.maxPages}페이지까지 가능합니다.`,
      });
    }
    if (bindingType.pageMultiple && pageCount % bindingType.pageMultiple !== 0) {
      warnings.push({
        code: 'BINDING_PAGE_MULTIPLE',
        message: `${bindingType.name}은 ${bindingType.pageMultiple}의 배수여야 합니다.`,
      });
    }
  }

  private warnNarrowSpine(spineMm: number, warnings: Array<{ code: string; message: string }>) {
    if (spineMm < 5) {
      warnings.push({
        code: 'SPINE_TOO_NARROW',
        message: '책등 폭이 5mm 미만입니다. 텍스트 배치에 주의하세요.',
      });
    }
  }

  /** decimal 컬럼은 드라이버에 따라 string 하이드레이션 — 숫자 정규화(NULL 보존) */
  private toNum(v: number | string | null | undefined): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * 용지 종류 목록 (DB에서 조회)
   */
  async getPaperTypes() {
    const paperTypes = await this.paperTypeRepo.find({
      where: { isActive: true },
      order: { category: 'ASC', sortOrder: 'ASC', name: 'ASC' },
    });

    return paperTypes.map((pt) => ({
      code: pt.code,
      name: pt.name,
      thickness: Number(pt.thickness),
      category: pt.category,
      // R-44 v2 additive — 소비자(편집기/bookmoa)가 공식 버전 판별 가능
      thicknessPerPageMm: this.toNum(pt.thicknessPerPageMm) ?? undefined,
      thicknessPerSheetMm: this.toNum(pt.thicknessPerSheetMm) ?? undefined,
    }));
  }

  /**
   * 제본 방식 목록 (DB에서 조회)
   */
  async getBindingTypes() {
    const bindingTypes = await this.bindingTypeRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    return bindingTypes.map((bt) => ({
      code: bt.code,
      name: bt.name,
      margin: Number(bt.margin),
      minPages: bt.minPages,
      maxPages: bt.maxPages,
      pageMultiple: bt.pageMultiple,
    }));
  }
}
