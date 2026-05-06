# Admin 플랫폼화 분석 보고서 (2026-05-06)

> **입력 자료**: `admin storyboard.pdf` (11p, Keynote 작성, 7개 외부 사이트 가정)
> **목표**: Storige admin/worker를 **중앙 통합 관리 플랫폼**으로 확장 — 외부 사이트(북모아, 점보포토, 스튜디오북, Storywork, Printcard studio, MD2Books, 100p Books)가 SDK/API 연동만으로 편집기·워커를 사용할 수 있는 구조
> **결론**: 현재 admin은 **"북모아 단독 운영" 모델**로 만들어져 있고, 플랫폼화에 필요한 **Site(테넌트) 모델 / 사이트별 인증코드 / 사이트별 워커 옵션**이 핵심 gap

---

## 0. 핵심 gap 요약

| Gap | 현재 상태 | 영향 |
|-----|----------|------|
| **Site/Tenant 엔티티 부재** | API Key는 `.env`의 `API_KEYS=key1,key2`만, 어떤 사이트가 호출했는지 식별 불가 (`source: 'shop'`) | 사이트별 audit/통계/권한 분리 모두 불가 |
| **사이트별 인증코드 발급/관리 UI 없음** | admin에서 사이트 등록 → 코드 발급 흐름 X | PHP 팀에 키를 운영팀이 수동 전달 (확장성 0) |
| **사이트별 워커 옵션 저장 위치 없음** | 워커 잡 호출 시 매번 옵션 파라미터로 전달 (`bleed`, `bindingType` 등) | 사이트마다 같은 PDF 처리 정책을 호출자가 매번 명시 |
| **편집기·워커 코드 단일** (PHP 가이드 v3.0) | ✅ 이건 이미 OK — `/external` endpoint로 분리됨 | 코드는 1번 적용, 사이트만 늘리면 됨 |
| **모니터링 통합** (P2-8/P2-10) | ✅ Grafana + Loki + Sentry로 통합 | 새 사이트 추가 시 메트릭/로그도 자동 |

플랫폼화 1차 작업 핵심: **Site 엔티티 + 사이트별 인증코드 + 사이트별 워커 옵션** 3개 추가하면 나머지 인프라(코드/모니터링)는 이미 준비됨.

---

## 1. 편집기 리소스 관리 기능

> 외부 사이트가 호출하는 편집기에 공급할 디자인 리소스(템플릿/라이브러리) 관리.
> 스토리보드 매핑: **템플릿분류 / 템플릿관리 / 템플릿셋관리 / 라이브러리**

### 1-1. 스토리보드 요구사항

| 페이지 | 요구사항 |
|--------|----------|
| **템플릿분류** | 1차/하위(2차) 카테고리 등록·관리, 카테고리 코드 (1차 2자리/2차 3자리/3차 3자리), 카테고리명, **페이지표기 (페이지/전면후면/앞뒤)**, 단위 구분, **작업선/재단선/안전선 표시 유무** |
| **템플릿관리** | 카테고리 선택 + 템플릿명 + 사용여부 검색, 등록·수정·복사·삭제, 컬럼: 템플릿분류 / **편집코드(쇼핑몰 상품에 등록하여 편집기 호출)** / 템플릿코드 / 템플릿명 / 등록일 / 수정일 |
| **템플릿셋관리** | "템플릿셋 = 규격/디자인/리소스 등 지정상품" — 신규 생성은 편집기에서, admin은 검색·조회·복사·삭제. **라이브러리 불러와서 구성** + 템플릿명 지정 저장. ⚠️ 스토리보드 Q: "템플릿셋 변경 후 저장 시 보관함 이동 vs 동적 변경" — 정책 결정 필요 |
| **라이브러리** | 1차/하위 카테고리 + 라이브러리명 + 사용여부 검색, **유형: 판형(자동·수동)/폰트/배경/도형/프레임(사진틀)/클립아트/QR코드** |

### 1-2. 현재 구현 상태

