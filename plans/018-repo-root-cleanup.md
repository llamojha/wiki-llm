# Plan 018: Repo-root cleanup — retire parity scaffolding, stale context files, and the duplicate guide

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- package.json AGENTS.md CODEX_CONTEXT.md scripts/ web/app/dev/ web/lib/mock/ portal-archive/`
> On drift, compare "Current state" against the live tree; on mismatch, STOP.

## Status

- **Priority**: P2 (pre-public-release hygiene)
- **Effort**: S
- **Risk**: LOW–MED (deletions; every one is verified unreferenced first)
- **Depends on**: none (coordinates with plans/020 — both edit CLAUDE.md; land this first)
- **Category**: tech-debt
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The repo is being prepared for a public release. The root carries scaffolding
from the finished Phase 1 parity port and stale AI-session context files:
8 parity scripts wired into `package.json`, a `parity-visual/` artifact tree,
a `/dev/parity` page (the only consumer of `web/lib/mock/`) shipping inside
the app source, `CODEX_CONTEXT.md` (a point-in-time session note duplicating
`specs/curation-pipeline.md`), a month-stale `AGENTS.md` fork of `CLAUDE.md`
(236 changed lines of drift — an agent reading it gets pre-pivot context),
and BOTH `portal/` and `portal-archive/` when CLAUDE.md itself says the
prototype would be deleted after parity sign-off. Parity is signed off
(CLAUDE.md: "parity signed off"). Dead scaffolding in a public repo reads as
neglect and misleads both humans and agents.

## Current state

- Root `package.json:12-18` — scripts `parity:step1..4`, `parity`, `visual`
  → `node scripts/parity-*.mjs`; devDependencies `pixelmatch`, `pngjs`,
  `@types/pixelmatch`, `@types/pngjs` exist ONLY for these scripts (verify:
  grep for their imports outside `scripts/`).
- `scripts/` — 8 `parity-*.mjs` files; nothing else (`ls scripts/`).
- `parity-visual/` — `diff/port/proto` PNG trees (untracked or tracked —
  check `git ls-files parity-visual | head`; at `fead8f9` it is NOT in
  `git ls-files`, i.e. already untracked/ignored — then only a local `rm` +
  `.gitignore` line is needed).
- `web/app/dev/parity/page.tsx` — dev-only page; its import of
  `web/lib/mock/data.ts` + `web/lib/mock/doc-bodies.tsx` is the ONLY
  `lib/mock` consumer (audit-verified; re-verify:
  `grep -rn "lib/mock" web --include='*.ts*' | grep -v 'web/lib/mock/'`).
- `CODEX_CONTEXT.md` — "What just happened … this session" notes; full spec
  lives in `specs/curation-pipeline.md`.
- `AGENTS.md` (root) vs `CLAUDE.md`: same `# Canopy — Codebase Guide` H1;
  AGENTS.md says "Current state (May 2026)", CLAUDE.md "June 2026" + the
  `@.kiro/steering/` auto-load block. CLAUDE.md:? states the OLD root
  AGENTS.md (vault-maintainer schema) moved to `legacy/` — this newer fork
  reintroduced the filename with different content. Many agent tools read
  `AGENTS.md` as the entry point, so it must become a pointer, not vanish.
- `portal/` vs `portal-archive/`: CLAUDE.md's table lists both as "design
  reference … do not extend". `git log --oneline -- portal-archive | head`
  to see which is the older snapshot. CI does not reference either
  (`grep -rn "portal" .github/workflows/`).
- CI: `grep -rn "parity" .github/workflows/` → confirm no job runs parity
  scripts (audit found none; re-verify).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Reference sweep | `grep -rn "<target>" --exclude-dir=node_modules --exclude-dir=.git .` | no live references |
| Typecheck | `pnpm typecheck`         | exit 0              |
| Build     | `VAULT_BUCKET=build-placeholder pnpm build` | exit 0 |
| E2E       | `pnpm test:e2e` (after build) | all pass |

## Scope

**In scope** (deletions/edits):
- `scripts/parity-*.mjs` (8 files), root `package.json` (scripts + the 4
  parity-only devDeps), `pnpm-lock.yaml` (regenerated)
