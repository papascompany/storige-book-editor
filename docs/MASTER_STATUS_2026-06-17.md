# Storige 마스터 트래커 — 2026-06-17

> **이전 마스터**: [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) (편집기 고객/관리자 모드 분리, 운영 베이스 디자인 흐름 완성)
>
> **이번 사이클**: 2026-06-17 — 멀티테넌시 P1(인증/테넌트 기반) + P2a(데이터모델 site_id) 프로덕션 배포 · admin 비밀번호 변경 기능 · 배포 파이프라인 복구

## 0. 한 줄 요약

> 멀티테넌시 **P1(인증/테넌트 기반) + P2a(데이터모델 site_id 12테이블)** 를 프로덕션에 배포·검증(회귀 0). 단 **격리는 아직 비활성**(site_id 전부 NULL = 시스템 공유, P2b 조회격리 미착수) → 동작 불변·비파괴·bookmoa 무중단. 더불어 admin 비밀번호 변경 UI/API 추가, 장기 고착됐던 admin Vercel 배포 파이프라인(`ignoreCommand` 트랩) 복구.

## 1. 이번 사이클 완료 (커밋)

| 커밋 | 변경 | 영향 |
|---|---|---|
| `5945570` | 멀티테넌시 **P1** — 인증/테넌트 기반 (정의만, 라우터 적용은 P3) | `types`(UserRole+SITE_ADMIN/SITE_MANAGER, SiteRoleClaim, ROLE_PERMISSIONS), `UserSiteRole` 조인엔티티(`user_site_roles`), auth.service login/refresh JWT `siteRoles` 클레임(dual-mode: 없으면 전역), jwt.strategy 패스스루, RolesGuard SUPER_ADMIN 통과, TenantGuard + tenant-scope.helper(QueryScope, includeNull 기본 false). **비파괴·additive** |
| `8d9c13b` | 멀티테넌시 **P2a** — `site_id VARCHAR(36) NULL` 12테이블 추가 | templates·template_sets·product_template_sets·categories·library_categories·library_frames/backgrounds/cliparts/shapes/fonts·products·files + 인덱스. 전부 nullable·additive(기존 NULL=시스템공유/레거시 → **동작 불변**) |
| `59c660a` | admin 로그인 핫픽스 | 401 시 `//login`→`https://login/` 오류페이지 튕김 수정(axios 인터셉터: VITE_ROUTER_BASE 끝슬래시 제거 + `/auth/login`·`/auth/refresh` 401은 리다이렉트 제외) |
| `81edae2` | admin 비밀번호 변경 기능 | 신규 프로필 페이지(현재/새/확인, 최소 8자·일치검증) + `PATCH /auth/change-password`(전역 JwtAuthGuard 보호·`@CurrentUser().id` 본인만·`@Throttle` SEC-4·bcrypt.compare→genSalt(10)/hash). 보호 라우트 `profile`. shop 토큰은 user.id=undefined→'User not found' 거부(무영향) |
| `8a193ff` | P2a 마이그 멱등성 | 12 ADD COLUMN + 12 CREATE INDEX 에 `IF NOT EXISTS`(MariaDB 11.2) → 부분실패 후 재실행 안전 |
| `640e3e6` | admin/editor `vercel.json` ignoreCommand 견고화 | 배포 파이프라인 복구(§4 참조) |

## 2. 프로덕션 게이트 실행 결과 (2026-06-17, 오너 "옵션 A" 승인)

**실행 순서**: 전체 백업(db/storage/env) → `git pull`(HEAD `8a193ff`) → 마이그1 `user_site_roles` → 마이그2 `site_id` 12테이블 → API 재빌드/재배포(`docker compose build api && up -d api`) → nginx 재시작 → 검증.

### 2.1 사전 이중검증

| 검증 | 결과 |
|---|---|
| 라이브 스키마 점검 | `sites.id`·`users.id` 모두 `varchar(36) utf8mb4_unicode_ci` → FK 타입 정합 확인(abort 없음) |
| 충돌 점검 | `user_site_roles` 미존재 · 12테이블 `site_id` 미존재 → 충돌 없음 |
| 부팅 마이그레이터 | `synchronize=false`(NODE_ENV=production) 확정 · migration 메타테이블 없음(부팅 마이그레이터 없음) |
| 4렌즈 적대검증 워크플로 | criticals 0 · high 3(sites FK 타입 · 마이그2 멱등성 · 배포순서) **전부 사전해소** |

### 2.2 전수검증 — 회귀 0

