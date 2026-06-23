# Storige 멀티테넌시 플랫폼 확장 — 설계 & 개발 계획 (CTO 분석 보고)

> 작성: 2026-06-17 · 근거: 코드베이스 7차원 정밀 분석(데이터모델·인증·admin·편집기/embed·워커·주문/외부계약·저장/운영).
> 목표: Storige 편집기를 **여러 외부 서비스가 각자 임베드·호출**하고, **각 사이트 운영자가 자신의 admin에서 자신의 템플릿·주문·라이브러리를 독립 관리**하며, 사이트 특성에 맞게 **편집기·워커를 효율적으로 운영**하는 멀티테넌트 SaaS로 확장.

> ## ✅ 오너 결정 (2026-06-17) — 설계 범위 확정
> 1. **주문/이행 = 자체 처리형**: 모든 사이트가 자체 쇼핑몰에서 주문/배송/제작 처리. **Storige는 개인정보(이름·주소·전화·배송) 미수신·미저장** — `file_edit_sessions`는 order_seqno+편집+파일뿐, 개인정보는 bookmoa `member`/`order_common` 소유(참조만). → **개인정보 처리자 책임·주문/배송/결제 테이블 불필요**. site별 격리대상 = 편집세션·파일·워커잡·템플릿·라이브러리·상품매핑·site설정.
> 2. **빌링 = 보류**: 집계/과금 스키마(site_usage_daily 등) 지금 안 깜. 추후 솔루션공급 계약 시 사이트별. (§8 빌링·§3.1 site_usage_daily 보류)
> 3. **프로덕션 실행 = 준비+게이트(최대안전)**: 코드·마이그스크립트·런북·적대검증 완성 + 외부영향0·비파괴·editor 자동배포만 자동. **라이브 DB마이그·VPS재배포·외부 cutover는 오너가 점검윈도우 실행**.
> 4. ⚠️ **보안 ground-truth 정정**: webhook SSRF(env+DB allowlist, Patch E)·ParentOrigin(Phase A-1)·파일다운로드 JWT(2026-05-03)는 **이미 구현됨**(§9 일부 무효). 진짜 P0갭=`downloadFileExternal` site스코핑(file.site_id=P2 의존). **각 Phase 구현 전 코드 ground-truth 필수**(분석 워크플로 부정확 전례).

---

## 0. Executive Summary

**현재 위치**: Storige는 이미 멀티사이트의 **뼈대**를 갖췄다. `Site` 엔티티가 풍부(도메인·인증코드·콜백·검증규칙·CSP·에디터 번들/버전/런치모드·보존정책)하고, 외부 호출은 `X-API-Key → @ApiKeyGuard → @CurrentSite()`로 사이트 컨텍스트가 자동 주입되며, `edit_session`·`worker_job`·외부 업로드 `file`은 이미 `site_id`로 스코핑된다(Phase C 진행중). 4개 사이트(bookmoa PHP `1391c5b4`, bookmoa-mobile `26183a7c`, ShareSnap `9a5d4e0c`, 100p Books `729ad8a7`)가 운영 중이다.

**하지만 "운영자 독립 관리"까지는 6대 갭이 있다**. 가장 큰 갭은 **User↔Site 관계 부재** — 모든 ADMIN/MANAGER가 전역이라 "사이트 운영자가 자기 것만 관리"가 구조적으로 불가능하다. 그리고 Template/Library/Product가 전역 공유, Admin UI가 단일 테넌트, 편집기가 Site 메타를 적용하지 않고, 워커는 사이트 공정성/격리가 없으며, 파일 저장소는 네임스페이스·쿼터·접근제어가 없다.

**핵심 전략**: ① **하위호환 무중단** — `@CurrentSite` 자동주입 덕에 기존 4개 사이트의 외부 API 계약은 거의 그대로 유지된다(내부 구현만 확장). ② **보안 선결** — webhook SSRF·nginx 무인증 파일서빙·ParentOrigin 검증은 멀티테넌시 *이전에* 막아야 한다(테넌트가 늘수록 교차접근 위험 증가). ③ **단계적 마이그레이션** — `site_id=NULL` 백필 → NOT NULL 승격 → 자동 스코핑은 인덱스 lock·데이터 정합 위험(`high`)이라 백업·dry-run·maintenance window 필수.

