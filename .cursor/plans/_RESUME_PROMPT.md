# 새 세션 시작용 프롬프트 (v8)

> 새 Claude Code 세션을 열고 아래 블록을 그대로 복사해서 입력하면 됩니다.
> 이 문서는 지우지 말고 보관하세요.
>
> **버전**: v8 (2026-04-28 야간, nimda PHP 통합 분석 완료 + 컷오버 단순화 확정)
> **이전 버전**: v7 (VPS 운영 검증) → v6 (외부 점검 정합화) → v5 (P1+P5) → v4 → v3 → v2 — git history에 보존

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지)

[Storige 인수 프로젝트 재개 — 2026-04-28 야간, nimda PHP 통합 분석 완료, 컷오버 단순화 확정]

# 한 줄 요약
인프라 + Day 1 + D1/D4 + P1+P5 + 외부 점검 정합화 + VPS 운영 검증 + **nimda PHP 키 호환 (`sk-storige-l3YV...` API_KEYS 추가, PHP 코드 0줄 변경)** + **두 storige 인프라 동시 가동 확인** (옛 `58.229.105.98:4000` + 새 `api.papascompany.co.kr`). **컷오버 = bookmoa의 `STORIGE_API_URL` 1줄만 변경**. 다음은 **자체 시뮬레이션(옵션 A) → bookmoa staging 검증 → 컷오버**.

# 인프라 현황 — 2026-04-28 야간 기준
- **옛 운영** `http://58.229.105.98:4000` — 인수 전 운영 storige (북모아 서버 내 Node.js v20 위에서 가동 추정). uptime 62일, validation 큐 106건 처리 이력. **현재 nimda PHP가 호출 중**. 우리는 접근 불가.
- **신규 운영** `https://api.papascompany.co.kr` — Vultr VPS, P1+P5+정합화 모두 가동. nimda PHP 키도 등록 완료. 외부 트래픽 0.
- **Vercel editor** `https://editor.papascompany.co.kr` — 새 useWorkSave/FileType 정합화 반영(`ozrgut9x1` Ready).
- **북모아 서버** `bookmoa.noriter.co.kr` (Ubuntu 22.04 + Apache + PHP 8.1 + Node 20). 우리 storige 레포의 `test-php/php/` 그대로 `/editor/`에 배포 (`index.php`, `editor.php`, `callback.php`, `webhook.php`). worker-test.php는 북모아 자체 추가본.

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
- ✅ **nimda PHP 통합 분석 + API 키 호환** (2026-04-28 야간)
  - 첨부 안내(`nimda_storige_연동_안내.md`) 분석: nimda 측 `load_storige_files.php`가 `GET /api/edit-sessions/external?orderSeqno=...` 호출, 응답 `files{cover,content,merged}`에 STORIGE_API_URL prefix 붙여 다운로드
  - 원본 레포(`blueamethyst/storige`) clone → 우리 fork master와 100% 동기화 확인 (모든 최근 커밋 동일)
  - 북모아 PHP 운영 `bookmoa.noriter.co.kr/editor/` = storige 레포의 `test-php/php/` 그대로 배포 확인
  - nimda PHP 키 `sk-storige-l3YVceH0sB739pgTfxRAxZAmLJROcMtgdKPIDYdVG0g` 새 인프라 `.env` API_KEYS에 추가 + `docker compose up -d --force-recreate api`
  - 두 인프라 동일 키로 동일 schema 응답 확인 (`{"success":true,"data":[]}`)
  - **결과: 컷오버 = bookmoa의 STORIGE_API_URL 1줄 변경. PHP 코드 0줄 변경 가능.**
- 🔵 **다음**: 옵션 A — 자체 시뮬레이션 (PHP 흐름 7단계 자동 검증) → bookmoa staging 협조 검증 → 운영 컷오버
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