| 항목 | 페이지 | 엔티티 | 상태 |
|------|--------|--------|------|
| 템플릿분류 | [`apps/admin/src/pages/Categories/CategoryManagement.tsx`](apps/admin/src/pages/Categories/CategoryManagement.tsx) | `templates/entities/category.entity.ts` (id, name, code, parent_id, sort_order, type) | ✅ 1차/하위 + sort_order |
| 템플릿관리 | [`Templates/TemplateList.tsx`](apps/admin/src/pages/Templates/TemplateList.tsx) + [`TemplateEditor.tsx`](apps/admin/src/pages/Templates/TemplateEditor.tsx) | `templates/entities/template.entity.ts` | ✅ CRUD + 편집기 |
| 템플릿셋관리 | [`TemplateSets/TemplateSetList.tsx`](apps/admin/src/pages/TemplateSets/TemplateSetList.tsx) + [`TemplateSetForm.tsx`](apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx) | `templates/entities/template-set.entity.ts` | ✅ 검색 + CRUD |
| 라이브러리 카테고리 | [`Library/CategoryManagement.tsx`](apps/admin/src/pages/Library/CategoryManagement.tsx) | `library/entities/category.entity.ts` | ✅ |
| 라이브러리 폰트 | [`Library/FontList.tsx`](apps/admin/src/pages/Library/FontList.tsx) | `library/entities/font.entity.ts` | ✅ |
| 라이브러리 배경 | [`Library/BackgroundList.tsx`](apps/admin/src/pages/Library/BackgroundList.tsx) | `library/entities/background.entity.ts` (id, name, file_url, thumbnail_url, category, category_id, is_active) | ✅ + 카테고리 필터 |
| 라이브러리 도형 | [`Library/ShapeList.tsx`](apps/admin/src/pages/Library/ShapeList.tsx) | `library/entities/shape.entity.ts` | ✅ |
| 라이브러리 사진틀(프레임) | [`Library/FrameList.tsx`](apps/admin/src/pages/Library/FrameList.tsx) | `library/entities/frame.entity.ts` | ✅ |
| 라이브러리 클립아트 | [`Library/ClipartList.tsx`](apps/admin/src/pages/Library/ClipartList.tsx) | `library/entities/clipart.entity.ts` | ✅ |

### 1-3. 미구현 / Gap

| Gap | 설명 | 우선순위 |
|-----|------|---------|
| **편집코드(편집기 호출용)** 컬럼 명시 | 스토리보드: 템플릿관리에 "편집코드 — 쇼핑몰 상품에 등록하여 편집기 호출" 명시. 현재 `template-set.id` (UUID)를 그대로 쓰는지, 별도 short code 발급 시스템인지 불명확 | 🟡 P1 — 외부 사이트가 길지 않은 코드를 URL에 박기 편함 |
| **카테고리 페이지표기/작업선/재단선/안전선 옵션** | 스토리보드: 카테고리에 표시 옵션 5개 (페이지·전면후면·앞뒤·작업선·재단선·안전선) | 🟡 P1 — 카테고리 단위 default 정책 |
| **라이브러리 QR코드** | 스토리보드: QR코드도 라이브러리 자산 | 🟢 P2 — 모듈 신규 (entity + page) |
| **라이브러리 자동/수동 판형** | 스토리보드: "자동판형: 웹 주문정보의 사이즈를 받아서 자동생성 / 수동판형: 편집기 구동시 사용할 판형 선택" | 🟡 P1 — 옵션 C(자유 사이즈)와 통합 검토 |
| **라이브러리 자산 큐레이션** | 현재 13개 더미 SVG (P0-2 검증용). 디자인팀 자산 미입력 | 🟢 외부 협업 |
| **사이트별 라이브러리 가시성** | 모든 사이트가 모든 라이브러리 자산 사용 가능 (글로벌). 사이트별 비공개 자산 또는 브랜드 폰트 분리 모델 X | 🟡 플랫폼화 시 검토 |

