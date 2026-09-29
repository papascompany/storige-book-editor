import { Injectable, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PARTNER_OPERATOR_ALLOWED_KEY } from '../decorators/partner-operator-allowed.decorator';
import { PARTNER_OPERATOR } from '../partner-operator/partner-operator.types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  /**
   * 운영자 대리 편집 토큰 라우트 게이트 (2026-09-29, ADDITIVE — 기본 거부).
   *
   * 인증된 사용자가 운영자(source 'partner_operator')이면 **핸들러에** @PartnerOperatorAllowed() 가
   * 있을 때만 통과한다. 클래스 수준 메타데이터는 의도적으로 읽지 않는다. 그 외 사용자(shop/admin)는
   * 기존 동작 그대로다.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    const result = super.handleRequest<TUser>(err, user, info, context, status);
    const source = (result as { source?: unknown } | null | undefined)?.source;
    if (
      source === PARTNER_OPERATOR &&
      this.reflector.get<boolean>(PARTNER_OPERATOR_ALLOWED_KEY, context.getHandler()) !== true
    ) {
      throw new ForbiddenException({
        code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
        message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
      });
    }
    return result;
  }
}
