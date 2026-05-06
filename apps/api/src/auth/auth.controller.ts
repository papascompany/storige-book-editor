import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Res,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/login.dto';
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

interface UserResponse {
  id: string;
  email: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'User login' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto): Promise<AuthTokens> {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('register')
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid token' })
  async refresh(@Body('refreshToken') refreshToken: string): Promise<AuthTokens> {
    return this.authService.refreshToken(refreshToken);
  }

  @ApiBearerAuth()
  @Post('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user' })
  @ApiResponse({ status: 200, description: 'Current user retrieved' })
  async getMe(@CurrentUser() user: User): Promise<UserResponse> {
    const { passwordHash, ...result } = user;
    return result as UserResponse;
  }

  /**
   * bookmoa 쇼핑몰 회원을 위한 세션 생성
   * API Key 인증을 통해 호출되며, HttpOnly JWT 쿠키를 발급합니다.
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Post('shop-session')
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
}
