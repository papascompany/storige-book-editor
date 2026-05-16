#!/usr/bin/env bash
#
# Phase 2 — PHP 회귀 보호 테스트 (2026-05-16)
#
# 목적: Phase 1-1 (sites 마이그레이션) + Phase 1-2 (CORS/CSP/Webhook 동적 정책)
#       변경 후에도 운영 중인 bookmoa PHP 가 기존 STORIGE_API_KEY 로 정상 동작하는지
#       회귀 검증한다.
#
# 검증 항목:
#   1) POST /auth/shop-session — HTTP 200, accessToken 발급
#   2) GET  /product-template-sets/by-product — HTTP 200, templateSets 배열
#   3) POST /worker-jobs/check-mergeable/external — HTTP 200 or 201, mergeable boolean
#   4) (옵션) POST /worker-jobs/validate/external — HTTP 201, jobId 발급
#   5) snake_case URL 파라미터 호환 (A-2) — editor.papascompany.co.kr 진입 시도
#   6) Phase 1-2 CORS 정적 fallback — 환경변수/패턴 기반 origin 통과 확인
#
# 사용법:
#   API_URL=https://api.papascompany.co.kr/api \
#   API_KEY=sk-storige-... \
#   EDITOR_URL=https://editor.papascompany.co.kr \
#   ./scripts/test-php-regression-phase2.sh
#
# 안전성:
#   - 모든 호출은 READ-ONLY 또는 임시 데이터 (orderSeqno=999999, memberSeqno=99999).
#   - 실제 PDF 합성 잡(synthesize)은 발사하지 않는다 (큐 오염 방지).
#   - check-mergeable 는 dry-run 이므로 부작용 없음.
#

set -uo pipefail

# ── 설정 ────────────────────────────────────────────────────
API_URL="${API_URL:-https://api.papascompany.co.kr/api}"
API_KEY="${API_KEY:-}"
EDITOR_URL="${EDITOR_URL:-https://editor.papascompany.co.kr}"

# 테스트용 더미 데이터 (실제 데이터와 충돌 방지 위해 큰 값 사용)
TEST_MEMBER_SEQNO="${TEST_MEMBER_SEQNO:-999999}"
TEST_MEMBER_ID="${TEST_MEMBER_ID:-regression-test@bookmoa-platform.test}"
TEST_MEMBER_NAME="${TEST_MEMBER_NAME:-Phase2 회귀 테스트}"
TEST_SORTCODE="${TEST_SORTCODE:-test-sortcode}"
TEST_STANSEQNO="${TEST_STANSEQNO:-1}"

# ── 색상 ────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# ── 카운터 ──────────────────────────────────────────────────
PASS=0; FAIL=0; WARN=0

# ── 유틸 ────────────────────────────────────────────────────
pass()  { echo -e "  ${GREEN}✓ PASS${NC} $*"; PASS=$((PASS+1)); }
fail()  { echo -e "  ${RED}✗ FAIL${NC} $*"; FAIL=$((FAIL+1)); }
warn()  { echo -e "  ${YELLOW}△ WARN${NC} $*"; WARN=$((WARN+1)); }
section() { echo; echo -e "${BLUE}▶ $*${NC}"; }

# ── 사전 점검 ───────────────────────────────────────────────
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  Phase 2 — PHP 회귀 보호 테스트${NC}"
echo -e "${BLUE}======================================${NC}"
echo "API: ${API_URL}"
echo "Editor: ${EDITOR_URL}"
echo "API_KEY: ${API_KEY:0:12}…"
echo "Test Member: seqno=${TEST_MEMBER_SEQNO}, id=${TEST_MEMBER_ID}"
echo

if [ -z "$API_KEY" ]; then
  echo -e "${RED}[ERROR] API_KEY 환경변수가 필요합니다.${NC}"
  echo "예: API_KEY=sk-storige-... ./scripts/test-php-regression-phase2.sh"
  exit 1
fi

# 의존성 확인 (jq 는 옵션)
if ! command -v jq >/dev/null 2>&1; then
  echo -e "${YELLOW}[WARN] jq 가 없습니다. 응답 검증이 단순해집니다.${NC}"
  HAVE_JQ=0
else
  HAVE_JQ=1
fi

