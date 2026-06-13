# fabric 5.5.2 → 7.x / jspdf 2.5.x → 3.x 마이그레이션 스파이크

작성일: 2026-06-13
배경: 보안 감사 **DEP-7** — fabric `<7.2.0` Stored XSS via SVG Export (**CVE-2026-27013**).
수정판은 fabric **7.2.0** 뿐이라 패치만으로는 해소 불가. 단, canvas-core 가 fabric 5.x 의
내부 동작에 의존하는 **몽키패치 2종**을 부착해 즉시 메이저 범프가 불가능 → 본 스파이크로
공수/리스크를 산정하고 "즉시 완화로 충분한가 vs 마이그레이션 필수 시점"을 권고한다.

> **결론 선요약**: 라이브 DOM 에 export/변환 SVG 가 주입되는 **유일한 실효 XSS 경로**
> (admin TemplateImport 미리보기)는 본 사이클에서 **새니타이즈로 차단 완료**. 그 외 경로
> (svg2pdf→PDF, `<img src=blob:svg>`)는 스크립트 비실행이라 실효 XSS 없음.
> 따라서 **fabric 7 메이저 마이그레이션은 보안상 즉시 필요 없음(완화로 충분)**.
> 마이그레이션은 기술부채/유지보수 관점의 **계획된 별도 스프린트**로 권고(M~L, 리스크 中~高).

---

## 1. 현재 버전 실측

| 패키지 | package.json | 설치본(lockfile) | 비고 |
|--------|-------------|------------------|------|
| fabric | `^5.5.2` | **5.5.2** | canvas-core + apps/editor 양쪽 |
| jspdf | `^2.5.1` | **2.5.2** | canvas-core (PDF export) |
| svg2pdf.js | `^2.2.4` | **2.6.0** | canvas-core (SVG→PDF) |

설치 환경: pnpm 모노레포, Node(현 빌드 통과). fabric 5.5.2 는 CJS(`fabric.js`) 번들.

---

## 2. DEP-7 XSS 실효성 판정 (본 사이클 조사 결과)

### 2.1 SVG **출력**(export) 경로 전수 — canvas-core
- `ServicePlugin.toSVG` (~974 / cutSvg 1499 / effectSvg 1662): `canvas.toSVG()` →
  `DOMParser` → `_removeSvgBackground`/`_cleanSvg`/`_processSvgImages` → **svg2pdf → PDF**.
  - svg2pdf 는 SVG 를 **PDF 벡터 명령으로 변환**할 뿐 DOM 에 렌더하지 않는다 → `<script>`/`on*`
    **미실행**. `_svgToImageFallback`(2638~) 도 `new Blob([svg]) → URL → img.src` 인데,
    브라우저는 **`<img>`/CSS 배경으로 로드된 SVG 의 스크립팅을 비활성화**한다(표준).
  - ⟹ **이 경로들은 실효 XSS 없음**(안전). 단 `_cleanSvg` 는 빈 `<g>` 정리만 하고
    script/on* 을 제거하지 않으므로 "방어"는 svg2pdf/`<img>` 의 비실행 성질에만 의존.
- `FontPlugin` `textObj.toSVG()` → `svgTextToPath`(opentype 아웃라인) → 다시 fabric 로드.
  DOM 라이브 주입 없음 → 안전.

### 2.2 SVG **import**(외부 SVG 로드) 경로
- `loadSVGFromURL/String`(utils/canvas.ts, factory.ts, AccessoryPlugin, CopyPlugin,
  TemplatePlugin, HistoryPlugin) + 편집기 SVG 업로드(`useImageStore` → `core.loadSVGFromURL`).
  - fabric `loadSVGFrom*` 은 SVG 를 **fabric 객체로 파싱**(스크립트/이벤트 핸들러는 객체
    속성으로 보존되지 않음). 재-export 시 fabric 이 자기 객체 모델만 다시 직렬화하므로
    `onload`/`<script>` 가 export 로 **재출현하는 경로는 발견되지 않음**.

