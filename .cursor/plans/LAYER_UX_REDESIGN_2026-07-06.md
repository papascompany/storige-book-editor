# 레이어 관리 UX 재설계 제안 (CTO 정본 — 2026-07-06)

> 요청: 디자이너(템플릿 제작)와 고객(실편집), 두 관점의 레이어 UI/UX를 외부 POD 편집기(Canva·미리캔버스·Blurb 등) 조사 기반으로 혼동 없이 직관적으로 재설계.
> 방법: 5에이전트 오케스트레이션 — 외부 4종(Canva/미리캔버스/포토북 3사/web-to-print 4사) 웹조사 + 내부 감사(file:line 전수). 근거 원문은 세션 산출물 참조.

## 0. 업계 수렴 패턴 (4갈래 조사가 전부 같은 곳을 가리킴)

| # | 패턴 | 근거 |
|---|---|---|
| 1 | **고객에게 레이어 패널은 기본 숨김이 표준** | Canva: 10년간 부재→'선택 시 Position 버튼→하위 탭'으로 격리. 미리캔버스: 전체메뉴 토글 옵트인(기본 OFF). 포토북 3사(Blurb/Mixbook/Shutterfly): 패널 개념 자체 제거, '앞으로/뒤로' 상대 이동만. Vistaprint: Arrange 메뉴만 |
| 2 | **잠금은 2계층 분리** — '내 잠금'(가역) vs '디자이너 보호'(고객 해제 불가) | Canva Brand Template locks(관리자만 해제), Customer's Canvas `<LC>`(고객 목록에서 행 은폐), Polotno role 게이팅(user 롤 display:none), Shutterfly Advanced Editing 전역 토글(기본=템플릿 요소 고정) |
| 3 | **부분 잠금은 '감산형' 표시** — 금지된 액션의 핸들·버튼만 조용히 제거(회색 아님) | CC `<MRC>` 코너그립 제거·`<MAD_f>` Delete 명령 제거, Zakeke 제한 액션 컨트롤 미노출 |
| 4 | **용어: 객체='요소', '레이어'는 패널 라벨만** + 행 이름=타입 한국어명/텍스트 내용 미리보기 | Canva elements/Layers 이중 용어, 미리캔버스 '요소'+'레이어 (N페이지)'+타입명 자동 부여('도형','일러스트') |
| 5 | **모바일=바텀시트+롱프레스/드래그핸들** (hover·사이드패널 이식 금지) | Canva 모바일 '페이지 탭→Layers 시트', 미리캔버스 바텀시트+long-press, Polotno isMobile 드래그핸들 분기 |

보너스 발견: '스타일 잠금=위치 고정+내용 교체 허용'(미리캔버스 자물쇠 2클릭, Canva 'Lock position and appearance')이 **업계 공통의 템플릿 플레이스홀더 잠금 등급** — 우리 B1 movable=false+contentEditable=true 조합과 정확히 대응. Canva 'Overlapping(겹침만 보기)' 필터는 포토북 펼침면에 특히 유효한 킬러 기능.

## 1. 내부 진단 (감사 적발 — 심각도순)

### 🔴 P0 — 실버그/도달불가 (즉시 수정)
1. **위치고정 모순(실버그)**: `movable=false` → applyObjectPermissions 가 `lockMovementX=true` 세팅 → **LockPlugin legacy 렌즈**(LockPlugin.ts:245-251, lockMovement 하나라도 true→isLocked 판정) → handleSelection 이 고객 선택을 **즉시 해제** → "위치만 고정, 내용 편집 유지"(objectPermissions.ts:12 설계 의도·B1 계약)가 실동작에서 무력. 고객은 위치고정된 텍스트를 클릭조차 못 함.
2. **고객 embed 레이어 패널 진입 버튼 0**: SidePanel 은 embed.tsx:1663 에 마운트돼 있으나 여는 버튼이 없음(EditorHeader Layers 버튼 cefe2d4 에서 제거, onToggleSidePanel prop 미사용). B0-②·A1(고객용 삭제 disabled·모바일 ↑↓·다중선택 가드)이 **고객이 도달할 수 없는 UI**.
3. **잠금 트랩**: 고객이 ControlBar 자물쇠로 단순잠금 → selectable=false + legacy 렌즈로 캔버스 재선택 불가 → 스스로 해제할 경로가 사실상 없음.
4. **보호 비대칭**: admin 보호 객체도 고객이 **숨김(Eye)**·복제·이름변경 가능 — 숨김은 visible=false 로 저장·영속되어 **필수 로고 미인쇄 사고** 벡터(SidePanel.tsx:122-146 무가드).

