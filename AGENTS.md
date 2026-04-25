# Vaultmark — Codebase Guide

This repo builds **Vaultmark**, an S3-backed Markdown knowledge portal for individuals and engineering teams.

- Product spec: [`prd_vaultmark_markdown_llm_wiki.md`](prd_vaultmark_markdown_llm_wiki.md) — goals, scope, data model
- Engineering plan: [`ROADMAP.md`](ROADMAP.md) — source of truth for sequencing, phase gates, and decisions
- Kiro context: [`.kiro/`](.kiro/) — steering docs, prompts, agent role notes, and older exploratory specs
- This file: operating guide for coding agents working in this repo

## Source precedence

When docs conflict, use this order:

1. User request in the current thread.
2. `ROADMAP.md` for active phase, architecture state, and locked decisions.
3. `prd_vaultmark_markdown_llm_wiki.md` for product intent and data model.
4. `.kiro/steering/*.md` for durable engineering principles.
5. `.kiro/prompts/*` as reference only.

## Current state (May 2026)

Vaultmark has pivoted from the old `wiki-llm` CLI into a portal product. The current roadmap records a post-Phase 2 architecture pivot: the active app is a **single Next.js project** with Route Handlers, S3 access, in-memory search, and a TypeScript ingest CLI. The earlier Python/FastAPI `api/` package still exists as archived/reference work and may be useful for future SaaS backend revival, but new product work should prefer the current Next.js architecture unless the user explicitly asks otherwise.

| Path | Status |
|---|---|
| `prd_vaultmark_markdown_llm_wiki.md` | Authoritative product spec |
| `ROADMAP.md` | Active engineering plan and phase contract |
| `web/` | Next.js 16.2 portal and Route Handler home for active product work |
| `ingest/` | TypeScript CLI package for Phase 3 ingest pipeline |
| `portal/` | Babel-in-browser React prototype/design reference; do not extend |
| `api/` | Archived/reference FastAPI backend from the earlier Phase 2 shape |
| `infra/`, `infra-cdk/` | Local/future infrastructure references |
| `legacy/` | Archived `wiki-llm` Bedrock pipeline; frozen reference for ingest ideas |
| `.kiro/steering/` | Vaultmark-specific principles, stack, conventions, and AWS notes |

## Product principles

- **Markdown first.** Markdown files in S3 are the canonical content. Postgres or in-memory indexes are metadata/search only and never authoritative content.
- **S3 as durable store.** One vault maps to one bucket plus one prefix. Code should never assume a global bucket unless explicitly using the local single-user default.
- **Frontmatter wins.** When frontmatter and a metadata/index row disagree, frontmatter is canonical; reindex from it.
- **Build the active phase.** Avoid feature creep beyond the current `ROADMAP.md` phase. Each phase should be independently deliverable and testable.
- **User-confirmed writes.** Agents may propose content changes, but every content write must be explicitly approved by the user. No autonomous writes.
- **Reliability over cleverness.** Prefer direct, readable implementation, explicit errors, and small vertical slices.

## Current architecture

```text
Browser
  -> web/ (Next.js App Router, RSC, Client Components where needed)
  -> web/app/api/* Route Handlers
  -> S3 for Markdown blobs
  -> in-memory/Fuse search for demo and MVP flow
  -> Bedrock Nova 2 Lite for ingest and ask-wiki phases
```

Earlier architecture docs in `.kiro/steering/architecture.md` describe a separate FastAPI/Postgres backend. Keep those ideas in mind for Phase 6/SaaS, but `ROADMAP.md` says the current deployable app is Next.js-only.

### S3 layout

```text
s3://<bucket>/<vault-prefix>/
  raw/          # source documents, immutable inputs
  wiki/         # user-authored or uploaded pages
  generated/    # AI-generated pages from ingest
  assets/       # images and binary assets
  index.md      # mandatory machine-maintained catalog
  log.md        # mandatory append-only history
```

`source_type` metadata distinguishes `authored | uploaded | generated`.

## Stack

**Frontend / active app (`web/`)**
- Next.js **16.2**, App Router, Turbopack, React Server Components
- React **19**
- TypeScript **5.7+**, `strict: true`
- Plain CSS only; preserve prototype parity while porting. No Tailwind and no UI library.
- `next/font` for IBM Plex Sans, IBM Plex Serif, and JetBrains Mono
- Markdown rendering through `remark` + `rehype-sanitize`
- Package manager: pnpm

**Ingest (`ingest/`)**
- TypeScript CLI in the pnpm workspace
- AWS SDK v3 for S3 and Bedrock
- Bedrock model pinned to `amazon.nova-2-lite-v1:0`

**Archived backend (`api/`)**
- Python 3.13, FastAPI 0.136+, Pydantic 2.x, SQLAlchemy/Alembic, Ruff, Pyright, uv
- Treat as reference unless a task explicitly targets it.

**LLM**
- Amazon Bedrock Nova 2 Lite: `amazon.nova-2-lite-v1:0`
- Use `us.amazon.nova-2-lite-v1:0` cross-region inference profile when the home region requires it
- Keep `index.md` and active scope in context; use tools/full-doc reads instead of dumping the vault
- Out of scope: Codex API, vector retrieval, autonomous writes, multi-agent orchestration

