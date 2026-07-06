---
name: docs-sync
description: Audit and fix documentation drift in Vaultmark (README.md, CLAUDE.md, docs/*.md, .kiro/steering/*.md) against the actual code. Use when the user asks to generate, update, sync, or check docs for accuracy, or asks "are the docs still correct".
---

# Docs Sync Skill

## Overview
Vaultmark's documentation (`README.md`, `CLAUDE.md`, `docs/*.md`,
`.kiro/steering/*.md`) is hand-maintained prose, not generated from a
template. It drifts from the code every time a flag default changes, a
dependency is bumped, a route is added, or the repo layout shifts (see
`plans/020-docs-sync.md` for the precedent — four factual doc bugs found
this way and fixed in one pass).

This skill does **not** generate a new doc tree from scratch (that's what
tools like `openwiki` do, and would create a second, conflicting doc
surface). It re-runs the plan-020 methodology: **derive the ground truth
from source, diff it against what the docs claim, fix only what's wrong.**

**Important**: Announce at the start: "I'm using the docs-sync skill to
check the docs against the code."

## Activation Triggers
Use this skill when the user:
- Asks to "generate docs", "update the docs", "sync the docs", or "check if
  the docs are accurate" for this repo
- Asks whether README/CLAUDE.md/docs are still correct after a code change
- Mentions doc drift, stale docs, or references plan 020's pattern

## Scope of truth checks

Run these checks in order. Each has a ground-truth source (the code) and a
claims-side target (the docs). Only touch a doc file if a check finds an
actual mismatch — do not rewrite prose that is already correct.

| # | Claim | Ground truth | Docs that claim it |
|---|---|---|---|
| 1 | Feature flag defaults | `web/lib/flags.ts` `DEFAULT_BY_FEATURE` | `README.md`, `docs/feature-flags.md`, `CLAUDE.md` |
| 2 | Language/runtime versions (TypeScript, Next.js, React, Node) | `web/package.json`, `ingest/package.json`, `video/package.json`, `infra/lambda/curate/package.json`, root `package.json` engines | `README.md` stack table, `CLAUDE.md`, `.kiro/steering/tech-stack.md` |
| 3 | Repo layout tree | `ls -d */` at repo root (minus `node_modules`, `.git`, build/test-artifact dirs) | `README.md` "Repo layout", `CLAUDE.md` "Repo Layout" |
| 4 | Environment variables | `grep -rn "process.env\." web/lib web/app infra/lambda/curate/*.ts` — every var actually read | `docs/configuration.md` |
| 5 | S3 vault key layout (`raw/`, `generated/`, `authored/`, `_system/`, folders-mode paths) | `web/lib/vault-paths.ts`, `web/lib/vault-mode.ts` | `README.md` "S3 vault layout" |
| 6 | API routes / verification commands | `web/app/api/**/route.ts`, root `package.json` scripts | `README.md` "Verification", `CONTRIBUTING.md` |
| 7 | Plan status table | `plans/*.md` STOP/Status sections | `plans/README.md` |

## Execution Workflow

### Step 1: Confirm scope
Ask the user (or infer from their message) which subset to check:
- **Full audit** (all 7 checks) — the default if they just say "sync the docs"
- **Targeted** — e.g. "did the flags doc keep up after plan 029" → checks 1
  and 4 only

### Step 2: Drift check (establish baseline)
Find the last commit that touched docs vs. the last commit that touched the
code paths in the table above:

```bash
git log --oneline -1 -- README.md CLAUDE.md docs/ .kiro/steering/
git log --oneline -1 -- web/lib/flags.ts web/package.json web/lib/vault-paths.ts web/lib/vault-mode.ts infra/lambda/curate/package.json
```

If the code commit is newer than the docs commit, there is a nonzero chance
of drift — proceed to Step 3. If docs are newer or equal, still run Step 3
(a doc update doesn't guarantee it was correct) but weight it lower.

### Step 3: Run the truth checks
For each check in scope, read the ground-truth source file(s) directly
(don't guess from memory) and grep the target doc(s) for the claim. Use the
`code` tool's `search_symbols` / `grep` for source lookups, and `grep` for
doc-side claim extraction. Concretely:

```bash
# Check 1 — flag defaults
grep -n "DEFAULT_BY_FEATURE" -A 15 web/lib/flags.ts
grep -n "FEATURE_" README.md docs/feature-flags.md CLAUDE.md

# Check 2 — versions
grep -n '"typescript"\|"next"\|"react"' web/package.json ingest/package.json video/package.json infra/lambda/curate/package.json
grep -rn "TypeScript\|Next.js 1\|React 1" README.md CLAUDE.md .kiro/steering/tech-stack.md

# Check 3 — layout
ls -d */ | grep -v node_modules

# Check 4 — env vars
grep -rhon 'process\.env\.[A-Z_]*' web/lib web/app infra/lambda/curate --include='*.ts' | sed 's/.*process\.env\.//' | sort -u
grep -n '^|' docs/configuration.md

# Check 6 — verification commands
grep -n '"scripts"' -A 20 package.json web/package.json
```

Build a list of concrete mismatches: `(doc file, line/section, wrong claim,
correct value, source citation)`. Do not include a mismatch you can't cite a
specific source line for.

### Step 4: Present findings before editing
Show the user the mismatch list (or "no drift found" if the checks came back
clean) before writing anything. Format:

```
docs/configuration.md:118 claims THEME_VAULT_PREFIX is undocumented
  → actually read at web/lib/theme-registry.ts:126, missing from the table
README.md:32 claims "TypeScript 5.7+"
  → web/package.json pins "^6.0.3"
```

### Step 5: Apply fixes
On user confirmation (or proceed directly for small/obvious fixes per
default-to-action — use judgment on blast radius), edit only the specific
lines identified. Do not:
- Rewrite steering docs' intentionally-stale architecture sections (they
  carry explicit status notes, e.g. `.kiro/steering/architecture.md`)
- Touch `plans/*.md` content beyond the status table in `plans/README.md`
- Introduce a new doc file/tree unless the user explicitly asks for one

### Step 6: Verify
```bash
grep -rn "<old wrong value>" README.md CLAUDE.md docs/ .kiro/steering/
```
Expect no hits. For layout-tree edits, confirm every directory in `ls -d */`
(minus ignorable dirs) appears in both README.md and CLAUDE.md trees.

### Step 7: Report
Summarize what changed, citing the source line that justified each fix. If
nothing was wrong, say so plainly — don't manufacture busywork.

## Constraints
- Never fabricate a "correct" value — every fix must cite a source file/line.
- Never touch code, only documentation files, unless the user explicitly
  asks for a code fix alongside a doc fix.
- Treat `README.md`, `CLAUDE.md`, and `docs/configuration.md` as the
  highest-priority targets — they're loaded into every agent session via
  steering-equivalent mechanisms and mislead every subsequent session when
  wrong.
- Prefer minimal diffs: fix the wrong sentence/row, don't restyle
  surrounding prose.
- This skill is Vaultmark-specific (paths above are hardcoded to this repo's
  structure) — it is not a portable doc generator.
