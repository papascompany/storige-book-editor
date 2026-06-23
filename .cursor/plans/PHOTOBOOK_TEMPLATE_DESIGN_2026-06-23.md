# 포토북(Photobook) TemplateSetType 설계 (2026-06-23)

> **상태:** 최종 설계서(적대검증 반영본). 스킬 소스로 사용 가능.
> **검증 기준:** 종합서 + 적대검증(JSON) + 실제 코드 재대조(2026-06-23, 본 세션에서 file:line 직접 확인).
> **난이도 범례:** S(재사용/소폭, 1~3일) · M(설계+신규 모듈, 1~2주) · L(신규 서브시스템, 2주+)

---

## ✅ 스펙 대조 완료 (BLOCKER 해소 — 2026-06-23)

연구 워크플로 실행 시 스펙 원문이 일시적으로 누락돼 §2를 역추론했으나, **2026-06-23 본 세션에서 발주 스펙 14항목 원문과 1:1 대조 완료**. 역추론 매핑이 실제 스펙과 **정합**함을 확인했고, 아래 정밀화 사항만 반영한다.

**발주 스펙 원문(요지):** ①PHOTOBOOK 타입 ②표지=펼침면+싸바리(하드커버 보드 안쪽 접어 풀칠 영역) ③표지 편집영역=앞커버/책등(제목)/뒷커버 **각 영역별** 편집가능 범위 지정·그 안에서만 편집 ④내지=블리드 포함 좌/우 펼침면+면지 ⑤상품구성 시 기본페이지 전체 세팅=기본 편집페이지 ⑥편집영역+안전선 점선 표시(화면만)·침범 경고+침범 유효 유지(디폴트)·**침범불가 세팅 시 안전선 밖 가림+결과파일 크롭** ⑦기본페이지 이하 삭제불가·페이지 추가(기준페이지·페이지당 단가)·저장 후 장바구니로 총 페이지수 전달·추가분 가감 가격 표시 ⑧페이지 네비 썸네일 DnD 순서이동 ⑨자동편집=날짜순/파일명순/장소별(EXIF)/랜덤(페이지 사진수·가로세로 형태 따라 프레임 매칭) ⑩사진틀=테두리없는 PNG/액자/다각형 shape 라이브러리·페이지별 n개·DEL/Backspace 삭제경고+확인(모바일 터치)·삭제불가틀=선택불가 ⑪사진틀 내 사진=확대/축소/회전·DEL 삭제경고 ⑫모든 객체 레이어 기준 위/아래 ⑬다중선택 그룹 이동/복사/삭제·단일 객체 앞으로/뒤로 핸들 ⑭저장=모든 레이어 300dpi 펼침면 래스터로 평탄화+페이지별 72dpi jpg 썸네일·편집보관함 미리보기 링크+뷰어(bookmoa-mobile/파트너 동일).

**정밀화 1건(역추론에 약했던 부분):** 스펙 ③ — 표지의 **앞커버/책등/뒷커버를 개별 region 으로 나눠 각각 편집가능 영역(edit boundary)을 admin 이 지정**, 편집은 그 region 내부로만 클램프. §6 의 안전영역과 별개로 "per-region 편집경계"가 필요(아래 §6 보강 참조). 갭=M(SpreadLayoutEngine REGION 별 edit-bounds 메타 + 편집기 클램프).

**검증 불능 우려(BLOCKER 시절) 해소:** 자동편집 출력=편집가능 시드(스펙 ⑨ "자동편집 후 자유편집" 함의), 장소별=EXIF GPS 명시(스펙 ⑨), 가격=장바구니가 가감(스펙 ⑦ → 계산주체=파트너 장바구니, storige 는 메타+pageCount emit), 싸바리=스펙 ② 명시(MVP 우회 가능). → §2~§11 그대로 유효.

---

## 1. 개요/목적 — Photobook 타입이 BOOK·LEAFLET과 다른 점

현행 `TemplateSetType`은 `BOOK='book'` / `LEAFLET='leaflet'` 2종뿐이다
(`packages/types/src/index.ts:94-97`, 엔티티 enum은 `apps/api/src/templates/entities/template-set.entity.ts:21-24`).
둘 다 **"표지 + 내지 N장"** 모델이며, 내지는 펼침면이 아니라 **단면 1p 캔버스**다.
포토북은 다음 6축에서 구조적으로 다르다.

| 축 | BOOK/LEAFLET (현행) | PHOTOBOOK (신규) |
|---|---|---|
| **표지 구조** | 무선/중철 표지 스프레드(wing/cover/spine 영역). 하드커버=책등 폭 계산뿐 | **싸바리(하드커버 보드 wrap)** = 보드 두께·turn-in(시접)·풀칠영역 geometry. ⚠️ 단, **MVP는 기존 `coverEditable=false` 경로 재사용**(§3-2·§11 O-1) |
| **내지 단위** | 단면 1p 캔버스 | **펼침면(2-up facing)** — 좌/우 면 + 거터(gutter) + 파노라마 좌우분할 |
| **콘텐츠 주체** | 텍스트/도형 자유 디자인 | **사진틀(photo frame) 중심** — 1프레임=1사진, 마스킹 + 내부 크롭 |
| **편집 시작점** | 빈 캔버스 또는 템플릿 | **자동편집(autofill)** — 업로드→중복제거→EXIF정렬→레이아웃 자동매칭 "90% 완성본" |
| **페이지/가격** | `pageCountRange[]` 고정 메타, 가격 무관 | **가변 페이지 + 페이지수→단가 → 장바구니 실시간 가격** |
| **저장 산출물** | 벡터 PDF(이미지 3508px 상한), spread는 cover.pdf+content.pdf **separate 강제** | + **300dpi 펼침면 래스터(필요시)** + **페이지별 72dpi jpg 썸네일** + 다페이지 뷰어 |

