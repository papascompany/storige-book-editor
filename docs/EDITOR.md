# Storige 에디터 기획서

> **Shopify 추가 개발 (2026-10-15, 계획)**: [Editor·PDF Worker × Shopify 개발 정본](./SHOPIFY_ORCHESTRATION_DEVELOPMENT_GUIDE_2026-10-15.md)의 전용 launch/runtime/strict commit을 사용합니다. 기존 `editor.complete` 이벤트와 저장·재오픈 계약은 유지하며, Shopify 상품 주문용 확정은 별도 서버 artifact gate에서 판정합니다. 아직 Shopify 앱 구현·출시가 완료된 상태는 아닙니다.

> **갱신**: 2026-05-10 — §7~§11 (편집기 UX 사이클) 추가 · 2026-10-05 §4 책등 편집 기능에 현재 산식·템플릿 작성 규약 포인터 · **2026-10-19 — §21 상품 프로파일 모드·캘린더 P1(운영 반영 2026-10-18)·런처 진입 P2-b·시트 맵 P2-c(브랜치만) 추가, §2·§7·§14.1 포인터** · **2026-10-20 — §21.8 사진인화 P2-d(브랜치 작업 트리, 미커밋) 추가, §7 `PHOTO_PRINT`**
>
> §1~§6 은 데이터 모델·비즈니스 룰 · 권한 명세 (변경 없음)
> **§7 부터** 가 2026-05-09 ~ 05-10 사이 도입된 신기능. 운영 화면 검증 시 우선 참조.

---

## 1. 용어 정의

| 용어 | 정의 |
|------|------|
| **상품 (Product)** | 인쇄 상품. 하나 이상의 템플릿셋을 가짐 |
| **템플릿셋 (TemplateSet)** | 템플릿들의 조합. 상품에 연결되어 에디터의 기본 구성을 정의 |
| **템플릿 (Template)** | 단면 1페이지에 해당하는 디자인 틀 |
| **내지 수량** | 템플릿 타입이 "page"인 페이지의 개수 (표지, 날개 등 제외) |
| **판형** | width x height (가로x세로, mm 단위) |

### 템플릿 타입

| 타입 | 설명 | 판형 체크 |
|------|------|----------|
| `wing` | 날개 - 표지를 접었을 때 안쪽으로 접히는 부분 | 제외 |
| `cover` | 표지 - 앞/뒤 표지 (위치로 구분) | 대상 |
| `spine` | 책등 - 책의 등 부분 | 제외 |
| `page` | 내지 - 본문 페이지 | 대상 |

### 템플릿셋 타입별 기본 구성

| 타입 | 구성 |
|------|------|
| **책자 (book)** | 날개(옵션) + 앞표지 + 책등 + 내지 N장 + 뒤표지 + 날개(옵션) |
| **리플렛 (leaflet)** | 앞표지(옵션) + 내지 N장 + 뒤표지(옵션) |

---

## 2. 데이터 구조

### 상품 (Product)

```typescript
interface Product {
  id: string
  name: string
  templateSetIds: string[]  // 1:N 관계
  // ...기타 상품 속성
}
```

### 템플릿셋 (TemplateSet)

```typescript
interface TemplateSet {
  id: string
  name: string
  thumbnail: string
  type: 'book' | 'leaflet'  // 확장 가능
  width: number             // 판형 (mm)
  height: number            // 판형 (mm)
  canAddPage: boolean       // 내지 추가 가능 여부
  pageCountRange: number[]  // 내지 수량 범위 (예: [10, 20, 30, 40])
  templates: TemplateRef[]  // 순서 포함, N:N 관계
  isDeleted: boolean        // 소프트 삭제
}

interface TemplateRef {
  templateId: string
  required: boolean         // 필수 페이지 여부
}
```

> **additive (2026-10-17, P1 캘린더 — 운영 반영 2026-10-18)**: 템플릿셋 응답에 `productProfile: ProductProfile | null`(`packages/types/src/product-profile.ts`, 컬럼 `template_sets.product_profile` JSON, NULL 기본)이 추가됐다. 값이 있으면 편집 모드(고정 캔버스 수·페이지 라벨·달력 메뉴·완료 PDF 판형/옵션)를 이 프로파일이 정한다 — §21.1. 기존 세트 전부 NULL = 이 절의 동작 그대로(CONTRACT_FREEZE v1.22).

### 템플릿 (Template)

```typescript
interface Template {
  id: string
  name: string
  thumbnail: string
  type: 'wing' | 'cover' | 'spine' | 'page'
  width: number             // 판형 (mm)
  height: number            // 판형 (mm)
  editable: boolean         // 편집 가능 여부
  deleteable: boolean       // 삭제 가능 여부
  data: object              // Fabric.js JSON
  isDeleted: boolean        // 소프트 삭제
}
```

### 관계도

```
상품 (1) ──── (N) 템플릿셋 (N) ──── (N) 템플릿
                  └─ templates 배열로 순서 관리
```

### 삭제 정책

- **소프트 삭제**: `isDeleted` 필드 사용
- **템플릿 삭제 시**: 해당 템플릿을 사용 중인 템플릿셋 확인 → 처리 여부 결정
- **템플릿셋 삭제 시**: 해당 템플릿셋을 사용 중인 상품 확인 → 처리 여부 결정

---

## 3. 비즈니스 룰

### 템플릿셋 선택

- **기본**: 쇼핑몰에서 상품 옵션 선택 시 (에디터 진입 전)
- **추가**: 에디터 내 템플릿 패널에서 다른 템플릿셋으로 교체 가능

### 내지(page) 관리

| 항목 | 정책 |
|------|------|
| 추가 시 템플릿 | 마지막 내지 템플릿 복제 |
| 추가 위치 | 마지막 내지 뒤 (뒤표지 앞) |
| 삭제 대상 | 현재 선택된 내지 페이지 |
| 삭제 불가 페이지 | UI 비활성화 + 에러 처리 (이중 방어) |
| 수량 범위 초과/미만 | UI 비활성화 + 에러 처리 (이중 방어) |

### 템플릿 교체

| 항목 | 정책 |
|------|------|
| 전체 교체 (템플릿셋) | 경고 다이얼로그 → 사용자 추가 요소 보존 |
| 낱장 교체 (템플릿) | 경고 다이얼로그 → 사용자 추가 요소 보존 |
| **보존 대상** | 사용자가 추가한 텍스트, 이미지, 도형 |
| **교체되는 요소** | 템플릿에 원래 있던 요소 |

### 저장 검증

- 내지 수량이 `pageCountRange` 범위 내인지 확인
- 필수 페이지(`required: true`)가 모두 존재하는지 확인

---

## 4. 에디터 기능

### 페이지 관리

| 항목 | 정책 |
|------|------|
| 페이지 네비게이션 | 썸네일 클릭 + 이전/다음 버튼 |
| 페이지 순서 변경 | 내지(page)만 드래그 앤 드롭 가능 (날개, 표지, 책등은 고정) |
| 페이지 추가/삭제 UI | SidePanel + 상단 툴바 |

### 히스토리 & 저장

| 항목 | 정책 |
|------|------|
| Undo/Redo 범위 | 전체 작업 (모든 페이지 포함) |
| 자동저장 | 일정 시간마다 + 특정 액션 후 (페이지 이동 등) |

### 템플릿 패널

- **템플릿셋 목록**: 전체 교체용 (같은 타입/판형 필터)
- **개별 템플릿 목록**: 낱장 교체용 (같은 타입/판형 필터)
- **낱장 교체 필터**: 선택된 페이지의 템플릿 타입과 동일한 타입만 표시

### 책등 편집 기능

> **현재 기준 포인터(2026-10-05)**: 아래 공식·여유분 표는 초기 기획(v1 선형식)입니다. 현재 책등 산식(무선·양장 v2)과 표지 PDF 검증 크기(양장 = 싸바리 전개 `(W+8)×2 + 책등 + 40` × `(H+8) + 40`)는 [`PDF_VALIDATION_GUIDE.md`](./PDF_VALIDATION_GUIDE.md) §표지 책등·전개 크기 검증, 템플릿 작성 규약(표지 책등 방식은 호스트 상품 정의대로·양장 표지 크기 = 업로드 검증 규격·쪽 추가 단위 `pageStep` 은 호스트 상품등록 값과 일치)은 [`PLATFORM_INTEGRATION_GUIDE.md`](./PLATFORM_INTEGRATION_GUIDE.md) 3.1, 제작 절차는 [`TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html`](./TEMPLATE_AUTHORING_GUIDE_COVER_INNER.html) 이 정본입니다.

**활성화 조건**: 템플릿셋에 `spine` 타입 템플릿이 포함된 경우

**책등 폭 계산 공식**:
```
책등 폭 = (페이지 수 ÷ 2) × 종이 두께 + 제본 여유분
```

**지원 옵션**:

| 종이 타입 | 용도 |
|----------|------|
| 모조지 70g/80g | 본문용 |
| 서적지 70g | 본문용 |
| 신문지 45g | 본문용 |
| 아트지 200g | 표지용 |
| 매트지 200g | 표지용 |
| 카드지 300g | 표지용 |
| 크라프트지 120g | 표지용 |

| 제본 방식 | 여유분 | 조건 |
|----------|--------|------|
| 무선제본 (Perfect) | +0.5mm | 32p 이상 |
| 중철제본 (Saddle) | +0.2~0.4mm | 64p 이하, 4의 배수 |
| 스프링제본 (Spiral) | +3.0mm | - |
| 양장제본 (Hardcover) | +2.0mm | - |

**시각화 요소**:
- 실시간 미리보기 (앞표지, 책등, 뒤표지)
- 🔴 블리드(Bleed): 인쇄 시 잘려나갈 외곽 영역
- 🟠 안전 영역(Safe Area): 텍스트 보호 영역 (15mm 안쪽)
- 🟢 책등 중심선
- 경고: 책등 5mm 미만 시 텍스트 배치 주의

---

## 5. 에러 처리

| 상황 | 처리 방법 |
|------|----------|
| **저장 실패** | 자동 재시도 → 로컬 임시 저장 → 네트워크 복구 시 자동 동기화 |
| **템플릿 로드 실패** | 에러 메시지 표시 후 에디터 진입 차단 |
| **이미지 업로드 실패** | 자동 재시도 후 실패 시 에러 메시지 |
| **페이지 이탈** | 자동저장 실패 상태일 때만 경고 표시 |

---

## 6. 권한 관리

### 사용자 유형

| 유형 | 권한 |
|------|------|
| **고객** | 기본 편집, 페이지 추가/삭제(범위 내), 템플릿 교체, 잠금 요소 편집 불가 |
| **관리자** | 고객 기능 + 모든 잠금 요소 설정/해제 |
| **디자이너** | 관리자와 동일 (템플릿 제작 시 잠금 영역 설정) |

### 편집 상태

| 상태 | 편집 권한 | 설명 |
|------|----------|------|
| **편집 중 (draft)** | 고객 | 고객이 작업 중 |
| **검토 중 (review)** | 관리자 | 관리자 검토 단계 |
| **완료 (submitted)** | 관리자 (기록 남김) | 최종 완료, 수정 시 기록 |

### 편집 기록

- 모든 편집마다 **수정자(userId)** + **수정일자(modifiedAt)** 기록

### 동시 편집

- **허용하지 않음**
- 먼저 편집 중인 사용자에게 잠금
- 다른 사용자는 읽기 전용으로 접근

---

## 7. 도구 메뉴 노출 화이트리스트 (템플릿셋별)

좌측 ToolBar 도구 메뉴(업로드/모양컷/템플릿/이미지/텍스트/요소/배경/프레임/QR·바코드/편집도구/AI)를 템플릿셋(상품) 단위로 노출 제어.

**저장 위치**: `template_sets.enabled_menus` (JSON 배열, nullable)

| 값 | 의미 |
|---|---|
| `null` (기본) | 모든 메뉴 노출 — legacy 호환 |
| `[ ... ]` 배열 | 화이트리스트 — 배열에 포함된 키만 노출 (순서 보존) |
| `[]` 빈 배열 | 모든 도구 메뉴 숨김 |

**도구 키** (`EditorMenuKey`, `packages/types/src/index.ts`):
`UPLOAD`, `CLIPPING`, `TEMPLATE`, `IMAGE`, `TEXT`, `SHAPE`, `BACKGROUND`, `FRAME`, `SMART_CODE`, `EDIT`, `AI`, `CALENDAR`(2026-10-17 추가 — `defaultEnabled:false`, 관리자 editMode 또는 `productProfile.kind==='calendar'` 세트에서만 노출, §21.1), `PHOTO_PRINT`(2026-10-19 추가, 브랜치·미커밋 — 라벨 '사진인화', `defaultEnabled:false`, `requiresFlag:'PHOTO_PRINT'`(`packages/types/src/index.ts:1990`), 빌드 플래그 `VITE_ENABLE_PHOTO_PRINT` 가 정확히 `'false'` 일 때만 off(`ToolBar.tsx:40`), 관리자 editMode 또는 `productProfile.kind==='photo-print'` 세트에서만 노출(`ToolBar.tsx:152-156`), §21.8)

**Admin 설정**: 템플릿셋 "설정" 화면 → "도구 메뉴 노출 직접 설정" 토글 → 체크박스 그룹

**Editor 적용**: `loadTemplateSetEditor()` 가 templateSet 로드 시 `useSettingsStore.setEnabledMenus()` 호출 → ToolBar 가 자동 필터링.

**예시 시나리오**:
```jsonc
// 동화책 — 프레임/QR 안 씀
{ "enabledMenus": ["UPLOAD","CLIPPING","TEMPLATE","IMAGE","TEXT","SHAPE","BACKGROUND","EDIT","AI"] }

// 전단지 — AI/모양컷 안 씀
{ "enabledMenus": ["UPLOAD","TEMPLATE","IMAGE","TEXT","SHAPE","BACKGROUND","FRAME","SMART_CODE","EDIT"] }

// 단순 PDF 입고용
{ "enabledMenus": ["UPLOAD"] }
```

**원칙**:
- `editMode === true` (admin 편집 미리보기) 에서는 화이트리스트 무시
- 빌드 플래그 (`VITE_ENABLE_*`) 와 화이트리스트는 **AND** 관계
- 새 도구 추가 시 `EditorMenuKey` + `EDITOR_MENU_DEFS` + `ToolBar.ALL_MENUS` 세 곳만 갱신 → admin 체크박스 자동 갱신

---

## 8. 디폴트 진입 — 샘플 8×8 inch 책 템플릿셋

URL 파라미터 없이 `/` 진입 시 자동 로드되는 샘플:

| 항목 | 값 |
|---|---|
| 템플릿셋 ID | `sample-8x8-book-24p` |
| 판형 | 203.2 × 203.2 mm (8 × 8 inch) |
| 에디터 모드 | `book` (스프레드 표지 + 내지) |
| 구성 | 표지 스프레드 1 + 내지 24 |
| pageCountRange | `[8, 24, 48]` |

**스프레드 사양**:
- 408.1 × 203.2 mm (앞표지 + 책등 1.7 mm + 뒤표지)
- 책등 = `(24/2) × 0.10 + 0.5` (모조지 80g · 무선제본 24p 기준)

**시드 데이터**: [`apps/api/migrations/20260508_seed_sample_template_set.sql`](../apps/api/migrations/20260508_seed_sample_template_set.sql) — `INSERT ... ON DUPLICATE KEY UPDATE` 로 idempotent.

**디폴트 변경 / 비활성화**: 환경변수 `VITE_DEFAULT_TEMPLATE_SET_ID`
- 다른 ID → 그 templateSet 자동 로드
- `none` / `disabled` / 빈 문자열 → 기존 100×100mm 빈 캔버스 디폴트로 복원

---

## 9. 객체 선택 핸들 UI

| 컨트롤 | 모양 | 동작 |
|---|---|---|
| 4 코너 (`tl/tr/bl/br`) | **원형** Ø12 (터치 ×1.33) | 자유 비율 리사이즈 |
| 좌·우 변 (`ml/mr`) | **세로 캡슐** 7 × 22 | 가로 스케일 / Shift+드래그 = 스큐 |
| 상·하 변 (`mt/mb`) | **가로 캡슐** 22 × 7 | 세로 스케일 / Shift+드래그 = 스큐 |
| 회전 (`mtr`) | **객체 아래 36px 원형 + 회전 화살표** | 회전 (15° 스냅) |

추가 UX:
- 보더 두께 1px → 1.5px (선택 객체 인식 강화)
- 회전 핸들 위→아래 이동 (텍스트 위 가려짐 방지)
- 회전 화살표는 객체 angle 무관 항상 화면 기준으로 표시
- light/dark 테마 색상 자동 동기화 (브랜드 파랑/그린)
- 터치(`pointer:coarse`) 환경에서 핸들/캡슐 비례 확대

구현: [`packages/canvas-core/src/plugins/ControlsPlugin.ts`](../packages/canvas-core/src/plugins/ControlsPlugin.ts) — `fabric.Object.prototype.controls` 의 각 컨트롤 `render` 커스터마이즈 (idempotent 가드).

---

## 10. 워크스페이스 자동 중앙 정렬

캔버스 영역 폭이 바뀔 때(사이드 메뉴 토글, 사이드바 드래그 리사이즈, 객체 선택 시 ControlBar 등장, 윈도우 리사이즈) 편집중인 페이지(workspace)가 자동으로 새 영역의 중앙으로 재배치됨.

| 상황 | 동작 |
|---|---|
| 현재 줌에서 페이지가 새 영역에 들어감 | **줌 유지** + 중앙 재배치 (`WorkspacePlugin.setCenterPointOf`) |
| 페이지가 새 영역을 넘어감 | **자동맞춤**(`setZoomAuto`) — 페이지 전체가 다시 보이게 스케일 |

- 5% 여백 (`PADDING = 0.95`) 으로 경계선 진동 방지
- 첫 마운트는 스킵 (`WorkspacePlugin.reset()` 의 `setZoomAuto` 가 처리)
- 구현: [`apps/editor/src/views/EditorView.tsx`](../apps/editor/src/views/EditorView.tsx) — ResizeObserver `apply()`

---

## 11. 모드별 헤더 UI (사용자 vs 관리자)

같은 EditorView 가 권한·URL 파라미터에 따라 다른 헤더를 노출해 운영자가 한눈에 "지금 편집하는 게 본인 작품인가, 운영 베이스인가" 구분 가능.

