# Storige Platform Integration — v1 (2026-05-16)

> **대상**: Storige 플랫폼을 호출하는 모든 외부 서비스(쇼핑몰·앱·BaaS) 개발자.
> **목적**: shop-session · template-sets · worker-jobs(validate/synthesize/check-mergeable) · webhook 의 표준 계약을 한 문서로 정리.
> **선행 결정 문서**: `docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md`
> **언어 중립**: PHP / Node.js / Python 모두 동일. 본문 예시는 curl / Node fetch.
>
> 본 문서는 다음을 대체하지 않고 보완합니다 — `PHP_INTEGRATION_FINAL_v3.md`, `PLATFORM_WORKER_INTEGRATION_v1.md`. 두 문서에 Phase 0 정정 안내 박스가 있으며, 본 문서는 그 결정을 모두 반영한 단일 진입점입니다.

---

## 0. 5분 요약

```
[1회 셋업]   Storige Admin → 사이트 등록 → editorAuthCode / workerAuthCode 발급
              ↓
[잡마다 반복] ① 회원 세션 발급      POST /auth/shop-session            (X-API-Key)
              ② 상품 템플릿셋 조회   GET  /product-template-sets/by-product?sortcode=&stanSeqno=
              ③ (옵션) 검증         POST /worker-jobs/validate/external (X-API-Key)
              ④ 사전 점검           POST /worker-jobs/check-mergeable/external
              ⑤ 합성                POST /worker-jobs/synthesize/external
              ⑥ Webhook 수신        ← Storige가 X-Storige-Event/Signature 헤더로 POST
              ⑦ 결과 PDF 다운로드   외부 서버 어댑터가 /worker-jobs/{id}/output 프록시 (Bearer JWT)
```

### 핵심 원칙 (Phase 0 결정)

| # | 원칙 | 결정 ID |
|---|---|---|
| 1 | **inline embed 단일** — 편집기는 호출 페이지 위 오버레이/iframe. new tab / 페이지 라우팅 금지 | D-1 |
| 2 | URL 파라미터는 **snake_case + camelCase 양방향** 수용. 외부 문서 권장은 snake | D-2 |
| 3 | Webhook 서명은 **Base64** (HMAC 아님). v2 는 별도 트랙 | D-3 |
| 4 | Editor 진입 토큰은 **단기 JWT (≤1h)** | D-5 |
| 5 | 결과 PDF 는 **외부 서버 프록시 단일**. 클라이언트가 Storige URL 직접 호출 금지 | D-6 |
| 6 | `shop-session` HTTP **200**, worker job 생성 HTTP **201**. 클라이언트는 2xx 전체 성공 처리 | D-7, D-8 |
| 7 | postMessage `targetOrigin` 절대 `'*'` 금지 — `parentOrigin` 만 신뢰 | D-9 |
| 8 | CORS · CSP frame-ancestors · webhook host 는 **`sites` 테이블 동적 정책** (60s 캐시) | D-10 |

---

## 1. 인증 모델

### 1.1 두 종류의 토큰

| 토큰 | 발급처 | 형식 | 유효기간 | 용도 |
|---|---|---|---|---|
| **`X-API-Key`** (editor/worker 인증코드) | Storige 운영팀 → Admin 사이트 등록 → 발급 | `sk-storige-{48hex}` | 무기한 (재발급 시 즉시 무효) | **서버 간 호출** (잡 생성, 폴링, 파일 업로드, 템플릿 조회) |
| **JWT (shop-session)** | 외부 서버가 `POST /auth/shop-session` 으로 발급 | base64 JWT (payload 에 `siteId` / `memberSeqno` 포함) | 1h | **사용자 컨텍스트** (편집기 진입, 결과 PDF 다운로드 권한) |

### 1.2 사이트 자동 식별

`X-API-Key` 헤더 → `req.user.siteId` 자동 주입 → `worker_jobs.site_id`, `file_edit_sessions.site_id` 등에 기록. Admin 에서 사이트별 필터링 가능.

### 1.3 보안 원칙

