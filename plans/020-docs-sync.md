# Plan 020: Sync the docs with reality (flags default, TS version, repo layout, THEME_VAULT_PREFIX)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- README.md CLAUDE.md docs/configuration.md .kiro/steering/tech-stack.md .kiro/steering/development-standards.md`
> Also check whether plans/018 (root cleanup) has landed — if it has, the
> layout trees you write must reflect the CLEANED tree (no `parity-visual/`,
> no `portal-archive/`).

## Status

- **Priority**: P2 (pre-public-release)
- **Effort**: S
- **Risk**: LOW (docs only)
- **Depends on**: plans/018 preferred first (layout tables), not required
- **Category**: docs
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

Four documented facts are actively wrong, and wrong docs are worse than
missing ones — each has a concrete failure mode for a new contributor or
operator:

1. README says every feature ships **on**; the code defaults are agent-on,
   everything else off → misconfigured deployments, "why is upload missing".
2. README + CLAUDE.md + steering say "TypeScript 5.7+"; every workspace pins
   `^6.0.3` → contributor provisions a compiler two majors behind.
3. The repo-layout trees in README and CLAUDE.md omit `tests/` (the whole
   e2e suite), `scripts/`, `infra-cdk/` (a separate deploy path), `video/`
   (a declared pnpm workspace member!), `parity-visual/` → the stated
   "codebase operating guide" can't navigate you to the tests.
4. `docs/configuration.md` omits `THEME_VAULT_PREFIX`, the env var that
   enables vault-hosted themes (`web/lib/theme-registry.ts:126` reads it) —
   the only undocumented env var the code reads.

## Current state

- `README.md:92` — "Every feature ships **on** and can be disabled per
  deployment with `FEATURE_*` env vars …". Truth
  (`web/lib/flags.ts:62-71` `DEFAULT_BY_FEATURE`): `agent: true`, all others
  `false`; a set var wins (ON unless value ∈ off/false/0/no/disabled).
  `CLAUDE.md` ("agent on, everything else off") and
  `docs/configuration.md` are already correct — README is the outlier.
- `README.md:32` — stack table row "Next.js 16.2, React 19, TypeScript 5.7+".
  `CLAUDE.md:59` — "TypeScript **5.7+**, `strict: true`".
  `.kiro/steering/tech-stack.md` frontend table — "TypeScript | 5.7+".
  Truth: `typescript: "^6.0.3"` in `web/`, `ingest/`, `video/`,
  `infra/lambda/curate/`.
- Layout blocks to fix: `README.md:41-56` (tree) and `CLAUDE.md` "Repo
  layout" tree (lines ~38-52). Missing rows: `tests/` (Playwright e2e),
  `scripts/` (parity tooling — OMIT if plans/018 deleted it; check),
  `infra-cdk/` (CDK deploy stack), `video/` (demo-video workspace),
  `parity-visual/` (OMIT if 018 landed). CLAUDE.md separately DOES list
  `video` as a workspace member in the Stack section — the tree just never
  caught up.
- `docs/configuration.md:116-119` — Theming table has `THEME_DIR`,
  `THEME_DEFAULT` only. `web/lib/theme-registry.ts` header (~line 16)
  documents `THEME_VAULT_PREFIX` semantics: optional S3 prefix scanned for
  `*.css` theme plugins at startup; see also `docs/theming.md`.
- Steering docs are checked-in context for agents — `tech-stack.md` says "Do
  not upgrade without updating this file", so the TS row update there is
  required, not optional. (Note: `tech-stack.md` also describes the archived
  FastAPI-era stack in places; it carries a status note via
  `architecture.md` — do NOT rewrite steering beyond the TS version row.)

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Verify claims | `grep -rn "5.7" README.md CLAUDE.md .kiro/steering/` | hits only where you'll edit |
| Truth check | `grep -n '"typescript"' web/package.json ingest/package.json video/package.json infra/lambda/curate/package.json` | all ^6.x |
| Layout truth | `ls -d */ \| grep -v node_modules` | matches the trees you write |

## Scope

