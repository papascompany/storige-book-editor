# Partner Platform API v1 설계서 (Stage 0 산출 — 코드 변경 0)

> **결정 근거**: 본 설계는 P트랙 가동에 대한 오너 결정(D-2 승인, 2026-07-14)에 따른 Stage 0 산출물이다.
> 작성 2026-07-15 · 파일명 날짜(2026-07-07)는 로드맵 정본의 상호 참조 정합을 위해 고정.
> 벤치마크 수치는 **외부 B2B 인쇄 API 벤치마크 실측**(2026-07-07 조사) 기반 — 대상 기업/제품명은 본 문서에 기재하지 않는다.
> 이 문서는 Stage 1~6 구현의 **명세 정본**이다. 구현과 충돌 시 이 문서를 먼저 개정한다.

---

## 절대 전제 (Architecture Decisions 요약)

| AD | 결정 | 요지 |
|----|------|------|
| **AD-1** | v1 파사드가 표준의 유일한 실장 지점 | 표준 봉투·멱등성·페이지네이션·per-Key 레이트리밋·Bearer 병행 인증은 신규 `/api/v1/*` 표면에**만** 실장. 기존 `/external`·동결 라우트는 **무접촉**(문서화만) |
| **AD-2** | 생성모드 4종 | `PDF_UPLOAD` / `TEMPLATE` / `MIX_COVER_TEMPLATE` / `EDITOR_SESSION`(임베드 편집기 세션 승격 — storige 차별재) |
| **AD-3** | finalization 게이트 | Book은 `DRAFT`(자산 투입 가능) → `FINALIZED`(주문·생산 가능, 편집 불가) 상태머신. finalization이 내부 검증→합성 잡을 실행하고 산출물을 고정 |
| **AD-4** | 과금은 Settlement Ledger 우선 | 선불 Wallet은 후속. **최종 선택은 오너**(§9 Owner Decision) |
| **AD-5** | 인증 병행 | `Authorization: Bearer`와 `X-API-Key` 병행 수용, 검증 로직은 동일 키. 신규 문서는 Bearer 우선 표기 |

**동결 계약**: `docs/CONTRACT_FREEZE.md`의 동결 16라우트(+2026-07-13 ADDITIVE 등재 `POST /worker-jobs/fix-bleed` 1건이 `contract-freeze.spec.ts`에 함께 고정)는 시맨틱 불변. v1의 어떤 작업도 이 표면을 수정하지 않는다 — `contract-freeze.spec.ts` CI green이 모든 머지의 전제.

**모듈 배치**: 기존 `apps/api/src/` 톱레벨(auth·bookmoa·common·database·edit-sessions·editor*·files·health·library·products·sentry·settings·sites·storage·templates·webhook·worker-jobs)에 **신규 `partner-api/` 모듈**을 추가한다. 글로벌 prefix가 `api`(main.ts `setGlobalPrefix('api')`)이므로 v1 컨트롤러는 `@Controller('v1/...')`로 선언해 최종 경로가 `/api/v1/...`이 된다.

---

## 1. /api/v1 전체 라우트맵

### 1.1 표기 규약

- **인증**: `🔑` = 파트너 키 필수(Bearer 또는 X-API-Key, AD-5). v1에는 무인증(@Public) 라우트를 **만들지 않는다** — 무인증 게스트 표면은 기존 동결 라우트가 전담.
- **멱등**: `⟲` = `Idempotency-Key` 헤더 지원(§4). v1의 모든 비-GET 상태 변경 라우트에 자동 적용.
- **Stage**: 실장 예정 단계(로드맵 §6).
- **[오너 게이트]**: 오너 결정(§9) 전 구현 착수 금지 — 라우트 자리만 예약.

### 1.2 BookSpecs (판형 마스터) — Stage 1

| # | Method | Path | 인증 | 설명 |
|---|--------|------|------|------|
| 1 | GET | `/api/v1/book-specs` | 🔑 | 판형 목록(페이지네이션 §5). 필터: `coverType`, `bindingType`, `isActive` |
| 2 | GET | `/api/v1/book-specs/{bookSpecUid}` | 🔑 | 판형 상세 — trim/작업 사이즈 mm, pageMin/Max/Increment, bleedMm, sizeToleranceMm, spineFormula |
| 3 | GET | `/api/v1/book-specs/{bookSpecUid}/calculated-size?pageCount=` | 🔑 | 페이지 수 기반 표지/내지/책등 실측 mm 계산. 내부적으로 기존 `SpineService` 재사용 |

**calculated-size 톨러런스 보장 문구(정본)**: 응답의 각 mm 값대로 PDF를 제작하면 워커 사이즈 검증을 통과한다. 보장 폭은 워커 검증 폴백 상수 `LEGACY_SIZE_TOLERANCE_MM = 1`(mm, `apps/worker/src/config/validation.config.ts`)과 **정합하는 ±1mm**로만 문서화한다. ⚠️ 이 상수는 2026-06-10 회귀 이력이 있는 **변경 절대 금지** 값이며, v1은 이 값을 **읽어서 응답 필드(`sizeToleranceMm`)로 노출만** 한다 — 검증측 값을 v1에 맞추는 방향의 변경은 금지. templateSet별 `size_tolerance_mm` 계약값이 있으면 그 값을 우선 노출(검증측과 동일한 우선순위 규칙).

기존 `POST /products/spine/calculate`·`GET /products/spine/paper-types`·`GET /products/spine/binding-types`(@Public, 기존재·미문서화)는 **무접촉 유지** — v1 calculated-size가 문서화된 공식 표면이 되고, 기존 3종은 레거시로 병존.

### 1.3 Books (도서 라이프사이클) — Stage 3

| # | Method | Path | 인증 | 멱등 | 설명 |
|---|--------|------|------|------|------|
| 4 | POST | `/api/v1/books` | 🔑 | ⟲ | 책 생성. body: `{creationType, bookSpecUid, pageCount?, sessionId?(EDITOR_SESSION 전용), title?}` |
| 5 | GET | `/api/v1/books` | 🔑 | | 목록(페이지네이션). 필터: `status`, `creationType`, `createdAfter` |
| 6 | GET | `/api/v1/books/{bookUid}` | 🔑 | | 상세(자산·finalization 요약 포함) |
| 7 | POST | `/api/v1/books/{bookUid}/pdf-cover` | 🔑 | ⟲ | 표지 PDF 신규 투입 — 기존재 시 `409 ERR_ASSET_ALREADY_EXISTS` |
| 8 | PUT | `/api/v1/books/{bookUid}/pdf-cover` | 🔑 | | 표지 PDF 교체 — 미존재 시 `404 ERR_ASSET_NOT_FOUND` |
| 9 | POST | `/api/v1/books/{bookUid}/pdf-contents` | 🔑 | ⟲ | 내지 PDF 신규 투입(409/404 규약 동일) |
| 10 | PUT | `/api/v1/books/{bookUid}/pdf-contents` | 🔑 | | 내지 PDF 교체 |
| 11 | POST | `/api/v1/books/{bookUid}/photos` | 🔑 | ⟲ | 사진 자산 투입(DRAFT 전용, TEMPLATE/EDITOR_SESSION 갤러리 바인딩용) |
| 12 | POST | `/api/v1/books/{bookUid}/cover` | 🔑 | ⟲ | 표지 템플릿 바인딩(templateSetId + 파라미터 — Stage 5 schema 전에는 단순 바인딩) |
| 13 | POST | `/api/v1/books/{bookUid}/contents` | 🔑 | ⟲ | 내지 템플릿 바인딩 |
| 14 | POST | `/api/v1/books/{bookUid}/finalization` | 🔑 | ⟲ | 최종화 실행(§6.3 상태머신). 재호출 멱등, 진행 중 409 |
| 15 | GET | `/api/v1/books/{bookUid}/finalization` | 🔑 | | 최종화 상태/결과 조회(폴링 표면 — 웹훅 병행) |
| 16 | GET | `/api/v1/books/{bookUid}/pdf` | 🔑 | | 최종 산출 PDF 다운로드(FINALIZED 전용, 302 presigned 또는 스트림) |

