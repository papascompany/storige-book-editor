# 에디터 UX/에셋 라이브러리 격차 로드맵 (정본 v1.0 — 2026-07-07)

> **트랙 구분**: 본 문서는 **편집기 UX 트랙(E트랙)** 정본이다. 같은 날짜의 `SWEETBOOK_GAP_ROADMAP_2026-07-07.md`(Partner Platform API 트랙)와 **상호 독립** — 대상 코드 영역이 분리되어(editor/canvas-core/admin Library vs api/partner-api) 병행 가능하나, 같은 파일을 만질 때(드묾)는 STATUS 공유로 조정한다.
> **실측 근거**: Claude(Fable 5) 정찰 에이전트 3종 (2026-07-07) — ①storige 에셋 라이브러리 전수(에디터 패널·API 라우트 29종·엔티티 7종·admin 화면 6종), ②canvas-core 플러그인 23종·컨트롤/인터랙션 10축, ③sweet-book/socialBook-demo 전 소스 정독.
> **벤치마크**: Canva · miricanvas(미리캔버스) · sweetbook socialBook-demo. **socialBook-demo는 실측 결과 풀 편집기가 아님**(템플릿 파라미터 바인딩 데모) — 컨트롤 벤치마크는 Canva/miricanvas 축, 자동화/입력소스 벤치마크만 socialBook-demo 축.
> **오케스트레이션 실행**: `EDITOR_UX_ORCHESTRATION_MASTER_PROMPT_2026-07-07.md` (Opus 4.8 + 서브에이전트 하네스 v2.0)를 사용한다. 본 문서 §6 프롬프트는 그 원료다.

---

## 0. 지시 해석 + 절대 제약 (이 문서의 발효 조건)

오너 지시(2026-07-07) — *"Canva·miricanvas·socialBook-demo 같은 웹에디터의 에셋 라이브러리(클립아트·사진틀·텍스트박스·배경)와 편집기 기본 컨트롤(핸들러·툴팁 등)을 분석해 우리 편집기의 부족/미구현 부분을 보완"* — 을 **E트랙 가동 결정으로 해석**한다.

**절대 불변 제약 (모든 Stage 공통)**:
1. **임베드 파트너 2곳 무중단** — bookmoa-mobile·ShareSnap이 이 에디터를 iframe으로 **프로덕션 사용 중**. postMessage 엔벨로프 v1(이벤트 9종·명령 3종) 시맨틱 불변. 에디터 UI/레이아웃 변경은 임베드 골든 시나리오 회귀 확인이 머지 전제.
2. **canvasData 직렬화 하위호환** — 기존 저장 세션(edit_sessions.canvas_data)이 신규 코드에서 로드·렌더·저장 왕복 가능해야 한다. 신규 객체 속성은 `propertiesToInclude` 등재 + 로드 폴백(속성 부재 시 기본값) 필수. fabric 함정 준수: textbox styles 키 누락 크래시(ensureTextStyles 경유), loadJSON 치수 오염.
3. **인쇄 산출물 패리티** — 에디터 화면에 보이는 시각 효과는 최종 인쇄 PDF에서 동일하게 렌더되어야 한다. 렌더 경로에 영향을 주는 변경(신규 텍스트 효과·곡선 텍스트 등)은 **골든 하네스(픽셀 diff) green이 머지 전제**. 워커 검증 상수(LEGACY_SIZE_TOLERANCE_MM 등) 변경 절대 금지.
4. **additive-only** — 라이브러리 API 기존 응답 shape·엔티티 컬럼 시맨틱 불변(컬럼 추가만). `/external` 동결 16라우트(`docs/CONTRACT_FREEZE.md`)는 이 트랙에서 접촉 자체가 없어야 정상 — 접촉이 필요해 보이면 설계 오류로 간주하고 STOP.
5. **성능 예산** — 캔버스 인터랙션 훅(object:moving/scaling/rotating)에 추가되는 로직은 60fps 유지(프레임 16ms 내). 스로틀/캐시 없이 전 객체 순회 금지. 모바일 저사양 실기 확인.
6. TS strict·`any` 금지 · `pnpm --filter @storige/types build` 선행 · 테스트 무결성(티켓 없는 `.skip` 금지, 대상 함수 자체 모킹 금지) · 프로젝트 스킬 필독(`fabric-editor`, `editor-object-editing`, 포토북 관련 시 `photobook-template`).

---

## 1. 벤치마크 정의

### 1.1 socialBook-demo (실측 완료 — 정찰 ③)

**정체**: sweetbook Book Print API의 Node SDK 데모(v0.4.0). Google Photos OAuth/로컬 업로드/JSON 3개 입력 소스 → EXIF 날짜 정렬 → 월/일 분기 자동 레이아웃 → 템플릿 파라미터 바인딩 → finalize. **캔버스 편집·핸들·툴팁·에셋 패널 없음.**

**우리가 가져올 것(3건만)**: ①Google Photos 등 외부 사진 소스 입력(§5 Stage E5, 오너 게이트) ②일시중지→이어서하기 상태 복구 패턴(장시간 자동편집 UX) ③EXIF 파싱의 파일명 폴백 규칙(KakaoTalk_/IMG_ 프리픽스 — 우리 자동편집 입력 강화). 그 외는 우리가 이미 우위(EXIF 자동배치 4모드 기보유).

### 1.2 Canva / miricanvas (지식 기반 초안 — Stage E0에서 실측 확정)