### 11.1 진입 매트릭스

| 진입 경로 | URL | 권한 | 화면 모드 | 저장 동작 |
|---|---|---|---|---|
| Admin "템플릿셋 수정" | `/?templateSetId=…&adminEdit=templateSet&token=<admin_jwt>` | admin | **admin templateSet 수정** | `PATCH /templates/:id` × N (각 페이지) |
| Admin standalone (legacy) | `/?templateSetId=…&token=<admin_jwt>` | admin | admin standalone | `POST/PATCH /editor-designs` (작품) |
| 고객 (PHP iframe embed) | `embed.tsx` 번들 | customer | embed | `PATCH /edit-sessions/:id` + 파일 업로드 + complete |
| 고객 (standalone 새 탭) | `/?templateSetId=…` | customer | standalone | onFinish 콜백 미연결 (토스트만) |
| Admin → 템플릿관리 → "편집" | `/template?templateId=…` | admin | TemplateEditorView | `PATCH /templates/:id` 1건 |

### 11.2 헤더 영역 모드별 차이

| 영역 | 고객 (embed) | Admin "템플릿셋 수정" |
|---|---|---|
| 좌측 인디케이터 | `AutoSaveIndicator` (실시간) | **"⚠ 수동 저장 모드"** amber 뱃지 |
| 우측 "불러오기" | 표시 (내 작업 라이브러리) | **숨김** (templateSet 자체를 편집 중) |
| 우측 액션 1 | "내 작업에 저장" | **"저장"** (창 유지, ⌘S) |
| 우측 액션 2 | **"편집완료"** (PHP onFinish) | **"저장 후 닫기"** (저장 + window.close) |
| 저장 가드 | 자동저장 (30초) + 수동 | **`window.confirm`** + amber 배너 |
| 상단 안내 배너 | 없음 | **amber 배너** — 영향 범위·액션·단축키·자동저장 부재 |

### 11.3 Admin "템플릿셋 수정" 저장 가드

운영 사고(실수로 빈 캔버스 저장 등) 방지 — 모든 저장 진입점 (저장 버튼/저장 후 닫기/⌘S/커맨드 팔레트) 이 동일 confirm 거침:

```
이 템플릿셋의 모든 페이지 디자인을 갱신합니다.

• 영향 페이지: <N>개
• PATCH 대상 templates: <M>개 (중복 templateId 제거)
• 갱신 후 같은 templateSetId 로 진입하는 모든 사용자에게 새 디자인이 보입니다.

저장 후 [계속 편집할 수 있습니다 | 창을 닫습니다]. 진행하시겠습니까?
```

### 11.4 Admin 라벨 정리 (혼동 방지)

| 메뉴 | 라벨 | 동작 |
|---|---|---|
| 템플릿 관리 | **편집** | 단일 템플릿 캔버스 → templates 갱신 |
| 템플릿셋 관리 | **템플릿셋 수정** | 모든 페이지 캔버스 → 각 templates 갱신 (운영 베이스) |
| 템플릿셋 관리 | **설정** | 메타 form (이름·판형·페이지 구성·도구 메뉴 노출) |

이전의 "에디터" 라벨은 모호해 폐기 — "수정 vs 설정" 으로 캔버스 vs 메타 의미 구분.

### 11.5 PHP/bookmoa 영향

**없음.** 두 가드 모두 통과해야 admin 분기 활성화:
1. URL `?adminEdit=templateSet` (PHP 미전달)
2. `useIsAdmin() === true` (고객 JWT 거부)

부수 효과(긍정): admin 이 입혀둔 디자인이 **자동으로 고객 시작 베이스가 됨** (templates.canvas_data 가 갱신됐으므로).

별도 통보 문서: [`PHP_NOTICE_2026-05-10_admin_template_set_edit.md`](./PHP_NOTICE_2026-05-10_admin_template_set_edit.md)

---

## 12. 관련 파일 빠른참조

| 영역 | 파일 |
|---|---|
| 도구 메뉴 키 정의 | `packages/types/src/index.ts` (`EditorMenuKey`, `EDITOR_MENU_DEFS`) |
| TemplateSet entity (enabled_menus) | `apps/api/src/templates/entities/template-set.entity.ts` |
| Admin 토글 UI | `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` |
| Admin 라벨 (행) | `apps/admin/src/pages/TemplateSets/TemplateSetList.tsx` |
| EditorView (디폴트 진입 + adminEdit 분기 + amber 배너) | `apps/editor/src/views/EditorView.tsx` |
| 디폴트 샘플 ID 상수 | `apps/editor/src/constants/defaultTemplateSet.ts` |
| ToolBar (메뉴 필터링) | `apps/editor/src/components/editor/ToolBar.tsx` |
| EditorHeader (모드별 UI 분기 + confirm 가드) | `apps/editor/src/components/editor/EditorHeader.tsx` |
| useTemplateSetSave (admin 저장 훅) | `apps/editor/src/hooks/useTemplateSetSave.ts` |
| useSettingsStore (`enabledMenus`) | `apps/editor/src/stores/useSettingsStore.ts` |
| 객체 선택 핸들 | `packages/canvas-core/src/plugins/ControlsPlugin.ts` |
| 시드 SQL — 템플릿셋 도구 메뉴 컬럼 | `apps/api/migrations/20260508_add_template_sets_enabledMenus.sql` |
| 시드 SQL — 샘플 템플릿셋 | `apps/api/migrations/20260508_seed_sample_template_set.sql` |

---

## §13 인쇄 워크플로우 v1 — 면지 / PDF 첨부 / 게스트 / 기성·페브릭 표지 / 마이페이지 (2026-05-19)

> 자세한 외부 통합 사양: [`docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`](./PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md)
> 운영 계획서: `Bookmoa_platform_Plan.md` (Phase 4·5·6 단일 진실)
> 관련 커밋: `7a4443e` P1 · `8aedc9c` P2 · `d8f4e81` P3 · `9491fe2` P4 · `50c0d1c` P5 · `b45f614` P6

### 13.1 면지 (EndPaper)

책의 표지 안쪽(앞면지) / 뒷표지 안쪽(뒷면지) 빈 페이지.

**관리자 (`TemplateSetForm`)**:
- `endpaperConfig.frontCount` (0~6) / `backCount` (0~6)
- `frontEditable` / `backEditable` (편집 가능 토글)

**저장**: `template_sets.endpaper_config` JSON 컬럼.

**Editor 표시**: `EditorWorkflowControls` 의 floating 안내 카드 "📄 면지 앞N/뒤M".

**Worker 합본 (compose-mixed)**: `frontEndpaperUrls[] / backEndpaperUrls[]` 의 `null` 원소는 worker 가 빈 페이지 자동 생성. URL 이 있으면 (편집가능 면지) 그대로 합본.

### 13.2 내지 PDF 첨부

**컴포넌트**: `apps/editor/src/components/editor/ContentPdfAttachModal.tsx`

**흐름**:
1. `EditorWorkflowControls` floating 버튼 "📎 내지 PDF 첨부" → 모달 열기
2. 파일 선택 (`application/pdf`, 50MB 이하) → `POST /api/storage/upload-public`
3. `POST /api/worker-jobs/validate` 로 검증 잡 생성 → 30s 폴링
4. 결과 분기:
   - `completed` → 통과
   - `fixable` → 자동 보정 가능 (사용자 확인 모달)
   - `failed` → **첨부 거부** (결정 3-4)
5. 통과 + PDF 페이지수 > 현재 내지 수 + `canAddPage=true` → 자동 확장 선택 모달 (결정 3-2)
6. `PATCH /edit-sessions/[guest/]:id` 에 `contentPdfFileId` + `contentPdfMode='underlay'` 저장
7. `POST /worker-jobs/render-pages`(110dpi 래스터) 폴링 → `metadata.contentPdfGuide.pageImageUrls` 저장
8. **(W1, 2026-08-13) 즉시 앉히기** — `seatContentPdf()` 가 재로드 없이 ①내지 페이지를 PDF 페이지 수로
   확장하고 ②각 내지에 가이드를 배치한 뒤 ③첫 내지 페이지로 이동. 완료 토스트로 표시전용 계약을 안내.

**결정 3-3 배타**: PDF 첨부 상태에서 캔버스 수정 시 API 가 `400 PDF_ATTACHED_EXCLUSIVE` 거부.

#### 13.2-A 앉히기(seating) 계약 — W1 (2026-08-13)

정본 모듈: `apps/editor/src/utils/contentPdfGuide.ts`

| 함수 | 역할 |
|---|---|
| `ensureUnderlayPages(pageCount)` | 내지 캔버스를 PDF 페이지 수까지 **추가만** 한다(감소 없음). 상한 `UNDERLAY_MAX_PAGES=200`(워커 래스터 상한 정렬). 스프레드 모드 아님·`regionScope='inner'`(포토북 내지 전용 세트)는 대상 외 |
| `applyContentPdfGuides(session, tsId)` | 내지마다 가이드 이미지를 `excludeFromExport` 잠금 배경으로 배치. **멱등** — 재호출 시 기존 가이드/레이블 제거 후 재배치 |
| `seatContentPdf(session, tsId, opts)` | 위 둘의 합성. 호출 지점 3곳이 공유 |

**호출 지점(대칭 — 비대칭이 G1·G3 결함의 원인이었다)**
1. `/embed` 세션 로드 직후 (`embed.tsx`) — 확장은 `loadTemplateSetEditor(underlayPageCount)` 가 이미 수행 → 가이드만
2. 첨부 완료 직후 (`EditorWorkflowControls.onAttached`) — 재로드 없이 확장+배치, `focusFirstInnerPage`
3. `EditorView(/)` 로드 (`EditorWorkflowControls` 가 소유 게스트 세션을 조회해 수행)

**첨부 진입점 노출(G2)**: `EditorWorkflowControls` 는 이제 `/embed` 에도 마운트된다.
- 임베드는 `sessionId`(+게스트면 `guestToken`)를 **명시 주입** → 별도 게스트 세션을 만들지 않는다(첨부가 엉뚱한 세션에 붙는 사고 방지).
- 호스트 opt-out: `/embed?contentPdfAttach=0`. 폴백 템플릿셋 구동 시에는 비노출(판형 불일치 검증 방지).
- 레더·면지 안내 배너는 레거시 `/` 에만 유지(임베드 배선은 G8 트랙).

**알려진 비대칭(설계상 수용)**: 즉시 확장으로 생긴 내지는 **빈 페이지**, 재로드로 생긴 내지는 마지막 내지
템플릿 복제본이다. underlay 는 표시전용(원본 PDF 인쇄)이라 내지 템플릿 아트워크는 인쇄에 영향이 없다.

#### 13.2-B 내지 페이지 재정렬(G4, 2026-08-13)

스프레드 모드 정본 UI(`SpreadPagePanel`)에서 내지 썸네일을 드래그해 순서를 바꿀 수 있다.
표지 스프레드(캔버스 0)는 고정. 내지 전용 펼침면 세트(`regionScope='inner'`)는 전 페이지가 이동한다.
터치(`pointer: coarse`)는 BookNavigation 과 같이 비활성.

재정렬은 `reorderByIndex` 한 곳 — DOM 컨테이너 순서도 같이 맞춘다(`setPage` 가 DOM 인덱스를 쓰기 때문).
내지 PDF 가 앉아 있으면 `metadata.contentPdfPageOrder`(슬롯→원본 PDF 페이지)를 갱신해
재로드 후에도 가이드가 따라온다. **인쇄는 첨부 원본 PDF 순서 그대로**(G6 표시전용).

### 13.3 게스트 (24h 자동 삭제)

**Store**: `apps/editor/src/stores/useGuestStore.ts`
- sessionStorage 자동 복원/저장 (`storige_guest_session_v1`)
- `ensureGuestSession({templateSetId, mode})` — 없으면 `POST /edit-sessions/guest` 호출

**자동 발급**: `EditorWorkflowControls` 가 token 없으면 templateSet 로드 후 자동 호출.

**24h 만료**: DB EVENT `evt_purge_expired_guest_sessions` (1h 주기) 가 `guest_expires_at < NOW()` 세션 DELETE.

**Editor App 마운트**: `App.tsx` 에서 `useGuestStore.initializeFromStorage()` 1회 호출.

### 13.4 페브릭·기성 표지 (`coverEditable=false`, 2026-08-13 재정의)

고객은 표지 템플릿 캔버스를 **그대로** 본다. `LeatherCoverPreview` 로 캔버스를 대체하지 않는다.

- 소재는 템플릿 제작 시 배경(`extensionType=background`)으로 깐다.
- 고객 경로: 표지(캔버스 0) 배경만 잠금. 내지는 잠그지 않는다.
- 후가공(형압·금박·은박)은 텍스트/PNG, `coverConfig.finishing` 으로 on/off. 기본 전부 OFF. **화면 표시만**(인쇄 별색 분판은 후속).
- 컷팅 효과는 페브릭 표지 UI 에서 숨긴다.
- `coverPreviewImage` 는 관리자 목록 썸네일 전용.

**Worker compose-mixed**: 현행 유지 — `coverEditable=false` 면 빈 표지 페이지(화면 후가공은 인쇄에 안 실림).

**Editor 안내**: 레거시 `/` 에서만 "페브릭 · 기성 표지" 배너. 임베드는 노출하지 않음.

### 13.5 편집완료 로그인 유도 + 회원 전환

**컴포넌트**: `apps/editor/src/components/editor/GuestAuthPromptModal.tsx`

**결정 3-6**: 게스트가 편집완료 누를 때만 로그인 유도. 자동 30분 후 유도 없음.

**부모 사이트 통신** (iframe embed 시):
```js
{ source: 'storige-editor', event: 'editor.needAuth',
  payload: { guestToken, reason: 'complete_save', ts } }
```

부모 사이트가 로그인 처리 후 `window.__storigeMigrateNow()` 또는 직접 `POST /edit-sessions/guest/migrate { guestToken }` 호출 → 게스트 세션 회원 흡수.

### 13.6 마이페이지 `/my-works`

**View**: `apps/editor/src/views/MyWorksView.tsx` (lazy)
**API**: `GET /edit-sessions/my` (Bearer JWT)
**라우트**: `App.tsx` 에 `/my-works` 추가됨

비로그인 시 안내 + 편집기 복귀 버튼. 로그인 시 본인 세션 200건 최근순 + 재편집 링크.

### 13.7 핵심 파일 매핑

| 영역 | 파일 |
|---|---|
| 게스트 store | `apps/editor/src/stores/useGuestStore.ts` |
| 워크플로우 floating UI | `apps/editor/src/components/editor/EditorWorkflowControls.tsx` |
| PDF 첨부 모달 | `apps/editor/src/components/editor/ContentPdfAttachModal.tsx` |
| 표지 후가공 컨트롤 | `apps/editor/src/controls/SpecialEffect.tsx` |
| 관리자 썸네일 미리보기(캔버스 대체 금지) | `apps/editor/src/components/editor/LeatherCoverPreview.tsx` |
| 로그인 유도 모달 | `apps/editor/src/components/editor/GuestAuthPromptModal.tsx` |
| 마이페이지 view | `apps/editor/src/views/MyWorksView.tsx` |
| Admin 면지/표지 폼 | `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx` |
| API edit-sessions guest | `apps/api/src/edit-sessions/edit-sessions.controller.ts` (POST /guest, PATCH /guest/:id, POST /guest/migrate, GET /my) |
| API compose-mixed | `apps/api/src/worker-jobs/worker-jobs.controller.ts` (POST /compose-mixed) |
| Worker compose-mixed | `apps/worker/src/processors/synthesis.processor.ts` (`handleComposeMixedSynthesis`) |
| 마이그레이션 SQL | `apps/api/migrations/20260519_v1_phase2_workflow_schema.sql` |

---

## §14 임베드 전환 + 텍스트 자유도 + 원형 텍스트 + 게스트 폴백 (2026-06-02)

> 상세 핸드오프: [`.cursor/plans/RESUME_PROMPT_2026-06-02.md`](../.cursor/plans/RESUME_PROMPT_2026-06-02.md)

### 14.1 `/embed` 라우트 — 외부 iframe 임베드 진입점

외부 서비스(bookmoa-mobile 등)는 **`/embed`** 로 띄운다. 기존 `/`(EditorView)는 고객 편집완료 시
부모로 완료 메시지를 안 보내고 자동저장·세션영속 배선이 없으므로 **레거시**. `/embed`(`EmbedView.tsx`)는
완전 배선된 `EmbeddedEditor`(embed.tsx, 원래 PHP IIFE용)를 URL로 마운트 → 자동저장·세션영속·정식
postMessage·**sessionId 재편집**을 재사용한다.

```
신규 편집: /embed?templateSetId=<id>&token=<JWT>&orderSeqno=<n>&pageCount=&paperType=&bindingType=&parentOrigin=<부모origin>
재편집:    /embed?sessionId=<저장ID>&token=<JWT>&parentOrigin=...   (templateSetId 자동도출)
```

- 파라미터는 camelCase/snake_case 양쪽 허용(`getParamCompat`).
- **postMessage dual-emit**: 정식 엔벨로프(`editor.ready/save/complete/cancel/error/needAuth`) + 레거시(`storige:completed/saved/...`). 기존 호스트 하위호환 + 추후 정식 엔벨로프 이전.
- 라우트: `App.tsx` 에 `/embed`. SPA fallback rewrite가 자동 처리(vercel.json 불변).
- **런처 선생성 세션 진입 (P2-b, 2026-10-18 — 브랜치 `p1-calendar-2026-10-17` 만, master 미병합·운영 미반영)**: 파트너 서버가 `POST /api/v1/sessions/launch` 로 세션을 먼저 만들고 응답 `embed{sessionId, token, refreshToken}` 를 위 **재편집 형식 그대로** `/embed?sessionId&token&refreshToken&parentOrigin` 에 넣는다. 신규 URL 파라미터는 없다 — §21.4.

### 14.2 텍스트 리치 스타일 강화 (TextAttributes / ObjectFill)

| 기능 | 동작 |
|---|---|
| 이탤릭(fontStyle) | 굵게/밑줄과 동일 — 부분선택(`setSelectionStyles`) + 전체 폴백. B/I/U 3버튼 |
| 부분 색상 | 편집 중 글자 범위 선택 시 그 부분만 단색(없으면 전체). 부분은 단색만(그라디언트 전체) |
| 글자 크기 | 직접 입력 + 프리셋(pt) 드롭다운(`applyFontSizePt` 공유) |
| 직관 UI | B/I/U 아이콘 + title 툴팁 + `aria-pressed` |

