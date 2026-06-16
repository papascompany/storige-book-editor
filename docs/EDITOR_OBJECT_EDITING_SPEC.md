# 편집기 객체 수정 기능명세서

> Storige 에디터의 모든 객체 추가/선택/편집/저장 시나리오에 대한 기능 명세 + 모바일/PC 동작 차이 + 알려진 이슈 트래킹.
> 최초 작성: 2026-04-30 — `claude/fix-mobile-touch-ui-91nuI` 브랜치 검증 결과 기반.

---

## 1. 객체 카탈로그

| 객체 | 클래스 (fabric) | 추가 도구 | extensionType / id |
|---|---|---|---|
| 텍스트 | `IText` | `tools/AppText.tsx` | (없음) — 일반 사용자 객체 |
| 이미지 | `Image` | `tools/AppImage.tsx` | (없음) |
| 요소 (SVG/도형) | `Group`/`Path`/`Rect`... | `tools/AppElement.tsx` | (없음) |
| 배경 색/이미지 | workspace.fill / `Image` | `tools/AppBackground.tsx` | `extensionType: 'background'` |
| 프레임 | `Group` (clipping) | `tools/AppFrame.tsx` | `extensionType: 'frame'` |
| 템플릿 요소 | 다양 | `tools/AppTemplate.tsx` | `extensionType: 'templateElement'` |
| QR/바코드 | `Group` | `tools/SmartCodes.tsx` | (smartCode) |
| 워크스페이스 | `Rect` | (시스템) | `id: 'workspace'` — 사용자 선택 제외 |
| 컷/세이프 보더 | `Path` | (시스템) | `extensionType: 'overlay'` — 줌 시 숨김 |
| 가이드라인 | `Line` | (시스템) | `extensionType: 'guideline'` |
| 클리핑 마스크 | `Path` | (시스템) | `extensionType: 'clipping'` |

---

## 2. 시나리오 매트릭스

각 시나리오를 PC (마우스, `pointer:fine`) 와 Mobile (`pointer:coarse`, viewport < 768px) 에서 검증.

### 2-1. 텍스트

| # | 시나리오 | PC 동작 | Mobile 동작 | 상태 |
|---|---|---|---|---|
| T1 | 텍스트 추가 | FeatureSidebar "텍스트 추가" 버튼 → IText 생성 → 워크스페이스 중앙 → 자동 선택 | 추가 후 사이드바 자동 닫기 → 캔버스 노출 | ✅ |
| T2 | 단일 탭 선택 | mouse:down → setActiveObject | touchstart → mouse:down 합성 → setActiveObject | ✅ |
| T3 | 더블 탭 → 인라인 편집 | dblclick → IText editing mode | 더블 탭 → editing mode (가상 키보드 활성) | ⚠️ visualViewport 보정 미구현 |
| T4 | 드래그 이동 | mouse:move → object:moving | touchmove → object:moving | ✅ DraggingPlugin TouchEvent 호환 |
| T5 | 코너 핸들 리사이즈 | corner click + drag | touchCornerSize 36px hit-area | ✅ |
| T6 | 폰트 변경 | ControlBar TextAttributes Select | ControlBar 시트 expand → Select | ✅ |
| T7 | 색상 변경 | ColorPickerModal | 동일 | ⚠️ ColorPickerModal 메모리 비용 큼 |
| T8 | 삭제 | Delete 키 / ControlBar 휴지통 | ControlBar 휴지통 | ✅ |

### 2-2. 이미지

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| I1 | 파일 업로드 | `<input type="file">` | 동일 (모바일 카메라/갤러리 선택) | ✅ |
| I2 | 드래그앤드롭 업로드 | `onDrop` → `useImageStore.uploadFile` | 모바일은 dnd 미지원 — 업로드 버튼만 | ✅ |
| I3 | 추가 후 선택/이동/리사이즈 | T2~T5 와 동일 | 동일 | ✅ |
| I4 | 필터 적용 | FilterPlugin / ControlBar | 동일 | ⚠️ `ImageProcessingPlugin` (OpenCV 10MB) 로드 시 모바일 메모리 위험 |
| I5 | 클리핑 마스크 | `tools/AppClipping` | 동일 | ⚠️ OpenCV 의존 |
| I6 | 배경 제거 | `@imgly/background-removal` (lazy) | **모바일 비권장** — ONNX runtime 24MB | ⚠️ |

