# RESUME PROMPT — 2026-09-11

> **이 문서가 최신 날짜 정본이다.** 8/25~8/28 상세 이력(④~⑮)은 `RESUME_PROMPT_2026-08-25.md`, 8/28 세션 종료 상태는 `RESUME_PROMPT_2026-08-28.md`(이력 아카이브) 참조.

## 0. 현재 라이브 상태 (2026-09-11 기준)

- **master = origin/master (2026-09-11 오후 푸시 완료). VPS `~/storige` 는 `94edb89` 에 머물러 있다 — API 재배포 불요**
  - 푸시분은 문서·env 템플릿·미참조 파일 삭제뿐이라 VPS 동기화가 필수가 아니다. 다음 API 배포 때 자연히 따라온다
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
| canvas-core | **54파일/623 PASS** · lint 0err(48 warn) | ✅ 2026-09-11 실측 — 기대치 정확히 일치(`node -v` v22.22.2 고정) |
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

## 2. ✅ 통지 트랙 종결 — 양사 회신 완료 (파생 관측 1건은 §3 으로 이월)

**2026-09-11 세션 발신 결과 — 양사 전건 발신 완료**

| 수신 | 세션 | msg_id | 내용 |
|---|---|---|---|
| bookmoa | `bookmoa-mobile-48` | `5bf001be…` | ①+② 묶음 |
| bookmoa | `20260911 북모아 마지막 세션 작업 확인` | `cbedf22b…` | ①+② 요약 재송(48 세션 처리 여부 불명 대비) + ACK 요청 |
| printy | `20260911 프린티 마지막 세션 작업 요약` | `31e13d19…` | ① 전문 + ACK 요청 |

3건 모두 `notify_when_idle` 구독.

### ✅ 크로스세션 전달 경로 실증 (2026-09-11)

printy 가 **ACK + 요청 3건 전부 회신**했다. `msg_id` 만으로는 알 수 없던 도달·처리가 실제 회신으로 증명됐고,
수신 세션 권한모드(bypass) 문제도 없음이 확인됐다. **회신이 유일한 도달 증거**라는 원칙은 그대로 유지한다.

### ✅ printy — D5 교차검증 종결

printy 측 라이브 실측(2026-09-11):

| 프로브 | 결과 |
|---|---|
| `/storage/outputs/<임의 uuid>/content.pdf` | 410 + `x-storige-notice` + `no-store` |
| `/storage/outputs/probe/cover.pdf` | 410 (헤더 3종 동일) |
| [대조군] `/storage/uploads/probe.pdf` | 404 (경로 생존) |
| [대조군] `/storage/designs/probe.json` | 404 (경로 생존) |
| `/api/health` | 200 |

> 대조군을 붙인 판단이 정확했다 — **410 단독으로는 "전면 차단" 과 구분되지 않는다.** 폐쇄가 outputs 한 갈래뿐임은 404 대조군이 있어야 증명된다.
> ⚠️ 단 임의 id 프로브는 *"없는 파일도 410"* 까지만 증명한다. **"실제 산출물도 410"** 은 당사가 09-11 라이브에서 실파일로 직접 확인한 분이 커버한다(§1 — 실행 직전 프로브에서 실제 산출물이 무인증 200 이었고 없는 파일명은 404 라 미노출로 오인할 뻔했던 그 구분). printy 에 service_role 키가 없는 건 정상이며 추가 실측 불요 — **두 실측 합산으로 커버리지 완결, 이 건 종결**.

printy 측 의존 재감사(R-166~R-170 동기화 68파일 유입분 반영해 8/28 결과 재사용 없이 재실행):
무인증 `/storage/outputs/` 직접 GET **0건**(grep 히트는 전부 Supabase Storage `/storage/v1/object/...` — 별개 표면) ·
`proxy-download.js` 가 매 다운로드마다 `external/{jobId}/output-url` 재발급 · `order_asset_claims` 에 **URL 아닌 jobId** 저장.
→ 9/4~9/11 지연 구간도 printy 무영향(유예 경로 소비 코드가 애초에 0건).
printy 레포 `docs/SESSION-HANDOFF-2026-08-23.md` 의 "재통지 오면 410 1회 실측" 예약 해제는 **printy 오너 승인 사안**(당사 승인 대상 아님).

