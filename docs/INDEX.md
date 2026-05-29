# Storige 문서 인덱스

> **갱신**: 2026-05-10 · 편집기 UX·관리자 모드 분리 사이클 반영
> **HTML 가이드 통합**: `Storige_개발가이드.html`, `WORKER_FLOW_시각화.html` 가 docs/ 로 합류 (이전엔 부모 디렉토리)

📊 **시작점**: [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) (최신)
🏗 **시각 가이드**: [`Storige_개발가이드.html`](./Storige_개발가이드.html) (사이드바 네비, 에디터 UX 사이클 반영)

---

## ⭐ 1. 마스터 트래커 (현재 활성)

| 문서 | 형식 | 설명 |
|------|------|------|
| [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) | MD | **최신** — 편집기 UX·관리자 모드 분리 (7건 커밋) |
| [`MASTER_STATUS_2026-05-07.md`](./MASTER_STATUS_2026-05-07.md) | MD | 멀티사이트 플랫폼화 완료, 98% 진척 |
| [`MASTER_STATUS_2026-05-04.md`](./MASTER_STATUS_2026-05-04.md) | MD | 스냅샷 (2026-05-04) |
| [`MASTER_STATUS_2026-05-04.html`](./MASTER_STATUS_2026-05-04.html) | HTML | 시각화 (구 버전) |
| [`FUTURE_UPDATES.md`](./FUTURE_UPDATES.md) | MD | 향후 인프라 + Phase A/B/C 완료 + 후속 작업 |

---

## 🤝 2. 외부 사이트 연동 가이드 (현재)

### 🆕 플랫폼 워커 연동 (언어 중립, 2026-05-07)
| 문서 | 형식 | 설명 |
|------|------|------|
| [`PLATFORM_WORKER_INTEGRATION_v1.md`](./PLATFORM_WORKER_INTEGRATION_v1.md) | MD | 외부 사이트 개발자용 자기완결 가이드 (curl/Node/Python/Go) |
| [`PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md`](./PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md) | MD | AI에 가이드 첨부 후 즉시 코드 생성 프롬프트 |

### PHP 한정 (편집기 UI 포함)
| 문서 | 형식 | 설명 |
|------|------|------|
| [`PHP_INTEGRATION_FINAL_v3.md`](./PHP_INTEGRATION_FINAL_v3.md) | MD | PHP 팀 전달용 최종 가이드 v3.1 (멀티사이트 안내 포함) |
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

### 🆕 2026-05-29 — 추후 개발 로드맵 / Shopify
| 문서 | 설명 |
|------|------|
| [`ROADMAP_2026-05-29.md`](./ROADMAP_2026-05-29.md) | **추후 개발 로드맵** — v1 GA 통과 후 트랙 정리 (T1 Pilot 운영 / T2 v1 polish / T3 Shopify GO·보류 / T4·T5 v2 후보) |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.md`](./SHOPIFY_APP_PROPOSAL_2026-05-16.md) | Shopify 앱스토어 publish 계획 (v1.1, GO 결정 완료) — 시장/경쟁사/가격/로드맵 S-1~S-7 |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.html`](./SHOPIFY_APP_PROPOSAL_2026-05-16.html) | 위 제안서 시각화 |
| [`SHOPIFY_TECHNICAL_DESIGN.md`](./SHOPIFY_TECHNICAL_DESIGN.md) | Shopify 앱 기술 설계 — OAuth/Webhook/Billing/i18n/Theme Extension (S-2~S-5) |
| [`../docs2/CURSOR_ORCHESTRATION_PLAN.md`](../docs2/CURSOR_ORCHESTRATION_PLAN.md) | bookmoa-mobile 연동 Cursor 조율 협업 계획 (2026-05-20) |

### 🆕 2026-05-19 — 전략 / 핸드오프
| 문서 | 설명 |
|------|------|
| [`MODULE_PLATFORM_STRATEGY_2026-05-19.html`](./MODULE_PLATFORM_STRATEGY_2026-05-19.html) | **모듈 분기 + 플랫폼화 전략** (시각화) — 5 옵션 비교, 3-Layer 권장, Phase A~D 로드맵, 모드 A/B/C 의사결정, SaaS 운영 모델 |
| [`../.cursor/plans/RESUME_PROMPT_2026-05-19.md`](../.cursor/plans/RESUME_PROMPT_2026-05-19.md) | 세션 핸드오프 — 5/15~19 fix 8건 + 인쇄 워크플로우 v1 컨펌 대기 |

### 2026-05-09 ~ 05-10 — 편집기 UX · 관리자 모드 분리
| 문서 | 설명 |
|------|------|
| [`MASTER_STATUS_2026-05-10.md`](./MASTER_STATUS_2026-05-10.md) | 7건 커밋 사이클 보고서 (UX 누수 정리 + 운영 베이스 디자인 흐름) |
| [`PHP_NOTICE_2026-05-10_admin_template_set_edit.md`](./PHP_NOTICE_2026-05-10_admin_template_set_edit.md) | PHP 팀 통보 — admin 템플릿셋 수정 모드 추가 (PHP 영향 없음) |

### 2026-05-06 ~ 05-07 — 멀티사이트 플랫폼화
| 문서 | 설명 |
|------|------|
| [`ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md`](./ADMIN_PLATFORMIZATION_PLAN_2026-05-06.md) | 11p PDF 스토리보드 분석 + 4 카테고리 플랫폼화 계획 |
| [`PHASE_A_SITE_MODEL_REPORT_2026-05-06.md`](./PHASE_A_SITE_MODEL_REPORT_2026-05-06.md) | Site/Tenant 모델 도입 + admin "기본설정" |
| [`PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md`](./PHASE_B_C_SITE_CONTEXT_REPORT_2026-05-06.md) | 사이트별 워커 옵션 + site_id 자동 주입 1차 |
| [`PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md`](./PHASE_B2_C2_C3_FOLLOWUP_REPORT_2026-05-07.md) | 후속 사이클 (default 머지 + JWT siteId + admin dropdown + backfill) |

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
| [`EDITOR.md`](./EDITOR.md) | **에디터 명세** (§1~§6 데이터/룰/권한, §7~§12 UX 사이클 — 도구 메뉴/디폴트 샘플/핸들/워크스페이스 정렬/모드별 헤더) |
| [`EDITOR_SCREENS.md`](./EDITOR_SCREENS.md) | **에디터 화면** + 저장 흐름 매트릭스 + Admin 라벨 + 모드별 헤더 UI |
| [`EDITOR_OBJECT_EDITING_SPEC.md`](./EDITOR_OBJECT_EDITING_SPEC.md) | 객체 편집 명세 |
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
| [`ROADMAP_2026-05-29.md`](./ROADMAP_2026-05-29.md) | **추후 개발 로드맵 (현재 활성)** — v1 GA 후 트랙 우선순위 |
| [`SHOPIFY_APP_PROPOSAL_2026-05-16.md`](./SHOPIFY_APP_PROPOSAL_2026-05-16.md) | Shopify 앱 계획 (GO·착수 보류) |
| [`SHOPIFY_TECHNICAL_DESIGN.md`](./SHOPIFY_TECHNICAL_DESIGN.md) | Shopify 앱 기술 설계 |
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
| [`Storige_개발가이드.html`](./Storige_개발가이드.html) | **시각 통합 개발 가이드** — 시스템 관계도/코드베이스 지도/에디터 UX/위험 포인트 (사이드바 네비) |
| [`WORKER_FLOW_시각화.html`](./WORKER_FLOW_시각화.html) | Worker 파이프라인 시각화 (validate → convert → synthesize) |
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
