# 캘린더 편집기 기능 확장 계획 (2026-10-21, CTO — 서브에이전트 병렬 트랙)

> **상태(2026-10-24 v3.1 · W1 진행 중 — T1a 완료 §8.1, T2 운영 반영 완료 10-22 23:48 KST; 10-23 D12 방어선 `max_allowed_packet` 256M 운영 적용·HTML 시각화 추가; **10-24 오너 결정 D1~D11 답변 완료(전부 CTO 권고안, §5)** → T3a·T3c(신설)·T1b 착수 가능, T5 는 D3(제작사 샘플 확정 후) 대기, B8 보류)**: P1 캘린더(master `af900212`, 2026-10-18)와 P2-a~d·D11~D13(master `11383962`, 2026-10-21 15:55~16:00 KST)이 운영에 반영된 뒤, **캘린더 편집기 기능**을 중심으로 이어갈 개발 계획이다. 설계 정본은 [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md)(§11 로드맵·§13 결정), 캘린더 세부는 [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md)(C1~C12), P1 결과는 [`CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`](./CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md), P2 결과는 [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md). 운영 반영 기록은 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 「P1 캘린더 운영 반영 절차」·「P2-d」 절 끝 「반영 기록」. 라이브 상태 SSOT 는 `.cursor/plans/RESUME_PROMPT_2026-10-04.md` §2·§5.2.8. 이 계획의 한 장 시각화는 [`CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.html`](./CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.html)(결정·근거 그림 4종·실측·트랙/wave·위험, 10-23), 다음 세션(서브에이전트 오케스트레이션) 시작 프롬프트는 `.cursor/plans/CALENDAR_EDITOR_ORCHESTRATION_SESSION_START_PROMPT_2026-10-24.md`.
> 작성 근거: 상위 세션 노트(`side-session-notes/…/p1-calendar-decisions-2026-10-17.md`·`p2d-e2e-findings.md`·`p2d-e2e-round2-2026-10-20.md`)·설계/계획/배포 문서를 독립 리더 에이전트가 읽은 인벤토리 → 코드 확인 에이전트가 미확인 10항목을 `file:line` 으로 확정 → 기획 2안·심사·합성 → 회의론자 검증(반박 2건 반영: W1 실행 환경 분리, W3 `TemplatePlugin.ts` 단일 소유). 코드가 문서보다 권위다.

---

## 0. 현황 통합 (2026-10-16 ~ 10-22, 상위 세션 + 이 세션)

