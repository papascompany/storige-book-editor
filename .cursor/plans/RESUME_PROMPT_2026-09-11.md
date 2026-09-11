# RESUME PROMPT — 2026-09-11

> **이 문서가 최신 날짜 정본이다.** 8/25~8/28 상세 이력(④~⑮)은 `RESUME_PROMPT_2026-08-25.md`, 8/28 세션 종료 상태는 `RESUME_PROMPT_2026-08-28.md`(이력 아카이브) 참조.

## 0. 현재 라이브 상태 (2026-09-11 기준)

- **로컬 master = origin/master + ahead 2 — 🚨 미푸시(오너 승인 대기).** VPS `~/storige` 는 `94edb89` 유지 — API 재배포 불요
  - ahead 2 = ① FontPlugin A-1(`packages/canvas-core/src`) ② 이 문서 갱신
  - 🚨 **푸시 = editor 프로덕션 배포다.** `apps/editor/vercel.json` 의 `ignoreCommand` 감시 경로에 `../../packages/canvas-core` 가 있어 ①이 **Vercel 빌드를 트리거**한다(admin 감시 경로에는 canvas-core 가 없어 admin 은 스킵). 09-11 오후까지의 푸시분은 문서·템플릿뿐이라 무해했지만 이번은 다르다 — **오너 승인 후 푸시**
  - 09-11 오후 푸시분(문서·env 템플릿·미참조 파일 삭제)은 VPS 동기화가 필수가 아니다. 다음 API 배포 때 자연히 따라온다
  - 해시를 여기 박지 않는다: 이 문서를 포함한 커밋의 해시는 쓰는 시점에 알 수 없다. **정확한 HEAD 는 `git log --oneline -5` 로 읽어라**
  - ⚠️ **자기참조 함정 3연속 적발**: 08-28 정본(`990b418` ← 실제 `39b787c`), 이 문서 최초판(`9e085c4` ← 실제 `94edb89`), 그리고 09-11 오후 갱신 초안(`25ff568` ← 실제는 그 갱신 커밋 자신)까지 전부 같은 실수였다. **해결책은 갱신 후 HEAD 를 다시 읽는 게 아니라 자기 해시를 애초에 쓰지 않는 것이다** — 위처럼 origin 기준 + ahead N 으로 적어라
  - 워킹트리 클린
  (untracked `.tmp-verify-combos/`·`docs/SHOPIFY_*`·`docs/SITE_CATALOG_*`·`docs/PLATFORM_INTEGRATION_GUIDE.backup-2026-07-09.md` 는 타 세션 산출물 — 무접촉, `git add` 항상 명시 목록)
- 배포: editor/admin=Vercel master push 자동 / API·워커=VPS 수동(`CLAUDE.local.md` §6)

### 🚨 nginx 배포 함정 (2026-09-11 실사고 — 08-28 정본의 절차가 틀렸다)

`docker-compose.yml` 은 `nginx.conf` 를 **파일 bind-mount** 한다. `git pull` 은 파일을 **새 inode 로 교체**하므로
컨테이너는 계속 구 inode 를 본다. **`up -d`·`restart`·`nginx -s reload` 모두 무효**였다(로그는 정상처럼 보인다).

```bash
docker compose up -d --force-recreate nginx   # ← 유일하게 유효
docker compose exec -T nginx sh -c 'nginx -T 2>/dev/null | grep -c "찾을 문자열"'  # 반드시 로드 확인
```

> 판별법: `nginx -t` 는 **디스크**를 읽어 통과해도, `nginx -T` 로 **로드된** 설정을 확인해야 한다.
> 08-28 정본의 "볼륨 변경 시 restart 아닌 up -d" 는 *볼륨 추가* 한정이며, *파일 내용 변경* 에는 recreate 가 답이다.

### 검증 기준선 (이보다 낮으면 회귀 — 2026-09-10 재실측)

| 대상 | 기준 | 재실측 |
|---|---|---|
| api jest | **78스위트/1071 PASS** · contract-freeze 73 · lint 0err(44 warn) | ✅ 3회 연속 동일 |
| editor vitest | **66파일/785 PASS** · tsc 0err · eslint 0err(78 warn) | ✅ 2회 연속 동일 |
| canvas-core | **55파일/628 PASS** · lint 0err(48 warn) | ✅ 2026-09-11 저녁 재실측 — A-1 회귀 테스트 1파일/5테스트 편입(종전 54/623, 증발 0). `node -v` v22.22.2 고정 |
| 플레이크 | **등재 0종** | ✅ 3연속 전체실행 재현 0건 |

> ⚠️ **런타임 함정**: 이 맥의 `/opt/homebrew/opt/node@24` 심볼릭 링크는 **Node 26 을 가리킨다**.
> canvas-core 는 반드시 `PATH="/opt/homebrew/opt/node@22/bin:$PATH"` 고정 후 `node -v`(v22.22.2) 확인하고 실행.
> 08-28 정본의 "Node 22/24 전용" 표기는 이 머신에서 사실상 **22 전용**이다.

## 1. ✅ D5 cutover 완료 (2026-09-11, 예정 9/4 대비 7일 지연 실행)

`4463a5f` — nginx `location /storage/outputs/` 신설(410 + `X-Storige-Notice` + `no-store`) + 문서 4곳 동기화.

