# Phase B-2 / C-2 / C-3 후속 사이클 완료 보고서 (2026-05-07)

> **Phase A**: ✅ Site/Tenant 모델 (2026-05-06)
> **Phase B/C 1차**: ✅ 사이트 워커 옵션 + site_id 컬럼 자동 주입 (2026-05-06)
> **Phase B-2 / C-2 / C-3**: ✅ 본 보고서 — 후속 사이클
> **PHP 영향**: **0건** — 모든 외부 API 형식 동일

---

## Phase B-2 — 워커 default 옵션 자동 머지

### 변경
- **`apps/api/src/worker-jobs/worker-jobs.service.ts`**
  - `mergeSiteWorkerDefaults(siteId, options)` private helper 신규
    - `pdfConversionEnabled` → `options.applyBleed` (누락 시)
    - `defaultUnit` → `options.unit`
    - `checkWorkorder` / `checkCutting` / `checkSafezone` → 동명 옵션
  - `createValidationJob` / `createConversionJob`에서 호출
  - 호출자가 옵션 명시 시 그 값 보존, 누락된 항목만 사이트 default로 채움

### 효과
PHP 등 외부 사이트가 잡 옵션을 누락해도 admin "기본설정" 페이지에서 사이트별로 설정한 default 정책이 자동 적용. 사이트마다 다른 PDF 처리 정책 운영 가능.

---

## Phase C-2 — JWT shop-session siteId + EditSession 자동 주입

### 흐름
```
PHP → POST /auth/shop-session (X-API-Key + body)
       │
       ▼
ApiKeyGuard → req.user = { siteId, siteName, ... }
       │
       ▼
@CurrentSite() → AuthController.createShopSession(dto, siteContext)
       │
       ▼
AuthService.createShopSession(dto, siteContext)
       │ JWT 페이로드에 siteId/siteName 포함
       ▼
PHP: accessToken (JWT 토큰)
       │
       ▼
PHP → POST /edit-sessions (Authorization: Bearer <JWT>)
       │
       ▼
JwtStrategy.validate(payload) → req.user.siteId 패스스루
       │
       ▼
EditSessionsController.create(dto, user)
       │
       ▼
EditSessionsService.create({ ...dto, siteId: user.siteId })
       │
       ▼
file_edit_sessions.site_id 자동 저장
```

### 변경 파일
- `apps/api/src/auth/auth.service.ts` — `createShopSession(dto, siteContext?)`
- `apps/api/src/auth/auth.controller.ts` — `@CurrentSite()` 주입
- `apps/api/src/auth/strategies/jwt.strategy.ts` — `JwtPayload.siteId` + `ShopUser.siteId` 패스스루
- `apps/api/src/auth/strategies/jwt-cookie.strategy.ts` — 동일 패스스루
- `apps/api/src/edit-sessions/edit-sessions.controller.ts` — JWT siteId 자동 주입
- `apps/api/src/edit-sessions/edit-sessions.service.ts` — siteId entity 저장
- `apps/api/src/edit-sessions/dto/create-edit-session.dto.ts` — siteId 필드
- `apps/api/src/edit-sessions/dto/edit-session-response.dto.ts` — siteId 응답 필드

---

## Phase C-3 — admin 사이트 dropdown 필터

### 변경 파일
- `packages/types/src/index.ts` — `WorkerJob.siteId` 추가
- `apps/api/src/edit-sessions/edit-sessions.controller.ts` — `?siteId=` 쿼리
- `apps/api/src/edit-sessions/edit-sessions.service.ts` — `findBySiteId()` 신규
- `apps/api/src/worker-jobs/worker-jobs.controller.ts` — `?siteId=` 쿼리
- `apps/api/src/worker-jobs/worker-jobs.service.ts` — `findAll(status, jobType, siteId)`
- `apps/admin/src/api/edit-sessions.ts` — `getAll({siteId})` 파라미터
- `apps/admin/src/api/worker-jobs.ts` — `getAll(status, jobType, siteId)`
- `apps/admin/src/pages/EditSessions/EditSessionList.tsx` — Select dropdown + 사이트 컬럼 (Tag)
- `apps/admin/src/pages/WorkerJobs/WorkerJobList.tsx` — 동일

### admin UI 변경
- 두 페이지 상단에 **"사이트 선택" Select** 추가 (allowClear, sites api 자동 로드)
- 테이블 첫 컬럼에 사이트 Tag 표시 (siteId → 사이트명 매핑)

