# P2-8 운영 메트릭 대시보드 보고서 (2026-05-04)

## 요약

옵션 C(하이브리드) 셋업으로 Grafana + Prometheus 자체 호스팅 + Sentry Performance 분담 구조 완성. 시스템·Bull 큐·Redis 메트릭은 Grafana, HTTP latency·에러는 Sentry로 운영자가 한 화면에서 시계열 추이와 SLO를 확인 가능.

옵션 B(풀 셋업: OTel/Loki/Tempo/alertmanager)는 [`docs/FUTURE_UPDATES.md`](FUTURE_UPDATES.md) §2에 후속 트래커로 분리.

## 변경 사항

### API 코드
- `apps/api/package.json`: `prom-client@^15` 추가
- `apps/api/src/health/metrics.service.ts` (신규)
  - Node.js 기본 메트릭 (CPU, heap, GC, event loop lag)
  - Bull 큐 게이지 — `storige_bull_queue_jobs{queue,state}`, `storige_bull_queue_backlog{queue}`
  - 30초 주기 갱신 (Prometheus scrape interval 15초의 2배수, staleness 1분 이하)
- `apps/api/src/health/health.controller.ts`: `GET /api/health/metrics` (`@Public`, `Cache-Control: no-store`)

### Infra (docker-compose.yml + 4개 신규 서비스)

| 서비스 | 이미지 | 포트 (외부) | 포트 (내부) | 메모리 |
|--------|--------|-------------|-------------|--------|
| `storige-prometheus` | `prom/prometheus:v2.55.1` | — | 9090 | ~70MB |
| `storige-grafana` | `grafana/grafana:11.2.2` | — (nginx 경유) | 3000 | ~150MB |
| `storige-node-exporter` | `prom/node-exporter:v1.8.2` | — | 9100 | ~10MB |
| `storige-redis-exporter` | `oliver006/redis_exporter:v1.66.0-alpine` | — | 9121 | ~10MB |

총 메모리 추가 ~240MB (VPS 8GB의 3%, 여유 있음).

### Prometheus 설정
- `docker/prometheus/prometheus.yml`: 3개 scrape job (storige-api, node, redis)
- TSDB 30일 보존 (`--storage.tsdb.retention.time=30d`)
- 외부 노출 X (docker network 내부만)

### Grafana provisioning
- `docker/grafana/provisioning/datasources/prometheus.yml` — Prometheus datasource 자동 등록
- `docker/grafana/provisioning/dashboards/storige.yml` — 대시보드 폴더 자동 생성
- `docker/grafana/dashboards/storige-overview.json` — 메인 대시보드 (4 row, 11 패널)

#### 대시보드 구성

| Row | 패널 | Prometheus Query 핵심 |
|-----|------|----------------------|
| 📊 VPS 시스템 | CPU 사용률 / 메모리 / 디스크(/) / 네트워크 I/O | `node_cpu_seconds_total{mode=idle}`, `node_memory_*`, `node_filesystem_*`, `node_network_*` |
| 🚀 Storige API | API 메모리 (heap, RSS) / Event Loop Lag (p99) | `process_resident_memory_bytes`, `nodejs_heap_*`, `nodejs_eventloop_lag_*` |
| ⚙️ Worker Bull 큐 | 큐 Backlog / 잡 누적 (Completed) / 잡 실패 1h delta | `storige_bull_queue_backlog`, `storige_bull_queue_jobs{state=*}` |
| 🗄️ Redis | 메모리 사용량 / 명령 처리량 | `redis_memory_*`, `rate(redis_commands_processed_total[1m])` |

### Nginx
- `/api/health/metrics` 외부 차단 (`return 404`) — Prometheus는 docker network 직접 접근
- `/grafana/` 프록시 + websocket upgrade (Grafana live)

### 보안
- `GF_SERVER_SERVE_FROM_SUB_PATH=true` + `/grafana/` 경로
- Grafana 자체 admin 인증 (`GF_SECURITY_ADMIN_PASSWORD` env)
- 익명 접근 비활성 (`GF_AUTH_ANONYMOUS_ENABLED=false`)
- 사용자 가입 비활성 (`GF_USERS_ALLOW_SIGN_UP=false`)
- VPS `.env`의 `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` 으로 주입

