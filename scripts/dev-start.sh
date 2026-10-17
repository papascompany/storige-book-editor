#!/bin/bash

# ===========================================
# Local Development Startup Script
# ===========================================

set -e

echo "🚀 Starting Storige Development Environment"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Check if .env exists
if [ ! -f .env ]; then
    print_info "Creating .env file from .env.example..."
    cp .env.example .env
    print_success ".env file created"
    echo ""
    echo "⚠️  Please edit .env file with your configuration before continuing"
    echo "   Press any key to continue..."
    read -n 1
fi

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Please install it first:"
    echo "   npm install -g pnpm"
    exit 1
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

print_success "Prerequisites check passed"
echo ""

# Install dependencies
print_info "Installing dependencies..."
pnpm install
print_success "Dependencies installed"
echo ""

# Start infrastructure (MariaDB + Redis)
print_info "Starting infrastructure services (MariaDB + Redis)..."
docker-compose up -d mariadb redis
print_success "Infrastructure services started"
echo ""

# Wait for MariaDB to be ready
print_info "Waiting for MariaDB to be ready..."
for i in {1..30}; do
    if docker-compose exec -T mariadb mariadb-admin ping -h localhost > /dev/null 2>&1; then
        break
    fi
    sleep 1
    echo -n "."
done
echo ""
print_success "MariaDB is ready"
echo ""

# Wait for Redis to be ready
print_info "Waiting for Redis to be ready..."
for i in {1..30}; do
    if docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; then
        break
    fi
    sleep 1
    echo -n "."
done
echo ""
print_success "Redis is ready"
echo ""

# Run database migrations (if needed)
# print_info "Running database migrations..."
# cd apps/api && pnpm migration:run && cd ../..
# print_success "Database migrations completed"
# echo ""

echo "✅ Development environment is ready!"
echo ""
echo "📝 Next steps:"
echo "   1. Start API server:    cd apps/api && pnpm dev"
echo "   2. Start Worker:        cd apps/worker && pnpm dev"
echo "   3. Start Editor:        cd apps/editor && pnpm dev"
echo "   4. Start Admin:         cd apps/admin && pnpm dev"
echo ""
echo "💡 Or run all at once with: pnpm dev"
echo ""
echo "🔗 Services:"
echo "   - API:     http://localhost:4000"
echo "   - Worker:  http://localhost:4001"
echo "   - Editor:  http://localhost:3000"
echo "   - Admin:   http://localhost:3001"
echo "   - MariaDB: localhost:3306"
echo "   - Redis:   localhost:6379"
echo ""
