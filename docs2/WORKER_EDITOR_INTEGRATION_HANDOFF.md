# Worker · Editor × Storige 플랫폼 연동 — 작업 정리 (Claude / Codex / 사용자)

> **작성일**: 2026-05-20  
> **범위**: 인쇄 워크플로우 v1 (Phase 1~8) — Storige 플랫폼 + bookmoa-mobile 연동  
> **상태**: 코드·문서·운영 배포 **완료** → **Pilot GA(운영 검증)** 단계

---

## 1. 한눈에 보기

| 구분 | 저장소 | 담당 에이전트 | 역할 |
|------|--------|---------------|------|
| **플랫폼** | `storige` (papascompany/storige-book-editor) | **Claude** | API · Worker · Editor · Admin · DB · VPS 배포 · 통합 문서 |
| **테넌트(쇼핑몰)** | `bookmoa-mobile` (storigehub/bookmoa-mobile) | **Codex** | Vercel 서버 어댑터 · React UI · webhook 수신 · Storige API 소비 |
| **운영·판정** | — | **사용자(요한)** | Admin 매핑 · 브라우저 GA · 정책 결정 · Pilot GO/NO-GO |

**중요**: PHP 레거시 북모아 쇼핑몰은 **이번 v1에서 코드 변경 없음**. Phase 7 `PHP_NOTICE`는 **통보·회귀 체크용 문서**만 제공.

```
[고객 브라우저]
    bookmoa-mobile.vercel.app
        │  /api/storige/*  (Vercel Functions, API Key 서버 전용)
        ▼
    api.papascompany.co.kr  ← Storige API
        │  Bull queue
        ▼
    storige-worker  (validate / convert / synthesize / compose-mixed)
        │  webhook
        ▼
    bookmoa-mobile /api/storige/webhook  → Supabase p4-orders

[편집기]
    iframe → editor.papascompany.co.kr
        postMessage (editor.complete, editor.needAuth)
        ▲
    StorigeEditorHost.jsx (bookmoa-mobile)
```

---

## 2. 사용자 확정 결정사항 (6건) — 전원 반영 완료

| # | 결정 | Claude (플랫폼) | Codex (mobile) |
|---|------|-----------------|----------------|
| 3-1 | 게스트 작업 24h 후 자동 삭제 | DB EVENT + `event_scheduler=ON` | EditorHost 상단 안내 배너 |
| 3-2 | PDF 페이지수 < 내지 수 | 고객 선택 모달(자동 확장) | (에디터 내 처리, mobile은 PDF 업로드 검증 별도) |
| 3-3 | PDF 첨부 후 일부 편집 | **불허**(배타) API 가드 | 업로드 vs 셀프편집 게이트 유지 |
| 3-4 | 워커 검증 실패 | 첨부 거부 | `failed` 시 장바구니 불가 |
| 3-5 | 레더 커버 미리보기 | `coverPreviewImage` 컬럼·UI | ProductEditor placeholder / preview |
| 3-6 | 게스트→회원 전환 시점 | 저장(편집완료) 시 `editor.needAuth` | 로그인 후 `migrate-guest` 호출 |

---

## 3. Claude 작업 (Storige 플랫폼)

**저장소**: `/Users/yohan/claude/Bookmoa Storige editor/storige`  
**최신 HEAD**: `c48e21e` (Phase 8 문서)  
**운영**: VPS API/Worker + Vercel Editor/Admin

### 3.1 완료 내역 — Phase별

| Phase | 커밋 | Worker | Editor | API/Admin | DB |
|-------|------|--------|--------|-----------|-----|
| **1** | `7a4443e` | — | — | `POST /storage/upload-public` (게스트 50MB) | — |
| **2** | `8aedc9c` | — | — | 게스트/PDF/면지/레더 스키마 | 마이그레이션 + 24h EVENT |
| **P0** | `6b4de7d` | — | — | — | `event_scheduler=ON` 영구 |
| **3** | `d8f4e81` | — | — | Admin TemplateSetForm | `template_sets` 확장 |
| **4** | `9491fe2` | 검증 연동 | 게스트·PDF첨부·레더커버 UI | guest 세션 API | `file_edit_sessions` 확장 |
| **5** | `50c0d1c` | **`compose-mixed` 핸들러** | `EditorWorkflowControls` 와이어링 | `POST /worker-jobs/compose-mixed` | — |
| **6** | `b45f614` | — | `GuestAuthPrompt`, `/my-works` | migrate, my-sessions | — |
| **7** | `ae59dd1` | (문서) | (문서) | PHP_NOTICE + 부록 | — |
| **8** | `c48e21e` | (문서) | EDITOR §13, SKILL | RESUME 2026-05-20 | — |

### 3.2 완료 내역 — Worker 상세

