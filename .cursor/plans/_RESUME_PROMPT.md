# 새 세션 시작용 프롬프트 (v11)

> 새 Claude Code 세션을 열고 아래 블록을 그대로 복사해서 입력하면 됩니다.
> 이 문서는 지우지 말고 보관하세요.
>
> **버전**: v11 (2026-04-29, P4 + 운영 안정화 + P2/P3 + CMYK 정리 + Admin 하드코딩 제거 완료)
> **이전 버전**: v10 (PHP 안내서) → v9 (옵션 A) → v8 (nimda 통합) → ... — git history

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지)

[Storige 인수 프로젝트 재개 — 2026-04-28 늦은 야간, 옵션 A 시뮬레이션 통과, Phase B(staging) 진입]

# 한 줄 요약
인프라 + Day 1 + D1/D4 + P1+P5 + 외부 점검 정합화 + VPS 운영 검증 + nimda PHP 키 호환 + **옵션 A 자체 시뮬레이션 통과(7단계 + worker→API 정합 + webhook 송신 + nimda schema 일치)**. 시뮬 중 **신규 차단 버그 2건 발견·수정** (RelationId read-only `378fd08` + docker-compose worker env 누락 `c4b5ec0`). **컷오버 = bookmoa Apache vhost의 `STORIGE_API_URL` 1줄만 변경 (사용자가 bookmoa PHP 서버 개발자에게 전달 예정)**. 다음은 **Phase B(bookmoa staging 검증) → 컷오버**.

# 인프라 현황 — 2026-04-28 야간 기준
- **옛 운영** `http://58.229.105.98:4000` — 인수 전 운영 storige (북모아 서버 내 Node.js v20 위에서 가동 추정). uptime 62일, validation 큐 106건 처리 이력. **현재 nimda PHP가 호출 중**. 우리는 접근 불가.
- **신규 운영** `https://api.papascompany.co.kr` — Vultr VPS, P1+P5+정합화 모두 가동. nimda PHP 키도 등록 완료. 외부 트래픽 0.
- **Vercel editor** `https://editor.papascompany.co.kr` — 새 useWorkSave/FileType 정합화 반영(`ozrgut9x1` Ready).
- **북모아 서버** `bookmoa.noriter.co.kr` (Ubuntu 22.04 + Apache + PHP 8.1 + Node 20). 우리 storige 레포의 `test-php/php/` 그대로 `/editor/`에 배포 (`index.php`, `editor.php`, `callback.php`, `webhook.php`). worker-test.php는 북모아 자체 추가본.

# 환경 (사실 — 변경 시 갱신)

## Admin 두 종류 동시 가동 중 (혼동 주의)
- **Vercel admin** `https://admin.papascompany.co.kr` — papascompany 인수팀이 새로 배포한 admin (우리 git의 apps/admin 빌드)
- **북모아 정적 admin** `https://bookmoa.noriter.co.kr/storige-admin/` — 북모아 서버의 Apache 정적 호스팅, Vite 빌드물 (옛 storige 개발자가 배포). JS 번들 내부에 `baseURL="/storige-api"` 상대 경로 사용 → Apache `ProxyPass /storige-api/`가 forward
- **VPS docker admin** ❌ 제거됨 — 한 번도 빌드/가동된 적 없음. 운영 영향 0. (52947ca에서 docker-compose 정의에서 제외)
- **컷오버 시** — bookmoa Apache vhost의 `ProxyPass /storige-api/` 한 줄 변경 → 북모아 정적 admin도 자동으로 새 인프라 연동. 빌드 다시 안 함.

## 운영 중인 7개 페이지 (모두 `/storige-api` proxy 사용)
- `bookmoa.noriter.co.kr/editor/{index,editor,callback,webhook,worker-test}.php`
- `bookmoa.noriter.co.kr/storige-admin/` (정적 SPA)
- nimda 모듈 (Apache `SetEnv STORIGE_API_URL` 직접 사용)
- 모두 `proxy_pass.html` §04 두 줄 변경으로 일괄 전환

