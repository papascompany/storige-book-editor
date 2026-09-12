# RESUME PROMPT — 2026-09-11

> ⚠️ **최신 정본은 `RESUME_PROMPT_2026-09-12.md` 다(D6-ⓐ 구현).** 이 문서는 9/11 상세 이력 아카이브다. 8/25~8/28 상세 이력(④~⑮)은 `RESUME_PROMPT_2026-08-25.md`, 8/28 세션 종료 상태는 `RESUME_PROMPT_2026-08-28.md`(이력 아카이브) 참조.

## 0. 현재 라이브 상태 (2026-09-11 기준)

- **master = origin/master (2026-09-11 저녁분 전량 푸시 완료, 오너 승인 후 실행).** VPS `~/storige` 는 `94edb89` 유지 — API 재배포 불요
  - 🔧 **2026-09-12 정정**: 이 줄에 원래 `ed21d8b` 가 박혀 있었으나 이후 문서 커밋 9건이 쌓여 낡았다 — **같은 함정의 4번째 발생**이다.
    처방대로 해시를 **지웠다**(갱신 후 HEAD 를 다시 읽는 게 아니라 애초에 자기 해시를 쓰지 않는 것이 해결책). 정확한 HEAD 는 항상 `git log --oneline -5`.
  - 푸시분 = ① FontPlugin A-1(`packages/canvas-core/src`) ② 세션 로그. VPS 동기화 불요는 동일(코드는 editor 번들 전용, API·워커 무관)
  - 배포 결과: **editor · admin 둘 다 Ready**(editor `dpl_7XkDZaKDwZnaBLYAGQFEKUR27Pvd`, alias `editor.papascompany.co.kr`). CI `ci`·`gitleaks` 둘 다 success

### 🚨 ignoreCommand 는 fail-open 이다 — 감시 경로만으로 배포 여부를 예측하지 마라 (2026-09-11 저녁 실측, 예측 오류 1건)

이 세션이 "canvas-core 는 editor 감시 경로에만 있으니 **admin 은 스킵**" 이라고 적었는데 **틀렸다. admin 도 실제로 빌드됐다**(Ready, 27s).
이번 푸시는 admin 의 감시 경로(`./`·types·ui·indesign-import·scripts·lock)를 **하나도** 건드리지 않았다.

양 앱 `ignoreCommand` 의 첫 절이 원인이다:

```sh
if [ -z "$P" ] || ! git cat-file -e "$P^{commit}" 2>/dev/null; then exit 1; fi   # exit 1 = 스킵 안 함 = 빌드
```

- `VERCEL_GIT_PREVIOUS_SHA` 는 **마지막으로 실제 빌드된(Ready) 배포**의 SHA다 — 스킵(Canceled)된 배포는 이 값을 갱신하지 않는다
- Vercel 은 **shallow clone(depth 10)** 으로 받는다. 스킵이 연속되면 그 SHA 가 점점 멀어지다가 클론 밖으로 나간다 → `git cat-file -e` 실패 → **fail-open → 전체 빌드**
- 실측 대조: 마지막 Ready admin 배포 = `e372d8b`, `git rev-list --count e372d8b..ed21d8b` = **10** → 경계 밖. 반면 30분 전 `ef6e192` 빌드는 `$P` 가 도달 가능해 `"Ignored Build Step command returned exit code 0"` 로 정상 스킵됐다(같은 로그에 문자열로 남는다)

> **규칙**: 스킵은 **자기제한적**이다 — 스킵이 약 10커밋 쌓이면 다음 푸시는 감시 경로와 무관하게 빌드된다.
> 따라서 "감시 경로를 안 건드렸으니 배포 안 된다"는 **보장이 아니다**. 배포 영향을 단언하려면 `vercel list <project>` 의 Status/Duration 을 실측해라(3~4초 Canceled = 스킵, 20초+ Ready = 실빌드).
> fail-open 방향 자체는 옳다(판정 불가 시 빌드). 틀린 건 예측이지 설계가 아니다.
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
| canvas-core | **55파일/628 PASS** · lint 0err(48 warn) | ✅ 2026-09-11 저녁 재실측 — A-1 회귀 테스트 1파일/5테스트 편입(종전 54/623, 증발 0). **Node 24.20.0**(22.22.2 에서도 동일 수치로 실측 후 24 로 전환) |
| 플레이크 | **등재 0종** | ✅ 3연속 전체실행 재현 0건 |

