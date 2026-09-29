import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { createHash, randomUUID, timingSafeEqual } from 'crypto';
import { EditSessionEntity } from '../../edit-sessions/entities/edit-session.entity';
import { Site } from '../../sites/entities/site.entity';
import { PartnerOperatorGrantEntity } from '../entities/partner-operator-grant.entity';
import type { CurrentSitePayload } from '../decorators/current-site.decorator';
import {
  CreatePartnerOperatorSessionDto,
  PartnerOperatorAuditQueryDto,
  PartnerOperatorAuditResponseDto,
  PartnerOperatorRevokeResponseDto,
  PartnerOperatorSessionResponseDto,
  RevokePartnerOperatorSessionDto,
} from '../dto/partner-operator-session.dto';
import { PartnerOperatorAuditWriter } from './partner-operator-audit.writer';
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
  isPartnerOperatorClaims,
  nowUnixSeconds,
} from './partner-operator.types';

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
  keyFp: string;
  expiresAtUnix: string | number;
  revokedAt: Date | string | null;
  siteStatus: string | null;
  editorCode: string | null;
  workerCode: string | null;
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

    try {
      await this.grantRepository.insert(row);
    } catch (e) {
      this.logger.error(
        `[partner-operator] 권한 저장 실패 site=${site.siteId} grant=${grantId}: ${(e as Error)?.message}`,
      );
      throw unavailable();
    }

    try {
      await this.auditWriter.recordOrThrow({
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
      });
    } catch {
      // 감사 기록 없이 토큰을 내주지 않는다. 방금 만든 권한 행은 즉시 무효화(best-effort).
      await this.grantRepository
        .update({ id: grantId }, { revokedAt: new Date() })
        .catch(() => undefined);
      throw unavailable();
    }

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

    const accessExpiresIn = Math.min(ACCESS_MAX, gexp - nowSec);
    const accessToken = this.jwtService.sign(
      { ...claimsFromGrant(grant, site.siteName ?? '', 'access'), iat: nowSec },
      { expiresIn: accessExpiresIn },
    );
    const refreshToken = this.jwtService.sign(
      { ...claimsFromGrant(grant, site.siteName ?? '', 'refresh'), iat: nowSec },
      { expiresIn: gexp - nowSec },
    );

    const grantExpiresAt = new Date(gexp * 1000).toISOString();
    this.logger.log(
      `[partner-operator] grant site=${site.siteId} grant=${grantId} op=${dto.operatorId} sessions=${sessionIds.length} caps=${capabilities.join(',')} exp=${grantExpiresAt} key=${keyFp}`,
    );

    return {
      success: true,
      accessToken,
      refreshToken,
      expiresIn: accessExpiresIn,
      grantId,
      grantExpiresAt,
      capabilities: [...capabilities],
      operator: { id: dto.operatorId, name: operatorName },
      scope: { sessionIds: [...sessionIds] },
      orderRef,
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

    const where: FindOptionsWhere<PartnerOperatorGrantEntity> = {
      siteId: site.siteId,
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
          { id: In(targets.map((t) => t.id)), siteId: site.siteId, revokedAt: IsNull() },
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
}
