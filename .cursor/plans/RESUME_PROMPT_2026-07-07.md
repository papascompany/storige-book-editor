# RESUME PROMPT — 2026-07-07

> 이 날짜에 **계획 트랙 2개**가 신설되었다(모두 문서 단계 — 코드 변경 0, master 클린 유지 bb4c2c8).
> 두 트랙은 대상 코드 영역이 분리되어 병행 가능. 실행은 각 마스터 프롬프트로 Opus 4.8 Ultracode 세션을 연다.
> ⚠️ **완료 판정은 §6(심야 갱신)이 정본** — §1~§5 서술 중 git과 어긋나는 부분은 §6으로 정정된다.

## 1. P트랙 — Partner Platform API (선행 세션 산출)
- 정본: `SWEETBOOK_GAP_ROADMAP_2026-07-07.md` v2.0 (Stage 0~6, 프롬프트 A~G)
- 실행: `ORCHESTRATION_MASTER_PROMPT_2026-07-07.md` (SSOT: `.cursor/plans/pv1/`)
- 다음 단계: Stage 0 (주춧돌+v1 설계서)

## 2. E트랙 — 에디터 UX/에셋 라이브러리 (본 세션 산출) ★신규
- 정본: `EDITOR_UX_GAP_ROADMAP_2026-07-07.md` v1.0
  - 근거: 정찰 3종 실측(에셋 라이브러리 전수 / canvas-core 플러그인 23종·컨트롤 10축 / socialBook-demo 전 소스)
  - 격차 확정: 컨트롤 P0 3건(객체 간 스마트 가이드·실시간 치수/각도 피드백·객체 액션 바),
    에셋 P0 2건(텍스트 스타일 프리셋·텍스트 효과[정찰 상충 — E0 재검증 1순위]) 외 P1/P2 — §3 매트릭스
  - Stage E0(기준선·설계서) → E1(컨트롤 코어) → E2(조작 마감), E3(텍스트)·E4(에셋 UX) 병렬 가능, E5(콘텐츠+오너 게이트)
  - 작업지시 프롬프트 EA~EF = §6
- 실행: `EDITOR_UX_ORCHESTRATION_MASTER_PROMPT_2026-07-07.md` (SSOT: `.cursor/plans/eux/`)
- 다음 단계: **Stage E0** (코드 0 — 상충 재검증·인쇄 렌더 경로 실측·골든 기준선·`docs/EDITOR_UX_DESIGN_2026-07-07.md` 설계서)
- 오너 미결(로드맵 §7): 벤치 실측 방법(권고: Chrome 실측) / E1 플래그 기본 on / 콘텐츠 소싱 / Google Photos / 곡선 텍스트는 E0 분류 후 재판단

## 3. 완료/미완 요약 (본 세션)
- 완료: E트랙 정찰 3종, 격차 매트릭스(§3, 실측 판정), 로드맵 v1.0, 마스터 프롬프트, 본 RESUME
- 미완(다음 세션): Stage E0 착수. socialBook-demo 로컬 사본은 세션 스크래치패드라 소멸 — 필요 시 재클론
- 주의: 계획 문서 모두 git 미추적(untracked) — 커밋 여부는 오너 결정

## 4. [갱신 2026-07-07 오후] 경쟁 편집기 벤치 실측 + E1 구현 명세 완성, 구현은 오너 보류
> ⚠️ 벤치 상세 정본은 **로컬 전용**(`.cursor/plans` 내 gitignore, PUBLIC 레포 커밋 금지). 파일명·상세는 로컬 문서 참조.
- **정본 추가**: E1 구현 명세(로컬 전용) — ①경쟁 편집기 쇼케이스(판스티커) 브라우저 실측
  (텍스트 프리셋 3종·패스 텍스트 4종·플로팅 액션 바 실물 확증 → A1/A3/C3 판정 강화, 미확인 항목 §2.9)
  ②storige 코드 심층 구현 지도(플러그인 계약·등록 지점·스냅 로직·금지 지점) ③E1 구현 명세 §5(착수 시 그대로 사용).
- **구현 상태**: 오너 지시로 **착수 보류**. 생성했던 빈 브랜치 feat/editor-ux-e1-controls 는 삭제, master 클린(bb4c2c8).
- **착수 시**: 명세 §6 실행 계획(Wave 0 상충 확인 → 직렬 구현 4건 → 병렬 검증 → 오너 머지 게이트)대로.
  선행 확인 2건: ControlBar.tsx distribute 실존 여부(정찰 상충), excludeFromExport 히스토리 제외 여부.
