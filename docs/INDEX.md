# Storige 문서 인덱스

> **Shopify 개발 정본 갱신 (2026-10-15)**: [Editor·PDF Worker 앱 개발 가이드](./SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.md)와 [현황·흐름 시각화](./SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.html)를 사용합니다. 현재 master와 Shopify 2026-10 기준, 편집/PDF 입력·엄격 검증·주문·과금·개발 티켓을 종합했습니다. 기존 Shopify 제안서와 7월 가이드는 이력 자료입니다. 기존 파트너 계약 정본은 아래 두 문서를 유지합니다.

> ## ⚠️ 이 인덱스는 2026-06-17 스냅샷입니다 — 외부 연동은 아래 정본을 먼저 보세요
>
> 이 파일은 그 시점의 문서 목록이라 이후 갱신·폐기를 반영하지 못합니다. 아래 두 문서가 목록보다 우선합니다.
>
> | 정본 | 무엇 |
> |---|---|
> | [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) | **외부 파트너 연동의 유일한 정본.** 연동 유형 3종 결정(§0) · 공통 기반(§1) · 유형별 상세(§2~§4) · 레퍼런스(§5) |
> | [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) | 파트너 대면 표면의 **동결 계약** — 임의로 바꾸면 안 되는 항목의 목록 |
>
> §2 의 "플랫폼 워커 연동" · "bookmoa" 문서들은 **전부 폐기**됐습니다(각 파일 최상단 배너 참조). 신규 연동이나 AI 코드 생성에 사용하지 마세요.

