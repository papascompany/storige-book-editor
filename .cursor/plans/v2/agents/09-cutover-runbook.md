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

## §4. 운영 컷오버 (4-2)

> 전제: Day 5의 PHP staging 회귀 4가지 모두 GREEN.

### 4.1 컷오버 윈도우 결정
- 한국 새벽 03:00~04:00 KST 권장 (트래픽 최저)
- 사용자에게 사전 공지 (10분 점검)

### 4.2 컷오버 절차
```
T-30min: 모니터링 셋업
   - SSH 2개 창 (api 로그 + worker 로그)
   - PHP 운영 로그 모니터링
   - DB 적체 모니터링
T-10min: PHP 운영 코드의 STORIGE_API_BASE 등 4개 변수 갱신
   - git push (또는 수동 배포)
T-0:    공지된 점검 시간 시작
T+0~5:  변경된 PHP가 반영됐는지 확인
   - PHP 서버 → curl https://api.papascompany.co.kr/api/health 200
   - 임시 사용자로 주문 1건 시도
T+5~30: 첫 실주문 모니터링
T+30:   정상 시 점검 종료 공지
T+24h:  무사고 시 옛 시스템 stand-by 종료
```

### 4.3 롤백 절차 (실패 시)
```
1. PHP의 STORIGE_API_BASE 등을 옛 값으로 되돌림 (1줄)
2. git revert 후 push
3. 새 시스템에서 처리 중이던 잡 정리 (paused 상태로 표시)
4. 사용자에게 알림 + 원인 분석 후 재시도
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
