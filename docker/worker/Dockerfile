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

# worker 가 쓰는 워크스페이스 패키지만 복사한다(@storige/types).
COPY packages/types ./packages/types

# Copy Worker app
COPY apps/worker ./apps/worker

# Install dependencies — worker 와 그 워크스페이스 의존만
# --ignore-scripts: 설치 시점 스크립트를 실행하지 않는다(네이티브 모듈은 패키지에 든 prebuild 를 쓴다).
RUN pnpm install --frozen-lockfile --filter @storige/worker... --ignore-scripts

# Build packages first (실패를 숨기지 않는다)
RUN pnpm --filter @storige/types build

# Build Worker
RUN pnpm --filter @storige/worker build

# Production stage
FROM ${NODE_IMAGE}

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
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .pnpmfile.cjs ./
COPY turbo.json ./

# 런타임에 필요한 워크스페이스 패키지 = @storige/types(package.json + builder 의 빌드 산출물)
# production stage 에는 tsc 가 없으므로 dist 를 builder 에서 가져온다.
COPY packages/types/package.json ./packages/types/
COPY --from=builder /app/packages/types/dist ./packages/types/dist

# Copy built Worker
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/

# Install production dependencies only — worker 와 그 워크스페이스 의존만(네이티브 컴파일 대상 없음)
RUN pnpm install --prod --frozen-lockfile --filter @storige/worker... --ignore-scripts

# Create storage directory
RUN mkdir -p /app/storage

# Expose port
EXPOSE 4001

# Start Worker service
CMD ["node", "apps/worker/dist/main.js"]
