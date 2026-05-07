# Storige - Print Shopping Mall System

React + NestJS 기반 인쇄 쇼핑몰 워커 & 편집기 통합 시스템

## 📋 프로젝트 개요

- **Frontend**: React 18 + Vite + Fabric.js
- **Backend**: NestJS 10 + TypeORM + MySQL
- **Worker**: NestJS + Bull + pdf-lib
- **Infrastructure**: Docker Compose + Nginx
- **Monorepo**: pnpm + Turborepo

## 🏗️ 아키텍처

```
storige/
├── apps/
│   ├── editor/              # React 편집기 (고객용)
│   ├── admin/               # React 관리자 (템플릿 관리)
│   ├── api/                 # NestJS 백엔드 (REST API)
│   └── worker/              # NestJS 워커 (PDF 검증/변환/합성)
└── packages/
    ├── types/               # 공통 TypeScript 타입
    ├── ui/                  # 공통 UI 컴포넌트
    └── canvas-core/         # 캔버스 엔진 (Fabric.js 래퍼)
```

## 🚀 시작하기

### 필수 요구사항

- **Node.js >= 22.0.0** (Node 22 LTS Jod, EOL 2027-04-30)
- pnpm >= 9.0.0
- Docker & Docker Compose (프로덕션 배포용)

### 설치

```bash
# 의존성 설치
pnpm install

# 개발 서버 실행 (전체)
pnpm dev

# 개별 실행
pnpm --filter @storige/editor dev
pnpm --filter @storige/admin dev
pnpm --filter @storige/api dev
pnpm --filter @storige/worker dev
```

### 빌드

```bash
# 전체 빌드
pnpm build

# 개별 빌드
pnpm --filter @storige/api build
```

## 🐳 Docker 배포

```bash
# 환경 변수 설정
cp .env.example .env

# Docker Compose 실행
docker-compose up -d

# 로그 확인
docker-compose logs -f
```

## 📦 서비스 포트

| 서비스 | 포트 | 설명 |
|--------|------|------|
| Nginx | 80/443 | 리버스 프록시 |
| Editor | 3000 | 편집기 (개발) |
| Admin | 3001 | 관리자 (개발) |
| API | 4000 | REST API |
| Worker | 4001 | PDF 워커 |
| MariaDB | 3306 | 데이터베이스 |
| Redis | 6379 | 큐 & 캐시 |
| Prometheus | (내부) | 메트릭 수집 (P2-8) |
| Grafana | nginx `/grafana/` | 메트릭 + 로그 대시보드 |
| Loki | (내부) | 로그 일원화 (P2-10) |

## 📚 문서

### ⭐ 마스터 트래커
- [**MASTER_STATUS_2026-05-07.md**](./docs/MASTER_STATUS_2026-05-07.md) — **최신** 전체 개발 상태 (98% 완료, 멀티사이트 플랫폼화 완료)
- [docs/INDEX.md](./docs/INDEX.md) — 전체 문서 카탈로그
- [docs/FUTURE_UPDATES.md](./docs/FUTURE_UPDATES.md) — 향후 인프라 + 후속 작업

### 🤝 외부 사이트 연동 가이드
- [**PLATFORM_WORKER_INTEGRATION_v1.md**](./docs/PLATFORM_WORKER_INTEGRATION_v1.md) — 외부 사이트 개발자용 (언어 중립)
- [PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md](./docs/PLATFORM_WORKER_INTEGRATION_AI_PROMPT.md) — AI 구현 프롬프트
- [PHP_INTEGRATION_FINAL_v3.md](./docs/PHP_INTEGRATION_FINAL_v3.md) v3.1 / [HTML](./docs/PHP_INTEGRATION_FINAL_v3.html) — PHP 한정 (편집기 UI 포함)

### 🏗️ 시스템 설계
- [SYSTEM_INTEGRATION_OVERVIEW.md](./docs/SYSTEM_INTEGRATION_OVERVIEW.md) — 시스템 통합 개요 v2.5
- [PRD.md](./docs/PRD.md) — 제품 요구사항
- [SYSTEM_ARCHITECTURE.md](./docs/SYSTEM_ARCHITECTURE.md) — 아키텍처 명세

### 🚀 운영
- [DEPLOYMENT.md](./docs/DEPLOYMENT.md) — 배포 가이드 + 모니터링 스택
- [SENTRY_SETUP.md](./docs/SENTRY_SETUP.md) — Sentry 설정
- [SENTRY_SLACK_SETUP.md](./docs/SENTRY_SLACK_SETUP.md) — Slack 알림 연결
- [P2_8_METRICS_DASHBOARD_2026-05-04.md](./docs/P2_8_METRICS_DASHBOARD_2026-05-04.md) — Grafana 대시보드
- [P2_10_LOG_AGGREGATION_2026-05-04.md](./docs/P2_10_LOG_AGGREGATION_2026-05-04.md) — Loki 로그 일원화
- [FUTURE_UPDATES.md](./docs/FUTURE_UPDATES.md) — 향후 인프라 업데이트 트래커

### 🔒 보안
- [SECURITY_PATCH_PHP_NOTICE_2026-05-03.md](./docs/SECURITY_PATCH_PHP_NOTICE_2026-05-03.md) — 보안 패치 A-E PHP 통보
- [USER_IDENTITY_AUDIT_2026-05-03.md](./docs/USER_IDENTITY_AUDIT_2026-05-03.md) — 사용자 식별 감사

## 🛠️ 개발 스택

### Frontend
- React 18
- TypeScript
- Vite
- Fabric.js
- Zustand (Editor)
- Ant Design (Admin)
- TailwindCSS

### Backend
- NestJS 10 (Node 22 LTS)
- TypeORM + MariaDB 11.2
- Redis 7.2
- Bull (Queue)
- JWT Authentication
- Pino logger (구조화 JSON)
- prom-client (Prometheus metrics)

### Worker
- NestJS 10 (Node 22 LTS)
- Bull (Consumer)
- pdf-lib
- Sharp
- Ghostscript

### Monitoring (P2-8 + P2-10)
- Prometheus 2.55.1 + Grafana 11.2.2
- Loki 3.2.1 + Promtail 3.2.1 (Docker json-file 수집)
- Sentry (4 프로젝트, Slack 알림 연동 가능)
- node-exporter / redis-exporter

## 📝 라이센스

Proprietary - All rights reserved
