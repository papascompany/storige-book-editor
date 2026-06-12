# 디자인 가져오기 변환기 (IDML / PSD → Storige 템플릿)

> **패키지**: `@storige/indesign-import` · **상태**: 동작(브라우저 admin + Node) · **갱신**: 2026-06-12
> **관리자 진입점**: `/templates/import` (admin) → `TemplateImport.tsx`
> **연계 문서**: [`EDITOR.md`](./EDITOR.md) · [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) · [`PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html`](./PRODUCT_TEMPLATE_REGISTRATION_MANUAL.html)
> **▶ 운영 전체 플로우(업로드·변환·등록·테스트·검증)**: [`IDML_IMPORT_FLOW.md`](./IDML_IMPORT_FLOW.md) · [`IDML_IMPORT_FLOW.html`](./IDML_IMPORT_FLOW.html) (이 문서=기술 아키텍처 / 그 문서=실제로 돌리고 검증하는 법)

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
  mode: 'vector',     // 'vector'(기본) | 'hybrid' | 'flat-spine' (§3.5/§13)
  dpi: 150,           // 캔버스 DPI(기본 150)
  rasterDpi: 300,     // 플랫 배경 PNG dpi(기본 300)
  previewWidth: 1100, // 미리보기 SVG 가로폭(px)
  linkedImages,       // (선택, A5) 파일명→dataURL Map/객체 — placed 이미지 실복원(§3.6)
});
```

- `result` — `SpreadTemplateResult`(spec/regionsMm/totalWidthMm/objects/fonts/warnings/draftTemplateDto)
- `dto` — `DraftTemplateDto`(서버 등록용)
- `previewSvg` — 검수용 SVG 문자열
- `linkedImages` — IDML 의 배치(placed) 이미지 프레임을 동반 업로드 이미지와 매칭해 실제 복원(파일명 NFC 정규화 후 정확 매칭 → 소문자 폴백). **미제공/미매칭 시 기존 회색 플레이스홀더 + 경고 출력이 바이트 단위로 보존**(하위호환).

### 2.2 `convertPsdToTemplate(buffer, opts)`

```js
const { result, dto, previewSvg } = await convertPsdToTemplate(buffer, {
  name: '명함(가져옴)',
  pageType: 'page',   // 'page'(내지/단품, 기본) | 'cover'(표지)
  previewWidth: 1100,
});
```

- `result` — `SinglePageResult`(draftTemplateDto/widthMm/heightMm/textCount/rasterCount/warnings/fonts)

### 2.3 `extractDesignPackage(buffer)` (A5)

admin 이 단일 zip 업로드로 IDML+링크 이미지를 받을 수 있게 하는 해제 헬퍼.

- 판별 순서: **`*.idml` 엔트리 우선(패키지 zip)** → 루트 `designmap.xml`(순수 IDML — IDML 자체가 zip이고 designmap.xml 은 반드시 루트). IDML 내부 구조를 폴더째 압축한 zip(중첩 designmap.xml만 존재)은 순수 IDML 로 오판하면 `parseIdml` 이 깨지므로 **명시 에러**로 안내.
- 반환: `{ kind:'idml'|'package', idmlBuffer, linkedImages(파일명 NFC→dataURL Map), skipped[] }`. 브라우저 디코드 불가 형식(TIFF/EPS/PDF/PSD/AI 등)은 `skipped` 로 보고(경고+플레이스홀더 유지용).

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
IDML pt(1/72in) → mm → content px(좌상단원점, DPI 150) → scene px(중앙원점, 객체 left/top)
```

상수는 `src/geometry/units.mjs`(`DEFAULT_DPI=150`, canvas-core `math.ts` 와 동일). 아핀 변환은 `src/geometry/matrix.mjs` 의 `ItemTransform([a,b,c,d,tx,ty])` 합성/적용/분해를 쓴다. 분해(`decompose`)는 translate/scale/rotation을 뽑고, 행렬식 음수(det<0)는 한 축 반전(flip)으로 `scaleY` 부호에 흡수한다.

