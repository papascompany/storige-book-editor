# 캘린더 편집기 기능 확장 계획 (2026-10-21, CTO — 서브에이전트 병렬 트랙)

> **상태(2026-10-22 작성)**: P1 캘린더(master `af900212`, 2026-10-18)와 P2-a~d·D11~D13(master `11383962`, 2026-10-21 15:55~16:00 KST)이 운영에 반영된 뒤, **캘린더 편집기 기능**을 중심으로 이어갈 개발 계획이다. 설계 정본은 [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md)(§11 로드맵·§13 결정), 캘린더 세부는 [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md)(C1~C12), P1 결과는 [`CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`](./CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md), P2 결과는 [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md). 운영 반영 기록은 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 「P1 캘린더 운영 반영 절차」·「P2-d」 절 끝 「반영 기록」. 라이브 상태 SSOT 는 `.cursor/plans/RESUME_PROMPT_2026-10-04.md` §2·§5.2.8.
> 작성 근거: 상위 세션 노트(`side-session-notes/…/p1-calendar-decisions-2026-10-17.md`·`p2d-e2e-findings.md`·`p2d-e2e-round2-2026-10-20.md`)와 설계·계획·배포 문서를 독립 리더 에이전트가 읽어 만든 인벤토리(§1)를 CTO 가 통합했다. 코드 확인이 남은 항목은 **미확인** 으로 표시한다.

---

## 0. 현황 통합 (2026-10-16 ~ 10-21, 상위 세션 + 이 세션)

