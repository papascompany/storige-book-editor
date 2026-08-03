# Node 24 업그레이드 감사 — 최종 정본 (2026-07-30)

> 발단: Vercel 빌드 로그의 *"Node.js 20.x is deprecated. Deployments created on or after **2026-10-01** will fail to build."*
> 방법: 5축 정적 조사(44 에이전트, 발견 38건 → 적대검증 생존 34) **+ 실제 Node 24 빌드·테스트·컨테이너 실증**.
> 실증 환경: Node **v24.18.1**(LTS Krypton) tarball, 격리 worktree, 격리 pnpm store, `node:24-alpine` 이미지 2종. **기존 개발 환경 무변경.**

---

## 1. 결론

| 축 | 판정 | 강제 여부 | 실증 |
|---|---|---|---|
| **editor** (Vercel) | **GO** | **필수 · 2026-10-01** | 빌드 성공 |
| **admin** (Vercel) | **GO** | **필수 · 동일** | 빌드 성공 |
| **CI** (GitHub Actions) | **GO** | 선택 | canvas 소스빌드 실증 완료 |
| **api** (VPS Docker) | **GO** | **불필요** (node:22 EOL 2027-04-30) | 이미지 빌드 + 런타임 검증 |
| **worker** (VPS Docker) | **GO** | **불필요** (동일) | 이미지 빌드 + 부팅 + 외부바이너리 대조 |

**차단 요인 0건.** 정적 조사가 남긴 유일한 미해소 불확실성(canvas)은 **실증으로 해소**됐다.

강제 기한이 걸린 것은 **Vercel 2개 프로젝트뿐**이다. Docker/CI 승격은 같은 배포에 묶을 이유가 없다 — 컨테이너는 **24를 건너뛰고 Node 26 LTS(2026-10-28)를 기다리는 선택지도 합리적**이다.

---

## 2. 실증으로 뒤집힌 것 두 가지

### 2-1. canvas — 조사의 유일한 blocker 후보 → **해소**

조사는 확신도 **낮음**으로 남겼다: canvas 2.11.2의 프리빌트 최고 ABI는 node-v120(Node 20)이라 Node 22/24에서 **항상 소스 빌드**이고, node-canvas가 *"Fix a crash in Node 24, due to external memory API change (#2514)"* 를 **3.1.1에서만** 고쳐 2.x는 영구 미수령이기 때문이다.

**실증 결과 — 컴파일·런타임 모두 정상:**

| 검증 | 결과 |
|---|---|
| Node 24 소스 컴파일 | ✅ `gyp info ok` · `node-pre-gyp info ok` · `canvas.node` 생성 |
| **`canvas-core` 테스트 (Node 24)** | ✅ **510 tests passed** |

역증거가 특히 강하다 — 같은 `node_modules`를 **Node 22로** 돌리자 `LockPlugin` 등 4개 스위트가 `The module ... canvas.node` 로 실패했다. 즉 **그 스위트들이 canvas를 실제로 로드**하며(fabric→jsdom19 경로가 죽어 있지 않다는 뜻), 그 경로가 **Node 24에서는 통과**한다.

> ⚠️ 여기서 나온 실무 규칙: **canvas는 N-API가 아니라 ABI 의존**이라 Node 메이저 전환 시 **재컴파일 필수**.
> - Docker·Vercel·CI = 매번 새로 install → 자동 해결
> - **로컬 개발자 = `rm -rf node_modules && pnpm install` 필요.** 부분 install은 스테일 ABI 바이너리를 남긴다.

### 2-2. "canvas는 설치되지 않는다"는 전제 — **거짓**

`package.json`의 `pnpm.ignoredOptionalDependencies: ["canvas"]`(커밋 `893e4ca`, 2026-04-27)만 보고 차단됐다고 판단하기 쉬우나, **유입 경로가 두 갈래인데 한 갈래만 막혔다.**

- 실물: `node_modules/.pnpm/canvas@2.11.2_encoding@0.1.13/.../canvas.node` (396KB, 2026-06-23 컴파일)
- 경로: **fabric@5.5.2 → jsdom@19 의 optional _peer_ Dependency** — `ignoredOptionalDependencies`는 `optionalDependencies`만 커버하고 optional peer는 커버하지 않는다
- 방증: `.github/workflows/ci.yml:61-69` 가 cairo/pango/pixman을 **의도적으로** 설치 중(2026-07-03 실적발 주석)

---

