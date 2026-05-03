# Sentry → Slack 알림 채널 연결 가이드

> **상태**: ⏳ 대기 (사용자 OAuth 인증 필요)
> **소요 시간**: 약 5~10분
> **결과**: 운영 에러 발생 시 즉시 Slack 알림

---

## 📋 사전 준비

- ✅ Sentry 계정 (활성화 완료)
- ✅ Slack workspace (관리자 권한 또는 앱 설치 권한)
- ✅ Slack 채널 (예: `#storige-alerts` 또는 `#dev-alerts`)

---

## Step 1: Slack Integration 추가 (3분)

1. https://sentry.io/settings/integrations/slack/ 접속
2. **`Add Installation`** 또는 **`Configure`** 클릭
3. Sentry 조직 선택: **`papascompany`**
4. Slack workspace 선택 → **`Allow`** 클릭 (OAuth 인증)
5. 알림 받을 채널 선택 (예: `#storige-alerts`)

> ⚠️ Slack workspace 관리자가 별도 인증해야 하는 경우:
> Slack 관리자에게 "Sentry 앱 설치" 승인 요청 → 승인 후 Sentry로 돌아가서 4번 다시 시도

---

## Step 2: Alert Rules 추가 (5분)

각 프로젝트 (storige-api, -worker, -editor, -admin)별로 **Settings → Alerts → Create Alert** 에서 다음 4개 규칙 추가:

### Rule 1: 새 에러 발생 즉시 (모든 프로젝트 공통)

```yaml
Alert Name: New Error Detected
Type: Issue Alert

When (Conditions):
  - A new issue is created (single trigger)

Filter (Optional):
  - The event's level is equal to "error" or higher

Then (Actions):
  - Send a notification to Slack
    Workspace: papascompany (선택)
    Channel: #storige-alerts
    Tags: project, environment

Frequency: 30 minutes  (동일 issue 재알람 간격)
```

### Rule 2: 에러 빈도 급증 (10분 내 10건 이상)

```yaml
Alert Name: Error Spike
Type: Metric Alert (또는 Issue Alert + condition)

When:
  - Number of errors > 10
  - in time window 10 minutes

Then:
  - Send to Slack #storige-alerts
  - Severity: Warning
```

### Rule 3: Worker 잡 실패 (storige-worker만)

```yaml
Alert Name: Worker Job Failed
Type: Issue Alert

When:
  - A new issue is created

Filter:
  - The event has tag "alert.type" equal to "failed"
  - OR The event has tag "job.type" present

Then:
  - Send to Slack #storige-alerts (또는 별도 #worker-alerts)
  - Format: include job.id, job.queue, job.type tags
```

### Rule 4: Bull 큐 적체 알람 (storige-api만)

```yaml
Alert Name: Queue Backlog Critical
Type: Issue Alert

When:
  - A new issue is created

Filter:
  - The event has tag "alert.type" equal to "backlog"
  - The event level is "warning"

Then:
  - Send to Slack #storige-alerts
  - Format: include queue, queue_state context
```

---

## Step 3: 테스트 (smoke test)

각 프로젝트 알림이 정상 작동하는지 확인:

### API 테스트
```bash
# 의도적 5xx 에러 — Sentry 캡처되어야 함
curl -X POST https://api.papascompany.co.kr/api/some-trigger-error
```
→ 1~2초 내 Slack 채널에 알림 도착해야 함

### 큐 적체 테스트 (시뮬레이션)
1. Admin 워커 테스트 페이지에서 잘못된 PDF 10개 연속 업로드
2. Bull 큐 적체 발생 → 1분 후 QueueMonitorService가 알람 전송
3. Slack에 `[QueueAlert] pdf-validation backlog: waiting=10` 메시지 도착

### 프론트엔드 테스트 (브라우저 콘솔)
```javascript
// editor 또는 admin에서
throw new Error('Sentry Slack test from editor')
```
→ Slack에 storige-editor 이슈 알림 도착

---

## Step 4: 알림 시간대 / 우선순위 조정 (선택)

### Notification Settings (per-user)
1. 좌상단 프로필 아이콘 → **Settings → Notifications**
2. **Slack Notifications**:
   - **Issue Alerts**: All
   - **Workflow Notifications**: All
   - **Quiet Hours**: 22:00~08:00 (선택, 야간 무알림)

### Alert Rule 우선순위
- **Critical (즉시 알림)**: 5xx 에러, 큐 critical, Worker 실패
- **Warning (배치 알림)**: 큐 warning, 새 에러 (저빈도)
- **Info (Sentry만, Slack X)**: 단순 트랜잭션 추적

---

## 📊 권장 채널 구조

```
#storige-alerts       ← 모든 critical 에러 (운영자 대상)
#storige-worker-jobs  ← Worker 잡 실패 전용 (선택)
#storige-frontend     ← Editor/Admin 에러 (개발자 대상, 선택)
```

또는 단일 채널 사용 (`#storige-alerts`)도 충분 — Sentry 메시지에 자동 태그 포함됨.

---

## 🔧 문제 해결

### "Slack workspace 인증이 안 됨"
- Slack 관리자에게 Sentry 앱 설치 권한 요청
- 또는 `Slack > Apps > Manage > Pending Approvals`에서 승인

### "알림이 안 옴"
1. Sentry → 프로젝트 → Settings → Alerts → 활성화 여부 확인
2. Slack 채널에 Sentry 봇이 멤버로 추가되어 있는지 확인
3. Sentry 대시보드에서 이벤트는 도착하는데 Slack만 안 오는지 확인 (Sentry는 OK인데 Slack 연결만 끊긴 경우)

### "너무 많이 옴"
- Rule frequency 조정 (30 min → 1 hour)
- ignoreErrors 추가 (sentry.init.ts beforeSend 함수)
- 정상 비즈니스 흐름은 자동 필터됨 (4xx 등)

---

## ✅ 완료 체크리스트

```
☐ Sentry → Settings → Integrations → Slack 추가 완료
☐ Workspace OAuth 인증 완료
☐ 채널 (#storige-alerts) 선택
☐ 4개 프로젝트 각각에 Alert Rule 추가 (Rule 1~4)
☐ smoke test 진행 (API/Worker/Editor/Admin 각 1회)
☐ Quiet Hours 설정 (선택)
☐ 운영자 + 개발자 Slack 채널 멤버 추가
```

---

## 💡 추가 팁

### Discord 사용 시
Slack 대신 Discord webhook을 통해서도 알림 가능:
- Sentry → Settings → Integrations → Discord
- 또는 일반 webhook으로 Discord channel 연결

### 휴대폰 푸시
Sentry 모바일 앱 (iOS/Android) 설치 → 즉시 푸시 알림 가능 (Slack 안 써도 됨)

### 운영자 교대 (PagerDuty / OpsGenie)
긴급 에러는 Slack + 동시에 PagerDuty로 전달 가능 (별도 통합)

---

## 🔗 관련 문서

- [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) — Sentry 초기 설정 (활성화 완료)
- [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) §5.11.1 — Sentry 운영 추적 가이드
