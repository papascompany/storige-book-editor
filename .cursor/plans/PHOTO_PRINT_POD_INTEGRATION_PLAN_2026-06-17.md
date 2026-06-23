# 사진인화 POD 연동 — 근본 개발 계획서

> 작성: 2026-06-17 · 대상: 외부 모바일 앱(Android/iPhone)의 사진인화 주문을 Storige 워커로 수신 → 검증·변환 → **주문확인** 가능 구조
> 방법론: 코드 ground-truth 실증(11-에이전트 워크플로) + 적대적 교차검증(코드실증/PIPA·보안/완전성 3렌즈)
> 상태: **설계 확정 + P0 오너 결정 게이트 대기**. 코드 착수 전 §3 결정 선행 필수.

---

## 0. 한 줄 요약

외부 사진인화 앱이 **주문 + 사진파일 + 인쇄옵션**을 우리 워커로 보내면, 우리는 (1) 데이터 검증(해상도/종횡비/포맷), (2) 이미지→인쇄용 PDF 변환, (3) **주문확인(printable) 신호 반환**까지 수행한다. 이것이 Storige가 책 편집기를 넘어 **범용 POD(주문형 인쇄) 백엔드**로 자리잡는 첫 수직 통합이다.

**전제가 되는 단 하나의 결정(척추)**: papas/Storige가 **실제 인쇄·발송까지(이행)** 하는가, 아니면 **검증·변환·주문확인까지만** 하고 이행은 외부 앱/별도 시스템에 넘기는가. 이 한 줄이 개인정보(배송) 저장 여부 전체와 PIPA 컴플라이언스 부담을 100% 결정한다. → **§3에서 오너 결정**.

---

## 1. 배경 · 전략적 의의

- 현재 Storige는 **책 인쇄 편집기** 중심: 에디터(Fabric) → `edit_sessions` → 워커잡(validate/convert/synthesize, 전부 PDF-in/PDF-out·표지/내지/책등/제본 지향).
- 이번 요구는 **에디터가 없는 새 흐름**: 외부 앱이 이미 사진을 가지고 있고, 우리는 **데이터 처리(검증·변환)+주문확인**만 한다. 사이즈는 인치 사진규격(4×6·5×7·8×10·11×14)+ISO(A4·A3·A2).
- 멀티테넌시 인프라가 이미 70% 깔려 있어(Site 엔티티·`X-API-Key`→`@CurrentSite()`·site_id 스코핑) **새 외부 사이트(=사진 앱)를 테넌트로 얹는 비용이 작다**. POD 플랫폼화의 결정적 발판.

---

## 2. 현행 Ground-Truth (코드 실증 결과)

워크플로가 실제 파일을 읽어 검증한 사실. 설계는 전부 이 위에 선다.

### 2.1 재사용 가능 (검증 confirmed)
| 자산 | 위치 | 용도 |
|---|---|---|
| 외부 인증·테넌트 주입 | `auth/guards/api-key.guard.ts`, `@CurrentSite()` | `editorAuthCode→workerAuthCode` 매칭 후 `req.user={siteId,...}`. POST 인테이크에 `{...dto, siteId: site?.siteId}` 스프레드(`worker-jobs.controller.ts:69-77`) 그대로 복제 |
| 멱등성 제어흐름 | `worker-jobs.service.ts:579-591, 716-736` | find-then-create + unique-violation race-catch. **인덱스 컬럼셋은 신규**(아래) |
| 큐에 잡명 추가 패턴 | `app.module.ts:79-83`, `conversion.processor.ts`+`render.processor.ts` | 한 큐(`pdf-conversion`)에 두 잡명 공존. 새 `@Processor` 추가로 `registerQueue` 변경 불필요 |
| 검증 결과 계약 | `validation-result.dto.ts`, `pdf-validator.service.ts:311` | `{isValid, errors[], warnings[], metadata}`, `isValid = errors.length===0`. ErrorCode/WarningCode enum은 멤버 추가 가능(개방) |
| DPI 게이트 상수 | `validation.config.ts:36,38` | `RECOMMENDED_DPI=300` / `MIN_ACCEPTABLE_DPI=150` — 사진 요구와 정확히 일치 |
| GS 안전 인프라 | `utils/ghostscript.ts` | `runGhostscript()`(SIGTERM→SIGKILL 타임아웃) + `gsSemaphore`(GS_CONCURRENCY=2), `MM_TO_PT`/`getPdfInfo`, `addBleedToPdf`, `resizePdf`(-dPDFFitPage) |
| 파일 보존 자동만료 | `files.controller.ts:186-191`, `file-retention.service.ts` | 업로드 시 `site.retentionDays`→`expires_at` 자동설정 + cron 하드삭제 |
| SSRF allowlist | `webhook.service.ts:61-92` | http/https + 호스트 allowlist. 단 `WEBHOOK_ALLOWED_HOSTS='*'`면 무력화 → prod 미설정 유지 |
| 입력 다운로드 | `pdf-converter.service.ts:495-518`(downloadFile), `pdf-page-renderer.service.ts:58-71`(loadBytes) | `/storage`·절대/상대·**HTTP URL** 모두 처리 → fileUrl 패스스루 가능(단 가드 필요, §5) |

