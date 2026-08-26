# Storige 회신 (2026-08-26) — 프린티 팀: 템플릿셋 테넌트 스코프 질의 3건

- 발신: Storige 운영 (papascompany)
- 회신 근거: **프로덕션 DB 실조회 + 코드/문서 대조** (추정 없음, 조회 시각 2026-08-26)
- 결론 요약: **① 4건 전부 `site_id = NULL` — 설계된 공유가 맞다 ② `with-templates` 무스코프는 문서상 FROZEN 계약이다 ③ 지금 프린티가 할 조치는 없다**
- 갱신 (2026-08-26): Q2 에서 알려드린 게이트 갭을 **당일 해소**했습니다(아래 Q2 참조). 계약·동작 변경 없음, 프린티 조치 불요.

---

## Q1. `template_sets.site_id` 실값 — NULL인가 bookmoa UUID인가

**4건 전부 `NULL` 입니다.** 그리고 질문의 전제를 하나 교정해야 합니다.

| template_set id | 이름 | type | site_id | 생성일 |
|---|---|---|---|---|
| `f0335fda-bf48-47f2-a908-2b2e70e78de8` | A4하드커버 책자 | book | **NULL** | 2026-05-25 |
| `a2cc2939-b76d-41a2-bd41-2d9fba091a24` | A4 기본 책자 | book | **NULL** | 2026-06-11 |
| `e66588b2-490b-4fea-ac03-44b76b3fb137` | A4 기본 책자 (가로) | book | **NULL** | 2026-07-09 |
| `83e6ec80-482b-4cee-a22b-ce1b08af33e0` | A4하드커버 책자 (가로) | book | **NULL** | 2026-07-09 |

**전제 교정**: `template_sets` **전체 43행이 전부 `site_id = NULL`** 입니다(활성 32). 특정 site 에 귀속된 템플릿셋은 **0건**입니다. 즉 "bookmoa 소유 템플릿셋"이라는 것이 존재하지 않으므로, 프린티가 **bookmoa 의 공백을 타고 있는 상태가 아닙니다.**

**그리고 이 NULL 은 레거시 기본값이 아니라 설계된 시스템공유입니다.** 코드가 세 곳에서 명시합니다:

1. `common/helpers/tenant-scope.helper.ts` — `applySiteScope(..., { includeNull })` 의 기본값은 **false(안전 우선)** 이고, 주석이 *"템플릿/라이브러리처럼 시스템공유를 함께 노출해야 하는 경우에만 명시적으로 true 전달"* 이라고 규정합니다.
2. `templates/template-sets.service.ts` `findAll` — `applySiteScope(qb, 'ts', scope, { includeNull: true })` + 주석 *"P2b: 템플릿셋=hybrid. includeNull=true → 시스템공유(site_id=NULL) 셋 + 자기 site"*.
3. 같은 파일 `findOne` — `assertSiteInScope(scope, templateSet.siteId, { allowNull: true })`.

정리하면 템플릿셋은 **hybrid 모델**입니다 — `NULL` = 전 사이트 공용, `site_id` 지정 = 그 사이트 전용. 지금은 공용만 존재합니다. 주문/파일/편집세션 같은 소유 리소스는 반대로 `includeNull` 기본 false 라 테넌트 격리가 걸려 있습니다(2026-08-24 확장 적용).

---

## Q2. `with-templates` 의 `@Public` 무스코프 — 계약인가 미봉합인가

**계약입니다.** 두 곳에 등재돼 있습니다.

- `docs/CONTRACT_FREEZE.md` — `template-sets/:id/with-templates` 가 **FROZEN** 으로 명시(비고 "4종 혼용" = 파트너 4사 공통 의존 표면).
- `apps/api/src/config/swagger-partner-routes.ts` — 파트너 OpenAPI allowlist 에 `GET /api/template-sets/{id}/with-templates` 포함. 이 목록은 CI 게이트(`swagger-partner-routes.spec.ts`)가 매 푸시 검사합니다.

코드도 실수가 아니라 의도입니다. 같은 컨트롤러의 다른 읽기 라우트 3개(`findAll` / `compatible` / `findOne`)는 **전부** `@CurrentScope()` 를 받아 서비스에 넘기는데, `with-templates` **하나만** 받지 않습니다 — 인증 이전 단계(편집기 부트스트랩)에서 호출되는 공개 표면이기 때문입니다.

**닫을 계획: 현재 없습니다.** 변경하려면 `CONTRACT_FREEZE §4` 절차(문서 갱신 → 파트너 공지 → 오너 승인)를 밟아야 하고, 파트너 4종이 전부 의존하므로 사전 통지 없이 바뀌지 않습니다. 시점이 잡히면 이 채널로 먼저 알리겠습니다.