- **크롬 확장**: 실측 중 연결 단절(Chrome 프로세스는 정상) — 재연결 후 §2.9 잔여 실측 권장.

## 5. [갱신 2026-07-07 저녁] 잔여 실측 완료 (v1.1) — Playwright 대체 경로
- 크롬 확장 재연결 실패(크롬 재시작에도 불구) → **Playwright(playwright-core+캐시 Chromium) 헤드리스 실조작**으로 §2.9 전 항목 완측. 스크립트: 세션 스크래치패드(소멸 예정 — 재실측 시 로컬 정본 §1 방법 참조).
- 확정(경쟁 편집기): **정렬 가이드 있음**(align-line-v/h)·치수/각도 툴팁 **없음**·우클릭 **없음**·단축키 기본 10종·패스텍스트 곡률 포인트 8개+Flip·멀티선택 제한적.
- **신규 발견**: 재단선 침범 실시간 경고(주황 강조+토스트) → 명세 §5-5 신규 후보 등재, 오너 결정 §7-5.
- 문서 v1.1 갱신 완료. 구현은 여전히 오너 승인 대기(§7-1).

## 6. [갱신 2026-07-07 심야] ★문서-git 정합 동기화 (이 섹션이 완료 판정의 정본)

> 계획 문서들(LAYER_UX_REDESIGN·PHOTOBOOK_O2 등)이 "계획 단계" 표기로 남아 있어
> 이슈 스캔이 완료 작업을 미착수로 오탐한다. **완료 여부는 git이 정답** — 아래로 정정한다.

### 6.1 git 실상태 (master `cf28dd0` 기준)
- **레이어 UX L1~L7 전부 머지 완료** (설계 문서의 L1~L3 로드맵 + 2차 항목까지):
  L1 실버그 4종(e3b33a4) · L2 고객 행 감산(994d988) · L3 보호 드롭다운(bb4c2c8) ·
  L4 printExclude 표식+autosave suspend+그룹 텍스트 잠금(85f0196) · L5 겹침 필터+행 썸네일(3696043) ·
  L6 모바일 바텀시트·롱프레스 DnD(c7c3e4b) · L7 필수 편집 요소 requiredEdit(a4dae50)
- **포토북 D-1~D-4 머지 완료**: c4-1 에디터측(b41b9a7)·c4-2 자동편집 잔여 갭(3b42901)·c4-3 커버 3종 서버측(864ba00)
- **저장/사이즈 트랙 종결**: A안 읽기전용 잠금+주문스펙 모달 배포·검증 완료(워크오더 §7)
- **C+ autoFixable 게이팅 머지**: WIRED_FIX_METHODS 킬스위치 기본 OFF(25bbb26)+G1·G2 해소(cf28dd0)
- **방향 불일치 가드레일**(923d5cb)
- **Swagger 파트너 큐레이션(7950c87)은 master 미머지** — fix/swagger-partner-curation 브랜치 대기(오너 머지+API 수동 재배포 승인 잔여)

### 6.2 본 세션(심야) 추가 산출
- 벤치 종합 v2.0: 로컬 전용 4종(`EDITOR_BENCH_ANALYSIS_V2`·`_DEV_PROMPTS_V2`·`_E1_IMPL_SPEC`(리네임)·`_SYNTHESIS.html`) — 전부 gitignore(`*EDITOR_BENCH*`)
- CTO 개발 이슈 보고(`CTO_DEV_ISSUES_REPORT_2026-07-07.html` — 레포 밖 로컬 벤치 폴더, 위치는 로컬 전용 문서 참조)
- 오너 결정표: `OWNER_DECISIONS_2026-07-07.md` / 기술 적용 문서: `EDITOR_BENCH_TECH_APPLY_2026-07-07.md`(로컬 전용)
- **출처 노출 방지 3층 게이트**(미커밋 — 오너 커밋 승인 대기):
  `scripts/check-source-exposure.mjs`(토큰 인코딩) + editor/admin `postbuild`(dist 스캔=배포 차단) + ci.yml 소스 스캔 + 루트 `pnpm check:exposure`. `.gitignore`에 벤치 문서 패턴 추가.

