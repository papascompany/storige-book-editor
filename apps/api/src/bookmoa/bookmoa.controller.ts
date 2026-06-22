import {
  Controller,
  Get,
  Query,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookmoaCategoryEntity } from '../bookmoa-entities/category.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';

interface BookmoaCategory {
  sortcode: string;
  name: string;
  depth: number;
  parentSortcode: string | null;
}

interface CategoriesResponse {
  categories: BookmoaCategory[];
  total: number;
}

@ApiTags('Bookmoa')
@Controller('bookmoa')
export class BookmoaController {
  constructor(
    @InjectRepository(BookmoaCategoryEntity, 'bookmoa')
    private readonly categoryRepository: Repository<BookmoaCategoryEntity>,
  ) {}

  /**
   * 북모아 카테고리(상품) 목록 조회
   * Admin에서 상품코드 자동완성에 사용
   */
  @Get('categories')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  // SEC-006: Admin 상품코드 자동완성 전용 — 과거 전역 JWT만 통과해 고객 토큰으로도 북모아
  // 카테고리 DB 조회 가능했음. 관리자 역할로 제한(editor/외부 콜러 0건).
  @ApiOperation({ summary: '북모아 카테고리 목록 조회 (관리자 전용)' })
  @ApiQuery({ name: 'search', required: false, description: '검색어 (카테고리명 또는 sortcode)' })
  @ApiQuery({ name: 'depth', required: false, description: '카테고리 깊이 (1, 2, 3)' })
  @ApiQuery({ name: 'parent', required: false, description: '상위 카테고리 sortcode' })
  @ApiQuery({ name: 'limit', required: false, description: '최대 개수 (기본 50)' })
  @ApiResponse({
    status: 200,
    description: '카테고리 목록',
    schema: {
      type: 'object',
      properties: {
        categories: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sortcode: { type: 'string', example: '001001001' },
              name: { type: 'string', example: '무선제본 책자' },
              depth: { type: 'number', example: 3 },
              parentSortcode: { type: 'string', example: '001001', nullable: true },
            },
          },
        },
        total: { type: 'number', example: 10 },
      },
    },
  })
  async getCategories(
    @Query('search') search?: string,
    @Query('depth') depth?: string,
    @Query('parent') parent?: string,
    @Query('limit') limit?: string,
  ): Promise<CategoriesResponse> {
    try {
      const maxLimit = Math.min(parseInt(limit || '50', 10), 100);

      // QueryBuilder 사용
      const qb = this.categoryRepository
        .createQueryBuilder('cate')
        .where('cate.useYn = :useYn', { useYn: 'Y' })
        .orderBy('cate.sortcode', 'ASC')
        .take(maxLimit);

      // 검색어 조건
      if (search) {
        qb.andWhere(
          '(cate.cateName LIKE :search OR cate.sortcode LIKE :search)',
          { search: `%${search}%` },
        );
      }

      // depth 조건 (sortcode 길이로 필터링: depth 1 = 3자, depth 2 = 6자, depth 3 = 9자)
      if (depth) {
        const depthLen = parseInt(depth, 10) * 3;
        qb.andWhere('LENGTH(cate.sortcode) = :depthLen', { depthLen });
      }

      // parent 조건 (상위 카테고리)
      if (parent) {
        qb.andWhere('cate.sortcode LIKE :parent', { parent: `${parent}%` });
        qb.andWhere('LENGTH(cate.sortcode) > :parentLen', { parentLen: parent.length });
      }

      const results = await qb.getMany();

      const categories: BookmoaCategory[] = results.map((cat) => ({
        sortcode: cat.sortcode,
        name: cat.cateName,
        depth: cat.depth,
        parentSortcode: cat.sortcode.length > 3
          ? cat.sortcode.substring(0, cat.sortcode.length - 3)
          : null,
      }));

      return {
        categories,
        total: categories.length,
      };
    } catch (error) {
      console.error('카테고리 조회 실패:', error);
      throw new HttpException(
        '카테고리 조회 중 오류가 발생했습니다',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
