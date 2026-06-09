# 디자인 가져오기 변환기 (IDML / PSD → Storige 템플릿)

> **패키지**: `@storige/indesign-import` · **상태**: 동작(브라우저 admin + Node) · **갱신**: 2026-06-09
> **관리자 진입점**: `/templates/import` (admin) → `TemplateImport.tsx`
> **연계 문서**: [`EDITOR.md`](./EDITOR.md) · [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) · [`PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html`](./PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html)

---

## 1. 개요

`@storige/indesign-import` 는 **디자인 소스(InDesign IDML, Photoshop PSD)를 Storige 템플릿으로 변환**하는 패키지다. 결과는 SVG 파일이 아니라 **Fabric.js 캔버스 객체 배열(`canvasData.objects`)** 과 (표지 펼침면의 경우) **`spreadConfig`** 를 담은 **DraftTemplateDto** 로, 기존 `POST /templates` 등록 경로에 그대로 투입된다.

- **브라우저(admin)와 Node 양쪽에서 동작**한다. 핵심 `src/` 는 Node 내장 API를 쓰지 않으며, 환경 분기(`typeof document`)로 래스터화 백엔드만 바꾼다(브라우저 `<canvas>` / Node `sharp`).
- **DB 직접 쓰기 없음**: 변환기는 `CreateTemplateDto` 호환 JSON을 만들 뿐이고, 관리자 검수 → 기존 API 등록으로 이어진다.
- **포맷 자동 감지**: 파일 확장자로 IDML / PSD를 구분한다(`detectFormat`).

| 입력 | 결과 Template 타입 | spreadConfig | 주 용도 |
|------|--------------------|--------------|---------|
| **IDML** (InDesign 표지 펼침면) | `type='spread'` | 있음 (5영역) | 책 표지(앞/뒤/책등/날개) |
| **PSD** (Photoshop 단품) | `type='page'` 또는 `'cover'` | 없음(단일 페이지) | 명함 · 내지 단품 등 |

### 1.1 의존성

| 라이브러리 | 용도 |
|------------|------|
| `jszip` | IDML(ZIP) 압축 해제 |
| `fast-xml-parser` | IDML XML 파싱(순서보존/비순서 2가지 파서) |
| `@webtoon/psd` | PSD 파싱(레이어 트리 + 픽셀 합성) |
| `sharp` (Node 한정, 선택) | SVG/RGBA → PNG 래스터화. 브라우저에서는 `<canvas>` 사용 |
| `ag-psd` (devDependency) | 테스트용 PSD 픽스처 생성(`gen-psd-fixture.mjs`) |

---

## 2. 공개 API

`src/index.mjs` 가 진입점이다. 타입 선언은 `src/index.d.mts`.

```js
import {
  convertIdmlToTemplate,   // IDML → 표지 펼침면 템플릿(벡터/하이브리드)
  convertPsdToTemplate,    // PSD → 단일 페이지 템플릿
  parseIdml, toSpreadTemplate, deriveSpecFromPages,
  buildPreviewSvg, colorToHex,
  units, regions,
} from '@storige/indesign-import';
```

### 2.1 `convertIdmlToTemplate(buffer, opts)`

```js
const { result, dto, previewSvg } = await convertIdmlToTemplate(buffer, {
  name: 'MA-348 표지(가져옴)',
  mode: 'vector',     // 'vector'(기본) | 'hybrid'
  dpi: 150,           // 캔버스 DPI(기본 150)
  rasterDpi: 300,     // 하이브리드 배경 PNG dpi(기본 300)
  previewWidth: 1100, // 미리보기 SVG 가로폭(px)
});
```

- `result` — `SpreadTemplateResult`(spec/regionsMm/totalWidthMm/objects/fonts/warnings/draftTemplateDto)
- `dto` — `DraftTemplateDto`(서버 등록용)
- `previewSvg` — 검수용 SVG 문자열

### 2.2 `convertPsdToTemplate(buffer, opts)`

```js
const { result, dto, previewSvg } = await convertPsdToTemplate(buffer, {
  name: '명함(가져옴)',
  pageType: 'page',   // 'page'(내지/단품, 기본) | 'cover'(표지)
  previewWidth: 1100,
});
```

- `result` — `SinglePageResult`(draftTemplateDto/widthMm/heightMm/textCount/rasterCount/warnings/fonts)

