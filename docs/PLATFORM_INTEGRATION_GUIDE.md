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
4. (프로덕션 전) `allowedOrigins` 수정(`PUT /api/sites/:id`) + (임베드 시) editor `vercel.json` frame-ancestors 반영 + `uploadCallbackUrl` 수정(`PUT /api/sites/:id`)

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
대용량 검증 필요?:        <현재 프로덕션 1GB까지 검증 가능. 1GB 초과(최대 2GB) 필요 시 운영팀 사전 협의 — 1.4 참조>
환경:                     <dev | staging | prod>
```

### 1.2 인증 (X-API-Key)

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
- 키 회전은 운영자가 `PATCH /api/sites/:id/regenerate {target:'editor'|'worker'|'both'}` 로 수행합니다 (파트너 직접 불가). `regenerate` 는 editor/worker 코드를 각각 **독립 난수**로 재생성하므로, 회전 후 두 값이 달라질 수 있습니다.
- `WORKER_API_KEY`(내부 전용 환경키)는 절대 외부 파트너에게 공유되지 않습니다.

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

> ⚠️ **워커 PDF 검증 상한 — 코드 기본값 100 MB, 현재 프로덕션 배포값 1 GB.** 검증 상한은 env `WORKER_MAX_FILE_SIZE`(바이트)로 결정됩니다 (코드 기본값 소스: `apps/worker/src/config/validation.config.ts` — `Number(process.env.WORKER_MAX_FILE_SIZE) || 100 * 1024 * 1024`). **현재 프로덕션은 `docker-compose.yml` 에서 `WORKER_MAX_FILE_SIZE=1073741824`(1 GB)로 배포되어, 오늘 기준 1 GB까지 검증을 통과합니다.** presigned 업로드 자체는 2 GB까지 가능하나, 1 GB 초과(최대 2 GB) 검증은 워커 스트리밍(트랙 B) 작업 완료 후 운영팀 상향이 필요합니다. 설정 상한 초과 파일을 `validate/external` 에 넣으면 즉시 `FAILED`('N MB를 초과합니다')로 거부됩니다. 대용량(>1 GB) 검증이 필요하면 온보딩 양식에 명시하세요.

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
- 프로덕션 자체도메인 iframe 허용은 `apps/editor/vercel.json` 정적 정의에서만 적용됩니다. `site.frameAncestors` DB 필드는 현재 호출처가 없는 死코드입니다. `*.vercel.app`·localhost는 이미 포함되어 있습니다.
- 따라서 새 파트너 도메인을 iframe 으로 임베드하려면 `apps/editor/vercel.json` 에 도메인 추가 후 master push(재배포)가 필요합니다. DB 변경만으로는 적용되지 않습니다.

**시크릿 취급**
- API 키·refreshToken은 로그/리퍼러에 노출되지 않도록 주의 (임베드 URL에 토큰이 쿼리로 실립니다 — 1.2(B), 3장 참조).
- 과거 PUBLIC 레포에서 키가 노출되어 2026-06-15 회전되었습니다. 회전은 `PATCH /api/sites/:id/regenerate`.

### 1.6 에러 · 레이트리밋

| 항목 | 값 |
|---|---|
| `shop-session` / refresh 라우트 | `@Throttle 20/min` (단일 파트너 서버 IP 기준 설정) |
| `presigned-upload-public` / `multipart/init` | `20 / 60s` |
| `multipart/sign` | `600 / 60s` (파트당 1콜) |
| `multipart/complete` / `abort` / `:id/complete` | `30 / 60s` |
| `/files/:id/raw` | `120 / 60s` |
| `/files/:id/thumbnail` | (캐시 1h) |

> 다중 IP 또는 고볼륨 파트너는 `shop-session` 20/min 한계에 걸릴 수 있습니다 (코드상 상향 필요로 명시됨). 온보딩 시 협의하세요.

**공통 에러 코드:** `401`(invalid/suspended key), `400`(UNSUPPORTED_FORMAT / UNSUPPORTED_CONTENT_TYPE / class-validator 검증 오류 등), `404`(존재 은닉 포함), `503 STORAGE_NOT_S3`(presigned인데 driver≠s3).

---

## 2. 유형 1 상세 — 자체 편집기 + 검증/합성 오프로드

> 대표: 100p Books (자체 편집기로 PDF 생성 → Storige에 검증/합성/보존만 오프로드)

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
| `orderOptions` | **필수** (`@IsObject` + `@IsNotEmpty`) | `size`·`pages`·`binding`(`perfect`\|`saddle`\|`spring`)·`bleed` 등 |
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

### 2.4 유형 1 체크리스트

- [ ] `X-API-Key` 를 서버에서만 사용 (브라우저 노출 없음)
- [ ] presigned 직결 사용 시 R2 CORS에 origin + `ExposeHeaders: ETag` 등록 (Storige 오너 작업)
- [ ] `PUT` 시 `Content-Type` = 서명 mime 일치
- [ ] `complete` 의 `expectedSize` = 실제 파일 크기 (SIZE_MISMATCH 방지)
- [ ] `validate/external` 에 `fileType`(enum) + `orderOptions`(size·pages·binding·bleed·spineWidthMm) 명시 전달
- [ ] 검증 PDF가 1 GB 초과(현재 프로덕션 상한)면 운영팀에 `WORKER_MAX_FILE_SIZE` 상향 사전 요청
- [ ] 폴링 또는 웹훅 중 택1, 웹훅이면 `uploadCallbackUrl` 사전 등록 (SSRF allowlist)
- [ ] 결과는 `download/external`(X-API-Key)로만 회수, fileId 고객 브라우저 노출 자제
- [ ] 보존정책: 이행 후 `POST /files/:id/expiry/external {expiresAt}` 또는 `DELETE /files/:id/external`

---

## 3. 유형 2 상세 — Storige 편집기 임베드

> 대표: bookmoa-mobile, ShareSnap

### 3.1 임베드 방법

**진입점 (택1):**
1. **iframe 라우트** — `https://editor.papascompany.co.kr/embed?...` 를 호스트가 띄움 (`EmbedView` → 완전배선 `EmbeddedEditor` 마운트).
2. **IIFE 라이브러리 번들** — `window.StorigeEditor.create(config).mount(elId)` (PHP inline 등).
   > IIFE 번들은 `vite.embed.config`(전역객체 `StorigeEditor` / `iife` 포맷 / `dist-embed` / entry `src/embed.tsx`)로 빌드되며, VPS nginx 에 `/embed/ → /app/editor-embed/` 서빙 location 이 존재합니다. 단 **최종 번들 파일명과 공개 도메인**(`editor.papascompany.co.kr` vs API VPS)은 배포 형상에 따라 다르므로, 정확한 `<script src>` URL 은 온보딩 시 운영팀에 확인하세요.

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

