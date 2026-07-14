# 에디터 UX 설계서 — Stage E1 컨트롤 코어 (2026-07-14)

> E트랙(에디터 UX 보강) Stage E0 산출 설계서. Stage E1 구현(스마트 가이드·변형 피드백·객체 액션 바·균등 분배·안전영역 경고)의 정본이다.
> 근거: 시장 표준 편집기 UX 조사 + storige 코드 정찰(2026-07 실측). 상세 실측 자료는 내부 계획 문서(로컬 전용) 참조.

## 0. 범위와 원칙

- 대상: `packages/canvas-core` 신규 플러그인 3종 + `apps/editor` 컴포넌트 1종 + 기존 분배 로직 이관.
- 원칙: **additive-only** — 신규 기능은 `VITE_ENABLE_*` 플래그(기본 on, 개별 off 가능) 뒤에 두고, `dispose()`에서 완전 정리한다. postMessage 엔벨로프 v1 시맨틱 불변, canvasData 직렬화 하위호환(가이드/툴팁은 저장에 유입되지 않음).
- 성능 예산: `object:moving/scaling/rotating` 훅 16ms(60fps) — 측정 증거 필수.

## 1. 정찰 확정 사실 (E0 재검증 결과)

| # | 항목 | 판정 |
|---|---|---|
| 1 | 균등 분배 | **실존** — `ControlBar.tsx:411`(3개+ 선택 시 노출, offHistory/onHistory 쌍 정상, center-to-center 균등). canvas-core AlignPlugin에는 부재, 테스트 전무 |
| 2 | excludeFromExport 객체의 히스토리 오염 | **무오염 확정**(테스트 10/10) — 히스토리 스냅샷은 커스텀 화이트리스트 직렬화이며 exclude 객체를 이중 차단. 단 **id 부여된 가이드는 첫 undo에서 삭제되는 기존 버그** 발견(`history.ts:601-617` 보존 예외 3종뿐) |
| 3 | 텍스트 효과 | 그림자·외곽선·곡선 **이미 구현+노출**(ControlBar 배선). 부재는 텍스트 배경뿐 — E3 스코프 축소 |
| 4 | 캔버스 객체 롱프레스 메뉴 | **없음**(contextMenu.ts 터치 경로 전무) — E2 신규 대상 |
| 5 | 회전 각도 스냅 | **전무**(snapAngle 미설정, 경합 코드 0) |
| 6 | 골든 하네스 | 사용 가능(fixture 자동 캡처 + compare.mjs 3계층). baseline은 throwaway — 비교 시점마다 신규 2회 캡처 |

## 2. 구현 명세 (직렬 1→5, 각 건 커밋 분리)

### 2-1. SmartGuidesPlugin + snapCoordinator (객체 간 정렬 가이드/스냅 + 회전 각도 스냅)
- 신규 `packages/canvas-core/src/plugins/SmartGuidesPlugin.ts` + `snapCoordinator.ts` + 콜로케이션 테스트. 플래그 `VITE_ENABLE_SMART_GUIDES`.
- object:moving 중 타 객체 엣지/센터(수직 3선·수평 3선) 근접 시 마젠타 가이드 표시+스냅. threshold는 화면 px 기준(canvas 좌표 `/zoom`) — 표시 15px/스냅 8px(기존 중앙 스냅과 동일 감각).
- RulerPlugin 경합 회피: RulerPlugin 무수정. 이동 객체 중심이 workspace 중앙 스냅 반경(8px) 이내면 SmartGuides가 양보(스킵).
- **가이드 객체는 id 미부여**(excludeFromExport:true, extensionType 'guideline') — 히스토리 무오염 실증 방식. 부수 수정(별도 커밋): `_loadHistory` 가이드 보존 판정에 `extensionType==='guideline' || excludeFromExport` 추가(기존 센터 가이드 undo 삭제 버그 동시 해소).
- 회전 각도 스냅: object:rotating에서 0/15/30/45…° ±3° 스냅, Shift 시 해제(데스크톱). 전역 snapAngle 설정 금지(이벤트 방식) — 모바일은 스냅 상시 적용, 플래그로 해제 가능.
- 성능: 드래그 시작 시 후보 경계 캐시(뷰포트 내+가시+비시스템만), mouse:up 무효화. 제외: workspace/GuideLine/extensionType∈{guideline,printguide}/excludeFromExport/자기 자신.
- done: 스냅 정확성 유닛 테스트 + toJSON 미포함 증명 + 히스토리 무오염 증명 + 60fps 측정 + **골든 픽스처에 excludeFromExport 오버레이 케이스 추가**(PDF 부재 단언).

