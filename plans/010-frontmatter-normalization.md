# Plan 010: Normalize frontmatter reads instead of `as string` casts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/lib/frontmatter.ts web/app/api/docs/ web/lib/index-gen.ts web/app/api/reindex/route.ts web/lib/search.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/004-unit-test-baseline-vitest.md (for the unit tests)
- **Category**: bug
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

gray-matter parses YAML frontmatter with js-yaml: an unquoted ISO timestamp
becomes a `Date` object, a numeric-looking title becomes a `number`. The code
overrules the compiler with `as string` casts, and `?? ''` never fires for a
`Date` (it's not nullish) — so a `Date` flows into contracts typed `string`
(`DocSummary.updated`) and only works today by accidental coercion inside
`Date.parse(String)`. Any future string method on these fields (`.slice`,
`.localeCompare`) is a runtime error on real vault content. `web/lib/search.ts:61`
already guards this correctly (`typeof data.updated === 'string' ? … : ''`),
proving the hazard is known — this plan makes that guard the single shared
boundary.

## Current state

- Cast sites (all read `matter(raw).data`):
  - `web/app/api/docs/route.ts:55,57,58,59` — in `summarizeDoc`:

    ```ts
    title: (fm.title as string) || keyToTitle(key),
    source_type: (fm.source_type as string) || sourceTypeFromKey(key),
    updated: (fm.updated as string) ?? '',
    author: (fm.author as string) ?? 'unknown',
    ```

  - `web/app/api/docs/[...id]/route.ts:47,50-54` — same shape in `GET` (`title`,
    `source_type`, `updated`, `author`).
  - `web/lib/index-gen.ts:25` and `web/app/api/reindex/route.ts:25` —
    `(data.title as string) || toTitleCase(…)`.
- The correct existing pattern (`web/lib/search.ts:59-64`):

  ```ts
  const title = (data.title as string) || keyToTitle(key);      // ← also a cast, fix too
  const updated = typeof data.updated === 'string' ? data.updated : '';
  const sourceType = typeof data.source_type === 'string' ? data.source_type : sourceTypeFromKey(key);
  ```

- Tags handling (`docs/route.ts:60`) is already type-safe (`Array.isArray`);
  leave it.
- Frontmatter written by this codebase uses `new Date().toISOString()` — a
  QUOTED string via `matter.stringify`, so round-tripped docs are fine; the
  hazard is externally-authored/uploaded files with unquoted dates.
- Convention: kebab-case lib modules under `web/lib/`, single-purpose.

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @canopy/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/frontmatter.ts` (create — the helper)
- `web/lib/__tests__/frontmatter.test.ts` (create)
- The cast sites listed above (docs routes, index-gen, reindex route, search.ts)

**Out of scope**:
- Changing what gets WRITTEN to frontmatter anywhere.
- `web/lib/agent-tools.ts:206` — already guards title with `typeof`; leave.
- Any `DocSummary`/API response shape change — fields stay `string`.

## Git workflow

- Branch: `advisor/010-frontmatter-normalization`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create the boundary helper

`web/lib/frontmatter.ts`:

```ts
/**
 * Normalizers for gray-matter frontmatter values. YAML turns unquoted ISO
 * timestamps into Date objects and numeric-looking scalars into numbers;
 * every read must pass through here before entering a `string`-typed contract.
 */
export function fmString(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/** Like fmString but with a fallback when the result is empty. */
export function fmStringOr(v: unknown, fallback: string): string {
  return fmString(v) || fallback;
}
```

**Verify**: `pnpm typecheck` → exit 0.

### Step 2: Replace the cast sites

- `docs/route.ts` `summarizeDoc`: `title: fmStringOr(fm.title, keyToTitle(key))`,
  `source_type: fmStringOr(fm.source_type, sourceTypeFromKey(key))`,
  `updated: fmString(fm.updated)`, `author: fmStringOr(fm.author, 'unknown')`.
- `docs/[...id]/route.ts` GET: same four substitutions.
- `index-gen.ts:25` and `reindex/route.ts:25`: `fmStringOr(data.title, toTitleCase(…))`.
- `search.ts:59-64`: replace all three lines with the helpers (this also
  removes its `as string` on title).

After this, `grep -rn "as string) ||\|as string) ??" web/app web/lib` should
return no frontmatter-read hits.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Unit tests

`web/lib/__tests__/frontmatter.test.ts`: string passthrough; `Date` →
ISO string (fixed date, assert exact); number `3` → `'3'`; `null`/`undefined`/
object → `''`; `fmStringOr` fallback on empty. Plus one integration-style case:
`matter('---\nupdated: 2026-07-03T10:00:00Z\ntitle: 42\n---\nbody')` (unquoted)
→ `fmString(data.updated)` is the ISO string, `fmStringOr(data.title,'x')` is `'42'`.

**Verify**: `pnpm --filter @canopy/web test` → all pass.

### Step 4: Full regression

**Verify**: `pnpm build && pnpm test:e2e` → all pass (home view sorting,
doc reader, search all exercise these fields).

## Test plan

As Step 3; e2e as the integration gate. Model tests after plan 004's
table-driven style.

## Done criteria

- [ ] `pnpm typecheck` + unit + e2e all exit 0
- [ ] `grep -rn "fm.updated as string\|data.title as string" web/` → no hits
- [ ] `web/lib/frontmatter.ts` exists with the two exported helpers and tests
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- A cast site turns out to feed a NON-string contract (e.g. something
  downstream actually wants the Date) — report it.
- The `Date.parse`-based sort in `docs/route.ts:90-94` changes order for any
  e2e-seeded fixture after normalization (it shouldn't — ISO strings parse
  identically — but if a spec fails on ordering, stop).

## Maintenance notes

- New frontmatter reads must use these helpers; plan 019's ESLint could later
  enforce a no-`as`-on-`fm.`/`data.` rule (`no-restricted-syntax`).
- Reviewer: confirm no response-shape drift (fields were `string` before and
  after; only the runtime values for weird YAML change — from `Date`
  object/number leaking through to a proper string).
