# Storige 좌표계 규약 (Coordinate System — 동결 문서)

> **목적**: Storige 가 쓰는 좌표계와 경계별 변환 규칙을 **단일 정본**으로 동결한다.
> 좌표를 만지는 모든 작업(IDML/PSD 변환기, 편집기, 미리보기, PDF, 워커 임포지션)은 이 문서를 따른다.
> **작성**: 2026-06-11 · IDML 재편집 붕괴(③④ 미리보기/래스터 좌표 드리프트) 사후 규약 동결.

---

## 0. TL;DR (한 줄 요약)

- **편집기 내부 정본 = scene(중앙원점)**. 객체 `left/top` 은 워크스페이스 **중심**이 (0,0).
- 외부 포맷(IDML·미리보기/래스터 SVG·PDF)은 각자 다른 원점을 쓴다 → **경계마다 명시적 변환**.
- "중앙"이라는 단어가 세 군데(객체 좌표 원점 / 화면 센터링 / 내지 임포지션)에서 쓰이지만 **서로 다른 계층**이다(아래 §4). 혼동 금지.

---

## 1. 네 좌표계 (계층별 원점)

| 좌표계 | 원점 | 단위 | 어디서 |
|---|---|---|---|
| **IDML 스프레드** | 스프레드 **중앙**(x=좌측 콘텐츠 가장자리 기준, y=세로 중앙) | pt | InDesign IDML 파싱 입력 |
| **content** (콘텐츠) | **좌상단** (0,0)~(W,H) | px@150dpi | 변환기 중간 계산값, 미리보기/래스터 SVG `viewBox`, region 가이드, `path` 의 `d` |
| **scene** (씬, **정본**) | **중앙** (워크스페이스 중심) | px@150dpi | fabric 객체 `left/top`(`originX/originY='center'`), 편집기 화면, PDF 렌더 |
| **PDF 박스** | **좌하단** | pt | MediaBox/TrimBox/BleedBox(jsPDF) |

> **왜 중앙원점이 정본인가** (Canva/Miricanvas/Figma 는 좌상단인데): Storige 는 **런타임 책등 가변
> 스프레드**와 **토글형 블리드 확장**을 한다. 중앙원점이면 (a) 책등 폭이 변해도 책등 객체 좌표 불변·앞/뒤표지
> 대칭 이동, (b) 블리드를 켜서 작업사이즈로 키워도 객체 좌표 불변(대칭 확장). 좌상단이면 두 경우 모두 전
> 객체를 평행이동시켜야 한다. 즉 중앙원점은 우연이 아니라 이 도메인의 **구조적 이점**이다. (전환은 DB
> 마이그레이션 + 전 계층 수정 + 블리드/책등/PDF 재검증을 요구하므로 비권장 — 외부 교환 포맷만 좌상단으로
> 두는 v2 는 장기 선택지로 보류.)

---

## 2. 변환 규칙 (경계마다 단 한 곳)

`content ↔ scene` 는 평행이동뿐이다. `half = {W/2, H/2}` (W,H = `canvasData.width/height`):

```
scene   = content − half     // 변환기 출력(객체 left/top, canvas anchor)
content = scene  + half      // 미리보기/래스터 렌더(SVG viewBox 좌표)
```

**구현 SSOT**: `packages/indesign-import/src/geometry/centerOrigin.mjs`
(`halvesOf`, `contentToScene[X/Y]`, `sceneToContent[X/Y]`).
부호 규약은 이 파일 한 곳에만 둔다. 아래 4개 파일은 **반드시 이 헬퍼만** 사용한다:

| 파일 | 방향 | 비고 |
|---|---|---|
| `convert/toSpreadTemplate.mjs` | content→scene | 객체 `left/top`, canvas anchor |
| `convert/toSinglePageTemplate.mjs` | content→scene | PSD 단품 |
| `preview/svg.mjs` | scene→content | admin 미리보기 SVG |
| `raster/rasterize.mjs` | scene→content | 하이브리드 배경 PNG |

