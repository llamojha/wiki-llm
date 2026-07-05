---
name: openwiki-generate
description: Generate or update an openwiki/ documentation tree for this repository, reproducing the langchain-ai/openwiki CLI's exact init/update methodology (quickstart + section pages, AGENTS.md/CLAUDE.md pointer, .last-update.json) using Kiro's own tools instead of an external LLM provider. Use when the user asks to run openwiki, generate the openwiki folder, or "do the full openwiki experience".
---

# OpenWiki Generate Skill

## Overview
This skill reproduces the real `langchain-ai/openwiki` CLI's documentation-agent
methodology verbatim (sourced from its own `src/agent/prompt.ts` and
`openwiki/architecture/overview.md`), but executes it with Kiro's native
tools instead of installing the npm package and calling an external
provider (OpenRouter/Anthropic/OpenAI/Baseten/Fireworks). Same output
contract — an `openwiki/` folder plus an `AGENTS.md`/`CLAUDE.md` pointer —
no new API key, no second doc surface competing with `docs/*.md` unless the
user explicitly wants both.

**Important**: Announce at the start: "I'm using the openwiki-generate skill
to build the openwiki/ tree, following OpenWiki's own init/update prompt."

## Activation Triggers
- User asks to "run openwiki", "generate the openwiki folder", "do the full
  openwiki experience", or references wanting OpenWiki output specifically
  (as opposed to `docs-sync`, which audits the *existing* hand-maintained
  docs instead of generating a new tree).

## Modes
Determine which mode from the user's request and repo state:
- **init** — `openwiki/` does not exist yet, or the user explicitly says
  "start fresh" / "re-init".
- **update** — `openwiki/quickstart.md` already exists. Default to update
  once init has run once.

## Core Rules (ported from OpenWiki's system prompt)

### Discovery discipline
- Do not read every file. Inspect the repo tree, package/config files,
  README-style files, entrypoints, routing files, schema files, and one
  representative file per major domain.
- Use `code` (search_symbols / generate_codebase_overview) and `grep`/`glob`
  for targeted discovery — never a blanket recursive read of the whole tree.
- Ground every claim in a source file, existing doc, or git evidence you
  actually inspected. Never invent files, APIs, or behavior.

### Git evidence
- **init**: `git log --max-count=20 --name-status --oneline`, plus targeted
  `git log`/`git show`/`git blame` on high-signal files to understand why
  major workflows exist.
- **update**: read `openwiki/.last-update.json` for the previously recorded
  `gitHead`. If present, use `git log <gitHead>..HEAD --name-status --oneline`
  and `git diff --name-status HEAD`. If absent, fall back to `git log
  --since <updatedAt> --name-status --oneline`.
- Do not over-index on ancient history — recent commits and high-signal
  history for important files only. Do not embed persistent commit-hash
  lists in the docs unless one specific commit explains an important
  decision worth preserving.

### Existing documentation discipline
- Treat `README.md`, `CLAUDE.md`, `docs/*.md`, `.kiro/steering/*.md`,
  `specs/*.md`, and `SKILL.md` files as primary source material — summarize
  and link to them rather than duplicating their content.
- If existing docs conflict with source/git evidence, call out the likely
  stale doc and prefer current source (do not silently overwrite the
  original file — this skill only writes under `openwiki/` and the
  AGENTS.md/CLAUDE.md pointer section, never `docs/*.md`).

### Planning discipline
- Before writing final pages, write a temporary `openwiki/_plan.md` listing
  intended pages, the source evidence per page, and open questions.
- Delete `openwiki/_plan.md` before finishing. Never leave it in the final
  tree.

### Section quality rules
- Don't create a directory unless it represents a real documentation area
  with multiple substantive pages (a single-file directory is only OK if
  that page is substantial and likely to grow).
- No thin/stub pages — merge into `quickstart.md` or a broader section page.
- Each page must explain: what the area does, why it exists, where to
  start, what to watch for, and key source references.
- For small repos (~10 or fewer primary source files), prefer
  `quickstart.md` plus at most 1-2 supporting pages.
- Before finishing, review the `openwiki/` tree and merge/remove any
  low-value single-file directories or stub pages.

### Required structure
- `openwiki/quickstart.md` is the entrypoint: repo overview + links to
  every major section.
