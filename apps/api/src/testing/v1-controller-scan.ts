/**
 * Partner API v1 표면 전수 스캔 — spec 공용 헬퍼 (테스트 전용, 런타임 미참조).
 *
 * AppModule 은 실 DB 연결(TypeORM forRoot) 때문에 테스트에서 compile 불가하므로
 * DiscoveryService 를 쓸 수 없다. 대신 src/**\/*.controller.ts 전 파일을 require 하여
 * PATH_METADATA 가 'v1'/'v1/...' 인 export 클래스를 수집한다 — 모듈 미등록 컨트롤러까지
 * 잡으므로 DiscoveryService 보다 검출 범위가 넓다.
 *
 * 이 스캔 결과가 "v1 표면의 ground truth" 이며, 아래 두 spec 이 각자의 명시 목록을
 * 이 집합과 대조해 등재 누락을 red 로 강제한다:
 *  - partner-v1-guarded.spec.ts        — 가드 계약(무인증 라우트 0)
 *  - scripts/partner-openapi-surface.spec.ts — OpenAPI export 커버리지
 */
import 'reflect-metadata';
import { readdirSync } from 'fs';
import { join, relative, resolve } from 'path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

export type Ctor = abstract new (...args: never[]) => unknown;

/** 스캔 기준 루트 = apps/api/src (이 파일 위치 기준으로 고정 — 호출자 위치 무관) */
const SRC_ROOT = resolve(__dirname, '..');

/** 글로벌 prefix — main.ts setGlobalPrefix('api') 와 동일 (최종 경로 /api/v1/*) */
const GLOBAL_PREFIX = 'api';

/** src/ 이하 *.controller.ts 전 파일 경로 수집 (재귀) */
function listControllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...listControllerFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** PATH_METADATA 가 v1 스코프('v1' 또는 'v1/...')인지 */
function isV1Path(path: unknown): boolean {
  return typeof path === 'string' && /^v1(\/|$)/.test(path);
}

/**
 * 파일시스템 전수 스캔으로 실제 v1 컨트롤러 클래스 수집.
 * @returns 컨트롤러 클래스 → src 기준 상대 파일 경로
 */
export function discoverV1Controllers(root: string = SRC_ROOT): Map<Ctor, string> {
  const discovered = new Map<Ctor, string>();
  for (const file of listControllerFiles(root)) {
    // ts-jest 가 require 시점에 변환 — 클래스 정의(데코레이터 평가)만 일어난다
    const mod = require(file) as Record<string, unknown>;
    for (const exported of Object.values(mod)) {
      if (typeof exported !== 'function') continue;
      if (isV1Path(Reflect.getMetadata(PATH_METADATA, exported))) {
        discovered.set(exported as Ctor, relative(SRC_ROOT, file));
      }
    }
  }
  return discovered;
}

/** ':uid' → '{uid}' 등 Nest 경로 세그먼트를 OpenAPI 표기로 변환 */
function toOpenApiSegment(segment: string): string {
  return segment.startsWith(':') ? `{${segment.slice(1)}}` : segment;
}

/**
 * 컨트롤러 경로 + 핸들러 경로 → OpenAPI 문서상의 최종 경로.
 * 예: ('v1/books', ':uid/pdf-cover') → '/api/v1/books/{uid}/pdf-cover'
 *     ('v1/book-specs', '/')         → '/api/v1/book-specs'
 */
export function toOpenApiPath(controllerPath: string, handlerPath: string): string {
  const segments = [...controllerPath.split('/'), ...handlerPath.split('/')]
    .filter((s) => s.length > 0)
    .map(toOpenApiSegment);
  return `/${[GLOBAL_PREFIX, ...segments].join('/')}`;
}

export type V1Route = {
  /** OpenAPI 소문자 메서드 — 'get' | 'post' | ... */
  method: string;
  /** 글로벌 prefix 포함 OpenAPI 경로 — '/api/v1/books/{uid}' */
  path: string;
  /** 'post /api/v1/books' — 집합 대조용 안정 키 */
  key: string;
};

/** 컨트롤러 클래스의 라우트(메서드+경로) 전수 열거 — Nest 라우팅 메타데이터 기준 */
export function listV1Routes(controller: Ctor): V1Route[] {
  const controllerPath = Reflect.getMetadata(PATH_METADATA, controller) as unknown;
  if (typeof controllerPath !== 'string') return [];

  const prototype = (controller as unknown as { prototype: object }).prototype;
  const routes: V1Route[] = [];
  for (const property of Object.getOwnPropertyNames(prototype)) {
    if (property === 'constructor') continue;
    // getter 호출을 피하려 descriptor 로 접근
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    const handler = descriptor?.value as unknown;
    if (typeof handler !== 'function') continue;

    const handlerPath = Reflect.getMetadata(PATH_METADATA, handler) as unknown;
    if (typeof handlerPath !== 'string') continue; // 라우트가 아닌 일반 메서드
    const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as unknown;
    if (typeof requestMethod !== 'number') continue;

    const method = (RequestMethod[requestMethod] ?? 'ALL').toLowerCase();
    const path = toOpenApiPath(controllerPath, handlerPath);
    routes.push({ method, path, key: `${method} ${path}` });
  }
  return routes;
}

/** 스캔된 전 v1 컨트롤러의 라우트를 평탄화 — v1 표면의 ground truth */
export function discoverV1Routes(root?: string): V1Route[] {
  return [...discoverV1Controllers(root).keys()].flatMap((c) => listV1Routes(c));
}
