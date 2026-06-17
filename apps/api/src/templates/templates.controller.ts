import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery, ApiExtraModels, getSchemaPath } from '@nestjs/swagger';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto, UpdateTemplateDto } from './dto/template.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';
import { PayloadTooLargeResponseDto } from '../common/dto/error-response.dto';
import { CurrentScope } from '../auth/decorators/tenant-scope.decorator';
import { TenantScope } from '../common/helpers/tenant-scope.helper';

@ApiTags('Templates')
@ApiBearerAuth()
@ApiExtraModels(PayloadTooLargeResponseDto)
@Controller('templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Create a new template' })
  @ApiResponse({ status: 201, description: 'Template created successfully' })
  @ApiResponse({
    status: 413,
    description: '요청 데이터 크기 초과',
    schema: { $ref: getSchemaPath(PayloadTooLargeResponseDto) },
  })
  create(@Body() createTemplateDto: CreateTemplateDto, @CurrentUser() user?: User) {
    return this.templatesService.create(createTemplateDto, user?.id);
  }

  @Get()
  @ApiOperation({ summary: 'Get all templates' })
  @ApiQuery({ name: 'categoryId', required: false })
  @ApiQuery({ name: 'isActive', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Templates retrieved successfully' })
  findAll(
    @CurrentScope() scope: TenantScope,
    @Query('categoryId') categoryId?: string,
    @Query('isActive') isActive?: boolean,
  ) {
    return this.templatesService.findAll(categoryId, isActive, scope);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get template by ID' })
  @ApiResponse({ status: 200, description: 'Template found' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findOne(@Param('id') id: string) {
    return this.templatesService.findOne(id);
  }

  @Get('code/:editCode')
  @ApiOperation({ summary: 'Get template by edit code' })
  @ApiResponse({ status: 200, description: 'Template found' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  findByCode(@Param('editCode') editCode: string) {
    return this.templatesService.findByCode(editCode);
  }

  @Get('check-edit-code/:editCode')
  @ApiOperation({ summary: 'Check if edit code is already in use' })
  @ApiQuery({ name: 'excludeId', required: false, description: 'Template ID to exclude from check' })
  @ApiResponse({ status: 200, description: 'Returns whether the edit code exists' })
  async checkEditCode(
    @Param('editCode') editCode: string,
    @Query('excludeId') excludeId?: string,
  ) {
    const exists = await this.templatesService.checkEditCodeExists(editCode, excludeId);
    return { exists };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Update template' })
  @ApiResponse({ status: 200, description: 'Template updated successfully' })
  @ApiResponse({
    status: 413,
    description: '요청 데이터 크기 초과',
    schema: { $ref: getSchemaPath(PayloadTooLargeResponseDto) },
  })
  update(@Param('id') id: string, @Body() updateTemplateDto: UpdateTemplateDto) {
    return this.templatesService.update(id, updateTemplateDto);
  }

  @Get(':id/template-sets')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get template sets using this template' })
  @ApiResponse({ status: 200, description: 'List of template sets using this template' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  getTemplateSetsUsingTemplate(@Param('id') id: string) {
    return this.templatesService.getTemplateSetsUsingTemplate(id);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete template (soft delete)' })
  @ApiQuery({ name: 'force', required: false, type: Boolean, description: 'Force delete even if used in template sets' })
  @ApiResponse({
    status: 200,
    description: 'Template deleted successfully',
    schema: {
      type: 'object',
      properties: {
        affected: { type: 'number' },
        usedByTemplateSets: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Template is being used in template sets' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  remove(
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    return this.templatesService.remove(id, force === 'true');
  }

  @Post(':id/copy')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Copy template' })
  @ApiResponse({ status: 201, description: 'Template copied successfully' })
  copy(@Param('id') id: string, @CurrentUser() user?: User) {
    return this.templatesService.copy(id, user?.id);
  }
}