### ✅ bookmoa — ACK 수신 + 서버로그 실측으로 ② 긴급도 하향

bookmoa 회신: 키·jobId 미보유로 라이브 실측 불가(시크릿 열람 금지 규칙 준수 — 올바른 판단), 대신 **소스 전수 대조**로 확인.
`worker-jobs` 호출 6건 중 `proxy-download.js` 만 non-external(나머지 5건 전부 `external/*`) — 비대칭이 당사 주장과 정합.
`!upstream.ok` 가 상태코드는 통과시키되 본문을 일반 메시지로 마스킹 → 401 이 "원본 파일을 가져올 수 없습니다" 로만 보인다는 점도 확인.

**🚨 당사 서버로그 실측(2026-09-11) — 통지 ② 의 긴급도 전제를 정정한다**

`storige-api` 컨테이너 전체 수명(약 2주, request 로그 1,497건) 기준:

| 라우트 | 총 호출 | 실제 UUID |
|---|---|---|
| `/api/worker-jobs/{id}/output` (문제의 non-external) | 4 | **0** (전부 당사 합성 프로브 `00000000-0000-4000-8000-…`) |
| `/api/worker-jobs/external/{id}/output-url` (정상 경로) | 9 | **3** (서명 URL 경로는 실제로 돌고 있다 — printy 분으로 추정) |

로그 신뢰성 대조(같은 기간 실트래픽 정상 관측): `external/{id}/status` 87 · `external/{id}` 49 ·
`files/multipart/sign` 53 · `files/{id}/download/external` 18 · `auth/shop-session` 19 → **샘플링·필터링 아님**.

> **결론**: bookmoa 프록시는 당사 API 를 직접 호출하므로, 고객이 jobId 모드 다운로드를 시도했다면 실패해도
> **실제 UUID + 401** 이 로그에 남는다. 2주간 0건 = **최근 2주간 고객의 jobId 모드 시도 자체가 없었다**.
> 통지 ② 의 "고객 다운로드가 이미 파손 상태일 개연성" → **코드상 파손은 사실이나 진행 중인 장애가 아니다** 로 정정.
> 핫픽스 아님. 질문이 "왜 2주간 아무도 안 탔나"(기능 미사용 / 다른 경로 사용 / 프론트 진입 차단)로 바뀐다 — bookmoa 만 답할 수 있다.

~~⚠️ 잔여 불확실성 2건~~ → **둘 다 해소**(2026-09-11 후속 실측):
① `apiBase` — **무의미해졌다.** bookmoa DB 실측 결과 **jobId 가 전 기간 0건**(주문 49건 중 `items[].storige.synthesisJobId|jobId` 보유 0 · `order_asset_claims` 의 `kind='job'` 0/54). 호출할 jobId 가 애초에 없었으므로 apiBase 가 어디든 로그 0건이 설명된다. bookmoa 가 '못 잰 0' 배제를 같은 쿼리에 넣어 검증했다(items 50건 전부 `storige` 키 보유 · fileId 37 → **업로드형은 실사용 중**, jobId 만 0)
  - ⚠️ **정정(2026-09-11 후속)**: 앞서 등재한 "sessionId 37건" 은 **오류였다**. bookmoa 가 자기 판정축 오류 2건을 스스로 잡아 정정했다 —
    ⑴ `status:'edited'` 는 완료 지문이 아니라 **주문 생성 시점 기본값**(`AppContext` 가 미상 status 를 `'edited'` 로 폴백) ⑵ 업로드형이 `{sessionId: null}` 을 **명시적으로 박아** jsonb `?`(키 존재) 판정이 무효
    → 완료 경로에서만 박히는 지문으로 재측정: `lastEditedBy in (customer,admin)` 0 · `editVersion>1` 0 · `savedAt` 0 · `thumbnailUrl` 0 / `coverFileId`+`contentFileId` 둘 다 보유 **37(전부)**
    → **bookmoa 편집기형 주문 0건 · 업로드형 37건**이 정확한 표기다
② 로그 창 2주 — **DB 로 기간 제한 없이 교차 확인 완료**(아래)

