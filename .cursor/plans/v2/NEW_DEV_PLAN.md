# Storige New Dev Plan (v2)

> **이 문서의 위치**: 이전 인수자료(`.cursor/plans/*.md`, `*.html`)는 **참고용으로 보관**.
> 실제 진행은 이 폴더 `v2/` 의 자료만 따라간다.
>
> **기준 시점**: 2026-04-27 KST · 커밋 `0bdbe62` 이후
> **인프라 시나리오 결정**: Vultr VPS Seoul + Docker Compose + Vercel (Editor/Admin)
> ← Supabase + Cloud Run + pg-boss 시나리오는 **채택하지 않음** (`migration/` 폴더는 archived)

---

## 0. 한 줄 요약

> Phase 1\~3 (VPS + DNS + HTTPS + Vercel 빌드) 완료.
> 다음 목표는 ① **PHP bookmoa 연동 완성** ② **데이터 안전망(자동 백업)** ③ **코드 보완 P1\~P7** ④ **운영 컷오버**.

---

## 1. 인프라 사실 표 (현 시점)

### 1.1 외부 엔드포인트 (Public)

| 채널 | URL | 출처 | 인증서 |
|------|-----|------|--------|
| API | `https://api.papascompany.co.kr` | Vultr VPS 158.247.235.202 / Docker nginx | Let's Encrypt (~2026-07-26 자동 갱신) |
| Editor | `https://editor.papascompany.co.kr` | Vercel (storige-editor) | Vercel 발급 |
| Admin | `https://admin.papascompany.co.kr` | Vercel (storige-admin) | Vercel 발급 |
| (구) Vercel 기본 | `storige-editor-six.vercel.app`, `storige-admin-mu.vercel.app` | Vercel 자동 | Vercel 발급 |

### 1.2 서버 인프라 (VPS)

| 항목 | 값 |
|------|-----|
| Provider | Vultr Cloud Compute (Seoul ICN) |
| Spec | 4 vCPU / 8 GB RAM / 160 GB NVMe |
| OS | Ubuntu 22.04 LTS |
| Public IP | `158.247.235.202` |
| 비용 | $48/mo (프로모션 $300 → 약 6개월 무료) |
| SSH 사용자 | `deploy` (key-only, NOPASSWD sudo, root 차단) |
| 방화벽 | ufw — 22/80/443만 허용 |
| Brute-force 방어 | fail2ban |
| 컨테이너 런타임 | Docker 29.4 + Compose v5.1 |

### 1.3 Docker Compose 컴포넌트

| 컨테이너 | 이미지 | 포트 | 헬스 |
|----------|--------|------|------|
| `storige-nginx` | nginx:1.25-alpine | 80, 443 | — |
| `storige-api` | (build) storige-api:latest | 4000 | `/api/health` |
| `storige-worker` | (build) storige-worker:latest | 4001 | bull 큐 폴링 |
| `storige-mariadb` | mariadb:11.2 | 3306 | `healthcheck.sh --connect` |
| `storige-redis` | redis:7.2-alpine | 6379 | `redis-cli ping` |

### 1.4 데이터 / 시크릿 보관

| 항목 | 위치 |
|------|------|
| DB 파일 | Docker named volume `storige_mariadb_data` |
| Redis | Docker named volume `storige_redis_data` |
| 업로드 파일 | 호스트 bind mount `~/storige/storage/` |
| `.env` (시크릿) | `/home/deploy/storige/.env` (chmod 600) |
| `.env` (워커) | `/home/deploy/storige/apps/worker/.env` (chmod 600) |
| Let's Encrypt 인증서 | `/etc/letsencrypt/` (host) → nginx 컨테이너에 read-only 마운트 |
| 인증서 갱신 | certbot systemd timer (자동) + 갱신 후 `docker compose exec nginx nginx -s reload` 후크 필요 |

### 1.5 DNS

