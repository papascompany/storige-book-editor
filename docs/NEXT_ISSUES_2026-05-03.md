# 다음 개발 이슈 정리 (2026-05-03 기준)

> ⚠️ **이 문서는 2026-05-03 스냅샷입니다. 현재 마스터 트래커는 [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md) ([HTML](./MASTER_STATUS_2026-05-04.html))로 통합됐습니다.**

> **작성일**: 2026-05-03
> **이전 세션 결과**: P0-3 + P1×4 + P2×5 (11개 트랙) + Sentry 활성화 완료
> **누적 진척률**: 약 **92%** (실효 기능 ~96%)
> **기준 문서**: `NEXT_DEVELOPMENT_PLAN.md`, `REMAINING_WORK_REVIEW.md`, `FUTURE_UPDATES.md`, `AUTOPILOT_SESSION_2026-05-02.md`

---

## 🟢 이번 세션까지 완료된 항목 (변경 사항)

| 트랙 | 상태 변화 |
|------|----------|
| P0-3 Sentry SDK 통합 | ❌ → ✅ + **DSN 활성화 완료** (4개 프로젝트, production 배포) |
| P1-4 PDF Before/After 미리보기 | ⏳ → ✅ |
| P1-5 Composite multi-region | ⚠️ → ✅ (자동 재배치 + multi-region 정밀화) |
| P1-6 AI 패널 UI 통합 | ❌ → ✅ |
| P1-7 Bull 큐 모니터링 + 알람 | ❌ → ✅ + Sentry 알람 자동 발송 |
| P2-8 Playwright E2E | ⚠️ → ✅ smoke 시나리오 |
| P2-9 lint 에러 정리 | ⏳ → ✅ (5개 모듈 모두 0 errors) |
| P2-10 번들 최적화 | ❌ → ✅ |
| P2-11 fabric 다크모드 | ⚠️ → ✅ |
| P2-12 폰트 fallback 로그 | ❌ → ✅ |
| Sentry DSN 발급 + env 등록 | ❌ → ✅ |
| Node 20 → 22 engines 완화 | (신규) → ✅ |

---

## 🔴 P0 — 즉시 처리 필요 (운영 blocker, 남은 항목)

### 1. PHP ↔ Storige 양측 통합 검증
- **상태**: ⏳ 대기 (사용자/PHP 팀 영역)
- **storige 측**: 모든 변경 100% 완료 (v2.2 ENOENT 핫픽스 포함)
- **PHP 측**: 미적용
- **검증 대상**:
  - `width`/`height` URL 파라미터 → 옵션 C 동작
  - `/files/upload/external` `type` 필드 (v2.1 명시)
  - `/worker-jobs/synthesize/external` Webhook
  - `validation.completed` / `synthesis.completed` 양측 수신
- **참조 문서**: `SYSTEM_INTEGRATION_OVERVIEW.md` (v2.2), `BOOKMOA_INTEGRATION_DIFF.md`
- **예상 작업량**: PHP 측 1~2일 + 통합 0.5일
- **차단 요소**: PHP 팀 일정 / 환경변수 등록 (`STORIGE_API_KEY`, `STORIGE_API_URL`)

### 2. Admin 비밀번호 강제 교체
- **상태**: ❌ 미진행 (시드값 `admin@storige.com` / `admin123` 그대로)
- **위험도**: 🔴 (이미 깃 히스토리/문서에 노출)
- **필요 작업**:
  - VPS에서 admin 계정 비밀번호 강한 값으로 변경
  - DB UPDATE 또는 admin UI에서 직접 변경
  - `CLAUDE.local.md`의 시크릿 메모는 위치만 기록 (값 비포함)
- **예상 작업량**: 30분
- **즉시 가능**: 자동화 가능 (사용자 결정 후 즉시 처리)

---

## 🟡 P1 — 단기 (사용자 가치 큼)

### 3. PDF Synthesis E2E 검증
- **상태**: ⏳ 대기 (storige 측은 webhook 타입 정합 완료 `d2b3271`)
- **검증 시나리오**:
  - bookmoa PHP에서 `POST /worker-jobs/synthesize/external` 호출
  - storige Worker가 합성 처리
  - `synthesis.completed` Webhook으로 outputFileUrl 반환
  - PHP에서 outputFileUrl로 다운로드 검증
- **차단 요소**: P0-1 (PHP 통합) 완료 후 가능
- **예상 작업량**: 1일

