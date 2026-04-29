# Storige Editor — 레이아웃 / 디자인 커스터마이징 가이드

> 2026-04-29 작성, 2026-04-30 갱신. 본 문서는 에디터(`apps/editor`)의 UI/UX 구조, 디자인 토큰,
> 최근 커스터마이징 변경, 그리고 후속 작업을 위한 가이드라인을 정리한다.
>
> 참고 문서:
> - `.cursor/plans/_RESUME_PROMPT.md` — 프로젝트 전체 진행 상황
> - `.cursor/plans/v2/NEW_DEV_PLAN.md` — 마스터 계획
> - `apps/editor/src/index.css` — 디자인 토큰 (CSS 변수) 정의
> - `apps/editor/tailwind.config.js` — Tailwind 색상 매핑

---

## 1. 한눈에 보기

```
┌─────────────────────────────────────────────────────────────────┐
│  [Storige] ← →  💾 저장됨   "작업명"  [100×100mm]      │ │ EditorHeader
│                                          📏 [네비▾] ?  📁불러오기 ✓편집완료
├──┬──────────────┬──────────────────────────────────────────────┤
│업│ ←FeatureSide│  …workspace (canvas + ruler 옵션)            │
│로│  bar (300px) │                                                │
│드│  (선택 시)    │  ┌──────────────┐                            │
│모│              │  │              │                            │ Canvas
│양│  텍스트 추가  │  │   캔버스      │                            │
│컷│  ...         │  │              │                            │
│  │              │  └──────────────┘                            │
│텍│              │                                                │
│스├──────────────┼──────────────────────────────────────────────┤
│트│              │  📚 BookNavigation (1쪽 / 2쪽 / + 추가)        │
│··│              │                                                │
└──┴──────────────┴──────────────────────────────────────────────┘
   ↑
   ToolBar (좌측 vertical icon nav, 9개 도구)
```

**주요 영역**
- **EditorHeader** (`apps/editor/src/components/editor/EditorHeader.tsx`) — 상단 화이트 네비
- **ToolBar** (`apps/editor/src/components/editor/ToolBar.tsx`) — 좌측 도구 메뉴 (lucide 아이콘 + 라벨)
- **FeatureSidebar** (`apps/editor/src/components/editor/FeatureSidebar.tsx`) — ToolBar 클릭 시 열리는 300px 패널
- **SidePanel** (`apps/editor/src/components/editor/SidePanel.tsx`) — 캔버스 객체 선택 시 우/좌측 속성 패널
- **ControlBar** (`apps/editor/src/components/editor/ControlBar.tsx`) — 객체 선택 시 컨트롤
- **BookNavigation** (`apps/editor/src/components/PageNavigation/BookNavigation.tsx`) — 페이지 썸네일 네비 (우측 또는 하단)

---

## 2. 디자인 토큰

### 2.1 색상 — `apps/editor/src/index.css`

```css
:root {
  /* bookmoa green theme */
  --color-primary:                #7fbf34;  /* 브랜드 녹색 (CTA, 강조) */
  --color-primary-rgb:            127 191 52;  /* triplet — rgb(... / <alpha>) 패턴용 (2026-04-30) */
  --color-primary-darker:         #6ba82d;  /* hover/active 한 단계 진한 톤 (2026-04-30) */
  --color-primary-darker-rgb:     107 168 45;
  --color-surface-tint:           #7fbf34;
  --color-on-primary:             rgb(255 255 255);
  --color-primary-container:      #e8f5d4;
  --color-on-primary-container:   #1a3300;

  --color-background:             #f7f7f7;
  --color-on-background:          #333;
  --color-surface:                rgb(247 249 245);
  --color-on-surface:             #333;
  --color-surface-variant:        rgb(225 230 220);
  --color-outline:                rgb(114 120 126);
  --color-outline-variant:        #e0e0e0;

  --color-surface-container-lowest:  rgb(255 255 255);
  --color-surface-container-low:     rgb(251 251 251);
  --color-surface-container:         rgb(243 243 243);
  --color-surface-container-high:    rgb(233 233 233);
  --color-surface-container-highest: rgb(224 224 224);

  /* legacy mappings (Tailwind utilities — bg-editor-accent 등) */
  --editor-bg:         var(--color-background);
  --editor-panel:      var(--color-surface-container-lowest);
  --editor-border:     var(--color-outline-variant);
  --editor-text:       var(--color-on-surface);
  --editor-text-muted: var(--color-on-surface-variant);
  --editor-accent:     var(--color-primary);
}
```

**Tailwind 매핑** (`apps/editor/tailwind.config.js`):
- `bg-editor-accent` → `rgb(var(--color-primary-rgb) / <alpha-value>)` — opacity modifier 지원
- `bg-editor-accent-hover` → `rgb(var(--color-primary-darker-rgb) / <alpha-value>)` — hover 한 단계 진함
- `bg-primary` (shadcn/ui) → `rgb(var(--color-primary-rgb) / <alpha-value>)`
- `bg-editor-panel` → 흰색
- `text-editor-text-muted` → 회색계
- 그 외 모든 `editor-*` 클래스가 CSS 변수로 매핑됨

