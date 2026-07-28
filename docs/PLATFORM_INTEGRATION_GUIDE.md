# Storige 플랫폼 연동 가이드 (외부 파트너용)

> **작성일:** 2026-06-20
> **대상:** 외부 파트너 개발자
> **상태:** 배포용 정본

> 본 문서는 외부 파트너 개발팀이 Storige 인쇄 백엔드와 연동하기 위한 기술 레퍼런스입니다.
> 코드/계약(엔드포인트·JSON·curl)은 언어중립적으로 작성되었으며, 복붙으로 바로 시작할 수 있도록 구성했습니다.
> 모든 API 키/시크릿/토큰 값은 `<PLACEHOLDER>` 로 표기되어 있습니다. 실제 값은 Storige 운영팀이 보안 채널로 별도 전달합니다.

---

## 0. 한눈에 보기 — 3가지 연동 유형 결정 매트릭스

Storige는 단일 인쇄 백엔드로서 여러 외부 파트너를 호스팅합니다. 각 파트너는 `sites` 테이블의 1 row = 1 테넌트로 격리됩니다. 어떤 연동 유형을 선택할지는 아래 매트릭스로 결정합니다.

| 유형 | 누가 편집기 운영 | Storige 담당 범위 | 대표 파트너 | 임베드 필요? | 결과 전달 방식 | 상태 |
|---|---|---|---|---|---|---|
| **유형 1** | 파트너 (자체 편집기) | PDF 생성/검증·합성·이행만 오프로드 | 100p Books | 아니오 (서버간 API) | `GET /files/:id/download/external` 다운로드 (폴링/웹훅) | 운영 중 |
| **유형 2** | Storige (`/embed` 임베드) | 편집·저장·합성·다운로드 전부 | bookmoa-mobile, ShareSnap | 예 (iframe 또는 IIFE) | Storige 내부 합성 → 다운로드 | 운영 중 |
| **유형 3** | Storige (`/embed` 임베드) | 임베드 편집 + 외부가 합성 결과파일만 수신 | Shopify (제안) | 예 | 웹훅 + `download/external` 조합 | **미구현 (제안)** |

> **파트너 분류 근거(코드 검증):**
> - **유형 1 = 100p Books 단독.** 100p Books 어댑터는 서버사이드에서 `X-API-Key` 로 `upload/external`·`validate/external`·`download/external` + 보존 cron 만 사용하며 iframe/embed/postMessage 호출이 전혀 없습니다(진짜 자체편집기 오프로드 = 전략적 통합: PDF 저장/검증만 위탁).
> - **ShareSnap 은 유형 2(임베드)입니다.** 자체 편집기가 없고 Storige 편집기를 `/embed` iframe 으로 띄워 `shop-session` JWT + `parentOrigin` + `compose-mixed` 를 사용합니다. ShareSnap 고유 변형으로, 세션 `metadata.externalPhotos` 를 편집기 '공유방 사진' 탭(`useExternalPhotosStore`)에 주입하는 사진주입 흐름을 추가로 씁니다.
> - **PrintCard Studio(=JumboCard, 동일 서비스)** 도 유형 2(임베드)이나 현재 **보류** 상태입니다. `StorigeEditorHost` 가 `<iframe>` + `source === "storige-editor"` postMessage 수신으로 구현되어 있습니다.

**유형 선택 가이드:**
- 이미 자체 Fabric/렌더러로 PDF를 만들 수 있고 Storige의 인쇄 검증·합성·보존 인프라만 필요하다 → **유형 1**
- 편집 UI 자체를 Storige에 위임하고 싶다 (편집기 개발 부담 회피) → **유형 2**
- 유형 2로 편집은 위임하되 최종 합성 결과를 자체 시스템(예: Shopify 주문)으로 끌어와야 한다 → **유형 3 (현재 빌딩블록 조합, 일부 갭 있음 — 4장 참조)**

---

## 1. 공통 기반

### 1.1 온보딩 절차

> **중요:** 파트너 셀프서비스 등록은 존재하지 않습니다. 모든 Site(테넌트)는 Storige 운영자가 Admin에서 생성합니다. 파트너는 아래 양식을 보안 채널로 요청하고, 발급된 키를 보안 채널로 수령합니다.

**절차:**
1. 파트너 → Storige 팀에 아래 양식 전달
2. Storige 운영자가 Admin(JWT + ADMIN/MANAGER 권한)에서 `POST /api/sites` 로 Site 생성
   - `editor_auth_code` 자동 생성 (`sk-storige-{48hex}` 형식 = `sk-storige-` 접두 + 24바이트 hex)
   - `worker_auth_code` 는 생성 시 명시하지 않으면 코드상 `editor_auth_code` 와 **동일 값**으로 시드됩니다 (`workerAuthCode = dto.workerAuthCode || editorAuthCode`). 단 `regenerate` 로 분리될 수 있으므로 파트너는 두 값이 다를 수 있다고 가정하고 단일 키로 취급하세요 (1.2 참조).
3. Storige 운영자가 API Key를 보안 채널로 파트너에게 전달
4. (프로덕션 전) `allowedOrigins` 수정(`PUT /api/sites/:id`) + (임베드 시) `frameAncestors` 등록(`PUT /api/sites/:id`) + `uploadCallbackUrl` 수정(`PUT /api/sites/:id`)
   > 임베드 도메인 허용은 **운영자의 `frameAncestors` 등록만으로 반영**됩니다 — 편집기 재배포는 필요 없습니다(캐시 2단으로 반영까지 최대 약 2분, 1.5 참조).

**온보딩 요청 양식 (파트너 → Storige 팀):**

```
파트너 서비스명:          <예: ShareSnap>
서비스 도메인:            <예: app.example.com>
연동 유형:                <유형 1 | 유형 2 | 유형 3>
[브라우저 임베드 시] 허용 Origin 목록(allowedOrigins):
                          <예: https://app.example.com, https://staging.example.com>
[웹훅 수신 시] uploadCallbackUrl:
                          <예: https://api.example.com/storige/webhook>
회원번호 체계(정수):      <파트너 자체 정수 회원번호 발급 방식>
보존정책(retentionDays):  <예: 14 / 0=영구>
대용량 검증 필요?:        <현재 2GB까지 검증 가능. 2GB 초과가 필요하면 운영팀 사전 협의 — 1.4 참조>
환경:                     <dev | staging | prod>
```

### 1.2 인증 (X-API-Key · v1 Bearer)

Storige는 외부 파트너를 두 방식으로 인증합니다.

**(A) 서버간 / 브라우저 직결 — `X-API-Key` 헤더**

- DB `sites` 테이블에 대조됩니다.
- 각 Site는 **두 개의 코드**를 보유: `editor_auth_code`, `worker_auth_code`. 가드는 이 순서로 매칭하여 `role='editor'` 또는 `role='worker'` 를 설정합니다.
- **현재 프로덕션에서는 두 코드가 사이트별로 동일 값으로 시드됩니다** (생성 시 worker 코드 미지정이면 editor 코드 복사). 즉 editor/worker 구분은 구조적 배선일 뿐, 오늘 기준 별개의 키로 강제되지 않습니다.
- **파트너는 단일 키를 전권(editor + worker 모두) 키로 취급해야 합니다.** 키가 유출되면 양쪽 권한이 모두 노출됩니다.

```
X-API-Key: <YOUR_SITE_API_KEY>
```

> **내부 워커 키(`WORKER_API_KEY`)의 의미:** 가드는 매칭된 키가 env `WORKER_API_KEY` 와 같으면 `role='worker'` 로 강제하고 **테넌트 스코프를 바이패스**합니다(모든 잡 접근). 이는 Storige 내부 워커 전용이며 외부 파트너에게 공유되지 않습니다. 파트너 사이트 키는 항상 자기 테넌트 잡으로만 스코핑됩니다.

**(B) 편집기 임베드 — shop-session JWT (유형 2/3)**

- 파트너 **서버**가 먼저 `X-API-Key` 로 보호된 `POST /api/auth/shop-session` 을 호출하여 회원 정보를 넘기고, 단기 JWT `accessToken`(1시간) + `refreshToken`(30일)을 받습니다.
- 편집기 번들은 그 Bearer JWT를 사용합니다. JWT에는 API 키의 Site에서 복사된 `siteId`/`siteName` 이 박혀 있어, 테넌트가 키 → 편집기 세션으로 전파됩니다.

**키 종류·분리·보관 원칙:**
- API Key는 **반드시 서버에서만** 사용 (브라우저에 노출 금지).
- 키는 `sites` 테이블에 평문 저장되며 동등 비교로 조회됩니다 (해싱 없음). → **키 비밀유지가 서버간 보안의 전부입니다.**
- 키 회전은 **운영자만 수행**합니다 (파트너 직접 불가 — 운영팀에 요청). 회전 대상은 editor/worker 를 따로 또는 함께 지정할 수 있고, 각각 **독립 난수**로 재생성되므로 회전 후 두 값이 달라질 수 있습니다.
- `WORKER_API_KEY`(내부 전용 환경키)는 절대 외부 파트너에게 공유되지 않습니다.

**(C) Partner API v1 (`/api/v1/*`) — `Authorization: Bearer` 또는 `X-API-Key`**

- v1 전용 가드는 두 헤더를 **병행 수용**합니다. 둘 다 보내면 `Authorization` 이 우선이고, **두 값이 다르면 `401 ERR_UNAUTHORIZED`** 입니다 (어느 키로 인증할지 단정할 수 없어 모호성을 거부).
- **v1 에는 무인증 라우트가 0건입니다.** `GET /api/v1/ping` 도 키를 요구하므로 온보딩 시 키 확인 스모크로 그대로 쓸 수 있습니다.
- v1 발급 키에는 환경(`test` | `live`)이 내재하며 데이터가 완전히 격리됩니다. 위 (A) 의 `sites` 키로 v1 을 호출하면 `live` 로 취급됩니다. `test` 키가 live 전용 라우트를 호출하면 `403 ERR_ENV_MISMATCH` 이나, **오늘 기준 live 전용으로 마킹된 v1 라우트는 없습니다**.
- v1 은 §5.1 의 레거시 외부 표면과 **별개 계약**입니다 (경로·에러 봉투·리밋·멱등이 다릅니다). 공통 계약은 1.7 참조.

### 1.3 Base URL · 환경

| 환경 | 종류 | URL |
|---|---|---|
| 프로덕션 | API | `https://api.papascompany.co.kr/api` |
| 프로덕션 | Editor | `https://editor.papascompany.co.kr` |
| dev / staging | — | TBD (온보딩 시 별도 전달) |

### 1.4 파일 한도 (크기 · 콘텐츠타입 화이트리스트)

| 경로 | 최대 크기 | 비고 |
|---|---|---|
| 서버 경유 multipart 업로드 (`/files/upload`, `/files/upload/external`) | **100 MB** | `multer` 한계 + PDF만 |
| presigned 단일/멀티파트 직결 (R2) | **2 GB** | `MAX_EXPECTED_SIZE` |

**콘텐츠타입 화이트리스트 (presigned `contentType`):**

```
application/pdf
image/jpeg
image/png
image/webp
image/gif
```

- 화이트리스트 외는 `400 UNSUPPORTED_CONTENT_TYPE`.
- **`image/svg+xml` 은 명시적으로 제외됩니다.** 이유: `/files/:id/raw` 가 `@Public` 인라인 서빙이므로, SVG가 인라인 서빙되면 Stored XSS 위험이 있습니다.
- 서버 경유 PDF 업로드는 `mimetype !== 'application/pdf'` 면 `400 UNSUPPORTED_FORMAT`.

> ⚠️ **크기 상한 — 파트너가 기준으로 삼을 값은 셋뿐입니다.**
>
> | 경로 | 현재 상한 |
> |---|---|
> | v1 직접 업로드(멀티파트) | **100 MB** |
> | presigned 업로드 | **2 GB** |
> | 워커 PDF 검증 | **2 GB** |
>
> 업로드 상한과 검증 상한이 같으므로, 업로드에 성공한 PDF 는 크기 때문에 최종화에서 막히지 않습니다. 검증 상한을 넘는 파일을 `validate/external` 에 넣으면 즉시 `FAILED`('N MB를 초과합니다')로 거부됩니다. 2 GB 를 넘는 파일이 필요하면 온보딩 양식에 명시하세요 — 상한 상향은 운영팀 작업이며 사전 협의가 필요합니다.

### 1.5 보안 모델

**`/files/:id/raw` — 이미지 전용**
- `RAW_SERVE_TYPES = {image/jpeg, png, webp, gif}` 만 서빙합니다.
- content PDF·합성 PDF·svg·html은 코드로 `404` 처리됩니다 (스트림 파기 후 404).
- 이유: content PDF가 동일 `files` 테이블에 `status=ready` 로 공존하고, 편집기가 게스트 presigned(`type:content`)로 올리므로 content-type만이 안전 판별자입니다. PDF의 무인증 노출을 차단합니다.

**content PDF 다운로드 권한 경계 (JWT vs X-API-Key + site)**
- 내부 사용자: `GET /files/:id/download` — **JWT** + 소유자/staff 검증 (2026-05-03 패치로 `@Public` 제거. UUID 유출 시 무인증 다운로드 회귀 차단).
- 외부 파트너: `GET /files/:id/download/external` — **X-API-Key** + `assertSiteAccess`(file.siteId가 caller.siteId와 일치하거나 NULL일 때만 허용, 불일치 시 `404`로 존재 은닉).

**테넌트 식별 = API 키만**
- 테넌트는 **어떤 API 키가 매칭되었는지로만** 결정됩니다. Origin이나 별도 site 헤더는 테넌트 결정에 쓰이지 않습니다.
- Origin↔키 결합(confused-deputy 방어)은 현재 없습니다. 파트너 키는 비-브라우저 컨텍스트에서 어디서든 동작합니다 → **키 비밀유지가 유일한 보안 경계입니다.**

**CORS / allowedOrigins (브라우저 한정, 테넌트 경계와 별개)**
- 결정 순서: (a) Origin 없음(curl/서버간) → **무조건 허용**; (b) 정적 env `CORS_ORIGIN`/localhost → 허용; (c) `*.vercel.app` / `*.papascompany.co.kr` 정규식 → 허용; (d) DB의 활성 사이트 `allowed_origins` 합집합(60초 캐시) → 허용; 그 외 차단+로깅.
- `credentials: true`, 허용 헤더에 `X-API-Key` 포함.
- ⚠️ **Origin 없는 요청은 무조건 통과합니다.** 따라서 서버간 API 키 호출은 Origin 제한을 받지 않으며, allowedOrigins는 브라우저 내 방어이지 테넌트 경계가 아닙니다.

