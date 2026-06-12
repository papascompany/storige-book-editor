---
name: php-integrator
description: bookmoa PHP 운영 코드를 새 Storige 인프라(api.papascompany.co.kr)에 동기화. baseURL/X-API-Key 주입과 4가지 회귀 테스트, 컷오버 후 24h 모니터링까지.
model: sonnet
---

# 01. PHP Integrator (★ 가장 중요)

## 전제 사실 (2026-04-28 야간 갱신)
- 새 API: `https://api.papascompany.co.kr/api`
- 새 Editor: `https://editor.papascompany.co.kr`
- 옛 운영 storige: `http://58.229.105.98:4000` — 북모아 서버 내부 Node.js v20 위 가동 추정. 인수자 접근 불가. 비교는 응답 schema만.
- nimda PHP 키: `sk-storige-REDACTED_SEE_VPS_ENV` — **새 인프라 `.env` API_KEYS에 추가 완료**
- 북모아 운영 PHP 페이지: `bookmoa.noriter.co.kr/editor/{index,editor,callback,worker-test}.php` — storige 레포 `test-php/php/` 그대로 배포 (worker-test.php는 북모아 자체 추가)
- 외부 계약은 `NEW_DEV_PLAN.md §3` 참조

## Step 1. PHP 측 — Apache vhost 2줄만 변경 ★

> **사용자 → bookmoa PHP 서버 개발자 전달용 자료**: [`.cursor/plans/proxy_pass.html`](../../proxy_pass.html)
> 위 HTML 파일을 PHP 개발자에게 전달하면 staging→검증→운영 절차를 자체 수행 가능 (시각화 + Step별 명령어 + FAQ + 롤백 포함).

bookmoa Apache vhost 변경 (PHP 코드 0줄 변경):
```apache
# ① 고객용 편집기 ProxyPass (1줄 변경)
ProxyPass /storige-api/ https://api.papascompany.co.kr/api/
ProxyPassReverse /storige-api/ https://api.papascompany.co.kr/api/

# ② nimda PHP가 사용하는 STORIGE_API_URL (1줄 변경)
SetEnv STORIGE_API_URL "https://api.papascompany.co.kr/api"

# ③ API 키는 변경 없음 (새 인프라가 이미 이 키 인식)
SetEnv STORIGE_API_KEY "sk-storige-REDACTED_SEE_VPS_ENV"

# ④ 편집기 URL은 새 값으로 (기존에 있다면)
SetEnv STORIGE_EDITOR_URL "https://editor.papascompany.co.kr"

# ⑤ webhook 검증 헤더 변경 없음
SetEnv STORIGE_WEBHOOK_VERIFY_HEADER "X-Storige-Signature"
```

**핵심**:
- bookmoa 서버 토폴로지: Apache가 `/editor/`를 PHP로 처리 + `/storige-api/`를 ProxyPass로 storige API에 forward + nimda PHP는 SetEnv로 storige base URL 주입
- 변경할 것은 ProxyPass URL + SetEnv STORIGE_API_URL **딱 2줄**
- PHP 코드, .htaccess, DB는 0줄 변경
- 적용: `apachectl -t && apachectl graceful` (다운타임 0)

**검증**: `apachectl -t -D DUMP_RUN_CFG | grep STORIGE_` 로 환경변수가 새 값으로 적용됐는지.

## Step 1.5. 자체 시뮬레이션 (운영 변경 전 권장)

bookmoa staging 권한 없이도 PHP 흐름을 우리 인프라에서 흉내낼 수 있음. test-php/php/config.php의 패턴 그대로:

```bash
BASE="https://api.papascompany.co.kr/api"
PHP_KEY="sk-storige-REDACTED_SEE_VPS_ENV"

# 1. JWT 발급 (PHP getEditorToken 패턴)
TOKEN=$(curl -sS -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@storige.com","password":"admin123"}' | jq -r .accessToken)

# 2. EditSession 생성
SESSION=$(curl -sS -X POST $BASE/edit-sessions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"orderSeqno":99999100,"memberSeqno":1,"mode":"both","callbackUrl":"<WEBHOOK>"}' | jq -r .id)

# 3-4. PDF 업로드 (외부 X-API-Key)
COVER=$(curl -sS -X POST $BASE/files/upload/external \
  -H "X-API-Key: $PHP_KEY" \
  -F "file=@cover.pdf" -F "type=cover" -F "orderSeqno=99999100" | jq -r .id)
# (content 동일)

# 5. update + complete
curl -sS -X PATCH $BASE/edit-sessions/$SESSION \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"coverFileId\":\"$COVER\",\"contentFileId\":\"$CONTENT\"}"
curl -sS -X PATCH $BASE/edit-sessions/$SESSION/complete \
  -H "Authorization: Bearer $TOKEN"

# 6. 합성 잡 (nimda 패턴)
curl -sS -X POST $BASE/worker-jobs/synthesize/external \
  -H "X-API-Key: $PHP_KEY" -H "Content-Type: application/json" \
  -d "{\"editSessionId\":\"$SESSION\",\"coverFileId\":\"$COVER\",\"contentFileId\":\"$CONTENT\",\"spineWidth\":3,\"orderId\":\"99999100\",\"callbackUrl\":\"<WEBHOOK>\"}"

# 7. nimda 조회 (첨부 명세 schema)
curl -sS -H "X-API-Key: $PHP_KEY" \
  "$BASE/edit-sessions/external?orderSeqno=99999100"
```