### 2.3 라이브 DOM 주입 싱크 전수 (실효 XSS 가 가능한 유일 지점)
- `apps/admin/.../TemplateImport.tsx:608` —
  **`dangerouslySetInnerHTML={{ __html: previewSvg }}`** (코드베이스 내 유일).
  - `previewSvg` = `@storige/indesign-import` `buildPreviewSvg(dto)` 출력.
  - `dto` 는 **신뢰할 수 없는 업로드 IDML/PSD** 변환 결과.
  - `buildPreviewSvg` 는 텍스트 본문(`esc`)·region 라벨만 이스케이프했고,
    `<image href>`/`fill`/`stroke`/`<path d>`/`rx` **속성값은 미이스케이프**였다 →
    속성 따옴표 탈출로 `on*`/`<script>` 주입 가능(이론상). ⟹ **실효 XSS 면**.

> **판정**: DEP-7 의 "fabric SVG export XSS" 가 본 코드베이스에서 직접 터지는 fabric 경로는
> 없으나(=svg2pdf/`<img>` 차단), **변환기 미리보기의 dangerouslySetInnerHTML 가 동급의
> Stored/Reflected XSS 면**으로 존재. 같은 위험등급이므로 동일 완화 대상으로 처리.

---

## 3. 본 사이클 완화 (적용 완료)

2계층 방어(입력 경계 하드닝 + 렌더 경계 새니타이즈):

1. **렌더 경계(주 방어선)** — `apps/admin/src/utils/sanitizeSvg.ts` 신설.
   - 의존성 없는 화이트리스트 새니타이저. `DOMParser('image/svg+xml')` 로 파싱 →
     비허용 요소 제거(`<script>`/`<foreignObject>`/`<iframe>` 등) + `on*`/`style` 속성 제거 +
     `href`/`xlink:href` 안전스킴(`data:image/*`·`http(s)`·`#`·`/`)만 허용(제어문자 우회 차단).
   - DOMPurify(~45KB) 미채택 근거: 입력이 **우리가 생성한 SVG**(요소/속성 집합이 좁고 알려짐)라
     명시적 화이트리스트로 충분 + admin 번들 경량 유지. (필요 시 DOMPurify 로 교체 용이.)
   - `TemplateImport.tsx`: `useMemo(()=>sanitizeSvgMarkup(previewSvg))` 후 그 값을
     `dangerouslySetInnerHTML` 에 주입.
2. **입력 경계(심층 방어)** — `packages/indesign-import/src/preview/svg.mjs`.
   - `escAttr`(따옴표/꺾쇠/앰퍼샌드 엔티티화) + `safeHref`(위험 스킴 폴백) 추가,
     `<image href>`·`fill`(raw/gradient ref)·`stroke`·`<path d>`·text `fill` 전체 적용.
   - 정상 도형/이미지/텍스트/그라디언트 출력은 **바이트 보존**(render invariants 테스트 통과).

검증: admin 40 tests(신규 sanitize 14 포함) / indesign-import 142 / canvas-core 306 / editor 114
**전부 통과**, admin·editor **빌드 성공**. 정상 SVG 왕복 스모크 + 악성 2계층 무력화 E2E 통과.

---

## 4. fabric 5.5.2 → 7.x Breaking Changes

### 4.1 패키지/런타임 형태
- fabric 7.2.0 = **ESM 전용**(`module: ./dist/index.mjs`, CJS `main` 미제공), **Node >=20** 요구.
  - 영향: canvas-core 빌드(tsc)·Vitest(canvas-core `node` env)·worker(있다면)·SSR 경로가
    ESM 임포트로 통일돼야 함. Vite(editor/admin) 는 ESM 친화라 영향 적음.
- 임포트 형태 변경: `import { fabric } from 'fabric'`(5.x 네임스페이스) → fabric 6/7 은
  **named export**(`import { Canvas, Textbox, ... } from 'fabric'`). 코드베이스 영향 큼:
  - `from 'fabric'` 임포트 **47곳**, `new fabric.*` **106곳**, `fabric.util.*` **36곳**.
  - 전수 치환 필요(자동 codemod 일부 가능하나 `fabric.util`·`fabric.Object` 정적 참조는 수동 검수).

