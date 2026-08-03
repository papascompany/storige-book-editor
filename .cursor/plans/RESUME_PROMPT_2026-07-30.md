# RESUME PROMPT — 2026-07-30 (세션 정본)

> ⚠️ **후속 정본 존재** — 최신 정본은 `RESUME_PROMPT_2026-08-01.md` 다(08-01 정리 트랙 ·
> 감사 §8 코드성 전량 종결 · 확립 함정 3건 코드 해소 반영). 본 문서는 §1-1~1-10 상세와
> §3 함정 원본을 위해 보존한다.

> **이 문서가 최신 정본이다.** 직전 체인: 07-27(3D표지·콘솔제거·Swagger·소스맵 배선) → 07-29(소스맵 노출 차단 LIVE·워크트리 정리) → **본 세션(소스맵 오너액션 전량 종결 · 루트 vercel.json 제거 · Node 24 감사+Vercel 승격 LIVE · api 썸네일 2중 결함 수정 LIVE)**.
> 최종 실측: **2026-08-01 18:10 KST**. `origin/master` = **`92e3cf8`** (08-01 §1-8·§1-9·§1-10 반영)

---

## 0. 착수 전 확인 (2분)

```bash
cd "/Users/yohan/Developer/Bookmoa Storige editor/storige"
git fetch && git rev-parse --short origin/master    # 본 문서 기준: 6de9232
git worktree list && git status -sb
```

⚠️ **기준선은 세션 중에도 움직인다.** 본 세션에서 두 번 겪었다(`1037c02`→`8db37cc` 병행 세션 8커밋). `fetch` 결과가 다르면 §4 를 낡은 것으로 간주하라.

### 병행 세션 소유 트랙 (손대지 말 것)
| 트랙 | 대표 커밋 | 워크트리 |
|---|---|---|
| 게스트 세션 siteId 스탬프 | `8db37cc`(merge) 외 8건 | `wt-guest` |
| SDK embed · 파트너 문서 포털 | `e2ccf0f` · `4f52d55` | `wt-s7` · `wt-e3` |
| 유출 게이트 `check-source-exposure.mjs` | — | 본 세션과 겹침 — **수정 전 반드시 읽을 것** |

---

## 1. 본 세션 완료

### 1-1. 소스맵 §2 오너 액션 **전량 종결** ✅
`SENTRY_ORG`·`SENTRY_PROJECT`·`SENTRY_AUTH_TOKEN` 3종을 editor·admin **Production + Preview** 에 등록 → 심볼리케이션 복구.

- 확정값: 조직 `papascompany` / slug `storige-editor`·`storige-admin` / 로그인 `yohan@papascompany.co.kr`
  (라이브 번들 DSN 숫자 ID `4511325760978944`·`4511325762879488` 로 교차 대조)
- 빌드 로그 실증: `sentryUpload=on` · `Uploaded files to Sentry` · editor `.map 24건 제거` / admin `6건 제거`
- **ⓑ(`SOURCEMAP_STRIP` Preview)는 소멸** — 3종이 Preview 에 있으면 `canUploadSourcemaps=true` 라 `SOURCEMAP_STRIP` 없이도 strip 된다. Production 의 기존 `SOURCEMAP_STRIP=1` 은 이중 안전판으로 남겨 둔다.
- **더 이상 "노출 차단 = 심볼리케이션 포기" 트레이드오프가 아니다.**

### 1-2. 루트 `vercel.json` 제거 (`1037c02`) ✅
유출 게이트가 IP-URL 2건으로 검출하고도 *"이 파일을 쓰는 Vercel 프로젝트 미확인"* 이라 예외로 남겨 둔 항목을 규명해 **dead config 확정 → 삭제**.

- 결정적 근거: 루트 `.vercel` 이 가리키는 프로젝트 `storige` 의 산출물이 **Next.js**(`λ index`·`_global-error.rsc`·`.segments`) — Vite SPA 모노레포인 이 레포 루트에서 나올 수 없다 = **별개 코드베이스**
- 박혀 있던 IP 는 현 VPS 가 아니라 **인수 전 옛 서버**. **현 VPS IP 는 tracked 0건**(07-27 정화 유지)
- ⚠️ 게이트의 `KNOWN_EXCEPTIONS` 항목 삭제는 **미수행** — 병행 세션 소유 파일이라 손대지 않았다. 게이트가 *"해소된 예외 — 삭제하세요"* 로 스스로 안내한다.