**규모감**: 6개 Phase, 추정 대략 **8~14주**(보안 선결 1주 + 인증기반 2주 + 데이터스코핑 2~3주 + Admin UI 2~3주 + 편집기 런타임 1~2주 + 워커 1~2주 + 운영/빌링 1~2주). Phase 1~2가 위험의 대부분.

---

## 1. 현재 멀티테넌시 준비도 진단 (7차원)

| 차원 | ✅ 갖춰진 것 | ❌ 핵심 갭 | 마이그 복잡도 |
|---|---|---|---|
| **데이터 모델** | `site_id` FK = `edit_session`·`worker_job`. Site 엔티티 풍부. | User/Template/TemplateSet/Library/Product/File **전역**. 소유권 모델 부재. | high |
| **인증/테넌트 컨텍스트** | 외부=`@ApiKeyGuard`+`@CurrentSite`. shop-session JWT에 siteId. | **admin JWT엔 siteId 없음**. User↔Site 미정의. 자동 스코핑(TenantGuard) 없음. | high |
| **Admin 앱** | `Sites` 페이지(슈퍼관리자). EditSessions/WorkerJobs에 site 필터(Phase C-3). | Templates/Library/Products/Dashboard **전역·무필터**. 테넌트 스위처 없음. 권한 게이팅 없음. | high |
| **편집기/embed** | Site에 editorBundleUrl/CssUrl/Version/defaultUnit/check*. CORS/CSP per-site. | **embed가 Site 메타를 조회·적용 안 함**(단위 mm 하드코딩·CSS 미주입·버전핀 미동작). 라이브러리 `@Public` 무필터. | high |
| **워커/큐** | `worker_job.site_id`. site.check*/pdfConversionEnabled DB 저장(`mergeSiteWorkerDefaults`). | **큐 페이로드에 site 옵션 미전달** → 워커가 검증규칙 못 읽음. 3개 글로벌 큐, 공정성/쿼터/우선순위/site메트릭 **전무**. | high |
| **주문/외부계약** | edit-session 2종(외부 `file_edit_sessions` + 내부 `edit_sessions`). 외부 계약 안정. | User-Site FK 없어 SITE_ADMIN 불가. webhook 단일 URL. API 버저닝 부재. | high(계약 critical) |
| **저장/운영/빌링** | storage_backend(local\|s3), site.retentionDays, Grafana(P2-8). | storageKey **네임스페이스 없음**(`uploads/{file}`). site별 쿼터/메트릭 없음. **nginx `/storage/` 무인증** → 교차접근. cascade 삭제 없음. | high |

> ⚠️ **2종 edit-session 엔티티 병존**(`edit-sessions/` 외부용 site-scoped vs `editor/` 내부 user-scoped)은 향후 통합 시 백필 부담. 이번 설계에서 정합 결정 필요(§11 열린결정).

---

## 2. 목표 아키텍처 — 테넌트 모델 & 스코핑 매트릭스

**테넌트 = Site.** 1 Site = 1 외부 서비스(쇼핑몰). 하나의 Storige 인스턴스가 N개 테넌트를 수용.

**3층 역할 모델**:
- **SUPER_ADMIN**(플랫폼 운영팀, Papas): 전역 — Sites CRUD, StorageSettings, 시스템 라이브러리, 모든 테넌트 조회, 빌링.
- **SITE_ADMIN / SITE_MANAGER**(외부 사이트 운영자): 자신의 site(들)만 — 템플릿·상품·주문·라이브러리 큐레이션·site 설정 일부.
- **(선택) SYSTEM_DESIGNER**: 중앙 템플릿 디자이너(전역 템플릿 풀 작성). 또는 SUPER_ADMIN에 흡수.

**스코핑 매트릭스 (결론)**:

| 리소스 | 권고 | 모델 |
|---|---|---|
| User | global pool + **UserSiteRole 조인**(user_id+site_id+role) | 한 계정이 여러 site를 다른 역할로 |
| Site | tenant 정의체 | SUPER_ADMIN만 CRUD |
| Template / TemplateSet | **hybrid** | 전역 공유 풀(site_id NULL) + `template_set_site_access`(site별 visibility) |
| Library(Frame/BG/Clipart/Shape/Font) + Category | **hybrid → site-scoped** | `site_id` FK(NULL=시스템공유) + site별 큐레이션 |
| Product / ProductTemplateSet | **site-scoped** | product에 site_id, PTS는 dual-mode(bookmoa sortcode + 타사 externalProductId) |
| File | **site-scoped** | `site_id` FK + storageKey `{siteId}/...` 네임스페이스 |
| EditSession / WorkerJob | **site-scoped(이미)** | NOT NULL 승격 + 백필 |
| StorageSettings | **super-admin-only** | 전역 driver + (선택)site.s3Config/quota override |
| EditorContent / EditorDesign | **global-shared** | 시스템 프리셋·개인 디자인은 site 무관 |

**격리 원칙**: "공유가 기본인 리소스(라이브러리·템플릿)는 hybrid(전역 풀 + per-site 가시성), 소유가 명확한 리소스(주문·상품·파일)는 site-scoped." 시스템 자산은 `site_id=NULL`(모든 테넌트 접근), 테넌트 자산은 `site_id=<uuid>`.

---

## 3. 데이터 모델 확장 설계

### 3.1 신규/변경 테이블
```
-- 인증/테넌트
user_site_roles      (id, user_id FK, site_id FK, role, created_at)   -- 다대다 권한, 복합 unique(user_id,site_id)
sites.+               (s3_config json null, storage_quota_bytes bigint null, library_policy enum('all','whitelist'))

-- 데이터 스코핑 (site_id FK nullable 추가; NULL=시스템공유 또는 backfill 대상)
templates.+site_id            (null=global pool)
template_sets.+site_id        (null=global pool)
template_set_site_access      (template_set_id, site_id, access_level enum('full','readonly','disabled'))  -- 신규
library_frames/backgrounds/cliparts/shapes/fonts.+site_id   (null=시스템 라이브러리)
library_categories.+site_id   (null=시스템)
products.+site_id
product_template_sets.+site_id  (+ external_product_id varchar null = 타사 상품 매핑)
files.+site_id                (+ storageKey 네임스페이스)
edit_session.site_id          → NOT NULL 승격(백필 후)
worker_job.site_id            → NOT NULL 승격(백필 후)

-- 운영/연동
webhook_configs               (id, site_id, event enum, callback_url, retry_policy json, signing_secret)  -- 신규(uploadCallbackUrl 다중화)
site_usage_daily              (site_id, date, order_count, storage_bytes, worker_seconds)  -- 빌링 집계
```

### 3.2 마이그레이션 순서(비파괴 우선)
1. **Additive only**(NULL 허용 FK 추가) — 기존 동작 무변경, 즉시 배포 가능.
2. **백필**: `site_id` 추론 가능한 레코드 채움. edit_session/worker_job/file은 `order_seqno>0 → bookmoa(1391c5b4)`, 그 외 결정불가는 NULL 유지 후 검사 스크립트. 템플릿/상품/라이브러리는 "기존 = 시스템공유(NULL 유지)" 정책 권고(전체 동결 회귀 방지 — Part B 정책과 동일 철학).
3. **NOT NULL 승격**은 edit_session/worker_job/file만(주문은 site가 명확). 템플릿/라이브러리는 NULL 의미(시스템공유) 유지.
4. **인덱스**: 모든 `site_id`에 idx. 대형 테이블(file_edit_sessions, worker_jobs)은 MariaDB online DDL 또는 maintenance window(lock 위험).

> 운영 규약 준수: prod `synchronize=off` + `forbidNonWhitelisted` → 마이그레이션 직접 실행 후 API 재배포 순서([[feedback_schema_change_deploy]]). 실행 전 **full backup + dry-run** 필수.

---

## 4. 인증/인가 설계

### 4.1 역할 & 토큰
- `UserRole`에 `SITE_ADMIN`, `SITE_MANAGER` 추가(packages/types). 기존 ADMIN=SUPER_ADMIN 의미 유지(하위호환).
- **UserSiteRole 조인**: 한 계정이 `[{site:9a5d…, role:SITE_ADMIN}, …]`. SUPER_ADMIN은 조인 없이 전역.
- **Admin JWT 확장**: 로그인 시 `siteRoles: [{siteId, role}]` 클레임 주입. 기존 토큰은 만료 후 재발급(dual-mode 기간 둠).
- shop-session JWT의 siteId는 그대로(이미 동작).

