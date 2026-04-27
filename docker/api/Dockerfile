# Build stage
FROM node:20-alpine AS builder

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
FROM node:20-alpine

WORKDIR /app

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
