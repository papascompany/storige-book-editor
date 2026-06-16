# 사진틀 인터랙션 재설계 + 객체별 편집권한 — 구현 설계 스펙 (2026-06-16)

> **용도**: 다음 세션이 재조사 없이 바로 구현하는 자립형 설계서. 코드 근거(file:line)는 2026-06-16 HEAD 기준.
> **범위 결정(오너)**: A(사진틀 인터랙션) + B(객체별 편집권한) **둘 다**, **이 설계 확정 후 다음 세션에 구현**.
>
> **✅ 구현 완료(2026-06-16)**: A + B + Phase 2 **전부 구현·프로덕션 배포·라이브 E2E 검증 완료**.
> 커밋: A=`1c679c9`(FrameInteractionPlugin), B=`75ff42f`(객체권한), Phase2=`f77cc10`(PNG 평탄화).
> 검증용 PNG 액자(`a072a660-…`)는 `is_active=1` 활성화 완료. **Part B 기본 정책은 설계의
> 'default locked' 대신 'default permissive' 채택(오너 합의) — 사유·추후 검토는 §7 참조.**
> **검증 규약**: 인터랙션은 단위테스트 불가 → 배포→Chrome MCP E2E(프레임 배치·사진 채움 file_upload·이동/스케일/더블클릭·저장복원·PDF)→조정 **반복**. fabric-editor 스킬 준수.

---

## 0. 선행 상태 (이미 완료/시드된 것)

- **Phase 1 완료·배포** (commit `4ca8cad`): 프레임 4버그 — (B)embed 재바인딩, (A)fillImage frameRef 중복채움 가드, (C)setupFrameContent setCoords, (D)parentLayerId 삭제동반. 공용 헬퍼 `apps/editor/src/utils/frameInteractive.ts` (`rebindFrameInteractivity(editor,canvas)`) → loadCanvasData·embed.tsx·useEmbedAutoSave 공유.
- **Phase 2(PNG PDF 출력) 미구현**: 설계만 — `ServicePlugin._prepareObjectsForSvgExport`(ServicePlugin.ts:1810)에 image clipPath fillImage를 raster 평탄화(2D destination-out) 또는 vector-path 변환. **검증용 PNG 액자 시드됨**: `library_frames` id=`a072a660-4b16-42c8-9c5b-e3600e6a52f4` "원목 액자(PNG 검증)", `is_active=0`(고객 비노출), 파일 `/storage/library/frame/album-frame-test.png`(투명창 있는 갈색 테두리, 서빙 200). 본 A/B 작업과 **병행 가능**(아래 §5 통합).
- 시드 SVG 프레임 2종: 심플 보더(`13a55377`), 라운드 보더(`8e936785`) — 단일 `<rect fill=none>` → fabric type `rect` → `fillImage`(외곽선 clip) 경로.

---

## 1. 진단 — 근인 (코드 근거)

