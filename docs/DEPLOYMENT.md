# Storige Deployment Guide

> 🔄 **갱신**: 2026-05-04 — Node 22 LTS 마이그레이션, Grafana + Prometheus, Loki + Promtail 모니터링 스택 반영
>
> 🔄 **갱신**: 2026-06-15 — 저장계층 R2 추상화 + 보존정책(admin 관리형). **신규 DB 마이그레이션 2건**(아래 "스키마 마이그레이션") + R2 활성화 절차는 [`STORAGE_R2_RUNBOOK.md`](./STORAGE_R2_RUNBOOK.md) 참조.
>
> 🔄 **갱신**: 2026-06-17 — 멀티테넌시 P1+P2a. **신규 DB 마이그레이션 2건 프로덕션 적용완료**(`20260617_add_user_site_roles.sql`·`20260617_b_add_site_id_data_scoping.sql`, 아래 "스키마 마이그레이션") + Vercel `ignoreCommand` 견고화(아래 "Vercel 배포 파이프라인" — admin 배포 ERROR 고착 트랩 해소).

> ### ⚠️ 스키마 마이그레이션 (synchronize=false → 수동, API 재배포 **전** 실행)
> 프로덕션은 TypeORM `synchronize=false` 이므로 엔티티 변경 시 `apps/api/migrations/*.sql` 을 수동 실행 후 API 재배포한다(순서 중요 — 신규 코드가 컬럼/테이블 존재를 전제).
> ```bash
> ssh deploy@<host> && source ~/storige/.env
> # 미적용 마이그레이션을 날짜순으로 실행 (예: 2026-06-13·06-15 저장계층/보존정책)
> docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
>   < ~/storige/apps/api/migrations/20260613_add_files_storage_backend.sql
> docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
>   < ~/storige/apps/api/migrations/20260615_add_storage_settings_and_site_retention.sql
> # 멀티테넌시 P1+P2a (2026-06-17 프로덕션 적용완료) — 반드시 날짜순(P1 먼저 → P2a)
> docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
>   < ~/storige/apps/api/migrations/20260617_add_user_site_roles.sql
> docker exec -i storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
>   < ~/storige/apps/api/migrations/20260617_b_add_site_id_data_scoping.sql
> # 그 후 API 재배포 + nginx 재시작
> docker compose up -d --build api && docker compose restart nginx
> ```
>
> #### 멀티테넌시 P1+P2a 마이그레이션 (2026-06-17 — **프로덕션 적용완료**)
> 두 마이그레이션은 전부 **additive·비파괴**(기존 데이터 NULL=시스템공유/레거시 → 동작 불변, bookmoa 무중단). 적용 순서는 **마이그 2건(P1 먼저) → API 재빌드/재배포 → nginx 재시작**.
> | 파일 | 내용 |
> |------|------|
> | `20260617_add_user_site_roles.sql` (P1) | 신규 조인 테이블 `user_site_roles`(운영자↔사이트 역할). FK → `users`/`sites`. |
> | `20260617_b_add_site_id_data_scoping.sql` (P2a) | 12개 테이블에 `site_id VARCHAR(36) NULL` 컬럼 + 인덱스 ADD(templates·template_sets·product_template_sets·categories·library_categories·library_frames/backgrounds/cliparts/shapes/fonts·products·files). `IF NOT EXISTS`(MariaDB 11.2) 로 **멱등** — 부분실패 후 재실행 안전. |
>
> 통합 런북(백업→pull→마이그 2건→API 재배포→nginx 재시작→전수검증, P2a 롤백 포함): [`../.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md`](../.cursor/plans/MULTITENANCY_P1_DEPLOY_RUNBOOK_2026-06-17.md).

## 📋 목차

