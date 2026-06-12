# Build from the repo root so the pnpm workspace lockfile is in context:
#   docker build -f web/Dockerfile -t vaultmark .
FROM node:26-alpine AS base
RUN corepack enable pnpm

# Install dependencies (workspace-aware — lockfile lives at the repo root)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY ingest/package.json ingest/
COPY video/package.json video/
RUN pnpm install --frozen-lockfile --filter @vaultmark/web

# ─── builder: compile the Next.js standalone output ───────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app .
COPY web web
# NEXT_PUBLIC_* vars are inlined at build time
ARG NEXT_PUBLIC_VAULT_USER_ID
ENV NEXT_PUBLIC_VAULT_USER_ID=$NEXT_PUBLIC_VAULT_USER_ID
# Placeholder only — `next build` evaluates route modules, which require a
# bucket at import time. The real value comes from the runtime environment.
ENV VAULT_BUCKET=build-placeholder
RUN pnpm --filter @vaultmark/web build

# Runtime — Next.js standalone output (mirrors the workspace layout)
FROM node:26-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Pin the theme plugin directory to the bundled path rather than relying on
# the standalone server.js chdir-ing into /app/web (a Next internal).
ENV THEME_DIR=/app/web/themes

# Feature-flag defaults, baked in so `docker inspect` shows every runtime
# tunable. Values mirror DEFAULT_BY_FEATURE in web/lib/flags.ts — keep in
# sync. Override any of them with -e / env_file at runtime; off-tokens are
# off/false/0/no/disabled. See docs/feature-flags.md.
ENV FEATURE_AGENT=on \
    FEATURE_UPLOAD=off \
    FEATURE_CURATE=off \
    FEATURE_REINDEX=off \
    FEATURE_EDITOR=off \
    FEATURE_SEARCH=off \
    FEATURE_STAR=off \
    FEATURE_PUBLISHING=off

COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public
# Theme plugin directory — bake themes into the image by adding .css files
# under web/themes/ before building, or mount a volume here at runtime
# (or point THEME_DIR somewhere else). See docs/theming.md.
COPY --from=builder /app/web/themes ./web/themes

# Drop root privileges (the `node` user ships with the base image).
USER node

EXPOSE 3000

# /api/vaults answers 200 once the server is up and configured (it is a
# read path, so it works with every feature flag off).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/vaults" || exit 1

CMD ["node", "web/server.js"]
