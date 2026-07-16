/**
 * Partner API v1 가드 계약 spec (2026-07-15 적대 리뷰 P2-1)
 *
 * contract-freeze / guarded-routes 의 자매 spec — v1 표면("v1/" prefix 컨트롤러)의
 * **인증 시맨틱만** 리플렉션으로 고정한다. v1 은 "무인증 라우트 0" 원칙:
 * 모든 v1 컨트롤러는 @PartnerV1Controller 조합 데코레이터를 통해
 *  ① 클래스 GUARDS_METADATA 에 PartnerApiKeyGuard (파트너 키 강제)
 *  ② IS_PUBLIC_KEY = true (전역 JwtAuthGuard 우회 + 자체 가드 조합 — 하우스 패턴)
 * 를 반드시 갖는다. 이 spec 이 지키는 회귀 2방향:
 *  (a) PartnerApiKeyGuard 누락(맨 @Controller('v1/...') 신설 포함) → 무인증 개방 즉시 red
 *  (b) @Public 누락 → 전역 JwtAuthGuard 로 파트너 키 호출 전면 401 즉시 red
 *
 * ── 전수성(스냅샷) 보장 ──
 * AppModule 은 실 DB 연결(TypeORM forRoot) 때문에 테스트에서 compile 불가하므로
 * DiscoveryService 대신 **파일시스템 전수 스캔**(testing/v1-controller-scan)으로 실제
 * v1 컨트롤러를 센다 → 아래 명시 목록과 집합 일치를 단언한다.
 * (모듈 미등록 컨트롤러까지 잡으므로 DiscoveryService 보다 검출 범위가 넓다)
 *
 * ⚠️ 새 v1 컨트롤러(Stage 3+ books/templates/webhooks 등)를 추가하면
 *    반드시 아래 V1_CONTROLLERS 목록에 등재하라 — 미등재 시 집합 단언이 red.
 *    (OpenAPI export 등재도 별도로 필요 — scripts/partner-openapi-surface.spec 참조)
 */
import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './auth/decorators/public.decorator';
import { PartnerApiKeyGuard } from './partner-api/guards/partner-api-key.guard';
import { PartnerPingController } from './partner-api/ping.controller';
import { BookSpecsController } from './book-specs/book-specs.controller';
import { BooksController } from './books/books.controller';
import { PartnerWebhooksController } from './webhook/v2/partner-webhooks.controller';
import { Ctor, discoverV1Controllers } from './testing/v1-controller-scan';

/**
 * v1 컨트롤러 명시 열거 — 새 v1 컨트롤러 추가 시 여기에 등재 필수.
 * (등재 누락 = 아래 "전수 스캔 집합 일치" 단언이 red 로 강제한다)
 */
const V1_CONTROLLERS: Array<{ name: string; controller: Ctor }> = [
  { name: 'PartnerPingController (v1)', controller: PartnerPingController },
  { name: 'BookSpecsController (v1/book-specs)', controller: BookSpecsController },
  { name: 'BooksController (v1/books)', controller: BooksController },
  {
    name: 'PartnerWebhooksController (v1/webhooks)',
    controller: PartnerWebhooksController,
  },
];

describe('Partner API v1 — 가드 계약 (무인증 라우트 0 원칙)', () => {
  describe('전수성 스냅샷 — 실제 v1 컨트롤러 == 명시 목록', () => {
    const discovered = discoverV1Controllers();

    it(`v1 컨트롤러 수 스냅샷 = ${V1_CONTROLLERS.length} (신규 v1 컨트롤러는 V1_CONTROLLERS 에 등재하라)`, () => {
      const discoveredNames = [...discovered.entries()].map(
        ([ctor, file]) => `${ctor.name} @ ${file}`,
      );
      // 미등재 신규 v1 컨트롤러가 생기면 여기서 red — 목록 등재 + 가드 단언을 강제
      expect(discoveredNames.sort()).toHaveLength(V1_CONTROLLERS.length);
    });

    it('전수 스캔 집합과 명시 목록이 정확히 일치한다', () => {
      const discoveredSet = new Set<Ctor>(discovered.keys());
      const enumeratedSet = new Set<Ctor>(V1_CONTROLLERS.map((c) => c.controller));
      const missing = [...discoveredSet]
        .filter((c) => !enumeratedSet.has(c))
        .map((c) => `${(c as { name?: string }).name} @ ${discovered.get(c)}`);
      const stale = [...enumeratedSet]
        .filter((c) => !discoveredSet.has(c))
        .map((c) => (c as { name?: string }).name);

      expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    });
  });

  describe.each(V1_CONTROLLERS.map((c) => [c.name, c.controller] as const))(
    '%s',
    (_label, controller) => {
      it('① 클래스 가드에 PartnerApiKeyGuard 존재 (제거 = 무인증 개방 보안 회귀)', () => {
        const guards: unknown[] =
          Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
        expect(guards.includes(PartnerApiKeyGuard)).toBe(true);
      });

      it('② IS_PUBLIC_KEY = true (전역 JwtAuthGuard 우회 + 자체 가드 조합)', () => {
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, controller)).toBe(true);
      });
    },
  );
});