### 2-2. TransformFeedbackPlugin (실시간 치수/각도/좌표 피드백)
- 신규 플러그인 + 테스트. **DOM 오버레이**(wrapperEl 내 absolute div, pointer-events:none) — 직렬화 원천 무관. 플래그 `VITE_ENABLE_TRANSFORM_FEEDBACK`.
- 이동 중 `X/Y mm`(getUnitSize) · 리사이즈 중 `W×H mm`(getScaledWidth/Height) · 회전 중 `각도°`. mouse:up/modified/selection:cleared에 숨김. pointer:coarse에서 폰트 확대.
- done: mm 변환 정확성 테스트 + 표시 중 객체 속성 무변경(순수 read) + dispose 시 DOM 제거.

### 2-3. ObjectActionBar (선택 객체 플로팅 액션 바)
- 신규 `apps/editor/src/components/editor/ObjectActionBar.tsx`(EmptyCanvasHint 배치 패턴 준용). 플래그 `VITE_ENABLE_OBJECT_ACTION_BAR`.
- 선택 객체 상단 플로팅 바(뷰포트 clamp), v1 버튼 **복제·삭제 2종**. selection:created/updated/cleared 구독, 변형 중 숨김→modified 재표시.
- 게이팅: `deleteable===false`→삭제 숨김, `CopyPlugin.isCloneProtected()`→복제 숨김, LockPlugin lockInfo 연동(레이어 UX L1~L3 규약 정합). 멀티 선택은 복제/삭제 경로의 ActiveSelection 지원 실물 확인 후 범위 결정.
- 터치: coarse에서 버튼 44pt+, 임베드 소형 뷰포트에서 캔버스 밖 이탈 금지.
- done: 보호 매트릭스(잠금 4단계×버튼) 테스트 + fe-qa 뷰포트 3종.

### 2-4. 균등 분배 이관 (AlignPlugin 공개 API화)
- `ControlBar.tsx:411-460` 로직을 `AlignPlugin.distributeH()/distributeV()`로 이동(offHistory/onHistory 쌍 유지, fabric 프라이빗 `_centerObject` 의존 정리), ControlBar는 기존 alignH/alignV 패턴으로 위임만.
- `AlignPlugin.test.ts` 신설: 첫/끝 고정 + 중간 center 균등 회귀 테스트.

### 2-5. SafeZoneWarningPlugin (재단/안전영역 침범 실시간 경고)
- 신규 플러그인. 플래그 `VITE_ENABLE_SAFEZONE_WARNING`. object:moving/scaling 중 객체 경계가 안전영역(safeSizeBorder) 밖·재단선(cutBorder) 근접 시: 워크스페이스 테두리 강조(excludeFromExport 오버레이) + 토스트(기존 useToastStore, 디바운스로 과발화 방지).
- 전제: WorkspacePlugin cutBorder/safeSizeBorder 좌표 재사용(신규 계산 금지). 보호객체·workspace 제외.
- done: 침범/복귀 시나리오 테스트 + 스프레드(펼침면) 모드 경계 정합 + 토스트 과발화 없음.

## 3. 검증 게이트 (순서 고정)

`pnpm --filter @storige/types build` → 전체 typecheck/lint → `--filter @storige/canvas-core test` → `--filter @storige/editor` build/test → canvasData 왕복(신기능 활성 상태 저장→로드→재저장 동일) → 골든(직전/반영 커밋 신규 2회 캡처+자기일치 선확인) → 적대 리뷰 2렌즈(정합/회귀+성능/터치) → fe-qa(375/768/1280+임베드).

## 4. 리스크와 롤백

- 스냅 이중 당김: RulerPlugin 양보 규칙으로 구조적 방지. PointerShiftGuardPlugin 회전 앵커 경로는 이벤트 방식 채택으로 무접촉.
- 임베드 파트너 2곳 무중단: 신규 기능 전부 additive+플래그 — 플래그 off 시 현행과 동일 동작이 롤백 경로. 배포 전 파트너 공지(오너).
- 히스토리 화이트리스트(스냅샷)와 저장 화이트리스트(extendFabricOption)는 별개 체계 — 신규 직렬화 속성 없음이 이번 범위의 전제.
