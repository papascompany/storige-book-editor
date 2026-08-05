# 오너 결정표 — 2026-07-07 (CTO 취합 5건 상세)

> CTO 개발 이슈 보고(2026-07-07)의 결정 병목 5건을 **기입식 결정표**로 상세화한 문서.
> 각 결정의 ☐ 란에 선택 표기(✅)하고 날짜를 적으면, 해당 트랙 실행 세션이 이 문서를 게이트 해제 근거로 삼는다.
> 개별 트랙의 전체 미결 목록 정본: E트랙 로드맵 §7(6건) · E1 구현명세 §7(4건) · P트랙 로드맵 §8(10건).
> 이 표는 그 중 **지금 실행을 여는 핵심만** 추린 것이다.

> ✅ **[2026-07-14 오너 결정 완료]** 오너가 **CTO 권장안 전부 수용**을 채팅으로 지시 — 아래 전 행 기입 완료.
> D-1a~d=A · D-2a~e=A · D-3a=A(단 Wave0 실측 선행) · D-3b=권고대로 "실측 후 결정" · D-3c=권고대로 유보(추후 결정) · D-4a~c=채택·D-4d=기각 · D-5=기완료(부분).
> **게이트 해제**: E1 구현 · P트랙 Stage 2~4 · SDK 보강(채택 3건, E1 후 권장). 실행 정본: `CTO_ORCHESTRATION_MASTER_PROMPT_2026-07-14.md`.

---

## D-1. E1 편집기 컨트롤 착수 (E1 구현명세 §7 — 로컬 전용 문서)

**여는 것**: E트랙 Stage E1 구현(스마트 가이드·수치 피드백·객체 액션 바·분배 + 재단선 경고). 미결 시 E1~E5 전체 정지.

| # | 질문 | 옵션 | 권고 | 결정 |
|---|---|---|---|---|
| D-1a | §5 범위 4건으로 착수 승인? | A. 승인(Wave0 상충확인→직렬 구현→오너 머지 게이트) / B. 보류 지속 | **A** — 명세 완성 상태, 리스크는 플래그·dispose로 격리 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-1b | 재단선 침범 실시간 경고(§5-5)를 E1에 포함? | A. 포함 / B. E2 이월 | **A** — 재단 잘림은 인쇄 CS 최다 유형, 기존 cutBorder/safeSizeBorder 재사용이라 부담 낮음 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-1c | ObjectActionBar v1 버튼 구성 | A. 복제+삭제 2종 / B. 벤치식 레이어·잠금 포함 4종 | **A** — 잠금/레이어는 기존 ControlBar와 중복, 보호객체 비활성 게이팅은 필수 유지 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-1d | 신규 컨트롤 기능 플래그 기본값 | A. 기본 on(개별 off 가능) / B. 점진 롤아웃(기본 off) | **A** — 순수 additive. 단 **임베드 파트너 2곳(bookmoa-mobile·ShareSnap) 사전 공지** 필수 | ✅ **A** — 2026-07-14 (권장안 수용 · 파트너 공지는 머지 전 오너 발송) |

## D-2. P트랙 Stage 2~4 개방 + §8 핵심 4건 (P트랙 로드맵 §8)

**여는 것**: 파트너 API 셀프서브 온보딩(Stage 2)~SDK/DX(Stage 4). ※Stage 0~1은 결정 불요·착수 가능.

| # | 질문 | 옵션 | 권고 | 결정 |
|---|---|---|---|---|
| D-2a | 파트너 확약 0이어도 Stage 2~4 착수(§8-8 규율 공식화)? | A. 승인 / B. 파트너 확약 후 | **A** — 문서·인프라는 파트너 영업의 전제 조건 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-2b | 과금 모델(§8-1) | A. Settlement Ledger(후불 정산) / B. Credit Wallet(선불) / C. 구독 | **A** — B2B 관계형 부합·결제 인프라 불요. Wallet은 SaaS 전환 시 재검토 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-2c | 파트너 포털 형태(§8-3) | A. admin 확장 / B. 신규 앱 | **A** — 기존 인증·배포 재사용, 분리는 수요 후 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-2d | 샌드박스 인프라(§8-4) | A. 단일 VPS 논리 분리 / B. 도메인/VPS 실분리 | **A** — 파트너 3곳 도달 시 B로 전환 | ✅ **A** — 2026-07-14 (권장안 수용) |
| D-2e | 법률 문서 착수(§8-5 약관·DPA·SLA) | A. DPA부터 법무 착수 / B. 전체 일괄 / C. 보류 | **A** — DPA는 신규 파트너 계약의 법적 전제 | ✅ **A** — 2026-07-14 (권장안 수용 · 법무 발주는 오너 수행) |

## D-3. POD 트랙 실행 게이트 (벤치 프롬프트 [S-P2A/B/C] — 로컬 전용 문서)

**여는 것**: 컷아웃 편집 UX 확장 → 칼선 자동생성·검증 → 특수 인쇄 레이어(화이트/박/스팟).