> 대용량(≤2GB) 파일 실바이트 업로드는 v1이 **재발명하지 않는다** — v1 자산 라우트는 ①멀티파트 소형 직접 업로드(≤100MB) ②기존 presigned/multipart 동결 표면으로 업로드한 `fileId` 참조 투입, 두 형태를 받는다. presigned 경로 자체는 동결 표면 그대로(무접촉).

### 1.4 Templates (읽기 + 스키마) — Stage 5

| # | Method | Path | 인증 | 설명 |
|---|--------|------|------|------|
| 17 | GET | `/api/v1/templates?bookSpecUid=&templateKind=&category=&limit=&offset=` | 🔑 | 테넌트 스코프 적용 목록(자기 site + 공유분) |
| 18 | GET | `/api/v1/templates/{templateUid}` | 🔑 | 상세(canvasData 원문은 미노출 — 메타·프리뷰만) |
| 19 | GET | `/api/v1/templates/{templateUid}/schema` | 🔑 | canvasData에서 바인딩 슬롯(텍스트/이미지/갤러리/날짜) 추출 → **JSON Schema draft-07** |

`templateKind` 외부 매핑(내부 type → v1): `cover→cover` / `page·spread→content` / `endpaper→divider` / `wing·spine→cover_component`.
기존 `GET /template-sets/:id/with-templates`(@Public 무스코핑, 동결)는 무접촉 — 스코핑 봉합은 Stage 5의 별도 트랙.

### 1.5 Webhooks (config + deliveries) — Stage 2

| # | Method | Path | 인증 | 멱등 | 설명 |
|---|--------|------|------|------|------|
| 20 | PUT | `/api/v1/webhooks/config` | 🔑 | | 웹훅 설정 upsert(url, 구독 이벤트 목록). secret은 **생성/회전 응답에서만 1회 노출** |
| 21 | GET | `/api/v1/webhooks/config` | 🔑 | | 설정 조회(secret은 prefix 마스킹) |
| 22 | DELETE | `/api/v1/webhooks/config` | 🔑 | | 설정 삭제(발송 중지) |
| 23 | POST | `/api/v1/webhooks/test` | 🔑 | ⟲ | 테스트 이벤트 발송(`isTest=true`) |
| 24 | GET | `/api/v1/webhooks/deliveries` | 🔑 | | 발송 이력 목록(페이지네이션). 필터: `event`, `status`, `since` |
| 25 | GET | `/api/v1/webhooks/deliveries/{deliveryUid}` | 🔑 | | 이력 상세(payload, 응답코드/본문 요약, attempts, nextRetryAt) |
| 26 | POST | `/api/v1/webhooks/deliveries/{deliveryUid}/retry` | 🔑 | ⟲ | 수동 재발송 — 재시도 불가 상태면 `409 ERR_DELIVERY_NOT_RETRYABLE` |

**v1 웹훅 = v2 서명(HMAC) 전용 신규 표면.** 기존 v1(base64) 발신 경로·바이트는 불변(동결). v1 API로 config를 등록한 사이트는 HMAC(hex, `t=<unix>,v1=<hex>`, data `t.` prefix — CONTRACT_FREEZE §1-E 발신 정본 형식)으로 수신한다. 기존 파트너의 v2 전환은 수신부 실물 대조 게이트(Stage 2 ⚠️) 선행.

**delivery 상태 흐름**:

```
PENDING ──발송 성공(2xx)──▶ DELIVERED
   │
   └─실패──▶ RETRYING ──(백오프 1분/5분/30분, 최대 3회)──▶ DELIVERED
                 │
                 └─3회 소진──▶ EXHAUSTED ──(수동 retry API)──▶ PENDING(재진입)
```

이벤트는 기존 발신 7종(`validation.completed/fixable/failed`, `synthesis.completed/failed`, `session.validated/failed`)을 승계하고, Stage 3에서 `book.finalization.completed/failed`를 **additive 추가**한다(신규 이벤트명 추가는 수신부 스위치가 미지 이벤트를 무시하므로 무해 — `editor.pricingChange` 선례).

### 1.6 [오너 게이트] Orders (경량 생산 상태) — Stage 6, §9-3 결정 전 착수 금지

| # | Method | Path | 멱등 | 설명 |
|---|--------|------|------|------|
| 27 | POST | `/api/v1/orders/estimate` | | 견적(과금 모델 확정값 필요 — §9-1) |
| 28 | POST | `/api/v1/orders` | ⟲ | 주문 생성 — **FINALIZED book만** 수용 |
| 29 | GET | `/api/v1/orders` | | 목록(페이지네이션) |
| 30 | GET | `/api/v1/orders/{orderUid}` | | 상세(생산 상태) |
| 31 | POST | `/api/v1/orders/{orderUid}/cancel` | ⟲ | 주문 취소(생산 착수 전만 — `409 ERR_ORDER_NOT_CANCELLABLE`) |
| 32 | GET | `/api/v1/orders/{orderUid}/items` | | 항목 목록 |

경량 모델 원칙: 파트너 주문 참조 + 생산 상태(`CREATED→IN_PRODUCTION→PRODUCTION_COMPLETED`, +`FAILED`/`CANCELLED`) + 산출물 상태만. **배송/결제/수취인 개인정보는 미포함**(풀필먼트 포지셔닝은 §9-3과 법률 게이트 §9-5에 종속).

### 1.7 [오너 게이트] Credits / Settlement — Stage 6, §9-1 결정 전 착수 금지

| # | Method | Path | 멱등 | 설명 |
|---|--------|------|------|------|
| 33 | GET | `/api/v1/credits` | | 잔액/장부 요약 |
| 34 | GET | `/api/v1/credits/transactions` | | 거래 이력(페이지네이션) |
| 35 | POST | `/api/v1/credits/sandbox/charge` | ⟲ | **test env 전용** 가상 충전(DX용) |
| 36 | POST | `/api/v1/credits/sandbox/deduct` | ⟲ | **test env 전용** 가상 차감 |

테이블은 Ledger(후불 장부)/Wallet(선불) 겸용으로 설계(§2.12~13)해 오너 결정이 어느 쪽이든 스키마 재작업이 없게 한다.

### 1.8 라우트 총괄

- **비게이트(Stage 1~5) 26라우트**: book-specs 3 · books 13 · templates 3 · webhooks 7.
- **오너 게이트(Stage 6) 10라우트**: orders 6 · credits 4.
- 총 **36라우트**(자리 예약 포함). 전 라우트 🔑 인증 — v1에 무인증 표면 없음.

---

## 2. 신규 테이블 13종 DDL 초안 (MariaDB / TypeORM)

### 2.0 공통 규약

- **additive 마이그레이션 전제**: 전부 신규 테이블 — 기존 테이블 컬럼 변경 0. `apps/api/migrations/` 하우스 스타일(`CREATE TABLE IF NOT EXISTS`, 멱등, prod synchronize=false → **SQL 수동 실행 → API 재배포 → nginx 재시작** 순서) 준수.
- **PK**: `VARCHAR(36)` UUID(하우스 컨벤션 — `format_presets` 등과 동일). 외부 노출 식별자는 별도 `uid` 컬럼에 **접두 체계**를 사용: `bk_`(book) `bs_`(book_spec) `fin_`(finalization) `whd_`(delivery) `or_`(order) `oi_`(order_item) `evt_`(event) — 벤치마크의 uid 접두 관행 채택. 내부 UUID를 외부에 그대로 노출하지 않는다.
- **컬럼**: snake_case(엔티티 프로퍼티는 camelCase + `@Column({name})` 매핑 — `site.entity.ts` 컨벤션).
- **env**: `ENUM('test','live')` — 환경 스코프는 키·데이터·웹훅에 일관 적용(Stage 2 §7.3 논리 분리).
- **FK**: 기존 테이블(sites·files·edit_sessions·worker_jobs)에 대한 참조는 **컬럼+인덱스만** 두고 DB 레벨 FK 제약은 걸지 않는다(기존 테이블 무접촉 원칙 + 소프트 삭제 파일과의 정합).

