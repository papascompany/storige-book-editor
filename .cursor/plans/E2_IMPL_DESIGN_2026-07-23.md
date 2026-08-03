정찰 검증이 끝났다. 핵심 발견: **E1이 이미 머지되어 C4의 E1 §5-4 트랙(AlignPlugin 이관+ControlBar 위임+테스트)은 완료 상태**이며, 렌즈 2의 "AlignPlugin에 distribute 전무"는 Wave A0(07-15) 시점 정보로 현행과 다르다. 이를 반영해 설계서를 작성한다.

---

# EDITOR_BENCH_E2_IMPL_SPEC — 조작 마감 (C4·C5·C6·C9) 구현 설계서

- 작성일: 2026-07-23 / 상태: **설계 확정 대기(코드 무변경)** / 우선순위: C4·C5·C6=P1, C9=P2
- 대상 레포: `/Users/yohan/Developer/Bookmoa Storige editor/storige-fix-20260713` (정찰 기준 브랜치 `chore/infra-restart-policy-g3`, origin/master 동기 — **착수 시 master 기준 신규 브랜치**, 타 세션 미커밋 무접촉 관행 준수)
- 정본 체인: `EDITOR_UX_GAP_ROADMAP_2026-07-07.md`(격차 카탈로그·프롬프트 EC) → `EDITOR_BENCH_DEV_PROMPTS_V2_2026-07-07.md` §1(공통 계약) → `EDITOR_BENCH_E1_IMPL_SPEC_2026-07-07.md` §5-4/§8(C4 선행 명세) → 본 문서(E2 구현 정본)
- 보관 규율: 본 문서는 내부 전용. 저장 시 `storige/.cursor/plans/EDITOR_BENCH_E2_IMPL_SPEC_2026-07-23.md`(중립명, gitignore 대상). 벤치 대상 편집기의 식별자·i18n 키·매직상수는 본 문서와 산출 코드 어디에도 이식하지 않는다(§8-4).

---

## 0. 요약 (변경된 전제 1건 포함)

| 항목 | 로드맵 정의 | 2026-07-23 실물 재정찰 결과 | E2 잔여 범위 |
|---|---|---|---|
| C4 균등 분배 | AlignPlugin distributeH/V, 3+ 선택 활성, 버튼+단축키 | **E1에서 사실상 완료** — `AlignPlugin.distributeH/V` 실존(:198-259, center-to-center, offHistory/onHistory try-finally, `setPositionByOrigin` 공개 API로 `_centerObject` 의존 정리 완료), ControlBar 위임(:442-447)+≥3 게이팅 버튼(:694-712), `AlignPlugin.test.ts` 실존 | **마감 3건만**: 보호객체 제외 가드, 단축키 신설(결정), 로드맵-실물 분배 기준 상충 확정 |
| C5 Alt+드래그 복제 | CopyPlugin 확장, isCloneProtected 재사용, 히스토리 1엔트리 | 없음 — Ctrl+D `clone()`만(CopyPlugin.ts:80-92). `isCloneProtected`는 public(:67-78, L1④·E1 §5-3 재사용 전례 2건) | 전체 신규 |
| C6 모바일 롱프레스 메뉴 | 기존 ContextMenu 재사용, 500ms+햅틱, 제스처 경합 없음 | 없음 — contextMenu.ts 트리거는 contextmenu/우클릭 mousedown/ContextMenu 키 3종뿐(:88-160), 터치 타이머 전무. **E0 재검증 §2에서 완료** | 전체 신규 |
| C9 단축키 정합 | hotkeys 메타→모달 자동 생성 + 스냅 설정 팝오버 | 모달 하드코딩 잔존(KeyboardShortcutsModal.tsx:32-74 GROUPS 상수). `CanvasHotkey` 메타에 표시명/카테고리 필드 없음. SmartGuides 토글은 생성자 옵션뿐(런타임 setter 없음) | 전체 신규 + **전제 정리 1건(화살표 nudge 이중 구현)** |

---

## 1. 공통 계약 승계 (전 작업 구속)

DEV_PROMPTS §1 + 로드맵 §0 전 항목을 그대로 승계한다. E2 관점 요지:

1. **플러그인 등록 순서**: 스냅 플러그인(SmartGuides) ≺ FrameInteraction **생성 순서** P0 계약(createCanvas.ts:271-279 주석 + `SmartGuidesFrameInteractionOrder.test.ts`) — E2는 이 순서를 건드리지 않는다. C5·C6은 기존 플러그인/클래스 내부 확장이라 생성 순서 무영향임을 적대 리뷰에서 확인.
2. **직렬화 additive**: E2 4건 모두 **canvasData 신규 속성 0건**(propertiesToInclude 변경 없음). C5의 복제물은 기존 `clone()` 파이프라인 재사용으로 속성 규약을 그대로 상속(신규 직렬화 경로 만들지 않음).
3. **offHistory/onHistory 쌍**: C4는 기존 try-finally 유지, C5는 드래그 시작 offHistory → 종료 onHistory+단일 엔트리(§4-3). 예외 경로에서도 onHistory 복원(try-finally 필수).
4. **LockPlugin 게이팅**: C5=`isCloneProtected()` 재사용(규칙 이원화 금지), C4=보호객체 제외 가드 신설(§3-2), C6=메뉴 항목이 각 플러그인 콜백의 기존 가드를 그대로 통과(신규 우회 경로 없음).
5. **SYSTEM_IDS 제외**: C4·C5는 `getActiveObjects()` 선택 집합만 조작(시스템 객체는 비선택), C6 타깃 판정은 fabric 타게팅(evented/selectable) 준수 — 시스템 객체 위 롱프레스는 "빈 곳"과 동일 취급.
6. **VITE_ENABLE_\* 플래그 기본 on**: C5 `VITE_ENABLE_ALT_DRAG_CLONE`, C6 `VITE_ENABLE_TOUCH_CONTEXT_MENU`, C9 팝오버 `VITE_ENABLE_SNAP_SETTINGS`. C4는 E1에서 무플래그 라이브된 기능의 마감이므로 신설하지 않음. 플래그 판독은 앱(createCanvas.ts:33-41 패턴)에서만 — canvas-core는 옵션 주입으로 수신.
7. **postMessage 엔벨로프 v1 불변**: E2는 이벤트/명령 추가·변경 0건.
8. **노출 규율**: 산출 코드의 모든 신규 식별자는 storige 자체 네임스페이스(예: `enableTouchContextMenu`, `altDragClone`). `scripts/check-source-exposure.mjs` + postbuild dist 스캔 게이트 통과가 머지 전제.
9. **성능 예산**: object:moving/scaling/rotating 훅 60fps — C5는 드래그 시작 1회성 clone(무한 루프·전 객체 순회 없음), C6는 O(1) 타이머, C4·C9는 버튼/모달 트리거. 예산 침범 항목 없음.
10. **TS strict·any 금지·테스트 무결성(.skip 금지)**.

---

## 2. E0 재검증 처리 (C6 — 4건 중 유일 지정 항목)

스펙상 C6만 E0 재검증 유지 항목이다(L6 롱프레스와의 혼동 방지). **본 설계 정찰(2026-07-23)에서 재검증 완료**:

| 확인 항목 | 결과 |
|---|---|
| L6 롱프레스(2026-07-11, cf28dd0)와의 관계 | **별개 확정** — `apps/editor/src/utils/layerTouchSheet.ts`는 레이어 패널 행 정렬 DnD 전용(`LONG_PRESS_MS=350`), 캔버스 wrapperEl과 무접점 |
| 캔버스 롱프레스 실존 여부 | **전무 재확인** — `contextMenu.ts` 리스너는 `contextmenu`/`mousedown(button===2)`/`keydown(ContextMenu)` 3종뿐(:88-160). 터치/포인터 타이머 코드 0건 |
| fabric 설정 | `fireRightClick:false`·`stopContextMenu:true`(factory.ts) — 우클릭은 fabric 밖 DOM에서 직접 처리, 터치 경로 없음 |
| 함정 신규 발견 | ⚠️ Android Chrome은 롱프레스 시 네이티브 `contextmenu` DOM 이벤트를 발화한다 → 기존 `onContextmenu` 리스너가 이미 부분 동작할 수 있음(iOS Safari는 미발화). **C6 구현은 이중 발화 dedupe 필수**(§5-3 T-3) |

C4·C5·C9는 E0 재검증 지정이 없고, C4는 실물이 스펙 대비 진전(E1 머지)됐음을 위 표(§0)로 갱신 확인했다. 추가 E0 작업 불요.

또한 **E1→E2 이월분 소거 확인**: §5-5 재단선 침범 경고는 `SafeZoneWarningPlugin`으로 E1에 포함·라이브됨(createCanvas.ts:359-361) — E2 이월 없음.

---

## 3. C4 — 균등 분배 마감 (잔여 3건)

### 3-1. 현행 대비 격차 (재정의)

E1 §5-4/§8.2 확정 분기("이동+노출")는 **이미 이행 완료**다. E2에서 남는 것은 로드맵 프롬프트 EC 작업1과 실물의 차분 3건뿐:

1. **보호객체 제외 규칙 부재**: 현행 `_distribute`(:212-259)는 중간 객체를 `setPositionByOrigin`으로 무조건 재배치한다. 이 API는 `lockMovementX/Y`·`movable=false`를 우회하므로, 위치고정 객체가 다중 선택에 포함되면(L1에서 선택 자체는 허용됨) 관리자 보호를 뚫고 이동된다 — **L1~L7 보호 게이팅 위반 실결함**.
2. **단축키 부재**: `AlignPlugin.hotkeys = []`. 로드맵 EC는 "버튼+단축키"를 명시.
3. **분배 기준 상충 미해소**: 로드맵 EC "경계 박스 간격 균등(edge-gap)" vs 실물+`AlignPlugin.test.ts` "center-to-center 균등".

### 3-2. 설계

**(a) 보호객체 제외 가드** — `AlignPlugin._distribute` 내부, 정렬 직전에 필터:

- 판정: `movable === false`(관리자 위치고정)를 분배 이동 대상에서 **제외**. 판정식은 CopyPlugin.isCloneProtected처럼 단독 함수로 두되, 분배는 "이동" 행위이므로 이동 관련 플래그(`movable`, `lockMovementX/Y`)만 본다 — 복제 판정(`deleteable`/`contentEditable`)과 혼용하지 않는다.
- 시맨틱: 보호객체는 분배 참여 집합에서 통째로 제외(기준점 후보로도 미사용). **제외 후 잔여 이동가능 객체 < 3 → no-op**(기존 `length < 3` 가드와 동일 지점에서 판정).
- editMode(관리자)는 제외 없이 현행 유지(CopyPlugin `_options?.editMode` 규약과 동형) — 단, AlignPlugin은 현재 options 미수신(`super(canvas, editor, {})`)이므로 createCanvas에서 mergedOptions 전달로 변경(additive, 시그니처 하위호환).
- ⚠️ ActiveSelection 좌표계 함정: 다중 선택 중 `getBoundingRect(true)`는 절대좌표 반환이므로 현행 로직 유지. 제외 객체가 ActiveSelection에 남아 있어도 위치 불변이면 무해 — 재생성되는 `new fabric.ActiveSelection(objs, …)`에는 **선택 전체**를 유지(제외는 이동만).

**(b) 단축키 신설(D-E2-1 승인 시)** — `AlignPlugin.hotkeys`에 2건 additive:

```
{ name: '가로 균등 분포', input: 'alt+shift+h', onlyForActiveObject: true,
  hideContext: () => this._canvas.getActiveObjects().length < 3, callback: () => this.distributeH() }
{ name: '세로 균등 분포', input: 'alt+shift+v', … distributeV() }
```

- `hideContext`가 함수형을 지원(contextMenu.ts setMenus :72-77)하므로 3개 미만 선택 시 컨텍스트 메뉴에서 자동 은폐 — UI 노출 규칙이 ControlBar ≥3 게이팅과 정합.
- 콜백 내부 `< 3` no-op 가드는 이미 `_distribute`에 있음(이중 방어 유지).
- 등록만으로 컨텍스트 메뉴(bindingContextItems)와 C9 자동 모달에 함께 노출된다 — 수동 동기화 0건.

**(c) 분배 기준 확정** — **권고: center-to-center 유지**. 근거: ① E1에서 이미 라이브·테스트 고정(`AlignPlugin.test.ts` 첫/끝 고정+중간 center 균등 회귀) ② 변경 시 기존 사용자 체감 회귀 + 테스트 재작성 ③ 벤치 표준(Canva)도 이질 크기 객체에서 두 방식이 혼재하며 차별 요소 아님. 로드맵 EC 문구를 실물 기준으로 개정(문서 수정)한다. → 오너 결정 D-E2-2.

### 3-3. 상호작용·모바일·임베드

- SmartGuides/TransformFeedback: 버튼 트리거 즉시 재배치라 moving 훅 미경유 — 무간섭.
- HistoryPlugin: 기존 try-finally 쌍 불변, `object:modified` 1회 발화 유지.
- 모바일: ControlBar bottom sheet에 이미 노출(≥3 선택 시). 단축키는 데스크탑 전용(무해).
- 임베드: ControlBar는 embed.tsx에서도 렌더 — 자동 적용, 계약 무접촉.

### 3-4. 테스트

`AlignPlugin.test.ts` 보강: ① 보호객체 포함 5객체 → 보호객체 위치 불변+잔여만 균등 ② 제외 후 2개 → no-op ③ 기존 center 균등 회귀 유지 ④ onHistory 복원(예외 주입).

---

## 4. C5 — Alt+드래그 복제 (신규)

### 4-1. 격차와 접근

Ctrl+D만 존재. 벤치 축은 Canva/miricanvas 표준. **CopyPlugin 확장**(스펙 고정)으로 구현하며 신규 플러그인을 만들지 않는다(등록 순서 계약 무접촉).

### 4-2. 동작 명세