### 4. 저장/불러오기 E2E 검증
- **상태**: ⏳ 대기 (코드는 `9e8f4e5`로 완료, 운영 검증 필요)
- **검증 시나리오**: editor에서 멀티페이지 작업 → 저장 → 다시 로드 시 canvasData 완전 보존
- **차단 요소**: P0-1 후 또는 별도 진행 가능
- **예상 작업량**: 0.5일

### 5. Sentry 알림 채널 연결 (Slack/Email 강화)
- **상태**: ⏳ 부분 (이메일 기본 알림 활성화됨, Slack 미연결)
- **필요 작업**:
  - Sentry → Settings → Integrations → Slack 연결
  - Alert Rules 추가:
    - **High frequency**: 10분 내 동일 에러 10건 이상 → Slack
    - **First seen**: 새 에러 발생 → Slack
    - **Failed jobs**: `tag:job.queue` 있는 에러 → 별도 채널
- **예상 작업량**: 30분
- **사용자 액션 필요**: Slack workspace 연결 인증

### 6. 워커 자동 수정 결과 PDF 다운로드 endpoint
- **상태**: ❌ 미진행 (P1-4 Before/After 미리보기는 완료, PDF 다운로드 별도)
- **현재**: Before/After 미리보기 카드에서 iframe으로 표시
- **추가 필요**: 사용자가 "수정된 PDF 다운로드" 가능하도록 download endpoint 노출
- **예상 작업량**: 0.5일 (이미 storage/processed에 결과 저장됨)

---

## 🟢 P2 — 중기 (폴리시 / 확장)

### 7. Admin Playwright E2E 셋업
- **상태**: ❌ 미설정 (editor만 Playwright 사용 중)
- **추가 시나리오**:
  - 워커 테스트 페이지 (PDF 업로드 + 검증 + Before/After)
  - 큐 모니터 위젯 5초 폴링 동작
  - 라이브러리 카테고리 필터
- **예상 작업량**: 1~2일

### 8. 운영 메트릭 대시보드 (Grafana / Sentry Performance)
- **상태**: ❌ Sentry는 통합되어 있으나 별도 대시보드 미구성
- **선택지**:
  - Sentry Performance 탭 활용 (이미 tracesSampleRate=0.1)
  - 또는 Grafana + Prometheus 추가 셋업
- **예상 작업량**: 1~2일

### 9. R2 / S3 백업 이중화
- **상태**: ❌ VPS 로컬 cron 백업만 존재
- **현재**: 매일 03:00 KST `~/backup.sh` (DB + storage + .env, 7일 보존)
- **추가 필요**: Cloudflare R2 또는 AWS S3로 외부 이중 백업
- **예상 작업량**: 1일

### 10. 로그 일원화 (Pino + Loki / Datadog Logs)
- **상태**: ❌ 미진행 (현재 Docker logs 기반)
- **필요 작업**: Pino logger + 외부 수집기
- **예상 작업량**: 1~2일

### 11. WebAssembly multi-threading (`crossOriginIsolated`)
- **상태**: ❌ 미진행
- **이유**: opencv-js / onnxruntime-web 성능 향상 가능
- **차단 요소**: COOP/COEP 헤더 설정 + Vercel 호환성 검증
- **예상 작업량**: 1일

### 12. 폰트 fallback "본고딕 미찾음" 경고 silent (잔여)
- **상태**: ⚠️ 부분 (P2-12로 ServicePlugin 12개 console.log 정리, 다른 위치 있을 수 있음)
- **확인**: 운영 콘솔에서 잔여 로그 모니터링
- **예상 작업량**: 0.5일

---

## 🟣 P3 — 장기 / 선택 (변경 없음)

| # | 항목 | 우선순위 |
|---|------|---------|
| 13 | 캔버스 핀치-투-줌 / 두 손가락 패닝 | P3 |
| 14 | iText 인라인 편집 시 visualViewport 보정 (iOS Safari) | P3 |
| 15 | 모바일 long-press 컨텍스트 메뉴 | P3 |
| 16 | 다중 선택 floating action bar | P3 |
| 17 | Supabase 프로젝트 Pause/Delete (미사용) | P3 |

---

## 📅 향후 예약된 인프라 업데이트 (FUTURE_UPDATES.md)

