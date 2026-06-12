# 보안 시크릿 회전 런북 (2026-06-13)

> **상태: 절차서만 — 회전 실행 금지.**
> 이 문서는 PUBLIC 레포(`papascompany/storige-book-editor`)에 시크릿 파일이
> 커밋되어 있던 사고(DEP-1~4)에 대한 **회전(rotation) 절차서**다.
> 실제 회전은 bookmoa(PHP 쇼핑몰) 측과 키 교체 타이밍을 맞춰야 하므로
> **오너 승인·협조 하에 수동으로 실행**한다. (일방 회전 시 bookmoa 연동 단절 위험)
>
> 이 문서 자체에는 어떤 실값도 적지 않는다. 실값 위치: VPS `~/storige/.env`
> (chmod 600) 및 로컬 `CLAUDE.local.md` (gitignored).

---

## 0. 배경 — 무엇이 유출되었나

2026-06-13 기준 git **HEAD 에서 제거 완료**된 추적 시크릿 파일:

| 파일 | 내용물(종류) |
|---|---|
| `apps/api/.env.production` | DB/JWT/Redis/API_KEYS/ADMIN 계정 |
| `apps/api/.env.development` (+`.bak`) | 위와 동급 + BOOKMOA_DB_* (북모아 DB 자격증명) |
| `apps/worker/.env.production` | DB/WORKER_API_KEY |
| `계정정보_대시보드.html` | 운영 계정 일람(DB·SSH 접속정보·Grafana·JWT·API key) |

⚠️ **HEAD 제거 ≠ 비밀 해제.** git 히스토리(이전 감사 기준 38개 blob)에 그대로 남아
있고 레포가 PUBLIC 이므로, **히스토리에 한 번이라도 올라간 값은 전부 유출로 간주하고
회전**해야 한다. (§4 체크리스트) 회전이 1순위, 히스토리 정화(§3)는 2순위 — 정화만으로는
이미 클론/캐시된 사본을 회수할 수 없다.

런타임 영향 없음 확인(2026-06-13 실측): VPS docker compose 는 `env_file` 지시어 없이
`environment:` 블록 + 루트 `~/storige/.env`(untracked) 치환만 사용하며, 운영 컨테이너
(`storige-api`/`storige-worker`) 내부에 `.env.production` 파일이 존재하지 않는다.
→ 레포에서 파일을 지워도(다음 `git pull` 시 VPS 워킹트리에서도 삭제됨) 무중단.

---

## (a) STORIGE_API_KEY 회전 — 무중단 절차

### 실코드 확인 결과: 복수 키 지원 ✅

- `apps/api/src/sites/sites.service.ts` `onModuleInit()` — `.env` 의 `API_KEYS`
  (**콤마 구분 복수 키**)를 부팅 시 `sites` 테이블에 idempotent 시드.
- `apps/api/src/auth/strategies/api-key.strategy.ts` — 인증은 env 비교가 아니라
  **DB 조회**(`sites.editor_auth_code` / `worker_auth_code`, `status='active'`)로 수행.
- 즉 **신·구 키가 동시에 유효한 기간**을 만들 수 있어 무중단 회전이 가능하다.
- 주의: env 에서 키를 빼는 것만으로는 **폐기되지 않는다**(DB row 가 남음).
  폐기는 반드시 DB(또는 admin UI)에서 해당 site row 를 비활성/삭제해야 한다.

### 무중단 회전 순서 (bookmoa 오너와 시간 협의 후)