- **레포**: `https://github.com/papascompany/storige-book-editor` (PUBLIC, master). 옛 fork(`papascompany/storige`)는 archived.
- **VPS**: `158.247.235.202` (Vultr Seoul, 4vCPU/8GB/160GB, Ubuntu 22.04, KST 시간대). SSH `ssh deploy@158.247.235.202` (key-only, NOPASSWD sudo, root 차단).
- **API HTTPS**: `https://api.papascompany.co.kr/api/health` (Let's Encrypt, deploy hook 등록).
- **Editor**: `https://editor.papascompany.co.kr` (Vercel storige-editor, master 자동 빌드).
- **Admin**: `https://admin.papascompany.co.kr` (Vercel storige-admin).
- **DNS**: NS = DNSEver (5개), 도메인은 가비아 등록.
- **자동 백업**: 매일 03:00 KST `~/backup.sh` (DB + storage + .env, 7일 보존).
- **시크릿**: VPS의 `~/storige/.env` (chmod 600). 절대 깃에 커밋 금지.
- **Admin 시드**: `admin@storige.com` / `admin123` (개발 끝난 후 변경 예정 — 사용자 결정).
- **CORS**: API 측이 `*.vercel.app` + `*.papascompany.co.kr` 자동 허용 (커밋 `133570c`).

# 핵심 자료 (반드시 먼저 읽기)
1. `.cursor/plans/v2/NEW_DEV_PLAN.md` — 마스터 계획 (PHP 연동안 §3 포함)
2. `.cursor/plans/v2/NEW_DEV_GUIDE.html` — 시각화 가이드
3. `.cursor/plans/v2/agents/00-orchestrator.md` — 진행 마스터
4. `.cursor/plans/v2/agents/01-php-integrator.md` — PHP 연동 (★, Day 5 회귀 + 컷오버 대비)
5. `.cursor/plans/v2/agents/06-saddle-stitch-orderer.md` — P4 중철 imposition (선택)
6. `.cursor/plans/v2/agents/03-edit-session-completer.md` — P1 완료 가이드 (참고용)
7. `.cursor/plans/v2/agents/07-pdf-export-implementer.md` — P5 완료 가이드 (참고용)

> 옛 자료(`.cursor/plans/*.md`, `*.html`, `migration/`)는 **참고 보관**. 진행은 v2/만 따라간다.
> `migration/` 폴더(Supabase+Cloud Run 시나리오)는 채택 안 함.

# Phase 진행 상황
- ✅ Phase 1\~3 인프라 (Vultr+Docker+DNS+HTTPS+Vercel)
- ✅ Day 1-1 자동 백업 (cron 03:00 KST + logrotate + certbot deploy hook)
- ✅ Day 1-2 _RESUME_PROMPT v2 갱신
- ✅ Day 1.5 6개 메뉴 활성화 검증
- ✅ Day 1.4 Supabase Pause/Delete (사용자 완료)
- ⏸ Day 1-3 admin 비번 변경 — 개발 끝난 후로 보류 (사용자 결정)
- ✅ 디자인 D1: 헤더 그라데이션 (violet-200 → white)
- ✅ 디자인 D4: 책자 페이지 네비 (BookNavigation, 우/하단 토글, PageThumbnail 카드, useEditorStore.setPages 동기화, inline layout)
- ✅ CORS 패턴 매칭 (Vercel preview + papascompany.co.kr 자동 허용)
- ✅ feat/design-refresh master 머지 완료 (커밋 `14d0944`)
- ✅ Day 2-4 **P1 EditSession 완료 API 연동** (커밋 `f4c5129`, 2026-04-28)
  - `useWorkSave.completeSpreadWork`에서 `editSessionsApi.update` + `complete` 호출
  - server `validateSpreadSnapshot` → `createValidationJobs` 자동 트리거
  - iframe `parent.postMessage({type:'storige:completed'})` 추가
- ✅ Day 2-4 **P5 PDF 내보내기 placeholder 제거** (커밋 `971b0e9`, 2026-04-28)
  - `editor.service.exportToPdf`가 `workerJobsService.createSynthesisJob` 호출
  - EditorModule에 EditSessionsModule + WorkerJobsModule import
  - 응답 `{ jobId, status }`로 확장
- ✅ **외부 점검(GPT-5 + 추가 분석) 정합화 5건** (2026-04-28 PM)
  - `ddb780b` worker PATCH 경로 `/external/` 통일 (synthesis + conversion 401 차단)
  - `5c4145a` FileType enum 백엔드 일치 (design/output 제거 → cover/content/template/other)
  - `8c383de` 스프레드 모드 완료 흐름 정합 (storageApi → filesApi.upload + 내지 multi-page 병합 + spread 시 자동 검증 잡 스킵)
  - `190daf0` spread webhook을 WebhookService 단일 채널로 통일 (sendSpreadWebhook 제거)
  - `70bb9be` P5 exportToPdf의 잘못된 entity 검증 제거 (editor 모듈 EditSession ≠ edit-sessions 모듈 EditSessionEntity, 별개 테이블)
- ✅ **VPS 운영 배포·검증** (2026-04-28 저녁)
  - master로 브랜치 전환 (feat/design-refresh에서 떠나) + 41 커밋 fast-forward
  - api + worker 재빌드 (admin은 기존 빌드 실패로 제외, Vercel admin이 별도 운영)
  - nginx upstream 캐시 → restart로 502 해결
  - `POST /api/editor/export` 운영 테스트: 빈 세션에 호출 → `COVER_FILE_REQUIRED` 정확 응답 (P5 합성 파이프라인 정상 동작 확인)
  - Vercel editor 빌드 성공 (ozrgut9x1) — useWorkSave + FileType 정합화 모두 반영
- ✅ **nimda PHP 통합 분석 + API 키 호환** (2026-04-28 야간)
  - 첨부 안내(`nimda_storige_연동_안내.md`) 분석: nimda 측 `load_storige_files.php`가 `GET /api/edit-sessions/external?orderSeqno=...` 호출, 응답 `files{cover,content,merged}`에 STORIGE_API_URL prefix 붙여 다운로드
  - 원본 레포(`blueamethyst/storige`) clone → 우리 fork master와 100% 동기화 확인 (모든 최근 커밋 동일)
  - 북모아 PHP 운영 `bookmoa.noriter.co.kr/editor/` = storige 레포의 `test-php/php/` 그대로 배포 확인
  - nimda PHP 키 `sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g` 새 인프라 `.env` API_KEYS에 추가 + `docker compose up -d --force-recreate api`
  - 두 인프라 동일 키로 동일 schema 응답 확인 (`{"success":true,"data":[]}`)
  - **결과: 컷오버 = bookmoa의 STORIGE_API_URL 1줄 변경. PHP 코드 0줄 변경 가능.**
- ✅ **옵션 A — 자체 시뮬레이션 (PHP 흐름 7단계)** (2026-04-28 늦은 야간)
  - Step 1: `POST /auth/shop-session` (X-API-Key) → 사용자 JWT 발급 ✓
  - Step 2: `POST /edit-sessions` (사용자 JWT) → 세션 생성 ✓
  - Step 3-4: `POST /files/upload/external` (X-API-Key) → cover/content PDF 업로드, files entity 생성 ✓
  - Step 5a-b: `PATCH /edit-sessions/:id` + `complete` → coverFileId/contentFileId 정상 저장 + status=complete ✓
  - Step 6: `POST /worker-jobs/synthesize/external` → 잡 발행, PENDING ✓
  - Step 7: `GET /edit-sessions/external?orderSeqno=...` → **첨부 명세 schema 100% 일치** ✓
  - Worker→API status PATCH 정상 (PROCESSING→FAILED 전이) → #2 정합화 검증
  - bookmoa(webhook.site) 콜백 정상 송신 (`X-Storige-Signature` + 표준 payload) → #5 정합화 검증
  - minimal PDF 한계로 worker 합성 자체는 "Invalid URL" 에러 (실 PDF로는 통과 예상) — bookmoa staging에서 추가 검증
- ✅ **시뮬 중 발견·수정한 신규 차단 버그 2건**
  - `378fd08` EditSession `coverFileId`/`contentFileId`가 update/create에서 저장 안 됨 (`@RelationId` read-only, ManyToOne relation 통해 set 필요)
  - `c4b5ec0` docker-compose.yml worker 컨테이너에 `API_BASE_URL` + `WORKER_API_KEY` env 누락 (worker→API 401 원인)
- ✅ **컷오버 분담 정책 결정** (2026-04-28 늦은 야간)
  - 사용자: 본 작업 완료 후 **bookmoa Apache vhost의 `STORIGE_API_URL` 변경**을 북모아 PHP 서버 개발자에게 전달
  - 우리: Phase B(bookmoa staging 협조 검증)까지 진행, 컷오버 자체는 미수행
- ✅ **bookmoa 서버 토폴로지 정확 확인 + PHP 개발자 안내서 작성** (2026-04-28 자정 직전)
  - bookmoa staging의 `/storige-api/`는 Apache `ProxyPass`로 옛 인프라(58.229.105.98:4000)에 forward 중 (uptime 일치 검증)
  - nimda PHP는 Apache `SetEnv STORIGE_API_URL`로 storige base URL 주입 (첨부 안내 명시)
  - 변경 대상 = Apache vhost 2줄: ① ProxyPass URL ② SetEnv STORIGE_API_URL
  - PHP 개발자 안내서 작성: `.cursor/plans/proxy_pass.html` (시각화 + Step별 절차 + FAQ + 기술 부록)
- ✅ **Phase B 결정 — 옵션 3(컷오버 직행) 진행**
  - 이유: 옵션 A 자체 시뮬레이션으로 핵심 흐름 모두 검증됨. bookmoa staging nginx 변경 권한이 별도 PHP 개발자에게 있어 검증 시점 미정
  - 사용자가 proxy_pass.html을 PHP 개발자에게 전달 → PHP 개발자가 staging→운영 순으로 실행
  - 우리는 다음 우선순위 작업으로 이동
- ✅ **A 운영 안정화** (2026-04-28 야간)
  - A-1 self-monitor: `scripts/monitor.sh` cron 5분마다 (헬스/큐/컨테이너/디스크) → 로그 + (옵션 Discord webhook) (`52947ca`)
  - A-2 admin docker-compose 제거: VPS docker admin은 한 번도 가동 안 됨, Vercel admin이 운영 (`52947ca`)
  - admin SPA 정합성 명시 — bookmoa.noriter.co.kr/storige-admin/는 북모아 정적 호스팅 + JS 번들의 `baseURL="/storige-api"` (실측), Apache ProxyPass 변경 시 자동 새 인프라 연동 (`fb91ce3`)
- ✅ **B 트랙 P2 + P3** (2026-04-28 야간)
  - P2 sharp 이미지 썸네일 구현: `storage.service.generateThumbnail` placeholder → 실제 sharp 리사이즈 + EXIF 회전 + JPEG quality 80 (`5bad19e`)
  - P3 템플릿셋 삭제 안전장치: `template-sets.service.remove` 사용 중 검증 (활성 상품 + active 세션 카운트, 사용 중이면 BadRequest with usage details) (`5820713`). 운영 검증 통과
- ✅ **P4 saddle stitch (중철 imposition)** (2026-04-29)
  - `composeSaddleCover` + `composeSaddleContent` 구현 (`3739a00`)
  - bindingType propagation 수정 (`b107805`)
  - downloadFile 운영 차단 버그 수정 (`f0fc02e`)
  - VPS 운영 4페이지 더미 PDF로 검증 통과
- ✅ **CMYK 스텁 dead code 정리** (2026-04-29) (`72177cf`)
  - `@pf/color-runtime` import 0건 + canvas-core가 이미 legacy fallback만 사용 → stub 작동할 일 없는 dead code였음을 grep으로 검증
  - vite.config + vite.embed.config의 `colorRuntimeStubPlugin` + `optimizeDeps.exclude` 제거
  - `apps/editor/src/lib/colorRuntimeStub.ts` 파일 삭제
  - ColorPickerModal CMYK→RGB의 dead `await import` catch fallback 제거
- ✅ **Admin 승인자 ID 하드코딩 제거 (P0-A)** (2026-04-29)
  - `apps/admin/src/pages/Reviews/ReviewDetail.tsx:84,101`의 `'admin'` 문자열 하드코딩을 `useAuthStore` 통한 실제 로그인 사용자 ID로 교체
  - 승인/반려 시 `reviewerId = currentUser?.id ?? 'admin'` 사용 → 검토 이력에 정확한 승인자 추적 가능
- 🔵 **다음**: 사용자 결정 — `#3 sessionId additive` webhook payload 보강(10분), D3 ruler 스타일 리프레시(1-2시간), D2-NEW 메뉴 아이콘 PNG 업로드 시스템(3시간) 등

# 보류 목록 (제일 마지막 단계 — 서비스 오픈 후 선택적)
> 운영 안정화 + 후속 기능 모두 끝난 뒤 마무리로 진행. 서비스 오픈 후 필요 시 선택적으로 도입.
- ⏸ **R2 백업 이중화** (원래 Week 3+) — Cloudflare R2 동기화. 현재는 VPS 로컬 cron 03:00 7일 보존
- ⏸ **Admin 비번 변경** (`admin@storige.com / admin123`) — 운영 컷오버 직전·직후 사용자 결정으로 변경
- ⏸ **A-3 Sentry 에러 추적** — `@sentry/node`로 NestJS api+worker unhandled exception 자동 추적. 무료 티어(5k events/mo) 또는 GlitchTip self-host 옵션
- ⏸ **A-4 외부 Uptime Monitor** — UptimeRobot 등으로 `/api/health` 1~5분 간격 외부 점검 (VPS 자체 장애 시 알림 수신용, 자체 monitor.sh와 보완 관계)
- ⏸ **Discord webhook 알림** — 자체 monitor.sh의 알림을 Discord 채널로 받기 (사용자가 webhook URL 발급 후 .env에 `DISCORD_WEBHOOK_URL` 추가하면 즉시 활성)
- ⏸ **GraphQL TODO 폐기** — `apps/editor/src/hooks/useEditorContents.ts:824` `loadContentEditor`(EditorView.tsx의 `'content-edit'` 모드 전용, bookmoa 운영 흐름과 무관 — embed.tsx는 `loadTemplateSetEditor`만 사용) + `apps/editor/src/generated/graphql.ts` stub 파일. 서비스 운영 후 문제 없으면 제거. 코드 grep으로 호출자 0건 확인됨.
- ⏸ **CMYK ICC 도입** — `@pf/color-runtime` 같은 외부 라이브러리로 CMYK↔RGB 변환을 ICC 프로파일 기반으로 정확화. 인쇄 정확도가 운영 이슈가 되면 그때 도입. 현재는 legacy 단순 수식 변환으로 동작.
- ⬜ Day 5 PHP staging 회귀 4종
- ⬜ Day 6 운영 컷오버
- ⬜ Week 2+ P2 썸네일, P3 안전장치, P6/P7
- ⬜ Week 3+ Cloudflare R2 이중화
- ⬜ (컷오버 후) D2-NEW 메뉴 아이콘 PNG 업로드 시스템 (`agents/10-...md`)
- ⬜ (컷오버 후) D3 눈금자 스타일 (`agents/11-...md`)
- ⬜ (운영 후) 표지 편집 모드별 view 분기 (`agents/12-...md`)

# 즉시 다음 작업: 옵션 A — 자체 시뮬레이션 (PHP 흐름 7단계)
가이드: `.cursor/plans/v2/agents/01-php-integrator.md`

## 컷오버 단순화 — 결정 사항
- bookmoa nimda PHP는 운영에서 변경 없음 (NEW_DEV_PLAN §3.5 정합)
- 변경하는 것: bookmoa Apache vhost의 `SetEnv STORIGE_API_URL` 1줄
  - 옛 값: `http://58.229.105.98:4000/api`
  - 새 값: `https://api.papascompany.co.kr/api`
- `STORIGE_API_KEY` (`sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g`)는 변경 없음 — 새 인프라가 이 키를 인식하도록 등록 완료

## PHP 흐름 7단계 (자체 시뮬레이션)
1. JWT 발급 (admin 로그인) — 에디터용 토큰
2. EditSession 생성 (orderSeqno + memberSeqno + mode + callbackUrl)
3. 표지 PDF 업로드 (`POST /files/upload/external`, X-API-Key)
4. 내지 PDF 업로드 (동일)
5. EditSession update (coverFileId/contentFileId) + complete
6. 합성 잡 발행 (`POST /worker-jobs/synthesize/external`, X-API-Key)
7. nimda 조회 endpoint (`GET /edit-sessions/external?orderSeqno=...`) → `files{cover,content,merged}` 검증
- + worker → callbackUrl webhook 수신 확인 (webhook.site 등)

## 검증 명령 (운영 점검)
```bash
# 두 인프라 동일 응답 비교 (nimda 키)
PHP_KEY="sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g"
curl -sS -H "X-API-Key: $PHP_KEY" "http://58.229.105.98:4000/api/edit-sessions/external?orderSeqno=1"
curl -sS -H "X-API-Key: $PHP_KEY" "https://api.papascompany.co.kr/api/edit-sessions/external?orderSeqno=1"

# DB 세션/잡
ssh deploy@158.247.235.202 'source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige -e "SELECT id, order_seqno, mode, status, completed_at FROM file_edit_sessions ORDER BY created_at DESC LIMIT 5;"'

ssh deploy@158.247.235.202 'docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait'

# 워커 로그
ssh deploy@158.247.235.202 'docker logs --tail 200 storige-worker | grep -iE "synthesis|validate|webhook"'
```

## 환경변수 메모 (nimda PHP에 주입할 값)
| 키 | 값 |
|---|---|
| `STORIGE_API_URL` | `https://api.papascompany.co.kr/api` |
| `STORIGE_EDITOR_URL` | `https://editor.papascompany.co.kr` |
| `STORIGE_API_KEY` | `sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g` (기존 값 유지) |
| `STORIGE_WEBHOOK_VERIFY_HEADER` | `X-Storige-Signature` |

# 더미 테스트 데이터 (이미 삽입됨, 그대로 사용 가능)
- templateSet: `ts-test` (book, single mode, 5페이지)
- 진입: `https://editor.papascompany.co.kr/?templateSetId=ts-test`
- DB 시드:
  - categories: cat-test
  - templates: tpl-cover, tpl-page-1\~4
  - template_sets: ts-test
  - template_set_items: tsi-1\~5

# 부탁
1. 먼저 `.cursor/plans/v2/NEW_DEV_PLAN.md` 와 위 Phase 진행 상황 확인.
2. 마지막으로 끝낸 단계(P5 완료, 커밋 `971b0e9`) 다음부터 이어서 진행.
3. Day 5 회귀 시 worker 측 `synthesis.processor.ts`의 webhook payload와 bookmoa PHP 핸들러 매핑이 일치하는지 사전 검토.
4. 파괴적 작업(DB 마이그레이션, DNS 변경, 운영 컷오버 등)은 사전 승인.
5. 모든 대화 한글, 코드 명령은 영문.
6. 진행 상황은 TodoWrite로 추적.

# 계정 / 콘솔
- GitHub: papascompany (yohan@papascompany.co.kr)
- Vercel: papas-yohan / Yohan's projects (`team_dOpgsAqfLyl4qNlVgSiFVm6B`)
- Vultr: yohan73@gmail.com Personal Org
- Gabia: papascompany (도메인 등록자)
- DNSEver: papascompany (DNS 관리)
- Google Workspace: yohan@papascompany.co.kr (admin)
- Vercel API token: `~/Library/Application Support/com.vercel.cli/auth.json`의 `.token` (필요 시 직접 API 호출)

# 자주 쓰는 명령
```bash
# SSH
ssh deploy@158.247.235.202

# 코드 갱신 + 재배포
ssh deploy@158.247.235.202 'cd ~/storige && git checkout master && git pull && docker compose up -d --build'

# 로그
docker logs --tail 200 -f storige-api
docker logs --tail 200 -f storige-worker

# 큐 적체
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait

# 헬스체크
curl https://api.papascompany.co.kr/api/health

# 백업 즉시 실행
ssh deploy@158.247.235.202 ~/backup.sh

# Vercel 빌드 상태 (apps/editor 디렉터리에서)
vercel ls | head -8

# Vercel CORS 검증 (preview origin이 통과하는지)
curl -sS -H "Origin: https://storige-editor-XYZ.vercel.app" \
  -I "https://api.papascompany.co.kr/api/template-sets/ts-test/with-templates" | grep -i access-control
```

# 디자인 트랙 후속 (운영 안정화 후)
- D2-NEW: Admin에서 메뉴 아이콘 PNG 업로드 시스템 (`agents/10-menu-icon-asset-system.md`)
- D3: 눈금자 스타일 리프레시 (`agents/11-ruler-style-refresh.md`)
- D5: 표지 편집 모드별 view (`agents/12-cover-edit-modes.md`)
  - 펼침면/분할/날개 포함 표지/spine 포함 등 케이스별 캔버스·툴·네비 분기

---

## 사용 팁

- 이 프롬프트는 **자기완결적**입니다. 이전 대화를 안 봐도 새 세션이 그대로 이어받습니다.
- 새 세션이 막히면 "**v2/NEW_DEV_PLAN.md과 v2/NEW_DEV_GUIDE.html과 v2/agents/01-php-integrator.md 먼저 읽어줘**"라고 한 번 더 요청하세요.
- 단계가 진행될 때마다 위 "Phase 진행 상황" 체크박스를 갱신하세요.
- 이 문서는 git 추적 — 변경할 때 반드시 commit (커밋 메시지: `docs: resume prompt 갱신 — Day X 완료`).
- v5에서 변경된 점 (v4 대비):
  - P5 PDF 내보내기 placeholder 제거 완료 (`971b0e9`)
  - 합성 파이프라인이 end-to-end 동작 (P1 + P5 통합)
  - 다음 우선순위가 Day 5 PHP staging 회귀로 이동
- v8에서 변경된 점 (v7 대비):
  - nimda PHP 통합 분석 완료 — 첨부 안내 + 원본 레포 + 북모아 운영 페이지 매핑
  - nimda PHP 키 (`sk-storige-l3YV...`)를 새 인프라 API_KEYS에 추가 → PHP 코드 0줄 변경 가능
  - 컷오버 단순화 — bookmoa Apache vhost의 `STORIGE_API_URL` 1줄만 변경
  - 옛 인프라(58.229.105.98) 접근 불가 명시 — 비교는 응답 schema 수준만
- v9에서 변경된 점 (v8 대비):
  - 옵션 A 자체 시뮬레이션 7단계 + worker 정합 + webhook 송신 모두 통과
  - 신규 차단 버그 2건 수정·머지 (RelationId, docker-compose worker env)
  - 컷오버 분담 정책: 사용자가 PHP 서버 개발자에게 전달, 우리는 Phase B까지
  - 다음은 bookmoa staging 협조 검증
- v10에서 변경된 점 (v9 대비):
  - bookmoa 서버 토폴로지 정확 확인 (Apache ProxyPass + SetEnv 두 곳)
  - PHP 개발자 전달용 안내서 작성: `.cursor/plans/proxy_pass.html`
  - Phase B 결정: 옵션 3(컷오버 직행 — PHP 개발자에게 위임) 진행
  - 다음은 사용자 결정 작업 우선순위에 따라 후속 진행
- v11에서 변경된 점 (v10 대비):
  - A 운영 안정화 완료 (A-1 monitor.sh + A-2 admin 정리 + admin SPA 정합성)
  - B 트랙 P2(썸네일) + P3(템플릿 삭제 안전장치) 완료 + 운영 검증
  - P4 saddle stitch 중철 imposition 완료 (composeSaddleCover/Content + 2-up 합치기 + 운영 검증)
  - CMYK 스텁 dead code 정리 완료
  - Admin 승인자 ID 하드코딩(P0-A) 제거 완료
  - A-3 Sentry, A-4 Uptime monitor, Discord webhook, GraphQL TODO 폐기, CMYK ICC 도입 모두 보류 목록