### 2-3. 요소(SVG/도형)

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| E1 | 요소 추가 | AppElement → setupAsset → core.addImageFromURL or SVG load | 동일 + 사이드바 자동 닫기 | ✅ |
| E2 | 색상 변경 | ObjectFill 의 Single/Gradient swatch | 동일 | ✅ |
| E3 | Stroke 변경 | ObjectStroke | 동일 | ✅ |

### 2-4. 배경

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| B1 | 배경 색 변경 | AppBackground → ColorPickerModal → workspace.fill 변경 | 동일 | ⚠️ 색상 선택 모달이 무거움 — 일부 디바이스에서 크래시 트리거 가능 |
| B2 | 배경 이미지 업로드 | ImageProcessingPlugin 사용 시 OpenCV 로드 | 동일 | ⚠️ 모바일 메모리 위험 |

### 2-5. 다중 선택 / 그룹

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| M1 | Shift + click 다중 선택 | OK | 모바일에선 long-press 후 multi-select 미구현 | ⚠️ |
| M2 | 마퀴 드래그 다중 선택 | mouse drag on empty | touchstart-drag 동일 동작 | ✅ |
| M3 | 그룹화 | GroupPlugin.group | 동일 | ✅ |
| M4 | 그룹 해제 | GroupPlugin.unGroup | 동일 | ✅ |
| M5 | 정렬 | AlignPlugin (workspace 기준 단일, 그룹 기준 다중) | 동일 | ✅ |

### 2-6. Undo / Redo / 히스토리

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| H1 | Ctrl/Cmd + Z | HistoryPlugin.undo | 키보드 없음 — 헤더의 ↶ 아이콘 탭 | ✅ |
| H2 | Ctrl/Cmd + Y | HistoryPlugin.redo | 헤더 ↷ 아이콘 | ✅ |
| H3 | 히스토리 스택 깊이 | 50 step | **15 step** (메모리 절감) | ✅ |
| H4 | 히스토리 패널 시각화 | HistoryPanel 모달 | 동일 | ✅ |

### 2-7. 페이지 / 레이어

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| P1 | 페이지 추가/삭제 | PagePanel UI | 모바일 BookNavigation horizontal | ✅ |
| P2 | 페이지 썸네일 | toDataURL → PNG | **모바일은 placeholder** (메모리 절감) | ⚠️ 의도된 trade-off |
| P3 | 레이어 순서 변경 | ObjectPlugin | 동일 | ✅ |

### 2-8. 저장 / 복원

| # | 시나리오 | PC | Mobile | 상태 |
|---|---|---|---|---|
| S1 | 자동 저장 | useAutoSave (debounced) | 동일 | ✅ |
| S2 | 명시적 저장 | EditorHeader 저장 버튼 | 동일 | ✅ |
| S3 | 세션 복원 | API 에서 edit_sessions 로드 | 동일 | ✅ |
| S4 | **localStorage 백업/복원** | 5초마다 toJSON → localStorage | 동일 — 크래시/reload 후 기본 복원 | ✅ (신규) |
| S5 | PDF Export | ServicePlugin → 워커 큐 | 모바일에선 비권장 (CPU/메모리) | ⚠️ |

---

## 3. 알려진 이슈 트래킹

### 3-1. 해결됨 (이번 사이클)

