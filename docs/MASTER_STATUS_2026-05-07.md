# Storige 전체 개발 상태 마스터 트래커 (2026-05-07)

> **갱신일**: 2026-05-07 (이전: 2026-05-04 → 본 트래커로 대체)
> **누적 사이클**: 130+ commit / 90+ 트랙
> **전체 진척률**: 약 **98%** (실효 기능 ~99%)
> **운영 시작 가능**: ✅ 멀티사이트 플랫폼 모델 완성, PHP 통합만 남음

---

## 🎯 한눈에 보기

| 영역 | 완료 | 잔존 | 상태 |
|------|-----|------|------|
| 모바일/터치 | 9 | 4 (P3) | — |
| 표지 편집 | 8 | 0 | ✅ Phase 3b 종료 |
| 다크/반응형 | 8 | 0 | ✅ |
| 도구 확장 | 11 | 1 (P3) | — |
| 카탈로그/AI | 5 | 1 (P3) | — |
| 북모아 PHP 통합 | 7 | 1 🔴 | **PHP 측 작업만 남음** |
| PDF/워커 | 5 | 0 | ✅ |
| 인프라/품질 | 14 | 3 (P2/P3) | Node 22 + Grafana + Loki 완료 |
| **🆕 멀티사이트 플랫폼** | **6** | **1 (선택)** | **Phase A/B-1/B-2/C-1/C-2/C-3 완료** |
| **합계** | **73** | **11** | **약 98%** |

---

## ✨ 2026-05-04 이후 신규 완료 사이클

### 🆕 멀티사이트 플랫폼화 (Phase A → B-2/C-3)

| Phase | 내용 | 커밋 | 상태 |
|-------|------|------|------|
| **A** | Site/Tenant 모델 + admin "기본설정" + ApiKeyStrategy DB 조회 | `3643397` + `99a7397` | ✅ |
| **B-1** | Site 엔티티에 워커 옵션 6 컬럼 추가 + admin 폼 | `6eb2cc1` | ✅ |
| **B-2** | WorkerJobsService에서 사이트 default 옵션 자동 머지 | `a3b3107` | ✅ |
| **C-1** | worker_jobs / file_edit_sessions에 site_id 자동 주입 | `6eb2cc1` | ✅ |
| **C-2** | JWT shop-session에 siteId + EditSession 자동 주입 | `a3b3107` | ✅ |
| **C-3** | admin EditSessionList / WorkerJobList 사이트 dropdown 필터 | `a3b3107` | ✅ |
| Backfill | 기존 worker_jobs 14건 + edit_sessions 5건 → 북모아 메인 격리 | (운영 SQL) | ✅ |

**효과**:
- admin에서 사이트 등록 → 인증코드 자동 발급 → 외부 사이트 즉시 운영
- 모든 잡/세션 자동 site_id 격리 + admin 사이트별 dropdown 조회
- 사이트별 워커 옵션 default 자동 적용 (호출자 옵션 누락 시)
- **PHP 영향 0건** (기존 키 자동 DB 마이그레이션, API 형식 동일)

### 📚 플랫폼 워커 연동 가이드

| 문서 | 용도 |
|------|------|
| [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) | 외부 사이트 개발자용 (언어 중립, 자기완결) |
| [`PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md`](./PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md) | AI에 가이드 첨부 후 즉시 코드 생성하는 프롬프트 |

### 📊 Admin 스토리보드 분석

| 문서 | 핵심 |
|------|------|
| [`ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md`](./ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md) | 11p PDF 스토리보드 vs 현재 admin 매칭, Phase A/B/C 작업 정의 |

---

## ⏳ 잔여 개발 이슈

### 🔴 외부 의존 (사용자 또는 외부 팀)

| ID | 항목 | 차단 요소 | Storige 측 |
|----|------|-----------|------------|
| **P0-1** | PHP ↔ Storige 통합 cutover | PHP 팀 일정 | ✅ 100% 준비 (가이드 v3.1 + 인증코드 발급) |
| **P1-2** | Sentry Slack 연결 | 사용자 OAuth 인증 (3분) | ✅ 가이드 + smoke test 스크립트 완비 |
| **외부** | 운영 라이브러리 자산 큐레이션 | 디자인팀 협업 | ✅ 스킴 준비 |

