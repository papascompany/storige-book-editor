# Storige 캘린더 편집 모드 확장 설계안 (2026-10-16)

> **v2로 대체됨(같은 날)**: 범위가 "상품별 편집 모드 전체(캘린더·사진인화·벽걸이) + 외부 연동 + 운영자 워크스페이스"로 확대되어 [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md)가 정본이다. 이 문서는 참조 편집기 관찰 기록(§1)과 CalendarPlugin 세부(§3)로만 유효하다.
>
> 상태: **설계 제안 — 오너 승인 전, 코드 변경 없음**
> 근거: 점보포토 캘린더 상품(고도몰 `goodsNo=1000000225`, "벽걸이라지-커플")의 편집기를 내장 브라우저로 실행·관찰하고, 배포 번들을 REA로 정적 분석함. Storige 저장소는 읽기 전용으로 정찰함.

---

## 0. 결론 요약

1. 참조 편집기는 점보포토 자체 코드가 아니라 **ILARK `wpod-editor-3.0.0.62` (ASP 라이선스)** 다. 번들 헤더에 편집기 코드·DOM 구조·CSS의 복제·수정 금지가 명시돼 있다. 따라서 이 문서는 **기능·동작 수준의 요구사항만** 추출했고, 구현은 Storige 기존 구조 위에서 독자적으로 한다(클린룸). 번들 코드·마크업·스타일은 저장소에 옮기지 않는다.
2. Storige는 `TemplateSetType`으로 동작을 분기하지 않는다. 실제 분기는 `editorMode`(single/book), 템플릿 구조, `pdfOutputMode`, worker job `mode`다. 그래서 **enum 추가만으로는 캘린더가 되지 않는다.** 핵심은 세 가지다: ① 날짜 그리드 캔버스 객체, ② 월 단위 페이지 구성 규칙, ③ 날짜 데이터(공휴일·음력·절기·기념일).
3. 권장 경로는 **단계적 확장**이다. 1단계는 enum·DB·worker를 건드리지 않고 `single` 모드 위에 `CalendarPlugin`(canvas-core) + 캘린더 도구 메뉴 1개로 출시한다. enum(`CALENDAR`)·스프링 출력 규칙은 필요가 확인될 때 2·3단계로 붙인다.

---

## 1. 참조 편집기 기능 분석 (관찰 + REA)

### 1.1 분석 방법과 근거 등급

| 근거 | 내용 | 등급 |
|---|---|---|
| 런타임 관찰 | 상품 페이지 → "상품 만들기" → `pcms/storage/editor.php`(iframe, POST) → `pcms.jumbo.co.kr/.../app.js` 로드. 시작년월·기념일·날짜칸·배경 패널을 열어 확인(적용은 하지 않음) | observed |
| REA 정적 분석 | `analyze_javascript_application`: app.js 1개, 5,933,357 bytes, webpack 모듈 25개, 파싱 실패 0. 실행 없음. 모듈명이 난독화돼 그래프 수준 기능 식별은 제한적 (Evidence `ev_e9729ea1…a8afe`) | derived |
| UI 문자열 사전 | 번들의 한국어 리터럴 446개와 영문 데이터 키를 추출해 기능 목록 작성 | derived |
| 추론 | 내부 데이터 구조, 서버 API 형태 | inferred — 미확인 |

### 1.2 캘린더 고유 기능