> ✅ **런타임 통일 완료(2026-09-11 저녁, 오너 지시).** 종전의 "node@24 링크가 Node 26 을 가리킨다 → canvas-core 는 node@22 고정" 함정은 **원천 해소**됐다.
> `brew install node@24`(24.20.0, keg-only) 로 실포뮬러를 깔자 `/opt/homebrew/opt/node@24` 가 `../Cellar/node@24/24.20.0` 로 교정됐고,
> `canvas` 네이티브 애드온을 Node 24 로 재컴파일해 **로컬 = CI = Vercel = Node 24** 가 됐다.
>
> ```bash
> PATH="/opt/homebrew/opt/node@24/bin:$PATH"   # node -v → v24.20.0. engine 경고 0건
> ```
>
> - ⚠️ **`canvas.node` 는 단일 ABI다.** Node 24 용(ABI 137)으로 바뀌었으므로 **node@22 로 돌리면 이제 반대로 깨진다**(실측: `NODE_MODULE_VERSION 137` vs 127). 22 로 되돌리려면 아래 재빌드를 node@22 에서 다시 하면 된다
> - 재빌드 절차(`pnpm rebuild canvas` 는 **no-op** 이다 — canvas 가 루트 직접 의존이 아니라 아무것도 안 한다):
>   ```bash
>   cd node_modules/.pnpm/canvas@2.11.2_encoding@0.1.13/node_modules/canvas
>   PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx -y node-gyp@10 rebuild   # 소스 빌드, ld 경고만
>   ```
>   재료는 brew 의 cairo·pango·jpeg-turbo·giflib·pixman·pkgconf(설치됨). librsvg 는 미설치지만 선택 의존이라 무관
> - ⚠️ **`pnpm install` 이 canvas 를 재설치하면 ABI 가 되돌아갈 수 있다.** 프리플라이트가 즉시 하드 실패로 알려주므로(조용한 축소가 아니다) 그때 위 재빌드를 다시 돌려라
> - ✅ `node@25` 고아 링크는 **제거 완료**(2026-09-11 저녁). homebrew-core 에 없는 포뮬러였고 `node` 가 25.x 이던 시절의 잔재였다. 현재 opt 링크는 전부 정합: `node`/`node.js`/`nodejs`/`node@26` → 26.5.1(정식 별칭) · `node@22` → 22.22.2 · `node@24` → 24.20.0

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

**→ 핫픽스 아님. `R-172` 개설(bookmoa) · ⓐ안 확정 · ✅ 2026-09-11 저녁 bookmoa 전환·배포 완료(§8). 당사 코드 변경 0건.**
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
4. ~~canvas-core 기준선 마감~~ **✅ 2026-09-11 완료** — 당시 `node@22` 로 **54파일/623 PASS**. 이후 A-1 편입으로 55/628, **그리고 저녁에 런타임을 node@24 로 통일**했다(§0). 재실측은 이제 `PATH="/opt/homebrew/opt/node@24/bin:$PATH"` 고정
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
   - **경고의 정체는 이 맥이었다.** 조사 시점 Cellar 실측: 설치본이 `22.22.2`·`25.1.0`·`26.5.1` 뿐이고 **Node 24 가 없었다**. 즉 경고는 잡음이 아니라 **참인 신호**였다 — "이 레포가 고정한 런타임이 아닌 것으로 돌고 있다"
   - ✅ **해소됨(같은 날 저녁, 오너 지시)**: `brew install node@24`(24.20.0) + `canvas` 재컴파일로 **로컬을 Node 24 로 통일**했다. engine 경고 **0건**, canvas-core 55/628·editor 66/785 전부 Node 24 에서 재실측 통과. 절차·주의는 §0 런타임 절
   - **선언은 끝까지 한 줄도 바꾸지 않았다.** 고친 것은 런타임이지 `engines` 가 아니다 — 이 항목의 핵심은 그대로다
   - 덤: Node 20 폐기(2026-10-01, D-19) 대응의 Vercel Settings 이중화(감사 `:87`)도 **이미 닫혀 있다** — `vercel project ls --update-required` → "No projects found ... using a deprecated Node.js version"(읽기 전용 실측)

**D6 (cutover 관측 후 착수)**: NULL-파괴 게이트 + 이원 정책 allowlist 승격 + 백필.
🚨 **하드 블로커(§8-1, 2026-09-11 확정)**: 게이트가 "잡에 siteId 가 붙는다"를 전제하는데 **파트너 정규 경로에 그 수단이 아예 없다.** bookmoa 잡은 실측상 **전건 NULL** 이다. **해소 전 D6 착수 금지 — 권고가 아니라 차단이다.**
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
| canvas-core 런타임 | "Node 22/24" | 09-11 오전엔 **22 전용**(node@24 링크가 26)이었으나, 저녁에 `brew install node@24` + canvas 재컴파일로 **24 로 통일**(§0). 이제 **22 가 깨진다** |
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
4. 함정 상기: **nginx 파일 bind-mount inode(§0)** / **canvas 단일 ABI — 로컬은 node@24 고정, `pnpm install` 후 재빌드 필요(§0)** / vite.config.js shadow / 빌드게이트 5함정 / fabric styles·loadJSON / SPREAD≠표지 / isInitializedRef 저장 입구 금지 / **debounce 는 배칭 도구 아님** / **supertest 포트 패밀리**(불가능한 응답=남의 서버 의심) / 크로스세션 권한모드
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

