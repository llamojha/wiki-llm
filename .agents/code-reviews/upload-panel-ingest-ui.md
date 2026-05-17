# Code Review: Upload Panel & Ingest UI

**Date:** 2026-05-14
**Branch:** preview
**Reviewer:** Kiro

## Stats

- Files Modified: 4
- Files Added: 4
- Files Deleted: 0
- New lines: 420
- Deleted lines: 17

---

## Issues

```
severity: medium
file: web/components/upload-panel.tsx
line: 103
issue: JSON.parse without try/catch on streamed NDJSON lines
detail: If the server sends a malformed line (partial JSON due to chunking edge case, or an unexpected error message), JSON.parse will throw and the entire curate function will jump to the catch block, losing progress context. Streamed data is inherently less reliable than a single JSON response.
suggestion: Wrap the JSON.parse in a try/catch inside the for loop, skip malformed lines rather than aborting the whole operation.
```

```
severity: medium
file: web/components/upload-panel.tsx
line: 78
issue: Stale closure over `space` in the `upload` callback
detail: The `upload` function is memoized with `useCallback([space])`, but `curate` and `reindex` are not memoized and close over `space` directly. This is fine for curate/reindex (they read current state at call time), but if `upload` is triggered and the user somehow changes the space selector mid-upload (unlikely but possible since the select is still rendered briefly), the FormData will use the space value captured at callback creation time. Not a real bug given the stage transitions hide the selector, but worth noting.
suggestion: No action needed — stage transitions prevent this. Documenting as informational.
```

```
severity: medium
file: web/app/api/raw/route.ts
line: 10
issue: No input validation on `space` parameter
detail: The `/api/raw` GET endpoint accepts any string as the `space` query param without validating it against the SPACE_RE pattern used in `/api/curate` and `/api/upload`. A crafted space value like `../` or `../../` could potentially list objects outside the intended prefix (though S3 key semantics and the `listObjects` implementation likely prevent actual traversal).
suggestion: Add the same SPACE_RE validation: `if (!SPACE_RE.test(space)) return NextResponse.json({ detail: '...' }, { status: 400 });`
```

```
severity: medium
file: web/app/api/reindex/route.ts
line: 9
issue: No input validation on `space` parameter
detail: Same as above — the reindex route accepts any string as `space` without SPACE_RE validation. Could pass arbitrary prefixes to `regenerateSpaceIndex`.
suggestion: Add SPACE_RE validation, consistent with curate and upload routes.
```

```
severity: low
file: web/components/upload-panel.tsx
line: 18
issue: `space` state initialized from `spaces[0]` but not synced when `spaces` prop changes
detail: If the tree refreshes and the spaces list changes (e.g., a new space is created), the select will show the new options but `space` state may still hold a stale value that's no longer in the list. Edge case — spaces rarely change mid-session.
suggestion: Add a useEffect that resets `space` to `spaces[0]` if the current value is not in the new `spaces` array.
```

```
severity: low
file: web/app/api/curate/route.ts
line: 93
issue: `Transfer-Encoding: chunked` header is redundant
detail: When returning a ReadableStream as the response body, the runtime (Node.js / Edge) handles chunked encoding automatically. Explicitly setting `Transfer-Encoding: chunked` is unnecessary and some runtimes may warn or ignore it.
suggestion: Remove the `'Transfer-Encoding': 'chunked'` header. Keep only `Content-Type`.
```

```
severity: low
file: web/components/upload-panel.tsx
line: 30
issue: Effect fetches on every `open` toggle without abort cleanup
detail: The useEffect that fetches `/api/raw` doesn't return an AbortController cleanup. If the user rapidly opens/closes the panel or switches spaces, stale responses could set incorrect rawCount.
suggestion: Add an AbortController and abort in the cleanup function, or use a simple `let cancelled = false` guard.
```

```
severity: low
file: web/components/upload-panel.tsx
line: 167
issue: Dropzone missing keyboard accessibility
detail: The drop zone uses `onClick` on a div but has no `role`, `tabIndex`, or `onKeyDown` handler. Keyboard-only users cannot activate it. The hidden file input is the actual accessible element but isn't reachable via tab.
suggestion: Add `role="button"` and `tabIndex={0}` to the dropzone div, and handle Enter/Space keydown to trigger the file input click.
```

---

## Summary

No critical or security issues. The main actionable items are:

1. **Add SPACE_RE validation** to `/api/raw` and `/api/reindex` for consistency and defense-in-depth.
2. **Wrap JSON.parse in try/catch** in the NDJSON stream reader to handle malformed lines gracefully.
3. The rest are low-severity polish items (abort cleanup, accessibility, redundant header).

Overall: clean implementation, good separation of concerns, streaming approach is well-structured.