✅ **opacity modifier 지원 (2026-04-30)**: `bg-editor-accent/10`, `text-editor-accent/50`, `ring-editor-accent/30` 등 Tailwind opacity 표기법을 그대로 사용 가능. CSS 변수에 RGB triplet (`127 191 52`)을 함께 정의하고 Tailwind에서 `<alpha-value>` 자리표시자 패턴을 채용한 결과. arbitrary 값 (`bg-[rgba(127,191,52,0.12)]`) 더는 사용하지 말 것.

### 2.2 폰트

```css
font-family: "Pretendard Variable", Pretendard, "Noto Sans KR",
             -apple-system, BlinkMacSystemFont, "Segoe UI",
             system-ui, Inter, Roboto, sans-serif;
letter-spacing: -0.01em;
```

- **기본**: Pretendard (한글 우선) — `index.css`에 CDN import
- **폴백**: Noto Sans KR
- **모노스페이스**: 사용하지 않음 (이전 ruler에 시도했다가 절제 톤으로 sans-serif 복귀)

### 2.3 타이포그래피 컨벤션

| 용도 | 클래스 | 비고 |
|---|---|---|
| 헤더 라벨 (FeatureSidebar) | `text-[13px] font-semibold tracking-tight text-gray-700` | |
| 섹션 제목 (AppSection) | `text-[13px] font-semibold tracking-tight text-gray-700` | |
| 작업명 input | `text-sm font-medium text-gray-700` | |
| 사이즈 pill | `text-xs text-gray-500 border-gray-200 bg-gray-50` | |
| 버튼 (sm) | `text-sm font-medium h-9 px-4` | |
| Placeholder | `text-gray-400 text-xs` | "추천 콘텐츠 없음" 등 |

### 2.4 아이콘 — Lucide

- 의존성: `lucide-react@^0.400.0` (`apps/editor/package.json`)
- 모든 아이콘은 lucide 사용 (이전 phosphor-icons는 일괄 마이그레이션됨)
- 기본 사용 패턴: `<IconName className="h-4 w-4" />` (small) / `h-5 w-5` (medium)
- `IconContext.Provider` 미지원 — 각 아이콘이 props 직접 지정

⚠️ **이전 phosphor 코드 대응**: 일부 파일은 `import { Lucide as Phosphor }` alias 패턴으로 호환. 사용처(JSX) 변경 없음.

```ts
// 예: TextAttributes.tsx
import {
  Bold as TextB,           // phosphor 호환 alias
  AlignLeft as TextAlignLeft,
  CaseSensitive as TextAa,
  // ...
} from 'lucide-react'
```

### 2.5 라운드/쉐도우/스페이싱

| 토큰 | 값 |
|---|---|
| Button radius | `rounded-md` (대부분), `rounded-full` (헤더 CTA) |
| Section divider | `border-b border-gray-100` |
| Sidebar shadow | `shadow-sm` |
| Header border | `border-b border-gray-200 + shadow-sm` |
| Section spacing | `px-4 py-2.5` (헤더), `px-4 pb-4 pt-1` (콘텐츠) |
| 헤더 height | `h-14` (56px) |
| 버튼 small | `h-9` (36px) |

---

## 3. 컴포넌트 구조

### 3.1 EditorHeader

**파일**: `apps/editor/src/components/editor/EditorHeader.tsx`

```
┌──────────────────────────────────────────────────────────────────┐
│ [Storige] ↶ ↷ ☁️저장됨    "작업명"  [100×100mm]                  │
│                              📏  [네비▾]  ?  📁불러오기 ✅편집완료 │
└──────────────────────────────────────────────────────────────────┘
```

**구성** (좌→우):
- 로고 텍스트 `Storige` (브랜드 녹색)
- Undo/Redo (`HistoryPlugin`)
- AutoSaveIndicator (저장 상태)
- (중앙) 작업명 input + 사이즈 pill (`100 × 100 mm`)
- 룰러 토글 (`Ruler` icon, `useUiPrefStore.showRuler`)
- 3D 미리보기 (스프레드 모드 전용)
- 페이지 네비 위치 select (`auto`/`right`/`bottom`)
- 도움말 (HelpCircle)
- 불러오기 버튼 (outline, h-9)
- 편집완료 버튼 (default = 브랜드 녹색, h-9)
- (관리자) 편집완료 버튼 (`handleSaveForAdmin`)

**스타일**:
- `nav.h-14 bg-white border-b border-gray-200 shadow-sm`
- 모든 아이콘 lucide
- 편집완료 버튼: `bg-editor-accent rounded-full shadow-sm px-4`
- 모바일에서는 편집완료만 표시 (`<Button variant="ghost" size="icon">`)

### 3.2 ToolBar (좌측 vertical nav)

**파일**: `apps/editor/src/components/editor/ToolBar.tsx`

```
업로드 | 모양컷 | 템플릿 | 이미지 | 텍스트 | 요소 | 배경 | 프레임 | QR/바코드 | 편집도구
```

**구성**:
- 9개 메뉴 버튼 (각 `h-14 w-14`)
- 활성 시 `bg-editor-accent/10 text-editor-accent` + 좌측 3px 녹색 인디케이터
- 모든 아이콘 lucide-react
- horizontal mode (모바일/태블릿)에서는 가로 스크롤

