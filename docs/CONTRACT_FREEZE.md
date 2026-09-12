# CONTRACT_FREEZE.md — Storige 플랫폼 계약 표면 동결 (v1.4)

> 작성 2026-07-03 · 근거: Phase 0 정찰 5팀(서명·재검증·보안·계약열거·구현준비) + 적대검증 2렌즈(계약 완전성·diff 회귀) 실코드 대조.
> **무중단 원칙 절대**: 파트너 4종(bookmoa-mobile / Sharesnap / 100p_books / MD2Books)이 오늘 프로덕션에서 의존하는 표면은 시맨틱 변경·제거를 금지한다. 위반 변경은 Review Gate에서 오너 승인 없이 착수 금지.
> **v1.1 변경**: 적대검증(FAIL, P0×3)이 잡은 누락 보강 — 업로드 표면 6종+크기 경계, frame-ancestors(死코드 오판정 → FROZEN 격상), 업로드 응답 shape·NOT_S3·content-type 화이트리스트, 100p 재분류.
> **v1.2 추가 (2026-07-28)**: **호스트→편집기 수신 명령 계약 v1** 등재(§1-D-1). 신규 계약 제정이 아니라 **既 GUIDE 노출분의 사후 추인**(정식 계약 승격) — 발신 표면(8종 FROZEN + `editor.pricingChange` ADDITIVE)은 불변이며 넓히지 않는다.
> **v1.4 개정 (2026-09-12)**: 🚨 **FROZEN 항목 1행 개정** — §1-C-1 "스탬프 근거의 유일성"이 근거를 "서명 검증된 JWT 뿐" 으로 적고 있었으나, 그 문구 그대로는 **D6 NULL-파괴 게이트가 정상 파트너를 파손**한다(`compose-mixed` 를 `X-API-Key` 로 호출하는 파트너에게 자기 잡에 siteId 를 붙일 수단이 없어 전건 NULL 스탬프 — RESUME 2026-09-11 §8-1). 오너 결정(ⓐ안)에 따라 **DB 에서 검증된 활성 사이트 자격증명**을 근거에 추가했다. 금지 대상은 그대로다: **호출자가 주장한** siteId(본문·헤더·쿼리 값)는 여전히 채택 금지. 상세는 §1-C-2.
>
> **v1.3 추가 (2026-09-11)**: **S3-A안 옵션형 site 스탬프** 등재(§1-C-1). 2026-08-28 구현·배포된 `c050729` 가 계약 문서에 전무했다(파일 전체 `Bearer` 0건). 신규 계약 제정이 아니라 **이미 라이브인 표면의 사후 추인** — 특히 `firstFinalize` 게이트는 최적화가 아니라 **동결 대상 보안 계약**이다. 동시에 §4.3 의 "오너 결정 대기" 표기를 정정(D1·D3·D4 는 2026-08-28 승인·집행 완료).

## 0. 동결 규약 (Freeze Discipline)

| 분류 | 정의 | 허용 | 조건 |
|---|---|---|---|
| **FROZEN** | 파트너가 실제로 읽는 기존 필드·헤더·응답 키·이벤트명·서명식·경계값 | 시맨틱 변경·제거·이름변경 **금지** | 예외 없음. 변경 필요 시 신규 버전 표면 opt-in 신설 |
| **ADDITIVE** | 기존 표면을 깨지 않고 새 필드/헤더 **추가만** | 조건부 허용 | ① 기존 소비자가 무시해도 동작 불변 증명 ② **contract test 동일 커밋 동시 갱신** ③ 문서 갱신 |
| **MODIFY-TARGET** | 계약 표면이나 보안/버그로 수정 필요 + 소비처 0건 근거 | 오너 승인 + 파트너 4종 grep 확인 후 | thumbnail 유일(§5) |

기존 필드의 enum 확장·null 허용 변경도 시맨틱 변경으로 간주해 FROZEN 취급.

---

## 1. 파트너별 의존 표면

### 1-A. 웹훅 수신 (발신부 = `apps/api/src/webhook/webhook.service.ts`)

| 표면 | bookmoa-mobile | Sharesnap | 100p_books | MD2Books | 분류 |
|---|---|---|---|---|---|
| 웹훅 수신 | O `api/storige/webhook.js` | O `storigeServer.ts` | **X(미사용)** | O(재조회형) | — |
| `X-Storige-Signature` (base64 `id:event:ts`) | 읽음(필수) webhook.js:34 | 읽음 storigeServer.ts:386 | — | 미참조 | **FROZEN** |
| `X-Storige-Event` | 발신 유지 | | — | | FROZEN |
| `X-Storige-Signature-HMAC` (hex `t=,v1=`) | 미읽음 | 미구현 | — | 미참조 | **ADDITIVE**(발신 중, 수신 강제 금지) |
| `X-Storige-Retry: 1` | 무시(서명 필수) | 읽음(retry면 서명 누락 허용) storigeServer.ts:390 | — | 무관 | FROZEN |
| identifier = `jobId ?? sessionId` | 준수 webhook.js:37 | 준수 storigeServer.ts:395 | — | jobId 재조회 | FROZEN |
| 이벤트 7종 (`validation.completed/fixable/failed`, `synthesis.completed/failed`, `session.validated/failed`) | 분기 소비 | 분기 소비 | — | status 재조회 | **FROZEN** |
| replay 신선도 (payload.timestamp ±10분, WH-002) | 검증 webhook.js:134 | — | — | 무관 | FROZEN(발신 timestamp 유지) |

