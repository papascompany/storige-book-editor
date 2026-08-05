# RESUME PROMPT — 2026-08-05 (멀티테넌시 트랙 전용 인계본)

> ⚠️ **이 문서는 날짜 정본이 아니라 트랙 인계본이다.** 편집기(edicus) 트랙 정본은
> `RESUME_PROMPT_2026-08-04.md` 이며 **병행 세션이 계속 갱신 중**이다 — 이 문서가 그것을 대체하지 않는다.
> 두 트랙은 같은 master 를 공유하되 파일 소유권이 겹치지 않는다(멀티테넌시=api/admin, edicus=editor/canvas-core/worker).
>
> 작성 시각 **2026-08-05 23:20 KST** · 기준 master `3f6fd20`(병행 트랙이 계속 진행 → **해시는 즉시 스테일**).
> 멀티테넌시 P3b **코드 잔여 0 · 프로덕션 LIVE**. 다음 최우선 = **SITE_ADMIN 실계정 E2E**.

---

## 0. 착수 전 확인 (순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git rev-parse --short origin/master     # 3f6fd20 보다 앞서 있으면 정상(병행 트랙)
git status -sb                                        # ⚠️ 현재 브랜치 확인 — master 가 아닐 수 있다
git worktree list
ssh-add -l | head -1                                  # 비면: ssh-add ~/.ssh/id_ed25519
```

- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/레시피 실값.
- ⚠️ **메인 체크아웃은 병행 세션이 점유할 수 있다.** 코드 편집은 **worktree 격리 필수**:
  ```bash
  git worktree add .claude/worktrees/<name> -b feat/<name> origin/master
  ```
  기존 워크트리 `.claude/worktrees/multitenancy-p3b` 가 남아 있으면 재사용하거나
  `git worktree remove` 로 정리한다(현재 브랜치 `docs/p3b-handoff`, 코드 변경 없음).
- ⚠️ **커밋 직전 `git status -sb` 를 별도 호출로 실행**하고 결과를 본 뒤 커밋할 것.
  commit 과 같은 Bash 호출에 체이닝하면 출력을 보기 전에 커밋된다(08-04 실사고: 문서 커밋이
  타 세션 브랜치에 실림 — 무해해서 그대로 뒀다). 타 세션 미커밋 변경은 **무접촉**.

---

## 1. 완료 — 멀티테넌시 P3b (LIVE)

**커밋**: `d481728`(feat, 23파일) + `5e95a20`(기준선 lint 3건 + CI api lint 게이트).
**상세 정본**: `.cursor/plans/MULTITENANCY_P3B_STATUS_2026-08-04.md` (범위·검증·잔여 전량).

- **API 3중 스택**: RolesGuard(+SITE_ADMIN) → TenantGuard(명시 siteId 멤버십) → 서비스
  `assertSiteInScope`(행 소유권 — id 로 접근하는 변이의 IDOR 차단). 생성은 `resolveScopedSiteId`
  로 소유 site 강제(운영자의 공유 NULL 생성 금지, 다중 배정 미지정=400).
- 개방 범위: template-sets 12 · templates 5 · library 18 쓰기라우트, edit-sessions 목록
  siteRoles 멤버십, worker-jobs 목록/상세/통계 스코핑(includeNull=false).
- **admin**: `TenantSwitcher`(전역=드롭다운+전체보기 / 운영자=자동 고정) · `authStore.currentSiteId`
  · 목록 3페이지 주입 · `GlobalOnlyRoute`(/sites·/operators·/storage-settings).
- **검증**: api jest **907 green**(기준선 896+헬퍼 11) · admin vitest 78 · 양쪽 tsc 0err ·
  CI success · 라이브 3종 200/ok(현 `3f6fd20` 빌드에서 재확인).
- **무중단 근거**: 기존 데이터 전부 siteId=NULL(공유) → allowNull 읽기로 현행 유지.
  전역 admin 은 isGlobal 로 전 라우트 무변경. 마이그레이션 불필요.

---

## 2. 잔여 (전부 착수 지시 필요)

### ⭐ 최우선 — SITE_ADMIN 실계정 E2E (0회)
코드·라우트는 라이브지만 **실제 운영자 계정으로 밟아본 적이 없다**. 절차:
admin `/operators` 에서 SITE_ADMIN 계정 생성 → site 배정(예: ShareSnap `9a5d4e0c-…`) →
그 계정 로그인 → ① 스위처가 자기 site 로 고정되는지 ② 목록이 자기 site+공유만인지
③ 타 site 리소스 변이 403 인지 ④ /sites·/operators 접근 차단인지. 종료 후 테스트 계정 정리.

### P3b 후속 6건
`MULTITENANCY_P3B_STATUS_2026-08-04.md` §잔여 참조 — products/PTS/카테고리/판형 스코핑,
templates·library 스위처 명시필터, Reviews/Dashboard, 생성폼 컨텍스트 주입,
시스템에셋 노출 토글, TenantGuard MANAGER 비전역 엣지.

### 설계상 다음 Phase
P4 편집기 런타임(Site 메타 embed 적용) · P5 워커 공정성 · P6 운영/빌링.
정본 `.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md` §10.

### 트랙 밖 대기(변동 없음)
ⓐ GitHub Support GC — 08-04 재검증에서 표본 4 SHA 전부 **web 200/API 200 = 미정화**,
회신 대기 지속. `backup/*-pre-rebase-*` 3개 **push 절대 금지·보존**. 하루 1회 자동 재검증은 **추후 진행**.
ⓑ 파트너 실기기 회신 · 포토북 내지 첫 실주문 육안 3종.

---

## 3. 상태 스냅샷 (2026-08-05 23:20 KST 실측)

- master `3f6fd20` · 멀티테넌시 코드 잔여 0 · 워크트리 `multitenancy-p3b` 1개(코드 변경 없음)
- **VPS `~/storige` = `3f6fd20`** — 병행 트랙이 api·worker·**rembg 사이드카**까지 배포 완료.
  전 컨테이너 Up(mariadb/redis healthy, rembg healthy)
- 롤백 태그: `storige-api:pre-p3b`(P3b 직전) 외 기존 `pre-inner-spread`·`pre-node24` 등 유지
- CI 게이트: 기존 + **api lint 신설**(2026-08-04) — 이제 api lint error 는 CI red

---

## 4. 함정 색인 (이 트랙에서 확립)

**신설(08-04~05)**
- ⚠️ **VPS 는 자동배포가 아니다 — 실증.** cron=backup+monitor.sh 뿐, 레포 webhook 0개,
  deploy 워크플로 없음. **Vercel 3종(editor/admin/homepage)만 master push 자동배포**.
  api/worker 는 항상 수동(`docker compose up -d --build` + **nginx 재시작**).
- ⚠️ **`/opt/homebrew/opt/node@24` 는 26.5.1 을 가리키는 스테일 심링크** — 이 Mac 에 실 Node 24 가 없다.
  Node 26 에서는 canvas/better-sqlite3 네이티브 빌드가 깨져 워크트리 설치는
  `pnpm install --frozen-lockfile --ignore-scripts` 로 우회했다(better-sqlite3 는 api src 미사용 실증).
  **CI(Node 24)가 정본 게이트.**
- **테넌트 격리 3층을 혼동하지 말 것**: TenantGuard 는 요청에 **명시된** siteId 만 본다.
  `PUT /x/:id` 처럼 id 로 접근하는 변이는 가드를 통과하므로 **서비스에서 행을 로드해
  `assertSiteInScope`** 해야 IDOR 이 막힌다. 목록은 `applySiteScope` 담당.
- **공유(NULL) 리소스 정책**: 읽기=allowNull 허용 / 변이=거부 / 복제=허용(자기 site 사본).
  새 라우트를 열 때 이 3분법을 먼저 정하고 배선한다.
- **admin 운영자 화면에서 `GET /sites` 는 403** — 운영자 컨텍스트에서는 sites 쿼리를
  `enabled: !currentSiteId` 로 비활성해야 한다(스위처는 portal 셀프뷰로 이름 조회).

**계속 유효**
- api 배포 = **nginx 재시작 필수**(리터럴 proxy_pass, 502 실사고 2회).
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="origin/master..HEAD"`.
- CI `check-source-exposure.mjs` 가 소스 내 외부 벤치 식별자를 DENY(주석·테스트명 포함).
- editor/admin 커밋 없는 배포 = Vercel CLI 만(루트 `.vercel` 사용 금지).
- API 스키마 변경 시 prod `synchronize=off` — 마이그레이션 직접 실행 후 API 재배포.

---

## 5. 정본 문서
- **이 트랙 상세**: `.cursor/plans/MULTITENANCY_P3B_STATUS_2026-08-04.md`
- 설계 정본: `.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md`(P0~P6)
- 병행(편집기) 트랙 정본: `.cursor/plans/RESUME_PROMPT_2026-08-04.md` — **갱신 주체는 그 세션**
- 직전 체인: `RESUME_PROMPT_2026-08-03.md`(포토북 펼침면) · `_2026-08-01.md`
- 파트너 계약: `docs/PLATFORM_INTEGRATION_GUIDE.md` (P3b 는 admin 내부라 **외부 계약 무변경**)
- 운영 실값: `CLAUDE.local.md`(gitignored)