### 6.3 작업트리 주의 (다음 세션 필독) — [갱신 07-12]
- 현재 체크아웃 = `chore/source-exposure-gate`(기점 30dca22 — 노출 게이트 커밋 후 유지 중).
- ✅ **노출 게이트 master 머지·push 완료 (07-14, 오너 지시)**: `f1d5e33` = origin/master (d253e7c 포함).
  **CI 소스 스캔·editor/admin postbuild 배포 게이트 발효됨.** 머지는 임시 worktree에서 수행(메인 작업트리 무접촉), gitleaks 통과 확인.
- 잔여 미커밋 1건: `docs/PLATFORM_INTEGRATION_GUIDE.md`(±680줄 — **타 세션 진행 중 작업, 건드리지 말 것**)

### 6.4 다음 착수 우선순위 (CTO 보고 정본 반영)
1. ✅ **보안(D-5a, 07-12)**: bookmoa PHP 구 유출키 폐기 완료(`1391c5b4` inactive — PHP 연동 보류 확인). **유출 구 키 전량 폐기.** 잔여=bookmoa-mobile **preview env 키(오너/Vercel 대시보드)** — 연동 진행 중이라 필요.
2. ~~노출 게이트 커밋~~ → ✅ 완료(`d253e7c`). 잔여: **오너 master 머지·push**
3. 병렬 착수(승인 불요): **E트랙 Stage E0**(코드 0) + **P트랙 Stage 0**(주춧돌)
4. ~~오너 결정 잔여(D-1~D-4)~~ → ✅ **[2026-07-14] 오너가 CTO 권장안 전부 수용 — 결정표 전 행 기입 완료.** E1 구현·P트랙 Stage 2~4·SDK 보강(3건) 게이트 해제.
5. **다음 세션 실행 정본**: `CTO_ORCHESTRATION_MASTER_PROMPT_2026-07-14.md` — CTO 오케스트레이터가 트랙 A(E0→E1)·B(P-Stage0→1→2+)·C(컷아웃 실측)·D(마감)를 서브에이전트 병렬로 집행. 진행 기록은 본 문서 §7 신설로 append.

> **통합 현황(2026-07-12)**: bookmoa PHP=보류(구 키 폐기, 신 키 대기) / bookmoa-mobile·md2books·ShareSnap=연동 진행 중 / 100p Books=연동됨. 미누출 키(md2books/ShareSnap/100p)는 회전 불필요.

## 7. [신설 2026-07-15] CTO 오케스트레이션 세션 실행 기록 (정본: CTO_ORCHESTRATION_MASTER_PROMPT_2026-07-14.md)

> 서브에이전트 총 19기(정찰 7·구현 6·적대 리뷰 4·골든/fe-qa 2). 전 브랜치 **push/master 머지 없음 — 오너 머지 게이트 대기**. SSOT 상세: eux/STATUS.md·pv1/STATUS.md.

### 7.1 완료 산출물 (머지 후보 브랜치 — 전부 master f1d5e33 분기)
| 트랙 | 브랜치 | 내용 | 검증 |
|---|---|---|---|
| E1 | `feat/editor-ux-e1-controls` (10커밋 2e5537d..7a4d826) | 설계서+히스토리 가드 버그 수정+SmartGuides/각도스냅+TransformFeedback+ObjectActionBar+분배 이관+SafeZoneWarning+P0/P1 수정 3건 | 골든 3케이스 byte-identical·fe-qa 21/21·적대 2렌즈 재검 GO·407/407+448/448 |
| P-Stage0 | `feat/p0-s1-validation-result`(32e2346) `chore/p0-contract-freeze-typo`(2806537) `feat/p0-external-site-stamp`(b549cfb) `feat/p0-guarded-contract-spec`(7c3dc9d+d8c6632) `docs/p0-partner-api-v1-design`(150f188+27fb2b9) | Stage 0 전 5건(GUARDED 10라우트·v1 설계서 739줄) | 적대 리뷰 GO(P1 2건 수정 완료)·api 400/400·변이 3/3 적발 |
| D-6b① | `fix/image-processing-lazy-preload`(a09cf8a) | 배경제거 ~111MB eager preload 제거(lazy)+분리 초기화 | 적대 리뷰 GO(변이 2종 red)·335/335+417/417 |

