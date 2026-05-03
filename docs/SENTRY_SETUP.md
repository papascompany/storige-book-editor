# Sentry 운영 에러 추적 설정 가이드

> **상태**: ✅ **활성화 완료 (2026-05-03)** — 4개 앱 모두 Sentry로 에러 전송 중
> **적용 앱**: API / Worker / Editor / Admin (4개)
> **DSN 미설정 시 동작**: silent (로그만 출력, 에러 전송 X)
>
> ## 활성화 이력
> - 2026-05-02: SDK 통합 완료 (커밋 `64b1a14`, `f5e22d9`)
> - 2026-05-03: DSN 4개 발급 + VPS/Vercel env 등록 + 재배포 완료
>   - VPS API: `[Sentry/storige-api] Initialized for production` 로그 확인
>   - VPS Worker: `[Sentry/storige-worker] Initialized for production` 로그 확인
>   - Vercel admin/editor: bundle에 DSN inject 검증 완료
>   - Sentry 조직: papascompany / 4개 프로젝트 (storige-api, -worker, -editor, -admin)

---

## 1. Sentry 계정 / 프로젝트 생성

### 1.1 무료 플랜 가입
1. https://sentry.io 접속 → "Try for free"
2. 조직 이름: `papascompany` 또는 임의
3. 무료 Developer 플랜 (월 5K 에러, 10K 트랜잭션, 50 replay 무료)

### 1.2 프로젝트 4개 생성
| 프로젝트 이름 | 플랫폼 | DSN 변수명 |
|--------------|--------|----------|
| `storige-api` | Node.js (NestJS) | `SENTRY_DSN_API` |
| `storige-worker` | Node.js (NestJS) | `SENTRY_DSN_WORKER` |
| `storige-editor` | React | `VITE_SENTRY_DSN` (editor) |
| `storige-admin` | React | `VITE_SENTRY_DSN` (admin) |

각 프로젝트의 DSN은 `Settings > Projects > <project> > Client Keys (DSN)` 에서 확인.

---

## 2. 환경변수 설정

### 2.1 VPS (`~/storige/.env`)

```bash
# Sentry (운영 전용)
SENTRY_DSN_API=https://xxxxxxxxxxx@o0000000.ingest.us.sentry.io/0000001
SENTRY_DSN_WORKER=https://xxxxxxxxxxx@o0000000.ingest.us.sentry.io/0000002
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1   # 트랜잭션 샘플링 (0.1 = 10%)
SENTRY_RELEASE=storige@2026.05.02   # 배포 시 git commit hash 등 사용
```

### 2.2 Vercel — Editor (대시보드)
`Settings > Environment Variables` 에서 다음 추가:

```
VITE_SENTRY_DSN              = https://...editor-dsn...
VITE_SENTRY_ENVIRONMENT      = production
VITE_SENTRY_TRACES_SAMPLE_RATE = 0.1
VITE_SENTRY_RELEASE          = storige-editor@2026.05.02   (배포 시 자동)
```

### 2.3 Vercel — Admin (대시보드)
```
VITE_SENTRY_DSN              = https://...admin-dsn...
VITE_SENTRY_ENVIRONMENT      = production
VITE_SENTRY_TRACES_SAMPLE_RATE = 0.1
```

---

## 3. 적용

### VPS (API + Worker)
```bash
ssh deploy@158.247.235.202 'cd ~/storige && git pull origin master && docker compose up -d --build api worker'
docker compose logs --tail 30 api worker | grep -i sentry
# → "[Sentry/storige-api] Initialized for production" 확인
```

### Vercel (Admin + Editor)
- master 푸시 시 자동 배포
- 배포 후 브라우저 콘솔에 `[Sentry/admin] Initialized for production` 확인

---

## 4. 작동 확인 (Smoke Test)

### 4.1 API 테스트 에러 발생
```bash
# 일부러 500 에러 유도
curl https://api.papascompany.co.kr/api/this-route-does-not-exist
```
→ Sentry Issues 탭에서 `NotFoundException` 외 에러는 자동 수집

### 4.2 워커 테스트 에러
```bash
# 일부러 잘못된 URL로 검증 잡 실행
# Admin 워커 테스트 페이지에서 잘못된 URL 입력
```
→ Sentry에서 `[ValidationProcessor] Validation job ... error` 캐치

### 4.3 프론트 테스트
브라우저 콘솔에서:
```javascript
throw new Error('Sentry test from editor')
```
→ Sentry Issues 탭에 에러 등록

---

## 5. 알림 채널 연결

### 5.1 Slack
1. Sentry → `Settings > Integrations > Slack`
2. Workspace 인증 → 알림 받을 채널 선택
3. Alert Rule 추가:
   - **High frequency**: 5분 내 에러 10개 이상 → 즉시
   - **First seen**: 새로운 에러 발생 → 즉시
   - **Failed jobs**: `tag:job.queue` 가 있는 에러 → Worker 채널

### 5.2 이메일
Default 알림 규칙 활성화 (Settings > Alert Rules)

---

## 6. 비활성화 / 부분 활성화

DSN을 비워두면 silent 동작:
```bash
# 일시적 비활성화
SENTRY_DSN_API=    # 빈 값
```

콘솔에 `[Sentry/storige-api] DSN not configured — error tracking disabled` 출력 후 정상 동작.

---

## 7. 자동 필터링 (이미 적용됨)

다음 에러는 Sentry로 전송되지 않음:

### API/Worker
- `NotFoundException` (잘못된 경로 접속)
- `BadRequestException` / `UnauthorizedException` / `ForbiddenException`
- `/health` 엔드포인트 호출
- 비밀번호/토큰 등 민감 정보는 자동 마스킹

### Editor/Admin
- `ResizeObserver loop limit exceeded`
- `Failed to fetch` / `NetworkError`
- 브라우저 확장 노이즈

---

## 8. 변경 이력

- **v1 (2026-05-02)** — 최초 통합. 4개 앱 SDK 적용.
- 다음 단계: Source map 업로드 자동화 (Vite plugin) — 선택
