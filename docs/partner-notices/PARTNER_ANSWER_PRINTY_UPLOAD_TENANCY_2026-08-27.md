# Storige 회신 (2026-08-27) — printy: presigned 업로드 테넌시 · 산출물 회수 경로

- 발신: Storige 운영 (papascompany)
- 회신 근거: **코드 실물 추적 + 프로덕션 DB 실조회 + 라이브 프로브**(추측 시 명시)
- 총평: **printy 의 진단은 거의 전부 정확합니다.** 특히 S2·S4 는 원문·주석과 일치하고, S3 의 삭제 위험은 **저희가 확인한 결과 오히려 printy 서술보다 더 무겁습니다**(soft 가 아니라 즉시 hard delete). 다만 대부분은 **의도된 설계이거나 이미 인지된 미결 트랙**이며, "지금 당장 코드로 닫는다"가 정답이 아닌 것도 사실입니다. 아래에서 항목별로 무엇이 사실이고 무엇이 저희 몫인지 가릅니다.

---

## 먼저 — printy 가 확정 못한 4건, 저희가 확정합니다

| # | 미확정 항목 | 확정 결과 |
|---|---|---|
| 1 | 라이브 `files.site_id` 실값 | **NULL 237건**(live 225) / bookmoa-mobile 3 / MD2Books 1 / **printy 귀속 0건**. presigned 고객 파일이 전부 NULL 이라는 판독은 **DB 로 확인됨** |
| 2 | 유효 editor 키 보유 활성 테넌트 수 | **8개**(100p·bookmoa-mobile·Default×2·MD2Books·printy·ShareSnap·북모아메인). 즉 S3 의 실질 공격자 집합 = 이 8곳(외부 익명 아님) |
| 3 | R2 객체 나열(ListObjects) 가능 여부 | **불가**. 버킷 공개 개발 URL(r2.dev) 비활성(대시보드 실측) + presign 토큰은 Object R/W 스코프라 List 권한 없음 → UUID 비밀성 방어는 유효 |
| 4 | R2 CORS 정책 원문 | 어제 저희가 대시보드에서 직접 편집해 **원문 보유**. `AllowedOrigins` 10종(+ 어제 new.bookmoa.com) · `AllowedMethods: PUT/POST/GET/HEAD` · `AllowedHeaders: *` · `ExposeHeaders: ETag` · `MaxAgeSeconds: 3600`. printy 도메인 미포함 = S1 그대로 |

1·2 는 위험도 재산정에 쓰시라고 값 그대로 드립니다.

---

## S1. R2 CORS — ✅ **이미 통과합니다**(라이브 재검증 완료)

printy 커스텀 도메인은 어제(2026-08-26) 오너의 CORS 배치에 **함께 반영됐습니다.** 방금 R2 엔드포인트에 preflight 를 직접 실측했습니다:

| Origin | preflight(PUT) |
|---|---|
| `https://www.printy.kr` | **204 + `Access-Control-Allow-Origin: https://www.printy.kr`** |
| `https://printy.kr` | **204 + `Access-Control-Allow-Origin: https://printy.kr`** |

즉 printy 감사가 본 **403 은 반영 이전 시점**의 관찰입니다 — 지금 커스텀 도메인에서 재검증하시면 통과합니다. "별칭은 통과·커스텀만 막힌다"는 함정 지적 자체는 정확했고, 그래서 저희도 preflight 를 커스텀 도메인 기준으로 실측했습니다.

---

## S2. 사이트 키로 산출물 받는 정식 경로 — printy 판독 전부 정확

**Q2-1 (files 등록 여부, 전수 확정)**:

| 잡 유형 | files 등록(outputFileId) | 회수 경로 |
|---|---|---|
| fix-pagecount · fix-bleed | **O** | `GET /files/:id/download/external` (X-API-Key + site 대조) ← printy 전환 대상 |
| validate/external | 해당 없음(result JSON 만) | — |
| **synthesize · split-synthesize · compose-mixed** | **X** (전부 jobType=SYNTHESIZE, 등록 훅 없음) | `outputFileUrl`/`result.outputFiles[].url` 직접 GET (무인증 공개) |
| render-pages | X | `/storage/content-pdf-guides/…` 공개 |