### 7.2 주요 판정·발견
- Wave A0: distribute 실존(§5-4=이관 확정) / 히스토리 무오염 실증+id 가이드 undo 삭제 기존버그 발견·수정 / A2=존재+노출(E3 축소) / C6 롱프레스 부재(E2) / C7 스냅 전무 / 동결 라우트 확정 **17**.
- 적대 검증 실적: E1 P0 1(사진틀 스냅 desync — 바인딩 순서)+P1 2 적발·수정·재검 GO / P-Stage0 P1 2(bookmoa by-product 라우트 GUARDED 누락, v1 키 env 우회 여지) 적발·수정.
- 트랙 C: 배경제거 실체=imgly ONNX(OpenCV 아님), 전 세션 eager 111MB 발견 → CUTOUT_WAVE0_REPORT_2026-07-15.md + OWNER_DECISIONS D-6 신설. D-6b①은 오너 지시로 즉시 구현 완료.

### 7.3 오너 잔여 액션
1. ~~머지 게이트~~ → ✅ **완료(2026-07-15 오너 승인)**: 7개 브랜치 master 머지·push(f1d5e33..f53afe7, gitleaks 0·전 테스트 green·editor 배포 진행). VPS API 재배포도 ✅ 완료(f53afe7, health 200 — 권한 건너뛰기 설정 후 세션이 직접 실행). 잔여: **파트너 2곳 공지(D-1d — E1 플래그 on 라이브 + 임베드 DEL키 모달화)뿐**.
2. 기존 잔여: fix/swagger-partner-curation 머지+API 재배포 / bookmoa-mobile preview env 키 / DPA 발주.
3. 신규: **100p 파트너 STORIGE_NOT_S3 매칭 실물 확인**(오기 매칭이면 폴백 미발화 실장애 가능성) / D-6b②③(픽셀 캡·dataURL→storage) 결정 / A6/A7 콘텐츠 볼륨 SELECT(eux/BLOCKERS.md 1줄 명령) / user 자기잠금 삭제 불일치·모바일 바텀시트 z-index 등 P2 백로그(eux/pv1 STATUS).

### 7.4 잔여 트랙
- 트랙 D(포토북 D-2 잔여 갭): 정찰 완결(2026-07-15) — 잔여=신규 구현 아닌 **실기기 E2E 검증(D-a, 코드 0)**뿐. 오너 체크리스트 `PHOTOBOOK_FRAMEFILL_E2E_CHECKLIST_2026-07-15.md` 산출. D-b(z-order)=코드 주석 '변경 금지, 오너 게이트'·D-c/D-d/D-e·O-7~9=오너 결정 대기. ※pv1의 'D-2'(파트너 API 결정)와 동명이인 — 혼동 금지. [S-P3B] SDK 보강 3건은 E1 머지 후.
- P-Stage1(v1 코어): Stage 0 머지 후 — 설계서가 구현 명세.

## 8. [신설 2026-07-16] P트랙 Stage 1~2 완주 (CTO 세션 연속)

> 정본: pv1/STATUS.md. 전 산출 오너 머지 게이트 통과·**프로덕션 반영 완료**. 서브에이전트 병렬 오케스트레이션.

### 8.1 라이브 반영 (master 순차)
- **Stage 1** (f53afe7→feef3d1): partner-api v1 코어(봉투·멱등·per-Key 리밋·감사·페이지네이션 `@PartnerV1Controller` 승계 데코레이터)+BookSpecs(GET 3라우트·수집 dry-run)+OpenAPI export. 마이그레이션 3건(audit_logs·idempotency_keys·book_specs). 적대 2렌즈 GO(P1 2 수정). VPS 반영.
- **Stage 2 배치1** (→e56f60b): partner_api_keys(env test|live·해시·1회노출·72h 오버랩 회전)+웹훅 v2(delivery store·재시도 1/5/30분·HMAC·secret AES-GCM·D-7c 이중 opt-in)+frameAncestors 동적 CSP(Edge Middleware+정적 폴백). 마이그레이션 2건. compose ENC_KEY 매핑 보강(ⓓ 전례). CSP 배포 게이트 라이브 실증(헤더 1개+DB origin 병합). 적대 2렌즈 GO(P1 2 수정).
- **Stage 2 배치2** (→0a962b6): 파트너 포털 v0(SITE_ADMIN 셀프 뷰·test 키 셀프 발급·live 승인 큐 유지·D-7a 보수 스코프)+test env 잡 인프라(워터마크 더미·retention 24h·발화=Stage 3)+발신 SSRF 2선 가드. 마이그레이션 없음. 적대 2렌즈: **렌즈1이 실공격 spec으로 SSRF 실증→근본 차단**(4벡터 재현 불가)+P1-1 게이트·키상한·retention 검증력 수정.

