/**
 * Partner API v1 전용 OpenAPI 스펙 export (Stage 1 작업 5).
 *
 * 실행: pnpm --filter @storige/api openapi:partner  (ts-node, DB/외부 의존 0)
 * 산출: apps/api/openapi-partner.json (OPENAPI_PARTNER_OUT env 로 변경 가능)
 *
 * 동작:
 *  1. v1 컨트롤러(PartnerPingController·BookSpecsController)만 담은 경량
 *     모듈을 @nestjs/testing 으로 컴파일 — 가드/필터/인터셉터는 스텁으로
 *     대체(Swagger 는 데코레이터 메타데이터만 읽는다), DB 불필요.
 *  2. main.ts 와 동일한 DocumentBuilder 구성(글로벌 prefix 'api' 포함)으로
 *     문서 생성 후 'partner-v1' 태그 오퍼레이션만 필터.
 *  3. 안전 단언: 모든 경로가 /api/v1/* 인지(내부 라우트 미포함) + 필수
 *     라우트(ping·book-specs 3종) 존재 검증 — 위반 시 exit 1.
 *  4. 미참조 컴포넌트 스키마 제거(파트너 대면 최소 표면).
 *
 * ⚠️ /api/docs 접근 정책(공개 서빙)은 이 스크립트와 무관하게 무변경 —
 *    변경은 설계서 §9-3 오너 결정 사안.
 */
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PartnerPingController } from '../partner-api/ping.controller';
import { PartnerApiKeyGuard } from '../partner-api/guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../partner-api/guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from '../partner-api/http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../partner-api/http/partner-envelope.interceptor';
import { PartnerAuditInterceptor } from '../partner-api/audit/partner-audit.interceptor';
import { PartnerIdempotencyInterceptor } from '../partner-api/idempotency/partner-idempotency.interceptor';
import { BookSpecsController } from '../book-specs/book-specs.controller';
import { BookSpecsService } from '../book-specs/book-specs.service';

const PARTNER_V1_TAG = 'partner-v1';

/** v1 계약상 반드시 문서에 존재해야 하는 경로 (글로벌 prefix 'api' 포함) */
const REQUIRED_PATHS = [
  '/api/v1/ping',
  '/api/v1/book-specs',
  '/api/v1/book-specs/{uid}',
  '/api/v1/book-specs/{uid}/calculated-size',
];

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

type OperationLike = { tags?: string[] };
type PathItemLike = Record<string, unknown>;

/** partner-v1 태그 오퍼레이션만 남긴다 — 태그 없는(내부) 라우트는 전부 제거 */
function filterPartnerPaths(document: OpenAPIObject): void {
  const paths = document.paths as Record<string, PathItemLike>;
  for (const [path, item] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method] as OperationLike | undefined;
      if (op && !(op.tags ?? []).includes(PARTNER_V1_TAG)) {
        delete item[method];
      }
    }
    if (!HTTP_METHODS.some((m) => item[m] !== undefined)) {
      delete paths[path];
    }
  }
}

/** 필터 후 문서에서 $ref 로 도달 가능한 스키마만 남긴다 (고정점 반복) */
function pruneUnusedSchemas(document: OpenAPIObject): void {
  const schemas = document.components?.schemas;
  if (!schemas) return;

  const collectRefs = (node: unknown, into: Set<string>): void => {
    if (Array.isArray(node)) {
      node.forEach((child) => collectRefs(child, into));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '$ref' && typeof value === 'string') {
          const name = value.replace('#/components/schemas/', '');
          into.add(name);
        } else {
          collectRefs(value, into);
        }
      }
    }
  };

  const used = new Set<string>();
  collectRefs(document.paths, used);
  // 스키마 간 참조 폐포(스키마가 다른 스키마를 $ref 하는 경우)
  let size = -1;
  while (size !== used.size) {
    size = used.size;
    for (const name of Array.from(used)) {
      if (schemas[name]) collectRefs(schemas[name], used);
    }
  }

  for (const name of Object.keys(schemas)) {
    if (!used.has(name)) delete schemas[name];
  }
}

async function main(): Promise<void> {
  const passthrough = { intercept: (_c: unknown, n: { handle: () => unknown }) => n.handle() };

  const moduleRef = await Test.createTestingModule({
    controllers: [PartnerPingController, BookSpecsController],
    // Swagger 는 라우트 메타데이터만 읽는다 — 실행 의존(DB·설정)은 스텁
    providers: [{ provide: BookSpecsService, useValue: {} }],
  })
    .overrideGuard(PartnerApiKeyGuard)
    .useValue({ canActivate: () => true })
    .overrideGuard(PartnerRateLimitGuard)
    .useValue({ canActivate: () => true })
    .overrideFilter(PartnerApiExceptionFilter)
    .useValue({ catch: () => undefined })
    .overrideInterceptor(PartnerAuditInterceptor)
    .useValue(passthrough)
    .overrideInterceptor(PartnerIdempotencyInterceptor)
    .useValue(passthrough)
    .overrideInterceptor(PartnerEnvelopeInterceptor)
    .useValue(passthrough)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); // main.ts 와 동일 — 최종 경로 /api/v1/*

  // main.ts DocumentBuilder 와 동일 구성 + partner-v1 태그 (정본 대칭 유지)
  const config = new DocumentBuilder()
    .setTitle('Storige Partner API v1')
    .setDescription(
      'Partner Platform API v1 — 파트너 대면 표면 (/api/v1/*). ' +
        '인증: Authorization: Bearer <key> 또는 X-API-Key: <key> 병행 수용. ' +
        '정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addTag(PARTNER_V1_TAG, 'Partner Platform API v1 — 파트너 대면 표면 (/api/v1/*)')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  filterPartnerPaths(document);
  pruneUnusedSchemas(document);

  // 안전 단언 1 — 내부 라우트 미포함: 모든 경로는 /api/v1/* 여야 한다
  const pathKeys = Object.keys(document.paths);
  const leaked = pathKeys.filter((p) => !p.startsWith('/api/v1/'));
  if (leaked.length > 0) {
    throw new Error(`v1 외 라우트가 파트너 스펙에 유입됨: ${leaked.join(', ')}`);
  }
  // 안전 단언 2 — 필수 v1 라우트 존재
  const missing = REQUIRED_PATHS.filter((p) => !pathKeys.includes(p));
  if (missing.length > 0) {
    throw new Error(`필수 v1 라우트 누락: ${missing.join(', ')}`);
  }

  const outPath = resolve(
    process.env.OPENAPI_PARTNER_OUT ?? resolve(__dirname, '../../openapi-partner.json'),
  );
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');

  const operationCount = pathKeys.reduce(
    (acc, p) =>
      acc +
      HTTP_METHODS.filter((m) => (document.paths[p] as PathItemLike)[m] !== undefined).length,
    0,
  );
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;
   
  console.log(
    `openapi-partner.json 생성: paths=${pathKeys.length}, operations=${operationCount}, schemas=${schemaCount} → ${outPath}`,
  );

  await app.close();
}

main().catch((err: unknown) => {
   
  console.error('openapi:partner export 실패:', err);
  process.exitCode = 1;
});
