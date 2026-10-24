# 새 세션 시작 프롬프트 — 캘린더 편집 모드 P1 (2026-10-17 작성)

> **2026-10-24: 역사 기록.** P1 은 10-18 운영 반영으로 끝났고, 이후 단계(W1 잔여 T3a·W2·W3, 서브에이전트 오케스트레이션)는 `CALENDAR_EDITOR_ORCHESTRATION_SESSION_START_PROMPT_2026-10-24.md` 를 쓴다.

> 아래 블록을 새 Claude Code 세션(작업 폴더 `/Users/yohan/Developer/Bookmoa Storige editor/storige`)의 첫 메시지로 그대로 붙여 넣는다. 이 파일을 작성한 세션에서 P1 개발을 시작했다는 뜻은 아니다.

---

CTO는 Storige 편집기의 **캘린더 편집 모드 P1**(탁상 월1면 + 벽걸이 (가))을 개발합니다. 설계·P0·(가)는 이전 세션(2026-10-16~17)에서 끝났고 운영 배포까지 됐습니다. 아래 순서로 읽고 시작하세요.

**1. 먼저 읽을 것(순서대로)**
1. `CLAUDE.md`, `CLAUDE.local.md`(운영 규칙·SSH·비밀값 위치만; 비밀값 파일은 열지 않음)
2. `.cursor/plans/RESUME_PROMPT_2026-10-04.md` §2(10-17 04:30Z 갱신 줄 — 라이브 상태)·§5.2.8(캘린더 트랙)·§6 상시 함정·§7 세션 종료 규칙
3. `docs/CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md` — 이번 세션의 범위·순서·완료 기준(정본)
4. `docs/PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md` §1~§7·§11~§14 — 아키텍처·타입·변경 지점(`file:line`)·결정 현황
5. `docs/CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md` §1(참조 편집기 관찰: 시작년월·기념일·월 그리드·페이지 쌍)·§3.1(CalendarContext/calendar-grid)
6. `../_private_notes/wave12/P0_SINGLE_MODE_DEFECTS_2026-10-16.md` — P0·(가) 구현 상세, 운영 실측, 통지 초안, 남은 결정
7. 저장소 스킬: `.claude/skills/fabric-editor`, `photobook-template`, `platform-integration`, `editor-object-editing`

**2. 현재 사실(2026-10-17)**
- master `1542d20a`(코드 `19f1ce7c`). 운영: editor Vercel `6rjlodvpe`, api `a2a83d46b891`, worker `4f294db9c738`, `[FLAGS] api` 15키(`EDITOR_SHEET_VALIDATION_RULES=true`), 롤백 태그 `rollback-pre-sheet-20261017`. 같은 배포로 Wave 11 커밋도 운영 반영됨(DEPLOYMENT.md 2026-10-17 절).
- 이미 있는 기반: editor `collectCanvasData`·`selectSingleModePdfCanvases`(같은 판형 N장 → N쪽 PDF), api `resolveSessionPageCount`·`deriveSheetValidationRules`(single 세트 + page 템플릿 → `productKind='sheet'`), worker sheet 정확 쪽수 검사. **13캔버스 캘린더 세트는 이 기반만으로 13쪽 PDF·정확 13쪽 검증이 성립**합니다. P1은 ProductProfile 정본·페이지 정책·CalendarPlugin·캘린더 UI·오버레이 규약·샘플 세트가 핵심입니다.
- 운영 데이터: single 세트 세션 90일 0건 → P1 변경은 기존 파트너 세션에 영향 없음.
- 작업 트리: `docs/EDITOR.md`·`INDEX.md`·`PDF_VALIDATION_GUIDE.md`·`PLATFORM_INTEGRATION_GUIDE.md`·`SHOPIFY_*` 등은 **오너가 수정 중(dirty)** — 건드리지 말고 명시 경로로만 커밋. `.tmp-verify-combos/`·untracked Shopify 문서는 타 세션 소유.