경쟁 편집기의 "기본기" 체크리스트. ⚠️ 아래는 학습 지식 기반이므로 Stage E0에서 실제 제품 확인(Chrome 실측 또는 오너 확인) 후 격차 매트릭스를 확정한다.

| 영역 | 벤치마크 표준 동작 |
|---|---|
| 스마트 가이드 | 드래그 중 다른 객체의 엣지/센터와 정렬되면 마젠타 정렬선 + 스냅, 등간격 배치 시 간격 힌트 |
| 실시간 피드백 | 리사이즈 중 W×H 툴팁, 회전 중 각도 툴팁(+15° 단위 스냅), 이동 중 좌표 |
| 객체 액션 바 | 선택 객체 위 플로팅 버튼(삭제·복제·더보기) — 특히 모바일에서 주 조작 수단 |
| 컨텍스트 메뉴 | 우클릭 + 모바일 롱프레스 동등 제공 |
| 조작 보조 | Alt+드래그 복제, 균등 분배(가로/세로), 그룹 리사이즈, 방향키 nudge |
| 텍스트 | 제목/부제/본문 원클릭 프리셋, 조합형 텍스트 스타일(디자인된 텍스트 그룹), 곡선 텍스트, 효과(그림자·외곽선·배경·네온 등) |
| 에셋 패널 | 키워드 검색+태그, 카테고리 브라우징, 즐겨찾기(별표), 최근 사용, 내 업로드 관리 |
| 배경 | 단색/그라데이션/패턴/이미지 라이브러리, 태그 필터 |
| 사진틀 | 다양한 마스크 모양(원·하트·폴리곤·프레임형), 사진 드롭 시 하이라이트, 더블클릭 크롭 |

---

## 2. 우리 편집기 실태 — 강점 (코드 실증, 정찰 ①②)

1. **에셋 라이브러리 인프라는 이미 완결 구조** — `library_fonts/backgrounds/cliparts/shapes/frames` 엔티티 5종 + `library_categories`(트리·타입별) + 태그(JSON) + admin CRUD 6화면 + 에디터 패널(AppElement/AppFrame/AppBackground/AppText/AppImage) + 검색(300ms 디바운스)·태그칩 + 사이트 테넌시(siteId) + 템플릿셋 큐레이션(`template_set_library_categories`, 0건=전역 폴백). **격차는 인프라가 아니라 "패널 UX 마감 + 콘텐츠 볼륨"**.
2. **컨트롤 커스터마이즈 기보유** — ControlsPlugin: 코너 원형/변 캡슐형/회전 전용 아이콘(하단 36px, 연결선), `pointer:coarse` 시 핸들 16px 확대. 방향키 nudge 1px/Shift 10px.
3. **정렬·조작 기본기** — AlignPlugin 6방향 정렬, GroupPlugin, ObjectPlugin z-order([/]), CopyPlugin(Ctrl+C/V/D, 보호객체 복제 차단), 우클릭 컨텍스트 메뉴(플러그인 hotkeys 연동 동적 구성), 단축키 모달.
4. **줌/패닝/터치** — 휠 줌, 핀치 줌+회전, Space 패닝, fit-to-screen, PointerShiftGuardPlugin 좌표 보정, 터치 타깃 44pt+.
5. **인쇄 특화 가이드** — 재단선/안전영역/크롭마크 3층(WorkspacePlugin), 룰러+중앙 스냅(RulerPlugin, threshold 8px/가이드 15px), 다크모드 동기화.
6. **권한 잠금 4단계 + 레이어 UX L1~L3**(2026-07-06 완료 — 보호 드롭다운·고객 시점 미리보기), 히스토리 패널+자동저장 표시.
7. **벤치마크에 없는 심화 기능** — 배경 제거(OpenCV), QR/바코드, 스프레드(펼침면) 편집, EXIF 자동배치 4모드, 이미지 필터/크롭.

**전략 함의**: Canva류를 통째로 복제할 필요 없음. 격차는 **"드래그하는 순간의 손맛"(피드백·스냅·액션 버튼)과 "텍스트 표현력", "에셋 재방문 UX(즐겨찾기·최근)"** 3개 영역에 집중되어 있고, 전부 기존 플러그인 아키텍처의 연장선에서 additive로 구현 가능하다.

## 3. 격차 매트릭스 (실측 판정)

### 3-A. 캔버스 컨트롤 (정찰 ②)

| # | 축 | 벤치마크 | storige 실측 | 판정 |
|---|---|---|---|---|
| C1 | 객체 간 스마트 가이드 | 엣지/센터 정렬선+스냅+등간격 힌트 | **없음** — 워크스페이스 중앙 스냅만(RulerPlugin.ts:284-297) | **P0** |
| C2 | 실시간 치수/각도/좌표 피드백 | 리사이즈 W×H·회전 각도·이동 좌표 툴팁 | **없음** | **P0** |
| C3 | 객체 위 액션 버튼 | 삭제/복제/더보기 플로팅 바(모바일 핵심) | **없음** — 핸들만 | **P0** |
| C4 | 균등 분배 | 가로/세로 등간격 분배 | **없음** — 6방향 정렬만(AlignPlugin.ts:107-191) | **P1** |
| C5 | Alt+드래그 복제 | 표준 | **없음** — Ctrl+D만(CopyPlugin.ts:24-28) | **P1** |
| C6 | 모바일 롱프레스 메뉴 | 우클릭과 동등 | **없음** — 우클릭만(contextMenu.ts) | **P1** |
| C7 | 회전 각도 스냅 | 0/15/45/90° 스냅 | 미확인(E0 재검증) — 각도 피드백은 확실히 없음 | **P1** |
| C8 | 그리드 스냅 | 옵션 제공 | **없음** | P2 |
| C9 | 단축키 목록 정합 | 자동 생성 | 모달 하드코딩 — 플러그인 hotkeys와 수동 동기화(KeyboardShortcutsModal.tsx:32-74) | P2 |
| C10 | 터치 제스처 온보딩/로딩 진행 바 | 제공 | 없음/토스트만 | P2 |

