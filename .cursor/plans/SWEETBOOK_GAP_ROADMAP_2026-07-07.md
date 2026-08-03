# SWEETBOOK 격차 분석 & 개방형 플랫폼 로드맵 (정본 v2.0 — 최종)

> **v2.0 (2026-07-07 최종)**: Codex 보고서(`outputs/sweetbook_vs_bookmoa_storige_platform_upgrade_report_2026-07-07.md`) 전문 대조 후 통합. 아키텍처 중심축을 **Partner Platform API v1 파사드**로 재정렬, Stage 0~6 재편, 작업지시 프롬프트 A~G, 오케스트레이션 마스터 프롬프트 분리(`ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`).
> **v1.0 (2026-07-07)**: Claude(Fable 5) 멀티에이전트 워크플로(에이전트 20, 도구호출 353회) — sweetbook 문서 36페이지 전수 + storige 6축 코드 실태 + 적대 교차검증(storige측 30건 확인/4건 정정, sweetbook측 9건 확인/과장 삭제).
> **시각화**: `/Users/yohan/Documents/Codex/2026-07-02/new-chat/outputs/SWEETBOOK-GAP-ROADMAP-DASHBOARD_2026-07-07.html`
> **선행 정본과의 관계**: `PLATFORM_EXPANSION_PLAN_2026-07-03.md`(Phase 0~6)·`ROADMAP_REALIGNMENT_2026-07-03.md`(3트랙 C/P/S)를 대체하지 않고 **P트랙의 실행 순서를 구체화**한다.

---

## 0. 오너 지시 해석 + 절대 제약 (이 문서의 발효 조건)

기존 규율은 "파트너 확약 0이면 확장 코드 0"(P트랙 트리거)이었다. 2026-07-07 오너 지시 — *"현재 플랫폼을 sweetbook처럼 누구나 연동하고 참여할 수 있도록 보완"* — 는 **P트랙 가동에 대한 오너 결정으로 해석**한다:

- **Stage 0~1**(주춧돌·v1 코어)은 즉시 착수 — 저비용·무중단·기존 계획(Phase 1 선결 S-1 등)과 정합.
- **Stage 2~4**(셀프서브·Books·DX)는 이 문서 승인 시 착수.
- **Stage 5**(템플릿 개방)는 Stage 2·3 머지가 선행 조건(기술 게이트 — 오너 미결 없음). **Stage 6**(과금·주문·신뢰)은 §8 오너 미결(1·2·5·7)이 풀려야 착수 — 단 미터링·마이그레이션 계획서 선작성은 결정 무관.

**절대 불변 제약(모든 Stage 공통)**:
1. 기존 파트너 4곳(bookmoa-mobile·ShareSnap=임베드형, 100p_books·MD2Books=워커형) **무중단**.
2. **additive-only** — 기존 `/external`·동결 16라우트(`docs/CONTRACT_FREEZE.md`) 시맨틱 불변. `contract-freeze.spec.ts` CI green이 모든 머지의 전제.
3. 웹훅 **v1(base64) 계약 유지** — v2는 opt-in만.
4. 신규 표준은 기존 표면에 retrofit하지 않고 **`/api/v1` 신규 표면에 실장**(§4 아키텍처 결정 AD-1).
5. 운영 순차 의존 준수: 마이그레이션 → API 재배포 → nginx 재시작 순서 위반 금지.
6. 테스트 무결성: 티켓 없는 `.skip` 금지, 대상 함수 자체 모킹 금지, 테스트 무단 비활성 금지.

---

## 1. sweetbook은 무엇인가 (36페이지 전수조사 요약)

**정체**: Sweetbook Inc.의 "Book Print API" — 포토북/책의 **생성→주문→인쇄→배송 전 과정을 자동화하는 B2B REST API**. 자사가 인쇄·제본·발송 풀필먼트까지 수행. 편집기는 없음(파트너가 자체 UI를 만들고 템플릿 파라미터 바인딩으로 서버 렌더링).

**연동 모델(벤치마크 실측)**:
- **온보딩**: 이메일 인증만으로 5분 셀프서브 가입 → Sandbox API Key 즉시 발급. Live는 사업 협의 후 Business 전환(**2단 게이트**).
- **환경**: `api-sandbox`/`api` 도메인 완전 분리(데이터·충전금·키). Sandbox 주문은 PAID 정지·실인쇄 없음. 키-환경 불일치 403 `ERR_ENV_MISMATCH`.
- **인증**: `SB{prefix}.{secret}` Bearer. 발급 시 1회만 전체값 노출, IP 제한(최대 10), 환경 매트릭스에 `/v1/keys` CRUD 등재.
- **리소스 모델**: `POST /books`(creationType: PDF_UPLOAD/TEMPLATE/MIX_COVER_TEMPLATE) → 표지/내지 투입(POST=신규/PUT=교체) → `finalization`(DRAFT→FINALIZED) → `POST /orders`(충전금 자동 차감) → 웹훅 추적. 주문 상태머신 11종, 부분취소·차액환불·배송지변경 완비.
- **템플릿**: 공개 Templates API — `parameters.definitions` 바인딩(`$$변수$$`/`@@변수@@`), baseLayer(odd/even), layoutRules, **JSON Schema draft-07 엔드포인트**. 단 공급은 자사 제작만.
- **사이즈**: `GET /book-specs/{uid}/calculated-size?pages=n` — mm 단위 표지/내지/책등 반환, **"응답대로 만들면 ±1mm 검증 자동 통과" 보장**. 소프트커버 공식 공개, 하드커버는 spineWidthRules 구간값.
- **과금**: KRW 선불 충전금. 차감 공식 명문화 `floor((상품+배송+포장)×1.1/10)×10`, reasonCode 9종, 402+진단객체, estimate, Sandbox 가상 충전/차감.
- **웹훅**: HMAC-SHA256(`{timestamp}.{body}`, `sha256=`), 헤더 4종, 재시도 1/5/30분 3회+EXHAUSTED(1h 쿨다운), 전송 이력 조회, 테스트 발송, 이벤트 9종. 페이로드 snake_case(REST는 camelCase).
- **운영 표준**: Idempotency-Key(books 4+orders 3, 24h 캐시, 불일치 422), limit/offset+`pagination{total,limit,offset,hasNext}`, 레이트리밋 3정책(auth 10/min IP·general 300/min Key·upload 200/min Key)+`Retry-After`, **6필드 에러 봉투**+errorCode 카탈로그+"errorCode로 분기, 메시지 파싱 금지".
- **DX**: Python·Node SDK, 데모 앱, 시나리오 가이드 3종, go-live 체크리스트, changelog(v1.0~v1.2.4, Breaking 릴리스 2회·항목 5건).
- **AI 에이전트 지원(1급)**: `llms.txt`(~1K토큰)+`llms-full.txt`(~30-50K)+36페이지 `.md` URL+md에만 노출되는 AGENT INSTRUCTIONS 9페이지.
- **식별자**: `or_` `oi_` `bk_` `evt_` `wh_` `whsk_` uid 접두 체계, ISO 8601 UTC.

---

## 2. 우리 서비스의 강점 (코드 실증)

1. **임베드 편집기 — sweetbook에 없는 카테고리.** iframe `/embed` + IIFE 번들 + postMessage 엔벨로프 v1(이벤트 9종·명령 3종). sweetbook 파트너라면 직접 만들어야 하는 편집 UX 전체를 임베드 한 번으로 제공.
2. **편집 깊이**: fabric.js 플러그인 23종 — 스프레드 표지(책등 가변폭), 사진틀 스왑, 4단계 잠금+보호객체+고객시점 미리보기, QR/바코드, 배경제거, 모바일 터치 보정.
3. **포토북 수직 통합**: EXIF 자동배치 4모드, 2-up 펼침면, 책등 계산기+3D 목업, `editor.pricingChange` 장바구니 연동.
4. **인쇄 프리플라이트 깊이**: 색상 2단 감지(GS inkcov), 별색/투명도/오버프린트/폰트 감지, 자동수정 4종, compose-mixed outputMode 4종, 중철 2-up·duplex-split·spread 합성, 2GB 경량 qpdf 경로, 합성 멱등 마커.
5. **계약을 코드로 집행**: `contract-freeze.spec.ts` 리플렉션 CI 게이트 — sweetbook의 문서 changelog보다 강한 회귀 방지.
6. **멀티사이트 테넌트 인프라**: site 키 2종/CORS·웹훅 allowlist DB 동적/retentionDays cron/shop-session JWT 전파.
7. **서버간 보안 가드**: 웹훅·다운로드 SSRF 방어.
8. **대용량 처리 실전 이해**: 2GB 보장 계획, presigned multipart, 워커 메모리 병목 분석 (Codex 보고서도 동일 지목).
9. **실전 무중단 운영 규율**: 파트너 4곳 프로덕션 의존 하 additive-only 문화.

**전략 함의(양 보고서 수렴)**: sweetbook 복제가 아니라 **storige 생산 엔진 위에 파트너 플랫폼 계층을 얹는 것**. 격차는 기능이 아니라 "누구나 연동을 시작할 수 있게 하는 포장" 전 영역.

