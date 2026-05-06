import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * JWT Cookie Strategy
 * HttpOnly 쿠키에서 JWT를 추출하여 인증합니다.
 * bookmoa 쇼핑몰 회원이 storige 편집기를 사용할 때 적용됩니다.
 */
@Injectable()
export class JwtCookieStrategy extends PassportStrategy(Strategy, 'jwt-cookie') {
  constructor(private configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          return request?.cookies?.['storige_access'];
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    if (!payload.sub) {
      throw new UnauthorizedException('Invalid token payload');
    }

    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      source: payload.source,
      permissions: payload.permissions,
      // Phase C-2 — siteId/siteName 패스스루
      siteId: payload.siteId,
      siteName: payload.siteName,
      allowedOrderSeqnos: payload.allowedOrderSeqnos,
    };
  }
}