**파트너 트랙**: ~~R-172(bookmoa, 코드 미착수)~~ → **✅ bookmoa 전환·프로덕션 배포 완료**(2026-09-11 저녁, §8). 당사 코드 변경 0건. 계약 확인 회신 발신 완료, **ACK 2건 대기**(§8).

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
| 3 | 푸시 + 배포 실측 | editor·admin 둘 다 Ready · CI 2종 success. **예측 오류 1건 적발 → §0 에 fail-open 절 신설** |

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
- **Homebrew 미설치 버전의 `node@N` opt 링크는 `node` 포뮬러를 가리키는 낡은 별칭이다** — 조사 시점 `node@24`·`node@25`·`node@26` 셋 다 26.5.1 이었다. `brew install node@24` 로 24 는 교정됐지만 **`node@25` 는 여전히 틀리다**(26.5.1). `node@N` 경로를 버전 고정에 쓰기 전에 `node -v` 로 실값을 확인해라 — 경로 이름이 버전을 보장하지 않는다(§2 "이름이 의미를 보장하지 않는다"의 런타임판)
- 🚨 **`canvas.node` 는 단일 ABI** — 로컬 런타임을 Node 24 로 통일하면서 재컴파일했다. `pnpm install` 이 canvas 를 재설치하면 되돌아갈 수 있고, 그땐 프리플라이트가 하드 실패로 알려준다. 재빌드 절차는 §0(**`pnpm rebuild canvas` 는 no-op 이다**)
- 🚨 **`ignoreCommand` 는 fail-open** — 감시 경로가 앱마다 다른 건 맞지만(`packages/canvas-core` 는 editor 에만 있다) **그것만으로 배포 여부를 예측하면 틀린다.** 이번 세션이 "admin 은 스킵" 으로 예측했다가 실측에서 뒤집혔다. 기전·판별법은 §0 의 전용 절 참조
- **스킵 최적화는 부수효과 수집 코드 뒤에 둔다** — A-1 의 조기 return 을 `fontUrlByName` 을 채우는 forEach 앞으로 올리면 맵이 빈 채 남는다. 조기 return 을 넣을 때 "그 앞에서 무엇이 채워지는가"를 먼저 본다

### 배포 실측 (푸시 후)

| 대상 | 결과 |
|---|---|
| CI `ci` (Node 24) | **success** — canvas-core typecheck·test·lint 게이트가 CI 런타임에서도 통과 |
| CI `gitleaks` | success (로컬 수동 스캔도 `no leaks found`) |
| Vercel editor | **● Ready**, alias `editor.papascompany.co.kr` |
| Vercel admin | **● Ready** (27s) — 예측은 "스킵"이었다. §0 fail-open 절 참조 |
| 배포본 지문 | `/assets/canvas-core-*.js` 에 A-1 문자열 `폰트 CSS 동일` **1건** + [대조군] 기존 문자열 `폰트 CSS 생성 완료` 1건 → 변경분이 실제로 실렸다 |
| 스모크 | editor `/` 200 · `/embed` 200 · admin `/` 200 · api `/api/health` 200 |

> ⚠️ 엔트리 청크(`/assets/index-*.js`)만 grep 하면 **둘 다 0건**이라 "안 실렸다"로 오판한다 — FontPlugin 은 `canvas-core-*.js` 청크에 있다. **대조군 문자열을 같이 세지 않았으면 이 오판을 못 걸렀다**(§2 판정축 규칙의 재적용 사례).

### 로컬 pre-commit 훅 활성화 (오너 지시, 2026-09-11 저녁)

`core.hooksPath` 가 미설정이라 `.githooks/pre-commit`(gitleaks staged 스캔)이 **비활성**이었다. 이 맥에서 활성화했다:

```bash
git config core.hooksPath .githooks   # --local 스코프. 해제: git config --unset core.hooksPath
```

머신 설정이라 커밋되지 않는다 — **새 클론·다른 머신에서는 매번 다시 걸어야 한다**(훅 파일 주석이 자동 설치를 의도적으로 안 한다고 명시).

양쪽 경로 실증(테스트 파일은 즉시 unstage·삭제, 잔여 0건 확인):

| 경로 | 결과 |
|---|---|
| 스테이지 비어 있음 | EXIT=0 통과 |
| 시크릿 스테이지 | 106 bytes 스캔 · **leaks 2건 · EXIT=1 차단** |

> 🚨 **훅 자가검증 함정**: 첫 시도에 AWS 공식 예시 키 `AKIAIOSFODNN7EXAMPLE` 로 테스트했더니 **통과**했다.
> 훅이 무력한 게 아니라 `.gitleaks.toml` allowlist 의 `(?i)example|placeholder|dummy|sample|test[-_]?key` 가
> 그 키의 `EXAMPLE` 부분을 면제한 것이다. **훅·스캐너 자가검증에 쓰는 가짜 시크릿에는 allowlist 어휘
> (example·placeholder·dummy·sample·test-key·change-me·your-…-here·REDACTED)를 넣지 마라** —
> "차단 실패" 로 오판한다. 판정 전에 allowlist 를 먼저 읽어라(§2 판정축 규칙의 또 다른 사례).

> 참고: `gitleaks` v8.30.1 에서 `protect` 는 `--help` 의 Available Commands 에 **없다**(hidden legacy).
> 그래도 동작은 한다 — 실측에서 staged diff 를 정상 스캔했다(로그의 `0 commits scanned` 는 커밋 카운터일 뿐, `scanned ~106 bytes` 가 실제 스캔량이다). 향후 제거되면 훅을 `gitleaks git --staged` 계열로 옮겨야 한다.

### 다음 세션 진입점

- **오너 결정 대기**: §3 P0-2 회신문 미발송 5건 · P0-3 동화책 왕복 실기 · D6 착수 시점 · §7-1 권고 3건 · 로컬 Node 24 설치 여부(§3-10)
- **즉시 착수 가능한 P1 잔여 0건.** 다음 코드 트랙은 D6 이고, 착수 전 §2 "합성 잡 3개월 공백" 반영 + 백필 4수치 재실행이 선행이다

---

## 7-3. 런타임 통일 (2026-09-11 저녁, 오너 지시 — 커밋 없음, 머신 설정)

