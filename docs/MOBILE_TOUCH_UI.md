# 모바일 터치 UI 가이드

> Storige 에디터의 모바일/태블릿(터치 입력 디바이스) UX 정의 및 구현 메모.
> 최초 작성: 2026-04-30 — `claude/fix-mobile-touch-ui-91nuI` 브랜치 작업의 산출물.

---

## 1. 배경

iPhone Safari / Android Chrome 등 터치 위주 환경에서 다음 문제가 보고됨:

1. **텍스트 객체는 추가되지만 선택이 되지 않음**
2. **이미지/요소(요소·도형) 추가 시 편집 화면에 반영되지 않음**
3. **몇 번 터치하면 화면이 멈추거나 다운됨**

원인은 **CSS 측 브라우저 기본 제스처 미차단**, **Fabric.js 측 터치 옵션 미설정**,
**모바일 UX 흐름(추가 직후 사이드바가 캔버스를 가림) 누락** 의 복합 문제였음.

---

## 2. 디자인 원칙

| 원칙 | 설명 |
|---|---|
| **터치 디바이스 감지는 폭이 아닌 pointer 종류로** | `(pointer: coarse)` 미디어 쿼리 — 외장 마우스/키보드 연결된 태블릿이나 큰 폰에서도 정확 |
| **브라우저 제스처 vs Fabric 제스처 충돌 차단** | 캔버스 컨테이너 전체에 `touch-action: none` 적용 — pinch-zoom·pan·long-press 콜아웃을 캔버스가 직접 처리 |
| **터치 hit-area 는 손가락 크기 기준** | Fabric 컨트롤 핸들의 `touchCornerSize` 를 데스크톱 기본 (~13px) 보다 크게 (36px) |
| **모바일 사이드바는 액션 직후 자동으로 닫힘** | 모바일에서는 사이드바가 캔버스 위 70~80%를 가리므로, 객체 추가 즉시 닫아 캔버스 노출 |

---

## 3. 구현 위치

### 3-1. 디바이스 감지

**`apps/editor/src/hooks/useIsCoarsePointer.ts`** (신규)

```ts
const isCoarsePointer = useIsCoarsePointer()
// → 터치 디바이스에서 true. matchMedia 변경 이벤트도 구독.
//   Safari < 14 의 addListener 폴백 포함.
```

**`packages/canvas-core/src/utils/factory.ts`**

```ts
function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}
```

### 3-2. CSS — 브라우저 제스처 차단

**`apps/editor/src/index.css`**

```css
.canvas-container,
.canvas-container canvas,
#canvas-containers,
#canvas-wrapper,
.canvas-container .upper-canvas {
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}

body {
  overscroll-behavior: none;          /* iOS bounce 차단 */
  -webkit-overflow-scrolling: touch;
  -webkit-tap-highlight-color: transparent;
}
```

### 3-3. Viewport meta

**`apps/editor/index.html`**

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0,
           minimum-scale=1.0, user-scalable=no, viewport-fit=cover"
/>
```

`user-scalable=no` 로 핀치 줌 차단 → 캔버스 줌과 충돌 방지.
`viewport-fit=cover` 로 노치/홈 인디케이터 영역까지 활용.

### 3-4. Fabric Canvas 옵션

**`packages/canvas-core/src/utils/factory.ts`**

```ts
const defaultOptions = {
  // ...기존 옵션
  allowTouchScrolling: false,   // 터치 시 페이지 스크롤로 새지 않게
}

// configureFabricDefaults() 내부 — coarse pointer 만 적용
if (isCoarsePointer()) {
  fabric.Object.prototype.cornerSize = 16
  fabric.Object.prototype.touchCornerSize = 36
  fabric.Object.prototype.padding = 8
  fabric.Object.prototype.borderScaleFactor = 2
}
```

### 3-5. DraggingPlugin — TouchEvent 안전 처리

**`packages/canvas-core/src/plugins/DraggingPlugin.ts`**

이전 코드는 `opt.e as MouseEvent` 로 캐스팅 후 `evt.clientX/Y` 직접 접근 →
TouchEvent 에서는 `clientX` 가 `undefined` 이라 panning 이 망가짐.

```ts
const getEventPoint = (e: any) => {
  if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY, altKey: !!e.altKey }
  const t = e.touches?.[0] ?? e.changedTouches?.[0]
  if (t) return { x: t.clientX, y: t.clientY, altKey: !!e.altKey }
  return { x: 0, y: 0, altKey: false }
}
```

### 3-6. 객체 추가 직후 모바일 사이드바 자동 닫기

**`apps/editor/src/tools/AppText.tsx`** / **AppImage.tsx** / **AppElement.tsx**

```ts
canvas.add(text)
canvas.setActiveObject(text)
canvas.requestRenderAll()           // ← renderOnAddRemove: false 캔버스 안전망