### 8.2 오너 결정 신설
- D-6①(배경제거 lazy화) 완료·라이브 / D-7a(포털 이메일 인프라)=미결→보수 스코프 진행 / D-7b(CSP Edge Middleware)=채택·라이브 / D-7c(bookmoa 수신부 대조)=오너 액션 / D-8a(셀프 CORS 합집합)=현행 수용·중기 도메인 소유 검증 권고 / D-8b(SSRF)=코드 수정 완료.

### 8.3 오너 잔여 액션
1. **파트너 공지 2건 발송**(NOTICE_bookmoa_mobile·sharesnap_e1_rollout — E1 라이브 상태라 시급) + Stage 2 신규(포털·웹훅 v2 opt-in) 안내.
2. **book_specs 시드**(§8-9): VPS `pnpm --filter @storige/api collect:book-specs` dry-run 검토→승인 시 수동 INSERT.
3. D-7c bookmoa 수신부 코드 확보(웹훅 v2 기존 파트너 전환 게이트) / D-7a 메일 인프라 벤더 / D-8a 도메인 소유 검증 도입 여부.
4. **100p STORIGE_NOT_S3 매칭 실물 확인**(폴백 미발화 가능성) / A6/A7 볼륨 SELECT(eux/BLOCKERS).

### 8.4 다음 트랙
- **Stage 3(Books 라이프사이클)**: creationType 4종(EDITOR_SESSION 포함)+finalization. **test 잡/포털 test 키의 실발화 표면** — Stage 1 봉투/멱등 + Stage 2 env 위에 구현. compose-mixed 더미 coverSizeValidation 계약(배치2 P2-3) 착수 전 결정.
- 잔여 하드닝(비차단): 웹훅 발신 DNS 실패 모니터링·TOCTOU(pinned-IP+maxRedirects:0)·retention LIKE 직렬화 의존.

## 9. [신설 2026-07-16] P트랙 Stage 3 완주 (Books 라이프사이클)

> 정본: pv1/STATUS.md. 정찰 2기→배치 A/B 순차 구현→각 적대 2렌즈→머지·프로덕션 반영. 서브에이전트 병렬 오케스트레이션.

### 9.1 라이브 반영 (master 순차)
- **배치 A** (0a962b6→37da97f): books/book_assets/book_finalizations 테이블·엔티티·모듈 + DRAFT 생성/목록/상세 + 자산 라우트(pdf-cover/contents·photos, 409/404, creationType×asset 호환 매트릭스 20셀, FINALIZED 게이트, heavy 버킷). 마이그레이션 1건. 적대 2렌즈 GO(자산 IDOR 변이 red).
- **배치 B** (→8bfbaa3): finalization 오케스트레이터(PENDING→VALIDATING→COMPOSING→COMPLETED 상태머신, book_spec 연결 시 판형 검증·아니면 skip+validationSkipped 표식, registerExternalFile outputFileId 고정, 콜백 역참조 job.options.finalizationId 마커) + EDITOR_SESSION 승격(file_edit_sessions·교차테넌트 404·NULL-site 거부·COMPLETE 검증) + compose-mixed partnerEnv 배선(test env 실합성 사고 차단) + 동시성 (book_id,attempt) 유니크 CAS + planSnapshot 자산 고정 + 예외 격리. 마이그레이션 2건. 적대 2렌즈: **NO-GO(P1 2: DI 교착·검증 skip 계약)→수정→재검 GO**(변이 2종 red 실증).

### 9.2 정찰 확정 불일치 7건 (전량 해소)
①승격원본=file_edit_sessions(설계서 정정) ②compose-mixed partnerEnv/isTest 미전파(배선) ③SYNTHESIZE outputFileId 자동등록 부재(registerExternalFile) ④콜백 역참조 부재(finalizationId 마커+updateJobStatus additive 분기) ⑤NULL-site 승격 우회(명시 거부) ⑥게스트 폴백 24h 고아화(TEMPLATE 최소화) ⑦assertPageRules private(public 추출). +90/100MB→100단일·S-2 2GB 확정.

