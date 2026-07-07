# Rename: Vaultmark → Canopy

**Status:** DONE (July 2026). This spec tracks the rename so it lands as one deliberate, reviewable change instead of drifting inconsistently across docs and code.

## Decision

The product is being renamed from **Vaultmark** to **Canopy**. This document records the decision and the checklist for carrying it out; it does not itself perform the rename.

## Why track this separately

"Vaultmark" is currently woven through user-facing copy (`README.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/`), package metadata, CI workflow names, and container image references. A careless partial rename (e.g. renaming the README title but leaving `package.json` `name` fields, GHCR image tags, or the PRD title stale) produces a confusing half-state. This spec exists so the rename happens as one deliberate pass with an explicit checklist, not a name inserted in one place and forgotten everywhere else.

## Scope of the rename (when executed)

**In scope:**
- Product name in prose: `README.md`, `CLAUDE.md`, `ROADMAP.md`, `docs/**`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`
- UI-facing copy in `web/` (page titles, `<head>` metadata, any literal "Vaultmark" strings in components)
- `package.json` `name` fields across the pnpm workspace (`web`, `ingest`, any others)
- CI/workflow display names in `.github/workflows/*.yml` (not necessarily the repo/image slug — see below)
- The tagline: `Vaultmark — an S3-backed Markdown vault for people, pipelines, and agents.` → needs a Canopy-appropriate rewrite, not just a find-replace of one word (e.g. "vault" imagery may or may not still fit "Canopy")

**Explicitly deferred / needs a separate decision before touching:**
- The GitHub repository slug (`wiki-llm`) — renaming the repo affects clone URLs, existing forks, and CI history. Should be an explicit, separate decision, not bundled into this pass.
- Published container image name/tags (`ghcr.io/<owner>/<repo>:*`) — tied to the repo slug; same caveat.
- Environment variable names (`VAULT_BUCKET`, `VAULT_PREFIX`, `VAULT_REGION`, `VAULT_ID`, `NEXT_PUBLIC_VAULT_USER_ID`) — these are deployment-facing contracts. Renaming them is a breaking change for anyone with an existing `.env`. Do not rename silently; if renamed, ship both names for a deprecation window or document it as a breaking change with a migration note.
- S3 path conventions and default prefixes — infra-facing, not user-facing; no reason to touch these just for a product-name rename.

## Checklist (for the execution PR)

- [x] `README.md` — title, tagline, "Status" section, any inline "Vaultmark" references
- [x] `CLAUDE.md` — title and "Vaultmark — Codebase Guide" header, all inline references
- [x] `ROADMAP.md` — title (`# Vaultmark — Roadmap`)
- [x] `docs/**/*.md` — grep for `Vaultmark` and replace
- [x] `prd_canopy_markdown_llm_wiki.md` — decide: rename the file too, or leave as a historical artifact with a note pointing to the new name? (Recommend: leave the filename as a dated historical record, add a one-line note at the top pointing to the current name.)
- [x] `web/` UI strings — page `<title>`, any hardcoded "Vaultmark" in components
- [x] `package.json` `name` fields (workspace root + each package)
- [x] `.github/workflows/*.yml` — display names / comments referencing the product name
- [x] `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` — inline references
- [x] Final repo-wide grep for `[Vv]aultmark` to catch stragglers before merging

## Acceptance Criteria

1. A repo-wide case-insensitive search for `vaultmark` returns zero hits outside of explicitly-preserved historical files (e.g. the dated PRD, if left as a historical artifact).
2. The product is referred to as **Canopy** consistently across README, CLAUDE.md, ROADMAP, and docs.
3. No environment variable, S3 path convention, repo slug, or container image name changes as a side effect of this pass — those are separate, explicitly deferred decisions (see above).
4. `pnpm build` and `pnpm typecheck` pass after the rename (catches any string used as an identifier, not just prose).

## Open Questions

- Final tagline copy for Canopy (the current tagline leans on "vault" imagery).
- Whether/when to also rename the GitHub repository and container image slug — tracked here as deferred, but needs an owner decision before it becomes stale.
- Whether `VAULT_*` env vars get renamed to `CANOPY_*` in a future breaking-change release, and what the deprecation window looks like.
