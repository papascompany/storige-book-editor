# 표지 편집 모드 (Cover Edit Modes)

> 2026-04-30 작성. 사용자 PDF 요구사항(`20260224_표지편집 모드에 대하여.pdf`)을 기반으로
> 표지(book cover) 편집 시의 view 분기 로직과 UX 정의를 정리한 설계 문서.
>
> 관련 파일:
> - `packages/types/src/index.ts` — TemplateType, EditorMode, SpreadRegionPosition, SpreadConfig
> - `packages/canvas-core/src/plugins/SpreadPlugin.ts` — 스프레드 캔버스 레이아웃 엔진
> - `apps/editor/src/components/PageNavigation/BookNavigation.tsx` — 표지/내지 페이지 네비
> - `apps/editor/src/components/PagePanel/SpreadPagePanel.tsx` — 펼침면 모드 페이지 패널
> - `apps/editor/src/components/SpineEditor/` — 책등 너비 계산 (소프트커버 가변)

---

## 1. 배경 — PDF 요구사항 요약

사용자가 첨부한 PDF에서 제기한 핵심 질문:

> "현재 템플릿 구조상 뒷표지/책등/앞표지 각각의 페이지 단위로 편집화면을 나눠서 보여주고 있음.
> 이것을 표지일 경우 한 화면에서 합쳐서 보여주고 편집을 할 수 있게 하는 방법이 가능한지?"

PDF 6페이지에서 두 가지 케이스를 도시:

| 케이스 | 화면 구성 | 페이지 네비 | 책등 |
|---|---|---|---|
| **조합형 (책등/날개)** | 위쪽: 합쳐진 표지 모양 (뒷표지\|책등\|앞표지[\|날개]) / 영역 클릭 시 해당 템플릿으로 포커스 | `[뒷표지][책등][앞표지] \| [1][2]…` (분리 썸네일, 표지 그룹은 좌측, 구분선 후 내지) | **가변** — 소프트커버, 내지 사이즈에 종속 |
| **펼침면** | 표지 자체가 펼침면 단일 페이지 | `[표지(펼침)] \| [1][2][3]…` (단일 표지 + 내지) | **고정** — 디자인 시 결정 (포토북·동화책) |

추가로 PDF 4페이지에서 분리 템플릿 두 변종:
- **날개 없음** — 3등분: 뒷표지 / 책등 / 앞표지
- **날개 있음** — 5등분: 뒷날개 / 뒷표지 / 책등 / 앞표지 / 앞날개

---

## 2. 현재 인프라 (이미 구현됨)

| 항목 | 위치 | 상태 |
|---|---|---|
| `TemplateType.{WING, COVER, SPINE, PAGE, SPREAD}` | `packages/types/src/index.ts:56` | ✅ |
| `EditorMode.{SINGLE, BOOK}` | `packages/types/src/index.ts:1027` | ✅ |
| `SpreadRegionPosition` (5개 위치) | `packages/types/src/index.ts:1040` | ✅ |
| `SpreadConfig` / `SpreadSpec` / `SpreadRegion` | `packages/types/src/index.ts` | ✅ |
| `SpreadPlugin` (레이아웃 엔진, region 해석, spine 가변) | `packages/canvas-core/src/plugins/SpreadPlugin.ts` | ✅ |
| `SpineEditor` + `calculateSpineWidth` | `apps/editor/src/components/SpineEditor/`, `packages/types/src/index.ts:880` 부근 | ✅ |
| `SpreadPagePanel` (펼침면 모드 전용 페이지 패널) | `apps/editor/src/components/PagePanel/SpreadPagePanel.tsx` | ✅ |
| `useSettingsStore.spreadConfig` + `setSpreadConfig` / `updateSpreadSpineWidth` | `apps/editor/src/stores/useSettingsStore.ts` | ✅ |
| `BookNavigation` 표지/내지 구분 (`isCover`) | `apps/editor/src/components/PageNavigation/BookNavigation.tsx` | ✅ |
| `useAppStore.isSpreadMode` | `apps/editor/src/stores/useAppStore.ts` | ✅ |

---

## 3. 표지 편집 모드 분류 — 3종 정의