**메뉴 추가 방법**:
1. `tools/AppNewTool.tsx` 생성 (AppText 패턴 참고)
2. `ToolBar.tsx`의 `ALL_MENUS`에 entry 추가:
```ts
{ type: 'NEW_TOOL', label: '새도구', icon: NewIcon }
```
3. `FeatureSidebar.tsx`의 `renderToolPanel()` switch에 케이스 추가
4. (선택) feature flag 환경변수 추가 (`VITE_ENABLE_NEW_TOOL`)

### 3.3 FeatureSidebar

**파일**: `apps/editor/src/components/editor/FeatureSidebar.tsx`

```
┌─────────────────┐ ┊ ← 우측 가장자리 4px 드래그 핸들 (240~480px)
│ 텍스트   ≪  ✕ │  ← 헤더 (배경 gray-50/50, 접기/닫기 버튼)
├─────────────────┤
│  [+ 텍스트 추가]│  ← Primary CTA (녹색)
├─────────────────┤
│ ▽ 추천 콘텐츠   │  ← AppSection
│   ...           │
└─────────────────┘
```

- **폭 가변** (2026-04-30): `useUiPrefStore.sidebarWidth` (240~480px, 기본 300, localStorage 영속)
- **드래그 리사이즈**: 우측 4px 핸들 (`role="separator"`), invisible 12px hit area, hover 시 `bg-editor-accent/30`
- **collapse 토글**: `ChevronsLeft` 아이콘 클릭 → 28px 폭으로 접힘 (펼침 버튼만 노출, `ChevronsRight`)
- 닫기(X) 시 `setSidebarCollapsed(false)` 자동 호출 — 다음 도구 열 때 펼친 상태로 시작
- `bg-white border-r border-gray-200 shadow-sm`
- 헤더: `border-b border-gray-100 bg-gray-50/50`, 접기/닫기 (gray-400 → gray-700)
- 콘텐츠는 `overflow-y-auto`

**중요 구현 디테일**:
- 드래그 중에는 `draftWidth` local state로만 폭을 갱신 → mouseup 시점에만 `setSidebarWidth()` 호출 (zustand persist 과호출 방지)
- 드래그 중에는 `transition` 클래스 제거 (즉시 반응) / 토글 시에만 150ms 트랜지션
- 캔버스 폭 동기화는 `EditorView`의 `ResizeObserver`가 `canvasContainerRef`를 관찰하므로 자동 처리

**중요 컨벤션**:
- 각 `tools/App*.tsx`는 **자체 title 표시 안 함** (FeatureSidebar 헤더가 라벨 표시)
- 첫 CTA 버튼은 `variant="default"` (브랜드 녹색)
- 그 외 보조 액션은 `variant="secondary"` 또는 outline

### 3.4 AppSection (collapsible 섹션 컴포넌트)

**파일**: `apps/editor/src/components/AppSection.tsx`

```tsx
<AppSection title="크기" onDetail={...} onDelete={...}>
  <ControlInput ... />
</AppSection>
```

**Props**:
| prop | 타입 | 설명 |
|---|---|---|
| `title` | string | 섹션 제목 |
| `expanded` | boolean? | 외부 제어 (없으면 내부 state) |
| `onExpand` | () => void? | 토글 핸들러 |
| `onDetail` | () => void? | "더보기 →" 버튼 |
| `onDelete` | () => void? | X 삭제 버튼 |
| `searchSlot` | ReactNode? | 검색 input 슬롯 |

**스타일**:
- 헤더: `px-4 py-2.5 hover:bg-gray-50` + `text-[13px] font-semibold tracking-tight text-gray-700`
- 카레트: `ChevronDown/ChevronRight` (lucide, h-3.5 text-gray-400)
- 콘텐츠: `px-4 pb-4 pt-1`
- 섹션 사이: `border-b border-gray-100 last:border-b-0`

### 3.5 FontPreviewDropdown

**파일**: `apps/editor/src/components/FontPreviewDropdown.tsx`

폰트 선택 드롭다운 (텍스트 객체 선택 시 표시).

**스타일**:
- Trigger: `h-9 px-3 border border-gray-200 rounded-md bg-white`
- Hover: `bg-gray-50 border-gray-300`
- Open: `border-editor-accent shadow-sm rounded-b-none`
- ChevronDown: `text-gray-400` (열림 시 rotate-180)

### 3.6 BookNavigation (페이지 네비)

**파일**: `apps/editor/src/components/PageNavigation/BookNavigation.tsx`

페이지 썸네일 + 추가/삭제 버튼.

**위치 결정**: `useResolvedPageNavPosition()` hook
- `auto`: 화면 폭에 따라 자동 (≥1280 우측, 그 외 하단)
- `right`: 우측 vertical
- `bottom`: 하단 horizontal

**Store**: `useUiPrefStore.pageNavPosition` (localStorage 영속)

### 3.7 룰러 (Ruler) 시스템

**파일**:
- `packages/canvas-core/src/ruler/ruler.ts` — Fabric 캔버스 위에 별도 canvas 오버레이
- `packages/canvas-core/src/ruler/constants.ts` — 색상 토큰
- `packages/canvas-core/src/plugins/RulerPlugin.ts` — Editor 플러그인 래퍼
- `apps/editor/src/utils/createCanvas.ts` — 인스턴스 생성