if (isCoarsePointer) {
  tapMenu(null)                     // 모바일에서는 사이드바를 닫아 캔버스 노출
}
```

`requestRenderAll()` 호출은 모든 디바이스에서 안전망 역할. 기존 텍스트 도구는
이 호출이 빠져 있어 일부 케이스에서 추가된 객체가 즉시 보이지 않음.

---

## 4. 화면 폭 vs 포인터 종류

기존 `EditorView.tsx` 의 `screenMode` (`mobile`/`tablet`/`desktop`) 는 **화면 폭** 기준
(`< 768px = mobile`). 레이아웃 분기에 적합하지만, **입력 디바이스 식별** 에는
부정확함:

| 케이스 | 화면 폭 | pointer | screenMode | isCoarsePointer |
|---|---|---|---|---|
| 데스크톱 모니터 | 1920px | fine | desktop | false |
| 태블릿(가로) | 1024px | coarse | tablet | **true** |
| 태블릿(세로) + 외장 키보드 | 768px | fine* | tablet | false |
| 큰 폰 | 430px | coarse | mobile | **true** |

→ **레이아웃은 `screenMode`, 입력/터치 동작은 `useIsCoarsePointer()`** 를 사용.

---

## 5. 검증 체크리스트

### 모바일(Safari iOS / Chrome Android)
- [ ] 텍스트 추가 → 사이드바 자동 닫힘 → 캔버스의 텍스트가 즉시 선택됨
- [ ] 이미지 추가 → 사이드바 자동 닫힘 → 캔버스에 이미지가 보이고 선택됨
- [ ] 요소 추가 → 동일
- [ ] 선택 후 코너 핸들로 리사이즈 — 손가락으로도 잡힘 (touchCornerSize=36)
- [ ] 객체 드래그 이동 — 페이지 스크롤 없이 객체만 이동
- [ ] 길게 누름 — 시스템 콜아웃(복사/공유) 메뉴 안 뜸
- [ ] 핀치 — 페이지 줌 안 됨 (캔버스 줌은 별도 UI)
- [ ] 빠른 연속 터치 — 화면 다운 없음

### 태블릿(외장 마우스 연결 시)
- [ ] `(pointer: coarse)` 가 false 가 되어 데스크톱 UX 가 적용됨
- [ ] 핸들 사이즈가 작아짐 (cornerSize=13)
- [ ] 모바일 자동 닫기 동작 안 함

### 데스크톱
- [ ] 기존 동작 회귀 없음

---

## 6. 알려진 한계 / 향후 개선

1. **핀치 줌 인 캔버스** — 현재 viewport `user-scalable=no` 로 시스템 핀치는 차단되지만,
   캔버스 자체 핀치-투-줌 제스처는 미구현. Fabric 의 `touch:gesture` 이벤트 또는
   `hammer.js` 등으로 추가 가능.
2. **두 손가락 패닝** — 한 손가락은 객체 선택, 두 손가락은 캔버스 패닝 같은
   분기 미구현. 현재는 `Space` 키 또는 `dragMode` flag 로만 진입.
3. **iText 인라인 편집 시 모바일 키보드** — IText 편집 모드에서 가상 키보드가
   올라오면 viewport 가 압축되며 캔버스 위치가 흔들릴 수 있음. visualViewport API
   기반 보정 미구현.
4. **컨텍스트 메뉴** — 데스크톱은 우클릭, 모바일은 long-press 인데 현재
   `stopContextMenu: true` 라 모바일에선 컨텍스트 메뉴 자체가 안 뜸. 모바일용
   대체 UI(객체 선택 시 floating action bar) 필요.

---

## 7. 관련 PR / 커밋

- 커밋 `d341af7` — fix(editor): improve mobile touch UI for canvas editor
- 브랜치: `claude/fix-mobile-touch-ui-91nuI`
- 변경: 8 files / +153 / −15
