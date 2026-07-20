# Storige 플랫폼 워커 연동 가이드 (v1.0)

> **대상**: 외부 사이트(쇼핑몰/앱/서비스) 개발자 — Storige 플랫폼 워커를 사용해 PDF 합성 잡을 발사하고 결과 파일을 받는 모든 경우
> **버전**: v1.0 (2026-05-07)
> **전제**: 본 문서는 **워커 연동만** 다룹니다. 사용자 인터랙션(에디터 UI)은 별도(`PHP_INTEGRATION_FINAL_v3.md`).
> **언어 중립**: curl / Node.js / Python / Go 모두 동일. 본문은 curl, §10에 언어별 예시.
> **자기완결**: AI에게 본 문서 + §11 프롬프트만 넘기면 즉시 구현 가능.

---

> ## 📌 Phase 0 정정 안내 (2026-05-16)
>
> 본 문서 본문은 그대로 두되, 아래 항목은 **`docs/PHASE_0_CONTRACT_DECISIONS_2026-05-16.md`** 의 결정을 우선 따릅니다.
>
> | 항목 | 본문 표기 | **정정 (코드 일치)** |
> |---|---|---|
> | Webhook 서명 | (HMAC 언급 시) | **Base64** of `${identifier}:${event}:${timestamp}`. HMAC 은 v2 로 분리 |
> | Worker job 생성 응답 | (혼재) | **HTTP 201 Created**. 클라이언트는 2xx 전체 성공 처리 |
> | `/worker-jobs/{id}/output` | Bearer JWT 직접 호출 | **외부 서비스는 자체 서버 프록시 단일**. 결과 PDF URL 을 브라우저에 직접 노출 금지 |
> | URL 파라미터 케이스 | snake_case | snake_case 권장, **camelCase 도 양쪽 수용** (Phase A-2) |
> | Webhook 재시도 | (미명시) | 1회 자동 재시도. 헤더 `X-Storige-Retry: 1`. 현재 구현은 재시도 시 `X-Storige-Signature` 누락 (D-4 핫픽스 예정) |
>
> 자세한 사항은 `PHASE_0_CONTRACT_DECISIONS_2026-05-16.md` 참조.

---

> ## 🚨 WH-001 웹훅 서명 정정 안내 (2026-06-23 컷오버 — 본문·Phase 0 표의 서명 서술보다 우선)
>
> 본문 §의 웹훅 서명 서술(`X-Storige-Signature` 헤더 + `signing_string = timestamp + "." + raw_body`)과 위 Phase 0 표의 "Base64 서명" 항목은 **프로덕션과 일치하지 않습니다.** WH-001(2026-06-23) 이후 배포 코드의 실제 계약은 다음과 같습니다 (`apps/api/src/webhook/webhook.service.ts` 실측 기준):
>
> | 항목 | 실제 프로덕션 계약 |
> |---|---|
> | 검증용 헤더 | **`X-Storige-Signature-HMAC: t=<unix초>,v1=<64자 hex>`** |
> | 서명 대상 | raw body 아님 — canonical string **`<t>.<identifier>:<event>:<timestamp>`** |
> | `identifier` | `body.jobId ?? body.sessionId` (synthesis/validation → `jobId`, 세션 콜백 → `sessionId`) |
> | `timestamp` | JSON body 안의 ISO-8601 문자열 (`t`와 다름) |
> | 알고리즘 | `v1 == HMAC-SHA256(WEBHOOK_SECRET, signing_string).hex()` — `WEBHOOK_SECRET` 설정 시에만 발송 |
> | 구 `X-Storige-Signature` | 계약 호환용으로 계속 발송되나 **base64일 뿐 위조 가능 — 보안 검증에 신뢰 금지** |
>
> **구현 시 정본**: `.cursor/plans/WH001_PARTNER_CUTOVER/` 파트너별 문서(100pbooks·bookmoa-php·bookmoa-mobile·sharesnap·md2books) 또는 `packages/sdk`의 `/webhook` 모듈(검증·멱등·어댑터 구현 완비)을 따르세요. 아래 본문의 서명 관련 절은 이력 보존용으로만 남깁니다.

---

## 0. TL;DR — 5분 요약

```
[발급 1회]      Storige 운영팀 → admin 등록 → 인증코드(X-API-Key) 전달
                ↓
[연동 1회]      당신 .env에 STORIGE_API_KEY / STORIGE_API_BASE 입력
                ↓
[잡마다 반복]   ① 파일 2개 업로드 (cover.pdf, content.pdf) → fileId 받음
                ② 합성 잡 생성 (POST /worker-jobs/synthesize/external) → jobId
                ③ Webhook 수신 또는 폴링으로 COMPLETED 확인
                ④ JWT 발급 (POST /auth/shop-session) → accessToken
                ⑤ 결과 PDF 다운로드 (GET /worker-jobs/{jobId}/output, Bearer JWT)
```

핵심 endpoint 5개:
| # | Method | Path | 인증 | 용도 |
|---|--------|------|------|------|
| 1 | POST | `/files/upload/external` | X-API-Key | PDF 업로드 → fileId |
| 2 | POST | `/worker-jobs/synthesize/external` | X-API-Key | 합성 잡 생성 → jobId |
| 3 | GET | `/worker-jobs/external/{id}` | X-API-Key | 잡 상태 조회 (폴링용) |
| 4 | POST | `/auth/shop-session` | X-API-Key | JWT 발급 (다운로드 권한 획득) |
| 5 | GET | `/worker-jobs/{id}/output` | Bearer JWT | 결과 PDF 다운로드 |

