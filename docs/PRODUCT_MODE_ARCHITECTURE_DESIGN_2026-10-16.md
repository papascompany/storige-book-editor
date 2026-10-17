# Storige 상품별 편집 모드·외부 연동 아키텍처 설계안 v2 (2026-10-16)

> **진행 상태(2026-10-17)**: §10 P0(낱장 N장 PDF·IIFE·duplex-split 쪽수 원천)와 §6.2 (가) 낱장 분류 검증(`productKind='sheet'`·`pageStep`·`postProcessColorRule`, 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`)은 **구현·검증·운영 배포 완료**(master `19f1ce7c`, 배포 기록 `docs/DEPLOYMENT.md` 2026-10-17 절). 다음은 §11 **P1(캘린더 탁상·벽걸이(가))** — 계획 `docs/CALENDAR_MODE_DEVELOPMENT_PLAN_2026-10-17.md`, 새 세션 프롬프트 `.cursor/plans/CALENDAR_MODE_SESSION_START_PROMPT_2026-10-17.md`. 결정 현황은 §13 각 항목 끝의 [상태] 표기 참조.
>
> 상태: 설계안(§1~§9 아키텍처)은 오너 검토 중이며 P0·(가)만 코드 반영됨. 1차 문서 [`CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md`](./CALENDAR_EDIT_MODE_DESIGN_2026-10-16.md)(캘린더 단일 범위)를 이 문서가 흡수·대체한다.
> 범위: 낱장·책자·표지·내지 임포지션(기존) 위에 **캘린더(탁상·벽걸이 가/나/다)**, **사진인화(인화 방식 단면 / 인쇄 방식 앞·뒤 ①②③)**, 그리고 **100p books·JumboCard(PrintCard Studio)·insta_print(instax_upload)·FrameShop·bookmoa/printy**가 단순하게 연동하고 **양측 운영자가 주문을 확인·수정·다운로드·제작**하는 구조.
> 근거 수집 방법: 저장소 읽기 전용 정찰 7건(모드·canvas-core·연동·임포지션·데이터·문서·비평) + 외부 레포 정찰 5건 + 관점이 다른 설계안 3개(A 최소 변경 / B 프로파일 재구조화 / C 연동 역설계) + 독립 심사 3명(회귀·상품/인쇄·파트너) + 종합. 채점 합계 A 133 · C 132 · B 116 → **A안 골격 + C안(런처·운영 콘솔)·B안(스냅샷·revision) 이식**. 모든 `file:line`은 2026-10-16 master(`044a04ca`) 기준이며 이 문서 작성 시 표본 8곳을 재확인했다.
> 오너 답변(2026-10-16)은 사실로 취급한다: 벽걸이 3유형과 "앞면=상단 페이지, 뒷면=하단 페이지(링을 들어올려 상하로 펼침)", 인화 방식=단면만·인쇄 방식=앞/뒤 ①②③, 시작연월 변경 시 범위 밖 기념일만 안내·수정, 재단선·링 PNG는 **화면 전용 오버레이(인쇄 PDF에는 해당 영역이 정상 데이터로 포함)**.
> 오너 정정(2026-10-17) 2건 반영: ① 낱장 상품 분류 = 단면(PDF 1쪽: 엽서·포스터·전단) / 양면(2쪽: 명함·엽서·포스터·초대장) / 양면접지(2쪽, 또는 접지선 후가공면을 포함한 3쪽: 2단·3단·N접지·병풍) / 4쪽 이상은 책자(중철·무선·사철). **후가공 파일은 편집기 산출물이 아니라 고객 업로드 또는 관리자 작업 후 별도 업로드**이며, 별색 전용이 아니라 선·라운드·특정 면적·투명 객체 등을 담을 수 있다. ② 내지 쪽수 증감 단위는 상품/템플릿셋 등록 시 1·2·4쪽 중에서 프런트가 정해 값으로 넘긴다 — "4쪽 단위 고정"이 아니다(§6.2).

---

## 0. 결론

1. 상품의 편집 방식은 **`template_sets.product_profile`(nullable JSON) 데이터 속성 1개**로 선언한다. 편집기는 `if (profile)` 가드로만 동작을 바꾸고, `EditorMode('single'|'book')`·`TemplateSetType`·`PdfOutputMode`·`SessionMode`·postMessage 엔벨로프 v1·`/embed` 파라미터 12종·`OutputFile.type` 유니온은 **모두 무변경**이다. profile이 NULL인 기존 셋(book/leaflet/photobook/낱장)은 모든 경로가 바이트 동일하다.
2. 오너의 과거 설계 사상(편집기 유형 코드 + 상품 config XML)은 `profile.editorType`(자유 코드, 분류·운영 식별용) + `profile.{pages,sheet,calendar,photoPrint,output}`(동작 규칙)로 재해석한다. 코드·DOM·CSS 복제는 없다.
3. 출력은 편집기의 **N페이지 단일 PDF**가 기본이고, 양면·상단 링 달력·카드형은 worker에 **`sheet-map` mode 1개**를 추가해 시트/면 테이블(앞·뒤·회전)을 서버가 단독 권위로 생성한다. 뒷면 회전·N-up·양면 뒤집기는 기본 RIP 책임을 유지하고 매니페스트로 지시한다.
4. 외부 연동은 **파트너 서버 2회 호출**(`POST /api/partner/launch` → iframe `/embed` → `GET /api/partner/sessions/:id/deliverables`)로 통일한다. 기존 bookmoa 흐름(shop-session → templateSetId)은 그대로 유효하다.
5. 운영은 **콘솔 1개·역할 2개**: 기존 `apps/admin` EditSessions(이미 `SITE_ADMIN/SITE_MANAGER` 허용)를 항목·시트·제작 메모·ZIP으로 확장해 Storige 운영자와 파트너 운영자가 같은 화면을 쓴다. 자체 콘솔을 가진 파트너는 deliverables + operator-session으로 bookmoa와 동형.
6. 순서: **P0 기존 결함 3건 수정 → P1 profile 정본 + 탁상·벽걸이(가) 캘린더 + 런처/매니페스트 → P2 `sheet-map` + 벽걸이(나)(다) + 사진인화 ①②③ + 운영 콘솔 확장 → P3 면별 JPEG·사이즈 혼합·라벨.**

---

## 1. 설계 원칙

1. 모드 트리거는 템플릿셋 데이터 속성이다(v1.13 `hardcover_wrap` 선례, `docs/CONTRACT_FREEZE.md:168`). `TemplateSetType` 게이팅 금지(`apps/editor/src/tools/AppImage.tsx:135-137`, 오너 결정).
2. `EditorMode`에 제3값을 넣지 않는다. 모드 판정 유일 진입점 `apps/editor/src/hooks/useEditorContents.ts:1101-1123`은 `=== 'book'` 이진 분기이며 신상품은 전부 `editorMode='single'` 경로(1121행 `setHasCoverSlot(true)`)로 흐른다.
3. 파트너 노출 enum(`PdfOutputMode` `packages/types/src/index.ts:420`, `OutputFile.type` `:1198-1204`, `TemplateSetType` `:99-103`)은 확장하지 않는다(`CONTRACT_FREEZE.md:38` "기존 필드의 enum 확장도 FROZEN"). `OutputFile.type` 확장은 admin `WorkerJobList.tsx:53-58`의 `Record<OutputFile['type'], string>`도 깨뜨린다.
4. ADDITIVE만 허용하며 같은 커밋에서 `apps/api/src/contract-freeze.spec.ts`·`packages/sdk/src/embed/protocol.ts`·`docs/PLATFORM_INTEGRATION_GUIDE.md`를 갱신한다(`CONTRACT_FREEZE.md:36` 조건 ①②③).
5. 가격·주문 상태·결제 후 편집 잠금은 호스트 책임이다(D-3). Storige는 세션·파일·잡 상태와 기계 판독 매니페스트만 제공한다.
6. 출력 변경은 골든 하네스를 동반하고, 서버 런타임 스위치 없이 출력 분기를 두지 않는다.
7. 임포지션(N-up)·양면 뒤집기·회전은 기본 RIP 책임을 유지한다(`apps/worker/src/processors/synthesis.processor.ts:1576-1577`). 회전은 profile 값으로만 켠다(코드 기본값 0).
8. 재단선·타공·링 이미지는 **화면 전용 오버레이**다(오너 지시). 인쇄 PDF에는 오버레이만 빠지고 그 아래 영역은 정상 인쇄 데이터로 들어간다. 마스킹·공백 처리 금지.
9. ILARK wpod 편집기는 기능 사상만 참조한다(ASP 라이선스: 코드·DOM·CSS 복제 금지).

---

## 2. ProductProfile · 편집 모드 모델

### 2.1 저장 · 판정 · 스냅샷 · 실행

| 단계 | 내용 | 근거 |
|---|---|---|
| 저장 | `template_sets.product_profile json NULL`. 엔티티는 `coverConfig` 패턴 복제. 마이그레이션 `apps/api/migrations/20261017_add_template_set_product_profile.sql`(관례 `20260928_add_template_set_page_step.sql`). | `apps/api/src/templates/entities/template-set.entity.ts:272-273` |
| 서비스 매핑 | **3곳 + DTO**: create `template-sets.service.ts:125`, copy `:422`, deriveOrientation `:980`. update는 `Object.assign(templateSet, {...dto})`(`:311-314`) 통과라 DTO 등재만 필요(`endpaperConfig` 패턴 `dto/template-set.dto.ts:267-271` `@ValidateNested @Type`). | 재확인 완료 |
| 판정 | `packages/types/src/product-profile.ts` 신규 `resolveProductProfile(templateSet): ProductProfile \| null` — NULL이면 null(legacy). 단위 테스트가 "NULL → null, `version!==1` → null + warn"을 고정. `validateProductProfile(p): string[]`를 API custom validator·admin 폼·편집기가 공유. | |
| 스냅샷 | 세션 생성(launch 또는 편집기 `createPayload`)과 complete 시 `edit_sessions.metadata.productProfile`에 **전체 복사**(`pdfOutputMode` 스냅샷 선례 `edit-sessions.service.ts:1729-1735`). 운영자 재편집·재합성은 템플릿셋 현재값이 아니라 이 스냅샷으로 동작한다. | |
| 실행 | 편집기 `useSettingsStore.productProfile`(enabledMenus 보관 패턴)에서 플러그인 활성·페이지 정책·라벨·완료 메타를 읽고, 서버 `applyPdfOutputMode`가 출력 분기를 읽는다. | |

### 2.2 타입 (`packages/types/src/product-profile.ts`, `index.ts` re-export, `TemplateSet.productProfile?: ProductProfile | null` additive)

```ts
export type ProductKind = 'sheet' | 'calendar' | 'photo-print';

export interface ProductProfile {
  version: 1;
  kind: ProductKind;
  /** 보조 라벨(자유 코드, coverType 선례). admin 필터·운영자 식별용. 동작 분기 금지. */
  editorType: string; // 'sheet_duplex' | 'calendar_desk' | 'calendar_wall_a' | 'calendar_wall_b' | 'photo_chem' | 'photo_digital_items' | 'photo_digital_fixedback' | 'photo_digital_sheet' …
  pages: {
    kind: 'fixed' | 'range';
    count?: number; min?: number; max?: number;
    step?: 1 | 2 | 4;                                    // 증감 단위 — templateSet.pageStep 과 같은 의미, 상품별로 프런트가 결정(4 고정 아님)
    protectedIndices?: number[];                         // 삭제 금지 캔버스(표지 등)
    labelRule: 'default' | 'month' | 'photo' | 'sheet';
  };
  sheet: {
    faces: 1 | 2;
    canvasLayout: 'canvas-per-sheet' | 'canvas-pair';   // pair = [앞, 뒤] 교대
    binding: 'none' | 'top-ring' | 'center-punch';       // 타공 위치(오너 과거 설계 punching_calendar_center 대응)
    pairing?: 'same-sheet' | 'offset-next';              // canvas-pair 전용 — §6.3
    backRotation: 0 | 180;                               // 0 = RIP 책임(현행 유지)
    duplexFlip: 'short-edge' | 'long-edge';              // 매니페스트 지시용(산출 무영향)
  };
  /** 후가공 파일(접지선·타공·부분코팅 등). 편집기가 만들지 않는다 — 고객 업로드 또는 관리자 별도 업로드. */
  postProcess?: {
    pages: number;                                       // 결합 PDF 에 포함될 때의 후가공면 수(접지 = 1)
    source: 'upload';                                    // 항상 업로드(편집기 산출 아님)
    colorRule: 'any' | 'spot-only';                      // 기본 'any' — 선·라운드·면적·투명 객체 허용
    allowTransparency: boolean;
  };
  calendar?: {
    layout: 'desk-1' | 'wall-A' | 'wall-B' | 'wall-C';
    monthCount: 12; coverCanvases: number;
    allowedRange: { from: string; to: string };          // 'YYYY-MM', 날짜 데이터 범위 ⊆ 검증
    weekStart: 0 | 1;
    show: { holidays: boolean; lunar: boolean; solarTerms: boolean };
    dataVersion: string;                                 // calendar-data 버전 고정
  };
  photoPrint?: {
    process: 'chemical' | 'digital';
    composition: 'per-photo-free-back' | 'per-photo-fixed-back' | 'sheet-cards';   // ① ② ③
    sizes: Array<{ code: string; widthMm: number; heightMm: number; minDpi: number;
                   raster?: { widthPx: number; heightPx: number } }>;   // 미니랩 픽셀 치수(P3)
    options: {
      border: Array<'none' | 'white'>;                   // 무테 | 유테
      fit: Array<'paper-full' | 'image-full'>;           // 페이퍼풀=cover(잘림) | 이미지풀=contain(여백) — §13-3
      finish: Array<'matte' | 'glossy'>;
      brightnessFix: boolean; dateOverlay: boolean; grayscale: boolean;
    };
    copies: { min: number; max: number };
    backTemplateId?: string;                             // ② 뒷면 고정
    upload: { maxPhotos: number; maxMb: number };
  };
  output: {
    mode: 'single-pdf' | 'sheet-map';
    sheetFiles?: 'per-sheet' | 'merged-duplex';          // sheet-map 전용
    raster?: { format: 'jpeg'; quality: 100; chroma: '4:4:4'; resize: false; colorSpace: 'srgb' } | null; // 선언 P1, 구현 P3
  };
}
```

옵션 소비 경계(고정 규칙): **편집기가 소비** = `border`(프레임 `frameInsetMm`), `fit`(프레임 `fitMode`), `dateOverlay`, `grayscale`. **통과만** = `finish`, `brightnessFix`, `copies`(세션 `metadata.items`; 가격·제작은 호스트/인쇄 책임).

### 2.3 편집기 치환 지점(모두 `if (profile)` 가드, NULL이면 기존 코드 그대로)

| 지점 | 변경 |
|---|---|
| `useEditorContents.ts:1203-1211` | `hostLimitsActive` 블록 뒤 `else if (profile)` → `settingsPageBounds({ range: [fixed ?? min, fixed ?? max], per: canvasLayout==='canvas-pair' ? 2 : 1, anchorCanvases: calendar?.coverCanvases ?? 0 })`. 호스트 한도가 오면 호스트 우선(`hostPageLimits.ts` 규칙 유지). |
| `components/editor/SidePanel.tsx:488-493, 508-519` | 현행은 상한 도달 시 추가가 `alert`, 삭제는 조용히 `return`이고 버튼은 남는다. `pages.kind==='fixed'`면 추가/삭제 버튼 자체를 숨기고 `protectedIndices` 캔버스는 삭제 버튼 제거. `canvas-pair`는 2장 단위(기존 `pageStepUnit` 480-484 재사용). |
| `utils/createCanvas.ts:33-48, 425-473` | `VITE_ENABLE_CALENDAR`·`VITE_ENABLE_PHOTO_PRINT`(기본 on 패턴 `!== 'false'`) AND `profile.kind` 일치 시 `editor.use(new CalendarPlugin())` / `PhotoPrintPlugin`. |
| `components/PageNavigation/BookNavigation.tsx:127-130` | `buildPageMeta(details, options)`에 `options.labelResolver?: (index) => string` additive. month: "2027년 1월 상단/하단", sheet: "3장 앞/뒤", photo: "사진 3 앞". `EditorView.tsx:118` `usePageStrip = isSpreadMode \|\| !hasCoverSlot`는 profile 셋이 `hasCoverSlot=true`라 standalone·embed 모두 BookNavigation — 변경 없음. |
| `components/editor/ToolBar.tsx:37` + `packages/types/src/index.ts:1868-1879, 1888-1895, 1901-1913` | `EditorMenuKey` `'CALENDAR'`·`'PHOTO_PRINT'`, `EDITOR_MENU_DEFS` `defaultEnabled:false`, `requiresFlag` 유니온 확장, `ALL_MENUS` 항목 2개(**세 곳**, `docs/EDITOR.md §7`이 맞고 types 주석의 "두 곳"은 불완전). |
| `embed.tsx:1266-1310` createPayload | `metadata.productProfile`(스냅샷), `metadata.calendar`, `metadata.items` 기록. 시트 테이블은 기록하지 않는다(서버 권위). |
| `embed.tsx:2870-2931` 완료 payload | additive 키 `product?: {kind, editorType, canvasCount, sheetCount, faces}`, `items?: PhotoItem[]`. `files`·`pages` 중첩 불변. `pageCount` 의미는 현행 그대로 "캔버스(면) 수"(비스프레드 산식 `:2272-2281` 불변) — contract test로 고정. |

### 2.4 플러그인 공통 제약

임베드 저장 경로는 `ServicePlugin.saveJSON`의 `beforeSave/afterSave`를 우회한다(`embed.tsx:2352, 2417, 2592-2593`, `useEmbedAutoSave.ts:110-118`). 따라서 `CalendarPlugin`·`PhotoPrintPlugin`은 lifecycle 훅에 의존하지 않고 **객체 `extensionType`+`extension` 데이터만으로 복원**되며, 복원 후 명시 호출 `plugin.rehydrate(ctx)`를 둔다(`frameInteractive.ts:20-33` `rebindFrameInteractivity` 패턴).

---

## 3. 상품별 매핑 표

| 상품 | profile 요지 | 캔버스 구성(single) | 출력 | 단계 |
|---|---|---|---|---|
| 낱장 1장(현행) | NULL | 1 | 편집기 단일 PDF(불변) | 0 |
| 낱장 단면(엽서·포스터·전단) | `sheet{faces:1}`, `pages{fixed:1}` | 1 | 1쪽 PDF | 0 (검증 규칙만 §6.2) |
| 낱장 양면(명함·엽서·초대장) | `sheet{faces:2, canvas-pair}`, `pages{fixed:2}` | 앞 / 뒤 | 2쪽 PDF(또는 duplex-split 1세트) | 0 (검증 규칙만 §6.2) |
| 양면접지(2단·3단·N접지·병풍) | 양면 + `postProcess{pages:1, source:'upload', colorRule:'any'}` | 앞 / 뒤 (후가공면은 편집기 밖) | 2쪽 PDF + 후가공 파일은 업로드 검증(`post_process`) | P2 |
| 낱장 N장 양면 | `sheet{faces:2, canvas-pair, binding:none}`, `pages range`, `output single-pdf` | 2i 앞 / 2i+1 뒤 | N페이지 PDF(duplex-merged 의미) | P0 결함 수정만 |
| 책자/표지/책등/내지 | NULL | 기존 book/spread | compose-mixed | 0 |
| 탁상 월1면(`calendar_desk`) | `calendar{desk-1, coverCanvases:1}`, `sheet{faces:1, canvas-per-sheet, top-ring}`, `pages{fixed:13, protected:[0], month}` | 표지1 + 월12 | 13p 단일 PDF | P1 |
| 벽걸이 (가)(`calendar_wall_a`) | `wall-A`, 나머지 탁상 동일 | 월 캔버스 1장에 사진틀 + grid 상하 배치 | 13p 단일 PDF | P1 |
| 벽걸이 (나)(`calendar_wall_b`) | `wall-B`, `sheet{faces:2, canvas-pair, binding(top-ring\|center-punch), pairing, backRotation, duplexFlip:'short-edge'}`, `pages{fixed:25, protected:[0], month}`, `output sheet-map per-sheet` | [표지, 상1, 하1, …, 상12, 하12] | sheet-map 13시트 | P2 |
| 벽걸이 (다)(`calendar_wall_c`) | (나)와 동일 | 하단 템플릿에 사진틀 + grid 포함(오버레이/빗김은 템플릿 차이) | (나)와 동일 | 0 추가 |
| 사진인화 인화 방식(`photo_chem`) | `photoPrint{chemical, per-photo-free-back}`, `sheet{faces:1}`, `pages range`, `output single-pdf` (+`raster` 선언) | 사진당 캔버스 1 | N페이지 PDF; P3 면별 JPEG | P2 |
| 인쇄 ①(`photo_digital_items`) | `digital, per-photo-free-back`, `faces:2, canvas-pair, same-sheet` | 2i 앞(사진틀 고정) / 2i+1 뒤(자유) | sheet-map per-sheet + items | P2 |
| 인쇄 ②(`photo_digital_fixedback`) | ① + `backTemplateId` | 뒷면 캔버스는 템플릿 복제 + `movable/deleteable/contentEditable=false`(`utils/objectPermissions.ts:7-34`) | ①과 동일 | P2 |
| 인쇄 ③ 카드형(`photo_digital_sheet`) | `sheet-cards`, `faces:2, canvas-pair, same-sheet`, `pages range step 2` | 2i / 2i+1 | sheet-map per-sheet 또는 single-pdf | P2 |

- **벽걸이 (나)(다) 물리 구조**: 오너 답변대로 편집기는 월마다 [상단 페이지(사진), 하단 페이지(달력)] 2캔버스를 세로로 보여준다(`labelRule:'month'` → "2027년 1월 상단/하단"). 시트 앞/뒤 매핑은 `pairing`이 결정하며(§6.3), 기본값은 오너 문구 그대로 `same-sheet`(앞=상단, 뒤=하단)다. 상단 링 넘김형에서 물리적으로 `offset-next`가 필요한지는 제작 샘플로 확정한다(§13-1). 두 규칙 모두 데이터 선택이라 코드 변경 없이 전환된다.
- **사진인화 세션 모델**: 세션 1개 = 주문 항목 1개 = 사이즈 1종. 캔버스 크기는 단일 모드에서 `templateSet.width/height`로 통일되고(`useEditorContents.ts:1235-1239, 1413-1417`) `ServicePlugin`은 문서 단위 orientation·size 1개다(`ServicePlugin.ts:258-262, 769`). 한 주문의 사이즈 혼합은 **같은 `orderSeqno`로 세션 N개**(호스트가 사이즈별 templateSetId 매핑; bookmoa `storigeTemplateSetsByBinding` 선례)이며 `GET /edit-sessions/external?orderSeqno=`(FROZEN, `edit-sessions.controller.ts:482`)로 묶어 조회한다. 1세션 사이즈 혼합은 P3(§13-6). `metadata.items: Array<{index, canvasIndex, sourcePhotoId?, sizeCode, copies, border, fit, finish, brightnessFix, dateOverlay, grayscale, lowRes}>`.
- **인화(chemical) vs 인쇄(digital)**: 오너 답변대로 chemical은 `faces:1` 고정이며 `validateProductProfile`이 `process==='chemical' && faces!==1`을 거부한다.

---

## 4. 편집기 변경 지점 요약

- 신규/수정 파일: `apps/editor/src/utils/productProfile.ts`(resolve 래퍼·settings 반영), `utils/pageLabels.ts`(labelResolver), `stores/useSettingsStore.ts`(productProfile 필드), `hooks/useEditorContents.ts`(1203 뒤 분기 1곳), `components/editor/SidePanel.tsx`(fixed/protected 숨김), `components/PageNavigation/BookNavigation.tsx`(labelResolver), `components/editor/ToolBar.tsx`(ALL_MENUS 2항목), `components/calendar/*`(시작연월·표기·기념일 패널), `components/photoPrint/*`(항목 옵션 패널), `embed.tsx`(P0 3곳 + createPayload/complete additive 키 + watchdog 예산).
- **브라우저 PDF 예산**: 단일 분기는 `withWatchdog(…, 120000, 'single-gen')`(`embed.tsx:2829-2833`). profile 세션은 `max(120000, 15000 × canvasCount)`로 상향하고 P1 완료 조건에 13캔버스(300dpi 사진 1장씩) 실측을 둔다. 25캔버스(나)는 P2 실측으로 한도 확정; 초과 시 서버 측 래스터 대안은 범위 밖으로 기록.
- **Shopify 조율**: `apps/editor/src/embed.tsx`는 W3 EDT-301 인수 목록(`docs/SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.md:73, 655`)이다. P0·P1의 embed.tsx 변경을 W0 CTR-005 전에 선반영·통지한다.

---

## 5. canvas-core

- 신규: `src/plugins/CalendarPlugin.ts`, `src/plugins/PhotoPrintPlugin.ts`, `src/calendar/{core.ts, data/*.json}`, `src/index.ts` export.
- **`CalendarPlugin`**: 1차 문서 §3.1 그대로 — `extensionType:'calendar-grid'` fabric.Group, `extension:{monthOffset, variant('month'|'mini'|'year'), style}`, 컨텍스트 `metadata.calendar{startYear, startMonth, anniversaries[], dataVersion}`. 월은 **상대 월(`monthOffset`)**로 저장해 시작연월 변경 시 그리드만 다시 그리고 사진·텍스트는 보존한다. 시작연월 변경(오너 답변 3): 새 범위 밖 기념일을 기념일 관리 목록에 "초기화됨" 표시 + 사용자 수정/삭제 UI. `allowedRange` 밖 시작연월은 UI에서 거부. `calendar-core` 순수 함수(6×7 행렬, 대체공휴일, 음력 환산표, 24절기)와 정적 데이터 `data/<version>.json`.
- **날짜 데이터 거버넌스**: 출처 = 공공데이터포털 특일정보(공휴일·대체공휴일) + KASI 음양력(절기 포함). 연 1회 + 임시공휴일 지정 시 데이터 파일만 갱신·`dataVersion` 증가(코드 무변경). 세션은 `metadata.calendar.dataVersion`을 고정해 재합성 재현성 보장. `validateProductProfile`이 `allowedRange ⊆ 데이터 범위`를 검사.
- **`PhotoPrintPlugin`**: 프레임 신규 속성 `fitMode:'cover'|'contain'`(기본 cover), `frameInsetMm:number`(기본 0) → `utils/canvas.ts:94-178` `extendFabricOption` 등재 + `curveText.test.ts:187-190` 패턴의 등재 검사 테스트. 적용: `useImageStore.ts:969-972` `Math.max` → `fitMode==='contain' ? Math.min : Math.max`, 벡터 경로 `:727-728` 동일, `FrameInteractionPlugin._syncFromFrame`(`:126-172`) inset 반영. 촬영날짜: `extensionType:'date-overlay'` 텍스트, 원천은 채움 시점의 업로드 레코드 `takenAt`(`useImageStore.ts:205`, `ExternalPhoto.takenAt` `index.ts:2284`)을 fillImage 객체 `extension.takenAt`으로 복사해 재오픈·사진 교체 후 재생성 가능하게 한다. EXIF 부재 시 미출력. 형식 `YYYY.MM.DD`, 위치는 템플릿의 위치 객체. 흑백은 기존 Filter 경로.
- **오버레이 규약(오너 지시)**: 재단선·링 바인딩·타공 가이드 PNG는 템플릿/템플릿셋 제작 시 `extensionType:'overlay'` + `excludeFromExport:true`(TemplatePlugin 고정 요소, `plugins/TemplatePlugin.ts:22-43`) 또는 객체 플래그 `printExclude:true`(화면 표시·PDF 제외, `ServicePlugin.ts:858-881`)로 얹는다. `selectable=false`·`deleteable=false`·`alwaysTop`으로 고정하고 TemplatePlugin 어휘에 `ring-overlay`·`cut-guide` id 패턴을 추가해 `isUserAdded=false`로 재오픈 시 유지. PDF에서는 오버레이 아래 영역이 정상 데이터로 출력된다(마스킹 없음). **worker에 펀칭 영역 처리는 없다.**
- 저해상(`minDpi` 미달)은 기존 `ImageDpiWarningPlugin` 경고 + 매니페스트 `items[i].lowRes:true`. 완료 차단은 하지 않는다(호스트 판단).
- 규약 준수: 커스텀 서브클래스 없음, `extensionType` 어휘 추가(`calendar-grid`, `date-overlay`), 생성자 bind/`dispose()` off, `createCanvas` 생성 순서 주석 갱신, 복수 변경은 `offHistory/onHistory`, 그룹 해제(`GroupPlugin.unGroup` id 재발급) 시 grid는 `lockInfo`로 해제 차단. grid 내부 텍스트도 `ServicePlugin.collectGlyphValidationTargets` 대상임을 P1 테스트로 확인. `useCanvasLocalBackup.ts:41-44` 축소 목록은 standalone 전용이라 미변경.

---

## 6. 출력 · 시트/면 모델 · worker

### 6.1 편집기 산출(기본): N페이지 단일 PDF
`embed.tsx:2805-2834` 단일 분기의 `[canvas],[editor]` → `allCanvas.length > 1 ? (allCanvas, allEditors) : ([canvas],[editor])`. 1캔버스 세션은 호출 인자가 동일해 산출 불변(골든). `resolveSingleModePdfSizeMm`·`markOpt` 유지. 편집기는 뒷면을 회전하지 않는다.

### 6.2 API 분기와 서버 스위치
`edit-sessions.service.ts:1710-1773 applyPdfOutputMode`의 `pdfOutputMode !== 'duplex-split'` 분기 **앞**에:

```ts
const profile = session.metadata?.productProfile ?? resolveProductProfile(templateSet);
if (profile?.output.mode === 'sheet-map' && this.config.productProfileOutputEnabled) {
  const pageCount = resolveSessionPageCount(session);               // §10 P0(3)
  const sheets = buildSheetMap(profile, pageCount);                 // 순수 함수, API 단독 권위
  await this.workerJobsService.createSheetMapJob({ sessionId, pdfFileId: session.coverFileId, sheets,
    output: profile.output.sheetFiles ?? 'per-sheet',
    requestId: `sheet-map-${session.id}-${session.coverFileId}-r${revision}`, callbackUrl });
  return;
}
```

- 서버 스위치 `STORIGE_PRODUCT_PROFILE_ENABLED`(API 단일 환경변수 검증 모듈 경유; 기본 true). off → profile 분기·launch 라우트(503)·sheet-map 발행 중지, 편집기 산출 PDF 그대로. 롤백 순서: API 스위치 off → worker 이미지 이전 태그 → 마이그레이션은 nullable 컬럼이라 유지.
- **검증 잡 충돌**: complete 시 `createValidationJobs`(`:1534`)가 `pages: session.metadata?.pages || 1`로 발행한다. profile 세션은 `pages = resolveSessionPageCount(session)`, `pageMultiple = sheet.faces`, `bleed = templateSet.bleedMm`로 orderOptions를 구성해 `PAGE_COUNT_MISMATCH` 오탐을 막는다. NULL 셋은 현행 유지.
- `revision`: complete 횟수(세션 `metadata.revision` 증가). requestId에 포함해 재편집 후 재합성이 멱등 히트로 막히지 않게 한다.
- **검증 기대 쪽수 규칙(오너 분류 2026-10-17, "워커 규칙 확장" = (가))**: 현재 워커는 파일 슬롯으로 규칙을 고른다 — `coverFileId` → `fileType:'cover'` → **1·2·4쪽 고정**(`pdf-validator.service.ts:1022-1032`), `contentFileId` → `pageMultiple` 데이터주도(없으면 제본별 레거시 4의 배수). 낱장(단면·양면)이 통과하는 것은 1·2가 우연히 겹친 것이며 단면에 2쪽, 양면에 1·4쪽을 올려도 통과한다. 변경(2026-10-17 구현 완료, 미커밋): 검증 잡 `orderOptions`에 additive `productKind: 'sheet' | 'book'`, `pageStep`, `postProcessColorRule`을 싣고, 워커는 `productKind==='sheet'`이면 슬롯과 무관하게 **`actualPages === orderOptions.pages`**(세션 기록 쪽수 = 배열 canvasData 길이 → 호스트 `pages`; `resolveSessionPageCount`)를 검사한다(불일치 = `PAGE_COUNT_INVALID`, `autoFixable:false`; `pageStep>1`이면 배수 위반도 동일 코드). 서버 파생은 `apps/api/src/edit-sessions/sheet-validation-rules.ts`(single 세트 + spine/wing/spread 템플릿 없음 + 비책 + 비펼침면), 킬스위치 `EDITOR_SHEET_VALIDATION_RULES`(기본 on). `expectedFaces`는 P1 ProductProfile(`sheet.faces`)이 생기면 `pages`의 원천으로 쓴다. 책자는 기존 content 규칙(N-API-3b `deriveEditorContentPageRules` → `pageMultiple` = `templateSet.pageStep` 1/2/4, `edit-sessions.service.ts:2028-2049`) 그대로이며 "4의 배수"는 값이 없을 때의 폴백일 뿐이다. `productKind`가 없으면(레거시) 현행 byte-identical. 후가공 파일(`fileType:'post_process'`, 업로드 경로 `worker-job.dto.ts:27`)은 현행 "CMYK 사용 시 오류(별색만)"(`pdf-validator.service.ts:425, 2244`)를 **`postProcess.colorRule`(기본 `any`)로 완화**한다 — 선·라운드·면적·투명 객체가 정상 입력이기 때문. 결합 3쪽 PDF(앞·뒤·후가공면)는 업로드 검증에서 `expectedFaces + postProcess.pages`로 검사하고 마지막 쪽에 후가공 규칙을 적용한다.

### 6.3 `buildSheetMap(profile, pageCount)` (apps/api, 순수 함수·단위 테스트)
- `canvas-per-sheet`: `sheets[i] = {front:{page:i}, back:null}`.
- `canvas-pair` + `same-sheet`: `sheets[m] = {front:{page:2m}, back:{page:2m+1, rotate: backRotation}}`; `protectedIndices` 표지는 `{front:{page:0}, back:null}`로 선행. **오너 문구(앞=상단, 뒤=하단)의 기본값.**
- `canvas-pair` + `offset-next`(상단 링 넘김형 대안): `sheets[0]={front:cover, back:{page:상단_1, rotate}}`, `sheets[k]={front:하단_k, back:{page:상단_{k+1}, rotate}}`, 마지막 `back:null`.
- 결합 검증: `binding:'top-ring'`은 두 pairing 모두 허용, `'center-punch'`(접지형, 시트 높이 2H)는 `same-sheet`만 허용. 어느 값이 실제 제작과 맞는지는 §13-1 샘플로 확정. 두 규칙 모두 골든 고정.
- 결과 검증: page 인덱스 범위·중복, 총 페이지 = `pageCount`. 편집기가 보낸 값은 쓰지 않는다(`PATCH :id` metadata는 얕은 병합·클라이언트 자유형 `:835-837`).
- 후가공면 제외: 업로드 결합 PDF에 `postProcess.pages`가 포함된 경우 마지막 `postProcess.pages`쪽은 앞/뒤 짝에서 제외하고 `role:'post-process'` 산출로 분리한다(편집기 세션에는 후가공면이 없다).

### 6.4 worker mode `sheet-map`(1개 추가)

```ts
// packages/types/src/index.ts — DuplexSplitSynthesisJobData(:1163-1170) 옆 additive
export interface SheetFaceRef { page: number; rotate?: 0 | 180 }
export interface SheetSpec { index: number; front: SheetFaceRef; back: SheetFaceRef | null;
  sizeMm?: { width: number; height: number }; copies?: number; label?: string }
export interface SheetMapSynthesisJobData {
  jobId: string; mode: 'sheet-map'; sessionId: string; pdfFileId: string;
  totalExpectedPages: number; sheets: SheetSpec[];
  output: 'per-sheet' | 'merged-duplex';
  duplexFlip: 'short-edge' | 'long-edge';   // 결과 매니페스트 echo 전용
  callbackUrl?: string;
}
```

- `synthesis.processor.ts:181-197` 분기에 `if (mode === 'sheet-map') return this.handleSheetMapSynthesis(job)` 1줄. 핸들러는 `handleDuplexSplitSynthesis`(`:1582-1789`)의 다운로드·페이지 수 검증·멱등 가드(`:158-171`)·`settleFailedAttempt`(`:1771-1782`) 패턴을 복제하되 **회전은 신규 구현**이다(합성 경로에 `rotate|setRotation|degrees(` 0건). LIGHTWEIGHT ON = qpdf `--rotate=+180:N`, OFF = pdf-lib `page.setRotation(degrees(180))`. 두 경로 동일 산출 spec을 sheet-map 전용으로 둔다.
- OutputFile은 기존 값 재사용: per-sheet → `type:'set', setIndex`(2p 또는 1p), merged → `type:'pages'`. `index.ts:1192-1197` 주석에 sheet-map 용례만 추가. admin `WorkerJobList.tsx:68-72` 라벨 "세트 N" 무변경.
- `duplex-split`은 무접촉(입력 결함만 §10 P0(3)). 흡수·폐지는 운영 사용 실측 후 후속.
- **N-up·미러·마커(card-imposition 스킬)**: 명함재단기 조판(센서 마커 좌표 = 관리자 설정 주입, 뒷면 열 좌우 미러 `Total_Columns − col + 1`, 왼쪽 에지 기준, 마커 K100)은 **sheet-map 범위 밖**이며 기본 RIP 책임이다. 다만 매니페스트가 항목별 `sizeMm/copies/sheetIndex/duplexFlip/rotate 의도`를 기계 판독 가능하게 내보내므로, 후속으로 `sheet-map`에 `nUp{cols, rows, mirrorBack, marker}` 옵션을 additive로 붙이면 ③ 카드형·명함이 같은 엔진을 쓴다(P3 후보, 설정 하드코딩 금지).
- 래스터(P3): `output.raster` 선언 시 sheet-map 핸들러 옵션 `rasterize`로 면별 JPEG(`type:'set'`, 확장자 jpg). `POST /worker-jobs/render-pages`는 "표시 전용 — 최종 인쇄엔 미반영"(`worker-jobs.controller.ts:616-619`)이라 제작용으로 쓰지 않는다(운영자 미리보기에는 적합).

### 6.5 매니페스트 규칙
`pageCount`(면 수)·`items[].copies`·`sheets[]`는 **서버 deliverables가 정본**이다. postMessage `items`는 표시용이며 호스트 가격·제작 수량은 deliverables로 확정한다. N-up·갱 임포지션은 RIP 책임이고 매니페스트는 항목별 사이즈·매수·시트 ID·뒤집기 방향을 담는다.

---

## 7. 데이터 · API · admin

| 대상 | 변경 | additive / migration |
|---|---|---|
| DB `template_sets.product_profile` | json NULL, `20261017_add_template_set_product_profile.sql` | additive / migration |
| `packages/types` | `ProductProfile`·`resolveProductProfile`·`validateProductProfile`, `SheetSpec`·`SheetMapSynthesisJobData`, `EditorMenuKey` 2종, `TemplateSet.productProfile?` | additive |
| `apps/api/templates` | entity·DTO(`@ValidateNested`)·매핑 3곳(`:125, :422, :980`)·`GET /template-sets/:id/with-templates`(@Public, `template-sets.controller.ts:92-93`) 응답 키 `productProfile`(기존 키 불변) | additive |
| `apps/api/edit-sessions` | `resolveSessionPageCount(session)`(number \| array \| `Array.isArray(canvasData) ? length : 1`), complete 시 `metadata.revision++`, profile 검증 orderOptions, `applyPdfOutputMode` 분기 | additive |
| `apps/api/worker-jobs` | `createSheetMapJob`(`createDuplexSplitJob :2754` 복제), `buildSheetMap` | additive |
| `apps/api/partner`(신규 컨트롤러) | `POST /api/partner/launch`, `GET /api/partner/sessions/:id/deliverables`, `POST /api/partner/sessions/:id/synthesize` — 모두 `ApiKeyGuard`(사이트 editor 키), `contract-freeze.spec.ts` 등재 | additive |
| `apps/api` 환경 | `STORIGE_PRODUCT_PROFILE_ENABLED` | additive |
| `edit_sessions.metadata`(자유형) | `productProfile`, `calendar`, `items`, `revision`, `production{status,note,updatedBy,updatedAt}`, `externalPhotos`(기존 키) | additive |
| `apps/worker` | `sheet-map` 핸들러 | additive(FREEZE §1-B 배포 통지) |
| `apps/admin` | `TemplateSetForm` productProfile 섹션(P1: 스키마 검증 JSON 에디터, P2: 폼), `EditSessions/EditSessionList.tsx` 컬럼·드로어·다운로드 kind, `/admin/edit-data/sessions/:id/files/:kind`에 `sheet:<n>`·`zip` | additive |
| `packages/sdk` | `./server` 서브패스, `./embed` `launchEditor`/`onOutcome` | additive(private 유지) |

---

## 8. 외부 연동

### 8.1 런처(파트너 서버 2회)

```ts
POST /api/partner/launch   (X-API-Key: 사이트 editor 키)
body: { member: { seqno: number /* ≥1 */, id: string, name: string }, orderSeqno?: number,
        templateSetId: string,
        orderOptions?: { pageCount?, pageCountMin?, pageCountMax?, pageStep?, quantity?, title?, productName?, width?, height? },
        items?: PhotoItemInput[], calendar?: { startYm: 'YYYY-MM' }, externalPhotos?: ExternalPhoto[], callbackUrl?: string }