- Section directories only when the repo is large enough to warrant them,
  e.g. `architecture/`, `workflows/`, `domain/`, `api/`, `data-models/`,
  `operations/`, `integrations/`, `testing/` — pick names that fit this
  repo's actual shape (e.g. `curate-pipeline/`, `vault-modes/`).
- Source-map / source-reference lists are optional — include only when they
  materially help navigation; prefer inline references on short pages.

### Root agent-instruction pointer (mandatory unless the user says skip)
Unless told not to, ensure top-level `/AGENTS.md` and `/CLAUDE.md` (top
level only — never nested copies) contain this exact section:

```markdown
## OpenWiki

This repository has documentation located in the /openwiki directory. Start
here:

- [OpenWiki quickstart](openwiki/quickstart.md)

OpenWiki includes repository overview, architecture notes, workflows,
domain concepts, operations, integrations, testing guidance, and source
maps. When working in this repository, read the OpenWiki quickstart first,
then follow its links to the relevant architecture, workflow, domain,
operation, and testing notes.
```

- If the file exists, add/update only this section (preserve everything
  else). If both `AGENTS.md` and `CLAUDE.md` exist, apply to both,
  duplicated verbatim.
- Do not touch either file only to reformat — only insert/refresh this exact
  section.
- **wiki-llm-specific note**: this repo's `AGENTS.md` is deliberately a thin
  pointer to `CLAUDE.md` ("the two guides cannot drift again"). Insert the
  OpenWiki section into both anyway, per the rule above — it's additive and
  doesn't reintroduce the drift the pointer was guarding against (that
  guard was about steering content, not this section).

### Metadata
After a successful init/update that actually changed `openwiki/` content
(excluding `.last-update.json` itself), write/update
`openwiki/.last-update.json`:

```json
{
  "gitHead": "<git rev-parse HEAD>",
  "updatedAt": "<ISO 8601 timestamp>"
}
```

If nothing under `openwiki/` materially changed, do not touch this file —
mirrors the real CLI's snapshot-diff no-op behavior.

### Security
- Never read `.env`, credential files, private keys, or tokens.
  `.env.example`-style placeholder files are fine.
- If a secret-bearing file is relevant, document only that the configuration
  exists and where to set it up — never the value.

## Execution Workflow

### Step 1: Determine mode
Check for `openwiki/quickstart.md`. Exists → update mode. Absent → init mode.

### Step 2: Gather evidence
Run (via `shell`, read-only):
```bash
git log --max-count=20 --name-status --oneline   # init
# or, for update, using recorded gitHead from openwiki/.last-update.json:
git log <gitHead>..HEAD --name-status --oneline
git diff --name-status HEAD
git status --short
```
Use `code` `generate_codebase_overview` and targeted `grep`/`glob` to map
major domains. Read root README/CLAUDE.md/docs/specs as primary sources.

### Step 3: Plan
Write `openwiki/_plan.md` with intended pages, evidence per page, and open
questions. Show the plan to the user before writing final pages only if the
scope is ambiguous; otherwise proceed (default-to-action for a well-scoped
first pass).

### Step 4: Write pages
Init: `quickstart.md` first, then section pages (max ~8 pages unless the
repo is clearly tiny). Update: only touch pages whose content is actually
stale per the git evidence gathered in Step 2 — no formatting-only edits, no
refreshing source-map/git-evidence sections unless materially wrong.

### Step 5: Clean up
Delete `openwiki/_plan.md`. Review the tree for thin pages/directories and
merge them.

### Step 6: Root pointer
Insert/refresh the OpenWiki section in top-level `AGENTS.md` and `CLAUDE.md`
per the rule above.

### Step 7: Metadata + report
Write `openwiki/.last-update.json` if content changed. Summarize what was
written/updated and why, citing the git/source evidence used per page.

## Constraints
- Only write under `openwiki/` plus the one designated section in top-level
  `AGENTS.md`/`CLAUDE.md`. Never touch `docs/*.md`, `README.md`,
  `.kiro/steering/*.md`, or any source file.
- This is a separate, additive doc surface from `docs-sync`'s job (auditing
  the hand-maintained docs) — the two skills don't overlap in what they
  write.
- No external API key, no npm install — this skill runs entirely on Kiro's
  existing tools and model access.
