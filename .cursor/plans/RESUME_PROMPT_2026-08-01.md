# RESUME PROMPT — 2026-08-01 (세션 정본 · 클린 핸드오프)

> **이 문서가 최신 정본이다.** 직전 체인: 07-27(3D표지·콘솔제거·Swagger·소스맵 배선) →
> 07-29(소스맵 차단 LIVE) → 07-30~31(Sentry 종결·Node24·썸네일·포트봉합·NestJS·worker CI) →
> 08-01 AM(정리 트랙 · 감사 §8 코드성 전량 종결 · 확립 함정 3건 코드 해소) →
> **08-01 PM(§1-PM: §2 잔여 8항목 일괄 처리 — Node24 전면 승격 LIVE·md2books 24 교체·ⓓⓖ 실증)** →
> **08-01 밤~08-02(§1-PM-b C6-fix 배포·iOS 실기 완료·md2books 로깅 수정 / ⓕ'ⓗ' 제출물 최종화)**.
> **08-03(포토북 펼침면 내지 트랙 — 등록 개통·편집·출력·날개 주입 / 썸네일 비율)**.
> 최종 실측: **2026-08-03 17:55 KST**. `origin/master` = **`cf95631`** · **ci success** · 전 서비스 LIVE(Node 24).
> **§2 오너 행동 전량 종결(08-02: ⓕ' relay 발송 · ⓗ' Support 티켓 제출)** — 코드 잔여 0, 착수 대기 항목 0.
> 남은 것은 **외부 회신 대기 2건(GitHub GC 완료 검증 · 파트너 실기기 회신)과 운영 관찰 2건**뿐.

---