### 2.2 부재 — 전부 net-new (검증 confirmed)
- ❌ **이미지(JPEG/PNG/HEIC)→인쇄용 PDF 경로 자체가 없음.** `embedJpg/embedPng/drawImage` grep = 0건. `sharp@^0.33.5`는 package.json에 선언됐으나 **import 0건**. 래스터 디코드·크롭·리샘플·임베드 전부 그린필드.
- ❌ **ICC/CMYK 색변환 없음.** GS `PRINT_PRESERVE_ARGS`는 기존 의도 *보존*만(`ghostscript.ts:51`), `detectCmykUsage`(:578)는 *측정*만. sRGB→CMYK는 net-new(press ICC 프로파일 필요).
- ❌ **HEIC 디코드 불가.** worker Docker(`docker/worker/Dockerfile`, node:22-alpine)에 ghostscript+imagemagick만, **libheif 없음**. iPhone 기본 포맷 → §5 결정 필요.
- ❌ 외부 업로드는 **PDF 전용**(`files.controller.ts:151-163`이 `mimetype!=='application/pdf'` 거부). `FileType` enum에 PHOTO 없음.
- ❌ Storige 자체 DB는 **PII-free**(`recipient|shipping|tracking_no|postal_code|address1` grep = 0). 연락처 PII는 읽기전용 bookmoa `member`에만.

### 2.3 ⚠️ 발견된 기존 결함 (복제 시 상속 위험)
1. **`GET/PATCH /worker-jobs/external/:id` 는 siteId 스코핑이 없는 라이브 IDOR.** `findOneExternal`→`findOne(id)`(`worker-jobs.controller.ts:277`, `service:1138`)가 id로만 조회 → **유효한 사이트키 아무거나로 타 테넌트 잡 조회/변경 가능.** 3개 리뷰 렌즈가 독립 지목. **이것을 "조회격리 템플릿"으로 복제하면 안 됨** — 사진은 개인사진이라 책 PDF보다 피해 큼.
2. **NULL-siteId IDOR.** `files.service.ts:309 assertSiteAccess()`는 caller·file 양쪽 siteId가 **둘 다 set이고 다를 때만** 차단. `file.siteId`가 NULL이면 **아무 테넌트나 다운로드/하드삭제 가능**. 사진 업로드는 site_id NOT NULL 강제 필요.
3. **큐 페이로드 머지 버그.** `worker-jobs.service.ts:257`이 DB엔 머지된 옵션을 저장(:244)하면서 **Bull 큐엔 raw dto.orderOptions를 전달** → 사이트 기본값이 워커에 미전달. 사진 fan-out이 이 메서드를 복사하면 버그 상속.
4. **웹훅 서명이 base64(위조가능).** `webhook.service.ts:160-167` = `base64(id:event:ts)`, 시크릿/HMAC 없음, replay 방어 없음. `Site.webhook_secret` 컬럼도 없음.
5. **FileRetention cron은 admin 토글로 early-return**(`file-retention.service.ts:39-42`). PII 파기 보증용으로 그대로 쓰면 **조용히 미실행** 위험(PIPA 파기의무 위반).

---

## 3. 🔴 척추 결정 — 이행경계 & PII (오너 결정 게이트, 코드 0줄)

