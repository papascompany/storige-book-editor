import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  CreateShopSessionDto,
  ShopSessionResponseDto,
} from './dto/shop-session.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { CurrentSite, CurrentSitePayload } from './decorators/current-site.decorator';
import { ApiKeyGuard } from './guards/api-key.guard';
import { User } from './entities/user.entity';
import type { AuthTokens, UserRole } from '@storige/types';
import {
  CreatePartnerOperatorSessionDto,
  PartnerOperatorAuditQueryDto,
  PartnerOperatorAuditResponseDto,
  PartnerOperatorRevokeResponseDto,
  PartnerOperatorSessionResponseDto,
  RevokePartnerOperatorSessionDto,
} from './dto/partner-operator-session.dto';
import { PartnerOperatorAllowed } from './decorators/partner-operator-allowed.decorator';
import {
  PartnerOperatorGrantService,
  assertPartnerOperatorSiteCaller,
} from './partner-operator/partner-operator-grant.service';
import {
  PartnerOperatorCapability,
  PartnerOperatorUser,
  isPartnerOperatorUser,
} from './partner-operator/partner-operator.types';

interface UserResponse {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/** POST /auth/me — 운영자 대리 편집 토큰 응답(2026-09-29, ADDITIVE). role 은 편집기 표시용. */
interface PartnerOperatorMeResponse {
  userId: string;
  email: string;
  name: string;
  role: 'customer';
  source: 'partner_operator';
  siteId: string;
  siteName: string;
  operator: {
    id: string;
    name: string | null;
    grantId: string;
    grantExpiresAt: string;
    capabilities: PartnerOperatorCapability[];
  };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    // 운영자 대리 편집(2026-09-29) — 선택 인자: 기존 단위 테스트의 1-인자 생성을 깨지 않는다.
    private readonly partnerOperatorGrants?: PartnerOperatorGrantService,
  ) {}