| # | 질문 | 옵션 | 권고 | 결정 |
|---|---|---|---|---|
| D-3a | POD 트랙 착수 시점 | A. E1 완료 후 / B. 즉시 병렬 / C. 보류 | **A** — 편집기 코어 안정 후. 단 [S-P2A] Wave0 실측(기존 배경제거 OpenCV 경로 성능·품질)은 선행 무해 | ✅ **A** — 2026-07-14 (권장안 수용 · Wave0 실측은 즉시 가능) |
| D-3b | 컷아웃 서버 오프로드 전환 | A. 기존 클라 OpenCV 유지 / B. worker 신규 잡 오프로드 | **실측 후 결정** — Wave0 결과(대용량 성능·로직 노출도)로 판단. B 선택 시 인프라 비용 승인 포함 | ✅ 권고대로 **Wave0 실측 후 결정** — 2026-07-14 (A/B 미확정 — 실측 보고서를 근거로 재상신) |
| D-3c | 특수 레이어([S-P2C]) 대상 상품 라인업 | A. 스티커류 우선 / B. 명함·카드류 우선 / C. 미도입 | 오너 상품 전략 사안 — 권고 유보. 칼선([S-P2B])과 독립 결정 가능 | ✅ 권고대로 **유보** — 2026-07-14 ([S-P2C]만 보류, [S-P2A→B]는 D-3a에 따라 진행) |

## D-4. 임베드 SDK 프로토콜 보강 결정표 ([S-P3B])

**여는 것**: 벤치 계약 대비 부족분 보강(지연 주입 핸드셰이크·저장 리포트 봉투·토큰 재발급 루프·명령 봉투 규약).

| # | 채택 후보 | 가치 | 리스크 | 권고 | 결정 |
|---|---|---|---|---|---|
| D-4a | 지연 주입 핸드셰이크(wait_* → waiting-* → send-*) | 파트너 CSS·상품정보 늦은 주입 시나리오 대응 | 프로토콜 표면 확장 | 채택(additive) | ✅ **채택** — 2026-07-14 (권장안 수용) |
| D-4b | 저장 완료 콜백에 썸네일 URL 리스트 동봉 | 파트너가 별도 조회 없이 미리보기 갱신 | 낮음(payload 확장) | 채택 | ✅ **채택** — 2026-07-14 (권장안 수용) |
| D-4c | 토큰 재발급 요청 루프(장시간 편집 세션 유지) | shop-session JWT 만료 끊김 방지 | 인증 플로우 복잡도 | 채택(만료 실측 후) | ✅ **채택** — 2026-07-14 (권장안 수용 · JWT 만료 실측 선행) |
| D-4d | 명령 봉투 2계층(action:"command"+info) 규약 도입 | 확장성 | **기존 엔벨로프 v1 시맨틱 불변 제약과 충돌 위험** | **기각** — 현행 v1 유지, 신규 명령만 고려 | ✅ **기각** — 2026-07-14 (권장안 수용) |

> 공통 제약: 프로덕션 임베드 파트너 2곳(bookmoa-mobile·ShareSnap) **무중단** — postMessage 엔벨로프 v1 시맨틱 불변, 채택분은 additive로만. 회귀 e2e 필수.

## D-5. 즉시 실행 승인 2건 (보안·인프라)

| # | 질문 | 내용 | 권고 | 결정 |
|---|---|---|---|---|
| D-5a | 시크릿 cutover 실행 지시 | bookmoa PHP 구 키 폐기 + bookmoa-mobile preview env 복구 (상세: 로컬 전용 회전 핸드오프) | **즉시** — 구 누출키가 PUBLIC 히스토리에 잔존 | ✅ **부분 완료 (2026-07-12)** — 아래 |

> **D-5a 처리 결과 (2026-07-12):**
> - **실측(읽기전용 DB)**: 구 `1391c5b4` active·세션 32·최종 06-15 이후 0건 / 신 `dc81d27f` active·**세션 0건**. → PHP 편집기 경로 휴면.
> - **오너 확인(2026-07-12 채팅)**: bookmoa **PHP 쇼핑몰 연동 잠정 보류**. bookmoa-mobile·md2books·ShareSnap 연동 진행 중.
> - **판정 전환**: PHP 보류 = 구 키 프로덕션 미사용 → 유출 구 키 폐기가 **안전·바람직**(가역). 인증 가드 `sites.service.ts:82,89`가 status='active'만 조회함을 코드 확인.
> - ✅ **실행 완료**: 구 site `1391c5b4` → `status=inactive`(rows_changed=1 검증). 신 `dc81d27f`는 active 유지(재개 시 사용). → **유출 구 키 전량 폐기(외부 cutover 대기 0건).**
> **잔여(오너 수행):**
> - ①**bookmoa-mobile preview env**: Vercel 대시보드 → Settings → Environment Variables → Preview에 신 editor 키 추가(토큰 입력/계정 설정은 제가 못 함). 연동 진행 중이라 필요.
> - ②(재개 시) PHP 신 키 안전채널 전달 — 값 위치 VPS `~/storige/.rotated-secrets-2026-06-15.txt`, 연동 재개 시점에.
| D-5b | 출처 노출 방지 게이트 커밋 승인 | 미커밋 5파일(검사 스크립트+postbuild 2곳+CI 스텝+gitignore). 소스 기준선 0건·통과/실패 경로 검증 완료 | **승인** — 커밋 즉시 CI·배포 게이트 발효 | ✅ **완결** — 커밋 `d253e7c`(07-12) → **master 머지·push `f1d5e33`(07-14, 오너 지시)**. CI·배포 게이트 발효 |