**iframe 임베드 (CSP frame-ancestors)**
- `/embed` 응답의 `Content-Security-Policy: frame-ancestors` 는 **정적 baseline + 등록된 파트너 도메인**으로 합성됩니다. 정적 baseline(자체 도메인 계열 · `*.vercel.app` · localhost)은 편집기 배포에 고정돼 있고, 그 밖의 파트너 도메인은 운영자가 `PUT /api/sites/:id` 의 `frameAncestors` 에 등록하면 편집기가 `GET /api/frame-ancestors` 로 읽어 **재배포 없이** 반영합니다.
- 반영 지연은 **최대 약 2분**입니다 — 서버 HTTP 캐시(`Cache-Control: max-age=60`)와 편집기 미들웨어 캐시(60초)가 **직렬로 겹치기** 때문입니다(60 + 60). 등록 직후 1분 남짓에 확인하고 "반영 실패"로 단정하지 마세요. 조회 실패·타임아웃 시에는 정적 baseline 이 그대로 적용되어 **기존 임베드가 끊기지 않습니다**.
- 합성은 **추가만 가능**합니다(정적 baseline 의 상위집합만 만들어짐) — 등록으로 이미 허용된 도메인을 줄일 수는 없습니다.
- 등록 가능한 값은 `https://app.example.com` / `https://*.example.com` 처럼 **스킴 + 호스트(+포트)** 형태뿐입니다. 경로가 붙은 값·스킴 없는 값·전면 와일드카드(`*`)·TLD 단독 와일드카드(`*.com` 류)는 CSP 합성 단계에서 **조용히 제외**되므로, 등록 후 실제 임베드로 반영을 확인하세요.
- `frameAncestors` 등록은 **운영자 표면(`PUT /api/sites/:id`)** 전용입니다 — 파트너 셀프서비스 등록 경로는 없습니다(1.1 참조). 사이트당 최대 50개.

**시크릿 취급**
- API 키·refreshToken은 로그/리퍼러에 노출되지 않도록 주의 (임베드 URL에 토큰이 쿼리로 실립니다 — 1.2(B), 3장 참조).
- 파트너 API 키는 운영자가 회전할 수 있습니다. **회전 즉시 이전 키는 무효**가 되므로, 회전 통보를 받으면 파트너 서버의 키를 교체하세요. 회전이 필요하면 운영팀에 요청하세요 (1.2 참조).

### 1.6 에러 · 레이트리밋

| 항목 | 값 |
|---|---|
| `shop-session` / refresh 라우트 | `@Throttle 20/min` (단일 파트너 서버 IP 기준 설정) |
| `presigned-upload-public` / `multipart/init` | `20 / 60s` |
| `multipart/sign` | `600 / 60s` (파트당 1콜) |
| `multipart/complete` / `abort` / `:id/complete` | `30 / 60s` |
| `/files/:id/raw` | `120 / 60s` |
| `/files/:id/thumbnail` | `60 / 60s` (캐시 1h `private`) |

> 다중 IP 또는 고볼륨 파트너는 `shop-session` 20/min 한계에 걸릴 수 있습니다 (코드상 상향 필요로 명시됨). 온보딩 시 협의하세요.

**공통 에러 코드:** `401`(invalid/suspended key), `400`(UNSUPPORTED_FORMAT / UNSUPPORTED_CONTENT_TYPE / class-validator 검증 오류 등), `404`(존재 은닉 포함), `503 STORAGE_NOT_S3`(presigned인데 driver≠s3).

**Partner API v1 (`/api/v1/*`) 레이트리밋 — 위 표와 별개 체계입니다.**

| 버킷 | 기본값 | 적용 라우트 |
|---|---|---|
| general | **300 req/min** (API 키 단위) | 아래 heavy 외 전부 |
| heavy | **100 req/min** (API 키 단위) | 자산 투입 5종(`POST`/`PUT books/{uid}/pdf-cover` · `POST`/`PUT books/{uid}/pdf-contents` · `POST books/{uid}/photos`) + `POST books/{uid}/finalization` + `GET books/{uid}/pdf` |

- 초과 시 `429 ERR_RATE_LIMITED` + **`Retry-After`**(초) 헤더. 이 값을 준수해 재시도하세요.
- ⚠️ **`X-RateLimit-*` 잔량 헤더는 보내지 않습니다.** 선제 회피가 불가능하고 429 를 받은 뒤 대응하는 반응형 처리만 가능합니다. 다수 도서를 동시에 폴링하면 general 버킷에 닿을 수 있으니, 완료 통지는 **웹훅을 정본 경로**로 두고 폴링은 백스톱으로만 쓰세요.

### 1.7 Partner API v1 (`/api/v1/*`) — 공통 계약

> **신규 연동은 이 표면으로 시작하세요.** §5.1 의 레거시 외부 표면(`/api/files/*` · `/api/worker-jobs/*`)은 기존 파트너 호환을 위해 유지되지만, 경로·에러 봉투·멱등·리밋이 서로 다른 **별개 계약**입니다. 두 표면을 한 요청 흐름에 섞지 마세요.

**표면 규모:** 16 경로 / 22 오퍼레이션 — `ping` 1 · `book-specs` 3 · `books` 11 · `webhooks` 7 (전량 목록은 5.1). 전부 파트너 키가 필요합니다.

**Base URL:** `https://api.papascompany.co.kr` + `/api/v1` (예: `https://api.papascompany.co.kr/api/v1/ping`).

**성공 봉투 — 필드 4종 고정**

```json
{ "success": true, "message": "Success", "data": { }, "pagination": null }
```

- 목록 라우트만 `pagination` 이 채워집니다: `{total, limit, offset, hasNext}`. 그 외에는 `null`.
- 목록 쿼리 `limit` 기본값 20 · 최대 100이며, **초과값은 100으로 캡됩니다**(에러가 아닙니다). `offset` 은 0 기준.
- ⚠️ **예외 1건 — `GET /api/v1/books/{uid}/pdf` 는 봉투가 없습니다.** 성공 시 `application/pdf` 바이너리가 그대로 스트리밍되고, 오류일 때만 JSON 에러 봉투가 옵니다. 수신측은 **`Content-Type` 으로 분기**해야 하며, 산출물이 GB 단위까지 커질 수 있으므로 전량 버퍼링(`arrayBuffer()` 등) 없이 스트림으로 소비하세요.

**에러 봉투**

```json
{
  "success": false,
  "errorCode": "ERR_PAGE_COUNT_OUT_OF_RANGE",
  "message": "사람용 설명",
  "errors": [{ "code": "…", "message": "…" }],
  "fieldErrors": { "pageCount": ["…"] },
  "requestId": "…"
}
```

- **분기는 반드시 `errorCode` 로 하세요.** `message` 는 사람용이며 예고 없이 개선됩니다.
- 코드 카탈로그는 **additive 로만** 성장합니다(기존 코드의 의미·HTTP status 변경/삭제 없음). 따라서 **모르는 코드에서 크래시하지 말고** 기본 분기로 흘리세요.
- `fieldErrors` 는 검증 실패(`ERR_VALIDATION_FAILED`)에서만 채워지고 그 외에는 `null`.
- `requestId` 는 문의 시 그대로 전달하세요.

**멱등 (`Idempotency-Key`)**

| 항목 | 값 |
|---|---|
| 적용 조건 | **`POST` + `Idempotency-Key` 헤더가 있을 때만.** 헤더가 없으면 멱등 보호 없이 통과 |
| 미적용 | `GET` · `PUT` · `DELETE` (자연 멱등) |
| 키 형식 | 1~128자. 벗어나면 `400 ERR_VALIDATION_FAILED` |
| 스코프 | 사이트 + env + method + 실제 경로 + 키 |
| 보관 | **24시간**. 같은 키·같은 body 재호출은 최초 응답 스냅샷을 재전달하며 응답에 `Idempotency-Replayed: true` 가 붙습니다 |
| 같은 키 + 다른 body | `422 ERR_IDEMPOTENCY_KEY_MISMATCH` |
| 처리 중 같은 키 | `409 ERR_IDEMPOTENCY_IN_PROGRESS` — 짧은 백오프 후 재시도 |
| 5xx | 선점이 해제되어 스냅샷이 남지 않습니다 → 같은 키로 재시도해도 안전 |

> 🚨 **멀티파트 업로드에는 `Idempotency-Key` 를 그대로 쓰지 마세요.** 멱등 판정이 **요청 본문 해시**로 이루어지는데, `multipart/form-data` 요청에서는 본문 파싱이 멱등 판정보다 뒤에 일어나 **해시가 파일 내용과 무관한 상수**가 됩니다. 그 결과 같은 키로 **다른 파일**을 올리면 서버가 "같은 요청"으로 보고 첫 응답을 재전달하고, **두 번째 파일은 오류 없이 조용히 사라집니다.** 대응은 둘 중 하나입니다 — ① 멀티파트에는 키를 붙이지 않는다, ② 붙이려면 **업로드마다 유일한 키**(예: 파일 바이트 해시를 키에 합성)를 쓴다. 근본 회피는 **`fileId` 참조 경로**(본문이 JSON) 사용입니다 — 2.0 참조.

**업로드 한도**

| 경로 | 상한 | MIME |
|---|---|---|
| v1 직접(멀티파트) 자산 투입 | **100 MB** (초과 `413 ERR_FILE_TOO_LARGE`) | **PDF 전용** — 이미지는 `415 ERR_UNSUPPORTED_CONTENT_TYPE` |
| presigned 업로드 표면 → `fileId` 참조 | **2 GB** | 1.4 의 화이트리스트 |

- **presigned 업로드 표면은 v1 표면이 아닙니다**(§2.2 의 `/api/files/*` 경로 — 인증·에러 shape·리밋이 v1 과 다릅니다). 큰 파일이나 이미지는 그 표면으로 올려 `files.id` 를 받은 뒤, v1 자산 라우트에 `{"fileId": "..."}` 로 **참조**하세요.
- presigned `complete` 확정 전의 `fileId` 를 참조하면 `409 ERR_FILE_NOT_READY`.
- ⚠️ **업로드 상한과 검증 상한은 다릅니다.** 워커 PDF 검증 상한은 현재 **2 GB** 이므로(1.4), 그보다 큰 PDF 는 업로드가 되더라도 최종화 단계에서 거부됩니다.

**생성 유형 (`creationType`) — 4종 중 2종만 최종화까지 동작**

| 값 | 상태 | 용도 |
|---|---|---|
| `PDF_UPLOAD` | 운영 중 | 파트너가 만든 표지/내지 PDF 를 투입 (유형 1 — 2.0) |
| `EDITOR_SESSION` | 운영 중 | 임베드 편집기의 완료 세션을 도서로 승격 (유형 2) |
| `TEMPLATE` | **부분 — 최종화 불가** | 생성(`201` DRAFT)은 되지만 **최종화가 `422 ERR_ASSETS_INCOMPLETE`(`errors[0].code = TEMPLATE_COVER_NOT_RENDERED`)로 거부됩니다.** `templateSetId` 도 저장·바인딩되지 않습니다 |
| `MIX_COVER_TEMPLATE` | **부분 — 최종화 불가** | 위와 동일 — 생성은 되고 최종화만 `422 ERR_ASSETS_INCOMPLETE`(`TEMPLATE_COVER_NOT_RENDERED`) |

> ⚠️ **"거부"가 생성 단계라고 오해하지 마세요.** 두 유형은 `POST /api/v1/books` 가 `201` 로 성공하므로, 파트너 코드가 생성 성공을 "지원됨"으로 해석하면 **최종화 시점에야** 실패합니다. 표지 템플릿 렌더가 미도입이라 최종화에 필요한 표지 자산이 만들어지지 않는 것이 원인입니다. 현재 최종화 가능한 유형은 `PDF_UPLOAD` · `EDITOR_SESSION` 뿐입니다.

**`EDITOR_SESSION` 승격 (유형 2 → v1)**

- `POST /api/v1/books` 에 `{creationType:'EDITOR_SESSION', sessionId}` 를 보내면, 세션 산출 PDF 가 `pdf_contents` 자산으로 **자동 연결된** DRAFT 도서가 생성됩니다. `PDF_UPLOAD` 와 달리 **수동 자산 투입 라우트를 호출하지 않습니다.**
- 승격은 **파트너 서버에서** 하세요. 파트너 API 키를 브라우저에 내리면 그 키를 얻은 누구나 테넌트 전체의 도서를 만들고 읽을 수 있습니다.
- 거부 3종:

| 코드 | status | 원인 |
|---|---|---|
| `ERR_NOT_FOUND` | 404 | 세션 없음 **/ 다른 테넌트 세션 / 소유 사이트가 없는(게스트) 세션** — 세 경우를 한 코드로 뭉뚱그리는 것은 존재 은닉(IDOR 방지)이라 의도적입니다 |
| `ERR_SESSION_NOT_PROMOTABLE` | 409 | `errors[]` 에 세부 코드 — `SESSION_NOT_COMPLETE`(편집 미완료) · `SESSION_OUTPUT_MISSING`(합성 산출 없음) · `SESSION_OUTPUT_UNAVAILABLE` |
| `ERR_VALIDATION_FAILED` | 400 | `sessionId` 누락 |

> **가장 흔한 실패는 게스트 세션입니다.** 회원 토큰 없이 편집기를 띄우면 세션에 소유 사이트가 남지 않아 **어떤 테넌트도 승격할 수 없습니다**. 게스트 완료 분기는 3.2 의 `editor.complete` payload 로 판정하세요.

**최종화 (finalization)**

- `POST /api/v1/books/{uid}/finalization` 으로 착수하고, 상태는 `PENDING → VALIDATING → COMPOSING → COMPLETED | FAILED` 로 전이합니다.
- **`409 ERR_FINALIZATION_IN_PROGRESS` 는 실패가 아닙니다.** 이미 진행 중이라는 뜻이므로 `GET .../finalization` 으로 기존 attempt 에 합류하세요. 이걸 에러로 처리하면 실제로는 성공한 주문을 "실패"로 보여 주게 됩니다.
- 최종화 **실패는 예외가 아니라 값**으로 옵니다 — 폴링 응답의 `status: 'FAILED'` + `errorCode` 로 분기하세요.
- 🖨️ **`bookSpecUid`(판형)를 연결하지 않으면 워커 구조 검증이 통째로 생략됩니다.** 대조할 판형이 없으면 서버는 검증을 건너뛰고 최종화하며, 결과에 `validationSkipped: true` 가 실립니다. 그 도서는 재단·페이지수·여백이 한 번도 대조되지 않은 **미검증 상태**이므로 자동 발주로 흘리지 말고 자체 검수 게이트를 태우세요. 페이지수까지 대조하려면 `pageCount` 도 함께 넘겨야 합니다.