| 기능 | 상태 | 설명 |
|------|------|------|
| 기존 `validate` / `convert` / `synthesize` | ✅ 유지 | PHP·bookmoa 기존 흐름 회귀 없음 |
| **`compose-mixed`** | ✅ 신규 | 표지+면지+내지 PDF+면지 합본 → `merged.pdf` |
| Webhook `synthesis.completed` | ✅ 확장 | `result.capability = 'compose-mixed'`, `outputFileUrl`, `totalPages` |
| fixable 자동 convert | ❌ 미구현 | v1 follow-up 후보 |

**주요 파일 (참고)**:
- `apps/worker/src/processors/` — 큐 프로세서
- `apps/worker/src/services/pdf-synthesizer.service.ts` — 합본 로직
- `docs/PLATFORM_WORKER_INTEGRATION_v1.md` §12 — compose-mixed 명세

### 3.3 완료 내역 — Editor 상세

| 기능 | 상태 | 주요 컴포넌트 |
|------|------|----------------|
| 게스트 세션 | ✅ | guestToken 발급·PATCH |
| 내지 PDF 첨부 | ✅ | `ContentPdfAttachModal` |
| PDF↔편집 배타 | ✅ | API `PDF_ATTACHED_EXCLUSIVE` |
| 레더 커버 | ✅ | `LeatherCoverPreview`, coverEditable=false |
| 워크플로우 플로팅 UI | ✅ | `EditorWorkflowControls` |
| 편집완료 로그인 유도 | ✅ | `GuestAuthPromptModal` → `editor.needAuth` postMessage |
| 마이페이지 | ✅ | `/my-works` (`MyWorksView`) |
| embed postMessage | ✅ | `apps/editor/src/embed.tsx` |

### 3.4 완료 내역 — 문서·운영

| 항목 | 상태 |
|------|------|
| `docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md` | ✅ |
| `PLATFORM_INTEGRATION_v1.md` §11, `PLATFORM_WORKER_INTEGRATION_v1.md` §12 | ✅ |
| VPS API/Worker 재배포 | ✅ |
| MariaDB `20260519_v1_phase2_workflow_schema.sql` | ✅ |
| API health / Editor / Admin 200 | ✅ |

### 3.5 Claude — 작업 예정 (v1 polish / v2)

| 우선순위 | 항목 | 비고 |
|----------|------|------|
| P2 | compose-mixed Worker — **fixable 자동 보정** | 현재 통과/실패만 |
| P2 | `ContentPdfAttachModal` — fixable 시 convert 잡 자동 호출 | |
| P2 | `/my-works` — 페이지네이션·다운로드·삭제 | |
| P2 | `compose-mixed` endpoint 인증 가드 검토 | 현재 Public |
| v2 | Card imposition / JumboCard | 별도 스프린트 |
| v2 | Phase 9 Group B (Pilot 데이터 기반 UX) | GA 후 |

**Claude는 v1 범위 밖 신규 feature 없이 standby** — GA 실패 시 핫픽스만.

---

## 4. Codex 작업 (bookmoa-mobile)

**저장소**: `/Users/yohan/Documents/claude/bookmoa-mobile`  
**최신 HEAD**: `fb58751`  
**운영**: https://bookmoa-mobile.vercel.app (main push 자동 배포)

> ⚠️ Codex 터미널 cwd가 `storige`로 보여도 **커밋은 bookmoa-mobile**에만 합니다.

### 4.1 완료 내역 — 단계별

#### K1~K3 (Storige v1 사전 준비)

| ID | 커밋 | 내용 |
|----|------|------|
| K1 | `d27cd5e` | Phase 1+2 호환성 점검 문서 |
| K2-A | `8d3712d` | 게스트 24h 안내 배너 (`StorigeEditorHost`) |
| K2-B | `72a7441` | Cart 검증 상태 UI |
| K2-C | `bb900c5` | 레더 커버 placeholder |
| K2-D | `05ef6d4` | MyDesigns placeholder 라우트 |
| K3 | `6be49d7` | receiver outline (`storige_v1_receiver_outline.md`) |

#### M1~M4 (Phase 2 필드 · Admin · Orders)

| ID | 커밋 | 내용 |
|----|------|------|
| M1 | `7d10fdd` | ProductEditor Phase 2 필드 + cart normalize |
| M2 | `589aa58` | template-sets adapter passthrough |
| M3 | `5ba95b0` | Orders 검증 이슈 UI 고도화 |
| M4 | `04f1d4b` | 문서 + MyDesigns TODO |

#### Phase 3~4 (편집기 · 업로드 · 스모크)

| 커밋 | 내용 |
|------|------|
| `39067d3` | shop-session, template-sets, ProductEditor 조회 |
| `be602d6`~`55a87ea` | 파일 업로드·검증·polling·multipart 프록시 |
| `db3cd1e` | Phase 3+4 smoke checklist |
| `3261c2d` | Editor host + worker adapters (초기) |

