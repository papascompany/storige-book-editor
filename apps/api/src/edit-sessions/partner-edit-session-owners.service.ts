import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EditSessionEntity, SessionStatus } from './entities/edit-session.entity';
import {
  PartnerSessionOwnerDto,
  PartnerSessionOwnerStatus,
} from './dto/partner-session-owners.dto';

/** 원시 조회 행 — 필요한 컬럼만. guest_token 값은 읽지 않고 존재 여부만 계산한다. */
interface OwnerRow {
  id: unknown;
  memberSeqno: unknown;
  orderSeqno: unknown;
  status: unknown;
  hasGuestToken: unknown;
}

/**
 * 호출 사이트 소속·삭제되지 않은 세션만 찾는다(site_id 엄격 일치 — 무소속 세션 제외).
 * 파라미터: [중복 제거한 id 목록, 호출 사이트 id]
 */
export const PARTNER_OWNERS_SQL = `SELECT s.id AS id, s.member_seqno AS memberSeqno, s.order_seqno AS orderSeqno, s.status AS status,
       (s.guest_token IS NOT NULL) AS hasGuestToken
  FROM file_edit_sessions s
 WHERE s.id IN (?) AND s.site_id = ? AND s.deleted_at IS NULL`;

const SESSION_STATUSES: ReadonlySet<string> = new Set<string>(Object.values(SessionStatus));

function notFound(sessionId: string): PartnerSessionOwnerDto {
  return {
    sessionId,
    found: false,
    memberSeqno: null,
    guest: false,
    orderSeqno: null,
    status: null,
  };
}

function toPositiveSafeInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function toSafeInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

function toStatus(value: unknown): PartnerSessionOwnerStatus | null {
  return typeof value === 'string' && SESSION_STATUSES.has(value)
    ? (value as PartnerSessionOwnerStatus)
    : null;
}

/**
 * 파트너 서버 간 편집 세션 소유자 배치 조회(ADDITIVE 2026-09-30).
 *
 * - 쿼리는 1회(IN). 응답은 입력 원소마다 1개(순서·길이 동일, 중복 id 는 같은 결과 반복).
 * - 다른 사이트·무소속·삭제·없음은 모두 같은 found:false 객체.
 * - 게스트(회원 번호 0 이하 또는 게스트 토큰 보유)는 guest:true·memberSeqno:null.
 * - 게스트 세션의 orderSeqno 0(주문 번호 없음)은 null 로 정규화한다. 회원 세션은 저장값 그대로
 *   (정수로 표현할 수 없는 값만 null).
 */
@Injectable()
export class PartnerEditSessionOwnersService {
  private readonly logger = new Logger(PartnerEditSessionOwnersService.name);

  constructor(
    @InjectRepository(EditSessionEntity)
    private readonly sessions: Repository<EditSessionEntity>,
  ) {}

  async lookup(
    siteId: string,
    sessionIds: readonly string[],
  ): Promise<PartnerSessionOwnerDto[]> {
    const unique = Array.from(new Set(sessionIds));
    const rows: unknown = await this.sessions.manager.query(PARTNER_OWNERS_SQL, [unique, siteId]);
    const list: OwnerRow[] = Array.isArray(rows) ? (rows as OwnerRow[]) : [];

    const byId = new Map<string, PartnerSessionOwnerDto>();
    for (const r of list) {
      const id = String(r.id);
      const member = Number(r.memberSeqno);
      const guest = Number(r.hasGuestToken) === 1 || !(member > 0);
      byId.set(id, {
        sessionId: id,
        found: true,
        memberSeqno: guest ? null : toPositiveSafeInt(member),
        guest,
        orderSeqno: guest ? toPositiveSafeInt(r.orderSeqno) : toSafeInt(r.orderSeqno),
        status: toStatus(r.status),
      });
    }

    this.logger.debug(
      `[partner-owners] site=${siteId} requested=${sessionIds.length} unique=${unique.length} found=${byId.size}`,
    );

    return sessionIds.map((id) => {
      const hit = byId.get(id);
      return hit ? { ...hit, sessionId: id } : notFound(id);
    });
  }
}