### 3-B. 에셋 라이브러리 (정찰 ①)

| # | 축 | 벤치마크 | storige 실측 | 판정 |
|---|---|---|---|---|
| A1 | 텍스트 스타일 프리셋 | 제목/부제/본문+조합형 디자인 텍스트 | **없음** — "텍스트 추가" 단일 버튼, 추천 콘텐츠 섹션 빈 껍데기(AppText.tsx:127-131) | **P0** |
| A2 | 텍스트 효과 | 그림자/외곽선/배경/네온 UI | ⚠️ **정찰 상충** — 정찰②는 TextEffect.tsx 존재 판정, 정찰①은 UI 없음 판정. **E0 재검증 1순위** | **P0(검증)** |
| A3 | 곡선 텍스트 | 제공 | **없음** | **P1** |
| A4 | 즐겨찾기/최근 사용 | 별표+최근 탭 | **없음** — 조회 결과 나열만(useLibraryPanel.ts) | **P1** |
| A5 | 배경 태그 필터 | 태그 검색 | **불가** — `library_backgrounds`에 tags 컬럼 없음(enableTags:false) | **P1** |
| A6 | 도형 기본 세트 | 기본 도형 수십 종 즉시 사용 | 인프라만(library_shapes) — 시드 콘텐츠 볼륨 미확인(E0 실측) | **P1** |
| A7 | 사진틀 모양 다양성 | 원/하트/폴리곤/프레임형 다수 | 업로드된 SVG에 의존 — 코드 제약 없음, 콘텐츠 볼륨 미확인(E0 실측) | **P1(콘텐츠)** |
| A8 | 검색 품질 | 이름+태그 통합, 연관 추천 | 이름 LIKE만(+클립아트 태그 검색 별도 라우트) | P2 |
| A9 | 내 업로드 관리 | 삭제/정리/사용처 표시 | 부분 — 업로드·목록만(useImageStore) | P2 |
| A10 | 외부 사진 소스 | Google Photos 등 | **없음** — socialBook-demo 벤치 | P2(오너) |

### 3-C. 강점 확인 축 (보완 불요)

핸들 커스터마이즈·터치 핸들 확대·정렬 6방향·z-order·잠금 4단계·핀치 줌/회전·재단선/안전영역·히스토리 패널·배경제거·QR — **벤치마크 동등 이상**.

---

## 4. 아키텍처 결정 (AD-E)

- **AD-E1 (플러그인 경계)**: 신규 캔버스 동작은 canvas-core **신규 플러그인**(SmartGuidesPlugin, TransformFeedbackPlugin, ObjectActionBarPlugin)으로 추가. 기존 플러그인 수정은 최소화(RulerPlugin 중앙 스냅과의 스냅 조정자 통합, AlignPlugin 분배 메서드 추가 정도). 이유: 23종 플러그인 체계 유지 + 임베드 회귀 반경 축소 + 기능 플래그로 개별 롤백 가능.
- **AD-E2 (스냅 조정자 단일화)**: C1(객체 간)·기존 중앙 스냅·C7(각도)·C8(그리드)은 **하나의 SnapCoordinator**를 경유해 우선순위(객체 간 > 중앙 > 그리드)와 threshold를 일원 관리. 이중 스냅 경합(중앙 스냅과 객체 스냅이 서로 당기는 현상) 구조적 방지.
- **AD-E3 (오버레이 레이어)**: 가이드라인·치수 툴팁·액션 바는 fabric 객체가 아니라 **캔버스 위 별도 오버레이**(fabric 상단 캔버스 또는 DOM 절대배치)에 그린다 — canvasData 직렬화 오염 0 보장(제약 §0-2), 히스토리 스냅샷 오염 방지.
- **AD-E4 (텍스트 프리셋 = 라이브러리 6번째 타입)**: 텍스트 스타일 프리셋은 기존 패턴 그대로 `library_text_presets` 엔티티+admin CRUD+에디터 패널로 추가(additive). 프리셋 데이터는 fabric 속성 집합(JSON) — 신규 직렬화 포맷 발명 금지.
- **AD-E5 (렌더 패리티 게이트)**: 화면 픽셀에 영향을 주는 신규 기능(곡선 텍스트·텍스트 효과)은 "에디터 렌더 = 인쇄 산출물 렌더" 경로를 Stage E0에서 실측 확정하기 전 구현 착수 금지. 골든 하네스에 효과별 픽스처 추가가 done criteria.
- **AD-E6 (즐겨찾기/최근 저장 위치)**: 게스트 사용자 존재(임베드 파트너 경유) → 최근 사용=localStorage(기기 로컬), 즐겨찾기=로그인 시 서버(`user_asset_favorites`)+게스트 시 localStorage, 로그인 전환 시 병합. 서버 강제 시 게스트 UX 파손.