> **이 결정 없이는 스키마를 확정할 수 없고, shipping 관련 마이그레이션을 한 줄도 작성하면 안 된다.** PUBLIC 레포 + 시크릿 누출 이력 위에서 PII 컬럼을 투기적으로 만들면 git 히스토리로 영구 잔존 → 되돌리기 사실상 불가.

### 결정 A — 이행경계 (최우선)
- **A-1 (권장 기본)**: Storige는 **검증·변환·주문확인까지만**. 인쇄·포장·발송(이행)은 외부 앱 또는 papas 별도 생산시스템. → **raw 배송 PII를 한 글자도 안 받음.** 2026-06-17 멀티테넌시 결정("Storige PII 미수신·미저장") 보존.
- **A-2**: papas/Storige가 **직접 인쇄·발송**. → 배송라벨용 PII 불가피 → 결정 B에서 Opt-3(암호화 단기보관) 활성, PIPA 풀컴플라이언스 동반.

### 결정 B — PII 저장 모델 (A 결과에 종속)
| 옵션 | 내용 | 권장 |
|---|---|---|
| **Opt-1** 전체저장 | recipient/phone/address 평문 컬럼 | ❌ 비권장 (PUBLIC 레포 위험 최대) |
| **Opt-2** 토큰화/최소화 | 앱이 PII 보유. Storige는 `shippingToken`(앱 불투명 토큰) + `contactRef`(아래 ★) + `carrier/tracking_no`만 | ⭐ **주력 권장 (A-1과 짝)** |
| **Opt-3** 하이브리드 | received~shipped 동안만 AES-256-GCM 암호화 보관, 이행완료 후 **무조건 실행** cron 하드퍼지 + 접근감사 | A-2 확정 시에만 폴백 |

★ **PIPA 보정(검증 발견)**: `sha256(phone)`는 한국 휴대폰 공간(~10^8)에서 **수초 내 역산** → 개인정보로 간주됨. Opt-2의 "처리자 면제"는 과장. 채택 시 **(a) `HMAC(phone, per-site-secret)` 사용 또는 전화파생값 자체 미저장**, **(b) 토큰+끝4자리만 저장해도 개인정보 처리방침 고지 + 외부앱과 위탁(처리위탁) 근거 필요.** 오너+법무 사인오프 후 `photo_shipping_ref` 스키마 머지.

### 결정 C — 주문확정 트리거
- **C-1 (권장)**: 앱이 결제·확정 후 `PATCH /confirm` 명시 호출 → Storige는 `ready`(printable=true)만 보장.
- **C-2**: 모든 아이템 validated 도달 시 Storige가 자동 confirmed.

### 결정 D — 가격 책임
- **권장**: 앱이 가격 산정, Storige는 by-reference **echo만**(가격정책=외부 쇼핑몰 소유). Storige는 금전을 절대 이동시키지 않음.

> **게이트 규칙**: §3 결정이 본 문서에 서면 기록되기 전까지 — ① shipping/PII 컬럼 마이그레이션 금지, ② `photo_shipment_pii`(Opt-3) 테이블은 코드베이스에 **존재 자체 금지**(머지-후-비움도 불가), ③ 리뷰 룰로 recipient/address/phone 컬럼 추가 PR 차단.

---

## 4. 아키텍처 설계

### 4.1 데이터 모델

**신규 2 테이블(코어, PII-free) + 1 분리 테이블(정책 옵트인).**