- `parity-visual/` (local removal + `.gitignore` entry if untracked)
- `web/app/dev/parity/` and `web/lib/mock/`
- `CODEX_CONTEXT.md`
- `AGENTS.md` (replace content with a pointer)
- `portal-archive/` (delete; keep `portal/`)
- `CLAUDE.md` (drop the `portal-archive` row from the status table; update the
  "Repo layout" tree if it mentions removed items)

**Out of scope**:
- `portal/` itself — CLAUDE.md still names it the design reference; deleting
  it is a maintainer decision this plan does NOT make.
- `legacy/`, `api/` — archived by explicit decision.
- `.kiro/` — live steering context.
- Anything under `tests/`, `infra-cdk/`, `video/` — live (plans/020 documents
  them instead).
- Git-history scrubbing / branch deletion — separate OSS-readiness work.

## Git workflow

- Branch: `advisor/018-root-cleanup`
- One commit per bullet group (parity, mock/dev page, context files,
  portal-archive) so any piece is independently revertable.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Parity scripts + deps

Reference-sweep `parity-` (excluding `plans/`, `ROADMAP.md`/docs history
mentions — those are narrative, fine). Delete `scripts/parity-*.mjs`; remove
the 6 scripts entries from root `package.json`; remove `pixelmatch`, `pngjs`,
`@types/pixelmatch`, `@types/pngjs` devDeps IF the import-grep confirms
they're parity-only; `pnpm install` to regenerate the lockfile. If `scripts/`
is now empty, remove the directory.

**Verify**: `pnpm install` exit 0; `pnpm typecheck` exit 0.

### Step 2: `/dev/parity` page + `web/lib/mock`

Re-run the `lib/mock` consumer grep. Delete `web/app/dev/parity/` (and
`web/app/dev/` if now empty) and `web/lib/mock/`. Note: CLAUDE.md's mock-data
convention line ("Mock data belongs under `web/lib/mock/`") stays — the
convention holds even with the directory gone; plans/020 owns doc wording.

**Verify**: `VAULT_BUCKET=build-placeholder pnpm build` exit 0 (the build
graph no longer contains the page); `pnpm test:e2e` green.

### Step 3: Stale context files

- Delete `CODEX_CONTEXT.md` (verify `grep -rn "CODEX_CONTEXT" .` finds no
  live reference first).
- Replace `AGENTS.md` body with a pointer (keep the file — agent tooling
  looks for the name):

  ```markdown
  # Canopy — Agent Guide

  The canonical codebase guide for agents and humans is [CLAUDE.md](CLAUDE.md).
  Steering context lives in [.kiro/steering/](.kiro/steering/). This file is
  intentionally a pointer so the two guides cannot drift again.
  ```

**Verify**: `wc -l AGENTS.md` ≤ 10; `git status` shows the two expected changes.

### Step 4: `portal-archive/`

Confirm `portal-archive` is unreferenced outside CLAUDE.md's table
(reference sweep). Delete the directory; edit CLAUDE.md's status table row
(`portal/, portal-archive/` → `portal/`).

**Verify**: build + full e2e green; `git status` clean except intended.

## Test plan

No new tests. Gates: typecheck, production build (catches build-graph
references), full e2e, and the reference sweeps before each deletion.

## Done criteria

- [ ] `grep -rn "parity" package.json` → no hits; scripts/ has no parity files
- [ ] `web/lib/mock/` and `web/app/dev/parity/` gone; build green
- [ ] `CODEX_CONTEXT.md` gone; `AGENTS.md` is a ≤10-line pointer
- [ ] `portal-archive/` gone; CLAUDE.md table updated
- [ ] `pnpm typecheck` + build + full e2e green
- [ ] `plans/README.md` status row updated

## STOP conditions

- Any reference sweep finds a live consumer (CI, docs setup instructions,
  imports) of a deletion target — report it, skip that target, continue with
  the rest.
- The maintainer memory/docs contradict "parity signed off" anywhere you
  encounter — stop before Step 1.
- `portal/` vs `portal-archive/` turn out to be materially different trees
  where the ARCHIVE is the one CLAUDE.md's design-reference claims point to —
  report instead of deleting.

## Maintenance notes

- This plan deliberately leaves `portal/` — when the maintainer is ready
  (post-rebrand), deleting it is a one-liner follow-up with the same
  reference-sweep discipline.
- Plans/020 (docs sync) should run AFTER this so the layout tables it writes
  match the cleaned tree.
- Reviewer: the four devDep removals are the riskiest bit — confirm the
  import-grep evidence is in the PR description.
