# Printable Editor Shopify 플랫폼 연동 가이드

> 작성일: 2026-07-09  
> 대상: Storige/Printable Editor 개발팀, Shopify 앱 운영자, 앱스토어 검수 대응 담당자  
> 상태: 최종 설계본. 구현 전 계약 확정 및 QA 체크리스트로 사용  
> 산출물: 이 Markdown 문서 + `PLATFORM_INTEGRATION_GUIDE.html` 시각화 문서

이 문서는 기존 `SHOPIFY_APP_PROPOSAL_2026-05-16.md`와 `SHOPIFY_TECHNICAL_DESIGN.md`의 조사 결과를 2026-07-09 기준 Shopify 공식 문서와 대조해 최종 연동안으로 정리한 것이다. 목표는 Shopify App Store에 `Printable Editor` 앱을 공개 배포하고, 판매자가 자신의 Shopify Admin 안에서 Storige 편집기 설정, 주문상품별 디자인 확인, 합성 PDF 다운로드, 실패 재처리를 할 수 있게 만드는 것이다.

---

## 0. 최종 결론

| 항목 | 결정 |
|---|---|
| 앱 브랜드 | `Printable Editor` |
| 배포 방식 | Shopify App Store 공개 앱 |
| 플랫폼 유형 | 기존 플랫폼 가이드의 유형 3을 `Shopify Public App Track`으로 승격 |
| 고객 편집 위치 | 상품 상세 페이지 Theme App Extension + App Proxy 세션 발급 + Storige Editor 임베드 |
| 판매자 운영 위치 | Shopify Admin Embedded App + Order detail Admin surface |
| 주문 처리 트리거 | `ORDERS_PAID` webhook 수신 후 Storige 합성 잡 enqueue |
| 결과 확인 | Shopify Admin 안의 주문별 파일 패널, App Home 대시보드, App Proxy PDF 다운로드 |
| 과금 | Shopify App Pricing 우선. Free 20건/월 + 사용량 meter + Pro 정액 |
| API 원칙 | 신규 공개 앱은 GraphQL Admin API 기준. REST Admin API 신규 사용 금지 |
| 검수 원칙 | OAuth 즉시 인증, 최신 App Bridge/session token, mandatory privacy webhooks, HMAC/idempotency, 최소 scope |

기존 제안서의 GO 결정은 유지한다. 다만 2026년 현재 문서 기준으로 아래 항목은 반드시 수정해야 한다.

1. `RecurringApplicationCharge` 중심 설계는 legacy로 보고, 기본안은 Shopify App Pricing + App Events API로 바꾼다.
2. 신규 공개 앱은 GraphQL Admin API만 사용한다. REST Admin API는 설계에서 제외한다.
3. `compose-mixed` 공개 호출 갭은 Shopify 출시 전 반드시 닫는다. Shopify 주문 합성 트리거는 인증된 서버 어댑터만 호출해야 한다.
4. iframe `frame-ancestors`를 정적 `vercel.json`에 누적하는 방식은 공개 앱에 부적합하다. App Proxy wrapper 또는 동적 CSP 발급 endpoint로 교체한다.

---

## 1. 공식 문서 확인 요약

### 1.1 Shopify API/앱 개발 원칙

Shopify API는 인증, 권한 scope, rate limit, API versioning 전제를 가진다. 앱이 Shopify 데이터와 동기화한다면 Shopify Admin, 앱 내부 DB, 외부 의존 시스템 사이의 데이터가 일관되어야 한다. App Store 요구사항은 계속 변경될 수 있으므로 출시 후에도 품질 점검 대상이다.

핵심 반영:
- OAuth로 offline access token을 발급받고 암호화 저장한다.
- 판매자 Admin iframe 앱은 session token 기반 인증을 사용한다.
- Shopify Admin API 호출은 GraphQL Admin API `2026-07 latest` 버전을 기준으로 한다.
- GraphQL 쿼리는 cost bucket, 단일 query 1,000 point 제한, input array 250개 제한을 고려한다.
- 대량 reconciliation은 단일 query 반복 대신 Bulk operations를 검토한다.

### 1.2 Shopify CLI 및 앱 골격

Shopify CLI는 앱, theme, storefront 개발 및 배포를 보조한다. 현재 공식 요구사항은 Node.js 22.12 이상, Git 2.28 이상이다. 앱 초기화는 CLI의 React Router starter를 기준으로 진행한다.

권장 명령:

```bash
npm install -g @shopify/cli@latest
shopify app init
shopify app dev
shopify app deploy
```

기존 설계의 `Remix + @shopify/shopify-app-remix` 표현은 `Shopify CLI React Router template` 중심으로 갱신한다. 내부 라우팅 개념은 유사하지만 문서와 의존성은 최신 템플릿을 따른다.

### 1.3 App Store 요구사항

출시 전 반드시 반영할 요구사항:

| 요구사항 | Printable Editor 반영 |
|---|---|
| Shopify platform 안에서 동작 | 설치, 인증, Admin UI, Checkout은 모두 Shopify 흐름 사용 |
| Shopify Checkout 사용 | 장바구니 line item property만 추가하고 결제는 Shopify Checkout에서 완료 |
| OAuth 즉시 수행 | 설치 후 UI 접근 전 OAuth 완료 |
| 최신 App Bridge | Admin embedded app 첫 script로 App Bridge 로드 |
| Session token | third-party cookie/localStorage 의존 금지 |
| GraphQL Admin API | 주문/상품 조회, webhook 등록, 상태 조회는 GraphQL 기반 |
| 최소 scope | v1은 `read_products`, `read_orders` 중심. 쓰기 scope는 명확한 기능이 생길 때만 추가 |
| Billing | App Store 공개 앱은 Shopify 제공 billing solution 사용 |
| 정확한 listing | 통계/보장/최고 표현 금지, 실제 UI screenshot, 영어 screencast 및 test credentials 제공 |
| Online Store requirement | 상품 페이지 앱 블록이 핵심이므로 listing에서 Online Store 필요 조건 표시 |
| Mandatory privacy webhooks | `customers/data_request`, `customers/redact`, `shop/redact` 구현 및 HMAC 검증 |

### 1.4 Built for Shopify 준비

Built for Shopify는 최초 출시 조건이 아니라 성장 후 취득 목표다. 최소 설치/리뷰 조건이 필요하며, 성능 기준도 준비해야 한다.

준비 기준:
- Admin Web Vitals: LCP 2.5s 이하, CLS 0.1 이하, INP 200ms 이하 목표.
- Storefront 성능: 앱이 Lighthouse performance score를 10점 초과로 낮추지 않게 lazy load.
- Checkout 속도: v1은 Checkout extension을 쓰지 않으므로 영향 없음.
- 접근성: Polaris/App Bridge 기본 패턴 사용, keyboard navigation, focus trap, aria label 검증.

---

## 2. 제품/시장 포지션

기존 제안서의 시장 판단을 유지한다.

| 항목 | 최종 정리 |
|---|---|
| 타깃 | 글로벌 + 한국 동시 |
| 차별점 | 일반 POD customizer가 약한 책자/포토북/명함 멀티페이지 편집 및 print-ready PDF 합성 |
| 재사용 자산 | Storige editor, worker, PDF 검증/합성, Site multi-tenancy, R2 파일 저장 |
| 신규 자산 | Shopify embedded app, theme app extension, app proxy adapter, webhook/billing/privacy module |
| 초기 가격 | Free 20 jobs/month + usage meter + Pro |

경쟁 구도는 Customily, Inkybay, Print.App 등 제품 개인화/인쇄 PDF 앱이 이미 시장을 검증했다. `Printable Editor`는 티셔츠/머그 중심 customizer가 아니라 책자, 포토북, 명함, 스프레드 합성, spine 계산, PDF preflight에 초점을 둔다.

---

## 3. 최종 아키텍처

### 3.1 구성 요소

| 계층 | 구성 | 역할 |
|---|---|---|
| Shopify Admin | `apps/shopify` embedded app | 온보딩, 상품 템플릿 매핑, 주문 파일 상태 확인, billing 상태 |
| Shopify Storefront | Theme App Extension app block | 상품 페이지 `Design` 버튼, iframe/app proxy wrapper 호출 |
| Shopify App Proxy | `/apps/printable-editor/*` | storefront 세션 발급, PDF 다운로드 proxy, 서명 검증 |
| Shopify Webhooks | `/shopify/webhooks` | 주문 paid, app uninstall, privacy compliance, billing/subscription 이벤트 |
| Storige API | `apps/api/src/shopify/*` | Shopify shop -> Site 자동 생성, order asset pipeline, API adapter |
| Storige Editor | `/embed` 또는 동적 wrapper | shopper 편집 UI, postMessage 완료 이벤트 |
| Storige Worker | PDF validation/synthesis | 주문 line item별 print-ready PDF 생성 |
| Storage | R2/files table | preview, source, output PDF 저장 |
| Observability | Sentry/Grafana/Loki | shop별 trace, job latency, billing event, webhook failure 추적 |

### 3.2 Shopify surfaces 선택

| Surface | v1 사용 여부 | 이유 |
|---|---:|---|
| App Home embedded app | 필수 | 판매자가 Shopify Admin 안에서 앱 설정 및 주문 파일을 확인 |
| Admin order detail surface | 필수 | 주문 상세에서 line item별 디자인/PDF 상태 확인 |
| Theme App Extension app block | 필수 | 쇼핑객이 상품 상세 페이지에서 편집기 진입 |
| App Proxy | 필수 | storefront signed session, PDF download, wrapper page 제공 |
| Checkout extension | 제외 | v1은 Shopify Checkout을 수정하지 않음. 검수/성능 리스크 축소 |
| Customer account extension | v2 | 고객이 주문 후 디자인 파일을 다시 볼 때 확장 가능 |
| Flow extension | v2 | `PDF ready -> Slack/Email/fulfillment` 자동화 확장 |
| Fulfillment service app | v2 또는 별도 | v1은 파일 생성 앱이며 배송/이행 대행 앱으로 등록하지 않음 |

---

## 4. 데이터 모델