실증(2026-09-11 라이브): 레거시 무인증 **410**(실제 산출물·없는 파일 동일) / 유효 서명 **200** / 변조 403 /
만료 410 / `/storage/uploads/`·`/storage/designs/` 404(무변경) / api·editor·admin 200.
사전 검증으로 `OUTPUT_SIGN_SECRET`(.env) ↔ `secure-link-secret.conf` **지문 일치** 확인 후 실행했다.

> 실행 전 프로브에서 **실제 산출물이 무인증 200 으로 받아졌다**(없는 파일명 프로브는 404 라 미노출로 오인하기 쉽다 — 판별에 실제 파일을 써라).

## 2. ✅ 통지 트랙 종결 (2026-09-11) — 양사 회신 완료, 당사 잔여 0건

통지 2건을 양사에 발신하고 **양사 모두 ACK + 실측 회신**을 받아 종결했다.
발신처: printy `20260911 프린티…`(①) · bookmoa `bookmoa-mobile-48`(①+②) + `20260911 북모아…`(①+② 재송).
bookmoa 종결 커밋 `836acb2`. printy 레포 문서 갱신은 오너 승인 후 진행 지시 전달 완료.

> **크로스세션 전달 경로 실증**: `msg_id` 는 발신 성공일 뿐 도달 증거가 아니다. **ACK 를 본문에 명시 요청 + `notify_when_idle`** 조합으로 양사 회신을 받아 도달·처리·수신측 bypass 를 모두 확인했다(§5 규칙).

### ① D5 — printy 교차검증 종결

printy 라이브 실측: `/storage/outputs/<임의 uuid>` → **410**(헤더 3종) · `/storage/outputs/probe/cover.pdf` → **410** /
[대조군] `/storage/uploads/`·`/storage/designs/` → **404**(경로 생존) · `/api/health` → 200.
printy 의존 재감사(R-166~R-170 유입 68파일 반영, 8/28 결과 재사용 없이 재실행): 무인증 outputs 직접 GET **0건**,
`proxy-download.js` 가 매 다운로드 `external/{jobId}/output-url` 재발급, `order_asset_claims` 에 URL 아닌 **jobId** 저장 → 지연 구간 무영향.

> 🔑 **재현 시 반드시 가져갈 두 가지**
> ① **대조군 없이는 결론이 안 선다** — 410 단독으로는 "전면 차단" 과 구분되지 않는다. uploads/designs 404 가 있어야 폐쇄 범위가 outputs 한 갈래임이 증명된다
> ② **임의 id 프로브는 "없는 파일도 410" 까지만 증명한다.** "실제 산출물도 410" 은 당사가 실파일로 확인한 분이 커버한다(§1 의 실사고 — 실제 산출물은 무인증 200 인데 없는 파일명은 404 라 미노출로 오인할 뻔함). **두 실측 합산으로 완결.**

### ② bookmoa 401 별건 — 코드상 파손은 사실, 그러나 진행 중 장애 아님

`proxy-download.js:100` 이 `/worker-jobs/{id}/output` 을 `X-API-Key` 로 호출. 이 라우트는 전역 `JwtAuthGuard`
(`auth.module.ts:48`) 아래 `@Public`·`ApiKeyGuard` **둘 다 없어**(`worker-jobs.controller.ts:623`) 유효 키로도 **401**.
bookmoa 소스 전수 대조로도 확인됨 — `worker-jobs` 호출 6건 중 이 한 곳만 non-external.

**당사 서버로그 실측이 긴급도 전제를 뒤집었다** (`storige-api` 수명 2주, request 1,497건):

| 라우트 | 총 호출 | 실제 UUID |
|---|---|---|
| `/api/worker-jobs/{id}/output` (문제의 라우트) | 4 | **0** (전부 당사 합성 프로브) |
| `/api/worker-jobs/external/{id}/output-url` (정상) | 9 | 3 (실제 가동 중) |

로그 신뢰성 대조: `external/{id}/status` 87 · `external/{id}` 49 · `multipart/sign` 53 · `download/external` 18 · `shop-session` 19 → 샘플링 아님.
프록시가 당사를 직접 호출하므로 고객 시도가 있었다면 실패해도 **실제 UUID + 401** 이 남는다. 0건 = **시도 자체가 없었다.**
bookmoa DB 교차: jobId 보유 주문 **전 기간 0건** → 결과 PDF 다운로드 버튼(`resultJobId` 조건부 렌더)이 **한 번도 뜬 적 없다.**

**→ 핫픽스 아님. `R-172` 개설(bookmoa) · 조사 완료 · 코드 미착수 · ⓐ안 확정 · 착수 시점은 오너가 나중으로 미룸. 당사 변경 없음.**
bookmoa 인계문 `docs/SESSION-HANDOFF-2026-09-11.md` 에 ⓐ안 근거와 **서명식이 uri 만 덮어 `?filename=` 이 인젝션 벡터**라는 점까지 담겼고,
**착수 시 당사에 통보**하기로 합의됨. (별건 R-171 도달 불가 코드 정리는 bookmoa `cbfcc71` 로 완료.)

### 🔍 파생 발견 — 합성 잡 3개월 공백 (플랫폼 전체) ⚠️ D6 에 영향

API 로그(2주): `compose-mixed` 0 · `synthesize/external` 0 · `synthesize` 0 · `render-pages` 0 · `split-synthesis` 0 / `validate/external` 42.
`worker_jobs` 전 기간:

| job_type | 건수 | 최종 |
|---|---|---|
| VALIDATE | FIXABLE 105 · COMPLETED 67 · FAILED 50 | **2026-09-09** |
| CUTOUT | COMPLETED 28 | 2026-08-18 |
| RENDER_PAGES | COMPLETED 9 | 2026-08-14 |
| CONVERT | COMPLETED 3 | 2026-07-13 |
| **SYNTHESIZE** | COMPLETED 10 · FAILED 2 | **2026-06-13** |

⚠️ `WorkerJobType` enum 은 **5종뿐**(VALIDATE·CONVERT·SYNTHESIZE·RENDER_PAGES·CUTOUT)이고
compose-mixed·split·spread 가 **전부 SYNTHESIZE 로 기록**된다 — 위 행이 합성 전량이다(다른 타입으로 쌓였는지 재조사 불요).

> **원인 확정 = ⓐ 미도달, 결함 아님.** `triggerSynthesis` 첫 줄이 `if (!s?.sessionId) return` 조기 반환인데
> bookmoa 편집기형 주문이 0건이라 **트리거 조건이 발생한 적이 없다**. SYNTHESIZE 는 과거 10건 COMPLETED 이력이 있어 기능은 살아 있다.
> 🚨 **D6 백필·파일 보존 트랙이 "합성 트래픽이 있다" 를 암묵 전제한다면 이 공백을 먼저 반영해야 한다.**

### 편집기 진입은 살아 있으나 완료는 전부 내부 계정 (사업 관찰, 결함 아님)

`file_edit_sessions` × site: **bookmoa-mobile 62건**(2026-06-02~**09-02**, editing 30·draft 17·complete 15) ·
북모아 메인 32 · ShareSnap 19 · NULL 4 · Default 1. bookmoa mode = cover 56 · both 4 · content 2.

`member_seqno` ↔ bookmoa 계정 대조표(그쪽 제공, `deriveMemberSeqno` 가 UUID 결정적 해시라 역매칭 가능):

| member_seqno | 분류 | 세션 | complete |
|---|---|---|---|
| **1607115440** | **내부(관리자)** | **51** | **15 (전부)** |
| 1049737389 | 내부(편집 테스터) | 4 | 0 |
| 715702419 | 내부(storige) | 1 | 0 |
| 615976994 · 1375921922 · 49385800 | 외부 가능 | 3 · 2 · 1 | **0** |

> **편집 완료 15건은 100% 내부 관리자 계정.** 나머지 3계정도 6세션 전부 `editing`(complete·draft 0).
> → **R-173(완료 이벤트 유실) 개설 불요.** 62 vs 49 교집합도 불요(②에서 종결).
> ✅ **최종 확정(bookmoa 오너 확인)**: "외부 가능" 3계정은 **전부 지인 테스트**다.
> → **실외부 고객의 편집기 진입·완료가 모두 0건** = 결함이 아니라 **오픈 전 상태 그대로**. 사업 관찰 항목도 닫힌다.
> 단 **진입 경로 자체는 2026-09-02 까지 생존**한다는 관측은 유효하다(기능은 살아 있고 실고객이 오지 않았을 뿐).
> 원장 표기 정본: **"외부 사용자 진입 0건(6세션은 전부 지인 테스트)"**

### 🚨 판정축 함정 — 이 트랙 최대 수확 (4회 발생·5회차 미수)

귀속은 적지 않는다(한쪽은 주문 도메인, 한쪽은 세션 스키마를 본다 — 자기 테이블이라 먼저 본 것뿐). 규칙만 남긴다:

- **jsonb `?` 는 값이 아니라 키를 센다** — `{sessionId: null}` 을 명시적으로 박는 코드가 있으면 키-존재 판정은 전부 무효. `non_null_value` 를 같은 쿼리에
- **`IS NOT NULL` 은 NOT NULL 컬럼에서 무의미하다** — 항상-NULL(`worker_status`: 118행 전부 NULL)도 항상-채움(`order_seqno`: `Null=NO`, 118/118, 센티널 0)도 판정력이 없다
- **컬럼을 판정축으로 삼기 전에 nullability·센티널(`=0`·음수)·전 모집단 분포부터 본다**
- **단일 컬럼으로 '0' 이나 '전부' 를 주장하지 말고 대조군(값이 잡히는 다른 필드)을 같은 쿼리에 넣는다**
- **폴백 기본값을 완료 지문으로 읽지 마라** — `status:'edited'` 는 완료가 아니라 주문 생성 시점 기본값이었다. **상태 문자열은 "그 값을 누가 언제 쓰는가" 를 코드에서 확인한다. 이름이 의미를 보장하지 않는다**
- **내 도메인이 아닌 테이블의 축을 남에게 제안할 때는, 상대가 스키마를 확인해 주기 전까지 결론을 쓰지 않는다**

> 양측 원장에 동일 규칙으로 고정(bookmoa `836acb2`).
> **성과 요약**: D5 통지 1건에서 시작해 **존재하지 않는 장애 2건**(합성 PDF 다운로드 파손 · 편집 완료 유실)을 로그와 DB 로 각각 걷어냈다. 한쪽 관측면만 있었으면 둘 다 긴급 트랙이 됐다.