---

## 3. IDML(표지 펼침면) 처리

### 3.1 왜 IDML 인가

`.indd` 는 독점 바이너리라 Node 단독 파싱이 불가하다. `.idml` 은 ZIP+XML 공개사양이라 추가 라이선스 없이 파싱된다. INDD는 `scripts/indd-to-idml.jsx`(InDesign ExtendScript)로 IDML로 내보낸 뒤 입력하는 **옵션 경로**로 지원한다(InDesign Server가 있으면 무인 변환 가능).

### 3.2 파싱(`src/idml/reader.mjs`)

IDML 내부 구조와 파싱 대상:

| 파일 | 추출 내용 |
|------|-----------|
| `Spreads/Spread_*.xml` | 페이지 기하(GeometricBounds), 페이지아이템 geometry(z-순서) |
| `Stories/Story_*.xml` | 텍스트 내용 + 폰트/크기/색 |
| `Resources/Graphic.xml` | 색상 정의(CMYK/RGB/별색) |
| `Resources/Fonts.xml` | 폰트 패밀리 목록 |
| `Resources/Preferences.xml` | 블리드(`DocumentBleedTopOffset`) |

핵심 규약:

- **문서순(z-순서) 보존** — `preserveOrder: true` 파서로 페이지아이템을 문서 순서대로 수집한다. 이 순서를 지키지 않으면 책등 패널 아래 있어야 할 도형이 위로 올라온다. `collectItemsOrdered` 가 그룹을 재귀로 펼치며 부모 `ItemTransform` 을 합성한다.
- **줄바꿈(`Br`) 보존** — `CharacterStyleRange` 자식을 순서대로 읽어 `Content`=텍스트, `Br`=`\n` 으로 보존. 단락(`ParagraphStyleRange`) 사이에도 `\n` 을 넣어 다단 텍스트가 영역을 이탈하지 않게 한다.
- **베지어 경로 복원** — `PathGeometry/GeometryPathType/PathPointArray/PathPointType` 의 Anchor·LeftDirection·RightDirection을 읽어 직선(L)/3차 베지어(C)/닫힘(Z)을 복원한다(`src/geometry/path.mjs`).
- **CMYK 원본 보존** — CMYK 색상은 sRGB 근사 hex와 함께 원본 4도값을 `cmykFill` 로 보존한다.
- **별색(Spot) 감지** — 별색 판정은 반드시 `@_Model`(=`Spot` 또는 `Mixed Ink`) 기준이다. Spot도 `Space=CMYK` 인 경우가 많아 Space로 판정하면 놓친다.

### 3.3 표지 5영역(spreadConfig)

펼침면은 좌→우 **5영역**으로 분할된다(`src/geometry/regions.mjs`, canvas-core `SpreadLayoutEngine` 규약과 동일):

```
back-wing | back-cover | spine | front-cover | front-wing
  (뒤날개)   (뒤표지)    (책등)   (앞표지)     (앞날개)
```

- **총폭(mm)** = `wing×2`(활성 시) + `cover×2` + `spine`, 0.1mm 반올림.
- **페이지 수 → 날개 판정**: 3페이지=`[cover, spine, cover]`(날개 없음), 5페이지=`[wing, cover, spine, cover, wing]`(날개).
- **책등 추정**: 가장 좁은 페이지를 책등으로 본다. 표지폭은 책등 제외 페이지 중 가장 넓은 폭, 날개폭은 가장 좁은 폭(좌우 동일 가정).
- 각 객체는 중심 x 좌표를 `resolveRegionAtX(x >= r.x && x < r.x + r.width)` 에 통과시켜 `regionRef` 를 부여받고, region 기준 정규화 앵커(`xNorm`)를 갖는다(런타임 책등 가변 재배치 입력).

### 3.4 좌표 변환

```
IDML pt(1/72in) → mm → 캔버스 px(DPI 150)
```

상수는 `src/geometry/units.mjs`(`DEFAULT_DPI=150`, canvas-core `math.ts` 와 동일). 아핀 변환은 `src/geometry/matrix.mjs` 의 `ItemTransform([a,b,c,d,tx,ty])` 합성/적용/분해를 쓴다. 분해(`decompose`)는 translate/scale/rotation을 뽑고, 행렬식 음수(det<0)는 한 축 반전(flip)으로 `scaleY` 부호에 흡수한다.

