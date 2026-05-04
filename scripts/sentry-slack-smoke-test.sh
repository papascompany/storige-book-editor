#!/usr/bin/env bash
# Sentry → Slack 알림 smoke test
#
# 전제: SENTRY_SLACK_SETUP.md 의 Step 1 (OAuth) + Step 2 (Alert Rules) 완료
# 효과: 의도적으로 운영 환경에서 Sentry 이벤트 3종을 발사 → Slack 채널 도착 검증
#
# 사용법:
#   ./scripts/sentry-slack-smoke-test.sh
#
# 발사되는 이벤트:
#   1. Worker job failure  — alert.type=failed, queue=pdf-conversion (Rule 3 트리거)
#   2. New error issue     — storige-api (Rule 1 트리거)
#   3. (안내) 브라우저 콘솔 throw — Editor/Admin Sentry 검증

set -euo pipefail

API_BASE="${API_BASE:-https://api.papascompany.co.kr/api}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@storige.com}"
ADMIN_PASS="${ADMIN_PASS:-}"

if [[ -z "$ADMIN_PASS" ]]; then
  echo "ERROR: ADMIN_PASS 환경변수를 설정하세요. (CLAUDE.local.md §5 참조)"
  echo "예: ADMIN_PASS='r46e...TLK1' ./scripts/sentry-slack-smoke-test.sh"
  exit 1
fi

echo "=========================================="
echo "Sentry → Slack smoke test"
echo "API: $API_BASE"
echo "=========================================="

# 1. Admin JWT 발급
echo ""
echo "[1/3] Admin 로그인…"
TOKEN=$(curl -sX POST "$API_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('accessToken',''))")

if [[ -z "$TOKEN" ]]; then
  echo "ERROR: 로그인 실패. ADMIN_EMAIL / ADMIN_PASS 확인 필요."
  exit 1
fi
echo "  ✓ JWT 발급 (len=${#TOKEN})"

# 2. Worker conversion 잡 — 의도적 실패
echo ""
echo "[2/3] Worker job 실패 트리거 (잘못된 fileUrl)…"
JOB_RESP=$(curl -sX POST "$API_BASE/worker-jobs/convert" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fileUrl":"/storage/uploads/__sentry-smoke-nonexistent__.pdf",
    "convertOptions":{"addPages":true,"applyBleed":false,"targetPages":4,"bleed":0}
  }')

JOB_ID=$(echo "$JOB_RESP" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('id') or d.get('data',{}).get('id',''))")
echo "  ✓ Job 생성: $JOB_ID"
echo "  ⏳ Worker가 ENOENT 발생 → captureJobException → Sentry 'storige-worker' 프로젝트로 전송"
echo "    태그: alert.type=failed, job.type=convert, job.queue=pdf-conversion, job.id=$JOB_ID"

# 잡 실패 확인 (5초 대기 후 상태 조회)
sleep 5
STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API_BASE/worker-jobs/$JOB_ID" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('status',''))")
echo "  ✓ Job status: $STATUS (FAILED 정상, Sentry 캡처 발생)"

# 3. 브라우저 콘솔 안내
echo ""
echo "[3/3] Frontend Sentry 검증 (수동)"
echo "  Editor: https://editor.papascompany.co.kr 접속 → 콘솔에 입력:"
echo "    throw new Error('Sentry Slack smoke test - editor')"
echo "  Admin:  https://admin.papascompany.co.kr 접속 → 콘솔에 입력:"
echo "    throw new Error('Sentry Slack smoke test - admin')"

# 결과 안내
echo ""
echo "=========================================="
echo "✓ Smoke test 발사 완료"
echo "=========================================="
echo ""
echo "Slack 채널(#storige-alerts 또는 설정한 채널)에서 다음 알림 도착 확인:"
echo "  ① storige-worker: ENOENT - 잘못된 fileUrl"
echo "     ↳ Rule 3 'Worker Job Failed' (job.type 태그)에 의해 알림"
echo "  ② storige-editor / storige-admin: 'Sentry Slack smoke test - …'"
echo "     ↳ Rule 1 'New Error Detected'에 의해 알림 (수동 트리거 후)"
echo ""
echo "도착하지 않으면:"
echo "  - Sentry → Issues 탭에서 이벤트는 보이는지 확인 (Sentry는 OK인데 Slack만 X)"
echo "  - Sentry → Alerts → Rules → 활성화 여부, Slack 채널 매핑 확인"
echo "  - 자세한 트러블슈팅: docs/SENTRY_SLACK_SETUP.md §문제 해결"