### 📐 서명 URL 전환 설계 쟁점 (bookmoa 제기, 사실 확인 완료) — 당사 향후 작업 대비

| 쟁점 | 판정 |
|---|---|
| 스트리밍 ≤2GB·메모리 버퍼링 | **해소.** `location /storage-signed/outputs/` 가 `alias` 로 파일 직접 서빙 — nginx sendfile·Range. 현행 프록시보다 개선 |
| `Content-Disposition` 파일명 | **쟁점 성립.** 서명 경로는 `private, no-store`·`nosniff`·CORS 만 붙이고 **Disposition 미설정**(nginx.conf 실확인) |

선택지 ⓐ 프록시 유지 + 업스트림만 교체(**확정**, 회귀 위험 최소) / ⓑ 302 리다이렉트(파일명 = URL 경로명, PDF 인라인) / ⓒ 당사 Disposition 지원 추가.
> 🚨 **ⓒ 착수 시 필수 주의**: 서명식이 `md5("<expires><uri><secret>")` 로 **uri 만 덮는다.** `?filename=` 단순 반영은
> **무서명 파라미터를 헤더에 반영**하는 인젝션 벡터다. 파일명을 서명 대상에 포함하거나 엄격 화이트리스트 sanitize 선행 필수.
> (bookmoa 는 이미 Disposition 조립 시 CRLF·따옴표·제어문자를 제거한다 — H-4. ⓒ를 하면 당사도 동급 필요.)

## 3. 잔여 작업

**P0 — 오너 액션**
1. ~~위 §2 통지 2건 발신~~ **✅ 종결**(§2) — 양사 발신·ACK·실측 회신 완료. **당사 잔여 0건**
2. 파트너 회신문 **미발송 5건**: ⓐ 8/24 통지 4종 + ⓑ 프린티 템플릿셋 스코프
   (~~ⓒ new.bookmoa.com~~ = 발송 완료·파트너 회신 수신 08-27·트랙 종결 / ~~ⓓ 프린티 업로드 테넌시~~ = 세션 채널 전달 완료 08-28, 보안 채널 공식 발송만 잔여 — **08-28 정본 §2 의 "4종" 은 과대 계상이었다**)
3. 동화책 왕복 실기 1회로 묶음 해소: 재진입 유지 확인 + `window.__storigeLoadProfile.laps` 의 `grow:*` 캡처(읽기 전용) + bookmoa 장바구니 #1 테스트 항목 삭제

**P1 — 코드**
4. ~~canvas-core 기준선 마감~~ **✅ 2026-09-11 완료** — `PATH="/opt/homebrew/opt/node@22/bin:$PATH" pnpm --filter @storige/canvas-core test` → **54파일/623 PASS**, 기대치 정확히 일치(수집 수 대조 완료, 증발 0). 재실측 시 같은 PATH 고정 필수
5. ~~P1-5 잔여 1파일~~ **✅ 2026-09-11 완료 — 단, 편입이 아니라 제거로 닫았다**(`25ff568`)
   - 지시대로 `tsconfig.eslint.json` include + lint 글롭에 `storage/test` 를 넣어 보니, 유일한 `.ts` 인 `generate-fixtures.ts` 가 `apps/worker/test/fixtures/pdf/generate-fixtures.ts` 와 **바이트 동일한 사본**(`diff` 무차이)이고 **참조처 0건**이며 api 에 없는 `pdf-lib` 를 import 한다(파일 헤더 스스로 worker 에서 실행하라고 적고 있다)
   - 편입하면 린트는 0err 이지만 `tsc --noEmit -p tsconfig.eslint.json` 이 **TS2307 로 깨진다** — `eslint.config.js` 주석에 "린트 대상 == tsconfig 프로그램, tsc EXIT=0" 으로 기록된 불변식을 무너뜨린다(CI 게이트는 아니지만 진단 명령이 상시 빨강)
   - 오너 결정으로 **사본 삭제 + 범위 추가 원복**. 사각지대가 원천 소멸하고 불변식도 유지된다. 픽스처 PDF·README 무접촉
   - 재발 방지 주석을 `apps/api/eslint.config.js` 에 남겼다 — **`storage/test` 를 include 에 다시 넣지 말 것**
6. ~~`.env.example` 에 `OUTPUT_*` 3키 등재~~ **✅ 2026-09-11 완료** — 루트 `.env.example` + `apps/api/.env.example` **양쪽**에 값 없이 등재
   - compose 매핑(`docker-compose.yml:52-54`)은 이미 있었다 — 누락은 템플릿뿐이었고, 그 상태로 신규 환경을 세우면 발급 API 전건 503 이 맞았다
   - `secure-link-secret.conf` 동일값 필수(불일치 = 발급 200/회수 전건 403)를 주석으로 명시
7. ~~CONTRACT_FREEZE 에 S3 A안 등재~~ **✅ 2026-09-11 완료** — `docs/CONTRACT_FREEZE.md` **v1.3**, 신설 §1-C-1
   - `firstFinalize` 게이트를 **FROZEN(보안 계약)** 으로 명문화. 제거 시 소급 하이재킹 벡터 재개방이라는 근거와 `presigned-upload.service.ts:415-424` 라인, 고정 스펙 T6 을 함께 적었다
   - Bearer 옵션 소비는 ADDITIVE, 스탬프 근거의 유일성(서명 검증된 JWT 뿐)은 FROZEN 으로 3행 등재
   - §4.3 스테일 정정 완료: D1·D3·D4 는 8/28 승인·집행 완료, 잔여는 D6 착수 시점뿐. 백필 41건/NULL 225건이 8/28 실측 후 재실측 없음도 등재