## 5. 단계별 개발 로드맵 (Stage E0~E5)

> 공통: §0 절대 제약 + 검증 게이트(types 선빌드→typecheck→build→test→골든 하네스(해당 시)→임베드 골든 시나리오→fe-qa 뷰포트 매트릭스). 세션당 Stage 1개 권장.

### Stage E0 — 기준선 + 재검증 + 설계서 (2~3일, 코드 0)
1. **정찰 상충/미확인 해소** — A2 텍스트 효과 실태(TextEffect.tsx·EffectPlugin 실물 정독), C7 각도 스냅 유무, A6 도형·A7 사진틀 **프로덕션 DB 콘텐츠 볼륨 실측**(admin 조회), 컨텍스트 메뉴 항목 전수.
2. **인쇄 렌더 경로 실측(AD-E5 전제)** — 편집 캔버스→최종 PDF 산출 경로(래스터 dpi·폰트 임베드·효과 반영 방식)를 코드로 확정, 신규 시각 기능의 패리티 리스크를 자동보장/골든필수/불가 3급으로 분류.
3. **벤치마크 실측 확정** — §1.2 초안을 Canva/miricanvas 실제 확인으로 검증(Chrome 실측 또는 오너 스크린샷), 격차 매트릭스 판정 갱신.
4. **골든 기준선 캡처** — 대표 세션(텍스트·프레임·클립아트 포함) 렌더 기준선 저장, 이후 Stage의 회귀 기준.
5. **★ `docs/EDITOR_UX_DESIGN_2026-07-07.md` 설계서** — SnapCoordinator 설계(AD-E2), 오버레이 레이어 설계(AD-E3), 플러그인 3종 인터페이스, `library_text_presets`·`user_asset_favorites`·backgrounds.tags DDL 초안, 성능 예산(60fps 측정 방법), 기능 플래그 체계, 임베드 회귀 시나리오 목록.

### Stage E1 — 캔버스 컨트롤 코어 (1~2주) — C1·C2·C3·C7 [P0]
1. **SmartGuidesPlugin** — 드래그 중 타 객체 엣지/센터 정렬선(수직·수평)+스냅, 등간격 힌트(후순위 가능), 뷰포트 내 객체만 대상+경계 캐시로 60fps 유지, SnapCoordinator 경유로 중앙 스냅과 통합.
2. **TransformFeedbackPlugin** — 이동 중 X/Y, 리사이즈 중 W×H를 **mm 단위**(인쇄 제품 — `docs/COORDINATE_SYSTEM.md` px↔mm 변환 준수)로, 회전 중 각도를 오버레이 툴팁 표시.
3. **회전 각도 스냅** — 0/15/45/90° threshold 스냅(Shift로 해제 또는 활성 — E0 벤치 실측 따름).
4. **ObjectActionBarPlugin** — 선택 객체 위 플로팅 액션 바: 삭제·복제·(프레임이면)사진교체·더보기(컨텍스트 메뉴 호출). 터치 우선 크기, 잠금/보호 객체는 권한별 버튼 감산(LockPlugin lockInfo 연동), 임베드 소형 뷰포트에서 위치 파손 없음.

### Stage E2 — 조작 UX 마감 (1주) — C4·C5·C6·C9 [P1]
1. **균등 분배** — AlignPlugin에 distributeH/V 추가(3개+ 선택 시 활성), ControlBar 버튼+단축키.
2. **Alt+드래그 복제** — CopyPlugin 확장, 보호객체 복제 차단 로직(isCloneProtected) 재사용.
3. **모바일 롱프레스 컨텍스트 메뉴** — 기존 ContextMenu 재사용, 500ms 롱프레스+햅틱(가능 시), 핀치/드래그와 제스처 충돌 없음(PointerShiftGuardPlugin 경합 주의).
4. **단축키 레지스트리 자동화** — 플러그인 hotkeys 배열→모달 자동 생성(하드코딩 제거), 스냅/가이드 토글 설정 UI(스마트 가이드·그리드·중앙 각각 on/off, localStorage 영속 — 룰러 showRuler 영속 패턴 준용).

### Stage E3 — 텍스트 표현력 (2~3주) — A1·A2·A3 [P0~P1, 패리티 게이트]
1. **텍스트 스타일 프리셋(A1)** — `library_text_presets` 엔티티+admin CRUD(기존 Library 6종 패턴 복제)+AppText 패널 프리셋 그리드(제목/부제/본문 기본 시드 포함). 프리셋 적용=fabric 속성 일괄 적용(ensureTextStyles 경유 필수).
2. **텍스트 효과 UI 정비(A2)** — E0 실태 판정에 따라: 기존 TextEffect가 실기능이면 노출/확장, 껍데기면 그림자·외곽선·배경 하이라이트 구현. 각 효과는 E0 패리티 분류상 자동보장/골든필수 확인 후 착수.
3. **곡선 텍스트(A3)** — fabric 5.x path 기반. **왕복 보존(저장→로드→재저장 동일)·PDF 패리티 골든·기존 세션 무영향**이 done criteria. 리스크 최고 항목 — 별도 브랜치, 기능 플래그, 실패 시 Stage 분리 철회 가능하게.
4. **조합형 텍스트 디자인(후순위)** — 그룹(텍스트 2~3개+도형) 프리셋. 1~3 완료 후 여력 시.

