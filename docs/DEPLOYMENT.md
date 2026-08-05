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
# 'true' 승격 시 양쪽 모두 HARD 차단(잘못된 펼침면 크기 인쇄사고 방지). 기본 미설정(SOFT).
# ⚠️ HARD 승격 전 worker 컨테이너에도 ENV 주입 확인: docker exec storige-worker printenv SPREAD_SNAPSHOT_HARD_FAIL
#    (미주입이면 docker-compose.yml 의 worker 서비스 environment 에 추가). SOFT 기간 worker_jobs.result.coverSizeValidation 모니터링 후 승격 권장.
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

rembg 는 가중치를 이미지에 담지 않고 **첫 추론 시점에 내려받는다**(`U2NET_HOME=/home/rembg/.u2net`). 기본 모델 `birefnet-general` 은 fp32 ONNX **약 973MB** 라, 예열하지 않으면 첫 CUTOUT 잡이 다운로드 시간까지 떠안아 `REMBG_TIMEOUT_MS`(기본 180000) 안에 못 끝날 수 있다.

캐시는 named volume `rembg_models` 에 남으므로 **컨테이너 재생성해도 다시 받지 않는다**. 켜기 전에 한 번 예열해 둘 것:

```bash
# 모델 사전 다운로드(예열) — 진행 로그가 뜬다
docker exec storige-rembg python3 -c "from rembg import new_session; new_session('birefnet-general')"

# 사이드카 도달 확인 (워커 컨테이너에서 내부 네트워크로)
docker exec storige-worker wget -qO- http://rembg:7000/api > /dev/null && echo "rembg reachable"

# 캐시 확인
docker exec storige-rembg ls -lh /home/rembg/.u2net
```

### ②-b 사이드카 계약 스모크 (플래그 켜기 전에 1회)

healthcheck 는 FastAPI 문서 라우트(`/api`)만 친다 — **실제 배경제거 라우트가 도는지는 검증하지 않는다.**
모델 키 오타·extras 누락(`[cli]` 만 설치하면 서버는 뜨고 추론에서만 죽는다)은 이 단계에서만 잡힌다.

```bash
# 워커 컨테이너 안에서 내부망으로 호출 (rembg 는 외부 포트가 없다)
docker exec storige-worker sh -lc '
  head -c 100000 /dev/urandom > /tmp/noise.bin
  # 실제 PNG 로 테스트하려면 storage 의 업로드 이미지 하나를 쓰면 된다
  f=$(find /app/storage/uploads -name "*.png" | head -1); echo "input=$f"
  curl -s -o /tmp/out.png -w "%{http_code} %{size_download}\n" \
    -F "file=@$f" "http://rembg:7000/api/remove?model=birefnet-general"
  file /tmp/out.png
'
# 기대: 200 + PNG image data (알파 채널). 422/500 이면 모델 키·extras 문제.
```

### ③ 켜는 순서 (`CUTOUT_ENABLED`)

**반드시 사이드카가 healthy 해진 뒤에** 플래그를 켠다. 순서를 뒤집으면 잡이 생성되고 사이드카가 없어 `ECONNREFUSED` 로 실패한다.

```bash
# 1) 사이드카 기동·예열 (위 ①②) 후 healthy 확인
docker inspect -f '{{.State.Health.Status}}' storige-rembg   # → healthy

# 2) .env 에 플래그 추가
nano ~/storige/.env
#   CUTOUT_ENABLED=true
#   (선택) REMBG_MODEL=birefnet-general  REMBG_TIMEOUT_MS=180000  REMBG_MEM_LIMIT=3g

# 3) api + worker 재기동 → ⚠️ api 가 recreate 되면 nginx 재시작 필수(리터럴 proxy_pass 고정 IP 트랩)
#    ★ worker 를 빠뜨리면 잡은 생성되는데 전건 FAILED 가 된다(플래그는 양쪽 모두 필요).
docker compose up -d api worker && docker compose restart nginx

# 4) 주입 확인 (.env 에만 넣고 compose environment 매핑이 없으면 silent no-op — 이 레포 실적발 3회)
docker exec storige-api printenv CUTOUT_ENABLED         # → true
docker exec storige-worker printenv CUTOUT_ENABLED      # → true  (★ 이게 비면 전건 실패)
docker exec storige-worker printenv REMBG_URL REMBG_MODEL
```

### ④ 롤백 (즉시 원상복구)

