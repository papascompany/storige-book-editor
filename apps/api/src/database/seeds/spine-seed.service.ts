import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HARDCOVER_SPINE_PAPERS,
  PERFECT_SPINE_PAPERS,
} from '@storige/types';
import { PaperTypeEntity } from '../../products/entities/paper-type.entity';
import { BindingTypeEntity } from '../../products/entities/binding-type.entity';

@Injectable()
export class SpineSeedService implements OnModuleInit {
  private readonly logger = new Logger(SpineSeedService.name);

  constructor(
    @InjectRepository(PaperTypeEntity)
    private readonly paperTypeRepo: Repository<PaperTypeEntity>,
    @InjectRepository(BindingTypeEntity)
    private readonly bindingTypeRepo: Repository<BindingTypeEntity>,
  ) {}

  async onModuleInit() {
    // F16: 시드 실패(예: v2 마이그레이션 미적용 상태 재배포 — 신규 컬럼 SELECT 1054)가
    // Nest 부트 전체를 크래시시키지 않게 격리(CFG-001 'throw 금지' 관례). 실패 시
    // spine v2 경로만 국소 열화되고 전 API 다운은 방지 — 액션 메시지로 관측.
    try {
      await this.seedPaperTypes();
      await this.seedBindingTypes();
    } catch (error) {
      this.logger.error(
        'Spine 시드 실패 — paper_types v2 컬럼 부재 가능성: ' +
          'migrations/20260721_add_paper_type_spine_v2.sql 선행 실행 후 재시작 필요. ' +
          `원본 오류: ${(error as Error).message}`,
      );
    }
  }

  private async seedPaperTypes() {
    const paperTypes = [
      // 본문용 (body)
      { code: 'mojo_70g', name: '모조지 70g', thickness: 0.09, category: 'body', sortOrder: 1 },
      { code: 'mojo_80g', name: '모조지 80g', thickness: 0.10, category: 'body', sortOrder: 2 },
      { code: 'seokji_70g', name: '서적지 70g', thickness: 0.10, category: 'body', sortOrder: 3 },
      { code: 'newsprint_45g', name: '신문지 45g', thickness: 0.06, category: 'body', sortOrder: 4 },
      // 표지용 (cover)
      { code: 'art_200g', name: '아트지 200g', thickness: 0.18, category: 'cover', sortOrder: 10 },
      { code: 'matte_200g', name: '매트지 200g', thickness: 0.20, category: 'cover', sortOrder: 11 },
      { code: 'card_300g', name: '카드지 300g', thickness: 0.35, category: 'cover', sortOrder: 12 },
      { code: 'kraft_120g', name: '크라프트지 120g', thickness: 0.16, category: 'cover', sortOrder: 13 },
    ];

    for (const data of paperTypes) {
      const existing = await this.paperTypeRepo.findOne({
        where: { code: data.code },
      });

      if (!existing) {
        const entity = this.paperTypeRepo.create(data);
        await this.paperTypeRepo.save(entity);
        this.logger.log(`Paper type created: ${data.name} (${data.code})`);
      }
    }

    await this.seedSpineV2Papers();

    this.logger.log('Paper types seed completed');
  }

  /**
   * R-44 v2 지종 시드 — bookmoa SSOT 두께표(무선 29 + 양장 35)를 code=정규 라벨로 편입.
   *
   * - 단위: 무선 thicknessPerPageMm(mm/페이지) / 양장 thicknessPerSheetMm(mm/장).
   * - legacy `thickness`(mm/장, NOT NULL)는 무선 = perPage×2 환산, 양장 = perSheet 그대로 —
   *   v1 소비자(목록 API 등)가 NULL 을 만나지 않게 하는 호환값.
   * - insert-only 멱등(기존 관례) + v2 컬럼이 NULL 인 기존 행은 additive 백필
   *   (운영자가 값을 넣은 행은 덮어쓰지 않음 — NULL 일 때만).
   * - 같은 지종이 양쪽 표에 있으면(라벨이 달라 충돌 없음) 각각 별도 행 —
   *   해석은 binding 스코프(perfect→perPage 보유 행 / hardcover→perSheet 보유 행)로 격리.
   */
  private async seedSpineV2Papers() {
    const rows = [
      ...PERFECT_SPINE_PAPERS.map((p, i) => ({
        code: p.label,
        name: p.label,
        thickness: Math.round(p.t * 2 * 1000) / 1000,
        thicknessPerPageMm: p.t,
        thicknessPerSheetMm: null as number | null,
        aliases: p.aliases ?? null,
        category: 'body',
        sortOrder: 100 + i,
      })),
      ...HARDCOVER_SPINE_PAPERS.map((p, i) => ({
        code: p.label,
        name: p.label,
        thickness: p.t,
        thicknessPerPageMm: null as number | null,
        thicknessPerSheetMm: p.t,
        aliases: p.aliases ?? null,
        category: 'body',
        sortOrder: 200 + i,
      })),
    ];

    let created = 0;
    let backfilled = 0;
    for (const data of rows) {
      const existing = await this.paperTypeRepo.findOne({ where: { code: data.code } });
      if (!existing) {
        await this.paperTypeRepo.save(this.paperTypeRepo.create(data));
        created += 1;
        continue;
      }
      // v2 컬럼 NULL 백필만 — 운영자 수정값 보존(ensureFormatSeeds 관례 동일)
      const patch: Partial<PaperTypeEntity> = {};
      if (existing.thicknessPerPageMm == null && data.thicknessPerPageMm != null) {
        patch.thicknessPerPageMm = data.thicknessPerPageMm;
      }
      if (existing.thicknessPerSheetMm == null && data.thicknessPerSheetMm != null) {
        patch.thicknessPerSheetMm = data.thicknessPerSheetMm;
      }
      if (existing.aliases == null && data.aliases != null) {
        patch.aliases = data.aliases;
      }
      if (Object.keys(patch).length > 0) {
        await this.paperTypeRepo.update({ id: existing.id }, patch);
        backfilled += 1;
      }
    }
    if (created || backfilled) {
      this.logger.log(`Spine v2 papers seeded: created=${created}, backfilled=${backfilled}`);
    }
  }

  private async seedBindingTypes() {
    const bindingTypes: Array<{
      code: string;
      name: string;
      margin: number;
      minPages?: number;
      maxPages?: number;
      pageMultiple?: number;
      sortOrder: number;
    }> = [
      {
        code: 'perfect',
        name: '무선제본',
        margin: 0.5,
        minPages: 32,
        sortOrder: 1,
      },
      {
        code: 'saddle',
        name: '중철제본',
        margin: 0.3,
        maxPages: 64,
        pageMultiple: 4,
        sortOrder: 2,
      },
      {
        code: 'spiral',
        name: '스프링제본',
        margin: 3.0,
        sortOrder: 3,
      },
      {
        code: 'hardcover',
        name: '양장제본',
        margin: 2.0,
        sortOrder: 4,
      },
    ];

    for (const data of bindingTypes) {
      const existing = await this.bindingTypeRepo.findOne({
        where: { code: data.code },
      });

      if (!existing) {
        const entity = this.bindingTypeRepo.create(data);
        await this.bindingTypeRepo.save(entity);
        this.logger.log(`Binding type created: ${data.name} (${data.code})`);
      }
    }

    this.logger.log('Binding types seed completed');
  }
}
