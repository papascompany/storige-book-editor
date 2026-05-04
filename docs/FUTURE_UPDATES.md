# Storige 향후 업데이트 이슈 트래커

> **작성일**: 2026-05-03
> **목적**: 즉시 차단되지는 않지만 시점이 되면 처리해야 할 인프라/플랫폼 업데이트 이슈를 누적 관리.
> **갱신 정책**: 각 이슈는 발견 시점에 등록하고, 처리 완료 시 ✅ 표시 후 `완료된 항목` 섹션으로 이동.

---

## 🟡 진행 중 / 대기 중

### 1. Node 20 → Node 22 LTS 마이그레이션 ✅ 완료 (2026-05-04)
- **상태**: ✅ **완료** (커밋 `4d0bf1d`)
- **이력**:
  - 2026-05-03: 이슈 등록 (Node 20 LTS EOL 2026-04-30)
  - 2026-05-04: PHP 통합 컷오버 전 안전화 — Node 22 마이그레이션 진행
- **수행 작업**:
  - ✅ Docker base 6곳 `node:20-alpine` → `node:22-alpine` (api builder/runtime, worker builder/runtime, editor builder, admin builder)
  - ✅ root engines.node `">=20"` → `">=22"` (Vercel 자동 22.x 사용)
  - ✅ canvas dead dep 제거 (worker — import 0건, 실제 미사용 확인)
  - ✅ native deps 호환 검증
    - sharp@0.33.5 engines `>=21.0.0` 포함 → OK
    - bcrypt@5.1.1 N-API ABI 3 prebuild → OK
    - better-sqlite3@12.5.0 / sqlite3@5.1.7 → OK
- **운영 검증**:
  - VPS storige-api / storige-worker `node --version` = `v22.22.2` ✅
  - API health 정상, JWT 발급(bcrypt) 정상, Bull 큐 처리 정상
  - Prometheus storige-api target up
- **남은 사항**:
  - Vercel admin/editor: ignoreCommand로 build skip 됨(변경 없음). 다음 editor/admin 코드 변경 시 root engines로 자동 Node 22 빌드.
  - Sentry profiling-node 재도입 검토 (Alpine native build 이슈로 제거됨, `f5e22d9`)는 별도 사이클

---

### 2. P2-8 풀 Grafana + Prometheus 셋업 (옵션 B 확장)
- **상태**: ⏳ 대기 (P2-8 옵션 C 하이브리드 완료 후 검토)
- **발견 시점**: 2026-05-04
- **컨텍스트**:
  - 2026-05-04 P2-8 옵션 C(하이브리드) 셋업 완료 — 시스템/큐 메트릭은 Grafana, HTTP latency는 Sentry Performance.
  - 현재 운영 트래픽 규모(VPS 1대, 일 주문 수십~수백 예상)에는 충분.
- **본 작업 (별도 사이클)**:
  - [ ] Sentry Performance에 의존 중인 부분(API endpoint p50/p95, top slow endpoints)을 Grafana로 흡수
  - [ ] OpenTelemetry tracer 추가 (현재 Sentry SDK가 자동 transaction 발생 → otel-collector로 전환)
  - [ ] Tempo/Jaeger 도입 검토 (분산 트레이싱)
  - [ ] Loki 로그 수집 (현재 Docker logs만)
  - [ ] alertmanager 추가 + Slack 알림 일원화 (현재 Sentry Slack과 분리)
  - [ ] Grafana 사용자 정책 (Viewer / Editor) + LDAP 또는 OAuth 연계
- **권장 일정**: PHP 통합 운영 안정화 후 (2026-Q3 이후), 또는 다음 조건 만족 시 즉시:
  - 일 주문 1000건 초과
  - VPS 단일 → 다중 인스턴스 전환
  - 외부 SLO 약속 (계약상 99.9% 등)
- **위험도**: 🟡 중 (운영 인프라 추가 — VPS 메모리 +400MB 예상, 모니터링 시스템 자체 운영 부담)

---