#### Phase 5~6 (어댑터 · MyDesigns)

| 커밋 | 내용 |
|------|------|
| `425812e` | webhook compose-mixed capability passthrough 준비 |
| `b2a56ba` | `migrate-guest`, `my-sessions` adapter |
| `b4203a8` | MyDesigns 세션 목록 실연동 |
| `92234f2` | Vercel 함수 수 제한 — `[...storige].js` 통합 |

#### Phase 7 (PHP_NOTICE 반영 · needAuth · compose-mixed UI)

| 커밋 | 내용 |
|------|------|
| `1930274` | synthesize.js compose-mixed passthrough + 정책 메모 |
| `e47cc6e` | `editor.needAuth` → 로그인 → migrate-guest |
| `747405c` | Orders compose-mixed 완료 배지 + proxy-download |
| `fb58751` | smoke checklist 실행 기록 섹션 |

### 4.2 완료 내역 — Worker 연동 (bookmoa 측)

| API 어댑터 | Storige upstream | 상태 |
|------------|------------------|------|
| `api/storige/validate.js` | `POST /worker-jobs/validate/external` | ✅ |
| `api/storige/job-status.js` | job polling | ✅ |
| `api/storige/synthesize.js` | synthesize/external **또는** compose-mixed 분기 | ✅ |
| `api/storige/webhook.js` | 이벤트 → `p4-orders` 갱신 | ✅ |
| `api/storige/files/upload.js` | external upload 프록시 | ✅ |
| `api/storige/files/proxy-download.js` | 결과 PDF 프록시 | ✅ |

**의도적 미구현 (Codex 명시)**:
- ❌ 결제 후 **synthesize 자동 트리거**
- ❌ **fixable 자동 보정** UX

정책 문서: `bookmoa-mobile/docs2/storige_synthesize_policy.md`

### 4.3 완료 내역 — Editor 연동 (bookmoa 측)

| UI/흐름 | 파일 | 상태 |
|---------|------|------|
| iframe 편집기 | `StorigeEditorHost.jsx` | ✅ origin 검증, 24h 배너 |
| 편집 완료 수신 | postMessage `editor.complete` | ✅ |
| 게스트 로그인 유도 | `editor.needAuth` → Admin 로그인 → migrate | ✅ |
| PDF 업로드 패널 | `StorigeFileUploadPanel.jsx` | ✅ Configure/ProdConfigure |
| 내 디자인 | `MyDesigns.jsx` + my-sessions | ✅ |
| 상품 Storige 필드 | `ProductEditor.jsx` | ✅ |
| 장바구니/주문 | `Cart.jsx`, `Orders.jsx` | ✅ 상태·이슈·compose-mixed PDF |

### 4.4 Codex — 작업 예정

| 우선순위 | 항목 | 전제 |
|----------|------|------|
| **사용자 결정 후** | synthesize **자동 트리거** (결제 후 / webhook 연쇄) | `storige_synthesize_policy.md` §1~3 중 선택 |
| P2 | **fixable 자동 보정** UI·재검증 플로우 | Storige convert API 연동 |
| P2 | `editor-config` **보안 재검토** | `docs2/storige_editor_config_security.md` |
| P2 | `StorigeEditorHost` 접근성·복구(뒤로가기·focus) | |
| P2 | guestToken **저장 위치·UI** 일원화 | receiver outline §5 잔여 |
| P3 | 주문 상세 webhook 상태 **고도화** (Phase 7 본격) | GA 통과 후 |

---

## 5. 사용자(요한) 작업

### 5.1 완료로 간주되는 항목 (이미 하신 결정·확인)

| 항목 | 상태 |
|------|------|
| v1 Phase 1~8 **완료 확인** | ✅ |
| 6가지 결정사항(3-1~3-6) 확정 | ✅ |
| Claude VPS 배포·마이그레이션 | ✅ (RESUME 기준) |
| Codex Vercel 배포 (`fb58751` 이후) | ✅ |

### 5.2 지금 해야 할 작업 (Pilot GA)

**체크리스트**: [`docs2/V1_PILOT_GA_CHECKLIST.md`](./V1_PILOT_GA_CHECKLIST.md)