**기본 OFF**. 사용자가 헤더의 룰러 아이콘 토글로 ON/OFF.

**상태 흐름**:
```
EditorHeader 룰러 버튼 클릭
  → useUiPrefStore.toggleRuler()  (showRuler: boolean, localStorage 영속)
  → EditorView useEffect 감지
  → 모든 Editor.getPlugin('RulerPlugin')에 enable() / rulerDisable()
  → CanvasRuler.enable() / disable()  (별도 ruler canvas에 그리기/clearRect)
```

**색상 토큰** (`constants.ts`):
```ts
RULER_DEFAULTS = {
  RULE_SIZE: 20,
  FONT_SIZE: 9,
  BACKGROUND_COLOR: '#FFFFFF',
  TEXT_COLOR: '#9CA3AF',        // gray-400 (절제된 톤)
  BORDER_COLOR: '#F3F4F6',
  HIGHLIGHT_COLOR: '#7fbf34',   // 브랜드 녹색 (선택 객체 표시)
  TICK_COLOR: '#D1D5DB',        // gray-300
  MAJOR_TICK_COLOR: '#9CA3AF',  // gray-400
  UNIT: 'mm',
  DPI: 150
}
```

⚠️ **중요 버그 fix (2026-04-29)**: `disable()` 끝에 반드시 `_rulerCtx.clearRect()` 호출. 이전에는 이벤트 리스너만 해제하고 그려진 픽셀이 남아 토글 OFF 후 잔상이 남던 버그.

---

## 4. 사용자 선호 — `useUiPrefStore`

**파일**: `apps/editor/src/stores/useUiPrefStore.ts`

```ts
interface UiPrefState {
  pageNavPosition: 'auto' | 'right' | 'bottom'   // 페이지 네비 위치
  setPageNavPosition: (pos) => void

  showRuler: boolean                              // 룰러 표시 (기본 false)
  setShowRuler: (show: boolean) => void
  toggleRuler: () => void

  // 2026-04-30 추가: FeatureSidebar 폭 / collapse
  sidebarWidth: number                            // 240 ~ 480 clamp (기본 300)
  setSidebarWidth: (w: number) => void
  sidebarCollapsed: boolean                       // 접힘 여부 (기본 false)
  setSidebarCollapsed: (v: boolean) => void
  toggleSidebarCollapsed: () => void
}

export const SIDEBAR_WIDTH_MIN = 240
export const SIDEBAR_WIDTH_MAX = 480
export const SIDEBAR_WIDTH_DEFAULT = 300
```

- localStorage key: `storige-ui-pref`
- version: **3** (sidebarWidth/sidebarCollapsed 추가 마이그레이션)
- 새 사용자 선호 추가 시 version 증가 + persist 마이그레이션 처리
- `sidebarWidth`는 setter에서 자동 clamp (240~480)되므로 호출처에서 별도 검증 불필요

---

## 5. 캠버스 정렬 — ResizeObserver 동기화

**파일**: `apps/editor/src/views/EditorView.tsx`

마운트 시점에 컨테이너가 좁은 상태로 캔버스 dim이 고정되어 좌측에 치우치던 버그 해결:

```ts
useEffect(() => {
  if (!ready || !canvasContainerRef.current) return
  const el = canvasContainerRef.current
  const resize = () => {
    const w = el.clientWidth, h = el.clientHeight
    if (w <= 0 || h <= 0) return
    useAppStore.getState().allCanvas.forEach((cvs) => {
      if (!cvs || (cvs as any).disposed) return
      cvs.setDimensions({ width: w, height: h })
      cvs.requestRenderAll?.()
    })
    useAppStore.getState().allEditors.forEach((ed) => {
      ed?.emit?.('sizeChange', { width: w, height: h })
    })
  }
  resize()
  const ro = new ResizeObserver(() => resize())
  ro.observe(el)
  window.addEventListener('resize', resize)
  return () => { ro.disconnect(); window.removeEventListener('resize', resize) }
}, [ready])
```

---

## 6. 세션 변경 이력

### 6.0 2026-04-30 세션 (디자인 토큰 / 사이드바 가변 / 요소 메뉴 복원)

| 항목 | 영향 |
|---|---|
| RGB triplet 도입 | `--color-primary-rgb`, `--color-primary-darker-rgb` 추가 + Tailwind `<alpha-value>` 패턴 |
| `editor-accent-hover` 분리 | hover 한 단계 진한 톤 (`#6ba82d`) — 기존엔 hover 차이 없음 |
| arbitrary RGB 정리 | `EditorHeader` 룰러 토글의 `bg-[rgba(127,191,52,0.12)]` → `bg-editor-accent/10` |
| 사이드바 가변 폭 | `useUiPrefStore.sidebarWidth` (240~480, 기본 300) — localStorage version 3 |
| 사이드바 collapse | `ChevronsLeft/Right` 토글, 접힘 28px |
| 드래그 리사이즈 | 우측 4px 핸들, `draftWidth` local state로 persist 과호출 방지 |
| **요소(클립아트) 메뉴 복원** | `ToolBar.tsx`에서 주석처리된 SHAPE 메뉴 복원 + `AppElement.tsx` 실제 API 로드 구현 |