**보고드렸던 갭은 해소했습니다 — ✅ 2026-08-26 등재 완료.**

질의 접수 시점에는 리플렉션 기반 동결 게이트(`contract-freeze.spec.ts`)가 Files / WorkerJobs / EditSessions 컨트롤러만 커버하고 **TemplateSetsController 는 빠져 있었습니다** — 문서는 동결인데 자동 검증이 없어, 실수로 `@Public` 이 떨어져도 CI 가 잡지 못하는 상태였습니다. 같은 날 등재했습니다.

| 등재 라우트 | 인증 시맨틱 | 상태 |
|---|---|---|
| `GET /template-sets/:id/with-templates` | `@Public` 무인증 | ✅ 게이트 등재 |
| `GET /product-template-sets/by-product` | `@Public` + `ApiKeyGuard` | ✅ 게이트 등재 + 문서 행 신설(사후 추인) |

컨트롤러 prefix(`template-sets` / `product-template-sets`) 동결도 함께 걸었습니다 — 경로 조립의 앞부분이 바뀌면 두 라우트가 통째로 이동하기 때문입니다.

`by-product` 를 함께 넣은 이유는 실패 모드가 비대칭이라서입니다: `ApiKeyGuard` 가 이탈하면 **조용히 완전 공개**가 되는데 그 경로에 아무 게이트도 없었습니다.

**게이트가 실제로 동작함을 뮤테이션으로 실증했습니다** — `with-templates` 의 `@Public` 을 지우면 "인증 시맨틱 = public" 이, `by-product` 의 `ApiKeyGuard` 를 지우면 "인증 시맨틱 = api-key" 가 각각 즉시 실패합니다(둘 다 원복 확인). CI 통과.

**프린티에 미치는 영향: 없습니다.** 이 변경은 리플렉션 테스트 추가일 뿐 런타임 동작을 바꾸지 않습니다. 방향으로는 "이 표면이 실수로 바뀔 위험이 줄어드는" 쪽입니다. 아울러 코드 주석에 *"with-templates 의 무스코프는 결함이 아니라 계약"* 이라고 명시해, 다음 작업자가 누락으로 오인해 스코프를 넣는 일도 막았습니다.

---

## Q3. 닫는다면 프린티를 어떻게 얹을 것인가

**지금 프린티가 취할 조치는 없습니다.** 이유는 Q1 의 사실 때문입니다.

- "해당 셋을 NULL 로 내릴지" → **이미 NULL 입니다.** 내릴 것이 없습니다.
- "프린티 Site 로 복제해 줄지" → **불필요합니다.** 복제하면 오히려 공용 1벌이 사이트별 N벌로 갈라져 유지보수가 나빠집니다.

프린티 사이트는 이미 등록이 끝나 있습니다 — site `009c26d5-2a3a-4976-a4c5-bb867f4130fc`, status **active**, editor/worker 인증키 설정됨, `allowedOrigins` 설정됨(2026-08-14 생성). 별도 온보딩 작업이 남아 있지 않습니다.

**장래에 스코프를 도입하더라도 방식은 "격리"가 아니라 "hybrid 유지"입니다.** `with-templates` 에 스코프를 주입하게 되면 `findAll` 과 동일하게 `includeNull: true` 시맨틱을 적용합니다 — 즉 `NULL` 공용 셋은 **모든 사이트에 계속 보이고**, 그때 새로 생기는 사이트 전용 셋만 격리됩니다. 프린티가 지금 쓰는 4개 셋은 어느 쪽이든 계속 보입니다.

**프린티 전용 템플릿셋이 필요해지면** 그때는 복제가 정답이고, 이미 경로가 있습니다: `POST /api/template-sets/:id/copy` (SITE_ADMIN + TenantGuard). 이 라우트는 비전역 스코프 호출 시 복제본의 `siteId` 를 **호출자 사이트로 자동 귀속**시킵니다. 필요해지면 요청 주세요.

---

## 참고 — 함께 확인한 인접 표면

`GET /api/product-template-sets/by-product` (파트너 allowlist 동일 등재)는 `@Public() + ApiKeyGuard` 조합입니다. 즉 **무인증이 아니라 X-API-Key 인증**이며, 서비스 레벨 site 스코프는 마찬가지로 적용되지 않습니다. 현재 `product_template_sets` 5행도 전부 `site_id = NULL` 이라 동작상 차이는 없습니다. 이 라우트도 위 Q2 의 게이트 등재 대상에 포함했습니다(2026-08-26).

## 문의

이 회신의 근거는 전부 재현 가능합니다(DB 조회 + 코드 경로). 추가 확인이 필요하면 같은 채널로 요청 주세요.