**핵심 메시지:** 표지 스프레드(wing/spine)·사진틀 마스킹·레이어/그룹·페이지 DnD·**커버 잠금**은 **production-grade로 이미 존재**해 재사용한다. 진짜 신규는 ① 싸바리 geometry(MVP는 우회 가능) ② 펼침면 내지 ③ 자동편집 엔진+EXIF ④ 가격연동 emit ⑤ 페이지별 래스터/뷰어 — 5개 영역이다. **단, "재사용"은 곧 "공유 계층 위임"이다:** 레이어/그룹·페이지 DnD·커버 잠금·삭제경고·모바일·잠금/권한은 `TemplateSetType` 으로 게이팅되지 않는 **상품 비종속 공유 UX**이므로(코드 확인: 객체 컨트롤 레이어에서 `TemplateSetType` 참조 0건, 게이팅 축은 per-set `enabledMenus`/`editMode`/env/role 로 타입과 직교) 포토북에서 재정의·중복 구현하지 않는다. 공유 계층 개선이 필요하면 **전 상품(BOOK/LEAFLET) 회귀를 전제로** 별도 진행한다. 이하 §2·§5·§11 표의 공통 컨트롤 항목은 모두 이 원칙을 따른다.

---

## 2. 스펙 14항목 매핑표

> ⚠️ "스펙 항목"은 **역추론(추정)**. BLOCKER 참조. file:line은 2026-06-23 코드 직접 확인분.

| # | 스펙 항목(추정) | 기존 재사용 자산 (file:line) | 외부 참고(출처 편집기) | 갭/난이도 |
|---|---|---|---|---|
| 1 | **타입 등록 구조** (PHOTOBOOK enum) | `TemplateSetType` enum `packages/types/src/index.ts:94-97` / DB enum `template-set.entity.ts:21-24` / **`type` 컬럼은 varchar(20)** `template-set.entity.ts:42-47` / **`editorMode` 컬럼 실재** `template-set.entity.ts:83-84`(varchar, default 'single') | — (내부 결정) | **S** — enum 1개 추가 + 폼 분기. **마이그레이션 불필요**(type은 varchar 저장). ✅ editorMode 컬럼 존재 확인됨(아래 정정 참조) |
| 2 | **펼침면 표지 스프레드** | `SpreadLayoutEngine.ts`(`REGION_ORDER`/`computeSpreadDimensions`) / `SpreadPlugin.ts` / `SpreadConfig`·`SpreadSpec` `index.ts:1443-1523` / 검증 `templates.service.ts`(validateAndNormalizeSpreadConfig) | Shutterfly Cover Spread(뒤+책등+앞 한장) | **S** — 그대로 재사용 |
| 3 | **싸바리(하드커버 보드 wrap)** | ⚠️ geometry 전무(`SpreadSpec`에 board/turn-in 없음 `index.ts:1443-1452`). **그러나 MVP 우회로 존재**: `coverEditable=false`(`template-set.entity.ts:121-122`) + `coverPreviewImage`(`:128-129`) = 표지 비편집·미리보기+빈 PDF 인쇄 경로 | 양장 시접 15mm+, 보드 wrap (snaps/foxcg) | **MVP=S(기존 경로 재사용)** / **정밀 geometry=L**. O-1 결정 의존 |
| 4 | **펼침면 내지** (facing 2-up + 거터) | ⚠️ 내지=단면 1p(`SpreadPagePanel.tsx` docstring). spread bindingType은 **표지** 펼침면일 뿐 본문 2-up 미구현. 좌표=중앙원점@150dpi 규약 | Mixbook facing pages, 레이플랫 파노라마 | **L** — 내지 2p 모델 + 거터 안전영역 + 파노라마 좌우분할 |
| 5 | **면지(endpaper)** | ✅ `EndpaperConfig` `index.ts:172-181` + 엔티티 `endpaperConfig` `template-set.entity.ts:109-115` | 간지/면지 별도면 | **S** — 재사용 |
| 6 | **페이지 수 가변·자동확장** | ✅ `pageCountRange[]`·`canAddPage`(`template-set.entity.ts:64-71`) / `calculateSpineWidth` `index.ts:1086` + **`BINDING_CONSTRAINTS` minPages/maxPages/pageMultiple 경고 인프라 실재** `index.ts:1048-1109` | 짝수/펼침면 단위 증감, 최소페이지 가드(스냅스 21p) | **S→M** — 가변 존재 + **경고 인프라 일부 재사용**. 펼침면 단위 stepper만 신규 |
| 7 | **블리드/재단/안전영역** | ⚠️ 2갈래 분리: 엔티티 **per-edge 의도** `bleedMm`/`cropMarkEnabled`/`sizeToleranceMm`(`template-set.entity.ts:163-177`, P1=저장만·워커적용 P4) vs **SpreadSpec은 단일 스칼라** `cutSizeMm`/`safeSizeMm`(`index.ts:1449-1450`) | bleed(빨강)/trim(검정)/safety(점선) 3겹 (Canva·미리캔버스) | **M** — safe area 일원화 UI + 워커 bleed 실적용(P4) |
| 8 | **레이어 z-order + 패널** | ✅ `ObjectPlugin` upTop/downTop/moveTo + 핫키 / `SidePanel.tsx`(목록·lock·visible·rename). drag-handle은 onClick/onDoubleClick만 배선·**onDragStart 부재**(`SidePanel.tsx:279-281`) | Canva Position(Layers), 미리캔버스 4버튼 | **공유 계층 작업** — 레이어 패널 DnD·툴바 z-order 버튼은 [[fabric-editor]] 공유 컴포넌트 개선(전 상품 적용). z-order 는 모든 상품 공용=포토북 고유 추가 없음. 포토북 갭=S(연결만), 실작업=공유 PR·전 상품 회귀 검증 |
| 9 | **사진 자동편집/자동배치** | ❌ 엔진 전무. 입력측만: `useExternalPhotosStore.ts`(사진목록+사용추적), 배치API `canvas.ts` | Mixbook Auto-Create, aspect-ratio 매칭, 스프레드 단위 최적화 | **L** — worker 자동배치 잡(편집가능 시드) |
| 10 | **EXIF 촬영일시/GPS** | ❌ orientation 보정만(`storage.service.ts:217` sharp `.rotate()`). **exifr 의존성 없음(확인)** | Date Taken/Added/File Name 3택 + asc/desc (Mixbook/스냅스) | **M** — `exifr` 도입 + 스키마 확장. ⚠️ rotate↔메타strip 순서 제약(§7) |
| 11 | **사진틀 + 사진 in 프레임** | ✅ `FrameInteractionPlugin.ts`(adjust 모드 `_adjustFrameId`/`frame:adjustEnter`)·`useImageStore.ts`(makeFrameInteractive) / inverted clipPath 마스킹 / PNG 평탄화(`f77cc10`) | 더블클릭 내부 줌/팬, 드롭 스왑, 빈틀삭제, 모양 apply-all (Canva·미리캔버스) | **S→M** — 코어 재사용 + 드롭스왑·빈틀삭제·fill/fit·smart-crop 보강 |
| 12 | **그룹/다중선택/복사/복제/삭제/잠금** | ✅ `GroupPlugin.ts`·`CopyPlugin.ts`·`ObjectPlugin`(del/lock) / `applyObjectPermissions` / 툴바·핫키·우클릭 | Ctrl+G/Ctrl+L, Shift누적, 드래그박스 (Canva) | **공유 계층 — 재사용. '삭제 전 경고 모달'은 공유 `ObjectPlugin.del` 경로 개선이라 전 상품 적용**(포토북 고유 아님, editor 앱에만·del 불변). 포토북 고유=빈틀 무경고 분기뿐 |
| 13 | **페이지 네비 썸네일 + DnD 재정렬** | ✅ `components/PageNavigation/BookNavigation.tsx`(HTML5 DnD, 핸들러 `:286`/`:363`, `computeInnerReorder` `:409`) + **커버 잠금 가드 실재** `draggable={dragEnabled && !m.isCover}`(`:363`) + `reorderByIndex`(`useAppStore.ts`) 서버영속 | Mixbook page tray(swap·⋮메뉴), 그리드뷰 | **S→M** — 재사용. **펼침면 페어 무결성만 진짜 신규**(커버 잠금은 기존) |
| 14 | **300dpi 펼침면 래스터 + 72dpi jpg 썸네일 + 뷰어** | ⚠️ 펼침면=벡터PDF(`ServicePlugin.ts:23` `PRINT_MAX_IMAGE_DIMENSION=3508`)·표지썸네일1장·자동저장 JPEG 0.25배 q0.7(`useAutoSaveThumbnail.ts:52-54`)·`ScreenshotPlugin.generateThumbnail`(`:106`). 뷰어 부재. 유일 래스터 선례=`rasterize.mjs:116`(dpi 300) | 페이지별 래스터, 저해상도 경고(250dpi), 플립북 뷰어 (스냅스) | **L** — 페이지별 300dpi 래스터(필요시 O-4) + 72dpi jpg 루프 + 뷰어 |