### Stage E4 — 에셋 라이브러리 UX (1~2주) — A4·A5·A8·A9 [P1~P2]
1. **즐겨찾기+최근 사용(A4)** — AD-E6 저장 전략. 패널 상단 탭(전체/즐겨찾기/최근) — 5개 패널(요소/프레임/배경/텍스트프리셋/내사진) 공통 훅(useLibraryPanel 확장)으로 1회 구현.
2. **backgrounds.tags 추가(A5)** — additive 마이그레이션+admin 태그 입력+패널 태그칩 활성화(enableTags:true), 기존 category 자유텍스트는 불변.
3. **검색 개선(A8)** — 이름+태그 통합 검색(라이브러리 공통), 결과 0건 시 전역 폴백 안내(기존 큐레이션 폴백 패턴 정합).
4. **내 업로드 관리(A9)** — 삭제·다중선택 정리, "사용 중" 배지(현재 캔버스 참조 여부).

### Stage E5 — 콘텐츠 볼륨 + 외부 소스 (오너 게이트 병행) — A6·A7·A10
1. **도형 기본 세트 시드(A6)** — 기본 벡터 도형(사각/원/삼각/선/화살표/별/말풍선/프레임선 등) 자체 제작 SVG 시드 스크립트+카테고리 구성. 라이선스 이슈 없는 자체 제작분만.
2. **사진틀 모양 세트(A7)** — 마스크 SVG(원/하트/폴리곤/모서리라운드/필름형 등) 시드. FrameInteractionPlugin 스왑 UX와 E1 액션 바(사진교체 버튼) 연동 확인.
3. **클립아트/배경 콘텐츠 소싱(오너)** — 코드 아님. 상용 라이선스 구매 vs 자체 제작 vs CC0 큐레이션 결정(§7-3). 결정 전에는 시드 스크립트·업로드 파이프라인 정비까지만.
4. **(오너 게이트) Google Photos 입력(A10)** — socialBook-demo 패턴(클라이언트 OAuth+백엔드 키 격리) 준용해 자동편집 입력 소스 추가. Google Cloud 앱 등록/심사 필요 — 오너 결정 후.

**의존 관계**: E0 → E1 → E2, E3·E4는 E0 후 E1과 병렬 가능(디렉터리 분리: E1=canvas-core, E3=api/admin/editor-AppText, E4=api/admin/editor-패널 훅. 단 E3·E4는 editor 패널 파일이 겹칠 수 있어 상호 직렬 권장). E5는 E1(액션 바)·E4(패널) 후.

---

## 6. 작업지시 프롬프트 EA~EF (storige 세션 투입용)

> 각 프롬프트 자립형. 오케스트레이션 실행 시 `EDITOR_UX_ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`를 사용하고 아래는 Stage 명세 원료로 쓴다.

### 프롬프트 EA — Stage E0 (기준선 + 재검증 + 설계서)

```
[Stage E0 — 에디터 UX 트랙 기준선: 정찰 재검증 + 인쇄 렌더 경로 실측 + 설계서]

세션 시작 프로토콜대로 CLAUDE.local.md → .cursor/plans/EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§0 제약·§3 매트릭스·§4 AD-E)
→ 프로젝트 스킬 fabric-editor·editor-object-editing → git log -10 을 먼저 읽어라. 코드 변경 0(문서·픽스처만).

작업 5건:

1. 정찰 상충 해소(실물 정독으로 판정) —
   a) A2: apps/editor/src/controls/TextEffect.tsx(존재 시)와 packages/canvas-core/src/plugins/EffectPlugin.ts 실태:
      실기능(어떤 효과가 실제 적용·저장·재로드되는가) vs 껍데기. 근거 파일:라인 명시.
   b) C7: 회전 각도 스냅 존재 여부(ControlsPlugin·fabric 기본 snapAngle 설정 포함).
   c) 컨텍스트 메뉴 실제 항목 전수(contextMenu.ts + 각 플러그인 hotkeys의 generateContext).
2. 인쇄 렌더 경로 실측 — 편집 캔버스가 최종 인쇄 PDF가 되는 전 경로를 코드로 추적
   (ServicePlugin save → API → worker 합성, 포토북 300dpi 래스터 경로 포함).
   산출: "신규 시각 기능 패리티 분류표" — 자동보장(래스터 경로라 화면=산출물) / 골든필수 / 구현불가 3급.
   곡선 텍스트·그림자·외곽선·그라데이션 각각 분류.
3. 프로덕션 콘텐츠 볼륨 실측 — library_shapes/frames/cliparts/backgrounds 활성 행 수·카테고리 분포
   (CLAUDE.local.md §6.7 DB 조회 레시피 준용, 읽기 전용 SELECT만). A6·A7 판정 확정.
4. 골든 기준선 — 텍스트(스타일 포함)·사진틀·클립아트·배경이 모두 든 대표 캔버스 픽스처 1~2본 제작,
   현행 렌더 산출물 캡처를 기준선으로 저장(기존 골든 하네스 위치·규약 준수, 캡처 산출물 git 추적 정책은
   커밋 018b4d8 정책 확인 후 따름).
5. docs/EDITOR_UX_DESIGN_2026-07-07.md 작성 —
   SnapCoordinator(우선순위: 객체간>중앙>그리드, threshold 표, RulerPlugin 중앙 스냅 통합 방법),
   오버레이 레이어(AD-E3: fabric 직렬화·히스토리 오염 0 설계), 플러그인 3종(SmartGuides/TransformFeedback/
   ObjectActionBar) 인터페이스와 이벤트 구독표, library_text_presets·user_asset_favorites·backgrounds.tags DDL,
   성능 예산과 측정 방법(60fps, 저사양 모바일), 기능 플래그 체계, 임베드 회귀 시나리오 목록
   (bookmoa-mobile·ShareSnap 골든 시나리오), Canva/miricanvas 벤치 실측 결과로 §1.2 확정판.

제약: §0 절대 제약. 프로덕션 DB는 읽기 SELECT만. 검증: 설계서 내부 정합(매트릭스 번호 참조 무결),
픽스처 로드·렌더 재현 명령 기록. 보고: Changed/Verified/Notes + 상충 판정 결과표.
```