등록 훅은 CONVERT 마커 3종(pagecount-fix·bleed-fix·inner-imposition)에만 존재합니다. **synthesize/external 도 files 미등록입니다** — 이 점이 Q2-1 의 핵심 답입니다. bookmoa-mobile 도 같은 compose-mixed 사용자라 **동일하게 적용**됩니다.

**Q2-2 (compose-mixed 를 X-API-Key 로 받는 경로)**: **없습니다(확정).** printy 판독대로입니다.
- 미묘한 예외 1건(코드 판독, 라이브 미실측): 파트너가 자기 X-API-Key 로 `POST /auth/shop-session` 을 호출해 받은 **shop-session Bearer** 는 `GET /worker-jobs/:id/output` 의 전역 JwtAuthGuard 를 통과합니다. 단 (i) 이건 **문서화된 정식 경로가 아니고** (ii) `separate` 모드의 `cover.pdf` 는 단일 파일 스트림이라 못 받으며 (iii) 그래도 **바이트 자체는 공개 `/storage/` 에 그대로 놓입니다**. 그래서 "인증 회수 경로가 실무상 없다"는 결론은 유효합니다.

**Q2-3 (outputFileUrl 직접 GET 이 공식 안내인가)**: **맞습니다.** 가이드 §3.4·§5.1 이 그 방식을 안내하면서 동시에 "🚨 산출물 URL 은 비밀로 취급 — 무인증 공개, 접근통제는 jobId(UUID) 은닉에만 의존"이라고 **스스로 경고**하고 있습니다. printy (c) 판독이 원문과 일치합니다.

**보너스(`downloadOutput` = admin 전용?)**: 실효적으로 맞지만 정확히는 **"JWT 인증 전용, 파트너 표준 경로 아님"** 입니다(@Roles 없음 → shop-session Bearer 도 통과). 회신 표현만 이렇게 정정해 주시면 됩니다.

**→ printy 접수분(files 등록 잡을 `/files/:id/download/external` 로 전환)은 정확한 조치입니다. compose-mixed 는 그 전환 대상이 아닙니다 — 아래 S4 와 함께 봅니다.**

---

## S3. presigned 파일 site_id = NULL — 의도된 정책이나, 삭제 위험은 printy 서술보다 무겁습니다

**Q3-1 (의도인가)**: **NULL 자체는 의도된 하우스 정책**입니다(`assertSiteAccess` 가 "NULL=레거시/시스템공유"를 허용). 그러나 **presigned 가 NULL 을 대량 생산해 격리를 무너뜨리는 것**은 저희 계획 문서(`PLATFORM_EXPANSION_PLAN_2026-07-03.md §8`)가 이미 **"격리 결함"으로 명시 인지**한 상태입니다. site 를 채우는 지점은 코드 어디에도 **0곳**이고, complete 핸들러는 인증 컨텍스트가 없습니다. printy 판독 정확합니다. (템플릿셋 NULL 이 "설계된 hybrid"였던 전례를 떠올려 자기 판독을 의심하신 신중함은 옳았지만, 이번엔 "인지된 결함"이 맞습니다.)

**Q3-2 (동거 테넌트가 fileId 로 삭제 가능한가)**: **printy 판단이 맞고, 실제로는 더 무겁습니다.**
- `DELETE /files/:id/external` → `hardDelete` → **즉시 R2 객체 + DB 행 물리 삭제**. **softDelete 가 아니며 48h 복구창이 없습니다.** printy 는 "복구할 방법이 없다"고 우려했는데, 그 우려가 정확합니다 — 파일 보존 트랙의 48h 복구창은 이 경로에 적용되지 않습니다.
- 게이트: `assertSiteAccess` 는 `if (file.siteId && file.siteId !== caller.siteId) throw` — **NULL 이면 첫 조건이 falsy 라 그냥 통과**. 멤버 소유·상태 검사 등 추가 게이트 없음. thumbnail·expiry·download/external 전부 동일.
- **유일한 완화 요인**: 위 미확정 2 의 답 — 실질 공격자는 **유효 editor 키를 가진 활성 테넌트 8곳**으로 한정됩니다(익명 인터넷 아님). 신뢰 경계 안이지만, "동거 테넌트가 사고/악의로 남의 고객 원고를 지울 수 있다"는 구조 자체는 사실입니다.