### 1-3. Node 24 업그레이드 — 감사 + Vercel 승격 **LIVE** (`58a5166`) ✅
44 에이전트 정적 감사(발견 38 → 적대검증 생존 34) **+ 실제 Node 24.18.1 실증**. **차단 요인 0건.**

- 조치는 **2줄**: `apps/{editor,admin}/package.json` 에 `"engines": { "node": "24.x" }`
- 양쪽 프로덕션 빌드 로그가 `Node.js Version "24.x" will be used instead` 로 확인
- 정본 리포트: **`.cursor/plans/NODE24_UPGRADE_AUDIT_2026-07-30.md`**

### 1-4. api 썸네일 **2중 결함** 수정 LIVE (`8175532` + `6de9232`) ✅
`GET /files/:id/thumbnail`(파트너 대외 계약 라우트)이 프로덕션에서 **한 번도 성공한 적 없었다**(전 레코드 `thumbnail_url` 공란).

| 겹 | 원인 | 조치 |
|---|---|---|
| ① | api 이미지에 **Ghostscript 부재** (`docker exec storige-api which gs` → 없음) | Dockerfile `apk add ghostscript` + compose `GHOSTSCRIPT_PATH` |
| ② | **`generateThumbnail` 만 s3 분기 누락** — `file_path` 가 `s3://…` 인데 GS 에 그대로 넘김 | `getStream` → 임시 `.tmp.pdf` → `finally` 정리 |

- **②가 더 큰 원인이었다**: 프로덕션 files 166건 중 **110건이 `s3://`**(2026-06-19~07-27, 최근 업로드는 전부). gs 만 넣었으면 여전히 전량 실패했다. `getFileStream` 은 같은 분기를 갖고 있었고 썸네일 경로만 누락 — 저장계층 s3 전환(2026-06-13)의 사각.
- 곁들여 수정: execFile `timeout(30s)`·`maxBuffer(8MB)` 명시(기본 0=무제한), `-q`, 임시파일 uuid 고유화(`?width=200`/`400` 동시요청 경합)
- **프로덕션 실호출 검증**: s3 **200 image/png**(재호출·다른 width 포함) · local 200 · 임시파일 잔재 0 · DB `thumbnail_url` 최초 기록
- 회귀 가드 5건 신설 `apps/api/src/files/files.service.thumbnail-gs.spec.ts`

### 1-5. 공인 노출 포트 3종 루프백 봉합 LIVE (`e8c7da6`) ✅
`:3000` 조사 중 **같은 종류의 노출 2건을 추가 발견**해 함께 봉합했다. ufw 는 22/80/443 만 허용하는데 셋 다 외부에서 응답했다 — **Docker 포트 매핑이 ufw 를 우회**하는, 2026-07-13 Redis SLAVEOF 하이재킹과 동일한 메커니즘(그때 mariadb·redis 만 봉합됨).

| 포트 | 실측 | 조치 |
|---|---|---|
| `:3000` editor | 200. 최근 24h **100건 전량 스캐너**(CensysInspect · `/api/v1/users/search` 프로브 · TLS 오폭), 정당 사용자 0. Vercel editor 와 중복이고 nginx 도 미사용(`/embed/` 는 alias) | `127.0.0.1:3000:80` |
| `:4001` worker | `/health` 200. 내부 잡 전용인데 공인 응답, 외부 직접 호출 48h 0건 | `127.0.0.1:4001:4001` |
| `:4000` api | 404 JSON. 정상 경로는 nginx 경유 https 도메인 | `127.0.0.1:4000:4000` |

- **무영향 근거**: 내부 통신이 전부 컨테이너명 경유(`proxy_pass http://api:4000`, worker 의 `API_BASE_URL=http://api:4000/api`) → 포트 매핑은 외부 노출 용도로만 존재했다.
- 검증: 외부 3포트 **전부 차단** · nginx 경유 443 `200` · 내부 루프백 200 · 썸네일 200 image/png · Bull 큐 0/0
- **공인 바인딩은 이제 nginx 80/443 뿐이다.** 운영 접근은 SSH 터널: `ssh -L 3000:127.0.0.1:3000 -L 4000:127.0.0.1:4000 deploy@<host>`

