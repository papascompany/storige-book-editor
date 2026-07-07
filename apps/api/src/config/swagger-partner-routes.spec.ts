import type { OpenAPIObject } from '@nestjs/swagger';
import {
  SWAGGER_PARTNER_ROUTES,
  filterToPartnerRoutes,
} from './swagger-partner-routes';

/**
 * 파트너 Swagger 큐레이션 회귀 방지 (SWEETBOOK_GAP_ROADMAP §8-10 조치안 B).
 *
 * production 문서가 파트너 대면 라우트만 노출하고, 내부/관리자/인증 표면을 감추는지 고정한다.
 * 실제 프로덕션 스펙 구조(paths[path][method] = operation)를 모사한 픽스처로 검증한다.
 */
describe('filterToPartnerRoutes', () => {
  const makeDoc = (
    routes: Array<[string, string]>,
  ): OpenAPIObject => {
    const paths: Record<string, Record<string, unknown>> = {};
    for (const [method, path] of routes) {
      paths[path] = paths[path] ?? {};
      paths[path][method.toLowerCase()] = {
        operationId: `${method} ${path}`,
        responses: { '200': { description: 'ok' } },
      };
    }
    return {
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0' },
      paths: paths as OpenAPIObject['paths'],
    } as OpenAPIObject;
  };

  const collect = (doc: OpenAPIObject): Set<string> => {
    const out = new Set<string>();
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const method of Object.keys(item as Record<string, unknown>)) {
        out.add(`${method.toUpperCase()} ${path}`);
      }
    }
    return out;
  };

  it('파트너 대면 라우트는 보존한다', () => {
    const doc = makeDoc([
      ['POST', '/api/worker-jobs/validate/external'],
      ['GET', '/api/files/{id}/download/external'],
      ['POST', '/api/auth/shop-session'],
      ['POST', '/api/products/spine/calculate'],
      ['GET', '/api/template-sets/{id}/with-templates'],
    ]);
    const filtered = collect(filterToPartnerRoutes(doc));
    expect(filtered).toContain('POST /api/worker-jobs/validate/external');
    expect(filtered).toContain('GET /api/files/{id}/download/external');
    expect(filtered).toContain('POST /api/auth/shop-session');
    expect(filtered).toContain('POST /api/products/spine/calculate');
    expect(filtered).toContain('GET /api/template-sets/{id}/with-templates');
    expect(filtered.size).toBe(5);
  });

  it('내부/관리자/인증 라우트는 제거한다', () => {
    const doc = makeDoc([
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/register'],
      ['PATCH', '/api/auth/change-password'],
      ['PATCH', '/api/sites/{id}/regenerate'],
      ['GET', '/api/admin/storage-settings'],
      ['PUT', '/api/admin/storage-settings'],
      ['GET', '/api/operators'],
    ]);
    const filtered = collect(filterToPartnerRoutes(doc));
    expect(filtered.size).toBe(0);
  });

  it('같은 경로에 파트너/내부 메서드가 혼재하면 파트너 메서드만 남긴다', () => {
    // shop-session(파트너) 은 auth 경로군에 있지만 login/register(내부)와 분리돼야 한다
    const doc = makeDoc([
      ['POST', '/api/auth/shop-session'],
      ['POST', '/api/auth/login'],
    ]);
    const filtered = collect(filterToPartnerRoutes(doc));
    expect(filtered).toEqual(new Set(['POST /api/auth/shop-session']));
  });

  it('path-level 비-operation 필드(parameters)는 operation 이 남을 때만 보존한다', () => {
    const doc = {
      openapi: '3.0.0',
      info: { title: 'test', version: '1.0' },
      paths: {
        '/api/files/{id}/raw': {
          parameters: [{ name: 'id', in: 'path', required: true }],
          get: { operationId: 'raw', responses: { '200': { description: 'ok' } } },
        },
        '/api/sites/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true }],
          get: { operationId: 'site', responses: { '200': { description: 'ok' } } },
        },
      } as unknown as OpenAPIObject['paths'],
    } as OpenAPIObject;
    const filtered = filterToPartnerRoutes(doc);
    // 파트너 라우트는 parameters 까지 보존
    expect(filtered.paths['/api/files/{id}/raw']).toHaveProperty('parameters');
    expect(filtered.paths['/api/files/{id}/raw']).toHaveProperty('get');
    // 내부 라우트는 경로 자체가 사라짐
    expect(filtered.paths['/api/sites/{id}']).toBeUndefined();
  });

  it('원본 문서를 변형하지 않는다', () => {
    const doc = makeDoc([
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/shop-session'],
    ]);
    const before = collect(doc).size;
    filterToPartnerRoutes(doc);
    expect(collect(doc).size).toBe(before);
  });

  it('allowlist 는 전역 prefix /api 를 포함하고 METHOD 는 대문자다(형식 계약)', () => {
    for (const entry of SWAGGER_PARTNER_ROUTES) {
      const [method, path] = entry.split(' ');
      expect(path?.startsWith('/api/')).toBe(true);
      expect(method).toBe(method?.toUpperCase());
    }
  });
});