1. **신 키 발급** — 둘 중 하나:
   - admin(https://admin.papascompany.co.kr) 사이트 관리에서 신규 인증코드 발급
     (`sk-storige-` + 48hex 자동 생성, 재시작 불필요), 또는
   - VPS `~/storige/.env` 의 `API_KEYS` 에 콤마로 신 키 **추가**(구 키 유지) 후
     `docker compose up -d api` → 부팅 시드로 site row 생성.
     - ⚠️ api 단독 recreate 시 nginx 가 옛 컨테이너 IP 를 캐싱해 502 가 날 수 있음 →
       `docker compose restart nginx` 동반 실행.
2. **신 키 검증** — `curl -H "X-API-Key: <신키>" https://api.papascompany.co.kr/api/...`
   로 200 확인 (구 키도 아직 유효한 상태).
3. **bookmoa PHP 측 교체** — bookmoa 운영자에게 신 키 전달(보안 채널), PHP `.env` 의
   `STORIGE_API_KEY` 교체·반영 확인. 이 동안 구 키가 살아 있으므로 서비스 무중단.
4. **구 키 폐기** — bookmoa 전환 확인 후:
   1. VPS `~/storige/.env` 의 `API_KEYS` 에서 구 키 제거 (재시드 방지),
   2. admin UI 또는 DB 에서 구 키 site row `status` 비활성(또는 삭제),
   3. `docker compose up -d api && docker compose restart nginx`.
5. **사후 확인** — 구 키로 호출 시 401, 신 키 200, bookmoa → storige 편집기 진입 정상.

---

## (b) 북모아 DB 자격증명 회전 + 3306 IP allowlist

`BOOKMOA_DB_*` (read-only 계정)가 `apps/api/.env.development` 로 커밋된 적 있음.
북모아 DB 는 **외부(북모아 호스팅) 소유**라 회전에 북모아 측 작업이 필수다.

> 참고: 현 운영 api 컨테이너에는 `BOOKMOA_DB_*` env 가 주입되어 있지 않아
> (`app.module.ts` 는 `BOOKMOA_DB_PASSWORD` 존재 시에만 커넥션 등록) 연동이
> 비활성 상태 — 회전해도 storige 운영 중단 없음. 단 유출은 유효하므로 회전 필요.

### 절차

1. 북모아 DB 관리자에게 아래 요청 문안 발송.
2. 신 계정 발급 확인 → 로컬 개발자 `.env.development` 와 (활성화 시) VPS `.env` 갱신.
3. 구 계정 삭제 확인.

### 요청 문안 (북모아 호스팅/DB 관리자 앞)

```
제목: [보안] storige 연동용 DB 계정 교체 및 3306 포트 접근 제한 요청

1. 계정 교체
   - 기존 storige 연동용 읽기전용 계정(bookmoa_readonly 또는 발급해주신 계정)의
     자격증명이 외부에 노출된 정황이 있어 폐기가 필요합니다.
   - 신규 읽기전용 계정(SELECT 권한만, 기존과 동일 스키마 범위)을 발급해 주시고,
     발급 확인 후 기존 계정은 삭제 부탁드립니다.
   - 신규 자격증명은 이메일/메신저 평문이 아닌 보안 채널(1회성 링크 등)로 전달 부탁드립니다.

2. 3306 포트 접근 제한 (IP allowlist)
   - 현재 DB 포트(3306)가 외부에서 접근 가능한 상태라면, 아래 IP 만 허용하도록
     방화벽/보안그룹 설정을 부탁드립니다.
     - 158.247.235.202  (storige 운영 VPS, Vultr Seoul)
     - (필요 시) 사무실 고정 IP 1건
   - 그 외 전체 IP 의 3306 인바운드는 차단 부탁드립니다.

작업 가능 일정 회신 주시면 저희 쪽 설정 교체와 시간을 맞추겠습니다.
```

---

## (c) git 히스토리 정화 (BFG / git filter-repo)

### 전제 — 반드시 이 순서

1. §4 회전 **완료 후** 실행 (정화는 유출 회수가 아니라 노출면 축소).
2. 모든 협업자/병행 작업이 푸시 완료된 "조용한 시점"에 실행.
3. 미러 백업 선행: `git clone --mirror git@github.com:papascompany/storige-book-editor.git backup.git`

### 절차 (git filter-repo 권장 — BFG 보다 정밀)

```bash
# 1. 신선한 미러 클론에서 작업
git clone --mirror git@github.com:papascompany/storige-book-editor.git purge.git
cd purge.git

# 2. 경로 기준 제거 (히스토리 전체에서)
git filter-repo \
  --invert-paths \
  --path apps/api/.env.production \
  --path apps/api/.env.development \
  --path apps/api/.env.development.bak \
  --path apps/worker/.env.production \
  --path '계정정보_대시보드.html'

# 3. 값 기준 제거 (문서에 박힌 비번/키 — replacements.txt 에 실값 나열, 파일은 로컬에만)
git filter-repo --replace-text replacements.txt   # 각 줄: <실값>==>REDACTED

# 4. 검증: 히스토리 전체 grep 으로 잔존 0 확인
git grep -I --all-match -e '<실값 일부>' $(git rev-list --all) | head   # 0건이어야 함

# 5. force-push
git push --force --mirror git@github.com:papascompany/storige-book-editor.git
```

(BFG 대안: `bfg --delete-files '{.env.production,.env.development,.env.development.bak,계정정보_대시보드.html}'` + `bfg --replace-text replacements.txt` — 결과는 동등, 경로 구분이 불가해 admin/editor 의 무해한 동명 파일까지 지워질 수 있어 filter-repo 권장.)

### 영향 (PUBLIC 레포 force-push)

- **전체 커밋 SHA 변경** → 기존 클론/포크 전부 무효. 문서(RESUME_PROMPT 등)에 적힌
  커밋 해시 참조도 과거 히스토리 기준으로만 유효해짐.
- **VPS 체크아웃**: `git pull` 불가 상태가 됨 → 정화 직후
  `ssh deploy@158.247.235.202 'cd ~/storige && git fetch origin && git reset --hard origin/master'`
  (로컬 untracked `.env`/storage 는 reset 영향 없음). 또는 재클론.
- **Vercel(storige-admin/editor)**: GitHub 연동 빌드라 다음 push 부터 정상.
- **열린 PR/브랜치**: 베이스 소실로 다시 만들어야 함.
- **GitHub 캐시**: force-push 후에도 옛 커밋이 SHA 직링크/포크/캐시 페이지로 잠시 접근
  가능할 수 있음 → GitHub Support 에 "remove cached views / dereference dangling commits"
  요청 티켓 필요. 포크가 존재하면 포크 소유자 협조 또는 DMCA 외엔 강제 수단 없음.
- 결론: **정화를 해도 "유출 안 됨"으로 되돌릴 수 없다** — 회전이 본질, 정화는 보조.

---

## (d) 커밋된 적 있는 값 전수 회전 체크리스트

> 전부 "히스토리에 존재 = 유출" 간주. 회전 후 체크. **지금 실행하지 말 것** — 오너 일정 협의.

| # | 시크릿 | 위치(반영처) | 회전 방법 | 영향/주의 |
|---|---|---|---|---|
| 1 | `STORIGE_API_KEY` (`API_KEYS`) | VPS `.env` + `sites` 테이블 + bookmoa PHP | §(a) 무중단 절차 | bookmoa 협조 필수 |
| 2 | `WORKER_API_KEY` | VPS `.env` (worker→api 내부 인증) | 신 키 생성 → `.env` 교체 → api·worker 동시 `up -d` + nginx 재시작 | 내부 키 — 외부 협조 불필요 |
| 3 | `JWT_SECRET` | VPS `.env` | 새 32+자 랜덤 → api 재기동 | **기존 로그인 토큰 전부 무효** → admin 사용자 재로그인 |
| 4 | `DATABASE_PASSWORD` (storige MariaDB) | VPS `.env` + MariaDB 사용자 | `ALTER USER ... IDENTIFIED BY` → `.env` 교체 → api·worker·mariadb 환경 일치 후 재기동 | 짧은 재기동 다운타임. 백업스크립트(`~/backup.sh`)의 인증 경로도 확인 |
| 5 | `MYSQL_ROOT_PASSWORD` | VPS `.env` + MariaDB root | 위와 동일 요령 | init.sql 재실행 아님 — 기존 볼륨에선 ALTER 필요 |
| 6 | `REDIS_PASSWORD` | VPS `.env` (현재 미사용일 수 있음 — compose 의 redis 는 무인증) | redis 설정 변경 시 함께 | 컨테이너 내부망 전용이라 우선순위 낮음 |
| 7 | `ADMIN_PASSWORD` (admin@storige.com) | DB `users.password_hash` | admin UI 비번 변경 또는 DB bcrypt 직접 UPDATE | 과거 임시비번이 docs 에 평문 커밋된 적 있음(레드액션 완료, 히스토리 잔존) — **반드시 교체** |
| 8 | Grafana admin | VPS `.env` `GRAFANA_ADMIN_PASSWORD` | `.env` 교체 → grafana 재기동 (또는 UI 에서 변경) | 대시보드 접속만 영향 |
| 9 | `WEBHOOK_SECRET` | VPS `.env` + bookmoa PHP (HMAC 검증측) | 신·구 병행이 불가한 구조면 bookmoa 와 동시 교체 | bookmoa 협조 필수 |
| 10 | `BOOKMOA_DB_*` | 북모아 DB + 로컬 dev `.env.development` | §(b) | 북모아 협조 필수 |
| 11 | Sentry DSN (api/worker) | VPS `.env` | Sentry 프로젝트에서 DSN 재발급(구 DSN 폐기) | DSN 은 쓰기전용이라 위험도 낮음 — 후순위 |
| 12 | SSH 접속정보 (`계정정보_대시보드.html` 에 호스트/계정 노출) | VPS sshd | 비밀번호 로그인은 원래 차단(key-only) — **개인키 자체는 커밋된 적 없음 확인됨**. fail2ban/ufw 유지 + `authorized_keys` 점검 | IP·계정명 노출은 회전 불가 — 모니터링으로 대응 |

회전 작업 공통 주의: api 컨테이너만 recreate 하면 nginx 가 옛 IP 를 캐싱해 502 →
**항상 `docker compose restart nginx` 동반** (운영 메모리 참조).

---

## (e) gitleaks CI 도입안

재발 방지 — PR/push 마다 시크릿 패턴 자동 검사.

### 1) GitHub Actions (`.github/workflows/gitleaks.yml`)

```yaml
name: gitleaks
on:
  push:
    branches: [master]
  pull_request:

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0           # 전체 히스토리 — 새 커밋 범위 스캔
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

(공개 레포 + organization 계정은 `GITLEAKS_LICENSE` 불필요 — 개인/무료 범위 확인 후 적용.)

### 2) 레포 루트 `.gitleaks.toml` (오탐 허용목록)

```toml
[extend]
useDefault = true

[allowlist]
description = "placeholder-only example envs"
paths = [
  '''.*\.env\.example$''',
  '''.*\.env\.development\.example$''',
]
regexes = [
  '''change-me''',
  '''your-.*-here''',
  '''REDACTED''',
]
```

### 3) (선택) 로컬 pre-commit

```bash
brew install gitleaks
# .git/hooks/pre-commit
gitleaks protect --staged --redact
```

### 4) 운영 규칙

- 시크릿은 **VPS `~/storige/.env` / Vercel 대시보드 env / `CLAUDE.local.md`** 3곳에만.
- 레포에는 `*.example`(플레이스홀더)만. `.gitignore` 에 차단 패턴 추가됨(2026-06-13).
- admin 시드 기본 비번 폴백 제거됨 — 신규 환경은 `ADMIN_PASSWORD` 필수
  (`apps/api/src/database/seeds/admin-seed.service.ts`).

---

## 실행 순서 요약 (오너 결정 후)

1. §(d) #2·#3·#5·#7·#8 — bookmoa 무관 항목 먼저 회전 (storige 단독 작업).
2. §(a) STORIGE_API_KEY + §(d) #9 WEBHOOK_SECRET — bookmoa 와 일정 협의해 무중단 회전.
3. §(b) 북모아 DB 계정 + 3306 allowlist — 북모아 관리자 요청.
4. §(c) 히스토리 정화 + GitHub Support 캐시 제거 요청.
5. §(e) gitleaks CI 활성화 → 이후 상시 가드.