**갭 집계:** S=6, M=4, L=3(+1 조건부=싸바리 정밀). 절반 이상이 재사용/소폭이며, 신규 부담은 **펼침면내지·자동배치·페이지별래스터/뷰어** 3개 L + 싸바리 정밀(조건부)에 집중.

### 🔧 적대검증 정정 사항 (종합서 → 본 설계서에서 수정)

| 종합서 주장(폐기) | 사실(코드 확인) | 영향 |
|---|---|---|
| ❌ "선결 블로커: `TemplateSet.editorMode` **엔티티 컬럼 부재**" (§1·§3-1·부록 3회 반복) | ✅ `template-set.entity.ts:83-84`에 `@Column({name:'editor_mode', varchar(20), default:'single'})` **실재**. 서비스가 EditorMode 검증에 사용 중 | **가짜 마이그레이션/정리 선결과제 전면 삭제.** PHOTOBOOK은 `editorMode='book'`(스프레드) 지정만 하면 됨 |
| ❌ "페이지 DnD **커버 잠금 가드 신규**" (§4) | ✅ `BookNavigation.tsx:363` `draggable={dragEnabled && !m.isCover}` **이미 구현** | 신규 아님. **펼침면 페어 무결성만** 진짜 신규 |
| ❌ "싸바리 = **L 전면 신규 서브시스템**" (§3-2) | ✅ `coverEditable=false`+`coverPreviewImage`(`entity:121-129`) MVP 우회로 존재 | 과대 산정 → **MVP=기존 경로 재사용(S)**, 정밀 geometry는 별도 결정 |
| ⚠️ "최소페이지 가드 **순수 신규**" (§6) | ✅ `BINDING_CONSTRAINTS` minPages/maxPages/pageMultiple 경고(`index.ts:1048-1109`) 재사용 가능 | 부분 과소 → 경고 메커니즘 재사용 |
| ⚠️ 부정확 인용 다수 | `BookNavigation.tsx`(bare)→`components/PageNavigation/BookNavigation.tsx`; DnD 247/297→286/363; calculateSpineWidth 1114→1086(함수시작) | 본 설계서에서 전부 정정 |

---

## 3. 데이터모델

### 3-1. `TemplateSetType.PHOTOBOOK` 추가 (S)

