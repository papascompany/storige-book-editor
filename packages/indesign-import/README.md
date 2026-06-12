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
import { convertIdmlToTemplate, convertPsdToTemplate, extractDesignPackage } from '@storige/indesign-import';

// IDML → 표지 펼침면(모드 3종 — spreadConfig.conversionMode 와 1:1)
const { result, dto, previewSvg } = await convertIdmlToTemplate(buffer, {
  mode: 'vector',      // 'vector'(기본, 정밀 편집 → conversionMode 'full')
                       // | 'hybrid'(텍스트만 편집 + 비텍스트 300dpi PNG 1장 → 'flat-spread', 책등 고정)
                       // | 'flat-spine'(전폭 1회 렌더 후 back/spine 3배폭/front 3크롭·흰배경 합성 → 'flat-spine', 책등 가변)
  dpi: 150, rasterDpi: 300, previewWidth: 1100,
  linkedImages,        // (선택, A5) 파일명→dataURL Map/객체 — placed 이미지 프레임 실복원
                       // (NFC 정규화+대소문자 무시 매칭, 미제공/미매칭 시 기존 플레이스홀더+경고 바이트 동일)
});

// PSD → 단일 페이지(명함/내지 단품)
const { result, dto, previewSvg } = await convertPsdToTemplate(buffer, {
  pageType: 'page', // 'page'(기본) | 'cover'
  previewWidth: 1100,
});

// 패키지 zip(*.idml + 링크 이미지) 해제 — admin 단일 업로드용 (A5)
const { kind, idmlBuffer, linkedImages, skipped } = await extractDesignPackage(buffer);
// 판별: *.idml 엔트리 우선 → 루트 designmap.xml=순수 IDML. 중첩 designmap 만 있으면 명시 에러.
// TIFF/EPS/PDF 등 브라우저 미디코드 형식은 skipped 로 보고.
```

## 설계 핵심 (코드 근거)
- **저장 계약**: `Template` + `canvasData`(Fabric 객체배열) + (표지면) `spreadConfig.spec`. DB 직접쓰기 없이 `CreateTemplateDto` JSON 생성 → admin 검수 → 기존 `POST /templates`.
- **단위/좌표**: IDML pt(1/72in) → mm → workspace px(DPI 150). PSD px → mm(소스 DPI) → px(DPI 150). `src/geometry/units.mjs`(canvas-core `math.ts` 와 동일 상수).
- **표지 5영역**: `back-wing, back-cover, spine, front-cover, front-wing`(좌→우). `src/geometry/regions.mjs`(canvas-core `SpreadLayoutEngine` 규약). 총폭 = wing×2 + cover×2 + spine.
- **z-순서 보존**: IDML 은 `preserveOrder` 파서로 문서 순서대로, PSD 는 `@webtoon/psd` children(위→아래)을 뒤집어 bottom→top.
- **책등 가변**: 책등폭은 템플릿 고정값이 아니라 런타임 파생값(`(pageCount/2)×두께 + 제본여유분`). 권위검증 `validateSpreadAgainstAuthority` 는 cover/wing 4필드만 비교 → 원본 책등은 버리고 cover/wing 만 권위 추출하면 자동 가변화.
- **conversionMode 스탬프**: 변환기가 `spreadConfig.conversionMode`(`full`/`flat-spread`/`flat-spine`)를 기록 — JSON 필드라 마이그레이션 불필요, 레거시(미존재)=`full`. 편집기/canvas-core 가 책등 가변 허용(`flat-spread` 차단)과 flat 아트워크 재배치(`meta.flatArtwork='spine'` 무이동·무스케일)에 사용.

### IDML(모드 3종)
- 도형/텍스트 벡터 추출, 책등 세로쓰기(angle 90°), 줄바꿈(Br) 보존, 폴리곤 베지어 경로 복원, CMYK 원본 `cmykFill` 보존, 컴파운드 패스 even-odd, 별색(Spot) 감지·경고, 풀블리드 커버리지 경고.
- **벡터(`full`)**: 모든 객체 편집 가능 벡터. **하이브리드(`flat-spread`)**: 텍스트만 편집 + 비텍스트 300dpi PNG 1장(최하단, 책등 고정). **flat-spine**: 3크롭 PNG(spine 3배폭 최하단 → back/front 가 불투명 은폐, 책등 가변 추종 — clipPath 금지, 흰 배경 합성 필수).
- **텍스트 충실도(A2+A3)**: per-run `styles`(객체 base 와 다른 속성만 diff), `charSpacing`=Tracking 1:1, `lineHeight`=Leading/(1.13×pt)(auto=120%), `textAlign`, FontStyle명→`fontWeight`, 세로짜기 자간→lineHeight 환산. 혼합/장평은 지배값 근사+경고.
- **그라디언트 fill(A1)**: fabric Gradient plain object(`gradientUnits:'pixels'`) — 끝점 E 를 inner pt 공간에서 합성 후 S 와 동일 SSOT 매퍼로 사상(회전/플립/스케일 자동 정합). FLAT 경로는 `render/svgGradient.mjs` 공통 defs. 텍스트 그라디언트는 검정 대체+경고(보류).
- **정밀도(A6)**: Rectangle 균일 RoundedCorner→rx/ry(|scale| 베이크·비클램프 pill 보존), 고아 strokeWidth 제거, 특수 선/끝모양/접합/선정렬은 감지 경고만(실표본 0건 보류).
- **placed 이미지(A5)**: 배치 SSOT=inner Image ItemTransform. `linkedImages` 매칭 시 프레임 가시영역 **크롭 베이크**(plain image, cropX/clipPath 불사용) — FULL=편집 가능 이미지, FLAT=래스터에 베이크. 미매칭은 '동반 업로드 매칭 실패' 구분 경고.

### PSD(단품)
- **텍스트 레이어 → 편집 가능 textbox**(내용 + 근사 폰트/크기/색, 관리자 확정 전제).
- **비텍스트 레이어 → '추출 텍스트 제외' 합성 300dpi급 배경 PNG 1장**. ⚠️ 텍스트 이중 렌더 방지 위해 텍스트 레이어는 배경에서 반드시 제외.
- px→mm 는 `resolutionInfo` DPI. 출력 = 단일 페이지 Template(spreadConfig 없음).

## meta 직렬화 (해소됨)
객체 `meta`(regionRef/anchor — flat 아트워크는 `flatArtwork` 포함)가 런타임 `resizeSpine` 재배치의 유일한 입력. 과거에는 표준 저장경로 화이트리스트에 `meta` 가 없어 라운드트립 탈락 위험이 있었으나, **canvas-core `canvas.ts` `extendFabricOption` 에 `'meta'` 가 포함되어 해소됨**(history lightState 도 meta 보존 — `e4eb328`). 변환 산출 `canvasData` 의 meta 는 저장/undo 왕복에서 유지된다.

## 구조
```
src/
  index.mjs / index.d.mts  공개 API(convertIdmlToTemplate / convertPsdToTemplate / extractDesignPackage)
  geometry/
    units.mjs        pt/mm/px 변환 (DPI 150)
    matrix.mjs       ItemTransform 아핀행렬 합성/적용/분해
    regions.mjs      5영역 분할 + resolveRegionAtX + 정규화 앵커
    path.mjs         PathGeometry → SVG/Fabric path 'd' 복원(베지어)
    centerOrigin.mjs content↔scene(중앙원점) 변환 SSOT — 변환기·미리보기·래스터 공용
    *.test.mjs       node:test (의존성 0)
  idml/reader.mjs              IDML ZIP+XML 파싱 → IdmlDoc (per-run 스타일/그라디언트/코너·스트로크/placed 메타 보존)
  convert/toSpreadTemplate.mjs IdmlDoc → 표지 펼침면 DTO
  convert/textStyles.mjs       per-run → fabric 5.5 매핑 SSOT(styles diff/lineHeight/charSpacing/textAlign/fontWeight)
  convert/gradientFill.mjs     IDML 그라디언트 → fabric Gradient plain object(inner 공간 E 합성)
  convert/flatSpineGeometry.mjs flat-spine 3크롭 경계 순수 함수(computeFlatSpineCrops)
  convert/placedImages.mjs     placed 디스크립터 ↔ linkedImages 매칭·크롭 베이크(applyPlacedImages)
  convert/artworkLock.mjs      플랫 배경 아트워크 고정 잠금(ARTWORK_LOCK) — IDML/PSD 공용
  convert/toSinglePageTemplate.mjs  PSD → 단일 페이지 DTO
  render/svgGradient.mjs      그라디언트 SVG defs 공통 헬퍼(래스터/미리보기 단일화)
  psd/reader.mjs              PSD 파싱 → 레이어 분리(텍스트/래스터)
  psd/rasterizePsd.mjs        비텍스트 레이어 합성 → 배경 PNG
  raster/rasterize.mjs        하이브리드/flat-spine 비텍스트 → 300dpi PNG
  raster/cropArtwork.mjs      전폭 PNG 수직 크롭 + 흰 배경 합성(flat-spine 불투명 전제)
  preview/svg.mjs             변환 결과 → 미리보기 SVG
  preview/renderInvariants.test.mjs  실제 SVG 출력 좌표 region 정합 가드