### 4.1 `shopify_shops`

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | bigint PK | 내부 ID |
| `shop_gid` | varchar | `gid://shopify/Shop/...` |
| `shop_domain` | varchar unique | `example.myshopify.com` |
| `primary_domain` | varchar nullable | custom storefront domain |
| `site_id` | int FK | Storige `sites.id` |
| `offline_access_token_enc` | text | Shopify OAuth offline token, AES-256-GCM 암호화 |
| `granted_scopes` | varchar | 실제 승인 scope snapshot |
| `locale` | varchar | shop locale |
| `currency` | varchar | billing/display 참고 |
| `pricing_plan_handle` | varchar | Shopify App Pricing plan handle |
| `billing_status` | enum | `free`, `usage`, `pro`, `frozen`, `cancelled`, `suspended` |
| `free_jobs_used` | int | 현재 billing cycle 무료 job 수 |
| `billing_cycle_start_at` | datetime | 내부 gate 기준 |
| `installed_at` | datetime | 설치 시각 |
| `uninstalled_at` | datetime nullable | app/uninstalled 수신 |
| `shop_redact_due_at` | datetime nullable | `shop/redact` 처리 기준 |
| `created_at` / `updated_at` | datetime | 감사 |

### 4.2 `shopify_product_bindings`

| 컬럼 | 설명 |
|---|---|
| `shopify_shop_id` | shop FK |
| `product_gid` | Shopify product GID |
| `variant_gid` | 특정 variant만 묶을 경우 사용 |
| `storige_template_set_id` | Storige template set |
| `product_type` | `book`, `photobook`, `business_card`, `poster`, `custom` |
| `binding_rules_json` | 옵션 -> 템플릿/규격 매핑 |
| `enabled` | 상품 페이지 버튼 표시 여부 |

상품 매핑은 Shopify product metafield에 쓰지 않고 v1에서는 앱 DB에 저장한다. 이렇게 하면 `write_products` scope 없이 `read_products`만으로 설정 가능하다. 판매자가 상품 목록을 불러와 템플릿을 연결하는 UI는 embedded app에서 제공한다.

### 4.3 `shopify_designs`

| 컬럼 | 설명 |
|---|---|
| `design_id` | 공개 가능한 짧은 ID |
| `edit_session_id` | Storige 편집 세션. 비밀값으로 취급 |
| `shopify_shop_id` | shop FK |
| `site_id` | Storige tenant |
| `product_gid` / `variant_gid` | 디자인이 연결된 상품 |
| `customer_gid` | 로그인 고객이면 저장. 게스트는 nullable |
| `member_seqno` | Storige 내부 정수 회원번호 |
| `preview_file_id` | preview image |
| `status` | `editing`, `carted`, `ordered`, `queued`, `ready`, `failed`, `cancelled` |
| `expires_at` | abandoned cart cleanup 기준 |

### 4.4 `shopify_order_assets`

| 컬럼 | 설명 |
|---|---|
| `order_gid` | Shopify order GID |
| `order_name` | `#1001` 같은 표시명 |
| `line_item_gid` | Shopify line item GID |
| `design_id` | `shopify_designs.design_id` |
| `worker_job_id` | Storige worker job |
| `output_file_id` | 합성 PDF file ID |
| `status` | `needs_design`, `queued`, `rendering`, `ready`, `failed`, `cancelled`, `refunded`, `expired` |
| `failure_code` / `failure_message` | 운영자 표시용 |
| `last_synced_at` | Shopify order reconciliation 시각 |

### 4.5 `shopify_webhook_deliveries`

`X-Shopify-Webhook-Id`를 저장해 중복 수신을 무시한다. 같은 merchant event를 묶어 추적하려면 `X-Shopify-Event-Id`도 저장한다.

---

## 5. 설치/OAuth/온보딩 흐름

### 5.1 설치 순서

1. 판매자가 Shopify App Store에서 `Printable Editor` 설치를 시작한다.
2. 앱은 수동 `myshopify.com` 입력을 요구하지 않고 Shopify가 전달한 install context로 OAuth를 시작한다.
3. 판매자가 권한을 승인한다.
4. 앱 backend가 offline access token을 수신하고 암호화 저장한다.
5. `shopify_shops`와 Storige `sites` row를 같은 transaction에서 생성한다.
6. mandatory compliance webhooks 및 앱 이벤트/webhook 설정이 배포 config와 일치하는지 검증한다.
7. Admin App Home으로 redirect한다.
8. 판매자는 pricing plan 선택, 상품 템플릿 매핑, theme app block 추가를 진행한다.

### 5.2 Site 자동 생성

Shopify shop 1개는 Storige Site 1개로 매핑한다.

