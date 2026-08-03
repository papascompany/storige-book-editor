# 편집기 임베드 외부 공개 계획 (정본) — 2026-07-28

> **목적**: sweetbook처럼 외부 개발자가 **우리 편집기를 셀프로 연동해** 쓸 수 있도록 임베드 API를 공개하기 위한 개발이슈·처리방식·연동안·주의사항·실제작연동 경로 정본.
> **작성**: Fable 5, 현행 master `339fd1b` 기준 임베드 6축 전수 재조사(o5-repo-scout ×5 + 완전성 + 적대검증 o5-security-reviewer, 19건 확인/2건 경미 정정) + 구현세션(P트랙 Stage 1~4) 확정 사실 병합.
> **상위 정본**: `.cursor/plans/SWEETBOOK_GAP_ROADMAP_2026-07-07.md` — 이 문서는 그 **"임베드 트랙"을 현행 master 기준으로 구체화**한다(로드맵 Stage 4 절 무접촉, §10 포인터만 추가).
> **협업 경계(확정)**: 이 문서(`.cursor/plans/` 기획) = 본 세션 소유 / `docs/` 포털·`apps/*`·`packages/*` = 구현세션(P트랙, `feat/p4-*` worktree) 소유. §6·§7은 **구현세션 수신용 산출물**이다.
> **시각화**: `outputs/EMBED-OPENING-DASHBOARD_2026-07-28.html`

---

## 0. 핵심 결론

편집기 자체가 sweetbook에 없는 **최대 차별재**다. sweetbook은 편집기가 없어 파트너가 UI를 직접 만들어야 하지만, storige는 iframe `/embed` 한 줄로 풀 WYSIWYG 인쇄 편집기를 붙일 수 있다. 이미 4곳(bookmoa-mobile·ShareSnap 임베드형, 100p·MD2Books 워커형)이 실운영하며 계약이 동결됐다.

**격차는 편집 기능이 아니라 "외부 개발자가 셀프로 시작·검증·발행할 수 있게 하는 포장"이다.** 공개를 막는 실제 병목은 4가지: ①파트너 대면 정본 문서가 pre-v1로 3주 지체 ②임베드 인증이 파트너 백엔드(X-API-Key) 필수인데 키 발급이 운영자 전용 ③SDK `/embed` 미구현(선결=수신 명령 계약 미확정, §7에서 해소) ④문서 포털·샌드박스 부재.

**구현세션 확정 사실 병합(재조사 비용 절감)**: v1 파트너 표면 22 오퍼레이션(16 paths)이 이미 프로덕션 라이브(401+v1 봉투), `packages/sdk`(수작업 초판, `/client`+테스트 139)·`examples/`(quickstart 3종) 기존재, **SDK `/embed`·`/webhook` subpath는 의도적 미선언**(구현 시 additive). 아래 §6~7이 그 `/embed` 착수의 선결을 푼다.

**정정 반영(구현세션)**: E-4=오탐(별개 두 업로드 표면, `files.service`는 `ObjectStorageService` 주입 — 결함 아님) / E-9=재정정(v2 오늘 수신 불가, 실 충돌은 v1 큐 적체>10분) / S-2=종결(`WORKER_MAX_FILE_SIZE=2GB` 실측, "1GB" 스테일·"90MB"는 100p 자작 클라 마진).

---

## 1. 현행 임베드 실태 (master 339fd1b, 실코드 검증)

### 1.1 임베드 3계약

| 계약 | 진입 | 상태 |
|------|------|------|
| **iframe `/embed`** (유형2, 권장 기본) | `editor.papascompany.co.kr/embed?templateSetId&token&orderSeqno&…`(신규) 또는 `?sessionId&token`(재편집). ~20 파라미터 camel/snake 겸용, token/refreshToken을 localStorage 주입 | **풀 SPA 빌드** — 사진 업로드·템플릿·프레임·QR/바코드·모양컷·배경제거·이미지편집·눈금자 전부 살아있음(AI만 `.env.production`에서 false) |
| **IIFE `window.StorigeEditor`** (레거시, 비권장) | `editor-bundle.js` → `create(cfg).mount(el)`, 콜백 수신 | **기능 축소판** — `@imgly`/OpenCV 스텁, UPLOAD/TEMPLATE/FRAME/SMART_CODE/IMAGE_PROCESSING/RULER define로 비활성. 신규 공개에 부적합 |
| **postMessage 엔벨로프 v1** | editor→host `{source:'storige-editor',version:'1',event,payload,timestamp}` / host→editor `{source:'storige-host',version:'1',command,requestId?,payload?}` | 보안 강함 — `postToParent`가 parentOrigin 없으면 전송 거부·`'*'` 절대 미사용, inbound는 `e.origin===parentOrigin AND source==='storige-host'` 이중검증 |

**발신 이벤트 8종 FROZEN + `pricingChange` 1종 ADDITIVE**(구현세션 정정): FROZEN=`editor.ready/save/complete/cancel/error/needAuth/state/saved` · ADDITIVE=`editor.pricingChange`(`CONTRACT_FREEZE.md:71/73`). ⚠️ "9종 동결"은 **동결 표면을 1종 부풀린 대외 약속**이라 금지 — 파트너에겐 8종만 불변으로 약속.
**수신 명령 3종(비공식 — 미문서화)**: `getState / saveNow / setBackGuard` → §7에서 계약화

### 1.2 강점 (검증 반영)

