# Printable Editor (Storige) × Shopify 앱스토어 배포 계획 (2026-05-16)

> **작성**: 2026-05-16 · **갱신**: 2026-05-27 (v1.1 — 의사결정 반영)
> **상태**: ✅ **GO 결정 완료** — Phase S-1 시작 준비
> **요약**: Storige 편집기·워커를 **"Printable Editor"** 브랜드로 Shopify 앱스토어에 publish, 한국+글로벌 동시 타깃, Freemium+사용량 과금. 개발 6~8주(검수 포함), 첫 $1M 매출까지 0% 수수료. PHP 통합과 **병렬 진행**.
>
> ### 🔒 확정된 5가지 의사결정 (2026-05-27)
>
> | # | 항목 | 결정 | 함의 |
> |---|------|------|------|
> | 1 | **타깃 시장** | 🌐 글로벌 + 한국 동시 | 영문 우선 + 한글 동시 i18n 필수 |
> | 2 | **가격 모델** | 🆓 **Freemium + 사용량 기반** | Free tier(월 N건) + 초과시 종량 + 선택적 Pro 정액제 |
> | 3 | **브랜드명** | 🏷 **Printable Editor** | Shopify 앱 listing 전용 브랜드. Storige는 백엔드 플랫폼명 유지 |
> | 4 | **편집기 i18n** | 🌍 영문 + 한글 동시 (필수) | 양쪽 타깃 결정의 자연스러운 귀결 |
> | 5 | **PHP × Shopify 순서** | ⚡ **병렬 진행** | 리소스 분산 리스크 인지, 워크트리/브랜치 분리로 완화 |

---

## 0. TL;DR

| 항목 | 결론 |
|------|------|
| **가능 여부** | ✅ 가능 |
| **시장 적합도** | 🟢 높음 (경쟁사 7개 활성, $19~$99/월대) |
| **재사용율** | 약 **70%** (편집기 + 워커 그대로) |
| **개발 기간** | **3~5주** + 자체 QA 1주 |
| **Shopify 검수** | 평균 2~4주 (1차 4~7영업일, 보통 2회 재제출) |
| **총 publish 까지** | **6~8주** |
| **초기 비용** | $19 (Partner 가입 1회) |
| **수수료** | 첫 $1M까지 **0%** / 이후 15% |
| **차별점** | 책자/포토북 합성 (perfect/saddle/hardcover spine 자동 계산) — 일반 POD customizer 약점 영역 |

---

## 1. 시장 컨텍스트 — 경쟁사 + 가격대

Shopify 앱스토어의 **Product Personalizer / Print on Demand** 카테고리는 이미 활성화돼 있습니다 = 시장 검증 완료.

| 앱 | 가격 | 특징 | Storige 차별점 |
|----|------|------|----------------|
| **Customily** | $49/월 + 거래수수료 | POD 종합, 라이브 미리보기, AI 필터 | 책자/spine 약함 |
| **Inkybay** | $19.99~/월 | 제품 빌더, PDF/SVG/JPG/PNG 출력 | 멀티페이지 약함 |
| **Print.App** | $39/월 | print-ready PDF 자동 | 책자 합성·spine 없음 |
| **Smart Customizer** | 견적 | 2D/3D, dynamic pricing | 일반 POD |
| **Customall** | $24~/월 | 라이브 미리보기 | POD 중심 |
| **Customix** | $19~/월 | AI 배경 제거, 얼굴 cutout | 단순 customizer |

### Storige가 차지할 자리

```
일반 POD customizer ──┬── 티셔츠/머그/액세서리 (포화)
                     │
                     └── 책자/포토북/명함 멀티페이지 ←── 🎯 Storige
                          · perfect / saddle / hardcover spine 자동
                          · 멀티페이지 자동 합성 (Ghostscript + pdf-lib)
                          · check-mergeable 사전 검증
                          · admin 통합 운영 (사이트별 default 정책)
```

---

## 2. Shopify 앱 구조 옵션

