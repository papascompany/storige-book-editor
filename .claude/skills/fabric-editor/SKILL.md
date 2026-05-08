---
name: fabric-editor
description: Storige fabric.js 5.x 기반 캔버스 편집기 작업 — 객체 추가/조작, 플러그인 작성, 모바일 터치 UX, 좌표/단위 변환, 저장·렌더 파이프라인. canvas-core 패키지 또는 apps/editor 의 도구·컨트롤·플러그인을 만지는 모든 작업에서 사용.
---

# Fabric.js 편집기 스킬

Storige 에디터의 캔버스 레이어 (`packages/canvas-core` + `apps/editor/src/{tools,controls,components/editor}`) 를 다루는 작업의 가이드.

## 언제 사용

- `fabric` 모듈을 import 하거나 `fabric.Canvas/Object/IText/Image` 를 만지는 코드
- `apps/editor/src/tools/*` (텍스트/이미지/요소/배경/프레임/템플릿 추가)
- `apps/editor/src/controls/*` (선택된 객체의 속성 편집 패널)
- `packages/canvas-core/src/plugins/*` (Editor 플러그인 작성/수정)
- 모바일/터치 UX, 캔버스 줌·팬, 좌표/단위 변환, 저장·복원

## 핵심 아키텍처

```
Editor (EventEmitter)
  ├─ canvas: fabric.Canvas
  ├─ plugins: Map<name, PluginBase>     ← editor.use(plugin)
  └─ contextMenu: ContextMenu

PluginBase
  ├─ _canvas (fabric.Canvas)
  ├─ _editor (Editor)
  ├─ name, events, hotkeys
  └─ mounted/destroyed/beforeLoad/afterLoad/beforeSave/afterSave
```

플러그인은 `editor.use(plugin)` 으로 등록되고 `editor.getPlugin<T>('PluginName')` 으로 접근. 등록 순서가 중요하다 — `WorkspacePlugin` 이 먼저 init 되어야 다른 플러그인이 워크스페이스 객체를 찾을 수 있음 (`apps/editor/src/utils/createCanvas.ts`).

## 객체 추가의 정형 패턴

**텍스트** (`apps/editor/src/tools/AppText.tsx`):

```ts
canvas.offHistory()                      // history 일시 정지

const fabricModule = await import('fabric') as any
const fabric = fabricModule.fabric || fabricModule.default || fabricModule

const text = new fabric.IText('TEXT', {
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: 통상 워크스페이스 짧은변의 10%,
  id: uuid(),                            // 모든 객체는 id 필수
  originX: 'center', originY: 'center',
  left: workspace.getCenterPoint().x,
  top: workspace.getCenterPoint().y,
})

const fontPlugin = getPlugin<FontPlugin>('FontPlugin')
await fontPlugin?.applyFont(DEFAULT_FONT_FAMILY, text)

canvas.onHistory()                       // history 재개
canvas.add(text)
canvas.setActiveObject(text)
canvas.requestRenderAll()                // ← renderOnAddRemove: false 라 필수!

if (isCoarsePointer) tapMenu(null)       // 모바일: 사이드바 자동 닫기
```

**이미지** — `core.addImageFromURL` 헬퍼 사용:

```ts
const { core } = await import('@storige/canvas-core')
const img = await core.addImageFromURL(canvas, src, {
  left: workspaceCenter.x, top: workspaceCenter.y,
  originX: 'center', originY: 'center',
  centerInWorkspace: false,
  setActive: true,
})
canvas.requestRenderAll()
```

**필수 체크리스트**:
1. 모든 객체에 `id: uuid()` — `extensionType` 도 비워둘 거면 명시적으로 비움
2. `canvas.add()` 후 반드시 `canvas.requestRenderAll()` (renderOnAddRemove: false)
3. workspace 위치 기준 좌표는 `workspace.getCenterPoint()` 로
4. 폰트가 있으면 `FontPlugin.applyFont()` 로 로드 보장
5. 모바일에서는 추가 후 `tapMenu(null)` 로 사이드바 닫기

## 객체 분류 규약

`extensionType` 으로 시스템/사용자 객체 구분 — **선택 가능 여부, 저장 여부, 정렬 등에 영향**:

| extensionType / id | 의미 | ControlBar/Selection |
|---|---|---|
| `id === 'workspace'` | 워크스페이스 박스 | 사용자 선택 제외 |
| `extensionType === 'background'` | 배경 | ControlBar 표시 안 함 |
| `extensionType === 'clipping'` | 클리핑 마스크 | 사용자 선택 제외 |
| `extensionType === 'guideline'` | 가이드라인 | 시스템 객체 |
| `extensionType === 'overlay'` | 컷/세이프 보더 등 | 줌 시 일시 숨김 |
| `extensionType === 'frame'` | 프레임 | workspace 와 다른 처리 |
| `extensionType === 'cutline-template'` | 커팅 템플릿 | 자동 클립 |
| (없음) | 일반 사용자 객체 | 정상 처리 |

**사용자 객체 판단 헬퍼** (controls/sidebar 분기에 사용):
```ts
const isUserObject =
  obj?.extensionType !== 'background' &&
  obj?.extensionType !== 'clipping' &&
  obj?.extensionType !== 'guideline' &&
  obj?.id !== 'workspace'
```

## Fabric Canvas 옵션 (Storige 디폴트)

`packages/canvas-core/src/utils/factory.ts` 의 `createFabricCanvas`:

```ts
{
  fireRightClick: false,
  stopContextMenu: true,
  controlsAboveOverlay: true,
  selection: true,
  preserveObjectStacking: true,
  renderOnAddRemove: false,         // ← add 후 수동 requestRenderAll 필수
  skipOffscreen: true,
  enableRetinaScaling: true,
  allowTouchScrolling: false,       // 터치 스크롤 누수 차단
}
```

`(pointer: coarse)` 디바이스에서 `Object.prototype` 컨트롤이 자동 확대됨:
- `cornerSize: 16`, `touchCornerSize: 36`, `padding: 8`, `borderScaleFactor: 2`

## 객체 선택 핸들 (커스텀 컨트롤)

`packages/canvas-core/src/plugins/ControlsPlugin.ts` 가 `fabric.Object.prototype.controls` 의 각 컨트롤에 커스텀 `render` 함수를 idempotent 하게 주입한다.

| 컨트롤 키 | 모양 | 의미 |
|---|---|---|
| `tl` `tr` `bl` `br` | **원형** (Ø`cornerSize`) | 자유 리사이즈 — 코너 = 둥근 핸들 |
| `ml` `mr` | **세로 캡슐** (`PILL_SHORT`×`PILL_LONG`) | 가로 방향 스케일/스큐 |
| `mt` `mb` | **가로 캡슐** (`PILL_LONG`×`PILL_SHORT`) | 세로 방향 스케일/스큐 |
| `mtr` | **객체 아래 원형 + 회전 화살표** (`offsetY: +36`) | 회전 — 텍스트/이미지 위 가려짐 방지 |

색상은 `cornerColor` (fill) / `cornerStrokeColor` (stroke) prototype 값을 그대로 따라 light/dark 테마와 자동 동기화.

**디자인 토큰** (`ControlsPlugin.ts` 상단 상수):

```
CORNER_DIAMETER = 12     PILL_SHORT = 7      PILL_LONG = 22
HANDLE_STROKE   = 1.5    ROTATE_HANDLE_R = 11   ROTATE_HANDLE_OFFSET = 36
```

**원칙**:
- 회전 아이콘은 **객체 angle 을 따라가지 않음** (화면 기준으로 그려야 직관적). 코너/변 핸들은 angle 따라 회전.
- `cornerSize` 가 터치 환경에서 16+ 로 커지면 캡슐도 비례 확대 (`scale = cornerSize / CORNER_DIAMETER`).
- prototype 수정은 **한 번만** 적용 (`customControlsApplied` 플래그). 여러 캔버스 init 때 중복 안 됨.
- 변 핸들은 텍스트(`i-text`)에서 `lockUniScaling: true` 로 자동 숨김 → 코너만 활성.

## 플러그인 작성 패턴

