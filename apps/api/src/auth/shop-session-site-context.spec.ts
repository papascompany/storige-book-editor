/**
 * F-4 (2026-07-30) — shop-session 리프레시 후에도 site 컨텍스트가 살아남는가.
 *
 * 왜 중요한가: 게스트 세션 siteId 스탬프의 유일한 근거는 **서명 검증된 shop-session
 * JWT 의 payload.siteId** 다. 그런데 refreshToken 이 siteId 를 담지 않으면,
 * refreshShopToken 의 `if (payload.siteId)` 보존 분기가 영원히 거짓이 되어
 * 사일런트 리프레시(액세스 토큰 1h 만료) 직후부터 토큰이 site 를 영구 상실한다.
 * → 그 시점 이후 생성되는 게스트 세션은 다시 NULL-site 가 되고 승격이 404 다.
 *   즉 채택한 테넌트 근거의 **커버리지가 새는 구멍**이라 스탬프와 한 몸으로 잠근다.
 */
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';

const SECRET = 'shop-site-context-spec';
const SITE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('shop-session site 컨텍스트 보존 (F-4)', () => {
  const jwt = new JwtService({ secret: SECRET });
  const service = new AuthService({} as any, jwt);

  const shopDto = {
    memberSeqno: 1049737389,
    memberId: 'a@b.c',
    memberName: '홍길동',
    phpSessionId: 'php-1',
  } as any;

  const decode = (token: string) => jwt.verify(token) as Record<string, unknown>;

  it('T16 createShopSession: accessToken 과 refreshToken 둘 다 siteId 를 담는다', async () => {
    const { accessToken, refreshToken } = await service.createShopSession(shopDto, {
      siteId: SITE_ID,
      siteName: 'Site A',
    });

    expect(decode(accessToken).siteId).toBe(SITE_ID);
    // ← 이 단언이 F-4 의 핵심. 없으면 리프레시 후 site 를 잃는다.
    expect(decode(refreshToken).siteId).toBe(SITE_ID);
    expect(decode(refreshToken).siteName).toBe('Site A');
  });

  it('T16-b refreshShopToken: 갱신된 accessToken 이 siteId/siteName 을 보존한다', async () => {
    const { refreshToken } = await service.createShopSession(shopDto, {
      siteId: SITE_ID,
      siteName: 'Site A',
    });

    const { accessToken } = await service.refreshShopToken(refreshToken);

    expect(decode(accessToken).siteId).toBe(SITE_ID);
    expect(decode(accessToken).siteName).toBe('Site A');
    expect(decode(accessToken).source).toBe('shop');
  });

  it('비파괴: siteContext 없는 발급(레거시 파트너)은 siteId 를 넣지 않는다', async () => {
    const { accessToken, refreshToken } = await service.createShopSession(shopDto);

    expect(decode(accessToken).siteId).toBeUndefined();
    expect(decode(refreshToken).siteId).toBeUndefined();

    // 구형(siteId 미포함) 리프레시 토큰도 종전대로 갱신된다 — 점진 개선, 파손 없음
    const { accessToken: renewed } = await service.refreshShopToken(refreshToken);
    expect(decode(renewed).siteId).toBeUndefined();
    expect(decode(renewed).source).toBe('shop');
  });

  it('비파괴: allowedOrderSeqnos 주문 스코프는 종전대로 보존된다', async () => {
    const { accessToken, refreshToken } = await service.createShopSession(
      { ...shopDto, orderSeqno: 555 },
      { siteId: SITE_ID, siteName: 'Site A' },
    );

    expect(decode(accessToken).allowedOrderSeqnos).toEqual([555]);
    expect(decode(refreshToken).allowedOrderSeqnos).toEqual([555]);
  });
});
