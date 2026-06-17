import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import {
  applySiteScope,
  TenantScope,
} from '../common/helpers/tenant-scope.helper';
import axios from 'axios';
import { decompress as woff2Decompress } from 'wawoff2';
import { LibraryFont } from './entities/font.entity';
import { LibraryBackground } from './entities/background.entity';
import { LibraryClipart } from './entities/clipart.entity';
import { LibraryShape } from './entities/shape.entity';
import { LibraryFrame } from './entities/frame.entity';
import { LibraryCategory, LibraryCategoryType } from './entities/category.entity';
import {
  CreateFontDto,
  UpdateFontDto,
  CreateBackgroundDto,
  UpdateBackgroundDto,
  CreateClipartDto,
  UpdateClipartDto,
  CreateShapeDto,
  UpdateShapeDto,
  CreateFrameDto,
  UpdateFrameDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './dto/library.dto';

// woff2 → TTF 변환 제약 (SSRF / DoS 방어)
const WOFF2_FETCH_TIMEOUT_MS = 15_000;
const WOFF2_MAX_BYTES = 30 * 1024 * 1024; // 30MB — 일반 한글 woff2 는 보통 2~6MB

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(LibraryFont)
    private fontRepository: Repository<LibraryFont>,
    @InjectRepository(LibraryBackground)
    private backgroundRepository: Repository<LibraryBackground>,
    @InjectRepository(LibraryClipart)
    private clipartRepository: Repository<LibraryClipart>,
    @InjectRepository(LibraryShape)
    private shapeRepository: Repository<LibraryShape>,
    @InjectRepository(LibraryFrame)
    private frameRepository: Repository<LibraryFrame>,
    @InjectRepository(LibraryCategory)
    private categoryRepository: Repository<LibraryCategory>,
  ) {}

  // ============================================================================
  // Fonts
  // ============================================================================

  async createFont(createFontDto: CreateFontDto): Promise<LibraryFont> {
    const font = this.fontRepository.create(createFontDto);
    return await this.fontRepository.save(font);
  }

  async findAllFonts(isActive?: boolean): Promise<LibraryFont[]> {
    const query = this.fontRepository.createQueryBuilder('font');

    if (isActive !== undefined) {
      query.where('font.isActive = :isActive', { isActive });
    }

    return await query.orderBy('font.name', 'ASC').getMany();
  }

  async findOneFont(id: string): Promise<LibraryFont> {
    const font = await this.fontRepository.findOne({ where: { id } });

    if (!font) {
      throw new NotFoundException(`Font with ID ${id} not found`);
    }

    return font;
  }

  async updateFont(id: string, updateFontDto: UpdateFontDto): Promise<LibraryFont> {
    const font = await this.findOneFont(id);
    Object.assign(font, updateFontDto);
    return await this.fontRepository.save(font);
  }

  async removeFont(id: string): Promise<void> {
    const font = await this.findOneFont(id);
    await this.fontRepository.remove(font);
  }

  // ============================================================================
  // Font conversion (woff2 → TTF)
  // ============================================================================

  /**
   * 허용된 폰트 호스트 목록을 구성한다 (SSRF 방어).
   * - STORAGE_BASE_URL 의 host (운영: api.papascompany.co.kr, 로컬: localhost)
   * - FONT_PROXY_ALLOWED_HOSTS (콤마 구분, 선택) — 외부 CDN 등 추가 허용
   * host 비교는 대소문자 무시, hostname(포트 제외) 기준.
   */
  private getAllowedFontHosts(): Set<string> {
    const hosts = new Set<string>();

    const storageBaseUrl = this.configService.get<string>('STORAGE_BASE_URL');
    if (storageBaseUrl) {
      try {
        hosts.add(new URL(storageBaseUrl).hostname.toLowerCase());
      } catch {
        // 무시 — 잘못 설정된 STORAGE_BASE_URL 은 화이트리스트에 기여하지 않음
      }
    }

    const extra = this.configService.get<string>('FONT_PROXY_ALLOWED_HOSTS');
    if (extra) {
      for (const raw of extra.split(',')) {
        const h = raw.trim().toLowerCase();
        if (h) hosts.add(h);
      }
    }

    return hosts;
  }

  /**
   * WOFF2 폰트를 다운로드해 TTF(SFNT) 바이트로 디컴프레션한다.
   * opentype.js(클라이언트)는 woff2 를 직접 읽지 못하므로 서버에서 변환해 준다.
   *
   * 보안:
   * - host 화이트리스트(STORAGE_BASE_URL 등)에 속한 URL 만 허용 → SSRF 차단
   * - https/http 스킴만 허용
   * - 업스트림 fetch 타임아웃 + 응답 크기 상한
   *
   * @param woff2Url 변환할 woff2 파일의 절대 URL
   * @returns TTF 바이트 (Buffer)
   */
  async woff2ToTtf(woff2Url: string): Promise<Buffer> {
    let parsed: URL;
    try {
      parsed = new URL(woff2Url);
    } catch {
      throw new BadRequestException('Invalid woff2Url');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('Only http/https URLs are allowed');
    }

    const allowedHosts = this.getAllowedFontHosts();
    const host = parsed.hostname.toLowerCase();
    if (!allowedHosts.has(host)) {
      this.logger.warn(`woff2ToTtf blocked disallowed host: ${host}`);
      throw new BadRequestException(`Host not allowed: ${host}`);
    }

    let woff2Buffer: Buffer;
    try {
      const response = await axios.get<ArrayBuffer>(woff2Url, {
        responseType: 'arraybuffer',
        timeout: WOFF2_FETCH_TIMEOUT_MS,
        maxContentLength: WOFF2_MAX_BYTES,
        maxBodyLength: WOFF2_MAX_BYTES,
        // 다운로드 대상이 다른 호스트로 리다이렉트되어 화이트리스트를 우회하는 것을 막는다.
        maxRedirects: 0,
        validateStatus: (status) => status === 200,
      });
      woff2Buffer = Buffer.from(response.data);
    } catch (err) {
      this.logger.error(
        `woff2ToTtf fetch failed (${woff2Url}): ${(err as Error)?.message}`,
      );
      throw new BadRequestException('Failed to fetch woff2 font');
    }

    if (woff2Buffer.length > WOFF2_MAX_BYTES) {
      throw new BadRequestException('woff2 font too large');
    }

    // woff2 매직 넘버 검증 ('wOF2')
    const signature = woff2Buffer.subarray(0, 4).toString('ascii');
    if (signature !== 'wOF2') {
      throw new BadRequestException('Fetched file is not a valid woff2 font');
    }

    try {
      const ttf = await woff2Decompress(woff2Buffer);
      return Buffer.from(ttf);
    } catch (err) {
      this.logger.error(
        `woff2ToTtf decompress failed (${woff2Url}): ${(err as Error)?.message}`,
      );
      throw new BadRequestException('Failed to decompress woff2 font');
    }
  }

  // ============================================================================
  // Backgrounds
  // ============================================================================

  async createBackground(createBackgroundDto: CreateBackgroundDto): Promise<LibraryBackground> {
    const background = this.backgroundRepository.create(createBackgroundDto);
    return await this.backgroundRepository.save(background);
  }

  async findAllBackgrounds(
    category?: string,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<LibraryBackground[]> {
    const query = this.backgroundRepository.createQueryBuilder('background');

    if (category) {
      query.andWhere('background.category = :category', { category });
    }

    if (isActive !== undefined) {
      query.andWhere('background.isActive = :isActive', { isActive });
    }

    // P2b: 라이브러리=hybrid(시스템공유 site_id=NULL). includeNull=true → 공유 에셋 전 사이트 노출.
    if (scope) applySiteScope(query, 'background', scope, { includeNull: true });

    return await query.orderBy('background.name', 'ASC').getMany();
  }

  async findOneBackground(id: string): Promise<LibraryBackground> {
    const background = await this.backgroundRepository.findOne({ where: { id } });

    if (!background) {
      throw new NotFoundException(`Background with ID ${id} not found`);
    }

    return background;
  }

  async updateBackground(
    id: string,
    updateBackgroundDto: UpdateBackgroundDto,
  ): Promise<LibraryBackground> {
    const background = await this.findOneBackground(id);
    Object.assign(background, updateBackgroundDto);
    return await this.backgroundRepository.save(background);
  }

  async removeBackground(id: string): Promise<void> {
    const background = await this.findOneBackground(id);
    await this.backgroundRepository.remove(background);
  }

  // ============================================================================
  // Cliparts
  // ============================================================================

  async createClipart(createClipartDto: CreateClipartDto): Promise<LibraryClipart> {
    const clipart = this.clipartRepository.create(createClipartDto);
    return await this.clipartRepository.save(clipart);
  }

  async findAllCliparts(
    category?: string,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<LibraryClipart[]> {
    const query = this.clipartRepository.createQueryBuilder('clipart');

    if (category) {
      query.andWhere('clipart.category = :category', { category });
    }

    if (isActive !== undefined) {
      query.andWhere('clipart.isActive = :isActive', { isActive });
    }

    // P2b: 라이브러리=hybrid. includeNull=true → 시스템공유 클립아트 전 사이트 노출.
    if (scope) applySiteScope(query, 'clipart', scope, { includeNull: true });

    return await query.orderBy('clipart.name', 'ASC').getMany();
  }

  async findOneClipart(id: string): Promise<LibraryClipart> {
    const clipart = await this.clipartRepository.findOne({ where: { id } });

    if (!clipart) {
      throw new NotFoundException(`Clipart with ID ${id} not found`);
    }

    return clipart;
  }

  async updateClipart(id: string, updateClipartDto: UpdateClipartDto): Promise<LibraryClipart> {
    const clipart = await this.findOneClipart(id);
    Object.assign(clipart, updateClipartDto);
    return await this.clipartRepository.save(clipart);
  }

  async removeClipart(id: string): Promise<void> {
    const clipart = await this.findOneClipart(id);
    await this.clipartRepository.remove(clipart);
  }

  async searchClipartsByTags(tags: string[]): Promise<LibraryClipart[]> {
    const query = this.clipartRepository.createQueryBuilder('clipart');

    // Search for cliparts that have any of the provided tags
    tags.forEach((tag, index) => {
      if (index === 0) {
        query.where('JSON_CONTAINS(clipart.tags, :tag)', { tag: JSON.stringify(tag) });
      } else {
        query.orWhere('JSON_CONTAINS(clipart.tags, :tag)', { tag: JSON.stringify(tag) });
      }
    });

    return await query.andWhere('clipart.isActive = :isActive', { isActive: true }).getMany();
  }

  // ============================================================================
  // Shapes
  // ============================================================================

  async createShape(createShapeDto: CreateShapeDto): Promise<LibraryShape> {
    const shape = this.shapeRepository.create(createShapeDto);
    return await this.shapeRepository.save(shape);
  }

  async findAllShapes(
    categoryId?: string,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<LibraryShape[]> {
    const query = this.shapeRepository.createQueryBuilder('shape');

    if (categoryId) {
      query.andWhere('shape.categoryId = :categoryId', { categoryId });
    }

    if (isActive !== undefined) {
      query.andWhere('shape.isActive = :isActive', { isActive });
    }

    // P2b: 라이브러리=hybrid. includeNull=true → 시스템공유 도형 전 사이트 노출.
    if (scope) applySiteScope(query, 'shape', scope, { includeNull: true });

    return await query.orderBy('shape.name', 'ASC').getMany();
  }

  async findOneShape(id: string): Promise<LibraryShape> {
    const shape = await this.shapeRepository.findOne({ where: { id } });

    if (!shape) {
      throw new NotFoundException(`Shape with ID ${id} not found`);
    }

    return shape;
  }

  async updateShape(id: string, updateShapeDto: UpdateShapeDto): Promise<LibraryShape> {
    const shape = await this.findOneShape(id);
    Object.assign(shape, updateShapeDto);
    return await this.shapeRepository.save(shape);
  }

  async removeShape(id: string): Promise<void> {
    const shape = await this.findOneShape(id);
    await this.shapeRepository.remove(shape);
  }

  // ============================================================================
  // Frames
  // ============================================================================

  async createFrame(createFrameDto: CreateFrameDto): Promise<LibraryFrame> {
    const frame = this.frameRepository.create(createFrameDto);
    return await this.frameRepository.save(frame);
  }

  async findAllFrames(
    categoryId?: string,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<LibraryFrame[]> {
    const query = this.frameRepository.createQueryBuilder('frame');

    if (categoryId) {
      query.andWhere('frame.categoryId = :categoryId', { categoryId });
    }

    if (isActive !== undefined) {
      query.andWhere('frame.isActive = :isActive', { isActive });
    }

    // P2b: 라이브러리=hybrid. includeNull=true → 시스템공유 프레임 전 사이트 노출.
    if (scope) applySiteScope(query, 'frame', scope, { includeNull: true });

    return await query.orderBy('frame.name', 'ASC').getMany();
  }

  async findOneFrame(id: string): Promise<LibraryFrame> {
    const frame = await this.frameRepository.findOne({ where: { id } });

    if (!frame) {
      throw new NotFoundException(`Frame with ID ${id} not found`);
    }

    return frame;
  }

  async updateFrame(id: string, updateFrameDto: UpdateFrameDto): Promise<LibraryFrame> {
    const frame = await this.findOneFrame(id);
    Object.assign(frame, updateFrameDto);
    return await this.frameRepository.save(frame);
  }

  async removeFrame(id: string): Promise<void> {
    const frame = await this.findOneFrame(id);
    await this.frameRepository.remove(frame);
  }

  // ============================================================================
  // Categories
  // ============================================================================

  async createCategory(createCategoryDto: CreateCategoryDto): Promise<LibraryCategory> {
    const category = this.categoryRepository.create(createCategoryDto);
    return await this.categoryRepository.save(category);
  }

  async findAllCategories(
    type?: LibraryCategoryType,
    isActive?: boolean,
    scope?: TenantScope,
  ): Promise<LibraryCategory[]> {
    const query = this.categoryRepository.createQueryBuilder('category');

    if (type) {
      query.andWhere('category.type = :type', { type });
    }

    if (isActive !== undefined) {
      query.andWhere('category.isActive = :isActive', { isActive });
    }

    // P2b: 라이브러리 카테고리=hybrid. includeNull=true → 시스템공유 카테고리 전 사이트 노출.
    if (scope) applySiteScope(query, 'category', scope, { includeNull: true });

    return await query
      .orderBy('category.sortOrder', 'ASC')
      .addOrderBy('category.name', 'ASC')
      .getMany();
  }

  async findCategoriesTree(type: LibraryCategoryType): Promise<LibraryCategory[]> {
    // Fetch root categories (parentId is null)
    const rootCategories = await this.categoryRepository.find({
      where: {
        type,
        parentId: IsNull(),
        isActive: true,
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });

    // Fetch children for each root
    for (const root of rootCategories) {
      root.children = await this.categoryRepository.find({
        where: {
          parentId: root.id,
          isActive: true,
        },
        order: { sortOrder: 'ASC', name: 'ASC' },
      });
    }

    return rootCategories;
  }

  async findOneCategory(id: string): Promise<LibraryCategory> {
    const category = await this.categoryRepository.findOne({ where: { id } });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async updateCategory(id: string, updateCategoryDto: UpdateCategoryDto): Promise<LibraryCategory> {
    const category = await this.findOneCategory(id);
    Object.assign(category, updateCategoryDto);
    return await this.categoryRepository.save(category);
  }

  async removeCategory(id: string): Promise<void> {
    const category = await this.findOneCategory(id);

    // Check if category has children
    const children = await this.categoryRepository.find({
      where: { parentId: id },
    });

    if (children.length > 0) {
      // Move children to root (set parentId to null)
      for (const child of children) {
        child.parentId = null;
        await this.categoryRepository.save(child);
      }
    }

    await this.categoryRepository.remove(category);
  }
}