```ts
import { PluginBase } from '../plugin'
import Editor from '../Editor'

class MyPlugin extends PluginBase {
  name = 'MyPlugin'
  events = ['myCustomEvent']
  hotkeys: CanvasHotkey[] = []

  // 이벤트 핸들러 참조를 반드시 멤버로 보관 — cleanup 위해
  private _boundHandler: ((opt: fabric.IEvent) => void) | null = null

  constructor(canvas: fabric.Canvas, editor: Editor) {
    super(canvas, editor, {})
    this.init()
  }

  private init() {
    this._boundHandler = (opt) => {
      // ...
    }
    this._canvas.on('mouse:down', this._boundHandler)
  }

  // dispose 가 호출되면 모든 listener 를 명시적으로 off
  dispose() {
    if (this._boundHandler) {
      this._canvas.off('mouse:down', this._boundHandler)
      this._boundHandler = null
    }
  }
}
```

**금기 사항**:
- 익명 함수로 `canvas.on(...)` 등록 → off 불가능 → 메모리 누수
- `dispose()` 안 만들기 → React Strict Mode 이중 마운트에서 listener 누적
- `this._canvas` 가 dispose 되었을 때 `getContext()` 호출 → TypeError

## 좌표/단위 변환

mm ↔ px 변환은 `WorkspacePlugin._options.unit + dpi` 기준:

```ts
import { ptToPx, mmToPx } from '@storige/canvas-core'
const fontSizePx = ptToPx(120, settings.dpi /* 150 */)
```

`save.ts` 에서 mm 단위로 영구 저장 / 화면 표시는 px → mm `mmToPxDisplay()` 사용.

## 도구 메뉴 화이트리스트 (템플릿셋별)

좌측 ToolBar 도구 메뉴는 템플릿셋(상품) 단위로 노출 여부를 제어할 수 있다.

**데이터 흐름**

```
template_sets.enabled_menus (JSON, nullable)
   ↓ admin 의 체크박스 토글 (TemplateSetForm.tsx)
   ↓ API: TemplateSet CRUD DTO (template-set.dto.ts)
   ↓ editor: loadTemplateSetEditor() 가 templateSet.enabledMenus 추출
   ↓ useSettingsStore.setEnabledMenus(menus)
   ↓ ToolBar 가 useSettingsStore.enabledMenus 구독해 ALL_MENUS 필터링
```

**핵심 단일 소스**: [`packages/types/src/index.ts`](../../packages/types/src/index.ts)
- `EditorMenuKey`: 'UPLOAD'|'CLIPPING'|'TEMPLATE'|'IMAGE'|'TEXT'|'SHAPE'|'BACKGROUND'|'FRAME'|'SMART_CODE'|'EDIT'|'AI'
- `EDITOR_MENU_DEFS`: admin 토글 UI 가 그대로 사용 (label, description, requiresFlag 메타)
- `ALL_EDITOR_MENU_KEYS`, `resolveEnabledMenus()`, `isMenuEnabled()` 헬퍼

**의미**

| 값 | 의미 |
|---|---|
| `null` / `undefined` | 모든 메뉴 노출 (기본/legacy) |
| `EditorMenuKey[]` | 화이트리스트 — 그 키만 노출 |
| `[]` | 모두 숨김 (극단적 케이스) |

**원칙**
- `editMode === true` (admin 편집 미리보기) 에서는 화이트리스트 무시 → 전체 노출. 빌드 플래그(`VITE_ENABLE_*`) 와 화이트리스트는 **AND** 관계.
- 새 도구 추가 시 `EditorMenuKey` + `EDITOR_MENU_DEFS` + `ToolBar.ALL_MENUS` 세 곳만 갱신하면 admin 체크박스 UI 가 자동 갱신.
- 화이트리스트 저장 순서는 무시 — Admin form 이 항상 `EDITOR_MENU_DEFS` 순서로 정렬해 저장.

**관련 파일**

| 파일 | 역할 |
|---|---|
| `packages/types/src/index.ts` | `EditorMenuKey` / `EDITOR_MENU_DEFS` 단일 소스 |
| `apps/api/src/templates/entities/template-set.entity.ts` | `enabled_menus` JSON 컬럼 |
| `apps/api/src/templates/dto/template-set.dto.ts` | Create/Update DTO 검증 (`@IsIn(ALL_EDITOR_MENU_KEYS)`) |
| `apps/api/migrations/20260508_add_template_sets_enabledMenus.sql` | 운영 DB 마이그레이션 |
| `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` | 토글 + 체크박스 UI |
| `apps/editor/src/stores/useSettingsStore.ts` | `enabledMenus` 상태 + `setEnabledMenus()` |
| `apps/editor/src/hooks/useEditorContents.ts` | `loadTemplateSetEditor` 에서 setter 호출 |
| `apps/editor/src/components/editor/ToolBar.tsx` | 화이트리스트 적용 + UPLOAD 별도 처리 |

