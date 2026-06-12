---
name: cutover-runbook
description: 운영 컷오버 + 주변 정리 + 문서 보수. Day 1 정리 항목과 Day 6 컷오버 모두 담당.
model: sonnet
---

# 09. Cutover & Cleanup Runbook

## §1. Admin 비번 변경 (5-4)

```
1. https://admin.papascompany.co.kr 접속
2. admin@storige.com / admin123 로 로그인
3. 프로필 > 비밀번호 변경 (최소 12자, 대소문자 + 숫자 + 특수문자)
4. 새 비번을 안전한 비번 관리자(1Password/Bitwarden 등)에 보관
5. 다시 로그아웃 → 새 비번으로 로그인 검증
```

## §2. Supabase Pause/Delete (5-5)

```
1. https://supabase.com/dashboard 로그인 (yohan73@gmail.com)
2. 프로젝트 'tktucpwqxoqtlorahmod' 선택
3. Settings > General > Pause project (또는 Delete)
   - Pause: 청구 멈춤, 데이터 보존 (90일 후 자동 삭제)
   - Delete: 즉시 삭제, 복구 불가
4. NEW_DEV_PLAN.md §1.6 표 갱신 (paused/deleted 상태)
```

## §3. `_RESUME_PROMPT.md` 갱신

`.cursor/plans/_RESUME_PROMPT.md`를 다음 내용으로 교체:

```markdown
# 새 세션 재개용 프롬프트 (v2)

[Storige 인수 프로젝트 재개 — 2026-04-27 이후]

## 현재 상태
- 인프라 Phase 1~3 완료 (Vultr Seoul VPS + Vercel Editor/Admin + HTTPS)
- 새 레포: papascompany/storige-book-editor (PUBLIC, master)
- 옛 fork (papascompany/storige) 는 archived
- 도메인: api/editor/admin.papascompany.co.kr (DNSEver NS)

## 핵심 자료 (반드시 먼저 읽기)
1. .cursor/plans/v2/NEW_DEV_PLAN.md     ← 마스터 계획
2. .cursor/plans/v2/NEW_DEV_GUIDE.html  ← 시각화 가이드
3. .cursor/plans/v2/agents/00-orchestrator.md  ← 진행 마스터

## 환경 정보
- VPS: ssh deploy@158.247.235.202
- Vercel: papas-yohan, team_dOpgsAqfLyl4qNlVgSiFVm6B
- 시크릿: ~/storige/.env (직접 보관)

## 다음 작업
NEW_DEV_PLAN.md §6 권장 순서대로. 마지막 완료 단계는 todo list 참고.

## 부탁
- 모든 대화 한글, 코드 명령은 영문
- 파괴적 작업은 사전 승인
- 진행 상황은 TodoWrite로 추적
```

## §4. 운영 컷오버 (4-2) — 2026-04-28 야간 단순화

> 전제: Day 5 자체 시뮬레이션(옵션 A) GREEN. (bookmoa staging 회귀는 권한 가능 시 추가 검증으로 진행)
>
> **단순화 핵심**: nimda PHP 키 (`sk-storige-l3YV...`)가 새 인프라 `.env` API_KEYS에 등록 완료 (2026-04-28 야간). 따라서 **bookmoa Apache vhost의 `STORIGE_API_URL` 1줄만 변경하면 됨**. PHP 코드 0줄 변경.
>
> **PHP 개발자 전달용 자료**: [`.cursor/plans/proxy_pass.html`](../../proxy_pass.html)
> 사용자가 본 HTML 파일을 bookmoa PHP 서버 개발자에게 전달 → PHP 개발자가 자체 수행 (시각화 + Step별 절차 + FAQ + 롤백 포함). 본 cutover-runbook은 papascompany 인수팀의 진행 기록용.

### 4.1 컷오버 윈도우 결정
- 한국 새벽 03:00~04:00 KST 권장 (트래픽 최저)
- 사용자에게 사전 공지 (5분 점검 — 1줄 변경만이라 다운타임 거의 없음)

### 4.2 컷오버 절차 (단순화)
```
T-30min: 모니터링 셋업
   - SSH 2개 창 (api 로그 + worker 로그)
   - bookmoa Apache 로그 모니터링
   - DB 적체 모니터링 (file_edit_sessions, worker_jobs)

T-5min:  bookmoa Apache vhost 변경
   변경:  SetEnv STORIGE_API_URL "https://api.papascompany.co.kr/api"
   유지:  SetEnv STORIGE_API_KEY "sk-storige-l3YV..." (변경 없음)
          SetEnv STORIGE_EDITOR_URL "https://editor.papascompany.co.kr"
          SetEnv STORIGE_WEBHOOK_VERIFY_HEADER "X-Storige-Signature"

T-0:    apachectl graceful (다운타임 0)

T+0~5:  변경 반영 확인
   - 서버 PHP 측에서 echo $_SERVER['STORIGE_API_URL']
   - bookmoa.noriter.co.kr/editor/index.php에서 임시 주문 1건 시도

T+5~30: 첫 실주문 모니터링
   - api 로그: file_edit_sessions INSERT
   - worker 로그: synthesis 처리
   - bookmoa webhook 수신 (sessionId/jobId 매핑)
   - nimda "에디터파일" 탭 정상 표시

T+30:   정상 시 점검 종료 공지

T+24h:  무사고 시 옛 storige(58.229.105.98) stand-by 종료 결정
```

### 4.3 롤백 절차 (실패 시)
```
1. bookmoa Apache vhost의 STORIGE_API_URL을 옛 값으로 되돌림
   SetEnv STORIGE_API_URL "http://58.229.105.98:4000/api"
2. apachectl graceful (다운타임 0)
3. 옛 storige가 받지 못한 채 새 인프라에 들어간 잡:
   - 새 file_edit_sessions에 status='complete'인 row 식별
   - 옛 인프라가 처리할 수 있게 수동 동기화 또는 사용자에게 재편집 요청
4. 원인 분석 후 재시도
```

### 4.4 새 인프라에 등록된 nimda PHP 키 검증 (사전)
```bash
PHP_KEY="sk-storige-REDACTED_SEE_VPS_ENV"

# 두 인프라 동일 응답 확인 (변경 후에도 nimda는 그대로 동작)
curl -sS -H "X-API-Key: $PHP_KEY" "http://58.229.105.98:4000/api/edit-sessions/external?orderSeqno=1"
curl -sS -H "X-API-Key: $PHP_KEY" "https://api.papascompany.co.kr/api/edit-sessions/external?orderSeqno=1"
# 둘 다 {"success":true,"data":[...]} 형식이어야 함
```

## §5. (사후) 옛 'storige' Vercel 프로젝트 정리 검토

`vercel project ls`에서 보이는 `storige` (24.x, nextjs, 14일 전 마지막 변경)는 우리 시나리오 무관.
- 누가 만들었는지 확인 (다른 토이/구버전?)
- 우리가 만든 것이 아니면 그대로 두거나, 본인 작업이라면 archive 또는 삭제
- 결정 후 NEW_DEV_PLAN.md §1.6에 명시

## DoD
- [ ] §1~3 모두 완료
- [ ] §4 컷오버 후 24h 무사고
- [ ] _RESUME_PROMPT.md v2 반영
- [ ] §5 결정 + 문서 갱신