---

## 1. 인증 모델 (Phase A 멀티사이트 모델)

### 1-1. 두 종류의 토큰

| 토큰 | 발급처 | 형식 | 유효기간 | 용도 |
|------|--------|------|----------|------|
| **`X-API-Key`** (편집기/워커 인증코드) | Storige 운영팀이 admin에서 발급 → 당신에게 전달 | `sk-storige-{48hex}` | 무기한 (재발급 시 즉시 무효) | 서버 간 호출 (잡 생성, 폴링, 파일 업로드) |
| **JWT (shop-session)** | 당신 서버가 `/auth/shop-session`으로 발급 | base64 JWT (페이로드 안에 siteId/memberSeqno) | 1h | 결과 PDF 다운로드 권한 |

### 1-2. 사이트 식별 자동 처리

`X-API-Key`를 헤더에 넣어 호출하면 Storige가 자동으로 **당신 사이트 컨텍스트**를 모든 잡/세션에 주입합니다 (`worker_jobs.site_id`, `file_edit_sessions.site_id`). admin에서 본인 사이트 데이터만 조회 가능.

### 1-3. 보안 원칙

- **`X-API-Key`는 절대 클라이언트(브라우저 JS)에 노출 금지** — 서버 사이드에서만 사용.
- 키 노출 의심 시 즉시 Storige 운영팀에 재발급 요청 (admin에서 1초만에 가능, 이전 키 즉시 무효).
- 다운로드 URL을 고객에게 직접 주지 마세요 — 당신 서버가 내려받아 고객에게 스트림.

---

## 2. 환경 변수 (`.env`)

당신 서버 환경변수 3개:

```bash
# Storige 운영팀에서 받은 값
STORIGE_API_KEY=sk-storige-{48hex}
STORIGE_API_BASE=https://api.papascompany.co.kr/api

# 당신 서버의 webhook 수신 URL (잡 완료 시 Storige가 호출)
STORIGE_WEBHOOK_URL=https://your-site.example.com/storige/webhook
```

> ⚠️ `STORIGE_WEBHOOK_URL` 은 **Storige가 외부에서 접근 가능**해야 하고, **Storige 측 호스트 화이트리스트에 등록**돼 있어야 합니다 (§9-3).

---

## 3. 워크플로 풀 시퀀스

```
당신 서버                                           Storige 플랫폼
   │                                                    │
   │ ① POST /files/upload/external (cover.pdf, type=cover)
   │  X-API-Key: sk-…                                   │
   │ ─────────────────────────────────────────────────▶│
   │ ◀────────────────────────────────────────────────  │
   │   { id: "<coverFileId>", fileUrl: "/storage/…" }   │
   │                                                    │
   │ ① POST /files/upload/external (content.pdf, type=content)
   │ ─────────────────────────────────────────────────▶│
   │ ◀────────────────────────────────────────────────  │
   │   { id: "<contentFileId>" }                        │
   │                                                    │
   │ ② POST /worker-jobs/synthesize/external             │
   │  body: {                                           │
   │    coverFileId, contentFileId, spineWidth: 6.0,    │
   │    bindingType: "perfect", outputFormat: "merged", │
   │    orderId: "ORD-12345",                           │
   │    callbackUrl: "https://your-site/storige/webhook"│
   │  }                                                 │
   │ ─────────────────────────────────────────────────▶│
   │ ◀────────────────────────────────────────────────  │
   │   { id: "<jobId>", status: "PENDING" }             │
   │                                                    │
   │                                  [Worker 처리…]    │
   │                                  Bull queue로 비동기│
   │                                                    │
   │ ③ Webhook 수신 (synthesis.completed)                │
   │ ◀───────────────────────────────────────────────── │
   │   POST {STORIGE_WEBHOOK_URL}                       │
   │   body: { event:"synthesis.completed", jobId, … }  │
   │   X-Storige-Signature: <HMAC-SHA256>               │
   │                                                    │
   │ ④ POST /auth/shop-session                          │
   │   X-API-Key: sk-…                                  │
   │   body: { memberSeqno, memberId, memberName,       │
   │           orderSeqno: 12345 }                      │
   │ ─────────────────────────────────────────────────▶│
   │ ◀────────────────────────────────────────────────  │
   │   { accessToken: "<JWT>", refreshToken: "…" }      │
   │                                                    │
   │ ⑤ GET /worker-jobs/{jobId}/output                   │
   │   Authorization: Bearer <JWT>                      │
   │ ─────────────────────────────────────────────────▶│
   │ ◀────────────────────────────────────────────────  │
   │   Content-Type: application/pdf                    │
   │   <PDF binary>                                     │
   │                                                    │
   │ 당신 서버에 저장 → 고객에게 다운로드 제공             │
```

---

## 4. API 명세 (필수 5개 + 보조 2개)

### 4-1. 파일 업로드

```http
POST /api/files/upload/external
Host: api.papascompany.co.kr
X-API-Key: sk-storige-…
Content-Type: multipart/form-data

------BOUNDARY
Content-Disposition: form-data; name="file"; filename="cover.pdf"
Content-Type: application/pdf

<binary>
------BOUNDARY
Content-Disposition: form-data; name="type"

cover
------BOUNDARY--
```