- **`X-API-Key` 는 절대 브라우저 노출 금지** — 외부 서비스 서버 환경변수에만 보관.
- 브라우저에는 **단기 JWT 만** 전달 (URL 쿼리 `?token=` 또는 `EditorConfig.token`).
- 결과 PDF 다운로드는 **외부 서비스 서버가 프록시** — `/worker-jobs/{id}/output` URL 을 클라이언트에 직접 노출 금지.

---

## 2. 표준 엔드포인트

API Base: `https://api.papascompany.co.kr/api`

### 2.1 `POST /auth/shop-session` — 회원 세션 JWT 발급

회원 컨텍스트로 단기 JWT를 받습니다 (편집기 진입 / 다운로드 권한).

**요청**
```http
POST /auth/shop-session HTTP/1.1
Content-Type: application/json
X-API-Key: sk-storige-...

{
  "memberSeqno": 12345,
  "memberId": "member@example.com",
  "memberName": "홍길동"
}
```

**응답 (HTTP 200)**
```json
{
  "success": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR...",
  "expiresIn": 3600,
  "member": {
    "seqno": 12345,
    "id": "member@example.com",
    "name": "홍길동"
  }
}
```

> 응답과 함께 `storige_access` (path=/api, 1h) / `storige_refresh` (path=/api/auth, 30d) HttpOnly 쿠키도 발급되지만, 외부 사이트는 **`accessToken` 본문 값만 사용**하면 됩니다 (서드파티 쿠키 차단 회피).

**갱신**: `POST /auth/shop-refresh` (`storige_refresh` 쿠키 보유 시) — silent refresh 가능.

### 2.2 `GET /product-template-sets/by-product` — 상품 ↔ 템플릿셋 조회

**요청**
```http
GET /product-template-sets/by-product?sortcode=BOOK&stanSeqno=12 HTTP/1.1
X-API-Key: sk-storige-...
```

> 쿼리 파라미터는 **camelCase** (`stanSeqno`) 가 정식이며, snake_case (`stan_seqno`) 도 호환 레이어로 수용됩니다 (§5 참고).

**응답 (HTTP 200)**
```json
{
  "templateSets": [
    {
      "id": "ts-001",
      "name": "표준 양장 200×280",
      "type": "cover",
      "width": 200,
      "height": 280,
      "thumbnailUrl": "https://...",
      "isDefault": true
    }
  ]
}
```

존재하지 않으면 HTTP 200 + 빈 배열 또는 HTTP 404 (sortcode 조합 자체가 없을 때). 클라이언트는 `templateSets` 가 비어 있으면 "기본 템플릿 없음" 으로 처리.

### 2.3 `POST /worker-jobs/validate/external` — PDF 검증 잡 생성

업로드된 PDF가 인쇄 규격을 만족하는지 검증 (페이지 수 / 크기 / 출혈 / 폰트 임베드 등).

**요청**
```http
POST /worker-jobs/validate/external HTTP/1.1
Content-Type: application/json
X-API-Key: sk-storige-...

{
  "editSessionId": "11111111-1111-1111-1111-111111111111",
  "fileId": "22222222-2222-2222-2222-222222222222",
  "fileType": "cover",
  "orderOptions": {
    "size": { "width": 200, "height": 280 },
    "pages": 96,
    "binding": "perfect",
    "bleed": 3,
    "paperThickness": 0.1
  },
  "callbackUrl": "https://bookmoa-mobile.vercel.app/api/storige/webhook"
}
```

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `editSessionId` | UUID | optional | 편집 세션과 연결할 때 |
| `fileId` | UUID | optional | `fileUrl` 대신 사용 가능 (둘 중 하나 필수) |
| `fileUrl` | string | conditional | `fileId` 가 없으면 필수 |
| `fileType` | `"cover" \| "content" \| "post_process"` | ✅ | |
| `orderOptions` | object | ✅ | 검증 기준 |
| `orderOptions.size` | `{width, height}` mm | ✅ | |
| `orderOptions.pages` | int | ✅ | 내지 페이지 수 |
| `orderOptions.binding` | `"perfect" \| "saddle" \| "spring"` | ✅ | |
| `orderOptions.bleed` | mm | ✅ | 보통 3 |
| `orderOptions.paperThickness` | mm | optional | 책등 계산 필요 시 |
| `callbackUrl` | URL | optional | 결과 webhook URL |

