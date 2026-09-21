# RESUME PROMPT — 2026-09-12

> **이 문서가 최신 날짜 정본이다.** 9/11 상세 이력(§7 세션 로그 3종·§8 R-172·§8-1 D6 블로커 규명)은
> `RESUME_PROMPT_2026-09-11.md`, 그 이전은 `RESUME_PROMPT_2026-08-28.md`·`_2026-08-25.md`(아카이브).
> 2026-09-12 작성 · **2026-09-14 갱신**(§1 사후 실측 · §5 printy 파일 파기 계약 트랙 · §6 bookmoa D6-ⓐ 통지 · §3 채널 확증법) · **2026-09-15 갱신**(§7 gitleaks CI 설치 단계 강화 · §7-1 별도 세션 교차 검증·VPS 컨테이너 실측).

## 0. 현재 라이브 상태

- **D6-ⓐ 커밋·푸시·API 배포 전부 완료(§1).** master = origin/master.
  VPS `~/storige` 는 **2026-09-15 `git pull --ff-only` 로 §7 기록 커밋까지 동기화**(체크아웃만 — 컨테이너 무변경, api·nginx 가동 시간 불변 · health 200).
  이후 문서 커밋은 런타임 무영향이라 미동기화(다음 API 배포 때 자연 동기화)
  ✅ 2026-09-15 05:47 UTC **별도 세션이 교차 확인**: VPS 작업트리 클린 · 컨테이너 기동 시각 09-12 그대로 · 실행 이미지 = 최신 빌드 이미지 · D6-ⓐ 지문 유지(§7-1)
  - ⚠️ **해시를 이 문서에 박지 않는다.** 자기참조 스테일이 4회 발생한 함정이다(09-11 정본 §0 주석). 정확한 HEAD 는 `git log --oneline -5`
  - 🔧 **문서 정정**: 09-11 정본은 VPS 가 `94edb89` 라고 적었으나 **실제로는 `4463a5f`(2커밋 뒤)** 였다.
    그 2커밋이 문서뿐이어서 배포 영향은 0이었지만, **"VPS 는 X 유지" 표기를 신뢰하지 말고 `git log --oneline -1` 로 실측해라**
  - 워킹트리: 타 세션 untracked 11건(`.tmp-verify-combos/`·`docs/SHOPIFY_*`·`docs/SITE_CATALOG_*`·`docs/PLATFORM_INTEGRATION_GUIDE.backup-*`) — **무접촉, `git add` 항상 명시 목록**
- 배포: editor/admin=Vercel master push 자동 / **API·워커=VPS 수동**(`CLAUDE.local.md` §6)
  - 🔑 **이번 변경은 `apps/api` 다 → 푸시만으로는 프로덕션에 안 간다.** VPS 재배포가 별도 단계이고, 그게 곧 D6-ⓐ 발효 시점이다

### 런타임 (2026-09-11 저녁 통일, 09-12 재확인)

```bash
PATH="/opt/homebrew/opt/node@24/bin:$PATH"   # node -v → v24.20.0. engine 경고 0건
```

- ✅ 09-12 실측 재확인: `node@24`=24.20.0 · 기본 `node`=26.5.1 · `core.hooksPath`=`.githooks` · **canvas ABI 137 로드 성공**
- ⚠️ **`canvas.node` 는 단일 ABI**(137=Node24). 기본 node 26 은 147 을 요구해 실패한다 — 이게 정상이다
- ⚠️ `pnpm install` 이 canvas 를 재설치하면 ABI 가 되돌아간다. 프리플라이트가 하드 실패로 알려주면 재빌드:
  ```bash
  cd node_modules/.pnpm/canvas@2.11.2_encoding@0.1.13/node_modules/canvas
  PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx -y node-gyp@10 rebuild
  ```
  🚨 **`pnpm rebuild canvas` 는 no-op 이다**(canvas 가 루트 직접 의존이 아님 — 출력 0줄로 조용히 끝난다)

### 검증 기준선 (이보다 낮으면 회귀)

| 대상 | 기준 | 최종 실측 |
|---|---|---|
| api jest | **79스위트/1098 PASS** · contract-freeze **73** · lint 0err(44 warn) · `tsc -p tsconfig.eslint.json` EXIT=0 | ✅ 2026-09-12 (종전 78/1071 + D6-ⓐ 27종) |
| editor vitest | 66파일/785 PASS · tsc 0err · eslint 0err(78 warn) | 2026-09-11 |
| canvas-core | 55파일/628 PASS · lint 0err(48 warn) | 2026-09-11 (Node 24) |
| 플레이크 | 등재 0종 | — |

> ⚠️ **기준선이 78/1071 → 79/1098 로 올라갔다.** 내역: 가드 스펙 신규 12 + 스탬프 스펙 §5 12 + 컨트롤러 배선 3 = **+27**, 신규 스위트 1.

### 상시 함정 (매 세션 상기)

- **nginx 는 `nginx.conf` 를 파일 bind-mount** → `git pull` 이 inode 를 갈아 `up -d`·`restart`·`reload` 전부 무효.
  `docker compose up -d --force-recreate nginx` 만 유효하고, `nginx -T` 로 **로드된** 설정을 확인해야 한다(`-t` 는 디스크를 읽는다)
- **`ignoreCommand` 는 fail-open** — 스킵이 ~10커밋 쌓이면 `VERCEL_GIT_PREVIOUS_SHA` 가 shallow clone(depth 10) 밖으로 나가 감시 경로와 무관하게 전체 빌드된다.
  배포 영향은 **예측하지 말고** `vercel list <project>` 의 Status/Duration 으로 실측(3~4초 Canceled=스킵, 20초+ Ready=실빌드)
- **`engines.node: "24.x"` 를 경고 때문에 넓히지 마라** — Vercel 은 범위를 newest-first intersect 해 **가용 최신 메이저를 자동 채택**한다. 개방하면 26.x 무단 승격. 근거 `NODE24_UPGRADE_AUDIT_2026-07-30.md:63`
- **`node@N` 경로 이름은 버전을 보장하지 않는다**(미설치 버전의 opt 링크는 `node` 포뮬러의 낡은 별칭). 고정 전 `node -v` 실값 확인
- **gitleaks 자가검증에 allowlist 어휘를 쓰지 마라**(`example`·`placeholder`·`dummy`·`sample`·`test-key`…) — 면제돼서 "차단 실패" 로 오판한다
- **gitleaks `VER` 를 올리면 같은 스텝의 `SHA256` 도 갱신하라** — 설치 단계가 해시를 고정한다(§7). 값은 릴리스 `gitleaks_<VER>_checksums.txt` 의 `linux_x64` 행.
  gitleaks 잡이 red 여도 **Scan 스텝이 skip 이면 시크릿 검출이 아니다**(설치 실패) — 스텝별 결론부터 확인
