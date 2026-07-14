import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FormatPreset } from './entities/format-preset.entity';
import {
  CreateFormatPresetDto,
  UpdateFormatPresetDto,
} from './dto/format-preset.dto';

/**
 * 판형 프리셋 서비스 (2026-07-14)
 * - 프리셋은 저작측 정본: templateSet 생성 시 값을 복사 주입한다(presetId 저장 없음).
 * - 하드 삭제 금지(멱등 시드 부활 충돌) — remove 메서드를 제공하지 않는다. isActive 토글만.
 */
@Injectable()
export class FormatPresetsService {
  constructor(
    @InjectRepository(FormatPreset)
    private readonly formatPresetRepo: Repository<FormatPreset>,
  ) {}

  /** 목록 — sort_order ASC. isActive 미지정 시 전체(비활성 포함) 반환 */
  async list(isActive?: boolean): Promise<FormatPreset[]> {
    return this.formatPresetRepo.find({
      where: isActive === undefined ? {} : { isActive },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async findOne(id: string): Promise<FormatPreset> {
    const preset = await this.formatPresetRepo.findOne({ where: { id } });
    if (!preset) {
      throw new NotFoundException(`판형 프리셋을 찾을 수 없습니다: ${id}`);
    }
    return preset;
  }

  async create(dto: CreateFormatPresetDto): Promise<FormatPreset> {
    const existing = await this.formatPresetRepo.findOne({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(`코드 '${dto.code}'가 이미 사용 중입니다.`);
    }
    const preset = this.formatPresetRepo.create(dto);
    return this.formatPresetRepo.save(preset);
  }

  async update(id: string, dto: UpdateFormatPresetDto): Promise<FormatPreset> {
    const preset = await this.findOne(id);

    if (dto.code !== undefined && dto.code !== preset.code) {
      const duplicate = await this.formatPresetRepo.findOne({
        where: { code: dto.code },
      });
      if (duplicate) {
        throw new ConflictException(`코드 '${dto.code}'가 이미 사용 중입니다.`);
      }
    }

    Object.assign(preset, dto);
    return this.formatPresetRepo.save(preset);
  }
}
