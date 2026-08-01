# Build stage
FROM node:24-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY turbo.json ./

# Copy packages
COPY packages ./packages

# Copy Editor app
COPY apps/editor ./apps/editor

# Copy build gate scripts — apps/editor 의 postbuild 가 ../../scripts/*.mjs 를 호출한다.
# 이게 없으면 postbuild 가 ENOENT 로 죽어 이미지 빌드가 실패하고, stale 이미지(소스맵 포함)가 계속 뜬다.
COPY scripts ./scripts

# 이 컨테이너에는 Sentry 업로드 배선이 없다(원래도 없었다) → 소스맵을 만들지도, 배포하지도 않는다.
# SOURCEMAP_STRIP=1 이 vite 를 hidden 으로 돌리고 postbuild 가 .map 을 제거한다.
# (VPS :3000 으로 원본 TS 전문이 공개 서빙되던 경로 차단 — 2026-07-27)
ENV SOURCEMAP_STRIP=1

# Install dependencies
RUN pnpm install --frozen-lockfile

# Build packages first (types -> canvas-core -> editor)
RUN pnpm --filter @storige/types build || true
RUN pnpm --filter @storige/canvas-core build || true

# Build Editor
RUN pnpm --filter @storige/editor build

# Production stage
FROM nginx:1.25-alpine

# Copy built files to nginx
COPY --from=builder /app/apps/editor/dist /usr/share/nginx/html

# Copy nginx configuration
COPY docker/editor/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