P2-10 을 "무변경 종결" 로 닫으면서 남겨둔 **오너 결정 사항 2개를 오너가 집행 지시**해 그대로 실행했다.
**레포 파일은 한 줄도 바뀌지 않았다** — `engines` 선언도, 코드도 그대로다. 바뀐 건 이 맥의 런타임뿐이다.

| 조치 | 결과 |
|---|---|
| `git config core.hooksPath .githooks` | pre-commit gitleaks 활성(§7-2) |
| `brew install node@24` | **24.20.0 keg-only 설치.** `/opt/homebrew/opt/node@24` 가 `../Cellar/node@24/24.20.0` 로 **교정** — 종전 함정 원천 소멸 |
| `canvas` 네이티브 재컴파일 | ABI 127 → **137**. `node-gyp@10 rebuild`, 소스 빌드, ld 경고만 |

### Node 24 재실측 (전부 기준선 일치)

| 검증 | 결과 |
|---|---|
| engine 경고 | **0건**(종전 Node 26 에서 2건, Node 22 에서 3건) |
| canvas-core test | **55파일/628 PASS** — Node 22 실측과 정확히 동일 |
| canvas-core typecheck / lint | EXIT=0 / **0 err · 48 warn** |
| editor test | **66파일/785 PASS** |
| [대조군] node@22 | 이제 **하드 실패**(`NODE_MODULE_VERSION 137` vs 127) — 일방향 전환이 실제로 일어났음을 확인 |

### 남는 함정

- 🚨 **`pnpm rebuild canvas` 는 no-op 이다.** canvas 가 루트 직접 의존이 아니라 pnpm 이 아무것도 하지 않고 조용히 끝난다(출력 0줄). 바이너리 mtime 을 안 봤으면 "재빌드했다"고 오판할 뻔했다 — **명령이 성공했다는 것과 일이 일어났다는 것은 다르다.** 실제 경로는 `.pnpm` 저장소에서 직접 `node-gyp rebuild`(§0)
- **`node@N` 경로 이름은 버전을 보장하지 않는다** — 미설치 버전의 opt 링크는 `node` 포뮬러를 가리키는 낡은 별칭으로 남는다(`node@25` 가 26.5.1 을 가리키고 있었다. 제거 완료). 버전 고정 전에 `node -v` 로 실값을 확인해라
- **`canvas.node` 단일 ABI** — `pnpm install` 후 프리플라이트가 터지면 재빌드 신호다. 프리플라이트가 "조용한 수집 축소" 가 아니라 하드 실패로 설계돼 있어서 이 회귀는 항상 눈에 띈다(2026-08-25 설계 의도가 그대로 작동)
- 이 3건은 전부 **머신 설정**이라 커밋되지 않는다. 새 클론·다른 머신에서는 훅 등록·node@24·canvas ABI 를 각각 다시 맞춰야 한다

### 7-3-1. 인접 프로젝트 영향도 실측 (오너 확인 요청)

위 3개 머신 변경이 `~/Developer/claude` 하위 타 프로젝트에 미치는 영향 **0건**으로 확인했다.

| 변경 | 영향 | 근거 |
|---|---|---|
| `brew install node@24` | 없음 | keg-only → 링크 안 됨. `which node` = `/opt/homebrew/bin/node` → **26.5.1 불변**(설치 로그 "not linked because node is already linked") |
| `node@25` 링크 제거 | 없음 | `~/Developer/claude` 전체 + 셸 dotfile 에 `opt/node@` 하드코딩 **0건** |
| `canvas` ABI 재컴파일 | 없음 | 시스템 전역 `canvas.node` 17개 중 **오늘 mtime 은 storige 것 하나뿐**. 나머지는 2026-03-31 / 06-15 원본 유지 |

> 전파 경로가 애초에 없다: pnpm 전역 스토어(`~/Library/pnpm/store/v10`)에는 **canvas 빌드 산출물이 없다**(스토어는 패키지 소스만 보관, `.node` 는 프로젝트별 생성). 게다가 재빌드를 pnpm install-script 러너가 아니라 node-gyp 직접 호출로 해서 side-effects 캐시 항목도 생기지 않았다.

### 🚨 인접 프로젝트 canvas 인벤토리 — 위 "선재 문제" 서술은 **과장이었다(정정)**

최초 보고는 "인접 프로젝트가 기본 node 로 이미 로드 불가 = 선재 문제" 였다. **판정축 오류다** —
그 프로젝트들이 **선언하지도 않은 런타임**(이 맥의 기본 node 26)으로 재본 결과였다.
각자가 선언한 런타임으로 재판정하니 대부분 정합이다.

| 프로젝트 | 선언 런타임 | canvas | ABI | 판정 |
|---|---|---|---|---|
| `claude/PrintCard Studio` | `.nvmrc 22` · engines `>=22 <23` | 2.11.2 | 127 | ✅ **완전 정합 — 문제 없음**(node@22 로드 성공 실측) |
| `claude/100p_books` | ~~CI 22 · engines `>=20`~~ → **전면 Node 24 정합(오너 지시로 같은 날 집행)** | 2.11.2 | ~~127~~ → **137** | ✅ 아래 §7-3-2 |
| `claude/storywork` | `.nvmrc v25` · engines `>=20` | 최상위 3.2.3 / 중첩 2.11.2 ×11 | 147 / 127 **혼재** | ⚠️ 내부 드리프트(선재) |
| `claude/Tagmanager/shelfsync` | — | 3.2.3 | 147 | 기본 node 26 정상 |
| `antigravity/MD2Books` | — | 3.2.3 | 147 | 기본 node 26 정상 |
| `Bookmoa Storige editor/storige` | node@24 고정(§0) | 2.11.2 | **137** | ✅ 오늘 재빌드분 |