1. **iframe /embed = 풀피처 편집기** — IIFE와 달리 disable define이 없어 AI를 제외한 모든 `VITE_ENABLE_*` 플래그가 true(정정: 적대검증). sweetbook류가 흉내 못 내는 차별재.
2. **인쇄 도메인 가드레일이 임베드에 배선** — 작업 규격(판형) read-only 강등, admin-locked 객체 권한, required-edit 게이팅. 일반 디자인 툴에 없음.
3. **`editor.pricingChange` 실시간 가격 이벤트 구현 완료**(~300ms 디바운스, 회원+pricing 템플릿셋 한정). storige는 가격을 계산 안 하고 pageCount+메타만 넘겨 host 장바구니가 계산 → 파트너 과금과 깔끔히 분리.
4. **정확한 실측 페이지 계산**(`computeLivePageCount`) — 포토북 펼침면×2·커버캔버스 제외까지 반영(S2 fix). `editor.complete`/`pricingChange`에 배선.
5. **게스트 try-before-login** 실동작 — 무인증 편집·자동저장·presigned 공개 업로드, 완료 시 needsAuth 신호로 로그인 유도.
6. **클라이언트측 PDF 생성**이 임베드에서도 동작(`ServicePlugin`은 두 빌드 공유, `createCanvas.ts:347`). 스프레드 인지·워치독·Sentry finishMark 포함.
7. **모바일 하드닝 축적**(E1/E2/C5/C6: 스마트 가이드·스냅·롱프레스 메뉴·4MB 가드) — iframe 경로에 그대로 적용.
8. **엔벨로프 v1 보안 자세 강함** — 신규 표준 채널은 origin 격리가 구조적으로 강제됨.

---

## 2. 개발이슈 (API 공개를 위해 실제 개발할 것 · 처리방식=additive)

> 심각도: **P0**=공개 전제(4) / **P1**=셀프서브 완성(7) / **P2**=고도화(3). 모든 처리는 §0 절대 제약(4곳 무중단·additive-only·동결 불변·AD-1 신규 /api/v1 표면 한정) 준수.