기존 인프라를 활용해 표지 편집을 다음 3가지 모드로 정리한다.
어떤 모드를 사용할지는 **템플릿 메타데이터(`TemplateSet.editorMode` + `Template.type`)** 가 결정한다.

### 3.1 Separated 모드 (현재 default)

**언제 사용**: BOOK 모드 + 표지가 여러 `Template`(`COVER`/`SPINE`/`WING`)으로 분리된 경우 (= 가변 책등 + 분할 디자인).

```
┌──────────────┐
│   active     │  ← allCanvas[i] 한 영역만 편집 (예: 뒷표지)
│  workspace   │
└──────────────┘
─────────────────────────────────
[뒷표지][책등][앞표지] │ [1][2][3]   ← BookNavigation
```

**특징**:
- 각 표지 영역 = 별도 캔버스 (`allCanvas[i]`).
- 사용자는 페이지 네비 클릭으로 영역 전환 → `setPage(idx)`.
- 영역 간 객체 이동·복사는 수동 (cut/paste).
- 책등 너비 변경 시 SpineEditor가 spine 캔버스 width를 갱신.

**현재 구현 상태**: ✅ 이미 동작. 트랙 B에서 페이지 네비 시각·라벨링만 정밀화한다 (§5).

### 3.2 Composite 모드 (트랙 B 신규 — UX 보강 대상)

**언제 사용**: Separated 모드와 같은 데이터 구조 (분리 캔버스) 위에서, **편집 컨텍스트만 펼친 모양으로 시각화**하고 싶을 때. 트랙 B에서는 페이지 네비 그룹화 + (Phase 2) 합쳐진 미니맵으로 시작.

```
┌──────────────────────────────────┐
│   [뒷표지 │ 책등 │ 앞표지]         │  ← 헤더 아래 표지 미니맵 (Phase 2)
│         (active region 강조)       │     영역 클릭 → 해당 캔버스로 setPage
├──────────────────────────────────┤
│       active workspace            │  ← 메인 편집은 단일 캔버스 (현재와 동일)
└──────────────────────────────────┘
─────────────────────────────────
┌─[뒷표지][책등][앞표지]─┐ │ [1][2]  ← 표지 그룹 박스 + 구분선
└─────표지─────────┘
```

**핵심 인터랙션**:
1. 활성 페이지의 `templateType ∈ {WING, COVER, SPINE}`이면 표지 그룹으로 인식.
2. 페이지 네비에서 표지 그룹과 내지 그룹 사이에 **세로 구분선** 표시.
3. (Phase 2) 헤더 하단에 작은 합쳐진 미니맵 표시. 미니맵의 각 영역 클릭 → `setPage(targetIdx)`.

**Phase 별 구현 범위**:
| Phase | 내용 | 시점 |
|---|---|---|
| **1** | ✅ 페이지 네비 표지 그룹화 + 위치별 라벨 (뒷날개/뒷표지/책등/앞표지/앞날개) + 그룹 구분선 + thumbnail 시각 개선 | 2026-04-30 완료 |
| **2** | ✅ CoverFocusBar (활성 페이지가 표지일 때 헤더 아래 합쳐진 미니맵) + 영역 클릭 포커스 | 2026-04-30 완료 |
| **3a** | ✅ 표지 편집 모드 사용자 토글 — CommandPaletteModal(`Cmd+K`)에서 auto/separated/composite 직접 선택 | 2026-04-30 완료 |
| **3b** | 객체 region 인식 (composite 모드 객체 추가 위치 자동 결정 + cross-region 이동) — `SpreadPlugin.resolveRegionAtX` + `ObjectAnchor` 메타 활용 | 장기 |

### 3.3 Spread 모드 (펼침면 단일 캔버스)

**언제 사용**: 책등이 디자인 시 고정된 케이스 (포토북, 동화책, 양장제본). `Template.type === SPREAD` + `Template.spreadConfig` 존재.

```
┌──────────────────────────────────┐
│   ┌────┬─┬────┐                  │
│   │ 뒷 │ │ 앞 │                  │  ← 단일 펼침면 캔버스
│   │ 표 │책│ 표 │                  │     SpreadPlugin이 region 경계 그림
│   │ 지 │등│ 지 │                  │
│   └────┴─┴────┘                  │
└──────────────────────────────────┘
─────────────────────────────────
[표지(펼침)] │ [1][2][3]…         ← 표지 단일 썸네일
```

