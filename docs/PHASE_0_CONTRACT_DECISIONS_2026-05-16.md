# Phase 0 — 외부사이트 플랫폼 연동 표준 계약 결정 (2026-05-16)

> **목적**: Bookmoa Platform Plan(2026-05-16) Phase 0 결과물.
> 이후 모든 Phase·SDK·문서·구현이 본 문서의 결정을 기준으로 한다.
>
> **선행 문서**: `Bookmoa_platform_Plan.md`, `bookmoa_platform_plan_20260516.md`
> **상위 문서**: `docs/PHP_INTEGRATION_FINAL_v3.md`, `docs/PLATFORM_WORKER_INTEGRATION_v1.md` ← 본 문서 결정으로 갱신 필요

---

## 1. 코드 현황 조사 결과 (2026-05-16 기준)

### 1.1 `apps/api/src/auth/auth.controller.ts` — `POST /auth/shop-session`
- HTTP **200** (`@HttpCode(HttpStatus.OK)` 명시) ✓ 문서 일치
- ApiKeyGuard 적용, `siteId` 주입
- 응답: `{ success: true, accessToken, expiresIn: 3600, member: { seqno, id, name } }`
- HttpOnly 쿠키 발급: `storige_access` (path=/api, 1h), `storige_refresh` (path=/api/auth, 30d)
- 쿠키 `sameSite: 'lax'` — **외부 사이트 inline iframe 임베드 시 3rd-party 쿠키 차단 위험**
- 별도: `POST /auth/shop-refresh` (refreshToken 쿠키 기반 silent refresh, 200)

### 1.2 `apps/api/src/templates/product-template-sets.controller.ts` — `GET /product-template-sets/by-product`
- 쿼리 파라미터: `?sortcode=&stanSeqno=` (**camelCase 한 가지만**)
- ApiKeyGuard ✓
- 응답: `TemplateSetsByProductResponseDto` = `{ templateSets: [{ id, name, type, width, height, thumbnailUrl, isDefault, ... }] }`

### 1.3 `apps/api/src/worker-jobs/worker-jobs.controller.ts`
모든 외부 엔드포인트 `ApiKeyGuard` + `siteId` 자동 주입:
- `POST /worker-jobs/validate/external`
- `POST /worker-jobs/synthesize/external`
- `POST /worker-jobs/check-mergeable/external`
- `POST /worker-jobs/split-synthesize/external`
- `GET /worker-jobs/external/:id`
- `PATCH /worker-jobs/external/:id/status`

**중요**:
- NestJS `@Post` 기본 응답이 **201 Created** — 문서의 "200" 표기는 오류. 클라이언트는 **2xx 모두 성공**으로 처리.
- `GET /:id/output` (PDF 다운로드) — **ApiKeyGuard 미적용** ⚠️ Bearer 인증/내부 호출 가정. 외부 서비스는 자체 서버 프록시 필수.

### 1.4 DTO 파라미터 케이스 — `apps/api/src/worker-jobs/dto/*`
- **모든 DTO 필드 camelCase**:
  `editSessionId, fileId, fileUrl, fileType, orderOptions{size,pages,binding,bleed,paperThickness}, callbackUrl, coverFileId, coverUrl, contentFileId, contentUrl, spineWidth, orderId, priority, outputFormat, bindingType, siteId`
- `orderOptions.size`: `{ width, height }` mm 단위
- `orderOptions.binding`: `'perfect' | 'saddle' | 'spring'`
- `bindingType` (synthesis): `'perfect' | 'saddle' | 'hardcover'`
- `outputFormat`: `'merged' | 'separate'`

### 1.5 `apps/api/src/webhook/webhook.service.ts`
- 서명 방식: **Base64** of `${identifier}:${event}:${timestamp}`
  - identifier = `jobId`(있으면) 또는 `sessionId`
  - 헤더: `X-Storige-Event`, `X-Storige-Signature`