### 4.2 자동 스코핑 — TenantGuard + QueryScope
- **TenantGuard**(신규): admin 요청의 `requestedSiteId ∈ user.siteRoles` 검증. SUPER_ADMIN은 통과.
- **QueryScope 인터셉터/리포지토리 헬퍼**: site-scoped 엔티티 조회에 `WHERE site_id = :ctx OR site_id IS NULL(시스템공유)` 자동 주입 → service마다 수동 필터 누락 위험 제거(분석에서 반복 지적된 핵심 위험).
- 외부 경로는 기존 `@CurrentSite` 유지(무변경).

### 4.3 보안 선결(§10 Phase 0와 연결)
- webhook callbackUrl을 `site.allowedOrigins`/`webhook_configs` 화이트리스트로 검증(SSRF 차단).
- nginx `/storage/` 무인증 → site별 네임스페이스 + 서명URL(또는 API 프록시 인증) 도입.
- ParentOrigin: embed `config.parentOrigin` 필수화 + postMessage `targetOrigin` 고정 + 서버에서 `Site.frameAncestors` 검증.

---

## 5. Admin 멀티테넌시 (운영자 관리자페이지)

### 5.1 권한 매트릭스
| 페이지 | SUPER_ADMIN | SITE_ADMIN |
|---|---|---|
| Sites(테넌트 CRUD·키발급) | ✅ | ❌(자기 site 설정 일부만 read/제한수정) |
| StorageSettings(driver·R2키) | ✅ | ❌ |
| Templates/TemplateSets | ✅ 전역 | ✅ 자기 site 큐레이션(+시스템 풀 readonly) |
| Library | ✅ 시스템+전체 | ✅ 자기 site 에셋 + 시스템 에셋 큐레이션(노출 토글) |
| Products/ProductTemplateSets | ✅ 전역 | ✅ 자기 site |
| EditSessions/WorkerJobs/Reviews | ✅ 전역 + site 필터 | ✅ 자기 site만 |
| Dashboard | ✅ 전역 + 테넌트 스위처 | ✅ 자기 site 통계 |

### 5.2 UI/UX
- **테넌트 스위처**(상단 헤더): SUPER_ADMIN은 site 드롭다운으로 컨텍스트 전환, "전체 보기" 옵션. SITE_ADMIN은 자기 site 고정(스위처 숨김 또는 다중 site 시 선택).
- **`useCanAccess(page)` 공통 훅** + 라우트 가드 → 메뉴/페이지 조건부 노출(중복 ProtectedRoute 제거).
- 페이지별 목록 쿼리에 현재 테넌트 컨텍스트 자동 주입(authStore에 `currentSiteId`).
- **온보딩 위저드**(SUPER_ADMIN): 신규 site 등록 → 운영자 계정 초대 → 키 발급 → 초기 라이브러리/템플릿 큐레이션.
- Library 큐레이션 UX: 시스템 에셋은 "내 site에 노출" 토글(삭제 아님 — 다른 site 영향 0), site 전용 에셋은 업로드/CRUD.

---

## 6. 편집기 테넌트 런타임

**목표**: 한 번 임베드된 편집기가 호출 site의 컨텍스트로 브랜딩·기능·검증·버전을 적용.

- **Site 메타 전달**: `GET /sites/current`(X-API-Key) 또는 EditSession 응답에 `site` 블록(editorCssUrl/Version/defaultUnit/check*/branding) 추가. embed.tsx 초기화에서 적용.
- **적용 지점**:
  - `defaultUnit` → `useSettingsStore` 초기화(현 mm 하드코딩 제거).
  - `editorCssUrl` → `<link>` 주입(⚠️ URL 화이트리스트 + CSP 필수, XSS 방어).
  - `editorVersion` → 번들 버전 핀(다버전 CDN 운영비 트레이드오프 — §11 결정).
  - 검증규칙(check*) → 세션 `metadata.checkOptions` 스냅샷 → 워커 전달(§7).
  - 라이브러리 큐레이션 → site `library_policy`(all|whitelist) 기반 필터(현 `@Public` 무필터 → site 필터, 단 외부 호출 하위호환 위해 기본 'all').
