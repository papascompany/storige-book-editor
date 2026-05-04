# Storige 문서 인덱스

> **갱신**: 2026-05-04 · 전체 문서 카탈로그 + 분류

📊 **시작점**: [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md) · [HTML](./MASTER_STATUS_2026-05-04.html)

---

## ⭐ 1. 마스터 트래커 (현재 활성)

| 문서 | 형식 | 설명 |
|------|------|------|
| [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md) | MD | 전체 개발 상태 통합 트래커 (96% 완료) |
| [`MASTER_STATUS_2026-05-04.html`](./MASTER_STATUS_2026-05-04.html) | HTML | 한 화면 시각화 대시보드 |
| [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) | MD | 향후 인프라 업데이트 트래커 (Node22 ✅, Grafana B안, PHP 후속, PNG hang 후속, Admin 비번) |

---

## 🤝 2. PHP 통합 (현재)

| 문서 | 형식 | 설명 |
|------|------|------|
| [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md) | MD | PHP 팀 전달용 최종 가이드 v3.0 |
| [`PHP_INTEGRATION_FINAL_v3.html`](./PHP_INTEGRATION_FINAL_v3.html) | HTML | 시각화 (사이드바 네비, 코드 하이라이트) |
| [`PHP_INTEGRATION_VERIFICATION.md`](./PHP_INTEGRATION_VERIFICATION.md) | MD | 13 체크리스트 (v3로 흡수, 참조용) |
| [`PHP_INTEGRATION_VERIFICATION.html`](./PHP_INTEGRATION_VERIFICATION.html) | HTML | (참조용) |
| [`PHP_INTEGRATION_KICKOFF_2026-05-04.md`](./PHP_INTEGRATION_KICKOFF_2026-05-04.md) | MD | 킥오프 문서 (v3로 흡수) |
| [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.md`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) | MD | 보안 패치 A-E PHP 통보 |
| [`SECURITY_PATCH_PHP_NOTICE_2026-05-03.html`](./SECURITY_PATCH_PHP_NOTICE_2026-05-03.html) | HTML | 시각화 |
| [`BOOKMOA_INTEGRATION_GUIDE.md`](./BOOKMOA_INTEGRATION_GUIDE.md) | MD | bookmoa 옵션 B/C 가이드 |
| [`BOOKMOA_INTEGRATION_DIFF.md`](./BOOKMOA_INTEGRATION_DIFF.md) | MD | bookmoa 변경점 정리 |
| [`bookmoa_integration_diff.html`](./bookmoa_integration_diff.html) | HTML | 시각화 |

---

## 🏗️ 3. 시스템 설계

| 문서 | 설명 |
|------|------|
| [`SYSTEM_INTEGRATION_OVERVIEW.md`](./SYSTEM_INTEGRATION_OVERVIEW.md) | 시스템 통합 개요 (v2.5 — 모니터링 + Node 22 추가) |
| [`SYSTEM_INTEGRATION_OVERVIEW.html`](./SYSTEM_INTEGRATION_OVERVIEW.html) | 시각화 |
| [`SYSTEM_ARCHITECTURE.md`](./SYSTEM_ARCHITECTURE.md) | 전체 아키텍처 명세 |
| [`PRD.md`](./PRD.md) | 제품 요구사항 |
| [`04_DATABASE_ERD.md`](./04_DATABASE_ERD.md) | DB ERD |
| [`01_SYSTEM_ARCHITECTURE_KR.md`](./01_SYSTEM_ARCHITECTURE_KR.md) | 시스템 아키텍처 (KR) |
| [`02_SOFTWARE_ARCHITECTURE_KR.md`](./02_SOFTWARE_ARCHITECTURE_KR.md) | SW 아키텍처 (KR) |

---

## 🚀 4. 운영 / 배포 / 모니터링

| 문서 | 설명 |
|------|------|
| [`DEPLOYMENT.md`](./DEPLOYMENT.md) | 배포 가이드 (Node 22 + Grafana + Loki 반영) |
| [`OPERATIONS.md`](./OPERATIONS.md) | 운영 매뉴얼 |
| [`P0_OPERATIONS_CHECKLIST.md`](./P0_OPERATIONS_CHECKLIST.md) | P0 운영 체크리스트 |
| [`SENTRY_SETUP.md`](./SENTRY_SETUP.md) | Sentry 초기 설정 |
| [`SENTRY_SLACK_SETUP.md`](./SENTRY_SLACK_SETUP.md) | Sentry Slack 연결 (사용자 OAuth 대기) |
| [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](./P2_8_METRICS_DASHBOARD_2026-05-04.md) | Grafana + Prometheus 운영 메트릭 |
| [`P2_10_LOG_AGGREGATION_2026-05-04.md`](./P2_10_LOG_AGGREGATION_2026-05-04.md) | Loki 로그 일원화 |
| [`MARIADB_MIGRATION.md`](./MARIADB_MIGRATION.md) | MariaDB 마이그레이션 |
| [`SETUP.md`](./SETUP.md) | 초기 셋업 |
| [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) | 빠른 참조 |

---

## 🔒 5. 보안

| 문서 | 설명 |
|------|------|
| [`USER_IDENTITY_AUDIT_2026-05-03.md`](./USER_IDENTITY_AUDIT_2026-05-03.md) | 사용자 식별 / 주문 추적 감사 |
| [`INTEGRATION_AUDIT_2026-05-03.md`](./INTEGRATION_AUDIT_2026-05-03.md) | 통합 검증 audit (결함 9건) |

---

## 📊 6. 사이클 보고서 (시간역순)

### 2026-05-04
| 문서 | 설명 |
|------|------|
| [`PNG_UPLOAD_HANG_FIX_2026-05-04.md`](./PNG_UPLOAD_HANG_FIX_2026-05-04.md) | PNG 업로드 hang 분석 + revert (별도 사이클로 이관) |
| [`P2_10_LOG_AGGREGATION_2026-05-04.md`](./P2_10_LOG_AGGREGATION_2026-05-04.md) | Pino + Loki + Promtail |
| [`P2_8_METRICS_DASHBOARD_2026-05-04.md`](./P2_8_METRICS_DASHBOARD_2026-05-04.md) | Grafana + Prometheus 옵션 C |
| [`P2_7_E2E_REPORT_2026-05-04.md`](./P2_7_E2E_REPORT_2026-05-04.md) | Admin Playwright 확장 |
| [`DEFECT_13_FIX_REPORT_2026-05-04.md`](./DEFECT_13_FIX_REPORT_2026-05-04.md) | 결함 #13 (Conversion outputFileUrl) |
| [`SYNTHESIS_E2E_REPORT_2026-05-04.md`](./SYNTHESIS_E2E_REPORT_2026-05-04.md) | Worker 합성 E2E 3 시나리오 |
| [`PHASE2_FIX_REPORT_2026-05-04.md`](./PHASE2_FIX_REPORT_2026-05-04.md) | P0-1/P0-2/P1-5/P1-6 + Worker E2E |

### 2026-05-03
| 문서 | 설명 |
|------|------|
| [`AUDIT_FIX_REPORT_2026-05-03.md`](./AUDIT_FIX_REPORT_2026-05-03.md) | 옵션 A 결함 8건 처리 |
| [`AUTOPILOT_SESSION_2026-05-03.md`](./AUTOPILOT_SESSION_2026-05-03.md) | 오토파일럿 사이클 |

### 2026-05-02 이전
| 문서 | 설명 |
|------|------|
| [`AUTOPILOT_SESSION_2026-05-02.md`](./AUTOPILOT_SESSION_2026-05-02.md) | P0-3 + P1×4 + P2×4 |
| [`PHASE5_COMPLETE.md`](./PHASE5_COMPLETE.md) ~ [`PHASE9_COMPLETE.md`](./PHASE9_COMPLETE.md) | Phase 5~9 완료 보고 |
| [`PHASE2_PROGRESS.md`](./PHASE2_PROGRESS.md) ~ [`PHASE2_COMPLETE.md`](./PHASE2_COMPLETE.md) | Phase 2 사이클 |

---

## 🗂️ 7. 트래커 (deprecated — 마스터로 흡수)

| 문서 | 상태 |
|------|------|
| [`REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) | ⚠️ 2026-05-02 스냅샷, 마스터로 흡수 |
| [`NEXT_DEVELOPMENT_PLAN.md`](./NEXT_DEVELOPMENT_PLAN.md) | ⚠️ 2026-05-02 스냅샷 |
| [`NEXT_ISSUES_2026-05-03.md`](./NEXT_ISSUES_2026-05-03.md) | ⚠️ 2026-05-03 스냅샷 |
| [`NEXT_DEVELOPMENT_PLAN.html`](./NEXT_DEVELOPMENT_PLAN.html) | (참조용) |
| [`NEXT_ISSUES_2026-05-03.html`](./NEXT_ISSUES_2026-05-03.html) | (참조용) |

