# Code Review: Library Modal (v2 wireframe port)

**Date:** 2026-05-14
**Branch:** preview
**Reviewer:** Kiro

## Stats

- Files Modified: 5 (app-shell.tsx, sidebar.tsx, home-view.tsx, icons.tsx, globals.css)
- Files Added: 1 (upload-modal.tsx)
- Files Deleted: 1 (upload-panel.tsx)
- New lines: ~860 (implementation only, excluding portal wireframes/archive)
- Deleted lines: ~250

---

## Issues

```
severity: high
file: web/components/upload-modal.tsx
line: 55
issue: Stale `space` in useEffect dependency causes fetch with outdated value
detail: The first useEffect (line 49) resets state when `open` changes but references `space` in its body (`if (folders.length && !folders.includes(space)) setSpace(folders[0])`). However `space` is not in the dependency array — this is intentional to avoid re-running on every space change, but it means the closure captures a stale `space` value. On second open, the check `!folders.includes(space)` may use the wrong value.
suggestion: Use a ref for space in this check, or move the conditional setSpace into the second useEffect that already depends on `space`.
```

```
severity: medium
file: web/components/upload-modal.tsx
line: 83
issue: processFile captures `space` and `autoIndex` at callback creation time
detail: `processFile` is memoized with `[space, autoIndex, updateFile]`. If the user changes the space selector or auto-index toggle while files are queued and processing sequentially, already-queued files will use the old values since the chain was created with the old `processFile` reference. The `addFiles` function captures `processFile` at call time and chains all files with it.
suggestion: Use a ref for `space` and `autoIndex` inside processFile so it always reads the latest value, or disable the space/autoIndex controls while files are processing.
```

```
severity: medium
file: web/components/upload-modal.tsx
line: 130
issue: Pending stream has no abort/cancel mechanism
detail: `startPendingStream` reads from a fetch stream but there's no way to abort it if the user closes the modal or switches tabs mid-stream. The `reader.read()` loop will continue running in the background, calling `setPendingStream` on an unmounted or reset component.
suggestion: Use an AbortController passed to the fetch call. Abort it in the cleanup of a useEffect or when the modal closes.
```

```
severity: medium
file: web/components/upload-modal.tsx
line: 55
issue: Fetching tree from hardcoded `/api/vaults/default/tree` path
detail: The tree endpoint is actually at `/api/vaults/[id]/tree` where `[id]` is a dynamic segment. Using `default` assumes a vault ID that may not exist — the actual tree used by AppShell comes from `getTree()` in `lib/api.ts`. This fetch may 404 or return unexpected data.
suggestion: Either pass the spaces list as a prop from AppShell (which already has the tree), or use the same `getTree()` helper from `lib/api.ts`.
```

```
severity: low
file: web/components/upload-modal.tsx
line: 64
issue: Pending count fetch has no AbortController cleanup
detail: Same pattern as the previous review — rapid space switching can cause stale responses to overwrite the count.
suggestion: Add AbortController with cleanup return in the useEffect.
```

```
severity: low
file: web/components/upload-modal.tsx
line: 96
issue: Response body read twice — `res.json()` called after `!res.ok` check, then again on success
detail: On line 88, if `!res.ok`, the code calls `res.json()`. On line 92, it calls `res.json()` again for the success path. This is correct (only one path executes due to `return`), but the success `res.json()` is called after `updateFile(...progress: 100)` — if the JSON parse fails, the file stays at "uploading 100%" forever with no error state.
suggestion: Wrap the success `res.json()` in try/catch or chain it before updating progress to 100.
```

```
severity: low
file: web/components/sidebar.tsx
line: 111
issue: index-card shows doc count from tree but not actual pending count
detail: The sidebar index-card shows `{countDocs(fullTree)} indexed` but doesn't show the pending count. The wireframe shows "47 pending" alongside the indexed count. Without fetching from `/api/raw`, the sidebar can't show this.
suggestion: Either pass pending count as a prop, or accept this as a known deviation from the wireframe (pending count is visible in the modal header and tab badge instead).
```

```
severity: low
file: web/components/home-view.tsx
line: 76
issue: `<a>` element used without href for the "browse" link in drop zone
detail: The `<a onClick={...}>browse</a>` has no `href` attribute. Screen readers won't announce it as a link, and it won't be keyboard-focusable.
suggestion: Use `<button>` styled as a link, or add `href="#"` with `e.preventDefault()`, or `role="button" tabIndex={0}`.
```

---

## Summary

No critical or security issues. The main concerns are:

1. **Stale closures** in the file processing chain (medium) — if user changes space/autoIndex while files are queued, behavior is unpredictable.
2. **No abort on stream** (medium) — pending tab stream continues after modal close.
3. **Hardcoded tree endpoint** (medium) — may 404; should use the same data source as AppShell.

The rest are low-severity polish items. Overall the implementation is well-structured and matches the wireframe design closely.
