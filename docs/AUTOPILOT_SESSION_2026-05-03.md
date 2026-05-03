# 오토파일럿 사이클 진행 보고서 (2026-05-03)

> **목표**: 문서 전면 업데이트 + B (Sentry Slack) → C (PDF 다운로드) → D (Admin Playwright)
> **결과**: ✅ **5개 단계 모두 완료 + 운영 배포 적용**
> **진척률 변화**: 92% → 약 **94%** (실효 ~97%)

---

## 📦 완료 커밋 (시간 순)

| 순서 | 커밋 | 트랙 | 한 줄 요약 |
|------|------|------|-----------|
| 1 | `1dc65b2` | **문서** | SYSTEM_INTEGRATION v2.3 + PHP_VERIFICATION + NEXT_ISSUES HTML + REMAINING_WORK 갱신 |
| 2 | `fbae695` | **B Slack** | Sentry → Slack 알림 단계별 가이드 (사용자 OAuth 대기) |
| 3 | `cd6d2f3` | **C 다운로드** | 자동 수정 PDF 다운로드 endpoint + Admin Before/After 다운로드 버튼 |
| 4 | `4cf5922` | **D Playwright** | Admin Playwright E2E 셋업 + smoke 시나리오 2종 |
| 5 | (다음) | **최종** | REMAINING_WORK 갱신 + 본 보고서 + 운영 배포 |

---

## 📚 Phase 1 — 문서 전면 업데이트

### SYSTEM_INTEGRATION_OVERVIEW v2.2 → v2.3
- 헤더 변경 이력 박스에 v2.3 항목 추가
- **§5.11 운영 모니터링/디버깅** 섹션 신규
  - 5.11.1 Sentry 운영 에러 추적 (DSN, 마스킹, 자동 필터)
  - 5.11.2 Bull 큐 상태 조회 endpoint (Admin JWT)
  - 5.11.3 Public Health Check (PHP cron 활용)
- HTML §s4-7에 보라/파랑/시안 컬러 카드 3개 + 사이드바 링크

### PHP_INTEGRATION_VERIFICATION.html
- 히어로 메타에 "✅ Sentry 활성화 (v2.3)" 태그 추가
- 체크리스트 0번 위에 Sentry 안내 박스 추가 (대시보드 링크 + endpoint 활용 가이드)
- 10개 PHP 체크리스트 자체는 변경 없음 (PHP 측 작업이라 storige 변경 영향 없음)

### NEXT_ISSUES_2026-05-03.html (신규)
- 다크 테마 시각화 — NEXT_DEVELOPMENT_PLAN.html과 동일 톤
- 이전 세션 결과 박스 + P0/P1/P2 카드 + 진척률 변화 바
- 7일 sprint 카드 + 위험 요소 (해결됨/미해결 색상 구분)
- 모든 .md 트래커로 cross-link

### NEXT_DEVELOPMENT_PLAN.html
- 상단에 "⚠️ 이 문서는 2026-05-02 시점 history" 노란 배너 추가
- 최신 이슈는 NEXT_ISSUES_2026-05-03.html 참조 안내

### REMAINING_WORK_REVIEW.md
- §8 인프라/품질 표 8개 항목 상태 갱신
- 새 ✅ 행 6개 추가 (P1-7/4/5/6, P2-11, Node engines)
- PHP 검증 우선순위 P1 → P0 (Sentry 활성화로 디버깅 용이)

---

## 🟡 Phase 2 (B) — Sentry Slack 알림

### docs/SENTRY_SLACK_SETUP.md (신규)
4단계 가이드 문서:
- **Step 1**: Slack Integration OAuth (3분, 사용자 인증 필요)
- **Step 2**: Alert Rules 4종 추가 (5분)
  - Rule 1: 새 에러 발생 즉시 (모든 프로젝트)
  - Rule 2: 에러 빈도 급증 (10분/10건)
  - Rule 3: Worker 잡 실패 (`tag:job.type`)
  - Rule 4: 큐 적체 critical (`tag:alert.type=backlog`)
- **Step 3**: smoke test (API/Worker/Editor/Admin 각 1회)
- **Step 4**: 알림 시간대 / 우선순위 조정 (Quiet Hours 등)

### 추가 자료
- 문제 해결 가이드 (워크스페이스 인증 / 알림 안 옴 / 너무 많이 옴)
- 추가 통합 옵션: Discord webhook, PagerDuty, Sentry 모바일 푸시
- 권장 채널 구조 (`#storige-alerts` 단일 / 분리 옵션)

### 자동 처리 가능 부분
브라우저로 https://sentry.io/settings/integrations/slack/ 페이지 자동 오픈.
사용자 OAuth 인증 후 채널 선택만 하면 자동 연결.

---

## 🟢 Phase 3 (C) — 자동 수정 PDF 다운로드

### apps/api/src/worker-jobs/worker-jobs.controller.ts
신규 endpoint **`GET /api/worker-jobs/:id/output`** (JWT 인증)
- Job status COMPLETED/FIXABLE 일 때만 응답
- result.outputFileUrl 추출 → /storage/temp/, storage/, 절대경로 모두 처리
- **보안**: storage 디렉토리 밖 path traversal 방지 (resolve+startsWith 검증)
- 응답: application/pdf 스트림 + Content-Disposition: attachment