- 타임아웃 10초, **1회 자동 재시도** (2초 대기)
- ⚠️ **재시도 요청에는 `X-Storige-Signature` 헤더가 누락됨** — `X-Storige-Retry: 1`만 추가됨 (코드 라인 116~123). 외부 수신부는 이 동작에 대응해야 함.
- `WEBHOOK_ALLOWED_HOSTS` 환경변수 (콤마 구분, `*` 와일드카드 지원). 기본값: `papascompany.co.kr, bookmoa.com, localhost, 127.0.0.1, host.docker.internal`

### 1.6 `apps/editor/src/embed.tsx`
- **`parentOrigin` 옵션 없음** — A-1 작업 대상
- **postMessage 통신 없음** — IIFE 직접 콜백 함수로만 통신:
  - `onReady, onSave, onComplete, onCancel, onError`
- 마운트 방식: `window.StorigeEditor.create({...}).mount('element-id')`
- 토큰 우선순위: `config.token` → `localStorage.auth_token`
- `mode`: `'cover' | 'content' | 'both' | 'template'`
- Editor URL embed 모드 (iframe `src=`)는 별도 구현 필요

### 1.7 `apps/editor/src/views/EditorView.tsx` — URL 진입
- 쿼리 파라미터 모두 **camelCase**:
  `productId, contentId, contentType, editMode, token, size, templateSetId, pageCount, paperType, bindingType, width, height, adminEdit`
- `useSearchParams().get('templateSetId')` 직접 키 조회 — **snake_case 자동 호환 없음** → A-2 작업 대상

### 1.8 `apps/api/src/main.ts` — CORS
- `CORS_ORIGIN` 환경변수 (콤마 구분) + 기본값 5개
- 동적 패턴: `*.vercel.app`, `*.papascompany.co.kr`
- **DB `sites` 기반 동적 callback 없음** → Phase 1-2 작업 대상

### 1.9 `apps/api/src/sites/entities/site.entity.ts`
**존재 컬럼**: `id, name, domain, returnUrlBase, uploadCallbackUrl, editorAuthCode, workerAuthCode, status, pdfConversionEnabled, beforeAfterUrl, defaultUnit, checkWorkorder, checkCutting, checkSafezone`

**Phase 1-1에서 추가할 컬럼**:
- `allowedOrigins` (string[]) — CORS allowlist
- `frameAncestors` (string[]) — iframe embed parent origin allowlist
- `editorLaunchMode` (enum, default `inline`)
- `editorBundleUrl`, `editorCssUrl`, `editorVersion` (string)

---

## 2. Phase 0 결정 사항

| # | 결정 항목 | 확정안 | 영향 |
|---|---|---|---|
| D-1 | **편집기 실행 모드** | **inline embed 단일** — 호출 페이지를 언마운트하지 않는 오버레이/iframe | 외부 SDK·문서·샘플 전부 수정. `returnUrl` 의미 변경(검증용으로만 사용) |
| D-2 | **URL 파라미터 케이스** | **에디터(EditorView)가 snake_case + camelCase 양쪽 수용**. 문서 외부 노출은 snake_case 권장 (PHP 친화) | A-2 — `EditorView` getSearchParam 헬퍼 추가 |
| D-3 | **Webhook 서명** | **Base64 유지(현행) + 문서 정정**. HMAC-SHA256은 `v2` 로 분리 (별도 트랙) | `PHP_INTEGRATION_FINAL_v3.md`, `PLATFORM_WORKER_INTEGRATION_v1.md` HMAC 언급 정정 |
| D-4 | **Webhook 재시도 서명 헤더** | **재시도에도 `X-Storige-Signature` 동일 값 포함**으로 webhook.service 수정 | A-3 (이번 Phase 0~2 범위 외, 별도 핫픽스 후보) |
| D-5 | **Editor 진입 토큰** | **단기 JWT (≤ 1h)** — 현재 `expiresIn: 3600` 일치 | 변경 없음 (확인용) |
| D-6 | **결과 PDF 다운로드** | **서버 프록시 단일** — 외부 서비스는 자체 서버를 통해 다운로드. 클라이언트가 Storige `/worker-jobs/:id/output` 직접 호출 금지 | bookmoa-mobile Phase 7 적용 (이번 Phase 외) |
| D-7 | **`shop-session` 응답코드** | **HTTP 200** (현행 일치). 클라이언트는 2xx 전체 성공 처리 | 문서에 명시 |
| D-8 | **Worker job 생성 응답코드** | **HTTP 201 Created** (NestJS 기본). 문서의 "200" 표기 정정 | 문서 정정 |
| D-9 | **postMessage 표준 (편집기 iframe 임베드)** | A-1에서 5종 이벤트(`editor.ready` / `editor.save` / `editor.complete` / `editor.cancel` / `editor.error`) 표준 정의. `parentOrigin` 필수, `targetOrigin='*'` 금지. | A-1 작업 |
| D-10 | **CORS / CSP `frame-ancestors` / webhook host** | **`sites` 테이블 기반 동적 정책으로 일원화** (60s 캐시). 환경변수는 호환 모드로만 유지 | Phase 1 작업 |
| D-11 | **`/worker-jobs/:id/output` 보호** | 향후 ApiKeyGuard 추가 또는 Bearer 강제. 단 이번 Phase 0~2 범위 외 (별도 보안 검토) | 보안 검토 백로그 |