### 1-4. 플랫폼화 추가 권장

```
공용 카탈로그 vs 사이트별 카탈로그 분리:
  - 공용 (모든 사이트): 시스템 폰트, 일반 도형/프레임/클립아트
  - 사이트별 (private): 브랜드 폰트, 브랜드 로고 클립아트, 한정판 템플릿
```

DB 스키마 권장:
```sql
ALTER TABLE library_backgrounds ADD COLUMN site_id VARCHAR(36) NULL;  -- NULL = 공용
ALTER TABLE library_fonts       ADD COLUMN site_id VARCHAR(36) NULL;
-- ... 모든 라이브러리/템플릿 테이블

-- 조회 시:  WHERE site_id IS NULL OR site_id = :currentSiteId
```

---

## 2. 편집기 연동 사이트 정보 관리

> 어떤 외부 사이트가 편집기를 사용하는지 — 사이트 등록·인증코드 발급·운영 토글.
> 스토리보드 매핑: **기본설정**

### 2-1. 스토리보드 요구사항 (페이지 1)

```
[기본설정]  사이트 7개 좌측 리스트 (북모아 메인 / 점보포토 / 스튜디오북 / Storywork / Printcard studio / MD2Books / 100p Books)
  - 사이트명: (입력)
  - 사이트 URL: (입력)
  - 보관함 URL: (입력)              ← 편집 완료 후 PDF/파일 보관 위치
  - 편집기 인증코드: (입력/발급)    ← 편집기 호출용 토큰
  - 사이트 운영여부: (운영중/운영중지)
  - [삭제] [저장]
```

### 2-2. 현재 구현 상태 — **❌ 전체 미구현**

| 항목 | 현재 상태 |
|------|----------|
| Site / Tenant 엔티티 | ❌ 없음 |
| 사이트 CRUD UI (admin) | ❌ 없음 |
| 사이트별 편집기 인증코드 | ❌ 환경변수 `API_KEYS`에 콤마 구분 문자열 1줄 — 사이트 식별 불가 |
| 사이트별 운영 토글 | ❌ |
| 사이트별 보관함 URL | ❌ |

핵심 코드 증거: [`apps/api/src/auth/strategies/api-key.strategy.ts:23`](apps/api/src/auth/strategies/api-key.strategy.ts:23)
```ts
const apiKeysConfig = this.configService.get<string>('API_KEYS', '');
const validApiKeys = apiKeysConfig.split(',').map((key) => key.trim())...
if (validApiKeys.includes(apiKey)) {
  done(null, { apiKey, source: 'shop' });   // ← 모든 사이트가 동일하게 'shop' 식별
}
```

### 2-3. 미구현 / Gap (전부 신규 작업)

| Gap | 작업 |
|-----|------|
| **Site 엔티티 신설** | `apps/api/src/sites/entities/site.entity.ts` — id, name, domain, return_url_base, storage_url_base, editor_auth_code, worker_auth_code, status (active/suspended), created_at |
| **API Key 검증 로직 변경** | `.env` 문자열 → DB의 `sites.editor_auth_code` 조회. 검증 통과 시 `req.site = { id, name, ... }` 주입 |
| **모든 외부 endpoint** (`/external`, `/auth/shop-session`, `/files/.../download/external`, `/worker-jobs/.../external`)에 `req.site` 컨텍스트 사용 | 사이트별 audit, 권한 |
| **admin 신규 메뉴: 기본설정** | `apps/admin/src/pages/Sites/SiteList.tsx` — 7개 외부 사이트 등록·관리 + 인증코드 발급·재발급 |
| **사이트별 통계** | Sentry/Grafana에 `site_id` 라벨 추가 → 사이트별 잡 수, 에러율 모니터링 |

### 2-4. 권장 마이그레이션 순서