1. [시스템 요구사항](#시스템-요구사항)
2. [사전 준비](#사전-준비)
3. [로컬 개발 환경](#로컬-개발-환경)
4. [프로덕션 배포](#프로덕션-배포)
5. [환경 변수 설정](#환경-변수-설정)
6. [배경제거(CUTOUT) 사이드카 — rembg](#배경제거cutout-사이드카--rembg)
7. [모니터링 및 로깅](#모니터링-및-로깅)
8. [문제 해결](#문제-해결)

---

## 시스템 요구사항

### 최소 사양

| 구성 요소 | 최소 사양 | 권장 사양 |
|----------|----------|----------|
| **CPU** | 4 Core | 8 Core |
| **RAM** | 8 GB (모니터링 스택 +400MB 포함) | 16 GB |
| **Storage** | 50 GB SSD | 200 GB SSD |
| **OS** | Ubuntu 22.04+ | Ubuntu 22.04+ |

### 필수 소프트웨어

- **Docker**: 24.0+
- **Docker Compose**: 2.20+
- **Node.js**: **22.x LTS** (Jod, EOL 2027-04-30)
- **pnpm**: 9.x

### Docker 컨테이너 구성 (기본 11개 + 선택 1개)

| 카테고리 | 컨테이너 | 이미지 |
|----------|----------|--------|
| **App** | `storige-api` | NestJS (자체 빌드, node:24-alpine) |
| App | `storige-worker` | NestJS Bull worker (자체 빌드) |
| App | `storige-nginx` | nginx:1.25-alpine (리버스 프록시) |
| **Data** | `storige-mariadb` | mariadb:11.2 |
| Data | `storige-redis` | redis:7.2-alpine |
| **Monitoring** (P2-8) | `storige-prometheus` | prom/prometheus:v2.55.1 |
| Monitoring | `storige-grafana` | grafana/grafana:11.2.2 |
| Monitoring | `storige-node-exporter` | prom/node-exporter:v1.8.2 |
| Monitoring | `storige-redis-exporter` | oliver006/redis_exporter:v1.66.0-alpine |
| **Logging** (P2-10) | `storige-loki` | grafana/loki:3.2.1 |
| Logging | `storige-promtail` | grafana/promtail:3.2.1 |
| **선택** (S-P2A) | `storige-rembg` | python:3.12-slim + rembg 2.0.77 (자체 빌드) — compose profile `cutout` 로만 기동. [배경제거 사이드카](#배경제거cutout-사이드카--rembg) 참조 |

---

## 사전 준비

### 1. Docker 설치

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Docker Compose 설치
sudo apt-get install docker-compose-plugin

# 사용자 권한 설정
sudo usermod -aG docker $USER
```

### 2. 프로젝트 클론

```bash
git clone <repository-url> storige
cd storige
```

### 3. 환경 변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 편집
nano .env
```

**필수 설정 항목**:
```env
# Database
MYSQL_ROOT_PASSWORD=<strong-password>
DATABASE_NAME=storige
DATABASE_USER=storige
DATABASE_PASSWORD=<strong-password>

# JWT
JWT_SECRET=<random-32-char-string>
```

**선택 운영 플래그**:
```env
# 검증 동시성 (worker, 기본 3)
VALIDATION_CONCURRENCY=3

# 스프레드 책 스냅샷/크기 무결성 검증 모드 (api + worker 공용 토글). 미설정=SOFT(경고/기록만, 무중단).
#  - api: 편집완료 시 metadata.spread/spine 누락·불일치 검증(완료 게이트).
#  - worker: compose-mixed 합성 시 cover.pdf MediaBox vs 펼침면 총폭(metadata.spread) 대조.
# 정확히 'true'(대소문자 구분)일 때만 HARD(잘못된 펼침면 크기 인쇄사고 방지). 그 밖의 값·미설정은 SOFT.
# docker-compose.yml 이 api·worker 양쪽 environment 에 ${SPREAD_SNAPSHOT_HARD_FAIL:-false} 로 넘긴다(2026-10-05).
# HARD 는 편집 완료 거부·합성 FAILED 로 파트너에게 보이는 전환이다 — 오너 결정 뒤 별도 절차로 하고,
#   파트너 통지 필요 여부를 먼저 판단한다(아래 「파일 정리 · 스프레드 검증 키 compose 매핑」).
# 전환 시 api·worker 를 모두 재생성하고(api 는 nginx 재시작) [FLAGS] api·worker 두 줄이 같은 값인지 확인한다.
#   한쪽만 재생성하면 한쪽만 HARD 가 된다. SOFT 기간 worker_jobs.result.coverSizeValidation 모니터링 후 승격 권장.
SPREAD_SNAPSHOT_HARD_FAIL=false
```

---

## 로컬 개발 환경

### 빠른 시작

```bash
# 스타트업 스크립트 실행
./scripts/dev-start.sh
```

### 수동 설정

#### 1. 의존성 설치

```bash
# pnpm 설치 (없는 경우)
npm install -g pnpm

# 프로젝트 의존성 설치
pnpm install
```

#### 2. 인프라 서비스 시작

```bash
# MySQL + Redis만 시작
docker-compose up -d mysql redis

# 서비스 상태 확인
docker-compose ps
```

#### 3. 개발 서버 시작

```bash
# 터미널 1: API 서버
cd apps/api
pnpm dev

# 터미널 2: Worker 서비스
cd apps/worker
pnpm dev

# 터미널 3: Editor (선택)
cd apps/editor
pnpm dev

# 터미널 4: Admin (선택)
cd apps/admin
pnpm dev
```

**또는 모든 서비스를 한 번에**:
```bash
pnpm dev
```

#### 4. 서비스 접속

- **API**: http://localhost:4000
- **Worker**: http://localhost:4001
- **Editor**: http://localhost:3000
- **Admin**: http://localhost:3001

---

## 프로덕션 배포

### 1. 빌드

```bash
# 모든 앱 빌드
pnpm build

# 개별 빌드
pnpm --filter @storige/api build
pnpm --filter @storige/worker build
pnpm --filter @storige/editor build
pnpm --filter @storige/admin build
```

### 2. Docker 이미지 빌드

```bash
# 모든 서비스 빌드
docker-compose build

# 개별 서비스 빌드
docker-compose build api
docker-compose build worker
docker-compose build editor
docker-compose build admin
```

### 3. 서비스 시작

```bash
# 전체 스택 시작 (백그라운드)
docker-compose up -d

# 로그 확인
docker-compose logs -f

# 특정 서비스 로그만 확인
docker-compose logs -f api
docker-compose logs -f worker
```

### 4. 서비스 상태 확인

```bash
# 컨테이너 상태
docker-compose ps

# 헬스체크
curl http://localhost:4000/api/health
curl http://localhost:4001/health
```

#### 배포 후 점검 — 기능 플래그 기동 스냅샷 (2026-09-30)

api·worker 는 기동 직후 기능 플래그 유효값을 `[FLAGS]` 한 줄 로그로 남깁니다(값은 `true`/`false` 만, env 원문은 출력하지 않음). 재기동 직후 아래로 확인합니다.

```bash
docker logs storige-api 2>&1 | grep "\[FLAGS\]"
docker logs storige-worker 2>&1 | grep "\[FLAGS\]"
```

- 확인 대상은 각 플래그의 유효값(`true`/`false`)뿐입니다.
- api 스냅샷 줄의 `FILE_RETENTION_*`·`FILE_ORPHAN_*` 값은 **env 계층 값**입니다. 관리자 저장소 설정(보존정책)이 함께 적용되므로 이 값만으로 실제 동작 모드를 판단하지 마십시오.
- 보존정책의 실제 모드(삭제 여부·dry-run)는 `[FLAGS] api retention-effective` 줄 또는 관리자 저장소 설정 화면으로 확인합니다. 이 줄은 기동 시점 값이며, 관리자 화면에서 저장하면 런타임에 바뀝니다.
- api 줄 끝에 `JOB_LINK_STRICT=false JOB_FILE_SITE_STRICT=false SESSION_JOB_OUTPUT_LOOKUP=false` 가 보이면 기본 상태입니다(2026-10-03 추가, 아래 환경 변수 설정의 「잡 생성 확인 · 잡 산출물 세션 조회 플래그」).
- `FILE_ORPHAN_*`·`FILE_RETENTION_*`·`THUMBNAIL_CLEANUP_DRY_RUN`·`SPREAD_SNAPSHOT_HARD_FAIL` 은 `docker-compose.yml` 매핑으로 컨테이너에 전달되며, 기본값은 코드 기본값과 같습니다(2026-10-05, 아래 「파일 정리 · 스프레드 검증 키 compose 매핑」). `SPREAD_SNAPSHOT_HARD_FAIL` 은 api·worker 두 줄에 모두 있으며 두 값이 같아야 합니다.

### 5. 서비스 중지

```bash
# 모든 서비스 중지
docker-compose down

# 볼륨까지 삭제 (데이터 삭제)
docker-compose down -v
```

---

## 환경 변수 설정

### API Server (.env 또는 docker-compose.yml)

```env
# 컨테이너에는 docker-compose.yml 의 api environment 에 매핑된 키만 전달된다.
# compose 에 매핑되지 않은 키는 .env 에 넣어도 컨테이너에 전달되지 않는다(매핑 여부는 docker-compose.yml 로 확인).
NODE_ENV=production
PORT=4000
CORS_ORIGIN=https://yourdomain.com

# Database
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_USER=storige
DATABASE_PASSWORD=<secure-password>
DATABASE_NAME=storige

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# JWT
JWT_SECRET=<random-secure-string>
JWT_EXPIRES_IN=7d

# Storage
STORAGE_PATH=/app/storage
STORAGE_MAX_FILE_SIZE=52428800

# 저장계층 백엔드 (2026-06-15). 기본 local. R2 사용 시 admin [저장소 설정] 권장(DB>env 우선).
#   STORAGE_DRIVER=s3
#   S3_ENDPOINT=https://<acct>.r2.cloudflarestorage.com  S3_REGION=auto  S3_BUCKET=storige-files
#   S3_ACCESS_KEY_ID=...  S3_SECRET_ACCESS_KEY=...  S3_FORCE_PATH_STYLE=true
```

### Worker Service

```env
NODE_ENV=production
PORT=4001

# Database (같은 MySQL 사용)
DATABASE_HOST=mysql
DATABASE_PORT=3306
DATABASE_USER=storige
DATABASE_PASSWORD=<secure-password>
DATABASE_NAME=storige

# Redis
REDIS_HOST=redis
REDIS_PORT=6379

# API
API_BASE_URL=http://api:4000/api

# Storage
STORAGE_PATH=/app/storage
MAX_FILE_SIZE=52428800

# Processing
MAX_RETRY_ATTEMPTS=3
GHOSTSCRIPT_PATH=/usr/bin/gs
```

### 잡 생성 확인 · 잡 산출물 세션 조회 플래그 (api, 2026-10-03)

| 변수 | 대상 컨테이너 | 기본값 | 설명 |
|---|---|---|---|
| `JOB_LINK_STRICT` | api | `false` | 잡 생성 확인 플래그. 전환은 오너 결정 뒤 별도 절차로 한다 |
| `JOB_FILE_SITE_STRICT` | api | `false` | 잡 생성 확인 플래그. 전환은 오너 결정 뒤 별도 절차로 한다 |
| `SESSION_JOB_OUTPUT_LOOKUP` | api | `false` | 잡 산출물 세션 조회 플래그. 전환은 오너 결정 뒤 별도 절차로 한다 |

- api 전용이다. worker 에는 넣지 않는다.
- `docker-compose.yml` api `environment` 의 매핑(`JOB_LINK_STRICT=${JOB_LINK_STRICT:-false}`, `JOB_FILE_SITE_STRICT=${JOB_FILE_SITE_STRICT:-false}`, `SESSION_JOB_OUTPUT_LOOKUP=${SESSION_JOB_OUTPUT_LOOKUP:-false}`)이 있어야 적용된다. `.env` 에만 넣고 매핑이 없으면 적용되지 않는다.
- 현재 값은 api 기동 로그 `[FLAGS] api` 줄로 확인한다(위 「배포 후 점검」).

### 파일 정리 · 스프레드 검증 키 compose 매핑 (api·worker, 2026-10-05)

아래 키는 `docker-compose.yml` 이 `${VAR:-<기본값>}` 형태로 컨테이너에 넘긴다. `.env` 에 키가 없거나 값이 비어 있으면 기본값으로 동작하고, 기본값은 코드 기본값과 같다. 그래서 `.env` 에 키를 넣지 않았다면 매핑을 추가한 뒤에도 동작은 그대로다.

| 변수 | 대상 컨테이너 | compose 매핑(기본값) | 값 해석 |
|---|---|---|---|
| `FILE_ORPHAN_ENABLED` | api | `${FILE_ORPHAN_ENABLED:-true}` | 정확히 `false` 일 때만 OFF, 그 밖의 값은 ON. 보존정책이 OFF 이면 고아 정리도 OFF |
| `FILE_ORPHAN_DRY_RUN` | api | `${FILE_ORPHAN_DRY_RUN:-1}` | 정확히 `0` 일 때만 실제 정리, 그 밖의 값(`false` 포함)은 dry-run. 관리자 보존정책의 dry-run 과 OR 로 합쳐진다 |
| `FILE_ORPHAN_GRACE_PENDING_HOURS` | api | `${FILE_ORPHAN_GRACE_PENDING_HOURS:-24}` | pending/failed 고아 후보 유예(시간). 1 이상의 숫자. 1 미만이거나 숫자가 아니면 24 |
| `FILE_ORPHAN_GRACE_READY_DAYS` | api | `${FILE_ORPHAN_GRACE_READY_DAYS:-30}` | ready 고아 후보 유예(일). 1 이상의 숫자. 1 미만이거나 숫자가 아니면 30 |
| `FILE_RETENTION_ENABLED` | api | `${FILE_RETENTION_ENABLED:-true}` | 정확히 `false` 일 때만 OFF. 관리자 저장소 설정 행에 값이 있으면 그 값이 우선 |
| `FILE_RETENTION_DRY_RUN` | api | `${FILE_RETENTION_DRY_RUN:-0}` | 정확히 `1` 일 때만 dry-run(`true` 등 다른 값은 실제 정리). 관리자 저장소 설정 행에 값이 있으면 그 값이 우선 |
| `FILE_RETENTION_BATCH` | api | `${FILE_RETENTION_BATCH:-200}` | 1회 처리 건수(보존정책·고아 정리 공유). 양의 정수로 넣는다. `0`·숫자가 아닌 값만 200 으로 바뀌고, 그 밖의 값(음수·소수 포함)은 그대로 쓰인다 |
| `FILE_PURGE_GRACE_HOURS` | api | `${FILE_PURGE_GRACE_HOURS:-48}` | soft-delete 뒤 영구 삭제까지 시간. 0 보다 큰 숫자(1 이상 권장). 0 이하이거나 숫자가 아니면 48, 1 미만 값도 그대로 적용된다 |
| `THUMBNAIL_CLEANUP_DRY_RUN` | api | `${THUMBNAIL_CLEANUP_DRY_RUN:-0}` | 정확히 `1` 일 때만 dry-run, 그 밖의 값은 실제 정리 |
| `SPREAD_SNAPSHOT_HARD_FAIL` | api·worker | `${SPREAD_SNAPSHOT_HARD_FAIL:-false}` | 정확히 `true`(대소문자 구분)일 때만 HARD, 그 밖의 값은 SOFT(경고만). HARD 이면 api 는 스냅샷 누락·불일치 시 편집 완료를 거부하고, worker 는 compose-mixed 표지 크기 불일치 시 합성 잡을 `FAILED` 로 끝낸다 |
| `EDITOR_SPREAD_VALIDATION_MAPPING` | api | `${EDITOR_SPREAD_VALIDATION_MAPPING:-on}` | 정확히 `off` 일 때만 해제(검증 잡은 주문 옵션 `orderOptions` 만 사용). 코드는 `off` 가 아닌 값을 모두 연결로 본다 — `on` 은 printenv 로 읽기 쉽게 하려는 표기다 |

- 확인 위치: `FILE_ORPHAN_ENABLED`·`FILE_ORPHAN_DRY_RUN`·`FILE_RETENTION_ENABLED`·`FILE_RETENTION_DRY_RUN`·`THUMBNAIL_CLEANUP_DRY_RUN`·`SPREAD_SNAPSHOT_HARD_FAIL` 은 `[FLAGS]` 줄(위 「배포 후 점검」)로, 유예·건수·영구 삭제 시간과 `EDITOR_SPREAD_VALIDATION_MAPPING` 은 `[FLAGS]` 줄에 없으므로 `docker exec storige-api printenv <키>` 로 확인한다.
- `LOG_LEVEL` 은 compose 에 매핑하지 않는다(아래 「모니터링 스택 환경변수」).
- docker compose 는 셸에 export 된 변수를 `.env` 보다 먼저 쓴다. 값을 바꾸기 전에 배포 셸에 같은 이름이 export 돼 있지 않은지 이름만 확인한다(아래 명령의 출력이 없어야 한다).

```bash
env | cut -d= -f1 | grep -E '^(FILE_ORPHAN_|FILE_RETENTION_|FILE_PURGE_GRACE_HOURS$|THUMBNAIL_CLEANUP_DRY_RUN$|SPREAD_SNAPSHOT_HARD_FAIL$|EDITOR_SPREAD_VALIDATION_MAPPING$)'
```

**값 전환 절차**

- `SPREAD_SNAPSHOT_HARD_FAIL=true`·`FILE_ORPHAN_DRY_RUN=0` 처럼 파트너에게 보이는 결과를 바꾸거나 파일을 실제로 지우는 전환(유예·영구 삭제 시간을 줄이는 것 포함)은 오너 결정 뒤 별도 절차로 한다. 파트너 통지가 필요한지 먼저 판단한다.
- 절차: `.env` 값 변경 → 렌더링 값 확인(아래, `jq` 가 없으면 이 단계는 건너뛰고 재생성 뒤 printenv 로 같은 키를 확인) → 해당 서비스 재생성(빌드 없음) → api 면 nginx 재시작 → `[FLAGS]` 줄 또는 printenv 확인.
- `SPREAD_SNAPSHOT_HARD_FAIL` 은 worker·api 를 모두 재생성하고 `[FLAGS]` api·worker 두 줄이 같은 값인지 확인한다. 한쪽만 재생성하면 한쪽만 HARD 가 된다.

```bash
cd ~/storige
# 렌더링 값 확인 — 위 키만 추출한다(docker compose config 전체를 화면에 출력하지 않는다)
docker compose config --format json 2>/dev/null | jq -c '{api: (.services.api.environment | with_entries(select(.key | test("^(FILE_ORPHAN_|FILE_RETENTION_|FILE_PURGE_GRACE_HOURS$|THUMBNAIL_CLEANUP_DRY_RUN$|SPREAD_SNAPSHOT_HARD_FAIL$|EDITOR_SPREAD_VALIDATION_MAPPING$)")))), worker: (.services.worker.environment | with_entries(select(.key == "SPREAD_SNAPSHOT_HARD_FAIL")))}'

# 예: SPREAD_SNAPSHOT_HARD_FAIL 전환(오너 결정 뒤) — worker·api 모두 재생성
docker compose up -d --no-build worker
docker compose up -d --no-build api && docker compose restart nginx
docker logs storige-worker 2>&1 | grep "\[FLAGS\]" | tail -1
docker logs storige-api 2>&1 | grep "\[FLAGS\]" | tail -2
```

**`EDITOR_SPREAD_VALIDATION_MAPPING` 비상 차단**

편집기 스프레드 책 세션의 검증 잡에 주문 제본·내지 쪽수·표지 책등 기하를 연결하는 동작을 끈다. 끄면 검증 잡은 주문 옵션(`orderOptions`)만 쓴다. 이 키는 `[FLAGS]` 줄에 나오지 않으므로 printenv 로 확인한다.

```bash
cd ~/storige
# 1) .env 에 EDITOR_SPREAD_VALIDATION_MAPPING=off 를 넣는다(되돌릴 때는 줄을 지우거나 on)
# 2) api 재생성 + nginx 재시작
docker compose up -d --no-build api && docker compose restart nginx
# 3) 값 확인 — off 가 나와야 한다
docker exec storige-api printenv EDITOR_SPREAD_VALIDATION_MAPPING
```

---

## 배경제거(CUTOUT) 사이드카 — rembg

> 신규 (2026-08, S-P2A). 에디터 이미지 배경제거(CUTOUT) 잡의 **추론 전용** 컨테이너.
> **기본은 꺼져 있다** — `CUTOUT_ENABLED=false`(미설정=꺼짐) + compose profile `cutout` 미기동.
> 아무 것도 하지 않으면 기존 스택 동작은 완전히 동일하다.

### 왜 별도 컨테이너인가

워커 이미지 베이스가 `node:24-alpine`(musl)이라 `onnxruntime-node` 계열은 **설치는 성공하고 런타임 `import` 에서 터진다**(실측 확인). 그래서 워커에는 ML 네이티브 의존을 일절 넣지 않고, 추론은 glibc 기반 python 사이드카(`storige-rembg`)가 HTTP 로 전담한다. 워커 → 사이드카 호출은 compose 내부 네트워크의 `http://rembg:7000` 이다.

> 🔒 **`ports:` 매핑이 없는 것은 의도**다. Docker 포트 매핑은 ufw 를 우회하고(2026-07-13 Redis, 2026-07-30 :4000/:4001/:3000 실적발), rembg 서버는 **무인증**이며 경로 순회 CVE 이력이 있다. 정당 소비자는 워커뿐이므로 절대 공인 바인딩하지 말 것. 디버깅은 `docker exec` 또는 SSH 터널.

### ① 이미지 빌드 · 기동

```bash
ssh deploy@<host>
cd ~/storige && git pull origin master

# ★ 선행: 디스크 헤드룸 확인 — 이 이미지는 GB 급이고 모델 가중치가 추가로 쌓인다.
#   실측(2026-08) 프로덕션은 / 사용률 85%, docker build cache 만 90GB 회수 가능이었다.
df -h /
docker system df
docker builder prune -f          # 여유가 20GB 미만이면 반드시 선행

# profile 을 지정해야 빌드/기동된다 (기본 up -d 에는 포함되지 않음)
docker compose --profile cutout up -d --build rembg

# 상태 확인 (healthy 까지 최대 ~1분: start_period 60s)
docker compose --profile cutout ps rembg
docker logs --tail 50 storige-rembg
```

> ⚠️ **"전체 재배포"(`docker compose up -d --build`)는 rembg 를 재빌드·재기동하지 않는다.** profile 뒤에 있기 때문. 배경제거 관련 변경 후에는 위 `--profile cutout` 명령을 **따로** 실행할 것.

### ② 최초 요청 시 모델 가중치 다운로드가 일어난다

rembg 는 가중치를 이미지에 담지 않고 **첫 추론 시점에 내려받는다**(`U2NET_HOME=/home/rembg/.u2net`). 기본 모델 `u2net_human_seg` 는 **176MB** 라 부담이 작지만(BiRefNet 계열을 쓸 경우 973MB), 예열하지 않으면 첫 CUTOUT 잡이 다운로드 시간까지 떠안아 `REMBG_TIMEOUT_MS`(기본 180000) 안에 못 끝날 수 있다.

캐시는 named volume `rembg_models` 에 남으므로 **컨테이너 재생성해도 다시 받지 않는다**. 켜기 전에 한 번 예열해 둘 것:

```bash
# 모델 사전 다운로드(예열) — 진행 로그가 뜬다
docker exec storige-rembg python3 -c "from rembg import new_session; new_session('u2net_human_seg')"

# 사이드카 도달 확인 (워커 컨테이너에서 내부 네트워크로)
docker exec storige-worker wget -qO- http://rembg:7000/api > /dev/null && echo "rembg reachable"

# 캐시 확인
docker exec storige-rembg ls -lh /home/rembg/.u2net
```

### ②-b 사이드카 계약 스모크 (플래그 켜기 전에 1회)

healthcheck 는 FastAPI 문서 라우트(`/api`)만 친다 — **실제 배경제거 라우트가 도는지는 검증하지 않는다.**
모델 키 오타·extras 누락(`[cli]` 만 설치하면 서버는 뜨고 추론에서만 죽는다)은 이 단계에서만 잡힌다.

⚠️ **워커 컨테이너에 `curl` 은 없다**(alpine 베이스 — `wget` 만 있고 multipart 를 못 만든다, 2026-08-06 실측).
그래서 스모크는 **워커의 실제 클라이언트 코드(`RembgService`)를 그대로 호출**한다. multipart 조립·모델
바디 필드·PNG 매직 검증까지 프로덕션과 동일 경로를 타므로 curl 보다 강한 검증이다.

```bash
docker exec storige-worker sh -lc 'cd /app && node -e "
const fs=require(\"fs\");
const {RembgService}=require(\"/app/apps/worker/dist/services/rembg.service.js\");
const dir=\"/app/storage/library\";
const f=fs.readdirSync(dir).filter(n=>n.endsWith(\".png\")).map(n=>({n,s:fs.statSync(dir+\"/\"+n).size})).sort((a,b)=>a.s-b.s)[3];
const buf=fs.readFileSync(dir+\"/\"+f.n); const t0=Date.now();
new RembgService().removeBackground(buf,\"u2net_human_seg\").then(r=>{
  const ct=r.png[25];  // PNG IHDR color type: 6=RGBA
  console.log(\"model=\"+r.model+\" out=\"+r.png.length+\"B ms=\"+(Date.now()-t0)+\" colorType=\"+ct);
}).catch(e=>{console.error(\"FAIL\",e.code||e.name,e.message);process.exit(1)});
"'
# 기대: model=u2net_human_seg · colorType=6(알파 있음) · 1초 내외(u2net 기준 실측 0.98s)
# ⚠️ model 은 **쿼리가 아니라 폼 필드**다. POST /api/remove 의 쿼리는 bgc·extras 뿐이라
#    ?model= 로 보내면 에러 없이 무시되고 기본 모델로 추론된다(2026-08-05 실적발, 수정 3f6fd20).

# ★ 실제로 그 모델이 쓰였는지 캐시로 확인 — model 을 잘못 보내면 u2net.onnx 만 받아진다
docker exec storige-rembg ls -la /home/rembg/.u2net/
```

### ③ 켜는 순서 (`CUTOUT_ENABLED`)

**반드시 사이드카가 healthy 해진 뒤에** 플래그를 켠다. 순서를 뒤집으면 잡이 생성되고 사이드카가 없어 `ECONNREFUSED` 로 실패한다.

```bash
# 1) 사이드카 기동·예열 (위 ①②) 후 healthy 확인
docker inspect -f '{{.State.Health.Status}}' storige-rembg   # → healthy

# 2) .env 에 플래그 추가
nano ~/storige/.env
#   CUTOUT_ENABLED=true
#   REMBG_MODEL=u2net_human_seg  ← compose 기본값과 같지만, 모델은 라이선스·메모리 결정사항이라
#                                 운영 파일에 명시해 둔다(누가 기본값을 바꿔도 프로덕션은 고정).
#   (선택) REMBG_TIMEOUT_MS=180000  REMBG_MEM_LIMIT=3g

# 3) api + worker 재기동 → ⚠️ api 가 recreate 되면 nginx 재시작 필수(리터럴 proxy_pass 고정 IP 트랩)
#    ★ worker 를 빠뜨리면 잡은 생성되는데 전건 FAILED 가 된다(플래그는 양쪽 모두 필요).
docker compose up -d api worker && docker compose restart nginx

# 4) 주입 확인 (.env 에만 넣고 compose environment 매핑이 없으면 silent no-op — 이 레포 실적발 3회)
docker exec storige-api printenv CUTOUT_ENABLED         # → true
docker exec storige-worker printenv CUTOUT_ENABLED      # → true  (★ 이게 비면 전건 실패)
docker exec storige-worker printenv REMBG_URL REMBG_MODEL

# 5) 라이브 게이트 프로브 — 잡을 만들지 않고 밖에서 확인한다(존재하지 않는 UUID 사용).
#    플래그가 꺼져 있으면 컷아웃 라우트는 {"code":"NOT_FOUND","message":"Cannot resolve route"} 를 준다.
U=$(uuidgen | tr 'A-Z' 'a-z'); API=https://api.papascompany.co.kr/api
curl -s -X POST "$API/worker-jobs/cutout" -H 'Content-Type: application/json' -d "{\"fileId\":\"$U\"}"
#   → ON 이면 {"code":"FILE_NOT_FOUND",...}  /  OFF 면 {"code":"NOT_FOUND","message":"Cannot resolve route"}
curl -s -X POST "$API/worker-jobs/cutout" -H 'Content-Type: application/json' \
  -d "{\"fileId\":\"$U\",\"model\":\"u2net_custom\"}"   # → 400 CUTOUT_MODEL_FORBIDDEN (CVE 가드)
curl -s -X POST "$API/worker-jobs/cutout" -H 'Content-Type: application/json' \
  -d "{\"fileId\":\"$U\",\"model\":\"bria-rmbg\"}"      # → 400 CUTOUT_MODEL_NOT_ALLOWED (비상업 차단)
```

> ⚠️ **잡 종단(큐→워커→산출물)은 이 절차만으로는 확인되지 않는다.** 컷아웃 잡은 `files` 레코드의
> `fileId` 를 요구하는데, 프로덕션은 `STORAGE_DRIVER=local` 이라 presigned 업로드가 503 이고
> `/files/upload`·`/files/upload/external` 은 둘 다 **PDF 전용 필터**라, 게스트 이미지를 `files` 에
> 등록하는 경로가 아직 없다(2026-08-06 실측). 편집기 연결(샤드 3)에서 이 경로를 함께 배선한 뒤
> 실사용 흐름으로 종단 검증한다.

### ④ 롤백 (즉시 원상복구)

```bash
# 1) 플래그 off → 신규 CUTOUT 잡 생성 중단
nano ~/storige/.env      # CUTOUT_ENABLED=false
docker compose up -d api && docker compose restart nginx

# 2) 사이드카 중지 (이미지·모델 캐시는 보존 → 재기동이 빠르다)
docker compose --profile cutout stop rembg

# 3) 완전 제거가 필요하면 (모델 캐시 볼륨까지)
docker compose --profile cutout rm -sf rembg
docker volume rm storige_rembg_models     # ⚠️ 다음 기동 시 재다운로드(u2net 계열 176MB / birefnet 973MB)
```

플래그가 `false` 인 동안 나머지 파이프라인(검증·변환·합성)은 영향받지 않는다.

### ⑤ 산출물 보존기간 — 자동 정리된다

컷아웃 결과 PNG 는 `/app/storage/cutouts/<jobId>/` 에 쌓인다. 생성 라우트가 무인증(`@Public`)이라
정리 주체가 없으면 디스크 소진 경로가 되므로, API 에 정리 cron 이 함께 들어가 있다
(`CutoutOutputsRetentionService`, 매시 53분, **기본 7일** 경과분 삭제).

```bash
# 보존기간 조정(선택) — .env
#   CUTOUT_RETENTION_DAYS=7
# 현재 누적량 확인
du -sh ~/storige/storage/cutouts 2>/dev/null
```

⚠️ 이 정리는 `worker_jobs.options.cutoutOutputsPurgedAt` 마커로 재처리를 막는다. 산출물을 손으로
지웠다면 마커가 없어 다음 사이클에 한 번 더 `rm -rf`(force)가 돌 뿐 무해하다.

### ⑥ ⚠️ 모델 라이선스 주의 — 가중치마다 조건이 다르다

**rembg 본체는 MIT 지만, 다운로드되는 가중치는 각 원저작 프로젝트의 라이선스를 따른다.** 상업 서비스(인쇄 판매)에 쓰는 이상 모델을 바꿀 때마다 라이선스를 확인해야 한다.

| `REMBG_MODEL` 값 | 원저작 | 라이선스 | 판단 |
|---|---|---|---|
| **`u2net_human_seg`** (기본값) | [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net) 계열 · Supervisely Person 학습 | 코드 **Apache-2.0** / 데이터셋 상업 조항 **미확인** | ✅ **D-12b 재결정(2026-08-06 오너 QA 후)**. 인물 실측 반투명 2.7% · 2.9s. ⚠️ **인물 전용** — 상품·캐릭터·반려동물은 열위일 수 있다 |
| `isnet-general-use` | [xuebinqin/DIS](https://github.com/xuebinqin/DIS) | 코드 Apache-2.0 / DIS5K **회색지대** | ✅ 화이트리스트 개방(범용 대안). 실측 반투명 18.0% · 4.5s — 피사체가 사람이 아닐 때 잡 파라미터로 명시 |
| `u2net` | [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net) | **Apache-2.0** | ⚠️ 최경량 폴백. **인물에서 몸통을 배경으로 판정**한다(실측 반투명 24.2% — 정장·셔츠가 지워짐) |
| `birefnet-general` | [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | **MIT** (공개 데이터셋 DIS5K 학습분) | ⚠️ 라이선스는 가능하나 **현 하드웨어에서 cgroup OOM**(실측 RSS 3.13GB > 3g). 증설·한도 재배분 전에는 쓰지 말 것 |
| `birefnet-general-lite` | 동일 | **MIT** | ⚠️ 동일하게 OOM. 파일은 224MB지만 **활성화 메모리는 파일 크기와 무관**하다(실측) |
| `bria-rmbg` | BRIA AI RMBG-1.4 | **비상업 전용** | ❌ **사용 금지** |
| `u2net_custom` / `dis_custom` / `ben_custom` | (외부 가중치 경로 지정) | — | ❌ **지정 금지** — `model_path` 가 CVE-2026-40086 경로 순회 벡터 |

**기본값 변천(D-12b)**: 오너가 처음 고른 **BEN2 는 rembg 2.0.77 내장 세션 목록에 없고**(경로를 직접 넘기는 `ben_custom` 만 존재 = 위 금지 항목), 그 대체로 잡았던 BiRefNet 계열은 **이 박스에서 전부 OOM** 했다. 그래서 `u2net` 으로 확정했으나, **오너 실기 QA 에서 인물 사진의 몸통이 반투명하게 지워지는 문제**가 드러났다(같은 사진 실측 반투명 24.2%). 세 모델을 같은 원본으로 비교해 `u2net_human_seg`(2.7%)로 재확정하고, 범용 대안 `isnet-general-use`(18.0%)를 화이트리스트에 함께 열었다. **모델 교체는 `REMBG_MODEL` 값 하나만 바꾸면 된다**(코드 변경 없음).

| 실측(2026-08-06, 동일 인물 사진 1180×1178) | 반투명 픽셀 | 소요 | 결과 |
|---|---|---|---|
| `u2net` | 24.2% | 1.3s | 얼굴만 남고 정장·셔츠가 반투명하게 소실 |
| **`u2net_human_seg`** | **2.7%** | 2.9s | 인물 전체 온전 |
| `isnet-general-use` | 18.0% | 4.5s | 인물 전체 온전(머리카락 끝이 더 부드럽게 잔존) |

```bash
# 모델 교체 예 — ⚠️ BiRefNet 은 메모리 재배분/증설 없이 바꾸면 첫 잡에서 OOM 한다.
nano ~/storige/.env       # REMBG_MODEL=birefnet-general-lite / REMBG_MEM_LIMIT=4g / WORKER_MEM_LIMIT=3g
docker compose up -d worker
docker compose --profile cutout up -d rembg
docker exec storige-rembg python3 -c "from rembg import new_session; new_session('birefnet-general-lite')"
# 교체 후 반드시 실추론 1회 + OOM 확인: docker inspect -f '{{.State.OOMKilled}}' storige-rembg
```

### 환경 변수

| 변수 | 대상 컨테이너 | 기본값 | 설명 |
|---|---|---|---|
| `CUTOUT_ENABLED` | **api · worker** | `false` | 기능 플래그. **양쪽 모두** 필요하다 — 워커에 빠지면 API 는 잡을 접수하는데 워커가 전건 FAILED 로 떨어뜨린다. 값은 `true` 또는 `1` |
| `CUTOUT_MAX_INPUT_PIXELS` | worker | `40000000` | 디코드 픽셀 예산(40MP). 바이트 상한을 통과하는 대형 저압축 이미지 차단 |
| `CUTOUT_RETENTION_DAYS` | api | `7` | 산출물 보존기간. 정리 cron 은 API 에 있다 |
| `REMBG_URL` | worker | `http://rembg:7000` | 사이드카 베이스 URL(내부 네트워크) |
| `REMBG_ENDPOINT` | worker | `/api/remove` | rembg 추론 엔드포인트(POST=multipart `file`, `model` 파라미터) |
| `REMBG_MODEL` | worker | `u2net_human_seg` | 모델 교체 지점 (위 라이선스 표 참조) |
| `REMBG_TIMEOUT_MS` | worker | `180000` | 사이드카 왕복 타임아웃. 예열 후 하향 가능 |
| `CUTOUT_MAX_INPUT_BYTES` | worker | `31457280` (30MB) | 사이드카로 올릴 원본 이미지 상한 |
| `REMBG_MEM_LIMIT` | rembg | `3g` | 컨테이너 메모리 상한 |
| `REMBG_THREADS` | rembg | `2` | uvicorn 워커 스레드 |
| `REMBG_OMP_NUM_THREADS` | rembg | `2` | ONNX Runtime 스레드 |
| `REMBG_LOG_LEVEL` | rembg | `info` | rembg 서버 로그 레벨 |

> ⚠️ **메모리 예산**: `mem_limit` 3g 는 원래 BiRefNet(973MB fp32)을 담으려던 값인데 **그래도 모자랐다**(실측 RSS 3.13GB → OOM). 확정 모델 `u2net_human_seg` 는 피크 RSS 1.0GB 대 라 3g 안에서 여유가 있고, 8GB 박스에서 worker(기본 4g)와의 동시 피크가 걱정되면 `REMBG_MEM_LIMIT` 을 **1.5g 로 낮추는 쪽**이 맞다(올려도 BiRefNet 이 되지는 않는다). OOM 시 `docker inspect -f '{{.State.OOMKilled}}' storige-rembg` 로 확인된다.

**출처**: [rembg README](https://github.com/danielgatis/rembg) · [CVE-2026-40086 (GHSA-3wqj-33cg-xc48)](https://github.com/advisories/GHSA-3wqj-33cg-xc48) · [rembg PyPI](https://pypi.org/project/rembg/)

---

## Nginx 설정 (선택)

### Reverse Proxy 설정

프로젝트에 포함된 Nginx 설정을 사용하거나, 외부 Nginx를 사용할 수 있습니다.

#### 포함된 Nginx 사용

```bash
# docker-compose.yml에 이미 포함되어 있음
docker-compose up -d nginx
```

#### 외부 Nginx 설정 예시

```nginx
# /etc/nginx/sites-available/storige
upstream api {
    server localhost:4000;
}

upstream editor {
    server localhost:3000;
}

upstream admin {
    server localhost:3001;
}

server {
    listen 80;
    server_name yourdomain.com;

    # API
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # Editor
    location /editor/ {
        proxy_pass http://editor/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Admin
    location /admin/ {
        proxy_pass http://admin/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Storage (정적 파일)
    location /storage/ {
        alias /path/to/storige/storage/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 모니터링 및 로깅

### 🌐 통합 대시보드 (P2-8 + P2-10)

| 도구 | URL | 인증 | 설명 |
|------|-----|------|------|
| **Grafana** | https://api.papascompany.co.kr/grafana/ | admin / `GRAFANA_ADMIN_PASSWORD` | 메트릭 + 로그 통합 |
| Sentry | https://papascompany.sentry.io | OAuth | 에러 추적 + Performance |
| Admin Dashboard 큐 위젯 | https://admin.papascompany.co.kr | JWT | 5초 폴링 |

### 📊 Grafana 대시보드 (자동 등록됨)

- **Storige 운영 메트릭** (uid `storige-overview`)
  - VPS 시스템: CPU/메모리/디스크/네트워크
  - API Node.js: heap, RSS, event loop lag
  - Worker Bull 큐: backlog, completed, failed delta
  - Redis: 메모리, 명령 처리량
- **Storige 로그** (uid `storige-logs`)
  - API/Worker 라이브 로그 (level multi-select 변수: info/warn/error/fatal/debug)
  - 에러 발생률 / 전체 로그 처리량
  - Nginx 액세스 로그 (collapsed row)

### 📝 로그 검색 (LogQL)

운영자는 **Grafana > Storige 로그 > Explore** 에서 LogQL 쿼리:

```
{service="api"} | json | level="error"
{service="worker"} | json |~ "synthesis"
{service="api"} | json | url=~"/worker-jobs/.*"
```

### 🐳 Docker 로그 직접 확인 (디버깅용)

```bash
# 전체 로그
docker compose logs -f

# 특정 서비스 로그
docker compose logs -f api
docker compose logs -f worker

# 최근 100줄만
docker compose logs --tail=100 api
```

### 💻 리소스 모니터링

```bash
# 컨테이너 리소스 사용량
docker stats

# 특정 컨테이너만
docker stats storige-api storige-worker

# 모니터링 스택 메모리 사용량 (~400MB)
docker stats storige-prometheus storige-grafana storige-loki storige-promtail
```

### 🚨 알림 채널

- **Sentry → Slack**: 새 에러 / 빈도 급증 / Worker 실패 / 큐 적체 (가이드: [`SENTRY_SLACK_SETUP.md`](./SENTRY_SLACK_SETUP.md))
- **Bull 큐 알람**: API의 `QueueMonitorService`가 1분마다 폴링 → Sentry로 전송 (`alert.type=backlog/failed`)

### 🔄 모니터링 스택 환경변수

```bash
# .env (VPS)
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<강한 비번>
QUEUE_MONITOR_ENABLED=true
QUEUE_MONITOR_BACKLOG_THRESHOLD=10
QUEUE_MONITOR_INTERVAL_MS=60000
QUEUE_MONITOR_COOLDOWN_MS=300000
# LOG_LEVEL 은 docker-compose.yml 에 매핑돼 있지 않아 .env 에 넣어도 api·worker 에 전달되지 않는다.
#   컨테이너는 NODE_ENV=production 이라 info 레벨로 기록한다(로컬 개발 기본은 debug).
```

---

## 데이터베이스 관리

### 백업

```bash
# MySQL 백업
docker-compose exec mysql mysqldump -u root -p storige > backup_$(date +%Y%m%d).sql

# 또는 Docker 볼륨 백업
docker run --rm \
  --volumes-from storige-mysql \
  -v $(pwd):/backup \
  ubuntu tar cvf /backup/mysql_backup.tar /var/lib/mysql
```

### 복원

```bash
# SQL 파일에서 복원
docker-compose exec -T mysql mysql -u root -p storige < backup_20231201.sql

# 볼륨 복원
docker run --rm \
  --volumes-from storige-mysql \
  -v $(pwd):/backup \
  ubuntu bash -c "cd /var/lib/mysql && tar xvf /backup/mysql_backup.tar --strip 1"
```

---

## 스케일링

### Worker 서비스 스케일 아웃

```bash
# Worker 인스턴스 3개로 증가
docker-compose up -d --scale worker=3

# 확인
docker-compose ps worker
```

---

## 업데이트 및 배포

### Zero-Downtime 배포

```bash
# 1. 새 코드 pull
git pull origin main

# 2. 빌드
pnpm build
docker-compose build

# 3. 순차적 재시작 (Worker → API → Frontend)
docker-compose up -d worker
sleep 10
docker-compose up -d api
sleep 10
docker-compose up -d editor admin
```

### v2.2 핫픽스 — 워커 경로 정규화 재배포 (2026-05-02)

> 이 핫픽스는 `apps/worker/src/services/` 의 3개 파일과 `apps/admin/src/pages/WorkerTest/WorkerTestPage.tsx` 만 수정합니다.  
> Vercel은 admin/editor만 자동 배포하므로 **VPS의 워커 컨테이너만 수동 재빌드** 가 필요합니다.

```bash
# VPS에서 실행
cd /path/to/storige
git pull origin master   # commit daeb2b7 이상 포함

# 워커만 재빌드 + 재기동 (다른 서비스 무영향)
docker-compose build worker
docker-compose up -d worker

# 로그로 정상 기동 확인
docker-compose logs -f worker
# → "Validating PDF: storage/uploads/..." 로그 보이면 정상
```

#### 배포 검증 체크리스트

| 항목 | 검증 방법 | 기대 결과 |
|------|-----------|-----------|
| 워커 기동 | `docker-compose ps worker` | `Up` 상태 |
| Bull 큐 연결 | 워커 로그 첫 줄 | `Bull queue connected` |
| 검증 동작 | Admin 워커 테스트 페이지에서 PDF 업로드 | `COMPLETED` / `FIXABLE` 결과 |
| 합성 동작 (있다면) | bookmoa 주문 합성 | `synthesis.completed` Webhook |

#### 롤백 (문제 발생 시)

```bash
# 직전 커밋으로 되돌리고 워커 재기동
git revert daeb2b7 --no-edit
git push origin master
docker-compose build worker
docker-compose up -d worker
```

### Vercel 배포 파이프라인(ignoreCommand) 주의 (2026-06-17)

> admin/editor 는 Vercel 자동 배포(master push)지만, `apps/admin/vercel.json`·`apps/editor/vercel.json` 의 `ignoreCommand` 가 변경 감지에 `git diff $VERCEL_GIT_PREVIOUS_SHA HEAD` 를 사용한다.

**트랩**: `PREVIOUS_SHA`(직전 성공 배포 SHA)가 Vercel 의 얕은(shallow) 클론에 없으면 `git diff` 가 `fatal: bad object` 로 비정상 종료(exit 128) → 배포가 **ERROR** 로 떨어지고, 라이브가 옛 빌드에 **고착**된다(자기영속: 다음 커밋들도 계속 ERROR). 실제로 admin 이 한동안 옛 빌드에 묶여 axios 로그인 핫픽스·프로필/비번변경 UI 가 라이브에 안 나타났다.

**해소(커밋 `640e3e6`)**: `PREVIOUS_SHA` 가 비었거나 클론에 없으면 `exit 1`(빌드 강제) 폴백 후 diff 하도록 admin·editor 양쪽 `ignoreCommand` 견고화. → admin 재배포 READY(라이브 복구).

**운영 규칙**: UI 변경(admin/editor)이 master push 후에도 라이브에 보이지 않으면, 코드를 의심하기 전에 **Vercel 배포 state(READY/ERROR)부터 확인**한다.
```bash
vercel inspect <deployment-url>        # 빌드 상세/상태
vercel logs storige-admin              # admin 런타임 로그
# 또는 대시보드 → 프로젝트 → Deployments 에서 최신 상태 확인
```

### 합성 내지 기대 재단 · 반복 중단 실패 기록 배포 (2026-10-03)

> api·worker·editor 를 함께 바꾸는 배포다. DB 마이그레이션은 없다. 새 환경 변수는 api 잡 생성 확인 플래그 2개뿐이고 기본 `false` 다(위 「잡 생성 확인 · 잡 산출물 세션 조회 플래그」). editor 는 master push 로 Vercel 이 배포한다(위 「Vercel 배포 파이프라인」 절로 state 확인). master push(= editor 자동 배포)와 api 배포는 파트너 사전 통지(`docs/partner-notices/PARTNER_NOTICE_WAVE2_2026-10-03.md`) 발송 뒤에 한다. 이번 api 에는 presigned complete 사이트 키 귀속(공지 §5)이 들어 있으므로, api 배포는 100p Books ACK 와 오너 배포 승인을 받은 뒤에 한다.

**순서: 사전 통지 발송 → master push(editor 자동 배포) → worker → api.** worker 는 잡에 `contentTrim`(주문 재단·도련)이 없으면 종전 경로로 처리하므로 먼저 올려도 동작이 같다. api 는 배포 뒤부터 `editSessionId` 가 있는 합성 등에 `contentTrim` 을 싣는다.

```bash
cd ~/storige && git pull origin master

# 1) worker 먼저
docker compose build worker && docker compose up -d worker
docker logs storige-worker 2>&1 | grep "\[FLAGS\]"   # … WORKER_TRIMBOX_SIZE_CHECK=true

# 2) 그다음 api — recreate 뒤 nginx 재시작 필수
docker compose up -d --build api && docker compose restart nginx
docker logs storige-api 2>&1 | grep "\[FLAGS\]"      # … JOB_LINK_STRICT=false JOB_FILE_SITE_STRICT=false SESSION_JOB_OUTPUT_LOOKUP=false
```

**확인 로그 — api 배포 뒤 첫 합성**

```bash
# api: 잡에 contentTrim 을 실었는지
docker logs storige-api 2>&1 | grep "\[content-trim\]"
#   [content-trim] attach route=synthesize source=templateSet trim=210x297 bleed=3
#   [content-trim] skip route=<route> reason=<사유>      ← 키 없이 잡 생성(잡 생성은 계속, 종전 경로)

# worker: 값을 받았는지, 내지를 맞췄는지
docker logs storige-worker 2>&1 | grep -E "\[TRIMBOX_CTX\]|\[TRIMBOX_NORMALIZE\] merge:"
#   [TRIMBOX_CTX] merge:<jobId> source=templateSet trim=210x297 bleed=3 tol=1
#   [TRIMBOX_NORMALIZE] merge:<jobId> pages=<N> cropped=<M> source=orderBleed bleed=3x3 target=216x303mm (…)
```

- `[content-trim]` 의 `route` 는 `synthesize`·`compose-mixed`·`attach-page-pad`·`finalization`, `skip` 사유는 `no-session`·`no-template-set`·`no-book-spec`·`inner-spread`·`invalid`·`lookup-error` 다. 로그에 세션·템플릿셋 id 는 남기지 않는다.
- worker 태그는 `merge:<jobId>`(merge 합성)·`compose:<jobId>`(compose-mixed)·`convert:<jobId>`(첨부 내지 빈 페이지 채움)다. `[TRIMBOX_CTX] <태그> ignored reason=<사유>` 는 값 형식이 맞지 않아 종전 경로로 진행했다는 뜻이다.
- 값을 도출하지 않는 경로(`editSessionId` 없는 합성, compose-mixed 수동 경로)는 `[content-trim]` 줄이 없고, `contentTrim` 이 없는 잡은 `[TRIMBOX_CTX]` 줄이 없다. 정상이다.
- 편집기 산출 내지(재단선 영역 없는 재단 크기, 또는 이미 작업사이즈)는 크롭하지 않으므로 `[TRIMBOX_NORMALIZE]` 적용 줄이 없는 것이 정상이다.
- worker `WORKER_TRIMBOX_SIZE_CHECK=false` 이면 TrimBox 판정·크롭과 함께 잡의 `contentTrim` 도 읽지 않는다(`docs/PDF_VALIDATION_GUIDE.md` §킬스위치).

**확인 로그 — 반복 중단 실패 기록 (worker)**

```bash
docker logs storige-worker 2>&1 | grep "\[JOB_STALLED\]"
#   [JOB_STALLED] queue=<큐> name=<잡 이름> jobId=<id> queueJobId=<id> outcome=<결과> previousStatus=<상태>
```

- 평소에는 줄이 없다. 리스너는 Bull 이 stalled 한도 초과로 실패시킨 잡만 처리하고, 프로세서가 던진 실패는 다루지 않는다(프로세서가 `FAILED` 를 기록하거나, 합성 큐 잡은 재시도할 수 있는 오류이고 남은 시도가 있으면 재시도로 넘긴다 — 아래 「작업 상태 고정 · 합성 재시도 · 세션 연결 기록 배포」).
- 대상 큐: `pdf-validation`·`pdf-conversion`(변환·render-pages)·`pdf-synthesis`·`image-cutout`.
- `outcome` 값

| 값 | 뜻 |
|---|---|
| `patched` | API 잡을 `FAILED`(`errorCode: 'JOB_STALLED'`)로 기록했다 |
| `completedReported` | 합성 완료 마커가 있어 `FAILED` 대신 `COMPLETED` 를 다시 보고했다 |
| `alreadyTerminal` | 이미 종결된 잡이라 바꾸지 않았다 |
| `notFound` | API 에 해당 잡이 없다 |
| `statusUnavailable` · `patchFailed` · `completedReportFailed` | API 상태 조회 또는 기록이 실패했다(연결 실패·오류 응답, 재시도 소진). 아래 「문제 해결 4」의 스위퍼 정리로 이어진다 |
| `invalidJob` | 큐 잡 정보(잡 페이로드·`jobId`)를 읽지 못했다 |
| `error` | 처리 중 예외가 났다 — 같은 줄의 메시지를 확인한다(기록하지 못했으면 스위퍼 정리로 이어진다) |

- 별도 플래그는 없다. 되돌리기는 해당 커밋 revert 뒤 worker 재배포다.

### 작업 상태 고정 · 합성 재시도 · 세션 연결 기록 배포 (2026-10-03, Wave 3)

> api·worker·editor·admin 을 함께 바꾸는 배포다. DB 마이그레이션은 없다(기존 `worker_jobs.edit_session_id` 컬럼을 쓴다). 새 환경 변수는 api `SESSION_JOB_OUTPUT_LOOKUP` 1개이고 기본 `false` 다(위 「잡 생성 확인 · 잡 산출물 세션 조회 플래그」). editor·admin 은 master push 로 Vercel 이 배포한다(위 「Vercel 배포 파이프라인」 절로 state 확인). master push(= editor·admin 자동 배포)와 api 배포는 파트너 사전 통지(`docs/partner-notices/PARTNER_NOTICE_WAVE3_2026-10-03.md`) 발송과 오너 배포 승인 뒤에 한다.

**순서: 사전 통지 발송 → master push(editor·admin 자동 배포) → worker → api(+ nginx 재시작).**

- worker 를 먼저 올린다. 이 순서는 필수다 — api 를 worker 보다 먼저 올리지 않는다(api 가 합성 잡에 싣는 재시도는 새 worker 의 재시도 처리와 함께 동작한다). 새 worker 는 큐 잡의 시도 정보(`attempts`)로 재시도 여부를 정한다. api 를 올리기 전에는 합성 잡에 `attempts` 가 없으므로(최대 1회) 실패를 그 자리에서 `FAILED` 로 기록하고 `[SYNTH_RETRY]` 줄을 남기지 않는다.
- api 는 배포 뒤부터
  - 합성 큐(`pdf-synthesis`) 잡을 `attempts: 3`, `backoff: { type: 'exponential', delay: 30000 }` 으로 넣는다(`SYNTHESIS_QUEUE_RETRY_OPTS`, 대기 30초 → 90초). 합성 잡을 넣는 5곳(`createSynthesisJob`·`createComposeMixedJob`·`createSplitSynthesisJob`·`createDuplexSplitJob`·`createSpreadSynthesisJob`)에만 붙는다.
  - 작업 상태 보고에 상태 가드를 적용한다(종결 뒤 불변, `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 의 `FAILED` 만 `COMPLETED` 로 승격, 같은 종결 웹훅은 발신 장부 기준 1회).
  - 편집 세션 id 를 실은 새 잡에 세션 연결을 저장한다. 이미 만든 잡의 세션 연결은 바꾸지 않는다.
- 큐 전역 기본값(`apps/api/src/app.module.ts` 의 `defaultJobOptions`, attempts·backoff 없음)은 그대로다. 재시도 옵션은 합성 큐 잡에만 잡 단위로 싣고, 다른 큐(검증·변환·컷아웃)는 1회 처리 그대로다. 횟수·대기는 api 코드 상수이며 환경 변수로 바꾸지 않는다(worker 환경 변수 `MAX_RETRY_ATTEMPTS` 는 이 값에 쓰이지 않는다).
- editor 의 IIFE 번들(`/embed/`, `apps/editor/dist-embed`)은 master push 로 바뀌지 않는다. IIFE `getState()` 의 쪽수 값 반영은 VPS 에서 `pnpm --filter @storige/editor build:embed:prod` 로 번들을 다시 만드는 별도 단계이며, 오너 결정 뒤에 한다.
- admin 에는 컴포넌트 테스트(`src/**/*.test.tsx`, 첫 줄 `// @vitest-environment happy-dom`, 공용 도우미 `src/test/renderWithAntd.tsx`)가 더해진다. 테스트 파일도 Vercel 빌드(`tsc && vite build`)의 타입검사 대상이므로, master push 전 `pnpm --filter @storige/types build && pnpm --filter @storige/admin exec tsc --noEmit` 으로 확인한다.

```bash
# 0) 직전 이미지 보존(이미지 롤백용)
docker tag storige-api:latest storige-api:rollback-pre-wave3
docker tag storige-worker:latest storige-worker:rollback-pre-wave3

cd ~/storige && git pull origin master

# 1) worker 먼저 — 합성 재시도 의미론
docker compose build worker && docker compose up -d worker
docker logs storige-worker 2>&1 | grep "\[FLAGS\]"   # worker 플래그는 바뀌지 않는다

# 2) 그다음 api — 합성 큐 attempts·상태 가드·세션 연결 저장. recreate 뒤 nginx 재시작 필수
docker compose up -d --build api && docker compose restart nginx
docker logs storige-api 2>&1 | grep "\[FLAGS\]"      # … JOB_LINK_STRICT=false JOB_FILE_SITE_STRICT=false SESSION_JOB_OUTPUT_LOOKUP=false
```

**확인 로그 — 합성 재시도 (worker)**

```bash
docker logs storige-worker 2>&1 | grep "\[SYNTH_RETRY\]"
#   [SYNTH_RETRY] jobId=<id> queueJobId=<id> mode=<경로> attempt=<n>/<최대> action=<retry|fail|completed> reason=<retryable|non-retryable|exhausted|completed-marker> code=<코드|-> http=<상태|-> discard=<yes|no>
docker exec storige-redis redis-cli ZCARD bull:pdf-synthesis:delayed   # 재시도 대기 중인 합성 잡 수
```

- 평소에는 줄이 없다. 최대 시도가 1회인 잡(api 배포 전에 큐에 들어간 잡)은 줄을 남기지 않는다.
- `mode` 는 `merge`·`compose-mixed`·`split`·`duplex-split`·`spread`·`test-env` 다. 로그에 오류 메시지·URL·경로는 남기지 않는다.
- `action` 값

| 값 | 뜻 |
|---|---|
| `retry` | 재시도할 수 있는 오류이고 남은 시도가 있다. API 잡은 `PROCESSING` 그대로이고 웹훅은 없다. Bull 이 30초(두 번째는 90초) 뒤 다시 처리한다 |
| `fail` | API 잡을 `FAILED` 로 기록했다(웹훅 대상이면 `synthesis.failed` 1회). `reason=non-retryable` 은 입력 오류, `exhausted` 는 마지막 시도의 실패다. `discard=yes` 면 남은 시도를 쓰지 않고 끝냈다 |
| `completed` | 완료 마커가 있어 `FAILED` 대신 저장된 `COMPLETED` 를 다시 보고했다(같은 때 `[idempotent]` 줄도 남는다) |

- 재시도 판정(`apps/worker/src/processors/synthesis-retry.ts`, 2026-10-05 Wave 4 반영)

| 오류 | 재시도 |
|---|---|
| 워커 오류 코드 `FILE_DOWNLOAD_FAILED`·`SPLIT_VERIFICATION_FAILED`·`EMPTY_OUTPUT_FILE`·`SERVICE_UNAVAILABLE`·`INTERNAL_ERROR` | 한다 |
| 합성 입력 오류 코드 `PDF_LOAD_FAILED`(입력 PDF 를 열 수 없음)·`FILE_NOT_FOUND`(입력 파일 없음)·`INPUT_URL_REJECTED`(입력 주소를 쓸 수 없음) | 하지 않는다(즉시 `FAILED`) |
| 그 밖의 워커 오류 코드(쪽수 불일치·쪽 구분 값·세션 없음·펼침면 스냅샷 등 입력 오류) | 하지 않는다(즉시 `FAILED`) |
| HTTP 응답 5xx·408·425·429 | 한다 |
| HTTP 응답 그 밖의 4xx | 하지 않는다(즉시 `FAILED`) |
| 응답 없는 네트워크 오류·호스트 이름 확인 실패, 받는 도중 끊긴 입력, 입력 오류 코드로 바뀌지 않은 파일·qpdf·gs 처리 오류, 그 밖의 오류 | 한다 |

- 워커 오류 코드가 붙은 오류는 코드로 판정하고, 코드가 없는 오류만 HTTP 응답 상태로 판정한다.
- merge(`synthesize`·`external`)·compose-mixed·펼침면 합성은 입력 PDF(표지·내지·면지·펼침면)를 받거나 여는 단계의 입력 오류를 위 합성 입력 오류 코드로 바꿔 기록한다(`apps/worker/src/utils/synthesis-input.ts`). `WORKER_LIGHTWEIGHT_SYNTHESIS` ON·OFF 경로 모두에 적용한다. 입력 오류로 확정되지 않은 실패는 원래 오류 그대로 두어 재시도 대상이 된다. split·duplex-split 은 이 변경이 없다.
- 펼침면 합성의 세션·파일 조회는 404 등 4xx(408·425·429 제외)면 `SESSION_NOT_FOUND`·`FILE_NOT_FOUND`(재시도 없음), 408·425·429·5xx·무응답이면 `SERVICE_UNAVAILABLE`(재시도)로 기록한다(`apps/worker/src/services/pdf-synthesizer.service.ts` `lookupFailureOrNull`).
- 그 밖의 줄: `[SYNTH_RETRY] … discard=unavailable` 은 남은 시도를 버리는 호출을 쓸 수 없는 잡, `[SYNTH_RETRY] … settle-fallback=yes` 는 판정 중 예외가 나서 `FAILED` 로 기록했다는 뜻이다.
- 처리 중 반복 중단(stalled 한도 초과)은 남은 시도와 관계없이 그 시점에 `FAILED`(`errorCode: 'JOB_STALLED'`)다. `[JOB_STALLED]` 줄은 위 절의 표와 같다. 중간 시도의 실패는 이 리스너가 다루지 않는다.
- 합성 큐는 한 번에 1건씩 처리한다(`@Process('synthesize-pdf')`, 동시성 기본 1). 재처리 시간만큼 뒤 합성 잡의 시작이 늦어질 수 있다. 재시도 대기(delayed) 중인 잡은 처리 슬롯을 쓰지 않는다.

**확인 로그 — 합성 입력 오류 (worker, 2026-10-05)**

```bash
docker logs storige-worker 2>&1 | grep -E "\[SYNTH_INPUT\]|합성 입력 오류 원문"
#   [SYNTH_INPUT] input=<cover|content|endpaper|spread> code=<PDF_LOAD_FAILED|FILE_NOT_FOUND|INPUT_URL_REJECTED> cause=<원래 오류 이름|->
#   합성 입력 오류 원문 input=<입력 역할> code=<코드>: <원래 오류 메시지>
```

- 평소에는 줄이 없다. 입력 오류 코드로 바꿀 때마다 두 줄을 남긴다. 그 잡은 재시도하지 않고 `FAILED` 로 끝난다(최대 시도가 2회 이상인 잡은 `[SYNTH_RETRY] … action=fail reason=non-retryable code=<코드>` 줄이 이어진다).
- `[SYNTH_INPUT]` 줄은 `[SYNTH_RETRY]` 줄과 같이 오류 메시지·URL·경로를 남기지 않는다. `cause` 는 원래 오류의 이름이고, 형식이 맞지 않으면 `-` 다.
- 원문 줄은 원래 오류 메시지(공백을 한 칸으로 줄이고 최대 500자)를 서버 로그에 남긴다. 원래 오류는 오류 추적 이벤트에도 남을 수 있다. 입력 경로·주소가 들어 있을 수 있으므로 로그를 밖으로 공유할 때는 이 줄을 빼거나 가린다. 원래 오류 메시지는 API 잡 응답과 웹훅에 실리지 않는다 — `FAILED` 의 `errorMessage` 는 코드에 대응하는 안내 문구, `errorDetail` 은 `{ input: <입력 역할> }` 이다(아래 「합성 입력 오류 · 실패 응답 정리 · 운영 키 매핑 배포」).

**확인 로그 — 작업 상태 · 세션 연결 · 웹훅 발신 장부 (api)**

```bash
docker logs storige-api 2>&1 | grep -E "\[job-status\]|\[job-link\] unlinked|\[job-callback\]"
#   [job-status] blocked job=<id> from=<상태> to=<상태>
#   [job-status] repeat job=<id> status=<상태> callback=<결과>
#   [job-status] promoted job=<id> from=FAILED(<JOB_STALLED|JOB_TIMEOUT_SWEPT>) to=COMPLETED
#   [job-link] unlinked route=<route> reason=session-missing
#   [job-callback] ledger unavailable op=<연산> reason=<사유>
```

| 줄 | 뜻 |
|---|---|
| `[job-status] blocked` | 종결(`COMPLETED`·`FIXABLE`·`FAILED`)된 잡에 다른 상태 보고가 왔다. 쓰지 않고 현재 잡을 200 으로 돌려준다(워커 PATCH 재시도 없음). `from`·`to` 는 알려진 상태값만 남기고, 그 밖은 `other`, 상태 없는 보고는 `-` 다 |
| `[job-status] repeat` | 같은 종결 상태를 다시 받았다. DB 는 쓰지 않고(처음 종결 값 유지) 종결 웹훅만 발신 장부 기준으로 처리했다. `callback` 은 `none`(웹훅 대상 아님)·`sent`·`failed`·`skipped-sent`(앞선 발신 성공 기록 있음)·`skipped-in-flight`(발신 진행 중) |
| `[job-status] promoted` | `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 로 기록된 잡이 뒤늦게 처리를 마쳐 `COMPLETED` 로 바꿨다(오류 필드 비움, 완료 후속 처리·웹훅 진행). 워커 키 또는 api 내부 호출의 보고만 해당한다 |
| `[job-link] unlinked` | 요청한 편집 세션 행이 없어 세션 연결 없이 잡을 저장했다(잡 생성은 계속). `route` 는 `validate`·`convert`·`render-pages`·`synthesize`·`compose-mixed`·`split-synthesize`·`duplex-split`·`spread-synthesize` 다. 세션 id 는 남기지 않는다 |
| `[job-callback] ledger unavailable` | 발신 장부(Redis)를 쓰지 못했다(클라이언트 없음·오류·연산당 제한 시간 400ms 초과). `op` 는 `client`·`claim`·`markSent`·`release`, `reason` 은 `no-client`·`error`·`timeout` 이다. 발신 전 선점(`claim`, 그 단계의 `client`)이면 웹훅은 장부 없이 발신한다. `markSent`·`release` 는 발신을 마친 뒤의 기록이라 발신 결과는 같고, 그 결과가 장부에 남지 않을 수 있다(발신 중 표시는 60초 뒤 만료되고, 그 뒤 같은 종결 보고가 오면 다시 판정한다) |

- 발신 장부 키는 `storige:job-callback:<jobId>:<상태>` 다. 발신 중 표시는 60초, 발신 완료 기록은 7일 뒤 만료된다. 장부 내용은 API 응답에 실리지 않는다.
- `blocked`·`repeat` 는 워커 재배달·스위퍼 정리와 겹칠 때 나올 수 있다. `promoted`·`unlinked`·`ledger unavailable` 은 평소 거의 없다.
- 세션 연결 저장 확인(읽기 전용): api 배포 뒤 생성된 잡 중 편집 세션 id 를 실은 잡에 값이 남는다. 이전 행은 바뀌지 않는다.

```bash
source ~/storige/.env && docker exec storige-mariadb mariadb -ustorige -p"$DATABASE_PASSWORD" storige \
  -e "SELECT job_type, COUNT(*) FROM worker_jobs WHERE edit_session_id IS NOT NULL AND created_at >= '<api 배포 시각(UTC)>' GROUP BY job_type;"
```

**롤백**

1. api 를 먼저 되돌린다(합성 큐 `attempts` 를 넣는 변경 제거 → 새 합성 잡은 1회 처리).
   - api 를 Wave 3 이전 코드로 되돌릴 때는(revert 빌드·이미지 모두) 오너 승인 뒤 운영 정리 절차를 먼저 수행한다.
   - Wave 3 커밋을 revert 한 checkout(`~/storige`)에서 api 만 다시 빌드한다. recreate 뒤 nginx 재시작은 같다. 이미지로 되돌리는 경우는 배포 0단계에서 보존한 `storige-api:rollback-pre-wave3` 을 `latest` 로 다시 지정하고 `docker compose up -d --no-build api` 뒤 nginx 를 재시작한다.
   - revert 커밋을 master 에 push 하면 그 커밋에 든 editor·admin 변경도 Vercel 이 다시 배포한다(4단계).

```bash
cd ~/storige && git revert <Wave 3 커밋> --no-edit
docker compose up -d --build api && docker compose restart nginx
```

2. 합성 큐에 `attempts` 가 1보다 큰 잡이 남아 있으면 소진을 확인한 뒤 worker 를 되돌린다. 남은 잡은 그동안 Wave 3 worker 가 처리한다.

```bash
docker exec storige-redis redis-cli ZCARD bull:pdf-synthesis:delayed   # 재시도 대기
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:active     # 처리 중
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait       # 대기(api 를 되돌리기 전에 들어간 잡 포함)
# 0 이 아니면 큐 잡 id 를 보고 opts 의 attempts 를 확인한다
docker exec storige-redis redis-cli ZRANGE bull:pdf-synthesis:delayed 0 -1
docker exec storige-redis redis-cli LRANGE bull:pdf-synthesis:active 0 -1
docker exec storige-redis redis-cli HGET bull:pdf-synthesis:<queueJobId> opts   # … "attempts":3 …
```

3. worker 되돌리기: 1단계에서 되돌린 같은 checkout 에서 `docker compose build worker && docker compose up -d worker`. 1단계를 이미지로 되돌렸다면 worker 도 `storige-worker:rollback-pre-wave3` 을 `latest` 로 다시 지정하고 `docker compose up -d --no-build worker` 로 올린다.
4. editor·admin: Vercel 에서 직전 배포를 다시 승격하거나, 커밋 revert 뒤 master push. IIFE 번들을 다시 만들었다면 VPS 에서 직전 커밋으로 `build:embed:prod` 를 다시 실행한다.
- DB 마이그레이션이 없으므로 스키마 되돌리기는 없다. `SESSION_JOB_OUTPUT_LOOKUP` 은 기본 `false` 그대로 둔다.

### 합성 입력 오류 · 실패 응답 정리 · 운영 키 매핑 배포 (2026-10-05, Wave 4)

> api·worker·editor 와 `docker-compose.yml` 을 함께 바꾸는 배포다. DB 마이그레이션은 없다. compose 에 매핑을 더한 키(위 「파일 정리 · 스프레드 검증 키 compose 매핑」)는 기본값이 코드 기본값과 같아, `.env` 에 키를 넣지 않았다면 동작이 그대로다. editor 는 master push 로 Vercel 이 배포한다(위 「Vercel 배포 파이프라인」 절로 state 확인). 합성 실패 응답이 바뀌므로 파트너 사전 통지(`docs/partner-notices/PARTNER_NOTICE_WAVE4_2026-10-05.md`)의 ACK 를 master push 전에 받고, 오너 배포 승인 뒤에 배포한다. 계약 문서는 같은 push 로 공개되며, 바뀐 합성 동작의 적용 시점은 worker 배포 완료 통지 시각이다.

**변경 내용**

- worker — 합성 입력 오류: merge·compose-mixed·펼침면 합성의 입력 오류를 `PDF_LOAD_FAILED`·`FILE_NOT_FOUND`·`INPUT_URL_REJECTED` 로 기록하고 재시도하지 않는다(위 「작업 상태 고정 · 합성 재시도 · 세션 연결 기록 배포」의 재시도 판정표와 `[SYNTH_INPUT]` 로그).
- worker — 합성 `FAILED` 오류 필드: merge(`synthesize`·`external`)·compose-mixed·펼침면 합성과 테스트 환경 합성(모든 mode)에 적용한다.
  - `errorCode` 가 실린다. 워커 오류 코드이고, 코드가 없는 오류는 `SYNTHESIS_FAILED` 다.
  - `errorMessage` 는 `errorCode` 에 대응하는 안내 문구다. 코드가 없는 오류는 `합성 처리 중 오류가 발생했습니다` 이고, 일부 코드의 문구에는 쪽수·치수 같은 입력 값이 들어간다.
  - `errorDetail` 은 허용 키(`input`·`phase`·`httpStatus`·`target`·`expected`·`got`·`index`)의 원시값만 싣고, 남는 키가 없으면 싣지 않는다(잡의 `errorDetail` 은 `null`). 코드가 없는 HTTP 응답 오류는 `{ httpStatus }` 다.
  - split·duplex-split(테스트 환경 제외)의 `FAILED` 는 그대로다. 파트너 계약 서술은 `docs/CONTRACT_FREEZE.md`·`docs/PLATFORM_INTEGRATION_GUIDE.md` 를 따른다.
  - 별도 플래그는 없다. 되돌리기는 아래 롤백이다.
- api — 잡 종결 후속 처리는 결과 파일 id 를 잡에 비어 있을 때만 기록한다(먼저 기록된 값 유지). 도서 확정(v1 books)의 상태 전이는 처리가 읽은 상태일 때만 쓰며, 같은 보고가 겹치면 먼저 쓴 처리만 도서 확정·웹훅을 한다. 쓰지 않게 된 산출 파일 행은 삭제 표시한다. 새 환경 변수는 없다.
- editor — 회원 세션 생성(`POST /edit-sessions`)은 429 일 때만 자동 재시도한다. 주문 번호(`orderSeqno`)가 있는 요청이 408·5xx 로 실패하면 그 주문의 세션 목록을 조회해 같은 mode·templateSetId 의 회원 세션이 있으면 그 세션을 열고, 없으면 1초 뒤 한 번만 다시 보낸다. 비회원 세션 생성은 그대로다. IIFE 번들(`/embed/`)은 다시 만들지 않는다.
- compose — api·worker 매핑 추가(위 표). `LOG_LEVEL` 은 매핑하지 않는다.

**순서: 이미지 태그 보존 → 파트너 사전 통지 ACK → master push(editor 자동 배포, 문서 공개) → worker → api(+ nginx 재시작) → `[FLAGS]`·렌더링 값 확인 → 스모크 → 완료 통지.**

```bash
# 0) 직전 이미지 보존(이미지 롤백용)
docker tag storige-api:latest storige-api:rollback-pre-wave4
docker tag storige-worker:latest storige-worker:rollback-pre-wave4

# 배포 전 [FLAGS] 줄 보관 — 배포 뒤 줄과 비교한다
docker logs storige-api 2>&1 | grep "\[FLAGS\]" | tail -2
docker logs storige-worker 2>&1 | grep "\[FLAGS\]" | tail -1

cd ~/storige && git pull origin master

# 셸 export 확인(출력이 없어야 한다)과 렌더링 값 확인(위 「파일 정리 · 스프레드 검증 키 compose 매핑」 절의 두 명령).
#   렌더링 값은 표의 기본값과 같아야 한다. 다르면 .env 에 그 키가 있다는 뜻이므로 배포를 멈추고 값을 확인한다.
#   docker compose config 전체를 화면에 출력하지 않는다(키를 추출하는 명령만 쓴다).

# 1) worker 먼저 — 완료 시각(UTC)을 기록한다(완료 통지의 적용 시점)
docker compose build worker && docker compose up -d worker
docker logs storige-worker 2>&1 | grep "\[FLAGS\]" | tail -1   # … SPREAD_SNAPSHOT_HARD_FAIL=false WORKER_TRIMBOX_SIZE_CHECK=true

# 2) 그다음 api — recreate 뒤 nginx 재시작 필수
docker compose up -d --build api && docker compose restart nginx
docker logs storige-api 2>&1 | grep "\[FLAGS\]" | tail -2      # 배포 전에 보관한 줄과 같아야 한다
docker exec storige-api printenv EDITOR_SPREAD_VALIDATION_MAPPING   # on

# 3) 스모크
curl http://localhost:4000/api/health
curl http://localhost:4001/health
```

- 배포 전후 `[FLAGS]` api·worker 줄은 같아야 한다. `SPREAD_SNAPSHOT_HARD_FAIL` 은 두 줄 모두 `false` 다.
- 배포 뒤 합성 `FAILED` 에서 `[SYNTH_INPUT]` 줄이 보이면 입력 오류로 즉시 끝난 잡이다(위 「확인 로그 — 합성 입력 오류」).
- api 확인 로그: `docker logs storige-api 2>&1 | grep -E "먼저 기록된 결과 파일 사용|상태가 이미 바뀜|다른 처리가 먼저 전이"` — 같은 잡·같은 도서 확정의 처리가 겹쳤을 때만 나온다. 평소에는 줄이 없다.

**롤백 (Wave 4 전체)**

1. api 를 먼저 되돌린다: 0단계에서 보존한 이미지를 `latest` 로 다시 지정하고 빌드 없이 올린 뒤 nginx 를 재시작한다.

```bash
docker tag storige-api:rollback-pre-wave4 storige-api:latest
docker compose up -d --no-build api && docker compose restart nginx
```

2. 합성 큐의 재시도 대기(delayed)·처리 중(active)이 0 이 될 때까지 기다린 뒤 worker 를 되돌린다. 남은 잡은 그동안 Wave 4 worker 가 처리한다.

```bash
docker exec storige-redis redis-cli ZCARD bull:pdf-synthesis:delayed   # 재시도 대기
docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:active     # 처리 중
```

3. worker 되돌리기:

```bash
docker tag storige-worker:rollback-pre-wave4 storige-worker:latest
docker compose up -d --no-build worker
```

4. compose 되돌리기: Wave 4 의 `docker-compose.yml` 변경을 되돌리는 revert 커밋을 저장소에 올리고, VPS 에서는 `git pull origin master` 로 받는다. VPS checkout(`~/storige`)에서 직접 `git revert` 하거나 파일을 고쳐 로컬 커밋·dirty 상태를 남기지 않는다. 받은 뒤 `docker compose up -d --no-build worker`, `docker compose up -d --no-build api && docker compose restart nginx` 로 다시 올린다. 매핑 키의 기본값이 코드 기본값과 같으므로 1~3단계의 이미지 롤백은 compose 되돌리기 전에 해도 된다.
5. editor: Vercel 에서 배포 직전 운영 배포를 다시 승격한다(master push 전에 그 배포를 기록해 둔다).
6. 롤백하면 파트너에게 통지하고, 계약 문서(`docs/CONTRACT_FREEZE.md`·`docs/PLATFORM_INTEGRATION_GUIDE.md`)를 되돌리는 커밋을 올린다. 롤백 전에 기록된 `FAILED` 잡의 `errorCode`·`errorMessage` 는 그대로 남는다.

- DB 마이그레이션이 없으므로 스키마 되돌리기는 없다.

### 양장 표지 싸바리 출력 · 쪽 단위 확인 배포 (2026-10-05, Wave 6)

> api·editor·admin 과 공용 패키지(`packages/types`·`packages/canvas-core`, editor 번들에 포함)를 바꾸는 배포다. worker·DB 스키마·compose 는 바뀌지 않는다. 양장 표지 싸바리 출력은 **템플릿 데이터가 조건을 만족할 때만** 켜지므로, 코드 배포만으로는 운영 편집기 출력·검증 결과가 바뀌지 않는다.

**변경 내용**

- editor — 양장 싸바리 출력 모드: 템플릿셋 `cover_type` 이 `hardcover_wrap` 이고, 표지 템플릿 면이 판형+8mm(±0.2)이며, caseBind·날개·표지 외곽선이 없고 내지 전용 세트가 아닐 때만 켜진다. 켜지면 표지 화면에 사방 20mm 싸바리 여분이 보이고, 표지 PDF 는 업로드 검증과 같은 싸바리 전개 크기((판형 폭+8)×2+책등+40 × (판형 높이+8)+40)로 출력되며, 비포토북 내지 PDF 는 템플릿셋 판형 크기다. 켜지지 않으면 표지·내지 출력은 이전과 같다(브라우저 콘솔에 꺼진 사유 1줄).
- editor — 쪽 추가 단위: 호스트 `pageStep` 과 템플릿셋 쪽 단위가 다르면 호스트 값을 쓰고 브라우저 콘솔에 경고 1줄을 남긴다(동작 불변).
- api — 편집 완료 표지 검증: 편집기가 싸바리 출력 메타(`metadata.coverOutput.layout='hardcover-wrap'`)를 기록하고 템플릿셋 판형·면·전개 크기가 맞을 때만 표지를 싸바리 전개 기준으로 검증한다. 그 밖의 세션은 이전과 같다.
- admin — 템플릿셋 목록에 쪽 단위(`page_step`) 표시.

**순서: master push(editor·admin 자동 배포) → api(+ nginx 재시작) → 스모크.** worker 는 재배포하지 않는다. api 는 구 editor 와도 동작이 같아(싸바리 메타가 없으면 이전 경로) 순서가 바뀌어도 안전하다.

```bash
# 0) 직전 이미지 보존
docker tag storige-api:latest storige-api:rollback-pre-wave6

cd ~/storige && git pull origin master
docker compose up -d --build api && docker compose restart nginx
docker logs storige-api 2>&1 | grep "\[FLAGS\]" | tail -2      # 배포 전과 같아야 한다
curl http://localhost:4000/api/health
```

- 싸바리 출력 모드를 실제로 켜는 템플릿 데이터 반영(새 템플릿셋·표지 템플릿 등록)은 이 배포와 별도로, 오너 승인과 파트너 사전 통지 뒤 진행한다.

**롤백 (Wave 6)**

1. 템플릿 데이터를 반영했다면 먼저 되돌린다(템플릿셋 연결을 원래대로).
2. editor·admin: Vercel 에서 배포 직전 운영 배포를 다시 승격한다.
3. api: `rollback-pre-wave6` 이미지를 `latest` 로 다시 지정하고 빌드 없이 올린 뒤 nginx 를 재시작한다.

---

## 문제 해결

### 1. 컨테이너가 시작되지 않음

```bash
# 로그 확인
docker-compose logs <service-name>

# 컨테이너 재시작
docker-compose restart <service-name>

# 컨테이너 재생성
docker-compose up -d --force-recreate <service-name>
```

### 2. MySQL 연결 실패

```bash
# MySQL 컨테이너 상태 확인
docker-compose exec mysql mysqladmin ping -h localhost

# 데이터베이스 존재 확인
docker-compose exec mysql mysql -u root -p -e "SHOW DATABASES;"

# 사용자 권한 확인
docker-compose exec mysql mysql -u root -p -e "SHOW GRANTS FOR 'storige'@'%';"
```

### 3. Redis 연결 실패

```bash
# Redis 연결 테스트
docker-compose exec redis redis-cli ping

# Redis 키 확인
docker-compose exec redis redis-cli KEYS "*"
```

### 4. Worker가 작업을 처리하지 않음

```bash
# Worker 로그 확인
docker-compose logs -f worker

# Redis 큐 확인
docker-compose exec redis redis-cli KEYS "bull:*"

# API 서버가 작업을 추가하는지 확인
curl -X POST http://localhost:4000/api/worker-jobs/validate \
  -H "Content-Type: application/json" \
  -d '{"fileUrl":"...","fileType":"cover",...}'
```

**잡이 `PROCESSING` 에 오래 머물 때 (2026-10-03)**

- 처리 중 워커가 중단된 잡(워커 재기동·잠금 만료 등)은 Bull 이 한 번 다시 처리한다(`maxStalledCount: 1`, `apps/worker/src/app.module.ts`). 두 번째로 중단되면 Bull 이 큐 잡을 실패시키고(합성 큐 잡은 남은 시도와 관계없이), 워커가 API 잡을 `FAILED`(`errorCode: 'JOB_STALLED'`)로 기록한다. `docker logs storige-worker 2>&1 | grep "\[JOB_STALLED\]"` 의 `outcome=` 로 결과를 본다(값 표는 위 「합성 내지 기대 재단 · 반복 중단 실패 기록 배포」).
- 워커는 기록 전에 잡 상태를 조회해 `PENDING`·`PROCESSING` 일 때만 바꾼다. 합성 완료 마커가 남은 잡은 `FAILED` 대신 `COMPLETED` 를 다시 보고한다.
- 기록하지 못했으면(`outcome=statusUnavailable`·`patchFailed` 등, API 조회·기록 실패) api 스위퍼(10분 주기)가 생성 2시간 뒤 `FAILED`(`errorCode: 'JOB_TIMEOUT_SWEPT'`)로 정리한다(`apps/api/src/worker-jobs/worker-jobs-sweeper.service.ts`).
- 두 코드 모두 같은 요청으로 새 작업을 만들면 된다.
- 합성 잡은 재시도 대기 중에도 `PROCESSING` 이다(대기 30초·90초 + 재처리 시간, 앞선 합성 잡이 있으면 큐 대기 포함). `[SYNTH_RETRY] action=retry` 줄과 `docker exec storige-redis redis-cli ZCARD bull:pdf-synthesis:delayed` 로 확인한다(위 「작업 상태 고정 · 합성 재시도 · 세션 연결 기록 배포」).
- `JOB_STALLED`·`JOB_TIMEOUT_SWEPT` 로 기록된 잡에 워커가 뒤늦게 `COMPLETED` 를 보고하면 api 가 `COMPLETED` 로 바꾼다(`[job-status] promoted`). 그 밖의 늦은 보고는 반영하지 않는다(다른 상태는 `[job-status] blocked`, 같은 상태는 `[job-status] repeat`).

### 5. 디스크 공간 부족

```bash
# Docker 이미지 정리
docker system prune -a

# 사용하지 않는 볼륨 정리
docker volume prune

# 로그 파일 정리 (선택)
docker-compose down
rm -rf storage/logs/*
```

---

## 보안 체크리스트

- [ ] `.env` 파일의 비밀번호를 강력하게 설정
- [ ] JWT_SECRET을 랜덤한 긴 문자열로 설정
- [ ] CORS_ORIGIN을 특정 도메인으로 제한
- [ ] MySQL 외부 접근 차단 (필요시에만 허용)
- [ ] Redis 외부 접근 차단
- [ ] Nginx에서 SSL/TLS 설정 (Let's Encrypt 권장)
- [ ] 정기적인 보안 업데이트 적용
- [ ] 로그 파일 정기 삭제 설정

---

## 성능 최적화

### Docker 최적화

```yaml
# docker-compose.yml에 리소스 제한 추가
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### MySQL 최적화

```sql
-- my.cnf
[mysqld]
innodb_buffer_pool_size = 4G
max_connections = 200
query_cache_size = 64M
```

### Redis 최적화

```conf
# redis.conf
maxmemory 2gb
maxmemory-policy allkeys-lru
```

---

## 다음 단계

- [ ] SSL 인증서 설정 (Let's Encrypt)
- [ ] 자동 백업 스크립트 설정
- [ ] 모니터링 도구 연동 (Grafana, Prometheus)
- [ ] CI/CD 파이프라인 구축
- [ ] 부하 테스트 수행

---

## 지원

문제가 발생하면 다음을 확인하세요:

1. **로그 파일**: `docker-compose logs -f`
2. **문서**: `README.md`, `PHASE6_COMPLETE.md`
3. **이슈 트래커**: GitHub Issues
