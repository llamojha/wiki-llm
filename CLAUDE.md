# Vaultmark — Codebase Guide

This repo builds **Vaultmark**, an S3-backed Markdown knowledge portal for individuals and engineering teams.

- Product spec: [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md) — goals, scope, data model
- Engineering plan: [`ROADMAP.md`](ROADMAP.md) — phases, decisions log, sequencing
- This file: codebase operating guide

## Steering context (auto-loaded)

@.kiro/steering/architecture.md
@.kiro/steering/conventions.md
@.kiro/steering/tech-stack.md
@.kiro/steering/development-standards.md
@.kiro/steering/aws-infrastructure.md
@.kiro/steering/philosophy.md

## Current state (June 2026)

Phases 0-5 are implemented. After Phase 2 the architecture pivoted to a
**single Next.js app** — Route Handlers replaced the FastAPI backend, and
in-memory Fuse.js search replaced Postgres FTS for the MVP.

| Path | Status |
|---|---|
| `prd_vaultmark_markdown_llm_wiki.md` | Authoritative product spec |
| `web/` | **Active app** — Next.js 16.2 portal + API route handlers |
| `ingest/` | TypeScript CLI for vault init + batch ingest |
| `infra/lambda/curate/` | AI curation Lambda (deployed out-of-band) |
| `infra/k8s/`, `infra/ecs/` | Deployment manifests — see `docs/deploy/` |
| `docs/` | Configuration, feature-flag, and deployment docs |
| `api/` | **Archived** FastAPI backend from the pre-pivot shape. Reference only; may be revived for Phase 6 SaaS |
| `portal/`, `portal-archive/` | Babel-in-browser prototype — design reference, parity signed off. Do not extend |
| `legacy/` | Archived `wiki-llm` (Bedrock CLI + curated `wiki/` tree). Frozen reference. See [`legacy/README.md`](legacy/README.md) |

## Repo layout

```
wiki-llm/                  (repo root; product name is Vaultmark)
├── web/                   Next.js portal (frontend + API route handlers)
├── ingest/                TypeScript ingest CLI
├── infra/
│   ├── docker-compose.yml Local dev stack
│   ├── lambda/curate/     AI curation Lambda
│   ├── k8s/               Kubernetes manifests
│   └── ecs/               ECS Fargate task definition + IAM policy
├── docs/                  Configuration, feature flags, deployment guides
├── specs/                 Phase acceptance specs
├── api/                   Archived FastAPI backend (reference)
├── legacy/                Archived wiki.py + Bedrock pipeline (frozen reference)
└── prd_vaultmark_markdown_llm_wiki.md
```

## Stack (pinned to 2026)

**App (`web/`) — the active product**
- Next.js **16.2** (App Router, Turbopack, React Server Components)
- React **19**
- TypeScript **5.7+**, `strict: true`
- Plain CSS (ported from `portal/styles.css`). No Tailwind, no UI lib
- API: Next.js Route Handlers under `web/app/api/`
- Search: in-memory Fuse.js built from S3
- Package manager: pnpm (workspace: `web`, `ingest`, `video`)

**LLM**
- **Amazon Bedrock — Nova 2 Lite** (`amazon.nova-2-lite-v1:0`) for the ask-wiki agent and curation
- Use the cross-region inference profile (`us.`/`eu.` prefix) when the home region requires it; configured via `BEDROCK_MODEL`
- 1M token context — keep `index.md` and the active scope in the prompt; reach for full-doc reads via the agent's tools rather than dumping the vault
- Out of scope: Claude API, vector retrieval, multi-agent orchestration

**Data**
- S3 for Markdown blobs — the source of truth (decisions log: S3 only, no MinIO/R2 abstraction)
- Postgres FTS belongs to the archived `api/` shape; revisit for Phase 6 SaaS

**Archived backend (`api/`)** — Python 3.13, FastAPI 0.136+, SQLAlchemy 2.x, managed with uv. Reference only; CI still runs its tests.

## Development