### 3.2 postMessage 프로토콜

**표준 엔벨로프 (편집기 → 부모):**
```json
{ "source": "storige-editor", "version": "1", "event": "editor.xxx", "payload": { }, "timestamp": "2026-06-20T00:00:00.000Z" }
```
> `version` 은 **문자열 `"1"`**(`EMBED_MESSAGE_VERSION='1'`), `timestamp` 는 **ISO 8601 문자열**(`new Date().toISOString()`)입니다. 편집기는 인바운드 메시지에서 `version` 을 강제 검증하지 않으므로(현재 `origin`+`source` 만 검증) 호스트도 version 으로 게이팅하지 마세요.
> `parentOrigin` 명시 시에만 발신하며, `targetOrigin` 에 `parentOrigin` 을 그대로 사용 — **와일드카드 금지**.

| 방향 | 이벤트명 | 페이로드 | 설명 |
|---|---|---|---|
| 편집기→부모 | `editor.ready` | `{sessionId, templateSetId, version, (폴백시) fallback, effectiveTemplateSetId}` | 초기화 완료 |
| 편집기→부모 | `editor.save` | `{sessionId, savedAt, thumbnail}` | 자동/수동 저장 |
| 편집기→부모 | `editor.complete` | `{sessionId, orderSeqno, editCode, pages:{initial,final}, files:{coverFileId,contentFileId,thumbnailUrl}, savedAt}` | 편집완료 + 합성 |
| 편집기→부모 | `editor.cancel` | `{sessionId}` | 취소 |
| 편집기→부모 | `editor.error` | `{code, message, templateSetId}` | 오류 |
| 편집기→부모 | `editor.needAuth` | `{guestToken, reason:'complete_save', ts}` | 게스트 폴백만 |
| 편집기→부모 | `editor.state` | `{requestId, ready, dirty, sessionId}` | getState 응답 |
| 편집기→부모 | `editor.saved` | `{requestId, ok, error}` | saveNow 응답 |
| **부모→편집기** | `getState` | `{requestId}` | → `editor.state` 응답 |
| **부모→편집기** | `saveNow` | `{requestId}` | 저장 후 `editor.saved` |
| **부모→편집기** | `setBackGuard` | `{enabled}` | 뒤로가기 가드 on/off (응답 없음) |

