# Plan 004: Add a unit-test baseline (vitest) for scope isolation, sanitization, and path logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/agent-tools.ts web/lib/search.ts web/lib/vault-paths.ts web/lib/flags.ts web/lib/markdown.ts web/lib/scope.ts web/package.json .github/workflows/ci.yml`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (composes with 003; both touch ci.yml — coordinate if run concurrently)
- **Category**: tests
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`web/` has no unit-test runner at all. The two places where a regression
becomes a security incident are pure functions that are cheap to test:

1. **Scope isolation** — `isInAllowedScope` in `web/lib/agent-tools.ts` gates
   what the Bedrock agent may read. Its own doc comment records that a naive
   version of this logic ("startsWith on `generated/`") was "a real leak we
   shipped and caught in the v1 postmortem". Nothing prevents a refactor from
   reintroducing it.
2. **Markdown sanitization** — `renderMarkdown` in `web/lib/markdown.ts` is
   the XSS boundary for all rendered vault content and agent output.

Plus a large amount of regex-heavy path classification in
`web/lib/vault-paths.ts` that everything (routes, search, indexing) depends on.

## Current state

- No jest/vitest config or `*.test.*` files exist anywhere under `web/`
  (`web/lib/__smoke__/` holds Markdown notes, not tests). Only
  `infra/lambda/curate/` has jest — it is a separate npm package, not part of
  the pnpm workspace test story.
- `web/package.json` scripts: `dev`, `build`, `start`, `lint` (= `tsc
  --noEmit`), `typecheck`. No `test`.
- Functions to cover (all pure or near-pure, all currently untested):
  - `web/lib/agent-tools.ts:161-175` — `isInAllowedScope(key, scopeMode, userId)`;
    modes `'shared' | 'user' | 'both'`; uses `inferScopeFromKey` and falls back
    to the default user id.
  - `web/lib/search.ts:117-123` — `isAllowedByScope` (module-private; test via
    the exported `searchScoped` or export it — see Step 3).
  - `web/lib/scope.ts:95-101` — `inferScopeFromKey` (`^users/([^/]+)/` → user).
  - `web/lib/vault-paths.ts:79-134` — `isDocumentKey`, `sourceTypeFromKey`,
    `displayPathForKey`.
  - `web/lib/flags.ts:73-77` — `parseFlag` (module-private; test via
    `computeFlags`/`FLAGS` with env manipulation, or export `parseFlag` — see
    Step 3).
  - `web/lib/markdown.ts:30-33` — `renderMarkdown(raw)` → sanitized HTML.
- The postmortem-documented leak shape (must be a named regression test):
  shared-scope checks must NOT match `users/<id>/generated/...` keys, and
  user-scope checks must NOT match `generated/...` shared keys. From
  `agent-tools.ts:125-129`:

  ```
  * A naive substring/ startsWith check on `generated/` would match BOTH
  * `generated/wiki/foo.md` (shared) AND `users/<id>/generated/wiki/foo.md`
  * (user) — a real leak we shipped and caught in the v1 postmortem.
  ```

- `web/lib/flags.ts` reads env at module load (`export const FLAGS =
  computeFlags()`), and `web/lib/vault-paths.ts:4` bakes
  `NEXT_PUBLIC_VAULT_USER_ID` at import — tests that vary env must use
  `vi.resetModules()` + dynamic `import()`.
- Repo conventions: TypeScript strict; kebab-case filenames; no barrel
  exports unless 3+ public exports.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `pnpm install`           | exit 0              |
| Typecheck | `pnpm typecheck`         | exit 0              |
| New: unit | `pnpm --filter @vaultmark/web test` | all tests pass |

## Scope

**In scope** (the only files you should modify/create):
- `web/package.json` (add `vitest` devDependency + `"test": "vitest run"` script)
- `web/vitest.config.ts` (create; must resolve the `@/` alias to `web/`)
- `web/lib/__tests__/agent-tools.test.ts` (create)
- `web/lib/__tests__/vault-paths.test.ts` (create)
- `web/lib/__tests__/scope.test.ts` (create)
- `web/lib/__tests__/flags.test.ts` (create)
- `web/lib/__tests__/markdown.test.ts` (create)
- `web/lib/search.ts` and `web/lib/flags.ts` — ONLY if exporting a private
  function per Step 3's rule
- Root `package.json` (add `"test:unit": "pnpm --filter @vaultmark/web test"`)
- `.github/workflows/ci.yml` (add the unit-test step to the existing `web` job)

**Out of scope** (do NOT touch):
- Any behavior change in the functions under test. If a test reveals a bug,
  write the test to document CURRENT behavior with a `// BUG:` comment and
  report it — do not fix logic in this plan.
- `tests/e2e/` (Playwright) and `playwright.config.ts`.
- `infra/lambda/curate/` (has its own jest).

## Git workflow

- Branch: `advisor/004-unit-test-baseline`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Install vitest and wire scripts

Add to `web/package.json` devDependencies: `vitest` (latest 3.x). Scripts:
`"test": "vitest run"`. Create `web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: { environment: 'node', include: ['lib/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname) } },
});
```

**Verify**: `pnpm install` → exit 0; `pnpm --filter @vaultmark/web test` →
"no test files found" (exit code may be non-zero — acceptable at this step).

### Step 2: Scope-isolation characterization tests

`web/lib/__tests__/agent-tools.test.ts` + `scope.test.ts`. Cover the full
matrix for `isInAllowedScope` (import from `@/lib/agent-tools`):