| 항목 | 값 |
|------|-----|
| 도메인 등록자 | 가비아 (papascompany 계정) |
| Authoritative NS | `ns309.dnsever.com` 외 4개 (DNSEver) |
| `api.papascompany.co.kr` | A → `158.247.235.202` |
| `editor.papascompany.co.kr` | CNAME → `7fd01d2cdb1e8352.vercel-dns-017.com.` |
| `admin.papascompany.co.kr` | CNAME → `a46edb81d8bbe4c1.vercel-dns-017.com.` |
| `papascompany.co.kr` (root) | (cafe24 호스팅 — 현재 메인 사이트, 곧 이전 예정) |
| MX (메일) | `smtp.google.com` priority 1 (Google Workspace) |

### 1.6 외부 계정 / 콘솔

| 서비스 | 계정 / 식별자 | 권한 |
|--------|--------------|------|
| GitHub | `papascompany` (yohan@papascompany.co.kr) | owner of `papascompany/storige-book-editor` |
| Vercel | `papas-yohan` / Yohan's projects (`team_dOpgsAqfLyl4qNlVgSiFVm6B`) | Hobby plan, 두 프로젝트 owner |
| Vultr | `yohan73@gmail.com Personal Org` | owner |
| Gabia (도메인) | papascompany 계정 | owner of papascompany.co.kr |
| DNSEver | papascompany / 8101P 포인트 보유 | owner |
| cafe24 | papaspring 쇼핑몰 운영 (별도) | — |
| Google Workspace | yohan@papascompany.co.kr | admin |
| Supabase (구) | `tktucpwqxoqtlorahmod` 프로젝트 | ⚠️ Pause/Delete 권장 (사용 안 함) |

### 1.7 시크릿 (실제 값은 VPS의 `~/storige/.env` 참조)

| 키 | 용도 | 노출 가능? |
|----|------|------------|
| `JWT_SECRET` | Storige JWT 서명 | ❌ 절대 외부 노출 금지 |
| `MYSQL_ROOT_PASSWORD` | MariaDB root | ❌ |
| `DATABASE_PASSWORD` | MariaDB storige 사용자 | ❌ |
| `WORKER_API_KEY` | worker → API 콜백 인증 (X-API-Key) | ❌ |
| `API_KEYS` (둘째 값 = `PHP_API_KEY`) | PHP → API 호출용 | PHP 측에만 공유 ✅ |
| `WEBHOOK_SECRET` | (예약) 웹훅 HMAC 도입 시 | 양쪽 공유 |
| Admin 시드 | `admin@storige.com` / 초기 비번 `admin123` | ⚠️ **즉시 변경** |

---

## 2. 시스템 관계도

### 2.1 트래픽 플로우 (현재)

```
                                ┌─────────────────────────┐
                                │  bookmoa PHP 운영 서버  │
                                │  (cafe24 / 기타 호스팅) │
                                └──────────┬──────────────┘
              ┌────────────────────────────┼────────────────────────┐
              │                            │                        │
       (1) embed iframe                (2) 외부 API                 (3) 웹훅 수신
       <iframe src="editor.../"          POST/GET /api/.../external <─ POST callbackUrl
                                              X-API-Key
              │                            │                        │
              ▼                            ▼                        │
   ┌─────────────────────┐     ┌────────────────────┐                │
   │ editor.papas... /   │     │ api.papas...co.kr  │                │
   │ admin.papas... /    │────▶│  (nginx → API)     │────────────────┘
   │  (Vercel CDN)       │     │  + worker          │
   └──────────┬──────────┘     │  + MariaDB + Redis │
              │                │  (Vultr VPS)       │
        고객 브라우저          └─────────┬──────────┘
                                         │
                                  ┌──────┴──────┐
                                  │ Bull/Redis  │
                                  │ 큐 3개       │
                                  └──────┬──────┘
                                         │
                              storige-worker 컨테이너
                              (Ghostscript, pdf-lib, sharp, canvas)
                                         │
                                  ┌──────┴──────┐
                                  │  storage/   │ (host bind)
                                  └─────────────┘
```

### 2.2 모듈 의존성 (모노레포 + Docker)