> ⚠️ **`path` 의 `d` 문자열은 변환 제외** — `mapLocalToCanvas` 가 이미 content 절대 px 로 만든 값이다.
> (회전 피벗은 객체 중심 = 변환 대상.)

**회귀 가드**: `geometry/centerOrigin.test.mjs`(왕복 불변식) + `preview/renderInvariants.test.mjs`
(front 객체는 front region, back 객체는 back region 픽셀 범위에 렌더되는지 실제 SVG 출력으로 검증).
누군가 환산을 빠뜨리면 CI 에서 즉시 실패한다. (이번 ③④ 사고 = a92f146 이 변환기 본체만 고치고
preview/raster 를 빠뜨려 발생 → 본 단일화로 구조적 차단.)

---

## 3. ⚠️ `canvasData.width/height` 는 fabric 캔버스 치수가 아니다

`canvasData` 최상위 `width/height` 는 **판형 메타데이터**(useTemplateSave=mm, 변환기=workspace px)일 뿐,
fabric 캔버스의 px 치수가 아니다. **이를 `fabric.Canvas#loadFromJSON` 에 그대로 넘기면 안 된다** —
`__setupCanvas` 의 `_setOptions` 가 `canvas.width/height` 를 덮어써(예: 표지 430×297) `skipOffscreen`
컬링이 가시영역 밖 객체를 렌더 스킵 → **객체가 투명/사라짐**(IDML 표지 재편집 붕괴 ①②의 원인).

- 캔버스 치수는 **컨테이너 기반** `setDimensions`/`WorkspacePlugin.setZoomAuto` 가 관리한다.
- `ServicePlugin.loadJSON` 은 fabric 입력에서 `width/height` 를 strip 한다(`527b85b`).
- 일반 템플릿은 `canvasData` 에 `workspace` 객체가 있어 `afterLoad`→`setZoomAuto` 가 치수를 복구하지만,
  IDML/PSD 변환 템플릿은 workspace 가 없어 `WorkspacePlugin.afterLoad` 가 `init` 때 만든 `this.workspace`
  를 복원한다(`527b85b`). 저장 후엔 workspace 가 직렬화되어 자가치유된다.

---

## 4. "중앙" 세 가지 — 서로 다른 계층 (혼동 주의)

| "중앙" | 의미 | 계층 | 좌표 원점과의 관계 |
|---|---|---|---|
| 객체 좌표 **중앙원점** | `left/top` 의 기준이 워크스페이스 중심 | 데이터(scene) | 본 문서 §1~2 |
| 템플릿을 **화면 중앙에 표시** | 판형이 뷰포트 가운데 보이게 | 뷰(`setZoomAuto` 줌/팬) | 데이터 원점과 무관 — 어떤 원점이든 동일 동작 |
| 내지 PDF **중앙 임포지션** | 고객 업로드 PDF 를 작업사이즈 페이지에 무스케일 중앙 안착 | 워커(`centerOnPage` GS) | 편집기 좌표와 무관 — PDF 페이지 박스 연산 |

→ 좌표 규약(데이터 원점)을 바꿔도 화면 센터링·임포지션 중앙배치에는 영향이 없다(독립).

---

## 5. 관련 코드 / 문서
- `packages/indesign-import/src/geometry/centerOrigin.mjs` — content↔scene SSOT
- `packages/indesign-import/src/geometry/centerOrigin.test.mjs` / `preview/renderInvariants.test.mjs` — 회귀 가드
- `packages/canvas-core/src/plugins/WorkspacePlugin.ts` — scene 정본/워크스페이스/setZoomAuto
- `packages/canvas-core/src/plugins/SpreadPlugin.ts` — 책등 가변(getContentOrigin: scene↔content 콘텐츠 좌표)
- `packages/canvas-core/src/plugins/ServicePlugin.ts` — loadJSON width/height strip, PDF 렌더
- [`IDML_IMPORT_FLOW.md`](IDML_IMPORT_FLOW.md) §5b — 재편집 정합성 사이클
- [`DESIGN_IMPORT_CONVERTER.md`](DESIGN_IMPORT_CONVERTER.md) — 변환기 기술 아키텍처