| # | 기능 | 관찰 내용 | 근거 |
|---|---|---|---|
| C1 | **시작년월 설정** | 상단 "시작년월" → 연/월 선택 + 적용. 변경 시 "기념일을 제외한 편집 중인 모든 내용이 초기화" 경고. 허용 범위 밖 연월은 거부("년월이 허용범위를…") | observed + 문자열 |
| C2 | **날짜 표기 옵션** | 같은 대화상자에 토글 3개: 음력 / 절기 / 국경일·국가기념일(기본 ON) | observed |
| C3 | **월 그리드 자동 생성** | 큰 월 숫자 + 연도 + 영문 월명, 요일 헤더 SUN~SAT(일요일 시작), 일요일·공휴일 빨간색, 공휴일명 소형 표기(예: 1일 "신정"), 6주 행 지원(31일 단독 행), 우상단에 전월·익월 미니 달력 | observed |
| C4 | **그리드는 단일 객체** | 그리드를 클릭하면 전체가 하나의 객체로 선택됨. 개별 숫자는 직접 편집 불가 | observed |
| C5 | **날짜칸 클릭 → 기념일 편집** | 날짜칸 클릭 시 "기념일" 대화상자: 음력기념일 토글, 연/월/일 선택, 음력 환산값 표시(예: 2027-01-05 → 음력 2026.11.28), 글꼴·크기·색·굵게·기울임·정렬, 문구 입력 | observed |
| C6 | **기념일 관리 목록** | 상단 "기념일" → 날짜/내용 목록 + "추가하기". 같은 날짜 중복 등록 거부("이미 등록된 날짜") | observed + 문자열 |
| C7 | **월 단위 페이지 쌍** | 하단 페이지 목록: "커버" + "2027년 1월"(사진면 + 달력면 2장) + "2027년 2월"… 벽걸이 라지는 월마다 2면 | observed |
| C8 | **표지·연달력** | "표지/년달력 설정", "프롤로그/에필로그 연달력 연도 선택", "커버 연도 선택" | 문자열 |
| C9 | **페이지 수 규칙** | "최소 달 수설정", "고정날짜 달력", "달력 상품의 내지…" 검증 메시지 | 문자열 |
| C10 | **달력폼/디자인 일괄변경** | "달력폼이 적용되었습니다", "디자인일괄변경"(전체 초기화 경고), 내지 스킨셋 | 문자열 |
| C11 | **제작 가이드** | "금속링 뚫리는 영역", "잘리는 부분" 표기, 상단 스프링 링 이미지 오버레이 | observed + 문자열 |
| C12 | **절기·잡절 데이터** | 24절기 전체(입춘~대한)와 초복·말복이 리터럴로 내장 | 문자열 |

### 1.3 공통 편집 기능 (Storige 대비 참고)

좌측 패널: 사진 / 디자인 / 사진틀 / 배경 / 글쓰기 / 아이콘. 그 외 사진 자동넣기(전체·현재 페이지·현재 페이지부터), 사진 자동보정, 해상도 저하 경고, 페이지 스택 미리보기(출력 순서 3D 보기), 칼선 추출, 화이트잉크, 바코드, 텍스트 패스. 이 중 상당수는 Storige에 이미 있으므로(`photoAutofill`, 모양컷, 바코드/QR 등) 이번 범위에서는 **캘린더 고유 기능(C1~C12)만** 다룬다.

---

## 2. Storige 현재 구조 (확장 지점)

| 영역 | 현재 상태 | 근거 |
|---|---|---|
| 상품 유형 | `TemplateSetType = book \| leaflet \| photobook`. DB 컬럼은 `varchar(20)` → 값 추가에 마이그레이션 불필요 | `packages/types/src/index.ts:99`, `apps/api/src/templates/entities/template-set.entity.ts:81` |
| 편집 모드 | `EditorMode = single \| book`. 다수 코드가 `=== 'book'` 이진 분기 | `index.ts:1854`, `useEditorContents.ts:1099-1123` |
| 제본 | `BindingType.SPIRAL`, `BINDING_MARGIN.SPIRAL=3.0mm` 존재. worker 합성의 `bindingType`에는 spiral 없음 | `index.ts:1487-1500`, `apps/worker/src/processors/synthesis.processor.ts:69` |
| 도구 메뉴 | `EditorMenuKey` + `EDITOR_MENU_DEFS`에 등록하면 admin 토글·editor 툴바가 자동 인지 | `index.ts:1865-1906` |
| 캔버스 객체 | fabric 5. 커스텀 서브클래스 없이 `extensionType` + `extension`/`meta` 속성으로 확장. `extension`·`meta`는 직렬화 목록(`extendFabricOption`)에 등재됨 | `packages/canvas-core/src/utils/canvas.ts:94-175` |
| 생성형 객체 선례 | `SmartCodePlugin`: 옵션(`extension`)으로 바코드/QR 이미지를 생성 | `plugins/SmartCodePlugin.ts:45-98` |
| 플러그인 lifecycle | `beforeLoad / afterLoad / beforeSave / afterSave` (AsyncSeriesHook). SmartCode의 `hookTransform`은 lifecycle에 없어 호출되지 않음 | `packages/canvas-core/src/Editor.ts:140-145, 294-310, 426-501` |
| 날짜 인프라 | 날짜 라이브러리·공휴일·음력 데이터 없음. `{{var}}` 템플릿 바인딩 없음 | 저장소 검색 0건 |
| 오너 원칙 | "TemplateSetType 게이팅 금지" — 기능 노출은 런타임 판정 | `apps/editor/src/tools/AppImage.tsx:135-136` |

### 2.1 확인된 위험