## 3. 우리 서비스의 약점 (심각도순, 적대검증 반영)

| # | 약점 | 심각도 | 실증 근거 |
|---|------|--------|-----------|
| W1 | **과금/수익 모델 전무** — 가격·빌링·정산 설계가 코드/계획 문서 어디에도 없음 | P0(사업) | 갭 문서 자인 |
| W2 | **에러/타입 계약 비표준** — 라우트별 임의 shape, 카탈로그 부재, S-1(ValidationResult 정본 불일치), `STORIGE_NOT_S3` vs `STORAGE_NOT_S3` 표기 불일치 | P0 | 실코드 대조 |
| W3 | **SDK·레퍼런스·데모 0** — Swagger는 프로덕션에 **무가드 공개 서빙 중**(`/api/docs`·`/api/docs-json`·`/api/docs-yaml` 실측 HTTP 200, `main.ts:186-200` NODE_ENV 분기 없음). ⚠️ **파트너에 의도적 공개**(PHP_INTEGRATION_FINAL_v3·KICKOFF 등이 참조 자원으로 안내)이나 파트너 라우트가 아닌 **내부 표면 전체 204 오퍼레이션**(auth/login·sites/regenerate=API키 재발급·admin/storage-settings·operators 포함)이 함께 노출 — 과다노출은 비의도 가능성 높음(§8-10). 시크릿 유출은 없음(admin 이메일 example만). 스펙 export 0, 유일 레퍼런스(100p client.ts 644줄)는 파트너 레포에만 | P0 | DX 조사+실측(2026-07-07) |
| W4 | **법률/신뢰 자산 부재** — 약관·DPA·SLA·상태페이지 0. 수취인 개인정보 수탁 구조상 DPA는 법적 전제 | P0(오너) | Codex 보고서 미포함 항목 |
| W5 | **셀프서브 온보딩 0%** — Site 생성·키 발급·frame-ancestors(vercel.json 커밋+재배포, DB 필드 死코드) 전부 수작업 | P1 | 가이드 §1.1 |
| W6 | **샌드박스/환경 모델 부재** — 단일 프로덕션 VPS, dev/staging "TBD" | P0 | 가이드 §1.3 (양 보고서 P0 수렴) |
| W7 | **웹훅 신뢰성 열위** — v1 base64 위조 가능(동결), HMAC 전역 단일 secret additive 발신뿐, 재시도 1회 2s, config/이력/테스트/재발송 API 없음. ⚠️ bookmoa 수신부 hex 호환 **미검증** | P1 | `webhook.service.ts:172-194` |
| W8 | **키 보안 부채** — 평문 저장·동등비교, 즉시교체 회전, editor==worker 동일값 시드 | P1 | `sites.service.ts:65-103` |
| W9 | **테넌트 격리 구멍** — NULL-siteId 전면 통과, worker 역할 바이패스, split-synthesize/check-mergeable external site 스탬프 부재 | P1 | CONTRACT_FREEZE §4.3 |
| W10 | **책(Book) 단위 공개 리소스 부재** — 세션+잡 모델뿐, "주문 가능한 최종 인쇄 데이터"(finalization) 상태가 공개 API에 없음. 파트너가 파일·세션·잡을 직접 조립 | P1 | Codex 핵심 지적 채택 |
| W11 | **외부 라우트 멱등성 부재** — requestId 멱등은 내부 합성 3경로뿐 | P1 | unique 인덱스 인프라 존재 |
| W12 | **BookSpec(판형 마스터) 부재** — 판형이 template_sets 자유입력 width/height로 분산, spine 계산 API 3종은 @Public 기존재하나 **미문서화**·책등 한정 | P1 | `spine.controller.ts:17-51` (v1 검증 정정) |
| W13 | 페이지네이션·per-Key 레이트리밋·429 문서화·버저닝·외부 changelog 부재 | P2 | 가이드에 '429' 0건 |
| W14 | AI 에이전트 채널(llms.txt/.md URL) 부재 — 문서가 이미 md라 비용 최소 | P2 | — |
| W15 | **템플릿 개방 불가** — siteId 쓰기 경로 부재(전부 NULL 생성), 검수 상태머신 없음, `with-templates` @Public 무스코핑, 복제 필드 유실, by-product sortcode 강결합 | P1~P2 | 템플릿 조사 |

---

## 4. Codex 보고서 대조와 아키텍처 결정

### 4.1 대조 결과

| 구분 | 내용 |
|------|------|
| **수렴(양쪽 동일 결론)** | 강점=생산 엔진/약점=API 상품성 · additive-only+CONTRACT_FREEZE 기반 · 에러 봉투/멱등성/웹훅 이력/샌드박스/BookSpec P0 · llms.txt AI 문서 · 파트너 여정(가입→Sandbox→협의→Live) 재정렬 · 웹훅 v2 opt-in(HMAC 정식화) · 파트너 포털 필요성(P1) |
| **Codex에서 채택** | ① `/api/v1` Partner Platform **파사드 계층**(기존 /external 직접 노출 탈피) ② **Book aggregate + finalization**(DRAFT→FINALIZED) ③ **`EDITOR_SESSION` 제4 생성모드**(storige 고유 — 편집기 세션을 책으로 승격) ④ 웹훅 delivery store+**수동 retry API** ⑤ **Settlement Ledger vs Credit Wallet** 선택 프레임(초기엔 Ledger 권고+Sandbox 가상 잔액) ⑥ 신규 테이블 12종 후보 ⑦ templateKind 매핑(cover/content/divider/cover_component) ⑧ 봉투에 `requestId` ⑨ 멱등 처리 중 동일키 `409 ERR_IDEMPOTENCY_IN_PROGRESS` ⑩ `public_api_audit_logs` ⑪ 경량 Orders(생산 상태 추적 — 배송/결제 미포함) |
| **본 문서 유지(Codex 미포함)** | ① Stage 0 즉시 항목(S-1·STORAGE_NOT_S3·site 스탬프 비대칭·GUARDED 계약 테스트) ② 셀프서브 **구현 상세**(키 해시/1회 노출/오버랩 회전·frameAncestors 활성화 — 포털 필요성 P1·2단 게이트 여정 자체는 Codex 격차표·Phase 5에도 존재, 구현 설계만 본 문서) ③ **템플릿 공급 개방**(Codex는 읽기 schema만 — "참여" 요건의 핵심) ④ 법률/DPA/SLA ⑤ 웹훅 v2 **선행 게이트**(수신부 실물 대조 — v2 opt-in 자체는 수렴) ⑥ sweetbook 세부 실측치(재시도 1/5/30분·차감 공식·AGENT INSTRUCTIONS 9페이지 실측 — 가드 문서 '개념'은 Codex Phase 4에도 존재) ⑦ 기존 3트랙/P트랙 규율과의 정합 |
| **충돌 해소** | 본 문서 v1.0(당일 초안, 제자리 개정 — 원문 이력은 세션 기록에만 존재)은 "표준을 기존 /external에 retrofit"(멱등키 추가 등) 방향이었으나 Codex의 v1 파사드가 우월 — **AD-1로 해소**(아래). /external retrofit은 폐기하고 문서화만 유지 |
| **Codex 참조 주의** | Codex의 "먼저 읽을 문서" 중 `MASTER_STATUS_2026-06-17.md`(6/17)·`PLATFORM_WORKER_INTEGRATION_v1.md`(5/19)는 **스테일** — 정본은 `PLATFORM_INTEGRATION_GUIDE.md`(7/6)+`CONTRACT_FREEZE.md` v1.1. 또한 Codex는 07-03 정본 계획(PLATFORM_EXPANSION_PLAN·ROADMAP_REALIGNMENT) 미반영 |

### 4.2 아키텍처 결정 (AD)