**AWS local defaults from Kiro steering**
- `VAULT_BUCKET=<your-bucket>`
- `VAULT_PREFIX=<your-prefix, may be empty>`
- `VAULT_REGION=<aws-region>`
- Never hardcode secrets or credentials; use environment variables and least-privilege IAM.

## Development commands

```bash
# Workspace / active app
pnpm dev
pnpm build
pnpm typecheck

# Ingest CLI
pnpm ingest
pnpm --filter @vaultmark/ingest typecheck
pnpm --filter @vaultmark/ingest build

# Prototype parity checks
pnpm parity
pnpm visual

# Archived FastAPI reference, only when working in api/
uv run --project api pytest
uv run --project api ruff check
uv run --project api pyright
```

Flag missing or stale commands when encountered. For example, the root `lint` script currently targets `@vaultmark/web lint`, but `web/package.json` does not define a `lint` script.

## Conventions

- **Pixel parity with `portal/`.** While porting prototype surfaces to `web/`, keep visual output identical. Deviate only where a Next.js idiom forces it. Use parity scripts and visual checks when changing ported UI.
- **Server Components by default.** Add `'use client'` only for state, effects, browser APIs, event handlers, or interactive panels.
- **Sanitize rendered Markdown.** Never render raw user Markdown through unsanitized `dangerouslySetInnerHTML`.
- **No production mock fallbacks.** Mock data belongs under `web/lib/mock/` and only in dev/parity contexts.
- **No production imports from `portal/` or `legacy/`.** Port or rewrite instead of importing archived/prototype code.
- **S3 keys.** Use lowercase keys with `/` separators. Avoid spaces and special characters.
- **Naming.** Source files use kebab-case; React components use PascalCase; Python uses snake_case for modules/functions and PascalCase for classes.
- **Errors.** Surface problems clearly. Handle S3 `NoSuchKey` and checksum/precondition conflicts explicitly.
- **No duplicate cleanup files.** Do not create `_fixed`, `_clean`, `_backup`, or similar copies. Edit the existing files.

## Phase notes

- Phase 0 is complete: pnpm workspace, Next.js app skeleton, fonts, globals, README, roadmap.
- Phase 1 is the visual port from `portal/` with mock data and parity validation.
- Phase 2 real read path is marked complete in `ROADMAP.md`, but its implementation drifted from separate FastAPI/Postgres to Next.js Route Handlers and in-memory search.
- Phase 3 is the TypeScript ingest pipeline: read `raw/`, generate pages under `generated/`, regenerate `index.md`, append `log.md`, and initialize vault AI context files.
- Phase 4 adds personal wiki CRUD with checksum-based S3 writes, real editor wiring, deep links, starred docs, `index.md` regeneration, and mock removal from production paths.
- Phase 5 adds the ask-wiki agent through Bedrock Nova 2 Lite with search/read/propose tools, citations, refusals on no relevant hits, and user-confirmed page proposals.
- Phase 6/SaaS and Phase 7/multimodal are deferred. Do not build their architecture early.

## Kiro context map

Use `.kiro/steering/` as the most relevant Kiro folder:

- `philosophy.md`: Markdown-first mission, minimal scope, pixel parity, user-confirmed writes, reliability.
- `architecture.md`: useful boundaries and data-flow diagrams, but partially superseded by `ROADMAP.md` after the Next.js-only pivot.
- `tech-stack.md`: pinned stack and explicit out-of-scope technologies.
- `development-standards.md`: frontend/backend standards, rendering rules, mock-data rules, testing expectations.
- `conventions.md`: naming, project structure, import rules, API patterns, error handling.
- `aws-infrastructure.md`: local/default AWS bucket, region, and Bedrock model context.

Use `.kiro/prompts/` and `.kiro/agents/` only as workflow inspiration. They describe roles such as Config & Security, GitHub Integration, Documentation, Core, CLI/DevX, and review/consultant agents, but they are not binding product architecture.

## Vault content vs codebase

PRD §12 lists `AGENTS.md`, `WIKI_RULES.md`, `INDEX.md`, `LOG.md`, `SOURCES.md`, and `TASKS.md` as **vault content**. Those files belong inside a user's S3 vault, not at the repo root, except for this repo-level `AGENTS.md` operating guide. The previous root-level wiki-maintainer schema lives under `legacy/`.

## Operating notes for Codex

- Confirm before large structural moves such as deleting `portal/`, reviving `api/`, archiving directories, or replacing the active architecture. Reversible local edits are fine.
- Read `ROADMAP.md` and the relevant `.kiro/steering/` file before making architecture decisions.
- Do not revive the Bedrock legacy pipeline unprompted. `legacy/` is frozen reference; port ideas into `ingest/` when the task asks for it.
- When a PRD or roadmap open question blocks a decision, surface it rather than guessing.
- Prefer editing existing files over creating new ones. The prototype and Kiro steering docs already encode many product decisions; read them before re-deriving.