8. ~~FontPlugin A-1(동일 CSS 재기입 스킵)~~ **✅ 2026-09-11 저녁 완료** — `packages/canvas-core/src/plugins/FontPlugin.ts` `createFontCSS`
   - 기존 `<style id="dynamic-font-faces">` 의 `textContent` 가 새로 만든 `code` 와 동일하면 재기입도 정착 대기(rAF+300ms)도 건너뛴다. 호출처는 **생성자 1곳뿐**(`:133`)이라 스킵이 실제로 걸리는 건 같은 폰트 목록으로 FontPlugin 이 재생성될 때다(에디터 재초기화·StrictMode 이중 마운트)
   - ⚠️ **스킵 검사는 `fontUrlByName` 을 채우는 forEach 뒤에 둔다.** 앞으로 올리면 새 인스턴스의 URL 맵이 빈 채 남아 `_getWoff2FontUrl` 이 CSSOM 폴백으로만 돈다. 회귀 테스트 ③(`FontPlugin.fontCss.test.ts`)이 이 순서를 고정한다
   - 300ms 는 CSS 파싱을 기다리던 패딩이었다 — 실제 폰트 로드 완료 판정은 뒤따르는 `preloadEssentialFonts` 의 FontFaceObserver 가 따로 한다
   - 지시대로 착수 게이팅에 `grow:plugins` 수치를 쓰지 않았다(생성자에서 await 없이 호출돼 rAF+300ms 가 그 lap 에 미계상)
