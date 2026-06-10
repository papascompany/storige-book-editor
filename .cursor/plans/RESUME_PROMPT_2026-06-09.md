# RESUME PROMPT — Storige (2026-06-09 인수인계)

> 새 세션 시작 시 **이 파일 먼저 읽기**. 프로토콜: `CLAUDE.local.md` → 최신 RESUME_PROMPT(이 파일) → `git log --oneline -20`.
> 응답 한국어. 커밋 끝 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
> 운영: master push → editor/admin **자동배포(Vercel)**. API·worker 는 **수동배포**(`ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose build api && docker compose up -d api && docker compose restart nginx'`). 프로덕션 고객 실사용 — 빌드/테스트 후 진행. SSH 키 `ssh-add -l` 확인.
> ⚠️ **스키마 변경 배포 주의**: prod `synchronize:false` + API `forbidNonWhitelisted:true` → 마이그레이션 SQL을 prod DB에 **직접 선실행** 후 API 재배포. admin(Vercel 자동)이 먼저 떠서 새 필드 보내면 옛 API가 400. 절차는 메모리 `feedback_schema_change_deploy` 참조.

---

## 0. 이번 사이클(2026-06-09) 완료·배포 내역 — 에디터 워크플로우 4종 + 폼 UX

전 사이클(2026-06-08)에 IDML/PSD→템플릿 변환기(`packages/indesign-import`)를 마무리. 이번 사이클은 **편집기 워크플로우 감사 4종(②③①④) + 템플릿셋 폼 UX 정리(B)**.

| # | 기능 | 커밋 | 배포 상태 |
|---|---|---|---|
| **②** | 템플릿 교체 후 라이브 캔버스 갱신 (낱장 '템플릿' 메뉴) | `8b6b4a6` | ✅ editor 배포. setSession 후 `TemplatePlugin.replaceTemplate`(워크스페이스·사용자객체 보존) |
| **③** | 커버(펼침면) 교체 워크플로우 | `2d26283` | ✅ editor 배포. 후보필터=`spec.coverWidth/Height`, live=`SpreadPlugin.init(newSpec)`(재호출 안전) |
| **①** | PDF 생성 옵션(단면/양면-원파일/양면-파일분리) — 데이터모델+admin | `bf1bcb9` | ✅ **전체 배포**(마이그레이션+VPS API+admin). `template_sets.pdf_output_mode` |
| **①** | 워커 분기(duplex-split 분할) — Phase 2 | branch `feat/pdf-output-worker-A1`(`386c8ab`) | ⏸ **스테이징 보류**(인쇄출력 영향). master 미반영 |
| **④** | 에셋 구성(템플릿셋↔라이브러리 카테고리 큐레이션) — 데이터모델+admin | `1d77812` | ✅ **전체 배포**. 조인 `template_set_library_categories`(카테고리 단위, "연결 없으면 전역") |
| **④** | 에디터 에셋 필터링 enforcement — Phase 2 | `d6bafab`(API)+`c7e6ba6`(editor) | ✅ **전체 배포**. editor-contents에 templateSetId 필터 |
| **B** | 템플릿셋 폼 UX 정리(Collapse 5그룹 아코디언) | `6736762` | ✅ admin 배포. Chrome 검증완료 |

추가 버그수정(④ 작업 중): `template_sets` **생성 시** `pdfOutputMode/endpaperConfig/coverEditable/coverPreviewImage/contentPdfEditable`가 저장 안 되던 잠재버그(이전엔 *수정* 시에만 저장) → create 명시매핑 보강(`1d77812`).

### 검증 방식
- 코드레벨 정적검증(tsc/build/lint) + admin 측은 Chrome 직접 화면 테스트(①④ 필드·B 아코디언 렌더 확인). 
- 에디터 런타임(②③ 캔버스 교체, ④ 에셋 필터)은 라이브 세션 필요 → 수동 스모크 테스트 권장(절차는 §2).
- 로컬 백엔드/워커 없음 → 워커/DB는 런타임 미검증.

---

## 0-b. 변환모듈 인쇄 정합성 사이클(2026-06-09 오후, CTO 방향)

변환모듈 P0/P1을 진행. 인쇄 출력 영향 항목은 **스테이징 브랜치 보존**(검증 후 머지), 무관 항목만 배포.