> 🧭 **content↔scene(중앙원점) 변환은 [`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md) 가 정본.** 부호 규약은 `src/geometry/centerOrigin.mjs`(SSOT) 한 곳에만 두고, 변환기·미리보기·래스터 4파일이 모두 이 헬퍼만 쓴다(드리프트 방지). 회귀 가드: `centerOrigin.test.mjs` + `preview/renderInvariants.test.mjs`.

- 경로형(Polygon/GraphicLine)은 변환된 anchor들로 정확한 bbox를 계산하고 회전이 이미 좌표에 반영되므로 `angle=0`.
- 그 외(Rectangle/Oval/TextFrame)는 로컬 bbox × scale 로 폭/높이를 잡고 `angle=회전각`.
- **책등 세로쓰기**: TextFrame의 width/height는 프레임 자체 치수(회전 전)를 유지해, `angle`(예: 90°) 회전 시 텍스트가 프레임 밖으로 넘치지 않게 한다.

### 3.5 세 변환 모드: 벡터 / 하이브리드 / flat-spine (2026-06-12, `7585e38`)

각 모드는 `spreadConfig.conversionMode` 와 1:1 대응한다(설계 결정·함정은 **§13** 참조).

| | **벡터 (`mode='vector'`, 기본)** | **하이브리드 (`mode='hybrid'`)** | **flat-spine (`mode='flat-spine'`)** |
|---|---|---|---|
| conversionMode | `full` | `flat-spread` | `flat-spine` |
| 도형/배경 | 편집 가능한 벡터 객체(rect/ellipse/path) | 비텍스트 전체를 **300dpi PNG 1장**(최하단 이미지) | 전폭 300dpi 1회 렌더 후 **3크롭**(back/spine 3배폭/front, 흰 배경 합성 불투명) |
| 텍스트 | 편집 가능한 textbox | 편집 가능한 textbox(이미지 위) | 편집 가능한 textbox(이미지 위) |
| 책등 가변 | 허용(meta 재배치) | **차단(책등 고정)** | **허용** — spine PNG가 3배폭이라 두께 변동을 흡수 |
| 적합 | 단순한 디자인(정밀 편집) | 효과가 많은 디자인 + 책등 고정 상품 | 효과가 많은 디자인 + 책등 가변 책 셋 |
| 손실 | 무손실(벡터) | 비텍스트는 PNG 해상도 의존 | 비텍스트는 PNG 해상도 의존 |

하이브리드는 `rasterizeArtwork(dto, {dpi:300})`(`src/raster/rasterize.mjs`)가 비텍스트 객체만 그린 SVG를 만들어, 물리치수(`totalWidthMm/HeightMm`) 기준 목표 픽셀로 래스터화한다(텍스트 제외, 투명 배경). 결과 PNG를 최하단 이미지 객체(고정 — §3.6 잠금)로 깔고 텍스트만 그 위에 둔다.

flat-spine 은 같은 전폭 래스터를 `computeFlatSpineCrops`(`convert/flatSpineGeometry.mjs`, 순수 함수)의 mm 기반 경계로 3크롭(`raster/cropArtwork.mjs`, 흰 배경 합성)해 `spine-artwork`(최하단, 책등 중심 기준 **3배폭**) → `back-artwork` → `front-artwork` → 텍스트 순 z-order 로 깐다. back/front 가 spine 크롭의 겹침 구간을 **불투명하게 덮어 은폐**하는 구조라, 책등이 늘어나면 가려져 있던 spine PNG 가 드러나며 디자인이 따라간다.

> ⚠️ **미리보기(`preview/svg.mjs`)·래스터(`raster/rasterize.mjs`) 좌표 주의**: 둘 다 SVG `viewBox="0 0 W H"`(content 좌상단원점)인데 객체 `left/top` 은 scene(중앙원점)이다 → 비-path 객체는 `sceneToContent`(`geometry/centerOrigin.mjs` SSOT)로 환산해야 region·path 와 정합한다. 이 환산을 빠뜨리면 back-cover(−x) 객체가 viewBox 밖으로 클립되고 front 가 좌측으로 밀린다(2026-06-11 ③④ 회귀 — `527b85b` 수정, `a64d409` 단일화 + 불변식 테스트로 재발 차단). path 의 `d` 는 이미 content 절대 px 라 변환 제외.

### 3.6 생성되는 객체 속성

각 객체는 다음을 부여받는다(`toSpreadTemplate`):

- **안정적 id**: `idml-{Self}` — 에디터에서 추적/선택/잠금 가능.
- **`selectable: true`, `evented: true`, `isUserAdded: false`.** (배경 아트워크 예외 — 아래 하이브리드 잠금)
- **중심 좌표 규약**: `left/top` = scene(중앙원점, originX/originY='center'). content→scene 변환은 `geometry/centerOrigin.mjs`(SSOT). 자세히 [`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md).
- **`styles: {}` + per-run styles** (A2+A3, `8a23f93`): textbox 필수 — fabric 5.5 에서 `styles` 키 누락 시 `stylesFromArray(undefined)` 전파 → 이후 `toObject`(저장/PDF)에서 `stylesToArray` 크래시(무한로딩). 빈 객체라도 반드시 출력(`9628f1a`). 혼합 서식 스토리는 `convert/textStyles.mjs`(매핑 SSOT)가 **객체 base(문자수 가중 지배값)와 다른 속성만 diff** 로 채운다(전 run 동일이면 `{}`). 객체 단위 매핑: `charSpacing`=Tracking 1:1(둘 다 1/1000em), `lineHeight`=LeadingPt/(1.13×fontSizePt)(auto=AutoLeading 120%→≈1.0619), `textAlign`=Justification 매핑, FontStyle 스타일명→`fontWeight`(SemiBold=600·Heavy=900 등). 세로짜기는 단일 스타일 유지 + 자간을 lineHeight 로 환산(`(1+trk/1000)/1.13`). Tracking/Justification 혼합·HorizontalScale 은 객체 단위 한계 → 지배값 근사 + 경고(§3.7).
- **`rx`/`ry`**: Oval(ellipse) 은 반경을 명시 — `fabric.Ellipse` 는 width/height 가 아닌 rx/ry 로 그린다. 누락 시 rx=0 비가시·재저장 시 width:0 박제(`527b85b`). **Rectangle 균일 RoundedCorner 도 rx/ry**(A6, `50dc6d7`) — `extractCorner`(per-corner 4값+legacy 동시 해석, option≠None ∧ radius>0 게이트로 잔존 기본값 12.7pt 오염 차단), |scale| 베이크, **비클램프**(fabric/SVG 렌더 클램프 동일 → pill 형상 보존). 한 축만 0 라운딩되면 직각 처리+경고(fabric `_initRxRy` 의 0=미설정 의미 분기 차단). FULL/래스터/미리보기 3경로 동일 반영. 가시 stroke 색 없는 고아 `strokeWidth` 는 제거(=[None] 상속 비가시가 정답).
- **그라디언트 `fill`** (A1, `3639c8b`): `FillColor='Gradient/...'` 판정 시 fabric Gradient **plain object**(`{type, coords, colorStops, gradientUnits:'pixels'}`) — fabric `_initGradient` 가 자동 부활시켜 왕복 안전. 끝점 E 를 **inner pt 공간에서 합성 후 S 와 동일한 SSOT 매퍼로 사상** → ItemTransform 회전/플립/스케일(베이크 포함) 자동 정합. flipY 는 미러 보정+경고, Midpoint≠50 은 50% 혼합 중간 스톱 합성. FLAT 래스터/미리보기는 `render/svgGradient.mjs` 공통 defs(objectBoundingBox 정규화 — 비정사각 대각은 각도 근사 경고). **텍스트 fill 그라디언트는 검정 대체+경고 유지**(별도 사이클 보류). 잔존 `GradientFill*` 파라미터만 있는 단색 프레임은 무시(stale 값 실측).
- **placed 이미지** (A5, `e1fd2f2`): 배치 SSOT = **inner Image `ItemTransform`**(FFO crop 은 보조 — placed 없는 프레임에 crop 잔재 실측, 단독 신뢰 금지). `linkedImages` 매칭 시 프레임 로컬 교차(가시영역)를 **픽셀로 크롭 베이크**(브라우저 canvas/Node sharp, JPEG 소스는 JPEG q90)한 plain image 객체로 동일 z-order 인덱스에 치환 — fabric `cropX`/`clipPath` 불사용(직렬화 함정 회피). FULL=편집 가능 이미지(잠금 없음, id 승계), FLAT=래스터에 z-order 그대로 베이크. 미매칭은 '동반 업로드 매칭 실패' 구분 경고, 회전 inner IT 는 경고+폴백.
- **`cmykFill`**: CMYK 원본값 보존(출력단 미사용, §7 참고).
- **`spotColor`**: 별색 이름(감지 시).
- **`fillRule:'evenodd'`**: 컴파운드 패스(서브패스≥2) — 도넛형/음각 로고의 구멍 보존(nonzero면 메워짐).
- **`meta: { regionRef, anchor }`**: 런타임 책등 가변 재배치 입력. flat 아트워크는 `meta.flatArtwork('spine'|'back'|'front')` 추가(§13). **`_idml`** 디버그 필드는 저장 전 제거된다.