- 경로형(Polygon/GraphicLine)은 변환된 anchor들로 정확한 bbox를 계산하고 회전이 이미 좌표에 반영되므로 `angle=0`.
- 그 외(Rectangle/Oval/TextFrame)는 로컬 bbox × scale 로 폭/높이를 잡고 `angle=회전각`.
- **책등 세로쓰기**: TextFrame의 width/height는 프레임 자체 치수(회전 전)를 유지해, `angle`(예: 90°) 회전 시 텍스트가 프레임 밖으로 넘치지 않게 한다.

### 3.5 두 변환 모드: 벡터 vs 하이브리드

| | **벡터 (`mode='vector'`, 기본)** | **하이브리드 (`mode='hybrid'`)** |
|---|---|---|
| 도형/배경 | 편집 가능한 벡터 객체(rect/ellipse/path) | 비텍스트 전체를 **300dpi PNG 1장**으로 굽음(최하단 이미지) |
| 텍스트 | 편집 가능한 textbox | 편집 가능한 textbox(이미지 위) |
| 적합 | 단순한 디자인(정밀 편집) | 효과·그라디언트·별색이 많은 복잡한 디자인 |
| 손실 | 무손실(벡터) | 비텍스트는 PNG 해상도에 의존 |

하이브리드는 `rasterizeArtwork(dto, {dpi:300})`(`src/raster/rasterize.mjs`)가 비텍스트 객체만 그린 SVG를 만들어, 물리치수(`totalWidthMm/HeightMm`) 기준 목표 픽셀로 래스터화한다(텍스트 제외, 투명 배경). 결과 PNG를 최하단 이미지 객체로 깔고 텍스트만 그 위에 둔다.

### 3.6 생성되는 객체 속성

각 객체는 다음을 부여받는다(`toSpreadTemplate`):

- **안정적 id**: `idml-{Self}` — 에디터에서 추적/선택/잠금 가능.
- **`selectable: true`, `evented: true`, `isUserAdded: false`.**
- **중심 좌표 규약**: `left/top` = 중심(originX/originY='center').
- **`cmykFill`**: CMYK 원본값 보존(출력단 미사용, §7 참고).
- **`spotColor`**: 별색 이름(감지 시).
- **`fillRule:'evenodd'`**: 컴파운드 패스(서브패스≥2) — 도넛형/음각 로고의 구멍 보존(nonzero면 메워짐).
- **`meta: { regionRef, anchor }`**: 런타임 책등 가변 재배치 입력. **`_idml`** 디버그 필드는 저장 전 제거된다.

### 3.7 경고(검수 항목)

`toSpreadTemplate` 가 채우는 `warnings[]`:

| 경고 | 의미 |
|------|------|
| 별색(Spot) N개 감지 | 4도(CMYK 근사)로 변환됨 — 후가공(박·형광)/별색판 의도 확인 |
| 재단여백(블리드) 미달 가장자리 | 채움 객체 합집합이 재단선 밖 cutSize까지 안 닿음(흰 테두리 위험) → 편집기에서 배경 확장 권장 |
| 폰트 미임베드(시딩 필요) | IDML은 폰트를 임베드하지 않음 — 시딩/확정 필요 |
| 미해석 색상 | 색상 사전에서 못 찾은 색상 id |

---

## 4. PSD(단품) 처리

### 4.1 파싱(`src/psd/reader.mjs`)

`@webtoon/psd` 로 PSD를 파싱해 레이어 트리를 z-순서로 평탄화한다(그룹 재귀). **하이브리드 전략**:

- **텍스트 레이어 → 편집 가능 textbox**: 내용 + 근사 폰트/크기/색(`EngineData` best-effort 추출, 관리자 확정 전제). 픽셀 bbox가 0이어도(합성 PSD에서 흔함) 스킵하지 않고 폰트/내용으로 근사 박스를 만든다.
- **비텍스트 레이어 → 배경 PNG 1장**: `kind:'raster'` 레이어만 합성. ⚠️ **텍스트 레이어는 반드시 배경에서 제외**해야 텍스트가 두 번 찍히지 않는다.

핵심 규약:

- **z-순서 뒤집기**: `@webtoon/psd` children은 위→아래(`children[0]`=최상단) 순서. 합성/렌더는 아래부터라야 하므로 **뒤집어 bottom→top** 으로 만든다(배경 맨 아래, 텍스트 위).
- **DPI 추출**: `resolutionInfo` 에서 DPI를 읽어 px→mm 변환에 쓴다(`PixelsPerCM` 단위면 ×2.54). 해상도 정보가 없으면 72dpi로 가정.
- **줄바꿈 정규화**: Photoshop의 `\r` 을 `\n` 으로 정규화.

### 4.2 배경 합성(`src/psd/rasterizePsd.mjs`)

`compositeLayersToPng(rasterLayers, W, H)` — 비텍스트 레이어를 PSD **원본 px 해상도 그대로** 합성한 PNG dataUrl을 만든다(인쇄 해상도 보존).

- 브라우저: 레이어별 임시 `<canvas>` → `drawImage` 알파 합성(위치/클리핑 자동).
- Node: `sharp` 로 합성. ⚠️ Node 경로는 캔버스 밖으로 나가는 레이어를 스킵한다(sharp가 음수/초과 오프셋 거부). 브라우저 경로는 `drawImage` 로 정상 클리핑된다.

### 4.3 단일 페이지 템플릿(`src/convert/toSinglePageTemplate.mjs`)

- 좌표: PSD px → 물리 mm(소스 dpi) → 캔버스 px(템플릿 dpi 150). 모든 스케일 = `150 / sourceDpi`.
- 배경 아트워크 이미지(최하단) + 텍스트 textbox(근사값) 순으로 객체 생성.
- **출력 = `type='page'` 또는 `'cover'` 단일 페이지 Template (spreadConfig 없음).**
- 모든 텍스트 객체에 `_psd: { name, approx:true }` 디버그 필드(저장 전 제거).
- 경고: 폰트 확정 필요, "텍스트 폰트/크기/효과는 추출 근사값 — 에디터에서 관리자 확정 필요", (CMYK PSD면) `@webtoon/psd` 지원 제한 경고, 해상도 <300dpi 경고.

---

## 5. 책등 가변 (런타임 파생)

표지 spread 템플릿의 `spineWidthMm` 는 **권위 고정값이 아니라 런타임 파생값**이다. 권위 검증(`validateSpreadAgainstAuthority`, `packages/types/src/index.ts`)은 **cover 가로/세로, 날개 유무/폭 4필드만** 비교하고 **책등·총폭은 비교하지 않는다**. 책등은 주문 페이지수/용지에 따라 동적으로 결정되는 게 정상이기 때문이다.

책등폭 공식(`packages/types/src/index.ts`):

```
spineWidth(mm) = (pageCount / 2) × paperThickness + bindingMargin
```

- 셋(`editorMode='book'`)이 구성되면 내지 수 변동 시 `SpreadPlugin.resizeSpine`(canvas-core)가 자동으로 책등을 리사이즈하고, 각 객체의 `meta.regionRef/anchor` 를 기준으로 영역 객체를 재배치한다.
- **표지 IDML 단독으로는 책 셋 완전 자동화가 불가**하다. 책모드 검증이 **SPREAD 1개 + PAGE≥1** 을 강제하므로 내지(page) 템플릿이 필수다.

> ⚠️ **구현 주의(라운드트립)**: 객체 `meta`(regionRef/anchor)는 런타임 `resizeSpine` 재배치의 유일한 입력인데, 표준 단일 Template 저장경로의 직렬화 화이트리스트에 `meta` 가 포함되는지 확인이 필요하다(`useTemplateSetSave` 경로만 포함). 변환 산출 `canvasData` 에 `meta` 를 넣어도 라운드트립에서 탈락하면 책등 가변이 깨질 수 있다. 보완: 저장 화이트리스트에 `'meta'` 추가, 또는 `spreadConfig.regions` 기반 on-load regionRef 재계산.

---

## 6. 등록 워크플로우 (admin `/templates/import`)

진입점은 `apps/admin/src/pages/Templates/TemplateImport.tsx`.

```
불러오기 → 변환(브라우저) → 미리보기·경고 검수 → 등록 대상 선택 → 템플릿 등록
```

