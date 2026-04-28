# 새 세션 시작용 프롬프트 (v4)

> 새 Claude Code 세션을 열고 아래 블록을 그대로 복사해서 입력하면 됩니다.
> 이 문서는 지우지 말고 보관하세요.
>
> **버전**: v4 (2026-04-28, P1 완료 시점)
> **이전 버전**: v3 (2026-04-28, P1 직전) → v2 (2026-04-27, Day 1-1 시점) — git history에 보존

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지)

[Storige 인수 프로젝트 재개 — 2026-04-28 이후, P1 완료, P5 직전]

# 한 줄 요약
인프라 Phase 1\~3 + Day 1 정리 + 디자인 D1/D4 + CORS 동적 허용 + **P1 EditSession 완료 API 연동(`f4c5129`)** 모두 master에 머지된 상태. 다음은 **P5 (PDF 내보내기 placeholder 제거)** 진입.

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
4. `.cursor/plans/v2/agents/07-pdf-export-implementer.md` — **다음 작업(P5) 가이드**
5. `.cursor/plans/v2/agents/03-edit-session-completer.md` — P1 완료 가이드 (참고용)
6. `.cursor/plans/v2/agents/01-php-integrator.md` — PHP 연동 (★)

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
- 🔵 **다음: Day 2-4 P5 PDF 내보내기 (placeholder 제거)** ⬅ 바로 시작
- ⬜ Day 2-4 P4 중철 imposition (선택)
- ⬜ Day 5 PHP staging 회귀 4종
- ⬜ Day 6 운영 컷오버
- ⬜ Week 2+ P2 썸네일, P3 안전장치, P6/P7
- ⬜ Week 3+ Cloudflare R2 이중화
- ⬜ (컷오버 후) D2-NEW 메뉴 아이콘 PNG 업로드 시스템 (`agents/10-...md`)
- ⬜ (컷오버 후) D3 눈금자 스타일 (`agents/11-...md`)
- ⬜ (운영 후) 표지 편집 모드별 view 분기 (`agents/12-...md`)

# 즉시 다음 작업: P5 PDF 내보내기 (placeholder 제거)
가이드: `.cursor/plans/v2/agents/07-pdf-export-implementer.md`

## 무엇을 하는가
`apps/api/src/editor/editor.service.ts:693~700`에서 PDF 내보내기 API가 `jobId: 'placeholder-job-id'`만 반환함. 실제 worker 합성 잡을 발행하도록 교체해야 PDF 합성 흐름이 동작.

## 위치
- `apps/api/src/editor/editor.service.ts:693~700` — placeholder

## 작업
1. `WorkerJobsService` 주입 (또는 BullQueue 직접 사용)
2. `createSynthesisJob({ sessionId, mode, items, callbackUrl, requestId })` 호출
3. 응답 스키마는 placeholder와 동일 형태(`{ jobId, status }`) 유지

## 검증
```bash
# DB에 worker_jobs 신규 행
ssh deploy@158.247.235.202
docker exec storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige \
  -e "SELECT id, job_type, status, created_at FROM worker_jobs ORDER BY created_at DESC LIMIT 5;"

# Bull 큐 등록 확인
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait

# 워커 로그
docker logs --tail 100 storige-worker | grep -i synthesis
```

## P1(완료) 검증 (참고)
```bash
docker exec storige-mariadb mariadb -ustorige -p$DATABASE_PASSWORD storige \
  -e "SELECT id, status, completed_at FROM edit_sessions ORDER BY updated_at DESC LIMIT 5;"
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
2. 마지막으로 끝낸 단계(P1 완료, 커밋 `f4c5129`) 다음부터 이어서 진행.
3. P5 작업 후 worker 측 `synthesis.processor.ts`의 결과 페이로드와 PHP webhook 핸들러 매핑이 일치하는지 확인.
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
- 새 세션이 막히면 "**v2/NEW_DEV_PLAN.md과 v2/NEW_DEV_GUIDE.html과 v2/agents/07-pdf-export-implementer.md 먼저 읽어줘**"라고 한 번 더 요청하세요.
- 단계가 진행될 때마다 위 "Phase 진행 상황" 체크박스를 갱신하세요.
- 이 문서는 git 추적 — 변경할 때 반드시 commit (커밋 메시지: `docs: resume prompt 갱신 — Day X 완료`).
- v4에서 변경된 점 (v3 대비):
  - P1 EditSession 완료 API 연동 완료 (`f4c5129`)
  - 다음 작업이 P5로 명시됨
  - 가이드 핵심 자료에 P5 가이드 문서 추가