> **유형 추가 판단(부록 C 정합, `docs/PRODUCT_TEMPLATE_REGISTRATION_MANUAL` 부록 C·2026-06-23):** 대다수 새 상품유형은 enum 없이 기존 타입 조합+셋 설정으로 가능(Case 1, 예: 레더커버=`BOOK`+`coverEditable=false`). **enum 확장(Case 2)은 출력/구성 규칙이 본질적으로 다른 새 카테고리만** — 포토북은 펼침면 2-up 내지·autofill·페이지 가격연동·펼침면 래스터로 **구성/출력이 본질적으로 달라 Case 2 정당**. 부록 C의 enum 확장 체크리스트를 Phase 1-포토북 P1 에 사용.
```ts
// packages/types/src/index.ts:94 + apps/api/.../template-set.entity.ts:21
export enum TemplateSetType {
  BOOK = 'book',
  LEAFLET = 'leaflet',
  PHOTOBOOK = 'photobook',   // 신규
}
```
- **마이그레이션 불필요**: `type` 컬럼은 enum이 아니라 `varchar(20)`(`template-set.entity.ts:42-47`)이라 문자열 추가만으로 동작. 엔티티 `TemplateSetTypeEnum`(`:21-24`)에도 `PHOTOBOOK='photobook'` 멤버 추가(코드 일관성).
- **`editorMode`는 이미 컬럼 존재**(`:83-84`). PHOTOBOOK은 `EditorMode.BOOK`(스프레드)을 강제 → 폼/서비스에서 `type===PHOTOBOOK ⇒ editorMode='book'` 파생 또는 검증만 추가. **신규 컬럼/마이그레이션 없음.**

### 3-2. `SpreadSpec`/`SpreadConfig` 확장 — 싸바리/편집영역/안전영역 (조건부)
현행 `SpreadSpec`(`index.ts:1443-1452`)은 `cutSizeMm`/`safeSizeMm`가 **단일 스칼라**(사방 균등)이고 보드 개념이 없다. `SpreadConfig.version`은 현재 `1`이며 "향후 계산식 변경 대비" 주석 존재(`index.ts:1516`).

**MVP(권장, S):** 싸바리는 기존 `coverEditable=false` + `coverPreviewImage`(`entity:121-129`)로 우회 — 표지는 미리보기 이미지로만 노출하고 인쇄는 별도 전폭 PDF/PNG. geometry 모델링 없이 양장 화보집 출고 가능.

**정밀 geometry(O-1 승인 시, L):** 모두 optional로 추가해 기존 BOOK 비파괴:
```ts
export interface SpreadSpec {
  // ...기존 8필드 (coverWidthMm..dpi)...
  /** 싸바리(하드커버) 보드 wrap geometry — PHOTOBOOK 양장 전용 */
  caseBind?: {
    boardThicknessMm: number;   // 합지 두께 (책등 폭에 가산)
    turnInMm: number;           // 시접(보드 안쪽 접어넘김, 통상 15mm+)
    wrapMarginMm: number;       // 보드 바깥 풀칠/감싸기 여유
    hingeMm?: number;           // 책등-표지 경계 홈(joint) 폭
  };
  /** 비대칭 블리드 (현행 cutSizeMm 단일 균등 보완) */
  bleed?: { top: number; bottom: number; inner: number; outer: number };
  /** 거터(내지 펼침면 중앙 안전영역) */
  gutterMm?: number;
}
```
- `caseBind` 존재 시 책등폭 = `calculateSpineWidth()`(`index.ts:1086`) + `boardThicknessMm×2`, 전체 표지폭 = cover×2 + spine + (turnIn+wrap)×2. `SpreadLayoutEngine`의 `computeSpreadDimensions`에 wrap 영역 가산.
- **`SpreadConfig.version` 1→2 bump**(`index.ts:1516`) + `SPINE_FORMULA_VERSION`(`index.ts:1564`, 현 '1.0') bump로 계산식 변경 추적.

### 3-3. 펼침면 내지 모델 (L)
- 신규 내지 펼침면 타입 또는 기존 spread에 `regionScope:'cover'|'inner'` 플래그. 좌표는 **중앙원점@150dpi 규약 유지**(reference_coordinate_convention) — 거터를 원점으로 좌/우 면 분할.
- 페이지 메타에 `spreadPair:{left,right}` 추가, 재정렬 시 **페어 무결성 가드**(미리캔버스 주의점). `conversionMode`(`index.ts:1521-1522`, optional JSON·마이그레이션 불필요) 패턴 차용.

### 3-4. 페이지 가변·단가 (M)
가격은 storige 미보유 → **단가 메타를 TemplateSet에 저장 + pageCount emit**하는 2-tier:
```ts
export interface TemplateSet {
  // ...
  /** PHOTOBOOK 페이지 단가 (외부 장바구니 가격계산용 메타) — JSON 컬럼 1개 신규 */
  pricing?: {
    includedPages: number;   // 기본 포함 페이지 (예: 16)
    minPages: number;        // 최소 제작 페이지 (삭제 가드)
    pageStep: number;        // 증감 단위 (펼침면=2)
    perPageUnit: number;     // 초과 페이지당 단가 (사이즈별이면 map)
  };
}
```
- 가격식 `base + max(0, pageCount − includedPages) × perPageUnit`(스냅스/찍스 공통). **계산 주체=파트너**, storige는 `pricing` 메타 + 실시간 pageCount emit(§8).
- 엔티티에 `@Column({name:'pricing', type:'json', nullable:true})` 1개 추가(마이그레이션 1건, additive nullable=비파괴).

### 3-5. 면지(endpaper) (S)
- 기존 `EndpaperConfig`(`index.ts:172-181`) + 엔티티 `endpaperConfig`(`template-set.entity.ts:109-115`) 재사용. PHOTOBOOK은 면지를 "편집불가 빈 면지(`frontEditable:false`)"로 기본 등록하되, 양장 합지-면지 인접 관계만 admin 안내 텍스트 보강.

---

