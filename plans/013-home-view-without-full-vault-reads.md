# Plan 013: Stop reading every document body to render the home view

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat fead8f9..HEAD -- web/app/api/docs/route.ts web/lib/search.ts`
> On drift, compare "Current state" excerpts against live code; on mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (sort/snippet source changes; needs before/after verification)
- **Depends on**: plans/003 (e2e gate), plans/010 (frontmatter helpers — reuse them)
- **Category**: perf
- **Planned at**: commit `fead8f9`, 2026-07-03

## Why this matters

`GET /api/docs?view=recent|starred` — the default home view — lists the entire
vault and then `getObject`s **every document body** (batched 20) just to
extract frontmatter for at most 50 summaries. Cost scales with total vault
size, not the page size, on every home load. The in-memory search index
(`web/lib/search.ts`) already does exactly this crawl and caches the result —
back the home view with the same cached entries instead of a second
full-vault fan-out.

## Current state

- `web/app/api/docs/route.ts:69-97` — the GET handler:

  ```ts
  const keys = (await listObjects()).filter(isDocumentKey);
  const docs: DocSummary[] = [];
  for (let i = 0; i < keys.length; i += 20) {
    const batch = keys.slice(i, i + 20);
    const summaries = await Promise.all(batch.map(summarizeDoc));
    docs.push(...summaries.filter(Boolean));
  }
  const filtered = view === 'starred' ? docs.filter((d) => d.starred) : docs;
  filtered.sort(/* Date.parse(updated) desc */);
  return NextResponse.json(filtered.slice(0, limit));
  ```

  `summarizeDoc` (49-67) reads the body and derives: `id,title,path,
  source_type,updated,author,tags,starred,snippet`.
- `web/lib/search.ts:46-94` — `buildIndex()` performs the identical crawl into
  `SearchEntry { id,title,path,snippet,updated,source_type }`, cached in the
  module-level `_promise` until `invalidateSearchIndex()` (which every write
  path already calls). **Gap**: `SearchEntry` lacks `author`, `tags`, `starred`.
- `DocSummary` (route lines 16-26) is the client contract — `home-view.tsx`
  renders these fields. Shape must not change.
- Snippet derivations differ slightly today: `search.ts::extractSnippet`
  strips frontmatter then markdown chars, 200 chars; route's `extractSnippet`
  operates on `matter(raw).content` (frontmatter already removed), 160 chars.
  After unification the HOME view's snippet source becomes the search entry's
  — visually near-identical; e2e asserts existence, not exact text (verify by
  grepping the specs for snippet assertions before assuming).

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Typecheck | `pnpm typecheck`         | exit 0              |
| Unit      | `pnpm --filter @canopy/web test` | all pass |
| E2E       | `pnpm build && pnpm test:e2e` | all pass |

## Scope

**In scope**:
- `web/lib/search.ts` (extend `SearchEntry` with `author`, `tags`, `starred`;
  export a `getAllEntries()` accessor)
- `web/app/api/docs/route.ts` (GET only — POST untouched)
- `web/lib/__tests__/docs-view.test.ts` (create, if plan 004 landed)

**Out of scope**:
- `invalidateSearchIndex` call sites — already correct everywhere.
- Search ranking/behavior (`search`, `searchScoped` results must be unchanged
  apart from entries carrying three more fields).
- The star PATCH route — but NOTE: starring already calls
  `invalidateSearchIndex`? **Check**: `grep -n invalidateSearchIndex web/app/api/star` —
  if the star route does NOT invalidate, add the call there (one line; then
  that file joins in-scope) — otherwise a star toggle wouldn't show on the
  starred home view until another write. Verify rather than assume.
- Pagination beyond the existing `limit` param.

## Git workflow

- Branch: `advisor/013-home-view-from-index`
- Commit style: imperative, under 72 chars.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Enrich the index entries

In `web/lib/search.ts`: add `author: string`, `tags: string[]`,
`starred: boolean` to `SearchEntry`; populate them in `buildIndex()` from the
already-parsed `matter(raw)` result (use plan 010's `fmString`/`fmStringOr` if
present, else the `typeof` guards used for `updated`). Export:

```ts
/** All indexed entries (search + home view). Built lazily, cached until invalidated. */
export async function getAllEntries(): Promise<SearchEntry[]> { … }
```

Backing: keep the raw `entries` array alongside the Fuse instance in the
cached promise (`{ fuse, entries }`) — adjust `getFuse()`'s internal type;
`search()` keeps returning the same results.

**Verify**: `pnpm typecheck` → exit 0; unit tests still pass.

### Step 2: Rewrite the GET handler on top of `getAllEntries`

```ts
const entries = await getAllEntries();
const docs = entries.map((e) => ({
  id: e.id, title: e.title, path: e.path, source_type: e.source_type,
  updated: e.updated, author: e.author, tags: e.tags, starred: e.starred,
  snippet: e.snippet,
}));
// then the existing filter/sort/slice, unchanged
```

Delete `summarizeDoc` and its now-unused imports (`getObject`, `matter`, …) —
POST keeps its own imports; prune carefully.

**Verify**: `pnpm typecheck` → exit 0.

### Step 3: Staleness check on the star path

Per the Scope note: confirm the star route invalidates the index after a
toggle; add the call if missing. Manual check: `pnpm dev` with `MOCK_S3=1`,
seed, star a doc via `curl -X PATCH localhost:3000/api/star/<key>`, then
`GET /api/docs?view=starred` → the doc appears.

**Verify**: the curl sequence above returns the starred doc.

### Step 4: Regression

**Verify**: `pnpm build && pnpm test:e2e` → all pass (home view, search,
star, editor specs cover both consumers of the index). Unit (if 004): seed
mock store with 3 docs (one starred, distinct `updated`), assert
`GET`-handler-level ordering and starred filtering via `getAllEntries`.

## Test plan

- Unit: entries carry author/tags/starred; recent ordering by `updated` desc;
  starred filter.
- E2E: existing home/search/star specs.

## Done criteria

- [ ] `pnpm typecheck`, unit, e2e all green
- [ ] `web/app/api/docs/route.ts` GET no longer calls `listObjects`/`getObject` (`grep -n "listObjects\|getObject" web/app/api/docs/route.ts` → hits only in POST)
- [ ] Star → starred-view visibility verified (Step 3)
- [ ] No files outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- An e2e spec asserts exact snippet text that differs between the two
  extractors — report; don't tweak extractors to match.
- The `{ fuse, entries }` cache restructure breaks `searchScoped`'s
  over-fetch behavior in a way a test catches.
- Memory concern: if the vault in a real deployment is so large that holding
  entries is a problem, that's plan 014's territory — don't add eviction here.

## Maintenance notes

- This makes the search index the de-facto metadata store for TWO surfaces —
  plan 014 (incremental updates) becomes more valuable and slightly wider in
  blast radius; its executor must know home view now depends on entry
  freshness.
- Reviewer: check cold-start behavior — first home load now pays the index
  build (same crawl as before, once) and every subsequent load is free until
  the next write.
