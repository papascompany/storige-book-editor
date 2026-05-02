# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> ## 🔒 Operational Memory (Local-Only)
>
> **At session start, also read `CLAUDE.local.md`** in the project root if it exists.
> It contains operational context that must NOT be committed to git:
> - VPS SSH details (`deploy@158.247.235.202`)
> - Vercel CLI account / projects
> - Production domains and Docker service map
> - Common deployment recipes (worker-only redeploy, log inspection, DB queries)
> - Active MCP servers / plugins in use
>
> **First-action checklist for new sessions** (before any SSH call):
> ```bash
> ssh-add -l 2>&1 | head -1
> # If "The agent has no identities." → run: ssh-add ~/.ssh/id_ed25519
> ```
>
> ⚠️ Never attempt SSH with arbitrary usernames (`root`, `ubuntu`, etc.) — fail2ban will ban this Mac's IP.
> Always use exactly `ssh deploy@158.247.235.202`.

## Project Overview

Storige is a print shopping mall system with an online editor for creating print products. It consists of a React-based canvas editor (using Fabric.js), NestJS REST API, and a PDF processing worker service.

## Common Commands

```bash
# Install dependencies
pnpm install

# Development - run all services
pnpm dev

# Development - run specific apps
pnpm --filter @storige/editor dev     # Editor on :3000
pnpm --filter @storige/admin dev      # Admin on :3001
pnpm --filter @storige/api dev        # API on :4000
pnpm --filter @storige/worker dev     # Worker on :4001

# Build
pnpm build                            # Build all
pnpm --filter @storige/api build      # Build specific app
pnpm --filter @storige/types build    # Build types package (required first)

# Lint and test
pnpm lint
pnpm test
pnpm --filter @storige/api test       # Test specific app

# Docker deployment
docker-compose up -d
docker-compose logs -f
```

## Architecture

### Monorepo Structure (pnpm + Turborepo)

- **apps/editor**: React customer-facing canvas editor (Vite + Fabric.js + Zustand + TailwindCSS)
- **apps/admin**: React admin dashboard for template management (Vite + Ant Design + React Query)
- **apps/api**: NestJS REST API (TypeORM + MySQL/MariaDB + JWT auth)
- **apps/worker**: NestJS PDF processing worker (Bull queue + pdf-lib + Sharp + Ghostscript)
- **packages/types**: Shared TypeScript type definitions (must be built before other packages)
- **packages/canvas-core**: Fabric.js wrapper with plugin system for the editor
- **packages/ui**: Shared React UI components

### Key Architectural Patterns

**Canvas Editor Plugin System** (`packages/canvas-core/src/Editor.ts`):
- Plugin-based architecture for editor features (text, image, shape, selection)
- Plugins implement `Plugin` interface and are registered via `editor.use(plugin)`
- Built-in undo/redo history management with configurable max size

**API Module Structure** (`apps/api/src/`):
- Standard NestJS module pattern: `*.module.ts`, `*.controller.ts`, `*.service.ts`
- Entities in `entities/` subdirectories, DTOs in `dto/` subdirectories
- JWT authentication with role-based guards (`@Roles()` decorator)

**Worker Queue Processing** (`apps/worker/src/`):
- Bull queue processors in `processors/` directory
- Three job types: validation, conversion, synthesis
- Services in `services/` handle actual PDF operations

### Data Flow

1. Editor saves canvas data via API to `edit_sessions` table
2. On completion, API creates worker jobs in `worker_jobs` table and Bull queue
3. Worker processes PDF jobs (validate -> convert -> synthesize)
4. Worker updates job status via API callback

### Infrastructure

- **Database**: MariaDB 11.2 (TypeORM with synchronize in dev)
- **Queue**: Redis 7.2 (Bull for job processing)
- **File Storage**: Local filesystem at `/app/storage` (mapped via Docker volume)
- **Reverse Proxy**: Nginx for production routing

### Package Dependencies

`@storige/types` must be built before other packages that depend on it:
```bash
pnpm --filter @storige/types build
```

The editor app depends on both `@storige/types` and `@storige/canvas-core`.