| # | 이슈 | 심각도 | 처리 방식(additive) | 근거 |
|---|------|--------|---------------------|------|
| D1 | 파트너 정본 `PLATFORM_INTEGRATION_GUIDE.md`가 pre-v1(약 3주 지체) — api/v1·finalization·EDITOR_SESSION·book-specs·Idempotency 언급 0건 | **P0** | 임베드 섹션 개정안(§6)을 구현세션 E-3 포털에 전달. v1 표면 등재는 구현세션이 소유(GUIDE 본문 v1 절) | GUIDE 마지막 커밋 2026-07-06; `books.constants.ts`(BookCreationType.EDITOR_SESSION) |
| D2 | frameAncestors **문서 드리프트**(死코드 아님) — 코드는 `site.frameAncestors`→`GET /api/frame-ancestors`→`middleware.ts` 동적 CSP 합성 **배선 완결**, 운영자 PUT은 재배포 불요. 문서만 옛 상태 | **P0** | 문서를 실상으로 정정(§6). 셀프서브 등록은 오너 게이트(§8) — 허용 시 `UpdatePortalSiteDto`에 additive 필드, `isValidAncestorSource` 검증 재사용 | `sites.service.ts:230-233`(60s 캐시); `frameAncestorsCsp.ts:58-74` |
| D3 | 임베드 인증이 **파트너 백엔드 필수** — shop-session JWT는 X-API-Key로 서버측 발급, X-API-Key 발급은 운영자 전용(`POST /api/sites` ADMIN/MANAGER) → 셀프 발급 불가 | **P0** | 신규 `/api/v1`에 셀프서브 **test 키 발급**을 additive 신설(기존 sites/operators 무접촉). live 키·frameAncestors는 운영자 게이트. 백엔드 없는 파트너용 브라우저-안전 토큰 교환은 오너 결정(§8) | `auth.controller.ts:180`; `api-key.guard.ts:31-59` |
| D4 | **IIFE 번들이 핵심 기능 스트립** — 사진 업로드·템플릿·프레임·QR·모양컷·배경제거·눈금자 제거. 공개 문서가 IIFE로 유도하면 "사진 업로드 없는 편집기" 최악 인상 | **P0** | 온보딩·SDK·문서를 **iframe /embed로 명시 유도**, IIFE는 레거시 PHP 인라인 전용 격하 표기. 코드 아닌 문서·기본경로 결정 | `vite.embed.config.ts:118-133`; `createCanvas.ts:346` |
| D5 | SDK **`/embed` subpath 미구현** — 타입드 임베드 래퍼(iframe 마운트+엔벨로프 타입+shop-session 헬퍼) 부재. 선결=수신 명령 미확정 | **P1** | §7 수신 명령 계약 확정 → `packages/sdk` exports에 `./embed` additive. `mountEditor`(parentOrigin 강제)·이벤트/명령 타입·guest needsAuth 헬퍼. 구현세션 소유 | `sdk/src/index.ts:23-25`(`./embed` 예약); `package.json`(exports=`.`,`./client`만) |
| D6 | **getState 멀티페이지 결함** — IIFE `getState()`가 currentPage:1/totalPages:1 하드코딩, postMessage `editor.state`는 페이지 필드 자체 없음. host 동기 조회 불가 | **P1** | `editor.state`/`getState`에 pageCount·currentPage **신규 필드 additive**(computeLivePageCount 단일 진실원 재사용). 기존 `{ready,dirty,sessionId}` 불변=동결 위반 아님 | `embed.tsx:1535-1540`(하드코딩), `:587-592`(state 페이지 필드 없음) |
| D7 | **게스트 세션 PDF/인쇄 산출 불가** + ⚠️ **마이그레이션 위임도 현재 미작동**(병합 발견 A③) — 게스트 세션이 `siteId=null` 생성 + `migrateGuestSessions()`가 siteId 미수정 → **회원 전환 후에도 승격 404**(NULL-site 거부) | **P1** | (a) needsAuth 분기·재오픈 문서화 **+ 서버: `migrate`에 siteId 주입 수정 선행**(D9와 연동 — 이게 빠지면 게스트 퍼널 자체가 성립 안 함). (b) 서버측 게스트 PDF는 오너 결정(§8) | `embed.tsx:1424-1447`; `migrateGuestSessions()` siteId 미수정 |
| D8 | **레거시 dual-emit이 parentOrigin 미지정 시 `targetOrigin='*'`** 송신 — 노출값은 **`sessionId`(=editSessionId)+`coverFileId`/`contentFileId`**. ⚠️ **guestToken 아님**(구현세션 정정): 와일드카드 발동=parentOrigin **부재** vs guestToken 발신=parentOrigin **존재**로 **상호배타**. 단 `editSessionId`는 `compose-mixed`가 @Public이라 **사실상 권한 토큰** | **P1** | SDK `mountEditor`가 parentOrigin **필수 강제**로 구조적 방지. 레거시 경로 자체는 동결 | `EmbedView.tsx:38-45`(화이트리스트 5곳, `completed`에 guestToken 없음); `embed.tsx:412-435` |
| D9 | **EditSession 주문 스코프 미바인딩 가능** — shop-session에 orderSeqno 미주입 시 `POST /edit-sessions`가 dto.orderSeqno 신뢰(호환모드). host가 빠뜨리면 세션이 주문 미격리 | **P1** | 신규 `/api/v1` 세션 생성 표면에서 orderSeqno(또는 allowedOrderSeqnos) **필수화**(신규 계약). 기존 `/edit-sessions` 호환모드는 4곳 무중단 위해 불변 | `edit-sessions.controller.ts:89-99`; `auth.service.ts:166-183` |
| D10 | **웹훅/콜백 서명이 HMAC 아님** — `X-Storige-Signature=base64(id:event:ts)` 위조 가능. 산출물 콜백에도 동일 | **P1** | `X-Storige-Signature-HMAC`은 이미 ADDITIVE(opt-in) — 신규 파트너 기본 권장으로 문서화, SDK `/webhook` 검증 헬퍼 노출. 콜백=트리거로만, `download/external` 재확인을 계약서 명기. base64 v1 동결 유지 | `CONTRACT_FREEZE.md §1-E`; **E-8/E-9 참조**(§9) |
| D11 | **문서 포털·llms.txt 미구축** — v1 표면 발행 채널 부재, 셀프서브 발견성 0 | **P1** | `storige-docs` 정적 포털+llms.txt(구현세션 E-3, `feat/p4-docs-portal` 진행 중). 이 문서 §6이 임베드 소스 제공 | 구현세션 Stage 4 |
| D12 | **기능 플래그가 editor 배포 단위 전역** — 사이트별 off 불가, 롤백=플래그 off+전체 재배포 → 전 파트너 동시 영향 | **P2** | 사이트별 오버라이드를 shop-session JWT/site config에 additive(신규 표면 한정). 초기는 전역+롤백 절차 문서화. 오너 결정(§8) | 플래그=editor 배포 단위 전역 |
| D13 | **PDF가 최종 사용자 브라우저 생성** — 공개 스케일에서 워치독 타임아웃·모바일 메모리 상한·포토북 행업 리스크, 서버 폴백 없음 | **P2** | 단기 문서로 한계 명시(대용량 가이드·워치독 상수). 중장기 서버측 렌더 오프로드는 워커 인프라 재사용 additive. 오너 결정(§8) | `embed.tsx:1622-1786`(워치독 1691/1757); iOS ~384MB 가드 |
| D14 | **편집기 수신부 `e.source` 대조 부재**(구현세션 발견①) — origin+봉투 source만 검증, `e.source===window.parent` 없음 → 같은 출처 다른 프레임이 명령 주입(saveNow 강제·setBackGuard 해제) | **P2** | 편집기 inbound에 `e.source===window.parent` 대조 additive(§7.3). 기존 4파트너 명령 미발신이라 영향 0. 계약 v1 확정 시 봉합. 구현세션 소유 | `embed.tsx:580-583`(현 게이트); 호스트측 SDK는 expectedSource 필수화로 대칭 방어 완료 |

---

## 3. 연동안 (외부가 편집기를 붙이는 방법)