```
photo_orders                         -- 주문 헤더
  id (uuid PK)
  site_id (varchar36, @CurrentSite 자동주입, ★NOT NULL — IDOR 방지)
  idempotency_key (varchar64)        -- 앱이 보낸 clientOrderId
  external_order_id (varchar64, nullable)
  status (varchar20)                 -- OrderStatus enum
  item_count (int)
  currency (varchar3, nullable) / total_amount (decimal, nullable)  -- echo만
  callback_url (varchar500, nullable)
  options (json)                     -- 비PII(배송수단/메모 등)
  created_at / updated_at / confirmed_at / completed_at
  UNIQUE(site_id, idempotency_key)   -- ★신규 partial-unique. 기존 worker_jobs 인덱스는 컬럼셋이 달라 재사용 불가
  INDEX(site_id, status), INDEX(external_order_id)

photo_order_items                    -- 아이템(사진 1장 = 1행)
  id (uuid PK)
  order_id (FK→photo_orders, INDEX)
  site_id (varchar36, NOT NULL, 조회 스코핑 복제)
  line_no (int)
  size_code (varchar20)              -- '4x6'|'5x7'|'8x10'|'11x14'|'A4'|'A3'|'A2'
  quantity (int)
  finish (varchar20)                 -- 'glossy'|'matte'
  border (varchar20)                 -- 'border'|'borderless'
  crop_mode (varchar20)              -- 'fit'|'fill'
  crop_rect (json, nullable)         -- 앱 제공 크롭 좌표(분쟁 방지)
  file_id (varchar36→files, nullable) / source_url (varchar500, nullable)
  worker_job_id (varchar36, nullable)
  item_status (varchar20)            -- ItemStatus enum
  output_file_id (varchar36, nullable)
  validation_result (json, nullable)
  display_reason_code (varchar40, nullable)  -- ★고객노출 사유(§4.5)
  error_code / error_message (nullable)
  created_at / updated_at

-- ★ Opt-3(결정 A-2) 확정 시에만 코드베이스에 추가:
photo_shipment_pii
  order_id (FK 1:1)
  recipient_name/phone/postal_code/address1/address2/country  -- AES-256-GCM 컬럼암호화(PII_ENC_KEY=.env, 커밋금지)
  purge_after (timestamp)            -- shipped+N일. ★무조건 실행 cron(admin토글 비종속) + 접근감사
```

### 4.2 외부 인테이크 API 계약

신규 `PhotoOrdersController`. 전부 `@Public() + @UseGuards(ApiKeyGuard) + @ApiSecurity('api-key')`, `@CurrentSite()` 스프레드로 siteId 자동주입.

```
POST /photo-orders/external                 -- 주문 인입
  body { idempotencyKey, externalOrderId?, callbackUrl?, currency?, totalAmount?,
         items:[{ lineNo, sizeCode, quantity, finish, border, cropMode, cropRect?,
                  fileId? | sourceUrl? }] }
  201  { orderId, status:'received', items:[{lineNo, itemId, workerJobId, itemStatus}] }
  (멱등: (siteId, idempotencyKey) 기존재 → 기존 order 반환)

GET  /photo-orders/external/:id             -- 상태 폴링 (★findOneScoped, siteId AND, 불일치 404)
  200  { orderId, status, confirmable, items:[{ itemStatus, displayReason,
         recommendedAction, validation:{isValid,warnings[]}, outputPdfUrl }] }

PATCH /photo-orders/external/:id/confirm     -- 주문확인 (멱등: confirmed→confirmed=200 no-op)
  200  { orderId, status:'confirmed', printable:true, items:[...] }   -- ready일 때만 성공, 아니면 409+사유

PATCH /photo-orders/external/:id/cancel      -- 취소 (received/validating/ready에서만, 멱등)
  200  { orderId, status:'canceled' }
```

> **★ IDOR 방지 필수**: 모든 GET/PATCH는 `where { id, siteId }`로 강제하고 불일치 시 404. **기존 `findOneExternal`(IDOR)을 복제하지 말 것** — `findOneScoped(id, siteId)`를 처음부터 작성.

### 4.3 워커 파이프라인 (이미지 → 인쇄용 PDF + 검증)

**기존 `pdf-conversion` 큐에 잡명 2개 추가** (또는 사진 전용 큐 격리 — §6 P2에서 결정). 신규 `PhotoProcessor(@Processor)` + provider 등록만으로 `registerQueue` 변경 불필요.

