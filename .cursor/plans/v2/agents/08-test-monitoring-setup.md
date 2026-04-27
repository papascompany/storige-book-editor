---
name: test-monitoring-setup
description: P6/P7 — 테스트 자동화, 로깅 일원화, 모니터링/알람 (Sentry + 큐 적체 알람).
model: sonnet
---

# 08. Test & Monitoring Setup (P6/P7)

## P6 — 테스트 / 로깅

### 6.1 핵심 시나리오 e2e
```
test/e2e/
├── auth-shop-session.e2e.spec.ts    # X-API-Key + 쿠키 발급
├── file-upload-external.e2e.spec.ts # 외부 업로드
├── worker-validate.e2e.spec.ts      # 검증 잡 → 콜백 수신
├── worker-synthesize.e2e.spec.ts    # 합성 잡 → 결과 PDF 생성
└── webhook-signature.e2e.spec.ts    # 시그니처 검증
```

### 6.2 로깅 일원화
- 모든 NestJS 로그를 JSON 형식으로 (Pino 또는 nestjs-pino)
- 트레이스 ID: 요청마다 `X-Request-Id` 헤더 발급/전파
- API → 워커 잡 시 trace ID를 jobs.metadata에 저장

### 6.3 CI
- GitHub Actions on push to master:
  - `pnpm install --frozen-lockfile --filter @storige/api...`
  - `pnpm --filter @storige/api test`
  - 실패 시 PR 머지 차단

## P7 — 모니터링 / 알람

### 7.1 Sentry (또는 동등)
- API + Worker에 `@sentry/node` 연동
- DSN을 `.env`에 추가 (`SENTRY_DSN`)
- 5xx + unhandled rejection 자동 캡처

### 7.2 큐 적체 알람
```bash
# /home/deploy/queue-alert.sh
WAIT=$(docker exec storige-redis redis-cli LLEN bull:pdf-synthesis:wait)
if [ "$WAIT" -gt 50 ]; then
  curl -X POST <slack webhook> -d "{\"text\":\"⚠️ 합성 큐 적체: $WAIT\"}"
fi
```
cron: `*/5 * * * *`

### 7.3 디스크 / 메모리 알람
- `df -h /` 가용 < 20% 시 알람
- `free -m` available < 1024 MB 시 알람

### 7.4 SSL 만료 알람
- certbot renew 후 fail 시 슬랙 알람 hook

## DoD
- [ ] e2e 5개 시나리오 모두 GREEN
- [ ] Sentry에 첫 에러 캡처 (의도적 throw 1회)
- [ ] 큐 적체 알람 테스트 (50개 임시 푸시 후 슬랙 메시지 확인)
- [ ] CI가 master push마다 도는지
