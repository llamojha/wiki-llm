# OpenWiki quickstart

Vaultmark (repo name `wiki-llm`; a decided-but-not-yet-executed rename to
**Canopy** is tracked in [`specs/rename-to-canopy.md`](../specs/rename-to-canopy.md))
is an S3-backed Markdown knowledge portal. Markdown objects in a bucket are
the durable source of truth; a single Next.js app renders, searches, and lets
a Bedrock-powered agent answer questions grounded in that content. Every
content write — human or agent — lands as a plain `.md`/`.html` object in the
vault.

## What this repository does

- **Portal** (`web/`) — a Next.js 16.2 app (App Router, Route Handlers) that
  browses, searches, edits, and chats over a vault. One deployment = one S3
  bucket + prefix ("one vault, one bucket, one prefix").
- **Two vault modes** — `provenance` (spaces declared in
  `_system/structure.json`, AI-curated content under `generated/`/`authored/`)
  and `folders` (zero-config: any folder under the bucket root is a space).
  See [Vault modes](./architecture/vault-modes.md).
- **AI curation** (`infra/lambda/curate/`) — a Lambda pipeline that turns raw
  uploaded sources into structured wiki pages via Bedrock, with an optional
  cross-cluster synthesis pass. See [Curate pipeline](./workflows/curate-pipeline.md).
- **Ask-wiki agent** — a Bedrock Nova 2 Lite tool-use loop that searches the
  vault, reads documents, cites sources, and proposes new pages — every write
  is user-confirmed, never autonomous. See [Ask-wiki agent](./workflows/ask-wiki-agent.md).
- **Feature flags + auth gate** — every non-read feature is individually
  toggleable, and an optional built-in OIDC gate can lock the portal down.
  See [Feature flags and auth](./operations/feature-flags-and-auth.md).

## Why the architecture looks the way it does

The project originally planned a two-service shape — Next.js frontend talking
to a separate FastAPI backend backed by Postgres (metadata/search) + S3
(content). After Phase 2 that pivoted to a **single Next.js app**: Route
Handlers replaced the FastAPI service, and in-memory Fuse.js search over S3
replaced Postgres full-text search. The archived two-service code lives under
`api/` (reference only, tests still run in CI) — see
[Architecture overview](./architecture/overview.md) for why it was kept
rather than deleted outright.

## Start here

- [Architecture overview](./architecture/overview.md) — the single-app
  shape, layer responsibilities, and why the pivot happened.
- [Vault modes](./architecture/vault-modes.md) — `provenance` vs `folders`,
  how the portal recognizes documents, and frontmatter-based provenance
  (`origin`).
- [Curate pipeline](./workflows/curate-pipeline.md) — raw upload → curate
  Lambda → (optional) synthesis → generated pages, in both vault modes.
- [Ask-wiki agent](./workflows/ask-wiki-agent.md) — the Bedrock tool-use loop
  and its user-confirmation contract.
- [Feature flags and auth](./operations/feature-flags-and-auth.md) — the
  `FEATURE_*` gating pattern and the OIDC auth gate.
- [Testing strategy](./testing/e2e-and-unit.md) — vitest unit tests and the
  Playwright e2e suite running against an in-memory S3 mock.

## Key source files

- `README.md` — install, quickstart, feature-flag summary.
- `CLAUDE.md` — the maintained codebase operating guide (current state table,
  stack, conventions, operating notes for agents).
- `prd_vaultmark_markdown_llm_wiki.md` — authoritative product spec.
- `ROADMAP.md` — phases and the decisions log.
- `docs/configuration.md`, `docs/feature-flags.md` — full env var and flag
  reference (more detailed than this wiki; this wiki explains *why*, those
  docs are the exhaustive *what*).
- `plans/*.md` — one file per shipped/in-flight change, each with its own
  drift check and STOP conditions; `plans/README.md` is the execution-order
  index.
- `specs/*.md` — design decision records for major features (folder-first
  vault, HTML documents, auth gate, synthesis pipeline, agentic access).

## Notes for future agents

- This wiki is a synthesis layer over already-substantial hand-maintained
  docs (`README.md`, `CLAUDE.md`, `docs/*.md`, `.kiro/steering/*.md`,
  `specs/*.md`) — it does not replace them. When in doubt about an exact env
  var, flag default, or route, `docs/configuration.md` and
  `docs/feature-flags.md` are the exhaustive reference; this wiki explains
  the architecture and why things are shaped the way they are.
- `api/` (archived FastAPI backend) and `legacy/` (frozen `wiki.py` CLI) are
  reference-only, not active surface — don't revive either unprompted.
- Managed mode (a third vault mode, metadata-derived tree) is designed at
  the decision level (`specs/folder-first-vault.md` §8,
  `specs/storage-v2-proposal.md`) and tracked for implementation in
  `plans/027`, which itself calls for writing `specs/managed-mode.md` before
  any code — that spec does not exist yet. Don't document managed mode as
  shipped.
- Two Kiro skills exist for keeping documentation current:
  `.kiro/skills/docs-sync/` audits the hand-maintained docs above against
  the code (fixes drift, doesn't generate new pages); this `openwiki/` tree
  is maintained by `.kiro/skills/openwiki-generate/` (generates/updates this
  synthesis layer). They write to disjoint file sets.
