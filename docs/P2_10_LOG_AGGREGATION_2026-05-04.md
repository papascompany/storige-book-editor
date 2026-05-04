# P2-10 로그 일원화 — Pino + Loki + Promtail (2026-05-04)

## 요약

API/Worker가 Pino로 JSON 구조화 로그를 stdout에 배출 → Promtail이 Docker `json-file` 드라이버 로그를 수집해 Loki로 푸시 → Grafana(P2-8)에서 시각화/검색. P2-8 모니터링 스택과 자연스럽게 통합되어 메트릭/로그 한 화면 운영.

## 변경 사항

### API + Worker 코드
- `nestjs-pino@^4` + `pino-http@^10` + `pino@^9` 추가
- **API** `app.module.ts`: `LoggerModule.forRoot` — production JSON / dev pino-pretty
  - `autoLogging.ignore`: `/api/health/{metrics,live,ready,health}` 제외 (소음 감소)
  - 식별 base label: `app=storige-api`
- **Worker** `app.module.ts`: 동일 패턴 (autoLogging=false, 잡 처리 중심)
  - 식별 base label: `app=storige-worker`
- **main.ts**: `bufferLogs: true` + `app.useLogger(app.get(PinoLogger))`
- 명시적 `console.log` → pino logger 교체 (CORS blocked, server start)

### Infra (docker-compose.yml + 2개 신규 서비스)

| 서비스 | 이미지 | 포트 (외부) | 메모리 추가 |
|--------|--------|-------------|-------------|
| `storige-loki` | `grafana/loki:3.2.1` | — | ~120MB |
| `storige-promtail` | `grafana/promtail:3.2.1` | — | ~40MB |

총 메모리 추가 ~160MB (P2-8 240MB + P2-10 160MB = 400MB / VPS 8GB의 5%).

### Loki 설정 (`docker/loki/loki-config.yml`)
- 단일 노드 + 파일시스템 저장 (소규모 운영 적정)
- TSDB v13 schema, 14일 보존 (`retention_period: 336h`)
- 외부 노출 X (docker network 내부만, Grafana datasource로만 접근)

### Promtail 설정 (`docker/promtail/promtail-config.yml`)
- `docker_sd_configs` — `storige-api/-worker/-nginx/-mariadb/-redis` 컨테이너만 자동 발견
- relabel:
  - `__meta_docker_container_name` → `service` (예: `storige-api` → `api`)
  - `__meta_docker_container_log_stream` → `stream` (stdout/stderr)
- pipeline: `service=~"api|worker"` 만 JSON 파싱 → `level`, `app`, `time` 라벨로 추출

### Grafana provisioning
- Loki datasource 자동 등록 (`datasources/prometheus.yml`에 추가)
- 신규 대시보드 [`docker/grafana/dashboards/storige-logs.json`](../docker/grafana/dashboards/storige-logs.json) — uid `storige-logs`
  - 📋 라이브 로그 row: API / Worker (level multi-select 변수: info/warn/error/fatal/debug)
  - 📊 로그 메트릭 row: 에러 발생률(errors/min, 서비스별) / 전체 로그 처리량
  - 🌐 Nginx row (collapsed): nginx 액세스 로그

## 운영 사용법

### 라이브 로그 (대시보드)
```
URL:      https://api.papascompany.co.kr/grafana/
대시보드: Storige > Storige 로그
필터:    상단 level 변수 (multi-select)
```

### 임시 로그 검색 (Grafana Explore)
```
LogQL 예시:
  {service="api"} | json | level="error"
  {service="worker"} | json |~ "synthesis"
  {service="api"} | json | url=~"/worker-jobs/.*" | line_format "{{.method}} {{.url}} → {{.statusCode}}"
```

### 디버그 로그 (개발자)
- API/Worker `LOG_LEVEL=debug` env 주입 시 debug 레벨까지 push
- 운영에서 임시 디버깅: `.env` 수정 → 컨테이너 restart

## Sentry와의 분담

| 도구 | 역할 |
|------|------|
| **Sentry** | 에러 stack trace, 컨텍스트, 알림 (Slack), Performance (transaction tracing) |
| **Loki/Grafana** | 전체 로그 검색, 시계열 패턴, 이벤트 누적, 디버그 로그 운영 활성 |

이중 발사 패턴: 5xx 에러는 Sentry로 자동 캡처(SentryExceptionFilter) + Loki에도 stdout으로 기록되어 양쪽에서 확인 가능.

## 검증 결과

VPS 배포 (커밋 `930e213`):

### 1. 컨테이너
```
storige-promtail   Up
storige-loki       Up
storige-api        Up (rebuild — pino logger)
storige-worker     Up (rebuild — pino logger)
storige-grafana    Up (restart — Loki datasource provisioning)
```

### 2. Loki ready
```
$ docker exec storige-loki wget -q -O - http://localhost:3100/ready
ready
```

### 3. Promtail 로그 push 누적
- `promtail_sent_entries_total{host="loki:3100"}` = **37,024 entries** (배포 5초 만에)

### 4. Loki 라벨 등록
```
labels: [__stream_shard__, app, container, level, service, service_name, stream]
service values: [api, mariadb, nginx, redis, redis-exporter, worker]
```

### 5. Pino JSON 로그 정상 수집 (실제 LogQL 응답)
```json
{
  "stream": {"app":"storige-api","container":"storige-api","service":"api","level":"30","stream":"stdout"},
  "values": [["1777868523794000000",
    "{\"level\":30,\"time\":1777868523794,\"app\":\"storige-api\",\"env\":\"production\",
      \"context\":\"🚀 API Server running on http://localhost:4000\",
      \"port\":4000,\"docsUrl\":\"http://localhost:4000/api/docs\",\"maxBodySize\":\"100mb\"}"
  ]]
}
```
→ Pino logger 동작 + JSON 필드(`app`, `env`, `port`, `docsUrl`...) 자동 색인 확인.

### 6. LogQL 쿼리 성능
- 216 lines processed / 9.6ms / 22,538 lines/s — 운영에 충분.

### 7. Grafana 외부 접근
- `https://api.papascompany.co.kr/grafana/d/storige-logs` → 302 (인증 redirect)
- "Storige 로그" 대시보드 등록 확인 (uid `storige-logs`)

### 8. 후속 fix 1건 (commit별도)
- Pino `level`은 숫자(30=info, 40=warn ...) — 대시보드 변수는 문자열 multi-select
- Promtail `pipeline_stages.template`에 숫자→문자열 변환 stage 추가
- 변환 매핑: `60=fatal / 50=error / 40=warn / 30=info / 20=debug / 10=trace`

## 후속 작업 (FUTURE_UPDATES.md 트래커)

- [ ] OpenTelemetry tracer 통합 (Sentry tracing → Tempo/Jaeger 전환 검토) → 옵션 B
- [ ] alertmanager 도입 (Loki LogQL alert + Slack 일원화)
- [ ] Pino + redaction 설정 보강 (Authorization, Cookie 헤더 자동 마스킹)

## 참조

- P2-8 메트릭 대시보드: [`docs/P2_8_METRICS_DASHBOARD_2026-05-04.md`](P2_8_METRICS_DASHBOARD_2026-05-04.md)
- 옵션 B 트래커: [`docs/FUTURE_UPDATES.md`](FUTURE_UPDATES.md) §2
- Sentry 가이드: [`docs/SENTRY_SETUP.md`](SENTRY_SETUP.md)