| key | 'shared' | 'user' (userId='alice') | 'both' (userId='alice') |
|---|---|---|---|
| `generated/wiki/a.md` | true | false | true |
| `authored/wiki/a.md` | true | false | true |
| `users/alice/generated/wiki/a.md` | **false** (postmortem case) | true | true |
| `users/alice/authored/personal/a.md` | false | true | true |
| `users/bob/authored/personal/a.md` | false | **false** (cross-user) | **false** |
| `_system/usage-log.jsonl` | true* | false | true* |

*The `_system/` rows document current behavior — `inferScopeFromKey` treats
non-`users/` keys as shared. Mark with a comment that key-shape gating is the
docs-route's job (see plan 002), not this function's.

Name the postmortem rows explicitly, e.g.
`it('does not leak user-scoped generated keys into shared scope (v1 postmortem)')`.

Also test `inferScopeFromKey`: `users/alice/x.md` → `{scope:'user', userId:'alice'}`;
`generated/x.md` → shared; edge: `users/` prefix without id segment.

**Verify**: `pnpm --filter @vaultmark/web test` → all pass.

### Step 3: Search scope filter and flags

- `isAllowedByScope` in `web/lib/search.ts` is module-private. Export it
  (smallest change; add a doc comment "exported for tests + route reuse") and
  mirror the Step 2 matrix for its `SearchOptions` shape, including
  `scope:'user'` with and without `userId`.
- `web/lib/flags.ts`: test via env + module reload:

  ```ts
  beforeEach(() => vi.resetModules());
  it('absent var falls back to default (agent on, upload off)', async () => {
    delete process.env.FEATURE_AGENT; delete process.env.FEATURE_UPLOAD;
    const { FLAGS } = await import('@/lib/flags');
    expect(FLAGS.agent).toBe(true); expect(FLAGS.upload).toBe(false);
  });
  ```

  Cases: absent → default; each OFF token (`off/false/0/no/disabled`, mixed
  case, padded whitespace) → false; any other value (`on`, `1`, `yes`,
  `banana`) → true.

**Verify**: `pnpm --filter @vaultmark/web test` → all pass; `pnpm typecheck` → exit 0.

### Step 4: vault-paths classification tests

`isDocumentKey`: accepts the four content-root `.md` shapes; rejects
non-`.md`, `raw/…`, `_system/…`, `users/<id>/raw/…`, `users/<id>/_system/…`,
`index.md`/`log.md`/`log-2026.md` filenames, `.keep`. `sourceTypeFromKey`:
`generated/…`→generated, `users/<id>/generated/…`→generated,
`users/<id>/authored/personal/…`→personal, `authored/…`→authored.
`displayPathForKey`: strips roots, joins with ` / `, personal-prefix special
case.

**Verify**: `pnpm --filter @vaultmark/web test` → all pass.

### Step 5: Sanitization table for `renderMarkdown`

`markdown.test.ts` — a payload table asserting the OUTPUT (async function):

- `<script>alert(1)</script>` → output contains no `<script`
- `[x](javascript:alert(1))` → no `javascript:` href in output
- `<img src=x onerror=alert(1)>` → no `onerror`
- `<iframe src=…>` → no `<iframe`
- frontmatter block `---\ntitle: t\n---` at start → not rendered as body text
- happy path: heading gets an `id=` (rehype-slug), GFM table renders `<table>`, fenced code renders `<pre><code>`

Keep assertions on the sanitized-output level (`expect(html).not.toContain(...)`),
not on internal AST shapes.

**Verify**: `pnpm --filter @vaultmark/web test` → all pass.

### Step 6: Wire into CI

In `.github/workflows/ci.yml`, `web` job, add `- run: pnpm test` between the
`pnpm typecheck` and `pnpm build` steps (working-directory is already `web`).
Add root script `"test:unit": "pnpm --filter @vaultmark/web test"`.
If plan 003 already merged a `web-e2e` job, leave it untouched.

**Verify**: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` → exit 0.

## Test plan

This plan IS the test plan: ~5 new test files, ≥40 assertions across the
matrices above. No existing test file to model after in `web/` — this creates
the pattern (table-driven `describe`/`it.each`).

## Done criteria

- [ ] `pnpm --filter @vaultmark/web test` exits 0 with ≥5 test files
- [ ] A test named to reference the postmortem/shared-vs-user leak exists and passes
- [ ] `pnpm typecheck` exits 0
- [ ] CI `web` job runs unit tests before build
- [ ] No behavior change in any `web/lib` module except optional `export` keyword additions (verify: `git diff web/lib -- ':!web/lib/__tests__'` shows only export-keyword/doc-comment lines)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A test reveals `isInAllowedScope` or `renderMarkdown` currently FAILS a
  security-relevant case (e.g. a payload passes sanitization) — report
  immediately; do not fix logic here.
- The `@/` alias cannot be made to work in vitest without changing
  `web/tsconfig.json` in ways that affect the app build.
- vitest cannot run against this Next.js/TS setup without transpilation
  gymnastics (report the error rather than adding babel/jest).

## Maintenance notes

- Plans 007, 013, 014, 015, 016 assume this runner exists for their own tests.
- The `_system/` rows in the Step 2 matrix intentionally document lenient
  current behavior; if plan 002 lands, key-shape gating lives in the routes —
  don't "fix" it here later without a design decision.
- Reviewer: check no test asserts on exact sanitized HTML strings (brittle
  across rehype-sanitize upgrades) — containment assertions only.