**필드**:
| Name | Type | 필수 | 값 |
|------|------|------|-----|
| `file` | File | ✅ | PDF 바이너리 |
| `type` | string | ✅ | `cover` \| `content` \| `uploads` |

**응답 200**:
```json
{
  "id": "10f669d6-fac2-43d6-ab4a-ab4ee5294425",
  "fileUrl": "/storage/uploads/1777856278617_b65a7662-cb6b-4510-b2e1-07f9fb590cde.pdf",
  "fileName": "cover.pdf",
  "fileSize": 7972,
  "mimeType": "application/pdf"
}
```

> 🔑 응답의 `id`(UUID)가 **`coverFileId` / `contentFileId`** 입니다. URL 아님 — 합성 잡 생성에 그대로 사용.

### 4-2. 합성 잡 생성

```http
POST /api/worker-jobs/synthesize/external
Host: api.papascompany.co.kr
X-API-Key: sk-storige-…
Content-Type: application/json

{
  "coverFileId":   "10f669d6-fac2-43d6-ab4a-ab4ee5294425",
  "contentFileId": "2dac9a23-6ca3-428c-aeab-13883dd9d3c5",
  "spineWidth":    6.0,
  "bindingType":   "perfect",
  "outputFormat":  "merged",
  "orderId":       "ORD-12345",
  "priority":      "high",
  "callbackUrl":   "https://your-site.example.com/storige/webhook"
}
```

**필드**:
| Name | Type | 필수 | 기본 | 설명 |
|------|------|------|------|------|
| `coverFileId` | UUID | ✅ | — | 표지 PDF 파일 ID |
| `contentFileId` | UUID | ✅ | — | 내지 PDF 파일 ID |
| `spineWidth` | number (mm) | ✅ | — | 책등 폭. perfect/hardcover에 필수 |
| `bindingType` | enum | ❌ | `perfect` | `perfect` \| `saddle` \| `hardcover` |
| `outputFormat` | enum | ❌ | `merged` | `merged` (단일 PDF) \| `separate` (cover + content 분리) |
| `orderId` | string | ❌ | — | 당신 사이트 주문 식별자 (webhook payload에 echo) |
| `priority` | enum | ❌ | `normal` | `high` \| `normal` \| `low` |
| `callbackUrl` | URL | ❌ | — | Webhook 수신 URL. 미설정 시 폴링만 가능 |
| `editSessionId` | UUID | ❌ | — | 편집기 세션 ID (편집기 사용 시) |

**응답 201**:
```json
{
  "id":           "49b50daf-4dba-4ef3-9862-0cc9e3ffc0c9",
  "jobType":      "SYNTHESIZE",
  "status":       "PENDING",
  "siteId":       "1391c5b4-5055-42f3-8e86-aff3b31ca528",
  "createdAt":    "2026-05-07T03:12:00.000Z"
}
```

### 4-3. 잡 상태 조회 (폴링)

Webhook 안 쓸 때만 사용. Webhook이 권장 — 폴링은 부하/지연 단점.

```http
GET /api/worker-jobs/external/{jobId}
X-API-Key: sk-storige-…
```

**응답 200**:
```json
{
  "id":            "49b50daf-…",
  "jobType":       "SYNTHESIZE",
  "status":        "COMPLETED",
  "outputFileUrl": "/storage/outputs/49b50daf-…/merged.pdf",
  "result": {
    "success":     true,
    "totalPages":  17,
    "outputFileUrl":"/storage/outputs/49b50daf-…/merged.pdf",
    "outputFiles": null
  },
  "completedAt":   "2026-05-07T03:12:14.000Z"
}
```

> ⚠️ `outputFileUrl`은 **Storige 내부 저장소 경로** — 직접 HTTP 요청하지 마세요. 4-5번 다운로드 endpoint를 사용해야 합니다.

**status 값**:
| 값 | 의미 | 후속 액션 |
|---|---|---|
| `PENDING` | 큐 대기 | 다음 폴링 또는 webhook 대기 |
| `PROCESSING` | 워커 처리 중 | 대기 |
| `COMPLETED` | 합성 완료 | §4-4 → §4-5 진행 |
| `FIXABLE` | 검증 실패지만 자동 수정 가능 | 별도 sync 잡 필요 (별도 가이드) |
| `FAILED` | 합성 실패 | `errorMessage` 확인, 재시도 또는 사용자 안내 |

### 4-4. JWT 발급 (다운로드 권한)

```http
POST /api/auth/shop-session
X-API-Key: sk-storige-…
Content-Type: application/json

{
  "memberSeqno":  123456,
  "memberId":     "user@your-site.com",
  "memberName":   "홍길동",
  "orderSeqno":   12345
}
```

**필드**:
| Name | Type | 필수 | 설명 |
|------|------|------|------|
| `memberSeqno` | number | ✅ | 당신 사이트 회원 ID |
| `memberId` | string | ✅ | 당신 사이트 회원 식별자 (이메일/로그인ID) |
| `memberName` | string | ✅ | 표시 이름 |
| `orderSeqno` | number | ❌ | 단일 주문 컨텍스트. 명시 시 그 주문 외 작업 자동 차단 (보안 강화) |
| `allowedOrderSeqnos` | number[] | ❌ | 다중 주문 허용 |

**응답 200** (Cookie + body):
```json
{
  "accessToken":   "eyJhbGciOiJI…",
  "refreshToken":  "eyJhbGciOiJI…",
  "user": { "id": "123456", "email": "user@…", "role": "customer" }
}
```