**In scope**:
- `README.md` (flags sentence, TS version, layout tree)
- `CLAUDE.md` (TS version, layout tree)
- `.kiro/steering/tech-stack.md` (TS version row; also the "TypeScript 5.7+"
  mention in `development-standards.md` if present — grep)
- `docs/configuration.md` (Theming table row)

**Out of scope**:
- Rewriting steering docs' architecture content (knowingly stale by design,
  status-noted).
- `docs/feature-flags.md`, `docs/theming.md` — verify with a grep that they
  don't repeat the wrong default/version; only edit on a confirmed hit.
- Any code or config change.
- Rebrand-related renaming (Canopy → anything) — separate effort.

## Git workflow

- Branch: `advisor/020-docs-sync`
- One commit: "Sync docs with code: flag defaults, TS 6, repo layout, theme env".
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: README flags sentence

Replace the sentence at `README.md:92` with one matching the code (keep the
var list): "The ask-wiki agent ships **on** by default; every other feature
(`FEATURE_UPLOAD`, `FEATURE_CURATE`, `FEATURE_REINDEX`, `FEATURE_EDITOR`,
`FEATURE_SEARCH`, `FEATURE_STAR`, `FEATURE_PUBLISHING`) defaults **off** and
is opted in per deployment by setting its `FEATURE_*` var (any value except
`off`/`false`/`0`/`no`/`disabled`). Flags gate both the UI and the API
routes." Cross-check the wording against `docs/feature-flags.md` so the two
agree.

**Verify**: `grep -n "ships" README.md` → the new sentence; no remaining
"Every feature ships on".

### Step 2: TypeScript version strings

`5.7+` → `6.x` in `README.md:32`, `CLAUDE.md:59`, the
`.kiro/steering/tech-stack.md` frontend table row, and any
`development-standards.md` hit from the grep.

**Verify**: `grep -rn "5.7" README.md CLAUDE.md .kiro/steering/` → no hits.

### Step 3: Layout trees

Add one-line rows to BOTH trees (README + CLAUDE.md), matching each file's
existing comment style, for: `tests/` ("Playwright e2e suite (mock-S3
backed)"), `infra-cdk/` ("AWS CDK deploy stack"), `video/` ("demo-video
workspace"), and — only if still present after checking the live tree —
`scripts/` and `parity-visual/`. Keep alphabetical/structural ordering
consistent with each tree's current style.

**Verify**: every directory in `ls -d */` (minus node_modules and gitignored
artifact dirs like `test-results/`) appears in both trees; no listed entry is
absent from disk.

### Step 4: Theming env var

Add to `docs/configuration.md` Theming table:
`| THEME_VAULT_PREFIX | no | unset | S3 key prefix (inside the vault) scanned for *.css theme plugins at startup; disabled when unset. See theming.md. |`
Match the table's existing column set exactly. Grep `docs/theming.md` — if it
documents the var already, cross-link; if it contradicts, STOP.

**Verify**: `grep -n "THEME_VAULT_PREFIX" docs/configuration.md` → one row.

## Test plan

Docs-only; the verification greps are the gate. Render check: view the
README diff for broken Markdown tables (`pnpm exec prettier --check README.md`
is NOT available — eyeball the pipe alignment).

## Done criteria

- [ ] All four factual fixes in place; verification greps pass
- [ ] No content edits outside the four fix categories (git diff review)
- [ ] `plans/README.md` status row updated

## STOP conditions

- The live tree contradicts BOTH the old docs and this plan's list (a
  structural change landed after `fead8f9`) — re-derive from `ls`, note it.
- `docs/theming.md` contradicts the `theme-registry.ts` header on
  `THEME_VAULT_PREFIX` semantics — the code comment wins, but report the
  contradiction rather than silently fixing theming.md.

## Maintenance notes

- CLAUDE.md is agent-loaded context: wrong facts there actively mislead every
  future agent session — treat doc drift PRs with the same priority as code
  fixes.
- Follow-up owned elsewhere: plans/003 adds the e2e verification story to
  these same docs; if it landed first, don't duplicate its section.
