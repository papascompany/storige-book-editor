# Storige 다음 개발 계획 (2026-05-02 기준)

> **작성일**: 2026-05-02 (v2.2 워커 ENOENT 핫픽스 배포 직후)
> **참조**: `docs/REMAINING_WORK_REVIEW.md`, `.cursor/plans/v2/NEW_DEV_PLAN.md`, `docs/AI_FEATURES_PLAN.md`
> **누적 진척률**: 약 73% (실효 기능 ~88%)

---

## 📌 한 줄 요약

> **인프라/코드 90% 완료. 남은 핵심은 ① bookmoa PHP 양측 통합 검증 ② AI 기능 통합 ③ 운영 모니터링/품질 폴리시.**

---

## 🎯 우선순위 매트릭스

```
                중요도 ↑
               │
     P1 (단기) │ ④ Before/After 미리보기
     사용자가치 │ ⑤ 운영 모니터링 (Sentry/큐 알람)
        🟡    │ ⑥ Composite 정밀 좌표 (multi-region)
               │
   ────────────┼────────────────────────────────  ← 시급도 →
               │
     P0 (즉시) │ ① PHP 양측 통합 검증 (E2E)
   운영 blocker│ ② Admin 비번 강제 교체 (admin123)
        🔴    │ ③ Sentry/Datadog 에러 추적 연결
               │
```

---

## 🔴 P0 — 즉시 처리 (운영 blocker)

### 1. PHP ↔ Storige 양측 통합 검증 (가장 시급)

**상태**: ⏳ 대기 중 (storige 측 모든 변경 완료, PHP 측 코드 적용 검증 필요)

**검증 대상**:
- `width`/`height` URL 파라미터 → 옵션 C (자유 사이즈) 동작
- `/files/upload/external` 호출 시 `type` 필드 (v2.1에서 명시됨)
- `/worker-jobs/synthesize/external` Webhook 콜백 처리
- `validation.completed` / `synthesis.completed` Webhook 양측 수신

**참조 문서**:
- `docs/SYSTEM_INTEGRATION_OVERVIEW.md` (v2.2)
- `docs/PHP_INTEGRATION_VERIFICATION.md`
- `docs/BOOKMOA_INTEGRATION_DIFF.md`

**예상 작업량**: PHP 측 1~2일 + 양측 통합 테스트 0.5일

---

### 2. Admin 비밀번호 강제 교체

**상태**: ❌ 미진행 (`admin@storige.com` / `admin123` 시드값 그대로)

**필요 작업**:
- VPS에서 admin 계정 비밀번호 강한 값으로 변경
- `~/storige/.env` 또는 `bcrypt` 해시 직접 업데이트
- `CLAUDE.local.md` 의 시크릿 위치 메모만 업데이트 (값은 비포함)

**예상 작업량**: 30분

---

### 3. 운영 에러 추적 연결 (Sentry / Datadog)

**상태**: ❌ 미진행

**필요 작업**:
- Sentry 또는 Datadog 무료 플랜 가입
- API/Worker/Editor/Admin 4개 앱에 SDK 통합
- 환경변수로 DSN 주입
- 알림 채널 연결 (Slack 또는 이메일)

**예상 작업량**: 0.5~1일

**참고**: 이번 ENOENT 버그 같은 운영 사고가 워커 로그를 직접 봐야만 파악 가능. 자동 알림 필수.

---

## 🟡 P1 — 단기 (사용자 가치 큼)

### 4. PDF 검증 결과 Before/After 미리보기

**상태**: ⏳ 검증 결과 표시까지만 완료. autoFix 적용 후 결과 미구현.

**필요 작업**:
- Worker `pdf-converter.service.ts` autoFix 결과 저장
- API `/files/{id}/preview?fix=before|after` 엔드포인트
- Admin 워커 테스트 페이지에 Before/After 토글 UI

**예상 작업량**: 1~2일

---

### 5. Composite 모드 multi-region 정밀 좌표

**상태**: ⚠️ 부분 (multi-select cross-canvas는 완료, region 매핑 미세 조정 필요)

**필요 작업**:
- `useCoverRegion` 훅 multi-region edge case 처리
- 책등 가변 시 다중 객체 동시 재배치 (현재는 단일 객체만 toast)

**예상 작업량**: 1일

---

### 6. AI 패널 정합 / 추천 (UI 통합)

**상태**: ❌ AI 모듈 분리되어 있으나 메인 에디터 사이드바와 미통합

**참조**: `docs/AI_FEATURES_PLAN.md`

**필요 작업**:
- AI 추천 패널 → 사이드바 탭으로 통합
- ML 기반 템플릿 추천 (기존 PoC 활용)
- "AI 자동 배치" 버튼 (기존 모달 → 사이드바 1-click)

**예상 작업량**: 2~3일

---

### 7. 워커 잡 모니터링 (Bull 큐 적체 알람)

**상태**: ❌ 미진행

**필요 작업**:
- `waiting` 큐가 N개 이상 1분 이상 적체 시 알림
- `failed` 잡 발생 시 즉시 알림
- Admin 대시보드에 큐 실시간 상태 위젯

**예상 작업량**: 1일

---

## 🟢 P2 — 중기 (폴리시 / 확장)