> JWT 페이로드에 자동으로 `siteId`(당신 사이트 ID) 포함됨. 다운로드 시 사이트 격리 자동 적용.

### 4-5. 결과 PDF 다운로드

```http
GET /api/worker-jobs/{jobId}/output
Authorization: Bearer eyJhbGciOiJI…
```

**응답 200**:
```
Content-Type: application/pdf
Content-Length: 7972
Content-Disposition: attachment; filename="output.pdf"

<PDF binary>
```

> Bearer JWT 사용 (X-API-Key 아님). 4-4에서 발급한 토큰을 그대로 사용.

### 4-6. (보조) 병합 가능 사전 체크

주문 결제 직전 사전 검증. 실패하면 사용자 재편집 안내.

```http
POST /api/worker-jobs/check-mergeable/external
X-API-Key: sk-storige-…
Content-Type: application/json

{
  "coverFileId": "10f669d6-…",
  "contentFileId": "2dac9a23-…",
  "spineWidth": 6.0
}
```

**응답**:
```json
{
  "mergeable": true,
  "issues": []
}
```

또는 실패:
```json
{
  "mergeable": false,
  "issues": [
    { "code": "PAGE_COUNT_INVALID", "message": "내지 페이지 수가 4의 배수가 아닙니다", "autoFixable": true }
  ]
}
```

### 4-7. (보조) 원본 파일 다운로드

업로드한 cover.pdf / content.pdf 원본 받기. 합성 결과는 4-5번 사용.

```http
GET /api/files/{fileId}/download/external
X-API-Key: sk-storige-…
```

---

## 5. Webhook 수신 (권장)

### 5-1. 페이로드 형식 (JSON, POST)

**`synthesis.completed`**:
```http
POST {STORIGE_WEBHOOK_URL}
Content-Type: application/json
X-Storige-Event: synthesis.completed
X-Storige-Signature: t=1778081234,v1=<HMAC-SHA256-HEX>

{
  "event":         "synthesis.completed",
  "jobId":         "49b50daf-4dba-4ef3-9862-0cc9e3ffc0c9",
  "orderId":       "ORD-12345",
  "siteId":        "1391c5b4-…",
  "status":        "completed",
  "outputFileUrl": "/storage/outputs/49b50daf-…/merged.pdf",
  "outputFormat":  "merged",
  "outputFiles":   null,
  "totalPages":    17,
  "completedAt":   "2026-05-07T03:12:14.000Z"
}
```

**`outputFormat: "separate"`** 시 `outputFiles` 추가:
```json
{
  "outputFiles": [
    { "type": "cover",   "url": "/storage/outputs/{jobId}/cover.pdf" },
    { "type": "content", "url": "/storage/outputs/{jobId}/content.pdf" }
  ]
}
```

**`synthesis.failed`**:
```json
{
  "event":        "synthesis.failed",
  "jobId":        "uuid",
  "orderId":      "ORD-12345",
  "status":       "FAILED",
  "errorMessage": "PDF merge failed: …",
  "failedAt":     "2026-05-07T03:12:00.000Z"
}
```

> ⚠️ `outputFileUrl`은 internal path. 직접 HTTP 요청 X. 4-4 → 4-5 흐름 사용.

### 5-2. 응답 정책

| 응답 | Storige 처리 |
|------|--------------|
| 2xx | 성공 — 재시도 X |
| 4xx, 5xx | 실패 — 지수 백오프 최대 3회 재시도 |
| 타임아웃 (>30s) | 실패로 간주 |

> 무거운 처리(PDF 다운로드/저장)는 큐에 넣고 **즉시 200 반환** 권장.

### 5-3. 서명 검증 (선택, 권장)

`X-Storige-Signature` 헤더 형식: `t=<timestamp>,v1=<HMAC-SHA256-HEX>`

검증 (의사코드):
```
1. signing_string = timestamp + "." + raw_body
2. expected = HMAC_SHA256(STORIGE_WEBHOOK_SECRET, signing_string).hex
3. if expected != v1: reject
4. if (now - timestamp) > 5min: reject (replay 공격 방지)
```

`STORIGE_WEBHOOK_SECRET`은 운영팀에 별도 요청 (현재는 발급 시점에 안내).

---

## 6. 폴링 모드 (Webhook 미사용 시)

```
잡 생성 → jobId 응답
  │
  ▼
loop:
  GET /api/worker-jobs/external/{jobId}  (X-API-Key)
  if status in [COMPLETED, FAILED, FIXABLE]: break
  sleep 3~5초
```

**권장 간격**: 첫 5초는 1초, 이후 3초, 30초 후 5초.
**최대 대기**: 10분 (그 이후 FAILED 간주, 운영팀 문의).

---

## 7. 응답 코드 + 에러 카탈로그

| HTTP | 발생 상황 | body 예시 | 대응 |
|------|----------|-----------|------|
| 200/201 | 성공 | — | — |
| 400 | 입력 검증 실패 | `{ message: ["spineWidth must be a number"] }` | 요청 body 점검 |
| 401 | X-API-Key 잘못 또는 운영중지 | `{ message: "Invalid API Key" }` | 키 확인. status=suspended? 운영팀 문의 |
| 401 | JWT 만료 | `{ message: "Unauthorized" }` | §4-4 재발급 (1h 유효) |
| 403 | 권한 없음 (다른 사이트 잡 다운로드 시도) | `{ code: "FORBIDDEN" }` | 본인 사이트 잡인지 확인 |
| 404 | 잡/파일 없음 | `{ code: "JOB_NOT_FOUND" }` | jobId 오타 또는 삭제됨 |
| 422 | 검증 실패 (FIXABLE) | `{ code: "PAGE_COUNT_INVALID", autoFixable: true }` | 자동 수정 잡 발사 또는 사용자 안내 |
| 500 | 서버 에러 | — | Sentry 자동 추적, 운영팀 알림 자동 |
| 502 | nginx 라이브 X | (HTML) | API 서버 재기동 중. 30초 후 재시도 |