**Q3-4 (영구 보관·보존정책 미적용)**: **맞습니다.** complete 확정 시 `expires_at = NULL`(영구), retention sweep 은 `expires_at IS NOT NULL` 만 대상이라 구조적으로 제외. site 보존정책(`retentionDays`)은 `/files/upload/external`(인증 업로드)에만 적용되고 presigned complete 엔 없습니다. 뉘앙스 하나: complete 를 **안 부른** pending 업로드는 발급 시 24h TTL 이 걸려 sweep 대상이 됩니다(즉 "버려진 반쪽 업로드"는 정리됨). 확정 파일만 영구입니다.

**Q3-3 (대안 A~D 의 동결 저촉·권고)** — 저희가 코드로 판정한 결과:

| 안 | 동결 저촉 | 실효 | 판정 |
|---|---|---|---|
| **A. complete 시 site 스탬프** | **저촉 없음**(핸들러 내부 로직은 동결 대상 아님, ApiKeyGuard/IS_PUBLIC 불변) | 부분 커버(shop-session 제시분만 — 100p 의 키없는 server-to-server, 게스트 편집기는 여전히 NULL) | **권장 1단계** |
| B. 발급 시 site 바인딩 | **강제형은 명시 위반**(계획서 "presigned-upload-public 인증 강제 금지"), 옵션형만 가능 | A 와 동일 부분 커버 | 옵션형만 |
| C. key prefix | B 와 같은 제약 + `assertSiteAccess` 는 키를 파싱 안 하고 DB siteId 만 봄 → 격리 0 기여 | 없음 | 최하 |
| **D. 파괴 연산만 소유 검증** | `DELETE /files/:id/external` 이 **동결 목록 실재**(경로·ApiKey·404 시맨틱 동결). NULL 즉시 차단은 **100p/MD2 의 문서화된 정리 플로우를 직격**(그들의 대용량 파일이 전부 NULL-site presigned) | 최종 상태로는 옳음 | **A/B 선행 없이 단독 시행 금지** |

**printy 가 "D 가 가장 파급이 작아 보인다"고 한 직관은 절반만 맞습니다** — D 의 *목표*(파괴 연산 보호)는 옳지만, 지금 D 를 단독 적용하면 유형1 파트너의 대용량 파일 정리 기능이 깨집니다. 저희 계획서가 이미 처방한 순서는 **A/B 옵션형 스탬프로 신규 파일부터 site 귀속 → 파트너에 키 첨부 이행 안내 → 관측 후 NULL-파괴 연산에 단계적 게이트**입니다. 이게 "이원 정책"이고, **오너 결정 대기 트랙**에 묶여 있습니다(S4 와 같은 트랙).

**printy 단독 완화책(상류 변경 없이)**: 이미 하고 계신 것(fileId 단독 무력화 + HMAC 토큰 + kind/주문소유 대조)이 정답입니다. 추가로 권하는 것은 **"업로드 시 shop-session Bearer 를 함께 실어 complete 를 호출"** — A 안이 배선되면 그 파일만 printy 로 스탬프됩니다(배선 여부는 오너 결정 후 통지).

---

## S4. compose-mixed 산출물 공개 서빙 — 미결 오너 트랙, printy 판독 정확

**Q4-1 (오너 결정 트랙 현황)**: **미결 확정.** 최초 기록 2026-07-03, 재확인 2026-08-13, 현재까지 결정 없음. `worker-jobs.controller.ts` 주석 원문과 `CONTRACT_FREEZE.md §4.3`(NULL-siteId 이원 정책)이 정본입니다. 결정의 실체 = "NULL 거부를 강화하면 레거시 파트너가 깨지므로, **기존 의존분 화이트리스트 + 신규 site 스탬프 강제**의 이원 정책을 오너가 확정해야 한다"입니다. **printy 의 '오너 결정 대기' 인용이 정확합니다.**

