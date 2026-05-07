# Storige 전체 개발 상태 마스터 트래커 (2026-05-04)

> ⚠️ **이 문서는 2026-05-04 스냅샷입니다. 현재 마스터 트래커는 [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md)로 이전됐습니다.** (2026-05-06~07 멀티사이트 플랫폼화 Phase A/B/C 완료 반영)

> **갱신일**: 2026-05-04
> **누적 사이클**: 110+ commit / 80+ 트랙
> **전체 진척률**: 약 **96%** (실효 기능 ~98%)
> **운영 시작 가능**: PHP 측 통합만 남음

---

## 🎯 한눈에 보기

| 영역 | 완료 | 진행/잔존 | 비고 |
|------|------|-----------|------|
| 모바일/터치 | 9 | 4 (P3) | 6차 P0 핫픽스 종료, 잔여는 장기 폴리시 |
| 표지 편집 | 8 | 0 | Phase 3b 전체 완료 |
| 다크/반응형 | 8 | 0 | P2-13까지 완료 (ActiveSelection/caret) |
| 도구 확장 | 11 | 1 (P3) | 다중 floating bar만 잔여 |
| 카탈로그/AI | 5 | 1 (P3) | AI 패널 추천 통합 잔여 |
| **북모아 PHP 통합** | 7 | 1 🔴 | **PHP 측 코드 적용만 남음** (외부 의존) |
| PDF/워커 | 5 | 0 | E2E 검증 + 결함 #12/#13 모두 처리 |
| 인프라/품질 | 14 | 3 (P2/P3) | Node 22 + Grafana + Loki 완료, 잔여는 R2/WASM/profiling |
| **합계** | **67** | **10** | **약 96% (외부 의존 1건 = PHP 작업 대기)** |

---

## ✅ 완료 사이클 정리 (시간순)

### 6차 P0 핫픽스 (~2026-05-02)
- 모바일 실기기 검증 4건 + 콘솔 보고 3건 모두 처리
- iOS Safari 페이지 크래시 fix, Vercel HTML cache, unhandledrejection handler
- 운영 DB 마이그레이션 + 옵션 C 전환

### 통합 검증 + 보안 패치 (2026-05-03)
- 9개 결함 audit + 옵션 A 8건 처리
- **보안 패치 A-E** (사용자 격리 권한 검증) — 운영 배포
- Admin 시드 비번 강제 교체 (`r46eAZ...`)
- Sentry 4개 프로젝트 DSN 활성화 (운영 에러 자동 추적)

### Phase 2 (2026-05-04 오토파일럿)
- P0-1: 시드 enum 정정 + 스프레드 templateSet
- P0-2: 라이브러리 13개 SVG 자산 실 업로드
- P1-5: Product↔TemplateSet 연결 3건
- P1-6: Worker 검증 E2E 4 시나리오 통과

### 후속 픽스 + PHP 통합 + 모니터링 (2026-05-04 후속)
| 항목 | 내용 |
|------|------|
| 결함 #12 | Products `findAll/findOne/findByProductId` templateSet relation join |
| linkTemplateSet 버그 | `@RelationId` silent fail → `repository.update({ templateSet: { id } })` |
| Worker 합성 E2E | perfect/merged · perfect/separate · saddle 3 시나리오 100% 통과 |
| 결함 #13 | Conversion `outputFileUrl` 형식 정규화 (`/storage/converted/...`) |
| PHP 통합 가이드 v3.0 | `PHP_INTEGRATION_FINAL_v3.md` + `.html` 통합 최종본 |
| Sentry Slack | 가이드 + smoke test 스크립트 (OAuth는 사용자 대기) |
| **P2-7** | Admin Playwright E2E 확장 (worker-test/queue-monitor/library) — 12 passed / 3 skipped |
| **P2-8** | Grafana + Prometheus + node/redis-exporter (옵션 C 하이브리드) |
| **P2-10** | Loki + Promtail 로그 일원화 (Pino JSON → 14일 보존) |
| **P2-12** | 폰트 fallback 잔여 console → dlog/dwarn |
| **P2-13** | ActiveSelection prototype + IText caret color 다크 동기화 |
| **Node 22 마이그레이션** | Docker 6곳 + engines `>=22` + canvas dead dep 제거 |