**특징**:
- `allCanvas[0]` 단일 캔버스, `Template.spreadConfig.regions[]`로 5개 영역 정의.
- 객체는 `ObjectAnchor` (`kind: 'region'` or `'canvas'`)로 위치 표현 → 책등 가변 시 region 기반 객체는 자동 재배치.
- SpreadPlugin이 spine·wing line을 그려 시각적 경계 제공.
- 객체 추가 시 마우스 위치 → `SpreadPlugin.resolveRegionAtX()` → 해당 region anchor로 저장.

**현재 구현 상태**: 인프라 ✅. 활성화 흐름(EditorView에서 `Template.type === SPREAD`일 때 어떻게 자동 진입하는지)은 향후 다듬을 영역.

---

## 4. View 분기 결정 트리

```
TemplateSet.editorMode === BOOK
  │
  ├─ 첫번째 Template.type === SPREAD?
  │     YES → ┌─────────────────────┐
  │           │  Spread 모드        │
  │           │  - SpreadPagePanel  │
  │           │  - SpreadPlugin ON  │
  │           └─────────────────────┘
  │
  └─ 첫번째 Template.type ∈ {COVER, SPINE, WING}?
        YES → 사용자 선호 (useUiPrefStore.coverEditMode)
              ├─ 'separated' → 현재처럼 분리 편집 (default, 안정)
              └─ 'composite' → CoverFocusBar 포함 (Phase 2)

TemplateSet.editorMode === SINGLE
  │
  └─ 그냥 PagePanel + 단일 캔버스 (표지 개념 없음)
```

---

## 5. 트랙 B 적용 범위 (Phase 1)

다음 변경을 트랙 B에서 적용한다:

### 5.1 `useUiPrefStore.coverEditMode` 추가

```ts
type CoverEditMode = 'separated' | 'composite' | 'auto'
// 'auto' (기본): 시스템이 템플릿 메타로 결정. 사용자가 명시적 토글하면 'separated'/'composite' 고정.
```

- localStorage version 4 마이그레이션 (default 'auto').
- 향후 SettingsPanel에서 사용자가 토글 가능.

### 5.2 `BookNavigation.buildPageMeta` 정밀화

기존엔 같은 type이 여러 개면 모두 동일 라벨("표지" / "책등")이었다.
이번에는 **인덱스 기반 위치 추론**으로 정확한 라벨을 부여:

```
[WING, COVER, SPINE, COVER, WING]
  ↓        ↓       ↓     ↓        ↓
뒷날개  뒷표지   책등  앞표지  앞날개
```

규칙 (cover-related 페이지만 추출 후 좌→우 순서로):
- N=1 (`[COVER]` 단독) → "표지"
- N=3 (`[COVER, SPINE, COVER]`) → "뒷표지", "책등", "앞표지"
- N=5 (`[WING, COVER, SPINE, COVER, WING]`) → "뒷날개", "뒷표지", "책등", "앞표지", "앞날개"
- 그 외 (혼합) → fallback: 위치 기반 ("뒷날개"가 첫 WING, "앞날개"가 마지막 WING …)

### 5.3 표지/내지 그룹 구분선

`BookNavigation` 카드 리스트에서 마지막 표지 페이지와 첫 내지 사이에 `<span className="w-px h-12 bg-gray-300 mx-1" />` 형태의 세로 구분선 삽입 (PDF 시안 매칭).

### 5.4 `PageThumbnail` 시각 미세 개선

표지 카드는 amber 톤 → **회색 배경 + 둥근 사각형** (PDF 시안의 그레이 박스 외곽 매칭). 활성 시는 기존 violet 강조 유지.

### 5.5 트랙 B 적용 후 남은 항목 (Phase 3)

- ✅ 합쳐진 표지 미니맵 (CoverFocusBar) — Phase 2 완료
- ❌ Composite 모드 객체 cross-region 이동 — Phase 3
- ❌ Spread 모드 EditorView 자동 진입 분기 강화 — Phase 2 (현재도 SpreadPagePanel이 분기는 한다)
- ❌ 영역 클릭으로 객체 추가 위치 결정 — Phase 3

