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

## Current state (May 2026)

The repo is mid-pivot from `wiki-llm` (a CLI + Bedrock wiki maintainer) to Vaultmark (a portal product).

| Path | Status |
|---|---|
| `prd_vaultmark_markdown_llm_wiki.md` | Authoritative product spec |
| `portal/` | Babel-in-browser React prototype — design reference for the Next.js port. Do not extend; port instead |
| `legacy/` | Archived `wiki-llm` (Bedrock CLI + curated `wiki/` tree). Frozen reference. See [`legacy/README.md`](legacy/README.md). Earmarked for revival as the `generated/` ingest pipeline (PRD §11) |
| `web/`, `api/`, `infra/` | Not yet created. Target layout below |
| `README.md` | Still describes wiki-llm; pending Vaultmark rewrite |

## Target architecture

```
wiki-llm/                  (repo root; product name is Vaultmark)
├── web/                   Next.js portal (frontend)
├── api/                   FastAPI backend
├── infra/
│   ├── docker-compose.yml Local dev stack (Postgres, MinIO, api, web)
│   └── eks/               Optional Kubernetes manifests
├── legacy/                Archived wiki.py + Bedrock pipeline (frozen reference)
└── prd_vaultmark_markdown_llm_wiki.md
```

## Stack (pinned to 2026)

**Frontend (`web/`)**
- Next.js **16.2** (App Router, Turbopack, React Server Components)
- React **19**
- TypeScript **5.7+**, `strict: true`
- Plain CSS — port `portal/styles.css` as-is for pixel parity. No Tailwind, no UI lib
- `next/font` for IBM Plex Sans/Serif and JetBrains Mono (replace the prototype's Google Fonts CDN link)
- Package manager: pnpm

**Backend (`api/`)**
- Python **3.13** (free-threaded build acceptable; see FastAPI 0.136 GIL notes)
- FastAPI **0.136+**
- Pydantic **2.x**
- SQLAlchemy 2.x + Alembic for migrations
- `boto3` for S3 and Bedrock (or `aioboto3` if we go async on storage)
- Ruff for lint+format, Pyright for typecheck
- Package manager: uv

**LLM**
- **Amazon Bedrock — Nova 2 Lite** (`amazon.nova-2-lite-v1:0`) for the ask-wiki agent
- Use `us.amazon.nova-2-lite-v1:0` cross-region inference profile when the home region requires it
- 1M token context — keep `index.md` and the active scope in the prompt; reach for full-doc reads via the agent's tools rather than dumping the vault
- Out of scope: Claude API, vector retrieval, multi-agent orchestration

**Data**
- Postgres **17** for metadata + full-text search (MVP 1)
- SQLite acceptable for single-user local mode
- S3 (or MinIO/R2 — open question per PRD §16) for Markdown blobs
- Search: Postgres FTS first; OpenSearch/Meilisearch only when SaaS scope demands it

**Runtime**
- Local dev: Docker Compose (Postgres + MinIO + api + web)
- Future SaaS: EKS

## Development

Commands below are the **target** shape. Most don't exist yet — flag if you reach for one and it's missing.

```bash
# Frontend
pnpm --filter web dev          # Next.js dev server on :3000
pnpm --filter web build
pnpm --filter web lint
pnpm --filter web typecheck

# Backend
uv run --project api fastapi dev   # FastAPI on :8000
uv run --project api pytest
uv run --project api ruff check
uv run --project api pyright

# Full stack
docker compose -f infra/docker-compose.yml up
```

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

## Conventions

- **Pixel parity with the prototype.** While porting `portal/` to `web/`, keep visual output identical. The prototype is the design source of truth until the port is signed off; only deviate where a Next.js idiom forces it (e.g. `<Link>` over `<a>`, `next/image` over raw `<img>`).
- **Markdown is the source of truth.** Document content lives in S3 as `.md` files. Postgres stores metadata + search index only — never authoritative content.
- **Sanitize all rendered Markdown.** Use a vetted pipeline (e.g. `remark` + `rehype-sanitize`) on the server. Never `dangerouslySetInnerHTML` raw user content.
- **Server Components by default.** Use Client Components only where interactivity demands it (sidebar tree, search palette, editor, chat panel).
- **One vault, one bucket, one prefix.** The `vault_id → (bucket, prefix)` mapping is the boundary between user content and infra. Code should never assume a global bucket.
- **No mock fallbacks in production paths.** Mock data belongs under `web/lib/mock/` and is only imported in dev/storybook contexts.
- **Frontmatter is canonical metadata.** When a doc's frontmatter and the DB row disagree, frontmatter wins; reindex.

## Vault content vs codebase

PRD §12 lists `AGENTS.md`, `WIKI_RULES.md`, `INDEX.md`, `LOG.md`, `SOURCES.md`, `TASKS.md` — **these live inside a user's vault** (S3), not in this repo. They are content the portal renders and that future agents read. Do not put them at the repo root.

(The previous root-level `AGENTS.md` was wiki-llm's vault-maintainer schema and now lives under `legacy/`.)

## Operating notes for Claude

- Confirm before large structural moves (creating `web/`, `api/`, archiving `legacy/`, deleting the prototype). Reversible local edits are fine without confirmation.
- Don't revive the Bedrock pipeline unprompted. `legacy/` is frozen reference; reach into it only when explicitly porting code out, and prefer rewriting against the new architecture over importing from it.
- When a PRD open question (§16) blocks a decision, surface it rather than guessing.
- Prefer editing existing files over creating new ones. The prototype already encodes most product decisions — read it before re-deriving.
