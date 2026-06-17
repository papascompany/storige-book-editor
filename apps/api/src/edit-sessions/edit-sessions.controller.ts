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
import { ImpositionPreviewResponseDto } from './dto/imposition-preview.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../auth/guards/api-key.guard';
import {
  CurrentSite,
  CurrentSitePayload,
} from '../auth/decorators/current-site.decorator';
import { PayloadTooLargeResponseDto } from '../common/dto/error-response.dto';
import { SpreadStartSide } from '../worker-jobs/imposition.util';

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

    // Phase C-2 — JWT의 siteId 자동 주입 (없으면 NULL — 기존 호환)
    // 고객아이디 스냅샷 (2026-06-11): shop-session JWT 의 memberId(email)/memberName 을
    // metadata.member 로 자동 기록 — admin 세션/삭제 리스트에서 "고객아이디"를 사람이 읽을 수
    // 있게 노출하기 위함 (member_seqno 는 UUID 해시라 식별 불가). 클라이언트 변경 불필요.
    const memberSnapshot =
      user?.source === 'shop' && (user?.email || user?.name)
        ? { member: { memberId: user.email ?? null, memberName: user.name ?? null } }
        : {};
    const session = await this.editSessionsService.create({
      ...dto,
      memberSeqno,
      siteId: user?.siteId,
      metadata: { ...(dto.metadata || {}), ...memberSnapshot },
    });

    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 게스트(비로그인) 편집 세션 생성 — 인쇄 워크플로우 v1 Phase 4 (2026-05-19).
   *
   * 결정 3-1: guestToken (uuid) + guestExpiresAt (NOW + 24h) 자동 발급.
   *           EVENT evt_purge_expired_guest_sessions 가 1h 주기로 만료 세션 DELETE.
   * 결정 3-6: 회원 전환은 저장(편집완료) 시점에만. 본 endpoint 는 발급만.
   *
   * 클라이언트는 응답의 guestToken 을 sessionStorage 에 저장하고,
   * 이후 PATCH /edit-sessions/guest/:id 호출 시 X-Guest-Token 헤더로 전송.
   */
  @Post('guest')
  @Public()
  @ApiOperation({ summary: '게스트 편집 세션 생성 (Phase 4)' })
  @ApiResponse({ status: 201, description: '세션 생성 성공', type: EditSessionResponseDto })
  async createGuest(
    @Body() dto: CreateEditSessionDto,
  ): Promise<EditSessionResponseDto> {
    const session = await this.editSessionsService.create({
      ...dto,
      asGuest: true,
      memberSeqno: 0,
      orderSeqno: dto.orderSeqno ?? 0,
    });
    // guestToken 은 응답 DTO 에 그대로 노출됨 (클라이언트가 보관)
    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 게스트 세션 업데이트 (canvasData / contentPdf*) — 인쇄 워크플로우 v1 Phase 4.
   *
   * X-Guest-Token 헤더로 본인 세션임을 증명한 후 update 호출.
   * userId=0 으로 service 호출 → service 가 isGuest 분기로 통과.
   */
  @Patch('guest/:id')
  @Public()
  @ApiOperation({ summary: '게스트 세션 업데이트 (Phase 4)' })
  @ApiResponse({ status: 200, description: '세션 업데이트 성공', type: EditSessionResponseDto })
  @ApiResponse({ status: 403, description: '게스트 토큰 불일치 또는 만료' })
  async updateGuest(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEditSessionDto,
    @Query('guestToken') guestTokenQuery?: string,
  ): Promise<EditSessionResponseDto> {
    // X-Guest-Token 헤더가 안 되는 환경(예: 일부 CORS)을 위해 쿼리도 허용.
    // 실제로는 클라이언트 fetch 가 header 로 전송 — 컨트롤러에서 @Req() 로 받음.
    const session = await this.editSessionsService.findById(id);
    if (!session.guestToken) {
      throw new ForbiddenException({ code: 'NOT_A_GUEST_SESSION', message: '게스트 세션이 아닙니다.' });
    }
    if (session.guestExpiresAt && session.guestExpiresAt < new Date()) {
      throw new ForbiddenException({ code: 'GUEST_SESSION_EXPIRED', message: '게스트 세션이 만료되었습니다 (24h).' });
    }
    if (guestTokenQuery && guestTokenQuery !== session.guestToken) {
      throw new ForbiddenException({ code: 'GUEST_TOKEN_MISMATCH', message: '게스트 토큰이 일치하지 않습니다.' });
    }
    // userId=0 (게스트) — service 가 isGuest 로 권한 검사 우회
    const updated = await this.editSessionsService.update(id, dto, 0);
    return this.editSessionsService.toResponseDto(updated);
  }

  /**
   * 게스트 세션 → 회원 마이그레이션 — 인쇄 워크플로우 v1 Phase 6-B (2026-05-19).
   *
   * 결정 3-6: 저장(편집완료) 시점의 로그인 직후 호출. 본인 인증된 상태에서만 흡수.
   *
   * Body: { guestToken: string }
   * Response: { migratedCount, sessionIds[] }
   */
  @Post('guest/migrate')
  @ApiOperation({ summary: '게스트 세션을 회원 세션으로 마이그레이션 (Phase 6)' })
  @ApiResponse({ status: 200, description: '마이그레이션 결과' })
  async migrateGuestToMember(
    @Body() body: { guestToken?: string },
    @CurrentUser() user: any,
  ): Promise<{ migratedCount: number; sessionIds: string[] }> {
    if (!user?.userId) {
      throw new ForbiddenException({
        code: 'AUTH_REQUIRED',
        message: '회원 마이그레이션은 로그인 사용자만 가능합니다.',
      });
    }
    if (!body?.guestToken || body.guestToken.length < 8) {
      throw new BadRequestException({
        code: 'GUEST_TOKEN_REQUIRED',
        message: 'guestToken 이 필요합니다.',
      });
    }
    const memberSeqno = parseInt(user.userId);
    return this.editSessionsService.migrateGuestSessions(body.guestToken, memberSeqno);
  }

  /**
   * 내 세션 목록 — 인쇄 워크플로우 v1 Phase 6-C (2026-05-19).
   *
   * 로그인 사용자 본인의 최근 세션 200건. /my-works UI 가 사용.
   *
   * summary 경량 모드 (2026-06-11) — bookmoa-mobile '편집보관함' 목록용:
   *  - ?summary=1|true 시 canvasData 제외 + templateSetName/thumbnailUrl 추가.
   *  - 개별 @Query 원시(string) 파라미터라 전역 ValidationPipe(whitelist/
   *    forbidNonWhitelisted)의 DTO 화이트리스트 검사 대상이 아님 →
   *    기존 무파라미터 호출(bookmoa/editor /my-works)과 100% 호환.
   */
  @Get('my')
  @ApiOperation({ summary: '내 편집 세션 목록 (Phase 6)' })
  @ApiQuery({
    name: 'summary',
    required: false,
    description:
      "'1'|'true' 시 경량 모드 — canvasData 제외, templateSetName/thumbnailUrl 추가 (편집보관함용)",
  })
  @ApiResponse({ status: 200, description: '세션 목록', type: EditSessionListResponseDto })
  async findMy(
    @CurrentUser() user: any,
    @Query('summary') summary?: string,
  ): Promise<EditSessionListResponseDto> {
    if (!user?.userId) {
      throw new ForbiddenException({
        code: 'AUTH_REQUIRED',
        message: '로그인이 필요합니다.',
      });
    }
    const memberSeqno = parseInt(user.userId);

    // 경량(summary) 모드 — canvasData 미포함 목록 (편집보관함)
    if (summary === '1' || summary === 'true') {
      const sessions = await this.editSessionsService.findMyRecentSummary(memberSeqno);
      return { sessions, total: sessions.length };
    }

    // 기본 모드 — 현행 응답 불변 (canvasData 전문 포함)
    const sessions = await this.editSessionsService.findMyRecent(memberSeqno);
    return {
      sessions: sessions.map((s) => this.editSessionsService.toResponseDto(s)),
      total: sessions.length,
    };
  }

  /**
   * 삭제된 세션 목록 — admin '삭제 리스트' 메뉴 (2026-06-11).
   * 고객이 보관함/장바구니에서 삭제한 세션(soft delete)을 누적 조회.
   * ⚠️ 라우트 순서: @Get(':id') 보다 먼저 선언해야 'deleted' 가 :id 로 캡처되지 않는다.
   */
  @Get('deleted')
  @ApiOperation({ summary: '삭제된 편집 세션 목록 (admin 전용)' })
  @ApiQuery({ name: 'memberSeqno', required: false, description: '회원 번호 필터' })
  @ApiQuery({ name: 'orderSeqno', required: false, description: '주문 번호 필터' })
  @ApiQuery({ name: 'siteId', required: false, description: '사이트 ID 필터' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 (기본 1)' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지 크기 (기본 20, 최대 100)' })
  @ApiResponse({ status: 200, description: '삭제된 세션 목록', type: EditSessionListResponseDto })
  @ApiResponse({ status: 403, description: 'admin/manager 아님' })
  async findDeleted(
    @CurrentUser() user: any,
    @Query('memberSeqno') memberSeqno?: string,
    @Query('orderSeqno') orderSeqno?: string,
    @Query('siteId') siteId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ): Promise<EditSessionListResponseDto> {
    this.assertStaff(user);
    return this.editSessionsService.findDeleted({
      memberSeqno: memberSeqno ? parseInt(memberSeqno) : undefined,
      orderSeqno: orderSeqno ? parseInt(orderSeqno) : undefined,
      siteId: siteId || undefined,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
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
    @CurrentSite() site?: CurrentSitePayload,
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

    const data = await this.editSessionsService.findByOrderExternal(
      parsed,
      site?.siteId,
    );
    return { success: true, data };
  }

  /**
   * 고객 첨부 내지 PDF "리더 스프레드" 임포지션 미리보기 — 외부 API Key 인증 (2026-06-16).
   *
   * bookmoa-mobile 등 외부 호출자가 "이 내지 PDF가 책으로 묶이면 펼침면이
   * 이렇게 보입니다"를 그리기 위한 표시용 데이터를 조회한다.
   *
   * ⚠️ 부수효과 없는 순수 조회 — 재렌더/잡 생성 안 함(GET).
   *   썸네일(metadata.contentPdfGuide)이 있으면 그 URL/해상도를 재사용하고,
   *   없으면 ready:false + reason 으로 알린다(layout 은 페이지 수만 알면 채움).
   *
   * 인증: X-API-Key 헤더(GET /edit-sessions/external 과 동일한 ApiKeyGuard).
   * 라우트 순서: 반드시 @Get(':id') 보다 먼저 선언(NestJS 파라미터 세그먼트 매칭 안전).
   */
  @Get(':id/imposition-preview')
  @Public()
  @UseGuards(ApiKeyGuard)
  @ApiSecurity('api-key')
  @ApiOperation({
    summary: '내지 PDF 리더 스프레드 임포지션 미리보기 (외부 API Key 인증)',
    description: `세션 ID로 고객 첨부 내지 PDF의 "리더 스프레드"(완성본 펼침면) 레이아웃을 조회합니다.

**인증**: X-API-Key 헤더 필수

**동작**:
- metadata.contentPdfGuide 가 있으면 pageImageUrls/resolution 재사용(재렌더 안 함, ready:true)
- 없으면 ready:false + reason('썸네일 미생성: 업로드/렌더 대기'), pageImageUrls:[] / resolution:null
- layout 은 totalPages(썸네일 수 ?? metadata.pages ?? 0)만 알면 항상 채움

⚠️ 리더 스프레드(읽는 순서 펼침면) 계산이며 인쇄 면付(printer-spread)이 아닙니다.`,
  })
  @ApiQuery({
    name: 'startSide',
    required: false,
    enum: ['left', 'right'],
    description: "펼침 시작 면 ('right'=우수 기본, 'left'=좌수)",
  })
  @ApiQuery({
    name: 'binding',
    required: false,
    description: "제본 방식 override (예: 'saddle', 'perfect'). 미지정 시 세션 metadata.binding",
  })
  @ApiResponse({
    status: 200,
    description: '임포지션 미리보기',
    type: ImpositionPreviewResponseDto,
  })
  @ApiResponse({ status: 401, description: 'API Key 누락 또는 유효하지 않음' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async getImpositionPreviewExternal(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('startSide') startSide?: string,
    @Query('binding') binding?: string,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<ImpositionPreviewResponseDto> {
    // startSide 정규화 — 'left' 만 좌수, 그 외(미지정/오타 포함)는 기본 우수('right')
    const normalizedStartSide: SpreadStartSide =
      startSide === 'left' ? 'left' : 'right';
    return this.editSessionsService.getImpositionPreview(
      id,
      normalizedStartSide,
      binding || undefined,
      site?.siteId,
    );
  }

  /**
   * 주문 번호로 세션 목록 조회
   */
  @Get()
  @ApiOperation({ summary: '편집 세션 목록 조회' })
  @ApiQuery({ name: 'orderSeqno', required: false, description: '주문 번호' })
  @ApiQuery({ name: 'memberSeqno', required: false, description: '회원 번호' })
  @ApiQuery({ name: 'siteId', required: false, description: '사이트 ID (Phase C-3)' })
  @ApiResponse({
    status: 200,
    description: '세션 목록',
    type: EditSessionListResponseDto,
  })
  async findSessions(
    @Query('orderSeqno') orderSeqno?: string,
    @Query('memberSeqno') memberSeqno?: string,
    @Query('siteId') siteId?: string, // Phase C-3
    @CurrentUser() user?: any,
  ): Promise<EditSessionListResponseDto> {
    let sessions;

    if (orderSeqno) {
      sessions = await this.editSessionsService.findByOrderSeqno(
        parseInt(orderSeqno),
      );
    } else if (memberSeqno) {
      // IDOR 가드 (2026-06-11): admin/manager 가 아니면 memberSeqno 쿼리는
      // 본인(JWT user.userId == memberSeqno)일 때만 허용 — 임의 회원의 세션
      // (canvasData 포함)이 유출되는 표면 차단.
      //  - role 판정은 findOne(:id) 의 admin/manager 관례와 동일 (user.role).
      //  - 외부서버(nimda/PHP)는 X-API-Key 라우트(GET /edit-sessions/external,
      //    ApiKeyGuard)를 사용하므로 본 가드와 무관 — 영향 없음.
      //  - orderSeqno/siteId 분기는 현행 불변.
      const requestedSeqno = parseInt(memberSeqno);
      // ⚠️ UserRole enum 은 대문자('ADMIN' 등) — 소문자 비교는 admin 검색을 403 으로 막는
      // 회귀였음(2026-06-11 수정). 대소문자 무관 헬퍼 사용.
      const isStaff = this.isStaffRole(user);
      // userId 부재(예: 일반 admin-app User 엔티티) 시 NaN → 비교 항상 불일치(안전측)
      const selfSeqno = user?.userId ? parseInt(user.userId) : NaN;
      if (!isStaff && requestedSeqno !== selfSeqno) {
        throw new ForbiddenException({
          code: 'FORBIDDEN_MEMBER_QUERY',
          message: '다른 회원의 편집 세션은 조회할 수 없습니다.',
          details: { requestedMemberSeqno: requestedSeqno },
        });
      }
      sessions = await this.editSessionsService.findByMemberSeqno(requestedSeqno);
    } else if (siteId) {
      sessions = await this.editSessionsService.findBySiteId(siteId);
    } else if (user?.userId) {
      // 본인 세션만 조회
      sessions = await this.editSessionsService.findByMemberSeqno(
        parseInt(user.userId),
      );
    } else {
      sessions = [];
    }

    // siteId가 다른 필터와 함께 들어오면 사후 필터링
    if (siteId && (orderSeqno || memberSeqno)) {
      sessions = sessions.filter((s: any) => s.siteId === siteId);
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
    const isOwner = Number(session.memberSeqno) === userId;
    // UserRole enum 대문자 대응 — 대소문자 무관 판정 (2026-06-11)
    const isStaff = this.isStaffRole(user);

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

  /**
   * 삭제된 세션 복구 — admin '삭제 리스트' 메뉴 (2026-06-11).
   * 고객이 실수로 삭제한 작업을 운영자가 복원한다 (deleted_at 해제 — 파일은 softDelete 가
   * 건드리지 않으므로 보관함/불러오기 모달에 즉시 재노출). 멱등 — 이미 활성이면 그대로 성공.
   */
  @Post(':id/restore')
  @ApiOperation({ summary: '삭제된 편집 세션 복구 (admin 전용)' })
  @ApiResponse({ status: 200, description: '복구 성공', type: EditSessionResponseDto })
  @ApiResponse({ status: 403, description: 'admin/manager 아님' })
  @ApiResponse({ status: 404, description: '세션을 찾을 수 없음' })
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<EditSessionResponseDto> {
    this.assertStaff(user);
    const session = await this.editSessionsService.restoreSession(id);
    return this.editSessionsService.toResponseDto(session);
  }

  /**
   * 운영자(staff) 역할 판정 — admin-app JWT(User 엔티티, UserRole enum = 'ADMIN'/'MANAGER'/
   * 'SUPER_ADMIN' **대문자**)와 shop-session JWT(role='customer' 소문자)를 모두 포괄하도록
   * 대소문자 무관 비교. (기존 소문자 비교는 admin JWT 를 staff 로 인식하지 못하던 결함 —
   * 2026-06-11 삭제 리스트 라이브 검증에서 발견·수정.)
   */
  private isStaffRole(user: any): boolean {
    const role = String(user?.role || '').toLowerCase();
    return role === 'admin' || role === 'manager' || role === 'super_admin';
  }

  /** admin/manager 전용 가드 (삭제 리스트/복구) */
  private assertStaff(user: any): void {
    if (!this.isStaffRole(user)) {
      throw new ForbiddenException({
        code: 'ADMIN_ONLY',
        message: '관리자만 사용할 수 있는 기능입니다.',
      });
    }
  }
}