---

## 결정 후 실행 매핑

| 결정 | 해제되는 실행 | 실행 정본 |
|---|---|---|
| D-1a~d | E1 구현 세션(Wave0→직렬4건→검증→머지 게이트) | E1 구현명세 §5~6 (로컬 전용) |
| D-2a~e | P트랙 Stage 2~4 (Stage 0~1은 이미 착수 가능) | SWEETBOOK_GAP_ROADMAP §5~6 + pv1/ |
| D-3a~c | POD 컷아웃→칼선→특수레이어 | 벤치 프롬프트 [S-P2A/B/C] (로컬 전용) |
| D-4a~d | SDK 보강 구현(채택분만, additive) | 벤치 프롬프트 [S-P3B] (로컬 전용) |
| D-5a~b | 보안 cutover 절차·게이트 커밋 | 회전 핸드오프(로컬)·RESUME §6.2 |

---

## [2026-07-15 추가] D-6. 트랙 C Wave0 실측 후속 (CTO 오케스트레이션 세션 발견)

> 정본: `CUTOUT_WAVE0_REPORT_2026-07-15.md`. 발견: 배경제거 실체는 OpenCV가 아닌 imgly ONNX(ISNet 1024 고정). **전 세션 eager preload ~111MB**(embed 포함)·픽셀 캡 부재(모바일 피크 500~800MB)·결과 base64 인라인(세션 JSON 15~40MB 급증).

| # | 질문 | 권고 | 결정 |
|---|---|---|---|
| D-6a | D-3b 확정: 컷아웃 서버 오프로드? | **A(클라 유지)** — 수요 부재·품질은 모델 문제. B는 실사용 발생+고품질 요구 시 재상신 | ✅ **B(워커 오프로드) 확정** — 2026-08-05 오너 결정(채팅, 권고 A 기각). S-P2A는 worker 'cutout' 잡 신설 아키텍처로 설계. 인프라 비용(잡당 피크 0.5~1GB·concurrency 1) 수용 |
| D-6b | A 유지 시 경량화 3건(①preload lazy화 ②픽셀 캡+업로드 가드 ③dataURL→storage 치환) 착수 승인? | **승인 권고** — ①은 embed 파트너 트래픽/메모리에 즉효. 전부 additive·플래그 뒤 | ✅ **①②③ 전부 승인** — ① 2026-07-15 완료(a09cf8a). ②③ 2026-08-05 오너 승인(채팅). ⚠️ B 확정에 따라 ③은 클라 선행 구현 없이 **worker 잡 설계에 통합**(중복 방지), ②는 양 아키텍처 공통이라 즉시 구현 |

보수적 기본값(세션 처리): 코드 변경 0 유지 — 오너 기입 시까지 착수하지 않음.

## [2026-07-15 추가] D-7. Stage 2 착수 게이트 (선행 정찰 발견)

| # | 질문 | 권고 | 결정 |
|---|---|---|---|
| D-7a | 파트너 포털 이메일 인증 — 메일 발송 인프라 전무(nodemailer/SES 등 0). 벤더·비용 결정 필요 | 보수 기본값: **포털 v0은 이메일 인증 제외**(운영자 초대 계정+SITE_ADMIN 셀프 뷰만) — 인증 가입은 인프라 결정 후 | ☐ (미결 시 보수 기본값으로 진행) |
| D-7b | frameAncestors 동적 CSP 주입 경로 — 편집기=Vercel 정적이라 (a) Edge Middleware+vercel.json 폴백 / (b) API 프록시 서빙 | **(a)** — 로드맵 "폴백 병존" 문구와 정합, 아키텍처 변경 최소. CTO 기술 기본값으로 채택하고 진행(파트너 2곳 회귀 필수) | ✅ (a) 채택 — 2026-07-15 CTO 기술 결정(가역) |
| D-7c | bookmoa 웹훅 수신부 실물 대조 — 레포 내 코드 없음(test-php는 서명 미검증) | 오너/파트너 액션: bookmoa PHP 실 수신부 코드 확보·대조 전 **기존 파트너 v2 전환 금지** 유지(신규 파트너 v2 전용은 무관) | ☐ 오너 액션 대기 |

## [2026-07-16 추가] D-8. 포털 셀프서브 → 전역-플랫 정책 유입 (배치2 적대 리뷰 발견)

> 배치1부터 존재하던 flat 구조(전 사이트 origin/host 합집합을 단일 CORS·webhook allowlist로 사용)가 배치2 포털에서 SITE_ADMIN 셀프 쓰기로 노출됨. SSRF(P1)는 코드로 수정하되, 아래는 정책 결정.