---

## 8. 잡 옵션 default — 사이트별 자동 적용

당신 사이트 등록 시 운영팀이 다음 default를 설정합니다:

| 옵션 | 의미 |
|------|------|
| `pdfConversionEnabled` | PDF 자동 변환 (페이지 추가, bleed) 사용 여부 |
| `defaultUnit` | 데이터 단위 (`mm` / `inch`) |
| `checkWorkorder` | 작업서 체크 |
| `checkCutting` | 재단선 체크 |
| `checkSafezone` | 안전선 체크 |

**잡 생성 시 호출자가 옵션을 명시하면 그 값이 우선**, 누락된 항목만 사이트 default로 자동 채워집니다. 즉 **간단한 호출(필수 필드만)만 보내면 사이트 정책 자동 적용** — 호출자는 일관성 신경 쓸 필요 없음.

---

## 9. 연동 이슈 카탈로그 (실 발생)

### 9-1. 인증 / 키

| 증상 | 원인 | 해결 |
|------|------|------|
| 모든 호출 401 | X-API-Key 헤더 누락 또는 오타 | header 이름 정확히 `X-API-Key`, prefix 없이 키 값만 |
| 한동안 작동하다 401 | 운영팀이 키 재발급 (이전 키 즉시 무효) | 운영팀 신규 키로 교체 |
| `/auth/shop-session` 401 | X-API-Key 인증 실패 | 위와 동일 |
| `/{jobId}/output` 401 | JWT 만료 (1h) | §4-4 재발급 |
| `/{jobId}/output` 403 | 다른 사이트의 잡 시도 | 본인 사이트가 만든 잡인지 jobId 확인 |

### 9-2. 파일 업로드

| 증상 | 원인 | 해결 |
|------|------|------|
| 413 Payload Too Large | 파일이 100MB 초과 | 파일 분할 또는 압축 |
| `id`가 응답에 없음 | type 필드 누락 | `type=cover` 또는 `content` 명시 |
| 업로드 후 fileId로 잡 생성 시 404 | UUID 잘못 복사 | 응답 `id` 그대로 사용 (URL 아님) |

### 9-3. Webhook

| 증상 | 원인 | 해결 |
|------|------|------|
| Webhook 안 옴 | `callbackUrl` 호스트가 Storige 화이트리스트 미등록 | 운영팀에 호스트 등록 요청. 또는 폴링 모드 사용 |
| Webhook 중복 도착 | 당신 서버가 200 응답 안 보냄 → Storige 재시도 | **즉시 200 반환** + 처리는 큐로 비동기 |
| 서명 검증 실패 | `STORIGE_WEBHOOK_SECRET` 미설정 또는 잘못된 값 | 운영팀에 시크릿 재확인. 임시로 검증 스킵 가능 (개발) |
| Webhook은 오는데 결과 다운로드 안 됨 | `outputFileUrl`을 직접 GET 시도 | §4-5 endpoint + Bearer JWT 사용 |

### 9-4. 합성 잡 처리

| 증상 | 원인 | 해결 |
|------|------|------|
| status FIXABLE | 검증 실패지만 자동 수정 가능 (페이지 수 등) | `result.errors` 확인 후 자동 수정 잡 발사 또는 사용자 재편집 안내 |
| status FAILED + `errorMessage="No PDF data"` | 업로드 파일이 빈 PDF 또는 손상 | 원본 파일 확인 |
| 한참 PENDING | 워커 큐 적체 (백로그 10건+) | Storige Sentry 자동 알림 → 운영팀 자동 대응 |
| 합성 결과가 너무 작은 PDF | spineWidth 단위 (mm) 잘못 (cm/inch로 보냄) | mm 단위 확인 |
| saddle 시 페이지 수 안 맞음 | 표지 4페이지 + 내지 4의 배수 필요 | check-mergeable로 사전 검증 |

### 9-5. 다운로드

| 증상 | 원인 | 해결 |
|------|------|------|
| 200 OK 받았는데 빈 PDF | response.body 직접 읽지 않고 `.json()` 시도 | binary 처리 (`response.arrayBuffer()` 등) |
| `Content-Disposition` 파일명 깨짐 | 한글 파일명 인코딩 | response 헤더 파싱 시 RFC 5987 형식 처리 |
| 다운로드 후 PDF 열기 실패 | 임시 파일 close 안 함 | stream 끝까지 읽은 후 close |

---

## 10. 언어별 코드 예시 (5개 endpoint × 4 언어)

### 10-1. curl