**클라이언트 라이브러리**

- TypeScript SDK `@storige/sdk` 는 **사내 배포 검토 중이며 현재 npm 에 배포돼 있지 않습니다.** 배포 전까지는 위 계약(헤더·봉투·상태코드)을 직접 구현하거나, 레포의 `examples/` 실행 예제 3종을 참고하세요.
- 예제는 라이브 키 없이 도는 오프라인 검증(`verify`)을 포함합니다 — **실 서버 대상 스모크는 파트너 환경에서 별도로** 해야 합니다.

---

## 2. 유형 1 상세 — 자체 편집기 + 검증/합성 오프로드

> 대표: 100p Books (자체 편집기로 PDF 생성 → Storige에 검증/합성/보존만 오프로드)

### 2.0 v1 경로 (`/api/v1/books`) — 신규 연동 권장

> 유형 1 에는 **두 경로**가 있습니다. 아래 2.1~2.7 은 기존 파트너가 쓰는 **레거시 워커 잡 경로**(`/api/worker-jobs/*`)이고, 이 절은 **Partner API v1 의 도서(book) 경로**입니다. 신규 연동은 v1 로 시작하세요. 공통 계약(인증·봉투·멱등·리밋)은 1.7 에 있습니다.

**여정 (`creationType: 'PDF_UPLOAD'`)**

```
① GET  /api/v1/ping                             키 인증 확인 (v1 무인증 라우트 0)
② GET  /api/v1/book-specs                       판형 목록·상세
   GET  /api/v1/book-specs/{uid}/calculated-size?pageCount=N
                                                 → 내지/표지/책등 실측 mm — "PDF 를 몇 mm 로 만들지" 확정
③ POST /api/v1/books                            DRAFT 도서 생성
④ POST /api/v1/books/{uid}/pdf-cover            표지 자산 투입   (교체는 PUT)
   POST /api/v1/books/{uid}/pdf-contents         내지 자산 투입   (교체는 PUT)
⑤ POST /api/v1/books/{uid}/finalization          최종화 착수(검증 → 합성)
⑥ 웹훅 book.finalization.completed | .failed     정본 통지
   GET  /api/v1/books/{uid}/finalization          폴링(백스톱)
⑦ GET  /api/v1/books/{uid}/pdf                   최종 PDF 스트림
```

- ②의 `calculated-size` 는 재단·도련·표지 펼침면(앞+책등+뒤) 폭을 mm 로 돌려줍니다. 이 값대로 PDF 를 만들면 워커 사이즈 검증을 판형 허용오차 안에서 통과합니다. 책등 계수가 구성되지 않은 판형은 표지/책등 산출이 비고 `warnings` 로 사유가 옵니다.
- 판형의 `pageMin`/`pageMax`/`pageIncrement` 위반은 `422 ERR_PAGE_COUNT_OUT_OF_RANGE` 입니다. **도서를 만들기 전에** 판형 규칙으로 먼저 거르면 고아 DRAFT 가 남지 않습니다.
- ④의 순서 계약: 신규 투입은 `POST`(이미 있으면 `409 ERR_ASSET_ALREADY_EXISTS`), 교체는 `PUT`(대상이 없으면 `404 ERR_ASSET_NOT_FOUND`). FINALIZED 도서의 자산을 바꾸려 하면 `409 ERR_BOOK_NOT_DRAFT` — 새 도서를 만드세요.

**자산 투입 — 두 입력 형태 (`fileId` 참조 권장)**

각 자산 라우트는 JSON 과 멀티파트를 **함께** 받습니다. `fileId` 가 오면 그쪽이 우선입니다.

| | `fileId` 참조 (JSON) | 직접 업로드 (멀티파트) |
|---|---|---|
| 상한 | **2 GB** (presigned 표면에 먼저 올린 파일) | **100 MB** |
| MIME | 업로드 표면 규칙(1.4) | **PDF 전용** — 이미지는 `415` |
| `Idempotency-Key` | 정상 동작 (본문이 JSON) | ⚠️ **함정 있음** (아래) |

**(a) `fileId` 참조 — 권장**

```bash
curl -X POST "https://api.papascompany.co.kr/api/v1/books/<bookUid>/pdf-contents" \
  -H "Authorization: Bearer <YOUR_PARTNER_API_KEY>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: <요청마다 고유한 값>" \
  -d '{"fileId":"8b1f...uuid"}'
```

**(b) 직접 업로드 — 폼 필드명은 반드시 `file`**

```bash
curl -X POST "https://api.papascompany.co.kr/api/v1/books/<bookUid>/pdf-contents" \
  -H "Authorization: Bearer <YOUR_PARTNER_API_KEY>" \
  -F "file=@inner.pdf;type=application/pdf"
```

> ⚠️ **멀티파트 폼 필드명은 `file` 입니다.** 자동 생성된 OpenAPI 스펙에는 이 라우트의 `multipart/form-data` 스키마가 `{fileId}` 로 표기되어 있으나 **실제 서버 계약과 다릅니다**. 스펙의 멀티파트 스키마가 아니라 이 절을 따르세요.

> 🚨 **멀티파트에 `Idempotency-Key` 를 붙이지 마세요(또는 업로드마다 유일한 키를 쓰세요).** 멱등 판정이 요청 본문 해시로 이루어지는데 멀티파트에서는 그 해시가 파일 내용과 무관한 **상수**가 됩니다 → 같은 키로 다른 파일을 올리면 첫 응답이 재전달되고 **두 번째 파일은 오류 없이 유실**됩니다. 상세와 회피책은 1.7 의 멱등 항목 참조. `fileId` 참조 경로에는 이 함정이 없습니다.

- 사진 자산(`POST books/{uid}/photos`)도 직접 업로드는 PDF 필터를 통과해야 하므로, **이미지는 사실상 `fileId` 참조 전용**입니다.

**완료 대기 · 결과 수령**

- 정본 통지는 웹훅 `book.finalization.completed` / `.failed` 입니다. 폴링(`GET .../finalization`)은 웹훅 유실·지연에 대비한 백스톱으로 쓰세요 — 잔량 헤더가 없어 선제적 리밋 회피가 불가능합니다(1.6).
- 최종 PDF 는 `GET /api/v1/books/{uid}/pdf` (FINALIZED 전용). **이 라우트만 봉투가 없습니다** — 성공은 `application/pdf` 스트림, 오류일 때만 JSON 봉투이므로 `Content-Type` 으로 분기하고 전량 버퍼링 없이 흘려 받으세요.

**실패 코드 대응 (요약)**

| 코드 | status | 대응 |
|---|---|---|
| `ERR_PAGE_COUNT_OUT_OF_RANGE` | 422 | 도서 생성 전에 판형 규칙으로 거를 것 |
| `ERR_ASSETS_INCOMPLETE` | 422 | 표지/내지 보강 후 재착수 |
| `ERR_ASSET_ALREADY_EXISTS` | 409 | 교체는 `PUT` |
| `ERR_ASSET_NOT_FOUND` | 404 | 신규는 `POST` |
| `ERR_BOOK_NOT_DRAFT` | 409 | FINALIZED 도서는 수정 불가 — 새 도서 |
| `ERR_FILE_NOT_READY` | 409 | presigned `complete` 확정 후 참조 |
| `ERR_FINALIZATION_IN_PROGRESS` | 409 | **실패 아님** — `GET .../finalization` 으로 합류 |
| `ERR_UNSUPPORTED_CONTENT_TYPE` | 415 | 멀티파트는 PDF 만 — 이미지는 `fileId` 참조 |
| `ERR_FILE_TOO_LARGE` | 413 | 100 MB 초과 — presigned 표면 + `fileId` 참조 |
| `ERR_RATE_LIMITED` | 429 | `Retry-After` 준수 |

> `TEMPLATE` · `MIX_COVER_TEMPLATE` 생성 유형은 **생성(`201` DRAFT)까지만 되고 최종화가 `422 ERR_ASSETS_INCOMPLETE`(`errors[0].code = TEMPLATE_COVER_NOT_RENDERED`)로 거부됩니다**(1.7) — 생성 성공을 지원 여부 판정에 쓰지 마세요. 임베드 편집 세션의 승격(`EDITOR_SESSION`)은 1.7 참조.

### 2.1 시퀀스

```
파트너 백엔드                        Storige API                R2(스토리지)        Worker
     │                                    │                          │              │
     │ 1) presigned-upload-public ───────►│                          │              │
     │◄──── {fileId, uploadUrl, uploadToken}                         │              │
     │                                    │                          │              │
     │ 2) PUT uploadUrl (파일 바이트) ─────────────────────────────►│              │
     │                                    │                          │              │
     │ 3) POST /files/:id/complete ──────►│ HeadObject 검증 → ready  │              │
     │◄──── FileResponseDto                                          │              │
     │   (cover/content 각각 반복)        │                          │              │
     │                                    │                          │              │
     │ 4) POST /worker-jobs/validate/external ─►│ Bull 큐 등록 ──────────────────►│
     │◄──── WorkerJob (status:'PENDING')                             │   15단계 검증
     │                                    │                          │              │
     │ 5a) 폴링 GET /worker-jobs/external/:id ─►│                     │   상태 보고
     │     또는 5b) 웹훅 수신 ◄── API(WebhookService) ── POST callbackUrl ◄── Worker→API
     │                                    │                          │              │
     │ 6) GET /files/:id/download/external ────►│ assertSiteAccess → 스트림         │
     │◄──── PDF 바이너리                  │                          │              │
```

> **콜백 전송 주체 주의:** 웹훅 POST 를 보내는 것은 **워커가 아니라 API 의 `WebhookService`** 입니다. 워커가 API 에 상태를 보고(`PATCH external/:id/status`)하면, API 가 `callbackUrl` 로 POST 합니다.

### 2.2 단계별 (curl 예시 & 응답 JSON)

**단계 1 — presigned 업로드 발급 (≤ 2 GB 직결, 권장)**

```bash
curl -X POST "https://api.papascompany.co.kr/api/files/presigned-upload-public" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "content",
    "expectedSize": 5242880,
    "originalName": "inner.pdf",
    "contentType": "application/pdf"
  }'
```
응답:
```json
{
  "fileId": "8b1f...uuid",
  "uploadUrl": "https://<r2-presigned-put-url>",
  "storageKey": "uploads/1718...uuid.pdf",
  "uploadToken": "<UPLOAD_TOKEN_64HEX>",
  "expiresIn": 900
}
```
> `driver !== 's3'`(local)이면 `503 {code:'STORAGE_NOT_S3'}`. 게스트 발급은 클라가 보낸 `memberSeqno`를 무시(null 강제)합니다.

**단계 2 — R2에 직접 PUT**

```bash
curl -X PUT "<uploadUrl>" \
  -H "Content-Type: application/pdf" \
  --data-binary @inner.pdf
```
> `Content-Type` 헤더는 서명한 mime과 **반드시 일치**해야 합니다. API를 경유하지 않으므로 호스트 프록시 413을 회피합니다.

**단계 2-멀티파트 (대용량) — init → sign → PUT → complete**

```bash
# init
curl -X POST ".../api/files/multipart/init" -H "Content-Type: application/json" \
  -d '{"type":"content","expectedSize":314572800,"originalName":"big.pdf"}'
# → {fileId, uploadId, storageKey, uploadToken}

# 각 파트 서명
curl -X POST ".../api/files/multipart/sign" -H "Content-Type: application/json" \
  -d '{"fileId":"<id>","partNumber":1,"uploadToken":"<token>"}'
# → {url, partNumber, expiresIn:900}  → 이 url로 PUT, 응답 헤더 ETag 보관

# 완료 (각 파트 etag 결합)
curl -X POST ".../api/files/multipart/complete" -H "Content-Type: application/json" \
  -d '{"fileId":"<id>","parts":[{"partNumber":1,"etag":"\"abc\""}],"uploadToken":"<token>"}'
```
> ⚠️ R2 CORS에 `ExposeHeaders: [ETag]` 가 없으면 멀티파트 complete가 실패합니다 (파트 ETag를 못 읽음). 실패 시 `/multipart/abort` 호출. parts 비면 `400 NO_PARTS`.

**단계 3 — 업로드 완료 확정 (single-part)**

```bash
curl -X POST "https://api.papascompany.co.kr/api/files/8b1f...uuid/complete" \
  -H "Content-Type: application/json" \
  -d '{"uploadToken":"<UPLOAD_TOKEN_64HEX>"}'
```
응답: `200 FileResponseDto` (status=ready). 실패: `400 UPLOAD_NOT_FOUND_ON_R2 | EMPTY_UPLOAD`.
> `finalize()` 가 `HeadObject` 로 객체 존재·크기를 검증. `expectedSize ≠ actual` 이면 `SIZE_MISMATCH`(R2 객체 삭제 + failed). 멱등(이미 ready면 그대로 반환).

**단계 3-대안 — 서버간 직접 업로드 (≤ 100 MB)**

```bash
curl -X POST "https://api.papascompany.co.kr/api/files/upload/external" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>" \
  -F "file=@cover.pdf;type=application/pdf" \
  -F "type=cover" \
  -F "orderSeqno=12345"
```
응답: `201 FileResponseDto`. 호출자 `site.siteId` 스탬프 + 보존정책 적용. `type` 누락 시 `400`, PDF 아니면 `400 UNSUPPORTED_FORMAT`.

**단계 4 — 워커 검증 잡 생성**

요청 필드 (`CreateValidationJobDto`):

| 필드 | 필수/선택 | 제약 |
|---|---|---|
| `fileId` | `fileId`/`fileUrl` 중 택1 (fileId 권장) | UUID |
| `fileUrl` | `fileId` 없을 때 필수(`@ValidateIf(!fileId)` + `@IsNotEmpty`) | URL |
| `fileType` | **필수** (`@IsNotEmpty`) | enum: `cover` \| `content` \| `post_process` (그 외 값 → `400`) |
| `orderOptions` | **필수** (`@IsObject` + `@IsNotEmpty`) | `size`·`pages`·`binding`(canonical 4종 — 2.5)·`bleed` 등. **선택 필드** `pageMultiple`·`pageCountMax`·`pageCountMin`(데이터 주도 페이지수 검증 — 2.4) |
| `callbackUrl` | 선택 | 웹훅 수신 시 |
| `spineWidthMm`, `wingEnabled`, `wingWidthMm` | 선택 | 미전달 시 fallback |