```
packages/types          ← (먼저 빌드, 다른 모든 곳이 의존)
   │
   ├── packages/canvas-core (Fabric.js 래퍼 + 21 플러그인)
   │      ↑
   │      └── apps/editor  ─┐
   │                        ├─▶ Vercel build (Node 20.x, pnpm 9.15)
   │                        │   ignoredOptionalDependencies: [canvas]
   ├── packages/ai           │   rootDirectory: apps/{editor,admin}
   ├── packages/ui   ────────┘
   │
   ├── apps/admin  ────────▶ Vercel build (같은 설정)
   │
   ├── apps/api    ─┐
   │               ├──▶ Docker multi-stage
   ├── apps/worker ─┘   - builder: cairo-dev, pango-dev, gs (worker)
   │                    - prod   : .build-deps 임시 설치 → 컴파일 → 삭제
   │                    - workspace dist 복사: packages/types/dist
   │
   └── docker-compose.yml (nginx만 외부 노출, 나머지는 internal network)
```

### 2.3 API 모듈 (NestJS, 14개)

`HealthModule, AuthModule, TemplatesModule, LibraryModule, StorageModule, WorkerJobsModule, EditorModule, EditorDesignsModule, EditorContentsModule, ProductsModule, SeedModule, FilesModule, EditSessionsModule` (+조건부 `BookmoaModule`)

`WebhookModule`은 `WorkerJobsModule`이 import해서 사용 (최상위 imports에는 없음).

### 2.4 Worker 큐

| Bull Queue | 처리 잡 | 진입 |
|------------|---------|------|
| `pdf-validation` | `validate-pdf` | API `POST /api/worker-jobs/validate/external` |
| `pdf-conversion` | `convert-pdf` | (synthesis 내부에서 발행) |
| `pdf-synthesis` | `synthesize-pdf` (mode: merge/split/spread) | API `POST /api/worker-jobs/synthesize/external`, `split-synthesize/external` |

---

## 3. PHP ↔ Storige 연동안 (★ 핵심)

> 이 섹션의 계약은 **변경 불가**. 새 인프라가 같은 계약을 그대로 만족시켜야 함.

### 3.1 PHP가 알아야 할 4가지 기본값

```php
// bookmoa 측 config.php (또는 동등 파일)
define('STORIGE_API_BASE',     'https://api.papascompany.co.kr/api');     // ← 변경
define('STORIGE_EDITOR_URL',   'https://editor.papascompany.co.kr');       // ← 변경
define('STORIGE_API_KEY',      '<API_KEYS의 둘째 값, ~/storige/.env 참조>'); // ← 변경
define('STORIGE_WEBHOOK_VERIFY_HEADER', 'X-Storige-Signature');             // 동일
```

> ⚠️ `STORIGE_API_KEY` 절대 깃에 커밋 금지. webroot 밖 또는 `.htaccess` 보호.

### 3.2 PHP → API 호출 (X-API-Key, 8개 엔드포인트)

| Method | Path | 용도 | 페이로드 핵심 |
|--------|------|------|---------------|
| POST | `/api/auth/shop-session` | 쇼핑몰 회원의 Storige 세션 발급 | `{ memberSeqno, memberId, name, role, permissions, phpSessionId }` → JWT 쿠키 `storige_access`, `storige_refresh` 응답 |
| POST | `/api/auth/shop-refresh` | refresh 토큰으로 access 갱신 | refresh 쿠키 |
| POST | `/api/files/upload/external` | 표지/내지 PDF 업로드 | multipart `file`, `orderSeqno`, `memberSeqno`, `fileType`(cover/content) |
| GET | `/api/edit-sessions/external` | 주문의 편집 세션 조회 | `?orderSeqno=…` |
| POST | `/api/worker-jobs/validate/external` | PDF 검증 잡 생성 | `{ fileId, sessionId, options, callbackUrl, requestId }` |
| POST | `/api/worker-jobs/synthesize/external` | PDF 합성 잡 생성 (merge/spread) | `{ sessionId, mode, items, callbackUrl, requestId }` |
| POST | `/api/worker-jobs/split-synthesize/external` | PDF split 합성 | 동일 |
| POST | `/api/worker-jobs/check-mergeable/external` | 합성 가능 여부 사전 체크 | `{ sessionId, items }` |
| GET | `/api/worker-jobs/external/:id` | 잡 상태 조회 | — |
| PATCH | `/api/worker-jobs/external/:id/status` | (워커 전용) 상태 갱신 | 워커가 사용, PHP에선 사용 안 함 |