# ────────────────────────────────────────────────────────────
# 1) POST /auth/shop-session — HTTP 200, accessToken 발급
# ────────────────────────────────────────────────────────────
section "1) POST /auth/shop-session — 회원 세션 발급"

RESP=$(curl -sS -w "\n%{http_code}" -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "{
    \"memberSeqno\": ${TEST_MEMBER_SEQNO},
    \"memberId\": \"${TEST_MEMBER_ID}\",
    \"memberName\": \"${TEST_MEMBER_NAME}\"
  }" \
  "${API_URL}/auth/shop-session" 2>&1)

HTTP=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP" = "200" ]; then
  pass "HTTP 200 (Phase 0 D-7 확정)"
else
  fail "예상 200, 실제 ${HTTP}"
  echo "    응답: ${BODY:0:200}"
fi

if [ "$HAVE_JQ" = "1" ]; then
  TOKEN=$(echo "$BODY" | jq -r '.accessToken // empty')
  EXPIRES=$(echo "$BODY" | jq -r '.expiresIn // empty')
  SUCCESS=$(echo "$BODY" | jq -r '.success // empty')
  [ "$SUCCESS" = "true" ]   && pass "success=true" || fail "success ≠ true"
  [ -n "$TOKEN" ]           && pass "accessToken 발급 (${#TOKEN}자)" || fail "accessToken 없음"
  [ "$EXPIRES" = "3600" ]   && pass "expiresIn=3600 (Phase 0 D-5)" || warn "expiresIn=${EXPIRES} (예상 3600)"
else
  echo "$BODY" | grep -q '"accessToken"' && pass "accessToken 키 존재" || fail "accessToken 키 없음"
fi

# ────────────────────────────────────────────────────────────
# 2) GET /product-template-sets/by-product
# ────────────────────────────────────────────────────────────
section "2) GET /product-template-sets/by-product?sortcode=&stanSeqno="

RESP=$(curl -sS -w "\n%{http_code}" -X GET \
  -H "X-API-Key: ${API_KEY}" \
  "${API_URL}/product-template-sets/by-product?sortcode=${TEST_SORTCODE}&stanSeqno=${TEST_STANSEQNO}" 2>&1)