### 1-6. NestJS 10.4.20 → 10.4.22 보안 패치 LIVE (`bef3d89`) ✅
감사 §8 ⑫ 조치. 조사 결과 10.4.22 는 일반 버그픽스가 아니라 **보안 릴리스**였다 — body-parser 1.20.4 로 **CVE-2025-15284**(express 요청 파싱 경로) 대응. 우리 lockfile 은 `body-parser@1.20.3` 을 **프로덕션 런타임 경로**로 물고 있었다.

- 함께 확인(조치 불요): CVE-2024-29409(FileTypeValidator RCE)는 10.4.16 에서 이미 수정 → 기존 10.4.20 도 안전 / CVE-2025-47944(multer)는 root overrides 로 기대응 / nest#16694 HIGH 5건은 전이 의존성(tar·lodash, 설치 시점 도구) → 별건. **즉 리포트가 우려한 "RCE 백포트 미수령"은 빗나갔고, 실질 위험은 body-parser 쪽이었다.**
- `packages/ai` 의 동일 devDeps 도 정리(런타임 무관이나 lockfile 구버전 잔존 = "패치 누락" 오독 방지). `examples/*` 의 express 4.21.2 는 파트너 참조 구현(미배포)이라 범위 밖.
- 검증: api 63/875 · worker 17/490 · nest build 양쪽 통과 → VPS 배포 후 **컨테이너 실측** `@nestjs/core 10.4.22` · `.pnpm` 에 `body-parser@1.20.4` 단독 · `platform-express` 가 실제 로드하는 인스턴스 1.20.4 · health 200 · 썸네일 200 · 큐 0/0 · 재시작 루프 없음.
- 롤백 태그: `storige-api:pre-nest10422` · `storige-worker:pre-nest10422` (VPS)

### 1-7. [07-31] worker CI 연결 (`9e33039`+`75af024`, PR#11) ✅
감사 §8 ⑤ 조치 — 네이티브 표면 최대인 worker 가 CI 미연결이던 공백을 배선(api 뒤·canvas-core 앞, timeout 20→25분, 시스템 의존성 추가 불필요 — GS 대역은 `/bin/sh`).

- **연결 첫 런이 곧바로 크로스 플랫폼 결함을 적발했다**: WK-3 타임아웃 스펙이 ubuntu 에서 결정적 실패(5016ms>3000ms). 원인 = dash 가 `sh -c 'sleep 5'` 의 sleep 을 **fork** → SIGTERM 이 sh 만 죽이고 고아 sleep 이 stdio 파이프 유지 → close 5s 지연. macOS bash·alpine ash 는 exec 최적화라 로컬에서 못 잡던 것. 수정 = 대역 명령에 `exec` 부착(컨테이너 실증: dash 5020ms→309ms). **프로덕션 무관**(실경로는 gs 바이너리 직접 spawn).
- 재실행 green: worker 스텝 success 18s(490 tests). 잔존: editor·admin·indesign-import CI 미연결.

### 1-8. [08-01] 정리 트랙 — 게이트 예외 0건 전환 + 워크트리/브랜치 위생 (`43db8f3`) ✅
- **ⓒ 종결**: 해소된 `KNOWN_EXCEPTIONS`(루트 vercel.json, 유일 항목) 제거 → **예외 0건 = 게이트 전면 실차단**. 소스 모드 통과·경고 소멸 실측. 항목 이력은 대장 주석으로 보존.
- **워크트리 6개 제거**: 병행 세션(종료됨) tmp 5개(wt-e3/guest/m3/s6/s7) + `storige-fix-20260713`(detached). 전부 클린·머지 확인 후 제거. `storige-fix` 의 untracked 문서 3건은 본진 `.cursor/plans/` 에 보존(**C6-b relay 발송본 포함** — 종전엔 삭제된 워크트리에만 있었다).
- **머지 완료 브랜치 4개 삭제**(docs/guide-s6-embed-merge · feat/embed-command-contract · feat/p4-docs-portal · fix/guest-session-siteid). 잔존 브랜치 = `backup/*` 3(**push 금지**) + `feat/e2-distribute-finish`(storige-e2-w1 점유, 머지됨 — 다음 정리 후보) + `master`.