per-character `styles`(이탤릭·부분색)는 직렬화 리스트(`packages/canvas-core/src/utils/canvas.ts`)에 포함 → 저장/복원/PDF 반영.

### 14.3 원형/배지 텍스트 (TextEffect "곡선")

- 기존 180° 고정 → **호 각도 슬라이더(30~340°)** + **프리셋 칩(반원/¾/원형)**. `generatePathData(r,reverse,deg)` — 180°는 기존과 동일(회귀 0).
- `arcDeg`는 `curveArcDeg`로 직렬화(`curveRadius/curveDirection`과 동일).
- 배지 = 상단 텍스트(곡선 상단) + 하단 텍스트(곡선 하단) 2개. 패치/병뚜껑/라벨.
- **PDF 출력 안전**: 출력은 `toDataURL('png')` 래스터 캡처(`useWorkSave.ts`)라 fabric이 그린 곡선 텍스트가 그대로 PNG→PDF에 출력됨.
- `EffectPlugin.textCurve`(글자 그룹 분해)는 죽은 레거시 — 미사용.

### 14.4 게스트 세션 폴백 (MEMBER_REQUIRED 400 방어)

- `/embed`는 진입 즉시 `POST /edit-sessions`로 회원 세션 생성. 토큰에 **회원번호(memberSeqno) 누락/0**이면 **400 `MEMBER_REQUIRED`** → "편집기를 열 수 없습니다".
- **보강**: 회원 세션 생성 실패 시 `createGuest` 자동 폴백 → 편집기 오픈. 저장 경로는 `currentSession.guestToken` 유무로 `update ↔ updateGuest` 분기(회원 토큰이면 기존 동작 그대로, 회귀 0). 게스트 편집완료 → `editor.needAuth` emit(로그인 유도).
- **정석 해결(bookmoa 측)**: shop-session 발급 시 로그인 회원의 `memberSeqno`를 토큰에 포함. (`HANDOFF_StorigeEditorHost_iframe_overlay_2026-05-31.md` §3.5)

### 14.5 핵심 파일 매핑

| 영역 | 파일 |
|---|---|
| 임베드 진입 view | `apps/editor/src/views/EmbedView.tsx` |
| 임베드 에디터 본체 | `apps/editor/src/embed.tsx` (`EmbeddedEditor`, postMessage, 게스트 폴백) |
| 자동저장(게스트 분기) | `apps/editor/src/hooks/useEmbedAutoSave.ts` |
| 텍스트 속성 | `apps/editor/src/controls/TextAttributes.tsx` |
| 채우기(부분색) | `apps/editor/src/controls/ObjectFill.tsx` |
| 곡선/원형 텍스트 | `apps/editor/src/controls/TextEffect.tsx` |
| 직렬화 prop 리스트 | `packages/canvas-core/src/utils/canvas.ts` (`styles`, `curveArcDeg` 등) |
| 라우트 | `apps/editor/src/App.tsx` (`/embed`) |

---

## §15 템플릿·에셋 공급 + 인쇄 품질 + 객체 보호 (2026-06-03 오토파일럿 1차)

> 갭 분석 `/.cursor/plans/EDITOR_TEMPLATE_ASSET_GAP_2026-06-02.md` 의 P0/P1 항목 중
> **백엔드·로직·빌드검증 가능 항목**을 안전 완료한 변경 요약. (인터랙티브/렌더 QA 필요 항목은 동 문서 '진행 상태' 참조.)

### 15.1 에셋 라이브러리 단절 해소 (P0-1) — `b04dd39`
- **문제**: 관리자 Library(`/library/*`)에 등록한 클립아트/프레임/배경이 고객 편집기 패널에 전혀 안 보임.
  원인 ① 편집기가 읽는 `editor_contents` 테이블이 0행 ② admin은 `library_cliparts/frames/backgrounds` 에 기록 → 두 시스템 미연결.
- **수정**: `editor-contents.service` 가 `type=element→library_cliparts`, `frame→library_frames`, `background→library_backgrounds`
  를 조회해 편집기 `EditorContent` 형태로 매핑. (`template`/`image` 은 종전 `editor_contents`.)
  편집기 `useEditorContents.safeGetImageUrl/safeGetTemplateUrl` 가 중첩(`image.image.url`)+flat(`imageUrl`) 모두 수용.
- **운영 시사점**: **관리자가 Library 에 에셋을 등록하면 곧바로 고객 편집기 요소/프레임/배경 패널에 노출**된다.

### 15.2 PDF 출력 DPI/화질 (P0-3) — `9eff3ed`
- 레거시 "PDF 저장" 버튼이 **DPI 72 하드코딩**이라 px→mm 환산이 ~4배 어긋남 → **300 으로 통일**(embed/스프레드 경로와 동일).
- `ServicePlugin` 이미지 다운스케일 캡 1280/1536/1600/2048 → **3508(300DPI×A4 장변)** 단일 상수 `PRINT_MAX_IMAGE_DIMENSION`.
- **운영 시사점**: 인쇄용 PDF 물리 크기 정합 + 사진/이미지 인쇄 화질 향상.

### 15.3 객체 잠금/삭제불가 (P1-5) — `74a082f`, `615c642`
- 완성돼 있으나 **미등록**이던 `LockPlugin` 을 `createCanvas` 에 배선 + `editMode→'admin'`, 고객→`'user'` 역할 설정.
- `ObjectPlugin.del()`: editMode 가 아니면 `lockInfo.isLocked` 또는 `deleteable===false` 객체 삭제 차단(휴지통·Delete/Backspace 공통).
- `lockInfo`/`deleteable`/`evented` 를 직렬화(`extendFabricOption`)에 추가 → **저장→복원 후에도 보호 유지**.
- **관리자 UI**: `ControlBar` 에 editMode 전용 "삭제 잠금" 토글(방패 아이콘). 이동잠금은 기존 자물쇠 버튼/`cmd+L`.
- **운영 시사점**: 관리자가 템플릿 제작 시 특정 객체를 잠그면 **고객이 이동·삭제 불가**.

### 15.4 곡선/원형 텍스트 PDF 보존 (P1-6) — `61e3d13`
- `svgTextToPath` 가 Fabric path-text 의 글자별 `rotate` 를 무시 → 원형 텍스트가 PDF 에서 펴지던 문제.
- 각 글자 path 에 `transform="rotate(deg x y)"` 적용 → 호를 따라 회전 보존.

### 15.5 내지 PDF 첨부 모드 토대 (P0-2 API) — `c02a6e6`
- `EditSession.contentPdfMode`(`replace`|`underlay`) 추가. **prod DB ALTER 선행 완료**, `init.sql` 도 content_pdf_* 4종 명시.
- `underlay` 모드면 `PDF_ATTACHED_EXCLUSIVE` 가드 완화 → PDF 배경 위 편집 캔버스 저장 허용.
- ⚠️ **편집기 pdfjs 렌더→잠금배경 페이지 자동생성 + 워커 underlay 합성은 후속**(갭 문서 'P0-2 잔여 작업' 참조).

### 15.6 핵심 파일 매핑
| 영역 | 파일 |
|---|---|
| 에셋 공급(library→editor) | `apps/api/src/editor-contents/editor-contents.service.ts`, `.module.ts` |
| 에셋 URL 폴백 | `apps/editor/src/hooks/useEditorContents.ts` (`safeGetImageUrl`) |
| PDF DPI | `apps/editor/src/components/editor/EditorHeader.tsx` (300) |
| 이미지 인쇄 캡 | `packages/canvas-core/src/plugins/ServicePlugin.ts` (`PRINT_MAX_IMAGE_DIMENSION`) |
| 객체 잠금 플러그인 | `packages/canvas-core/src/plugins/LockPlugin.ts`, 배선=`apps/editor/src/utils/createCanvas.ts` |
| 삭제 강제 | `packages/canvas-core/src/plugins/ObjectPlugin.ts` (`del()`) |
| 잠금 직렬화 | `packages/canvas-core/src/utils/canvas.ts` (`lockInfo`/`deleteable`) |
| 삭제잠금 UI | `apps/editor/src/components/editor/ControlBar.tsx` |
| 곡선 텍스트 보존 | `packages/canvas-core/src/converters/svgTextToPath.ts` |
| PDF 첨부 모드 | `apps/api/src/edit-sessions/{entities,dto,edit-sessions.service}.ts` |

## §16 스프레드 책 편집완료 PDF 프리즈 — 진단 · 하드닝 (2026-06-03 오토파일럿 2차)

> 상세 진단/설계: [`.cursor/plans/SPREAD_PDF_FREEZE_FINDINGS_2026-06-03.md`](../.cursor/plans/SPREAD_PDF_FREEZE_FINDINGS_2026-06-03.md)

### 16.1 증상과 오진단 정정
- **증상**: 스프레드(펼침 표지) 책 편집완료 시 표지 cover PDF 생성이 프로덕션 난독화 에러 `'Mt'` 로 실패, 모든 `both` 모드 세션의 `cover_file_id`/`content_file_id` NULL.
- **정정**: cover PDF **로직 자체는 정상**. 실제 실패 세션 canvasData + 스프레드 오버레이 + 실제 Noto Sans KR 웹폰트로 **로컬 dev 충실 재현 → 0.4초 정상 생성**(이미지/특수객체/폰트→벡터/429mm/clipPath/CJK 전부 배제).
- **실제 원인**: **프로덕션 editor 렌더러 하드 프리즈**(편집완료 실제 트리거 시 5분+ 프리즈, 세션 `editing` 고정). 무거운 editor(opencv 10MB+onnx 882KB+11 라이브 fabric 캔버스 + PDF 래스터 동시 점유) = 환경/스케일 요인. 경량 컨텍스트에선 재현 불가가 일관.

### 16.2 Patch B — handleFinish 하드닝 + 핫스팟 계측 (`19158f8`)
- `embed.tsx`:
  - `finishMark(phase)`: 각 단계 진입 직전 `Sentry.captureMessage` + `await Sentry.flush(1500)` → **프리즈에도 '마지막 통과 단계'가 Sentry(papascompany/editor)에 전달** → 다음 실패에서 핫스팟 자동 특정. 단계: `canvasData:save:{start,done}`·`spread:cover:gen:{start,done,FAILED}`·`spread:content:gen:{start,done,FAILED}`·`single:gen:{start,done}`·`complete:{start,done}`.
  - `withWatchdog(p, ms, label)`: cover 120s / content 180s / single 120s 비동기 워치독 → **영구 무한로딩 방지**(동기 블록은 못 잡으나 비동기 행/네트워크 stall 대비).
  - 각 PDF 생성 catch에 `Sentry.captureException(tags:{finishPhase})` → 실제 `'Mt'` 예외를 단계 컨텍스트와 함께 보고.
- 저위험·가산적, `complete()` 항상 실행(회귀 없음). `pnpm --filter @storige/editor build` 통과.

### 16.3 부수 발견 (별개 실버그)
- **`/api/woff2ToTtf` 라우트 부재(404)** + **`library_fonts` 0행** → PDF 텍스트 아웃라인화 항상 실패(catch). 인쇄 폰트 임베딩 누락 위험. 폰트 시딩(제품 결정) + 라우트 구현(`wawoff2`) 필요 — 프리즈와 별개·하위 우선순위.
- `products/spine/calculate` 는 프로덕션 정상(201).

### 16.4 다음 단계 (Patch B 계측 데이터 확정 후)
- **C 풋프린트 축소**: 메모리 요인이면 라이브 캔버스 dispose/opencv 언로드(취소 복구 위험), CPU 폭주면 `ServicePlugin._createMultiPagePDF` 루프 핫스팟 수정. ("격리 컨텍스트"만으론 피크 메모리 안 줆.)
- **D 서버사이드 생성**: 워커가 canvasData→PDF 렌더(권장 **Puppeteer 헤드리스**로 동일 코드 재사용) → 브라우저 메모리 천장 제거(근본 해결). compose-mixed 파이프라인 합류.

### 16.5 핵심 파일 매핑
| 영역 | 파일 |
|---|---|
| 편집완료 하드닝/계측 | `apps/editor/src/embed.tsx` (`finishMark`/`withWatchdog`, handleFinish) |
| PDF 생성 파이프라인 | `packages/canvas-core/src/plugins/ServicePlugin.ts` (`saveMultiPagePDFAsBlob`→`_createMultiPagePDF`) |
| Sentry | `apps/editor/src/lib/sentry.ts` |
| 폰트→벡터(woff2ToTtf 404) | `packages/canvas-core/src/plugins/FontPlugin.ts` (`getTtfBuffer`) |
| dev 재현 하니스(미커밋) | `apps/editor/repro.html`, `apps/editor/src/repro-cover.tsx` |

## §17 임베드 편집기 — 뒤로 가기 데이터 무결성 가드 (2026-06-04)

> 증상: bookmoa 등 호스트 SPA 안(iframe/IIFE)에서 편집 중 브라우저 ← 뒤로가기를 누르면
> `beforeunload` 가 발화하지 않아(호스트 클라이언트측 라우팅) **아무 경고 없이** 편집 전 화면으로
> 빠져나가 작업이 유실될 수 있었음.

- **가드**: [`useEmbedBackGuard`](../apps/editor/src/hooks/useEmbedBackGuard.ts) — 마운트 시 history sentinel 1개 push 해 **첫 뒤로가기를 흡수**.
  - 변경 없음(`isDirty=false`) → 경고 없이 그대로 이탈(자연스러운 뒤로가기).
  - 변경 있음 → `confirm` 경고: **취소→머무름(sentinel 재추가)** / **확인→강제 자동저장(`saveNow` flush, 최대 3s) 후 이탈**.
- iframe 이면 sentinel/`history.back()` 이 합쳐진 세션 히스토리에 작용해 호스트 화면 전환을 일으키고, IIFE 면 호스트 윈도우에 직접 작용 — **양쪽 모두 동작**(브라우저 검증 완료: 머무름/저장후이탈/무변경이탈 3 시나리오).
- 배선: `apps/editor/src/embed.tsx` (`enabled: ready && 세션존재`). 기존 `beforeunload`(새로고침/탭닫기/탑네비) + 언마운트 `localStorage` 백업은 **중복 안전망으로 유지**.
- ⚠️ 한계(호스트 협조 시 개선): sentinel 이 호스트 히스토리에 1개 남음(정상 종료 후 추가 back 1회가 흡수될 수 있음).

### 17.1 호스트 연동 핸드셰이크 (host → editor 인바운드)
가장 견고한 형태(호스트 주도)를 위해 편집기에 인바운드 명령/응답을 추가(`apps/editor/src/embed.tsx`):
- 봉투: `{ source:'storige-host', version:'1', command, requestId?, payload? }` (origin === parentOrigin 검증).
- 명령: `getState`→`editor.state{ready,dirty,sessionId}` / `saveNow`(강제저장)→`editor.saved{ok,error?}` / `setBackGuard{enabled}`(내부 가드 on/off).
- 호스트(bookmoa-mobile)는 이를 이용해 뒤로가기/닫기 시 dirty 확인 + 강제저장 후 직접 라우팅 가능(내부 가드는 `setBackGuard{enabled:false}` 로 off).
- **호스트 구현 가이드**: [`.cursor/plans/HANDOFF_bookmoa_back_navigation_2026-06-04.md`](../.cursor/plans/HANDOFF_bookmoa_back_navigation_2026-06-04.md) (Tier A 핸드셰이크 코드 + Tier B 최소).

---

## §18 PDF 첨부 검증 감사·책등/날개 + 검증/저장 속도 최적화 (2026-06-04~05)

> 상세: `docs/PDF_VALIDATION_GUIDE.md` · 호스트 지시문 `.cursor/plans/HANDOFF_bookmoa_validate_fields_2026-06-04.md`
> 커밋: `ed9cacd`(책등/날개) · `bb73a86`(병렬화·음수캐시·타입수정) · `2e27dae`(글리프 dedup·동시성)

### 18.1 PDF 첨부 검증 — 책등(spine) 정합 + 날개(wing) 반영 (하위호환)
- 문제(감사): 워커 `validateSpine` 이 `paperThickness×(pages/2)` 로만 책등 재계산 → 권위 공식(`spine.service` = `(pages/2)×thickness + bindingMargin`)과 불일치(오검출). 날개는 검증식에 부재 → 정상 날개 표지 거부 위험.
- 수정: `orderOptions` 에 `spineWidthMm?/wingEnabled?/wingWidthMm?` 추가(`worker-job.dto`, 워커 `validation-result.dto`/`validation.processor`). `validateSpine` = 표지 기대너비 `size.w×2 + (spineWidthMm ?? paperThickness×pages/2) + (wingEnabled?wingWidthMm×2:0) + bleed×2` (±2mm). 미전달 시 기존 동작(회귀 없음).
- **프런트(bookmoa) 액션**: 검증 요청에 `spineWidthMm`(=`/products/spine/calculate` 의 `spineWidth`)·`wingEnabled`/`wingWidthMm` 전달해야 발효. 호출 위치: bookmoa `StorigeFileUploadPanel.startValidation()` → 어댑터 `api/storige/validate.js` → `/worker-jobs/validate/external`.

### 18.2 워커 검증 속도
- `pdf-validator.service.validate()`: 색상모드(GS inkcov)·별색·투명도/오버프린트·이미지해상도 4개 독립 검출을 순차 await → **`Promise.all` 병렬**(GS 자식프로세스 대기와 JS 파싱이 겹쳐 wall-time 단축).
- `validation.processor`: `@Process('validate-pdf')` 동시성 기본 1 → **`VALIDATION_CONCURRENCY`(기본 3)**. cover+content 다건 검증 동시 처리(GS 는 `GS_CONCURRENCY` 별도 보호).

### 18.3 편집기 저장/글리프 검증 속도
- `FontPlugin.getTtfBuffer`: **실패(음수) 캐시** 추가 — `woff2ToTtf` 404/URL없음 폰트를 폰트당 1회만 시도(반복 fetch 제거).
- `ServicePlugin._createMultiPagePDF` PDF 저장 전 글리프 검증: 텍스트마다 순차 → **폰트별 사용문자 집합(중복제거) 후 폰트당 1회·`Promise.all` 병렬**. 경고 confirm 로직·결과 동일.