- **`photo-validate`** (GS 불필요, Sharp 최초 도입): `sharp(buf).metadata()`로 실제 픽셀 dims·format·EXIF orientation·ICC 읽기 → **정확한** DPI 게이트(기존 PDF 정규식 추정 `detectImageResolutionFromPdf`는 **재사용 금지**). 결과는 `ValidationResultDto` 계약 그대로.
- **`photo-convert`**: (a) `Sharp.rotate()` EXIF 회전 베이크 → (b) crop-to-aspect(fill=center-crop / fit=letterbox, 앱 `cropRect` 우선) → (c) `.resize()` 목표 px@dpi(다운스케일 항상 / 업스케일은 경고 기록 후만) → (d) [옵션] colourspace → (e) 고품질 JPEG/PNG 버퍼 → (f) **`pdf-lib` embedJpg/embedPng + drawImage**로 (트림+블리드) 크기 PDF 페이지에 배치 → (g) 필요 시 `runGhostscript()` 최종 패스.
- **역할 분담**: 래스터 작업=Sharp 전담, 이미지→PDF 배치=pdf-lib, PDF-레벨 후처리=GS(`gsSemaphore` 상속). 입출력 경로/상태/Sentry는 기존 보일러플레이트 그대로(`updateJobStatusWithRetry`, `captureJobException`).
- **무테(borderless) 블리드**: 기존 `addBleedToPdf`는 *기존 콘텐츠를 안쪽으로* 밀어 래스터엔 흰 가장자리가 남음 → **사진은 (트림+2×블리드) 크기로 크롭해 오버사이즈 페이지에 직접 배치**가 정답. 300dpi 3mm ≈ 35px/edge.
- **색공간(권장)**: **v1은 sRGB RGB PDF 단일 출력**("화면색≠인쇄색" 고지). CMYK는 press ICC가 필요한 net-new → 사이트/주문 옵션으로 게이팅(P2). `detectCmykUsage`로 결과 색모드 read-only 검증만 가능.

### 4.4 사이즈 매트릭스 (단일 진실원천, `config/photo-sizes.config.ts`)

`size_code`를 **권위 키**로 동결. inch→mm 변환은 **enqueue 시점 단 1회**, 잡 페이로드는 mm만 운반. `product_size` 테이블은 unit 컬럼이 없어 진실원천으로 부적합.

| size_code | 단위 | 트림(mm) | 종횡비 | 300dpi(px) | 최소 150dpi(px) | 블리드 |
|---|---|---|---|---|---|---|
| 4x6 | inch | 101.6 × 152.4 | 2:3 | 1200 × 1800 | 600 × 900 | 3mm |
| 5x7 | inch | 127 × 177.8 | 5:7 | 1500 × 2100 | 750 × 1050 | 3mm |
| 8x10 | inch | 203.2 × 254 | 4:5 | 2400 × 3000 | 1200 × 1500 | 3mm |
| 11x14 | inch | 279.4 × 355.6 | 11:14 | 3300 × 4200 | 1650 × 2100 | 3mm |
| A4 | mm | 210 × 297 | ~1:1.414 | 2480 × 3508 | 1240 × 1754 | 3mm |
| A3 | mm | 297 × 420 | ~1:1.414 | 3508 × 4961 | 1754 × 2480 | 3mm |
| A2 | mm | 420 × 594 | ~1:1.414 | 4961 × 7016 | 2480 × 3508 | 3mm |

> 각 엔트리에 **canonical orientation** 명시(4×6 = portrait 4w×6h 기준). 앱이 다른 방향 보내면 EXIF auto-orient 후 주문 방향으로 크롭 + `IMAGE_ORIENTATION_MISMATCH` 경고. 카탈로그에 없는 `size_code`는 인테이크에서 즉시 거부(`IMAGE_SIZE_UNKNOWN`).

### 4.5 주문 상태머신 + ★고객노출 상태/사유 계약

**내부 상태(OrderStatus)**: `received → validating → ready → confirmed → (in_production → shipped) → completed` / 분기 `failed`·`canceled`. `in_production`·`shipped`은 **결정 A-2(papas 직접발송)일 때만** 진입.

**아이템 상태(ItemStatus)**: `pending → processing → validated → converted → failed`.

**부분실패 정책(권장)**: 주문은 **아이템 단위 confirmable** — 1장이 너무 작아도 나머지 정상분은 확정 가능(소비자 사진앱 기대치). 실패 아이템은 사유와 함께 반환·제외.

**★고객노출 계약(이게 사용자가 말한 "주문확인" 산출물)** — `packages/types`에 추가:
```
CustomerItemStatus = PENDING | READY | NEEDS_REUPLOAD | REJECTED
displayReasonCode  = RESOLUTION_LOW | TOO_SMALL | WILL_BE_CROPPED |
                     ORIENTATION_MISMATCH | UNSUPPORTED_FORMAT | OK
recommendedAction  = none | reupload_higher_res | adjust_crop | choose_other_size
```
GET 응답이 아이템마다 `{itemStatus, displayReason, recommendedAction}`을 반환 → 앱이 사용자에게 "해상도가 낮아요/다시 올려주세요"를 표시. 워커 `ValidationError.fixMethod`(닫힌 union, 멤버 추가 필요)와 매핑.