## 4. 표지(펼침면+싸바리) & 내지(펼침면) 등록·편집 규칙

### 4-1. 표지 등록 (admin)
| 케이스 | 등록 방식 | 근거 자산 |
|---|---|---|
| **연질/일반 표지** | 기존 표지 스프레드(wing/cover/spine) 그대로. `coverEditable=true` | `SpreadLayoutEngine.ts`, `SpreadPlugin.ts` |
| **양장 싸바리 (MVP)** | `coverEditable=false` + `coverPreviewImage` 업로드. 인쇄=전폭 PDF 별도 | `template-set.entity.ts:121-129` |
| **양장 싸바리 (정밀, O-1)** | `caseBind` geometry 입력 UI(보드두께·turnIn·wrap) | §3-2 신규 |

### 4-2. 내지 등록 (admin)
- **MVP:** 단면 1p 유지(현행), 파노라마 페이지만 좌/우 분할 분기.
- **정식(O-2):** 펼침면 2-up 캔버스 = 좌면+거터+우면. `spreadPair` 메타, 거터 안전영역 자동 삽입.

### 4-3. 편집 규칙
- 표지/면지는 **재정렬·삭제 잠금**(커버 가드 `BookNavigation.tsx:363` 재사용, 면지는 `frontEditable`/`backEditable` 토글).
- 내지 펼침면은 페어 단위로만 추가/삭제(`pageStep=2`).

---

## 5. 편집기 컨트롤

> ⚠️ 아래 컨트롤은 두 부류다. **§5-A 는 [[fabric-editor]]/[[editor-object-editing]] 소유의 상품 비종속 공유 UX**로, 포토북이 신규 채택하는 것이 아니다("외부 출처" 열은 공유 계층 개선 시 참고용일 뿐). **§5-B 만 포토북 고유**다.

### §5-A 플랫폼 공유 계층 (위임 — 포토북에서 정의/중복 구현 안 함)

| 컨트롤 | 공유 소유 위치 | "보강"(=공유 계층에서 수행, 전 상품 적용) | 외부 참고 |
|---|---|---|---|
| 레이어 패널 | `SidePanel.tsx`(목록·lock·visible·rename) | drag-handle(`:279-281`, onDragStart 부재) DnD 배선 → `ObjectPlugin.moveTo`/z-order + `layerChanged` emit. 툴바 z-order 4버튼 | Canva Position |
| z-order 로직 | `ObjectPlugin.up/upTop/down/downTop`(`:121/154/186/219`, 로직 完) | UI 호출처만 배선(현재 호출 0건) | Canva |
| 그룹/다중선택/정렬 | `GroupPlugin.ts`·ActiveSelection·`CopyPlugin.ts`·`AlignPlugin` | 없음(그대로 재사용) | Canva |
| 페이지 DnD(커버 잠금) | `BookNavigation.tsx:286/363`·`computeInnerReorder:409` | 없음(커버 잠금 `:363` 기존). 펼침면 페어는 §5-B | Mixbook |
| 삭제 경고 | `ObjectPlugin.del`(즉시 실행) | 삭제 전 확인 모달 = 전 상품 객체 삭제에 적용. ⚠️ **editor 앱(`ControlBar`/단축키)에만**, `del` 자체 불변(외부 임베더 회귀 방지) | 스냅스 |
| 모바일 터치 | `ControlsPlugin`·`useIsCoarsePointer` 훅 | 없음. 터치 타깃 ≥44px·핀치줌도 공유 규약 | (모바일 일반) |
| 잠금/권한 | `applyObjectPermissions`(default-permissive, PERM-1) | per-template default 파라미터(O-8)를 **공유 설정값**으로(BOOK/LEAFLET 도 사용 가능, 포토북 전용 잠금 금지) | (내부 정책) |

> ⚠️ §5-A 고정 규칙: 위 "보강"(레이어 DnD 배선·z-order 버튼·삭제 확인 모달·44px 터치)은 **공유 계층에서 수행되어 전 상품에 동일 적용**된다. **포토북 Phase 1 에 묶지 말고 공유 계층 작업으로 분리, 전 상품 회귀 검증 필수**(§11-2 Phase 1-공유 트랙). 구현 가드: ⓡ삭제경고 editor 앱에만(del 불변) · ⓡ레이어 목록 인덱스↔z-index 변환 단일 진실원 · ⓡz-order 버튼 노출도 `enabledMenus`/`editMode` 게이팅 존중.

### §5-B 포토북 고유 컨트롤 (포토북 설계서 소유)

| 컨트롤 | 코어(공유 플러그인) | 포토북 고유 보강 동작 | 외부 출처 |
|---|---|---|---|
| **사진틀** | `FrameInteractionPlugin.ts`·`useImageStore.ts`(makeFrameInteractive) — 코어 공유 | (a)더블클릭 내부 줌/팬 (b)**드롭 오버라이드 스왑** (c)**빈 틀 삭제**(무경고 분기=고유) (d)hover "교체" 힌트 | Canva/미리캔버스, 스냅스 |
| **사진 in 프레임** | inverted clipPath·ShareSnap 핀치줌(D2) — 코어 공유 | **fill/fit 토글**(cover/contain) + **smart-crop 앵커**(face/saliency bbox 1회 산출→메타저장) | Canva, Mixbook |
| **페이지 DnD(펼침면 페어)** | `BookNavigation.tsx:286/363` — 코어 공유 | **펼침면 페어 단위 무결성**만 신규. swap vs insert(O-7) | Mixbook |
| **자동편집** | `useExternalPhotosStore.ts`(입력)↔배치API(출력) | **autofill 엔진**(§7): 정렬→aspect매칭→슬롯채움. 결과=편집가능 시드 | Mixbook Auto-Create |