1. **Site 엔티티 + Migration** (1일) — 기존 `API_KEYS` 환경변수의 키를 DB로 옮김
2. **ApiKeyStrategy 변경** — DB 조회 + `req.site` 주입 (1일)
3. **admin 기본설정 페이지 신설** (0.5일)
4. **모든 외부 endpoint에 site 컨텍스트 적용** (0.5일)
5. **사이트별 통계** (P2-8 대시보드에 site 변수 추가, 0.5일)

총 **3.5일** 1차 작업.

---

## 3. 워커 연동 관리

> 외부 사이트마다 PDF 처리 정책이 다를 수 있음 — 사이트별 워커 옵션 저장.
> 스토리보드 매핑: **워커관리**

### 3-1. 스토리보드 요구사항 (페이지 8)

```
[워커관리]  사이트 7개 좌측 리스트 (기본설정과 동일)
  - 사이트명: (입력)
  - 사이트 URL: (입력)
  - 업로드 URL: (입력)              ← 외부 사이트가 PDF 업로드할 webhook
  - 워커 인증코드: (입력/발급)      ← 편집기 인증코드와 별도
  - 사이트 운영여부: (운영중/운영중지)
  - PDF 파일 변환 여부: (사용/사용안함)
  - Before/After URL: (입력)        ← Before/After 미리보기 비교 URL
  - 데이터 단위 구분: (밀리미터/인치)
  - 작업서 체크: (사용/사용안함)
  - 재단선 체크: (사용/사용안함)
  - 안전선 체크: (사용/사용안함)
  - [삭제] [저장]
```

스토리보드 우측 메모 (사용자가 ⭐ 강조):
> **플랫폼 서비스 (재추천)**: API 토큰 발급 + SDK 호출만
> **코드 드리프트**: 단일 코드베이스 → 1번 적용
> **모니터링·관측**: 통합 대시보드 가능
> **도메인 지식 응축**: 한곳에 집적 → 자산화
> **Storige·PrintCard 외 미래 (예: Bookmoa, CardCraft)**: 새 capability만 추가
> **운영 인력**: 1명이 1곳 관리

### 3-2. 현재 구현 상태 — **❌ 전체 미구현 (사이트별)**

| 항목 | 현재 상태 |
|------|----------|
| Site별 워커 옵션 엔티티 | ❌ 없음 |
| 워커 인증코드 (별도) | ❌ 편집기 인증코드와 동일 (`API_KEYS`) |
| PDF 변환 여부 (사이트별 default) | ❌ 잡 호출 시마다 파라미터 |
| Before/After URL | ❌ |
| 단위 구분 (mm/inch) | ✅ 부분 — `canvas.unitOptions.unit` (편집기에서만, 사이트별 X) |
| 작업선/재단선/안전선 default | ❌ 잡 호출 시 직접 전달 |

### 3-3. 미구현 / Gap

| Gap | 작업 |
|-----|------|
| **SiteWorkerSettings 엔티티** | `sites/entities/site-worker-settings.entity.ts` — site_id (FK), pdf_conversion_enabled, before_after_url, unit (mm/inch), check_workorder, check_cutting, check_safezone, upload_callback_url |
| **워커 인증코드 분리** | site.worker_auth_code (편집기 인증코드와 별도) — 워커 호출 시 별도 토큰 |
| **워커 잡 생성 시 사이트 default 자동 적용** | `POST /worker-jobs/synthesize/external` 호출 시 site의 default 옵션을 잡 옵션에 머지 |
| **admin 신규 메뉴: 워커관리 > 사이트별 설정** | `apps/admin/src/pages/Sites/SiteWorkerSettings.tsx` |
| **현재 admin 워커관리 메뉴 보강** | `WorkerJobs/WorkerJobList.tsx`는 잡 데이터만, 사이트별 설정 페이지는 없음 |

### 3-4. 단일 워커 코드 + 사이트별 옵션 모델

```
[Storige Worker]  ← 단일 코드베이스, 단일 운영 (1명이 관리)
     │
     ├─ Job 생성 시 site_id 파라미터
     │     ↓
     └─ DB SiteWorkerSettings 조회 → default 옵션 머지 → 잡 처리
```

