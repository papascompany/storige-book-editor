import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FormatPreset } from '../../templates/entities/format-preset.entity';

/**
 * 판형 프리셋 시드 (2026-07-14) — spine-seed.service.ts 패턴 미러.
 *
 * - 멱등: code 로 findOne → 부재 시에만 insert. 운영자가 수정한 기존 행은 보존(덮어쓰기 금지).
 * - 세로형 기준 1행 저장(W ≤ H, 정사각 제외). 방향 토글은 UI 에서 W↔H 스왑.
 * - 이 시드가 존재하므로 하드 삭제는 부활 충돌 — is_active 소프트 토글만 허용.
 * - prod(synchronize=false)는 apps/api/migrations/20260714_add_format_presets.sql 선행 필수.
 */
export const FORMAT_PRESET_SEEDS: ReadonlyArray<{
  code: string;
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  sortOrder: number;
}> = [
  { code: 'a4', name: 'A4', trimWidthMm: 210, trimHeightMm: 297, bleedMm: 3, sortOrder: 10 },
  { code: 'a5', name: 'A5', trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3, sortOrder: 20 },
  { code: 'b5', name: 'B5', trimWidthMm: 182, trimHeightMm: 257, bleedMm: 3, sortOrder: 30 },
  { code: 'baepan46', name: '46배판', trimWidthMm: 188, trimHeightMm: 257, bleedMm: 3, sortOrder: 40 },
  { code: 'jeol16', name: '16절', trimWidthMm: 190, trimHeightMm: 260, bleedMm: 3, sortOrder: 50 },
  { code: 'b6', name: 'B6', trimWidthMm: 128, trimHeightMm: 182, bleedMm: 3, sortOrder: 60 },
  { code: 'square210', name: '정사각', trimWidthMm: 210, trimHeightMm: 210, bleedMm: 3, sortOrder: 70 },
];

@Injectable()
export class FormatPresetSeedService implements OnModuleInit {
  private readonly logger = new Logger(FormatPresetSeedService.name);

  constructor(
    @InjectRepository(FormatPreset)
    private readonly formatPresetRepo: Repository<FormatPreset>,
  ) {}

  async onModuleInit() {
    await this.seedFormatPresets();
  }

  private async seedFormatPresets() {
    for (const data of FORMAT_PRESET_SEEDS) {
      const existing = await this.formatPresetRepo.findOne({
        where: { code: data.code },
      });

      if (!existing) {
        const entity = this.formatPresetRepo.create(data);
        await this.formatPresetRepo.save(entity);
        this.logger.log(`Format preset created: ${data.name} (${data.code})`);
      }
    }

    this.logger.log('Format presets seed completed');
  }
}