> **`editor.complete` 페이로드 구조 주의:** `coverFileId`·`contentFileId`·`thumbnailUrl` 은 최상위가 아니라 **`files` 객체 안에 중첩**되고, `pages` 는 **`{initial, final}` 객체**입니다.
> **`editCode` 형식:** `EDIT-XXXXXXXX` = 접두 `EDIT-` + 세션ID 앞 8자 대문자(`EDIT-${id.substring(0,8).toUpperCase()}`). 순수 8자리 숫자가 아닙니다.

`editor.error` code 종류: `AUTH_EXPIRED`, `NETWORK_ERROR`, `SAVE_FAILED`, `INVALID_DATA`, `SESSION_NOT_FOUND`, `TEMPLATE_SET_NOT_FOUND`.

**부모→편집기 엔벨로프:**
```json
{ "source": "storige-host", "version": "1", "command": "getState", "requestId": "abc", "payload": { } }
```
> 편집기는 `e.origin === parentOrigin` 이고 `source === 'storige-host'` 인 메시지만 처리하며, `requestId` 를 echo합니다.

**레거시 dual-emit (EmbedView 라우트 한정, 하위호환):** `storige:ready`, `storige:saved`, `storige:completed`, `storige:cancel`, `storige:error`.
> ⚠️ **레거시 emit 은 `parentOrigin` 미지정 시 `targetOrigin='*'`(와일드카드)로 송신**되어 민감 페이로드가 노출될 수 있습니다(`EmbedView.tsx`: `parentOrigin || '*'`). 신규 파트너(특히 유형 3 Shopify)는 **반드시 `parentOrigin` 을 지정**하고 정식 `storige-editor` 엔벨로프를 사용하세요.

### 3.3 세션 저장 / 재편집

- 완료 시 `sessionId` 를 파트너가 저장 → 재편집 키로 `/embed?sessionId=<id>&token=&refreshToken=&parentOrigin=` 재진입.
- 재편집은 `sessionId` 만으로 `templateSetId`·`mode`·`orderSeqno`·spine 옵션을 세션 metadata에서 도출하여 멀티페이지 canvasData를 복원합니다.
- 30초 주기 자동저장 (`PATCH /api/edit-sessions/:id`, 게스트면 `updateGuest`).

### 3.4 완료 → 합성 → 다운로드

