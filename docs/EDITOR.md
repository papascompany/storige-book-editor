# Storige 에디터 기획서

> **갱신**: 2026-05-10 — §7~§11 (편집기 UX 사이클) 추가
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
`UPLOAD`, `CLIPPING`, `TEMPLATE`, `IMAGE`, `TEXT`, `SHAPE`, `BACKGROUND`, `FRAME`, `SMART_CODE`, `EDIT`, `AI`

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
