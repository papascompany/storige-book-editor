/**
 * v1 페이지네이션 유틸 unit spec (Stage 1 작업 6 — 설계서 §5.1).
 * 경계: limit 0/101/음수/비정수, offset 음수, 기본값, hasNext 산식.
 */
import { normalizePaginationQuery, buildPagination, PaginatedResult } from './pagination';
import { PartnerApiException } from './partner-api.exceptions';
import { ErrV1 } from '@storige/types';

describe('normalizePaginationQuery (§5.1)', () => {
  it('미제공 — 기본 limit 20 / offset 0', () => {
    expect(normalizePaginationQuery({})).toEqual({ limit: 20, offset: 0 });
  });

  it('정상값 파싱 (문자열 쿼리)', () => {
    expect(normalizePaginationQuery({ limit: '50', offset: '40' })).toEqual({
      limit: 50,
      offset: 40,
    });
  });

  it('limit 최대 100 — 초과값(101)은 100으로 캡(에러 아님)', () => {
    expect(normalizePaginationQuery({ limit: '101' }).limit).toBe(100);
    expect(normalizePaginationQuery({ limit: '100' }).limit).toBe(100);
    expect(normalizePaginationQuery({ limit: '99999' }).limit).toBe(100);
  });

  it.each([['0'], ['-5'], ['1.5'], ['abc'], [['10', '20']]])(
    'limit=%p — 400 ERR_VALIDATION_FAILED + fieldErrors.limit',
    (bad) => {
      try {
        normalizePaginationQuery({ limit: bad });
        fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PartnerApiException);
        const e = err as PartnerApiException;
        expect(e.getStatus()).toBe(400);
        expect(e.errorCode).toBe(ErrV1.ERR_VALIDATION_FAILED);
        expect(e.fieldErrors?.limit).toBeDefined();
      }
    },
  );

  it.each([['-1'], ['2.5'], ['xyz']])(
    'offset=%p — 400 ERR_VALIDATION_FAILED + fieldErrors.offset',
    (bad) => {
      try {
        normalizePaginationQuery({ offset: bad });
        fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(PartnerApiException);
        expect((err as PartnerApiException).fieldErrors?.offset).toBeDefined();
      }
    },
  );

  it('offset=0 명시는 유효', () => {
    expect(normalizePaginationQuery({ offset: '0' }).offset).toBe(0);
  });
});

describe('buildPagination — hasNext 산식', () => {
  it('offset+limit < total → hasNext true', () => {
    expect(buildPagination(137, { limit: 20, offset: 40 })).toEqual({
      total: 137,
      limit: 20,
      offset: 40,
      hasNext: true,
    });
  });

  it('offset+limit == total → hasNext false (경계)', () => {
    expect(buildPagination(60, { limit: 20, offset: 40 }).hasNext).toBe(false);
  });

  it('total=0 → hasNext false', () => {
    expect(buildPagination(0, { limit: 20, offset: 0 }).hasNext).toBe(false);
  });
});

describe('PaginatedResult', () => {
  it('items + pagination 을 함께 운반 (봉투 인터셉터 계약)', () => {
    const result = PaginatedResult.of([{ id: 1 }], 1, { limit: 20, offset: 0 });
    expect(result.items).toEqual([{ id: 1 }]);
    expect(result.pagination).toEqual({ total: 1, limit: 20, offset: 0, hasNext: false });
  });
});