Shopify 앱은 3가지 위치에서 동작합니다. Storige는 **3개 모두 사용**.

| 옵션 | 어디서 보이는가 | Storige 적합도 | 역할 |
|------|----------------|----------------|------|
| **Admin Embedded App** | Shopify Admin 안 (판매자) | ✅ **필수** | App Bridge + Polaris — 사이트 등록·설정·잡 모니터링 |
| **Theme App Extension (App Block)** | 판매자 스토어프론트 (제품 페이지) | ✅ **필수** | 고객이 "디자인하기" 버튼 → 편집기 진입 |
| **App Proxy** | 판매자 도메인의 `/apps/<slug>/...` | ✅ **권장** | 결과 PDF 다운로드를 판매자 도메인으로 프록시 (Shopify HMAC 검증) |

### 전체 아키텍처

```
                        ┌─────────────────────────────────────────┐
                        │   Shopify 판매자(merchant)               │
                        │                                          │
[Shopify Admin]         │  ┌──────────────────────────────────┐   │
   판매자 화면 ──────────┼──┤ Storige Admin Embed (Polaris UI) │   │
                        │  │  · 사이트 정보 / 잡 모니터링       │   │
                        │  │  · Billing 상태                    │   │
                        │  └──────────────────────────────────┘   │
                        │           ↕ App Bridge (JWT session)    │
                        └─────────────────────────────────────────┘
                                    ↕  OAuth + Token Exchange
                        ┌─────────────────────────────────────────┐
                        │   고객(쇼퍼) — 판매자 스토어프론트         │
                        │                                          │
                        │  제품 상세 페이지                          │
                        │  ┌──────────────────────────────────┐   │
                        │  │ [🎨 디자인하기]  ← Theme App Block │   │
                        │  └──────────────────────────────────┘   │
                        │           ↓ 클릭                          │
                        │  ┌──────────────────────────────────┐   │
                        │  │ iframe: Storige Editor           │   │
                        │  │ editor.papascompany.co.kr        │   │
                        │  └──────────────────────────────────┘   │
                        │           ↓ 완료 (postMessage)            │
                        │     cart에 디자인 ID line item 첨부        │
                        │           ↓ 결제                          │
                        │     orders/paid webhook                  │
                        └─────────────────────────────────────────┘
                                    ↓  자동 합성 잡 발사
                        ┌─────────────────────────────────────────┐
                        │   Storige Platform                      │
                        │  · API + Worker (기존 그대로 재사용)       │
                        │  · 멀티사이트 모델 (각 Shopify shop = 1 site)│
                        │  · PDF 합성 → app proxy로 판매자에게 전달   │
                        └─────────────────────────────────────────┘
```

---

## 3. 현재 Storige 자산 vs Shopify 요건 매칭

| Shopify 요건 | 현재 Storige 보유 자산 | 신규 작업 |
|--------------|----------------------|-----------|
| **멀티 테넌시** (각 스토어 = 1 인스턴스) | ✅ Phase A Site 엔티티 + 자동 `site_id` 격리 | OAuth 후 Site 자동 생성 로직 |
| **OAuth 2.0 인증** | ❌ (현재 X-API-Key만) | Shopify OAuth + Token Exchange |
| **App Bridge + 임베디드 admin UI** | ❌ | 신규 앱 1개 (Remix/Polaris) |
| **Polaris 디자인 시스템** | ❌ (현 admin은 Ant Design) | 임베디드 앱만 Polaris (Built for Shopify 요건) |
| **Theme App Extension** | ❌ | Liquid block + JS 신규 |
| **HMAC webhook 검증** | ✅ 유사 패턴 (Base64 sig 보유) | Shopify HMAC-SHA256 어댑터 |
| **Billing API** | ❌ | `RecurringApplicationCharge` 통합 |
| **GDPR mandatory webhooks** (`customers/data_request`, `customers/redact`, `shop/redact`) | ⚠️ 부분 (보안 패치 A-E) | 3개 webhook handler |
| **Performance (Lighthouse ≤10pt)** | ✅ 별도 도메인이라 자동 통과 | 검증만 |
| **편집기 + 워커 + 합성 PDF** | ✅ **완전 검증** | 그대로 재사용 |
| **결과 PDF 다운로드** | ✅ `/worker-jobs/{id}/output` | App Proxy 어댑터 |

