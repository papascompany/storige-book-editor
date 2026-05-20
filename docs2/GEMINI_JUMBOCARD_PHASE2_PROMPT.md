# Gemini 작업 지시 — JumboCard Studio · Storige 연동 Phase 2 (어댑터 + E2E)

> **용도**: Gemini CLI 터미널에 붙여넣거나 `@docs2/GEMINI_JUMBOCARD_PHASE2_PROMPT.md` 로 참조  
> **작성일**: 2026-05-20  
> **대상 저장소**: `/Users/yohan/Documents/claude/PrintCard Studio` (JumboCard Studio)  
> **전제**: Phase 1 준비(G1~G3, J1~J4) 완료 (`f8a3310`). Storige v1 Phase 1~8 완료 (`c48e21e`).

---

## 0. 역할·경계

| 항목 | 내용 |
|------|------|
| **당신(Gemini)** | JumboCard Studio 레포만 수정·커밋 |
| **Claude** | `storige` API/Worker/Editor — **write 금지** |
| **Codex** | `bookmoa-mobile` — **write 금지** |
| **사용자** | Storige Admin 사이트 등록, Vercel env, E2E 브라우저 클릭 |

**한국어로 최종 보고**하세요.

---

## 1. Phase 1 완료 요약 (다시 하지 말 것)

| 단계 | 상태 | 산출물 |
|------|------|--------|
| G1~G3 | ✅ | 리브랜딩, `Integration_Impact_Analysis_v2.md`, skeleton 문서 |
| J1 | ✅ | `SITE_REGISTRATION_RUNBOOK.md` |
| J2 | ✅ | `_client`, shop-session, webhook, upload, job-status, `StorigeEditorHost` 스켈레톤 |
| J3 | ✅ | `CARD_IMPOSITION_vs_V1_WORKFLOW.md` — **compose-mixed 미사용**, synthesize-imposition 병렬 |
| J4 | ✅ | `JUMBOCARD_BRANDING.md` |

**Phase 2 목표**: 스켈레톤 → **실제 주문 플로우 연결** + **validate/synthesize/download** 어댑터 + **E2E 스모크 문서**.

---

## 2. 사용자 선행 작업 (미완이면 Phase 2 코드만 하고 smoke는 SKIP)

아래가 없으면 **API 실호출 smoke 금지** — 어댑터·체크리스트·목업만 작성.

- [ ] `SITE_REGISTRATION_RUNBOOK.md` §2 — Storige Admin에 JumboCard 사이트 등록
- [ ] Vercel env 5종: `STORIGE_API_BASE`, `STORIGE_API_KEY`, `STORIGE_EDITOR_URL`, `STORIGE_WEBHOOK_URL`, `STORIGE_WEBHOOK_VERIFY_HEADER`
- [ ] (권장) `JUMBOCARD_BRANDING.md` — 운영 도메인 확정

---

## 3. 부트스트랩

```bash
cd "/Users/yohan/Documents/claude/PrintCard Studio"
git pull origin main
git status

# 미커밋 린트 수정이 있으면 먼저 정리 (upload/route.ts, StorigeEditorHost.tsx)
pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm --filter @jumbocard/web build 2>/dev/null || pnpm --filter web build 2>/dev/null || (cd apps/web && pnpm build)

# secret 클라이언트 노출 검사
rg "STORIGE_API_KEY|NEXT_PUBLIC_STORIGE" apps/web/src/ || true
# apps/web/src 에서 0건이어야 함 (api route 제외 server only)
```

**read-only 참조** (수정 금지):

| 경로 | 용도 |
|------|------|
| `/Users/yohan/Documents/claude/bookmoa-mobile/api/storige/` | 어댑터 패턴 원본 |
| `/Users/yohan/claude/Bookmoa Storige editor/storige/docs/PLATFORM_INTEGRATION_v1.md` | 외부 연동 계약 |
| `/Users/yohan/claude/Bookmoa Storige editor/storige/docs/PHP_NOTICE_2026-05-19_pdf_attach_endpapers.md` | v1 endpoint·webhook |
| `docs/integrations/storige/CARD_IMPOSITION_vs_V1_WORKFLOW.md` | JumboCard는 compose-mixed **사용 안 함** |

---

## 4. 작업 P2-0 — 작업트리 정리 (~15min)

1. `apps/web/src/app/api/storige/files/upload/route.ts`  
2. `apps/web/src/components/integrations/storige/StorigeEditorHost.tsx`  

미커밋 변경이 있으면 린트 통과 후 커밋:

```
fix(storige): lint/type cleanup for upload route + EditorHost
```

---

## 5. 작업 P2-1 — validate + job-status 보강 (~1h)

### 목적
카드/책자 공통 PDF 검증 프록시 (JumboCard는 주로 **편집기 출력물** 검증에 사용).

### 생성
`apps/web/src/app/api/storige/validate/route.ts`

### 참조
`bookmoa-mobile/api/storige/validate.js`

