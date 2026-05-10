# Code Review: Phase 3 — Ingest Pipeline + Inline Curation

**Branch:** `preview`
**Date:** 2026-05-10
**Reviewer:** Kiro

## Stats

- Files Modified: 12
- Files Added: 22
- Files Deleted: 1
- New lines: ~2500
- Deleted lines: ~79

## Summary

Implements the Phase 3 ingest pipeline: `ingest/` CLI package (spaces-aware), `web/lib/ingest/` modules for server-side curation, `POST /api/curate` and `POST /api/upload` routes, space-aware index regeneration, and vault-tree refactor.

## Issues

```
severity: high
file: web/app/api/curate/route.ts
line: 32-42
issue: Sequential curation of multiple files regens indexes N times
detail: When no specific key is provided, the route loops over all raw/ files and calls runCuration() for each. Each runCuration() call regenerates both the space index AND master index. For 10 raw files, that's 20 index regenerations. The indexes should be regenerated once at the end, not per-file.
suggestion: Extract the index regen from runCuration() into the caller. Add a `skipIndexRegen` option to runCuration(), or split it into `curateFile()` (no index) + `finalizeSpace()` (index regen). The route calls curateFile() in a loop, then regenerates indexes once.
```

```
severity: high
file: web/app/api/upload/route.ts
line: 12-14
issue: No input sanitization on space name — path traversal possible
detail: The `space` field from user input is used directly in the S3 key: `${space}/raw/${file.name}`. A malicious space value like `../secrets` or `../../etc` could write to unexpected S3 paths. While S3 doesn't have a filesystem, the vault prefix logic could be bypassed.
suggestion: Validate space name: `/^[a-z0-9][a-z0-9-]*$/` (lowercase alphanumeric + hyphens, no slashes, no dots). Apply same validation in /api/curate.
```

```
severity: high
file: web/app/api/upload/route.ts
line: 17
issue: No sanitization on filename — could overwrite arbitrary keys in raw/
detail: `file.name` is user-controlled. A filename like `../../wiki/important.md` would write outside the raw/ folder. S3 keys allow `/` in names.
suggestion: Use `path.basename()` equivalent or strip all path separators: `file.name.replace(/[/\\]/g, '')`. Or better: slugify the filename.
```

```
severity: medium
file: web/lib/ingest/bedrock.ts
line: 11-12
issue: MODEL_ID and region read at module load time — not configurable per-request
detail: On Vercel, module-level constants are evaluated once when the serverless function cold-starts. If env vars change (e.g., via Vercel dashboard), the function needs a redeploy. This is standard Vercel behavior and acceptable, but worth noting.
suggestion: Acceptable for MVP. Document that env var changes require redeploy.
```

```
severity: medium
file: web/lib/ingest/generate.ts
line: 68
issue: YAML frontmatter title not escaped — quotes in title break YAML
detail: `title: "${entry.title}"` — if the AI returns a title containing double quotes (e.g., `The "Best" Approach`), the YAML becomes invalid: `title: "The "Best" Approach"`.
suggestion: Escape the title: `entry.title.replace(/"/g, '\\"')` or use single quotes with appropriate escaping.
```

```
severity: medium
file: web/app/api/docs/[...id]/route.ts
line: 120
issue: space extraction assumes all docs are in a space folder
detail: `const space = key.split('/')[0]` — if a doc exists at root level (e.g., `standalone.md`), space would be `standalone.md` which is not a valid space. regenerateSpaceIndex would fail or create a nonsensical index.
suggestion: Guard: `const parts = key.split('/'); if (parts.length > 1) { regenerateSpaceIndex(parts[0]); }` — only regen space index if the doc is actually in a space.
```

```
severity: low
file: web/lib/ingest/run.ts
line: 30
issue: If plan returns 0 pages, still regenerates indexes unnecessarily
detail: When Bedrock returns an empty plan (no pages to generate), the function still calls regenerateSpaceIndex + regenerateMasterIndex + appendLog. This is wasted work.
suggestion: Early return after plan if `plan.pages.length === 0`: return `{ rawKey, plan, pages: [] }` without index regen.
```

```
severity: low
file: ingest/src/commands/add.ts
line: 18
issue: readFileSync used — blocks the event loop
detail: `fs.readFileSync(file, 'utf-8')` blocks. For a CLI this is fine, but it's a code quality note.
suggestion: Acceptable for CLI. No change needed.
```

## Positive Notes

- Clean separation: upload is just S3 write, curation is the Bedrock pipeline. Decoupled correctly.
- The `parallel()` helper with concurrency limit is well-implemented.
- Error handling in the curate route catches per-file errors without aborting the batch.
- The `converseWithTool<T>()` generic wrapper is clean and reusable.
- Space-aware index regeneration correctly excludes `personal/` from master index.

## Build Verification

- `pnpm --filter @vaultmark/web build` passes ✓
- `pnpm --filter @vaultmark/ingest typecheck` passes ✓