| 시점 | 동작 |
|---|---|
| `mouse:down` (altKey=true, target 존재, 비보호) | "alt-복제 후보" 플래그 세트 + 원본(들)의 시작 위치·z-index 스냅샷. **clone은 아직 안 함** |
| 첫 `object:moving` (이동 임계 통과) | `offHistory()` → 원본의 **시작 위치에 사본을 삽입**(원본이 드래그되어 나감, 사본이 자리에 남음 — Canva 동일 시맨틱). 사본 z-order는 원본 직하(`insertAt` 스냅샷 인덱스), `id`는 신규 uuid |
| `mouse:up` | `onHistory()` → **히스토리 1엔트리**(드래그 종료 시점 스냅샷 — 사본 삽입+원본 이동이 한 엔트리) + `object:modified` 기존 발화에 편승 |
| 이동 임계 미달로 종료 | 플래그 해제만, clone 없음(단순 alt+클릭은 무동작) |

핵심 설계 결정:

- **clone 비동기 함정**: fabric `clone(cb)`은 비동기 콜백. mousedown에서 clone하면 transform이 원본을 추적 중이라 레이스 발생 → "원본을 드래그, 사본을 제자리에 남김" 패턴으로 회피(사본은 transform과 무관하게 삽입만 하면 됨). 콜백 도착 전 mouse:up이 떨어지는 초고속 드래그는 콜백 내에서 플래그 재확인 후 삽입+즉시 엔트리 처리.
- **clone 파이프라인 재사용**: `copyObject`(:358-384)가 쓰는 것과 동일한 `activeObject.clone(cb)` 경로를 내부 헬퍼로 공유(오프셋 +10px·setActiveObject 전환 없이). 커스텀 속성 상속 규약을 기존 프로덕션 경로와 동일하게 유지 — 신규 직렬화 리스크 0.
- **판정 시점**: alt는 **mousedown 시점** 판정(PowerPoint 방식). 드롭 시점 판정(Figma 방식)은 이동 중 상태 분기(사본 생성/회수)가 필요해 v1 범위 초과. → 오너 결정 D-E2-3 (권고: 다운 시점).
- **보호객체**: `isCloneProtected()` **재사용**(public, :67-78). 단일 객체 보호 시 clone 없이 **일반 이동으로 폴백**(movable=false면 fabric이 이동 자체를 차단하므로 자연 무동작). ActiveSelection은 `clone()`과 동일 규약 — 구성원 중 1개라도 보호면 복제 생략(이동은 fabric 기본).
- **경합 정리**: ① DraggingPlugin alt-팬 — 빈 곳 alt+드래그=팬(불변), 객체 위 alt+드래그=본 기능(현행 '객체 위 alt+드래그=일반 이동'에서 변경 — 파트너 공지 §9) ② 핀치 시작 시 `_currentTransform` 강제 중단(WorkspacePlugin:1060-1063)되면 mouse:up 미도래 가능 → `mouse:up` 외 `selection:cleared`·핀치 시작에서도 플래그 정리 ③ PointerShiftGuard — 사본 삽입은 레이아웃/뷰포트 불변이라 포인터 매핑 무영향(적대 리뷰 확인 항목).
- **SmartGuides 동시 동작**: 후보 경계 캡처 시점에 사본이 없어도 원본 시작 위치가 곧 사본 위치이므로 스냅 후보 공백은 실질 없음. 수용 기준 "동시 동작 확인"은 실기로 검증(가이드 표시+스냅이 드래그 내내 정상, 크래시·프리즈 없음).

### 4-3. 모바일·임베드

- 모바일: alt 키 부재 — 대상 아님(문서화만). ObjectActionBar 복제 버튼이 모바일 대체 경로(E1 기제공).
- 임베드: canvas-core 공통이라 자동 적용. iframe에서 alt+드래그는 브라우저 예약 동작 없음 — 골든 시나리오에 1케이스 추가.

### 4-4. 테스트

canvas-core 신규 spec(기존 SmartGuidesPlugin.test.ts 패턴): ① alt+down→moving→up = 캔버스 객체 +1, 사본 위치=원본 시작 위치, 히스토리 1엔트리 ② 비보호 검증: 보호객체 → 객체 수 불변 ③ alt 없는 드래그 → 불변 ④ 임계 미달 → 불변 ⑤ dispose 후 리스너 잔존 없음(기존 boundListener 패턴 준수).

---

## 5. C6 — 모바일 롱프레스 컨텍스트 메뉴 (신규)

### 5-1. 격차와 접근

기존 ContextMenu(레거시 DOM, canvas-core)를 **재사용**하고 트리거만 additive로 추가한다. React 재작성은 명시적 비범위(E2는 '마감'이며, 메뉴 신뢰성 리팩터링은 백로그).