> 결과 PDF 다운로드 버튼은 `resultJobId` 가 있을 때만 조건부 렌더된다 → **그 버튼이 한 번도 뜬 적이 없다.** 당사 로그의 "실제 UUID 0건" 과 같은 사실의 양쪽 면이다.

### 🔍 파생 발견 — 합성 잡 3개월 공백 (플랫폼 전체, 원인 미확정)

bookmoa 의 "왜 아무도 안 탔나" 질문을 당사 관측면에서 확인하다 드러났다. **bookmoa 고유 현상이 아니다.**

API 로그(컨테이너 수명 2주): `compose-mixed` **0** · `synthesize/external` **0** · `synthesize` **0** ·
`render-pages` **0** · `split-synthesis` **0** / `validate/external` 42
→ 합성 계열 **전 라우트 0건**. "호출 갔는데 실패" 가 아니라 **호출이 없었다**.

`worker_jobs` 전 기간 교차 확인:

| job_type | 건수 | 최종 |
|---|---|---|
| VALIDATE | FIXABLE 105 · COMPLETED 67 · FAILED 50 | **2026-09-09** |
| CUTOUT | COMPLETED 28 | 2026-08-18 |
| RENDER_PAGES | COMPLETED 9 | 2026-08-14 |
| CONVERT | COMPLETED 3 | 2026-07-13 |
| **SYNTHESIZE** | COMPLETED 10 · FAILED 2 | **2026-06-13** |

⚠️ `WorkerJobType` enum 은 VALIDATE·CONVERT·SYNTHESIZE·RENDER_PAGES·CUTOUT **5종뿐**이고
compose-mixed·split·spread 를 포함한 **모든 합성 변형이 SYNTHESIZE 로 기록**된다 — 위 행이 합성 전량이다.

> **관측 사실**: 합성 잡 마지막 생성 2026-06-13, 이후 약 3개월 0건. 같은 기간 업로드·검증은 9/9 까지 활발.
> **원인 미확정**: SYNTHESIZE 는 과거 10건 COMPLETED 로 정상 동작 이력이 있다(site 스탬프 5건 = 2026-05-03, NULL 7건 = 6/13까지).
> 따라서 "기능이 깨졌다" 가 아니라 **"6월 이후 아무도 트리거하지 않았다"** 가 사실이다.
> ~~ⓐ 오픈 전 미도달 / ⓑ 트리거 미작동~~ → **ⓐ 확정, 결함 아님**(bookmoa 코드 실측):
> `triggerSynthesis` 첫 줄이 `if (!s?.sessionId) return { error: '세션 정보가 없습니다' }` — **조기 반환이라 합성 요청이 나갈 수 없다.**
> 편집기형 주문이 0건이므로 **트리거 조건이 발생한 적이 없다**. 미작동이 아니라 미도달이다.
> ⚠️ D6 백필·파일 보존 트랙이 "합성 트래픽이 있다" 를 암묵 전제하고 있다면 이 공백을 먼저 반영해야 한다.

#### 단, "아무도 편집기에 안 들어왔다" 는 아니다 — 진입점은 살아 있다

bookmoa 가 "진입점 생존은 확인하지 않았다(추정이 되므로 오너 판단)" 로 남긴 지점을 **당사 DB 로 확인**했다.

`file_edit_sessions` × site (전 기간):

| site | 건수 | 기간 | status |
|---|---|---|---|
| **bookmoa-mobile (rot 06-15)** | **62** | 2026-06-02 ~ **2026-09-02** | editing 30 · draft 17 · **complete 15** |
| 북모아 메인 | 32 | 2026-04-28 ~ 2026-06-15 | editing 23 · draft 6 · complete 3 |
| ShareSnap | 19 | 2026-06-13 ~ 2026-08-23 | draft 12 · complete 4 · editing 3 |
| (NULL) 4 · Default Site 1 | | | |

bookmoa-mobile: `completed_at` 보유 **18건** / mode = cover 56 · both 4 · content 2.

> **편집기 진입은 9/2 까지 이어졌고 complete 15건이 있다. 그런데 편집기형 주문 0건 · 합성 잡 6/13 이후 0건** — 사이 어딘가에서 끊긴다.