- **브랜딩**: 로고/테마/색상(controls)·"편집완료" returnUrl·beforeAfterUrl.
- **사이트별 효율운영**: editorVersion 핀으로 무거운 사이트만 특정 버전 고정 → 회귀 격리.

---

## 7. 워커 공정성 & 격리

**핵심 결함**: site 검증옵션이 `mergeSiteWorkerDefaults`로 DB(job.options)엔 저장되나 **큐 페이로드(job.data)에 미전달** → 워커가 site별 검증규칙을 적용 못 함. 공정성·쿼터·우선순위·site메트릭 전무.

- **즉시(저위험)**: 큐 페이로드에 `{ siteId, validationOptions }` 명시 추가 → 워커 processor가 site 검증규칙(check*) 적용. site별 메트릭 라벨(`site_id`) 추가 → Grafana "사이트별 큐 깊이/지연/에러" 대시보드.
- **공정성**: site별 `max_concurrent_jobs` / rate limit(Bull `limiter`) / weighted fair queueing → 한 사이트 대량잡이 타 사이트 굶김 방지. synthesis 외 validation/conversion에도 우선순위 확장.
- **격리(점진)**: 공유 워커 유지(기본) + `site.workerPoolTag('default'|'heavy')` → 무거운 사이트 전용 워커 그룹(env select). 신규 site 추가 시 워커 재배포 회피.
- **SLA**: site별 stale timeout/우선순위로 "100p Books synthesis < 5분" 같은 보장 가능.
- ⚠️ 다운로드 권한: job 생성 site와 요청 site 일치 검증(현재 없음 — 보강).

---

## 8. 저장 / 운영 / 빌링

- **네임스페이스**: storageKey `{siteId}/uploads/{file}` 또는 file.site_id FK → site별 격리·삭제·쿼터·비용추적. 기존 파일은 호환 URL 유지(이중 경로 또는 점진 마이그레이션).
- **접근제어**: nginx `/storage/` 무인증 → site 네임스페이스 + 서명URL/프록시 인증(교차 테넌트 다운로드 차단). ⚠️ 외부 300+ URL 의존([[project-storage-r2-abstraction]] 경계)이라 점진 전환 필수.
- **쿼터**: `site.storage_quota_bytes` → 업로드 시 체크(악성/버그 사이트가 전체 마비 방지).
- **per-site 저장백엔드**(선택): `site.s3Config`(자체 R2 버킷) → 비용분리·geo·암호화 정책. 없으면 글로벌 fallback.
- **빌링 기반**: `site_usage_daily`(주문수·스토리지·워커시간) 집계 → 사용량 기반 과금/리포트. Grafana site 라벨.
- **cascade/보존**: Site suspend/삭제 시 고아 파일 정리. 보존 cron을 site별 분산(부하 피크 방지).

---

## 9. 보안 선결 과제 (Phase 0 — 멀티테넌시 *이전*)

테넌트가 늘수록 폭증하는 위험이라 **선결**:
1. **Webhook SSRF**: `EditSession.callbackUrl`/`uploadCallbackUrl`을 site 화이트리스트로 검증.
2. **nginx 파일 무인증**: site 네임스페이스 + 인증/서명 → 교차 테넌트 파일 접근 차단.
3. **ParentOrigin**: embed parentOrigin 필수화 + `Site.frameAncestors` 서버검증(iframe hijack/XSS).
4. **다운로드 권한**: 워커 산출 다운로드를 요청 site로 스코핑.
5. (참고) WEBHOOK_SECRET 미사용·base64 서명 위조가능([[project-secret-rotation-2026-06-15]]) → HMAC 서명 보강.

---

## 10. 단계별 개발 계획