### 5-2. 구조

- **canvas-core**: `ContextMenu`에 터치 트리거를 내장하지 않고, `Editor`에 공개 메서드 `enableTouchContextMenu(options?: { pressMs?: number; moveTolerancePx?: number; haptic?: boolean })`를 additive 신설 → 내부에서 wrapperEl에 pointer 리스너 4종(pointerdown/move/up/cancel) 등록, `ContextMenu`에는 `showAt(clientX, clientY)` public 메서드 1개만 additive(기존 private `show` 위임). `Editor.dispose()`에서 해제(기존 contextMenu.dispose 인접, :103-106).
- **앱**: createCanvas.ts에서 `VITE_ENABLE_TOUCH_CONTEXT_MENU !== 'false'` && coarse-pointer 환경일 때 호출. embed도 같은 createCanvas 경유라 자동 적용.

### 5-3. 트리거 명세와 함정 대응

| # | 규칙 |
|---|---|
| T-1 | `pointerType==='touch'` 단일 포인터 down → **500ms** 타이머(스펙 고정 — L6의 350ms는 레이어 패널 별개 UX로 불변, 상수 공유하지 않음). 두 번째 포인터 도착(핀치) 즉시 취소 |
| T-2 | 이동 임계 10px(화면px) 초과 → 취소(드래그/스크롤 양보). up/cancel → 취소 |
| T-3 | **Android 이중 발화 dedupe**: 발화 직후 `suppressNativeContextmenuUntil = now+700ms` 플래그 — 기존 `onContextmenu` 리스너가 이 창 안의 이벤트를 무시 |
| T-4 | 발화 시: 진행 중 fabric transform 강제 중단(`_currentTransform=undefined`, bindPinch:1060 동일 패턴 — 메뉴가 뜬 채 손을 떼도 이동 미발생) → `contextMenu.showAt(x,y)` → `haptic && navigator.vibrate?.(10)`(iOS 미지원 무해 no-op) |
| T-5 | **탭 합성 mousedown 함정**: 손 떼는 순간 브라우저 합성 mousedown이 `onClick` 히든 로직(:117-134)을 때려 메뉴가 즉시 닫힘 → 발화 후 400ms 히든 억제 창. 수용 기준: "손을 떼도 메뉴 유지" 실기 확인 |
| T-6 | 타깃: fabric이 touch down에서 이미 선택 처리하므로 `onlyForActiveObject` 필터가 자연 동작. 빈 곳 롱프레스 → available 0건이면 기존 규약대로 미표시(:80-84) |

### 5-4. 제스처 경합 매트릭스 (수용 기준 — 실기 증명 필수)

| 경합 상대 | 기대 | 근거 |
|---|---|---|
| 핀치줌/2지팬 (WorkspacePlugin.bindPinch) | 두 번째 손가락 도착 즉시 롱프레스 취소, 핀치 정상 | T-1 |
| 객체 드래그 | 10px 이동 시 취소 | T-2 |
| PointerShiftGuard | 무간섭(타이머는 매핑 불변) — 적대 리뷰 렌즈 2 확인 항목 | §1-9 |
| iframe 터치 스크롤(임베드 골든 특칙) | 캔버스는 touch-action:none이라 스크롤 기원 아님 — 캔버스 밖 스크롤 방해 없음, 캔버스 위 롱프레스 중 페이지 부동 | 로드맵 §5 E2 검증 특칙 |
| ObjectActionBar(E1) | 중복 노출 허용(액션바=빠른 2액션, 메뉴=전체) — 겹침 시 메뉴가 상위 z | UX 결정, fe-qa 확인 |
| FrameInteraction 더블탭/dblclick | 임계·타이머 독립, 500ms 내 2탭은 이동 없이도 up으로 취소됨 | T-2 |

### 5-5. 부수 정합 C6-b (권고 포함, 오너 결정 D-E2-4)

컨텍스트 메뉴 '삭제'는 S2 확인 모달을 우회하고 `ObjectPlugin.del()` 직행한다(핫키 DEL은 앱이 캡처단계에서 가로채 모달 경유 — useAppStore.ts:1147-1172). C6로 모바일 노출이 열리면 **오탭 삭제 리스크가 실사용 경로로 승격**된다. 처방: `ObjectPlugin` options에 `onDeleteRequest?: () => boolean` additive 콜백(반환 true=앱이 인수) → createCanvas가 `requestDeleteSelection` 주입. canvas-core 기본 동작 불변(콜백 부재 시 현행 del) — additive 원칙 준수, embed 포함 전 경로 대칭화.

### 5-6. 모바일 스타일

`.context` 스타일(apps/editor/src/index.css:151-197)에 coarse-pointer 미디어에서 터치 타깃 44px·항목 간격 확대 추가(앱 CSS만, canvas-core 무접촉).