### 🟡 P1 — 단기 (자동화 가능)

| 항목 | 예상 | 비고 |
|------|------|------|
| **TypeORM Migration 파일 도입** | 1일 | 운영 `synchronize: false` 안전화. 현재 entity 변경 시 수동 SQL ALTER 필요 |
| **R2/S3 백업 이중화 (P2-9)** | 1일 | 현 VPS 로컬 cron만 |

### 🟢 P2 — 중기 폴리시

| 항목 | 예상 | 비고 |
|------|------|------|
| **Sentry/Grafana 사이트별 라벨 자동 주입** | 0.5일 | NestJS Interceptor에서 `req.user.siteId` → Sentry tag + Pino base |
| **사이트별 통계 대시보드 (Grafana)** | 0.5일 | 새 패널: 사이트별 잡 수, 에러율 |
| **edit_sessions/worker_jobs FK 제약** | 0.5일 | site_id → sites.id ON DELETE SET NULL |
| **WebAssembly multi-threading (P2-11)** | 1~2일 | crossOriginIsolated. 2026-05-04 시도 후 revert (Chrome 확장 충돌 — `FUTURE_UPDATES §4`) |
| **P2-7 Library E2E dropdown 정교화** | 0.5일 | Playwright skip 2건 해소 |

### 🟣 P3 — 장기/선택

- 모바일 UX: 핀치-투-줌 / iText visualViewport / long-press 컨텍스트 메뉴 / 다중 floating bar
- AI 패널 추천 통합
- Sentry profiling-node 재도입 (Node 22 환경 재시도)

### 📅 향후 인프라 (FUTURE_UPDATES.md)

| # | 항목 | 상태 |
|---|------|------|
| 1 | Node 20 → 22 LTS | ✅ 완료 (2026-05-04) |
| 2 | 풀 Grafana 셋업 (OTel/Tempo/alertmanager) | ⏳ 트래픽 1000건/일 도달 시 |
| 3 | PHP 통합 후속 정리 | ⏳ P0-1과 동일 |
| 4 | PNG 업로드 hang 본 fix | ⏳ PHP 통합 안정화 후 (별도 사이클) |
| 5 | Admin 비번 사용자 본인 비번 교체 | ⏳ 사용자 결정 |
| 🆕 6 | TypeORM Migration 파일 도입 | ⏳ Phase A/B/C 후속 정리 |

---

## 🚦 운영 시작 가능 여부

```
                              현재 (2026-05-07)
┌─────────────────────────────────┬──────────┐
│ Bookmoa PHP 통합               │   🟡 PHP 측 작업만 남음
│ 사용자 에디터 사용              │   ✅
│ Admin 콘텐츠 등록               │   ✅
│ Worker PDF 검증/변환/합성        │   ✅ E2E 완전 검증
│ 인프라/모니터링/보안             │   ✅
│ 메트릭 / 로그 / 에러 추적        │   ✅ Grafana + Loki + Sentry
│ 보안 패치 / 사용자 격리          │   ✅ 패치 A-E
│ 자동화 검증 (Playwright)        │   ✅
│ 런타임 (Node 22 LTS)           │   ✅
│ 🆕 멀티사이트 플랫폼 모델       │   ✅ Phase A/B/C 완료
│ 🆕 외부 사이트 연동 가이드      │   ✅ 언어 중립 + AI 프롬프트
└─────────────────────────────────┴──────────┘
```

**결론**: PHP 팀 킥오프 미팅 + 점진적 외부 사이트 추가가 즉시 가능한 단계.

---

## 🛠 운영 스택 (현재)

