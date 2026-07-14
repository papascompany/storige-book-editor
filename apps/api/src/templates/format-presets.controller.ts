import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FormatPresetsService } from './format-presets.service';
import {
  CreateFormatPresetDto,
  UpdateFormatPresetDto,
} from './dto/format-preset.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';

/**
 * /api/format-presets — 판형 프리셋 (admin 저작 도구용).
 *
 * - 인증: 전역 JwtAuthGuard(APP_GUARD) 기본. @Public 없음 — 외부/비인증 노출 금지.
 * - 쓰기(POST/PATCH)는 ADMIN/MANAGER 만. DELETE 라우트 없음(is_active 소프트 토글만).
 * - 응답 봉투: { success, data } (operators/sites 신형 계약 미러 —
 *   admin 클라이언트 apps/admin/src/api/formatPresets.ts 와 페어).
 */
@ApiTags('FormatPresets')
@ApiBearerAuth()
@Controller('format-presets')
export class FormatPresetsController {
  constructor(private readonly formatPresetsService: FormatPresetsService) {}

  @Get()
  @ApiOperation({ summary: '판형 프리셋 목록 (sort_order ASC, 기본 전체)' })
  @ApiQuery({ name: 'isActive', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 200, description: '목록 조회 성공' })
  async list(@Query('isActive') isActive?: string) {
    const items = await this.formatPresetsService.list(
      isActive === undefined ? undefined : isActive === 'true',
    );
    return { success: true, data: { items, total: items.length } };
  }

  @Get(':id')
  @ApiOperation({ summary: '판형 프리셋 상세' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '프리셋 없음' })
  async findOne(@Param('id') id: string) {
    const preset = await this.formatPresetsService.findOne(id);
    return { success: true, data: preset };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: '판형 프리셋 생성' })
  @ApiResponse({ status: 201, description: '생성 성공' })
  @ApiResponse({ status: 409, description: '코드 중복' })
  async create(@Body() dto: CreateFormatPresetDto) {
    const preset = await this.formatPresetsService.create(dto);
    return { success: true, data: preset };
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: '판형 프리셋 수정 (비활성화 = isActive 토글)' })
  @ApiResponse({ status: 200, description: '수정 성공' })
  @ApiResponse({ status: 404, description: '프리셋 없음' })
  @ApiResponse({ status: 409, description: '코드 중복' })
  async update(@Param('id') id: string, @Body() dto: UpdateFormatPresetDto) {
    const preset = await this.formatPresetsService.update(id, dto);
    return { success: true, data: preset };
  }
}
