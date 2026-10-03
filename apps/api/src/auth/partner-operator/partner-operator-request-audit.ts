import { HttpException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { PartnerOperatorAuditDetail } from '../entities/partner-operator-audit-log.entity';
import type { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import {
  PARTNER_OPERATOR,
  PartnerOperatorGrant,
  PartnerOperatorOrigin,
  grantOrigin,
} from './partner-operator.types';

/**
 * 운영자 요청 감사(action 'request') 공용 helper (2026-10-03).
 *
 * PartnerOperatorAuditInterceptor(핸들러 통과·핸들러 오류)와 JwtAuthGuard(가드 단계 401·403 거부)가
 * 같은 행 형식으로 기록하도록 신원 추출·상태코드·오류 코드·컨트롤러 경로·기록 함수를 한곳에 둔다.
 */

export interface OperatorIdentity {
  grantId: string;
  siteId: string;
  operatorId: string;
  operatorName: string | null;
  /**
   * 'staff' 는 JwtStrategy 가 권한 행을 확인한 권한 객체(또는 서명 검증된 권한)에서만 인정한다.
   * null = 평면 스탬프 사용자(OptionalShopJwtGuard) — 기록 시 권한 행에서 출처를 조회한다.
   */
  origin: PartnerOperatorOrigin | null;
  /** 관리자 발급 권한의 발급자(권한 행 issued_by_user_id) — staff 일 때만 */
  actorUserId: string | null;
}

export interface OperatorAuditRequest {
  method?: string;
  params?: Record<string, unknown>;
  route?: { path?: unknown };
  user?: unknown;
}

export type OperatorRequestAuditWriter = Pick<
  PartnerOperatorAuditWriter,
  'recordBestEffort' | 'resolveGrantOrigin'
>;

export interface OperatorRequestAuditInput {
  identity: OperatorIdentity;
  req: OperatorAuditRequest | null | undefined;
  controllerPath: string | null;
  statusCode: number;
  errorCode?: string;
}

/** 요청 단위 기록에서 sessionId 를 채우는 컨트롤러, resourceId 를 채우는 컨트롤러 */
export const SESSION_CONTROLLER_PATH = 'edit-sessions';
export const RESOURCE_CONTROLLER_PATHS: ReadonlySet<string> = new Set(['files', 'worker-jobs']);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * req.user 에서 운영자 식별 정보를 꺼낸다.
 * - JwtStrategy 사용자: partnerOperator(권한 객체)
 * - OptionalShopJwtGuard 사용자(@Public 라우트): grantId/operatorId 평면 필드
 * 운영자가 아니면 null.
 */
export function operatorIdentity(user: unknown): OperatorIdentity | null {
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

/**
 * 서명 검증된 권한 → 신원. 출처는 grantOrigin(권한), 발급자는 관리자 권한이고 값이 있을 때만.
 * (권한 행 확인을 통과하기 전이면 발급자는 null 이다.)
 */
export function operatorIdentityFromGrant(grant: PartnerOperatorGrant): OperatorIdentity {
  const origin = grantOrigin(grant);
  return {
    grantId: grant.grantId,
    siteId: grant.siteId,
    operatorId: grant.operatorId,
    operatorName: typeof grant.operatorName === 'string' ? grant.operatorName : null,
    origin,
    actorUserId:
      origin === 'staff' && typeof grant.issuedByUserId === 'string' ? grant.issuedByUserId : null,
  };
}

/** HttpException 이면 그 상태코드, 아니면 500 */
export function httpErrorStatus(err: unknown): number {
  return err instanceof HttpException ? err.getStatus() : 500;
}

/** HttpException 응답 본문의 code(문자열일 때만) */
export function httpErrorCode(err: unknown): string | undefined {
  if (!(err instanceof HttpException)) return undefined;
  const body = asRecord(err.getResponse());
  return typeof body?.code === 'string' ? body.code : undefined;
}

/** 컨트롤러 클래스의 @Controller 경로(문자열일 때만, 앞뒤 '/' 제거). 그 외 null */
export function controllerPathOf(controllerClass: unknown): string | null {
  if (typeof controllerClass !== 'function') return null;
  const raw: unknown = Reflect.getMetadata(PATH_METADATA, controllerClass);
  if (typeof raw === 'string') return raw.replace(/^\/+|\/+$/g, '');
  return null;
}

/**
 * 요청 감사 행 1건을 best-effort 로 기록한다. 이 함수는 reject 하지 않는다.
 *
 * - 신원 출처가 있으면(origin 비null) 추가 조회 없이 recordBestEffort 를 첫 await 이전에 호출한다.
 * - 평면 스탬프 사용자(origin null)는 권한 행에서 출처를 조회한다 — 관리자 요청이 파트너 감사 조회
 *   (origin 'partner')에 섞이지 않게 한다. 조회 실패·행 없음이면 기록하지 않는다.
 * 본문·캔버스·토큰·키는 기록하지 않는다.
 */
export async function recordOperatorRequest(
  writer: OperatorRequestAuditWriter,
  input: OperatorRequestAuditInput,
): Promise<void> {
  try {
    const { identity, req, controllerPath, statusCode, errorCode } = input;
    const paramId = typeof req?.params?.id === 'string' ? req.params.id : null;
    const detail: PartnerOperatorAuditDetail = {};
    if (errorCode) detail.errorCode = errorCode;
    if (paramId && controllerPath && RESOURCE_CONTROLLER_PATHS.has(controllerPath)) {
      detail.resourceId = paramId;
    }
    const routePath = typeof req?.route?.path === 'string' ? req.route.path : null;
    let origin: PartnerOperatorOrigin = identity.origin ?? 'partner';
    let actorUserId = identity.actorUserId;
    if (identity.origin === null) {
      const resolved = await writer.resolveGrantOrigin(identity.grantId);
      if (!resolved) return;
      origin = resolved.origin;
      actorUserId = resolved.issuedByUserId;
    }
    await writer.recordBestEffort({
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
  } catch {
    // 기록 실패(출처 조회 오류 포함)는 응답에 영향을 주지 않는다.
  }
}

/**
 * 권한 무효 거부 예외 ↔ 서명 검증된 권한 연결(JwtAuthGuard 가 401 요청 감사 행의 신원으로 쓴다).
 * WeakMap 이라 예외 객체의 키·응답 본문·직렬화는 그대로다.
 */
const rejectedGrants = new WeakMap<object, PartnerOperatorGrant>();

/** 객체(예외)가 아니면 아무것도 하지 않는다. throw 하지 않는다. */
export function markRejectedOperatorGrant(err: unknown, grant: PartnerOperatorGrant): void {
  if ((typeof err !== 'object' && typeof err !== 'function') || err === null) return;
  try {
    rejectedGrants.set(err, grant);
  } catch {
    // 연결 실패는 원래 예외 전달에 영향을 주지 않는다.
  }
}

export function rejectedOperatorGrantOf(err: unknown): PartnerOperatorGrant | null {
  if ((typeof err !== 'object' && typeof err !== 'function') || err === null) return null;
  return rejectedGrants.get(err) ?? null;
}