### 🟡 혼동 (조사 패턴 위반 지점)
- **자물쇠 1아이콘 3의미**: SidePanel hover 자물쇠·ControlBar 자물쇠·⌘L 전부 '고객이 풀 수 있는' 잠금인데, 디자이너가 템플릿 보호 수단으로 오용할 표면(ControlBar.tsx:273 주석 자인). 진짜 보호(잠금레벨 Select)와 시각 구분 없음.
- **ShieldX 의미 역전**: SidePanel 배지 ShieldX='삭제 잠김', ControlBar ShieldX='잠금 안 됨(클릭=잠금)' — 같은 화면에서 정반대.
- **locked 단일 렌즈**: locked=!hasControls(useAppStore.ts:1002)라 잠금 3계층이 전부 같은 '잠김'으로 뭉개지고, contentEditable=false 는 locked=false(자물쇠 열림)라 "안 잠겼는데 왜 편집이 안 되지".
- 배지에 **영문 내부용어 노출**('designer','admin'), 용어 4종 혼재(객체/레이어/요소/아이템), hover 4버튼이 배지를 가림(자기모순), 터치에서 hover 액션 4종 불능, EditorView(templateSet 편집)에 패널 미마운트(진입 경로별 도구 불일치), 실패 전부 silent(console만).
- **디자이너가 고객 체감을 미리 볼 수 없음**: editMode 면제 때문에 자신이 건 잠금의 실제 작동(선택 해제·컨트롤 미표시)을 확인할 방법 부재.

## 2. 재설계 원칙

1. **페르소나 이원화**: 디자이너 = 전체 노출(전문 도구), 고객 = 감산·은폐(업계 패턴 1·3). 분기 기준은 **editMode 만**(TemplateSetType 게이팅 0건 원칙 유지).
2. **잠금 어휘를 2개로 재편**: 사용자에게 보이는 개념은 딱 둘 — **"내 잠금"**(고객·디자이너 본인이 걸고 즉시 푸는 것, 파란 자물쇠) vs **"템플릿 보호"**(디자이너가 걸고 고객은 못 푸는 것, 회색 자물쇠+방패). 내부 3계층(단순잠금/movable·deleteable·contentEditable·lockLayerOrder/lockInfo 레벨)은 이 두 개념 밑으로 **표시 계층에서 통합**.
3. **감산형 UI**: 고객 화면에서 금지된 액션은 버튼 자체를 제거(disabled 회색보다 우선). 단 "왜 안 되는지"는 보호 배지+1회성 토스트로 설명.
4. **용어 통일**: 객체→**'요소'**, 패널 라벨만 **'레이어'**. 행 이름 = 텍스트는 내용 미리보기, 나머지는 타입 한국어명(사진/도형/사진틀/QR…).

## 3. 수정안 A — 고객 화면 (embed)

| # | 항목 | 내용 |
|---|---|---|
| A-1 | **진입 복원(이중)** | ① 주 경로(Canva 패턴): 객체 선택 시 ControlBar 순서(z-order) 클러스터 옆 '레이어' 버튼 ② 보조: 헤더 Stack 아이콘 복원. 패널 기본 닫힘(옵트인) |
| A-2 | **행 감산** | 고객 행 = 타입아이콘+이름+상태 1개(보호 or 내 잠금)+액션(복제·삭제·숨김 — 보호 객체는 셋 다 제거). 배지 6종·영문 레벨 노출 제거 |
| A-3 | **보호 표시** | 템플릿 보호 요소 = 회색 자물쇠 배지, 행 클릭(선택)은 허용하되 조작 버튼 감산. 클릭 시 1회성 토스트 "템플릿 보호 요소입니다 — 내용만 변경할 수 있어요"(contentEditable=true 시) / "…변경할 수 없어요"(false 시) |
| A-4 | **대칭 가드(P0-4)** | 보호 객체의 숨김·복제·이름변경 차단(숨김이 최우선 — 인쇄사고 벡터) |
| A-5 | **내 잠금 UX(P0-3)** | 고객 단순잠금 = 파란 자물쇠, 행에서 항상 해제 가능. 캔버스 재선택 불가 문제는 잠금 시 selectable 유지(이동만 잠금)로 완화 or 행 해제 경로 보장 |
| A-6 | **피드백** | silent 실패 3종(권한 없는 해제/보호 삭제/순서 고정 DnD)에 토스트 |
| A-7 | 순서 조작 기본 경로 | 패널 없이도 되는 '앞으로/뒤로'(동사 라벨, 포토북 3사 패턴)는 ControlBar 에 이미 존재 — 유지, 겹침 없을 때 비활성 검토 |

## 4. 수정안 B — 디자이너 화면 (/template·templateSet 편집)