### 4.6 주문확인 전달 — 폴링 우선, 웹훅 후행
- **1차(MVP)**: **폴링 전용** `GET /photo-orders/external/:id`. → 위조가능 웹훅을 주문확정 신호에 싣지 않음 = HMAC을 임계경로에서 제거.
- **2차(후속)**: `order.confirmed`/`order.failed` 이벤트를 per-order `callbackUrl`로 push(`webhook.service.ts sendCallback` 재사용). **단 §5 HMAC 보강 완료 후에만 활성.** 페이로드에 event id+timestamp 포함(앱 측 dedupe).

---

## 5. 🔒 보안 · 컴플라이언스 선결 (P0 블로커)

> 아래는 "나중에 하드닝"이 아니라 **go-live 차단 항목**. 사진은 개인 사진이라 책 PDF보다 프라이버시 영향이 크다.

1. **nginx `/storage/` 무인증 노출** (`docker/nginx/nginx.conf:95-102`, alias + `ACAO:*` + 무인증). `files.service.ts:89`가 업로더에게 raw `/storage/...` URL을 반환. **기존 `/files/:id/download/external` 프록시를 추가해도 열린 alias가 그대로 공존하므로 구멍이 안 닫힘.**
   → **사진은 raw `/storage/` URL 반환 금지.** (a) 사진 경로를 nginx가 alias하지 않는 위치로 이전 + 인증 프록시 강제, 또는 (b) 단기 TTL 서명 URL(HMAC+만료) + nginx `auth_request` 검증. **UUID 비추측성에 의존 금지.**
2. **NULL-siteId IDOR** (`files.service.ts:309`). → **사진 업로드·주문은 site_id NOT NULL 강제**, 사진 경로의 access-check는 NULL-vs-set도 거부(레거시 'shared' 폴백 없음). 회귀 테스트: 테넌트 B가 A의 fileId 요청 시 404.
3. **GET/PATCH IDOR** (§2.3-1). → `findOneScoped(id, siteId)` 처음부터, 교차테넌트 테스트 1건 필수.
4. **웹훅 HMAC + replay 방어**. → `Site.webhook_secret`(현재 없음) 신규 컬럼 + HMAC-SHA256(전체 body 서명) + 수신측 timestamp 신선도창+nonce. 그 전엔 **폴링 전용**. 재시도 경로에도 서명 헤더 포함.
5. **업로드 하드닝** (이미지 허용으로 확장 시). → mimetype(위조가능) 대신 **magic-byte 검사**, 디코드 전 픽셀/바이트 상한, `sharp({limitInputPixels})`(디컴프레션 폭탄·A2 35MP·8GB VPS), libheif 부재 시 HEIC 명시 거부. **Sharp 도입 PR과 동일 PR에서** 픽셀 상한 설정(P3로 미루면 초기 테스트 중 OOM).
6. **fileUrl 패스스루 선택 시**: `downloadFile/loadBytes`는 임의 URL을 가드 0으로 fetch → **워커 다운로드 경로에 magic-byte+픽셀상한+크기상한+SSRF allowlist** 추가(웹훅 allowlist는 요청측 전용). "최소표면=가드 불필요" 아님.
7. **per-site rate-limit**. → 현 `ThrottlerGuard`는 per-IP만(`app.module.ts`) → carrier NAT에서 한 IP 공유. 신규 라우트는 `@CurrentSite` siteId 키로 throttle + 멱등 유니크로 중복주문 비용 제한.
8. **PIPA(결정 A-2/Opt-3 채택 시)**: 수집·이용 동의(앱)·처리위탁 계약·안전성확보(암호화/접근통제/접근기록 1년+)·보유기간·파기·열람삭제 대응·처리방침 공개·유출통지. **파기 cron은 admin 토글 비종속 무조건 실행 + 접근감사.** → 저장 자체를 피하는 A-1/Opt-2가 최선의 컴플라이언스.

---

## 6. 단계별 개발 계획 (재절단된 진짜 MVP)

> ⚠️ 검증 결과 원안 "P1 백본 먼저"는 **데모 불가**(confirmed 게이트가 net-new Sharp 파이프라인에 의존 → 영원히 미확정). 아래는 **수직슬라이스**로 재절단.