```bash
curl -X POST "https://api.papascompany.co.kr/api/worker-jobs/validate/external" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "8b1f...uuid",
    "fileType": "content",
    "orderOptions": {
      "size": { "width": 148, "height": 210 },
      "pages": 24,
      "binding": "perfect",
      "bleed": 3,
      "spineWidthMm": 4.8
    },
    "callbackUrl": "https://api.example.com/storige/webhook"
  }'
```
응답 (⚠️ **전체 `WorkerJob` 엔티티가 반환되며 아래는 핵심 필드 발췌** — `type`·`options`·`createdAt`·`siteId` 등 다수 필드 포함):
```json
{ "id": "<jobId>", "status": "PENDING" }
```
> `orderOptions` 는 프런트가 직접 실어 보냅니다 (서버가 주문에서 자동 도출하지 않음). `spineWidthMm`/`wingWidthMm` 미전달 시 fallback이 적용되며 날개상품 오검출이 잔존할 수 있습니다. **응답은 버전에 따라 필드가 추가될 수 있으니 `status`·`result` 만 의존하세요.**

형제 외부 잡 라우트 (동일 `X-API-Key + @CurrentSite` 패턴):
`POST /api/worker-jobs/synthesize/external`, `/split-synthesize/external`, `/check-mergeable/external`.

**단계 5a — 폴링**

```bash
curl "https://api.papascompany.co.kr/api/worker-jobs/external/<jobId>" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>"
```
응답 (⚠️ 핵심 필드 발췌 — 전체 `WorkerJob` 엔티티):
```json
{ "id": "<jobId>", "status": "COMPLETED", "result": { "errors": [], "warnings": [], "metadata": {} } }
```
status: `PENDING | PROCESSING | COMPLETED | FIXABLE | FAILED`. 판정 결과(`errors`/`warnings`/`metadata`)는 `result` 객체 안에 담깁니다.

**단계 5b — 웹훅 (callbackUrl 수신)**
- 워커 종료 시 API(`WebhookService`)가 `callbackUrl` 로 `POST`. 헤더 `X-Storige-Event`, `X-Storige-Signature`. 타임아웃 10초, 1회 재시도.
- SSRF 방어: `callbackUrl` 호스트가 `sites` DB(`uploadCallbackUrl`/`domain`) 또는 env `WEBHOOK_ALLOWED_HOSTS` 에 등록돼야 통과. **미등록 시 콜백은 무음으로 전송되지 않습니다**(서버 로그에 `Blocked callback URL not in allowlist` 기록, 파트너는 아무 요청도 받지 못함 — 403 같은 HTTP 응답이 가는 게 아님).
- ⚠️ 서명 검증은 5장 참조 (현재 HMAC 아님 — 보안 주의).

**단계 6 — 결과 PDF 다운로드**

```bash
curl "https://api.papascompany.co.kr/api/files/<fileId>/download/external" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>" \
  -o result.pdf
```
> `assertSiteAccess`: file.siteId가 NULL이거나 caller.siteId와 일치할 때만 허용, 불일치 시 `404`. 스트리밍(2 GB도 heap 상수). **외부 파트너의 결과 PDF 회수는 이 엔드포인트만 사용합니다** (`/worker-jobs/:id/output` 은 내부 JWT 전용 — 5.1 참조).

### 2.3 검증결과 해석

| status | 의미 | 파트너 액션 |
|---|---|---|
| `COMPLETED` | 검증 통과 (`isValid=true`, errors=0) | 이행 진행 |
| `FIXABLE` | 자동수정 가능한 문제 (`autoFixable`) | 사용자 안내 또는 자동수정 흐름 |
| `FAILED` | 차단성 오류 (errors ≥ 1) | 재업로드 유도 (`isValid=false`) |

PDF 검증 규칙 요약은 5장 표 참조 (15단계).

### 2.4 페이지수 검증 (데이터 주도)

> **LIVE** — worker 커밋 `6d0cb76` 배포완료. 페이지수·제본 규격 검증을 binding 문자열 하드코딩이 아니라 **파트너가 전송한 데이터로 구동**합니다.

`orderOptions` 에 아래 **3개 신규 필드(전부 선택)** 를 추가할 수 있습니다.

| 필드 | 타입 | 의미 |
|---|---|---|
| `pageMultiple` | number | 페이지수가 이 값의 배수여야 함 (예: 중철=4, 무선=2) |
| `pageCountMax` | number | 허용 최대 페이지수 (상한) |
| `pageCountMin` | number | 권장 최소 페이지수 (하한, 비차단 경고) |

**동작:**
- **셋 중 하나라도 전송되면** 워커는 binding 문자열 기준 하드코딩 대신 **전송된 값으로 페이지수를 검증**합니다.
- **셋 다 미전송이면 기존 binding 폴백** 으로 동작합니다 (byte-identical, 비파괴 — 기존 통합은 변경 없이 그대로 동작).

**판정 결과 코드:**

| 조건 | 결과 | 코드 / 상세 |
|---|---|---|
| `pageMultiple` 배수 위반 | 차단 (`FIXABLE`) | `ErrorCode.PAGE_COUNT_INVALID` — `autoFixable=true`, `fixMethod='addBlankPages'`, `details={ expected: 올림배수, actual, pageMultiple }` |
| `pageCountMax` 초과 | 차단 (`FAILED`) | `ErrorCode.PAGE_COUNT_EXCEEDED` |
| `pageCountMin` 미만 | 비차단 경고 | `WarningCode.PAGE_COUNT_BELOW_MIN` (신규) — `details={ min, actual }` |

> 배수 위반은 `autoFixable=true` 이므로 잡 status 가 `FIXABLE` 로 떨어집니다. `details.expected`(올림된 목표 페이지수)와 `fixMethod='addBlankPages'` 를 받아 파트너는 자동수정 흐름(2.6 fix-pagecount)으로 이어갈 수 있습니다.

> **글로벌 안전상한은 별개로 유지:** `options.maxPages = 1000p` 는 위 데이터 주도 검증과 **무관하게 항상 적용**되는 절대 상한입니다. 파일크기 상한 역시 별개로 적용됩니다(현재 2 GB — §1.4).

**파트너 액션:** 제본 종류별로 위 값을 채워 전송하세요. 값 매핑은 2.5(canonical binding) 참조.

```bash
curl -X POST "https://api.papascompany.co.kr/api/worker-jobs/validate/external" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "8b1f...uuid",
    "fileType": "content",
    "orderOptions": {
      "size": { "width": 148, "height": 210 },
      "pages": 26,
      "binding": "saddle",
      "bleed": 3,
      "pageMultiple": 4,
      "pageCountMax": 64,
      "pageCountMin": 8
    }
  }'
```

### 2.5 binding 어휘 (canonical 4종)

> 책등(spine) 계산과 합성기는 binding 문자열을 **canonical 코드**로만 인지합니다. 파트너는 자체 제본 라벨을 canonical 4종으로 **매핑하여 전송**합니다.

- 책등(spine) 계산은 `binding_types` DB를 **code로 조회**합니다. **code 4종: `perfect` / `saddle` / `spiral` / `hardcover`** — 없으면 `404`.
- 합성기는 `perfect` / `saddle` / `hardcover` 만 인지하며, 그 외 값은 일반 병합으로 처리합니다.
- 따라서 파트너가 워커로 보내는 `binding` 은 **canonical 4종으로 매핑**해야 합니다. **페이지 규칙(배수/상한/하한)은 binding 문자열에 의존하지 않고 `pageMultiple` 등의 값으로 구분**합니다 (2.4).

**bookmoa 확정 매핑 (예시 — 파트너 라벨 → canonical):**

| bookmoa 라벨 | canonical code | pageMultiple | pageCountMax | pageCountMin |
|---|---|---|---|---|
| 무선 / 무선날개 / PUR | `perfect` | 2 | 1000 | 8 |
| 중철 / 계단식중철 | `saddle` | 4 | 64 | 8 |
| 양장 / 반양장 | `hardcover` | 4 | 1000 | 8 |
| 스프링(PP제외/포함) / 벽걸이 / 양장스프링 | `spiral` | 2 | 500 | 8 |

> bookmoa 라벨(무선날개·계단식중철 등) 구분은 **bookmoa 주문기록에 유지**합니다. Storige 로는 canonical code + 페이지 규칙 값만 전달하면 됩니다. 위 표는 bookmoa 매핑 예시이며, 다른 파트너는 자체 라벨을 동일 4종 code로 매핑하고 해당 페이지 규칙 값을 전송하세요.

### 2.6 페이지수 보정 (fix-pagecount)

> **계약 확정·배포 완료(2026-06-25 LIVE).** 배수 위반(`PAGE_COUNT_INVALID`)으로 `FIXABLE` 판정된 PDF에 빈 페이지를 자동 추가해 배수를 맞추는 비동기 엔드포인트입니다.

**엔드포인트:**

| Method | Path | 인증 |
|---|---|---|
| POST | `/api/worker-jobs/fix-pagecount` | 내부 `RolesGuard` (내부 전용) |
| POST | `/api/worker-jobs/fix-pagecount/external` | `@Public` + `ApiKeyGuard` + `@CurrentSite` (외부 파트너) |

**요청 Body:**
```json
{ "fileId": "<원본 fileId>", "targetMultiple": 4 }
```

**비동기 흐름 (jobId → outputFileId):**
1. 호출 → `WorkerJob`(`jobId`) 반환 (비동기).
2. 호출측이 `GET /api/worker-jobs/external/:id` 폴링 → `status: COMPLETED` + **`outputFileId`**(빈 페이지가 추가된 **새 fileId**).
3. **원본 `fileId` 는 보존**됩니다 (새 파일로 등록, 비파괴).

**보정 동작:**
- 원본 PDF 로드 → `targetPages = ceil(현재페이지수 / targetMultiple) * targetMultiple`.
- **첫 페이지 크기의 백지** 를 `(targetPages - 현재페이지수)` 장 **맨 뒤에 추가**.
- 새 파일 저장 → 새 `fileId` 등록 (원본 `site`/`order` 승계).

> 내부적으로 기존 변환(`pdf-conversion`) 파이프라인(`addPages` + `registerExternalFile`)을 재사용합니다. 외부 노출 계약은 위 (Body/응답)와 같습니다.

**d1 흐름 (검증 FIXABLE → 보정 → 주문):**

```
validate/external → FIXABLE (PAGE_COUNT_INVALID, 배수 위반)
        │
        ▼
파트너 모달: "N페이지로 빈 페이지를 추가할까요? (Y/N)"
        │
  ┌─────┴─────┐
  ▼ Y          ▼ N
fix-pagecount  호출 안 함
호출            (재업로드 유도,
  │             자동수정 없음)
  ▼
폴링 → COMPLETED + outputFileId
  │
  ▼
반환된 outputFileId 로 주문 진행
```

- **Y(예)** → `fix-pagecount/external` 호출 → 반환된 `outputFileId` 로 주문 진행. 모달의 `N`(목표 페이지수)은 검증 결과의 `details.expected` 를 사용.
- **N(아니오)** → 호출하지 않음. 재업로드를 유도하며 **자동 수정은 일어나지 않습니다**.

### 2.7 유형 1 체크리스트

- [ ] `X-API-Key` 를 서버에서만 사용 (브라우저 노출 없음)
- [ ] presigned 직결 사용 시 R2 CORS에 origin + `ExposeHeaders: ETag` 등록 (Storige 오너 작업)
- [ ] `PUT` 시 `Content-Type` = 서명 mime 일치
- [ ] `complete` 의 `expectedSize` = 실제 파일 크기 (SIZE_MISMATCH 방지)
- [ ] `validate/external` 에 `fileType`(enum) + `orderOptions`(size·pages·binding·bleed·spineWidthMm) 명시 전달
- [ ] `binding` 은 canonical 4종(`perfect`/`saddle`/`spiral`/`hardcover`)으로 매핑 전송 (2.5)
- [ ] 데이터 주도 페이지수 검증 사용 시 `orderOptions.pageMultiple`/`pageCountMax`/`pageCountMin` 전송 (미전송 시 binding 폴백 — 2.4)
- [ ] `FIXABLE`(배수 위반, `PAGE_COUNT_INVALID`) 수신 시 모달 → `fix-pagecount/external` → `outputFileId` 로 주문 (2.6)
- [ ] 검증 PDF가 2 GB 초과(현재 상한 — §1.4)면 운영팀에 상한 상향 사전 요청
- [ ] 폴링 또는 웹훅 중 택1, 웹훅이면 `uploadCallbackUrl` 사전 등록 (SSRF allowlist)
- [ ] 결과는 `download/external`(X-API-Key)로만 회수, fileId 고객 브라우저 노출 자제
- [ ] 보존정책: 이행 후 `POST /files/:id/expiry/external {expiresAt}` 또는 `DELETE /files/:id/external`

---

## 3. 유형 2 상세 — Storige 편집기 임베드

> 대표: bookmoa-mobile, ShareSnap

### 3.1 임베드 방법

**진입점 (택1):**
1. **iframe 라우트 — 신규 연동 권장 기본** — `https://editor.papascompany.co.kr/embed?...` 를 호스트가 띄움 (`EmbedView` → 완전배선 `EmbeddedEditor` 마운트). 편집 기능이 **전부 살아 있는 풀피처 빌드**입니다.
2. **IIFE 라이브러리 번들 — 레거시, 신규 연동 비권장** — `window.StorigeEditor.create(config).mount(elId)` (PHP inline 등).
   > IIFE 번들은 `vite.embed.config`(전역객체 `StorigeEditor` / `iife` 포맷 / `dist-embed` / entry `src/embed.tsx`)로 빌드되며, VPS nginx 에 `/embed/ → /app/editor-embed/` 서빙 location 이 존재합니다. 단 **최종 번들 파일명과 공개 도메인**(`editor.papascompany.co.kr` vs API VPS)은 배포 형상에 따라 다르므로, 정확한 `<script src>` URL 은 온보딩 시 운영팀에 확인하세요.

> ⚠️ **IIFE 번들은 편집 기능이 축소된 빌드입니다 — 신규 파트너는 iframe `/embed` 를 쓰세요.**
> IIFE 빌드는 빌드 타임 플래그와 스텁으로 아래 기능이 **제거/무력화**되어 있습니다. 같은 편집기처럼 보이지만 사용자가 쓸 수 있는 기능이 다릅니다.
>
> | 기능 | IIFE 번들 | iframe `/embed` |
> |---|---|---|
> | 사진/이미지 업로드 메뉴 | ❌ 제거 | ✅ |
> | 템플릿 메뉴 | ❌ 제거 | ✅ |
> | 프레임(사진틀) 메뉴 | ❌ 제거 | ✅ |
> | QR / 바코드(smart-code) 메뉴 | ❌ 제거 | ✅ |
> | 모양컷 · 이미지편집(image-processing) | ❌ 제거 | ✅ |
> | 배경제거 | ❌ 스텁(호출 시 실패) | ✅ |
> | OpenCV 기반 처리 | ❌ no-op 스텁 | ✅ |
> | 눈금자(ruler) | ❌ 제거 | ✅ |
>
> 특히 **사진 업로드가 없다**는 점 때문에 IIFE 로 시작한 파트너는 "편집기에 사진을 못 올린다"는 문의를 반드시 겪습니다. IIFE 는 iframe 을 쓸 수 없는 레거시 PHP 인라인 페이지 전용으로만 유지되며, 신규 연동에는 제공하지 않습니다.
> (AI 기능은 두 빌드 모두 프로덕션에서 비활성입니다.)

