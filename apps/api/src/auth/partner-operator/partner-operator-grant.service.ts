import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { UserRole } from '@storige/types';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';
import { Site } from '../../sites/entities/site.entity';
import { PartnerOperatorGrantEntity } from '../entities/partner-operator-grant.entity';
import { User } from '../entities/user.entity';
import { UserSiteRole } from '../entities/user-site-role.entity';
import type { PartnerOperatorAuditDetail } from '../entities/partner-operator-audit-log.entity';
import { computeEditRetention } from '../../staff-edit-data/edit-retention';
import { staffAuditUnavailable } from '../../staff-edit-data/staff-actor';
import type { CurrentSitePayload } from '../decorators/current-site.decorator';
import {
  CreatePartnerOperatorSessionDto,
  PartnerOperatorAuditQueryDto,
  PartnerOperatorAuditResponseDto,
  PartnerOperatorRevokeResponseDto,
  PartnerOperatorSessionResponseDto,
  RevokePartnerOperatorSessionDto,
} from '../dto/partner-operator-session.dto';
import { PartnerOperatorAuditEntry, PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
import {
  ACCESS_MAX,
  MAX_SCOPE,
  PartnerOperatorCapability,
  PartnerOperatorGrant,
  TTL_DEFAULT,
  TTL_MAX,
  TTL_MIN,
  claimsFromGrant,
  grantFromClaims,
  grantOrigin,
  isPartnerOperatorClaims,
  isValidOperatorId,
  nowUnixSeconds,
} from './partner-operator.types';

/** 관리자 발급 권한(2026-09-29) — 기본 1h, 5분~8h */
export const STAFF_TTL_DEFAULT = 3600;
/** 관리자 발급 권한의 최소 잔여 시간(초) — 보관기간 종료가 이보다 가까우면 409 */
export const STAFF_MIN_REMAINING = 60;
export const STAFF_OPERATOR_NAME = 'Storige 관리자';

/** 관리자 발급 입력 — StaffEditDataService 가 세션·범위·보관기간을 확인한 뒤 호출한다 */
export interface MintForStaffInput {
  sessionId: string;
  siteId: string;
  siteName: string;
  actorUserId: string;
  allowDelete: boolean;
  ttlSeconds?: number;
  /** 권한 만료 상한(unix 초) — 편집데이터 보관기간 종료. null/undefined = 상한 없음 */
  notAfterUnix?: number | null;
  reason?: string | null;
  /** 업로드 소유 스탬프 전용(세션 회원 memberSeqno > 0 일 때) — 인가에 쓰지 않는다 */
  onBehalfOfMemberSeqno?: number;
}

export interface StaffGrantMintResult {
  success: true;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  grantId: string;
  grantExpiresAt: string;
  capabilities: PartnerOperatorCapability[];
}

export interface StaffGrantListItem {
  id: string;
  operatorId: string;
  issuedByUserId: string | null;
  capabilities: PartnerOperatorCapability[];
  expiresAt: string;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface StaffGrantRevokeResult {
  success: true;
  grantId: string;
  revoked: boolean;
}

/** issue() 입력 — 권한 행 필드 + 감사 행 + 서명할 권한 */
interface IssueInput {
  row: PartnerOperatorGrantEntity;
  grant: PartnerOperatorGrant;
  siteName: string;
  audit: PartnerOperatorAuditEntry;
  nowSec: number;
}

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresIn: number;
  grantExpiresAt: string;
}

/** 사이트 키 지문 — sha256 hex 앞 16자. 키 원문은 저장·로그하지 않는다. */
export function keyFingerprint(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16);
}

function fingerprintEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * 발급·취소·감사 조회 라우트의 호출자 조건: 사이트 편집기 키(role 'editor')만.
 * 내부 워커 키(role 'worker')와 사이트 없는 호출은 403.
 */
export function assertPartnerOperatorSiteCaller(
  site: CurrentSitePayload | undefined | null,
): asserts site is CurrentSitePayload {
  if (!site?.siteId || site.role !== 'editor') {
    throw siteRequired();
  }
}

function siteRequired(): ForbiddenException {
  return new ForbiddenException({
    code: 'PARTNER_OPERATOR_SITE_REQUIRED',
    message: '사이트 편집기 키로만 운영자 권한을 관리할 수 있습니다.',
  });
}

const SESSION_NOT_FOUND_BODY = {
  code: 'SESSION_NOT_FOUND',
  message: '편집 세션을 찾을 수 없습니다.',
} as const;

const REFRESH_EXPIRED_BODY = {
  success: false,
  error: 'REFRESH_TOKEN_EXPIRED',
  redirectUrl: '/login',
} as const;