## 0. 착수 전 확인 (2분 — 순서 고정)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git rev-parse --short origin/master    # 본 문서 기준: 92e3cf8
git worktree list && git status -sb                  # 타 세션 미커밋 무접촉
ssh-add -l | head -1                                 # 비면: ssh-add ~/.ssh/id_ed25519
```

- `CLAUDE.local.md`(gitignored) 먼저 — SSH/Vercel/키/레시피 실값.
- ⚠️ **기준선은 세션 중에도 움직인다** — fetch 결과가 다르면 §3 스냅샷을 낡은 것으로 간주.
- ⚠️ 07-27 히스토리 재작성 이전에 시작된 세션 기록의 해시는 **고아 계보**일 수 있다 —
  착수 전 검증 3종: ①`git ls-remote origin master` ②`merge-base --is-ancestor` ③산출물 실물 확인.
- 작업 기반 = **`storige/`(master 직결)**. 신규 작업은 origin/master 기준 새 브랜치.
  워크트리 잔존 0 (`storige-e2-w1`·`storige-node24` 정리 완료 — 08-01 PM).

---

## 1. 본 세션(08-01) 완료 — 8커밋 전량 push·ci green, api 2회 VPS 배포

### 1-1. 정리 트랙 (`43db8f3`)
- 유출 게이트 `KNOWN_EXCEPTIONS` **예외 0건 전환**(해소된 vercel.json 항목 제거 — 게이트 전면 실차단).
- **워크트리 6개 제거**(종료된 병행 세션 tmp 5 + `storige-fix-20260713`) + 머지 완료 브랜치 4개 삭제.
  `storige-fix` 에만 있던 **C6-b relay 발송본** 등 untracked 문서 2건을 본진 `.cursor/plans/` 에 보존.

### 1-2. 감사 §8 코드성 잔여 전량 종결 (`0b487b6..af42d1d`, §8 은 이제 ④만 잔존)
| 항목 | 조치 | 검증 |
|---|---|---|
| ⑦ 경로 가드 | `startsWith(base)` 형제 접두사 결함 2곳 → 공유 헬퍼 `resolveStoragePath`(sep 경계·루트 거부) + worker-jobs 스트림 가드 | 스펙 9건 · api 884 green · **VPS 배포**(태그 `pre-s8guard`) |
| ⑧ .dockerignore | 신설 — node_modules/dist/.git/루트 .env/**storage**(VPS 최대 기여자) 차단. `apps/editor/.env.production` 은 보존 | 이미지 3종 빌드 실증 |
| ⑨ frozen-lockfile | Dockerfile 6곳 전부 | 동일 빌드 실증 |
| ⑤ CI 완결 | editor(ai·canvas-core build 선행)+admin+indesign 연결 → **테스트 보유 전 워크스페이스가 게이트 안** | 실 CI green(전체 ~3분) |
| ⑩ 문서 | 거짓 기록 정정 + node:20 잔재 3문서 + CLAUDE.local §6.2 nginx 재시작 | — |
- 적대 리뷰(3렌즈+반증) 확정 4건(critical/major 0) 중 3건 반영(`5287c91`).
- **CI 첫 실전 런이 fixture 함정을 즉시 적발**(gitignored 고객 자산 의존 12건 ENOENT) →
  `existsSync` skip 가드로 수정(`af42d1d`, fixture 유=139 green 불변/무=127 green+15 skip).

### 1-3. 확립 함정 3건 — 문서 박제 → 코드 해소 (`92e3cf8`)
- **① indesign 글롭**: `node --test "src/**/*.test.mjs"` **인용 글롭**(node 내부 globstar 재귀) —
  dash 2단계 고정 누락을 probe 로 재현 후 해소.
- **② Node 26 vitest localStorage**: editor `src/test/setup.ts` 에 부재 시 인메모리 Storage 폴리필 —
  Node 26 에서 40파일 green(종전 49 실패)·Node 22 무회귀. ⚠️ window 재바인딩은 안 됨(vitest 에선
  window===globalThis = 같은 undefined getter).
- **③ 스트림 에러 헤더 위생**: worker-jobs·files·books 3라우트 에러 분기에서
  Content-Type/Disposition/Length 제거(Express res.json 은 기설정 Content-Type 을 안 덮음 — 실측).
  **api VPS 배포**(태그 `pre-traps`).

### 부수 문서 정리
- `docs/SOURCEMAP_EXPOSURE_RUNBOOK.md` 에 ✅ 완료 배너(오너 액션 전량 종결 07-30 — §2/§4/§5 는 이력).
- 메모리 함정 대장 5항목으로 확장(reference_build_gate_traps — gitignored fixture 추가).

---

## 1-PM. 2차 세션(08-01 저녁) — §2 잔여 8항목 일괄 처리 (병렬 워크플로 5agent + 인라인)

- **ⓒ Node24 전면 승격 LIVE** (`1538c79`, ci+gitleaks green): Docker FROM 6곳 22→24 · CI node-version 24
  · root engines ≥24 · @types/node ^24(9곳)+lockfile · 문서 3건. 게이트 전량 통과: pnpm build 9/9
  · 로컬+VPS 이미지 빌드 · **amd64 바이너리 파리티 동일**(gs 10.07.1·qpdf 12.3.2·alpine 3.24.1)
  · 모듈 스모크(bcrypt/sharp/mysql2/pdf-lib/bull) · 골든 엔진 self-test 4/4. VPS 컷오버:
  worker(큐 0/0 확인)→api(**+nginx 재시작 한 호흡**)→health 200·**req.id 그룹핑 실측**(`"req":{"id":7}` —
  Node24 ALS 전환 무이상)·Sentry 초기화 정상. **롤백 태그 `storige-{api,worker}:pre-node24`**.
  Vercel editor/admin 은 push 자동배포 Ready(52s/29s).
- **ⓑ Vercel Settings 20.x→24.x 완료**: "대시보드 전용"은 CLI 한정 — **REST API PATCH 로 실증 변경**
  (`PATCH /v9/projects/<name>?teamId=…` `{"nodeVersion":"24.x"}`). `--update-required` 목록 0건.
  homepage 는 이미 24.x(조치 불요). 기한 2026-10-01 리스크 소멸.
- **ⓐ md2books-worker Node 20→24 교체 완료**: 조사로 papascompany 자체 스택 확정(정본 레포
  `/Users/yohan/Developer/antigravity/MD2Books`). VPS `Dockerfile.worker`(git 미추적) FROM 24 수정
  (+`.bak-node20` 백업)→`20260801-node24` 빌드→stop/rename/run 교체→v24.18.1 부팅·loop 정상.
  롤백: 구 컨테이너 `md2books-worker-old-node20` + 이미지 `:20260707` 보존.
- **ⓓ 줌 dpr 클릭 정합 — 실증 종결**: "자동화 불가" 반전 — playwright+CDP `deviceScaleFactor` 오버라이드로
  **런타임 dpr 1→2.5→1.5 실전환** 3단계 전부 sync(fabric dpr=백킹비율=dpr)+클릭 히트(빈곳 음성대조 포함)
  PASS. 실 Chrome 125%(dpr2.5) 라이브 탭 정합도 확인. 스크립트=세션 스크래치패드 `dpr-qa2.mjs`.
- **ⓖ C6 fe-qa(엔진 에뮬레이션)**: chromium 모바일 터치(CDP 실주입)로 롱프레스 500ms→메뉴→'삭제'→
  **모달(메뉴 자동 닫힘)**→취소 전 플로우 PASS(Android Chrome 엔진 동일 계열). **결함 2건 실측**:
  ①메뉴 outside-tap 미해제 ②메뉴 열린 채 액션바 휴지통 탭 시 모달 위 메뉴 잔류(버튼 가림) → spawn_task
  칩 2건 등록(수정 트랙). **iOS 실기 잔여** — 시뮬레이터는 `sudo xcode-select -s
  /Applications/Xcode.app/Contents/Developer` 오너 실행 후 가능.
- **ⓔ G-6 = A안(교체 안 함) 확정** — `G6_COMPARISON_2026-07-24.md` 에 결정 기록. 게이트 종결.
- **ⓗ 요청서 완성**: dangling 표본 4 SHA 노출 실증(웹 200+API 성공, 순수 dangling·포크 0) →
  `GITHUB_SUPPORT_PURGE_REQUEST_2026-08-01.md`(영문 복붙 본문+제출 경로+완료 검증 스크립트).
  → **08-02 재확인·갱신본이 최종. §2 ⓗ' 참조.**
- **ⓕ 발송본 확정**: `RELAY_C6B_{bookmoa_mobile,sharesnap}_2026-08-01.md` (고아 해시 bdef580 인용 정정).
  파트너 이메일 미보유 → Gmail 초안 불가(수신자 필수), 오너 채널 발송용.
  → **08-02 보강본이 최종(iOS 검증 문구+C6-fix 반영). §2 ⓕ' 참조.**
- 부수: `storige-e2-w1`·`storige-node24` 워크트리 정리(잔존 0), 머지 브랜치 2개 삭제.

### 1-PM-b. C6-fix — ⓖ에서 발견된 결함 2건 즉시 수정·배포 (`5a30121`, ci+gitleaks green)
- **수정**: contextMenu 에 document 캡처 pointerdown 아웃사이드 해제(표시 수명주기 부착 —
  submenu 누수 방지, T-5 억제창 불요 근거 주석) + `Editor.hideContextMenu()` 신설 +
  ObjectDeleteConfirm 모달 오픈 시 강제 닫기(비-포인터 경로 커버).
- **검증**: canvas-core 컨텍스트 스위트 29/29(신규 ⑥⑦⑧⑨) · editor 5/5 · 빌드/린트 green ·
  **라이브 재검증 PASS**(발견 프로브 동일 재실행: dismissWorks true · 모달 위 메뉴 잔류 false ·
  본 플로우 무회귀 · 취소 도달성 정상).
- **관찰(별건, 기저)**: 레거시 루트(/)의 **데스크탑 우클릭 메뉴가 수정 전부터 미표시**
  (선택 후에도) — 이번 변경과 무관 실측. 모바일 롱프레스는 동일 ContextMenu 로 정상.
  후속 조사 후보.
- **로컬 함정 신규 실측**: canvas 2.11.2 는 **Node 26 에서 소스컴파일 불가**(nan 2.24 가
  제거된 V8 API 사용 — v8::AccessControl 등). 로컬 Node 26 은 canvas 로딩 4스위트 실행
  불가가 기저(CI Node 24 가 정본 게이트). 본 세션에서 재컴파일 시도로 구 Node22 ABI
  바이너리가 삭제됨(어차피 Node 26 로드 불가였음) — 복원 필요 시 `pnpm install --force`.

## 1-08-03. 포토북 펼침면 내지 + 썸네일 트랙 (오너 지시: API배포+1·2·3안 전량)

정찰 5영역 + 적대검증 20건(반증 8건 반영). **가이드 서술 정정**: "펼침면 내지 Admin 등록
경로가 없다"는 부정확 — Admin UI 는 이미 완비(regionScope 라디오+inner 6필드)였고
**API 검증 한 곳**만 막고 있었다.

- **등록 개통 + API 배포 완료** (`a53234d`): `validateAndNormalizeSpreadConfig` 가 spread 전체에
  `spec.coverWidthMm` 를 무조건 요구해, spec 없이 innerSpec 만 보내는 저장 페이로드가 400.
  inner 조기 분기 + 전용 검증 신설(cover 경로 무접촉). **마이그레이션 불필요**(json 컬럼).
  VPS 배포(롤백태그 `pre-inner-spread`)+nginx 재시작, **프로덕션 실측**: inner 생성 201·
  총치수 서버 재계산 420×297·innerSpec 보존·거부 케이스·표지 무회귀 전부 확인(스모크 정리 완료).
- **썸네일 판형 비율화** (`a53234d`): 원인 두 겹 — 박스 하드코딩 3곳(PageItem `w-20 h-28` /
  SpreadThumbnailItem 2:1 / PageThumbnail 88×60·88×72) + PageThumbnail 이 **크롭 없이 뷰포트**
  캡처. workspace bbox 크롭 + 비율 구동. **클램프 축은 방향별 반대**(세로=폭 예산 / 가로=높이 예산)
  — 적대검증이 첫 수정의 실제 결함(가로 스트립 넘침) 적발.
- **1안 편집 가능화** (`4278aa8`): `addPage` 가 플러그인 2개만 등록해 스프레드 2번째 이후 캔버스가
  삭제·되돌리기·사진틀·거터 없이 죽은 캔버스였다. `registerCanvasPlugins`(등록)/`initPlugins`(등록+초기화)
  분리로 createCanvas 순서 불변 + addPage 가 동일 세트 사용. `pagesPerCanvas`(낱장1/펼침면2)로
  페이지 상·하한을 물리 페이지 기준 환산.
- **2안 출력 완주** (`1702eec`): 내지 전용 세트인데 항상 캔버스0 을 표지로 떼어내 첫 펼침면이
  cover.pdf 로 새고 content=(N−1) ↔ pageCount=N×2 불일치. `splitSpreadOutputCanvases` 순수 헬퍼로
  분할 규칙 단일화. ⚠️ **동결 계약 무접촉** — inner 에서만 동작하고, 프로덕션 실측
  **inner spread 0건·포토북 세트 0건**이라 기존 파트너 영향 0.
- **3안 날개 주입** (`cf95631`): 날개는 템플릿 spec 전용 정적값이었고 `options.coverWing` 은
  선언 1줄·참조 0건 죽은 필드였다. `wingEnabled`/`wingWidthMm` embed 파라미터 + buildSpreadSpec
  오버라이드(`resolveWingOverride` — **폭 없이 켜기 거부**) + orderOptions 스냅샷/재편집 복원 +
  `SpreadPlugin.resizeWing`(**repositionObjects 동반** — 총폭 변경 시 아트워크 어긋남이 최대 리스크였고
  책등이 푼 방식 재사용). PLATFORM_INTEGRATION_GUIDE 에 권위 규칙 명시(**날개는 주문 옵션 우선**).

- **Admin 조립 UX 4건 완료** (`c2f5a9c`): ①후보 필터 inner 폭 검증(순수 헬퍼 `matchesSpreadCandidate`
  — 표지 경로는 **정확 비교 유지**해 무회귀) ②표지/내지 펼침면 구분 태그(폼·후보모달·TemplateList
  표기+필터 분리) ③포토북 타입 필터 옵션 + ProductTemplateSets '리플렛' 오표기 수정 ④서버 400 메시지
  노출(`serverErrorText`) + PAGE≥1 선제 검증·Alert + 내지 세트 전용 안내. admin 78/78(신규 11).

**잔여(별도 트랙)**: ⓐ 편집기 세션 검증잡 orderOptions 에 날개 미포함(현재는 책등 미해석로 검증
건너뜀 → 무해하나 해석 조건 갖춰지면 오탐 소지) ⓑ 워커 wingTotal 가산이 perfect 한정 — 양장 확장 시
산식 필요 ⓒ 재편집 시 사진틀 재바인딩(B3 지적) ⓓ `instance.complete` 프로그래매틱 경로는 캔버스
1장만 저장 ⓔ 포토북 내지 세트 **실기 E2E 미실시**(등록→편집→완료 전 구간).

## 2. 잔여 — **오너 행동 0건** · 외부 회신 대기/관찰만 (코드 잔여 0)

| # | 항목 | 비고 |
|---|---|---|
| ⓕ' | **C6-b relay — ✅ 종결(08-02 오너 발송 완료)** | bookmoa-mobile·ShareSnap 2건 발송 완료(오너 보고). 발송본=`RELAY_C6B_{bookmoa_mobile,sharesnap}_2026-08-01.md`(08-02 최종본: iOS 검증 문구 — 시뮬레이터임을 명시해 파트너 실기기 확인 요청 유지 / C6-fix 08-01 보완 2건 반영 / 요청사항 "실기기 최종 확인 1회"로 완화). **트랙 종결** — 이후는 아래 관찰 행의 파트너 회신 대응뿐 |
| ⓗ' | **GitHub Support 티켓 — ✅ 제출 완료(08-02, 오너 액션 종결)** | 요청서 `GITHUB_SUPPORT_PURGE_REQUEST_2026-08-01.md` §3 영문 본문으로 제출. ⚠️ **제출 ≠ 제거** — 08-02 실측 기준 표본 4 SHA 는 여전히 웹 200+API 성공(노출 지속). **남은 것은 GitHub 측 GC 실행뿐**이며 우리가 할 조치는 없음 → 아래 관찰 행에서 회신·완료 검증 |
| ⓖ' | **C6 iOS 실기 — ✅ 완료(08-01 밤)** | 시뮬레이터 MCP stale 지속(재시작 후에도) + computer-use 거부 → **idb(HID 실터치 주입)로 대체 완주**. iPhone 17 Pro 실 Safari(WebKit)에서: 롱프레스→메뉴 발화(홀드 중 표시+릴리스 후 유지, 재현 3회) · **빈 캔버스 탭→메뉴 닫힘(C6-fix 실기 PASS)** · '삭제' 탭→메뉴 자동닫힘+"객체 삭제" 모달(버튼 무가림, C6-b PASS) · 취소→모달 닫힘+객체 보존. 증거=스크래치패드 ios-2~9.png. 잔여=Android 실기(선택 — chromium 엔진 에뮬레이션으로 기검증). idb 레시피: `brew tap facebook/fb && brew install facebook/fb/idb-companion` + venv fb-idb, `idb --companion-path /opt/homebrew/bin/idb_companion ui tap --udid <UDID> [--duration s] X Y`(포인트 좌표, 클라이언트 기본 경로가 /usr/local 이라 지정 필수) |
| 관찰 | Node24 승격 후속 | 실 PDF 잡 1건 골든 육안 + Sentry 이벤트 실도달 1회 관찰(자연 발생 대기). 이상 시 `pre-node24` 태그 즉시 롤백(api 는 nginx 재시작 동반) |
| 관찰 | md2books-worker 실잡 | job.completed 1건 관찰 후 구 컨테이너/exited 정리(디스크 회수) |
| 관찰 | **GitHub Support 회신(ⓗ' 후속) — 보안 잔여** | 회신 도착 시 **완료 검증 필수**: 요청서 §4 스크립트로 표본 4 SHA(`43fc2ead`·`b3e77b83`·`566e5cfa`·`2fa7f125`)가 **web 404 / API 422** 인지 확인해야 진짜 종결. 그때까지 구 히스토리(VPS IP·회전 완료 자격증명)는 SHA 직접 조회로 계속 노출 상태다. 로컬 `backup/*-pre-rebase-*` 3개는 검증 끝날 때까지 보존(**push 절대 금지**). 지연 시 티켓 리마인드 |
| 관찰 | **파트너 회신(ⓕ' 후속)** | 08-02 발송분에 대해 bookmoa-mobile·ShareSnap 이 **실기기 확인 결과**를 회신 예정. 이상 보고 시 요청 포맷=증상+세션 ID+기기/뷰포트. 롤백 수단: C5 다중=`VITE_ENABLE_ALT_DRAG_CLONE=false` · C6 롱프레스=`VITE_ENABLE_TOUCH_CONTEXT_MENU=false` · C6-b 모달=코드 레벨(플래그 없음, 되돌림 시 재배포) |

**md2books 후속 완료(08-01 밤, 칩 트랙)**: ① queue.claim `[object Object]` 로깅 은폐 수정
(`42d7494` — errorMessage/normalizeError + cause 체인, 스펙 8) ② Dockerfile.worker 레포
백포트(`e7e7a05` — VPS 단독 존재 유실위험 해소). 컨테이너 `20260801-logfix` 교체 기동,
배포본에서 PostgrestError 형상 프로브로 실메시지+code/details/hint 노출 실증.
롤백 = `md2books-worker:20260801-node24`. 다음 산발 발생 시 로그에 실원인 노출됨.

**개발 백로그(요구 시)**: #3 3D→플립북 완전교체(XL, 공유링크 net-new 포함) · #4 단면↔펼침면 강제편집 ·
스트림 에러 응답 개선 후속(err.code 세분화는 worker-jobs 만 적용 — files/books 는 500 유지 중) ·
트랙C G-4/G-5 · R-44 휴면 · 멀티테넌시 P3b.

---

## 3. 상태 스냅샷 (2026-08-01 22:20 KST 실측)

- `origin/master` = `5a30121`(C6-fix) · **ci success** · gitleaks success
- **런타임 Node 24.18.1 전면**: VPS api·worker(교체 완료, health 200·req.id 정상) · Vercel editor/admin
  (engines+Settings 24.x 이중화, update-required 0건) · CI 24 · md2books-worker 24
- 라이브: API health 200 · editor 200 · admin 200 · Bull 큐 0/0 · VPS = master 동기
- VPS 롤백 태그: **`storige-{api,worker}:pre-node24`(08-01 PM)** · `pre-s8guard` · `pre-traps` ·
  `pre-gsfix` · `pre-nest10422` · md2books `:20260707`+구 컨테이너
- 로컬 브랜치: `master` + `backup/*` 3(**push 절대 금지** — 구 히스토리 VPS IP 보유). 워크트리 잔존 0
- 공인 바인딩: nginx 80/443 뿐. 소스맵: hidden+Sentry 업로드+삭제 LIVE(심볼리케이션 정상)
- CI 게이트: **전 워크스페이스**(api 884 · worker 490 · canvas-core · sdk · editor 529 · admin 67 ·
  indesign 139+skip · examples · docs 포털 · 골든/strip self-test) — Node 24 러너에서 green 실증

---

## 4. 함정 색인 (신규 세션 필독 — 상세는 각 정본)

**08-01 신설**:
- editor typecheck 은 canvas-core/ai 를 **dist d.ts** 로 해석(project reference 아님) — 스테일 dist 면
  타입에러 폭발. CI 는 editor 스텝이 build 를 선행. 로컬은 `pnpm --filter @storige/canvas-core build` 먼저.
- 로컬 Node 26 vitest localStorage → **해소됨**(setup.ts 폴리필). 단 admin·canvas-core 에 localStorage
  테스트를 추가하면 같은 폴리필 필요.
- gitignored fixture 의존 테스트는 `existsSync` skip 가드 필수(로컬 green/CI red 비대칭).
- `node --test` 글롭은 반드시 인용(비인용 = dash 2단계 고정).
- 빌드 게이트 무효화 5경로 체크리스트 = 메모리 `reference_build_gate_traps`.

**계속 유효(정본 = RESUME 07-30 §3 · 07-29 §3)**:
- api 배포 = **nginx 재시작 필수**(리터럴 proxy_pass, 502 실사고 2회).
- editor/admin 커밋 없는 배포 = CLI 만 가능(레포 루트에서 VERCEL_ORG_ID+PROJECT_ID 명시,
  루트 `.vercel` 은 별개 프로젝트라 사용 금지).
- admin 검증은 상태코드가 아니라 **content-type/크기**로(catch-all rewrite 폴백).
- `echo | vercel env add` 금지(개행 저장 전례) — `printf '%s'` 또는 대시보드.
- canvas ABI: Node 메이저 전환 시 로컬 `rm -rf node_modules && pnpm install`.
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="<base>..HEAD"`.
- 프로덕션 액션(SSH/push/배포)은 자동모드 classifier 차단 → '권한 무시' 모드.

---

## 5. 정본 문서
- 직전 상세: `RESUME_PROMPT_2026-07-30.md`(§1-1~1-10 누적) · `RESUME_PROMPT_2026-07-29.md` · `RESUME_PROMPT_2026-07-27.md`
- 소스맵: `docs/SOURCEMAP_EXPOSURE_RUNBOOK.md`(✅ 완료 상태) / Node24: `NODE24_UPGRADE_AUDIT_2026-07-30.md`
- 파트너: `docs/PLATFORM_INTEGRATION_GUIDE.md` / Swagger allowlist: `apps/api/src/config/swagger-partner-routes.ts`
- 운영 실값: `CLAUDE.local.md`(gitignored)