---

## 6. Phase 2 — CoverFocusBar 구현 (2026-04-30 완료)

활성 페이지가 표지 그룹일 때, 헤더(`EditorHeader`) 바로 아래에 작은 가로 미니맵을 띄운다.

```
┌──────────────────────────────────────────┐
│ EditorHeader                             │
├──────────────────────────────────────────┤
│  [뒷표지│책등│앞표지]  ← active region 강조│  ← CoverFocusBar (height 56px)
├────────┬─────────────────────────────────┤
│  Tools │  메인 캔버스                     │
└────────┴─────────────────────────────────┘
```

**구현 위치**: `apps/editor/src/components/editor/CoverFocusBar.tsx`

**핵심 동작**:
- 각 region 박스 = `<button>`, 클릭 시 `setPage(targetIdx) + goToPage(targetIdx)`로 이동.
- 박스 내부에 해당 캔버스의 `toDataURL({ multiplier: 0.1, format: 'png' })` 실시간 미리보기 (250ms throttle).
- 활성 region은 `border-editor-accent + ring-2 ring-editor-accent/30 + bg-white`.
- 비활성 region은 `bg-gray-100` + hover 시 `bg-white`.
- 박스 width = 캔버스 실제 width(`canvas.getWidth()`) 비례 분배 → CSS flex `grow:N`로 자동. 책등 가변폭이 자동 반영됨 (`SpineEditor`가 spine 캔버스 width를 갱신하면 다음 렌더에서 반영).
- 활성 페이지가 표지가 아닐 때(내지) 또는 표지 그룹이 1개 이하일 때 (`activeGroup.length < 2`) `null` 반환 → 자동 hide.
- 활성 페이지를 중심으로 좌우로 인접한 표지 페이지를 그룹으로 묶음 (한 책에 표지 그룹이 여러 개여도 안전).

**책등 너비 계산 의존성** (자동):
- 소프트커버: `SpineEditor` + `calculateSpineWidth(pageCount, paperType, bindingType)` → spine 캔버스 width 갱신 → CoverFocusBar 박스 비율 자동 갱신
- 양장 / Spread mode: `spreadConfig.spec.spineWidthMm` 정적

**검증**:
- N=5 (날개 있음) 시뮬레이션 → 5개 박스 정확한 라벨 (뒷날개/뒷표지/책등/앞표지/앞날개) + flex 비례 분배 ✓
- 책등 박스 클릭 → currentPageIndex=2로 이동, aria-pressed가 새 활성 박스로 자동 전환 ✓
- 내지 페이지로 이동 → CoverFocusBar 자동 숨김 ✓
- 라이브 캔버스 미리보기 250ms throttle 정상 (after:render 이벤트 구독) ✓

---

## 7. Phase 3b — 객체 region 인식 (인프라 정리, 장기 구현)

`SpreadPlugin.getRegionAtX(x)` (canvas-core public API) + `ObjectAnchor` 메타를 활용해 구현.

### 7.1 인프라 (이미 존재)

| API | 위치 | 역할 |
|---|---|---|
| `SpreadPlugin.getRegionAtX(canvasX)` | `packages/canvas-core/src/plugins/SpreadPlugin.ts:526` | canvas X 좌표 → 해당하는 `SpreadRegion` 반환 (back-wing/back-cover/spine/front-cover/front-wing) |
| `SpreadPlugin.computeResizedLayout(spec)` | 동상 | 책등 폭 변경 시 region 좌표 재계산 |
| `SpreadPlugin.handleObjectModified` | 동상:435 | object:modified 자동 구독 → `resolveRegionRef`로 메타 갱신 (3b-iii 완료) |
| `resolveRegionRef(regions, boundingRect, currentRegionRef)` | `packages/canvas-core/src/spread/SpreadLayoutEngine.ts:280` | 히스테리시스(승격 ≥90%, 강등 <70%) 판정 + anchor 계산. canvas-core public export |
| `ObjectAnchor` 타입 | `packages/types/src/index.ts:1053` | `{ kind: 'region', xNorm, yNorm } \| { kind: 'canvas', x, y }` |
| `useCoverRegion()` hook | `apps/editor/src/hooks/useCoverRegion.ts` | spread 모드일 때 X 좌표 → region 매핑. 비-spread는 null |
| `useIsCoverContext()` hook | 동상 | 활성 페이지가 표지 그룹 + `spreadConfig` 있는지 |
| `useSpreadAutoAnchor(ready)` hook | 동상 | spread 모드 신규 객체에 region 메타 자동 부여 (3b-ii 완료) |

