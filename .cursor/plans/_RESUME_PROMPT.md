# 새 세션 시작용 프롬프트 (v2)

> 새 Claude Code 세션을 열고 아래 블록을 그대로 복사해서 입력하면 됩니다.
> 이 문서는 지우지 말고 보관하세요.
>
> **버전**: v2 (2026-04-27)
> **이전 버전(v1)**: 인수 시점 — 이 파일의 git history에서 확인 가능

---

## 복사용 프롬프트 (이 줄 아래부터 끝까지)

[Storige 인수 프로젝트 재개 — 2026-04-27 이후]

# 현재 상태 (한 줄 요약)
인수 후 인프라 Phase 1\~3 (Vultr Seoul VPS + Vercel Editor/Admin + HTTPS + DB 23 테이블) 완료.
이전 개발자 흔적은 모두 분리 (옛 fork archived). 다음은 PHP 연동 + 코드 보완 (P1\~P7) + 운영 컷오버.

# 환경 (사실)
- **레포**: `https://github.com/papascompany/storige-book-editor` (PUBLIC, master). 옛 fork(`papascompany/storige`)는 archived.
- **VPS**: `158.247.235.202` (Vultr Seoul, 4vCPU/8GB/160GB, Ubuntu 22.04, KST 시간대). SSH `ssh deploy@158.247.235.202` (key-only).
- **API HTTPS**: `https://api.papascompany.co.kr/api/health` (Let's Encrypt, deploy hook 등록됨)
- **Editor**: `https://editor.papascompany.co.kr` (Vercel storige-editor)
- **Admin**: `https://admin.papascompany.co.kr` (Vercel storige-admin)
- **DNS**: NS = DNSEver (5개), 도메인은 가비아 등록
- **Vercel API 변경**: 두 프로젝트 모두 `rootDirectory=apps/{editor,admin}`, `nodeVersion=20.x`
- **자동 백업**: 매일 03:00 KST `~/backup.sh` (DB+storage+.env, 7일 보존)
- **시크릿**: VPS의 `~/storige/.env` (chmod 600). 절대 깃에 커밋 금지.
- **Admin 시드**: `admin@storige.com` / `admin123` (즉시 변경 권장 — 이미 처리했으면 무시)

# 핵심 자료 (반드시 먼저 읽기)
1. `.cursor/plans/v2/NEW_DEV_PLAN.md` — 마스터 계획 (PHP 연동안 §3 포함)
2. `.cursor/plans/v2/NEW_DEV_GUIDE.html` — 시각화 가이드 (시스템 관계도/시퀀스/간트)
3. `.cursor/plans/v2/agents/00-orchestrator.md` — 진행 마스터
4. `.cursor/plans/v2/agents/01-php-integrator.md` — PHP 연동 (★ 가장 중요)

> 옛 자료(`.cursor/plans/*.md`, `*.html`, `migration/`)는 **참고 보관**. 진행은 v2/만 따라간다.
> `migration/` 폴더는 Supabase+Cloud Run 시나리오 — 채택 안 함.

# Phase 진행 상황 (마지막 업데이트 시점부터 갱신해서 사용)
- ✅ Phase 1\~3 인프라 (완료)
- ✅ Day 1-1 자동 백업 셋업 (완료)
- ⬜ Day 1-2 _RESUME_PROMPT v2 갱신 (이 문서, 진행 중)
- ⬜ Day 1-3 admin 비밀번호 변경 (사용자 액션)
- ⬜ Day 1-4 Supabase 프로젝트 Pause/Delete (사용자 액션)
- ⬜ Day 2\~4 P1 EditSession 완료 API → P5 PDF 내보내기 → P4 중철 imposition
- ⬜ Day 5 PHP staging 회귀 4종
- ⬜ Day 6 운영 컷오버 + 24h 모니터링
- ⬜ Week 2+ P2 썸네일, P3 안전장치, P6/P7
- ⬜ Week 3+ Cloudflare R2 백업 이중화

# 정리 항목 (보류 중인 사용자 액션)
- 🔴 Admin 비번 변경 (admin123 → 강한 비번)
- 🟡 Supabase 프로젝트(`tktucpwqxoqtlorahmod`) Pause 또는 Delete
- 🟡 (확인) Vercel `storige` (구) 프로젝트가 본인 것인지 검토
- 🟢 PHP 운영 도메인을 `~/storige/.env`의 `CORS_ORIGIN`에 추가 (컷오버 전)

# 부탁
1. 먼저 `.cursor/plans/v2/NEW_DEV_PLAN.md` §6 권장 순서 + 현재 todo 확인.
2. 마지막으로 끝낸 단계 다음부터 이어서 진행.
3. 파괴적 작업(DB 마이그레이션, DNS 변경, 운영 컷오버 등)은 사전 승인.
4. 모든 대화 한글, 코드 명령은 영문.
5. 진행 상황은 TodoWrite로 추적.

# 계정 / 콘솔 (필요 시 확인)
- GitHub: papascompany (yohan@papascompany.co.kr)
- Vercel: papas-yohan / Yohan's projects (`team_dOpgsAqfLyl4qNlVgSiFVm6B`)
- Vultr: yohan73@gmail.com Personal Org
- Gabia: papascompany (도메인 등록자)
- DNSEver: papascompany (DNS 관리)
- Google Workspace: yohan@papascompany.co.kr (admin)

# 자주 쓰는 명령
```bash
ssh deploy@158.247.235.202
ssh deploy@158.247.235.202 'cd ~/storige && git pull && docker compose up -d --build'
docker logs --tail 200 -f storige-api
docker logs --tail 200 -f storige-worker
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait
curl https://api.papascompany.co.kr/api/health
ssh deploy@158.247.235.202 ~/backup.sh
```

---

## 사용 팁

- 이 프롬프트는 **자기완결적**입니다. 이전 대화를 안 봐도 새 세션이 그대로 이어받습니다.
- 새 세션이 막히면 "**v2/NEW_DEV_PLAN.md과 v2/NEW_DEV_GUIDE.html 먼저 읽어줘**"라고 한 번 더 요청하세요.
- 단계가 진행될 때마다 위 "Phase 진행 상황" 체크박스를 갱신하세요.
- 이 문서는 git 추적 — 변경할 때 반드시 commit (커밋 메시지: `docs: resume prompt 갱신 — Day X-Y 완료`).