> **갈리는 축은 프로젝트가 아니라 canvas 버전이다: 2.11.2 = ABI 127 · 3.2.3 = ABI 147.**
> 최초 보고가 `Tagmanager/shelfsync`·`MD2Books` 도 "동일 조건 가능성" 이라 했는데 **틀렸다** — 둘 다 3.2.3/147 이다.

**실제로 남는 것 1건(오늘 작업과 무관, 미조치 — 오너 판단)**
- ~~`100p_books`: `.nvmrc` 부재~~ → **해소됨**(§7-3-2). 단 그 진단의 근거였던 "canvas 에서 터진다"는 **틀렸다** — 이 레포는 node-canvas 를 로드하지 않는다(§7-3-2)
- `storywork`: `.nvmrc v25` 가 이 맥에서 **충족 불가**(Node 25 런타임 없음)하고 canvas ABI 가 최상위 147·중첩 127 로 갈려 있다

> ⚠️ **이 맥에는 버전 관리자가 하나도 없다**(nvm·fnm·volta·asdf·n 전부 미설치, `~/.nvm` 없음).
> 즉 **`.nvmrc` 는 이 머신에서 작동하지 않는다** — CI·타 머신에서만 의미가 있고, 여기서는 `PATH` 에 직접 얹어야 한다(storige 가 오늘까지 하던 방식).
> `node@25` 링크 제거는 `storywork` 와 무관하다: 그 링크는 **애초에 26.5.1 을 가리켰고**(Node 25 가 아니었다) 참조도 0건이었다.

> 🚨 **인벤토리 수집 함정(실제 발생)**: ABI 탐지 1차 시도가 **전 항목 "정상"** 으로 나왔다. 불일치 메시지가
> `...using\nNODE_MODULE_VERSION 127...` 로 **줄바꿈을 넘어가** 행 단위 `grep` 이 못 잡은 것이다.
> storige 가 137 이라는 **기준값을 알고 있어서** 걸렀다 — 없었으면 "전부 정상" 으로 오보했다.
> **다중 대상 스캔은 답을 아는 항목 하나를 넣고 돌려라(자가검증 기준값).**

---

## 7-3-2. 100p_books Node 24 전면 정합 (2026-09-11, 오너 지시 — 타 레포)

`papascompany/100p_books` 커밋 2건(`771fd80`·`8b61f4d`, 푸시·CI 통과). **storige 무관** — 여기 적는 이유는 §7-3-1 의 인접 프로젝트 서술이 이 작업으로 낡았기 때문이다.

`engines` 를 `">=20.0.0"` → `"24.x"` 로 고정하고 CI(×3)·`.nvmrc`·`@types/node`(^20→^24)·canvas ABI(127→137)를 24 로 맞췄다.
**프로덕션 런타임은 바뀌지 않았다** — Vercel 이 이미 24.x 였고(개방 범위 자동 채택) 고정은 26.x 무단 승격만 막는다.

### 검증 (Node 22 기준선 대비 전수 대조 + CI 실측)

| 게이트 | Node 22 | Node 24 로컬 | CI(Node 24, linux-x64) |
|---|---|---|---|
| typecheck·lint | 0/0 | 0/0 | success |
| test (vitest) | 19파일 180+1skip | 동일 | success |
| test:pdf | 4케이스 OK | **픽셀 해시 동일** | **OK 4케이스**(linux-x64 베이스라인) |
| build | EXIT=0 | **청크 해시까지 동일** | success |
| e2e / a11y | — | 12 / 25+1skip | success / success |

Vercel 배포 Ready. deprecation 발화 0건. Storige 아웃바운드 TLS(`api.papascompany.co.kr`) Node 24 에서 **200 · TLS1.3 · RSA2048** — OpenSSL seclevel 2 통과.

### 🚨 이 트랙이 남기는 함정 3종

- **`node-canvas` 가 설치돼 있다고 쓰는 게 아니다.** 100p_books 는 `canvas@2.11.2` 를 jsdom 전이 optional 로 갖고 있을 뿐 **로드하지 않는다**. PDF 렌더러는 `@napi-rs/canvas`(**N-API 라 ABI 무관**)다. 증거: ABI 137 canvas 를 둔 채 **Node 26 에서 test·test:pdf 통과**. → §7-3-1 이 "기본 node 로 돌리면 canvas 에서 터진다"고 적은 건 **설치 사실에서 사용을 추정한 오류**였다. **의존성 트리 존재 ≠ 런타임 로드**
- **선재 실패를 회귀로 오인할 뻔했다.** CI 에서 canvas 소스 빌드가 실패한다(`node-pre-gyp ERR! not ok`). Node 24 때문으로 보이지만, **직전 Node 22 런과 실패 라인 수가 12/12 로 동일**하다(ABI 라벨만 `node-v127`↔`node-v137`). canvas 2.11.2 는 127·137 어느 쪽도 prebuilt 를 배포하지 않는다. optional 이라 잡은 통과한다. → **"새 버전에서 실패가 보인다" 면 옛 버전 런의 같은 지점을 먼저 열어라**
- **PDF 베이스라인은 플랫폼별이다.** 로컬 실측은 `darwin-arm64`, CI 는 `linux-x64` 로 **해시가 애초에 다르다**(래스터라이저·폰트 폴백 차이 — 스크립트 주석에 명시). 로컬 통과만으로 CI 통과를 주장할 수 없어 CI 실행이 실질 검증이었다