**응답 (HTTP 201)**
```json
{
  "id": "33333333-3333-3333-3333-333333333333",
  "jobType": "validation",
  "status": "PENDING",
  "siteId": "26183a7c-50fe-11f1-b3e7-4e6e38709d53",
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

> **HTTP 201** (NestJS 기본). 일부 구버전 문서에 200 으로 표기된 경우가 있으나 클라이언트는 **2xx 전체 성공 처리**가 안전합니다 (Phase 0 D-8).

### 2.4 `POST /worker-jobs/check-mergeable/external` — 합성 사전 점검 (dry-run)

합성 잡을 발사하기 전에 표지·내지가 병합 가능한지(크기 일치, 페이지 수, 책등 폭) 미리 확인. 큐에 들어가지 않고 동기 응답.

**요청**
```http
POST /worker-jobs/check-mergeable/external HTTP/1.1
Content-Type: application/json
X-API-Key: sk-storige-...

{
  "editSessionId": "11111111-1111-1111-1111-111111111111",
  "coverFileId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "contentFileId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "spineWidth": 5.5
}
```

`coverUrl` / `contentUrl` 도 fileId 대안으로 허용. `spineWidth` 단위 mm.

**응답 (HTTP 200 또는 201, 2xx 모두 성공)**
```json
{
  "mergeable": true,
  "issues": []
}
```

병합 불가 시:
```json
{
  "mergeable": false,
  "issues": [
    { "code": "SIZE_MISMATCH", "message": "표지 폭 405mm ≠ 내지×2 + 책등 (412mm)" },
    { "code": "PAGES_EVEN_REQUIRED", "message": "내지 페이지 수가 홀수입니다 (97)" }
  ]
}
```

### 2.5 `POST /worker-jobs/synthesize/external` — PDF 합성 잡 생성

표지 + 내지를 인쇄용 단일 PDF 로 합성. 결과는 webhook 으로 push.

**요청**
```http
POST /worker-jobs/synthesize/external HTTP/1.1
Content-Type: application/json
X-API-Key: sk-storige-...

