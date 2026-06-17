import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities/user.entity';
import { SiteRoleClaim } from '@storige/types';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  source?: string; // 'shop' for bookmoa shop sessions
  name?: string;
  permissions?: string[];
  /** Patch D (2026-05-03): 주문 컨텍스트 — 명시 시 EditSession 생성 시 검증 */
  allowedOrderSeqnos?: number[];
  /** Phase C-2: 사이트 컨텍스트 — shop-session 발급 시 X-API-Key의 site 정보를 토큰에 포함 */
  siteId?: string;
  siteName?: string;
  /** P1 멀티테넌시 (2026-06-17): admin 로그인 토큰의 사이트별 역할(SITE_ADMIN/SITE_MANAGER).
   *  없으면(전역 관리자/고객) 미포함 → TenantGuard 가 전역 접근으로 간주(dual-mode). */
  siteRoles?: SiteRoleClaim[];
}

// Shop session 사용자 타입
export interface ShopUser {
  userId: string;
  email: string;
  name: string;
  role: string;
  source: 'shop';
  permissions: string[];
  /** JWT에 명시된 허용 주문 번호 목록 (없으면 undefined — 모든 주문 허용 = 기존 호환) */
  allowedOrderSeqnos?: number[];
  /** Phase C-2: JWT 페이로드 siteId 패스스루 — EditSession 자동 site_id 주입에 사용 */
  siteId?: string;
  siteName?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<User | ShopUser> {
    // Shop session 토큰인 경우 DB 조회 없이 페이로드 반환
    if (payload.source === 'shop') {
      return {
        userId: payload.sub,
        email: payload.email,
        name: payload.name || '',
        role: payload.role,
        source: 'shop',
        permissions: payload.permissions || ['edit', 'upload', 'validate'],
        allowedOrderSeqnos: payload.allowedOrderSeqnos,
        // Phase C-2 — JWT 페이로드의 siteId/siteName 패스스루
        siteId: payload.siteId,
        siteName: payload.siteName,
      };
    }

    // 일반 사용자 토큰인 경우 DB에서 조회
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // P1 멀티테넌시 — 토큰의 site 역할 클레임을 req.user.siteRoles 로 노출(TenantGuard 스코핑용).
    // DB 재조회 없이 토큰 기반(효율). 없으면 빈 배열 = 전역 관리자/고객(dual-mode).
    // ⚠️ siteRoles 는 발급 시점 스냅샷 — 민감 라우터(P3)는 필요 시 DB user_site_roles 재검증 권장.
    user.siteRoles = payload.siteRoles ?? [];

    return user;
  }
}