**하이브리드 배경 아트워크 잠금**(`idml-artwork`/`psd-artwork`, `geometry`→`convert/artworkLock.mjs` `ARTWORK_LOCK`): 굽힌 PNG 1장은 표지 판형에 **고정**된다. `selectable:false`·`evented:false`·`hasControls/hasBorders:false`·`lockMovement/Rotation/Scaling*:true`·`deleteable:false`·`extensionType:'template-element'`(레이어 패널 숨김 + 로드 시 `isUserAdded=false` 재판정)·`lockInfo{lockLevel:'admin'}`(고객 차단, 관리자 권한 경로만 해제). `excludeFromExport` 는 두지 않아 PDF/썸네일에는 포함. 이 속성들은 canvas-core `extendFabricOption` 화이트리스트로 저장 라운드트립 보존(편집은 텍스트 오버레이만, 배경 교체는 재가져오기).

### 3.7 경고(검수 항목)

`toSpreadTemplate` 가 채우는 `warnings[]`:

| 경고 | 의미 |
|------|------|
| 별색(Spot) N개 감지 | 4도(CMYK 근사)로 변환됨 — 후가공(박·형광)/별색판 의도 확인 |
| 재단여백(블리드) 미달 가장자리 | 채움 객체 합집합이 재단선 밖 cutSize까지 안 닿음(흰 테두리 위험) → 편집기에서 배경 확장 권장 |
| 폰트 미임베드(시딩 필요) | IDML은 폰트를 임베드하지 않음 — 시딩/확정 필요 |
| 미해석 색상 / 미해석 텍스트 색상 | 색상 사전에서 못 찾은 색상 id. 텍스트는 검정으로 대체(그라디언트 텍스트 포함 — A1 보류) |
| 자간/단락 정렬 혼합 (A2+A3) | fabric 은 charSpacing/textAlign 이 객체 단위 — 혼합 run 은 문자수 가중 **지배값 근사** |
| 가로비율(HorizontalScale) N% | fabric 미지원 — 미적용, 원본보다 글자폭 넓을 수 있음 |
| per-run 정규화 불일치 / 세로쓰기 혼합 스타일 | 단일(대표) 스타일 폴백 — 혼합 서식 유실 가능 |
| 그라디언트: 회전/플립/대각+비정사각/곡선 경로 | 실측 표본 0건 또는 FLAT objectBoundingBox 한계 — 합성 검증은 통과, 편집기에서 확인 권장 |
| 코너 유형/비대칭 코너 반경 (A6) | RoundedCorner 외·비대칭은 실표본 0건 — 직각/최대값 균일 근사 |
| 스트로크: 특수 선 유형/끝모양/접합/선 정렬 (A6) | dash·cap·join·alignment 실표본 0건 — 감지 시 경고만(실선/기본값 근사, 보정식 보류) |
| 배치 이미지 N개 | IDML에 픽셀 미포함 — 회색 플레이스홀더. **같은 파일명 이미지를 동반 업로드하면 자동 복원**(A5) |
| 동반 업로드 매칭 실패: 파일명 | 링크 파일명과 일치하는 이미지 미제공(재업로드 유도) 또는 복원 미지원 형식(TIFF/EPS 등) — 플레이스홀더 유지 |
| 세로쓰기 텍스트 N개 | 글자 단위 세로 배치 근사 — 줄간격·위치 확인 |

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
- **`conversionMode='flat-spread'` 템플릿은 책등 고정** — `spineCalculator` 가 재계산을 정상 스킵하고 `resizeSpine` 도 no-op(§13.2). `flat-spine` 은 가변 허용(spine-artwork 만 불변).
- **표지 IDML 단독으로는 책 셋 완전 자동화가 불가**하다. 책모드 검증이 **SPREAD 1개 + PAGE≥1** 을 강제하므로 내지(page) 템플릿이 필수다.

