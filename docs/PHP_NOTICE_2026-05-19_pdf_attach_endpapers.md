# PHP 연동 통보 — 인쇄 워크플로우 v1 (PDF 첨부 / 면지 / 게스트 / compose-mixed / 마이페이지)

> **수신**: bookmoa PHP 개발팀 + 외부 서비스 어댑터 개발팀 (Codex / Cursor 등)
> **발신**: Storige 운영팀
> **버전**: v1.0 (2026-05-19)
> **상위 가이드**: [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md), [`PLATFORM_INTEGRATION_v1.md`](./PLATFORM_INTEGRATION_v1.md), [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md)
> **운영 적용**: 2026-05-19 (Phase 1~6 코드 + DB + 배포 완료. Phase 7~8 문서 정리.)

---

## 0. 가장 짧은 요약 (TL;DR)

> 본 v1 변경은 **기존 PHP 사이트 영향 0**. PHP 측은 변경 사항 없습니다.
> 새 기능 (PDF 내지 첨부 / 면지 / 게스트 24h / 레더 커버 / compose-mixed 합본 / 마이페이지) 은
> bookmoa-mobile 같은 신규 외부 사이트가 선택적으로 사용. PHP 가 사용하고 싶으면 §4 부터 참고.

### 5가지 결정사항 (사용자 확정 2026-05-19)

| # | 항목 | 결정 |
|---|---|---|
| 3-1 | 게스트 작업 보존 | **24시간 후 자동 삭제** (DB EVENT) |
| 3-2 | PDF 페이지수 < 내지 수 | **고객 선택 모달** (자동 확장) |
| 3-3 | PDF 첨부 ↔ 편집 | **배타** (둘 다 동시 사용 금지) |
| 3-4 | 워커 검증 실패 | **첨부 자체 거부** (강제 진행 없음) |
| 3-5 | 레더 커버 미리보기 | **별도 필드** `coverPreviewImage` (storage URL) |
| 3-6 | 게스트 회원 전환 | **저장(편집완료) 시점만** |

---

## 1. 신규 DB 필드 (PHP 영향 0 — read-only)

PHP 가 직접 read 할 일은 없지만, 운영 DB 스키마 변경 통보용.

### 1.1 `template_sets` (관리자 UI)

| 컬럼 | 타입 | default | 비고 |
|---|---|---|---|
| `endpaper_config` | JSON | NULL | `{frontCount, backCount, frontEditable, backEditable}`. NULL = 면지 없음 (legacy 동작) |
| `cover_editable` | TINYINT(1) | 1 | 기본 true. 레더 커버 / 화보집 = 0 |
| `cover_preview_image` | VARCHAR(500) | NULL | 레더 커버 미리보기 storage URL (`coverEditable=false` 일 때만 의미) |

### 1.2 `file_edit_sessions` (편집 세션)

| 컬럼 | 타입 | default | 비고 |
|---|---|---|---|
| `content_pdf_file_id` | VARCHAR(36) | NULL | 고객 첨부 내지 PDF file_id |
| `content_pdf_page_count` | INT | NULL | PDF 페이지수 (자동 확장 계산용) |
| `content_pdf_validation_result` | JSON | NULL | 워커 검증 결과 캐시 (issues, warnings, metadata) |
| `guest_token` | VARCHAR(64) | NULL | 게스트 식별자 (인덱스됨) |
| `guest_expires_at` | TIMESTAMP | NULL | NOW + 24h. EVENT `evt_purge_expired_guest_sessions` 가 1h 주기 DELETE |

### 1.3 `templates.type` enum

기존 5종 (`wing, cover, spine, page, spread`) 에 **`endpaper`** 추가 (varchar(20) 컬럼, 자유 확장).

### 1.4 회귀 안전성