---

## 3. snake_case ↔ camelCase 매핑표 (D-2 적용 대상)

A-2 호환 레이어가 양쪽 모두 수용해야 하는 URL 파라미터 매핑.

| 외부(snake_case) | 내부(camelCase) |
|---|---|
| `template_set_id` | `templateSetId` |
| `page_count` | `pageCount` |
| `paper_type` | `paperType` |
| `binding_type` | `bindingType` |
| `order_seqno` | `orderSeqno` |
| `product_id` | `productId` |
| `content_id` | `contentId` |
| `content_type` | `contentType` |
| `edit_mode` | `editMode` |
| `return_url` | `returnUrl` (검증용. inline embed에서는 페이지 전환 없음) |
| `parent_origin` | `parentOrigin` |
| `cover_file_id` | `coverFileId` |
| `content_file_id` | `contentFileId` |
| `session_id` | `sessionId` |
| `callback_url` | `callbackUrl` |

**규칙**: 우선순위는 camelCase가 먼저, 없으면 snake_case 폴백. 둘 다 있으면 camelCase 채택 + 콘솔 경고.

**적용 대상 코드**:
- `apps/editor/src/views/EditorView.tsx` 의 `useSearchParams()` 사용 부분 (~17개)
- 향후 추가될 모든 외부 진입 URL 파싱 지점

---

## 4. postMessage 이벤트 표준 (D-9, A-1 작업 사양)

> 본 표준은 **외부 사이트가 Storige Editor 를 iframe 으로 임베드하는 경우** 의 통신 규약.
> IIFE 마운트 방식(`window.StorigeEditor.create()`)에서는 콜백 함수가 그대로 사용되며 본 표준은 부가적.

### 4.1 전달 방향
- **Storige Editor → 부모(외부 사이트)**: postMessage send
- **부모 → Editor**: 현재는 정의 없음 (Phase 5 단계에서 필요 시 추가)

### 4.2 이벤트 종류

| event | 발생 시점 | payload |
|---|---|---|
| `editor.ready` | 초기화 완료 (`onReady`와 동기) | `{ sessionId?, templateSetId, version }` |
| `editor.save` | 자동저장/수동저장 성공 (`onSave`와 동기) | `{ sessionId, savedAt, thumbnail? }` |
| `editor.complete` | 편집 완료 (`onComplete`와 동기) | `{ sessionId, orderSeqno, editCode, pages, files, savedAt }` |
| `editor.cancel` | 사용자가 닫기 클릭 (`onCancel`와 동기) | `{ sessionId? }` |
| `editor.error` | 에러 발생 (`onError`와 동기) | `{ code, message }` (code: `AUTH_EXPIRED` / `NETWORK_ERROR` / `SAVE_FAILED` / `INVALID_DATA` / `SESSION_NOT_FOUND`) |

