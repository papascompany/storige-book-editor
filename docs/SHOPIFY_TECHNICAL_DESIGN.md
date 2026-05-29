# Printable Editor (Storige) — Shopify 앱 기술 설계 (Phase S-2 ~ S-5)

> **상태**: 🚧 작성 중 (v0.1 스켈레톤, 2026-05-27)
> **선행 문서**: [`SHOPIFY_APP_PROPOSAL_2026-05-16.md`](./SHOPIFY_APP_PROPOSAL_2026-05-16.md) v1.1
> **목적**: Shopify 앱 코드를 작성하기 전, OAuth/Webhook/Billing/i18n/Theme Extension의 **정확한 인터페이스**와 **데이터 흐름**을 확정한다.

---

## 0. Scope

이 문서는 Phase S-2 ~ S-5 (임베디드 앱, 백엔드 통합, Theme Extension, Billing) 까지의 기술 설계를 다룬다. Phase S-1(Partner 가입), Phase S-6(BFS 인증), Phase S-7(검수)은 별도 운영 가이드로 분리.

대상 코드:
- 신규: `apps/shopify` (Remix + @shopify/shopify-app-remix)
- 신규: `apps/api/src/shopify/*` (OAuth callback, webhooks, app proxy)
- 신규: `extensions/printable-editor-block/` (Theme App Extension, Liquid + JS)
- 수정: `apps/api/src/sites/sites.service.ts` (Shopify shop → Site 자동 등록)
- 수정: `apps/editor` + `apps/admin` (react-i18next 도입, en/ko)

---

## 1. 신규 데이터 모델

### 1.1 `shopify_shops` 테이블 (신규)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | int PK auto | |
| `shop_domain` | varchar(255) unique | 예: `bestbooks.myshopify.com` |
| `site_id` | int FK → `sites.id` | Phase A 멀티사이트 모델 연결 (자동 생성) |
| `access_token` | text (encrypted) | Shopify Admin API offline token |
| `scopes` | varchar(500) | granted scopes (e.g. `write_products,read_orders`) |
| `installed_at` | datetime | |
| `uninstalled_at` | datetime nullable | `app/uninstalled` webhook 수신 시 |
| `gdpr_redact_due_at` | datetime nullable | `shop/redact` 수신 시 +48h |
| `billing_plan` | enum('free','usage','pro') | 현재 활성 플랜 |
| `recurring_charge_id` | bigint nullable | Shopify RecurringApplicationCharge ID |
| `usage_capped_amount_usd` | decimal(10,2) | 월 cap (기본 99.00) |
| `current_month_jobs` | int default 0 | 이번 달 합성 잡 카운트 |
| `current_month_billed_usd` | decimal(10,2) default 0 | 이번 달 청구 누적 |
| `locale` | varchar(10) default 'en' | shop primary locale |

### 1.2 `sites` 테이블 확장 (1컬럼 추가)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `provenance` | enum('manual','shopify','bookmoa') default 'manual' | 사이트 생성 출처 — Shopify 자동등록 추적용 |

---

## 2. OAuth 흐름 (Phase S-2)

### 2.1 시퀀스

