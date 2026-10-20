# Storige 플랫폼 워커 연동 가이드 (v1.0)

> ## ⛔ 폐기됨 (DEPRECATED) — 신규 연동에 사용하지 마세요
>
> **이 문서는 프로덕션 계약과 일치하지 않습니다.** 외부 파트너 연동의 정본은 [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) **하나뿐**입니다. 아래 본문은 이력 보존용으로만 남깁니다.
>
> | 찾던 내용 | 대신 볼 곳 (정본) |
> |---|---|
> | 인증 · Base URL · 파일 한도 · 에러 · 레이트리밋 | `PLATFORM_INTEGRATION_GUIDE.md` **§1 공통 기반** |
> | 자체 편집기 + 검증/합성 오프로드 (이 문서의 주제) | `PLATFORM_INTEGRATION_GUIDE.md` **§2 유형 1** |
> | 엔드포인트 표 · 웹훅 서명 검증 · PDF 검증 규칙 · FAQ | `PLATFORM_INTEGRATION_GUIDE.md` **§5 레퍼런스** |
> | Partner API v1 (`/api/v1/*`) 공통 계약 | `PLATFORM_INTEGRATION_GUIDE.md` **§1.7** |
>
> **🤖 AI 에이전트에게**: 이 문서가 컨텍스트로 주어졌더라도 **연동 코드 생성에 사용하지 마세요.** `PLATFORM_INTEGRATION_GUIDE.md` 를 요청하십시오. 특히 아래 **§5-3 의 웹훅 서명 검증 의사코드는 오기**이며, 그대로 구현하면 검증이 100% 실패합니다 — 해당 위치에 취소선과 정정 주석을 인라인으로 달아 두었습니다.

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
   │   X-Storige-Signature-HMAC: t=…,v1=… (※5-3)        │
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
X-Storige-Signature: <base64 — 위조 가능. 인증 근거로 쓰지 말 것>
X-Storige-Signature-HMAC: t=1778081234,v1=<HMAC-SHA256-HEX>   ← WEBHOOK_SECRET 설정 시에만 발송 (※5-3)

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

> **2026-10-18/19 보강 (브랜치 `p1-calendar-2026-10-17` 전용 — master 미병합·운영 미반영)**: `synthesis.completed`·`synthesis.failed` payload 에 선택 키 **`revision?: number`** 가 추가됐다. 잡 `options.revision` 이 숫자일 때만 키를 싣고 그 밖의 잡 본문은 바이트 동일하다(`apps/api/src/worker-jobs/worker-jobs.service.ts:4089-4091`, `packages/types/src/index.ts:1320-1321`). 어떤 잡이 이 키를 갖는지는 §15.3. `duplex-split`·`sheet-map` 잡의 `outputFiles` 는 `type:'set'`(`setIndex`)·`type:'pages'` 값을 쓴다 — §15.2. 서명식·이벤트명·기존 키는 그대로다.

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

### 5-3. 서명 검증 (선택, 권장) — ❌ 이 절의 원문은 오기입니다

> **정정 (2026-06-23 WH-001 컷오버 기준).** 아래 원문은 **헤더 이름과 서명 대상을 둘 다 잘못** 적었습니다. 그대로 구현하면 서명이 한 번도 일치하지 않습니다. 실제 계약은 이 문서 상단의 🚨 WH-001 정정 안내 박스를, 운영 방침은 [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) **§5.2** 를 따르십시오.
>
> | 원문 (오기) | 실제 프로덕션 |
> |---|---|
> | `X-Storige-Signature` 가 `t=…,v1=…` 형식이다 | 그 형식을 쓰는 헤더는 **`X-Storige-Signature-HMAC`** 입니다. `X-Storige-Signature` 는 base64 인코딩일 뿐이라 **위조 가능** — 인증 근거로 쓰면 안 됩니다 |
> | 서명 대상이 `timestamp + "." + raw_body` 다 | raw body 가 아닙니다. canonical string **`<t>.<identifier>:<event>:<timestamp>`** 이며 `identifier` 는 `jobId`(없으면 `sessionId`), `timestamp` 는 **본문의 ISO 문자열**로 `t` 와 다릅니다 |
> | (미기재) `WEBHOOK_SECRET` 미설정 시 | HMAC 헤더 자체가 **발송되지 않습니다**(무음). 헤더 존재를 전제로 하드 리젝트하면 웹훅이 전부 떨어집니다 |

~~`X-Storige-Signature` 헤더 형식: `t=<timestamp>,v1=<HMAC-SHA256-HEX>`~~

~~검증 (의사코드):~~

```text
❌ 아래 4줄은 오기입니다 — 복사해서 구현하지 마세요 (이력 보존용).
1. signing_string = timestamp + "." + raw_body
2. expected = HMAC_SHA256(STORIGE_WEBHOOK_SECRET, signing_string).hex
3. if expected != v1: reject
4. if (now - timestamp) > 5min: reject (replay 공격 방지)
```