**Q4-2 (assembleFromSession + Bearer 로 해결되는가)**: **두 사안은 완전히 직교합니다.**
- (i) 잡 siteId 스탬프 → **예, 세션 권위로 채워집니다**(`session.siteId` 를 dto.siteId 보다 우선 주입, 세션은 caller 일치 검증 후에만 조립).
- (ii) 산출물 바이트 위치 → **스탬프와 무관하게 그대로 공개 `/storage/outputs/<jobId>/`**. printy 가 "산출물 바이트 자체가 공개 경로에 놓이는 것은 그대로 아닌지" 물으신 그 우려가 **정확합니다.** 스탬프는 read 메타(`GET /worker-jobs/external/:id`)의 격리만 개선하고, 바이트 서빙은 안 바꿉니다.

**Q4-3 (printy 단독 해결 가능한가)**: **잡 스탬프는 가능, 산출물 공개는 불가.**
- printy 는 자기 X-API-Key 로 `POST /auth/shop-session` → Bearer 발급 → compose-mixed 에 실으면 **잡 siteId 스탬프까지는 오늘 단독으로** 얻습니다("X-API-Key 로는 무시된다"는 관찰은 정확하나, Bearer 우회로가 있습니다).
- 그러나 **산출물 공개 노출은 진짜로 단독 해결 불가** — nginx `/storage/` 무인증 정적 서빙이라 상류 변경이 필요합니다.

**당장의 완화책(권장)**: 지금 하시는 **"결과 URL 을 클라이언트에 노출하지 않고 서버에서만 중계"** 가 현 시점 최선입니다. jobId 비밀성에 기댄 방어라 근본책이 아니라는 지적도 맞지만, 근본책(nginx 서명 토큰 또는 산출물 files 등록 후 인증 회수)은 오너 결정 트랙 안에 있습니다. 참고로 **jobId 는 uuidv4(122bit, 순차 아님)** 라 브루트포스 진입은 비현실적이고, 버킷 List 도 불가(미확정 3)라 **비밀성 방어 자체는 현재 유효**합니다 — 유출면은 웹훅 payload·프록시 로그이지 추측이 아닙니다.

---

## 정리 — 무엇이 누구 몫인가

| 항목 | 판정 | 조치 주체 |
|---|---|---|
| S1 R2 CORS | **완료·라이브 통과 실측**(www.printy.kr/printy.kr 204) | — (재검증만) |
| S2 files 등록 잡 회수 | printy 접수 조치가 정답 | **printy** (download/external 전환) |
| S2 compose-mixed 회수 | 인증 경로 없음 = 사실 | S4 트랙과 동일 |
| S3 NULL site + 삭제 위험 | 사실(삭제는 hard, 더 무거움). 단 공격자=키보유 8테넌트 | **오너 결정 대기**(이원 정책) |
| S3 완화 A~D | A=권장1단계·저촉없음 / D=단독금지 | 오너 결정 후 배선 |
| S4 산출물 공개 | 미결 오너 트랙(2026-07-03~) | **오너 결정 대기** |

**저희가 확인 없이 지금 실행하지 않는 이유**: S3·S4 의 상류 변경은 전부 **동결 계약 + 오너 결정 트랙**에 묶여 있어, 파트너 다수(특히 100p·MD2Books 의 대용량 무인증 업로드/정리 플로우)의 무중단을 깰 수 있습니다. printy 가 "고쳐 달라가 아니라 의도 확인"으로 접근한 판단이 정확했습니다.

## 다음 단계 제안

이 회신은 **사실 확정**까지입니다. printy 가 위 판정을 받고 우선순위를 정하면, 오너 결정이 필요한 2건(S3 이원 정책 · S4 산출물 서빙)을 **설계안으로 올려** 결정을 받겠습니다. A 안(complete 시 옵션형 스탬프)은 동결 저촉이 없고 diff 가 작아 **가장 먼저 배선 가능한 후보**입니다.

## 문의

모든 수치·경로는 재현 가능합니다(DB 조회 + 코드 file:line + 라이브 프로브). 추가 확인은 같은 채널로.