| # | 질문 | 권고 | 결정 |
|---|---|---|---|
| D-8a | allowedOrigins 셀프 등록이 전역 CORS 합집합(credentials:true)에 유입 — 한 테넌트가 전역 게이트를 넓힘 | 중기: site.domain 소유 검증 연동 제한. 단기: ArrayMaxSize 20 캡 유지+운영 모니터. **CTO 기본값=현행 수용(로드맵 승인 범위)+D-8b 완료 전제** | ☐ (미결 시 현행 수용) |
| D-8b | uploadCallbackUrl 셀프 등록 SSRF | **즉시 코드 수정**(발신 시점 DNS 해석+사설대역 차단) — 결정 불요, 배치2 머지 전 필수로 처리 | ✅ 코드 수정으로 처리 — 2026-07-16 |

## [2026-07-16 추가] D-9. finalization 구조 검증 정책 (Stage 3 배치B 적대 리뷰 P1-2)

> 발견: book_spec 미연결 또는 pageCount 미확정 시 finalization이 워커 validate(판형·페이지수·PDF 무결성)를 skip하고 COMPOSING→FINALIZED(주문가능)로 진행. book_specs 시드가 D-8-9(§8-9) 오너 게이트라 **현 배포에선 사실상 전량 skip**. §6.3은 validate를 필수 단계로 명시 → 코드-설계 이탈.

| # | 질문 | 권고 | 결정 |
|---|---|---|---|
| D-9a | 미검증 book의 FINALIZED(주문가능) 승격 허용? | **조건부 허용** — book_spec 연결+pageCount 확정 시 validate 필수, 미연결이면 skip하되 **book_finalizations에 validation_skipped 표식 + 웹훅/응답에 명시**(파트너·주문 단계가 인지 가능). orders 자동진입(Stage 6)은 미검증 book 차단 게이트 별도 | ☐ (미결 시 표식+문서화로 진행) |
| D-9b | book_specs 시드(§8-9) 승인 시점 | 승인 시 PDF_UPLOAD의 판형 검증 자동 활성 — dry-run 산출물(`pnpm collect:book-specs`) 검토 후 | ☐ (D-8-9와 동일 대기) |

세션 처리: §6.3 문서를 조건부-validate 계약으로 개정 + validation_skipped 표식 코드 추가(보수 기본값 — 미검증을 파트너가 알 수 있게). 허용 자체 여부만 오너 확정.

## [2026-07-16 결정] Stage 4 (DX) 착수 결정 4건 — 오너 확정

| # | 사안 | 결정 | 후속 |
|---|---|---|---|
| **D-10a** | `docs/PLATFORM_INTEGRATION_GUIDE.md` 파일명 소유권 (타 세션이 Shopify 가이드로 전면 교체 중, 원본은 untracked 백업에만) | ✅ **파트너 정본 유지 + Shopify 분리** | 세션 조치: Shopify 작업물을 `docs/SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.md`로 **비파괴 사본 생성 완료**(타 세션 미커밋 파일 무접촉). **⚠️ 타 세션 조율 필요**: 타 세션이 PLATFORM_INTEGRATION_GUIDE.md 파일명으로 커밋하면 파트너 정본(설계서 부록A·로드맵 Stage 4-3의 포털 소스)이 덮임 → 새 파일명 사용 안내 필요. 파트너 정본은 master 8bfbaa3에 보존(백업과 바이트 동일 확인) |
| **D-10b** | @storige/sdk 배포 채널 | ✅ **결정 보류 — private:true 유지** | SDK 코드는 완성하되 npm 미배포. 배포 결정 시 후속: private 해제·publishConfig·`@storige` org 확보·릴리스 워크플로(changesets)·branch protection 재검토(ci.yml:16-17 오너 대기와 연동) |
| **D-10c** | quickstart 3종 중 template-order 불가(템플릿 바인딩 라우트 5종 Stage 5 대기) | ✅ **webhook-receiver로 교체** | 확정 3종 = `pdf-upload-order`(PDF_UPLOAD) + `editor-session-order`(EDITOR_SESSION+/embed, 차별재) + `webhook-receiver`(웹훅 v2). SDK subpath 3종(/client·/embed·/webhook) 전수 커버. **로드맵 §6 Stage 4-2·프롬프트 E-2 문언 변경 필요**. template-order는 Stage 5 후 추가 |
| **D-10d** | 문서 포털 호스팅 | ✅ **신규 Vercel 프로젝트**(`storige-docs`) | md→html 파이프라인 신설(정적 빌더 전례 0). 도메인=storige-docs.vercel.app 또는 docs.papascompany.co.kr(오너 후속). admin 하위 경로는 인증 표면 혼재+ignoreCommand 침묵장애 이력으로 배제. check:exposure를 포털 빌드 게이트로 편입 |