**후속 실측(2026-09-11) — 끊기는 지점이 좁혀졌다. 그리고 "이탈 15건" 이 아니다.**

| 관측 | 값 |
|---|---|
| bookmoa 세션 62건의 **고유 `order_seqno`** | **62** (1:1) — 그런데 bookmoa 주문 총계는 **49건**(storige 항목 37) |
| **고유 회원(`member_seqno`)** | **6명** |
| **회원 #6 단독** | **51건** (complete **15 전부** · editing 21 · draft 15), 2026-06-03 ~ 2026-09-02 |
| 나머지 5명 | 합계 11건, **complete 0건** |
| complete 15건 | 고유 주문 15개(중복 없음) · `completed_at` 15/15 |

> **① 62 > 49** — 당사 세션의 `order_seqno` 중 최소 13개는 bookmoa 주문에 대응물이 없을 수 있다.
> 그렇다면 이 컬럼은 *확정 주문 참조*가 아니라 **편집기 진입 시 발급되는 선번호(장바구니/임시)** 일 개연성이 크고, 결함이 아니라 이탈이다. 교집합은 bookmoa 만 셀 수 있다(당사가 62개 값을 돌려줄 수 있다 — bookmoa 요청 시).
> **② 완료 모수가 사실상 1** — "고객 15명이 편집 완료했는데 주문이 안 됐다" 가 **아니다.** 한 계정이 3개월간 51세션을 반복했고 complete 15건이 전부 거기서 나왔다. 내부 테스트·운영자 QA 로 읽히나 **계정 정체는 bookmoa 만 안다 — 단정하지 않는다.**
> → **R-173(완료 이벤트 미수신 결함) 개설 근거는 약하다.** 연다면 첫 항목은 "회원 #6 이 누구인가" 여야 하고, 내부 계정이면 트랙이 닫힌다.

🚨 **판정축 함정 — 반대 방향 사례(4번째)**
bookmoa 가 (가)/(나) 판별축으로 제안한 `order_seqno IS NULL` 은 **원리적으로 성립하지 않는다**:
`order_seqno`·`member_seqno` 모두 **스키마 `Null=NO`**, 전 사이트 **118/118 채움**, 센티널(`=0`·음수) **0건**.
그대로 돌렸으면 "전부 채워짐 → 주문 후 편집 완료했는데 미기록 → 결함" 오진이 나왔다.
→ `worker_status`(항상 NULL)와 **정확히 대칭**이다. **항상-NULL 도 항상-채움도 판정력이 없다 — 컬럼을 쓰기 전에 nullability·센티널·전 모집단 분포를 먼저 확인하라.**

🚨 **판정축 함정 재발 방지**: `file_edit_sessions.worker_status` 를 "워커 도달" 지표로 쓰려다 전 사이트로 넓혀 확인했더니
**118행 전부·전 기간·모든 사이트 100% NULL — 한 번도 채워진 적 없는 컬럼**이었다. 판정축에서 뺐다.
bookmoa 가 `sessionId` 를 jsonb 키 존재로 셌다가 잡아낸 것과 **같은 함정**이다.
→ **단일 컬럼으로 0/전부를 주장하지 마라. 같은 쿼리에 대조군(값이 잡히는 다른 필드)을 반드시 넣어라.**

**이번 트랙에서 이 함정이 4번 나왔다** — bookmoa 3회(`status:'edited'` 기본값 오독 / `sessionId` jsonb 키-존재 / `coverFileId`·`contentFileId` 키-존재), 당사 1회(`worker_status` 항상 NULL). 그리고 5번째가 될 뻔한 게 위 `order_seqno` 항상-채움이다.
**jsonb `?` 는 값이 아니라 키를 센다. `IS NOT NULL` 은 NOT NULL 컬럼에서 무의미하다.** 두 문장이 이 트랙의 핵심 교훈이다.

### 🟢 bookmoa — R-172 개설 완료, 당사 잔여 없음