**선행: shop-session JWT 발급 (파트너 서버)**

```bash
curl -X POST "https://api.papascompany.co.kr/api/auth/shop-session" \
  -H "X-API-Key: <YOUR_SITE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "memberSeqno": 90210,
    "memberId": "user@example.com",
    "memberName": "홍길동",
    "orderSeqno": 12345,
    "permissions": ["edit","upload","validate"]
  }'
```
응답:
```json
{
  "success": true,
  "accessToken": "<JWT_1H>",
  "refreshToken": "<REFRESH_30D>",
  "expiresIn": 3600,
  "member": { "seqno": 90210, "id": "user@example.com", "name": "홍길동" }
}
```
> 반드시 서버에서 호출 (API 키 브라우저 노출 금지). **`memberSeqno` 는 `@IsNumber()` 필수 필드입니다** — 누락 시 일반 class-validator `400`(코드명은 `MEMBER_REQUIRED` 가 **아님**). `memberSeqno=0` 은 유효한 number라 검증을 통과해 `sub='0'` 게스트성 세션을 정상 발급합니다(거부 안 함). **0/음수 같은 비회원 값을 넘기지 마세요** — 실제 차단은 그 토큰으로 편집세션을 만들 때(아래 참고) 비로소 발생합니다.
>
> 참고: `MEMBER_REQUIRED` 코드는 `POST /api/edit-sessions`(세션 생성) 단계에서 `memberSeqno` 가 falsy(0 또는 누락)일 때만 발생합니다(소스: `edit-sessions.controller.ts`). shop-session 응답만 보고 '0도 막히겠지'라고 가정하면, 게스트 폴백 경로(PDF 미생성)로 빠질 수 있으니 주의하세요.
>
> cross-origin iframe에서는 HttpOnly 쿠키가 무용하므로 body의 `refreshToken` 을 사용합니다.

**iframe URL 파라미터 표** (camelCase / snake_case 양쪽 허용 — `getParamCompat`)

| 파라미터 | 신규편집 | 재편집 | 설명 |
|---|---|---|---|
| `token` | 필수 | 필수 | shop-session `accessToken` (localStorage `auth_token` 선주입) |
| `refreshToken` | 권장 | 권장 | 401 자동갱신용 (`auth_refresh_token`) |
| `parentOrigin` | **발신 필수** | **발신 필수** | 없으면 정식 postMessage 전면 비활성 (레거시만 와일드카드 폴백) |
| `templateSetId` | 필수 | 생략가능 | 재편집 시 세션 metadata에서 도출 |
| `sessionId` | — | 필수 | 재편집 키 (bookmoa 표준 경로) |
| `orderSeqno` | 선택 | 도출 | 주문 식별 |
| `mode` | 선택 | 도출 | `cover` \| `content` \| `both` \| `template` |
| `pageCount`, `paperType`, `bindingType`, `quantity` | 선택 | 도출 | 세션 metadata orderOptions 우선, spine 폴백 |
| `productId`, `productName`, `title`, `width`, `height` | 선택 | — | 메타 |
| `coverFileId`, `contentFileId` | 선택 | — | 기존 파일 연결 |
| `callbackUrl`, `apiBaseUrl` | 선택 | — | — |
| `allowSampleFallback` | 선택 | — | `1` 또는 DEV에서만 sample 폴백 |

> 프로덕션에서 템플릿셋 로드 실패 시 `editor.error TEMPLATE_SET_NOT_FOUND` 를 발신합니다.
> **`width`/`height` 는 메타 스냅샷일 뿐 캔버스 규격을 바꾸지 않습니다.** 실제 작업 규격(판형)의 권위는 템플릿셋·주문 옵션이며 임베드 편집기 안에서는 **read-only** 입니다(Canva 식 자유 커스텀 치수 불가). 완료 시점의 실제 규격은 `editor.complete` 의 `size` 로 되돌아오니, 파트너는 그 값으로 정합만 검증하세요 — 3.2 참조.
> **재편집(`sessionId`)에 `templateSetId` 를 함께 보내면** 편집기가 세션 조회 1콜을 생략합니다. `sessionId` 만 보냈는데 세션 조회가 실패하면 편집기는 편집 화면 대신 "템플릿셋을 확인할 수 없습니다" 오류로 멈추므로, 파트너가 `templateSetId` 를 보관하고 있다면 함께 넘기는 편이 안전합니다.

### 3.2 postMessage 프로토콜

**표준 엔벨로프 (편집기 → 부모):**
```json
{ "source": "storige-editor", "version": "1", "event": "editor.xxx", "payload": { }, "timestamp": "2026-06-20T00:00:00.000Z" }
```
> `version` 은 **문자열 `"1"`**(`EMBED_MESSAGE_VERSION='1'`), `timestamp` 는 **ISO 8601 문자열**(`new Date().toISOString()`)입니다. 편집기는 인바운드 메시지에서 `version` 을 강제 검증하지 않으므로(검증 항목은 `e.origin`·`e.source`·봉투 `source` 3가지 — 3.2 참조) 호스트도 version 으로 게이팅하지 마세요.
> `parentOrigin` 명시 시에만 발신하며, `targetOrigin` 에 `parentOrigin` 을 그대로 사용 — **와일드카드 금지**.

| 방향 | 이벤트명 | 페이로드 | 설명 |
|---|---|---|---|
| 편집기→부모 | `editor.ready` | `{sessionId, templateSetId, version, (폴백시) fallback, effectiveTemplateSetId}` | 초기화 완료 |
| 편집기→부모 | `editor.save` | `{sessionId, savedAt, thumbnail}` | 자동/수동 저장 |
| 편집기→부모 | `editor.complete` | `{sessionId, orderSeqno, editCode, pages:{initial,final}, pageCount?, pricing?, size?:{width,height,unit:'mm'}, files:{coverFileId,contentFileId,thumbnailUrl}, savedAt}` | 편집완료 + 합성 |
| 편집기→부모 | `editor.cancel` | `{sessionId}` | 취소 |
| 편집기→부모 | `editor.error` | `{code, message, templateSetId}` | 오류 |
| 편집기→부모 | `editor.needAuth` | `{guestToken, reason:'complete_save', ts}` | 게스트 폴백만 |
| 편집기→부모 | `editor.state` | `{requestId, ready, dirty, sessionId}` | getState 응답 |
| 편집기→부모 | `editor.saved` | `{requestId, ok, error}` | saveNow 응답 |
| 편집기→부모 | `editor.pricingChange` | `{sessionId, pageCount, pricing?, coverType?}` | 가격 영향 변경(페이지 증감 등) 실시간 통지 (2026-07-06 additive) |
| **부모→편집기** | `getState` | `{requestId}` | **요청-응답** — `editor.state` 로 응답(`requestId` echo) |
| **부모→편집기** | `saveNow` | `{requestId}` | **요청-응답** — 저장 후 `editor.saved` 로 응답(`requestId` echo) |
| **부모→편집기** | `setBackGuard` | `{enabled}` | **fire-and-forget** — 뒤로가기 가드 on/off, **응답 이벤트 없음** |

> **발신 8종(`ready`/`save`/`complete`/`cancel`/`error`/`needAuth`/`state`/`saved`)이 동결 계약**이고, **`editor.pricingChange` 1종은 ADDITIVE**입니다 — 조건부 발신(아래 발신 조건 참조)이라 동결 표면에 포함되지 않습니다. 수신 명령은 위 3종이 전부이며, 확장은 additive(추가만)로만 이뤄집니다.
> **응답 유형을 구분하세요.** `setBackGuard` 는 응답이 없으므로 세 명령을 일괄 Promise 로 감싸면 이 명령만 영원히 pending 상태가 됩니다.

> **`editor.complete` 페이로드 구조 주의:** `coverFileId`·`contentFileId`·`thumbnailUrl` 은 최상위가 아니라 **`files` 객체 안에 중첩**되고, `pages` 는 **`{initial, final}` 객체**입니다. 이 shape 은 **동결 계약**이라 평탄화되지 않습니다 — `payload.coverFileId` 를 읽는 파서는 항상 `undefined` 를 얻고, `pages` 를 숫자로 가정하면 그대로 깨집니다.
> **페이지/규격 정합 (2026-07-04 additive):** `pages.final`·`pageCount` = 편집 완료 시점 실측 페이지 수(포토북 내지 펼침면은 ×2 물리페이지). `size` = 완료 시점 캔버스 규격(mm, 감사/정합 검증용 — 규격의 권위는 상품 옵션이며 embed 편집기에서는 규격 변경 UI 가 잠겨 있음). **파트너 장바구니는 `pageCount` 가 주문 옵션 페이지수와 다르면 가격을 재계산하고 고객에게 고지해야 합니다** — 결제 시점 서버 재계산에서도 동일 정합 검증 권장.
> `pageCount`/`size`/`pricing` 은 legacy `storige:completed` 형식에도 동일하게 동봉됩니다. 단 **게스트(needsAuth=true) 완료 이벤트에는 미포함**(실제 완료가 아닌 로그인 유도 신호) — optional 처리 필수.
>
> 🚨 **게스트 완료 이벤트 순서 — `editor.complete` 가 `editor.needAuth` 보다 먼저 옵니다.**
> 게스트(비회원) 세션에서 편집완료를 누르면 편집기는 아래 **순서로** 두 이벤트를 보냅니다.
>
> ```
> ① editor.complete  { sessionId, needsAuth: true, guestToken, pages:{…}, files:{}, savedAt }   ← 먼저
> ② editor.needAuth  { guestToken, reason: 'complete_save', ts }                                 ← 나중(하위호환)
> ```
>
> **`editor.complete` 를 받으면 `needsAuth` 를 가장 먼저 확인하세요 — `true` 면 주문 생성·승격·합성을 일절 하지 말고 로그인 유도로 분기합니다.** `editor.needAuth` 를 기다렸다 분기하면 **이미 늦습니다**: ①에서 곧바로 후속 처리를 태우면 아직 회원 세션이 아닌 채로 진행되고, 뒤이어 도착한 ②가 화면을 덮어 원인 파악도 어려워집니다. 게스트 완료 payload 는 위 미포함 필드에 더해 **`files` 도 빈 객체**이므로, `files.contentFileId` 유무로 정상 완료를 판별하려는 시도도 실패합니다.
> 또한 게스트 세션은 **책 승격**(Partner API v1 `POST /api/v1/books` `creationType=EDITOR_SESSION` — 2.0 의 유형 1 표면이며 유형 2 의 기본 경로는 아닙니다)의 대상이 아닙니다. 시도하면 `404` 가 나는데, 이유는 "회원 소유가 아니라서"가 **아니라** 게스트 세션 생성 라우트가 테넌트를 주입하지 않아 **`siteId` 가 비어 있고**, 승격 게이트가 `siteId` 없는 세션을 명시적으로 거부하기 때문입니다(교차테넌트 IDOR 방지). `guest/migrate` 는 `memberSeqno`·`guestToken` 만 바꾸고 `siteId` 는 그대로 두므로 **회원 전환 후에도 그 세션은 승격되지 않습니다** — 재편집과 `compose-mixed` 합성은 정상 동작하니, 유형 2 파트너는 3.3·3.4 경로를 그대로 쓰면 됩니다.
> 방어적으로는 **`guestToken` 이 있는데 `needsAuth` 가 없는 형태도 게스트로 취급**하세요(fail-closed). 로그인 이후 처리는 3.3 의 "게스트 → 회원 전환" 을 따르세요.
> **`editCode` 형식:** `EDIT-XXXXXXXX` = 접두 `EDIT-` + 세션ID 앞 8자 대문자(`EDIT-${id.substring(0,8).toUpperCase()}`). 순수 8자리 숫자가 아닙니다.
> **`editor.pricingChange` (D-3, 2026-07-06 additive):** 편집 중 페이지 추가/삭제로 총 페이지 수가 바뀌면 ~300ms 디바운스로 발신됩니다. 가격 계산 주체는 **호스트**(storige 는 가격을 계산하지 않음) — `pageCount`(물리 페이지, 포토북 내지 펼침면 ×2)와 `pricing` 메타로 장바구니 표시가를 갱신하세요. **발신 조건(보수 기본):** 템플릿셋에 `pricing` 이 설정된 경우 + 회원 세션만(게스트 미발신) + 에디터 초기화/세션 복원 완료 후. `coverType` 은 템플릿셋에 커버 종류 코드(string, 확장 가능 — `hardcover_wrap`/`softcover_variable_spine`/`ready_made` 시드)가 설정된 경우에만 동봉. 미지 이벤트를 무시하는 기존 수신부는 영향 없음(additive).

`editor.error` code 종류: `AUTH_EXPIRED`, `NETWORK_ERROR`, `SAVE_FAILED`, `INVALID_DATA`, `SESSION_NOT_FOUND`, `TEMPLATE_SET_NOT_FOUND`.

**부모→편집기 엔벨로프:**
```json
{ "source": "storige-host", "version": "1", "command": "getState", "requestId": "abc", "payload": { } }
```
> 편집기는 **① `e.origin === parentOrigin` ② `e.source === window.parent`(직접 부모 프레임에서 온 것) ③ 봉투 `source === 'storige-host'`** 세 조건을 모두 만족하는 메시지만 처리하며, `requestId` 를 echo합니다.
> ⚠️ **②는 2026-07-29 additive 보강**입니다 — 같은 오리진의 **다른 프레임·팝업**이 명령을 주입하는 것을 막습니다. 표준 iframe 임베드(부모가 `iframe.contentWindow.postMessage(...)`)는 그대로 통과하므로 기존 파트너 영향은 없습니다. 단 **조부모가 `frames[0].frames[0]` 로 손자에게 직접 발신**하는 형태는 차단되니, 중첩 임베드에서는 **직접 부모가 중계**하세요(원래도 응답이 직접 부모로만 가서 요청-응답이 성립하지 않던 경로입니다).
> **미지원 `command` 는 조용히 무시(no-op)됩니다** — 오류 이벤트도 예외도 발신하지 않습니다. 따라서 호스트는 **응답 이벤트 타임아웃으로 미지원을 판정**하되 실패로 취급하지 마세요(구버전 편집기 ↔ 신버전 호스트 조합에서 정상 동작). 반대로 `requestId` 를 매번 새로 부여하지 않으면 응답 상관이 어긋나므로, 요청-응답 명령에는 반드시 고유 `requestId` 를 실으세요.