| 연동안 | 방식 | 적합 파트너 |
|--------|------|-------------|
| **① iframe `/embed`** (풀피처, 권장 기본) | iframe + shop-session JWT + parentOrigin. 신규편집(`templateSetId`) 또는 재편집(`sessionId`) | 풀 편집 UX 필요한 모든 신규 파트너. bookmoa-mobile·ShareSnap과 동일 계약. parentOrigin·frameAncestors만 갖추면 됨 |
| **② `@storige/sdk/embed`** (타입드 래퍼, 신규 개발) | `mountEditor({templateSetId,token,parentOrigin})` — iframe 마운트+parentOrigin 강제+이벤트/명령 타입+guest needsAuth 헬퍼 | TypeScript 파트너·마찰 최소화. editor.complete 중첩구조·parentOrigin 함정을 SDK가 흡수. **§7 선결 → 구현세션 Stage 3 산출** |
| **③ IIFE `window.StorigeEditor`** (레거시, 비권장) | `create(cfg).mount(el)` 콜백 수신, 비iframe 인라인 | 기존 PHP 인라인(bookmoa PHP, 보류)만. **신규 공개엔 문서에서 명시 비권장**(기능 결손) |
| **④ EDITOR_SESSION → 책 → 주문 승격** (`/api/v1`) | 임베드 완료(`editor.complete`로 sessionId 수신)→파트너 서버가 `POST /api/v1/books{creationType:'EDITOR_SESSION',sessionId}`→`POST /books/{uid}/finalization` 2콜(Idempotency) | 임베드 편집을 자사 주문/장바구니에 정식 연결. compose-mixed 다운로드로 끝내지 않고 책·주문 도메인까지 잇는 sweetbook식 풀 커머스. **차별재** |
| **⑤ shop-session 서버 JWT**(전 경로 공통 전제) | 파트너 백엔드가 X-API-Key로 `POST /auth/shop-session` → memberSeqno(정수, 0/음수 금지) 담은 1h access+30d refresh. iframe 쿠키 차단 대비 body 리프레시(`shop-refresh-body`) | 모든 임베드 연동의 전제. 회원 세션이라야 PDF/complete 가능 |
| **⑥ 게스트→회원 마이그레이션** | 무로그인 게스트 편집·자동저장, complete 시 `{needsAuth:true,guestToken}`만. 파트너가 로그인 후 `/embed?sessionId=<동일>&token=<회원jwt>` 재오픈 | 무로그인 공개 퍼널(둘러보기→가입→구매). SDK 헬퍼로 needsAuth 분기 표준화 |

---

## 4. 주의사항 (실연동 함정 — 파트너가 반드시 부딪힘)

1. **parentOrigin 절대 필수** — 미지정 시 v1 postMessage 전면 비활성, 레거시 dual-emit이 `targetOrigin='*'`로 `sessionId`(=editSessionId, `compose-mixed` @Public이라 사실상 권한 토큰)+`coverFileId`/`contentFileId` 송신(guestToken은 상호배타로 미노출 — 구현세션 정정). 신규 임베드는 반드시 지정.
2. **`editor.complete` 중첩 구조** — `coverFileId/contentFileId/thumbnailUrl`은 최상위 아닌 `files` 객체 안, `pages`는 `{initial,final}`. `editCode`는 `'EDIT-'+세션ID 앞8자 대문자`(순수 숫자 아님). 최상위 파싱하면 파손. **동결 계약이라 우회 불가**.
3. **게스트 emit 순서 함정(구현세션 확정)** — 게스트 완료 시 `editor.complete`(needsAuth:true)를 **먼저**, `editor.needAuth`를 **나중에** 보냄. 모르면 파트너가 반드시 실패하는 승격 시도. needsAuth 미포함 payload(pageCount/size 없음)를 실완료로 오인 금지.
4. **memberSeqno=0/음수** — shop-session `@IsNumber` 통과 → 게스트성 토큰 발급 → PDF 미생성 폴백. 실제 `MEMBER_REQUIRED` 차단은 `POST /edit-sessions` 단계뿐. 파트너 백엔드에서 유효 회원번호 보장 필요.
5. **`POST /worker-jobs/compose-mixed`는 @Public**(무인증·테넌트 스코프 없음, Throttle만) — editSessionId(UUID)만 알면 누구나 합성 트리거. editSessionId 비밀 취급, 파트너 백엔드에서만 호출.
6. **웹훅 X-Storige-Signature는 base64(위조 가능)** — 콜백은 트리거로만, 결과는 `GET /files/:id/download/external` 또는 `/worker-jobs/external/:id`로 재확인. uploadCallbackUrl이 sites DB allowlist 미등록이면 무음 미발송(에러 아님).
7. **작업 규격(캔버스 치수)은 임베드 내 read-only**(주문/템플릿셋 권위, S1). Canva식 자유 커스텀 치수 불가 — "규격은 주문에서 결정, 편집기는 감사용 echo"를 파트너에 명시.
8. **모바일 4MB 업로드 하드 캡**(coarse-pointer 전용) — 리사이즈 아닌 즉시 거부(토스트). 브라우저 300dpi PDF+iOS ~384MB 가드와 맞물려 대용량 포토북 OOM/행업 리스크.
9. **동결 계약 불변** — /embed URL 파라미터(camel/snake), 엔벨로프 v1, 발신 **8종 FROZEN(+pricingChange ADDITIVE)**, `editor.complete` shape, 레거시 dual-emit, shop-session 응답 shape, frame-ancestors 계약. 신규는 전부 additive.
10. **frameAncestors 정적 baseline이 이미 광역 wildcard**(`*.vercel.app`·`*.papascompany.co.kr`·`*.bookmoa.*`·`*.mybookmake.com`) 허용 — 임의 서브도메인이 등록 없이 iframe 표시 가능. 단 "표시 허용"일 뿐 "기능 시작"은 shop-session(X-API-Key) 필요.
11. **shop-session 20/min throttle**(파트너 서버 IP 기준) — 고볼륨/다중 IP 파트너는 온보딩 시 상향 협의.
12. **스프레드(펼침면) 책은 서버가 `outputMode='separate'` 강제** → cover.pdf+content.pdf 2파일. 'single' 보내도 무시. 단일파일 가정 금지.
13. **대용량 업로드는 nginx 100M ↔ presigned 2GB 상충** — presigned 직결 R2 경로(nginx 우회) 필수. R2 CORS `ExposeHeaders:[ETag]` 필요(오너 인프라, §8).
14. **웹훅 v1/v2 identifier 상이(E-8)** — `book.finalization.*`가 v1=`fin_...`, v2=`whd_...`로 서명. 파트너가 v1 기준 검증 코드를 짜두면 v2 전환 시 전량 401. 신규는 처음부터 v2/HMAC 권장.

