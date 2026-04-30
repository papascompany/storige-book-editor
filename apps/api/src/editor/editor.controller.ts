import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { EditorService } from './editor.service';
import {
  CreateEditSessionDto,
  UpdateEditSessionDto,
  ExportPdfDto,
  AutoSaveDto,
  AddPageDto,
  ReorderPagesDto,
  ReplaceTemplateDto,
  ReplaceTemplateSetDto,
  ChangeStatusDto,
  AcquireLockDto,
  SessionQueryDto,
} from './dto/edit-session.dto';
import { EditSession, EditHistory } from './entities/edit-session.entity';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '@storige/types';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('Editor')
@ApiBearerAuth()
@Controller('editor')
export class EditorController {
  constructor(private readonly editorService: EditorService) {}

  // ============================================================================
  // Edit Session Management
  // ============================================================================

  @Post('sessions')
  @Public()
  @ApiOperation({ summary: '편집 세션 생성 (템플릿셋 기반)' })
  @ApiResponse({ status: 201, description: '세션 생성 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '템플릿셋을 찾을 수 없음' })
  async createSession(
    @Body() dto: CreateEditSessionDto,
  ): Promise<EditSession> {
    return this.editorService.createSession(dto);
  }

  @Get('sessions')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: '편집 세션 목록 조회' })
  @ApiResponse({ status: 200, description: '세션 목록' })
  async findAllSessions(@Query() query: SessionQueryDto) {
    return this.editorService.findAll(query);
  }

  @Get('sessions/:id')
  @Public()
  @ApiOperation({ summary: '편집 세션 상세 조회' })
  @ApiResponse({ status: 200, description: '세션 상세', type: EditSession })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async findOneSession(@Param('id') id: string): Promise<EditSession> {
    return this.editorService.findOne(id);
  }

