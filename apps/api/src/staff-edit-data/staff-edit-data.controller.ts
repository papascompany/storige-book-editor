import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { UserRole } from '@storige/types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StaffEditDataService } from './staff-edit-data.service';
import {
  ListStaffSessionsQueryDto,
  StaffAuditQueryDto,
  StaffEditorSessionDto,
  StaffRetentionReportQueryDto,
  StaffSessionFileKind,
  StaffSynthesizeDto,
} from './dto/staff-edit-data.dto';

/**
 * /api/admin/edit-data — Storige 관리자 편집데이터 관리 (2026-09-29, ADDITIVE, 관리자 전용).
 *
 * admin JWT + 관리자 역할(ADMIN·MANAGER·SITE_ADMIN·SITE_MANAGER, SUPER_ADMIN 은 RolesGuard 통과)만.
 * 운영자 대리 편집 허용 표시가 없으므로 운영자 토큰은 전역 JwtAuthGuard 가 403 으로 거부하고,
 * shop-session 토큰(role 'customer')은 RolesGuard 가 403 으로 거부한다. 공개(@Public) 라우트 없음.
 * 사이트 범위·사이트별 역할은 서비스가 매 요청 DB(user_site_roles)에서 다시 확인한다.
 */
@ApiTags('Admin Edit Data')
@ApiBearerAuth()
@Controller('admin/edit-data')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.SITE_ADMIN, UserRole.SITE_MANAGER)
export class StaffEditDataController {
  constructor(private readonly service: StaffEditDataService) {}

  @Get('sessions')
  @ApiOperation({ summary: '편집 세션 목록(보관기한·편집 후 미완료·삭제 권한 포함)' })
  listSessions(@Query() query: ListStaffSessionsQueryDto, @CurrentUser() user: unknown) {
    return this.service.listSessions(user, query);
  }

  @Get('sessions/:id/jobs')
  @ApiOperation({ summary: '세션의 워커 잡 목록(최신 50건)' })
  listJobs(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: unknown) {
    return this.service.listJobs(user, id);
  }

  @Get('jobs/:jobId/output')
  @ApiOperation({ summary: '잡 산출물 PDF 다운로드(관리자 범위 확인)' })
  @ApiResponse({ status: 404, description: '잡 없음·범위 밖(동일 응답)' })
  async downloadJobOutput(
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Res() res: Response,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    await this.service.streamJobOutput(user, jobId, res);
  }

  @Get('sessions/:id/files/:kind')
  @ApiOperation({ summary: '세션 입력 파일 다운로드(cover | content | contentPdf — 세션 컬럼 기준)' })
  async downloadSessionFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('kind', new ParseEnumPipe(StaffSessionFileKind)) kind: StaffSessionFileKind,
    @Res() res: Response,
    @CurrentUser() user: unknown,
  ): Promise<void> {
    await this.service.streamSessionFile(user, id, kind, res);
  }

  @Post('sessions/:id/editor-session')
  @ApiOperation({ summary: '편집기 열기 — 세션 1건 전용 단기 편집 권한 발급(관리자 편집 직전 스냅샷 저장)' })
  openEditorSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffEditorSessionDto,
    @CurrentUser() user: unknown,
  ) {
    return this.service.openEditorSession(user, id, dto);
  }

  @Get('sessions/:id/grants')
  @ApiOperation({ summary: '세션의 관리자 발급 편집 권한 목록' })
  listGrants(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: unknown) {
    return this.service.listGrants(user, id);
  }

  @Post('grants/:grantId/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: '관리자 발급 편집 권한 회수(멱등)' })
  revokeGrant(@Param('grantId', ParseUUIDPipe) grantId: string, @CurrentUser() user: unknown) {
    return this.service.revokeGrant(user, grantId);
  }

  @Post('sessions/:id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: '완료 처리(고객 완료와 같은 후속 처리)' })
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: unknown) {
    return this.service.complete(user, id);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: '삭제(소프트 삭제, 보관기간 만료 후에도 가능)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: unknown) {
    return this.service.remove(user, id);
  }

  @Post('sessions/:id/restore')
  @HttpCode(200)
  @ApiOperation({ summary: '삭제된 세션 복구(멱등)' })
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: unknown) {
    return this.service.restore(user, id);
  }

  @Post('sessions/:id/synthesize')
  @ApiOperation({ summary: '합성·재합성 — 항상 새 잡(이전 결과물 보존), 기본은 파트너 알림 없음' })
  synthesize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffSynthesizeDto,
    @CurrentUser() user: unknown,
  ) {
    return this.service.synthesize(user, id, dto);
  }

  @Get('retention-report')
  @ApiOperation({ summary: '편집데이터 보관기간 보고서(읽기 전용, 자동삭제 없음)' })
  retentionReport(@Query() query: StaffRetentionReportQueryDto, @CurrentUser() user: unknown) {
    return this.service.retentionReport(user, query);
  }

  @Get('audit')
  @ApiOperation({ summary: '관리자 작업 감사 기록(origin staff)' })
  audit(@Query() query: StaffAuditQueryDto, @CurrentUser() user: unknown) {
    return this.service.audit(user, query);
  }
}