### 18.4 기타
- 전체 워크스페이스 타입체크 결과 오류 1건만 존재 → `useTemplateSetSave.ts:94` fabric toJSON loose 반환형을 `CanvasData` 단언으로 수정(나머지 패키지 오류 0).
- 검증: canvas-core 214 / 워커 validator 27 + processor 6 테스트 통과. API+워커 수동 재배포·헬스 확인 완료.

### 18.5 핵심 파일 매핑
| 영역 | 파일 |
|---|---|
| 검증 입력 DTO(책등/날개) | `apps/api/src/worker-jobs/dto/worker-job.dto.ts` |
| 워커 검증 로직 | `apps/worker/src/services/pdf-validator.service.ts` (`validate`/`validateSpine`) |
| 검증 동시성 | `apps/worker/src/processors/validation.processor.ts` (`VALIDATION_CONCURRENCY`) |
| 폰트 TTF 음수캐시 | `packages/canvas-core/src/plugins/FontPlugin.ts` (`ttfBufferFailed`/`getTtfBuffer`) |
| 글리프 검증 dedup·병렬 | `packages/canvas-core/src/plugins/ServicePlugin.ts` (`_createMultiPagePDF` 글리프 단계) |
| 책등 계산 API | `apps/api/src/products/spine.service.ts` (`/products/spine/calculate`) |

---

## §19 스프레드 책 인쇄 무결성 체인 + 표지편집 감사 후속 (2026-06-06~07)

> 전수 감사(`.cursor/plans/COVER_EDIT_FULL_AUDIT_2026-06-06.md`) 후 P0(인쇄 무결성) 전량 + P1 일부 구현·배포. 모든 검증은 **SOFT(경고·기록, 무중단)** 1차, 운영 ENV `SPREAD_SNAPSHOT_HARD_FAIL=true` 로 HARD(차단) 승격.

### 19.1 스프레드 편집완료 PDF '프리즈' 근본수정 (`027c010`)
§16의 "프로덕션 렌더러 프리즈" 가설은 **오진**이었음(프로덕션 능동 재현으로 확정). 실제는 ~7초 빠른 실패 2건:
- **커버 업로드 HTTP 400**: `filesApi.upload` 가 `metadata` 를 JSON 문자열로 보내나 `UploadFileDto.@IsObject()` 가 거부 → `@Transform`(문자열→객체 선파싱) 추가. 2025-12-14부터 잠복(편집기 업로드 전체 차단, DB editor 업로드 0건이 증거).
- **내지 생성 TypeError(`reading 'unit'`)**: `ServicePlugin.ts` `firstCanvas.unitOptions.unit` 옵셔널체이닝 누락 → `?.unit ?? 'mm'`.

### 19.2 woff2ToTtf 엔드포인트 (`8fea0e8`)
`/api/woff2ToTtf` 404(미구현) 해소: NestJS `POST /library/woff2ToTtf`(wawoff2 decompress, SSRF 화이트리스트), `FontPlugin` 이 상대경로 대신 apiBaseUrl 호출 + TTF 원본 fast-path. ※텍스트 아웃라인화 실발효는 폰트 시딩(제품결정) 후.

### 19.3 출력재현 단일소스 — metadata.spread/spine 저장 + 검증 게이트 (`df99d69`, P0-1·P0-2)
- 편집기 완료 시 `EditSession.metadata.spread`(SpreadSnapshot: spec/totalWidthMm/totalHeightMm/dpi) + `metadata.spine`(SpineSnapshot: pageCount/paperType/bindingType/spineWidthMm/formulaVersion/spineWidthSource) 저장. 공용 util `apps/editor/src/utils/buildSpreadSnapshots.ts`(총폭은 `computeSpreadDimensions`로 wing×2 포함 재계산, try/catch 무중단). 두 완료경로(embed.tsx, useWorkSave.ts) 공용.
- 서버 검증 게이트를 `session.mode===SPREAD`(편집기가 안 보냄) → **`metadata.spread 존재`** 로 전환(`edit-sessions.service.ts validateSpreadSnapshot`). SOFT 기록(`metadata.spreadValidation`).
- types: `SPINE_FORMULA_VERSION`, `SpineSnapshot.spineWidthSource`, `SpreadValidationResult`+`EditSessionMetadata.spreadValidation`.

### 19.4 compose-mixed cover MediaBox 검증 + 분리 2파일 규칙 + totalWidthMm 결함수정 (`d81d3a7`, `8580b96`, P0-3)
- **확정 비즈니스 규칙**: 스프레드 책 = `cover.pdf`(펼침면 전체: 뒷표지|책등|앞표지+날개) + `content.pdf` **분리 2파일**.
- API `createComposeMixedJob`: 세션 `metadata.spread` 조회 → ①cover 검증 기대치(totalWidthMm/HeightMm/dpi) 큐 push, ②스프레드 책이면 `outputMode='separate'` **강제**(single은 cover 미출력 문제 해소).
- Worker `handleComposeMixedSynthesis`(separate): `validateSpreadCoverSize` — cover.pdf MediaBox(pt→mm) ↔ 기대 총폭, 1쪽 가정 + tol=max(0.2mm,1px@dpi). SOFT(`result.coverSizeValidation` 기록)/HARD(`SPREAD_PDF_SIZE_MISMATCH` throw).
- **🐞 가드가 검출한 실결함**: cover MediaBox 429.2mm vs 기대 428.6mm(0.6mm 과대). 원인: 책등 리사이즈 시 `updateSpreadSpineWidth`가 `spec.spineWidthMm`만 갱신하고 `SpreadConfig.totalWidthMm`는 stale → cover가 stale 총폭으로 생성. `computeSpreadDimensions`로 totalWidth/Height 동시 재계산하도록 수정 → cover가 정확히 428.6 생성(검증 ok:true).

### 19.5 B48/B49(핵심=B49) — 스냅샷 ↔ 템플릿 권위 기하 대조 (`b53fc50`)
- types `validateSpreadAgainstAuthority(candidate, authority)`: **책등(동적)·총폭 제외**, 표지 가로/세로·날개 기하만 ±0.2mm 대조(한쪽 없으면 통과=레거시 무영향).
- `complete()`: `TemplateSetsService.findOneWithTemplates`로 spread 템플릿 `spreadConfig.spec` 권위 로드 → 스냅샷 spec 대조 → `metadata.spreadValidation.mismatches`(AUTHORITY_*)에 병합. SOFT/HARD(`TEMPLATE_SPEC_MISMATCH`). DI: `TemplatesModule` import(순환참조 없음).
- **무결성 체인 완성**: 템플릿 권위 ⟵(B49) `metadata.spread` ⟵(P0-3) 실제 `cover.pdf` MediaBox.

### 19.6 A13 — 제본별 페이지 가드 (`7453bb1`)
`useEditorStore` `bindingType` 상태(기본 **null=제약없음** — perfect 기본값 금지로 비제본 32p 오적용 회귀 방지) + `canAddMorePages`/`canDeletePage`에 `BINDING_CONSTRAINTS` 적용(무선 min32 삭제차단, 중철 max64 추가차단). 책 로드 시 `config.bindingType`→`toBindingType` 주입, `SpreadPagePanel` 삭제가 `canDeletePage` 가드 경유 + 제본 안내 토스트. ※중철 4배수는 soft(후속). 호스트 쪽수 범위 세션은 보낸 쪽(min/max)의 제본 한도 미적용(W5, `bindingPageBounds`·`hostPageLimitSides`).

### 19.7 운영 플래그
`SPREAD_SNAPSHOT_HARD_FAIL`(api+worker 공용, 기본 `false`=SOFT, 정확히 `true` 일 때만 HARD). HARD 승격 시 ①편집완료 스냅샷/권위 누락·불일치 차단(api) ②compose-mixed cover MediaBox 불일치 차단(worker). `docker-compose.yml` 이 api·worker 양쪽에 `${SPREAD_SNAPSHOT_HARD_FAIL:-false}` 로 넘긴다(2026-10-05). HARD 전환은 오너 결정 뒤 별도 절차로 하며, api·worker 를 모두 재생성하고 `[FLAGS]` api·worker 두 줄이 같은 값인지 확인한다. 상세 `docs/DEPLOYMENT.md`.

### 19.8 영역 클릭 포커싱 편집 (PDF 핵심, `af69ac5`)
통합 펼침면에서 영역(뒷표지/책등/앞표지/날개) 클릭 → 해당 영역 하이라이트 포커싱. **SpreadPlugin 단독 구현**(canvas-core)이라 편집기/embed UI 배선 불필요 → `/embed` 자동 작동:
- `mouse:down` 핸들러: 빈 영역(시스템/워크스페이스/배경) 클릭 → `getRegionAtPoint`(scene→content 좌표 변환 캡슐화)로 영역 판정 → 하이라이트 오버레이 + `spreadRegionFocus` 이벤트. 같은 영역 재클릭=토글 해제. 사용자 객체 클릭/팬/alt는 비개입(선택/이동 보존, DraggingPlugin 충돌 가드).
- Public API: `getRegionAtPoint`/`focusRegion`/`clearFocus`/`getFocusedRegion`. `getRegionAtX`는 `@deprecated`.
- **저장오염 근원 해소**: 가이드/라벨/포커스 오버레이에 `excludeFromExport:true`(재로드 시 중복·유령 객체 방지).
- 라이브 검증: /embed 재현 — 앞표지/뒷표지 클릭 시 해당 영역 하이라이트·전환 확인. canvas-core 214 테스트 통과.
- ※줌(viewport)·S1 사이드바 버튼·S4 신규객체 강제앵커링은 후속(리스크 격리).

### 19.9 잔여 (P1 XL — 설계·적대적검증 완료, 구현 대기)
- **내지 PDF 표시전용 임포지션**(제품결정: 표시전용·편집 미반영): 첨부 내지 PDF를 내지 캔버스에 `excludeFromExport:true` 잠금배경(가이드)으로 표시(최종 인쇄는 원본 그대로). 워커 GS 다중페이지 래스터(또는 클라 pdfjs) + 게스트 인증·타임아웃·N페이지 메모리 가드 필요.

### 19.10 핵심 파일 매핑
| 영역 | 파일 |
|---|---|
| 스냅샷 직렬화 | `apps/editor/src/utils/buildSpreadSnapshots.ts`, `embed.tsx`(완료), `hooks/useWorkSave.ts` |
| 영역 클릭 포커싱 | `packages/canvas-core/src/plugins/SpreadPlugin.ts` (`handleRegionClick`/`getRegionAtPoint`/`focusRegion`/`renderFocusOverlay`) |
| 책등→총폭 재계산 | `apps/editor/src/stores/useSettingsStore.ts` (`updateSpreadSpineWidth`) |
| 스냅샷/권위 검증 | `apps/api/src/edit-sessions/edit-sessions.service.ts` (`validateSpreadSnapshot`, `compareSpreadWithTemplateAuthority`) |
| cover MediaBox 검증 + separate 강제 | `apps/api/src/worker-jobs/worker-jobs.service.ts` (`createComposeMixedJob`), `apps/worker/src/processors/synthesis.processor.ts` (`validateSpreadCoverSize`) |
| 제본 페이지 가드 | `apps/editor/src/stores/useEditorStore.ts`, `hooks/useEditorContents.ts`, `components/PagePanel/SpreadPagePanel.tsx` |
| 공용 타입/공식 | `packages/types/src/index.ts` (`computeSpreadDimensions`, `validateSpreadAgainstAuthority`, `SPINE_FORMULA_VERSION`, `BINDING_CONSTRAINTS`, `SpreadSnapshot`/`SpineSnapshot`/`SpreadValidationResult`) |
| woff2ToTtf | `apps/api/src/library/` (`POST /library/woff2ToTtf`), `packages/canvas-core/src/plugins/FontPlugin.ts` |
| 운영 플래그 | `SPREAD_SNAPSHOT_HARD_FAIL` (`.env` → `docker-compose.yml` api·worker 매핑) |

## §20 외부 사진 주입(공유방 갤러리 탭) + 캔버스 핀치줌 — ShareSnap 연동 신규 기능 (2026-06-12 구현·검증 완료)

> 배경: 두 번째 외부 사이트 ShareSnap(공유방 사진 → 하드커버 포토북) 연동. 연동 자체는 기존 멀티사이트(/embed + shop-session) 구조로 코드 변경 0이나, 플랫폼 기능 2건이 신규 필요. 정본: `../.cursor/plans/HANDOFF_sharesnap_integration_2026-06-12.md` §6.
> **둘 다 범용 플랫폼 기능** — sharesnap 전용 분기 없음. 단일 코드베이스·단일 배포가 전 사이트 공통 대응.

