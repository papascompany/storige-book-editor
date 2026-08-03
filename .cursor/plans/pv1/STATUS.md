# P트랙 SSOT — STATUS

> 갱신: 2026-07-15 (CTO 오케스트레이션 세션 — 정본: CTO_ORCHESTRATION_MASTER_PROMPT_2026-07-14.md)

## Stage×작업 매트릭스

| Stage | 작업 | 상태 |
|---|---|---|
| 0 (Wave B0) | 정찰: Stage 0 프롬프트 A 사실검증 | ✅ 완료 — 5건 전부 착수 가능. 확정: worker DTO `{isValid,metadata}`(validation-result.dto.ts:166) vs types 구형(index.ts:704), editor sessions.ts:387 타입 거짓말 실재 / CONTRACT_FREEZE.md:61만 오기 / split-synthesize·check-mergeable @CurrentSite 부재(단 **DTO+서비스 확장 동반 필요**, check-mergeable는 dry-run이라 스탬프 아닌 파일 스코핑 용도) / 동결 라우트 **16개**(17 아님), GUARDED 대상 9라우트 확정, GUARDED spec 미존재 / 설계서 부재 정상·partner-api 모듈 자리 확인 |
| 0 | S-1 ValidationResult 타입 정본화 (additive) | ✅ 구현 — `feat/p0-s1-validation-result` 32e2346 (WorkerValidationResult 신설+@deprecated 별칭+계약 spec 4건. ⚠️정찰 정정: sessions.ts:387은 에디터 세션 검증이라 타입 거짓말 아님 — 전환 미적용, JSDoc만). 적대 리뷰 대기 |
| 0 | STORAGE_NOT_S3 표기 정정 (문서만) | ✅ 구현 — `chore/p0-contract-freeze-typo` 2806537. 적대 리뷰 대기 |
| 0 | split-synthesize/check-mergeable @CurrentSite 주입 | ✅ 구현 — `feat/p0-external-site-stamp` b549cfb (split=DTO+스탬프, check-mergeable=감사 로깅만·동작 불변[보수 기본값 — NULL-siteId 오너 결정 대기], spec 6건). 적대 리뷰 대기 |
| 0 | GUARDED 계약 테스트 신설 | ✅ 구현 — `feat/p0-guarded-contract-spec` 7c3dc9d (9라우트 31단언, 브랜치3과 병합 실증 99/99. ⚠️FROZEN_ROUTES 실측 17 — 정찰 16 정정). 적대 리뷰 대기 |
| 0 | docs/PARTNER_PLATFORM_API_V1_DESIGN 설계서 (코드 0) | ✅ 작성 완료 — 브랜치 `docs/p0-partner-api-v1-design` 커밋 150f188 (739줄: 라우트 36·테이블 13·ERR 카탈로그 29·재사용 매핑·회귀 테스트 16항목·Owner Decision 10건). 적대 리뷰 대기 |
| 1-A | /api/v1 코어(모듈·PartnerApiKeyGuard(Bearer 병행)·봉투·audit·멱등·per-Key 리밋·페이지네이션) | ✅ 구현 — `feat/p1-partner-api-core` f022137..70f6b86 (5커밋, api 461 green, 신규 56케이스 supertest 실스택, 마이그레이션 2건, @PartnerV1Controller 조합 데코레이터로 Stage 2~5 승계 구조). 적대 리뷰 대기 |
| 1-B | BookSpecs(book_specs 테이블·수집 스크립트 dry-run·GET 3라우트·SpineService 재사용) | ✅ 구현 — `feat/p1-book-specs` 40ad950·4e0c7cc·7daafe9 (spec 23종, api 432 green, 책등 수치 실물 일치, 시드=dry-run만·오너 승인 §8-9). 통합 치환 3포인트 주석 명시(가드·봉투 이중래핑·pageCount 400↔422). 적대 리뷰 대기 |
| 1-C | 통합(feat/partner-api-v1-stage1: core+book-specs 병합·정합화 — 가드 치환·이중래핑 제거·400↔422 통일)+OpenAPI export+CI | 진행 — 통합 에이전트 (wt-p1int) |
| 1-C | 통합+OpenAPI | ✅ 완료 — `feat/partner-api-v1-stage1` 7d0eb2c..befeabb (api 489 green, openapi paths 4·내부 누출 0, 400→422 설계서 정본 통일) |
| 1 검증 | 적대 리뷰 2렌즈 | ✅ **양측 GO(조건부)** — 렌즈1 보안/격리: P0/P1 없음(P2 5: v1 가드누락 spec 부재·audit 무한성장·자격격리 Stage2 인지 등). 렌즈2 계약/정합: P0 없음, 변이 3/3 red 실증(머지 전 필수 2: 429 폴백 Retry-After·낡은 JSDoc). 백로그 P2: 재전달 requestId 문서화·in_progress TTL(Stage3 게이트)·errors[].code 정본화·목록/상세 비대칭·OpenAPI 스키마 0·CI 스텝 순서·크로스 테넌트 멱등 spec |
| 1 수정 | 필수 3건 | ✅ ddf0e2f (496 green, 변이 양방향 red 실증) |
| 1 배포 | 머지·push·프로덕션 반영 | ✅ **완료(2026-07-15)** — master feef3d1 push, 마이그레이션 3건 적용(테이블 3종 확인), api rebuild+nginx 재시작, 라이브 스모크: v1 ping 401 봉투 정확·book-specs 401·기존 표면 200. **book_specs 시드는 오너 승인 대기(§8-9 — VPS에서 `pnpm collect:book-specs` dry-run 산출물 검토 후)** |
| 2 (배치 1) | S2-1 partner_api_keys+env 모델+키 보안 3종 | ✅ 구현 — `feat/p2-partner-keys-env` 9a346cd..636bd8a (4커밋, api 516 green, 테스트 20종: 해시/grace 72h/revoked/env 전파/sites 불변+역방향 실증. 운영자 라우트 4종. 마이그레이션 20260715_c). 적대 리뷰 대기 |
| 2 (배치 1) | S2-2 웹훅 v2+delivery store(신규 파트너 전용) | ✅ 구현 — `feat/p2-webhook-v2` 7df42aa..c5d54f0 (5커밋, api 522 green, **v1 발신 바이트 불변 spec**·재시도 1/5/30 전용 큐·secret AES-GCM at-rest·D-7c 이중 opt-in·v1 라우트 7종). 적대 리뷰 대기 |
| 2 통합 | 3브랜치 병합+env 배선 | ✅ e3049e4 (api 553·editor 487 green, openapi paths 9) |
| 2 검증 | 적대 2렌즈 | ✅ 렌즈1 GO(P2 3 — 반출 채널·TLD 와일드카드는 선반영) / 렌즈2 조건부 GO→P1 2건(v2 발신 도달불가 게이트·delivery stuck) 수정 5bcb9d2·c8411f1→**재검 GO**(변이 M5/M6 red 실증) |
| 2 배포 | 배치1 머지·push·프로덕션 반영 | ✅ **완료(2026-07-16)** — master e56f60b(compose ENC_KEY 매핑 보강 포함), 마이그레이션 2건 적용(partner_api_keys·webhook_configs/deliveries), ENC_KEY 생성·주입(컨테이너 확인), api rebuild+nginx. 스모크: v1 401·frame-ancestors 200·기존 200. **CSP 게이트: /embed 헤더 1개+DB origin 동적 병합 라이브 실증** |
| 2 (배치 2) | S2-4 포털 v0(D-7a 보수 스코프) | ✅ 구현 — `feat/p2-partner-portal-v0` e75f8fc (api 591 green·포털 spec 25건 실물 가드 관통·admin 빌드+67, SITE_ADMIN 셀프 뷰+test 키 셀프 발급·live 403·존재 오라클 차단). 적대 리뷰 대기. 리뷰 포인트: JWT siteRoles 스냅샷 한계(기존 관례)·assertSiteAdmin 서비스 계층 위치 |
| 2 (배치 2) | S2-5 워커 test 잡 인프라(발화=Stage 3 게이트) | ✅ 구현 — `feat/p2-test-env-jobs` 7fb0727..aa4ec19 (api 584·worker 473 green, isTest 스탬프/워터마크 더미/retention 24h cron, DTO own-property 함정 실적발·수정) |
| 2 통합2 | 2브랜치 병합(feat/partner-api-v1-stage2-batch2) | ✅ 충돌 0 (api 609·worker 473·admin green, 마이그레이션 없음) |
| 2 검증2 | 적대 2렌즈 | ✅ 렌즈1 NO-GO→GO(P1 SSRF 실공격 실증→근본 차단·4벡터 재현 불가) / 렌즈2 조건부 GO→GO(P1-1 게이트·P2-1 변이). 수정 5커밋(24c7f3a SSRF·647de85 게이트·f0487d2 키상한·78bdc0d retention·ee596ce v2발신 SSRF). CORS 합집합=D-8a 오너 분리 |
| 2 배포2 | 배치2 머지·push·프로덕션 | ✅ **완료(2026-07-16)** — master 0a962b6, 마이그레이션 없음, api+worker rebuild+nginx, admin Vercel Ready. 스모크: portal 무인증 401·v1 401·기존 200·frame-ancestors 200 |
| **Stage 2 종료** | 배치1+배치2 전량 라이브 | ✅ 파트너 키 env 모델·웹훅 v2·동적 CSP·포털 v0·test 잡 인프라 프로덕션 반영 |
| 3 (Wave B0) | 정찰 2기 | ✅ 완료 — 파사드 재사용 지도 확정. **불일치 11건**(핵심: ①승격원본=file_edit_sessions ③compose-mixed partnerEnv/isTest 미전파=test 실합성 사고 ④SYNTHESIZE outputFileId 자동등록 부재 ⑥게스트 폴백 24h 고아화 ⑦콜백 역참조 부재 ⑪book_specs 시드 미적용). Stage 3 에러코드 packages/types 전량 사전정의. 분할 W1~W5 |
| 3 배치 A | schema-core+자산 라우트 | ✅ **배포 완료(2026-07-16)** — master 37da97f, 마이그레이션 1건(books/book_assets/book_finalizations 테이블 확인), api rebuild+nginx. 스모크 v1 books 401·기존 200. 적대 2렌즈 GO(자산 IDOR 변이 red)+수정(heavy 버킷·photo 상한, api 700 green) |
| 3 배치 B | W3 finalization+W4 creation-types+W5 test-env | ✅ **배포 완료(2026-07-16)** — master 8bfbaa3, 마이그레이션 2건(validation_skipped·plan_snapshot+uq_book_attempt 확인), api rebuild+nginx. 스모크 v1 finalization/pdf 401·**DI 미주입 경고 없음(배선 실증)**·기존 200. 적대 2렌즈 재검 GO(P1 2건 해소·변이 2종 red 실증). 불일치 7건 해소(compose-mixed env·outputFileId·콜백 역참조·NULL-site 거부). api 745·worker 473 |
| **Stage 3 종료** | Books 라이프사이클 전량 라이브 | ✅ 파트너 v1 전 여정 완주: book 생성→자산 투입→finalization(주문가능)→PDF 수령 + EDITOR_SESSION 승격(차별재). test 잡/포털 test 키 실발화 표면 완성. **오너 게이트: D-9(미검증 FINALIZED 정책)·book_specs 시드(§8-9)** |
| 4 (Wave B0) | 정찰 2기 | ✅ 완료 — **Stage 4 범위 자체를 정정**: ①SDK 코드생성 불가→수작업 확정(@ApiResponse type 0건+봉투=런타임 인터셉터) ②template-order 불가(템플릿 라우트 5종 Stage 5 대기)→quickstart 재편 ③types 의존 금지(private+내부 2207줄 노출) ④서버 결함 E-1~E-4 적발 ⑤GUIDE 정본 충돌(타 세션 Shopify 교체) |
| 4 오너결정 | D-10a~d | ✅ 확정 — GUIDE=파트너 정본 유지+Shopify 분리(사본 생성 완료, **타 세션 조율 대기**) / SDK 배포=보류(private:true) / quickstart=webhook-receiver 교체 / 포털=신규 Vercel storige-docs |
| 4 E-2 | OpenAPI export books 11라우트 누락 + CI 단언 침묵 | ✅ **머지 완료(2026-07-16)** — master f159cc0. **커버리지 11→22 오퍼레이션**(16 paths=v1 전량, 실측). 재발방지=v1 컨트롤러 FS 스캔 공용 헬퍼+3중 대조 spec. 적대 리뷰 GO(변이② 신규 컨트롤러 미등재→RED 실증=재발 시나리오 차단, AD-1 런타임 0건, 문서 과장 0). api 757 green. **런타임 무접촉→VPS 재배포 불요** |
| 4 E-1 | @storige/sdk 초판(`/client` v1 22라우트 + `/webhook` 검증·멱등·어댑터) | ✅ **머지(2026-07-16)** — `feat/p4-sdk-client` 18커밋. sdk **279 green**·runtime deps 0·private:true·서버 무접촉 증명. 적대 2렌즈: **P0**(secret 미설정→무인증 원격 프로세스 크래시, README 예제가 그 경로)+P1 3건(CI 미등재=드리프트 방어 장식 / dedupe 키 서명 밖 / toleranceSec NaN 침묵 OFF)+P2 6건 수정→**양측 재검 GO**(크래시 PoC 재현 불가 실증). **CI에 SDK 등재**(ErrV1 삭제 변이→typecheck+test 이중 red 실증) |
| 4 SDK 잔여 | `/embed` subpath | 미착수 — postMessage **명령 목록 미확정**(CONTRACT_FREEZE는 발신 이벤트 9종만 동결, 수신 명령 목록 부재). 착수 전 HANDOFF_Storige_postMessage_standardize_2026-06-01.md 확인 필요 |
| 4 quickstart | 3종(`examples/` 신설) | ✅ **머지(2026-07-16)** — master caa0c5e, 6커밋 31파일. pdf-upload-order(전 여정 9콜)·editor-session-order(iframe 4단 게이트+서버측 승격, 차별재)·webhook-receiver(부팅 검증+도메인 멱등). **적대 리뷰 NO-GO→P1 4건 수정→재검 GO**(리뷰어가 1차 공격 PoC 3종 직접 재실행해 차단 확인): ①회원 JWT 무인증 유출 구조(`/api/config` 세션 게이트+요청자별 발급+토큰 마스킹) ②게스트 `needsAuth` 무시→반드시 실패하는 승격(분기 단일화) ③**웹훅 재생공격 검증이 허위**(새 uid에 SECRET 재서명=공격자 아님, `book.finalization.*`는 uid가 서명에 포함돼 불성립)→jobId 이벤트+캡처 서명 재사용으로 재작성, 멱등 OFF 대조(granted 3vs1)로 vacuous 아님 실증 ④`expectedSource` 생략 시 fail-open→필수화. 오리진 게이트는 9종 우회 시도 전부 차단(반증 실패). CI 예제 스텝은 **sdk build 뒤·계약 테스트 뒤**(말미) 배치. **라이브 스모크 2종은 오너 test 키 발급 후 후속** |
| 4 E-3 | 문서 포털 + llms.txt(E-4) | ✅ **머지(2026-07-29)** — master `0157d91`. md→html 파이프라인 신설·GUIDE 발행 채널·v1 22 오퍼레이션 레퍼런스·폐기문서 5종 배너. 적대검증 **3라운드**(P0 2건→블로커 1건→GO): 포털이 EDITOR_SESSION 승격을 "미구현"이라 허위 발행(스테일 @ApiProperty 승계, DTO 원문까지 수정)·noindex가 llms 파일 미커버인데 "전 페이지 차단" 단언(fail-closed 반전)·키 노출 이력 반쪽 정화(정화본이 미정화본 링크). 부수: 노출 게이트가 내부 IP를 공개 CI 로그에 평문 출력하던 것 마스킹 |
| 4 §6 병합 | GUIDE 임베드 섹션(기획세션 개정안) | ✅ **머지** — master `9b652e4`. 중복 삽입 0건(6항 중 3항이 이미 존재)·frameAncestors 정정 6곳. 적대검증 2라운드: 코드에 없는 guestToken 노출 주장·예제 이중 실행 버그·**병합이 만든 포털 페이지 간 모순**. 부수: compose-mixed 예제 `orderSeqno`→`orderId`(복붙 시 400) 전수 정정 |
| 4 §7·D14·SDK | 수신 명령 계약 v1 등재 + `e.source` 봉합 + SDK `/embed` | ✅ **머지·라이브** — master `e2ccf0f`, 편집기 Vercel Ready(`/embed` 200). D14 적대검증: 배포 산출물에서 게이트 원문 추출해 **공격 22종 차단·호환 7경로 통과** 실증, 발신 8+1 FROZEN `diff` 0줄. **차단사유 수정**: SDK `path` 오리진 탈출(`//evil.com` 무기화 재현 — token/refreshToken 유출 + 수신 화이트리스트 재정박) fail-closed 봉합, 변이로 실효성 실증 |
| **Stage 4 종료** | DX 완성 | ✅ SDK(`/client`·`/webhook`·`/embed`, private 미배포)·quickstart 3종·문서 포털·llms.txt·수신 명령 계약. **오너 액션**: bookmoa-mobile 뒤로가기 핸드셰이크 육안확인 / 게스트 퍼널 선결(migrate siteId) / D-11 / SDK 배포채널 / compose-mixed 인증 |
| ~~4 잔여~~ | ~~문서 포털(E-3)·llms.txt(E-4)·`/embed` subpath~~ | ~~⏸️ E-3는 D-10a 선결 대기~~ — 타 세션이 `PLATFORM_INTEGRATION_GUIDE.md`(포털 소스)를 Shopify 내용으로 보유 중(+`PLATFORM_WORKER_INTEGRATION_v1.md`도 수정 중). 분리 사본 `SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.md` 생성 완료(비파괴). **타 세션에 새 파일명 커밋 안내 필요**. `/embed`는 postMessage 수신 명령 미확정 + quickstart가 이미 iframe 수신을 다루므로 **추가 가치 재평가 필요** |
| 2 (배치 1) | S2-3 frameAncestors Edge Middleware(D-7b a안) | ✅ 구현 — `feat/p2-frame-ancestors` 46a7edc·31217ca·3235286 (api 506 green·editor 39/39, superset-only 병합+정적 폴백+parity 강제 테스트, 기존 수집 로직 누락 버그 부수 교정). ⚠️미들웨어 e2e는 배포 환경 한정 — 배포 확인 절차 4단계 보고서에. 적대 리뷰 대기 |
| 2 (배치 2) | 포털 v0(D-7a 보수 스코프)+test 잡 워터마크/retention(워커) | 대기 (배치 1 후) |
| 2~4 | D-2 승인으로 개방 (B1 머지 후 직렬) | 대기 |