### P0 — 결정·선결 게이트 (코드 0줄 / 0.5d + 결정대기)
- §3 이행경계 + PII 옵션 서면 확정(이게 모든 스키마의 선결).
- HEIC 실증: worker Alpine 이미지에서 `node -e "require('sharp')('x.heic').metadata()"` 실행 → libheif 유무 확정. 없으면 (a) 이미지에 libheif 추가(인프라) 또는 (b) "앱이 JPEG 변환 후 전송"을 연동 계약에 명문화.
- MVP 신호전달 = **폴링 전용** 확정(웹훅·HMAC을 임계경로에서 제외).

### P1 — 수직슬라이스: 4×6 단일 사이즈 E2E (L, ~1주)
**목표: 실제 4×6 JPEG 한 장이 confirmable 주문이 되는 데모.**
- `photo-sizes.config.ts`에 4×6만(+orientation), inch→mm 동결.
- **입력 = fileUrl 패스스루**(업로드 필터·`FileType.PHOTO` 작업을 임계경로에서 제거; 워커가 `loadBytes`로 직접 download) + **§5-6 다운로드 가드 동반**.
- `photo-validate`(Sharp metadata: dims+format+EXIF+DPI 게이트) → `ValidationResultDto`(신규 ErrorCode/WarningCode + `fixMethod` union 확장).
- `photo-convert`(auto-orient + fill-crop + resize + pdf-lib embed → sRGB PDF) + `sharp({limitInputPixels})` 동반.
- `photo_orders`+`photo_order_items`(PII-free) + `PhotoOrdersController`(POST + **findOneScoped** GET) + 멱등 `UNIQUE(site_id, idempotency_key)`(race-catch 복제) + 고객노출 상태/사유 계약(§4.5).
- fan-out enqueue는 **머지된 옵션** 전달(§2.3-3 버그 회피, `enqueued==persisted` 단언 테스트).
- **수용 기준**: 교차테넌트 404 테스트 통과, 4×6 실파일 → ready → `PATCH /confirm` → printable=true.

### P2 — 사이즈 확장 + 입력경로 + 큐 격리 (L)
- 나머지 6 사이즈(5×7·8×10·11×14·A4·A3·A2) + 종횡비/방향.
- 정식 업로드 경로(`FileType.PHOTO` + 이미지 MIME 화이트리스트 + **magic-byte/픽셀폭탄 가드**) + `site.retentionDays` 자동만료.
- 대형(A2 300dpi) 부하 → 사진 전용 Bull 큐 격리 or per-잡명 동시성/타임아웃/메모리 재산정.
- HEIC(P0 결정대로) + FIT(레터박스) 옵션.

### P3 — 주문확정 웹훅 + 운영 (M)
- `Site.webhook_secret` 마이그 + **HMAC-SHA256 + replay 방어** → `order.confirmed/failed` 웹훅 활성.
- per-site rate-limit. 상태머신 스위퍼(`worker-jobs-sweeper` 패턴)로 stuck 주문 복구.
- **Admin PhotoOrders 뷰**: 리스트/아이템 드릴다운 + **아이템 재시도** + **웹훅 재전송**(운영 지원성의 핵심) + Grafana 사진 큐 메트릭/Sentry.
- 최소 취소(`PATCH cancel`, 생산 전·멱등) + refund/reprint은 **명시적 Phase-4 이연**(refund=앱 책임).

### P4 — (조건부) Opt-3 PII 저장 + 퍼지 (L + 법무검토)
- **결정 A-2 확정 시에만.** `photo_shipment_pii`(AES-256-GCM) + **무조건 실행** purge cron(file-retention 패턴, admin토글 비종속) + 복호화 `@Roles` 게이팅 + user_site_roles 테넌트 스코핑 + 접근감사 + 배송라벨/carrier 연동 + PIPA 고지·동의·위탁 일괄.

### P2 색관리(조건부)
- 특정 랩이 CMYK press 프로파일 요구 시에만: Sharp `.toColourspace('cmyk')`+press ICC 또는 GS `-sColorConversionStrategy=CMYK -sOutputICCProfile`. `detectCmykUsage` read-only 검증.

---