| 항목 | 상태 |
|---|---|
| **B. 상품별 색모드** `TemplateSet.colorMode(rgb/cmyk)` + admin | ✅ **배포**(`7cf5a79`, 마이그레이션 `color_mode`). 워커 색변환(GS ColorConversionStrategy/ICC)은 미구현(스테이징 예정) |
| **A. 텍스트 아웃라인 혼합폰트 충실도** | 🌿 `feat/print-text-outline`(`b9a3fa0`). ※ 아웃라인 자체는 이미 라이브(8fea0e8), 이건 혼합폰트 per-run 버그 수정 |
| **C. overprint/별색 보존** (GS pdfwrite 보존 플래그) | 🌿 `feat/print-overprint-preserve`(`5c02c1e`) |
| **PNG-1. 변환 PNG 스토리지 업로드**(dataURL→URL, DB 비대화 해소) | ✅ **배포**(`1dd9484`, admin) |
| **PNG-2. 사진 프레임 마스킹** | 🌿 **구현** `feat/print-frame-masking`(`beca763`). inverted clipPath(프레임 클론 absolutePositioned+inverted:true) → 투명창에만 사진, 프레임 위(bringToFront). 실사용 setupFrameContent 갭 해소 + frameRef 직렬화 + WorkspacePlugin page-outline 가드. 스테이징 시각검증 필요(창 방향·z순서·재로드·인쇄 export). |
| **D. 에디터 실로드 E2E**(책등가변+meta) | 수동 절차 §2-b. `meta` 직렬화 해소(canvas.ts:151) 확인, 실세션 1회 검증 필요 |

**✅ 통합 배포됨(merge `20ac84c`, 2026-06-09 오후, 오너 결정 deploy-and-iterate)** — 위 4종(① duplex-split · A 아웃라인 충실도 · C overprint 보존 · PNG-2 프레임 마스킹)을 master 머지 + 배포(editor Vercel + VPS api·worker, 마이그레이션 없음, API healthy). 스테이징 브랜치 4종 삭제. **실주문/시각 검증은 실 IDML 플로우에서 진행** → **신규 문서 [`docs/IDML_IMPORT_FLOW.md`](../../docs/IDML_IMPORT_FLOW.md) + `.html`**(업로드·변환·등록·테스트·검증 전체 플로우 + 두 시나리오(펼침면 하이브리드/책등가변) + 검증 체크리스트 + 문제해결). 미구현: B 워커 색변환(GS ColorConversionStrategy).

---

## 0-c. 좌표 중앙원점 정합 사이클 (2026-06-09 저녁) — IDML 임포트 표지 부분렌더 해결

실 IDML(MA-348) 임포트 표지가 편집기에서 **좌상단 1/4만 렌더**(디자인 객체 다수 누락처럼 보임). 원인 추적 + 적대 교차검증(서브에이전트 워크플로우 2회)으로 확정·수정.