### 4.3 보안 규칙
- Editor 의 모든 `postMessage` 호출은 `targetOrigin = parentOrigin` 으로만 발신 (절대 `'*'` 금지).
- `parentOrigin` 은 URL 쿼리 `?parentOrigin=https://shop.example.com` 또는 `EditorConfig.parentOrigin` 으로 전달.
- 부모는 수신 시 `event.origin === STORIGE_EDITOR_URL` 검증.
- 서버는 `parentOrigin` 이 `sites.allowedOrigins` 에 등록되어 있는지 검증 (Phase 1-2 와 연동).

### 4.4 메시지 봉투 (envelope)
```ts
{
  source: 'storige-editor',
  version: '1', // 본 표준 버전
  event: 'editor.ready' | 'editor.save' | ...,
  payload: { ... },
  timestamp: '2026-05-16T12:34:56.789Z'
}
```
부모는 `source === 'storige-editor'` 필터링.

---

## 5. 후속 작업 매핑

| Phase 0 결정 | 후속 Phase / Task |
|---|---|
| D-1 (inline embed) | Phase 5 (bookmoa-mobile `StorigeEditorHost`), Phase 1-1 (`editorLaunchMode='inline'`) |
| D-2 (snake/camel) | **A-2** — EditorView 호환 레이어 |
| D-3 (Base64 유지) | 본 문서 + 외부 문서 정정 |
| D-4 (재시도 서명 헤더) | 별도 핫픽스 후보 (Phase 0~2 외) |
| D-5, D-7 (응답코드) | 본 문서 명시 + 외부 문서 정정 |
| D-6 (PDF 프록시) | bookmoa-mobile Phase 7 |
| D-8 (201) | 외부 문서 정정 |
| D-9 (postMessage 표준) | **A-1** — embed.tsx 표준 구현 |
| D-10 (Site 기반 동적 정책) | **Phase 1-1, 1-2** |
| D-11 (`/output` 보호) | 보안 백로그 |

---

## 6. 외부 문서 정정 가이드

`PHP_INTEGRATION_FINAL_v3.md` / `PLATFORM_WORKER_INTEGRATION_v1.md` 에서 다음을 정정해야 한다.

1. **Webhook 서명**: "HMAC-SHA256" → "Base64 인코딩 (`${identifier}:${event}:${timestamp}`)" 로 정정. HMAC 은 v2 로 분리 표기.
2. **Worker job 생성 응답코드**: "200" → "201 Created. 클라이언트는 2xx 전체 성공 처리".
3. **`shop-session` 응답코드**: "HTTP 200" 명시.
4. **재시도 webhook**: `X-Storige-Retry: 1` 헤더로 식별. 현재 구현은 재시도 시 `X-Storige-Signature` 누락 — 외부 수신부는 이 동작 대응. (D-4 핫픽스 후 정정)
5. **편집기 실행**: "new tab / iframe / popup 중 택1" → **"inline embed 단일"** 로 단일화.
6. **URL 파라미터 케이스**: "snake_case 권장. 단 에디터가 camelCase도 수용" 명시.
7. **`/worker-jobs/:id/output`**: "외부 서비스는 자체 서버 프록시로만 호출. 클라이언트 직접 호출 금지."
8. **postMessage 표준**: 본 문서 §4 참조로 링크.

> 외부 문서 본문 직접 수정은 별도 PR 로 분리. 본 Phase 0 의 산출물은 이 결정 문서까지로 한다.

---

## 7. 다음 단계

- [ ] **A-1**: `apps/editor/src/embed.tsx` 에 `parentOrigin` 필수화 + postMessage 5종 이벤트 표준 구현
- [ ] **A-2**: `apps/editor/src/views/EditorView.tsx` 에 snake/camel 호환 레이어 추가
- [ ] **Phase 1-1**: `sites` 테이블에 `allowedOrigins`, `frameAncestors`, `editorLaunchMode`, `editorBundleUrl/CssUrl/Version` 컬럼 추가 + 마이그레이션
- [ ] **Phase 1-2**: API CORS callback / Editor CSP `frame-ancestors` / webhook host 검증을 sites 기반 동적 정책으로 전환 + Admin UI
- [ ] **Phase 2**: PHP 회귀 보호 — 기존 `STORIGE_API_KEY` 로 `shop-session` / `validate/external` / `synthesize/external` 통과 검증