1. 사용자 편집완료(`handleFinish`) → 전체 페이지 canvasData 저장 → `ServicePlugin` PDF 생성 → `filesApi.upload` → `editSessionsApi.complete` → `editor.complete` 발신.
2. 파트너 백엔드: 주문확정 시 `POST /api/worker-jobs/compose-mixed` 로 세션 기반 합성 트리거 (호스트가 명시적 호출, 자동발행 아님).
   ```bash
   # ⚠️ 무인증(@Public) — X-API-Key 없음, 테넌트 스코프 없음 (타 /external 라우트와 대비)
   curl -X POST "https://api.papascompany.co.kr/api/worker-jobs/compose-mixed" \
     -H "Content-Type: application/json" \
     -d '{ "editSessionId": "<id>", "orderSeqno": 12345 }'
   ```
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

  window.addEventListener("message", (e) => {
    if (e.origin !== EDITOR_ORIGIN) return;            // origin 검증 필수
    const msg = e.data;
    if (!msg || msg.source !== "storige-editor") return;

    switch (msg.event) {
      case "editor.ready":
        console.log("ready", msg.payload.sessionId);
        break;
      case "editor.complete":
        // sessionId 저장 → 주문확정 시 백엔드가 compose-mixed 호출
        // files.coverFileId / files.contentFileId (중첩 구조 주의)
        saveSessionToBackend(msg.payload.sessionId, msg.payload);
        break;
      case "editor.needAuth":
        // 게스트 → 회원 마이그레이션 처리
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
- [ ] 합성은 `compose-mixed` 명시적 트리거(무인증 — editSessionId 비밀유지), 스프레드=2파일 처리
- [ ] 게스트 세션(`editor.needAuth`) 마이그레이션 흐름 구현
- [ ] (프로덕션) `allowedOrigins` 수정(`PUT /api/sites/:id`) + editor `vercel.json` frame-ancestors 반영 + master push

---

## 4. 유형 3 상세 (제안 / 미구현) — 임베드 편집 + 외부가 합성 결과만 수신

> 대표(제안): Shopify. **현재 활성 연동 계약 없음 — 빌딩블록 조합으로 구성하는 방법과 갭을 명시합니다.**

### 4.1 구성 개념

유형 3은 **유형 2의 임베드를 그대로 재사용**하되, 합성 결과파일을 외부(예: Shopify 주문 시스템)로 전달하는 흐름입니다. 현재 빌딩블록으로 다음과 같이 구성할 수 있습니다.

```
[유형 2 임베드 그대로]
  shop-session(JWT) → /embed iframe (parentOrigin 필수) → 편집 → editor.complete(sessionId)

[합성 + 외부 수신 — 현재 빌딩블록 조합]
  파트너 백엔드: POST /worker-jobs/compose-mixed { editSessionId, orderSeqno }
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
| **웹훅 서명** | `X-Storige-Signature` 가 `base64({jobId 또는 sessionId}:{event}:{timestamp})` — **HMAC 아님 → 위조 가능**. `WEBHOOK_SECRET` 은 코드상 no-op. | HMAC 서명 보강 (5장 참조). 그 전까지는 웹훅 수신 후 반드시 `download/external` 로 재확인. |
| **compose-mixed 무인증** | `@Public`·테넌트 스코프 없음 → editSessionId 보유자면 누구나 트리거 가능 | 프로덕션화 시 `ApiKeyGuard`+테넌트 스코핑 추가 검토 (오너 결정) |
| **Shopify 전용 Site 등록** | 미존재 (모든 Site는 운영자 생성) | 운영자가 `POST /api/sites` 로 Shopify 테넌트 생성 + 키 발급 |
| **frame-ancestors (Shopify 도메인 iframe)** | DB 필드 死코드, `vercel.json` 정적 정의만 유효 | `apps/editor/vercel.json` 에 Shopify 임베드 도메인 추가 + master push |
| **외부 결과 전달 표준 흐름** | 유형 1/2 빌딩블록은 존재하나 Shopify 주문 연결 어댑터는 미구현 | 파트너측 어댑터 + `uploadCallbackUrl` 등록 |
| **회원번호 체계** | 파트너 자체 정수 회원번호 필요 | Shopify customer ID → 정수 시퀀스 1:1 매핑 결정 (해시변환 금지 — 충돌) |

> 위 항목이 충족되면 유형 3은 유형 2 임베드 + 유형 1 다운로드/웹훅 빌딩블록의 합으로 동작합니다. 신규 발명 엔드포인트는 필요하지 않습니다.

---

## 5. 레퍼런스

### 5.1 전체 엔드포인트 표

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
| GET | `/api/files/:id/thumbnail` | @Public | PDF 썸네일 PNG (`?page=`, `?width=`) |
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
| POST | `/api/worker-jobs/compose-mixed` | **@Public (무인증·테넌트 스코프 없음)** | 세션 기반 합성 트리거. ⚠️ editSessionId(UUID)만으로 트리거 가능 → 세션ID 비밀유지·브라우저 노출 최소화 |
| GET | `/api/worker-jobs/external/:id` | X-API-Key | 잡 상태 폴링 |
| GET | `/api/worker-jobs/:id/output` | **JWT (전역 가드, @Public 아님)** | admin Before/After 미리보기용 **내부** 라우트. 파트너는 사용 불가 → 결과 PDF 는 `download/external` 사용 |
| PATCH | `/api/worker-jobs/external/:id/status` | **X-API-Key (@Public+ApiKeyGuard)** | 워커 콜백용. worker 키(내부)=전체 잡 바이패스, editor/테넌트 키=자기 site 잡만 갱신(P2c S-3) |
| PATCH | `/api/worker-jobs/:id/status` | JWT (전역 가드) | 내부 워커 상태 업데이트 변형 |
| GET | `/api/edit-sessions/external` | @Public + X-API-Key | 주문별 편집세션 조회 (`?orderSeqno=`) |
| GET | `/api/edit-sessions/:id/imposition-preview` | @Public + X-API-Key | 임포지션 프리뷰 |
| POST | `/api/edit-sessions` | (회원/게스트) | 편집세션 생성 — `memberSeqno` falsy 시 `400 MEMBER_REQUIRED` |
| GET/POST/PUT/DELETE | `/api/sites`, `/api/sites/:id` | JWT + ADMIN/MANAGER | 테넌트 생애주기 (운영자 전용, 파트너 비대상). **수정은 `PUT /api/sites/:id`** (`:id` 에 PATCH 라우트 없음) |
| PATCH | `/api/sites/:id/regenerate` | JWT + ADMIN/MANAGER | 키 회전 (`{target:'editor'\|'worker'\|'both'}`) |

> **참고:** `/external` 이 붙지 않은 `synthesize`/`convert`/`split-synthesize` 등은 JWT + ADMIN/MANAGER 전용이며 파트너 대상이 아닙니다. 파트너는 반드시 `/external` 변형을 사용하세요. 또한 워커 출력 되연결(`registerExternalFile`)은 HTTP 엔드포인트가 아니라 내부 서비스 메서드입니다 — 외부에서 직접 등록하는 엔드포인트는 없습니다.

### 5.2 Webhook 서명 검증 (현 상태 정확히)

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

### 5.3 PDF 검증 규칙 요약 (워커 15단계)

| # | 검증 항목 | 기준 |
|---|---|---|
| 1 | 파일 크기 | 코드 기본 100 MB / **프로덕션 현재 1 GB** (env `WORKER_MAX_FILE_SIZE`; 최대 2 GB는 운영팀 상향 대기) |
| 2 | 파일 무결성 | PDF 구조 유효성 |
| 3 | 페이지 수 / 제본 규격 | `pages` + `binding`(perfect/saddle/spring) |
| 4 | 판형 | ±1 mm |
| 5 | 재단 여백(bleed) | 3 mm |
| 6 | 책등(spine) | ±2 mm |
| 7~8 | CMYK (2단계) | GhostScript inkcov |
| 9 | 별색(spot color) | 노티 |
| 10 | 투명도 / 오버프린트 | 검출 |
| 11 | 해상도 | 150 DPI |
| — | 판정 | 에러 ≥ 1 → `isValid=false` 차단 |

> 결과는 잡 `result.errors` / `result.warnings` / `result.metadata` 에 담깁니다. `autoFixable` 이면 `FIXABLE`, 아니면 `FAILED`. (파일 크기 기준은 §1.4·FAQ 참조 — 코드 기본 100 MB, 현재 프로덕션 배포 1 GB.)

### 5.4 유형별 온보딩 체크리스트

**공통 (전 유형)**
- [ ] Storige 운영자가 `POST /api/sites` 로 Site 생성 + 키 발급 (보안 채널 전달)
- [ ] 파트너 전용 키 사용 (키 공유 금지)
- [ ] 회원번호: 파트너 자체 정수 시퀀스 (외부 UUID → 정수 1:1, 해시변환 금지)

**유형 1 추가**
- [ ] presigned 직결 시 R2 CORS origin + `ExposeHeaders: ETag` 등록 (오너 작업)
- [ ] `validate/external` `fileType`(enum) + `orderOptions` 전체 전달
- [ ] 검증 PDF가 1 GB 초과(현재 프로덕션 상한) 시 `WORKER_MAX_FILE_SIZE` 상향 사전 요청
- [ ] 보존정책(`expiry/external` / `DELETE external`) 설계

**유형 2 추가**
- [ ] `allowedOrigins` 수정 = `PUT /api/sites/:id` (CORS)
- [ ] `apps/editor/vercel.json` frame-ancestors 반영 + master push (자체도메인 iframe)
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
CORS는 (a) Origin 없음→무조건 허용 (b) env 정적 (c) `*.vercel.app`/`*.papascompany.co.kr` (d) DB `allowedOrigins` 합집합(60s 캐시) 순으로 결정됩니다. 프로덕션 도메인 허용은 `PUT /api/sites/:id` (DB만 변경, 재배포 불필요). 단, **iframe 임베드 CSP frame-ancestors는 DB가 아니라 `vercel.json` 정적 정의**이므로 별도 push가 필요합니다.

**Q. iframe에서 postMessage가 안 옵니다.**
`parentOrigin` 파라미터가 없으면 정식 postMessage가 전면 비활성됩니다(레거시 storige:* 만 와일드카드로 폴백). 또한 루트 `/` 는 레거시 라우트로 완료 메시지를 발신하지 않습니다 — 반드시 `/embed` 를 사용하세요.

**Q. editor/worker 키를 분리해야 하나요?**
현재 두 코드는 생성 시 동일 값으로 발급됩니다(worker 코드 미지정 시 editor 코드 복사). 단일 키를 전권 키로 취급하고 비밀유지하세요. `regenerate` 로 독립 회전되면 값이 달라질 수 있습니다.

**Q. 1~2 GB 파일을 올릴 수 있나요?**
presigned 업로드는 2 GB까지 허용합니다. 워커 PDF 검증 상한은 env `WORKER_MAX_FILE_SIZE` 로 결정되며, **코드 기본값은 100 MB이지만 현재 프로덕션 배포값은 1 GB**(`docker-compose.yml` `WORKER_MAX_FILE_SIZE=1073741824`)입니다. 즉 오늘 기준 1 GB까지 검증을 통과하고, 설정 상한 초과 시 즉시 `FAILED`('N MB를 초과합니다')입니다. 1 GB 초과(최대 2 GB) 검증은 워커 스트리밍(트랙 B) 완료 후 운영팀 상향이 필요하니 온보딩 시 협의하세요.

**Q. shop-session에서 회원번호 관련 에러가 납니다.**
`memberSeqno` 는 `@IsNumber()` 필수 필드라 **누락 시 일반 검증 `400`**(코드명 `MEMBER_REQUIRED` 아님)이 납니다. `memberSeqno=0` 은 유효한 number라 검증을 통과해 `sub='0'` 세션을 발급합니다(거부 안 함). `MEMBER_REQUIRED` 는 shop-session 이 아니라 `POST /api/edit-sessions`(세션 생성) 단계에서 `memberSeqno` 가 falsy(0/누락)일 때 발생합니다. 파트너 자체 정수 회원번호(0/음수 아님)를 채우세요.

**Q. 게스트가 편집완료했는데 PDF가 없습니다.**
회원 식별 없는 토큰(예: `memberSeqno=0`)은 게스트 세션으로 폴백되어, 편집완료 시 PDF 없이 `editor.needAuth` 만 발신합니다. 호스트가 로그인 유도 후 게스트→회원 세션 마이그레이션을 처리해야 합니다.

---

*본 가이드는 추출된 사실(코드 대조)에 근거하며, 불확실 항목은 `TBD` 또는 `미구현(제안)` 으로 표기했습니다. 추가 엔드포인트/파라미터가 필요하면 Storige 팀에 문의하세요.*