| 검증 | 결과 |
|---|---|
| API health | 200 ✓ |
| admin 로그인 | 200 ✓ (P1 relation 정상) |
| change-password 무인증 | 401 ✓ |
| 스코프 테이블 13종 SELECT | 전부 200 ✓ (templates·template-sets·products·categories·library 5종·edit-sessions·worker-jobs = `site_id` SELECT 무오류) |
| 활성 사이트 7곳 shop-session | 전부 200 ✓ (북모아 메인·Default×2·ShareSnap·100p Books·bookmoa-mobile·rotated) |
| API 오류로그 5분 스캔 | 비어있음 ✓ |

## 3. 멀티테넌시 현재 상태

- **P1 인증/테넌트 기반 = LIVE** (프로덕션 배포·검증 완료).
- **P2a 데이터모델(`site_id` 12테이블) = LIVE**.
- ⚠️ **격리는 아직 비활성**: `site_id` 전부 NULL(시스템공유), 실제 조회 격리(P2b QueryScope 라우터 적용)는 미착수 → 현재 모든 데이터가 종전처럼 전역 노출(**동작 불변·비파괴·bookmoa 무중단**).
- **오너 결정**: 주문/이행 = **자체처리형**(Storige는 개인정보 미수신·미저장) · 빌링 = **보류** · 실행 = 준비 + 게이트.
- **인프라 준비도**: 약 70% 기깔림(Site 엔티티·`@CurrentSite`·edit_session/worker_job 스코핑). 핵심 잔여 갭 = User↔Site 관계(P1에서 `user_site_roles` 로 해소) + 조회 격리(P2b).

## 4. 배포 파이프라인 복구

- **증상**: admin Vercel 빌드가 마지막 성공배포 `ba0734013` 이후 **모든 커밋에서 ERROR** → 라이브 admin이 옛 빌드에 고착(P1/P2a는 admin 무관이나 axios 핫픽스·Profile/비번변경 UI 미배포).
- **근본원인**: `vercel.json` ignoreCommand `git diff $VERCEL_GIT_PREVIOUS_SHA HEAD` 가 PREVIOUS_SHA(옛 성공 SHA)가 얕은 클론에 없을 때 `fatal: bad object` → git 비정상종료(128) → 배포 ERROR(자기영속).
- **수정 `640e3e6`**: PREVIOUS_SHA 비었거나 클론에 없으면 `exit 1`(빌드 강제) 폴백 후 diff. admin+editor 둘 다 적용. → admin 재배포 READY(라이브), 프로덕션 번들에 비번변경 UI 문자열 확인 · axios 핫픽스도 함께 라이브.

## 5. 다음 개발 이슈 (포인터)

> 상세는 `docs/NEXT_ISSUES_2026-06-17.md` 로 정리(예정). 아래는 짧은 포인터.

- **P2b 조회격리**(회귀주의): controller `getTenantScope(req.user)` → service `applySiteScope(qb, alias, scope, {includeNull})`. template/library = `includeNull true`, product/file = `false`. ⚠️ `findByProduct`(bookmoa `/by-product`) = `includeNull true`/전역 fallback 강제(무중단).
- **P3 admin UI 멀티테넌시**: 테넌트 스위처 · 페이지 스코핑 · 권한 게이팅 · 운영자 계정 CRUD(`user_site_roles` 관리, role 입력검증).
- **P4 편집기 런타임**: Site 메타 적용(단위 mm 하드코딩 제거 · editorCss 주입 · 버전핀 · 라이브러리 site 필터).
- **P5 워커 공정성**: 큐 페이로드(`job.data`) `site_id` 전달 · 쿼터 · 우선순위 · site 메트릭(현재 3 글로벌큐 공정성 없음).
- **P6 운영**: 파일 storageKey site 네임스페이스 · 쿼터 · nginx `/storage` 인증(교차테넌트 접근 차단).
- **별도 트랙**: 고객 PDF 업로드 검증 갭(worker 폰트 dead code · 별색 노티 · 해상도 메시지 · 큐 병합) — Tier0.

### 오너 대기 항목

- 북모아 메인(PHP) 키 **cutover**(마지막 외부 cutover; bookmoa-mobile은 완료).
- PUBLIC 레포 **히스토리 정화** force-push 게이트.
- **bookmoa DB 자격증명 회전**(북모아 측 작업 필요).
- **admin 임시 비번**: 2026-06-15 보안회전으로 임시 비번 재설정 → 사용자가 프로필 비번변경 UI에서 본인 비번으로 교체 후 **VPS 보안파일 삭제** 예정.

## 6. 정본 링크 (로컬, 커밋 안 함)

- `.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md` — 멀티테넌시 설계 정본
- `.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md` — P1+P2a 통합 런북(§0/§4(e) 비번변경 검증, §5 P2a 롤백)

---

**최종 갱신**: 2026-06-17 · 6개 신규 커밋(`5945570`·`8d9c13b`·`59c660a`·`81edae2`·`8a193ff`·`640e3e6`) · 멀티테넌시 P1+P2a LIVE(격리 P2b 대기) · 배포 파이프라인 복구