### 프롬프트 EB — Stage E1 (캔버스 컨트롤 코어)

```
[Stage E1 — 컨트롤 코어: SmartGuides + TransformFeedback + 각도 스냅 + ObjectActionBar]

세션 시작 프로토콜대로 CLAUDE.local.md → EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§0·§4·§5 Stage E1)
→ docs/EDITOR_UX_DESIGN_2026-07-07.md(구현 명세 — E0 산출) → 스킬 fabric-editor 를 먼저 읽어라.
Stage E0 머지 선행(git log 확인). 작업 1건=브랜치 1개, 순서 1→2→3→4(1의 SnapCoordinator가 3의 전제).

작업 4건:

1. SnapCoordinator + SmartGuidesPlugin — packages/canvas-core/src/plugins/ 신규.
   드래그 중 타 객체 엣지(좌/중/우/상/중/하)와 정렬 시 가이드라인 표시+스냅. 설계서의 threshold·우선순위 준수.
   기존 RulerPlugin 중앙 스냅을 coordinator 경유로 이관(동작 결과 불변 — 이중 스냅 경합 제거가 목적).
   성능: 뷰포트 내 객체만+경계 캐시, object:moving 핸들러 16ms 내(측정 증거 필수).
   가이드라인은 오버레이 레이어(AD-E3) — canvasData·히스토리에 절대 미포함(왕복 테스트로 증명).
2. TransformFeedbackPlugin — 이동 X/Y·리사이즈 W×H(mm, docs/COORDINATE_SYSTEM.md 변환 준수)·회전 각도
   오버레이 툴팁. 표시만 하는 순수 read 플러그인(객체 속성 변경 0).
3. 회전 각도 스냅 — E0 벤치 실측 확정안대로(기본 0/15/45/90°, 해제 조합키 포함). SnapCoordinator 경유.
4. ObjectActionBarPlugin + 에디터 연동 — 선택 시 객체 상단 플로팅 바(삭제·복제·프레임이면 사진교체·더보기=
   기존 컨텍스트 메뉴 호출). LockPlugin lockInfo·보호객체 권한별 버튼 감산(레이어 UX L1~L3 규약 정합).
   pointer:coarse에서 버튼 44pt+. 소형 뷰포트(임베드 iframe)에서 캔버스 밖으로 나가지 않는 배치 로직.

제약: §0 전 항목. 신규 플러그인은 기능 플래그로 개별 off 가능. 기존 저장 세션 로드 회귀 금지.
검증: types 선빌드→typecheck→build→test + 골든 기준선 diff 0(시각 효과 무변경 증명) + canvasData 왕복
바이트 불변 테스트 + fe-qa 뷰포트 매트릭스(375/768/1280, 임베드 시나리오 포함) + 60fps 측정 증거.
```

### 프롬프트 EC — Stage E2 (조작 UX 마감)

```
[Stage E2 — 조작 UX: 균등 분배 + Alt드래그 복제 + 롱프레스 메뉴 + 단축키 자동화·스냅 설정]

세션 시작 프로토콜대로 CLAUDE.local.md → EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§5 Stage E2)
→ docs/EDITOR_UX_DESIGN_2026-07-07.md → 스킬 fabric-editor·editor-object-editing 을 먼저 읽어라.
Stage E1 머지 선행. 작업 1건=브랜치 1개, 1·2·3 병렬 가능(파일 disjoint 확인 후), 4는 마지막.

작업 4건:

1. 균등 분배 — AlignPlugin에 distributeH()/distributeV()(3개+ 선택 시), ControlBar 버튼·컨텍스트 메뉴·
   단축키 등재. 분배 기준은 경계 박스 간격 균등(벤치 표준). 보호객체(movable=false) 포함 선택 시 제외 규칙.
2. Alt+드래그 복제 — CopyPlugin 확장. isCloneProtected() 재사용, 히스토리 1엔트리(드래그 종료 시점),
   스마트 가이드와 동시 동작 확인.
3. 모바일 롱프레스 컨텍스트 메뉴 — 기존 ContextMenu 재사용, 500ms·이동 임계 내에서만 발화.
   핀치/드래그/PointerShiftGuardPlugin 과 제스처 경합 없음을 실기 터치 시나리오로 증명.
4. 단축키 레지스트리 자동화 + 스냅 설정 — 플러그인 hotkeys 메타에서 KeyboardShortcutsModal 자동 생성
   (하드코딩 제거, 표시명·카테고리는 hotkeys 메타에 additive 필드로), 설정 팝오버(스마트 가이드/그리드/
   중앙 스냅/각도 스냅 개별 토글, showRuler 영속 패턴 준용 localStorage).

제약: §0. 검증: 전체 게이트 + 임베드 골든 시나리오(롱프레스가 iframe 터치 스크롤과 충돌 없음) + fe-qa.
```