## 3. 변경 지점

### 3-1. 트랙 A — Vercel (필수)

| 파일 | 변경 |
|---|---|
| `apps/editor/package.json` | 최상위에 `"engines": { "node": "24.x" }` **신규 추가** |
| `apps/admin/package.json` | 동일 |

- **반드시 `"24.x"` 고정.** `">=22"` 같은 개방 범위는 Vercel이 newest-first로 intersect 해 **가용 최신 메이저를 자동 채택**한다(Node 26 추가 시 무단 승격).
- engines는 **빌드 시점 Node 버전을 override** 한다. 커밋이 생기므로 재배포도 자동 트리거된다.

> ### ⚠️ [2026-07-30 실행 후 정정] engines 만으로는 "완결"이 아니다
>
> 당초 이 문서는 *"engines가 Project Settings를 override 하므로 대시보드 조작 없이 코드만으로 완결된다"* 고 적었다. **빌드 override는 실증됐지만 "완결"은 틀렸다.**
>
> **실증된 것** — 양쪽 프로덕션 빌드 로그가 명시:
> ```
> Skipping build cache since Node.js version changed from "20.x" to "24.x"
> Warning: Due to "engines": { "node": "24.x" } in your package.json file,
>          the Node.js Version defined in your Project Settings ("20.x") will not apply,
>          Node.js Version "24.x" will be used instead.
> ```
>
> **그런데 남은 것** — 배포 성공 후에도:
> - `vercel project inspect storige-editor` → `Node.js Version  20.x` (**Settings 값 불변**)
> - `vercel project ls --update-required` → **editor·admin 이 여전히 목록에 있음**
>
> 즉 engines 는 **빌드를 덮지만 Project Settings 자체를 바꾸지 않는다.** Vercel 은 이 프로젝트를 계속 폐기 대상으로 집계한다.
>
> **잔여 오너 액션(대시보드 전용 — CLI 에 설정 변경 명령 없음, `vercel project` 는 조회만 지원):**
> `storige-editor` · `storige-admin` → Settings → Build and Deployment → **Node.js Version → 24.x**
>
> 2026-10-01 에 Vercel 이 20.x 를 Settings 목록에서 제거할 때, engines override 가 있으니 빌드는 살아남을 개연성이 높다. 그러나 **Settings 가 폐기된 값으로 남은 상태의 거동은 실측 불가**하다(그 날짜 전에는 재현할 수 없다). 비용 0·리스크 0 이므로 **engines 와 Settings 를 모두 24.x 로 맞춰 이중화하는 것이 옳다.**

#### 해서는 안 되는 오답 3종 (조사에서 반증됨)

| 오답 | 왜 틀렸나 |
|---|---|
| `apps/*/.vercel/project.json` 의 `nodeVersion` 수정 | `.gitignore` 된 **로컬 CLI 캐시**. 배포에 반영되지 않고 다음 `vercel pull`에 덮어써짐 |
| 루트 `package.json` engines 수정 | Vercel은 rootDirectory(`apps/editor`)에서 **처음 만난 package.json 하나만** 읽고 멈춤 → 루트는 참조조차 안 됨. 게다가 ignoreCommand 감시 경로에 없어 **빌드가 트리거되지도 않음** |
| `pnpm.neverBuiltDependencies: ["canvas"]` 추가 | 빌드 스크립트만 건너뛰고 JS 패키지는 남김 → `jsdom` 의 `require.resolve("canvas")`는 성공하고 뒤이은 `require`가 크래시. **2026-07-03 CI를 무너뜨린 그 반쪽 상태를 의도적으로 제조** |

### 3-2. 트랙 B — CI (선택, 권장 선행)

`.github/workflows/ci.yml:48` `node-version: 22` → `24` (이행기 `matrix: [22, 24]` 권장).

⚠️ **`ci.yml:61-69` 의 cairo/pango/pixman 블록은 건드리지 말 것** — 잔재가 아니라 canvas 소스빌드의 **실동 게이트**다.

### 3-3. 트랙 C — Docker (선택, 6줄)

`docker/{api,worker}/Dockerfile` 각 2줄(builder + production), `docker/{editor,admin}/Dockerfile` 각 1줄.

---

## 4. 실증 결과 전량

### 4-1. 빌드·테스트 (Node v24.18.1)