## 적대 리뷰 결과 (2026-07-15, Final Reviewer 별도 에이전트)
- **P0 없음.** 변이 테스트 3/3 적발(spec 견고성 실증), 4워크스페이스 tsc clean, 시크릿/벤치명 0건.
- P1-1(GUARDED에 bookmoa 실소비 `GET /product-template-sets/by-product` 누락) → ✅ 수정 d8c6632(96/96 green)
- P1-2(설계서 ApiKeyGuard 확장 지점 모호 — v1 test 키의 기존 표면 유출 여지) → ✅ 수정 27fb2b9(v1 전용 가드로 명문화)
- P2 기록: DTO siteId의 내부 admin 라우트 오버라이드(기존 패턴 답습 — P3b에서 봉합 권고) / 100p 폴백 문자열 실물 미확인(파트너 확인 필요 — 실장애 가능성 점검 성격) / 동결 라우트 확정 **17개**
- **종합: Stage 0 산출물 5건 전부 GO** (2건은 소수정 후 GO 처리 완료)

## 다음 액션
- ✅ **오너 승인(2026-07-15 채팅) → master 머지·push 완료**: 1555ee4·d1dc6f8·16ad211·3880175·f95096a (f1d5e33..f53afe7 범위, gitleaks 0·전 테스트 green)
- ✅ **VPS API 재배포 완료(2026-07-15)** — git pull(f53afe7)+api rebuild+nginx 재시작. health 200·public 라우트 200·Nest 정상 기동 확인. worker는 런타임 변경 0(spec 파일만)이라 미재배포
- **다음: Stage 1(Wave B1) 착수 가능** — 설계서(docs/PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md)가 구현 명세

## 오너 결정 상태
- D-2a~e 전부 ✅ (2026-07-14) — Stage 2~4 개방. 법무 발주(DPA)는 오너 수행.