**3. 지켜야 할 원칙**
- 모드 트리거는 템플릿셋 데이터(`product_profile`) — `TemplateSetType` 게이팅 금지, `EditorMode` 제3값 금지, `PdfOutputMode`·`OutputFile.type`·`TemplateSetType` enum 무변경.
- additive-only. `docs/CONTRACT_FREEZE.md` FROZEN 표면(`/embed` 파라미터 12종·엔벨로프 v1·`editor.complete` `files`/`pages` 중첩·compose-mixed·shop-session) 불침범. ADDITIVE는 같은 커밋에서 `contract-freeze.spec.ts`·`packages/sdk/src/embed/protocol.ts`·가이드 갱신.
- profile이 NULL인 기존 세트는 모든 경로가 바이트 동일(스냅샷 테스트·골든 하네스로 증명). `extendFabricOption` 미등재 속성은 저장 1회 왕복에 침묵 유실 — 신규 속성마다 등재 검사 테스트.
- 오너(yohan, ILARK wpod 편집기 원 설계자)가 답한 사실: 시작연월 변경 시 편집 보존·범위 밖 기념일만 안내/수정; 재단선·링 PNG는 화면 전용 오버레이(PDF에는 하부 데이터 정상 포함); 낱장 = 단면 1·양면 2·`pageStep` 데이터주도; 후가공 파일은 업로드(편집기 산출 아님, 별색 전용 아님); 벽걸이 (나)(다)는 "앞면=상단 페이지, 뒷면=하단 페이지(링을 들어올려 상하 펼침)". **비즈니스 로직·편집 프로세스가 궁금하면 추측하지 말고 오너에게 질문**(AskUserQuestion).
- 참조 편집기(ILARK wpod, 점보포토)는 기능 사상만 참조. 코드·DOM·CSS 복제 금지.
- 사용자에게 보이는 글은 한국어, 코드·식별자는 영어. 커밋·push·배포는 오너 승인 후 명시 경로로. 공개 저장소 — 커밋 전 gitleaks.

**4. 착수 전 오너에게 받을 결정(계획 §4)**
탁상 물리 사양(§13-4) · 첫 출시 상품(탁상+벽걸이(가) 동시 권고, §13-10) · 날짜 데이터 출처·갱신 담당 · 샘플 템플릿 디자인 담당·판형. 답을 받기 전엔 P1-a(프로파일 정본)·P1-c(calendar-core 순수 함수·데이터 구조)처럼 결정과 무관한 레인부터 진행하세요.

**5. 작업 방식**
- 계획 §2의 서브웨이브대로: P1-a(api+types) ∥ P1-b(editor 페이지 정책·메뉴) ∥ P1-c(canvas-core CalendarPlugin·calendar-core) → P1-d(캘린더 패널·complete 키) → P1-e(검증 연동·샘플 세트·e2e). 레인은 파일 배타 소유, 구현 → 레인별 테스트 → 전체 diff 적대 리뷰(Workflow 또는 o5-* 서브에이전트).
- 브랜치 `p1-calendar-<date>`에서 작업. 변경 전 결함 재현 테스트부터.
- 검증 기준선: editor vitest 110/1621(기준선 실패 1 `hostPageLimits.test.ts`), canvas-core 57/658, worker 34/1312, api 143/3176(로컬 Node 26에서 better-sqlite3 ABI 환경 실패 20 — Node 24로 재확인), contract-freeze 94, lint 경고 editor 76·worker 16·api 44 이하.
- 매 턴 `발견/수행/검증/남은 위험`으로 보고. 결정 근거·실측은 `../_private_notes/wave12/`(비공개), 공개 문서에는 변경 후 동작만.

**6. P1 완료 기준(계획 §2 요약)**
NULL 세트 스냅샷 테스트 전부 통과 · 13캔버스 탁상/벽걸이(가) 세트 생성→저장→재오픈 시 grid·기념일 유지 · 시작연월 변경 시 사진·텍스트 보존·범위 밖 기념일 안내 · 완료 시 13쪽 PDF + 검증 경고 0 + 오버레이 미출력 · `editor.complete` additive `product` 키 contract test · calendar-core 단위 테스트(윤년·6주·대체공휴일·음력) · 13캔버스 PDF 생성 시간 실측 기록 · CONTRACT_FREEZE ADDITIVE 행·가이드 초안.

첫 행동: 위 1~2를 읽고 `git status -sb`·`git log --oneline -5`로 상태를 확인한 뒤, 계획 §4 결정 4건을 AskUserQuestion으로 한 번에 묻고, 답을 기다리는 동안 P1-a·P1-c 정찰(파일·테스트 패턴)부터 시작하세요.