| 일자 | 커밋 | 내용 | 운영 |
|---|---|---|---|
| 10-17 | `19f1ce7c` → master `1542d20a` | P0 낱장 N장 PDF·IIFE 배열 저장·duplex-split 쪽수 원천 + (가) 낱장 분류 검증(`productKind='sheet'`, 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`) | 10-17 반영(롤백 태그 `rollback-pre-sheet-20261017`) |
| 10-17 | `1a0d80e3`·`638b7288`·`0c670adc`·`52563190`·`af900212` | **P1 캘린더** — 템플릿셋 `product_profile`(마이그레이션 `20261017_add_template_set_product_profile.sql`)·`CalendarPlugin`·`calendar/core`·날짜 데이터 `kr-2025-2035-v1`·달력 메뉴/패널·`metadata.calendar`·완료 `product` 키·admin 프리셋 7종·샘플 스크립트·CONTRACT v1.22; 자동저장 누락 수정; dev 부팅 복구; 완료 PDF 워커 경고 0(coverSpine none·export 옵션·도련 정책 A·임시공휴일 고객 선택) | **10-18 00:48 KST 반영**(api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`, 롤백 태그 `rollback-pre-calendar-20261018`) |
| 10-18 | `f43cb99e` | **P2-a** 시트 맵 기반(`buildSheetMap`·`SheetSpec`·`output.mode`) + **P2-b** 파트너 v1 런처 3라우트(`launch`·`deliverables`·`synthesize`, 킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED`)·`GET /files/:id/external`·SDK `client.sessions`·CONTRACT v1.23; duplex-split request_id 길이·워커 파일 메타 401 결함 수정 | 10-21 반영 |
| 10-19 | `9be4c37c` | **P2-c** worker `sheet-map` 모드(per-sheet/merged-duplex, 골든 22) + 완료 시 자동 발행(`SHEET_MAP_OUTPUT_ENABLED`) + 파트너 재합성·deliverables `sheets`·CONTRACT v1.24 | 10-21 반영 |
| 10-20 | `237e6b91` | **P2-d** 사진인화(photo_chem·인쇄 ①②③) — types `'photo-print'`·`PhotoPrintPlugin`·`PHOTO_PRINT` 패널·`metadata.items`·런처 `items`·sheet-map `copies/label` 주입·deliverables `items`·admin 프리셋 4종·CONTRACT v1.25 + 적대 리뷰 36건·로컬 e2e 결함 D1~D10 수정 | 10-21 반영 |
| 10-20 | `2952aa09` | P2-d 2차 로컬 e2e 기록 — ② 고정 뒷면·③ 카드형 완료, 26캔버스(사진 13장) 저장+PDF 7.6s·완료 9.9s·PDF 9.3MB, 킬스위치 리허설 2종, 결함 D11~D13 발견 | — |
| 10-21 | `11383962` | **D11~D13 수정** — 초기 고정 뒷면 잠금(`initPhotoPrintSeededCanvas`), 틀 채움 storage 업로드 URL(`resolveFrameFillImage`, canvasData base64 제거 — MariaDB 16MB 패킷 초과 결함 해소), 워커 sheet 분리본 미참조 XObject 정리(`pdf-prune-xobjects.ts`) | **10-21 15:55~16:00 KST 반영**(master ff `af900212`→`11383962`, api `fcad1293f0e6`·worker `4f73a4c4efb4`, `[FLAGS-CHECK] api ok n=17`·`worker ok n=9`, Vercel editor/admin Ready, 롤백 태그 `rollback-pre-p2abcd-20261021`, `.env.bak-20261021-p2`) |
| 10-21 | `e9725838` | 운영 반영 기록(DEPLOYMENT·P2 plan·CONTRACT 적용 시점). VPS 체크아웃 = 이 커밋 | — |
| 10-22 | `e756d726` | 문서 상태 정정(EDITOR·INDEX·RESUME·DEV_PLAN) + 이 계획 v1 | docs 전용 |
| 10-22 | `f422afed` | 이 계획 v2(코드 확정·반박 검증) + 설계 문서 드리프트 정정 메모 | docs 전용 |
| 10-22 | `2f3c0c25`·`49e1d71d`·`8d2f74fa`(브랜치 `worktree-t2-grid-anniversary-2026-10-22` → `p1-calendar-2026-10-17` cherry-pick `a087316c`·`680c8322`·`c040b68e`) | **W1 T2** 그리드·기념일 안전성 — calendar-grid '그룹 해제' 핫키 컨텍스트 은폐 + ControlBar 버튼 게이트 + GroupPlugin 회귀 테스트 8; store add/update 같은 날짜(양력 환산) 거부, 세션 복원 비파괴(중복 유지 + warn 1회); 테스트 +21, 변경 9파일 | **R GO**(상위 세션 독립 재검증: canvas-core 19·editor 표적 58 passed, tsc·eslint 0; 소유권·CONTRACT 이상 없음; `as any` 1건은 `8d2f74fa` 로 교체 확인 — ControlBar 테스트 4·tsc·eslint 0) → 오너 승인 → **10-22 23:48 KST 운영 반영**(master ff `c040b68e`, Vercel editor `dpl_HB9xHCKnVSJ5Aq18j5XRdymQjAa4` Ready, 운영 스모크 통과 — DEPLOYMENT 「W1 T2」 절). api/worker 무변경 |
| 10-22 | `0defad51`·`7faf4db6` | **W1 T1a 완료** — 캘린더 프리셋 3종 + 사진 13장 완료 PDF 실측·킬스위치 리허설 2종(§8.1), 발견 C1(낱장 검증 킬스위치가 프로파일 세트 검증을 깨뜨림)·C2(완료 중 이탈 시 draft 잔존), 결정 D10·D11 신설, DEPLOYMENT (가)·P1 롤백 절 경고 | docs 전용. T2 는 worktree 세션 진행 중(작성 시점 표기 — 이후 10-22 23:48 운영 반영) |
| 10-23 | `dbc2333f` | **D12 방어선** — MariaDB `max_allowed_packet` 256M(compose 영구값 + 운영 `SET GLOBAL` 즉시 적용 + `docker compose restart api` 풀 갱신 + backup.sh dump 옵션), 오너 승인 | **10-23 10:13~10:16 KST 무중단 적용**(헬스 200; compose 값은 다음 mariadb 재생성부터 영구) |
| 10-24 | `41fbbb60`(브랜치 `p1-calendar-2026-10-17`, origin push) | 이 계획 v3·HTML 동기·RESUME 10-24·새 세션 시작 프롬프트(`.cursor/plans/CALENDAR_EDITOR_ORCHESTRATION_SESSION_START_PROMPT_2026-10-24.md`)·CI 회귀 기록 | docs 전용(master 미병합) |
| 10-24 | `3e1d5317`·`200a2bd0`·`4d3d1131`·`0db77f5f`·`12de30af`(다른 세션, master) | 문서·포털 설정만 — GUIDE 변경 이력·런처 예시·Shopify 10-15 문서 추적·링크; **`200a2bd0` 가 CI 회귀(docs 포털 `groups` 에 `/api/v1/sessions`) 수정** | master push 10-24 05:11Z(코드 무변경, Vercel 빌드 생략) · p1-calendar 는 분기(master 5 앞·p1 2 앞, 병합 방식 오너 결정) |
| 10-24 | `42861260`·`3fa6b6be`(브랜치 `p1-calendar-2026-10-17`, origin push) | origin/master `12de30af` 를 p1-calendar 에 병합(머지 커밋) — 분기 해소, master 는 p1-calendar 를 ff 로 받을 수 있음(코드 차이 0) | docs 전용 |
| 10-24 | (이 갱신) | 오너 결정 D1~D11 답변(§5)·T3c 행 신설(§3)·기준선 재실행 행(§7)·CI 회귀 해소 확인(`12de30af` run 40065286057 success) | docs 전용 |
| 10-23 | `2d45fd54`(브랜치 `p1-calendar-2026-10-17`, origin push) | 이 계획의 HTML 시각화 `CALENDAR_EDITOR_FEATURE_PLAN_2026-10-21.html` — 결정 D1~D11 카드·근거 그림 4종(산출 경로·벽걸이 2단 짝/타공·C1 킬스위치·wave)·T1a 실측·트랙 소유권·위험; 원문 대조 리뷰 314항목·디자인 QA 반영 | docs 전용(master 미병합) |

**운영 현재(2026-10-22 읽기 전용 확인)**: `template_sets.product_profile IS NOT NULL` 0건(캘린더·사진인화 세트 없음), 프로파일 스냅샷을 가진 세션 0건 → 운영 고객 영향은 아직 없다. 운영 worker 는 `WORKER_LIGHTWEIGHT_SYNTHESIS=true`(qpdf 경로). **오너가 아직 안 한 것**: 캘린더 샘플 세트 7종·사진인화 샘플 세트 4종 등록(운영 관리자 자격증명 — `--dry-run` → `--allow-remote`), ~~mariadb `--max-allowed-packet` 상향~~(**10-23 적용 완료**, `dbc2333f`), 운영 폰트 라이브러리에 템플릿 폰트('본고딕(Noto Sans) Regular') 존재 확인.

**트랙 외 후속(이 계획에서 제외)**: P2-e 운영자 콘솔(설계 §9), §8.3 외부 연동 어댑터(jumbocard → insta_print → Frameshop → 100p), P2-d 오너 결정 값(판형·chemical 도련·유테·업로드 한도·촬영일 형식), O2(프로파일 NULL 세트 2페이지 이후 `applyCustomerLocks` 공백 — 기존 동작). 단 T1b·T5 의 실측은 캘린더와 공유하는 sheet-map 재합성·deliverables 경로까지 덮는다.

## 1. 캘린더 편집기 기능 인벤토리 (설계 C1~C12 대비 코드 현황, 2026-10-22 코드 확정)

상태: ✅ 구현·실측 / 🟡 부분 / ❌ 미구현. 근거는 코드 `file:line`(브랜치 HEAD `e756d726`, 코드 = `11383962`).

| # | 기능(설계 번호) | 상태 | 근거·메모 |
|---|---|---|---|
| 1 | 시작연월 설정 + 허용 범위 밖 거부(C1) | ✅ | `apps/editor/src/components/calendar/CalendarPanel.tsx:170-200`·`calendarPanelUtils.ts`; 런처 `calendar.startYm` 전달은 P2-b(`partner-sessions.service.ts:539-585`) |
| 2 | 시작연월 변경 시 편집 보존(상대 월 재계산, `monthOffset` override) | ✅ | 오너 답변 2026-10-16 반영; 기본은 캔버스 위치로 월 결정(`resolveCalendarCanvasSlot`) |
| 3 | 표기 옵션 토글 — 공휴일/음력/절기(C2) + 임시공휴일·선거일(고객 선택, 기본 off) | ✅ | `packages/types/src/product-profile.ts` `show.*`; `CalendarPanel.tsx:221-225` 체크박스 4종; 2028 선거일은 데이터 미추가(오너 결정) |
| 4 | 월 그리드 자동 생성(C3) — 6주·요일 헤더·일요일/공휴일 빨강·공휴일명 | ✅ | `packages/canvas-core/src/calendar/core.ts:214-225`, `plugins/CalendarPlugin.ts:306-438` |
| 5 | 전월·익월 미니 달력(variant `mini`, `monthDelta`) | ✅ | `CalendarPlugin.ts:21`, `CalendarGridTools.tsx:133-141`(editMode 전용 버튼 3개) |
| 6 | 그리드 = 단일 객체(fabric.Group)(C4) + 그룹 해제 차단 | ✅ | 차단은 `GroupPlugin.ts:56-60` 의 `extensionType==='calendar-grid'` 조기 return(lockInfo 아님). `ControlBar.tsx:735-744` '그룹해제' 버튼·핫키 `ctrl/cmd+backspace`(`GroupPlugin.ts:27`, hideContext `:31-34` 는 type 만 검사)는 노출된 채 무동작, 전용 테스트 없음 → B2 **T2 반영(10-22, master `c040b68e`)**: `hideContext` 에 calendar-grid 조건, ControlBar 버튼 게이트, GroupPlugin 회귀 테스트 8 — 운영 스모크 통과 |
| 7 | 날짜칸 더블클릭 → 기념일 편집(C5) | 🟡 | `useCalendarGridDblClick.ts`(variant 필터 없음); 폼은 연·월·일·음력·윤달·문구만 — 기념일 **스타일**(`CalendarAnniversaryStyle`)은 타입·복원만 있고 입력 UI 없음 → D1 |
| 8 | 기념일 목록 관리 + 범위 밖 '초기화됨' 배지(C6) + 같은 날짜 중복 거부 | 🟡 | 중복 거부는 `CalendarPanel.tsx:295-299`+`calendarPanelUtils.ts:86-107`(UI 전용); `useCalendarStore.ts:113-130` add/update·복원(`calendarRehydrateAll.ts`)·런처 입력(`partner-sessions.service.ts:570-584`)은 무검사 → B2 |
| 9 | 월 단위 페이지 구성·라벨(C7) — fixed 26·protected [0,25]·labelRule `month`·SidePanel 추가/삭제 숨김 | ✅ | `product-profile.ts:140·:475`; 13캔버스→26캔버스는 P1 오너 결정(DEV_PLAN §1-2 표기는 설계 시점 값) |
| 10 | 표지·에필로그 캔버스(`coverCanvases`/`epilogueCanvases`) | ✅ | 페이지 구조로서만; 연도 선택·연달력은 #12 |
| 11 | 제작 가이드 오버레이(C11) — 링 바인딩·재단선 화면 전용 | ✅ | `TemplatePlugin.ts:46-48` 어휘 `ring-overlay`·`cut-guide` 등록; 인쇄 제외는 `ServicePlugin.ts:939-962`(printExclude→excludeFromExport), 화면 표식 `apps/editor/src/utils/printExcludeOverlay.ts`; 재단선 표시는 WorkspacePlugin crop-marks. **`cut-guide` 생산자 0건**(등록만 된 어휘) → T5 에서 정리 |
| 12 | 표지/연달력 연도 선택·연달력 그리드(variant `year`)(C8) | ❌ | `CalendarPlugin.ts:21` `'month' \| 'mini'`, rehydrate `:222` 는 그 외 variant skip; 설계 2단계 항목·로드맵 미배정 → B3 |
| 13 | 페이지 수 규칙(C9) — 가변 달 수·고정날짜 달력 | ❌ | `product-profile.ts:133` `monthCount: 12` 리터럴·`:435` 검증 → B8(보류) |
| 14 | 달력폼/디자인 일괄변경·내지 스킨셋(C10) | ❌ | 설계 C10 한 줄; 로드맵 미배정 → B6 |
| 15 | 24절기(C12)·대체공휴일·음력 환산·음력 기념일·주 시작 요일 | ✅ | `data/kr-2025-2035-v1.ts`, `core.ts`(KASI 2025~2028 대조). **잡절(초복·중복·말복)은 ❌** — 데이터 스키마(`calendar/types.ts:22-26·:46-59`)·생성 스크립트(`packages/canvas-core/scripts/gen-calendar-data.mjs`)·렌더 모두 없음 → B4 |
| 16 | 정적 날짜 데이터 2025~2035 v1(`dataVersion`, 외부 API 없음) | ✅ | 2029~2035 음력·절기는 공표 전 알고리즘 산출 → KASI 공표 후 대조·릴리스 승인 필요; `gen-calendar-data.mjs` 는 CLI 옵션 없이 `OUT_PATH` 로 무조건 쓰고 `generatedAt` 이 들어가 재실행 diff 가 생김 → B4 |
| 17 | 날짜 그리드 스타일(폰트·크기·색·헤더 언어·셀) 편집 UI | ❌ | `CalendarGridStyle`(`CalendarPlugin.ts:23-45`)은 템플릿 JSON `extension.style` 로만 주입 — 유일한 설정처가 `scripts/register-calendar-samples.mjs:154`. 고객·관리자 모두 입력 UI 없음 → B7(관리자 최소 입력) |
| 18 | 탁상 4종(라지·베이직·티니·미니, 삼각 스탠드 비편집, 26면) | ✅ | 운영 반영; 샘플 등록 오너 보류; 로컬 e2e 는 탁상 라지·베이직만 |
| 19 | 벽걸이 (가) 1단 원피스 A3(layout `wall-1`) | ✅ | 2026-10-22 T1a 실측 통과(§8.1: 완료 14.5s, 26쪽 434KB, 검증 warnings []) |
| 20 | 벽걸이 (나)(다) 2단 A4/A3(layout `wall-2`) | 🟡 | 편집·완료 PDF 는 2026-10-22 T1a 실측 통과(§8.1 wall2_a4: 상단/하단 라벨, 26쪽 landscape, warnings []); 판형 = 전체 높이/2 는 inferred, 시트 짝 규칙(설계 §13-1 기본 same-sheet vs P1 구현 offset-next)·타공 위치(center-punch 는 same-sheet 만 허용 `sheet-map.ts:157-158`) 오너 미결 → D3·T5 |
| 21 | 양면 시트 출력 경로 — single-pdf / duplex-split 13세트 / sheet-map per-sheet·merged-duplex·재합성 | 🟡 | **운영 프리셋 7종·샘플 스크립트 모두 `output.mode='single-pdf'` + `pdfOutputMode='duplex-merged'`**(`calendarProfilePresets.ts:50·:94`, `register-calendar-samples.mjs:50·:243`) → 편집기 26쪽 단일 PDF 가 최종이고 sheet-map 잡은 발행되지 않는다(`edit-sessions.service.ts:1958-2003`). 노트의 sheet-map 13시트 e2e 는 로컬 프로파일 전환 세션 → 인쇄소 사양 결정 D8 |
| 22 | 완료 PDF 검증(프로파일 쪽수·coverSpine none·도련 정책 A·경고 0)·글리프 검증 | ✅ | 워커 잡 실측 `warnings []`(탁상) |
| 23 | 사진 배치(사진틀 + 그리드)·자동편집(photoAutofill) | ✅ | 캘린더 전용 분기 없음(`photoPlacement.ts:232·:248·:360` frame+contentEditable 게이트). 2026-10-22 T1a 실측(§8.1 desk_large): '내 업로드' 13장 → 자동편집 13/26 틀(storage URL src) → 완료 31.4s(PDF 생성 30.7s)·PDF 18.7MB·heap 피크 487MB·검증 warnings []·imageCount 13. 단, **사진틀 클릭 채움**은 캘린더 세트에서 종전 data URL 경로(D12 수정은 사진인화 세트 전용)라 사진 수가 많으면 canvasData 가 커진다 — 자동편집·내 업로드 경로 권장(B2/B11 후보) |
| 24 | 세션 `metadata.calendar` 저장/복원·`metadata.productProfile`(서버 소유)·완료 `product` | ✅ | CONTRACT v1.22·v1.25 |
| 25 | admin 캘린더 프로파일 JSON·프리셋 7종·`scripts/register-calendar-samples.mjs` | ✅ | `calendarProfilePresets.test.ts` = 7 it + `it.each`×7(=14 케이스); 운영 등록은 오너 |
| 26 | 테스트 | — | 'calendar' 언급 테스트 34파일(canvas-core 5·editor 13·api 10·admin 3·sdk 3; types 0·worker 0), 파일명에 calendar 가 든 핵심 11파일(canvas-core 53 it·editor 56 it·admin 8 it) |

## 2. 백로그 (우선순위 — 고객 가치 × 출시 필요성 × 위험)

| 순위 | ID | 항목 | 왜 지금 | 범위 | 오너 결정 |
|---|---|---|---|---|---|
| 1 | B1 | **캘린더 회귀 e2e 하네스** — 벽걸이 1단(A3)·2단(A4) + 사진 13장 자동편집 탁상 라지 26캔버스를 런처 세션으로 완료; 산출 경로 3종(프리셋 기본 single-pdf+duplex-merged / 프로파일 sheet-map 전환 / `pdfOutputMode` duplex-split) 실측; 킬스위치 2종 리허설; 시간·PDF 바이트·heap·pdffonts 기록 | 운영 반영된 세트 중 벽걸이·사진 포함 캘린더는 실측 0건이고, 운영 프리셋 기본 경로(single-pdf)와 노트 실측(sheet-map)이 다르다 — 샘플 등록·고객 노출 전 마지막 게이트. 코드 변경 없어 즉시 착수 | 사진인화 2차 하네스(파일 주입 훅·런처 세션·`setPage`) 재사용; 결함은 재현 절차+원인 `file:line`+수정안으로 보고(수정은 승인 후) | D8(경로 결정 근거 제공) |
| 2 | B2 | **그리드·기념일 안전성** — `GroupPlugin` calendar-grid 가드 회귀 테스트 + hideContext·ControlBar '그룹해제' 버튼 비노출; 기념일 동일 날짜 거부를 `useCalendarStore.addAnniversary/updateAnniversary` 로 확장; 복원(`calendarRehydrateAll`)은 **비파괴**(중복 유지 + console.warn) | 설계 완료 기준 C4·C6 이 플러그인 조기 return 과 패널 폼에만 있고 테스트·store·복원 경로가 비어 있다. 눌러도 무동작인 버튼은 UX 결함. 복원 경로에서 삭제하면 기존 세션·런처 입력 기념일이 조용히 사라진다 | canvas-core `GroupPlugin`(+신규 테스트), editor `ControlBar`(버튼 게이트)·`useCalendarStore`·`calendarRehydrateAll`(+테스트), `calendarPanelUtils.findDuplicateAnniversary` 재사용(store 는 `getCalendarData(meta.dataVersion)` 으로 data 를 얻음) | 없음 **✅ T2 완료·운영 반영 10-22**(§0) |
| 3 | B3 | **연달력·연도 선택(C8)** — core 연 매트릭스·`CalendarPlugin` variant `'year'`·프로파일 additive 옵션(types+DTO+CONTRACT 한 커밋)·editMode '연달력 추가' 버튼·고객 패널 표지/에필로그 연도 표기 옵션·admin 프리셋·샘플 표지에 연달력 1개 | 표지·에필로그 캔버스는 있으나 연달력이 없어 참조 편집기 대비 완성도가 낮다. rehydrate 가 미지 variant 를 skip 하므로 additive 로 넣어도 기존 세션·NULL 세트 불변 | T3a(코어·계약) → T3b(UI). 더블클릭 훅은 variant 를 필터하지 않으므로 'year' 그리드는 기념일 폼 대상에서 제외 | D2(범위), D1(관리자 스타일 입력 동반) |
| 4 | B4 | **날짜 데이터 운영** — `gen-calendar-data.mjs` 에 `--out`/`--check`(generatedAt 제외 diff) 옵션, KASI 대조 체크리스트, `dataVersion` 릴리스 절차(DEPLOYMENT 절), 임시공휴일 overrides 운영, 잡절 additive 스키마+산출+표기 옵션(기본 off) | 2029~2035 는 공표 전 산출이라 연 1회 반복 작업을 코드·문서로 고정해야 하고, 잡절은 데이터·스키마·생성·렌더 모두 없다(설계 C12) | canvas-core `calendar/types`(`CalendarData.minorTerms?`)·data·gen 스크립트·overrides·`core`·`CalendarPlugin` cellNotes, types `show.minorTerms?`+DTO+CONTRACT, DEPLOYMENT 데이터 갱신 절 | D4 |
| 5 | B5 | **벽걸이 2단 확정 반영 + `cut-guide` 어휘 정리** — 판형·시트 짝 규칙·타공 위치·면 라벨을 프리셋·샘플 값에 반영; `cut-guide` 는 샘플에서 생산하거나 등록 제거 | 오너 제작 샘플 확정 전 템플릿 제작 금지(P1 노트). 데이터 어휘는 양쪽 pairing 을 지원하되 center-punch 는 same-sheet 만 허용하므로 타공 결정이 pairing 을 구속 | admin `calendarProfilePresets`(+test)·`register-calendar-samples.mjs` 값 변경, `TemplatePlugin.ts:48` 1줄(제거 시). 로직 변경 없음 | **D3(필수)**, D8 |
| 6 | B6 | **달력폼/디자인 일괄변경·내지 스킨셋(C10) 설계 계약** — 어휘(TemplatePlugin)·데이터(스킨 정의 주체·저장 위치)·UI(`AppTemplateSwap` 재사용 여부)·고객 편집 보존·롤백·CONTRACT 영향 | 고객 UX 차별화 항목이나 설계가 한 줄뿐이고 템플릿 무결성·세션 데이터 영향이 커 구현 전 계약 필요 | 문서만(o5-architect). 승인 후 구현 T7 분리 | D5 |
| 7 | B7 | **관리자(editMode) 그리드 스타일 입력** — `CalendarGridTools` 에 `CalendarGridStyle` 최소 4종(fontFamily·headerLang·showTitle·showLines); 고객용 스타일 UI 는 미제공 유지; 기념일 문구 스타일(C5)은 D1 범위만 | 스타일 설정처가 샘플 스크립트뿐이라 관리자가 편집기에서 템플릿을 만들 때 스타일을 정할 수 없다(B9 디자인 교체의 선행 조건) | T3b 에 포함(같은 editor calendar 컴포넌트 소유). canvas-core 변경 없음 | D1 |
| 8 | B8 | 가변 달 수·고정날짜 달력(C9) | 상품 요구 미확정 — `monthCount` 리터럴·pages fixed 26·faces 2 짝수 규칙 전제를 바꾸는 큰 변경 | 보류(설계 메모만) | D6 |
| 9 | B9 | 샘플 템플릿 실제 디자인 교체(재단선 밖 채움)·운영 샘플 7종 등록·운영 폰트 확인(~~`max_allowed_packet` 상향~~ 10-23 완료) | 고객 노출 전 필수지만 코드가 아니라 콘텐츠·운영 작업. 현재 샘플은 재단 안쪽만 채워 도련 3mm 가 흰 여백 | 에이전트 트랙 외(오너·디자인) | D7 |
| 10 | B10 | 완료 PDF 생성 진행 표시 UX(단계·캔버스 수) + 완료 중 이탈 경고(beforeunload) — **T1a 실측 30.7s(사진 13장)·25.9s(desk_mini)로 임계 도달** | 벡터화 13~31s 체감 대기가 길고, 생성 중 탭 이탈 시 세션이 draft 로 남는다(§8.1 C2). 생성 로직·watchdog 식은 무변경 | `embed.tsx` 완료 흐름 진행 표시·이탈 경고만 | D9 |
| 11 | B11 | 캘린더 세트 사진틀 클릭 채움을 storage 업로드 URL 로(D12 `resolveFrameFillImage` 의 사진인화 전용 게이트를 프로파일 세트 전체로 확장) | 캘린더 세트에서 틀 클릭 채움은 아직 base64 data URL — 사진 9장 이상이면 canvasData 가 MariaDB 16MB 패킷을 넘길 수 있다(D12 와 같은 결함 표면). 자동편집 경로는 이미 URL | `apps/editor/src/stores/useImageStore.ts` `resolveFrameFillImage` 게이트 1곳 + 테스트(NULL 세트 무변경) | D11(게이트 범위: 프로파일 세트 전체 vs 캘린더만) |

## 3. 병렬 트랙 (서브에이전트 분담 — 동시 3개·한 작업 총 6개·배타적 파일 소유권)

역할 ID 는 전역 지침의 `o5-*`(모두 `model: inherit`). **실행 환경 규칙**: 메인 체크아웃(`storige/`, 로컬 api-local·worker-local·editor 가 `nest --watch`·vite HMR 로 붙어 있음)은 T1a/T1b 실측 전용으로 두고, 코드 트랙(T2·T3a·T3b·T4·T5·T7)은 각자 git worktree(세션 `use_worktree`) 에서 작업해 실측 중 핫리로드 오염을 막는다. 모든 쓰기 트랙 공통 완료 기준: 프로파일 NULL 세트·기존 캘린더 세트 불변 — 저장소에 스냅샷 테스트가 없으므로 **명시 픽스처**(프리셋 7종·샘플 스크립트 프로파일·샘플 템플릿 JSON)의 `validateProductProfile`/`toJSON` 결과 diff 0 테스트로 고정; CONTRACT_FREEZE 영향 없음(있으면 ADDITIVE 개정을 types+DTO(+spec)+CONTRACT 행 **한 커밋**으로 — api DTO 는 whitelist+forbidNonWhitelisted 라 types 만 바꾸면 admin 저장이 400); 킬스위치(`VITE_ENABLE_CALENDAR` 정확히 `'false'`)로 메뉴·플러그인이 꺼져도 저장본 보존; 패키지 테스트·tsc·eslint 는 **기준선 대비 신규 실패 0**(§7). 소유 파일만 `git add <path>`(dirty worktree 의 사용자 문서·미추적 산출물 접촉 금지).

| 트랙 | 목표 | 역할 | 파일 소유권(배타) | 의존 | 완료 기준·검증 |
|---|---|---|---|---|---|
| **T1a 실측 — 기본 경로** ✅ 2026-10-22 완료(§8.1, 발견 C1·C2) | B1 — 로컬 샘플 7종 등록 상태에서 wall1_a3·wall2_a4·desk_large(+사진 13장 자동편집)를 런처 세션으로 열어 저장·재오픈·완료; 프리셋 기본 경로(single-pdf+duplex-merged); 킬스위치 2종 리허설; single-gen 시간·PDF 바이트·heap·pdffonts 기록 | `o5-frontend-qa` | 코드 변경 금지 — 결과는 이 문서 §8 실측표 + §1 #19·#20·#23 상태(메인이 반영) | 없음 | 세트 3종 완료 통과 또는 결함 재현 절차; 워커 잡 `isValid true`·`warnings []`, pdfinfo 26쪽·TrimBox 3mm, 사진 포함 시간·heap 수치 |
| **T1b 실측 — 전환 경로** | B1 — 같은 세트 3종을 로컬 세트 JSON 만 `output.mode='sheet-map'`(13시트 per-sheet)·`pdfOutputMode='duplex-split'`(13세트)로 바꿔 완료 → 잡 결과·산출 파일·deliverables `sheets`/`files[].copies`·wall-2 짝 매핑 표; 실측 후 원복 | `o5-test-build`(T1a 종료 후 순차, 같은 로컬 환경) | 코드 변경 금지 — §8 실측표 열 추가 | T1a, D8(범위) | 전환 경로 2종 × 세트 3종 통과 또는 결함 재현 절차; `result.sheetMap` echo·파일 수·쪽수 일치 |
| **T2 그리드·기념일 안전성** | B2 | `o5-implementer` | `packages/canvas-core/src/plugins/GroupPlugin.ts`(+`GroupPlugin.test.ts` 신규), `apps/editor/src/components/editor/ControlBar.tsx`(그룹해제 버튼 게이트만, +`ControlBar.calendarGrid.test.tsx` 신규), `apps/editor/src/stores/useCalendarStore.ts`(+test), `apps/editor/src/utils/calendarRehydrateAll.ts`(+test), `apps/editor/src/components/calendar/calendarPanelUtils.ts`(시그니처 보강만). **`CalendarPanel.tsx`·`CalendarGridTools.tsx` 금지** | 없음 | vitest 신규 ≥6(unGroup 가드 no-op·일반 그룹 해제 회귀·hideContext 핫키 숨김·버튼 비노출·store add/update 중복 거부·복원 중복 유지), 기존 calendar 테스트 통과 |
| **T3a 연달력 코어·계약** | B3 — o5-architect 가 1장 계약(additive 키 이름·기본값 undefined, variant `'year'` extension 형태·monthOffset 규칙, 구 번들 호환 = rehydrate 미지 variant skip 유지) → 구현 | `o5-architect` → `o5-implementer`(같은 트랙 순차) | `packages/types/src/product-profile.ts`(additive optional 만), `apps/api/src/templates/dto/product-profile.dto.ts`(+spec), `apps/api/src/templates/product-profile.spec.ts`, `packages/canvas-core/src/calendar/core.ts`(+test), `calendar/types.ts`(MonthMatrix 계열만 — `CalendarData` 는 T4), `plugins/CalendarPlugin.ts`(+test), `packages/canvas-core/src/index.ts`, `docs/CONTRACT_FREEZE.md`(v1.26 ADDITIVE 행, 같은 커밋) | D2 | core 단위 테스트(연 매트릭스·윤년·weekStart), 플러그인 직렬화 왕복, '미지 variant skip·크래시 없음' 테스트, 프리셋 7종·샘플 프로파일 픽스처 diff 0, sdk `types-parity` 통과 |
| **T3b 연달력 UI + 관리자 스타일 입력** | B3·B7 — editMode `CalendarGridTools` '연달력 추가' 버튼 + `CalendarGridStyle` 최소 입력(D1 범위), 고객 `CalendarPanel` 표지/에필로그 연도 표기 옵션, `useCalendarGridDblClick` 'year' 제외, admin 프리셋·샘플 표지 연달력 1개 | `o5-implementer`(T2·T3a 와 다른 에이전트) | `apps/editor/src/components/calendar/*`(T2 종료 후), `apps/editor/src/utils/calendarRehydrate.ts`(+test), `apps/editor/src/components/editor/FeatureSidebar.calendarDblClick.test.tsx`, `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts`(+test: 7 it + it.each×7), `productProfileJson.ts`, `scripts/register-calendar-samples.mjs` | T2·T3a·D1·D2 | 편집기 e2e(T1a 절차: 연달력 표시·재오픈 유지·PDF 포함), 'year' 셀 더블클릭이 기념일 폼을 열지 않음 테스트 |
| **T3c C1 코드 분리**(D10 승인 10-24 신설, W1 잔여) | D10 — 프로파일 세트(캘린더·사진인화)의 `deriveSheetValidationRules` 결과를 킬스위치 `EDITOR_SHEET_VALIDATION_RULES` 와 분리(현재 게이트는 `createValidationJobs` 의 `isEditorSheetValidationRulesOn()` 블록; `sheet-validation-rules.ts` 는 플래그를 모름) | `o5-implementer`(T3a 와 다른 에이전트) | `apps/api/src/edit-sessions/edit-sessions.service.ts`(해당 게이트 블록만)·`apps/api/src/edit-sessions/edit-sessions.service.spec.ts`(「createValidationJobs — 낱장 분류 규칙」 describe 에 it 추가만)·`apps/api/src/edit-sessions/sheet-validation-rules.ts`(+spec)·`docs/DEPLOYMENT.md`(P1 절 롤백 3항 '쓰면 안 되는 수단' 문구 정정만). **T3a 소유 파일(`packages/types`·`apps/api/src/templates/dto`·`packages/canvas-core`) 금지** | D10 | 플래그 off 에서도 productProfile 세션은 orderOptions 에 productKind/coverSpine/pageStep 이 실림(NULL 세트는 종전대로 플래그를 따름) spec 고정; 로컬 `api-local-sheetrules-off` 로 desk_mini 완료 → 워커 COMPLETED `warnings []`(§8.1 C1 재현 뒤 통과); api jest 신규 실패 0; FLAGS 키 수 무변경 |
| **T4 날짜 데이터 운영·잡절** | B4 — gen 스크립트 `--out`/`--check` → 현 데이터 결정성 확인 → 잡절 additive(2025~2028 공표값 대조 테스트 통과 후) → `dataVersion` 릴리스 절차·KASI 체크리스트(DEPLOYMENT 절) | `o5-implementer` + `o5-test-build`(dry-run·대조, 순차) | `packages/canvas-core/src/calendar/types.ts`(`CalendarData.minorTerms?`, T3a 종료 후), `data/kr-2025-2035-v1.ts`(+test), `data/index.ts`, `packages/canvas-core/scripts/gen-calendar-data.mjs`, `scripts/calendar-overrides.json`, `core.ts`·`CalendarPlugin.ts`(T3a 종료 후, cellNotes 만), `packages/types/src/product-profile.ts`(`show.minorTerms?`, T3a 종료 후)+DTO(+spec), `docs/CONTRACT_FREEZE.md`(ADDITIVE 행), `docs/DEPLOYMENT.md`(데이터 갱신 절) | D4·T3a | `--check` diff 0, 잡절 대조 테스트, 데이터 테스트 15 it+, `allowedRange` 2027-12 유지 확인 |
| **T4r 잡절 체크박스** | B4 잔여 — `CalendarPanel` 표기 옵션 '잡절(복날) 표시'(`show.minorTerms`, 기본 off) | `o5-implementer` | `apps/editor/src/components/calendar/CalendarPanel.tsx`(+test, T3b 종료 후) | T4·T3b | 신규 1~2 it, 옵션 변경 → rehydrateAll·`metadata.calendar.show` 저장 |
| **T5 벽걸이 2단 반영 + cut-guide 정리** | B5 — D3 확정값(판형·pairing·binding·faceLabels)을 admin 프리셋 wall2 2종·샘플 스크립트에 반영(center-punch 선택 시 pairing same-sheet 로 함께); `cut-guide` 생산 또는 등록 제거; 설계 §13-1 정정 | `o5-implementer` | `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts`(+test, T3b 종료 후), `scripts/register-calendar-samples.mjs`(T3b 종료 후), `docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`(§13-1). **`TemplatePlugin.ts` 는 W3 에서 단일 소유**: T6 승인 시 T7a 가 소유하고 cut-guide 제거는 T7a 에 1줄 위임, T6 미승인 시에만 T5 가 편집 | **D3**·T3b·T1b | 프리셋·샘플 값 = 오너 확정값(diff 첨부), admin 테스트, `--dry-run` 통과, 로컬 등록 후 wall-2 완료 PDF 26쪽·sheet-map 13시트 상단/하단 짝 일치·`warnings []`, api `sheet-map.spec`·`sheet-validation-rules.spec` 회귀 0 |
| **T6 C10 스킨셋 설계 계약** | B6 — 설계 1장(범위·비범위·데이터 스키마·UI·CONTRACT 영향·킬스위치·테스트 계획·소유권 분할) | `o5-architect` | `docs/CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md` 별도 절 또는 신규 설계 문서(문서만) | D5 | `o5-final-reviewer` 검토 + 오너 승인(게이트) |
| **T7 C10 구현(조건부)** | T6 승인 시 — 스킨셋 적용·일괄변경 | `o5-implementer`×2(T7a canvas-core / T7b editor+admin, 파일 배타) | 잠정 T7a `packages/canvas-core/src/plugins/TemplatePlugin.ts`; T7b `apps/editor/src/tools/AppTemplateSwap.tsx`·`apps/editor/src/components/calendar/*`(T4r 종료 후)·`apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` — 확정은 T6 계약 | T6·D5·T3b·T4r·T5 | T6 완료 기준; NULL 세트·기존 캘린더 세트 toJSON diff 0(픽스처); 스킨 적용 뒤 기념일·사진 보존 e2e |
| **R wave 통합 검토** | 각 wave 종료 시 diff·테스트 로그·픽스처 diff·CONTRACT 등재·킬스위치 리허설·소유권 대조 → GO/NO-GO | `o5-final-reviewer`(+`o5-security-reviewer`: 세션 metadata·계약 표면을 만지는 T2 복원·T3a·T4) | 읽기 전용 | wave 산출 | 기준선 대비 신규 실패 0, ADDITIVE 위반 0, 소유권 밖 파일 변경 0, 롤백 절차 확인 |

## 4. 실행 순서 (wave)

| wave | 실행(동시 ≤3, 총 ≤6) | 게이트 |
|---|---|---|
| **W0 결정·준비(메인 에이전트)** | 오너 질의 D1~D9 1회; 기준선 1회 재실행해 실패 목록 고정(§7); 로컬 샘플 7종 등록 확인; 코드 트랙용 worktree 준비 | T1a·T2 는 결정 없이 즉시 시작. D2→T3a, D1→T3b, D3→T5, D4→T4, D5→T6, D8→T1b 범위, D9→B10 |
| **W1 실측·안전성·코어** — 진행 중(T1a ✅ 10-22; T2 ✅ **운영 반영** 10-22 23:48 KST(master `c040b68e`, Vercel editor Ready, 운영 스모크 통과 — DEPLOYMENT 「W1 T2」 절); T3a 는 D2 대기) | T1a(메인 체크아웃) ∥ T2(worktree) ∥ T3a(worktree, architect→implementer) | T1a 실측표·결함 보고(수정 금지); T2·T3a 테스트·tsc·eslint; 픽스처 diff 0; CONTRACT v1.26 등재; R GO |
| **W2 전환 경로·UI·데이터·설계** | T1b(W2 초입, T3b 시작 전 종료) → T3b ∥ T4 ∥ T6(문서) | T3b e2e(T1a 절차) 통과; T4 `--check` diff 0·잡절 대조·DEPLOYMENT 절; T6 계약 오너 승인; R GO. T3b 와 T4 는 editor 파일을 동시에 만지지 않음(T4 의 editor 몫은 T4r 로 분리) |
| **W3 확정 반영·조건부 구현·운영 준비** | T4r ∥ T5 ∥ T7a(T6 승인 시) → T7b(T4r·T5 종료 후); (오너·디자인) B9 | 전체 테스트 기준선 대비 신규 실패 0; `VITE_ENABLE_CALENDAR='false'` 리허설; DEPLOYMENT 새 절(롤백 이미지 태그·FLAGS 키 수 무변경); 샘플 디자인 교체 → T1a 재실측 → 오너 승인 후 master ff·반영 → 첫 캘린더 완료 세션 워커 결과 관찰 |

브리핑 규약: 각 트랙에 목표·입력 위치·허용/금지 범위·배타적 파일 소유권·의존·완료 기준·증거·반환 형식·중단 조건을 넣고, 서브에이전트 요약은 주장으로 보아 통합 시 `git diff --stat` 을 소유권 표와 대조하고 테스트 로그를 재확인한다. 트랙 산출은 1~2 커밋으로 작게, 진행·결정은 공유 노트 폴더에 남겨 사용한도 중단 시 재개한다.

## 5. 오너 결정 요청 (답변 전까지 해당 트랙 보류)

**답변(2026-10-24, 오너 — 11건 모두 CTO 권고안 채택)**: D1 고객 UI 없음 + 관리자 최소 4종 + 기념일 문구 스타일 최소(색·굵게) · D2 표지·에필로그 배치 + 연도 표기(variant `'year'`, additive) · D3 **제작사 샘플 확정 후 값만 반영**(확정값 미수령 → T5 대기) · D4 권고안 일괄(`dataVersion` 릴리스는 오너 승인 뒤, 잡절 옵션 기본 off v1 in-place, 2028-04-12 선거일 temporary·기본 미표시, `allowedRange` 2027-12 유지; 갱신 담당은 미지정) · D5 관리자 정의 스킨 N종 + 고객 선택 · D6 보류 · D7 디자인 교체 → T1a 재실측 → 운영 폰트 확인 → 등록(담당·시점 미지정) · D8 인쇄소 확인 전 현 프리셋 유지(T1b 는 근거 실측만) · D9 B10 둔다 · D10 T3c 로 T3a 와 같은 wave · D11 프로파일 세트 전체.

| # | 질문 | CTO 권고 | 막히는 트랙 |
|---|---|---|---|
| D1 | 스타일 노출 범위 — (a) 그리드: 고객 UI 없음 유지 + 관리자(editMode) `CalendarGridTools` 최소 4종(fontFamily·headerLang·showTitle·showLines)인지, 고객에게도 일부 열지 (b) 기념일 문구 스타일(C5): 최소(색·굵게)만 vs 전체 | (a) 고객 없음 유지 + 관리자 최소 4종(템플릿 무결성; 샘플 디자인 교체의 선행 조건) (b) 최소 — 노출이 커질수록 글리프·폰트 검증 표면이 커진다 | T3b |
| D2 | 연달력(C8) 범위 — 표지·에필로그 캔버스에 연달력 그리드 배치 + 연도 표기 옵션(26면·monthCount 12 무변경) vs 별도 연달력 페이지(pages.count 변경) | 표지·에필로그 배치 + 연도 표기(additive 키만; variant `'year'` 는 배치된 템플릿에서만 진입) | T3a·T3b |
| D3 | 벽걸이 2단 — 판형(전체 높이/2 = A4 294×210·A3 415×297) 확정, 시트 짝 규칙 same-sheet vs offset-next(현 구현 offset-next), 타공 top-ring vs center-punch(center-punch 는 same-sheet 만 허용) | 제작사 샘플 확정 후 값만 반영; center-punch 를 고르면 pairing 도 same-sheet 로. 확정 전 (나)(다) 실제 템플릿 제작 금지 | T5 |
| D4 | 날짜 데이터 운영 — 갱신 담당·릴리스 승인 흐름(연 1회 + 임시공휴일 수시), 잡절 표시 옵션 제공 여부(기본 off), 2028-04-12 선거일 추가 여부, KASI 대조 전 `allowedRange` 2027-12 유지 | 담당 지정 + 오너 승인 뒤 `dataVersion` 릴리스; 잡절은 옵션(기본 off)으로 v1 in-place 추가; 선거일은 temporary 로 추가하되 기본 미표시; `allowedRange` 는 대조 전 2027-12 유지 | T4·T4r |
| D5 | C10 범위 — 관리자 정의 스킨셋 N종 + 고객 선택 vs 고객 자유 일괄변경 | 관리자 정의 스킨 N종 + 고객 선택(템플릿 무결성, `AppTemplateSwap.tsx:109-113` 재합성 경로 재사용) | T6·T7 |
| D6 | 가변 달 수·고정날짜 달력(C9) 상품 존재 여부 | 상품 확정 전 보류 | B8 |
| D7 | 운영 샘플 7종 등록 시점·샘플 디자인 교체 담당·운영 폰트 확인(~~`max_allowed_packet` 상향 시점~~ — 10-23 적용 완료) | 디자인 교체(재단선 밖 채움) → T1a 재실측 → 등록(흰 여백 3mm 샘플 노출 금지); 등록 전 운영 폰트 존재 확인 | W3 운영 등록 |
| D8 | 운영 캘린더 세트 최종 산출 형태 — 현 프리셋(single-pdf + duplex-merged = 편집기 26쪽 단일 PDF, 추가 잡 없음) 유지 vs duplex-split 13세트 vs sheet-map(per-sheet/merged-duplex) — 인쇄소 요구 사양 | 인쇄소 확인 전 프리셋 유지; T1a·T1b 가 3경로 실측해 근거 제공. 변경은 프리셋·세트 값만(코드 무변경) | T1b 범위·T5 |
| D9 | 완료 PDF 허용 대기 시간 — T1a 실측: 사진 없음 13.4~25.9s(미니 달력 포함 세트가 느림), 사진 13장 30.7s, watchdog 390s — 진행 표시·이탈 경고 트랙(B10)을 둘지 | **권고: 둔다**(30s 임계 도달; 생성 로직·watchdog 식 무변경, 진행 표시 + beforeunload 경고만) | B10 |
| D10 | 낱장 검증 킬스위치 `EDITOR_SHEET_VALIDATION_RULES=off` 가 캘린더·사진인화 세트 완료 검증을 깨뜨리는 결합(§8.1 C1) — 운영 문서 경고만 둘지, 프로파일 세트 규칙을 플래그와 분리(코드)할지 | 프로파일 세트가 운영에 생기기 전까지는 문서 경고(이번 커밋)로 충분; 샘플 등록 전에 분리 코드(api `sheet-validation-rules.ts` 프로파일 분기, 테스트)를 T3a 와 같은 wave 에 추가 권고 | T5·B9(등록 전제) |
| D11 | B11 게이트 범위 — 캘린더 세트만 vs 프로파일 세트 전체(사진인화 포함 유지) | 프로파일 세트 전체(NULL 세트만 종전 data URL 유지) | B11 |

## 6. 위험과 대응

| 위험 | 대응 |
|---|---|
| ~~벽걸이 1단·2단·사진 포함 캘린더의 완료 PDF 실측이 없는 채 운영 반영됨~~ → **해소(2026-10-22 T1a, §8.1)**: wall1_a3·wall2_a4·desk_large+사진 13장 모두 완료·검증 통과(warnings []) | 운영 샘플 등록(B9)은 C1 대응(문서 경고 반영 완료, 코드 분리는 D10) 뒤 |
| ~~사진 포함 26캔버스 벡터화 PDF 시간·메모리 미실측~~ → **실측 완료(§8.1)**: 사진 없음 13.4~25.9s, 사진 13장 30.7s(PDF 18.7MB, heap 피크 487MB), watchdog 390s 의 8% | 30s 임계 도달 → D9 권고 '둔다'(B10 진행 표시 + 이탈 경고). PDF 18.7MB 는 jsPDF 공유 XObject 참조(13장)라 바이트 중복이 아님 |
| **C1** 낱장 분류 검증 킬스위치 `EDITOR_SHEET_VALIDATION_RULES=off` 가 프로파일 세트(캘린더·사진인화) 완료 검증을 `PAGE_COUNT_INVALID` 로 깨뜨림 — 운영에 프로파일 세트가 생기면 낱장 문제의 롤백 수단으로도 쓸 수 없음 | DEPLOYMENT (가)·P1 롤백 절에 경고 기재(완료). 코드 분리(api `sheet-validation-rules.ts` 프로파일 분기 + 테스트)는 D10 — B9 샘플 등록 전에 T3a 와 같은 wave 권고 |
| **C2** 완료 진행 중(13~31s) 탭 이탈 시 PDF 생성이 중단되고 세션이 draft 로 남음(기존 동작) | B10(D9)에 beforeunload 경고 포함 |
| 캘린더 세트 사진틀 **클릭** 채움은 아직 base64 data URL(D12 수정은 사진인화 게이트) — 사진 9장 이상이면 canvasData 가 MariaDB 16MB 패킷을 넘길 수 있음(미실측, 자동편집 경로는 URL) | B11(D11) 게이트 확장; 그 전까지 샘플·안내는 '내 업로드 + 자동편집' 경로 |
| 프로파일 필드 추가 시 types 만 바꾸면 api DTO(whitelist+forbidNonWhitelisted)가 admin 저장을 400 으로 거부하고 CONTRACT 등재가 빠짐 | T3a·T4 는 types+DTO(+spec)+CONTRACT 행을 한 커밋·한 에이전트 소유로; 완료 기준에 프리셋 7종·샘플 프로파일 통과·sdk `types-parity` 포함 |
| 저장소에 스냅샷 테스트가 없어 '바이트 동일' 주장이 근거 없이 남음 | 명시 픽스처(프리셋 7종·샘플 프로파일·샘플 템플릿 JSON)의 `toJSON`/`validateProductProfile` diff 0 테스트로 고정 |
| T2 복원 경로에서 중복 기념일을 제거하면 기존 세션·런처 입력(미검증 보존)의 고객 데이터가 조용히 사라짐 | 복원은 비파괴(유지+console.warn), 거부는 store add/update 만; 복원 테스트에 '중복 입력 유지' 케이스 |
| T2·T3b·T4r·T7b 가 같은 editor calendar 컴포넌트·store 를, T3a·T4 가 같은 types·calendar/types·core·CalendarPlugin 을 만짐 | 직렬 배치(T2 W1 → T3b W2 → T4r·T7b W3; T3a W1 → T4 W2); 브리핑에 금지 파일 명시; 통합 시 `git diff --stat` 대조 |
| W1 에서 T1a 가 메인 체크아웃의 로컬 서버(`nest --watch`·vite HMR)로 실측하는 동안 코드 트랙이 같은 체크아웃을 수정하면 실측이 오염됨(검증 반박 1) | 코드 트랙은 worktree, 메인 체크아웃은 T1a 전용(§3 실행 환경 규칙) |
| W3 에서 T5 와 T7a 가 `TemplatePlugin.ts` 를 함께 만질 수 있음(검증 반박 2) | `TemplatePlugin.ts` 단일 소유 규칙(T6 승인 시 T7a, 미승인 시 T5) |
| 기준선 실패를 회귀로 오판하거나 회귀를 기준선으로 덮음 | W0 에서 기준선 재실행·실패 목록 고정(§7); 완료 기준 = 기준선 대비 신규 실패 0; worker 타임아웃 스위트는 단독 재실행 규칙 |
| 구 편집기 번들(브라우저 캐시)이 `'year'` 그리드를 만나면 rehydrate skip → 자리표시자 잔존, 더블클릭 훅이 'year' 셀에서 기념일 폼을 염 | 템플릿에 연달력 추가·샘플 재등록은 editor Vercel 반영 뒤에만; T3a '미지 variant skip·크래시 없음' 테스트, T3b 'year' 제외 테스트 |
| `gen-calendar-data.mjs` 가 CLI 옵션 없이 무조건 쓰고 `generatedAt` 때문에 재실행 diff 가 생겨 '결정성' 검증이 오탐 | T4 가 `--out`·`--check`(generatedAt 제외 비교)를 먼저 추가; 잡절 산출은 2025~2028 공표값 대조 후 병합 |
| 운영 산출 형태 불일치 — 프리셋은 duplex-merged(단일 PDF)인데 노트·설계 문서는 duplex-split/sheet-map 전제로 서술 | D8 로 인쇄소 요구 확정; T1a·T1b 3경로 실측; 설계 문서의 산출 서술 정정(§13-1 등) |
| dirty worktree(사용자 Shopify 문서·미추적 산출물)에서 쓰기 에이전트가 무관 파일을 stage | 소유 파일만 `git add <path>`; 사용자 수정 문서(EDITOR.md·INDEX.md·SHOPIFY_*·`PLATFORM_INTEGRATION_GUIDE.backup-*`)는 메인만 접촉 |
| 사용한도 도달로 서브에이전트·메인 세션 중단 | 트랙당 1~2 커밋, 공유 노트 폴더에 진행·결정 기록, 재개 시 `git status`·노트·워크플로 캐시(앞부분만 유효 — 완료 결과는 파일/args 로 전달)로 이어받기 |
| 운영 후속 미실행(~~`max_allowed_packet` 상향~~ 10-23 완료 · 운영 폰트 본고딕 확인) — 캘린더 완료 시 래스터 폴백·폰트 미임베드 경고 가능 | D7 등록 전 체크리스트(DEPLOYMENT 「권장 방어선」·샘플 등록 절). T1a 로컬 실측에서는 3세트 모두 워커 검증 fonts 0(텍스트 벡터화)·warnings [] — 운영 폰트 경로는 운영 샘플 등록 후 재확인 |

## 7. 검증 기준선 (2026-10-21, master `11383962`)

- **master `12de30af`(2026-10-24 재실행, 로컬 p1-calendar `42861260` = 코드 동일, CI 스텝 순서)**: sdk 13/416 · api 154/3470 · worker 37/1361(타임아웃 0) · canvas-core 64/762 · editor 135/1831(부하 실패 0) · admin 24/302 · typecheck(sdk·canvas-core·editor) 0 · lint error 0(경고 api 44·worker 16·canvas-core 48/48·editor 76/76·admin 0). **알려진 로컬 환경 실패(코드 무관)**: 로컬 기본 Node 26.5.1 은 native 모듈 ABI 가 맞지 않음 — `canvas.node`(ABI 137 = Node 24)로 canvas-core 64파일 수집 0, `better-sqlite3`(ABI 127 = Node 22)로 api 3스위트 20건(`worker-job.entity`·`files.upload-site-stamp`·`edit-sessions.service`) 실패 → canvas-core 는 Node 24, 그 3스위트는 Node 22 로 재실행해 전부 통과. 트랙 검증은 같은 규칙(`PATH=/opt/homebrew/opt/node@24/bin:$PATH`, sqlite 스위트는 node@22)으로 비교한다. 10-21 행의 부하 실패(editor 3건·worker 타임아웃 11건)는 이번 실행에서 재현되지 않았으나 단독 재실행 규칙은 유지.

- editor vitest 134 파일/1818 — 전체 동시 실행 시 2파일·3건 실패(`useCanvasContainerSizeSync.test` ×2·`hostPageLimits.test` ×1, 5초 타임아웃·부하)는 단독 재실행 통과 → **알려진 기준선 실패(부하)**. worker jest 37 스위트/1358 — `lightweight-parity`·`synthesis.processor.sheet-map` 11건 타임아웃은 단독 재실행 216/216 통과 → 단독 재실행 규칙. api jest 154/3470 · canvas-core 63/754 · admin 24/302 · sdk 13/416 · tsc 7패키지 · eslint 0 error(P2 계획 §4·§7.1).
- 각 트랙의 완료 조건은 **이 기준선 대비 신규 실패 0**. W0 에서 기준선을 1회 재실행해 실패 목록을 고정한다. 위 수치는 W1 T2 병합 전 값이며, T2 뒤 worktree 전체 실행은 editor 135/1831·canvas-core 64/762(DEPLOYMENT 「W1 T2」 절) — 다음 세션 첫 턴에 현재 master 에서 재실행해 행을 추가한다.
- **CI 회귀(기준선 아님, 2026-10-24 확인)**: GitHub Actions `ci` 의 `test` 잡이 10-21 P2-a~d master 병합(`11383962`, run 39558511191)부터 10-23 `dbc2333f`(run 39882963062)까지 완료 7회 전부 실패. 실패 스텝 「문서 포털 공개 모드 빌드」(apps/docs), 원인 `apps/docs/src/render-openapi.mjs:144` `OPENAPI.groups 에 대응 prefix 가 없는 경로: /api/v1/sessions/{id}/deliverables` — P2-b 런처 라우트(`f43cb99e`)가 `apps/docs/site.config.mjs` `groups`(ping·book-specs·books·webhooks)에 미등재. sdk·api·worker·canvas-core·editor·admin 테스트 스텝은 전부 통과. **10-24 05:11Z 다른 세션이 `200a2bd0`(`groups` 에 `/api/v1/sessions` '편집 세션 (sessions)')으로 수정해 master push** — **해소 확인(10-24): `12de30af` run 40065286057 success**.

## 8. 실측표

### 8.1 T1a — 프리셋 기본 경로(single-pdf + duplex-merged) + 킬스위치 리허설 (2026-10-22 21:45~22:05 KST = 12:45~13:05Z, master `f422afed` = 코드 `11383962`, 로컬 api-local·worker-local·editor, 샘플 7종 `--with-site` 재등록, 런처 `POST /api/v1/sessions/launch` + `calendar.startYm '2027-01'`)

| 세트(세트 id / 세션 / 주문) | 진입 | 완료 시간(저장 → PDF 생성 → 업로드·complete) | PDF | JS heap | 워커 검증 잡 | 산출·deliverables | 비고 |
|---|---|---|---|---|---|---|---|
| wall1_a3 `5b762d44` / `308342ee` / 900301 | 15.8s(load-profile, seat 15.4s), 26캔버스, 라벨 '표지·2027년 N월 앞면/뒷면·에필로그', 월 앞면 grid 62객체 | 클릭 → gen:done **13.9s** → complete:done 14.5s | 26쪽 · 434,090 B(벡터 그리드, 사진 없음) | 48 → **368MB**(+7.0s) → 90MB | COMPLETED isValid true · errors [] · **warnings []** · pageSize 303×421 · fonts 0(벡터화) · transparency false · orderOptions {pages 26, bleed 3, productKind sheet, coverSpine none, pageStep 2} | 검증 잡 1건(sheet-map·duplex-split 잡 없음 — 프리셋 duplex-merged) · deliverables product {calendar_wall1_a3, canvasCount 26, sheetCount 13} · calendar {2027-01, kr-2025-2035-v1} · files single 26p · status `editing`(탭을 열어 둔 자동저장, 기존 동작) | canvasData 872KB |
| wall2_a4 `e21b82bd` / `927ddb0c` / 900302 | 4.0s, 26캔버스, 라벨 '2027년 N월 상단/하단', 상단=사진틀·하단=grid | 재오픈(26캔버스·grid 복원) 뒤 클릭 → gen:done **13.4s** → complete:done 13.9s | 26쪽 · 433,988 B | 50 → **387MB**(+9.3s) | COMPLETED warnings [] · pageSize 300×216 landscape · orderOptions 동일(size 294×210) | deliverables status `complete` r1 · files single 26p | canvasData 843KB. 1차 완료 시도는 클릭 10초 뒤 탭을 옮겨 중단 → 세션 draft(coverFileId null)로 남음 — **완료 진행 중 페이지 이탈 시 PDF 생성이 중단되고 재시도해야 하는 기존 동작**(1차 heap 피크 629MB@+6s) |
| desk_large `4ffefa96` / `072e71ac` / 900303 + 사진 13장(1205×1795·1795×1205, 1.36MB) | 26캔버스, 사진틀 26(캔버스당 1) | `registerUploadedPhoto` 13장(`/storage/upload-public`, EXIF takenAt) 0.26s → '사진 자동편집' 13/26 틀 채움(storage URL src, ≤20s) → 저장 0.28s(canvasData **1.96MB**) → gen:done **30.7s** → 업로드 0.3s → complete:done 31.4s | 26쪽 · **18,676,963 B**(qpdf 페이지 이미지 참조 338 = 13 × 26 — jsPDF 공유 XObject, 바이트 중복 아님) | 71 → **487MB**(+12.5s, total 533MB) → 134MB | COMPLETED warnings [] · imageCount 13 · resolution 180 · orderOptions 동일(265×190) | deliverables status `editing` r1 · files single 26p | watchdog max(120000, 15000×26)=390s 의 **7.9%**. 생성 30.7s 는 D9 기준(30s) 초과 → B10 진행 표시 검토 권고 |
| desk_mini `2b84fbf8` / `24936cca` / 900304 — **api `EDITOR_SHEET_VALIDATION_RULES=off`**(킬스위치 ②, launch 구성 `api-local-sheetrules-off`, `[FLAGS] … EDITOR_SHEET_VALIDATION_RULES=false`) | 26캔버스 | gen:done **25.9s**(월 뒷면 미니 달력 2개 벡터화) → complete:done 26.9s | 26쪽 · 916,790 B | 440MB(+14.8s) | **FAILED** isValid false · errors [`PAGE_COUNT_INVALID`] · warnings [`SPINE_PARAMS_UNRESOLVED`] · orderOptions 에 productKind/coverSpine/pageStep **없음**(cover 규칙 폴백, pages 26) | deliverables status `editing` · files single 26p(검증 실패와 무관하게 편집기 PDF 는 남음) | **발견 C1**(아래) |
| 킬스위치 ① `VITE_ENABLE_CALENDAR=false`(launch 구성 `editor-nocal-3099`, CORS 허용 포트) | desk_large 완료 세션 재오픈: 달력 메뉴 없음 · CalendarPlugin 미등록(FrameInteraction·PhotoPrint 등록 유지) · 26캔버스 · 그리드 36(month 12 + mini 24, 그룹 62객체) · 사진 13 · 라벨 '2027년 N월 앞면/뒷면' 유지 | 표지 텍스트 1px 이동 → 자동저장 → 서버 canvasData 그리드 36(`extension.variant` month/mini)·fills 13·`metadata.calendar{2027,1,kr-2025-2035-v1}` 보존 | — | — | — | — | **통과** — 플러그인이 꺼져도 저장본·메타 보존 |

**T1a 발견**
- **C1 (설계/운영, high)**: 낱장 분류 검증 킬스위치 `EDITOR_SHEET_VALIDATION_RULES=off` 는 캘린더(프로파일) 세트의 완료 검증을 깨뜨린다 — `deriveSheetValidationRules` 가 꺼지면 검증 잡 orderOptions 에 `productKind 'sheet'`·`coverSpine 'none'`·`pageStep` 이 실리지 않아 워커가 cover 규칙(1·2·4쪽)으로 26쪽 PDF 를 `PAGE_COUNT_INVALID` 로 실패시킨다(§8.1 desk_mini). 운영에 캘린더·사진인화 세트가 생기면 이 플래그는 더 이상 안전한 롤백 수단이 아니다. 대응: DEPLOYMENT 의 (가) 롤백 절·P1 절에 경고 기재(이번 커밋), 코드 대응(프로파일 세트의 기대 쪽수 규칙을 플래그와 분리)은 오너 결정 D10.
- **C2 (기존 동작, medium)**: 완료 진행 중(PDF 생성 13~31초) 고객이 탭을 닫거나 이동하면 생성이 중단되고 세션은 draft 로 남아 재시도가 필요하다(§8.1 wall2 1차). 진행 표시(B10)와 함께 '완료 중 이탈 경고(beforeunload)' 검토 — D9.
- 관찰: 완료 중 편집기 콘솔 로그가 10초에 8천~1만 줄 쏟아진다(개발 빌드 디버그 로그, 운영 빌드는 제거됨 — `vite.config.ts` 주석). 실측 로그는 console.log 훅으로 받았다.
- 미실측(T1b 로 이월): sheet-map per-sheet·duplex-split 전환 경로.

### 8.2 T1b — 전환 경로(sheet-map per-sheet · duplex-split) — 작성 예정

| 세트 | 경로 | 잡·산출 파일 | 쪽수 일치 | deliverables sheets/copies | 비고 |
|---|---|---|---|---|---|
| (각 세트) | sheet-map per-sheet | | | | |
| (각 세트) | duplex-split | | | | |