| ID | 증상 | 원인 | 수정 PR |
|---|---|---|---|
| **CRASH-1** | iOS Safari "이 사이트에서 문제가 반복적으로 발생했습니다" 페이지 (초기 진입 후 짧게 사용 시) | EditorView 의 ResizeObserver 가 `setDimensions` 로 자기 자신을 무한 재발화 → 메인 스레드 점유 → WebContent 크래시 | **PR #1** `59097da` — RAF + 크기 캐시로 1프레임 1회만 적용 |
| **TOUCH-1** | 모든 터치 인터랙션 안 됨 | 캔버스 컨테이너에 `touch-action` 미설정 → 브라우저 기본 제스처가 Fabric 이벤트 흡수 | **PR #1** `d341af7` — `touch-action: none`, viewport meta, allowTouchScrolling: false |
| **HIT-1** | 핸들이 손가락보다 작아 잡기 어려움 | Fabric 디폴트 `cornerSize=13`, `touchCornerSize` 미설정 | **PR #1** — `(pointer:coarse)` 시 cornerSize=16, touchCornerSize=36 |
| **LAYOUT-1** | ControlBar 280px 좌측 고정으로 모바일 캔버스 80% 가림 | desktop 위주 레이아웃이 모든 폭에 그대로 적용 | **PR #1/#3** — 모바일 시 하단 시트 (collapsible 88px ↔ 70vh) |
| **SELECT-1** | 객체 탭 시 잠깐 선택되었다가 즉시 해제 | `pb-[45vh]` 가 selection 시 main height 변경 → ResizeObserver → setDimensions → Fabric 이 active object discard | **PR #2** `b3d0d5f` — `pb-[45vh]` 제거. ControlBar 는 `fixed` 라 layout 영향 없음 |
| **MEM-1** | 편집 중 페이지 크래시 / 빈 상태 reset | retina 캔버스 toDataURL + 50 history snapshot + console.log 누적이 iOS 메모리 한계 도달 | **PR #1~#4** 누적: enableRetinaScaling: false (모바일), toDataURL 스킵, history 50→15, console.log 제거 |

### 3-2. 진행 중 / 잔존

| ID | 증상 | 가설 | 다음 단계 |
|---|---|---|---|
| **MEM-2** | 일부 디바이스에서 ColorPickerModal 열거나 BG 색 선택 시 크래시 | 색상 그리드 모달 + workspace.fill 변경 시 캔버스 재렌더 메모리 피크 | 모달 lazy load 확인, 그리드 사이즈 축소 검토 |
| **MEM-3** | 장시간 편집 시 (1~2분) 누적 메모리로 결국 크래시 가능성 | Fabric 객체 캐시, 이벤트 리스너 누적, dnd 핸들러 등 | `performance.memory` 기반 reactive cleanup 검토 |
| **TEXT-EDIT-1** | iText 인라인 편집 시 모바일 가상 키보드가 viewport 변형 | `visualViewport` API 보정 미구현 | 향후 폴리시 PR |
| **CTX-MENU-1** | 모바일에선 long-press 컨텍스트 메뉴 없음 | `stopContextMenu: true` 디폴트 | floating action bar 별도 트랙 |
| **PINCH-ZOOM-1** | 캔버스 자체 핀치 줌 미구현 | `touch:gesture` 미바인딩 | 별도 트랙 |
| **DUAL-FINGER-PAN-1** | 두 손가락 패닝 미구현 | dragMode 만 있고 멀티터치 없음 | 별도 트랙 |
| **PERM-1** (추후 개발 검토) | 객체별 편집권한(Part B, `movable` 플래그)의 **기본 정책**이 설계 정본의 'default locked'(관리자 배치 상태 전부 잠금) 대신 **'default permissive'**(undefined=허용, 관리자가 '위치 고정'으로 명시 잠금만 적용)로 구현됨 | 안전 우선 — 'default locked' 를 그대로 적용하면 `movable` 플래그가 없는 **기존 라이브 템플릿·주문 전체 객체가 일괄 동결**되는 회귀 발생. 그래서 1차는 admin opt-in(명시 잠금)으로 출하 | **default-locked 옵션을 per-template / per-site 플래그로 도입 검토**: 템플릿에서 배치된 객체만 기본 잠금하고 고객이 추가한 객체는 자유 편집 유지(템플릿 객체 vs 고객 객체 구분 마커 필요). 도입 전 기존 데이터 영향·마이그레이션 분석 선행. 정본 설계: `.cursor/plans/PHOTO_FRAME_UX_AND_OBJECT_LOCK_DESIGN_2026-06-16.md` §4(Part B)·§7 |

### 3-3. 의도된 trade-off