- 모든 신규 컬럼 `NULL` / default 값 → 기존 데이터/PHP 호출 동작 변경 없음.
- 마이그레이션 SQL: `apps/api/migrations/20260519_v1_phase2_workflow_schema.sql` (idempotent, IF NOT EXISTS).
- EVENT `evt_purge_expired_guest_sessions` 는 `guest_token IS NOT NULL` 인 세션만 삭제 — PHP 가 만든 회원 세션은 영향 없음.

---

## 2. 신규/변경 REST endpoint 요약

> 모든 신규 endpoint 는 추가 only. 기존 endpoint 는 **삭제·변경 없음**.

### 2.1 새로 추가된 endpoint

| 메서드 | 경로 | 인증 | 용도 | PHP 사용? |
|---|---|---|---|---|
| `POST` | `/api/storage/upload-public` | Public + MIME 가드 | 게스트 파일 업로드 (편집기에서) | 선택 |
| `POST` | `/api/edit-sessions/guest` | Public | 게스트 세션 생성 + token 발급 | 선택 |
| `PATCH` | `/api/edit-sessions/guest/:id?guestToken=...` | Public + 토큰 검증 | 게스트 세션 업데이트 | 선택 |
| `POST` | `/api/edit-sessions/guest/migrate` | Bearer JWT | 게스트 → 회원 마이그레이션 | bookmoa-mobile 전용 |
| `GET` | `/api/edit-sessions/my` | Bearer JWT | 본인 세션 목록 (마이페이지) | bookmoa-mobile 전용 |
| `POST` | `/api/worker-jobs/compose-mixed` | Public | 표지+면지+내지+면지 합본 잡 | 선택 (PHP 가 직접 호출 가능) |

### 2.2 기존 endpoint (변경 없음 — PHP 가 사용 중)

| 메서드 | 경로 | 인증 | 변경 |
|---|---|---|---|
| `POST` | `/api/auth/shop-session` | X-API-Key | ✅ 무변경 |
| `GET` | `/api/product-template-sets/by-product` | X-API-Key | ✅ 무변경 |
| `POST` | `/api/worker-jobs/validate/external` | X-API-Key | ✅ 무변경 |
| `POST` | `/api/worker-jobs/check-mergeable/external` | X-API-Key | ✅ 무변경 |
| `POST` | `/api/worker-jobs/synthesize/external` | X-API-Key | ✅ 무변경 |
| `GET` | `/api/edit-sessions/external?orderSeqno=` | X-API-Key | ✅ 무변경 |
| Webhook | `synthesis.completed` / `validation.completed/fixable/failed` | Base64 서명 | ✅ 무변경 (compose-mixed 시 `result.capability` 추가 — additive) |

---

## 3. 신규 endpoint 상세 스펙

### 3.1 `POST /api/edit-sessions/guest`

게스트 편집 세션 생성. JWT/API Key 불필요.

**요청**
```http
POST /api/edit-sessions/guest HTTP/1.1
Content-Type: application/json

{
  "mode": "both",
  "templateSetId": "ts-001",
  "asGuest": true,
  "canvasData": null,
  "metadata": {}
}
```

**응답 (HTTP 201)**
```json
{
  "id": "uuid-session",
  "orderSeqno": 0,
  "memberSeqno": 0,
  "status": "draft",
  "mode": "both",
  "templateSetId": "ts-001",
  "guestToken": "uuid-token",
  "guestExpiresAt": "2026-05-20T09:15:30.000Z",
  "contentPdfFileId": null,
  "contentPdfPageCount": null,
  "contentPdfValidationResult": null,
  "createdAt": "2026-05-19T09:15:30.000Z",
  "updatedAt": "2026-05-19T09:15:30.000Z"
}
```

클라이언트는 `guestToken` 을 sessionStorage 에 저장 후 이후 모든 update 호출에 동봉.

### 3.2 `PATCH /api/edit-sessions/guest/:id?guestToken=<token>`

게스트 세션 업데이트 (캔버스 / PDF 첨부 등). 토큰 검증.