### Stage 4 정찰이 적발한 서버 트랙 결함 (별건 에스컬레이션 — Stage 4 범위 밖)
| # | 결함 | 실물 | 영향 |
|---|---|---|---|
| **E-1** | **멀티파트 멱등 지문 맹점** — 멱등 인터셉터가 multer보다 먼저 실행돼 req.body 빈값 → request_hash 상수. 같은 Idempotency-Key로 다른 파일 업로드 시 조용히 재전달=**파일 유실** | `partner-idempotency.interceptor.ts:74` | SDK가 멀티파트 멱등키 자동부여 금지로 회피. **서버 근본수정 필요**(인터셉터를 multer 뒤로 or 파일 지문 합성) |
| **E-2** | **OpenAPI export에 books 11라우트 누락 + CI 단언 침묵** — Stage 3 머지 시 OpenAPI 트랙 통합 누락. 커버리지 50%(9/22) | `export-openapi-partner.ts:117-120`(컨트롤러 목록), `:41-52`(REQUIRED_PATHS) | **문서 포털 API 레퍼런스 입력** → Stage 4 직접 영향. 수정 필요 |
| **E-3** | `@PartnerLiveOnly` 부착 0 — test 키로 finalization 호출 가능 | `books.controller.ts` | ⚠️ **오탐 가능성**: Stage 2 test 잡 인프라 목적이 "test 키로 워터마크 더미 생성"이므로 test finalization은 의도된 동작일 수 있음. 설계 의도 확인 필요 |
| ~~**E-4**~~ | ~~`STORAGE_MAX_FILE_SIZE` 기본값 불일치 (50MB vs 100MB)~~ → **✅ 오탐 확정(2026-07-16 실측)** | `storage.service.ts:38`(50MB) vs `files.service.ts:50`(100MB) | **두 개의 별개 업로드 표면이며 각자 내부 일관**: ①`storage.controller`(레거시/공개) = multer **하드코딩 50MB**(`:35,:54`) + StorageService 기본 50MB → 일관. ②`files.controller`(파트너/편집기, books 자산이 타는 경로) = multer 100MB + files.service 기본 100MB → 일관. files.service는 `ObjectStorageService`(별개 클래스)를 주입하지 `StorageService`를 쓰지 않음(정찰의 문자열 매칭 착시). prod는 env 미설정이나 각 표면이 정합하므로 **무해**. 잔여 스멜=동일 env명 공유하며 기본값 상이(혼동 유발, 기능 결함 아님) |

### [2026-07-16 추가] SDK 구현(E-1) 중 적발된 서버 트랙 이슈 3건
| # | 이슈 | 실물 | 판단 필요 |
|---|---|---|---|
| **E-5** | **`requestId` 계약 드리프트** — `PartnerV1ErrorEnvelope.requestId`는 타입상 `string`인데 GET `/books/{uid}/pdf` 스트림 error 핸들러만 `requestId: null` 발신 | `books.controller.ts`(pdf 스트림 에러 분기) vs `packages/types` 봉투 타입 | SDK는 `string\|null` 방어+테스트로 문서화함. **서버를 타입에 맞출지(requestId 채움), 타입을 nullable로 완화할지** 오너/서버 트랙 판단 |
| **E-6** | **photo 직접 업로드가 사실상 죽은 표면** — `POST /books/{uid}/photos`가 멀티파트를 받으나 직접 업로드 MIME 필터가 **PDF 전용**(`BOOK_ASSET_DIRECT_UPLOAD_MIME`) → 이미지 멀티파트는 **항상 415**. 사진은 fileId 참조 전용 | `books.constants.ts`(MIME) + `books.service.ts`(415 분기) | **의도된 설계인지 확인**. 의도면 문서·SDK에 "photo는 fileId 참조 전용" 명기(SDK는 이미 반영), 아니면 이미지 MIME 허용 필요 |
| **E-7** | **멀티파트 멱등 함정의 서버측 회귀 테스트 부재** — `partner-idempotency.v1.spec.ts`·`books.v1.http.spec.ts` 어디에도 멀티파트 멱등 케이스 없음 → **파일 유실(E-1)이 회귀해도 red가 안 남** | 두 spec 전수 확인 | E-1 근본수정 시 회귀 spec 동반 필수 |

### [2026-07-16 추가] SDK `/webhook` 구현이 적발한 웹훅 계약 이슈 3건 (서버 트랙)
| # | 이슈 | 실물 | 심각도·조치 |
|---|---|---|---|
| **E-8** | **v1↔v2 identifier 규칙 불일치** — 서명 형식(`t=,v1=`)은 같으나 identifier 계산이 다름. v1(`webhook.service.ts` payloadIdentifier)=`'jobId' in payload`(**키 존재** 검사) → truthy sessionId → **finalizationUid** → `''`. v2(`signWebhookV2` 호출부)=`jobId ?? sessionId ?? delivery uid`(**finalizationUid 분기 없음**). → `book.finalization.*`는 **v1이면 `fin_...`, v2면 `whd_...`로 서명**. `jobId:null`이면 v1은 문자열 `'null'`로 서명 | `webhook.service.ts:255` vs `webhook/v2/webhook-delivery.service.ts:350~` | **v1→v2 마이그레이션 함정**: 파트너가 finalizationUid 기준으로 검증 코드를 짜두면 v2 전환 시 **전량 401**. SDK는 `identifierStrategy:'auto'`(X-Storige-Delivery 헤더 유무로 판별)로 흡수. **서버=발신부 정합화 or 문서 경고 필요** |
| **E-9** | **bookmoa ±10분 신선도 게이트 — 충돌 대상 정정(적대 리뷰 렌즈2가 반증)** — 수신측 `bookmoaFresh`는 `payload.timestamp` ±10분 검사. ⚠️ **최초 기록("v2 30분 재시도와 충돌하는 시한폭탄")은 부정확**: bookmoa는 `x-storige-signature`(레거시)만 읽고 **HMAC 헤더 읽는 코드 0건**인데 v2는 **레거시 헤더 미전송**(`webhook-delivery.service.ts:48`) → **bookmoa는 오늘 v2를 아예 수신 불가**. 따라서 v2 충돌은 *가정적 미래* 문제 | `docs/WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md:25,47`(bookmoa `webhook.js:33-49,128-143` 인용). bookmoa-mobile 레포가 로컬에 없어 수신측 직접 확인 불가 — 대조표가 근거 | **현재 실 충돌 = v1 레거시 경로의 큐 적체(>10분) 시 거부**(대조표 :47이 적시). v2 전환은 그 자체가 선행 과제(레거시 헤더 미수신). 둘 다 D-7c(bookmoa 수신부 대조)에 포함 |
| **E-10** | 기존 문서화 항목 재확인 — ①v1 base64 위조가능(시크릿 불참여) ②**수신 스냅샷은 HMAC-base64 기대 vs 발신은 hex `t=,v1=`** → bookmoa가 시크릿 설정 시 전량 401(게다가 HMAC 헤더를 읽는 코드 자체가 없음) ③Sharesnap `서명누락 + X-Storige-Retry=1` 무검증 통과 **구멍** | pairwise spec 3종 스냅샷 | Tier1 대조표(2026-07-03)와 정합. ③은 파트너측 수신 구멍 → 파트너 지시문에 포함 필요 |