### 요구사항
- `POST` only
- Body: `fileId` 또는 `fileUrl`, `fileType`, `orderOptions` (object)
- Upstream: `POST /worker-jobs/validate/external`
- `callbackUrl` 기본값: `process.env.STORIGE_WEBHOOK_URL`
- 응답: `{ jobId, ... }` 정규화
- `_client.ts`의 `storigeFetch` 사용; JSON 에러 시 4xx/5xx 매핑

### job-status
기존 `job-status/route.ts`가 `GET ?jobId=` 프록시인지 확인. 없으면 bookmoa `job-status.js` 패턴으로 보강.

커밋: `feat(storige): validate + job-status adapter for JumboCard`

---

## 6. 작업 P2-2 — synthesize 어댑터 (~1h)

### 목적
인쇄용 PDF 합성 요청 프록시.

### 생성
`apps/web/src/app/api/storige/synthesize/route.ts`

### 중요: JumboCard 분기 규칙

| capability | JumboCard |
|------------|-----------|
| `compose-mixed` (v1 책자) | **구현하지 않거나** 400 + "JumboCard does not use compose-mixed" |
| `synthesize/external` (기존 표지+내지+책등) | ✅ **당분간 이것만** |
| `synthesize-imposition` (카드 조판) | ⏳ Storige Worker 미구현 — **501 + 문서 링크** 또는 주석 TODO |

bookmoa `synthesize.js`의 compose-mixed 분기는 **복사하지 말 것**.

### synthesize/external payload (최소)
- `coverFileId` / `coverUrl`
- `contentFileId` / `contentUrl`
- `spineWidth` (또는 `spineWidthMm`)
- `callbackUrl`, `orderId` / `orderSeqno`

Upstream: `POST /worker-jobs/synthesize/external`

커밋: `feat(storige): synthesize adapter (external only; imposition stub)`

---

## 7. 작업 P2-3 — 결과 PDF proxy-download (~45min)

### 목적
클라이언트에 Storige storage URL 직접 노출 금지 (D-6).

### 생성
`apps/web/src/app/api/storige/files/proxy-download/route.ts`  
(또는 `download/route.ts` — monorepo 기존 naming 확인 후 하나로 통일)

### 참조
`bookmoa-mobile/api/storige/files/proxy-download.js`

### 요구사항
- Query: `fileId` 또는 Storige가 요구하는 식별자
- 서버에서 Storige API Key로 스트리밍 프록시
- `Content-Disposition: attachment` 권장

커밋: `feat(storige): proxy-download for result PDFs`

---

## 8. 작업 P2-4 — webhook → JumboCard 주문 상태 (~1.5h)

### 목적
`webhook/route.ts` 스켈레톤을 **실제 persistence**로 연결.

### 이벤트 매핑 (bookmoa와 동일 계약)

| Storige event | 내부 status |
|---------------|-------------|
| `validation.completed` | `validated` |
| `validation.fixable` | `fixable` |
| `validation.failed` | `failed` |
| `synthesis.completed` | `completed` |
| `synthesis.failed` | `failed` |

### 서명
- `identifier = jobId ?? sessionId`
- `data = \`${identifier}:${event}:${timestamp}\``
- `signature = base64(utf8(data))`
- Header: `STORIGE_WEBHOOK_VERIFY_HEADER` (기본 `X-Storige-Signature`)
- `X-Storige-Retry: 1` → 서명 누락 허용

### 저장소
JumboCard 기존 주문 DB 패턴 확인 후:
- Supabase / Prisma / 내부 `orders` 테이블 중 **프로젝트 표준**만 사용
- 신규 테이블 추가는 최소화 — 기존 order snapshot 필드에 `storige: { status, jobId, outputFileUrl, capability }` 형태

**`result.capability === 'compose-mixed'`** 는 JumboCard에서 무시해도 됨.

커밋: `feat(storige): webhook persistence for order status`

---

## 9. 작업 P2-5 — StorigeEditorHost 실연동 (~2h)

### 목적
스켈레톤을 **실제 주문/견적 화면**에 연결.

### 작업
1. `StorigeEditorHost` postMessage 처리 보강:
   - `editor.ready`, `editor.save`, `editor.complete`, `editor.cancel`, `editor.error`
   - `editor.complete` → `payload.files.coverFileId`, `contentFileId` (중첩)
   - `editor.needAuth` (게스트) — JumboCard에 로그인 UI가 있으면 migrate 연동; 없으면 TODO 문서화
2. `shop-session` 호출 → iframe URL에 `accessToken` / template 파라미터 전달
3. 편집 완료 시 부모 페이지 state 또는 API에 `sessionId`, `fileId` 저장
4. **24h 게스트 안내** 배너 (bookmoa `StorigeEditorHost` 참고)

### 금지
- `postMessage`에 `targetOrigin: '*'` 사용 금지
- `event.origin` 검증 필수 (`STORIGE_EDITOR_URL` origin)

