import { Injectable, NotFoundException, ConflictException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeSpreadSpec, computeSpreadDimensions } from '@storige/types';
import type { SpreadConversionMode } from '@storige/types';
import { Template } from './entities/template.entity';
import { TemplateSet } from './entities/template-set.entity';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import {
  applySiteScope,
  TenantScope,
} from '../common/helpers/tenant-scope.helper';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    @InjectRepository(Template)
    private templateRepository: Repository<Template>,
    @InjectRepository(TemplateSet)
    private templateSetRepository: Repository<TemplateSet>,
  ) {}

  /**
   * 고유한 코드 생성 (TMPL-XXXXXXXX 형식)
   */
  private generateCode(prefix: string): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${prefix}-${code}`;
  }

  /**
   * editCode 중복 검사
   */
  async checkEditCodeExists(editCode: string, excludeId?: string): Promise<boolean> {
    const query = this.templateRepository.createQueryBuilder('template')
      .where('template.editCode = :editCode', { editCode });

    if (excludeId) {
      query.andWhere('template.id != :excludeId', { excludeId });
    }

    const count = await query.getCount();
    return count > 0;
  }

  async create(createTemplateDto: CreateTemplateDto, userId?: string): Promise<Template> {
    // spread 타입 검증 및 정규화
    if (createTemplateDto.type === 'spread') {
      this.validateAndNormalizeSpreadConfig(createTemplateDto);
    }

    // 템플릿 코드와 편집 코드 자동 생성
    let templateCode = this.generateCode('TMPL');
    let editCode = this.generateCode('EDIT');

    // 중복 검사 후 재생성 (최대 5회 시도)
    for (let i = 0; i < 5; i++) {
      const templateCodeExists = await this.templateRepository.findOne({ where: { templateCode } });
      if (!templateCodeExists) break;
      templateCode = this.generateCode('TMPL');
    }

    for (let i = 0; i < 5; i++) {
      const editCodeExists = await this.templateRepository.findOne({ where: { editCode } });
      if (!editCodeExists) break;
      editCode = this.generateCode('EDIT');
    }

    const template = this.templateRepository.create({
      ...createTemplateDto,
      templateCode,
      editCode,
      createdBy: userId,
    });

    return await this.templateRepository.save(template);
  }

  async findAll(
    categoryId?: string,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<Template[]> {
    const query = this.templateRepository.createQueryBuilder('template')
      .leftJoinAndSelect('template.category', 'category')
      .leftJoinAndSelect('template.creator', 'creator')
      .where('template.isDeleted = :isDeleted', { isDeleted: false });

    if (categoryId) {
      query.andWhere('template.categoryId = :categoryId', { categoryId });
    }

    if (isActive !== undefined) {
      query.andWhere('template.isActive = :isActive', { isActive });
    }

    // P2b: 템플릿=hybrid(시스템공유 site_id=NULL + per-site). includeNull=true 로
    // 시스템공유 자산은 전 사이트에 노출, 운영자는 자기 site + 공유만 본다(전역 admin 무필터).
    if (scope) applySiteScope(query, 'template', scope, { includeNull: true });

    return await query.getMany();
  }

  async findOne(id: string): Promise<Template> {
    const template = await this.templateRepository.findOne({
      where: { id, isDeleted: false },
      relations: ['category', 'creator'],
    });

    if (!template) {
      throw new NotFoundException(`Template with ID ${id} not found`);
    }

    return template;
  }

  async findByCode(editCode: string): Promise<Template> {
    const template = await this.templateRepository.findOne({
      where: { editCode, isDeleted: false },
      relations: ['category'],
    });

    if (!template) {
      throw new NotFoundException(`Template with code ${editCode} not found`);
    }

    return template;
  }

  async update(id: string, updateTemplateDto: UpdateTemplateDto): Promise<Template> {
    const template = await this.findOne(id);

    // editCode 변경 시 중복 검사
    if (updateTemplateDto.editCode && updateTemplateDto.editCode !== template.editCode) {
      const exists = await this.checkEditCodeExists(updateTemplateDto.editCode, id);
      if (exists) {
        throw new ConflictException(`편집 코드 '${updateTemplateDto.editCode}'가 이미 사용 중입니다.`);
      }
    }

    // conversionMode 보존 병합(서버측 최후 방어): 기존 템플릿에 conversionMode 가 있는데
    // 수신 spreadConfig 에 누락된 경우(클라이언트가 spreadConfig 를 재구성해 덮어쓰는 경로),
    // 기존 값을 병합해 라운드트립 유실('full' 강등 → flat 아트워크 분기 붕괴)을 막는다.
    const existingConversionMode = template.spreadConfig?.conversionMode;
    if (
      updateTemplateDto.spreadConfig &&
      updateTemplateDto.spreadConfig.conversionMode === undefined &&
      existingConversionMode !== undefined
    ) {
      updateTemplateDto.spreadConfig.conversionMode = existingConversionMode;
    }

    // spread 타입 검증 및 정규화
    const effectiveType = updateTemplateDto.type || template.type;
    if (effectiveType === 'spread' && updateTemplateDto.spreadConfig) {
      this.validateAndNormalizeSpreadConfig(updateTemplateDto);
    }

    Object.assign(template, updateTemplateDto);

    return await this.templateRepository.save(template);
  }

  /**
   * spread 타입 검증 및 정규화 (create/update 공용)
   */
  private validateAndNormalizeSpreadConfig(dto: CreateTemplateDto | UpdateTemplateDto): void {
    if (!dto.spreadConfig) {
      throw new BadRequestException('type=spread일 때 spreadConfig는 필수입니다.');
    }

    const rawSpec = dto.spreadConfig.spec;
    if (!rawSpec || !Number.isFinite(rawSpec.coverWidthMm) || !Number.isFinite(rawSpec.coverHeightMm)) {
      throw new BadRequestException('spreadConfig.spec에 유효한 coverWidthMm, coverHeightMm이 필요합니다.');
    }
    if (rawSpec.coverWidthMm <= 0 || rawSpec.coverHeightMm <= 0) {
      throw new BadRequestException('coverWidthMm, coverHeightMm은 양수여야 합니다.');
    }
    if (rawSpec.wingEnabled === true && (!rawSpec.wingWidthMm || rawSpec.wingWidthMm <= 0)) {
      throw new BadRequestException('wingEnabled=true일 때 wingWidthMm은 양수여야 합니다.');
    }
    if (rawSpec.spineWidthMm !== undefined && rawSpec.spineWidthMm < 0) {
      throw new BadRequestException('spineWidthMm은 0 이상이어야 합니다.');
    }

    // 정규화
    const normalizedSpec = normalizeSpreadSpec(rawSpec);
    const dims = computeSpreadDimensions(normalizedSpec);

    // 클라이언트 값과 서버 계산값 차이 경고
    if (dto.width && Math.abs(dto.width - dims.totalWidthMm) > 0.2) {
      this.logger.warn(
        `Template width mismatch: client=${dto.width}mm, server=${dims.totalWidthMm}mm`,
      );
    }
    if (dto.height && Math.abs(dto.height - dims.totalHeightMm) > 0.2) {
      this.logger.warn(
        `Template height mismatch: client=${dto.height}mm, server=${dims.totalHeightMm}mm`,
      );
    }

    // 서버 계산값으로 override
    dto.width = dims.totalWidthMm;
    dto.height = dims.totalHeightMm;

    // spreadConfig도 정규화
    dto.spreadConfig.spec = normalizedSpec;
    dto.spreadConfig.totalWidthMm = dims.totalWidthMm;
    dto.spreadConfig.totalHeightMm = dims.totalHeightMm;
    if (!dto.spreadConfig.version) {
      dto.spreadConfig.version = 1;
    }

    // conversionMode 검증 (JSON 필드 — 미존재 시 'full' 간주. 값은 보존하며 변형하지 않음)
    const conversionMode = dto.spreadConfig.conversionMode;
    if (conversionMode !== undefined) {
      const allowedModes: SpreadConversionMode[] = ['full', 'flat-spread', 'flat-spine'];
      if (!allowedModes.includes(conversionMode)) {
        throw new BadRequestException(
          `spreadConfig.conversionMode는 ${allowedModes.join(', ')} 중 하나여야 합니다. (받은 값: ${String(conversionMode)})`,
        );
      }
      if (conversionMode === 'flat-spine') {
        // flat-spine 은 back/spine/front 3분할 아트워크가 영역에 앵커되므로 해당 영역이 필수.
        // 변환기는 regions 항목을 {kind,...} 로, 편집기 레이아웃은 {position,...} 으로 내보내므로 둘 다 허용.
        const regionKinds = new Set(
          (dto.spreadConfig.regions ?? []).map(
            (r) => (r as { kind?: string; position?: string }).kind ?? (r as { position?: string }).position,
          ),
        );
        const required = ['back-cover', 'spine', 'front-cover'];
        const missing = required.filter((k) => !regionKinds.has(k));
        if (missing.length > 0) {
          throw new BadRequestException(
            `conversionMode=flat-spine일 때 spreadConfig.regions에 ${required.join(', ')} 영역이 모두 필요합니다. (누락: ${missing.join(', ')})`,
          );
        }
      }
    }
  }

  /**
   * 템플릿이 사용 중인 템플릿셋 목록 조회
   */
  async getTemplateSetsUsingTemplate(templateId: string): Promise<TemplateSet[]> {
    const templateSets = await this.templateSetRepository.find({
      where: { isDeleted: false },
    });

    return templateSets.filter((ts) =>
      ts.templates?.some((ref) => ref.templateId === templateId),
    );
  }

  /**
   * 템플릿 삭제 (소프트 삭제)
   * @param force true인 경우 템플릿셋에서 사용 중이어도 삭제 (템플릿셋에서 해당 템플릿 참조 제거)
   */
  async remove(id: string, force = false): Promise<{ affected: number; usedByTemplateSets: string[] }> {
    const template = await this.findOne(id);

    // 사용 중인 템플릿셋 확인
    const usedByTemplateSets = await this.getTemplateSetsUsingTemplate(id);
    const usedByTemplateSetNames = usedByTemplateSets.map((ts) => ts.name);

    if (usedByTemplateSets.length > 0 && !force) {
      throw new BadRequestException({
        message: `이 템플릿은 ${usedByTemplateSets.length}개의 템플릿셋에서 사용 중입니다.`,
        usedByTemplateSets: usedByTemplateSetNames,
      });
    }

    // force 삭제인 경우, 템플릿셋에서 해당 템플릿 참조 제거
    if (force && usedByTemplateSets.length > 0) {
      for (const ts of usedByTemplateSets) {
        ts.templates = ts.templates.filter((ref) => ref.templateId !== id);
        await this.templateSetRepository.save(ts);
      }
    }

    template.isDeleted = true;
    await this.templateRepository.save(template);

    return {
      affected: 1,
      usedByTemplateSets: usedByTemplateSetNames,
    };
  }

  async copy(id: string, userId?: string): Promise<Template> {
    const original = await this.findOne(id);

    const copy = this.templateRepository.create({
      name: `${original.name} (Copy)`,
      categoryId: original.categoryId,
      thumbnailUrl: original.thumbnailUrl,
      canvasData: original.canvasData,
      isActive: false,
      createdBy: userId,
    });

    return await this.templateRepository.save(copy);
  }
}