### 3. (예약) PHP 양측 통합 검증 후 후속 정리
- 상태: ⏳ 대기 (P0-1)
- 핵심: bookmoa PHP 측 코드 적용 + 양측 E2E
- 별도 트래커: `REMAINING_WORK_REVIEW.md` §B

---

### 4. PNG 업로드 시 hang / unresponsive 모달 — 부분 fix 완료, 본 fix 별도 사이클
- **상태**: ⏳ 잠재 이슈 (현재 비활성, 별도 사이클 예정)
- **발견**: 2026-05-04 운영 사용자 보고 (Sentry `a894a16e84c141f19fb12a7697ac398f`)
- **시나리오**: 맥북 에디터 → 요소 → PNG 업로드 → "이 페이지를 나가겠습니까?" 모달
- **원인**:
  1. OpenCV WASM 첫 다운로드/컴파일 (~5초 메인 스레드 점유)
  2. onnxruntime-web COOP/COEP 미설정 → single-threading fallback (~10× 느림)
- **시도 + 회귀**:
  - A) `warmupOpenCv()` mount 호출 — 무영향, 안전
  - B) COOP `same-origin` + COEP `credentialless` — **운영 메뉴 클릭 차단** 발생, 즉시 revert
    · Chrome 확장(Leap) inject script가 credentialless로 차단되어 페이지 이벤트 시스템 깨짐 추정
  - C) Web Worker 분리 — 미진행
- **회귀 분석 후속 작업**:
  - [ ] 시크릿 모드 / 다양한 브라우저에서 COEP 사전 검증
  - [ ] COEP `require-corp` 변형 시도 (외부 자원 차단 명확히 — 진단 용이)
  - [ ] 또는 OpenCV/onnxruntime을 Web Worker로 분리 (옵션 C, 1~2일)
  - [ ] 또는 자동 다운스케일 (workspace ÷ 2 초과 PNG 사전 리사이즈, 반나절)
  - [ ] `useUploading` selector를 EditorView에 구독해서 spinner 표시 (현재 export만 됐고 import 0건)
- **임시 조치**:
  - canvas-core의 `warmupOpenCv` / `warmupBackgroundRemoval` export 유지 (재시도 시 import 1줄로 활성)
  - nginx `/storage/*` 응답 CORP 헤더 유지 (B 재활성 시 통과 보장)
- **권장 일정**: PHP 통합 컷오버 + 안정화 후 (2026-Q3)
- **위험도**: 🟡 중 (일부 사용자가 큰 PNG 첫 업로드 시 hang 경험, 작은 파일/두 번째 업로드는 정상)

---

### 5. (예약) Admin 비밀번호 강제 교체
- 상태: ❌ 미진행 (P0-2)
- 핵심: 시드값 `admin@storige.com` / `admin123` → 강한 값
- 별도 트래커: `NEXT_DEVELOPMENT_PLAN.md`

---

## ✅ 완료된 항목

(아직 없음 — 본 문서는 2026-05-03 신설)

---

## 📋 등록 가이드

새 이슈 등록 시 다음 형식 사용:

```md
### N. 이슈 제목
- **상태**: ⏳ 대기 / 🟡 진행 중 / ✅ 완료
- **발견 시점**: YYYY-MM-DD
- **컨텍스트**: (배경 설명)
- **임시 조치**: (즉시 적용된 미봉책 — 있을 시)
- **본 작업 (별도 사이클)**: (체크리스트)
- **권장 일정**: (대략적 타임라인)
- **위험도**: 🟢 저 / 🟡 중 / 🔴 고
```

---

## 🔗 관련 문서

- `REMAINING_WORK_REVIEW.md` — 트랙별 잔존 작업 마스터 트래커
- `NEXT_DEVELOPMENT_PLAN.md` — 다음 1~2주 sprint 계획
- `AUTOPILOT_SESSION_2026-05-02.md` — 직전 사이클 결과
- `DEPLOYMENT.md` — 배포 가이드 (Node/Docker 환경 명세 포함)