### 9.3 파트너 v1 완결 여정 (라이브)
POST /api/v1/books(creationType 4종) → 자산 투입(pdf/photos 또는 EDITOR_SESSION 승격) → POST .../finalization(주문가능 FINALIZED) → GET .../pdf. Stage 1 봉투/멱등 + Stage 2 env/test 키 위에서 동작. **test 잡 인프라·포털 test 키 실발화 표면 완성**.

### 9.4 오너 게이트 (Stage 3 관련)
- **D-9**: 미검증 book의 FINALIZED 승격 허용 여부(현재 validationSkipped 표식+문서화로 진행, orders 자동진입 전 차단 게이트는 Stage 6). book_specs 시드(§8-9) 승인 시 PDF_UPLOAD 판형 검증 자동 활성.
- TEMPLATE/MIX_COVER_TEMPLATE finalization은 표지 템플릿 렌더(Stage 5 스키마) 대기 → 현재 422 ERR_ASSETS_INCOMPLETE.
- planSnapshot JSON 실 DB 왕복 스모크 1회 권장(TypeORM json 표준·저위험).

### 9.5 다음 트랙
- **Stage 4(DX)**: @storige/sdk + quickstart 3종 + 문서 포털 + llms.txt. Stage 1 v1 봉투/OpenAPI 소비, books 클라이언트는 Stage 3 완료로 개방됨.
- **Stage 5(템플릿 개방)**: siteId 쓰기+검수 상태머신+스키마 API → TEMPLATE/MIX finalization 실현.
- 잔여 P2 백로그: onWorkerJobSettled siteId 정합 assert·FAILED attempt 상한·멀티파트 멱등 지문(파트너 문서)·getPromotionArtifact 선행 조립.

## 10. [신설 2026-07-16] P트랙 Stage 4 (DX) — SDK+E-2 라이브, 잔여=quickstart·포털

> 정본: pv1/STATUS.md + OWNER_DECISIONS(D-10a~d, E-1~E-10). 정찰 2기가 **Stage 4 범위 자체를 정정**함.

### 10.1 라이브 반영 (master 순차)
- **E-2** (8bfbaa3→f159cc0): OpenAPI export에 books 11라우트 누락+CI 침묵 → **커버리지 11→22 오퍼레이션**(16 paths=v1 전량). 재발방지=v1 컨트롤러 FS 스캔 공용 헬퍼(`testing/v1-controller-scan.ts`)+3중 대조 spec. 적대 리뷰 GO(변이② **신규 컨트롤러 미등재→RED** 실증=재발 시나리오 차단). **런타임 무접촉→VPS 재배포 불요**.
- **@storige/sdk 초판** (→10dfaba): `/client`(v1 22라우트 전수)+`/webhook`(v1·v2 HMAC 통합 검증·replay·멱등·express/next 어댑터). sdk **279 green**·**runtime deps 0**·**private:true**(배포 D-10b 보류)·서버 무접촉. **CI 등재**(드리프트 감시를 게이트에 연결 — ErrV1 삭제 변이→typecheck+test 이중 red 실증).

