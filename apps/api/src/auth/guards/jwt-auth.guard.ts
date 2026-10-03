import { Injectable, ExecutionContext, ForbiddenException, Optional } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PARTNER_OPERATOR_ALLOWED_KEY } from '../decorators/partner-operator-allowed.decorator';
import { PARTNER_OPERATOR } from '../partner-operator/partner-operator.types';
import { PartnerOperatorAuditWriter } from '../partner-operator/partner-operator-audit.writer';
import {
  OperatorAuditRequest,
  OperatorIdentity,
  controllerPathOf,
  httpErrorCode,
  httpErrorStatus,
  operatorIdentity,
  operatorIdentityFromGrant,
  recordOperatorRequest,
  rejectedOperatorGrantOf,
} from '../partner-operator/partner-operator-request-audit';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    // 운영자 요청 감사(2026-10-03). AuthModule 이 등록한다 — @UseGuards(JwtAuthGuard) 로 다른 모듈에서
    // 만들어지는 인스턴스에는 없을 수 있으며, 없으면 기록만 하지 않는다(응답 동일).
    @Optional() private readonly auditWriter?: PartnerOperatorAuditWriter,
  ) {
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
   *
   * 가드 단계 거부 요청 감사(2026-10-03): 운영자 토큰의 라우트 불허(403)와 권한 행 확인 실패(401,
   * 서명 검증된 권한이 연결된 예외)는 action 'request' 행을 best-effort 로 남긴다. 응답은 그대로다.
   */
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): TUser {
    if (err) {
      this.recordGuardRejection(context, err, () => {
        const rejected = rejectedOperatorGrantOf(err);
        return rejected ? operatorIdentityFromGrant(rejected) : null;
      });
    }
    const result = super.handleRequest<TUser>(err, user, info, context, status);
    const source = (result as { source?: unknown } | null | undefined)?.source;
    if (
      source === PARTNER_OPERATOR &&
      this.reflector.get<boolean>(PARTNER_OPERATOR_ALLOWED_KEY, context.getHandler()) !== true
    ) {
      const denied = new ForbiddenException({
        code: 'PARTNER_OPERATOR_ROUTE_NOT_ALLOWED',
        message: '운영자 대리 편집 토큰으로는 사용할 수 없는 기능입니다.',
      });
      this.recordGuardRejection(context, denied, () => operatorIdentity(result));
      throw denied;
    }
    return result;
  }

  /**
   * 가드 단계 거부 요청 감사 행(best-effort). 기록기가 없거나 HTTP 가 아니거나 신원이 없으면 기록하지 않는다.
   * 기록을 기다리지 않으며, 신원 계산·기록 준비 중 오류는 삼킨다(호출부가 원래 예외를 던진다).
   */
  private recordGuardRejection(
    context: ExecutionContext,
    error: unknown,
    identityOf: () => OperatorIdentity | null,
  ): void {
    const writer = this.auditWriter;
    if (!writer) return;
    try {
      if (context.getType() !== 'http') return;
      const identity = identityOf();
      if (!identity) return;
      const req = context.switchToHttp().getRequest<OperatorAuditRequest>();
      void recordOperatorRequest(writer, {
        identity,
        req,
        controllerPath: controllerPathOf(context.getClass()),
        statusCode: httpErrorStatus(error),
        errorCode: httpErrorCode(error),
      });
    } catch {
      // 기록 준비 중 오류는 응답에 영향을 주지 않는다.
    }
  }
}