| 순서 | 작업 | 예상 시간 |
|------|------|-----------|
| 1 | **Storige Admin** — 템플릿셋·면지/표지/레더 설정, sortcode/stanSeqno 기록 | 20분 |
| 2 | **bookmoa Admin** — 동일 상품에 Storige 필드 매핑·템플릿셋 조회·저장 | 15분 |
| 3 | **Track C** — 편집기 iframe, PDF 업로드·검증, 장바구니 (C-J, C-K) | 30분 |
| 4 | **Track C** — 게스트 needAuth → 로그인 → migrate (C-L) | 15분 |
| 5 | **Track B** — editor.papascompany.co.kr 직접 (/my-works, PDF 첨부) | 15분 |
| 6 | **Track D** (선택) — PHP 쇼핑몰 1건 회귀 | 15분 |
| 7 | **§9 실행 기록** 표에 PASS/FAIL 기록 → **GO / NO-GO** 판정 | 5분 |

**bookmoa 상세 시나리오**:
- `bookmoa-mobile/docs2/storige_phase3_ui_체크리스트.md` (A~E)
- `bookmoa-mobile/docs2/storige_phase3_4_smoke_checklist.md` (A~I, J~N는 GA 문서)

### 5.3 GA 후 결정이 필요한 정책 (에이전트 대기)

| # | 질문 | 영향 |
|---|------|------|
| 1 | **synthesize 자동 호출** 시점? (결제 후 / 수동 / webhook 연쇄) | Codex `synthesize.js` + Orders |
| 2 | **fixable** 자동 보정 허용 여부? | Codex UI + Claude Worker |
| 3 | v2 우선순위: JumboCard vs card imposition vs Group B polish? | Claude/Gemini 스프린트 |
| 4 | Pilot 운영 **성공 지표** (검증 통과율, 게스트 전환율 등) | 모니터링 설계 |

### 5.4 실패 시 사용자 액션

1. 실패 시나리오 ID + 스크린샷/Network 일부 기록  
2. **플랫폼(API/Worker/Editor)** 이슈 → Claude + `storige` 이슈  
3. **쇼핑몰 UI/어댑터** 이슈 → Codex + `bookmoa-mobile` 이슈  
4. NO-GO 시 핫픽스 배포 후 **해당 시나리오만 재검증**

---

## 6. API · postMessage 계약 (양쪽 공통 참조)

### 6.1 Storige 신규/변경 endpoint (Claude 구현 → Codex 소비)

| Method | Path | 용도 |
|--------|------|------|
| POST | `/storage/upload-public` | 게스트 공개 업로드 |
| POST | `/edit-sessions/guest` | guestToken 발급 |
| PATCH | `/edit-sessions/guest/:id` | 게스트 세션 저장 |
| POST | `/edit-sessions/guest/migrate` | 회원 전환 |
| GET | `/edit-sessions/my` | 내 세션 목록 |
| POST | `/worker-jobs/compose-mixed` | 면지·PDF 합본 |

bookmoa 프록시 경로 예: `/api/storige/migrate-guest`, `/api/storige/my-sessions` (`[...storige].js`)

### 6.2 postMessage (Editor → 부모)

```js
// 편집 완료 (기존)
{ source: 'storige-editor', event: 'editor.complete', payload: { files: { coverFileId, contentFileId }, ... } }

// 게스트 저장 시 로그인 필요 (v1 Phase 6)
{ source: 'storige-editor', event: 'editor.needAuth',
  payload: { guestToken, reason: 'complete_save', ts } }
```

### 6.3 Webhook (Storige → bookmoa)

| 이벤트 | cart/order status |
|--------|-------------------|
| `validation.completed` | `validated` |
| `validation.fixable` | `fixable` |
| `validation.failed` | `failed` |
| `synthesis.completed` (+ `capability: compose-mixed`) | `completed` + PDF URL |

---

## 7. 저장소·문서 색인

| 문서 | 위치 | 용도 |
|------|------|------|
| 마스터 핸드오프 | `storige/.cursor/plans/RESUME_PROMPT_2026-05-20.md` | v1 완료 스냅샷 |
| **본 문서** | `storige/docs2/WORKER_EDITOR_INTEGRATION_HANDOFF.md` | Claude/Codex/사용자 분업 |
| Pilot GA | `storige/docs2/V1_PILOT_GA_CHECKLIST.md` | 사용자 검증 |
| PHP 통보 | `storige/docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md` | API·webhook·회귀 §9 |
| Worker 명세 | `storige/docs/PLATFORM_WORKER_INTEGRATION_v1.md` §12 | compose-mixed |
| bookmoa receiver | `bookmoa-mobile/docs2/storige_v1_receiver_outline.md` | Codex 스키마·endpoint |
| synthesize 정책 | `bookmoa-mobile/docs2/storige_synthesize_policy.md` | 자동 트리거 보류 |
| bookmoa AGENTS | `bookmoa-mobile/AGENTS.md` | Codex 상시 컨텍스트 |

---

## 8. 변경 이력

| 일시 | 변경 |
|------|------|
| 2026-05-20 | 최초 작성 — v1 Phase 1~8 완료 기준, Claude/Codex/사용자 분리, GA·예정 작업 정리 |