## 워크스페이스 정렬 & 뷰포트

캔버스 영역 폭이 바뀔 때(사이드 메뉴 토글, 사이드바 드래그 리사이즈, 객체 선택 시 ControlBar 등장, 윈도우 리사이즈) 편집중인 페이지(workspace)는 항상 새 영역의 중앙으로 재배치되어야 한다. `setDimensions` 만 호출하면 viewport 가 그대로라 페이지가 한쪽으로 치우친다.

**구현 위치**: [`apps/editor/src/views/EditorView.tsx`](../../apps/editor/src/views/EditorView.tsx) — ResizeObserver `apply()` 내부.

**API 매핑**:

| API | 동작 | 사용 시점 |
|---|---|---|
| `WorkspacePlugin.setCenterPointOf(workspace)` | 줌은 그대로 두고 viewportTransform[4][5] 만 조정해 객체를 캔버스 중앙으로 이동 | 페이지가 현재 줌에서 영역에 들어가는 경우 |
| `WorkspacePlugin.setZoomAuto(scale?)` | 자동 맞춤 — 캔버스 폭에 맞춰 줌과 중앙 위치 모두 재계산 (`zoomRatio * 0.98 ≈ 78%`) | 페이지가 영역을 넘어가는 경우 / 첫 마운트 / 사이즈 옵션 변경 후 |

**판정 로직** (재정렬 분기):

```ts
const wsScreenW = ws.width * ws.scaleX * canvas.getZoom()
const wsScreenH = ws.height * ws.scaleY * canvas.getZoom()
const PADDING = 0.95   // 5% 여백 — 자동맞춤↔중앙이동 진동 방지
const fits = wsScreenW <= canvas.getWidth() * PADDING
          && wsScreenH <= canvas.getHeight() * PADDING
fits ? plugin.setCenterPointOf(ws) : plugin.setZoomAuto()
```

**원칙**:
- 첫 마운트(`isFirstApply`)는 스킵 — `WorkspacePlugin.reset()` 의 `setZoomAuto()` 가 이미 처리.
- 가능하면 사용자의 줌을 유지 → 작업 위치 보존.
- 줌 유지가 불가능할 때(페이지가 새 영역을 넘어감)만 자동맞춤으로 떨어뜨려 페이지 전체가 보이게.
- ResizeObserver 는 RAF 1 프레임 1회 적용으로 합쳐 무한 루프 방지(이전 폭 캐시 + 1px 미만 변동 무시).

## 저장 / 복원

- 저장: `canvas.toObject([...extraProps])` → JSON
- 복원: `canvas.loadFromJSON(json, callback)`
- 추가 프로퍼티 보존: `canvas.toObject(['id', 'extensionType', 'selectable', 'evented', ...])`
- workspace 와 background 같은 시스템 객체는 별도 처리 — `WorkspacePlugin.beforeSave/afterLoad`

## 모바일/터치 UX 규약

[`docs/MOBILE_TOUCH_UI.md`](../../docs/MOBILE_TOUCH_UI.md) 참조 — **반드시 준수**:

1. **레이아웃 분기**: `screenMode` (폭 기준) 사용 — `apps/editor/src/views/EditorView.tsx`
2. **입력 디바이스 분기**: `useIsCoarsePointer()` (`apps/editor/src/hooks/useIsCoarsePointer.ts`) — pointer:coarse 미디어쿼리 기반
3. **터치 hit-area 최소 44x44px** (Apple HIG) / 48x48px (Material) — 단축은 `[@media(pointer:coarse)]:h-12 [@media(pointer:coarse)]:w-12`
4. **추가 직후 사이드바 닫기**: `if (isCoarsePointer) tapMenu(null)`
5. **ControlBar는 모바일에서 하단 시트** (50vh, fixed bottom-0) — main 영역에 `pb-[50vh]` 보정
6. **CSS**: 캔버스 컨테이너에 `touch-action: none; user-select: none; -webkit-touch-callout: none`

### 절대 만들지 말 것