### 5-7. 테스트

- 유닛(jsdom+fake timers): 타이머 발화/이동 취소/2지 취소/dedupe 창/dispose 해제.
- **실기 필수**(스펙 명시 "실기 터치 시나리오로 증명"): iOS Safari + Android Chrome, 시나리오 = 롱프레스 표시→유지→항목 실행 / 롱프레스 중 핀치 전환 / 스크롤 공존(임베드) / 저사양 기기 프레임 드랍 없음.

---

## 6. C9 — 단축키 레지스트리 자동화 + 스냅 설정 (신규, 마지막 순서 고정)

### 6-1. 전제 정리 (W4 선행 커밋): 화살표 nudge 이중 구현 단일화

현행은 동일 키에 두 핸들러가 동시 등록되어 있다: ControlsPlugin.handleArrowKeyMovement(:306-349 — window keydown, Shift 10px, **잠금 미가드**) + ObjectPlugin hotkeys(:63-108 — 1px, 잠금 가드, Shift 미지원). 결과: 1키에 합산 2px 이동 가능 + **Shift+화살표는 이동잠금 객체를 10px 이동시키는 보호 우회 결함** + 모달의 "1px" 표기 부정확. C9의 "모달=hotkeys 메타 자동 생성"이 정확하려면 hotkeys가 유일 소스여야 하므로 선행 정리가 논리 전제다.

처방: **ObjectPlugin hotkeys로 단일화** — ① ObjectPlugin 화살표 4종에 Shift 가속(10px)·`setCoords()`·`object:modified` 발화 추가(입력 `left`+`shift+left` 등 8건, 잠금 가드 유지) ② ControlsPlugin.handleArrowKeyMovement와 그 window 리스너 제거. 회귀 테스트: 1px/10px 정확, 잠금 객체 0px, INPUT 포커스 시 무동작(hotkeys-js 기본 필터 확인).

### 6-2. 모달 자동 생성

- **CanvasHotkey additive 필드**(packages/canvas-core/src/models/CanvasHotkey.ts): `category?: 'clipboard' | 'arrange' | 'move' | 'object' | 'view'`, `displayKeys?: string[]`(Mac 표기 배열, 미지정 시 input 포매팅), `hideInHelp?: boolean`. **`hideContext`와 `hideInHelp`는 분리** — 화살표 이동·스포이드는 hideContext:true지만 도움말에는 노출되어야 함(현행 모달과 동일 커버리지 보장).
- **Editor 공개 API**: `getRegisteredHotkeys(): ReadonlyArray<CanvasHotkey & { pluginName: string }>` — `plugins` Map 순회 flatMap(기존 private 유지, 열람 전용 신설).
- **모달**: GROUPS 하드코딩(:32-74) 제거 → `editor.getRegisteredHotkeys()` 기반 자동 생성 + 앱 소유 단축키(⌘K/⌘S/?/⌘\ 등 플러그인 외부)만 앱 측 static 목록으로 병합(이 목록은 앱이 자기 코드를 서술하므로 드리프트 원천이 아님). 포매터: `'cmd+['`→`['⌘','[']`, `'backspace'`→`['⌫']`, 플랫폼 감지(Ctrl 표기) 유틸 신설.
- **드리프트 차단 테스트**: "hideInHelp 아닌 모든 플러그인 hotkey가 모달 데이터에 존재"를 프로그램적으로 단언(자동 생성이므로 구조상 성립하지만, 포매터 누락 키 방어).

### 6-3. 스냅 설정 팝오버

- 토글 4→**3종**: 스마트 가이드(객체 스냅), 중앙 스냅(RulerPlugin 중앙 가이드라인), 각도 스냅. **'그리드'는 실물에 그리드 스냅이 존재하지 않으므로 제외**(로드맵 문구-실물 불일치, 오너 결정 D-E2-5 — 그리드 신설은 E2 범위 외).
- 영속: `useUiPrefStore`(zustand persist localStorage — showRuler :113-115 패턴 그대로)에 `snapGuidesEnabled`/`snapCenterEnabled`/`snapAngleEnabled` (기본 전부 true = 현행 동작 불변).
- 런타임 반영: SmartGuidesPlugin에 additive setter `setObjectSnapEnabled(v)`/`setAngleSnapEnabled(v)`(내부 early-return 게이트 — 생성자 옵션 :81-87 불변), RulerPlugin에 `setCenterSnapEnabled(v)`. EditorView/embed가 store 구독→setter 호출(showRuler→ruler.enable() 배선과 동형, createCanvas.ts:429 주석 참조).
- ⚠️ 모바일 불변식 승계: "모바일은 Shift 해제 불가→스냅 상시 적용"이 전제였으므로, 토글 OFF는 명시적 사용자 의사로 허용하되 기본값 ON 유지. 토글 상태는 UI pref이며 canvasData·PDF 산출물과 무관(직렬화 무접촉 단언 테스트 1건).
- 노출 위치: EditorHeader 룰러 토글 인접 팝오버(embed도 EditorHeader 렌더 — 자동 적용). `VITE_ENABLE_SNAP_SETTINGS` 기본 on.

