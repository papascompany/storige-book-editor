# @storige/indesign-import

InDesign(IDML) 표지 펼침면을 Storige 템플릿(`Template type='spread'` + `canvasData` + `spreadConfig`)으로 변환하는 모듈. **표지 펼침면** · **책등 가변** 두 종류 대상.

> 상태: **Phase 0 PoC**. 현재는 포맷 독립적인 코어(행렬/단위/영역) + 테스트와 INDD→IDML 어댑터까지 구현됨. IDML 파서·객체 매핑은 실제 샘플 확보 후 Phase 1에서.

## 왜 IDML 인가
`.indd` 는 독점 바이너리 → Node 단독 파싱 불가. `.idml` 은 ZIP+XML 공개사양이라 추가 라이선스 없이 파싱 가능. INDD 는 `scripts/indd-to-idml.jsx`(InDesign ExtendScript)로 IDML 변환 후 입력하는 **옵션 경로**로 지원.

## 설계 핵심 (코드 근거)
- **저장 계약**: `Template(type='spread')` + `canvasData`(Fabric 객체배열) + `spreadConfig.spec`. DB 직접쓰기 없이 `CreateTemplateDto` JSON 생성 → admin 검수 → 기존 `POST /templates`.
- **단위/좌표**: IDML pt(1/72in) → mm → workspace px(DPI 150). `src/geometry/units.mjs` (canvas-core `math.ts` 와 동일 상수).
- **표지 5영역**: `back-wing, back-cover, spine, front-cover, front-wing` (좌→우). `src/geometry/regions.mjs` (canvas-core `SpreadLayoutEngine` 규약). 총폭 = wing×2 + cover×2 + spine.
- **책등 가변**: 책등폭은 템플릿 고정값이 아니라 런타임 파생값(`(pageCount/2)×두께+여유분`). 권위검증 `validateSpreadAgainstAuthority` 는 cover/wing 4필드만 비교 → 원본 책등은 버리고 cover/wing 만 권위 추출하면 자동 가변화.

## ⚠️ 구현 시 보정 필수 (적대검증 발견)
객체 `meta`(regionRef/anchor)가 런타임 `resizeSpine` 재배치의 유일한 입력인데, 표준 단일 Template 저장경로(`ServicePlugin.saveJSON`→`toJSON(extendFabricOption)`)의 화이트리스트(`canvas.ts`)에 **`meta` 가 없다**(`useTemplateSetSave` 만 포함). → 변환 산출 `canvasData` 에 `meta` 를 넣어도 라운드트립에서 탈락해 책등 가변이 깨질 수 있음. **보완**: 저장 화이트리스트에 `'meta'` 추가, 또는 `spreadConfig.regions` 기반 on-load regionRef 재계산.

## 구조
```
src/geometry/
  units.mjs     pt/mm/px 변환 (DPI 150)
  matrix.mjs    ItemTransform 아핀행렬 합성/적용/분해
  regions.mjs   5영역 분할 + resolveRegionAtX + 정규화 앵커
  *.test.mjs    node:test (의존성 0)
scripts/indd-to-idml.jsx   INDD→IDML (InDesign ExtendScript)
fixtures/                   실제 IDML 샘플 투입 위치
```

## 테스트
```bash
# 의존성 설치 없이 즉시 실행 (node 내장 테스트 러너)
node --test packages/indesign-import/src/geometry/units.test.mjs \
            packages/indesign-import/src/geometry/matrix.test.mjs \
            packages/indesign-import/src/geometry/regions.test.mjs
```

## Phase 1 이후 추가 예정
- 의존성: `jszip`(언집), `xml2js`(XML 파싱), `@storige/types`(타입)
- `src/idml/reader` (Spread/Story/Resources 파싱), `src/convert/toCanvasData` (객체 매핑)
- apps/worker import 잡 + apps/admin "IDML 가져오기" 검수 UI