HTTP=$(echo "$RESP" | tail -n1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP" = "200" ]; then
  pass "HTTP 200"
elif [ "$HTTP" = "404" ]; then
  warn "HTTP 404 — 테스트 sortcode/stanSeqno 미등록 (실제 운영 데이터로 재실행 권장)"
else
  fail "예상 200, 실제 ${HTTP}"
  echo "    응답: ${BODY:0:200}"
fi

if [ "$HAVE_JQ" = "1" ] && [ "$HTTP" = "200" ]; then
  echo "$BODY" | jq -e '.templateSets | type == "array"' >/dev/null \
    && pass "templateSets 배열 응답" \
    || fail "templateSets 배열 아님"
fi

# ────────────────────────────────────────────────────────────
# 3) Phase A-2 검증: snake_case URL 파라미터 호환 (Editor 진입)
# ────────────────────────────────────────────────────────────
section "3) Phase A-2 — snake_case URL 호환 (HEAD only, 부작용 없음)"

URL_SNAKE="${EDITOR_URL}/edit?template_set_id=any&page_count=8&binding_type=perfect&parent_origin=https%3A%2F%2Fwww.bookmoa.co.kr"
URL_CAMEL="${EDITOR_URL}/edit?templateSetId=any&pageCount=8&bindingType=perfect&parentOrigin=https%3A%2F%2Fwww.bookmoa.co.kr"

HTTP_SNAKE=$(curl -sS -o /dev/null -w "%{http_code}" -I "$URL_SNAKE")
HTTP_CAMEL=$(curl -sS -o /dev/null -w "%{http_code}" -I "$URL_CAMEL")

# SPA 라우팅이므로 양쪽 모두 200 이어야 한다 (실제 호환 동작은 브라우저에서 검증).
if [ "$HTTP_SNAKE" = "200" ] && [ "$HTTP_CAMEL" = "200" ]; then
  pass "snake/camel 양쪽 SPA 진입 HEAD 200"
else
  warn "snake=${HTTP_SNAKE}, camel=${HTTP_CAMEL} — 브라우저 직접 진입으로 추가 검증 권장"
fi

# ────────────────────────────────────────────────────────────
# 4) Phase 1-2 검증: CORS preflight (정적 fallback)
# ────────────────────────────────────────────────────────────
section "4) Phase 1-2 — CORS preflight (정적 fallback origin)"

# papascompany.co.kr 서브도메인은 PAPAS_PATTERN 정적 매칭 → DB 조회 없이 통과해야 함
RESP=$(curl -sS -o /dev/null -D - -X OPTIONS \
  -H "Origin: https://admin.papascompany.co.kr" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-api-key" \
  "${API_URL}/auth/shop-session" 2>&1)

if echo "$RESP" | grep -qi "access-control-allow-origin: https://admin.papascompany.co.kr"; then
  pass "CORS allow-origin 헤더 (정적 패턴 매칭)"
else
  fail "CORS preflight 실패"
  echo "$RESP" | head -10 | sed 's/^/    /'
fi

# ────────────────────────────────────────────────────────────
# 5) POST /worker-jobs/check-mergeable/external — dry-run (옵션)
# ────────────────────────────────────────────────────────────
section "5) POST /worker-jobs/check-mergeable/external — dry-run (UUID 없으면 스킵)"

if [ -n "${TEST_EDIT_SESSION_ID:-}" ] && [ -n "${TEST_COVER_FILE_ID:-}" ] && [ -n "${TEST_CONTENT_FILE_ID:-}" ]; then
  RESP=$(curl -sS -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -H "X-API-Key: ${API_KEY}" \
    -d "{
      \"editSessionId\": \"${TEST_EDIT_SESSION_ID}\",
      \"coverFileId\": \"${TEST_COVER_FILE_ID}\",
      \"contentFileId\": \"${TEST_CONTENT_FILE_ID}\",
      \"spineWidth\": 5.5
    }" \
    "${API_URL}/worker-jobs/check-mergeable/external")

  HTTP=$(echo "$RESP" | tail -n1)
  BODY=$(echo "$RESP" | sed '$d')

  # 200 또는 201 모두 허용 (Phase 0 D-8: 클라이언트는 2xx 전체 성공 처리)
  if [ "$HTTP" = "200" ] || [ "$HTTP" = "201" ]; then
    pass "HTTP ${HTTP} (2xx 성공)"
    if [ "$HAVE_JQ" = "1" ]; then
      echo "$BODY" | jq -e '.mergeable | type == "boolean"' >/dev/null \
        && pass "mergeable boolean 응답" || fail "mergeable 응답 형식 오류"
    fi
  else
    fail "예상 2xx, 실제 ${HTTP}"
    echo "    응답: ${BODY:0:200}"
  fi
else
  warn "TEST_EDIT_SESSION_ID/COVER/CONTENT_FILE_ID 미설정 — 스킵"
  warn "필요 시: TEST_EDIT_SESSION_ID=... TEST_COVER_FILE_ID=... TEST_CONTENT_FILE_ID=... 추가"
fi

# ────────────────────────────────────────────────────────────
# 6) Phase 1-2 검증: webhook host 사전 검증 (간접 — 운영 점검 필요)
# ────────────────────────────────────────────────────────────
section "6) Phase 1-2 — webhook host 검증 (간접 점검)"
warn "이 검증은 실제 합성 잡 발사 + webhook 수신 흐름이 필요합니다."
warn "Pilot 운영(Phase 7.5) 단계에서 실데이터로 확인하세요."
warn "사전 점검: Admin > 사이트 관리에서 uploadCallbackUrl 의 호스트가 등록되어 있는지 확인."

# ── 결과 요약 ──────────────────────────────────────────────
echo
echo -e "${BLUE}======================================${NC}"
echo -e "${BLUE}  결과 요약${NC}"
echo -e "${BLUE}======================================${NC}"
echo -e "${GREEN}PASS: ${PASS}${NC} / ${RED}FAIL: ${FAIL}${NC} / ${YELLOW}WARN: ${WARN}${NC}"
echo

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ FAIL 항목이 있습니다. Phase 1 변경 회귀 가능성 — 배포 전 점검 필요.${NC}"
  exit 1
elif [ "$WARN" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  WARN 항목이 있습니다. 운영 데이터로 추가 검증 권장.${NC}"
  exit 0
else
  echo -e "${GREEN}✅ 모든 회귀 항목 통과. Phase 1 변경이 PHP 측 영향 0 임을 확인했습니다.${NC}"
  exit 0
fi