### 1-9. [08-01] 감사 §8 코드성 잔여 일괄 — ⑤⑦⑧⑨⑩ 종결 (`0b487b6..5287c91`, 5커밋) ✅
- **⑦ 경로 가드**: `startsWith(base)` 형제 접두사 결함 2곳(worker-jobs.controller·files.service)을
  공유 헬퍼 `resolveStoragePath`(base+sep 경계·루트 거부)로 통합 봉합 + 회귀 스펙 9건.
  worker-jobs output 다운로드에 스트림 가드(res close destroy + err.code 분기 404/500 + Logger).
  **api VPS 배포 완료**(health 200·큐 0/0·롤백 태그 `storige-api:pre-s8guard`).
- **⑧ .dockerignore 신설**: node_modules/dist/.git/.cursor/docs/루트 .env/**storage**(VPS 최대
  기여자) 차단. ⚠️ `apps/editor/.env.production` 은 tracked vite 입력이라 제외 금지(파일 헤더 명시).
- **⑨ --frozen-lockfile 6곳**(api 2·worker 2·editor 1·admin 1). 이미지 3종(api·worker·editor)
  로컬 빌드 실증.
- **⑤ CI 완결**: editor(ai·canvas-core build 선행+typecheck+test)/admin/indesign-import 연결 —
  **테스트 보유 전 워크스페이스가 CI 게이트 안**. CI등가(Node 22) 실측: editor 529·admin 67·
  indesign 142 green.
- **⑩ 문서 드리프트**: FUTURE_UPDATES 거짓 기록("root engines 자동 빌드") 정정 + node:20 잔여
  3문서 + CLAUDE.local.md §6.2 레시피에 nginx 재시작 추가.
- 적대 리뷰(3렌즈+반증): 확정 4건(critical/major 0) 중 3건 반영(`5287c91`), 1건은 별건 후속
  (Content-Disposition 상속 — files/books 포함 3라우트 공통 기존 패턴이라 일괄 수정 대상).
- **CI 첫 실전 런이 '연결이 곧 적발' 3번째 사례를 즉시 생산**: indesign fixture(gitignored 고객
  자산)-의존 테스트 12건이 청정 체크아웃에서 ENOENT — 부재 skip 가드(fixtureTest 래퍼)로 수정
  (`af42d1d`, 양 모드 실측: fixture 유=139 green 불변 / 무=127 green+15 skip). **최종 ci success**(3m6s).

### 1-10. [08-01] 확립 함정 3건 — 문서 박제 → 코드 해소 승격 (`92e3cf8`) ✅
- **① indesign 글롭**: `node --test "src/**/*.test.mjs"` 인용 글롭으로 견고화(node 내부 globstar
  재귀 해석) — probe 파일로 dash 2단계 고정 누락을 재현한 뒤 매치 실측. "깊이 바뀌면 갱신" 주석 함정 소멸.
- **② Node 26 vitest localStorage**: editor 테스트 setup 에 부재 시 인메모리 Storage 폴리필 —
  Node 26 에서 40파일 전부 green(종전 49건 실패), Node 22 무회귀. ⚠️ window 재바인딩은 안 된다
  (vitest 에선 window === globalThis = 같은 undefined getter).
- **③ 스트림 에러 헤더 위생**: worker-jobs·files·books 3라우트 에러 분기에서
  Content-Type/Disposition/Length 제거 — Express res.json() 이 기설정 Content-Type 을 덮지 않아
  에러 JSON 이 application/pdf+attachment 로 나가던 것을 정상화(Express 실측). **api VPS 배포**
  (롤백 태그 `storige-api:pre-traps`).

---

## 2. 잔여

