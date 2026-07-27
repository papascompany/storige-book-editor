#!/bin/bash
# ===========================================
# Storige Platform - Development Server Deploy Script
# Ubuntu + PM2
# ===========================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN} Storige Platform - Deploy Script${NC}"
echo -e "${GREEN}============================================${NC}"

# Get project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

echo -e "${YELLOW}Project root: $PROJECT_ROOT${NC}"

# ===========================================
# 1. Clean previous builds
# ===========================================
echo -e "\n${GREEN}[1/8] Cleaning previous builds...${NC}"
rm -rf packages/types/dist
rm -rf packages/canvas-core/dist
rm -rf apps/api/dist
rm -rf apps/worker/dist
rm -rf apps/editor/dist
rm -rf apps/editor/dist-embed
rm -rf apps/admin/dist
rm -rf node_modules/.cache
echo "  - Cleaned all dist directories and cache"

# ===========================================
# 2. Install dependencies
# ===========================================
echo -e "\n${GREEN}[2/8] Installing dependencies...${NC}"
pnpm install

# ===========================================
# 3. Build shared packages first
# ===========================================
echo -e "\n${GREEN}[3/8] Building shared packages...${NC}"
echo "  - Building types..."
pnpm --filter @storige/types build

echo "  - Building canvas-core..."
pnpm --filter @storige/canvas-core build

# ===========================================
# 4. Build all applications
# ===========================================
echo -e "\n${GREEN}[4/8] Building applications...${NC}"

echo "  - Building API..."
pnpm --filter @storige/api build

echo "  - Building Worker..."
pnpm --filter @storige/worker build

echo "  - Building Editor..."
pnpm --filter @storige/editor build

echo "  - Building Editor Embed Bundle..."
pnpm --filter @storige/editor build:embed

echo "  - Building Admin..."
pnpm --filter @storige/admin build

# ===========================================
# 5. Verify builds
# ===========================================
echo -e "\n${GREEN}[5/8] Verifying builds...${NC}"
MISSING_BUILDS=0
[ ! -d "packages/types/dist" ] && echo "  - ERROR: types dist missing" && MISSING_BUILDS=1
[ ! -d "packages/canvas-core/dist" ] && echo "  - ERROR: canvas-core dist missing" && MISSING_BUILDS=1
[ ! -d "apps/api/dist" ] && echo "  - ERROR: api dist missing" && MISSING_BUILDS=1
[ ! -d "apps/worker/dist" ] && echo "  - ERROR: worker dist missing" && MISSING_BUILDS=1
[ ! -d "apps/editor/dist" ] && echo "  - ERROR: editor dist missing" && MISSING_BUILDS=1
[ ! -d "apps/editor/dist-embed" ] && echo "  - ERROR: editor embed dist missing" && MISSING_BUILDS=1
[ ! -d "apps/admin/dist" ] && echo "  - ERROR: admin dist missing" && MISSING_BUILDS=1
if [ $MISSING_BUILDS -eq 1 ]; then
    echo -e "${RED}  Build verification failed. Aborting deployment.${NC}"
    exit 1
fi
echo "  - All builds verified successfully"

# ===========================================
# 6. Create logs directory & Storage
# ===========================================
echo -e "\n${GREEN}[6/8] Setting up directories...${NC}"
mkdir -p logs
mkdir -p apps/api/storage
echo "  - Created logs and storage directories"

# ===========================================
# 7. Copy editor embed bundle to bookmoa
# ===========================================
echo -e "\n${GREEN}[7/8] Copying editor embed bundle to bookmoa...${NC}"

# bookmoa 경로 설정
# 서버 환경: /var/www/html/front (bookmoa front 경로)
# 로컬 환경: ../bookmoa (storige와 같은 레벨)
if [ -d "/var/www/html/front" ]; then
    DEFAULT_BOOKMOA_PATH="/var/www/html/front"
else
    DEFAULT_BOOKMOA_PATH="../bookmoa"
