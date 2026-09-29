/**
 * 운영자 대리 편집(Partner Operator Grant) — 공용 타입·상수·판정 (2026-09-29, ADDITIVE).
 *
 * 파트너 사이트 운영자가 고객 편집 세션을 대신 열람·편집·저장·완료(선택적으로 삭제)하기 위한
 * 단기·세션 범위 한정·취소 가능한 토큰. 파트너 서버가 사이트 편집기 키로만 발급받는다.
 *
 * 토큰 판정은 이 파일의 `isPartnerOperatorClaims` 하나로 통일한다(JwtStrategy · AuthService 두 refresh ·
 * OptionalShopJwtGuard). 판정에 걸린 토큰은 `grantFromClaims` 의 모든 조건을 만족해야만 쓰인다 —
 * 일부만 맞는(혼합) 클레임은 거부된다. shop-session 토큰은 role 'customer' + source 'shop' 이고
 * typ 이 없으므로 판정에 걸리지 않는다.
 */

export const PARTNER_OPERATOR = 'partner_operator' as const;

/** 한 권한에 담을 수 있는 세션 수 상한 */
export const MAX_SCOPE = 20;
/** 권한 전체 유효 시간(초) — 기본 2h, 최소 5분, 최대 8h */
export const TTL_DEFAULT = 7200;
export const TTL_MIN = 300;
export const TTL_MAX = 28800;
/** 액세스 토큰 최대 유효 시간(초) */
export const ACCESS_MAX = 900;
/** 운영자 식별자 — 불투명 id 만('@' 불허, 이메일 금지) */
export const OPERATOR_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const OPERATOR_ID_MAX = 128;
export const OPERATOR_NAME_MAX = 100;

export type PartnerOperatorCapability = 'edit' | 'delete';
export type PartnerOperatorTokenUse = 'access' | 'refresh';

const CAPABILITIES: readonly PartnerOperatorCapability[] = ['edit', 'delete'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 운영자 토큰 페이로드(액세스·리프레시 공통, tu 로 구분) */
export interface PartnerOperatorClaims {
  sub: string; // 'po:' + operatorId
  typ: typeof PARTNER_OPERATOR;
  source: typeof PARTNER_OPERATOR;
  role: typeof PARTNER_OPERATOR;
  tu: PartnerOperatorTokenUse;
  siteId: string;
  siteName: string;
  opId: string;
  opName: string | null;
  sids: string[];
  caps: PartnerOperatorCapability[];
  obo?: number;
  gid: string;
  gexp: number; // unix 초
  name: string; // 표시용 = opName ?? opId
  iat?: number;
  exp?: number;
}

/** 검증된 운영자 권한 — req.user.partnerOperator 및 TenantCaller.partnerOperator 로 전달 */
export interface PartnerOperatorGrant {
  grantId: string;
  operatorId: string;
  operatorName: string | null;
  siteId: string;
  sessionIds: string[];
  capabilities: PartnerOperatorCapability[];
  /** 범위 세션이 모두 같은 회원일 때만 — 업로드 소유 스탬프 전용(인가에 쓰지 않음) */
  onBehalfOfMemberSeqno?: number;
  /** 권한 만료(unix 초) */
  grantExpiresAt: number;
}

/** JwtStrategy 가 운영자 액세스 토큰에 대해 반환하는 req.user */
export interface PartnerOperatorUser {
  userId: string;
  email: string;
  name: string;
  role: typeof PARTNER_OPERATOR;
  source: typeof PARTNER_OPERATOR;
  permissions: string[];
  siteId: string;
  siteName: string;
  partnerOperator: PartnerOperatorGrant;
}

/**
 * OptionalShopJwtGuard(@Public 라우트)가 운영자 액세스 토큰에 대해 설정하는 req.user.
 * 사이트 스탬프·감사 기록·게스트 생성 거부에만 쓰이며 권한을 부여하지 않는다(DB 확인 없음).
 */
export interface PartnerOperatorStampUser {
  userId: string;
  source: typeof PARTNER_OPERATOR;
  siteId: string;
  siteName: string;
  grantId: string;
  operatorId: string;
}

function isRecord(p: unknown): p is Record<string, unknown> {
  return typeof p === 'object' && p !== null && !Array.isArray(p);
}

/** 운영자 클레임의 흔적이 하나라도 있으면 true — 이후 전체 일관성 검사를 강제하기 위한 판정 */
export function isPartnerOperatorClaims(p: unknown): boolean {
  if (!isRecord(p)) return false;
  return (
    p.typ === PARTNER_OPERATOR || p.source === PARTNER_OPERATOR || p.role === PARTNER_OPERATOR
  );
}

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_PATTERN.test(v);
}

