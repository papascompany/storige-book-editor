#!/usr/bin/env bash
# ==========================================================================
# Sentry 활성화 스크립트 — DSN 4개를 받아 VPS + Vercel 환경변수 등록 + 재배포
#
# 사용법:
#   export SENTRY_DSN_API='https://...@o0.ingest.us.sentry.io/0'
#   export SENTRY_DSN_WORKER='https://...@o0.ingest.us.sentry.io/0'
#   export SENTRY_DSN_EDITOR='https://...@o0.ingest.us.sentry.io/0'
#   export SENTRY_DSN_ADMIN='https://...@o0.ingest.us.sentry.io/0'
#   ./scripts/activate-sentry.sh
#
# 또는 한 줄로:
#   SENTRY_DSN_API=... SENTRY_DSN_WORKER=... SENTRY_DSN_EDITOR=... SENTRY_DSN_ADMIN=... ./scripts/activate-sentry.sh
#
# ==========================================================================
set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

VPS="deploy@158.247.235.202"
SENTRY_ENV="${SENTRY_ENVIRONMENT:-production}"
SENTRY_RATE="${SENTRY_TRACES_SAMPLE_RATE:-0.1}"

# ─── 입력 검증 ───────────────────────────────────────────
echo -e "${BLUE}=== Sentry 활성화 시작 ===${NC}"
[ -z "$SENTRY_DSN_API" ]    && echo -e "${RED}❌ SENTRY_DSN_API 미설정${NC}" && exit 1
[ -z "$SENTRY_DSN_WORKER" ] && echo -e "${RED}❌ SENTRY_DSN_WORKER 미설정${NC}" && exit 1
[ -z "$SENTRY_DSN_EDITOR" ] && echo -e "${RED}❌ SENTRY_DSN_EDITOR 미설정${NC}" && exit 1
[ -z "$SENTRY_DSN_ADMIN" ]  && echo -e "${RED}❌ SENTRY_DSN_ADMIN 미설정${NC}" && exit 1

echo -e "${GREEN}✓ 4개 DSN 입력 확인${NC}"

# ─── 1. VPS .env 갱신 ──────────────────────────────────────
echo -e "\n${BLUE}[1/5] VPS .env 갱신...${NC}"
ssh "$VPS" "cd ~/storige && \
  # 기존 SENTRY 라인 제거 후 추가 (멱등성)
  sed -i '/^SENTRY_/d' .env && \
  cat >> .env <<EOF

# Sentry (활성화: $(date -u +%FT%TZ))
SENTRY_DSN_API=$SENTRY_DSN_API
SENTRY_DSN_WORKER=$SENTRY_DSN_WORKER
SENTRY_ENVIRONMENT=$SENTRY_ENV
SENTRY_TRACES_SAMPLE_RATE=$SENTRY_RATE
EOF
  echo '✓ VPS .env 갱신 완료'
  grep -E '^SENTRY_' .env | sed 's|=.*|=***|' "
echo -e "${GREEN}✓ VPS env 등록 완료${NC}"

# ─── 2. Vercel admin env ──────────────────────────────────
echo -e "\n${BLUE}[2/5] Vercel admin env 등록...${NC}"
TMPDIR=$(mktemp -d)
cd "$TMPDIR"
vercel link --project storige-admin --yes >/dev/null 2>&1

# 기존 값 제거 후 추가 (멱등성)
for KEY in VITE_SENTRY_DSN VITE_SENTRY_ENVIRONMENT VITE_SENTRY_TRACES_SAMPLE_RATE; do
  vercel env rm "$KEY" production --yes >/dev/null 2>&1 || true
done

echo "$SENTRY_DSN_ADMIN" | vercel env add VITE_SENTRY_DSN production
echo "$SENTRY_ENV"        | vercel env add VITE_SENTRY_ENVIRONMENT production
echo "$SENTRY_RATE"       | vercel env add VITE_SENTRY_TRACES_SAMPLE_RATE production
echo -e "${GREEN}✓ Vercel admin env 등록 완료${NC}"

# ─── 3. Vercel editor env ─────────────────────────────────
echo -e "\n${BLUE}[3/5] Vercel editor env 등록...${NC}"
rm -rf .vercel
vercel link --project storige-editor --yes >/dev/null 2>&1

for KEY in VITE_SENTRY_DSN VITE_SENTRY_ENVIRONMENT VITE_SENTRY_TRACES_SAMPLE_RATE; do
  vercel env rm "$KEY" production --yes >/dev/null 2>&1 || true
done

echo "$SENTRY_DSN_EDITOR" | vercel env add VITE_SENTRY_DSN production
echo "$SENTRY_ENV"         | vercel env add VITE_SENTRY_ENVIRONMENT production
echo "$SENTRY_RATE"        | vercel env add VITE_SENTRY_TRACES_SAMPLE_RATE production
echo -e "${GREEN}✓ Vercel editor env 등록 완료${NC}"

# ─── 4. VPS api/worker 재기동 ─────────────────────────────
echo -e "\n${BLUE}[4/5] VPS API + Worker 재기동...${NC}"
ssh "$VPS" "cd ~/storige && docker compose up -d --force-recreate api worker 2>&1 | tail -5"
sleep 5
ssh "$VPS" "docker logs --tail 20 storige-api 2>&1 | grep -i Sentry | head -3 && \
            docker logs --tail 20 storige-worker 2>&1 | grep -i Sentry | head -3"
echo -e "${GREEN}✓ VPS Sentry init 로그 확인${NC}"

# ─── 5. Vercel admin/editor 재배포 ────────────────────────
echo -e "\n${BLUE}[5/5] Vercel admin + editor 재배포 트리거...${NC}"
cd "$(dirname "$(readlink -f "$0")")/.."
git commit --allow-empty -m "chore: trigger rebuild after Sentry DSN registration

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin master

echo -e "\n${GREEN}=== ✅ Sentry 활성화 완료 ===${NC}"
echo -e "${YELLOW}다음 확인:${NC}"
echo "  1. VPS 로그: ssh $VPS 'docker logs storige-api | grep Sentry'"
echo "  2. Vercel 빌드: vercel list storige-admin"
echo "  3. Sentry 대시보드에서 'Initialization' 이벤트 확인"
echo "  4. 의도적 에러로 smoke test:"
echo "     curl https://api.papascompany.co.kr/api/sentry-test (없는 라우트라 NotFound — 자동 필터링됨)"
echo "     브라우저 콘솔: throw new Error('Sentry test')"

cd / && rm -rf "$TMPDIR"