| # | 증상 | 근인 (file:line) |
|---|------|------------------|
| 2 | 사진 채우면 프레임이 사진 밑에 깔려 선택·이동 불가 | `makeFrameInteractive`(useImageStore.ts:763)가 사진(fore)을 `canvas.add(fore)`로 **최상단**에 올림. 이후 z-order 보정은 **이미지 경로만**(`fillImageIntoFrame:836 frame.bringToFront()`), **SVG 경로**(`fillImage:601~662`)엔 `bringToFront` 없음 → SVG 프레임은 사진 아래. + 사진 fore가 `evented:true,hasControls:true`(`fillImage:652`)라 클릭이 사진을 먼저 잡고 프레임은 못 잡음 |
| 4·6 | 프레임 이동 시 사진이 안 따라오고 원위치 고아 / 그룹 이동 안 됨 | ObjectPlugin은 **z-order 4 op**(bringForward/ToFront/sendBackwards/ToBack, :132~234)에서만 `parentLayerId` 매칭으로 fillImage 동반. **`object:moving`/`object:scaling`/`object:rotating` 동기화 핸들러가 전무**. 게다가 fillImage.clipPath가 `absolutePositioned:true`(useImageStore.ts:624,642,804)라 프레임/사진을 옮겨도 마스크 창은 **캔버스 절대좌표에 고정** → 사진이 원위치에 남음 |
| 5 | 사진 선택 시 확대/축소/회전 컨트롤이 일관되지 않음 | fillImage는 `hasControls:true`라 선택되면 컨트롤은 나오나, #2(z-order 혼란)+선택 라우팅 부재로 "무엇을 선택했는지"가 불명확 |
| 7 | 템플릿 객체별 이동/삭제 권한 미반영 | 잠금 프리미티브(`editable/selectable/evented/lockMovementX/Y/hasControls`)는 존재하고 admin **목업 요소**엔 적용(AppEdit.tsx:99~107,229~236, `renderType==='noBounded'` 토글). 그러나 **디자이너가 템플릿의 일반 객체마다 '고객 이동/삭제 허용'을 부여→저장→고객 편집기가 반영**하는 파이프라인(admin 객체속성 UI + 타입 플래그 + 편집기 로드시 적용 + 삭제 가드)은 **미완** |

---

## 2. 목표 인터랙션 모델 (표준 web-to-print = Canva/Pixlr식)

- **프레임 = 선택 단위**. 단일클릭 → 프레임 선택. 이동/스케일/회전 시 **사진+clipPath 동반**(시각적 그룹).
- **더블클릭(또는 선택 후 "사진 조정" 버튼) → adjust 모드**: 창 안에서 **사진만** pan/zoom(clipPath 절대좌표 고정 유지 = 기존 동작). adjust 모드 진입 시 프레임 비evented·사진 evented, 바깥 클릭/Esc → 모드 종료(사진 비evented 복귀).
- **z-order**: 사진은 프레임 **바로 아래**, 장식 프레임이 위(PNG 액자=테두리가 사진 덮음 / SVG=외곽선 clip). 두 채우기 경로 일관.
- **빈 프레임**: 단일클릭 → 파일선택(기존 makeFrameInteractive). 채워지면 위 모델로 전환.

---

## 3. Part A — 사진틀 인터랙션 재설계

### A1. z-order 일관화
- `fillImage`(SVG/벡터 경로, useImageStore.ts:646 블록) 채우기 후에도 `rear.bringToFront()`(=프레임) 호출 추가 — `fillImageIntoFrame`(image 경로 :836)와 통일.
- 단 SVG 보더 프레임은 `fill=none`(테두리만)이라 사진이 테두리 안 전체를 채우고 테두리가 위에 보이면 OK. PNG 액자는 테두리가 사진을 덮음.