- **사용자에게 주는 실행 블록(` ```bash `)에 자리표시자(`<host>` 등)를 넣지 마라** — 앱의 Run 버튼으로 그대로 실행되고, zsh 가 `<host>` 를 **입력 리다이렉션**으로 읽어 `no such file or directory: host` 로 실패한다(2026-09-14 실사고, 서버 무실행).
  프로덕션 조회는 에이전트가 직접 실행하고, 사용자용이면 실값 위치(`CLAUDE.local.md` §1.1)를 문장으로 안내한다
- **프로덕션 DB 의 `created_at` 은 UTC 다**(`@@session.time_zone=SYSTEM`, 컨테이너 UTC). KST 시각을 필터에 넣으면 9시간 어긋난다
  (2026-09-14 실수 — 필터 없는 대조군으로 결론은 유지). 배포 시각은 컨테이너 로그의 `+09:00` 을 UTC 로 환산해 쓴다. **D6-ⓐ 배포 = 2026-09-12 04:31 UTC**
- **api 로그(pino JSON)를 정규식으로 자를 때는 대조군을 같이 세라** — `"url"…[^}]*…"statusCode"` 는 `req}` 에서 끊겨 **전부 빈 결과**가 된다.
  이미 아는 요청(예: 프로브)이 결과에 없으면 "호출 0건"이 아니라 파싱 실패다(2026-09-14 실사례)
- **zsh 에서 `GID`·`UID`·`EUID`·`EGID` 를 변수명으로 쓰지 마라** — 특수 파라미터라 `GID=$(…)` 대입이 setgid 시도로 번져
  `failed to change group ID: operation not permitted` 로 **명령 전체가 실행 전에 실패**한다. 샌드박스 문제로 오인하기 쉽다(2026-09-14 실사례 — 샌드박스를 꺼도 같은 오류). `RUN_ID` 등을 쓴다
- **`gh run rerun` 직후의 `gh run watch` 결과를 바로 믿지 마라** — 재실행이 등록되기 전이면 **이전 시도의 완료 결과**를 읽고 즉시 반환한다.
  결론 전에 `gh run view <id> --json attempt,updatedAt` 로 시도 번호·시각을 확인한다(2026-09-14 실사례)
- 기타: vite.config.js shadow / 빌드게이트 5함정 / fabric styles·loadJSON / SPREAD≠표지 / isInitializedRef 저장 입구 금지 / **debounce 는 배칭 도구 아님** / **supertest 포트 패밀리**(불가능한 응답=남의 서버 의심) / 크로스세션 권한모드

---

## 1. ✅ D6-ⓐ 구현·배포 완료 (2026-09-12)

오너가 §8-1 선택지 중 **ⓐ안**을 확정해 구현했다. **D6 하드 블로커가 코드 레벨에서 해소됐다**(배포·실증은 잔여).

### 문제 (09-11 정본 §8-1 요약)

2026-08-13 테넌트 스탬프 위조 차단이 `body.siteId` 무검증 채택을 막으면서, **`X-API-Key` 호출자가 자기 잡에
siteId 를 붙일 수단이 남지 않았다.** bookmoa 실제 호출 형태(키 + `body.siteId` 미전송)는 **전건 NULL 스탬프**이고,
D6 NULL-파괴 게이트를 켜면 방금 고친 산출물 다운로드가 **404** 로 죽는다. write 위조는 막았지만 **정당한 귀속 수단을
만들지 않은 것**이 공백의 정체였다.

### 변경 파일 (6 + 테스트 3)

| 파일 | 내용 |
|---|---|
| `apps/api/src/auth/guards/optional-api-key-site.guard.ts` | **신규** `OptionalApiKeySiteGuard` — `x-api-key` 를 DB 조회해 `req.apiKeySite` 에만 싣는다. **절대 throw 안 함** |
| `apps/api/src/auth/decorators/api-key-site.decorator.ts` | **신규** `@ApiKeySite()` |
| `apps/api/src/auth/auth.module.ts` | 가드 providers+exports 등재(`SitesModule` 이 여기 이미 있어 `ApiKeyGuard` 와 동일 해석 경로) |
| `apps/api/src/worker-jobs/worker-jobs.controller.ts` | `@UseGuards(OptionalShopJwtGuard, OptionalApiKeySiteGuard)` + 3번째 인자 전달 |
| `apps/api/src/worker-jobs/worker-jobs.service.ts` | `resolveComposeMixedSiteId` 재구성(①~④) + 세션 소유 테넌트 재사용 + `siteIdHint` 추출 |
| `docs/CONTRACT_FREEZE.md` | **v1.4** — FROZEN 1행 개정 + §1-C-2 신설 + §4.3·§2 표 스테일 정정 |

### 채택 규칙 (`resolveComposeMixedSiteId`, 위→아래)

```
① assembled            → session.siteId      (세션 권위. 키로 덮어쓰지 않는다)
② caller.siteId == body.siteId → 채택         (검증된 shop-session JWT)
③ 검증된 사이트 키      → 채택, 단 아래면 NULL:
     ⓐ body.siteId 가 키와 불일치        (타 테넌트 주장)
     ⓑ editSessionId 세션이 타 테넌트 소유 (교차 테넌트 링크)
     ⓒ shop JWT 가 다른 테넌트          (권위 상충)