bookmoa 가 원장 **R-172** 로 개설(긴급도 하향 · 진행 중 장애 아님 · 핫픽스 아님 명기). **코드 미착수**, 착수 시점은 bookmoa 오너 결정.
전환 방식은 **ⓐ안 확정**(프록시 유지 + 업스트림만 `external/{id}/output-url` 교체) — 파일명·인라인 표시가 현행과 동일해 회귀 위험 최소.
**확정 전까지 당사 변경 없음.** bookmoa 는 이미 `Content-Disposition` 조립 시 CRLF·따옴표·제어문자를 제거한다(H-4) — ⓒ안을 나중에 하면 당사도 동급 필요.

### ~~🟡 bookmoa 잔여 — 실측 2건은 오너/키 보유 세션 몫~~ (상위 실측으로 대체됨)

ⓐ 구 URL 410 교차실측 ⓑ `GET /api/worker-jobs/<실제 jobId>/output` (유효 X-API-Key) 상태코드.
⚠️ 단 ⓑ 는 **코드 증명이 이미 결정적**이다(전역 `JwtAuthGuard` + 해당 핸들러에 `@Public`·`ApiKeyGuard` 부재 → 유효 키도 무의미).
실측의 가치는 "401 여부" 가 아니라 **고객 영향 baseline** 인데, 그건 위 로그 실측이 더 강하게 답했다.

### 📐 bookmoa 제기 설계 쟁점 — 서명 URL 전환 시 책임 소재 (사실 확인 완료)

| 쟁점 | 판정 |
|---|---|
| 스트리밍(≤2GB, 메모리 버퍼링 회피) | **해소.** `location /storage-signed/outputs/` 가 `alias` 로 파일 직접 서빙 — nginx sendfile·Range 처리, Node 파이프 경유 없음. 현행 프록시보다 개선 |
| `Content-Disposition` 파일명 | **쟁점 성립.** 서명 경로는 `Cache-Control: private, no-store`·`nosniff`·CORS 만 붙이고 **Disposition 미설정**(nginx.conf 실확인) |

전환 선택지: ⓐ 프록시 유지 + 업스트림만 교체(변경 최소, 바이트 1홉 추가) / ⓑ 302 리다이렉트(경유 0, 파일명은 URL 경로명·PDF 인라인 표시 가능) / ⓒ 당사 서명 경로에 Disposition 지원 추가.
> 🚨 ⓒ 주의: 서명식이 `md5("<expires><uri><secret>")` 로 **uri 만 덮는다**. `?filename=` 단순 반영은 **무서명 파라미터를 헤더에 반영**하는 것이라 인젝션 벡터다. 파일명을 서명 대상에 포함하거나 엄격 화이트리스트 sanitize 선행 필수 — **당사 작업·오너 결정 사안**.
> 현 상태 기본 권고는 **ⓐ**.

08-28 정본 §3 이 "중요 통지는 레포 문서 병행이 정본 경로" 로 규정한 그 문서다.

1. `docs/partner-notices/PARTNER_NOTICE_OUTPUT_CUTOVER_DONE_2026-09-11.md` → printy·bookmoa 양사 — **양사 ✅ 발신 완료**
   - 지연 사실(9/4→9/11) 명시본. 양사에 구 URL 410 **교차 실측 1회** 요청 포함(printy 가 8/28 예약해 둔 항목)
2. `docs/partner-notices/PARTNER_NOTICE_BOOKMOA_JOB_OUTPUT_401_2026-09-11.md` → bookmoa 단독 (D5 무관 별건) — **✅ 발신 완료**
   - bookmoa `api/storige/files/proxy-download.js:100` 이 `/worker-jobs/:id/output` 을 `X-API-Key` 로 호출
   - 이 라우트는 전역 `JwtAuthGuard`(`apps/api/src/auth/auth.module.ts:48`) 아래 `@Public`·`ApiKeyGuard` **둘 다 없음**(`worker-jobs.controller.ts:623`) → 유효 사이트 키로도 **401**. 라이브 실측 401 확인
   - 가이드 §3.4 가 2026-08-13 실측으로 이미 명시하던 사실. 8/28 원장 R-149 의 "코드 변경 불요" 는 라우팅 감사 근거였고 라이브 실측 미수행. printy 는 같은 지점을 8/28 에 실호출로 적발해 서명 URL 로 전환함
   - **고객 합성 PDF 다운로드가 이미 파손 상태일 개연성** — bookmoa 측 실측 1회로 baseline 확정 요청