### 4.2 좌표/오리진/이벤트
- v6 부터 `originX/originY` 기본·`object stacking`·`setCoords` 시맨틱·이벤트 페이로드 변경.
  - `originX/originY` 사용 **246곳** → 중앙원점 규약([reference_coordinate_convention])과
    교차검증 필수(편집기/PDF/반응형 정합 회귀 위험 **높음**).
- 이벤트명/구조 변경(`mouse:*` 페이로드, `selection:*`). 플러그인(Controls/Ruler/History/
  Spread/Service)이 이벤트 핸들러 다수 → 재검증 대상.

### 4.3 Object API / 직렬화
- `toObject`/`toJSON`/`fromObject` 시그니처·기본 포함 prop 변경.
  - `loadFromJSON` **47곳**, `toObject/toJSON` **20곳**, `fromObject` **5곳**.
  - ⚠️ **저장 호환성**: DB 의 기존 세션 JSON(5.x `toObject` 산출)이 7.x `fromObject` 로
    무손실 로드되는지 **데이터 마이그레이션 검증 필수**(인쇄물 직결). 가장 큰 회귀 리스크.
- SVG export/import 내부 구현 전면 개편(7.x). 본 코드의 `_cleanSvg`/svg2pdf 파이프라인은
  SVG **문자열** 기준이라 영향은 제한적이나, `toSVG` 옵션/출력 마크업 차이 회귀 점검 필요.

### 4.4 타입
- fabric 6/7 은 **자체 타입 번들**(`@types/fabric` 불필요/충돌). 현 코드의 `as any`
  우회(예: textStyles 의 `util.object.clone` 1-인자, `canvas.toSVG(... as any)`)는
  새 타입에서 재정의 필요. TS 컴파일 에러 다수 예상(중간 규모 수작업).

---

## 5. 몽키패치 2종의 7.x 대체 가능성 (dist 실측)

### 5.1 `stylesToArray` 갭라인 병합 버그 패치 (`utils/textStyles.ts`)
- 5.5.2 결함: 무스타일 라인 스킵 분기에서 `prevStyle` 미리셋 → 동일스타일 끼인 라인 오염.
- **fabric 7.2.0 dist 실측**(`unpkg fabric@7.2.0/dist/index.mjs` L10388-10390):
  스킵 분기가 `// ...and reset prevStyle` 주석과 함께 **`prevStyle = {};` 를 포함** →
  우리 패치와 **동일한 수정이 상류에 반영됨**.
  - ⟹ **마이그레이션 시 이 패치는 제거 가능(obsolete).** 회귀 가드 `textStyles.test.ts` 는
    "패치 부착" 전제이므로 7.x 전환 시 테스트도 상류 동작 기준으로 갱신.

### 5.2 textbox `styles` 누락 방어 (`ensureTextStyles`, [reference_fabric_styles_trap])
- 5.5.2: `styles` 키 부재 시 `stylesFromArray(undefined)` 전파 → 저장(`stylesToArray`) 크래시.
- 7.x 는 styles 표현/기본값 처리가 개편됨. `ensureTextStyles`(loadFromJSON 직후/toJSON/
  saveJSON 전 3중 보정)는 **방어적 코드**라 7.x 에서도 무해하게 유지 가능하나, 7.x 에서
  동일 크래시가 재현되는지는 **실측 후 결정**(불필요하면 정리). 변환기 `styles:{}` 규약은 유지 권장.

> 정리: **패치 #1 은 7.x 에서 불필요(상류 fix 확인). 패치 #2 는 방어적 유지 또는 실측 후 제거.**
> 즉 "몽키패치 의존 때문에 7.x 불가"라는 제약은 **#1 한정으로는 오히려 해소**된다.

---

## 6. jspdf 2.5.x → 3.x / svg2pdf 호환