| 항목 | 결과 |
|---|---|
| `pnpm install` (macOS arm64) | ✅ 1m12s |
| `pnpm build` | ✅ **9/9 successful** |
| `canvas-core` test | ✅ 510 passed |
| `indesign-import` test | ✅ (fixture 보충 후) |
| `ghostscript-wk.spec` 단독 | ✅ 17/17 (Node 22와 동일) |
| corepack | ✅ 0.35.0 번들 유지 (기본 제거는 **Node 25부터**) |

### 4-2. 컨테이너

| 항목 | 결과 |
|---|---|
| API 이미지 빌드 | ✅ 159s / 1.96GB |
| API 런타임 | ✅ sharp·bcrypt·mysql2 로드 + **실연산**(bcrypt hash/compare, sharp PNG) |
| Worker 이미지 빌드 | ✅ 68s / 2.12GB |
| Worker 런타임 | ✅ sharp·pdf-lib·mysql2·bull + sharp JPEG 생성 |
| **Worker NestJS 부팅** | ✅ `NODE_ENV=production` 에서 정상 진행 |

**네이티브 3종(sharp·bcrypt·better-sqlite3)은 N-API prebuilt** — 재컴파일도 alpine 빌드 도구 추가도 불필요했다.

### 4-3. 외부 바이너리 드리프트 — 프로덕션 실측 대조 (**조사가 최대 리스크로 지목한 항목**)

| | 프로덕션 (Node 22) | Node 24 재빌드 | 판정 |
|---|---|---|---|
| Ghostscript | 10.07.1 | **10.07.1** | ✅ 동일 |
| qpdf | 12.3.2 | **12.3.2** | ✅ 동일 |
| Alpine | 3.24.1 | **3.24.1** | ✅ 동일 |
| ImageMagick | 7.1.2-24 | 7.1.2-27(Beta) | ⚠️ 드리프트하나 **코드 미사용**(소스 참조 0건) |
| Node | v22.23.1 | v24.18.0 | — |

**PDF 파이프라인의 두 핵심 도구가 비트 동일**하다. apk 미핀으로 인한 드리프트 우려는 실측으로 해소됐다(단 이 동일성은 오늘 시점 값이므로, 실제 승격 시 재확인).

### 4-4. 테스트 실패 4건 — 전부 Node 24 무관

| 현상 | 진짜 원인 | 근거 |
|---|---|---|
| `indesign-import` ENOENT | `*.idml` gitignore로 fixture 부재 | Node 22도 동일 실패, fixture 채우니 통과 |
| `ghostscript-wk.spec` 타임아웃 | 전체 병렬 실행 시 5초 타임아웃 **플레이크** | 단독 실행 시 Node 22·24 모두 17/17 |
| `canvas-core` 4 스위트 | canvas ABI 불일치 (**검증 아티팩트**) | Node 24로 빌드한 `.node`를 Node 22로 로드 |
| worker 부팅 `pino-pretty` | `NODE_ENV` 미설정 | `app.module.ts:38-44` 가 production이면 transport `undefined` |

---

## 5. 권장 순서

```
① CI(24) → ② Vercel(editor·admin) → ③[선택] Docker worker → ④[선택] Docker api → ⑤ 문서·root engines
```

| 단계 | 검증 게이트 |
|---|---|
| ① CI | canvas 소스빌드 + `canvas-core`/api/examples/golden green |
| ② Vercel | **빌드 로그에서 실제 Node 버전 확인**(대시보드 값 신뢰 금지) + `/embed` CSP `frame-ancestors` 1회 + 편집기 로드 스모크 |
| ③ worker | **사전 이미지 태깅** → `gs`/`qpdf` 버전 재대조 → **PDF 골든 파리티 `scripts/pdf-golden/compare.mjs`**(jest로는 절대 안 잡힘) → 큐 idle 시 교체 |
| ④ api | 사전 태깅 → `require('bcrypt');require('sharp')` → **`up -d api && restart nginx` 한 호흡** → `/health` + 웹훅 1건 |
| ⑤ 마감 | root engines, `@types/node`, 문서 일괄 |

- **root engines(`>=22`)는 맨 마지막.** 승격을 이끄는 스위치가 아니라 완료를 봉인하는 자물쇠다.
- **api 승격 = nginx 재시작 필수.** `proxy_pass` 리터럴 + `resolver` 없음 → 기동 시 1회 해석 고정. 실장애 2회 기록.

### 배포 후 육안 확인 1건 (단위 테스트 미커버)