**그리드/콜라주(포토북 고유, autofill 직결):** Canva Grids 패턴 — 다중 셀 + 드롭 스왑 + Spacing 슬라이더 + Corner rounding. **단 일반 객체 정렬/분배(align/distribute)는 공유 `AlignPlugin`** 이므로 그리드 스냅과 별개로 공유 정렬 컴포넌트를 재사용한다.

---

## 6. 편집영역/안전선

- **표지 per-region 편집경계(스펙 ③, 정밀화):** 안전영역과 **별개**로, 표지는 **앞커버/책등(제목)/뒷커버를 개별 region 으로 나눠 각 region 의 편집가능 경계(edit-bounds)를 admin 이 지정**하고, 편집은 해당 region 내부로만 **클램프**한다(드래그/리사이즈가 경계를 못 넘음). 베이스=`SpreadLayoutEngine`의 `REGION_ORDER`(이미 cover/spine/back 영역 분할 존재) + region 별 `editBounds` 메타 신규. 책등 region 은 보통 제목 텍스트만 허용. 싸바리(보드 wrap) 영역까지 디자인 연장 허용 여부는 region 플래그로 제어. 갭=M.
- **현행 한계:** `SpreadSpec.cutSizeMm`/`safeSizeMm`(`index.ts:1449-1450`)는 **단일 스칼라**(사방 균등). 엔티티 `bleedMm`(`template-set.entity.ts:163`)은 per-edge 의도지만 **워커 실적용은 P4 미완**. → safe area 입력을 **템플릿셋 단위로 일원화**(M).
- **침범 처리 규칙(스펙 추정):**
  - 침범 시 **점선 위 경고 표시**(노란 삼각형) + 주문 전 비차단 요약 게이트.
  - **침범 불가 영역(거터/재단)**: 객체가 넘어가면 **가림(clip) 처리** → 최종 출력에서 **결과 크롭**(safety 밖은 잘림 전제).
- **저해상도 경고:** `effective_dpi = img_px / frame_inch`. 150dpi=hard / 220dpi=soft. hard 미만은 강한 경고(노란 삼각형), 비차단 동의 게이트(임계 O-9). 외부 출처: Canva/미리캔버스(3겹), 스냅스(저해상도 250dpi 경고).
- **거터 침범 검사**는 §9 저장 산출물(파노라마 좌우분할)과 직결 — §9 separate 정책 정합 참조.

---

## 7. 자동편집 (autofill 엔진)

### 7-1. 알고리즘 (외부: Mixbook Auto-Create / aspect-ratio 매칭)
1. **수집:** `useExternalPhotosStore.ts` 사진 목록.
2. **중복 제거:** 파일 해시/유사도(옵션).
3. **정렬(기본):** EXIF `DateTimeOriginal` asc. 폴백 체인 = DateTaken → DateAdded(파일mtime) → FileName. 옵션 드롭다운(asc/desc).
4. **프레임 매칭:** 사진 aspect ratio ↔ 슬롯 aspect ratio 최근접 매칭. 가로/세로/정사각 분류 후 스프레드 단위 슬롯 채움.
5. **출력:** **편집가능 시드**(immutable 아님) — 사용자가 이후 자유 편집.
- **random/장소(GPS) 옵션:** 외부 표준 아님(O-6). MVP는 date/filename/added 3종 한정 권장.

### 7-2. EXIF 도입 (M)
- **의존성:** `exifr` 신규 도입(현재 exif 파서 **전무** 확인).
- ⚠️ **순서 제약(중요):** `storage.service.ts:217`의 sharp `.rotate()`(EXIF orientation 보정)는 **메타데이터를 strip할 수 있음**. → **EXIF 파싱을 `.rotate()` 이전에** 수행하거나, 원본에서 `DateTimeOriginal`/orientation을 먼저 읽고 보존. 파이프 순서: `원본 수신 → exifr 파싱(날짜/GPS/orientation 저장) → sharp.rotate() → 저장`.
- **스키마 확장:** `ExternalPhoto`/업로드 파이프에 `takenAt?:Date`, `gps?:{lat,lng}`(옵션), `smartCropAnchor?:bbox` 추가.

### 7-3. 실행 위치 (O-5)
- **worker 잡(권장):** 대량 사진·비동기. EXIF 파싱은 업로드 파이프(`storage.service.ts:217` 인근, rotate 이전)에서 1회.
- 또는 편집기 클라이언트(소량). 결정 게이트 O-5.

---

## 8. 페이지 가변 & 장바구니 가격 연동

### 8-1. 페이지수 → 장바구니 가격
- storige는 가격 **미보유**. **emit 확장**: 완료 이벤트(`embed.tsx` `editor.complete`, 현 `pages.initial/final`은 주문 고정값만)에 **실시간 pageCount + `pricing` 메타 + cover등급 + size**를 payload 추가 emit. 페이지 추가/삭제 시 즉시 재emit(스냅스/찍스 실시간 재계산).
- **최소페이지 가드:** `pricing.minPages` 이하 삭제 차단. UI 비활성(`BookNavigation`) + 서버검증. **`BINDING_CONSTRAINTS` 경고 인프라**(`index.ts:1048-1109`) 재사용. 증감은 `pageStep`(펼침면=2).
- 가격 계산식은 파트너(bookmoa-mobile) 책임 — storige는 메타 + 이벤트만.

### 8-2. 파트너 연동
- 기존 dual-emit·sessionId 재편집 구조(project_embed_route_integration) 재사용. `/embed`의 `postToParent`에 **페이지별 썸네일 배열** + pageCount 추가.
- 멀티테넌시 `siteId` 스코핑(`template-set.entity.ts:206-207`)으로 사이트별 포토북 템플릿셋 독립 관리.

---

## 9. 저장/렌더