### 프롬프트 ED — Stage E3 (텍스트 표현력 — 패리티 게이트)

```
[Stage E3 — 텍스트: 스타일 프리셋 + 효과 UI + 곡선 텍스트 (인쇄 패리티 게이트)]

세션 시작 프로토콜대로 CLAUDE.local.md → EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§0-3·§4 AD-E4/E5·§5 Stage E3)
→ docs/EDITOR_UX_DESIGN_2026-07-07.md(패리티 분류표 — 이것이 착수 가능 여부의 정본)
→ 스킬 fabric-editor(styles 함정 절 필독) 을 먼저 읽어라. Stage E0 머지 선행(E1과 병렬 가능 — 디렉터리 분리).
⚠️ 패리티 분류표에서 '구현불가' 판정 항목은 구현하지 말고 OWNER-DECISION 으로 분리.

작업 4건 (1→2→3 순, 각 별도 브랜치, 4는 여력 시):

1. 텍스트 스타일 프리셋 — library_text_presets 엔티티+마이그레이션(additive)+admin CRUD 화면
   (기존 Library 6종 패턴 복제: List·카테고리·활성 토글·사이트 테넌시)+AppText 패널 프리셋 그리드
   (제목/부제/본문 기본 3종 시드 포함). 적용은 fabric 속성 일괄 적용 — ensureTextStyles 경유,
   기존 텍스트에 적용/새 텍스트 생성 두 경로. canvasData 에는 결과 속성만 저장(프리셋 참조 저장 금지 —
   프리셋 삭제 시 기존 세션 파손 방지).
2. 텍스트 효과 UI — E0 판정에 따라 기존 TextEffect/EffectPlugin 확장 또는 신규(그림자·외곽선·배경 하이라이트).
   각 효과는 패리티 분류 '자동보장' 또는 '골든필수+골든 추가' 확인 후 착수. 효과 속성 왕복 보존 테스트.
3. 곡선 텍스트 — fabric 5.x path 기반, 기능 플래그 뒤에서 구현. done criteria:
   저장→로드→재저장 왕복 동일 + 골든 픽셀 diff 통과(에디터 vs 인쇄 산출) + 곡선 텍스트 없는 기존 세션 무영향
   + 편집(더블클릭 인라인) UX 동작. 셋 중 하나라도 미달이면 머지하지 말고 BLOCKERS 기록.
4. (여력 시) 조합형 텍스트 디자인 — 그룹 프리셋. 1~3 green 후에만.

제약: §0 전 항목(특히 §0-2 직렬화·§0-3 패리티). 검증: 전체 게이트 + 골든 하네스(효과·곡선 픽스처 추가분
포함 green) + 기존 세션 픽스처 로드 회귀 + admin e2e(프리셋 CRUD).
```

### 프롬프트 EE — Stage E4 (에셋 라이브러리 UX)

```
[Stage E4 — 에셋 UX: 즐겨찾기·최근 사용 + 배경 태그 + 검색 개선 + 내 업로드 관리]

세션 시작 프로토콜대로 CLAUDE.local.md → EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§4 AD-E6·§5 Stage E4)
→ docs/EDITOR_UX_DESIGN_2026-07-07.md(DDL) → apps/editor/src/hooks/useLibraryPanel.ts ·
apps/api/src/library/ 를 먼저 파악하라. Stage E0 머지 선행(E1~E3 과 병렬 가능하나 AppText 패널은 E3 와
겹침 — E3 진행 중이면 텍스트 패널 접점 작업은 대기).

확인된 사실(정찰 ①): 라이브러리 5종+categories+큐레이션 완비 / 검색은 이름 LIKE만 / Background 만 tags
컬럼 없음 / 즐겨찾기·최근 사용 전무 / 내 업로드는 useImageStore 업로드·목록만.

작업 4건 (1↔2 병렬 가능, 3·4 후속):

1. 즐겨찾기+최근 사용 — AD-E6: 최근=localStorage(타입별 최대 30, LRU), 즐겨찾기=로그인 서버
   (user_asset_favorites: userId·assetType·assetId, additive 마이그레이션)+게스트 localStorage+로그인 병합.
   useLibraryPanel 확장으로 5개 패널 공통 적용(전체/즐겨찾기/최근 탭). 게스트(임베드) 회귀 금지.
2. backgrounds.tags — additive 컬럼+admin BackgroundList 태그 입력+패널 enableTags:true.
   기존 category 자유텍스트 경로 불변(하위호환).
3. 검색 개선 — 이름+태그 통합 검색을 라이브러리 공통 쿼리로(클립아트 별도 /search 라우트는 유지·문서화만),
   결과 0건 시 전역 폴백 안내(기존 큐레이션 폴백 패턴과 동일 UX 문구 체계).
4. 내 업로드 관리 — 삭제(스토리지 정리 포함 여부는 기존 retention 정책 확인 후 결정—파괴적이면 소프트 삭제),
   다중 선택, "사용 중" 배지(현재 세션 캔버스 참조 검사).

제약: §0. 라이브러리 기존 API 응답 shape 불변(파라미터·컬럼 추가만). 검증: 전체 게이트 + 게스트/로그인/
로그인 전환 3시나리오 e2e + admin 회귀 + fe-qa(패널 스크롤 성능 포함).
```

### 프롬프트 EF — Stage E5 (콘텐츠 볼륨 + 외부 소스)