**근본원인 = 좌표계 '원점' 불일치(DPI 아님).** Storige 규약 = 콘텐츠 **중앙원점@150dpi**(WorkspacePlugin workspace originX/originY='center', left/top:0 = fabric(0,0) + clipPath=workspace; setZoomAuto가 캔버스를 #canvas-wrapper 크기로 맞추고 워크스페이스 중심 정렬 — 반응형/모바일). 일반 편집기-제작 spread(`d765713a`)도 originX='center'+중앙원점(앞표지+/뒤표지-/책등0)으로 확인. 변환기만 좌상단원점(0..W)+originX 미설정으로 출력 → clip. DPI는 전 구간 150 일관(정상), 300은 래스터 화질(별개).

| 항목 | 커밋 | 상태 |
|---|---|---|
| **변환기 중앙원점 출력** (toSpreadTemplate/toSinglePageTemplate/index.mjs: originX/originY='center' + (-halfW,-halfH) 평행이동, 단위테스트 추가) | `a92f146` | ✅ **배포**(admin Vercel). 실 IDML 재변환 74객체 전부 중앙원점 + **편집기 실렌더 전체 디자인 정확 복원**(막대그래프·삼각형·반원·로고) 검증. 변환기 테스트 35/35 |
| **표지 펼침면 PDF 저장 복구** (useWorkSave:619 미정의 `spreadPlugin.exportToPDF()` → `saveMultiPagePDFAsBlob`, 펼침면 mm·dpi300) | `a8c9b65` | ✅ **배포**(editor Vercel). editor tsc 0/build OK. ⚠️ 실 book-set 세션 표지저장 E2E는 미검증(코드/빌드/로직검증만) |

**교차검증 결론**: a92f146 좌표수정 = 정확·완전·회귀無(감사[1]의 "치명적" 주장은 commit 오귀속 — a92f146는 변환기 4파일만 변경). width 단위(px vs mm) = 버그 아님(워크스페이스는 `Template.width`(mm)로 산출, canvasData.width 미사용). exportToPDF = 선재 blocker 확정(수정함).

**✅ 선재 버그 수정(`1d6bf9e`, a92f146 무관)**: `SpreadPlugin` 객체↔region **좌표계 불일치**. 엔진은 content 좌표(0..totalWidthPx), Fabric 은 중앙원점 scene. 3개 호출부(`handleObjectModified`/`repositionObjects`/`checkObjectsOutOfBounds`)가 좌표 변환 없이, 게다가 **`getBoundingRect()`(무인자=lineCoords=viewport 좌표, 줌 의존)** 를 엔진에 넘겨 **드래그 영역이동·책등가변 시** 영역 오판정·오배치(정적 렌더는 미발현). 수정: `getContentBoundingRect()` 헬퍼(=`getBoundingRect(true,true)` scene → −origin content), 입력 content 변환 + 출력 +origin scene 복원. 신규 `SpreadCoordBridge.test.ts`(버그재현+수정). canvas-core 226/226, editor build OK. ⚠️ **라이브 E2E(실 책등가변 드래그/리사이즈)는 미검증** — 정적 경로 미영향이라 회귀 위험 낮으나 실세션 1회 확인 권장(§2-b 절차).

> 좌표 규약 상세: 사용자 메모리 `reference_coordinate_convention`.

---

## 0-d. 책등 가변 인쇄 데이터 무결성 감사 (2026-06-09 밤) — 디지털인쇄 전문가 관점

오너 요청: "책등 가변 시 가변영역 표시~뒤표지/책등 처리의 **출판 데이터 무결성**을 인쇄전문가 관점에서 보장". 적대 감사 워크플로우(3 에이전트: 재배치/PDF지오메트리/편집표시·책등적합 → 종합).

**🔴 IB-1 (유일한 진짜 integrity-blocker, `622b1cc` 배포)**: `SpreadPlugin.repositionObjects` 가 **back-cover/back-wing 을 no-op** 으로 skip. 책등 확장 시 워크스페이스 중앙 대칭 확장 → `getContentOrigin`(-totalWidthPx/2) 이동 → 뒤표지 객체 scene 고정이라 **content 프레임에서 책등 쪽으로 drift = Δspine/2**(책등7→20mm=6.5mm). 뒤표지 바코드/간기/가격이 책등 침범 → 오인쇄·반품. PDF viewBox 동일 프레임이라 PDF 전파. **수정**: back-* 를 front-* 와 동일 `computeObjectReposition` 경로로 병합(region.x 불변+xNorm content 보존, +origin scene 보정 → drift 0). 회귀테스트 `SpreadCoordBridge.test.ts`(content 보존 + drift 불변식). canvas-core 227/227.

**🟡 SF-3 (`e961815`)**: 표지 PDF 저장 폭을 `SpreadPlugin.getLayout().totalWidthMm`(트랜잭션 동기 갱신) 우선 사용 → 책등가변 직후 저장 시 settingsStore stale 로 폭 부족/과잉 방지.
**🟡 SF-4 (`e961815` + API 배포)**: 책등 산식에 `Math.max(0, …)` 하한(types+spine.service 양쪽) — 음수 책등 레이아웃 붕괴 방지.

**⏸ 후속(인쇄 차단 아님, 미수행)**: ① IB-2 PDF **TrimBox/BleedBox** 메타 등록(현 PDF 도 폭+cutSize 로 인쇄가능 → should-fix 강등, jsPDF 박스 API 버전위험 + 인쇄소 워크플로 확인 필요). ② 책등 **접지선/스파인 위치 마크**(RIP 식별용). ③ SF-5 **책등 텍스트 오버플로우 경고**(좁은 책등에서 표지 침범 감지; 텍스트 자동축소는 ❌ 폰트품질 의도설계). ④ 블리드 배경연장 PDF 보장 + E2E.
**⚠️ 라이브 E2E 미검증**: IB-1/SF-3 은 로직·단위테스트·수치불변식으로 검증. 실 책등가변 셋 세션에서 내지수변경→책등재계산→뒤표지 정위치 추종 + 표지저장 폭 1회 시각확인 권장(§2-b).

---

## 0-e. 편집사이즈(블리드) carry 인쇄 + 재단선 마커 + 고객업로드 임포지션 (2026-06-10) — P1~P4 배포

오너 확정: 판형=재단(trim), 블리드=사방 per-edge mm(상품별), **작업사이즈=재단+블리드×2**. 블리드>0&재단선표기ON→작업사이즈 PDF+코너 마커+TrimBox. 고객 업로드 내지는 trim/work 받아 중심 임포지션(동일=패스스루/큼=이너핏/작음=중앙). 허용오차 ±0.2 기본. **상세: [`docs/BLEED_TRIM_MARK_FEATURE.md`](../../docs/BLEED_TRIM_MARK_FEATURE.md).**

| | 내용 | 커밋 |
|---|---|---|
| **P1** 데이터모델+배선 | template_sets.bleed_mm/crop_mark_enabled/size_tolerance_mm + edit-sessions→워커(trim/work/tol) + admin 폼 | `771c3af` ✅배포(마이그레이션+API+worker) |
| **P2** 편집기 화면가이드 | 점선 트림 + 코너 마커(cutSize>0) + 재단선 이탈 경고(objectOutOfTrim). 화면전용 excludeFromExport | `4267482` ✅배포(editor) |
| **P4** 워커 임포지션 | getPdfInfo 실측 + centerOnPage + convert mode분기(미지정=현행) + 검증 tolerance가변(1mm유지) | `b235bf8` ✅배포(dormant) |
| **P3** 편집기 PDF 출력 | ServicePlugin 게이트(cropMarkEnabled&bleed>0&!envelope)→작업사이즈+마커+박스, OFF=byte-identical. printMarkConfig 배선 | `1e118a2` ✅배포(editor) |

**전부 게이팅으로 전 상품 무변경 배포.** 잔여 = **활성화·검증(오너 통제)**: (가)P3 admin 토글(crop_mark_enabled ON+블리드)→opt-in 상품 PDF 박스/마커 mutool/Acrobat 검증, (나)P4 업로드→mode 주입 배선 1건(워커 자체결정 or UI) + 스테이징 골든·tolerance 단계인하, (다)cutSize(양변)↔bleedMm(per-edge) 정합 점검. 좌표규약 [[reference_coordinate_convention]].

---

## 2-b. D 에디터 실로드 E2E 절차

1. admin: IDML 변환 → 표지 Template 등록 → 책등 가변 책 셋 등록(방법A) + 내지 추가 + pageCountRange. 2. 그 셋으로 책모드 세션. 3. ✅ 표지+영역 가이드. 4. 내지 수 변경 → ✅ 책등 폭 자동 재계산 + 앞/뒤표지 평행이동. 5. 편집완료→재로드 → ✅ meta 보존(책등 가변 재배치 동작).

---

## 1. 잔여 작업 (우선순위)

1. **① 워커 duplex-split 실주문 검증**(✅ 배포됨 merge `20ac84c`) — 셋 `pdfOutputMode='duplex-split'` 선택 시만 작동(그 외 dormant). 검증항목: 양면 낱장 실주문 N세트→`set_<i>.pdf` n개(각 2p, 앞=먼저/뒤=다음 순서), single 1p, duplex-merged 회귀 무변경, 멱등 재완료, 웹훅 `outputFiles[type:'set']` 소비처(admin/PHP) 배선. ⚠️ 회전 없음(RIP 처리).
2. **④ 폰트 큐레이션(후속)** — `LibraryFont`에 `category_id` 컬럼 없어 폰트는 큐레이션 제외(현재 전역). 필요 시 스키마+admin 폰트-카테고리 UI 추가.
3. **②③ 에디터 수동 스모크** — §2 절차.
4. **set 출력파일 소비 배선** — duplex-split의 n개 `set` 파일을 admin/PHP가 가져가는 경로(현재 웹훅 payload엔 실림, 소비처 미배선). A1 에이전트가 별도 task로 등록함.

---

## 2. ②③ 에디터 수동 테스트 절차 (라이브 세션 필요)

**② 템플릿 교체**: 낱장 편집세션 → 텍스트/이미지 직접 추가 → 사이드 '템플릿' → 같은 사이즈 다른 템플릿 교체 → ✅ 화면 즉시 갱신 + 재단선/워크스페이스 + 내가 추가한 객체 보존.

**③ 커버 교체**(책모드 표지): 표지 펼침면 페이지 → 사이드 '템플릿' → ✅ 같은 표지 사이즈 다른 펼침면이 후보로 표시 → 교체 → 영역(앞/뒤/책등) 가이드 새 spec 재계산. 내지 수 변경 시 책등 자동 재계산.

**④ 에셋 필터**: admin에서 템플릿셋에 '에셋 구성'으로 특정 카테고리 연결 → 그 셋의 편집세션 → 사이드 배경/프레임/요소 → ✅ 연결한 카테고리 에셋만 노출(연결 없으면 전체).

---

## 3. 핵심 파일

- `apps/editor/src/components/TemplatePanel/TemplatePanel.tsx` — ②③ 라이브 교체(handleReplaceConfirm)
- `packages/canvas-core/src/plugins/{TemplatePlugin,SpreadPlugin}.ts` — replaceTemplate / init(spec)
- `apps/api/src/templates/entities/template-set-library-category.entity.ts` — ④ 조인 엔티티
- `apps/api/src/templates/template-sets.service.ts` — ④ upsert/populate + create 보강
- `apps/api/src/editor-contents/editor-contents.service.ts` — ④ 에셋 필터(getCuratedCategoryIds)
- `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` — ①④ 필드 + B Collapse 그룹
- `apps/api/migrations/20260609_*.sql` — ①(pdf_output_mode) / ④(조인테이블, FK collation=utf8mb4_unicode_ci 주의)
- (보류) `apps/worker/src/processors/synthesis.processor.ts` + `apps/api/src/{worker-jobs,edit-sessions}` — ① duplex-split (branch)
