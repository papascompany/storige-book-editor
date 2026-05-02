import { Injectable, Logger, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { v4 as uuidv4 } from 'uuid';
import {
  AiGeneration,
  GenerationStatus,
  GenerationOptions,
} from '../entities/ai-generation.entity';
import { LlmService, LayoutPlan, LayoutPage, LayoutSection } from '../providers/llm.service';
import { FluxImageService } from '../providers/flux-image.service';
import {
  GenerationRequestDto,
  GenerationStartResponseDto,
  GenerationStatusDto,
  GenerationAcceptDto,
  GenerationRejectDto,
} from '../dto/generation.dto';
import { AiModuleOptions } from '../ai.module';

/**
 * 로컬 타입 정의 (외부 패키지 의존성 제거)
 */
type TemplateType = 'cover' | 'page' | 'spine' | 'back';
type TemplateSetType = 'book' | 'leaflet';

interface TemplateRef {
  templateId: string;
  required: boolean;
}

interface FabricObject {
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  originX?: 'left' | 'center' | 'right';
  originY?: 'top' | 'center' | 'bottom';
  fill?: string;
  stroke?: string;
  [key: string]: unknown;
}

interface CanvasData {
  version: string;
  width: number;
  height: number;
  objects: FabricObject[];
  background?: string;
}

/**
 * AI 템플릿 생성 서비스
 */
// Entity interfaces for dynamic injection
interface TemplateEntity {
  id: string;
  name: string;
  type: TemplateType;
  width: number;
  height: number;
  canvasData: CanvasData;
  thumbnailUrl?: string | null;
}

interface TemplateSetEntity {
  id: string;
  name: string;
  type: TemplateSetType;
  width: number;
  height: number;
  canAddPage: boolean;
  pageCountRange: number[];
  templates: TemplateRef[];
  thumbnailUrl?: string | null;
  isDeleted: boolean;
}

@Injectable()
export class GenerationService {
  private readonly logger = new Logger(GenerationService.name);

  constructor(
    @InjectRepository(AiGeneration)
    private generationRepo: Repository<AiGeneration>,
    @Inject('TEMPLATE_REPOSITORY')
    private templateRepo: Repository<TemplateEntity>,
    @Inject('TEMPLATE_SET_REPOSITORY')
    private templateSetRepo: Repository<TemplateSetEntity>,
    @InjectQueue('ai-generation')
    private generationQueue: Queue,
    private llmService: LlmService,
    private imageService: FluxImageService,
  ) {}

  /**
   * 템플릿 생성 시작
   */
  async startGeneration(
    userId: string | undefined,
    request: GenerationRequestDto,
  ): Promise<GenerationStartResponseDto> {
    // 생성 레코드 생성
    const generation = this.generationRepo.create({
      id: uuidv4(),
      userId,
      prompt: request.prompt,
      options: request.options as GenerationOptions,
      status: GenerationStatus.PENDING,
      progress: 0,
    });

    await this.generationRepo.save(generation);

    // Bull Queue에 작업 추가
    await this.generationQueue.add(
      'generate-template',
      {
        generationId: generation.id,
        userId,
        request,
      },
      {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(`Started generation: ${generation.id}`);

    // 예상 시간 계산 (페이지 수와 이미지 포함 여부 기반)
    const estimatedTime = this.estimateGenerationTime(request);

    return {
      generationId: generation.id,
      status: GenerationStatus.PENDING,
      estimatedTime,
      statusUrl: `/api/ai/generate/${generation.id}`,
    };
  }

  /**
   * 생성 상태 조회
   */
  async getGenerationStatus(generationId: string): Promise<GenerationStatusDto> {
    const generation = await this.generationRepo.findOne({
      where: { id: generationId },
    });

    if (!generation) {
      throw new NotFoundException(`Generation not found: ${generationId}`);
    }

    const statusMessages: Record<GenerationStatus, string> = {
      [GenerationStatus.PENDING]: '대기 중...',
      [GenerationStatus.LAYOUT]: '레이아웃 생성 중...',
      [GenerationStatus.IMAGES]: '이미지 생성 중...',
      [GenerationStatus.ASSEMBLY]: '템플릿 조립 중...',
      [GenerationStatus.COMPLETED]: '완료',
      [GenerationStatus.FAILED]: '실패',
    };

    return {
      id: generation.id,
      status: generation.status,
      progress: generation.progress,
      statusMessage: statusMessages[generation.status],
      templateSetId: generation.generatedTemplateSetId || undefined,
      thumbnailUrl: generation.thumbnailUrl || undefined,
      errorMessage: generation.errorMessage || undefined,
      createdAt: generation.createdAt,
      completedAt: generation.completedAt || undefined,
    };
  }

  /**
   * 생성 결과 수락
   */
  async acceptGeneration(
    generationId: string,
    userId: string | undefined,
    accept: GenerationAcceptDto,
  ): Promise<TemplateSetEntity> {
    const whereClause: { id: string; userId?: string } = { id: generationId };
    if (userId) whereClause.userId = userId;

    const generation = await this.generationRepo.findOne({
      where: whereClause,
    });

    if (!generation) {
      throw new NotFoundException(`Generation not found: ${generationId}`);
    }

    if (generation.status !== GenerationStatus.COMPLETED) {
      throw new Error('Generation is not completed yet');
    }

    if (!generation.generatedTemplateSetId) {
      throw new Error('No template set was generated');
    }

    // 템플릿셋 조회
    const templateSet = await this.templateSetRepo.findOne({
      where: { id: generation.generatedTemplateSetId },
    });

    if (!templateSet) {
      throw new Error('Template set not found');
    }

    // 피드백 저장
    generation.userAccepted = true;
    generation.userRating = accept.rating ?? null;
    generation.userFeedback = accept.feedback ?? null;
    await this.generationRepo.save(generation);

    // 템플릿셋 이름 업데이트 (요청 시)
    if (accept.name) {
      templateSet.name = accept.name;
      await this.templateSetRepo.save(templateSet);
    }

    return templateSet;
  }

  /**
   * 생성 결과 거절
   */
  async rejectGeneration(
    generationId: string,
    userId: string | undefined,
    reject: GenerationRejectDto,
  ): Promise<void> {
    const whereClause: { id: string; userId?: string } = { id: generationId };
    if (userId) whereClause.userId = userId;

    const generation = await this.generationRepo.findOne({
      where: whereClause,
    });

    if (!generation) {
      throw new NotFoundException(`Generation not found: ${generationId}`);
    }

    generation.userAccepted = false;
    generation.userFeedback = reject.reason ?? null;
    await this.generationRepo.save(generation);

    // 생성된 템플릿셋 삭제 (소프트 삭제)
    if (generation.generatedTemplateSetId) {
      await this.templateSetRepo.update(
        { id: generation.generatedTemplateSetId },
        { isDeleted: true },
      );
    }

    this.logger.log(`Generation rejected: ${generationId}`);
  }

  /**
   * 생성 이력 조회
   */
  async getGenerationHistory(
    userId: string | undefined,
    limit: number = 20,
  ): Promise<AiGeneration[]> {
    if (!userId) {
      return [];
    }

    return this.generationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * 실제 생성 처리 (Queue Worker에서 호출)
   */
  async processGeneration(
    generationId: string,
    request: GenerationRequestDto,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      // Step 1: 레이아웃 생성
      await this.updateProgress(generationId, GenerationStatus.LAYOUT, 10);

      const layoutPlan = await this.llmService.generateTemplateLayout({
        prompt: request.prompt,
        templateType: request.options.templateType,
        pageCount: request.options.pageCount,
        style: request.options.style,
        colorScheme: request.options.colorScheme,
        dimensions: request.options.dimensions,
        industryCategory: request.options.industryCategory,
      });

      await this.updateProgress(generationId, GenerationStatus.LAYOUT, 30, {
        layoutPlan,
        llmModel: 'claude-3-5-sonnet-20241022',
      });

      // Step 2: 이미지 생성
      let imageMap = new Map<string, string>();

      if (request.options.includeImages !== false) {
        await this.updateProgress(generationId, GenerationStatus.IMAGES, 40);
        imageMap = await this.generateImages(layoutPlan, request.options);
        await this.updateProgress(generationId, GenerationStatus.IMAGES, 70);
      }

      // Step 3: 템플릿 조립
      await this.updateProgress(generationId, GenerationStatus.ASSEMBLY, 75);

      const templates = await this.assembleTemplates(
        layoutPlan,
        imageMap,
        request.options.dimensions,
      );

      await this.updateProgress(generationId, GenerationStatus.ASSEMBLY, 85);

      // Step 4: 템플릿셋 생성
      const templateSet = await this.createTemplateSet(
        templates,
        layoutPlan,
        request,
      );

      // Step 5: 완료
      const processingTimeMs = Date.now() - startTime;

      await this.generationRepo.update(
        { id: generationId },
        {
          status: GenerationStatus.COMPLETED,
          progress: 100,
          generatedTemplateSetId: templateSet.id,
          thumbnailUrl: templateSet.thumbnailUrl,
          processingTimeMs,
          imagesGenerated: imageMap.size,
          imageModel: 'flux-1.1-pro',
          completedAt: new Date(),
        },
      );

      this.logger.log(
        `Generation completed: ${generationId} in ${processingTimeMs}ms`,
      );
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Generation failed: ${generationId} - ${err.message}`,
        err.stack,
      );

      await this.generationRepo.update(
        { id: generationId },
        {
          status: GenerationStatus.FAILED,
          errorMessage: err.message,
        },
      );

      throw error;
    }
  }

  /**
   * 이미지 생성
   */
  private async generateImages(
    layout: LayoutPlan,
    options: GenerationRequestDto['options'],
  ): Promise<Map<string, string>> {
    const imageMap = new Map<string, string>();

    // 이미지 프롬프트 수집
    const imagePrompts: { key: string; prompt: string }[] = [];

    for (const page of layout.pages) {
      for (let i = 0; i < page.layout.sections.length; i++) {
        const section = page.layout.sections[i];
        if (section.type === 'image' && section.imagePrompt) {
          imagePrompts.push({
            key: `page_${page.pageNumber}_section_${i}`,
            prompt: section.imagePrompt,
          });
        }
      }
    }

    if (imagePrompts.length === 0) {
      return imageMap;
    }

    // 병렬 이미지 생성 (최대 3개씩)
    const batchSize = 3;

    for (let i = 0; i < imagePrompts.length; i += batchSize) {
      const batch = imagePrompts.slice(i, i + batchSize);

      const results = await Promise.all(
        batch.map(async ({ key, prompt }) => {
          try {
            const result = await this.imageService.generateForTemplate({
              description: prompt,
              style: options.style,
              colorScheme: options.colorScheme,
            });

            return { key, url: result.url };
          } catch (error) {
            const err = error as Error;
            this.logger.warn(`Image generation failed for ${key}: ${err.message}`);
            return { key, url: '' };
          }
        }),
      );

      results.forEach(({ key, url }) => {
        if (url) imageMap.set(key, url);
      });
    }

    return imageMap;
  }

  /**
   * 템플릿 조립
   */
  private async assembleTemplates(
    layout: LayoutPlan,
    images: Map<string, string>,
    dimensions: { width: number; height: number },
  ): Promise<TemplateEntity[]> {
    const templates: Partial<TemplateEntity>[] = [];

    for (const page of layout.pages) {
      const canvasObjects: FabricObject[] = [];

      for (let i = 0; i < page.layout.sections.length; i++) {
        const section = page.layout.sections[i];
        const fabricObject = this.sectionToFabricObject(
          section,
          page.pageNumber,
          i,
          images,
          layout.fonts,
        );

        if (fabricObject) {
          canvasObjects.push(fabricObject);
        }
      }

      const canvasData: CanvasData = {
        version: '5.3.0',
        width: dimensions.width,
        height: dimensions.height,
        objects: canvasObjects,
        background: page.backgroundColor || '#FFFFFF',
      };

      const template: Partial<TemplateEntity> = {
        id: uuidv4(),
        name: page.title || `Page ${page.pageNumber}`,
        type: this.mapPageType(page.pageType),
        width: dimensions.width,
        height: dimensions.height,
        canvasData: canvasData,
      };

      templates.push(template);
    }

    // 템플릿 저장
    const savedTemplates = await this.templateRepo.save(templates);

    return savedTemplates;
  }

  /**
   * 섹션을 Fabric 객체로 변환
   */
  private sectionToFabricObject(
    section: LayoutSection,
    pageNumber: number,
    sectionIndex: number,
    images: Map<string, string>,
    fonts: { heading: string; body: string },
  ): FabricObject | null {
    const baseProps = {
      left: section.position.x,
      top: section.position.y,
      width: section.position.width,
      height: section.position.height,
      originX: 'left' as const,
      originY: 'top' as const,
    };

    switch (section.type) {
      case 'text':
        return {
          type: 'textbox',
          text: section.content || '',
          ...baseProps,
          fontSize: section.style?.fontSize || 16,
          fontFamily: section.style?.fontWeight === 'bold' ? fonts.heading : fonts.body,
          fontWeight: section.style?.fontWeight || 'normal',
          fill: section.style?.color || '#000000',
          textAlign: section.style?.align || 'left',
        } as FabricObject;

      case 'image': {
        const imageKey = `page_${pageNumber}_section_${sectionIndex}`;
        const imageUrl = images.get(imageKey);

        if (!imageUrl) return null;

        return {
          type: 'image',
          src: imageUrl,
          ...baseProps,
          scaleX: 1,
          scaleY: 1,
        } as FabricObject;
      }

      case 'shape':
        return {
          type: section.shapeType === 'circle' ? 'circle' : 'rect',
          ...baseProps,
          fill: section.style?.fill || '#E5E7EB',
          opacity: section.style?.opacity || 1,
          rx: section.style?.borderRadius || 0,
          ry: section.style?.borderRadius || 0,
          ...(section.shapeType === 'circle' && {
            radius: Math.min(section.position.width, section.position.height) / 2,
          }),
        } as FabricObject;

      default:
        return null;
    }
  }

  /**
   * 페이지 타입 매핑
   */
  private mapPageType(pageType: string): TemplateType {
    const typeMap: Record<string, TemplateType> = {
      cover: 'cover' as TemplateType,
      page: 'page' as TemplateType,
      spine: 'spine' as TemplateType,
    };

    return typeMap[pageType] || ('page' as TemplateType);
  }

  /**
   * 템플릿셋 생성
   */
  private async createTemplateSet(
    templates: TemplateEntity[],
    layout: LayoutPlan,
    request: GenerationRequestDto,
  ): Promise<TemplateSetEntity> {
    const templateRefs: TemplateRef[] = templates.map((t, index) => ({
      templateId: t.id,
      required: index === 0, // 첫 번째 템플릿은 필수
    }));

    // 프롬프트에서 이름 생성
    const name = `AI Generated: ${request.prompt.substring(0, 50)}${request.prompt.length > 50 ? '...' : ''}`;

    const templateSet = this.templateSetRepo.create({
      id: uuidv4(),
      name,
      type: request.options.templateType as TemplateSetType,
      width: request.options.dimensions.width,
      height: request.options.dimensions.height,
      canAddPage: true,
      pageCountRange: [request.options.pageCount],
      templates: templateRefs,
      thumbnailUrl: templates[0]?.thumbnailUrl || null,
      isDeleted: false,
    });

    return this.templateSetRepo.save(templateSet) as Promise<TemplateSetEntity>;
  }

  /**
   * 진행 상태 업데이트
   */
  private async updateProgress(
    generationId: string,
    status: GenerationStatus,
    progress: number,
    additionalData?: Record<string, unknown>,
  ): Promise<void> {
    const updateData = {
      status,
      progress,
      ...additionalData,
    };
    await this.generationRepo.update({ id: generationId }, updateData as never);
  }

  /**
   * 예상 생성 시간 계산
   */
  private estimateGenerationTime(request: GenerationRequestDto): number {
    // 기본 시간 (LLM 호출)
    let time = 10;

    // 페이지 수에 따른 추가 시간
    time += request.options.pageCount * 2;

    // 이미지 생성 시간
    if (request.options.includeImages !== false) {
      time += request.options.pageCount * 3; // 페이지당 약 3초
    }

    return Math.min(120, Math.max(15, time));
  }
}