| # | 항목 | 성격 | 비고 |
|---|---|---|---|
| ⓐ | **Vercel Project Settings 20.x → 24.x** | 오너·대시보드 | engines 가 빌드를 24 로 덮고 있어 **급하지 않다**. 다만 `vercel project ls --update-required` 에서 빠지려면 필요. 기한 2026-10-01. CLI 로는 불가(`vercel project` 는 조회 전용) |
| ⓑ | Docker(api/worker)·CI Node 24 | 선택 | **강제 아님**(node:22-alpine EOL 2027-04-30). 24를 건너뛰고 Node 26 LTS(2026-10-28)를 기다리는 선택지도 합리적 |
| ~~ⓒ~~ | ~~유출 게이트 `KNOWN_EXCEPTIONS` 정리~~ | ✅ 완료 (08-01) | `43db8f3` — 예외 0건, §1-8 |
| ⓓ | **감사 §8 — 코드성 전량 해소(08-01 §1-9), 잔존 = ④ 뿐** | 오너 결정 | 해소 누적: ①②③⑥(07-30) + ⑤⑦⑧⑨⑩(08-01, `0b487b6..5287c91`).<br>**잔존: ④ 같은 VPS 의 Node 20(EOL) 컨테이너 `md2books-worker`**(별도 스택, 소유권 확인 필요 — 코드로 해결 불가). 별건 후속(nit): 스트림 에러 응답의 Content-Disposition 상속(3라우트 공통) |
| ~~ⓔ~~ | ~~머지된 브랜치 정리~~ | ✅ 완료 | `fix/api-thumbnail-ghostscript` 삭제(복구 SHA `8175532`). **머지 완료·미점유 브랜치 0개** — 남은 8개는 병행 세션 점유 5 + `backup/*` 3(**push 금지**) + `master` |

---

## 3. 함정 — 본 세션에서 새로 확립

### 3-1. Vercel `engines` 는 빌드를 덮지만 **Settings 를 바꾸지 않는다**
빌드 로그는 `Node.js Version "24.x" will be used instead` 로 확인되는데, 배포 성공 후에도 `vercel project inspect` 는 `20.x`, `--update-required` 목록에도 그대로 남는다. **"engines 만으로 완결"은 틀렸다.** 이중화하려면 대시보드도 바꿔야 한다.

### 3-2. **대시보드 Redeploy 는 빌드된다** — 취소되는 건 웹훅뿐 (07-29 문서 §3-1 정정)
`ignoreCommand` 의 `VERCEL_GIT_PREVIOUS_SHA` 가 비면 `exit 1`(빌드) 분기다. 대시보드 Redeploy 는 git 이 아니라 기존 배포 파일을 재사용하므로 이 분기를 타 **정상 빌드된다**(실측). 막히는 건 **커밋 없는 git push(웹훅)** 뿐.
→ env 변경 반영 경로: **CLI 직접 배포 · 대시보드 Redeploy 둘 다 유효**.

### 3-3. `canvas` 는 N-API 가 아니라 **ABI 의존** — Node 메이저 전환 시 재컴파일 필수
Node 24 로 빌드한 `canvas.node` 를 Node 22 로 로드하면 `canvas-core` 4개 스위트가 죽는다(실측). Docker·Vercel·CI 는 매번 새로 install 하므로 자동 해결이지만 **로컬은 `rm -rf node_modules && pnpm install` 이 필요**하다. 부분 install 은 스테일 ABI 바이너리를 남긴다.
- 덤: `pnpm.ignoredOptionalDependencies: ["canvas"]` 는 **차단되지 않는다** — 유입 경로가 fabric→jsdom 의 optional **peer** dependency라 그 설정이 커버하지 않는다.

### 3-4. api 빌드 46 에러는 대개 `@storige/types` 미빌드
`pnpm --filter @storige/api build` 가 `BookFinalizationWebhookPayload` 류로 46 에러를 뱉으면 회귀가 아니라 선행 빌드 누락이다. `pnpm --filter @storige/types build` 먼저.

### 3-5. jest 에서 `fs` 를 전면 mock 하면 스위트가 로드 실패한다
typeorm 이 끌어오는 path-scurry 가 `fs.realpath.native` 를 찾다가 `TypeError: Cannot read properties of undefined (reading 'native')` 로 죽는다. `{...jest.requireActual('fs'), createWriteStream: jest.fn()}` 처럼 **부분 mock** 할 것.

### 3-6. 에러 메시지가 바뀌면 원인이 하나 더 있다는 신호
썸네일이 ENOENT → `Command failed: /usr/bin/gs …` 로 바뀐 것이 s3 분기 누락을 드러냈다. **첫 수정 후 같은 상태코드(400)만 보고 "여전히 실패"로 판단했다면 놓쳤을 것이다.** 상태코드가 아니라 에러 본문을 볼 것.