| 일자 | 커밋 | 내용 | 운영 |
|---|---|---|---|
| 10-17 | `19f1ce7c` → master `1542d20a` | P0 낱장 N장 PDF·IIFE 배열 저장·duplex-split 쪽수 원천 + (가) 낱장 분류 검증(`productKind='sheet'`, 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`) | 10-17 반영(롤백 태그 `rollback-pre-sheet-20261017`) |
| 10-17 | `1a0d80e3`·`638b7288`·`0c670adc`·`52563190`·`af900212` | **P1 캘린더** — 템플릿셋 `product_profile`(마이그레이션 `20261017_add_template_set_product_profile.sql`)·`CalendarPlugin`·`calendar/core`·날짜 데이터 `kr-2025-2035-v1`·달력 메뉴/패널·`metadata.calendar`·완료 `product` 키·admin 프리셋 7종·샘플 스크립트·CONTRACT v1.22; 자동저장 누락 수정; dev 부팅 복구; 완료 PDF 워커 경고 0(coverSpine none·export 옵션·도련 정책 A·임시공휴일 고객 선택) | **10-18 00:48 KST 반영**(api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`, 롤백 태그 `rollback-pre-calendar-20261018`) |
| 10-18 | `f43cb99e` | **P2-a** 시트 맵 기반(`buildSheetMap`·`SheetSpec`·`output.mode`) + **P2-b** 파트너 v1 런처 3라우트(`launch`·`deliverables`·`synthesize`, 킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED`)·`GET /files/:id/external`·SDK `client.sessions`·CONTRACT v1.23; duplex-split request_id 길이·워커 파일 메타 401 결함 수정 | 10-21 반영 |
| 10-19 | `9be4c37c` | **P2-c** worker `sheet-map` 모드(per-sheet/merged-duplex, 골든 22) + 완료 시 자동 발행(`SHEET_MAP_OUTPUT_ENABLED`) + 파트너 재합성·deliverables `sheets`·CONTRACT v1.24 | 10-21 반영 |
| 10-20 | `237e6b91` | **P2-d** 사진인화(photo_chem·인쇄 ①②③) — types `'photo-print'`·`PhotoPrintPlugin`·`PHOTO_PRINT` 패널·`metadata.items`·런처 `items`·sheet-map `copies/label` 주입·deliverables `items`·admin 프리셋 4종·CONTRACT v1.25 + 적대 리뷰 36건·로컬 e2e 결함 D1~D10 수정 | 10-21 반영 |
| 10-20 | `2952aa09` | P2-d 2차 로컬 e2e 기록 — ② 고정 뒷면·③ 카드형 완료, 26캔버스(사진 13장) 저장+PDF 7.6s·완료 9.9s·PDF 9.3MB, 킬스위치 리허설 2종, 결함 D11~D13 발견 | — |
| 10-21 | `11383962` | **D11~D13 수정** — 초기 고정 뒷면 잠금(`initPhotoPrintSeededCanvas`), 틀 채움 storage 업로드 URL(`resolveFrameFillImage`, canvasData base64 제거 — MariaDB 16MB 패킷 초과 결함 해소), 워커 sheet 분리본 미참조 XObject 정리(`pdf-prune-xobjects.ts`) | **10-21 15:55~16:00 KST 반영**(master ff `af900212`→`11383962`, api `fcad1293f0e6`·worker `4f73a4c4efb4`, `[FLAGS-CHECK] api ok n=17`·`worker ok n=9`, Vercel editor/admin Ready, 롤백 태그 `rollback-pre-p2abcd-20261021`, `.env.bak-20261021-p2`) |
| 10-21 | `e9725838` | 운영 반영 기록(DEPLOYMENT·P2 plan·CONTRACT 적용 시점) | — |

**운영에서 아직 안 한 것(오너)**: 캘린더 샘플 세트 7종·사진인화 샘플 세트 4종 등록(운영 관리자 자격증명 오너 보유 — `--dry-run` → `--allow-remote`), mariadb `--max-allowed-packet` 상향(D12 코드 수정 뒤 권장 방어선), 운영 폰트 라이브러리에 템플릿 폰트('본고딕(Noto Sans) Regular') 존재 확인. 운영 캘린더·사진인화 템플릿셋은 0건이라 배포 직후 동작 변화는 없다.

**트랙 외 후속(캘린더 계획에서 제외)**: P2-e 운영자 콘솔(설계 §9), §8.3 외부 연동 어댑터(jumbocard → insta_print → Frameshop → 100p), P2-d 오너 결정 값(판형·chemical 도련·유테·업로드 한도·촬영일 형식), O2(프로파일 NULL 세트 2페이지 이후 `applyCustomerLocks` 공백 — 기존 동작, 별도 결정).

## 1. 캘린더 편집기 기능 인벤토리 (설계 C1~C12 대비 코드 현황)

상태: ✅ 구현·실측 / 🟡 부분 / ❌ 미구현 / ❔ 미확인(코드 확인 필요). 근거는 설계안·P1 노트·코드 경로.

| # | 기능(설계 번호) | 상태 | 근거·메모 |
|---|---|---|---|
| 1 | 시작연월 설정 + 허용 범위 밖 거부(C1) | ✅ | `apps/editor/src/components/calendar/CalendarPanel.tsx`·`calendarPanelUtils.ts`; 런처 `calendar.startYm` 전달은 P2-b |
| 2 | 시작연월 변경 시 편집 보존(상대 월 재계산, `monthOffset` override) | ✅ | 오너 답변 2026-10-16 반영; 기본은 캔버스 위치로 월 결정(`resolveCalendarCanvasSlot`) |
| 3 | 표기 옵션 토글 — 공휴일/음력/절기(C2) + 임시공휴일·선거일(고객 선택, 기본 off) | ✅ | `packages/types/src/product-profile.ts` `show.*`; 2028 선거일은 데이터 미추가(오너 결정) |
| 4 | 월 그리드 자동 생성(C3) — 6주·요일 헤더·일요일/공휴일 빨강·공휴일명 | ✅ | `packages/canvas-core/src/calendar/core.ts`, `plugins/CalendarPlugin.ts` |
| 5 | 전월·익월 미니 달력(variant `mini`, `monthDelta`) | ✅ | `CalendarPlugin.ts`, `CalendarGridTools.tsx` |
| 6 | 그리드 = 단일 객체(fabric.Group, 숫자 개별 비편집)(C4) + 그룹 해제 차단 | ✅ | `extensionType 'calendar-grid'`; `packages/canvas-core/src/plugins/GroupPlugin.ts:60` 이 `calendar-grid` 그룹의 해제를 막는다(코드 확인 2026-10-22) |
| 7 | 날짜칸 더블클릭 → 기념일 편집(C5: 음력 토글·환산·문구·스타일) | ✅ | `useCalendarGridDblClick.ts`; 스타일 속성별 UI 노출 범위 ❔ |
| 8 | 기념일 목록 관리 + 범위 밖 '초기화됨' 배지(C6) | ✅ | e2e 실측; 같은 날짜 중복 등록 거부 ❔ |
| 9 | 월 단위 페이지 구성·라벨(C7) — fixed 26·protected [0,25]·labelRule `month`·SidePanel 추가/삭제 숨김 | ✅ | `product-profile.ts`; 13캔버스→26캔버스는 오너 결정(P1 노트) |
| 10 | 표지·에필로그 캔버스(`coverCanvases`/`epilogueCanvases`) | ✅ | 페이지 구조로서만; 연도 선택은 #12 |
| 11 | 제작 가이드 오버레이(C11) — 링 바인딩·재단선 화면 전용(PDF 제외) | ✅ | e2e 실측(링 오버레이 인쇄 제외, 재단선 안쪽 표시); TemplatePlugin 어휘 `ring-overlay`·`cut-guide` 등록 ❔ |
| 12 | 표지/연달력 연도 선택·연달력 그리드(variant `year`)(C8) | ❌ | `CalendarPlugin` variant 는 `'month' \| 'mini'` 뿐; 설계 2단계 항목이나 로드맵 미배정 |
| 13 | 페이지 수 규칙(C9) — 가변 달 수·고정날짜 달력 | 🟡 | `monthCount` 12 고정(fixed 26 만) |
| 14 | 달력폼/디자인 일괄변경·내지 스킨셋(C10) | ❌ | 설계 C10; 로드맵 미배정 |
| 15 | 24절기(C12)·대체공휴일·음력 환산·음력 기념일·주 시작 요일 | ✅ | `data/kr-2025-2035-v1.ts`, `core.ts`(KASI 2025~2028 대조). 잡절(초복·말복)은 ❌ — 데이터·코드에 없음(grep 2026-10-22) |
| 16 | 정적 날짜 데이터 2025~2035 v1(`dataVersion`, 외부 API 없음) | ✅ | 2029~2035 음력·절기는 공표 전 알고리즘 산출 → KASI 공표 후 대조·릴리스 승인 필요 |
| 17 | 날짜 그리드 스타일(폰트·크기·색·헤더 언어·셀) + 관리자 그리드 배치 도구 | 🟡 | 플러그인 옵션·관리자 도구는 있음; 고객용 스타일 UI 범위 ❔ |
| 18 | 탁상 4종(라지·베이직·티니·미니, 삼각 스탠드 비편집, 26면) | ✅ | 운영 반영; 샘플 등록 오너 보류 |
| 19 | 벽걸이 (가) 1단 원피스 A3(layout `wall-1`) | ✅ | e2e 실측 기록은 탁상만(벽걸이 완료 PDF 실측 없음 — 위험) |
| 20 | 벽걸이 (나)(다) 2단 A4/A3(layout `wall-2`) | 🟡 | 판형 = 전체 높이/2 는 inferred, 시트 짝 규칙(same-sheet vs offset-next)·타공 위치 샘플 확정 오너 미결 |
| 21 | 양면 시트 출력 — duplex-split 13세트 / sheet-map per-sheet·merged-duplex·재합성 | ✅ | P1 결정 3(offset-next·backRotation 0·short-edge), P2-c; 운영 캘린더 세트의 `output.mode` 기본값 ❔ |
| 22 | 완료 PDF 검증(프로파일 쪽수·coverSpine none·도련 정책 A·경고 0)·글리프 검증 | ✅ | 워커 잡 실측 `warnings []` |
| 23 | 사진 배치(사진틀 + 그리드, 기존 FrameInteraction 재사용)·자동편집(photoAutofill) | 🟡 | 캘린더 전용 로직 없음; 사진 포함 26캔버스 완료 PDF 시간·메모리 실측 없음(P2-d 26캔버스 실측은 사진인화 기준 9.9s) |
| 24 | 세션 `metadata.calendar` 저장/복원·`metadata.productProfile`(서버 소유)·완료 `product` | ✅ | CONTRACT v1.22·v1.25 |
| 25 | admin 캘린더 프로파일 JSON·프리셋 7종·`scripts/register-calendar-samples.mjs` | ✅ | 운영 등록은 오너 |

## 2. 백로그 (우선순위 — 고객 가치 × 출시 필요성 × 위험)

| 순위 | ID | 항목 | 왜 지금 | 범위 | 오너 결정 |
|---|---|---|---|---|---|
| 1 | B1 | **캘린더 회귀 e2e 하네스**(벽걸이 1단·2단 + 사진 포함 탁상 26캔버스 완료 PDF 실측, 런처 세션·deliverables·sheet-map 경로) | 운영 반영된 기능 중 벽걸이·사진 포함 캘린더는 실측 기록이 없다 — 샘플 등록·고객 노출 전 마지막 게이트 | 사진인화 2차 e2e 하네스(파일 주입 훅·런처 세션·`setPage`) 재사용; 코드 변경 없음, 결함은 보고 | 없음 |
| 2 | B2 | **그리드 편집 안전성 보강** — 기념일 중복 등록 거부(C6)·고객용 스타일 UI 범위 확정(C5/C17)·그룹 해제 차단 회귀 테스트(C4, 구현됨) | 설계 완료 기준에 있으나 코드 확인이 안 된 2건 + 가드 테스트 부재 — 고객이 그리드·기념일 데이터를 깨뜨릴 수 있는 경로 | canvas-core `GroupPlugin` 가드 테스트·`CalendarPlugin`·editor calendar 컴포넌트·`useCalendarStore`·테스트 | 스타일 UI 노출 범위(최소/전체) |
| 3 | B3 | **연달력·연도 선택(C8)** — variant `year` 그리드, 표지/에필로그 연도 표기 옵션 | 표지·에필로그 캔버스는 있으나 연달력이 없어 상품 완성도(참조 편집기 대비)가 떨어진다 | types(`show.yearGrid?`·표지 옵션)·canvas-core `core.ts` 연 그리드·`CalendarPlugin` variant·editor 패널·admin 프리셋 | 표지/에필로그 기본 배치·스타일(설계 C8) |
| 4 | B4 | **날짜 데이터 운영 절차** — 임시공휴일·연 1회 갱신 스크립트(`dataVersion` 증가·검증·KASI 대조 체크리스트), 잡절(초복·말복) 데이터 포함 여부 | 2029~2035 는 공표 전 산출 — 매년 반복되는 운영 작업을 코드·문서로 고정 | `packages/canvas-core/src/calendar/data/*`·검증 테스트·`scripts/`·DEPLOYMENT 절 | 갱신 담당·릴리스 승인 흐름, 잡절 표시 여부 |
| 5 | B5 | **벽걸이 2단 확정 반영** — 판형(전체 높이/2)·시트 짝 규칙·타공 위치를 프로파일/프리셋/샘플에 반영 | 오너 샘플 확정 전 템플릿 제작 금지(P1 노트) — 결정 즉시 반영 가능하도록 준비 | admin 프리셋·샘플 스크립트·`sheet.pairing`·라벨('상단/하단') | **제작 샘플 확정(필수)** |
| 6 | B6 | **달력폼/디자인 일괄변경·스킨셋(C10)** | 고객 UX 차별화 항목이나 설계가 얕다(C10 한 줄) — 설계 먼저 | o5-architect 설계 계약 → TemplatePlugin 어휘·editor 패널 | 범위(스킨 정의 주체: 관리자 템플릿 vs 고객 선택) |
| 7 | B7 | 가변 달 수·고정날짜 달력(C9) | 상품 요구 미확정 — 프로파일 `pages.kind fixed` 전제를 바꾸는 큰 변경 | 보류(설계만) | **상품 존재 여부** |
| 8 | B8 | 샘플 템플릿 실제 디자인 교체·운영 샘플 등록·운영 폰트 확인 | 고객 노출 전 필수지만 코드가 아니라 콘텐츠·운영 작업 | 디자인 팀·오너 | 등록 시점 |

## 3. 병렬 트랙 (서브에이전트 분담 — 동시 3개·한 작업 총 6개·배타적 파일 소유권)

역할 ID 는 전역 지침의 `o5-*`(모두 `model: inherit`). 쓰기 트랙은 파일 소유권이 겹치지 않게 패키지 경계로 나누고, 같은 파일을 만져야 하는 일은 같은 트랙에 둔다. 모든 쓰기 트랙의 공통 완료 기준: 프로파일 NULL 세트 바이트 동일(기존 스냅샷 테스트 통과), CONTRACT_FREEZE 영향 없음(있으면 ADDITIVE 개정), 킬스위치(`VITE_ENABLE_CALENDAR` 정확히 `'false'`) 로 메뉴·플러그인이 꺼져도 저장본 보존, 패키지 테스트·tsc·eslint 회귀 0.

| 트랙 | 목표 | 역할 | 파일 소유권(배타) | 의존 | 완료 기준·검증 |
|---|---|---|---|---|---|
| **T1 캘린더 회귀 e2e** | B1 — 벽걸이 1단·2단·사진 포함 탁상 26캔버스를 런처 세션으로 완료, 검증 잡 `warnings []`·sheet-map/duplex-split 산출·deliverables 확인, 시간·메모리 실측 | `o5-frontend-qa`(실측) + `o5-test-build`(로컬 서버·잡 조회) | 코드 없음 — 결과는 `docs/CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md` 상태 절 + 이 문서 §6 | 없음(로컬 샘플 7종 등록) | 세트 3종 완료 통과, 결함은 재현·수정안으로 보고(수정은 승인 후) |
| **T2 그리드 안전성** | B2 — 중복 기념일 거부·스타일 UI 범위·그룹 해제 가드 회귀 테스트 | `o5-repo-scout`(확인) → `o5-implementer` | `packages/canvas-core/src/plugins/GroupPlugin.ts`(테스트만)·`CalendarPlugin.ts`, `apps/editor/src/components/calendar/*`, `apps/editor/src/stores/useCalendarStore.ts`(+테스트) | 오너: 스타일 UI 범위 | vitest 신규 ≥3(그룹 해제 no-op 가드 포함), 중복 등록 거부 UI·토스트 |
| **T3a 연달력 코어** | B3 — `core.ts` 연 그리드 산출·`CalendarPlugin` variant `'year'`·types 옵션 | `o5-architect`(계약 1장) → `o5-implementer` | `packages/types/src/product-profile.ts`(additive 필드), `packages/canvas-core/src/calendar/*`, `plugins/CalendarPlugin.ts`(+테스트) | 오너: C8 범위 | core 단위 테스트·플러그인 직렬화 왕복·NULL/기존 캘린더 세트 바이트 동일 |
| **T3b 연달력 UI** | B3 — 패널 연도 선택·표지/에필로그 연달력 배치 도구·admin 프리셋 | `o5-implementer`(T3a 와 다른 에이전트) | `apps/editor/src/components/calendar/*`(T2 와 겹치므로 **T2 종료 후**), `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts`(+test) | T3a 계약·T2 | 편집기 e2e(연달력 표시·재오픈 유지·PDF 포함) |
| **T4 날짜 데이터 운영** | B4 — 갱신 스크립트·검증·KASI 체크리스트·잡절 결정 반영 | `o5-implementer` + `o5-test-build` | `packages/canvas-core/src/calendar/data/*`, `scripts/calendar-data-*.mjs`, `docs/DEPLOYMENT.md` 데이터 갱신 절 | 오너: 담당·잡절 | 스크립트 dry-run, `dataVersion` 증가 시 세션 복원 호환 테스트 |
| **T5 벽걸이 2단 반영** | B5 — 결정값을 프리셋·샘플·라벨·`sheet.pairing` 에 반영 | `o5-implementer` | `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts`(T3b 종료 후), `scripts/register-calendar-samples.mjs` | **오너 샘플 확정** | 로컬 등록 → T1 하네스로 완료 PDF·시트 실측 |
| **T6 C10 설계** | B6 — 디자인 일괄변경 설계 계약(어휘·데이터·UI) | `o5-architect` | 문서만(`docs/CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md` 보강 초안) | 오너: 범위 | 구현 계약·롤백 안 포함, 오너 승인 후 구현 트랙 분리 |
| **R 검토** | 각 wave 종료 시 통합 검토 | `o5-final-reviewer`(+`o5-security-reviewer` 는 계약·세션 metadata 변경 시) | 읽기 전용 | wave 산출 | GO/NO-GO·회귀·롤백 확인 |

## 4. 실행 순서 (wave)

| wave | 동시 실행 | 게이트(다음 wave 조건) |
|---|---|---|
| **W0 결정** | 오너 결정 D1~D5(§5) 수집 — CTO 질의 1회 | 최소 D1(스타일 UI 범위)·D2(C8 범위) 답변; D3(2단 샘플)은 T5 만 막는다 |
| **W1** | T1 e2e ∥ T2 그리드 안전성 ∥ T3a 연달력 코어(계약 → 구현) | T1 결함 보고 완료, T2·T3a 테스트·tsc 통과, R 검토 GO |
| **W2** | T3b 연달력 UI ∥ T4 데이터 운영 ∥ T6 C10 설계 | T3b e2e(T1 하네스 재사용) 통과, T4 dry-run, T6 계약 승인 |
| **W3** | T5 벽걸이 2단(오너 샘플 확정 시) ∥ C10 구현(T6 승인 시) ∥ 운영 샘플 디자인 교체·등록(오너) | 전체 테스트 회귀 0 → 배포 절차(DEPLOYMENT 새 절) → 오너 승인 후 반영 |

메인 에이전트(CTO)는 분해·소유권·통합·최종 판단을 맡고, 각 트랙 브리핑에는 목표·입력 위치·허용/금지 범위·파일 소유권·의존·완료 기준·증거·반환 형식·중단 조건을 넣는다. 서브에이전트 요약은 주장으로 보고 통합 시 diff·테스트 로그로 확인한다.

## 5. 오너 결정 요청 (답변 전까지 해당 트랙 보류)

| # | 질문 | CTO 권고 | 막히는 트랙 |
|---|---|---|---|
| D1 | 고객용 그리드 스타일 편집 범위 — 최소(폰트·색만) vs 전체(헤더 언어·셀 크기 포함) | **최소**: 템플릿 디자인 무결성 우선, 관리자 도구는 그대로 | T2 |
| D2 | 연달력(C8) 범위 — 표지·에필로그에 연달력 그리드 배치 + 연도 표기만 vs 별도 연달력 페이지 | **표지·에필로그 배치 + 연도 표기**(26면 구조 유지) | T3a·T3b |
| D3 | 벽걸이 (나)(다) 2단 — 판형 전체 높이/2, 시트 짝 규칙(same-sheet vs offset-next), 타공 위치(top-ring vs center-punch) 제작 샘플 | 제작사 샘플로 확정 후 반영(설계 §13-1 기본 same-sheet 와 P1 구현 offset-next 가 다름) | T5 |
| D4 | 날짜 데이터 갱신 담당·릴리스 승인 흐름, 잡절(초복·말복) 표시 여부, 2028 선거일 추가 여부 | 연 1회 + 임시공휴일 수시, 오너 승인 뒤 `dataVersion` 증가 릴리스; 잡절은 옵션(기본 off) | T4 |
| D5 | C10(디자인 일괄변경) 범위 — 관리자 스킨셋 정의 + 고객 선택 vs 고객 자유 변경 | 관리자 정의 스킨 N종 + 고객 선택(템플릿 무결성) | T6 |
| D6 | 가변 달 수·고정날짜 달력(C9) 상품 존재 여부 | 상품 확정 전 보류 | B7 |
| D7 | 운영 샘플 7종 등록 시점·디자인 교체 담당 | 디자인 교체 후 등록(흰 여백 3mm 샘플은 노출 금지) | B8 |

## 6. 위험과 대응

| 위험 | 대응 |
|---|---|
| 벽걸이·사진 포함 캘린더의 완료 PDF 실측이 없다(운영 반영됨) | W1 T1 을 가장 먼저, 결함은 코드 수정 전 보고·승인 |
| 캘린더 완료 PDF 벡터화 시 25~35초(사진 없음) — 사진 포함 시 체감 시간 미검토 | T1 에서 시간·heap 실측(사진인화 26캔버스 9.9s 기준 비교), 필요 시 진행 표시 UX 를 별도 트랙으로 |
| 2029~2035 데이터 미대조 | T4 체크리스트·KASI 공표 후 대조 전 상품 범위를 2028 까지로 안내(프로파일 `allowedRange`) |
| T2 와 T3b 가 같은 editor 컴포넌트를 만진다 | 직렬(T2 → T3b) — W1/W2 분리 |
| NULL 세트·기존 캘린더 세트 회귀 | 모든 쓰기 트랙에 바이트 동일 테스트 유지, `VITE_ENABLE_CALENDAR=false` 리허설, 배포 전 전체 테스트 |
| 사용한도로 서브에이전트 중단 | 트랙 산출은 커밋 단위로 작게, 노트 폴더에 진행 기록, 재개 시 캐시·노트로 이어 받기 |

## 7. 검증 기준선 (2026-10-21, master `11383962`)

editor vitest 134 파일/1818 · worker jest 37 스위트/1358 · api jest 154/3470 · canvas-core 63/754 · admin 24/302 · sdk 13/416 · tsc 7패키지 · eslint 0 error(P2 계획 §4·§7.1). 이 기준선 대비 회귀 0 이 각 트랙의 완료 조건이다.
