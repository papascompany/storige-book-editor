# RESUME PROMPT — 2026-07-29 (세션 정본 · 클린 핸드오프)

> ## ⛔ 이 문서는 더 이상 최신이 아니다 — 정본은 **`RESUME_PROMPT_2026-07-30.md`**
> 여기 남은 §2(오너 액션)는 **전량 종결**됐고, §3-1 ①의 "대시보드 Redeploy 로는 반영 불가"는 **실측으로 반증**됐다(문서 내 정정 블록 참조). 함정 §3-2·3-3·3-5 와 소스맵 차단 경위는 계속 유효하므로 참조용으로 보존한다.
>
> <sub>이하 원문 (작성 시점 기준)</sub>

> **이 문서가 최신 정본이다.** 직전 체인: 07-24(트랙C+E2 LIVE) → 07-25(E2 잔여·editor #1/#2) → 07-27(3D표지·콘솔제거·Swagger·소스맵 배선) → **07-29 전반(소스맵 노출 차단 프로덕션 LIVE · 워크트리 3개 동기화 · 브랜치 정리 · 의존성/빌드 검증)** → **07-29 후반(§2 재확인 = 여전히 미등록 · 라이브 차단 재검증 · 루트 `vercel.json` dead config 규명·제거)**.
> 최종 실측 시각: **2026-07-29 23:10 KST**.

---

## 0. 착수 전 확인 (2분)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige-fix-20260713"   # 작업 기반
git fetch && git rev-parse --short origin/master    # 본 문서 기준: e2ccf0f
git worktree list && git status -sb
```

**본 문서 작성 시점 기준선 = `e2ccf0f`, 워크트리 3개 전부 동기(0 ahead / 0 behind).** 의존성 설치·빌드 검증까지 끝난 상태라 **바로 작업 착수 가능**하다.

⚠️ **단, 기준선은 세션 중에도 움직인다.** 본 세션에서 실제로 겪었다 — 작업 도중 병행 세션이 25커밋(+7,019줄)을 push해 `339fd1b` → `e2ccf0f` 로 바뀌었다. `fetch` 결과가 위와 다르면 §4 를 낡은 것으로 간주하고 다시 맞춰라.

### 병행 세션이 소유한 트랙 (손대지 말 것)
| 트랙 | 대표 커밋 | 내용 |
|---|---|---|
| SDK embed | `e2ccf0f`(merge)·`d1e6634`·`a1668af` | `packages/sdk` `./embed` 서브패스(+2,600줄), 수신 명령 계약 v1, D14 `e.source` 대조로 동일출처 타 프레임 명령 주입 차단 |
| 파트너 문서 포털 | `0157d91`(merge)·`1953ceb`·`38d8274` | md→html 파이프라인, llms.txt, CI 게이트, Vercel 배선, 색인 fail-closed. **신규 워크스페이스 `@storige/docs`** |
| 소스 노출 게이트 | `4f52d55` 외 | `scripts/check-source-exposure.mjs` **+308줄** — 본 세션 트랙과 겹친다. **소스 노출 작업을 이어간다면 이 변경분을 먼저 읽어라.** |

---

## 1. 본 세션 완료 내역

### 1-1. 소스맵 공개 차단 — **프로덕션 LIVE** ✅
`SOURCEMAP_STRIP=1` 을 `storige-editor`·`storige-admin` **Production** 에 등록(`printf '%s'` — 개행 오염 0) 후 CLI 수동배포.

| 대상 | 판정 (2026-07-29 재확인) |
|---|---|
| editor | 엔트리 맵 **404** · 표본 4청크 전부 404 · `sourceMappingURL` 참조 0 · `/stats.html` 은 1,215B index.html 폴백 |
| admin | 맵 요청이 **460B `text/html` 폴백**(직전 8.26MB JSON) · `sourceMappingURL` 참조 0 |

> ✅ **핵심 실증 2건**
> ① env 는 프로젝트 레벨이라 **병행 세션이 새로 배포해도 차단이 유지된다**(양쪽 엔트리 해시가 바뀐 뒤에도 404 확인). 재적용 불필요.
> ② **로컬 빌드는 맵을 보존한다**(`[strip-sourcemaps] 업로드 미배선 — .map 24건 보존`). 게이팅이 양방향으로 동작한다는 증거이지 결함이 아니다.
>
> ⚠️ **현재 프로덕션 스택트레이스는 minified** — 심볼리케이션을 포기하고 노출만 끊은 상태(오너 선택). 복구 = §2 ⓐ.

### 1-2. 워크트리·브랜치 정리
- 메인 `storige/` 를 `docs/d10a-shopify-guide-split` → 신규 로컬 `master`(origin/master 추적)로 전환.
- 워크트리 3개 전부 `merge --ff-only` 로 `e2ccf0f` 동기(전부 0 ahead·tracked 변경 0이라 유실 가능성 원천 차단). untracked 계획 문서 전량 보존.
- **병합 완료 브랜치 4개 삭제**(로컬 9→6). 복구 SHA: `docs/d10a-shopify-guide-split`=22f10b5 · `fix/editor-stale-chunk-and-pointer-dpr`=22f10b5 · `fix/mockup3d-cover-images-and-log-gating`=282bce0 · `fix/swagger-partner-curation`=7950c87.
  - 4번째는 구 히스토리라 612 ahead 로 보였으나 **결과 파일 대조**로 확인 후 `-D`: `swagger-partner-routes.{ts,spec.ts}` 동일, `main.ts` 9줄 차이는 전부 master 쪽 추가분, 구 브랜치 고유 줄 0.
  - 부수 효과: 구 히스토리(VPS IP 포함) 로컬 ref 1개 감소. **남은 구 히스토리 ref = `backup/*` 3개뿐 — push 절대 금지.**

### 1-3. 의존성·빌드 검증 (`storige-fix-20260713`)
- `corepack pnpm install` → exit 0, **"Lockfile is up to date"**(lockfile·package.json 오염 0), 워크스페이스 15개.
- `corepack pnpm build` → **9/9 successful, 26.9s, 에러 0건**. 대상: `types · canvas-core · sdk · indesign-import · ai · api · worker · editor · admin`. `@storige/docs` 는 루트 스크립트가 `--filter=!@storige/docs` 로 의도적 제외(신규 `docs:build` 로 분리).
- 신규 SDK `./embed` 서브패스: `package.json` exports 12항목 전부 실제 산출물 존재 확인.
- postbuild 유출 게이트(병행 세션 수정본)가 editor/admin 양쪽에서 `금지 식별자 0건` 통과.
- 산출물: editor dist 61M · admin 9.4M · sdk 1.0M.

### 1-4. [후반] 루트 `vercel.json` 제거 — 런북 §8 미결 항목 해소 ✅
유출 게이트가 **IP-URL 2건**으로 검출하고도 *"이 파일을 쓰는 Vercel 프로젝트의 정체가 미확인"* 이라 차단하지 않고 예외로 남겨 둔 항목. 그 미확인 항목을 규명해 **dead config 확정 → 삭제**.

- **결정적 근거**: 루트 `.vercel` 이 가리키는 프로젝트 `storige`(`prj_KOfH…`)의 프로덕션 산출물이 **Next.js**(`λ index` · `_global-error.rsc` · `.segments`, 167 items) — Vite SPA 모노레포인 이 레포 루트에서 나올 수 없다 = **별개 코드베이스**.
- 보강: editor/admin 은 `rootDirectory=apps/{editor,admin}` + 각자 `vercel.json` 이라 루트 미상속 / 문서 포털은 `outputDirectory=site` + `cd ../..` 빌드커맨드라 Root Directory 가 `apps/docs` 여야만 빌드 성립(게이트가 우려한 상속 시나리오면 빌드 자체가 실패) / 이 파일을 읽는 코드 0건(CSP parity 테스트는 `process.cwd()` 기준이라 `apps/editor/vercel.json` 을 읽는다).
- 박혀 있던 IP 는 현 VPS 가 아니라 **인수 전 옛 서버**(`58.229…`) 주소. **현 VPS IP 는 tracked 0건** — 07-27 정화 유지 확인.
- 검증: `check:exposure` → 예외가 **"해소된 예외 — KNOWN_EXCEPTIONS 에서 삭제하세요"** 로 전환(내부 IPv4 0건) · `frameAncestorsCsp` **49/49** · gitleaks 0건.
- ⚠️ **완결 절차 ④(게이트 예외 항목 삭제)는 미수행** — `scripts/check-source-exposure.mjs` 가 병행 세션 소유라 손대지 않았다. 게이트가 스스로 삭제 안내를 띄우므로 그쪽이 받는다. **그 전까지는 예외 목록에 유령 항목이 남아 있다.**

### 1-5. [후반] 라이브 차단 재검증 — 새 해시로도 유지 ✅
병행 세션 재배포로 **엔트리 해시가 바뀐 뒤** 재확인(§1-1 실증 ①의 독립 재현).

| | 엔트리 | 맵 | `sourceMappingURL` | stats.html |
|---|---|---|---|---|
| editor | `index-C7Yd8K9Y.js` | **404** | 0건 | 1,215B 폴백 |
| admin | `index-HDEMHdrE.js` | **460B `text/html`** 폴백 | 0건 | 460B 폴백 |

---

## 2. 잔여 — 오너 액션 → **[2026-07-30 거의 종결]**

> ## ✅ ⓐ 완료 — 심볼리케이션 **프로덕션 복구**
>
> `SENTRY_ORG`·`SENTRY_PROJECT`·`SENTRY_AUTH_TOKEN` 3종이 editor·admin 양쪽에 등록되어 **Production 배포·검증 완료**.
> 확정값: 조직 `papascompany` / 프로젝트 slug `storige-editor` · `storige-admin`(라이브 번들 DSN 숫자 ID `4511325760978944`·`4511325762879488` 로 교차 대조) / Sentry 로그인 `yohan@papascompany.co.kr`.
>
> | | 빌드 로그 | 라이브 엔트리 | 맵 |
> |---|---|---|---|
> | editor | `sentryUpload=on` · `Uploaded files to Sentry` · `.map 24건 제거(24.3MB)` | `index-RaHuXHwF.js` | **404** |
> | admin | `Uploaded files to Sentry` · `.map 6건 제거(8.1MB)` | `index-DVw_BlZK.js` | **460B 폴백** |
>
> 양쪽 `sourceMappingURL` 참조 0건 · 유출 게이트 `금지 식별자 0건` 통과 · API `200`.
> **더 이상 "노출 차단 = 심볼리케이션 포기" 트레이드오프가 아니다** — 맵은 Sentry 에 debug ID 와 함께 올라가고 산출물에서만 사라진다.
>
> ## ✅ ⓑ 도 종결 — Preview 까지 3종 완비
>
> editor·admin **양쪽 모두 `SENTRY_ORG`·`SENTRY_PROJECT`·`SENTRY_AUTH_TOKEN` 이 `Production, Preview`** 로 등록됐다(실측 `vercel env ls`).
> → Preview 빌드도 `canUploadSourcemaps=true` 라 **`SOURCEMAP_STRIP` 없이 자동 strip + 업로드**된다. 원래 ⓑ였던 "Preview `SOURCEMAP_STRIP` 등록(CLI 불가)" 과제는 **소멸**했다.
> 기존 `SOURCEMAP_STRIP=1`(Production) 은 남겨 둬도 무해하다 — 3종이 빠지는 사고가 나면 최소한 노출 차단은 유지되는 이중 안전판이 된다.
>
> **§2 오너 액션은 전부 종결됐다.**

<details><summary>아래는 등록 전 원본 지시문 (이력용)</summary>

### ⓐ `SENTRY_*` 3종 등록 🔑 — 심볼리케이션 복구
두 프로젝트에 `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN` 등록 → 다음 빌드부터 hidden+업로드+삭제 자동 전환.

- **에이전트가 못 하는 이유**: AUTH_TOKEN 은 Sentry UI 발급 자격증명(대리 입력 불가). ORG/PROJECT slug 는 비밀값이 아니지만 **레포에 없다** — 실측: `scripts/activate-sentry.sh` 는 DSN 플레이스홀더만 보유, slug 문자열 `scripts/` 전체 0건. DSN 에는 숫자 id 만 있어 유추 불가.
- 절차·slug 확인법·검증·롤백 = **`docs/SOURCEMAP_EXPOSURE_RUNBOOK.md`**.
- ⚠️ **대시보드 붙여넣기로 등록.** `echo | vercel env add` 는 값 끝에 개행을 저장한 전례가 있고, 개행 붙은 토큰은 **게이팅만 통과하고 `sentry-cli` 가 401 로 죽는** 최악의 무증상 조합이 된다.

### ⓑ Preview 환경 `SOURCEMAP_STRIP=1` — **CLI 로는 불가 확정**
2026-07-29 실측(CLI v54.2.0), 4형태 전부 `git_branch_required` 무한 반복: ①stdin 파이프 ②`--value 1 --yes`(CLI 가 스스로 제안한 명령) ③`< /dev/null` ④`--force`. 브랜치 지정형(`… preview master`)은 `branch_not_found`(master 가 프로덕션 브랜치라 정상 거부).
→ **대시보드에서 Preview(All Branches) 로 추가.** Preview URL 도 공개라 같은 노출 위험.

**두 건 모두 등록 후 재배포가 필요하고, §3-1 때문에 웹훅/대시보드 Redeploy 로는 반영되지 않는다.**

</details>

### 등록 과정에서 확정된 함정 (2026-07-30)
- **Preview env 는 CLI 로 등록 불가 — 재확인.** v54.2.0 에서 `git_branch_required` 가 나오고, **CLI 가 스스로 제안한 "all Preview branches" 명령(`--value … --yes`)을 그대로 실행해도 같은 에러를 반복**한다. 대시보드가 유일한 경로다. 대시보드에서는 **Branch 칸을 비워야** 전체 Preview 에 적용된다(Custom Preview Branch 를 고르면 그 브랜치 전용).
- **Production env 는 CLI 로 가능.** 단 `printf '%s' <값> | vercel env add <KEY> production` 형태로 — `echo` 는 개행을 저장한다.
- 토큰류는 에이전트가 입력하지 않는다(안전 규칙). `SENTRY_AUTH_TOKEN` 은 오너가 대시보드에 직접 붙여넣었다.

---

## 3. 함정

### 3-1. editor/admin CLI 수동배포 — **커밋 없이 배포해야 할 때** (본 세션 확립)
```bash
cd "<repo-root>"   # 앱 디렉터리 아님!
VERCEL_ORG_ID=<team> VERCEL_PROJECT_ID=<prj> vercel --prod --yes
```
- ① **취소되는 것은 "웹훅(git push)" 경로다** — `git diff --quiet "$P" HEAD ./ …` 가 exit 0(생략). 실측 재확인: 2026-07-29 master push(루트 파일 1건 변경) 때 editor·admin **양쪽 Canceled**(4s/6s).
  - ⚠️ **[2026-07-30 정정] "대시보드 Redeploy 로는 반영 불가"는 틀렸다.** 대시보드 Redeploy 는 **정상적으로 빌드된다** — 실측 `storige-editor-hj687jwl6`(Ready 1m, 로그에 `Retrieving list of deployment files…` → `sentryUpload=on` → `.map 24건 제거`). Redeploy 는 git 이 아니라 기존 배포 파일을 재사용해서 `VERCEL_GIT_PREVIOUS_SHA` 가 비고, 그 결과 **CLI 직접 배포와 같은 `exit 1`(빌드) 분기**를 탄다.
  - 정리: **env 변경 반영 경로는 ⓐ CLI 직접 배포 ⓑ 대시보드 Redeploy 둘 다 유효**하고, 막히는 건 **커밋 없는 git push(웹훅)** 뿐이다.
- ② **앱 디렉터리에서 실행하면 실패** — `rootDirectory=apps/{editor,admin}` 가 cwd 에 덧붙어 `apps/editor/apps/editor` 를 찾는다.
- ③ **루트 `.vercel` 을 그대로 쓰면 안 된다** — 별개 프로젝트 `storige`(prj_KOfH…)에 링크돼 있다. `VERCEL_PROJECT_ID` 를 `apps/*/.vercel/project.json` 에서 읽어 명시할 것.
- ④ 프로덕션 배포는 **자동모드 classifier 가 차단** → '권한 무시' 모드 필요.

### 3-2. 검증 판정
- **admin 은 상태코드로 판정하면 오판한다** — catch-all rewrite(`/(.*)` → `/`) 때문에 없는 파일도 200+index.html 을 준다. **content-type/크기로 볼 것**(차단 시 460B `text/html`). `/stats.html` 도 동일(1,215B = 리포트 없음). editor 는 정직하게 404.

### 3-3. 로컬 툴체인 (본 세션 확립)
- **pnpm 을 그냥 쓰지 말 것** — 시스템 pnpm 10.33.4 vs 레포 `packageManager: pnpm@9.15.0`. **`corepack pnpm …`** 으로 고정 버전 사용(pnpm 10 은 의존성 postinstall 정책이 다르고 lockfile 을 건드릴 수 있다). node 는 v22.22.2 로 `engines: >=22` 충족.
- **빌드 로그 grep 은 `-a` 를 붙일 것** — turbo 로그에 NUL 바이트가 섞여 grep 이 파일을 **바이너리로 판정하고 조용히 0건을 반환**한다. 본 세션에서 "에러 0건" 판정이 한 번 무효화됐다(결론은 같았으나 근거가 없었다). `grep -a` 로 재검증할 것.

### 3-4. 브랜치 push 는 Preview 빌드를 **실제로 돌린다** — 다만 SSO 가 막는다 (2026-07-29 실측)
`chore/remove-dead-root-vercel-json` push 로 실측한 결과다.

- **빌드는 돈다.** `ignoreCommand` 는 `VERCEL_GIT_PREVIOUS_SHA` 가 **비면 `exit 1`(빌드)** 로 분기 → **새 브랜치의 첫 push 는 감시 경로와 무관하게 빌드된다.** 실측: editor·admin **양쪽 Preview 배포 Ready**(루트 파일 변경 1건뿐인데도. editor 감시 경로 = `./ packages/{types,canvas-core,ui} scripts pnpm-lock.yaml` / admin = `./ packages/{types,ui,indesign-import} scripts pnpm-lock.yaml` — 루트는 양쪽 범위 밖).
- ~~**그 Preview 에는 `SOURCEMAP_STRIP` 이 없다** → 산출물에 `.map` 이 들어 있다.~~ **[2026-07-30 해소]** Preview 에 `SENTRY_*` 3종이 등록되어 **Preview 빌드도 strip + 업로드**된다. 아래 SSO 방어선에 더해 산출물 자체에 맵이 없으므로 이 항목은 이제 이중으로 막혀 있다.
- **그러나 실질 노출은 0.** Vercel SSO Deployment Protection 이 **전 경로**에 걸려 있다 — `/` · `/favicon.ico` · `/index.html` · `/assets/` · `/stats.html` 전부 **302 → `vercel.com/sso-api`**. 인증 없이는 맵은커녕 엔트리 이름도 못 얻는다.
- ⚠️ **따라서 리스크는 조건부다**: Deployment Protection 을 끄거나(대시보드 설정 **1개**가 유일한 방어선) Protection Bypass 토큰이 새면 즉시 현실화된다. ⓑ 등록이 여전히 옳은 이유가 이것이다 — 방어선을 2중으로 만든다.
- 결론: 브랜치 push 자체는 **막을 이유가 없다**. 단 Protection 을 끄는 변경을 할 때는 ⓑ 를 먼저 등록할 것.

### 3-5. 그 외
- 07-27 문서 §3(빌드·캔버스·소스맵 게이트·turbo strict env·Dockerfile COPY·nginx `/embed/` alias)은 **여전히 유효**.
- `backup/*` 3개는 구 히스토리(VPS IP 포함) — **push 하면 PUBLIC 레포로 재유입된다.**
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="<base>..HEAD"`.
- API/worker = VPS SSH 수동 배포(`docker compose build api && up -d api` **+ nginx restart**).

---

## 4. 상태 스냅샷 (2026-07-29 21:28 KST 실측)

| 워크트리 | 브랜치 | HEAD | 상태 |
|---|---|---|---|
| **`storige-fix-20260713/`** ← 작업 기반 | **detached @ `origin/master`** | **1037c02** | ff 머지 후 브랜치 **로컬·origin 양쪽 삭제**(복구 SHA `1037c02` = 현 master) · untracked 3 보존 · install+build 검증 완료 |
| `storige/` | `master` | **1037c02** | **origin/master 와 동기(push 완료)** · 문서 정본 보관용 · untracked 52 |
| `storige-e2-w1/` | `feat/e2-distribute-finish` | e2ccf0f | master 보다 1 behind · 완전 클린 |

- `origin/master` = **`1037c02`** (직전 `e2ccf0f` → §1-4 를 **fast-forward 머지·push**). 전반 세션의 25커밋 급변 이후 병행 세션 push 는 없었다.
- ⚠️ **master push 로 프로덕션은 바뀌지 않았다** — editor·admin 자동배포가 **양쪽 Canceled**(4s/6s). `ignoreCommand` 가 루트 파일을 감시 범위 밖으로 판정했기 때문이고, 이는 §3-1 ①(커밋 없는 재배포 취소)과 **같은 메커니즘의 다른 얼굴**이다. 라이브는 19h 전 배포가 계속 서빙 중이며 소스맵 차단도 그대로다.
- 라이브: editor `index-C7Yd8K9Y.js`(맵 404) · admin `index-HDEMHdrE.js`(맵 460B 폴백) — 병행 세션 재배포로 §1-1 당시 해시에서 바뀌었으나 차단은 유지.
- **작업 기반은 이제 detached 다.** 신규 작업은 여기서 `git switch -c <새이름> origin/master` 로 시작하면 된다(전반 세션의 함정 — 이미 머지된 이름 `fix/swagger-partner-curation-rebased` 위에서 계속 작업하던 상태 — 이 재발하지 않는다).
- **로컬 브랜치 8개 — 머지 완료·미점유 브랜치는 0개다**(정리 끝). 남은 것은 전부 의도적 보존:
  - 병행 세션이 워크트리로 점유 중인 5개: `docs/guide-s6-embed-merge` · `feat/e2-distribute-finish` · `feat/embed-command-contract` · `feat/p4-docs-portal` · `fix/guest-session-siteid` — **손대지 말 것**(master 에 머지돼 있어도 삭제 금지).
  - `backup/*` 3개: 구 히스토리(VPS IP 포함) — **push 절대 금지**(§3-5).
  - 후반 세션 삭제분 복구 SHA: `chore/remove-dead-root-vercel-json`=`1037c02`(로컬+origin) · `fix/swagger-partner-curation-rebased`=`e2ccf0f`(로컬 전용, origin 에 없었음).
- **RESUME 문서는 07-21 이후 전부 untracked 관행**(마지막 tracked = `RESUME_PROMPT_2026-07-02.md`). 이 문서도 커밋하지 않는다 — 코드 커밋에 섞지 말 것.

---

## 5. 정본 문서
- 직전 상세: `RESUME_PROMPT_2026-07-27.md`(3D표지·콘솔제거·Swagger·소스맵 배선 + §3 함정 원본)
- 소스맵: `docs/SOURCEMAP_EXPOSURE_RUNBOOK.md`
- Swagger allowlist: `apps/api/src/config/swagger-partner-routes.ts` — 파트너 라우트 신설 시 `docs/PLATFORM_INTEGRATION_GUIDE.md` 표와 함께 갱신(fail-closed)
- 설계: `TRACK_C_IMPL_DESIGN_2026-07-23.md` · `E2_IMPL_DESIGN_2026-07-23.md`
- 운영 실값(SSH·키·도메인): `storige/CLAUDE.local.md`(gitignored)
