# 멀티테넌시 P3b — SITE_ADMIN 데이터라우트 + 테넌트 스위처 (2026-08-04)

> 브랜치 `feat/multitenancy-p3b` (origin/master `713cccc` 기준, worktree 격리).
> 설계 정본: `MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md` §4.2·§5. 선행: P1/P2a/P2b/P3a.

## 범위 (이번 슬라이스)

**API — 3중 스택(RolesGuard+SITE_ADMIN → TenantGuard → 서비스 assertSiteInScope)**
- 공통 헬퍼 신설: `assertSiteInScope`(행 소유권 — 공유 NULL 은 기본 변조 거부, `allowNull` 로 상세읽기 허용) +
  `resolveScopedSiteId`(생성 시 소유 site 강제 — 운영자 NULL 공유 생성 금지, 다중 배정 미지정=400)
- **template-sets**: 쓰기 12라우트 SITE_ADMIN 개방 + 행 소유권. pair/unpair/orientation-default/derive 는
  **양쪽 행** 소유권. copy=공유→자기 site 사본(큐레이션). create/update/query DTO 에 `siteId` 추가
  (스위처 필터 — 비전역은 applySiteScope 와 AND 교집합이라 유출 없음). findOne 상세읽기 격리(allowNull).
- **templates**: 동일 패턴 5라우트(+DELETE 는 ADMIN,SITE_ADMIN). force 삭제는 참조 템플릿셋 전부가
  자기 site 일 때만. findOne 상세읽기 격리.
- **library**: 6종(fonts/backgrounds/cliparts/shapes/frames/categories) 쓰기 18라우트 동일 패턴.
  운영자 생성 에셋 siteId 자동 소유. (fonts 목록은 기존 @Public·스코프리스 유지)
- **edit-sessions**: GET 목록 siteId 분기가 siteRoles 멤버십 허용(기존: staff·외부키만).
- **worker-jobs**: GET 목록/상세/통계 SITE_ADMIN·SITE_MANAGER 개방 + applySiteScope(includeNull=false —
  시스템 NULL 잡 비노출). 변이 라우트(convert/retry 등)는 ADMIN/MANAGER 유지.

**Admin UI**
- `TenantSwitcher`(헤더): 전역 admin=전체 site 드롭다운+"전체 사이트" / 운영자=자기 site 자동 고정
  (단일=태그, 다중=자기 site 간 전환, 이름은 portal 셀프뷰로 조회·403 시 id 폴백)
- `authStore.currentSiteId`(localStorage 지속, 로그아웃 시 정리)
- 목록 주입: TemplateSetList(+queryKey) · EditSessionList/WorkerJobList 는 `effectiveSiteId =
  스위처 ?? 로컬필터`(고정 시 로컬 site Select 숨김, sites 쿼리 비활성 — 운영자 403 방지)
- `GlobalOnlyRoute`: /sites·/operators·/storage-settings 라우트 가드(서버 403 이 최종 방어선, UX 계층)

## 검증 (실측)
- api `tsc --noEmit` 0err · **jest 64스위트 907 green**(기준선 896 + 신규 헬퍼 spec 11)
- admin `tsc` 0err · **vitest 78 green** · eslint(max-warnings 0) 0건
- api 변경파일 eslint: 신규 문제 0 — 잔존 3건(worker-jobs `NodeJS` no-undef 1err ·
  IsEnum/IsObject unused 2warn)은 **HEAD 기준선 재현 확인**(stash 왕복 실측)
- ⚠️ 로컬 Node 26(엔진 24 요구): canvas/better-sqlite3 네이티브 빌드 불가 기저 →
  worktree 는 `--ignore-scripts` 설치(better-sqlite3 는 api src 미사용 실증). CI(Node24)가 정본 게이트.
  ⚠️ `/opt/homebrew/opt/node@24` 심링크는 **26.5.1 을 가리키는 스테일** — 이 Mac 에 실 Node24 없음.

## 프로덕션 영향 판단
- 기존 데이터는 template_sets/templates/library 전부 siteId=NULL(공유) → allowNull 읽기 경로로
  **현행 거동 무변경**. 전역 admin(ADMIN/SUPER_ADMIN/MANAGER)은 scope.isGlobal 로 전 라우트 무변경.
- 마이그레이션 불필요(컬럼 기존재).

## ✅ 배포 완료 — LIVE (2026-08-04 밤)

| 단계 | 결과 |
|---|---|
| master 머지 | `d481728`(feat) → CI+gitleaks **success** |
| 후속 | `5e95a20` 기준선 lint 3건 해소 + **CI api lint 게이트 신설** → CI success |
| admin | Vercel 자동배포 Ready |
| API | VPS 수동배포(빌드→up→**nginx 재시작**) · 롤백 태그 `storige-api:pre-p3b` |

**라이브 검증(실측)**: health ok · admin 로그인 200 · `GET /template-sets?siteId=…` **200**
(구 API 였다면 forbidNonWhitelisted 400 — 스큐 해소 실증) · `GET /worker-jobs/stats` **200**.
**2026-08-05 23:20 재확인**: 병행 트랙이 `3f6fd20` 으로 재배포한 현 빌드에서도 위 3종 그대로 200/ok.

### 기준선 lint + CI 갭 (동반 해소, `5e95a20`)
- `eslint.config.js` globals 에 `NodeJS` 등재 — `NodeJS.ErrnoException` no-undef 는 **오탐**이었다(설정 누락).
- `template.dto` IsEnum · `template-set.dto` IsObject 미사용 import 제거.
- ⚠️ **CI 에 api lint 게이트가 아예 없었다**(examples lint 만 존재) → error 가 나도 CI green 인
  honor system. ci.yml api job 에 lint 스텝 추가로 봉합. **editor lint 는 기저 실패 2건**
  (`apps/editor/src/test/setup.ts` 'Storage' no-undef)이라 이번에 등재하지 않았다 — 그 결함 해소 후 등재.

## 잔여 (P3b 후속 — 별도 슬라이스)
1. products/product-template-sets/템플릿 categories/format-presets — 목록 스코핑(P2b 미적용)부터 필요
2. templates/library 목록의 **스위처 명시필터**(전역 admin 뷰 편의 — 서버 siteId 파라미터 추가)
3. Reviews/Dashboard site 스코핑 · worker-jobs stats 의 site 필터 파라미터
4. TemplateSetForm 등 **생성 폼에 스위처 컨텍스트 주입**(현재 전역 admin 생성물은 기존대로 공유 NULL)
5. 시스템 에셋 "내 site 노출 토글"(§5.2 큐레이션 조인) · 온보딩 위저드
6. TenantGuard 가 MANAGER 를 비전역 취급하는 P1 잔재 — MANAGER 가 명시 siteId 요청 시 403 엣지
   (기존 플로우는 siteId 미전송이라 무영향, 정리 시 getTenantScope 와 일원화)
7. ⭐ **SITE_ADMIN 실계정 E2E 0회** — 코드·라우트는 라이브지만 실제 운영자 계정으로
   스위처 고정 / 목록 격리 / 타 site 변조 403 을 밟아본 적이 없다. **다음 세션 최우선.**