export function isValidOperatorId(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length >= 1 &&
    v.length <= OPERATOR_ID_MAX &&
    OPERATOR_ID_PATTERN.test(v)
  );
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * 서명 검증이 끝난 페이로드에서 운영자 권한을 복원한다(순수 함수).
 * 조건을 하나라도 만족하지 않으면 null — 호출부는 401(또는 @Public 라우트에서는 익명 취급).
 */
export function grantFromClaims(
  p: unknown,
  expectedTu: PartnerOperatorTokenUse,
  nowSec: number = nowUnixSeconds(),
): PartnerOperatorGrant | null {
  if (!isRecord(p)) return null;
  if (p.typ !== PARTNER_OPERATOR || p.source !== PARTNER_OPERATOR || p.role !== PARTNER_OPERATOR) {
    return null;
  }
  if (p.tu !== expectedTu) return null;
  if (typeof p.siteId !== 'string' || p.siteId.length === 0) return null;
  if (!isUuid(p.gid)) return null;
  if (typeof p.gexp !== 'number' || !Number.isFinite(p.gexp) || p.gexp <= nowSec) return null;

  const sids = p.sids;
  if (!Array.isArray(sids) || sids.length < 1 || sids.length > MAX_SCOPE) return null;
  if (!sids.every((s): s is string => typeof s === 'string' && s.length > 0)) return null;

  const caps = p.caps;
  if (!Array.isArray(caps) || !caps.includes('edit')) return null;
  if (!caps.every((c): c is PartnerOperatorCapability => CAPABILITIES.includes(c as PartnerOperatorCapability))) {
    return null;
  }

  if (!isValidOperatorId(p.opId)) return null;
  if (p.sub !== `po:${p.opId}`) return null;

  let operatorName: string | null = null;
  if (p.opName !== undefined && p.opName !== null) {
    if (typeof p.opName !== 'string' || p.opName.length > OPERATOR_NAME_MAX) return null;
    operatorName = p.opName;
  }

  let obo: number | undefined;
  if (p.obo !== undefined && p.obo !== null) {
    if (typeof p.obo !== 'number' || !Number.isSafeInteger(p.obo) || p.obo <= 0) return null;
    obo = p.obo;
  }

  const grant: PartnerOperatorGrant = {
    grantId: p.gid,
    operatorId: p.opId,
    operatorName,
    siteId: p.siteId,
    sessionIds: [...sids],
    capabilities: [...(caps as PartnerOperatorCapability[])],
    grantExpiresAt: p.gexp,
  };
  if (obo !== undefined) grant.onBehalfOfMemberSeqno = obo;
  return grant;
}

/** 권한 + 사이트명 → 서명할 클레임(tu 만 다르게) */
export function claimsFromGrant(
  grant: PartnerOperatorGrant,
  siteName: string,
  tu: PartnerOperatorTokenUse,
): PartnerOperatorClaims {
  const claims: PartnerOperatorClaims = {
    sub: `po:${grant.operatorId}`,
    typ: PARTNER_OPERATOR,
    source: PARTNER_OPERATOR,
    role: PARTNER_OPERATOR,
    tu,
    siteId: grant.siteId,
    siteName,
    opId: grant.operatorId,
    opName: grant.operatorName,
    sids: [...grant.sessionIds],
    caps: [...grant.capabilities],
    gid: grant.grantId,
    gexp: grant.grantExpiresAt,
    name: grant.operatorName ?? grant.operatorId,
  };
  if (grant.onBehalfOfMemberSeqno !== undefined) claims.obo = grant.onBehalfOfMemberSeqno;
  return claims;
}

/** req.user 가 JwtStrategy 가 만든 운영자 사용자인가 */
export function isPartnerOperatorUser(u: unknown): u is PartnerOperatorUser {
  return isRecord(u) && u.source === PARTNER_OPERATOR && isRecord(u.partnerOperator);
}