---

## 5. 실제작연동 경로 (Stage 0~6)

> 로드맵 상위 Stage와 정합. 구현은 구현세션(P트랙) 소유, 이 문서는 임베드 관점 명세.

| Stage | 목표 | 산출 | 소유 |
|-------|------|------|------|
| **0 — 문서 정본 v1 동기화** | 파트너 정본을 현행 master와 일치, frameAncestors 드리프트 정정 | GUIDE §3.5(EDITOR_SESSION 승격)+v1 books/finalization additive 등재; frameAncestors 실상 정정; getState/state 페이지 한계 명시 | 구현세션(§6 소스 수신) |
| **1 — 계약 결함 additive 수정** | 셀프서브 파트너가 즉시 부딪히는 결함 보정 | `editor.state`/`getState`에 pageCount·currentPage additive(D6); `/api/v1` 세션 생성 orderSeqno 필수화(D9). 골든 PDF 회귀 | 구현세션 |
| **2 — 셀프서브 온보딩 표면** | 운영자 수작업 최소화 | 기존 `PATCH /api/portal/sites`(allowedOrigins·uploadCallbackUrl·test키 셀프) 문서화; frameAncestors 셀프등록은 오너 결정 후 additive(D2) | 구현세션 |
| **3 — `@storige/sdk/embed` 구현** | 타입드 임베드 래퍼로 함정 흡수 | exports `./embed` additive; `mountEditor`(parentOrigin 강제)·이벤트/명령 타입·shop-refresh-body 헬퍼·guest needsAuth 헬퍼. **§7 선결** | 구현세션 |
| **4 — 문서 포털+llms.txt+quickstart** | v1 표면 셀프서브 발견 채널 | `storige-docs` 정적 포털; llms.txt; quickstart 3종(iframe 임베드·EDITOR_SESSION 주문·webhook). SDK 레퍼런스 | 구현세션(E-3) |
| **5 — 샌드박스/dev + E2E 승격 검증** | 파트너가 test 키로 dev에서 전 흐름 시험 | dev/staging 임베드 샌드박스(TBD 해소); test 키 셀프 경로; /embed→엔벨로프 v1→서버 승격→books+finalization E2E 스모크; 게스트→회원 마이그레이션 검증 | 구현세션(오너 게이트 §8) |
| **6 — 파일럿 실연동 + 무중단 확인** | 신규 셀프서브를 파일럿 1곳 실연동, 4곳 무중단 회귀 | 파일럿 온보딩 완주; 동결 계약 무접촉 회귀(엔벨로프 v1·compose-mixed·webhook); 공개 GA 판정 | 구현세션+오너 |

---

## 6. [구현세션 수신 · a] GUIDE 임베드 섹션 개정 제안 (실물 대조 반영)

> v1 무언급(구현세션이 v1 절 소유), **임베드(iframe/IIFE/postMessage) 부분만**. E-3 포털 소스에 병합.
> **[2026-07-28 구현세션 GUIDE 실물 대조]** 6항 중 3항이 이미 GUIDE에 존재 → **중복 개정 방지**를 위해 "신규 삽입/기존 강화/델타"로 재분류. 줄번호는 현행 GUIDE 기준(구현세션 제공).

**병합 지침(각 항목 처리 유형)**:

| # | 개정 | 처리 유형 | GUIDE 실물 |
|---|------|-----------|-----------|
| §6-1 | 유형2 iframe 진입 파라미터 | **델타만** — 기존 §3.1 표 유지, 추가·변경 파라미터만 보강 | `:489~544` §3.1 표 존재(`:532` parentOrigin 행) |
| §6-2 | 엔벨로프 v1 통합 표(발신9+수신3) | **부분 신규** — 통합 표는 신규, 단 수신 3종은 `:581`에 산문 노출됨(이슈2) | `:581` 수신 게이트 산문 |
| §6-3 | `editor.complete` 중첩 경고 | **기존 강화**(신규 삽입 금지=중복) | `:569` 이미 있음(files 중첩·pages{initial,final}) |
| §6-4 | parentOrigin 필수+보안 | **기존 강화**(신규 삽입 금지=중복) | `:532`(발신 필수)·`:552`(wildcard 금지)·`:584`(레거시 `\|\|'*'` 경고) 이미 있음 |
| §6-5 | IIFE 비권장 | **신규**(진짜 델타 — `:493-494`는 중립 기술, 비권장 없음) | 기능 결손 목록 아래 제공 |
| §6-6 | 게스트 needsAuth 재오픈 | **기존 강화 5항 + 신규 2항**(대조 완료) | 강화: needAuth 정의 `:561`·완료 payload 함정 `:571`·마이그레이션 `:635-637`·체크리스트 `:665`·memberSeqno 폴백 `:520/:522` / 신규: 아래 갭①② |

**§6-5 IIFE 기능 결손 목록(GUIDE에 실을 구체 내용)**: IIFE `window.StorigeEditor` 번들은 다음이 제거/스텁됨 — 사진 업로드 메뉴·템플릿 메뉴·프레임 메뉴·QR/바코드(smart-code) 메뉴·모양컷/이미지편집(image-processing, `ImageProcessingPlugin` 미등록)·배경제거(`@imgly` throwing 스텁)·OpenCV(`@techstark` no-op 스텁 ~45MB)·눈금자(ruler). 신규 파트너는 **iframe /embed(풀피처)로 유도**, IIFE는 레거시 PHP 인라인(bookmoa PHP, 보류) 전용 표기.