```bash
# ① 파일 업로드
curl -X POST "$STORIGE_API_BASE/files/upload/external" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -F "file=@cover.pdf" \
  -F "type=cover"
# → { "id": "<COVER_FILE_ID>", … }

# ② 합성 잡 생성
curl -X POST "$STORIGE_API_BASE/worker-jobs/synthesize/external" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "coverFileId":"<COVER_FILE_ID>",
    "contentFileId":"<CONTENT_FILE_ID>",
    "spineWidth":6.0,
    "bindingType":"perfect",
    "outputFormat":"merged",
    "orderId":"ORD-12345",
    "callbackUrl":"https://your-site.example.com/storige/webhook"
  }'
# → { "id": "<JOB_ID>", "status": "PENDING" }

# ③ 폴링 (webhook 미사용 시)
curl "$STORIGE_API_BASE/worker-jobs/external/<JOB_ID>" \
  -H "X-API-Key: $STORIGE_API_KEY"

# ④ JWT 발급
TOKEN=$(curl -s -X POST "$STORIGE_API_BASE/auth/shop-session" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"memberSeqno":123,"memberId":"u@x.com","memberName":"홍","orderSeqno":12345}' \
  | jq -r .accessToken)

# ⑤ 결과 PDF 다운로드
curl -o output.pdf "$STORIGE_API_BASE/worker-jobs/<JOB_ID>/output" \
  -H "Authorization: Bearer $TOKEN"
```

### 10-2. Node.js (fetch, Node 22+)

```javascript
import fs from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const BASE = process.env.STORIGE_API_BASE;
const KEY  = process.env.STORIGE_API_KEY;

// ① 업로드 (multipart)
async function uploadFile(filePath, type) {
  const buf = await fs.readFile(filePath);
  const fd  = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), filePath.split('/').pop());
  fd.append('type', type);
  const r = await fetch(`${BASE}/files/upload/external`, {
    method: 'POST', headers: { 'X-API-Key': KEY }, body: fd,
  });
  if (!r.ok) throw new Error(`upload failed: ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