④ 그 외                → NULL            (종전과 바이트 동일)
```

### 🚨 이 트랙이 남기는 함정 (다음 작업자가 깨기 쉬운 순서)

1. **`caller`(JWT) 와 `apiKeySite`(키) 를 한 객체로 합치지 마라** — 합치면 컨트롤러 `caller` 가 키로 조립되고,
   **자동조립 인가 게이트**(`assembleComposeInputFromSession` 의 `caller.siteId` 일치 검사)가 API 키로 통과된다.
   API 키에는 `allowedOrderSeqnos` 주문 스코프가 **없어** 호환 모드(검사 생략)로 떨어진다 →
   같은 테넌트의 **타 고객 세션**을 합본으로 뽑는 **권한 상승**. 분리 자체가 보안 장치다(FROZEN, §1-C-2)
2. **`OptionalApiKeySiteGuard` 에 throw 를 넣지 마라** — 401 을 던지는 순간 `auth:'public'` 동결이 의미상 깨지고
   무인증 게스트(bookmoa-mobile·Sharesnap 의존)가 파손된다. `ApiKeyGuard` 로 교체하는 것도 같은 파손
3. **③-ⓑ 의 세션 조회는 수동 경로가 이미 하는 조회의 재사용이다.** 그 대입이 `repository.create` 보다 **먼저**
   일어나야 검사가 작동한다 — 조회 블록을 뒤로 옮기거나 앞에 조기 return 을 끼우면 교차 테넌트 검사가
   **조용히** 무력화된다. (09-11 FontPlugin A-1 과 **같은 계열의 함정** — 순서가 곧 계약)
4. **③-ⓑ 는 양성 판정 한정이다.** 세션 부재·조회 실패·`siteId IS NULL`(레거시 무소유)은 **채택**한다.
   여기서 거부하면 정상 파트너가 다시 깨진다 — 회귀 테스트 3종이 이 셋을 고정한다
5. **`status:'active'` 필터를 풀지 마라** — `findBy*AuthCode` 의 이 조건이 곧 **폐기 키 차단**이다
   (유출 키 폐기 수단이 `status=inactive`, 2026-06-15 회전 이력). 풀면 폐기된 유출 키가 스탬프 권위를 되찾는다
6. **내부 `WORKER_API_KEY` 는 테넌트 신원이 아니다** — 제외하지 않으면 Default Site 의 editor==worker 코드로
   매칭돼 파트너 잡이 Default Site 소유로 스탬프된다

### 동결 계약 저촉 없음 (실측)

`contract-freeze.spec.ts:136` 의 단정은 **`guards.includes(ApiKeyGuard) === false`** 뿐이다 — 동결된 의미는
"X-API-Key 가 **필수가 아니다**" 이고 "키를 쳐다보지 않는다" 가 아니다. 별도 클래스 + throw 없음이므로
**73종 무변경 통과**(실측). 400/401 신설 0건, 응답 shape 불변.

> 🚨 **그래도 `CONTRACT_FREEZE.md:80` 의 FROZEN 1행은 개정이 필요했다** — "스탬프 근거는 **서명 검증된 JWT 뿐**"
> 이라는 문구를 글자 그대로 지키면 ⓐ가 불가능하다. v1.4 에서 **DB 에서 검증된 활성 사이트 자격증명**을 근거에
> 추가했고, **호출자가 주장한 siteId 채택 금지**는 그대로 뒀다. 09-11 정본 §8-1 이 ⓐ를 "ADDITIVE" 로만 적고
> **FROZEN 개정 필요를 누락**했던 점을 여기 명시한다.

### 검증 증거 (각 1회 · Node 24 고정)

| 검증 | 결과 |
|---|---|
| api jest 전체 | **79스위트/1098 PASS** — 기준선 78/1071 + 27종, 수집 증발 0 |
| `contract-freeze.spec` | **73 PASS** — 기준선 동일(동결 표면 무변경 실증) |
| `tsc --noEmit -p tsconfig.json` | EXIT=0 |
| `tsc --noEmit -p tsconfig.eslint.json` | EXIT=0 — 불변식 유지 |
| `eslint .` (apps/api) | **0 err / 44 warn** — 기준선 동일 |
| 프로덕션 접근 | **0건**(읽기조차 없음). 로컬 유닛 테스트만 |

### 배포 실증 (2026-09-12, 프로덕션)

절차: `git pull` → `docker compose up -d --build api` → **`docker compose restart nginx`**(api recreate 시 리터럴
`proxy_pass` IP 고정 때문에 필수). `nginx.conf` 무변경이라 force-recreate 는 불요했다.

| 검증 | 결과 |
|---|---|
| 외부 스모크 | api `/api/health` **200** · editor **200** · admin **200** |
| 배포본 지문 | `worker-jobs.service.js` 에 신규 문자열 2종 **각 1건** + **[대조군] 기존 문자열 1건** → 변경분이 실제로 실림 |
| 컴파일 산출물 | `dist/auth/guards/optional-api-key-site.guard.js` · `dist/auth/decorators/api-key-site.decorator.js` 존재 · 컨트롤러 배선 1건 |
| 부팅 | `AppModule dependencies initialized` 정상 · 에러·예외 **0건** · `Mapped {/api/worker-jobs/compose-mixed, POST}` |
| nginx 5xx | **0건** |
| **🔑 라이브 프로브 A** (키 없음 + 빈 본문) | **400 EMPTY_COMPOSE_INPUT** — 500 이 아니므로 **route-scoped 가드가 요청 시점에 DI 해석됨** |
| **🔑 라이브 프로브 B** (무효 키 + 빈 본문) | **400** — 401 이 아니므로 **불변식 1(절대 throw 안 함) 라이브 실증**. DB 조회 2회를 거쳐 throw 없이 통과(9ms) |
| 프로브 부작용 | **잡 0건 생성**(빈 입력 400 게이트가 `repository.create` 보다 앞) — `worker_jobs` 15분 내 0건으로 확인 |

> ✅ **종전 "미검증 잔여 #2(가드 DI 는 정적 단정까지만)" 는 프로브 A·B 로 닫혔다.** 선례 담보가 아니라 실측이다.

### 🔴 남은 미검증 1건 — D6 게이트를 켜기 전 필수

**실 파트너 호출로 스탬프가 붙는 것은 아직 실증되지 않았다.** compose-mixed 프로덕션 호출 이력이 0건이고
(`worker_jobs` SYNTHESIZE 총 12건·최종 **2026-06-13** — 3개월 공백 그대로) 결속된 실 jobId 가 없어 e2e 대상이 없다.
프로브는 **무효 키 경로**만 증명한다 — 유효 키가 실제로 `job.siteId` 를 채우는지는 첫 실합성에서 확인해야 한다.

```sql
-- 첫 실합성 후: 스탬프가 붙었는지 (NULL 이면 ⓐ가 듣지 않은 것)
SELECT id, site_id, created_at FROM worker_jobs
 WHERE job_type='SYNTHESIZE' AND created_at > '2026-09-12 04:31:00' ORDER BY created_at DESC LIMIT 5;  -- UTC