### 2.1 `partner_api_keys` — 파트너 키(env scope) [Stage 2]

현행 `sites.editor_auth_code/worker_auth_code`(평문·단일 env)는 무접촉 유지. v1 키는 이 테이블에서 발급한다. **`partner_api_keys` 조회 폴백은 v1 전용 가드(PartnerApiKeyGuard, §7.1)에만 실장하고 공용 `ApiKeyGuard`는 불변** — 공용 가드를 확장하면 v1 발급 키(test env 포함)가 기존 전 external 표면에서 유효해져 env 스코프가 우회되고(§7.3 논리 분리 붕괴) AD-1(기존 표면 무접촉)에 위배된다. 반대 방향(기존 sites 키의 v1 수용)은 v1 가드 안의 additive 폴백으로 허용.

```sql
CREATE TABLE IF NOT EXISTS partner_api_keys (
  id             VARCHAR(36) PRIMARY KEY,
  site_id        VARCHAR(36) NOT NULL,                 -- sites.id 참조(논리)
  env            ENUM('test','live') NOT NULL DEFAULT 'test',
  key_prefix     VARCHAR(16) NOT NULL,                 -- 표시/식별용 (예: 'sk_test_a1b2')
  key_hash       VARCHAR(128) NOT NULL,                -- 해시 저장(발급 1회 노출 — 평문 컬럼 없음)
  name           VARCHAR(100) NULL,                    -- 파트너가 붙이는 라벨
  scopes         JSON NULL,                            -- 예: ["books","webhooks"] (null=전체)
  status         ENUM('active','revoked','grace') NOT NULL DEFAULT 'active',
  grace_until    TIMESTAMP NULL,                       -- 오버랩 회전 유예(72h) 만료 시각
  last_used_at   TIMESTAMP NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_partner_api_keys_hash (key_hash),
  INDEX idx_partner_api_keys_site_env (site_id, env),
  INDEX idx_partner_api_keys_prefix (key_prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 키 보안 3종(해시 저장·1회 노출·오버랩 회전)의 상세 정책·이행 절차는 **Stage 2 참조**(로드맵 §6 Stage 2-4). 본 설계서는 스키마 자리만 고정한다.

### 2.2 `partner_idempotency_keys` — 멱등 캐시 [Stage 1]

```sql
CREATE TABLE IF NOT EXISTS partner_idempotency_keys (
  id                VARCHAR(36) PRIMARY KEY,
  site_id           VARCHAR(36) NOT NULL,
  env               ENUM('test','live') NOT NULL,
  method            VARCHAR(8) NOT NULL,
  path              VARCHAR(300) NOT NULL,             -- 정규화 경로(경로 파라미터 실값 포함)
  idempotency_key   VARCHAR(128) NOT NULL,             -- 파트너 제공 헤더값
  request_hash      VARCHAR(64) NOT NULL,              -- SHA-256(canonical body)
  status            ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  response_status   INT NULL,                          -- 완료 시 HTTP status
  response_snapshot MEDIUMTEXT NULL,                   -- 완료 시 응답 본문(봉투 전체)
  expires_at        TIMESTAMP NOT NULL,                -- created_at + 24h
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_idem_scope (site_id, env, method, path, idempotency_key),
  INDEX idx_idem_expires (expires_at)                  -- TTL sweep cron
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.3 `book_specs` — 판형 마스터 (신설) [Stage 1]

현재 판형 정보가 `products/spine`(용지·제본), `template_sets.productSpecs`(자유입력 width/height), `format_presets`(저작측 프리셋)에 분산돼 있는 것을 **외부 대면 판형 마스터**로 정규화 수집한다. 초기 시드는 수집 스크립트 산출을 오너 검토 후 적용(§9-6).

```sql
CREATE TABLE IF NOT EXISTS book_specs (
  id                  VARCHAR(36) PRIMARY KEY,
  uid                 VARCHAR(40) NOT NULL,             -- 외부 식별자 'bs_...'
  site_id             VARCHAR(36) NULL,                 -- null=전역 공개 판형
  name                VARCHAR(100) NOT NULL,            -- 예: 'A4 무선 소프트커버'
  cover_type          VARCHAR(30) NOT NULL,             -- softcover|hardcover|...
  binding_type        VARCHAR(30) NOT NULL,             -- canonical 4종 어휘 승계(가이드 §2.5)
  orientation         ENUM('portrait','landscape') NOT NULL DEFAULT 'portrait',
  inner_trim_width_mm  FLOAT NOT NULL,
  inner_trim_height_mm FLOAT NOT NULL,
  bleed_mm            FLOAT NOT NULL DEFAULT 3,
  size_tolerance_mm   FLOAT NOT NULL DEFAULT 1,        -- 워커 LEGACY_SIZE_TOLERANCE_MM 정합값(노출용 — 검증측 변경 금지)
  page_min            INT NOT NULL,
  page_max            INT NOT NULL,
  page_increment      INT NOT NULL DEFAULT 2,
  spine_formula       JSON NULL,                        -- SpineService 파라미터 참조(용지/제본 계수)
  default_paper_code  VARCHAR(30) NULL,
  template_set_id     VARCHAR(36) NULL,                 -- 기본 templateSet 연결(선택)
  pricing             JSON NULL,                        -- 과금 확정(§9-1) 전 null 운용
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,   -- 소프트 토글(하드 삭제 금지 — format_presets 관행)
  sort_order          INT NOT NULL DEFAULT 0,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_specs_uid (uid),
  INDEX idx_book_specs_site_active (site_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.4 `books` — 도서 aggregate [Stage 3]

```sql
CREATE TABLE IF NOT EXISTS books (
  id              VARCHAR(36) PRIMARY KEY,
  uid             VARCHAR(40) NOT NULL,                 -- 'bk_...'
  site_id         VARCHAR(36) NOT NULL,                 -- NULL 금지 — v1은 전 리소스 site 스탬프 필수
  env             ENUM('test','live') NOT NULL DEFAULT 'live',
  creation_type   ENUM('PDF_UPLOAD','TEMPLATE','MIX_COVER_TEMPLATE','EDITOR_SESSION') NOT NULL,
  book_spec_id    VARCHAR(36) NOT NULL,                 -- book_specs.id
  status          ENUM('DRAFT','FINALIZED') NOT NULL DEFAULT 'DRAFT',
  page_count      INT NULL,                             -- finalization 시 확정
  title           VARCHAR(200) NULL,
  edit_session_id VARCHAR(36) NULL,                     -- EDITOR_SESSION 승격 원본(edit_sessions 참조)
  partner_ref     VARCHAR(100) NULL,                    -- 파트너측 자체 참조 ID(자유)
  finalized_at    TIMESTAMP NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_books_uid (uid),
  INDEX idx_books_site_env_status (site_id, env, status),
  INDEX idx_books_session (edit_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.5 `book_assets` — 자산(표지/내지/사진/바인딩) [Stage 3]

```sql
CREATE TABLE IF NOT EXISTS book_assets (
  id               VARCHAR(36) PRIMARY KEY,
  book_id          VARCHAR(36) NOT NULL,                -- books.id
  asset_type       ENUM('pdf_cover','pdf_contents','photo','cover_binding','contents_binding') NOT NULL,
  file_id          VARCHAR(36) NULL,                    -- files.id 참조(업로드형)
  template_set_id  VARCHAR(36) NULL,                    -- 바인딩형
  binding_params   JSON NULL,                           -- 템플릿 파라미터(Stage 5 schema 정합)
  sort_order       INT NOT NULL DEFAULT 0,              -- photo 다건 순서
  status           ENUM('active','replaced') NOT NULL DEFAULT 'active',
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_book_assets_book (book_id, asset_type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> POST=신규(active 단수 유형은 기존재 시 409) / PUT=교체(기존 row `replaced` 전환 + 신규 `active` — 이력 보존). 파일 실체는 기존 `files` 계층 재사용, 삭제·보존도 기존 retention 정책 승계.

### 2.6 `book_finalizations` — 최종화 이력/산출물 고정 [Stage 3]

```sql
CREATE TABLE IF NOT EXISTS book_finalizations (
  id                VARCHAR(36) PRIMARY KEY,
  uid               VARCHAR(40) NOT NULL,               -- 'fin_...'
  book_id           VARCHAR(36) NOT NULL,
  attempt           INT NOT NULL DEFAULT 1,             -- 실패 후 재시도 이력
  status            ENUM('PENDING','VALIDATING','COMPOSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
  validate_job_id   VARCHAR(36) NULL,                   -- worker_jobs.id (검증)
  compose_job_id    VARCHAR(36) NULL,                   -- worker_jobs.id (합성)
  output_file_id    VARCHAR(36) NULL,                   -- files.id (최종 PDF)
  page_count        INT NULL,                           -- 확정 페이지 수
  error_code        VARCHAR(60) NULL,                   -- 실패 시 ERR_* (§3 카탈로그)
  error_detail      JSON NULL,                          -- 검증 errors/warnings 스냅샷
  started_at        TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_book_finalizations_uid (uid),
  INDEX idx_book_finalizations_book (book_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.7 `webhook_configs` — 사이트·env별 웹훅 설정 [Stage 2]

현행 전역 단일 `WEBHOOK_SECRET`·site 단일 webhookUrl은 무접촉. v1 config는 이 테이블이 정본.

```sql
CREATE TABLE IF NOT EXISTS webhook_configs (
  id              VARCHAR(36) PRIMARY KEY,
  site_id         VARCHAR(36) NOT NULL,
  env             ENUM('test','live') NOT NULL DEFAULT 'live',
  url             VARCHAR(500) NOT NULL,
  secret_enc      VARCHAR(256) NOT NULL,                -- HMAC 서명용 secret(at-rest 암호화 보관 — 서명 계산에 원문이 필요해 해시 보관 불가). 응답 노출은 발급 1회뿐
  secret_prefix   VARCHAR(12) NOT NULL,                 -- 표시용 마스킹
  events          JSON NOT NULL,                        -- 구독 이벤트 배열(빈 배열=전체)
  status          ENUM('active','disabled') NOT NULL DEFAULT 'active',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_configs_site_env (site_id, env)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> ⚠️ HMAC 서명 검증에는 원문 secret이 필요하므로 실제 구현은 해시가 아닌 **암호화 보관(at-rest encryption) 또는 KMS 위임**이 필요 — Stage 2 구현 시 결정(본 초안은 "평문 컬럼 금지" 원칙만 고정, 컬럼명은 구현 결정에 따라 조정 가능).

### 2.8 `webhook_deliveries` — 발송 이력 [Stage 2]

```sql
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id               VARCHAR(36) PRIMARY KEY,
  uid              VARCHAR(40) NOT NULL,                -- 'whd_...' (X-Storige-Delivery 헤더값)
  config_id        VARCHAR(36) NULL,                    -- webhook_configs.id (v1 발신)
  site_id          VARCHAR(36) NOT NULL,
  env              ENUM('test','live') NOT NULL,
  event            VARCHAR(60) NOT NULL,
  is_test          BOOLEAN NOT NULL DEFAULT FALSE,
  payload          MEDIUMTEXT NOT NULL,                 -- 발송 당시 바이트 스냅샷
  status           ENUM('PENDING','DELIVERED','RETRYING','EXHAUSTED') NOT NULL DEFAULT 'PENDING',
  attempts         INT NOT NULL DEFAULT 0,
  last_status_code INT NULL,
  last_response    TEXT NULL,                           -- 응답 본문 앞 N바이트 절삭 저장
  next_retry_at    TIMESTAMP NULL,
  delivered_at     TIMESTAMP NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook_deliveries_uid (uid),
  INDEX idx_webhook_deliveries_site (site_id, env, event, created_at),
  INDEX idx_webhook_deliveries_retry (status, next_retry_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.9 `public_api_audit_logs` — v1 호출 감사 [Stage 1]

```sql
CREATE TABLE IF NOT EXISTS public_api_audit_logs (
  id            VARCHAR(36) PRIMARY KEY,
  request_id    VARCHAR(40) NOT NULL,                   -- 봉투 requestId 와 동일값
  site_id       VARCHAR(36) NULL,                       -- 인증 실패 시 null
  env           ENUM('test','live') NULL,
  api_key_id    VARCHAR(36) NULL,                       -- partner_api_keys.id (Stage 2 이후)
  method        VARCHAR(8) NOT NULL,
  path          VARCHAR(300) NOT NULL,
  status_code   INT NOT NULL,
  error_code    VARCHAR(60) NULL,
  latency_ms    INT NOT NULL,
  ip            VARCHAR(64) NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_site_time (site_id, created_at),
  INDEX idx_audit_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 본문/헤더는 저장하지 않는다(PII·시크릿 유입 차단). 보존 기간·파티셔닝(월 단위)은 Stage 1 구현 시 운영 결정.

### 2.10 [오너 게이트] `orders` [Stage 6 — §9-3]

```sql
CREATE TABLE IF NOT EXISTS orders (
  id              VARCHAR(36) PRIMARY KEY,
  uid             VARCHAR(40) NOT NULL,                 -- 'or_...'
  site_id         VARCHAR(36) NOT NULL,
  env             ENUM('test','live') NOT NULL,
  status          ENUM('CREATED','IN_PRODUCTION','PRODUCTION_COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  partner_order_ref VARCHAR(100) NULL,                  -- 파트너측 주문번호(기존 orderSeqno 관행 승계)
  amount          DECIMAL(12,2) NULL,                   -- 과금 확정(§9-1) 전 null
  currency        VARCHAR(3) NULL DEFAULT 'KRW',
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_orders_uid (uid),
  INDEX idx_orders_site (site_id, env, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.11 [오너 게이트] `order_items` [Stage 6 — §9-3]

```sql
CREATE TABLE IF NOT EXISTS order_items (
  id           VARCHAR(36) PRIMARY KEY,
  uid          VARCHAR(40) NOT NULL,                    -- 'oi_...'
  order_id     VARCHAR(36) NOT NULL,
  book_id      VARCHAR(36) NOT NULL,                    -- FINALIZED book만
  quantity     INT NOT NULL DEFAULT 1,
  item_status  ENUM('CREATED','IN_PRODUCTION','PRODUCTION_COMPLETED','FAILED','CANCELLED') NOT NULL DEFAULT 'CREATED',
  unit_amount  DECIMAL(12,2) NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_order_items_uid (uid),
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_book (book_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.12 [오너 게이트] `credit_accounts` [Stage 6 — §9-1]

```sql
CREATE TABLE IF NOT EXISTS credit_accounts (
  id          VARCHAR(36) PRIMARY KEY,
  site_id     VARCHAR(36) NOT NULL,
  env         ENUM('test','live') NOT NULL,
  model       ENUM('ledger','wallet') NOT NULL DEFAULT 'ledger',  -- AD-4: Ledger 우선, 겸용 설계
  balance     DECIMAL(14,2) NOT NULL DEFAULT 0,        -- wallet=잔액 / ledger=미정산 누계(음수 허용)
  currency    VARCHAR(3) NOT NULL DEFAULT 'KRW',
  status      ENUM('active','frozen') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_credit_accounts_site_env (site_id, env)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

### 2.13 [오너 게이트] `credit_transactions` [Stage 6 — §9-1]

```sql
CREATE TABLE IF NOT EXISTS credit_transactions (
  id           VARCHAR(36) PRIMARY KEY,
  account_id   VARCHAR(36) NOT NULL,
  type         ENUM('charge','deduct','refund','adjustment','settlement') NOT NULL,
  amount       DECIMAL(14,2) NOT NULL,                  -- 부호 있는 증감
  balance_after DECIMAL(14,2) NOT NULL,
  reason_code  VARCHAR(40) NULL,                        -- 차감/조정 사유 코드 카탈로그(Stage 6 확정)
  order_id     VARCHAR(36) NULL,
  memo         VARCHAR(300) NULL,
  is_test      BOOLEAN NOT NULL DEFAULT FALSE,          -- sandbox 가상 거래
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_credit_tx_account (account_id, created_at),
  INDEX idx_credit_tx_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

---

## 3. 응답/에러 봉투 + ERR_* 카탈로그 초안

### 3.1 성공 봉투

```json
{
  "success": true,
  "message": "Success",
  "data": { },
  "pagination": null
}
```

- `data`: 단건=객체, 목록=배열. 목록 응답에서만 `pagination` 객체(§5) 채움.
- 필드 4종 고정 — v1 전 라우트 공통(성공 인터셉터가 부착). 최상위에 다른 키를 추가하지 않는다(추가 시 additive 검토+문서 동시 갱신).

### 3.2 에러 봉투

```json
{
  "success": false,
  "errorCode": "ERR_VALIDATION_FAILED",
  "message": "요청 본문 검증에 실패했습니다",
  "errors": [
    { "code": "PAGE_COUNT_OUT_OF_RANGE", "message": "pageCount 는 24~200 범위여야 합니다" }
  ],
  "fieldErrors": {
    "pageCount": ["pageCount must be between pageMin and pageMax"]
  },
  "requestId": "req_01J9ZX3ABCD"
}
```

- **파트너 계약 원칙(문서에 명기)**: 분기는 `errorCode`(와 필요 시 `errors[].code`)로만 한다. **`message` 문자열 파싱 금지** — 메시지는 예고 없이 개선될 수 있다.
- `requestId`: 요청마다 발급, `public_api_audit_logs.request_id`와 동일값 — 지원 문의 시 상호 참조 키.
- `errors`: 도메인 상세(복수 가능, 없으면 `[]`), `fieldErrors`: DTO 필드 단위(없으면 `null`).
- v1 스코프 전역 예외 필터가 부착 — **기존 `/api`·`/external` 라우트의 에러 shape는 무접촉**(AD-1).

### 3.3 ERR_* 카탈로그 초안 (29종)

표기: 코드 / HTTP / 발생 지점. `[게이트]` = Stage 6 오너 게이트 라우트 전용.

**공통 (8)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_UNAUTHORIZED` | 401 | 키 누락/무효/폐기(`revoked`) |
| `ERR_FORBIDDEN` | 403 | 유효 키이나 리소스 권한 없음(타 사이트 리소스 — 존재 은닉이 필요한 조회는 404로 응답) |
| `ERR_ENV_MISMATCH` | 403 | test 키로 live 전용 동작 호출(또는 역방향) |
| `ERR_NOT_FOUND` | 404 | 리소스 없음(타 테넌트 리소스 포함 — IDOR 존재 노출 방지) |
| `ERR_VALIDATION_FAILED` | 400 | DTO 검증 실패(fieldErrors 동반) |
| `ERR_RATE_LIMITED` | 429 | per-Key/per-IP 한도 초과 — `Retry-After` 헤더 동반 |
| `ERR_INTERNAL` | 500 | 미분류 서버 오류(requestId로 추적) |
| `ERR_SERVICE_UNAVAILABLE` | 503 | 일시 불능(스토리지/큐 등 하위 의존) |

**멱등성 (2)** — §4

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_IDEMPOTENCY_KEY_MISMATCH` | 422 | 동일 키 + 다른 body hash |
| `ERR_IDEMPOTENCY_IN_PROGRESS` | 409 | 동일 키 처리 중(원 요청 미완) |

**업로드/파일 (4)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_FILE_TOO_LARGE` | 413 | v1 직접 업로드 한도 초과 → presigned 경로 안내 |
| `ERR_UNSUPPORTED_CONTENT_TYPE` | 415 | 콘텐츠타입 화이트리스트 밖(기존 `ALLOWED_CONTENT_TYPES` enum 승계 — pdf/jpeg/png/webp/gif) |
| `ERR_STORAGE_NOT_S3` | 503 | presigned 계열 위임 시 스토리지 드라이버 미충족. ⚠️ 기존 동결 계약의 **본문 문자열 `STORAGE_NOT_S3`**(presigned-upload.service.ts)와 별개 표면 — 동결 문자열은 불변, v1은 봉투 errorCode로 표준화 |
| `ERR_FILE_NOT_READY` | 409 | 업로드 미확정(complete 전) 파일 참조 |

**BookSpecs (2)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_BOOK_SPEC_NOT_FOUND` | 404 | 판형 없음/비활성 |
| `ERR_PAGE_COUNT_OUT_OF_RANGE` | 422 | calculated-size·finalization 공용 — pageMin/Max/Increment 위반(`errors[].code`로 `PAGE_COUNT_INCREMENT` 세분) |

**Books/자산/최종화 (8)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_BOOK_NOT_DRAFT` | 409 | FINALIZED 책에 자산 투입/변경 시도 (AD-3 게이트) |
| `ERR_ASSET_ALREADY_EXISTS` | 409 | POST 자산 신규 투입인데 동일 유형 기존재(→PUT 사용 안내) |
| `ERR_ASSET_NOT_FOUND` | 404 | PUT 교체인데 기존 자산 없음(→POST 사용 안내) |
| `ERR_ASSET_INCOMPATIBLE` | 422 | creationType과 자산 유형 불일치(예: PDF_UPLOAD 책에 photos) |
| `ERR_ASSETS_INCOMPLETE` | 422 | finalization 착수 시 필수 자산 미비(표지/내지) |
| `ERR_FINALIZATION_IN_PROGRESS` | 409 | finalization 진행 중 재호출(멱등키 없는 재호출 포함) |
| `ERR_PDF_VALIDATION_FAILED` | 422 | finalization 내부 워커 검증 실패 — `errors`에 검증 상세 매핑 |
| `ERR_SESSION_NOT_PROMOTABLE` | 409 | EDITOR_SESSION 승격 실패 — 세션 미완료/타 사이트 소유/이미 승격됨(`errors[].code` 세분) |

**Webhooks (3)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_WEBHOOK_CONFIG_NOT_FOUND` | 404 | config 미등록 상태에서 test/deliveries 조작 |
| `ERR_WEBHOOK_URL_FORBIDDEN` | 422 | SSRF 가드 위반(사설대역/비allowlist — 기존 발신 SSRF 방어 정책 승계) |
| `ERR_DELIVERY_NOT_RETRYABLE` | 409 | DELIVERED 상태 재발송 시도 등 |

**[게이트] Orders/Credits (2)**

| errorCode | HTTP | 설명 |
|---|---|---|
| `ERR_ORDER_NOT_CANCELLABLE` | 409 | 생산 착수 후 취소 시도 |
| `ERR_INSUFFICIENT_CREDIT` | 402 | Wallet 모델 선택 시(AD-4) 잔액 부족 — 진단 객체를 `errors`에 동반 |

> 카탈로그는 **additive-only로 성장**한다: 코드 추가는 허용, 기존 코드의 의미 변경·삭제·HTTP status 변경은 v1 내에서 금지(변경 필요 시 v2). 카탈로그 정본은 본 문서 → Stage 1에서 `packages/types`의 `ErrV1` enum으로 승격해 SDK(Stage 4)와 공유.

---

## 4. 멱등 규칙 (Idempotency-Key)

### 4.1 규칙 정본

| 항목 | 규칙 |
|---|---|
| 헤더 | `Idempotency-Key: <파트너 임의 문자열, 1~128자>` |
| 적용 대상 | v1의 모든 **POST**(자산 투입·books·finalization·webhooks test/retry·[게이트] orders/credits). GET/PUT/DELETE는 자연 멱등으로 간주해 캐시하지 않음 |
| 필수 여부 | 권장(SDK는 자동 부여). 미제공 시 멱등 보호 없이 통과 — 단 `POST /orders`([게이트])는 **필수**로 승격 예정 |
| 스코프 | `siteId + env + method + path(파라미터 실값 포함) + Idempotency-Key` — 사이트·환경 간 충돌 없음 |
| body hash | canonical JSON(키 정렬) SHA-256을 `request_hash`로 저장 |
| 동일 키 + 동일 body | 최초 응답 스냅샷 그대로 재전달(HTTP status 포함) + `Idempotency-Replayed: true` 헤더 |
| 동일 키 + 다른 body | `422 ERR_IDEMPOTENCY_KEY_MISMATCH` |
| 처리 중 동일 키 | `409 ERR_IDEMPOTENCY_IN_PROGRESS` (원 요청 완료 대기 후 재시도 안내) |
| TTL | **24h** (`expires_at` 인덱스 + 일 1회 sweep cron — 기존 retention cron 패턴 승계) |

### 4.2 구현 노트 (Stage 1)

- NestJS 인터셉터로 구현, v1 컨트롤러에만 바인딩(AD-1 — 기존 표면 무접촉). 기존 내부 합성 3경로의 requestId 멱등(unique 인덱스)은 그대로 두고 **서로 간섭하지 않는다**.
- `in_progress` 행 선점은 `INSERT ... ON DUPLICATE` 원자 연산으로 — Bull 재시도·동시 요청 경쟁 조건에서 이중 실행 차단(기존 합성 멱등가드의 완료마커 설계 교훈 승계).
- 응답 스냅샷은 성공(2xx)과 결정적 실패(4xx)만 저장. 5xx는 저장하지 않아 재시도 가능하게 유지.

---

## 5. 페이지네이션 + 레이트리밋

### 5.1 페이지네이션 규약 (v1 목록 라우트 공통)

- 쿼리: `limit`(기본 **20**, 최대 **100** — 초과값은 100으로 캡) + `offset`(기본 0).
- 응답 봉투의 `pagination` 객체:

```json
{
  "pagination": { "total": 137, "limit": 20, "offset": 40, "hasNext": true }
}
```

- 정렬 기본 `created_at DESC`(문서 명기). cursor 방식은 v1 범위 밖(필요 시 additive 쿼리 파라미터로 후행).

### 5.2 레이트리밋 정책

| 정책 | 단위 | 한도(초기값) | 비고 |
|---|---|---|---|
| v1 general | **per API Key** | 300 req/min | 벤치마크 실측 기반 초기값 — 운영 데이터로 조정 |
| v1 upload/finalization | per API Key | 100 req/min | 워커 큐 보호 |
| 키 관리·인증 계열(Stage 2 포털) | per IP | 10 req/min | 크리덴셜 스터핑 방어 |
| 현행 per-IP 전역(기존 Throttler) | per IP | 현행 유지 | **병존** — v1 per-Key는 추가 레이어이며 기존 per-IP 정책을 대체하지 않음 |

- 429 응답: `ERR_RATE_LIMITED` 봉투 + **`Retry-After`**(초) 헤더 필수.
- 구현: ThrottlerGuard 커스텀 트래커(키 단위 식별자 = `siteId:env:keyId`), v1 스코프에만 바인딩. 한도표는 파트너 문서(가이드 §1.6 확장)에 공개.
- test env 키는 별도(더 낮은) 한도 운용 가능 — Stage 2에서 확정.

---

## 6. creationType 4종 ↔ 기존 시스템 재사용 매핑 + finalization 상태머신

### 6.1 creationType 4종 매핑 (AD-2)

**대원칙**: books는 기존 edit_sessions/files/worker_jobs를 **대체하지 않는 파사드**다. 내부 오케스트레이션만 하고 기존 모듈 시맨틱은 무접촉.

| creationType | 파트너 여정 | 내부 재사용(오케스트레이션) |
|---|---|---|
| `PDF_UPLOAD` | 표지/내지 PDF 투입 → finalize | `files`(직접 업로드 ≤100MB 또는 presigned/multipart 동결 표면의 fileId 참조) → 워커 `validate` → `synthesize`/`compose-mixed` → 산출 고정 |
| `TEMPLATE` | 판형+템플릿 선택, 파라미터 바인딩 → finalize | `template_sets` 참조 + `binding_params` 저장 → 내부 `edit_sessions` 생성(렌더 파이프라인 재사용) → 워커 렌더/합성 |
| `MIX_COVER_TEMPLATE` | 표지=템플릿 바인딩 + 내지=PDF → finalize | 표지: TEMPLATE 경로 / 내지: PDF_UPLOAD 경로 → `compose-mixed`(기존 outputMode 규약 재사용) |
| `EDITOR_SESSION` | 임베드 편집기에서 완성한 세션을 책으로 승격 | 완료 상태 `edit_sessions`(**같은 site 소유 검증** — 교차 테넌트 승격 차단) → 세션 산출 PDF를 `book_assets`로 연결. **storige 차별재** — 임베드 편집기→책→생산의 공식 경로 |

자산 유형 호환 매트릭스(`ERR_ASSET_INCOMPATIBLE` 판정 기준):

| creationType | pdf_cover | pdf_contents | photo | cover_binding | contents_binding |
|---|---|---|---|---|---|
| PDF_UPLOAD | ✅ | ✅ | ✖ | ✖ | ✖ |
| TEMPLATE | ✖ | ✖ | ✅ | ✅ | ✅ |
| MIX_COVER_TEMPLATE | ✖ | ✅ | ✅(표지 바인딩용) | ✅ | ✖ |
| EDITOR_SESSION | (세션 산출 자동 연결 — 수동 투입 ✖) | | | | |

### 6.2 Book 상태머신 (AD-3)

```
DRAFT ──(POST finalization: 자산 완비 + 페이지 규칙 통과 + 워커 성공)──▶ FINALIZED
  ▲                                                                        │
  │  자산 투입/교체 가능                                    편집 불가·주문 가능
  └── finalization 실패 시 DRAFT 유지(book_finalizations 에 FAILED 이력)
```

- 상태 2종만 둔다(단순성 우선). `FINALIZED → DRAFT` 되돌림(un-finalize)은 v1 범위 밖 — 필요 시 새 book 생성 유도. [게이트] orders 도입 시 "주문된 FINALIZED book 삭제 금지" 제약 추가.
- 발주 후 디자인 동결(editLock) 트랙과의 관계: editLock은 edit_sessions 계층, FINALIZED는 book 계층 — 독립이되 EDITOR_SESSION 승격 책이 FINALIZED 되면 원 세션 lock을 권고(Stage 3 구현 시 결정, 동결 라우트 무접촉 범위에서만).

### 6.3 finalization 실행 상태머신

```
PENDING ─▶ VALIDATING ─▶ COMPOSING ─▶ COMPLETED
              │              │
              └─▶ FAILED ◀───┘   (error_code = ERR_PDF_VALIDATION_FAILED 등)
```

- `POST /finalization` 동작 순서: ① BookSpec 페이지 규칙(pageMin/Max/Increment) 사전 검증 → ② 기존 워커 `validate` 잡 → ③ `synthesize`/`compose-mixed` 잡 → ④ 산출물 `book_finalizations.output_file_id` 고정 → ⑤ 웹훅 `book.finalization.completed` 발송.
- **재호출 멱등**: 진행 중(`PENDING/VALIDATING/COMPOSING`) 재호출은 `409 ERR_FINALIZATION_IN_PROGRESS`, `COMPLETED` 후 재호출은 기존 결과 재전달(200). `FAILED` 후 재호출은 새 attempt 행 생성(attempt+1).
- 폴링 표면 `GET /finalization`과 웹훅을 병행 제공(웹훅 미구성 파트너도 완주 가능 — 100p 폴링 관행 승계).
- test env 책의 finalization은 Stage 2 환경 모델 규칙(워터마크 더미 산출물 + retention 24h)을 따른다.

---

## 7. 인증 (AD-5)

### 7.1 v1 인증 규약

- **두 헤더 병행 수용, 동일 키 검증**:
  - `Authorization: Bearer <key>` — 신규 문서 우선 표기(HTTP 생태계 표준·프록시 로깅 관행상 유리)
  - `X-API-Key: <key>` — 기존 파트너 관행 호환
- 둘 다 오면 `Authorization` 우선, 값 불일치 시 `401 ERR_UNAUTHORIZED`(모호성 거부).
- 검증 로직: **v1 전용 가드(PartnerApiKeyGuard)** — 내부에서 기존 `ApiKeyGuard`의 sites 키 검증 로직을 재사용(위임)하고 Bearer 추출 어댑터+`partner_api_keys` 조회 폴백(env 스코프 검사 포함)을 얹는다. **공용 `ApiKeyGuard` 자체는 무수정**(§2.1과 동일 원칙 — v1 키가 기존 표면으로 새는 것을 구조적으로 차단). 기존 ADR-3(X-API-Key 통일)과 충돌 없음 — 기존 표면은 X-API-Key 그대로, Bearer 수용은 v1 신규 표면에만.
- v1 요청 컨텍스트는 기존 `@CurrentSite()`(siteId/siteName/role/retentionDays)를 재사용하고, Stage 2부터 `env`·`apiKeyId`를 additive 확장.
- **모든 v1 리소스는 site 스탬프 필수**(NULL-siteId 금지) — 기존 표면의 NULL 관용(CONTRACT_FREEZE §4.3)은 무접촉(오너 결정 사안, §9-8)이되 v1은 처음부터 강제.

### 7.2 키 보안 로드맵 (Stage 2 참조)

해시 저장(신규 키부터 병행 기록·이중 검증, 빅뱅 금지) · 발급 1회 노출+prefix 마스킹 · 오버랩 회전(유예 72h+만료 배치) · env(test|live) 스코프. 본 설계서는 §2.1 스키마와 원칙만 고정하고 **상세 정책·이행 절차는 Stage 2 작업지시가 정본**. Stage 1 시점에는 현행 sites 키로 v1 인증을 시작한다(파트너 재발급 강제 없음).

---

## 8. 기존 재사용 ↔ 신규 구분표 + 회귀 방지 테스트 목록

### 8.1 재사용 ↔ 신규 구분표

| 영역 | 기존 재사용(무접촉) | v1 신규 |
|---|---|---|
| 인증 | `ApiKeyGuard`·`@CurrentSite`·sites 키 2종 | Bearer 추출 어댑터, (Stage 2) `partner_api_keys`·env 스코프 |
| 판형/사이즈 | `SpineService` 계산 로직·paper/binding 데이터·`LEGACY_SIZE_TOLERANCE_MM`(읽기만) | `book_specs` 마스터 테이블·calculated-size 라우트·시드 수집 스크립트 |
| 파일 | `files` 저장 계층·presigned/multipart 동결 표면·retention/softDelete 정책·`ALLOWED_CONTENT_TYPES` | v1 자산 라우트(fileId 참조 투입)·`book_assets` |
| 편집 세션 | `edit_sessions` 전 시맨틱·`/embed` postMessage 엔벨로프 | EDITOR_SESSION 승격 경로(조회+참조만) |
| 워커 | `worker_jobs`·Bull 큐·validate/synthesize/compose-mixed 프로세서·검증 상수 전부 | finalization 오케스트레이터(`book_finalizations`) |
| 템플릿 | `templates`/`template_sets` 데이터 모델·기존 노출 경로 | v1 읽기 라우트(테넌트 스코프)·schema 추출기(Stage 5) |
| 웹훅 | v1(base64) 발신 바이트·이벤트 7종·`X-Storige-*` 헤더·SSRF 가드 | `webhook_configs`/`webhook_deliveries`·재시도 백오프·retry/test API(HMAC 전용) |
| 에러 | 기존 라우트별 shape(동결 문자열 `STORAGE_NOT_S3` 포함) | v1 봉투+`ERR_*` 카탈로그+전역 필터(v1 스코프) |
| 레이트리밋 | 전역 per-IP Throttler | per-Key 트래커(v1 스코프, 병존) |
| 감사 | Sentry·pino 로깅 | `public_api_audit_logs`+requestId 봉투 연동 |
| 멱등 | 내부 합성 3경로 requestId unique 인덱스 | `partner_idempotency_keys`+v1 인터셉터 |

### 8.2 회귀 방지 테스트 목록

**기존 게이트(전 Stage 머지 전제 — 항상 green)**

1. `contract-freeze.spec.ts` — 동결 표면(경로·메서드·인증·리밋) 리플렉션 고정. v1 작업이 이 spec을 건드리면 그 자체가 위반 신호.
2. GUARDED 계약 테스트(Stage 0 작업 4 산출) — 동결 17라우트(ADDITIVE fix-bleed 포함) 밖 외부 라우트 **10종**(validate/synthesize/split-synthesize/check-mergeable/fix-pagecount external, PATCH external/:id/status 2종, imposition-preview, shop-session, product-template-sets/by-product)의 가드·인증 시맨틱 고정.
3. 웹훅 서명 3종 대조표 spec(pairwise 골든) — v1(base64) 발신 바이트 불변 증명.
4. `pnpm --filter @storige/types build` → 전체 typecheck/build/test.

**v1 신규(Stage별 신설 후보)**

| # | 테스트 | Stage | 요지 |
|---|---|---|---|
| 5 | v1 봉투 e2e | 1 | 성공 4필드/에러 6필드 shape·requestId 존재·기존 `/api` 라우트 shape 불변(스냅샷 대조) |
| 6 | 멱등 e2e | 1 | 동일키 재전달(스냅샷 동일)·다른본문 422·처리중 409·TTL 만료 후 신규 처리·동시 요청 원자성 |
| 7 | 429 e2e | 1 | per-Key 한도 초과 시 `ERR_RATE_LIMITED`+`Retry-After`·타 키 비간섭·기존 per-IP 병존 |
| 8 | calculated-size 정합 spec | 1 | 응답 mm대로 만든 픽스처 PDF가 워커 `validatePageSize`를 통과(±1mm) — **워커 상수를 참조만** 하는 방향 단언 포함 |
| 9 | v1 인증 spec | 1 | Bearer/X-API-Key 동등 수용·불일치 401·suspended 사이트 401 |
| 10 | v1 계약 동결 spec(contract-freeze 패턴 복제) | 1+ | v1 자체 라우트맵·인증 시맨틱 리플렉션 고정 — v1도 출시 즉시 자기 계약을 CI로 동결 |
| 11 | books 상태 전이 spec | 3 | DRAFT→FINALIZED 게이트·FINALIZED 후 자산 투입 409·POST/PUT 409/404 규약·호환 매트릭스 |
| 12 | creationType 4모드 e2e | 3 | 각 모드 최소 완주 시나리오(finalization까지)·EDITOR_SESSION 교차 테넌트 승격 404 |
| 13 | finalization 멱등 spec | 3 | 진행중 409·COMPLETED 재전달·FAILED 재시도 attempt 증가 |
| 14 | 웹훅 delivery spec | 2 | 상태 흐름(PENDING→…→EXHAUSTED)·백오프 스케줄·수동 retry·HMAC 서명이 CONTRACT_FREEZE §1-E 발신 정본 형식과 일치 |
| 15 | 기존 파트너 스모크(수동/반자동) | 전 Stage | 100p 업로드→검증→합성 경로·임베드 2곳 골든 시나리오 — 배포 게이트 |
| 16 | 테넌트 격리 매트릭스 spec | 3+ | siteA 책/자산/이력이 siteB 키로 404·목록 비노출·감사 로그 site 스탬프 |

---

## 9. Owner Decision Required

CONTRACT_FREEZE 위배가 필요해 보이거나 사업/법률 결정이 선행돼야 하는 항목은 **구현 후보에서 제외**하고 여기로 분리한다. 아래 항목은 결정 전 어떤 Stage에서도 착수 금지.

| # | 항목 | 관련 | 내용/권고 |
|---|---|---|---|
| 1 | **과금 모델 확정값** | Stage 6, §2.12~13 | Settlement Ledger(후불) vs Credit Wallet(선불) vs 구독. AD-4 권고=Ledger 우선+Sandbox 가상 잔액. 확정 전 `pricing`·`amount` 컬럼은 null 운용, estimate/402 계약 미확정 |
| 2 | **경량 Orders 도입 여부** | Stage 6, §1.6 | 생산 상태 추적 모듈 도입 + 풀필먼트 포지셔닝(북모아 인쇄망 결합 상품화 여부). 라우트·테이블은 자리만 예약 |
| 3 | **Swagger `/api/docs` 접근 정책** | Stage 1-5 | production 무가드 공개 서빙 중(main.ts 등록에 환경 분기 없음). B안(파트너 대면 큐레이션) 구현 완료·**배포 승인 대기** — v1 OpenAPI export는 이 결정과 묶어 처리. 접근 정책 변경 자체는 오너 확인 사안 |
| 4 | **NULL-siteId 이원 정책 집행** | CONTRACT_FREEZE §4.3 | 기존 표면의 NULL 관용(assertSiteAccess 통과·게스트 NULL 스탬프)은 레거시 회귀 위험으로 동결 유지 중. 집행(화이트리스트+신규 스탬프 강제)은 오너 결정. **v1은 결정과 무관하게 site 스탬프 필수로 설계**(§7.1) |
| 5 | **샌드박스 인프라 형태** | Stage 2 | 단일 VPS 논리 분리(env 컬럼) vs 도메인/인프라 실분리. 권고=논리 분리로 시작. 실분리 시 §2 테이블의 env 컬럼은 그대로 유효(이관 용이) |
| 6 | **book_specs 초기 시드 승인** | Stage 1 | products/spine·paper_types·binding_types·template_sets.productSpecs 정규화 수집 결과(스크립트 산출물)를 오너 검토 후 적용 — 자유입력 데이터라 자동 승인 불가 |
| 7 | **법률 문서(약관·DPA·SLA)** | Stage 6 | 신규 파트너 계약의 법적 전제(특히 수취인 개인정보 수탁 시 DPA). Orders에 배송/수취인 필드를 넣지 않은 이유이기도 함 — 범위 확장은 이 결정 후 |
| 8 | **기존 파트너 웹훅 v2 전환** | Stage 2, §1.5 | 발신 HMAC(hex·`t=`)과 기존 수신부(base64 기대) 형식 불일치 실증(CONTRACT_FREEZE §3). 수신부 실물 대조·재작성 전 전환 금지 — 전환 시점·순서는 파트너 협의 필요(오너/파트너 게이트) |
| 9 | **Live 키 발급 승인 체계** | Stage 2 | test 키는 셀프 발급, live 키는 운영자 승인 큐(2단 게이트 — 자동화하지 않음). 승인 기준(사업 확인 항목)은 오너 정의 |
| 10 | **`GET /files/:id/download/external` 무소유검증 특성** | CONTRACT_FREEZE §1-B | 동결 특성이라 v1 books `GET .../pdf`는 **소유 검증 있는 신규 표면**으로 설계(복제 금지 원칙 준수). 기존 표면의 특성 변경 여부는 별개 오너 사안 — v1 범위에서 제외 |

---

## 부록 A. 문서 관리

- **개정 규율**: 구현이 본 설계와 달라지면 코드가 아니라 **이 문서를 먼저 개정**(PR에 개정 diff 동반). ERR_* 카탈로그·라우트맵·봉투 shape 변경은 additive만 허용.
- **참조 관계**: 본 문서는 P트랙 로드맵 정본(§4 AD·§6 Stage 0~6)의 Stage 0 작업 5 산출물이며, Stage 1~6 작업지시가 이 문서를 구현 명세로 참조한다. 동결 계약 정본은 `docs/CONTRACT_FREEZE.md`, 파트너 대면 가이드 정본은 `docs/PLATFORM_INTEGRATION_GUIDE.md`.
- **PUBLIC 레포 규율**: 시크릿·실키·내부 IP·벤치마크 대상 기업/제품명 불기재.

---

## 부록 B. 산출물 (Stage 1 통합 — 2026-07-15)

Stage 1 코어(`feat/p1-partner-api-core`)와 BookSpecs(`feat/p1-book-specs`)를
`feat/partner-api-v1-stage1` 에서 병합·정합화한 실물 산출물 목록.

| 산출물 | 위치 | 비고 |
|---|---|---|
| v1 표준 스택 조합 데코레이터 | `apps/api/src/partner-api/partner-v1.decorator.ts` | @Public+가드 2종+필터+감사→멱등→봉투 인터셉터. Stage 3+ 신규 v1 컨트롤러의 진입점 |
| v1 코어 모듈 (가드·봉투·감사·멱등·리밋·페이지네이션) | `apps/api/src/partner-api/` | exports 로 타 도메인 모듈(BookSpecsModule 등)에 스택 공급 |
| BookSpecs 판형 마스터 GET 3라우트 | `apps/api/src/book-specs/` | v1 표준 스택 정합화 완료 — 수동 봉투 제거, pageCount 위반 422(§3.3 정본) |
| v1 계약 spec | `apps/api/src/partner-api/partner-api.v1.spec.ts` · `partner-rate-limit.v1.spec.ts` · `partner-idempotency.v1.spec.ts` · `pagination.spec.ts` · `book-specs.spec.ts` · `book-specs.v1.http.spec.ts` | supertest 실스택 관통 포함 — CI 게이트(`.github/workflows/ci.yml` api 테스트 스텝) |
| 파트너 전용 OpenAPI 스펙 export | `apps/api/src/scripts/export-openapi-partner.ts` (`pnpm --filter @storige/api openapi:partner` → `apps/api/openapi-partner.json`) | 'partner-v1' 태그 필터 + /api/v1/* 단언. CI 가 `openapi-partner` 아티팩트로 업로드. `/api/docs` 접근 정책은 무변경(§9-3 오너 사안) |
| 마이그레이션 2건 | `apps/api/migrations/20260715_add_public_api_audit_logs.sql` · `20260715_b_add_partner_idempotency_keys.sql` | 배포 순서: 마이그레이션 직접 실행 → API 재배포 (프로덕션 synchronize off) |

**잔여**: `docs/PLATFORM_INTEGRATION_GUIDE.md` 에 v1 표면·OpenAPI 스펙 등재 —
타 세션이 동 파일을 수정 중이어서 이번 통합에서 의도적으로 무접촉(충돌 예약).
가이드 등재는 해당 세션 종료 후 별도 커밋으로 수행한다.
