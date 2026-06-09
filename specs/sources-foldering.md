# Sources Foldering (deterministic, raw-key-derived)

**Status:** Planned, ready to implement
**Scope:** AI-generated tree only (`generated/<space>/sources/...`).

## Problem

After the latest reprocess, every per-source page lives flat under `generated/wiki/sources/<slug>.md`. Hundreds of files, no internal structure, no way to navigate by project in the portal sidebar. The architectural intent had two layers — flat `sources/` atoms + synthesized `<category>/` rollups — but in practice users (you) see only the flat dump because synthesis hasn't run yet, and the flat dump is the wrong shape for browsing.

A separate routing bug (everything forced into `wiki/` regardless of `card.suggestedSpaces`) was fixed in a prior commit and is **not** revisited here.

## Goal

Introduce **navigable, project-grouped structure** to `generated/<space>/sources/` while preserving every property of the existing system that matters:

- Citation stability — a slug at a known path stays at that path (existing rollups, when they exist, embed `sources/<slug>.md` links).
- Incremental processing — `processedAt` history is preserved, future runs only touch new/changed `raw/` files.
- Zero impact on `authored/` content (your `articles` space, hand-written Markdown).
- Zero touches to `raw/` (never written, never deleted).

## Design

### Deterministic placement

Source-page paths become:

```
generated/<space>/sources/<placement>/<slug>.md
```

`placement` is computed in code from `rawKey`, **not chosen by an LLM**:

```ts
function placementFromRawKey(rawKey: string): string {
  const project = rawKey.match(/^raw\/projects\/([^/]+)\/.+/);
  if (project) return `projects/${slugifyLabel(project[1])}`;

  const top = rawKey.match(/^raw\/([^/]+)\/.+/);
  if (top) return slugifyLabel(top[1]);

  return 'inbox';
}
```

Examples:
- `raw/projects/CodeMMORPG/PRD.md` → `projects/codemmorpg`
- `raw/projects/AIvaro/roadmap.md` → `projects/aivaro`
- `raw/people/john.md` → `people`
- `raw/random-note.md` → `inbox`

Slug (`sourceSlug` in `source-card.ts`) is unchanged — same hash-suffixed identifier as today. Only the folder changes.

### Why deterministic, not LLM-chosen

- **Citation stability.** Re-extracting the same `rawKey` always produces the same `placement`. Existing rollup links (when synthesis runs) never break across re-runs.
- **Zero Bedrock cost.** Placement decision is a string match, not a model call.
- **No taxonomy drift.** No `tools` vs `tooling` vs `developer-tools` divergence; the folder shape mirrors the `raw/` layout you already maintain.
- **No seed list to keep current.** New projects appear under `raw/projects/<NewThing>/` and route correctly with zero config changes.
- **Trivial reasoning.** A reader of `generated/wiki/sources/projects/codemmorpg/` knows exactly which `raw/` files contributed without consulting card frontmatter.

The cost: you can't say "put all PRDs under `prds/` regardless of source project." We're betting that mirroring `raw/` is the right shape. If it turns out not to be, `placementFromRawKey` is the single point to override.

### What stays the same

- Per-source card JSON in `_system/source-cards/<hash>.json` — keyed by content hash, unchanged.
- Slug derivation — unchanged.
- The processed-manifest schema — unchanged. No `manifestVersion` bump.
- The extraction prompt — unchanged. The LLM is not asked for placement.
- The synthesis pipeline (`cluster.ts`, `synthesis.ts`) — unchanged. Closed `concepts | features | projects` categories stay (see Out of scope).

### Migration (one-shot, no Bedrock)

`raw/` is never touched. Existing source-card JSONs (`_system/source-cards/`) are mutated in-place to point at new paths; existing rendered `.md` files are copied to new paths then the old keys are deleted.

Steps, per scope (`shared` and each user scope):

1. List every `_system/source-cards/<hash>.json`.
2. For each card JSON:
   - Read `rawKey` and current `sourcePage`.
   - Compute `newSourcePage = generated/<space>/sources/<placementFromRawKey(rawKey)>/<basename(sourcePage)>`.
   - If `newSourcePage === sourcePage`, skip (idempotent re-run).
   - `s3 CopyObject` old `sourcePage` → `newSourcePage`.
   - Write card JSON back with updated `sourcePage`.
3. Update `_system/processed.json`: for each entry whose `pages[]` contains the old path, swap to the new path. Leave `processedAt` and `hash` untouched.
4. Delete the old `sourcePage` keys (a second pass after every copy + manifest write succeeds, so a crash mid-run leaves a recoverable state).

No `processedAt` is rewritten. No Bedrock call is made. Synthesis manifest is not touched (no rollups exist yet — confirmed via `aws s3 ls generated/wiki/` showing only `PRE sources/`). If rollups exist when the script eventually runs, an additional pass to rewrite citation paths inside rollup bodies is required; the script will detect rollups and refuse rather than corrupt them.

The migration lives at `infra/lambda/curate/scripts/refolder-sources.ts`, invokable locally with AWS creds via `pnpm --filter curate-lambda refolder -- --space wiki --scope shared`. Defaults to `--dry-run`; the operator must pass `--apply` to actually mutate S3.

