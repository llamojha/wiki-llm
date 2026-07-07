# Build from the repo root so the pnpm workspace lockfile is in context:
#   docker build -f web/Dockerfile -t canopy .
FROM node:26-alpine AS base
# Node 26 no longer bundles corepack, so install the pinned pnpm directly.
# Keep this version in sync with `packageManager` in the root package.json.
RUN npm install -g pnpm@10.5.0

# Install dependencies (workspace-aware — lockfile lives at the repo root)
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json web/
COPY ingest/package.json ingest/
COPY video/package.json video/
COPY site/package.json site/
RUN pnpm install --frozen-lockfile --filter @canopy/web

# ─── builder: compile the Next.js standalone output ───────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app .
COPY web web
# NEXT_PUBLIC_* vars are inlined at build time
ARG NEXT_PUBLIC_VAULT_USER_ID
ENV NEXT_PUBLIC_VAULT_USER_ID=$NEXT_PUBLIC_VAULT_USER_ID
# Optional sub-path the portal is served under in a shared cluster (e.g.
# "/wiki"). `basePath` is build-time in Next.js, so CI must pass this build-arg
# to the builder for a prefixed image. Leave empty to serve at the root.
# Use a leading-slash, no-trailing-slash value (e.g. "/wiki"). See
# web/next.config.ts.
ARG NEXT_BASE_PATH=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
# Placeholder only — `next build` evaluates route modules, which require a
# bucket at import time. The real value comes from the runtime environment.
ENV VAULT_BUCKET=build-placeholder
RUN pnpm --filter @canopy/web build

# Runtime — Next.js standalone output (mirrors the workspace layout)
FROM node:26-alpine AS runner
WORKDIR /app
# Patch OS packages that lag the node:26-alpine base — clears the openssl
# (libcrypto3/libssl3) HIGH advisories the Trivy gate flags until the base
# image catches up. Keep until node:26-alpine ships the fixed alpine release.
RUN apk upgrade --no-cache libcrypto3 libssl3
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Base path the app was built with. Build args don't cross stages, so this is
# re-declared here purely so the healthcheck can target the right path; a
# single `--build-arg NEXT_BASE_PATH=/wiki` applies to every stage that
# declares it. This does NOT change the served path (that's baked at build).
ARG NEXT_BASE_PATH=""
ENV NEXT_BASE_PATH=$NEXT_BASE_PATH
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

# /api/health is deliberately unauthenticated (exempt from the AUTH_MODE=oidc
# gate) and minimal, so the probe works regardless of auth mode or feature
# flags. NEXT_BASE_PATH prefixes the route when the image is built for a
# sub-path (e.g. /wiki/api/health).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}${NEXT_BASE_PATH}/api/health" || exit 1

CMD ["node", "web/server.js"]
