import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OperatorsService } from './operators.service';
import {
  CreateOperatorDto,
  AddAssignmentDto,
  ResetOperatorPasswordDto,
} from './dto/operator.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { UserRole } from '@storige/types';

/**
 * /api/operators — 전역 admin(ADMIN/SUPER_ADMIN) 전용. 사이트 운영자(SITE_ADMIN/SITE_MANAGER)
 * 계정 생성·site 배정·비번 리셋·삭제(= user_site_roles 쓰기 유일 경로).
 * ⚠️ @Roles(ADMIN) → SITE_ADMIN/SITE_MANAGER 는 RolesGuard 평면매칭 실패로 403(권한상승 차단).
 *    SUPER_ADMIN 은 RolesGuard 가 무조건 통과.
 */
@ApiTags('Operators')
@ApiBearerAuth()
@Controller('operators')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OperatorsController {
  constructor(private readonly operatorsService: OperatorsService) {}

  @Get()
  @ApiOperation({ summary: '운영자 목록 (옵션 ?siteId 필터)' })
  async list(@Query('siteId') siteId?: string) {
    const items = await this.operatorsService.list(siteId);
    return { success: true, data: { items, total: items.length } };
  }

  @Post()
  @ApiOperation({ summary: '운영자 생성 (계정 + 첫 site 배정)' })
  async create(@Body() dto: CreateOperatorDto) {
    const operator = await this.operatorsService.create(dto);
    return { success: true, data: operator };
  }

  @Post(':userId/assignments')
  @ApiOperation({ summary: '운영자에 site 추가 배정' })
  async addAssignment(
    @Param('userId') userId: string,
    @Body() dto: AddAssignmentDto,
  ) {
    const operator = await this.operatorsService.addAssignment(userId, dto);
    return { success: true, data: operator };
  }

  @Delete(':userId/assignments/:siteId')
  @ApiOperation({ summary: '운영자 site 배정 회수' })
  async removeAssignment(
    @Param('userId') userId: string,
    @Param('siteId') siteId: string,
  ) {
    const operator = await this.operatorsService.removeAssignment(
      userId,
      siteId,
    );
    return { success: true, data: operator };
  }

  @Patch(':userId/password')
  @HttpCode(200)
  @ApiOperation({ summary: '운영자 비밀번호 리셋 (admin, 현재 비번 불요)' })
  async resetPassword(
    @Param('userId') userId: string,
    @Body() dto: ResetOperatorPasswordDto,
  ) {
    await this.operatorsService.resetPassword(userId, dto);
    return { success: true };
  }

  @Delete(':userId')
  @HttpCode(204)
  @ApiOperation({ summary: '운영자 삭제 (계정 + 배정 CASCADE)' })
  async remove(@Param('userId') userId: string): Promise<void> {
    await this.operatorsService.remove(userId);
  }
}