---

## 7. 웨이브 분할·브랜치·커밋 단위

선행: E0→E1→E2 직렬 조건 충족(E1 머지 라이브 확인 §0). 1작업=1브랜치, W1·W2·W3 병렬 가능(파일 disjoint 검증 완료), W4 마지막(스펙 순서 고정 + Editor.ts 접촉 겹침 해소).

| 웨이브 | 브랜치(예) | 접촉 파일 | 커밋 단위 |
|---|---|---|---|
| W1 (C4) | `feat/e2-distribute-finish` | AlignPlugin.ts(+test), createCanvas.ts(옵션 전달 1줄) | ① 보호객체 제외+옵션 전달+테스트 ② 단축키 2종(D-E2-1 승인 시) |
| W2 (C5) | `feat/e2-alt-drag-clone` | CopyPlugin.ts(+신규 test), createCanvas.ts(플래그 옵션) | ① 헬퍼 공유화(무동작 리팩터) ② alt-드래그 본체+플래그 ③ 테스트 |
| W3 (C6) | `feat/e2-touch-context-menu` | contextMenu.ts, Editor.ts(enableTouchContextMenu), createCanvas.ts(플래그), index.css, (C6-b: ObjectPlugin.ts+useAppStore 배선) | ① showAt+터치 트리거+플래그 ② 모바일 CSS ③ C6-b(승인 시, 독립 커밋 — 단독 리버트 가능) |
| W4 (C9) | `feat/e2-hotkey-registry` | CanvasHotkey.ts, Editor.ts, ObjectPlugin.ts, ControlsPlugin.ts, KeyboardShortcutsModal.tsx, useUiPrefStore.ts, SmartGuidesPlugin.ts, RulerPlugin.ts, EditorHeader.tsx | ① nudge 단일화(버그픽스 성격, 선행) ② 메타 필드+getRegisteredHotkeys+모달 자동화 ③ 스냅 설정 팝오버+setter |

주의: W3 병합 후 W4 리베이스 시 Editor.ts 충돌 1회 예상(기계적 해소). createCanvas.ts는 3개 웨이브가 각기 1~3줄 접촉 — 라인 disjoint라 병렬 허용하되 머지 순서대로 리베이스.

---

## 8. 검증 게이트 (머지 전제, 순서 고정)

1. `pnpm --filter @storige/types build` → 전체 typecheck/lint → canvas-core test → editor build/test (공통 게이트 순서 고정).
2. **canvasData 왕복**: C5 활성 상태에서 복제 생성→저장→로드→재저장 동일(신규 속성 0건이므로 기존 왕복 spec 그대로 통과가 기준). C4 분배 후 왕복 1케이스. C6·C9는 UI 전용이나 전체 왕복 스위트 재실행.
3. **임베드 골든 시나리오**: 기존 시나리오 + E2 특칙 — ⓐ 롱프레스가 iframe 터치 스크롤과 무충돌 ⓑ alt+드래그 복제 1회 ⓒ dual-emit/엔벨로프 이벤트 시퀀스 불변.
4. **PDF/인쇄 패리티**: 워커 무접촉(코드 diff 0) 확인으로 갈음 — 산출물 골든 재실행은 C5 객체 생성 경로가 기존 clone 파이프라인 재사용임을 적대 리뷰가 확인하는 조건으로 생략 가능(리뷰가 이견 시 1회 실행).
5. **적대 리뷰 2렌즈**: 렌즈1 정합/회귀(보호 게이팅 우회·히스토리 쌍·직렬화), 렌즈2 성능/터치(PointerShiftGuard·핀치 경합·60fps·저사양 실기).
6. **fe-qa 뷰포트**: 375/768/1280 + 임베드. C6는 iOS Safari·Android Chrome **실기** 필수(§5-7).
7. **노출 검사**: `pnpm check:exposure` + editor/admin postbuild dist 스캔(매치 시 빌드 실패) + 수동 grep 백업. 신규 식별자 전수는 storige 네임스페이스.
8. dispose 완전 정리: W2·W3 신규 리스너의 dispose 해제를 누수 테스트(AccessoryPlugin.leak.test.ts 패턴)로 검증.
9. 배포 주의: editor는 git 웹훅 미발화 이력 — **Vercel CLI 수동 배포** 경로 유지, 배포 후 state 확인(ignoreCommand 침묵장애 트랩).