**§6-6 게스트 신규 삽입 2건(구현세션 대조 — 나머지 5항은 위 표대로 기존 강화)**:
- **갭① emit 순서 (우선순위 높음 — 파트너 실증 함정)**: GUIDE `:571`은 "게스트 완료 이벤트에 pageCount/size 미포함(로그인 유도 신호)"까지만 말하고 **순서를 명시 안 함**. 실제로는 `editor.complete`(needsAuth:true)가 **먼저**, `editor.needAuth`가 **나중**. → `:571` 근처에 **"`editor.complete` 수신 시 `needsAuth`를 먼저 확인 — `true`면 주문/승격 금지, 로그인 유도로 분기"**를 순서 명시와 함께 강화 삽입. (구현세션 quickstart `editor-session-order`가 이 함정으로 P1: complete 즉시 승격→게스트 **404**, 뒤이은 needAuth가 화면을 덮음. 수정 방향 = `complete.needsAuth===true`면 승격 skip)
  - **[병합 적대검증 발견 A②] 이중 실행 가드 필수**: 예제가 `complete`·`needAuth` **양쪽에서 `promptLoginThenMigrate`를 무조건 호출**하면 편집기가 두 이벤트를 항상 연속 발신하므로 **매 게스트 완료마다 100% 두 번** 실행된다. `handledGuest` 가드로 1회화. ⚠️ **dedup 키로 `sessionId`를 쓰면 안 됨** — `editor.needAuth` payload에 `sessionId`가 없어 2회 실행된다(리뷰어 실행 검증: 가드 1회 / 무가드·sessionId키 각각 2회).
  - **[병합 적대검증 발견 A③ · 중대] 승격 404의 진짜 이유 = NULL-site 거부**(회원 소유 아님이 아님): 게스트 라우트(`@Public`)가 `siteId`를 주입하지 않아 세션이 **`siteId=null`로 생성**되고, **`migrateGuestSessions()`가 `siteId`를 건드리지 않는다** → **회원 전환 후에도 승격이 안 된다**. 즉 D7 권고 (a) "마이그레이션 위임"은 **현재 서버 상태로는 작동하지 않음** — `migrate`에 `siteId` 주입 서버 수정이 선행돼야 게스트 퍼널이 성립(D7·D9 연동). 이유를 잘못 알면 파트너가 migrate 후 재시도하며 헛수고한다.
- **갭② 게스트 재오픈 URL**: GUIDE `:588`(§3.3)은 **재편집** 재진입만 다룸. 게스트→회원 전환 후 **같은 sessionId 재오픈** `/embed?sessionId=<동일>&token=<회원jwt>`은 신규. **§3.3에 "게스트 전환 케이스 추가"** 형태로 병합(재편집과 인접 → 중복 없음).

**frameAncestors 문서 정정 — 2곳(구현세션 이슈3)**:
- **GUIDE `:145`** "`site.frameAncestors` DB 필드는 死코드" → **정정**: 死코드 아님. 운영자 `PUT /api/sites` 등록이 `GET /api/frame-ancestors`→middleware 동적 CSP로 **재배포 없이 반영**. ⚠️ **반영 지연 최대 약 2분**(구현세션 정정): 서버 `Cache-Control:max-age=60` + 편집기 미들웨어 `CACHE_TTL_MS=60_000`의 **직렬 2단**. "60초"로 안내하면 t+70s에 확인한 운영자가 등록 실패로 오판→재배포 회귀. 정적 baseline은 superset-only 불변식. (구현세션: 병합 중 GUIDE 死코드 서술 총 6곳·`vercel.json` 재배포 요구 전부 정정 완료)
- **GUIDE `:47` 온보딩 절차 4단계 "(임베드 시) editor `vercel.json` frame-ancestors 반영" → 함께 폐기.** vercel.json 수동 편집+재배포는 불필요, 운영자 PUT 등록으로 대체. (안 고치면 파트너 온보딩이 계속 불필요한 재배포를 요구 — §6이 처음 잡은 `:145` 외에 이 절차도 정정 필요)

**병합면 조율(이슈5)**: §6은 §3(임베드)에 머무름 — 구현세션 v1 절(§5.1 전체 엔드포인트 표 `:713`)과 **본문 충돌 없음**. **본 세션은 §5.1을 건드리지 않음**(임베드 엔드포인트를 §5.1에 추가할 계획 없음). §5.1의 v1/레거시 구분 표기는 구현세션 소유.

---

## 7. [구현세션 수신 · b] 호스트→편집기 수신 명령 계약 초안 (SDK /embed 선결)

> **SDK `/embed` 착수의 유일 선결**(구현세션 확인: 수신 명령 미확정이라 `./embed` 미선언). **strict additive**: 발신 8종 FROZEN(+pricingChange ADDITIVE) 불변, 기존 4파트너 수신부는 명령을 보내지 않으므로 영향 0. `editor.pricingChange` ADDITIVE 선례 방식.
> **[2026-07-28 구현세션 이슈2 — 사후 추인]** 수신 3종은 이미 GUIDE `:581`에 산문으로 노출돼 있다(`e.origin===parentOrigin` + `source==='storige-host'` + `requestId` echo 서술). 따라서 CONTRACT_FREEZE 등재는 **신규 계약 제정이 아니라 既 GUIDE 노출분의 사후 추인(정식 계약 승격)**이다 — 등재 문구에 "既 GUIDE `:581` 노출분을 정식 계약으로 승격" 취지를 명기해 이력을 정확히 한다. 파트너가 이미 이 서술대로 명령을 보내고 있을 수 있으므로 §7.3 `e.source` 봉합은 **既노출 발신자 호환**을 전제로 한다.