- **ResizeObserver 콜백 안에서 자기 자신을 키울 setDimensions** → iOS Safari 무한 루프 크래시. 직전 크기 캐시 + RAF 로 합쳐 1프레임 1회만 적용.
- **TouchEvent 를 MouseEvent 로 캐스팅 후 `evt.clientX`** → `undefined`. `e.touches?.[0] ?? e.changedTouches?.[0]` 폴백 필수.
- **`fixed inset-0` 백드롭에 `onClick` 만 두기** → 사용자가 의도한 캔버스 탭이 backdrop 으로 흡수.

## 자주 막히는 함정

| 증상 | 원인 / 해결 |
|---|---|
| 객체 추가했는데 화면에 안 나옴 | `canvas.add()` 후 `requestRenderAll()` 누락 — `renderOnAddRemove: false` 라 자동 렌더 안 됨 |
| 저장 후 복원 시 일부 속성 사라짐 | `toObject` 의 extraProps 에 해당 프로퍼티 추가 (예: `extensionType`, custom field) |
| Strict Mode 에서 캔버스가 두 번 생성 | `useEffect` cleanup 에서 `canvas.dispose()` 호출 + `useAppStore.getState().reset()` |
| 컨텍스트 메뉴가 모바일에서 안 뜸 | `stopContextMenu: true` 디폴트 — 모바일은 long-press 대체 UI 별도 구현 필요 |
| dispose 후 clearRect TypeError | `cvs.disposed = true` 플래그 후 dispose, 이후 접근 시 가드 |
| 객체 선택 후 ControlBar 가 캔버스를 가림 (모바일) | ControlBar mobile 모드 (하단 시트) + main 에 `pb-[50vh]` |
| 사이드 메뉴 펼치면 페이지가 한쪽으로 치우침 | `setDimensions` 만 부르고 viewport 보정 없으면 발생. `EditorView.tsx` ResizeObserver 의 워크스페이스 재정렬(`setCenterPointOf` / `setZoomAuto`) 로직 유지 필수 |

## 핵심 파일 빠른참조

| 파일 | 역할 |
|---|---|
| `packages/canvas-core/src/Editor.ts` | EventEmitter + plugin registry |
| `packages/canvas-core/src/plugin.ts` | `PluginBase` 추상 클래스 |
| `packages/canvas-core/src/utils/factory.ts` | `createFabricCanvas`, `configureFabricDefaults` |
| `packages/canvas-core/src/utils/canvas.ts` | `core.addImageFromURL` 등 헬퍼 |
| `packages/canvas-core/src/plugins/WorkspacePlugin.ts` | 워크스페이스/줌/컷보더 |
| `packages/canvas-core/src/plugins/HistoryPlugin.ts` | undo/redo |
| `packages/canvas-core/src/plugins/DraggingPlugin.ts` | space-drag panning (TouchEvent 호환) |
| `apps/editor/src/utils/createCanvas.ts` | 캔버스 + 모든 플러그인 부트스트랩 |
| `apps/editor/src/views/EditorView.tsx` | 마운트/리사이즈/cleanup, ResizeObserver |
| `apps/editor/src/stores/useAppStore.ts` | canvas/editor/selection 글로벌 상태 |
| `apps/editor/src/hooks/useIsCoarsePointer.ts` | 터치 디바이스 감지 |

## 빌드 / 테스트

```bash
pnpm --filter @storige/types build         # 1. 항상 먼저
pnpm --filter @storige/canvas-core build   # 2. 그 다음
pnpm --filter @storige/editor build        # 3. editor 빌드/dev
pnpm --filter @storige/editor lint
pnpm --filter @storige/editor test         # vitest unit
```

`canvas-core` 의 plugin 이나 utils 를 수정하면 `pnpm --filter @storige/canvas-core build` 를 다시 돌려야 editor 가 변경을 본다.

## 변경 시 반드시 실행하는 검증

1. `pnpm --filter @storige/canvas-core build` 통과
2. `pnpm --filter @storige/editor build` 통과
3. 데스크톱: 텍스트/이미지/요소 추가, 선택, 드래그, 리사이즈, undo/redo
4. 모바일 (pointer:coarse): 위 동작 + 사이드바 자동 닫힘 + 코너 핸들 손가락으로 잡힘
5. 페이지 빠르게 여러번 리사이즈해도 ResizeObserver 무한 루프 없음