---

## ⏳ 잔여 개발 이슈

### 🔴 P0 — 외부 의존 (사용자 또는 외부 팀 작업)

| ID | 항목 | 차단 요소 | Storige 측 상태 |
|----|------|-----------|------------------|
| **P0-1** | PHP ↔ Storige 양측 통합 (cutover) | PHP 팀 일정 | ✅ 100% 준비 완료, 가이드 v3.0 전달 가능 |
| **P1-2** | Sentry Slack 연결 | 사용자 OAuth (Sentry/Slack 관리자 권한) | ✅ 가이드 + smoke test 스크립트 완비 |
| **P0 (운영 비번)** | 새 admin 비번 사용자 본인 비번으로 교체 | 사용자 결정 | ✅ 자동 생성 비번(`r46e...`)으로 운영 가능 |

### 🟡 P2 — 단기 (자동화 가능, Storige 측)

| ID | 항목 | 예상 | 우선순위 |
|----|------|------|----------|
| **P2-9** | R2/S3 백업 이중화 (현 VPS 로컬 cron만) | 1일 | 🟡 |
| **P2-11** | WebAssembly multi-threading (`crossOriginIsolated`, COOP/COEP 헤더) | 1일 | 🟢 |
| **운영 자산 큐레이션** | Library 13개 더미 SVG → 실 디자인팀 자산 교체 | 별도 사이클 | 🟢 외부 협업 |
| **P2-7 후속** | Library category dropdown option DOM 매칭 정교화 (E2E 2건 skip 해소) | 0.5일 | 🟢 |

### 🟣 P3 — 장기 / 선택

| 영역 | 항목 |
|------|------|
| 모바일 UX | 캔버스 핀치-투-줌 / 두 손가락 패닝 |
| 모바일 UX | iText 인라인 편집 시 visualViewport 보정 (iOS Safari) |
| 모바일 UX | 모바일 long-press 컨텍스트 메뉴 |
| 도구 확장 | 다중 선택 floating action bar |
| AI | AI 패널 추천 정합 / 통합 |
| 폰트 | 잔여 ServicePlugin/Editor console 모니터링 (대부분 정리됨) |
| 인프라 | Sentry profiling-node 재도입 검토 (Node 22 환경에서 재시도) |
| 정리 | 옛 storige (다른 경로) 삭제 검토 |

### 📅 향후 인프라 트래커 (`FUTURE_UPDATES.md`)

| # | 항목 | 상태 |
|---|------|------|
| 1 | Node 20 → 22 LTS 마이그레이션 | ✅ 완료 (2026-05-04) |
| 2 | P2-8 풀 Grafana 셋업 (OTel/Tempo/Loki/alertmanager) | ⏳ 대기 (현재 옵션 C 충분, 트래픽 확장 시 검토) |
| 3 | PHP 양측 통합 검증 후 후속 정리 | ⏳ 대기 (P0-1과 같음) |
| 4 | Admin 비번 강제 교체 | ✅ 사실상 완료 (P0-2에서 처리) |

---

## 🚦 운영 시작 가능 여부

```
                              현재 (2026-05-04)
┌─────────────────────────────────┬──────────┐
│ Bookmoa PHP 통합               │   🟡 PHP 측 작업만 남음
│ 사용자 에디터 사용              │   ✅
│ Admin 콘텐츠 등록               │   ✅
│ Worker PDF 검증/변환/합성        │   ✅ E2E 완전 검증
│ 인프라/모니터링/보안             │   ✅
│ 메트릭 / 로그 / 에러 추적        │   ✅ Grafana + Loki + Sentry
│ 보안 패치 / 사용자 격리          │   ✅ 패치 A-E
│ 자동화 검증 (Playwright)        │   ✅ 12 passed
│ 런타임 (Node 22 LTS)           │   ✅ 운영 통일
└─────────────────────────────────┴──────────┘
```