- **AD-1 (v1 파사드가 표준의 유일한 실장 지점)**: 표준 에러 봉투·멱등성·페이지네이션·per-Key 레이트리밋·Bearer 병행 인증은 신규 `/api/v1/*` 표면에만 실장한다. 기존 `/external`은 동결 유지(변경 0, 문서화만) — 동결 계약을 건드릴 위험을 구조적으로 제거하고, 기존 파트너는 v1 이관 시 혜택을 받는 경로로 유도.
- **AD-2 (생성모드 4종)**: `PDF_UPLOAD`(업로드→검증→합성) / `TEMPLATE`(바인딩→렌더) / `MIX_COVER_TEMPLATE`(표지 템플릿+내지 PDF→compose) / **`EDITOR_SESSION`**(임베드 편집기 세션 승격 — sweetbook에 없는 storige 차별재). 내부적으로는 기존 edit_sessions/files/worker_jobs를 오케스트레이션하는 파사드.
- **AD-3 (finalization 게이트)**: Book은 DRAFT(자산 투입 가능)→FINALIZED(주문/생산 가능, 편집 불가) 상태머신. finalization이 내부적으로 검증→합성 잡을 실행하고 결과를 `book_finalizations`에 고정.
- **AD-4 (과금 = Ledger + Wallet 병행, 공통 미터링 기반)** ✅ 오너 결정 2026-07-28: B2B+SaaS 둘 다 제공. **미터링(worker_jobs/files 집계)을 공통 기반**으로 두고 그 위에 정산 인터페이스를 추상화 — 같은 사용량 데이터에서 **Ledger=월말 청구서**(B2B), **Wallet=실시간 차감**(SaaS)으로 분기. `credit_accounts`/`credit_transactions`는 겸용 설계. **Ledger 먼저 가동**(PG 불요, 기존 4파트너 검증), **Wallet은 SaaS 셀프서브 런칭 시**(402+estimate+PG 연동). Sandbox 가상 잔액은 둘 다 DX 제공.
- **AD-5 (인증)**: v1에서 `Authorization: Bearer`와 `X-API-Key` 병행 수용(신규 문서는 Bearer 우선 표기). 기존 ADR-3(X-API-Key 통일)과 충돌 없음 — 검증 로직은 동일 키.
- **AD-6 (B2B/SaaS 3레이어 순차)** ✅ 오너 결정 2026-07-28: B2B와 SaaS는 별개 제품이 아니라 **B2B ⊂ SaaS**(부분집합). 동시 풀스케일 금지 — **[공통 기반] v1 API·SDK·2단 게이트(D2)·미터링·논리 샌드박스(D3·D4)·문서 포털 → [B2B 레이어] Ledger 정산·운영자 live 승인·개별 계약서 → [SaaS 레이어] Wallet 결제·live 셀프승인·표준약관/DPA·실분리·프론트-only 토큰(D6)** 순서. B2B로 "임대가 팔린다"를 검증한 뒤 SaaS의 무거운 투자(결제·법률·실분리). SaaS 포기가 아니라 순서를 둠. Stage 매핑: 공통=Stage 1~4, B2B=Stage 6 초기, SaaS=Stage 6 확장.

### 4.3 신규 모듈/테이블 (Codex 설계 채택+보정)

모듈: `partner-api`(v1 라우터·봉투·가드) / `book-specs` / `books` / `template-schemas` / `webhook-deliveries` / `idempotency` / `public-docs` / (오너 게이트 후) `orders` `credits`.
테이블 **13종**(Codex 12종 + `book_specs` 신설): `partner_api_keys`(env scope) · `partner_idempotency_keys` · `book_specs`(**판형 마스터 신설** — 현재 template_sets 자유입력 분산을 정규화) · `books` · `book_assets` · `book_finalizations` · `webhook_configs` · `webhook_deliveries` · `public_api_audit_logs` · (게이트 후) `orders` `order_items` `credit_accounts` `credit_transactions`.

---

## 5. 격차 매트릭스 (18축 요약)

| 축 | sweetbook | storige | 판정 |
|----|-----------|---------|------|
| 온보딩/셀프서브 | 5분 셀프 가입+Sandbox 키 즉시 | 0% 셀프(화이트글러브) | **P1** |
| 인증/키 관리 | prefix+secret, 1회 노출, IP제한 | 평문 저장, admin 수동, 즉시교체 회전 | **P1** |
| 샌드박스/환경 | 도메인 분리+ERR_ENV_MISMATCH | 없음 | **P0** |
| 도서 생성 API | books+finalize 상태머신 | 세션+잡 모델(추상화 부재) | **P0**(v2 승격) |
| 사이즈 계산 API | calculated-size+±1mm 보장 | spine 3종 @Public 기존재·미문서화·책등 한정 | **P1** |
| 템플릿 시스템 | 공개 API+JSON Schema, 공급 자사만 | 모델 깊이 우위, 개방 불가 | **P1** |
| 편집기 | 없음 | 풀 WYSIWYG+3중 임베드 | **강점** |
| 주문/배송 | 풀필먼트 완비 | 호스트 책임(경량 생산상태 모델로 부분 대응 가능) | P2 |
| 크레딧/과금 | 공식·402·estimate 완비 | 전무 | **P0** |
| 웹훅 | HMAC+3회 백오프+이력+테스트 | base64 동결+1회 재시도+이력 없음 | **P1** |
| 멱등성 | 7라우트+24h 캐시+422/409 | 내부 3경로만 | **P1** |
| 페이지네이션 | limit/offset 통일 봉투 | 외부 없음 | P2 |
| 레이트리밋 | 3정책 per-Key+Retry-After | per-IP만, 429 미문서화 | P2 |
| 에러 표준 | 6필드 봉투+카탈로그 | 라우트별 임의 shape | **P0** |
| 문서/SDK/데모 | 36p 사이트+SDK 2종+데모 4종 | md 가이드 1본, SDK/데모 0 | **P0** |
| AI 에이전트 지원 | llms.txt+36p .md+가드 메모 | 없음 | P2 |
| 신뢰 자산 | 약관·방침·상태페이지·사례 | 0 (실운영 이력은 내부 자산) | **P0(오너)** |
| 테넌트 격리 | 계정 단위 자연 격리 | site 인프라 우위이나 NULL 관용·비대칭 | **P1** |

(+2 비교축: 버저닝/계약 안정성 P2 — CONTRACT_FREEZE CI는 내부적으로 sweetbook보다 강함 / PDF 검증 깊이 — **강점**)

---

## 6. 단계별 개발 로드맵 (최종 Stage 0~6)

> **번호 이관표**: v1 Stage 0→**0**, 1→**1**(v1 파사드로 재정의), 2→**2**, (신설 Books)→**3**, 3→**4**, 4→**5**, 5→**6**. Codex Phase 0→Stage 0, 1→1, 2→3, 3→6(오너 게이트), 4→5, 5→6(단 Partner Portal은 Stage 2), 6→4.
> 공통 지침: §0 절대 제약 + 검증 게이트(typecheck→build→test→contract-freeze.spec→해당 시 골든 하네스) + `pnpm --filter @storige/types build` 선행 + TS strict/any 금지.

### Stage 0 — 주춧돌 + v1 계약 설계 (즉시, 2~3일, 무중단·저위험)
1. **S-1 ValidationResult 타입 정본화** — worker 실물(`{isValid, metadata}`) 정본, 구형 `@deprecated` 별칭(additive).
2. **STORAGE_NOT_S3 표기 정정** — CONTRACT_FREEZE.md:61 오기 수정(100p 실물 미확인 → 코드 변경 금지, 문서+주석만).
3. **site 스탬프 비대칭 수정** — split-synthesize/check-mergeable external에 `@CurrentSite` 주입.
4. **GUARDED 계약 테스트** — 동결 16라우트 밖 외부 라우트의 가드·인증 시맨틱 리플렉션 고정.
5. **★ PARTNER_PLATFORM_API_V1_DESIGN 설계서** (코드 0, Codex Phase 0 채택) — `/api/v1` 라우트맵, 테이블 13종 DDL 초안(Codex 12종+book_specs), 에러 봉투+ERR_* 카탈로그 초안, 멱등 규칙(24h/422/409), 웹훅 delivery 상태 흐름, Book/BookSpec aggregate, 기존 재사용↔신규 구분, 회귀 방지 테스트 목록, CONTRACT_FREEZE 위배 후보의 Owner-Decision 분리.

**기대효과**: SDK/에러 표준의 타입 기반 확보, 격리 비대칭 상환, v1 전체의 청사진 고정(이후 Stage가 설계서 참조로 병렬화 가능).

### Stage 1 — Partner API v1 코어 인프라 (1~2주)
1. **partner-api 모듈** — `/api/v1` prefix, ApiKeyGuard 재사용+Bearer 병행(AD-5), 표준 응답 봉투 `{success,message,data,pagination}` / 에러 `{success:false,errorCode,message,errors,fieldErrors,requestId}` 전역 필터(v1 스코프), `public_api_audit_logs`.
2. **멱등성 미들웨어** — `Idempotency-Key`, scope=`siteId+env+method+path+key`, body hash, 동일키+동일본문=재전달, 다른본문=422, 처리중=409, TTL 24h. `partner_idempotency_keys` 테이블.
3. **BookSpecs API** — `book_specs` 판형 마스터 신설(products/spine·paper_types/binding_types·template_sets.productSpecs에서 정규화 수집), `GET /api/v1/book-specs`, `GET .../{uid}`, `GET .../{uid}/calculated-size?pageCount=` — 표지/내지/책등/블리드 mm+톨러런스 보장(워커 LEGACY 1mm와 정합 — **검증측 상수 변경 절대 금지**, 2026-06-10 회귀 이력).
4. **per-API-Key 레이트리밋** — ThrottlerGuard 커스텀(현행 per-IP 유지), 429+`Retry-After`, 한도표 문서화.
5. **OpenAPI 자동화** — v1 전용 태그·`openapi-partner.json` export+CI 아티팩트, 가이드 링크 등재. ⚠️ 실측: `/api/docs`가 프로덕션에 무가드 공개 서빙 중 — 큐레이션 시 내부 라우트 스펙 분리+비의도 노출 여부 오너 확인(§8-10)과 묶어 처리.
6. v1 페이지네이션 규약(limit 기본20/최대100, offset, `pagination{total,limit,offset,hasNext}`).

