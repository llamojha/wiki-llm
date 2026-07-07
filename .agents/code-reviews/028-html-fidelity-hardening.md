# Code Review: Plan 028 — HTML Document Fidelity & Hardening

**Date:** 2026-07-06
**Reviewer:** Kiro (automated pre-commit review)

**Stats:**

- Files Modified: 8
- Files Added: 9
- Files Deleted: 0
- New lines: 1043
- Deleted lines: 40

---

## Issues

```
severity: medium
file: web/lib/vault-links.ts
line: 111
issue: Unnecessary function allocation on every recursive tree walk
detail: `createTransform(options)(child)` creates a new closure on every child node visit. For a document with N nodes, this allocates N functions. The options object never changes during a single tree walk — the transform should capture itself as a named reference and recurse directly.
suggestion: Assign the returned function to a variable and call it recursively:
  function createTransform(options: VaultLinksOptions) {
    const transform = (node: HastNode): void => {
      ...
      transform(child);  // direct recursion, no re-creation
    };
    return transform;
  }
```

```
severity: medium
file: web/lib/sanitize-schema.ts
line: 58
issue: @import regex false-positive — matches innocent CSS values containing "import"
detail: The pattern `/@?import/i` will match any CSS value containing the substring "import" — e.g. `font-family: 'ImportantFont'` or `content: 'import data'`. This is too broad. The actual attack vector is `@import url(...)` which is already caught by the `/url\s*\(/i` pattern above. A standalone `@import` in an inline style attribute is not valid CSS and would be ignored by browsers anyway, but the false-positive on legitimate values like font names is a fidelity regression.
suggestion: Either remove the `/@?import/i` pattern (the `url()` pattern already catches the actual exploit), or tighten it to `/@import\s+/i` (with a leading `@` required and trailing space/url).
```

```
severity: low
file: web/lib/image-proxy.ts
line: 72
issue: SSRF bypass via DNS rebinding — hostname validation happens before fetch
detail: `validateProxyUrl` checks the hostname at request time, but `fetch` resolves DNS independently. An attacker could register a domain that resolves to a public IP during validation but rotates to `169.254.169.254` (IMDS) by the time `fetch` connects. This is a known DNS rebinding attack vector against server-side proxies. The comment in the route handler says "fetch follows redirects, but the Content-Type check on the final response catches non-image responses" — this is true and provides defense-in-depth, since IMDS returns JSON/text, not `image/*`. However, it's worth documenting this as an accepted risk.
suggestion: Document the accepted risk in a code comment. For a future hardening pass: resolve DNS manually (via `dns.lookup`) and validate the resolved IP before connecting, or use a fetch implementation that exposes the resolved address.
```

```
severity: low
file: web/lib/sanitize-schema.ts
line: 163-175
issue: walkDataImages only filters direct children, not deeply nested <img> tags
detail: The `node.children.filter(...)` only removes `<img>` elements that are direct children of `node`. After filtering, it recurses into the remaining children. But if an `<img>` with an invalid data URI is nested inside a `<div>` (not the direct child), the filter at the `<div>` level won't catch it — it only fires when the `<img>`'s parent is being processed. This IS correct because the recursion visits every node's children, but the pattern is slightly misleading: it DOES work because each node's children list is individually filtered. Confirmed correct on second analysis — no fix needed, marking as informational.
suggestion: No fix needed — the recursive pattern is correct. The filter fires at each depth level.
```

```
severity: low
file: web/app/api/image-proxy/route.ts
line: 100
issue: Cache-Control header is aggressive for proxied external content
detail: `'Cache-Control': 'public, max-age=86400, immutable'` caches for 24h and marks as immutable. If an external image is updated at its source URL, the proxy will serve stale content for 24h. The `immutable` directive tells browsers/CDNs to never revalidate. For user-uploaded HTML docs referencing external images, this is probably fine (the URL is stable), but "immutable" is a strong claim for content we don't control.
suggestion: Consider `'public, max-age=3600, stale-while-revalidate=86400'` for a more conservative approach, or drop `immutable`.
```

```
severity: low
file: web/lib/vault-links.ts
line: 74-79
issue: normalizePath collapses ../ without context — may produce incorrect routes
detail: `normalizePath('../other/page.md')` produces `other/page.md`, which becomes `/other/page.md`. But if the current document is at `docs/guides/setup.html`, then `../other/page.md` should resolve to `docs/other/page.md`, not `/other/page.md`. The comment acknowledges this ("we don't know the current doc's path") and the test passes, but the behavior is semantically wrong for documents in subdirectories. The portal's catch-all will look for a doc at the wrong key.
suggestion: This is an accepted limitation (documented in the comment). A proper fix requires passing the current document's S3 key into the rehype transform so relative paths can be resolved correctly. Consider adding a TODO comment with a reference to a follow-up.
```

---

## Summary

The implementation is solid — the security boundaries are well-defended (SVG rejection, SSRF IP validation, denylist approach, size caps). The two actionable issues are:

1. **Medium: recursion performance** — trivial fix, avoids N function allocations per render.
2. **Medium: @import false positive** — remove or tighten the regex to avoid stripping innocent CSS values.

No critical or high-severity issues. The SSRF DNS rebinding concern is mitigated by the Content-Type check on the response (defense in depth).