---

## 운영 마이그레이션 + Backfill

### 코드 배포 (VPS)
- `git pull` + `docker compose build api && up -d api`
- API 부팅 시 SitesService.onModuleInit 정상 시드 확인
- Vercel admin 자동 배포

### Backfill SQL (실행)
기존 잡/세션 NULL site_id를 북모아 메인 사이트 ID로 일괄 업데이트:
```sql
SET @bookmoa_id = (SELECT id FROM sites WHERE editor_auth_code='sk-storige-l3YVceH0sB7…' LIMIT 1);

UPDATE worker_jobs SET site_id=@bookmoa_id WHERE site_id IS NULL;
UPDATE file_edit_sessions SET site_id=@bookmoa_id WHERE site_id IS NULL;
```

### 검증 결과 (운영 실측)
```
SitesService initialized — 3 site(s) registered ✅
Nest application successfully started ✅
status=ok uptime=14s

Backfill 결과:
  worker_jobs_updated     = 14건 (NULL → 북모아 메인)
  edit_sessions_updated   =  5건

사이트별 잡 수:
  북모아 메인       15 jobs (기존 14 backfill + 신규 1)
  Default Site      0 jobs
  Default Site      0 jobs
```

- ✅ API 부팅 (3 사이트 시드 + Nest application started)
- ✅ Backfill 19건 (worker_jobs 14 + edit_sessions 5) 모두 북모아 메인으로 격리
- ✅ admin "기본설정" / "편집데이터관리" / "워커관리 > 작업 목록" 모두 사이트 dropdown 동작
- ✅ PHP `STORIGE_API_KEY` 그대로 → 새 잡/세션 자동 site_id 주입

---

## PHP 영향 — 변함없이 0건

| 외부 API | 변경 |
|----------|------|
| POST /auth/shop-session | ❌ 무변경 (JWT 페이로드에 siteId 추가는 opaque, PHP는 토큰 그대로 사용) |
| POST /worker-jobs/synthesize/external | ❌ 무변경 |
| POST /worker-jobs/validate/external | ❌ 무변경 |
| GET /worker-jobs/external/{id} | ❌ 무변경 |
| GET /worker-jobs/{id}/output | ❌ 무변경 |
| Webhook 페이로드 | ❌ 무변경 |

---

## 커밋 history (전체 Phase 누적)

```
a3b3107 feat(phase-b-2 + c-2 + c-3): 워커 default 머지 + JWT siteId + admin 사이트 dropdown
fb016c4 docs(phase-b+c): 1차 완료 보고서 + 운영 검증 결과
6eb2cc1 feat(phase-b+c): 사이트별 워커 옵션 + 잡/세션 site_id 격리 (1차)
8fad632 docs(phase-a): 완료 보고서 + PHP 가이드 패키지 v3.1 갱신
99a7397 fix(phase-a): SitesModule @Global — ApiKeyGuard 의존성 주입 회귀
3643397 feat(phase-a): Site/Tenant 모델 도입 — 멀티사이트 플랫폼화 기반
```

---

## 후속 작업 (선택)

| 작업 | 기간 | 우선순위 |
|------|------|----------|
| TypeORM Migration 파일 도입 (`synchronize: false` 안전화) | 1일 | 🟡 P1 |
| Sentry/Grafana 사이트별 라벨 자동 주입 (Interceptor) | 0.5일 | 🟢 P2 |
| 사이트별 통계 대시보드 (Grafana) | 0.5일 | 🟢 P2 |
| edit_sessions/worker_jobs FK 제약 추가 (cascade 정책) | 0.5일 | 🟢 P2 |

---

## 운영 사용 흐름 (현재 가능)

### 새 사이트 추가
1. admin → **기본설정** → 사이트 등록 (자동 키 발급)
2. 같은 모달에서 워커 옵션 default 설정 (PDF 변환, 단위, 체크 옵션)
3. PHP 팀에 인증코드 전달 → PHP `.env`에 입력
4. 즉시 운영 시작 → 잡/세션 자동 사이트 격리

### 사이트별 데이터 조회
- admin **편집데이터관리** → 상단 "사이트 선택" 드롭다운
- admin **워커관리 > 작업 목록** → 동일

### 키 재발급 (보안)
- admin → 기본설정 → "키 재발급" 드롭다운 (편집기/워커/양쪽)
- PHP 팀에 새 키 전달, 이전 키 즉시 무효
