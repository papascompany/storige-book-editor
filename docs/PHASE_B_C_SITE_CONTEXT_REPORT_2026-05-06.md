# Phase B + C 1차 완료 보고서 (2026-05-06)

> **Phase A**: ✅ 완료 ([`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md))
> **Phase B**: ✅ 1차 완료 (사이트별 워커 옵션 default — 데이터 모델 + admin 폼)
> **Phase C**: ✅ 1차 완료 (잡/세션 site_id 격리 — 자동 주입 컬럼)
> **PHP 영향**: **0건** — 외부 API 형식 그대로

---

## Phase B — 사이트별 워커 옵션

### 데이터 모델 (Site 엔티티 6개 컬럼 추가)
| 컬럼 | 타입 | default | 용도 |
|------|------|---------|------|
| `pdf_conversion_enabled` | boolean | true | PDF 자동 변환(addPages/applyBleed) |
| `before_after_url` | varchar(500) NULL | — | Before/After 미리보기 비교 URL |
| `default_unit` | varchar(10) | 'mm' | 데이터 단위 (mm \| inch) |
| `check_workorder` | boolean | true | 작업서 체크 |
| `check_cutting` | boolean | true | 재단선 체크 |
| `check_safezone` | boolean | true | 안전선 체크 |

### admin UI
SiteList Modal 폼 하단에 **"워커 옵션 (default)"** 섹션 추가:
- PDF 자동 변환 Switch
- Before/After URL Input
- 단위 구분 Select (mm/inch)
- 작업서/재단선/안전선 체크 Switch 3개

### 후속 (별도 사이클)
- WorkerJobsService에서 잡 생성 시 site default 옵션 자동 머지
- 워커 잡 결과에 사이트별 단위 변환 반영

---

## Phase C — 잡/세션 site_id 격리

### 데이터 모델
| 테이블 | 컬럼 | 인덱스 |
|--------|------|--------|
| `worker_jobs` | `site_id varchar(36) NULL` | `idx_worker_jobs_site_id` |
| `file_edit_sessions` | `site_id varchar(36) NULL` | `idx_edit_sessions_site_id` |

### 자동 주입 흐름
```
PHP → POST /worker-jobs/synthesize/external (X-API-Key)
       │
       ▼
ApiKeyGuard → req.user = { siteId, siteName, role, ... }
       │
       ▼
@CurrentSite() → controller에서 site 컨텍스트 추출
       │
       ▼
WorkerJobsService.createSynthesisJob({ ...dto, siteId })
       │
       ▼
worker_jobs 테이블에 site_id 자동 저장
```

### DTO 추가 필드
- `CreateValidationJobDto.siteId?` — 컨트롤러 자동 주입
- `CreateConversionJobDto.siteId?` — 동일
- `CreateSynthesisJobDto.siteId?` — 동일

### 외부 컨트롤러 갱신
- `POST /worker-jobs/validate/external` — `@CurrentSite()` 주입
- `POST /worker-jobs/synthesize/external` — `@CurrentSite()` 주입

### 후속 (별도 사이클)
- `AuthService.createShopSession`에 siteId 주입 → JWT 페이로드 반영
- `EditSessionsController` 자동 site_id 주입
- admin EditSessionList / WorkerJobList에 사이트 선택 dropdown filter
- 기존 데이터 backfill (현재 site_id NULL — 운영팀 결정 후 일괄 SQL)

---

## 운영 마이그레이션 SQL (실행 완료)

```sql
-- Phase B
ALTER TABLE sites
  ADD COLUMN pdf_conversion_enabled tinyint(1) NOT NULL DEFAULT 1 AFTER status,
  ADD COLUMN before_after_url varchar(500) DEFAULT NULL AFTER pdf_conversion_enabled,
  ADD COLUMN default_unit varchar(10) NOT NULL DEFAULT 'mm' AFTER before_after_url,
  ADD COLUMN check_workorder tinyint(1) NOT NULL DEFAULT 1 AFTER default_unit,
  ADD COLUMN check_cutting tinyint(1) NOT NULL DEFAULT 1 AFTER check_workorder,
  ADD COLUMN check_safezone tinyint(1) NOT NULL DEFAULT 1 AFTER check_cutting;

-- Phase C
ALTER TABLE worker_jobs
  ADD COLUMN site_id varchar(36) DEFAULT NULL AFTER completed_at,
  ADD INDEX idx_worker_jobs_site_id (site_id);

ALTER TABLE file_edit_sessions
  ADD COLUMN site_id varchar(36) DEFAULT NULL,
  ADD INDEX idx_edit_sessions_site_id (site_id);
```

향후 TypeORM Migration 파일로 이전 권장 (`synchronize: false` 운영).

---

## 검증

### 빌드
- `pnpm --filter @storige/api build` ✅
- `pnpm --filter @storige/admin build` ✅ (Vercel 자동 배포 master push로 트리거)

### 운영 검증 (실제 호출 — 검증 완료)
```
Job created: 9ba53c8e-01ad-4f0c-8d23-4362bf3a3fb3

SELECT j.id, j.site_id, s.name AS site_name
  FROM worker_jobs j LEFT JOIN sites s ON s.id=j.site_id
  WHERE j.id='9ba53c8e-…';

job_id                                  site_id                                  site_name
9ba53c8e-01ad-4f0c-8d23-4362bf3a3fb3    1391c5b4-5055-42f3-8e86-aff3b31ca528    북모아 메인
```
✅ PHP `STORIGE_API_KEY` 그대로 → `validate/external` 호출 → `worker_jobs.site_id`에 **북모아 메인 자동 주입** 확인.

### 배포 시 발견 + 해소 (운영 노하우)
- ALTER TABLE 실행 전에 새 API 이미지가 부팅하면 SitesService.onModuleInit()이 새 컬럼을 SELECT 시도 → `ER_BAD_FIELD_ERROR: Unknown column 'Site.pdf_conversion_enabled'` → onModuleInit 실패
- **해결**: Migration SQL 실행 후 `docker restart storige-api`로 onModuleInit 재실행
- **권장 운영 순서**: ALTER → API 빌드 → API up (또는 maintenance window 활용)

### PHP 영향
- **0건** — 외부 API 요청/응답 형식 모두 동일
- `req.user.siteId`는 서버 내부 컨텍스트, 응답 페이로드에 노출 X

---

## 후속 작업 권고 순서

| 작업 | 기간 | 범위 |
|------|------|------|
| Phase B-2 (워커 옵션 default 머지) | 0.5일 | service에서 site 조회 + dto 머지 |
| Phase C-2 (JWT siteId + EditSession 자동 주입) | 0.5일 | createShopSession → JWT 페이로드 + EditSessionsController |
| Phase C-3 (admin 사이트 dropdown 필터) | 0.5일 | EditSessionList / WorkerJobList |
| 기존 데이터 backfill | 0.5일 | site_id NULL → 북모아 메인 일괄 UPDATE |
| TypeORM Migration 파일 도입 | 1일 | synchronize: false 운영 안전화 |

전체 후속 ~3일. 모두 별도 사이클로 분리 가능.

---

## 커밋 history

```
6eb2cc1 feat(phase-b+c): 사이트별 워커 옵션 + 잡/세션 site_id 격리 (1차)
8fad632 docs(phase-a): 완료 보고서 + PHP 가이드 패키지 v3.1 갱신
99a7397 fix(phase-a): SitesModule @Global — ApiKeyGuard 의존성 주입 회귀 즉시 해소
3643397 feat(phase-a): Site/Tenant 모델 도입 — 멀티사이트 플랫폼화 기반
```