**Node 24의 유일한 실질 동작 변경 = AsyncLocalStorage 기본 구현이 AsyncContextFrame 으로 전환.** `nestjs-pino` 와 `@sentry/node` 가 ALS 경로를 쓴다 → 요청 로그의 `req.id` 그룹핑과 Sentry 이벤트 도달을 각 1회 확인. 이상 시 `--no-async-context-frame` 폴백 존재.

---

## 6. 롤백

| 축 | 수단 | 소요 |
|---|---|---|
| Vercel | Instant Rollback 또는 커밋 revert | 초 |
| CI | 1줄 되돌리기 | 즉시 |
| Docker | **사전 태깅** 후 `up -d --no-build <svc>` (+api는 nginx 재시작) | 분 |

```bash
docker tag $(docker inspect -f '{{.Image}}' storige-api)    storige-api:pre-node24
docker tag $(docker inspect -f '{{.Image}}' storige-worker) storige-worker:pre-node24
```

⚠️ **"FROM 되돌려 재빌드"는 복원이 아니다.** `node:22-alpine` 부동 태그 + `--frozen-lockfile` 부재라 비트 동일 산출물을 보장하지 않는다. 승격 관찰 기간 중 **`docker system prune -a` 금지**(디스크 처방으로 문서 3곳에 실려 있어 무심코 실행될 여지).

---

## 7. Node 릴리스 사실관계

| 버전 | 상태 (2026-07-30) | EOL |
|---|---|---|
| v20 Iron | **EOL 경과** | 2026-04-30 |
| v22 Jod | Maintenance LTS | 2027-04-30 |
| **v24 Krypton** | **Active LTS** | 2028-04-30 |
| v26 | Current (LTS 2026-10-28 예정) | — |

Vercel 가용 목록이 `24.x/22.x/20.x` 뿐이라 **24.x가 유일한 정답**이다.

---

## 8. Node 24와 무관한 별건 (이번 승격에 섞지 말 것)

> **[2026-07-30~31 갱신] ①②③⑥ 해소 완료.** 취소선 4건은 수정·배포·검증됐다(커밋 `8175532`·`6de9232`·`e8c7da6`·`bef3d89`). **잔존은 ④⑤⑦⑧⑨⑩ 6건.**