**검증**: opacity modifier (`bg-editor-accent/10`)가 정확히 `rgba(127,191,52,0.1)`로 렌더링됨. localStorage version 2 → 3 마이그레이션 정상. 드래그 300→400px 시 캔버스 자동 재정렬. "요소" 메뉴 노출 및 클립아트 그리드 렌더링 확인.

**요소 메뉴 복원 상세**:
- 원인: `ToolBar.tsx`의 `ALL_MENUS`에서 SHAPE 메뉴가 주석처리되어 있었음
- `AppElement.tsx`가 `useState([])` 플레이스홀더로만 구성되어 실제 콘텐츠가 없었음
- 복원: `{ type: 'SHAPE', label: '요소', icon: Shapes }` 주석 해제
- 기능 구현: `contentsApi.getElements()` REST API 호출 + 디바운스 검색 + 그리드 렌더링 (`AppFrame.tsx` 패턴 참고)
- 관리자 페이지의 "클립아트 관리"에서 등록한 리소스가 `isCustomer` 권한으로 표시됨

### 6.1 2026-04-29 세션

총 8건 커밋 머지 + Vercel 배포 (`editor.papascompany.co.kr`).

| 커밋 | 영향 |
|---|---|
| `fd8a77b` | API: SynthesisWebhookPayload `sessionId?` additive (PHP 호환) |
| `d76b41e` | canvas-core: ruler 색상 D3 (이후 후속에서 더 절제 톤으로 갱신) |
| `cfa4e94` | EditorHeader 화이트 + 미리캔버스 풍 + 룰러 토글 도입 |
| `638d3a8` | 룰러 닫기 버그 fix + 캔버스 가운데 정렬 + Pretendard + lucide (1차) |
| `8a14279` | 텍스트 패널 가독성 (AppSection / FontPreviewDropdown) |
| `5fe2ad5` | phosphor → lucide 일괄 (45개 파일) |
| `ec03fa9` | tools/App polish + FeatureSidebar 다듬기 |
| `1b162b8` | 문서 갱신 |

### 6.2 2026-04-29 디자인 변경 요약

**헤더**
- 보라 그라데이션 (`from-violet-200 to-white`) → 화이트 + `border-b gray-200 + shadow-sm`
- 좌측 [Storige 로고 + Undo/Redo + AutoSaveIndicator]
- 중앙 [작업명 + 사이즈 pill]
- 우측 [룰러 토글 + 보기 옵션 + 불러오기 + 편집완료 녹색 CTA]
- 편집완료/불러오기 버튼 높이 통일 (h-9)

**룰러**
- 시작 시 자동 ON → **기본 OFF + 토글 버튼**
- 색상 절제 (gray-400 + gray-300 + gray-100)
- 폰트 monospace → sans-serif
- highlight 색상 → 브랜드 녹색 #7fbf34
- 닫기 시 잔상 버그 fix

**아이콘**
- phosphor-icons → lucide-react 전수 교체 (45개 파일)
- `Lucide as Phosphor` alias 패턴 (사용처 JSX 변경 없음)

**폰트**
- Pretendard Variable 한글 기본
- letter-spacing -0.01em

**컴포넌트 일관성**
- `tool-header p-4 gap-6` → `px-4 pt-4 pb-3`
- 중복 title 제거 (FeatureSidebar 헤더에 라벨 있음)
- AppSection 섹션 사이 `border-b border-gray-100`
- FontPreviewDropdown trigger `rounded-md` + 깔끔한 hover

**캔버스**
- ResizeObserver로 컨테이너 크기 변화 감지 → 가운데 정렬

---

## 7. 가이드라인 — 후속 작업자를 위한 권장사항

### 7.1 새 도구 메뉴 추가

1. `apps/editor/src/tools/AppXxx.tsx` 생성 (AppText 참고)
2. **자체 title `<span>` 추가하지 말 것** (FeatureSidebar 헤더가 처리)
3. **`<hr>` 직접 추가하지 말 것** (AppSection이 자체 border-b)
4. 첫 CTA 버튼은 `variant="default"` (브랜드 녹색)
5. Placeholder/empty state는 `text-gray-400 text-xs`
6. AppSection으로 콘텐츠 구분
7. `ToolBar.tsx`의 `ALL_MENUS` + `FeatureSidebar.tsx`의 `renderToolPanel()`에 등록

### 7.2 새 패널 / 폼 추가

```tsx
// 권장 패턴
<div className="w-full h-full flex flex-col">
  <div className="px-4 pt-4 pb-3">
    <Button variant="default" className="w-full h-10 rounded-md shadow-sm">
      <Icon className="h-4 w-4 mr-2" />
      Primary Action
    </Button>
  </div>

  <div className="sections flex flex-col">
    <AppSection title="섹션1">
      ...
    </AppSection>
    <AppSection title="섹션2">
      ...
    </AppSection>
  </div>
</div>
```

### 7.3 아이콘 사용

```ts
// ✅ 좋은 예
import { ChevronDown, Search, AlertCircle } from 'lucide-react'

// ✅ 호환 alias (기존 코드 마이그레이션 시)
import { ChevronDown as CaretDown } from 'lucide-react'

// ❌ 절대 사용 금지 (phosphor)
import { CaretDown } from '@phosphor-icons/react'
```