### 10.2 정찰이 정정한 Stage 4 전제 (로드맵 §6 Stage 4 개정 완료)
1. **SDK 코드생성 불가→수작업 확정**: v1 전 표면 `@ApiResponse({type})` **0건** + 성공 봉투가 **런타임 인터셉터** 소관이라 OpenAPI에 부재. codegen 복구=서버 22라우트 전면 개작=AD-1 저촉 → 기각. OpenAPI는 **문서 렌더/계약 회귀 게이트** 용도.
2. **types 의존 금지**: packages/types는 private+2207줄 중 v1 계약 75줄 → 통째 배포 시 내부 도메인 노출. SDK 자체 재선언+등가성 게이트.
3. **quickstart 3종 개정**(D-10c): template-order **불가**(템플릿 바인딩 라우트 #12·#13+목록/상세/schema #17~19 전부 Stage 5 대기, TEMPLATE·MIX는 서버가 422) → `pdf-upload-order`+`editor-session-order`+**`webhook-receiver`**. SDK subpath 3종 전수 커버.
4. **S-2 종결**: 100MB(직접)/2GB(presigned)/**2GB(VPS 실값 WORKER_MAX_FILE_SIZE — 문서의 "1GB"는 스테일)**. "90MB"=100p 자작 클라이언트 마진(storige 상수 아님). "1GB vs 2GB"는 상충 아님(다른 계층).
5. **E-4 오탐 확정**: files.service는 `ObjectStorageService`(별개)를 쓰지 `StorageService`(50MB)가 아님. 두 업로드 표면이 각자 내부 일관 → 무해.

### 10.3 적대 검증이 잡은 것 (SDK)
- **P0**: secret 미설정 시 **무인증 원격 프로세스 크래시**(secret.length가 서명 파싱보다 앞 → TypeError → express4 unhandledRejection → exit). **README 예제(`process.env.X!`)가 정확히 그 경로**. → 팩토리 시점 검증(부팅 실패)+어댑터 throw 포획(500). 크래시 PoC 재현 불가 실증.
- **P1**: ①**SDK가 CI에 부재**=드리프트 방어가 장식 ②dedupe 키가 서명 밖(uid 변조→300초 창 무제한 재실행, 문서화로 대응) ③`toleranceSec:NaN`→replay 보호 침묵 OFF(10년 전 서명 통과).
- **테스트 변이 6종 중 2종 green(사각)** — MUT-5(identifier 폴백 순서, 계약 임계) 해소 / MUT-6(이벤트 카탈로그) 잔존은 README에 한계 명기.
- 리뷰어 가설도 검증 대상: `node:` 프리픽스 진범은 `target`이 아니라 tsup **`removeNodeProtocol`**(격리 매트릭스 실증).

### 10.4 서버 트랙 잔여 (SDK가 일방적으로 못 고침 — 별건)
| # | 결함 | 상태 |
|---|---|---|
| **E-1** | 멀티파트 멱등 지문 맹점(다른 파일이 조용히 유실) — **실스택 supertest 프로브로 실증**(동일 `request_hash=sha256('{}')`) | SDK 우회 완료. **서버 근본수정+회귀 spec(E-7) 필요** |
| **E-5** | `requestId` 드리프트(타입 string vs GET /pdf 스트림만 null) | 판단 필요 |
| **E-6** | photo 직접 업로드 죽은 표면(MIME PDF 전용→이미지 항상 415) | 의도 확인 필요 |
| **E-8** | v1↔v2 identifier 규칙 상이(`book.finalization.*`가 v1=fin_/v2=whd_) → 파트너 v2 전환 시 전량 401 | 발신부 정합화 or 문서 경고 |
| **E-9** | bookmoa ±10분 게이트 — **정정**: bookmoa는 레거시 헤더만 읽고 v2는 미전송 → **오늘 v2 수신 불가**. 실 충돌은 v1 큐 적체(>10분) | D-7c에 포함 |
| **E-10** | v1 base64 위조가능 / 수신 스냅샷 base64 vs 발신 hex / Sharesnap 서명누락+retry=1 무검증 구멍 | 파트너 지시문 |
| 근본2 | delivery uid를 발신 서명 data에 포함 / 이벤트 카탈로그를 packages/types로 승격(자동 감시) | 발신·수신 동시 배포 |

### 10.5 잔여 작업
1. **quickstart 3종**(`examples/` 신설 — `example/`은 WowMall 타 프로젝트, rename은 오너 확인).
2. **문서 포털**(D-10d 신규 Vercel `storige-docs`) — ⚠️ **선결 D-10a**: 타 세션이 `PLATFORM_INTEGRATION_GUIDE.md`(포털 소스·파트너 정본)를 Shopify 가이드로 교체 중. **사본 `SHOPIFY_PLATFORM_INTEGRATION_GUIDE_2026-07-09.md` 생성 완료(비파괴), 타 세션 조율 대기**. GUIDE는 **pre-v1**(api/v1·books·creationType 0건) → v1 표면 등재가 본작업. 포털 제약: openapi-partner.json **gitignored**(빌드 시 생성) + **응답 스키마 부재**(경로·메서드·설명·상태코드만 렌더 가능).
3. **llms.txt/llms-full.txt**(전례 0) / **`/embed` subpath**(postMessage **수신 명령 목록 미확정** — CONTRACT_FREEZE는 발신 이벤트 9종만 동결. HANDOFF_Storige_postMessage_standardize_2026-06-01.md 확인 선행).
4. 커밋 트레일러: 이 세션 전반은 `Claude Fable 5`, SDK 후반부터 **`Claude Opus 4.8`**(실제 모델 귀속 정정). master는 혼재 — history 재작성은 force-push 게이트라 미실시.