**재사용 70% / 신규 30%** — 큰 자산(편집기·워커)은 무변경.

---

## 4. 단계별 로드맵

### Phase S-1: 사전 등록 + 환경 (1일)

- [ ] Shopify Partner 계정 가입 ($19 1회) → https://partners.shopify.com
- [ ] Development store 1개 생성 (테스트용 무료)
- [ ] App 등록 → API key + secret 발급
- [ ] 개발 도메인 결정 (예: `shopify.papascompany.co.kr`)

### Phase S-2: 임베디드 앱 신규 구축 (1주)

- [ ] `apps/shopify` 워크스페이스 신규 (Remix + `@shopify/shopify-app-remix`)
- [ ] OAuth 흐름 (install → consent → token exchange)
- [ ] **OAuth 콜백에서 자동 Site 등록**:
  ```typescript
  // 의사코드
  onShopifyInstall(shop) {
    const site = await sitesService.create({
      name: shop.name,
      domain: `https://${shop.myshopifyDomain}`,
      uploadCallbackUrl: `https://${shop.myshopifyDomain}/apps/storige/webhook`,
      // editorAuthCode / workerAuthCode 자동 생성 (Phase A)
    });
    await db.shopifyShops.insert({ shopDomain, siteId: site.id, accessToken });
  }
  ```
- [ ] Polaris UI: 잡 목록 / 사이트 설정 / Billing 상태
- [ ] App Bridge session token + token exchange

### Phase S-3: 백엔드 통합 (3일)

- [ ] `apps/api`에 `/shopify/oauth/callback` + `/shopify/webhooks/*`
- [ ] HMAC-SHA256 검증 어댑터 (우리 Base64 sig와 분리 모듈)
- [ ] **GDPR webhooks 3종**: `customers/data_request`, `customers/redact`, `shop/redact`
- [ ] `orders/paid` webhook → 워커 자동 합성 잡 발사
- [ ] App proxy endpoint: `/apps/storige/orders/{id}/pdf` (HMAC 검증 + 결과 스트림)

### Phase S-4: Theme App Extension (3일)

- [ ] Liquid app block `storige-designer.liquid`
- [ ] 제품 페이지에 **"🎨 디자인하기" 버튼** + iframe modal
- [ ] iframe src: `https://editor.papascompany.co.kr/?shopifyShop=xxx&productId=yyy&jwt=zzz`
- [ ] 편집기 완료 → `postMessage` → cart line item property에 디자인 ID 첨부

### Phase S-5: Billing + 가격 정책 (2일) — **Freemium + 사용량**

확정된 과금 모델 (의사결정 #2):

- [ ] Shopify Billing API 통합 (`RecurringApplicationCharge` + `UsageCharge`)
- [ ] **Free tier** — 합성 잡 **20건/월** 무료 (진입 장벽 0)
- [ ] **사용량 과금** — 21건째부터 **$0.50/건** (UsageCharge, capped $99/월)
- [ ] **선택적 Pro 정액** — **$29/월 무제한** (heavy user 옵션)
- [ ] 결제 미완료 사이트는 `status='suspended'` 자동 동기화
- [ ] Shopify Admin Polaris UI에 실시간 사용량 게이지 + 알림(80% 시점)

> Free tier 20건은 보수적 시작값. publish 후 데이터 보고 조정 (Bull 큐 잡 카운트 기준 모니터링).

### Phase S-6: Built for Shopify 인증 준비 (1주)

- [ ] **Lighthouse ≤10pt 영향** 검증 (별도 도메인 → 통과 쉬움)
- [ ] **GDPR/CCPA 정책 페이지** (현 보안 패치 A-E + DSR webhook)
- [ ] **개인정보 처리방침** 페이지
- [ ] **접근성 (WCAG 2.1 AA)** — Polaris 사용 시 대부분 자동
- [ ] **App listing 자료**: 스크린샷, 데모 영상(영문 자막), 아이콘, 설명

### Phase S-7: 검수 제출 + 1차 review 대응 (2~4주)

- [ ] Shopify Partner Dashboard에서 submission
- [ ] 평균 review 4-7 영업일 → feedback → 수정 → 재제출
- [ ] 평균 2-4주 후 publish

**합계: 6~8주**

---

## 5. 비용 + 수익 모델

### 일회성 + 운영

| 항목 | 비용 |
|------|------|
| Shopify Partner 등록 | **$19** (1회) |
| 개발 인건비 (자체) | 3~5주 |
| 도메인/SSL | 0 (기존 `papascompany.co.kr` 활용) |
| 추가 인프라 | 최소 (기존 VPS에 앱 1개 추가) |

### 매출 수수료 (Shopify Revenue Share, 2025-01 이후)

- **첫 $1,000,000 누적 매출까지: 0%** ✅
- **$1M 초과분: 15%** (영구)
- 결제 처리 수수료: 2.9%

### 시뮬레이션 (Freemium + 사용량, v1.1)

```
[보수적 시나리오] — publish 후 6개월
  Free 사용자          200명 × $0       = $0
  사용량 과금 평균사용자 40명 × $15/월   = $600
  Pro 정액제          10명 × $29/월    = $290
  합계: $890/월 = $10,680/년

  → Free funnel이 작아도 사용량 과금이 핵심 수익원
  → $1M 누적까지 90년+ = 사실상 영구 0% 수수료
  
[성장 시나리오] — publish 후 18개월
  Free 사용자          1,500명 × $0     = $0       (CAC 0, 브랜드 노출)
  사용량 과금 평균사용자 250명 × $20/월  = $5,000
  Pro 정액제          60명 × $29/월    = $1,740
  합계: $6,740/월 = $80,880/년

  → freemium의 강점: viral 진입 + 사용량으로 자연 monetize
  → $1M 도달까지 약 12년 → 영구 0% 수수료 유효
```

Freemium의 장점: **CAC가 사실상 0** (Shopify App Store 자체 노출). 사용량 과금은 책자/포토북 도메인 특성상 **건당 처리 비용(GS·Sharp)이 명확**해 마진 예측 쉬움.

---

## 6. 위험 + 의사결정 항목

### ✅ 결정 완료 (2026-05-27)

| # | 항목 | 결정 |
|---|------|------|
| 1 | 타깃 시장 | 🌐 글로벌 + 한국 동시 |
| 2 | 가격 모델 | 🆓 Freemium (월 20건) + 사용량 $0.50/건 + Pro $29/월 |
| 3 | 브랜드명 | 🏷 **Printable Editor** |
| 4 | 편집기 i18n | 🌍 영문 + 한글 (필수, 동시) |
| 5 | PHP × Shopify 순서 | ⚡ 병렬 진행 |

### 🟡 기술 리스크 (병렬 진행에 따른 추가 항목 포함)

| 리스크 | 완화 방법 |
|--------|----------|
| Lighthouse 점수 영향 | 편집기 별도 도메인 + lazy load → 영향 최소 |
| 2025-08 GDPR 강화 정책 | DSR webhook 3종 미리 구현 |
| 첫 리뷰 거절 | 평균 2회 재제출 — 일정 2주 buffer |
| 영문 review (한글 편집기) | i18n 영문 우선 + 영문 자막 데모 영상 + 영문 docs 준비 |
| **PHP × Shopify 병렬 — 컨텍스트 스위칭** | 워크트리 분리 (`apps/shopify` 신규), 작업 브랜치 격리 (`feature/shopify-*` vs `feature/php-*`), 일/주 단위 단일 트랙 집중 |
| **사용량 과금 — UsageCharge cap 누락 리스크** | Shopify Billing API의 `cappedAmount` 필수 설정 + 80% 임계 알림 |
| **Free tier 남용** | 합성 잡 시작 전 사용량 확인 게이트, 동일 shop_domain 다중 install 차단 |

### 🟢 강점 활용

- ✅ **검증된 워커 인프라** (Grafana + Loki + Sentry) — Shopify 운영 안정성 입증 자료
- ✅ **Phase A/B/C 멀티사이트 모델** — Shopify 멀티 스토어 격리에 1:1 매칭
- ✅ **PDF 합성 도메인 전문성** — POD 일반 customizer 대비 책자/명함 특화

---

## 7. 다음 액션 (v1.1, 의사결정 반영 후)

### 즉시 (사용자 직접, 1~2시간)

1. **Shopify Partner 가입** ($19) → development store 생성 → API key/secret 발급
   - https://partners.shopify.com → "Create new app" (custom or public 둘 다 OK, 처음엔 dev)
   - App API key + Secret 를 `~/storige/.env` 의 `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` 으로 등록 (CLAUDE.local.md 5절 형식)
2. **경쟁사 무료 체험** (Customily / Print.App / Inkybay) → UX 캡처 + 차별점 영문 카피 초안

### 즉시 (Claude 작업, 이번 주)

3. **`docs/SHOPIFY_TECHNICAL_DESIGN.md` 작성** — Phase S-2~S-5 상세 설계
   - OAuth 콜백 → Site 자동 등록 시퀀스 다이어그램
   - Webhook 라우팅(`/shopify/webhooks/*`) + HMAC-SHA256 어댑터 코드 골격
   - Theme App Extension Liquid + JS 스켈레톤
   - Billing UsageCharge 흐름 (Free→Usage→Pro 전이 상태머신)
   - i18n 정책 (en-default, ko-fallback, locale=shopify locale 추출)
4. **i18n 골격 작업** — `apps/editor` + `apps/admin` 에 react-i18next 도입 (영문/한글 동시)
5. **워크트리 셋업** — 신규 `apps/shopify` (Remix + `@shopify/shopify-app-remix`) 스캐폴딩

### 결정 후 (개발 사이클, 6~8주)

- Phase S-1 ~ S-7 로드맵 따라 진행
- **PHP 통합과 병렬**: 브랜치 분리(`feature/shopify-*` ↔ `feature/php-*`)로 컨텍스트 격리

### 검수 후 (publish)

- 운영 모니터링 (Storige Grafana + Shopify Partner Analytics)
- Free → Usage → Pro 전환율 추적 → 가격/cap 조정
- 사용자 피드백 → 기능 추가 사이클

---

## 8. 참조

### Shopify 공식
- [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)
- [Built for Shopify requirements](https://shopify.dev/docs/apps/launch/built-for-shopify/requirements)
- [Revenue share for App Store developers](https://shopify.dev/docs/apps/launch/distribution/revenue-share)
- [Configure theme app extensions](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)
- [About session tokens (Auth)](https://shopify.dev/docs/apps/build/authentication-authorization/session-tokens)
- [Authenticate app proxies](https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies)

### 경쟁사 (App Store listings)
- [Customily Product Personalizer](https://apps.shopify.com/customily-product-personalizer)
- [Print.App Product Customizer](https://apps.shopify.com/print-app-1)
- [Inkybay Product Personalizer](https://apps.shopify.com/productsdesigner)

### Storige 내부 연계
- [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) — 본 Shopify 앱의 백엔드 기반
- [`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md) — 멀티사이트 모델
- [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md) — 전체 진척률

---

## 변경 이력

| 버전 | 날짜 | 내용 |
|------|------|------|
| v1.0 | 2026-05-16 | 최초 제안 — Shopify 앱스토어 publish 가능성 분석 + 로드맵 |
| **v1.1** | **2026-05-27** | **GO 결정 + 5가지 의사결정 확정**: 브랜드 "Printable Editor", 글로벌+한국 동시, Freemium+사용량 과금, 영문+한글 i18n 동시, PHP×Shopify 병렬. 가격 시뮬레이션 재산정, 다음 액션 재정렬. |