> **멱등성**: `requestId`를 동일하게 보내면 중복 잡 생성 안 됨 (DB에 unique index `(session_id, pdf_file_id, request_id)` 적용).

### 3.3 Storige → PHP 웹훅 (callbackUrl 받을 때)

워커가 잡을 끝낼 때마다 PHP의 `callbackUrl`로 **POST**.

#### 요청 헤더
```
Content-Type: application/json
X-Storige-Event:     <event 이름>            ← 위 페이로드 event 와 동일
X-Storige-Signature: <base64 시그니처>        ← 검증용
X-Storige-Retry:     1                         ← (있으면 재시도분)
```

#### 시그니처 검증 (PHP 예시)
```php
function verifyStorigeSignature(string $rawBody, string $headerSig): bool {
    $payload = json_decode($rawBody, true);
    $identifier = $payload['sessionId'] ?? $payload['jobId'] ?? 'unknown';
    $expected = base64_encode("{$identifier}:{$payload['event']}:{$payload['timestamp']}");
    return hash_equals($expected, $headerSig);
}
```
> **주의**: 현재 시그니처는 비밀키 없는 base64 인코딩(난독화 수준). HMAC으로 강화하는 것은 P6/P7 단계 항목 (`WEBHOOK_SECRET` 이미 발급됨, 양쪽 코드에 도입 필요).

#### 페이로드 종류

**① `session.validated` / `session.failed`** (검증 잡)
```json
{
  "event": "session.validated",
  "sessionId": "xxx-xxx",
  "orderSeqno": 123456,
  "status": "validated",
  "fileType": "content",
  "result": { "...": "..." },
  "timestamp": "2026-04-27T09:35:00.000Z"
}
```

**② `synthesis.completed` / `synthesis.failed`** (합성 잡 — 자세한 스키마는 `@storige/types`의 `SynthesisWebhookPayload`)
```json
{
  "event": "synthesis.completed",
  "jobId": "yyy-yyy",
  "sessionId": "xxx-xxx",
  "mode": "merge",
  "outputFileUrl": "https://api.papascompany.co.kr/storage/outputs/.../merged.pdf",
  "timestamp": "2026-04-27T09:40:00.000Z"
}
```

#### 권장 PHP 핸들러 골격
```php
// /webhook/storige.php (예)
$rawBody = file_get_contents('php://input');
$sig = $_SERVER['HTTP_X_STORIGE_SIGNATURE'] ?? '';
if (!verifyStorigeSignature($rawBody, $sig)) {
    http_response_code(401); exit('bad signature');
}
$payload = json_decode($rawBody, true);
switch ($payload['event']) {
    case 'session.validated':  /* DB 업데이트 */ break;
    case 'session.failed':     /* 알림 */         break;
    case 'synthesis.completed':/* 주문에 PDF URL 저장 */ break;
    case 'synthesis.failed':   /* 재시도 / 알림 */ break;
}
http_response_code(200); echo 'ok';
```

### 3.4 Editor 임베드 (PHP 페이지에서 에디터 호출)

방식: **iframe + postMessage**

```html
<!-- bookmoa의 편집 페이지 -->
<iframe id="storige-editor"
        src="https://editor.papascompany.co.kr/?templateSetId={SET_ID}&orderSeqno={ORDER_NO}"
        style="width:100%;height:100vh;border:0;"></iframe>

<script>
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://editor.papascompany.co.kr') return;
    const { type, payload } = e.data || {};
    switch (type) {
      case 'storige:saved':     /* 자동 저장 완료 */ break;
      case 'storige:completed': /* 편집 완료, sessionId 받음 */ break;
      case 'storige:error':     /* 에러 */ break;
    }
  });
</script>
```