- **저장 경로별 직렬화 속성 불일치**: `useWorkSave.ts:172`는 `['id','extensionType','selectable','evented']`만 넘기고, `useTemplateSave.ts:111`은 `meta`를 포함, `embed.tsx`·`useEmbedAutoSave.ts`는 `extendFabricOption` 전체를 쓴다. 캘린더 설정을 `extension`에만 두면 `useWorkSave` 경로에서 유실될 수 있다 → 1단계에서 이 경로의 속성 목록 정합을 함께 고쳐야 한다(기존 바코드/QR도 같은 위험에 노출돼 있을 가능성 — 별도 확인 필요).
- **공유 계층 회귀**: `useEditorContents`·`useAppStore`·`embed` PDF 경로는 모든 상품이 공유한다. 1단계는 이 계층의 분기를 늘리지 않는 것을 원칙으로 한다.
- **`editorMode` 3번째 값 추가 금지(1단계)**: `=== 'book'` 이진 분기들이 새 값을 조용히 single로 처리한다.
- **파트너 동결 계약**: `contract-freeze.spec.ts` 표면은 변경하지 않는다.

---

## 3. 설계안

### 3.1 핵심 개념: "캘린더 컨텍스트"와 "날짜 그리드 객체"

```
CalendarContext (작업 단위 1개, 작업 JSON 루트 메타에 저장)
  startYear, startMonth          // C1
  monthCount                     // 12 기본, 템플릿셋 설정으로 고정 (C9)
  weekStart: 0 | 1               // 일/월 시작
  show: { holidays, lunar, solarTerms }   // C2
  anniversaries: [{ date:'YYYY-MM-DD', lunar:boolean, text, style }]  // C5·C6
  allowedRange: { from:'YYYY-MM', to:'YYYY-MM' }   // 템플릿셋 설정 (C1 허용범위)

CalendarGrid (canvas 객체, extensionType:'calendar-grid')
  extension: {
    monthOffset: 0..monthCount-1  // 컨텍스트 시작월 기준 상대 월 → 시작년월 변경 시 자동 재계산
    variant: 'month' | 'mini' | 'year'      // C3 본 그리드 / 미니 달력 / 연달력(C8)
    style: { font, size, colors{weekday,sunday,saturday,holiday}, cell{w,h,padding}, headerLang:'en'|'ko' }
  }
```

- 그리드는 **fabric.Group 하나**로 생성한다(C4와 같은 UX). 숫자·요일·공휴일명·기념일 문구는 그룹 내부 텍스트이며 사용자가 개별 편집하지 않는다.
- 월 정보는 절대 연월이 아니라 **`monthOffset`(상대 월)** 로 저장한다. 시작년월을 바꾸면 모든 그리드가 같은 컨텍스트로 다시 그려지므로 "편집 내용 전체 초기화"(참조 편집기의 C1 동작)를 피할 수 있다. 이것이 참조 편집기보다 나은 지점이다.
- 템플릿 디자이너는 admin 템플릿 편집에서 그리드 객체를 배치·스타일링만 한다. 사용자는 위치·스타일을 템플릿의 잠금 설정(`lockInfo`) 범위 안에서만 바꾼다.

### 3.2 구성 요소

| 구성 요소 | 위치 | 역할 |
|---|---|---|
| `calendar-core` (순수 함수) | `packages/canvas-core/src/calendar/` | 월 셀 행렬 계산(6×7), 요일/주 시작, 공휴일·대체공휴일·음력·절기 조회. DOM·fabric 의존 없음 → 단위 테스트 용이 |
| 날짜 데이터 | `packages/canvas-core/src/calendar/data/` | 한국 공휴일(대체공휴일 포함)·24절기·음력 변환 테이블을 **연도 범위 고정 정적 JSON**으로 내장(예: 2025~2035). 외부 API 호출 없음. 데이터 출처·갱신 절차를 파일 헤더에 명시 |
| `CalendarPlugin` | `packages/canvas-core/src/plugins/CalendarPlugin.ts` | 그리드 생성/재생성, `afterLoad`에서 컨텍스트 기준 재렌더, 날짜칸 클릭 → 해당 날짜 반환(기념일 UI 연결), `beforeSave`에서 컨텍스트 직렬화 확인 |
| 캘린더 도구 메뉴 | `EditorMenuKey: 'CALENDAR'` + `EDITOR_MENU_DEFS` | admin에서 템플릿셋별 노출 토글. 기본값 `defaultEnabled:false` (기존 상품에 영향 없음) |
| editor UI | `apps/editor/src/components/calendar/` | 시작년월·표기 옵션 패널(C1·C2), 기념일 목록/편집(C5·C6), 페이지 라벨 "YYYY년 M월"(C7) |
| admin 설정 | 템플릿셋 폼 | `calendarConfig`: monthCount, allowedRange, weekStart, 기본 표기 옵션. 1단계는 기존 JSON 설정 필드에 저장(신규 컬럼 회피 가능 여부는 구현 전 확인) |