### S-2 종결
100MB(직접 업로드) / 2GB(presigned) / 1GB(compose 기본 WORKER_MAX_FILE_SIZE) 확정. "90MB"의 정체 = **100p_books 자작 클라이언트의 라우팅 마진**(CONTRACT_FREEZE:60) — storige 서버 상수 아님. **결정6은 "확정"이 아니라 "정정 기록"으로 종결**. 잔여=VPS .env WORKER_MAX_FILE_SIZE 실값 확인 1회.

---

# 🔝 [2026-07-29 최상단 고정] 게스트 퍼널 선결 + 임베드 트랙 오너 결정

## ⛔ 선결 (서버 수정 없이는 게스트 퍼널이 성립하지 않음) — 착수 전 필수
**`migrateGuestSessions()`가 `siteId`를 주입하지 않는다** → 게스트→회원 전환 후에도 세션은 `siteId=null`로 남고, `books.service.ts:160-166`의 승격 게이트(`!session.siteId || session.siteId !== site.siteId` → 404)에 그대로 걸린다.

| 항목 | 실물 |
|---|---|
| 게스트 세션 생성 | `edit-sessions.controller.ts @Post('guest')`(@Public)가 `siteId` 미주입 → `service.ts:99`에서 `siteId: null` |
| 회원 라우트와 대비 | 회원 경로는 `siteId: user?.siteId`로 덮어씀(주입함) |
| migrate | `service.ts:504-527`이 `memberSeqno`/`guestToken`/`guestExpiresAt`만 변경, **`siteId` 무접촉** |
| 결과 | **회원 전환 후에도 승격 404** — "마이그레이션하면 승격된다"는 계획 전제가 **미작동** |

**Why**: 기획 세션 D7의 "마이그레이션 위임(권고 a)"이 이 전제 위에 서 있었다. 실코드 대조로 반증됨(2026-07-29, §6 병합 적대검증). 이 수정 없이 게스트 퍼널을 착수하면 파트너가 migrate 후 재시도하며 헛수고한다.
**How to apply**: migrate 시 caller 테넌트의 `siteId`를 주입하는 서버 수정이 **게스트 퍼널의 선결**. ⚠️ 교차테넌트 IDOR 방지 게이트를 우회하지 않도록, 주입 주체·검증(누가 어느 site로 승격시킬 수 있는가)을 함께 설계해야 한다. 기획 세션이 D7·D9·오너시트 D8에 반영 완료.

## D-11 (신규, 기획세션 발견 C) — 레거시 `storige:completed`에 `needsAuth` 부재
게스트 완료 시 정식 엔벨로프와 **레거시 `storige:completed`가 함께 발신**되는데(dual-emit), 레거시 화이트리스트에 `needsAuth`가 없다 → **레거시만 수신하는 호스트에는 `files:{coverFileId:null, contentFileId:null}`인 "정상 완료"로 보인다**(실제로는 로그인 유도 신호).

| 선택지 | 내용 | 평가 |
|---|---|---|
| A | 레거시 payload에 `needsAuth` 추가 | **동결 계약 변경** — `CONTRACT_FREEZE.md` 레거시 dual-emit 행에 닿음 |
| B | 레거시 수신 호스트를 정식 엔벨로프(v1)로 유도 | 기획세션 **권고**. 동결 불변 유지 |

**게이트**: `CONTRACT_FREEZE` 레거시 dual-emit 계약에 닿아 **문서·구현 트랙에서 단독 결정 불가**. 오너 결정 필요.