```
[판매자]                    [Shopify]                  [apps/shopify]              [apps/api]
   │                            │                            │                          │
   │  앱 install 클릭            │                            │                          │
   ├───────────────────────────>│                            │                          │
   │                            │  redirect /auth?shop=xxx   │                          │
   │                            ├───────────────────────────>│                          │
   │                            │                            │  OAuth grant URL 빌드    │
   │                            │<───── redirect ────────────│                          │
   │  scopes consent             │                            │                          │
   ├───────────────────────────>│                            │                          │
   │                            │  /auth/callback?code=…     │                          │
   │                            ├───────────────────────────>│                          │
   │                            │                            │  Token Exchange           │
   │                            │<──── access_token ─────────│                          │
   │                            │                            │  POST /shopify/onboard   │
   │                            │                            ├─────────────────────────>│
   │                            │                            │                          │ SitesService.createForShopify(shop)
   │                            │                            │                          │   ├─ Site.insert({provenance:'shopify', name, domain})
   │                            │                            │                          │   ├─ editorAuthCode/workerAuthCode 자동 발급
   │                            │                            │                          │   └─ shopify_shops.insert({siteId, accessToken})
   │                            │                            │<─────── 201 ─────────────│
   │                            │                            │
   │                            │                            │  Webhooks 등록 (Admin API)
   │                            │                            │  - orders/paid
   │                            │                            │  - app/uninstalled
   │                            │                            │  - customers/data_request (mandatory)
   │                            │                            │  - customers/redact (mandatory)
   │                            │                            │  - shop/redact (mandatory)
   │                            │                            │
   │<───── redirect /admin/apps/printable-editor ────────────│
```

### 2.2 `SitesService.createForShopify(shop)` 의사코드