### 3-7. [08-01] 로컬 Node 26 — vitest localStorage 함정 (✅ 코드 해소 92e3cf8 — 이하 경위 기록)
Node 26 이 `localStorage` 를 globalThis **own key**(`--localstorage-file` 미지정 시 undefined 반환
getter)로 노출한다 → vitest 의 populateGlobal 이 "이미 존재하는 키"로 보고 happy-dom/jsdom 주입을
건너뜀 → localStorage 쓰는 editor 테스트 49건이 **로컬에서만** 실패(typecheck 은 별건 — canvas-core
스테일 dist 가 원인, `pnpm --filter @storige/canvas-core build` 로 해소). CI(Node 22)는 무관.
로컬 재현/검증은 `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` 로 Node 22 를 앞세워 실행할 것.

### 3-8. editor typecheck 은 canvas-core/ai 를 dist 로 해석한다
editor tsconfig references 는 tsconfig.node.json 뿐 — workspace 의존은 node_modules 심링크의
**dist d.ts** 소비. dist 부재/스테일 = typecheck 오류(HotkeyLike 45 에러 실증). CI 는 editor 스텝이
`@storige/ai build` + `@storige/canvas-core build` 를 선행한다(ci.yml 주석 참조).

### 3-9. 그 외 (07-29 문서에서 계속 유효)
- editor/admin CLI 수동배포 레시피(§3-1), admin 은 상태코드로 판정하면 오판(catch-all rewrite), `corepack pnpm` 고정, 빌드 로그 grep 에 `-a`
- **api 배포 = nginx 재시작 필수** — `proxy_pass` 리터럴 + `resolver` 없음 → 기동 시 1회 해석 고정. 빠뜨리면 502
- `backup/*` 3개는 구 히스토리(VPS IP) — **push 금지**
- PUBLIC 레포 push 전 `gitleaks detect --log-opts="<base>..HEAD"`

---

## 4. 상태 스냅샷 (2026-07-30 15:00 KST 실측)

| 워크트리 | 브랜치 | HEAD |
|---|---|---|
| **`storige/`** ← 작업 기반 | `master` | **`92e3cf8`** (origin 동기, tracked 0) |
| `storige-e2-w1/` | `feat/e2-distribute-finish` | `e2ccf0f` (머지됨·클린 — 다음 정리 후보) |

*(08-01: `storige-fix-20260713` + tmp 워크트리 5개 제거 — §1-8)*

- 본 세션 커밋 8건: `1037c02`(vercel.json) · `58a5166`(Node 24) · `8175532`(gs) · `6de9232`(s3 분기) · `e8c7da6`(포트 봉합) · `bef3d89`(NestJS 10.4.22) · `9e33039`+`75af024`(worker CI, PR#11)
- 라이브: editor/admin **Node 24 빌드**(맵 404·Sentry 업로드 정상) · API `200`(nginx 경유) · 썸네일 **200 image/png** · Bull 큐 0/0
- 공인 바인딩: **nginx 80/443 뿐** (api·worker·editor·mariadb·redis 전부 `127.0.0.1`)
- 프로덕션 런타임: api/worker **Node v22.23.1** · gs 10.07.1 · qpdf 12.3.2 · Alpine 3.24.1
- 롤백 태그(VPS): `storige-api:pre-gsfix` · `storige-{api,worker}:pre-nest10422` · `storige-api:pre-s8guard` · `storige-api:pre-traps`(08-01)
- 프로덕션 NestJS: **10.4.22** · body-parser **1.20.4** · express 4.22.1 (컨테이너 실측)
- ⚠️ 포트 매핑을 되돌릴 일이 생기면 **api recreate 후 nginx 재시작 필수**(리터럴 `proxy_pass` + resolver 없음)

---

## 5. 정본 문서
- **Node 24**: `NODE24_UPGRADE_AUDIT_2026-07-30.md` (축별 판정·변경지점·오답 3종·별건 10건)
- 소스맵: `docs/SOURCEMAP_EXPOSURE_RUNBOOK.md`
- 직전 세션: `RESUME_PROMPT_2026-07-29.md` (§3 함정 원본·소스맵 차단 경위)
- 파트너 연동: `docs/PLATFORM_INTEGRATION_GUIDE.md`
- 운영 실값: `CLAUDE.local.md`(gitignored)