### 서브에이전트 3종 병렬 (오너 지시, 전부 읽기 전용)

네이티브·의존성 감사 / Node 22→24 파괴적 변경 감사 / 선언 정합성 감사. 소득:
- `engines` 선언 420건 중 **Node 24 배제 0건**(체커를 known-answer 14종으로 자가검증 후 판정 — 0건이 "위험 없음"인지 "체커 고장"인지 구분한 좋은 사례)
- 제거된 Node 24 API 사용처 **0건**. 결제 경로에 암호 서명 검증이 없어(Toss 재조회 방식) OpenSSL 변경 무관
- **`@types/node` 20 잔류**를 잡아냄 — 런타임 24 / 타입 20 은 `tsc` 가 다른 세계를 검증하는 상태. 반영 완료
- 감사가 제기한 **CI 캐시 스테일 ABI 위험은 성립하지 않음**을 위 ① 로 확인 → 불필요한 CI 설정 변경을 막았다

**미조치(오너 판단)**: vitest+jsdom AbortSignal(Node 24, 현재 해당 테스트 0건) · **`next@14.2.35` EOL(2025-10-26) 보안 패치 미수령** — Node 버전보다 이쪽이 더 큰 상시 리스크다

---

## 8. R-172 ⓐ안 전환 완료 — bookmoa 통지 수신 + 계약 확인 회신 (2026-09-11 저녁)

bookmoa 세션이 ⓐ안(프록시 유지 + 업스트림만 `external/{jobId}/output-url` 재발급) 전환을 **프로덕션 배포까지 완료**하고 통지해 왔다(그쪽 커밋 `7d53d55` · vitest 159파일 3773건 · new.bookmoa.com 배포). §2 에 "착수 시 통보하기로 함" 으로 적어 둔 그 통보다.

- 종전: `GET /worker-jobs/{jobId}/output` (X-API-Key) — 전역 `JwtAuthGuard` 아래 `@Public`·`ApiKeyGuard` 둘 다 없어 유효 키로도 401 이던 라우트
- 현행: ① `GET /worker-jobs/external/{jobId}/output-url` 로 서명 URL 재발급 → ② 그 URL 을 **키 없이** GET 해 중계. fileId 모드는 무변경
- **ⓒ안(서명 경로 파일명 지원)은 철회됐다** — `?filename=` 이 무서명 파라미터라 헤더 인젝션 벡터라는 당사 설명에 동의. `Content-Disposition` 은 그쪽 프록시가 RFC 6266 으로 계속 조립한다. **당사 작업 없음**
- 🔴 **실호출 증거는 아직 0건**이다(그쪽이 정직하게 밝힘). 결속된 실 jobId 가 0건이라 실합성 e2e 를 못 돌렸고, 이번 전환은 코드 대조 + 공지 계약 기반이다. 첫 실합성 때 증거가 확보된다 — §2 의 "합성 잡 3개월 공백" 과 같은 뿌리다
- 그쪽이 401·403·5xx 업스트림 실패를 **계측으로 남기기 시작**했다. 종전엔 프록시가 실패를 마스킹해 서버에 흔적이 0이었고 그게 3개월 미발견의 직접 원인이다 — 당사 로그 실측(`/worker-jobs/{id}/output` 실제 UUID 0건)과 일치하는 진단

### 계약 해석 대조 결과 (당사 코드 실대조, 회신 발신 완료)

| 그쪽 해석 | 판정 | 근거 |
|---|---|---|
| `url` 은 오리진 루트 상대 경로 | ✅ 맞음 | `output-url-signer.ts` — `/storage-signed/outputs/…?md5=&expires=` |
| 타 테넌트 404 | ✅ 맞음 | `worker-jobs.service.ts:2377` NotFound(존재 은닉) |
| 만료 410 · 서명 불일치 403 | ✅ 맞으나 **표면이 섞였다** | 410/403 은 **nginx 가 서명 URL GET 에서**, 404 는 **당사 API 가 발급 시점에** |
| `compose-mixed` 기본 `outputMode='separate'` | 🔴 **정정** | 워커 기본은 **`'merged'`**(`synthesis.processor.ts:432` `composeOutputMode \|\| 'merged'`). API 는 `dto.outputMode` 를 그대로 통과(`service.ts:1613`) — **명시 전송 안 하면 `merged.pdf` 1건** |

### 당사가 추가로 통지한 5건

