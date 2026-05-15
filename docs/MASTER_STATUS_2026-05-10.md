# Storige 마스터 트래커 — 2026-05-10

> **이전 마스터**: [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md) (멀티사이트 플랫폼화 완료, 98%)
>
> **이번 사이클**: 2026-05-09 ~ 05-10 — 편집기 UX·관리자 모드 분리 (운영 베이스 디자인 흐름 완성)

## 0. 한 줄 요약

> 편집기를 **고객 모드 / 관리자 "템플릿셋 수정" 모드** 두 흐름으로 명확히 분리. admin 이 디자인한 템플릿셋이 자동으로 고객 진입 시 베이스로 노출되는 운영 흐름 완성. 헤더 UI/저장 가드/안내 배너로 두 모드 시각적 구분 + 운영 사고 방지.

## 1. 이번 사이클 작업 (시간순)

### Sprint 1 — UX 누수 정리 (5/9)

| 커밋 | 변경 | 영향 |
|---|---|---|
| `feaaaa3` | 사이드 메뉴 토글 시 편집중인 페이지 자동 중앙 정렬 | 사이드바 열고 닫을 때 페이지가 한쪽으로 치우치는 문제 해결 |
| `3bbe0ac` | 객체 선택 핸들 UI 개편 — 원형 코너 + 캡슐 변 + 하단 회전 | 두 번째 사진 스타일로 직관성 ↑, 회전 핸들이 텍스트 위 가려지지 않음 |
| `39afe93` | 배경 패널 "적용" 버튼 잘림 fix | flex shrink 가드 추가 — `min-w-0` + `shrink-0` |

### Sprint 2 — 운영 베이스 디자인 흐름 (5/9 ~ 5/10)

| 커밋 | 변경 | 영향 |
|---|---|---|
| `0c06e0f` | 템플릿셋별 도구 메뉴 노출 화이트리스트 (admin → 메뉴 선택, editor → 필터링) | 동화책=프레임/QR off, 전단지=AI/모양컷 off, 단순 PDF 입고용=업로드만 등 상품별 도구 노출 |
| `22856ac` | 디폴트 진입 시 샘플 8×8 inch 책 (24p) 자동 로드 | URL 파라미터 없이 진입 시 빈 100×100mm 캔버스 → 실제 작업 가능한 책 베이스 |
| `da89b28` | Admin "템플릿셋 수정" 모드 분리 — `templates.canvas_data` PATCH 흐름 | "에디터" → "템플릿셋 수정" 라벨 + adminEdit URL 파라미터 + useTemplateSetSave 훅 + amber 배너 |
| `03d30d2` | 사용자/관리자 모드 헤더 UI 분리 + window.confirm 운영 가드 | "수동 저장 모드" 뱃지, 불러오기 admin 숨김, "저장 / 저장 후 닫기" 분리, confirm 다이얼로그 |

## 2. 핵심 변경 요약

### 2.1 데이터 모델

- **`template_sets.enabled_menus`** (JSON, nullable) — 도구 메뉴 노출 화이트리스트
- **`templates`** 시드 — 샘플 표지 스프레드 + 내지
- **`template_sets`** 시드 — `sample-8x8-book-24p` (book 모드 25페이지)

### 2.2 API

- `CreateTemplateSetDto` / `UpdateTemplateSetDto` 에 `enabledMenus` 필드 + `@IsIn(ALL_EDITOR_MENU_KEYS)` 검증

### 2.3 Admin

- TemplateSetForm: "도구 메뉴 노출 직접 설정" 토글 + 체크박스 그룹 (전체/없음/업로드만 프리셋)
- TemplateSetList: "에디터" → "템플릿셋 수정", "편집" → "설정" 라벨 변경

### 2.4 Editor

- `EditorMenuKey` / `EDITOR_MENU_DEFS` (types 단일 소스)
- `useSettingsStore.enabledMenus` + `setEnabledMenus()`
- `useTemplateSetSave()` 훅 — 각 페이지 → templates PATCH (중복 templateId 한 번만)
- EditorView: `adminEdit=templateSet` 파라미터 인식 + amber 배너
- EditorHeader: 모드별 분기 — AutoSaveIndicator/뱃지, 불러오기 표시/숨김, 저장 액션 1/2개
- 디폴트 진입 시 `getDefaultTemplateSetId()` → 환경변수 override 가능

### 2.5 UX 개선

- 워크스페이스 자동 중앙 정렬 (사이드 메뉴 토글 / 사이드바 드래그 / ControlBar 등장 / 윈도우 리사이즈)
- 객체 선택 핸들: 원형 코너 + 캡슐 변 + 객체 아래 회전 핸들 (light/dark 자동)
- 배경 패널 "적용" 버튼 잘림 해결

## 3. 운영 영향

### 운영 DB

```bash
# 158.247.235.202 storige-mariadb 적용 완료 (5/8)
docker exec -i storige-mariadb mariadb -ustorige -p"$DBPW" storige < \
  apps/api/migrations/20260508_add_template_sets_enabledMenus.sql
docker exec -i storige-mariadb mariadb -ustorige -p"$DBPW" storige < \
  apps/api/migrations/20260508_seed_sample_template_set.sql
```

### Vercel 배포

- `storige-editor` ● Ready (커밋 `03d30d2`)
- `storige-admin` ● Ready (커밋 `da89b28`)

### 운영 도메인

- https://editor.papascompany.co.kr/ → 200 ✓
- https://admin.papascompany.co.kr/ → 200 ✓
- https://api.papascompany.co.kr/api/template-sets/sample-8x8-book-24p/with-templates → templateSet OK + 25개 templates ✓

## 4. PHP / bookmoa 영향

