import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import type { PartnerOperatorAuditDetail } from '../entities/partner-operator-audit-log.entity';
import { PARTNER_OPERATOR, PartnerOperatorOrigin } from './partner-operator.types';

interface AuditRequest {
  method?: string;
  params?: Record<string, unknown>;
  route?: { path?: unknown };
  user?: unknown;
}

interface AuditResponse {
  statusCode?: number;
}

interface OperatorIdentity {
  grantId: string;
  siteId: string;
  operatorId: string;
  operatorName: string | null;
  /**
   * 'staff' 는 JwtStrategy 가 권한 행을 확인한 권한 객체에서만 인정한다.
   * null = 평면 스탬프 사용자(OptionalShopJwtGuard) — 기록 시 권한 행에서 출처를 조회한다.
   */
  origin: PartnerOperatorOrigin | null;
  /** 관리자 발급 권한의 발급자(권한 행 issued_by_user_id) — staff 일 때만 */
  actorUserId: string | null;
}

/** 요청 단위 기록에서 sessionId 를 채우는 컨트롤러, resourceId 를 채우는 컨트롤러 */
const SESSION_CONTROLLER_PATH = 'edit-sessions';
const RESOURCE_CONTROLLER_PATHS = new Set(['files', 'worker-jobs']);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * req.user 에서 운영자 식별 정보를 꺼낸다.
 * - JwtStrategy 사용자: partnerOperator(권한 객체)
 * - OptionalShopJwtGuard 사용자(@Public 라우트): grantId/operatorId 평면 필드
 * 운영자가 아니면 null.
 */
function operatorIdentity(user: unknown): OperatorIdentity | null {
  const u = asRecord(user);
  if (!u || u.source !== PARTNER_OPERATOR) return null;
  const grant = asRecord(u.partnerOperator);
  const grantId = grant?.grantId ?? u.grantId;
  const operatorId = grant?.operatorId ?? u.operatorId;
  const siteId = grant?.siteId ?? u.siteId;
  const operatorName = grant?.operatorName;
  if (typeof grantId !== 'string' || typeof operatorId !== 'string' || typeof siteId !== 'string') {
    return null;
  }
  const staff = grant?.origin === 'staff';
  const issuedBy = grant?.issuedByUserId;
  return {
    grantId,
    siteId,
    operatorId,
    operatorName: typeof operatorName === 'string' ? operatorName : null,
    origin: grant ? (staff ? 'staff' : 'partner') : null,
    actorUserId: staff && typeof issuedBy === 'string' ? issuedBy : null,
  };
}

function errorStatus(err: unknown): number {
  return err instanceof HttpException ? err.getStatus() : 500;
}

function errorCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = asRecord(err.getResponse());
  return typeof body?.code === 'string' ? body.code : undefined;
}

/**
 * 운영자 요청 감사 인터셉터 (APP_INTERCEPTOR, 2026-09-29).
 *
 * req.user.source === 'partner_operator' 인 요청만 기록하고 그 외에는 아무것도 하지 않는다.
 * 성공·실패 모두 action 'request' 1행(메서드·라우트·상태코드·세션/리소스 id·오류 코드)을 best-effort 로
 * 남긴다. 본문·캔버스·토큰·키는 기록하지 않으며, 기록 실패가 응답을 바꾸지 않는다(원래 오류는 그대로 전달).
 */
@Injectable()
export class PartnerOperatorAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditWriter: PartnerOperatorAuditWriter) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<AuditRequest>();
    const identity = operatorIdentity(req?.user);
    if (!identity) return next.handle();

    const res = http.getResponse<AuditResponse>();
    const controllerPath = this.controllerPath(context);

    return next.handle().pipe(
      tap(() => {
        void this.record(identity, req, controllerPath, res?.statusCode ?? 200, undefined);
      }),
      catchError((err: unknown) => {
        void this.record(identity, req, controllerPath, errorStatus(err), errorCode(err));
        return throwError(() => err);
      }),
    );
  }

  private controllerPath(context: ExecutionContext): string | null {
    const raw: unknown = Reflect.getMetadata(PATH_METADATA, context.getClass());
    if (typeof raw === 'string') return raw.replace(/^\/+|\/+$/g, '');
    return null;
  }

  private async record(
    identity: OperatorIdentity,
    req: AuditRequest,
    controllerPath: string | null,
    statusCode: number,
    code: string | undefined,
  ): Promise<void> {
    const paramId = typeof req?.params?.id === 'string' ? req.params.id : null;
    const detail: PartnerOperatorAuditDetail = {};
    if (code) detail.errorCode = code;
    if (paramId && controllerPath && RESOURCE_CONTROLLER_PATHS.has(controllerPath)) {
      detail.resourceId = paramId;
    }
    const routePath = typeof req?.route?.path === 'string' ? req.route.path : null;
    // 평면 스탬프 사용자(@Public 라우트)는 토큰에 출처가 없다 — 권한 행에서 조회해 관리자 요청이
    // 파트너 감사 조회(origin 'partner')에 섞이지 않게 한다. 조회 실패·행 없음이면 기록하지 않는다.
    let origin: PartnerOperatorOrigin = identity.origin ?? 'partner';
    let actorUserId = identity.actorUserId;
    if (identity.origin === null) {
      try {
        const resolved = await this.auditWriter.resolveGrantOrigin(identity.grantId);
        if (!resolved) return;
        origin = resolved.origin;
        actorUserId = resolved.issuedByUserId;
      } catch {
        return;
      }
    }
    await this.auditWriter.recordBestEffort({
      grantId: identity.grantId,
      siteId: identity.siteId,
      origin,
      actorUserId,
      sessionId: controllerPath === SESSION_CONTROLLER_PATH ? paramId : null,
      operatorId: identity.operatorId,
      operatorName: identity.operatorName,
      action: 'request',
      method: typeof req?.method === 'string' ? req.method : null,
      route: routePath,
      statusCode,
      detail: Object.keys(detail).length > 0 ? detail : null,
    });
  }
}