현행: 펼침면=**벡터 PDF**(`ServicePlugin.ts:23` 이미지 3508px=300dpi 상한), 표지 cover.pdf는 worker 머지/검증. **⚠️ spread 책은 서버가 `outputMode='separate'` 강제 → cover.pdf + content.pdf 2파일**(`docs/PLATFORM_INTEGRATION_GUIDE.md:477`). 갭 3종:

1. **300dpi 펼침면 래스터** (L, **조건부 O-4**): 펼침면 단일 300dpi PNG 경로 부재. 유일 래스터 선례=`rasterize.mjs:116`(sharp dpi 300). **인쇄 RIP가 래스터를 요구할 때만** worker 합성 경로로 이식하거나 편집기 `toDataURL(multiplier)`. 벡터 PDF는 텍스트 품질 위해 유지.
   - ⚠️ **separate 정책 정합:** 포토북 펼침면 출력도 spread 모드라 **cover.pdf + content.pdf 강제 분리**(`PLATFORM_INTEGRATION_GUIDE.md:477`)와 충돌하지 않아야 함. 파노라마 좌우분할/거터 침범 검사 결과가 content.pdf 페이지 경계와 정합되는지 검증 필수.
2. **72dpi jpg 페이지 썸네일** (M): 현재 표지 1장 PNG(`useWorkSave.ts`) + 자동저장 JPEG 0.25배 q0.7(`useAutoSaveThumbnail.ts:52-54`)뿐. **페이지별 72dpi jpg 생성 루프** 신규(`ScreenshotPlugin.generateThumbnail` `:106` 재사용). 뷰어/장바구니/파트너 공용.
3. **뷰어/미리보기** (L): 독립 뷰어 페이지 전무. 페이지별 썸네일 기반 **다페이지 플립북 뷰어**(editor 신규 라우트). 파트너엔 현재 표지 썸네일 1장 emit → **페이지별 썸네일 배열**로 확장.

**파트너 동일조건 원칙:** 뷰어 페이지 썸네일 = 파트너 emit 썸네일 = **동일 산출물**(중복 렌더 방지). 외부 출처: 스냅스(플립북·저해상도 경고).

---

## 10. 외부 편집기 벤치마크 요약

| 기능 | Canva | 미리캔버스 | 스냅스/찍스 | 포토북 적용 (공유=위임·고유=신규) |
|---|---|---|---|---|
| **사진틀 제스처** | 더블클릭 내부 줌/팬, 드롭 스왑 | 더블클릭 크롭, 4버튼 z-order | 빈틀삭제·모양 apply-all | 더블클릭 줌/팬 + 드롭스왑 + 빈틀삭제 (§5) |
| **레이어 패널** | Position 패널(Layers탭) | 4버튼(맨앞/앞/뒤/맨뒤) | — | 패널 DnD + 툴바 4버튼 (§5) |
| **자동배치** | — | — | Mixbook Auto-Create(aspect 매칭) | EXIF정렬+aspect매칭 편집가능 시드 (§7) |
| **EXIF 정렬** | — | — | Date Taken/Added/File Name 3택 | date/filename/added 3종 (§7) |
| **3겹 가이드** | bleed/trim/safety | 점선 안전선 | 저해상도 250dpi 경고 | bleed빨강/trim검정/safety점선 + 저해상도 150 (§6) |
| **페이지 tray** | — | — | swap·⋮메뉴·그리드뷰 | 펼침면 페어 swap + 그리드뷰 (§5) |
| **가격 연동** | — | — | 페이지수 실시간 단가 | pageCount+pricing emit (§8) |
| **저장/뷰어** | — | — | 플립북 뷰어·페이지 래스터 | 페이지별 썸네일 + 플립북 (§9) |

> 외부 출처는 공개 제품 동작 관찰 기반. 구현 시 라이선스/특허 회피(독자 구현) 전제.

---

## 11. 미해결 / 오너결정 + 구현 단계(Phase) 제안

### 11-1. 오너 결정 항목

| # | 항목 | 결정 필요 내용 |
|---|---|---|
| O-1 | **싸바리 geometry 정밀도** | MVP=`coverEditable=false` 우회(권장, S) vs 정밀 `caseBind` geometry(L). 우회로 출고 품질 충분한지 |
| O-2 | **펼침면 내지 범위** | 본문 2-up facing 정식 지원(L) vs MVP 단면 1p 유지 + 파노라마만 분기 |
| O-3 | **가격 계산 주체** | storige `pricing` 메타만 emit(권장) vs 총가 계산. 사이즈×커버 단가 매트릭스 출처 |
| O-4 | **300dpi 래스터 필요성** | 인쇄 RIP가 펼침면 래스터 실요구? 현 벡터 PDF + separate(`GUIDE.md:477`)로 충분하면 §9-1 불필요 |
| O-5 | **자동배치 실행 위치** | worker 잡(권장, 대량) vs 편집기. EXIF 파싱은 업로드 파이프 rotate **이전**(§7-2) |
| O-6 | **EXIF GPS 장소그룹** | 비표준(외부). date/filename/added 3종 한정 vs GPS 그룹 추가 |
| O-7 | **페이지 DnD swap vs insert** | 포토북은 swap 흔함(Mixbook). 표지/면지 고정 가드는 기존(`:363`) |
| O-8 | **잠금 default 파라미터(공유)** | 잠금 메커니즘(`applyObjectPermissions`)은 **공유 계층** — 포토북은 신규 잠금 로직 없이 공유 시스템에 **per-template default 파라미터**(default-locked)만 추가(BOOK/LEAFLET 도 사용 가능한 공유 설정, 포토북 전용 분기 금지). 결정=공유 파라미터 도입 + 포토북이 default 를 locked 로 둘지 |
| O-9 | **저해상도 임계** | 150dpi hard / 220 soft 확정. 비차단 동의 게이트 |
| O-10 | **(BLOCKER)** 스펙 14항목 원문 | 발주 스펙 텍스트 확보 → §2 재대조. **최우선** |

