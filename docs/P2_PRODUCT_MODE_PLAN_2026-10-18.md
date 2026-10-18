# 상품별 편집 모드 P2 개발 계획 (2026-10-18)

> 정본 설계: `docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`(§6 시트/면 모델·§8 외부 연동·§11 로드맵·§13 결정), 캘린더 세부 `docs/CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`. P1 결과: `docs/CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`(상태 머리말), 운영 반영 `docs/DEPLOYMENT.md` 「P1 캘린더 운영 반영 절차」.
> 라이브 상태 SSOT 는 `.cursor/plans/RESUME_PROMPT_2026-10-04.md` §2·§5.2.8. 비공개 결정·실측은 `../_private_notes/wave12/P1_CALENDAR_DECISIONS_2026-10-17.md` 「P2 착수」 이후 절.

## 0. 출발점(2026-10-18)

- master `af900212`(캘린더 P1 전체) 운영 반영 완료 — api `1f175ce9a99b`·worker `df1f28f153ac`, Vercel editor/admin Ready, `[FLAGS-CHECK] api ok n=15`. 운영 샘플 세트 7종 등록은 오너 보류.
- 캘린더 완료 PDF: 26쪽 단일 PDF, 도련 정책 A(세트 `cropMarkEnabled`+`bleedMm 3`, 판형=재단) → 워커 경고 0.
- 오너 결정(2026-10-18): **P2 순서 = 런처(§8.1) → sheet-map(§6) → 사진인화(①②③·인화)**. §13-2 `backRotation 0`·`duplexFlip 'short-edge'` 유지. §13-8 외부 서비스 연동 순서 **jumbocard → insta_print → Frameshop → 100p**(어댑터·샘플 연동은 §8.3 후속). §13-3 옵션 어휘(페이퍼풀=cover, 이미지풀=contain, 유테=`frameInsetMm`)·§13-5 파트너 운영자 계정은 설계안 기본값으로 진행하고 검증 시점에 재확인.

## 1. 범위와 순서

| 서브웨이브 | 범위 | 상태 |
|---|---|---|
| **P2-a 시트 맵 기반** | types `ProductOutputMode 'single-pdf'\|'sheet-map'`·`sheetFiles`·결합 검증, `SheetFaceRef/SheetSpec(+role 'post-process')/SheetMapSynthesisJobData`; api `edit-sessions/sheet-map.ts` `buildSheetMap(profile, pageCount, {postProcessPages?})` 순수 함수(same-sheet·offset-next·canvas-per-sheet, protectedIndices 선행/후행 단면, binding 결합 규칙, 결과 불변식) + 골든 spec 16; DTO `output.mode`·`sheetFiles` 허용값 | 구현 완료(2026-10-18, 미커밋) |
| **P2-b 런처** | 기존 파트너 v1 스택에 `POST /api/v1/sessions/launch`·`GET /api/v1/sessions/:id/deliverables`·`POST /api/v1/sessions/:id/synthesize`(PartnerApiKeyGuard·멱등·레이트리밋·봉투 승계). launch = 템플릿셋 사이트 스코프 확인 → 세션 선생성(`metadata.launch/orderOptions/items/calendar/externalPhotos/productProfile/revision`) → shop-session 동일 토큰 발급; deliverables = 세션·최신 합성 잡 → status/product/calendar/files(`auth:'api-key'\|'signed'`); synthesize = `duplex-split` 세트 재합성(revision 증가, requestId ≤36자). 킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED`. SDK `client.sessions.{launch,deliverables,synthesize,waitForDeliverables}`, 웹훅 `synthesis.*` payload `revision?`, CONTRACT_FREEZE v1.23 ADDITIVE | 구현 완료·로컬 e2e 통과(2026-10-18, 미커밋): launch 201 → `/embed?sessionId&token&refreshToken` 진입 → 완료 → deliverables `complete`(single api-key 파일) · synthesize 422(duplex-merged)/201 revision+1(duplex-split). 보강 2: launch `calendar.startYm` → `metadata.calendar{startYear,startMonth,anniversaries:[]}` 변환 + 편집기 신규 세션 경로 메타 복원 |
| **P2-c sheet-map 워커 모드** | worker `mode:'sheet-map'` 핸들러(per-sheet / merged-duplex, back.rotate 0만 운영 — 180 은 코드 경로만), `createSheetMapJob`, `applyPdfOutputMode` 분기(`profile.output.mode==='sheet-map'` + 서버 스위치), `synthesize` 라우트가 sheet-map 세트도 재실행, 골든(13시트 same-sheet/offset-next × rotate 0/180, LIGHTWEIGHT ON/OFF 동일, 기존 5 mode 불변) | 구현 완료·로컬 e2e 통과(2026-10-19, 미커밋): 완료 시 sheet-map 잡 자동 발행(13시트, duplex-split 무시) → 워커 per-sheet 13파일(2쪽, 회전 0) → deliverables `ready`·`sheets` 13·시트 파일 13 서명 URL → synthesize revision 2 → merged-duplex 로 재합성 revision 3 → 26쪽 합본 1파일. 골든 22(ON/OFF 동일)·api 153스위트. 계약 결정: 뒷면 회전은 상대 +180(ON qpdf `--rotate=+180` / OFF pdf-lib setRotation), `merged-duplex` 는 back 없는 시트에 **빈 면 삽입**(양면 정렬), `role:'post-process'` 시트는 항상 별도 `set` 파일, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`(17키). 입력 오류는 기존 코드(`INVALID_OUTPUT_OPTIONS`·`PAGE_COUNT_MISMATCH`). 빈 면·post-process 처리는 오너 확인 권장 |
| **P2-d 사진인화** | `ProductKind 'photo-print'` additive(types validate·DTO), PhotoPrintPlugin(fitMode/frameInsetMm/date-overlay/grayscale)·PHOTO_PRINT 메뉴·항목 패널·`metadata.items`·`upload{maxPhotos,maxMb}` 강제, `editor.complete` `items` 키, 인쇄 ① 자유 뒷면·② `backTemplateId` 잠금 시드·③ 카드형 `pages range step 2`, 인화(chemical, faces 1) PDF; 직렬화 등재 검사(`extendFabricOption`) 테스트 | 미착수(§13-3 기본 매핑) |
| **P2-e 운영자 콘솔** | admin EditSessionList 드로어(세션 산출물·시트/zip 다운로드·production 메모) — §9.1 Storige 콘솔 경로만(§13-5 기본값) | 미착수 |
| **§8.3 어댑터(후속)** | jumbocard → insta_print → Frameshop → 100p 순 샘플 연동(런처 2회 호출) | 오너 순서 확정, 착수 미정 |