> **주의**: 인증 토큰은 `POST /api/auth/shop-session` 결과로 받은 쿠키(`storige_access`)로 자동 인증. 도메인이 다르므로 **`SameSite=None; Secure`** 가 동작 조건. 운영 도메인이 PHP 측과 다른 서브도메인이면 쿠키 정책 점검 필수.

### 3.5 PHP 측 컷오버 절차 (1회)

```
1. PHP staging 환경에서 위 4가지 상수만 새 값으로 교체 → 회귀 테스트
   - 회원 1명으로 shop-session → cookie 발급 ok
   - 더미 PDF 1건 upload/external → 200 ok
   - validate/external 호출 → 콜백 수신 + 시그니처 검증 ok
2. 운영 PHP에 변경 적용 (1줄~4줄 수정 + git deploy)
3. 신규 주문 1건 직접 시도 (모니터링)
4. 첫 24시간 모니터링: API 로그 + 워커 로그 + Redis 큐 적체
```

`agents/01-php-integrator.md`에 자세한 단계 정의.

---

## 3.6 디자인 작업 트랙 (별도 브랜치 `feat/design-refresh`)

운영 컷오버와 별개로 진행 중인 디자인 보강 작업.

| # | 항목 | 상태 | 비고 |
|---|------|------|------|
| **D1** | 헤더 그라데이션 (violet-200 → white) | ✅ Preview 적용 | EditorHeader.tsx |
| **D2-NEW** | Admin에서 메뉴 아이콘 PNG 업로드 시스템 | ⏳ 컷오버 후 | `agents/10-menu-icon-asset-system.md`. ※ 원래 D2(phosphor → Lucide 일괄 교체)는 폐기. PNG 동적 시스템으로 대체. |
| **D3** | 눈금자 스타일 (밝은 헤더 + 그레이 80%) + 영역 시각화 유지 | ⏳ 진행 예정 | `packages/canvas-core` ruler.plugin |
| **D4** | 페이지 네비 (책자/낭장 분기 + 우측/하단 토글 + 반응형) | ⏳ 진행 예정 | 페이지 네비 컴포넌트 |

> D2는 D2-NEW로 대체되어 컷오버를 막지 않습니다. 즉시 진행할 디자인 작업은 D1(완료) → D3 → D4.

---

## 4. 코드 보완 로드맵 (P1 \~ P7)

> 인프라가 완성됐어도 **이 코드 작업이 끝나야 운영 트래픽을 받을 수 있음**.

| # | 제목 | 위치 | 우선순위 | Agent |
|---|------|------|----------|-------|
| **P1** | EditSession 완료 API 연동 | `apps/editor/src/hooks/useWorkSave.ts:666,675` | 🔴 컷오버 전 필수 | `03-edit-session-completer.md` |
| **P2** | 썸네일 Sharp 실제 구현 | `apps/api/src/storage/storage.service.ts:163` | 🟠 사용성 | `04-thumbnail-implementer.md` |
| **P3** | 템플릿 사용 여부 안전장치 | `apps/api/src/templates/template-sets.service.ts:210` | 🟡 데이터 안전 | `05-template-usage-checker.md` |
| **P4** | 중철 페이지 순서 | `apps/worker/src/services/pdf-synthesizer.service.ts:259` | 🔴 중철 주문 받을 거면 필수 | `06-saddle-stitch-orderer.md` |
| **P5** | PDF 내보내기 엔드포인트 (placeholder 제거) | `apps/api/src/editor/editor.service.ts:693~700` | 🟠 높음 | `07-pdf-export-implementer.md` |
| **P6** | 테스트 자동화 / 로깅 일원화 | (전반) | 🟢 운영 안정화 | `08-test-monitoring-setup.md` |
| **P7** | 모니터링 (Sentry/Vercel Analytics + 큐 적체 알람) | (전반) | 🟢 운영 안정화 | `08-test-monitoring-setup.md` |