```

🚨 **이 확인 없이 D6 게이트를 켜면 ⓐ를 한 효과가 없고 09-11 정본 §8-1 의 404 가 그대로 재현된다.**

> **2026-09-14 재조회 — 판정 대상 0건(미검증 유지).** 배포 이후 `worker_jobs` **전 타입 0건** · 편집 세션 0건 ·
> 실 compose-mixed 호출 0건(로그 2건은 배포 직후 당사 프로브 400).
> 대조군: 배포 이후 API request **190건**(로그 정상) · 필터 없는 타입별 최신 잡 = VALIDATE **2026-09-09**(누적 222, 09-11 실측과 동일)
> → 필터·타임존 오류가 아니라 **실제 무트래픽**. 공백은 배포(09-12) 이전부터라 배포 영향 아님.
> printy 도 같은 호출 조건으로 적용 확정(§5-1) — 첫 실합성은 bookmoa·printy 어느 쪽이든 위 쿼리로 판정한다.
>
> **2026-09-14 14:19 UTC 2차 재조회 — 여전히 대상 0건.** 그사이 bookmoa-mobile 에서 편집 흐름이 1회 돌았지만 **내부 관리자 계정 테스트**였고
> compose-mixed 호출은 없었다(로그 대조군 = 09-12 프로브 2건 정상 검출). 상세는 §6-3.

> 참고: bookmoa 가 editor 키인지 worker 키인지는 당사에서 알 수 없어 **둘 다 수용**하도록 만들었다(불확실성 제거).

### (범위 밖 관찰) 프로덕션 이미지에 `.spec.js` 가 실린다

`dist/auth/` 에 spec 컴파일 산출물 9개가 있다(제 것 1 + **선재 8**). 런타임 동작에는 무해하지만 이미지 크기와
공격 표면 관점에서 바람직하지 않다. **이번 변경이 만든 것이 아니라 기존 빌드 설정 특성**이다 — 별도 트랙.

---

## 2. 잔여 작업

**P0 — 오너 액션**
1. ~~D6-ⓐ 커밋·푸시·VPS 배포~~ **✅ 2026-09-12 완료**(§1 배포 실증)
2. ~~bookmoa D6-ⓐ 통지~~ **✅ 2026-09-14 발신 · ACK · 확인 ①② 완료**(§6) — 첫 실합성 jobId 회신만 대기
3. 파트너 회신문 **미발송 5건**: ⓐ 8/24 통지 4종 + ⓑ 프린티 템플릿셋 스코프
4. 동화책 왕복 실기 1회로 묶음 해소: 재진입 유지 확인 + `window.__storigeLoadProfile.laps` 의 `grow:*` 캡처(읽기 전용) + bookmoa 장바구니 #1 테스트 항목 삭제

**P1 — 코드**
- **즉시 착수 가능한 P1 잔여 0건**(09-11 의 P1-4~8·P2-10 전부 종결, D6-ⓐ 금일 종결)
- (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭
- (관찰) `render-pages` 게스트는 여전히 NULL 스탬프 — ⓐ와 같은 공백이 남아 있다. D6 대상이면 동형 처리 필요(§1-C-2 범위 밖)
- (관찰) **세션 완료가 만드는 VALIDATE 잡이 `site_id` NULL · `edit_session_id` NULL** 이다 — 세션에는 활성 사이트가 스탬프돼 있는데 잡에 안 붙는다. ⓐ와 같은 계열. 원인·D6 영향 미조사(§6-3)

**D6 (cutover 관측 후 착수)**: NULL-파괴 게이트 + 이원 정책 allowlist 승격 + 백필.
- ✅ **하드 블로커 해소 + 프로덕션 배포 완료**(§1). 단 **첫 실합성 실증 전에는 게이트를 켜지 마라** — ⓐ가 듣지 않으면 §8-1 의 404 가 그대로 재현된다
- ⚠️ **ⓐ 배포 시각이 백필 경계다** — 그 이전 파트너 잡은 전건 NULL 이므로 게이트 대상
- ⚠️ 백필 41건/NULL 225건은 **2026-08-28 실측치**, 이후 재실측 없음. 집행 전 4수치 재실행 필수
- ⚠️ **합성 잡 3개월 공백**(SYNTHESIZE 최종 2026-06-13) 선반영 — 백필·파일보존 트랙이 "합성 트래픽이 있다"를 암묵 전제하면 안 된다
- ✅ bookmoa 는 백필 대상 제외 확정(결속 jobId 0건)
- 🚨 **게이트 거부 응답 코드를 설계에서 결정하라** — 404 로 내면 "404=성공" 계약(`DELETE /files/:id/external`)을 따르는 파트너 파기 스크립트가
  **삭제 실패를 삭제 완료로 기록**한다(§5-4). printy 는 완화 반영(09-14), **타 파트너는 미확인** → 착수 전 조율 필수

**P2 백로그**: bookmoa 구 프로젝트 폐기 시 allowlist 구 오리진 제거 / 업계표준 R6·R10·R3b / 파일 보존 P1·P2(D6 백필과 교차 — 09-14 보존 cron 실가동·고아 cron dry-run 실측, §5-3) /
멀티테넌시 P3b(`.claude/worktrees/multitenancy-p3b`) / 포토북 S2 / ⓑstage1b·Bull attempts·BQ-03·히스토리 정화 force-push /
§7-1 권고 3건(읽기전용 서브에이전트 `model: sonnet` · 설치본 Bash 제약 `_ai-governance` 역반영 · storige 전용 함정 `.claude/rules/` 분리)

**오너 결정 대기**: 동화책 caseBind · cover VALIDATE 경고 처리 정책 · G-6 백필 ·
**branch protection(master 무보호 확정)** · 폰트 시딩(0건) · D6 착수 시점 ·
**파트너 파기 계약 신설**(합성 산출물·편집 세션 하드삭제 external, §5-2) · **고아 정리 실가동 전환**(`FILE_ORPHAN_DRY_RUN`, §5-3) ·
**고아 판정 완화 (a)안**(종료 VALIDATE 참조 해제 — 집행 순서 분리 권고, §8)

**파트너 트랙(수신 대기)**: ~~printy R-173 배포 완료 재통지~~ ✅ 09-14 수신(§5-5) · printy 첫 실합성 `job.siteId` 회신(§5-1) · bookmoa 첫 실합성 jobId 회신(§6-2 — ACK·확인 ①② 완료) ·
~~printy 고아 판정 완화 질의(09-21)~~ ✅ 실측 회신 발신(§8) — 오너 결정 회신만 잔여

---

## 3. 양사 세션 채널 가이드

- **bookmoa**: cwd `~/Developer/claude/bookmoa-mobile` / **printy**: cwd `~/Developer/claude/printy`
- 🚨 **`ListAgents` 는 cwd 를 보여주지 않는다.** 이름은 재시작 시(같은 날 안에서도) 바뀐다. 확증 절차:
  ```bash
  ls -lt ~/.claude/projects/-Users-yohan-Developer-claude-printy/*.jsonl | head -2
  python3 -c "import sys,json;[print(d.get('cwd')) for l in open(sys.argv[1]) for d in [json.loads(l)] if d.get('cwd')][:1]" <파일>
  ```
  mtime 상관만으로 끝내지 말고 **jsonl 의 `cwd` + 첫 사용자 메시지**까지 대조해야 이름↔cwd 가 1:1 로 묶인다
- ✅ **수신 메시지는 더 확정적으로 확증된다(2026-09-14 실사용)**: `from` 속성이 `uds:/tmp/cc-socks/<PID>.sock` 이면
  `lsof -a -p <PID> -d cwd -Fn` 으로 **발신 프로세스 자체의 cwd** 를 읽는다(추정이 아니라 발신자 그 자체). 회신은 그 `from` 값을 그대로 `to` 로 쓴다
- ✅ **먼저 보낼 때도 같은 방법이 된다**: `for s in /tmp/cc-socks/*.sock; do lsof -a -p $(basename $s .sock) -d cwd -Fn; done` 로 소켓→cwd 를 만들고 그 `uds:` 주소로 보낸다(09-14 bookmoa 통지에 사용)
  ⚠️ **같은 cwd 소켓이 2개 이상일 수 있다**(09-14 실측: printy 28903·50915) — 이때는 `from` 주소를 받은 적 있는 쪽이나 `ListAgents` 의 활성 세션과 교차 확인
- ⚠️ **이름 오인**: `printcard-studio-*` 는 cwd `~/Developer/claude/PrintCard-Studio` 로 **printy 가 아니다**(오발신 주의)
- ⚠️ **발신 성공(msg_id) ≠ 도달.** 수신 세션이 bypass 가 아니면 승인 보류로 지연된다 →
  **메시지에 ACK 한 줄을 명시 요청 + `notify_when_idle`**. 회신만이 도달 증거다(2026-09-11 양사 실증)
- 레포 정본: `docs/partner-notices/` · `docs/PLATFORM_INTEGRATION_GUIDE.md` · `docs/CONTRACT_FREEZE.md`(v1.4)

---

## 4. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피·§5.5 Cloudflare — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb`(타 세션 미커밋 보존)
3. SSH 필요 시 `ssh-add -l` → 없으면 `ssh-add ~/.ssh/id_ed25519`. `deploy@` 대상만(fail2ban, 추측성 사용자명 금지)
4. 함정 상기 = §0 "상시 함정" + §1 "이 트랙이 남기는 함정"
5. 검증 기준선 = §0 표. 실기·프로덕션 키 작업은 권한무시 모드
6. 세션 종료 시 `RESUME_PROMPT_<날짜>.md` 갱신 없이 종료 금지

---

## 5. printy 파일 파기 계약 트랙 (2026-09-14) — 질의 응답 종결, 오너 결정 잔여

printy 세션이 **D6-ⓐ 적용 확인 1건 + 원고 파기(보존정책) 계약 질의 3건 + R-173 동기화 통지**를 보내왔다.
발신자는 소켓 PID cwd 로 확증(§3). 배포본 코드·프로덕션 DB **읽기 전용** 실측으로 회신했고 **양측 ACK 완료**. 당사 코드 변경 0건.

### 5-1. D6-ⓐ — printy 적용 확정

- printy 사이트(`009c26d5-…`) `status=active`, editor 키 = worker 키(동일 코드) → 규칙 ③ 채택
- 조건 ① compose-mixed 에 Bearer 미탑재(printy 코드 대조) → ③-ⓒ 해당 없음
- 조건 ② output-url·external status 도 **같은 printy 키 단일 경로** → 스탬프 이후 `assertJobSiteAccess` 404 없음
- printy site 세션 0건 · 파일 0건 · 실합성 0건. 첫 실합성 때 printy 가 jobId + `job.siteId` 회신 약속

### 5-2. Q1 — 합성 산출물·편집 세션의 파트너 파기 수단: **공백 (오너 결정 대기)**

| 대상 | 현재 |
|---|---|
| 합성 산출물 `outputs/{jobId}/` | files 미등록 · 외부 삭제 라우트 없음 · 정리 cron 은 test env(isTest 24h)·컷아웃 전용뿐 → **프로덕션 산출물 무기한 보존** |
| 편집 세션 | `DELETE /edit-sessions/:id` 는 회원 JWT 전용(memberSeqno 일치 + 테넌트 대조), **soft-delete**(admin 복구 가능), 연결 파일 미삭제 → 파기 요건 불충족 |
| Site `retentionDays` | 업로드 파일(files 행)에만 적용 — 산출물·세션 미포함 |

→ printy 방침 §3("주문 완료 후 3개월 파기")은 **원고 입력 파일까지만** 이행 가능하다. 합성 산출물은 원고 내용의 사본이라
개인정보 파기 관점의 실공백이다. 신규 계약(예: 잡 산출물 하드삭제 external · 세션 하드삭제 external)은 ADDITIVE 지만 **오너 결정** —
printy 오너에게도 같은 보고가 올라갔다. **착수·일정은 약속하지 않았다.**

### 5-3. Q2 — 보존 cron 실측 (문서에 없던 사실 다수)

- **보존 cron 은 실가동이다**: `storage_settings` `retention_enabled=1` · `retention_dry_run=0`(행 갱신 2026-07-06).
  정본은 env 가 아니라 **DB(admin 설정)** 다 — env 키 grep 0건은 정상이다
  - sweep(매시 :17) `expires_at<now` → soft-delete / purge(매시 :47) 48h 후 하드삭제(R2 객체 + DB 행)
- **site 필터가 없어 NULL-site 파일에도 적용된다.** 단 현재 files 283건(site 귀속 44 · NULL-site 239)이 **전부 `expires_at` NULL** → 실제 만료 대상 0건.
  `retention_days` 가 설정된 사이트는 **0곳**
- **적용 시점은 업로드 1회**(`upload/external`: `dto.retentionDays` 가 site 값보다 우선 / presigned: 요청 `retentionDays` 로 finalize — site 기본값 폴백은 **미확인**).
  **사이트 값을 나중에 바꿔도 소급되지 않는다**
- 🚨 **침묵 제외 조건**(`files.service.ts` `findExpired`): 같은 `order_seqno`·같은 site(**NULL끼리 포함**)에 미완료(`status≠complete`)·미삭제 세션이 있으면
  만료 파일을 **로그 없이 건너뛴다**. 편집이 editing 에 머문 주문의 파일은 만료 예약으로 지워지지 않는다
- `DELETE /files/:id/external` 은 즉시 하드삭제라 위 제외를 거치지 않는다 → 파트너 파기 수단으로는 만료 예약보다 확실하다
- **고아 정리 cron(`file-orphan.service.ts`)은 dry-run 이다** — 보존 cron 과 **별도 스위치**다. `FILE_ORPHAN_DRY_RUN` 이 VPS `.env`·compose 에 없어
  코드 기본값 `'1'`(dry-run)로 돈다. 로그에 `[orphan][dry-run] 강등대상` 이 매시 반복(48h 간 동일 후보 반복) → 무참조 파일은 자동 파기되지 않는다.
  코드 주석상 "검증 후 명시적으로 `'0'`" 이 예정된 운영 단계였으나 미집행 → 오너 결정 대기 등재
- 🚫 **printy 사이트에 `retention_days` 를 설정하지 마라.** printy 는 "업로드마다 `retentionDays: 90`" 권고를 **거절**했다 —
  방침 기산점이 **주문 완료**라, 업로드 기산이면 제작이 길어진 주문의 원고가 **완료 전에 삭제**된다. 완료 기산 파기는 printy 스크립트가 맡는다.
  사이트 값을 설정하면 printy 가 막으려는 사고를 당사가 일으킨다
- ➡️ **2026-09-21 재실측·고아 판정 완화 제안·규모 집계는 §8**. 이 절의 수치(files 283건 등)는 09-14 기준이라 §8 이 최신이다

### 5-4. Q3 — NULL-site 파괴 라우트 · D6 설계 입력 1건

- printy 관찰 정확: `hardDelete`·`setExpiry` 는 `assertSiteAccess` 만 거치고, 그 함수는 `file.siteId` 가 NULL 이면 통과한다(worker 역할은 전면 바이패스)
  → fileId 를 아는 **어느 활성 파트너 키로도** NULL-site 파일 하드삭제·만료 변경이 가능하다. 알려진 결함(CONTRACT_FREEZE §4.3)
- 해소 계획 = **D6 ① NULL-파괴 게이트(D안, `TENANCY_S3_S4_DESIGN_2026-08-28.md` §2-C)**. 단독 시행 시 NULL 파일을 자기 키로 정리 중인 기존 파트너가 깨지므로 최종 단계
- 🚨 **D6 설계 입력(신규)**: printy 결속 fileId 는 **전부 NULL-site**(printy 귀속 파일 0건). D6 게이트가 allowlist 밖 키를 **404 로 거부**하면,
  계약상 "404=성공"인 파트너 파기 스크립트가 **삭제 실패를 삭제 완료로 기록**한다
  - printy 는 **완화 반영**(09-14 배포분): 404 를 삭제 건수에 합치지 않고 `notFoundUnconfirmed` 로 분리 기록
  - **100p·MD2Books 등 타 파트너는 미확인** — D6 거부 응답 코드 결정 시 반드시 반영하고 착수 전 조율
  - 앞으로 printy 키로 업로드되는 파일은 printy 로 스탬프되므로 리스크는 **기존 NULL 파일에 한정**

### 5-5. R-173 통지 (printy 프로덕션 배포 완료 — 09-14 재통지 수신)

- 관리자·고객 '합성 결과' 클릭당 `GET external/{jobId}/output-url` **2회**(열거 1 + 선택 다운로드 1) — 로그에서 2배로 보이는 게 정상
- 서명 URL 미저장·매번 재발급·`/storage-signed/outputs/` 프리픽스 검증 — 계약 정합. TTL 기본 300초
- `400 JOB_OUTPUT_NOT_READY` 는 **의도적 비계측**(bookmoa 와 동일한 409 + 재시도 안내). 발급 `NOT_SIGNABLE`·503·401/403 과 서명 경로 410/403 은 printy 가 계측
- ✅ **09-14 재통지 수신(회신 불요)**: printy main `4b7f6f0` 프로덕션 Ready(www.printy.kr), 라이브 프로브(무부작용)로 신코드 응답 확인.
  함께 반영: 파기 스크립트 404 분리 기록(`notFoundUnconfirmed`) · printy CLAUDE.md D6 절을 ⓐ 규칙 ③·조건 ①②·첫 실합성 전 게이트 보류 합의로 갱신.
  (printy 내부 교정: SSRF 게이트의 신뢰 Supabase 호스트 상수가 bookmoa ref 로 남아 있던 것 — 당사 호출 동작 무영향.) **당사 조치 없음**
- printy 잔여 약속은 **첫 실합성 시 jobId + `job.siteId` 회신** 1건뿐이다(§5-1)

---

## 6. bookmoa D6-ⓐ 통지 (2026-09-14) — ACK·확인 ①② 완료, 첫 실합성 jobId 대기

09-11 "계속 대기 · siteId 를 새로 싣지 말 것" 통지의 후속이다. 수신자는 소켓 PID cwd(`~/Developer/claude/bookmoa-mobile`)로 확증하고
`uds:` 주소로 발신, ACK 명시 요청 + `notify_when_idle`. 당사·bookmoa 코드 변경 0건.

### 6-1. 발신 전 실측 (DB 읽기 전용, 키 값 미출력)

| 사이트 | 상태 | editor=worker 코드 | 편집 세션 |
|---|---|---|---|
| bookmoa-mobile `26183a7c` | inactive(06-15 회전 전) | 다름 | **0건** |
| bookmoa-mobile (rot 06-15) `b5aef7a9` | **active** | 다름(같은 행) | **63건**(06-02~09-14, complete 16) |
| 북모아 메인 `1391c5b4` | inactive | 같음 | **32건**(04-28~06-15, complete 3 · 미완료·미삭제 **12**) |
| 북모아 메인 (rot 06-15) `dc81d27f` | active | 같음 | 0건 |

- **bookmoa-mobile 은 ③-ⓑ 위험이 없다** — 회전 전 기간(06-02~06-15) 세션까지 전부 신 사이트 `b5aef7a9` 로 스탬프돼 있다.
  editor·worker 코드가 달라도 같은 사이트 행이라 어느 키로 호출해도 같은 site 로 해석된다
- 🚨 **북모아 메인(PHP, 연동 보류)은 위험이 있다** — 구 사이트 소유 세션 32건(살아 있는 미완료 12)이 남았고 신 사이트 세션은 0건이다.
  PHP 연동을 신 키(`dc81d27f`)로 재개해 **이 세션들로 합성하면 ③-ⓑ 로 NULL 스탬프**가 된다. 재개 시 세션 `site_id` 이관 여부를 먼저 결정할 것(통지에 참고로 포함)

### 6-2. 통지 요지와 대기 항목

1. ⓐ 배포 완료 — bookmoa 실제 호출 형태(X-API-Key + editSessionId + body.siteId 미전송 + assembleFromSession 미사용)는 규칙 ③ → `b5aef7a9` 로 스탬프. bookmoa 코드 변경 불요
2. **확인 ① ✅ 미동반**: compose-mixed·synthesize/external 은 `_client.js storigeFetch` 로 호출되고 `X-API-Key` 만 붙는다(bookmoa 코드 대조, authorization/bearer 0건) → ③-ⓒ 해당 없음
3. **확인 ② ✅ 같은 키**: compose-mixed·external 상태 조회·output-url 세 호출이 **단일 env `STORIGE_API_KEY`** 를 쓴다(다른 키 변수 없음). 그 키의 사이트 판정은 bookmoa 가 당사에 위임 → 아래 6-2-1 로 `b5aef7a9` 확정
4. `body.siteId` 신규 탑재 금지
5. 첫 실 compose-mixed 의 **jobId 회신** 요청 → 당사가 `job.siteId` 확인. 확인 전 D6 게이트 미가동
6. D6 사전 공지 — 게이트가 404 로 거부할 수 있으니 "404=성공" 처리 지점이 있으면 대비(printy 와 동일, §5-4)

**대기**: 첫 실합성 jobId 회신 **1건뿐**(ACK·확인 ①② 완료). bookmoa 결속 jobId 0건·file 54건(`order_asset_claims`),
실합성은 실주문 흐름에서만 발생해 bookmoa 가 임의로 일으키지 않는다 — 첫 compose-mixed 시 회신(bookmoa 오너 운영 항목으로 인계문 기록).

#### 6-2-1. 키 소유 판정 — 키 값을 꺼내지 않는 방법 (재사용 가능)

bookmoa 는 키 값을 열람하지 않아 "그 키가 `b5aef7a9` 행인가"를 당사에 위임했다. 키 값 없이 코드·DB·로그로 닫았다:

1. shop-session 발급(`auth.controller.ts:180`)은 `@UseGuards(ApiKeyGuard)` + `@CurrentSite()` → **JWT siteId = 호출한 키의 사이트**
2. 회원 세션 생성(`edit-sessions.controller.ts` `create`)은 `create({ ...dto, memberSeqno, siteId: user?.siteId })` — **spread 뒤에 JWT 값이 덮어쓴다**
   (본문 siteId 무력. `undefined` 여도 명시 키가 덮으므로 본문 값이 살아남지 않는다) → **세션 siteId = JWT siteId**
3. bookmoa 는 shop-session 발급을 포함한 모든 Storige 호출에 단일 키를 쓴다(bookmoa 코드 대조)
4. 실측: bookmoa-mobile 세션 63건 전부 `b5aef7a9` · 09-14 09:18 UTC 로그에서 `POST /auth/shop-session` 200 직후 `POST /edit-sessions` 201, 그 세션도 `b5aef7a9`

⇒ **bookmoa 의 단일 키 = `b5aef7a9` 소유 확정.** compose-mixed 스탬프 사이트와 output-url·상태 조회 권한 사이트가 같아 스탬프 이후 404 는 구조적으로 없다.
> ⚠️ 2단계의 **spread 순서가 이 판정의 전제**다. `siteId: user?.siteId` 를 `...dto` 앞으로 옮기면 본문 siteId 가 세션 스탬프를 위조할 수 있고, 이 판정법도 무효가 된다

- **D6 404 대비 → 영향 없음 확정**: bookmoa 는 `DELETE /files/:id/external` 을 쓰지 않는다. Storige 대상 DELETE 는 `DELETE /edit-sessions/:id`(회원 Bearer + X-API-Key) 하나이고 `storigeFetch` 가 non-ok 에서 예외를 던져 404 를 성공으로 합산하지 않는다
- 북모아 메인 PHP 참고(6-1)는 bookmoa 가 "bookmoa-mobile 무관 · 재개 시 조율"로 기록

### 6-3. 관찰 — 2026-09-14 09:18 UTC 내부 테스트 흐름에서 드러난 VALIDATE 스탬프 공백

api 로그(대조군 = 09-12 프로브 2건 검출로 파싱 유효 확인) 순서:
`POST /edit-sessions`(201) → `POST /files/upload` ×2(201) → `PATCH /edit-sessions/{id}/complete`(200) → 워커 콜백 `PATCH /worker-jobs/external/{id}/status` ×4 → `DELETE /edit-sessions/{id}`(09:19:56, soft-delete)

- 세션 `37136529…`: 사이트 `b5aef7a9`, cover 모드, **내부 관리자 계정**, 주문 있음 → 실고객 아님. 합성 호출 없음
- 생성된 VALIDATE 2건(cover·content) COMPLETED — **`site_id` NULL · `edit_session_id` NULL · callback 없음**.
  외부 `validate` 라우트 호출이 로그에 없어 **세션 완료 처리가 내부에서 만든 잡**으로 보인다(생성 지점 코드는 미확인)
- 서버가 권위(`session.siteId`)를 갖고도 잡에 붙이지 않는 점에서 **ⓐ와 같은 계열의 공백**이다. 원인과 D6 영향(VALIDATE 산출물·파일 회수 경로가 NULL 게이트에 걸리는지)은 **미조사**
- 같은 흐름에서 업로드된 파일 2건의 `site_id` 도 확인하지 않았다 — 조사 시 함께 볼 것

---

## 7. gitleaks CI 설치 단계 강화 (2026-09-15) — ✅ PR #16 머지·배포 완료

- **증상**: 09-14 run 34856112186(docs 전용 커밋)이 attempt 1·2 모두 Install 스텝에서 curl 시작 ~80ms 후 `gzip: stdin: not in gzip format` 로 실패.
  **Scan 스텝 skip → 시크릿 검출 아님.** 같은 시각 로컬 동일 URL 302→200(8230402 bytes)·githubstatus 정상·직전 run 성공·로컬 동일 명령 스캔 무검출 → 러너 측 다운로드 문제로 판단.
  종전 `curl -sSL | tar` 라 러너가 받은 HTTP 상태가 로그에 없었다
- **변경**(`.github/workflows/gitleaks.yml` Install 스텝만): `curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors -o` → `sha256sum -c` → `tar -xzf`, 작업 위치 `$RUNNER_TEMP`.
  `VER=8.30.1`·바이너리 직접 실행(gitleaks-action 라이선스 회피)·스캔 범위·`--config .gitleaks.toml --redact` **무변경**
  - 해시를 **워크플로에 고정**한 이유: 같은 릴리스의 checksums.txt 를 런타임에 받아 대조하면 손상만 잡고 자산 교체는 못 잡는다.
    값은 checksums.txt · GitHub API asset digest · 로컬 계산 **3자 일치**로 확정. `VER` 변경 시 함께 갱신(§0 상시 함정)
- **검증**: actionlint v1.7.12(+shellcheck) 0 · YAML 에서 스텝을 추출해 로컬 실행(정상 해시 설치 / 틀린 해시 `sha256sum` exit 1 로 해제 전 중단) ·
  PR #16 체크 5종 통과(러너 로그 `gitleaks.tar.gz: OK`) · **머지 후 master gitleaks run 전 스텝 success**(`OK` · 8.30.1 · 범위 스캔 no leaks) ·
  run 34856112186 재실행 attempt 3 success(재실행은 **구 워크플로**로 돈다 — 수정 검증이 아니라 커밋 상태 복구용)
- **배포**: Vercel `storige-editor`·`storige-admin` = Production **Canceled 5s/3s**(ignoreCommand 스킵, 빌드 없음) · `papascompany-homepage` = 이 커밋 대상 배포 없음(최근 배포 45일 전 — 이 저장소 push 로 트리거되지 않는다) ·
  VPS = 런타임 무영향이지만 오너 요청으로 **체크아웃만 동기화**(`git pull --ff-only` — 범위가 `docs/`·`.cursor/`·`.github/` 뿐임을 사전 실측, 컨테이너 재시작 없음, §0)
- **미해소**: 09-14 러너가 받은 실제 HTTP 상태는 여전히 불명(이후 run 들은 재시도 없이 1회 성공). 재발하면 이제 로그에 `curl: (22) … error: <code>` 가 남는다
- 병합은 기존 PR 관례대로 머지 커밋. 작업 브랜치 `ci/gitleaks-install-retry` 는 **원격·로컬 모두 삭제 완료**(2026-09-15 — PR 커밋이 master 에 포함됨을 확인 후 원격 삭제 + `git branch -d`).
  ⚠️ 이 저장소는 `delete_branch_on_merge=false` 라 **머지만으로는 브랜치가 지워지지 않는다** — 다음 PR 때도 수동 삭제가 필요하다

### 7-1. 별도 세션 교차 검증 (2026-09-15) — §7 기록과 실측 일치

§7 을 작성한 세션과 **다른 세션**이 GitHub·VPS 를 읽기 전용으로 다시 대조했다. 어긋난 항목 0건.

| §7 주장 | 교차 실측 |
|---|---|
| Install 스텝만 변경, 버전·바이너리 방식·스캔 범위·`--config`/`--redact` 무변경 | ✅ PR #16 diff = `gitleaks.yml` 1파일 +12/−2, Install 스텝 한정 |
| 고정 SHA256 이 정본 | ✅ 공식 `gitleaks_8.30.1_checksums.txt` 의 linux_x64 값과 **바이트 일치** |
| PR·머지 후 master 전 스텝 success | ✅ PR run 과 머지 후 최신 master run 모두 **Scan 스텝까지 실제 실행**(skip 아님) |
| run 34856112186 attempt 3 success | ✅ Scan 실행·무검출 — 09-14 로컬 동일 명령 스캔 결과와 일치 |
| VPS 체크아웃만 동기화, 컨테이너 무변경 | ✅ 아래 |

VPS 실측(2026-09-15 05:47 UTC):
- 작업트리: §7 기록 커밋에 체크아웃 · origin 대비 문서 커밋만 미동기화 · 클린(untracked 는 04-28 부터 있던 `docker-compose.yml.bak.*` 1건)
- **런타임 경로 변경 0건**: 마지막 API 배포 커밋 이후 바뀐 파일은 이 RESUME 와 `gitleaks.yml` 뿐(`apps`·`packages`·`docker-compose.yml`·`nginx.conf` 무변경) → pull 이 컨테이너에 영향을 줄 경로 자체가 없다
- 컨테이너 기동 시각: `storige-api` 09-12 04:31:23 · `storige-nginx` 09-12 04:31:33(= D6-ⓐ 배포·nginx 재시작 그대로) · `storige-worker` 08-12 · mariadb/redis/rembg healthy
- **실행 이미지 = `:latest` 빌드 이미지**(api·worker 모두) → "재빌드만 하고 recreate 안 한" 상태 아님
- 실행 중 api 의 D6-ⓐ 지문: 신규 문자열 2종 각 1 + 대조군 1
- 외부: api health 200(uptime ≈3.05일, 09-12 기동 시각과 초 단위 정합) · editor 200 · admin 200
- VPS 쓰기(pull·재시작) **0건**

> 참고: 이 트랙을 만든 백그라운드 작업(task_7cf47877)의 **종료 알림은 요청 세션에 도착하지 않았다**(그 세션은 idle 로만 표시). 완료 판정은 알림이 아니라 PR 상태·run 스텝·VPS 실측으로 했다

#### 7-1-1. 트랙 종료 정리 (2026-09-16)

- **완료 판정 재확인**: master 워크플로에 보강된 Install 스텝 실재(`SHA256` 고정·`-f`·재시도·`sha256sum -c`·`tar -xzf`) · `VER=8.30.1`·`--config`·`--redact` 무변경 ·
  브랜치 참조 **0건**(원격·로컬) · 이 트랙이 남긴 worktree **없음** · 열린 PR 0건 · gitleaks run 은 최신 문서 커밋까지 전부 success
- **작업 세션은 보관(archive) 처리**했다. `prState=MERGED` 로 연결돼 있고 마지막 활동 이후 대기 중인 질문·미완 약속 없음
- 🔴 **그 세션 로그에 `CLAUDE.local.md` 의 키·비밀번호 평문 일부가 출력됐다**(세션 스스로 보고). 커밋·외부 전송 **0건**.
  - **삭제하지 말고 보관만 한다** — 전역 지침상 세션 히스토리 보존이 우선이고 삭제는 복구 불가
  - **그 트랜스크립트를 export·복사·외부 공유하지 않는다.** 노출은 로컬 로그 한정이라 즉시 회전이 필수는 아니며, 회전 대상 선정은 오너 판단(별도 트랙)
  - 재발 방지: 프로덕션 조회 시 `.env`·`CLAUDE.local.md` 값을 화면에 띄우지 말고 **키 이름만** 출력한다(§5-3 에서 쓴 방식)
- 미해소 1건은 그대로: 09-14 러너가 받은 실제 HTTP 상태 불명(§7). 재발 시 로그에 curl 오류 코드가 남는다

## 8. 고아 판정 완화 트랙 (2026-09-21) — 실측 종결, 오너 결정 잔여

bookmoa 가 R-188 조사에서 먼저 제기하고 printy 가 자사 소스로 동형 확인해 전달문을 보냈다.
**"주문에 이르지 못한 이탈 업로드가 아무에게도 지워지지 않는다"** — 당사 코드 대조 + 프로덕션 **읽기 전용** 실측으로 종결.
당사 코드 변경 0건 · VPS 쓰기 0건 · 키 값 미출력.

### 8-1. printy 주장 검증 (배포본 코드 대조)

| 주장 | 판정 | 근거 |
|---|---|---|
| 고아 cron dryRun 기본 ON, `envDryRun \|\| retention.dryRun` | ✅ 사실 | `file-orphan.service.ts:51`(기본 `'1'`) · `:73` |
| **검증 job 1건이 붙으면 영구 고아 제외** | ✅ 사실 | `files.service.ts:695` — `worker_jobs` NOT EXISTS 절에 **status 필터가 없다**. 완료·실패·FIXABLE 무관하게 영구 제외 |
| S1 = `findExpired` 에 order 가드 없음 · 즉시 hardDelete | ❌ **스테일** | 아래 |

🚨 **정정(문서 스테일)**: `findExpired`(`files.service.ts:540`)에는 order 가드가 **있다** — 같은 `order_seqno`·같은 site 에 미완료
편집세션이 있으면 만료를 건너뛴다(§5-3 의 침묵 제외와 같은 절). 삭제도 즉시 hard 가 아니라 sweep(soft) → 48h → purge(hard) 2단계다.
**단 그 가드는 편집세션이 있는 주문만 보호한다** — printy 처럼 편집세션을 만들지 않는 플로우에서는 사실상 무력이므로,
printy 의 결론(**site 전역 `retentionDays` 를 printy 에 적용 금지**, §5-3)은 그대로 유효하고 근거만 "가드 없음" → "가드가 편집세션에만 걸림"으로 바뀐다.
→ `docs/FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md:83,106` 의 S1 행이 현재 코드와 어긋난다(미수정 — 오너 승인 대기).

### 8-2. 운영값 실측 (printy 질의 3건의 회신 근거)

**① 고아/보존 스위치** — api 컨테이너에 `FILE_ORPHAN_DRY_RUN`·`FILE_ORPHAN_ENABLED`·`FILE_RETENTION_DRY_RUN`·`FILE_RETENTION_ENABLED`·
`FILE_ORPHAN_GRACE_READY_DAYS`·`FILE_RETENTION_BATCH` **전부 미설정**. `ConfigModule` 이 찾는 `.env.production`·`.env` 도 `/app` 에 **없다**
(`app.module.ts:47`) → **코드 기본값이 유일한 정본**이다.
- 고아 정리: enabled · **dryRun ON**(기본 `'1'`) · ready grace 30일
- admin `storage_settings`: `retention_enabled=1` · **`retention_dry_run=0`** (행 갱신 2026-07-06 06:36:14, 이후 무변경)
- ⇒ **고아 정리 = dry**(env OR admin 중 env 가 ON) / **보존 sweep·purge = 실가동**(`file-retention.service.ts` 는 admin `retention.dryRun` 만 참조, env OR 없음)
- ⚠️ 단 `expires_at IS NOT NULL` 인 미삭제 파일이 **0건**이라 보존 sweep 은 실가동이어도 **대상이 없다**
- 실측 로그(매시 :07): `[orphan] 완료 — 강등 15 / skip 0 / 실패 0` — 독립 재현 쿼리 결과 15와 **일치**(교차 검증 성립)

**② 전 사이트 `retention_days` = NULL**(10개 행 전부). printy `009c26d5-…` 도 NULL ✅ — 원고가 완료 전 만료될 경로 없음.
- printy site 행 `updated_at=2026-09-21 07:21:19` = 오늘 키 재발급과 정합 / bookmoa `b5aef7a9` 는 `2026-08-26 13:40:00` → **오늘 변경 없음**(bookmoa 키 미재발급 진술과 부합)

**③ printy 운영 자산 = 0건.** `files` 0(soft-deleted 포함 0) · `worker_jobs` 0 · `file_edit_sessions` 0.
- 스탬프 누락으로 NULL 에 섞였을 가능성은 **배제**: 외부 업로드는 `files.controller.ts:386` 에서 호출자 siteId 를 찍고, bookmoa 는 실제로 64건 스탬프돼 있다
- ⇒ printy 의 §1 지적은 **메커니즘은 옳지만 현재 실노출은 0건**이다. 방침 미이행은 잔존 데이터 문제가 아니라 **장래 위험**이다

### 8-3. 규모 (오너 결정 입력 — 2026-09-21 실측)

| 구분 | 건수 | 용량 |
|---|---|---|
| 현행 고아 후보(실제 강등 대상) | 15 | — |
| 편집세션 참조 없음 + **job 참조 때문에** 제외 | 141 | 888MB |
| ↳ **(a)안으로 즉시 풀리는 분**(입력 참조 한정) | **102** | **859MB** |
| (a)안 정상상태 — site NULL | 127 | 1.71GB |
| (a)안 정상상태 — MD2Books | 1 | 0.11MB |
| (a)안 정상상태 — **bookmoa `b5aef7a9`** | **61** | **2.42GB** |

- (a)안 판정 기준은 보수적으로 잡았다: **입력으로만 쓰였고, 그 파일을 참조하는 _모든_ job 이 종료 상태 VALIDATE**(COMPLETED·FAILED·FIXABLE).
  참조 형태를 출력(`output_file_id`/`output_file_url`)까지 넓히면 +2건인데, 그 2건은 **산출물**이라 푸는 대상이 아니다
- 🚨 **bookmoa 61건/2.42GB 가 곧 후보로 들어온다** — 지금은 ready grace 30일 미경과로 0건이지만 최고령이 `2026-08-28 05:04:35` 라
  **약 2026-09-27 부터 진입**한다. printy 는 0건이라 영향 없음
- 전체 files(미삭제) 295건: NULL 230(1768MB) · `b5aef7a9` 64(2479MB) · MD2Books 1

### 8-4. 권고 (오너 결정 대기)

(a)안(종료 VALIDATE 참조는 참조로 보지 않음) **방향에 동의**한다 — 보존 방향 오류 위험이 가장 낮고 printy·bookmoa 양쪽에 동시에 듣는다. (b)안(site 전역 `retentionDays`)은 §5-3 금지 사유가 그대로 유효하다.
단 **집행 순서를 분리**해야 한다:

1. 판정 완화 + **site 별 분리 집계 로그** 추가 (현재 dry 로그는 site 별 수치가 없어 오너가 판단할 근거가 없다)
2. 최소 한 사이클 **dry 유지**로 수치 확인 — bookmoa 2.42GB 진입 시점(≈09-27)을 지나서 보는 편이 낫다
3. 오너 승인 후 `FILE_ORPHAN_DRY_RUN='0'` 실가동 전환

🚫 **같은 변경에서 dry-run 을 끄지 마라.** bookmoa 가 주문을 늦게 연결하는 플로우면 2.42GB 가 실삭제 대상이 된다(48h 복구창은 있으나 사후 대응이다).

### 8-5. 부수 발견

- **printy 는 운영 Storige 에 실업로드 이력 자체가 없다**(파일·잡·세션 0). §5-1·§5-4 의 "printy 결속 fileId 는 전부 NULL-site" 전제는 유효하되,
  D6 게이트가 기다리는 **printy 첫 실합성은 아직 먼 상태**다
- site_id NULL 인 `worker_jobs` 중 2026-08-14 이후분은 **전부 `edit_session_id` NULL · `request_id` NULL 이고 쌍(표지+내지)으로 생성**된다 →
  §6-3 의 세션완료 경로 결함과 같은 계열이다(신규 아님). 2026-09-14 09:18:27 쌍이 §6-3 이 말한 그 흐름이다
- printy 가 회신에 덧붙인 운영 주의(당사 검증 안 함, printy 실측): 파트너 키 유효성은 `POST /auth/shop-session`(빈 본문 → **400 = 통과**)으로만 재라.
  `GET /template-sets` 로 재면 **유효한 사이트 키에도 401** 이 나와 멀쩡한 키를 "거부됨"으로 오진한다
