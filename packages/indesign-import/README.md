# @storige/indesign-import

디자인 소스(InDesign **IDML**, Photoshop **PSD**)를 Storige 템플릿으로 변환하는 모듈. 결과는 SVG 파일이 아니라 **Fabric.js 캔버스 객체(CanvasData) + (표지면) SpreadConfig** 를 담은 DraftTemplateDto. **브라우저(admin)와 Node 양쪽에서 동작**한다.

> 종합 개발 문서: [`../../docs/DESIGN_IMPORT_CONVERTER.md`](../../docs/DESIGN_IMPORT_CONVERTER.md) (`.html` 시각화 포함).

| 입력 | 결과 Template | spreadConfig | 용도 |
|------|----------------|--------------|------|
| **IDML** (표지 펼침면) | `type='spread'` | 있음(5영역) | 책 표지(앞/뒤/책등/날개) · 책등 가변 |
| **PSD** (단품) | `type='page'` / `'cover'` | 없음(단일 페이지) | 명함 · 내지 단품 |

## 왜 IDML/PSD 인가
`.indd` 는 독점 바이너리 → Node 단독 파싱 불가. `.idml` 은 ZIP+XML 공개사양이라 추가 라이선스 없이 파싱 가능. INDD 는 `scripts/indd-to-idml.jsx`(InDesign ExtendScript)로 IDML 변환 후 입력하는 **옵션 경로**. PSD 는 `@webtoon/psd` 로 레이어 트리 파싱.

## 공개 API (`src/index.mjs`)
```js
import { convertIdmlToTemplate, convertPsdToTemplate } from '@storige/indesign-import';

// IDML → 표지 펼침면(벡터/하이브리드)
const { result, dto, previewSvg } = await convertIdmlToTemplate(buffer, {
  mode: 'vector',   // 'vector'(기본, 정밀 편집) | 'hybrid'(텍스트만 편집 + 비텍스트 300dpi PNG 1장)
  dpi: 150, rasterDpi: 300, previewWidth: 1100,
});

// PSD → 단일 페이지(명함/내지 단품)
const { result, dto, previewSvg } = await convertPsdToTemplate(buffer, {
  pageType: 'page', // 'page'(기본) | 'cover'
  previewWidth: 1100,
});
```

## 설계 핵심 (코드 근거)
- **저장 계약**: `Template` + `canvasData`(Fabric 객체배열) + (표지면) `spreadConfig.spec`. DB 직접쓰기 없이 `CreateTemplateDto` JSON 생성 → admin 검수 → 기존 `POST /templates`.
- **단위/좌표**: IDML pt(1/72in) → mm → workspace px(DPI 150). PSD px → mm(소스 DPI) → px(DPI 150). `src/geometry/units.mjs`(canvas-core `math.ts` 와 동일 상수).
- **표지 5영역**: `back-wing, back-cover, spine, front-cover, front-wing`(좌→우). `src/geometry/regions.mjs`(canvas-core `SpreadLayoutEngine` 규약). 총폭 = wing×2 + cover×2 + spine.
- **z-순서 보존**: IDML 은 `preserveOrder` 파서로 문서 순서대로, PSD 는 `@webtoon/psd` children(위→아래)을 뒤집어 bottom→top.
- **책등 가변**: 책등폭은 템플릿 고정값이 아니라 런타임 파생값(`(pageCount/2)×두께 + 제본여유분`). 권위검증 `validateSpreadAgainstAuthority` 는 cover/wing 4필드만 비교 → 원본 책등은 버리고 cover/wing 만 권위 추출하면 자동 가변화.

### IDML(벡터/하이브리드)
- 도형/텍스트 벡터 추출, 책등 세로쓰기(angle 90°), 줄바꿈(Br) 보존, 폴리곤 베지어 경로 복원, CMYK 원본 `cmykFill` 보존, 컴파운드 패스 even-odd, 별색(Spot) 감지·경고, 풀블리드 커버리지 경고.
- **벡터**: 모든 객체 편집 가능 벡터. **하이브리드**: 텍스트만 편집 + 비텍스트는 300dpi PNG 1장(최하단).