**레거시 dual-emit (EmbedView 라우트 한정, 하위호환):** `storige:ready`, `storige:saved`, `storige:completed`, `storige:cancel`, `storige:error`.
> ⚠️ **레거시 emit 은 `parentOrigin` 미지정 시 `targetOrigin='*'`(와일드카드)로 송신**됩니다(`EmbedView.tsx`: `parentOrigin || '*'`). 레거시 페이로드는 필드 화이트리스트라 `token`·`guestToken` 같은 자격증명은 실리지 않지만, **`sessionId`(= `editSessionId`)와 `coverFileId`/`contentFileId` 가 그대로 노출**됩니다. `editSessionId` 는 사실상 권한 토큰입니다 — `POST /api/worker-jobs/compose-mixed` 가 무인증(`@Public`)이라 이 값을 가진 쪽은 누구나 그 세션의 합성 잡을 트리거할 수 있습니다(3.4·4.2 참조). 임베드 페이지에 다른 스크립트가 하나라도 있으면 그 스크립트가 값을 읽습니다. 신규 파트너(특히 유형 3 Shopify)는 **반드시 `parentOrigin` 을 지정**하고 정식 `storige-editor` 엔벨로프를 사용하세요. 정식 엔벨로프는 `parentOrigin` 이 없으면 아예 발신하지 않으며 와일드카드를 절대 쓰지 않습니다.

### 3.3 세션 저장 / 재편집

- 완료 시 `sessionId` 를 파트너가 저장 → 재편집 키로 `/embed?sessionId=<id>&token=&refreshToken=&parentOrigin=` 재진입.
- 재편집은 `sessionId` 만으로 `templateSetId`·`mode`·`orderSeqno`·spine 옵션을 세션 metadata에서 도출하여 멀티페이지 canvasData를 복원합니다.
- 30초 주기 자동저장 (`PATCH /api/edit-sessions/:id`, 게스트면 `updateGuest`).

**게스트 → 회원 전환 후 같은 세션 재오픈 (무로그인 퍼널)**

게스트로 편집하다 완료를 누른 사용자를 로그인시킨 뒤에는, **새 세션을 만들지 말고 같은 `sessionId` 를 회원 토큰으로 다시 여세요.** 새로 만들면 게스트가 편집한 작업물이 그대로 버려집니다.

1. `editor.complete`(`needsAuth:true`) 에서 받은 `guestToken` 을 보관하고 로그인을 유도합니다(3.2 의 이벤트 순서 주의).
2. 로그인으로 회원이 확정되면 파트너 서버가 그 회원의 shop-session JWT 를 발급받습니다(3.1).
3. **세션 소유권 이전** — 회원 JWT 로 `POST /api/edit-sessions/guest/migrate` 를 호출합니다. 이 호출이 게스트 세션을 회원 소유로 흡수하고 게스트 토큰을 무효화합니다.
   ```bash
   curl -X POST "https://api.papascompany.co.kr/api/edit-sessions/guest/migrate" \
     -H "Authorization: Bearer <MEMBER_ACCESS_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{ "guestToken": "<GUEST_TOKEN>" }'
   # → { "migratedCount": 1, "sessionIds": ["<same-session-id>"] }
   ```
   > 응답의 `sessionIds` 에는 그 `guestToken` 으로 만들어진 세션이 **전부** 들어옵니다(한 명이 여러 개를 편집했을 수 있음). 에러: 토큰 없음·만료·위조 `401`(전역 JWT 가드 — 이 라우트는 `@Public` 이 아닙니다), 토큰은 유효하나 회원 식별자가 없는 경우 `403 AUTH_REQUIRED`, `guestToken` 누락/8자 미만 `400 GUEST_TOKEN_REQUIRED`. **shop-session 으로 발급한 회원 accessToken 을 쓰세요** — 운영자(admin) 로그인 토큰은 회원 식별자가 없어 `403` 입니다.
4. **같은 `sessionId` 로 재오픈** — `/embed?sessionId=<동일 id>&token=<회원 accessToken>&refreshToken=&parentOrigin=`. 작업물은 그대로 복원되고, 이제 편집완료를 누르면 게스트 분기 없이 **정상 완료**(`needsAuth` 없음 + `files` 채워짐 + PDF 생성)로 이어집니다.

> ⚠️ **3번을 건너뛰고 4번만 하면 무한 루프**가 됩니다 — 세션에 게스트 토큰이 남아 있는 동안에는 회원 토큰으로 열어도 편집기가 다시 게스트 분기를 타서 `editor.complete{needsAuth:true}` 만 반복 발신합니다.
> ⚠️ **게스트 세션은 발급 후 24시간**만 유효합니다(만료 후 게스트 저장은 `403 GUEST_SESSION_EXPIRED`). 무로그인 퍼널은 그 안에 전환을 마치도록 설계하세요.
> ⚠️ `guestToken` 은 **세션 자격증명**입니다 — 로그·DOM·URL 에 남기지 말고 전환 처리에만 쓰세요.

### 3.4 완료 → 합성 → 다운로드

1. 사용자 편집완료(`handleFinish`) → 전체 페이지 canvasData 저장 → `ServicePlugin` PDF 생성 → `filesApi.upload` → `editSessionsApi.complete` → `editor.complete` 발신.
2. 파트너 백엔드: 주문확정 시 `POST /api/worker-jobs/compose-mixed` 로 세션 기반 합성 트리거 (호스트가 명시적 호출, 자동발행 아님).
   ```bash
   # ⚠️ 무인증(@Public) — X-API-Key 없음, 테넌트 스코프 없음 (타 /external 라우트와 대비)
   curl -X POST "https://api.papascompany.co.kr/api/worker-jobs/compose-mixed" \
     -H "Content-Type: application/json" \
     -d '{ "editSessionId": "<id>", "orderId": "12345" }'
   ```
   > ⚠️ 필드명은 **`orderId`(문자열)** 입니다. `orderSeqno` 처럼 DTO 에 없는 키를 보내면 전역 `forbidNonWhitelisted` 검증에 걸려 **`400`** 이 납니다(선택 필드라 생략해도 됩니다).
   > ⚠️ **보안 주의:** `compose-mixed` 는 `@Public`(ApiKeyGuard·테넌트 스코핑 없음, ThrottlerGuard 만)입니다. `editSessionId`(UUID) 만 알면 누구나 합성 잡을 트리거할 수 있습니다. `editSessionId` 를 비밀로 취급하고 가능한 한 **파트너 백엔드에서만** 호출하며, 브라우저 노출을 최소화하세요.
   > 스프레드(펼침면) 책은 서버가 `outputMode='separate'` 강제 → cover.pdf + content.pdf 2파일. `single` 보내도 무시. **단일파일 가정 금지.**
3. 완료 수신: 웹훅(`uploadCallbackUrl`) 또는 폴링 `GET /api/worker-jobs/external/:id`.
4. `GET /api/files/:fileId/download/external` (X-API-Key)로 결과 PDF 회수.

### 3.5 부모페이지 통합 코드 스니펫

```html
<iframe
  id="storige"
  src="https://editor.papascompany.co.kr/embed?templateSetId=TS_8x8&token=<JWT_1H>&refreshToken=<REFRESH_30D>&orderSeqno=12345&parentOrigin=https://app.example.com&mode=both"
  style="width:100%;height:100vh;border:0"
  allow="clipboard-write"
></iframe>

<script>
  const EDITOR_ORIGIN = "https://editor.papascompany.co.kr";
  const iframe = document.getElementById("storige");
  // 게스트 완료는 editor.complete + editor.needAuth 두 이벤트로 도착한다 → 1회만 처리
  const handledGuest = new Set();

  window.addEventListener("message", (e) => {
    if (e.origin !== EDITOR_ORIGIN) return;            // origin 검증 필수
    const msg = e.data;
    if (!msg || msg.source !== "storige-editor") return;

    switch (msg.event) {
      case "editor.ready":
        console.log("ready", msg.payload.sessionId);
        break;
      case "editor.complete":
        // 🚨 needsAuth 를 가장 먼저 확인한다. 게스트 완료는 editor.needAuth 보다 먼저 도착한다.
        //    여기서 주문/합성을 태우면 안 된다(게스트 세션은 siteId 가 비어 v1 승격도 404).
        //    guestToken 만 있고 needsAuth 가 없는 형태도 게스트로 본다(fail-closed).
        if (msg.payload.needsAuth || msg.payload.guestToken) {
          handledGuest.add(msg.payload.guestToken);         // 뒤따라올 needAuth 중복 차단
          promptLoginThenMigrate(msg.payload.guestToken);   // 3.3 게스트 → 회원 전환
          break;
        }
        // sessionId 저장 → 주문확정 시 백엔드가 compose-mixed 호출
        // files.coverFileId / files.contentFileId (중첩 구조 주의)
        saveSessionToBackend(msg.payload.sessionId, msg.payload);
        break;
      case "editor.needAuth":
        // 하위호환 보조 신호 — 게스트 완료 시 편집기가 complete 직후 "항상" 함께 보낸다.
        // (payload 는 {guestToken, reason, ts} 뿐 — sessionId 는 없다.)
        // 가드 없이 여기서도 호출하면 로그인 유도/마이그레이션이 매번 두 번 실행된다.
        if (handledGuest.has(msg.payload.guestToken)) break;
        promptLoginThenMigrate(msg.payload.guestToken);
        break;
      case "editor.error":
        console.error(msg.payload.code, msg.payload.message);
        break;
    }
  });

  // 호스트 → 편집기 역명령 예시 (저장 강제)
  function saveNow() {
    iframe.contentWindow.postMessage(
      { source: "storige-host", version: "1", command: "saveNow", requestId: crypto.randomUUID() },
      EDITOR_ORIGIN   // 와일드카드 금지
    );
  }
</script>
```

### 3.6 유형 2 체크리스트

- [ ] `shop-session` 은 서버에서만 호출 (API 키 노출 없음)
- [ ] `memberSeqno` 에 0/음수 같은 비회원 값을 넣지 않음 (게스트 폴백 방지)
- [ ] iframe URL에 `parentOrigin` 반드시 포함 (없으면 정식 postMessage 비활성, 레거시는 와일드카드 송신)
- [ ] `/embed` 라우트 사용 (루트 `/` 는 레거시 — 완료 메시지 미발신)
- [ ] 리스너에서 `e.origin` + `source==='storige-editor'` 검증
- [ ] 401 시 `/api/auth/shop-refresh-body {refreshToken}` 로 토큰 갱신 (cross-origin이라 body 변형 사용)
- [ ] `editor.complete` 의 `sessionId` 저장 (재편집 키), `files`/`pages` 중첩 구조로 파싱
- [ ] `editor.complete` 수신 시 **`needsAuth` 를 먼저 확인** — `true`(또는 `guestToken` 존재)면 주문/승격 금지, 로그인 유도로 분기 (`editor.needAuth` 를 기다리지 않는다)
- [ ] 합성은 `compose-mixed` 명시적 트리거(무인증 — editSessionId 비밀유지), 스프레드=2파일 처리
- [ ] 게스트 → 회원 전환 흐름 구현: `guest/migrate` 로 세션 소유권 이전 후 **같은 `sessionId`** 를 회원 토큰으로 재오픈 (3.3)
- [ ] 신규 연동은 iframe `/embed` 사용 (IIFE 번들은 업로드·템플릿·프레임 등 기능이 빠진 레거시 — 3.1)
- [ ] (프로덕션) `allowedOrigins` 수정(`PUT /api/sites/:id`) + 임베드 도메인 `frameAncestors` 등록(`PUT /api/sites/:id`) — 편집기 재배포 불필요, `frameAncestors` 반영은 캐시 2단으로 최대 약 2분(1.5)

---

## 4. 유형 3 상세 (제안 / 미구현) — 임베드 편집 + 외부가 합성 결과만 수신

> 대표(제안): Shopify. **현재 활성 연동 계약 없음 — 빌딩블록 조합으로 구성하는 방법과 갭을 명시합니다.**

### 4.1 구성 개념

유형 3은 **유형 2의 임베드를 그대로 재사용**하되, 합성 결과파일을 외부(예: Shopify 주문 시스템)로 전달하는 흐름입니다. 현재 빌딩블록으로 다음과 같이 구성할 수 있습니다.

```
[유형 2 임베드 그대로]
  shop-session(JWT) → /embed iframe (parentOrigin 필수) → 편집 → editor.complete(sessionId)

[합성 + 외부 수신 — 현재 빌딩블록 조합]
  파트너 백엔드: POST /worker-jobs/compose-mixed { editSessionId, orderId? }
       │           ⚠️ 무인증(@Public)·테넌트 스코프 없음 (타 /external 라우트의 X-API-Key 와 대비)
       │
       ├─(A) 웹훅: uploadCallbackUrl 로 종료 콜백 수신 (X-Storige-Event/Signature)
       │        또는
       └─(B) 폴링: GET /worker-jobs/external/:id (X-API-Key)
       │
       ▼
  GET /files/:fileId/download/external (X-API-Key) → 외부 시스템(Shopify)으로 적재
```

### 4.2 현재 갭 / 추가구현 필요 항목 (명시)

유형 3을 프로덕션화하려면 아래 항목의 보강/결정이 필요합니다.

| 항목 | 현재 상태 | 필요 작업 |
|---|---|---|
| **웹훅 서명** | 사이트별 웹훅 설정(v2)을 발급하면 **HMAC 전용 발신**(`X-Storige-Signature-HMAC` + `X-Storige-Delivery`)이고, 설정이 없으면 레거시 발신(base64 `X-Storige-Signature` — **위조 가능**, 전역 시크릿 설정 시 HMAC 헤더 동반)으로 폴백합니다. | 신규 연동은 `PUT /api/v1/webhooks/config` 로 v2 설정을 발급받아 HMAC 검증 (5.2 참조). 레거시 폴백 구간에서는 웹훅을 트리거로만 취급하고 결과는 `download/external` 로 재확인. |
| **compose-mixed 무인증** | `@Public`·테넌트 스코프 없음 → editSessionId 보유자면 누구나 트리거 가능 | 프로덕션화 시 `ApiKeyGuard`+테넌트 스코핑 추가 검토 (오너 결정) |
| **Shopify 전용 Site 등록** | 미존재 (모든 Site는 운영자 생성) | 운영자가 `POST /api/sites` 로 Shopify 테넌트 생성 + 키 발급 |
| **frame-ancestors (Shopify 도메인 iframe)** | 운영자 등록 → 동적 CSP 합성 배선 완료(1.5) | 운영자가 `PUT /api/sites/:id` 로 Shopify 임베드 도메인을 `frameAncestors` 에 등록 (편집기 재배포 불필요) |
| **외부 결과 전달 표준 흐름** | 유형 1/2 빌딩블록은 존재하나 Shopify 주문 연결 어댑터는 미구현 | 파트너측 어댑터 + `uploadCallbackUrl` 등록 |
| **회원번호 체계** | 파트너 자체 정수 회원번호 필요 | Shopify customer ID → 정수 시퀀스 1:1 매핑 결정 (해시변환 금지 — 충돌) |

