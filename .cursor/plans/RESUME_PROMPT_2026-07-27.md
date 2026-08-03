# RESUME PROMPT — 2026-07-27 (세션 정본 · 클린 핸드오프)

> **이 문서가 최신 정본이다.** 직전 체인: 2026-07-24(트랙C+E2 LIVE) → 2026-07-25(E2 잔여·세대가드·editor #1/#2) → **본 세션(3D 표지 복구 · 번들 콘솔 제거 · Swagger 노출 차단 · force-push 잔여 정리 · 소스맵 공개 차단)**.
> **본 세션 요약**: `22f10b5` → **`339fd1b`** (4커밋, editor/admin 자동배포 + API·VPS editor 컨테이너 수동배포 전부 LIVE 검증 완료).
> ⚠️ **직전 문서(07-25)의 기준선 `2fa7f12` 는 무효** — 2026-07-27 09:11 별도 세션이 PUBLIC 레포 VPS IP 제거를 **히스토리 재작성(force-push)** 으로 실행해 07-24~25 커밋 해시가 전부 재작성됐다(내용 동일).

---

## 0. 세션 시작 프로토콜 (순서 고정)
1. `storige/CLAUDE.local.md` 먼저(SSH/Vercel/키/레시피). SSH 필요 시 `ssh-add -l` → 비면 `ssh-add ~/.ssh/id_ed25519`.
2. 본 문서(§1 완료 · §2 예정 · §3 함정 · §4 워크트리).
3. **작업 워크트리** `../storige-fix-20260713`. `git fetch && git rev-parse origin/master`(현재 **`339fd1b`**). 신규 작업은 origin/master 기준 새 브랜치.
4. `git worktree list` + `git status -sb` — 타 세션 미커밋 무접촉.

---

## 1. 완료 내역 — 전량 프로덕션 LIVE (`22f10b5..339fd1b`)

| 커밋 | 내용 | 검증(실측) |
|---|---|---|
| `b905298` | **editor #3 즉시복구**: 3D 책 미리보기 흰 표지 → 표지 스프레드 캔버스 영역별 캡처 배선. `cropRegions.extractSpreadRegionImagesFromCanvas` 신설(dead code 였던 모듈을 실사용으로 전환) + EditorHeader 가 모달 open 시 1회 캡처·close 시 해제 | vitest 520(신규 6)·tsc 0·eslint 0err / **라이브 검증**: 모달이 실제 아트워크 렌더, 캡처 실측 front 720×720·spine 6×720·back 720×720 = 영역 비율 정확 |
| `282bce0` | **번들 디버그 콘솔 제거**: vite `esbuild.pure` 에 console.log/debug/info/… 등록(SPA+embed 두 config). dev 는 minify 없음 → 로그 유지(=dev 게이팅). warn/error 보존. useFontPreview.logger.info 는 간접참조라 DEV 게이트 직접 적용 | **라이브 A/B**: canvas-core 청크 171→**0**, index 청크 42→**0**. dist 잔존 5건 전부 vendor 내부(fabric `f.log` 별칭·pdf/onnx/opencv 기능탐지) |
| `1cbfd3e` | **API 보안 — production Swagger 파트너 표면 큐레이션**(07-07 미머지 브랜치 `7950c87` 을 현 master 로 재적용). `/api/docs(-json)` 이 무인증으로 내부·관리자 표면 전량 공개 중이었음 | **라이브 전/후**: 245 오퍼레이션 → **31**, 민감 경로(auth/login·operators/{id}/password·sites/{id}/regenerate·admin/storage-settings) **0건**. 파트너 라우트 실동작 200(spine/paper-types 89종)·docs UI 200·api 829 test green |
| `339fd1b` | **소스맵 공개 차단 + Sentry 업로드 배선**(자기게이팅). 토큰 3종이 있어야만 hidden+업로드+삭제, 없으면 현행 유지. 부수로 `/stats.html`·embed 맵·VPS 컨테이너 맵까지 차단 | 실빌드 4조합 · self-test 32 · 520 green · **라이브**: VPS :3000 맵 404(직전까지 원본 TS 공개) · /stats.html 리포트 소멸 |

**운영 정리(본 세션 실행)**:
- **VPS `~/storige` reset** — force-push 로 공통조상이 사라져 다음 `git pull` 이 *unrelated histories* 로 실패할 상태였음. `git fetch && git reset --hard origin/master` 실행(2528c69 → 최신). api/worker 소스·compose diff 0 이라 무중단, untracked `.bak` 보존.
- **로컬 구 히스토리 브랜치 53개 삭제** — 재작성된 master 에 동일 내용으로 존재하면서 IP 포함 구 커밋만 보유하던 것들. 원격은 이미 전량 재작성됨(origin 브랜치 10개 모두 origin/master 의 조상 = 공개 레포 클린).
- **API 배포**: `docker compose build api && up -d api` + **nginx restart**(옛 IP 캐싱 502 회피 — 상시 규칙).
- **VPS editor 컨테이너 재빌드**: Dockerfile 이 `scripts/` 를 COPY 하지 않아 postbuild 가 ENOENT 로 죽던 상태(=이미지 빌드 실패 → stale 이미지 상시)를 고치고 `SOURCEMAP_STRIP=1` 적용. 재빌드 후 `:3000/*.js.map` → 404 확인(직전까지 원본 TS 11파일 공개 실측).

---

## 2. 예정 내역 (우선순위)

### A. 오너 결정/행동 대기
1. ✅ **[2026-07-28 완료] 소스맵 노출 차단 프로덕션 LIVE** — `SOURCEMAP_STRIP=1` 을 `storige-editor`·`storige-admin` **Production** 에 등록(`printf '%s'` 사용, 개행 오염 없음) 후 CLI 수동배포. 라이브 실측: **editor** 표본 4청크 맵 전부 404 · `sourceMappingURL` 참조 0 · `/stats.html` 은 1,215B index.html 폴백(실제 2.18MB 리포트 없음) / **admin** 맵 요청이 460B `text/html` 폴백(직전 8.26MB JSON). 배포본 = editor `c24rc20fb` · admin `3vovns4o8`(직전 롤백지점 editor `ml3sciehv` · admin `gz03ytkk4`).
   - **잔여 ⓐ `SENTRY_*` 3종** 🔑 — 등록하면 다음 배포부터 hidden+업로드+삭제로 자동 전환되어 **심볼리케이션이 복구된다**. 현재는 노출만 끊긴 상태라 **프로덕션 스택트레이스가 minified** 로 남는다(의도된 트레이드오프, 오너 선택).
   - **잔여 ⓑ Preview 환경 미등록 — CLI 로는 불가 확정(2026-07-28 실측, v54.2.0)**. 4가지 형태 전부 `git_branch_required` 무한 반복: ①stdin 파이프 ②`--value --yes`(CLI 가 스스로 제안한 명령) ③`< /dev/null` ④`--force` 병행. 브랜치 지정형(`… preview master`)은 `branch_not_found`("Cannot set Production Branch master for a Preview Environment Variable") — master 가 프로덕션 브랜치라 정상 거부이고, 개별 브랜치 스코프는 어차피 원하는 형태가 아니다. **대시보드에서 `SOURCEMAP_STRIP=1` 을 Preview(All Branches)로 추가**할 것.
   - ⓐ 관련 실측: **Sentry org/project slug 는 레포에 없다** — `scripts/activate-sentry.sh` 는 DSN 플레이스홀더만 갖고 있고 slug 문자열은 `scripts/` 전체에 0건. DSN 에는 숫자 id 만 있어 유추 불가(런북 §2-2와 일치) → **Sentry 로그인 없이는 3종 중 어느 것도 채울 수 없다.**
   - 절차·slug 확인법·검증 명령(admin 은 catch-all rewrite 때문에 상태코드 무효 → content-type 판정)·롤백 = **`docs/SOURCEMAP_EXPOSURE_RUNBOOK.md`**(신설).
   - ⚠️ `echo | vercel env add` 금지(값에 개행 저장 전례) — 대시보드 붙여넣기 또는 `printf '%s'`.
   - 이미 닫힌 것: `/stats.html`(모듈 2,866건 공개) · embed 번들 맵 12.9MB · VPS editor 컨테이너(:3000) 맵.

2. **#2 줌 상태 클릭 확인** — 자동화 브라우저 페인은 실 dpr 변경이 불가해(브라우저 줌 주입 불가·레이아웃 미반응) **오너 실기 1회 필요**. 라이브에서 dpr 1.0/2.0 정합은 실측 완료(cssScale===retinaScaling, getPointer 드리프트 0). 확인법: 편집기에서 ⌘+/− 로 줌 변경 후 객체 클릭이 정확히 잡히는지. 수치로 보려면 DevTools 콘솔에 `fabric.devicePixelRatio === devicePixelRatio` 및 `(c=document.querySelector('canvas.upper-canvas')).width / c.getBoundingClientRect().width === devicePixelRatio` 확인.
3. **G-6 백필 결정** — 대조 Δ0.12mm=수용가능. A(교체 안 함, 권장) vs B(정식파생본 교체).
4. **C6-b 공지 relay** — 발송본 완성(`NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`), bookmoa-mobile/ShareSnap 에 오너 전달.
5. **C6 실기 fe-qa** — iOS Safari + Android Chrome 롱프레스/삭제모달 육안. 롤백=`VITE_ENABLE_TOUCH_CONTEXT_MENU=false`.
6. **VPS editor 컨테이너 존치 여부** — `docker-compose.yml` 의 `editor` 서비스가 `3000:80` 으로 공개 바인딩(Docker 포트 매핑은 ufw 우회). Vercel editor 와 중복이라 `127.0.0.1:3000:80` 제한 또는 서비스 제거가 낫다 — 용도 확인 후 결정(이번 세션은 맵 차단까지만).
7. **GitHub 잔여 객체** — 히스토리 재작성 후에도 옛 커밋은 SHA 직접 접근으로 한동안 조회 가능(GitHub GC 전). 완전 제거는 GitHub Support 요청 사안. 로컬 `backup/*` 3개는 의도적 보존(삭제 시 복구 불가). `fix/swagger-partner-curation`(구 히스토리)은 내용이 master 에 반영됐으므로 이제 삭제 가능.

### B. 개발 백로그 (요구 시)
8. **#3 3D→플립북 완전교체**(XL) — 즉시 복구는 완료(위 b905298). 완전교체는 react-pageflip+내지(toDataURL/워커 pageImageUrls)+**공유링크 net-new**(공개 미리보기 라우트·인증 모델 오너결정).
9. **#4 단면↔펼침면 강제편집** — 현재 원칙(templateSet authoring 대로 렌더) 정상. 요구 발생 시 regionScope=inner+innerSpec 반영.
10. **admin 번들 콘솔 제거** — 동일 정책 1줄(`esbuild.pure`) 적용 가능. 이번 범위에서 제외(고객 대면 아님).
11. 트랙C 잔여 게이트(G-4 PDF픽셀 왕복·G-5 시각스모크) · R-44 책등 휴면 · 멀티테넌시 P3b · 보안 후속 = 각 프로젝트 메모리 참조.

---

## 3. 환경·함정

### 배포·운영
- editor/admin = master push 자동배포. 반영 안 보이면 Vercel MCP `get_deployment`(githubCommitSha 대조) 먼저. api/worker = VPS SSH 수동(`docker compose build api && up -d api` **+ nginx restart**).
- **editor/admin CLI 수동배포 레시피 (2026-07-28 확립)** — env 변경만 반영하려는 경우처럼 **커밋 없이** 배포해야 할 때:
  ```bash
  cd "<repo-root>"   # 앱 디렉터리 아님!
  VERCEL_ORG_ID=<team> VERCEL_PROJECT_ID=<prj> vercel --prod --yes
  ```
  - ① **커밋 없는 재배포는 `ignoreCommand` 가 Canceled 시킨다** — `git diff --quiet "$P" HEAD ./ …` 가 exit 0(=생략). 웹훅·대시보드 Redeploy 로는 env 변경을 반영할 수 없다. CLI 직접 배포는 `VERCEL_GIT_PREVIOUS_SHA` 가 비어 `exit 1`(빌드) 분기로 빠져 통과한다.
  - ② **앱 디렉터리에서 실행하면 실패** — 프로젝트 설정 `rootDirectory=apps/{editor,admin}` 가 cwd 에 덧붙어 `apps/editor/apps/editor` 를 찾는다. 반드시 레포 루트에서.
  - ③ **루트 `.vercel` 을 그대로 쓰면 안 된다** — 별개 프로젝트 `storige`(prj_KOfH…)에 링크돼 있다. `VERCEL_PROJECT_ID` 를 `apps/*/.vercel/project.json` 에서 읽어 명시할 것.
  - ④ 프로덕션 배포는 자동모드 classifier 가 차단 → '권한 무시' 모드 필요.
- **히스토리 재작성 여파(2026-07-27)**: 원격·VPS 는 정리 완료. 남은 위험은 **로컬 구 히스토리 ref**(backup/* 3개) — push 하면 IP 가 PUBLIC 레포로 재유입된다. 절대 push 금지.
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="<base>..HEAD"`.
- 자동모드 classifier 가 프로덕션 액션(SSH/DB/push/배포)을 차단 → '권한 무시' 모드 필요.

### 빌드
- **`esbuild.pure` 는 minify 패스에서만 동작** — dev/serve 는 무영향. 간접 참조(`const log = console.log`, 객체 메서드)는 제거되지 않으므로 그런 코드는 `import.meta.env.DEV` 로 직접 게이팅해야 한다.
- `pnpm --filter @storige/editor exec tsc -b --noEmit` 은 TS6310 으로 실패한다. 반드시 `typecheck` 스크립트(`tsc -b`)를 쓸 것.
- 프로덕션 빌드 시 rollup-plugin-visualizer 가 `open:true` 라 로컬에서 브라우저 탭이 열린다(CI 무해).

### 캔버스/좌표
- workspace Rect = **트림 + 블리드**(`size + cutSize`, 각 변 cutSize/2). 인쇄 결과만 캡처하려면 사방 인셋 필수 — 3D 표지 캡처가 이 규약을 사용한다.
- fabric `toDataURL` 은 픽셀 복사가 아니라 오프스크린 **재렌더** → 확대/패닝으로 화면 밖에 나간 영역도 잘리지 않는다.
- 나머지 canvas-core 함정 정본 = [[reference_canvas_core_test_harness]] + 07-25 문서 §3.

### 소스맵/빌드 게이트 (2026-07-27 신설)
- 정책 단일 소스 = `apps/{editor,admin}/vite.config.ts` 의 `canUploadSourcemaps`. `scripts/strip-sourcemaps.mjs` 가 같은 계산을 복제한다(**산출물에서 추론 금지** — 벤더 파일 1개로 전체 판정이 뒤집히던 구조를 폐기).
- 삭제는 반드시 `check-source-exposure --dist` **뒤에**. `.map` 의 sourcesContent 가 dist 게이트의 최강 탐지 채널이다.
- 교차확인은 '**실재하는 .map 을 가리키는** 말미 참조'만 위반으로 센다 — onnxruntime `ort.bundle.min-*.mjs` 는 없는 맵을 가리키는 dangling 참조라 오탐 대상.
- `turbo run build` 는 strict env 라 `turbo.json` 의 `build.env` 에 없는 변수는 태스크에 **전달되지 않는다**(킬스위치가 조용히 무효). 새 빌드 스위치를 만들면 여기에 등재할 것.
- `vercel.json` 의 `ignoreCommand` 감시 경로에 없는 디렉터리는 고쳐도 **배포되지 않는다**. `scripts/`·`pnpm-lock.yaml` 을 이번에 추가했다.
- `docker/editor/Dockerfile` 은 `scripts/` 를 COPY 해야 postbuild 가 산다(누락 시 이미지 빌드 실패 → stale 이미지 상시 가동).
- nginx `/embed/` 는 `dist-embed` 를 **직접 alias 서빙**한다 — bookmoa 복사를 막아도 노출은 안 닫힌다.

### 검증 환경 한계
- 내장 브라우저 페인은 **devicePixelRatio 변경 불가**(⌘+/− 주입 안 됨)이고 뷰포트 리사이즈가 페이지 레이아웃에 반영되지 않는 경우가 있다. dpr 의존 검증은 오너 실기로 넘길 것.
- 편집기 라이브 기본 진입(`https://editor.papascompany.co.kr/`)은 **샘플 8×8 inch 책(24p, 표지 스프레드+내지)** 를 로드한다 → 스프레드 기능 육안 검증에 그대로 쓸 수 있다.

---

## 4. 워크트리·브랜치·정본

**[갱신 2026-07-28] 워크트리 3개 전부 `339fd1b`(=origin/master) 정렬 완료** — 세션 간 동일 기준선. 신규 작업은 여기서 새 브랜치를 딴다.

| 워크트리 | 브랜치 | HEAD |
|---|---|---|
| `storige/` (메인, 문서 정본 보관) | `master`(신규, origin/master 추적) | 339fd1b |
| `storige-e2-w1/` | `feat/e2-distribute-finish`(고유 커밋 0, ff) | 339fd1b |
| `storige-fix-20260713/` (작업 기반) | `fix/swagger-partner-curation-rebased` | 339fd1b |

- 07-28 동기화 실측: 세 브랜치 모두 origin/master 대비 **0 ahead**(순수 조상) · tracked 변경/stash 0 · untracked 문서는 전량 보존. `feat/e2-distribute-finish`는 재작성 전 `ec8b95c` ↔ master `d3f5cd1` **패치 동일** 대조 후 ff.
- **[정리 2026-07-28] 병합 완료 브랜치 4개 삭제** — 로컬 9개 → **6개**(`backup/*` 3 + 워크트리 3). 복구용 SHA: `docs/d10a-shopify-guide-split`=22f10b5 · `fix/editor-stale-chunk-and-pointer-dpr`=22f10b5 · `fix/mockup3d-cover-images-and-log-gating`=282bce0 · `fix/swagger-partner-curation`=7950c87(구 히스토리라 `-D`, 나머지 3은 순수 조상 `-d`).
  - 삭제 전 대조: 앞 3개는 origin/master 의 조상(0 ahead)이라 유실 0. `fix/swagger-partner-curation`은 재작성 전 히스토리라 612 ahead 로 보였으나 **결과 파일 대조**로 확인 — `swagger-partner-routes.{ts,spec.ts}` 내용 동일, `main.ts` 9줄 차이는 전부 **master 쪽 추가분**(`partner-v1` 태그+주석)이고 구 브랜치 고유 줄은 0. 즉 master 가 상위집합.
  - 부수 효과: 구 히스토리(VPS IP 포함) 로컬 ref 가 1개 줄었다. **남은 구 히스토리 ref = `backup/*` 3개뿐**(§3 push 금지 규칙 계속 적용).
- **[기록 2026-07-28, 타 세션] D-10a 해소 확정 — E-3(문서 포털) 소스 블로커 없음**: `PLATFORM_INTEGRATION_GUIDE.md` 정본(파트너용) master 복원 + Shopify 내용은 `SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.md`(43fc2ea)로 분리 커밋·푸시 완료. HTML 쌍둥이도 `SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.html`로 로컬 리네임(미추적 관행 유지). WH-001 서명 정정 배너는 `566e5cf`로 master 반영 확인.

### 정본 문서
- 직전 세션 상세: `RESUME_PROMPT_2026-07-25.md`(E2 잔여·세대가드·editor #1/#2) · `RESUME_PROMPT_2026-07-24.md`.
- 설계: `TRACK_C_IMPL_DESIGN_2026-07-23.md` · `E2_IMPL_DESIGN_2026-07-23.md` · 대조 `G6_COMPARISON_2026-07-24.md` · 공지 `NOTICE_bookmoa_mobile_c6b_delete_modal_2026-07-24.md`.
- Swagger allowlist 정본: `apps/api/src/config/swagger-partner-routes.ts` — **파트너 라우트 신설 시 `docs/PLATFORM_INTEGRATION_GUIDE.md` 표와 함께 갱신**(fail-closed: 목록에 없으면 production 문서에서 비노출).