### 7.4 색상 사용 (2026-04-30 갱신)

```tsx
// ✅ 브랜드 색 — 디자인 토큰 (opacity modifier 모두 지원)
className="bg-editor-accent text-white"           // 솔리드 CTA
className="bg-editor-accent/10 text-editor-accent" // 10% 배경 + 솔리드 텍스트
className="bg-editor-accent/20"                   // 20% 배경 (hover 등)
className="ring-editor-accent/50"                 // 50% 링
className="hover:bg-editor-accent-hover"          // 한 단계 진한 hover (#6ba82d)
className="text-editor-accent"                    // 솔리드 텍스트

// ✅ 그레이 스케일 — Tailwind preset
className="text-gray-400 text-xs"                 // muted
className="text-gray-700 font-semibold"           // 본문
className="border-gray-100"                       // 가벼운 구분선
className="border-gray-200 shadow-sm"             // 표준 보더

// ❌ 더는 사용 금지 (arbitrary RGB)
className="bg-[rgba(127,191,52,0.12)]"            // → bg-editor-accent/10
className="text-[#7fbf34]"                        // → text-editor-accent
```

### 7.5 새 사용자 선호 추가

`useUiPrefStore`에 추가 + version 증가 + 마이그레이션 처리:

```ts
// useUiPrefStore.ts
interface UiPrefState {
  // ... 기존
  newPref: SomeType
  setNewPref: (v: SomeType) => void
}

export const useUiPrefStore = create<UiPrefState>()(
  persist(
    (set, get) => ({
      // ... 기존
      newPref: defaultValue,
      setNewPref: (newPref) => set({ newPref }),
    }),
    {
      name: 'storige-ui-pref',
      version: 3,  // ← 증가
      migrate: (state, version) => {
        if (version < 3) {
          (state as any).newPref = defaultValue
        }
        return state
      },
    }
  )
)
```

### 7.6 캔버스 사이즈 동기화

- `EditorView.tsx`의 ResizeObserver useEffect가 자동 처리
- `editor.emit('sizeChange', {...})`로 다른 plugin에 알림
- 새 plugin이 사이즈 의존적이면 `editor.on('sizeChange', ...)` 구독

### 7.7 룰러 관련 작업

- 룰러 색상 변경: `packages/canvas-core/src/ruler/constants.ts` `RULER_DEFAULTS`
- 룰러 토글 동작: `useUiPrefStore.showRuler` + `EditorView`의 useEffect
- **disable 시 반드시 canvas clearRect** (잔상 방지)
- 새 plugin이 ruler에 의존하면 `editor.getPlugin<RulerPlugin>('RulerPlugin')`로 접근

### 7.8 빌드 / 개발 서버

```bash
# 의존성 설치 (worker의 canvas 네이티브 빌드는 Node 25에서 실패하므로 필터링)
pnpm install --filter "@storige/editor..." --prefer-offline --ignore-scripts

# canvas-core 빌드 (editor가 dist를 import하므로 필수)
cd packages/types && tsc -p tsconfig.cjs.json && tsc -p tsconfig.esm.json
cd packages/canvas-core && tsc

# 에디터 dev 서버
pnpm --filter @storige/editor dev    # → http://localhost:3000

# Vercel 배포
git push origin master                # → 자동 빌드 + editor.papascompany.co.kr alias
vercel ls                            # 배포 상태 확인
```

⚠️ **주의**: vite optimizer cache (`node_modules/.vite/`)가 stale 상태일 때 import 실패 발생. lucide 같이 이름 바뀐 모듈 추가 시 cache clear 필요:
```bash
rm -rf apps/editor/node_modules/.vite
```

---

## 8. 알려진 한계 / 후속 작업 후보

### 8.0 완료 (2026-04-30)
- ✅ **Tailwind opacity modifier 지원** — RGB-triplet (`--color-primary-rgb`) + `<alpha-value>` 패턴 적용
- ✅ **편집완료 hover 색상 분리** — `--color-primary-darker: #6ba82d` 신규 + `editor-accent-hover` 매핑
- ✅ **사이드바 너비 가변** — 240~480px 드래그 리사이즈 + collapse 토글, localStorage 영속
- ✅ **요소(클립아트) 메뉴 복원** — ToolBar SHAPE 메뉴 주석 해제 + AppElement.tsx REST API 로드 구현
- ✅ **트랙 A — 즉시 처리 묶음 (1시간 이내)**
  - 사이즈 pill 인터랙티브화 (Popover + 8개 프리셋 + 직접 입력, 10~1500mm 범위, `updateAllWorkspaceSettings()`로 캔버스 동기화)
  - Undo/Redo disabled 바인딩 — 캔버스의 `canUndo()/canRedo()` + Editor `historyUpdate` 이벤트 구독으로 버튼 disabled 상태 자동 갱신
  - 사이드바 collapse 단축키 — `Cmd+\` (Mac) / `Ctrl+\` (Win) 윈도우 키리스너, 입력 필드 포커스 시 자동 무시

> 후속 작업 §8.2의 **D2-NEW** (메뉴 아이콘 PNG 업로드)는 2026-04-30 개발 계획에서 **취소**됨.

### 8.1 즉시 처리 가능 (1시간 이내)
- ~~사이즈 pill 인터랙티브화~~ ✅ 완료 (2026-04-30, 트랙 A)
- ~~Undo/Redo disable 로직~~ ✅ 완료 (2026-04-30, 트랙 A) — 캔버스 `canUndo/canRedo` + `historyUpdate` 이벤트 구독
- ~~사이드바 collapse 단축키~~ ✅ 완료 (2026-04-30, 트랙 A) — `Cmd+\` / `Ctrl+\` 윈도우 키리스너
- ~~편집완료 hover 검증~~ ✅ 완료 (2026-04-30, 트랙 A) — `.hover\:bg-editor-accent-hover:hover` 규칙이 `rgb(var(--color-primary-darker-rgb))` = `#6ba82d`로 정확히 컴파일됨
- **빈 상태 재진입 시 Undo 버튼 미동기 보정** — `HistoryPlugin.afterLoad`가 `clearHistory` 후 `historyUpdate`를 호출하지만, 사용자 첫 클릭 전에 캔버스 내부 스택이 0/0인데 React state가 stale인 케이스가 드물게 발생. 첫 액션 후 자동 보정되므로 critical 아님