> 위 항목이 충족되면 유형 3은 유형 2 임베드 + 유형 1 다운로드/웹훅 빌딩블록의 합으로 동작합니다. 신규 발명 엔드포인트는 필요하지 않습니다.

---

## 5. 레퍼런스

### 5.1 전체 엔드포인트 표 (레거시 외부 표면 · Partner API v1)

**레거시 외부 표면** — 기존 파트너 호환용. 신규 연동은 아래 v1 표를 쓰세요.

| Method | Path | 인증 | 용도 |
|---|---|---|---|
| POST | `/api/auth/shop-session` | X-API-Key (@Public+ApiKeyGuard) | 편집기 임베드용 JWT 발급 (유형 2/3 진입점) |
| POST | `/api/auth/shop-refresh-body` | @Public (body refreshToken) | iframe 무음 토큰 갱신 (body 변형) |
| POST | `/api/files/presigned-upload` | JWT (Bearer) | R2 single-part presigned (인증 사용자) |
| POST | `/api/files/presigned-upload-public` | @Public | R2 single-part presigned (게스트/외부 임베드) |
| POST | `/api/files/multipart/init` | @Public | 멀티파트 시작 |
| POST | `/api/files/multipart/sign` | @Public + uploadToken | 파트 PUT URL 서명 |
| POST | `/api/files/multipart/complete` | @Public + uploadToken | 멀티파트 완료 |
| POST | `/api/files/multipart/abort` | @Public + uploadToken | 멀티파트 취소 |
| POST | `/api/files/:id/complete` | @Public + uploadToken | single-part 완료 확정 |
| POST | `/api/files/upload` | JWT (Bearer) | PDF 직접 업로드 (내부 사용자) |
| POST | `/api/files/upload/external` | X-API-Key | 서버간 PDF 업로드 (≤100MB) |
| GET | `/api/files/:id/download` | JWT + 소유자/staff | 내부 다운로드 |
| GET | `/api/files/:id/download/external` | X-API-Key + site 대조 | 외부 결과 PDF 다운로드 |
| GET | `/api/files/:id/raw` | @Public (이미지 전용) | 이미지 인라인 공개 표시 (PDF 거부) |
| GET | `/api/files/:id/thumbnail` | X-API-Key + site 대조 | PDF 썸네일 PNG (`?page=`, `?width=`) — 2026-07-03 인증 전환(구 @Public) |
| DELETE | `/api/files/:id/external` | X-API-Key + site 대조 | 외부 테넌트 하드삭제 |
| POST | `/api/files/:id/expiry/external` | X-API-Key + site 대조 | 만료 예약 / 영구복원 |
| GET | `/api/files/:id` | JWT + 소유자/staff | 파일 메타 조회 |
| GET | `/api/files` | JWT (Bearer) | 파일 목록 (본인/admin) |
| DELETE | `/api/files/:id` | JWT (Bearer) | 소프트 삭제 (48h 복구창) |
| POST | `/api/files/:id/restore` | JWT (Bearer) | 소프트삭제 복구 |
| POST | `/api/worker-jobs/validate/external` | X-API-Key | 인쇄 PDF 검증 잡 |
| POST | `/api/worker-jobs/synthesize/external` | X-API-Key | 표지+내지 합성 잡 |
| POST | `/api/worker-jobs/split-synthesize/external` | X-API-Key | 분할 합성 잡 |
| POST | `/api/worker-jobs/check-mergeable/external` | X-API-Key | 합성 가능 dry-run |
| POST | `/api/worker-jobs/fix-pagecount/external` | X-API-Key (`@Public`+ApiKeyGuard+`@CurrentSite`) | **(LIVE)** 페이지수 보정 — 빈 페이지 추가로 배수 정합. Body `{fileId, targetMultiple}` → jobId, 폴링 시 `outputFileId`(새 fileId, 원본 보존). 2.6 |
| POST | `/api/worker-jobs/fix-pagecount` | 내부 RolesGuard | **(LIVE)** 페이지수 보정 — 내부 전용 변형 |
| POST | `/api/worker-jobs/compose-mixed` | **@Public (무인증·테넌트 스코프 없음)** | 세션 기반 합성 트리거. ⚠️ editSessionId(UUID)만으로 트리거 가능 → 세션ID 비밀유지·브라우저 노출 최소화 |
| GET | `/api/worker-jobs/external/:id` | X-API-Key | 잡 상태 폴링 |
| GET | `/api/worker-jobs/:id/output` | **JWT (전역 가드, @Public 아님)** | admin Before/After 미리보기용 **내부** 라우트. 파트너는 사용 불가 → 결과 PDF 는 `download/external` 사용 |
| PATCH | `/api/worker-jobs/external/:id/status` | **X-API-Key (@Public+ApiKeyGuard)** | 워커 콜백용. worker 키(내부)=전체 잡 바이패스, editor/테넌트 키=자기 site 잡만 갱신(P2c S-3) |
| PATCH | `/api/worker-jobs/:id/status` | JWT (전역 가드) | 내부 워커 상태 업데이트 변형 |
| GET | `/api/edit-sessions/external` | @Public + X-API-Key | 주문별 편집세션 조회 (`?orderSeqno=`) |
| GET | `/api/edit-sessions/:id/imposition-preview` | @Public + X-API-Key | 임포지션 프리뷰 |
| POST | `/api/edit-sessions` | (회원/게스트) | 편집세션 생성 — `memberSeqno` falsy 시 `400 MEMBER_REQUIRED` |
| POST | `/api/edit-sessions/guest/migrate` | **JWT (Bearer, shop-session 회원 토큰)** | 게스트 세션 → 회원 흡수. Body `{guestToken}` → `{migratedCount, sessionIds[]}`. 에러 `401`(토큰 없음/만료) · `403 AUTH_REQUIRED`(회원 식별자 없는 토큰) · `400 GUEST_TOKEN_REQUIRED`(누락/8자 미만). `siteId` 는 바뀌지 않음 → v1 승격 대상은 되지 않음. 3.3 |
| GET/POST/PUT/DELETE | `/api/sites`, `/api/sites/:id` | JWT + ADMIN/MANAGER | 테넌트 생애주기 (운영자 전용, 파트너 비대상). **수정은 `PUT /api/sites/:id`** (`:id` 에 PATCH 라우트 없음) |
| PATCH | `/api/sites/:id/regenerate` | JWT + ADMIN/MANAGER | 키 회전 (`{target:'editor'\|'worker'\|'both'}`) |

> **참고:** `/external` 이 붙지 않은 `synthesize`/`convert`/`split-synthesize` 등은 JWT + ADMIN/MANAGER 전용이며 파트너 대상이 아닙니다. 파트너는 반드시 `/external` 변형을 사용하세요. 또한 워커 출력 되연결(`registerExternalFile`)은 HTTP 엔드포인트가 아니라 내부 서비스 메서드입니다 — 외부에서 직접 등록하는 엔드포인트는 없습니다.

**Partner API v1 (`/api/v1/*`) — 16 경로 / 22 오퍼레이션**

전 라우트가 파트너 키 필수(`Authorization: Bearer` 또는 `X-API-Key` — 1.2(C)). 리밋 버킷은 general 300/min · heavy 100/min (1.6). `Idempotency-Key` 는 **POST 에 헤더가 있을 때만** 적용됩니다 (1.7).

| Method | Path | 버킷 | 용도 |
|---|---|---|---|
| GET | `/api/v1/ping` | general | 연결·키 확인 (온보딩 스모크) |
| GET | `/api/v1/book-specs` | general | 판형 목록 (페이지네이션 + `coverType`/`bindingType`/`isActive` 필터) |
| GET | `/api/v1/book-specs/{uid}` | general | 판형 상세 |
| GET | `/api/v1/book-specs/{uid}/calculated-size` | general | 페이지 수 기반 내지/표지/책등 실측 mm 산출 |
| POST | `/api/v1/books` | general | 도서 생성(DRAFT) — `creationType` 필수 (1.7) |
| GET | `/api/v1/books` | general | 도서 목록 (자기 site + env, `status`/`creationType` 필터) |
| GET | `/api/v1/books/{uid}` | general | 도서 상세 |
| POST | `/api/v1/books/{uid}/pdf-cover` | **heavy** | 표지 PDF 신규 투입 — 기존재 시 `409 ERR_ASSET_ALREADY_EXISTS` |
| PUT | `/api/v1/books/{uid}/pdf-cover` | **heavy** | 표지 PDF 교체 — 미존재 시 `404 ERR_ASSET_NOT_FOUND` |
| POST | `/api/v1/books/{uid}/pdf-contents` | **heavy** | 내지 PDF 신규 투입 |
| PUT | `/api/v1/books/{uid}/pdf-contents` | **heavy** | 내지 PDF 교체 |
| POST | `/api/v1/books/{uid}/photos` | **heavy** | 사진 자산 추가(다건, DRAFT 전용) — 이미지는 `fileId` 참조 전용(2.0) |
| POST | `/api/v1/books/{uid}/finalization` | **heavy** | 최종화 착수 — 진행 중이면 `409 ERR_FINALIZATION_IN_PROGRESS`(실패 아님) |
| GET | `/api/v1/books/{uid}/finalization` | general | 최종화 상태 폴링 (최신 attempt) |
| GET | `/api/v1/books/{uid}/pdf` | **heavy** | 최종 PDF 다운로드 — **봉투 없는 raw 스트림**, FINALIZED 전용 (1.7) |
| PUT | `/api/v1/webhooks/config` | general | 웹훅 설정 upsert — secret 은 생성/회전 응답에서 **1회만** 노출 |
| GET | `/api/v1/webhooks/config` | general | 웹훅 설정 조회 (secret 은 prefix 마스킹) |
| DELETE | `/api/v1/webhooks/config` | general | 웹훅 설정 삭제 (발송 중지, 이력은 보존) |
| POST | `/api/v1/webhooks/test` | general | 테스트 이벤트 발송 (구독 목록 무관) |
| GET | `/api/v1/webhooks/deliveries` | general | 발송 이력 목록 (`event`/`status`/`since` 필터) |
| GET | `/api/v1/webhooks/deliveries/{uid}` | general | 발송 이력 상세 (상태코드·실패사유코드·attempts·다음 재시도 시각) |
| POST | `/api/v1/webhooks/deliveries/{uid}/retry` | general | 수동 재발송 (소진됐거나 10분 이상 정체된 배달) |

> 파라미터·요청 스키마·선언된 응답 코드는 서버 스펙에서 생성된 API 레퍼런스를 보세요. **응답 `data` 스키마는 서버에 선언돼 있지 않아 문서로 제공되지 않습니다** — 필드 구조는 실제 응답으로 확인하고, 분기는 `status`·`errorCode` 등 계약이 명시된 값으로만 하세요.

### 5.2 Webhook 서명 검증 (현 상태 정확히)

> **발신 경로가 2종입니다.** 사이트에 웹훅 설정(v2)이 있으면 **(B) HMAC 전용 발신**, 없으면 **(A) 레거시 발신**으로 폴백합니다. 수신 코드는 자기 사이트가 어느 쪽인지 알고 작성해야 합니다 — 두 경로는 헤더 구성부터 다릅니다.

**(A) 레거시 발신 — 웹훅 설정이 없는 사이트**

- 헤더: `X-Storige-Event`, `X-Storige-Signature`
- 알고리즘: **현재 `base64({identifier}:{event}:{timestamp})` — HMAC이 아닙니다.** `identifier` 는 페이로드에 `jobId` 가 있으면 `jobId`, 없으면(세션 페이로드) `sessionId` 를 사용합니다.
- ⚠️ **보안 주의:** base64는 인코딩일 뿐 서명이 아니므로 **위조 가능**합니다. `WEBHOOK_SECRET` 환경변수는 코드상 사용되지 않는 no-op입니다.
- **권장 대응:** 웹훅 수신을 트리거로만 취급하고, 실제 결과는 반드시 `GET /api/files/:id/download/external`(X-API-Key) 또는 `GET /api/worker-jobs/external/:id` 로 재확인하세요. HMAC 보강은 향후 작업으로 제안됩니다.
- 전송 주체: **API 의 `WebhookService`** (워커가 아님). 워커→API 상태 보고 후 API 가 `callbackUrl` 로 POST.
- 전송 특성: 타임아웃 10초, 1회 재시도. `callbackUrl` 호스트는 `sites` DB 또는 `WEBHOOK_ALLOWED_HOSTS` 에 등록돼야 전송됩니다 (SSRF 방어). 미등록 시 **무음으로 전송 안 됨**(서버 로그 `Blocked callback URL not in allowlist` 기록, 파트너는 아무 요청도 받지 못함 — HTTP 403 이 가는 게 아님).

**웹훅 POST 바디 예시** (`WebhookPayload` — 발췌, 검증 잡 콜백):
```json
{
  "event": "validation.completed",
  "jobId": "<jobId>",
  "timestamp": "2026-06-20T00:00:00.000Z",
  "status": "COMPLETED",
  "result": { "errors": [], "warnings": [], "metadata": {} }
}
```
> 세션 기반 콜백(`SessionWebhookPayload`)은 `jobId` 대신 `sessionId` 를 포함하며, 그 경우 서명 `identifier` 도 `sessionId` 가 됩니다.

> 전역 `WEBHOOK_SECRET` 이 설정된 배포에서는 위 base64 헤더와 **함께** HMAC 헤더(`X-Storige-Signature-HMAC`)가 동반 발신됩니다. 다만 이 경로는 `X-Storige-Delivery` 를 **보내지 않으므로** 배달 단위 중복 판별이 불가능합니다 — 아래 (B) 의 중복 배달 항목 참조.

**(B) v2 발신 — 사이트별 웹훅 설정(HMAC 전용)**

**설정 발급**

- `PUT /api/v1/webhooks/config` — body `{url, events?, rotateSecret?}`.
- 응답의 서명 secret(`whsec_` + 48 hex)은 **발급/회전 응답에서 1회만 노출**됩니다. 재조회할 수 없으니 받는 즉시 보관하세요(`GET config` 는 prefix 마스킹만 반환). 회전은 `rotateSecret: true`.
- `url` 은 허용 호스트(사이트 등록 도메인) 검증을 통과해야 하며, 위반 시 `422 ERR_WEBHOOK_URL_FORBIDDEN`.
- `events` 미지정/빈 배열이면 **전체 구독**입니다.

