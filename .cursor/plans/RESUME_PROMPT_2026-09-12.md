# RESUME PROMPT — 2026-09-12

> **이 문서가 최신 날짜 정본이다.** 9/11 상세 이력(§7 세션 로그 3종·§8 R-172·§8-1 D6 블로커 규명)은
> `RESUME_PROMPT_2026-09-11.md`, 그 이전은 `RESUME_PROMPT_2026-08-28.md`·`_2026-08-25.md`(아카이브).
> 2026-09-12 작성 · **2026-09-14 갱신**(§1 사후 실측 · §5 printy 파일 파기 계약 트랙 · §3 채널 확증법).

## 0. 현재 라이브 상태

- **D6-ⓐ 커밋·푸시·API 배포 전부 완료(§1).** master = origin/master.
  VPS `~/storige` 는 **D6-ⓐ 코드 커밋까지 반영** — 이후 문서 커밋은 런타임 무영향이라 미동기화(다음 API 배포 때 자연 동기화)
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
- **사용자에게 주는 실행 블록(` ```bash `)에 자리표시자(`<host>` 등)를 넣지 마라** — 앱의 Run 버튼으로 그대로 실행되고, zsh 가 `<host>` 를 **입력 리다이렉션**으로 읽어 `no such file or directory: host` 로 실패한다(2026-09-14 실사고, 서버 무실행).
  프로덕션 조회는 에이전트가 직접 실행하고, 사용자용이면 실값 위치(`CLAUDE.local.md` §1.1)를 문장으로 안내한다
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
 WHERE job_type='SYNTHESIZE' AND created_at > '2026-09-12' ORDER BY created_at DESC LIMIT 5;
```

🚨 **이 확인 없이 D6 게이트를 켜면 ⓐ를 한 효과가 없고 09-11 정본 §8-1 의 404 가 그대로 재현된다.**

> **2026-09-14 재조회 — 판정 대상 0건(미검증 유지).** 배포 이후 `worker_jobs` **전 타입 0건** · 편집 세션 0건 ·
> 실 compose-mixed 호출 0건(로그 2건은 배포 직후 당사 프로브 400).
> 대조군: 배포 이후 API request **190건**(로그 정상) · 필터 없는 타입별 최신 잡 = VALIDATE **2026-09-09**(누적 222, 09-11 실측과 동일)
> → 필터·타임존 오류가 아니라 **실제 무트래픽**. 공백은 배포(09-12) 이전부터라 배포 영향 아님.
> printy 도 같은 호출 조건으로 적용 확정(§5-1) — 첫 실합성은 bookmoa·printy 어느 쪽이든 위 쿼리로 판정한다.

> 참고: bookmoa 가 editor 키인지 worker 키인지는 당사에서 알 수 없어 **둘 다 수용**하도록 만들었다(불확실성 제거).

### (범위 밖 관찰) 프로덕션 이미지에 `.spec.js` 가 실린다

`dist/auth/` 에 spec 컴파일 산출물 9개가 있다(제 것 1 + **선재 8**). 런타임 동작에는 무해하지만 이미지 크기와
공격 표면 관점에서 바람직하지 않다. **이번 변경이 만든 것이 아니라 기존 빌드 설정 특성**이다 — 별도 트랙.

---

## 2. 잔여 작업

**P0 — 오너 액션**
1. ~~D6-ⓐ 커밋·푸시·VPS 배포~~ **✅ 2026-09-12 완료**(§1 배포 실증)
2. **bookmoa 통지 — 미발신, 최우선.** 내용: ① ⓐ 배포 완료, **이제 키만으로 siteId 가 붙는다**
   ② `body.siteId` 를 **새로 싣지 말 것**(키와 불일치면 ③-ⓐ 로 NULL — 안 싣는 게 정답)
   ③ 첫 실합성 때 `job.siteId` 가 NULL 이 아닌지 확인해 회신 요청(당사 유일 잔여 미검증)
   ④ D6 게이트는 그 확인 전까지 켜지 않는다. 09-11 "계속 대기" 통지의 후속이다
3. 파트너 회신문 **미발송 5건**: ⓐ 8/24 통지 4종 + ⓑ 프린티 템플릿셋 스코프
4. 동화책 왕복 실기 1회로 묶음 해소: 재진입 유지 확인 + `window.__storigeLoadProfile.laps` 의 `grow:*` 캡처(읽기 전용) + bookmoa 장바구니 #1 테스트 항목 삭제

**P1 — 코드**
- **즉시 착수 가능한 P1 잔여 0건**(09-11 의 P1-4~8·P2-10 전부 종결, D6-ⓐ 금일 종결)
- (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭
- (관찰) `render-pages` 게스트는 여전히 NULL 스탬프 — ⓐ와 같은 공백이 남아 있다. D6 대상이면 동형 처리 필요(§1-C-2 범위 밖)

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
**파트너 파기 계약 신설**(합성 산출물·편집 세션 하드삭제 external, §5-2) · **고아 정리 실가동 전환**(`FILE_ORPHAN_DRY_RUN`, §5-3)

**파트너 트랙(수신 대기)**: ~~printy R-173 배포 완료 재통지~~ ✅ 09-14 수신(§5-5) · printy 첫 실합성 `job.siteId` 회신(§5-1) · bookmoa 통지는 **미발신**(P0-2)

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