- **svg2pdf.js 2.7.0**(최신) peer: **`jspdf: ^4.0.0 || ^3.0.0 || ^2.0.0`** →
  **jspdf 3.x(및 4.x)를 공식 지원**. 설치본 2.6.0 도 이미 `^3 || ^2` peer.
  - ⟹ svg2pdf 범프는 jspdf 3 와 **호환 조합 존재**(차단 요소 아님).
- jspdf 3.x breaking: ESM/번들 형태·일부 API(폰트/encryption/내부 옵션) 정리. 본 코드의
  사용면은 `new jsPDF`, `addPage`, `addImage`(있다면), svg2pdf 연동 위주 → 표면적 작음.
- **인쇄 PDF 회귀 검증 범위(필수)**: TrimBox/BleedBox 등록, 코너 재단마커, 블리드 링,
  멀티페이지(addPage orientation), 봉투(envelope) 클립, 칼선/이펙트 페이지, DPI/단위(mm)
  좌표 매핑. (감사 WK-1~5 PDF 파이프라인 안정화와 교차) → 실제 IDML/세션 1~2건으로
  5.x PDF vs 7.x PDF **바이트/시각 diff**.

---

## 7. 테스트/공수/리스크

| 항목 | 추정 |
|------|------|
| canvas-core 테스트 영향 | **306개** 대부분 fabric 객체 모델·직렬화·좌표 의존 → 다수 갱신 필요(특히 toObject/styles/coords) |
| 코드 치환 면 | `from 'fabric'` 47 · `new fabric.*` 106 · `fabric.util.*` 36 · `originX/Y` 246 · `loadFromJSON` 47 |
| **데이터 호환(최대 리스크)** | DB 세션 JSON(5.x) ↔ 7.x 로드 무손실성. 깨지면 인쇄물 직결 → 사전 마이그레이션/검증 필수 |
| 공수 등급 | **M~L** (1~2 스프린트). codemod 로 임포트/생성자 일부 자동화하나 좌표·직렬화·플러그인 이벤트·타입은 수작업 검수 |
| 리스크 등급 | **中~高** (좌표 정합 회귀 + 저장 호환 + ESM/Node20 인프라 영향) |

---

## 8. 권고

1. **보안(DEP-7) 관점: 즉시 완화로 충분.** 실효 XSS 면(admin 미리보기)은 본 사이클에서
   2계층 차단 완료. fabric 7 메이저 범프를 **보안 사유로 서두를 필요 없음**.
2. **fabric 7 마이그레이션은 계획된 별도 스프린트로 진행.** 트리거:
   - (a) fabric 5.x 의 다른 보안권고/미지원 누적, (b) 7.x 신기능 필요, (c) Node20 ESM 전환 시점.
   - 진행 시 순서: ESM/Node20 인프라 → 임포트 codemod → 좌표/직렬화 회귀(저장 호환 골든셋) →
     플러그인 이벤트 → 패치#1 제거·패치#2 실측 → PDF 회귀(jspdf3+svg2pdf) → 라이브 라운드트립.
3. **단기 추가 하드닝(선택)**: PDF 경로 `_cleanSvg` 에 script/on* 제거를 추가하면 svg2pdf/
   `<img>` 비실행에만 의존하던 방어를 명시화(심층 방어). 필수 아님.
4. **회귀 가드 고정**: 본 사이클의 `sanitizeSvg.test.ts`(14) + svg.mjs escAttr 는 7.x 이후에도
   유지(변환기 출력 신뢰경계는 fabric 버전과 무관).

---

## 부록 A. 변경 파일(본 사이클 완화)
- 신설: `apps/admin/src/utils/sanitizeSvg.ts`, `apps/admin/src/utils/sanitizeSvg.test.ts`
- 수정: `apps/admin/src/pages/Templates/TemplateImport.tsx`(import + useMemo + 주입값 교체)
- 수정: `packages/indesign-import/src/preview/svg.mjs`(`escAttr`/`safeHref` + 속성 적용)
