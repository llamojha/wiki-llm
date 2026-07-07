# Architecture overview

## Layer shape

Canopy is one Next.js app, not the two-service split the product spec
originally planned:

```
Browser → web/ (Next.js Route Handlers) → S3 (Markdown blobs) + Bedrock
```

- **`web/app/`** — pages (Server Components by default) and `api/*/route.ts`
  handlers. Route handlers are the only place that touches S3 or Bedrock;
  pages call them, never S3 directly.
- **`web/lib/`** — the actual logic: S3 facade (`s3.ts`), vault-mode
  resolution (`vault-mode.ts`), path/key rules (`vault-paths.ts`), search
  (`search.ts`, Fuse.js in-memory index built from S3 listings), the agent
  loop (`agent.ts`, `agent-tools.ts`), auth (`auth.ts`, `auth-oidc.ts`,
  `auth-session.ts`), and flags (`flags.ts`).
- **`web/components/`** — client components for anything interactive
  (sidebar tree, search palette, editor, chat panel, upload modal).
- **`infra/lambda/curate/`** — a separate Lambda deployment (not part of the
  Next.js app) that does the heavier, longer-running AI curation work: see
  [Curate pipeline](../workflows/curate-pipeline.md).

## Why it's a single app

`.kiro/steering/architecture.md` documents the original two-service design
(Next.js frontend + FastAPI backend + Postgres) and carries an explicit
status note: after Phase 2 the deployed architecture pivoted to the current
single-app shape. The archived FastAPI backend lives under `api/` — CI still
runs its tests, and it's kept as a reference (possibly revived for a future
Phase 6 SaaS split), but it is not called by anything in `web/`. Do not treat
its presence as evidence of a live two-service architecture.

Two concrete simplifications came from the pivot:
- **Search**: Postgres full-text search → an in-memory Fuse.js index built
  from S3 object listings at request time (`web/lib/search.ts`). There is no
  database; the index is rebuilt/patched incrementally as content changes.
- **Metadata**: Postgres document rows → Markdown frontmatter is now the
  only metadata store. "Markdown is the source of truth" is a hard rule
  (`CLAUDE.md` conventions) — when frontmatter and any derived index
  disagree, frontmatter wins and the index is rebuilt.

## The vault boundary

`vault_id → (bucket, prefix)` is the isolation boundary between user content
and infra: one deployment serves exactly one S3 bucket + prefix
(`VAULT_BUCKET`, `VAULT_PREFIX`). `web/lib/s3.ts` is the only module that
constructs an S3 client; every other module goes through it (or through
`s3-mock.ts`, an in-memory stand-in swapped in via `MOCK_S3=1` for unit and
e2e tests — see [Testing strategy](../testing/e2e-and-unit.md)).

## Scope: shared vs per-user

Beyond the bucket/prefix boundary, content is further split into a shared
library and per-user personal space (`users/<id>/…`), resolved by
`web/lib/scope.ts`. This is orthogonal to vault mode (provenance/folders) —
scope answers "whose content is this", vault mode answers "how is content
organized and recognized as a document". See
[Vault modes](../architecture/vault-modes.md) for the latter.

## Things to watch when editing

- Route handlers are the enforcement boundary for feature flags
  (`flagGuard(name)` — see [Feature flags and auth](../operations/feature-flags-and-auth.md))
  and for auth (`requireSession`). Hiding a UI button is not access control;
  missing the route guard is a real gap.
- `web/lib/vault-mode.ts` has a synchronous `vaultMode()` getter that returns
  a stale/default value (`provenance`) until `ensureVaultMode()` has resolved
  once. Every list-consuming entry point must `await ensureVaultMode()`
  before relying on `vaultMode()` — this is a real footgun for new code that
  filters documents.
- Don't add a second place that constructs an S3 or Bedrock client; extend
  `s3.ts` / `bedrock.ts` instead, so the mock swap-in and the single-vault
  boundary keep holding.

## Source references

- `.kiro/steering/architecture.md` — original two-service design + pivot
  status note.
- `CLAUDE.md` "Current state" table — what's active vs archived vs frozen.
- `web/lib/s3.ts`, `web/lib/s3-mock.ts` — the S3 facade and its mock.
- `web/lib/scope.ts` — shared/per-user resolution.