## 7. 구현 티켓용 — 알려진 함정 체크리스트
- [ ] `findOneExternal`(IDOR) 복제 금지 → `findOneScoped(id, siteId)` 신규 + 교차테넌트 404 테스트.
- [ ] fan-out enqueue는 **머지된 옵션** 전달(`worker-jobs.service.ts:257` 버그 비상속) + `enqueued==persisted` 단언.
- [ ] 멱등 인덱스는 **신규** `(site_id, idempotency_key)` partial-unique (기존 `(sessionId,pdfFileId,requestId)` 재사용 불가).
- [ ] `detectImageResolutionFromPdf` 정규식 추정 **재사용 금지** → Sharp 실픽셀 dims.
- [ ] 무테 블리드는 `addBleedToPdf`(안쪽 밀기) 아님 → **오버사이즈 페이지 직접배치**.
- [ ] `ValidationError.fixMethod`(닫힌 union)·`ErrorCode`/`WarningCode`·`FileType.PHOTO` 멤버 추가는 reuse 아닌 **편집**.
- [ ] `sharp({limitInputPixels})` + 보수적 `@Process` concurrency를 **Sharp 도입 PR에 동반**.
- [ ] `WEBHOOK_ALLOWED_HOSTS='*'` prod 미설정 유지(allowlist 무력화 방지).
- [ ] 사진 파일 site_id **NOT NULL** + 사진 access-check NULL-vs-set 거부.
- [ ] inch→mm 변환 enqueue 시 **단 1회**, 잡 페이로드 mm-only 단언, 사이즈별 골든 트림 테스트.
- [ ] `PATCH /confirm`·`/cancel` 멱등(재호출 200 no-op).

## 8. 리스크 등록부 (요약)
| 심각도 | 리스크 | 완화 |
|---|---|---|
| High | nginx /storage 개인사진 무인증 노출 | 사진 raw URL 차단 + 인증프록시/서명URL (P0) |
| High | NULL-siteId / GET-PATCH IDOR | NOT NULL + findOneScoped + 교차테넌트 테스트 (P0/P1) |
| High | PII가 PUBLIC 레포 위 | A-1/Opt-2(미저장) 기본, Opt-3는 결정·법무 후 (P0 게이트) |
| High | 위조가능 웹훅에 주문확정 | 폴링 우선 + HMAC/replay 후행 (P1/P3) |
| High | HEIC 디코드 부재(iPhone) | P0 실증 → libheif 추가 or 앱 JPEG 변환 계약 |
| High | 대형 래스터 vs 3큐·GS=2 | 사진 큐 격리 + 픽셀상한 + 동시성/타임아웃 재산정 (P1/P2) |
| Med | 큐 머지버그 상속 | 머지옵션 enqueue + 단언 |
| Med | aspect 크롭 분쟁 | 앱 크롭좌표 우선, 미제공 시 center-crop+경고 |
| Med | 부분실패 확정 모호 | 아이템 단위 confirmable |
| Med | PII 파기 cron 침묵실패 | 무조건 실행 + 접근감사 (Opt-3) |

## 9. 오너 결정 요청 (요약)
1. **이행경계** — A-1(검증·변환·확인까지, 이행 외부) [권장] vs A-2(papas 직접 인쇄·발송).
2. **PII 모델** — Opt-2(토큰화·미저장) [권장, A-1과 짝] vs Opt-3(암호화 단기보관, A-2 시).
3. **확정 트리거** — C-1(앱이 /confirm) [권장] vs C-2(자동).
4. **HEIC** — 앱이 JPEG 변환 [권장, 인프라 무변경] vs 워커에 libheif 추가.
5. **색** — v1 sRGB RGB [권장] vs 초기부터 CMYK 강제.
6. **MVP 신호** — 폴링 전용 [권장] vs 웹훅 동반(HMAC 선결).

→ 1·2번이 척추(스키마 동결 조건). 나머지는 P1 진행과 병행 가능.

## 10. 비고
- 본 계획은 코드 ground-truth 실증 + 3-렌즈 적대검증을 거쳤으나, **§3 결정 전까지 shipping/PII 스키마는 미착수**가 원칙.
- 연관 정본: 멀티테넌시 설계(`.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md`), PDF 검증 핸드오프(`.cursor/plans/BOOKMOA_MOBILE_PDF_VALIDATION_HANDOFF_2026-06-16.md`).
