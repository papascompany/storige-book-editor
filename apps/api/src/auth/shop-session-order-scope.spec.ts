/**
 * shop-session 주문 범위(orderSeqno·allowedOrderSeqnos) 운영 관측.
 *
 *  - 양의 정수가 아닌 값(0·음수·소수·안전 정수 범위 밖)이 있으면 필드·유형별 `[shop-session] order-scope-invalid` 로그.
 *  - 로그에는 필드·유형·사이트만(값·회원 정보 미기록).
 *  - 토큰 발급 결과는 그대로(allowedOrderSeqnos 클레임 포함 규칙 불변).
 */
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService, classifyOrderScopeValue } from './auth.service';
import type { CreateShopSessionDto } from './dto/shop-session.dto';

const SECRET = 'shop-session-order-scope-spec';
const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('classifyOrderScopeValue', () => {
  it.each<[unknown, string | null]>([
    [1, null],
    [2026093000001, null],
    [Number.MAX_SAFE_INTEGER, null],
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fraction'],
    [9007199254740993, 'unsafe'],
    [Number.POSITIVE_INFINITY, 'unsafe'],
    [Number.NaN, 'non-number'],
    ['12', 'non-number'],
  ])('%p → %p', (value, expected) => {
    expect(classifyOrderScopeValue(value)).toBe(expected);
  });
});

describe('AuthService.createShopSession — 주문 범위 관측', () => {
  const jwt = new JwtService({ secret: SECRET });
  let service: AuthService;
  let logSpy: jest.SpyInstance;

  const base = {
    memberSeqno: 1049737389,
    memberId: 'member@example.com',
    memberName: '홍길동',
  };
  const scopeLogs = (): string[] =>
    logSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.startsWith('[shop-session]'));
  const decode = (token: string): Record<string, unknown> => jwt.verify(token) as Record<string, unknown>;

  beforeEach(() => {
    service = new AuthService({} as never, jwt);
    logSpy = jest
      .spyOn((service as unknown as { logger: Logger }).logger, 'log')
      .mockImplementation(() => undefined);
  });

  it('S1: 양의 정수 orderSeqno·allowedOrderSeqnos → 로그 없음', async () => {
    await service.createShopSession(
      { ...base, orderSeqno: 2026093000001, allowedOrderSeqnos: [100, 200] } as CreateShopSessionDto,
      { siteId: SITE_ID, siteName: 'A' },
    );
    expect(scopeLogs()).toEqual([]);
  });

  it('S2: 주문 범위 없음 → 로그 없음', async () => {
    await service.createShopSession(base as CreateShopSessionDto);
    expect(scopeLogs()).toEqual([]);
  });

  it.each<[number, string]>([
    [0, 'zero'],
    [-1, 'negative'],
    [1.5, 'fraction'],
    [9007199254740993, 'unsafe'],
  ])('S3: orderSeqno %p → kind=%s 로그 1줄, 토큰 발급은 그대로', async (orderSeqno, kind) => {
    const { accessToken } = await service.createShopSession(
      { ...base, orderSeqno } as CreateShopSessionDto,
      { siteId: SITE_ID, siteName: 'A' },
    );
    expect(scopeLogs()).toEqual([
      `[shop-session] order-scope-invalid field=orderSeqno kind=${kind} site=${SITE_ID}`,
    ]);
    expect(decode(accessToken).allowedOrderSeqnos).toEqual([orderSeqno]);
  });

  it('S4: allowedOrderSeqnos [0, -2, 2.5, 7, -3] → 유형별 1줄씩(중복 유형은 1줄), 값 미기록', async () => {
    const { accessToken } = await service.createShopSession({
      ...base,
      allowedOrderSeqnos: [0, -2, 2.5, 7, -3],
    } as CreateShopSessionDto);
    expect(scopeLogs()).toEqual([
      '[shop-session] order-scope-invalid field=allowedOrderSeqnos kind=zero site=-',
      '[shop-session] order-scope-invalid field=allowedOrderSeqnos kind=negative site=-',
      '[shop-session] order-scope-invalid field=allowedOrderSeqnos kind=fraction site=-',
    ]);
    const text = JSON.stringify(logSpy.mock.calls);
    for (const v of ['-2', '2.5', '-3', '1049737389', 'member@example.com']) {
      expect(text).not.toContain(v);
    }
    expect(decode(accessToken).allowedOrderSeqnos).toEqual([0, -2, 2.5, 7, -3]);
  });
});