---

## 📋 8. 기능 / 명세 / 가이드

### 에디터 / 캔버스
| 문서 | 설명 |
|------|------|
| [`EDITOR.md`](./EDITOR.md) | 에디터 명세 |
| [`EDITOR_OBJECT_EDITING_SPEC.md`](./EDITOR_OBJECT_EDITING_SPEC.md) | 객체 편집 명세 |
| [`EDITOR_SCREENS.md`](./EDITOR_SCREENS.md) | 에디터 화면 |
| [`MOBILE_TOUCH_UI.md`](./MOBILE_TOUCH_UI.md) | 모바일 UX |
| [`스프레드편집_상세설계서_20260206.md`](./스프레드편집_상세설계서_20260206.md) | 스프레드 편집 상세 |
| [`스프레드편집_결정사항_요약_20260206.md`](./스프레드편집_결정사항_요약_20260206.md) | 결정사항 요약 |
| [`사양변경_기획회의_요약_20260205.md`](./사양변경_기획회의_요약_20260205.md) | 기획회의 요약 |
| [`표지편집 방식 정의.pdf.md`](./표지편집%20방식%20정의.pdf.md) | 표지 편집 정의 |

### Admin
| 문서 | 설명 |
|------|------|
| [`ADMIN_SCREENS.md`](./ADMIN_SCREENS.md) | Admin 화면 |
| [`product-templateset-linking-plan.md`](./product-templateset-linking-plan.md) | Product↔TemplateSet 연결 |