스토리보드의 메모 ("Storige·PrintCard 외 미래") 그대로 반영 — **워커 코드는 1번만 만들고, 사이트별 옵션 row만 추가**하면 새 사이트 즉시 운영.

---

## 4. 편집데이터 관리 + PDF 합성 데이터 관리

> 사이트별 편집 세션(편집데이터) + 워커 잡 결과(PDF 합성 데이터) 조회·관리.
> 스토리보드 매핑: **편집데이터관리** + **워커데이터관리**

### 4-1. 스토리보드 요구사항

#### 편집데이터관리 (페이지 7)
```
[편집데이터관리]
  검색: 카테고리 / 편집명 / 고객명 또는 아이디 / 작업상태 (편집중/편집완료)
  컬럼: 주문번호 / 편집코드 / 편집명 / 편집시작일 / 마지막수정일 / 편집완료일 / 편집수정 / 복사 / 삭제
```

#### 워커데이터관리 (페이지 8 좌측 메뉴에 명시 + 페이지 9 placeholder)
```
[워커데이터관리]  ← 페이지 본문 비어있음, 메뉴만 존재
  추정: 워커 잡 (validate/convert/synthesize) 결과 조회·다운로드·재처리
```

### 4-2. 현재 구현 상태

| 항목 | 페이지 | 엔티티 | 상태 |
|------|--------|--------|------|
| **편집데이터관리** | [`EditSessions/EditSessionList.tsx`](apps/admin/src/pages/EditSessions/EditSessionList.tsx) | `edit-sessions/entities/edit-session.entity.ts` (id, order_seqno, member_seqno, mode, status, template_set_id, canvas_data, completed_at, callback_url) | ✅ 구현 (기본 검색·조회) |
| **워커데이터관리** | [`WorkerJobs/WorkerJobList.tsx`](apps/admin/src/pages/WorkerJobs/WorkerJobList.tsx) | `worker-jobs/entities/worker-job.entity.ts` (id, type, status, edit_session_id, file_id, input/output_file_url, options, result, error_message, ...) | ✅ 구현 |
| 워커 테스트 페이지 | [`WorkerTest/WorkerTestPage.tsx`](apps/admin/src/pages/WorkerTest/WorkerTestPage.tsx) | — | ✅ Before/After 미리보기 + 테스트 잡 발사 |
| 편집검토 (Review) | [`Reviews/ReviewList.tsx`](apps/admin/src/pages/Reviews/ReviewList.tsx) + `ReviewDetail.tsx` | — | ✅ 추가 구현 (스토리보드에 없는 기능, 보너스) |

### 4-3. 미구현 / Gap

| Gap | 영역 | 작업 |
|-----|------|------|
| **편집데이터관리 검색 필터 보강** | 편집세션 | 카테고리 / 작업상태 / 고객 ID / 주문번호 / 기간 등 다중 필터 (현재 검증 필요) |
| **편집데이터 복사 기능** | 편집세션 | 스토리보드: 복사 버튼. 현재 구현 여부 검증 필요 |
| **편집데이터 사이트별 필터** | 편집세션 | 멀티 사이트 진입 시 site_id 필터 추가 |
| **워커데이터 페이지 본문 정의** | 워커잡 | 스토리보드는 placeholder. 권장: 잡 검색(타입/상태/사이트/기간) + 다운로드 + 재처리 + Sentry 링크 |
| **Before/After 미리보기 통합** | 워커잡 | 현재 `WorkerTestPage.tsx`에서만. 운영 잡 목록에서도 직접 비교 가능하면 운영자 디버깅 ↑ |
| **PDF 합성 결과 상세 메타** | 워커잡 | output 페이지 수, 파일 크기, 생성 시간 — 컬럼 추가 |

### 4-4. 사이트별 데이터 격리

플랫폼화 시:
```
edit_sessions, worker_jobs 테이블에 site_id 외래키 추가
admin: 상단에 사이트 선택 dropdown → 그 사이트 데이터만 표시
운영자: 본인 사이트만 + Storige 운영팀: 전 사이트 통합 조회
```

