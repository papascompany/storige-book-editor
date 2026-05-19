# Sprint Handoff — 2026-05-19

> **목적**: 본 세션(2026-05-15 ~ 2026-05-19) 에서 처리한 작업·진행 중 컨펌 대기 항목을 다음 세션(Claude / 코덱스 / 커서) 가 이어받을 수 있도록 정리.
> **이전 마스터**: [`docs/MASTER_STATUS_2026-05-10.md`](../../docs/MASTER_STATUS_2026-05-10.md)
> **세션 시작 트리거**: 사용자 보고 — "admin 에서 상품관리 메뉴(https://admin.papascompany.co.kr/products)에 오류가 있습니다"

---

## 0. TL;DR (한 줄 요약)

> Admin 운영 안정화 8건 fix 완료(상품관리/썸네일/카테고리/SPA 라우팅/저장 손상) + 인쇄 워크플로우 통합 개발계획서 v1 작성 후 **사용자 컨펌 대기 중**.

---

## 1. 완료된 작업 (시간순 8건)

각 항목은 **운영 DB·Vercel 배포 + VPS API 재배포까지 완료**.

| # | 커밋 | 제목 | 핵심 변경 | 영향 도메인 |
|---|---|---|---|---|
| 1 | [`7ab82a9`](https://github.com/papascompany/storige-book-editor/commit/7ab82a9) | admin 상품관리 TypeError fix | `name/code/price` nullable 안전 접근 + `getProductDisplayName()` helper | admin |
| 2 | [`d81b544`](https://github.com/papascompany/storige-book-editor/commit/d81b544) | 라이브러리/템플릿셋 썸네일 깨짐 | `resolveStorageUrl()` 의 `/api` prefix 제거 (nginx 가 `/storage/*` 직접 서빙) | admin (5 페이지) |
| 3 | [`5b44825`](https://github.com/papascompany/storige-book-editor/commit/5b44825) | 누락 두 페이지 추가 fix | Templates / ProductTemplateSets 도 wrapper 통일 | admin |
| 4 | [`8f74b4c`](https://github.com/papascompany/storige-book-editor/commit/8f74b4c) | **옵션 C — 더미 청소 + placeholder SVG + 공통 컴포넌트** | tpl-* 5건 소프트삭제 + sample SVG 2종 + `ThumbnailImage` 단일화 | admin + DB + storage |
| 5 | [`b685824`](https://github.com/papascompany/storige-book-editor/commit/b685824) | 카테고리/라이브러리 PUT→PATCH | API controller 가 `@Patch` 인데 client 가 `.put()` → 404. 4건 일괄 | admin |
| 6 | [`63ffe32`](https://github.com/papascompany/storige-book-editor/commit/63ffe32) | editor SPA fallback rewrite | `/template` 같은 React Router 라우트 직접 진입 시 Vercel 404 → rewrites 추가 | editor 배포 |
| 7 | [`d0f364d`](https://github.com/papascompany/storige-book-editor/commit/d0f364d) | storage URL `/files/` 접두사 제거 | `saveFile()` URL 과 디스크 경로 불일치 → admin 썸네일 404. 코드 + 마이그레이션 SQL | API + DB |
| 8 | [`7ffbc80`](https://github.com/papascompany/storige-book-editor/commit/7ffbc80) | 템플릿 편집 시 spread→page 손상 + 복구 | `TemplateEditorView` 가 URL params 없을 때 기본값(PAGE/210/297) 으로 강제 덮어써서 SPREAD 표지 손상. 데이터 복구 + 이중 가드 | editor |

### 1.1 데이터 마이그레이션 (운영 DB 적용 완료)

| 파일 | 작업 |
|---|---|
| `apps/api/migrations/20260515_cleanup_dummy_templates_and_seed_thumbnails.sql` | tpl-* 더미 5건 소프트삭제 + sample-* 2건 thumbnail_url + template_sets thumbnail |
| `apps/api/migrations/20260519_fix_storage_url_files_prefix.sql` | DB 의 잘못된 `/storage/files/...` URL → `/storage/...` 치환 |
| 일회성 SQL (운영만 실행, 마이그레이션 파일 없음) | `UPDATE templates SET type='spread', width=408.1, height=203.2 WHERE id='sample-spread-cover-8x8';` |

### 1.2 운영 storage 신규 자산

VPS `~/storige/storage/library/template-samples/` (nginx `/storage/*` 직접 서빙):
- `sample-page-8x8.svg` — 정사각형 샘플 내지 placeholder
- `sample-spread-cover-8x8.svg` — 가로형 표지 스프레드 placeholder

---

## 2. 신규 파일 목록 (이 세션)

```
storige/
├─ apps/admin/src/components/ThumbnailImage.tsx              # 단일 썸네일 컴포넌트
├─ apps/api/migrations/20260515_cleanup_dummy_templates_and_seed_thumbnails.sql
├─ apps/api/migrations/20260519_fix_storage_url_files_prefix.sql
└─ .cursor/plans/RESUME_PROMPT_2026-05-19.md                 # (본 문서)
```

수정된 파일 (대표):
- `apps/admin/src/lib/axios.ts` — `resolveStorageUrl()` 재작성 (API_ROOT_URL)
- `apps/admin/src/api/categories.ts`, `library.ts`, `products.ts` — PUT/PATCH 정합 + 인터페이스
- `apps/admin/src/pages/Products/ProductList.tsx` — nullable 안전 접근
- `apps/admin/src/pages/TemplateSets/{TemplateSetList,TemplateSetForm}.tsx`
- `apps/admin/src/pages/Templates/TemplateList.tsx`
- `apps/admin/src/pages/ProductTemplateSets/ProductTemplateSetList.tsx`
- `apps/api/src/storage/storage.service.ts` — `saveFile()` URL 형식
- `apps/editor/vercel.json` — SPA rewrites 추가
- `apps/editor/src/hooks/useTemplateSave.ts` — 편집 모드 dto 가드
- `apps/editor/src/views/TemplateEditorView.tsx` — 메타 필드 명시 전송

---

## 3. 운영 상태 (2026-05-19 기준)

| 도메인 | 상태 |
|---|---|
| `https://editor.papascompany.co.kr/` | ✅ 200, 샘플 8×8 책 자동 로드 |
| `https://editor.papascompany.co.kr/template?templateId=...` | ✅ 200 (SPA fallback 적용) |
| `https://admin.papascompany.co.kr/products` | ✅ 200 |
| `https://admin.papascompany.co.kr/templates` | ✅ 200 |
| `https://admin.papascompany.co.kr/template-sets` | ✅ 200 |
| `https://admin.papascompany.co.kr/categories` | ✅ 200, 수정 정상 |
| `https://admin.papascompany.co.kr/library/*` | ✅ 200, 썸네일 정상 |
| API `https://api.papascompany.co.kr/api/health` | ✅ |
| API `template-sets/sample-8x8-book-24p/with-templates` | ✅ spread:1, page:24 |

운영 DB sample 상태:
- `templates.sample-spread-cover-8x8`: type=spread, 408.1×203.2, thumbnail OK
- `templates.sample-page-8x8`: type=page, 203.2×203.2, thumbnail OK
- `template_sets.sample-8x8-book-24p`: editorMode=book, templates 25개, thumbnail OK

---

## 4. ⏸ 컨펌 대기 중 — 인쇄 워크플로우 통합 개발계획서 v1

본 세션 마지막에 사용자가 추가 비즈니스 요구사항을 명세함. **코드 수정 전 8-Phase 개발계획서** 를 브리핑했으나 **컨펌 미완료**. 다음 세션이 이어받을 작업.

### 4.1 사용자 정의 워크플로우 (최종)

```
ADMIN
  1. 템플릿셋 구성
     • 표지 SPREAD 템플릿 (편집가능/불가 토글)
     • 앞면지 0~6장 (각각 편집가능/불가)
     • 내지 PAGE 템플릿 N장 (canAddPage=true 면 고객 PDF 페이지수로 자동 확장)
     • 뒷면지 0~6장
  2. 레더 커버/화보집: 미리보기 이미지 = 표지 (편집불가, 빈 PDF + 네이밍)
  3. 인쇄 완료 PDF 다운로드 (운영)

고객 (게스트 허용)
  1. 편집기 진입
  2. 표지: 편집기 디자인 (편집가능 템플릿만)
  3. 내지: A) 편집기 직접 편집 / B) PDF 첨부 → 워커 자동 검증 → 통과 시 페이지수 자동 맞춤
     - 검증 실패 시 이슈 노티 → 고객 수정 후 재첨부
  4. 편집완료 → 인쇄용 PDF 자동 생성 (표지 + 앞면지 + 내지 + 뒷면지 합본)
  5. 저장 시점 → 로그인/회원가입 유도 (게스트 → 회원 마이그레이션)
  6. 마이페이지에서 작업 목록 + 다운로드/주문
```

### 4.2 Phase 별 작업 단위 (총 ~31시간)

| Phase | 내용 | 추정 |
|---|---|---|
| **Phase 1** | 운영 즉시 fix: `POST /storage/upload` 권한 개방 (게스트 + customer) + CORS 헤더 보장 | ~1h |
| **Phase 2** | 데이터 모델: `Template.ENDPAPER` 타입, `TemplateSet.endpaperConfig`/`coverEditable`, `EditSession.contentPdfFileId/PageCount/validationResult/guestToken` | ~3h |
| **Phase 3** | Admin UI: `TemplateSetForm` 면지/표지편집 설정, Template 편집 토글, ProductTemplateSetList 컬럼 | ~5h |
| **Phase 4** | Editor 고객 흐름: 게스트 토큰 / 페이지 네비 확장 / readonly 처리 / "내지 PDF 첨부" / 워커 자동 검증 / 페이지수 자동 확장 / PDF 페이지 매핑 / 레더 커버 모드 (4-A~4-J) | ~10h |
| **Phase 5** | Worker: `compose-mixed` mode (표지 + 면지들 + 첨부 내지 PDF + 면지들 합본) + 빈 PDF 생성 (레더 커버) | ~4h |
| **Phase 6** | 저장 시 로그인 유도 + 게스트 → 회원 마이그레이션 + 간단한 마이페이지 | ~4h |
| **Phase 7** | PHP/bookmoa 연동 가이드 (`PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`) | ~2h |
| **Phase 8** | 문서·스킬 (EDITOR.md §13, EDITOR_SCREENS.md, MASTER_STATUS_2026-05-19, 가이드 HTML, fabric-editor SKILL) | ~2h |

### 4.3 의존성 그래프

```
Phase 1 (즉시 fix) ──┐
                     ├─→ 운영 정상화 후 안전하게 Phase 2~ 진행
Phase 2 (DB 모델) ───┼─→ Phase 3 (Admin)
                     │   Phase 4 (Editor) ─→ Phase 5 (Worker)
                     │             └─→ Phase 6 (마이페이지)
Phase 7 (PHP 가이드) ─┘
Phase 8 (문서) — 각 Phase 완료 후 누적
```

### 4.4 ⚠ 컨펌 미완료 결정사항 6건

다음 세션 시작 시 **반드시 사용자에게 확정 받고** 작업 시작.

| # | 결정 항목 | 권장안 | 다른 옵션 |
|---|---|---|---|
| 3-1 | 게스트 작업 보존 기간 | **24시간 후 자동 삭제** | 7일 / 영구 (cookies) |
| 3-2 | 내지 PDF 페이지수 < 내지 수 | **고객 선택 모달** | 자동 거부 / 빈 페이지 채움 |
| 3-3 | PDF 첨부 후 내지 일부 편집 허용? | **불허** (배타적) | 일부 페이지만 덮어쓰기 |
| 3-4 | 워커 검증 실패 시 처리 | **첨부 자체 거부 + 안내** | warning + 강제 진행 허용 |
| 3-5 | 레더 커버 미리보기 이미지 저장 | **별도 필드 `coverPreviewImage`** | 표지 템플릿 객체로 |
| 3-6 | 게스트 회원 전환 시점 | **저장(편집완료) 시점만** | 30분 후 자동 유도 |

### 4.5 진행 옵션 (사용자 선택 대기)

| 옵션 | 내용 |
|---|---|
| **A (권장)** | 단계 분할 — Phase 1+2 → 컨펌 → 3+4 → 컨펌 → 5+6 → 7+8 |
| **B** | 풀 오토파일럿 — Phase 1~8 일괄, 한 세션에 분량 초과 시 자동 분할 |
| **C** | 우선순위 재정의 — 특정 Phase 만 선택 |

---

## 5. 다음 세션이 이어받을 때 — 첫 step

### 5-A. 세션 시작 확인 (필수)

```bash
# 1) SSH 에이전트
ssh-add -l 2>&1 | head -1   # 비어있으면: ssh-add ~/.ssh/id_ed25519

# 2) 본 핸드오프 + CLAUDE.local.md 읽기
cat .cursor/plans/RESUME_PROMPT_2026-05-19.md
cat CLAUDE.local.md   # VPS/Vercel/MCP 정보

# 3) 최신 커밋 확인
git log --oneline -15
```

### 5-B. 사용자에게 컨펌 받을 항목

1. **§4.4 결정사항 6건** — 권장안 OK 인지, 변경 있는지
2. **§4.5 진행 옵션** — A / B / C 중 선택
3. **추가 요구사항** — 다국어/모바일/결제 등 누락된 요구사항 여부

### 5-C. 컨펌 받은 후 첫 작업 (가장 무난한 경로)

옵션 A 선택 시:
1. **Phase 1-A** — `apps/api/src/storage/storage.controller.ts` line 42 `@UseGuards / @Roles` 제거 또는 `@Public` 추가 (단, 별도 endpoint 분리 권장)
2. **Phase 1-B** — VPS nginx `client_max_body_size` 확인 (`ssh deploy@158.247.235.202 'grep client_max_body_size /etc/nginx/sites-enabled/*'`)
3. **Phase 1-C** — NestJS exception filter 가 CORS 헤더 포함하는지 확인 (`apps/api/src/common/filters/sentry-exception.filter.ts` 등)
4. 검증 → 커밋 → Vercel 배포 + VPS API 재배포

---

## 6. 코드베이스 핵심 매핑 (빠른 참조)

| 영역 | 파일 |
|---|---|
| Admin 썸네일 단일 컴포넌트 | `apps/admin/src/components/ThumbnailImage.tsx` |
| Storage URL helper | `apps/admin/src/lib/axios.ts` (`resolveStorageUrl`, `API_ROOT_URL`) |
| Admin 카테고리/라이브러리 API | `apps/admin/src/api/{categories,library,products}.ts` |
| API storage save | `apps/api/src/storage/storage.service.ts:61` |
| API templates CRUD | `apps/api/src/templates/{templates,template-sets,categories}.service.ts` |
| Editor 디폴트 진입 | `apps/editor/src/constants/defaultTemplateSet.ts` |
| Editor template editor view | `apps/editor/src/views/TemplateEditorView.tsx` (admin iframe 대상) |
| Editor templateSet 로딩 | `apps/editor/src/hooks/useEditorContents.ts` (`loadTemplateSetEditor`, `loadSpreadModeEditor`) |
| Editor 저장 hooks | `apps/editor/src/hooks/{useTemplateSave,useTemplateSetSave,useWorkSave}.ts` |
| Editor 헤더 모드별 UI | `apps/editor/src/components/editor/EditorHeader.tsx` |
| Worker PDF synthesizer | `apps/worker/src/services/pdf-synthesizer.service.ts` |
| Worker PDF validator | `apps/worker/src/services/pdf-validator.service.ts` |

---

## 7. 운영 절차 메모

### 7.1 VPS 마이그레이션 적용
```bash
scp <local>.sql deploy@158.247.235.202:/tmp/m.sql
ssh deploy@158.247.235.202 'source ~/storige/.env && \
  docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige < /tmp/m.sql'
```

### 7.2 API 재배포 (Phase 1·5 처럼 NestJS 코드 변경 시)
```bash
ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && \
  docker compose build api && docker compose up -d api'
```

### 7.3 Vercel 배포 폴링
```bash
DEPL=<deployment-host>; until s=$(vercel inspect $DEPL --scope yohans-projects-de3234df 2>&1 | \
  grep -i '^[[:space:]]*status' | awk '{print $NF}'); \
  [ "$s" = "Ready" ] || [ "$s" = "Error" ] || [ "$s" = "Canceled" ]; do sleep 15; done; echo "$s"
```

### 7.4 Storage URL 규약 (중요)
- 운영 nginx 가 `/storage/*` 를 NestJS 우회 직접 서빙
- 디스크 경로 = URL path. **`/files/` 접두사 금지** (이번 fix 의 핵심)
- 새 storage 파일 위치는 `~/storige/storage/<category>/...` 그대로 URL `/storage/<category>/...` 매핑

---

## 8. 협업 가이드 (Claude ↔ Cursor / Codex)

### 8.1 컨벤션
- 커밋 메시지 한국어 + 짧은 영어 prefix (`fix(admin):`, `feat(editor):` 등)
- 커밋 마지막 줄: `Co-Authored-By: <tool> <noreply@anthropic.com>` 형태
- 마이그레이션 SQL: `IF NOT EXISTS` / `ON DUPLICATE KEY UPDATE` 로 idempotent
- 운영 DB UPDATE 는 가능한 한 마이그레이션 SQL 파일로 보존
- 가능하면 NestJS controller / admin client / editor client 가 같은 패턴 (PUT↔Put, PATCH↔Patch) 인지 사이드체크

### 8.2 분기 책임
- **Claude (본 세션 종료 후 새 세션)**: §4.4 결정사항 + §4.5 진행 옵션 컨펌 받기
- **Cursor / Codex (병행)**: 컨펌 안 받은 상태에서는 Phase 2 의 데이터 모델 설계만 미리 (entity + 마이그레이션 SQL draft) 검토 가능
- **양쪽 모두 금지**: Phase 1 이전에 운영 DB 변경 / Phase 4 의 customer 흐름 코드를 컨펌 없이 작성

### 8.3 충돌 방지
- 현재 master HEAD: `7ffbc80` (편집 손상 fix)
- 새 작업 시작 시: `git pull origin master` 필수
- 한 Phase 한 커밋 권장 (큰 변경은 분할)

---

## 9. 알려진 주의사항

1. **HTML 가이드 위치**: `Storige_개발가이드.html` 는 storige 저장소 외부 (`~/claude/Bookmoa Storige editor/`) 에 있음. git 추적 안 됨. 이번 사이클에선 storige/docs/ 로 이동 보류 (사용자 결정 대기).

2. **백업 파일**: `~/backup/Storige_개발가이드 복사본.html` 와 `~/backup/WORKER_FLOW_시각화 복사본.html` 보관됨.

3. **콘솔 오인 가능 메시지**:
   - "A listener indicated an asynchronous response" — 브라우저 확장 메시지, 무시 가능
   - "env.wasm.numThreads is set to 10" — 단일스레딩 폴백 안내, 무시 가능
   - "Failed to initialize editor: DOMException ... removeChild" — Vite HMR / React Strict Mode 이중 마운트, 무시 가능

4. **운영 데이터에 남은 수동 SQL** (마이그레이션 파일 미보존):
   - `UPDATE templates SET type='spread', width=408.1, height=203.2 WHERE id='sample-spread-cover-8x8';` — 운영만 적용. 다른 환경 시드 필요 시 명시.

---

## 10. 변경 이력

| 일시 | 작업자 | 변경 |
|---|---|---|
| 2026-05-19 | Claude (본 세션) | 최초 작성 — 8건 fix 정리 + 개발계획서 v1 컨펌 대기 기록 |