### 3.3 노출 판정 (오너 원칙 준수)

캘린더 UI는 `TemplateSetType`이 아니라 **런타임 판정**으로 켠다: 로드된 캔버스에 `extensionType==='calendar-grid'` 객체가 있거나, 템플릿셋 `enabledMenus`에 `CALENDAR`가 있을 때.

### 3.4 출력(PDF)

- 1단계: 기존 `single` 경로 그대로. 그리드는 일반 벡터 텍스트/도형이므로 editor의 PDF 생성에서 별도 처리 없이 출력된다. 폰트는 기존 글리프 검증(`ServicePlugin.collectGlyphValidationTargets`)을 통과해야 하므로 그리드 내부 텍스트도 검증 대상에 포함되는지 확인한다.
- 스프링 링·타공 영역 가이드(C11)는 `printExclude:true` 오버레이로 표시만 하고 출력에서 제외한다.
- 탁상 삼각대·타공 위치 표기처럼 **PDF 결과 자체가 달라지는 규칙**이 인쇄팀에서 요구될 때만 3단계로 worker `bindingType:'spiral'`/새 `mode`를 추가한다.

---

## 4. 단계별 범위

| 단계 | 범위 | 건드리지 않는 것 | 완료 기준 |
|---|---|---|---|
| **1. MVP** | `calendar-core` + 데이터, `CalendarPlugin`, `CALENDAR` 메뉴 키, 시작년월·표기 옵션·기념일 UI, 월 페이지 라벨, `useWorkSave` 직렬화 속성 정합, admin 템플릿 편집에서 그리드 배치 | `TemplateSetType`, `EditorMode`, DB 스키마, worker, 파트너 계약 | ① `LEAFLET+single` 13장 캘린더 템플릿셋으로 생성→저장→재오픈 시 그리드·기념일 유지 ② 시작년월 변경 시 사진·텍스트 보존 ③ 기존 book/leaflet/photobook embed 테스트 무회귀 ④ calendar-core 단위 테스트(윤년, 6주 월, 대체공휴일, 음력 기념일) |
| **2. 상품 분류** | `TemplateSetType.CALENDAR` 추가(types·API entity·admin 3곳), 목록 라벨/필터, 월 단위 페이지 쌍 그룹 표시(C7), 표지·연달력(C8) | worker, editorMode | admin에서 캘린더 상품 등록·필터 가능, Bookmoa 상품 매핑 영향 없음 확인 |
| **3. 출력 규칙** | worker `bindingType:'spiral'`, 필요 시 탁상/벽걸이 전용 합성 규칙 | 기존 mode 동작 | 인쇄팀 요구 사양 확정 후 정의 |

---

## 5. 결정이 필요한 항목

1. **라이선스 경계 확인**: 참조 편집기는 ILARK ASP 계약 하의 제품이다. 기능 수준 참조(이 문서)는 문제없다고 판단하지만, 점보포토·ILARK 계약에 경쟁 제품 참조 제한 조항이 있는지 오너 확인이 필요하다.
2. **날짜 데이터 방식**: 정적 JSON 내장(권장, 의존성 0, 연 1회 갱신) vs 음력 변환 라이브러리 의존성 추가.
3. **1단계 대상 상품**: 벽걸이(월 2면) / 탁상(월 1면) 중 먼저 출시할 형태와 판형.
4. **시작년월 변경 정책**: 상대 월 재계산(권장, 편집 내용 보존) vs 참조 편집기처럼 초기화.

---

## 6. 미확인·한계

- 참조 편집기의 서버 API·저장 포맷·연달력/고정날짜 달력의 실제 화면은 관찰하지 않았다(문자열 근거만 있음).
- REA 그래프는 모듈명이 난독화돼 기능↔모듈 대응을 확정하지 못했다. 기능 목록은 런타임 관찰과 UI 문자열에 근거한다.
- Storige 단일 모드에서 페이지 수 고정(13장 잠금) 설정 존재 여부, `buildPageMeta` 라벨 규칙 상세, Bookmoa 상품 매핑의 `type` 의존 여부는 구현 착수 전 확인 대상이다.