## 기획세션 문서에 반영 완료된 정정 3건 (구현세션 실코드 반증)
1. **발신 8종 FROZEN + `pricingChange` 1종 ADDITIVE**(← "9종 FROZEN"은 동결 표면 1종 부풀리기)
2. **레거시 와일드카드 노출값 = `sessionId`+`coverFileId`/`contentFileId`**(← `guestToken` 아님. 와일드카드 발동[parentOrigin 부재]과 guestToken 발신[parentOrigin 존재]이 **상호배타**)
3. **frameAncestors 반영 지연 = 최대 약 2분**(서버 `max-age=60` + 편집기 미들웨어 `CACHE_TTL_MS=60_000` **직렬 2단**. ← "60초"는 재배포 회귀 유발)

---

## [2026-07-29] Stage 4 완결 — 오너 액션 · 잔여

### 🔔 배포 직후 확인 필요 (D14가 프로덕션 편집기에 라이브)
`e2ccf0f` 로 편집기 인바운드 게이트에 **`e.source === window.parent`** 가 추가돼 Vercel 자동배포로 라이브(Ready 확인, `/embed` 200).
- **확인 대상**: 인바운드 명령(`getState`/`saveNow`/`setBackGuard`)을 실제로 구현했을 가능성이 있는 유일한 파트너 = **bookmoa-mobile**. 뒤로가기 핸드셰이크 1회 육안 확인 권고.
- **차단되는 유일한 정상형**: 조부모가 `frames[0].frames[0]` 로 손자에게 직접 발신하는 중첩 임베드. D14 이전에도 응답이 직접 부모로만 가서 요청-응답이 성립하지 않던 경로이며, 레포 내 그런 발신자 0건.
- **롤백**: `isTrustedHostCommandEvent` 의 `e.source` 조건 1줄 제거로 즉시 가능.
- 적대검증 근거: 배포 산출물에서 게이트 원문 추출해 **공격 22종 전부 차단·호환 7경로 전부 통과** 실증(형제 프레임·팝업·조부모 직접·source 위조·origin 우회 6종 / 표준 iframe·IIFE 최상위·중첩 직접부모·sandbox).

### 오너 결정 대기 (기존 + 신규)
| # | 사안 | 상태 |
|---|---|---|
| **선결** | `migrateGuestSessions()` **siteId 미주입** → 게스트 퍼널 미작동 | 위 최상단 고정 참조. **게스트 퍼널 착수 전 서버 수정 필수** |
| **D-11** | 레거시 `storige:completed` 에 `needsAuth` 부재 → 레거시 수신 호스트에 게스트 오완료 | 기획세션 권고 **B**(레거시 호스트를 v1 유도, 동결 불변) |
| **D-10b** | `@storige/sdk` 배포 채널 | **보류 유지**(`private:true`). 배포 시 후속: private 해제·publishConfig·`@storige` org·릴리스 워크플로 |
| **ⓐ** | `POST /api/worker-jobs/compose-mixed` **무인증(@Public)** — 근본 수정은 인증 추가 | `contract-freeze.spec.ts` 가 `auth:'public'` 으로 **동결** 중 → 계약 해제 결정 동반 |
| **루트 vercel.json** | 내부 IPv4 rewrites 2건(PUBLIC 레포) | `check:exposure` 가 예외로 통과시키되 매 실행 경고(값은 마스킹). 해당 Vercel 프로젝트 정체 미확인이라 임의 수정 보류 |
| **D-9** | 미검증 FINALIZED(validationSkipped) 의 orders 자동진입 차단 게이트 | Stage 6 |

### SDK 잔여 (LOW — 적대검증 remaining, 백로그)
1. `EditorEventHandlers` 중 6개 콜백이 `envelope.payload` 를 정제 없이 전달 — **현재 편집기는 그 이벤트에 guestToken 을 싣지 않아 실유출 0**. 다만 "guestToken 값은 콜백 어디에도 없음" 서술은 complete/needAuth 한정으로만 참이므로 문구를 좁히거나 dispatch 공통 경로에서 스트립 권장.
2. `parse.ts` 의 `'expectedSource' in options` 가 **프로토타입 체인**을 탄다 — 호스트에 프로토타입 오염 가젯이 있으면 게이트 ②가 조용히 꺼짐. `Object.prototype.hasOwnProperty.call(...)` 로 무비용 봉합 가능.
3. `normalizeOrigin` 이 `https://host:443`(명시 기본포트)·대문자 오리진을 하드 실패시킴 — fail-closed 방향이라 안전하나 정상 파트너 설정에서 걸릴 수 있음.
4. **D14 한계 명확화**: `e.source === window.parent` 는 **같은 오리진의 다른 프레임** 주입을 막지만, **부모 프레임 자체의 XSS·오픈리다이렉트**는 막지 못한다(부모가 같은 오리진 내에서 내비게이션해도 WindowProxy identity 는 유지). CONTRACT_FREEZE 배경 서술을 "다른 프레임에서의" 로 한정하면 정확.

### 문서 staleness (낮은 우선순위)
- `docs/EDITOR.md` §17.1 이 인바운드 게이트를 `(origin === parentOrigin 검증)` 2조건으로 서술 — 내부 문서. GUIDE·CONTRACT_FREEZE 는 3조건으로 정정 완료.
- `apps/docs/content/changelog.md` 에 인바운드 게이트 강화 항목 미등재(파트너가 보내는 것이 달라지진 않으나 비부모 발신이 드롭되므로 1줄 등재 검토).