```bash
# 1) 플래그 off → 신규 CUTOUT 잡 생성 중단
nano ~/storige/.env      # CUTOUT_ENABLED=false
docker compose up -d api && docker compose restart nginx

# 2) 사이드카 중지 (이미지·모델 캐시는 보존 → 재기동이 빠르다)
docker compose --profile cutout stop rembg

# 3) 완전 제거가 필요하면 (모델 캐시 볼륨까지)
docker compose --profile cutout rm -sf rembg
docker volume rm storige_rembg_models     # ⚠️ 다음 기동 시 ~973MB 재다운로드
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
| **`birefnet-general`** (기본값) | [ZhengPeng7/BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | **MIT** (공개 데이터셋 DIS5K 학습분) | ✅ 상업 사용 가능. fp32 ONNX ≈973MB, 입력 1024². 품질 상위 티어 |
| `birefnet-general-lite` | 동일 | **MIT** | ✅ swin_v1_tiny 백본 — 메모리·지연 대폭 감소, 품질 소폭 하락. 8GB 박스 상시 ON 시 1순위 대안 |
| `u2net` | [xuebinqin/U-2-Net](https://github.com/xuebinqin/U-2-Net) | **Apache-2.0** | ✅ 최경량 폴백. 품질은 가장 낮음 |
| `bria-rmbg` | BRIA AI RMBG-1.4 | **비상업 전용** | ❌ **사용 금지** |
| `u2net_custom` / `dis_custom` / `ben_custom` | (외부 가중치 경로 지정) | — | ❌ **지정 금지** — `model_path` 가 CVE-2026-40086 경로 순회 벡터 |

**기본값을 `birefnet-general` 로 정한 근거**: 오너가 원한 **BEN2 는 rembg 2.0.77 내장 세션 목록에 없다**(경로를 직접 넘기는 `ben_custom` 만 존재 = 위 금지 항목). 같은 의도(MIT · 품질 상위 티어)에 가장 가까운 내장 모델이 `birefnet-general` 이라 이를 채택했고, **모델 교체는 `REMBG_MODEL` 값 하나만 바꾸면 된다**(코드 변경 없음).

```bash
# 모델 교체 예 (경량 전환)
nano ~/storige/.env       # REMBG_MODEL=birefnet-general-lite / REMBG_MEM_LIMIT=1g
docker compose up -d worker
docker compose --profile cutout up -d rembg
docker exec storige-rembg python3 -c "from rembg import new_session; new_session('birefnet-general-lite')"
```

### 환경 변수

| 변수 | 대상 컨테이너 | 기본값 | 설명 |
|---|---|---|---|
| `CUTOUT_ENABLED` | **api · worker** | `false` | 기능 플래그. **양쪽 모두** 필요하다 — 워커에 빠지면 API 는 잡을 접수하는데 워커가 전건 FAILED 로 떨어뜨린다. 값은 `true` 또는 `1` |
| `CUTOUT_MAX_INPUT_PIXELS` | worker | `40000000` | 디코드 픽셀 예산(40MP). 바이트 상한을 통과하는 대형 저압축 이미지 차단 |
| `CUTOUT_RETENTION_DAYS` | api | `7` | 산출물 보존기간. 정리 cron 은 API 에 있다 |
| `REMBG_URL` | worker | `http://rembg:7000` | 사이드카 베이스 URL(내부 네트워크) |
| `REMBG_ENDPOINT` | worker | `/api/remove` | rembg 추론 엔드포인트(POST=multipart `file`, `model` 파라미터) |
| `REMBG_MODEL` | worker | `birefnet-general` | 모델 교체 지점 (위 라이선스 표 참조) |
| `REMBG_TIMEOUT_MS` | worker | `180000` | 사이드카 왕복 타임아웃. 예열 후 하향 가능 |
| `CUTOUT_MAX_INPUT_BYTES` | worker | `31457280` (30MB) | 사이드카로 올릴 원본 이미지 상한 |
| `REMBG_MEM_LIMIT` | rembg | `3g` | 컨테이너 메모리 상한 |
| `REMBG_THREADS` | rembg | `2` | uvicorn 워커 스레드 |
| `REMBG_OMP_NUM_THREADS` | rembg | `2` | ONNX Runtime 스레드 |
| `REMBG_LOG_LEVEL` | rembg | `info` | rembg 서버 로그 레벨 |

> ⚠️ **메모리 예산**: 기본 모델(973MB fp32) 세션 초기화 + 1024² 추론까지 고려해 `mem_limit` 을 3g 로 잡았다. worker 기본 4g 와 **동시 피크** 시 8GB 박스가 빠듯하므로, 상시 ON 운영으로 넘어가기 전에 `REMBG_MODEL=birefnet-general-lite` + `REMBG_MEM_LIMIT=1g` 또는 `WORKER_MEM_LIMIT` 하향을 검토할 것. OOM 시 `docker inspect -f '{{.State.OOMKilled}}' storige-rembg` 로 확인된다.

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
LOG_LEVEL=info  # debug 시 상세 로그 (Loki로 push됨)
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