| Phase | 범위 | 외부영향 | 위험 | 추정 |
|---|---|---|---|---|
| **P0 보안 선결** | webhook 화이트리스트·nginx site격리/인증·ParentOrigin·다운로드 스코핑 | 낮음(신규 site만 강제) | 중 | ~1주 |
| **P1 인증/테넌트 기반** | UserSiteRole·SITE_ADMIN·JWT siteRoles·TenantGuard·QueryScope 헬퍼 | **0**(admin 내부만) | 중 | ~2주 |
| **P2 데이터 스코핑** | site_id FK additive→백필→NOT NULL(주문/잡/파일)·자동스코핑 적용 | 낮음(@CurrentSite 자동) | **높음**(마이그·lock) | ~2~3주 |
| **P3 Admin 멀티테넌시 UI** | 테넌트 스위처·페이지 스코핑·권한 게이팅·site 대시보드·온보딩 위저드 | 0(내부) | 중 | ~2~3주 |
| **P4 편집기 런타임** | Site 메타 API+embed 적용(브랜딩/단위/큐레이션/버전핀) | 중(CSS/단위 미리보기) | 중 | ~1~2주 |
| **P5 워커 공정성/격리** | 큐 페이로드 site옵션·site별 우선순위/rate limit·site 메트릭·(선택)poolTag | 낮음(내부) | 중 | ~1~2주 |
| **P6 운영/빌링** | 스토리지 네임스페이스/쿼터·usage 집계·빌링 리포트·cascade | 중(파일경로) | 중 | ~1~2주 |

**의존성**: P0 → P1 → P2(P1 선행) → P3·P4·P5(P2 후 병렬 가능) → P6. **권고: P0+P1을 먼저(외부영향 0, 위험관리), bookmoa와 1차 호환성 검증 후 P2 진행.**

---

## 11. 외부 계약 하위호환 & 마이그레이션 위험

- **무영향(자동주입)**: bookmoa PHP·mobile은 `@CurrentSite` 자동주입이라 키 기반 호출 그대로 동작. admin은 내부라 외부 무관.
- **주의(critical)**: ProductTemplateSet에 site 필터 도입 시 `siteId 미지정 → global fallback` 로직 필수(PHP가 공통 템플릿 기대). **API 버저닝 부재**(201/200 혼동 등) → 응답 포맷 변경은 신규 필드 opt-in 또는 `/v2`로.
- **마이그레이션 위험**: site_id 백필 오류(전부 bookmoa 할당 시 ShareSnap 오염), NOT NULL 승격 데이터손실, 대형테이블 인덱스 lock → **백업·dry-run·조건부 SQL·rollback 계획·maintenance window** 필수.
- **신규 온보딩**: ShareSnap/100p는 User-Site 관계 없으면 운영자 계정·초기 큐레이션 불가 → P1이 이들 본격 가동의 선결.

---

## 12. 열린 의사결정 (CTO/오너)
1. **Template 소유권 모델**: (A) 중앙 디자이너가 전역 풀 작성 + site visibility 토글(hybrid, 권고) vs (B) site별 자체 템플릿 작성. → 운영 인력 구조에 의존.
2. **Library 격리 강도**: hybrid(시스템공유+큐레이션, 권고) vs 완전 site-scoped(에셋 비용↑·중복).
3. **편집기 버전 핀**: site별 editorVersion enforce(회귀격리 vs 다버전 CDN 운영비) 여부.
4. **빌링 모델**: 주문수 / 스토리지 / 워커시간 중 과금 기준.
5. **per-site R2 버킷**: 비용분리 필요성(글로벌 단일 vs site별).
6. **2종 edit-session 통합** 시점(외부 file_edit_sessions vs 내부 edit_sessions).
7. **마이그레이션 윈도우**: VPS 단일 인스턴스라 인덱스 추가 lock — 점검 시간 확보 가능 여부.

---

## 13. 결론

멀티테넌시의 **70%는 이미 인프라가 깔려 있다**(Site 엔티티·키 인증·외부 스코핑). 남은 30%의 핵심은 **① User↔Site 권한 모델(P1)과 ② 데이터 스코핑+자동 격리(P2)**이며, 이 둘이 "운영자 독립 관리"를 여는 열쇠다. 외부 계약은 자동주입 덕에 무중단 확장이 가능하나, **보안 선결(P0)과 마이그레이션 안전(P2)** 이 성패를 가른다. P0+P1을 먼저 착수해 외부영향 0으로 기반을 깔고, bookmoa 호환 검증 후 P2로 진행하는 것을 권고한다.

> 관련 메모리: [[project-storige-state]], [[project-embed-route-integration]], [[project-sharesnap-integration]], [[project-100pbooks-integration]], [[project-storage-r2-abstraction]], [[feedback-schema-change-deploy]], [[project-production-lock-design]].