**없음** (별도 통보 문서 [`PHP_NOTICE_2026-05-10_admin_template_set_edit.md`](./PHP_NOTICE_2026-05-10_admin_template_set_edit.md) 작성).

두 가드 (URL 파라미터 + admin 권한) 모두 통과해야 admin 분기 활성. 부수 효과로 admin 이 입혀둔 디자인이 자동으로 고객 베이스로 노출됨 (긍정).

## 5. 운영자가 직접 확인할 것

1. **샘플 자동 로드**: `editor.papascompany.co.kr/` 진입 시 8×8 inch 책 (표지 스프레드 + 내지 24) 가 보이는지
2. **Admin "템플릿셋 수정"** 클릭 → 헤더에 "⚠ 수동 저장 모드" 뱃지, "저장 / 저장 후 닫기" 두 버튼, "불러오기" 숨김
3. **저장 confirm** → 카운트("영향 페이지 N개 / PATCH 대상 templates M개") 표시
4. **저장 후 새 시크릿 탭** → admin 디자인이 디폴트로 보임
5. **도구 메뉴 화이트리스트** → 템플릿셋 "설정" 에서 메뉴 일부만 체크 → 해당 templateSetId 진입 시 좌측 ToolBar 에 그 메뉴만

## 6. 갱신된 문서

- `docs/EDITOR.md` — §7~§12 신규 (도구 메뉴 / 디폴트 샘플 / 핸들 / 워크스페이스 정렬 / 모드별 헤더 / 파일 빠른참조)
- `docs/EDITOR_SCREENS.md` — 저장 흐름 매트릭스 + Admin 라벨 + 헤더 모드별 UI 표
- `docs/PHP_NOTICE_2026-05-10_admin_template_set_edit.md` (신규)
- `.claude/skills/fabric-editor/SKILL.md` — 워크스페이스 정렬 + 객체 선택 핸들 + 도구 메뉴 화이트리스트
- `.claude/skills/editor-object-editing/SKILL.md` — 함정 표 추가
- `Storige_개발가이드.html` — "에디터 UX" 사이드바 섹션 + 4개 신규 페이지

## 6.1 후속 fix (2026-05-15)

| 커밋 | 변경 | 영향 |
|---|---|---|
| `7ab82a9` | admin 상품관리 TypeError fix — name/code/price nullable 안전 접근 | 상품 페이지 흰 화면 해결 |
| `d81b544` | admin 라이브러리/템플릿셋 썸네일 깨짐 — `/api` prefix 제거 (lib/axios) | 운영 nginx 가 `/storage/*` 직접 서빙. resolveStorageUrl 수정 |
| `5b44825` | 누락 두 페이지 추가 fix (Templates, ProductTemplateSets) | 모든 admin 썸네일 페이지 단일 소스 사용 |
| (예정) | 옵션 C: 더미 청소 + 샘플 placeholder + 공통 ThumbnailImage | 운영 데이터 정리 + UX 친절 placeholder |

### 더미 데이터 청소 (옵션 C)

진단: `templates.thumbnail_url` 모두 NULL 이었던 원인은 두 그룹의 시드 데이터:
- **2026-04-27 시드**: tpl-cover, tpl-page-1~4 — `canvas_data.objects` 0개 (순수 더미)
- **2026-05-09 시드 (이번 사이클)**: sample-page-8x8, sample-spread-cover-8x8 — workspace/가이드만, useTemplateSave 자동 캡쳐 경로 미경유

처리:
- `apps/api/migrations/20260515_cleanup_dummy_templates_and_seed_thumbnails.sql`
  - tpl-* 5건 소프트 삭제 (`is_deleted=TRUE, is_active=FALSE`)
  - sample-* 2건의 `thumbnail_url` = `/storage/library/template-samples/<file>.svg`
  - `template_sets.sample-8x8-book-24p` 도 동일 SVG 로 대표 썸네일 부여
- 운영 DB 적용 완료 (2026-05-15)

### Placeholder SVG 자산

신규 storage 위치: `/storage/library/template-samples/`
- `sample-page-8x8.svg` — 정사각형 샘플 내지 (203.2 × 203.2 mm 라벨)
- `sample-spread-cover-8x8.svg` — 가로형 표지 스프레드 (앞표지 + 책등 + 뒤표지 시각화)

VPS `~/storige/storage/library/template-samples/` 에 업로드 + nginx `/storage/*` 직접 서빙으로 검증 완료 (200).

### 공통 ThumbnailImage 컴포넌트

신규: `apps/admin/src/components/ThumbnailImage.tsx`
- props: `url`, `size?`, `alt?`, `emptyHint?`
- url NULL → "⊘ 미설정" amber-style placeholder (Tooltip: "편집 후 저장 시 자동 생성")
- 로드 실패 → 빨간색 placeholder (Tooltip: 실패한 URL)
- 정상 → `<img>` (objectFit: cover)
- 3개 페이지 (TemplateSetList / TemplateList / ProductTemplateSetList) 의 local 컴포넌트 제거 후 일괄 교체 → 단일 진실 공급원

## 7. 다음 사이클 후보

- **Phase 3 (선택)**: admin "템플릿셋 수정" 모드에 "원본으로 되돌리기" 버튼 (현재 페이지 templates.canvas_data 재로드)
- **Phase 4 (장기)**: admin 모드에도 자동저장 활성화 (`useTemplateSetAutoSave` 신규)
- **운영 모니터링**: 샘플 자동 로드로 진입 사용자 행동 변화 (편집 완료율, 첫 액션까지 시간 등) Sentry/GA 추적

---

**최종 갱신**: 2026-05-10 · 7개 신규 커밋 + 6개 문서 + Storige_개발가이드.html