| 레이어 | 도구 | 상태 |
|--------|------|------|
| 런타임 | Node 22 LTS (Jod) | ✅ |
| API/Worker | NestJS + Pino logger | ✅ |
| **🆕 멀티테넌시** | **Site 엔티티 + ApiKeyStrategy DB 조회** | **✅ Phase A** |
| DB | MariaDB 11.2 | ✅ |
| 큐 | Redis 7.2 + Bull | ✅ |
| Frontend | Vercel (admin/editor/homepage) | ✅ |
| VPS Backend | Vultr Seoul, Docker compose 11 컨테이너 | ✅ |
| 에러 추적 | Sentry (4 프로젝트, Slack OAuth 대기) | ✅ |
| 메트릭 | Grafana + Prometheus + node/redis exporter | ✅ |
| 로그 | Grafana Loki + Promtail (Pino JSON, 14일) | ✅ |
| HTTPS | Let's Encrypt + nginx | ✅ |
| 백업 | VPS 로컬 cron (R2/S3 이중화 잔여) | ⚠️ |

---

## 🚀 다음 권장 액션 순서

| 순서 | 작업 | 담당 | 기간 |
|------|------|------|------|
| ① | **PHP 팀 킥오프 미팅** | **사용자 직접** | 즉시 |
| ② | (선택) Sentry Slack OAuth (3분) | **사용자 직접** | 30분 |
| ③ | 새 사이트 등록 안내 (점보포토 / 스튜디오북 등) | Storige 운영팀 | 5분/사이트 |
| ④ | 외부 사이트에 [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) + 인증코드 전달 | Storige 운영팀 | — |
| ⑤ | (선택) **TypeORM Migration 도입** | Storige 자동화 | 1일 |
| ⑥ | (선택) **Sentry/Grafana 사이트별 라벨** | Storige 자동화 | 0.5일 |
| ⑦ | PHP 1~3주차 통합 사이클 + 컷오버 | 양측 | 3주 |
| ⑧ | (컷오버 후) 라이브러리 자산 큐레이션 + PNG hang 본 fix | 디자인팀 + Storige | 별도 |

---

## 📚 핵심 문서 인덱스

### ⭐ 마스터 + 트래커
- [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md) — **본 문서** (2026-05-04 → 본 문서로 대체)
- [`MASTER_STATUS_2026-05-04.html`](./MASTER_STATUS_2026-05-04.html) — 시각화 (구 버전, 추후 갱신 예정)
- [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) — 향후 인프라 트래커
- [`INDEX.md`](./INDEX.md) — 전체 문서 카탈로그

### 🆕 멀티사이트 플랫폼화
- [`ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md`](./ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md) — 스토리보드 분석
- [`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md) — Site 모델 도입
- [`PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md`](./PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md) — 워커 옵션 + site_id 격리 1차
- [`PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md`](./PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md) — 후속 사이클 (default 머지 + JWT siteId + admin dropdown)

### 🤝 외부 연동
- [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) — 외부 사이트 개발자용 (언어 중립)
- [`PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md`](./PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md) — AI 구현 프롬프트
- [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md) (v3.1) / [HTML](./PHP_INTEGRATION_FINAL_v3.html) — PHP 한정 (편집기 UI 포함)

### 🚀 운영
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — 배포 가이드
- [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) (v2.5) / [HTML](./SYSTEM_INTEGRATION_OVERVIEW.html)
- [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) + [`SENTRY_SLACK_SETUP.md`](./SENTRY_SLACK_SETUP.md)
- [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](./P2_8_METRICS_DASHBOARD_2026-05-04.md) — Grafana
- [`P2_10_LOG_AGGREGATION_2026-05-04.md`](./P2_10_LOG_AGGREGATION_2026-05-04.md) — Loki

---

## 변경 이력

- **2026-05-07** (본 트래커) — Phase A/B-1/B-2/C-1/C-2/C-3 모두 완료 + 플랫폼 워커 연동 가이드 v1.0
- 2026-05-04 — 마스터 트래커 신설, 96% 진척
- 2026-05-04 — Node 22 마이그레이션, P2-7/8/10/12/13 완료
- 2026-05-03 — 보안 패치 A-E + Sentry 4 프로젝트 활성화
- 2026-05-02 — 6차 P0 핫픽스 + 운영 DB 마이그레이션
