import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SitesService } from './sites.service';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@storige/types';

/**
 * /api/sites — admin 전용. 외부 사이트(테넌트) CRUD + 인증코드 발급/재발급.
 *
 * 본 컨트롤러는 PHP/외부 사이트가 호출하는 endpoint가 아님.
 * Storige 운영팀(ADMIN/MANAGER)이 admin UI에서만 사용.
 */
@ApiTags('Sites')
@ApiBearerAuth()
@Controller('sites')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Get()
  @ApiOperation({ summary: '사이트 목록' })
  async findAll() {
    const items = await this.sitesService.findAll();
    return { success: true, data: { items, total: items.length } };
  }

  @Get(':id')
  @ApiOperation({ summary: '사이트 상세' })
  async findOne(@Param('id') id: string) {
    const site = await this.sitesService.findOne(id);
    return { success: true, data: site };
  }

  @Post()
  @ApiOperation({ summary: '사이트 신규 등록 (인증코드 자동 생성 가능)' })
  async create(@Body() dto: CreateSiteDto) {
    const site = await this.sitesService.create(dto);
    return { success: true, data: site };
  }

  @Put(':id')
  @ApiOperation({ summary: '사이트 정보 수정' })
  async update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    const site = await this.sitesService.update(id, dto);
    return { success: true, data: site };
  }

  @Patch(':id/regenerate')
  @HttpCode(200)
  @ApiOperation({
    summary: '인증코드 재발급 (target=editor|worker|both)',
  })
  async regenerate(
    @Param('id') id: string,
    @Body() body: { target?: 'editor' | 'worker' | 'both' },
  ) {
    const site = await this.sitesService.regenerateAuthCodes(
      id,
      body.target ?? 'both',
    );
    return { success: true, data: site };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: '사이트 삭제 (영구)' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.sitesService.remove(id);
  }
}
