# RESUME PROMPT — 2026-08-03 (세션 정본 · 클린 핸드오프)

> **이 문서가 최신 정본이다.** 직전 상세는 `RESUME_PROMPT_2026-08-01.md`(07-27~08-02 누적).
> 체인: 08-01(감사 §8 종결·함정 코드해소) → 08-01 PM(§2 잔여 8항목·Node24 전면승격) →
> 08-02(C6-fix·iOS 실기·relay/Support 제출) → **08-03(포토북 펼침면 내지 트랙 전량 + 제작 가이드)**.
>
> **최종 코드 커밋 = `7bb74a2`** (이후는 문서 전용 커밋). `origin/master` 는 문서 커밋으로 계속
> 앞서므로 **해시를 신뢰하지 말고 `git fetch` 로 확인**할 것.
> 최종 실측 2026-08-03 20:10 KST · ci+gitleaks success · 전 서비스 LIVE(Node 24.18.1).
> **오너 착수 대기 0건 · 코드 잔여 0.**

---

## 0. 착수 전 확인 (2분 — 순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git rev-parse --short origin/master   # 최종 '코드' 커밋: 7bb74a2 (이후는 문서)
git worktree list && git status -sb                 # 워크트리 잔존 0 · 타 세션 미커밋 무접촉
ssh-add -l | head -1                                # 비면: ssh-add ~/.ssh/id_ed25519
```

- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/레시피 실값.
- ⚠️ **기준선은 세션 중에도 움직인다** — fetch 결과가 다르면 §3 스냅샷을 낡은 것으로 간주.
- ⚠️ 07-27 히스토리 재작성 이전 기록의 해시는 **고아 계보**일 수 있다 — 착수 전 검증 3종:
  ①`git ls-remote origin master` ②`merge-base --is-ancestor` ③산출물 실물 확인.
- 작업 기반 = **`storige/`(master 직결)**. 신규 작업은 origin/master 기준 새 브랜치.

---

## 1. 08-03 세션 완료 — 포토북 펼침면 내지 트랙 (커밋 8, 전량 ci green)

정찰 10영역 + 적대검증 40건(반증 8 반영) + **프로덕션 E2E 3회**.

| 커밋 | 내용 |
|---|---|
| `a53234d` | **내지 펼침면 등록 개통**(API 400 해소) + **썸네일 판형 비율화** |
| `4278aa8` | **1안** 편집 가능화 — addPage 전체 플러그인 배선 + 물리 페이지 환산 |
| `1702eec` | **2안** 출력 완주 — 첫 펼침면 cover.pdf 누출 봉합 |
| `cf95631` | **3안** 표지 날개 주문 옵션 주입 연동안 |
| `e244a0e` | E2E 적발 결함 2건 — 책등 계산 NaN · '표지 스프레드' 오라벨 |
| `c2f5a9c` | **Admin 조립 UX 4건** — 후보필터 inner·구분 태그·타입 필터·400 메시지 |
| `7bb74a2` | E2E 적발 결함 1건 — **워커 검증 크기 오탐**(내지 펼침면 SIZE_MISMATCH) |
| `604522f` | 제작 가이드 HTML 갱신 |

**핵심 정정**: "펼침면 내지 Admin 등록 경로가 없다"는 **틀렸다**. Admin 저작 UI 는 이미 완비였고
**API 검증 한 곳**(`validateAndNormalizeSpreadConfig` 이 모든 spread 에 `spec.coverWidthMm` 요구)만
막고 있었다. `spread_config` 는 이미 json 컬럼이라 **마이그레이션 불필요**.

### 구조적으로 고친 것 (재발 방지 관점)
- **`addPage` 가 플러그인 2개만 등록**(createCanvas 는 21개) → 스프레드 2번째 이후 캔버스가
  삭제·되돌리기·사진틀·거터 없이 죽은 캔버스. `registerCanvasPlugins`(등록)/`initPlugins`(등록+초기화)
  분리로 해소. ⚠️ `editor.init` 중복 금지(ContextMenu 이중 생성) · createCanvas↔useAppStore 순환이라 **동적 import**.
- **페이지 상·하한이 캔버스=1p 가정** → `useEditorStore.pagesPerCanvas`(낱장1/펼침면2) 신설.
- **출력 분할이 regionScope 무시** → `splitSpreadOutputCanvases` 순수 헬퍼로 단일화.
  ⚠️ 동결 계약(`outputMode='separate'`) 무접촉 — inner 에서만 동작하며 프로덕션 inner 0건 실측으로 파트너 영향 0.
- **날개는 템플릿 전용 정적값이었다**(`options.coverWing` 은 선언 1줄·참조 0건 죽은 필드).
  `wingEnabled`/`wingWidthMm` embed 파라미터 + `resolveWingOverride`(**폭 없이 켜기 거부**) +
  orderOptions 스냅샷/재편집 복원 + `SpreadPlugin.resizeWing`(**repositionObjects 동반** — 총폭이 바뀌면
  절대좌표 아트워크가 어긋나는 게 최대 리스크였고, 책등이 이미 푼 방식 재사용).
  **문서 규약: 판형·책등과 달리 날개만 주문 옵션이 템플릿보다 우선**(PLATFORM_INTEGRATION_GUIDE 반영).

### E2E 가 잡은 실결함 3건 (유닛/빌드로는 검출 불가였음)
1. **내지 펼침면인데 책등 계산이 돌아 매 트리거 `roundMm01 NaN` 실패** — `flat-spread` 가드는 있고
   inner 가드가 없었다. 같은 단일 차단 지점에 추가.
2. **내지 전용 세트인데 첫 캔버스가 '표지 스프레드'** 로 표시 → '펼침면 1'.
3. **워커 검증이 기대 크기를 세트 판형(한 면)으로 잡아 정상 PDF 가 항상 SIZE_MISMATCH FAILED.**
   content.pdf 는 '1페이지=1펼침면'(D-1)이라 실제는 420×297. `resolveInnerSpreadContentSizeMm`
   (세트의 spread 템플릿 innerSpec 조회 = 서버 권위)로 크기·방향 보정 → 재실행 **VALIDATE COMPLETED**.

---

## 2. 잔여 — 오너 착수 대기 **0건**

### 외부 회신 대기 2
| # | 항목 | 종결 조건 |
|---|---|---|
| ⓐ | **GitHub Support GC**(보안) | 요청서 §4 스크립트로 표본 4 SHA(`43fc2ead`·`b3e77b83`·`566e5cfa`·`2fa7f125`)가 **web 404 / API 422** 인지 확인. 그때까지 구 히스토리(VPS IP·회전완료 자격증명)는 SHA 직접조회로 노출 지속. 로컬 `backup/*-pre-rebase-*` 3개 **push 절대 금지**, 검증까지 보존 |
| ⓑ | 파트너 실기기 회신(C6-b relay) | 이상 보고 시 포맷=증상+세션ID+기기/뷰포트. 롤백: C5=`VITE_ENABLE_ALT_DRAG_CLONE=false` · C6=`VITE_ENABLE_TOUCH_CONTEXT_MENU=false` · C6-b=코드 레벨(재배포) |

### 운영 관찰 3
- **포토북 내지 첫 실주문** — 실사용 세트 **0건**. 첫 주문 시 ①content.pdf 펼침면 수·크기
  ②워커 VALIDATE COMPLETED ③파트너 pageCount(=펼침면×2) 정합 1회 육안. 롤백=`storige-api:pre-inner-spread`(+nginx 재시작)
- **Node24 승격 후속** — 실 PDF 잡 골든 육안 + Sentry 실도달 1회. 롤백=`pre-node24`
- **md2books-worker** — job.completed 1건 관찰 후 구 컨테이너/exited 정리(디스크 84%)

### 별도 트랙 5 (착수하려면 오너 지시 필요)
1. 편집기 세션 검증잡 `orderOptions` 에 **날개 미포함** — 현재는 책등 미해석로 검증 건너뛰어 무해하나,
   해석 조건이 갖춰지면 날개 상품 오탐(잠복)
2. 워커 `wingTotal` 가산이 **perfect 한정** — 양장 확장 시 `hardcoverCoverSpreadFromSpine` 산식 확장 필요
3. **재편집 시 사진틀 재바인딩** — `rebindFrameInteractivity` 가 ImageProcessingPlugin 의존
4. `instance.complete`(파트너 IIFE 프로그래매틱 완료)는 **캔버스 1장만 저장** — 멀티페이지 세션 덮어씀
5. 루트 `/?templateSetId=` 진입의 `GET /template-sets/:id` **401 노이즈**(비차단·기저)

### 개발 백로그(요구 시)
#3 3D→플립북 완전교체(XL) · #4 단면↔펼침면 강제편집 · 트랙C G-4/G-5 · R-44 휴면 ·
멀티테넌시 P3b · 레거시 루트(/) 데스크탑 우클릭 메뉴 미표시(기저, 08-02 실측)

---

## 3. 상태 스냅샷 (2026-08-03 20:10 KST 실측)

- **최종 코드 커밋 `7bb74a2`** · ci+gitleaks success · 로컬=origin 동기 · 미커밋(추적) 0 · 워크트리 잔존 0
- 로컬 브랜치: `master` + `backup/*` 3(**push 절대 금지**)
- 라이브: API 200 · editor 200 · admin 200 · **Bull 큐 0/0** · 활성 워커잡 0
- **VPS `~/storige` = `7bb74a2` = 최종 코드 커밋과 동일**(뒤진 것은 문서 커밋뿐 → 재배포 불필요)
- 런타임 **Node 24.18.1 전면**: VPS api·worker · Vercel editor/admin(engines+Settings 이중화) · CI · md2books
- VPS 롤백 태그: `storige-api:pre-inner-spread`(08-03) · `storige-{api,worker}:pre-node24` ·
  `pre-s8guard` · `pre-traps` · `pre-gsfix` · `pre-nest10422` · md2books `:20260707`·`:20260801-node24`
- CI 게이트(전 워크스페이스): api **896** · worker 490 · canvas-core · sdk · editor **546** · admin **78** ·
  indesign 139+skip · examples · docs 포털 · 골든/strip self-test
- 프로덕션 위생: 08-03 E2E 데이터 **전량 삭제 확인**(템플릿 0 · 세트 0 · 세션 0 · live inner spread 0)

---

## 4. 함정 색인 (신규 세션 필독)

**08-03 신설**
- **세션/완료 경로 E2E 는 반드시 shop-session 토큰으로.** 관리자 JWT 는 `parseInt('admin-001')`=NaN 이라
  구조적으로 편집 세션 수정 불가(403). `POST /auth/shop-session` + X-API-Key(ShareSnap dev 키, `CLAUDE.local.md` §5).
  세션 생성 시 `memberSeqno` 필요, 토큰 `sub` 가 그 값.
- **썸네일 비율은 방향별 클램프 축이 반대** — 세로 패널=폭 예산 / 가로 스트립=높이 예산.
  가로에서 폭 고정하면 세로 판형이 `h-[100px]` 스트립을 넘친다.
- `PageThumbnail` 캡처는 **workspace bbox 크롭 필수**(안 하면 뷰포트 비율 이미지).
- **canvas 2.11.2 는 Node 26 소스컴파일 불가**(nan 2.24 가 제거된 V8 API 사용) → 로컬에서 canvas 로딩
  4스위트는 원천 실행 불가가 **기저**. CI(Node 24)가 정본 게이트. 복원 시 `pnpm install --force`.
- **템플릿 셋 판형 = 내지 재단(한 면)**. 표지 치수는 `spreadConfig.spec` 에서만.
- 제작 가이드(`docs/TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html`)는 **초판에 오류 4건이 있었다**
  (cutSizeMm 양변 합·pageCountRange·세트 판형 의미·"등록 경로 없음"). 인용 전 최신본 확인.

**계속 유효**
- **api 배포 = nginx 재시작 필수**(리터럴 proxy_pass, 502 실사고 2회).
- editor/admin 커밋 없는 배포 = CLI 만(레포 루트에서 ORG_ID+PROJECT_ID 명시, 루트 `.vercel` 사용 금지).
- admin 검증은 상태코드가 아니라 **content-type/크기**로(catch-all rewrite 폴백).
- `echo | vercel env add` 금지(개행 저장 전례) — `printf '%s'` 또는 대시보드.
- Vercel Settings Node 버전은 CLI 불가, **REST `PATCH /v9/projects`** 로 가능.
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="origin/master..HEAD"`.
- 프로덕션 액션(SSH/push/배포)은 자동모드 classifier 차단 → '권한 무시' 모드.
- `vite.config.js`(방출본)가 `.ts` 를 shadow — vite 설정 변경이 안 먹으면 이것부터 의심.
- editor typecheck 은 canvas-core/ai 를 **dist d.ts** 로 해석 — 스테일 dist 면 타입에러 폭발
  (`pnpm --filter @storige/canvas-core build` 선행).

---

## 5. 정본 문서
- 직전 상세: `RESUME_PROMPT_2026-08-01.md`(07-27~08-02 누적) · `_2026-07-30.md` · `_2026-07-29.md`
- **템플릿 제작(운영자용)**: `docs/TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html`(08-03 갱신 `604522f`)
- 파트너: `docs/PLATFORM_INTEGRATION_GUIDE.md`(08-03 날개 파라미터·권위 규칙 추가)
- 포토북: `.cursor/plans/PHOTOBOOK_TEMPLATE_DESIGN_2026-06-23.md` + `PHOTOBOOK_O2_DECISIONS_2026-07-04.md`
  / 운영 요약 `.claude/skills/photobook-template/SKILL.md`
- 소스맵: `docs/SOURCEMAP_EXPOSURE_RUNBOOK.md` / Node24: `NODE24_UPGRADE_AUDIT_2026-07-30.md`
- GitHub 정화: `.cursor/plans/GITHUB_SUPPORT_PURGE_REQUEST_2026-08-01.md`
- 운영 실값: `CLAUDE.local.md`(gitignored)