> ⚠️ **구현 주의(라운드트립)**: 객체 `meta`(regionRef/anchor)는 런타임 `resizeSpine` 재배치의 유일한 입력인데, 표준 단일 Template 저장경로의 직렬화 화이트리스트에 `meta` 가 포함되는지 확인이 필요하다(`useTemplateSetSave` 경로만 포함). 변환 산출 `canvasData` 에 `meta` 를 넣어도 라운드트립에서 탈락하면 책등 가변이 깨질 수 있다. 보완: 저장 화이트리스트에 `'meta'` 추가, 또는 `spreadConfig.regions` 기반 on-load regionRef 재계산.

---

## 6. 등록 워크플로우 (admin `/templates/import`)

진입점은 `apps/admin/src/pages/Templates/TemplateImport.tsx`.

```
불러오기 → 변환(브라우저) → 미리보기·경고 검수 → 등록 대상 선택 → 템플릿 등록
```

1. **불러오기·자동 감지** — `.idml`/`.psd` 드래그&드롭. `detectFormat` 으로 포맷 결정. 브라우저에서 직접 변환(자동 업로드 안 함). **A5 동반 업로드**: `.idml`+이미지 다중 선택 / 패키지 zip(`extractDesignPackage`) / 이미지 추가 업로드(직전 변환에 병합 재변환) — placed 이미지 실복원, 매칭 ✓/✗ 요약 표시(`placedMatching.ts`).
2. **변환** — IDML이면 모드 3종 선택(벡터/펼침면 플랫형/책등가변 3분할 플랫형, 변경 시 재변환 — §3.5/§13), PSD면 항상 하이브리드.
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
| `src/geometry/centerOrigin.mjs` | **content↔scene(중앙원점) 변환 SSOT** — `halvesOf`/`contentToScene`/`sceneToContent`. 변환기·미리보기·래스터 4파일이 공용([`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md)) |
| `src/idml/reader.mjs` | IDML ZIP+XML 파싱 → IdmlDoc(per-run 스타일·단락·그라디언트·코너/스트로크·placed 메타 포함) |
| `src/convert/toSpreadTemplate.mjs` | IdmlDoc → 표지 펼침면 DTO |
| `src/convert/toSinglePageTemplate.mjs` | PSD → 단일 페이지 DTO |
| `src/convert/artworkLock.mjs` | 하이브리드 배경 아트워크 고정 잠금 속성(`ARTWORK_LOCK`) — IDML/PSD 공용 |
| `src/convert/textStyles.mjs` | **(신규 A2+A3)** per-run → fabric 매핑 SSOT — styles diff/charSpacing/lineHeight/textAlign/fontWeight/세로짜기 환산 |
| `src/convert/gradientFill.mjs` | **(신규 A1)** IDML 그라디언트 → fabric Gradient plain object(inner 공간 E 합성, flipY 보정, Midpoint 합성) |
| `src/convert/flatSpineGeometry.mjs` | **(신규 §13)** flat-spine 3크롭 경계 순수 함수(`computeFlatSpineCrops` — 경계 mm 1회 반올림으로 3분할 합=전폭 보장) |
| `src/convert/placedImages.mjs` | **(신규 A5)** placed 디스크립터 ↔ linkedImages 매칭·크롭 베이크·동일 인덱스 치환(`applyPlacedImages`) |
| `src/render/svgGradient.mjs` | **(신규 A1)** 그라디언트 SVG defs 공통 헬퍼 — 래스터/미리보기 단일화(objectBoundingBox 정규화·flipY 반전) |
| `src/psd/reader.mjs` | PSD 파싱 → 레이어 분리(텍스트/래스터) |
| `src/psd/rasterizePsd.mjs` | 비텍스트 레이어 합성 → 배경 PNG |
| `src/raster/rasterize.mjs` | 하이브리드/flat-spine 비텍스트 → 300dpi PNG |
| `src/raster/cropArtwork.mjs` | **(신규 §13)** 전폭 PNG 수직 슬라이스 크롭 + 흰 배경 합성(불투명 — z-order 은폐 전제) |
| `src/preview/svg.mjs` | 변환 결과 → 미리보기 SVG |
| `scripts/indd-to-idml.jsx` | INDD → IDML(InDesign ExtendScript) |
| `scripts/convert-sample.mjs` | IDML 변환 CLI(요약 출력 + JSON 저장) |
| `scripts/render-preview.mjs` | 변환 결과 → SVG/PNG 렌더(검증) |
| `scripts/gen-psd-fixture.mjs` | 테스트용 PSD 픽스처 생성(ag-psd) |

### 10.2 검증

- **단위/불변식 테스트 139건 통과**(`pnpm --filter @storige/indesign-import test`, 의존성 0). 2026-06-12 보완 사이클에서 43→139 누적:
  - geometry units/matrix/regions/path + 변환기 좌표 규약 + `centerOrigin.test.mjs` 왕복 불변식 + `preview/renderInvariants.test.mjs`(실제 SVG 출력 좌표 region 정합 — 환산 제거 시 즉시 실패).
  - `convert/flatSpine.test.mjs` — flat-spine 3크롭 경계/합=전폭/앵커(43→54, `7585e38`).
  - `convert/textStyles.test.mjs` — per-run diff/지배값/행간·자간 환산(54→73, `8a23f93`).
  - `convert/gradientFill.test.mjs` + `idml/gradients.test.mjs` + `render/svgGradient.test.mjs` — 합성 IDML+300dpi 픽셀 샘플링 정합(73→102, `3639c8b`).
  - `convert/cornerStroke.test.mjs` — rx/ry 베이크·고아 strokeWidth·특수 스트로크 감지(102→119, `50dc6d7`).
  - `convert/placedImages.test.mjs` — 매칭/크롭 베이크/하위호환 바이트 동일(119→139, `e1fd2f2`).
- **연계 스위트**(2026-06-12 기준): canvas-core 275(metaCorruption 6 + history.meta 2 + pointerShift 20 + textStyles 패치 핀 포함) · api 99(conversionMode 검증 6 포함) · admin vitest 14(placedMatching 신설).
- **회귀 가드** — 각 기능 커밋마다 실 IDML 표본(MA/LA 계열) git worktree HEAD 대비 전수 diff 로 **회귀 0**(변경 키 외 좌표/치수/아트워크 래스터 바이트 동일) 확인 후 머지. 실측 정합 예: flat-spine 3크롭 합 5079px=전폭·spine 354px=3배폭·hasAlpha=false, LA-383 placed 좌표/크롭 0.01px 일치, 세로 오버플로 119.6%→97.4% 수렴.
- **E2E** — IDML 벡터/하이브리드 + PSD 단일페이지를 실제 브라우저 변환으로 확인. 2026-06-11 라이브: 편집기 재편집 렌더+저장+라운드트립(9cb8709f 74객체) 합격.
- **빌드** — admin/editor/canvas-core tsc + vite build 통과.

```bash
# 변환기 전체 테스트(의존성 설치 없이)
pnpm --filter @storige/indesign-import test
# 또는 직접:  node --test packages/indesign-import/src/**/*.test.mjs

# IDML 변환 CLI
node packages/indesign-import/scripts/convert-sample.mjs fixtures/cover-sample.idml
```

---

## 11. 로드맵 / 잔여 (CTO 방향 반영, 2026-06-09)

인쇄 출력 정합성 게이트 중심으로 재정의. ①(pdfOutputMode)·④(에셋 카테고리 큐레이션)은 별개 작업으로 배포 완료.

| 항목 | 상태 |
|------|------|
| **B. 상품별 색 처리 모드** — `TemplateSet.colorMode('rgb'\|'cmyk')` + admin Select | ✅ **데이터모델+admin 배포**(2026-06-09). ⏸ 워커 실제 색변환(GS `-sColorConversionStrategy`/ICC, `colors.ts` LCMS2)은 인쇄출력 영향 → 스테이징 후 적용 |
| **A. 텍스트 아웃라인 출력** — 아웃라인 자체는 이미 라이브(8fea0e8); **혼합폰트 per-run 충실도** 수정(opentype 글리프, NFD/NFC 매칭) | ✅ **배포**(merge `20ac84c`). 실주문 시각검증 중 |
| **C. 오버프린트/별색 보존** — GS pdfwrite `-dPreserveOverprintSettings/Separation/DeviceN`(보존 전용, 일반 PDF no-op). 진입점=고객 PDF | ✅ **배포**(워커). overprint 시뮬/녹아웃 평탄화는 ICC 필요 → 보류(env 게이트) |
| **D. 에디터 실로드 E2E** — 책등 가변 런타임 검증(`meta` 직렬화는 canvas.ts:151로 **해소됨**, 검증만) | ⏳ 수동 절차([`IDML_IMPORT_FLOW.md`](./IDML_IMPORT_FLOW.md) §2.2/§4) |
| **PNG 에셋 대비책** — ①변환 PNG `/storage/upload` 업로드(DB 비대화 해소) ✅ ②사진 프레임 inverted clipPath 마스킹(투명창에만 사진) ✅ | ✅ **배포**(PNG-1 admin / PNG-2 editor). 프레임 방향·재로드·인쇄 시각검증 중 |
| **AI(.ai) 임포트 정식화** — SVG export 우회 존재, 네이티브 파싱 비권장 | 보류(P2) |
| **PSD 벡터형(셰이프) 레이어 보존** — 선택 옵션 | 보류(P2) |
| **충실도 백로그 A1~A6**(2026-06-12 추가) — A1 그라디언트·A2+A3 텍스트·A5 placed·A6 코너/스트로크 | ✅ **배포**(`3639c8b`/`8a23f93`/`e1fd2f2`/`50dc6d7`). 상세 §3.6 |
| **텍스트 fill 그라디언트** — fabric 텍스트 그라디언트 매핑 | 보류(검정 대체+경고 유지 — A1 사이클에서 의도적 분리) |
| **A6 잔여**(비대칭 코너/dash/EndCap/EndJoin/StrokeAlignment 보정식) + **A4 잔여**(약물 회전·다열 세로) | 보류 — **실표본 0건 판정**(파싱+감지 경고만, 과잉 구현 금지). 표본 확보 시 재개 |

---

## 12. 재편집 정합성 사이클 (2026-06-11, 등록→재편집→저장 무결성)

가져온 템플릿을 다시 '편집'으로 열었을 때의 5종 결함 수정(서브에이전트 교차검증). 운영 흐름·재가져오기 안내는 [`IDML_IMPORT_FLOW.md`](./IDML_IMPORT_FLOW.md) §5b, 좌표 규약은 [`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md).

| # | 증상 | 근본원인 | 수정 |
|---|------|---------|------|
| ①② | 재편집 시 객체 투명/사라짐·배치붕괴 | `ServicePlugin.loadJSON` 이 `canvasData.width/height`(판형 메타)를 fabric 캔버스 px 치수로 덮어씀 → `skipOffscreen` 컬링. IDML 템플릿은 workspace 객체가 없어 `afterLoad` 치수복구도 누락 | loadJSON width/height strip + `WorkspacePlugin.afterLoad` workspace 복원 + `SpreadPlugin.afterLoad` 가이드 재렌더 (`527b85b`) |
| ③ | admin 미리보기 앞표지 패널 누락 | `a92f146` 중앙원점 전환이 `preview/svg.mjs` 누락 → scene 좌표를 content viewBox 에 보정 없이 그림 | `sceneToContent` 환산(`527b85b`) |
| ④ | 하이브리드 PNG 표지 좌우 뒤바뀜 | 동일하게 `raster/rasterize.mjs` 누락 | `sceneToContent` 환산(`527b85b`) |
| ⑤ | 배경 아트워크 이동·삭제됨 | 변환기가 `selectable:true` emit | `ARTWORK_LOCK`(§3.6) + `useTemplateSetSave` 직렬화 전체 보존(`527b85b`) |

**구조적 재발 차단**(`a64d409`): ③④ 의 원인은 ±half 변환이 4파일에 복붙돼 한 곳만 갱신을 빠뜨린 것 → `geometry/centerOrigin.mjs`(SSOT)로 단일화 + 불변식 테스트(§10.2)로 가드 + [`COORDINATE_SYSTEM.md`](COORDINATE_SYSTEM.md) 규약 동결.

**배포 함정 동반 수정**: `apps/admin/vercel.json` `ignoreCommand` 에 `packages/indesign-import` 가 빠져 있어 **변환기만 고치면 admin 재배포 스킵**(등록 하이브리드 `styles` 누락의 배포측 원인) → 추가(`527b85b`).

> ⚠️ 이미 등록된 깨진 템플릿(2026-06-11 이전 변환·또는 드래그 변위 저장)은 코드 수정으로 자동복원되지 않음 → **재가져오기** 필요. 신규 가져오기는 정상.

### 12.1 라이브 P1 3종 (2026-06-12, `e4eb328`/`a01f3f3`)

flat-spine 라이브 E2E 중 발견된 **기존 spread 플로우의 P1 결함 3종**(신규 코드와 무관). 가져온 템플릿의 재편집·책등 가변에 직결된다.

| # | 증상 | 근본원인 | 수정 |
|---|------|---------|------|
| P1-1 | 책등 가변 시 front 객체가 뒤표지로 텔레포트(재앵커 오염) | 편집기 훅(useSpreadAutoAnchor/MoveToCoverRegion)이 무인자 `getBoundingRect()`(**viewport 좌표, 줌 의존**)를 content 좌표 엔진 `resolveRegionRef` 에 전달 — fit-zoom(≈0.49)에서 front-cover textbox 가 back-cover 로 오판·재앵커. history lightState 의 `meta` 누락이 undo 재추가 경로의 오염 창구를 추가로 염 | `SpreadPlugin.resolveRegionMetaForObject` **공개 API 신설**(scene→content 캡슐화) — 두 훅 교체 + history lightState `meta`(regionRef/anchor) 보존 + `repositionObjects` 자가치유 가드(claimed region 과 실측 bbox **무교차** 시 meta 재유도 — 부분 겹침 정상 객체는 불간섭) (`e4eb328`) |
| P1-2 | `/embed?sessionId` 재편집 진입이 spine 10mm→0.55mm 재계산 + 무편집 자동저장으로 지오메트리 오염 | URL/props 에 주문 옵션이 없는 재편집 표준 경로에서 기본 pageCount 로 책등 재계산 → `resizeSpine` 이 복원 객체를 흔듦. 자동저장 게이트(`useAppStore.ready`)는 캔버스 등록 시점에 이미 true 라 무효 | spine 계산 입력값 복원 **우선순위 체인**: props/URL > 복원 `canvasData` 배열 실측(=[표지,...내지], 레거시 포함 — 내지 드리프트/뒷페이지 절단 방지) > `metadata.orderOptions` > `metadata.spine` 스냅샷(B38). 결과값(spineWidthMm)이 아닌 **계산 입력값**(pageCount/paperType/bindingType) 복원 — 동일 입력 재계산은 resizeSpine 동일폭 no-op. 자동저장 게이트를 `isInitializedRef`(복원 완료 시점)로 교체 (`e4eb328`) |
| P1-3 | 속성 패널 닫힌 상태에서 객체 더블클릭 시 객체가 -280px/zoom 수평 텔레포트(물리 이동 박제) | 1클릭의 선택→패널(ControlBar 280px) in-flow 마운트가 캔버스 요소를 밀고, 이 **레이아웃 시프트가 2클릭의 mousedown(기준점 캐시)~mousemove(calcOffset 재계산) 사이**에 떨어지면 fabric 이 포인터 점프를 드래그 변위로 해석(zoom 0.339 → -826.7px 실측, 라이브 4/4 재현). 이동 후 meta 재계산은 일관 동작이라 오염이 박제 — 2026-06-11 원 사고의 물리 이동 주범 | `PointerShiftGuardPlugin` 신설(canvas-core) — mouse:down 에서 포인터→scene 매핑(요소 오프셋+vpt) 스냅샷, `mouse:move:before`(_transformObject 선행)에서 매핑 변화 감지 시 진행 중 변환의 기준 좌표(offsetX/ex/ey)를 점프량만큼 보정. 요소 이동·vpt 패닝·줌 변경을 단일 보정식으로 흡수, 패널 열림 화면 보정 UX 보존. alt-팬 중 보정 스킵·멀티터치 비주 포인터 무시(적대 리뷰 반영). 전 캔버스 등록 (`a01f3f3`) |

> 테스트: canvas-core 243→263→275(metaCorruption 6 · history.meta 2 · pointerShift 20 — 실측 -700/-826.7px 재현 + 결함 대조군 + 보정 불변식).

---

## 13. 템플릿 유형 3종 — conversionMode (2026-06-12, `7585e38`)

표지 spread 템플릿을 **변환 방식 기준 3유형**으로 체계화했다. 모드별 동작 비교는 §3.5, admin UI 는 [`IDML_IMPORT_FLOW.md`](./IDML_IMPORT_FLOW.md) §3.

### 13.1 설계 결정

- **`spreadConfig.conversionMode` 스탬프**: `'full' | 'flat-spread' | 'flat-spine'`(`packages/types` `SpreadConversionMode`). 변환기가 vector→`full`, hybrid→`flat-spread`, flat-spine→`flat-spine` 으로 스탬프. **JSON 필드라 DB 마이그레이션 불필요, 레거시(미존재)=`full` 간주.**
- **z-order 은폐**(flat-spine): `spine-artwork`(책등 중심 기준 **3배폭** 크롭, 최하단) 위를 `back/front-artwork` 가 덮는 구조. 책등이 늘어나면 가려졌던 spine PNG 가 드러난다. 전제는 3장 모두 **흰 배경 합성 불투명**(`cropArtwork.mjs` — 투명이면 아래층 spine 크롭이 비쳐 이중상).
- **clipPath 절대 금지**: 직렬화 유실 함정([`reference_fabric_styles_trap`] 계열) — 크롭은 전부 **픽셀 베이크**로 해결(flat 3크롭·placed 이미지 공통 규약).
- **앵커 규약**: back/front-artwork 는 region anchor(`regionRef`+`xNorm`), **spine-artwork 는 canvas anchor**(content 중앙 규약 — `{kind:'canvas', x:halfW, y:halfH}` = scene (0,0)). left 는 가정값 0 이 아니라 **크롭 실제 중심에서 유도**(클램프/반올림 퇴화 케이스 자동 흡수).
- **`meta.flatArtwork('spine'|'back'|'front')`**: 런타임 재배치 분기 식별자 — `repositionObjects` 가 spine-artwork 를 **무이동·무스케일** 명시 가드.
- **크롭 지오메트리 단일 출처**: `computeFlatSpineCrops`(순수 함수) — 경계 px 는 누적 mm 를 **한 번씩만 반올림** → `back+spineBand+front === 전폭` 항상 성립. `rasterizeArtwork` 와 동일 공식이라 픽셀 불일치 시 명시 throw.

### 13.2 편집기/canvas-core 가드

- **flat-spread = 책등 고정**: `spineCalculator`(editor) 단일 가드가 재계산 자체를 정상 스킵 + `SpreadPlugin.resizeSpine` 방어적 no-op(이중 방어). 아트워크가 통짜 PNG 라 책등 가변 시 디자인이 찢어지기 때문.
- **flat-spine = 책등 가변 허용**: spine-artwork 만 불변(위 meta.flatArtwork 가드), back/front 는 region anchor 로 평행이동.

### 13.3 admin/API

- **admin 모드 3종 선택 UI**(`TemplateImport.tsx`): `벡터 (전체 편집형)` / `펼침면 플랫형 (책등 고정)` / `책등가변 3분할 플랫형`. flat-spine 은 spine/back/front 3장 dataURL 을 각각 `/storage` 업로드.
- **API 검증**(`templates.service.ts` `validateAndNormalizeSpreadConfig`): conversionMode 화이트리스트 검증 + `flat-spine` 은 `back-cover/spine/front-cover` regions 필수(변환기 `kind`/편집기 `position` 키 둘 다 허용). **update 시 conversionMode 보존 병합**(수신 spreadConfig 에 누락 시 기존 값 유지 — `'full'` 강등으로 flat 아트워크 분기가 붕괴하는 라운드트립 유실 차단). `TemplateEditorView` 저장 시에도 보존.

### 13.4 함정(재발 주의)

| 함정 | 내용 |
|------|------|
| 투명 크롭 | flat-spine 크롭을 투명 PNG 로 만들면 z-order 은폐가 깨져 이중상 — 흰 배경 합성 필수(vector/hybrid 의 투명 PNG 동작은 불변) |
| clipPath 유혹 | 크롭을 clipPath 로 처리하면 저장 라운드트립에서 유실 — 픽셀 베이크만 허용 |
| spine left=0 가정 | 대칭 레이아웃에선 scene x≈0 이지만 클램프/roundMm01 오프셋 퇴화 케이스가 있어 **크롭 실제 중심(centerPx)에서 유도** |
| conversionMode 유실 | 클라이언트가 spreadConfig 를 재구성해 PATCH 하면 conversionMode 가 빠질 수 있음 — 서버측 보존 병합이 최후 방어(§13.3) |
| 경계 반올림 드리프트 | 크롭 경계를 각자 반올림하면 3분할 합≠전폭 — 누적 mm 1회 반올림 규약(§13.1) |

---

> 작성: 2026-06-09 · 갱신: 2026-06-12(§2/3.5/3.6/3.7/10/11 + §12.1 P1 3종 + §13 템플릿 유형 3종 — 커밋 `7585e38`/`e4eb328`/`a01f3f3`/`8a23f93`/`3639c8b`/`50dc6d7`/`e1fd2f2`). 코드 기준 검증(`packages/indesign-import/src/`, `apps/admin/src/pages/Templates/TemplateImport.tsx`, `TemplateSets/TemplateSetForm.tsx`, `packages/types/src/index.ts`, `apps/api/src/templates/templates.service.ts`).