1. **`files[0]` 은 항상 `outputFileUrl`** — `issueOutputUrls` 가 Set 에 `outputFileUrl` 을 먼저 넣는다. separate 모드는 `result.outputFileUrl = contentUrl` 이라 순서가 **[content.pdf, cover.pdf]**. → 그쪽 `merged > content > 첫 번째` 는 **우연이 아니라 구조적으로 모든 모드에서 맞다**(single 모드 `pages.pdf` 가 폴백 경로)
2. **스프레드 책은 `outputMode` 를 `'separate'` 로 강제**(`service.ts:1602-1627`) — `merged` 요청도 2파일이 올 수 있다
3. **400·503 처리 누락** — `400 JOB_OUTPUT_NOT_READY` · `400 JOB_OUTPUT_NOT_SIGNABLE` · `503 SIGNED_URL_NOT_CONFIGURED`
4. **TTL 기본 300초**(최소 30, `OUTPUT_URL_TTL_SEC`) — 매 다운로드 재발급이라 무해, URL 캐시하면 5분 뒤 410
5. 🔴 **D6 예고**: `OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST` 가 켜지면 allowlist 밖 호출자의 **NULL-site 잡은 404**. 현재 미설정이라 통과 중. **D6 착수 전 bookmoa 와 조율 필수** — 그쪽 기존 잡이 NULL-site 면 영향권이다

> 참고: 워커는 산출물에 `type`(`cover`/`content`/`pages`)을 다는데 **서명 응답은 버리고 `{name,url,expires}` 만 낸다.** 그쪽의 "산출물 이름은 동결 계약이 아니다" 판단이 맞다. 안정적 판별자가 필요하면 응답에 `type` 추가가 가능하다(**ADDITIVE, 기존 필드 무변경**) — 필요 여부를 회신 요청했다.

### ACK 수신 완료 (bookmoa `d1fb225` 배포)

| 항목 | 회신 |
|---|---|
| ① `outputMode` | **명시 전송 중** — `body.outputMode \|\| (coverEditable===false ? 'content-only' : 'separate')`. 당사 기본값에 기댄 적 없음. 그쪽 회신의 "기본 separate" 는 **자기 클라이언트 기본값**이라는 뜻이었다(표현이 당사 서버 기본값으로 읽혔던 것) |
| ⑵ 스프레드 강제 | 원장·주석에 등재("merged 요청 = 1파일" 가정 금지) |
| ⑶ 400·503 | **반영 완료** — `JOB_OUTPUT_NOT_READY` → **409 + 재시도 안내**(계측 제외), `NOT_SIGNABLE`·`503` → 계측. 업스트림 본문은 **에러 코드 화이트리스트 대조에만** 쓰고 고객 미노출(내부 경로 유출 차단, 테스트로 고정) |
| ③ 410/403 vs 404 | 분리 반영. **재시도 대신 계측** — 발급 직후 즉시 GET 이라 410/403 은 정상 동작에서 나올 수 없고 시계 어긋남·URL 조립 결함의 **지문**이다. 재시도는 그 지문을 지운다(당사 동의) |
| `type` 필드 | **불필요 — 추가하지 말 것.** ⑴ 의 `files[0]=outputFileUrl` 순서 보장이 결정적이었다. 이름이 전부 빗나가도 첫 폴백이 주 산출물에 떨어지므로 `type` 을 받아도 선택 로직이 나아지지 않는다. 되돌림 방지 주석까지 박음 |

**→ 당사 코드 변경은 이 트랙 전체에서 0건으로 종결.** `type` 추가 요청이 오지 않았으므로 코드 작업은 발생하지 않았다.

---

## 8-1. 🚨 D6 설계 결함 — 게이트의 전제가 파트너 정규 경로와 어긋난다 (2026-09-11, 오너 결정 대기)

bookmoa 가 던진 질문 하나("`X-API-Key` 로 만든 compose-mixed 잡에 siteId 가 스탬프되는가")가 **D6 의 전제를 무너뜨렸다.** 그쪽 예측이 정확했다.

### 실측 — API 키는 이 라우트의 siteId 권위가 아니다

`POST /worker-jobs/compose-mixed` 는 `@Public` + `OptionalShopJwtGuard` 다(contract-freeze 로 `auth:'public'` 동결). `worker-jobs.service.ts:1543 resolveComposeMixedSiteId`:

```
requested = dto.siteId || null
if (!requested)                    → NULL
if (assembled)                     → 채택   ← editSessionId 자동조립(세션 권위)
if (caller?.siteId === requested)  → 채택   ← 검증된 shop-session JWT 와 일치
그 외                               → NULL + WARN 로그
```

| 호출 형태 | siteId | D6 이후 |
|---|---|---|
| `assembleFromSession:true` + shop JWT | 스탬프됨(`session.siteId`) | 무영향 |
| shop JWT + 일치하는 `body.siteId` | 스탬프됨 | 무영향 |
| `X-API-Key` + `body.siteId` | **NULL** + WARN | **404** |
| **`X-API-Key`, `body.siteId` 미전송** ← **bookmoa 실제** | **NULL**, WARN 도 안 찍힘 | **404 — 방금 고친 다운로드가 재사망** |

> ⚠️ **2026-09-11 정정 2건(당사 오류).** bookmoa 가 잡아냈다:
> ① **`editSessionId` 동반 ≠ 자동조립 경로.** 실제 스위치는 별도 플래그 `assembleFromSession === true`(`:1591`)다. 최초 통지가 둘을 동일시해 표 1행을 틀리게 적었다
> ② **WARN 로그 판별법이 bookmoa 케이스에서 작동하지 않는다.** `logger.warn` 은 `:1555` 인데 `requested` 가 null 이면 `:1549` 에서 먼저 return 한다 — **siteId 미전송이면 WARN 이 아예 안 찍힌다.** 있지도 않을 로그를 기다리게 할 뻔했다
> 🔑 **`assembled` 는 siteId 를 만들지 않는다 — 호출자가 준 `dto.siteId` 를 인가만 한다.** 자동조립에서 siteId 가 붙는 건 조립기가 미리 `dto.siteId = session.siteId` 를 채우기 때문이다(`:1480`). 함수명이 `resolve…` 라 "가용 권위에서 도출"로 오독된다 — **이름이 의미를 보장하지 않는다**(§2 규칙의 재적용)

