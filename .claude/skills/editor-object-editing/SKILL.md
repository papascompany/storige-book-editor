---
name: editor-object-editing
description: Storige 에디터에서 객체(텍스트/이미지/요소/배경 등) 추가·선택·편집·저장과 관련된 이슈를 진단·수정할 때 사용. 모바일 크래시, 선택 즉시 해제, 메모리 한계, ResizeObserver 루프, 백업/복원 등 사용자 보고가 들어오면 이 스킬의 진단 절차를 따른다.
---

# 편집기 객체 편집 이슈 진단/수정 스킬

[`docs/EDITOR_OBJECT_EDITING_SPEC.md`](../../docs/EDITOR_OBJECT_EDITING_SPEC.md) 와 짝.
사용자 보고 → 원인 가설 → 검증 → 수정 의 정형 절차.

## 1. 사용자 보고 패턴 → 원인 매핑

| 사용자 표현 | 가능 원인 후보 | 우선 확인 파일 |
|---|---|---|
| "객체 선택이 안 된다" | (a) layout 캐스케이드로 selection cleared (PR #2 의 SELECT-1), (b) 캔버스 크래시로 JS 죽음, (c) backdrop pointer 가로채기 | `EditorView.tsx` main className, `useAppStore.activeSelection` |
| "페이지가 다운/크래시" / "반복적으로 문제" | iOS Safari 메모리 한계 도달 | `useAppStore.takeCanvasScreenshot`, `HistoryPlugin`, `factory.ts` retina, `ResizeObserver` |
| "편집 중 화면이 초기화" | WebContent 크래시 후 iOS 자동 reload → 백업 없으면 작업 손실 | `useCanvasLocalBackup`, `EditorErrorBoundary` |
| "사이드/하단 메뉴가 캔버스를 가린다" | 모바일 ControlBar/FeatureSidebar 레이아웃 | `ControlBar.tsx` mobileOverlay, `EditorView.tsx` main className |
| "사이드 메뉴 펼치면 페이지가 한쪽으로 밀린다" | 캔버스 폭은 줄었는데 viewport 보정이 없음 | `EditorView.tsx` ResizeObserver 의 워크스페이스 재정렬 (`setCenterPointOf` / `setZoomAuto`) — 자세한 내용은 `fabric-editor` 스킬 |
| "코너 핸들이 너무 작아 잡기 어렵다" | `touchCornerSize` 미설정 | `factory.ts` `configureFabricDefaults` |
| "객체 추가했는데 안 보인다" | `requestRenderAll()` 누락 | `tools/AppText.tsx` 등 |

## 2. 검증 절차 (실기기 없이 코드 레벨)

1. **변경된 파일들의 데스크톱/모바일 분기 확인**
   - 모바일 전용 분기는 `(pointer: coarse)` 또는 `screenMode === 'mobile'` 가드 안에 있어야 함
   - 가드 없는 변경은 데스크톱 회귀 가능 → red flag
2. **빌드 통과 검증**: `pnpm --filter @storige/types build && pnpm --filter @storige/canvas-core build && pnpm --filter @storige/editor build`
3. **lint 통과 검증**: `pnpm --filter @storige/editor lint` — 신규 코드 에러 0
4. **이벤트 핸들러 누수 점검**:
   - `canvas.on(...)` 마다 `dispose()` 의 `canvas.off(...)` 매칭 확인
   - 익명 함수로 등록한 핸들러는 off 불가 → 리포트
5. **메모리 비용 추산**:
   - retina 캔버스 (DPR=3) → CSS 픽셀의 9배 메모리
   - `toDataURL` 호출 = 캔버스 사이즈 × ~1.4 (PNG base64) bytes
   - history snapshot = `canvas.toJSON()` 직렬화 길이

## 3. 모바일 메모리 절감 카드 (이미 적용된 것)

이 코드베이스는 **iOS Safari 메모리 한계(~256MB)** 회피를 위해 다음을 모바일에서만 적용:

```ts
// canvas-core/src/utils/factory.ts
const isCoarse = isCoarsePointer()
const defaultOptions = {
  enableRetinaScaling: !isCoarse,    // 모바일 OFF — 메모리 9배 절감
  // ...
}
if (isCoarse) {
  fabric.Object.prototype.cornerSize = 16
  fabric.Object.prototype.touchCornerSize = 36
  fabric.Object.prototype.padding = 8
  fabric.Object.prototype.borderScaleFactor = 2
}

// canvas-core/src/utils/history.ts
this.historyMaxSteps = isCoarsePointer ? 15 : 50

// apps/editor/src/stores/useAppStore.ts
const TOUCH_ENV = isTouchEnv()
const SCREENSHOT_DEBOUNCE_MS = TOUCH_ENV ? 2000 : 200
// + TOUCH_ENV 시 toDataURL 호출 자체 스킵, placeholder 만 set
```

**새 이슈 진단 시 위 카드를 먼저 확인** — 이미 끈 항목을 다시 켜는 회귀를 막기 위함.

## 4. 신규 메모리/크래시 이슈 추가 진단 가이드

기존 카드를 모두 적용한 후에도 크래시가 보고되면:

### 4-1. 추가 의심 소스
- **모달 컴포넌트 메모리 비용** — ColorPickerModal 의 색상 그리드, 이미지 모달 등
- **Fabric 객체 캐시** — `objectCaching=true` + 많은 객체 = 캐시 메모리 증가
- **이벤트 리스너 누적** — `bindObject` 같은 패턴이 매번 새 listener 등록
- **autosave / autosync** — 짧은 간격으로 캔버스 직렬화
- **OpenCV / ONNX (lazy)** — 모바일에서 트리거되면 10MB / 24MB WASM 로드
- **lucide-react 아이콘 트리** — 많은 import 시 번들 큼 (트리 셰이킹 확인)

### 4-2. 진단 도구
- `apps/editor/src/components/EditorErrorBoundary.tsx` — 에러 시 메시지 캡처. 원격 추적 도구 (Sentry 등) 연결 시 여기에 dispatch 추가
- `apps/editor/src/hooks/useCanvasLocalBackup.ts` — 사용자 작업 백업. 디버그용으로 backup ts 를 표시할 수 있음
- `performance.memory.usedJSHeapSize` (Chrome 한정) — 임계 시 cleanup 트리거 검토

### 4-3. 디바운스/스로틀 표준
| 작업 | 데스크톱 | 모바일 |
|---|---|---|
| `_updateObjectsHandler` (우리가 직접) | 100ms | 100ms (변동 X) |
| `takeCanvasScreenshot` (toDataURL) | 200ms | **2000ms (스킵)** |
| `_renderFn` | 16ms (60fps) | 16ms |
| ResizeObserver | RAF (1프레임) | RAF (1프레임) |

## 5. PR / merge 절차

이 스킬에 해당하는 변경은 다음 절차:

1. 브랜치: `claude/fix-mobile-touch-ui-91nuI` 같은 작업 브랜치
2. **빌드 + lint 통과 후** 커밋 (HEREDOC 메시지)
3. push → 사용자 확인 요청
4. 사용자 검증 후 → `mcp__github__create_pull_request` (base: `master`)
5. `mcp__github__merge_pull_request` (method: merge — 브랜치 보존)
6. Vercel 자동 배포 (storige-editor 프로젝트, `editor.papascompany.co.kr`)

## 6. 잘못 추가하지 말 것

- `pb-[N vh]` 류로 main height 를 selection 시 토글 → SELECT-1 회귀
- `ResizeObserver` 콜백에서 무조건 `setDimensions` 호출 → 무한 루프
- 데스크톱에 영향 가는 변경을 `(pointer: coarse)` 가드 없이
- 익명 함수로 `canvas.on(...)` → 누수
- `console.log` 를 매 modification 핫패스에 추가 → 모바일 메모리

## 7. 참고

- [`docs/EDITOR_OBJECT_EDITING_SPEC.md`](../../docs/EDITOR_OBJECT_EDITING_SPEC.md) — 시나리오 매트릭스 + 알려진 이슈 트래킹표
- [`docs/MOBILE_TOUCH_UI.md`](../../docs/MOBILE_TOUCH_UI.md) — 모바일 UX 디자인 원칙
- [`.claude/skills/fabric-editor/SKILL.md`](../fabric-editor/SKILL.md) — Fabric.js 일반 작업