## 3. 잔여 작업

**P0 — 오너 액션**
1. ~~위 §2 통지 2건 발신~~ **✅ 2026-09-11 양사 발신 완료**(§2 표). 잔여는 **회신 수신** — ACK 및 실측 3건(bookmoa 410/401, printy 410)
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
8. FontPlugin A-1(동일 CSS 재기입 스킵, `packages/canvas-core/src/plugins/FontPlugin.ts:669`) — canvas-core 소유권 배정 필요. ⚠️ 착수 게이팅을 `grow:plugins` 수치로 하면 안 된다: `createFontCSS` 가 생성자에서 await 없이 호출돼 내부 rAF+300ms 가 그 lap 에 계상되지 않는다
9. (관찰) 시드 표기 잔여 — 레거시 `/` 경로·게스트 세션 미적용, updatedAt 의미 폭
10. (P2) `apps/editor`·`apps/admin` 의 `engines.node`(24.x)가 실검증 런타임(26)과 불일치 — 매 pnpm 실행마다 Unsupported engine 경고. CI Node 버전 확인 후 정합

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
| P1-5 lint | ✅ 완료 | **부분 완료**(`storage/test` 잔여 1파일) |
| nginx 배포 | `up -d nginx` | **`up -d --force-recreate nginx`**(파일 bind-mount inode) |
| canvas-core 런타임 | "Node 22/24" | 이 맥에서 **22 전용**(node@24 링크가 26) |
| 채널 | `bookmoa-mobile-65` / `20260827 Printy 개발 계속` | 이름 이동 — **`ListAgents` 로 매번 재확인**(cwd 로 식별) |

또한 설계안 `TENANCY_S3_S4_DESIGN_2026-08-28.md` 는 두 곳이 실제 구현과 어긋난 채 남아 있다(정정 안 함, RESUME 쪽이 정본):
`:60` "`/storage/outputs/` 를 분리해 secure_link" → 실제는 **별도 프리픽스 `/storage-signed/outputs/` 신설** / `:72` 라우트명 → 실제는 `external/:id/output-url`.

## 5. 양사 세션 채널 가이드

- **bookmoa**: cwd `~/Developer/claude/bookmoa-mobile` / **printy**: cwd `~/Developer/claude/printy`
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

## 7. 2026-09-11 오후 세션 로그 (이 갱신분)

**한 일**
- bookmoa 통지 ①+② 발신(msg_id `5bf001be…`, `notify_when_idle` 구독) — §2
- P1-4 canvas-core 기준선 실측 마감(54파일/623) — §0 표 갱신
- P1-5·6·7 코드/문서 마감 → 커밋 `25ff568`(로컬, **미푸시**)

**검증 증거 (이번 변경 범위에 비례한 최소 1회)**
| 검증 | 결과 |
|---|---|
| `pnpm --filter @storige/canvas-core test` (node v22.22.2 고정) | 54파일/623 PASS — 기대치 일치 |
| `pnpm lint` (apps/api) | **0 err / 44 warn** — 기준선 동일 |
| `tsc --noEmit -p tsconfig.eslint.json` (apps/api) | **EXIT=0** — 불변식 복원 확인 |
| api jest | **미실행**(문서·env 템플릿·미참조 파일 삭제뿐이라 무영향 범위). 다음 세션이 코드를 건드리면 §0 기준선 78스위트/1071 로 대조할 것 |

**오후 추가분 (오너 지시: 세션 기동 후 발신 + 푸시 + 서브에이전트 점검)**
- printy·bookmoa 신규 세션 식별 확증 후 발신 3건 완료 → **printy 교차검증 종결**(§2)
- 크로스세션 전달 경로 실증 완료(§5)
- **푸시 완료** — origin/master 갱신. VPS 는 `94edb89` 유지(재배포 불요)

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

**다음 세션 최초 2동작**
1. bookmoa 회신 2건(410 교차실측 / jobId output 상태코드) 도착 여부 확인 → §2 닫기 (**§2 잔여는 이것 하나뿐**)
2. VPS `~/storige` 는 `94edb89` — 다음 API 배포 때 자연 동기화. 지금 당길 필요 없음