→ { sessionId, accessToken, refreshToken, expiresIn, embed: { sessionId, token, refreshToken, orderSeqno? } }

GET /api/partner/sessions/:id/deliverables   (X-API-Key, 사이트 대조 실패 404)
→ { sessionId, orderSeqno, revision, status: 'editing'|'complete'|'synthesizing'|'ready'|'failed',
    product: { kind, editorType, canvasCount, sheetCount, faces, duplexFlip, backRotation },
    items?: PhotoItem[], sheets?: SheetSpec[], calendar?: { startYm, dataVersion },
    files: Array<{ role: 'single'|'cover'|'content'|'sheet'|'face'|'thumbnail'; fileId?: string; jobId?: string;
                   url: string /* 서명 300s */; pageCount?: number; sheetIndex?: number; copies?: number; generatedAt: string }>,
    production?: { status, note, updatedAt } }

POST /api/partner/sessions/:id/synthesize   → { jobId }   // §6.2 분기 재실행(재제작, revision 증가)
```

- launch 내부: 템플릿셋 사이트 스코프 확인(hybrid NULL 허용) → 서비스 내부 메서드로 세션 선생성(siteId = API 키 사이트, memberSeqno = body) → `metadata{orderOptions, productProfile, items, calendar, externalPhotos}` 기록 → `/auth/shop-session`과 같은 토큰 발급 로직 호출. 컨트롤러 `POST /edit-sessions`(v1.8 토큰 회원번호 규약)는 거치지 않는다.
- `member.seqno ≥ 1` 필수. 게스트 세션은 PDF 생성·complete가 불가(`embed.tsx:2594`)하므로 회원 체계가 없는 서비스는 자기 주문 식별자에서 정수를 파생한다(bookmoa `deriveMemberSeqno` UUID 해시 선례).
- 호스트는 FROZEN 파라미터 `sessionId + token + refreshToken + parentOrigin`으로 `/embed` 진입. **신규 URL 파라미터 0개.** 기존 `shop-session → templateSetId` 흐름도 그대로 유효(bookmoa 무변경).
- deliverables 내부 = `files/:id/download/external` + `worker-jobs/external/:id/output-url` 조합. 웹훅은 기존 `synthesis.completed`(`packages/sdk/src/webhook/events.ts:26-35`) 재사용(payload에 `revision` 키 additive), 미설정 파트너는 폴링.
- 호출 수: 낱장·캘린더·사진인화 **2회**(launch, deliverables); 책은 현행 3~4회(compose-mixed 경로 무변경 — 스프레드 complete 시 자동 합성은 `:1533-1538` 정책 변경이라 채택하지 않음).

### 8.2 SDK (`packages/sdk`, private 유지 D-10b)

```ts
// @storige/sdk/server (Node 전용, 신규 서브패스)
createStorigeServer(cfg: { apiBase: string; apiKey: string }): {
  launch(input: LaunchInput): Promise<LaunchTicket>;
  deliverables(sessionId: string): Promise<Deliverables>;
  waitForDeliverables(sessionId: string, opts?: { pollMs?: number; timeoutMs?: number }): Promise<Deliverables>;
  synthesize(sessionId: string): Promise<{ jobId: string }>;
  mintOperatorSession(sessionId: string): Promise<{ token: string }>;   // POST /auth/partner-operator-session
};
// @storige/sdk/embed (additive; buildEmbedUrl/mountEditor 시그니처 불변 — url.ts:149, mount.ts:149)
launchEditor(opts: { editorOrigin: string; parentOrigin: string; container: HTMLElement | string;
  ticket: LaunchTicket['embed'];
  on: { onOutcome(o: { kind: 'completed'|'guest'|'cancelled'|'fatal'; sessionId?: string;
                       complete?: EditorCompletePayload; error?: EditorErrorPayload }): void } }): EditorHandle;