### PSD(단품)
- **텍스트 레이어 → 편집 가능 textbox**(내용 + 근사 폰트/크기/색, 관리자 확정 전제).
- **비텍스트 레이어 → '추출 텍스트 제외' 합성 300dpi급 배경 PNG 1장**. ⚠️ 텍스트 이중 렌더 방지 위해 텍스트 레이어는 배경에서 반드시 제외.
- px→mm 는 `resolutionInfo` DPI. 출력 = 단일 페이지 Template(spreadConfig 없음).

## ⚠️ 구현 시 보정 필수 (적대검증 발견)
객체 `meta`(regionRef/anchor)가 런타임 `resizeSpine` 재배치의 유일한 입력인데, 표준 단일 Template 저장경로(`ServicePlugin.saveJSON`→`toJSON(extendFabricOption)`)의 화이트리스트(`canvas.ts`)에 **`meta` 가 없다**(`useTemplateSetSave` 만 포함). → 변환 산출 `canvasData` 에 `meta` 를 넣어도 라운드트립에서 탈락해 책등 가변이 깨질 수 있음. **보완**: 저장 화이트리스트에 `'meta'` 추가, 또는 `spreadConfig.regions` 기반 on-load regionRef 재계산.

## 구조
```
src/
  index.mjs / index.d.mts  공개 API(convertIdmlToTemplate / convertPsdToTemplate)
  geometry/
    units.mjs     pt/mm/px 변환 (DPI 150)
    matrix.mjs    ItemTransform 아핀행렬 합성/적용/분해
    regions.mjs   5영역 분할 + resolveRegionAtX + 정규화 앵커
    path.mjs      PathGeometry → SVG/Fabric path 'd' 복원(베지어)
    *.test.mjs    node:test (의존성 0)
  idml/reader.mjs              IDML ZIP+XML 파싱 → IdmlDoc
  convert/toSpreadTemplate.mjs IdmlDoc → 표지 펼침면 DTO
  convert/toSinglePageTemplate.mjs  PSD → 단일 페이지 DTO
  psd/reader.mjs              PSD 파싱 → 레이어 분리(텍스트/래스터)
  psd/rasterizePsd.mjs        비텍스트 레이어 합성 → 배경 PNG
  raster/rasterize.mjs        하이브리드 비텍스트 → 300dpi PNG
  preview/svg.mjs             변환 결과 → 미리보기 SVG
scripts/
  indd-to-idml.jsx   INDD→IDML (InDesign ExtendScript)
  convert-sample.mjs IDML 변환 CLI(요약 + JSON 저장)
  render-preview.mjs 변환 결과 → SVG/PNG 렌더(검증)
  gen-psd-fixture.mjs 테스트용 PSD 픽스처 생성(ag-psd)
fixtures/            IDML/PSD 샘플 + 변환 산출물
```

## 의존성
`jszip`(IDML 언집), `fast-xml-parser`(XML), `@webtoon/psd`(PSD), `sharp`(Node 래스터화·선택), `ag-psd`(devDep, PSD 픽스처).

## 테스트
```bash
# 의존성 설치 없이 즉시 실행 (node 내장 테스트 러너)
node --test src/geometry/units.test.mjs \
            src/geometry/matrix.test.mjs \
            src/geometry/regions.test.mjs \
            src/geometry/path.test.mjs

# IDML 변환 CLI
node scripts/convert-sample.mjs fixtures/cover-sample.idml
```

## 관리자 등록 (admin `/templates/import`)
불러오기 → 변환(브라우저) → 미리보기·경고 검수 → 등록. IDML 표지는 (a) 표지 단품 또는 (b) **책등 가변 셋으로 이어서 등록(방법 A)**: 표지 Template 생성 후 `/template-sets/new` 로 `seedTemplateId` 인계 → `TemplateSetForm` 이 책모드/판형/표지 자동 설정, 관리자는 내지·페이지수만 추가. PSD 는 단일 페이지 Template 등록 → 편집기에서 텍스트 폰트/크기/효과 확정.