  private grants(): PartnerOperatorGrantService {
    if (!this.partnerOperatorGrants) {
      throw new ServiceUnavailableException({
        code: 'PARTNER_OPERATOR_UNAVAILABLE',
        message: '운영자 권한 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
    return this.partnerOperatorGrants;
  }

  @Public()
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // SEC-4 brute-force 방어
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.login(loginDto);
    this.setAdminAuthCookies(res, tokens);
    return tokens;
  }

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // SEC-4 대량 계정 생성 방어
  @ApiOperation({ summary: 'User registration' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() registerDto: RegisterDto): Promise<UserResponse> {
    const user = await this.authService.register(registerDto);
    const { passwordHash, ...result } = user;
    return result as UserResponse;
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // SEC-4 토큰 무차별 대입 방어
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async refresh(
    @Body('refreshToken') refreshToken: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokens> {
    const tokens = await this.authService.refreshToken(refreshToken);
    this.setAdminAuthCookies(res, tokens);
    return tokens;
  }

  /**
   * AUTH-001 stage1(2026-06-23): admin(1st-party) httpOnly 쿠키 이원화.
   * ⚠️ 비파괴 — body 토큰(accessToken/refreshToken)은 그대로 반환하므로 기존 Bearer/localStorage
   * 흐름(admin 프론트)은 변경 없이 동작한다. 쿠키는 *추가* 발급일 뿐이며, 프론트가 쿠키 기반으로
   * 전환(withCredentials, localStorage 제거)하는 stage1b 이전까지는 미사용 상태로 둔다.
   * 쿠키 옵션은 shop-session(createShopSession)과 동일 — admin↔api 는 동일 site(서브도메인)라 sameSite=lax 로 전송됨.
   */
  private setAdminAuthCookies(res: Response, tokens: AuthTokens): void {
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('storige_access', tokens.accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api',
      maxAge: 3600 * 1000, // 1시간
    });
    if (tokens.refreshToken) {
      res.cookie('storige_refresh', tokens.refreshToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        path: '/api/auth',
        maxAge: 30 * 24 * 3600 * 1000, // 30일
      });
    }
  }

  @ApiBearerAuth()
  @Post('me')
  @PartnerOperatorAllowed()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user' })
  @ApiResponse({ status: 200, description: 'Current user retrieved' })
  async getMe(
    @CurrentUser() user: User | PartnerOperatorUser,
  ): Promise<UserResponse | PartnerOperatorMeResponse> {
    // 운영자 대리 편집 토큰(2026-09-29): 편집기 표시용 role 'customer' + source 'partner_operator'.
    // 서버 인가는 이 응답을 읽지 않는다.
    if (isPartnerOperatorUser(user)) {
      const grant = user.partnerOperator;
      return {
        userId: user.userId,
        email: '',
        name: user.name,
        role: 'customer',
        source: 'partner_operator',
        siteId: user.siteId,
        siteName: user.siteName,
        operator: {
          id: grant.operatorId,
          name: grant.operatorName,
          grantId: grant.grantId,
          grantExpiresAt: new Date(grant.grantExpiresAt * 1000).toISOString(),
          capabilities: [...grant.capabilities],
        },
      };
    }
    // 하위호환 보존: editor(apps/editor/src/api/auth.ts)·e2e 가 POST /auth/me 를 사용.
    const { passwordHash, ...result } = user;
    return result as UserResponse;
  }

  /**
   * P3a: admin UI 가 GET /auth/me 로 현재 사용자(role + siteRoles)를 하이드레이션한다.
   * editor 는 위 POST 를 그대로 사용(공존) — 기존 동작 무변경.
   */
  @ApiBearerAuth()
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user (role + siteRoles 포함, admin)' })
  @ApiResponse({ status: 200, description: 'Current user retrieved' })
  async getMeForAdmin(@CurrentUser() user: User) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      siteRoles: user.siteRoles ?? [],
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * 관리자(User 엔티티) 본인 비밀번호 변경.
   * 전역 APP_GUARD(JwtAuthGuard)로 인증된 요청만 도달 — @CurrentUser() 는 User 엔티티(user.id).
   */
  @ApiBearerAuth()
  @Patch('change-password')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // SEC-4 현재 비번 추측 방어
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change current admin password' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'Current password mismatch' })
  async changePassword(
    @CurrentUser() user: User,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: boolean }> {
    await this.authService.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    return { success: true };
  }

  /**
   * bookmoa 쇼핑몰 회원을 위한 세션 생성
   * API Key 인증을 통해 호출되며, HttpOnly JWT 쿠키를 발급합니다.
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('shop-session')
  // SEC-4: API Key 무차별 대입 방어. 주의 — 호출원이 bookmoa 서버(단일 IP)이므로
  // 분당 20 세션 생성 초과 규모가 되면 이 한도를 상향해야 함 (현재 트래픽 « 20/분).
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Create shop session for bookmoa members' })
  @ApiResponse({
    status: 200,
    description: 'Session created successfully',
    type: ShopSessionResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid API Key' })
  async createShopSession(
    @Body() dto: CreateShopSessionDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentSite() site?: CurrentSitePayload, // Phase C-2 — JWT 페이로드에 siteId 주입
  ): Promise<ShopSessionResponseDto> {
    const siteContext = site
      ? { siteId: site.siteId, siteName: site.siteName }
      : undefined;
    const { accessToken, refreshToken } =
      await this.authService.createShopSession(dto, siteContext);

    const isProduction = process.env.NODE_ENV === 'production';

    // HttpOnly 쿠키로 accessToken 설정
    res.cookie('storige_access', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api',
      maxAge: 3600 * 1000, // 1시간
    });

    // HttpOnly 쿠키로 refreshToken 설정
    res.cookie('storige_refresh', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 30 * 24 * 3600 * 1000, // 30일
    });

    return {
      success: true,
      accessToken,
      // 임베드 편집기 사일런트 리프레시용 — 호스트(bookmoa)가 /embed?refreshToken= 로 전달.
      // (쿠키 storige_refresh 는 크로스오리진 iframe 에서 못 쓰므로 body 로도 반환.)
      refreshToken,
      expiresIn: 3600,
      member: {
        seqno: dto.memberSeqno,
        id: dto.memberId,
        name: dto.memberName,
      },
    };
  }

  /**
   * refreshToken 쿠키를 사용하여 새로운 accessToken을 발급합니다 (Silent Refresh)
   */
  @Public()
  @Post('shop-refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // SEC-4 refresh 계열 동일 한도
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh shop session token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Refresh token expired' })
  async refreshShopSession(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ success: boolean; expiresIn?: number; error?: string }> {
    const refreshToken = req.cookies?.['storige_refresh'];

    if (!refreshToken) {
      return {
        success: false,
        error: 'REFRESH_TOKEN_MISSING',
      };
    }

    const { accessToken, expiresIn } =
      await this.authService.refreshShopToken(refreshToken);

    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('storige_access', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/api',
      maxAge: expiresIn * 1000,
    });

    return { success: true, expiresIn };
  }

  /**
   * 임베드(iframe/localStorage Bearer) 전용 사일런트 리프레시.
   * 쿠키 기반 /auth/shop-refresh 는 크로스오리진 iframe 에서 서드파티 쿠키 차단으로 동작 불가.
   * 본 엔드포인트는 refreshToken 을 body 로 받아 새 accessToken 을 **JSON body** 로 반환한다.
   * → 편집기가 401 시 자동 호출하여 localStorage 의 auth_token 을 갱신(포토북 다일 편집 지원).
   */
  @Public()
  @Post('shop-refresh-body')
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // SEC-4 refresh 계열 동일 한도
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh shop session token (embed/body variant)' })
  @ApiResponse({ status: 200, description: 'New access token in body' })
  @ApiResponse({ status: 401, description: 'Refresh token expired/invalid' })
  async refreshShopSessionBody(
    @Body('refreshToken') refreshToken: string,
  ): Promise<{ success: boolean; accessToken?: string; expiresIn?: number; error?: string }> {
    if (!refreshToken) {
      return { success: false, error: 'REFRESH_TOKEN_MISSING' };
    }
    const { accessToken, expiresIn } =
      await this.authService.refreshShopToken(refreshToken);
    return { success: true, accessToken, expiresIn };
  }

  // ───────────────────────────────────────────────────────────────
  // 운영자 대리 편집 (Partner Operator Grant, 2026-09-29, ADDITIVE — GUARDED)
  // 서버 간 전용: 사이트 편집기 키(X-API-Key)만. 사이트는 검증된 키의 사이트 행에서만 도출한다.
  // ───────────────────────────────────────────────────────────────

  /**
   * 운영자 대리 편집 토큰 발급 — 지정한 세션(1~20, 호출 사이트 소속)에 한정된 단기 토큰.
   * 쿠키를 설정하지 않고 본문으로만 반환한다.
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('partner-operator-session')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Mint a partner operator grant (server-to-server, site editor key)' })
  @ApiResponse({ status: 200, type: PartnerOperatorSessionResponseDto })
  @ApiResponse({ status: 400, description: 'PARTNER_OPERATOR_SCOPE_REQUIRED' })
  @ApiResponse({ status: 401, description: 'Invalid API Key' })
  @ApiResponse({ status: 403, description: 'PARTNER_OPERATOR_SITE_REQUIRED' })
  @ApiResponse({ status: 404, description: 'SESSION_NOT_FOUND' })
  @ApiResponse({ status: 503, description: 'PARTNER_OPERATOR_UNAVAILABLE' })
  async createPartnerOperatorSession(
    @Body() dto: CreatePartnerOperatorSessionDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<PartnerOperatorSessionResponseDto> {
    assertPartnerOperatorSiteCaller(site);
    return this.grants().mint(dto, site);
  }

  /** 운영자 권한 취소 — grantId 또는 all:true. 다른 사이트의 권한은 0건으로 처리된다. */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('partner-operator-session/revoke')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Revoke partner operator grants (server-to-server, site editor key)' })
  @ApiResponse({ status: 200, type: PartnerOperatorRevokeResponseDto })
  @ApiResponse({ status: 400, description: 'PARTNER_OPERATOR_REVOKE_TARGET_REQUIRED' })
  @ApiResponse({ status: 403, description: 'PARTNER_OPERATOR_SITE_REQUIRED' })
  async revokePartnerOperatorSession(
    @Body() dto: RevokePartnerOperatorSessionDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<PartnerOperatorRevokeResponseDto> {
    assertPartnerOperatorSiteCaller(site);
    return this.grants().revoke(site, dto);
  }

  /** 운영자 감사 기록 조회 — 호출 사이트 기록만, 최신순 */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('partner-operator-session/audit')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'List partner operator audit records (server-to-server, site editor key)' })
  @ApiResponse({ status: 200, type: PartnerOperatorAuditResponseDto })
  @ApiResponse({ status: 403, description: 'PARTNER_OPERATOR_SITE_REQUIRED' })
  async listPartnerOperatorAudit(
    @Query() query: PartnerOperatorAuditQueryDto,
    @CurrentSite() site?: CurrentSitePayload,
  ): Promise<PartnerOperatorAuditResponseDto> {
    assertPartnerOperatorSiteCaller(site);
    return this.grants().audit(site, query);
  }
}