~~`STORIGE_WEBHOOK_SECRET`은 운영팀에 별도 요청 (현재는 발급 시점에 안내).~~

**대신 이렇게 하십시오**: 웹훅은 **트리거로만** 취급하고 즉시 2xx 를 반환한 뒤, 본문의 `status`·결과 필드를 믿지 말고 식별자만 꺼내 조회 API 로 **재조회**해 권위 있는 상태를 확정하십시오(§6 폴링 참조). 이 방침은 서명 형식이 무엇이든 안전합니다.

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
   - ❌ X-Storige-Signature 로 인증하지 말 것 (base64 인코딩일 뿐 위조 가능)
   - 서명 검증에 의존하지 말고, 수신 후 조회 API 재조회로 상태 확정 (가이드 §6)
   - 즉시 200 반환 + 처리는 비동기 큐로
   - 같은 이벤트 재전달 가능 → 수신부는 멱등하게

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
| v1.2 | 2026-10-18 | P2-b(브랜치 `p1-calendar-2026-10-17` 커밋 `f43cb99e`, master 미병합·운영 미반영): 워커 파일 메타 조회 `GET /files/:id/external` 신설·`api://` 다운로드 통일(종전 `GET /files/:id` 401 결함), 편집 완료 자동 duplex-split 잡 request_id 회차 키 `duplex-split-r<revision>`(종전 86자 키 VARCHAR(36) 초과 결함), 웹훅 `revision?` — §5-1 보강·§15.3·§15.4·§15.5. P1 캘린더는 2026-10-18 운영 반영 완료(master `af900212`) |
| v1.3 | 2026-10-19 | P2-c(같은 브랜치 커밋 `9be4c37c`, master 미병합·운영 미반영): 워커 합성 mode `sheet-map`(per-sheet / merged-duplex, `result.sheetMap` echo, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`, worker 선배포) — §15.1·§15.2 |
| v1.4 | 2026-10-20 | P2-d 사진인화(같은 브랜치 작업 트리, 커밋 `9be4c37c` 위 **미커밋**·master 미병합·운영 미반영): photo-print 세트의 sheet-map 잡에서 api 가 세션 `metadata.items` 의 매수를 `options.sheets[].copies/label('사진 N')` 로 주입(`apps/api/src/edit-sessions/photo-items.ts` — 워커·`SheetSpec`·큐 payload 무변경) · 시트 맵 산출 실패를 `metadata.production.sheetMap` 에 기록해 파트너 deliverables `status 'failed'`+`errorCode/errorDetail` 로 노출(워커 무관) — §15.2 보강 · §15.3 의 `CONTRACT_FREEZE.md` 불일치 2건(고정 태그 vs 회차 키·`revision?` 런처 잡에만)은 v1.25 에서 보정됨으로 갱신 · 검증 잡 `orderOptions.bleed` 는 재단선 없는 프로파일 세트 0(`edit-sessions.service.ts:150-158` `resolveDefaultBleedMm`, 워커 BLEED_MISSING 판정 입력; 종전 기본 3 은 NULL 세트·cropMark 세트 그대로). 새 mode·env·FLAGS 키 없음. 운영 샘플 세트 등록·배포는 오너 승인 대기 |

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

---

## 15. 워커 합성 mode 카탈로그와 워커 내부 연동 (2026-10-18/19 갱신)

> **운영 반영 상태(2026-10-19 기준)**: P1 캘린더(상품 프로파일·검증 규칙)는 2026-10-18 운영 반영 완료(master `af900212`, `DEPLOYMENT.md` 「P1 캘린더 운영 반영 절차」). 이 절의 **P2-b**(런처·`GET /files/:id/external`·duplex-split 회차 키·웹훅 `revision`, 커밋 `f43cb99e`)와 **P2-c**(`sheet-map`, 커밋 `9be4c37c`)는 브랜치 `p1-calendar-2026-10-17` 에만 있고 **master 미병합·운영 미반영**이다. 운영 api·worker 는 아직 종전 동작(§15.3·§15.4 의 "종전" 항목)이다. 배포 절차는 `DEPLOYMENT.md` 「P2-b 런처(파트너 v1 `sessions`)·합성 파일 메타 조회 배포 절차(준비)」「P2-c 시트 맵 출력(worker `sheet-map` 모드) 배포 절차(준비)」, 계약은 `CONTRACT_FREEZE.md` v1.23·v1.24 헤더 노트와 §1-B·§1-D 행, 계획은 `P2_PRODUCT_MODE_PLAN_2026-10-18.md`.
>
> 이 절은 **Storige 내부(api ↔ worker) 연동과 잡 options 의 실제 값**을 기록한다. 외부 파트너가 직접 만드는 잡은 §4-2(`synthesize/external`, mode 없음 = 병합)·§12(`compose-mixed`)뿐이며, `duplex-split`·`sheet-map` 잡은 api 가 편집 완료 시 자동으로, 또는 파트너 v1 `POST /api/v1/sessions/:id/synthesize` 가 만든다.

### 15.1 합성 mode 목록 (워커 분기 기준)

워커는 큐 payload 의 `mode` 값만으로 분기한다(`apps/worker/src/processors/synthesis.processor.ts:70`, 분기 `:189-210`). `isTest` 잡은 mode 분기 앞에서 더미 산출 경로로 빠진다(`:184-186`). **`mode` 가 없거나 워커가 모르는 값이면 기존 병합(merge) 경로로 떨어진다**(`:210`) — §15.2 의 "worker 먼저 배포" 근거.

| `mode` | 만드는 곳 | 산출 | 상태 |
|---|---|---|---|
| (없음) 병합 | `POST /worker-jobs/synthesize(/external)` §4-2 | `merged` 1파일 또는 `separate`(cover·content) | 운영 |
| `compose-mixed` | `POST /worker-jobs/compose-mixed` §12 | 합본 1파일 | 운영 |
| `split` | `split-synthesize(/external)` | cover/content 2파일 | 운영 코드에 있으나 §15.4 결함으로 운영 실행 이력 0 |
| `duplex-split` | 편집 완료 자동(템플릿셋 `pdfOutputMode='duplex-split'`)·파트너 v1 synthesize | 앞/뒤 2쪽 세트 n파일(`type:'set'`) | 운영 코드에 있으나 §15.3·§15.4 결함으로 운영 실행 이력 0 |
| `spread` | 펼침면 합성 | 펼침면 1쪽 + 내지 | 운영 코드에 있으나 §15.4 결함으로 운영 실행 이력 0 |
| `sheet-map` | 편집 완료 자동(프로파일 `output.mode==='sheet-map'`)·파트너 v1 synthesize | 시트별 n파일 또는 양면 합본 1파일 | **브랜치 `9be4c37c` 전용, 운영 미반영** |

"운영 실행 이력 0" 의 근거: 2026-10-18 운영 DB 읽기 전용 실측에서 SYNTHESIZE 잡 12건 전부 `mode` NULL(`CONTRACT_FREEZE.md` §1-B `GET /files/:id/external` 행, `P2_PRODUCT_MODE_PLAN_2026-10-18.md` §7). 2026-10-18 03:40 KST 실측에서는 운영 템플릿셋 `pdf_output_mode` 가 duplex-merged 50건뿐(duplex-split 0, 세션 0)이었다(`DEPLOYMENT.md` P2-b 절).

### 15.2 mode `sheet-map` — 시트 맵 출력 (브랜치 `9be4c37c`, 운영 미반영)

계약: `CONTRACT_FREEZE.md` v1.24 헤더 노트·§1-B "worker 합성 mode `sheet-map`" 행. 타입: `packages/types/src/index.ts:1195-1229`. 워커 핸들러: `apps/worker/src/processors/synthesis.processor.ts:1824`(`handleSheetMapSynthesis`). 설계: `PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md` §6.

**잡 `options`** (api 저장값, `apps/api/src/worker-jobs/worker-jobs.service.ts:3004-3012`):

```json
{
  "mode": "sheet-map",
  "totalExpectedPages": 26,
  "sheets": [ /* SheetSpec[] — api 가 buildSheetMap(profile, pageCount) 로 계산 */ ],
  "output": "per-sheet",          // 'per-sheet' | 'merged-duplex' (= 프로파일 output.sheetFiles, 기본 per-sheet)
  "duplexFlip": "short-edge",     // 'short-edge' | 'long-edge' — 결과 매니페스트 echo 전용(산출 무영향)
  "callbackUrl": "…",             // 세션 callbackUrl 승계(없으면 키 없음)
  "revision": 1                   // 전달된 경우에만 키 생성 — §15.3
}
```

큐 payload(`SheetMapSynthesisJobData`, `worker-jobs.service.ts:3048-3058`)는 `jobId, mode, sessionId, pdfFileId, totalExpectedPages, sheets, output, duplexFlip, callbackUrl` 이며 `revision` 은 싣지 않는다. 매핑의 권위는 api(`apps/api/src/edit-sessions/sheet-map.ts` `buildSheetMap`, 순수 함수)이고 편집기가 보낸 값은 쓰지 않는다. 워커는 매핑을 그대로 따르되 불변식만 재검증한다.

**`SheetSpec` / `SheetFaceRef`** (`packages/types/src/index.ts:1195-1216`):

| 필드 | 타입 | 의미 |
|---|---|---|
| `SheetFaceRef.page` | number (0-base) | 원본 PDF 페이지 번호 |
| `SheetFaceRef.rotate?` | `0 \| 180` | 180 = 그 면을 거꾸로 인쇄(상대 +180). 생략 = 0. 운영 기본은 0(`backRotation 0` 오너 결정, `P2_PRODUCT_MODE_PLAN_2026-10-18.md` §0) — 180 은 코드 경로·골든만 |
| `SheetSpec.index` | number (0-base) | 시트 순번 = 결과 배열 순서. 워커는 `index === 배열 순번` 을 검증 |
| `SheetSpec.front` | `SheetFaceRef` | 앞면 |
| `SheetSpec.back` | `SheetFaceRef \| null` | `null` = 단면 시트(표지·에필로그·단면 상품). `undefined` 는 입력 오류 |
| `SheetSpec.sizeMm?` / `copies?` / `label?` | 매니페스트용 | 미지정 = 템플릿셋 width/height, 1매. 파트너 v1 deliverables `files[].copies?/label?` 의 원천 |
| `SheetSpec.role?` | `'post-process'` | 업로드 결합 PDF 의 후가공면. 앞/뒤 짝에서 제외된 단면 시트이며 **인쇄 시트가 아니다**. 생략 = 인쇄 시트 |

**산출 규칙** (`synthesis.processor.ts:1930-2043`, 모든 산출은 `outputs/<jobId>/`):

| `output` | 파일 | `result.outputFiles` 항목 | `outputFileUrl` |
|---|---|---|---|
| `per-sheet` | 시트마다 `set_<index>.pdf`(앞면 1쪽, 양면이면 앞·뒤 2쪽) | `{ type:'set', url, pageCount: 1\|2, setIndex: sheet.index }`(`:1994-1999`) | 첫 번째 set 의 URL |
| `merged-duplex` | 인쇄 시트(role 없음)를 **[front, back]** 순으로 이어 붙인 `sheets_duplex.pdf` 1파일. back 이 없는 시트는 front 와 같은 MediaBox 의 **빈 면을 삽입**해 양면 정렬을 유지한다(쪽수 = 인쇄 시트 수 × 2, `:2024-2043`) | `{ type:'pages', url, pageCount }` 를 `outputFiles` 맨 앞에 추가(`:2042`) | `sheets_duplex.pdf` 의 URL |
| (공통) `role:'post-process'` 시트 | `output` 과 무관하게 **항상 별도 `set_<index>.pdf`**(`:1940`) | `{ type:'set', … }` | — |

- 뒷면 회전: `rotate:180` 면은 추출한 페이지의 `/Rotate` 에 **+180 을 더한다**(상대 회전). 경량 ON 은 `qpdf --rotate=+180:<면 번호>`(`:1949-1957`, `apps/worker/src/utils/pdf-merge-qpdf.ts:73-80`), OFF 는 pdf-lib `setRotation((angle+180)%360)`(`:1965`).
- 무결성: 시트당 면 수(단면 1·양면 2)와 추출 쪽수가 다르면 `SPLIT_VERIFICATION_FAILED`(`:1983-1989`), 합본 쪽수 ≠ 인쇄 시트 × 2 도 같은 코드(`:2035-2040`).
- `OutputFile.type` 값·웹훅 본문(`outputFiles`)·admin 잡 라벨·기존 5 mode 골든은 불변(v1.24 행).

**결과** (`:2047-2053`, `packages/types/src/index.ts:1278-1286`): `result = { success:true, outputFileUrl, outputFiles, totalPages(원본 PDF 쪽수), sheetMap: { output, duplexFlip, sheets } }`. `sheetMap` echo 는 매니페스트(`.synthesis-complete.json`)·잡 `result` 에만 실리고 웹훅 본문에는 없다. 파트너 v1 `GET /api/v1/sessions/:id/deliverables` 의 `sheets?: SheetSpec[]` 는 최신 잡이 sheet-map 일 때만 api 가 싣는다(v1.24 §1-D).

**입력 오류 — 비재시도(첫 시도에 `FAILED`)**: 다운로드 전에 `assertSheetMapJobInput`(`apps/worker/src/processors/sheet-map-input.ts`, `synthesis.processor.ts:1846`)이 검사한다.

| 조건 | `errorCode` |
|---|---|
| `sheets` 비어 있음 · `output` 이 `per-sheet\|merged-duplex` 밖 · `duplexFlip` 이 `short-edge\|long-edge` 밖 · `rotate` 가 0·180 밖 | `INVALID_OUTPUT_OPTIONS` |
| `totalExpectedPages` < 1 · `sheets[i].index ≠ i` · `page` 범위 밖(0..N-1)·중복 · `back` 이 `undefined` · 참조 페이지 수 ≠ `totalExpectedPages` | `PAGE_COUNT_MISMATCH` |
| 실제 PDF 쪽수 ≠ `totalExpectedPages`(`:1918-1922`) | `PAGE_COUNT_MISMATCH` |

파일 검증은 duplex-split 과 같은 계약이다(`:1849-1861`): 메타 없음 `FILE_NOT_FOUND`, `metadata.generatedBy !== 'editor'` → `PDF_NOT_FROM_EDITOR`, `metadata.editSessionId !== sessionId` → `SESSION_FILE_MISMATCH`. 다운로드 실패 `FILE_DOWNLOAD_FAILED`, 손상 `PDF_LOAD_FAILED`.

**경량 경로 동일성**: `WORKER_LIGHTWEIGHT_SYNTHESIS` ON(qpdf 파일 기반·상수 메모리)과 OFF(pdf-lib 메모리 적재) 두 경로의 결과(`outputFiles`·`outputFileUrl`·`totalPages`·`sheetMap`)가 deep-equal 이 되도록 골든으로 고정돼 있다(`apps/worker/src/processors/synthesis.processor.sheet-map.spec.ts:158` "sheet-map 골든 행렬" — same-sheet/offset-next × rotate 0/180 × ON/OFF, post-process·입력 오류 포함; `P2_PRODUCT_MODE_PLAN_2026-10-18.md` §1 P2-c "골든 22").

**발행 주체** (`createSheetMapJob` 호출처는 아래 2곳):

1. **api 편집 완료 자동 발행** — `apps/api/src/edit-sessions/edit-sessions.service.ts:1816-1847`. 킬스위치 `SHEET_MAP_OUTPUT_ENABLED` 가 ON 이고 상품 프로파일(템플릿셋 우선, 없으면 세션 스냅샷) `output.mode==='sheet-map'` 이면 `buildSheetMap(profile, 세션 페이지 수)` → `createSheetMapJob`. 이때 템플릿셋 `pdfOutputMode`(duplex-split 등)는 **무시**되고 duplex-split 잡은 만들지 않는다. `coverFileId` 가 없으면 스킵, 매핑·잡 생성 실패는 완료를 막지 않는다(로그만). requestId `sheet-map-r<revision>`(`:155-157`), `siteId` 세션 승계, `revision` 전달(`:1842`).
   - 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`(`apps/api/src/config/feature-flags.ts:278-292`): 미설정 = ON, 앞뒤 공백 제거·대소문자 무시 **`off` 일 때만 OFF**. OFF 면 프로파일을 보지 않고 종전 `pdfOutputMode` 경로로 떨어진다. `[FLAGS] api` 줄의 17번째 키(`FLAGS_EXPECTED_API` 에 `SHEET_MAP_OUTPUT_ENABLED=true` 추가 필요 — `DEPLOYMENT.md` P2-c 절).
2. **파트너 v1 재합성** `POST /api/v1/sessions/:id/synthesize` — `apps/api/src/partner-sessions/partner-sessions.service.ts:462`(작업 트리; 커밋 `9be4c37c` 기준 `:405-420`): 킬스위치 ON + 프로파일 `sheet-map` → `requestSheetMapResynthesis`(`edit-sessions.service.ts:1988-2033`; `metadata.revision` +1 저장 뒤 그 회차로 requestId `sheet-map-r<revision>`·`options.revision`). 아니면 템플릿셋 `pdfOutputMode='duplex-split'` → duplex-split 재합성(§15.3), 그 밖은 `422 ERR_OUTPUT_MODE_UNSUPPORTED`. 최신 합성 잡이 PENDING/PROCESSING 이면 새 잡 없이 그 `jobId`·현재 `revision` 을 돌려준다(`:455-457` — 작업 트리; `9be4c37c` 기준 `:431-433`).

**배포 순서 — worker 먼저**: 미배포 워커는 `sheet-map` 을 모르는 mode 로 보고 §15.1 의 병합 경로로 처리한다(`synthesis.processor.ts:210`). 따라서 worker → api → nginx 순으로 올리고, 롤백은 `.env` `SHEET_MAP_OUTPUT_ENABLED=off` → api 재생성(발행 중지·duplex-split 폴스루) → 큐 `bull:pdf-synthesis:wait` 0 확인 뒤 worker 롤백 태그(`DEPLOYMENT.md` P2-c 절). 로컬 실측(2026-10-19 00:03 KST, 탁상 베이직 프로파일): 완료 → sheet-map 잡 13시트 per-sheet → `set_0..12.pdf` 각 2쪽 → deliverables `ready`·`sheets` 13 → synthesize r2 → merged-duplex 로 r3 → `sheets_duplex.pdf` 26쪽. 운영 템플릿셋에는 아직 sheet-map 프로파일 세트가 없어 배포 직후 동작 변화는 0 이다(같은 절).

**P2-d 사진인화 연동 (2026-10-19/20, 같은 브랜치 작업 트리 — 커밋 `9be4c37c` 위 미커밋·master 미병합·운영 미반영)**: photo-print 세트(`productProfile.kind 'photo-print'`, 계약 `CONTRACT_FREEZE.md` v1.25 헤더 노트·§1-D 행 4건)에서는 api 가 `buildSheetMap` 결과에 세션 `metadata.items`(편집기 기록 `PhotoItem[]`)의 매수를 주입한다 — `applyPhotoItemsToSheets(buildSheetMap(profile, pageCount), readSessionPhotoItems(profile, session.metadata, pageCount))`(순수 함수, `apps/api/src/edit-sessions/photo-items.ts:66-78`·`:46-56`). `sheet.front.page === item.canvasIndex` 인 시트에만 `copies: item.copies`·`label: '사진 N'`(N = `index`+1, `:16-18`)을 넣고, `role:'post-process'` 시트와 맞는 항목이 없는 시트는 그대로 둔다. 항목 수 상한은 `min(upload.maxPhotos, 세션 캔버스 수 기준 사진 수)`(`resolvePhotoItemLimit` `:27-37`, chemical N / digital ceil(N/2)). 호출처는 위 발행 주체 2곳과 같다 — 편집 완료 자동 발행(`edit-sessions.service.ts:1973-1979`)·파트너 v1 재합성(`:2171-2175`). 주입된 `sheets` 는 종전처럼 잡 `options.sheets` 에 저장되고(`worker-jobs.service.ts:3004-3012`) 파트너 deliverables 가 `sheetMapSheetsOf(job)` 로 읽어 `files[].copies/label` 로 노출한다(`partner-sessions.service.ts:512-517`·`:329-363`, v1.24 규약 그대로). **워커·`SheetSpec` 타입·큐 payload 는 바뀌지 않는다** — 작업 트리에 `apps/worker` diff 가 없고, `packages/types/src/index.ts:1200-1216` 의 `copies?/label?` 는 종전 매니페스트용 필드이며 워커는 두 필드를 읽지 않는다(`synthesis.processor.ts` 에 참조 없음, `result.sheetMap.sheets` echo 로 되돌아올 뿐). photo-print 가 아닌 세트(NULL·sheet·calendar)와 `metadata.items` 없는 세션은 빈 배열 → 입력 시트 배열을 그대로 반환(바이트 동일). 단위 테스트 `photo-items.spec.ts`·`partner-sessions.service.spec.ts`·`edit-sessions.service.spec.ts` 로 고정했고, 결함 수정 후 로컬 e2e(사진인화 세트 완료 → sheet-map 잡 → deliverables `files[].copies/label`)는 2026-10-20 13:50~14:05 KST 재실측에서 통과했다 — 인쇄 ① 런처 세션: 검증 `warnings: []`, 자동 sheet-map 잡 `sheet-map-r1` COMPLETED, `SheetSpec.copies/label` 5/'사진 1'·2/'사진 2', deliverables `files[].copies/label` 동일, synthesize r2(상세 P2 계획 §7.1 '재실측 결과').
- **시트 맵 산출 실패 기록(워커 무관)**: 종전에는 `buildSheetMap`(`SheetMapError`, 예: digital 세트 홀수 캔버스 `PAGE_COUNT_MISMATCH`)·`createSheetMapJob` 실패를 로그만 남기고 삼켜 deliverables 가 `complete`·시트 없음으로 보였다. 이제 두 발행 경로 모두 실패를 서버 소유 키 `metadata.production.sheetMap { error, message, at }` 에 기록하고(`recordSheetMapFailure` `edit-sessions.service.ts:318-330`, 레코드 타입 `:206-212`; 자동 발행 `:1999` 는 완료 유지, 재합성 `:2195-2196` 은 기록 뒤 그대로 올림), 다음 발행이 성공하면 키를 지운다(`clearSheetMapFailure` `:333-340`, `production` 이 비면 그 키도 제거 `:225-240`). 파트너 `GET /api/v1/sessions/:id/deliverables` 는 완료 세션에 이 기록이 있고 그보다 뒤(`createdAt ≥ at`)에 만들어진 파트너 가시 합성 잡이 없으면 `status:'failed'` + `errorCode/errorDetail` 로 노출한다(`resolveSheetMapFailure` `partner-sessions.service.ts:493-510`, 적용 `:267`·`:277`·`:288-291`; 더 새로운 잡이 있으면 잡 상태 우선). 실패한 회차는 잡이 만들어지지 않으므로 워커는 관여하지 않는다(새 mode·새 워커 `errorCode`·새 env·FLAGS 키 없음).
- **행 번호 주의**: P2-d 편집으로 `edit-sessions.service.ts` 의 행이 이동했다. 이 절·§15.3 의 종전 행 참조(`:134-157`·`:1816-1847`·`:1842`·`:1871-1887`·`:1959-1976`·`:1988-2033`)는 커밋 `9be4c37c` 기준이며, 작업 트리 기준 현재 위치는 `sessionRevisionOf` `:136`·`DUPLEX_SPLIT_AUTO_REQUEST_ID` `:161`·`duplexSplitRevisionRequestId` `:163`·`sheetMapRevisionRequestId` `:172`·자동 sheet-map 발행 `:1958-2003`(`revision` 전달 `:1990`)·자동 duplex-split `:2021`·`requestDuplexSplitResynthesis` `:2112-2130`·`requestSheetMapResynthesis` `:2141-2198` 이다. `partner-sessions.service.ts` 도 P2-d 로 이동했다(synthesize 게이트 `:455-462`). `worker-jobs.service.ts`·워커 파일은 변경이 없어 행 참조가 그대로다.

### 15.3 `duplex-split` 자동 잡의 회차 키와 `revision` (브랜치 `f43cb99e`, 운영 미반영)

- **결함(종전·운영 현재)**: 편집 완료 시 `applyPdfOutputMode` 가 duplex-split 잡 request_id 로 `duplex-split-<세션uuid>-<파일uuid>`(86자)를 넣었는데 `worker_jobs.request_id` 는 `VARCHAR(36)` 이라 strict 모드에서 "Data too long" 으로 **잡 생성이 조용히 실패**했다(세션 완료는 유지, 분리 잡이 만들어진 적 없음). `P2_PRODUCT_MODE_PLAN_2026-10-18.md` §7, `edit-sessions.service.ts:1871-1876` 주석.
- **수정(브랜치)**: 자동 잡 requestId = **`duplex-split-r<revision>`**(`duplexSplitRevisionRequestId`, `edit-sessions.service.ts:147-149`, 호출 `:1877`). `revision` 은 세션 `metadata.revision`(0 이상 정수가 아니면 0, `sessionRevisionOf` `:134-138`)이며 `complete()` 마다 1 오른다 — 재완료 = 새 회차 잡(FAILED 잡에 멱등 히트해 복구가 막히는 일을 피한다). 유일성은 UNIQUE(`session_id, pdf_file_id, request_id`). 고정 태그 상수 `DUPLEX_SPLIT_AUTO_REQUEST_ID='duplex-split'`(`:145`)는 남아 있으나 발행 경로에서는 쓰지 않는다. `CONTRACT_FREEZE.md` §1-B `GET /files/:id/external` 행(v1.23 보강)이 이 키를 "고정 태그 `duplex-split`" 으로 적던 불일치는 **v1.25(2026-10-19~20) 에서 회차 키 `duplex-split-r<revision>` 로 보정됐다**(상수는 정의만 남음 — 같은 행 보정 문구·v1.25 헤더 노트 ⓑ). 코드는 종전과 같은 회차 키다(2026-10-18 보안 리뷰 #6 반영, 같은 계획 §5).
- 런처 재합성 `requestDuplexSplitResynthesis`(`:1959-1976`)도 같은 형식·같은 카운터를 쓰고, sheet-map 은 접두사만 다른 `sheet-map-r<revision>` 이라 회차 간·모드 간 충돌이 없다(`:152-157`).
- **잡 `options.revision`**: `createDuplexSplitJob`·`createSheetMapJob` 은 `dto.revision` 이 숫자일 때만 `options` 에 키를 만든다(`worker-jobs.service.ts:2849-2856`, `:3004-3012`). 그 밖의 잡 options 는 바이트 동일. `siteId` 는 세션 사이트를 승계한다(미전달 = NULL, 종전과 같다).
- **웹훅 `synthesis.*` payload `revision?`**: `options.revision` 이 숫자인 잡에만 실린다(`worker-jobs.service.ts:4089-4091`). 코드상 해당 잡은 ① 파트너 v1 synthesize 재합성 잡(duplex-split·sheet-map) ② 편집 완료 자동 **sheet-map** 잡(`edit-sessions.service.ts:1842` 에서 `revision` 전달)이다. 편집 완료 자동 **duplex-split** 잡은 `revision` 을 전달하지 않아 키가 없다(`:1871-1887`). `CONTRACT_FREEZE.md` §1-D `revision?` 행(v1.23)이 "런처 synthesize 잡에만" 으로 기술돼 있던 불일치는 **v1.25 에서 보정됐다**(런처 synthesize 잡 + 편집 완료 자동 sheet-map 잡, 자동 duplex-split 잡은 키 없음 — 같은 행·v1.25 헤더 노트 ⓑ). 자동 sheet-map 잡은 v1.24(운영 미반영)에서 추가된 경로다. 수신부는 키가 없을 때와 있을 때를 모두 처리한다(없음 = 미포함, `null` 아님).

### 15.4 워커의 파일 조회 — 메타 `GET /files/:id/external` + 바이트 `api://<fileId>` (브랜치 `f43cb99e`, 운영 미반영)

| 단계 | 경로 | 인증 | 구현 |
|---|---|---|---|
| 메타 | `GET /api/files/:id/external` | `X-API-Key: <WORKER_API_KEY>`(`@Public` + `ApiKeyGuard`) | api `apps/api/src/files/files.controller.ts:767-782`, 워커 `synthesis.processor.ts:2212-2228`(timeout 30초, 404 → `null` → `FILE_NOT_FOUND`) |
| 바이트 | `api://<fileId>` → `GET /api/files/:id/download/external`(`files.controller.ts:735`) | 같은 키 | 경량 ON 스트리밍 `apps/worker/src/utils/stream-download.ts:72-90`, OFF 버퍼 `apps/worker/src/services/api-file-download.ts:10-24`. local·S3 라우팅은 api 가 담당 |

- 메타 응답은 `GET /files/:id` 와 같은 `FileResponseDto` 이며 **`filePath`(서버 절대경로·S3 키)는 없다**(SEC-008, `apps/api/src/files/dto/file-response.dto.ts:17`). 워커가 읽는 필드는 `id`·`metadata.generatedBy`·`metadata.editSessionId` 뿐이고(`synthesis.processor.ts:135-146`) 바이트는 항상 `api://` 로 받는다.
- 사이트 대조 규칙은 `download/external` 과 동일: worker 역할 바이패스 · `site_id` NULL = 레거시 허용 · 타 사이트 404. soft-deleted·미완 업로드 처리도 `GET /files/:id` 와 같다. 사이트 키 호출자도 선택적으로 쓸 수 있다(`CONTRACT_FREEZE.md` §1-B 행, 파트너 Swagger 허용 목록 `apps/api/src/config/swagger-partner-routes.ts:30`).
- **종전 결함(운영 현재)**: `split`·`duplex-split`·`spread` 핸들러의 `getFileById` 가 **JWT 전용 `GET /files/:id` 를 `X-API-Key` 로 호출**해 항상 401 → 세 mode 잡이 `INTERNAL_ERROR` 로 실패했다. 2026-10-18 운영 DB 읽기 전용 실측에서 SYNTHESIZE 잡 12건 전부 `mode` NULL 이라 세 분기는 운영에서 실행된 적이 없어 노출되지 않았다(`CONTRACT_FREEZE.md` §1-B 행, `P2_PRODUCT_MODE_PLAN_2026-10-18.md` §7). 운영 워커는 배포 전까지 종전 경로이고 운영 api 에는 `GET /files/:id/external` 이 없다(404).

### 15.5 워커 환경 변수 (`apps/worker/.env.example` 기준)

| 변수 | 위치 | 의미 |
|---|---|---|
| `API_BASE_URL` | `apps/worker/.env.example:29`(`http://localhost:4000/api`), compose `docker-compose.yml:193`(`http://api:4000/api`) | 잡 상태 보고·메타 조회·`api://` 다운로드의 api 베이스. 코드 기본값 `http://localhost:4000/api`(`synthesis.processor.ts:151`) |
| `WORKER_API_KEY` | `.env.example:26-30`, compose `:194` | api 의 `WORKER_API_KEY` 와 **같은 값**(역할 `worker`)이어야 하고 동시에 `sites` 테이블의 어느 사이트 `worker_auth_code` 와도 일치해야 한다 — `ApiKeyGuard` 가 사이트 매칭 뒤 역할을 판정한다(`apps/api/src/auth/guards/api-key.guard.ts:42-46`). 비면 상태 보고가 401 로 실패해 잡이 PENDING 으로 남는다 |
| `STORAGE_PATH` | `.env.example:17`, compose `:190`(`/app/storage`) | 임시 작업 디렉터리(`temp_<jobId>`). 로컬 단독 실행은 api 의 storage 절대 경로(`apps/worker/.env.development.example:17-18`) |
| `OUTPUTS_PATH` | `.env.example` 에 없음 — 코드 기본값 `/app/storage/outputs`(`synthesis.processor.ts:155`) | 합성 산출 디렉터리(`outputs/<jobId>/set_<i>.pdf` 등). 컨테이너 밖 단독 실행에서는 명시 설정이 필요하다 |
| `WORKER_LIGHTWEIGHT_SYNTHESIS` | `.env.example` 주석(규칙 B — 소문자 `true` 일 때만 ON) | 합성·sheet-map 의 qpdf 경량 경로. ON/OFF 결과 동일(§15.2 골든) |
| `OUTPUT_SIGN_SECRET` | **api 측** — `apps/api/.env.example:40-43`, compose `:52`(nginx `secure-link-secret.conf` 와 동일값) | 산출물 서명 URL. 미설정이면 `GET /api/worker-jobs/external/:id/output-url` 이 `503 SIGNED_URL_NOT_CONFIGURED`(fail-closed, `worker-jobs.service.ts:3338-3348`)이고 런처 deliverables 의 `auth:'signed'` 파일도 503 (`P2_PRODUCT_MODE_PLAN_2026-10-18.md` §7). 워커 env 가 아니다 |

로컬 e2e 메모(같은 계획 §7): 사이트 editor 코드가 worker 코드·`WORKER_API_KEY` 와 같으면 모든 호출이 `worker` 역할이 되어 런처가 403 → 로컬 사이트는 editor 코드를 분리한다. worker 단독 실행에도 `WORKER_API_KEY` 주입이 필요하다.