scripts/
  indd-to-idml.jsx   INDD→IDML (InDesign ExtendScript)
  convert-sample.mjs IDML 변환 CLI(요약 + JSON 저장)
  render-preview.mjs 변환 결과 → SVG/PNG 렌더(검증)
  gen-psd-fixture.mjs 테스트용 PSD 픽스처 생성(ag-psd)
fixtures/            IDML/PSD 샘플 + 변환 산출물
```

## 의존성
`jszip`(IDML 언집), `fast-xml-parser`(XML), `@webtoon/psd`(PSD), `sharp`(Node 래스터화·선택), `ag-psd`(devDep, PSD 픽스처).

## 테스트 (139건, 2026-06-12)
```bash
# 의존성 설치 없이 즉시 실행 (node 내장 테스트 러너, 전체 139건)
pnpm --filter @storige/indesign-import test
# 또는:  node --test src/**/*.test.mjs

# IDML 변환 CLI
node scripts/convert-sample.mjs fixtures/cover-sample.idml
```

## 관리자 등록 (admin `/templates/import`)
불러오기 → 변환(브라우저, **모드 3종**: 벡터 (전체 편집형) / 펼침면 플랫형 (책등 고정) / 책등가변 3분할 플랫형) → 미리보기·경고 검수 → 등록. **placed 이미지 동반 업로드**: `.idml`+이미지 다중 / 패키지 zip / 이미지 추가 업로드(병합 재변환) — 매칭 ✓/✗ 요약 표시(`placedMatching.ts`). IDML 표지는 (a) 표지 단품 또는 (b) **책등 가변 셋으로 이어서 등록(방법 A)**: 표지 Template 생성 후 `/template-sets/new` 로 `seedTemplateId` 인계 → `TemplateSetForm` 이 책모드/판형/표지 자동 설정, 관리자는 내지·페이지수만 추가. PSD 는 단일 페이지 Template 등록 → 편집기에서 텍스트 폰트/크기/효과 확정.