### PDF / 워커
| 문서 | 설명 |
|------|------|
| [`PDF_VALIDATION_GUIDE.md`](./PDF_VALIDATION_GUIDE.md) | PDF 검증 가이드 |
| [`PDF_VALIDATION_API.md`](./PDF_VALIDATION_API.md) | PDF 검증 API |
| [`PDF_VALIDATION_REVIEW.md`](./PDF_VALIDATION_REVIEW.md) | PDF 검증 리뷰 |
| [`PDF_VALIDATION_SUMMARY.md`](./PDF_VALIDATION_SUMMARY.md) | PDF 검증 요약 |
| [`PDF_VALIDATION_WBS.md`](./PDF_VALIDATION_WBS.md) | PDF 검증 WBS |
| [`PDF_VALIDATION_COMPLETE.md`](./PDF_VALIDATION_COMPLETE.md) | PDF 검증 완료 |
| [`WORKER_MERGE_PLAN.md`](./WORKER_MERGE_PLAN.md) | Worker 합성 plan |
| [`worker-ux-plan.md`](./worker-ux-plan.md) | Worker UX |
| [`PDF분리출력_상세설계서_v2.5.md`](./PDF분리출력_상세설계서_v2.5.md) | PDF 분리 출력 |
| [`PDF분리_상세설계서_v1.1.4.md`](./PDF분리_상세설계서_v1.1.4.md) | PDF 분리 v1.1.4 |

### 테스트
| 문서 | 설명 |
|------|------|
| [`TEST_CASES.md`](./TEST_CASES.md) | 테스트 케이스 |
| [`E2E_SCENARIO_TESTS.md`](./E2E_SCENARIO_TESTS.md) | E2E 시나리오 |

### AI / 미래
| 문서 | 설명 |
|------|------|
| [`AI_FEATURES_PLAN.md`](./AI_FEATURES_PLAN.md) | AI 기능 plan |
| [`NEXT_DEVELOPMENT_PLAN.md`](./NEXT_DEVELOPMENT_PLAN.md) | 다음 개발 (deprecated) |
| [`PROJECT_VALIDATION.md`](./PROJECT_VALIDATION.md) | 프로젝트 검증 |
| [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) | 구현 상태 |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | 개발 plan |

### Phase 보고서 (이전 사이클)
| 문서 | 설명 |
|------|------|
| [`PHASE2_PROGRESS.md`](./PHASE2_PROGRESS.md) ~ [`PHASE9_COMPLETE.md`](./PHASE9_COMPLETE.md) | Phase 2~9 진행/완료 |
| [`DEPLOYMENT_COMPLETE.md`](./DEPLOYMENT_COMPLETE.md) | 배포 완료 |
| [`REMAINING_WORK_REVIEW.md`](./REMAINING_WORK_REVIEW.md) | 잔존 작업 리뷰 (deprecated) |
| [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) | 향후 업데이트 |

---

## 🎨 9. 디자인 / 흐름

| 파일 | 설명 |
|------|------|
| `admin-flow.pdf` | Admin 워크플로 다이어그램 |
| `worker-work-flow.pdf` | Worker 워크플로 다이어그램 |
| `표지편집 방식 정의.pdf` | 표지 편집 방식 |

---

## 🔗 외부 / 운영 자료

- **API 문서 (Swagger)**: https://api.papascompany.co.kr/api/docs
- **Grafana 대시보드**: https://api.papascompany.co.kr/grafana/
- **Sentry**: https://papascompany.sentry.io
- **Editor (운영)**: https://editor.papascompany.co.kr
- **Admin (운영)**: https://admin.papascompany.co.kr
- **Repo**: https://github.com/papascompany/storige-book-editor