**기대효과**: 이후 모든 표면이 표준 위에서 생성됨. 재시도 안전·에러 분기 가능한 계약·기계가독 스펙. 기존 /external은 무접촉(위험 0).

### Stage 2 — 셀프서브 온보딩 + 웹훅 신뢰성 (2~4주)
1. **환경 모델(샌드박스 v0)** — `partner_api_keys.env(test|live)` 스코프, 테스트 키의 잡은 워터마크 더미 산출물+retention 24h, 웹훅 `isTest`, 환경 불일치 표준 에러. 별도 인프라 없이 논리 분리(실분리는 §8-4).
2. **파트너 포털 v0** — 권고: apps/admin 확장(SITE_ADMIN 재사용). 이메일 인증 가입→사이트 등록(온보딩 양식 셀프 입력화)→**테스트 키 셀프 발급**→allowedOrigins/callback/webhook URL 셀프 관리. **Live 키는 운영자 승인 큐(2단 게이트) — 자동화하지 않는다.**
3. **frameAncestors 활성화** — 死코드 DB 필드를 CSP 동적 생성에 연결, vercel.json 정적 값은 폴백 병존. 임베드 파트너 2곳 회귀 필수.
4. **키 보안 3종** — 해시 저장(신규 키부터 병행 기록+이중 검증, 빅뱅 금지) / 발급 1회 노출+prefix 마스킹 / 오버랩 회전(유예 72h+만료 배치).
5. **웹훅 v2 + delivery store** — `webhook_configs`(사이트·env별 secret 1회 노출, 이벤트 구독 목록) + `webhook_deliveries`(payload·응답코드·attempts·nextRetryAt) + 재시도 1/5/30분(Bull backoff) + `X-Storige-Delivery` + 이력 조회/상세 + 테스트 발송 + **수동 재발송** API. ⚠️ **선행 게이트**: bookmoa 수신부 실물 대조(hex/`t=` 호환 미검증) 전 기존 파트너 v2 전환 금지. v1 발신 바이트 불변. 신규 파트너 기본=v2 전용.

**기대효과**: 온보딩 리드타임 "운영자 의존"→"가입 즉시". 웹훅 유실→3회 백오프+이력+재발송. 키 폭발 반경 축소.

### Stage 3 — Books 라이프사이클 (2~4주, Codex Phase 2 채택)
1. **`books`/`book_assets`/`book_finalizations`** 테이블+모듈. `bk_` uid, creationType 4종(AD-2), 상태 DRAFT→FINALIZED.
2. **자산 라우트** — `POST/PUT .../pdf-cover`, `POST/PUT .../pdf-contents`(POST=신규/PUT=교체, 409/404 규약), `POST .../photos`, `POST .../cover`·`.../contents`(템플릿 바인딩), 내부적으로 기존 files/presigned 재사용.
3. **finalization** — `POST /api/v1/books/{uid}/finalization`: 페이지 규칙(BookSpec pageMin/Max/Increment) 검증→기존 worker validate→synthesize/compose 오케스트레이션→산출물 `book_finalizations` 고정→`GET .../pdf`. 재호출 멱등. 실패 시 표준 errorCode.
4. **EDITOR_SESSION 승격 경로** — 완료된 edit_session을 book으로 승격(`POST /api/v1/books {creationType:'EDITOR_SESSION', sessionId}`) — 임베드 편집기→API 주문 연결의 공식화. **storige 차별재.**
5. 상태 전이 테스트+GUARDED 계약 테스트 편입.

**기대효과**: 파트너가 파일·세션·잡을 직접 조립할 필요 제거(온보딩 비용 지배 요인 해소). "편집기 임베드→완성 세션→책→생산"의 단일 여정 완성 — sweetbook 불가 조합.

### Stage 4 — DX 완성 (2~3주, Stage 1 이후 병행 가능)

> **[2026-07-16 정찰 2기로 개정]** 착수 전 실물 검증에서 아래 문안이 실물과 충돌해 정정. 원 문안은 이력용으로 각 항목에 병기.

