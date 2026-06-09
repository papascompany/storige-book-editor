import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaperTypeEntity } from './entities/paper-type.entity';
import { BindingTypeEntity } from './entities/binding-type.entity';
import { CalculateSpineDto } from './dto/spine.dto';

export interface SpineCalculationResult {
  spineWidth: number;
  paperThickness: number;
  bindingMargin: number;
  warnings: Array<{ code: string; message: string }>;
  formula: string;
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
   * 책등 너비 계산 (DB에서 종이 두께/제본 여유분 조회)
   */
  async calculate(dto: CalculateSpineDto): Promise<SpineCalculationResult> {
    // DB에서 종이 타입과 제본 방식 조회
    const paperType = await this.paperTypeRepo.findOne({
      where: { code: dto.paperType },
    });
    const bindingType = await this.bindingTypeRepo.findOne({
      where: { code: dto.bindingType },
    });

    if (!paperType) {
      throw new NotFoundException(`종이 타입 '${dto.paperType}'을(를) 찾을 수 없습니다.`);
    }
    if (!bindingType) {
      throw new NotFoundException(`제본 방식 '${dto.bindingType}'을(를) 찾을 수 없습니다.`);
    }

    // 커스텀 값이 있으면 우선 사용, 없으면 DB 값 사용
    const thickness = dto.customPaperThickness ?? Number(paperType.thickness);
    const margin = dto.customBindingMargin ?? Number(bindingType.margin);

    // 책등 폭 계산 — 음수 방지(무결성: 음수 책등은 펼침면 총폭을 줄여 영역 레이아웃을 붕괴시킴).
    const spineWidth = Math.max(0, (dto.pageCount / 2) * thickness + margin);
    const roundedSpineWidth = Math.round(spineWidth * 100) / 100;

    // 경고 메시지 생성
    const warnings: Array<{ code: string; message: string }> = [];

    // 제본 방식별 제약 검증
    if (bindingType.minPages && dto.pageCount < bindingType.minPages) {
      warnings.push({
        code: 'BINDING_PAGE_LIMIT',
        message: `${bindingType.name}은 최소 ${bindingType.minPages}페이지 이상이어야 합니다.`,
      });
    }
    if (bindingType.maxPages && dto.pageCount > bindingType.maxPages) {
      warnings.push({
        code: 'BINDING_PAGE_LIMIT',
        message: `${bindingType.name}은 최대 ${bindingType.maxPages}페이지까지 가능합니다.`,
      });
    }
    if (bindingType.pageMultiple && dto.pageCount % bindingType.pageMultiple !== 0) {
      warnings.push({
        code: 'BINDING_PAGE_MULTIPLE',
        message: `${bindingType.name}은 ${bindingType.pageMultiple}의 배수여야 합니다.`,
      });
    }

    // 책등 폭이 5mm 미만일 경우 경고
    if (roundedSpineWidth < 5) {
      warnings.push({
        code: 'SPINE_TOO_NARROW',
        message: '책등 폭이 5mm 미만입니다. 텍스트 배치에 주의하세요.',
      });
    }

    const formula = `(${dto.pageCount} / 2) × ${thickness} + ${margin} = ${roundedSpineWidth.toFixed(2)}mm`;

    return {
      spineWidth: roundedSpineWidth,
      paperThickness: thickness,
      bindingMargin: margin,
      warnings,
      formula,
    };
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