{
  "coverFileId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "contentFileId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  "spineWidth": 5.5,
  "bindingType": "perfect",
  "outputFormat": "merged",
  "orderId": "ORD-2026-99999",
  "editSessionId": "11111111-1111-1111-1111-111111111111",
  "callbackUrl": "https://bookmoa-mobile.vercel.app/api/storige/webhook",
  "priority": "normal"
}
```

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `coverFileId` / `coverUrl` | UUID / URL | ✅ 택1 | |
| `contentFileId` / `contentUrl` | UUID / URL | ✅ 택1 | |
| `spineWidth` | number (mm) | ✅ | |
| `bindingType` | `"perfect" \| "saddle" \| "hardcover"` | optional (default `perfect`) | `saddle` 은 중철 — 표지 펼침면 2-up 자동 |
| `outputFormat` | `"merged" \| "separate"` | optional (default `merged`) | `separate` 는 병합 + cover/content 분리 본 |
| `orderId` | string | optional | 외부 주문번호 (webhook 에 그대로 echo) |
| `editSessionId` | UUID | optional | 편집기 사용한 주문이면 |
| `callbackUrl` | URL | optional (강력 권장) | 결과 push 받을 webhook |
| `priority` | `"high" \| "normal" \| "low"` | optional | |

**응답 (HTTP 201)**
```json
{
  "id": "ccccccccc-cccc-cccc-cccc-cccccccccccc",
  "jobType": "synthesis",
  "status": "PENDING",
  "siteId": "26183a7c-50fe-11f1-b3e7-4e6e38709d53",
  "createdAt": "2026-05-16T10:00:00.000Z"
}
```

응답의 `id` 가 **jobId** — webhook 페이로드의 `jobId` 와 일치하므로 외부 DB에 매핑해 저장.

### 2.6 폴링 (옵션) `GET /worker-jobs/external/{id}`

Webhook 수신을 보장 못하는 환경(개발/로컬)에서 폴링용.

```http
GET /worker-jobs/external/ccccccccc-... HTTP/1.1
X-API-Key: sk-storige-...
```

**응답 (HTTP 200)**
```json
{
  "id": "ccccccccc-cccc-cccc-cccc-cccccccccccc",
  "status": "COMPLETED",
  "result": {
    "outputFileUrl": "/storage/outputs/2026-05-16/synthesis_xxx.pdf",
    "pages": 96
  },
  "completedAt": "2026-05-16T10:02:34.000Z"
}
```

`status`: `PENDING` → `PROCESSING` → `COMPLETED` (또는 `FIXABLE` / `FAILED`).

### 2.7 결과 PDF 다운로드 (외부 서버 프록시 전용)

```http
GET /worker-jobs/{id}/output HTTP/1.1
Authorization: Bearer <shop-session JWT>
```

- 응답: `Content-Type: application/pdf` 스트림.
- **외부 서비스는 자체 서버 어댑터에서만 호출하고, 응답을 클라이언트로 프록시 스트림**. Storige URL/API Key 를 브라우저에 절대 노출하지 않습니다.
- Phase 0 D-11: 이 엔드포인트는 향후 `ApiKeyGuard` 강화 대상 — 외부 서버는 Bearer JWT 만 사용 권장.

---

## 3. Webhook

Storige Worker 가 잡 완료/실패 시 외부 서비스의 `callbackUrl` 로 **POST** 요청을 보냅니다.

### 3.1 헤더

| 헤더 | 값 |
|---|---|
| `Content-Type` | `application/json` |
| `X-Storige-Event` | `synthesis.completed` / `synthesis.failed` / `validation.completed` / `validation.fixable` / `validation.failed` / `session.validated` / `session.failed` |
| `X-Storige-Signature` | Base64 서명 (§3.3) |
| `X-Storige-Retry` | `1` (재시도 호출에만, 초회는 없음) |

> ⚠️ **재시도 호출에는 현재 `X-Storige-Signature` 가 누락**됩니다 (Phase 0 D-4 — 별도 핫픽스 예정). 외부 수신부는 `X-Storige-Retry` 헤더가 있을 때 서명 누락을 허용해야 합니다.

### 3.2 페이로드 예시

#### `synthesis.completed`
```json
{
  "event": "synthesis.completed",
  "jobId": "ccccccccc-cccc-cccc-cccc-cccccccccccc",
  "orderId": "ORD-2026-99999",
  "editSessionId": "11111111-1111-1111-1111-111111111111",
  "status": "completed",
  "result": {
    "outputFileUrl": "/storage/outputs/2026-05-16/synthesis_xxx.pdf",
    "outputFiles": [
      { "type": "merged", "url": "/storage/outputs/.../merged.pdf" }
    ],
    "pages": 96,
    "spineWidth": 5.5
  },
  "timestamp": "2026-05-16T10:02:34.000Z"
}
```

#### `synthesis.failed`
```json
{
  "event": "synthesis.failed",
  "jobId": "...",
  "orderId": "ORD-2026-99999",
  "status": "failed",
  "errorMessage": "Ghostscript exited with code 1: ...",
  "timestamp": "2026-05-16T10:02:34.000Z"
}
```

#### `validation.completed` / `validation.fixable` / `validation.failed`
```json
{
  "event": "validation.completed",
  "jobId": "...",
  "editSessionId": "...",
  "status": "completed",
  "result": {
    "checks": [
      { "code": "PAGE_COUNT", "ok": true },
      { "code": "BLEED", "ok": true, "actualMm": 3.0 },
      { "code": "FONT_EMBED", "ok": true }
    ],
    "issues": []
  },
  "timestamp": "2026-05-16T10:00:30.000Z"
}
```

`validation.fixable` 은 자동 변환(addPages / applyBleed)으로 고칠 수 있는 상태 — 외부 서비스는 `POST /worker-jobs/convert/external` (별도) 흐름으로 후속 처리 가능.

### 3.3 서명 검증 (Base64)

Storige 는 다음 알고리즘으로 서명을 만듭니다:

```
identifier = payload.jobId ?? payload.sessionId
data       = `${identifier}:${payload.event}:${payload.timestamp}`
signature  = base64(utf8(data))
```

**Node.js 검증 예시**:
```js
function verifyStorigeSignature(req) {
  const headerSig = req.headers['x-storige-signature'];
  const isRetry = req.headers['x-storige-retry'] === '1';

  // Phase 0 D-4 호환: 재시도 호출은 헤더 누락 허용 (별도 핫픽스 전까지)
  if (!headerSig) return isRetry;

  const p = req.body;
  const identifier = p.jobId ?? p.sessionId;
  const data = `${identifier}:${p.event}:${p.timestamp}`;
  const expected = Buffer.from(data, 'utf8').toString('base64');
  return headerSig === expected;
}
```

**PHP 검증 예시**:
```php
function verify_storige_signature(array $headers, array $payload): bool {
    $headerSig = $headers['X-Storige-Signature'] ?? null;
    $isRetry   = ($headers['X-Storige-Retry'] ?? null) === '1';
    if (!$headerSig) return $isRetry;

    $identifier = $payload['jobId'] ?? $payload['sessionId'] ?? '';
    $data       = sprintf('%s:%s:%s', $identifier, $payload['event'], $payload['timestamp']);
    $expected   = base64_encode($data);
    return hash_equals($expected, $headerSig);
}
```

> ⚠️ **HMAC-SHA256 아님** (Phase 0 D-3). HMAC 마이그레이션은 v2 트랙으로 분리됩니다.

### 3.4 재시도 정책

- 첫 호출 실패(non-2xx 또는 타임아웃 10s) 시 **2초 후 1회 자동 재시도**.
- 재시도 호출에는 `X-Storige-Retry: 1` 헤더 추가, `X-Storige-Signature` 는 현재 누락 (D-4).
- 외부 서비스는 webhook 핸들러에서 **빠르게 200** 응답하고, 무거운 처리는 비동기 큐로.
- 멱등성: 동일 `jobId` 로 두 번 도착할 수 있으므로 외부 서비스의 webhook 핸들러는 멱등 처리(기존 상태 확인 후 중복 무시).

### 3.5 Webhook 호스트 등록

Storige API 는 SSRF 방어를 위해 webhook 호스트 allowlist 를 운영합니다.

1. **환경변수** (`WEBHOOK_ALLOWED_HOSTS` 콤마 구분) — 기본값에 `papascompany.co.kr`, `bookmoa.com`, localhost 류 포함.
2. **DB sites** (Phase 1-2, 2026-05-16): `sites.uploadCallbackUrl` 또는 `sites.domain` 의 호스트가 자동 폴백 매칭.

→ 새 외부 사이트 등록 시 Admin 에 `uploadCallbackUrl` 만 채우면 webhook 호스트가 자동 허용됩니다. **`.env` 수정 불필요**.

---

## 4. 편집기 진입 (inline embed 단일 표준)

### 4.1 두 가지 마운트 방식

| 방식 | 사용처 |
|---|---|
| **IIFE 마운트** | `window.StorigeEditor.create({...}).mount('element-id')`. 콜백 함수(`onReady/onSave/onComplete/onCancel/onError`)로 통신 |
| **iframe embed** | `<iframe src="https://editor.papascompany.co.kr/edit?...">`. `postMessage` 이벤트 5종으로 통신 |

bookmoa-mobile 권장: **iframe 오버레이** (호출 페이지 위에 풀스크린 마운트, 닫으면 직전 상태 그대로 복귀).

> **권한 권위는 `token` (shop-session JWT) 의 payload 안 `siteId`** — URL 파라미터 `siteId` 는 보조용. 자세한 정책은 §4.2 표 참조.

### 4.2 iframe URL 파라미터

```
https://editor.papascompany.co.kr/edit?
  templateSetId=ts-001 &
  token=<단기 JWT> &
  parentOrigin=https%3A%2F%2Fbookmoa-mobile.vercel.app &
  orderSeqno=99999 &
  mode=both &
  pageCount=96 &
  paperType=woodfree &
  bindingType=perfect &
  width=200 &
  height=280 &
  siteId=26183a7c-50fe-11f1-b3e7-4e6e38709d53   # 선택, 권한 결정에 사용 금지