```bash
pnpm install
cp infra/.env.example web/.env.local   # set VAULT_BUCKET etc.

pnpm dev          # Next.js dev server on :3000
pnpm typecheck
pnpm build        # needs VAULT_BUCKET set (placeholder ok)
pnpm ingest -- --help

# Curate Lambda
cd infra/lambda/curate && npm run build && npm test

# Local container stack
docker compose -f infra/docker-compose.yml up
```

Configuration reference: [`docs/configuration.md`](docs/configuration.md).
Deployment guides (Docker, Kubernetes, ECS Fargate): [`docs/deploy/`](docs/deploy/).

## Feature flags

Per-feature toggles live in `web/lib/flags.ts` (single source of truth, read
once from `FEATURE_*` env vars). A feature is **ON unless** its var is set to
`off`/`false`/`0`/`no`/`disabled` — absent ⇒ on, so everything ships enabled.

Each flag gates **both layers**: `FLAGS` is passed from the root server
component into the client `AppShell` (which hides the entry point), and
`flagGuard(name)` short-circuits the matching route handler (404 when off).
Hiding the button alone is not control — the route guard is the enforcement.

| Env var | Feature | Routes gated |
|---|---|---|
| `FEATURE_AGENT` | Ask-Wiki chat | `POST /api/chat` |
| `FEATURE_UPLOAD` | File upload | `POST /api/upload` |
| `FEATURE_CURATE` | AI ingest/curate | `/api/curate/*` |
| `FEATURE_REINDEX` | Re-index | `POST /api/reindex` |
| `FEATURE_EDITOR` | Page CRUD | `POST/PUT/DELETE /api/docs` |
| `FEATURE_SEARCH` | Search palette | `GET /api/search` |
| `FEATURE_STAR` | Star/favorite | `PATCH /api/star` |
| `FEATURE_PUBLISHING` | Personal site / HTML publishing | none yet (Phase 8) |

Document read paths (`GET /api/docs`, tree, raw) are never gated — the portal
stays browsable with every feature off.

Full per-flag documentation (UI surfaces, dependencies, recipes):
[`docs/feature-flags.md`](docs/feature-flags.md).

## Conventions

- **The prototype is design reference.** Parity with `portal/` is signed off; consult it for design intent but don't extend it or import from it.
- **Markdown is the source of truth.** Document content lives in S3 as `.md` files. Search indexes and metadata stores are never authoritative content.
- **Sanitize all rendered Markdown.** Use a vetted pipeline (e.g. `remark` + `rehype-sanitize`) on the server. Never `dangerouslySetInnerHTML` raw user content.
- **Server Components by default.** Use Client Components only where interactivity demands it (sidebar tree, search palette, editor, chat panel).
- **One vault, one bucket, one prefix.** The `vault_id → (bucket, prefix)` mapping is the boundary between user content and infra. Code should never assume a global bucket.
- **No mock fallbacks in production paths.** Mock data belongs under `web/lib/mock/` and is only imported in dev/storybook contexts.
- **Frontmatter is canonical metadata.** When a doc's frontmatter and the DB row disagree, frontmatter wins; reindex.

## Vault content vs codebase

PRD §12 lists `AGENTS.md`, `WIKI_RULES.md`, `INDEX.md`, `LOG.md`, `SOURCES.md`, `TASKS.md` — **these live inside a user's vault** (S3), not in this repo. They are content the portal renders and that future agents read. Do not put them at the repo root.

(The previous root-level `AGENTS.md` was wiki-llm's vault-maintainer schema and now lives under `legacy/`.)

## Operating notes for Claude

- Confirm before large structural moves (deleting `portal/` or `api/`, restructuring `infra/`). Reversible local edits are fine without confirmation.
- **No deployment-specific values in the repo.** Account IDs, personal bucket names, and user ids stay in env vars — the repo is public.
- Don't revive the Bedrock pipeline unprompted. `legacy/` is frozen reference; reach into it only when explicitly porting code out, and prefer rewriting against the new architecture over importing from it.
- When a PRD open question (§16) blocks a decision, surface it rather than guessing.
- Prefer editing existing files over creating new ones. The prototype already encodes most product decisions — read it before re-deriving.