| 항목 | 데스크톱 | 모바일 | 사유 |
|---|---|---|---|
| `enableRetinaScaling` | true | **false** | iOS DPR=3 → 9배 메모리 → 크래시 회피 |
| `historyMaxSteps` | 50 | **15** | 메모리 ~70% 절감 |
| 페이지 썸네일 | 풀 PNG | **placeholder** | toDataURL 비용 회피 |
| 시스템 핀치 줌 | 가능 (브라우저) | **차단** (`user-scalable=no`) | 캔버스 줌 UI 와 충돌 회피 |
| ControlBar | 좌측 280px | **하단 collapsible 시트 (88px↔70vh)** | 캔버스 가림 회피 |

---

## 4. 방어 메커니즘

### 4-1. ErrorBoundary
- `apps/editor/src/components/EditorErrorBoundary.tsx` — main.tsx 에서 root 에 적용
- React 트리 어디서든 throw 발생 시 흰 화면 대신 복구 UI ("새로고침" / "데이터 초기화") 표시
- iOS Safari WebContent 가 부분 실패할 때 첫 방어선

### 4-2. localStorage 백업
- `apps/editor/src/hooks/useCanvasLocalBackup.ts`
- 5초마다 캔버스 toJSON → `storige.editor.backup.<sessionKey>` 키
- 최대 3개 세션 보관 (quota 회피)
- WebContent 크래시 후 reload 시 backup 발견되면 사용자에게 복원 옵션 제공 (TODO: 복원 UI 추가)

### 4-3. ResizeObserver 안정화
- `EditorView.tsx` — RAF + 크기 캐시로 무한 루프 차단
- 1px 미만 변동 무시
- fabric `getWidth/getHeight` 와 비교해 동일하면 setDimensions 생략

### 4-4. Touch 이벤트 호환
- `DraggingPlugin.ts` — `getEventPoint` 헬퍼로 `touches[0]` 폴백
- `factory.ts` — `(pointer:coarse)` 시 컨트롤 핸들 hit-area 자동 확대

### 4-5. 메모리 프리셋 (모바일 전용)
- `enableRetinaScaling: false`
- `takeCanvasScreenshot` 자체 스킵 → placeholder
- `historyMaxSteps: 15`
- `_historySaveAction` console.log 제거

---

## 5. 수동 검증 체크리스트

### PC (Chrome / Firefox / Safari, 1280×800+)
- [ ] T1~T8: 텍스트 추가/선택/이동/리사이즈/폰트 변경/색상/삭제
- [ ] I1~I3: 이미지 업로드/dnd/조작
- [ ] E1~E3: 요소 추가/색상/stroke
- [ ] B1~B2: 배경 색/이미지
- [ ] M1~M5: 다중 선택/그룹화/정렬
- [ ] H1~H4: undo/redo/히스토리 패널
- [ ] P1~P3: 페이지 추가/삭제/썸네일
- [ ] S1~S3: 자동저장/명시저장/세션복원

### Mobile (iOS Safari iPhone 12+ / Chrome Android, viewport ~390×844)
- [ ] T1~T8 (T3 가상 키보드 동작 별도 확인)
- [ ] I1, I3, I4 (I5/I6 모바일 비권장 — 비활성화 검토)
- [ ] E1~E3
- [ ] B1, B2 (메모리 모니터링)
- [ ] M2~M5 (M1 미지원)
- [ ] H1~H4 (15 step 한계 확인)
- [ ] P1, P3 (P2 placeholder 확인)
- [ ] S1, S3, S4 (S4 백업/복원)
- [ ] **장시간 (5~10분) 편집 후 크래시 없음**
- [ ] **랜덤 빠른 탭 후 reset/crash 없음**

---

## 6. 관련 문서

- [`MOBILE_TOUCH_UI.md`](./MOBILE_TOUCH_UI.md) — 모바일/터치 UX 디자인 원칙
- [`.claude/skills/fabric-editor/SKILL.md`](../.claude/skills/fabric-editor/SKILL.md) — Fabric.js 작업 전반
- [`.claude/skills/editor-object-editing/SKILL.md`](../.claude/skills/editor-object-editing/SKILL.md) — 객체 편집 트래킹/디버깅 (신규)