비범위(P3): 면별 JPEG(`rasterize`), 1세션 사이즈 혼합, sheet-map N-up·미러·마커, worker `spiral`, `TemplateSetType` 라벨, 메뉴·브랜딩 사이트 기본값.

## 2. 지켜야 할 원칙(P1 과 동일)

- additive-only. `docs/CONTRACT_FREEZE.md` FROZEN 표면 불침범. 신규 v1 라우트는 `partner-v1-guarded.spec`·`partner-openapi-surface` 동시 등재, CONTRACT_FREEZE 같은 커밋.
- 프로파일 NULL 세트·기존 잡·웹훅은 바이트 동일(새 키는 런처 세션·재합성 잡에만).
- 모드 트리거는 템플릿셋 `product_profile` — `TemplateSetType`·`EditorMode`·`PdfOutputMode`·`OutputFile.type`·`SessionMode` enum 무변경.
- 비즈니스 로직(세션 `mode` 의미, 사진인화 옵션 어휘, 시트 짝 규칙)은 추측하지 말고 오너에게 질문. 참조 편집기 코드·DOM·CSS 복제 금지.
- 커밋·push·배포는 오너 승인 후 명시 경로. 공개 저장소 — gitleaks.

## 3. 완료 기준

- P2-b: 로컬 e2e — 사이트 editor 키로 launch → `/embed?sessionId&token&refreshToken&parentOrigin` 진입(신규 URL 파라미터 0) → 편집완료 → deliverables `complete`(duplex-merged 세트) 또는 `ready`+`sheet` 파일(duplex-split 세트) → synthesize → `revision` 2·웹훅 payload `revision`. 단위·http spec·guarded·openapi-surface·compose-parity·feature-flags·SDK routes(25)·types-parity 통과. 운영 배포 시 `FLAGS_EXPECTED_API` 키 추가(n=16).
- P2-c: 골든 고정 + 기존 5 mode 골든 불변 + 벽걸이/카드형 샘플 세트 1건 e2e(sheet-map per-sheet 13시트).
- P2-d: NULL 세트 스냅샷 전부 통과, 사진인화 세트 생성→저장→재오픈 시 fitMode/inset 유지, 완료 시 N쪽 PDF + `items` 키 계약 테스트, 25캔버스 PDF 생성 시간 실측.