1. **불러오기·자동 감지** — `.idml`/`.psd` 드래그&드롭. `detectFormat` 으로 포맷 결정. 브라우저에서 직접 변환(자동 업로드 안 함).
2. **변환** — IDML이면 벡터/하이브리드 토글(변경 시 재변환), PSD면 항상 하이브리드.
3. **검수** — 미리보기 SVG + 감지 사양(표지: cover/spine/wing/총폭, PSD: 판형/텍스트 수/배경 레이어 수) + 경고 리스트.
4. **등록 대상 선택** —

   **IDML 표지**:
   - **(a) 표지 단품 등록** — `type=spread` Template만 생성 → 편집기(`/templates/editor?id=...`)로 이동.
   - **(b) 책등 가변 셋으로 이어서 등록(방법 A)** — 표지 Template 생성 후 `/template-sets/new` 로 `state.seedTemplateId` 인계.

   **PSD**: 페이지 타입(page/cover) 선택 → 단일 페이지 Template 등록 → 편집기로 이동(텍스트 폰트/크기/효과 확정).

5. **저장 시 정리** — `_idml`/`_psd` 디버그 필드 제거, `meta` 유지.

### 6.1 책등 가변 셋 인계(방법 A) — `TemplateSetForm.tsx`

`seedTemplateId` 를 받은 `TemplateSetForm`(`apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx`)이 자동으로:

- 셋 타입 `BOOK`, `editorMode=BOOK` 설정,
- 셋 판형 = 표지 한 면 크기(`spreadConfig.spec.coverWidth/Height`),
- 표지(spread)를 셋의 첫 템플릿(필수)으로 자동 추가,
- `canAddPage=true` 설정.

관리자는 **내지(page) 템플릿 추가 + 페이지 수 범위(`pageCountRange`)** 만 수동으로 채우면 된다.

> 상품 연결(`ProductTemplateSet`, sortcode)은 이 흐름 밖의 **별도 수동 단계**다.

---

## 7. 자동 vs 수동

| 구분 | 항목 |
|------|------|
| **자동** | IDML/PSD 변환 · 표지 Template 등록 · 셋 폼 책모드/판형/표지 자동 추가 · 책등 가변 런타임(`resizeSpine`) |
| **수동 필수** | 내지 템플릿 선택 · `pageCountRange` · PSD 텍스트 폰트/크기/효과 확정 · 상품 카테고리 연결(ProductTemplateSet) |

---

## 8. 인쇄 규약 / 손실 주의

| 항목 | 현황 |
|------|------|
| **색** | 파이프라인 전체가 RGB. CMYK→sRGB 색차 발생. `cmykFill` 원본은 보존되나 **출력단 미사용**. canvas-core `colors.ts` 에 ICC(LCMS2 기반) `cmykToRgb` 엔진이 존재하나 기본은 legacy 공식 폴백 |
| **폰트** | IDML/PSD 모두 미임베드 → 시딩/확정 필요 |
| **효과** | overprint/투명도/블렌드 미추출 |
| **bleed** | IDML은 `DocumentBleedTopOffset` 명시값 사용. PSD는 캔버스 전체=블리드 가정 |
| **해상도** | PSD는 원본 px 상한(300dpi 미달 시 경고). 하이브리드 배경/PSD 배경은 원본 해상도 의존 |
| **벡터** | IDML 도형/텍스트(svg2pdf 경로)는 무손실 |
| **래스터** | 하이브리드 배경/PSD 배경은 래스터 — 원본 해상도에 의존 |
| **INDD** | `scripts/indd-to-idml.jsx`(InDesign ExtendScript)로 IDML 변환 후 입력 |

---

## 9. AI(일러스트) 현황

**미지원**(네이티브 `.ai` 파싱 경로 없음). 권장 우회:

1. **AI → SVG 내보내기 → 기존 SVG 임포트**(편집 가능) — 가장 권장.
2. **AI(=PDF) → Ghostscript 래스터 → 하이브리드(평면)** — 편집 불가 평면.

네이티브 `.ai` 편집 객체 파싱은 비권장(로드맵 항목, §11).

---

## 10. 파일 구조 / 검증

### 10.1 파일 구조