**요청**
```http
PATCH /api/edit-sessions/guest/<sessionId>?guestToken=<token> HTTP/1.1
Content-Type: application/json

{
  "contentPdfFileId": "uuid-file",
  "contentPdfPageCount": 24,
  "contentPdfValidationResult": { "status": "completed", "issues": [], "pageCount": 24 }
}
```

**응답 (HTTP 200)**: `EditSessionResponseDto` (위 §3.1 형식).

**에러**:
- `403 NOT_A_GUEST_SESSION` — 회원 세션을 게스트 endpoint 로 호출
- `403 GUEST_SESSION_EXPIRED` — 24h 만료
- `403 GUEST_TOKEN_MISMATCH` — 토큰 불일치
- `400 PDF_ATTACHED_EXCLUSIVE` — PDF 첨부 상태에서 canvasData 동시 수정 시 (결정 3-3)

### 3.3 `POST /api/edit-sessions/guest/migrate`

게스트 → 회원 마이그레이션. JWT 인증 필수.

**요청**
```http
POST /api/edit-sessions/guest/migrate HTTP/1.1
Authorization: Bearer <jwt>
Content-Type: application/json

{ "guestToken": "uuid-token" }
```

**응답 (HTTP 200)**
```json
{
  "migratedCount": 3,
  "sessionIds": ["uuid-1", "uuid-2", "uuid-3"]
}
```

**보안**:
- JWT 의 `userId` → 마이그레이션될 세션의 `memberSeqno` 로 채움
- `guestToken` 일치 세션만 흡수 (타인 세션 흡수 불가)
- 흡수 후 `guestToken` / `guestExpiresAt` NULL — EVENT 가 더 이상 삭제 안 함

**에러**:
- `403 AUTH_REQUIRED` — JWT 없음
- `400 GUEST_TOKEN_REQUIRED` — guestToken 누락

### 3.4 `GET /api/edit-sessions/my`

로그인 사용자 본인 세션 목록 (마이페이지). JWT 인증 필수.

**요청**
```http
GET /api/edit-sessions/my HTTP/1.1
Authorization: Bearer <jwt>
```

**응답 (HTTP 200)**
```json
{
  "sessions": [ /* EditSessionResponseDto[] */ ],
  "total": 5
}
```

- 본인 `memberSeqno` 일치 + `guestToken IS NULL` 세션만 반환
- 최근 업데이트순, 200건 limit

### 3.5 `POST /api/worker-jobs/compose-mixed`

표지+면지+내지+면지 합본 PDF 생성 (인쇄용). 출력 순서:
```
[표지, 앞면지 1..N, 내지 PDF, 뒷면지 1..K]
```

**요청**
```http
POST /api/worker-jobs/compose-mixed HTTP/1.1
Content-Type: application/json

{
  "editSessionId": "uuid-session",
  "coverUrl": "/storage/uploads/cover.pdf",
  "coverEditable": true,
  "coverWidthMm": 210,
  "coverHeightMm": 297,
  "frontEndpaperUrls": [
    "/storage/uploads/front1.pdf",
    null
  ],
  "backEndpaperUrls": [null],
  "contentPdfUrl": "/storage/uploads/content.pdf",
  "contentWidthMm": 210,
  "contentHeightMm": 297,
  "callbackUrl": "https://your-domain.com/api/storige/webhook",
  "orderId": "ORD-2026-99999"
}
```

**필드 규칙**:
- `coverEditable=false` → `coverUrl` 무시, **빈 표지 페이지 worker 생성** (레더 커버, 결정 3-5)
- `frontEndpaperUrls`/`backEndpaperUrls` 의 `null` 원소 → **빈 면지 페이지** worker 생성
- mm → PDF point (1mm = 2.834645669pt) 변환은 worker 가 자동

**응답 (HTTP 201)**: `WorkerJob` (jobId 포함). 합성은 비동기 — webhook 으로 결과 수신.