---

## [2026-07-30] 게스트 세션 siteId 스탬프 — 머지 완료 (`8db37cc`)

**게스트 퍼널 선결이 해소됐다.** 승격 게이트(`books.service.ts` NULL-site 거부)는 그대로 두고, **생성 시점에 테넌트를 스탬프**하는 방향으로 풀었다.

### 설계 (적대검증 2렌즈 GO)
- **테넌트 근거 = 서명 검증된 shop-session JWT `payload.siteId` 단일 소스**(`jwt.decode()` 미사용). 그 siteId 의 근원은 X-API-Key 로 발급된 shop-session.
- **스탬프 지점 1곳**(생성). `migrateGuestSessions()` 는 siteId 를 **읽지도 쓰지도 않는다** → 사후 테넌트 이동 경로가 구조적으로 없음.
- **판정 불가 → NULL 유지**(fail-closed). 승격 404 는 버그가 아니라 안전한 실패.
- **교차 site migrate → 403** `CROSS_SITE_MIGRATION_DENIED`.
- **백필 0건 · DB 쓰기 0건 · 스키마 변경 0건.**

### 순증 개선 (기존보다 안전해짐)
**F-1**: 종전에는 무인증 요청 body 로 임의 `siteId` 를 스탬프할 수 있어 **NULL-site 안전판이 이미 우회 가능**했다. `...dto` **뒤** override 로 클라이언트 값이 구조적으로 패배하도록 봉합.
부수: `findByOrderExternal`·`getImpositionPreview` 의 `siteId IS NULL` 단락 때문에 종전 NULL-site 게스트 세션은 **모든 테넌트에게 열람 가능**했다 — 스탬프 후 자기 테넌트로 좁혀진다.

### 적대검증 결과
공격 **15종 전량 방어**: alg:none · 다른 시크릿 서명 · siteId 타입혼동 6종 · `source:['shop']` 배열 · Authorization 다중헤더 스머글링 · **guestToken 탈취 가정** · 순서 우회(site-less 선흡수 후 재migrate) · **동시 migrate race**(Promise.all) · NULL-site 승격 · 로그 위생. JWT_SECRET 미설정 오설정에서도 fail-closed(@nestjs/jwt v10 이 secret 부재 시 throw).

### ATK-14 동반 봉합 (이번 변경이 활성화시킨 문제)
게스트 라우트에 `allowedOrderSeqnos` 검증이 없어, `{allowedOrderSeqnos:[111]}` 토큰으로 `orderSeqno:222` 세션 생성이 가능했다(회원 라우트는 403). 종전엔 NULL-site 라 승격 404 로 자연 차단됐으나 스탬프 후 **승격 성립** → 파트너 내부에서 **타 고객 주문에 남의 PDF 가 붙을 수 있다**(교차테넌트는 아님). 회원 라우트와 동일 가드 + `OptionalShopJwtGuard` 가 해당 필드를 복원하도록 보강. 회귀 spec 4종(차단 1 + 무중단 3).

### 프로덕션 실측 (오너 게이트 해소 근거, SELECT only)
| 항목 | 값 |
|---|---|
| NULL-site 세션 전체 | **3건** |
| 그중 게스트(guest_token 존재) | **0건** |
| 최근 30일 신규 NULL-site | **0건** |
| NULL-site 중 status=complete | **0건** |
| site_id 채워진 세션 | 83건 |
→ 파트너 관측 동작 변화(worker orderOptions 머지·v2 웹훅 발송)의 **즉시 노출면 0**. 앞으로 생기는 게스트 세션부터 적용된다.

### ⚠️ 배포 시 유의 (API 는 수동 배포라 머지≠배포)
`siteId: null→값` 이 되면 **파트너 관측 동작 2곳**이 열린다: ①`worker-jobs` 의 `if (!siteId) return opts` 통과 → applyBleed/unit/checkWorkorder/checkCutting/checkSafezone **머지** ②`sendWebhookCallback` 의 **v2 웹훅 발송 개시**(단 v2 는 `webhook_configs` 행이 있는 opt-in 사이트만). 실측상 현재 게스트 NULL-site 가 0건이라 즉시 영향은 없으나, **배포 후 게스트 흐름 1회 관측 권고**.

### 잔여 (별건)
| # | 항목 | 성격 |
|---|---|---|
| F-4 | `refreshToken` 에 siteId 를 담아 **30일 site-scoped bearer** 발생. JwtStrategy 에 access/refresh 구분 클레임(`typ`)이 없어 refresh 가 access 로 통용(기존 동작). 자기 site 한정이라 IDOR 아님 | 하드닝 후보 |
| F-2 | `findByOrderExternal` 의 `OR session.siteId IS NULL` 주문번호 오염 | 범위 밖 |
| F-3 관련 | `complete()` 의 게스트 소유권 우회(`isGuest = !!session.guestToken`) — 아무 shop JWT 보유자가 남의 게스트 세션 완료 가능, 이제 웹훅까지 발화 | **별건 우선순위 높음** |
| — | NULL-site 3행 미백필(레거시 회원 세션, 게스트 0) | 의도적 |