| 경로 | 역할 |
|------|------|
| `src/index.mjs` (+ `index.d.mts`) | 공개 API(`convertIdmlToTemplate`/`convertPsdToTemplate` 등) |
| `src/geometry/units.mjs` | pt/mm/px 변환(DPI 150) |
| `src/geometry/matrix.mjs` | ItemTransform 아핀행렬 합성/적용/분해 |
| `src/geometry/regions.mjs` | 5영역 분할 + `resolveRegionAtX` + 정규화 앵커 |
| `src/geometry/path.mjs` | PathGeometry → SVG/Fabric path `d` 복원(베지어) |
| `src/idml/reader.mjs` | IDML ZIP+XML 파싱 → IdmlDoc |
| `src/convert/toSpreadTemplate.mjs` | IdmlDoc → 표지 펼침면 DTO |
| `src/convert/toSinglePageTemplate.mjs` | PSD → 단일 페이지 DTO |
| `src/psd/reader.mjs` | PSD 파싱 → 레이어 분리(텍스트/래스터) |
| `src/psd/rasterizePsd.mjs` | 비텍스트 레이어 합성 → 배경 PNG |
| `src/raster/rasterize.mjs` | 하이브리드 비텍스트 → 300dpi PNG |
| `src/preview/svg.mjs` | 변환 결과 → 미리보기 SVG |
| `scripts/indd-to-idml.jsx` | INDD → IDML(InDesign ExtendScript) |
| `scripts/convert-sample.mjs` | IDML 변환 CLI(요약 출력 + JSON 저장) |
| `scripts/render-preview.mjs` | 변환 결과 → SVG/PNG 렌더(검증) |
| `scripts/gen-psd-fixture.mjs` | 테스트용 PSD 픽스처 생성(ag-psd) |

### 10.2 검증

- **코어 단위테스트 통과** — geometry units/matrix/regions/path (`node --test`, 의존성 0). 34건 통과 확인.
- **E2E** — IDML 벡터/하이브리드 + PSD 단일페이지를 실제 브라우저 변환으로 확인.
- **빌드** — admin tsc + vite build 통과.

```bash
# geometry 코어 테스트(의존성 설치 없이)
node --test packages/indesign-import/src/geometry/units.test.mjs \
            packages/indesign-import/src/geometry/matrix.test.mjs \
            packages/indesign-import/src/geometry/regions.test.mjs \
            packages/indesign-import/src/geometry/path.test.mjs

# IDML 변환 CLI
node packages/indesign-import/scripts/convert-sample.mjs fixtures/cover-sample.idml
```

---

## 11. 로드맵 / 잔여 (CTO 방향 반영, 2026-06-09)

인쇄 출력 정합성 게이트 중심으로 재정의. ①(pdfOutputMode)·④(에셋 카테고리 큐레이션)은 별개 작업으로 배포 완료.

| 항목 | 상태 |
|------|------|
| **B. 상품별 색 처리 모드** — `TemplateSet.colorMode('rgb'\|'cmyk')` + admin Select | ✅ **데이터모델+admin 배포**(2026-06-09). ⏸ 워커 실제 색변환(GS `-sColorConversionStrategy`/ICC, `colors.ts` LCMS2)은 인쇄출력 영향 → 스테이징 후 적용 |
| **A. 텍스트 아웃라인 출력** — 고객/변환 텍스트를 PDF 저장 시 **벡터 아웃라인화**(폰트 시딩 아님). `woff2ToTtf`→opentype.js 글리프. 편집기(svg2pdf)+워커 양경로 | ⏳ 미착수 |
| **C. 오버프린트/녹아웃 안전변환** — 인쇄 규약 처리 | ⏳ 미착수 |
| **D. 에디터 실로드 E2E** — 책등 가변 런타임 검증(`meta` 직렬화는 canvas.ts:151로 **해소됨**, 검증만) | ⏳ 검증 대기 |
| **PNG 에셋 대비책** — ①dataURL 인라인 → `filesApi` 업로드(DB 비대화 방지) ②사진 프레임(`AppFrame`) 투명창 마스킹(안=사진/밖=클립) 정밀도 검증·변환기 알파보존 | ⏳ 미착수 |
| **AI(.ai) 임포트 정식화** — SVG export 우회 존재, 네이티브 파싱 비권장 | 보류(P2) |
| **PSD 벡터형(셰이프) 레이어 보존** — 선택 옵션 | 보류(P2) |

---

> 작성: 2026-06-09 · 코드 기준 검증(`packages/indesign-import/src/`, `apps/admin/src/pages/Templates/TemplateImport.tsx`, `TemplateSets/TemplateSetForm.tsx`, `packages/types/src/index.ts`).