## 4. 검증 기준선(2026-10-18, P1 운영 반영 직후)

api 82스위트/2054(edit-sessions·worker-jobs·templates·contract-freeze·config 부분) · worker 35/1328 · canvas-core 62/722 · editor 119/1700 · admin 23/281 · sdk 380 · tsc 6패키지 · eslint 0 error(경고 기준선 editor 76·worker 16·api 44 이하).

## 5. 위험과 대응

- `worker_jobs.request_id VARCHAR(36)` 대 현행 `applyPdfOutputMode` 키 86자 — 런처는 36자 이내 키로 회피, 기존 경로는 운영 컬럼 길이·sql_mode 실측 후 별건.
- 멱등 스냅샷(24h)이 launch 응답의 access/refresh 토큰을 보관(토큰 1h) — 같은 키·같은 사이트에만 재전달. 키 평문 비교(§14)는 v1 가드 위임으로 동일 노출면; 파트너에겐 v1 키(SHA-256) 발급 권장.
- test 키 launch 의 재합성 잡은 `isTest` 미스탬프 → 실제 산출물 생성(오너 결정 전 허용, 문서화).
- 운영 폰트 라이브러리에 템플릿 폰트가 없으면 완료 PDF 텍스트가 래스터 폴백(TRANSPARENCY_DETECTED).
- 벽걸이 (나) 25쪽 프리셋은 `faces=2 → count 짝수` 규칙과 충돌 — 캘린더는 오너 결정으로 26면이라 무관, 사진인화 카드형은 step 2.

- 보안 리뷰(2026-10-18, 차단급 없음) 반영: 세션 metadata 서버 소유 키 보호(`launch`·`revision`·`production`), synthesize 진행 중 잡 재사용, launch 본문 256KB 상한, 자동 duplex-split 잡 회차 키. 미반영(후속): launch 응답 토큰이 멱등 스냅샷(24h)에 보존, v1 발급 키로는 `auth:'api-key'` 파일 URL 미지원(사이트 editor 키 한정 — 문서화).

## 6. 산출물과 문서

코드: 위 레인별 파일. 문서: 설계안 §11 P2 행 상태, CONTRACT_FREEZE v1.23, `docs/PLATFORM_INTEGRATION_GUIDE.md` 런처 절(오너 dirty 해소 후 — 초안은 비공개 노트), `docs/DEPLOYMENT.md` 배포 절(FLAGS 키·킬스위치), RESUME §2·§5.2.8. 비공개 메모: `../_private_notes/wave12/`.

## 7. 2026-10-18 e2e 에서 드러난 기존 결함(수정 포함)

- **duplex-split 자동 잡 request_id 86자 > VARCHAR(36)**: 편집 완료 시 `applyPdfOutputMode` 가 `duplex-split-<세션uuid>-<파일uuid>` 를 넣어 strict 모드에서 "Data too long" → 잡 생성이 조용히 실패(완료는 유지). 수정: 고정 태그 `duplex-split`(유일성은 `session_id+pdf_file_id+request_id` 복합 유니크), 런처 재합성은 `duplex-split-r<revision>`. 회귀 spec 추가.
- **워커 파일 메타 조회 401**: split·duplex-split·spread 핸들러의 `getFileById` 가 JWT 전용 `GET /files/:id` 를 `X-API-Key` 로 호출. 운영 DB 실측(2026-10-18) SYNTHESIZE 12건 전부 mode NULL → 세 분기는 운영 미실행이라 미노출. 수정: `GET /files/:id/external`(@Public+ApiKeyGuard, `download/external` 사이트 규칙) 신설 + 워커 호출 전환, CONTRACT_FREEZE v1.23 보강.
- 로컬 e2e 환경 메모: 사이트 editor 코드가 worker 코드·`WORKER_API_KEY` 와 같으면 모든 호출이 'worker' 역할(런처 403) → 로컬 사이트는 editor 코드를 분리. worker-local 에도 `WORKER_API_KEY` 주입 필요. `OUTPUT_SIGN_SECRET` 없으면 완료 잡 deliverables 503.
