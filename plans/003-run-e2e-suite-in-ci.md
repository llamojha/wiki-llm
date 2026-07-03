# Plan 003: Run the Playwright e2e suite in CI and fix the mock-S3 listing contract

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- .github/workflows/ci.yml web/lib/s3-mock.ts playwright.config.ts README.md CLAUDE.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

The repo's best regression signal — 12 Playwright specs in `tests/e2e/`
covering upload, editor, folders, spaces, chat, curate, reindex, search, star,
read paths, and a full flags-off pass — never runs in CI. CI currently runs
only `pnpm typecheck` + `pnpm build` for `web/` and the archived Python
`api/` tests. The suite is genuinely CI-ready: it runs fully mock-backed
(`MOCK_S3=1`), needs no AWS, and its config already keys reporter and
`reuseExistingServer` on `process.env.CI`.

Separately, the mock the suite runs against has drifted from the real S3
facade: real `listObjects` returns **only `.md` keys**; the mock returns every
key. A bug where non-`.md` keys leak through `listObjects` would pass e2e.
Fix the contract while wiring up CI so the suite tests real semantics.

## Current state

- `.github/workflows/ci.yml` — two jobs: `web` (pnpm install → `pnpm
  typecheck` → `pnpm build` with `VAULT_BUCKET: build-placeholder`, Node 26,
  `pnpm/action-setup@v6` with version taken from `packageManager`, cache
  `pnpm` with `cache-dependency-path: pnpm-lock.yaml`, `working-directory:
  web`) and `api` (uv/ruff/pyright/pytest). No Playwright job.
- `playwright.config.ts` (repo root) — `testDir: './tests/e2e'`, two
  `webServer` entries: flags-ON server on port 3030 and flags-OFF server on
  3031, both started with
  `pnpm --filter @vaultmark/web exec next start --port <port>` — i.e. **a
  prior `pnpm build` is required**. `workers: 1`, `fullyParallel: false`
  (mock store is per-process). Reporter: `process.env.CI ? [['github'], ['list']] : 'list'`.
- `web/lib/s3.ts:87-116` — real `listObjects` filters `if (rel.endsWith('.md')) keys.push(rel);`.
  `listAllKeys` (127-156) is the deliberately-unfiltered variant (needed for
  `.keep` markers — see its doc comment).
- `web/lib/s3-mock.ts:75-89` — the drift:

  ```ts
  export async function listObjects(subPrefix = ''): Promise<string[]> {
    const out: string[] = [];
    for (const key of store().objects.keys()) {
      if (!subPrefix || key.startsWith(subPrefix)) out.push(key);
    }
    return out;
  }

  export async function listAllKeys(subPrefix = ''): Promise<string[]> {
    // byte-identical to listObjects — no .md filter on either
  ```

- Root `package.json` scripts: `"test:e2e": "playwright test"`; Playwright and
  its deps are root devDependencies.
- Docs gap: neither `README.md` ("Getting started") nor `CLAUDE.md`
  ("Development", lines 79-93) mentions `pnpm test:e2e` or that it requires a
  build first.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm typecheck`         | exit 0              |
| Build     | `VAULT_BUCKET=build-placeholder pnpm build` | exit 0 |
| E2E local | `pnpm test:e2e`          | 12 specs pass       |
| Browsers  | `pnpm exec playwright install --with-deps chromium` | exit 0 |

## Scope

**In scope** (the only files you should modify):
- `.github/workflows/ci.yml`
- `web/lib/s3-mock.ts` (the `listObjects` filter only)
- `README.md`, `CLAUDE.md` (one short verification subsection each)

**Out of scope** (do NOT touch, even though they look related):
- `playwright.config.ts` — already CI-aware; change nothing.
- Any spec in `tests/e2e/` — if one fails after the mock fix, that's a STOP
  condition (it found a real assumption), not something to edit around.
- `web/lib/s3.ts` — the real implementation is the contract; don't touch.
- The `api` CI job — archived-but-tested by design.

## Git workflow

- Branch: `advisor/003-e2e-in-ci`
- Commit style: imperative, under 72 chars. Two commits: mock fix, then CI+docs.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the mock `listObjects` contract

In `web/lib/s3-mock.ts`, make `listObjects` filter to `.md` keys, matching
`web/lib/s3.ts:110`:

```ts
export async function listObjects(subPrefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const key of store().objects.keys()) {
    if ((!subPrefix || key.startsWith(subPrefix)) && key.endsWith('.md')) out.push(key);
  }
  return out;
}
```

Leave `listAllKeys` unfiltered (that IS its contract).

**Verify**: `pnpm typecheck` → exit 0. Then
`VAULT_BUCKET=build-placeholder pnpm build && pnpm test:e2e` → all 12 specs
pass. If any spec fails, STOP (see STOP conditions).

### Step 2: Add the e2e job to CI

In `.github/workflows/ci.yml`, add a third job `web-e2e` at repo-root working
directory (NOT `web/` — the Playwright config and tests live at the root):

```yaml
  web-e2e:
    name: web — e2e (Playwright, mock S3)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 26
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm build
        env:
          VAULT_BUCKET: build-placeholder
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-traces
          path: test-results/
          retention-days: 7
```

Keep the existing comment convention from the file (the pnpm action version
note). Do not add a `version:` input to `pnpm/action-setup` (the file's own
comment warns both is an error).

**Verify**: `pnpm exec node -e "require('js-yaml')"` is NOT a valid check —
instead run `pnpm exec playwright test --list` → prints the test list without
error, and validate YAML with `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0.

### Step 3: Document the verification story

- `README.md`: in the getting-started/development section, add a short
  "Verification" block: `pnpm typecheck`, `VAULT_BUCKET=build-placeholder pnpm
  build`, `pnpm test:e2e` (note: e2e requires the build; runs against an
  in-memory S3 mock, no AWS needed).
- `CLAUDE.md`: add `pnpm test:e2e` with the same one-line caveat to the
  existing Development command block (around lines 79-93).

**Verify**: `grep -n "test:e2e" README.md CLAUDE.md` → one hit in each.

## Test plan

No new tests — this plan makes the existing 12 specs load-bearing. Full local
run (Step 1 verify) is the gate; the CI job is verified by YAML validity plus
`playwright test --list`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm typecheck` exits 0
- [ ] `VAULT_BUCKET=build-placeholder pnpm build && pnpm test:e2e` exits 0 (all specs)
- [ ] `.github/workflows/ci.yml` contains a `web-e2e` job that builds then runs `pnpm test:e2e`
- [ ] `web/lib/s3-mock.ts` `listObjects` filters `.md`; `listAllKeys` does not
- [ ] `grep -n "test:e2e" README.md CLAUDE.md` → ≥1 hit each
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any e2e spec fails after the Step 1 mock fix — that failure means production
  code or a test depends on non-`.md` keys flowing through `listObjects`.
  Report the failing spec and the key involved; do not patch the spec.
- The Playwright servers fail to start in your environment for a reason
  unrelated to this change (e.g. port conflict you cannot resolve with
  `E2E_PORT`).
- CI YAML requires secrets or runners you cannot verify.

## Maintenance notes

- Plans 001, 002, 005 add e2e cases; they assume this job exists so their
  regression tests actually gate PRs.
- The e2e job runs serially (`workers: 1`) — if suite time becomes a problem,
  shard by spec file rather than enabling parallelism (mock store is
  per-process shared state).
- Reviewer: check the artifact upload path matches Playwright's output
  (`test-results/` at repo root, already gitignored).