```

> 본 표는 `Bookmoa_platform_Plan.md` **Phase 5.4** + Phase A-2 의문점 2번 결정(사용자 확정 2026-05-16)을 단일 진실로 한다.

| 파라미터 | 필수 | 비고 |
|---|---|---|
| `templateSetId` | ✅ | `/product-template-sets/by-product` 응답의 `id` |
| `parentOrigin` | ✅ | postMessage 발신 대상 origin. 절대 `'*'` 아님 |
| `token` | ✅ | `shop-session` 으로 발급한 JWT (≤ 1h). **권한 권위는 이 JWT payload 의 `siteId`** |
| `siteId` | ⬜ 선택 | UX 분기·로깅 보조용. **권한 결정에 사용 금지** (URL 파라미터는 위조 가능). 권한 권위는 JWT payload 의 `siteId`. 기존 PHP 사이트는 미전달(JWT 자동) 호환. |
| `mode` | 선택 | `both` / `cover` / `content` |
| `pageCount`, `paperType`, `bindingType`, `width`, `height` | 선택 | 주문 옵션 (책등·자동 맞춤에 사용) |
| `orderSeqno` / `orderId` | 선택 | 주문 식별. 장바구니 단계는 미전달(=null), 결제 후 실제 주문번호 발급 시점에 편집기 진입 |
| ~~`returnUrl`~~ | **금지** | inline embed 에서는 페이지 전환 없음 (Phase 0 D-1) |

> **호환성**: 기존 PHP 사이트는 `siteId` URL 파라미터를 보내지 않는다. 에디터는 URL `siteId` 가 없으면 JWT payload 의 `siteId` 를 폴백으로 사용. 양쪽 모두 정상 동작 — 기존 PHP 측 코드는 단 한 줄도 변경 불필요.

> 참고: Admin 전용 `template` 모드와 일부 부가 옵션(`callbackUrl`, `apiBaseUrl` 등)은 `apps/editor/src/embed.tsx` 의 `EditorConfig` 에 정의되어 있으나, **외부 사이트 inline embed 표준에는 포함되지 않습니다**.

### 4.3 postMessage 통신 표준 (iframe 모드)

#### 봉투 (envelope)
모든 메시지는 동일 구조로 발신:
```json
{
  "source": "storige-editor",
  "version": "1",
  "event": "editor.ready" | "editor.save" | "editor.complete" | "editor.cancel" | "editor.error",
  "payload": { ... },
  "timestamp": "2026-05-16T10:00:00.000Z"
}
```

#### 이벤트별 payload

> `editor.complete` 페이로드는 `Bookmoa_platform_Plan.md` **Phase 5.2 / Phase 6** 의 cart item 저장 계약을 단일 진실로 한다.

| event | 발생 시점 | payload (Plan 단일 진실) |
|---|---|---|
| `editor.ready` | 초기화 완료 | `{ sessionId?, templateSetId, version }` |
| `editor.save` | 자동/수동 저장 성공 | `{ sessionId, savedAt, thumbnail? }` |
| `editor.complete` | 사용자가 "편집 완료" | **`{ sessionId, coverFileId, contentFileId }`** — Phase 5.2 다이어그램 + Phase 6 cart `storige` 객체에 필요한 최소 필드. 부가 필드(`orderSeqno`, `templateSetId`, `editCode`, `pages`, `savedAt`, `thumbnailUrl` 등)는 코드(`embed.tsx` `EditorResult`)에 일부 존재하지만 **외부 사이트는 위 3개 필드만 의존**하도록 작성한다. |
| `editor.cancel` | 사용자가 닫기 | `{ sessionId? }` |
| `editor.error` | 에러 발생 | `{ code: "AUTH_EXPIRED" \| "NETWORK_ERROR" \| "SAVE_FAILED" \| "INVALID_DATA" \| "SESSION_NOT_FOUND", message }` |

> ⚠️ **현재 코드 ↔ 플랜 divergence**: `apps/editor/src/embed.tsx` 의 `EditorResult` 는 위 3개 필드 외에 `orderSeqno`, `editCode`, `pages.{initial,final}`, `files.{coverFileId,contentFileId,thumbnailUrl}`, `savedAt` 까지 emit 합니다. 외부 사이트(Codex 포함)는 위 3개 필드만 의존하면 안전하며, 코드 정렬 여부는 운영 결정 사항입니다.

#### 부모 측 수신 예시

```js
window.addEventListener('message', (e) => {
  // 1) origin 검증 — 등록된 Storige Editor 도메인만 신뢰
  if (e.origin !== 'https://editor.papascompany.co.kr') return;

  const msg = e.data;
  if (!msg || msg.source !== 'storige-editor' || msg.version !== '1') return;

  switch (msg.event) {
    case 'editor.ready':    onEditorReady(msg.payload);    break;
    case 'editor.save':     onEditorSave(msg.payload);     break;
    case 'editor.complete': onEditorComplete(msg.payload); break;
    case 'editor.cancel':   onEditorCancel(msg.payload);   break;
    case 'editor.error':    onEditorError(msg.payload);    break;
  }
});
```

#### Storige 측 발신 규칙

- `parentOrigin` 이 명시되지 않으면 postMessage 송신 비활성화 (콜백 함수만 동작).
- 송신 시 `window.parent.postMessage(envelope, parentOrigin)` — `targetOrigin` 절대 `'*'` 아님.
- iframe 이 top-level window 일 때(즉 iframe 아닐 때) 송신 스킵.

### 4.4 iframe embed 시 CSP / 쿠키 주의

- **CSP `frame-ancestors`**: Storige Editor 응답에 `frame-ancestors 'self' <site.frameAncestors>` 가 동적으로 합성됩니다 (Phase 1-2). bookmoa-mobile 같이 사이트 등록 시 `frameAncestors` 배열에 외부 origin 추가 필수.
- **`X-Frame-Options`**: 제거되었으므로 brower iframe embed 가능.
- **서드파티 쿠키**: `storige_access` 쿠키는 `sameSite: lax / path=/api` — iframe 안 3rd-party 차단 정책 환경에서 동작 보장 안 됨. → 외부 사이트는 **본문 `accessToken` 만 사용**.

---

## 5. URL 케이스 호환 레이어 사양 (D-2)

### 5.1 정책

- **에디터(EditorView) 및 외부 진입 URL** 은 camelCase 와 snake_case 양쪽을 동등하게 수용.
- 우선순위: **camelCase 우선**, 없으면 snake_case 폴백.
- 둘 다 명시 + 값이 다르면 camelCase 채택 + 콘솔 경고.

### 5.2 매핑표

| 외부 (snake_case 권장) | 내부 (camelCase) |
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
| `parent_origin` | `parentOrigin` |
| `cover_file_id` | `coverFileId` |
| `content_file_id` | `contentFileId` |
| `session_id` | `sessionId` |
| `callback_url` | `callbackUrl` |
| `return_url` | `returnUrl` (검증용 only — inline embed 에서 페이지 전환 없음) |

### 5.3 구현 위치

- 헬퍼: `apps/editor/src/utils/searchParams.ts` — `getParamCompat(params, camelKey)` / `getParamsCompat(params, [...keys])`
- 적용 지점: `apps/editor/src/views/EditorView.tsx` 의 모든 `searchParams.get()` 호출
- 외부 진입 URL 외에 **REST API 요청 본문 (JSON DTO) 은 camelCase 만 수용** — DTO 호환은 향후 별도 트랙

### 5.4 외부 서비스 작성 가이드

| 케이스 | 권장 |
|---|---|
| PHP / Python / Ruby 등 snake_case 관행 언어 | URL 파라미터는 **snake_case** 그대로 사용 OK |
| Node.js / TypeScript 등 camelCase 관행 | URL 파라미터는 **camelCase** 사용 권장 |
| REST API JSON 본문 | **camelCase 만** (서버 DTO와 일치) |

---

## 6. 환경 변수 권장 키 (외부 서비스 측)

서버 환경변수에만 보관 — 클라이언트 번들 노출 금지.

```bash
STORIGE_API_BASE=https://api.papascompany.co.kr/api
STORIGE_API_KEY=sk-storige-...           # editorAuthCode (Storige Admin 발급)
STORIGE_EDITOR_URL=https://editor.papascompany.co.kr
STORIGE_WEBHOOK_URL=https://your-domain.com/api/storige/webhook
STORIGE_WEBHOOK_VERIFY_HEADER=X-Storige-Signature
```

> ❌ `VITE_*`, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` 등 클라이언트 번들에 포함되는 prefix 절대 사용 금지.