## 접근 방법

```
URL:      https://api.papascompany.co.kr/grafana/
계정:     admin
비밀번호: CLAUDE.local.md §5 참조 (또는 VPS .env GRAFANA_ADMIN_PASSWORD)
대시보드: Storige > "Storige 운영 메트릭"
```

## 검증 결과

VPS 배포 (커밋 `264ac32` + nginx fix `d3042f6`):

### 1. 컨테이너 상태
```
storige-grafana          Up
storige-prometheus       Up
storige-redis-exporter   Up
storige-node-exporter    Up
storige-api              Up (rebuild)
```

### 2. Prometheus targets — **3/3 up**
```
node            up   http://node-exporter:9100/metrics
redis           up   http://redis-exporter:9121/metrics
storige-api     up   http://api:4000/api/health/metrics
```

### 3. API metrics endpoint
- 외부 `/api/health/metrics` → **HTTP 404** (nginx 차단 ✅)
- 내부 `api:4000/api/health/metrics` → 정상 (Bull 큐 게이지 + Node.js default)

### 4. Bull 큐 메트릭 샘플 (Prometheus query 실증)
```json
{
  "metric": {"queue":"pdf-validation"},
  "value": [..., "0"]
}
{
  "metric": {"queue":"pdf-conversion"},
  "value": [..., "0"]
}
```
3개 큐 모두 `storige_bull_queue_backlog` 게이지 정상 노출 + `storige_bull_queue_jobs{state=completed}` = 4 (운영 잡 카운트 반영).

### 5. Grafana datasource 자동 등록
```json
[{"id":1,"name":"Prometheus","type":"prometheus","url":"http://prometheus:9090","isDefault":true,...}]
```

### 6. Grafana 대시보드 자동 등록
```json
[{"uid":"storige-overview","title":"Storige 운영 메트릭","tags":["p2-8","storige"],"folderTitle":"Storige"}]
```

### 7. Grafana 외부 접근
- `https://api.papascompany.co.kr/grafana/` → 302 → `/grafana/login` → **HTTP 200** (HTML 정상)
- nginx `proxy_pass` 무한 redirect 이슈 1건 발견·수정 (`d3042f6` — trailing slash 제거)

### 8. 발견한 운영 노하우
- **bind mount nginx.conf 갱신은 nginx -s reload만으론 부족** — git pull 후 호스트 inode 변경 시 컨테이너는 옛날 inode를 캐시. `docker compose restart nginx` 필요.

## Sentry Performance 분담 (옵션 C 핵심)

대시보드 상단의 외부 링크: **Sentry — HTTP latency / 에러** (`https://papascompany.sentry.io/projects/storige-api/`)
- API endpoint별 p50/p95 latency, 5xx 비율, top slow endpoints는 **Sentry Performance** 탭 그대로 사용
- Grafana는 인프라/리소스 중심 — 두 도구를 한 화면에서 링크로 연결

## 다음 단계 (현재 사이클 종료 후)

- [ ] Slack 알림 룰 (Grafana → Slack) — 옵션이고 현재 Sentry Slack과 채널 통합 시 일원화
- [ ] alertmanager 도입 검토 (옵션 B 트래커)
- [ ] Sentry Performance 자체 룰 → Grafana panel로 이전 검토 (옵션 B 트래커)

## 참조

- 트래커: [`docs/FUTURE_UPDATES.md`](FUTURE_UPDATES.md) §2 (옵션 B 풀 셋업)
- Sentry 설정: [`docs/SENTRY_SETUP.md`](SENTRY_SETUP.md), [`SENTRY_SLACK_SETUP.md`](SENTRY_SLACK_SETUP.md)
- 큐 모니터 위젯 (Admin): [`apps/admin/src/components/QueueMonitorWidget.tsx`](../apps/admin/src/components/QueueMonitorWidget.tsx) — `/api/health/queues`로 Admin UI에서 5초 폴링 (사용자용 5초 단위 즉시 확인)