---

## 📊 현재 vs 플랫폼화 후 — 한눈 비교

| 기능 | 현재 admin | 플랫폼화 후 |
|------|-----------|-------------|
| 외부 사이트 추가 | ❌ `.env` 수정 + 운영팀 수동 키 전달 | ✅ admin > 기본설정에서 사이트 등록 → 인증코드 즉시 발급 |
| 사이트별 워커 정책 | ❌ 잡 호출 시마다 파라미터 | ✅ admin > 워커관리에서 사이트별 default 저장 |
| 사이트별 데이터 조회 | ❌ 모든 데이터 한 화면 | ✅ admin 상단 사이트 dropdown으로 필터링 |
| 사이트별 통계 | ❌ Sentry 단일 프로젝트 | ✅ Grafana/Sentry에 `site_id` 라벨 → 사이트별 잡 수/에러율 |
| 새 capability 추가 | ✅ (이미 단일 코드) | ✅ 그대로 |

---

## 🚀 권장 작업 순서

### Phase A — Site/Tenant 모델 (3.5일, 플랫폼화 기반)

1. **Site 엔티티 + Migration** (1일)
2. **ApiKeyStrategy 변경 (DB 조회)** (1일)
3. **admin > 기본설정 페이지** (0.5일)
4. **외부 endpoint에 `req.site` 컨텍스트 적용** (0.5일)
5. **사이트별 통계 (Grafana/Sentry 라벨)** (0.5일)

### Phase B — 워커 사이트별 옵션 (1.5일)

1. **SiteWorkerSettings 엔티티 + Migration** (0.5일)
2. **워커 잡 생성 시 default 머지 로직** (0.5일)
3. **admin > 워커관리 > 사이트별 설정 페이지** (0.5일)

### Phase C — 데이터 사이트 격리 + 보강 (1.5일)

1. **edit_sessions, worker_jobs에 site_id 추가** (0.5일)
2. **admin 페이지에 사이트 선택 dropdown** (0.5일)
3. **편집데이터관리 검색 필터 보강** (0.5일)

### Phase D — 라이브러리 사이트 분리 (선택, 1일)

1. 라이브러리 5종에 site_id NULL 컬럼 추가
2. admin 카테고리 관리에 사이트 분리 UI

### Phase E — 카테고리/라이브러리 누락 옵션 (1일)

1. 카테고리 페이지표기/작업선/재단선/안전선 옵션 (0.5일)
2. 라이브러리 QR코드 모듈 신설 (0.5일)

**합계**: A + B + C = **6.5일** (멀티사이트 핵심) / D + E = **2일** (선택)

---

## 🎯 PHP 통합과의 관계

PHP 통합 컷오버 시점에 Phase A 완료가 권장됨:
- **Phase A 미완**: 북모아 1개 사이트 운영 가능, 다른 사이트 추가는 수동 (`.env` 편집 + 재배포)
- **Phase A 완료**: admin에서 사이트 추가 → 인증코드 발급 → PHP 팀에 전달, 코드 변경 0

PHP 통합 가이드 v3.0에서는 단일 `STORIGE_API_KEY` 사용. Phase A 후엔:
- 사이트마다 다른 코드, 동일한 통합 가이드 그대로 사용
- v3.0 가이드에 "사이트별 키 발급 흐름" 한 섹션 추가만 필요

---

## 📚 참조

- 입력 자료: `~/Desktop/admin storyboard.pdf` (텍스트 추출본 `/tmp/storige-storyboard/storyboard.txt`)
- 마스터 트래커: [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md)
- PHP 통합 가이드: [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md)
- 시스템 통합 개요: [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) v2.5
- 향후 인프라: [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md)

다음 단계: 사용자가 Phase A 진행 결정 시 기술 설계 문서(스키마 + Migration + API 변경) 추가 작성 후 작업 진행.