| # | 항목 | 내용 |
|---|---|---|
| B-1 | **EditorView 마운트 갭 해소** | adminEdit=templateSet(EditorView)에 SidePanel 렌더+Stack 버튼 — state·toggle 기존재, 마운트만 부재 |
| B-2 | **'보호' 통합 드롭다운** | ControlBar 의 보호 수단 7종을 방패 아이콘 드롭다운 하나로: ☐위치 ☐삭제 ☐내용 ☐순서 체크 + 보호 레벨(기본 '디자이너'). '내 잠금'(자물쇠)과 시각·개념 분리 |
| B-3 | **고객 시점 미리보기 토글** | editMode 헤더에 '고객 화면으로 보기' 스위치 — applyObjectPermissions+LockPlugin 를 일시 고객 모드로 적용(저장 없음). 상태 가시성 갭 해소, Shutterfly Advanced 토글의 역방향 |
| B-4 | **배지 정리** | 한국어화('디자이너 보호'·'위치 고정'·'내용 잠금'…), hover 버튼과 배지 좌우 분리(가림 해소), 자물쇠/눈 툴팁 추가, ShieldX 의미 통일(잠김 상태=ShieldCheck 로 단일화) |
| B-5 | **template-element 표시** | editMode 에선 prevented 에서 제외해 목록 표시(디자이너는 제어 필요). 고객은 현행 은폐 유지(CC `<LC>` 패턴과 정합) |

## 5. 공통·2차

- 용어 일괄 치환: 섹션 헤더 '요소', 버튼/툴팁 '레이어'. ControlBar getObjectName 과 행 이름 규약 동기화(타입 한국어명).
- locked 렌즈 교체: `!hasControls` 단일 판정 → {none | mine | protected(+무엇이 잠겼는지 set)} 3상태 도출 함수 신설(SidePanel·ControlBar 공용).
- **2차(후순위)**: Canva 'Overlapping' 필터(포토북 펼침면 킬러), 모바일 바텀시트 전환+롱프레스 DnD(현행 ↑↓ 유지 후), 행 썸네일 미리보기, '인쇄 제외' 레이어의 고객 표시 정책(B1 잔여와 병합), Zakeke식 '필수 편집 요소'(고객이 문구 안 바꾸고 주문하는 사고 방지).

## 6. 로드맵 (PR 단위, 총 ~6-7일)

| PR | 범위 | 공수 | 비고 |
|---|---|---|---|
| **L1 (P0)** | ①위치고정 legacy 렌즈 버그(§1-1: LockPlugin legacy 판정에서 movable 경로 제외 — B1 계약 복원) ②embed 진입 버튼 복원 ③잠금 트랩 ④대칭 가드(숨김 우선) ⑤EditorView 마운트(B-1) | ~2일 | 기능 추가 아닌 **기존 계약 복원**. 회귀 스펙 필수(위치고정 텍스트: 선택 가능·이동 불가·내용 편집 가능) |
| **L2** | 고객 행 감산+보호 표시+토스트(A-2·3·6), 배지 한국어화·아이콘 통일·툴팁(B-4), 용어 통일 | ~2일 | 시각 변경 — 스크린샷 비교 리뷰 |
| **L3** | 보호 통합 드롭다운(B-2), 고객 시점 미리보기(B-3), template-element 표시(B-5), locked 3상태 렌즈 | ~2-3일 | B-3 은 별도 QA(임시 모드가 저장에 안 새는지) |

## 7. 오너 결정 대기 2건

1. **보호 요소의 고객 노출 방식**: (a) 자물쇠 표시+토스트(제안 기본 — CS 설명 용이) vs (b) 목록 은폐(CC·Polotno 다수 패턴 — 화면 단순, "캔버스엔 보이는데 목록엔 없음" 혼동 재생산 위험). 제안: **표시형(a)**, 단 완전잠금(내용도 불가)+장식 요소는 은폐 옵션 추후.
2. **고객 레이어 패널 노출 수위**: (a) 전 상품 옵트인 버튼(제안 — 상품 비종속 원칙) vs (b) 포토북류만 노출(업계 프로슈머 관행이나 TemplateSetType 게이팅 위반 — 굳이 하려면 templateSet 별 enabledMenus 식 데이터 속성으로).

## 8. 불변 준수
TemplateSetType 게이팅 0건(분기는 editMode·데이터 속성만) · default-permissive(PERM-1) 유지 · extendFabricOption 신규 등재 없음(L1-L3 는 표시/가드 계층만) · canvas-core 공개 API 불변(LockPlugin legacy 렌즈 수정은 내부 판정 — 단 회귀 스펙 동반) · Track A dynamic import 규약.