| # | 항목 | 심각도 | 비고 |
|---|---|---|---|
| ~~①~~ | ~~api 컨테이너에 Ghostscript 부재 → PDF 썸네일 상시 실패~~ | ✅ **해소** | Dockerfile `apk add ghostscript` + compose `GHOSTSCRIPT_PATH`(`8175532`). **⚠️ 진단이 두 겹이었다** — gs 를 넣어도 계속 실패했고, 진짜 나머지 원인은 **`generateThumbnail` 만 s3 분기 누락**(프로덕션 files 166건 중 110건이 `s3://`)이었다. `getStream`→임시 `.tmp.pdf` 로 보완(`6de9232`). 프로덕션 실호출 **200 image/png** 검증 |
| ~~②~~ | ~~썸네일 임시 파일명 width 누락 → 동시요청 경합~~ | ✅ **해소** | width 만으로는 동일 `(page,width)` 동시요청이 여전히 경합 → **uuid 로 완전 분리**. 회귀 가드 5건 신설(`files.service.thumbnail-gs.spec.ts`) |
| ~~③~~ | ~~VPS `:3000` 공인망 노출~~ | ✅ **해소** | `127.0.0.1:3000:80`(`e8c7da6`). **조사 중 `:4000`(api)·`:4001`(worker) 도 같은 상태로 발견돼 함께 봉합** — ufw 가 22/80/443 만 허용하는데 셋 다 외부 응답(Docker 매핑의 ufw 우회 실증). `:3000` 은 24h 요청 100건이 전량 스캐너였고 정당 사용자 0. 공인 바인딩은 이제 nginx 80/443 뿐 |
| ④ | 같은 VPS에 **Node 20.20.2(EOL) 컨테이너 상시 구동** | 중간 | `md2books-worker:20260707`, 별도 스택. storige compose 밖이라 감사 범위 누락 |
| ⑤ | CI 커버리지 공백 | 중간→**부분 해소** | ~~worker~~ **worker 는 2026-07-31 CI 연결 완료**(`9e33039`+`75af024`, PR#11 green — 17 suites/490 tests, CI 실측 18s). 연결 첫 런이 **dash fork 함정을 즉시 적발**(WK-3 스펙: `sh -c 'sleep 5'` 에서 dash 가 sleep 을 fork → SIGTERM 이 sh 만 죽여 close 5s 지연 → `exec` 부착으로 수정, 컨테이너 실증 5020ms→309ms). **잔존: editor·admin·indesign-import CI 미연결** |
| ~~⑥~~ | ~~NestJS 10.4.20 = legacy, 10.4.22 대비 2패치 뒤짐~~ | ✅ **해소** | 10.4.22 로 승격(`bef3d89`). **10.4.22 는 실제 보안 릴리스** — body-parser 1.20.4 로 CVE-2025-15284 대응(우리는 1.20.3 을 프로덕션 런타임 경로로 물고 있었음). 반면 우려했던 RCE 백포트는 빗나감: CVE-2024-29409 는 10.4.16 에서 기수정, multer CVE 는 overrides 로 기대응, nest#16694 HIGH 5건은 설치 시점 전이 의존성(tar·lodash). 컨테이너 실측 `@nestjs/core 10.4.22`·`body-parser@1.20.4` 단독. 롤백 태그 `pre-nest10422` |
| ⑦ | 경로 접두사 검사 결함 | 낮음 | `worker-jobs.controller.ts:420` `startsWith(base)` → `/app/storage-anything` 통과 |
| ⑧ | `.dockerignore` 부재 (레포 전체 0건) | 낮음 | `COPY packages` 가 로컬 node_modules를 이미지로 반입 |
| ⑨ | Dockerfile `pnpm install` 에 `--frozen-lockfile` 없음 (6곳) | 낮음 | 이미지 빌드가 락파일과 다른 해를 조용히 잡을 수 있음 |
| ⑩ | 문서 드리프트 | 낮음 | `docs/FUTURE_UPDATES.md:29` 는 **거짓 기록**("root engines로 자동 Node 22 빌드"). `docs/01_SYSTEM_ARCHITECTURE_KR.md:545`·`PDF_VALIDATION_GUIDE.md:513`·`DEPLOYMENT_COMPLETE.md:60,261` 에 node:20 잔여. `CLAUDE.local.md` §6.2 전체 재배포 레시피에 nginx 재시작 누락 |

---

## 9. 확정된 "문제 없음" 목록

| 항목 | 근거 |
|---|---|
| **HMAC 웹훅 서명** (파트너 연동) | Node 22·24가 **동일한 OpenSSL 3.5.7 번들** → 암호 스택 델타 0. 서명 호환성 파괴 경로 0 |
| Intl / ICU | api/worker 소스에 `Intl.*`/`toLocale*`/`localeCompare` **0건**. ICU 78.3 동일 |
| V8 힙 / 최대 문자열 | 워커 힙은 compose가 `--max-old-space-size=3072` 명시 고정. 최대 문자열 동일 → **2GB 파이프라인 임계 불변** |
| GS/qpdf 외부 프로세스 | `spawn(GS_PATH, args)` — 셸 미사용, 레포 전체 `shell: true` **0건** → DEP0190 비해당 |
| Bull / Redis 큐 | bull 4.16.5 → ioredis·msgpackr 전부 순수 JS |
| `require(esm)` | **Node 22.12에서 이미 unflag** → 22→24 델타 아님 |
| 제거·폐기 API | `url.parse`·`new Buffer`·`createCipher`·`util.is*` 등 전수 grep **0건** |
| Vite/Vitest/esbuild/rollup/tsc/eslint/turbo/pnpm 9.15.0 | 선언적 차단 0건. esbuild=Go, rollup 네이티브=N-API, @sentry/cli=Rust → Node ABI 무관 |
| `apps/editor/middleware.ts` | `runtime` 미지정 → **Edge**(V8 isolate) → nodeVersion 지배 밖 |
| `pnpm-lock.yaml` | Node 버전 비종속. engines 986건 전수 판정 결과 **Node 24 배제 0건** → 재생성 불필요 |

---

## 부록. 검증 자원 (정리 대상)

| 자원 | 위치 |
|---|---|
| worktree ×2 | scratchpad `node24-verify`, `node24-docker` (`git worktree remove` 필요) |
| Docker 이미지 ×2 | `storige-api:node24test`(1.96GB), `storige-worker:node24test`(2.12GB) |
| Node 24 tarball + 격리 pnpm store | scratchpad |

**레포 워킹트리는 무변경**이다(Dockerfile `FROM` 치환은 격리 worktree에서만 수행).