## Step 2. PHP staging에서 4개 회귀 테스트

> 운영 변경 **전** 반드시 staging에서 통과해야 함.

### 2.1 회원 세션 발급 회귀
```bash
curl -i -X POST "$STORIGE_API_BASE/auth/shop-session" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "memberSeqno": 1,
    "memberId": "test_member",
    "name": "테스트 회원",
    "role": "customer",
    "permissions": [],
    "phpSessionId": "abc123"
  }'
```
- **DoD**: HTTP 200 + `Set-Cookie: storige_access=...; SameSite=None; Secure; HttpOnly` 응답.

### 2.2 파일 업로드 회귀
```bash
curl -i -X POST "$STORIGE_API_BASE/files/upload/external" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -F "file=@./sample.pdf" \
  -F "orderSeqno=999999" \
  -F "memberSeqno=1" \
  -F "fileType=content"
```
- **DoD**: HTTP 200 + `{ id, file_url, ... }` 응답. `https://api.papascompany.co.kr/storage/...`에서 다운로드 가능.

### 2.3 검증 잡 + 웹훅 수신 회귀
```bash
curl -i -X POST "$STORIGE_API_BASE/worker-jobs/validate/external" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "fileId": "<위에서 받은 file id>",
    "sessionId": "test-session-1",
    "options": { "fileType": "content" },
    "callbackUrl": "https://staging.bookmoa.com/webhook/storige.php",
    "requestId": "regression-2.3"
  }'
```
- **DoD**:
  - HTTP 200 + `{ jobId, status: 'pending' | 'processing' }`
  - 잠시 후 `staging.bookmoa.com/webhook/storige.php`가 `event=session.validated` 받음
  - PHP에서 `verifyStorigeSignature()` 통과

### 2.4 합성 잡 + 웹훅 수신 회귀
```bash
curl -i -X POST "$STORIGE_API_BASE/worker-jobs/synthesize/external" \
  -H "X-API-Key: $STORIGE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "test-session-1",
    "mode": "merge",
    "items": [...],
    "callbackUrl": "https://staging.bookmoa.com/webhook/storige.php",
    "requestId": "regression-2.4"
  }'
```
- **DoD**: `event=synthesis.completed` 콜백 수신 + `outputFileUrl` 다운로드 가능.

## Step 3. PHP 측 웹훅 핸들러 검증

`webhook/storige.php` (또는 동등) 가 다음을 다 수행하는지 코드 점검:
- [ ] `X-Storige-Signature` 검증 (`base64(sessionId|jobId : event : timestamp)`)
- [ ] event별 분기 (validated / failed / completed / failed)
- [ ] DB에 결과 반영
- [ ] 200 OK 빠르게 응답 (10초 타임아웃)
- [ ] 실패 시 5xx → Storige가 1회 자동 재시도하므로 멱등성 보장

## Step 4. CORS_ORIGIN 추가 확인

PHP 운영 도메인에서 iframe → API 호출 시 차단되지 않도록:
```bash
ssh deploy@158.247.235.202 'grep CORS_ORIGIN ~/storige/.env'
```
PHP 운영 도메인이 포함되어 있지 않으면 추가 후 `docker compose restart api`.

## Step 5. iframe 임베드 변경 (Editor URL)

PHP의 편집 페이지에서 iframe `src` 를 새 도메인으로:
```html
<iframe src="<?= STORIGE_EDITOR_URL ?>/?templateSetId=<?= $setId ?>&orderSeqno=<?= $orderNo ?>" ...>
```
- postMessage origin 체크: `https://editor.papascompany.co.kr` 만 허용

## Step 6. 운영 컷오버 (Day 6에서 진행)

`09-cutover-runbook.md §4` 와 함께 진행.

## Step 7. 24시간 모니터링

```bash
# API 로그
ssh deploy@158.247.235.202 'docker logs --tail 200 -f storige-api'

# 워커 로그
ssh deploy@158.247.235.202 'docker logs --tail 200 -f storige-worker'

# 큐 적체
ssh deploy@158.247.235.202 'docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait'
```

## 트러블슈팅

| 증상 | 원인 후보 | 조치 |
|------|----------|------|
| 401 on `/auth/shop-session` | API 키 불일치 | `~/storige/.env`의 `API_KEYS`와 PHP `STORIGE_API_KEY` 비교 |
| CORS 에러 (iframe) | CORS_ORIGIN에 PHP 도메인 누락 | .env 추가 → `docker compose restart api` |
| 쿠키 미설정 (iframe 인증 실패) | SameSite 정책 | API 측이 `SameSite=None; Secure; HttpOnly`로 발급하는지 확인 |
| 콜백이 PHP에 도달 안 함 | callbackUrl 잘못, 방화벽 | API 로그에서 axios 응답 코드 확인 |
| 시그니처 불일치 | timestamp/identifier 추출 오류 | 페이로드 `sessionId` vs `jobId` 분기 정확히 |

## 산출물
- `migration/reports/php-integration-2026-04-XX.md` (회귀 결과 + 컷오버 후 24h 그래프)