커밋: `feat(web): wire StorigeEditorHost to order flow`

---

## 10. 작업 P2-6 — E2E 스모크 체크리스트 문서 (~30min)

### 생성
`docs/integrations/storige/E2E_SMOKE_CHECKLIST.md`

### 시나리오 (사용자 브라우저 수동)

| ID | 시나리오 | 기대 |
|----|----------|------|
| E1 | shop-session → 편집기 iframe 로드 | 200, 캔버스 표시 |
| E2 | 편집 저장 / complete | postMessage 수신, sessionId 저장 |
| E3 | (선택) PDF 업로드 → validate → job-status | passed 또는 fixable |
| E4 | synthesize 수동 호출 (관리자/개발자) | jobId, webhook `synthesis.completed` |
| E5 | proxy-download | PDF 다운로드, API Key 미노출 |
| E6 | DevTools 보안 | Network에 `sk-storige-` 없음 |

§ **실행 기록** 표 (PASS/FAIL/날짜/메모) 포함.

커밋: `docs(storige): E2E smoke checklist for JumboCard Phase 2`

---

## 11. 작업 P2-7 — 정책 메모 (~20min)

### 생성/갱신
`docs/integrations/storige/SYNTHESIZE_POLICY.md`

bookmoa `storige_synthesize_policy.md`와 동일 결론:

- **결제 후 자동 synthesize**: 보류 (사용자 결정 전 구현 금지)
- **초기 운영**: 관리자/개발자 수동 호출 권장
- **synthesize-imposition**: Storige Worker 구현 대기 (Claude v2)

---

## 12. 검증 (Gemini가 실행)

```bash
cd "/Users/yohan/Documents/claude/PrintCard Studio"
pnpm build   # apps/web 빌드 통과

rg "STORIGE_API_KEY|NEXT_PUBLIC_STORIGE" apps/web/src/
# client 번들 경로에서 0건

rg "compose-mixed" apps/web/src/app/api/storige/synthesize/
# JumboCard synthesize에 compose-mixed 분기 없어야 함 (또는 명시적 400)
```

**사용자 env + 사이트 등록 완료 시에만** (선택):

```bash
# 로컬 .env.local 있을 때만 — 실키 로그 금지
curl -s -X POST http://localhost:3000/api/storige/shop-session \
  -H "Content-Type: application/json" \
  -d '{"sortcode":"TEST","stanSeqno":1}' | head -c 200
```

---

## 13. Storige 플랫폼 의존 (Gemini가 구현하지 않음)

| 기능 | 상태 | 담당 |
|------|------|------|
| `synthesize-imposition` Worker | ❌ 미구현 | Claude (v2) |
| 센서 마커 Admin 설정 | ❌ | Claude (v2) |
| v1 `compose-mixed` | ✅ (책자용) | JumboCard **불사용** |

P2-2에서 imposition은 **stub(501/TODO)** 만 두고, 실 Worker 연동은 Phase 3로 분리.

---

## 14. 커밋 전략

한 작업 단위 = 한 커밋 (위 P2-0 ~ P2-7).  
완료 후 `git push origin main`.

---

## 15. 최종 보고 템플릿

```markdown
## JumboCard Storige Phase 2 완료 보고

### 커밋 목록
- P2-0: ...
- P2-1: ...
- ...

### 빌드/린트
- pnpm build: PASS/FAIL
- secret scan: N건

### 사용자 수동 작업 (남음)
- [ ] SITE_REGISTRATION ...
- [ ] Vercel env ...
- [ ] E2E_SMOKE_CHECKLIST E1~E6 실행

### 의도적 미구현
- synthesize-imposition (Storige Worker 대기)
- compose-mixed
- 결제 후 자동 synthesize

### Claude/Codex 대기
- synthesize-imposition capability → Phase 3
```

---

## 16. 금지 사항

- `storige`, `bookmoa-mobile` 저장소 **write·commit·push 금지**
- VPS SSH / MariaDB INSERT **실행 금지** (Runbook 복붙만)
- API Key·service role **실값** 코드/문서/커밋 금지
- `apps/web` 핵심 편집기·결제 로직 **대규모 리팩터 금지** — 연동 레이어만
- bookmoa의 `compose-mixed` / `migrate-guest` / `my-sessions` 를 JumboCard에 **무분별 복사 금지** (필요 시 별도 설계)

---

## 17. 참고 문서 색인

| 문서 | 위치 |
|------|------|
| Phase 1 지시 (완료) | `storige/.tmp_gemini_jumbocard_phase_next_prompt.md` |
| Worker/Editor 핸드오프 | `storige/docs2/WORKER_EDITOR_INTEGRATION_HANDOFF.md` |
| bookmoa Pilot GA | `storige/docs2/V1_PILOT_GA_CHECKLIST.md` |
| JumboCard Phase 1 Runbook | `PrintCard Studio/docs/integrations/storige/SITE_REGISTRATION_RUNBOOK.md` |
