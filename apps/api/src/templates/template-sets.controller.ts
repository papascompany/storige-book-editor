import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { TemplateSetsService } from './template-sets.service';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';
import { CurrentScope } from '../auth/decorators/tenant-scope.decorator';
import { TenantScope } from '../common/helpers/tenant-scope.helper';
import {
  CreateTemplateSetDto,
  UpdateTemplateSetDto,
  TemplateSetQueryDto,
  AddTemplateDto,
  ReorderTemplatesDto,
} from './dto/template-set.dto';

@ApiTags('Template Sets')
@Controller('template-sets')
export class TemplateSetsController {
  constructor(private readonly templateSetsService: TemplateSetsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋 생성' })
  @ApiResponse({ status: 201, description: '생성 성공' })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  async create(@Body() dto: CreateTemplateSetDto) {
    return this.templateSetsService.create(dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋 목록 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async findAll(
    @CurrentScope() scope: TenantScope,
    @Query() query: TemplateSetQueryDto,
  ) {
    return this.templateSetsService.findAll(query, scope);
  }

  @Get('compatible')
  @ApiBearerAuth()
  @ApiOperation({ summary: '호환 가능한 템플릿셋 조회 (같은 판형)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async findCompatible(
    @CurrentScope() scope: TenantScope,
    @Query('width') width: number,
    @Query('height') height: number,
    @Query('type') type?: string,
  ) {
    return this.templateSetsService.findCompatible(+width, +height, type, scope);
  }

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋 상세 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async findOne(@Param('id') id: string) {
    return this.templateSetsService.findOne(id);
  }

  @Get(':id/with-templates')
  @Public()
  @ApiOperation({ summary: '템플릿셋과 템플릿 상세 정보 조회 (에디터용 - 공개)' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async findOneWithTemplates(@Param('id') id: string) {
    return this.templateSetsService.findOneWithTemplates(id);
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋 수정' })
  @ApiResponse({ status: 200, description: '수정 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTemplateSetDto,
  ) {
    return this.templateSetsService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '템플릿셋 삭제 (소프트 삭제)' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async remove(@Param('id') id: string) {
    return this.templateSetsService.remove(id);
  }

  @Post(':id/copy')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋 복제' })
  @ApiResponse({ status: 201, description: '복제 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async copy(@Param('id') id: string) {
    return this.templateSetsService.copy(id);
  }

  @Put(':id/templates')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿 구성 일괄 수정' })
  @ApiResponse({ status: 200, description: '수정 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async updateTemplates(
    @Param('id') id: string,
    @Body() dto: ReorderTemplatesDto,
  ) {
    return this.templateSetsService.reorderTemplates(id, dto);
  }

  @Get(':id/products')
  @ApiBearerAuth()
  @ApiOperation({ summary: '연결된 상품 목록 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  async getProducts(@Param('id') id: string) {
    return this.templateSetsService.getProducts(id);
  }

  @Post(':id/templates')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿셋에 템플릿 추가' })
  @ApiResponse({ status: 201, description: '추가 성공' })
  @ApiResponse({ status: 400, description: '판형 불일치' })
  @ApiResponse({ status: 404, description: '템플릿셋/템플릿 없음' })
  async addTemplate(
    @Param('id') id: string,
    @Body() dto: AddTemplateDto,
  ) {
    return this.templateSetsService.addTemplate(id, dto);
  }

  @Delete(':id/templates/:templateId')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '템플릿셋에서 템플릿 제거' })
  @ApiResponse({ status: 200, description: '제거 성공' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async removeTemplate(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
  ) {
    return this.templateSetsService.removeTemplate(id, templateId);
  }

  @Put(':id/templates/reorder')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiBearerAuth()
  @ApiOperation({ summary: '템플릿 순서 변경' })
  @ApiResponse({ status: 200, description: '순서 변경 성공' })
  @ApiResponse({ status: 400, description: '템플릿 목록 불일치' })
  @ApiResponse({ status: 404, description: '템플릿셋 없음' })
  async reorderTemplates(
    @Param('id') id: string,
    @Body() dto: ReorderTemplatesDto,
  ) {
    return this.templateSetsService.reorderTemplates(id, dto);
  }

  @Post('admin/update-thumbnails')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: '모든 템플릿셋의 썸네일 일괄 업데이트' })
  @ApiResponse({ status: 200, description: '업데이트 성공' })
  async updateAllThumbnails() {
    return this.templateSetsService.updateAllThumbnails();
  }
}