배경은 2026-08-13 테넌트 스탬프 위조 차단이다(`worker-jobs.compose-mixed-site-stamp.spec.ts`). `@Public` 라우트라 `body.siteId` 가 무검증 입력이어서 ① 잡이 임의 테넌트로 귀속되고 ② 완료 시 **그 사이트의 v2 웹훅으로 잡 결과가 배달**되는 취약점이 있었다.
**write 위조는 막았지만, API 키 호출자가 자기 잡에 siteId 를 붙일 수단을 남기지 않았다.** 그 공백이 지금 드러난 것이다.

> 🚨 **D6 하드 블로커**: NULL-파괴 게이트는 "잡에 siteId 가 붙는다"를 암묵 전제한다. **파트너의 정규 호출 경로에 그 수단이 없으므로 게이트만 켜면 정상 파트너가 깨진다.** §2 의 "합성 잡 3개월 공백" 과 성격이 같다 — **암묵 전제를 실측으로 깨야 한다.**
>
> 🔴 **예고가 아니라 진행형 리스크다(bookmoa 지적, 수용).** 첫 실합성이 D6 이후에 일어나면 **고객이 처음 쓰는 순간** 이번에 고친 다운로드가 404 로 죽는다. 그쪽엔 계측(`storige:proxy-download:issue` statusCode 404)으로 보이지만 **고객에겐 "찾을 수 없습니다" 로만 보인다** — 이번 R-172 와 똑같은 "원인이 안 보이는 실패" 모양이다.

### 선택지 (오너 결정 대기 — 당사 미착수)

- **ⓐ** `compose-mixed` 가 **검증된 API 키의 siteId 도 권위로 인정**. ADDITIVE(JWT·자동조립 경로 무변경)이고 위조 차단 원칙도 유지된다(키가 실제 검증된 경우만). **원칙상 정답으로 보이나 `@Public` 라우트의 인증 표면 변경**이라 오너 결정 사항
- **ⓑ** D6 allowlist 에 해당 파트너 영구 등재 — 게이트의 의미가 약해진다
- ~~**ⓒ** 파트너에게 자동조립 경로 사용 요구~~ → **🚫 폐기.** 자동조립 경로는 **검증된 shop-session JWT 를 요구**한다(`:1254` — `!caller?.siteId || !session.siteId || session.siteId !== caller.siteId` 면 throw). **API 키 호출자는 진입 자체가 불가능**하다. `assembleFromSession:true` 를 실어도 JWT 없이는 404 다

**→ 선택지는 ⓐ 또는 ⓑ 뿐이다.**

> **ⓐ 설계 메모**: 단순 "API 키를 권위로 인정" 이 아니라 **검증된 API 키의 siteId 를 채택하되 `editSessionId` 가 있으면 `session.siteId` 와 일치할 때만** 으로 하면, 종전(`body.siteId` 를 그대로 믿던 상태)보다 검증이 한 겹 두꺼워진다. 위조 차단 원칙 유지.

bookmoa 에는 **"계속 대기 · siteId 를 새로 싣지 말 것"** 으로 통지했다(ⓐ 없이 실으면 3행으로 떨어져 달라지는 게 없다).

### ACK 종결 — 갈림길 확정됨

bookmoa 회신: **`editSessionId` 는 두 경로 모두 항상 동반**한다(compose-mixed 분기는 `if (!payload.editSessionId) return 400` 서버 가드까지 있고, synthesize/external 분기는 `triggerSynthesis` 첫 줄 `if (!s?.sessionId) return` 조기 반환 — §2 의 합성 3개월 0건 원인과 같은 코드).
**그러나 `body.siteId` 는 전송 0건**이다(`grep -rn "siteId" api/` 0건, payload 에 키 자체가 없음).
→ **위 표 4행 = bookmoa 실제 호출 형태. 전건 NULL 확정.**

### 부수 확정 2건

- **D6 백필에서 bookmoa 는 제외** — 그쪽 결속 jobId **0건** 확인(주문 49건 중 `synthesisJobId|jobId` 0 · `order_asset_claims` 의 `kind='job'` 0). 과거 SYNTHESIZE COMPLETED 10건은 그쪽 주문과 무관하다. 백필 4수치 재실측 시 이 축은 빼도 된다
- **응답의 `name` 은 항상 비어있지 않다** — `signOutputUrl` 이 빈 세그먼트(`''`·`.`·`..`)를 걸러 `null` 을 반환하므로 이름 없는 산출물은 응답에 실리지 않는다. bookmoa 가 자체 발견한 판정축 결함(`outputName !== null` 로 모드 판정 → 이름 없으면 계측 누락)의 수정 방향 자체는 옳지만(값 유무에 판정을 걸지 않는다 — §2 규칙과 동형), **그 케이스는 당사 응답에서 발생할 수 없다**