---

## 7. 응답 코드 일람

| 코드 | 의미 | 행동 |
|---|---|---|
| 200 | OK (shop-session, GET, check-mergeable) | 성공 처리 |
| 201 | Created (잡 생성) | 성공 처리 (D-8: 2xx 전체 성공) |
| 204 | No Content | 성공, 본문 없음 |
| 400 | Bad Request | 입력 검증 실패 — 본문에 상세 |
| 401 | Unauthorized | API Key 무효 또는 토큰 만료 |
| 403 | Forbidden | 사이트 권한 부족 (site_id 불일치) |
| 404 | Not Found | 리소스 없음 (sortcode, jobId 등) |
| 409 | Conflict | 중복 (인증코드 충돌 등) |
| 422 | Unprocessable | 세션 데이터 불일치 (split synthesis) |
| 500 | Internal | Storige 측 에러 — Sentry 자동 전송, 재시도 권장 |
| 502/503/504 | Upstream / Down | 재시도 (지수 백오프 권장) |

---

## 8. 통합 점검 체크리스트

새 외부 서비스 온보딩 시 운영팀이 확인하는 순서.

- [ ] Admin "기본설정 > 사이트" 에서 신규 사이트 등록
  - [ ] `name`, `domain`
  - [ ] `allowedOrigins` (모든 환경 origin)
  - [ ] `frameAncestors` (iframe 임베드 시)
  - [ ] `uploadCallbackUrl` (full URL)
  - [ ] `editorLaunchMode: inline`
