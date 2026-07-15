import { ErrV1, PartnerV1Pagination } from '@storige/types';
import { PartnerApiException } from './partner-api.exceptions';

/**
 * v1 페이지네이션 규약 (설계서 §5.1) — v1 목록 라우트 공통 유틸.
 *
 * - limit: 기본 20, 최대 100 — **초과값은 100으로 캡**(에러 아님).
 *   0 이하/비정수는 400 ERR_VALIDATION_FAILED.
 * - offset: 기본 0. 음수/비정수는 400.
 * - 응답 pagination = {total, limit, offset, hasNext}.
 * - 정렬 기본 created_at DESC 는 각 라우트 쿼리 책임(문서 명기 사항).
 *
 * 사용(목록 라우트 패턴 — 봉투 인터셉터가 pagination 을 채운다):
 *   @Get()
 *   async list(@Query() query: Record<string, unknown>) {
 *     const page = normalizePaginationQuery(query);
 *     const [rows, total] = await repo.findAndCount({ take: page.limit, skip: page.offset });
 *     return PaginatedResult.of(rows, total, page);
 *   }
 */

export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export interface NormalizedPagination {
  limit: number;
  offset: number;
}

/** 목록 응답 컨테이너 — PartnerEnvelopeInterceptor 가 data/pagination 으로 풀어낸다 */
export class PaginatedResult<T> {
  private constructor(
    readonly items: T[],
    readonly pagination: PartnerV1Pagination,
  ) {}

  static of<T>(
    items: T[],
    total: number,
    page: NormalizedPagination,
  ): PaginatedResult<T> {
    return new PaginatedResult(items, buildPagination(total, page));
  }
}

export function buildPagination(
  total: number,
  page: NormalizedPagination,
): PartnerV1Pagination {
  return {
    total,
    limit: page.limit,
    offset: page.offset,
    hasNext: page.offset + page.limit < total,
  };
}

function invalidParam(field: string, message: string): PartnerApiException {
  return new PartnerApiException(
    ErrV1.ERR_VALIDATION_FAILED,
    400,
    '요청 검증에 실패했습니다',
    [],
    { [field]: [message] },
  );
}

/** 쿼리값(string|string[]|number|undefined) → 정수. 비정수/배열은 null */
function parseIntStrict(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

/**
 * limit/offset 쿼리 정규화 — 미제공 기본값, 위반 시 400(fieldErrors 동반),
 * limit 초과값은 100 캡(설계서 §5.1).
 */
export function normalizePaginationQuery(
  query: Record<string, unknown>,
): NormalizedPagination {
  let limit = PAGINATION_DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== '') {
    const parsed = parseIntStrict(query.limit);
    if (parsed === null || parsed < 1) {
      throw invalidParam('limit', 'limit 은 1 이상의 정수여야 합니다 (최대 100, 초과값은 100으로 캡)');
    }
    limit = Math.min(parsed, PAGINATION_MAX_LIMIT);
  }

  let offset = 0;
  if (query.offset !== undefined && query.offset !== '') {
    const parsed = parseIntStrict(query.offset);
    if (parsed === null || parsed < 0) {
      throw invalidParam('offset', 'offset 은 0 이상의 정수여야 합니다');
    }
    offset = parsed;
  }

  return { limit, offset };
}