fi
BOOKMOA_PATH="${BOOKMOA_PATH:-$DEFAULT_BOOKMOA_PATH}"
BOOKMOA_EMBED_PATH="$BOOKMOA_PATH/storige-embed"

if [ -d "$BOOKMOA_PATH" ]; then
    echo "  - bookmoa path: $BOOKMOA_PATH"
    mkdir -p "$BOOKMOA_EMBED_PATH"

    # 기존 파일 백업 (선택적)
    if [ -f "$BOOKMOA_EMBED_PATH/editor-bundle.iife.js" ]; then
        BACKUP_DATE=$(date +%Y%m%d_%H%M%S)
        echo "  - Backing up existing bundle to editor-bundle.iife.js.bak.$BACKUP_DATE"
        cp "$BOOKMOA_EMBED_PATH/editor-bundle.iife.js" "$BOOKMOA_EMBED_PATH/editor-bundle.iife.js.bak.$BACKUP_DATE"
    fi

    # 새 번들 복사
    cp apps/editor/dist-embed/editor-bundle.iife.js "$BOOKMOA_EMBED_PATH/"
    cp apps/editor/dist-embed/editor-bundle.css "$BOOKMOA_EMBED_PATH/"

    # sourcemap 은 복사하지 않는다 (source-exposure, 2026-07-27).
    # 종전 주석은 '개발 환경에서만'이었지만 실제 조건이 파일 존재(-f)뿐이라 프로덕션에도 항상
    # 복사됐다 — 파트너 서버에 원본 전문(sourcesContent)이 그대로 공개되는 경로였다.
    # 임베드 번들 디버깅이 필요하면 COPY_EMBED_SOURCEMAP=1 로 명시 opt-in.
    if [ "${COPY_EMBED_SOURCEMAP:-0}" = "1" ] && [ -f "apps/editor/dist-embed/editor-bundle.iife.js.map" ]; then
        echo -e "  ${YELLOW}⚠ COPY_EMBED_SOURCEMAP=1 — 소스맵을 함께 복사한다(외부 공개 주의)${NC}"
        cp apps/editor/dist-embed/editor-bundle.iife.js.map "$BOOKMOA_EMBED_PATH/"
    else
        # 과거 배포로 남아 있을 수 있는 맵 정리
        rm -f "$BOOKMOA_EMBED_PATH/editor-bundle.iife.js.map"
    fi

    echo -e "  ${GREEN}✓ Editor bundle copied to $BOOKMOA_EMBED_PATH${NC}"
    ls -lh "$BOOKMOA_EMBED_PATH"/editor-bundle.* | awk '{print "    - " $9 " (" $5 ")"}'
else
    echo -e "${YELLOW}  - Warning: bookmoa directory not found at $BOOKMOA_PATH${NC}"
    echo -e "${YELLOW}  - Set BOOKMOA_PATH environment variable to specify bookmoa location${NC}"
fi

# ===========================================
# 8. Start/Restart PM2 processes
# ===========================================
echo -e "\n${GREEN}[8/8] Starting PM2 processes...${NC}"

# Install serve globally if not exists
if ! command -v serve &> /dev/null; then
    echo "  - Installing 'serve' package..."
    npm install -g serve
fi

# Stop all existing processes (ignore errors if not running)
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true

# Start all processes
pm2 start ecosystem.config.js

# Save PM2 process list (for auto-restart on reboot)
pm2 save

# ===========================================
# Done
# ===========================================
echo -e "\n${GREEN}============================================${NC}"
echo -e "${GREEN} Deployment Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Services running:"
echo "  - API:    http://localhost:4000"
echo "  - Editor: http://localhost:3000"
echo "  - Admin:  http://localhost:3001"
echo "  - Worker: http://localhost:4001"
echo ""
echo "PM2 Commands:"
echo "  pm2 status           - Check process status"
echo "  pm2 logs             - View all logs"
echo "  pm2 logs storige-api - View API logs"
echo "  pm2 restart all      - Restart all processes"
echo "  pm2 stop all         - Stop all processes"
echo ""
pm2 status
