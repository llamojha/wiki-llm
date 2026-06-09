# Vaultmark web — production image.
#
# IMPORTANT: build from the REPO ROOT, not from web/. This is a pnpm
# workspace and the lockfile lives at the root:
#
#   docker build -f web/Dockerfile -t vaultmark .
#
# Only the `web` app ships in the final image. The `ingest` and `video`
# workspace packages are excluded by .dockerignore; their package.json files
# are copied solely so `pnpm install --frozen-lockfile` can resolve the
# workspace graph.

FROM node:22-alpine AS base
RUN corepack enable pnpm

# ─── deps: install the full workspace against the root lockfile ───────────
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY web/package.json ./web/package.json
COPY ingest/package.json ./ingest/package.json
COPY video/package.json ./video/package.json
RUN pnpm install --frozen-lockfile

# ─── builder: compile the Next.js standalone output ───────────────────────
FROM base AS builder
WORKDIR /app
# Bring installed deps + the workspace manifests (web/ingest/video stubs),
# then overlay the full web source and build just the web package.
COPY --from=deps /app ./
COPY web ./web
# Build-only placeholder: lib/s3.ts fails fast at import if VAULT_BUCKET is
# unset, and `next build` evaluates route modules while collecting page data.
# This value never reaches runtime — the standalone server re-reads
# process.env at container start, where the real VAULT_BUCKET is provided.
ENV VAULT_BUCKET=build-time-placeholder
RUN pnpm --filter @vaultmark/web build

# ─── runner: minimal standalone runtime ───────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Standalone output is workspace-aware: server.js lands under web/, and the
# traced node_modules sit at the standalone root.
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

# Drop root privileges (the `node` user ships with the base image).
USER node

EXPOSE 3000
CMD ["node", "web/server.js"]
