# 새 세션 시작용 프롬프트 (v7)

> 새 Claude Code 세션을 열고 아래 블록을 그대로 복사해서 입력하면 됩니다.
> 이 문서는 지우지 말고 보관하세요.
>
> **버전**: v7 (2026-04-28 저녁, VPS 운영 검증 완료 + P5 추가 버그 수정)
> **이전 버전**: v6 (외부 점검 정합화) → v5 (P1+P5) → v4 → v3 → v2 — git history에 보존

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지)

[Storige 인수 프로젝트 재개 — 2026-04-28 저녁, VPS 운영 검증 완료, Day 5 PHP 회귀 직전]

# 한 줄 요약
인프라 Phase 1\~3 + Day 1 정리 + 디자인 D1/D4 + CORS 동적 허용 + **P1 EditSession 완료 API 연동(`f4c5129`)** + **P5 PDF 내보내기 worker 잡 발행(`971b0e9`)** + **외부 점검 정합화 5건(`ddb780b` ~ `190daf0`)** + **P5 추가 버그 수정(`70bb9be`)** + **VPS 운영 배포·검증 완료**. 다음은 **Day 5 PHP staging 회귀** (사용자 환경 정보 필요).

# 환경 (사실 — 변경 시 갱신)
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
- 🔵 **다음**: Day 5 PHP staging 회귀 4종 (사용자 환경 정보 필요)
- ⬜ Day 5 PHP staging 회귀 4종
- ⬜ Day 6 운영 컷오버
- ⬜ Week 2+ P2 썸네일, P3 안전장치, P6/P7
- ⬜ Week 3+ Cloudflare R2 이중화
- ⬜ (컷오버 후) D2-NEW 메뉴 아이콘 PNG 업로드 시스템 (`agents/10-...md`)
- ⬜ (컷오버 후) D3 눈금자 스타일 (`agents/11-...md`)
- ⬜ (운영 후) 표지 편집 모드별 view 분기 (`agents/12-...md`)

# 즉시 다음 작업: 우선순위 결정
P1 + P5 가 모두 끝나서 **합성 파이프라인이 end-to-end 로 동작**한다.
다음은 두 갈래:

## 옵션 A — Day 5 PHP staging 회귀 4종 (★ 권장)
가이드: `.cursor/plans/v2/agents/01-php-integrator.md`
- 컷오버(Day 6) 직전에 반드시 통과해야 하는 4종 시나리오
  - editor 신규 세션 → 완료 → worker 합성 → bookmoa webhook 수신
  - 기존 주문에서 sessionId 조회 (external API)
  - 표지/내지 분리 다운로드
  - 실패 케이스(파일 누락) 에러 흐름
- bookmoa PHP 측 webhook 핸들러 / external API 호출부 검토

## 옵션 B — P4 중철 imposition (선택)
가이드: `.cursor/plans/v2/agents/06-saddle-stitch-orderer.md`
- 4페이지 단위로 페이지 정렬 (1-N, 2-N+1...)
- 컷오버 후로 미뤄도 무방

## 검증 명령 (P1 + P5 통합)
```bash
# DB: 세션 + worker_job 동시 확인
ssh deploy@158.247.235.202
docker exec storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige \
  -e "SELECT id, status, completed_at FROM edit_sessions ORDER BY updated_at DESC LIMIT 5;"
docker exec storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige \
  -e "SELECT id, job_type, status, edit_session_id, created_at FROM worker_jobs ORDER BY created_at DESC LIMIT 5;"

# Bull 큐
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait
docker exec storige-redis redis-cli LLEN bull:pdf-validation:wait

# 워커 로그
docker logs --tail 200 storige-worker | grep -iE "synthesis|validate|webhook"

# editor /export API 직접 호출 (sessionId 필요)
curl -X POST https://api.papascompany.co.kr/api/editor/export \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"<UUID>","exportOptions":{"outputFormat":"merged"}}'
```

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