**구독 가능 이벤트 — v1 기준 9종** (+ `webhook.test` 는 `POST /api/v1/webhooks/test` 전용이며 구독 목록과 무관하게 발송)

```
validation.completed | validation.fixable | validation.failed
synthesis.completed  | synthesis.failed
session.validated    | session.failed
book.finalization.completed | book.finalization.failed
```

> 위 9종 중 앞의 **7종은 레거시 동결 계약**이고, `book.finalization.*` 2종은 Partner API v1 의 도서 최종화와 함께 **추가된 이벤트**입니다. 카탈로그는 **additive 로만** 자랍니다 — **모르는 이벤트에서 던지지 마세요.** 던지면 5xx 로 응답되어 서버가 재시도를 반복하고 결국 소진 상태로 남습니다. 조용히 무시하는 것이 계약입니다.

**발신 헤더**

| 헤더 | 값 |
|---|---|
| `X-Storige-Event` | 이벤트명 |
| `X-Storige-Delivery` | `whd_...` — **배달 1건에 1:1** 인 식별자(중복 판별 키) |
| `X-Storige-Signature-HMAC` | `t=<unix초>,v1=<hex>` |

- 레거시 base64 `X-Storige-Signature` 는 이 경로에서 **전송되지 않습니다**.
- 서명 대상 문자열은 `{t}.{identifier}:{event}:{timestamp}` 이며, `identifier` 는 `jobId` → `sessionId` → 배달 uid 순으로 결정됩니다.

**🚨 서명은 본문을 덮지 않습니다**

- 서명 대상은 위 **4개 값뿐**입니다. `status`·`outputFileId`·`errorCode`·`pageCount`·`result` 같은 나머지 본문 필드는 서명 밖이라 변조를 탐지할 수 없습니다(raw body 해시가 아닙니다).
- → **HTTPS 를 강제**하세요. 본문 무결성은 현재 전적으로 전송계층에 의존합니다.
- → **결제·발주·상태확정 같은 부수효과의 근거는 본문이 아니라 재조회**에서 취하세요(`GET /api/v1/books/{uid}/finalization` 등). 본문은 "무언가 바뀌었다"는 트리거로만 쓰는 것이 안전합니다.
- 대신 다른 웹훅 규격이 요구하는 *"JSON 파서보다 먼저 raw body 를 보존하라"* 는 곡예가 **필요 없습니다** — 일반 JSON 파서로 충분합니다.

**신선도(replay) 판정**

- 헤더의 `t`(서명 시각, unix 초)로 판정하고 창은 ±300초 안팎을 권장합니다. 창이 좁을수록 캡처된 서명의 재생 가능 시간이 줄어듭니다.
- ⚠️ **본문의 `timestamp` 로 신선도를 판정하지 마세요.** `t` 는 재시도마다 갱신되지만 본문 `timestamp` 는 이벤트 시각으로 고정이라, 30분 뒤 재시도가 정상인데도 거부됩니다.

**중복 배달 — 신뢰성 통제이지 인증 통제가 아닙니다**

- 재시도는 인라인 최초 1회 + 큐 재시도 3회(**1분 / 5분 / 30분**) = 최대 4회이며, 여기에 수동 재발송이 더해질 수 있습니다. 타임아웃은 10초입니다.
- 판별 키는 `X-Storige-Delivery` 입니다. ⚠️ **`jobId` 로 중복 판정하지 마세요** — 한 잡이 `validation.completed` 와 `synthesis.completed` 를 각각 발신하므로 정상 이벤트를 삼킵니다.
- ⚠️ `X-Storige-Delivery` 는 **서명 밖 헤더**입니다. 서명 `identifier` 가 `jobId`/`sessionId` 로 정해지는 이벤트(`validation.*` · `synthesis.*` · `session.*`)에서는 유효 서명 1건을 캡처한 쪽이 **재서명 없이 uid 헤더만 바꿔** 신선도 창 안에서 재생할 수 있습니다. 반대로 `book.finalization.*` 은 `identifier` 가 곧 배달 uid 라 이 재생이 성립하지 않습니다.
- → **부수효과가 있는 핸들러는 자체 도메인 멱등(주문 uid 등 본인 키 기준)을 병행**하고, 상태 전이는 조건부 갱신(CAS)으로 하세요. 이벤트마다 켜고 끄지 말고 전부에 거는 편이 안전합니다. 레거시 (A) 경로에는 배달 uid 자체가 없어 **도메인 멱등이 유일한 방어선**입니다.

**응답 규약**

| 상태 | 의미 |
|---|---|
| 2xx | 처리 완료 — 재시도 체인이 끊깁니다. **중복 배달을 단락했을 때도 2xx** 로 응답하세요 |
| 4xx | 재시도하지 않습니다 (서명 불일치·형식 오류 등) |
| 5xx | 서버가 재시도합니다 — 수신측 설정 오류를 5xx 로 두면 고친 뒤 재시도가 통과해 유실이 없습니다 |

- 발신 결과는 `GET /api/v1/webhooks/deliveries` 로 확인할 수 있습니다(상태코드·실패 사유 코드·시도 횟수·다음 재시도 시각). 소진된 배달은 `POST /api/v1/webhooks/deliveries/{uid}/retry` 로 수동 재발송합니다.

### 5.3 PDF 검증 규칙 요약 (워커 15단계)

| # | 검증 항목 | 기준 |
|---|---|---|
| 1 | 파일 크기 | **현재 검증 상한 2 GB** (§1.4) |
| 2 | 파일 무결성 | PDF 구조 유효성 |
| 3 | 페이지 수 / 제본 규격 | **데이터 주도**: `orderOptions.pageMultiple`/`pageCountMax`/`pageCountMin` 전송 시 그 값으로 검증, 미전송 시 binding 폴백. 배수 위반 → `PAGE_COUNT_INVALID`(FIXABLE), 상한 초과 → `PAGE_COUNT_EXCEEDED`(FAILED), 하한 미만 → `PAGE_COUNT_BELOW_MIN`(경고). binding 은 canonical 4종(`perfect`/`saddle`/`spiral`/`hardcover`). 글로벌 안전상한 `maxPages=1000p` 별도 유지. (2.4·2.5) |
| 4 | 판형 | ±1 mm |
| 5 | 재단 여백(bleed) | 3 mm |
| 6 | 책등(spine) | ±2 mm |
| 7~8 | CMYK (2단계) | GhostScript inkcov |
| 9 | 별색(spot color) | 노티 |
| 10 | 투명도 / 오버프린트 | 검출 |
| 11 | 해상도 | 150 DPI |
| — | 판정 | 에러 ≥ 1 → `isValid=false` 차단 |

> 결과는 잡 `result.errors` / `result.warnings` / `result.metadata` 에 담깁니다. `autoFixable` 이면 `FIXABLE`, 아니면 `FAILED`. (파일 크기 기준은 §1.4·FAQ 참조 — 코드 기본 100 MB, 현재 프로덕션 실값 2 GB.)

### 5.4 유형별 온보딩 체크리스트

**공통 (전 유형)**
- [ ] Storige 운영자가 `POST /api/sites` 로 Site 생성 + 키 발급 (보안 채널 전달)
- [ ] 파트너 전용 키 사용 (키 공유 금지)
- [ ] 회원번호: 파트너 자체 정수 시퀀스 (외부 UUID → 정수 1:1, 해시변환 금지)

**유형 1 추가**
- [ ] presigned 직결 시 R2 CORS origin + `ExposeHeaders: ETag` 등록 (오너 작업)
- [ ] `validate/external` `fileType`(enum) + `orderOptions` 전체 전달
- [ ] 검증 PDF가 2 GB 초과(현재 상한 — §1.4) 시 운영팀에 상한 상향 사전 요청
- [ ] 보존정책(`expiry/external` / `DELETE external`) 설계

**유형 2 추가**
- [ ] `allowedOrigins` 수정 = `PUT /api/sites/:id` (CORS)
- [ ] 임베드 도메인 `frameAncestors` 등록 = `PUT /api/sites/:id` (CSP frame-ancestors — 편집기 재배포 불필요, 반영 최대 약 2분)
- [ ] `uploadCallbackUrl` 수정 = `PUT /api/sites/:id` (웹훅 SSRF allowlist)
- [ ] `/embed` 라우트 + `parentOrigin` 사용

**유형 3 추가 (미구현)**
- [ ] 4.2 갭 표의 항목(웹훅 HMAC, compose-mixed 무인증 보강, Shopify Site, frame-ancestors, 외부 어댑터) 충족 확인

### 5.5 FAQ · 트러블슈팅

**Q. 업로드 시 `413` 또는 "Unexpected token R" 에러가 납니다.**
호스트 프록시(예: Vercel 4.5 MB) 또는 서버 경유 `multer`(100 MB) 한계입니다. 대용량은 **presigned 직결**(`presigned-upload-public` → R2 PUT → `:id/complete`)을 사용하세요. API를 경유하지 않으므로 프록시 한계를 우회합니다.

**Q. 멀티파트 `complete` 가 실패합니다.**
R2 CORS에 `ExposeHeaders: [ETag]` 가 없으면 브라우저가 파트 ETag를 못 읽어 실패합니다. R2 CORS에 파트너 origin + `ExposeHeaders: ETag` 등록이 필요합니다 (Storige 오너 작업). 실패 시 `/multipart/abort` 호출.

**Q. 브라우저 요청이 CORS로 차단됩니다.**
CORS는 (a) Origin 없음→무조건 허용 (b) env 정적 (c) `*.vercel.app`/`*.papascompany.co.kr` (d) DB `allowedOrigins` 합집합(60s 캐시) 순으로 결정됩니다. 프로덕션 도메인 허용은 `PUT /api/sites/:id` (DB만 변경, 재배포 불필요). **iframe 임베드 CSP frame-ancestors도 같은 `PUT /api/sites/:id` 의 `frameAncestors` 등록으로 반영**됩니다(정적 baseline + 등록분 합성, 반영 최대 약 2분 — 서버·편집기 캐시 각 60초가 직렬로 겹침, 1.5 참조). CORS 와 frame-ancestors 는 별개 필드이므로 임베드 파트너는 **둘 다** 등록해야 합니다.

**Q. iframe에서 postMessage가 안 옵니다.**
`parentOrigin` 파라미터가 없으면 정식 postMessage가 전면 비활성됩니다(레거시 storige:* 만 와일드카드로 폴백). 또한 루트 `/` 는 레거시 라우트로 완료 메시지를 발신하지 않습니다 — 반드시 `/embed` 를 사용하세요.

**Q. editor/worker 키를 분리해야 하나요?**
현재 두 코드는 생성 시 동일 값으로 발급됩니다(worker 코드 미지정 시 editor 코드 복사). 단일 키를 전권 키로 취급하고 비밀유지하세요. `regenerate` 로 독립 회전되면 값이 달라질 수 있습니다.

**Q. 1~2 GB 파일을 올릴 수 있나요?**
네. presigned 업로드는 2 GB까지 허용하고, **워커 PDF 검증 상한도 현재 2 GB** 입니다 — 두 상한이 같으므로 업로드에 성공한 파일이 크기 때문에 검증에서 막히지 않습니다(§1.4 표). 단 **v1 직접 업로드(멀티파트)는 100 MB** 이므로, 그보다 큰 파일은 presigned 로 올린 뒤 `fileId` 로 참조하세요(1.7). 검증 상한 초과 시 즉시 `FAILED`('N MB를 초과합니다')이며, 2 GB 를 넘는 파일이 필요하면 온보딩 시 협의하세요.

**Q. 페이지수가 제본 배수에 안 맞아 검증이 `FIXABLE` 로 떨어집니다.**
`orderOptions.pageMultiple` 을 전송하면 워커가 그 배수로 페이지수를 검증합니다. 배수 위반 시 `ErrorCode.PAGE_COUNT_INVALID`(autoFixable, `fixMethod='addBlankPages'`, `details.expected`=올림된 목표 페이지수)로 `FIXABLE` 판정됩니다. 보정하려면 `POST /api/worker-jobs/fix-pagecount/external {fileId, targetMultiple}`(비동기 — jobId 반환) 후 `GET /api/worker-jobs/external/:id` 폴링으로 `outputFileId`(빈 페이지 추가된 새 fileId, 원본 보존)를 받아 주문에 사용하세요. `pageMultiple`/`pageCountMax`/`pageCountMin` 을 셋 다 미전송하면 기존 binding 폴백으로 동작합니다(비파괴). 상세는 2.4·2.6 참조. (fix-pagecount 는 2026-06-25 배포 완료·LIVE)

**Q. `binding` 에 어떤 값을 보내야 하나요?**
책등 계산과 합성기는 canonical code 4종(`perfect`/`saddle`/`spiral`/`hardcover`)만 인지합니다. 자체 제본 라벨(무선날개·계단식중철 등)을 이 4종으로 매핑해 전송하세요. 페이지 규칙(배수/상한/하한)은 binding 문자열이 아니라 `pageMultiple` 등 값으로 구분하므로, 라벨 세분화는 파트너 주문기록에 유지하면 됩니다. bookmoa 매핑 예시는 2.5 참조.

**Q. shop-session에서 회원번호 관련 에러가 납니다.**
`memberSeqno` 는 `@IsNumber()` 필수 필드라 **누락 시 일반 검증 `400`**(코드명 `MEMBER_REQUIRED` 아님)이 납니다. `memberSeqno=0` 은 유효한 number라 검증을 통과해 `sub='0'` 세션을 발급합니다(거부 안 함). `MEMBER_REQUIRED` 는 shop-session 이 아니라 `POST /api/edit-sessions`(세션 생성) 단계에서 `memberSeqno` 가 falsy(0/누락)일 때 발생합니다. 파트너 자체 정수 회원번호(0/음수 아님)를 채우세요.

**Q. 게스트가 편집완료했는데 PDF가 없습니다.**
회원 식별 없는 토큰(예: `memberSeqno=0`)은 게스트 세션으로 폴백되어, 편집완료 시 PDF 없이 `editor.complete{needsAuth:true}` → `editor.needAuth` 순으로 발신합니다(순서 주의 — 3.2). 호스트가 로그인 유도 후 게스트→회원 세션 마이그레이션을 처리해야 합니다 (절차는 3.3).

---

*본 가이드는 추출된 사실(코드 대조)에 근거하며, 불확실 항목은 `TBD` 또는 `미구현(제안)` 으로 표기했습니다. 추가 엔드포인트/파라미터가 필요하면 Storige 팀에 문의하세요.*