```ts
createForShopify(shop) {
  transaction(() => {
    site = createSite({
      name: `[Shopify] ${shop.name}`,
      domain: `https://${shop.shop_domain}`,
      provenance: 'shopify',
      status: 'active',
      defaultLocale: shop.locale,
      editorAuthCode: generateSecureCode(),
      workerAuthCode: generateSecureCode()
    });

    createShopifyShop({
      shopDomain: shop.shop_domain,
      shopGid: shop.shop_gid,
      siteId: site.id,
      offlineAccessTokenEnc: encrypt(shop.offline_access_token),
      grantedScopes: shop.scopes,
      billingStatus: 'free'
    });
  });
}
```

### 5.3 Scope 정책

v1 필수 scope:

| Scope | 필요성 |
|---|---|
| `read_products` | 판매자 Admin에서 상품 목록을 불러와 Storige template set과 연결 |
| `read_orders` | `ORDERS_PAID` webhook 처리 후 주문 line item과 design property 확인 |

v1에서 제외:

| Scope | 제외 이유 |
|---|---|
| `read_all_orders` | 60일 초과 과거 주문 조회가 핵심 기능이 아님. 검수 부담 증가 |
| `write_orders` | 주문 tag/metafield 쓰기는 v1 필수 아님. 상태는 앱 DB와 Admin block으로 표시 |
| `write_products` | 상품 매핑을 앱 DB에 저장하면 제품 수정 scope가 필요 없음 |
| `write_checkout_extensions_apis` | Checkout extension 미사용 |
| fulfillment 관련 write scope | v1은 fulfillment service가 아니라 파일 생성/검수 앱 |

v1.1에서 Shopify order metafield나 tag를 쓰기로 결정하면 `write_orders`를 optional scope로 분리하고, listing 및 검수 설명에 기능 근거를 첨부한다.

---

## 6. 상품 페이지 편집기 진입 흐름

### 6.1 Theme App Extension

Theme App Extension은 상품 상세 페이지에 `Design with Printable Editor` 버튼을 추가한다.

권장 파일 구조:

```text
extensions/printable-editor-block/
  blocks/designer-button.liquid
  assets/designer-button.js
  assets/designer-button.css
  locales/en.default.json
  locales/ko.json
  shopify.extension.toml
```

판매자 onboarding UI는 theme editor deep link를 제공한다. deep link는 product template의 app block 지원 section에 한 번에 block을 추가하도록 돕는다.

### 6.2 App Proxy session endpoint

Storefront에는 App Bridge가 없으므로 App Proxy를 통해 storefront 세션을 발급한다.

Endpoint:

```text
GET /apps/printable-editor/session?product_gid=...&variant_gid=...
```

Shopify가 우리 backend로 proxy할 때 `shop`, `path_prefix`, `timestamp`, `logged_in_customer_id`, `signature` query를 붙인다. 우리 backend는 다음을 수행한다.

1. App Proxy signature를 hex HMAC-SHA256으로 검증한다.
2. timestamp replay window를 검증한다.
3. `shop`이 설치된 shop인지 확인한다.
4. `logged_in_customer_id`가 있으면 Shopify customer GID -> Storige `member_seqno` 매핑을 찾거나 생성한다.
5. 비회원이면 shop + browser nonce 기반 anonymous member row를 생성하되 `0` 또는 음수 member number를 쓰지 않는다.
6. `shopify_product_bindings`에서 product/variant에 연결된 template set을 확인한다.
7. Storige `shop-session`을 server-to-server로 발급한다.
8. 짧은 수명 one-time `embed_token`을 반환한다.

응답 예:

```json
{
  "embedUrl": "/apps/printable-editor/editor?embed_token=pet_...",
  "expiresIn": 300
}
```

### 6.3 iframe 전략

기존 제안서의 직접 iframe 방식:

```text
https://editor.papascompany.co.kr/?shopifyShop=...&productId=...&jwt=...
```

이 방식은 공개 앱에서 두 가지 문제가 있다.

1. 모든 판매자 custom domain을 `frame-ancestors`에 정적으로 넣을 수 없다.
2. JWT가 URL/query/referrer/log에 노출될 수 있다.

v1 권장 방식:

```text
상품 페이지 JS
  -> /apps/printable-editor/session
  -> /apps/printable-editor/editor?embed_token=...
  -> App Proxy wrapper가 Storige editor assets를 로드