function grantInvalid(): UnauthorizedException {
  return new UnauthorizedException({
    code: 'PARTNER_OPERATOR_GRANT_INVALID',
    message: '운영자 권한이 만료되었거나 취소되었습니다.',
  });
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'PARTNER_OPERATOR_UNAVAILABLE',
    message: '운영자 권한 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  });
}

/** assertActive 단일 조회 결과(raw) */
interface ActiveGrantRow {
  id: string;
  siteId: string;
  operatorId: string;
  sessionIds: unknown;
  capabilities: string | null;
  keyFp: string | null;
  expiresAtUnix: string | number;
  revokedAt: Date | string | null;
  origin?: string | null;
  siteStatus: string | null;
  editorCode: string | null;
  workerCode: string | null;
}

/** assertActive 관리자 분기 조회 결과(raw) — 사이트 코드는 선택하지 않는다 */
interface StaffActiveGrantRow {
  id: string;
  siteId: string;
  operatorId: string;
  sessionIds: unknown;
  capabilities: string | null;
  keyFp: string | null;
  expiresAtUnix: string | number;
  revokedAt: Date | string | null;
  origin: string | null;
  issuedByUserId: string | null;
}

const GLOBAL_STAFF_ROLES: ReadonlySet<string> = new Set([
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.MANAGER,
]);

function grantNotFound(): NotFoundException {
  return new NotFoundException({
    code: 'GRANT_NOT_FOUND',
    message: '편집 권한을 찾을 수 없습니다.',
  });
}

