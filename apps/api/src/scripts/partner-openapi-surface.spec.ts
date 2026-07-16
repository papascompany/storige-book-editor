/**
 * Partner API v1 — OpenAPI export 커버리지 계약 spec (Stage 4 E-2).
 *
 * partner-v1-guarded.spec 의 자매 spec — 같은 **파일시스템 전수 스캔**을 ground truth 로
 * 삼아 "v1 표면 전 라우트가 파트너 OpenAPI 산출물에 실린다"를 고정한다.
 *
 * ── 왜 필요한가(실적발 회귀) ──
 * Stage 3 에서 BooksController(11라우트)가 export 스크립트의 컨트롤러 목록에 등재되지
 * 않아 스펙에서 통째로 증발했다. export 는 **컨트롤러 단위 자동 수집**이므로 컨트롤러
 * 등재 누락 = 그 컨트롤러의 전 라우트 침묵 증발이다. 게다가 REQUIRED_PATHS 에도 books 가
 * 없어 스크립트의 "필수 라우트 누락" 단언이 침묵 — CI 가 잡지 못했다(커버리지 11/22 = 50%).
 * 이 spec 이 그 두 구멍을 동시에 막는다:
 *  ① 컨트롤러 집합 대조  — 신규 v1 컨트롤러 미등재 시 red
 *  ② REQUIRED_PATHS 대조 — 신규 경로 미등재 시 red (단언 침묵 방지)
 *  ③ 실제 산출 문서 대조 — 위를 우회한 어떤 누락도 라우트 단위로 red (최종 게이트)
 *
 * 산출물은 Stage 4 문서 포털의 API 레퍼런스 입력이므로 커버리지 = 파트너 대면 계약이다.
 */
import 'reflect-metadata';
import {
  PARTNER_V1_EXPORT_CONTROLLERS,
  REQUIRED_PATHS,
  assertPartnerDocument,
  buildPartnerOpenApiDocument,
  listDocumentOperations,
} from './partner-openapi-surface';
import {
  Ctor,
  discoverV1Controllers,
  discoverV1Routes,
  listV1Routes,
  toOpenApiPath,
} from '../testing/v1-controller-scan';

describe('Partner API v1 — OpenAPI export 커버리지 계약', () => {
  const discovered = discoverV1Controllers();
  const discoveredRoutes = discoverV1Routes();

  describe('경로 변환 규약 (Nest → OpenAPI)', () => {
    it.each([
      ['v1', 'ping', '/api/v1/ping'],
      ['v1/book-specs', '/', '/api/v1/book-specs'],
      ['v1/book-specs', ':uid/calculated-size', '/api/v1/book-specs/{uid}/calculated-size'],
      ['v1/books', ':uid/pdf-cover', '/api/v1/books/{uid}/pdf-cover'],
    ])('toOpenApiPath(%s, %s) === %s', (ctrl, handler, expected) => {
      expect(toOpenApiPath(ctrl, handler)).toBe(expected);
    });
  });

  describe('① 컨트롤러 등재 — 전수 스캔 집합 == export 목록', () => {
    it(`export 컨트롤러 수 == 실제 v1 컨트롤러 수 (현재 ${PARTNER_V1_EXPORT_CONTROLLERS.length})`, () => {
      expect(discovered.size).toBe(PARTNER_V1_EXPORT_CONTROLLERS.length);
    });

    it('미등재(신규 v1 컨트롤러) / 스테일(삭제된 컨트롤러) 0 건', () => {
      const exported = new Set<Ctor>(PARTNER_V1_EXPORT_CONTROLLERS as unknown as Ctor[]);
      // 스캔됐는데 export 목록에 없음 = 라우트 전량 침묵 증발 (E-2 회귀 그 자체)
      const missing = [...discovered.keys()]
        .filter((c) => !exported.has(c))
        .map((c) => `${(c as { name?: string }).name} @ ${discovered.get(c)}`);
      // export 목록에 있는데 스캔 안 됨 = 삭제/경로변경된 스테일 항목
      const stale = [...exported]
        .filter((c) => !discovered.has(c))
        .map((c) => (c as { name?: string }).name);

      expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    });
  });

  describe('② REQUIRED_PATHS — 전 v1 라우트 경로를 빠짐없이 요구한다', () => {
    it('스캔된 v1 경로 집합 == REQUIRED_PATHS 집합 (누락/스테일 0)', () => {
      const scannedPaths = [...new Set(discoveredRoutes.map((r) => r.path))].sort();
      const required = [...new Set(REQUIRED_PATHS)].sort();
      // 누락 = 단언 침묵 구멍(신규 경로가 빠져도 export 가 red 안 됨)
      const missing = scannedPaths.filter((p) => !required.includes(p));
      const stale = required.filter((p) => !scannedPaths.includes(p));

      expect({ missing, stale }).toEqual({ missing: [], stale: [] });
    });

    it('REQUIRED_PATHS 에 중복이 없다', () => {
      expect(REQUIRED_PATHS).toHaveLength(new Set(REQUIRED_PATHS).size);
    });
  });

  describe('③ 실제 산출 문서 — 라우트 단위 전수 대조 (최종 게이트)', () => {
    it('문서 오퍼레이션 집합 == 스캔된 v1 라우트 집합 (누락/초과 0)', async () => {
      const document = await buildPartnerOpenApiDocument();
      const exportedOps = listDocumentOperations(document).sort();
      const scannedOps = [...new Set(discoveredRoutes.map((r) => r.key))].sort();

      // 스캔됐는데 문서에 없음 = 파트너가 볼 수 없는 라우트
      const missing = scannedOps.filter((k) => !exportedOps.includes(k));
      // 문서에 있는데 v1 표면이 아님 = 내부 라우트 유입
      const extra = exportedOps.filter((k) => !scannedOps.includes(k));

      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    });

    it('스크립트 안전 단언(내부 라우트 미유입 + 필수 경로 존재)을 통과한다', async () => {
      const document = await buildPartnerOpenApiDocument();
      expect(() => assertPartnerDocument(document)).not.toThrow();
    });
  });

  describe('스냅샷 — 현 v1 표면 규모', () => {
    it('Stage 3 기준 v1 라우트 22개 / 경로 16개 (증감 시 의도 확인 후 갱신)', () => {
      const paths = new Set(discoveredRoutes.map((r) => r.path));
      expect({ routes: discoveredRoutes.length, paths: paths.size }).toEqual({
        routes: 22,
        paths: 16,
      });
    });

    it('BooksController 11 라우트가 v1 표면에 존재한다 (E-2 회귀 고정)', () => {
      const booksRoutes = [...discovered.keys()]
        .filter((c) => (c as { name?: string }).name === 'BooksController')
        .flatMap((c) => listV1Routes(c));
      expect(booksRoutes).toHaveLength(11);
    });
  });
});