```
[Stage E5 — 콘텐츠: 도형·사진틀 시드 + 프레임 스왑 연동 확인 (+오너 게이트: 콘텐츠 소싱·Google Photos)]

세션 시작 프로토콜대로 CLAUDE.local.md → EDITOR_UX_GAP_ROADMAP_2026-07-07.md(§5 Stage E5·§7)
→ E0 콘텐츠 볼륨 실측 결과를 먼저 읽어라. Stage E1(액션 바)·E4(패널) 머지 선행.
⚠️ 외부 콘텐츠 라이선스 구매·Google Cloud 앱 등록은 오너 결정(§7-3·§7-4) 전 착수 금지.

작업 3건:

1. 도형 기본 세트 — 자체 제작 SVG(사각/원/삼각/선/화살표/별/말풍선/프레임선 계열 30~50종) +
   시드 스크립트(멱등 — 재실행 시 중복 생성 0) + library_categories 구성. 스테이징 시드→검수→프로덕션은
   오너 승인 후 별도 운영 절차(External Ops 분리).
2. 사진틀 모양 세트 — 마스크 SVG(원/하트/폴리곤/라운드/필름 등 20~30종) 시드. FrameInteractionPlugin
   스왑·E1 액션 바 '사진교체'가 신규 모양 전 종에서 동작함을 매트릭스 테스트로 증명.
3. (오너 게이트 후) Google Photos 입력 — socialBook-demo 패턴 준용: 브라우저 OAuth(Picker)+백엔드 키 격리,
   자동편집 입력 소스에 추가(mergeAutofillPhotoInputs 확장). EXIF 파일명 폴백 규칙(KakaoTalk_/IMG_)도
   이 기회에 자동편집 입력에 반영.

제약: §0. 시드는 자체 제작분만(라이선스 불명 에셋 커밋 금지). 검증: 시드 멱등성 테스트 + 에디터 패널
노출 확인 + 프레임 스왑 매트릭스 + (3 진행 시) OAuth 플로우 e2e(테스트 계정).
```

---

## 7. 오너 결정 필요 사항

| # | 결정 | 관련 | 권고 |
|---|------|------|------|
| 1 | 벤치마크 실측 방법: Chrome 자동 실측 vs 오너 스크린샷 제공 | E0-3 | Chrome 실측(Claude in Chrome) — 계정 필요 시 오너 로그인 1회 |
| 2 | E1 기능 플래그 기본값: 신규 컨트롤(스마트 가이드 등) 전 사용자 즉시 on vs 점진 | E1 | **즉시 on 권고**(순수 additive UX·개별 off 가능) — 단 임베드 파트너 2곳 사전 공지 |
| 3 | 클립아트·배경 콘텐츠 소싱: 상용 라이선스 구매 / 자체 제작 / CC0 큐레이션 | E5-3 | 초기엔 자체 제작+CC0 큐레이션(비용 0·권리 명확), 상용은 수요 확인 후 |
| 4 | Google Photos 연동 여부(Google Cloud 앱 등록·심사·개인정보 고지) | E5-4(A10) | P2 — 포토북 자동편집 수요 실증 후 |
| 5 | 즐겨찾기 서버 저장의 계정 체계: 현행 사용자 모델로 충분한지(게스트 비중 확인) | E4-1 | AD-E6(로컬+로그인 병합)이면 현행으로 충분 |
| 6 | E3 곡선 텍스트 우선순위: 패리티 리스크 최고 — E0 분류 결과가 '골든필수' 이상이면 투자 지속 여부 | E3-3 | E0 분류 후 재판단(자동보장이면 GO, 불가면 철회) |

## 8. 기대효과 총괄

- **체감 격차 해소(E1·E2)**: "Canva에서 되던 게 안 된다"의 최빈 항목(정렬 가이드·치수 표시·모바일 조작)이 사라짐 — 임베드 파트너 최종고객의 편집 이탈 감소.
- **표현력(E3)**: 텍스트 1종 → 프리셋+효과+곡선. 포토북·굿즈 표지 품질의 지배 요인.
- **재방문 UX(E4)**: 에셋 재사용 동선 단축(즐겨찾기/최근) — 반복 주문 고객의 편집 시간 감소.
- **콘텐츠 볼륨(E5)**: 인프라는 완비 상태이므로 시드만으로 "빈 라이브러리" 인상 제거.
- **자산 재사용**: 전 Stage가 기존 플러그인 아키텍처·Library 패턴·골든 하네스 위에 additive — 신규 개념 도입 0.

## 9. 관련 산출물

- **오케스트레이션 마스터 프롬프트(Opus 4.8)**: `.cursor/plans/EDITOR_UX_ORCHESTRATION_MASTER_PROMPT_2026-07-07.md`
- **하네스 표준**: `/Users/yohan/Documents/Codex/2026-07-02/new-chat/outputs/SUBAGENT-HARNESS-STANDARD.md` v2.0(역할 11종·게이트 6종)
- **자매 트랙(API 플랫폼)**: `.cursor/plans/SWEETBOOK_GAP_ROADMAP_2026-07-07.md` v2.0 — 본 문서와 독립 병행
- **정찰 원본**: 세션 태스크 출력(에셋 ①/컨트롤 ②/socialBook-demo ③, 2026-07-07) — 본문 §2·§3에 반영 완료
- **socialBook-demo 로컬 사본**: 스크래치패드(세션 한정) — 필요 시 `git clone --depth 1 https://github.com/sweet-book/socialBook-demo`
