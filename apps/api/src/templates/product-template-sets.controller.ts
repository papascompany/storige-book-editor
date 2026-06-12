import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { ProductTemplateSetsService } from './product-template-sets.service';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';
import {
  CreateProductTemplateSetDto,
  UpdateProductTemplateSetDto,
  BulkCreateProductTemplateSetDto,
  ProductTemplateSetQueryDto,
  ProductTemplateSetListQueryDto,
  ProductTemplateSetResponseDto,
  TemplateSetsByProductResponseDto,
  ProductTemplateSetListResponseDto,
} from './dto/product-template-set.dto';

@ApiTags('Product Template Sets')
@Controller('product-template-sets')
export class ProductTemplateSetsController {
  constructor(
    private readonly productTemplateSetsService: ProductTemplateSetsService,
  ) {}

  /**
   * 상품별 템플릿셋 조회 (외부용 - API Key 인증)
   * bookmoa에서 호출하는 엔드포인트
   */
  @Get('by-product')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: '상품별 템플릿셋 조회 (외부용)' })
  @ApiResponse({
    status: 200,
    description: '템플릿셋 목록',
    type: TemplateSetsByProductResponseDto,
  })
  async findByProduct(
    @Query() query: ProductTemplateSetQueryDto,
  ): Promise<TemplateSetsByProductResponseDto> {
    return this.productTemplateSetsService.findByProduct(
      query.sortcode,
      query.stanSeqno,
    );
  }

  /**
   * 연결 목록 조회 (관리자용)
   */
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: '상품-템플릿셋 연결 목록 조회' })
  @ApiResponse({
    status: 200,
    description: '연결 목록',
    type: ProductTemplateSetListResponseDto,
  })
  async findAll(
    @Query() query: ProductTemplateSetListQueryDto,
  ): Promise<ProductTemplateSetListResponseDto> {
    return this.productTemplateSetsService.findAll(query);
  }

  /**
   * 연결 단건 조회
   */
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '상품-템플릿셋 연결 상세 조회' })
  @ApiResponse({
    status: 200,
    description: '연결 정보',
    type: ProductTemplateSetResponseDto,
  })
  @ApiResponse({ status: 404, description: '연결을 찾을 수 없음' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductTemplateSetResponseDto> {
    const entity = await this.productTemplateSetsService.findById(id);
    return this.productTemplateSetsService.toResponseDto(entity);
  }

  /**
   * 연결 생성
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '상품-템플릿셋 연결 생성' })
  @ApiResponse({
    status: 201,
    description: '생성 성공',
    type: ProductTemplateSetResponseDto,
  })
  @ApiResponse({ status: 404, description: '템플릿셋을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '이미 존재하는 연결' })
  async create(
    @Body() dto: CreateProductTemplateSetDto,
  ): Promise<ProductTemplateSetResponseDto> {
    const entity = await this.productTemplateSetsService.create(dto);
    return this.productTemplateSetsService.toResponseDto(entity);
  }

  /**
   * 일괄 연결 생성
   */
  @Post('bulk')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '상품-템플릿셋 일괄 연결' })
  @ApiResponse({
    status: 201,
    description: '생성 성공',
    type: [ProductTemplateSetResponseDto],
  })
  async bulkCreate(
    @Body() dto: BulkCreateProductTemplateSetDto,
  ): Promise<ProductTemplateSetResponseDto[]> {
    const entities = await this.productTemplateSetsService.bulkCreate(dto);
    return entities.map((e) => this.productTemplateSetsService.toResponseDto(e));
  }

  /**
   * 연결 수정
   */
  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '상품-템플릿셋 연결 수정' })
  @ApiResponse({
    status: 200,
    description: '수정 성공',
    type: ProductTemplateSetResponseDto,
  })
  @ApiResponse({ status: 404, description: '연결을 찾을 수 없음' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductTemplateSetDto,
  ): Promise<ProductTemplateSetResponseDto> {
    const entity = await this.productTemplateSetsService.update(id, dto);
    return this.productTemplateSetsService.toResponseDto(entity);
  }

  /**
   * 연결 삭제
   */
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '상품-템플릿셋 연결 삭제' })
  @ApiResponse({ status: 204, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '연결을 찾을 수 없음' })
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.productTemplateSetsService.delete(id);
  }
}
