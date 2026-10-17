# 캘린더 편집 모드(P1) 개발 계획 (2026-10-17)

> 정본 설계: [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md)(이하 "설계안"). 캘린더 세부·참조 편집기 관찰: [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md). 새 세션 시작 프롬프트: `.cursor/plans/CALENDAR_MODE_SESSION_START_PROMPT_2026-10-17.md`.
> 이 문서는 "무엇을, 어떤 순서로, 어디까지"를 정한다. 코드 인용은 설계안의 `file:line`을 따른다.

---

## 0. 출발점(2026-10-17 라이브 상태)

- master `1542d20a`(코드 `19f1ce7c`): P0(낱장 N장 PDF·IIFE 배열 저장·duplex-split 쪽수 원천)와 (가) 낱장 분류 검증이 editor(Vercel)·api·worker에 **운영 배포됨**. 같은 배포로 Wave 11 커밋도 운영 반영(배포 기록 `docs/DEPLOYMENT.md` 2026-10-17 절).
- 이미 있는 것(P1이 그대로 쓰는 기반):
  - 편집기: `collectCanvasData`(멀티 캔버스 배열 저장), `selectSingleModePdfCanvases`(같은 판형 N장 → N쪽 PDF; spine/wing 혼재 폴백), watchdog `max(120s, 15s×n)`.
  - api: `resolveSessionPageCount`(배열 canvasData 길이 → 호스트 pages), `deriveSheetValidationRules`(single 세트·spine/wing/spread 없음·표지 전용 제외 → `productKind='sheet'` + `pageStep`), 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`.
  - worker: `productKind==='sheet'`면 슬롯 무관 **정확히 `pages`쪽** 검사(+`pageStep` 배수), `post_process` 색 규칙 `postProcessColorRule`.
  - 결과: **캘린더 13캔버스 세트는 P1에서 editor·api·worker 변경 없이도 "13쪽 PDF + 정확 13쪽 검증"이 성립**한다(single 세트 + page 템플릿 13개 → sheet 판정 → pages=13). P1의 핵심은 **캔버스 객체(날짜 그리드)·페이지 정책·캘린더 UI·ProductProfile 정본**이다.
- 운영 실측: single 세트 세션 90일 0건, duplex-split 세트 0, post_process 잡 0 → P1 변경은 기존 파트너 세션에 영향 없음.

## 1. 범위와 비범위

**P1 범위(첫 출시: 탁상 월1면 + 벽걸이 (가) — 오너 확정 전 권고)**
1. `template_sets.product_profile`(JSON NULL) + `ProductProfile` 타입·`resolveProductProfile`/`validateProductProfile`(packages/types) + API DTO/매핑 3곳 + admin JSON 섹션(스키마 검증).
2. 편집기 페이지 정책: `pages.kind='fixed'`(13)·`protectedIndices=[0]`·`labelRule='month'`(SidePanel 추가/삭제 숨김, 라벨 "2027년 1월").
3. `CalendarPlugin`(canvas-core) + `calendar-core`(순수 함수) + 정적 날짜 데이터 v1(공휴일·대체공휴일·24절기·음력 환산표, `dataVersion`) + `CALENDAR` 메뉴 키(EditorMenuKey·EDITOR_MENU_DEFS·ToolBar.ALL_MENUS 세 곳).
4. 캘린더 패널: 시작연월(허용 범위 밖 거부)·표기 옵션(공휴일/음력/절기)·기념일 관리(목록·추가·수정·삭제, 시작연월 변경 시 범위 밖 기념일 "초기화됨" 표시 + 수정 UI).
5. 오버레이 규약: 재단선·링 바인딩 PNG = `extensionType:'overlay'` + `excludeFromExport` 또는 `printExclude:true`, `selectable/deleteable=false`, `alwaysTop`, TemplatePlugin 어휘 `ring-overlay`·`cut-guide`(화면 전용, PDF에는 하부 데이터 정상 포함).
6. 세션 스냅샷: `metadata.productProfile`(전체 복사)·`metadata.calendar{startYear,startMonth,anniversaries[],dataVersion}`; `editor.complete`에 additive `product?{kind,editorType,canvasCount,sheetCount,faces}`.
7. 검증 연동: profile 세션은 (가) 경로 재사용 — `deriveSheetValidationRules`가 profile이 있으면 `pages.count`(fixed)를 우선 근거로 삼게 확장(현행 sheet 판정과 충돌 없음).
8. 샘플 템플릿셋 2종(탁상·벽걸이 (가)) 등록 가이드 + e2e(생성→저장→재오픈→완료→13쪽 PDF→검증 통과).

**P1 비범위(후속)**: `sheet-map` worker mode·벽걸이 (나)(다)·사진인화 ①②③(P2), 1-call 런처/deliverables·운영 콘솔 확장(P2, 설계안 §8·§9), 면별 JPEG·사이즈 혼합(P3), 낱장 cover 슬롯 판형·도련 검증 게이트(별도 결정 13).

## 2. 작업 순서(서브웨이브)와 완료 기준

| 서브웨이브 | 내용(파일) | 완료 기준 | 레인 |
|---|---|---|---|
| **P1-a 프로파일 정본** | `packages/types/src/product-profile.ts`(타입·resolve·validate·테스트), `index.ts` re-export, `apps/api/migrations/20261018_add_template_set_product_profile.sql`, entity(`coverConfig` 패턴)·DTO(`@ValidateNested`)·매핑 create `:125`/copy `:422`/deriveOrientation `:980`, `with-templates` 응답 키 `productProfile`(기존 키 불변), `contract-freeze.spec` 등재 | NULL 셋 스냅샷 테스트 전부 통과; `resolveProductProfile(NULL)→null`, `version!==1→null+warn`; contract-freeze 통과; admin JSON 섹션에서 `validateProductProfile` 오류가 보임 | api + types (1레인) |
| **P1-b 편집기 페이지 정책·메뉴** | `apps/editor/src/utils/productProfile.ts`(settings 반영), `useSettingsStore.productProfile`, `useEditorContents.ts:1203` 뒤 `else if (profile)` 분기(settingsPageBounds fixed/anchor), `SidePanel.tsx` fixed/protected 숨김, `buildPageMeta` `labelResolver`, `EditorMenuKey 'CALENDAR'`·`EDITOR_MENU_DEFS`(defaultEnabled false)·`ToolBar.ALL_MENUS` | profile NULL 세트 동작 불변(기존 embed.*.test 전부 통과); 13캔버스 fixed 세트에서 추가/삭제 버튼 없음·라벨 "YYYY년 M월"; `pageStep` 가드 무회귀 | editor (1레인) |
| **P1-c CalendarPlugin·데이터** | `packages/canvas-core/src/calendar/{core.ts,data/<version>.json}`, `plugins/CalendarPlugin.ts`(extensionType `calendar-grid` Group, `extension{monthOffset,variant,style}`, `rehydrate(ctx)`, 훅 비의존), `createCanvas.ts` 등록(VITE_ENABLE_CALENDAR), `extendFabricOption` 등재 검사 테스트, 글리프 검증 대상 확인 | calendar-core 단위 테스트(윤년·6주 월·대체공휴일·음력 기념일·주 시작 0/1); 그리드 생성→저장→재오픈 왕복 유지; 시작연월 변경 시 사진·텍스트 보존·그리드만 재생성; 그룹 해제 차단(lockInfo) | canvas-core (1레인) |
| **P1-d 캘린더 패널 UI** | `apps/editor/src/components/calendar/{StartMonthPanel,DisplayOptionsPanel,AnniversaryPanel}.tsx`, 날짜칸 클릭→기념일 편집, `metadata.calendar` 저장/복원(`createPayload`), `embed.tsx` complete additive `product` 키(`protocol.ts` ADDITIVE 등재·`embed-protocol.spec`) | 범위 밖 기념일 안내·수정 흐름 테스트; 완료 payload `files`·`pages` 중첩 불변(contract test) | editor (P1-b 뒤 직렬) |
| **P1-e 검증·샘플·e2e** | `deriveSheetValidationRules`에 profile `pages.count` 근거 추가(+spec), 탁상·벽걸이(가) 샘플 템플릿셋 등록 가이드(`docs/템플릿등록 매뉴얼.md` 부록 또는 신규), 오버레이 규약 템플릿 작성 지침, e2e(13캔버스 완료 → 13쪽 PDF → 검증 경고 0) | 골든 하네스(book/leaflet/photobook/낱장 1장) 바이트 동일; 13캔버스 PDF 생성 시간 실측 기록; CONTRACT_FREEZE ADDITIVE 행 초안 | api + QA |

- 레인 병렬: P1-a ∥ P1-b ∥ P1-c(파일 배타), 그 뒤 P1-d → P1-e. 각 레인은 "구현 → 레인별 테스트 → 전체 diff 리뷰" 순(이번 세션의 워크플로 패턴).
- 커밋은 오너 검토 후 명시 경로로. 브랜치 `p1-calendar-<date>`에서 작업하고 master 병합·배포는 오너 승인.

## 3. 설계 결정(이미 확정, 재논의 금지)

- 모드 트리거 = 템플릿셋 데이터(`product_profile`); `TemplateSetType` 게이팅 금지; `EditorMode` 제3값 금지; `PdfOutputMode`·`OutputFile.type`·`TemplateSetType` enum 무변경; ADDITIVE + contract-freeze 동시 등재.
- 시작연월 변경: 편집 내용 보존(상대 월 재계산), 범위 밖 기념일만 안내·수정(오너 답변 2026-10-16).
- 오버레이 = 화면 전용, PDF는 하부 데이터 정상 포함(오너 지시 2026-10-16).
- 낱장 분류: 단면 1·양면 2·`pageStep` 데이터주도·후가공 `colorRule`(오너 정정 2026-10-17). 후가공 파일은 업로드(편집기 산출 아님).
- 참조 편집기(ILARK wpod)는 기능 사상만 참조, 코드·DOM·CSS 복제 금지.

## 4. P1 착수 전 오너 결정(§13)

1. **탁상 캘린더 물리 사양**(§13-4): 삼각 스탠드/상단 링, 뒷면 사용 여부, 받침 페이지 — 현재 "월1면 단면 13장" 가정.
2. **첫 출시 상품**(§13-10): 탁상 + 벽걸이(가) 동시(권고) vs 탁상 단독.
3. **날짜 데이터 출처·갱신 담당**: 공공데이터포털 특일 + KASI 음양력 정적 JSON(권고), 연 1회·임시공휴일 릴리스 절차.
4. (P1-e 전) 샘플 템플릿 디자인 담당·판형(벽걸이 라지 등).
5. (참고) 참조 편집기 라이선스 경계(§13-12) — 기능 참조만이라 영향 없음으로 판단, 오너 확인.

## 5. 위험과 대응

| 위험 | 대응 |
|---|---|
| `useEditorContents.ts`·`embed.tsx` 공유 경로 회귀 | `if (profile)` 가드만, NULL 스냅샷 테스트·골든 하네스, Shopify EDT-301 선반영 통지 |
| `extendFabricOption` 미등재 침묵 유실 | 등재 검사 테스트(`curveText.test.ts:187-190` 패턴) 필수 |
| 13캔버스 jsPDF 메모리·watchdog | P1-e 실측, 초과 시 서버 래스터 대안은 범위 밖 기록 |
| 날짜 데이터 정확성 | 단위 테스트 + 데이터 버전 고정, 임시공휴일은 데이터 릴리스 |
| 글리프 검증 | grid 텍스트가 `collectGlyphValidationTargets` 대상인지 P1-c 테스트 |
| 로컬 Node 26 + better-sqlite3 ABI | api 전체 스위트는 Node 24로(20건 환경 실패 구분) |

## 6. 검증 기준선(2026-10-17)

editor vitest 110파일/1621(기준선 실패 1: `hostPageLimits.test.ts` timeout) · canvas-core 57/658 · worker jest 34/1312 · api jest 143/3176(Node 26에서 sqlite ABI 환경 실패 20) · contract-freeze 94 · sdk 375 · lint 경고 editor 76 / worker 16 / api 44 이하.

## 7. 산출물과 문서

- 코드: 위 레인별 파일. 문서: 설계안 §11 P1 행 상태 갱신, `docs/CONTRACT_FREEZE.md` v1.21(기존 초안 + P1 ADDITIVE 행), `docs/PLATFORM_INTEGRATION_GUIDE.md`(`productProfile` 응답 키·`editor.complete.product`), `docs/템플릿등록 매뉴얼.md`(캘린더 세트 등록·오버레이 규약), `docs/DEPLOYMENT.md` 배포 절, RESUME §2·§5.2.8.
- 비공개 메모: `../_private_notes/wave12/` (실측·결정 근거).