### 7.1 봉투(기존, 불변)
```
host → editor: { source:'storige-host', version:'1', command, requestId?, payload? }
```
편집기 inbound 게이트: `e.origin===parentOrigin AND data.source==='storige-host'`(불변).

### 7.2 명령 계약 v1 — 기존 3종 정식화

| command | payload | 응답 이벤트 | 응답 유형 | 의미 |
|---------|---------|-------------|-----------|------|
| `getState` | `{}` | `editor.state{requestId,ready,dirty,sessionId}` (+D6 pageCount·currentPage) | **요청-응답**(requestId echo, `embed.tsx:588`) | 현재 상태 동기 조회 |
| `saveNow` | `{}` | `editor.saved{requestId}` | **요청-응답**(requestId echo, `:597,:600`) | 즉시 저장 트리거 |
| `setBackGuard` | `{enabled:boolean}` | 없음 | **fire-and-forget**(`:606-608` postToParent 미호출) | 브라우저 뒤로가기 가드 on/off |

> **응답 유형 구분 필수(구현세션 발견②)**: SDK `/embed`가 3종을 일관되게 Promise로 노출하면 `setBackGuard`만 영원히 pending. 계약이 유형을 명시했으니 SDK는 타입 레벨로 분리 노출 — `getState(): Promise<EditorState>` / `saveNow(): Promise<void>`(saved로 resolve) / `setBackGuard(on:boolean): void`(fire-and-forget). 신규 확장 명령(§7.4)은 각 행에 응답 유형을 반드시 명기한다.

### 7.3 확장 규약 (strict additive)
- **미지원 command는 편집기가 조용히 무시(no-op)** → 구버전 편집기·구버전 호스트 양방향 안전(`embed.tsx:609-610` `default: break`, throw 없음 — 구현세션 코드 검증). **호스트는 응답 이벤트 타임아웃으로 미지원을 판정**하되 실패로 취급하지 않는다.
- `requestId`는 호스트가 부여, 편집기는 응답 이벤트에 echo → 요청-응답 상관.
- 신규 명령은 이 표에 additive 추가만(제거·시맨틱 변경 금지). 편집기 발신 **8종 FROZEN(+pricingChange ADDITIVE)**은 절대 불변.
- **[구현세션 발견① · additive 봉합 대상] 편집기는 `e.source`가 자신의 부모(`window.parent`)인지 대조한다** — 현재 수신부(`embed.tsx:580-583`)는 origin + 봉투 `source` 필드만 검증하고 **`e.source` 대조가 없어**, parentOrigin과 **같은 출처의 다른 프레임/윈도우**가 명령을 주입할 수 있다(`saveNow` 강제·`setBackGuard{enabled:false}`로 가드 해제; `getState` 응답은 부모에게만 가서 유출 제한적). 조건부(호스트 XSS·오픈리다이렉트·서드파티 iframe 허용 시)라 심각도 P2지만 **계약 v1 확정 시점이 additive 봉합의 적기**. 기존 4파트너는 명령 미발신이라 영향 0. 구현세션이 등재 후 편집기 수신부에 additive 구현(호스트측 SDK `parseEditorMessage`는 `expectedSource` 필수화로 이미 대칭 방어 완료 — 편집기측만 비대칭이었음). **既노출 발신자 호환(이슈2)**: `window.parent` 대조는 정상 부모 프레임이면 통과하므로, GUIDE `:581` 서술대로 명령을 보내온 파트너는 영향 0 — 비정상 프레임 주입만 차단된다. → **개발이슈 D14.**

### 7.4 확장 명령 후보 (additive 제안 — 구현 별건, 우선순위 표기)
| 후보 command | 응답 | 용도 | 우선 |
|--------------|------|------|------|
| `navigateToPage{page}` | `editor.state`(currentPage 갱신) | host UI 페이지 네비 연동 | P1 |
| `setReadonly{on}` | `editor.state` | host가 미리보기 모드 강제 | P2 |
| `requestThumbnail{page}` | `editor.thumbnail{page,dataUrl}`(신규 이벤트, additive) | host 장바구니 썸네일 | P2 |
| `reload` | `editor.ready` | 세션 재로드 | P2 |

> SDK `/embed`는 7.2를 타입드 메서드로 노출(`instance.getState()`/`saveNow()`/`setBackGuard(on)`), 7.4는 편집기 구현 후 additive 노출. **이 계약을 CONTRACT_FREEZE에 "수신 명령 계약 v1(ADDITIVE)"로 등재 권고**(구현세션 소유).

---

## 8. 오너 결정 필요 (임베드 공개 관련)

