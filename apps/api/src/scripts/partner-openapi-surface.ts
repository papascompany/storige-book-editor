/**
 * Partner API v1 OpenAPI 표면 정의 — export 스크립트와 커버리지 spec 의 공유 정본.
 *
 * ⚠️ 신규 v1 컨트롤러(@PartnerV1Controller)를 추가하면 **반드시** 아래 셋을 함께 갱신하라:
 *   ① PARTNER_V1_EXPORT_CONTROLLERS — 컨트롤러 등재 (누락 시 해당 라우트가 스펙에서 통째 증발)
 *   ② PARTNER_V1_EXPORT_PROVIDERS   — 생성자 의존 스텁 (누락 시 모듈 compile 실패)
 *   ③ REQUIRED_PATHS                — 신규 경로 등재
 * 갱신 누락은 scripts/partner-openapi-surface.spec.ts 가 FS 전수 스캔 대조로 red 처리한다
 * (Stage 3 에서 BooksController 11라우트가 ①·③ 누락으로 침묵 증발한 회귀의 재발 방지 게이트).
 *
 * 정본: docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md
 */
import 'reflect-metadata';
import { Provider, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { PartnerApiKeyGuard } from '../partner-api/guards/partner-api-key.guard';
import { PartnerRateLimitGuard } from '../partner-api/guards/partner-rate-limit.guard';
import { PartnerApiExceptionFilter } from '../partner-api/http/partner-api-exception.filter';
import { PartnerEnvelopeInterceptor } from '../partner-api/http/partner-envelope.interceptor';
import { PartnerAuditInterceptor } from '../partner-api/audit/partner-audit.interceptor';
import { PartnerIdempotencyInterceptor } from '../partner-api/idempotency/partner-idempotency.interceptor';
import { PartnerPingController } from '../partner-api/ping.controller';
import { BookSpecsController } from '../book-specs/book-specs.controller';
import { BookSpecsService } from '../book-specs/book-specs.service';
import { BooksController } from '../books/books.controller';
import { BooksService } from '../books/books.service';
import { BookFinalizationsService } from '../books/book-finalizations.service';
import { FilesService } from '../files/files.service';
import { PartnerWebhooksController } from '../webhook/v2/partner-webhooks.controller';
import { WebhookConfigService } from '../webhook/v2/webhook-config.service';
import { WebhookDeliveryService } from '../webhook/v2/webhook-delivery.service';

export const PARTNER_V1_TAG = 'partner-v1';

/**
 * 스펙에 실릴 v1 컨트롤러 — v1 표면 전량. FS 전수 스캔 집합과 정확히 일치해야 한다.
 * (Stage 1 ping·book-specs / Stage 2 webhooks / Stage 3 books)
 */
export const PARTNER_V1_EXPORT_CONTROLLERS: Type<unknown>[] = [
  PartnerPingController,
  BookSpecsController,
  BooksController,
  PartnerWebhooksController,
];

/**
 * 컨트롤러 생성자 의존 스텁 — Swagger 는 라우트 메타데이터만 읽으므로 실행 의존
 * (DB·큐·설정)은 전부 빈 객체로 충분하다. DB 연결 0 유지가 이 스크립트의 불변식.
 */
export const PARTNER_V1_EXPORT_PROVIDERS: Provider[] = [
  { provide: BookSpecsService, useValue: {} },
  { provide: BooksService, useValue: {} },
  { provide: BookFinalizationsService, useValue: {} },
  { provide: FilesService, useValue: {} },
  { provide: WebhookConfigService, useValue: {} },
  { provide: WebhookDeliveryService, useValue: {} },
];

/** v1 계약상 반드시 문서에 존재해야 하는 경로 (글로벌 prefix 'api' 포함) */
export const REQUIRED_PATHS: string[] = [
  // Stage 1 — ping·book-specs
  '/api/v1/ping',
  '/api/v1/book-specs',
  '/api/v1/book-specs/{uid}',
  '/api/v1/book-specs/{uid}/calculated-size',
  // Stage 2 작업 5 — Webhooks (설계서 §1.5 라우트 20~26)
  '/api/v1/webhooks/config',
  '/api/v1/webhooks/test',
  '/api/v1/webhooks/deliveries',
  '/api/v1/webhooks/deliveries/{uid}',
  '/api/v1/webhooks/deliveries/{uid}/retry',
  // Stage 3 — Books aggregate (W1 코어 / W2 자산 / W3 최종화·PDF)
  '/api/v1/books',
  '/api/v1/books/{uid}',
  '/api/v1/books/{uid}/pdf-cover',
  '/api/v1/books/{uid}/pdf-contents',
  '/api/v1/books/{uid}/photos',
  '/api/v1/books/{uid}/finalization',
  '/api/v1/books/{uid}/pdf',
];

const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
];

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

/**
 * v1 컨트롤러만 담은 경량 모듈을 컴파일해 파트너 대면 OpenAPI 문서를 생성한다.
 * 가드/필터/인터셉터는 스텁으로 대체(Swagger 는 데코레이터 메타데이터만 읽는다), DB 불필요.
 */
export async function buildPartnerOpenApiDocument(): Promise<OpenAPIObject> {
  const passthrough = {
    intercept: (_c: unknown, n: { handle: () => unknown }) => n.handle(),
  };

  const moduleRef = await Test.createTestingModule({
    controllers: PARTNER_V1_EXPORT_CONTROLLERS,
    providers: PARTNER_V1_EXPORT_PROVIDERS,
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

  await app.close();
  return document;
}

/**
 * 안전 단언 — 위반 시 throw:
 *  ① 내부 라우트 미유입: 모든 경로가 /api/v1/*
 *  ② 필수 v1 라우트(REQUIRED_PATHS) 전량 존재
 */
export function assertPartnerDocument(document: OpenAPIObject): void {
  const pathKeys = Object.keys(document.paths);
  const leaked = pathKeys.filter((p) => !p.startsWith('/api/v1/'));
  if (leaked.length > 0) {
    throw new Error(`v1 외 라우트가 파트너 스펙에 유입됨: ${leaked.join(', ')}`);
  }
  const missing = REQUIRED_PATHS.filter((p) => !pathKeys.includes(p));
  if (missing.length > 0) {
    throw new Error(`필수 v1 라우트 누락: ${missing.join(', ')}`);
  }
}

/** 문서의 오퍼레이션 키 집합 — 'post /api/v1/books' 형식 (라우트 단위 대조용) */
export function listDocumentOperations(document: OpenAPIObject): string[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    HTTP_METHODS.filter((m) => (item as PathItemLike)[m] !== undefined).map(
      (m) => `${m} ${path}`,
    ),
  );
}