### 8.2 중간 작업 (1~3시간)
- **D5** — 표지 편집 모드별 view 분기 (펼침면/분할/날개 케이스, `agents/12-cover-edit-modes.md`)
- **AppSection 외부 제어 통일** — 각 도구 패널의 섹션이 어느 것이 펼쳐졌는지 store 영속 (`useUiPrefStore.expandedSections: Record<string, boolean>`) → 새로고침 후에도 사용자가 마지막에 펼친 섹션 유지
- **드래그 핸들 더블 클릭 → 기본값 복원** — 사이드바 폭을 정확히 300으로 되돌리는 일반적 UX 패턴
- **lucide tree-shaking 점검** — 현재 45개 파일에서 import. 빌드 결과 번들에서 미사용 아이콘 제거되는지 `vite build --mode analyze` 확인

### 8.3 대형 작업 (1일+)
- **반응형 레이아웃** — 모바일(≤768) 슬라이드아웃 사이드바, 태블릿(769-1024) 헤더 wrap, 데스크톱(1025+) 풀 레이아웃. 사이드바 가변 폭 도입으로 모바일 대응 시 `min-width` 제약을 깰 수 있는 분기 처리 필요
- **콘텐츠 패널 그리드 카탈로그** — 미리캔버스 풍 카테고리 탭 + 그리드 + 크라운 아이콘 등 본격 카탈로그 UI (D2-NEW 취소됨에 따라 별도 트랙으로 검토)
- **AI 패널 정합** — 현재는 ToolBar에 없음. AI 도구 메뉴 추가 + 패널 통합
- **다크 모드** — `:root` 외 `[data-theme="dark"]` 셀렉터로 전체 토큰 재정의. RGB triplet 도입했으니 토큰 셋만 갈아끼면 opacity 변형도 자동 작동

---

## 9. 트러블슈팅

### 9.1 룰러가 안 사라짐
→ `disable()`에 `clearRect` 빠진 버전. canvas-core 재빌드:
```bash
cd packages/canvas-core && tsc
```

### 9.2 lucide 아이콘이 "does not provide an export" 에러
→ vite optimizer cache stale. 재시작 + cache clear:
```bash
rm -rf apps/editor/node_modules/.vite
pnpm --filter @storige/editor dev
```

### 9.3 캔버스가 한쪽에 치우침
→ 마운트 시 컨테이너 dim 고정 버그. EditorView의 ResizeObserver useEffect 확인.

### 9.4 vite 부팅 시 `vite: command not found`
→ pnpm install 안 됨. worker의 canvas 네이티브 빌드가 막아서 일부만 설치된 상태. editor만 좁혀서 설치:
```bash
pnpm install --filter "@storige/editor..." --prefer-offline --ignore-scripts
```

### 9.5 한글 폰트가 Noto Sans KR로 표시
→ Pretendard CDN 로드 실패 가능성. DevTools Network 탭에서 `pretendardvariable-dynamic-subset.min.css` 로드 확인. CSP 설정 점검.

### 9.6 로컬에서 Storige API 호출 실패 (FontManager 등)
→ 로컬 dev는 `https://api.papascompany.co.kr` (운영) 호출. 인증 토큰 없으면 일부 API 실패 (FontManager/EditSession 등). 콘솔 에러 무시 가능, 시각/동작 검증에는 영향 없음.

### 9.7 사이드바 폭이 저장되지 않음 / 이상한 값으로 복원
→ localStorage `storige-ui-pref` 의 `version: 3` 미만이면 마이그레이션 진입. 저장 폭이 240~480 범위를 벗어나면 setter에서 자동 clamp.
```js
// 강제 초기화
localStorage.removeItem('storige-ui-pref')
window.location.reload()
```

### 9.8 드래그 중 사이드바가 깜빡임
→ `transition` 클래스가 드래그 중에도 적용되면 발생. `FeatureSidebar.tsx`에서 `draftWidth == null`일 때만 transition 클래스를 부여하는지 확인.