**Webhook (`synthesis.completed`)**:
```json
{
  "event": "synthesis.completed",
  "jobId": "uuid-job",
  "orderId": "ORD-2026-99999",
  "status": "completed",
  "outputFileUrl": "/storage/outputs/<jobId>/merged.pdf",
  "outputFormat": "merged",
  "timestamp": "2026-05-19T09:25:00.000Z",
  "result": {
    "capability": "compose-mixed",
    "outputFileUrl": "/storage/outputs/<jobId>/merged.pdf",
    "totalPages": 28,
    "success": true
  }
}
```

서명 헤더 `X-Storige-Signature` 는 기존 Base64 방식 그대로 (§ webhook).

---

## 4. 게스트 흐름 (결정 3-1, 3-6)

```
[비로그인 사용자 진입]
  ↓
[editor 가 ensureGuestSession() 호출]
  ↓
POST /api/edit-sessions/guest { mode, templateSetId, asGuest: true }
  ↓
{ id, guestToken, guestExpiresAt: NOW + 24h }
  ↓
[편집 작업 — PATCH /api/edit-sessions/guest/:id?guestToken=... 로 자동 저장]
  ↓
[24h 무동작 → EVENT evt_purge_expired_guest_sessions 가 DELETE]
  또는
[사용자가 편집완료 클릭]
  ↓
[GuestAuthPromptModal — 로그인/회원가입 유도]
  ↓
[로그인 완료]
  ↓
POST /api/edit-sessions/guest/migrate { guestToken } (Bearer JWT)
  ↓
{ migratedCount, sessionIds[] } — guestToken NULL 됨, 회원 영구 보관
```

### 4.1 외부 사이트(iframe 임베드)가 처리할 부분

editor 가 부모 페이지로 `editor.needAuth` postMessage 발신:
```js
{
  source: 'storige-editor',
  event: 'editor.needAuth',
  payload: {
    guestToken: 'uuid-token',
    reason: 'complete_save',
    ts: 1779169530123
  }
}
```

부모 페이지 (예: bookmoa-mobile / PHP 페이지) 처리 예시:
```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://editor.papascompany.co.kr') return;
  const msg = e.data;
  if (msg?.source !== 'storige-editor') return;

  if (msg.event === 'editor.needAuth') {
    const guestToken = msg.payload.guestToken;
    // 1) 로그인 페이지로 이동 (또는 로그인 모달)
    // 2) 로그인 완료 후 storige API 에 migrate 호출:
    //    POST /api/edit-sessions/guest/migrate
    //    Authorization: Bearer <획득한 JWT>
    //    Body: { guestToken }
    // 3) 응답의 sessionIds[] 로 마이페이지에서 작업 확인
  }
});
```

---

## 5. PDF 내지 첨부 (결정 3-3, 3-4)

### 5.1 editor 내부 흐름 (PHP 영향 없음)

editor 가 `ContentPdfAttachModal` 내부에서 다음을 호출:
1. `POST /api/storage/upload-public?category=uploads` (multipart, MIME PDF/이미지)
2. `POST /api/worker-jobs/validate` (또는 external) — 검증 잡 생성
3. 폴링 30s — `GET /api/worker-jobs/:jobId`
4. 결과:
   - `status=COMPLETED` → 통과
   - `status=FIXABLE` → 자동 보정 가능
   - `status=FAILED` → **첨부 거부** (결정 3-4)
5. 통과 시: PDF 페이지수 > 현재 내지 수 + `canAddPage=true` → **자동 확장 선택 모달** (결정 3-2)
6. `PATCH /api/edit-sessions/guest/:id` 또는 `/api/edit-sessions/:id` 에 `contentPdfFileId` 저장

### 5.2 결정 3-3 배타 가드

API 가 BadRequest 로 거부:
```json
{
  "code": "PDF_ATTACHED_EXCLUSIVE",
  "message": "내지 PDF 첨부 상태에서는 편집 캔버스를 변경할 수 없습니다. PDF 를 먼저 제거하세요."
}
```

→ PHP 페이지에서는 editor postMessage 만 감지하면 됨. 별도 처리 불필요.