추가 정리 항목 (작은 것들):

| 항목 | 위치 | 의의 |
|------|------|------|
| `Reviews/ReviewDetail.tsx:84,101` 승인자 ID 하드코딩 | admin | 운영 시 잘못된 감사로그 위험 |
| `useEditorContents.ts:824` GraphQL TODO | editor | 콘텐츠 로드 미구현 (P6 진입점) |
| `.env.example` 필수/선택 구분 (P0-B) | repo root | 다음 인수자 위해 |
| 워커 API 키 검증 흐름 점검 (P0-C) | api+worker | 보안 |

---

## 5. 운영 트랙 (Phase 4 \~ 5 신규 정의)

| Phase | 단계 | Agent |
|-------|------|-------|
| **4-1** | PHP 측 baseURL/X-API-Key 주입 + 회귀 테스트 (사용자 작업) | `01-php-integrator.md` |
| **4-2** | 첫 주문 컷오버 + 24h 모니터링 | `09-cutover-runbook.md` |
| **5-1** | DB + storage 자동 백업 (cron + R2 옵션) | `02-backup-automation.md` |
| **5-2** | Cloudflare R2 또는 외부 스토리지로 백업 이중화 | `02-backup-automation.md` (단계 2) |
| **5-3** | 모니터링/알람 (큐 적체, 디스크, 메모리) | `08-test-monitoring-setup.md` |
| **5-4** | Admin 비밀번호 강제 교체 (admin123 → 강한 비번) | `09-cutover-runbook.md` |
| **5-5** | Supabase (사용 안 함) Pause/Delete | `09-cutover-runbook.md` |

---

## 6. 우선순위 권장 순서 (이 문서 작성 시점부터)

```
Day 0 (오늘) ────────────────────────────────────────────────
   ✅ 인프라 완료 (Phase 1~3)
   ✅ 옛 fork 분리 + archive

Day 1 ─────────────────────────────────────────────────────
   1. 자동 백업 (5-1)                       agent: 02-backup-automation
   2. Admin 비번 변경 (5-4)                  agent: 09-cutover-runbook
   3. Supabase Pause/Delete (5-5)            agent: 09-cutover-runbook
   4. 문서 보수 (_RESUME_PROMPT 갱신)        agent: 09-cutover-runbook

Day 2~4 ───────────────────────────────────────────────────
   5. P1 EditSession 완료 API (필수)         agent: 03-edit-session-completer
   6. P5 PDF 내보내기 (placeholder 제거)     agent: 07-pdf-export-implementer
   7. P4 중철 페이지 순서 (중철 받을 거면)   agent: 06-saddle-stitch-orderer

Day 5 ─────────────────────────────────────────────────────
   8. PHP 연동 staging 회귀 (4-1)            agent: 01-php-integrator

Day 6 ─────────────────────────────────────────────────────
   9. 컷오버 (4-2) — 첫 주문 검증            agent: 09-cutover-runbook

Week 2+ ───────────────────────────────────────────────────
  10. P2 썸네일, P3 안전장치, P6/P7         각 agent

Week 3+ ───────────────────────────────────────────────────
  11. R2 백업 이중화, 모니터링/알람         agent: 02 / 08
```

---

## 7. 환경변수 매트릭스

### 7.1 VPS `~/storige/.env`