| # | 결정 | 관련 | 권고 |
|---|------|------|------|
| 1 | **frameAncestors 셀프서브 등록 허용** — DB→CSP 동적 배선은 완결, DTO에서 의도적 제외. 파트너 셀프 등록 개방? | D2 | 개방(isValidAncestorSource 검증 존재)하되 test 키 한정 |
| 2 | **백엔드 없는 파트너용 브라우저-안전 토큰 교환** `/api/v1` 신설? | D3 | 순수 프론트-only 파트너 수요 확인 후 |
| 3 | **파트너 계정 셀프 가입** vs 운영자 프로비저닝 유지 | D3 | test는 셀프, live는 운영자 게이트 |
| 4 | **서버측 게스트 PDF 생성** 지원? (과금·격리 리스크) | D7 | 기본 (a) 마이그레이션 위임, 서버 지원은 보류 |
| 5 | **웹훅 HMAC 신규 기본 강제 시점** | D10/E-8 | 신규 파트너 처음부터 HMAC/v2 |
| 6 | **사이트별 기능 플래그 격리** 투자? | D12 | 전역+롤백 절차로 시작, 파트너 증가 시 격리 |
| 7 | **임베드 dev/staging 샌드박스** 구축 승인 | Stage 5 | 셀프서브 시험 환경 필수 — 승인 권고 |
| 8 | **IIFE 공개 정책** — deprecate 표기 vs 인라인 한정 유지 | D4 | 신규 비권장 표기, bookmoa PHP 보류 유지 |
| 9 | **shop-session throttle 상향** 기준(고볼륨) | 주의4-11 | 온보딩 협의 기준 문서화 |
| 10 | **R2 CORS `ExposeHeaders:[ETag]`** 설정(대용량 presigned) | 주의4-13 | 대용량 임베드 파트너 온보딩 전 필요(인프라 작업) |
| 11 | **레거시 `storige:completed`에 `needsAuth` 부재**(구현세션 병합 발견 C) — 게스트 완료 시 레거시 dual-emit도 발신되나 화이트리스트에 needsAuth가 없어, **레거시만 수신하는 호스트엔 `files:{coverFileId:null, contentFileId:null}`인 "정상 완료"처럼 보임**(게스트 오완료). CONTRACT_FREEZE 레거시 dual-emit 행이라 구현세션 판단 불가 | D8/레거시 계약 | 선택지: (A) 레거시 채널에 needsAuth 추가=동결 변경(레거시 수신부 영향 검토 필요) vs (B) 레거시 수신 호스트에 "신규 게스트 퍼널 미지원" 안내 후 v1 엔벨로프 유도. **오너 결정** |

---

## 9. 서버측 결함 참조 (구현세션 소유 · 읽기 인용)

> 정본: `.cursor/plans/OWNER_DECISIONS_2026-07-07.md`(구현세션). 임베드 공개에 영향 있는 것만 발췌·정정 반영.

- **E-1**: 멀티파트 멱등 지문 맹점 — 인터셉터가 multer보다 먼저 실행 → `request_hash=sha256('{}')` 상수 → 같은 Idempotency-Key·다른 파일 = 조용한 유실(supertest 실증). SDK가 멀티파트 자동부여 금지로 우회하나 서버 근본수정 필요(+회귀 spec 부재=E-7).
- **E-8**: v1↔v2 웹훅 identifier 상이(`fin_` vs `whd_`) → v1 검증 코드는 v2 전환 시 전량 401(주의 §4-14).
- **E-9(재정정)**: bookmoa는 레거시 헤더만 읽는데 v2는 미전송 → **오늘 v2 수신 자체 불가**. 실 충돌은 v1 큐 적체>10분 시 ±10분 신선도 게이트.
- **E-10**: v1 base64 서명 위조가능·ShareSnap 무검증 구멍(D10).
- **E-4(오탐·취소)**: `STORAGE_MAX_FILE_SIZE` 50 vs 100MB는 결함 아님 — 별개 두 업로드 표면(storage.controller 50MB / files.controller 100MB)이 각자 내부 일관. `files.service`는 `ObjectStorageService` 주입(≠StorageService).
- **S-2(종결)**: `WORKER_MAX_FILE_SIZE=2GB` 실측. "1GB" 스테일, "90MB"는 100p 자작 클라 마진.
- **[병합 발견] 게스트 `migrate` siteId 미수정**: `migrateGuestSessions()`가 세션 소유권만 회원으로 옮기고 `siteId=null`을 그대로 둠 → NULL-site 승격 404. D7·D9와 연동, 서버 수정 필요(구현세션 소유).
- **[병합 정정 요약]** 발신 8종 FROZEN+pricingChange ADDITIVE(9종 아님) · 레거시 dual-emit 노출값=sessionId+fileId(guestToken 아님, 상호배타) · frameAncestors 반영 최대 약 2분(60+60 직렬) · 게스트 404=NULL-site.

---

## 10. 관련 산출물 · 협업 상태

- **상위 정본**: `.cursor/plans/SWEETBOOK_GAP_ROADMAP_2026-07-07.md`(§10에 이 문서 포인터 추가). **Stage 4 절 = 구현세션 개정분 보존**(수작업 SDK·quickstart 3종·포털 제약).
- **시각화**: `outputs/EMBED-OPENING-DASHBOARD_2026-07-28.html`
- **조사 원본**: 워크플로 `wf_82e16b39-e28`(o5-repo-scout ×5+완전성+적대검증, 19/2). journal: `subagents/workflows/wf_82e16b39-e28/journal.jsonl`
- **협업 경계**: 본 세션=`.cursor/plans/` 기획+대시보드 / 구현세션=`docs/` 포털·`apps/*`·`packages/*`(`feat/p4-docs-portal`·`feat/p4-sdk-client`). §6(GUIDE 개정안)·§7(수신 명령 계약)은 구현세션 수신용.
- **넘길 다음 액션**: 구현세션에 §6·§7 전달 완료 핑 → SDK `/embed`(Stage 3)·E-3 포털 임베드 섹션 착수 가능.
