# C-1 편집기 UX 설계 정본 — 객체 컨트롤 + 템플릿 레이어별 속성 (2026-07-04)

> 오너 결정(2026-07-04 확정): **B0 선결 3건 전부 선행** · 속성 4축 전부(내용편집·잠금레벨·프린트제외·순서잠금) · UI는 **ControlBar+레이어패널 둘 다** · 컨트롤 갭 4건 전부(레이어행 삭제·복제 / 다중선택 / 모바일 순서변경 / 관리자 라이브러리).
> 정찰: 3에이전트 오케스트레이션(권한모델/레이어패널/템플릿모드), file:line 전수. 로드맵 상위 문서: ROADMAP_REALIGNMENT_2026-07-03.md 트랙 C-1.

## 0. 불변 원칙 (위반 금지)
- 공유 UX 상품 비종속 — **TemplateSetType 게이팅 0건** (SidePanel/ControlBar/ToolBar 는 전 상품 공유).
- **default-permissive**(PERM-1, EDITOR_OBJECT_EDITING_SPEC §3-2): 신규 속성도 undefined=허용. default-locked 전환은 별도 opt-in 트랙.
- 신규 per-object 속성은 **`extendFabricOption`(canvas.ts:94-163) 등재 필수** — 미등재=저장 침묵유실(styles 함정 계열). templateSet 일괄 저장(useTemplateSetSave.ts:90-94)은 자동 추종.
- jspdf/jsbarcode/qr-code-styling/paper/pdf-lib **dynamic import만**(Track A). fabric 5.5.2 핀. canvas-core 공개 API/핫키 시그니처 불변(파트너 임베드 전파).
- editor 배포 = master 머지 후에도 Vercel CLI 수동 확인(웹훅 이력).

## 1. 🔴 Phase B0 — 선결 수정 3건 (PR-1, ~2일)

### B0-① embed editMode 오염 (가장 중대 — 2025-12-08 e326b4c부터 존재)
- **버그**: 고객 embed → `loadTemplateSetEditor`(embed.tsx:843/862) → `setupEmptyEditorStore`(useEditorContents.ts:1055) → empty 프리셋 스프레드(useSettingsStore.ts:163 `editMode: true`) → **store editMode=true 잔류**(embed에 리셋 없음 — grep 전수).
- **영향**: `applyObjectPermissions` no-op(movable 강제 무력) · ControlBar 관리자 토글(438-470) 고객 노출 → **고객이 잠금 자가해제 가능** · ToolBar editMode 전체메뉴(116-118)로 enabledMenus 우회. (del 가드·LockPlugin 은 생성시점 스냅샷이라 무사 — 6/16 E2E 통과의 이유)
- **수정**: `setupEmptyEditor(config)` 에 명시 `editMode?: boolean` 도입, **프리셋 스프레드에서 editMode 제외**(명시 인자만 적용, 기본 false). 호출자별: embed → false 고정 / EditorView `isAdminTemplateSetEdit`(EditorView.tsx:95-96) → auth role 검증 후 true / loadEmptyEditor(:895) → B0-③ 규칙.
- **검증**: embed 로드 후 store editMode=false 단언 테스트 + adminEdit=templateSet 토글 유지 + applyObjectPermissions 실강제 재현. 라이브 bookmoa embed 화면 육안 1회(토글 노출 여부 — 현재 실노출 중인지 확인).

### B0-② 잠금 해제 무게이트 구멍
- SidePanel handleUnlock(:94-105)·ControlBar(:399-407)가 **권한 검사 없이** 해제. 수정: 해제 대상이 `lockInfo.isLocked`(LockPlugin)면 `CAN_UNLOCK_MAP` 역할 검사, `movable===false` 관리자 지정 잠금이면 비-editMode에서 해제 버튼 숨김. 고객이 스스로 건 단순잠금(hasControls)은 현행 유지.

### B0-③ /template 화면 editMode 미활성
- TemplateEditorView 는 editMode 를 아무도 안 켬(초기 false) → 템플릿 단건 제작에서 속성 토글 자체가 안 보임. **수정**: `useAuthStore` role(admin JWT — admin iframe 이 `?token=` 주입, TemplateEditorView.tsx:127-136) 검증 후 updateSettings({editMode:true}). ⚠️ URL 파라미터 판정 금지(App.tsx:42 라우트 무가드 — 위조 가능).