```

대안:
- `shopify.papascompany.co.kr/embed/:token` endpoint를 만들어 shop별 동적 CSP `frame-ancestors`를 발급한다.
- 기존 `editor.papascompany.co.kr` 정적 Vercel 배포는 공개 Shopify iframe entrypoint로 사용하지 않는다.

### 6.4 편집 완료 postMessage 계약

Editor는 완료 시 부모 창으로 다음 envelope를 보낸다.

```json
{
  "source": "storige-editor",
  "type": "editor.complete",
  "version": 1,
  "payload": {
    "designId": "pe_dsg_...",
    "editSessionId": "uuid",
    "previewUrl": "https://...",
    "productGid": "gid://shopify/Product/...",
    "variantGid": "gid://shopify/ProductVariant/..."
  }
}
```

Storefront JS 수신 조건:
- `event.origin`이 App Proxy wrapper 또는 승인된 editor origin인지 확인.
- `data.source === "storige-editor"` 확인.
- `type === "editor.complete"`만 처리.
- `editSessionId`는 cart에 직접 노출하지 않고 App Proxy에 `designId`를 등록한다.

### 6.5 Cart line item property

장바구니에는 비밀값이 아닌 조회 키만 넣는다.

```json
{
  "id": "<variant_id>",
  "quantity": 1,
  "properties": {
    "_printable_design_id": "pe_dsg_abc123",
    "Design Preview": "https://merchant-domain/apps/printable-editor/preview/pe_dsg_abc123"
  }
}
```

원칙:
- `_printable_design_id`만 주문 webhook에서 신뢰 가능한 lookup key로 사용한다.
- `editSessionId`, API key, JWT, worker token은 cart/order property에 저장하지 않는다.
- 상품에 여러 디자인이 필요한 경우 `designId`를 line item마다 분리한다.

---

## 7. 주문상품 연동 흐름

### 7.1 정상 주문 라이프사이클

1. 쇼핑객이 상품 페이지에서 디자인을 완료한다.
2. App Proxy가 `shopify_designs`에 `designId -> editSessionId -> product/variant/template` 매핑을 저장한다.
3. Storefront JS가 cart에 `_printable_design_id`를 붙인다.
4. 쇼핑객은 Shopify Checkout에서 결제한다.
5. Shopify가 `ORDERS_PAID` webhook을 보낸다.
6. 우리 webhook endpoint가 HMAC과 idempotency를 검증하고 즉시 queue에 넣은 뒤 200으로 응답한다.
7. worker consumer가 GraphQL Admin API로 주문 line items를 조회한다.
8. line item property에서 `_printable_design_id`를 찾는다.
9. 각 designId를 `shopify_designs`와 대조한다.
10. product/variant binding 및 template set을 다시 확인한다.
11. authenticated Storige adapter가 합성 job을 생성한다.
12. worker가 PDF를 합성하고 output file을 R2/files table에 저장한다.
13. `shopify_order_assets` status가 `ready`로 바뀐다.
14. 판매자는 Shopify Admin 주문 상세에서 preview, job status, output PDF를 확인한다.

### 7.2 Webhook 처리 원칙

| 원칙 | 구현 |
|---|---|
| HMAC 검증 | raw request body + app client secret + `X-Shopify-Hmac-SHA256` base64 비교 |
| 중복 방지 | `X-Shopify-Webhook-Id` persistent 저장 후 이미 있으면 skip |
| 빠른 응답 | 검증과 enqueue만 하고 200 응답. PDF 생성은 async worker |
| timeout 대응 | Shopify는 짧은 timeout과 retry를 사용하므로 5초 내 응답 목표 |
| retry 안전성 | 같은 order/line/design 조합은 unique key로 idempotent job 생성 |
| reconciliation | webhook 누락 대비 주기적으로 최근 paid order를 GraphQL로 대조 |

### 7.3 Order topic

v1 필수:

| Topic | 용도 |
|---|---|
| `ORDERS_PAID` | 결제 완료 후 PDF 합성 시작 |
| `APP_UNINSTALLED` | shop/site suspend 및 token 폐기 |
| `CUSTOMERS_DATA_REQUEST` | mandatory privacy |
| `CUSTOMERS_REDACT` | mandatory privacy |
| `SHOP_REDACT` | mandatory privacy |

v1.1 권장:

| Topic | 용도 |
|---|---|
| `ORDERS_CANCELLED` | 아직 합성 전이면 cancel, 합성 완료면 운영자에게 폐기/보류 표시 |
| `ORDERS_EDITED` | line item 변경 시 design mapping 재검증 |
| `REFUNDS_CREATE` | 환불 line item 상태 표시 |
| `APP_SUBSCRIPTIONS_APPROACHING_CAPPED_AMOUNT` | 사용량 cap 근접 알림 |
| `APP_SUBSCRIPTIONS_UPDATE` | plan 변경 상태 동기화 |

### 7.4 주문 line item 상태

| 상태 | 의미 | 운영자 액션 |
|---|---|---|
| `needs_design` | 주문 line에 designId가 없음 | 고객/주문 확인, 수동 업로드 또는 보류 |
| `queued` | webhook 수신 후 job enqueue | 대기 |
| `rendering` | worker 처리 중 | 로그 보기 |
| `ready` | output PDF 생성 완료 | preview/PDF 다운로드 |
| `failed` | 검증/합성 실패 | 실패 원인 확인, retry, 고객 재편집 요청 |
| `cancelled` | 주문 취소 또는 line item 제거 | 생산 중지 |
| `refunded` | 환불 처리됨 | 생산/출고 정책에 따라 보류 |
| `expired` | 원본 asset 보존기간 만료 | 재편집 또는 고객 문의 |

### 7.5 예외 케이스

| 케이스 | 처리 |
|---|---|
| cart property 누락 | `needs_design`으로 표시하고 자동 합성 금지 |
| designId가 다른 shop 소유 | 404처럼 은닉하고 보안 이벤트 기록 |
| product binding 삭제 후 주문 | 주문 당시 snapshot이 있으면 snapshot 기준 처리. 없으면 `failed: BINDING_NOT_FOUND` |
| 중복 webhook | 저장된 webhook ID면 200만 반환 |
| 주문 일부만 디자인 상품 | 디자인 상품 line item만 asset row 생성 |
| 여러 배송 방식 | order 단위 가정 금지. line item/fulfillment order 기준으로 상태 관리 |
| 결제 대기 주문 | `ORDERS_PAID` 전에는 합성하지 않음. 단 merchant 설정으로 `orders/create` preflight만 가능 |
| app uninstall | 새 job 생성 금지, 기존 ready 파일은 retention 정책에 따라 제한 제공 |

---

## 8. Shopify Admin 운영자 경험

### 8.1 App Home

판매자가 앱을 열면 다음을 본다.

| 영역 | 내용 |
|---|---|
| Onboarding | billing plan, product binding, theme block 설치 상태 |
| Usage | 이번 cycle 무료/유료 job 수, usage meter event 상태 |
| Orders | 최근 주문 asset 상태, 실패/보류/ready 필터 |
| Products | Shopify product -> Storige template set 매핑 |
| Diagnostics | webhook delivery, app proxy signature failure, worker failure |
| Settings | locale, retention, default product policy, notification |

### 8.2 Order detail panel

주문 상세 페이지에 `Printable Editor files` 패널을 제공한다.

표시 항목:
- 주문번호, line item명, variant, 수량
- design preview thumbnail
- status badge
- worker job id
- 합성 완료 시간
- PDF size/page count/preflight result
- `Download PDF`
- `Retry synthesis`
- `Open design`
- `Copy production link`

v1은 Shopify order에 직접 tag/metafield를 쓰지 않고, Admin block이 앱 backend에서 상태를 읽는다. 이렇게 하면 `write_orders` 없이도 운영자 확인이 가능하다.

### 8.3 PDF 다운로드

운영자 download는 embedded Admin app에서 session token을 검증한 뒤 backend가 파일을 stream한다.

Storefront/customer-facing download가 필요하면 App Proxy route를 쓴다.

```text
GET /apps/printable-editor/orders/{order_id}/line-items/{line_item_id}/pdf
```

검증:
1. App Proxy signature 확인.
2. shop 설치 상태 확인.
3. 요청 order/line item이 해당 shop 소유인지 확인.
4. `output_file_id`가 `ready`인지 확인.
5. R2/files stream 반환.

App Proxy는 cookie를 지원하지 않으므로 모든 인증/인가를 signed query, one-time token, backend DB 대조로 처리한다.

---

## 9. Billing/가격 모델

### 9.1 최종 가격 구조

| Plan | 가격 | 포함 |
|---|---:|---|
| Free | $0 | 월 20 synthesis jobs |
| Usage | $0 + 사용량 | 21건째부터 job당 $0.50, 월 cap $99 |
| Pro | $29/month | 앱 내 정책상 월 무제한 또는 높은 fair-use cap |

### 9.2 2026 기준 구현 우선순위

1순위: Shopify App Pricing
- App submission/pricing form에서 Free, Usage, Pro plan을 정의한다.
- Shopify가 plan selection page, recurring charge, usage-based pricing, trial/proration을 처리한다.
- 사용량은 App Events API billing event로 전송한다.
- 현재 plan 상태는 Partner API `activeSubscription` 기준으로 확인한다.

2순위: Manual pricing legacy fallback
- Shopify App Pricing으로 원하는 구조를 구성할 수 없을 때만 검토한다.
- 이 경우에도 REST `RecurringApplicationCharge`가 아니라 GraphQL Billing API를 사용한다.
- 신규 공개 앱의 기본안으로 채택하지 않는다.

### 9.3 Usage billing event

합성 job이 성공적으로 `ready`가 된 뒤에만 billing event를 보낸다.

```json
{
  "shop_id": "gid://shopify/Shop/23423423",
  "event_handle": "print_synthesis_job",
  "timestamp": "2026-07-09T12:00:00Z",
  "idempotency_key": "job_123456_bill_v1",
  "attributes": {
    "value": 1
  }
}
```

주의:
- App Events payload에 고객 이름, 이메일, 전화, 주문번호처럼 개인 식별 가능한 값을 넣지 않는다.
- idempotency key는 billing event에 대해 영구 중복 방지 키로 취급한다.
- App Events API의 billing validation 오류는 비동기 로그로 확인해야 하므로 Dev Dashboard 로그 모니터링을 운영 항목에 넣는다.

### 9.4 내부 gate

job enqueue 전에 다음을 확인한다.

| 조건 | 처리 |
|---|---|
| plan active | 계속 |
| Free 20건 이하 | 계속 |
| Usage/Pro active | 계속 |
| cap 근접 | Admin 알림 + email/slack optional |
| cap 초과/frozen/cancelled | job 생성 차단, 운영자 UI에 billing action 표시 |

---

## 10. 보안/컴플라이언스

### 10.1 HMAC 구분

| 구분 | 입력 | digest | 용도 |
|---|---|---|---|
| Shopify webhook | raw request body | base64 HMAC-SHA256 | `X-Shopify-Hmac-SHA256` |
| Shopify app proxy | sorted query string | hex HMAC-SHA256 | `signature` query |
| Storige internal webhook | event payload | HMAC-SHA256으로 보강 필요 | worker/job callback |

기존 플랫폼 문서의 `X-Storige-Signature = base64(jobId:event:timestamp)` 방식은 위조 방어가 되지 않는다. Shopify public app 출시 전 `WEBHOOK_SECRET` 기반 HMAC으로 교체하거나, Shopify 주문 pipeline에서는 내부 callback을 신뢰하지 않고 DB/job status를 재조회한다.

### 10.2 Session token

Admin embedded app:
- App Bridge에서 매 request마다 session token을 발급받는다.
- session token 수명은 짧으므로 backend request마다 fresh token 사용.
- session token은 Shopify API access token 대체물이 아니다. Shopify API 호출은 backend에 저장한 OAuth offline token으로 수행한다.

Storefront:
- App Bridge session token을 쓸 수 없으므로 App Proxy signature + one-time embed token으로 세션을 만든다.

### 10.3 Mandatory privacy webhooks

모든 public app은 다음 privacy webhook을 구현해야 한다.

| Topic | 처리 |
|---|---|
| `customers/data_request` | 해당 customer/order에 연결된 design/order asset export 준비 및 merchant에게 제공 |
| `customers/redact` | 법적 보존 필요가 없는 customer mapping, design metadata, preview personal data 삭제/익명화 |
| `shop/redact` | uninstall 후 Shopify가 보낸 shop 삭제 요청에 따라 shop data 삭제/익명화 |

요구사항:
- JSON body와 `Content-Type: application/json` 처리.
- invalid HMAC이면 401 반환.
- 정상 수신 시 200대 응답.
- action은 수신 후 30일 내 완료.
- `shop/redact`는 app uninstall 후 48시간 뒤 들어올 수 있으므로 uninstall과 redact를 분리해서 처리한다.

### 10.4 Token/secret 저장

| Secret | 저장 위치 | 원칙 |
|---|---|---|
| `SHOPIFY_API_SECRET` | server env | HMAC/OAuth 검증 |
| `SHOPIFY_TOKEN_ENCRYPTION_KEY` | server env | offline token encryption |
| Shopify offline token | DB encrypted | 복호화는 API 호출 직전 |
| Storige site API key | DB 또는 secret vault | 브라우저 노출 금지 |
| embed token | short-lived DB/cache | one-time, 5분 이하 |

---

## 11. 구현 단계

### Phase 1. Shopify 앱 골격

- Shopify CLI 설치 및 version 고정.
- React Router starter로 app scaffold.
- `shopify.app.toml`에 app name, scopes, app proxy, mandatory webhooks 설정.
- App Bridge/session token 검증 middleware 구성.
- Dev store 설치 테스트.

예상: 2-3일

### Phase 2. OAuth/Site 자동 등록

- OAuth callback 처리.
- `shopify_shops`, `shopify_product_bindings`, `shopify_designs`, `shopify_order_assets`, `shopify_webhook_deliveries` migration.
- Storige `sites.provenance='shopify'` 추가.
- token encryption.
- uninstall/suspend 처리.

예상: 3-4일

### Phase 3. Product binding/Admin UI

- Product list GraphQL query.
- Storige template set selector.
- product/variant별 binding 저장.
- theme app block 설치 deep link.
- onboarding checklist.

예상: 3-4일

### Phase 4. Storefront editor integration

- Theme App Extension block.
- App Proxy session endpoint.
- App Proxy editor wrapper 또는 동적 CSP endpoint.
- postMessage envelope 갱신.
- cart line item property 추가.
- guest/customer member mapping.

예상: 4-6일

### Phase 5. Order pipeline

- `ORDERS_PAID` webhook HMAC/idempotency.
- GraphQL order line item fetch.
- design lookup 및 product binding validation.
- authenticated Storige synthesis adapter.
- worker status sync.
- retry/reconciliation job.

예상: 5-7일

### Phase 6. Operator UI

- App Home order asset dashboard.
- Order detail panel/Admin surface.
- PDF download/preview/retry.
- failure reason and runbook links.

예상: 4-5일

### Phase 7. Billing

- Shopify App Pricing plan 설정.
- plan selection redirect/welcome link.
- Partner API active subscription sync.
- App Events usage billing.
- free/usage/pro internal gate.
- cap warning and frozen state handling.

예상: 4-6일

### Phase 8. Compliance/QA/App Store submission

- privacy webhooks 검증.
- scope justification 문서.
- Lighthouse/Admin Web Vitals 점검.
- i18n en/ko 완료.
- demo screencast 영어 또는 영어 자막.
- test credentials.
- App listing assets.
- review submission and resubmission 대응.

예상: 개발 QA 1주 + Shopify review 2-4주

총 개발: 4-6주. 검수 포함 공개까지 6-9주를 현실 일정으로 둔다.

---

## 12. 사전 출시 체크리스트

### 12.1 기술

- [ ] Node.js 22.12+, Git 2.28+ 환경 확인.
- [ ] `shopify app dev`로 dev store 설치 성공.
- [ ] OAuth 직후 UI 진입.
- [ ] embedded app이 latest App Bridge/session token 기반으로 동작.
- [ ] GraphQL Admin API만 사용.
- [ ] REST Admin API 호출 없음.
- [ ] `read_products`, `read_orders` scope 근거 문서화.
- [ ] App Proxy signature 검증 test.
- [ ] Webhook HMAC raw body 검증 test.
- [ ] `X-Shopify-Webhook-Id` idempotency test.
- [ ] Mandatory privacy webhooks 3종 test.
- [ ] `compose-mixed` 공개 호출 제거 또는 Shopify adapter에서 접근 불가 처리.
- [ ] editor iframe CSP 공개 앱 대응 완료.
- [ ] cart에는 비밀값이 아닌 designId만 저장.
- [ ] 주문 line item별 ready/failed/retry 확인.
- [ ] billing event idempotency 확인.

### 12.2 운영

- [ ] Sentry tag: `shopify.shop`, `shopify.plan`, `site.provenance`.
- [ ] Grafana: webhook latency/failure, job queue, ready rate, failed reason, billing events.
- [ ] emergency developer contact 등록.
- [ ] uninstall/redact runbook.
- [ ] support email/page 준비.
- [ ] 개인정보 처리방침, DPA/보존정책 준비.

### 12.3 App Store listing

- [ ] 앱 이름이 Dashboard, App Home, listing에서 일관됨.
- [ ] 가격 정보는 pricing section에만 표시.
- [ ] screenshot은 실제 UI를 보여줌.
- [ ] "최고", "유일", 검증되지 않은 통계 표현 없음.
- [ ] Online Store 필요 조건 표시.
- [ ] 영어 App Details와 한국어 listing 번역 품질 확인.
- [ ] 영어 또는 영어 자막 screencast.
- [ ] 검수용 test shop/test account/test order 절차 문서화.

---

## 13. 환경 변수

```env
SHOPIFY_API_KEY=<client_id>
SHOPIFY_API_SECRET=<client_secret>
SHOPIFY_APP_URL=https://shopify.papascompany.co.kr
SHOPIFY_APP_PROXY_PREFIX=/apps/printable-editor
SHOPIFY_TOKEN_ENCRYPTION_KEY=<32-byte-base64>
SHOPIFY_APP_EVENTS_CLIENT_ID=<client_id>
SHOPIFY_APP_EVENTS_CLIENT_SECRET=<client_secret>
SHOPIFY_WEBHOOK_TOLERANCE_SECONDS=300
SHOPIFY_EMBED_TOKEN_TTL_SECONDS=300
STORIGE_API_BASE_URL=https://api.papascompany.co.kr/api
STORIGE_EDITOR_BASE_URL=https://editor.papascompany.co.kr
STORIGE_SHOPIFY_INTERNAL_KEY=<server-only>
```

---

## 14. 변경된 내부 계약

기존 `PLATFORM_INTEGRATION_GUIDE.md`의 유형 3 갭을 아래처럼 닫는다.

| 기존 갭 | 최종 결정 |
|---|---|
| Shopify 전용 Site 등록 미존재 | OAuth callback에서 자동 생성 |
| frame-ancestors 정적 정의 | App Proxy wrapper 또는 동적 CSP endpoint로 변경 |
| 외부 결과 전달 표준 흐름 미구현 | `shopify_order_assets` + Admin order panel + signed download |
| 회원번호 체계 미정 | Shopify customer GID -> 내부 정수 매핑, guest도 양수 sequence |
| compose-mixed 무인증 | Shopify adapter에서는 인증/테넌트 스코프 필수. 공개 endpoint 의존 금지 |
| 웹훅 서명 HMAC 아님 | Shopify pipeline은 Shopify HMAC + DB 재조회. Storige internal webhook은 HMAC 보강 |

---

## 15. 참조 문서

### Shopify 공식 문서, 2026-07-09 확인

- Shopify API 사용 개요: https://shopify.dev/docs/api/usage
- Shopify CLI: https://shopify.dev/docs/api/shopify-cli
- Build apps for Shopify: https://shopify.dev/docs/apps/build
- App Store requirements: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Built for Shopify requirements: https://shopify.dev/docs/apps/launch/built-for-shopify/requirements
- Revenue share: https://shopify.dev/docs/apps/launch/distribution/revenue-share
- Billing/App Pricing: https://shopify.dev/docs/apps/launch/billing
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
- App Events API: https://shopify.dev/docs/api/app-events/latest
- Theme App Extension configuration: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- App Proxy authentication: https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies
- Session tokens: https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens
- Verify webhook deliveries: https://shopify.dev/docs/apps/build/webhooks/verify-deliveries
- Privacy law compliance: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- GraphQL Admin API latest: https://shopify.dev/docs/api/admin-graphql/latest
- Webhook topics: https://shopify.dev/docs/api/admin-graphql/latest/enums/WebhookSubscriptionTopic
- Orders and fulfillment apps: https://shopify.dev/docs/apps/build/orders-fulfillment
- API rate limits: https://shopify.dev/docs/api/usage/limits#rate-limits

### Storige 내부 문서

- `SHOPIFY_APP_PROPOSAL_2026-05-16.md`
- `SHOPIFY_TECHNICAL_DESIGN.md`
- `PLATFORM_WORKER_INTEGRATION_v1.md`
- `PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`
- `WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md`

---

## 16. 최종 권고

Shopify 앱스토어 공개는 진행 가능하다. 다만 기존 "유형 3 제안"을 단순히 임베드 + 기존 external download로 조합하는 수준으로는 App Store 검수, 공개 앱 도메인, 과금, 개인정보 요구사항을 통과하기 어렵다. 최종 구현은 Shopify를 first-class channel로 취급해야 한다.

출시 성공 기준은 다음 네 가지다.

1. 판매자는 Shopify Admin을 떠나지 않고 상품 매핑, 주문 PDF, 실패 재처리를 확인한다.
2. 쇼핑객은 Shopify 상품 페이지와 Checkout 흐름 안에서 디자인 상품을 구매한다.
3. 우리 backend는 Shopify webhook/app proxy/session token/HMAC/billing 요구사항을 분리된 adapter로 처리한다.
4. Storige editor/worker의 강점은 유지하되, 공개 endpoint와 정적 iframe 정책 같은 내부 전제는 공개 앱 수준으로 보강한다.
