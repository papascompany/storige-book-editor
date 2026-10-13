# 베이스 이미지 고정. 태그만 쓰면 빌드 호스트에 캐시돼 있던 이미지가 그대로 쓰여 빌드마다 Node·Alpine 이 달라질 수 있다.
# 갱신: `docker buildx imagetools inspect node:24-alpine` 의 index Digest 로 바꾸고 api·worker 를 함께 재빌드한다.
# (2026-09-17 게시본: Node 24.21.0, alpine 3.24)
ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# Build stage
FROM ${NODE_IMAGE} AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@9.15.0

# Copy workspace files
# .pnpmfile.cjs 는 lockfile 의 pnpmfileChecksum 과 맞아야 --frozen-lockfile 설치가 통과한다.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY turbo.json ./

# api 가 쓰는 워크스페이스 패키지만 복사한다(@storige/types).
COPY packages/types ./packages/types

# Copy API app
COPY apps/api ./apps/api

# Install dependencies — api 와 그 워크스페이스 의존만
# --ignore-scripts: 설치 시점 스크립트를 실행하지 않는다(네이티브 모듈은 패키지에 든 prebuild 를 쓴다).
RUN pnpm install --frozen-lockfile --filter @storige/api... --ignore-scripts

# Build packages first (실패를 숨기지 않는다)
RUN pnpm --filter @storige/types build

# Build API
RUN pnpm --filter @storige/api build

# Production stage
FROM ${NODE_IMAGE}

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
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY turbo.json ./

# 런타임에 필요한 워크스페이스 패키지 = @storige/types(package.json + builder 의 빌드 산출물)
# production stage 에는 tsc 가 없으므로 dist 를 builder 에서 가져온다.
COPY packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist

# Copy built API
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/

# Install production dependencies only — api 와 그 워크스페이스 의존만(다른 packages/* 의 의존은 싣지 않는다)
RUN pnpm install --prod --frozen-lockfile --filter @storige/api... --ignore-scripts

# Create storage directory
RUN mkdir -p /app/storage

# Expose port
EXPOSE 4000

# Start API server
CMD ["node", "apps/api/dist/main.js"]
