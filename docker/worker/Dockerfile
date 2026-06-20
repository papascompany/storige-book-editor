# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for canvas
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy Worker app
COPY apps/worker ./apps/worker

# Install dependencies
RUN pnpm install 

# Build packages first
RUN pnpm --filter @storige/types build || true

# Build Worker
RUN pnpm --filter @storige/worker build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Install system dependencies for PDF processing
# 트랙 B-(d): qpdf(경량 메타·손상검증), poppler-utils(pdfinfo 폴백 — qpdf --json 치수
#   추출 실패 시에만 사용). 둘 다 상수메모리 검증 ON 경로 전제 도구.
RUN apk add --no-cache \
    ghostscript \
    imagemagick \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg \
    qpdf \
    poppler-utils

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages (소스)
COPY packages ./packages

# Copy built workspace packages from builder
# (@storige/types 등 — production stage에는 tsc가 없으므로 dist를 builder에서 가져옴)
COPY --from=builder /app/packages/types/dist ./packages/types/dist

# Copy built Worker
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/

# Install production dependencies (canvas는 native 컴파일 필요 → 빌드 도구 임시 설치 후 삭제)
RUN apk add --no-cache --virtual .build-deps \
    python3 make g++ \
    cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev pixman-dev \
 && pnpm install --prod \
 && apk del .build-deps

# Create storage directory
RUN mkdir -p /app/storage

# Expose port
EXPOSE 4001

# Start Worker service
CMD ["node", "apps/worker/dist/main.js"]