```

### 8.3 서비스별 적용

| 서비스 | 현황(정찰) | 적용안 | 선행 결정 |
|---|---|---|---|
| **bookmoa-mobile / printy**(라이브) | iframe `/embed` + postMessage 엔벨로프 + compose-mixed. 어댑터 7파일(`StorigeEditorHost.jsx`, `Orders.jsx`, `Admin.jsx`, `api/storige/{synthesize,webhook,router,shop-session}.js`)이 **연동 레퍼런스 구현**. 상품 = `templateSetId` 매핑(방향·제본 변형 포함). 재편집 감지 `editVersion/lastEditedAt/lastEditedBy`, 상태 `edited→synthesizing→validated→completed(+fixable/failed)`. | 변경 0. 신상품은 `app_config p4-cprods`에 templateSetId만 추가. `Admin.jsx listStorigeOutputs`가 `set_i` N건을 펼치는지 P2 실측. | 없음 |
| **100p books** | 자체 Fabric 7 편집기 + 자체 PDF 렌더 + Storige **유형 1**(업로드/검증/다운로드, `docs/STORIGE-NOTICE.md:40-43` "embed 도입 계획 없음" 통지). 운영 콘솔(주문·검증 게이트·rebuild-pdf) 완비. | 유형 1 유지. 업로드 DTO `orderSeqno`는 number(`files/dto/upload-file.dto.ts:29-31`)라 100p UUID는 담을 수 없음 — 주문↔fileId 매핑은 100p DB 그대로. | §13-8 |
| **JumboCard (PrintCard Studio)** | Next 15 + Fabric 6 자체 편집기, 자체 CMYK PDF(sharp ICC), 자체 콘솔. Storige 스텁(`StorigeEditorHost.tsx` `/edit` + 3이벤트, env 미주입, 사이트 미등록). `docs/ADRs/0002-storige-integration-path.md`(Proposed) = 임베드 폐기. | ADR 유지 시 유형 1. 번복 시 `templates.editor_kind:'storige'|'native'` + `storige_template_set_id`, `/products/[slug]/page.tsx:226-242` CTA 분기, `api/storige/shop-session/route.ts` 대신 launch 프록시, `StorigeEditorHost.tsx`를 `launchEditor`로 교체, `orders.snapshot_json={source:'storige', sessionId, revision}`, `/api/admin/orders/[id]/print-pdf`가 deliverables `sheet` 파일을 `print-files/`로 복사. 색관리는 자체 sharp CMYK 유지(Storige는 RGB PDF까지). 인쇄 ③ 카드형(`photo_digital_sheet`)이 직접 대응. | §13-8 |
| **insta_print (instax_upload)** | Next 16 경량 MVP(파일시스템 저장, DB 없음). 자체 편집기(이동/확대/흑백), 제작 요구 = **원본 해상도 크롭 JPG q100 4:4:4 리사이즈 금지**, admin ZIP + `인화목록.txt`(BOM/CRLF) + "사진앱에 저장". PRD F-04 "Storige 재사용 전면 제외". | PRD 유지 시 비연동. 번복 시 `OrderApp.tsx` 2단계를 `launchEditor`(templateSetId = 인스탁스 미니 46×62, `photo_chem`, fit `paper-full` 고정, grayscale·copies)로 교체, `POST /api/orders/[id]/submit`이 deliverables `face` JPEG(P3)를 `order.json.photos[]`에 매핑 → admin ZIP·인화목록·사진앱 저장 무변경. **P3(면별 JPEG) 전에는 PDF만 가능하므로 연동 시점은 P3 이후.** | §13-7, §13-8 |
| **FrameShop** (`/Users/yohan/Developer/frameshop`) | Next 16 + Supabase + Toss + sharp + Konva 자체 편집기. 상품 = `products(bleed_mm, product_type single\|extended)` → `frame_assets(inner_rect 0..1)` → `product_variants(sizeCode/widthMm/heightMm/colorCode/matteCode/paperCode/price)`. 흐름: 업로드(2400px 캡) → Konva 베이크 크롭(inner_rect+bleed) → 결제 후 `print_render_jobs` → sharp 300dpi PNG → `previews` 버킷 → `order_items.print_file_url`(7일 signed). admin `/admin/orders/[id]`: 인쇄파일 링크·ZIP·제작 시작·출하·취소/환불. Storige 연동 흔적 없음. Toss 키 미입력(실주문 0). | **사진 1장 낱장 + 사이즈 mm + bleed = 사진인화 `image-full/paper-full`과 직접 대응.** 어댑터: `StartEditorButton` → `launchEditor`(variant별 templateSetId; 캔버스 = `inner_rect×variant mm + bleed`) → deliverables `single` PDF 또는 P3 `face` JPEG를 `photos` 버킷에 service-role 삽입 → `addToCart({photoUrl, cropTransform: identity})` 이후 결제·렌더·admin 무변경. 원본 보존이면 2400px 캡 품질 문제도 해소. 걸림돌: 베이크 크롭 픽셀 비율 = `(inner_rect.w·Wmm+2·bleed):(inner_rect.h·Hmm+2·bleed)` 정확 일치, 익명 `fs-guest-sid` ↔ `member.seqno` 파생, `/api/photos/upload` same-origin 제한(서버 간 삽입 경로 별도). | §13-8 |

### 8.4 멀티테넌트
세션·파일·잡 격리는 기존 규칙(`files.service.ts:336-343` NULL 파일 전체 허용 **유지**). 템플릿셋 productProfile은 hybrid `site_id` 그대로. 브랜딩 컬럼·사이트별 메뉴 기본값은 범위 밖(P3 후보).

---

## 9. 운영자 주문 워크스페이스

### 9.1 콘솔 1개, 역할 2개(Storige `apps/admin`)
- 서버 `staff-edit-data.controller.ts:40-44`는 이미 `@Roles(ADMIN, MANAGER, SITE_ADMIN, SITE_MANAGER)`, 서비스는 `actorCanSeeSite`로 사이트 대조(`staff-edit-data.service.ts:293`), 화면 `EditSessionList.tsx:129`는 `isGlobalAdmin` 분기. 라우트(`:48-141`): sessions, jobs, files/:kind, editor-session, grants, complete, delete/restore, synthesize, retention-report, audit. 즉 "확인·수정(편집 열기 `:183`)·다운로드(`:232`)·제작 요청(`:243`)"이 이미 있다.
- 확장(additive): ① 목록 컬럼 `product.kind/editorType`, 캔버스/시트 수, 산출 상태, `production.status`. ② 상세 드로어: items 표(순번·사이즈·매수·옵션·lowRes 경고), sheets 표(앞/뒤/회전/flip), 캘린더 시작연월·기념일 수·dataVersion, 페이지 미리보기(기존 `render-pages` 표시 전용 래스터 재사용). ③ `files/:kind`에 `sheet:<n>`, `zip`(산출물 + `manifest.json` + `인화목록.txt` BOM/CRLF — insta_print 포맷 호환). ④ 「재합성」= `applyPdfOutputMode` 분기 재실행(revision 증가). ⑤ 「제작 메모」= `metadata.production`. ⑥ 썸네일은 `files.thumbnailUrl`(첫 페이지, `embed.tsx:2924`) 의미 불변.
- 파트너 운영자 계정은 `SITE_ADMIN/SITE_MANAGER`(기존 Operators/MySite). 발급 여부는 §13-5.

### 9.2 파트너 자체 콘솔 경로(bookmoa 동형)

| 동작 | 경로 |
|---|---|
| 확인 | `deliverables(sessionId)` 또는 `GET /edit-sessions/external?orderSeqno=`(FROZEN) |
| 수정 | `mintOperatorSession` → `launchEditor({ticket:{sessionId, token}})`(`auth.controller.ts:389` ApiKeyGuard, `CONTRACT_FREEZE.md:174`) |
| 다운로드 | deliverables `files[].url` |
| 제작(재합성) | `POST /api/partner/sessions/:id/synthesize` |

식별 키는 `orderSeqno`(`shop-session.dto.ts:33-36`, `edit_sessions.order_seqno`)로 통일. 결제 후 편집 잠금은 호스트 책임(bookmoa R-216·100p PROJECT_LOCKED·jumbocard 스냅샷 잠금 모두 호스트 측)이며 Storige는 `revision`으로 stale 산출물을 식별하게만 한다.

---

## 10. 선행 결함 수정(P0)

1. `embed.tsx:2805-2834` — 비스프레드 완료 시 `[canvas],[editor]` 1장만 PDF화. §6.1로 수정.
2. `embed.tsx:2352, 2417` — IIFE `save/complete`가 `canvas?.toJSON(core.extendFabricOption)` 단일 캔버스로 canvasData를 덮어씀(handleFinish `:2591-2593`은 `allCanvas.length > 1`일 때만 배열). 같은 조건식의 수집기로 통일 → 1캔버스 결과 불변. 완료 조건에 파트너 저장소 `StorigeEditor.create` 사용 실측 근거 기록.
3. `worker-jobs.service.ts:2808-2824` — `metadata.pages`(편집기는 숫자 `embed.tsx:1296-1299`; 서비스 다른 곳도 number `edit-sessions.service.ts:550-554`)에 `.length` 적용 → 항상 `ODD_PAGE_COUNT`/`EMPTY_SESSION_PAGES`, `applyPdfOutputMode`가 삼킴(`:1766-1771`). **즉 `duplex-split`은 편집기 세션에서 한 번도 성립한 적이 없는 경로다.** `resolveSessionPageCount` 헬퍼로 교체하고 spec에 3형태 고정. 적용 범위는 신규 sheet-map과 기존 duplex-split 둘 다(실패→성공 방향, §1-B v1.11 행 통지 동반, §13-9).
4. `useEditorContents.ts:1203-1211` — 호스트 한도 없으면 템플릿셋 `pageCountRange` 미반영(암묵 99). 결함 자체는 후속 항목으로 두고 profile 분기로만 정책 적용(기존 셋 무변경).
5. 임베드 저장 경로 훅 우회(§2.4) — 코드 변경 없이 플러그인 설계 제약으로 흡수. `saveJSON` 경유 통일은 하지 않는다(`Promise<string>`·overlay 토글이 getState/테스트에 영향).
6. `ServicePlugin.ts:769` — 문서 단위 orientation·size 1개. P1/P2는 1세션 1사이즈로 범위 고정.

---

## 11. 단계 로드맵

| 단계 | 범위 | 완료 기준 | 위험 |
|---|---|---|---|
| **P0 — 완료·배포(2026-10-17, `19f1ce7c`)** | §10 (1)(2)(3) + "1캔버스 세션 바이트 동일" 테스트 + IIFE 사용 실측(파트너 6저장소 0건) + (가) 낱장 분류 검증(§6.2) | 골든 하네스(book/leaflet/photobook/낱장 1장) 바이트 동일; 3캔버스 single 완료 시 3p PDF; IIFE 3캔버스 save 후 재오픈 3장; duplex-split 편집기 세션 e2e 1건 성공; 기준선(api 138/3118, worker 34/1294, editor 107/1601, canvas-core 57/658, contract-freeze 94) 무회귀 | 낮음~중간. (3)은 동작 변경 → 통지. embed.tsx Shopify EDT-301 선반영 |
| **P1** | product_profile 컬럼·타입·DTO·admin JSON 섹션; `resolveProductProfile`+legacy 테스트; 페이지 정책·SidePanel 숨김·라벨; CalendarPlugin·calendar-core·데이터 v1·CALENDAR 메뉴; 캘린더 패널(시작연월·표기·기념일, 범위 밖 기념일 처리); 오버레이 규약(§5); 검증 orderOptions 수정; `STORIGE_PRODUCT_PROFILE_ENABLED`; `launch`/`deliverables`(single-pdf만)·SDK server/launchEditor; `editor.complete` `product` 키; with-templates `productProfile` 키; EditSessionList 컬럼. **상품: 탁상·벽걸이(가).** worker 무접촉 | NULL 셋 스냅샷 테스트 전부 통과; 13캔버스 셋 생성→저장→재오픈 grid·기념일 유지; 시작연월 변경 시 사진·텍스트 보존·범위 밖 기념일 안내; 13p PDF + 검증 잡 경고 0 + 오버레이 미출력·하부 데이터 정상; launch→embed→complete→deliverables 2회로 회수(e2e); 13캔버스 PDF 생성 시간 실측; calendar-core 단위 테스트(윤년·6주·대체공휴일·음력); contract-freeze.spec 등재 | 중간. `extendFabricOption` 누락 침묵 유실(등재 검사로 방어), 글리프 검증, 날짜 데이터 정확성 |
| **P2** | worker `sheet-map`(회전 2경로 신규 구현)·`createSheetMapJob`·`buildSheetMap`·`applyPdfOutputMode` 분기·`synthesize` 라우트; canvas-pair 정책(2장 단위·앞/뒤 라벨·② 뒷면 잠금 시드); PhotoPrintPlugin(fitMode/frameInsetMm/date-overlay/grayscale)·PHOTO_PRINT 메뉴·항목 패널·`metadata.items`·`upload` 한도; `editor.complete` `items` 키; EditSessionList 드로어·sheet/zip 다운로드·production 메모; admin profile 폼. **상품: 벽걸이(나)(다), 인쇄 ①②③, 인화(chemical, PDF).** | (나) 13시트 same-sheet/offset-next × rotate 0/180 골든, LIGHTWEIGHT ON/OFF 동일; 기존 5 mode 골든 불변; ①②③ 각각 set_i N건 admin 노출·deliverables 회수; fitMode/inset 왕복 직렬화 테스트; 25캔버스 PDF 생성 실측; bookmoa 샘플 상품 1건 e2e; retention-report가 set 파일을 집계 | 높음. 회전 포함은 §13-2; frame clipPath 규약 변경은 FrameInteraction·autofill·requiredEdit 동시 영향; worker 배포 FREEZE §1-B 통지 |
| **P3** | 면별 JPEG(`rasterize`, 사이즈별 픽셀·sRGB·블리드 없음); 1세션 사이즈 혼합(ServicePlugin 페이지별 size); `sheet-map` N-up·미러·마커 옵션(card-imposition 규칙); `TemplateSetType` 라벨(§0 판정 후); worker `spiral`(GS/pdf-lib 분기 통일 선행); jumbocard/insta_print/FrameShop 어댑터(정책 결정 후); 메뉴·브랜딩 사이트 기본값 | 항목별 오너 결정 기록 후 골든·계약 테스트 | 항목별 상이 |

---

## 12. 계약 · Shopify 조율

- **FROZEN 불침범**: `/embed` 파라미터 12종(신규 0), 엔벨로프 v1, `editor.complete` `files`·`pages` 중첩(`CONTRACT_FREEZE.md:165-167`), compose-mixed 기본 동작(`:194`), shop-session 응답(`:189`), `PdfOutputMode`·`TemplateSetType`·`EditorMode`·`SessionMode`·`OutputFile.type`·`editor.error code` 값 집합 무변경.
- **ADDITIVE 등재**(동일 커밋 `contract-freeze.spec.ts`·`protocol.ts`·`embed-protocol.spec`·가이드 갱신; 가이드 4건이 dirty 상태라 커밋은 명시 경로만): `with-templates` 응답 키 `productProfile`(@Public FROZEN 라우트 `:198`, 기존 키 불변); `editor.complete`·레거시 `storige:completed` 키 `product`·`items`(`templateSetId`/`spineWidthMm` 선례 `protocol.ts:284-291`); `POST /api/partner/launch`, `GET /api/partner/sessions/:id/deliverables`, `POST /api/partner/sessions/:id/synthesize`; worker `mode:'sheet-map'`(§1-B 배포 통지, 기존 mode 골든 불변 증명 동반); 웹훅 `synthesis.completed` payload 키 `revision`.
- **MODIFY-TARGET 후보(오너 승인·통지)**: P0(3) duplex-split 페이지 수 원천(실패→성공); 뒷면 회전 적용(`backRotation:180` 선언 상품 한정, §13-2); 낱장 검증 규칙을 슬롯(cover 1·2·4)에서 상품 분류(`expectedFaces`)로 전환(§6.2 — 종전 통과하던 잘못된 쪽수가 오류가 됨); 후가공 파일 색 규칙 완화(`post_process` CMYK 오류 → `colorRule` 기본 `any`, 업로드형 파트너 검증 결과 변화).
- **Shopify**: file role은 기존 `set`/`pages`를 쓰므로 PDF-309 역할 adapter에 신규 역할 없음. deliverables `files[].role` 어휘(`sheet`,`face`)는 Storige 파트너 API 표면이며 Shopify artifact manifest와 별개 — W0 CTR-005 전에 `ProductProfile.kind`를 binding revision `allowed_input_modes`에 올릴 수 있도록 타입만 공유. `embed.tsx` P0/P1 변경은 EDT-301 전 선반영·통지, `packages/types` 변경도 동일.

---

## 13. 오너 결정 필요 항목

> [상태] 2026-10-17 기준: 9 → **결정됨**(duplex-split 수정은 기존 경로에도 적용·배포). 10 → P1에서 탁상+벽걸이(가) 동시 진행 권고(미확정). 4 → **P1 착수 전 필요**. 1·2·3 → P2 착수 전. 5·6·7·8·11·12 → P2/P3. 추가 결정 항목 13: 낱장 cover 슬롯의 판형·도련 검증 공백(책등 게이트 우회 여부, P0 노트 참조).

1. **벽걸이 (나)(다) 시트 짝 규칙 샘플 확정**: 답변 문구 그대로 `same-sheet`(앞=상단, 뒤=하단)를 기본값으로 구현한다. 상단 링 넘김형 물리 구조에서 `offset-next`(시트 k 앞=하단_k, 뒤=상단_{k+1})가 필요한 상품이 있는지, 타공 위치(`top-ring` vs `center-punch` 접지)와 함께 제작 샘플로 확정해 주십시오. 코드는 두 규칙 모두 데이터 선택.
2. **뒷면 180° 회전을 Storige 산출에 포함할지**: 기본 `backRotation:0`('RIP 책임' 유지) + 매니페스트 `duplexFlip:'short-edge'` 지시로 출시. 인쇄팀이 PDF 내 회전을 요구하면 profile 값만 180(MODIFY-TARGET 통지).
3. **옵션 어휘 매핑 확인**: 페이퍼풀=용지 가득(cover, 잘림)·이미지풀=사진 전체(contain, 여백), 유테=사진틀 창 축소(`frameInsetMm`, 용지 여백 아님) — 이 매핑으로 구현. 다르면 매핑만 교체.
4. **탁상 캘린더 물리 사양**: 삼각 스탠드/상단 링, 뒷면 사용 여부, 받침 페이지 유무. 현재 "월1면 단면 13장"으로 가정.
5. **파트너 운영자를 Storige admin 사이트 스코프 계정으로 들일지**(계정 발급·역할 관리가 Storige 운영으로 이동) — 설계는 §9.1·§9.2 두 경로 모두 지원.
6. **1세션 사이즈 혼합(인쇄 ①) 지원 시점**: P1/P2는 1세션 1사이즈 + 같은 orderSeqno 다세션. P3 ServicePlugin 페이지별 size 확장 여부.
7. **인화(chemical) 면별 JPEG 출력(P3) 필요 여부와 사양**: 미니랩 사이즈별 픽셀 치수·sRGB·리사이즈 금지 — insta_print·FrameShop 제작 요구와 직결.
8. **외부 서비스 정책**: JumboCard ADR-0002(임베드 폐기), insta_print PRD F-04(Storige 제외), 100p "도입 계획 없음" 통지, FrameShop(연동 계획 없음) — 유지 시 네 서비스는 범위 밖이며 bookmoa/printy + 신규 상품이 1차 소비자. 전환할 서비스가 있으면 순서를 정해 주십시오.
9. **P0(3) duplex-split 수정의 통지 범위**: 기존 duplex-split에도 적용(권고) vs 신규 sheet-map만.
10. **첫 출시 상품**: 탁상 + 벽걸이(가) 동시(P1 권고) vs 탁상 단독.
11. **SDK 배포(D-10b) 재개 여부**: 미배포면 외부 서비스는 라우트 문서·저장소 빌드 의존.
12. **참조 편집기 라이선스 경계**(1차 문서에서 이월): 점보포토·ILARK 계약에 경쟁 제품 참조 제한 조항이 있는지. 이 문서는 기능 사상만 참조했다.

---

## 14. 위험 · 미확인

- 회귀: `useEditorContents.ts` 2371줄 핵심 경로에 분기 1곳, `embed.tsx` 3곳. NULL 셋 스냅샷 테스트와 골든 하네스가 유일한 방어.
- 직렬화: `fitMode`/`frameInsetMm`/`extension.takenAt` 미등재 시 침묵 유실(`canvas.ts:163,170` 주석). 등재 검사 테스트 필수. standalone `useCanvasLocalBackup.ts:41-44` 축소 목록은 admin 템플릿 편집(grid 배치) 복원에 영향 가능(inferred, 미검증).
- 브라우저 PDF 예산: 13/25캔버스 고해상 사진 세션의 jsPDF 메모리·watchdog은 실측 전 미확정.
- 보안(범위 밖 선행 권고): sites API 키는 평문 조회·동등비교(`auth/guards/api-key.guard.ts:33-35`)이며 신규 X-API-Key 라우트 3개가 추가된다 — 키 해싱·회전은 별도 과제. `compose-mixed` @Public에서 editSessionId가 자격증명인 문제도 미해결(launch/deliverables는 ApiKeyGuard).
- 보관·용량: per-sheet 파일(13~N건)·면별 JPEG는 기존 2파일 대비 파일 수 급증. `sites.edit_retention_days`·retention-report 집계는 P2 done에 포함했으나 R2 용량·서명 URL 재발급 부담은 미측정.
- 업로드: 사진인화 `upload{maxPhotos,maxMb}`는 편집기 업로드 패널 강제가 P2 과제. HEIC 처리는 편집기 측 변환 유무 미확인(insta_print README:31 선례).
- 날짜 데이터: 저장소에 음력·공휴일 데이터 0건. 1차 출처·환산표 정확성은 P1 단위 테스트에 의존. 임시공휴일은 데이터 릴리스 절차 필요.
- `with-templates` @Public에 productProfile(사이즈·옵션 어휘·backTemplateId) 노출 — 비밀 아님으로 판단해 노출 결정. `findOneWithTemplates`의 site 필터 유무 미확인.
- 벽걸이(나) `offset-next` 물리 모델·`center-punch` 접지 치수(2H)는 inferred — 샘플 확인 전 템플릿 제작 금지.
- bookmoa `Admin.jsx listStorigeOutputs`의 set_i N건 처리, `thumbnailUrl` 렌더 여부 미확인.
- 성능·운영 실측(duplex-split 실제 성공 이력, IIFE 사용 파트너)은 정적 분석만 수행.
- 참조 편집기 관찰 한계(1차 문서 §1.1·§6 이월): 연달력·고정날짜 달력 화면 미관찰, REA 모듈명 난독화로 기능↔모듈 대응 미확정.

---

## 부록 A. 설계안 경쟁·심사 요약

| 안 | 관점 | 심사 합계(3명) | 채택 요소 |
|---|---|---|---|
| A 최소 변경 | 기존 editorMode/템플릿셋/플러그인 유지 + JSON 설정 + worker mode 1개 | **133** | 골격 전체(`if (profile)` 가드, OutputFile 재사용, enum 무변경) |
| B 프로파일 재구조화 | ProductProfile 정본 + ProductModeStrategy로 분기 수렴 | 116 | `resolveProductProfile` 공유 함수·legacy 동치 테스트, 프로파일 전체 스냅샷, `revision`, `production` 메모, 래스터 슬롯 선언 |
| C 연동 역설계 | 1-call 런처 + preset + 운영 콘솔 우선 | 132 | `launch`/`deliverables` 2회 호출, 서버 단독 `buildSheetMap`, 콘솔 1개·역할 2개, 플러그인의 훅 비의존 제약 |

심사관 공통 지적으로 흡수한 항목: 검증 잡 페이지 수 충돌(§6.2), 브라우저 PDF 예산(§4), `pageCount` 의미 고정(§2.3), 서버 kill switch(§6.2), 날짜 데이터 거버넌스(§5), 다장 썸네일(§9.1), IIFE 사용 실측(§10), 타공 위치·양면 뒤집기 방향(§2.2 `binding/duplexFlip`), 페이퍼풀/이미지풀 의미(§13-3), 미니랩 래스터 사양(§13-7), 촬영날짜 원천 보존(§5), N-up은 RIP 책임(§6.4).

## 부록 B. 참조 편집기(ILARK wpod) 관찰 요약
1차 문서 §1 참조. 추가 관찰(사진인화 3010): 좌측 "인화 옵션 일괄 설정"(페이퍼풀/이미지풀, 무광/유광, 밝기 보정, 테두리, 촬영날짜, 인화 매수), 사이즈 18종(3x4~12x18, WIDE), 상품 config `page{min,max,per,base,inc,skincount}`·`binding{pagetype,type}`·`calendar{anniversary,startdate,calc_year_policy}`·`print{trim_direction,crop}`+size item(`size mm, min/max dpi, price, date overlay`), editorType 코드 체계(인화 3010/대형 3011/프리미엄 3012/팬시 3040/북 3050/캘린더 3060/카드 3110/명함 3180 …). 이 사상이 §2.2 `editorType` + 세부 규칙 블록으로 대응된다.