---

## 6. compose-mixed 사용 결정 가이드

| 상황 | 사용할 endpoint |
|---|---|
| 기존 PHP — 표지+내지 2개 PDF 합본 | `POST /worker-jobs/synthesize/external` (그대로) |
| 신규 — 표지+면지+내지 합본 | `POST /worker-jobs/compose-mixed` (선택) |
| 신규 — 레더 커버 (빈 표지) + 면지 + 내지 | `POST /worker-jobs/compose-mixed` (`coverEditable=false`) |

→ PHP 가 기존 흐름 유지하면 작업 0. 면지/레더커버를 PHP 측에서 지원하고 싶으면 compose-mixed 로 전환.

---

## 7. Webhook 변경 (additive only)

기존 webhook payload 는 모두 그대로. 다음 필드가 **추가** (additive):

| 필드 | 위치 | 값 | 의미 |
|---|---|---|---|
| `result.capability` | `synthesis.completed` | `'compose-mixed'` | compose-mixed 잡의 webhook 임을 식별 |
| `result.totalPages` | `synthesis.completed` | number | 합본 PDF 총 페이지수 |

기존 PHP webhook 핸들러는 `capability` 필드 무시 가능 (있어도 동작 변경 없음).

---

## 8. bookmoa-mobile 전용 어댑터 (PHP 해당 없음)

bookmoa-mobile (Next.js + Vercel) 은 별도 어댑터로 storige API 호출:
- `GET /api/storige/migrate-guest` (Vercel function) — JWT 발급 + storige migrate 호출
- `GET /api/storige/my-works` (Vercel function) — storige `GET /edit-sessions/my` 프록시
- 부모 사이트가 `editor.needAuth` postMessage 처리

→ PHP 는 무관. bookmoa-mobile 어댑터는 Codex 영역.

---

## 9. 회귀 체크리스트 (PHP 측 검증)

배포 후 PHP 측에서 다음을 확인:

- [ ] 기존 `POST /auth/shop-session` 호출 → 200 + `accessToken`
- [ ] 기존 `POST /worker-jobs/validate/external` → 201 + jobId
- [ ] 기존 `POST /worker-jobs/synthesize/external` → 201 + jobId
- [ ] 기존 `synthesis.completed` webhook 수신 → outputFileUrl 정상
- [ ] `template_sets` 신규 컬럼 (`endpaper_config` 등) 무시 가능 — 기존 SELECT 영향 없음
- [ ] `file_edit_sessions` 신규 컬럼 무시 가능
- [ ] PHP 측 `.env` 변경 0

문제 발생 시: 운영팀에 즉시 보고 → 핫픽스 또는 롤백 (마이그레이션 롤백 SQL 은 `20260519_v1_phase2_workflow_schema.sql` 상단 주석 참조).

---

## 10. 참고 문서

- `PHP_INTEGRATION_FINAL_v3.md` — 기존 PHP 연동 가이드 (변경 없음, **부록 E** 에 v1 요약 추가)
- `PLATFORM_INTEGRATION_v1.md` — 외부 사이트 (bookmoa-mobile 등) 어댑터 가이드
- `PLATFORM_WORKER_INTEGRATION_v1.md` — 워커 capability 명세 (compose-mixed 섹션 추가)
- `SYSTEM_INTEGRATION_OVERVIEW.md` — 전체 시스템 통합 흐름 (부록 v1 추가)
- `Bookmoa_platform_Plan.md` — 통합 계획서 (단일 진실, Phase 4·5·6 = 스키마 원천)
- `apps/api/migrations/20260519_v1_phase2_workflow_schema.sql` — DB 마이그레이션 (적용 완료)

---

## 11. 변경 이력

| 일시 | 변경 |
|---|---|
| 2026-05-19 | v1.0 — 최초 작성. Phase 5+6 운영 배포 직후. 결정사항 6건 + 신규 endpoint 5종 + compose-mixed |