  @Put('sessions/:id')
  @Public()
  @ApiOperation({ summary: '편집 세션 업데이트' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '업데이트 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateEditSessionDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.updateSession(id, dto, userId);
  }

  @Delete('sessions/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '편집 세션 삭제' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async deleteSession(@Param('id') id: string): Promise<{ message: string }> {
    await this.editorService.deleteSession(id);
    return { message: '세션이 삭제되었습니다.' };
  }

  // ============================================================================
  // Auto-save
  // ============================================================================

  @Post('sessions/:id/auto-save')
  @Public()
  @ApiOperation({ summary: '자동 저장 (주기적으로 호출됨)' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '저장 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async autoSave(
    @Param('id') id: string,
    @Body() dto: AutoSaveDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.autoSave(id, dto, userId);
  }

  // ============================================================================
  // BB-Phase 3 ─ 자동저장 시점 versions (HistoryPanel 시점 list + 복원)
  // ============================================================================

  @Get('sessions/:id/versions')
  @Public()
  @ApiOperation({ summary: '자동저장 시점 list (메타만)' })
  @ApiHeader({ name: 'X-User-Id', required: false })
  @ApiResponse({ status: 200, description: '시점 list (savedAt DESC)' })
  async listVersions(
    @Param('id') id: string,
    @Headers('X-User-Id') userId?: string,
  ) {
    return this.editorService.listVersions(id, userId);
  }

  @Get('sessions/:id/versions/:vid')
  @Public()
  @ApiOperation({ summary: '특정 시점의 pages JSON 조회' })
  @ApiHeader({ name: 'X-User-Id', required: false })
  async getVersion(
    @Param('id') id: string,
    @Param('vid') vid: string,
    @Headers('X-User-Id') userId?: string,
  ) {
    return this.editorService.getVersion(id, vid, userId);
  }

  @Post('sessions/:id/versions/:vid/restore')
  @Public()
  @ApiOperation({ summary: '시점으로 복원 (현재 pages 교체)' })
  @ApiHeader({ name: 'X-User-Id', required: false })
  async restoreVersion(
    @Param('id') id: string,
    @Param('vid') vid: string,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.restoreVersion(id, vid, userId);
  }

  // ============================================================================
  // Page Management
  // ============================================================================

  @Post('sessions/:id/pages')
  @Public()
  @ApiOperation({ summary: '페이지 추가' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 201, description: '페이지 추가 성공', type: EditSession })
  @ApiResponse({ status: 400, description: '페이지 추가 불가' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async addPage(
    @Param('id') id: string,
    @Body() dto: AddPageDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.addPage(id, dto, userId);
  }

  @Delete('sessions/:id/pages/:pageId')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '페이지 삭제' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '페이지 삭제 성공', type: EditSession })
  @ApiResponse({ status: 400, description: '페이지 삭제 불가' })
  @ApiResponse({ status: 404, description: '세션 또는 페이지를 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async deletePage(
    @Param('id') id: string,
    @Param('pageId') pageId: string,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.deletePage(id, pageId, userId);
  }

  @Put('sessions/:id/pages/reorder')
  @Public()
  @ApiOperation({ summary: '페이지 순서 변경' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '순서 변경 성공', type: EditSession })
  @ApiResponse({ status: 400, description: '순서 변경 불가' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async reorderPages(
    @Param('id') id: string,
    @Body() dto: ReorderPagesDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.reorderPages(id, dto, userId);
  }

  // ============================================================================
  // Template Replacement
  // ============================================================================

  @Put('sessions/:id/template')
  @Public()
  @ApiOperation({ summary: '템플릿 교체 (사용자 요소 보존)' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '템플릿 교체 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션 또는 템플릿을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async replaceTemplate(
    @Param('id') id: string,
    @Body() dto: ReplaceTemplateDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.replaceTemplate(id, dto, userId);
  }

  @Put('sessions/:id/template-set')
  @Public()
  @ApiOperation({ summary: '템플릿셋 교체 (사용자 요소 보존)' })
  @ApiHeader({ name: 'X-User-Id', required: false, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '템플릿셋 교체 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션 또는 템플릿셋을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 편집 중' })
  async replaceTemplateSet(
    @Param('id') id: string,
    @Body() dto: ReplaceTemplateSetDto,
    @Headers('X-User-Id') userId?: string,
  ): Promise<EditSession> {
    return this.editorService.replaceTemplateSet(id, dto, userId);
  }

  // ============================================================================
  // Validation
  // ============================================================================

  @Get('sessions/:id/validate')
  @Public()
  @ApiOperation({ summary: '세션 검증 (내지 수량, 필수 페이지 확인)' })
  @ApiResponse({
    status: 200,
    description: '검증 결과',
    schema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean' },
        errors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
        warnings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async validateSession(@Param('id') id: string): Promise<{
    valid: boolean;
    errors: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  }> {
    return this.editorService.validateSession(id);
  }

  // ============================================================================
  // Edit Locking
  // ============================================================================

  @Post('sessions/:id/lock')
  @Public()
  @ApiOperation({ summary: '편집 잠금 획득' })
  @ApiResponse({ status: 200, description: '잠금 획득 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({ status: 409, description: '다른 사용자가 이미 편집 중' })
  async acquireLock(
    @Param('id') id: string,
    @Body() dto: AcquireLockDto,
  ): Promise<EditSession> {
    return this.editorService.acquireLock(id, dto);
  }

  @Delete('sessions/:id/lock')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '편집 잠금 해제' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '잠금 해제 성공', type: EditSession })
  @ApiResponse({ status: 400, description: '잠금 해제 권한 없음' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async releaseLock(
    @Param('id') id: string,
    @Headers('X-User-Id') userId: string,
  ): Promise<EditSession> {
    return this.editorService.releaseLock(id, userId);
  }

  // ============================================================================
  // Status Management
  // ============================================================================

  @Put('sessions/:id/status')
  @Public()
  @ApiOperation({ summary: '편집 상태 변경' })
  @ApiHeader({ name: 'X-User-Id', required: true, description: '사용자 ID' })
  @ApiResponse({ status: 200, description: '상태 변경 성공', type: EditSession })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @Headers('X-User-Id') userId: string,
  ): Promise<EditSession> {
    return this.editorService.changeStatus(id, dto, userId);
  }

  // ============================================================================
  // History
  // ============================================================================

  @Get('sessions/:id/history')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: '편집 이력 조회' })
  @ApiResponse({ status: 200, description: '이력 목록', type: [EditHistory] })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async getHistory(@Param('id') id: string): Promise<EditHistory[]> {
    return this.editorService.getHistory(id);
  }

  // ============================================================================
  // Export
  // ============================================================================

  @Post('export')
  @Public()
  @ApiOperation({ summary: 'PDF 내보내기 (worker 합성 잡 발행)' })
  @ApiResponse({
    status: 200,
    description: '내보내기 작업 생성됨',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 400, description: '표지/내지 파일 누락 (편집 완료 필요)' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async exportToPdf(
    @Body() dto: ExportPdfDto,
  ): Promise<{ jobId: string; status: string }> {
    return this.editorService.exportToPdf(dto.sessionId, dto.exportOptions);
  }
}
