# Code Review: Star Toggle & ETag Propagation

**Branch:** `preview`
**Date:** 2026-05-08
**Reviewer:** Kiro

## Stats

- Files Modified: 6
- Files Added: 0
- Files Deleted: 0
- New lines: 28
- Deleted lines: 14

## Summary

This changeset adds ETag return from `putObject`, propagates star-toggle state from `DocToolbar` up through `DocReader` to `AppShell` (updating `liveDoc`), refreshes the sidebar tree after editor saves, and syncs the editor title into frontmatter before PUT.

## Issues

```
severity: high
file: web/app/api/docs/[...id]/route.ts
line: 130-145
issue: PATCH star-toggle has a read-modify-write race condition without optimistic concurrency
detail: The PATCH handler reads the document with getObject() (no ETag), modifies frontmatter, then writes with putObject() without passing ifMatch. If a concurrent PUT (editor save) lands between the read and write, the star toggle will silently overwrite the concurrent edit's content. This violates the project's own standard: "S3 writes use optimistic concurrency (checksum-based)."
suggestion: Use getObjectWithETag() instead of getObject(), then pass the etag to putObject(key, updated, etag). Catch ConcurrencyError and return 409 so the client can retry.
```

```
severity: medium
file: web/components/editor.tsx
line: 3
issue: gray-matter imported in a 'use client' component bundles Node.js library into client JS
detail: gray-matter requires('fs') at the top level. Next.js stubs fs as empty for client bundles so it works, but it adds ~30KB of unnecessary library code (gray-matter + section-matter + js-yaml) to the client bundle. All other usages of gray-matter in this project are server-side only.
suggestion: Extract the title-sync logic into a lightweight client-side function that manipulates the YAML frontmatter string directly (regex or a small parser), or move the frontmatter sync to the API route handler (which already parses frontmatter on PUT). The server already does `fm.updated = new Date().toISOString()` — it could also accept a `title` field in the PUT body and sync it there.
```

```
severity: medium
file: web/components/app-shell.tsx
line: 257
issue: getTree() error silently swallowed with empty catch
detail: If the tree refresh fails after a save, the sidebar shows stale data with no indication to the user. The project's conventions state: "Never swallow errors silently. Surface them clearly."
suggestion: Show a toast on failure: `getTree().then(setTree).catch(() => showToast('Failed to refresh sidebar'))`. This gives the user awareness that the tree is stale.
```

```
severity: low
file: web/components/doc-toolbar.tsx
line: 36
issue: Star toggle catch block silently discards network errors
detail: The catch block on line 36 does nothing when the PATCH request fails. The user clicks star, nothing happens, no feedback. This predates the current changeset but is now more relevant since the toggle propagates state upward.
suggestion: Add a toast or revert the optimistic UI state on failure. At minimum: `catch { setStarred(s => !s); }` to revert the toggle.
```

```
severity: low
file: web/lib/s3.ts
line: 98
issue: putObject returns empty string when S3 doesn't return an ETag
detail: The fallback `res.ETag ?? ''` means callers receive an empty string as a "valid" ETag. If this empty string is later passed as ifMatch to a subsequent write, S3 will reject it with PreconditionFailed. This is unlikely in practice (S3 always returns ETag for successful puts) but the type signature doesn't communicate the edge case.
suggestion: This is acceptable for now since S3 reliably returns ETag. If you want to be defensive, throw if ETag is missing rather than returning empty string.
```

## Positive Notes

- The ETag propagation from `putObject` → PATCH response → `onStarToggle` → `liveDoc` is a good pattern for keeping client state consistent.
- Syncing title into frontmatter in the editor ensures the source-of-truth (Markdown file) stays canonical.
- Tree refresh after save keeps the sidebar accurate without a full page reload.
- The changeset is focused and minimal — each file change serves a clear purpose.

## Build Verification

- `next build` passes cleanly (TypeScript + compilation).
- No lint errors introduced.