### 20.0 구현 현황 (2026-06-12)
| 항목 | 상태 | 핵심 파일 |
|---|---|---|
| D1 사진 주입 | ✅ 구현 + 로컬 검증 (탭 렌더·1-tap 추가·80% 맞춤 스케일·사용됨 뱃지·안쓴사진 필터·목록 없으면 탭 미표시 회귀 확인) | `packages/types`(ExternalPhoto), `apps/editor/src/stores/useExternalPhotosStore.ts`, `tools/AppImage.tsx`, `embed.tsx`(3-A'), `canvas-core utils/canvas.ts`(extendFabricOption +externalPhotoUrl) |
| D2 핀치줌 | ✅ 구현 + 합성 PointerEvent 검증 (핀치아웃 1→3.0·핀치인 1→0.33 정확, selection/skipTargetFind 복원) | `packages/canvas-core/src/plugins/WorkspacePlugin.ts` (`bindPinch`) |

### 20.1 D1 — 외부 사진 주입 (공유방 갤러리 탭)

**문제**: 이미지 패널(`tools/AppImage.tsx` + `stores/useImageStore.ts`)은 로컬 파일 업로드 전용. 공유방 사진은 **타 참여자가 올린 것**이라 고객 기기에 없음 → 로컬 업로드로는 연동 목적 자체가 성립 불가.

**계약 (호스트 ↔ 편집기)**:
- 호스트 서버가 세션 생성/PATCH 시 `metadata.externalPhotos: [{ url, name, thumbnailUrl? }]` 주입.
- 편집기는 목록이 **있으면** 이미지 패널에 `[공유방 사진]` 탭 렌더, **없으면** 탭 자체 미표시 → 기존 사이트(bookmoa) 영향 0.
- 기존 로컬 업로드는 `[내 업로드]` 탭으로 병존 (공유방에 없는 사진 추가용 보조 — 신규 개발 0).

**UX (A안 확정 근거 — 2026-06-12 검토)**:
- 탭하면 즉시 캔버스 추가 (현행 '나의 콘텐츠' 1-tap 인터랙션과 동일, 학습비용 0). 일괄 자동배치는 D3(별도 기획) 영역.
- **사용됨 체크 뱃지**: 어느 페이지든 배치된 사진에 표시 + "안 쓴 사진" 필터 칩 — 포토북 편집의 핵심 질문("뭘 아직 안 썼지?") 대응.
- 정렬 칩: 시간순 / 올린사람 / 안 쓴 사진. 썸네일 lazy-load.
- 렌더 엔진은 기존 `imageFromURL` 경로 재사용(내지 PDF 가이드가 이미 사용 중) — 신규 개발은 노출 표면(메타데이터 계약 + 패널 탭).

**인쇄 해상도 정책 (호스트 의무)**: PDF는 브라우저에서 생성(§16, 300dpi)되므로 캔버스 이미지 = 인쇄 품질. 원본(12MP)은 모바일 메모리 크래시(기존 4MB 가드와 동일 사유), 과축소는 300dpi 미달 → **호스트가 업로드 시점에 인쇄용 리사이즈본(긴변 3000~4000px, JPEG ~2-3MB)을 사전 생성**해 `url`로 제공, `thumbnailUrl`은 ~300px. signed URL 등 만료 URL 금지(재편집 시 동일 URL 재로드).

**CORS**: 사진 호스트(예: Supabase Storage)가 editor origin 허용 필요.

### 20.2 D2 — 캔버스 핀치-투-줌

- 기존 상태: `MOBILE_TOUCH_UI.md` "알려진 한계" — viewport `user-scalable=no` 로 시스템 핀치는 차단, 캔버스 자체 핀치 제스처 미구현.
- 설계: Fabric `touch:gesture` 또는 pointer events 2지 추적 → `canvas.zoomToPoint`. 캔버스 컨테이너 `touch-action: none` 기반이라 브라우저 제스처 충돌 없음. WorkspacePlugin 줌 API 재사용.
- **전 사이트 공통 모바일 개선** (bookmoa 카톡 인앱 사용자 즉시 혜택) — D1보다 선행 착수 권장.

### 20.3 보류/대기 항목
- **D3 자동배치(사진+코멘트 자동편집)**: 표준 계약 밖. 템플릿셋 등록 시 '편집 모드' 설정 방식으로 오너 기획 후 논의·결정 (착수 보류).
- **표지 모델**: ShareSnap 상품 = 하드커버 포토북 픽스 + 표지 스프레드(뒤+책등+앞 단일 캔버스) 수용 방향 — D3 기획과 함께 오너가 정리 예정.
- **브라우저 PDF 생성 타임아웃 리스크**: 24p/180초 실측 이력 → sharesnap 포토북 템플릿셋 `pageCountRange` 상한(≤24~32p) 정책으로 단기 대응. 워커 서버렌더 이관은 별도 대형 프로젝트.

---

## §21 상품 프로파일 모드 — 캘린더 P1(운영 반영) · 런처 진입 P2-b · 시트 맵 P2-c · 사진인화 P2-d (2026-10-17~20)

> 정본: 계약 [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) v1.21~v1.25 헤더 노트와 §1-B·§1-D 행 · 운영 반영/배포 절차 [`DEPLOYMENT.md`](./DEPLOYMENT.md) 「P1 캘린더 운영 반영 절차」「P2-b 런처(파트너 v1 `sessions`)…배포 절차(준비)」「P2-c 시트 맵 출력…배포 절차(준비)」 · 설계 [`PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md`](./PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md) · P2 계획 [`P2_PRODUCT_MODE_PLAN_2026-10-18.md`](./P2_PRODUCT_MODE_PLAN_2026-10-18.md) · 템플릿셋 등록 [`템플릿등록 매뉴얼.md`](./템플릿등록%20매뉴얼.md) 부록 D.
> 비즈니스 로직(면 순서·옵션 어휘 등)은 오너 결정이 정본이며 여기서는 현재 코드가 하는 일만 적는다.

### 21.0 반영 상태 (2026-10-20 기준)

> 행 번호 주의: §21.1~§21.6 의 `file:line` 은 커밋 `9be4c37c`(2026-10-19 작성) 기준이고 §21.8 은 P2-d 작업 트리 기준이다 — P2-d 편집으로 `utils/productProfile.ts`·`embed.tsx`·`hooks/useEditorContents.ts`·`stores/useImageStore.ts` 등의 행이 이동했다(예: `applyTemplateSetProductProfile()` :42 → :64, `resolveFixedCanvasCount()` :30 → :52).

| 항목 | 커밋 | 상태 |
|---|---|---|
| **P1 캘린더** — 프로파일 모드·CalendarPlugin·패널·세션 `metadata.calendar`·완료 PDF 옵션·도련 정책 A·임시공휴일 고객 선택 | `1a0d80e3` → `0c670adc` → `52563190` → `af900212` | **운영 반영 완료 2026-10-18 00:48 KST** — master `af900212`(이후 문서 커밋 `49587f4e`), VPS api `1f175ce9a99b`·worker `df1f28f153ac`, `[FLAGS-CHECK] api ok n=15`, Vercel editor/admin Ready. 운영 샘플 세트 7종 등록은 오너 보류 |
| **P2-a 시트 맵 기반 + P2-b 편집 세션 런처**(api·sdk, 편집기는 신규 세션 메타 복원 1건) | `f43cb99e` | 브랜치 `p1-calendar-2026-10-17` 만 — **master 미병합·운영 미반영**(로컬 e2e 통과) |
| **P2-c 시트 맵 출력**(worker `sheet-map` 모드·완료 시 자동 발행) | `9be4c37c` | 브랜치만 — master 미병합·운영 미반영. **편집기 코드 변경 없음** |
| **P2-d 사진인화**(types·canvas-core `PhotoPrintPlugin`·편집기 메뉴/패널/스토어·세션 `metadata.items`·완료 `items`·api 시트 주입/deliverables·SDK·admin 프리셋 4종) | **미커밋** — 브랜치 `p1-calendar-2026-10-17` HEAD `9be4c37c` 위 작업 트리 | 브랜치 작업 트리만 — **master 미병합·운영 미반영**. 적대 리뷰 36건·로컬 e2e 결함 D1~D9 수정 반영, 전체 테스트 통과(2026-10-20). 운영 샘플 세트 등록은 오너 보류 — §21.8 |

프로파일 NULL 세트(현행 전 세트)에서는 이 절 전체가 no-op 다 — 템플릿셋 응답·세션 metadata·완료 payload·검증 잡 옵션·PDF 바이트가 종전과 같다(CONTRACT_FREEZE v1.22 "미전송/NULL = 현행 동작").

### 21.1 상품 프로파일 모드 — `productProfile` 이 편집 모드를 정한다

템플릿셋 `productProfile`(JSON, `@storige/types` `ProductProfile` version 1, kind `'sheet'|'calendar'|'photo-print'` — `'photo-print'` 는 P2-d 브랜치·미커밋, §21.8)이 편집 모드의 단일 소스다. `TemplateSetType`·`EditorMode`·`PdfOutputMode` enum 은 바뀌지 않았다. 편집기 치환 지점은 전부 `if (profile)` 가드다.

| 지점 | 파일 | 동작 |
|---|---|---|
| 판정 → 스토어 | `apps/editor/src/utils/productProfile.ts` `applyTemplateSetProductProfile()`(:64) → `stores/useSettingsStore.ts` `productProfile`(:305, `setProductProfile` :887) + `stores/useCalendarStore.ts` `setFromProfile()` | `resolveProductProfile()` 결과가 null(NULL·검증 실패)이면 두 스토어 모두 reset → 기존 경로 |
| 로드 배선 | `hooks/useEditorContents.ts:1079-1081` | `loadTemplateSetEditor` 1-B 단계에서 적용. `resolveFixedCanvasCount()`(`productProfile.ts:30`)가 `pages.kind==='fixed'` 면 고정 캔버스 수 |
| fixed 캔버스 가드 | `useEditorContents.ts:1151-1154`, `:1221-1231` | 호스트 `pageCount` 는 경고 후 **무시**(세트 구성이 정답). `settings.page.min=max=count` 로 SidePanel 추가/삭제 게이트(호스트 한도보다 프로파일 우선). 연결 템플릿 수 ≠ count 면 경고만 하고 진입은 계속 |
| 그리드 rehydrate | `useEditorContents.ts:511`, `:1503` → `utils/calendarRehydrate.ts` `rehydrateCalendarGrids(editor, canvas, index)` | 캔버스 로드·페이지 전환마다 호출. 프로파일 null 이면 즉시 0(no-op) |
| 페이지 라벨 | `productProfile.ts` `makeCalendarLabelResolver()`(:74) → `components/PageNavigation/BookNavigation.tsx:237-238`(`buildPageMeta` 의 `labelResolver` 옵션 :132) | kind=calendar 면 표지·N월 앞면/뒷면(2단 벽걸이 상단/하단)·에필로그 라벨. resolver 없으면 기존 라벨 불변(`buildPageMeta.test.ts`) |
| ToolBar 달력 메뉴 | `components/editor/ToolBar.tsx:55`(`ALL_MENUS` CALENDAR), `:76`(`isCalendarProduct`), `:141-147` · `packages/types/src/index.ts:1987`(`EDITOR_MENU_DEFS` CALENDAR `defaultEnabled:false`, `requiresFlag:'CALENDAR'`) | 관리자 editMode 는 항상 노출(템플릿에 그리드를 배치하는 저작 도구). 고객은 `productProfile.kind==='calendar'` 세트에서만 + `enabledMenus` 화이트리스트 존중(배열에 CALENDAR 없으면 숨김, null 이면 노출). legacy 세트는 화이트리스트와 무관하게 숨김 |
| 완료 PDF 판형·옵션 | `productProfile.ts` `resolveProfilePdfRequestSize()`(:89-97) · `resolveProfilePdfExportOptions()`(:104-109) | §21.3 |
| 완료 payload `product` | `embed.tsx:732` `productResultFields()` → `summarizeProductProfile()`(`packages/types/src/product-profile.ts:532-541`) | `editor.complete`·레거시 `storige:completed` 에 `product{kind, editorType, canvasCount, sheetCount, faces}` — `sheetCount` 는 faces 2 면 `ceil(canvasCount/2)`. NULL 세트는 키 없음(payload 바이트 동일). 게스트 완료(`needsAuth`) 경로는 싣지 않음(CONTRACT v1.22 행) |
| 서버 검증 기대치 | `apps/api/src/edit-sessions/sheet-validation-rules.ts:20-21`, `:60` | 기대 쪽수 = **템플릿셋 프로파일** `pages.count`(관리자 선언이 권위), `sheet.faces===2` → `pageStep 2`, cover 슬롯 `coverSpine:'none'`. 세션 `metadata.productProfile` 스냅샷은 세트에 프로파일이 없을 때만 참조(클라이언트 metadata 는 권위가 아님) |

### 21.2 캘린더 모드 (P1 — 운영 반영 2026-10-18)

- **캔버스 구성**: 26캔버스 고정 = 표지 1 + 12개월×2면(앞면/뒷면, 2단 벽걸이는 상단/하단) + 에필로그 1. 캔버스 순서 = PDF 쪽 순서(홀수 = 시트 앞면, 짝수 = 뒷면, `pairing:'offset-next'` — 시트1 = (표지, 1월 앞) … 시트13 = (12월 뒤, 에필로그)). 상품 7종·판형·프로파일 필드·템플릿 4개로 26 참조 구성은 템플릿등록 매뉴얼 부록 D-1~D-3.
- **CalendarPlugin** (`packages/canvas-core/src/plugins/CalendarPlugin.ts`): 날짜 그리드 객체 `extensionType:'calendar-grid'`(:85)를 그룹 1개로 생성(`createGrid` :181)하고, `rehydrate(ctx)`(:210)가 캔버스의 모든 그리드를 **제자리에서 다시 그린다**(id·위치·크기·각도·잠금·z-order 유지, 사진·텍스트 보존). 월은 `extension.monthOffset`(시작연월 기준 0~11) 또는 캔버스 위치 + `monthDelta`(:141-143, 미니 달력 -1/+1). lifecycle 훅에 의존하지 않고 편집기가 명시 호출한다(:15). 등록은 `apps/editor/src/utils/createCanvas.ts:402-408`·`:476-478`(FontPlugin **뒤**, `VITE_ENABLE_CALENDAR !== 'false'` 일 때만). `hitTestDate`(:252) 로 날짜칸 더블클릭 → 기념일 추가(`components/calendar/useCalendarGridDblClick.ts`). 관리자 그리드 배치 도구는 `components/calendar/CalendarGridTools.tsx`(editMode 전용 — 「날짜 그리드 추가(월)」「미니 달력 추가(전월·익월)」).
- **패널** (`components/calendar/CalendarPanel.tsx`, FeatureSidebar 의 CALENDAR 메뉴):
  1. 시작연월(`StartMonthSection` :170) — 프로파일 `allowedRange` 밖이면 `useCalendarStore.setStartMonth` 가 false 를 돌려주고 상태를 바꾸지 않는다.
  2. 표기 옵션(`DisplayOptionsSection` :216-245) — 체크박스 4종 **공휴일 · 임시공휴일·선거일 표시(공표분)(`TEMPORARY_HOLIDAYS_LABEL` :41) · 음력 · 24절기**, 렌더는 `checked={show[key] ?? false}`. 초기값은 프로파일 `calendar.show`(`useCalendarStore.setFromProfile` :61-80 — admin 캘린더 프리셋 7종은 `holidays·lunar·solarTerms: true`, `apps/admin/src/pages/TemplateSets/calendarProfilePresets.ts:47`). `temporaryHolidays` 는 프로파일·저장분에 키가 없으면 **해제(false)** 가 기본이다.
  3. 기념일(`AnniversarySection` :259) — 양력/음력(윤달, 음력 데이터가 있을 때만 활성), 문구 최대 40자·세션당 400개(`utils/calendarRehydrateAll.ts` `ANNIVERSARY_TEXT_MAX`/`ANNIVERSARY_MAX_COUNT`).
  값이 바뀔 때마다 `rehydrateAllCalendarGrids()` 가 전 캔버스를 순서대로 다시 그리고 1개 이상 그렸으면 `useSaveStore.markDirty()`(자동저장 트리거).
- **날짜 데이터 `kr-2025-2035-v1`** (`packages/canvas-core/src/calendar/data/kr-2025-2035-v1.ts`, 버전 등록 `@storige/types` `CALENDAR_DATA_VERSIONS`·`DEFAULT_CALENDAR_DATA_VERSION` `product-profile.ts:158-165`): 기본은 **법정 공휴일(규정상 공휴일 + 대체공휴일)만** 휴일로 칠한다. 임시공휴일·선거일(데이터 `temporary:true`)은 `includeTemporaryHolidays` 가 true 일 때만 휴일(`calendar/core.ts:208-211`, `:239` — 오너 결정 2026-10-17, 고객이 패널에서 선택). 세션은 `dataVersion` 을 고정 저장하므로 데이터 갱신이 기존 세션을 바꾸지 않는다(갱신 절차 부록 D-8, 2028년 이후는 KASI 공표 전 산출값).
- **세션 `metadata.calendar` 저장·복원** (`utils/calendarRehydrateAll.ts`): `calendarSessionMetadataFields()` 가 자동저장·save·complete 의 세션 PATCH 에 `{ metadata: { productProfile, calendar{startYear, startMonth, show, anniversaries, dataVersion} } }` 를 동봉한다(API 얕은 병합, 캘린더 세트가 아니면 `{}` 라 payload 키 집합 불변). 재오픈은 `restoreCalendarSessionMeta()`(`readCalendarSessionMeta()` 판독 — `startYear/startMonth` 정수·월 1~12·`anniversaries` 배열일 때만 유효, `show`·`dataVersion` 누락은 프로파일 기본값으로 보충)를 **캔버스 복원 전**에 호출한다(`embed.tsx:1783`). **신규 세션(canvasData 없음)도 복원**한다 — `embed.tsx:1887-1893` "캘린더 세션 메타 복원(신규 세션, canvasData 없음)" 분기: 복원 뒤 `rehydrateAllCalendarGrids()` 로 템플릿 로드 시 그려진 그리드를 저장 메타로 다시 그린다(P2-b, 런처가 `calendar.startYm` 으로 선생성한 세션용 — **브랜치만**, §21.4). 메타가 없거나 무효면 false 라 종전 경로(프로파일 기본 시작연월).
- **자동저장 수집기** (`hooks/useEmbedAutoSave.ts:113-131` `collectCanvasData`): 캔버스 하나라도 `toJSON` 에 실패하면 `CANVAS_SERIALIZE_FAILED:<index>` 를 던져 **그 저장을 통째로 중단**(dirty 유지·재시도, Sentry `[embed-autosave] canvas toJSON failed`). 종전에는 실패 캔버스를 조용히 빼고 짧은 배열을 저장해 쪽 순서가 밀린 세션이 서버에 남았다(2026-10-17 실측: 26캔버스가 24장으로 저장). 커밋 `0c670adc`.
- **템플릿 로드 시 텍스트 `styles` 보정** (`packages/canvas-core/src/utils/canvas.ts:1045` `core.ensureTextStyles`): fabric 5.5 `fromObject` 가 `styles` 를 undefined 로 전파해 이후 `toObject`(저장·PDF·썸네일)가 크래시하던 것을 로드 직후(`loadFromJSON` :1154)와 직렬화 직전(`toJSON` :1168, `ServicePlugin.ts:370`·`:534`)에 빈 객체로 보정한다. 그룹 자식(캘린더 그리드·사용자 그룹) 텍스트도 같은 보정. 같은 커밋 `0c670adc`.

### 21.3 완료 PDF (프로파일 세트)

단일 모드 완료 경로(`apps/editor/src/embed.tsx:2850-2921`)가 프로파일 세트에서 아래처럼 동작한다. 스프레드 책(`isSpreadBook`)과 프로파일 NULL 세트는 종전 그대로.

| 항목 | 동작 | 근거 |
|---|---|---|
| 산출 | 전 캔버스를 **N쪽 단일 PDF**(쪽 순서 = 캔버스 순서)로 생성해 **cover 슬롯**(`coverFileId`)으로 업로드(`mode==='content'` 만 `contentFileId`). 1캔버스·spine/wing 혼재(크기 상이)·길이 불일치면 현재 캔버스 1장으로 폴백 | `selectSingleModePdfCanvases` :2866-2871, 업로드 :2905-2921 |
| 판형 | 호스트가 `size` 를 보내지 않으면 A4 폴백 대신 **템플릿셋 판형**(프로파일 세트만). 보낸 `size` 는 종전 G-E 규칙(W↔H 스왑 정규화)대로 | `resolveProfilePdfRequestSize()` :2860, `productProfile.ts:89-97` |
| 도련 | 템플릿셋 `cropMarkEnabled && bleedMm>0`(`settings.printMarkConfig`, `useEditorContents.ts:1089`) 게이트가 켜지면 작업사이즈 = 재단 + bleedMm×2(캘린더 샘플 `bleedMm 3` → 재단+6mm)·코너 마커·**TrimBox = 재단**, BleedBox/MediaBox = 작업사이즈. 게이트 OFF 면 재단 크기 그대로(책자와 같은 게이트, 오너 도련 정책 A) | `embed.tsx:2688-2697`, `ServicePlugin.ts:834`·`:1228-1233`·`:1419-1426` |
| export 옵션 3종 | `omitUnusedFonts`(jsPDF `putOnlyUsedFonts` — 미사용 표준 14폰트를 폰트 딕셔너리에 싣지 않음) · `excludeWorkspaceFromExport`(워크스페이스 rect 를 SVG 에서 제외, clipPath 역할 유지) · `neutralizeTransparentFills`(`'transparent'` fill/stroke → SVG `none`, `/ca 0` ExtGState 생성 방지). **프로파일 세트에만** 전달하고 NULL 세트는 undefined = 종전 바이트 동일 | `PdfExportOptions` `packages/canvas-core/src/plugins/ServicePlugin.ts:16-34`, `saveMultiPagePDFAsBlob(…, exportOptions)` :340-353, `resolveProfilePdfExportOptions()` `embed.tsx:2890` |
| DPI·워치독 | 300dpi, 워치독 `max(120s, 15s × 캔버스 수)`, 자동저장 일시정지(`runWithAutosaveSuspended`) | `embed.tsx:2891-2898` |
| 텍스트 | 폰트 라이브러리에 템플릿 폰트(샘플: `본고딕(Noto Sans) Regular`)가 있어야 **벡터화**된다. 없으면 래스터 폴백 → 워커 `TRANSPARENCY_DETECTED` | DEPLOYMENT 「P1 캘린더 운영 반영 절차」 확인 항목 |
| 서버 검증 잡 | cover 잡 `orderOptions.coverSpine='none'`(binding 무관 단일 판형 검사 `validatePageSize`/`validateBleed`, `validateSpine` 생략)·기대 쪽수 = 프로파일 `pages.count`(26)·`pageStep 2`·`productKind='sheet'` — 모두 서버 파생, 호스트 설정 불요. 킬스위치 `EDITOR_SHEET_VALIDATION_RULES` | CONTRACT_FREEZE v1.21·v1.22 보강 §1-B 행, `sheet-validation-rules.ts` |
| 후속 합성(서버) | 편집기 산출은 그대로 두고 서버가 세트별로 분기한다. 템플릿셋 `pdfOutputMode='duplex-split'` → 13세트 분리(현행 worker). 프로파일 `output.mode==='sheet-map'` → worker `sheet-map` 잡(`per-sheet` = 시트별 `set` 파일 / `merged-duplex` = 1파일, 킬스위치 `SHEET_MAP_OUTPUT_ENABLED`) — **P2-c, 브랜치만**. 편집기 코드 변경 없음 | CONTRACT_FREEZE v1.24 §1-B 행, DEPLOYMENT 「P2-c …」 |

로컬 실측(2026-10-17, DEPLOYMENT 기록): 캘린더 샘플 완료 1건 → 워커 `isValid: true`·경고 0, PDF 26쪽, 탁상 라지 271×196mm(재단 265×190 + 6), TrimBox 3mm 안쪽, `pdffonts` 빈 목록, 투명도 없음.

### 21.4 임베드 진입 방식 2가지

| 경로 | 호스트 쪽 | 편집기 진입 | 상태 |
|---|---|---|---|
| ① 기존 shop-session | `/auth/shop-session` 토큰 + `templateSetId`(+`orderSeqno`·`mode` — 세션 생성 조건. 캘린더 세트는 `pageCount` 를 보내도 무시) | §14.1 `/embed?templateSetId&token&orderSeqno&…&parentOrigin` → 편집기가 `POST /edit-sessions` 로 세션을 만든다 | 운영 |
| ② 파트너 v1 런처(P2-b) | 사이트 **editor 키**로 `POST /api/v1/sessions/launch`(body `member{seqno,id,name}`·`templateSetId`·`orderSeqno?`·`mode?`·`callbackUrl?`·`orderOptions?`·`items?`·`calendar?{startYm:'YYYY-MM'}`·`externalPhotos?`) → 201 `embed{sessionId, token, refreshToken, orderSeqno?}`. 세션을 **선생성**하고 shop-session 과 같은 세션 토큰(access 3600초 + refresh)을 돌려준다 | FROZEN 파라미터 그대로 `/embed?sessionId&token&refreshToken&parentOrigin` — **신규 URL 파라미터 0**. 편집기는 canvasData 없는 세션을 열고 `metadata.calendar`(launch `calendar.startYm` 을 api 가 `startYear/startMonth`(+`anniversaries:[]`)로 풀어 기록 — `apps/api/src/partner-sessions/partner-sessions.service.ts:198`·`:516-519`)를 복원해 그리드를 다시 그린다(`embed.tsx:1887-1893`) | 브랜치 `p1-calendar-2026-10-17`(`f43cb99e`)만 — **master 미병합·운영 미반영**. 운영 반영 전에는 3라우트 404 |

- 산출물은 `GET /api/v1/sessions/:id/deliverables`(`status: editing → complete → synthesizing → ready | failed`, `product`·`calendar{startYm,dataVersion}`·`files[{role, url, auth:'api-key'|'signed'(300초)}]`), 재합성은 `POST /api/v1/sessions/:id/synthesize`(`revision` +1; `duplex-split` 세트, v1.24 부터 `sheet-map` 세트도) — 계약·오류 코드(`ERR_SESSION_NOT_COMPLETE` 409·`ERR_OUTPUT_MODE_UNSUPPORTED` 422)는 CONTRACT_FREEZE v1.23/v1.24 §1-D 행, 배포 절차·킬스위치 `PARTNER_SESSION_LAUNCH_ENABLED`(FLAGS 16번째 키)는 DEPLOYMENT 「P2-b …」. 호스트용 가이드 절은 PLATFORM_INTEGRATION_GUIDE 반영 대기(초안은 비공개 노트).
- 두 경로 모두 `editor.complete`(+`product` 키)·자동저장·`metadata.calendar` 동봉·완료 PDF 경로(§21.3)는 같다. 런처를 쓰지 않는 호스트는 아무것도 바꾸지 않는다.

### 21.5 로컬 개발 메모

- `VITE_ENABLE_CALENDAR`(editor 빌드 변수, `apps/editor/.env.example:13`): 미설정·`'false'` 외 모든 값 = **on**. 정확히 `'false'` 면 CalendarPlugin 등록(`utils/createCanvas.ts:53`)과 도구 막대 달력 메뉴(`ToolBar.tsx:37`)를 끈다(프로파일 NULL 세트는 값과 무관하게 현행). 빌드 시점 변수라 값을 바꾸면 master push(Vercel 재빌드) 뒤 반영(DEPLOYMENT 환경 변수 표).
- canvas-core vitest(`canvas` 네이티브 모듈, fabric node 엔트리)는 **Node 24** 로 실행한다. Node 26 에서는 수집 단계에서 실패한다(`packages/canvas-core/vitest.setup.ts` 처방). api jest 일부 스위트(`better-sqlite3`)는 빌드된 Node 로.
- compose 서비스 이름 `mariadb`(클라이언트 `mariadb`·`mariadb-admin`·`mariadb-dump`), dev 로그 pino-pretty 미설치 시 JSON 폴백, worker `.env.development.example`, `BOOKMOA_DB_PASSWORD=` 로 bookmoa 연동 끄기 등 자세한 것은 [`DEPLOYMENT.md`](./DEPLOYMENT.md) **「5. 로컬 기동 시 알아둘 점 (2026-10-17)」**.
- 런처 로컬 e2e 전제(로컬 사이트 editor 코드를 worker 코드와 분리하지 않으면 런처 403, worker-local `WORKER_API_KEY`·`OUTPUTS_PATH`, `OUTPUT_SIGN_SECRET` 없으면 완료 잡 deliverables 503)는 P2 계획 §7.

### 21.6 핵심 파일 매핑

| 영역 | 파일 |
|---|---|
| 프로파일 타입·검증·요약 | `packages/types/src/product-profile.ts` (`ProductProfile`, `CalendarProfile`, `CalendarSessionMeta`, `CalendarDisplayOptions`, `CALENDAR_DATA_VERSIONS`, `resolveProductProfile`, `summarizeProductProfile`) |
| 편집기 프로파일 배선 | `apps/editor/src/utils/productProfile.ts` (`applyTemplateSetProductProfile`, `resolveFixedCanvasCount`, `resolveCanvasMonthOffset`, `makeCalendarLabelResolver`, `resolveProfilePdfRequestSize`, `resolveProfilePdfExportOptions`) |
| 스토어 | `apps/editor/src/stores/useSettingsStore.ts` (`productProfile`), `stores/useCalendarStore.ts` (`meta`, `allowedRange`, `setFromProfile`, `restore`, `setStartMonth`, `setShow`, 기념일 CRUD) |
| 템플릿셋 로드·fixed 가드·rehydrate 호출 | `apps/editor/src/hooks/useEditorContents.ts` (1-B 단계, `:1151`, `:1221`, `:511`, `:1503`) |
| 그리드 재합성 | `apps/editor/src/utils/calendarRehydrate.ts` (캔버스 1개), `utils/calendarRehydrateAll.ts` (전체 + 세션 메타 판독/복원/동봉) |
| CalendarPlugin·날짜 계산·데이터 | `packages/canvas-core/src/plugins/CalendarPlugin.ts`, `src/calendar/core.ts` (`buildMonthMatrix`), `src/calendar/types.ts`, `src/calendar/data/kr-2025-2035-v1.ts` (생성물 — `packages/canvas-core/scripts/calendar-overrides.json` → `gen:calendar-data`) |
| 패널·그리드 도구 | `apps/editor/src/components/calendar/CalendarPanel.tsx`, `CalendarGridTools.tsx`(editMode), `useCalendarGridDblClick.ts`, `calendarPanelUtils.ts` |
| 페이지 라벨 | `apps/editor/src/components/PageNavigation/BookNavigation.tsx` (`labelResolver`), `buildPageMeta.test.ts` |
| 도구 메뉴 | `apps/editor/src/components/editor/ToolBar.tsx` (CALENDAR 게이트), `packages/types/src/index.ts` (`EDITOR_MENU_DEFS`) |
| 플러그인 등록·빌드 플래그 | `apps/editor/src/utils/createCanvas.ts` (`VITE_ENABLE_CALENDAR`), `apps/editor/.env.example` |
| 완료 PDF·세션 메타 복원·`product` payload | `apps/editor/src/embed.tsx` (`:732`, `:1783`, `:1887-1893`, `:2850-2921`) |
| 자동저장 수집기 | `apps/editor/src/hooks/useEmbedAutoSave.ts` (`collectCanvasData`, `CANVAS_SERIALIZE_FAILED`) |
| PDF export 옵션·도련 게이트 | `packages/canvas-core/src/plugins/ServicePlugin.ts` (`PdfExportOptions`, `_drawCropMarksAndBoxes`), `src/utils/canvas.ts` (`ensureTextStyles`) |
| 서버 검증 규칙 | `apps/api/src/edit-sessions/sheet-validation-rules.ts` (`expectedPages`, `pageStep`, `coverSpine`) |
| 템플릿셋 컬럼·admin 폼 | `apps/api/migrations/20261017_add_template_set_product_profile.sql`, `apps/admin/src/pages/TemplateSets/TemplateSetForm.tsx`(「상품 프로파일(JSON)」 섹션), `calendarProfilePresets.ts`(프리셋 7종) |
| 샘플 세트 등록 | `scripts/register-calendar-samples.mjs` (로컬 `--with-site`, 원격 `--allow-remote` — 운영 실행은 오너 승인) |
| 런처(브랜치만) | `apps/api/src/partner-sessions/` (`launch`·`deliverables`·`synthesize`), `packages/sdk/src/client/sessions.ts` |
| 시트 맵(브랜치만, 편집기 무변경) | `apps/api/src/edit-sessions/sheet-map.ts` (`buildSheetMap`), `apps/worker/src/processors/synthesis.processor.ts` (`handleSheetMapSynthesis`) |

### 21.7 변경 이력 (2026-10-17 ~ 20)

| 날짜 | 커밋 | 내용 | 반영 |
|---|---|---|---|
| 2026-10-17 | `1a0d80e3` | 캘린더 편집 모드 P1 — 템플릿셋 상품 프로파일·날짜 그리드(CalendarPlugin)·26캔버스 양면 달력·패널·세션 `metadata.calendar`·완료 payload `product`·admin 프리셋 | master → **운영 2026-10-18 00:48 KST** |
| 2026-10-17 | `0c670adc` | 자동저장이 직렬화 실패 캔버스를 누락 저장하지 않도록(`CANVAS_SERIALIZE_FAILED`) + 템플릿 로드 `ensureTextStyles` 보정 | 〃 |
| 2026-10-17 | `52563190` | dev 모드 api·worker 부팅 복구(pino-pretty 미설치 JSON 폴백, worker env 예시) | 〃 |
| 2026-10-17 | `af900212` | 완료 PDF 워커 경고 0 — `coverSpine:'none'` 규칙·export 옵션 3종·도련 정책 A(`cropMarkEnabled`+`bleedMm 3`)·임시공휴일·선거일 고객 선택 | 〃 (VPS 체크아웃 커밋) |
| 2026-10-18 | `49587f4e` | DEPLOYMENT·계획 문서 — P1 운영 반영 기록 | master |
| 2026-10-18 | `f43cb99e` | P2-a 시트 맵 기반 + P2-b 편집 세션 런처(`POST /api/v1/sessions/launch`·`GET …/deliverables`·`POST …/synthesize`, SDK `client.sessions`, 웹훅 `revision?`) · 편집기 신규 세션 `metadata.calendar` 복원 · 합성 파일 메타 `GET /files/:id/external`·duplex-split 자동 잡 request_id 결함 수정 | 브랜치 `p1-calendar-2026-10-17` 만 — master 미병합·운영 미반영 |
| 2026-10-19 | `9be4c37c` | P2-c 시트 맵 출력 — worker `sheet-map` 모드, 완료 시 자동 발행(`SHEET_MAP_OUTPUT_ENABLED`), 파트너 v1 재합성·deliverables `sheets` — **편집기 변경 없음** | 브랜치만 — master 미병합·운영 미반영 |
| 2026-10-19 | (미커밋) | P2-d 사진인화 구현 — `ProductKind 'photo-print'`·`photoPrint` 블록·`PhotoItem`(types), `PhotoPrintPlugin`(fitMode/유테/촬영일/흑백), `PHOTO_PRINT` 메뉴·`PhotoPrintPanel`·`usePhotoPrintStore`·세션 `metadata.items`·완료 `items`, api `photo-items.ts`(sheet-map `copies`/`label` 주입)·deliverables `items`·`metadata.productProfile` 서버 소유, SDK `EditorCompleteItem`·`SessionDeliverablesItem`, admin 프리셋 4종·`register-photo-print-samples.mjs`, CONTRACT_FREEZE v1.25 | 브랜치 `p1-calendar-2026-10-17` 작업 트리(HEAD `9be4c37c` 위) — **미커밋·master 미병합·운영 미반영** |
| 2026-10-19~20 | (미커밋) | P2-d 적대 리뷰 36건·로컬 e2e 결함 D1~D9 수정 — 재오픈 캔버스 유실(D1)·런처 `items` 탈락(D2)·유테 창 재단 기준 `bleedPx`(D3)·촬영일 로컬 날짜(D4)·undo/삭제 뒤 `apply` 재호출(D5)·editMode 잠금 해제(D6)·SDK export(D7)·cover 창 기준 max(D8)·chemical 검증 `bleed 0`(D9), 업로드 한도 경로 보강·`items` 상한·`metadata.productProfile` 서버 소유·시트 맵 실패 노출 | 〃 — 전체 테스트 통과(2026-10-20 13:51 KST(04:51Z, 로그 기준)), 수정 후 로컬 e2e 재실측 통과(2026-10-20 14:05 KST — 21.8 '재실측 결과') |

다음(P2-e 운영자 콘솔)은 미착수 — P2 계획 §1. P2-d 사진인화는 §21.8(브랜치 작업 트리, 미커밋).

### 21.8 사진인화 모드 (P2-d — 브랜치, 미커밋)

> 상태(2026-10-20): 브랜치 `p1-calendar-2026-10-17` HEAD `9be4c37c` 위 **미커밋 작업 트리** — master 미병합·운영 미반영. 운영 샘플 세트 등록·배포는 오너 승인 후. 계약 정본은 [`CONTRACT_FREEZE.md`](./CONTRACT_FREEZE.md) **v1.25** 개정 노트(§1-D ADDITIVE 4건 — `templateSet.productProfile.kind 'photo-print'`+`photoPrint` 블록 / `editor.complete`·`storige:completed` `items?`+`product.kind` / 세션 `metadata.items` / 런처 deliverables `items?`·`files[].copies/label` 원천·`errorCode/errorDetail`, 검증 잡 `orderOptions.bleed 0` + 보정 2건 — `metadata.productProfile` 서버 소유, duplex-split 회차 키·웹훅 `revision?` 자동 sheet-map 잡 포함). 옵션 어휘(페이퍼풀/이미지풀/유테)·판형·도련·업로드 한도 등 비즈니스 값은 오너 결정이 정본이며(설계 §13 항목 3 = "§13-3", `PRODUCT_MODE_ARCHITECTURE_DESIGN_2026-10-16.md:376`(타입 주석)·`:414`(§13 항목 3)), 여기서는 현재 코드가 하는 일만 적는다.
> 프로파일 NULL 세트·캘린더 세트는 이 절 전체가 no-op 다(메뉴·플러그인 옵션·세션 metadata·완료 payload·검증 잡 옵션 바이트 동일 — v1.25 노트).

#### 21.8.1 프로파일 `photoPrint` 블록 · 옵션 매핑(§13-3) · 항목 모델

- **타입 정본** `packages/types/src/product-profile.ts`: `ProductKind` 에 `'photo-print'`(:21), `ProductPageLabelRule` 에 `'photo'`(:24), 어휘 `PhotoPrintProcess 'chemical'|'digital'`·`PhotoPrintComposition 'per-photo-free-back'|'per-photo-fixed-back'|'sheet-cards'`·`PhotoBorder 'none'|'white'`·`PhotoFit 'paper-full'|'image-full'`·`PhotoFinish 'matte'|'glossy'`(:55-62), 상수 `DEFAULT_PHOTO_BORDER_INSET_MM = 2`(:70)·`PHOTO_PRINT_SIZES_PER_PROFILE = 1`(:72). `PhotoPrintProfile { process, composition, sizes: PhotoPrintSize[](P2 는 정확히 1개), options { border[], fit[], finish[], brightnessFix, dateOverlay, grayscale, borderInsetMm? }, copies { min, max }, backTemplateId?, upload { maxPhotos, maxMb } }`(:189-198), `ProductProfile.photoPrint?`(:217).
- **옵션 소비 경계**(:186 주석, `PhotoPrintPanel.tsx:18`): 편집기가 캔버스에 적용하는 것은 `border`·`fit`·`dateOverlay`·`grayscale` 뿐이고 `finish`·`brightnessFix`·`copies` 는 **통과만**(세션 `metadata.items` → 완료 `items` → deliverables `items`; 밝기보정 미리보기 없음).
- **검증 결합**(`validateProductProfile` :512-523 → `validatePhotoPrintBlock` :545-658, 기존 kind 의 메시지 순서를 바꾸지 않도록 마지막에 검사): `kind='photo-print'` ⇒ `photoPrint` 필수(그 밖의 kind 에서는 금지, `labelRule 'photo'` 도 photo-print 전용 :520-523) · `sizes` 정확히 1개(:562) · `options` 어휘는 중복 없는 비어 있지 않은 배열(:584-597) · `copies.min/max` 1 이상 정수·min≤max(:601-603) · `composition='per-photo-fixed-back'` ⇒ `backTemplateId` 필수(:606-609) · `upload.maxPhotos` 1 이상 정수·`maxMb` 양수(:612-614) · `pages.kind='range'` 만·`protectedIndices` 금지(:621-624) · **chemical** ⇒ `sheet.faces 1`(canvas-per-sheet)·`composition 'per-photo-free-back'`·`output.mode 'single-pdf'`(:631-637) · **digital** ⇒ `faces 2`(canvas-pair)·`pairing 'same-sheet'`·`pages.step 2`·`min/max` 짝수(:642-650). `backRotation` 은 강제하지 않는다(오너 결정 0).
- **항목 모델** `PhotoItem`(:278-295, 12필드) = `{ index, canvasIndex, sourcePhotoId?, sizeCode, copies, border, fit, finish, brightnessFix, dateOverlay, grayscale, lowRes }`, 런처 입력은 부분형 `PhotoItemInput`(:299). 순수 함수: `resolvePhotoItemCanvasIndex`(:788, chemical i→i / digital i→2i 앞면), `resolvePhotoItemCount`(:794, ceil(캔버스 수/stride)), `formatPhotoPageLabel`(:800, chemical `'사진 N'` / digital `'사진 N 앞'`·`'사진 N 뒤'`), `resolvePhotoFitMode`(:809), `resolvePhotoFrameInsetMm`(:814), `readPhotoItems(input, profile?, { maxItems? })`(:861-897) — 불량 항목 생략, `copies` 는 1 이상 정수 또는 정수형 문자열만 인정하고 그 밖은 `copies.min`, `[min,max]` 클램프, `sizeCode = sizes[0].code`, `canvasIndex` 재계산, 상한 = `opts.maxItems` → `upload.maxPhotos` → `DEFAULT_PHOTO_ITEMS_LIMIT` 1000(:831).
- **§13-3 매핑**(항목 → `PhotoPrintPlugin` 옵션, `apps/editor/src/utils/photoPrintRehydrate.ts:55-63` `resolvePhotoPrintCanvasOptions`):

| 프로파일 옵션 | 항목 값 | 플러그인 옵션 | 근거 |
|---|---|---|---|
| `fit` | `'paper-full'`(페이퍼풀) / `'image-full'`(이미지풀) | `fitMode 'cover'`(창 기준 `Math.max`) / `'contain'`(`Math.min`) | `resolvePhotoFitMode` `product-profile.ts:809`, `resolveFillScale` `PhotoPrintPlugin.ts:156-160` |
| `border` | `'white'`(유테) / `'none'` | `frameInsetMm = options.borderInsetMm ?? 2` / `0`(창 = 프레임, 종전 바이트 동일) | `resolvePhotoFrameInsetMm` `product-profile.ts:814-818` |
| `dateOverlay` | boolean | `dateOverlay` — 템플릿의 `date-overlay` 텍스트 갱신 | §21.8.2 |
| `grayscale` | boolean | `grayscale` — `Grayscale` 필터 멱등 토글 | §21.8.2 |
| `finish` · `brightnessFix` · `copies` | — | 캔버스 미적용(통과만) | `PhotoPrintPanel.tsx:18` |

- **도구 메뉴** `EditorMenuKey 'PHOTO_PRINT'`(`packages/types/src/index.ts:1953`), `requiresFlag 'PHOTO_PRINT'`(:1968), `EDITOR_MENU_DEFS { key:'PHOTO_PRINT', label:'사진인화', defaultEnabled:false, requiresFlag:'PHOTO_PRINT' }`(:1990) — §7.

#### 21.8.2 `PhotoPrintPlugin` (`packages/canvas-core/src/plugins/PhotoPrintPlugin.ts`)

- **등록** `apps/editor/src/utils/createCanvas.ts:58`(`ENABLE_PHOTO_PRINT = VITE_ENABLE_PHOTO_PRINT !== 'false'`)·`:416` 생성·`:463-465` `editor.use`(FrameInteractionPlugin **뒤**). CalendarPlugin 과 같은 계약 — lifecycle 훅에 의존하지 않고 편집기가 `apply`/`rehydrate` 를 명시 호출한다(:16-17 주석). `events`·`hotkeys` 빈 배열(:296-298).
- **`apply(opts)`**(:341-380) / **`rehydrate(opts)`**(:383-385, `apply` 와 동일) — `opts { fitMode:'cover'|'contain', frameInsetMm, dateOverlay, grayscale, mmToPx, bleedPx? }`(:33-49). 순서: ⓪ 캔버스 런타임 키 `__photoPrintBleedPx` 기록(:350-351) → ① 모든 사진틀(`extensionType 'frame'`)에 `fitMode`/`frameInsetMm` 기록 + 런타임 `__frameInsetPx`·`__frameWindow` 산출(:352-358), 값이 바뀐 틀은 채워진 사진(`fillImage`, `parentLayerId === frame.id`)의 scale·중심을 창에 다시 맞추고(`syncFill` :390-398) 같으면 clip 복제본만 창에 다시 맞춘다(`syncClip` :401-414 — 사용자 adjust 보존, 어긋난 마스크 자가 복구) + 같은 루프에서 그 틀의 Grayscale 토글(:363-367, try/catch 로 틀 단위 격리) → ② 루프가 끝난 뒤 date-overlay 갱신(:371). undo 스택에 기록하지 않는다(`historyProcessing` :343-344·:372-376). 반환값 = 처리한 사진틀 수.
- **직렬화**: 프레임 속성 `fitMode`·`frameInsetMm` 는 `packages/canvas-core/src/utils/canvas.ts:181-182` `extendFabricOption` 에 등재(미등재 = 저장 1회 왕복에 침묵 유실). 런타임 키 `__frameInsetPx`(:72)·`__frameWindow { sx, sy, cx, cy }`(:74)·캔버스 `__photoPrintBleedPx`(:76)는 **비직렬화** — 복원 뒤 `rehydrate` 가 다시 채운다.
- **유테 창 = 재단 기준**(D3, :18-24 주석): `resolveFrameWindow(frame, trim, insetPx)`(:167-185) — `insetPx ≤ 0` 이면 프레임 그대로(종전 동작·바이트 동일); 아니면 (프레임 ∩ trim) 을 각 변 `insetPx` 만큼 축소. trim = `workspace`(id `'workspace'`) bbox 를 `bleedPx` 만큼 안쪽으로 줄인 상자(`resolveFrameWindowFor` :209-224, workspace 없으면 null = 프레임 기준). 교집합이 비거나 inset 이 창의 짧은 변 절반 이상이면 프레임 그대로(`frameInsetScale` {1,1} 규칙 :145-150). `frameWindowTransform`(:188-192) → `{ sx, sy, cx, cy }`. `FrameInteractionPlugin._syncFromFrame`(`FrameInteractionPlugin.ts:166-195`)은 같은 규약으로 드래그 중 clip 복제본을 창에 맞추고, 런타임 키가 없으면(undo 로 틀 재생성) 직렬화된 `frameInsetMm` + 캔버스 bleed 로 창을 다시 계산한다. `bleedPx` 는 편집기가 `resolvePhotoPrintBleedPx(settings.printMarkConfig)`(`photoPrintRehydrate.ts:42-49` — `cropMarkEnabled && bleedMm>0` 이면 `mmToPxDisplay(bleedMm)`, 아니면 0)로 모든 `apply`/`rehydrate` 에 전달한다(:89-93).
- **흑백**(`toggleGrayscale` :438-483): `fabric.Image.filters.Grayscale({ effectType:'photo-print' })` 태그(:454, 상수 `PHOTO_PRINT_EFFECT_TYPE` :70)로 멱등 토글. fabric 은 필터의 커스텀 태그를 직렬화하지 않으므로 `fillImage.extension.grayscale` 에 소유 여부를 함께 기록하고(:462-464, off 면 키 제거 :468-472), 복원 뒤 태그 없는 `Grayscale` 1개를 다시 입양한다(:443-448). undo(`fabric-history _loadHistory`)로 plain 객체가 된 필터는 `fromObject` 로 되살리고 되살릴 수 없는 항목은 경고 후 제외(`reviveFilters` :267-293); `applyFilters` 는 try/catch(:476-481).
- **촬영일**(`updateDateOverlays` :416-436): 템플릿 저작 텍스트 `extensionType:'date-overlay'`(`DATE_OVERLAY_EXTENSION_TYPE` :68)를 `extension.frameId` 로 특정 사진틀에 묶는다(없으면 캔버스의 첫 채워진 틀, :113-115·:423-426). 텍스트 = `formatTakenAt(fillImage.extension.takenAt)`, 사진이 없거나 `dateOverlay` off 면 `''`(:428-429). `formatTakenAt`(:240-254) — ISO 일시(`YYYY-MM-DDTHH:mm…`, 오프셋/Z 무관)는 `new Date(iso)` 의 **브라우저 로컬** 연·월·일을 `'YYYY.MM.DD'` 로(D4: exifr 가 EXIF 로컬시각을 브라우저 TZ Date 로 만들어 UTC ISO 로 저장하므로 UTC 날짜 부분을 읽으면 자정 전후 촬영이 전날로 밀렸다), TZ 없는 `YYYY-MM-DD`·EXIF 원문 `YYYY:MM:DD …` 는 날짜 부분 그대로, 해석 불가면 null.
- **순수 export**(`packages/canvas-core/src/index.ts:47-66`): `PhotoPrintPlugin`, `DATE_OVERLAY_EXTENSION_TYPE`, `PHOTO_PRINT_EFFECT_TYPE`, `FRAME_INSET_PX_RUNTIME_KEY`, `FRAME_WINDOW_RUNTIME_KEY`, `PHOTO_PRINT_BLEED_PX_RUNTIME_KEY`, `frameInsetScale`, `resolveFillScale`, `resolveFrameWindow`, `frameWindowTransform`, `resolveFrameWindowFor`, `formatTakenAt` + 타입 `PhotoFitMode`·`PhotoPrintCanvasOptions`·`FrameBox`·`FrameWindow`·`FillImageExtension`·`DateOverlayExtension`.

#### 21.8.3 편집기 흐름 (`apps/editor`)

| 지점 | 파일 | 동작 |
|---|---|---|
| 판정 → 스토어 | `utils/productProfile.ts` `isPhotoPrintProfile()`(:35) · `applyTemplateSetProductProfile()`(:64-73) → `stores/usePhotoPrintStore.ts` `setFromProfile`(:85-93) | kind 가 `'photo-print'` 가 아니면 스토어 reset(캘린더 스토어와 같은 규약). 스토어 = `profile`(photoPrint 블록)·`mapping`·`items: PhotoItem[]`; `restore(input)`(:94-101, `readPhotoItems`), `syncWithCanvasCount`(:103-114, 캔버스 수 ÷ stride 만큼 늘리거나 자름 — 새 항목은 프로파일 기본값), `setItemOption`(:116-120), `removeItem(photoIndex)`(:126-131, 뒤 항목 index/canvasIndex 재부여), `setItemMeta`(:133-150, `lowRes`·`sourcePhotoId`), `applyAll`(:152-156) |
| 도구 메뉴·패널 | `components/editor/ToolBar.tsx:40`·`:60`·`:83`·`:152-156` · `components/editor/FeatureSidebar.tsx:31`·`:297-299` | `VITE_ENABLE_PHOTO_PRINT` 가 정확히 `'false'` 일 때만 메뉴 off. 관리자 editMode 는 항상 노출, 고객은 `productProfile.kind==='photo-print'` 세트에서만 + `enabledMenus` 화이트리스트 존중(CALENDAR 와 동일 규칙). 패널 = `components/photoPrint/PhotoPrintPanel.tsx` |
| 패널 기능 | `PhotoPrintPanel.tsx` | 항목(사진 N)별 매수 ±(:172-191, `copies.min/max` 에서 버튼 비활성)·유테/맞춤/마감 select(어휘가 1개면 생략, 플래그 정책 false 면 체크박스 생략 :16-17)·촬영일/흑백/밝기보정 토글(:239-267)·`저해상도` 배지(`LOW_RES_BADGE_LABEL` :27, `item.lowRes` :162)·**전체 적용**(:86-110, 현재 캔버스 항목의 옵션을 모든 항목에 복사 — `copies` 제외 :32). 변경마다 `setItemOption` + `markDirty` + `applyPhotoPrintItem(index)`(:126-130, digital 은 앞·뒤 2캔버스 `photoPrintRehydrate.ts:135-147`). 패널이 열릴 때 캔버스 수와 항목 수 동기화(:51-55) |
| 세션 metadata 동봉 | `utils/photoPrintRehydrateAll.ts` `photoPrintSessionMetadataFields()`(:71-75) | 자동저장·save·complete 의 세션 PATCH 에 `{ metadata: { productProfile, items } }`(사진인화 세트가 아니면 `{}` — payload 키 집합 불변). 호출: `embed.tsx:1355`(세션 생성)·`:2461-2464`·`:2528`·`:2558`·`:2708`·`:2742`, `hooks/useEmbedAutoSave.ts:418-421`. `items` 는 `syncWithCanvasCount` 로 캔버스 수와 동기화한 완전형. **`metadata.productProfile` 은 v1.25 부터 서버 소유 키** — 서버가 템플릿셋 프로파일로 (재)기록·제거하므로 편집기가 보낸 값은 무시된다(`apps/api/src/edit-sessions/edit-sessions.service.ts:187`·`:287-313`) |
| 복원 | `restorePhotoPrintSessionItems()`(`photoPrintRehydrateAll.ts:56-61`) → `embed.tsx:1821`(재오픈, **캔버스 복원 전**)·`:1951-1955`(신규/런처 선생성 세션 — restore 뒤 `applyAllPhotoPrint({ markDirty: 복원 여부 })`, items 가 없으면 프로파일 기본값만 적용하고 dirty 로 만들지 않음) · `rehydratePhotoPrint(editor, canvas, i)`(`photoPrintRehydrate.ts:108-114`) | 캔버스 복원마다 저장된 `fitMode`/`frameInsetMm` 로 런타임 창·필터 태그를 되살린다 — 호출 지점 `embed.tsx:1902`(다페이지)·`:1928`(단일), `useEmbedAutoSave.ts:283`(로컬 백업)·`:332`, `hooks/useEditorContents.ts:528`(템플릿 로드)·`:1569`(페이지 추가). 프로파일 null 이면 즉시 0(no-op) |
| 시드 캔버스 수(D1·D2) | `useEditorContents.ts:1179-1200` `resolvePhotoPrintSeedCount()`(`productProfile.ts:178-205`) · `embed.tsx:1664-1669`(`photoItemCount`) | **재오픈** = 저장 `canvasData.length` 그대로(호스트 `pageCount`·한도 무관 — 종전 `length−1` [표지,…내지] 시맨틱으로 마지막 캔버스가 유실되던 결함 D1), **신규/런처 세션** = `metadata.items` 건수 × stride(digital 2 / chemical 1)를 하한으로(D2), 템플릿셋 refs 수 이상·`pages.max` 이하(초과분은 잘라내고 warn). 증설 시드는 `innerRepeat 'cycle'`(refs[k % len], :1251-1256 — `'last'` 는 뒷면만 복제). 심층방어: 단일 모드 range 세트도 저장본보다 적게 시드됐으면 `addPage` 로 증설 뒤 전량 복원(`embed.tsx:1855-1866`) |
| 페이지 범위·단위 | `useEditorContents.ts:1098-1106`·`:1295-1302` · `resolvePhotoPrintPageStep()`(`productProfile.ts:208-224`) | `settings.page.min/max` = 프로파일 `pages.min/max`(캔버스 수 단위, 호스트 한도가 오면 R-196 규칙 우선). 증감 단위는 **프로파일 `pages.step`** 이 템플릿셋·호스트 `pageStep` 보다 우선 — 호스트 값이 다르면 `console.warn` 1회 뒤 무시. 캘린더·sheet·NULL 세트는 종전 값 그대로 |
| 페이지 추가/삭제 = 사진 단위 | `components/editor/SidePanel.tsx:498-521`(추가)·`:523-552`(삭제) · `utils/photoPrintSeed.ts` `seedPhotoPrintCanvas(k)`(:65-121) | 추가: 단위(digital 2)만큼 `addPage` 뒤 새 캔버스 k 를 템플릿셋 `refs[k % refs.length]` 로 시드(workspace 치수 보정·`rebindFrameInteractivity`·`applyObjectPermissions(canvas, editMode)`(:110, editMode 는 잠그지 않음 D6)·`trackRequiredEdits`·`rehydratePhotoPrint`), `composition 'per-photo-fixed-back'` 의 뒷면(홀수 캔버스)은 로드 객체 전부에 `movable/deleteable/contentEditable=false` 강제(`lockSeededObjects` :51-58·:86-87·:107) — 잠금은 **편집기 객체 플래그로만** 강제되며 서버·워커는 검증하지 않는다. 삭제: 선택 캔버스가 속한 사진 p 의 캔버스 `[p·stride .. p·stride+stride−1]` 을 함께 지우고 `usePhotoPrintStore.removeItem(p)`(끝 잘림 금지 — 매수·옵션이 다른 사진으로 밀리지 않음), 최소 미만이면 토스트 거부. 두 경로 모두 `syncPhotoPrintItemsWithCanvases()` |
| 순서 변경 비활성·라벨 | `components/PageNavigation/BookNavigation.tsx:289-295`·`:240` | `dragEnabled` 에 `productProfile?.kind !== 'photo-print'` — 항목이 캔버스 위치(index×stride)에 묶여 있고 digital 은 앞·뒤 쌍이라 1장 재정렬이 옵션·매수·sheet-map 짝을 깨뜨린다. 라벨은 `makePhotoLabelResolver()`(`productProfile.ts:112-118`, `formatPhotoPageLabel` 재사용) |
| 업로드 한도 | `utils/photoPrintUpload.ts` `checkPhotoPrintUploadLimit(files, current)`(:44-66)·`checkPhotoPrintPhotoCount(n)`(:28-36) | `upload.maxPhotos`(현재 사진 수 = 내 업로드 ∪ 외부 주입, `useImageStore.ts:74-82`) · `upload.maxMb` 초과 시 토스트 + 거부. 호출: `stores/useImageStore.ts:519`(`upload`)·`:601`(`uploadSimple`)·`:691`(드래그드롭)·`:848`(틀 mousedown 채움)·`:1163`(틀 클릭 채움 — 교체는 1장 빼고 판정), `tools/AppClipping.tsx:298`, `tools/AppEdit.tsx:289`, 자동배치 `tools/AppImage.tsx:272` |
| 채움 시 항목 메타 | `useImageStore.ts` `writeFillTakenAt`(:265-268, 호출 :995·:1175·:1249) · `recordPhotoFillMeta`(:211-236, 호출 :1025·:1277) · `resolveFillDpi`(:175-180) · `resolveFillSourcePhotoId`(:183-205) | `extension.takenAt` = EXIF `DateTimeOriginal ?? CreateDate`(`utils/photoAutofill.ts:30-41` `parsePhotoExif`, `exifr` 동적 import — Exif 서브 IFD 의 `DateTimeOriginal` 이어야 읽힌다; 외부 주입·내 업로드 메타의 `takenAt` 도 원천 :242-261). `sourcePhotoId` = 업로드 `files` 레코드 id(`uploadedPhotoIdByUrl` :297) 또는 외부 사진 id, 없으면 키 제거. `lowRes` = 창 크기(mm) × 원본 px 로 구한 dpi `< sizes[0].minDpi`(같은 캔버스의 다른 채움이 저해상이면 true 유지) → `setItemMeta`. 사진인화 세트가 아니면 전부 no-op(legacy 직렬화 불변) |
| 채움 기하(D8) | `useImageStore.ts` `readFrameFill`(:121-162)·`resolveFillScaleFor`(:165-168) | `fitMode` 미설정(legacy·NULL 세트)은 종전 폭 기준·프레임 중심 그대로(바이트 동일). `'cover'` 는 **창 기준** `max`(가로·세로 모두 덮고 창 중심 정렬), `'contain'` 은 `min`. 창 = 플러그인이 둔 `__frameWindow`(없으면 `resolveFrameWindowFor` 폴백, 캔버스를 모르면 `frameInsetScale`). image(PNG, inverted clipPath) 타입 틀은 유테 미지원 — inset 0 으로 채우고 `console.warn` 1회(:136-140) |
| `apply` 재호출 | `useImageStore.ts:860`·`:1190`(채움/교체)·`:1310`(틀 삭제) · `tools/AppImage.tsx:299`(자동배치 뒤 `applyAllPhotoPrint`) · `photoPrintRehydrateAll.ts` `bindPhotoPrintCanvasEvents()`(:96-137) ← `embed.tsx:874-879` | 채움·교체·삭제·자동편집 뒤 date-overlay·흑백·clip 창이 새 사진 기준으로 갱신된다. `history:undo`/`history:redo`·`fillImage` `object:removed` 는 캔버스별 `setTimeout 0` 으로 합쳐 `applyPhotoPrintForCanvas`(D5, `historyProcessing` 중 무시) — **photo-print 세트에서만** 리스너를 붙인다. standalone `EditorView` 에는 바인딩하지 않았다(사진인화는 embed 전제) |
| 완료 payload | `embed.tsx:744-748` `productResultFields()` → `photoPrintResultFields()`(`photoPrintRehydrateAll.ts:78-82`) · `EditorResult.items?`(`embed.tsx:484-488`) | 회원 완료 두 경로(`:2616`·`:3053`)의 `editor.complete` 에 `product { kind:'photo-print', editorType, canvasCount, sheetCount(chemical N / digital ceil(N/2)), faces }` + `items: PhotoItem[]`(캔버스 수와 동기화한 완전형). 레거시 `storige:completed` 에도 같은 키(`views/EmbedView.tsx:332-334`, 와일드카드 송신에도 동봉). 게스트 완료(`needsAuth`) 경로(`embed.tsx:2529-2549`·`:2715-2734`)는 `productResultFields` 를 호출하지 않아 `product`·`items` 미동봉 |
| 빌드 플래그 | `apps/editor/.env.example:15` `VITE_ENABLE_PHOTO_PRINT=true` | `VITE_ENABLE_CALENDAR` 와 같은 규칙 — 미설정·`'false'` 외 모든 값 = on. `'false'` 면 플러그인 등록(`createCanvas.ts:58`)과 메뉴(`ToolBar.tsx:40`)를 끈다(저장 속성 `fitMode`/`frameInsetMm` 는 등재돼 보존). 빌드 시점 변수 |

#### 21.8.4 서버·SDK·admin (편집기 관점 요약)

- **api** `apps/api/src/edit-sessions/photo-items.ts`: `readSessionPhotoItems(profile, metadata, canvasCount)`(:46-56, photo-print 세트만; 상한 `resolvePhotoItemLimit` = min(`upload.maxPhotos`, `resolvePhotoItemCount`) :27-37) · `applyPhotoItemsToSheets(sheets, items)`(:67-79 — `front.page === item.canvasIndex` 인 시트에만 `copies`·`label '사진 N'` 주입, `role 'post-process'` 시트 스킵). 주입 지점: 완료 시 자동 sheet-map 잡(`edit-sessions.service.ts:1976-1979`)·재합성(`:2173-2176`) → 기존 `buildJobFiles` 가 `files[].copies/label` 로 노출(v1.24 규약 재사용, 워커·`SheetSpec` 무변경). deliverables `items`(`partner-sessions.service.ts:285-286`·`:401-407` — `product` 와 같은 검증된 프로파일 기준 :263-265, 무효면 둘 다 생략). 시트 맵 산출 실패(완료·재합성)는 `metadata.production.sheetMap { error, message, at }`(`edit-sessions.service.ts:199-235`)에 기록되고 deliverables `status 'failed'` + `errorCode/errorDetail`(`partner-sessions.service.ts:268`·`:277`·`:288-291`; 더 새로운 합성 잡이 있으면 잡 상태 우선 `:497`). `metadata.productProfile` 서버 소유(`SESSION_METADATA_SERVER_OWNED_KEYS` :187, `stampProductProfileSnapshot` :287-313 — create `:434`/update `:1041`(metadata 동봉 시)/complete `:1736` 에서 템플릿셋 프로파일로 기록, NULL 이면 키 제거, 조회 실패면 기존 유지). 검증 잡 `orderOptions.bleed` = `resolveDefaultBleedMm`(:150-158, 호출 `:2384`) — 템플릿셋 없음 3 · `cropMarkEnabled && bleedMm≠0` → 3 · 그 밖의 프로파일 non-null 세트 0 · `metadata.bleed` 명시값 우선(D9: chemical 세트 `BLEED_MISSING` 경고 제거). 검증 규칙은 현행(`sheet-validation-rules.ts:116-128` — cover 슬롯 `productKind 'sheet'`·`coverSpine 'none'`, chemical `pageStep` 없음·digital 2). DTO `PhotoPrintProfileDto`(+`PhotoPrintSizeDto`·`PhotoPrintOptionsPolicyDto`·`PhotoPrintCopiesDto`·`PhotoPrintUploadDto`, `templates/dto/product-profile.dto.ts:279-360`·`:451`). **마이그레이션·새 env·FLAGS 키 없음.**
- **SDK** `packages/sdk`: `embed/protocol.ts` `EditorCompleteProduct.kind` + `'photo-print'`(:313)·`EditorCompletePayload.items?: EditorCompleteItem[]`(:304)·`EditorCompleteItem`(:328) · `embed/parse.ts` `PRODUCT_KINDS` 에 `'photo-print'`(:217 — 빠지면 그 세트의 `product` 키가 통째로 탈락)·`readCompleteItem(s)`(:258-315, 불량 항목 생략) · 배럴 export `embed/index.ts:43`·`src/index.ts:102` · `client` `SessionDeliverables.items?: SessionDeliverablesItem[]`(`types.ts:417`·`:455`) · README 「사진인화 세트 — `complete` payload」(`README.md:308-322`)·`SessionDeliverables.items`(`:262-265`).
- **admin** `apps/admin/src/pages/TemplateSets/photoPrintProfilePresets.ts` 프리셋 4종(:97-126, 전부 **'오너 확정 전 기본값'** :4): `photo_chem`(:58-68 — chemical·faces 1·range 1~200 step 1·`single-pdf`·`upload { 200, 25 }`·cropMark off·bleed 0) / `photo_digital_items`(:82-93 — digital·free-back·range 2~400 step 2·`sheet-map per-sheet`·`upload { 400, 25 }`·cropMark on·bleed 3) / `photo_digital_fixedback`(+`backTemplateId` 자리표시 `REPLACE_WITH_BACK_TEMPLATE_ID` :35 — 적용 뒤 뒷면 템플릿 id 로 치환 :208) / `photo_digital_sheet`(sheet-cards 90×54). 사이즈 `4x6`(102×152mm, minDpi 200 :38)·`card-90x54`(minDpi 300 :39), `options border [none, white] fit [paper-full, image-full] finish [matte, glossy] brightnessFix/dateOverlay/grayscale true borderInsetMm 2`(:41-49), `copies 1~99`(:51), 도련 digital 3mm·chemical 0(:168-170). `TemplateSetForm.tsx` 섹션 라벨 「상품 프로파일」(:1521)·사진인화 프리셋 Select/적용 버튼(:1538-1546)·안내 `productProfileSectionHint`(:1550). 샘플 등록 `scripts/register-photo-print-samples.mjs`(`--dry-run`/`--with-site`(로컬 API 전용, 원격은 `--allow-remote`)/`--only` :13-16·:42-45) — 운영 실행은 오너 승인.

#### 21.8.5 템플릿 저작 규약 (샘플 스크립트 `scripts/register-photo-print-samples.mjs` 기준)

- **사진틀**은 `rect`(또는 `path`) 객체 `extensionType:'frame'`, `fill ''`, **`stroke ''`·`strokeWidth 0`**(:163-167) — 저작 stroke 는 `printExclude` 없이 PDF 에 인쇄되고, `strokeWidth 0` 이라야 bbox/중심이 재단(또는 재단+도련) 상자와 일치한다(:26-27). image(PNG) 타입 틀은 유테 미지원(§21.8.3 채움 기하).
- **도련 세트 앞면 틀은 재단 밖 도련(bleedMm, 사방)까지 확장**(`frontCanvas` :197-209 — `left/top −b`, `width W+2b`) — 페이퍼풀이 도련까지 덮어야 재단 후 흰 가장자리가 없다. 유테·이미지풀 창을 재단 기준으로 줄이는 것은 플러그인 몫(`bleedPx`)이며 저작 기하는 바꾸지 않는다.
- **촬영일 텍스트** `extensionType:'date-overlay'`, `extension.frameId` 로 틀에 바인딩, `deleteable/contentEditable/editable false`(:170-176) — 편집기가 `text` 를 `'YYYY.MM.DD'` 로 갱신한다(폰트는 템플릿 저작값).
- **뒷면**: ① 자유 뒷면 = 안내 텍스트 1개(삭제·편집 가능 :211-216) / ② 고정 뒷면 = 로고 자리 사각형·텍스트에 `movable/deleteable/contentEditable=false`(:181·:218-226) + `productProfile.photoPrint.backTemplateId` = 뒷면 템플릿 id(**refs[1] 과 같은 id** :30·:302) / ③ 카드형(90×54) 뒷면 = 자유 텍스트(:228-233).
- **세트 refs** = chemical `[앞]`, digital `[앞, 뒤]` — 편집기는 캔버스 k 를 `refs[k % refs.length]` 로 시드한다(:251, `photoPrintSeed.ts:78`).
- 유테 띠·이미지풀 여백은 **캔버스 배경(흰색)이 보이는 방식**(:20, `PhotoPrintPlugin.ts:13`) — 배경이 흰색이 아닌 템플릿은 띠 색이 달라진다.

#### 21.8.6 로컬 e2e(2026-10-19) · 테스트

- **1차 e2e(수정 전, 인쇄 ① `photo_digital_items`·인화 `photo_chem`)** 통과: 런처 `items` 기록·임베드 진입(2캔버스 '사진 1 앞/뒤' 라벨·메뉴·패널), 사진틀 채움, 패널 옵션(유테 `frameInsetMm 2`·이미지풀 `contain`·흑백 `Grayscale:photo-print`+`extension.grayscale`·촬영일 텍스트), 교체 뒤 옵션 유지, 페이지 추가 2캔버스 증설, 자동저장 canvasData 에 `fitMode/frameInsetMm/extension.takenAt/grayscale` 직렬화, chemical 완료(검증 잡 `isValid true`·errors 0·`items` 3건 완전형), ② 뒷면 잠금, ③ 90×54 라벨. 결함 **D1~D9**(재오픈 마지막 캔버스 유실·런처 items 탈락·유테가 도련 안에 묻힘·촬영일 UTC·undo 뒤 date-overlay 잔존·editMode 잠금·SDK export 누락·cover 폭 기준·chemical `BLEED_MISSING`)는 전부 수정됐다(21.7). **수정 후 e2e 재실측(2026-10-20 13:50~14:05 KST) 통과**: 런처 ① 세션 `items` 2건 → 진입 즉시 캔버스 4 증설·시드(D2), 가로 사진 cover scale 0.7776(=933.08/1200, D8), 유테 창 (0.9074, 0.9367) = (98/108, 148/158) 재단 기준(D3), reload 뒤 캔버스 4·콘솔 오류 0(D1), 완료 → 검증 `warnings: []` → 자동 `sheet-map-r1`(copies 5/2·label '사진 1/2') → deliverables `ready`·`items`(lowRes 계산 193dpi<200 → true) → synthesize r2. 재실측 중 발견한 **D10**(런처 증설('cycle') 페이지의 사진틀에 클릭 채움 바인딩 누락 — 틀만 선택됨)은 `hooks/useEditorContents.ts` 추가 페이지 `loadJSON` 콜백에 `if (photoPrintProfile) rebindFrameInteractivity(targetEditor, cvs)` 한 줄로 수정·재검증(새 세션 캔버스 2 bound true, editor vitest 133/1810). 미실행: ②·③ 완료 e2e, 25캔버스 실측.
- **전체 테스트(2026-10-20 13:51 KST(04:51Z, 로그 기준), 기준선 P2-c `9be4c37c` 대비 회귀 0)**: api jest 154 suites/3470 tests · worker jest 36/1353 · editor vitest 133 files/1810 · canvas-core vitest(Node 24) 63/754 · admin vitest 24/302 · sdk vitest 13/416 · tsc 7패키지 ok. worker jest 는 api jest 와 **동시 실행하지 않는다**(PDF 처리 테스트가 5s timeout 에 민감 — 동시 실행 1차에서 timeout 12건, 단독 재실행 전부 통과).

#### 21.8.7 핵심 파일 매핑 (P2-d)

| 영역 | 파일 |
|---|---|
| 프로파일 타입·검증·항목 모델 | `packages/types/src/product-profile.ts` (`PhotoPrintProfile`, `PhotoItem`, `PhotoItemInput`, `validatePhotoPrintBlock`, `readPhotoItems`, `resolvePhotoItemCanvasIndex`, `resolvePhotoItemCount`, `formatPhotoPageLabel`, `resolvePhotoFitMode`, `resolvePhotoFrameInsetMm`), `packages/types/src/index.ts` (`EditorMenuKey 'PHOTO_PRINT'`, `EDITOR_MENU_DEFS`) |
| 플러그인·창 기하·흑백·촬영일 | `packages/canvas-core/src/plugins/PhotoPrintPlugin.ts`, `FrameInteractionPlugin.ts`(`_syncFromFrame` 창 동기화), `src/utils/canvas.ts`(`fitMode`·`frameInsetMm` 등재), `src/index.ts`(export) |
| 편집기 프로파일 배선 | `apps/editor/src/utils/productProfile.ts` (`isPhotoPrintProfile`, `makePhotoLabelResolver`, `photoPrintCanvasStride`, `resolvePhotoPrintSeedCount`, `resolvePhotoPrintPageStep`) |
| 스토어 | `apps/editor/src/stores/usePhotoPrintStore.ts` |
| 옵션 적용·복원·세션 메타·이벤트 | `apps/editor/src/utils/photoPrintRehydrate.ts` (`resolvePhotoPrintCanvasOptions`, `resolvePhotoPrintBleedPx`, `rehydratePhotoPrint`, `applyPhotoPrintCanvas/ForCanvas/Item`), `utils/photoPrintRehydrateAll.ts` (`applyAllPhotoPrint`, `syncPhotoPrintItemsWithCanvases`, `restorePhotoPrintSessionItems`, `photoPrintSessionMetadataFields`, `photoPrintResultFields`, `bindPhotoPrintCanvasEvents`) |
| 페이지 시드·업로드 한도 | `apps/editor/src/utils/photoPrintSeed.ts` (`seedPhotoPrintCanvas`, `lockSeededObjects`), `utils/photoPrintUpload.ts` (`checkPhotoPrintUploadLimit`, `checkPhotoPrintPhotoCount`) |
| 채움 기하·EXIF·항목 메타 | `apps/editor/src/stores/useImageStore.ts` (`readFrameFill`, `resolveFillDpi`, `recordPhotoFillMeta`, `writeFillTakenAt`, `uploadedPhotoIdByUrl`), `utils/photoAutofill.ts` (`parsePhotoExif`) |
| 메뉴·패널·페이지 UI | `apps/editor/src/components/editor/ToolBar.tsx`, `FeatureSidebar.tsx`, `components/photoPrint/PhotoPrintPanel.tsx`, `components/editor/SidePanel.tsx`(사진 단위 추가/삭제), `components/PageNavigation/BookNavigation.tsx`(라벨·순서 변경 비활성) |
| 임베드 진입·복원·완료 | `apps/editor/src/embed.tsx` (`:744-748`, `:874-879`, `:1355`, `:1664-1669`, `:1821`, `:1855-1866`, `:1951-1955`, `:2616`, `:3053`), `views/EmbedView.tsx`(`:332-334`), `hooks/useEditorContents.ts` (`:528`, `:1098-1106`, `:1179-1200`, `:1251-1256`, `:1295-1302`, `:1569`), `hooks/useEmbedAutoSave.ts` (`:283`, `:332`, `:418-421`) |
| 업로드 진입점 | `apps/editor/src/tools/AppImage.tsx`(자동배치), `AppClipping.tsx`, `AppEdit.tsx` |
| 플러그인 등록·빌드 플래그 | `apps/editor/src/utils/createCanvas.ts` (`VITE_ENABLE_PHOTO_PRINT`), `apps/editor/.env.example` |
| api 시트 주입·deliverables·검증 | `apps/api/src/edit-sessions/photo-items.ts`, `edit-sessions.service.ts` (`resolveDefaultBleedMm`, `SESSION_METADATA_SERVER_OWNED_KEYS`, `stampProductProfileSnapshot`, `production.sheetMap`), `partner-sessions/partner-sessions.service.ts` (`buildItemsView`, `resolveSheetMapFailure`), `templates/dto/product-profile.dto.ts` (`PhotoPrintProfileDto`) |
| SDK | `packages/sdk/src/embed/protocol.ts`, `embed/parse.ts`, `src/types.ts` (`SessionDeliverablesItem`), `README.md` |
| admin 프리셋·폼·샘플 등록 | `apps/admin/src/pages/TemplateSets/photoPrintProfilePresets.ts`, `TemplateSetForm.tsx`, `scripts/register-photo-print-samples.mjs` |

#### 21.8.8 오너 결정 대기 (프로파일 값 — 코드 무변경으로 교체 가능)

판형 `4x6`(102×152mm)·카드 `90×54` · chemical 도련 0 유지 여부(정책 A 준용 vs 미니랩 풀블리드) · 유테 폭 `borderInsetMm 2` · 업로드 한도 200/400장·25MB · 촬영일 표기 `'YYYY.MM.DD'` · ② 뒷면 `refs[1] = backTemplateId` 규약 · chemical 세션의 매수는 단일 PDF 라 `files[].copies` 가 없고 deliverables `items` 로만 전달(P3 면별 JPEG 전까지 충분한지) · `brightnessFix` 는 통과만(미리보기 미적용). 운영 샘플 세트 등록·배포는 오너 승인 후.