| # | 항목 | 예상 |
|---|------|------|
| 8 | Playwright E2E 시나리오 작성 (현재 설정만) | 2~3일 |
| 9 | 사전 존재 lint 에러 정리 (admin/canvas-core/ai/editor/worker) | 0.5일 |
| 10 | 번들 크기 최적화 (vendor-opencv 10MB, vendor-onnx 24MB lazy-load) | 1~2일 |
| 11 | fabric 객체 색상 다크모드 통일 (hover/selection) | 0.5일 |
| 12 | 폰트 fallback 로그 silent 처리 (본고딕 미찾음 경고) | 0.5일 |
| 13 | WebAssembly multi-threading (`crossOriginIsolated`) | 1일 |
| 14 | DB + storage Cloudflare R2 백업 이중화 | 1일 |
| 15 | 로그 일원화 (Pino + Loki 또는 Datadog Logs) | 1~2일 |

---

## 🟣 P3 — 장기 / 선택

| # | 항목 |
|---|------|
| 16 | 캔버스 핀치-투-줌 / 두 손가락 패닝 (모바일 UX) |
| 17 | iText 인라인 편집 시 visualViewport 보정 (iOS Safari) |
| 18 | 모바일 long-press 컨텍스트 메뉴 |
| 19 | 멀티 선택 floating action bar |
| 20 | Supabase 프로젝트 Pause/Delete (현재 미사용) |

---

## 🗓 권장 다음 1~2주 Sprint

| Day | 작업 | 우선순위 | 담당 |
|-----|------|---------|------|
| **Day 1** | PHP 측 코드 적용 + 양측 통합 테스트 (P0 #1) | 🔴 | PHP + Storige 합동 |
| **Day 2** | Admin 비번 강제 교체 (P0 #2) | 🔴 | Storige |
| **Day 3** | Sentry 통합 (4개 앱 SDK + DSN 환경변수) (P0 #3) | 🔴 | Storige |
| **Day 4~5** | PDF Before/After 미리보기 (P1 #4) | 🟡 | Storige Worker + Admin |
| **Day 6** | Bull 큐 알람 + Admin 위젯 (P1 #7) | 🟡 | Storige |
| **Day 7~9** | AI 패널 UI 통합 (P1 #6) | 🟡 | Editor |
| **Day 10** | Composite multi-region 정밀화 (P1 #5) | 🟡 | Editor |
| **Day 11~14** | P2 폴리시 (lint/번들/E2E 중 우선순위 결정) | 🟢 | 전반 |

---

## 📦 이번 세션까지의 누적 성과 요약

### 완료된 핫픽스 사이클 (2026-05-02)

| 커밋 | 내용 |
|------|------|
| `22e926f` | admin: products filter 오류 + 배경/클립아트 카테고리 필터 |
| `c4d183c` | admin: 워커 테스트 파일 업로드 400 오류 수정 (`type` 필드 누락) |
| `daeb2b7` | **worker: `/storage/` 절대경로 ENOENT 오류 수정** (검증/합성/변환 3개 서비스) |
| `1e67acd` | docs: SYSTEM_INTEGRATION_OVERVIEW v2.2 (워커 경로 정규화 섹션 추가) |
| `8d0c7f2` | chore(claude): 세션 간 운영 정보 보존 — CLAUDE.local.md 시스템 |

### 카테고리별 진척률

| 카테고리 | 완료 | 잔존 | 비율 |
|---------|------|------|------|
| 모바일/터치 | 9 | 4 | 69% (P3 위주) |
| 표지 편집 | 7 | 1 | 88% |
| 다크/반응형 | 6 | 2 | 75% |
| 도구 확장 | 11 | 1 | 92% |
| 카탈로그/AI | 4 | 2 | 67% |
| 통합 (북모아) | 7 | 1 | **88%** ← P0 #1로 100% |
| PDF/워커 | 3 | 2 | 60% (이번 세션 ENOENT 핫픽스 +1) |
| 인프라/품질 | 8 | 6 | 57% |
| **전체** | **55** | **19** | **74%** |

> 이번 세션 ENOENT 핫픽스로 PDF/워커 카테고리 +1, 운영 안정성 크게 향상

---

## 🚨 위험 요소 / 주의사항

### 1. Admin 시드 비밀번호 (`admin123`)
- ⚠️ 운영 트래픽 받기 전 반드시 교체 (P0 #2)
- 이미 깃 히스토리/문서에 노출되어 있음

### 2. 자동 에러 감지 부재
- 현재 워커 ENOENT 같은 사고는 사용자 보고로만 파악
- Sentry 통합(P0 #3) 시급

### 3. PHP 측 검증 미완료
- storige 측은 모든 변경 완료, PHP 측 적용 미검증
- 운영 컷오버 전 양측 통합 테스트 필수 (P0 #1)

### 4. fail2ban + IP 변동
- 이 Mac 공인 IP가 변경되면 다시 SSH 차단 가능
- `CLAUDE.local.md` 에 IP 기록되어 있으나 만료 시 갱신 필요

---

## 🔗 참조 문서

- `docs/SYSTEM_INTEGRATION_OVERVIEW.md` (v2.2) — 시스템 통합 레퍼런스
- `docs/REMAINING_WORK_REVIEW.md` — 트랙별 잔존 작업 (마스터)
- `docs/DEPLOYMENT.md` — 배포 가이드 + v2.2 핫픽스 절차
- `docs/AI_FEATURES_PLAN.md` — AI 기능 상세 계획
- `.cursor/plans/v2/NEW_DEV_PLAN.md` — 인프라/PHP 연동 큰 그림
- `CLAUDE.local.md` — 운영 정보 (gitignored)