```typescript
async createForShopify(shop: {
  myshopifyDomain: string;   // bestbooks.myshopify.com
  name: string;
  primaryLocale: string;     // 'en' | 'ko' | ...
  accessToken: string;
  scopes: string;
}): Promise<{ site: Site; shopifyShop: ShopifyShop }> {
  return this.dataSource.transaction(async (m) => {
    // 1) Site 자동 생성 (Phase A 모델)
    const site = await m.save(Site, {
      name: `[Shopify] ${shop.name}`,
      domain: `https://${shop.myshopifyDomain}`,
      provenance: 'shopify',
      // Phase B: webhook host = shopify domain, app proxy 경유
      webhookHost: shop.myshopifyDomain,
      uploadCallbackUrl: `https://${shop.myshopifyDomain}/apps/printable-editor/webhook`,
      editorAuthCode: generateSecureCode(),
      workerAuthCode: generateSecureCode(),
      status: 'active',
      defaultLocale: shop.primaryLocale,
    });

    // 2) shopify_shops 매핑 저장 (access_token 암호화)
    const shopifyShop = await m.save(ShopifyShop, {
      shopDomain: shop.myshopifyDomain,
      siteId: site.id,
      accessToken: encrypt(shop.accessToken),
      scopes: shop.scopes,
      installedAt: new Date(),
      billingPlan: 'free',
      usageCappedAmountUsd: 99.0,
      locale: shop.primaryLocale,
    });

    // 3) 정책 캐시 invalidation
    await this.policyCache.invalidate(site.id);

    return { site, shopifyShop };
  });
}
```

### 2.3 보안

- `access_token` 은 envelope encryption (AES-256-GCM + KMS-style key). 키는 `~/storige/.env`의 `SHOPIFY_TOKEN_ENCRYPTION_KEY`
- App secret은 절대 클라이언트에 노출 금지 — `apps/shopify` 서버 사이드 only
- HMAC 검증 실패 시 401 + Sentry 알림

---

## 3. Webhook 라우팅 (Phase S-3)

### 3.1 엔드포인트

| 경로 | 메서드 | 핸들러 | 응답 |
|------|--------|--------|------|
| `POST /shopify/oauth/callback` | POST | OAuth completion | 302 redirect → Shopify admin |
| `POST /shopify/webhooks/orders/paid` | POST | 합성 잡 발사 | 200 즉시 (큐 enqueue 후) |
| `POST /shopify/webhooks/app/uninstalled` | POST | shop status='suspended' | 200 |
| `POST /shopify/webhooks/customers/data_request` | POST | GDPR DSR (조회 요청 기록) | 200 |
| `POST /shopify/webhooks/customers/redact` | POST | GDPR DSR (개인정보 삭제) | 200 |
| `POST /shopify/webhooks/shop/redact` | POST | shop 48h 후 완전 삭제 예약 | 200 |
| `GET /shopify/app-proxy/orders/:id/pdf` | GET | 결과 PDF 스트림 | 200 application/pdf |

### 3.2 HMAC-SHA256 검증 어댑터

```typescript
// apps/api/src/shopify/guards/shopify-hmac.guard.ts
@Injectable()
export class ShopifyHmacGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const hmacHeader = req.headers['x-shopify-hmac-sha256'] as string;
    if (!hmacHeader) throw new UnauthorizedException('missing HMAC');

    const rawBody = req.rawBody; // body-parser raw 활성화 필요
    const computed = crypto
      .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
      .update(rawBody)
      .digest('base64');

    if (!crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computed))) {
      throw new UnauthorizedException('invalid HMAC');
    }
    return true;
  }
}
```

> **주의**: 기존 `X-Storige-Signature` (Base64 sig, PLATFORM_WORKER_INTEGRATION_v1.md 참조)와 **다른 검증 모듈**. Shopify는 표준 HMAC-SHA256(base64), Storige 내부는 자체 포맷. 두 어댑터를 별도 가드로 격리.

### 3.3 App Proxy 인증 (`/apps/printable-editor/...`)

Shopify가 판매자 도메인 `/apps/printable-editor/*` 요청을 우리 서버로 프록시할 때 query string에 HMAC을 붙임. 검증 알고리즘:

```typescript
function verifyAppProxy(query: Record<string, string>): boolean {
  const { signature, ...rest } = query;
  const sortedKeys = Object.keys(rest).sort();
  const message = sortedKeys.map(k => `${k}=${rest[k]}`).join('');
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex'); // App Proxy는 hex (webhook은 base64 — 다름!)
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
}
```

---

## 4. Billing 상태머신 (Phase S-5)

### 4.1 상태 전이

```
                  ┌─────────┐
       install →  │  FREE   │  (0~20 jobs/month, $0)
                  └────┬────┘
                       │ 21번째 job 요청
                       ↓
                  ┌──────────┐
                  │  USAGE   │  ($0.50/job, cap $99/월)
                  └────┬─────┘
                       │ 사용자가 Pro 업그레이드 클릭
                       ↓
                  ┌─────────┐
                  │   PRO   │  ($29/월 무제한)
                  └────┬────┘
                       │ 다운그레이드 / 미결제
                       ↓
                  ┌────────────┐
                  │ SUSPENDED  │  (read-only, 30일 후 hard delete)
                  └────────────┘
```

### 4.2 합성 잡 전 사용량 게이트

```typescript
// apps/worker/src/services/usage-gate.service.ts
async assertCanProcess(shopDomain: string): Promise<void> {
  const shop = await this.shopifyShopsRepo.findOne({ shopDomain });
  if (shop.billingPlan === 'pro') return; // 무제한
  if (shop.billingPlan === 'free' && shop.currentMonthJobs < 20) return;

  if (shop.billingPlan === 'usage') {
    if (shop.currentMonthBilledUsd >= shop.usageCappedAmountUsd) {
      throw new BusinessException('USAGE_CAP_REACHED');
    }
    return;
  }

  // free → usage 전이 (자동)
  if (shop.billingPlan === 'free' && shop.currentMonthJobs >= 20) {
    if (!shop.recurringChargeId) {
      throw new BusinessException('USAGE_CHARGE_NOT_ACTIVATED');
      // 클라이언트는 /shopify/billing/activate 호출 유도
    }
    await this.shopifyShopsRepo.update(shop.id, { billingPlan: 'usage' });
    return;
  }
}

async chargeOneJob(shopDomain: string): Promise<void> {
  // Bull job complete 시 호출
  const shop = await this.shopifyShopsRepo.findOne({ shopDomain });
  await this.shopifyShopsRepo.increment({ id: shop.id }, 'currentMonthJobs', 1);

  if (shop.billingPlan === 'usage') {
    await this.shopifyAdminClient.usageChargeCreate({
      recurringChargeId: shop.recurringChargeId,
      price: 0.50,
      description: `Print synthesis job (${shop.currentMonthJobs + 1})`,
    });
    await this.shopifyShopsRepo.increment({ id: shop.id }, 'currentMonthBilledUsd', 0.5);

    // 80% 임계 알림
    if (shop.currentMonthBilledUsd >= shop.usageCappedAmountUsd * 0.8) {
      await this.notifyService.sendUsageWarning(shop);
    }
  }
}
```

### 4.3 월 카운터 리셋

- 매월 1일 00:00 UTC, cron job: `currentMonthJobs = 0`, `currentMonthBilledUsd = 0`
- Bull Repeatable Job (`shopify-billing-monthly-reset`)

---

## 5. Theme App Extension (Phase S-4)

### 5.1 디렉토리 구조

```
extensions/printable-editor-block/
├── blocks/
│   └── designer-button.liquid    # App Block (제품 페이지에 임베드)
├── assets/
│   ├── designer-button.js        # iframe modal 트리거
│   └── designer-button.css
├── locales/
│   ├── en.default.json
│   └── ko.json
└── shopify.extension.toml
```

### 5.2 `designer-button.liquid` (요약)

```liquid
{% comment %} Printable Editor — Design button {% endcomment %}
<div
  class="printable-editor-launch"
  data-product-id="{{ product.id }}"
  data-shop-domain="{{ shop.permanent_domain }}"
  data-locale="{{ shop.locale }}"
>
  <button type="button" id="printable-editor-btn">
    🎨 {{ 'designer.button_label' | t }}
  </button>
</div>

{{ 'designer-button.js' | asset_url | script_tag }}
{{ 'designer-button.css' | asset_url | stylesheet_tag }}

{% schema %}
{
  "name": "Printable Editor",
  "target": "section",
  "settings": [
    { "type": "text", "id": "button_label_override", "label": "Custom button label", "default": "" },
    { "type": "color", "id": "button_color", "label": "Button color", "default": "#4F46E5" }
  ]
}
{% endschema %}
```

### 5.3 JS (iframe 모달 + postMessage)

```javascript
// extensions/printable-editor-block/assets/designer-button.js
document.getElementById('printable-editor-btn').addEventListener('click', async () => {
  const container = document.querySelector('.printable-editor-launch');
  const { productId, shopDomain, locale } = container.dataset;

  // 1) JWT session token (App Bridge 없는 storefront이므로 App Proxy 경유 발급)
  const tokenRes = await fetch(`/apps/printable-editor/session-token?product_id=${productId}`);
  const { jwt } = await tokenRes.json();

  // 2) iframe 모달 오픈
  const modal = createModal();
  modal.iframe.src = `https://editor.papascompany.co.kr/?shopifyShop=${shopDomain}&productId=${productId}&jwt=${jwt}&lang=${locale}`;
  document.body.appendChild(modal.root);

  // 3) 편집기 완료 콜백 → cart line item property 첨부
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://editor.papascompany.co.kr') return;
    if (e.data.type === 'PRINTABLE_EDITOR_DONE') {
      const { designId, previewUrl } = e.data.payload;
      // Shopify cart API 직접 호출 또는 form submit
      fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: productId,
          quantity: 1,
          properties: {
            '_printable_design_id': designId,  // _ prefix → 고객 노출 X
            'Design Preview': previewUrl,
          },
        }),
      }).then(() => modal.close());
    }
  });
});
```

---

## 6. i18n 정책 (양쪽 시장 결정 #1, #4 반영)

### 6.1 라이브러리

- `apps/editor`, `apps/admin`: **react-i18next** (이미 표준)
- `apps/shopify` (Remix): **remix-i18next**
- Theme App Extension: Liquid `{{ '...' | t }}` + `locales/*.json`

### 6.2 locale 추출 우선순위

1. URL query `?lang=ko` (편집기 진입 시)
2. Shopify `shop.locale` (admin/storefront)
3. JWT claim `locale`
4. Browser `Accept-Language`
5. fallback `en`

### 6.3 키 구조 (예)

```jsonc
// apps/editor/src/locales/en.json
{
  "editor": {
    "tools": {
      "text": "Text",
      "image": "Image",
      "shape": "Shape"
    },
    "save": "Save",
    "preview": "Preview",
    "errors": {
      "uploadFailed": "Upload failed. Please try again."
    }
  }
}
```

### 6.4 영문 우선 작업

- 모든 신규 문자열은 `en.default.json` 부터 정의
- 한글 번역은 동일 commit에 포함 (절대 영문만 푸시 금지)
- Shopify 검수자는 영문만 검수 → 영문 누락 시 즉시 거절

---

## 7. 운영 / 모니터링

### 7.1 Sentry 태그 확장

기존 Sentry transaction에 추가:
- `shopify.shop` = `bestbooks.myshopify.com`
- `shopify.plan` = `free|usage|pro`
- `site.provenance` = `shopify`

### 7.2 Grafana 대시보드 신규 패널

- Shopify shops total (by plan)
- 월 잡 카운트 (top 10 shop)
- UsageCharge 누적 ($ today/month)
- Free → Usage 전환률
- App Proxy 요청 latency (p50/p95)

### 7.3 백업 영향

- `~/backup.sh` 가 mysqldump 전체 → 자동 포함
- `shopify_shops.access_token` 은 암호화 상태로 백업 (키는 별도 안전 보관)

---

## 8. 구현 순서 (Claude 작업 큐)

| # | 작업 | 의존성 | 예상 |
|---|------|--------|------|
| 1 | `shopify_shops` 테이블 + `sites.provenance` 컬럼 추가 (수동 SQL + entity) | — | 0.5d |
| 2 | `apps/api/src/shopify/` 모듈 골격 (controller, service, hmac guard) | 1 | 0.5d |
| 3 | `SitesService.createForShopify()` 구현 + 단위 테스트 | 1, 2 | 0.5d |
| 4 | OAuth callback + webhook registration | 2, 3 | 1d |
| 5 | GDPR webhook 3종 핸들러 | 4 | 0.5d |
| 6 | `apps/shopify` 워크스페이스 신규 (Remix 스캐폴딩 + Polaris 메인 화면) | — | 1d |
| 7 | i18n 골격 (editor + admin react-i18next 도입) | — | 2d (병렬) |
| 8 | Theme App Extension 스캐폴딩 + Liquid block | 6 | 1d |
| 9 | App Proxy session-token endpoint + iframe 통합 | 4, 8 | 1d |
| 10 | UsageGateService + Bull 잡 hook | 1 | 1d |
| 11 | Shopify Billing API 통합 (recurring + usage) | 10 | 1d |
| 12 | 운영 모니터링 (Sentry tag, Grafana 패널) | 11 | 0.5d |

**합계 약 10일 (병렬 진행 가정 시 7~8일)**

---

## 9. Open Questions

1. **Free tier 정책 미세조정** — 20건이 적정? publish 후 첫 30일 데이터로 재평가 필요
2. **Pro 가격 $29** vs 경쟁사 $39~$49 — 저렴한 진입 시그널 vs 가치 인식 저하 trade-off
3. **App Proxy slug** — `/apps/printable-editor` 가 SEO 측면에서 길다. `/apps/pe` 검토?
4. **Theme Extension 위치** — App Block (section)만? App Embed Block (head/footer 글로벌)도 필요?
5. **편집기 폰트 라이선스** — 영문 시장 진입 시 폰트 라이선스 추가 검토 필요

---

## 10. 다음 단계

- [ ] 이 설계 문서 사용자 리뷰
- [ ] 사용자가 Shopify Partner 가입 + API key 발급
- [ ] `.env`에 `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_TOKEN_ENCRYPTION_KEY` 등록
- [ ] 작업 큐 #1부터 순차 진행