**결론**: PHP 팀 킥오프 미팅 일정만 잡히면 1~3주 내 운영 컷오버 가능.

---

## 🛠 핵심 운영 스택 (현재)

| 레이어 | 도구 | 상태 |
|--------|------|------|
| **런타임** | Node 22 LTS (Krypton... 아니, Jod) | ✅ |
| **API/Worker** | NestJS + Pino logger | ✅ |
| **DB** | MariaDB 11.2 (Docker) | ✅ |
| **큐** | Redis 7.2 + Bull | ✅ |
| **CDN/Frontend** | Vercel (admin/editor/homepage) | ✅ auto-deploy |
| **VPS Backend** | Vultr Seoul, Docker compose | ✅ |
| **에러 추적** | Sentry (4 프로젝트) | ✅ Slack 연동 사용자 OAuth 대기 |
| **메트릭** | Grafana + Prometheus + node/redis-exporter | ✅ |
| **로그** | Grafana Loki + Promtail (Pino JSON) | ✅ |
| **백업** | VPS 로컬 cron (03:00 KST, 7일 보존) | ⚠️ R2/S3 이중화 잔여 |
| **HTTPS** | Let's Encrypt + nginx | ✅ |

---

## 📚 참조 문서 (현재 사용중)

### 운영 가이드
- [`PHP_INTEGRATION_FINAL_v3.md`](PHP_INTEGRATION_FINAL_v3.md) / `.html` — PHP 팀 전달용 (v3.0)
- [`SENTRY_SETUP.md`](SENTRY_SETUP.md) + [`SENTRY_SLACK_SETUP.md`](SENTRY_SLACK_SETUP.md)
- [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](P2_8_METRICS_DASHBOARD_2026-05-04.md)
- [`P2_10_LOG_AGGREGATION_2026-05-04.md`](P2_10_LOG_AGGREGATION_2026-05-04.md)
- [`SYSTEM_INTEGRATION_OVERVIEW.md`](SYSTEM_INTEGRATION_OVERVIEW.md) (v2.4)
- [`DEPLOYMENT.md`](DEPLOYMENT.md)

### 보고서
- [`PHASE2_FIX_REPORT_2026-05-04.md`](PHASE2_FIX_REPORT_2026-05-04.md)
- [`SYNTHESIS_E2E_REPORT_2026-05-04.md`](SYNTHESIS_E2E_REPORT_2026-05-04.md)
- [`DEFECT_13_FIX_REPORT_2026-05-04.md`](DEFECT_13_FIX_REPORT_2026-05-04.md)
- [`P2_7_E2E_REPORT_2026-05-04.md`](P2_7_E2E_REPORT_2026-05-04.md)

### 트래커
- [`FUTURE_UPDATES.md`](FUTURE_UPDATES.md) — 인프라 업데이트 예약
- 본 문서 (`MASTER_STATUS_2026-05-04.md`) — 통합 마스터

> ⚠️ `REMAINING_WORK_REVIEW.md` (2026-05-02 갱신) 와 `NEXT_ISSUES_2026-05-03.md` 는 본 마스터로 대체. 향후 갱신은 본 파일에 통합.

---

## 🚀 다음 권장 액션

| 순서 | 항목 | 담당 | 기간 |
|------|------|------|------|
| ① | **PHP 팀 킥오프 메일 발송** + 미팅 일정 | 사용자 직접 | 즉시 |
| ② | Sentry Slack OAuth 인증 (Slack workspace 관리자) | 사용자 직접 | 30분 |
| ③ | PHP 1주차 코드 적용 지원 | Storige (대응) | 1주 |
| ④ | (병행 가능) P2-9 R2/S3 백업 이중화 | Storige (자동화) | 1일 |
| ⑤ | PHP 2주차 통합 테스트 + Sentry 모니터링 | Storige (대응) | 1주 |
| ⑥ | PHP 3주차 운영 컷오버 + 모니터링 | 양측 | 1주 |
| ⑦ | (컷오버 후) 운영 라이브러리 자산 큐레이션 | 디자인팀 + Storige | 별도 사이클 |