function parseSessionIds(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function parseCapabilities(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * 운영자 대리 편집 권한 서비스 (2026-09-29, ADDITIVE).
 *
 * mint    — 사이트 편집기 키로 발급(세션 범위 고정, 권한 행 + 감사 행 저장 후 서명)
 * refresh — 리프레시 토큰 → 새 액세스 토큰(클레임 동일, 권한 만료를 넘지 않음, 권한 행 재확인)
 * assertActive — 요청·갱신마다 권한 행 + 사이트 상태 + 키 지문 확인(실패·DB 오류 모두 401)
 * revoke / audit — 호출 사이트 범위에서만
 */
@Injectable()
export class PartnerOperatorGrantService {
  private readonly logger = new Logger(PartnerOperatorGrantService.name);

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(EditSessionEntity)
    private readonly sessionRepository: Repository<EditSessionEntity>,
    @InjectRepository(PartnerOperatorGrantEntity)
    private readonly grantRepository: Repository<PartnerOperatorGrantEntity>,
    @InjectRepository(Site)
    private readonly siteRepository: Repository<Site>,
    private readonly auditWriter: PartnerOperatorAuditWriter,
    // 관리자 발급 권한 확인(2026-09-29) — AuthModule forFeature 에 이미 있다. 없으면 관리자 권한은 401(fail-closed).
    @Optional()
    @InjectRepository(User)
    private readonly userRepository?: Repository<User>,
    @Optional()
    @InjectRepository(UserSiteRole)
    private readonly userSiteRoleRepository?: Repository<UserSiteRole>,
  ) {}

  // ───────────────────────────── mint ─────────────────────────────

  async mint(
    dto: CreatePartnerOperatorSessionDto,
    site: CurrentSitePayload | undefined,
    nowSec: number = nowUnixSeconds(),
  ): Promise<PartnerOperatorSessionResponseDto> {
    assertPartnerOperatorSiteCaller(site);

    const requested = Array.isArray(dto?.sessionIds) ? dto.sessionIds : [];
    const sessionIds = Array.from(
      new Set(requested.filter((s): s is string => typeof s === 'string' && s.length > 0)),
    );
    if (sessionIds.length === 0 || sessionIds.length > MAX_SCOPE) {
      throw new BadRequestException({
        code: 'PARTNER_OPERATOR_SCOPE_REQUIRED',
        message: `편집할 세션(sessionIds)을 1~${MAX_SCOPE}개 지정해야 합니다.`,
      });
    }
    const apiKey = site.apiKey;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      // 키 지문을 계산할 수 없으면 발급하지 않는다(키 교체 감지 불가).
      throw siteRequired();
    }

    // 사이트 상태 — ApiKeyGuard 는 active 사이트만 찾지만 발급 시점에 다시 확인한다.
    let siteRow: Pick<Site, 'id' | 'status'> | null;
    try {
      siteRow = await this.siteRepository.findOne({
        where: { id: site.siteId },
        select: ['id', 'status'],
      });
    } catch (e) {
      this.logger.error(`[partner-operator] 사이트 조회 실패 site=${site.siteId}: ${(e as Error)?.message}`);
      throw unavailable();
    }
    if (!siteRow || siteRow.status !== 'active') {
      throw siteRequired();
    }

    // 범위 세션 — 전부 존재(soft delete 제외)·호출 사이트 소속(NULL-site 불가)·만료 전이어야 한다.
    // 실패 사유와 id 는 응답에 싣지 않는다(존재 여부 비노출).
    let rows: Array<Pick<EditSessionEntity, 'id' | 'siteId' | 'memberSeqno' | 'guestExpiresAt'>>;
    try {
      rows = await this.sessionRepository.find({
        where: { id: In(sessionIds) },
        select: ['id', 'siteId', 'memberSeqno', 'guestExpiresAt'],
      });
    } catch (e) {
      this.logger.error(`[partner-operator] 세션 조회 실패 site=${site.siteId}: ${(e as Error)?.message}`);
      throw unavailable();
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const nowMs = nowSec * 1000;
    for (const id of sessionIds) {
      const row = byId.get(id);
      const guestExpired =
        !!row?.guestExpiresAt && new Date(row.guestExpiresAt).getTime() <= nowMs;
      if (!row || row.siteId === null || row.siteId !== site.siteId || guestExpired) {
        throw new NotFoundException({ ...SESSION_NOT_FOUND_BODY });
      }
    }

    // 업로드 소유 스탬프용 — 전 세션이 같은 회원(>0)일 때만
    const members = sessionIds.map((id) => Number(byId.get(id)?.memberSeqno ?? 0));
    const first = members[0];
    const obo =
      Number.isSafeInteger(first) && first > 0 && members.every((m) => m === first)
        ? first
        : undefined;

    const capabilities: PartnerOperatorCapability[] = dto.allowDelete === true
      ? ['edit', 'delete']
      : ['edit'];
    const ttl = Math.min(Math.max(Math.trunc(dto.ttlSeconds ?? TTL_DEFAULT), TTL_MIN), TTL_MAX);
    const grantId = randomUUID();
    const gexp = nowSec + ttl;
    const keyFp = keyFingerprint(apiKey);
    const operatorName = dto.operatorName ?? null;
    const orderRef = dto.orderRef ?? null;

    const row = new PartnerOperatorGrantEntity();
    row.id = grantId;
    row.siteId = site.siteId;
    row.origin = 'partner';
    row.issuedByUserId = null;
    row.operatorId = dto.operatorId;
    row.operatorName = operatorName;
    row.sessionIds = sessionIds;
    row.capabilities = capabilities.join(',');
    row.orderRef = orderRef;
    row.reason = dto.reason ?? null;
    row.onBehalfOfMemberSeqno = obo ?? null;
    row.keyFp = keyFp;
    row.expiresAtUnix = gexp;
    row.revokedAt = null;

    const grant: PartnerOperatorGrant = {
      grantId,
      operatorId: dto.operatorId,
      operatorName,
      siteId: site.siteId,
      sessionIds,
      capabilities,
      grantExpiresAt: gexp,
    };
    if (obo !== undefined) grant.onBehalfOfMemberSeqno = obo;

    const issued = await this.issue({
      row,
      grant,
      siteName: site.siteName ?? '',
      nowSec,
      audit: {
        grantId,
        siteId: site.siteId,
        sessionId: null,
        operatorId: dto.operatorId,
        operatorName,
        action: 'grant.mint',
        detail: {
          sessionCount: sessionIds.length,
          capabilities,
          orderRef,
          ttlSeconds: ttl,
          reason: dto.reason ?? null,
          keyFp,
        },
      },
    });

    this.logger.log(
      `[partner-operator] grant site=${site.siteId} grant=${grantId} op=${dto.operatorId} sessions=${sessionIds.length} caps=${capabilities.join(',')} exp=${issued.grantExpiresAt} key=${keyFp}`,
    );

    return {
      success: true,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.accessExpiresIn,
      grantId,
      grantExpiresAt: issued.grantExpiresAt,
      capabilities: [...capabilities],
      operator: { id: dto.operatorId, name: operatorName },
      scope: { sessionIds: [...sessionIds] },
      orderRef,
    };
  }

  /**
   * 권한 행 저장 → 감사 행(fail-closed) → 서명. mint(파트너)·mintForStaff(관리자) 공용.
   * 행 저장 실패 → 503(서명 없음). 감사 실패 → 방금 만든 행 무효화(best-effort) + 503(서명 없음).
   */
  private async issue(input: IssueInput): Promise<IssuedTokens> {
    const { row, grant, siteName, audit, nowSec } = input;
    const gexp = grant.grantExpiresAt;
    try {
      await this.grantRepository.insert(row);
    } catch (e) {
      this.logger.error(
        `[partner-operator] 권한 저장 실패 site=${row.siteId} grant=${row.id}: ${(e as Error)?.message}`,
      );
      throw unavailable();
    }

    try {
      await this.auditWriter.recordOrThrow(audit);
    } catch {
      // 감사 기록 없이 토큰을 내주지 않는다. 방금 만든 권한 행은 즉시 무효화(best-effort).
      await this.grantRepository
        .update({ id: row.id }, { revokedAt: new Date() })
        .catch(() => undefined);
      throw unavailable();
    }

    const accessExpiresIn = Math.min(ACCESS_MAX, gexp - nowSec);
    const accessToken = this.jwtService.sign(
      { ...claimsFromGrant(grant, siteName, 'access'), iat: nowSec },
      { expiresIn: accessExpiresIn },
    );
    const refreshToken = this.jwtService.sign(
      { ...claimsFromGrant(grant, siteName, 'refresh'), iat: nowSec },
      { expiresIn: gexp - nowSec },
    );
    return {
      accessToken,
      refreshToken,
      accessExpiresIn,
      grantExpiresAt: new Date(gexp * 1000).toISOString(),
    };
  }

  // ─────────────────────────── mintForStaff ───────────────────────────

  /**
   * Storige 관리자 발급(2026-09-29, ADDITIVE). 호출자(StaffEditDataService)가 admin JWT·세션 범위·
   * 보관기간·삭제 권한을 이미 확인했다. 세션 1건 범위, key_fp NULL, origin 'staff',
   * issued_by_user_id = 관리자 users.id, operatorId 'staff.<users.id>'.
   * 권한 만료 = min(now + ttl, notAfterUnix). 잔여가 60초 미만이면 409 EDIT_RETENTION_EXPIRED.
   */
  async mintForStaff(
    input: MintForStaffInput,
    nowSec: number = nowUnixSeconds(),
  ): Promise<StaffGrantMintResult> {
    const operatorId = `staff.${input.actorUserId}`;
    if (!isValidOperatorId(operatorId) || typeof input.siteId !== 'string' || input.siteId.length === 0) {
      throw new ForbiddenException({
        code: 'STAFF_ROLE_REQUIRED',
        message: 'Storige 관리자만 사용할 수 있습니다.',
      });
    }
    const ttl = Math.min(
      Math.max(Math.trunc(Number(input.ttlSeconds ?? STAFF_TTL_DEFAULT) || STAFF_TTL_DEFAULT), TTL_MIN),
      TTL_MAX,
    );
    const cap =
      typeof input.notAfterUnix === 'number' && Number.isFinite(input.notAfterUnix)
        ? Math.floor(input.notAfterUnix)
        : Number.POSITIVE_INFINITY;
    const gexp = Math.min(nowSec + ttl, cap);
    if (gexp - nowSec < STAFF_MIN_REMAINING) {
      throw new ConflictException({
        code: 'EDIT_RETENTION_EXPIRED',
        message: '편집데이터 보관기간이 지났습니다.',
        retentionUntil: Number.isFinite(cap) ? new Date(cap * 1000).toISOString() : null,
      });
    }

    const capabilities: PartnerOperatorCapability[] = input.allowDelete ? ['edit', 'delete'] : ['edit'];
    const grantId = randomUUID();
    const obo =
      typeof input.onBehalfOfMemberSeqno === 'number' &&
      Number.isSafeInteger(input.onBehalfOfMemberSeqno) &&
      input.onBehalfOfMemberSeqno > 0
        ? input.onBehalfOfMemberSeqno
        : undefined;
    const reason = typeof input.reason === 'string' && input.reason.length > 0 ? input.reason.slice(0, 200) : null;

    const row = new PartnerOperatorGrantEntity();
    row.id = grantId;
    row.siteId = input.siteId;
    row.origin = 'staff';
    row.issuedByUserId = input.actorUserId;
    row.operatorId = operatorId;
    row.operatorName = STAFF_OPERATOR_NAME;
    row.sessionIds = [input.sessionId];
    row.capabilities = capabilities.join(',');
    row.orderRef = null;
    row.reason = reason;
    row.onBehalfOfMemberSeqno = obo ?? null;
    row.keyFp = null;
    row.expiresAtUnix = gexp;
    row.revokedAt = null;

    const grant: PartnerOperatorGrant = {
      grantId,
      operatorId,
      operatorName: STAFF_OPERATOR_NAME,
      siteId: input.siteId,
      sessionIds: [input.sessionId],
      capabilities,
      grantExpiresAt: gexp,
      origin: 'staff',
      issuedByUserId: input.actorUserId,
    };
    if (obo !== undefined) grant.onBehalfOfMemberSeqno = obo;

    const detail: PartnerOperatorAuditDetail = {
      sessionCount: 1,
      capabilities,
      ttlSeconds: gexp - nowSec,
      reason,
      notAfterUnix: Number.isFinite(cap) ? cap : null,
    };
    const issued = await this.issue({
      row,
      grant,
      siteName: input.siteName ?? '',
      nowSec,
      audit: {
        grantId,
        origin: 'staff',
        actorUserId: input.actorUserId,
        siteId: input.siteId,
        sessionId: input.sessionId,
        operatorId,
        operatorName: STAFF_OPERATOR_NAME,
        action: 'grant.mint',
        detail,
      },
    });

    this.logger.log(
      `[partner-operator] staff grant site=${input.siteId} grant=${grantId} actor=${input.actorUserId} session=${input.sessionId} caps=${capabilities.join(',')} exp=${issued.grantExpiresAt}`,
    );

    return {
      success: true,
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: issued.accessExpiresIn,
      grantId,
      grantExpiresAt: issued.grantExpiresAt,
      capabilities: [...capabilities],
    };
  }

  // ──────────────────────────── refresh ───────────────────────────

  /**
   * 운영자 리프레시 토큰(서명 검증 완료된 페이로드) → 새 액세스 토큰.
   * 클레임(범위·권한·만료)은 그대로 복사하므로 갱신으로 범위가 넓어지거나 만료가 늘지 않는다.
   * 실패는 모두 기존 shop 갱신과 같은 401 REFRESH_TOKEN_EXPIRED 본문.
   */
  async refresh(
    payload: unknown,
    nowSec: number = nowUnixSeconds(),
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const grant = isPartnerOperatorClaims(payload)
      ? grantFromClaims(payload, 'refresh', nowSec)
      : null;
    if (!grant) {
      throw new UnauthorizedException({ ...REFRESH_EXPIRED_BODY });
    }
    try {
      await this.assertActive(grant, nowSec);
    } catch {
      throw new UnauthorizedException({ ...REFRESH_EXPIRED_BODY });
    }
    const siteName =
      typeof (payload as { siteName?: unknown }).siteName === 'string'
        ? ((payload as { siteName: string }).siteName)
        : '';
    const expiresIn = Math.min(ACCESS_MAX, grant.grantExpiresAt - nowSec);
    const accessToken = this.jwtService.sign(
      { ...claimsFromGrant(grant, siteName, 'access'), iat: nowSec },
      { expiresIn },
    );
    return { accessToken, expiresIn };
  }

  // ────────────────────────── assertActive ────────────────────────

  /**
   * 권한 행 1회 조회(사이트 조인)로 다음을 모두 확인한다. 하나라도 어긋나거나 DB 오류면 401.
   *  - 행 존재 · 같은 사이트 · 같은 운영자 · 미취소 · 미만료(행 기준, 토큰 gexp 도 행을 넘지 않음)
   *  - 토큰의 세션 범위·권한이 행의 범위 안
   *  - 사이트 status 'active'
   *  - 발급 키 지문이 현재 사이트 편집기/워커 코드 지문과 일치(키 교체 시 무효)
   * 사이트 코드는 이 메서드의 메모리 비교에만 쓰고 기록하지 않는다.
   */
  async assertActive(grant: PartnerOperatorGrant, nowSec: number = nowUnixSeconds()): Promise<void> {
    // 관리자 발급 권한(토큰 org 'staff')은 별도 분기 — 키 지문·사이트 상태 대신 관리자 역할·보관기간을 확인한다.
    if (grantOrigin(grant) === 'staff') {
      await this.assertStaffActive(grant, nowSec);
      return;
    }
    let row: ActiveGrantRow | undefined;
    try {
      row = await this.grantRepository
        .createQueryBuilder('g')
        .innerJoin(Site, 's', 's.id = g.siteId')
        .select('g.id', 'id')
        .addSelect('g.siteId', 'siteId')
        .addSelect('g.operatorId', 'operatorId')
        .addSelect('g.sessionIds', 'sessionIds')
        .addSelect('g.capabilities', 'capabilities')
        .addSelect('g.keyFp', 'keyFp')
        .addSelect('g.expiresAtUnix', 'expiresAtUnix')
        .addSelect('g.revokedAt', 'revokedAt')
        .addSelect('g.origin', 'origin')
        .addSelect('s.status', 'siteStatus')
        .addSelect('s.editorAuthCode', 'editorCode')
        .addSelect('s.workerAuthCode', 'workerCode')
        .where('g.id = :id', { id: grant.grantId })
        .getRawOne<ActiveGrantRow>();
    } catch (e) {
      this.logger.warn(
        `[partner-operator] 권한 확인 조회 실패(거부) grant=${grant.grantId}: ${(e as Error)?.message}`,
      );
      throw grantInvalid();
    }

    if (!row) throw grantInvalid();
    // 출처 대조 — 파트너 토큰은 파트너 행에만 맞는다(관리자 행의 NULL 지문 우회 차단).
    if (row.origin !== 'partner') throw grantInvalid();
    if (row.siteId !== grant.siteId) throw grantInvalid();
    if (row.operatorId !== grant.operatorId) throw grantInvalid();
    if (row.revokedAt !== null && row.revokedAt !== undefined) throw grantInvalid();
    const rowExp = Number(row.expiresAtUnix);
    if (!Number.isFinite(rowExp) || rowExp <= nowSec) throw grantInvalid();
    if (grant.grantExpiresAt > rowExp) throw grantInvalid();
    if (row.siteStatus !== 'active') throw grantInvalid();

    const rowSessions = new Set(parseSessionIds(row.sessionIds));
    if (!grant.sessionIds.every((s) => rowSessions.has(s))) throw grantInvalid();
    const rowCaps = new Set(parseCapabilities(row.capabilities));
    if (!grant.capabilities.every((c) => rowCaps.has(c))) throw grantInvalid();

    const fp = typeof row.keyFp === 'string' ? row.keyFp.trim() : '';
    const candidates = [row.editorCode, row.workerCode]
      .filter((c): c is string => typeof c === 'string' && c.length > 0)
      .map((c) => keyFingerprint(c));
    if (!fp || !candidates.some((c) => fingerprintEquals(c, fp))) throw grantInvalid();
  }

  /**
   * 관리자 발급 권한 확인(2026-09-29). 하나라도 어긋나거나 DB 오류면 401(fail-closed):
   *  - 행 존재 · origin 'staff' · 같은 사이트·운영자 · 미취소 · 미만료 · 범위/권한이 행 안
   *  - key_fp NULL · issued_by_user_id 존재 · operatorId === 'staff.' + issued_by_user_id
   *  - 발급자 계정 존재 + (전역 역할 또는 그 사이트 user_site_roles 행) — 1회 조회(LEFT JOIN)
   *  - 'delete' 권한은 전역 또는 그 사이트 행 역할 SITE_ADMIN 일 때만
   *  - 세션의 현재 편집데이터 보관기간이 만료 전(세션·사이트 PK 조회 2회, 조인 없음)
   * 사이트 상태(운영중지)는 보지 않는다 — 관리자는 운영중지 파트너의 데이터도 관리한다.
   * 통과하면 grant.issuedByUserId 를 행 값으로 채운다(감사 actor 출처).
   */
  private async assertStaffActive(grant: PartnerOperatorGrant, nowSec: number): Promise<void> {
    if (!this.userRepository) throw grantInvalid();
    let row: StaffActiveGrantRow | undefined;
    try {
      row = await this.grantRepository
        .createQueryBuilder('g')
        .select('g.id', 'id')
        .addSelect('g.siteId', 'siteId')
        .addSelect('g.operatorId', 'operatorId')
        .addSelect('g.sessionIds', 'sessionIds')
        .addSelect('g.capabilities', 'capabilities')
        .addSelect('g.keyFp', 'keyFp')
        .addSelect('g.expiresAtUnix', 'expiresAtUnix')
        .addSelect('g.revokedAt', 'revokedAt')
        .addSelect('g.origin', 'origin')
        .addSelect('g.issuedByUserId', 'issuedByUserId')
        .where('g.id = :id', { id: grant.grantId })
        .getRawOne<StaffActiveGrantRow>();
    } catch (e) {
      this.logger.warn(
        `[partner-operator] 관리자 권한 확인 조회 실패(거부) grant=${grant.grantId}: ${(e as Error)?.message}`,
      );
      throw grantInvalid();
    }

    if (!row) throw grantInvalid();
    if (row.origin !== 'staff') throw grantInvalid();
    if (row.siteId !== grant.siteId) throw grantInvalid();
    if (row.operatorId !== grant.operatorId) throw grantInvalid();
    if (row.revokedAt !== null && row.revokedAt !== undefined) throw grantInvalid();
    const rowExp = Number(row.expiresAtUnix);
    if (!Number.isFinite(rowExp) || rowExp <= nowSec) throw grantInvalid();
    if (grant.grantExpiresAt > rowExp) throw grantInvalid();
    const rowSessions = new Set(parseSessionIds(row.sessionIds));
    if (!grant.sessionIds.every((s) => rowSessions.has(s))) throw grantInvalid();
    const rowCaps = new Set(parseCapabilities(row.capabilities));
    if (!grant.capabilities.every((c) => rowCaps.has(c))) throw grantInvalid();
    if (row.keyFp !== null && row.keyFp !== undefined) throw grantInvalid();
    const issuedBy = typeof row.issuedByUserId === 'string' ? row.issuedByUserId : '';
    if (issuedBy.length === 0) throw grantInvalid();
    if (row.operatorId !== `staff.${issuedBy}`) throw grantInvalid();

    let roles: { userRole: string | null; siteRole: string | null } | undefined;
    let sessionRow: Pick<EditSessionEntity, 'id' | 'createdAt' | 'guestToken' | 'guestExpiresAt'> | null;
    let siteRow: Pick<Site, 'id' | 'editRetentionDays'> | null;
    try {
      roles = await this.userRepository
        .createQueryBuilder('u')
        .leftJoin(UserSiteRole, 'usr', 'usr.userId = u.id AND usr.siteId = :siteId', {
          siteId: grant.siteId,
        })
        .select('u.role', 'userRole')
        .addSelect('usr.role', 'siteRole')
        .where('u.id = :uid', { uid: issuedBy })
        .getRawOne<{ userRole: string | null; siteRole: string | null }>();
      if (!roles) throw grantInvalid();

      const global = typeof roles.userRole === 'string' && GLOBAL_STAFF_ROLES.has(roles.userRole);
      const siteRole = typeof roles.siteRole === 'string' ? roles.siteRole : null;
      if (!global && siteRole === null) throw grantInvalid();
      if (grant.capabilities.includes('delete') && !global && siteRole !== UserRole.SITE_ADMIN) {
        throw grantInvalid();
      }

      // 보관기간 재확인 — 세션·사이트 각각 PK 조회(조인 없음).
      const sessionId = grant.sessionIds[0];
      sessionRow = await this.sessionRepository.findOne({
        where: { id: sessionId },
        select: ['id', 'createdAt', 'guestToken', 'guestExpiresAt'],
        withDeleted: true,
      });
      siteRow = await this.siteRepository.findOne({
        where: { id: grant.siteId },
        select: ['id', 'editRetentionDays'],
      });
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      this.logger.warn(
        `[partner-operator] 관리자 권한 역할·보관기간 확인 실패(거부) grant=${grant.grantId}: ${(e as Error)?.message}`,
      );
      throw grantInvalid();
    }
    if (!sessionRow || !siteRow) throw grantInvalid();
    const retention = computeEditRetention(
      {
        createdAt: sessionRow.createdAt,
        isGuest: !!sessionRow.guestToken,
        guestExpiresAt: sessionRow.guestExpiresAt,
      },
      siteRow.editRetentionDays,
      new Date(nowSec * 1000),
    );
    if (retention.state === 'expired') throw grantInvalid();

    grant.issuedByUserId = issuedBy;
  }

  // ───────────────────────────── revoke ───────────────────────────

  async revoke(
    site: CurrentSitePayload | undefined,
    dto: RevokePartnerOperatorSessionDto,
  ): Promise<PartnerOperatorRevokeResponseDto> {
    assertPartnerOperatorSiteCaller(site);
    const byId = typeof dto?.grantId === 'string' && dto.grantId.length > 0;
    const byAll = dto?.all === true;
    if (byId === byAll) {
      throw new BadRequestException({
        code: 'PARTNER_OPERATOR_REVOKE_TARGET_REQUIRED',
        message: 'grantId 또는 all:true 중 하나만 지정해야 합니다.',
      });
    }

    // 파트너 취소는 파트너 발급 권한만(origin 'partner') — 관리자 발급 권한은 건드리지 않는다.
    const where: FindOptionsWhere<PartnerOperatorGrantEntity> = {
      siteId: site.siteId,
      origin: 'partner',
      revokedAt: IsNull(),
    };
    if (byId) where.id = dto.grantId;

    let targets: Array<Pick<PartnerOperatorGrantEntity, 'id' | 'operatorId' | 'operatorName'>>;
    let revoked = 0;
    try {
      targets = await this.grantRepository.find({
        where,
        select: ['id', 'operatorId', 'operatorName'],
      });
      if (targets.length > 0) {
        const result = await this.grantRepository.update(
          { id: In(targets.map((t) => t.id)), siteId: site.siteId, origin: 'partner', revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
        revoked = typeof result?.affected === 'number' ? result.affected : targets.length;
      }
    } catch (e) {
      this.logger.error(`[partner-operator] 취소 실패 site=${site.siteId}: ${(e as Error)?.message}`);
      throw unavailable();
    }

    // 취소는 감사 기록 실패로 막지 않는다(취소가 우선). 기록은 best-effort.
    const keyFp = site.apiKey ? keyFingerprint(site.apiKey) : null;
    for (const t of targets) {
      await this.auditWriter.recordBestEffort({
        grantId: t.id,
        siteId: site.siteId,
        sessionId: null,
        operatorId: t.operatorId,
        operatorName: t.operatorName,
        action: 'grant.revoke',
        detail: { by: 'api_key', keyFp },
      });
    }

    this.logger.log(
      `[partner-operator] revoke site=${site.siteId} grant=${byId ? dto.grantId : 'all'} count=${revoked}`,
    );
    return { success: true, revoked };
  }

  // ───────────────────────────── audit ────────────────────────────

  async audit(
    site: CurrentSitePayload | undefined,
    query: PartnerOperatorAuditQueryDto,
  ): Promise<PartnerOperatorAuditResponseDto> {
    assertPartnerOperatorSiteCaller(site);
    const items = await this.auditWriter.list(site.siteId, {
      sessionId: query?.sessionId,
      grantId: query?.grantId,
      limit: query?.limit,
      before: query?.before,
    });
    return { success: true, items };
  }

  // ──────────────────────── staff: list / revoke ────────────────────────

  /** 세션의 관리자 발급 권한 목록(origin 'staff', 최신순 50건). NULL-site 세션은 관리자 권한이 없다. */
  async listStaffGrantsForSession(
    sessionId: string,
    siteId: string | null,
  ): Promise<StaffGrantListItem[]> {
    if (typeof siteId !== 'string' || siteId.length === 0) return [];
    const rows = await this.grantRepository
      .createQueryBuilder('g')
      .select([
        'g.id',
        'g.operatorId',
        'g.issuedByUserId',
        'g.capabilities',
        'g.expiresAtUnix',
        'g.revokedAt',
        'g.createdAt',
      ])
      .where('g.origin = :origin', { origin: 'staff' })
      .andWhere('g.siteId = :siteId', { siteId })
      .andWhere('JSON_CONTAINS(g.session_ids, JSON_QUOTE(:sid))', { sid: sessionId })
      .orderBy('g.createdAt', 'DESC')
      .take(50)
      .getMany();
    return rows.map((r) => ({
      id: r.id,
      operatorId: r.operatorId,
      issuedByUserId: r.issuedByUserId ?? null,
      capabilities: parseCapabilities(r.capabilities).filter(
        (c): c is PartnerOperatorCapability => c === 'edit' || c === 'delete',
      ),
      expiresAt: new Date(Number(r.expiresAtUnix) * 1000).toISOString(),
      revokedAt: r.revokedAt ?? null,
      createdAt: r.createdAt,
    }));
  }

  /**
   * 관리자 발급 권한 취소. origin 'staff' + 호출자 사이트 범위 안이 아니면 404 GRANT_NOT_FOUND.
   * 'staff.grant.revoke' 감사(fail-closed, 실패 시 503 STAFF_AUDIT_UNAVAILABLE) 후 revoked_at 이 NULL 일 때만 설정(멱등).
   */
  async revokeStaff(
    grantId: string,
    scope: { global: boolean; siteIds: string[] },
    actorUserId: string,
  ): Promise<StaffGrantRevokeResult> {
    const row = await this.grantRepository.findOne({
      where: { id: grantId, origin: 'staff' },
      select: ['id', 'siteId', 'sessionIds', 'revokedAt'],
    });
    if (!row) throw grantNotFound();
    if (!scope.global && !scope.siteIds.includes(row.siteId)) throw grantNotFound();

    const alreadyRevoked = row.revokedAt !== null && row.revokedAt !== undefined;
    const sessions = parseSessionIds(row.sessionIds);
    try {
      await this.auditWriter.recordOrThrow({
        grantId: row.id,
        origin: 'staff',
        actorUserId,
        siteId: row.siteId,
        sessionId: sessions[0] ?? null,
        operatorId: `staff.${actorUserId}`,
        operatorName: STAFF_OPERATOR_NAME,
        action: 'staff.grant.revoke',
        detail: { alreadyRevoked },
      });
    } catch {
      throw staffAuditUnavailable();
    }

    let revoked = false;
    if (!alreadyRevoked) {
      const result = await this.grantRepository.update(
        { id: row.id, origin: 'staff', revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      revoked = typeof result?.affected === 'number' ? result.affected > 0 : true;
    }
    this.logger.log(
      `[partner-operator] staff revoke grant=${row.id} site=${row.siteId} actor=${actorUserId} revoked=${revoked}`,
    );
    return { success: true, grantId: row.id, revoked };
  }
}
