import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { LoginDto, RegisterDto } from './dto/login.dto';
import { CreateShopSessionDto } from './dto/shop-session.dto';
import { AuthTokens, UserRole, SiteRoleClaim } from '@storige/types';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private jwtService: JwtService,
  ) {}

  async validateUser(email: string, password: string): Promise<User | null> {
    // P1: 사이트 운영자(SITE_ADMIN/SITE_MANAGER) 권한을 JWT 클레임에 실으려면 site 역할 매핑을
    // 함께 로드한다. 전역 관리자/고객은 매핑이 없어 빈 배열(기존 동작 무영향).
    const user = await this.userRepository.findOne({
      where: { email },
      relations: ['siteRoleAssignments'],
    });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      return null;
    }

    return user;
  }

  /**
   * P1 멀티테넌시 — User 의 site 역할 매핑을 JWT 클레임(SiteRoleClaim[])으로 변환.
   * 전역 관리자/고객은 매핑이 없어 빈 배열을 반환(클레임 미포함 → dual-mode 전역).
   */
  private buildSiteRolesClaim(user: User): SiteRoleClaim[] {
    return (user.siteRoleAssignments ?? []).map((a) => ({
      siteId: a.siteId,
      role: a.role,
    }));
  }

  async login(loginDto: LoginDto): Promise<AuthTokens> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: Record<string, any> = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    // P1: site 역할이 있을 때만 클레임 추가(비파괴 — 기존 admin 토큰은 미포함 → 전역).
    const siteRoles = this.buildSiteRolesClaim(user);
    if (siteRoles.length > 0) {
      payload.siteRoles = siteRoles;
    }

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: this.jwtService.sign(payload, { expiresIn: '30d' }),
    };
  }

  async register(registerDto: RegisterDto): Promise<User> {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(registerDto.password, salt);

    const user = this.userRepository.create({
      email: registerDto.email,
      passwordHash,
      role: UserRole.CUSTOMER,
    });

    return await this.userRepository.save(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('현재 비밀번호가 일치하지 않습니다.');
    }
    const salt = await bcrypt.genSalt(10);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    await this.userRepository.save(user);
  }

  async refreshToken(token: string): Promise<AuthTokens> {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ['siteRoleAssignments'],
      });

      if (!user) {
        throw new UnauthorizedException('User not found');
      }

      const newPayload: Record<string, any> = {
        sub: user.id,
        email: user.email,
        role: user.role,
      };
      // P1: 토큰 갱신 시 site 역할 클레임 유지(누락 시 갱신 후 권한 손실 방지).
      const siteRoles = this.buildSiteRolesClaim(user);
      if (siteRoles.length > 0) {
        newPayload.siteRoles = siteRoles;
      }

      return {
        accessToken: this.jwtService.sign(newPayload),
        refreshToken: this.jwtService.sign(newPayload, { expiresIn: '30d' }),
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  /**
   * bookmoa 쇼핑몰 회원을 위한 세션 생성
   * API Key 인증을 통해 호출되며, JWT 쿠키를 발급합니다.
   */
  async createShopSession(
    dto: CreateShopSessionDto,
    siteContext?: { siteId: string; siteName: string }, // Phase C-2 — 호출 컨트롤러에서 주입
  ): Promise<{ accessToken: string; refreshToken: string }> {
    // Patch D (2026-05-03): orderSeqno 또는 allowedOrderSeqnos를 JWT에 포함하면
    // 후속 EditSession 생성 시 JWT.allowedOrderSeqnos 검증으로 강한 격리 가능.
    // 둘 다 없으면 기존 동작 유지 (DTO 값 신뢰, PHP 측 호환성 보장).
    const allowedOrderSeqnos: number[] = [];
    if (dto.orderSeqno !== undefined && dto.orderSeqno !== null) {
      allowedOrderSeqnos.push(dto.orderSeqno);
    }
    if (Array.isArray(dto.allowedOrderSeqnos) && dto.allowedOrderSeqnos.length > 0) {
      for (const o of dto.allowedOrderSeqnos) {
        if (!allowedOrderSeqnos.includes(o)) allowedOrderSeqnos.push(o);
      }
    }

    const payload: Record<string, any> = {
      sub: dto.memberSeqno.toString(),
      email: dto.memberId,
      name: dto.memberName,
      role: 'customer',
      source: 'shop',
      phpSessionId: dto.phpSessionId,
      permissions: dto.permissions || ['edit', 'upload', 'validate'],
    };
    // 주문 컨텍스트 명시 시 JWT에 포함 (없으면 누락 — 호환성 유지)
    if (allowedOrderSeqnos.length > 0) {
      payload.allowedOrderSeqnos = allowedOrderSeqnos;
    }
    // Phase C-2 — 사이트 컨텍스트를 JWT 페이로드에 포함 (있을 때만)
    if (siteContext?.siteId) {
      payload.siteId = siteContext.siteId;
      payload.siteName = siteContext.siteName;
    }

    const accessToken = this.jwtService.sign(payload, { expiresIn: '1h' });
    const refreshToken = this.jwtService.sign(
      {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        source: 'shop',
        permissions: payload.permissions,
        ...(allowedOrderSeqnos.length > 0 && { allowedOrderSeqnos }),
      },
      { expiresIn: '30d' },
    );

    return { accessToken, refreshToken };
  }

  /**
   * refreshToken 쿠키를 사용하여 새로운 accessToken을 발급합니다.
   */
  async refreshShopToken(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    try {
      const payload = this.jwtService.verify(refreshToken);

      // 새로운 accessToken 발급 — shop 컨텍스트(주문 스코프/사이트) 전부 보존.
      // (allowedOrderSeqnos/siteId/siteName 누락 시 갱신 토큰이 주문 권한·사이트를 잃는 회귀 방지.)
      const newPayload: Record<string, any> = {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        role: payload.role,
        source: payload.source,
        permissions: payload.permissions,
      };
      if (payload.allowedOrderSeqnos) {
        newPayload.allowedOrderSeqnos = payload.allowedOrderSeqnos;
      }
      if (payload.siteId) {
        newPayload.siteId = payload.siteId;
        newPayload.siteName = payload.siteName;
      }

      const newAccessToken = this.jwtService.sign(newPayload, { expiresIn: '1h' });

      return { accessToken: newAccessToken, expiresIn: 3600 };
    } catch (error) {
      throw new UnauthorizedException({
        success: false,
        error: 'REFRESH_TOKEN_EXPIRED',
        redirectUrl: '/login',
      });
    }
  }
}