**서명 동결 결론**: 오늘 3개 수신부를 모두 통과시키는 **유일한 서명식 = base64(`identifier:event:timestamp`)**. 이것을 **v1 계약 기준선**으로 동결(webhookVersion=1 기본). HMAC 헤더는 순수 additive이므로 발신 유지하되 **수신 검증 강제 금지**. (§3 서명 대조표 상세)

### 1-B. HTTP API — 다운로드/삭제/검증 (`apps/api`)

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `POST /files/upload/external` (ApiKey+site, multer **100MB**) | 4종 소형 업로드 | FROZEN | files.controller.ts:293, multer 캡 :247/:324 |
| `GET /files/:id/download/external` (ApiKey+site, 무소유검증 특성) | 다운로드 정본 | FROZEN | files.controller.ts:517 |
| `DELETE /files/:id/external` (ApiKey+site, 404=성공) | 파일 정리 | FROZEN | :607, 실구현·활성 |
| `POST /files/:id/expiry/external` (ApiKey+site) | 만료 예약 | FROZEN | :629 → setExpiry(id,parsed,site):655 |
| `GET /files/:id/raw` (@Public+Throttle120, **image 화이트리스트만**) | 이미지 서빙 | FROZEN | PDF/svg 404 배제(권한경계) |
| 검증 result shape `{ isValid, errors, warnings, metadata }` | worker 산출 | FROZEN | **`issues` 아님**. 파트너 기대(100p=issues/MD2=errors) 매핑 어댑터 필요 여부 [미확인] |
| 파일 응답 DTO 키 `id` · `status:'ready'` · `mimeType` | 100p(client.ts:249/253 `json.id`), bookmoa | **FROZEN** | 최상위 `id` 키 하드의존 — 이름변경 시 업로드→검증→주문 전체 파손 |

### 1-C. ★HTTP API — 대용량 업로드 표면 (적대검증 P0 보강 — 파트너 최대 의존)

