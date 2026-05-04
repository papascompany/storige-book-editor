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

# Copy Editor app
COPY apps/editor ./apps/editor

# Install dependencies
RUN pnpm install

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