### 7.2 향후 구현 단계

1. **객체 추가 위치 자동 결정**: spread 모드에서 도구로 새 객체 생성 시 마우스 좌표를 `useCoverRegion()`로 region 매핑 → `obj.set('meta', { anchor: { kind: 'region', xNorm, yNorm } })`.
2. **객체 드래그 종료(modified) 메타 갱신**: 객체가 region 경계를 넘어가면 새 region으로 anchor 갱신. fabric `object:modified` 이벤트 구독.
3. **책등 가변 시 자동 재배치**: SpineEditor가 `setSpreadSpec()` 호출 → `SpreadPlugin.computeResizedLayout()` → region 객체들의 시각 위치를 `xNorm`로 재계산.
4. **Composite 모드 cross-region 이동**: 분리 캔버스 N개 → 활성 region에서 다른 region으로 객체 이동 시 cross-canvas remove + add (현재 분리 캔버스라 객체 자체는 한 캔버스에 종속).

### 7.3 구현 로드맵

| 단계 | 변경 위치 | 난이도 |
|---|---|---|
| **3b-i** ✅ | `useCoverRegion` hook export (인프라 노출만) | 낮음 (완료) |
| **3b-ii** ✅ | 객체 추가 시 region 메타 자동 부여 — `useSpreadAutoAnchor` hook이 `object:added` 구독 + `resolveRegionRef` 한 번 적용 (도구별 wiring 불필요) | 중간 (완료, canvas-core 변경 없음) |
| **3b-iii** ✅ | `object:modified` 시 region 메타 갱신 — `SpreadPlugin.handleObjectModified`가 이미 처리 (히스테리시스 90%/70%) + 신규 객체도 3b-ii로 첫 add 시 동일 로직 적용 | 중간 (완료, 검증) |
| **3b-iv** | computeResizedLayout 활용한 책등 가변 시 객체 재배치 — `SpreadPlugin.repositionObjects`가 이미 front-cover/front-wing/spine 처리, 남은 격차는 캔버스 밖 이탈 객체 토스트 알림 | 중상 (canvas-core 일부) |
| **3b-v** | Composite 모드 cross-canvas 이동 API | 상 (canvas-core 빌드 + 데이터 마이그레이션) |

---

## 8. 데이터 모델 호환성

### 8.1 Separated → Composite

**호환**. 같은 데이터 구조. UI 토글로만 결정.

### 8.2 Separated/Composite → Spread

**파괴적 변환**. 분리된 N개 캔버스를 단일 SPREAD 템플릿 1개로 합쳐야 하므로 객체 위치 재계산 필요. 자동 변환은 Phase 3에서. 사용자에게 변환 대화상자 + 미리보기 제공.

### 8.3 Spread → Separated/Composite

**파괴적 변환**. SpreadPlugin region 객체를 5개 분리 캔버스로 분할. 마찬가지로 Phase 3.

---

## 9. 검증 체크리스트 (Phase 1 — 트랙 B)

- [x] 표지 페이지가 정확히 위치별 라벨로 표시된다 (뒷표지/책등/앞표지 등).
- [x] 표지/내지 사이에 시각적 구분선이 보인다.
- [x] PageThumbnail이 활성/표지/일반에서 시각 차별화된다.
- [x] `useUiPrefStore.coverEditMode` 가 localStorage에 영속된다.
- [x] 마이그레이션 후 기존 사용자 설정이 깨지지 않는다 (version 4 추가).
- [x] 빌드/타입체크 통과.

---

**문서 끝**. Phase 2/3 구현 시 본 문서를 우선 참조하고 갱신할 것.