## 2. Phase B1 — 레이어별 속성 4축 (PR-2, ~4-6일)

직렬화: 4속성 전부 extendFabricOption 등재. 고객 강제: `applyObjectPermissions`(objectPermissions.ts:18, 단일 함수 — 호출부 6곳 기배선) 확장. **선행 잡일**: `(obj as any)` 제거 — fabric.Object 모듈 확장 d.ts 에 movable/deleteable+신규 4종 선언(TS strict).

| 축 | 속성(가칭) | 관리자 UI | 고객측 강제 | 비고 |
|---|---|---|---|---|
| 내용편집 | `contentEditable`(기본 true) | 토글 | false → 텍스트 진입 차단(fabric editable=false 세팅) + 사진틀 fillImage 교체 차단 | "교체만 허용" 조합 = movable:false+deleteable:false+contentEditable:true |
| 잠금레벨 | `lockInfo.lockLevel='designer'` | 레벨 선택(고아 컴포넌트 **ElementLockControl.tsx 재배선** — canUnlock 로직 기성) | LockPlugin CAN_UNLOCK_MAP 기존재(dead capability 배선만) | admin 이 designer 잠금 → 고객 해제불가·관리자 가능 |
| 프린트제외 | `printExclude`(기본 false) | 토글 | 출력 경로에서 제외 | ⚠️ 소비 지점 정찰 1건 선행: ServicePlugin PDF(에디터 생성) + **워커 render-pages/변환기 svg·raster 경로**가 canvasData 를 직접 렌더하는지 — 렌더 관여 속성이라 워커측 소비 필요 여부 확정(0.5일). v1 범위는 에디터 PDF 경로 우선 |
| 순서잠금 | `lockLayerOrder`(기존 필드!) | 토글 노출만 | reorderObject 가드 **기존재**(useAppStore.ts:1042) + ControlBar z-order 4버튼(256-259)에 가드 추가 | 최소 공수 |

UI(둘 다): ⓐ ControlBar — 기존 위치고정/삭제잠금 3종 세트 패턴(토글 핸들러+editMode 게이트+useMemo 판정) 복제로 4토글 추가. ⓑ SidePanel 레이어 행 — 속성 배지(잠김 종류 구분: 현재 locked=!hasControls 로 뭉뚱그림 → lockInfo/movable/단순잠금 구분 표시) + 행 팝오버에 토글 일람. `template-element`/`fillImage` 가 prevented 목록(useAppStore.ts:983)이라 패널 미표시 → editMode 에서는 template-element 표시 검토(제작자가 제어해야 하므로).

