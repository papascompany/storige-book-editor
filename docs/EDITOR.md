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

---

## §13 인쇄 워크플로우 v1 — 면지 / PDF 첨부 / 게스트 / 레더커버 / 마이페이지 (2026-05-19)

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
6. `PATCH /edit-sessions/[guest/]:id` 에 `contentPdfFileId` 저장

**결정 3-3 배타**: PDF 첨부 상태에서 캔버스 수정 시 API 가 `400 PDF_ATTACHED_EXCLUSIVE` 거부.

### 13.3 게스트 (24h 자동 삭제)

**Store**: `apps/editor/src/stores/useGuestStore.ts`
- sessionStorage 자동 복원/저장 (`storige_guest_session_v1`)
- `ensureGuestSession({templateSetId, mode})` — 없으면 `POST /edit-sessions/guest` 호출

**자동 발급**: `EditorWorkflowControls` 가 token 없으면 templateSet 로드 후 자동 호출.

**24h 만료**: DB EVENT `evt_purge_expired_guest_sessions` (1h 주기) 가 `guest_expires_at < NOW()` 세션 DELETE.

**Editor App 마운트**: `App.tsx` 에서 `useGuestStore.initializeFromStorage()` 1회 호출.

### 13.4 레더 커버 (`coverEditable=false`)

**컴포넌트**: `apps/editor/src/components/editor/LeatherCoverPreview.tsx`

`templateSet.coverEditable === false` 인 경우 표지 캔버스 대신 표시할 미리보기 컴포넌트. `coverPreviewImage` storage URL 을 표지 비율로 렌더링.

**Worker compose-mixed**: `coverEditable=false` 전달 시 빈 표지 페이지 자동 생성. 실제 표지는 사전 인쇄된 레더/화보집 표지로 대체됨.

**Editor 안내**: `EditorWorkflowControls` 가 "🏷 레더 커버" 배너 표시.

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
| 레더 커버 미리보기 | `apps/editor/src/components/editor/LeatherCoverPreview.tsx` |
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