---

## 9. 파트너 공지 (D-1d 전례 판단)

| 작업 | 임베드 파트너(bookmoa-mobile·ShareSnap) 체감 | 공지 |
|---|---|---|
| C4 | 없음(E1에서 이미 노출, E2는 보호객체 케이스 마감) | 불요 |
| C5 | **있음(경미)** — 객체 위 alt+드래그가 '일반 이동'→'복제'로 동작 변경(데스크탑 한정) | 통합 공지에 포함 |
| C6 | **있음(체감 큼)** — 모바일 롱프레스가 무동작→메뉴 표시. ShareSnap 핀치줌(D2) 사용 흐름과 인접 | **필요(D-1d 전례 수준, 배포 전 사전 공지)** |
| C9 | 낮음(도움말 모달·설정 팝오버 — 기본값이 현행 동작과 동일) | 릴리스 노트 수준 |

→ **통합 사전 공지 1회**(C6 중심+C5 부기), DEL 모달(S2) 공지 전례 포맷 준용. C6-b 포함 시 "메뉴 삭제도 확인 모달 경유" 문구 추가. 롤백 안내: 각 VITE_ENABLE_* OFF로 기능별 즉시 비활성(재배포 필요함을 명기).

---

## 10. 리스크 및 오너 결정 대기 항목

**오너 결정 (착수 전 기입)**

| ID | 항목 | 권고 |
|---|---|---|
| D-E2-1 | C4 분배 단축키 신설(alt+shift+h/v) | 추가 (수동 동기화 0건 구조 확인됨) |
| D-E2-2 | 분배 기준 center-to-center 확정 + 로드맵 EC 문구 개정 | 현행 유지 (라이브·테스트 고정 기득) |
| D-E2-3 | C5 alt 판정 시점 | mousedown 시점 (v1 단순·결정적) |
| D-E2-4 | C6-b 컨텍스트 메뉴 삭제의 확인 모달 정합 | **포함** (모바일 노출로 오탭 리스크 승격) |
| D-E2-5 | C9 '그리드' 토글 | 제외 (그리드 스냅 실물 부재 — 신설은 별도 백로그) |
| D-E2-6 | nudge 이중 구현 단일화 W4 포함 | 포함 (Shift+화살표 잠금 우회는 보호 결함) |

**주요 리스크**

1. C5 fabric clone 비동기 레이스 — "사본 제자리" 패턴+콜백 내 플래그 재확인으로 봉합, 초고속 드래그 유닛 케이스 필수.
2. C6 브라우저별 터치 시맨틱(Android 네이티브 contextmenu, 탭 합성 mousedown) — T-3/T-5 억제 창이 임의 상수(700/400ms)라 실기 튜닝 여지. 실기 매트릭스가 게이트.
3. 레거시 ContextMenu 재사용의 한계(포지셔닝 클램프 없음·접근성) — E2 비범위 명시, 백로그 등재.
4. W4의 ControlsPlugin 핸들러 제거 — 화살표 이동 체감 변화(2px→1px 정상화)가 "회귀"로 오인될 수 있음 — 릴리스 노트에 버그픽스로 명기.
5. 병렬 웨이브의 createCanvas.ts/Editor.ts 접촉 겹침 — 머지 순서 리베이스 규율로 해소(§7).

---

## 11. DoD

C4 보호객체 케이스 포함 테스트 green / C5 데스크탑+임베드에서 alt+드래그 복제·히스토리 1엔트리·보호 차단 / C6 iOS·Android 실기 4시나리오 pass+임베드 골든 특칙 pass / C9 모달 하드코딩 0건·드리프트 테스트 green·스냅 토글 3종 영속 / 공통 게이트 §8 전 항목 pass / 파트너 공지 발송 완료 / RESUME_PROMPT 갱신.

---
참고 실물 근거(정찰 검증 완료): `packages/canvas-core/src/plugins/AlignPlugin.ts:193-259`, `plugins/CopyPlugin.ts:67-92·358-384`, `contextMenu.ts:15-160`, `Editor.ts:38-161`, `plugins/ObjectPlugin.ts:32-108`, `plugins/ControlsPlugin.ts:306-349`, `plugins/WorkspacePlugin.ts:1040-1127`, `models/CanvasHotkey.ts`, `apps/editor/src/utils/createCanvas.ts:33-41·271-406`, `apps/editor/src/components/editor/ControlBar.tsx:442-447·694-712`, `KeyboardShortcutsModal.tsx:32-74`, `apps/editor/src/stores/useUiPrefStore.ts:113-115`, `apps/editor/src/utils/layerTouchSheet.ts` (레포 루트: `/Users/yohan/Developer/Bookmoa Storige editor/storige-fix-20260713`)