# Plan 019: Adopt ESLint (lint is currently a typecheck alias)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/package.json package.json .github/workflows/ci.yml`
> Also: if an `eslint.config.*` already exists anywhere, STOP (someone landed
> lint first).

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (first lint of an unlinted codebase surfaces a batch of
  violations; the risk is scope creep, not breakage)
- **Depends on**: plans/003 + 004 (CI shape settles first)
- **Category**: dx
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`web/package.json` defines `"lint": "tsc --noEmit"` — identical to
`typecheck`. There is no ESLint or Prettier config anywhere, so "lint passes"
in CI is false confidence: unused variables, floating promises,
react-hooks/exhaustive-deps, and accessibility issues in TSX are all
unchecked. Several audit findings (unawaited promises risk, hook-heavy
1167-line component) are exactly the classes a linter catches at review time.

## Current state

- `web/package.json:9-10` — `"lint": "tsc --noEmit", "typecheck": "tsc --noEmit"`.
  Root `package.json` forwards `lint` to web.
- No `.eslintrc*`, `eslint.config.*`, or prettier config in the repo
  (verified at `fead8f9`).
- Stack: Next.js 16.2 (flat-config era — use `eslint.config.mjs`), React 19,
  TS ^6.0.3, pnpm. `.editorconfig` exists at the root (2-space, LF — read it
  and keep any formatting choices consistent with it).
- CI (`.github/workflows/ci.yml`, `web` job) runs `pnpm typecheck` then
  `pnpm build` (plus unit tests if plan 004 landed).
- House style observed (keep rules compatible): single quotes, semicolons,
  trailing commas, extensive `//`-comment blocks, `@/` path alias,
  `type`-imports mixed with value imports.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Lint      | `pnpm --filter @vaultmark/web lint` | exit 0 |
| Typecheck | `pnpm typecheck`         | exit 0              |
| E2E       | `pnpm build && pnpm test:e2e` | all pass (only if Step 3 changed code) |

## Scope

**In scope**:
- `web/package.json` (devDeps: `eslint`, `eslint-config-next`,
  `typescript-eslint`, `eslint-plugin-react-hooks` if not pulled by the Next
  config; scripts: `lint` → eslint, keep `typecheck`)
- `web/eslint.config.mjs` (create)
- `.github/workflows/ci.yml` (lint step in the `web` job)
- Mechanical fixes across `web/` from `--fix` and the triage in Step 3

**Out of scope**:
- Prettier / formatting enforcement — `.editorconfig` stays the only
  formatting authority for now (avoid a whole-repo reformat commit before the
  public-release history squash).
- Linting `ingest/`, `video/`, `infra/lambda/curate/`, `scripts/` — start
  with `web/`; note follow-up.
- Any rule requiring behavior-relevant edits beyond Step 3's explicit triage
  rules.
- `legacy/`, `portal/`, `api/`.

## Git workflow

- Branch: `advisor/019-eslint`
- Commits: (1) config + scripts, (2) auto-fixes only (`--fix`), (3) manual
  triage fixes, (4) CI. Keeps review tractable.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Config

Install devDeps in `web/`. Create `web/eslint.config.mjs` extending
`eslint-config-next` (core-web-vitals) + `typescript-eslint` recommended
(NOT type-checked-strict yet — see Maintenance). Enable deliberately:

- `@typescript-eslint/no-floating-promises`: `error` (needs
  `parserOptions.projectService: true`) — this repo is promise-heavy S3 code;
  it's the highest-value rule here.
- `react-hooks/exhaustive-deps`: `warn` (the upload-modal Ref-mirror pattern
  will trip it; a blanket `error` would force rewrites plan 016 owns).
- `@typescript-eslint/no-explicit-any`: `warn` (matches the repo's stated
  "no `any` without justification").

Ignore: `.next/`, `node_modules/`, `next-env.d.ts`.
Point `"lint"` at `eslint .` (from `web/`). Root `lint` script already
forwards.

**Verify**: `pnpm --filter @vaultmark/web exec eslint . --max-warnings=9999` →
runs and reports (nonzero exit acceptable at this step); note the error/warn
counts in your report.

### Step 2: Auto-fix pass

`pnpm --filter @vaultmark/web exec eslint . --fix`. Commit ONLY if
`pnpm typecheck` and `pnpm build` stay green and the diff is mechanical
(import ordering, prefer-const, etc.). Inspect the diff before committing.

**Verify**: `pnpm typecheck` exit 0; `VAULT_BUCKET=build-placeholder pnpm build` exit 0.

### Step 3: Triage remaining errors to zero

Rules of engagement, per error:

- **Real bug smell** (floating promise on a critical path, etc.): fix ONLY if
  the fix is a local `await`/`void` annotation whose behavior implication is
  obvious; otherwise add a `// eslint-disable-next-line …` with a one-line
  reason AND list it in your final report as a finding.
- **Intentional pattern** (e.g. fire-and-forget logging in `usage-log`
  callers): `void` operator or targeted disable-with-reason.
- **Bulk noise from one rule**: downgrade that rule to `warn` in config with
  a `// TODO(ratchet)` comment rather than scattering disables.

Target: `eslint .` exits 0 with warnings allowed (`--max-warnings` NOT set),
errors at zero.

**Verify**: `pnpm --filter @vaultmark/web lint` → exit 0; full
`pnpm build && pnpm test:e2e` if ANY non-mechanical fix was made.

### Step 4: CI

Add `- run: pnpm lint` to the `web` job between typecheck and build.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0.

## Test plan

No new tests. Gates: lint exit 0, typecheck, build, e2e (conditional).
The deliverable includes the Step 1 baseline counts and the Step 3 triage
list in the executor's report.

## Done criteria

- [ ] `pnpm --filter @vaultmark/web lint` runs ESLint (not tsc) and exits 0
- [ ] `no-floating-promises` is `error` and passing
- [ ] CI `web` job has a lint step
- [ ] `pnpm typecheck` + build + (if code changed) e2e green
- [ ] Every `eslint-disable` added carries a reason comment
- [ ] `plans/README.md` status row updated

## STOP conditions

- Baseline errors exceed ~150 after auto-fix (the triage no longer fits this
  plan's effort — report counts by rule and propose a rule subset).
- `projectService` type-aware linting is unworkably slow (>2 min) on this
  machine — report; fall back to non-type-aware rules and note
  no-floating-promises was dropped.
- An auto-fix changes runtime behavior (typecheck/build/e2e catches it) —
  revert that hunk and disable the rule with a TODO.

## Maintenance notes

- Ratchet path: promote `exhaustive-deps` and `no-explicit-any` to `error`
  after plan 016 lands; consider `typescript-eslint` strict-type-checked once
  the baseline is quiet; extend coverage to `ingest/` next.
- Plan 010's maintenance note suggests a `no-restricted-syntax` rule against
  `as string` on frontmatter reads — good first custom rule.
- Reviewer: commit 2 (auto-fix) should be verifiable as behavior-free by
  skimming; commit 3 is where scrutiny goes.
