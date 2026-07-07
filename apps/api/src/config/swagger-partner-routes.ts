import type { OpenAPIObject } from '@nestjs/swagger';

/**
 * Swagger 파트너 표면 큐레이션 allowlist (2026-07-07)
 *
 * production 에서 `/api/docs` 는 이 목록에 있는 라우트만 노출한다.
 *
 * 배경: `/api/docs`(+ `-json`/`-yaml`)는 파트너에게 안내해 온 공개 Swagger URL이다
 * (docs/PHP_INTEGRATION_FINAL_v3.md, PLATFORM_WORKER_INTEGRATION_v1.md 등). 그러나 무가드로
 * 등록되어 내부·관리자·인증 표면(auth/login·sites·sites/:id/regenerate·admin/storage-settings·
 * operators 등 173 오퍼레이션)까지 전량 열람 가능했다. URL 자체는 유지하되(파트너 무중단) 문서에
 * 노출되는 표면을 파트너 대면 라우트로 한정한다.
 * → SWEETBOOK_GAP_ROADMAP_2026-07-07.md §8-10 조치안 B(문서 큐레이션).
 *
 * 정본 근거: docs/PLATFORM_INTEGRATION_GUIDE.md 파트너 라우트 표(§717~753) +
 *            파트너가 서버간/임베드로 호출하는 @Public·ApiKey 조회 라우트.
 *
 * 규율(fail-closed): 목록에 없는 라우트는 production 문서에서 비노출된다. 파트너 대면 라우트를
 * 신설/변경하면 이 파일과 PLATFORM_INTEGRATION_GUIDE 표를 함께 갱신할 것. 형식은
 * `"<HTTP_METHOD> <OpenAPI 경로>"`(경로 파라미터는 `{id}` 표기, 전역 prefix `/api` 포함).
 */
export const SWAGGER_PARTNER_ROUTES: ReadonlySet<string> = new Set<string>([
  // 인증 — 임베드 편집기 진입(shop-session JWT)
  'POST /api/auth/shop-session',
  'POST /api/auth/shop-refresh',
  'POST /api/auth/shop-refresh-body',
  // 파일 — 서버간 업로드/다운로드/정리 + 게스트/임베드 presigned 멀티파트
  'POST /api/files/upload/external',
  'GET /api/files/{id}/download/external',
  'DELETE /api/files/{id}/external',
  'POST /api/files/{id}/expiry/external',
  'GET /api/files/{id}/raw',
  'GET /api/files/{id}/thumbnail',
  'POST /api/files/presigned-upload-public',
  'POST /api/files/multipart/init',
  'POST /api/files/multipart/sign',
  'POST /api/files/multipart/complete',
  'POST /api/files/multipart/abort',
  'POST /api/files/{id}/complete',
  // 워커 잡 — 검증/합성/보정 + 폴링/콜백
  'POST /api/worker-jobs/validate/external',
  'POST /api/worker-jobs/synthesize/external',
  'POST /api/worker-jobs/split-synthesize/external',
  'POST /api/worker-jobs/check-mergeable/external',
  'POST /api/worker-jobs/fix-pagecount/external',
  'POST /api/worker-jobs/compose-mixed',
  'POST /api/worker-jobs/render-pages',
  'GET /api/worker-jobs/external/{id}',
  'PATCH /api/worker-jobs/external/{id}/status',
  // 편집 세션 — 주문별 조회/임포지션 프리뷰
  'GET /api/edit-sessions/external',
  'GET /api/edit-sessions/{id}/imposition-preview',
  // 책등 사전 계산(@Public)
  'GET /api/products/spine/paper-types',
  'GET /api/products/spine/binding-types',
  'POST /api/products/spine/calculate',
  // 템플릿 조회 — 파트너 상품페이지/임베드 부트스트랩(@Public)
  'GET /api/product-template-sets/by-product',
  'GET /api/template-sets/{id}/with-templates',
]);

const OPENAPI_HTTP_METHODS = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

/**
 * OpenAPI 문서에서 파트너 allowlist 에 해당하는 operation 만 남긴 사본을 반환한다.
 * 원본 문서는 변형하지 않는다(내부 서빙용 전체 문서와 공존 가능).
 */
export function filterToPartnerRoutes(document: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject['paths'] = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue;
    const kept: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(
      pathItem as Record<string, unknown>,
    )) {
      const method = key.toLowerCase();
      if (!OPENAPI_HTTP_METHODS.has(method)) {
        // path-level 필드(parameters, $ref 등)는 operation 이 하나라도 남을 때만 보존
        continue;
      }
      if (SWAGGER_PARTNER_ROUTES.has(`${method.toUpperCase()} ${path}`)) {
        kept[key] = value;
      }
    }

    if (Object.keys(kept).length === 0) continue;

    // operation 이 남는 경우, path-level 비-operation 필드(parameters 등)를 함께 보존
    for (const [key, value] of Object.entries(
      pathItem as Record<string, unknown>,
    )) {
      if (!OPENAPI_HTTP_METHODS.has(key.toLowerCase())) {
        kept[key] = value;
      }
    }

    paths[path] = kept as (typeof paths)[string];
  }

  return { ...document, paths };
}
