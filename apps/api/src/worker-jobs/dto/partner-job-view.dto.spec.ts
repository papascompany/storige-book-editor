/**
 * 파트너 잡 응답 OpenAPI 스키마 — DTO 속성 집합 == PARTNER_JOB_VIEW_KEYS,
 * 공개 7라우트 응답이 이 스키마를 참조하고 production 필터 뒤에도 남는다.
 *
 * WorkerJobsController 만 올린 테스트 모듈로 문서를 만들어(전역 prefix 'api' 는 main.ts 와 같다) 확인한다.
 */
import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { DECORATORS } from '@nestjs/swagger/dist/constants';
import { ConfigService } from '@nestjs/config';
import { WorkerJobStatus, WorkerJobType } from '@storige/types';
import { WorkerJobsController } from '../worker-jobs.controller';
import { WorkerJobsService } from '../worker-jobs.service';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';
import { OptionalShopJwtGuard } from '../../auth/guards/optional-shop-jwt.guard';
import { OptionalApiKeySiteGuard } from '../../auth/guards/optional-api-key-site.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TenantGuard } from '../../auth/guards/tenant.guard';
import { PARTNER_JOB_VIEW_KEYS } from '../partner-job-view';
import { PartnerJobViewDto } from './partner-job-view.dto';
import { SWAGGER_PARTNER_ROUTES, filterToPartnerRoutes } from '../../config/swagger-partner-routes';

type Node = Record<string, unknown>;

function asNode(value: unknown, where: string): Node {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`object 가 아님: ${where}`);
  }
  return value as Node;
}

function child(node: Node, key: string): Node {
  return asNode(node[key], key);
}

function schemasOf(doc: OpenAPIObject): Node {
  return child(asNode(doc.components, 'components'), 'schemas');
}

function responseRef(doc: OpenAPIObject, method: string, path: string, status: string): unknown {
  const op = child(child(asNode(doc.paths, 'paths'), path), method);
  const schema = child(child(child(child(op, 'responses'), status), 'content'), 'application/json');
  return child(schema, 'schema').$ref;
}

const SORTED_KEYS = [...PARTNER_JOB_VIEW_KEYS].sort();

const PUBLIC_ROUTES: ReadonlyArray<[string, string, string]> = [
  ['get', '/api/worker-jobs/external/{id}', '200'],
  ['post', '/api/worker-jobs/validate/external', '201'],
  ['post', '/api/worker-jobs/fix-pagecount/external', '201'],
  ['post', '/api/worker-jobs/synthesize/external', '201'],
  ['post', '/api/worker-jobs/split-synthesize/external', '201'],
  ['post', '/api/worker-jobs/compose-mixed', '201'],
  ['post', '/api/worker-jobs/render-pages', '201'],
];

describe('PartnerJobViewDto (파트너 잡 응답 OpenAPI 스키마)', () => {
  let app: INestApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    const allow = { canActivate: (): boolean => true };
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkerJobsController],
      providers: [
        { provide: WorkerJobsService, useValue: {} },
        { provide: ConfigService, useValue: { get: (): undefined => undefined } },
      ],
    })
      .overrideGuard(ApiKeyGuard)
      .useValue(allow)
      .overrideGuard(OptionalShopJwtGuard)
      .useValue(allow)
      .overrideGuard(OptionalApiKeySiteGuard)
      .useValue(allow)
      .overrideGuard(RolesGuard)
      .useValue(allow)
      .overrideGuard(TenantGuard)
      .useValue(allow)
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api'); // main.ts 와 같다
    document = SwaggerModule.createDocument(app, new DocumentBuilder().build());
  });

  afterAll(async () => {
    await app.close();
  });

  it('스웨거 메타데이터 속성 집합 == PARTNER_JOB_VIEW_KEYS', () => {
    const raw = Reflect.getMetadata(DECORATORS.API_MODEL_PROPERTIES_ARRAY, PartnerJobViewDto.prototype) as string[];
    const keys = raw.map((k) => k.replace(/^:/, ''));
    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(SORTED_KEYS);
  });

  it('문서 스키마 PartnerJobViewDto 의 properties 키·required == PARTNER_JOB_VIEW_KEYS', () => {
    const schema = child(schemasOf(document), 'PartnerJobViewDto');
    expect(Object.keys(child(schema, 'properties')).sort()).toEqual(SORTED_KEYS);
    expect([...(schema.required as string[])].sort()).toEqual(SORTED_KEYS);
  });

  it('jobType·status enum 은 전체 enum', () => {
    const props = child(child(schemasOf(document), 'PartnerJobViewDto'), 'properties');
    expect([...(child(props, 'jobType').enum as string[])].sort()).toEqual(
      [...Object.values(WorkerJobType)].sort(),
    );
    expect([...(child(props, 'status').enum as string[])].sort()).toEqual(
      [...Object.values(WorkerJobStatus)].sort(),
    );
  });

  it.each(PUBLIC_ROUTES)('공개 라우트 %s %s %s 응답이 PartnerJobViewDto 를 참조', (method, path, status) => {
    expect(responseRef(document, method, path, status)).toBe('#/components/schemas/PartnerJobViewDto');
    expect(SWAGGER_PARTNER_ROUTES.has(`${method.toUpperCase()} ${path}`)).toBe(true);
  });

  it('범위 밖 라우트(fix-bleed·fix-pagecount/attach)는 종전 스키마', () => {
    expect(responseRef(document, 'post', '/api/worker-jobs/fix-bleed', '201')).toBe('#/components/schemas/WorkerJob');
    expect(responseRef(document, 'post', '/api/worker-jobs/fix-pagecount/attach', '201')).toBe(
      '#/components/schemas/WorkerJob',
    );
    for (const path of ['/api/worker-jobs/fix-bleed', '/api/worker-jobs/fix-pagecount/attach']) {
      const op = child(child(asNode(document.paths, 'paths'), path), 'post');
      expect(child(child(op, 'responses'), '201').description).toContain('PartnerJobViewDto');
    }
  });

  it('production 필터 뒤에도 7라우트와 스키마가 남는다', () => {
    const filtered = filterToPartnerRoutes(document);
    for (const [method, path, status] of PUBLIC_ROUTES) {
      expect(responseRef(filtered, method, path, status)).toBe('#/components/schemas/PartnerJobViewDto');
    }
    expect(schemasOf(filtered).PartnerJobViewDto).toBeDefined();
  });

  it('공개 스키마 서술에 운영 플래그 맥락·내부 경로 없음', () => {
    const text = JSON.stringify(schemasOf(document).PartnerJobViewDto);
    for (const banned of ['PARTNER_JOB_VIEW', '플래그', '/storage/']) {
      expect(text).not.toContain(banned);
    }
  });
});