> ## 🗓️ 상품별 편집 모드 트랙 (2026-10-16 ~ 10-19) — 캘린더 P1 은 운영 반영, P2-b 런처·P2-c 시트 맵은 브랜치 전용
>
> 2026-06-17 스냅샷 이후 가장 최근 개발 트랙이다. **운영 반영 여부를 구분**해서 본다(2026-10-19 기준, 브랜치 `p1-calendar-2026-10-17` 작업 트리에서 확인 — master 는 `49587f4e`, 브랜치는 `9be4c37c`).
>
> | 문서 | 무엇 | 운영 반영 / 브랜치 |
> |---|---|---|
> | [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) | **상품별 편집 모드·외부 연동 아키텍처 설계안 v2(정본)** — `template_sets.product_profile` 1개로 모드 선언(enum 무변경), 시트/면 모델·worker `sheet-map`(§6), 파트너 서버 2회 호출 런처(§8.1), 운영 콘솔(§9), 로드맵(§11), 오너 결정(§13) | master 수록(머리말 2026-10-17: P0 완료·배포 `19f1ce7c`) · §11 P1 완료 표기·§13 상태 줄 포함 master 수록(2026-10-21 병합) |
> | [`CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`](./CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md) | 캘린더 P1 개발 계획 — 출발점·범위·서브웨이브·완료 기준·위험·검증 기준선 | **P1 완료·운영 반영 2026-10-18**(master `af900212`) · 상태 머리말 master 수록(2026-10-21 병합) · 운영 샘플 7종 등록은 오너 보류 · 후속 기능 계획 `CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md` |
> | [`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`](./CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md) | **캘린더 편집기 기능 확장 계획(CTO, 2026-10-22 작성)** — §0 10-16~10-21 현황 통합(P0·P1·P2-a~d·D11~D13 커밋/운영 반영) · §1 캘린더 기능 인벤토리(설계 C1~C12 대비 ✅/🟡/❌/❔) · §2 백로그 B1~B8 · §3 서브에이전트 병렬 트랙 T1~T6(배타적 파일 소유권·역할·완료 기준) · §4 wave · §5 오너 결정 D1~D7 · §6 위험 · §7 검증 기준선 | master · 오너 결정 D1~D7 대기 |
> | [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) | **P2 개발 계획·상태** — P2-a 시트 맵 기반 · P2-b 런처 · P2-c `sheet-map` 워커 모드(구현 완료·로컬 e2e 통과) · P2-d 사진인화 · P2-e 운영자 콘솔(미착수) · §7 e2e 에서 드러난 기존 결함 | **P2-a~d 운영 반영 2026-10-21**(master `11383962` = `f43cb99e`·`9be4c37c`·`237e6b91`·`11383962`) · P2-e 미착수 · §7.1 결함 D1~D13 수정 |
> | [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) | 동결 계약 **v1.25** — v1.21 낱장 검증·duplex-split 쪽수 원천 · v1.22 P1 캘린더 `productProfile`·`product`·`metadata.calendar` · v1.23 P2-b 런처 3라우트·웹훅 `revision`·`GET /files/:id/external` · v1.24 P2-c `sheet-map` 모드 · v1.25 P2-d 사진인화(`photo-print` 프로파일·`items`) | v1.21 운영 2026-10-17 · v1.22 운영 2026-10-18 · **v1.23~v1.25 운영 2026-10-21**(master `11383962`) |
> | [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 「P1 캘린더 운영 반영 절차」(2026-10-18 00:46~00:48 KST 반영 기록) · 「P2-b 런처(파트너 v1 `sessions`)·합성 파일 메타 조회 배포 절차」 · 「P2-c 시트 맵 출력(worker `sheet-map` 모드) 배포 절차」 · 「P2-d 사진인화 배포 절차」(절 끝 「반영 기록」) · 「5. 로컬 기동 시 알아둘 점(2026-10-17)」 | 전부 master — **P2-a~d 2026-10-21 15:55~16:00 KST 반영 완료**(롤백 태그 `rollback-pre-p2abcd-20261021`, `.env.bak-20261021-p2`) |
> | [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) 부록 D | 캘린더 상품 템플릿셋 등록(P1) — 상품 7종 `editorType`·26캔버스·프로파일 JSON·날짜 그리드·화면 전용 오버레이·호스트 연동 요점·샘플 일괄 등록 스크립트 | master 수록 · 운영 샘플 세트 등록은 미실행(오너 보류) |
>
> 런처(§8.1) 파트너 가이드 절은 아직 [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md)에 없다 — 초안은 저장소 밖 비공개 노트(`_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md` 「가이드 초안 — 런처(§8.1) 절」, 미추적)에 있고 오너 dirty 해소 후 반영 예정. 라이브 상태 SSOT 는 `.cursor/plans/RESUME_PROMPT_2026-10-04.md` §2·§5.2.8.

> **갱신**: 2026-10-19 · 색인 누락 문서 등재(상품별 편집 모드 트랙 · `partner-notices/` 17건 · 런북·설계안·핸드오프 · 템플릿 등록 매뉴얼) + 주요 항목에 "운영 반영 / 브랜치" 상태 표기. 기존 항목은 유지(갱신만).
> **갱신**: 2026-06-17 · 멀티테넌시 P1(인증/테넌트 기반)+P2a(site_id 12테이블) 프로덕션 게이트 실행완료·LIVE / admin 비밀번호 변경 기능 / Vercel 배포 파이프라인 복구 (격리는 아직 비활성 = 동작 불변·비파괴)
> **HTML 가이드 통합**: `Storige_개발가이드.html`, `WORKER_FLOW_시각화.html` 가 docs/ 로 합류 (이전엔 부모 디렉토리)

📊 **시작점**: [`MASTER_STATUS_2026-06-17.md`](./MASTER_STATUS_2026-06-17.md) (최신)
🏗 **시각 가이드**: [`Storige_개발가이드.html`](./Storige_개발가이드.html) (사이드바 네비, 에디터 UX 사이클 반영)
🗓️ **최근 트랙(상품별 편집 모드) 시작점**: [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) (master, 2026-10-21 운영 반영) → 캘린더 후속 [`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`](./CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md) → 설계 정본 [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) → 운영 반영 기록 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 「P1 캘린더 운영 반영 절차」·「P2-d 사진인화 배포 절차」 절 끝 「반영 기록」

---

## ⭐ 1. 마스터 트래커 (현재 활성)

| 문서 | 형식 | 설명 |
|------|------|------|
| [`MASTER_STATUS_2026-06-17.md`](./MASTER_STATUS_2026-06-17.md) | MD | **최신** — 멀티테넌시 P1+P2a 프로덕션 게이트 실행완료(LIVE·격리 비활성)·admin 비밀번호 변경 기능·Vercel 배포 파이프라인 복구 |
| [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) | MD | **최신 활성 계획(2026-10-18~21)** — 상품별 편집 모드 P2 서브웨이브 상태표(P2-a/b/c/d 구현·로컬 e2e 통과·2026-10-21 운영 반영, P2-e 운영자 콘솔 미착수, §8.3 어댑터 순서 jumbocard → insta_print → Frameshop → 100p)·완료 기준·검증 기준선·위험·§7 결함 기록(D1~D13) — **master 수록·운영 반영 2026-10-21(master `11383962`)** |
| [`NEXT_ISSUES_2026-06-17.md`](./NEXT_ISSUES_2026-06-17.md) | MD | 다음 개발 이슈 — P2b 조회격리(회귀주의)·P3 admin UI·P4 편집기 런타임·P5 워커 공정성·P6 운영·오너 대기(키 cutover/히스토리 정화/DB 회전)·PDF 업로드 검증 Tier0 |
| [`NEXT_ISSUES_2026-06-23.md`](./NEXT_ISSUES_2026-06-23.md) | MD | 2026-06-23 잔여 게이트 배치(ⓐ~ⓕ) 처리 후 미완·게이트·후속 항목 — 머리말 기준 배포 완료분(ⓐ compress·ⓓ WH-001·ⓕ SEC-005·ⓔ 합성멱등·ⓑ AUTH stage1) LIVE |
| [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) | MD | 편집기 UX·관리자 모드 분리 (7건 커밋) |
| [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md) | MD | 멀티사이트 플랫폼화 완료, 98% 진척 |
| [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md) | MD | 스냅샷 (2026-05-04) |
| [`MASTER_STATUS_2026-05-04.html`](./MASTER_STATUS_2026-05-04.html) | HTML | 시각화 (구 버전) |
| [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) | MD | 향후 인프라 + Phase A/B/C 완료 + 후속 작업 |

---

## 🤝 2. 외부 사이트 연동 가이드

### ⭐ 정본 (여기만 보면 됩니다)
| 문서 | 형식 | 설명 |
|------|------|------|
| [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) | MD | **외부 파트너 연동 정본(운영)** — §0 연동 유형 3종 결정 매트릭스 · §1 공통 기반(인증·Base URL·파일 한도·보안·에러/레이트리밋·§1.7 Partner API v1 공통 계약) · §2 유형 1(자체 편집기+오프로드) · §3 유형 2(편집기 임베드) · §4 유형 3(제안/미구현) · §5 레퍼런스 · 최종 갱신 2026-10-14(작업 응답 14개 키, 산출물 회수 `output-url` 재발급) · **P2-b 런처(`/api/v1/sessions/*`) 절은 미반영**(초안은 비공개 노트, 오너 dirty 해소 후) |
| [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) | MD | 파트너 대면 표면의 **동결 계약** — 변경 시 파트너 파손을 유발하는 항목. 현재 **v1.25**(master): v1.21 낱장 검증·duplex-split 쪽수 원천(운영 배포 2026-10-17, 사후 등재) · v1.22 P1 캘린더 §1-D ADDITIVE 3건 + 보강 `orderOptions.coverSpine='none'`(운영 2026-10-18) · v1.23 P2-b 런처 3라우트·웹훅 `revision?`·`GET /files/:id/external`·킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED` · v1.24 P2-c worker mode `sheet-map`·`SHEET_MAP_OUTPUT_ENABLED` · v1.25 P2-d 사진인화(`photo-print` 프로파일·완료 `items`·deliverables `items`·`metadata.productProfile` 서버 소유) — **v1.23~v1.25 운영 반영 2026-10-21 16:00 KST** |
| [`PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md`](./PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md) | MD | Partner Platform API v1(`/api/v1/*`) 설계서 — Stage 0 산출(작성 2026-07-15, 오너 D-2 승인 2026-07-14), Stage 1~6 구현의 명세 정본 |
| [`WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md`](./WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md) | MD | 웹훅 서명 3종 대조표(Phase 0 정본, file:line 실증) — 실행형 정본은 `apps/api/src/webhook/webhook-signature-pairwise.spec.ts` |
| [`PARTNER_NOTICE_2026-08-13_compose_mixed.md`](./PARTNER_NOTICE_2026-08-13_compose_mixed.md) | MD | 합성 API(compose-mixed) 계약 변경 안내(2026-08-13) — 발송 시점 프로덕션 호출 이력 0건, 즉시 조치 없음 |

### 📨 파트너 통지·회신 (`partner-notices/`, 시간역순 — 목록만)
| 문서 | 수신 | 요지 |
|------|------|------|
| [`PARTNER_NOTICE_REEDIT_TEMPLATESET_2026-10-06.md`](./partner-notices/PARTNER_NOTICE_REEDIT_TEMPLATESET_2026-10-06.md) | bookmoa·printy(ACK) / ShareSnap·MD2Books(통지) / 100p(참고) | 재편집 템플릿셋 결정 변경 · 완료 이벤트 `templateSetId` 추가(FREEZE v1.16) |
| [`PARTNER_NOTICE_STORYBOOK_WRAP_2026-10-06.md`](./partner-notices/PARTNER_NOTICE_STORYBOOK_WRAP_2026-10-06.md) | bookmoa·printy | 동화책 하드커버 새 템플릿셋(양장 싸바리) — 표지 PDF 496×276 → 484×258mm(전환 전 사전 통지) |
| [`PARTNER_NOTICE_WAVE5_2026-10-05.md`](./partner-notices/PARTNER_NOTICE_WAVE5_2026-10-05.md) | bookmoa·printy | 2026-10-05 배포 — `/embed` 쪽수 범위가 제본 최소·최대 쪽수를 대신함 |
| [`PARTNER_NOTICE_WAVE4_2026-10-05.md`](./partner-notices/PARTNER_NOTICE_WAVE4_2026-10-05.md) | bookmoa·printy | 2026-10-05 배포 — 합성 입력 오류 즉시 실패 · 합성 실패 응답 `errorCode`·안내 문구 · 보정 결과 `outputFileId` 유지 |
| [`PARTNER_NOTICE_WAVE3_2026-10-03.md`](./partner-notices/PARTNER_NOTICE_WAVE3_2026-10-03.md) | bookmoa·printy | 2026-10-03 배포 — 작업 상태 고정 · 합성 자동 재시도 · 편집기 상태 응답 쪽수 · 안내 문구 · 작업 편집 세션 id |
| [`PARTNER_NOTICE_WAVE2_2026-10-03.md`](./partner-notices/PARTNER_NOTICE_WAVE2_2026-10-03.md) | bookmoa·printy·100p Books | 2026-10-03 배포 — 편집기 오류 안내 · 합성 내지 산출 크기 · 운영자 감사 기록 · 작업 실패 코드 · 대용량 업로드 사이트 귀속 |
| [`PARTNER_NOTICE_ORDER_LINKED_STAFF_ACTIONS_2026-09-30.md`](./partner-notices/PARTNER_NOTICE_ORDER_LINKED_STAFF_ACTIONS_2026-09-30.md) | bookmoa·printy(+100p 참고) | 주문 연결 세션의 Storige 관리자 작업 — 운영 원칙과 관리 화면 안전장치 |
| [`PARTNER_NOTICE_OUTPUT_CUTOVER_DONE_2026-09-11.md`](./partner-notices/PARTNER_NOTICE_OUTPUT_CUTOVER_DONE_2026-09-11.md) | printy·bookmoa | 산출물 무인증 경로 폐쇄(D5 cutover) 실행 완료 |
| [`PARTNER_NOTICE_BOOKMOA_JOB_OUTPUT_401_2026-09-11.md`](./partner-notices/PARTNER_NOTICE_BOOKMOA_JOB_OUTPUT_401_2026-09-11.md) | bookmoa | [긴급 확인 요청] 합성 산출물 다운로드가 파트너 사용 불가 라우트를 호출 중 |
| [`PARTNER_NOTICE_OUTPUT_SIGNED_URL_2026-08-28.md`](./partner-notices/PARTNER_NOTICE_OUTPUT_SIGNED_URL_2026-08-28.md) | printy·bookmoa | 합성 산출물 서명 URL + 업로드 테넌트 귀속(2026-08-28 반영, additive·무중단) |
| [`PARTNER_ANSWER_PRINTY_UPLOAD_TENANCY_2026-08-27.md`](./partner-notices/PARTNER_ANSWER_PRINTY_UPLOAD_TENANCY_2026-08-27.md) | printy | 회신 — presigned 업로드 테넌시 · 산출물 회수 경로(2026-10-06 후속 고지 포함) |
| [`PARTNER_ANSWER_PRINTY_TEMPLATE_SET_SCOPE_2026-08-26.md`](./partner-notices/PARTNER_ANSWER_PRINTY_TEMPLATE_SET_SCOPE_2026-08-26.md) | printy | 회신 — 템플릿셋 테넌트 스코프 질의 3건(프로덕션 DB 실조회 근거) |
| [`PARTNER_ANSWER_BOOKMOA_NEW_DOMAIN_2026-08-26.md`](./partner-notices/PARTNER_ANSWER_BOOKMOA_NEW_DOMAIN_2026-08-26.md) | bookmoa | 회신 — new.bookmoa.com 베타 전환 체크 3건 |
| [`PARTNER_NOTICE_100PBOOKS_2026-08-24.md`](./partner-notices/PARTNER_NOTICE_100PBOOKS_2026-08-24.md) | 100p Books | 2026-08-23 프로덕션 반영 연동 변경 안내(무중단) |
| [`PARTNER_NOTICE_BOOKMOA_MOBILE_2026-08-24.md`](./partner-notices/PARTNER_NOTICE_BOOKMOA_MOBILE_2026-08-24.md) | bookmoa-mobile | 2026-08-23 프로덕션 반영 연동 변경 안내(무중단) |
| [`PARTNER_NOTICE_MD2BOOKS_2026-08-24.md`](./partner-notices/PARTNER_NOTICE_MD2BOOKS_2026-08-24.md) | MD2Books | 2026-08-23 프로덕션 반영 연동 변경 안내(무중단) |
| [`PARTNER_NOTICE_SHARESNAP_2026-08-24.md`](./partner-notices/PARTNER_NOTICE_SHARESNAP_2026-08-24.md) | ShareSnap | 2026-08-23 프로덕션 반영 연동 변경 안내(무중단) |

### ⛔ 폐기 (deprecated — 이력 보존용, 신규 연동 금지)
| 문서 | 형식 | 폐기 사유 |
|------|------|------|
| [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) | MD | 프로덕션 계약 불일치. **§5-3 웹훅 서명 의사코드가 오기**(그대로 구현하면 검증 100% 실패) — 해당 위치에 정정 주석 인라인 |
| [`PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md`](./PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md) | MD | 위 폐기 문서를 첨부하도록 지시하는 AI 프롬프트. **입력 금지** |
| [`PLATFORM_INTEGRATION_v1.md`](./PLATFORM_INTEGRATION_v1.md) | MD | 2026-05-16 레거시 표면 스냅샷. 여기의 "v1" 은 Partner API v1(`/api/v1/*`)이 **아님** |

### PHP 한정 (편집기 UI 포함)
| 문서 | 형식 | 설명 |
|------|------|------|
| [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md) | MD | PHP 팀 전달용 최종 가이드 v3.1 (멀티사이트 안내 포함) |
| [`PHP_INTEGRATION_FINAL_v3.html`](./PHP_INTEGRATION_FINAL_v3.html) | HTML | 시각화 (사이드바 네비, 코드 하이라이트) |
| [`PHP_INTEGRATION_VERIFICATION.md`](./PHP_INTEGRATION_VERIFICATION.md) | MD | 13 체크리스트 (v3로 흡수, 참조용) |
| [`PHP_INTEGRATION_VERIFICATION.html`](./PHP_INTEGRATION_VERIFICATION.html) | HTML | (참조용) |
| [`PHP_INTEGRATION_KICKOFF_2026-05-04.md`](./PHP_INTEGRATION_KICKOFF_2026-05-04.md) | MD | 킥오프 문서 (v3로 흡수) |
| [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.md`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) | MD | 보안 패치 A-E PHP 통보 |
| [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.html`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.html) | HTML | 시각화 |
| [`BOOKMOA_INTEGRATION_GUIDE.md`](./BOOKMOA_INTEGRATION_GUIDE.md) | MD | ⛔ **폐기** — bookmoa 옵션 B/C 가이드. 특정 파트너 1곳의 초기 메모라 플랫폼 계약이 아님 |
| [`BOOKMOA_INTEGRATION_DIFF.md`](./BOOKMOA_INTEGRATION_DIFF.md) | MD | bookmoa 변경점 정리 |
| [`bookmoa_integration_diff.html`](./bookmoa_integration_diff.html) | HTML | 시각화 |
| [`PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`](./PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md) | MD | PHP 연동 통보 v1.0(2026-05-19) — 인쇄 워크플로우 v1(PDF 첨부/면지/게스트/compose-mixed/마이페이지) |
| [`PHASE_0_CONTRACT_DECISIONS_2026-05-16.md`](./PHASE_0_CONTRACT_DECISIONS_2026-05-16.md) | MD | 외부사이트 플랫폼 연동 표준 계약 결정(Bookmoa Platform Plan Phase 0, 2026-05-16) |
| [`PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md`](./PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md) | MD | Phase 1-1(sites 마이그레이션)·1-2(CORS/CSP/Webhook 동적 정책) 후 bookmoa PHP 회귀 보호 체크리스트 |
| [`BOOKMOA_MOBILE_PRESIGNED_UPLOAD_DROPIN_2026-06-19.md`](./BOOKMOA_MOBILE_PRESIGNED_UPLOAD_DROPIN_2026-06-19.md) | MD | bookmoa-mobile 주문화면 대용량 PDF presigned 직결 업로드 지시문 + drop-in — 머리말 기준 Storige 백엔드 라이브 + 실 R2 E2E 검증 완료 |
| [`LARGE_FILE_UPLOAD_1GB_HANDOFF_2026-06-18.md`](./LARGE_FILE_UPLOAD_1GB_HANDOFF_2026-06-18.md) | MD | 대용량(1GB+) 고객 PDF 업로드 — bookmoa-mobile 핸드오프(작성 시점: 설계 확정 + 오너 게이트 대기, §7 제안 인터페이스 미구현) |
| [`php연동가이드/`](./php연동가이드/PHP_INTEGRATION_FINAL_v3.md) · `php연동가이드.zip` | MD/HTML/ZIP | PHP 팀 전달 패키지 사본(`PHP_INTEGRATION_FINAL_v3` md/html · `SECURITY_PATCH_PHP_NOTICE_2026-05-03.html` · `SYSTEM_INTEGRATION_OVERVIEW.html`; zip 은 같은 4파일) — 루트 문서와 내용 차이 있음, 정본은 루트 `PHP_INTEGRATION_FINAL_v3.md` |

---

## 🏗️ 3. 시스템 설계

| 문서 | 설명 |
|------|------|
| [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) | 시스템 통합 개요 (v2.6 — 스프레드 책 인쇄 무결성 + 분리 2파일) |
| [`SYSTEM_INTEGRATION_OVERVIEW.html`](./SYSTEM_INTEGRATION_OVERVIEW.html) | 시각화 |
| [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) | 전체 아키텍처 명세 |
| [`PRD.md`](./PRD.md) | 제품 요구사항 |
| [`04_DATABASE_ERD.md`](./04_DATABASE_ERD.md) | DB ERD |
| [`01_SYSTEM_ARCHITECTURE_KR.md`](./01_SYSTEM_ARCHITECTURE_KR.md) | 시스템 아키텍처 (KR) |
| [`02_SOFTWARE_ARCHITECTURE_KR.md`](./02_SOFTWARE_ARCHITECTURE_KR.md) | SW 아키텍처 (KR) |
| [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) | **상품별 편집 모드·외부 연동 아키텍처 설계안 v2(정본, 2026-10-16)** — `product_profile` 데이터 속성 1개·enum 무변경·`sheet-map`·런처·운영 콘솔·로드맵 §11·오너 결정 §13 (master 수록; P1 완료 표기·§13 [상태] 갱신은 브랜치) |
| [`FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md`](./FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md) | 파일↔주문 결속 API 설계안 v1.1 완결본(기준일 2026-09-24, file:line 근거) — 설계 문서 |
| [`FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md`](./FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md) | 파일 생명주기 무결성 설계(실주문 무손실 + 고아 누적 방어, 2026-06-19) — 2026-09-21 정정: §4 S1·S5 방지책은 이후 구현되어 해소 |

---

## 🚀 4. 운영 / 배포 / 모니터링

| 문서 | 설명 |
|------|------|
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | **배포 가이드(운영 정본)** — Docker 컨테이너 11+1·env·배포 후 플래그 기동 스냅샷(`[FLAGS]`/`[FLAGS-CHECK]`)·킬스위치 compose 매핑·rembg 사이드카·Wave 2~8 배포 기록(2026-10-03~10-08)·낱장 N장 PDF 배포(2026-10-17)·**「P1 캘린더 운영 반영 절차」(2026-10-18 00:46~00:48 KST 반영 완료, master `af900212`, 롤백 태그 `rollback-pre-calendar-20261018`)**·**「P2-b 런처…배포 절차」·「P2-c 시트 맵 출력…배포 절차」·「P2-d 사진인화 배포 절차」(2026-10-21 15:55~16:00 KST 반영 완료 — master `11383962`, FLAGS 16·17번째 키 `PARTNER_SESSION_LAUNCH_ENABLED`·`SHEET_MAP_OUTPUT_ENABLED`, 롤백 태그 `rollback-pre-p2abcd-20261021`, 「P2-d」 절 끝 「반영 기록」)**·「5. 로컬 기동 시 알아둘 점(2026-10-17)」(compose 서비스 `mariadb`·pino-pretty 폴백·worker env·bookmoa 연동 끄기·Node 버전) |
| [`OPERATIONS.md`](./OPERATIONS.md) | 운영 매뉴얼 |
| [`P0_OPERATIONS_CHECKLIST.md`](./P0_OPERATIONS_CHECKLIST.md) | P0 운영 체크리스트 |
| [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) | Sentry 초기 설정 |
| [`SENTRY_SLACK_SETUP.md`](./SENTRY_SLACK_SETUP.md) | Sentry Slack 연결 (사용자 OAuth 대기) |
| [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](./P2_8_METRICS_DASHBOARD_2026-05-04.md) | Grafana + Prometheus 운영 메트릭 |
| [`P2_10_LOG_AGGREGATION_2026-05-04.md`](./P2_10_LOG_AGGREGATION_2026-05-04.md) | Loki 로그 일원화 |
| [`MARIADB_MIGRATION.md`](./MARIADB_MIGRATION.md) | MariaDB 마이그레이션 |
| [`SETUP.md`](./SETUP.md) | 초기 셋업 |
| [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) | 빠른 참조 |
| [`STORAGE_R2_RUNBOOK.md`](./STORAGE_R2_RUNBOOK.md) | 저장계층 객체스토리지(R2) 보강 + 보존정책 운영 런북(2026-06-13) |
| [`LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md`](./LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md) | 끝단 2GB 파일 보장 — 병목 분석(워커·API서빙·편집기·VPS) + 달성 방법(P2 계획) |
| [`NEXT_ISSUES_2026-06-23.md`](./NEXT_ISSUES_2026-06-23.md) | 2026-06-23 잔여 게이트 배치 후 미완·게이트·후속 항목(배포 완료분은 머리말 기준 LIVE) |

---

## 🔒 5. 보안

| 문서 | 설명 |
|------|------|
| [`USER_IDENTITY_AUDIT_2026-05-03.md`](./USER_IDENTITY_AUDIT_2026-05-03.md) | 사용자 식별 / 주문 추적 감사 |
| [`INTEGRATION_AUDIT_2026-05-03.md`](./INTEGRATION_AUDIT_2026-05-03.md) | 통합 검증 audit (결함 9건) |
| [`SECURITY_ROTATION_RUNBOOK_2026-06-13.md`](./SECURITY_ROTATION_RUNBOOK_2026-06-13.md) | 보안 시크릿 회전 런북(DEP-1~4) — **절차서만, 회전 실행 금지**(bookmoa 측 키 교체 타이밍 조율 필요) |
| [`SOURCEMAP_EXPOSURE_RUNBOOK.md`](./SOURCEMAP_EXPOSURE_RUNBOOK.md) | 소스맵 공개 차단 런북(editor·admin·임베드 번들·VPS editor; 최초 2026-07-27) — 머리말 기준 오너 액션 전량 완료, hidden+업로드+삭제 LIVE(2026-07-30) |
| [`FABRIC7_JSPDF3_MIGRATION_SPIKE_2026-06-13.md`](./FABRIC7_JSPDF3_MIGRATION_SPIKE_2026-06-13.md) | fabric 5.5.2→7.x / jspdf 2.5.x→3.x 마이그레이션 스파이크 — 보안 감사 DEP-7(fabric `<7.2.0` SVG Export XSS, CVE-2026-27013) |

---

## 📊 6. 사이클 보고서 (시간역순)

### 🆕 2026-10-16 ~ 10-21 — 상품별 편집 모드: 캘린더 P1 운영 반영(master `af900212`) · P2-a/b/c/d + D11~D13 운영 반영(master `11383962`, 2026-10-21)
| 문서 | 설명 | 운영 반영 / 브랜치 |
|------|------|------|
| [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) | **사이클 정본 설계** — §0 결론(프로파일 1개·enum 무변경·N페이지 단일 PDF 기본·`sheet-map` 1 mode·파트너 2회 호출·콘솔 1개 역할 2개) · §2 ProductProfile 모델 · §3 상품별 매핑 · §6 시트/면 모델·worker · §8 외부 연동(런처·SDK·서비스별) · §9 운영자 워크스페이스 · §10 P0 결함 · §11 로드맵 · §13 오너 결정 | master 수록(머리말 2026-10-17: P0 완료·배포 `19f1ce7c`) · §11 P1 "완료·운영 반영" 표기·§13 상태 줄(2026-10-18) 갱신분은 브랜치 전용 |
| [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md) | 1차 캘린더 단일 범위 설계안(참조 편집기 관찰 + REA 정적 분석) — 같은 날 v2 설계안으로 대체, §1 관찰 기록·§3 CalendarPlugin 세부만 유효 | master 수록 · 설계 제안(코드 변경 없음) |
| [`CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`](./CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md) | P1 개발 계획 — 출발점(P0 운영 배포 `19f1ce7c`) · 범위(프로파일·페이지 정책·CalendarPlugin·캘린더 패널·오버레이 규약·세션 스냅샷·검증 연동·샘플 세트) · 서브웨이브·완료 기준 · 결정 · 위험 · 검증 기준선 | **P1 완료·운영 반영 2026-10-18**(master `af900212`: 마이그레이션 `20261017_add_template_set_product_profile.sql`·api·worker·Vercel editor/admin, 완료 PDF 워커 경고 0 — 도련 정책 A) · 상태 머리말(2026-10-18)은 브랜치 전용 · 운영 샘플 7종 등록 오너 보류 |
| [`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md`](./CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.md) | **캘린더 편집기 기능 확장 계획**(2026-10-22) — 현황 통합·기능 인벤토리·백로그·서브에이전트 병렬 트랙·오너 결정 | master · 오너 결정 대기 |
| [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) | **P2 계획·상태** — §0 출발점(P2 순서 런처 → sheet-map → 사진인화) · §1 서브웨이브: P2-a 시트 맵 기반(`buildSheetMap`·골든 16) / P2-b 런처(`POST /api/v1/sessions/launch`·`GET …/deliverables`·`POST …/synthesize`, SDK `client.sessions`) / P2-c worker `mode:'sheet-map'`(per-sheet·merged-duplex, 13시트 골든, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`) / P2-d 사진인화·P2-e 운영자 콘솔(미착수) · §3 완료 기준 · §4 검증 기준선 · §5 위험 · §7 e2e 에서 드러난 기존 결함(duplex-split `request_id` 86자, 워커 파일 메타 401) | **P2-a~d 운영 반영 2026-10-21**(master `11383962` — `f43cb99e`·`9be4c37c`·`237e6b91`·`11383962`) · P2-e 미착수 · §7.1 로컬 e2e 결함 D1~D13 수정 |
| [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) v1.21~v1.24 | v1.21(2026-10-16~17) §1-B MODIFY-TARGET 3건(duplex-split 기대 쪽수 원천·낱장 세션 `productKind='sheet'`·post_process CMYK 규칙 기본 해제) + ADDITIVE `orderOptions.productKind/pageStep/postProcessColorRule` · v1.22(2026-10-17) §1-D ADDITIVE 3건(`templateSet.productProfile`·`editor.complete` `product`·세션 `metadata.productProfile/calendar`) + 보강 `orderOptions.coverSpine='none'` · v1.23(2026-10-18) §1-D 런처 3라우트·웹훅 `revision?`·§1-B `GET /files/:id/external`·ErrV1 29→31·`PARTNER_SESSION_LAUNCH_ENABLED` · v1.24(2026-10-18) §1-B worker mode `sheet-map`·§1-D synthesize sheet-map 재합성·deliverables `sheets?` | v1.21 운영 배포 2026-10-17(사후 등재) · v1.22 운영 2026-10-18 · **master 는 v1.22** · v1.23·v1.24 브랜치 전용(적용 시점 = 배포 통지 시각, 미정) |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 「P1 캘린더 운영 반영 절차」 — 변경 요약·순서·**반영 기록**(2026-10-18 00:40~00:48 KST: master `a98d0219` → `af900212` fast-forward 5커밋, 마이그레이션 적용, api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`, Vercel editor/admin Ready, 롤백 태그 `rollback-pre-calendar-20261018`, 샘플 세트 등록 미실행) · 「P2-b 런처(파트너 v1 `sessions`)·합성 파일 메타 조회 배포 절차」(FLAGS 16번째 키 `PARTNER_SESSION_LAUNCH_ENABLED`) · 「P2-c 시트 맵 출력(worker `sheet-map` 모드) 배포 절차」(worker 먼저, FLAGS 17번째 키 `SHEET_MAP_OUTPUT_ENABLED`, 로컬 실측 2026-10-19) · 「5. 로컬 기동 시 알아둘 점(2026-10-17)」 | P1 절 master · P2-b/P2-c 절 브랜치 전용 — **2026-10-18 준비, 미실행(오너 승인 후)** |
| [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) 부록 D | 캘린더 상품 템플릿셋 등록(P1, 2026-10-17) — D-1 상품 7종(`calendar_desk_large/basic/tiny/mini`·`calendar_wall1_a3`·`calendar_wall2_a4/a3`, 26캔버스) · D-2 프로파일 JSON 섹션(프리셋·`cropMarkEnabled`·`bleedMm 3` 도련 정책) · D-3 템플릿 4개로 26캔버스 · D-4 날짜 그리드(`extensionType:'calendar-grid'`) · D-5 화면 전용 오버레이 · D-6 호스트 연동 요점 · D-7 샘플 일괄 등록 `scripts/register-calendar-samples.mjs` · D-8 날짜 데이터 갱신 | master 수록 · 운영 샘플 등록 미실행(오너 보류) |
| [`../.cursor/plans/CALENDAR_MODE_SESSION_START_PROMPT_2026-10-17.md`](../.cursor/plans/CALENDAR_MODE_SESSION_START_PROMPT_2026-10-17.md) | P1 새 세션 시작 프롬프트 | 로컬·미커밋 |
| [`../.cursor/plans/RESUME_PROMPT_2026-10-04.md`](../.cursor/plans/RESUME_PROMPT_2026-10-04.md) | 라이브 상태 SSOT(§2·§5.2.8) | master 추적(2026-10-21 갱신) |
| `_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md` | 오너 결정·정찰·로컬 e2e 실측·운영 반영 기록·P2 착수·**런처(§8.1) 파트너 가이드 초안** — 저장소 상위 폴더 | 비공개·미추적(읽기 전용) |

### 2026-09-24 ~ 09-30 — 파일↔주문 결속 API 설계 · Wave 1~5 개요 · 첨부 PDF 빈 페이지 채움
| 문서 | 설명 |
|------|------|
| [`FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md`](./FILE_ORDER_BINDING_API_DESIGN_2026-09-24.md) | 파일↔주문 결속 API 설계안 v1.1 완결본(기준일 2026-09-24, file:line 근거 표기) |
| [`WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html`](./WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html) | Storige Wave 1~5 개요(시각화) — Wave 배포 기록은 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 2026-10-03~10-08 절, 파트너 통지는 §2 목록 |
| [`ATTACH_PDF_PAGE_PAD_2026-09-28.html`](./ATTACH_PDF_PAGE_PAD_2026-09-28.html) | 첨부 PDF 빈 페이지 채움(시각화) |

### 2026-07-03 ~ 08-13 — Partner API v1 설계 · 웹훅 서명 대조 · 에디터 UX E트랙 · 하드커버 표지 결정 · 소스맵 런북 · 템플릿 용어 정본 · 표지 UX 감사
| 문서 | 설명 |
|------|------|
| [`WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md`](./WEBHOOK_SIGNATURE_MATRIX_2026-07-03.md) | 웹훅 서명 3종 대조표(Phase 0 정본) — 실행형 정본 `webhook-signature-pairwise.spec.ts` 와 함께 갱신 |
| [`PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md`](./PARTNER_PLATFORM_API_V1_DESIGN_2026-07-07.md) | Partner Platform API v1 설계서(Stage 0 산출, 작성 2026-07-15) — Stage 1~6 구현 명세 정본 |
| [`HARDCOVER_COVER_VALIDATION_NOTES.md`](./HARDCOVER_COVER_VALIDATION_NOTES.md) | 하드커버 표지 사이즈·검증 기준 메모(오너 결정 2026-07-13) — 결정 기록 + 후속 트랙 스코프 |
| [`EDITOR_UX_DESIGN_2026-07-14.md`](./EDITOR_UX_DESIGN_2026-07-14.md) | 에디터 UX 설계서 — Stage E1 컨트롤 코어(스마트 가이드·변형 피드백·객체 액션 바·균등 분배·안전영역 경고)의 정본 |
| [`SOURCEMAP_EXPOSURE_RUNBOOK.md`](./SOURCEMAP_EXPOSURE_RUNBOOK.md) | 소스맵 공개 차단 런북(2026-07-27) — 머리말 기준 오너 액션 전량 완료·LIVE(2026-07-30) |
| [`PRINT_TEMPLATE_GLOSSARY.md`](./PRINT_TEMPLATE_GLOSSARY.md) | 인쇄 템플릿 용어 정본(2026-08-13) — Admin·제작 가이드·코드 주석의 한글 이름 통일(식별자 불변) |
| [`COVER_TEMPLATE_UX_AUDIT_2026-08-13.html`](./COVER_TEMPLATE_UX_AUDIT_2026-08-13.html) | 표지·낱장 템플릿 UX 감사 — Canva / Blurb / Moo 대조(시각화) |
| [`PARTNER_NOTICE_2026-08-13_compose_mixed.md`](./PARTNER_NOTICE_2026-08-13_compose_mixed.md) | compose-mixed 계약 변경 안내 — 발송 시점 프로덕션 호출 이력 0건 |

### 2026-06-13 ~ 06-23 — 대용량 업로드(1GB/2GB) · 파일 생명주기 · R2 런북 · 보안 회전 · fabric7 스파이크 · 에셋 라이브러리 제안 · 템플릿 등록 매뉴얼
| 문서 | 설명 |
|------|------|
| [`NEXT_ISSUES_2026-06-23.md`](./NEXT_ISSUES_2026-06-23.md) | 2026-06-23 잔여 게이트 배치(ⓐ~ⓕ) 처리 후 미완·게이트·후속 — 배포 완료분(compress·WH-001·SEC-005·합성멱등·AUTH stage1) LIVE |
| [`FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md`](./FILE_LIFECYCLE_INTEGRITY_DESIGN_2026-06-19.md) | 파일 생명주기 무결성 설계(실주문 무손실 + 고아 누적 방어) — 2026-09-21 정정: §4 S1·S5 는 이후 구현되어 해소 |
| [`LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md`](./LARGE_FILE_2GB_GUARANTEE_PLAN_2026-06-19.md) | 끝단 2GB 파일 보장 — 병목 분석 + 달성 방법(P2 계획) |
| [`BOOKMOA_MOBILE_PRESIGNED_UPLOAD_DROPIN_2026-06-19.md`](./BOOKMOA_MOBILE_PRESIGNED_UPLOAD_DROPIN_2026-06-19.md) | bookmoa-mobile 주문화면 대용량 PDF presigned 직결 업로드 지시문 + drop-in(백엔드 라이브·실 R2 E2E 검증 완료) |
| [`LARGE_FILE_UPLOAD_1GB_HANDOFF_2026-06-18.md`](./LARGE_FILE_UPLOAD_1GB_HANDOFF_2026-06-18.md) | 대용량(1GB+) 고객 PDF 업로드 — bookmoa-mobile 연동 지시문/핸드오프(작성 시점 설계 확정 + 오너 게이트 대기) |
| [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) / [`.html`](./템플릿등록%20매뉴얼.html) | Storige 템플릿 등록 매뉴얼(admin 운영자용, 갱신 2026-06-18) — ① 템플릿 등록(IDML/PSD/수기) ② 템플릿셋 ③ 객체 속성 ④ 상품 연결 + 부록 A 문제 · B 화면·코드 매핑 · C 유형 인벤토리(2026-06-23) · D 캘린더(2026-10-17) |
| [`STORAGE_R2_RUNBOOK.md`](./STORAGE_R2_RUNBOOK.md) | 저장계층 R2 보강 + 보존정책 운영 런북(2026-06-13) |
| [`SECURITY_ROTATION_RUNBOOK_2026-06-13.md`](./SECURITY_ROTATION_RUNBOOK_2026-06-13.md) | 보안 시크릿 회전 런북(DEP-1~4) — 절차서만, 회전 실행 금지 |
| [`FABRIC7_JSPDF3_MIGRATION_SPIKE_2026-06-13.md`](./FABRIC7_JSPDF3_MIGRATION_SPIKE_2026-06-13.md) | fabric 5.5.2→7.x / jspdf 2.5.x→3.x 마이그레이션 스파이크(DEP-7, CVE-2026-27013) |
| [`PROPOSAL_LIBRARY_CATEGORY_ASSETS_2026-06-13.md`](./PROPOSAL_LIBRARY_CATEGORY_ASSETS_2026-06-13.md) | 라이브러리 카테고리 에셋 로딩 + 기본 폴백 + 편집기 UX 통합 설계 제안서(코드 수정 없음, P0~P3 단계) |

### 🆕 2026-06-17 — 멀티테넌시 P1+P2a 프로덕션 게이트 실행완료(LIVE) + admin 비밀번호 변경 + Vercel 파이프라인 복구
| 문서 | 설명 |
|------|------|
| [`MASTER_STATUS_2026-06-17.md`](./MASTER_STATUS_2026-06-17.md) | **사이클 정본** — 멀티테넌시 P1(인증/테넌트 기반)+P2a(site_id 12테이블) 프로덕션 게이트 실행완료·전수검증 회귀0 · admin 비밀번호 변경 기능 LIVE · Vercel 배포 파이프라인 복구(640e3e6) · 격리는 아직 비활성(site_id 전부 NULL=시스템공유, 동작 불변·비파괴) |
| [`NEXT_ISSUES_2026-06-17.md`](./NEXT_ISSUES_2026-06-17.md) | **다음 개발 이슈** — P2b 조회격리(QueryScope 라우터 적용·회귀주의·findByProduct 전역 fallback)·P3 admin UI 멀티테넌시(테넌트 스위처·운영자 계정 CRUD)·P4 편집기 런타임(Site 메타)·P5 워커 공정성(큐 site_id·쿼터)·P6 운영(storageKey 네임스페이스·nginx /storage 인증) + 오너 대기(북모아 메인 키 cutover·히스토리 정화·bookmoa DB 회전) + 별도 트랙 PDF 업로드 검증 Tier0 |
| [`../.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md`](../.cursor/plans/MULTITENANCY_EXPANSION_DESIGN_2026-06-17.md) | 설계 정본(로컬·미커밋) — 6대 갭 분석 + P0~P6 로드맵 + User↔Site 관계 핵심 |
| [`../.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md`](../.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md) | P1+P2a 통합 배포 런북(로컬·미커밋) — §0/§4(e) 비번변경 검증 + §5 P2a 롤백 |

### 🆕 2026-06-06~07 — 표지편집 전수 감사 + 스프레드 책 인쇄 무결성(P0 완료·P1 일부)
| 문서 | 설명 |
|------|------|
| [`../.cursor/plans/COVER_EDIT_FULL_AUDIT_2026-06-06.md`](../.cursor/plans/COVER_EDIT_FULL_AUDIT_2026-06-06.md) | 표지편집 9차원 전수 감사(적대적검증) + P0/P1/P2 개선계획 + **진행 실행로그**(P0 3종·보너스 결함·B49·A13 완료) |
| [`EDITOR.md`](./EDITOR.md) §19 | 인쇄 무결성 체인 상세: 프리즈 근본수정(metadata400+unit)·스냅샷 저장·compose-mixed cover MediaBox 검증·분리2파일 강제·totalWidthMm 결함수정·B49 권위대조·A13 제본가드·woff2ToTtf + 파일 매핑 |
| [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) v2.6 / [`.html`](./SYSTEM_INTEGRATION_OVERVIEW.html) | 통합문서 v2.6 — 무결성 체인 + 분리2파일 + Bookmoa 영향(separate 강제) |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 운영 플래그 `SPREAD_SNAPSHOT_HARD_FAIL`(api+worker, SOFT→HARD) — `docker-compose.yml` api·worker 양쪽 매핑(2026-10-05), 전환 시 양쪽 재생성 + `[FLAGS]` 두 줄 확인 |
| bookmoa-mobile `docs/HANDOFF_storige_spread_integrity_2026-06-07.md` | **bookmoa 지시문** — 스프레드 책 separate 2파일 출력 대응 + order-design URL/다운로드 + (선택)검증결과 활용 |

### 🆕 2026-06-04 — 임베드 뒤로가기 무결성 + 호스트 핸드셰이크 + PDF 첨부 검증 감사
| 문서 | 설명 |
|------|------|
| [`EDITOR.md`](./EDITOR.md) §17 | 임베드 뒤로가기 데이터 무결성 가드(`useEmbedBackGuard`) + §17.1 호스트 연동 핸드셰이크(getState/saveNow/setBackGuard) |
| [`../.cursor/plans/HANDOFF_bookmoa_back_navigation_2026-06-04.md`](../.cursor/plans/HANDOFF_bookmoa_back_navigation_2026-06-04.md) | bookmoa-mobile 호스트 구현 가이드(Tier A/B + postMessage 프로토콜 + CSP frame-ancestors 주의) — e2e 검증 완료 |
| [`PDF_VALIDATION_GUIDE.md`](./PDF_VALIDATION_GUIDE.md) | **PDF 첨부 검증 항목 한눈에(에러8/경고9)** + validate 입력 계약 + 알려진 갭(책등 공식 불일치·날개 미검증) |
| [`SYSTEM_INTEGRATION_OVERVIEW.html`](./SYSTEM_INTEGRATION_OVERVIEW.html) §7 | 시각화 — PDF 첨부 검증 항목/갭 카드 |

### 2026-06-03 — 스프레드 책 편집완료 PDF 프리즈 진단 + 하드닝 (오토파일럿 2차)
| 문서 | 설명 |
|------|------|
| [`../.cursor/plans/SPREAD_PDF_FREEZE_FINDINGS_2026-06-03.md`](../.cursor/plans/SPREAD_PDF_FREEZE_FINDINGS_2026-06-03.md) | **진단·패치·설계** — cover PDF 로직 정상(로컬 0.4초 재현), 실제는 프로덕션 editor 렌더러 프리즈(환경/스케일). Patch B(워치독+Sentry 단계계측) 배포(`19158f8`). woff2ToTtf 404 + library_fonts 0행 별개 발견. C(풋프린트)/D(서버사이드 Puppeteer) 설계 |
| [`EDITOR.md`](./EDITOR.md) §16 | 편집완료 PDF 프리즈 진단·하드닝 상세 + 핵심 파일 매핑 |
| [`SYSTEM_INTEGRATION_OVERVIEW.html`](./SYSTEM_INTEGRATION_OVERVIEW.html) | 시각화 — 편집완료 PDF 생성 흐름 + 프리즈 진단 카드 반영 |

### 2026-06-03 — 템플릿·에셋 공급 + 인쇄품질 + 객체보호 (오토파일럿 1차) + 상품·템플릿 등록 매뉴얼
| 문서 | 설명 |
|------|------|
| [`PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html`](./PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html) | **🎨 상품·템플릿 등록 시각화 매뉴얼** — 에셋등록→템플릿셋→템플릿제작→상품연결→고객편집 5단계 + 최근 변경 |
| [`EDITOR.md`](./EDITOR.md) §15 | 템플릿·에셋 공급/인쇄품질/객체보호 변경 상세 (P0-1 에셋단절·P0-3 DPI·P1-5 잠금·P1-6 곡선텍스트·P0-2 PDF모드 + 파일 매핑) |
| [`../.cursor/plans/EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md`](../.cursor/plans/EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md) | 갭 분석 + **진행 상태 표**(완료/잔여) + P0-2 편집기·워커 / P1-4·P2 잔여작업 구체 계획 |

### 2026-06-02 — `/embed` 임베드 전환 + 텍스트 자유도 + 원형 텍스트 + 게스트 폴백 + autosave 핫픽스 + 합성 E2E
| 문서 | 설명 |
|------|------|
| [`../.cursor/plans/RESUME_PROMPT_2026-06-02.md`](../.cursor/plans/RESUME_PROMPT_2026-06-02.md) | **세션 핸드오프(최신)** — `/embed`(EmbeddedEditor) 전환, 이탤릭/부분색/글자크기/원형 텍스트, MEMBER_REQUIRED 게스트 폴백, pageCount 클램프, **autosave canvasData 배열 핫픽스(API 재배포)** |
| [`EDITOR.md`](./EDITOR.md) §14 | 위 편집기 기능 상세 (임베드/텍스트/원형/게스트 폴백 + 파일 매핑) |
| [`../.cursor/plans/SYNTHESIS_E2E_TEST_PLAN_2026-06-02.md`](../.cursor/plans/SYNTHESIS_E2E_TEST_PLAN_2026-06-02.md) | 합성 E2E 테스트 계획 + §10 라이브 실행결과 (검증/업로드/합성/관리자 4페이즈 통과) |
| [`INTEGRATION_WORKFLOWS.md`](./INTEGRATION_WORKFLOWS.md) · [`.html`](./INTEGRATION_WORKFLOWS.html) | 연동 워크플로우 — §3.1 /embed·memberSeqno 갱신 + 2026-06-02 변경이력 (HTML 상단 업데이트 카드) |
| [`../.cursor/plans/HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md`](../.cursor/plans/HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md) | bookmoa 측 연동 지시서 — `/embed` URL + 재편집 + dual-emit + 토큰 memberSeqno 필수(§3.5) |
| [`../.cursor/plans/HANDOFF_Storige_postMessage_standardize_2026-06-01.md`](../.cursor/plans/HANDOFF_Storige_postMessage_standardize_2026-06-01.md) | postMessage 규약 통일 (SUPERSEDED — /embed로 대체 해결) |

### 🆕 2026-05-29 — 추후 개발 로드맵 / Shopify
| 문서 | 설명 |
|------|------|
| [`ROADMAP_2026-05-29.md`](./ROADMAP_2026-05-29.md) | **추후 개발 로드맵** — v1 GA 통과 후 트랙 정리 (T1 Pilot 운영 / T2 v1 polish / T3 Shopify GO·보류 / T4·T5 v2 후보) |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.md`](./SHOPIFY_APP_PROPOSAL_2026-05-16.md) | Shopify 앱스토어 publish 계획 (v1.1, GO 결정 완료) — 시장/경쟁사/가격/로드맵 S-1~S-7 |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.html`](./SHOPIFY_APP_PROPOSAL_2026-05-16.html) | 위 제안서 시각화 |
| [`SHOPIFY_TECHNICAL_DESIGN.md`](./SHOPIFY_TECHNICAL_DESIGN.md) | Shopify 앱 기술 설계 — OAuth/Webhook/Billing/i18n/Theme Extension (S-2~S-5) |
| [`../docs2/CURSOR_ORCHESTRATION_PLAN.md`](../docs2/CURSOR_ORCHESTRATION_PLAN.md) | bookmoa-mobile 연동 Cursor 조율 협업 계획 (2026-05-20) |

### 🆕 2026-05-19 — 전략 / 핸드오프
| 문서 | 설명 |
|------|------|
| [`MODULE_PLATFORM_STRATEGY_2026-05-19.html`](./MODULE_PLATFORM_STRATEGY_2026-05-19.html) | **모듈 분기 + 플랫폼화 전략** (시각화) — 5 옵션 비교, 3-Layer 권장, Phase A~D 로드맵, 모드 A/B/C 의사결정, SaaS 운영 모델 |
| [`../.cursor/plans/RESUME_PROMPT_2026-05-19.md`](../.cursor/plans/RESUME_PROMPT_2026-05-19.md) | 세션 핸드오프 — 5/15~19 fix 8건 + 인쇄 워크플로우 v1 컨펌 대기 |

### 2026-05-16 ~ 05-19 — Phase 0 계약 결정 · PHP 회귀 체크리스트 · 마이그레이션 현황 · 인쇄 워크플로우 v1 통보
| 문서 | 설명 |
|------|------|
| [`PHASE_0_CONTRACT_DECISIONS_2026-05-16.md`](./PHASE_0_CONTRACT_DECISIONS_2026-05-16.md) | 외부사이트 플랫폼 연동 표준 계약 결정(Bookmoa Platform Plan Phase 0 결과물) |
| [`PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md`](./PHASE_2_PHP_REGRESSION_CHECKLIST_2026-05-16.md) | Phase 1-1·1-2 변경 후 bookmoa PHP 회귀 보호 체크리스트 |
| [`Migration_status_20260516.md`](./Migration_status_20260516.md) / [`.html`](./Migration_status_20260516.html) | 북모아 Storige 통합 마이그레이션 현황 보고서(2026-05-16) |
| [`Session_Summary_20260516.html`](./Session_Summary_20260516.html) | 2026-05-16 Storige 통합 개발 세션 요약(시각화) |
| [`PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`](./PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md) | PHP 연동 통보 v1.0 — 인쇄 워크플로우 v1(PDF 첨부/면지/게스트/compose-mixed/마이페이지) |
| [`templateset_page_workflow.md`](./templateset_page_workflow.md) | 인쇄 워크플로우 통합 개발 계획서 v1(2026-05-19, 작성 시점 상태 "컨펌 대기") — 비즈니스 플로우 정의 |

### 2026-05-09 ~ 05-10 — 편집기 UX · 관리자 모드 분리
| 문서 | 설명 |
|------|------|
| [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) | 7건 커밋 사이클 보고서 (UX 누수 정리 + 운영 베이스 디자인 흐름) |
| [`PHP_NOTICE_2026-05-10_admin_template_set_edit.md`](./PHP_NOTICE_2026-05-10_admin_template_set_edit.md) | PHP 팀 통보 — admin 템플릿셋 수정 모드 추가 (PHP 영향 없음) |

### 2026-05-06 ~ 05-07 — 멀티사이트 플랫폼화
| 문서 | 설명 |
|------|------|
| [`ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md`](./ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md) | 11p PDF 스토리보드 분석 + 4 카테고리 플랫폼화 계획 |
| [`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md) | Site/Tenant 모델 도입 + admin "기본설정" |
| [`PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md`](./PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md) | 사이트별 워커 옵션 + site_id 자동 주입 1차 |
| [`PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md`](./PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md) | 후속 사이클 (default 머지 + JWT siteId + admin dropdown + backfill) |

### 2026-05-04
| 문서 | 설명 |
|------|------|
| [`PNG_UPLOAD_HANG_FIX_2026-05-04.md`](./PNG_UPLOAD_HANG_FIX_2026-05-04.md) | PNG 업로드 hang 분석 + revert (별도 사이클로 이관) |
| [`P2_10_LOG_AGGREGATION_2026-05-04.md`](./P2_10_LOG_AGGREGATION_2026-05-04.md) | Pino + Loki + Promtail |
| [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](./P2_8_METRICS_DASHBOARD_2026-05-04.md) | Grafana + Prometheus 옵션 C |
| [`P2_7_E2E_REPORT_2026-05-04.md`](./P2_7_E2E_REPORT_2026-05-04.md) | Admin Playwright 확장 |
| [`DEFECT_13_FIX_REPORT_2026-05-04.md`](./DEFECT_13_FIX_REPORT_2026-05-04.md) | 결함 #13 (Conversion outputFileUrl) |
| [`SYNTHESIS_E2E_REPORT_2026-05-04.md`](./SYNTHESIS_E2E_REPORT_2026-05-04.md) | Worker 합성 E2E 3 시나리오 |
| [`PHASE2_FIX_REPORT_2026-05-04.md`](./PHASE2_FIX_REPORT_2026-05-04.md) | P0-1/P0-2/P1-5/P1-6 + Worker E2E |

### 2026-05-03
| 문서 | 설명 |
|------|------|
| [`AUDIT_FIX_REPORT_2026-05-03.md`](./AUDIT_FIX_REPORT_2026-05-03.md) | 옵션 A 결함 8건 처리 |
| [`AUTOPILOT_SESSION_2026-05-03.md`](./AUTOPILOT_SESSION_2026-05-03.md) | 오토파일럿 사이클 |

### 2026-05-02 이전
| 문서 | 설명 |
|------|------|
| [`AUTOPILOT_SESSION_2026-05-02.md`](./AUTOPILOT_SESSION_2026-05-02.md) | P0-3 + P1×4 + P2×4 |
| [`PHASE5_COMPLETE.md`](./PHASE5_COMPLETE.md) ~ [`PHASE9_COMPLETE.md`](./PHASE9_COMPLETE.md) | Phase 5~9 완료 보고 |
| [`PHASE2_PROGRESS.md`](./PHASE2_PROGRESS.md) ~ [`PHASE2_COMPLETE.md`](./PHASE2_COMPLETE.md) | Phase 2 사이클 |

---

## 🗂️ 7. 트래커 (deprecated — 마스터로 흡수)

| 문서 | 상태 |
|------|------|
| [`REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) | ⚠️ 2026-05-02 스냅샷, 마스터로 흡수 |
| [`NEXT_DEVELOPMENT_PLAN.md`](./NEXT_DEVELOPMENT_PLAN.md) | ⚠️ 2026-05-02 스냅샷 |
| [`NEXT_ISSUES_2026-05-03.md`](./NEXT_ISSUES_2026-05-03.md) | ⚠️ 2026-05-03 스냅샷 |
| [`NEXT_DEVELOPMENT_PLAN.html`](./NEXT_DEVELOPMENT_PLAN.html) | (참조용) |
| [`NEXT_ISSUES_2026-05-03.html`](./NEXT_ISSUES_2026-05-03.html) | (참조용) |

---

## 📋 8. 기능 / 명세 / 가이드

### 에디터 / 캔버스
| 문서 | 설명 |
|------|------|
| [`EDITOR.md`](./EDITOR.md) | **에디터 명세** (§1~§6 데이터/룰/권한, §7~§12 UX 사이클, §13 인쇄워크플로우(면지/PDF첨부/게스트), §14 임베드/텍스트/원형, §15 에셋공급/인쇄품질/객체보호, §16 편집완료 PDF 프리즈 진단·하드닝, §17 임베드 뒤로가기 가드, §18 PDF 첨부 검증 감사·책등/날개 + 검증/저장 속도, §19 스프레드 책 인쇄 무결성 체인, §20 외부 사진 주입(ShareSnap) + 핀치줌) — 캘린더·시트 맵·런처는 아래 「상품별 편집 모드」 절 |
| [`PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html`](./PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html) | **상품·템플릿 등록 매뉴얼**(시각화) — 관리자 5단계 등록 절차 |
| [`TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html`](./TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html) | **표지·내지 템플릿 제작 가이드** — 작성 규약 정본 포인터(2026-10-05): 표지 책등 방식(표지펼침면/표지3분할)은 호스트 상품 정의대로 Storige 가 등록, 쪽 추가 단위는 호스트 상품등록 값과 템플릿셋 `pageStep` 일치([`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) 3.1) · 양장 표지 크기 = 업로드 검증 규격 싸바리 전개([`PDF_VALIDATION_GUIDE.md`](./PDF_VALIDATION_GUIDE.md) §표지 책등·전개 크기 검증) |
| [`EDITOR_SCREENS.md`](./EDITOR_SCREENS.md) | **에디터 화면** + 저장 흐름 매트릭스 + Admin 라벨 + 모드별 헤더 UI |
| [`EDITOR_OBJECT_EDITING_SPEC.md`](./EDITOR_OBJECT_EDITING_SPEC.md) | 객체 편집 명세 |
| [`MOBILE_TOUCH_UI.md`](./MOBILE_TOUCH_UI.md) | 모바일 UX |
| [`스프레드편집_상세설계서_20260206.md`](./스프레드편집_상세설계서_20260206.md) | 스프레드 편집 상세 |
| [`스프레드편집_결정사항_요약_20260206.md`](./스프레드편집_결정사항_요약_20260206.md) | 결정사항 요약 |
| [`사양변경_기획회의_요약_20260205.md`](./사양변경_기획회의_요약_20260205.md) | 기획회의 요약 |
| [`표지편집 방식 정의.pdf.md`](./표지편집%20방식%20정의.pdf.md) | 표지 편집 정의 |
| [`BLEED_TRIM_MARK_FEATURE.md`](./BLEED_TRIM_MARK_FEATURE.md) | 블리드 / 재단선 마커 / 고객업로드 임포지션(편집사이즈 carry 인쇄) — 오너 확정 스펙, 2026-06-10 착수 |
| [`HARDCOVER_COVER_VALIDATION_NOTES.md`](./HARDCOVER_COVER_VALIDATION_NOTES.md) | 하드커버 표지 사이즈·검증 기준 메모(오너 결정 2026-07-13) |
| [`PRINT_TEMPLATE_GLOSSARY.md`](./PRINT_TEMPLATE_GLOSSARY.md) | 인쇄 템플릿 용어 정본(2026-08-13) — 칸(`regionScope`) 등 한글 이름 통일, 식별자 불변 |
| [`EDITOR_UX_DESIGN_2026-07-14.md`](./EDITOR_UX_DESIGN_2026-07-14.md) | 에디터 UX 설계서 — Stage E1 컨트롤 코어(canvas-core 플러그인 3종 + editor 컴포넌트) |
| [`PROPOSAL_LIBRARY_CATEGORY_ASSETS_2026-06-13.md`](./PROPOSAL_LIBRARY_CATEGORY_ASSETS_2026-06-13.md) | 라이브러리 카테고리 에셋 로딩 + 기본 폴백 + 편집기 UX 통합 설계 제안서 |

### 🗓️ 상품별 편집 모드 — 캘린더 · 시트 맵 · 런처 (2026-10-16 ~ 10-19)
| 문서 | 설명 | 운영 반영 / 브랜치 |
|------|------|------|
| [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) | **정본 설계안 v2** — `product_profile` 프로파일 모델(§2)·상품별 매핑(§3)·시트/면 모델·worker `sheet-map`(§6)·데이터·API·admin(§7)·외부 연동 런처·SDK(§8)·운영자 워크스페이스(§9)·로드맵(§11)·오너 결정(§13) | master 수록 · §11/§13 2026-10-18 갱신분은 브랜치 |
| [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md) | 1차 캘린더 설계안(v2 로 대체) — 참조 편집기 관찰(§1)·CalendarPlugin 세부(§3)만 유효 | master 수록 · 설계 제안 |
| [`CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`](./CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md) | P1 개발 계획(범위·서브웨이브·완료 기준·위험) | **P1 운영 반영 완료 2026-10-18**(master `af900212`) |
| [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) | P2 계획·상태(P2-a 시트 맵 기반 · P2-b 런처 · P2-c `sheet-map` 워커 모드 · P2-d 사진인화 · P2-e 운영자 콘솔) | **운영 반영 2026-10-21**(master `11383962`) · P2-e 미착수 |
| [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) 부록 D | 캘린더 상품 템플릿셋 등록 절차(상품 7종·26캔버스·프로파일 JSON·날짜 그리드·오버레이·호스트 연동·샘플 스크립트) | master 수록 · 운영 샘플 등록 미실행 |
| [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) v1.21~v1.24 | 계약 정본 행(§1-B·§1-D) — 낱장 검증·프로파일·런처·`sheet-map` | v1.21·v1.22 운영 · v1.23·v1.24 브랜치 전용 |
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | P1 반영 기록 · P2-b/P2-c 배포 절차(준비) | P1 반영 완료 · P2-b/P2-c 미실행(오너 승인 후) |

### Admin
| 문서 | 설명 |
|------|------|
| [`ADMIN_SCREENS.md`](./ADMIN_SCREENS.md) | Admin 화면 |
| [`product-templateset-linking-plan.md`](./product-templateset-linking-plan.md) | Product↔TemplateSet 연결 |
| [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) / [`.html`](./템플릿등록%20매뉴얼.html) | **Storige 템플릿 등록 매뉴얼**(admin 운영자용) — ① 템플릿 등록(IDML/PSD/수기) ② 템플릿셋 등록(5개 탭) ③ 템플릿 객체 속성 관리 ④ 상품-템플릿셋 연결 + 부록 A~D(D = 캘린더, P1 2026-10-17) |
| [`templateset_page_workflow.md`](./templateset_page_workflow.md) | 인쇄 워크플로우 통합 개발 계획서 v1(2026-05-19) — ADMIN 템플릿셋 구성부터의 비즈니스 플로우 |

### 디자인 가져오기 (변환기)
| 문서 | 설명 |
|------|------|
| [`DESIGN_IMPORT_CONVERTER.md`](./DESIGN_IMPORT_CONVERTER.md) / [`.html`](./DESIGN_IMPORT_CONVERTER.html) | **IDML/PSD → 템플릿 변환기** (`@storige/indesign-import`) — IDML 표지 펼침면(벡터/하이브리드·책등 가변·5영역) + PSD 단품(텍스트=편집/비텍스트=배경 PNG) · admin `/templates/import` 워크플로우 · 인쇄 손실 주의 · §12 재편집 정합성 사이클(2026-06-11) · 로드맵 |
| [`COORDINATE_SYSTEM.md`](./COORDINATE_SYSTEM.md) | **좌표계 규약(동결)** — 4좌표계(IDML 중앙/content 좌상단/scene 중앙=정본/PDF 좌하단) + content↔scene 변환 SSOT(`centerOrigin.mjs`) + `canvasData.width/height` 함정 + "중앙 3가지(객체원점/화면센터링/내지임포지션)는 독립 계층" |
| [`IDML_IMPORT_FLOW.md`](./IDML_IMPORT_FLOW.md) / [`.html`](./IDML_IMPORT_FLOW.html) | **IDML 가져오기 전체 플로우(운영)** — 업로드·변환·등록·테스트·검증 7단계 + 두 시나리오(펼침면 하이브리드/책등 가변 셋) + 검증 체크리스트 + 문제 해결 + 배포 기능(색모드·아웃라인·overprint·프레임마스킹·PNG업로드) + §5b 재편집 정합성(재가져오기 안내) |

### PDF / 워커
| 문서 | 설명 |
|------|------|
| [`PDF_VALIDATION_GUIDE.md`](./PDF_VALIDATION_GUIDE.md) | **PDF 검증 시스템 운영 가이드(운영)** — 검증 항목 한눈에(2026-06-04 코드 기준) · validate 입력 계약 · 내지 판형 규격표(2026-07-14) · 재단선 포함 PDF TrimBox 판정(2026-09-30) · 책등·날개 · 표지 책등·전개 크기(양장 싸바리) · 데이터 주도 페이지수 검증(2026-06-25) · fix-pagecount(LIVE 2026-06-25) · fix-bleed(2026-07-13 배선) · 에러/경고 코드 · 제본 규칙 · 스프레드/색상/해상도 감지 · Ghostscript · env · Bull · Docker · 트러블슈팅. 캘린더 P1 의 `coverSpine='none'`·낱장 `productKind='sheet'` 규칙은 이 문서에 아직 없음(정본은 [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) v1.21·v1.22 행) |
| [`PDF_VALIDATION_API.md`](./PDF_VALIDATION_API.md) | PDF 검증 API |
| [`PDF_VALIDATION_REVIEW.md`](./PDF_VALIDATION_REVIEW.md) | PDF 검증 리뷰 |
| [`PDF_VALIDATION_SUMMARY.md`](./PDF_VALIDATION_SUMMARY.md) | PDF 검증 요약 |
| [`PDF_VALIDATION_WBS.md`](./PDF_VALIDATION_WBS.md) | PDF 검증 WBS |
| [`PDF_VALIDATION_COMPLETE.md`](./PDF_VALIDATION_COMPLETE.md) | PDF 검증 완료 |
| [`WORKER_MERGE_PLAN.md`](./WORKER_MERGE_PLAN.md) | Worker 합성 plan |
| [`worker-ux-plan.md`](./worker-ux-plan.md) | Worker UX |
| [`PDF분리출력_상세설계서_v2.5.md`](./PDF분리출력_상세설계서_v2.5.md) | PDF 분리 출력 |
| [`PDF분리_상세설계서_v1.1.4.md`](./PDF분리_상세설계서_v1.1.4.md) | PDF 분리 v1.1.4 |
| [`CARD_IMPOSITION_DEV_GUIDE.md`](./CARD_IMPOSITION_DEV_GUIDE.md) | 카드 양면 조판(Imposition) 개발 가이드 — 명함재단기 호환 마커(관리자 설정 기반) |
| [`card_imposition_skills.md`](./card_imposition_skills.md) | 카드/명함 특화 양면 조판 기술 규격 — 관리자 정의 마커·양면 배치 로직 |
| [`BLEED_TRIM_MARK_FEATURE.md`](./BLEED_TRIM_MARK_FEATURE.md) | 블리드 carry · 재단선 마커 · 고객업로드 정규화(2026-06-10 착수, 오너 확정 스펙) |

### 테스트
| 문서 | 설명 |
|------|------|
| [`TEST_CASES.md`](./TEST_CASES.md) | 테스트 케이스 |
| [`E2E_SCENARIO_TESTS.md`](./E2E_SCENARIO_TESTS.md) | E2E 시나리오 |

### 기타 / 도구
| 문서 | 설명 |
|------|------|
| [`콘솔크롤링.md`](./콘솔크롤링.md) / [`.html`](./콘솔크롤링.html) | 디지털계산식 가격표 — 노리터 사이트(`bookmoa.noriter.co.kr`) 콘솔 크롤링 작업 정리(동기 XHR 프리즈 때문에 브라우저 콘솔 JS 로 추출) |

### AI / 미래
| 문서 | 설명 |
|------|------|
| [`ROADMAP_2026-05-29.md`](./ROADMAP_2026-05-29.md) | **추후 개발 로드맵 (현재 활성)** — v1 GA 후 트랙 우선순위 |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.md`](./SHOPIFY_APP_PROPOSAL_2026-05-16.md) | Shopify 앱 계획 (GO·착수 보류) |
| [`SHOPIFY_TECHNICAL_DESIGN.md`](./SHOPIFY_TECHNICAL_DESIGN.md) | Shopify 앱 기술 설계 |
| [`AI_FEATURES_PLAN.md`](./AI_FEATURES_PLAN.md) | AI 기능 plan |
| [`NEXT_DEVELOPMENT_PLAN.md`](./NEXT_DEVELOPMENT_PLAN.md) | 다음 개발 (deprecated) |
| [`PROJECT_VALIDATION.md`](./PROJECT_VALIDATION.md) | 프로젝트 검증 |
| [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) | 구현 상태 |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | 개발 plan |

### Phase 보고서 (이전 사이클)
| 문서 | 설명 |
|------|------|
| [`PHASE2_PROGRESS.md`](./PHASE2_PROGRESS.md) ~ [`PHASE9_COMPLETE.md`](./PHASE9_COMPLETE.md) | Phase 2~9 진행/완료 |
| [`DEPLOYMENT_COMPLETE.md`](./DEPLOYMENT_COMPLETE.md) | 배포 완료 |
| [`REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) | 잔존 작업 리뷰 (deprecated) |
| [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) | 향후 업데이트 |

---

## 🎨 9. 디자인 / 흐름

| 파일 | 설명 |
|------|------|
| [`Storige_개발가이드.html`](./Storige_개발가이드.html) | **시각 통합 개발 가이드** — 시스템 관계도/코드베이스 지도/에디터 UX/위험 포인트 (사이드바 네비) |
| [`WORKER_FLOW_시각화.html`](./WORKER_FLOW_시각화.html) | Worker 파이프라인 시각화 (validate → convert → synthesize) |
| `admin-flow.pdf` | Admin 워크플로 다이어그램 |
| `worker-work-flow.pdf` | Worker 워크플로 다이어그램 |
| `표지편집 방식 정의.pdf` | 표지 편집 방식 |
| [`WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html`](./WAVE1_TRIMBOX_OVERVIEW_2026-09-30.html) | Storige Wave 1~5 개요(시각화) |
| [`ATTACH_PDF_PAGE_PAD_2026-09-28.html`](./ATTACH_PDF_PAGE_PAD_2026-09-28.html) | 첨부 PDF 빈 페이지 채움(시각화) |
| [`COVER_TEMPLATE_UX_AUDIT_2026-08-13.html`](./COVER_TEMPLATE_UX_AUDIT_2026-08-13.html) | 표지·낱장 템플릿 UX 감사 — Canva / Blurb / Moo 대조(시각화) |
| [`Migration_status_20260516.html`](./Migration_status_20260516.html) | 마이그레이션 현황 보고서 2026-05-16(시각화) |
| [`Session_Summary_20260516.html`](./Session_Summary_20260516.html) | 2026-05-16 통합 개발 세션 요약(시각화) |

---

## 🔗 외부 / 운영 자료

- **API 문서 (Swagger)**: https://api.papascompany.co.kr/api/docs
- **Grafana 대시보드**: https://api.papascompany.co.kr/grafana/
- **Sentry**: https://papascompany.sentry.io
- **Editor (운영)**: https://editor.papascompany.co.kr
- **Admin (운영)**: https://admin.papascompany.co.kr
- **Repo**: https://github.com/papascompany/storige-book-editor