### 11-2. 구현 단계 (Phase)

**Phase 0 — 선결 (BLOCKER):** 스펙 14항목 원문 확보 → §2 재대조 → 난이도 재산정. (O-10)

**Phase 1 — Quick Wins (S).** ⚠️ **두 트랙으로 분리**한다. 공유 트랙은 포토북과 독립 가치·전 상품 회귀를 동반하므로 포토북 릴리스에 종속시키지 않는다.

**Phase 1-공유 (공유 계층 트랙 — 전 상품 적용, 포토북과 독립 머지 가능):**
1. S1. 툴바 z-order 4버튼 노출(`ObjectPlugin.up/upTop/down/downTop` `:121/154/186/219` 기존 로직 호출, UI 호출처 0건 → 배선만). ⚠️ 버튼 노출도 기존 `enabledMenus`/`editMode` 게이팅 존중.
2. S2. 객체 삭제 경고 모달(`ControlBar.tsx:217 handleDelete` + 단축키 경로의 진입 전 UI 게이트). ⚠️ `ObjectPlugin.del:272` 자체는 불변(canvas-core 변경 시 ShareSnap/100p/MD2Books 외부 임베더 회귀).
3. S3. 레이어 패널 DnD 배선(`SidePanel.tsx:279-281` onDragStart → S1 의 z-order 재사용). ⚠️ 목록 인덱스↔z-index 변환을 단일 진실원으로.
4. **DoD: BOOK/LEAFLET/카드 편집 라운드트립 회귀 통과**(fillImage 동반 z-order·lockLayerOrder 가드·모바일 DnD↔터치 스크롤 충돌·기존 셋 도구 노출 정책 불변).

**Phase 1-포토북 (포토북 config 트랙, 공유와 병렬 가능=타입 직교):**
1. P1. `TemplateSetType.PHOTOBOOK` enum(`index.ts:94`) + `TemplateSetTypeEnum`(`entity:21`) + admin 폼 분기. **마이그레이션 불필요**(varchar). `type→editorMode='book'` 파생.
2. P2. 페이지별 72dpi jpg 썸네일(`useAppStore.ts:204-263` 기존 png 루프에 **포맷/해상도 파라미터 추가**=기존 png 비파괴). ⚠️ 기본 포맷 png→jpg 변경은 공유 변경=전 상품 회귀 → 반드시 추가 옵션으로.
3. P3. 사진틀 드롭 오버라이드 스왑 + 빈 틀 삭제(`useImageStore.ts:687-865`, `:765-766` 스왑 차단 해제). 빈틀 무경고는 고유(S2 공유 삭제경고와 별개).
4. P4. 싸바리 MVP = `coverEditable=false`+`coverPreviewImage` 경로로 양장 등록(기존 자산).

**Phase 2 — 핵심 신규 (M):**
- EXIF(`exifr`) 도입 + 업로드 파이프 순서 정리(rotate 이전 파싱, §7-2).
- `pricing` JSON 컬럼 + pageCount/썸네일배열 emit 확장(§8).
- 3겹 가이드 + 저해상도 경고 + safe area 일원화 UI(§6).
- 페이지 펼침면 페어 무결성 가드(§4-3, 커버 잠금은 기존).

**Phase 3 — L 서브시스템 (오너 게이트 통과 후):**
- 자동배치 엔진(worker 잡, O-5).
- 펼침면 2-up 내지 모델(O-2).
- 다페이지 플립북 뷰어 + (필요시 O-4) 300dpi 래스터, separate 정책 정합(§9).
- (O-1 승인 시) 싸바리 정밀 geometry.

---

## 부록: 핵심 참조 파일 (절대경로)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/packages/types/src/index.ts`
  - enum `:94-97` · SpreadSpec `:1443-1452` · SpreadConfig `:1515-1523`(version `:1516`) · EndpaperConfig `:172-181` · BINDING_CONSTRAINTS `:1048-1109` · calculateSpineWidth `:1086` · SPINE_FORMULA_VERSION `:1564` · conversionMode `:1521`
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/api/src/templates/entities/template-set.entity.ts`
  - TemplateSetTypeEnum `:21-24` · type(varchar) `:42-47` · **editorMode `:83-84`** · endpaperConfig `:109-115` · **coverEditable `:121-122` · coverPreviewImage `:128-129`** · bleedMm/cropMark/tolerance `:163-177` · siteId `:206-207`
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/packages/canvas-core/src/spread/SpreadLayoutEngine.ts` (REGION_ORDER, computeSpreadDimensions)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/packages/canvas-core/src/plugins/{SpreadPlugin,FrameInteractionPlugin,ObjectPlugin,GroupPlugin,CopyPlugin,ServicePlugin}.ts` (ServicePlugin `:23`)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/editor/src/stores/{useImageStore,useExternalPhotosStore,useAppStore}.ts`
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/editor/src/components/editor/SidePanel.tsx` (drag-handle `:279-281`)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/editor/src/components/PageNavigation/BookNavigation.tsx` (DnD `:286`/`:363`, **커버가드 `:363`**, computeInnerReorder `:409`)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/editor/src/{embed.tsx,hooks/useWorkSave.ts,hooks/useAutoSaveThumbnail.ts}` (썸네일 `:52-54`)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/api/src/storage/storage.service.ts:217` (sharp .rotate, EXIF orientation — 파싱은 이 호출 **이전**에)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/packages/indesign-import/src/raster/rasterize.mjs:116` (유일 300dpi 래스터 선례)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/apps/worker/src/processors/synthesis.processor.ts` (cover 머지/검증)
- `/Users/yohan/Developer/Bookmoa Storige editor/storige/docs/PLATFORM_INTEGRATION_GUIDE.md:477` (**spread=separate 강제: cover.pdf+content.pdf**)
