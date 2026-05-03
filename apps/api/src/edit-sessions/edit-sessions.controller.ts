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
  ParseUUIDPipe,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
  ApiSecurity,
  ApiExtraModels,
  getSchemaPath,
} from '@nestjs/swagger';
import { EditSessionsService } from './edit-sessions.service';
import { CreateEditSessionDto } from './dto/create-edit-session.dto';
import { UpdateEditSessionDto } from './dto/update-edit-session.dto';
import {
  EditSessionResponseDto,
  EditSessionListResponseDto,
} from './dto/edit-session-response.dto';
import {
  ExternalSessionListResponseDto,
} from './dto/external-session-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import { PayloadTooLargeResponseDto } from '../common/dto/error-response.dto';

@ApiTags('Edit Sessions')
@ApiBearerAuth()
@ApiExtraModels(PayloadTooLargeResponseDto)
@Controller('edit-sessions')
export class EditSessionsController {
  constructor(private readonly editSessionsService: EditSessionsService) {}

  /**
   * 편집 세션 생성
   */
  @Post()
  @ApiOperation({ summary: '편집 세션 생성' })
  @ApiResponse({
    status: 201,
    description: '세션 생성 성공',
    type: EditSessionResponseDto,
  })
  @ApiResponse({ status: 400, description: '잘못된 요청' })
  @ApiResponse({
    status: 413,
    description: '요청 데이터 크기 초과',
    schema: { $ref: getSchemaPath(PayloadTooLargeResponseDto) },
  })
  async create(
    @Body() dto: CreateEditSessionDto,
    @CurrentUser() user: any,
  ): Promise<EditSessionResponseDto> {
    // JWT에서 memberSeqno 추출 (dto에 없으면)
    const memberSeqno = dto.memberSeqno || (user?.userId ? parseInt(user.userId) : undefined);

    if (!memberSeqno) {
      throw new BadRequestException({
        code: 'MEMBER_REQUIRED',
        message: '회원 정보가 필요합니다.',
      });
    }

    // Patch D (2026-05-03): JWT에 allowedOrderSeqnos가 있으면 dto.orderSeqno 검증
    // 없으면 (호환 모드) 기존 동작 유지 — DTO 값 신뢰
    if (
      Array.isArray(user?.allowedOrderSeqnos) &&
      user.allowedOrderSeqnos.length > 0 &&
      !user.allowedOrderSeqnos.includes(Number(dto.orderSeqno))
    ) {
      throw new ForbiddenException({
        code: 'ORDER_NOT_ALLOWED',
        message: `이 토큰은 주문 ${dto.orderSeqno}에 대한 작업 권한이 없습니다.`,
        details: { allowedOrderSeqnos: user.allowedOrderSeqnos, requestedOrderSeqno: dto.orderSeqno },
      });
    }

    const session = await this.editSessionsService.create({
      ...dto,
      memberSeqno,
    });

    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 외부 시스템용 주문별 편집세션 + PDF 파일 조회 (API Key 인증)
   */
  @Get('external')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: '주문별 편집세션 + PDF 파일 조회 (외부 API Key 인증)',
    description: `nimda 등 외부 시스템에서 주문번호로 편집세션과 PDF 파일 URL을 조회합니다.

**인증**: X-API-Key 헤더 필수

**파일 URL 우선순위**:
- cover/content: 워커 출력 > 에디터 원본 fallback
- merged: 워커 출력만 (에디터 원본 없음)

**운영 경로 예시**:
- API 호출: GET http://58.229.105.98:4000/api/edit-sessions/external?orderSeqno=12345
- 파일 다운로드: http://58.229.105.98:4000{files.cover 값}
  예: http://58.229.105.98:4000/storage/outputs/job-uuid/merged.pdf`,
  })
  @ApiQuery({ name: 'orderSeqno', required: true, description: '주문 번호', type: Number })
  @ApiResponse({
    status: 200,
    description: '세션 + 파일 목록',
    type: ExternalSessionListResponseDto,
  })
  @ApiResponse({ status: 400, description: 'orderSeqno 누락 또는 비숫자' })
  @ApiResponse({ status: 401, description: 'API Key 누락 또는 유효하지 않음' })
  async findByOrderExternal(
    @Query('orderSeqno') orderSeqno?: string,
  ): Promise<ExternalSessionListResponseDto> {
    if (!orderSeqno) {
      throw new BadRequestException({
        code: 'ORDER_SEQNO_REQUIRED',
        message: 'orderSeqno 파라미터가 필요합니다.',
      });
    }

    const parsed = parseInt(orderSeqno, 10);
    if (isNaN(parsed)) {
      throw new BadRequestException({
        code: 'INVALID_ORDER_SEQNO',
        message: 'orderSeqno는 숫자여야 합니다.',
      });
    }

    const data = await this.editSessionsService.findByOrderExternal(parsed);
    return { success: true, data };
  }

  /**
   * 주문 번호로 세션 목록 조회
   */
  @Get()
  @ApiOperation({ summary: '편집 세션 목록 조회' })
  @ApiQuery({ name: 'orderSeqno', required: false, description: '주문 번호' })
  @ApiQuery({ name: 'memberSeqno', required: false, description: '회원 번호' })
  @ApiResponse({
    status: 200,
    description: '세션 목록',
    type: EditSessionListResponseDto,
  })
  async findSessions(
    @Query('orderSeqno') orderSeqno?: string,
    @Query('memberSeqno') memberSeqno?: string,
    @CurrentUser() user?: any,
  ): Promise<EditSessionListResponseDto> {
    let sessions;

    if (orderSeqno) {
      sessions = await this.editSessionsService.findByOrderSeqno(
        parseInt(orderSeqno),
      );
    } else if (memberSeqno) {
      sessions = await this.editSessionsService.findByMemberSeqno(
        parseInt(memberSeqno),
      );
    } else if (user?.userId) {
      // 본인 세션만 조회
      sessions = await this.editSessionsService.findByMemberSeqno(
        parseInt(user.userId),
      );
    } else {
      sessions = [];
    }

    return {
      sessions: sessions.map((s) => this.editSessionsService.toResponseDto(s)),
      total: sessions.length,
    };
  }

  /**
   * 세션 상세 조회 (소유자 또는 admin/manager만)
   */
  @Get(':id')
  @ApiOperation({ summary: '편집 세션 상세 조회 — 소유자 또는 관리자만 접근 가능' })
  @ApiResponse({
    status: 200,
    description: '세션 상세 정보',
    type: EditSessionResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음 (다른 사용자의 세션)' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<EditSessionResponseDto> {
    const session = await this.editSessionsService.findById(id);

    // 권한 확인: 세션 소유자 (memberSeqno 일치) 또는 admin/manager 역할
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const userRole = user?.role || '';
    const isOwner = Number(session.memberSeqno) === userId;
    const isStaff = userRole === 'admin' || userRole === 'manager';

    if (!isOwner && !isStaff) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: '이 세션에 접근할 권한이 없습니다.',
      });
    }

    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 세션 업데이트
   */
  @Patch(':id')
  @ApiOperation({ summary: '편집 세션 업데이트' })
  @ApiResponse({
    status: 200,
    description: '업데이트 성공',
    type: EditSessionResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  @ApiResponse({
    status: 413,
    description: '요청 데이터 크기 초과',
    schema: { $ref: getSchemaPath(PayloadTooLargeResponseDto) },
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEditSessionDto,
    @CurrentUser() user: any,
  ): Promise<EditSessionResponseDto> {
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const session = await this.editSessionsService.update(id, dto, userId);
    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 세션 완료 처리
   */
  @Patch(':id/complete')
  @ApiOperation({ summary: '편집 세션 완료 처리' })
  @ApiResponse({
    status: 200,
    description: '완료 처리 성공',
    type: EditSessionResponseDto,
  })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<EditSessionResponseDto> {
    const userId = user?.userId ? parseInt(user.userId) : 0;
    const session = await this.editSessionsService.complete(id, userId);
    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 세션 삭제
   */
  @Delete(':id')
  @ApiOperation({ summary: '편집 세션 삭제' })
  @ApiResponse({ status: 200, description: '삭제 성공' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<{ success: boolean }> {
    const userId = user?.userId ? parseInt(user.userId) : 0;
    await this.editSessionsService.delete(id, userId);
    return { success: true };
  }
}