### Ongoing operation after migration

- New `raw/` upload → `processSource` writes directly to `sources/<placement>/<slug>.md` (placement computed from `rawKey`).
- Edited `raw/` file (hash changed) → existing pending logic flags it → `processSource` writes new page. If `rawKey` is unchanged, `placement` is unchanged, slug unchanged — same path, overwritten. No orphan.
- Re-organized `raw/` (file moved between project dirs) → new `rawKey` is a fresh manifest entry; old `rawKey` becomes orphaned in the manifest. The migration script can be re-run to clean up; or a future PR adds rawKey-change detection. Out of scope here.

### UI: Last curated + N pending badge

`/api/raw` response gains:

```json
{ "space": "...", "count": 0, "keys": [...], "total": 50, "lastProcessedAt": "2026-06-06T..." }
```

`lastProcessedAt` = `max(processedAt)` across manifest entries for the queried space, or `null` if the manifest is empty.

Sidebar (`web/components/sidebar.tsx`) renders a small badge next to the existing **Process pending** button:

```
Last curated 2h ago · 12 pending
```

Reuses the existing fetch; one extra field on the JSON, one small component on the sidebar.

## Files touched

**Lambda (`infra/lambda/curate/`):**
- `paths.ts` — add `placementFromRawKey(rawKey)` and `sourcePageKey(prefix, placement, slug)`.
- `ingest.ts` — compute `placement` from `rawKey`, use `sourcePageKey` for `pagePath`. Persist `placement` on durable card JSON (so the migration script can verify idempotency and future readers see it without re-deriving).
- `source-card.ts` — add `placement` to rendered frontmatter for human readability.
- `types.ts` — add optional `placement?: string` to `SourceCard`.
- `scripts/refolder-sources.ts` (new) — one-shot migration CLI.

**Web (`web/`):**
- `app/api/raw/route.ts` — include `lastProcessedAt` in response.
- `components/sidebar.tsx` — render badge near "Process pending".

**No changes to:**
- `cluster.ts`, `synthesis.ts`, `synthesis-prompt.ts`, `synthesis-manifest.ts` — synthesis untouched.
- `manifest.ts` — no schema bump.
- `prompt.ts` — extraction prompt unchanged.
- `structure.ts` / `_system/structure.json` — no `folders` block needed.
- `web/lib/curate-pending.ts` — pending detection unchanged.

## Deploy + smoke

1. Build + deploy curate Lambda (existing CDK).
2. Build + deploy `web/` (existing pipeline).
3. Open portal — sidebar shows `Last curated <relative> · 0 pending` (manifest unchanged, lastProcessedAt now visible).
4. Run the migration script with `--dry-run` from local. Verify plan output looks sane (one rename per card, all `sources/*.md` → `sources/projects/<x>/*.md` etc.).
5. Run with `--apply`. Verify `aws s3 ls generated/wiki/sources/projects/codemmorpg/` shows the expected files; top-level `generated/wiki/sources/*.md` is empty.
6. Open portal — tree now shows nested `projects/<name>/` folders. Pending count unchanged.
7. Upload a new `raw/projects/CodeMMORPG/test.md` → pending becomes 1 → click Process pending → file lands at `generated/wiki/sources/projects/codemmorpg/test-<hash>.md`.

## Rollback

- Migration script is idempotent; re-running is safe.
- If S3 bucket versioning is enabled (recommended), old keys can be restored.
- If `placementFromRawKey` has a bug, the script can be inverted (a `reverse-refolder` mode) — out of scope to write proactively; the data needed lives in card JSON.
- Code rollback: `placementFromRawKey` is one helper; reverting `ingest.ts` to the prior flat path restores the previous code path. Existing foldered pages then become orphans on next re-extraction; recovery is "re-run the script" or "leave them, they remain readable at their nested path."

## Out of scope (deliberate)

- **Open synthesis categories.** Currently `concepts | features | projects` (closed union). Opening this requires Bedrock-driven category emission, drift handling, manifest schema bump — none of which is needed today (no rollups exist). Re-evaluate after synthesis runs at least once on the foldered tree.
- **LLM-chosen placement.** Considered and rejected — see "Why deterministic, not LLM-chosen."
- **`folders.sources` / `folders.categories` in `structure.json`.** Not needed under the deterministic design.
- **Cross-space hint loading.** `loadPlacementHints` still samples only the default generated space; multi-space hint visibility is a separate cleanup.
- **`articles` / authored content.** Out of this code path entirely — the curate Lambda doesn't touch authored paths.
- **`raw/` rewrites.** Never written or deleted by this work.

## Follow-ups worth tracking

- Run synthesis after migration; observe what the closed category set produces. Decide whether to open it up.
- Detect `rawKey` deletions / renames during pending check; offer orphan cleanup in the UI.
- Optionally expose `placement` as a frontmatter-driven override (a `raw/` file with `placement: tools` frontmatter wins over `placementFromRawKey`). Cheap escape hatch if the deterministic mapping ever feels too rigid.
