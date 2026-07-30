# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy API app
COPY apps/api ./apps/api

# Install dependencies
RUN pnpm install

# Build packages first
RUN pnpm --filter @storige/types build || true

# Build API
RUN pnpm --filter @storige/api build

# Production stage
FROM node:22-alpine

WORKDIR /app

# PDF 썸네일 래스터화용 Ghostscript.
# 이 이미지에는 apk 설치가 하나도 없었고 compose api 서비스에도 GHOSTSCRIPT_PATH 매핑이 없어서
# `GET /files/:id/thumbnail`(파트너 대외 계약 라우트, PLATFORM_INTEGRATION_GUIDE 등재)이
# 프로덕션에서 상시 실패했다 — FilesService 의 기본값 'gs' 가 PATH 에 없어 ENOENT 로 떨어지고
# THUMBNAIL_GENERATION_FAILED(400) 로 변환된다. 2026-07-30 `docker exec storige-api which gs` 로 확정.
# worker 이미지처럼 imagemagick/qpdf 까지 넣지 않는다 — api 는 GS 래스터화 한 가지만 쓴다.
RUN apk add --no-cache ghostscript

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

# Copy built API
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Install production dependencies only
RUN pnpm install --prod

# Create storage directory
RUN mkdir -p /app/storage

# Expose port
EXPOSE 4000

# Start API server
CMD ["node", "apps/api/dist/main.js"]