- [ ] 발급된 `editorAuthCode` / `workerAuthCode` 안전 채널로 외부 서비스 운영팀에 전달
- [ ] 외부 서비스 측 환경변수 `STORIGE_API_KEY` 설정 (서버 only)
- [ ] `POST /auth/shop-session` 테스트 → HTTP 200 + `accessToken`
- [ ] `GET /product-template-sets/by-product?sortcode=&stanSeqno=` 테스트 → HTTP 200 + `templateSets`
- [ ] `POST /worker-jobs/check-mergeable/external` 더미 호출 → HTTP 2xx + `mergeable`
- [ ] (테스트 환경) `POST /worker-jobs/synthesize/external` 발사 → webhook 수신 확인
- [ ] webhook 서명 검증 (Base64) 통과
- [ ] 결과 PDF 서버 프록시 정상 다운로드

---

## 9. 관련 문서

- `docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md` — D-1~D-11 결정 + 코드 현황
- `docs/PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md` — 회귀 보호 절차
- `docs/PHP_INTEGRATION_FINAL_v3.md` — bookmoa PHP 1차 가이드 (정정 안내 박스 포함)
- `docs/PLATFORM_WORKER_INTEGRATION_v1.md` — 워커 연동 단독 가이드 (정정 안내 박스 포함)
- `Bookmoa_platform_Plan.md` — 전체 통합 계획 (Phase 0~9 + Group A/B)
- `scripts/test-php-regression-phase2.sh` — 자동 회귀 테스트

---

## 10. 변경 이력

| 날짜 | 버전 | 변경 |
|---|---|---|
| 2026-05-16 | v1.0 | 최초 작성 (Phase 0 결정 반영) — D-1~D-11 일관, snake/camel 호환, postMessage 5종 표준, sites 동적 정책 |