### B1 구현 상태 (2026-07-04, PR-2)
- ✅ 구현: extendFabricOption 신규 2종(contentEditable/printExclude — lockInfo/lockLayerOrder/movable 는 기등재였음) · fabric.d.ts 2본 동기 · ServicePlugin printExclude(**_prepareSaveOperation 이전 플래깅** — 벡터화가 커스텀 속성을 복사하지 않아 이후 세팅 시 텍스트 침묵 실패, 적대 리뷰 critical 수정) + fillImage 동반 제외 · applyObjectPermissions contentEditable 강제+editMode 역오염 원복 · useImageStore/photoPlacement 사진틀 교체·자동배치 가드(editMode 면제) · ControlBar 토글 3종+잠금레벨 Select(LockPlugin 경유, 선택 복원) · z-order 4버튼 disabled · SidePanel 속성 배지 6종 · LockPlugin admin 선택 바이패스(프로그래매틱 한정) · 해제 경로 lockInfo 는 LockPlugin.unlock 경유(이중상태 방지).
- ⚠️ 잔여 처리 현황 (L4 — 2026-07-11 갱신):
  - ✅ ① [L4 해소, CTO 결정=표시형] printExclude 캔버스 상시 시각 표식 — `after:render` 훅에서 contextTop 순수 드로잉(점선 테두리+'인쇄 제외' 라벨, 고객·디자이너 공통). fabric 객체 무추가라 저장/PDF/썸네일 무오염. `apps/editor/src/utils/printExcludeOverlay.ts` + createCanvas·addPage 양 경로 바인딩.
  - ✅ ② [L4 해소] PDF 생성 창 autosave suspend — `apps/editor/src/utils/autosaveSuspend.ts`(runWithAutosaveSuspended, 스킵이 아닌 지연 재시도 1회). 진입점 6곳(embed 3·useWorkSave 2·EditorHeader 1) 래핑 + 자동저장 3훅(useEmbedAutoSave/useAutoSave/useCanvasLocalBackup) 가드. moldIcon 동류 임시 플래깅도 같은 창(_createMultiPagePDF 내부)이라 동일 보호.
  - ✅ ③ [L4 해소] 그룹(중첩 포함) 내부 텍스트 contentEditable 강제/원복 재귀 적용(applyObjectPermissions forEachObjectDeep). 'editable' 은 extendFabricOption 등재라 자식 단위 직렬화 — editMode 재귀 원복이 대칭이라 저장 왕복 오염 없음(코드로 검증, 회귀 스펙 동반).
  - ✅ ④ [L4 해소, CTO 결정] '내용편집 잠금' 정의 확정 = **내용+스타일 모두 잠금**(Canva 'Lock position and appearance' 대응 — 템플릿 무결성 목적이므로 스타일 허용은 모순). 비-editMode 에서 contentEditable=false 선택 시 ControlBar 스타일 컨트롤 5종(TextAttributes/ObjectFill/TextEffect/ObjectStroke/ObjectShadow) 감산 + 안내 1줄. 판정=objectPermissions.isAppearanceLocked (editMode 면제, ObjectSize 는 movable 축이라 유지).
  - 📌 ⑤ [규약 확정] admin 다중선택 드래그 시 잠긴 멤버 동반 이동 = L1 규약(의도된 editMode 면제 — 디자이너는 잠금 무시하고 자유 편집). 코드 변경 없음.
  - ⏸️ ⑥ [blocked] designer role 부여 경로 — 멀티테넌시 user_site_roles(P3b) 연동 대기.
  - ⬜ ⑦ printExclude 텍스트 포함 골든 PDF 육안검증 1회 — 별도 검증 트랙.

## 3. Phase A1 — 객체 컨트롤 4갭 (PR-3, ~3-4일)
1. **레이어 행 hover 삭제·복제**: 삭제=requestDeleteSelection 공통경로(S2 확인모달 승계, useAppStore.ts:1103), 복제=CopyPlugin clone(핫키만 있던 것 버튼화). deleteable=false 객체는 버튼 disabled.
2. **레이어 다중선택**: shift/ctrl 클릭 → fabric ActiveSelection 구성(setActiveObject). ⚠️ 선행 재현테스트: ActiveSelection 드래그가 자식 lockMovement 를 존중하는지(fabric 5.5.2 — 정찰 리스크 항목). 다중 z-order 는 editor 레벨 forEach(ControlBar handleLock :228-234 선례).
3. **모바일 순서변경**: TOUCH_ENV(SidePanel.tsx:12-20)에서 행에 ↑↓ 버튼 표시(reorderObject 재사용 — fabric 라이브 스택 인덱스 기준, reverse 함정 준수 useAppStore.ts:1027-1031).
4. **관리자 라이브러리 노출**: AppElement.tsx:100 isCustomer 게이트 완화(editMode 에도 추천 섹션).
- 공통: 순서 변경 후 `setUnchangeable` 재고정(reorderObject :1085 선례) + updateObjects 직접 호출.

## 4. 게이트·순서
- PR-1(B0) → PR-2(B1) → PR-3(A1), 각 PR: canvas-core/editor 테스트 + CI green + 픽셀 영향 있는 변경(printExclude)만 골든 캡처 비교. editor 라이브 반영은 Vercel 배포 확인까지.
- printExclude 워커 정찰(0.5일)은 PR-2 착수와 병행.
- B1 완료 시 [[project_photo_frame_ux]] 의 "향후 default-locked 옵션" 선결조건(템플릿 객체 마커) 재평가.