> **100p_books와 bookmoa는 대용량 PDF(≤2GB 표지/내지)를 이 경로에 필수 의존.** v1.0에서 통째로 누락됐던 최대 표면군.

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `POST /files/presigned-upload-public` (@Public, uploadToken) | 100p(client.ts:281/375), bookmoa(presignedUpload.js:9) | **FROZEN(@Public 무인증)** | R2 직결 ≤2GB. 인증 강제 시 파손 |
| `POST /files/multipart/init` (@Public) | 100p(client.ts:309) | FROZEN | 응답 `{ fileId, uploadUrl, uploadToken }` 3키 필수 의존 (client.ts:340, presignedUpload.js:93) |
| `POST /files/multipart/sign` (@Public) | 100p | FROZEN | part ETag=MD5 |
| `POST /files/multipart/complete` (@Public) | 100p, bookmoa | FROZEN | 응답 최상위 `id` 키 필수 |
| `POST /files/multipart/abort` (@Public) | 100p(고아 abort) | FROZEN | |
| `POST /files/:id/complete` (@Public, 단품) | 업로드 확정 | FROZEN | files.controller.ts:132-214 라우트군 |
| **업로드 크기 경계** | | **FROZEN(경계값)** | multer **100MB**(:247/:324) · 100p **90MB 라우팅 임계**(client.ts:65-66, ≤90MB→multipart / >90MB→presigned) · presigned **2GB** · nginx `client_max_body_size **100M**`(docker/nginx/nginx.conf:56) |
| **`503 + 본문 `STORAGE_NOT_S3`** 폴백 계약 | 100p(client.ts:328 `body.includes(...)` — ⚠️ 파트너 실물 미확인) | **FROZEN(에러코드 문자열)** | driver=local 판별→multipart 폴백 트리거. 실코드 발신값은 전수 `STORAGE_NOT_S3`(presigned-upload.service.ts:78 등) — 본 행의 종전 표기 `STORIGE_NOT_S3` 는 문서 오기였음(2026-07-15 정정). 100p client.ts:328 파트너 실물이 어느 문자열을 매칭하는지는 미확인 — **파트너측 확인 필요, 확인 전까지 코드 문자열 변경 금지** |
| **`ALLOWED_CONTENT_TYPES`** (pdf/jpeg/png/webp/gif, **svg 제외**) | presigned 업로드 | **FROZEN(enum)** | presigned-upload.service.ts:24-31. 축소는 파트너 파손 |

> ⚠️ **크기 경계 상충 확정**: nginx 100M ↔ bookmoa 2GB 클라 캡은 실측 상충. 대용량은 **반드시 presigned 직결 R2 경로**(nginx 우회)여야 동작. PrintCard 대용량 오프로드 설계 시 이 사실 전제.

### 1-C-1. ★S3-A안 — presigned complete 의 옵션형 site 스탬프 (2026-08-28 배포 · 2026-09-11 등재 · 사후 추인)

> 근거 커밋 `c050729`(오너 결정 D1) · 설계 `TENANCY_S3_S4_DESIGN_2026-08-28.md` §2-A 1단계 · 배포·라이브 실증 완료.
> **등재 이유**: 이 표면이 문서에 없으면 다음 작업자가 `firstFinalize` 게이트를 불필요한 복잡도로 오인해 제거하고,
> 그 순간 **소급 하이재킹 벡터가 재개방**된다. 아래 3행은 성능·리팩터 사유로 건드릴 수 없다.

| 표면 | 분류 | 계약 내용 | 근거 |
|---|---|---|---|
| `POST /files/multipart/complete` · `POST /files/:id/complete` 의 **`Authorization: Bearer <shop-session JWT>` 옵션 소비** | **ADDITIVE** | 서명 검증된 shop-session 이 실려 오면 그 `siteId` 로 파일을 귀속. **토큰 없음/위조/비-shop(`source!=='shop'`) → 종전대로 `site_id=NULL`** — 100p 키없는 server-to-server·게스트 경로 무영향이 무중단 조건이다 | `files.controller.ts:186-188`·`:223-225`(`@UseGuards(OptionalShopJwtGuard)` — **절대 거부하지 않는** 옵션 가드) |
| **`firstFinalize` 게이트** (`pending→ready` 전이 1회로 스탬프 한정) | **FROZEN(보안 계약)** | 🚨 **제거·완화 금지.** `ready` 멱등 재호출은 `uploadToken` 이 소거된 상태라 무토큰 통과한다. 게이트가 없으면 `fileId` 만 아는 타 테넌트가 Bearer 를 실어 **남의 NULL 파일을 자기 site 로 소급 하이재킹**하고, 진짜 소유자는 이후 site 대조에서 404 를 맞는다(기존에 없던 신규 파손 벡터) | `presigned-upload.service.ts:415-424` (`const firstFinalize = file.status !== 'ready'` → `firstFinalize && !file.siteId && caller?.siteId && caller.role !== 'worker'`) |
| 스탬프 **근거의 유일성** | **FROZEN**<br>(근거 1종 추가 — v1.4) | 스탬프 근거는 ① **서명 검증된 JWT** 와 ② **DB 에서 검증된 활성 사이트 자격증명**(`X-API-Key` → `status:'active'` 행 조회, v1.4 추가) **뿐**. 🚫 **호출자가 주장한** siteId(본문 필드·헤더·쿼리 값)는 채택 금지 — 변하지 않았다(`edit-sessions.createGuest` I-1 원칙). ②가 ①과 같은 급인 이유: 값이 요청에서 오지 않고 **서버가 비밀 자격증명으로 DB 에서 도출**하므로 위조에 키 탈취가 필요하다 | `worker-jobs.service.ts:1543-1607` `resolveComposeMixedSiteId`(①=②분기, 불일치 시 NULL 스탬프 + 경고 로그) |

**동결 저촉 없음 실증**: `@Public` 유지 · `ApiKeyGuard` 불추가 · 응답 shape 불변 → `contract-freeze.spec` 무변경 통과
(스펙은 경로·메서드·`IS_PUBLIC`·`ApiKeyGuard` 유무만 단언한다). 계약 고정 스펙은 `presigned-complete-stamp.spec` 8종이며
그중 **T6 이 `firstFinalize` 불소급을 고정**한다 — 이 스펙이 깨지면 위 2행을 되돌린 것이다.

### §1-C-2 compose-mixed 사이트 키 스탬프 (D6-ⓐ, 2026-09-12)

> 근거: 오너 결정 ⓐ안 · 문제 정의 `RESUME_PROMPT_2026-09-11.md` §8-1(D6 하드 블로커).
> **왜 필요했나**: 2026-08-13 테넌트 스탬프 위조 차단이 `body.siteId` 무검증 채택을 막으면서,
> **`X-API-Key` 호출자가 자기 잡에 siteId 를 붙일 수단이 남지 않았다**. 그 결과 파트너 정규 경로
> (키 + `body.siteId` 미전송)로 만든 잡은 **전건 NULL-site** 이고, D6 NULL-파괴 게이트를 켜면
> 그 파트너의 산출물 다운로드가 **404** 가 된다. 위조 차단은 write 위조만 막고 정당한 귀속 수단을
> 만들지 않은 것이 공백의 정체다.

| 표면 | 분류 | 계약 내용 | 근거 |
|---|---|---|---|
| `POST /worker-jobs/compose-mixed` 의 **`X-API-Key` 옵션 소비** | **ADDITIVE** | 활성 사이트 키가 실려 오면 그 사이트로 잡을 귀속. **키 없음/무효/폐기(`status!=='active'`)/내부 `WORKER_API_KEY` → 종전대로 NULL 스탬프**. 무인증 게스트 호출 무영향이 무중단 조건 | `worker-jobs.controller.ts` `@UseGuards(OptionalShopJwtGuard, OptionalApiKeySiteGuard)` |
| **`OptionalApiKeySiteGuard` 의 무조건 통과** | **FROZEN(동결 계약)** | 🚨 **throw 추가 금지.** 이 가드가 401 을 던지는 순간 `auth:'public'` 동결이 의미상 깨지고 무인증 게스트(bookmoa-mobile·Sharesnap 의존)가 파손된다. `ApiKeyGuard` 로 교체하는 것도 같은 파손 | `optional-api-key-site.guard.ts` 불변식 1 |
| **`caller`(JWT) 와 `apiKeySite`(키) 의 분리** | **FROZEN(보안 계약)** | 🚨 **한 객체로 합치지 말 것.** 합치면 자동조립 인가 게이트(`assembleComposeInputFromSession` 의 `caller.siteId` 일치 검사)가 API 키로 통과되고, API 키에는 `allowedOrderSeqnos` 주문 스코프가 없어 **호환 모드(검사 생략)** 로 떨어진다 → 같은 테넌트의 **타 고객 세션**을 합본으로 뽑는 권한 상승 | `optional-api-key-site.guard.ts` 불변식 2 · 컨트롤러 3번째 인자 분리 |

**채택 규칙**(`resolveComposeMixedSiteId`, 위→아래 우선):
① 자동조립 → `session.siteId`(세션 권위, **키로 덮어쓰지 않는다**) ② 검증된 shop-session JWT == `body.siteId` → 채택
③ 검증된 사이트 키 → 채택, 단 ⓐ `body.siteId` 가 키와 불일치 / ⓑ `editSessionId` 세션이 **타 테넌트 소유**로 확인됨 /
ⓒ shop-session JWT 가 다른 테넌트 → 전부 **NULL 스탬프** ④ 그 외 NULL(종전 불변).

> ⚠️ ③-ⓑ 의 "확인됨" 은 **양성 판정 한정**이다. 세션 부재·조회 실패·`siteId IS NULL`(레거시 무소유)은
> "상충 소유자 없음" 으로 **채택**한다 — 여기서 거부하면 정상 파트너가 다시 깨진다.
> 🚨 세션 소유 정보는 수동 경로가 **이미 읽는** 조회를 재사용한다(추가 쿼리 없음). 그 대입이
> `repository.create` 보다 **먼저** 일어나야 ③-ⓑ 가 작동한다 — 조회 블록을 뒤로 옮기거나 앞에
> 조기 return 을 끼우면 교차 테넌트 검사가 **조용히** 무력화된다. 순서가 곧 계약이다.

**동결 저촉 없음 실증**: `@Public` 유지 · `ApiKeyGuard` 불추가(별도 클래스) · 응답 shape 불변 · 400/401 신설 0건
→ `contract-freeze.spec` **73종 무변경 통과**(스펙은 `guards.includes(ApiKeyGuard) === false` 로 "X-API-Key 가
**필수가 아님**" 을 잠그며, 키를 *쳐다보는 것* 은 금지 대상이 아니다).
계약 고정 스펙: `worker-jobs.compose-mixed-site-stamp.spec` §5(12종) · `optional-api-key-site.guard.spec`(12종) ·
`worker-jobs.controller.compose-mixed-caller.spec` 의 apiKeySite 배선(3종).

> 🔴 **미검증 잔여**: 실 파트너 호출로 스탬프가 붙는 것은 **라이브 실증 전**이다. compose-mixed 프로덕션
> 호출 이력이 0건이고(2026-08-13 실측, 2026-09-11 재확인) 결속된 실 jobId 가 없어 e2e 를 돌릴 대상이 없다.
> **D6 게이트를 켜기 전에 첫 실합성으로 `job.siteId` 가 NULL 이 아님을 확인할 것** — 이 확인 없이 게이트를
> 켜면 ⓐ를 한 효과가 없고 §8-1 의 404 가 그대로 재현된다.

### 1-D. 임베드/게스트 표면

| 표면 | 파트너 | 분류 | 근거 |
|---|---|---|---|
| `/embed` URL 파라미터 12종(camel/snake 겸용) | bookmoa/Sharesnap iframe | FROZEN | getParamCompat |
| postMessage 엔벨로프 v1 `{source:'storige-editor', version:'1', event, payload, timestamp}` | 임베드 2종 | FROZEN | editor.ready/save/complete/cancel/error/needAuth/state/saved |
| editor.complete payload (files 중첩 + needsAuth/guestToken 인라인) | bookmoa | FROZEN | STALE-CLOSURE-001 |
| `editor.pricingChange` 신규 이벤트 `{sessionId, pageCount, pricing?, coverType?}` (2026-07-06, D-3) | 포토북 호스트(opt-in) | **ADDITIVE** | needAuth 선례의 신규 이벤트명 추가 — 수신부 event 스위치는 미지 이벤트 무시(파트너 4종 영향 0). 발신은 pricing 설정 셋+회원 세션만. 기존 8종 payload 불변 |
| **호스트→편집기 수신 명령 엔벨로프 v1** `{source:'storige-host', version:'1', command, requestId?, payload?}` + 명령 3종(`getState`/`saveNow`/`setBackGuard`) | 임베드 2종(파트너 4종 現 미발신 — GUIDE 노출분이라 발신 가능)·SDK `/embed` 예정 | **ADDITIVE(등재) → FROZEN(v1 시맨틱)** | **既 GUIDE 노출분의 사후 추인** — 상세·응답 유형·확장 규약은 **§1-D-1** |
| 레거시 `storige:*` dual-emit | bookmoa | FROZEN(하위호환) | parentOrigin 미지정 시 targetOrigin='*' — 신규 연동 혼입 금지 |
| shop-session 응답 shape (accessToken/refreshToken/expiresIn/member) | 임베드 2종 | FROZEN | |
| `POST /worker-jobs/compose-mixed` (@Public, 게스트) | 게스트 편집 | FROZEN(게스트 UX) | siteId = 세션권위‖검증JWT‖**검증 사이트키(v1.4)**‖null — `dto.siteId` 직접 대입은 2026-08-13 폐기(§1-C-2). 무인증 게스트는 여전히 NULL(격리 결함 §4.3) |
| `POST /worker-jobs/render-pages` (@Public, 게스트) | 게스트 편집 | FROZEN(게스트 UX) | 동일 NULL 결함 |
| `POST /worker-jobs/fix-bleed` (@Public, 게스트) — **ADDITIVE 2026-07-13 신설** | 게스트 편집(BLEED_MISSING extendBleed 실행기) | ADDITIVE→FROZEN(게스트 UX) | body=`{fileId,templateSetId}` 뿐 — editSize 는 서버가 templateSet 권위 산출(임의 사이즈 차단). 잡 siteId=원본 파일 승계‖null. 폴링 `GET /worker-jobs/:id`→`outputFileId`. contract-freeze.spec 동시 등재 |
| 조회: `/edit-sessions/external?orderSeqno=`, `/edit-sessions/my`, `guest/migrate`, `spine/calculate`, `template-sets/:id/with-templates` | 4종 혼용 | FROZEN | 응답 `{data:[{files}]}` shape 포함 · **contract-freeze.spec 등재 2026-08-26**(종전 리플렉션 게이트 밖이었다 — 문서만 동결) |
| `GET /worker-jobs/external/:id/output-url` (X-API-Key) — **ADDITIVE 2026-08-28 신설** | 합성 산출물 인증 회수(printy·bookmoa) | ADDITIVE→FROZEN | nginx secure_link 서명 URL 재발급(TTL 300s 기본). 스탬프 잡=site 대조 404, NULL 잡=`OUTPUT_URL_NULL_JOB_SITE_ALLOWLIST` 미설정 시 유효 키 전부(현행 read 시맨틱)·설정 시 목록만. 기존 무인증 `/storage/outputs/` 는 **D5 cutover(2026-09-11)로 `410 Gone` 폐쇄 완료** — 이 라우트가 유일한 회수 경로다. contract-freeze.spec 동시 등재 |
| `GET /product-template-sets/by-product` (@Public + ApiKeyGuard) — **등재 2026-08-26 · 사후 추인** | 파트너 상품페이지/임베드 부트스트랩 | FROZEN | 무인증 아님(X-API-Key). ApiKeyGuard 이탈 시 **조용한 완전 공개**라 비대칭 위험 — contract-freeze.spec 동시 등재. site 스코프 미적용(템플릿=hybrid 설계, `product_template_sets` 전행 site_id=NULL) |

### 1-D-1. ★호스트→편집기 수신 명령 계약 v1 (2026-07-28 등재 · 사후 추인)

> **성격 = 신규 계약 제정이 아니라 既 노출분의 사후 추인(정식 계약 승격).** 수신 3종은 등재 이전에 이미 `docs/PLATFORM_INTEGRATION_GUIDE.md` 에 산문으로 외부 공개돼 있었다 — "편집기는 `e.origin === parentOrigin` 이고 `source === 'storige-host'` 인 메시지만 처리하며 `requestId` 를 echo한다"(임베드 섹션 개정 전 `:581` 산문 → 개정 후 `:792-794` 표 + `:823-824` 산문). 따라서 파트너가 이미 이 서술대로 명령을 보내고 있을 수 있으며, 본 등재는 **문서로 노출된 기존 편집기 동작을 계약 표면으로 확정**하는 것이다. 근거 원문 = `.cursor/plans/EMBED_OPENING_PLAN_2026-07-28.md` §7(기획세션 소유·읽기 전용).
> **동결 표면을 넓히지 않는다**: 편집기 **발신**은 §1-D대로 **8종 FROZEN + `editor.pricingChange` 1종 ADDITIVE**가 정본이다(9종 아님). 아래 표의 응답 이벤트 `editor.state`/`editor.saved` 는 그 8종 중 2종을 가리키는 참조이지 신규 발신 표면이 아니다.

**봉투 (FROZEN)** — `host → editor`:
```
{ source:'storige-host', version:'1', command, requestId?, payload? }
```
편집기 inbound 게이트(**v1 계약**) = ① `e.origin === parentOrigin` **AND** ② `e.source === window.parent` **AND** ③ 봉투 `data.source === 'storige-host'`. ②는 **D14 additive 봉합 항목**(등재 base 시점의 수신부는 ①③ 만 검증했다 — `git show 9b652e4:apps/editor/src/embed.tsx` 기준 580-583행. 본 트랙 편집기 커밋에서 `isTrustedHostCommandEvent()` 로 3조건화 완료, 아래 D14 항목 참조). 세 조건은 **정상 부모 프레임이면 모두 통과**하므로 既노출 발신자 영향 0. `requestId` 는 호스트가 부여하고 편집기가 응답 이벤트에 echo한다(요청-응답 상관).

| command | payload | 응답 이벤트 | **응답 유형** | 분류 | 근거 |
|---|---|---|---|---|---|
| `getState` | `{}` | `editor.state{requestId, ready, dirty, sessionId}` | **요청-응답**(requestId echo) | **FROZEN**(명령명·응답 유형) | `embed.tsx` `case 'getState'` |
| `saveNow` | `{}` | `editor.saved{requestId, ok, error?}` | **요청-응답**(requestId echo) | **FROZEN** | `embed.tsx` `case 'saveNow'` — 성공·실패 양쪽 응답 |
| `setBackGuard` | `{enabled:boolean}` | **없음** | **fire-and-forget**(응답 없음) | **FROZEN** | `embed.tsx` `case 'setBackGuard'` — postToParent 미호출 |

> 근거 열은 **심볼 앵커**다(줄번호 아님). 수신부는 `EmbeddedEditor` 의 `onMessage` `switch (data.command)` 안에 있고, 게이트는 `isTrustedHostCommandEvent()` 다 — 줄번호는 편집기 코드가 바뀔 때마다 어긋나므로 계약 문서에 고정하지 않는다.

> **응답 유형은 계약의 일부**다. 3종을 일괄 Promise로 감싸는 호스트/SDK 구현은 `setBackGuard` 만 영원히 pending 된다 — SDK `/embed` 는 타입 레벨로 분리 노출한다(`getState(): Promise<EditorState>` / `saveNow(): Promise<void>` / `setBackGuard(on:boolean): void`).

**확장 규약 (strict additive)**
- **미지원 `command` 는 편집기가 조용히 무시(no-op)** — 오류 이벤트도 예외도 발신하지 않는다(`embed.tsx` 의 `switch (data.command)` `default: break`, throw 없음). 이것이 strict additive 의 근거이며 구버전 편집기 ↔ 신버전 호스트 양방향을 안전하게 만든다. **호스트는 응답 이벤트 타임아웃으로 미지원을 판정하되 실패로 취급하지 않는다.**
- **신규 명령은 위 표에 additive 추가만.** 기존 명령의 제거·이름변경·payload 시맨틱 변경·**응답 유형 전환**(fire-and-forget ↔ 요청-응답)은 금지. 신규 행은 **응답 유형을 반드시 명기**한다.
- 확장 후보(`navigateToPage`/`setReadonly`/`requestThumbnail`/`reload`)는 구현 별건 — 편집기 수신부 구현 시점에 additive 등재한다.
- ADDITIVE 조건②(contract test 동시 갱신): 본 표면은 **편집기측**이라 `apps/api/src/contract-freeze.spec.ts`(HTTP/웹훅 전용, postMessage 커버리지 0) 대상이 아니다 — 수신부 spec 은 D14 구현 커밋에서 동시 등재한다.

**[D14 · additive 봉합] `e.source === window.parent` 대조**
- 등재 base `9b652e4` 의 수신부는 origin + 봉투 `source` 필드만 검증하고 **`e.source` 대조가 없었다**(`git show 9b652e4:apps/editor/src/embed.tsx` 580-583행 — base 고정 인용이라 현행 파일의 같은 줄이 아니다). 따라서 **parentOrigin 과 같은 출처의 다른 프레임/윈도우**가 명령을 주입할 수 있었다 — `saveNow` 강제, `setBackGuard{enabled:false}` 로 뒤로가기 가드 해제(`getState` 응답은 부모에게만 가므로 유출은 제한적). 조건부(호스트 XSS·오픈리다이렉트·서드파티 iframe 허용 시)라 심각도 **P2**지만 **계약 v1 확정 시점이 additive 봉합의 적기**라, 본 트랙 편집기 커밋에서 동시 봉합한다(수신부 trust gate 헬퍼 `isTrustedHostCommandEvent()` 로 3조건화). ⚠️ 문서·편집기 커밋은 같은 브랜치에 있어 함께 병합된다 — **분리 cherry-pick 시에만** 조건 ②가 미구현으로 남으므로 그때는 대조 확인 필요.
- **통합 검증(2026-07-29)**: 편집기 vitest 529 PASS(D14 전용 9종 포함) · `tsc -b` 0 · eslint error 0 · api 829 PASS · SDK 336 PASS · 포털 빌드 통과(H2 6·guard 0·linkcheck 0). 배포 산출물 실증 — `dist-embed/editor-bundle.iife.js` 미니파이 번들에서 게이트 함수를 추출해 구동한 결과 **11/11 PASS**(정상 부모 통과 / 형제·팝업·`source:null` 차단 / IIFE top-level self-post 통과 / 기존 origin·봉투 게이트 회귀 0), 같은 번들에서 `e.source` 절만 제거한 변이본은 **5건 red** — 게이트가 실효임을 산출물 수준에서 확인. **발신 표면 무변경 실증**: `postToParent` 본문 diff 0 · 발신 이벤트명 집합 base=HEAD 동일(8 FROZEN + `editor.pricingChange`).
- **既노출 발신자 호환(무중단 근거)**: `window.parent` 대조는 **정상 부모 프레임이면 통과**한다 → GUIDE 서술대로 이미 명령을 보내고 있는 파트너는 **영향 0**이고, 차단되는 것은 비정상 프레임 주입뿐이다. 기존 파트너 4종은 現 명령을 보내지 않으므로 추가로도 영향 0.
- 호스트측 참조 구현 `parseEditorMessage`(`examples/editor-session-order/public/editor-events.js`)는 `expectedSource` 필수화로 이미 대칭 방어 완료 — **편집기측만 비대칭**이었다.
- **참조 구현 fail-open 1건 동시 봉합(통합 검증에서 적발)**: 위 참조 구현의 ② 게이트가 `message.source !== options.expectedSource` 단순 비교라, iframe 로드 전이라 `expectedSource === null` 인 순간에 `source: null` 메시지(닫힌 윈도우·worker·MessagePort 발신)를 `null !== null === false` 로 **통과**시켰다 — 파일 자신의 주석이 명시한 의도("`null` 이면 ②에서 불일치 처리")와 어긋난다. `source === null` 하드가드로 봉합하고 `src/verify.ts` 에 회귀 케이스를 등재했다(변이 시 red 확인). SDK `./embed` 의 `parseEditorMessage` 는 처음부터 하드가드가 있어 **두 구현이 이제 동일 시맨틱**이다.

### 1-E. ★인프라/보안 계약 (적대검증 P0 정정)

| 표면 | 상태 | 분류 | 근거 |
|---|---|---|---|
| **frame-ancestors 허용 도메인** | **라이브 발신 중**(死코드 아님 — v1.0 오판정 정정) | **FROZEN(운영 데이터)** | `apps/editor/vercel.json:28/41` CSP 헤더: `papascompany.co.kr` · `bookmoa.co.kr` · `bookmoa.com` · `bookmoa.net` · `mybookmake.com`(+`*.` 서브) · `*.vercel.app` · localhost. **도메인 제거 = iframe 즉시 차단(무중단 위반)**. 추가는 ADDITIVE |
| `X-Storige-Signature-HMAC`(WH-001) | 발신부 additive 발신(WEBHOOK_SECRET 설정 시) | ADDITIVE | 발신 형식 **hex + `t=<unix>,v1=<hex>` + data 앞 `t.` prefix** 정본 |
| `site.frameAncestors` **DB 필드** | 死코드(getAllFrameAncestors 호출처 0) | 非계약 | 런타임 CSP 주입 신설 시 활성화 후보(Phase 3). 현재 실효 표면은 vercel.json |
| Sharesnap SSRF allowlist | sites 테이블 도메인 allowlist | FROZEN(운영 데이터) | base64 서명 약함을 보완. 언블록은 ops 런북 |
| WEBHOOK_SECRET 상태 | CLAUDE.local.md §5 "no-op"은 **stale** — d441802 이후 사용, 2026-06-23 주입 수정으로 활성 | 운영 비밀 | 회전 시 v2 opt-in 사이트 발생 후 서명 파손 위험 |

### 1-F. WH-005 발신 페이로드 additive 필드
| 필드 | 분류 | 비고 |
|---|---|---|
| `jobId` / `event` / `timestamp` | FROZEN | 서명식·replay 구성 |
| `sessionId` / `orderSeqno` | ADDITIVE(WH-005) | 기존 수신부 무시해도 무해 |
| `fileType?:'cover'\|'content'` | ADDITIVE | session 이벤트, webhook.service.ts:14. 발신 페이로드 전체 스냅샷 골든 고정 권고 |

---

## 2. Phase 0 골든 계약 테스트 대상
발신부 `generateSignature`/`buildHeaders` 시그니처, §1-B/1-C HTTP 표면(요청 DTO·응답 키·경계값·NOT_S3/503), 이벤트 7종, WH-005 필드셋을 골든으로 고정. 기존 `webhook.service.spec.ts`(2.7KB) 커버리지 정독 후 확장. **files 모듈은 현재 .spec.ts 0건** — thumbnail/findExpired 변경의 회귀 그물이 없으므로 신규 spec이 병합 전제.

---

## 3. 서명 3종 대조 요약
| 항목 | 발신부 | bookmoa-mobile | Sharesnap | MD2Books | 100p |
|---|---|---|---|---|---|
| 읽는 헤더 | (발신) X-Storige-Signature + (opt)HMAC | x-storige-signature | x-storige-signature | (서명 미검증) | 미사용 |
| 레거시 서명식 | base64(`id:event:ts`) 항상 | base64 기대 | base64 기대 | 재조회 대체 | — |
| HMAC | hex, `t=,v1=`, data `t.` prefix (secret 시) | base64, prefix 없음 | 없음 | 없음 | — |
| 발신 base64와 일치 | (기준) | ✅ | ✅ | N/A(재조회) | N/A |
| 발신 HMAC와 일치 | (기준) | ❌ 형식 상이 | ❌ 미구현 | ❌ 미검증 | N/A |

**결론**: v1 = base64 동결. HMAC additive 유지. v2 opt-in 시 **bookmoa 수신부를 발신부 형식(hex/`t=`)으로 재작성 선행 필수** — "시크릿만 맞추면 된다"는 오답(형식 자체 불일치).

## 4. 알려진 결함 (오너 결정)
- **4.1** 발신부 HMAC ↔ bookmoa HMAC 경로 형식 불일치 — v2 opt-in 전 bookmoa 수신부 재작성.
- **4.2** Sharesnap retry 서명 누락 허용 vs bookmoa 필수 — 발신부 재시도 서명 포함을 계약 동결로 고정.
- **4.3** NULL-siteId 파일은 `assertSiteAccess`(files.service.ts:333) 무조건 통과 → 테넌트 격리 불가. compose-mixed/render-pages 게스트가 NULL 스탬프.
  - ✅ **2026-09-12(§1-C-2)**: compose-mixed 는 **사이트 키 호출분에 한해** 해소됐다(키 → 서버 도출 스탬프). 무인증 게스트와 `render-pages` 는 미해소.
  - 🚨 **D6 착수 전 필수**: NULL-파괴 게이트는 "잡에 siteId 가 붙는다"를 전제한다. ⓐ 배포 **이전에 만들어진** 파트너 잡은 전건 NULL 이므로 게이트 대상이다 — 백필 범위 산정에 ⓐ 배포 시각을 경계로 쓸 것.
  - ⚠️ **2026-09-11 정정**: 종전의 "오너 결정" 표기는 스테일이다. 이원 정책의 **신규 site 스탬프 쪽은 오너 승인(D1)을 받아 2026-08-28 집행 완료**(§1-C-1, `c050729`)이며 D3·D4 도 같은 날 승인됐다.
  - **잔여 미결은 D6 뿐**: ① NULL-파괴 게이트 ② 기존 의존분 allowlist 승격 ③ 레거시 NULL 백필. 착수 시점만 오너 결정 대기이며, 설계 §2-B' 단서대로 "해당 파트너의 기존 회수가 자기 키로 이뤄지는지" **관측이 백필보다 선행**한다.
  - ⚠️ 집행 전 수치 재실측 필수 — 백필 41건/NULL 225건은 **2026-08-28 실측치이고 이후 재실측이 없다**.

## 5. thumbnail = MODIFY-TARGET
`GET /files/:id/thumbnail`(files.controller.ts:662) = @Public 무인증 + Throttle 없음 + PDF 전용. raw가 404로 막은 민감 PDF를 UUID만으로 첫 페이지 유출. **소비처 0건 확정**(로컬 editor/admin/api + 파트너 4종 레포 전수 grep, GET /files/:id/thumbnail 호출 0). 수정안은 §Review Gate / code_changes 참조.

## 6. 대상 외 (웹훅 서명 계약 한정)
- **100p_books**: 웹훅 **서명 계약** 대상 외(라우트 부재). ⚠️ 단 **HTTP API(§1-B/1-C)의 최대·최중량 소비자**(client.ts 22KB 전량 연동) — 계약 영향 분석에서 배제 금지.