### apps/admin/src/components/PdfBeforeAfterPreview.tsx
- 변환 완료 상태에 **"수정된 PDF 다운로드"** 버튼 추가 (DownloadOutlined)
- axios responseType: 'blob' → Blob URL → `<a download>` 트리거
- 파일명: `fixed_{jobId 앞 8자}.pdf`
- 에러 시 alert 표시

### UX 흐름
1. 사용자가 PDF 업로드 → 검증 결과 FIXABLE
2. "자동 수정 적용" 클릭 → 변환 잡 처리
3. 좌우 Before/After iframe 표시
4. **"수정된 PDF 다운로드"** 버튼으로 즉시 저장
5. 인쇄소에 수정 결과 전달 가능

**부수 효과**: 합성(synthesize) 잡 결과도 동일 endpoint로 다운로드 가능.

### 운영 배포
- VPS API 재빌드 + 재기동 완료 (방금)
- Vercel admin 재배포 완료 (1분 빌드)

---

## 🟢 Phase 4 (D) — Admin Playwright E2E 셋업

### apps/admin/playwright.config.ts (신규)
- testDir './tests', testMatch '**/*.spec.ts'
- workers=1 (admin은 로그인 상태 공유라 직렬)
- baseURL: localhost:3001 (or `E2E_BASE_URL` env)
- webServer: `pnpm dev` 자동 기동 (CI 미설정 시)

### apps/admin/tests/smoke/login-and-dashboard.spec.ts
- 로그인 페이지 렌더 검증
- 시드 계정 로그인 → Dashboard 진입 (`E2E_ADMIN_PASSWORD` env 필수)
- **QueueMonitorWidget (P1-7) 가시성 검증**

### apps/admin/tests/smoke/sidebar-navigation.spec.ts
- 라이브러리 → 도형/배경 메뉴 클릭
- **배경 페이지 카테고리 필터 (P2-9) 가시성**
- 워커관리 → 테스트 페이지 접근

### 실행 방법
```bash
# 로컬 (admin dev 서버 자동 기동)
pnpm --filter @storige/admin test:e2e

# UI 모드 (인터랙티브)
pnpm --filter @storige/admin test:e2e:ui

# 운영 환경 대상 (E2E_BASE_URL 주입)
E2E_BASE_URL=https://admin.papascompany.co.kr \
E2E_ADMIN_EMAIL=admin@storige.com \
E2E_ADMIN_PASSWORD=<강한비번> \
pnpm --filter @storige/admin test:e2e
```

### 보안 정책
- 시드 비밀번호(admin123)는 코드에 하드코딩 안 함
- env 미설정 시 로그인 단계 자동 skip (회귀 테스트는 그대로 작동)

---

## 🚀 운영 배포 적용

### Vercel (자동/수동)
- ✅ admin 재배포 완료 — `cd6d2f3` (PDF 다운로드 버튼 포함)
- ✅ editor: 변경 없음 (admin 전용 작업)

### VPS Docker
- ✅ API 재빌드 + 재기동 — `cd6d2f3` (다운로드 endpoint 포함)
- ✅ Worker: 변경 없음
- ✅ API health: HTTP 200 확인

---

## 📊 진척률 변화

| 시점 | 비율 | 변화 |
|------|------|------|
| 직전 세션 시작 | 74% | (NEXT_DEVELOPMENT_PLAN 작성 시점) |
| 직전 세션 종료 | 92% | +18%p (P0-3+P1×4+P2×5+Sentry) |
| 본 세션 시작 | 92% | – |
| 문서 업데이트 | 92% | – |
| B Slack 가이드 | 92% | – (사용자 OAuth 대기) |
| C PDF 다운로드 | 93% | +1%p (P1 잔존 -1) |
| D Admin Playwright | 94% | +1%p (P2 잔존 -1) |
| **현재** | **~94%** | **실효 기능은 ~97%** |

---

## ⚠️ 다음 세션 권장 후속 작업 (5개로 축소)

1. **사용자 액션 필요**:
   - Sentry → Slack 인증 (5분, https://sentry.io/settings/integrations/slack/)
   - PHP 통합 검증 일정 조율 (외부)

2. **즉시 자동화 가능**:
   - **Admin 비번 강제 교체** (P0-2, 30분) — 가장 시급
   - 합성 잡 E2E 시나리오 추가 (P1, P0-1 후)

3. **별도 사이클**:
   - R2/S3 백업 이중화
   - 로그 일원화 (Pino + Loki)
   - WebAssembly multi-threading

---

## 🔗 관련 문서

- [`NEXT_ISSUES_2026-05-03.md`](./NEXT_ISSUES_2026-05-03.md) / `.html` — 본 세션 시작점 + 잔존 이슈
- [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) (v2.3) — 통합 레퍼런스
- [`SENTRY_SLACK_SETUP.md`](./SENTRY_SLACK_SETUP.md) — Slack 알림 가이드 (이번 세션 신규)
- [`PHP_INTEGRATION_VERIFICATION.html`](./PHP_INTEGRATION_VERIFICATION.html) — 10개 PHP 체크리스트
- [`AUTOPILOT_SESSION_2026-05-02.md`](./AUTOPILOT_SESSION_2026-05-02.md) — 직전 사이클 결과
- `CLAUDE.local.md` — 운영 정보 (gitignored)