### A2. 기본 모드 선택 라우팅 (프레임이 단위)
- 채운 사진(fillImage)을 **기본 모드에서 비선택**: `selectable:false, evented:false`로 두어 클릭이 프레임을 잡게 함. (단 adjust 모드에서만 evented 켬 — A3.)
- 프레임은 `selectable:true, evented:true, hasControls:true`. 프레임 선택 = 단위 선택.
- ⚠️ 이때 사진의 transform 컨트롤(#5)은 **프레임 컨트롤로 대체**: 프레임을 스케일/회전하면 사진도 같은 비율로(A4). "사진만" 조정은 adjust 모드(A3).

### A3. 그룹 이동/스케일/회전 동기화 (핵심·인트리킷)
프레임 변형 시 fillImage + clipPath를 따라오게. **신규 핸들러**(FramePlugin 또는 makeFrameInteractive 확장 / ObjectPlugin):
- `frame.on('moving')`: Δ(left,top)을 fillImage와 fillImage.clipPath(absolutePositioned)에 동일 적용. (clipPath는 fabric이 obj.clipPath라 별도 setCoords 필요할 수 있음.)
- `frame.on('scaling')`: 프레임 scale 변화비를 fillImage scale + clipPath scale + 위치에 반영(중심 기준). cover 비율 유지.
- `frame.on('rotating')`: angle을 fillImage·clipPath에 동기. (회전은 v2로 미뤄도 됨 — 우선 이동/스케일.)
- `frame.on('modified')`: 최종 setCoords 정리.
- **대안(더 견고)**: 프레임+사진을 **임시 fabric ActiveSelection/Group**으로 묶어 이동하는 방식 검토 — 단 absolutePositioned clip + adjust 모드와 충돌 소지. 1차는 이벤트 동기화로, 안 되면 group 재구조화 검토.
- ⚠️ `absolutePositioned` clipPath는 캔버스 좌표라, 프레임 이동 시 clipPath.left/top도 같이 이동시켜야 마스크 창이 사진을 따라감. (이게 #4 핵심.)

### A4. 더블클릭 → adjust 모드 (사진 조정)
- `frame.on('mousedblclick')`(또는 캔버스 dblclick에서 frame 타깃 판정): adjust 모드 진입.
  - fillImage: `selectable:true, evented:true, hasControls:true` + `setActiveObject(fillImage)`.
  - frame: `evented:false`(잠시) — 사진 조작이 프레임에 안 막히게.
  - clipPath 절대좌표 고정 → 사진만 이동/스케일 = 창 안 pan/zoom. (기존 absolutePositioned 동작 그대로 활용.)
- 모드 종료: 캔버스 빈 곳 클릭 / Esc / 다른 객체 선택 → fillImage 비evented 복귀, frame evented 복귀.
- 상태: `useAppStore`에 `frameAdjustMode: frameId | null` 또는 프레임 객체에 `_adjusting` 플래그.

### A5. 영향 파일 (A)
- `apps/editor/src/stores/useImageStore.ts` — fillImage/fillImageIntoFrame z-order·fore selectable/evented 기본값, makeFrameInteractive에 dblclick + move/scale 동기화 바인딩(또는 분리).
- `apps/editor/src/utils/frameInteractive.ts` — rebind 헬퍼가 신규 핸들러도 재바인딩하도록 확장(저장복원 후 동기화 유지). `_frameInteractiveBound` 가드 유지.
- `packages/canvas-core/src/plugins/ObjectPlugin.ts` — 삭제/z-order는 이미 parentLayerId; move 동기화를 여기 둘지 makeFrameInteractive에 둘지 결정(makeFrameInteractive 권장 — 프레임 단위 캡슐화).
- `apps/editor/src/views/EditorView.tsx` 또는 SelectionPlugin — dblclick 라우팅·adjust 모드 종료(빈 곳 클릭/Esc) 처리.
- 좌표규약: 중앙원점@150dpi(`reference-coordinate-convention`), `geometry/centerOrigin.mjs` SSOT.

### A6. 엣지 (반드시 검증)
- 저장→복원(embed 포함): 복원 후 rebind가 move/dblclick 핸들러도 재부여하는지(현 헬퍼는 makeFrameInteractive만). selectable/evented 기본값이 저장JSON에 반영되는지(extendFabricOption 화이트리스트: `frameRef`(canvas.ts:121),`parentLayerId`(:147),`fillImage`(:117) 등재됨 — selectable/evented는 fabric 기본 직렬화).
- 멀티페이지(allCanvas[i]/allEditors[i]).
- 삭제: 프레임 삭제 시 사진 동반(이미 parentLayerId로 동작 — Phase1) + adjust 모드 정리.
- undo/redo: HistoryPlugin과 동기화 핸들러 충돌 없는지.

---

## 4. Part B — 객체별 편집권한 시스템

### B1. 데이터 모델
- 객체 커스텀 플래그(권장 명): `tplLocked`(전체잠금, 기본 true), `tplMovable`(이동허용), `tplDeletable`(삭제허용), `tplContentEditable`(텍스트수정·사진교체 등). 또는 단일 객체 `permissions:{move,delete,edit}`.
- **extendFabricOption 화이트리스트(canvas.ts)에 추가** → 템플릿 JSON에 영속.
- `packages/types`에 타입 정의(EditorObjectPermission) — admin/editor 공유.
- 기존 `editable`/`extensionType` 규약과 충돌 정리(현 `editable`은 일부 도구가 임의 사용 중 — AppEdit/AppText/AppClipping).

### B2. Admin (디자이너) UI
- 템플릿 에디터(admin)에서 객체 선택 시 속성 패널에 **"고객 이동 허용 / 삭제 허용 / 내용 수정 허용"** 토글.
- **기본값 = 전부 불가**(관리자가 배치한 상태 고정). 디자이너가 선택적으로 허용.
- 저장 시 각 객체에 플래그 기록(캔버스 toObject가 화이트리스트로 보존).
- admin은 자기 편집에선 모든 객체 자유 조작(권한은 '고객용' 메타).

### B3. 편집기(고객) 적용
- 템플릿 로드(loadTemplateSetEditor/loadCanvasData) 후 각 객체에 플래그 적용:
  - `tplMovable=false` → `lockMovementX/Y:true, lockScalingX/Y:true, lockRotation:true`.
  - `tplDeletable=false` → 삭제 가드(ObjectPlugin del 경로 + 단축키에서 제외).
  - `tplLocked=true`(아무 권한 없음) → `selectable:false, evented:false`(완전 고정 배경).
  - `tplContentEditable` → 텍스트 편집/사진교체 진입 허용 여부.
- 사진틀 특례: 프레임 자체가 `tplMovable=false`여도 **사진 채우기(adjust)**는 `tplContentEditable`로 별도 제어(액자는 고정, 사진만 교체/조정 허용 시나리오).

### B4. 영향 파일 (B)
- `packages/types/src/index.ts` — 권한 타입 + 헬퍼(applyObjectPermissions).
- `packages/canvas-core/src/utils/canvas.ts` — extendFabricOption에 플래그 추가.
- `apps/admin/src/...TemplateEditor/속성패널` — 토글 UI + 저장.
- `apps/editor/src/hooks/useEditorContents.ts` — 템플릿 로드 후 applyObjectPermissions.
- `packages/canvas-core/src/plugins/ObjectPlugin.ts`(삭제 가드) + SelectionPlugin(selectable 반영).
- `editMode===true`(admin 미리보기)에선 권한 무시 = 전체 편집(기존 enabledMenus 규약과 동일 패턴, fabric-editor 스킬 §도구메뉴 참조).

---

## 5. Phase 2(PNG PDF) 통합
A 작업 중 PNG 액자(`is_active=0` 시드분)로 인터랙션을 검증하게 되므로, **A 검증 사이클에 Phase 2(raster 평탄화 출력)도 함께** 진행 권장:
- A로 PNG 액자 배치·채움·이동이 정상 → 그 상태로 PDF 생성 → 사진 누락(Phase 2 버그) 확인 → `_prepareObjectsForSvgExport`에 image-clipPath fillImage **raster 평탄화**(2D destination-out: 오프스크린에 사진 그리고 프레임 alpha로 destination-out → 단일 image 치환, no clipPath) 구현 → PDF 재생성 육안검증.
- 변환 수학(absolutePositioned+inverted+cover scale)이 까다로우니 **범위 한정(`extensionType==='fillImage' && clipPath?.type==='image'`)+try-catch**로 타 출력 무영향 보장.
- 정합 확인 후 PNG 액자 `is_active=1` 활성화.

## 6. 검증 계획 (브라우저 E2E 반복)
배포(editor=master push 자동) → Chrome MCP(Control_Chrome/Claude_in_Chrome)로:
1. 프레임 배치 → 단일클릭 선택(프레임 단위) → 이동/스케일 시 사진 동반(#4/#6).
2. 더블클릭 → 사진 pan/zoom(adjust) → 바깥클릭 종료(#5).
3. z-order: 프레임 테두리가 사진 위(#2).
4. 저장 → 새로고침/embed 재진입 → 위 동작 유지(rebind).
5. PNG 액자: 위 + PDF 생성 → 사진 보임(Phase 2).
6. B: admin에서 객체 권한 토글 → 템플릿 저장 → 고객 편집기 진입 → 권한대로 이동/삭제 가드.
- ⚠️ dirty 탭 beforeunload → 새 탭 사용. /embed 캐시버스트(cb) 필수.

## 7. 열린 결정 / 리스크
- **[결정·2026-06-16] Part B 기본 정책 = default permissive (⚠️ 추후 개발 검토사항)**:
  설계는 "default locked"(관리자 배치 상태 전부 잠금, 디자이너가 선택적 허용)였으나, 그대로
  적용하면 `movable` 플래그가 없는 **기존 라이브 템플릿·주문의 모든 객체가 일괄 동결**되는
  회귀가 발생한다. 그래서 1차 출하는 **default permissive**(undefined=허용) + admin opt-in
  (ControlBar '위치 고정' 토글로 `movable=false` 명시 잠금)으로 구현했다. 기존 `deleteable`
  (삭제잠금, 이미 출하)와 동일한 안전 모델.
  - **추후 검토**: 'default locked' 를 원하면 **per-template / per-site 플래그**로 도입 —
    템플릿에 배치된 객체만 기본 잠금하고 고객이 추가한 객체는 자유 편집 유지(템플릿 객체 vs
    고객 객체 구분 마커 필요). 도입 전 기존 데이터 영향·마이그레이션 분석 선행.
    트래킹: `docs/EDITOR_OBJECT_EDITING_SPEC.md` §3-2 **PERM-1**.
- A3 동기화: 이벤트 핸들러 vs Group 재구조화 — 1차 이벤트, 실패 시 group.
  → **[구현] 이벤트(변환행렬 델타) 방식으로 성공**. 이동·스케일·회전 모두 행렬로 일괄 처리.
- 회전 동기화는 v2로 미뤄도 됨(이동·스케일 우선). → **[구현] 행렬 방식이라 회전도 포함**(라이브 회전 E2E는 미수행).
- B 플래그 명명·기존 `editable` 사용처와 충돌 정리 필요.
  → **[구현] 신규 `movable` 플래그 채택**(기존 `editable`/`deleteable`/`lockInfo` 와 무충돌, 화이트리스트 등재).
- absolutePositioned clipPath 직렬화는 fabric 5.5.2에서 보존 확인됨(Phase1 워크플로 실측). fabric7 마이그레이션 시 재검증.
- 회귀 금지: Phase1 동작(rebind/frameRef/parentLayerId/setCoords) 유지.

## 8. 핵심 코드 앵커 (빠른 참조)
- 채우기: `useImageStore.ts` makeFrameInteractive:669, fillImageIntoFrame:774(image/inverted), fillImage:601(SVG/벡터), isFilled:678.
- 배치: `useEditorContents.ts` setupFrameContent:1821, loadCanvasData rebind(헬퍼 호출).
- rebind 헬퍼: `apps/editor/src/utils/frameInteractive.ts`.
- z-order/삭제/parentLayerId: `ObjectPlugin.ts` :122~234(z-order), :292~318(삭제).
- 잠금 프리미티브 선례: `AppEdit.tsx`:99~107,229~236.
- 직렬화 화이트리스트: `packages/canvas-core/src/utils/canvas.ts` extendFabricOption(:105 extensionType, :117 fillImage, :121 frameRef, :147 parentLayerId).
- PDF 출력 전처리: `ServicePlugin.ts` _prepareObjectsForSvgExport:1810, toSVG:974, svg2pdf:1033.
