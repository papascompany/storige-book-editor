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

# Copy Admin app
COPY apps/admin ./apps/admin

# Install dependencies
RUN pnpm install 

# Build Admin
RUN pnpm --filter @storige/admin build

# Production stage
FROM nginx:1.25-alpine

# Copy built files to nginx
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html

# Copy nginx configuration
COPY docker/admin/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