// ② 합성 잡 생성
async function createSynthesis(opts) {
  const r = await fetch(`${BASE}/worker-jobs/synthesize/external`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  if (!r.ok) throw new Error(`synth failed: ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

// ④ JWT 발급
async function getJWT(member, orderSeqno) {
  const r = await fetch(`${BASE}/auth/shop-session`, {
    method: 'POST',
    headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...member, orderSeqno }),
  });
  if (!r.ok) throw new Error(`shop-session failed: ${r.status}`);
  return (await r.json()).accessToken;
}

// ⑤ PDF 다운로드 → 저장
async function downloadPdf(jobId, jwt, savePath) {
  const r = await fetch(`${BASE}/worker-jobs/${jobId}/output`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  await fs.writeFile(savePath, Buffer.from(await r.arrayBuffer()));
}

// 사용
const coverId   = await uploadFile('./cover.pdf', 'cover');
const contentId = await uploadFile('./content.pdf', 'content');
const jobId     = await createSynthesis({
  coverFileId: coverId, contentFileId: contentId,
  spineWidth: 6.0, bindingType: 'perfect', outputFormat: 'merged',
  orderId: 'ORD-12345',
  callbackUrl: process.env.STORIGE_WEBHOOK_URL,
});
console.log('Job created:', jobId);
// → webhook 또는 폴링으로 COMPLETED 대기 후:
// const jwt = await getJWT({ memberSeqno: 123, memberId: 'u@x.com', memberName: '홍' }, 12345);
// await downloadPdf(jobId, jwt, './output.pdf');
```

### 10-3. Python (requests)

```python
import os, requests

BASE = os.environ['STORIGE_API_BASE']
KEY  = os.environ['STORIGE_API_KEY']
H    = {'X-API-Key': KEY}

def upload(path: str, type_: str) -> str:
    with open(path, 'rb') as f:
        r = requests.post(f'{BASE}/files/upload/external',
                          headers=H,
                          files={'file': (os.path.basename(path), f, 'application/pdf')},
                          data={'type': type_})
    r.raise_for_status()
    return r.json()['id']

def create_synthesis(**opts) -> str:
    r = requests.post(f'{BASE}/worker-jobs/synthesize/external',
                      headers={**H, 'Content-Type': 'application/json'},
                      json=opts)
    r.raise_for_status()
    return r.json()['id']

def get_jwt(member_seqno, member_id, member_name, order_seqno) -> str:
    r = requests.post(f'{BASE}/auth/shop-session',
                      headers={**H, 'Content-Type': 'application/json'},
                      json={'memberSeqno': member_seqno, 'memberId': member_id,
                            'memberName': member_name, 'orderSeqno': order_seqno})
    r.raise_for_status()
    return r.json()['accessToken']

def download(job_id: str, jwt: str, save_path: str):
    r = requests.get(f'{BASE}/worker-jobs/{job_id}/output',
                     headers={'Authorization': f'Bearer {jwt}'},
                     stream=True)
    r.raise_for_status()
    with open(save_path, 'wb') as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

# 사용
cover    = upload('./cover.pdf', 'cover')
content  = upload('./content.pdf', 'content')
job_id   = create_synthesis(
    coverFileId=cover, contentFileId=content,
    spineWidth=6.0, bindingType='perfect', outputFormat='merged',
    orderId='ORD-12345',
    callbackUrl=os.environ['STORIGE_WEBHOOK_URL'],
)
# webhook 또는 polling 후:
# jwt = get_jwt(123, 'u@x.com', '홍', 12345)
# download(job_id, jwt, './output.pdf')
```

### 10-4. Go (net/http)

```go
package storige

import (
    "bytes"
    "encoding/json"
    "io"
    "mime/multipart"
    "net/http"
    "os"
)

var (
    base = os.Getenv("STORIGE_API_BASE")
    key  = os.Getenv("STORIGE_API_KEY")
)

func Upload(path, fileType string) (string, error) {
    f, _ := os.Open(path)
    defer f.Close()
    body := &bytes.Buffer{}
    w := multipart.NewWriter(body)
    fw, _ := w.CreateFormFile("file", path)
    io.Copy(fw, f)
    w.WriteField("type", fileType)
    w.Close()
    req, _ := http.NewRequest("POST", base+"/files/upload/external", body)
    req.Header.Set("X-API-Key", key)
    req.Header.Set("Content-Type", w.FormDataContentType())
    res, err := http.DefaultClient.Do(req)
    if err != nil { return "", err }
    defer res.Body.Close()
    var out struct{ ID string `json:"id"` }
    json.NewDecoder(res.Body).Decode(&out)
    return out.ID, nil
}

// CreateSynthesis, GetJWT, Download 패턴 동일 — JSON body + 적절한 헤더
```

---

## 11. AI 프롬프트 (별도 사용)

본 가이드를 AI(Claude/GPT 등)에게 첨부 후 다음 프롬프트를 던지면 즉시 구현 가능:

```
첨부한 "Storige 플랫폼 워커 연동 가이드 v1.0"을 참조해, [언어/프레임워크]로
[당신 사이트명]의 워커 연동 모듈을 구현하세요.

## 환경
- 언어/프레임워크: [예: Node.js + Express, Python + FastAPI, Go + Echo]
- 환경변수: STORIGE_API_KEY, STORIGE_API_BASE, STORIGE_WEBHOOK_URL,
            STORIGE_WEBHOOK_SECRET (있으면)
- 호출 방향: 서버 사이드만 (X-API-Key는 절대 클라이언트 노출 X)

## 구현해야 할 5가지 기능

1. **파일 업로드 헬퍼** — `uploadPdf(path: string, type: 'cover'|'content'): Promise<fileId>`
   - 가이드 §4-1 참조
   - multipart/form-data, X-API-Key 헤더
   - 응답 `id`만 반환 (URL 아님)

2. **합성 잡 생성** — `createSynthesisJob(input): Promise<jobId>`
   - 가이드 §4-2 참조
   - 필수: coverFileId, contentFileId, spineWidth (mm)
   - 선택: bindingType (perfect/saddle/hardcover), outputFormat (merged/separate),
     orderId, priority, callbackUrl, editSessionId

3. **Webhook 수신 endpoint** — `POST /storige/webhook`
   - 가이드 §5 참조
   - X-Storige-Event 헤더로 분기 (synthesis.completed / synthesis.failed)
   - X-Storige-Signature HMAC-SHA256 검증 (시크릿 있을 때만)
   - 즉시 200 반환 + 처리는 비동기 큐로
   - replay 방지 (timestamp 5분 이내)

4. **결과 PDF 다운로드** — `downloadResultPdf(jobId, member, orderSeqno): Promise<Buffer>`
   - 가이드 §4-4 + §4-5 참조
   - 1단계: /auth/shop-session 호출 → JWT 받기 (X-API-Key)
   - 2단계: /worker-jobs/{jobId}/output (Bearer JWT) → binary 응답
   - JWT 1h 캐시 권장 (memory 또는 KV store)

5. **상태 조회 (폴링 옵션)** — `getJobStatus(jobId): Promise<status>`
   - 가이드 §4-3 참조
   - webhook 수신 안정화 전까지 백업으로

## 에러 처리 요구사항
- 가이드 §7 응답 코드 카탈로그 모두 구현
- 401 발생 시 명확한 에러 메시지 (키 잘못 / JWT 만료 구분)
- Webhook 200 응답 보장 (실패해도 200, 처리는 비동기)
- 합성 잡 status: PENDING / PROCESSING / COMPLETED / FIXABLE / FAILED 분기

## 출력 형식
- 단일 모듈 파일 (혹은 설계상 자연스럽게 분리)
- TypeScript 타입 또는 dataclass로 모든 입출력 명시
- 실 동작하는 main 예시 (cover.pdf + content.pdf → output.pdf 풀 흐름)
- 단위 테스트 1~2개 (mock fetch/requests)

## 제약
- 외부 의존성 최소화 (가능하면 표준 라이브러리)
- X-API-Key는 헤더만 사용, body나 query 사용 금지
- 합성 결과 outputFileUrl은 internal path — 직접 fetch 금지, §4-5 흐름만
- callbackUrl 호스트는 가이드 §9-3에 따라 사전 등록 필요 (사용자에게 안내 포함)

가이드 외부 정보는 사용 금지. 추측 대신 가이드 §X-Y 인용.
```

---

## 12. 통합 체크리스트 (배포 전)

### 환경
- [ ] `STORIGE_API_KEY` 환경변수 등록 (서버 사이드만)
- [ ] `STORIGE_API_BASE = https://api.papascompany.co.kr/api`
- [ ] `STORIGE_WEBHOOK_URL` 외부 접근 가능 (HTTPS, public)
- [ ] (선택) `STORIGE_WEBHOOK_SECRET` 운영팀 발급

### 기능
- [ ] 파일 업로드 — cover + content 2개 fileId 받음
- [ ] check-mergeable로 사전 검증 (선택)
- [ ] 합성 잡 생성 — jobId 응답
- [ ] Webhook 수신 endpoint 구현 + 200 즉시 응답
- [ ] (또는) 폴링 모드 구현
- [ ] JWT 발급 + 캐시
- [ ] 결과 PDF 다운로드 → 자체 저장소에 저장
- [ ] 사용자에게 다운로드 링크 (당신 서버 경유, fileId 노출 X)

### 운영
- [ ] callbackUrl 호스트를 Storige 운영팀에 등록 요청
- [ ] 401 (운영중지) 발생 시 운영팀 alert
- [ ] 합성 실패 (FAILED) 시 사용자 안내 + 운영팀 알림
- [ ] FIXABLE 잡 처리 정책 결정 (자동 수정 잡 발사 vs 사용자 재편집)

### 보안
- [ ] X-API-Key 클라이언트 노출 안 됨 (Network 탭 검증)
- [ ] Webhook 서명 검증 (시크릿 있는 경우)
- [ ] JWT 만료 시 자동 재발급
- [ ] 다른 사이트 jobId로 다운로드 시도 시 403 정상 응답 확인

---

## 13. 운영 정보 + 문의

| 항목 | 정보 |
|------|------|
| API Base URL | `https://api.papascompany.co.kr/api` |
| Swagger 문서 | `https://api.papascompany.co.kr/api/docs` |
| 운영 admin (Storige 팀) | `https://admin.papascompany.co.kr` |
| 모니터링 (Storige 팀) | `https://api.papascompany.co.kr/grafana/` |

**연동 시점에 받아야 할 정보**:
1. `STORIGE_API_KEY` (편집기 + 워커, 같은 값일 수 있음)
2. `STORIGE_WEBHOOK_SECRET` (선택)
3. callbackUrl 호스트 화이트리스트 등록 확인
4. 운영팀 Slack 채널 또는 이메일

---

## 14. 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-05-07 | 최초 작성. Phase A/B/C 멀티사이트 모델 반영. PHP 가이드와 분리, 언어 중립. |
| v1.1 | 2026-05-19 | 인쇄 워크플로우 v1 (Phase 5) — `compose-mixed` capability 추가 |

---

## 12. Capability — `compose-mixed` (2026-05-19, 인쇄 워크플로우 v1 Phase 5)

표지 + 앞면지 N + 내지(편집 결과 또는 첨부 PDF) + 뒷면지 K 를 단일 합본 PDF 로 생성.

### 12.1 출력 순서 (고정)

```
[표지, 앞면지 1..N, 내지 PDF, 뒷면지 1..K]
```

### 12.2 endpoint

```
POST /api/worker-jobs/compose-mixed
Authentication: @Public (향후 X-Guest-Token 또는 X-API-Key 가드 추가 검토)
Content-Type: application/json
```

### 12.3 입력 (`CreateComposeMixedJobDto`)

| 필드 | 타입 | 필수 | 비고 |
|---|---|---|---|
| `editSessionId` | UUID | optional | 편집 세션과 연결 (분석/감사용) |
| `coverUrl` | string | conditional | 표지 PDF URL (`coverEditable=true` 일 때 필수) |
| `coverEditable` | boolean | optional (default true) | `false` → 빈 표지 페이지 자동 생성 (레더 커버) |
| `coverWidthMm` | number | optional (default 210) | 표지 폭 (빈 표지 생성용) |
| `coverHeightMm` | number | optional (default 297) | 표지 높이 |
| `frontEndpaperUrls` | `(string \| null)[]` | optional | 앞면지 URL 배열. `null` 원소 = 빈 면지 페이지 |
| `backEndpaperUrls` | `(string \| null)[]` | optional | 뒷면지 URL 배열. `null` 원소 = 빈 면지 페이지 |
| `contentPdfUrl` | string | optional | 내지 PDF (편집 결과 또는 첨부 PDF) |
| `contentWidthMm` | number | optional (default 210) | 내지 폭 (빈 면지 페이지 크기) |
| `contentHeightMm` | number | optional (default 297) | 내지 높이 |
| `callbackUrl` | URL | recommended | 완료 webhook |
| `orderId` | string | optional | 외부 주문번호 (webhook echo) |

### 12.4 응답 (HTTP 201)

```json
{
  "id": "uuid-job",
  "jobType": "synthesize",
  "status": "PENDING",
  "createdAt": "2026-05-19T09:25:00.000Z"
}
```

### 12.5 Webhook (`synthesis.completed`)

```json
{
  "event": "synthesis.completed",
  "jobId": "uuid-job",
  "orderId": "ORD-2026-99999",
  "status": "completed",
  "outputFileUrl": "/storage/outputs/<jobId>/merged.pdf",
  "outputFormat": "merged",
  "timestamp": "2026-05-19T09:26:30.000Z",
  "result": {
    "capability": "compose-mixed",
    "outputFileUrl": "/storage/outputs/<jobId>/merged.pdf",
    "totalPages": 28,
    "success": true
  }
}
```

서명: 기존 Base64 방식 그대로 (§3 webhook 참조).

### 12.6 에러

- `400 Validation` — DTO 검증 실패 (예: coverWidthMm < 1)
- `synthesis.failed` webhook — pdf-lib 로딩 실패 / 다운로드 실패 등

### 12.7 mm → PDF point 변환

Worker 내부 자동 변환:
```
1 mm = 2.834645669 pt (72 dpi)
```

외부 호출자는 mm 단위로만 전달.

### 12.8 회귀 안전성

기존 `synthesize/external`, `validate/external`, `check-mergeable/external` 경로는 **0 변경**. compose-mixed 는 신규 mode 로 worker 가 별도 분기 처리.