9. (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭
10. ~~(P2) `apps/editor`·`apps/admin` 의 `engines.node`(24.x) ↔ 실검증 런타임(26) 불일치~~ **✅ 2026-09-11 저녁 종결 — 조사 결과 변경 없음이 정답. `24.x` 를 넓히지 마라**
   - CI 실측: `.github/workflows/ci.yml` `setup-node: node-version: 24`. **선언 3곳(root `>=24`·editor `24.x`·admin `24.x`)이 CI 와 이미 정합**이다 — 정합시킬 불일치가 없다
   - 🚨 **`24.x` → `>=24` 완화는 금지.** Vercel 은 범위를 newest-first 로 intersect 해 **가용 최신 메이저를 자동 채택**한다(공식 문서 실확인: `>=20.0.0` → latest **24.x**). 개방 범위로 두면 Vercel 이 26.x 를 추가하는 날 프로덕션 빌드가 **무단 승격**된다. 이 고정은 `58a5166` 이 의도적으로 건 자물쇠이고 근거 정본은 `NODE24_UPGRADE_AUDIT_2026-07-30.md:63`. **경고를 없애려고 이걸 푸는 게 이 항목의 함정이다**
   - root `>=24` 는 Vercel 이 **읽지 않는다**(rootDirectory=`apps/editor` 에서 처음 만난 package.json 하나만 보고 멈춘다 — 같은 감사 `:94`). 로컬·CI 전용 선언이라 완화·고정 어느 쪽도 배포 영향 0
   - **경고의 정체는 이 맥이다.** Cellar 실측: 실제 설치본은 `22.22.2` · `25.1.0` · `26.5.1` 뿐이고 **Node 24 는 없다**. `/opt/homebrew/opt/node@24`·`node@25`·`node@26` 은 전부 `node` 포뮬러의 **별칭 심링크**라 셋 다 `Cellar/node/26.5.1` 을 가리킨다(§0 의 함정은 링크 파손이 아니라 Homebrew 별칭 동작이다). 즉 경고는 잡음이 아니라 **참인 신호** — "이 레포가 고정한 런타임이 아닌 것으로 돌고 있다"
   - [대조군] 기본 Node 26 으로 canvas-core 를 돌리면 `vitest.setup.ts` 프리플라이트가 **55파일 전부 하드 실패**(node-canvas ABI). node@22 고정 제약은 현재도 유효하다
   - 경고를 실제로 없애려면 로컬에 **진짜 Node 24 를 설치**(`brew install node@24`)하거나 `.npmrc` 에 `use-node-version` 을 거는 수밖에 없다 — 둘 다 개발환경 변경이라 **오너 결정 사항**(미실행)
   - 덤: Node 20 폐기(2026-10-01, D-19) 대응의 Vercel Settings 이중화(감사 `:87`)도 **이미 닫혀 있다** — `vercel project ls --update-required` → "No projects found ... using a deprecated Node.js version"(읽기 전용 실측)

**D6 (cutover 관측 후 착수)**: NULL-파괴 게이트 + 이원 정책 allowlist 승격 + 백필.
⚠️ 백필 41건/NULL 225건은 **2026-08-28 실측치** — 이후 재실측 없음. 집행 전 4수치 재실행 필수.
설계안 §2-B' 단서대로 "해당 파트너의 기존 회수가 자기 키로 이뤄지는지" 관측이 **백필보다 선행**.

**P2 백로그**: bookmoa 구 프로젝트 폐기 시 allowlist 구 오리진 제거 / 업계표준 R6·R10·R3b / 파일 보존 P1·P2(D6 백필과 교차) / 멀티테넌시 P3b(`.claude/worktrees/multitenancy-p3b`, `docs/p3b-handoff` 브랜치 — 클린, origin/master 대비 154 behind) / 포토북 S2 / ⓑstage1b·Bull attempts·BQ-03·히스토리 정화 force-push

**오너 결정 대기**: 동화책 caseBind · cover VALIDATE 경고 처리 정책(`SPINE_PARAMS_UNRESOLVED` 는 현재 비차단 로그 경로) · G-6 백필 · **branch protection(master 무보호 확정 — `gh api` 404)** · 폰트 시딩(0건) · D6 착수 시점

## 4. 문서 정합성 — 08-28 정본 대비 정정된 것

| 항목 | 08-28 정본 | 실제 |
|---|---|---|
| D5 | "9/4 실행만 남음" | **9/11 실행 완료**(7일 지연) |
| HEAD | `990b418` | 자기 자신 커밋 미반영 — 당시 실제는 `39b787c` |
| P0-1 미발송 | 4종 | **5건**(ⓐ4+ⓑ1), ⓒ·ⓓ 는 종결/부분종결 |
| P1-5 lint | ✅ 완료 | **부분 완료였다** → 09-11 종결. 잔여 1파일이 worker 정본의 **바이트 동일 사본**이라 편입이 아니라 **제거**로 닫음 |
| R-149 | "코드 변경 불요" | **라우팅 감사만 근거, 라이브 실측 미수행**이었다. 실측 결과 라우트는 401 이 맞으나 **실호출 0건**이라 진행 중 장애는 아님(§2) |
| nginx 배포 | `up -d nginx` | **`up -d --force-recreate nginx`**(파일 bind-mount inode) |
| canvas-core 런타임 | "Node 22/24" | 이 맥에서 **22 전용**(node@24 링크가 26) |
| 채널 | `bookmoa-mobile-65` / `20260827 Printy 개발 계속` | 이름은 같은 날에도 바뀐다 — **`ListAgents` 만으로는 cwd 를 알 수 없다**(§5 의 확증 절차 필수) |

또한 설계안 `TENANCY_S3_S4_DESIGN_2026-08-28.md` 는 두 곳이 실제 구현과 어긋난 채 남아 있다(정정 안 함, RESUME 쪽이 정본):
`:60` "`/storage/outputs/` 를 분리해 secure_link" → 실제는 **별도 프리픽스 `/storage-signed/outputs/` 신설** / `:72` 라우트명 → 실제는 `external/:id/output-url`.

## 5. 양사 세션 채널 가이드

- **bookmoa**: cwd `~/Developer/claude/bookmoa-mobile` / **printy**: cwd `~/Developer/claude/printy`
- ⚠️ **2026-09-11 종료 안내**: bookmoa 세션 `20260911 북모아…` 는 종료됐다. 이후 연락은 **새 세션 또는 `bookmoa-mobile-48`** 로 — 단 이름은 재시작 시 바뀌므로 아래 확증 절차를 매번 거쳐라
- ⚠️ **세션 이름은 재시작 시 바뀐다** — `ListAgents` 로 cwd 기준 재식별. 이름은 같은 날 안에서도 바뀐다(09-11 오전 `bookmoa-mobile-2f`·`printy-bf` → 오후 `bookmoa-mobile-48`, printy 소멸)
- 🚨 **`ListAgents` 는 cwd 를 보여주지 않는다.** 이름만 보고 찍지 말 것. 실제 식별법(2026-09-11 사용):
  ```bash
  # 1) 후보 트랜스크립트 = 디렉터리명이 곧 cwd, mtime 이 ListAgents 의 "started N ago" 와 맞물리는 것
  ls -lt ~/.claude/projects/-Users-yohan-Developer-claude-printy/*.jsonl | head -2
  ls -lt ~/.claude/projects/-Users-yohan-Developer-claude-bookmoa-mobile/*.jsonl | head -2
  # 2) 확증 — jsonl 안의 cwd 필드 + 첫 사용자 메시지가 세션 이름과 대응하는지 대조
  python3 -c "import sys,json;[print(d.get('cwd')) for l in open(sys.argv[1]) for d in [json.loads(l)] if d.get('cwd')][:1]" <파일>
  ```
  ⚠️ mtime 상관만으로 끝내지 마라. **jsonl 의 `cwd` 필드 + 첫 사용자 메시지** 까지 봐야 이름↔cwd 가 1:1 로 묶인다
  (2026-09-11 실사용: 프린티 세션 첫 메시지 "마지막 세션에서 작업한 내용을 요약" ↔ 이름 "…작업 요약" / 북모아 "마지막 세션 작업을 확인" ↔ "…작업 확인")
- ⚠️ **이름 오인 함정(2026-09-11 실사례)**: peer 목록의 `printcard-studio-fd` 는 cwd `~/Developer/claude/PrintCard-Studio` 로 **printy 가 아니다**(별개 프로젝트). 여기에 파트너 통지를 보내면 오발신이다
- ⚠️ **크로스세션 권한모드 함정**: 수신 세션이 bypass 가 아니면 피어 메시지가 승인 보류로 지연. **발신 성공(msg_id) ≠ 도달.** 무응답이면 오너에게 모드 확인 요청
- ✅ **2026-09-11 실증**: printy 가 ACK+실측 회신 → 경로 정상·수신측 bypass 확인. 실무 규칙은 "**메시지에 ACK 한 줄을 명시 요청**하고 `notify_when_idle` 을 함께 건다" — 회신만이 도달 증거다
- 레포 정본: `docs/partner-notices/` · `docs/PLATFORM_INTEGRATION_GUIDE.md` · `docs/CONTRACT_FREEZE.md`
- 8/28~9/11 파트너 측 변화 **0건**(양 레포 storige 연동 파일 무변경, 문의·불만 0건)

## 6. 새 세션 시작 체크리스트 (순서 고정)

1. `CLAUDE.local.md` 먼저(호스트·레시피·§5.5 Cloudflare — 값 출력 금지)
2. 이 문서 + `git log --oneline -10` + `git status -sb`(타 세션 미커밋 보존)
3. SSH 필요 시 `ssh-add -l` → 없으면 `ssh-add ~/.ssh/id_ed25519`. `deploy@` 대상만(fail2ban)
4. 함정 상기: **nginx 파일 bind-mount inode(§0)** / **node@24→Node26(§0)** / vite.config.js shadow / 빌드게이트 5함정 / fabric styles·loadJSON / SPREAD≠표지 / isInitializedRef 저장 입구 금지 / **debounce 는 배칭 도구 아님** / **supertest 포트 패밀리**(불가능한 응답=남의 서버 의심) / 크로스세션 권한모드
5. 검증 기준선 = §0 표. 실기·프로덕션 키 작업은 권한무시 모드
6. 세션 종료 시 `RESUME_PROMPT_<날짜>.md` 갱신 없이 종료 금지

---

## 7. 2026-09-11 오후 세션 로그

**커밋 8건**(전부 push 완료, origin/master = 로컬 master). VPS `~/storige` 는 `94edb89` 유지 — 문서·템플릿뿐이라 **재배포 불요**, 다음 API 배포 때 자연 동기화.

### 한 일

| # | 내용 | 결과 |
|---|---|---|
| 1 | 통지 2건 양사 발신 (§2) | **트랙 종결** — 양사 ACK + 실측 회신 |
| 2 | P1-4 canvas-core 기준선 실측 | 54파일/623 PASS, 기대치 일치 |
| 3 | P1-5 `storage/test` 사각지대 | **편입이 아니라 중복 사본 제거로 마감**(오너 결정) |
| 4 | P1-6 `.env.example` OUTPUT_* 3키 | 루트·apps/api 양쪽 등재 |
| 5 | P1-7 CONTRACT_FREEZE v1.3 | §1-C-1 신설 + §4.3 스테일 정정 |
| 6 | 서브에이전트 세팅 실측 (오너 지시) | §7-1 — 권고 3건 **미실행** |
| 7 | bookmoa 401 별건 규명 (로그·DB) | **존재하지 않는 장애 2건 제거**(§2) |

### 검증 증거 (변경 위험에 비례, 각 1회)

| 검증 | 결과 |
|---|---|
| `pnpm --filter @storige/canvas-core test` (node v22.22.2 고정) | 54파일/623 PASS — 기대치 일치 |
| `pnpm lint` (apps/api) | **0 err / 44 warn** — 기준선 동일 |
| `tsc --noEmit -p tsconfig.eslint.json` (apps/api) | **EXIT=0** — 불변식 복원 |
| api jest | **미실행** — 문서·env 템플릿·미참조 파일 삭제뿐이라 무영향 범위. 다음 세션이 코드를 건드리면 §0 기준선 78스위트/1071 로 대조 |
| 프로덕션 접근 | **읽기 전용만**(docker logs · `SELECT`). 쓰기·재기동·배포 **0건** |

### 다음 세션 진입점

**즉시 착수 가능(오너 승인 불요)** — §3 P1 잔여:
- ~~**8** FontPlugin A-1~~ · ~~**10** engines.node~~ → **둘 다 09-11 저녁 세션에서 종결**(§7-2). 즉시 착수 가능한 P1 잔여는 **0건**이다

**오너 결정 대기**: §3 P0-2 회신문 미발송 5건 · P0-3 동화책 왕복 실기 · D6 착수 시점 · §7-1 권고 3건

**파트너 트랙**: R-172(bookmoa, ⓐ안 확정, 코드 미착수) — **당사 변경 없음**. bookmoa 가 착수 확정 시 알려오기로 함.

> ⚠️ **D6 착수 전 필수**: §2 의 **합성 잡 3개월 공백**(SYNTHESIZE 최종 2026-06-13)을 먼저 반영하라.
> 백필 41건/NULL 225건은 2026-08-28 실측치이고 이후 재실측이 없다 — 4수치 재실행이 선행이다.

### 7-1. 서브에이전트 세팅 실측 (2026-09-11)

| 항목 | 상태 |
|---|---|
| 프로젝트 `.claude/agents/` | **없음** — storige 전용 에이전트 0개 |
| 사용자 전역 `~/.claude/agents/` | **o5-* 7종**(architect·repo-scout·implementer·test-build·security-reviewer·frontend-qa·final-reviewer), 전부 2026-09-11 10:31 일괄 설치 |
| 도구 권한 | 최소권한 적정 — 읽기전용 5종은 Edit/Write 없음, `o5-implementer` 만 Edit+Write, `o5-test-build` 는 Edit(테스트 하네스 한정) |
| `model:` 지정 | **7종 전부 미지정 → 부모 모델 상속**. repo-scout 같은 정찰축까지 Opus 로 도는 비용 구조 |
| 정본 대비 드리프트 | 설치본이 `_ai-governance/.../deployment/agents` 보다 **앞서 있다** — 읽기전용 6종에 "Bash 는 read/inspect 전용(`sed -i`·`tee`·`mv`·`rm`·`git commit` 금지)" 1줄, `o5-test-build` 는 description 강화. **거버넌스 레포에 역반영 안 됨** |
| 미설치 | 정본 `source/.../agents/coordinator.md` — 메인 에이전트가 조정 책임을 지므로 의도적 제외로 보이나 명문 근거 없음 |
| 프로젝트 `.claude/rules/` | **없음**(전역 지침의 3계층 중 ③). 경로 한정 규칙·함정이 전부 이 RESUME 에 몰려 있다 |
| 이번 세션 사용 | **0건** — 전역 지침 "위임 억제" 부합. 파일 소유권이 겹치고 규모가 작아 단독 수행이 옳았다 |

**권고(미실행, 오너 판단)**: ⓐ 읽기전용 축에 `model: sonnet` 지정으로 정찰 비용 절감 ⓑ 설치본의 Bash 제약 1줄을 `_ai-governance` 에 역반영해 드리프트 해소 ⓒ storige 전용 규칙(nginx inode·node@22 고정·supertest 포트 패밀리)을 `.claude/rules/` 로 분리

---

## 7-2. 2026-09-11 저녁 세션 로그

**커밋 2건 — 🚨 미푸시(origin/master + ahead 2).** 푸시가 editor 프로덕션 배포를 트리거하므로 오너 승인 대기(§0).

### 한 일

| # | 항목 | 결과 |
|---|---|---|
| 1 | **P1-8 FontPlugin A-1** | ✅ 구현 + 회귀 테스트 5건. 동일 CSS 면 재기입·rAF+300ms 정착 대기 스킵 |
| 2 | **P2-10 engines.node** | ✅ **무변경으로 종결** — 이미 정합이고 `24.x` 완화는 금지(Vercel 무단 승격 벡터) |

### 검증 증거 (변경 위험에 비례, 각 1회 · `node -v` v22.22.2 고정)

| 검증 | 결과 |
|---|---|
| `pnpm --filter @storige/canvas-core test` | **55파일/628 PASS** — 기준선 54/623 + 신규 1파일/5테스트, 수집 증발 0 |
| `pnpm --filter @storige/canvas-core typecheck` | **EXIT=0** |
| `pnpm --filter @storige/canvas-core lint` | **0 err / 48 warn** — 기준선 동일(초안의 미사용 eslint-disable 1건은 타입 명시로 제거) |
| `pnpm --filter @storige/editor test` | **66파일/785 PASS** — 기준선 동일. 인접면(`createCanvas.pluginOrder` 플러그인 체인) 확인용 |
| [대조군] 기본 Node 26 으로 canvas-core test | **55파일 전부 하드 실패**(프리플라이트) — node@22 고정 제약 유효성 재확인 |
| api jest | **미실행** — 변경면이 `packages/canvas-core/src` 한 파일 + 테스트라 api 무영향 |
| 프로덕션 접근 | **읽기 전용 1회**(`vercel project ls --update-required`). 쓰기·배포·재기동 **0건** |

### 이번 세션이 남기는 함정

- 🚨 **`engines.node: "24.x"` 를 경고 때문에 넓히지 마라** — §3-10. 이 항목은 "고쳐라"가 아니라 "건드리지 마라"로 끝났다. 다음 세션이 같은 경고를 보고 같은 유혹을 받는다
- **Homebrew `node@24`/`node@25`/`node@26` 은 전부 `node` 포뮬러 별칭**이라 현재 Cellar 의 26.5.1 을 가리킨다. 이 맥에 **진짜 Node 24 는 없다**(실측: 22.22.2 / 25.1.0 / 26.5.1). §0 의 "node@24 심볼릭 링크가 26 을 가리킨다"는 파손이 아니라 정상 별칭 동작이다
- **`ignoreCommand` 감시 경로가 앱마다 다르다** — `packages/canvas-core` 는 **editor 에만** 있다. canvas-core 변경 푸시 = editor 만 재배포(admin 스킵). 푸시 영향 판단 시 두 `vercel.json` 을 각각 봐라
- **스킵 최적화는 부수효과 수집 코드 뒤에 둔다** — A-1 의 조기 return 을 `fontUrlByName` 을 채우는 forEach 앞으로 올리면 맵이 빈 채 남는다. 조기 return 을 넣을 때 "그 앞에서 무엇이 채워지는가"를 먼저 본다

### 다음 세션 진입점

- **오너 승인 대기(최우선)**: 이 2커밋 **푸시 여부** — 푸시 시 editor 프로덕션 재배포
- **오너 결정 대기**: §3 P0-2 회신문 미발송 5건 · P0-3 동화책 왕복 실기 · D6 착수 시점 · §7-1 권고 3건 · 로컬 Node 24 설치 여부(§3-10)
- **즉시 착수 가능한 P1 잔여 0건.** 다음 코드 트랙은 D6 이고, 착수 전 §2 "합성 잡 3개월 공백" 반영 + 백필 4수치 재실행이 선행이다
