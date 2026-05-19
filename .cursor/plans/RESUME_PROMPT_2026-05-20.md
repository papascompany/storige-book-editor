# Sprint Handoff — 2026-05-20

> **목적**: 인쇄 워크플로우 v1 (Phase 1~8) 완료 보고 + 다음 세션(v2+) 인수인계.
> **이전 마스터**: [`RESUME_PROMPT_2026-05-19.md`](./RESUME_PROMPT_2026-05-19.md)

---

## 0. TL;DR

> **인쇄 워크플로우 v1 — Phase 1~8 코드/DB/문서 완료. 운영 배포 완료. 사용자 GA 대기.**
> PHP 기존 사이트 영향 0. bookmoa-mobile (Codex 영역) 어댑터 와이어링 후 Pilot 운영 가능.

---

## 1. v1 완료 체크리스트

### 1.1 Phase 1~8 커밋 (8건)

| Phase | 커밋 | 영역 |
|---|---|---|
| Phase 1 | [`7a4443e`](https://github.com/papascompany/storige-book-editor/commit/7a4443e) | API — `/storage/upload-public` (게스트, 50MB, MIME 가드) |
| Phase 2 | [`8aedc9c`](https://github.com/papascompany/storige-book-editor/commit/8aedc9c) | DB — 면지/PDF첨부/게스트토큰/레더커버 스키마 + 24h EVENT |
| P0 | [`6b4de7d`](https://github.com/papascompany/storige-book-editor/commit/6b4de7d) | Docker — `event_scheduler=ON` 영구화 |
| Phase 3 | [`d8f4e81`](https://github.com/papascompany/storige-book-editor/commit/d8f4e81) | Admin UI — TemplateSetForm 면지/표지/레더 + Template endpaper |
| Phase 4 | [`9491fe2`](https://github.com/papascompany/storige-book-editor/commit/9491fe2) | API + Editor — 게스트 세션, PDF 첨부, 검증, 자동확장, 레더커버 |
| Phase 5 | [`50c0d1c`](https://github.com/papascompany/storige-book-editor/commit/50c0d1c) | Worker compose-mixed + EditorWorkflowControls 와이어링 |
| Phase 6 | [`b45f614`](https://github.com/papascompany/storige-book-editor/commit/b45f614) | guest migrate + my-sessions API + GuestAuthPrompt + MyWorksView |
| Phase 7 | [`ae59dd1`](https://github.com/papascompany/storige-book-editor/commit/ae59dd1) | docs — PHP_NOTICE + 4개 기존 문서 부록 |
| Phase 8 | (이 커밋) | docs — EDITOR §13 / EDITOR_SCREENS §10 / RESUME / SKILL |

### 1.2 사용자 확정 결정사항 6건 (반영 완료)

| # | 결정 | 반영 |
|---|---|---|
| 3-1 | 게스트 24h 자동 삭제 | ✅ EVENT `evt_purge_expired_guest_sessions` (Phase 2) |
| 3-2 | PDF 페이지수 < 내지 수 → 고객 선택 모달 | ✅ ContentPdfAttachModal 자동확장 (Phase 4) |
| 3-3 | PDF 첨부 ↔ 편집 배타 | ✅ API `PDF_ATTACHED_EXCLUSIVE` 가드 (Phase 4) |
| 3-4 | 검증 실패 → 첨부 거부 | ✅ ContentPdfAttachModal 분기 (Phase 4) |
| 3-5 | `coverPreviewImage` 별도 필드 | ✅ template_sets 컬럼 + LeatherCoverPreview (Phase 2~4) |
| 3-6 | 게스트 회원 전환 = 저장 시점 | ✅ GuestAuthPromptModal + migrate API (Phase 6) |

### 1.3 운영 적용

| 항목 | 상태 |
|---|---|
| VPS API 재배포 | ✅ Phase 1, 2, 4, 5, 6 각각 |
| VPS Worker 재배포 | ✅ Phase 5 (compose-mixed handler) |
| VPS MariaDB 마이그레이션 | ✅ `20260519_v1_phase2_workflow_schema.sql` 적용 |
| `event_scheduler` 영구 ON | ✅ docker-compose `command: --event-scheduler=ON` |
| Editor Vercel | ✅ master push 자동 배포 |
| Admin Vercel | ✅ master push 자동 배포 |
| API Health | ✅ `https://api.papascompany.co.kr/api/health` |

### 1.4 회귀 검증

- ✅ 기존 PHP `POST /auth/shop-session` → 200 정상
- ✅ 기존 `POST /worker-jobs/synthesize/external` → 201 (변경 없음)
- ✅ 신규 `POST /edit-sessions/guest` → 201 + guestToken 발급
- ✅ 신규 `POST /worker-jobs/compose-mixed` → 201 (워커 enqueue)
- ✅ 신규 `GET /edit-sessions/my` 비로그인 → 401 (인증 가드 정상)

---

## 2. Codex 연동 시작점 (필수)

bookmoa-mobile 어댑터 측에서 v1 기능 통합 시 참조:

- **PHP_NOTICE**: [`docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md`](../../docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md)
  - §3.3 migrate endpoint
  - §3.4 my-sessions endpoint
  - §3.5 compose-mixed + webhook payload
  - §4 게스트 흐름 + `editor.needAuth` postMessage
- **PLATFORM_WORKER_INTEGRATION_v1.md §12** — compose-mixed 전체 capability 명세
- **PLATFORM_INTEGRATION_v1.md §11** — v1 신규 endpoint cross-link

### 2.1 신규 endpoint 요약 (Codex/PHP/외부 사이트 그대로 복사)

```
POST   /api/storage/upload-public                  (Public, 50MB, MIME 가드)
POST   /api/edit-sessions/guest                    (Public, guestToken 발급)
PATCH  /api/edit-sessions/guest/:id?guestToken=... (Public + 토큰 검증)
POST   /api/edit-sessions/guest/migrate            (Bearer JWT)
GET    /api/edit-sessions/my                       (Bearer JWT)
POST   /api/worker-jobs/compose-mixed              (Public, 향후 가드 검토)

Webhook synthesis.completed:
  result.capability = 'compose-mixed' (additive)
  result.outputFileUrl = '/storage/outputs/<jobId>/merged.pdf'
  result.totalPages = number

postMessage editor.needAuth (iframe embed 시):
  { source: 'storige-editor', event: 'editor.needAuth',
    payload: { guestToken, reason: 'complete_save', ts } }
```

---

## 3. 운영 상태 (2026-05-20 기준)

| 도메인 | 상태 |
|---|---|
| `https://editor.papascompany.co.kr/` | ✅ 200 (Phase 5-D floating controls 포함) |
| `https://editor.papascompany.co.kr/my-works` | ✅ 200 (Phase 6 마이페이지) |
| `https://admin.papascompany.co.kr/template-sets` | ✅ 200 (면지/표지/레더커버 폼) |
| `https://api.papascompany.co.kr/api/health` | ✅ ok |

### 3.1 운영 DB 상태

- `template_sets`: 신규 3컬럼 (endpaper_config, cover_editable, cover_preview_image)
- `file_edit_sessions`: 신규 5컬럼 + 2인덱스 (content_pdf_*, guest_token, guest_expires_at)
- EVENT `evt_purge_expired_guest_sessions` ENABLED (1h 주기)
- `event_scheduler = ON` (영구 적용)

---

## 4. 미추적 파일 정리 (Phase 8-4 chore 커밋 대상)

- `.claude/skills/card-imposition/SKILL.md` — Gemini 작성, Phase 8 turn 에 단일 chore 로 정리
- `docs/card_imposition_skills.md` — 동상
- `docs/CARD_IMPOSITION_DEV_GUIDE.md` — 동상
- `docs2/Session_Summary_20260516.html` (있으면) — docs/ 로 이동
- `docs/ templateset page workflow.md` → `docs/templateset_page_workflow.md` (공백 제거 권장)

---

## 5. 후속 (v2+ 후보)

### 5.1 v1 follow-up (v1 범위 내 polish)
- compose-mixed Worker — fixable 자동 보정 (현재 통과/실패만 분기)
- ContentPdfAttachModal — fixable status 시 자동 convert 잡 호출
- /my-works UI — 페이지네이션, 다운로드 직접 링크, 삭제 기능
- GuestAuthPromptModal — bookmoa-mobile 측 로그인 모달 통합 (postMessage 표준화)

### 5.2 v2 candidates
- **JumboCard / PrintCard Studio** — `.tmp_claude_card_imposition_prep.md` 의 H1~H6 작업 재개
- **Card Imposition worker** — 명함재단기 (Duplo / Graphtec) 센서 마커 합성 capability
- **Phase 9 Group B** — Pilot 운영 데이터 기반 성능/UX 개선 (`Bookmoa_platform_Plan.md` §Phase 9)
- **bookmoa-mobile Pilot 운영 메트릭** — 큐 길이, 검증 통과율, 게스트→회원 전환율, fixable 비율

---

## 6. 협업 가이드

### 6.1 단일 진실 (변경 금지)

- 필드명·스키마: **`Bookmoa_platform_Plan.md` Phase 4·5·6** (메모리: feedback-plan-as-single-source)
- editor.complete payload: **`apps/editor/src/embed.tsx` `EditorResult` 인터페이스** (Phase A-2 D-4 옵션 B)
- 운영 정보: **`CLAUDE.local.md`** (gitignored, VPS/Vercel/Supabase 시크릿)

### 6.2 다음 세션 진행 시

```bash
# 1) SSH 에이전트
ssh-add -l 2>&1 | head -1
# 비어있으면: ssh-add ~/.ssh/id_ed25519

# 2) 마스터 + 운영 정보 + 워크플로우 정의
cat .cursor/plans/RESUME_PROMPT_2026-05-20.md
cat CLAUDE.local.md
ls docs/templateset*.md 2>/dev/null || ls docs/\ templateset*.md 2>/dev/null

# 3) 최신 커밋 확인
git log --oneline -15
```

### 6.3 v2 진입 시 확정 받을 사항

1. v2 범위 — JumboCard 도입 / Phase 9 Group B / card imposition 중 우선순위
2. bookmoa-mobile Pilot 메트릭 — 어떤 지표로 운영 안정성 판정할지
3. Supabase 의존 — Phase 5-A2 결정사항(Option A) 유지 vs 다른 BaaS 검토

---

## 7. 변경 이력

| 일시 | 변경 |
|---|---|
| 2026-05-20 | 인쇄 워크플로우 v1 Phase 1~8 완료 (코드 + DB + 문서 + 배포). PHP 영향 0, Codex 시작점 명시 |