### Node 20 → 22 LTS 마이그레이션
- **권장 일정**: 2026-06 ~ 2026-07 (P0-1 완료 후)
- **작업 범위**: Docker 4개 Dockerfile + Vercel 프로젝트 설정 + native deps 검증
- **위험도**: 🟡 중

### Sentry profiling-node 재도입 (선택)
- **현재**: Alpine native build 실패로 제거됨 (`f5e22d9`)
- **대안**: Debian Docker 이미지 또는 별도 CI 사용
- **우선순위**: 🟢 낮음 (코어 Sentry는 정상 작동 중)

---

## 🗓 권장 다음 1~2주 Sprint

| Day | 작업 | 우선순위 | 차단 요소 | 자동화 가능 |
|-----|------|---------|----------|-----------|
| **Day 1** | Admin 비번 강제 교체 (P0-2) | 🔴 P0 | 없음 | ✅ |
| **Day 2** | Sentry Slack 연결 + Alert Rules (P1-5) | 🟡 P1 | 사용자 Slack 인증 | ⚠️ 부분 |
| **Day 3** | 워커 자동 수정 결과 다운로드 endpoint (P1-6) | 🟡 P1 | 없음 | ✅ |
| **Day 4~5** | Admin Playwright E2E 셋업 (P2-7) | 🟢 P2 | 없음 | ✅ |
| **Day 6~7** | R2 백업 이중화 (P2-9) | 🟢 P2 | R2 계정 | ⚠️ 부분 |
| **Day 8~10** | 로그 일원화 + 메트릭 대시보드 | 🟢 P2 | 없음 | ✅ |
| **(별도)** | **PHP 통합 검증** (P0-1) | 🔴 P0 | **PHP 팀** | ❌ |

---

## 📊 최신 진척률

```
도구 확장      ████████████████████ 92%
표지 편집      █████████████████░░░ 88%
북모아 통합    █████████████████░░░ 88%  ← P0-1로 100%
다크/반응형    ██████████████████░░ 88%  ← P2-11로 +13%p
도구 확장      ████████████████████ 92%
모바일/터치    █████████████░░░░░░░ 69%
카탈로그/AI    █████████████████░░░ 84%  ← P1-6로 +17%p
PDF/워커       ██████████████████░░ 88%  ← P1-4 + ENOENT핫픽스 +28%p
인프라/품질    ████████████████░░░░ 78%  ← P0-3+P1-7+P2×5 +21%p
─────────────────────────────────────────
전체           ██████████████████░░ 92%  ← +18%p (74%→92%)
```

---

## 🚨 위험 / 주의 사항 (현 시점)

### 1. Admin 시드 비밀번호 — 가장 시급
- ⚠️ `admin123` 그대로. 깃 히스토리/문서에 노출
- 🔴 **운영 트래픽 받기 전 반드시 교체** (P0-2)

### 2. PHP 통합 미완료
- storige 측은 100% 준비 완료
- PHP 팀과 협업 필요 — 일정 동기화 필요

### 3. ✅ 자동 에러 감지 (해결됨)
- 이전 세션에서 우려했던 부분, 이제 Sentry로 자동 추적 중
- DSN 등록 완료, 운영 사고 즉시 알림 가능

### 4. Sentry DSN 노출 — 채팅 로그
- 4개 DSN 값이 채팅에 남음
- DSN은 권한이 제한적이지만, 우려 시 Sentry 대시보드에서 DSN 회전 가능
- 회전 후 자동화 스크립트 재실행으로 적용 가능

---

## 💡 최우선 액션 권장 순서

1. **Admin 비번 변경** (30분, 자동화 가능) — 즉시 처리
2. **Sentry Slack 연결** (30분, 사용자 Slack 인증) — 운영 가시성
3. **PHP 팀과 통합 일정 조율** — 외부 의존
4. P1 잔여 작업 (다운로드 endpoint, E2E)
5. P2 폴리시 (Playwright, R2, 메트릭)

---

## 🔗 관련 문서

- [`NEXT_DEVELOPMENT_PLAN.md`](./NEXT_DEVELOPMENT_PLAN.md) — 직전 계획 (이번 세션 시작점)
- [`AUTOPILOT_SESSION_2026-05-02.md`](./AUTOPILOT_SESSION_2026-05-02.md) — 직전 사이클 결과
- [`REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) — 트랙 마스터 트래커
- [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) — 인프라 업데이트 예약
- [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) — Sentry 운영 가이드 (활성화 완료)
- `CLAUDE.local.md` — 운영 정보 (gitignored)