### 9.9 `bg-editor-accent/N` opacity가 회색으로 표시
→ Tailwind config에서 RGB triplet 패턴이 누락된 상태. `tailwind.config.js`의 `editor.accent` 정의가 `'rgb(var(--color-primary-rgb) / <alpha-value>)'` 인지 확인. `--color-primary-rgb: 127 191 52` (공백 구분, 콤마 X) 도 함께 확인.

---

## 10. 참고 — 관련 파일 인덱스

```
apps/editor/
├── package.json                              ← 의존성 (lucide-react, etc.)
├── tailwind.config.js                        ← 색상 매핑
├── tsconfig.json                             ← TS 설정
├── vite.config.ts                            ← Vite 설정
├── index.html                                ← 진입 HTML
└── src/
    ├── main.tsx                              ← React 진입 (BrowserRouter)
    ├── App.tsx                               ← 라우팅
    ├── embed.tsx                             ← iframe 임베드 진입
    ├── index.css                             ← 디자인 토큰 (CSS 변수) + Pretendard import
    ├── views/
    │   ├── EditorView.tsx                    ← 메인 (캔버스 + 사이드바)
    │   ├── TemplateEditorView.tsx
    │   ├── BrowseContentsView.tsx
    │   └── UnauthorizedView.tsx
    ├── components/
    │   ├── editor/
    │   │   ├── EditorHeader.tsx              ← 상단 헤더
    │   │   ├── ToolBar.tsx                   ← 좌측 도구 nav
    │   │   ├── FeatureSidebar.tsx            ← 도구 패널 컨테이너
    │   │   ├── SidePanel.tsx                 ← 객체 속성 패널
    │   │   ├── ControlBar.tsx                ← 객체 컨트롤
    │   │   ├── AutoSaveIndicator.tsx
    │   │   ├── ElementLockControl.tsx
    │   │   └── ReadOnlyBanner.tsx
    │   ├── AppSection.tsx                    ← 섹션 collapsible
    │   ├── FontPreviewDropdown.tsx           ← 폰트 드롭다운
    │   ├── PageNavigation/
    │   │   ├── BookNavigation.tsx            ← 페이지 썸네일 네비
    │   │   └── PageNavigation.tsx
    │   ├── PagePanel/
    │   │   ├── PagePanel.tsx
    │   │   ├── SpreadPagePanel.tsx
    │   │   └── PageItem.tsx
    │   ├── ColorPicker/                      ← 색상 선택 모달
    │   ├── TemplatePanel/                    ← 템플릿 선택
    │   ├── AiPanel/                          ← AI 추천/생성
    │   ├── Mockup3D/                         ← 3D 책 미리보기
    │   ├── SpineEditor/                      ← 책등 편집
    │   ├── modals/                           ← 각종 모달
    │   └── ui/                               ← shadcn/ui 베이스
    ├── tools/
    │   ├── AppText.tsx                       ← 텍스트 도구
    │   ├── AppImage.tsx
    │   ├── AppBackground.tsx
    │   ├── AppTemplate.tsx
    │   ├── AppFrame.tsx
    │   ├── AppElement.tsx
    │   ├── AppEdit.tsx
    │   ├── AppClipping.tsx
    │   └── SmartCodes.tsx                    ← QR/바코드
    ├── controls/
    │   ├── TextAttributes.tsx                ← 텍스트 속성
    │   ├── ObjectFill.tsx
    │   ├── ObjectStroke.tsx
    │   ├── ObjectShadow.tsx
    │   ├── ObjectSize.tsx
    │   ├── TextEffect.tsx
    │   └── SpecialEffect.tsx
    ├── stores/
    │   ├── useAppStore.ts                    ← 캠버스/Editor 인스턴스 + active selection
    │   ├── useSettingsStore.ts               ← artwork/settings/spread
    │   ├── useUiPrefStore.ts                 ← 사용자 선호 (룰러 ON/OFF, 페이지 네비 위치)
    │   ├── useAuthStore.ts                   ← 로그인 상태
    │   ├── useImageStore.ts
    │   └── useSaveStore.ts
    ├── hooks/
    │   ├── useEditorContents.ts              ← 콘텐츠 로드 (templateSet/product/etc.)
    │   ├── useWorkSave.ts                    ← 작업 저장
    │   ├── useResolvedPageNavPosition.ts     ← 페이지 네비 위치 계산
    │   └── useFontPreview.ts
    ├── utils/
    │   ├── createCanvas.ts                   ← Fabric 캠버스 + plugins 초기화
    │   ├── fontManager.ts
    │   └── spineCalculator.ts
    └── types/
        ├── menu.ts                           ← AppMenu (icon: LucideIcon)
        └── ...

packages/canvas-core/src/
├── Editor.ts                                 ← Editor 코어 (plugins.use/getPlugin)
├── plugins/
│   ├── HistoryPlugin.ts                      ← Undo/Redo
│   ├── RulerPlugin.ts                        ← Ruler 래퍼
│   ├── WorkspacePlugin.ts
│   ├── FontPlugin.ts
│   └── ...
└── ruler/
    ├── ruler.ts                              ← CanvasRuler (별도 캔버스 오버레이)
    ├── constants.ts                          ← RULER_DEFAULTS (색상 토큰)
    ├── guideline.ts
    └── types.ts
```

---

**문서 끝**. 후속 작업 시 본 문서를 함께 갱신할 것.
