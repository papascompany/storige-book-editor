/**
 * Partner API v1 전용 OpenAPI 스펙 export (Stage 1 작업 5).
 *
 * 실행: pnpm --filter @storige/api openapi:partner  (ts-node, DB/외부 의존 0)
 * 산출: apps/api/openapi-partner.json (OPENAPI_PARTNER_OUT env 로 변경 가능)
 *
 * 동작:
 *  1. v1 컨트롤러 전량(PartnerPingController·BookSpecsController·BooksController·
 *     PartnerWebhooksController)만 담은 경량 모듈을 @nestjs/testing 으로 컴파일 —
 *     가드/필터/인터셉터는 스텁으로 대체(Swagger 는 데코레이터 메타데이터만 읽는다), DB 불필요.
 *  2. main.ts 와 동일한 DocumentBuilder 구성(글로벌 prefix 'api' 포함)으로
 *     문서 생성 후 'partner-v1' 태그 오퍼레이션만 필터.
 *  3. 안전 단언: 모든 경로가 /api/v1/* 인지(내부 라우트 미포함) + 필수 라우트
 *     (REQUIRED_PATHS) 존재 검증 — 위반 시 exit 1.
 *  4. 미참조 컴포넌트 스키마 제거(파트너 대면 최소 표면).
 *
 * ⚠️ 컨트롤러 목록·스텁 provider·REQUIRED_PATHS 는 partner-openapi-surface.ts 가 정본이다.
 *    **신규 v1 컨트롤러 추가 시 그 파일의 PARTNER_V1_EXPORT_CONTROLLERS 와 REQUIRED_PATHS 를
 *    함께 갱신하라** — 갱신 누락은 partner-openapi-surface.spec.ts 가 FS 전수 스캔 대조로
 *    red 처리한다(Stage 3 books 11라우트 침묵 증발 회귀의 재발 방지 게이트).
 *
 * ⚠️ /api/docs 접근 정책(공개 서빙)은 이 스크립트와 무관하게 무변경 —
 *    변경은 설계서 §9-3 오너 결정 사안.
 */
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertPartnerDocument,
  buildPartnerOpenApiDocument,
  listDocumentOperations,
} from './partner-openapi-surface';

async function main(): Promise<void> {
  const document = await buildPartnerOpenApiDocument();
  assertPartnerDocument(document);

  const outPath = resolve(
    process.env.OPENAPI_PARTNER_OUT ?? resolve(__dirname, '../../openapi-partner.json'),
  );
  writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');

  const pathCount = Object.keys(document.paths).length;
  const operationCount = listDocumentOperations(document).length;
  const schemaCount = Object.keys(document.components?.schemas ?? {}).length;

  console.log(
    `openapi-partner.json 생성: paths=${pathCount}, operations=${operationCount}, schemas=${schemaCount} → ${outPath}`,
  );
}

main().catch((err: unknown) => {
  console.error('openapi:partner export 실패:', err);
  process.exitCode = 1;
});