1. **@storige/sdk 초판** — 블루프린트 정본(단일 패키지+subpath `/client` `/embed` `/webhook`). **v1 API 우선 타깃**(구 /external은 legacy 어댑터). 폴링·봉투 파싱(ERR_* enum)·웹훅 v1/v2 검증.
   - ✅ **수작업 SDK 확정 (코드생성 불가)** — v1 전 표면 `@ApiResponse({type})` 0건 + 성공 봉투를 런타임 인터셉터가 씌워 OpenAPI에 부재 → 생성 스펙은 봉투 없는 알맹이만 서술. codegen 복구는 서버 22라우트 전면 개작 = "SDK는 소비만" 제약과 충돌 → 기각. OpenAPI는 **문서 렌더/계약 회귀 게이트** 용도.
   - ✅ **types 의존 금지** — packages/types는 private:true·2207줄 중 v1 계약 75줄 → 통째 배포 시 내부 도메인 모델 노출. SDK 자체 재선언 + 구조 등가성 테스트로 드리프트 감시.
   - ⚠️ **"멱등키 자동 부여" 정정** — 멀티파트 경로는 **자동 부여 금지**(서버 멱등 지문 맹점 E-1: 인터셉터가 multer보다 먼저 실행 → request_hash 상수 → 같은 키·다른 파일 = 조용한 파일 유실). fileId 참조(JSON) 경로만 자동 부여.
   - ✅ **"90/100MB 라우팅" 정정 → 100MB 단일** — 90MB는 storige 상수가 아니라 **100p_books 자작 클라이언트의 라우팅 마진**(CONTRACT_FREEZE:60). 직접 100MB / presigned 2GB / compose 기본 1GB. **S-2 선결 = 실측으로 종결**(결정6 아래 참조).
   - ✅ 배포 채널 = **결정 보류·private:true 유지**(D-10b).
   - ✅ **[2026-07-16 구현 완료]** `feat/p4-sdk-client` 5커밋 — 골격+shared(ErrV1 29종 자체 재선언+등가성 spec)+/client(v1 22라우트 전수: ping 1·book-specs 3·books 11·webhooks 7)+테스트 139. **runtime deps 0**, api 745 green(서버 무접촉 증명: 변경=packages/sdk/**만).
   - ⚠️ **subpath 현황**: `.`·`./client`만 선언. `./webhook`(수신 HMAC 검증)·`./embed`는 **미선언**(던지는 스텁을 선언하면 계약 약속이 되어 파트너 오도 → 구현 시 additive 추가). quickstart 3종 중 `webhook-receiver`가 `./webhook`을 요구하므로 **후속 단계에서 구현 필요**.
   - **SDK 자체 발견(수정 완료)**: 429 `Retry-After` 무한 sleep — 서버 지시값이 크면(`86400`) SDK가 24시간 잠김 → `maxRetryAfterMs`(기본 60초) 상한 도입, 초과 시 429를 던져 호출측이 스케줄.
2. **quickstart 샘플 3종** — ~~pdf-upload-order / editor-session-order(임베드) / template-order~~ → ✅ **개정(D-10c)**: `pdf-upload-order`(PDF_UPLOAD) / `editor-session-order`(EDITOR_SESSION+/embed, **차별재**) / **`webhook-receiver`**(웹훅 v2).
   - **template-order 불가 사유**: 템플릿 바인딩 라우트(설계서 §1.3 #12·#13)와 목록/상세/schema(#17~19)가 **전부 미구현**(Stage 5 종속). TEMPLATE·MIX_COVER_TEMPLATE는 서버가 422 `TEMPLATE_COVER_NOT_RENDERED` 반환. 4 creationType 중 종단 가동 = PDF_UPLOAD·EDITOR_SESSION 2종.
   - 교체 근거: 확정 3종이 SDK subpath 3종(`/client`·`/embed`·`/webhook`)을 **전수 커버** → 표면 검증으로도 정합. template-order는 Stage 5 후 추가.
   - `examples/` 신설(기존 `example/`은 WowMall 타 프로젝트 문서 — 혼동 방지, rename은 오너 확인 후).
3. **문서 포털** — PLATFORM_INTEGRATION_GUIDE 소스, 시나리오 3종+go-live 체크리스트+외부 changelog. 스테일 문서 deprecation 배너.
   - ✅ 호스팅 = **신규 Vercel 프로젝트 `storige-docs`**(D-10d). 정적 빌더 전례 0 → md→html 파이프라인 신설. `check:exposure`를 포털 빌드 게이트로 편입.
   - ⚠️ **정본 관계 = 병존(계층 분리)**. 포털은 신규 정본이 아니라 **GUIDE의 발행 채널**. 포털이 자체 본문을 가지면 4번째 정본이 생겨 사고 재생산. 포털 신규 저술 = 시나리오 3종·go-live·외부 changelog·API 레퍼런스(openapi-partner.json 렌더). 참조만 = GUIDE(본문)·CONTRACT_FREEZE. **V1 DESIGN은 내부 문서라 포털 비게재**(벤치마크·오너결정 포함).
   - 🚨 **선결 D-10a**: 타 세션이 `PLATFORM_INTEGRATION_GUIDE.md`를 Shopify 가이드로 전면 교체 중 → 파일명 커밋 시 **포털 소스 소멸**. 결정=파트너 정본 유지+Shopify 분리(`SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.md` 사본 생성 완료, 타 세션 조율 대기).
   - ⚠️ GUIDE는 **pre-v1 문서** — `api/v1`·`book-specs`·`Idempotency-Key`·`creationType`·`finalization` 전부 0건. Stage 1~3 v1 표면이 파트너 문서에 한 줄도 없음 → 포털 착수 시 **v1 표면 등재가 본작업**.
   - deprecation 배너 5종: `PLATFORM_WORKER_INTEGRATION_v1`(**능동적 유해** — WH001 지시문 5건이 각각 "이 문서는 프로덕션과 불일치" 경고 반복)·`PLATFORM_INTEGRATION_v1`·`PLATFORM_WORKER_INTEGRATION_AI_PROMPT`·`BOOKMOA_INTEGRATION_GUIDE`·`INDEX`(재생성).
4. **AI 에이전트 채널** — `llms.txt`+`llms-full.txt`+페이지별 `.md`, AGENT INSTRUCTIONS 가드(키 헤더·업로드 임계·웹훅 검증·"동결 계약 응답 필드 추측 금지"). 전례 0(llms/robots/sitemap·public/ 전무) → 신규.

**기대효과**: 연동 공수 644줄 자작→SDK import. AI 도구 경유 연동 표준화. 문서 신선도 단일화.

> ⚠️ **용어 혼동 주의**: "파트너 포털"(Stage 2 — 인증 앱·셀프 테스트키) ≠ "문서 포털"(Stage 4 — 공개 정적 사이트). **Stage 4는 온보딩 자동화가 아니다**(그건 Stage 2). Stage 4가 대체하는 것 = 발행·소비 채널(지시문 28건 수작업 배포 → 단일 URL, 자작 644줄 → SDK import).

**선행 게이트**:
- **E-2 ✅ 수정 완료(적대 검증 중)** — `feat/p4-openapi-books` 2커밋. OpenAPI 커버리지 **11→22 오퍼레이션**(16 paths = v1 전량). 재발 방지: v1 컨트롤러 FS 스캔을 공용 헬퍼(`testing/v1-controller-scan.ts`)로 추출해 **export 목록·REQUIRED_PATHS·실제 산출 문서 3중 대조**(`partner-openapi-surface.spec.ts`). 변이 실증(BooksController 제거 → 4단언 red). api 757 green.
  - ⚠️ **포털 제약 1**: `openapi-partner.json`은 **gitignored**(빌드타임 생성물) → 포털은 레포에서 읽을 수 없고 **빌드 시 `pnpm --filter @storige/api openapi:partner` 실행 필요**.
  - ⚠️ **포털 제약 2(렌더 품질)**: `@ApiResponse({type})` 0건 + 봉투가 런타임 인터셉터 소관 → 산출 스펙에 **응답 스키마 부재**(요청 DTO 3종뿐). 포털은 **경로·메서드·설명·상태코드만 렌더 가능, 응답 예시/타입 불가**. 개선(=`@ApiResponse({type})`+`allOf` 봉투 래퍼 전 라우트 부착)은 런타임 데코레이터 변경이라 AD-1 저촉 → **별건 트랙**(설계서 부록 C.1에 개선 경로 기록).
  - 📌 설계서 §1.8 "books 13 / 총 36라우트"는 **계획치**(구현=books 11, #12·#13 템플릿 바인딩은 Stage 5). 부록 C.4 기록.
- **E-1 (별건 서버 트랙)**: 멀티파트 멱등 지문 맹점 — **실스택 supertest 프로브로 실증 완료**(서로 다른 바이트 2건이 동일 `request_hash = sha256('{}') = 44136fa3…`). 추정이 아니라 확정. SDK가 우회(멀티파트 자동 부여 금지)하나 **서버 근본수정 필요**(+ 회귀 spec 부재=E-7).

### Stage 5 — 템플릿 생태계 개방 (3~5주)
1. **siteId 쓰기 경로** — DTO+서비스(전역 admin 임의 지정, SITE_ADMIN 자기 site 강제). 파트너 전용 템플릿의 최소 전제.
2. **읽기 스코핑 봉합** — `with-templates` @Public 무스코핑 수정(hybrid 적용, 에디터 부트스트랩 회귀 금지), findOne 테넌트 스코프, by-product sortcode 탈피(범용 상품코드 매핑, 기존 경로는 bookmoa 어댑터 동결).
3. **복제 필드 유실 수정** — 템플릿(type/판형/editable/deleteable/spreadConfig)·셋(editorMode/커버/가격/출력설정) 전 필드+회귀 테스트.
4. **SITE_ADMIN 제작 권한+검수 상태머신** — draft→submitted→approved→published(isActive는 published 동기 — 기존 노출 불변), 승인 이력, createdBy 귀속, admin 검수 큐 화면.
5. **템플릿 스키마 API (Codex Phase 4 채택)** — `GET /api/v1/templates/{uid}/schema`: canvasData에서 바인딩 슬롯(텍스트/이미지/갤러리/날짜) 추출→JSON Schema draft-07. templateKind 매핑(cover/content/divider/cover_component). AI 자동 조립(동화책·기억책·앨범)의 기반.
6. (후순위) 템플릿 버전 스냅샷+롤백.

**기대효과**: "편집기+파트너 전용 템플릿+AI 자동 바인딩" — sweetbook 불가 3중 조합. 외부 디자이너 공급→카탈로그 네트워크 효과.

### Stage 6 — 과금·주문·신뢰 (오너 게이트, 기술 2~3주+법무)
1. **미터링(결정 무관 선행 가능)** — worker_jobs/files 기반 site별 집계(잡·바이트·스토리지·웹훅)+admin 화면+CSV. 가격 결정 데이터.
2. **정산/크레딧 v0** — AD-4: Settlement Ledger 우선(후불 장부, `credit_accounts`/`credit_transactions` 겸용 설계)+Sandbox 가상 잔액. 오너가 Wallet(선불) 선택 시 402+estimate 추가.
3. **경량 Orders(오너 게이트)** — 파트너 주문 참조+생산 상태+산출물 상태만(배송/결제 미포함): `POST /api/v1/orders`(FINALIZED book만), estimate, 상태 CREATED→IN_PRODUCTION→PRODUCTION_COMPLETED(+FAILED/CANCELLED), partner orderId 매핑. 풀필먼트 결합(§8-7)과 독립적으로 가치 있음.
4. **법률 문서(오너+법무)** — 약관·DPA·SLA. 기술은 데이터 흐름/보존/파기 문서 지원.
5. **상태 페이지+사례 페이지**.
6. **멀티테넌시 잔여 부채** — NULL-siteId 이원 정책 집행(오너 결정), WORKER_API_KEY 마스터키 분리.

**기대효과**: 제안서에 가격을 쓸 수 있게 됨(파트너 확보의 전제). 법적 리스크 해소. "믿고 연동할 수 있는 사업자" 신호.

---

## 7. 작업지시 프롬프트 A~G (storige 세션 투입용)

> 각 프롬프트는 자립형. 순서 A→B→(C‖E 일부)→D→E→F→G. **서브에이전트 오케스트레이션으로 실행할 경우 `ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`를 대신 사용**하고 아래는 컨텍스트 패키지 원료로 쓴다.

### 프롬프트 A — Stage 0 (주춧돌 + v1 설계)

```
[Stage 0 — 주춧돌: 타입 정본화 + 격리 봉합 + Partner API v1 설계서]

세션 시작 프로토콜대로 CLAUDE.local.md → .cursor/plans/SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§0 제약, §4 AD, §6 Stage 0)
→ docs/CONTRACT_FREEZE.md → docs/PLATFORM_INTEGRATION_GUIDE.md → git log -10 을 먼저 읽어라.
Codex 보고서(/Users/yohan/Documents/Codex/2026-07-02/new-chat/outputs/sweetbook_vs_bookmoa_storige_platform_upgrade_report_2026-07-07.md)
§5~7도 설계 참고로 읽되, 그 문서의 "먼저 읽을 문서" 목록 중 MASTER_STATUS_2026-06-17·PLATFORM_WORKER_INTEGRATION_v1 은
스테일이므로 사실 근거로 쓰지 마라.

작업 5건 (1~4는 각각 별도 브랜치, 5는 문서만):

1. S-1 ValidationResult 타입 정본화 — worker DTO({isValid, metadata})가 정본. packages/types 에 신규 타입 추가,
   기존 {valid, fileInfo} 형은 @deprecated 별칭 유지(additive, 삭제 금지). 런타임 응답 shape 불변을 테스트로 증명.
2. STORAGE_NOT_S3 표기 정합 — 실코드 발신값을 rg 로 확정 후 docs/CONTRACT_FREEZE.md:61 의 STORIGE_NOT_S3 오기 정정.
   100p client.ts:328 실물 미확인이므로 코드 문자열 변경 금지 — 문서 정정+"파트너 실물 확인 필요" 주석만.
3. split-synthesize/check-mergeable external 에 @CurrentSite 주입 — validate/synthesize external 패턴 준용,
   기존 파트너 호출 불변을 계약 테스트로 증명.
4. GUARDED 계약 테스트 신설 — contract-freeze.spec.ts 패턴으로 동결 16라우트 밖 외부 라우트
   (validate/synthesize/split-synthesize/check-mergeable/fix-pagecount external, PATCH external/:id/status,
   imposition-preview, shop-session 계열)의 가드·인증 시맨틱을 리플렉션 고정. shape 은 고정하지 않는다.
5. docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md 작성 (코드 변경 0):
   - /api/v1 전체 라우트맵(book-specs/books/templates schema/webhooks config·deliveries/credits 자리)
   - 신규 테이블 13종 DDL 초안 — Codex 12종+book_specs 신설(partner_api_keys env scope, partner_idempotency_keys, book_specs 판형 마스터,
     books, book_assets, book_finalizations, webhook_configs, webhook_deliveries, public_api_audit_logs,
     orders/order_items/credit_* 은 오너 게이트 표기)
   - 응답/에러 봉투 정의({success,errorCode,message,errors,fieldErrors,requestId}) + ERR_* 카탈로그 초안
   - 멱등 규칙(24h TTL, 동일키+다른본문 422, 처리중 409), 페이지네이션 규약, per-Key 레이트리밋 정책
   - creationType 4종(PDF_UPLOAD/TEMPLATE/MIX_COVER_TEMPLATE/EDITOR_SESSION)과 기존
     edit_sessions/files/worker_jobs 재사용 매핑, finalization 상태머신
   - CONTRACT_FREEZE 위배가 필요한 항목은 구현 후보에서 제외하고 "Owner Decision Required" 절로 분리

제약: §0 절대 제약. 검증: types 선빌드 → 전체 typecheck/build/test → contract-freeze.spec green.
보고: Changed/Verified/Notes + 증거(명령·출력·커밋 해시).
```

### 프롬프트 B — Stage 1 (v1 코어 인프라)

```
[Stage 1 — Partner API v1 코어: 모듈 스캐폴드 + 봉투 + 멱등성 + BookSpecs + 레이트리밋 + OpenAPI]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§4 AD-1~5, §6 Stage 1)
→ docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md(Stage 0 산출 설계서 — 이것이 구현 명세다)
→ docs/CONTRACT_FREEZE.md 를 먼저 읽어라. Stage 0 머지 선행(git log 확인).

벤치마크 실측(sweetbook): 에러 봉투 6필드+ERR_* 카탈로그+"errorCode 분기, 메시지 파싱 금지" /
Idempotency-Key 24h 캐시·불일치 422·처리중 409 / limit(20/100)/offset+pagination{total,limit,offset,hasNext} /
레이트리밋 auth 10/min IP·general 300/min Key·upload 200/min Key + 429 Retry-After /
calculated-size "응답대로 만들면 ±1mm 검증 자동 통과" 보장.

작업 6건 (1→2 직렬, 3~6은 1 완료 후 병렬 가능 — 디렉터리 분리 준수):

1. partner-api 모듈 스캐폴드 — apps/api/src/partner-api/: /api/v1 prefix 라우터, 기존 ApiKeyGuard 재사용
   + Authorization: Bearer 병행 수용(AD-5, 동일 키 검증), v1 스코프 전역 예외 필터(표준 에러 봉투+requestId),
   성공 봉투 인터셉터, public_api_audit_logs(경로·siteId·latency·errorCode).
   기존 /external·/api 라우트는 일절 건드리지 않는다(AD-1).
2. 멱등성 미들웨어 — partner_idempotency_keys 테이블(마이그레이션 additive), 설계서 규칙대로
   (scope=siteId+env+method+path+key, body hash, 24h TTL, 422/409). v1 POST 라우트 전체 자동 적용.
3. BookSpecs — book_specs 판형 마스터 테이블 신설 + 기존 데이터 수집 스크립트
   (products/spine paper_types·binding_types + template_sets.productSpecs 정규화, 초기 시드는 관리자 확인 후 적용),
   GET /api/v1/book-specs, GET .../{uid}, GET .../{uid}/calculated-size?pageCount= —
   표지/내지/책등/블리드 mm + sizeToleranceMm 반환. 기존 SpineService 재사용.
   ⚠️ 워커 검증 상수(LEGACY_SIZE_TOLERANCE_MM=1mm, validation.config.ts:83-91)는 절대 변경 금지(2026-06-10 회귀 이력).
   톨러런스 보장 문구는 이 상수와 정합하는 값만 문서화.
4. per-API-Key 레이트리밋 — ThrottlerGuard 커스텀(키 단위 트래커, 현행 per-IP 300/min 병존),
   429 응답 Retry-After 헤더, v1 문서에 한도표.
5. OpenAPI — v1 전용 Swagger 태그, openapi-partner.json export 스크립트+CI 아티팩트,
   PLATFORM_INTEGRATION_GUIDE.md 에 링크 등재.
   ⚠️ 실측(2026-07-07): /api/docs 가 프로덕션에서 무가드 공개 서빙 중(main.ts 등록에 환경 분기 없음).
   내부/외부 태그 분리 시 내부 스펙 노출 차단안을 함께 제시하되, 접근 정책 변경 자체는 오너 확인 후(§8-10).
6. v1 페이지네이션 유틸 — limit/offset+pagination 메타. v1 목록 라우트 공통 적용.

제약: §0 절대 제약 + AD-1(기존 표면 무접촉). 검증: 빌드/테스트 + contract-freeze.spec + GUARDED spec
+ v1 e2e(봉투·멱등·429·calculated-size 정합) + 기존 파트너 스모크(100p 업로드→검증→합성 경로 불변).
```

### 프롬프트 C — Stage 2 (셀프서브 + 웹훅 신뢰성)

```
[Stage 2 — 셀프서브 온보딩: 환경 모델 + 파트너 포털 v0 + 키 보안 + 웹훅 v2/delivery store]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§6 Stage 2)
→ docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md → docs/CONTRACT_FREEZE.md §3(서명 3종 대조)·§4.1(발신 HMAC↔bookmoa 수신 불일치)
→ docs/PLATFORM_INTEGRATION_GUIDE.md §1 을 먼저 읽어라. Stage 0·1 머지 선행.
규모가 크므로 작업 1건=브랜치 1개, 순서 1→3→4→2→5.

벤치마크(sweetbook): 이메일 인증 5분 셀프 가입→Sandbox 키 즉시, Live 는 협의 후(2단 게이트).
키 1회 노출·prefix 표시·환경 불일치 403. 웹훅 HMAC-SHA256+재시도 1/5/30분+이력/테스트/재발송 API.

작업 5건:

1. 환경 모델(샌드박스 v0) — partner_api_keys.env(test|live) 스코프(설계서 준용).
   test 키의 합성 잡은 "TEST" 워터마크 더미 산출물+retention 24h 강제(워커 프로세서 isTest 분기),
   웹훅 페이로드 isTest 필드(additive), test 키의 live 전용 동작 호출 시 표준 에러(ERR_ENV_MISMATCH 상당).
2. 파트너 포털 v0 — 권고: apps/admin 확장(SITE_ADMIN 롤 재사용). 다르게 판단되면 구현 전 오너 확인 1회.
   기능: 이메일 인증 가입 → 사이트 등록(가이드 §1.1 온보딩 양식 셀프 입력화) → test 키 셀프 발급/폐기
   → allowedOrigins·uploadCallbackUrl·webhookUrl 셀프 관리. Live 키는 운영자 승인 큐 — 자동화 금지.
3. frameAncestors 활성화 — 死코드 site.frameAncestors 를 편집기 CSP frame-ancestors 동적 생성에 연결.
   vercel.json 정적 값 폴백 병존(무중단). bookmoa-mobile·ShareSnap 임베드 회귀 확인 필수.
4. 키 보안 3종 — ①해시 저장: 신규 키부터 해시 컬럼 병행 기록, 검증은 해시 우선→평문 폴백(빅뱅 전환 금지)
   ②발급 응답에서만 전체값, 이후 prefix 마스킹 ③오버랩 회전: regenerate 시 구키 유예 72h 컬럼+만료 배치.
5. 웹훅 v2 + delivery store — ⚠️ 선행 게이트: 발신 HMAC(hex, t= prefix)과 기존 파트너 수신부 실물 호환은
   미검증. bookmoa PHP/모바일 수신 코드 확보·대조 전에는 기존 파트너 v2 전환 금지. v1 발신 바이트 불변.
   - webhook_configs(사이트·env별 secret 1회 노출, 이벤트 구독 목록) + webhook_deliveries(payload·응답·attempts·nextRetryAt)
   - 재시도 1/5/30분(Bull attempts/backoff — app.module.ts 비멱등 주석 확인, X-Storige-Delivery ID 로 수신 멱등 지원)
   - GET /api/v1/webhooks/deliveries(+/{id}), POST /api/v1/webhooks/test, POST .../deliveries/{id}/retry(수동 재발송)
   - PUT/GET/DELETE /api/v1/webhooks/config. 신규 파트너 기본=v2 전용(base64 부채 미확산).

제약: §0 절대 제약. WEBHOOK_SECRET 전역 단일→사이트별 이관 시 기존 발신 경로 회귀 금지.
검증: 빌드/테스트/계약 spec 2종 + 임베드 파트너 2곳 골든 시나리오 + 웹훅 v1 발신 바이트 불변 확인.
```

### 프롬프트 D — Stage 3 (Books 라이프사이클)

```
[Stage 3 — Books 라이프사이클: book aggregate + creationType 4종 + finalization]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§4 AD-2·AD-3, §6 Stage 3)
→ docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md(aggregate 설계) → docs/CONTRACT_FREEZE.md 를 읽어라.
Stage 1 머지 선행(봉투·멱등성 위에서 구현), Stage 2와 병렬 가능(디렉터리 분리 확인).

핵심 원칙: books 는 기존 edit_sessions/files/worker_jobs 를 대체하지 않는 파사드다.
내부 오케스트레이션만 하고 기존 모듈 시맨틱은 무접촉(AD-1).

작업 5건:

1. 테이블+모듈 — books(bk_ uid, siteId, env, creationType, bookSpecUid, status DRAFT|FINALIZED, pageCount),
   book_assets(cover/content/photos/template binding, file refs), book_finalizations(workerJobId, 산출물 refs).
2. 자산 라우트 — POST/PUT /api/v1/books/{uid}/pdf-cover·pdf-contents(POST=신규 409/PUT=교체 404 규약,
   내부는 기존 files/presigned 재사용 — 90/100MB 라우팅 분기 동일), POST .../photos(draft 만),
   POST .../cover·.../contents(템플릿 바인딩 — Stage 5 schema 전이라 초판은 templateSetId+파라미터 단순 바인딩).
3. finalization — POST /api/v1/books/{uid}/finalization: BookSpec 페이지 규칙(pageMin/Max/Increment) 검증
   → 기존 워커 validate → synthesize/compose-mixed 오케스트레이션 → 산출물 book_finalizations 고정
   → GET .../pdf 다운로드. 재호출 멱등(진행 중 409). 실패 errorCode 표준화(설계서 카탈로그).
4. EDITOR_SESSION 승격 — POST /api/v1/books {creationType:'EDITOR_SESSION', sessionId}:
   완료된 edit_session(같은 site 소유 검증)을 book 으로 승격, 세션 산출 PDF 를 자산으로 연결.
   임베드 편집기→책→생산의 공식 경로(storige 차별재).
5. 상태 전이 테스트 + GUARDED 계약 테스트 편입 + creationType 4종별 e2e 시나리오.

제약: §0 절대 제약 + AD-1. 검증: 빌드/테스트 + 계약 spec 2종 + 4모드 e2e + 기존 파트너 경로 스모크
(edit_sessions·worker-jobs 직접 호출 파트너의 동작 불변).
```

### 프롬프트 E — Stage 4 (SDK·문서·AI 채널)

```
[Stage 4 — DX 완성: @storige/sdk + quickstart 3종 + 문서 포털 + llms.txt]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§6 Stage 4)
→ /Users/yohan/Documents/Codex/2026-07-02/new-chat/outputs/STORIGE-PLATFORM-SDK-BLUEPRINT.md(물리 정본:
@storige/sdk 단일 패키지+subpath 3종) → docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md 를 읽어라.
Stage 1 머지 선행(v1 봉투·OpenAPI 소비). Stage 3 과 병렬 가능하나 books 클라이언트는 Stage 3 머지 후.

선결 확인: S-2 — WORKER_MAX_FILE_SIZE 실값(1GB vs 2GB 상충)과 업로드 라우팅 임계(90 vs 100MB)를
rg 로 실측해 SDK 상수로 고정하고 설계서에 기록.

작업 4건:

1. packages/sdk (@storige/sdk)
   - /client: v1 우선 타깃 — Bearer/X-API-Key, 업로드(라우팅 분기+멀티파트), book-specs·books·finalization·
     웹훅 config, 폴링 헬퍼(백오프), Idempotency-Key 자동 부여, 봉투 파싱+ERR_* enum.
     구 /external 은 legacy 네임스페이스로 최소 지원(기존 파트너 이관용).
   - /embed: iframe 마운트+postMessage 엔벨로프 v1 타입 세이프 래퍼(이벤트 9종·명령 3종), shop-session 헬퍼.
   - /webhook: v1(base64)·v2(HMAC) 검증, X-Storige-Delivery 멱등 헬퍼, express/next 어댑터.
   - 테스트: v1 계약 테스트와 동일 픽스처로 파싱 검증.
2. examples/ 신설 — quickstart 3종: pdf-upload-order / editor-session-order / template-order.
   기존 example/(WowMall 문서)과 혼동 방지 README 명시(rename 은 오너 확인 후).
3. 문서 포털 — PLATFORM_INTEGRATION_GUIDE.md 소스 정적 사이트(권고: Vercel 신규 프로젝트).
   구성: 시작하기/시나리오 3종/API 레퍼런스(openapi-partner.json 렌더)/웹훅/에러 카탈로그/go-live 체크리스트/
   외부 changelog. 스테일 문서(BOOKMOA_INTEGRATION_GUIDE 등 5/3 고착)에 deprecation 배너+정본 링크.
4. AI 에이전트 채널 — /llms.txt(인덱스)+/llms-full.txt(합본)+페이지별 .md 빌드 스크립트.
   AGENT INSTRUCTIONS(md 에만 노출): 인증 헤더, 업로드 임계, 웹훅 검증 규칙, "동결 계약 응답 필드 추측 금지".

제약: SDK 는 신규 표면 — 서버 계약 변경 일절 금지(소비만). 검증: sdk 유닛 + quickstart 3종 실행 스모크(test 키)
+ 문서 빌드 + llms.txt 유효성.
```

### 프롬프트 F — Stage 5 (템플릿 생태계 개방)

```
[Stage 5 — 템플릿 개방: 파트너 전용 템플릿 + 검수 워크플로우 + 스키마 API]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§6 Stage 5)
→ apps/api templates/template-sets 모듈 → apps/admin 템플릿 관리 화면을 먼저 파악하라.
Stage 2(SITE_ADMIN 활성)·Stage 3(books contents 바인딩) 머지 선행.

확인된 사실: 엔티티에 site_id 존재하나 DTO 에 siteId 없음(전부 NULL 생성) / CUD 는 전역 ADMIN/MANAGER 전용 /
GET /template-sets/:id/with-templates @Public 무스코핑(canvasData 전체 열람) / 복제 시 필드 유실
(템플릿: type/판형/editable/deleteable/spreadConfig, 셋: editorMode/커버/가격/출력설정) /
by-product 는 bookmoa sortcode 강결합+site 필터 미적용.

작업 6건 (1→2→3 순서, 4·5 병렬 가능, 6 후순위):

1. siteId 쓰기 경로 — DTO siteId?: string + 서비스 create 반영. 전역 admin 임의 지정,
   SITE_ADMIN 자기 site 강제, 미지정=NULL(현행 유지).
2. 읽기 스코핑 봉합 — with-templates 에 applySiteScope hybrid(자기 site+NULL), 에디터 부트스트랩 회귀 금지
   (임베드 파트너 시나리오 테스트 필수). findOne 테넌트 스코프. by-product site 필터 +
   범용 상품코드 매핑 테이블(additive) — 기존 sortcode 경로는 bookmoa 전용 어댑터로 동결.
3. 복제 필드 유실 수정 — 전 필드 복사+spread 템플릿 복제 회귀 테스트(type→page 버그, spreadConfig null 버그).
4. SITE_ADMIN 제작 권한+검수 상태머신 — CUD @Roles 에 SITE_ADMIN(자기 site 강제, findOne 스코핑 선행 필수),
   status: draft→submitted→approved→published(additive 컬럼, isActive 는 published 동기 — 기존 노출 불변),
   승인 이력 테이블, TemplateSet.createdBy, admin 검수 큐 화면(submitted 목록→미리보기→승인/반려+사유).
5. 템플릿 스키마 API — GET /api/v1/templates/{uid}/schema: canvasData 바인딩 슬롯(텍스트/이미지/갤러리/날짜)
   추출→JSON Schema draft-07. templateKind 매핑: cover→cover, page·spread→content, endpaper→divider,
   wing·spine→cover_component. Stage 3 의 POST books contents 바인딩과 스키마 정합.
6. (후순위·별도 브랜치) 버전 스냅샷 — update 시 canvas_data 스냅샷+롤백 API.

제약: §0 절대 제약. 시스템공유(NULL) 템플릿의 기존 노출 동작 절대 불변 — bookmoa 상품페이지·에디터
템플릿 패널 회귀가 최대 리스크. 검증: e2e(templates·template-sets spec 확장) + 노출 매트릭스 테스트
(siteA 전용이 siteB/게스트에 안 보임) + 골든 하네스.
```

### 프롬프트 G — Stage 6 (미터링·정산 준비)

```
[Stage 6 — 미터링 + 정산 장부 준비 (오너 결정 §8 대기 항목 분리)]

세션 시작 프로토콜대로 CLAUDE.local.md → SWEETBOOK_GAP_ROADMAP_2026-07-07.md(§4 AD-4, §6 Stage 6, §8)
를 먼저 읽어라. ⚠️ 과금 본 구현·경량 Orders 는 오너 결정(§8-1·§8-7) 전 착수 금지.
이 프롬프트는 결정과 무관하게 유효한 작업만 다룬다.

작업 3건:

1. 사용량 미터링 — worker_jobs/files 기반 site별 월간 집계(잡 수 종류별·처리 바이트·보존 스토리지·웹훅 발송 수).
   일 1회 cron+집계 테이블+admin 조회 화면+CSV export. 목적: 과금 모델 결정 데이터+제안서 원가 산정.
2. NULL-siteId 이원 정책 — 오너 결정(§8-2) 전이면 마이그레이션 계획서만 선작성:
   게스트/공유 리소스 명시적 shared 플래그 이관 + NULL 신규 생성 금지 + 조회 grandfather 유지안.
3. WORKER_API_KEY 마스터키 분리(PLATFORM_EXPANSION_PLAN Phase 2 등재) — 워커 전용 스코프 키로
   필요 라우트만 허용, 기존 키 병존(무중단), cutover 는 별도 운영 작업 분리.

제약: §0 절대 제약. 검증: 집계 정확성 테스트(픽스처 잡 데이터 대비), 마스터키 분리 후 워커 E2E
(validate→synthesize→콜백) 회귀.
```

---

## 8. 오너 결정 필요 사항

| # | 결정 | 관련 | 권고 |
|---|------|------|------|
| 1 | **과금 모델**: Settlement Ledger(후불) vs Credit Wallet(선불) vs 구독 | Stage 6 | **✅ 오너 결정 2026-07-28: B2B+SaaS 둘 다 → Ledger + Wallet 병행.** 공통 **미터링(worker_jobs 집계)** 기반 위에 정산 인터페이스 추상화 → **Ledger 먼저 가동**(B2B, PG 불요, 기존 4파트너 검증) / **Wallet은 SaaS 셀프서브 런칭 시** 추가. 동시 풀스케일 금지 = 공통기반→B2B→SaaS 순차(AD-6) |
| 2 | **NULL-siteId 이원 정책** | Stage 6 | CONTRACT_FREEZE §4.3 보류 항목 |
| 3 | **파트너 포털 형태 + 셀프가입 정책** | Stage 2 | **✅ 오너 결정 2026-07-28: test 셀프발급 / live 운영자 게이트**(B2B 심사·SaaS 진입로 둘 다 수용). 포털=admin 확장. SaaS 성숙 시 live 자동승인+Wallet |
| 4 | **샌드박스 인프라**: 논리 분리 vs 실분리 | Stage 2 | **✅ 오너 결정 2026-07-28: 논리 분리로 시작**(B2B·SaaS 초기 둘 다 커버, `isTest`+워터마크 더미) → SaaS 트래픽 실측 시 실분리(DR/SPOF와 묶음) |
| 5 | **법률 문서**: 약관·DPA·SLA 착수(법무) | Stage 6 | **✅ 오너 결정 2026-07-28: 지금 법무 착수.** B2B 개별계약서 + SaaS 표준약관/클릭DPA 둘 다(SaaS라서 더 시급). 개발과 병렬 — 오너가 법무 의뢰 |
| 6 | ~~**S-2/S-3**: WORKER_MAX_FILE_SIZE 정본(1GB vs 2GB)·업로드 임계(90/100MB)~~ → **✅ S-2 종결(2026-07-16 실측)**. 100p 검증 게이팅 기본값(S-3)만 잔여 | ~~Stage 4~~ → S-2 종결 | **오너 결정 사안이 아니라 실측 기록 사안이었음**: 직접 업로드 **100MB 단일**(`books.constants.ts:19`) / presigned **2GB**(`presigned-upload.service.ts:37`) / compose 기본 `WORKER_MAX_FILE_SIZE` **1GB**(`docker-compose.yml:102`, 코드 기본은 100MB) / nginx `client_max_body_size 100M`. **"90MB"는 storige 상수 부재** — 정체는 100p_books 자작 클라이언트의 라우팅 마진(CONTRACT_FREEZE:60). **"1GB vs 2GB"도 상충 아님** — 1GB=워커 검증 상한, 2GB=presigned 업로드 상한(다른 계층). 잔여=VPS `.env` 실값 확인 1회(무해) |
| 7 | **경량 Orders + 풀필먼트 포지셔닝**: 생산 상태 추적 모듈 도입 여부, 북모아 인쇄망 결합 상품화 여부 | Stage 6 | 경량 Orders 는 풀필먼트와 독립적으로 가치(추정 아님 — Codex·본 분석 수렴). 풀필먼트 결합은 시장 검증 필요(추정) |
| 8 | **P트랙 규율 공식화**: 본 로드맵 §0 해석의 승인 | Stage 0 | — |
| 9 | **book_specs 판형 마스터 초기 시드** 승인(template_sets 자유입력 → 정규화 수집 결과 검토) | Stage 1 | 시드 스크립트 산출 검토 후 적용 |
| 10 | **Swagger `/api/docs` 무가드 공개 서빙**(151경로/204오퍼레이션 전량) — ⚠️ 파트너에 의도적 공개(PHP 연동 문서 참조 자원)이나 내부/관리자 표면까지 노출. **✅ B안(문서 큐레이션) 오너 승인·구현 완료**(2026-07-07, 브랜치 `fix/swagger-partner-curation`, 커밋 `7950c87`): production 문서를 파트너 대면 31라우트로 한정(fail-closed allowlist), URL 유지. **잔여 오너 액션 = 배포 승인**(master 머지 후 API 수동 재배포) | Stage 1 → 배포 대기 | 실측 HTTP 200(2026-07-07). 검증: types·typecheck·jest 6+59·프로덕션 빌드·컴파일 필터 실스펙 적용(204→31, 민감 라우트 차단, 오차 0). 라우트 미변경(문서 필터만)이라 contract-freeze 무영향 |

## 9. 기대효과 총괄

- **온보딩 리드타임**: 운영자 수작업 5단계 → 가입 즉시 테스트(Stage 2). 벤치마크 "5분".
- **연동 공수**: 클라이언트 자작 644줄(100p 실측) → SDK import+설정(Stage 4). 파일·세션·잡 직접 조립 → books 파사드 1~2 호출(Stage 3).
- **신뢰성**: 웹훅 재시도 1회→3회 백오프+이력+수동 재발송(Stage 2). 재시도 중복 잡→멱등키(Stage 1).
- **차별화 3중 조합**: 임베드 편집기(EDITOR_SESSION 승격) + 파트너 전용 템플릿 공급 + AI 자동 바인딩(schema) — sweetbook 불가 영역(Stage 3·5).
- **사업 전제**: 미터링→가격표→DPA/SLA(Stage 6)로 제안서 발송 가능 상태 — P트랙 트리거(확약)를 만들어낼 실행 기반.

## 10. 관련 산출물

- **임베드 트랙 구체화(현행 master 기준)**: `.cursor/plans/EMBED_OPENING_PLAN_2026-07-28.md` — 편집기 임베드 외부 공개 계획(개발이슈 D1~D14·연동안 6종·주의사항 14·실제작연동 Stage 0~6·GUIDE 임베드 개정안·**호스트→편집기 수신 명령 계약 초안**=SDK `/embed` 선결) + `outputs/EMBED-OPENING-DASHBOARD_2026-07-28.html`. 이 Stage 4 절과 정합(무접촉).
- **오케스트레이션 마스터 프롬프트**(Opus 4.8 Ultracode·서브에이전트 하네스): `.cursor/plans/ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`
- **시각화 대시보드**: `outputs/SWEETBOOK-GAP-ROADMAP-DASHBOARD_2026-07-07.html`
- **Codex 원 보고서**: `outputs/sweetbook_vs_bookmoa_storige_platform_upgrade_report_2026-07-07.md`
- **하네스 표준**: `outputs/SUBAGENT-HARNESS-STANDARD.md` v2.0 (역할 11종·게이트 6종)
- **워크플로 원본 데이터(영구 사본)**: `outputs/sweetbook-workflow-raw_2026-07-07.json` — sweetbook 엔드포인트 인벤토리 115건(조사 그룹 간 중복 표기 포함)·문서 그룹 10종·코드 조사 6축·검증 2종 원본
- **검증 정정 이력(v1)**: storige측 4건(spine API 기존재 등)·sweetbook측(₩100,000 지원금 오보 삭제, 하드커버 공식 비공개, Breaking 2릴리스 5건 정정 등) — 본문 반영 완료.