```bash
# DB
MYSQL_ROOT_PASSWORD=<random>
DATABASE_USER=storige
DATABASE_PASSWORD=<random>
DATABASE_NAME=storige
DATABASE_HOST=mariadb
DATABASE_PORT=3306

# API
JWT_SECRET=<random 64hex>
JWT_EXPIRES_IN=24h
NODE_ENV=production
API_PORT=4000
CORS_ORIGIN=https://editor.papascompany.co.kr,https://admin.papascompany.co.kr,https://storige-editor-six.vercel.app,https://storige-admin-mu.vercel.app

# Worker
WORKER_PORT=4001
MAX_RETRY_ATTEMPTS=3
GHOSTSCRIPT_PATH=/usr/bin/gs
WORKER_API_KEY=<random>
API_BASE_URL=https://api.papascompany.co.kr/api

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# Storage
STORAGE_PATH=/app/storage
STORAGE_BASE_URL=https://api.papascompany.co.kr/storage

# X-API-Key (PHP 공유)
API_KEYS=<WORKER_API_KEY>,<PHP_API_KEY>

# 웹훅 (HMAC 도입 시)
WEBHOOK_SECRET=<random>

# Bookmoa DB (옵션)
# BOOKMOA_DB_HOST=
# BOOKMOA_DB_PORT=3306
# BOOKMOA_DB_USER=
# BOOKMOA_DB_PASSWORD=
# BOOKMOA_DB_NAME=bookmoa
```

### 7.2 Vercel 환경변수 (Dashboard)

| 변수 | 값 | env |
|------|-----|-----|
| `VITE_API_BASE_URL` | `https://api.papascompany.co.kr/api` | Production, Development |

> Preview는 `vercel.json`의 `build.env`로 fallback 적용. CLI의 git-branch 프롬프트 우회.

### 7.3 Vercel project 설정 (API로 강제)

| 프로젝트 | rootDirectory | nodeVersion | framework |
|----------|---------------|-------------|-----------|
| storige-editor | `apps/editor` | `20.x` | `vite` (vercel.json) |
| storige-admin | `apps/admin` | `20.x` | `vite` (vercel.json) |

### 7.4 PHP `config.php`

```php
define('STORIGE_API_BASE',   'https://api.papascompany.co.kr/api');
define('STORIGE_EDITOR_URL', 'https://editor.papascompany.co.kr');
define('STORIGE_API_KEY',    '<PHP_API_KEY 값>');
```

---

## 8. 위험·주의 사항

| 위험 | 영향 | 완화 |
|------|------|------|
| Admin 초기 비밀번호 `admin123` | 운영 사고 | 첫 작업으로 즉시 변경 (5-4) |
| Storage가 호스트 디스크에만 있음 | 디스크 장애 시 전손 | 자동 백업 (5-1) → R2 이중화 (5-2) |
| 웹훅 시그니처가 HMAC 아닌 base64 | 위변조 가능 | P6에서 `WEBHOOK_SECRET` HMAC 도입 |
| Let's Encrypt 갱신 후 nginx reload 누락 시 인증서 안 갱신 | HTTPS 만료 | certbot deploy hook 등록 (5-3) |
| Vercel Preview 환경변수에 VITE_API_BASE_URL 미등록 | PR 빌드는 vercel.json fallback에 의존 | OK (의도된 동작) |
| Bookmoa DB 직접 연결 (BOOKMOA_DB_*) 미설정 | 회원 검증 fallback 동작 | PHP 측이 모든 회원 정보 같이 넘기면 무관 |
| CORS_ORIGIN에 PHP 도메인 미포함 | iframe → API 호출 실패 | 컷오버 전 PHP 도메인 추가 |

---

## 9. 다음 작업 시작점

이 문서를 따른다면 다음 항목 중 하나로 시작하세요. 각 작업은 `agents/`의 해당 에이전트가 가이드합니다.

- 🔵 **자동 백업부터** (안전망 우선) → `agents/02-backup-automation.md`
- 🟢 **PHP 연동부터** (외부 트래픽 받기 시작) → `agents/01-php-integrator.md`
- 🟣 **P1 코드 보완부터** (편집 완료 미구현) → `agents/03-edit-session-completer.md`

권장: **Day 1 → Day 5** 순서대로.

---

**문서 갱신 원칙**:
- 사실(인프라/계정/환경변수)이 바뀌면 §1, §7 갱신
- Phase 진행 상황은 §5, §6 갱신
- PHP 계약이 바뀌면 §3 갱신 (양쪽 협의 필수)
- 새 위험 발견 시 §8 추가
